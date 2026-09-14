import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import {
  ASSUMED_DEFAULT_WARNING,
  CLAUDE_NATIVE_1M_TOKENS,
  CLAUDE_NATIVE_HAIKU_TOKENS,
  CLAUDE_OPUS_MAX_TIER_NOTE,
  CONTEXT_CEILING_BY_LANE,
  contextCeilingFor,
  formatContextCeilingLabel,
  formatContextUsageMeter,
  formatTokenCount,
  nativeContextCeilingFor,
} from '../src/services/contextCeiling.js';
import { parseClaudeStreamUsage } from '../src/services/claudeUsage.js';
import { OLLAMA_CLOUD_CONTEXT_TOKENS } from '../src/services/ollamaCloud.js';
import type { LaneId } from '../src/domain.js';

const fixtures = path.resolve(process.cwd(), 'test/fixtures');

const ALL_LANE_IDS: LaneId[] = [
  'codex',
  'claude',
  'kimi',
  'cline',
  'cursor',
  'grok',
  'glm-ollama',
  'glm-ollama-flash',
  'deepseek-ollama',
  'deepseek-ollama-cc',
  'glm-ollama-cc',
];

test('every seat has a ceiling + provenance; no Ollama seat is assumed-default', () => {
  for (const id of ALL_LANE_IDS) {
    const ceiling = contextCeilingFor(id);
    assert.equal(ceiling, CONTEXT_CEILING_BY_LANE[id]);
    assert.ok(['stated', 'native', 'assumed-default', 'unknown'].includes(ceiling.provenance));
    assert.ok(typeof ceiling.modelLabel === 'string' && ceiling.modelLabel.length > 0);
    if (ceiling.tokens != null) {
      assert.ok(Number.isFinite(ceiling.tokens) && ceiling.tokens > 0);
    }
  }

  const ollamaDirect: LaneId[] = [
    'glm-ollama',
    'glm-ollama-flash',
    'deepseek-ollama',
  ];
  for (const id of ollamaDirect) {
    const ceiling = contextCeilingFor(id);
    assert.notEqual(ceiling.provenance, 'assumed-default', `${id} must not be assumed-default`);
    assert.equal(ceiling.tokens, OLLAMA_CLOUD_CONTEXT_TOKENS);
    assert.equal(ceiling.provenance, 'stated');
  }
  for (const id of ['deepseek-ollama-cc', 'glm-ollama-cc'] as const) {
    const ceiling = contextCeilingFor(id);
    assert.equal(ceiling.provenance, 'stated');
    assert.equal(ceiling.tokens, 1_048_576);
  }

  assert.equal(contextCeilingFor('claude').provenance, 'native');
  assert.equal(contextCeilingFor('claude').tokens, CLAUDE_NATIVE_1M_TOKENS);
  assert.equal(contextCeilingFor('cline').provenance, 'unknown');
  assert.equal(contextCeilingFor('cline').tokens, null);
});

test('fable and sonnet are native 1M; no Claude 5-family seat reads 200k', () => {
  const fable = nativeContextCeilingFor('fable');
  const sonnet = nativeContextCeilingFor('sonnet');
  const opus = nativeContextCeilingFor('opus');
  const haiku = nativeContextCeilingFor('haiku');

  assert.equal(fable.tokens, 1_000_000);
  assert.equal(fable.provenance, 'native');
  assert.equal(sonnet.tokens, 1_000_000);
  assert.equal(sonnet.provenance, 'native');
  assert.equal(opus.tokens, 1_000_000);
  assert.equal(opus.provenance, 'native');
  assert.equal(opus.provenanceNote, CLAUDE_OPUS_MAX_TIER_NOTE);
  assert.equal(haiku.tokens, CLAUDE_NATIVE_HAIKU_TOKENS);
  assert.equal(haiku.provenance, 'native');

  // Claude 5-family seats (fable / sonnet / opus) must not silently inherit the old 200k constant.
  for (const family of ['fable', 'sonnet', 'opus'] as const) {
    const ceiling = nativeContextCeilingFor(family);
    assert.notEqual(ceiling.tokens, 200_000, `${family} must not read 200k`);
    assert.equal(ceiling.tokens, 1_000_000);
  }
  assert.equal(contextCeilingFor('claude').tokens, 1_000_000);
  assert.notEqual(contextCeilingFor('claude').tokens, 200_000);
});

