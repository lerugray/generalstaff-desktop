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
import {
  defaultSessionTitle,
  isPlaceholderTitle,
  titleFromFirstUserMessage,
} from './sessionsModel.js';

export const conversationsV1Key = 'generalstaff.conversations.v1';
export const conversationsV2Key = 'generalstaff.conversations.v2';
const providerStorageKey = 'generalstaff.providerSessions.v1';
const activeSessionsKey = 'generalstaff.activeSessions.v2';
const maxConversations = 40;

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

export interface ActiveSessionsState {
  general?: string;
  projects: Record<string, string>;
}

type ProviderSessionMap = Record<string, Partial<Record<LaneId, ProviderSession>>>;

function restoredTarget(conversation: StoredConversation): CommandTarget {
  if (conversation.target?.kind === 'general') return { kind: 'general' };
  if (conversation.target?.kind === 'project' && conversation.target.projectId) {
    return { kind: 'project', projectId: conversation.target.projectId };
  }
  return { kind: 'project', projectId: conversation.projectId ?? 'unavailable-project' };
}

function normalizeConversation(stored: StoredConversation, recoveredInterrupted: { value: boolean }): Conversation {
  const { projectId: _legacyProjectId, writeConsent, ...conversation } = stored;
  const target = restoredTarget(stored);
  return {
    ...conversation,
    kind: conversation.kind ?? 'command',
    title: conversation.title || defaultSessionTitle({ kind: conversation.kind ?? 'command', target }),
    target,
    ...(writeConsent ? { writeConsent: { at: writeConsent.at, target } } : {}),
    permission: conversation.permission ?? 'read',
    effort: conversation.effort ?? 'default',
    context: conversation.context ?? [],
    decisions: conversation.decisions ?? [],
    ...(typeof conversation.archivedAt === 'number' ? { archivedAt: conversation.archivedAt } : {}),
    messages: (conversation.messages ?? []).map((message) => {
      if (message.status !== 'streaming') return message;
      recoveredInterrupted.value = true;
      return {
        ...message,
        text: message.text.trim()
          ? `${message.text}\n\nThe Workbench closed before this run completed.`
          : 'The Workbench closed before this run completed.',
        status: 'error' as const,
      };
    }),
  };
}

/** One-way v1 → v2 migration. Preserves every conversation; adds no archives. */
export function migrateV1Conversations(v1: StoredConversation[]): Conversation[] {
  const recovered = { value: false };
  return v1.map((stored) => normalizeConversation(stored, recovered));
}

export class ConversationStore {
  private conversations: Conversation[];
  private providerSessions: ProviderSessionMap;
  private active: ActiveSessionsState;
  private migratedFromV1 = false;

  constructor(private readonly state: vscode.Memento) {
    const recoveredInterrupted = { value: false };
    const v2 = state.get<StoredConversation[]>(conversationsV2Key);
    if (v2) {
      this.conversations = v2.map((stored) => normalizeConversation(stored, recoveredInterrupted));
    } else {
      const v1 = state.get<StoredConversation[]>(conversationsV1Key, []);
      this.conversations = migrateV1Conversations(v1);
      this.migratedFromV1 = v1.length > 0;
    }
    this.providerSessions = state.get<ProviderSessionMap>(providerStorageKey, {});
    this.active = state.get<ActiveSessionsState>(activeSessionsKey, { projects: {} });
    if (!this.active.projects) this.active.projects = {};
    if (recoveredInterrupted.value || this.migratedFromV1) void this.persist();
  }

  didMigrateFromV1(): boolean {
    return this.migratedFromV1;
  }

