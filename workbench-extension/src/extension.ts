import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { supportsNativeResume, type ActiveRun } from './adapters/cliAdapter.js';
import { runAdapter } from './adapters/runAdapter.js';
import { parseWebviewMessage } from './bridge/messages.js';
import type { CommandTarget, ConversationContextItem, ConversationMessage, CraftReceipt, FleetSnapshot, LaneSummary, RunContinuity } from './domain.js';
import {
  consentNotices,
  consentRoomName,
  writeConsentPrompt,
} from './consentRoom.js';
import {
  keepStatusCard,
  rememberCard,
  roomNameForTarget,
  runReceiptFromResult,
  sealCards,
  toolReceiptFromEvent,
} from './craftReceipts.js';
import { redact } from './security/redaction.js';
import {
  authorizeWriteAccess,
  contentSecurityPolicy,
  resolveCommandTarget,
  resolveOpenFilePath,
  supportsRouting,
  targetSupportsPermission,
} from './extensionPolicy.js';
import { requireAllowedPath } from './security/paths.js';
import { ConversationStore } from './services/conversations.js';
import { extractDecisionCards } from './services/decisions.js';
import { resolveGeneralStaffRoot, scanFleet } from './services/fleet.js';
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
import { applyDeskLayout, applyWorkshopLayout, type LayoutHost } from './deskLayout.js';

const viewType = 'generalstaff.commandDeck';

function createLayoutHost(): LayoutHost {
  return {
    executeCommand: (command) => vscode.commands.executeCommand(command),
    updateWorkbenchSetting: async (key, value) => {
      const config = vscode.workspace.getConfiguration('workbench');
      const inspect = config.inspect(key);
      const target = inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await config.update(key, value, target);
    },
  };
}

const layoutHost = createLayoutHost();
let workshopOpen = false;

async function setWorkshopOpen(open: boolean): Promise<void> {
  workshopOpen = open;
  if (open) {
    await applyWorkshopLayout(layoutHost);
  } else {
    CommandDeckPanel.current?.reveal();
    await applyDeskLayout(layoutHost, { closeOtherEditors: true });
  }
  CommandDeckPanel.current?.notifyWorkshop(open);
}

interface StartRunOptions {
  appendUser?: boolean;
  retry?: boolean;
  forceTranscript?: boolean;
}

class CommandDeckPanel {
  static current: CommandDeckPanel | undefined;

