import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { supportsNativeResume, type ActiveRun } from './adapters/cliAdapter.js';
import { runAdapter } from './adapters/runAdapter.js';
import { parseWebviewMessage } from './bridge/messages.js';
import type { CommandTarget, ConversationContextItem, ConversationMessage, FleetSnapshot, LaneId, LaneSummary, RunContinuity, TranscriptBlock } from './domain.js';
import {
  authorizeWriteAccess,
  contentSecurityPolicy,
  resolveCommandTarget,
  resolveOpenFilePath,
  supportsRouting,
  targetSupportsPermission,
  writeConsentPrompt,
} from './extensionPolicy.js';
import { requireAllowedPath } from './security/paths.js';
import { ConversationStore } from './services/conversations.js';
import { extractDecisionCards } from './services/decisions.js';
import {
  applyDecisionTextToBlocks,
  buildPriorContextTranscript,
  findToolBlockForResult,
  needsNewBubble,
} from './services/runTranscript.js';
import { resolveGeneralStaffRoot, scanFleet } from './services/fleet.js';
import type { CliLaneDiscoveryOptions } from './services/lanes.js';
import { ProjectNoteStore } from './services/notes.js';
import { OrchestratorSessionManager } from './services/orchestratorSession.js';
import { PreviewServer } from './services/previewServer.js';
import {
  discoverPrivateRuntime,
  privateCapabilityReceiptNames,
  privateRuntimePrompt,
  type PrivateRuntimeOptions,
} from './services/privateRuntime.js';
import { compileSkillBundle, resolveSkillInvocation } from './services/skills.js';
import { DeskViewProvider, deskViewType } from './deskPanel.js';
import { LanesViewProvider, lanesViewType } from './lanesPanel.js';
import { nextAuxToggleState, planOpenOnLaunch, reconcileAuxFocus, type AuxPanel } from './launchPlan.js';
import { SessionsNavProvider } from './sessionsNav.js';

const viewType = 'generalstaff.commandDeck';

interface StartRunOptions {
  appendUser?: boolean;
  retry?: boolean;
  forceTranscript?: boolean;
}

class CommandDeckPanel {
  static current: CommandDeckPanel | undefined;

