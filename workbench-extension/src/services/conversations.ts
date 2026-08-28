import * as crypto from 'node:crypto';
import type * as vscode from 'vscode';
import type {
  Conversation,
  ConversationContextItem,
  ConversationDecision,
  ConversationMessage,
  ConversationReceipt,
  CommandTarget,
  EffortId,
  LaneId,
  PermissionMode,
  SeatId,
} from '../domain.js';

const storageKey = 'generalstaff.conversations.v1';
const providerStorageKey = 'generalstaff.providerSessions.v1';
const maxConversations = 30;

interface ProviderSession {
  id: string;
  laneId: LaneId;
  runner: LaneId;
  permission: PermissionMode;
  skillId?: string;
  workingDirectory: string;
  updatedAt: number;
}

type StoredConversation = Omit<Conversation, 'target' | 'writeConsent'> & {
  target?: CommandTarget;
  projectId?: string;
  writeConsent?: { at: number; target?: CommandTarget; projectId?: string };
};

function restoredTarget(conversation: StoredConversation): CommandTarget {
  if (conversation.target?.kind === 'general') return { kind: 'general' };
  if (conversation.target?.kind === 'project' && conversation.target.projectId) {
    return { kind: 'project', projectId: conversation.target.projectId };
  }
  return { kind: 'project', projectId: conversation.projectId ?? 'unavailable-project' };
}

type ProviderSessionMap = Record<string, Partial<Record<LaneId, ProviderSession>>>;

export class ConversationStore {
  private conversations: Conversation[];
  private providerSessions: ProviderSessionMap;

  constructor(private readonly state: vscode.Memento) {
    let recoveredInterruptedRun = false;
    this.conversations = state.get<StoredConversation[]>(storageKey, []).map((stored) => {
      const { projectId: _legacyProjectId, writeConsent, ...conversation } = stored;
      const target = restoredTarget(stored);
      return {
        ...conversation,
        target,
        ...(writeConsent ? { writeConsent: { at: writeConsent.at, target } } : {}),
        permission: conversation.permission ?? 'read',
        effort: conversation.effort ?? 'default',
        context: conversation.context ?? [],
        decisions: conversation.decisions ?? [],
        messages: (conversation.messages ?? []).map((message) => {
          if (message.status !== 'streaming') return message;
          recoveredInterruptedRun = true;
          return {
            ...message,
            text: message.text.trim()
              ? `${message.text}\n\nThe Workbench closed before this run completed.`
              : 'The Workbench closed before this run completed.',
            status: 'error' as const,
          };
        }),
      };
    });
    this.providerSessions = state.get<ProviderSessionMap>(providerStorageKey, {});
    if (recoveredInterruptedRun) void this.persist();
  }

