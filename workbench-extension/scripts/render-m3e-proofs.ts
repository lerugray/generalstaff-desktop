/**
 * M3e proofs: transcript pane from the scrubbed glm-catchup fixture.
 * DPR 2; muted Chromium; --no-sandbox; browser closed in finally.
 *
 * PNGs under docs/verification/m3e-2026-09-14/:
 *   m3e-transcript-first.png
 *   m3e-tool-card-expanded.png
 *   m3e-thinking-collapsed.png
 *   m3e-meter-tooltip.png
 *
 * Usage: npx tsx scripts/render-m3e-proofs.ts
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import type { Conversation, TranscriptBlock } from '../src/domain.js';
import { contextCeilingFor } from '../src/services/contextCeiling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test/fixtures');
const media = path.join(root, 'media');
const outDir = path.resolve(root, '../docs/verification/m3e-2026-09-14');

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/html; charset=utf-8';
}

const efforts = [{ id: 'default', label: 'Workbench default' }, { id: 'high', label: 'High' }];

function buildConversationFromFixture(lines: string[]): {
  conversation: Conversation;
  occupancy: number;
  firstOccupancy: number;
  sessionSpend: number;
} {
  const blocksByTurn = new Map<string, TranscriptBlock[]>();
  const turnOrder: string[] = [];
  let occupancy = 0;
  let firstOccupancy = 0;
  let sessionSpend = 0;
  const pendingTools = new Map<string, Extract<TranscriptBlock, { type: 'tool' }>>();

  for (const line of lines) {
    const normalized = normalizeCliLine('glm-ollama-cc', line);
    if (!normalized) continue;
    for (const event of Array.isArray(normalized) ? normalized : [normalized]) {
      if (event.type === 'context-usage') {
        occupancy = event.usedTokens;
        if (!firstOccupancy) firstOccupancy = event.usedTokens;
        continue;
      }
      if (event.type === 'session-spend') {
        sessionSpend = event.tokens;
        continue;
      }
      if (event.type === 'tool-result') {
        const match = event.toolUseId
          ? pendingTools.get(event.toolUseId)
          : [...pendingTools.values()].at(-1);
        if (match) {
          match.status = event.ok ? 'ok' : 'error';
          match.resultPreview = event.preview;
        }
        continue;
      }
      const turnId = 'turnId' in event && event.turnId ? event.turnId : 'orphan';
      if (!blocksByTurn.has(turnId)) {
        blocksByTurn.set(turnId, []);
        turnOrder.push(turnId);
      }
      const blocks = blocksByTurn.get(turnId)!;
      if (event.type === 'thinking') {
        blocks.push({ type: 'thinking', text: event.text });
      } else if (event.type === 'assistant-delta') {
        const last = blocks[blocks.length - 1];
        if (last?.type === 'text') last.text += event.text;
        else blocks.push({ type: 'text', text: event.text });
      } else if (event.type === 'tool') {
        const tool: Extract<TranscriptBlock, { type: 'tool' }> = {
          type: 'tool',
          ...(event.toolUseId ? { id: event.toolUseId } : {}),
          name: event.name ?? event.text,
          summary: event.summary ?? event.text,
          ...(event.detail ? { detail: event.detail } : {}),
          status: 'running',
        };
        blocks.push(tool);
        if (event.toolUseId) pendingTools.set(event.toolUseId, tool);
      }
    }
  }

  const now = Date.now();
  const messages: Conversation['messages'] = [
    {
      id: 'user-1',
      role: 'user',
      text: 'Greetings GLM - please catch up with the latest session note and then touch base.',
      createdAt: now - 60_000,
      status: 'complete',
    },
  ];
  for (const [index, turnId] of turnOrder.entries()) {
    const blocks = blocksByTurn.get(turnId) ?? [];
    const text = blocks
      .filter((block): block is Extract<TranscriptBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
    messages.push({
      id: `asst-${index + 1}`,
      role: 'assistant',
      text,
      createdAt: now - 50_000 + index * 1000,
      status: 'complete',
      blocks,
    });
  }

  const ceiling = contextCeilingFor('glm-ollama-cc');
  return {
    occupancy,
    firstOccupancy,
    sessionSpend,
    conversation: {
      id: 'm3e-catchup',
      kind: 'orchestrator',
      title: 'glm catch-up',
      target: { kind: 'general' },
      laneId: 'glm-ollama-cc',
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      context: [],
      messages,
      decisions: [],
      createdAt: now - 60_000,
      updatedAt: now,
      receipt: {
        laneId: 'glm-ollama-cc',
        laneName: 'GLM 5.3 · Workbench seat',
        seat: 'orchestrate',
        effort: 'default',
        target: { kind: 'general' },
        modelLabel: `${ceiling.modelLabel} · 1M`,
        startedAt: now - 55_000,
        finishedAt: now - 20_000,
        exitCode: 0,
        stopped: false,
        permission: 'read',
        workingDirectory: '<repo>',
        evidence: [],
        continuity: 'new',
      },
    },
  };
}

function snapshot() {
  const ceiling = contextCeilingFor('glm-ollama-cc');
  return {
    rootPath: '/fleet/private',
    generatedAt: Date.now(),
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
        detail: 'Claude Code · 1M context',
        evidenceLabel: 'Ollama Cloud CC door',
        state: 'available',
        roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
        permissions: ['read', 'write'],
        efforts,
        defaultEffort: 'default',
        contextCeiling: ceiling,
      },
      {
        id: 'claude',
        runner: 'claude',
        name: 'Claude Fable',
        detail: 'Judgment seat',
        evidenceLabel: 'Daily operator seat',
        state: 'available',
        roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
        permissions: ['read', 'write'],
        efforts,
        defaultEffort: 'default',
        contextCeiling: contextCeilingFor('claude'),
      },
    ],
  };
}

const deckHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Command · M3e transcript proof</title>
  <style>
    .meter-tooltip-proof {
      margin-top: 6px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: rgb(var(--surface-2-rgb) / 0.85);
      color: var(--paper-muted);
      font-size: 11px;
      line-height: 1.4;
      max-width: 28rem;
    }
  </style>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script src="/media/operatorIdentity.js"></script>
  <script src="/media/composerKeys.js"></script>
  <script>
    (function () {
      var params = new URLSearchParams(location.search);
      var theme = params.get('theme') || 'paper';
      var store = { selectedTheme: theme };
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

async function injectState(
  page: Page,
  conversation: Conversation,
  occupancy: number,
  firstOccupancy: number,
  sessionSpend: number,
): Promise<void> {
  await page.evaluate(
    ({ snap, conversation, occupancy, firstOccupancy, sessionSpend }) => {
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
        type: 'context-usage',
        conversationId: conversation.id,
        usedTokens: firstOccupancy,
      }, '*');
      window.postMessage({
        type: 'context-usage',
        conversationId: conversation.id,
        usedTokens: occupancy,
        sessionSpend,
      }, '*');
    },
    { snap: snapshot(), conversation, occupancy, firstOccupancy, sessionSpend },
  );
  await page.waitForSelector('.message-stream');
  await page.waitForSelector('.lanes-context-meter');
  await page.waitForSelector('.tool-card');
  await page.waitForSelector('.thinking-card');
}

async function main(): Promise<void> {
  const raw = await readFile(path.join(fixtures, 'glm-catchup-m3e.jsonl'), 'utf8');
  const lines = raw.split(/\r?\n/u).filter(Boolean);
  const built = buildConversationFromFixture(lines);
  if (built.occupancy !== 140_628) throw new Error(`expected occupancy 140628, got ${built.occupancy}`);
  if (built.firstOccupancy !== 132_479) throw new Error(`expected first 132479, got ${built.firstOccupancy}`);
  if (built.sessionSpend !== 957_944) throw new Error(`expected spend 957944, got ${built.sessionSpend}`);

  await mkdir(outDir, { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      const pathname = (req.url || '/').split('?')[0] || '/';
      if (pathname === '/' || pathname === '/command') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(deckHtml);
        return;
      }
      if (pathname.startsWith('/media/')) {
        const file = path.join(media, pathname.slice('/media/'.length));
        if (!file.startsWith(media)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': contentType(file) });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--disable-audio-output', '--no-sandbox'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/command?theme=paper`, { waitUntil: 'networkidle' });
    await injectState(page, built.conversation, built.occupancy, built.firstOccupancy, built.sessionSpend);
    await page.waitForTimeout(250);

    // First screen of the transcript pane.
    await page.locator('.message-stream').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({
      path: path.join(outDir, 'm3e-transcript-first.png'),
      type: 'png',
      clip: { x: 0, y: 0, width: 1100, height: 900 },
    });
    console.log('wrote m3e-transcript-first.png');

    // Expanded tool card (Bash · git log).
    const tool = page.locator('.tool-card', { hasText: 'git log --oneline -8' }).first();
    await tool.scrollIntoViewIfNeeded();
    await tool.locator('summary').click();
    await page.waitForTimeout(150);
    await tool.screenshot({ path: path.join(outDir, 'm3e-tool-card-expanded.png'), type: 'png' });
    console.log('wrote m3e-tool-card-expanded.png');

    // Collapsed thinking card.
    const thinking = page.locator('.thinking-card').first();
    await thinking.scrollIntoViewIfNeeded();
    const open = await thinking.evaluate((el) => (el as HTMLDetailsElement).open);
    if (open) await thinking.locator('summary').click();
    await page.waitForTimeout(100);
    await thinking.screenshot({ path: path.join(outDir, 'm3e-thinking-collapsed.png'), type: 'png' });
    console.log('wrote m3e-thinking-collapsed.png');

    // Meter strip + tooltip copy (native title surfaced for the proof).
    const meter = page.locator('.lanes-context-meter').first();
    await meter.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const el = document.querySelector('.lanes-context-meter');
      if (!el) return;
      document.querySelector('.meter-tooltip-proof')?.remove();
      const tip = document.createElement('div');
      tip.className = 'meter-tooltip-proof';
      tip.textContent = el.getAttribute('title') || '';
      el.insertAdjacentElement('afterend', tip);
    });
    await page.waitForSelector('.meter-tooltip-proof');
    const meterBox = await meter.boundingBox();
    const tipBox = await page.locator('.meter-tooltip-proof').boundingBox();
    if (!meterBox || !tipBox) throw new Error('meter/tooltip boxes missing');
    const x = Math.min(meterBox.x, tipBox.x) - 8;
    const y = Math.min(meterBox.y, tipBox.y) - 8;
    const width = Math.max(meterBox.x + meterBox.width, tipBox.x + tipBox.width) - x + 8;
    const height = Math.max(meterBox.y + meterBox.height, tipBox.y + tipBox.height) - y + 8;
    await page.screenshot({
      path: path.join(outDir, 'm3e-meter-tooltip.png'),
      type: 'png',
      clip: { x, y, width, height },
    });
    console.log('wrote m3e-meter-tooltip.png');

    const whatChanged = `M3e makes the context meter report occupancy (latest assistant input+cache_read+cache_creation = 140,628 → 14% of the door's 1M ceiling), not cumulative session spend (957,944 which previously showed as 91% of 1.05M). The CC-door picker ceiling now matches CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000. The transcript renders one bubble per assistant turn with collapsible tool cards (name · one-line label · ok/error) and collapsed thinking cards, and the meter tooltip shows preamble vs added plus session spend.\n`;
    await writeFile(path.join(outDir, 'WHAT-CHANGED.md'), whatChanged);
    console.log('wrote WHAT-CHANGED.md');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
