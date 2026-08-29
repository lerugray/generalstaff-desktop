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
  loadOllamaCloudApiKey,
  ollamaCloudModelFor,
  parseExportedEnvKey,
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
  const lanes = await discoverOllamaCloudLanes({ loadApiKey: async () => 'test-key', fetcher });
  assert.equal(calls, 1);
  assert.equal(catalogUrl, 'https://ollama.com/api/tags');
  assert.equal(authorization, 'Bearer test-key');
  assert.deepEqual(lanes.map((lane) => lane.name), ['GLM 5.3 (Ollama)', 'GLM 5.3 Flash (Ollama)']);
  assert.equal(lanes[0]?.state, 'available');
  assert.equal(lanes[1]?.state, 'unavailable');
  assert.deepEqual(lanes[0]?.permissions, ['read']);

  const missing = await discoverOllamaCloudLanes({
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
