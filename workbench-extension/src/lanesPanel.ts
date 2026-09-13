import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { contentSecurityPolicy } from './extensionPolicy.js';
import { buildLanesPanelModel, emptyLanesPanelModel, type LanesPanelModel } from './lanesPanelModel.js';
import { resolveGeneralStaffRoot } from './services/fleet.js';
import {
  fetchLaneDeskStatus,
  type LaneDeskStatusEnvelope,
} from './services/laneDeskStatus.js';
import {
  discoverPrivateRuntime,
  type PrivateRuntimeOptions,
} from './services/privateRuntime.js';

const viewType = 'generalstaff.lanesPanel';
const VISIBLE_POLL_MS = 30_000;
const HIDDEN_POLL_MS = 60_000;

export type LanesBadgeListener = (count: number) => void;

export class LanesPanel {
  static current: LanesPanel | undefined;

  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private model: LanesPanelModel = emptyLanesPanelModel('Opening Lanes…');
  private lastEnvelope: LaneDeskStatusEnvelope | undefined;
  private readonly badgeListeners = new Set<LanesBadgeListener>();

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

  static show(context: vscode.ExtensionContext, column: vscode.ViewColumn = vscode.ViewColumn.Beside): LanesPanel {
    if (LanesPanel.current) {
      LanesPanel.current.panel.reveal(column);
      return LanesPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      viewType,
      'Lanes · detached runs',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(mediaRoot, 'icon-lanes.svg'),
      dark: vscode.Uri.joinPath(mediaRoot, 'icon-lanes.svg'),
    };
    LanesPanel.current = new LanesPanel(panel, context);
    return LanesPanel.current;
  }

  static shutdown(): void {
    LanesPanel.current?.dispose();
  }

  static badgeCount(): number {
    return LanesPanel.current?.model.badgeCount ?? 0;
  }

  onBadge(listener: LanesBadgeListener): vscode.Disposable {
    this.badgeListeners.add(listener);
    listener(this.model.badgeCount);
    return { dispose: () => this.badgeListeners.delete(listener) };
  }

  async refresh(): Promise<void> {
    await this.pullAndSend();
  }

  private privateRuntimeOptions(): PrivateRuntimeOptions {
    const laneDeskRuntimePath = vscode.workspace.getConfiguration('generalstaff').get<string>('laneDeskRuntimePath')?.trim();
    return laneDeskRuntimePath ? { laneDeskRuntimePath } : {};
  }

  private restartPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.disposed) return;
    const interval = this.panel.visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
    this.pollTimer = setInterval(() => {
      void this.pullAndSend();
    }, interval);
  }

  private async pullAndSend(): Promise<void> {
    if (this.disposed) return;
    try {
      const configured = vscode.workspace.getConfiguration('generalstaff').get<string>('rootPath');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const rootPath = await resolveGeneralStaffRoot(configured, workspaceRoot);
      const profile = await discoverPrivateRuntime(rootPath, this.privateRuntimeOptions());
      const result = await fetchLaneDeskStatus(profile);
      if (result.kind === 'missing') {
        this.setModel(emptyLanesPanelModel(result.detail, true));
        return;
      }
      if (result.kind === 'error') {
        if (this.lastEnvelope) {
          this.setModel(buildLanesPanelModel(this.lastEnvelope, {
            stale: true,
            errorDetail: result.detail,
          }));
          return;
        }
        this.setModel(emptyLanesPanelModel(result.detail));
        return;
      }
      this.lastEnvelope = result.envelope;
      this.setModel(buildLanesPanelModel(result.envelope, result.stale ? { stale: true } : {}));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Lane Desk status failed.';
      if (this.lastEnvelope) {
        this.setModel(buildLanesPanelModel(this.lastEnvelope, { stale: true, errorDetail: detail }));
        return;
      }
      this.setModel(emptyLanesPanelModel(detail));
    }
  }

  private setModel(model: LanesPanelModel): void {
    this.model = model;
    for (const listener of this.badgeListeners) listener(model.badgeCount);
    void this.panel.webview.postMessage({ type: 'lanes-model', model });
  }

  private async handle(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object') return;
    const type = (value as { type?: unknown }).type;
    if (type === 'ready' || type === 'refresh') {
      await this.pullAndSend();
    }
  }

  private html(): string {
    const nonce = crypto.randomBytes(18).toString('base64');
    const css = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'workbench.css'));
    const script = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'lanes.js'));
    const csp = contentSecurityPolicy(this.panel.webview.cspSource, nonce);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${css}">
    <title>Lanes · detached runs</title>
  </head>
  <body>
    <div id="app" aria-live="polite">
      <div class="boot">
        <div class="boot-mark">GS</div>
        <div><strong>Opening Lanes</strong><span>Reading detached runs without interrupting Command…</span></div>
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
    LanesPanel.current = undefined;
  }
}

/** Activity-bar nav stubs: focusing the Workbench view reveals Command / Lanes editor panels. */
export class WorkbenchNavProvider implements vscode.TreeDataProvider<string> {
  constructor(private readonly label: 'Command' | 'Lanes') {}

  getTreeItem(element: string): vscode.TreeItem {
    const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.None);
    item.command = {
      command: this.label === 'Command' ? 'generalstaff.openCommandDeck' : 'generalstaff.openLanes',
      title: `Open ${this.label}`,
    };
    item.description = this.label === 'Lanes' ? 'detached runs' : 'orchestrator';
    return item;
  }

  getChildren(): string[] {
    return [this.label];
  }
}
