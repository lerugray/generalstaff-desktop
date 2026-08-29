import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  effectiveEffortFor,
  invocationFor,
  normalizeCliLine,
  providerSessionIdFromLine,
  redactProviderSessionEvidence,
  stopProcessTree,
  supportsNativeResume,
} from '../src/adapters/cliAdapter.js';
import { processInvocation } from '../src/services/processInvocation.js';

test('normalizes Codex agent messages', () => {
  const event = normalizeCliLine(
    'codex',
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Verified and complete.' } }),
  );
  assert.deepEqual(event, { type: 'assistant-delta', text: 'Verified and complete.' });
});

test('normalizes tool and error events without exposing credentials', () => {
  assert.deepEqual(normalizeCliLine('kimi', JSON.stringify({ type: 'tool_call', name: 'ReadFile' })), {
    type: 'tool',
    text: 'ReadFile',
  });
  const error = normalizeCliLine(
    'cline',
    JSON.stringify({ type: 'error', message: 'AUTH_TOKEN=abcdefghijklmnopqrstuvwxyz failed' }),
  );
  assert.deepEqual(error, { type: 'error', text: 'AUTH_TOKEN=[redacted] failed' });
});

test('keeps plain text as assistant output', () => {
  assert.deepEqual(normalizeCliLine('cursor', 'A concise final result.'), {
    type: 'assistant-delta',
    text: 'A concise final result.\n',
  });
});

test('normalizes Kimi role-based stream events', () => {
  assert.deepEqual(normalizeCliLine('kimi', JSON.stringify({ role: 'assistant', content: 'GS_LANE_OK' })), {
    type: 'assistant-delta',
    text: 'GS_LANE_OK',
  });
  assert.equal(
    normalizeCliLine('kimi', JSON.stringify({ role: 'meta', type: 'system.version', version: '0.36.1' })),
    undefined,
  );
});

test('keeps Cursor partial deltas and suppresses its accumulated final envelopes', () => {
  assert.deepEqual(
    normalizeCliLine('cursor', JSON.stringify({ type: 'assistant', timestamp_ms: 12, message: { content: [{ type: 'text', text: 'GS' }] } })),
    { type: 'assistant-delta', text: 'GS' },
  );
  assert.equal(
    normalizeCliLine('cursor', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'GS_LANE_OK' }] } })),
    undefined,
  );
  assert.equal(normalizeCliLine('cursor', JSON.stringify({ type: 'result', result: 'GS_LANE_OK' })), undefined);
});

test('streams Cline content once and suppresses its accumulated envelopes', () => {
  assert.deepEqual(
    normalizeCliLine('cline', JSON.stringify({
      type: 'agent_event',
      event: { type: 'content_start', contentType: 'text', text: 'A bounded answer.' },
    })),
    { type: 'assistant-delta', text: 'A bounded answer.' },
  );
  assert.equal(
    normalizeCliLine('cline', JSON.stringify({
      type: 'agent_event',
      event: { type: 'content_end', contentType: 'text', text: 'A bounded answer.' },
    })),
    undefined,
  );
  assert.equal(normalizeCliLine('cline', JSON.stringify({ type: 'run_result', text: 'A bounded answer.' })), undefined);
});

test('builds lane invocations as argument arrays with seat-specific boundaries', () => {
  const codex = invocationFor('codex', 'review', 'read', '/work/repo', 'Inspect this.');
  assert.deepEqual(codex.args.slice(0, 7), ['exec', '--json', '--model', 'gpt-5.6-sol', '--sandbox', 'read-only', '--skip-git-repo-check']);
  assert.match(codex.stdin ?? '', /Review only/);
  assert.equal(codex.args.some((argument) => argument.includes('Inspect this.')), false);

  const claude = invocationFor('claude', 'orchestrate', 'write', '/work/repo', 'Direct this.');
  assert.ok(claude.args.includes('fable'));
  assert.equal(claude.args[claude.args.indexOf('--permission-mode') + 1], 'acceptEdits');

  const cursor = invocationFor('cursor', 'verify', 'read', '/work/repo', 'Check this.');
  assert.deepEqual(cursor.args.slice(0, 4), ['--model', 'auto', '--mode', 'plan']);

  assert.throws(
    () => invocationFor('kimi', 'orchestrate', 'read', '/work/repo', 'Plan this.'),
    /cannot provide a read-only plan boundary/,
  );
});

