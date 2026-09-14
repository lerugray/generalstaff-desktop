import type { LaneId, LaneSummary, PermissionMode } from '../domain.js';
import {
  anthropicWeeklyPrefersOllama,
  type AnthropicWeeklyUsage,
} from './claudeUsage.js';

export const PREFERRED_OLLAMA_ORCHESTRATOR_LANE: LaneId = 'glm-ollama-cc';

export interface OrchestratorSeatDecision {
  /** Auto-pick this lane, or ask the operator. */
  action: 'use' | 'prompt';
  laneId?: LaneId;
  /** One-line desk reason (without the "Seat: …" prefix). */
  reason: string;
}

export function decideOrchestratorSeat(
  usage: AnthropicWeeklyUsage | undefined,
  availableLaneIds: readonly LaneId[],
): OrchestratorSeatDecision {
  const glmReady = availableLaneIds.includes(PREFERRED_OLLAMA_ORCHESTRATOR_LANE);
  if (anthropicWeeklyPrefersOllama(usage) && glmReady) {
    if (usage === undefined) {
      return {
        action: 'use',
        laneId: PREFERRED_OLLAMA_ORCHESTRATOR_LANE,
        reason: 'Anthropic weekly usage unavailable; preferring Ollama GLM',
      };
    }
    return {
      action: 'use',
      laneId: PREFERRED_OLLAMA_ORCHESTRATOR_LANE,
      reason: `Anthropic weekly ${Math.round(usage.utilizationPercent)}% used; preferring Ollama GLM`,
    };
  }

  if (usage === undefined) {
    return {
      action: 'prompt',
      reason: 'Anthropic weekly usage unavailable; pick a seat',
    };
  }

  return {
    action: 'prompt',
    reason: `Anthropic weekly ${Math.round(usage.utilizationPercent)}% used; pick a seat`,
  };
}

export function formatSeatChoiceNotice(laneName: string, reason: string): string {
  return `Seat: ${laneName} — ${reason}`;
}

export function sessionPermissionChoices(): Array<{
  label: string;
  description: string;
  permission: PermissionMode;
}> {
  return [
    {
      label: 'Read + write (recommended)',
      description: 'Orchestrator may edit the repository for this session',
      permission: 'write',
    },
    {
      label: 'Read-only',
      description: 'No file, configuration, or git changes',
      permission: 'read',
    },
  ];
}

export function orchestratorReadyLane(
  item: Pick<LaneSummary, 'state' | 'roles' | 'permissions'>,
): boolean {
  return item.state === 'available'
    && item.roles.includes('orchestrate')
    && item.permissions.includes('read');
}