  private readonly notes: ProjectNoteStore;
  private readonly preview = new PreviewServer();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingRuns = new Set<string>();
  private snapshot: FleetSnapshot | undefined;
  private disposed = false;
  private onSessionsChanged: (() => void) | undefined;
  private lanesBadge = 0;
  private deskBadge = 0;
  private auxFocus: AuxPanel | null = null;
  private focusedConversationId: string | undefined;
  private readonly output: vscode.OutputChannel;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly store: ConversationStore,
    private readonly orchestrator: OrchestratorSessionManager,
  ) {
    this.notes = new ProjectNoteStore(context.globalState);
    this.output = vscode.window.createOutputChannel('GeneralStaff Workbench');
    context.subscriptions.push(this.output);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((value: unknown) => void this.handle(value), null, context.subscriptions);
  }

  static show(
    context: vscode.ExtensionContext,
    store: ConversationStore,
    orchestrator: OrchestratorSessionManager,
  ): CommandDeckPanel {
    if (CommandDeckPanel.current) {
      CommandDeckPanel.current.panel.reveal(vscode.ViewColumn.One);
      return CommandDeckPanel.current;
    }

    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      viewType,
      'GeneralStaff Command Deck',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(mediaRoot, 'mark-light.svg'),
      dark: vscode.Uri.joinPath(mediaRoot, 'mark-dark.svg'),
    };
    CommandDeckPanel.current = new CommandDeckPanel(panel, context, store, orchestrator);
    return CommandDeckPanel.current;
  }

  static shutdown(): void {
    CommandDeckPanel.current?.dispose();
  }

  setSessionsListener(listener: (() => void) | undefined): void {
    this.onSessionsChanged = listener;
  }

  setPanelBadges(lanes: number, desk: number): void {
    this.lanesBadge = lanes;
    this.deskBadge = desk;
    void this.postState();
  }

  setAuxFocus(focus: AuxPanel | null): void {
    this.auxFocus = focus;
    void this.postState();
  }

  focusComposer(): void {
    void this.panel.webview.postMessage({ type: 'focus-composer' });
  }

  hasRunningTurn(conversationId?: string): boolean {
    if (conversationId) {
      return this.activeRuns.has(conversationId) || this.pendingRuns.has(conversationId);
    }
    return this.activeRuns.size > 0 || this.pendingRuns.size > 0;
  }

  runningConversationIds(): string[] {
    return [...new Set([...this.activeRuns.keys(), ...this.pendingRuns])];
  }

  stopRun(conversationId: string): void {
    this.activeRuns.get(conversationId)?.stop();
    // Pending runs are not yet in activeRuns; drop them so Stop-and-switch
    // cannot leave a setup that later streams into the abandoned session.
    this.pendingRuns.delete(conversationId);
  }

  async refresh(): Promise<void> {
    await this.refreshAndSend();
  }

  projectNames(): Map<string, string> {
    return new Map((this.snapshot?.projects ?? []).map((project) => [project.id, project.name]));
  }

  async openSession(conversationId: string): Promise<void> {
    const conversation = this.store.get(conversationId);
    if (!conversation) {
      await this.notice('That session is no longer available.', 'error');
      return;
    }
    if (conversation.archivedAt !== undefined) {
      await this.store.unarchive(conversationId);
    }
    if (conversation.kind === 'orchestrator' || conversation.target.kind === 'general') {
      await this.orchestrator.activate(conversationId);
    } else if (conversation.target.kind === 'project') {
      await this.store.setActiveProject(conversation.target.projectId, conversationId);
    }
    this.focusedConversationId = conversationId;
    await this.panel.webview.postMessage({ type: 'conversation-selected', conversation: this.store.get(conversationId) });
    await this.postState();
    this.onSessionsChanged?.();
    this.panel.reveal(vscode.ViewColumn.One);
  }

  async newSession(): Promise<void> {
    const running = this.runningConversationIds();
    if (running.length) {
      const choice = await vscode.window.showWarningMessage(
        'A turn is still running. Stop it and start a new session?',
        { modal: true },
        'Stop and switch',
        'Cancel',
      );
      if (choice !== 'Stop and switch') return;
      for (const id of running) this.stopRun(id);
    }
    if (!this.snapshot) await this.refreshAndSend();
    if (!this.snapshot) return;
    const focused = this.focusedConversationId
      ? this.store.get(this.focusedConversationId)
      : this.orchestrator.current();
    if (focused?.target.kind === 'project') {
      const lane = this.snapshot.lanes.find((item) => item.id === focused.laneId)
        ?? this.snapshot.lanes.find((item) => item.state === 'available')
        ?? this.snapshot.lanes[0];
      if (!lane) {
        await this.notice('No model lanes are configured for a new session.', 'error');
        return;
      }
      const conversation = await this.store.create(
        focused.target,
        lane.id,
        focused.seat,
        focused.effort,
        'read',
        focused.skillId,
      );
      this.focusedConversationId = conversation.id;
      await this.panel.webview.postMessage({ type: 'conversation-selected', conversation });
      await this.postState();
      this.onSessionsChanged?.();
      this.focusComposer();
      return;
    }
    const current = this.orchestrator.current();
    const lane = this.snapshot.lanes.find((item) => item.id === (current?.laneId ?? 'claude'))
      ?? this.snapshot.lanes.find((item) => item.state === 'available' && item.roles.includes('orchestrate'))
      ?? this.snapshot.lanes[0];
    if (!lane) {
      await this.notice('No model lanes are configured for a new session.', 'error');
      return;
    }
    const session = await this.orchestrator.startNew({
      laneId: lane.id,
      effort: current?.effort ?? lane.defaultEffort,
      permission: 'read',
    });
    this.focusedConversationId = session.id;
    await this.panel.webview.postMessage({ type: 'conversation-selected', conversation: session });
    await this.postState();
    this.onSessionsChanged?.();
    this.focusComposer();
  }

  /** Lane the deck would use when ensuring an orchestrator session. */
  resolvedOrchestratorLaneId(): LaneId {
    const current = this.orchestrator.current();
    const focused = this.focusedConversationId
      ? this.store.get(this.focusedConversationId)
      : undefined;
    const preferred: LaneId = current?.laneId ?? focused?.laneId ?? 'claude';
    const lane = this.snapshot?.lanes.find((item) => item.id === preferred)
      ?? this.snapshot?.lanes.find((item) => item.state === 'available' && item.roles.includes('orchestrate'))
      ?? this.snapshot?.lanes[0];
    return lane?.id ?? preferred;
  }

  async switchOrStop(conversationId: string): Promise<boolean> {
    const running = this.runningConversationIds();
    if (!running.length) {
      await this.openSession(conversationId);
      return true;
    }
    if (running.includes(conversationId)) {
      await this.openSession(conversationId);
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      'A turn is still running. Stop it and switch sessions?',
      { modal: true },
      'Stop and switch',
      'Cancel',
    );
    if (choice !== 'Stop and switch') return false;
    for (const id of running) this.stopRun(id);
    await this.openSession(conversationId);
    return true;
  }

  /**
   * The Grok CLI cannot be probed for entitlement: it reports itself logged in while its
   * subscription is out of credits, and a real request probe never returns because its leader
   * process holds stdout. `generalstaff.grokRunner` lets the operator pin the seat to the
   * Cursor Grok 4.6 runner, which is a working door for the same model.
   */
  private laneOptions(): CliLaneDiscoveryOptions {
    const grokRunner = vscode.workspace.getConfiguration('generalstaff').get<string>('grokRunner', 'auto');
    return grokRunner === 'cursor' ? { forceRunner: { grok: 'cursor' } } : {};
  }

  private async refreshAndSend(): Promise<void> {
    try {
      const configured = vscode.workspace.getConfiguration('generalstaff').get<string>('rootPath');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const rootPath = await resolveGeneralStaffRoot(configured, workspaceRoot);
      this.snapshot = await scanFleet(rootPath, this.privateRuntimeOptions(), this.laneOptions());
      const orchestratorReady = (item: LaneSummary) =>
        item.state === 'available' && item.roles.includes('orchestrate') && item.permissions.includes('read');
      // Operator ruling 2026-08-28: the orchestrator session defaults to the Claude Fable
      // seat when it is available; other lanes remain explicit picks.
      const lane = this.snapshot.lanes.find((item) => item.id === 'claude' && orchestratorReady(item))
        ?? this.snapshot.lanes.find(orchestratorReady)
        ?? this.snapshot.lanes.find((item) => item.id === 'claude')
        ?? this.snapshot.lanes[0];
      if (!lane) throw new Error('No model lanes are configured for the orchestrator session.');
      await this.orchestrator.ensure({
        laneId: lane.id,
        effort: lane.defaultEffort,
        permission: 'read',
        compatibleLaneIds: this.snapshot.lanes
          .filter((item) => item.state === 'available' && item.roles.includes('orchestrate'))
          .map((item) => item.id),
      });
      await this.postState();
    } catch (error) {
      await this.notice(error instanceof Error ? error.message : 'GeneralStaff could not refresh its project state.', 'error');
    }
  }

  private privateRuntimeOptions(): PrivateRuntimeOptions {
    const laneDeskRuntimePath = vscode.workspace.getConfiguration('generalstaff').get<string>('laneDeskRuntimePath')?.trim();
    return laneDeskRuntimePath ? { laneDeskRuntimePath } : {};
  }

  private operatorDisplayName(): string {
    return vscode.workspace.getConfiguration('generalstaff').get<string>('operatorDisplayName')?.trim() ?? '';
  }

  private async postState(): Promise<void> {
    if (!this.snapshot || this.disposed) return;
    await this.panel.webview.postMessage({
      type: 'state',
      snapshot: this.snapshot,
      conversations: this.store.all(),
      orchestratorSessionId: this.orchestrator.current()?.id,
      notes: this.notes.all(),
      operatorDisplayName: this.operatorDisplayName(),
      lanesBadgeCount: this.lanesBadge,
      deskBadgeCount: this.deskBadge,
      auxFocus: this.auxFocus,
    });
    this.onSessionsChanged?.();
  }

  private async handle(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      await this.notice('The Command Deck ignored an invalid request.', 'error');
      return;
    }

    if (message.type === 'ready' || message.type === 'refresh') {
      await this.refreshAndSend();
      return;
    }

    if (!this.snapshot) {
      await this.refreshAndSend();
      if (!this.snapshot) return;
    }

    switch (message.type) {
      case 'new-conversation': {
        if (message.target.kind === 'general') {
          const session = this.orchestrator.current();
          if (session) await this.panel.webview.postMessage({ type: 'conversation-selected', conversation: session });
          return;
        }
        const target = resolveCommandTarget(message.target, this.snapshot);
        const lane = this.snapshot.lanes.find((item) => item.id === message.laneId);
        const skill = message.skillId ? this.snapshot.skills.find((item) => item.id === message.skillId) : undefined;
        if (!target || !lane || lane.state !== 'available') {
          await this.notice('Choose a command target and an available model lane first.', 'error');
          return;
        }
        if (message.skillId && !skill) {
          await this.notice(`The private skill /${message.skillId} is not available in this GeneralStaff root.`, 'error');
          return;
        }
        if (!supportsRouting(lane, message.seat, message.permission, message.effort)) {
          await this.notice(`${lane.name} is not configured for the ${message.seat} seat.`, 'error');
          return;
        }
        if (!targetSupportsPermission(message.permission, target)) {
          await this.notice('Edit access requires a repository-backed command target. This project is state-only.', 'error');
          return;
        }
        if (!(await authorizeWriteAccess(
          message.permission,
          false,
          () => this.confirmWrite(target.name, lane.name),
        ))) {
          await this.notice('Edit access was not enabled.', 'error');
          return;
        }
        const contextItems = await this.contextItems(message.target, message.contextPaths);
        const conversation = await this.store.create(
          message.target,
          message.laneId,
          message.seat,
          message.effort,
          message.permission,
          message.skillId,
          contextItems,
        );
        await this.panel.webview.postMessage({ type: 'conversation-selected', conversation });
        await this.postState();
        return;
      }
      case 'update-routing': {
        if (this.activeRuns.has(message.conversationId) || this.pendingRuns.has(message.conversationId)) {
          await this.notice('Stop the active run before changing its lane, seat, or permission.', 'error');
          return;
        }
        const conversation = this.store.get(message.conversationId);
        if (conversation?.kind === 'orchestrator' && message.seat !== 'orchestrate') {
          await this.notice('The persistent GeneralStaff session always uses the orchestrator seat.', 'error');
          return;
        }
        const target = conversation ? resolveCommandTarget(conversation.target, this.snapshot) : undefined;
        const lane = this.snapshot.lanes.find((item) => item.id === message.laneId);
        const skill = message.skillId ? this.snapshot.skills.find((item) => item.id === message.skillId) : undefined;
        if (
          !conversation || !target || !lane ||
          !supportsRouting(lane, message.seat, message.permission, message.effort) ||
          (message.skillId !== undefined && !skill)
        ) {
          await this.notice('That routing combination is not available for this conversation.', 'error');
          return;
        }
        if (!targetSupportsPermission(message.permission, target)) {
          await this.notice('Edit access requires a repository-backed command target. This project is state-only.', 'error');
          return;
        }
        if (!(await authorizeWriteAccess(
          message.permission,
          conversation.permission === 'write',
          () => this.confirmWrite(target.name, lane.name),
        ))) {
          await this.panel.webview.postMessage({ type: 'routing-updated', conversation });
          await this.notice('Edit access remains off.', 'error');
          return;
        }
        if (this.activeRuns.has(message.conversationId) || this.pendingRuns.has(message.conversationId)) {
          await this.notice('Stop the active run before changing its lane, seat, or permission.', 'error');
          return;
        }
        const updated = await this.store.setRouting(
          message.conversationId,
          message.laneId,
          message.seat,
          message.effort,
          message.permission,
          message.skillId,
        );
        await this.panel.webview.postMessage({ type: 'routing-updated', conversation: updated });
        await this.postState();
        return;
      }
      case 'send-prompt':
        await this.startRun(message.conversationId, message.text);
        return;
      case 'retry-run':
        await this.retryRun(message.conversationId, message.strategy);
        return;
      case 'answer-decision':
        await this.answerDecision(message.conversationId, message.decisionId, message.optionId);
        return;
      case 'stop-run':
        this.activeRuns.get(message.conversationId)?.stop();
        await this.notice('Stopping the active lane now.', 'quiet');
        return;
      case 'open-project':
        await this.openProject(message.projectId);
        return;
      case 'open-terminal':
        this.openTerminal(message.target);
        return;
      case 'open-file':
        await this.openFile(message.path);
        return;
      case 'pick-context':
        await this.pickContext(message.target);
        return;
      case 'choose-root':
        await this.chooseRoot();
        return;
      case 'save-note':
        if (!this.snapshot.projects.some((project) => project.id === message.projectId)) return;
        await this.notes.save(message.projectId, message.text);
        await this.panel.webview.postMessage({ type: 'notes', notes: this.notes.all() });
        await this.notice('Operator note saved locally.', 'quiet');
        return;
      case 'toggle-lanes':
        await vscode.commands.executeCommand('generalstaff.toggleLanes');
        return;
      case 'toggle-desk':
        await vscode.commands.executeCommand('generalstaff.toggleDesk');
        return;
      case 'new-session':
        await vscode.commands.executeCommand('generalstaff.newSession');
        return;
      case 'show-sessions':
        await vscode.commands.executeCommand('generalstaff.showSessions');
        return;
    }
  }

  private async startRun(conversationId: string, rawText: string, options: StartRunOptions = {}): Promise<void> {
    const conversation = this.store.get(conversationId);
    if (!conversation || !this.snapshot) {
      await this.notice('That conversation is no longer available.', 'error', conversationId);
      return;
    }
    this.focusedConversationId = conversationId;
    if (this.activeRuns.has(conversationId) || this.pendingRuns.has(conversationId)) {
      await this.notice('That conversation already has a lane running.', 'error', conversationId);
      return;
    }

    const target = resolveCommandTarget(conversation.target, this.snapshot);
    const lane = this.snapshot.lanes.find((item) => item.id === conversation.laneId);
    const invocation = resolveSkillInvocation(rawText, this.snapshot.skills);
    const text = invocation.operatorText;
    if (!target || !lane || !text) {
      await this.notice('The command target, lane, or command is no longer available.', 'error', conversationId);
      return;
    }
    if (invocation.unknownSkillId) {
      await this.notice(
        `/${invocation.unknownSkillId} is not a private skill in the selected GeneralStaff root. Choose one from the Skill menu or refresh the fleet.`,
        'error',
        conversationId,
      );
      return;
    }
    const skillId = invocation.skillId ?? conversation.skillId;
    const skill = skillId ? this.snapshot.skills.find((item) => item.id === skillId) : undefined;
    if (skillId && !skill) {
      await this.notice(`The private skill /${skillId} is no longer available. Refresh or choose another skill.`, 'error', conversationId);
      return;
    }
    if (
      lane.state !== 'available' ||
      !lane.roles.includes(conversation.seat) ||
      !lane.permissions.includes(conversation.permission) ||
      !lane.efforts.some((effort) => effort.id === conversation.effort)
    ) {
      await this.notice('The selected lane no longer supports this seat and permission combination.', 'error', conversationId);
      return;
    }

    if (!targetSupportsPermission(conversation.permission, target)) {
      await this.notice('This conversation cannot edit because its command target is not repository-backed.', 'error', conversationId);
      return;
    }
    const cwd = target.workingDirectory;
    const privateRuntime = await discoverPrivateRuntime(this.snapshot.rootPath, this.privateRuntimeOptions());
    const priorContext = buildPriorContextTranscript(conversation.messages);
    const selectedContext = (conversation.context ?? [])
      .map((item) => `- ${item.label}: ${item.path}`)
      .join('\n');
    const contextBlock = selectedContext
      ? `\n\nLocal context explicitly selected by the operator:\n${selectedContext}`
      : '';
    const orchestratorContinuity = conversation.kind === 'orchestrator'
      ? this.orchestrator.continuationFor(conversation, lane.runner, skillId, cwd, options.forceTranscript)
      : undefined;
    const handoffContext = orchestratorContinuity?.transcript ?? priorContext;
    const providerSessionId = orchestratorContinuity?.providerSessionId ?? (
      !options.forceTranscript && supportsNativeResume(lane.id) && conversation.receipt?.laneId === lane.id
        ? this.store.providerSession(conversationId, lane.id, lane.runner, conversation.permission, skillId, cwd)
        : undefined
    );
    const continuity: RunContinuity = orchestratorContinuity?.continuity ?? (providerSessionId
      ? 'native'
      : priorContext
        ? 'transcript'
        : 'new');
    const laneRequest = invocation.laneText;
    const lanePrompt = continuity === 'native'
      ? options.retry
        ? `Retry the latest operator request. The previous attempt did not complete cleanly. Continue from the provider session, avoid repeating finished work, and report what you verified.\n\nOriginal operator request:\n${laneRequest}`
        : laneRequest
      : handoffContext
        ? `Continue this existing Workbench conversation using the transcript handoff below. Treat the newest operator request as authoritative.\n\nTranscript:\n${handoffContext}\n\nNewest operator request:\n${laneRequest}`
        : laneRequest;

    let skillBlock = '';
    if (skill) {
      if (continuity === 'native') {
        skillBlock = `Continue following the operator-selected private skill /${skill.id} (${skill.name}) already loaded in this provider session. The skill does not expand the current permission boundary.`;
      } else {
        try {
          const bundle = await compileSkillBundle(this.snapshot.rootPath, skill.id);
          skillBlock = bundle.prompt;
        } catch (error) {
          await this.notice(error instanceof Error ? error.message : `The private skill /${skill.id} could not be loaded.`, 'error', conversationId);
          return;
        }
      }
    }
    const runtimeBlock = privateRuntimePrompt(privateRuntime, lane, conversation.permission);
    const procedures = [runtimeBlock, skillBlock].filter(Boolean).join('\n\n');
    const groundedPrompt = procedures
      ? `${procedures}\n\nTask for this run:\n${lanePrompt}${contextBlock}`
      : `${lanePrompt}${contextBlock}`;

    if (invocation.skillId && invocation.skillId !== conversation.skillId) {
      await this.store.setSkill(conversationId, invocation.skillId);
      await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
    }
    this.pendingRuns.add(conversationId);
    try {
      if (options.appendUser !== false) {
        await this.store.append(conversationId, { role: 'user', text, status: 'complete' });
      }
      const updated = await this.store.append(conversationId, {
        role: 'assistant',
        text: '',
        status: 'streaming',
        ...(options.retry ? { attempt: 'retry' as const } : {}),
      });
      const assistant = updated?.messages.at(-1);
      if (!assistant) {
        await this.notice('The conversation could not record this run.', 'error', conversationId);
        return;
      }

      if (!this.pendingRuns.has(conversationId)) {
        await this.stream(conversationId, assistant.id, 'This run was stopped.', 'error');
        return;
      }

      await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
      let output = '';
      let encounteredError = false;
      let outputClipped = false;
      let currentAssistantId = assistant.id;
      let currentTurnId: string | undefined;
      let blocks: TranscriptBlock[] = [];
      // Track whether the last streamed chunk was assistant prose so tool-loop
      // turns get paragraph breaks instead of gluing every preamble together
      // on lanes that still collapse to a single bubble.
      let lastStreamKind: 'assistant' | 'other' | undefined;
      let eventChain: Promise<void> = Promise.resolve();
      const enqueueEvent = (work: () => Promise<void>) => {
        eventChain = eventChain.then(work).catch((error: unknown) => {
          // Surface chain failures (MINOR 12) — never swallow silently.
          const reason = error instanceof Error ? error.message : String(error);
          void this.notice(`Run event chain error: ${reason}`, 'error', conversationId);
          this.output?.appendLine(`[run-event] ${conversationId}: ${reason}`);
        });
      };
      const appendOutput = (chunk: string) => {
        const limit = 200_000;
        if (output.length >= limit) return;
        const remaining = limit - output.length;
        output += chunk.slice(0, remaining);
        if (chunk.length > remaining && !outputClipped) {
          output += '\n\n[Workbench clipped additional lane output at 200,000 characters.]';
          outputClipped = true;
        }
      };
      const textFromBlocks = () => blocks
        .filter((block): block is Extract<TranscriptBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n');
      const ensureTurn = async (turnId?: string): Promise<void> => {
        const hasContent = blocks.length > 0 || Boolean(output.trim());
        if (!needsNewBubble(currentTurnId, turnId, hasContent)) {
          if (turnId) currentTurnId = turnId;
          return;
        }
        await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'complete', blocks);
        const updatedTurn = await this.store.append(conversationId, {
          role: 'assistant',
          text: '',
          status: 'streaming',
          blocks: [],
        });
        const next = updatedTurn?.messages.at(-1);
        if (!next) return;
        currentAssistantId = next.id;
        currentTurnId = turnId;
        blocks = [];
        output = '';
        outputClipped = false;
        lastStreamKind = undefined;
        // Post only the affected conversation (MINOR 10) — not the entire store.
        const updatedConversation = this.store.get(conversationId);
        if (updatedConversation) {
          await this.panel.webview.postMessage({
            type: 'conversation',
            conversation: updatedConversation,
          });
        }
      };

      const run = runAdapter(
        {
          conversationId,
          target: conversation.target,
          cwd,
          lane,
          seat: conversation.seat,
          effort: conversation.effort,
          permission: conversation.permission,
          prompt: groundedPrompt,
          continuity,
          mcpServers: privateRuntime.mcpServers,
          ...(providerSessionId ? { providerSessionId } : {}),
        },
        (event) => {
          if (event.type === 'assistant-delta') {
            enqueueEvent(async () => {
              await ensureTurn(event.turnId);
              const separator = output && lastStreamKind !== 'assistant' ? '\n\n' : '';
              appendOutput(`${separator}${event.text}`);
              lastStreamKind = 'assistant';
              const last = blocks[blocks.length - 1];
              if (last?.type === 'text') {
                last.text += event.text;
              } else {
                blocks.push({ type: 'text', text: event.text });
              }
              await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'streaming', blocks);
            });
          } else if (event.type === 'thinking') {
            enqueueEvent(async () => {
              await ensureTurn(event.turnId);
              lastStreamKind = 'other';
              blocks.push({ type: 'thinking', text: event.text });
              await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'streaming', blocks);
            });
          } else if (event.type === 'tool') {
            enqueueEvent(async () => {
              await ensureTurn(event.turnId);
              lastStreamKind = 'other';
              blocks.push({
                type: 'tool',
                ...(event.toolUseId ? { id: event.toolUseId } : {}),
                name: event.name ?? event.text,
                summary: event.summary ?? event.text,
                ...(event.detail ? { detail: event.detail } : {}),
                status: 'running',
              });
              await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'streaming', blocks);
              await this.panel.webview.postMessage({
                type: 'run-event',
                conversationId,
                event: { type: 'tool', text: event.text },
              });
            });
          } else if (event.type === 'tool-result') {
            enqueueEvent(async () => {
              const match = findToolBlockForResult(blocks, event.toolUseId);
              if (match) {
                match.status = event.ok ? 'ok' : 'error';
                match.resultPreview = event.preview;
                if (event.body !== undefined) match.result = event.body;
              }
              lastStreamKind = 'other';
              await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'streaming', blocks);
              const label = match
                ? `${match.name} · ${match.summary} · ${event.ok ? 'ok' : 'error'}`
                : `${event.ok ? 'ok' : 'error'}${event.preview ? ` · ${event.preview}` : ''}`;
              await this.panel.webview.postMessage({
                type: 'run-event',
                conversationId,
                event: { type: 'tool', text: label },
              });
            });
          } else if (event.type === 'error') {
            enqueueEvent(async () => {
              encounteredError = true;
              lastStreamKind = 'other';
              appendOutput(`${output ? '\n\n' : ''}${event.text}`);
              await this.stream(conversationId, currentAssistantId, textFromBlocks() || output, 'error', blocks);
            });
          } else if (event.type === 'context-usage') {
            void this.panel.webview.postMessage({
              type: 'context-usage',
              conversationId,
              usedTokens: event.usedTokens,
              ...(event.sessionSpend != null ? { sessionSpend: event.sessionSpend } : {}),
            });
          } else if (event.type === 'session-spend') {
            void this.panel.webview.postMessage({
              type: 'context-usage',
              conversationId,
              sessionSpend: event.tokens,
            });
          } else if (event.type === 'status') {
            lastStreamKind = 'other';
            void this.panel.webview.postMessage({
              type: 'run-event',
              conversationId,
              event: { type: event.type, text: event.text },
            });
          }
        },
      );
      if (!this.pendingRuns.has(conversationId)) {
        run.stop();
        await this.stream(conversationId, currentAssistantId, 'This run was stopped.', 'error', blocks);
        return;
      }
      this.activeRuns.set(conversationId, run);
      this.pendingRuns.delete(conversationId);

      void run.completed
        .then(async (completion) => {
          await eventChain;
          const capabilityNames = privateCapabilityReceiptNames(privateRuntime, lane, conversation.permission);
          const receipt = {
            ...completion.receipt,
            ...(skill ? { skillId: skill.id, skillName: skill.name } : {}),
            ...(capabilityNames.length ? { capabilities: capabilityNames } : {}),
          };
          const failed = encounteredError || receipt.exitCode !== 0 || receipt.stopped;
          let finalText = textFromBlocks() || output;
          if (!finalText.trim()) {
            finalText = receipt.stopped
              ? 'This run was stopped.'
              : receipt.exitCode === 0
                ? 'The lane completed without a text response. Open the command target to inspect its work.'
                : `The lane exited with code ${receipt.exitCode ?? 'unknown'}.`;
            if (!blocks.some((block) => block.type === 'text')) {
              blocks = [...blocks, { type: 'text', text: finalText }];
            }
          }
          if (completion.providerSessionId) {
            await this.store.setProviderSession(
              conversationId,
              lane.id,
              lane.runner,
              conversation.permission,
              skillId,
              cwd,
              completion.providerSessionId,
            );
          }
          if (!failed) {
            const extracted = extractDecisionCards(finalText, currentAssistantId);
            if (extracted.decisions.length) {
              finalText = extracted.text || 'GeneralStaff needs your decision before it can continue.';
              // First text block only — never duplicate across text→tool→text (MAJOR 3).
              blocks = applyDecisionTextToBlocks(blocks, finalText);
              await this.store.addDecisions(conversationId, extracted.decisions);
            }
          }
          await this.store.setReceipt(conversationId, receipt);
          await this.stream(conversationId, currentAssistantId, finalText, failed ? 'error' : 'complete', blocks);
          await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
          await this.refreshAndSend();
        })
        .catch(async (error: unknown) => {
          await eventChain;
          const reason = error instanceof Error ? error.message : 'The selected lane could not start.';
          const finalText = `${textFromBlocks() || output}${output || textFromBlocks() ? '\n\n' : ''}${reason}`;
          await this.stream(conversationId, currentAssistantId, finalText, 'error', blocks);
          await this.notice(reason, 'error', conversationId);
        })
        .finally(() => this.activeRuns.delete(conversationId));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The selected lane could not start.';
      const latest = this.store.get(conversationId)?.messages.at(-1);
      if (latest?.role === 'assistant' && latest.status === 'streaming') {
        await this.stream(conversationId, latest.id, reason, 'error');
      }
      await this.notice(reason, 'error', conversationId);
    } finally {
      this.pendingRuns.delete(conversationId);
    }
  }

  private async retryRun(conversationId: string, strategy: 'auto' | 'transcript'): Promise<void> {
    const conversation = this.store.get(conversationId);
    if (!conversation || this.activeRuns.has(conversationId) || this.pendingRuns.has(conversationId)) {
      await this.notice('This conversation is already running or is no longer available.', 'error', conversationId);
      return;
    }
    const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant');
    const lastUser = [...conversation.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser || lastAssistant?.status !== 'error') {
      await this.notice('Retry is available after an interrupted, stopped, or failed run.', 'error', conversationId);
      return;
    }
    if (strategy === 'transcript') {
      await this.store.clearProviderSession(conversationId, conversation.laneId);
    }
    await this.startRun(conversationId, lastUser.text, {
      appendUser: false,
      retry: true,
      forceTranscript: strategy === 'transcript',
    });
  }

  private async answerDecision(conversationId: string, decisionId: string, optionId: string): Promise<void> {
    if (this.activeRuns.has(conversationId) || this.pendingRuns.has(conversationId)) {
      await this.notice('Stop the active run before answering this decision.', 'error', conversationId);
      return;
    }
    const conversation = this.store.get(conversationId);
    const decision = conversation?.decisions.find((item) => item.id === decisionId);
    const option = decision?.options.find((item) => item.id === optionId);
    if (!conversation || !decision || !option || decision.answeredAt) {
      await this.notice('That decision is no longer waiting for an answer.', 'error', conversationId);
      return;
    }
    const answered = await this.store.answerDecision(conversationId, decisionId, optionId);
    if (!answered) return;
    await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
    const response = `Operator decision — ${decision.title}: ${option.label}.${option.description ? ` ${option.description}` : ''}`;
    await this.startRun(conversationId, response);
  }

  private async stream(
    conversationId: string,
    messageId: string,
    text: string,
    status: NonNullable<ConversationMessage['status']>,
    blocks?: TranscriptBlock[],
  ): Promise<void> {
    await this.store.updateAssistant(conversationId, messageId, text, status, blocks);
    await this.panel.webview.postMessage({
      type: 'conversation-delta',
      conversationId,
      messageId,
      text,
      status,
      ...(blocks ? { blocks } : {}),
    });
  }

  private async openProject(projectId: string): Promise<void> {
    const project = this.snapshot?.projects.find((item) => item.id === projectId);
    if (!project) return;
    const artifact = project.artifacts.find((item) => /readme/i.test(item.label)) ?? project.artifacts[0];
    await this.openFile(artifact?.path ?? path.join(project.statePath, 'MISSION.md'));
  }

  private async chooseRoot(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      title: 'Choose the GeneralStaff private root (the folder containing state/)',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    const selected = selection?.[0];
    if (!selected) return;
    try {
      const state = await vscode.workspace.fs.stat(vscode.Uri.joinPath(selected, 'state'));
      if ((state.type & vscode.FileType.Directory) === 0) throw new Error('Missing state directory.');
      await vscode.workspace
        .getConfiguration('generalstaff')
        .update('rootPath', selected.fsPath, vscode.ConfigurationTarget.Global);
      await this.refreshAndSend();
      await this.notice('GeneralStaff root saved for this machine.', 'quiet');
    } catch {
      await this.notice('Choose the GeneralStaff root folder that contains state/.', 'error');
    }
  }

  private async confirmWrite(targetName: string, laneName: string): Promise<boolean> {
    const prompt = writeConsentPrompt(targetName, laneName);
    const choice = await vscode.window.showWarningMessage(
      prompt.message,
      prompt.options,
      prompt.action,
    );
    return choice === prompt.action;
  }

  private openTerminal(commandTarget: CommandTarget = { kind: 'general' }): void {
    const target = this.snapshot ? resolveCommandTarget(commandTarget, this.snapshot) : undefined;
    const cwd = target?.workingDirectory ?? this.snapshot?.rootPath;
    const terminal = vscode.window.createTerminal({
      name: target ? `${target.name} · supporting terminal` : 'GeneralStaff · supporting terminal',
      ...(cwd ? { cwd } : {}),
    });
    terminal.show();
  }

  private async pickContext(commandTarget: CommandTarget): Promise<void> {
    const target = this.snapshot ? resolveCommandTarget(commandTarget, this.snapshot) : undefined;
    if (!target) return;
    const selection = await vscode.window.showOpenDialog({
      title: `Reference local files or folders in ${target.name}`,
      defaultUri: vscode.Uri.file(target.workingDirectory),
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      filters: {
        'Useful context': ['md', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'json', 'csv'],
      },
    });
    if (!selection?.length) return;
    const items = await this.contextItems(commandTarget, selection.map((uri) => uri.fsPath));
    await this.panel.webview.postMessage({ type: 'context-picked', items });
  }

  private async contextItems(commandTarget: CommandTarget, candidates: string[]): Promise<ConversationContextItem[]> {
    const target = this.snapshot ? resolveCommandTarget(commandTarget, this.snapshot) : undefined;
    if (!target) return [];
    const items: ConversationContextItem[] = [];
    for (const candidate of candidates.slice(0, 12)) {
      try {
        const resolved = requireAllowedPath(candidate, target.contextRoots);
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(resolved));
        if ((stat.type & vscode.FileType.Directory) !== 0) {
          items.push({ label: path.basename(resolved), path: resolved, kind: 'folder' });
          continue;
        }
        if ((stat.type & vscode.FileType.File) === 0) continue;
        const extension = path.extname(resolved).toLowerCase();
        const kind: ConversationContextItem['kind'] = /\.(png|jpe?g|gif|webp|svg)$/u.test(extension)
          ? 'image'
          : /\.(json|csv)$/u.test(extension)
            ? 'data'
            : 'document';
        items.push({ label: path.basename(resolved), path: resolved, kind });
      } catch {
        // The picker and bridge may only attach paths inside the selected command target
        // (plus the standing Desktop/handoff staging folder when present).
      }
    }
    return items;
  }

  private async openFile(candidate: string): Promise<void> {
    if (!this.snapshot) return;
    try {
      const resolved = resolveOpenFilePath(candidate, this.snapshot.rootPath, this.snapshot.projects);
      const uri = vscode.Uri.file(resolved);
      const extension = path.extname(resolved).toLowerCase();
      if (extension === '.md') {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } else if (extension === '.html' || extension === '.htm') {
        await vscode.commands.executeCommand('simpleBrowser.show', await this.preview.urlFor(resolved));
      } else {
        await vscode.commands.executeCommand('vscode.open', uri);
      }
    } catch (error) {
      await this.notice(error instanceof Error ? error.message : 'That file could not be opened.', 'error');
    }
  }

  private async notice(text: string, tone: 'error' | 'quiet', conversationId?: string): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'notice',
      text,
      tone,
      ...(conversationId ? { conversationId } : {}),
    });
  }

  private html(): string {
    const nonce = crypto.randomBytes(18).toString('base64');
    const css = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'workbench.css'));
    const operatorIdentity = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'operatorIdentity.js'));
    const composerKeys = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'composerKeys.js'));
    const script = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'workbench.js'));
    const csp = contentSecurityPolicy(this.panel.webview.cspSource, nonce);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${css}">
    <title>GeneralStaff Command Deck</title>
  </head>
  <body>
    <div id="app" aria-live="polite">
      <div class="boot">
        <div class="boot-mark">GS</div>
        <div><strong>Opening Command Deck</strong><span>Reading the fleet without interrupting active work…</span></div>
      </div>
    </div>
    <script nonce="${nonce}" src="${operatorIdentity}"></script>
    <script nonce="${nonce}" src="${composerKeys}"></script>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    for (const run of this.activeRuns.values()) run.stop();
    this.activeRuns.clear();
    this.pendingRuns.clear();
    this.preview.dispose();
    CommandDeckPanel.current = undefined;
  }
}

