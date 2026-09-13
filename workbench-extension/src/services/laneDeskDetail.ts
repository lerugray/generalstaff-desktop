import { execFile } from 'node:child_process';
import type { PrivateRuntimeProfile } from './privateRuntime.js';
import { processInvocation } from './processInvocation.js';
import { laneDeskCliAvailable } from './laneDeskStatus.js';

const DETAIL_TIMEOUT_MS = 6_000;
const DETAIL_LINES_DEFAULT = 40;
const DETAIL_LINES_MAX = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((entry): entry is string => typeof entry === 'string');
  return lines;
}

export interface LaneDeskSentinelDetail {
  present?: boolean;
  last_line?: string;
}

export interface LaneDeskDetailEnvelope {
  ok: boolean;
  lane_id?: string;
  host?: string;
  state?: string;
  repo?: string;
  cwd?: string;
  tree?: string;
  branch?: string;
  want_sha?: string;
  head_sha?: string;
  sha?: string;
  model?: string;
  door?: string;
  harness?: string;
  launched_at?: string;
  launch_time?: string;
  cap_min?: number;
  age_min?: number;
  elapsed?: string;
  dirty?: boolean;
  sentinels?: {
    log?: LaneDeskSentinelDetail;
    status?: LaneDeskSentinelDetail;
    done?: LaneDeskSentinelDetail;
  };
  /** Last lines of run.status as returned by lane-desk (never path-opened). */
  status_tail?: string[];
  /** Log tail lines from lane_detail (capped by lane-desk). */
  lines?: string[];
  code?: string;
  message?: string;
  candidates?: string[];
}

export interface LaneDeskHarvestProcess {
  running?: boolean;
  pid?: number;
  pgid?: number;
}

export interface LaneDeskHarvestGit {
  branch?: string;
  want_sha?: string;
  head_sha?: string;
  dirty?: boolean;
  dirty_count?: number;
  files_changed?: string[];
  commits_since_want?: number;
  summary?: string;
}

export interface LaneDeskHarvestEnvelope {
  ok: boolean;
  lane_id?: string;
  host?: string;
  paths?: Record<string, string>;
  process?: LaneDeskHarvestProcess;
  git?: LaneDeskHarvestGit;
  tests?: {
    reported?: boolean;
    verified?: boolean;
  };
  attention?: string[];
  battery?: string;
  model?: string;
  harness?: string;
  door?: string;
  code?: string;
  message?: string;
  candidates?: string[];
}

export type LaneDeskDetailResult =
  | { kind: 'ok'; envelope: LaneDeskDetailEnvelope; stale?: boolean }
  | { kind: 'missing'; detail: string }
  | { kind: 'error'; detail: string; envelope?: LaneDeskDetailEnvelope };

export type LaneDeskHarvestResult =
  | { kind: 'ok'; envelope: LaneDeskHarvestEnvelope; stale?: boolean }
  | { kind: 'missing'; detail: string }
  | { kind: 'error'; detail: string; envelope?: LaneDeskHarvestEnvelope };

function asSentinelDetail(value: unknown): LaneDeskSentinelDetail | undefined {
  if (typeof value === 'boolean') return { present: value };
  if (!isRecord(value)) return undefined;
  const detail: LaneDeskSentinelDetail = {};
  if (typeof value.present === 'boolean') detail.present = value.present;
  if (typeof value.last_line === 'string') detail.last_line = value.last_line;
  return Object.keys(detail).length ? detail : undefined;
}

function pickString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

function pickNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** Parse a lane_detail / `detail … --json` envelope without inventing fields. */
export function parseLaneDeskDetail(raw: unknown): LaneDeskDetailEnvelope {
  if (!isRecord(raw)) {
    return { ok: false, code: 'invalid_envelope', message: 'Detail payload was not an object.' };
  }
  const sentinelsIn = isRecord(raw.sentinels) ? raw.sentinels : undefined;
  const log = sentinelsIn ? asSentinelDetail(sentinelsIn.log) : undefined;
  const status = sentinelsIn ? asSentinelDetail(sentinelsIn.status) : undefined;
  const done = sentinelsIn ? asSentinelDetail(sentinelsIn.done) : undefined;
  const sentinels = log || status || done
    ? {
      ...(log ? { log } : {}),
      ...(status ? { status } : {}),
      ...(done ? { done } : {}),
    }
    : undefined;
  const candidates = asStringArray(raw.candidates);
  const statusTail = asStringArray(raw.status_tail);
  const lines = asStringArray(raw.lines);
  const envelope: LaneDeskDetailEnvelope = { ok: raw.ok === true };
  const laneId = pickString(raw, 'lane_id');
  const host = pickString(raw, 'host');
  const state = pickString(raw, 'state');
  const repo = pickString(raw, 'repo');
  const cwd = pickString(raw, 'cwd');
  const tree = pickString(raw, 'tree');
  const branch = pickString(raw, 'branch');
  const wantSha = pickString(raw, 'want_sha');
  const headSha = pickString(raw, 'head_sha');
  const sha = pickString(raw, 'sha');
  const model = pickString(raw, 'model');
  const door = pickString(raw, 'door');
  const harness = pickString(raw, 'harness');
  const launchedAt = pickString(raw, 'launched_at');
  const launchTime = pickString(raw, 'launch_time');
  const capMin = pickNumber(raw, 'cap_min');
  const ageMin = pickNumber(raw, 'age_min');
  const elapsed = pickString(raw, 'elapsed');
  const dirty = pickBoolean(raw, 'dirty');
  const code = pickString(raw, 'code');
  const message = pickString(raw, 'message');
  if (laneId) envelope.lane_id = laneId;
  if (host) envelope.host = host;
  if (state) envelope.state = state;
  if (repo) envelope.repo = repo;
  if (cwd) envelope.cwd = cwd;
  if (tree) envelope.tree = tree;
  if (branch) envelope.branch = branch;
  if (wantSha) envelope.want_sha = wantSha;
  if (headSha) envelope.head_sha = headSha;
  if (sha) envelope.sha = sha;
  if (model) envelope.model = model;
  if (door) envelope.door = door;
  if (harness) envelope.harness = harness;
  if (launchedAt) envelope.launched_at = launchedAt;
  if (launchTime) envelope.launch_time = launchTime;
  if (capMin !== undefined) envelope.cap_min = capMin;
  if (ageMin !== undefined) envelope.age_min = ageMin;
  if (elapsed) envelope.elapsed = elapsed;
  if (dirty !== undefined) envelope.dirty = dirty;
  if (sentinels) envelope.sentinels = sentinels;
  if (statusTail) envelope.status_tail = statusTail;
  if (lines) envelope.lines = lines;
  if (code) envelope.code = code;
  if (message) envelope.message = message;
  if (candidates?.length) envelope.candidates = candidates;
  return envelope;
}

/** Parse a lane_harvest / `harvest … --json` envelope without inventing fields. */
export function parseLaneDeskHarvest(raw: unknown): LaneDeskHarvestEnvelope {
  if (!isRecord(raw)) {
    return { ok: false, code: 'invalid_envelope', message: 'Harvest payload was not an object.' };
  }
  const pathsIn = isRecord(raw.paths) ? raw.paths : undefined;
  const paths: Record<string, string> = {};
  if (pathsIn) {
    for (const [key, value] of Object.entries(pathsIn)) {
      if (typeof value === 'string') paths[key] = value;
    }
  }
  let process: LaneDeskHarvestProcess | undefined;
  if (isRecord(raw.process)) {
    const next: LaneDeskHarvestProcess = {};
    const running = pickBoolean(raw.process, 'running');
    const pid = pickNumber(raw.process, 'pid');
    const pgid = pickNumber(raw.process, 'pgid');
    if (running !== undefined) next.running = running;
    if (pid !== undefined) next.pid = pid;
    if (pgid !== undefined) next.pgid = pgid;
    if (Object.keys(next).length) process = next;
  }
  let git: LaneDeskHarvestGit | undefined;
  if (isRecord(raw.git)) {
    const next: LaneDeskHarvestGit = {};
    const branch = pickString(raw.git, 'branch');
    const wantSha = pickString(raw.git, 'want_sha');
    const headSha = pickString(raw.git, 'head_sha');
    const dirty = pickBoolean(raw.git, 'dirty');
    const dirtyCount = pickNumber(raw.git, 'dirty_count');
    const filesChanged = asStringArray(raw.git.files_changed);
    const commitsSinceWant = pickNumber(raw.git, 'commits_since_want');
    const summary = pickString(raw.git, 'summary');
    if (branch) next.branch = branch;
    if (wantSha) next.want_sha = wantSha;
    if (headSha) next.head_sha = headSha;
    if (dirty !== undefined) next.dirty = dirty;
    if (dirtyCount !== undefined) next.dirty_count = dirtyCount;
    if (filesChanged?.length) next.files_changed = filesChanged;
    if (commitsSinceWant !== undefined) next.commits_since_want = commitsSinceWant;
    if (summary) next.summary = summary;
    if (Object.keys(next).length) git = next;
  }
  let tests: LaneDeskHarvestEnvelope['tests'];
  if (isRecord(raw.tests)) {
    const next: NonNullable<LaneDeskHarvestEnvelope['tests']> = {};
    const reported = pickBoolean(raw.tests, 'reported');
    const verified = pickBoolean(raw.tests, 'verified');
    if (reported !== undefined) next.reported = reported;
    if (verified !== undefined) next.verified = verified;
    if (Object.keys(next).length) tests = next;
  }
  const attention = asStringArray(raw.attention);
  const candidates = asStringArray(raw.candidates);
  const envelope: LaneDeskHarvestEnvelope = { ok: raw.ok === true };
  const laneId = pickString(raw, 'lane_id');
  const host = pickString(raw, 'host');
  const battery = pickString(raw, 'battery');
  const model = pickString(raw, 'model');
  const harness = pickString(raw, 'harness');
  const door = pickString(raw, 'door');
  const code = pickString(raw, 'code');
  const message = pickString(raw, 'message');
  if (laneId) envelope.lane_id = laneId;
  if (host) envelope.host = host;
  if (Object.keys(paths).length) envelope.paths = paths;
  if (process) envelope.process = process;
  if (git) envelope.git = git;
  if (tests) envelope.tests = tests;
  if (attention?.length) envelope.attention = attention;
  if (battery) envelope.battery = battery;
  if (model) envelope.model = model;
  if (harness) envelope.harness = harness;
  if (door) envelope.door = door;
  if (code) envelope.code = code;
  if (message) envelope.message = message;
  if (candidates?.length) envelope.candidates = candidates;
  return envelope;
}

