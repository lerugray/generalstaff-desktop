import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  ANTHROPIC_OAUTH_USAGE_URL,
  anthropicWeeklyPrefersOllama,
  fetchAnthropicWeeklyUsage,
  loadClaudeCodeAccessToken,
  parseAnthropicWeeklyUsage,
  parseClaudeCodeAccessToken,
} from '../src/services/claudeUsage.js';
import {
  decideOrchestratorSeat,
  formatSeatChoiceNotice,
  PREFERRED_OLLAMA_ORCHESTRATOR_LANE,
} from '../src/services/orchestratorSeat.js';

test('parses classic seven_day utilization and 0–1 weekly percent limits', () => {
  assert.deepEqual(
    parseAnthropicWeeklyUsage({ seven_day: { utilization: 92.4, resets_at: '2026-09-20T00:00:00Z' } }),
    { utilizationPercent: 92.4 },
  );
  assert.deepEqual(
    parseAnthropicWeeklyUsage({
      limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 0.99 }],
    }),
    undefined,
    'model-scoped weekly limits must not drive the all-models seat default',
  );
  assert.deepEqual(
    parseAnthropicWeeklyUsage({
      limits: [
        { kind: 'weekly_scoped', percent: 0.99 },
        { kind: 'seven_day', percent: 0.45 },
      ],
    }),
    { utilizationPercent: 45 },
  );
  assert.equal(parseAnthropicWeeklyUsage({ five_hour: { utilization: 99 } }), undefined);
});

test('anthropicWeeklyPrefersOllama treats missing or >80% as prefer-Ollama', () => {
  assert.equal(anthropicWeeklyPrefersOllama(undefined), true);
  assert.equal(anthropicWeeklyPrefersOllama({ utilizationPercent: 80 }), false);
  assert.equal(anthropicWeeklyPrefersOllama({ utilizationPercent: 80.1 }), true);
  assert.equal(anthropicWeeklyPrefersOllama({ utilizationPercent: 12 }), false);
});

test('decideOrchestratorSeat auto-picks glm-ollama-cc when Anthropic is high or unavailable', () => {
  const lanes = ['claude', 'glm-ollama-cc', 'codex'] as const;
  assert.deepEqual(decideOrchestratorSeat(undefined, lanes), {
    action: 'use',
    laneId: PREFERRED_OLLAMA_ORCHESTRATOR_LANE,
    reason: 'Anthropic weekly usage unavailable; preferring Ollama GLM',
  });
  assert.deepEqual(decideOrchestratorSeat({ utilizationPercent: 91 }, lanes), {
    action: 'use',
    laneId: PREFERRED_OLLAMA_ORCHESTRATOR_LANE,
    reason: 'Anthropic weekly 91% used; preferring Ollama GLM',
  });
  assert.deepEqual(decideOrchestratorSeat({ utilizationPercent: 40 }, lanes), {
    action: 'prompt',
    reason: 'Anthropic weekly 40% used; pick a seat',
  });
  assert.equal(
    decideOrchestratorSeat({ utilizationPercent: 95 }, ['claude', 'codex']).action,
    'prompt',
    'without glm-ollama-cc, fall through to an explicit pick',
  );
});

test('formatSeatChoiceNotice is one desk line', () => {
  assert.equal(
    formatSeatChoiceNotice('GLM 5.3 · Workbench seat', 'Anthropic weekly 91% used; preferring Ollama GLM'),
    'Seat: GLM 5.3 · Workbench seat — Anthropic weekly 91% used; preferring Ollama GLM',
  );
});

test('loads Claude Code access token from the credentials file without logging it', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-claude-creds-'));
  context.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, '.claude'));
  await fs.writeFile(
    path.join(temporary, '.claude', '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-test-token-never-log',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60_000,
      },
    }),
  );

  assert.equal(
    parseClaudeCodeAccessToken('{"claudeAiOauth":{"accessToken":"tok"}}'),
    'tok',
  );
  assert.equal(await loadClaudeCodeAccessToken(temporary), 'sk-ant-oat01-test-token-never-log');
});

test('fetchAnthropicWeeklyUsage calls the OAuth usage endpoint and fails closed', async () => {
  let seenUrl = '';
  let authorization: string | null = null;
  const usage = await fetchAnthropicWeeklyUsage({
    loadAccessToken: async () => 'secret-token',
    fetcher: (async (input, init) => {
      seenUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify({ seven_day: { utilization: 88 } }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(seenUrl, ANTHROPIC_OAUTH_USAGE_URL);
  assert.equal(authorization, 'Bearer secret-token');
  assert.deepEqual(usage, { utilizationPercent: 88 });

  assert.equal(
    await fetchAnthropicWeeklyUsage({
      loadAccessToken: async () => 'secret-token',
      fetcher: (async () => new Response('nope', { status: 401 })) as typeof fetch,
    }),
    undefined,
  );
  assert.equal(
    await fetchAnthropicWeeklyUsage({
      loadAccessToken: async () => undefined,
      fetcher: (() => { throw new Error('must not fetch without a token'); }) as typeof fetch,
    }),
    undefined,
  );
});
