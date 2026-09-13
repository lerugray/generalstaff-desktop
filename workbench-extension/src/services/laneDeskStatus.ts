import { execFile } from 'node:child_process';
import type { PrivateRuntimeProfile } from './privateRuntime.js';
import { processInvocation } from './processInvocation.js';

export type LaneDeskHostId = 'mac' | 'home-pc';

export type LaneDeskLaneState =
  | 'running'
  | 'stalled'
  | 'done'
  | 'failed'
  | 'orphaned'
  | 'inconsistent'
  | 'unknown';

export interface LaneDeskHostStatus {
  ok: boolean;
  latency_ms?: number;
  code?: string;
  message?: string;
}

export interface LaneDeskLaneRow {
  id: string;
  host: LaneDeskHostId | string;
  repo?: string;
  state: LaneDeskLaneState | string;
  sha?: string;
  dirty?: boolean;
  age_min?: number;
  /** Optional; bind only when present in the status payload (never path-open). */
  last_log_line?: string;
  model?: string;
  door?: string;
  sentinels?: {
    log?: boolean;
    status?: boolean;
    done?: boolean;
  };
}

export interface LaneDeskStatusCounts {
  running?: number;
  stalled?: number;
  done?: number;
  failed?: number;
  orphaned?: number;
  inconsistent?: number;
  unknown?: number;
  total?: number;
}

export interface LaneDeskStatusEnvelope {
  ok: boolean;
  partial?: boolean;
  generated_at?: string;
  hosts?: Partial<Record<LaneDeskHostId | string, LaneDeskHostStatus>>;
  counts?: LaneDeskStatusCounts;
  lanes?: LaneDeskLaneRow[];
  errors?: Array<{ code?: string; message?: string; host?: string }>;
  omitted?: number;
}

export type LaneDeskStatusResult =
  | { kind: 'ok'; envelope: LaneDeskStatusEnvelope; stale?: boolean }
  | { kind: 'missing'; detail: string }
  | { kind: 'error'; detail: string; envelope?: LaneDeskStatusEnvelope };

const STATUS_TIMEOUT_MS = 6_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asHostStatus(value: unknown): LaneDeskHostStatus | undefined {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return undefined;
  return {
    ok: value.ok,
    ...(typeof value.latency_ms === 'number' ? { latency_ms: value.latency_ms } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

function asLaneRow(value: unknown): LaneDeskLaneRow | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.host !== 'string') return undefined;
  const sentinels = isRecord(value.sentinels)
    ? {
      ...(typeof value.sentinels.log === 'boolean' ? { log: value.sentinels.log } : {}),
      ...(typeof value.sentinels.status === 'boolean' ? { status: value.sentinels.status } : {}),
      ...(typeof value.sentinels.done === 'boolean' ? { done: value.sentinels.done } : {}),
    }
    : undefined;
  return {
    id: value.id,
    host: value.host,
    state: typeof value.state === 'string' ? value.state : 'unknown',
    ...(typeof value.repo === 'string' ? { repo: value.repo } : {}),
    ...(typeof value.sha === 'string' ? { sha: value.sha } : {}),
    ...(typeof value.dirty === 'boolean' ? { dirty: value.dirty } : {}),
    ...(typeof value.age_min === 'number' ? { age_min: value.age_min } : {}),
    ...(typeof value.last_log_line === 'string' ? { last_log_line: value.last_log_line } : {}),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.door === 'string' ? { door: value.door } : {}),
    ...(sentinels && Object.keys(sentinels).length ? { sentinels } : {}),
  };
}

/** Parse a lanes_status / `status --json` envelope without inventing fields. */
export function parseLaneDeskStatus(raw: unknown): LaneDeskStatusEnvelope {
  if (!isRecord(raw)) {
    return { ok: false, lanes: [], errors: [{ code: 'invalid_envelope', message: 'Status payload was not an object.' }] };
  }
  const hostsIn = isRecord(raw.hosts) ? raw.hosts : {};
  const hosts: LaneDeskStatusEnvelope['hosts'] = {};
  for (const [key, value] of Object.entries(hostsIn)) {
    const host = asHostStatus(value);
    if (host) hosts[key] = host;
  }
  const lanes = Array.isArray(raw.lanes)
    ? raw.lanes.map(asLaneRow).filter((row): row is LaneDeskLaneRow => Boolean(row))
    : [];
  const counts = isRecord(raw.counts) ? raw.counts as LaneDeskStatusCounts : undefined;
  const errors = Array.isArray(raw.errors)
    ? raw.errors.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      return [{
        ...(typeof entry.code === 'string' ? { code: entry.code } : {}),
        ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
        ...(typeof entry.host === 'string' ? { host: entry.host } : {}),
      }];
    })
    : [];
  return {
    ok: raw.ok === true,
    ...(raw.partial === true ? { partial: true } : {}),
    ...(typeof raw.generated_at === 'string' ? { generated_at: raw.generated_at } : {}),
    ...(Object.keys(hosts).length ? { hosts } : {}),
    ...(counts ? { counts } : {}),
    lanes,
    ...(errors.length ? { errors } : {}),
    ...(typeof raw.omitted === 'number' ? { omitted: raw.omitted } : {}),
  };
}

export function laneDeskCliAvailable(profile: PrivateRuntimeProfile): boolean {
  return Boolean(
    profile.laneDeskCli &&
    profile.laneDeskConfig &&
    profile.capabilities.some((capability) => capability.id === 'lane-desk' && capability.state === 'available'),
  );
}

/**
 * One-shot CLI probe for the Lanes panel — same transport seats already use
 * (`python3 lane_desk.py --config … status --json`). Does not hold an MCP connection.
 */
export async function fetchLaneDeskStatus(
  profile: PrivateRuntimeProfile,
  options: { pythonCommand?: string; timeoutMs?: number } = {},
): Promise<LaneDeskStatusResult> {
  if (!laneDeskCliAvailable(profile) || !profile.laneDeskCli || !profile.laneDeskConfig) {
    return {
      kind: 'missing',
      detail: 'Lane Desk requires a healthy machine-scoped runtime outside the selected GeneralStaff root.',
    };
  }
  const pythonCommand = options.pythonCommand ?? 'python3';
  const timeoutMs = options.timeoutMs ?? STATUS_TIMEOUT_MS;
  let processSpec: ReturnType<typeof processInvocation>;
  try {
    processSpec = processInvocation(pythonCommand, [
      profile.laneDeskCli,
      '--config',
      profile.laneDeskConfig,
      'status',
      '--json',
    ]);
  } catch (error) {
    return {
      kind: 'error',
      detail: error instanceof Error ? error.message : 'Lane Desk could not be invoked.',
    };
  }

  return new Promise((resolve) => {
    execFile(
      processSpec.executable,
      processSpec.args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...processSpec.env },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const text = String(stdout || '').trim();
        const timedOut = Boolean(error && 'killed' in error && (error as { killed?: boolean }).killed);
        if (text) {
          try {
            const envelope = parseLaneDeskStatus(JSON.parse(text));
            if (timedOut) {
              resolve({ kind: 'ok', envelope, stale: true });
              return;
            }
            resolve({ kind: 'ok', envelope });
            return;
          } catch {
            // fall through
          }
        }
        const detail = timedOut
          ? 'Lane Desk status timed out; showing nothing invented for a hung host.'
          : error instanceof Error
            ? error.message
            : (stderr || 'Lane Desk status failed.').trim();
        resolve({ kind: 'error', detail });
      },
    );
  });
}