function applySessionsBadge(tree: vscode.TreeView<unknown>, count: number): void {
  tree.badge = count > 0
    ? { value: count, tooltip: `${count} active session${count === 1 ? '' : 's'}` }
    : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new ConversationStore(context.globalState);
  const orchestrator = new OrchestratorSessionManager(context.globalState, store);
  const sessionsProvider = new SessionsNavProvider(store);
  const sessionsNav = vscode.window.createTreeView('generalstaff.sessionsNav', {
    treeDataProvider: sessionsProvider,
    showCollapseAll: true,
  });

  const lanesProvider = new LanesViewProvider(context);
  const deskProvider = new DeskViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(lanesViewType, lanesProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(deskViewType, deskProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  let auxFocus: AuxPanel | null = null;
  const syncDeckBadges = (): void => {
    CommandDeckPanel.current?.setPanelBadges(
      LanesViewProvider.badgeCount(),
      DeskViewProvider.badgeCount(),
    );
  };
  const syncAuxFocus = (): void => {
    CommandDeckPanel.current?.setAuxFocus(auxFocus);
  };
  context.subscriptions.push(
    lanesProvider.onBadge(() => syncDeckBadges()),
    deskProvider.onBadge(() => syncDeckBadges()),
    lanesProvider.onVisibility((visible) => {
      if (visible) auxFocus = 'lanes';
      else if (auxFocus === 'lanes') auxFocus = null;
      syncAuxFocus();
    }),
    deskProvider.onVisibility((visible) => {
      if (visible) auxFocus = 'desk';
      else if (auxFocus === 'desk') auxFocus = null;
      syncAuxFocus();
    }),
  );

  const showDeck = (): CommandDeckPanel => {
    const panel = CommandDeckPanel.show(context, store, orchestrator);
    panel.setSessionsListener(() => {
      sessionsProvider.refresh(panel.projectNames());
      applySessionsBadge(
        sessionsNav,
        store.all().filter((c) => c.archivedAt === undefined).length,
      );
    });
    return panel;
  };

  const refreshSessionsFromDeck = (): void => {
    sessionsProvider.refresh(CommandDeckPanel.current?.projectNames() ?? new Map());
    applySessionsBadge(
      sessionsNav,
      store.all().filter((c) => c.archivedAt === undefined).length,
    );
  };
  refreshSessionsFromDeck();

  const sessionIdFromArg = (node?: { type?: string; item?: { id?: string } } | string): string | undefined => {
    if (typeof node === 'string') return node;
    if (node && node.type === 'session' && typeof node.item?.id === 'string') return node.item.id;
    return undefined;
  };

  const focusAux = async (panel: AuxPanel): Promise<void> => {
    if (panel === 'lanes') await lanesProvider.focus();
    else await deskProvider.focus();
    auxFocus = panel;
    syncDeckBadges();
    syncAuxFocus();
  };

  const hideAux = async (): Promise<void> => {
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    auxFocus = null;
    syncAuxFocus();
  };

  const toggleAux = async (target: AuxPanel): Promise<void> => {
    auxFocus = reconcileAuxFocus(auxFocus, {
      lanes: lanesProvider.isVisible(),
      desk: deskProvider.isVisible(),
    });
    syncAuxFocus();
    const { next, action } = nextAuxToggleState(auxFocus, target);
    if (action === 'hide') await hideAux();
    else await focusAux(target);
    auxFocus = next;
    syncAuxFocus();
  };

  context.subscriptions.push(sessionsNav);

  context.subscriptions.push(
    vscode.commands.registerCommand('generalstaff.openCommandDeck', () => showDeck()),
    vscode.commands.registerCommand('generalstaff.openLanes', async () => {
      await focusAux('lanes');
    }),
    vscode.commands.registerCommand('generalstaff.openDesk', async () => {
      await focusAux('desk');
    }),
    vscode.commands.registerCommand('generalstaff.toggleLanes', async () => {
      await toggleAux('lanes');
    }),
    vscode.commands.registerCommand('generalstaff.toggleDesk', async () => {
      await toggleAux('desk');
    }),
    vscode.commands.registerCommand('generalstaff.newConversation', () => {
      const panel = showDeck();
      panel.focusComposer();
    }),
    vscode.commands.registerCommand('generalstaff.newSession', async () => {
      const panel = showDeck();
      await panel.newSession();
      refreshSessionsFromDeck();
    }),
    vscode.commands.registerCommand('generalstaff.showSessions', async () => {
      await vscode.commands.executeCommand('generalstaff.sessionsNav.focus');
    }),
    vscode.commands.registerCommand('generalstaff.openSession', async (conversationId?: string) => {
      if (typeof conversationId !== 'string') return;
      const panel = showDeck();
      await panel.switchOrStop(conversationId);
      refreshSessionsFromDeck();
    }),
    vscode.commands.registerCommand('generalstaff.renameSession', async (node?: { type?: string; item?: { id?: string } } | string) => {
      const id = sessionIdFromArg(node);
      const conversation = id ? store.get(id) : undefined;
      if (!conversation) {
        void vscode.window.showErrorMessage('Choose a session to rename.');
        return;
      }
      const next = await vscode.window.showInputBox({
        title: 'Rename session',
        value: conversation.title,
        prompt: 'Session title',
      });
      if (next === undefined) return;
      await store.rename(conversation.id, next);
      refreshSessionsFromDeck();
      await CommandDeckPanel.current?.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.archiveSession', async (node?: { type?: string; item?: { id?: string } } | string) => {
      const id = sessionIdFromArg(node);
      const conversation = id ? store.get(id) : undefined;
      if (!conversation) return;
      const deck = CommandDeckPanel.current;
      if (deck?.hasRunningTurn(conversation.id)) {
        void vscode.window.showErrorMessage('Stop the running turn before archiving this session.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Archive session “${conversation.title}”? It moves under Archived and stays recoverable.`,
        { modal: true },
        'Archive',
      );
      if (confirm !== 'Archive') return;
      await store.archive(conversation.id);
      refreshSessionsFromDeck();
      await CommandDeckPanel.current?.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.unarchiveSession', async (node?: { type?: string; item?: { id?: string } } | string) => {
      const id = sessionIdFromArg(node);
      if (!id) return;
      await store.unarchive(id);
      refreshSessionsFromDeck();
      await CommandDeckPanel.current?.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.deleteSession', async (node?: { type?: string; item?: { id?: string } } | string) => {
      const id = sessionIdFromArg(node);
      const conversation = id ? store.get(id) : undefined;
      if (!conversation) return;
      const deck = CommandDeckPanel.current;
      if (deck?.hasRunningTurn(conversation.id)) {
        void vscode.window.showErrorMessage('Stop the running turn before deleting this session.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete session “${conversation.title}”? This removes its transcript.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;
      const laneId = deck?.resolvedOrchestratorLaneId() ?? conversation.laneId;
      const effort = conversation.effort ?? 'default';
      await store.delete(conversation.id);
      if (!orchestrator.current()) {
        await orchestrator.ensure({
          laneId,
          effort,
          permission: 'read',
        });
      }
      refreshSessionsFromDeck();
      await deck?.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.filterSessions', async () => {
      const value = await vscode.window.showInputBox({
        title: 'Filter sessions',
        value: sessionsProvider.getFilter(),
        prompt: 'Filter by title, project, or lane',
      });
      if (value === undefined) return;
      sessionsProvider.setFilter(value);
    }),
    vscode.commands.registerCommand('generalstaff.refresh', async () => {
      await showDeck().refresh();
      await LanesViewProvider.current?.refresh();
      await DeskViewProvider.current?.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.refreshLanes', async () => {
      await focusAux('lanes');
      await lanesProvider.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.refreshDesk', async () => {
      await focusAux('desk');
      await deskProvider.refresh();
    }),
    vscode.commands.registerCommand('generalstaff.openRawTerminal', () => {
      vscode.window.createTerminal({ name: 'GeneralStaff · supporting terminal' }).show();
    }),
  );

  const config = vscode.workspace.getConfiguration('generalstaff');
  const launch = planOpenOnLaunch({
    openOnLaunch: config.get<boolean>('openOnLaunch', true),
    immersiveMode: config.get<boolean>('immersiveMode', false),
  });
  if (launch.openCommandDeck) {
    const timer = setTimeout(() => {
      showDeck();
      if (launch.closePanel || vscode.workspace.getConfiguration('generalstaff').get<boolean>('immersiveMode', false)) {
        void vscode.workspace.getConfiguration('workbench').update(
          'activityBar.location',
          'default',
          vscode.ConfigurationTarget.Workspace,
        );
        if (launch.closePanel) {
          void vscode.commands.executeCommand('workbench.action.closePanel');
        }
        // Do not close the auxiliary bar — Lanes/Desk toggles live there.
      }
    }, 350);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }
}

export function deactivate(): void {
  DeskViewProvider.shutdown();
  LanesViewProvider.shutdown();
  CommandDeckPanel.shutdown();
}
