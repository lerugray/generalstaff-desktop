import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { contentSecurityPolicy } from './extensionPolicy.js';
import { buildDeskPanelModel, emptyDeskPanelModel, type DeskPanelModel } from './deskPanelModel.js';
import { resolveGeneralStaffRoot } from './services/fleet.js';
import { scanDeskPackets } from './services/deskPackets.js';
import { recordRuling, resolveDefaultSessionId } from './services/pingRuling.js';

export const deskViewType = 'generalstaff.deskView';
const VISIBLE_POLL_MS = 15_000;
const HIDDEN_POLL_MS = 60_000;

export type DeskBadgeListener = (count: number) => void;

/**
 * Desk as an auxiliary-bar WebviewView (M3d). Editor WebviewPanel path deleted.
 */
export class DeskViewProvider implements vscode.WebviewViewProvider {
  static current: DeskViewProvider | undefined;

  private view: vscode.WebviewView | undefined;
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private model: DeskPanelModel = emptyDeskPanelModel();
  private selectedKey: string | undefined;
  private readonly badgeListeners = new Set<DeskBadgeListener>();

  constructor(private readonly context: vscode.ExtensionContext) {
    DeskViewProvider.current = this;
  }

  static shutdown(): void {
    DeskViewProvider.current?.dispose();
    DeskViewProvider.current = undefined;
  }

  static badgeCount(): number {
    return DeskViewProvider.current?.model.badgeCount ?? 0;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    this.disposed = false;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.onDidDispose(() => this.onViewDisposed());
    webviewView.onDidChangeVisibility(() => this.restartPoll());
    webviewView.webview.onDidReceiveMessage((value: unknown) => void this.handle(value));
    this.restartPoll();
    void this.refresh();
    this.applyBadge();
  }

  onBadge(listener: DeskBadgeListener): vscode.Disposable {
    this.badgeListeners.add(listener);
    listener(this.model.badgeCount);
    return { dispose: () => this.badgeListeners.delete(listener) };
  }

  async refresh(): Promise<void> {
    await this.pullAndSend();
  }

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${deskViewType}.focus`);
  }

  private restartPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.disposed || !this.view) return;
    const interval = this.view.visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
    this.pollTimer = setInterval(() => {
      void this.pullAndSend();
    }, interval);
  }

  private async resolveRoot(): Promise<string> {
    const configured = vscode.workspace.getConfiguration('generalstaff').get<string>('rootPath');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return resolveGeneralStaffRoot(configured, workspaceRoot);
  }

  private async pullAndSend(notice?: string): Promise<void> {
    if (this.disposed || !this.view) return;
    try {
      const rootPath = await this.resolveRoot();
      const [packets, defaultSession] = await Promise.all([
        scanDeskPackets(),
        resolveDefaultSessionId(rootPath),
      ]);
      this.setModel(buildDeskPanelModel(packets, {
        ...(defaultSession ? { defaultSession } : {}),
        ...(notice ? { notice } : {}),
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Desk could not read handoff packets.';
      this.setModel(emptyDeskPanelModel(detail));
    }
  }

  private setModel(model: DeskPanelModel): void {
    this.model = model;
    for (const listener of this.badgeListeners) listener(model.badgeCount);
    this.applyBadge();
    void this.view?.webview.postMessage({
      type: 'desk-model',
      model,
      selectedKey: this.selectedKey ?? null,
    });
  }

  private applyBadge(): void {
    if (!this.view) return;
    this.view.badge = this.model.badgeCount > 0
      ? {
          value: this.model.badgeCount,
          tooltip: `${this.model.badgeCount} packet${this.model.badgeCount === 1 ? '' : 's'} waiting on the desk`,
        }
      : undefined;
  }

  private leafByKey(key: string) {
    return this.model.leaves.find((leaf) => leaf.key === key);
  }

  private async handle(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object') return;
    const type = (value as { type?: unknown }).type;
    if (type === 'ready' || type === 'refresh') {
      await this.pullAndSend();
      return;
    }
    if (type === 'select-leaf') {
      const key = typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key : '';
      this.selectedKey = key || undefined;
      return;
    }
    if (type === 'open-folder') {
      const key = typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key : '';
      const leaf = this.leafByKey(key);
      if (!leaf) return;
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(leaf.path));
      return;
    }
    if (type === 'open-annotate') {
      const key = typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key : '';
      const leaf = this.leafByKey(key);
      if (!leaf?.annotatePath) return;
      await vscode.env.openExternal(vscode.Uri.file(leaf.annotatePath));
      return;
    }
    if (type === 'record-ruling') {
      const key = typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key : '';
      const verdict = typeof (value as { verdict?: unknown }).verdict === 'string' ? (value as { verdict: string }).verdict : '';
      const tags = typeof (value as { tags?: unknown }).tags === 'string' ? (value as { tags: string }).tags : '';
      const session = typeof (value as { session?: unknown }).session === 'string' ? (value as { session: string }).session : '';
      const attachAnnotateNotes = (value as { attachAnnotateNotes?: unknown }).attachAnnotateNotes === true;
      const leaf = this.leafByKey(key);
      if (!leaf) {
        void this.view?.webview.postMessage({
          type: 'ruling-result',
          ok: false,
          errorDetail: 'Packet is no longer on the desk.',
        });
        return;
      }
      try {
        const rootPath = await this.resolveRoot();
        const result = await recordRuling({
          rootPath,
          packetPath: leaf.path,
          folderName: leaf.folderName,
          game: leaf.game,
          gate: leaf.gate,
          session: session || this.model.defaultSession || '',
          verdict,
          tags,
          attachAnnotateNotes,
        });
        void this.view?.webview.postMessage({
          type: 'ruling-result',
          ok: result.ok,
          stdout: result.stdout,
          stderr: result.stderr,
          argv: result.argv,
          sweptTo: result.sweptTo,
          errorDetail: result.errorDetail,
        });
        if (result.ok) {
          this.selectedKey = undefined;
          await this.pullAndSend(result.stdout.trim() || `Ruled — swept to ${result.sweptTo}`);
        }
      } catch (error) {
        void this.view?.webview.postMessage({
          type: 'ruling-result',
          ok: false,
          errorDetail: error instanceof Error ? error.message : 'Ruling failed.',
        });
      }
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(18).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'workbench.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'desk.js'));
    const csp = contentSecurityPolicy(webview.cspSource, nonce, { frameSrc: true });
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${css}">
    <title>Desk · handoff packets</title>
  </head>
  <body>
    <div id="app" aria-live="polite">
      <div class="boot">
        <div class="boot-mark">GS</div>
        <div><strong>Opening Desk</strong><span>Reading handoff packets…</span></div>
      </div>
    </div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }

  private onViewDisposed(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.view = undefined;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.badgeListeners.clear();
    this.view = undefined;
  }
}
