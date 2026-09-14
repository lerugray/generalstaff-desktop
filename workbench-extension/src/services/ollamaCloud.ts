import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LaneId } from '../domain.js';

export const OLLAMA_CLOUD_API_KEY_NAME = 'OLLAMA_CLOUD_API_KEY';
export const OLLAMA_CLOUD_ENV_PATH = path.join('.generalstaff', '.env');
export const OLLAMA_CLOUD_TAGS_URL = 'https://ollama.com/api/tags';
export const OLLAMA_CLOUD_USAGE_URL = 'https://ollama.com/api/usage';
export const OLLAMA_CLOUD_CHAT_URL = 'https://ollama.com/v1/chat/completions';
/** Poll the monthly pool while an Ollama seat is the active conversation lane. */
export const OLLAMA_MONTHLY_USAGE_POLL_MS = 3 * 60 * 1000;

const ollamaModels = {
  'glm-ollama': 'glm-5.3',
  'glm-ollama-flash': 'glm-5.3-flash',
  'deepseek-ollama': 'deepseek-v4.1-flash',
} as const satisfies Partial<Record<LaneId, string>>;

/**
 * CC-door lanes. Each maps to a door name understood by the gsd-cc-door.sh launcher in the
 * private GeneralStaff repository, which injects the Ollama Cloud credentials and the real
 * context window before exec'ing claude. The launcher owns the key so it never enters
 * extension state, and therefore never reaches the webview.
 */
const ollamaCcDoors = {
  'deepseek-ollama-cc': { door: 'ollama-deepseek', model: 'deepseek-v4.1-flash' },
  'glm-ollama-cc': { door: 'ollama-glm', model: 'glm-5.3' },
} as const satisfies Partial<Record<LaneId, { door: string; model: string }>>;

/**
 * Every Ollama Cloud tag the Workbench offers reports context_length 1048576 from
 * https://ollama.com/api/show (verified 2026-09-13). Direct Ollama seats use that
 * figure. CC-door seats instead state `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` via
 * gsd-cc-door.sh — the Workbench meter divides by that export (see contextCeiling.ts).
 */
export const OLLAMA_CLOUD_CONTEXT_TOKENS = 1_048_576;

export type OllamaCcLaneId = keyof typeof ollamaCcDoors;

export function isOllamaCcLaneId(laneId: LaneId): laneId is OllamaCcLaneId {
  return Object.hasOwn(ollamaCcDoors, laneId);
}

export function ollamaCcDoorFor(laneId: OllamaCcLaneId): { door: string; model: string } {
  return ollamaCcDoors[laneId];
}

export type OllamaCloudLaneId = keyof typeof ollamaModels;
export type FetchLike = typeof fetch;

export function isOllamaCloudLaneId(laneId: LaneId): laneId is OllamaCloudLaneId {
  return Object.hasOwn(ollamaModels, laneId);
}

export function ollamaCloudModelFor(laneId: OllamaCloudLaneId): string {
  return ollamaModels[laneId];
}

function unquoteEnvValue(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (!value) return undefined;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1) || undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded = JSON.parse(value) as unknown;
      return typeof decoded === 'string' && decoded ? decoded : undefined;
    } catch {
      return undefined;
    }
  }
  const withoutComment = value.replace(/\s+#.*$/u, '').trim();
  return withoutComment && !/\s/u.test(withoutComment) ? withoutComment : undefined;
}

export function parseExportedEnvKey(source: string, variable = OLLAMA_CLOUD_API_KEY_NAME): string | undefined {
  let found: string | undefined;
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match?.[1] !== variable) continue;
    found = unquoteEnvValue(match[2] ?? '');
  }
  return found;
}

export async function loadOllamaCloudApiKey(homeDirectory = os.homedir()): Promise<string | undefined> {
  const envPath = path.join(homeDirectory, OLLAMA_CLOUD_ENV_PATH);
  try {
    const stat = await fs.stat(envPath);
    if (!stat.isFile() || stat.size > 128 * 1024) return undefined;
    return parseExportedEnvKey(await fs.readFile(envPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function modelTag(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function catalogModelTags(payload: unknown): Set<string> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return new Set();
  const models = (payload as Record<string, unknown>).models;
  if (!Array.isArray(models)) return new Set();
  const tags = new Set<string>();
  for (const entry of models) {
    if (typeof entry === 'string') {
      const tag = modelTag(entry);
      if (tag) tags.add(tag);
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    for (const candidate of [record.name, record.model]) {
      const tag = modelTag(candidate);
      if (tag) tags.add(tag);
    }
  }
  return tags;
}

export async function fetchOllamaCloudCatalog(
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<Set<string>> {
  const response = await fetcher(OLLAMA_CLOUD_TAGS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`catalog probe returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
    throw new Error('catalog probe returned an oversized response');
  }
  const body = await response.text();
  if (body.length > 2 * 1024 * 1024) throw new Error('catalog probe returned an oversized response');
  return catalogModelTags(JSON.parse(body) as unknown);
}

export function catalogHasModel(tags: ReadonlySet<string>, model: string): boolean {
  return tags.has(model);
}

export type OllamaMonthlyUsageStatus = 'ok' | 'unavailable';

export interface OllamaMonthlyUsage {
  status: OllamaMonthlyUsageStatus;
  /** 0–100 integer percent when status is ok. */
  percent?: number;
}

/**
 * Parse `limits.monthly.usage` (0–1 fraction) from GET /api/usage.
 * Returns undefined when the monthly window is absent or malformed.
 */
export function parseOllamaCloudMonthlyUsage(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const limits = (payload as Record<string, unknown>).limits;
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) return undefined;
  const monthly = (limits as Record<string, unknown>).monthly;
  if (typeof monthly !== 'object' || monthly === null || Array.isArray(monthly)) return undefined;
  const usage = (monthly as Record<string, unknown>).usage;
  if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) return undefined;
  const fraction = Math.min(1, usage);
  return Math.round(fraction * 100);
}

/**
 * Fetch Ollama Cloud monthly pool usage. Never logs the API key.
 * 401 / network / malformed payloads resolve to `{ status: 'unavailable' }` — no throw.
 */
export async function fetchOllamaCloudMonthlyUsage(
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<OllamaMonthlyUsage> {
  try {
    const response = await fetcher(OLLAMA_CLOUD_USAGE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const body = await response.text();
    if (body.length > 512 * 1024) return { status: 'unavailable' };
    const percent = parseOllamaCloudMonthlyUsage(JSON.parse(body) as unknown);
    if (percent === undefined) return { status: 'unavailable' };
    return { status: 'ok', percent };
  } catch {
    return { status: 'unavailable' };
  }
}

export function formatOllamaMonthlyMeterLabel(usage: OllamaMonthlyUsage | undefined): string {
  if (!usage || usage.status === 'unavailable' || usage.percent === undefined) {
    return 'meter unavailable';
  }
  return `Ollama month ${usage.percent}% used`;
}

/** Direct-API or CC-door Ollama Cloud seats share the monthly pool meter. */
export function isOllamaSeatLaneId(laneId: LaneId): boolean {
  return isOllamaCloudLaneId(laneId) || isOllamaCcLaneId(laneId);
}
