import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import {
  invocationFor,
  normalizeCliLine,
  promptForSeat,
  streamJsonUserLine,
} from '../src/adapters/cliAdapter.js';

test('M2: seat conduct block sits before Operator request', () => {
  const prompt = promptForSeat('orchestrate', 'read', 'Catch up.');
  assert.match(prompt, /SEAT CONDUCT:/);
  assert.match(prompt, /Never block inside a tool call/);
  assert.match(prompt, /no sleep over 60 s/);
  const conductAt = prompt.indexOf('SEAT CONDUCT:');
  const requestAt = prompt.indexOf('Operator request:');
  assert.ok(conductAt >= 0 && requestAt > conductAt);
});

test('M1: Claude-protocol doors use stream-json input and keep stdin open', () => {
  for (const laneId of ['claude', 'glm-ollama-cc', 'deepseek-ollama-cc'] as const) {
    const inv = invocationFor(laneId, 'orchestrate', 'read', '/work/repo', 'Steer me.');
    assert.ok(inv.args.includes('--input-format'));
    assert.equal(inv.args[inv.args.indexOf('--input-format') + 1], 'stream-json');
    assert.equal(inv.keepStdinOpen, true);
    assert.equal(inv.steering, 'hold-until-turn');
    assert.ok(inv.stdin?.includes('"type":"user"'));
    assert.ok(!inv.args.includes('Steer me.'), 'prompt must not be a -p argv payload');
    // -p remains (print / non-interactive) but without the prompt string as next arg
    assert.ok(inv.args.includes('-p'));
    const pIndex = inv.args.indexOf('-p');
    assert.notEqual(inv.args[pIndex + 1], inv.stdin);
  }
});

test('M1: streamJsonUserLine is one NDJSON user envelope', () => {
  const line = streamJsonUserLine('hello mid-run');
  assert.ok(line.endsWith('\n'));
  const parsed = JSON.parse(line.trim()) as {
    type: string;
    message: { role: string; content: Array<{ type: string; text: string }> };
  };
  assert.equal(parsed.type, 'user');
  assert.equal(parsed.message.role, 'user');
  assert.equal(parsed.message.content[0]?.text, 'hello mid-run');
});

test('M1: result envelopes emit turn-boundary for hold-until-turn flush', () => {
  const events = normalizeCliLine(
    'glm-ollama-cc',
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  );
  const list = Array.isArray(events) ? events : events ? [events] : [];
  assert.ok(list.some((event) => event.type === 'turn-boundary'));
});

test('M5: composer CSS is one-row auto-grow with no manual resize', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.css'), 'utf8');
  assert.match(css, /\.composer textarea[\s\S]*?resize:\s*none/);
  assert.match(css, /\.composer-selects[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.composer-gear/);
  assert.match(css, /\.conversation-compose-wrap[\s\S]*?max-height:\s*30%/);
});

test('M4: run-event / context-usage / notice patch without full innerHTML rebuild hooks', () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.js'), 'utf8');
  assert.match(js, /function patchActivityStrip/);
  assert.match(js, /function patchContextMeter/);
  assert.match(js, /function patchNoticeOnly/);
  assert.match(js, /jump-latest/);
  // Fail-before shape: these handlers must not call render() on the hot paths.
  const runEventHandler = js.slice(js.indexOf("message.type === 'run-event'"), js.indexOf("message.type === 'notice'"));
  assert.ok(!/\brender\(\)/.test(runEventHandler), 'run-event must not full-render');
  const contextHandler = js.slice(js.indexOf("message.type === 'context-usage'"), js.indexOf("message.type === 'run-event'"));
  assert.ok(!/\brender\(\)/.test(contextHandler), 'context-usage must not full-render');
});

test('M3: live activity strip helpers exist', () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.js'), 'utf8');
  assert.match(js, /function renderActivityStrip/);
  assert.match(js, /idle — your turn/);
  assert.match(js, /woke on:/);
});

test('M1 UI: composer stays enabled while running; delivery chips exist', () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.js'), 'utf8');
  assert.ok(!/textarea id="prompt"[^>]*\$\{running \? 'disabled' : ''\}/.test(js));
  assert.match(js, /queued — delivered after the current tool call/);
  assert.match(js, /delivery-chip delivered/);
  assert.ok(!/running \|\| state\.creatingConversation \|\| state\.pendingSend \? 'disabled'/.test(js));
});

test('M6: .is-redacted styling present; ceiling mirror deleted', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.css'), 'utf8');
  assert.match(css, /\.thinking-card\.is-redacted/);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'test/fixtures/gsd-cc-door-ceiling.env')), false);
  const door = fs.readFileSync(path.resolve(process.cwd(), '../scripts/gsd-cc-door.sh'), 'utf8');
  assert.match(door, /CLAUDE_CODE_MAX_CONTEXT_TOKENS=["']?1048576/);
});

test('M6: overflow-wrap anywhere remains on card bodies', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'media/workbench.css'), 'utf8');
  for (const sel of ['.assistant-bubble', '.thinking-card-body', '.tool-card-detail', '.tool-card-result']) {
    const idx = css.indexOf(sel);
    assert.ok(idx >= 0, sel);
    assert.match(css.slice(idx, idx + 280), /overflow-wrap:\s*anywhere/);
  }
});
