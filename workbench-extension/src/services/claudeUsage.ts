/**
 * Parse Claude Code `--output-format stream-json` usage for the live context meter (M3c/M3e),
 * and read Anthropic weekly subscription utilization for orchestrator seat defaults.
 *
 * Field names verified against Claude Code stream-json docs and Anthropic Messages usage:
 *   input_tokens, cache_read_input_tokens, cache_creation_input_tokens
 * The brief also names the shorter cache_read / cache_creation forms — accept both.
 *
 * Occupancy (the meter strip) = input + cache_read + cache_creation on the LATEST assistant
 * usage object. Claude Code's final `result` envelope carries SESSION TOTALS (cumulative spend
 * across every API call) — never feed that into occupancy. Session spend is surfaced separately.
 *
 * Weekly utilization comes from GET https://api.anthropic.com/api/oauth/usage (the same
 * endpoint Claude Code `/usage` uses). Never log the OAuth access token.
 *
 * Fixture: test/fixtures/glm-catchup-m3e.jsonl (scrubbed reconstruction from the 2026-09-14
 * diagnosis numbers: peak occupancy 140,628; cumulative spend 957,944).
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ANTHROPIC_OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** Prefer the Ollama GLM CC door when weekly utilization is strictly above this percent. */
export const ANTHROPIC_WEEKLY_HIGH_PERCENT = 80;

export interface ClaudeUsageTokens {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

export interface ClaudeContextUsage {
  /** input + cache_read + cache_creation — occupancy when source is assistant. */
  usedTokens: number;
  usage: ClaudeUsageTokens;
  /** stream-json envelope type that carried the usage. */
  source: 'assistant' | 'result';
}

function asNonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function readUsageRecord(usage: unknown): ClaudeUsageTokens | undefined {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined;
  const record = usage as Record<string, unknown>;
  // Prefer Anthropic/Claude Code snake names; fall back to the brief's shorter aliases.
  const inputTokens = asNonNegInt(record.input_tokens ?? record.inputTokens);
  const cacheReadTokens = asNonNegInt(
    record.cache_read_input_tokens ?? record.cache_read ?? record.cacheReadInputTokens,
  );
  const cacheCreationTokens = asNonNegInt(
    record.cache_creation_input_tokens
      ?? record.cache_creation
      ?? record.cacheCreationInputTokens,
  );
  const outputTokens = asNonNegInt(record.output_tokens ?? record.outputTokens);
  // A usage object with every field missing/zero is still valid (empty turn); require at
  // least one recognised key so random JSON does not become a fake meter.
  const hasPromptSideKey = [
    'input_tokens', 'inputTokens',
    'cache_read_input_tokens', 'cache_read', 'cacheReadInputTokens',
    'cache_creation_input_tokens', 'cache_creation', 'cacheCreationInputTokens',
  ].some((key) => key in record);
  // Output-only usage (message_delta shape) must not become occupancy 0 (MINOR 4).
  if (!hasPromptSideKey) return undefined;
  const hasKey = hasPromptSideKey || [
    'output_tokens', 'outputTokens',
  ].some((key) => key in record);
  if (!hasKey) return undefined;
  return { inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens };
}

function usageFromMessage(message: unknown): ClaudeUsageTokens | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  return readUsageRecord((message as Record<string, unknown>).usage);
}

export function occupancyTokens(usage: ClaudeUsageTokens): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

/**
 * Extract context-window usage from one stream-json line.
 * Returns undefined when the line is not JSON, not an assistant/result envelope, or has no usage.
 *
 * Callers that drive the occupancy meter must ignore `source === 'result'` (session totals).
 */
export function parseClaudeStreamUsage(line: string): ClaudeContextUsage | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'assistant') {
    const usage = usageFromMessage(record.message) ?? readUsageRecord(record.usage);
    if (!usage) return undefined;
    return {
      usedTokens: occupancyTokens(usage),
      usage,
      source: 'assistant',
    };
  }

  if (type === 'result') {
    const usage = readUsageRecord(record.usage) ?? usageFromMessage(record.message);
    if (!usage) return undefined;
    return {
      usedTokens: occupancyTokens(usage),
      usage,
      source: 'result',
    };
  }

  return undefined;
}