test('maps explicit effort controls only onto provider-supported invocation flags', () => {
  const codex = invocationFor('codex', 'build', 'write', '/work/repo', 'Build this.', { effort: 'xhigh' });
  assert.ok(codex.args.includes('model_reasoning_effort="xhigh"'));
  assert.equal(codex.effort, 'xhigh');

  const claude = invocationFor('claude', 'review', 'read', '/work/repo', 'Review this.', { effort: 'low' });
  assert.equal(claude.args[claude.args.indexOf('--effort') + 1], 'low');

  const cursorFable = invocationFor('claude', 'orchestrate', 'read', '/work/repo', 'Direct this.', {
    effort: 'xhigh',
    runner: 'cursor',
  });
  assert.equal(cursorFable.args[cursorFable.args.indexOf('--model') + 1], 'claude-fable-5-thinking-xhigh');
  assert.deepEqual(cursorFable.args.slice(cursorFable.args.indexOf('--mode'), cursorFable.args.indexOf('--mode') + 2), ['--mode', 'plan']);
  assert.match(cursorFable.label, /via Cursor/);

  const cline = invocationFor('cline', 'assist', 'read', '/work/repo', 'Answer this.', { effort: 'none' });
  assert.equal(cline.args[cline.args.indexOf('--thinking') + 1], 'none');

  assert.equal(effectiveEffortFor('codex', 'assist'), 'high');
  assert.equal(effectiveEffortFor('claude', 'orchestrate'), 'max');
  assert.equal(effectiveEffortFor('claude', 'assist'), 'high');
  assert.equal(effectiveEffortFor('cline', 'assist'), 'medium');
  assert.throws(
    () => invocationFor('cursor', 'verify', 'read', '/work/repo', 'Verify this.', { effort: 'high' }),
    /does not support the requested effort level/,
  );
});

test('builds Cursor-hosted Grok trial invocations with bounded effort and permission flags', () => {
  const read = invocationFor('grok', 'orchestrate', 'read', '/work/repo', 'Direct this.', { runner: 'cursor' });
  assert.equal(read.args[read.args.indexOf('--model') + 1], 'cursor-grok-4.6-high');
  assert.deepEqual(read.args.slice(read.args.indexOf('--mode'), read.args.indexOf('--mode') + 2), ['--mode', 'plan']);

  const write = invocationFor('grok', 'orchestrate', 'write', '/work/repo', 'Direct this.', { runner: 'cursor' });
  assert.ok(write.args.includes('--force'));
  assert.equal(write.args.includes('--mode'), false);
  assert.equal(write.args.includes('plan'), false);

  const extraHigh = invocationFor('grok', 'review', 'read', '/work/repo', 'Review this.', {
    effort: 'xhigh',
    runner: 'cursor',
  });
  assert.equal(extraHigh.args[extraHigh.args.indexOf('--model') + 1], 'cursor-grok-4.6-xhigh');

  assert.throws(
    () => invocationFor('grok', 'verify', 'read', '/work/repo', 'Verify this.', { effort: 'max', runner: 'cursor' }),
    /does not support the requested effort level/,
  );
  assert.equal(effectiveEffortFor('grok', 'orchestrate'), 'high');
});