  private readonly store: ConversationStore;
  private readonly orchestrator: OrchestratorSessionManager;
  private readonly notes: ProjectNoteStore;
  private readonly preview = new PreviewServer();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingRuns = new Set<string>();
  private snapshot: FleetSnapshot | undefined;
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.store = new ConversationStore(context.globalState);
    this.orchestrator = new OrchestratorSessionManager(context.globalState, this.store);
    this.notes = new ProjectNoteStore(context.globalState);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((value: unknown) => void this.handle(value), null, context.subscriptions);
  }

  static show(context: vscode.ExtensionContext): CommandDeckPanel {
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
    CommandDeckPanel.current = new CommandDeckPanel(panel, context);
    return CommandDeckPanel.current;
  }

  static shutdown(): void {
    CommandDeckPanel.current?.dispose();
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  notifyWorkshop(open: boolean): void {
    void this.panel.webview.postMessage({ type: 'workshop-state', open });
  }

  focusComposer(): void {
    void this.panel.webview.postMessage({ type: 'focus-composer' });
  }

  async refresh(): Promise<void> {
    await this.refreshAndSend();
  }

  private async refreshAndSend(): Promise<void> {
    try {
      const configured = vscode.workspace.getConfiguration('generalstaff').get<string>('rootPath');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const rootPath = await resolveGeneralStaffRoot(configured, workspaceRoot);
      this.snapshot = await scanFleet(rootPath, this.privateRuntimeOptions());
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

  private async postState(): Promise<void> {
    if (!this.snapshot || this.disposed) return;
    await this.panel.webview.postMessage({
      type: 'state',
      snapshot: this.snapshot,
      conversations: this.store.all(),
      orchestratorSessionId: this.orchestrator.current()?.id,
      notes: this.notes.all(),
    });
  }

  private async handle(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      await this.notice('The Command Deck ignored an invalid request.', 'error');
      return;
    }

    if (message.type === 'ready' || message.type === 'refresh') {
      await this.refreshAndSend();
      this.notifyWorkshop(workshopOpen);
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
          await this.notice(consentNotices.stateOnly, 'error');
          return;
        }
        if (!(await authorizeWriteAccess(
          message.permission,
          false,
          () => this.confirmWrite(target, lane.name),
        ))) {
          await this.notice(consentNotices.declined, 'error');
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
          await this.notice(consentNotices.stateOnly, 'error');
          return;
        }
        if (!(await authorizeWriteAccess(
          message.permission,
          conversation.permission === 'write',
          () => this.confirmWrite(target, lane.name),
        ))) {
          await this.panel.webview.postMessage({ type: 'routing-updated', conversation });
          await this.notice(consentNotices.declined, 'error');
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
      case 'toggle-workshop':
        await setWorkshopOpen(!workshopOpen);
        return;
      case 'save-note':
        if (!this.snapshot.projects.some((project) => project.id === message.projectId)) return;
        await this.notes.save(message.projectId, message.text);
        await this.panel.webview.postMessage({ type: 'notes', notes: this.notes.all() });
        await this.notice('Operator note saved locally.', 'quiet');
        return;
    }
  }

  private async startRun(conversationId: string, rawText: string, options: StartRunOptions = {}): Promise<void> {
    const conversation = this.store.get(conversationId);
    if (!conversation || !this.snapshot) {
      await this.notice('That conversation is no longer available.', 'error', conversationId);
      return;
    }
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
      await this.notice(consentNotices.stateOnly, 'error', conversationId);
      return;
    }
    const cwd = target.workingDirectory;
    const privateRuntime = await discoverPrivateRuntime(this.snapshot.rootPath, this.privateRuntimeOptions());
    const priorContext = conversation.messages
      .filter((message) => message.text.trim() && message.status !== 'streaming')
      .slice(-12)
      .map((message) => `${message.role === 'user' ? 'Operator' : 'GeneralStaff'}: ${message.text}`)
      .join('\n\n')
      .slice(-30_000);
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

      await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
      let output = '';
      let encounteredError = false;
      let outputClipped = false;
      let cards: CraftReceipt[] = [];
      const target = conversation.target;
      const projectId = target.kind === 'project' ? target.projectId : undefined;
      const projectName = projectId
        ? this.snapshot.projects.find((project) => project.id === projectId)?.name
        : undefined;
      const roomName = roomNameForTarget(target, projectName);
      const craftContext = { roomName, workingDirectory: cwd };
      const keepCard = (card: CraftReceipt) => {
        cards = rememberCard(cards, {
          title: redact(card.title, 200),
          what: redact(card.what, 300),
          where: redact(card.where, 200),
          status: redact(card.status, 80),
          tone: card.tone,
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
            appendOutput(event.text);
            void this.stream(conversationId, assistant.id, output, 'streaming');
          } else if (event.type === 'error') {
            encounteredError = true;
            const card = toolReceiptFromEvent({ kind: 'error', text: event.text, ...craftContext });
            keepCard(card);
            appendOutput(`${output ? '\n\n' : ''}${event.text}`);
            void this.stream(conversationId, assistant.id, output, 'error');
            void this.panel.webview.postMessage({
              type: 'run-event',
              conversationId,
              event: { type: event.type, text: card.status },
              card,
            });
          } else if (event.type === 'status' || event.type === 'tool') {
            const card = toolReceiptFromEvent({
              kind: event.type,
              text: event.text,
              ...(event.type === 'tool' && event.place ? { place: event.place } : {}),
              ...craftContext,
            });
            if (event.type === 'tool' || keepStatusCard(event.text)) keepCard(card);
            void this.panel.webview.postMessage({
              type: 'run-event',
              conversationId,
              event: { type: event.type, text: card.status },
              card,
            });
          }
        },
      );
      this.activeRuns.set(conversationId, run);
      this.pendingRuns.delete(conversationId);

      void run.completed
        .then(async (completion) => {
          const capabilityNames = privateCapabilityReceiptNames(privateRuntime, lane, conversation.permission);
          const summary = runReceiptFromResult({
            exitCode: completion.receipt.exitCode,
            stopped: completion.receipt.stopped,
            permission: completion.receipt.permission,
            workingDirectory: completion.receipt.workingDirectory,
            roomName,
            laneName: completion.receipt.laneName,
            continuity: completion.receipt.continuity,
            ...(skill?.id ? { skillId: skill.id } : {}),
          });
          const receipt = {
            ...completion.receipt,
            ...(skill ? { skillId: skill.id, skillName: skill.name } : {}),
            ...(capabilityNames.length ? { capabilities: capabilityNames } : {}),
            ...(cards.length ? { cards: sealCards(cards) } : {}),
            summary,
          };
          const failed = encounteredError || receipt.exitCode !== 0 || receipt.stopped;
          if (!output.trim()) {
            output = receipt.stopped
              ? 'This pass was stopped.'
              : receipt.exitCode === 0
                ? 'The seat finished without a written reply. Open the project to see the work.'
                : 'This pass did not finish.';
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
            const extracted = extractDecisionCards(output, assistant.id);
            if (extracted.decisions.length) {
              output = extracted.text || 'GeneralStaff needs your decision before it can continue.';
              await this.store.addDecisions(conversationId, extracted.decisions);
            }
          }
          await this.store.setReceipt(conversationId, receipt);
          await this.stream(conversationId, assistant.id, output, failed ? 'error' : 'complete');
          await this.panel.webview.postMessage({ type: 'conversations', conversations: this.store.all() });
          await this.refreshAndSend();
        })
        .catch(async (error: unknown) => {
          const reason = error instanceof Error ? error.message : 'The selected lane could not start.';
          output = `${output}${output ? '\n\n' : ''}${reason}`;
          await this.stream(conversationId, assistant.id, output, 'error');
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
  ): Promise<void> {
    await this.store.updateAssistant(conversationId, messageId, text, status);
    await this.panel.webview.postMessage({
      type: 'conversation-delta',
      conversationId,
      messageId,
      text,
      status,
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

  private async confirmWrite(
    target: { name: string; target: { kind: 'general' | 'project' } },
    laneName: string,
  ): Promise<boolean> {
    const prompt = writeConsentPrompt(consentRoomName({ kind: target.target.kind, name: target.name }), laneName);
    const choice = await vscode.window.showWarningMessage(
      prompt.message,
      prompt.options,
      prompt.action,
    );
    return choice === prompt.action;
  }

  private openTerminal(commandTarget: CommandTarget = { kind: 'general' }): void {
    void setWorkshopOpen(true).then(() => {
      const target = this.snapshot ? resolveCommandTarget(commandTarget, this.snapshot) : undefined;
      const cwd = target?.workingDirectory ?? this.snapshot?.rootPath;
      const terminal = vscode.window.createTerminal({
        name: target ? `${target.name} · supporting terminal` : 'GeneralStaff · supporting terminal',
        ...(cwd ? { cwd } : {}),
      });
      terminal.show();
    });
  }

  private async pickContext(commandTarget: CommandTarget): Promise<void> {
    const target = this.snapshot ? resolveCommandTarget(commandTarget, this.snapshot) : undefined;
    if (!target) return;
    const selection = await vscode.window.showOpenDialog({
      title: `Reference local files in ${target.name}`,
      defaultUri: vscode.Uri.file(target.workingDirectory),
      canSelectFiles: true,
      canSelectFolders: false,
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
        if ((stat.type & vscode.FileType.File) === 0) continue;
        const extension = path.extname(resolved).toLowerCase();
        const kind: ConversationContextItem['kind'] = /\.(png|jpe?g|gif|webp|svg)$/u.test(extension)
          ? 'image'
          : /\.(json|csv)$/u.test(extension)
            ? 'data'
            : 'document';
        items.push({ label: path.basename(resolved), path: resolved, kind });
      } catch {
        // The picker and bridge may only attach files inside the selected command target.
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
      await setWorkshopOpen(true);
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
        <div><strong>Opening the desk</strong><span>Reading the fleet without interrupting active work…</span></div>
      </div>
    </div>
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

export function activate(context: vscode.ExtensionContext): void {
  const immersive = vscode.workspace.getConfiguration('generalstaff').get<boolean>('immersiveMode', true);
  workshopOpen = !immersive;

  context.subscriptions.push(
    vscode.commands.registerCommand('generalstaff.openCommandDeck', () => CommandDeckPanel.show(context)),
    vscode.commands.registerCommand('generalstaff.newConversation', () => {
      const panel = CommandDeckPanel.show(context);
      panel.focusComposer();
    }),
    vscode.commands.registerCommand('generalstaff.refresh', async () => {
      await CommandDeckPanel.show(context).refresh();
    }),
    vscode.commands.registerCommand('generalstaff.openRawTerminal', () => {
      void setWorkshopOpen(true).then(() => {
        vscode.window.createTerminal({ name: 'GeneralStaff · supporting terminal' }).show();
      });
    }),
    vscode.commands.registerCommand('generalstaff.openWorkshop', () => setWorkshopOpen(true)),
    vscode.commands.registerCommand('generalstaff.returnToDesk', () => setWorkshopOpen(false)),
  );

  if (immersive) {
    void applyDeskLayout(layoutHost);
  }

  if (vscode.workspace.getConfiguration('generalstaff').get<boolean>('openOnLaunch', true)) {
    const timer = setTimeout(() => {
      const panel = CommandDeckPanel.show(context);
      panel.reveal();
      if (immersive) {
        void applyDeskLayout(layoutHost, { closeOtherEditors: true });
      }
      panel.notifyWorkshop(workshopOpen);
    }, 120);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }
}

export function deactivate(): void {
  CommandDeckPanel.shutdown();
}
