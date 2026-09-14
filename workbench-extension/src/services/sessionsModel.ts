import type { Conversation } from '../domain.js';

export type SessionScope =
  | { kind: 'orchestrator' }
  | { kind: 'project'; projectId: string; projectName?: string };

export interface SessionListItem {
  id: string;
  title: string;
  scopeLabel: string;
  relativeTime: string;
  laneLabel: string;
  archived: boolean;
  active: boolean;
  updatedAt: number;
}

export interface SessionsViewModel {
  orchestrator: SessionListItem[];
  projects: Array<{ projectId: string; projectName: string; sessions: SessionListItem[] }>;
  archived: SessionListItem[];
}

function isArchived(conversation: Conversation): boolean {
  return typeof conversation.archivedAt === 'number';
}

function scopeOf(conversation: Conversation): SessionScope {
  if (conversation.kind === 'orchestrator' || conversation.target.kind === 'general') {
    return { kind: 'orchestrator' };
  }
  return { kind: 'project', projectId: conversation.target.projectId };
}

function laneLabel(conversation: Conversation): string {
  const receipt = conversation.receipt;
  if (receipt?.modelLabel) return receipt.modelLabel;
  if (receipt?.laneName) return receipt.laneName;
  return conversation.laneId;
}

export function formatRelativeTime(when: number, now = Date.now()): string {
  const delta = Math.max(0, now - when);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(when));
}

export function buildSessionsViewModel(
  conversations: readonly Conversation[],
  activeIds: ReadonlySet<string>,
  projectNames: ReadonlyMap<string, string> = new Map(),
  now = Date.now(),
): SessionsViewModel {
  const active = conversations.filter((c) => !isArchived(c));
  const archived = conversations
    .filter(isArchived)
    .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
    .map((c) => toItem(c, activeIds, projectNames, now));

  const orchestrator = active
    .filter((c) => scopeOf(c).kind === 'orchestrator')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => toItem(c, activeIds, projectNames, now));

  const byProject = new Map<string, Conversation[]>();
  for (const conversation of active) {
    const scope = scopeOf(conversation);
    if (scope.kind !== 'project') continue;
    const list = byProject.get(scope.projectId) ?? [];
    list.push(conversation);
    byProject.set(scope.projectId, list);
  }

  const projects = [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([projectId, list]) => ({
      projectId,
      projectName: projectNames.get(projectId) ?? projectId,
      sessions: list
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => toItem(c, activeIds, projectNames, now)),
    }));

  return { orchestrator, projects, archived };
}

function toItem(
  conversation: Conversation,
  activeIds: ReadonlySet<string>,
  projectNames: ReadonlyMap<string, string>,
  now: number,
): SessionListItem {
  const scope = scopeOf(conversation);
  const scopeLabel = scope.kind === 'orchestrator'
    ? 'Orchestrator'
    : (projectNames.get(scope.projectId) ?? scope.projectId);
  return {
    id: conversation.id,
    title: conversation.title,
    scopeLabel,
    relativeTime: formatRelativeTime(conversation.updatedAt, now),
    laneLabel: laneLabel(conversation),
    archived: isArchived(conversation),
    active: activeIds.has(conversation.id),
    updatedAt: conversation.updatedAt,
  };
}

/** Default title before the first user message (or after clear). */
export function defaultSessionTitle(conversation: Pick<Conversation, 'kind' | 'target'>): string {
  if (conversation.kind === 'orchestrator' || conversation.target.kind === 'general') {
    return 'Orchestrator session';
  }
  return conversation.target.projectId;
}

export function titleFromFirstUserMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Untitled session';
}

export function isPlaceholderTitle(conversation: Conversation): boolean {
  const expected = defaultSessionTitle(conversation);
  return conversation.title === expected || conversation.title === 'New command';
}