test('loads private MCP servers ephemerally only in write-consented lanes with a native transport', () => {
  const mcpServers = [
    { id: 'headroom' as const, command: '/tools/headroom-mcp-pure', args: [] },
    { id: 'lane-desk' as const, command: 'python3', args: ['/fleet/tools/lane-desk/mcp_server.py', '--config', '/fleet/tools/lane-desk/lane-desk.toml'] },
  ];
  const codex = invocationFor('codex', 'orchestrate', 'read', '/work/repo', 'Direct this.', { mcpServers });
  assert.ok(codex.args.includes('mcp_servers.headroom.command="/tools/headroom-mcp-pure"'));
  assert.ok(codex.args.includes('mcp_servers.lane-desk.args=["/fleet/tools/lane-desk/mcp_server.py","--config","/fleet/tools/lane-desk/lane-desk.toml"]'));

  const claude = invocationFor('claude', 'orchestrate', 'write', '/work/repo', 'Direct this.', { mcpServers });
  const claudeConfig = claude.args[claude.args.indexOf('--mcp-config') + 1] ?? '';
  assert.match(claudeConfig, /"headroom"/);
  assert.match(claudeConfig, /"lane-desk"/);
  assert.equal(claude.args[claude.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  const allowed = claude.args[claude.args.indexOf('--allowedTools') + 1] ?? '';
  assert.match(allowed, /mcp__headroom__headroom_stats/);
  assert.match(allowed, /mcp__lane-desk__lanes_status/);

  const cursorFable = invocationFor('claude', 'orchestrate', 'read', '/work/repo', 'Direct this.', {
    runner: 'cursor',
    mcpServers,
  });
  assert.equal(cursorFable.args.includes('--mcp-config'), false);
  assert.equal(cursorFable.args.includes('--tools'), false);
});

test('strips all MCP definitions from read-only Claude and preserves provider-enforced plan mode', () => {
  const claude = invocationFor('claude', 'review', 'read', '/work/repo', 'Inspect this.', {
    mcpServers: [
      { id: 'headroom', command: '/tools/headroom-mcp-pure', args: [] },
      { id: 'lane-desk', command: 'python3', args: ['/fleet/tools/lane-desk/mcp_server.py'] },
    ],
  });

  assert.equal(claude.args[claude.args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(claude.args.includes('--tools'), false);
  assert.equal(claude.args.includes('--allowedTools'), false);
  assert.equal(claude.args.includes('--mcp-config'), false);
  assert.equal(claude.args.includes('acceptEdits'), false);
});

test('builds provider-native resume invocations without weakening their original boundary', () => {
  const sessionId = '01a046d5-26b6-7813-bf9b-9c7321080a0f';
  const codex = invocationFor('codex', 'review', 'read', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: sessionId,
  });
  assert.deepEqual(codex.args.slice(0, 5), ['exec', 'resume', '--json', '--model', 'gpt-5.6-sol']);
  assert.ok(codex.args.includes('sandbox_mode="read-only"'));
  assert.ok(codex.args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(codex.args.slice(-2), [sessionId, '-']);
  assert.equal(codex.args.includes('--sandbox'), false);
  assert.match(codex.stdin ?? '', /read-only run/);

  const writeCodex = invocationFor('codex', 'build', 'write', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: sessionId,
  });
  assert.ok(writeCodex.args.includes('sandbox_mode="workspace-write"'));

  const claude = invocationFor('claude', 'review', 'read', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: sessionId,
  });
  assert.equal(claude.args[claude.args.indexOf('--resume') + 1], sessionId);
  assert.equal(claude.args[claude.args.indexOf('--permission-mode') + 1], 'plan');

  const initialClaude = invocationFor('claude', 'review', 'read', '/work/repo', 'Start.', {
    continuity: 'new',
    initialSessionId: sessionId,
  });
  assert.equal(initialClaude.args[initialClaude.args.indexOf('--session-id') + 1], sessionId);

  const cursorFable = invocationFor('claude', 'review', 'read', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: sessionId,
    runner: 'cursor',
  });
  assert.equal(cursorFable.args[cursorFable.args.indexOf('--resume') + 1], sessionId);
  assert.equal(cursorFable.args[cursorFable.args.indexOf('--model') + 1], 'claude-fable-5-thinking-max');

  const kimi = invocationFor('kimi', 'build', 'write', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: 'session_c1078838-1864-4634-8962-33ecd56c47d5',
  });
  assert.equal(kimi.args[kimi.args.indexOf('--session') + 1], 'session_c1078838-1864-4634-8962-33ecd56c47d5');

  const cursor = invocationFor('cursor', 'verify', 'read', '/work/repo', 'Continue.', {
    continuity: 'native',
    providerSessionId: sessionId,
  });
  assert.equal(cursor.args[cursor.args.indexOf('--resume') + 1], sessionId);
  assert.ok(cursor.args.includes('plan'));

  assert.throws(
    () => invocationFor('cline', 'verify', 'read', '/work/repo', 'Continue.', {
      continuity: 'native',
      providerSessionId: sessionId,
    }),
    /does not currently accept resumed non-interactive turns/,
  );
});