function clampLines(lines: number | undefined): number {
  const n = typeof lines === 'number' && Number.isFinite(lines) ? Math.floor(lines) : DETAIL_LINES_DEFAULT;
  return Math.min(DETAIL_LINES_MAX, Math.max(1, n));
}

function invokeLaneDeskJson(
  profile: PrivateRuntimeProfile,
  args: string[],
  options: { pythonCommand?: string; timeoutMs?: number },
): Promise<{ text: string; timedOut: boolean; error?: Error; stderr: string }> {
  const pythonCommand = options.pythonCommand ?? 'python3';
  const timeoutMs = options.timeoutMs ?? DETAIL_TIMEOUT_MS;
  let processSpec: ReturnType<typeof processInvocation>;
  try {
    processSpec = processInvocation(pythonCommand, [
      profile.laneDeskCli!,
      '--config',
      profile.laneDeskConfig!,
      ...args,
    ]);
  } catch (error) {
    return Promise.resolve({
      text: '',
      timedOut: false,
      error: error instanceof Error ? error : new Error('Lane Desk could not be invoked.'),
      stderr: '',
    });
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
        const timedOut = Boolean(error && 'killed' in error && (error as { killed?: boolean }).killed);
        resolve({
          text: String(stdout || '').trim(),
          timedOut,
          ...(error instanceof Error ? { error } : {}),
          stderr: String(stderr || '').trim(),
        });
      },
    );
  });
}

/**
 * One-shot CLI probe — `detail LANE_ID --host HOST --lines N --json`.
 * Same transport as status; never opens a log path from the extension.
 */
export async function fetchLaneDeskDetail(
  profile: PrivateRuntimeProfile,
  laneId: string,
  host: string,
  options: { pythonCommand?: string; timeoutMs?: number; lines?: number } = {},
): Promise<LaneDeskDetailResult> {
  if (!laneDeskCliAvailable(profile) || !profile.laneDeskCli || !profile.laneDeskConfig) {
    return {
      kind: 'missing',
      detail: 'Lane Desk requires a healthy machine-scoped runtime outside the selected GeneralStaff root.',
    };
  }
  const lines = clampLines(options.lines);
  const result = await invokeLaneDeskJson(
    profile,
    ['detail', laneId, '--host', host, '--lines', String(lines), '--json'],
    options,
  );
  if (result.text) {
    try {
      const envelope = parseLaneDeskDetail(JSON.parse(result.text));
      if (result.timedOut) return { kind: 'ok', envelope, stale: true };
      return { kind: 'ok', envelope };
    } catch {
      // fall through
    }
  }
  const detail = result.timedOut
    ? 'Lane Desk detail timed out; showing nothing invented for a hung host.'
    : result.error?.message || result.stderr || 'Lane Desk detail failed.';
  return { kind: 'error', detail };
}

/**
 * One-shot CLI probe — `harvest LANE_ID --host HOST --json`.
 * Read-only preview only; never commits, kills, or writes sentinels.
 */
export async function fetchLaneDeskHarvest(
  profile: PrivateRuntimeProfile,
  laneId: string,
  host: string,
  options: { pythonCommand?: string; timeoutMs?: number } = {},
): Promise<LaneDeskHarvestResult> {
  if (!laneDeskCliAvailable(profile) || !profile.laneDeskCli || !profile.laneDeskConfig) {
    return {
      kind: 'missing',
      detail: 'Lane Desk requires a healthy machine-scoped runtime outside the selected GeneralStaff root.',
    };
  }
  const result = await invokeLaneDeskJson(
    profile,
    ['harvest', laneId, '--host', host, '--json'],
    options,
  );
  if (result.text) {
    try {
      const envelope = parseLaneDeskHarvest(JSON.parse(result.text));
      if (result.timedOut) return { kind: 'ok', envelope, stale: true };
      return { kind: 'ok', envelope };
    } catch {
      // fall through
    }
  }
  const detail = result.timedOut
    ? 'Lane Desk harvest timed out; showing nothing invented for a hung host.'
    : result.error?.message || result.stderr || 'Lane Desk harvest failed.';
  return { kind: 'error', detail };
}

export const LANE_DETAIL_LINES_DEFAULT = DETAIL_LINES_DEFAULT;
export const LANE_DETAIL_LINES_MAX = DETAIL_LINES_MAX;
