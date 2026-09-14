import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import type { LaneId, RunEvent } from '../src/domain.js';
import { parseClaudeStreamUsage } from '../src/services/claudeUsage.js';
import {
  CC_DOOR_STATED_CONTEXT_TOKENS,
  contextCeilingFor,
  formatContextUsageMeter,
} from '../src/services/contextCeiling.js';

const fixtures = path.resolve(process.cwd(), 'test/fixtures');
const FIXTURE = path.join(fixtures, 'glm-catchup-m3e.jsonl');

function loadLines(): string[] {
  return fs.readFileSync(FIXTURE, 'utf8').split(/\r?\n/u).filter(Boolean);
}

function flatten(laneId: LaneId, lines: string[]): RunEvent[] {
  const events: RunEvent[] = [];
  for (const line of lines) {
    const normalized = normalizeCliLine(laneId, line);
    if (!normalized) continue;
    for (const event of Array.isArray(normalized) ? normalized : [normalized]) {
      events.push(event);
    }
  }
  return events;
}

/** Reproduce the pre-M3e meter bug: last context-usage wins, including result totals. */
function legacyMeterFromFixture(lines: string[]): number | undefined {
  let used: number | undefined;
  for (const line of lines) {
    const parsed = parseClaudeStreamUsage(line);
    if (parsed) used = parsed.usedTokens;
  }
  return used;
}

test('fixture is a scrubbed reconstruction with the diagnosis arithmetic', () => {
  const lines = loadLines();
  assert.ok(lines[0]?.includes('RECONSTRUCTION'));
  assert.equal(lines.some((line) => /api[_-]?key|sk-|Bearer\s/i.test(line)), false);

  const assistantUsages = lines
    .map((line) => parseClaudeStreamUsage(line))
    .filter((usage): usage is NonNullable<typeof usage> => usage?.source === 'assistant');
  assert.equal(assistantUsages.length, 7);

  const sumInput = assistantUsages.reduce((sum, usage) => sum + usage.usage.inputTokens, 0);
  const sumCache = assistantUsages.reduce((sum, usage) => sum + usage.usage.cacheReadTokens, 0);
  assert.equal(sumInput, 137_976);
  assert.equal(sumCache, 819_968);
  assert.equal(sumInput + sumCache, 957_944);

  assert.equal(assistantUsages[0]?.usedTokens, 132_479);
  assert.equal(assistantUsages.at(-1)?.usedTokens, 140_628);

  const result = parseClaudeStreamUsage(lines.at(-1)!);
  assert.equal(result?.source, 'result');
  assert.equal(result?.usedTokens, 957_944);
});

test('D1 meter = occupancy: fixture reads 91% on old arithmetic, 13% occupancy on new path', () => {
  const lines = loadLines();
  const oldCeiling = 1_048_576;
  const legacy = legacyMeterFromFixture(lines);
  assert.equal(legacy, 957_944);
  assert.equal(Math.round((legacy! / oldCeiling) * 100), 91);

  const events = flatten('glm-ollama-cc', lines);
  const occupancyEvents = events.filter((event) => event.type === 'context-usage');
  const spendEvents = events.filter((event) => event.type === 'session-spend');

  // Result envelope must not emit context-usage (would overwrite to 91%).
  assert.equal(occupancyEvents.every((event) => event.type === 'context-usage' && event.usedTokens !== 957_944), true);
  assert.deepEqual(occupancyEvents.at(-1), { type: 'context-usage', usedTokens: 140_628 });
  assert.deepEqual(spendEvents.at(-1), { type: 'session-spend', tokens: 957_944 });

  const occupancy = occupancyEvents.at(-1);
  assert.ok(occupancy && occupancy.type === 'context-usage');
  assert.equal(Math.round((occupancy.usedTokens / oldCeiling) * 100), 13);
  assert.notEqual(Math.round((occupancy.usedTokens / oldCeiling) * 100), 91);
});

test('D2 one denominator: CC-door seats use the door export (1_048_576)', () => {
  assert.equal(CC_DOOR_STATED_CONTEXT_TOKENS, 1_048_576);
  for (const id of ['deepseek-ollama-cc', 'glm-ollama-cc'] as const) {
    const ceiling = contextCeilingFor(id);
    assert.equal(ceiling.tokens, 1_048_576);
    assert.equal(ceiling.provenance, 'stated');
    assert.match(formatContextUsageMeter(ceiling, null).label, /^1\.05M ceiling only$/);
  }
  // Direct Ollama seats keep the verified /api/show window (same 1_048_576).
  assert.equal(contextCeilingFor('glm-ollama').tokens, 1_048_576);
  assert.equal(contextCeilingFor('deepseek-ollama').tokens, 1_048_576);

  const meter = formatContextUsageMeter(contextCeilingFor('glm-ollama-cc'), 140_628);
  assert.equal(meter.percent, 13);
  assert.match(meter.label, /140\.6k \/ 1\.05M \(13%\)/);
});

test('D3 tool cards: fixture tools carry name + one-line label and ok/error results', () => {
  const events = flatten('glm-ollama-cc', loadLines());
  const tools = events.filter((event) => event.type === 'tool');
  const results = events.filter((event) => event.type === 'tool-result');

  assert.equal(tools.length, 7);
  assert.equal(results.length, 7);
  assert.ok(tools.every((event) => event.type === 'tool' && event.name && event.summary && event.text.includes('·')));
  assert.ok(tools.some((event) => event.type === 'tool' && event.name === 'Bash' && /git log --oneline -8/.test(event.summary ?? '')));
  assert.ok(tools.some((event) => event.type === 'tool' && event.name === 'Read' && /latest-session-note\.md/.test(event.summary ?? '')));
  assert.equal(results.filter((event) => event.type === 'tool-result' && event.ok).length, 6);
  assert.equal(results.filter((event) => event.type === 'tool-result' && !event.ok).length, 1);
  assert.ok(results.some((event) => event.type === 'tool-result' && !event.ok && /multiple operations|refused/i.test(event.preview)));
});

test('D4 thinking + one bubble per turn: fixture emits thinking and distinct turnIds', () => {
  const events = flatten('glm-ollama-cc', loadLines());
  const thinking = events.filter((event) => event.type === 'thinking');
  assert.equal(thinking.length, 6);
  const thinkingChars = thinking.reduce((sum, event) => sum + (event.type === 'thinking' ? event.text.length : 0), 0);
  assert.equal(thinkingChars, 5_603);

  const turnIds = [
    ...new Set(
      events
        .filter((event) => event.type === 'assistant-delta' || event.type === 'thinking' || event.type === 'tool')
        .map((event) => ('turnId' in event ? event.turnId : undefined))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  assert.equal(turnIds.length, 7);

  const prose = events.filter((event) => event.type === 'assistant-delta');
  assert.equal(prose.length, 7);
  assert.ok(prose.every((event) => event.type === 'assistant-delta' && event.turnId));
});

test('D5 preamble vs added: first occupancy 132479, session added 8149', () => {
  const events = flatten('glm-ollama-cc', loadLines());
  const occupancy = events
    .filter((event): event is Extract<RunEvent, { type: 'context-usage' }> => event.type === 'context-usage')
    .map((event) => event.usedTokens);
  assert.equal(occupancy[0], 132_479);
  assert.equal(occupancy.at(-1), 140_628);
  assert.equal(occupancy.at(-1)! - occupancy[0]!, 8_149);

  const spend = events.find((event) => event.type === 'session-spend');
  assert.deepEqual(spend, { type: 'session-spend', tokens: 957_944 });
});