test('captures only bounded provider session identifiers from native envelopes', () => {
  assert.equal(
    providerSessionIdFromLine('codex', JSON.stringify({ type: 'thread.started', thread_id: '01a046d5-26b6-7813-bf9b-9c7321080a0f' })),
    '01a046d5-26b6-7813-bf9b-9c7321080a0f',
  );
  assert.equal(
    providerSessionIdFromLine('kimi', JSON.stringify({ type: 'session.resume_hint', session_id: 'session_c1078838-1864-4634-8962-33ecd56c47d5' })),
    'session_c1078838-1864-4634-8962-33ecd56c47d5',
  );
  assert.equal(providerSessionIdFromLine('cursor', JSON.stringify({ session_id: '--unsafe-option' })), undefined);
  assert.equal(providerSessionIdFromLine('cline', JSON.stringify({ session_id: '1787894769750_pjf8j' })), undefined);
  assert.equal(supportsNativeResume('cline'), false);
  assert.equal(supportsNativeResume('glm-ollama'), false);
  assert.equal(supportsNativeResume('glm-ollama-flash'), false);
  assert.equal(supportsNativeResume('cursor'), true);
  assert.doesNotMatch(
    redactProviderSessionEvidence(JSON.stringify({ session_id: 'ff7da156-f18e-49ae-83ca-56fb257dd14a' })),
    /ff7da156/,
  );
  assert.doesNotMatch(
    redactProviderSessionEvidence(JSON.stringify({ chatId: '01a046d5-26b6-7813-bf9b-9c7321080a0f' })),
    /01a046d5/,
  );
  assert.doesNotMatch(
    redactProviderSessionEvidence('To resume: kimi -r session_c1078838-1864-4634-8962-33ecd56c47d5'),
    /session_c1078838/,
  );
  assert.doesNotMatch(
    redactProviderSessionEvidence('To resume: codex exec resume 01a046d5-26b6-7813-bf9b-9c7321080a0f'),
    /01a046d5/,
  );
});

test('stops the owned process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  await new Promise<void>((resolve) => child.once('spawn', resolve));
  stopProcessTree(child);
  const result = await Promise.race([
    closed,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('process group did not stop')), 3000)),
  ]);
  assert.ok(result.signal || result.code !== 0);
});

test('resolves Windows npm shims to Node without passing prompt text through cmd.exe', (context) => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'gs-windows-shim-'));
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const shim = path.join(temporary, 'codex.cmd');
  writeFileSync(shim, '@ECHO off\n"%_prog%" "%dp0%/node_modules/@openai/codex/bin/codex.js" %*\n');
  const prompt = 'review this & echo should-not-run';
  const invocation = processInvocation(shim, ['exec', prompt], 'win32');
  assert.equal(invocation.executable, 'node.exe');
  assert.match(invocation.args[0] ?? '', /node_modules.*codex\.js/);
  assert.deepEqual(invocation.args.slice(1), ['exec', prompt]);
  assert.deepEqual(invocation.env, {});

  const unsupported = path.join(temporary, 'custom.cmd');
  writeFileSync(unsupported, '@ECHO off\necho custom wrapper\n');
  assert.throws(() => processInvocation(unsupported, [prompt], 'win32'), /Unsupported Windows command shim/);
});
