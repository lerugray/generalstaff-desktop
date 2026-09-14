/**
 * Parse Claude Code `--output-format stream-json` usage for the live context meter (M3c/M3e).
 *
 * Field names verified against Claude Code stream-json docs and Anthropic Messages usage:
 *   input_tokens, cache_read_input_tokens, cache_creation_input_tokens
 * The brief also names the shorter cache_read / cache_creation forms — accept both.
 *
 * Occupancy (the meter strip) = input + cache_read + cache_creation on the LATEST assistant
 * usage object. Claude Code's final `result` envelope carries SESSION TOTALS (cumulative spend
 * across every API call) — never feed that into occupancy. Session spend is surfaced separately.
 *
 * Fixture: test/fixtures/glm-catchup-m3e.jsonl (scrubbed reconstruction from the 2026-09-14
 * diagnosis numbers: peak occupancy 140,628; cumulative spend 957,944).
 */

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
  const hasKey = [
    'input_tokens', 'inputTokens',
    'cache_read_input_tokens', 'cache_read', 'cacheReadInputTokens',
    'cache_creation_input_tokens', 'cache_creation', 'cacheCreationInputTokens',
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