  all(): Conversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((conversation) => conversation.id === id);
  }

  async create(
    target: CommandTarget,
    laneId: LaneId,
    seat: SeatId,
    effort: EffortId,
    permission: PermissionMode,
    skillId?: string,
    context: ConversationContextItem[] = [],
  ): Promise<Conversation> {
    const now = Date.now();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: 'New command',
      target,
      laneId,
      seat,
      effort,
      ...(skillId ? { skillId } : {}),
      permission,
      ...(permission === 'write' ? { writeConsent: { at: now, target } } : {}),
      context,
      messages: [],
      decisions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.unshift(conversation);
    await this.persist();
    return conversation;
  }

  async append(id: string, message: Omit<ConversationMessage, 'id' | 'createdAt'>): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation) return undefined;
    conversation.messages.push({ ...message, id: crypto.randomUUID(), createdAt: Date.now() });
    if (message.role === 'user' && conversation.title === 'New command') {
      conversation.title = message.text.replace(/\s+/g, ' ').trim().slice(0, 54) || 'New command';
    }
    conversation.updatedAt = Date.now();
    await this.persist();
    return conversation;
  }

  async updateAssistant(
    id: string,
    messageId: string,
    text: string,
    status: NonNullable<ConversationMessage['status']>,
  ): Promise<void> {
    const conversation = this.get(id);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (!conversation || !message) return;
    message.text = text;
    message.status = status;
    conversation.updatedAt = Date.now();
    if (status !== 'streaming') await this.persist();
  }

  async setReceipt(id: string, receipt: ConversationReceipt): Promise<void> {
    const conversation = this.get(id);
    if (!conversation) return;
    conversation.receipt = receipt;
    conversation.updatedAt = Date.now();
    await this.persist();
  }

  async addDecisions(id: string, decisions: ConversationDecision[]): Promise<void> {
    if (!decisions.length) return;
    const conversation = this.get(id);
    if (!conversation) return;
    const existing = new Set(conversation.decisions.map((decision) => decision.id));
    conversation.decisions.push(...decisions.filter((decision) => !existing.has(decision.id)).slice(0, 3));
    conversation.updatedAt = Date.now();
    await this.persist();
  }

  async answerDecision(id: string, decisionId: string, optionId: string): Promise<ConversationDecision | undefined> {
    const conversation = this.get(id);
    const decision = conversation?.decisions.find((item) => item.id === decisionId);
    if (!conversation || !decision || decision.answeredAt || !decision.options.some((option) => option.id === optionId)) {
      return undefined;
    }
    decision.answerOptionId = optionId;
    decision.answeredAt = Date.now();
    conversation.updatedAt = Date.now();
    await this.persist();
    return decision;
  }

  providerSession(
    conversationId: string,
    laneId: LaneId,
    runner: LaneId,
    permission: PermissionMode,
    skillId: string | undefined,
    workingDirectory: string,
  ): string | undefined {
    const session = this.providerSessions[conversationId]?.[laneId];
    if (
      !session ||
      session.runner !== runner ||
      session.permission !== permission ||
      session.skillId !== skillId ||
      session.workingDirectory !== workingDirectory
    ) return undefined;
    return session.id;
  }

  async setProviderSession(
    conversationId: string,
    laneId: LaneId,
    runner: LaneId,
    permission: PermissionMode,
    skillId: string | undefined,
    workingDirectory: string,
    sessionId: string,
  ): Promise<void> {
    this.providerSessions[conversationId] ??= {};
    (this.providerSessions[conversationId] as Partial<Record<LaneId, ProviderSession>>)[laneId] = {
      id: sessionId,
      laneId,
      runner,
      permission,
      ...(skillId ? { skillId } : {}),
      workingDirectory,
      updatedAt: Date.now(),
    };
    await this.persistProviderSessions();
  }

  async clearProviderSession(conversationId: string, laneId: LaneId): Promise<void> {
    const sessions = this.providerSessions[conversationId];
    if (!sessions?.[laneId]) return;
    delete sessions[laneId];
    if (!Object.keys(sessions).length) delete this.providerSessions[conversationId];
    await this.persistProviderSessions();
  }

  async setSkill(id: string, skillId?: string): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation) return undefined;
    if (skillId) conversation.skillId = skillId;
    else delete conversation.skillId;
    conversation.updatedAt = Date.now();
    await this.persist();
    return conversation;
  }

  async setRouting(
    id: string,
    laneId: LaneId,
    seat: SeatId,
    effort: EffortId,
    permission: PermissionMode,
    skillId?: string,
  ): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation) return undefined;
    conversation.laneId = laneId;
    conversation.seat = seat;
    conversation.effort = effort;
    if (skillId) conversation.skillId = skillId;
    else delete conversation.skillId;
    conversation.permission = permission;
    if (permission === 'write') conversation.writeConsent = { at: Date.now(), target: conversation.target };
    else delete conversation.writeConsent;
    conversation.updatedAt = Date.now();
    await this.persist();
    return conversation;
  }

  private async persist(): Promise<void> {
    this.conversations = this.conversations
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxConversations);
    await this.state.update(storageKey, this.conversations);
    const retained = new Set(this.conversations.map((conversation) => conversation.id));
    for (const conversationId of Object.keys(this.providerSessions)) {
      if (!retained.has(conversationId)) delete this.providerSessions[conversationId];
    }
    await this.persistProviderSessions();
  }

  private async persistProviderSessions(): Promise<void> {
    await this.state.update(providerStorageKey, this.providerSessions);
  }
}
