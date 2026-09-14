export type SeatId = 'orchestrate' | 'build' | 'review' | 'verify' | 'assist';

export type LaneId =
  | 'codex'
  | 'claude'
  | 'kimi'
  | 'cline'
  | 'cursor'
  | 'grok'
  | 'glm-ollama'
  | 'glm-ollama-flash'
  | 'deepseek-ollama'
  // CC-door seats: the real Claude Code binary against Ollama Cloud's Anthropic-compatible
  // endpoint, in their own config directory. Agentic, and they carry the operator's skills,
  // rules, memory and hooks; the direct-API lanes above cannot.
  | 'deepseek-ollama-cc'
  | 'glm-ollama-cc';

export type LaneState = 'available' | 'missing' | 'checking' | 'unavailable';

export type PermissionMode = 'read' | 'write';

export type CommandTarget =
  | { kind: 'general' }
  | { kind: 'project'; projectId: string };

export type RunContinuity = 'new' | 'native' | 'transcript';

export type EffortId = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface EffortOption {
  id: EffortId;
  label: string;
}

/**
 * Context ceiling for a seat (M3c). Single source of truth lives in
 * `services/contextCeiling.ts` and is attached at discovery — the webview never invents it.
 */
export type ContextCeilingProvenance = 'stated' | 'native' | 'assumed-default' | 'unknown';

export interface ContextCeiling {
  tokens: number | null;
  provenance: ContextCeilingProvenance;
  modelLabel: string;
}

export interface LaneSummary {
  id: LaneId;
  runner: LaneId;
  name: string;
  detail: string;
  evidenceLabel: string;
  state: LaneState;
  executable?: string;
  roles: SeatId[];
  permissions: PermissionMode[];
  efforts: EffortOption[];
  defaultEffort: EffortId;
  /** Token ceiling Claude Code / the seat will run with, plus provenance. */
  contextCeiling: ContextCeiling;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  fileCount: number;
  characterCount: number;
}

export interface PrivateCapabilitySummary {
  id: 'headroom' | 'lane-desk';
  name: string;
  detail: string;
  state: 'available' | 'missing';
  nativeLanes: LaneId[];
  fallbackLanes: LaneId[];
}

export interface ArtifactSummary {
  label: string;
  path: string;
  kind: 'brief' | 'document' | 'preview' | 'image' | 'pdf';
  changedAt?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  repoPath?: string;
  statePath: string;
  mission: string;
  pending: number;
  inProgress: number;
  needsReview: number;
  completed: number;
  topTask?: string;
  lastChangedAt?: number;
  artifacts: ArtifactSummary[];
}

export interface AttentionItem {
  id: string;
  projectId?: string;
  kind: 'decision' | 'review' | 'blocked' | 'task' | 'ping';
  title: string;
  detail: string;
  when?: string;
}

export interface ActivityItem {
  id: string;
  projectId?: string;
  tone: 'good' | 'warn' | 'quiet';
  title: string;
  detail: string;
  when?: string;
}

export interface FleetSnapshot {
  generatedAt: number;
  rootPath: string;
  projects: ProjectSummary[];
  attention: AttentionItem[];
  activity: ActivityItem[];
  lanes: LaneSummary[];
  skills: SkillSummary[];
  capabilities: PrivateCapabilitySummary[];
}

/** Ordered transcript blocks for one assistant turn (M3e — Claude Code desktop shape). */
export type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool';
      id?: string;
      name: string;
      summary: string;
      detail?: string;
      status?: 'running' | 'ok' | 'error';
      /** Collapsed one-line preview (clipOneLine). */
      resultPreview?: string;
      /** Expanded body — newlines preserved, scroll-capped in CSS (LOOK D1). */
      result?: string;
    };

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  status?: 'streaming' | 'complete' | 'error';
  attempt?: 'retry';
  /** Mid-run steering chip: queued → sent to seat → delivered (observed). */
  delivery?: 'queued' | 'sent' | 'delivered';
  /** When set, the webview renders these in order instead of flattening to prose-only. */
  blocks?: TranscriptBlock[];
}

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface ConversationDecision {
  id: string;
  messageId: string;
  title: string;
  question: string;
  options: DecisionOption[];
  createdAt: number;
  answeredAt?: number;
  answerOptionId?: string;
}

export interface ConversationReceipt {
  laneId: LaneId;
  laneName: string;
  seat: SeatId;
  effort: EffortId;
  target: CommandTarget;
  modelLabel: string;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  stopped: boolean;
  permission: PermissionMode;
  workingDirectory: string;
  evidence: string[];
  continuity: RunContinuity;
  skillId?: string;
  skillName?: string;
  capabilities?: string[];
  consentedAt?: number;
}

export interface ConversationContextItem {
  label: string;
  path: string;
  kind: 'document' | 'image' | 'data' | 'folder';
}

export interface Conversation {
  id: string;
  kind: 'orchestrator' | 'command';
  title: string;
  target: CommandTarget;
  laneId: LaneId;
  seat: SeatId;
  effort: EffortId;
  skillId?: string;
  permission: PermissionMode;
  writeConsent?: { at: number; target: CommandTarget };
  context: ConversationContextItem[];
  messages: ConversationMessage[];
  decisions: ConversationDecision[];
  createdAt: number;
  updatedAt: number;
  /** When set, the session is archived (listed under Archived, not in the active scopes). */
  archivedAt?: number;
  receipt?: ConversationReceipt;
}

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'assistant-delta'; text: string; turnId?: string }
  | { type: 'thinking'; text: string; turnId?: string }
  | {
      type: 'tool';
      text: string;
      name?: string;
      summary?: string;
      detail?: string;
      toolUseId?: string;
      turnId?: string;
    }
  | {
      type: 'tool-result';
      toolUseId?: string;
      ok: boolean;
      /** Collapsed one-line preview. */
      preview: string;
      /** Full result body with newlines (capped); drives the expanded card. */
      body?: string;
      turnId?: string;
    }
  | { type: 'error'; text: string }
  | { type: 'complete'; receipt: ConversationReceipt }
  /**
   * Live context occupancy from Claude Code stream-json (M3c/M3e).
   * `usedTokens` is always the latest assistant-turn occupancy — never the result envelope's
   * cumulative session spend. Optional `sessionSpend` arrives only from the final result.
   */
  | { type: 'context-usage'; usedTokens: number; sessionSpend?: number }
  | { type: 'session-spend'; tokens: number }
  /** Claude-protocol stream-json turn finished; safe to write a held follow-up on the same stdin. */
  | { type: 'turn-boundary' };
