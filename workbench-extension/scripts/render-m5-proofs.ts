/**
 * M5 proof frames + M4 scroll stability check.
 * Viewports: 1100×700 (deck) and 760×700 (sidebar / min pane).
 *
 * Usage: npx tsx scripts/render-m5-proofs.ts
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import type { Conversation, RunEvent, TranscriptBlock } from '../src/domain.js';
import { contextCeilingFor } from '../src/services/contextCeiling.js';
import { reduceRunEventsToTurns } from '../src/services/runTranscript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test/fixtures');
const media = path.join(root, 'media');
const outDir = path.resolve(root, '../docs/verification/m5-2026-09-14');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DPR = 2;
const VIEWPORTS = [
  { width: 1100, height: 700, tag: '1100x700' },
  { width: 760, height: 700, tag: 'sidebar-760x700' },
] as const;

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.html')) return 'text/html';
  return 'application/octet-stream';
}

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let filePath = '';
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(deckHtml);
        return;
      }
      if (url.pathname.startsWith('/media/')) {
        filePath = path.join(media, url.pathname.slice('/media/'.length));
      } else {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end('error');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function snapshot() {
  const ceiling = contextCeilingFor('glm-ollama-cc');
  return {
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
        contextCeiling: ceiling,
      },
    ],
  };
}

function loadConversation(): Conversation {
  const lines = fs.readFileSync(path.join(fixtures, 'glm-catchup-m3e.jsonl'), 'utf8')
    .split(/\r?\n/u).filter(Boolean);
  const events: RunEvent[] = [];
  for (const line of lines) {
    const normalized = normalizeCliLine('glm-ollama-cc', line);
    if (!normalized) continue;
    for (const event of Array.isArray(normalized) ? normalized : [normalized]) events.push(event);
  }
  const turns = reduceRunEventsToTurns(events);
  const now = Date.now();
  const messages = [
    {
      id: 'user-1',
      role: 'user' as const,
      text: 'Catch up and report status.',
      createdAt: now - 60_000,
      status: 'complete' as const,
    },
    ...turns.map((turn, index) => ({
      id: `asst-${index + 1}`,
      role: 'assistant' as const,
      text: turn.blocks.filter((b): b is Extract<TranscriptBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n\n'),
      createdAt: now - 50_000 + index * 1000,
      status: 'complete' as const,
      blocks: turn.blocks,
    })),
    {
      id: 'user-queued',
      role: 'user' as const,
      text: 'Steer: after the sleep, also check git status.',
      createdAt: now - 5_000,
      status: 'complete' as const,
      delivery: 'queued' as const,
    },
  ];
  return {
    id: 'm5-proof',
    kind: 'orchestrator',
    title: 'M5 seat experience',
    target: { kind: 'general' },
    laneId: 'glm-ollama-cc',
    seat: 'orchestrate',
    effort: 'default',
    permission: 'read',
    context: [],
    messages,
    decisions: [],
    createdAt: now - 120_000,
    updatedAt: now,
  };
}

const deckHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Command · M5 proof</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
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
</body>
</html>`;

async function inject(page: Page, conversation: Conversation): Promise<void> {
  await page.evaluate(
    ({ snap, conversation }) => {
      (window as unknown as { __m5ConversationId?: string }).__m5ConversationId = conversation.id;
      window.postMessage({
        type: 'state',
        snapshot: snap,
        conversations: [conversation],
        orchestratorSessionId: conversation.id,
        notes: {},
        operatorDisplayName: 'Ray',
        lanesBadgeCount: 0,
        deskBadgeCount: 0,
        auxFocus: null,
      }, '*');
      window.postMessage({
        type: 'run-event',
        conversationId: conversation.id,
        event: {
          type: 'tool',
          text: 'Bash · sleep 150',
          name: 'Bash',
          summary: 'sleep 150',
          detail: 'sleep 150',
        },
      }, '*');
      window.postMessage({
        type: 'context-usage',
        conversationId: conversation.id,
        usedTokens: 140_628,
      }, '*');
    },
    { snap: snapshot(), conversation },
  );
  await page.waitForSelector('.message-stream');
  await page.waitForSelector('.activity-strip');
  await page.waitForSelector('.delivery-chip.queued');
  await page.waitForSelector('#prompt:not([disabled])');
}

async function assertScrollStable(page: Page, conversationId: string): Promise<{ before: number; after: number }> {
  return page.evaluate(async ({ conversationId }) => {
    const stream = document.querySelector('.message-stream') as HTMLElement | null;
    if (!stream) throw new Error('no message-stream');
    // FIX 7: non-zero mid-scroll — the old full-rebuild path also preserved scrollTop=0.
    stream.scrollTop = Math.min(240, Math.max(40, stream.scrollHeight - stream.clientHeight - 80));
    const before = stream.scrollTop;
    if (before < 1) throw new Error(`expected mid-scroll > 0, got ${before}`);
    for (let i = 0; i < 20; i += 1) {
      window.postMessage({
        type: 'run-event',
        conversationId,
        event: { type: 'tool', text: `Bash · echo ${i}`, name: 'Bash', summary: `echo ${i}` },
      }, '*');
      window.postMessage({
        type: 'context-usage',
        conversationId,
        usedTokens: 140_000 + i,
      }, '*');
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = stream.scrollTop;
    return { before, after };
  }, { conversationId });
}

async function assertMeterFill(page: Page, usedTokens: number, expectedPercent: number): Promise<void> {
  const measured = await page.evaluate(({ usedTokens }) => {
    const conversationId = (window as unknown as { __m5ConversationId?: string }).__m5ConversationId;
    if (!conversationId) throw new Error('missing conversation id');
    window.postMessage({ type: 'context-usage', conversationId, usedTokens }, '*');
    return new Promise<{ fill: number; label: string }>((resolve) => {
      requestAnimationFrame(() => {
        const fill = document.querySelector('.lanes-context-fill') as HTMLElement | null;
        const label = document.querySelector('.lanes-context-copy')?.textContent || '';
        const width = fill ? Number.parseFloat(fill.style.width || '0') : -1;
        resolve({ fill: width, label });
      });
    });
  }, { usedTokens });
  assert.ok(Math.abs(measured.fill - expectedPercent) <= 1, `fill ${measured.fill} vs ${expectedPercent}; label=${measured.label}`);
  assert.match(measured.label, new RegExp(`\\(${expectedPercent}%\\)`));
}

async function resolveChromiumExecutable(): Promise<string | undefined> {
  // R2-7: same resolve-or-skip treatment as the behavioural test harness.
  const pinned = chromium.executablePath();
  const override = process.env.GS_CHROMIUM_EXECUTABLE;
  if (fs.existsSync(pinned)) return undefined; // use playwright default
  if (override && fs.existsSync(override)) return override;
  throw new Error(
    `no chromium for playwright's pinned revision (${pinned}); set GS_CHROMIUM_EXECUTABLE or run: npx playwright install chromium`,
  );
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  const executablePath = await resolveChromiumExecutable();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const conversation = loadConversation();
  const scrollProof: Record<string, unknown> = {};
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: DPR,
      });
      await page.goto(`${server.url}/?theme=paper`, { waitUntil: 'networkidle' });
      await inject(page, conversation);

      const streamRatio = await page.evaluate(() => {
        const stream = document.querySelector('.message-stream') as HTMLElement | null;
        const shell = document.querySelector('.conversation-shell') as HTMLElement | null;
        if (!stream || !shell) return 0;
        return stream.getBoundingClientRect().height / shell.getBoundingClientRect().height;
      });

      // R2-1: Send must sit inside the pane (restored context row must not push it below the fold).
      const sendFit = await page.evaluate(() => {
        const send = document.querySelector('.send-button') as HTMLElement | null;
        if (!send) return null;
        return { bottom: send.getBoundingClientRect().bottom, innerHeight: window.innerHeight };
      });
      if (!sendFit) throw new Error(`send button missing at ${viewport.tag}`);
      if (sendFit.bottom > sendFit.innerHeight) {
        throw new Error(`R2-1 send.bottom ${sendFit.bottom} > innerHeight ${sendFit.innerHeight} at ${viewport.tag}`);
      }

      const framePath = path.join(outDir, `proof-live-strip-composer-${viewport.tag}-${stamp}.png`);
      await page.screenshot({ path: framePath, fullPage: false });

      const scroll = await assertScrollStable(page, conversation.id);
      scrollProof[viewport.tag] = { ...scroll, streamRatio, delta: Math.abs(scroll.after - scroll.before) };
      if (Math.abs(scroll.after - scroll.before) > 1) {
        throw new Error(`M4 scroll moved by ${scroll.after - scroll.before}px at ${viewport.tag}`);
      }
      

      

      

      if (streamRatio < 0.7) {
        throw new Error(`M5 transcript ratio ${streamRatio} < 0.70 at ${viewport.tag}`);
      }

      // M7: bar fill width must match tooltip percent (CSP-safe CSSOM path).
      if (viewport.tag === '1100x700') {
        const ceiling = 1_048_576;
        for (const [pct, used] of [
          [5, Math.round(ceiling * 0.05)],
          [13, Math.round(ceiling * 0.13)],
          [50, Math.round(ceiling * 0.5)],
        ] as const) {
          await assertMeterFill(page, used, pct);
          const meterPath = path.join(outDir, `proof-meter-${pct}pct-${viewport.tag}-${stamp}.png`);
          await page.screenshot({ path: meterPath, fullPage: false });
        }
        // Restore the live-strip occupancy (~13%) for idle frames below.
        await assertMeterFill(page, 140_628, 13);
      }

      // Idle strip frame after run completes
      await page.evaluate((id) => {
        window.postMessage({
          type: 'conversation-delta',
          conversationId: id,
          messageId: 'asst-1',
          text: 'Round complete.',
          status: 'complete',
        }, '*');
      }, conversation.id);
      await page.waitForTimeout(50);
      const idlePath = path.join(outDir, `proof-idle-strip-${viewport.tag}-${stamp}.png`);
      await page.screenshot({ path: idlePath, fullPage: false });
      await page.close();
    }
    await writeFile(path.join(outDir, `scroll-stability-${stamp}.json`), `${JSON.stringify(scrollProof, null, 2)}\n`);
    console.log(JSON.stringify({ outDir, stamp, scrollProof }, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
