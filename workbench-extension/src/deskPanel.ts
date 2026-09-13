import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { contentSecurityPolicy } from './extensionPolicy.js';
import { buildDeskPanelModel, emptyDeskPanelModel, type DeskPanelModel } from './deskPanelModel.js';
import { resolveGeneralStaffRoot } from './services/fleet.js';
import { scanDeskPackets } from './services/deskPackets.js';
import { recordRuling, resolveDefaultSessionId } from './services/pingRuling.js';

const viewType = 'generalstaff.deskPanel';
const VISIBLE_POLL_MS = 15_000;
const HIDDEN_POLL_MS = 60_000;

export type DeskBadgeListener = (count: number) => void;

export class DeskPanel {
  static current: DeskPanel | undefined;

  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private model: DeskPanelModel = emptyDeskPanelModel();
  private selectedKey: string | undefined;
  private readonly badgeListeners = new Set<DeskBadgeListener>();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
    this.panel.onDidChangeViewState(() => this.restartPoll(), null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((value: unknown) => void this.handle(value), null, context.subscriptions);
    this.restartPoll();
    void this.refresh();
  }

  static show(context: vscode.ExtensionContext, column: vscode.ViewColumn = vscode.ViewColumn.Beside): DeskPanel {
    if (DeskPanel.current) {
      DeskPanel.current.panel.reveal(column);
      return DeskPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      viewType,
      'Desk · handoff packets',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(mediaRoot, 'icon-desk.svg'),
      dark: vscode.Uri.joinPath(mediaRoot, 'icon-desk.svg'),
    };
    DeskPanel.current = new DeskPanel(panel, context);
    return DeskPanel.current;
  }

  static shutdown(): void {
    DeskPanel.current?.dispose();
  }

  static badgeCount(): number {
    return DeskPanel.current?.model.badgeCount ?? 0;
  }

  onBadge(listener: DeskBadgeListener): vscode.Disposable {
    this.badgeListeners.add(listener);
    listener(this.model.badgeCount);
    return { dispose: () => this.badgeListeners.delete(listener) };
  }

  async refresh(): Promise<void> {
    await this.pullAndSend();
  }

  private restartPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.disposed) return;
    const interval = this.panel.visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
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
    if (this.disposed) return;
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
    void this.panel.webview.postMessage({
      type: 'desk-model',
      model,
      selectedKey: this.selectedKey ?? null,
    });
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
      const leaf = this.leafByKey(key);
      if (!leaf) {
        void this.panel.webview.postMessage({
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
        });
        void this.panel.webview.postMessage({
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
        void this.panel.webview.postMessage({
          type: 'ruling-result',
          ok: false,
          errorDetail: error instanceof Error ? error.message : 'Ruling failed.',
        });
      }
    }
  }

  private html(): string {
    const nonce = crypto.randomBytes(18).toString('base64');
    const css = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'workbench.css'));
    const script = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'desk.js'));
    const csp = contentSecurityPolicy(this.panel.webview.cspSource, nonce, { frameSrc: true });
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

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.badgeListeners.clear();
    DeskPanel.current = undefined;
  }
}
