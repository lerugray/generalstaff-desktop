import type {
  LaneDeskHostId,
  LaneDeskLaneState,
  LaneDeskStatusEnvelope,
} from './services/laneDeskStatus.js';

export type LaneCounterColor = 'iron-red' | 'dust' | 'ink' | 'quiet' | 'amber';

export type LanesPanelRowKind = 'lane' | 'host-unreachable';

export interface LanesPanelRow {
  kind: LanesPanelRowKind;
  key: string;
  id: string;
  host: string;
  /** Model/door column: prefer model/door from payload, else repo (founding closed mapping). */
  modelDoor: string;
  state: string;
  elapsed: string;
  sha: string;
  dirty: boolean;
  sentinel: string;
  lastLogLine: string;
  counterColor: LaneCounterColor;
  attention: boolean;
  latencyMs?: number;
  message?: string;
}

export interface LanesPanelModel {
  ok: boolean;
  partial: boolean;
  stale: boolean;
  generatedAt?: string;
  omitted?: number;
  counts: Record<string, number>;
  badgeCount: number;
  rows: LanesPanelRow[];
  hostSummaries: Array<{
    host: string;
    ok: boolean;
    latencyMs?: number;
    code?: string;
    message?: string;
  }>;
  capabilityMissing?: string;
  errorDetail?: string;
}

const ATTENTION_STATES = new Set<string>(['failed', 'inconsistent', 'stalled']);

const STATE_SORT_RANK: Record<string, number> = {
  inconsistent: 0,
  failed: 1,
  stalled: 2,
  orphaned: 3,
  running: 4,
  done: 5,
  unknown: 6,
};

const EXPECTED_HOSTS: LaneDeskHostId[] = ['mac', 'home-pc'];

export function laneCounterColor(state: string): LaneCounterColor {
  switch (state) {
    case 'failed':
    case 'inconsistent':
      return 'iron-red';
    case 'stalled':
    case 'orphaned':
      return 'dust';
    case 'running':
      return 'ink';
    case 'done':
      return 'quiet';
    default:
      return 'quiet';
  }
}

export function isAttentionLaneState(state: string): boolean {
  return ATTENTION_STATES.has(state);
}

/** Badge = failed + inconsistent + stalled (M1 brief; no OS notification). */
export function attentionBadgeCount(envelope: LaneDeskStatusEnvelope): number {
  const lanes = envelope.lanes ?? [];
  return lanes.reduce((total, lane) => total + (isAttentionLaneState(String(lane.state)) ? 1 : 0), 0);
}

