import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { clipOneLine, normalizeCliLine } from '../src/adapters/cliAdapter.js';
import type { ConversationMessage, RunEvent } from '../src/domain.js';
import { parseClaudeStreamUsage } from '../src/services/claudeUsage.js';
import { CC_DOOR_STATED_CONTEXT_TOKENS } from '../src/services/contextCeiling.js';
import {
  applyDecisionTextToBlocks,
  buildPriorContextTranscript,
  countExchanges,
  findToolBlockForResult,
  needsNewBubble,
  reduceRunEventsToTurns,
} from '../src/services/runTranscript.js';

const fixtures = path.resolve(process.cwd(), 'test/fixtures');
const CATCHUP = path.join(fixtures, 'glm-catchup-m3e.jsonl');
const DOOR_SNIPPET = path.join(fixtures, 'gsd-cc-door-ceiling.env');

function loadCatchupEvents(): RunEvent[] {
  const lines = fs.readFileSync(CATCHUP, 'utf8').split(/\r?\n/u).filter(Boolean);
  const events: RunEvent[] = [];
  for (const line of lines) {
    const normalized = normalizeCliLine('glm-ollama-cc', line);
    if (!normalized) continue;
    for (const event of Array.isArray(normalized) ? normalized : [normalized]) {
      events.push(event);
    }
  }
  return events;
}

test('MAJOR 1: reduceRunEventsToTurns yields 7 bubbles and 7 id-matched tool cards from the fixture', () => {
  const events = loadCatchupEvents();
  const turns = reduceRunEventsToTurns(events);
  assert.equal(turns.length, 7, 'one bubble per assistant turn');
  const tools = turns.flatMap((turn) => turn.blocks.filter((block) => block.type === 'tool'));
  assert.equal(tools.length, 7);
  assert.ok(tools.every((block) => block.type === 'tool' && block.id), 'every tool has an id');
  assert.ok(tools.every((block) => block.type === 'tool' && (block.status === 'ok' || block.status === 'error')));
});

test('MAJOR 1 mutant needsNewBubble=false collapses to one bubble (must fail this test)', () => {
  const events = loadCatchupEvents();
  // Production path:
  assert.equal(reduceRunEventsToTurns(events).length, 7);

  // Mutant: force needsNewBubble to always be false by collapsing turn ids.
  const collapsed = events.map((event) => {
    if ('turnId' in event && event.turnId) return { ...event, turnId: 'same-turn' };
    return event;
  });
  assert.equal(reduceRunEventsToTurns(collapsed).length, 1);
  // The production helper itself must still open bubbles across distinct ids:
  assert.equal(needsNewBubble('a', 'b', true), true);
  assert.equal(needsNewBubble('a', 'a', true), false);
  assert.equal(needsNewBubble(undefined, 'b', true), false);
});

test('MAJOR 1 mutant first-tool-wins correlation mismatches tool ids (must fail this test)', () => {
  const events = loadCatchupEvents();
  const turns = reduceRunEventsToTurns(events);
  const tools = turns.flatMap((turn) => turn.blocks.filter((block) => block.type === 'tool'));
  const withIds = tools.filter((block) => block.type === 'tool' && block.id) as Array<{ id: string; status?: string }>;
  assert.ok(withIds.length >= 2);

  // Production correlation: each result attaches to its own id.
  const blocks = withIds.map((tool) => ({
    type: 'tool' as const,
    id: tool.id,
    name: 'Bash',
    summary: 'cmd',
    status: 'running' as const,
  }));
  const secondId = withIds[1]!.id;
  const matched = findToolBlockForResult(blocks, secondId);
  assert.equal(matched?.id, secondId);

  // Mutant: first tool card wins regardless of id.
  const mutantFirstWins = (list: typeof blocks) => list.find((block) => block.type === 'tool');
  assert.notEqual(mutantFirstWins(blocks)?.id, secondId);
});

test('MAJOR 2: priorContext counts exchanges, so a 7-bubble run costs one slot', () => {
  const now = Date.now();
  const prior: ConversationMessage[] = [];
  for (let i = 0; i < 5; i += 1) {
    prior.push({
      id: `u-${i}`,
      role: 'user',
      text: `prior user ${i}`,
      createdAt: now - 100_000 + i * 1000,
      status: 'complete',
    });
    prior.push({
      id: `a-${i}`,
      role: 'assistant',
      text: `prior assistant ${i}`,
      createdAt: now - 99_000 + i * 1000,
      status: 'complete',
    });
  }
  // One M3e run: 1 user + 7 assistant bubbles (no text on some).
  prior.push({
    id: 'u-run',
    role: 'user',
    text: 'catch up',
    createdAt: now,
    status: 'complete',
  });
  for (let i = 0; i < 7; i += 1) {
    prior.push({
      id: `run-${i}`,
      role: 'assistant',
      text: i % 2 === 0 ? `turn ${i}` : '',
      createdAt: now + i + 1,
      status: 'complete',
      blocks: i % 2 === 0
        ? [{ type: 'text', text: `turn ${i}` }]
        : [{ type: 'tool', id: `t${i}`, name: 'Bash', summary: 'x', status: 'ok' }],
    });
  }

  assert.equal(countExchanges(prior), 6); // 5 prior + 1 catch-up run
  const transcript = buildPriorContextTranscript(prior, 6);
  // All five prior user lines survive — the 7-bubble run did not eject them.
  for (let i = 0; i < 5; i += 1) {
    assert.match(transcript, new RegExp(`prior user ${i}`));
  }
  // Message-count slice(-12) would have dropped early priors; exchange counting keeps them.
  const messageSlice = prior
    .filter((message) => message.text.trim())
    .slice(-12)
    .map((message) => message.text)
    .join('\n');
  assert.equal(messageSlice.includes('prior user 0'), false, 'naive message slice drops early exchanges');
  assert.equal(transcript.includes('prior user 0'), true);
});