test('rendered ceiling strings match the brief examples', () => {
  assert.equal(formatTokenCount(1_048_576), '1.05M');
  assert.equal(formatTokenCount(1_000_000), '1M');
  assert.equal(formatTokenCount(200_000), '200k');
  assert.equal(
    formatContextCeilingLabel(contextCeilingFor('deepseek-ollama-cc')),
    'deepseek-v4.1-flash · 1.05M context (stated by launcher)',
  );
  assert.equal(
    formatContextCeilingLabel(contextCeilingFor('claude')),
    'fable · 1M context (native)',
  );
  assert.equal(
    formatContextCeilingLabel(nativeContextCeilingFor('opus')),
    'opus · 1M context (native, 1M on Max tiers)',
  );
  assert.equal(
    formatContextCeilingLabel(nativeContextCeilingFor('haiku')),
    'haiku · 200k context (native)',
  );
  assert.equal(
    formatContextCeilingLabel(contextCeilingFor('cline')),
    'glm-5.3 via cline · context unknown',
  );
  assert.equal(
    formatContextCeilingLabel({
      tokens: 200_000,
      provenance: 'assumed-default',
      modelLabel: 'mystery-model',
    }),
    'mystery-model · 200k context (CLI default)',
  );
  assert.match(ASSUMED_DEFAULT_WARNING, /200k/);
});

test('usage meter never invents a used count; formats used/ceiling when present', () => {
  const ceiling = contextCeilingFor('deepseek-ollama-cc');
  assert.deepEqual(formatContextUsageMeter(ceiling, null), {
    label: '1.05M ceiling only',
    percent: null,
    warn: false,
  });
  assert.deepEqual(formatContextUsageMeter(ceiling, 196_200), {
    label: '196.2k / 1.05M (19%)',
    percent: 19,
    warn: false,
  });
  assert.equal(formatContextUsageMeter(contextCeilingFor('cline'), 12).label, 'context unknown');
});

test('Claude stream-json usage parser sums input + cache_read + cache_creation from the fixture', () => {
  const lines = fs.readFileSync(path.join(fixtures, 'claude-stream-usage.jsonl'), 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean);
  assert.ok(lines[0]?.includes('RECONSTRUCTION'), 'fixture marked as reconstruction');
  const first = parseClaudeStreamUsage(lines[1]!);
  assert.equal(first?.source, 'assistant');
  assert.equal(first?.usedTokens, 4200 + 180000 + 12000);
  const second = parseClaudeStreamUsage(lines[2]!);
  assert.equal(second?.usedTokens, 5100 + 192000 + 8000);
  const result = parseClaudeStreamUsage(lines[3]!);
  assert.equal(result?.source, 'result');
  assert.equal(result?.usedTokens, 5200 + 200000 + 9000);
  assert.equal(parseClaudeStreamUsage('not-json'), undefined);
  assert.equal(parseClaudeStreamUsage('{"type":"assistant","message":{"role":"assistant"}}'), undefined);
});

test('normalizeCliLine emits occupancy for assistant envelopes and session-spend for result', () => {
  const assistant = normalizeCliLine(
    'deepseek-ollama-cc',
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello.' }],
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
          output_tokens: 5,
        },
      },
    }),
  );
  const events = Array.isArray(assistant) ? assistant : [assistant];
  assert.ok(events.some((event) => event?.type === 'assistant-delta' && event.text === 'Hello.'));
  assert.deepEqual(
    events.find((event) => event?.type === 'context-usage'),
    { type: 'context-usage', usedTokens: 130 },
  );

  assert.deepEqual(
    normalizeCliLine(
      'claude',
      JSON.stringify({
        type: 'result',
        result: 'done',
        usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
      }),
    ),
    [{ type: 'turn-boundary' }, { type: 'session-spend', tokens: 6 }],
  );
  assert.deepEqual(
    normalizeCliLine('claude', JSON.stringify({ type: 'result', result: 'I will update the handoff note.' })),
    [{ type: 'turn-boundary' }],
  );
});
