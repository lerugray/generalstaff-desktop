import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { answerFromOllamaChatCompletion, runOllamaCloudAdapter } from '../src/adapters/ollamaCloudAdapter.js';
import type { LaneSummary, RunEvent } from '../src/domain.js';
import { discoverOllamaCloudLanes } from '../src/services/lanes.js';
import {
  catalogHasModel,
  catalogModelTags,
  fetchOllamaCloudMonthlyUsage,
  formatOllamaMonthlyMeterLabel,
  loadOllamaCloudApiKey,
  OLLAMA_CLOUD_USAGE_URL,
  ollamaCloudModelFor,
  parseExportedEnvKey,
  parseOllamaCloudMonthlyUsage,
} from '../src/services/ollamaCloud.js';

test('reads only the exported Ollama Cloud key from the fixed GeneralStaff env file', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-ollama-env-'));
  context.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, '.generalstaff'));
  await fs.writeFile(
    path.join(temporary, '.generalstaff', '.env'),
    'OLLAMA_CLOUD_API_KEY=ignored\nexport OTHER_KEY=nope\nexport OLLAMA_CLOUD_API_KEY="cloud-test-key"\n',
  );

  assert.equal(parseExportedEnvKey('OLLAMA_CLOUD_API_KEY=ignored'), undefined);
  assert.equal(await loadOllamaCloudApiKey(temporary), 'cloud-test-key');
});

test('matches exact Ollama catalog tags without accepting lookalikes or suffixes', () => {
  const tags = catalogModelTags({
    models: [{ name: 'glm-5.3' }, { model: 'glm-5.3-flash:latest' }, { name: 'glm-5.30' }],
  });
  assert.equal(catalogHasModel(tags, 'glm-5.3'), true);
  assert.equal(catalogHasModel(tags, 'glm-5.3-flash'), false);
  assert.equal(catalogHasModel(tags, 'glm-5.3-f'), false);
  assert.equal(ollamaCloudModelFor('glm-ollama-flash'), 'glm-5.3-flash');
});

test('catalog discovery adds both distinctly labeled seats and fails closed per missing tag or key', async () => {
  let calls = 0;
  let catalogUrl = '';
  let authorization: string | null = null;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    catalogUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ models: [{ name: 'glm-5.3' }] }), { status: 200 });
  }) as typeof fetch;
  // canExecute is stubbed false so the assertions below are hermetic: on the operator's own
  // machine the launcher and the claude binary really are present.
  const lanes = await discoverOllamaCloudLanes({
    loadApiKey: async () => 'test-key',
    fetcher,
    canExecute: async () => false,
  });
  assert.equal(calls, 1);
  assert.equal(catalogUrl, 'https://ollama.com/api/tags');
  assert.equal(authorization, 'Bearer test-key');
  assert.deepEqual(lanes.map((lane) => lane.name), [
    'GLM 5.3 (Ollama)',
    'GLM 5.3 Flash (Ollama)',
    'DeepSeek V4.1 Flash (Ollama)',
    'DeepSeek V4.1 Flash \u00b7 Workbench seat',
    'GLM 5.3 \u00b7 Workbench seat',
  ]);
  assert.equal(lanes[0]?.state, 'available');
  assert.equal(lanes[1]?.state, 'unavailable');
  assert.equal(lanes[2]?.state, 'unavailable', 'deepseek fails closed when its tag is absent');
  assert.deepEqual(lanes[0]?.permissions, ['read']);
  // The direct-API seats are read-only single-shot calls; the CC-door seats run the real
  // Claude Code binary and therefore carry the operator's write boundary too.
  assert.deepEqual(lanes[4]?.permissions, ['read', 'write']);
  assert.equal(lanes[4]?.state, 'unavailable', 'the CC door fails closed when its launcher is absent');

  // A CC-door seat only becomes available when the catalog tag, the launcher and the claude
  // binary are all present. Its executable is the launcher, never a raw credential.
  const ready = await discoverOllamaCloudLanes({
    loadApiKey: async () => 'test-key',
    fetcher: (async () => new Response(
      JSON.stringify({ models: [{ name: 'glm-5.3' }, { name: 'deepseek-v4.1-flash' }] }),
      { status: 200 },
    )) as typeof fetch,
    canExecute: async () => true,
  });
  const ccSeat = ready.find((lane) => lane.id === 'deepseek-ollama-cc');
  assert.equal(ccSeat?.state, 'available');
  assert.match(ccSeat?.executable ?? '', /gsd-cc-door\.sh$/u);
  assert.equal(
    ready.every((lane) => !JSON.stringify(lane).includes('test-key')),
    true,
    'no lane summary may carry the Ollama credential into webview state',
  );

  const missing = await discoverOllamaCloudLanes({
    canExecute: async () => false,
    loadApiKey: async () => undefined,
    fetcher: (() => { throw new Error('fetch must not run without a key'); }) as typeof fetch,
  });
  assert.equal(missing.every((lane) => lane.state === 'unavailable'), true);
  assert.match(missing[0]?.detail ?? '', /OLLAMA_CLOUD_API_KEY/);
});

