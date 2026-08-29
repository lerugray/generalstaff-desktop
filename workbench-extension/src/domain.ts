export type SeatId = 'orchestrate' | 'build' | 'review' | 'verify' | 'assist';

export type LaneId =
  | 'codex'
  | 'claude'
  | 'kimi'
  | 'cline'
  | 'cursor'
  | 'grok'
  | 'glm-ollama'
  | 'glm-ollama-flash';

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

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  status?: 'streaming' | 'complete' | 'error';
  attempt?: 'retry';
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
  kind: 'document' | 'image' | 'data';
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
  receipt?: ConversationReceipt;
}

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'assistant-delta'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'error'; text: string }
  | { type: 'complete'; receipt: ConversationReceipt };