test('MAJOR 3: decision text applies to the first text block only on text→tool→text turns', () => {
  const blocks = applyDecisionTextToBlocks(
    [
      { type: 'text', text: 'Intro.' },
      { type: 'tool', name: 'Bash', summary: 'git status', status: 'ok' },
      { type: 'text', text: 'Outro with <gs-decision>{"title":"Pick","question":"Which?","options":[{"label":"A"},{"label":"B"}]}</gs-decision>' },
    ],
    'Clean decision prose only.',
  );
  const texts = blocks.filter((block) => block.type === 'text');
  assert.equal(texts.length, 1);
  assert.equal(texts[0]?.type === 'text' ? texts[0].text : '', 'Clean decision prose only.');
  assert.ok(blocks.some((block) => block.type === 'tool'));
});

test('LOOK D1: expanded tool result keeps newlines; clipOneLine is collapsed-only', () => {
  const multi = 'aaa1111 chore: rebuild package\nbbb2222 docs: handoff notes\nccc3333 fix: meter';
  const line = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_log', content: multi }],
    },
  });
  const events = normalizeCliLine('glm-ollama-cc', line);
  const list = Array.isArray(events) ? events : [events];
  const result = list.find((event) => event?.type === 'tool-result');
  assert.ok(result && result.type === 'tool-result');
  assert.equal(result.body?.includes('\n'), true);
  assert.equal(result.body, multi);
  assert.equal(result.preview.includes('\n'), false);
  assert.ok(result.preview.length <= 120);
});

test('MINOR 4: output-only usage does not become assistant occupancy', () => {
  const parsed = parseClaudeStreamUsage(JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', usage: { output_tokens: 40 } },
  }));
  assert.equal(parsed, undefined);
});

test('MINOR 5: CC_DOOR_STATED_CONTEXT_TOKENS matches scripts/gsd-cc-door.sh (1048576)', () => {
  // FIXLIST-R3 CODE 6: read the REAL door script, not only the fixture mirror.
  const doorPath = path.resolve(process.cwd(), '../scripts/gsd-cc-door.sh');
  const door = fs.readFileSync(doorPath, 'utf8');
  const match = door.match(/CLAUDE_CODE_MAX_CONTEXT_TOKENS=["']?(\d+)/);
  assert.ok(match, 'scripts/gsd-cc-door.sh must export CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  assert.equal(Number(match[1]), CC_DOOR_STATED_CONTEXT_TOKENS);
  assert.equal(CC_DOOR_STATED_CONTEXT_TOKENS, 1_048_576);

  const snippet = fs.readFileSync(DOOR_SNIPPET, 'utf8');
  const snippetMatch = snippet.match(/CLAUDE_CODE_MAX_CONTEXT_TOKENS=["']?(\d+)/);
  assert.equal(Number(snippetMatch?.[1]), CC_DOOR_STATED_CONTEXT_TOKENS);
});

test('MINOR 7: redacted_thinking becomes a collapsed thinking placeholder', () => {
  const events = normalizeCliLine(
    'claude',
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_redacted',
        role: 'assistant',
        content: [{ type: 'redacted_thinking', data: 'cipher' }],
      },
    }),
  );
  const list = Array.isArray(events) ? events : [events];
  assert.deepEqual(list[0], { type: 'thinking', text: 'Thinking · redacted', turnId: 'msg_redacted' });
});

test('MINOR 8+9: tool detail is capped and clipOneLine fails on unfixed UTF-16 slice (max=4)', () => {
  const huge = 'x'.repeat(10_000);
  const labeled = normalizeCliLine(
    'claude',
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: huge } }],
      },
    }),
  );
  const list = Array.isArray(labeled) ? labeled : [labeled];
  const tool = list.find((event) => event?.type === 'tool');
  assert.ok(tool && tool.type === 'tool');
  assert.ok((tool.detail?.length ?? 0) <= 8_192);

  // FIXLIST-R3 CODE 5: max=4 lands mid-surrogate on old slice(0, max-1) — must fail on unfixed code.
  const emoji = '😀😀😀😀😀';
  const clipped = clipOneLine(emoji, 4);
  assert.equal(clipped.includes('\uFFFD'), false);
  assert.equal(Array.from(clipped.replace(/…$/u, '')).length, 3);

  // Unfixed UTF-16 slice at max-1=3 splits a surrogate — this is the discriminating mutant.
  const unfixed = `${emoji.slice(0, 3)}…`;
  assert.equal(unfixed.includes('\uFFFD') || /[\uD800-\uDFFF]/.test(unfixed), true);
});