function formatElapsed(ageMin: number | undefined): string {
  if (typeof ageMin !== 'number' || !Number.isFinite(ageMin)) return '—';
  if (ageMin < 1) return '<1m';
  if (ageMin < 60) return `${Math.round(ageMin)}m`;
  const hours = Math.floor(ageMin / 60);
  const minutes = Math.round(ageMin % 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSentinel(lane: {
  state: string;
  sentinels?: { log?: boolean; status?: boolean; done?: boolean };
}): string {
  if (lane.sentinels) {
    const parts = [
      lane.sentinels.log ? 'run.log' : null,
      lane.sentinels.status ? 'run.status' : null,
      lane.sentinels.done ? 'run.done' : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  switch (lane.state as LaneDeskLaneState | string) {
    case 'running':
      return 'run.log · run.status';
    case 'done':
      return 'run.done';
    case 'failed':
      return 'run.status';
    case 'stalled':
      return 'run.log';
    case 'inconsistent':
      return 'sentinel mismatch';
    case 'orphaned':
      return 'orphan';
    default:
      return 'unknown';
  }
}

function modelDoorFor(lane: {
  model?: string;
  door?: string;
  repo?: string;
}): string {
  if (lane.model && lane.door) return `${lane.model} · ${lane.door}`;
  if (lane.model) return lane.model;
  if (lane.door) return lane.door;
  return lane.repo?.trim() || '—';
}

function sortLaneRows(rows: LanesPanelRow[]): LanesPanelRow[] {
  return [...rows].sort((left, right) => {
    const leftRank = STATE_SORT_RANK[left.state] ?? 90;
    const rightRank = STATE_SORT_RANK[right.state] ?? 90;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.id.localeCompare(right.id) || left.host.localeCompare(right.host);
  });
}

/**
 * Build the read-only Lanes situation-map model from a lanes_status envelope.
 * Tolerates partial envelopes: unreachable hosts become host-level rows; lane
 * rows from the live host still render.
 */
export function buildLanesPanelModel(
  envelope: LaneDeskStatusEnvelope,
  options: { stale?: boolean; capabilityMissing?: string; errorDetail?: string } = {},
): LanesPanelModel {
  const hosts = envelope.hosts ?? {};
  const hostSummaries: LanesPanelModel['hostSummaries'] = EXPECTED_HOSTS.map((host) => {
    const status = hosts[host];
    if (!status) {
      const mentioned = (envelope.errors ?? []).some((error) => error.host === host);
      return {
        host,
        ok: false,
        ...(mentioned ? { message: 'unreachable' } : { message: 'no probe result' }),
      };
    }
    return {
      host,
      ok: status.ok,
      ...(typeof status.latency_ms === 'number' ? { latencyMs: status.latency_ms } : {}),
      ...(status.code ? { code: status.code } : {}),
      ...(status.message ? { message: status.message } : {}),
    };
  });

  // Also surface any unexpected host keys from the envelope.
  for (const [host, status] of Object.entries(hosts)) {
    if (EXPECTED_HOSTS.includes(host as LaneDeskHostId) || !status) continue;
    hostSummaries.push({
      host,
      ok: status.ok,
      ...(typeof status.latency_ms === 'number' ? { latencyMs: status.latency_ms } : {}),
      ...(status.code ? { code: status.code } : {}),
      ...(status.message ? { message: status.message } : {}),
    });
  }

  const unreachableRows: LanesPanelRow[] = hostSummaries
    .filter((host) => !host.ok)
    .map((host) => ({
      kind: 'host-unreachable' as const,
      key: `host:${host.host}`,
      id: host.host,
      host: host.host,
      modelDoor: '—',
      state: 'unreachable',
      elapsed: '—',
      sha: '—',
      dirty: false,
      sentinel: host.code || 'host down',
      lastLogLine: host.message || 'unreachable',
      counterColor: 'amber' as const,
      attention: true,
      ...(typeof host.latencyMs === 'number' ? { latencyMs: host.latencyMs } : {}),
      ...(host.message ? { message: host.message } : {}),
    }));

  const laneRows: LanesPanelRow[] = (envelope.lanes ?? []).map((lane) => {
    const state = String(lane.state || 'unknown');
    return {
      kind: 'lane',
      key: `${lane.host}:${lane.id}`,
      id: lane.id,
      host: String(lane.host),
      modelDoor: modelDoorFor(lane),
      state,
      elapsed: formatElapsed(lane.age_min),
      sha: lane.sha?.trim() || '—',
      dirty: Boolean(lane.dirty),
      sentinel: formatSentinel(lane.sentinels ? { state, sentinels: lane.sentinels } : { state }),
      lastLogLine: lane.last_log_line?.trim() || '',
      counterColor: laneCounterColor(state),
      attention: isAttentionLaneState(state),
    };
  });

  const counts: Record<string, number> = {};
  if (envelope.counts) {
    for (const [key, value] of Object.entries(envelope.counts)) {
      if (typeof value === 'number') counts[key] = value;
    }
  }

  const sortedLanes = sortLaneRows(laneRows);
  // Attention first overall: unreachable hosts, then sorted lanes.
  const rows = [...unreachableRows, ...sortedLanes].slice(0, 50);

  return {
    ok: envelope.ok === true,
    partial: envelope.partial === true || unreachableRows.length > 0,
    stale: Boolean(options.stale),
    ...(envelope.generated_at ? { generatedAt: envelope.generated_at } : {}),
    ...(typeof envelope.omitted === 'number' ? { omitted: envelope.omitted } : {}),
    counts,
    badgeCount: attentionBadgeCount(envelope),
    rows,
    hostSummaries,
    ...(options.capabilityMissing ? { capabilityMissing: options.capabilityMissing } : {}),
    ...(options.errorDetail ? { errorDetail: options.errorDetail } : {}),
  };
}

export function emptyLanesPanelModel(detail: string, missing = false): LanesPanelModel {
  return {
    ok: false,
    partial: false,
    stale: false,
    counts: {},
    badgeCount: 0,
    rows: [],
    hostSummaries: EXPECTED_HOSTS.map((host) => ({ host, ok: false, message: detail })),
    ...(missing ? { capabilityMissing: detail } : { errorDetail: detail }),
  };
}