test('the direct adapter requests GLM 5.3 and surfaces content without thinking', async () => {
  const lane: LaneSummary = {
    id: 'glm-ollama',
    runner: 'glm-ollama',
    name: 'GLM 5.3 (Ollama)',
    detail: 'Ollama Cloud',
    evidenceLabel: 'test',
    state: 'available',
    roles: ['orchestrate'],
    permissions: ['read'],
    efforts: [{ id: 'default', label: 'Provider default' }],
    defaultEffort: 'default',
    contextCeiling: { tokens: 1_048_576, provenance: 'stated', modelLabel: 'glm-5.3' },
  };
  const events: RunEvent[] = [];
  let postedBody: Record<string, unknown> | undefined;
  let chatUrl = '';
  let authorization: string | null = null;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    chatUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization');
    postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      model: 'glm-5.3',
      choices: [{ message: { thinking: 'private chain of thought', content: 'GS_LANE_OK' } }],
    }), { status: 200 });
  }) as typeof fetch;

  const run = runOllamaCloudAdapter({
    conversationId: 'ollama-test',
    target: { kind: 'general' },
    cwd: '/work/repo',
    lane,
    seat: 'orchestrate',
    effort: 'default',
    permission: 'read',
    prompt: 'Reply with the marker.',
    continuity: 'new',
  }, (event) => events.push(event), { fetcher, loadApiKey: async () => 'test-key' });
  const completion = await run.completed;

  assert.equal(chatUrl, 'https://ollama.com/v1/chat/completions');
  assert.equal(authorization, 'Bearer test-key');
  assert.equal(postedBody?.model, 'glm-5.3');
  assert.deepEqual(events.find((event) => event.type === 'assistant-delta'), {
    type: 'assistant-delta', text: 'GS_LANE_OK',
  });
  assert.equal(JSON.stringify(events).includes('private chain of thought'), false);
  assert.equal(completion.receipt.exitCode, 0);
  assert.equal(completion.providerSessionId, undefined);
  assert.deepEqual(
    answerFromOllamaChatCompletion({ choices: [{ message: { thinking: 'reasoning only' } }] }),
    undefined,
  );
});

test('parses Ollama Cloud monthly pool usage and formats the meter label', () => {
  assert.equal(
    parseOllamaCloudMonthlyUsage({
      limits: {
        monthly: { usage: 0.37, models: [{ name: 'glm-5.3', request_count: 12 }] },
      },
    }),
    37,
  );
  assert.equal(parseOllamaCloudMonthlyUsage({ limits: { weekly: { usage: 0.5 } } }), undefined);
  assert.equal(parseOllamaCloudMonthlyUsage({ limits: { monthly: { usage: 1.2 } } }), 100);
  assert.equal(formatOllamaMonthlyMeterLabel({ status: 'ok', percent: 37 }), 'Ollama month 37% used');
  assert.equal(formatOllamaMonthlyMeterLabel({ status: 'unavailable' }), 'meter unavailable');
  assert.equal(formatOllamaMonthlyMeterLabel(undefined), 'meter unavailable');
});

test('fetchOllamaCloudMonthlyUsage uses Bearer auth and fails quietly on 401/network', async () => {
  let seenUrl = '';
  let authorization: string | null = null;
  const ok = await fetchOllamaCloudMonthlyUsage('cloud-secret', (async (input, init) => {
    seenUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ limits: { monthly: { usage: 0.12 } } }), { status: 200 });
  }) as typeof fetch);
  assert.equal(seenUrl, OLLAMA_CLOUD_USAGE_URL);
  assert.equal(authorization, 'Bearer cloud-secret');
  assert.deepEqual(ok, { status: 'ok', percent: 12 });

  assert.deepEqual(
    await fetchOllamaCloudMonthlyUsage('cloud-secret', (async () => new Response('nope', { status: 401 })) as typeof fetch),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    await fetchOllamaCloudMonthlyUsage('cloud-secret', (() => {
      throw new Error('network down');
    }) as typeof fetch),
    { status: 'unavailable' },
  );
});
