import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import { answerFromOllamaChatCompletion } from '../src/adapters/ollamaCloudAdapter.js';
import type { LaneId, RunEvent } from '../src/domain.js';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');

function loadJsonl(name: string): string[] {
  return readFileSync(path.join(fixturesDir, name), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function flattenNormalized(laneId: LaneId, lines: string[]): RunEvent[] {
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

function assertChatParity(events: RunEvent[], secrets: string[]): void {
  const assistant = events.filter((event) => event.type === 'assistant-delta').map((event) => event.text).join('');
  const blob = JSON.stringify(events);
  for (const secret of secrets) {
    assert.equal(assistant.includes(secret), false, `assistant prose leaked ${secret}`);
    assert.equal(blob.includes(secret), false, `normalized events retained ${secret}`);
  }
  assert.match(assistant, /\S/, 'expected assistant prose');
  assert.equal(assistant.includes('{'), false, 'assistant prose must not be raw JSON');
}

test('codex fixture: prose only; tools compact; no command output leak', () => {
  const events = flattenNormalized('codex', loadJsonl('codex-tool-turn.jsonl'));
  assertChatParity(events, ['SECRET_NOTE_BODY']);
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant-delta').map((event) => event.text),
    ["I'll read the note and update it.", 'Updated the note with the handoff summary.'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'tool').map((event) => event.text),
    ["bash -lc 'cat <repo>/note.md'", 'file_change <repo>/note.md'],
  );
});

test('cursor fixture: stream deltas only; tools named; no read/write body leak', () => {
  const events = flattenNormalized('cursor', loadJsonl('cursor-tool-turn.jsonl'));
  assertChatParity(events, ['SECRET_NOTE_BODY', 'SECRET_WRITE_BODY']);
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant-delta').map((event) => event.text),
    ["I'll read the note first.", 'Updating the note now.', 'Done — note.md is updated.'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'tool').map((event) => event.text),
    ['Read', 'Write'],
  );
  // model_call_id flush + untimestamped assistant + result must not duplicate prose
  assert.equal(events.filter((event) => event.type === 'assistant-delta').length, 3);
});

test('kimi fixture: assistant content only; tool_calls as activity; no tool-role bodies', () => {
  const events = flattenNormalized('kimi', loadJsonl('kimi-tool-turn.jsonl'));
  assertChatParity(events, ['SECRET_NOTE_BODY', 'SECRET_WRITE_BODY']);
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant-delta').map((event) => event.text),
    ["I'll read the note and rewrite it.", 'Writing the updated note.', 'Updated note.md with the handoff summary.'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'tool').map((event) => event.text),
    ['ReadFile', 'WriteFile'],
  );
});

test('cline fixture: text content_start only; tools compact; run_result suppressed', () => {
  const events = flattenNormalized('cline', loadJsonl('cline-tool-turn.jsonl'));
  assertChatParity(events, ['SECRET_NOTE_BODY', 'SECRET_WRITE_BODY']);
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant-delta').map((event) => event.text),
    ["I'll read the note and update it.", 'Rewriting the note now.', 'Done — the note is updated.'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'tool').map((event) => event.text),
    ['read_files', 'editor'],
  );
});

test('grok fixture: plain stdout is assistant prose (no structured tool JSON)', () => {
  const events = flattenNormalized('grok', loadJsonl('grok-tool-turn.jsonl'));
  const assistant = events.filter((event) => event.type === 'assistant-delta').map((event) => event.text).join('');
  assert.match(assistant, /I'll read the note/);
  assert.match(assistant, /Done — note\.md is updated/);
  assert.equal(events.some((event) => event.type === 'tool'), false);
});

test('ollama direct-API fixture: answer content only; thinking never surfaces', () => {
  const payload = JSON.parse(readFileSync(path.join(fixturesDir, 'ollama-tool-turn.json'), 'utf8')) as unknown;
  const completion = answerFromOllamaChatCompletion(payload);
  assert.ok(completion);
  assert.equal(completion.answer, 'Direct Ollama seats have no tool loop. Here is the answer only.');
  assert.equal(completion.answer.includes('SECRET_THINKING'), false);
  assert.equal(JSON.stringify(completion).includes('SECRET_THINKING'), false);
});
