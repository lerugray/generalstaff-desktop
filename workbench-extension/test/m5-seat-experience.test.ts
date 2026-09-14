import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import {
  invocationFor,
  normalizeCliLine,
  promptForSeat,
  runCliAdapter,
  streamJsonUserLine,
} from '../src/adapters/cliAdapter.js';
import type { LaneSummary, RunEvent } from '../src/domain.js';
import { formatContextUsageMeter } from '../src/services/contextCeiling.js';

const root = path.resolve(process.cwd());
const media = path.join(root, 'media');

/** Fake CC door: NDJSON result per stdin line; exit when stdin ends. */
function installFakeDoor(delayFirstMs = 0): { executable: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-m5-door-'));
  const script = path.join(dir, 'fake-door.mjs');
  fs.writeFileSync(
    script,
    `import * as readline from 'node:readline';
const delayFirstMs = ${Number(delayFirstMs)};
let lineCount = 0;
let chain = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', () => {
  lineCount += 1;
  const n = lineCount;
  chain = chain.then(
    () =>
      new Promise((resolve) => {
        const emit = () => {
          process.stdout.write(
            JSON.stringify({
              type: 'result',
              subtype: 'success',
              result: 'ok-' + n,
              usage: { input_tokens: 1, output_tokens: 1 },
            }) + '\\n',
          );
          resolve();
        };
        if (n === 1 && delayFirstMs > 0) setTimeout(emit, delayFirstMs);
        else setTimeout(emit, 5);
      }),
  );
});
rl.on('close', () => {
  chain.finally(() => process.exit(0));
});
`,
  );
  const wrapper = path.join(dir, 'fake-door.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  return {
    executable: wrapper,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function fakeLane(executable: string): LaneSummary {
  return {
    id: 'glm-ollama-cc',
    runner: 'glm-ollama-cc',
    name: 'GLM 5.3 · Workbench seat',
    detail: 'fake door',
    evidenceLabel: 'Ollama Cloud CC door',
    state: 'available',
    executable,
    roles: ['orchestrate'],
    permissions: ['read'],
    efforts: [{ id: 'default', label: 'Default' }],
    defaultEffort: 'default',
    contextCeiling: { tokens: 1_048_576, provenance: 'stated', modelLabel: 'glm-5.3' },
  };
}

function raceComplete<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} did not complete within ${ms}ms`)), ms);
    }),
  ]);
}

test('M2: seat conduct requires acting on queued operator messages at the next boundary', () => {
  const prompt = promptForSeat('orchestrate', 'read', 'Catch up.');
  assert.match(prompt, /SEAT CONDUCT:/);
  assert.match(prompt, /queued a message/i);
  assert.match(prompt, /next turn boundary/i);
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


test('M1: idle seat with nothing queued completes within 5s (R4 lifecycle)', async () => {
  const door = installFakeDoor(0);
  try {
    const events: RunEvent[] = [];
    const run = runCliAdapter(
      {
        conversationId: 'm5-idle-complete',
        target: { kind: 'general' },
        cwd: root,
        lane: fakeLane(door.executable),
        seat: 'orchestrate',
        effort: 'default',
        permission: 'read',
        prompt: 'Reply exactly PING',
        continuity: 'new',
      },
      (event) => events.push(event),
    );
    const completion = await raceComplete(run.completed, 5_000, 'idle round');
    assert.equal(completion.receipt.exitCode, 0);
    assert.ok(events.some((event) => event.type === 'turn-boundary'));
    assert.ok(events.some((event) => event.type === 'complete'));
  } finally {
    door.cleanup();
  }
});

test('M1: queued follow-up delivers then round completes (R4 lifecycle)', async () => {
  const door = installFakeDoor(250);
  try {
    const events: RunEvent[] = [];
    const run = runCliAdapter(
      {
        conversationId: 'm5-queued-complete',
        target: { kind: 'general' },
        cwd: root,
        lane: fakeLane(door.executable),
        seat: 'orchestrate',
        effort: 'default',
        permission: 'read',
        prompt: 'First turn',
        continuity: 'new',
      },
      (event) => events.push(event),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(typeof run.enqueueFollowUp, 'function');
    assert.equal(run.enqueueFollowUp!('queued follow-up'), true);
    const completion = await raceComplete(run.completed, 5_000, 'queued round');
    assert.equal(completion.receipt.exitCode, 0);
    assert.ok(
      events.some((event) => event.type === 'status' && /follow-up sent to seat/i.test(event.text)),
      'follow-up must be written onto the live channel',
    );
    assert.ok(
      events.some((event) => event.type === 'status' && /follow-up delivered/i.test(event.text))
        || events.filter((event) => event.type === 'turn-boundary').length >= 2,
      'follow-up must be delivered (ack or second turn-boundary) before the round ends',
    );
  } finally {
    door.cleanup();
  }
});

test('M1: result envelopes emit turn-boundary', () => {
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

test('M3: system/task_notification normalizes to woke-on status', () => {
  const events = normalizeCliLine(
    'glm-ollama-cc',
    JSON.stringify({
      type: 'system',
      subtype: 'task_notification',
      status: 'completed',
      summary: 'Sleep for 150 seconds',
    }),
  );
  const list = Array.isArray(events) ? events : events ? [events] : [];
  assert.ok(list.some((event) => event.type === 'status' && /woke on:.*Sleep for 150 seconds/i.test(event.text)));
});

test('M3: woke-on requires a task_notification subtype (R2-4)', () => {
  const events = normalizeCliLine(
    'glm-ollama-cc',
    JSON.stringify({
      type: 'system',
      subtype: 'session_state',
      status: 'completed',
      summary: 'should not wake',
    }),
  );
  const list = Array.isArray(events) ? events : events ? [events] : [];
  assert.ok(!list.some((event) => event.type === 'status' && /^woke on:/i.test(event.text)));
});

test('M3: tool_progress carries authoritative elapsed seconds', () => {
  const events = normalizeCliLine(
    'glm-ollama-cc',
    JSON.stringify({
      type: 'tool_progress',
      tool_name: 'Bash',
      elapsed_time_seconds: 90,
    }),
  );
  const list = Array.isArray(events) ? events : events ? [events] : [];
  assert.deepEqual(list, [{ type: 'status', text: 'Bash · 90s' }]);
});

test('M7: meter percent equals occupancy/ceiling for 5%, 13%, 50%', () => {
  const ceiling = { tokens: 1_048_576, provenance: 'stated' as const, modelLabel: 'glm-5.3' };
  for (const [used, expected] of [
    [Math.round(1_048_576 * 0.05), 5],
    [Math.round(1_048_576 * 0.13), 13],
    [Math.round(1_048_576 * 0.5), 50],
  ] as const) {
    const meter = formatContextUsageMeter(ceiling, used);
    assert.equal(meter.percent, expected, `used=${used}`);
    assert.match(meter.label, new RegExp(`\\(${expected}%\\)`));
  }
});

test('M6: ceiling mirror deleted; real door still 1048576', () => {
  assert.equal(fs.existsSync(path.join(root, 'test/fixtures/gsd-cc-door-ceiling.env')), false);
  const doorPath = path.resolve(root, '../scripts/gsd-cc-door.sh');
  assert.ok(fs.existsSync(doorPath), 'real door script must exist');
  assert.match(fs.readFileSync(doorPath, 'utf8'), /CLAUDE_CODE_MAX_CONTEXT_TOKENS=["']?1048576/);
});

/** FIX 9 — behavioural UI checks (Playwright), not source greps. */
test('M4/M5/M7 UI: mid-scroll stable, compact context row, meter fill, strip text', async (t) => {
  const deckHtml = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="/media/workbench.css">
</head><body>
  <div id="app"></div>
  <script src="/media/operatorIdentity.js"></script>
  <script src="/media/composerKeys.js"></script>
  <script>
    (function () {
      var store = { selectedTheme: 'paper' };
      window.acquireVsCodeApi = function () {
        return {
          getState: function () { return store; },
          setState: function (next) { store = next || store; },
          postMessage: function () {},
        };
      };
    })();
  </script>
  <script src="/media/workbench.js"></script>
</body></html>`;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(deckHtml);
        return;
      }
      if (!url.pathname.startsWith('/media/')) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      const filePath = path.join(media, url.pathname.slice('/media/'.length));
      const body = await readFile(filePath);
      const type = filePath.endsWith('.css')
        ? 'text/css'
        : filePath.endsWith('.js')
          ? 'text/javascript'
          : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end('error');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // GATE-R2 (test-only): the server teardown is registered BEFORE the browser launch. Registering
  // it after meant a failed launch left this listener open and the whole test FILE hung forever
  // (node's event loop never drained) instead of reporting one failure.
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  // GATE-R2 (test-only): honour an installed-elsewhere chromium, and SKIP rather than hang when
  // this host has no matching build (playwright pins a revision; Ray's Mac carries newer ones).
  const pinned = chromium.executablePath();
  const override = process.env.GS_CHROMIUM_EXECUTABLE;
  if (!fs.existsSync(pinned) && !(override && fs.existsSync(override))) {
    t.skip(`no chromium for playwright's pinned revision (${pinned}); set GS_CHROMIUM_EXECUTABLE or run: npx playwright install chromium`);
    return;
  }
  const browser = await chromium.launch({
    ...(fs.existsSync(pinned) || !override ? {} : { executablePath: override }),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/?theme=paper`, { waitUntil: 'networkidle' });

  const conversationId = 'm5-behaviour';
  await page.evaluate((id) => {
    (window as unknown as { __m5ConversationId?: string }).__m5ConversationId = id;
    window.postMessage(
      {
        type: 'state',
        snapshot: {
          generatedAt: Date.now(),
          rootPath: '/fleet',
          projects: [],
          attention: [],
          activity: [],
          skills: [],
          capabilities: [],
          lanes: [
            {
              id: 'glm-ollama-cc',
              runner: 'glm-ollama-cc',
              name: 'GLM 5.3 · Workbench seat',
              detail: 'GLM via Claude Code door',
              evidenceLabel: 'Ollama Cloud CC door',
              state: 'available',
              executable: '/bin/gsd-cc-door.sh',
              roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
              permissions: ['read', 'write'],
              efforts: [{ id: 'default', label: 'Workbench default' }],
              defaultEffort: 'default',
              contextCeiling: { tokens: 1_048_576, provenance: 'stated', modelLabel: 'glm-5.3' },
            },
          ],
        },
        conversations: [
          {
            id,
            kind: 'orchestrator',
            title: 'M5 behaviour',
            target: { kind: 'general' },
            laneId: 'glm-ollama-cc',
            seat: 'orchestrate',
            effort: 'default',
            permission: 'read',
            context: [],
            messages: [
              {
                id: 'user-1',
                role: 'user',
                text: 'Catch up and report status.',
                createdAt: Date.now() - 60_000,
                status: 'complete',
              },
              {
                id: 'asst-1',
                role: 'assistant',
                text: 'Working the round.\n\n'.repeat(40),
                createdAt: Date.now() - 50_000,
                status: 'streaming',
              },
              {
                id: 'user-queued',
                role: 'user',
                text: 'Steer after the sleep.',
                createdAt: Date.now() - 5_000,
                status: 'complete',
                delivery: 'queued',
              },
              {
                id: 'user-sent',
                role: 'user',
                text: 'Also check git status.',
                createdAt: Date.now() - 4_000,
                status: 'complete',
                delivery: 'sent',
              },
            ],
            decisions: [],
            createdAt: Date.now() - 120_000,
            updatedAt: Date.now(),
          },
        ],
        orchestratorSessionId: id,
        notes: {},
        operatorDisplayName: 'Ray',
        lanesBadgeCount: 0,
        deskBadgeCount: 0,
        auxFocus: null,
      },
      '*',
    );
    window.postMessage(
      {
        type: 'run-event',
        conversationId: id,
        event: { type: 'tool', text: 'Bash · sleep 150', name: 'Bash', summary: 'sleep 150' },
      },
      '*',
    );
  }, conversationId);

  await page.waitForSelector('.message-stream');
  await page.waitForSelector('.activity-strip');
  await page.waitForSelector('.delivery-chip.queued');
  await page.waitForSelector('.delivery-chip.sent');
  await page.waitForSelector('.context-row');
  await page.waitForSelector('#prompt:not([disabled])');

  // M5: compact composer still exposes the local-files context row.
  const contextVisible = await page.evaluate(() => {
    const row = document.querySelector('.composer.compact .context-row, .context-row') as HTMLElement | null;
    if (!row) return false;
    const style = getComputedStyle(row);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  assert.equal(contextVisible, true, 'context row must remain visible in the in-conversation composer');
  assert.match((await page.locator('.context-row').innerText()).toLowerCase(), /reference local files/);

  // M1: delivery chips use honest wording (CSS may uppercase the visible text).
  assert.match(
    await page.locator('.delivery-chip.queued').innerText(),
    /queued\s*[—-]\s*delivered after the current tool call/i,
  );
  assert.match(await page.locator('.delivery-chip.sent').innerText(), /sent to the seat/i);

  // M5: transcript dominates the pane.
  const streamRatio = await page.evaluate(() => {
    const stream = document.querySelector('.message-stream') as HTMLElement | null;
    const shell = document.querySelector('.conversation-shell') as HTMLElement | null;
    if (!stream || !shell) return 0;
    return stream.getBoundingClientRect().height / shell.getBoundingClientRect().height;
  });
  // Compact composer budget: wrap capped near 30% so the stream keeps the pane.
  const composeBudget = await page.evaluate(() => {
    const wrap = document.querySelector('.conversation-compose-wrap') as HTMLElement | null;
    const shell = document.querySelector('.conversation-shell') as HTMLElement | null;
    if (!wrap || !shell) return null;
    const wrapH = wrap.getBoundingClientRect().height;
    const shellH = shell.getBoundingClientRect().height;
    return { wrapShare: wrapH / shellH, streamShare: streamRatioFrom(shell), maxHeight: getComputedStyle(wrap).maxHeight };
    function streamRatioFrom(shell: HTMLElement) {
      const stream = document.querySelector('.message-stream') as HTMLElement | null;
      return stream ? stream.getBoundingClientRect().height / shell.getBoundingClientRect().height : 0;
    }
  });
  assert.ok(composeBudget, 'compose wrap and shell must exist');
  assert.match(composeBudget!.maxHeight, /(?:2\d|30)%|\d+px/);
  assert.ok(composeBudget!.wrapShare <= 0.32, `compose wrap share ${composeBudget!.wrapShare} > 0.32`);
  assert.ok(streamRatio >= 0.65, `transcript ratio ${streamRatio} < 0.65`);

  // M4: non-zero mid-scroll stays put across hot-path events.
  const scroll = await page.evaluate(async (id) => {
    const stream = document.querySelector('.message-stream') as HTMLElement | null;
    if (!stream) throw new Error('no message-stream');
    stream.scrollTop = Math.min(240, Math.max(40, stream.scrollHeight - stream.clientHeight - 80));
    const before = stream.scrollTop;
    if (before < 1) throw new Error(`expected mid-scroll > 0, got ${before}`);
    for (let i = 0; i < 20; i += 1) {
      window.postMessage(
        {
          type: 'run-event',
          conversationId: id,
          event: { type: 'tool', text: `Bash · tick ${i}`, name: 'Bash', summary: `tick ${i}` },
        },
        '*',
      );
      window.postMessage({ type: 'context-usage', conversationId: id, usedTokens: 100_000 + i * 1000 }, '*');
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    return { before, after: stream.scrollTop };
  }, conversationId);
  assert.ok(Math.abs(scroll.after - scroll.before) <= 1, `scroll moved ${scroll.after - scroll.before}px`);

  // M3: activity strip shows live tool text (patched, not rebuilt).
  const stripText = await page.locator('.activity-strip-line').innerText();
  assert.match(stripText, /Bash/i);

  // R4: when the seat goes idle (round complete), strip must read "idle — your turn".
  await page.evaluate((id) => {
    window.postMessage(
      {
        type: 'conversation-delta',
        conversationId: id,
        messageId: 'asst-1',
        text: 'Round finished.',
        status: 'complete',
      },
      '*',
    );
  }, conversationId);
  await page.waitForFunction(() => {
    const line = document.querySelector('.activity-strip-line')?.textContent || '';
    return /idle\s*[—-]\s*your turn/i.test(line);
  });
  assert.match(await page.locator('.activity-strip-line').innerText(), /idle\s*[—-]\s*your turn/i);

  // M7: fill width equals tooltip percent within 1 point (CSP-safe CSSOM path).
  async function assertMeter(page: Page, usedTokens: number, expectedPercent: number): Promise<void> {
    const measured = await page.evaluate(
      ({ usedTokens, conversationId }) => {
        window.postMessage({ type: 'context-usage', conversationId, usedTokens }, '*');
        return new Promise<{ fill: number; label: string }>((resolve) => {
          requestAnimationFrame(() => {
            const fill = document.querySelector('.lanes-context-fill') as HTMLElement | null;
            const label = document.querySelector('.lanes-context-copy')?.textContent || '';
            const width = fill ? Number.parseFloat(fill.style.width || '0') : -1;
            resolve({ fill: width, label });
          });
        });
      },
      { usedTokens, conversationId },
    );
    assert.ok(
      Math.abs(measured.fill - expectedPercent) <= 1,
      `fill ${measured.fill} vs ${expectedPercent}; label=${measured.label}`,
    );
    assert.match(measured.label, new RegExp(`\\(${expectedPercent}%\\)`));
  }

  const ceiling = 1_048_576;
  await assertMeter(page, Math.round(ceiling * 0.05), 5);
  await assertMeter(page, Math.round(ceiling * 0.13), 13);
  await assertMeter(page, Math.round(ceiling * 0.5), 50);


  // R2-2: permission/root chips must expose full text (title) and not letter-ellipsis.
  // Use a string evaluate so tsx does not inject __name helpers into the browser realm.
  type ChipMeasure = { text: string; title: string; scrollWider: boolean } | null;
  const chipState = (await page.evaluate(`(() => {
    const measure = (el) => {
      if (!el) return null;
      return {
        text: (el.textContent || '').trim(),
        title: el.getAttribute('title') || '',
        scrollWider: el.scrollWidth > el.clientWidth + 1,
      };
    };
    return {
      permission: measure(document.querySelector('.permission-chip')),
      root: measure(document.querySelector('.root-chip')),
    };
  })()`)) as { permission: ChipMeasure; root: ChipMeasure };
  assert.ok(chipState.permission, 'permission chip missing');
  assert.match(chipState.permission!.text, /Read only|Can edit repo/i);
  assert.equal(chipState.permission!.title, chipState.permission!.text);
  assert.equal(chipState.permission!.scrollWider, false, 'permission chip must not ellipsis');
  if (chipState.root) {
    assert.match(chipState.root.text, /GENERALSTAFF_ROOT/);
    assert.equal(chipState.root.title, 'GENERALSTAFF_ROOT');
    assert.equal(chipState.root.scrollWider, false, 'root chip must not ellipsis');
  }

  // Jump pill is anchored above the compose wrap (not covering Stop).
  const jumpGeometry = (await page.evaluate(`(() => {
    const wrap = document.querySelector('.conversation-compose-wrap');
    if (!wrap) return null;
    const stream = document.querySelector('.message-stream');
    if (stream) stream.scrollTop = 0;
    let pill = document.querySelector('.jump-latest');
    if (!pill) {
      pill = document.createElement('button');
      pill.className = 'jump-latest';
      pill.textContent = '↓ jump to latest';
      wrap.prepend(pill);
    }
    const wrapBox = wrap.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const stop = document.querySelector('[data-action="stop-run"]');
    const stopBox = stop ? stop.getBoundingClientRect() : null;
    return {
      pillBottom: pillBox.bottom,
      wrapTop: wrapBox.top,
      overlapsStop: Boolean(
        stopBox &&
          pillBox.left < stopBox.right &&
          pillBox.right > stopBox.left &&
          pillBox.top < stopBox.bottom &&
          pillBox.bottom > stopBox.top,
      ),
    };
  })()`)) as { pillBottom: number; wrapTop: number; overlapsStop: boolean } | null;

  assert.ok(jumpGeometry, 'jump pill should exist above the compose wrap');
  assert.ok(jumpGeometry!.pillBottom <= jumpGeometry!.wrapTop + 1, 'pill must sit above the compose wrap');
  assert.equal(jumpGeometry!.overlapsStop, false, 'pill must not cover Stop');

  // R2-1: Send and gear must sit inside the pane at both deck and sidebar widths.
  for (const size of [
    { width: 1100, height: 700 },
    { width: 760, height: 700 },
  ] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(30);
    const fit = (await page.evaluate(`(() => {
      const send = document.querySelector('.send-button');
      const gear = document.querySelector('.composer-gear');
      if (!send) return null;
      return {
        sendBottom: send.getBoundingClientRect().bottom,
        gearBottom: gear ? gear.getBoundingClientRect().bottom : null,
        innerHeight: window.innerHeight,
      };
    })()`)) as { sendBottom: number; gearBottom: number | null; innerHeight: number } | null;
    assert.ok(fit, `send button missing at ${size.width}x${size.height}`);
    assert.ok(
      fit!.sendBottom <= fit!.innerHeight,
      `R2-1 send.bottom ${fit!.sendBottom} > innerHeight ${fit!.innerHeight} at ${size.width}x${size.height}`,
    );
    if (fit!.gearBottom != null) {
      assert.ok(
        fit!.gearBottom <= fit!.innerHeight,
        `R2-1 gear.bottom ${fit!.gearBottom} > innerHeight ${fit!.innerHeight} at ${size.width}x${size.height}`,
      );
    }
  }

  // R4 / R3-1: at 760 the chip row must not overlap the context meter.
  await page.setViewportSize({ width: 760, height: 700 });
  await page.waitForTimeout(30);
  const chipMeter = (await page.evaluate(`(() => {
    const chips = document.querySelector('.meta-chips');
    const meter = document.querySelector('.conversation-meta .lanes-context-meter');
    if (!chips || !meter) return null;
    const a = chips.getBoundingClientRect();
    const b = meter.getBoundingClientRect();
    const overlaps =
      a.left < b.right - 1 &&
      a.right > b.left + 1 &&
      a.top < b.bottom - 1 &&
      a.bottom > b.top + 1;
    return {
      overlaps,
      chipsRight: a.right,
      meterLeft: b.left,
      chipsTop: a.top,
      meterTop: b.top,
    };
  })()`)) as {
    overlaps: boolean;
    chipsRight: number;
    meterLeft: number;
    chipsTop: number;
    meterTop: number;
  } | null;
  assert.ok(chipMeter, 'meta-chips and meter must exist at 760');
  assert.equal(
    chipMeter!.overlaps,
    false,
    `R4 chips overlap meter at 760 (chips.right=${chipMeter!.chipsRight} meter.left=${chipMeter!.meterLeft})`,
  );
});
