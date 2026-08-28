import type * as vscode from 'vscode';
import type { Conversation, EffortId, LaneId, PermissionMode, RunContinuity } from '../domain.js';
import { supportsNativeResume } from '../adapters/cliAdapter.js';
import { ConversationStore } from './conversations.js';

const orchestratorSessionKey = 'generalstaff.orchestratorSession.v1';

export interface OrchestratorRouting {
  laneId: LaneId;
  effort: EffortId;
  permission?: PermissionMode;
  compatibleLaneIds?: readonly LaneId[];
}

export interface TurnContinuity {
  continuity: RunContinuity;
  providerSessionId?: string;
  transcript: string;
}

/**
 * Owns the one durable GeneralStaff seat identity. Provider CLIs may finish a
 * turn, but their native session identifier and the visible transcript stay
 * attached to this host-owned session across webview and extension restarts.
 */
export class OrchestratorSessionManager {
  constructor(
    private readonly state: vscode.Memento,
    private readonly store: ConversationStore,
  ) {}

  async ensure(routing: OrchestratorRouting): Promise<Conversation> {
    const storedId = this.state.get<string>(orchestratorSessionKey);
    const stored = storedId ? this.store.get(storedId) : undefined;
    if (stored?.kind === 'orchestrator' && stored.target.kind === 'general') return stored;

    const existing = this.store.all().find(
      (conversation) => conversation.kind === 'orchestrator' && conversation.target.kind === 'general',
    );
    if (existing) {
      await this.state.update(orchestratorSessionKey, existing.id);
      return existing;
    }

    // v2.4 created ordinary General-scoped commands. Preserve the newest one's
    // transcript and provider session instead of discarding operator context.
    const legacyGeneral = this.store.all().find((conversation) => conversation.target.kind === 'general');
    let session = legacyGeneral
      ? await this.store.promoteToOrchestrator(legacyGeneral.id)
      : await this.store.createOrchestrator(routing.laneId, routing.effort, routing.permission);
    if (!session) throw new Error('The orchestrator session could not be restored.');
    if (routing.compatibleLaneIds && !routing.compatibleLaneIds.includes(session.laneId)) {
      session = await this.store.setRouting(
        session.id,
        routing.laneId,
        'orchestrate',
        routing.effort,
        'read',
        session.skillId,
      ) ?? session;
    }
    await this.state.update(orchestratorSessionKey, session.id);
    return session;
  }

  current(): Conversation | undefined {
    const id = this.state.get<string>(orchestratorSessionKey);
    const conversation = id ? this.store.get(id) : undefined;
    return conversation?.kind === 'orchestrator' && conversation.target.kind === 'general'
      ? conversation
      : undefined;
  }

  continuationFor(
    conversation: Conversation,
    runner: LaneId,
    skillId: string | undefined,
    workingDirectory: string,
    forceTranscript = false,
  ): TurnContinuity {
    if (conversation.kind !== 'orchestrator' || conversation.target.kind !== 'general') {
      throw new Error('Orchestrator continuity requires the durable GeneralStaff session.');
    }
    const providerSessionId = !forceTranscript &&
      conversation.receipt?.laneId === conversation.laneId &&
      supportsNativeResume(conversation.laneId)
      ? this.store.providerSession(
          conversation.id,
          conversation.laneId,
          runner,
          conversation.permission,
          skillId,
          workingDirectory,
        )
      : undefined;
    const transcript = conversation.messages
      .filter((message) => message.text.trim() && message.status !== 'streaming')
      .slice(-24)
      .map((message) => `${message.role === 'user' ? 'Operator' : 'GeneralStaff'}: ${message.text}`)
      .join('\n\n')
      .slice(-60_000);
    return {
      continuity: providerSessionId ? 'native' : transcript ? 'transcript' : 'new',
      ...(providerSessionId ? { providerSessionId } : {}),
      transcript,
    };
  }
}