export type FetchLike = typeof fetch;

export interface AnthropicWeeklyUsage {
  /** 0–100 percent of the all-models weekly window used. */
  utilizationPercent: number;
}

function asUtilizationPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  // API historically returns 0–100; newer `limits[].percent` may be a 0–1 fraction.
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.round(percent * 10) / 10);
}

/**
 * Parse weekly utilization from either the classic `seven_day.utilization` shape or the
 * newer `limits[]` array (`kind: "seven_day"` / weekly bucket).
 */
export function parseAnthropicWeeklyUsage(payload: unknown): AnthropicWeeklyUsage | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;

  const sevenDay = record.seven_day;
  if (typeof sevenDay === 'object' && sevenDay !== null && !Array.isArray(sevenDay)) {
    const utilizationPercent = asUtilizationPercent((sevenDay as Record<string, unknown>).utilization);
    if (utilizationPercent !== undefined) return { utilizationPercent };
  }

  const limits = record.limits;
  if (Array.isArray(limits)) {
    for (const entry of limits) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const kind = typeof item.kind === 'string' ? item.kind : '';
      // Prefer the all-models weekly bucket; skip model-scoped weekly limits.
      if (kind === 'seven_day' || kind === 'weekly') {
        const utilizationPercent = asUtilizationPercent(item.percent ?? item.utilization);
        if (utilizationPercent !== undefined) return { utilizationPercent };
      }
    }
  }

  return undefined;
}

export function parseClaudeCodeAccessToken(source: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const oauth = (value as Record<string, unknown>).claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null || Array.isArray(oauth)) return undefined;
  const token = (oauth as Record<string, unknown>).accessToken;
  return typeof token === 'string' && token.trim() ? token.trim() : undefined;
}

export async function loadClaudeCodeAccessToken(
  homeDirectory = os.homedir(),
): Promise<string | undefined> {
  for (const relative of [path.join('.claude', '.credentials.json'), path.join('.claude', 'credentials.json')]) {
    try {
      const envPath = path.join(homeDirectory, relative);
      const stat = await fs.stat(envPath);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const token = parseClaudeCodeAccessToken(await fs.readFile(envPath, 'utf8'));
      if (token) return token;
    } catch {
      // try next source
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 5_000, maxBuffer: 256 * 1024 },
      );
      return parseClaudeCodeAccessToken(stdout);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export interface FetchAnthropicWeeklyUsageOptions {
  loadAccessToken?: () => Promise<string | undefined>;
  fetcher?: FetchLike;
}

/**
 * Read Anthropic weekly utilization for seat defaults. Returns undefined when the
 * credential is missing, the request fails, or the payload has no weekly window —
 * callers treat that as "unavailable" and should prefer the Ollama GLM seat.
 * Never logs the access token.
 */
export async function fetchAnthropicWeeklyUsage(
  options: FetchAnthropicWeeklyUsageOptions = {},
): Promise<AnthropicWeeklyUsage | undefined> {
  const loadAccessToken = options.loadAccessToken ?? loadClaudeCodeAccessToken;
  const fetcher = options.fetcher ?? fetch;
  let accessToken: string | undefined;
  try {
    accessToken = await loadAccessToken();
  } catch {
    return undefined;
  }
  if (!accessToken) return undefined;

  try {
    const response = await fetcher(ANTHROPIC_OAUTH_USAGE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.0.32',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return undefined;
    const body = await response.text();
    if (body.length > 512 * 1024) return undefined;
    return parseAnthropicWeeklyUsage(JSON.parse(body) as unknown);
  } catch {
    return undefined;
  }
}

/** True when weekly usage is missing or strictly above the high-water mark. */
export function anthropicWeeklyPrefersOllama(
  usage: AnthropicWeeklyUsage | undefined,
  threshold = ANTHROPIC_WEEKLY_HIGH_PERCENT,
): boolean {
  return usage === undefined || usage.utilizationPercent > threshold;
}
