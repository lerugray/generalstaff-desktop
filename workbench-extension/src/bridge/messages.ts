import type { CommandTarget, EffortId, LaneId, PermissionMode, SeatId } from '../domain.js';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'new-conversation'; target: CommandTarget; laneId: LaneId; seat: SeatId; effort: EffortId; permission: PermissionMode; skillId?: string; contextPaths: string[] }
  | { type: 'update-routing'; conversationId: string; laneId: LaneId; seat: SeatId; effort: EffortId; permission: PermissionMode; skillId?: string }
  | { type: 'send-prompt'; conversationId: string; text: string }
  | { type: 'retry-run'; conversationId: string; strategy: 'auto' | 'transcript' }
  | { type: 'answer-decision'; conversationId: string; decisionId: string; optionId: string }
  | { type: 'stop-run'; conversationId: string }
  | { type: 'open-project'; projectId: string }
  | { type: 'open-terminal'; target?: CommandTarget }
  | { type: 'open-file'; path: string }
  | { type: 'pick-context'; target: CommandTarget }
  | { type: 'choose-root' }
  | { type: 'save-note'; projectId: string; text: string };

const laneIds = new Set<LaneId>(['codex', 'claude', 'kimi', 'cline', 'cursor', 'grok']);
const seatIds = new Set<SeatId>(['orchestrate', 'build', 'review', 'verify', 'assist']);
const permissionModes = new Set<PermissionMode>(['read', 'write']);
const effortIds = new Set<EffortId>(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function optionalSkillId(value: unknown): string | undefined | false {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value) ? value : false;
}

function commandTarget(value: unknown): CommandTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'general' && Object.keys(value).length === 1) return { kind: 'general' };
  if (value.kind === 'project' && isShortString(value.projectId, 160) && Object.keys(value).length === 2) {
    return { kind: 'project', projectId: value.projectId };
  }
  return undefined;
}

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'ready':
    case 'refresh':
      return { type: value.type };
    case 'new-conversation': {
      const skillId = optionalSkillId(value.skillId);
      const target = commandTarget(value.target);
      if (
        target &&
        typeof value.laneId === 'string' &&
        laneIds.has(value.laneId as LaneId) &&
        typeof value.seat === 'string' &&
        seatIds.has(value.seat as SeatId) &&
        typeof value.effort === 'string' &&
        effortIds.has(value.effort as EffortId) &&
        typeof value.permission === 'string' &&
        permissionModes.has(value.permission as PermissionMode) &&
        skillId !== false
      ) {
        const contextPaths = Array.isArray(value.contextPaths)
          ? value.contextPaths.filter((item): item is string => isShortString(item, 4096)).slice(0, 12)
          : [];
        if (Array.isArray(value.contextPaths) && contextPaths.length !== value.contextPaths.length) return undefined;
        return {
          type: value.type,
          target,
          laneId: value.laneId as LaneId,
          seat: value.seat as SeatId,
          effort: value.effort as EffortId,
          permission: value.permission as PermissionMode,
          ...(skillId ? { skillId } : {}),
          contextPaths,
        };
      }
      return undefined;
    }
    case 'update-routing': {
      const skillId = optionalSkillId(value.skillId);
      if (
        isShortString(value.conversationId, 160) &&
        typeof value.laneId === 'string' && laneIds.has(value.laneId as LaneId) &&
        typeof value.seat === 'string' && seatIds.has(value.seat as SeatId) &&
        typeof value.effort === 'string' && effortIds.has(value.effort as EffortId) &&
        typeof value.permission === 'string' && permissionModes.has(value.permission as PermissionMode) &&
        skillId !== false
      ) {
        return {
          type: value.type,
          conversationId: value.conversationId,
          laneId: value.laneId as LaneId,
          seat: value.seat as SeatId,
          effort: value.effort as EffortId,
          permission: value.permission as PermissionMode,
          ...(skillId ? { skillId } : {}),
        };
      }
      return undefined;
    }
    case 'send-prompt':
      if (isShortString(value.conversationId, 160) && isShortString(value.text, 80_000)) {
        return { type: value.type, conversationId: value.conversationId, text: value.text };
      }
      return undefined;
    case 'retry-run':
      if (
        isShortString(value.conversationId, 160) &&
        (value.strategy === 'auto' || value.strategy === 'transcript')
      ) {
        return { type: value.type, conversationId: value.conversationId, strategy: value.strategy };
      }
      return undefined;
    case 'answer-decision':
      if (
        isShortString(value.conversationId, 160) &&
        isShortString(value.decisionId, 160) &&
        isShortString(value.optionId, 160)
      ) {
        return {
          type: value.type,
          conversationId: value.conversationId,
          decisionId: value.decisionId,
          optionId: value.optionId,
        };
      }
      return undefined;
    case 'stop-run':
      if (isShortString(value.conversationId, 160)) {
        return { type: value.type, conversationId: value.conversationId };
      }
      return undefined;
    case 'open-project':
      if (isShortString(value.projectId, 160)) {
        return { type: value.type, projectId: value.projectId };
      }
      return undefined;
    case 'open-terminal':
      if (value.target === undefined || commandTarget(value.target)) {
        return value.target === undefined
          ? { type: value.type }
          : { type: value.type, target: commandTarget(value.target) as CommandTarget };
      }
      return undefined;
    case 'open-file':
      if (isShortString(value.path, 4096)) {
        return { type: value.type, path: value.path };
      }
      return undefined;
    case 'pick-context':
      if (commandTarget(value.target)) {
        return { type: value.type, target: commandTarget(value.target) as CommandTarget };
      }
      return undefined;
    case 'choose-root':
      return { type: value.type };
    case 'save-note':
      if (isShortString(value.projectId, 160) && typeof value.text === 'string' && value.text.length <= 10_000) {
        return { type: value.type, projectId: value.projectId, text: value.text };
      }
      return undefined;
    default:
      return undefined;
  }
}