  all(): Conversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((conversation) => conversation.id === id);
  }

  activeIds(): Set<string> {
    const ids = new Set<string>();
    if (this.active.general) ids.add(this.active.general);
    for (const id of Object.values(this.active.projects)) ids.add(id);
    return ids;
  }

  activeGeneralId(): string | undefined {
    return this.active.general;
  }

  activeProjectId(projectId: string): string | undefined {
    return this.active.projects[projectId];
  }

  async setActiveGeneral(id: string | undefined): Promise<void> {
    if (id) this.active.general = id;
    else delete this.active.general;
    await this.persistActive();
  }

  async setActiveProject(projectId: string, id: string | undefined): Promise<void> {
    if (id) this.active.projects[projectId] = id;
    else delete this.active.projects[projectId];
    await this.persistActive();
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
      kind: 'command',
      title: defaultSessionTitle({ kind: 'command', target }),
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
    if (target.kind === 'project') await this.setActiveProject(target.projectId, conversation.id);
    await this.persist();
    return conversation;
  }

  async createOrchestrator(
    laneId: LaneId,
    effort: EffortId,
    permission: PermissionMode = 'read',
  ): Promise<Conversation> {
    const now = Date.now();
    const target: CommandTarget = { kind: 'general' };
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      kind: 'orchestrator',
      title: defaultSessionTitle({ kind: 'orchestrator', target }),
      target,
      laneId,
      seat: 'orchestrate',
      effort,
      permission,
      ...(permission === 'write' ? { writeConsent: { at: now, target } } : {}),
      context: [],
      messages: [],
      decisions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.unshift(conversation);
    await this.setActiveGeneral(conversation.id);
    await this.persist();
    return conversation;
  }

  async promoteToOrchestrator(id: string): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation || conversation.target.kind !== 'general') return undefined;
    conversation.kind = 'orchestrator';
    conversation.title = defaultSessionTitle(conversation);
    conversation.seat = 'orchestrate';
    conversation.updatedAt = Date.now();
    await this.setActiveGeneral(conversation.id);
    await this.persist();
    return conversation;
  }

  async rename(id: string, title: string): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation) return undefined;
    const next = title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!next) return undefined;
    conversation.title = next;
    conversation.updatedAt = Date.now();
    await this.persist();
    return conversation;
  }

  async archive(id: string): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation || conversation.archivedAt) return conversation;
    conversation.archivedAt = Date.now();
    conversation.updatedAt = Date.now();
    await this.clearActiveIf(id);
    await this.persist();
    return conversation;
  }

  async unarchive(id: string): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation || conversation.archivedAt === undefined) return conversation;
    delete conversation.archivedAt;
    conversation.updatedAt = Date.now();
    await this.persist();
    return conversation;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.conversations.findIndex((conversation) => conversation.id === id);
    if (index < 0) return false;
    this.conversations.splice(index, 1);
    delete this.providerSessions[id];
    await this.clearActiveIf(id);
    await this.persist();
    return true;
  }

  async append(id: string, message: Omit<ConversationMessage, 'id' | 'createdAt'>): Promise<Conversation | undefined> {
    const conversation = this.get(id);
    if (!conversation) return undefined;
    conversation.messages.push({ ...message, id: crypto.randomUUID(), createdAt: Date.now() });
    if (message.role === 'user' && isPlaceholderTitle(conversation)) {
      conversation.title = titleFromFirstUserMessage(message.text);
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

  private async clearActiveIf(id: string): Promise<void> {
    if (this.active.general === id) delete this.active.general;
    for (const [projectId, activeId] of Object.entries(this.active.projects)) {
      if (activeId === id) delete this.active.projects[projectId];
    }
    await this.persistActive();
  }

  private async persist(): Promise<void> {
    const sorted = [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const pinned = this.activeIds();
    const kept: Conversation[] = [];
    for (const conversation of sorted) {
      if (pinned.has(conversation.id)) kept.push(conversation);
    }
    for (const conversation of sorted) {
      if (kept.length >= maxConversations) break;
      if (!pinned.has(conversation.id)) kept.push(conversation);
    }
    this.conversations = kept;
    await this.state.update(conversationsV2Key, this.conversations);
    const retained = new Set(this.conversations.map((conversation) => conversation.id));
    for (const conversationId of Object.keys(this.providerSessions)) {
      if (!retained.has(conversationId)) delete this.providerSessions[conversationId];
    }
    await this.persistProviderSessions();
    await this.persistActive();
  }

  private async persistProviderSessions(): Promise<void> {
    await this.state.update(providerStorageKey, this.providerSessions);
  }

  private async persistActive(): Promise<void> {
    await this.state.update(activeSessionsKey, this.active);
  }
}
