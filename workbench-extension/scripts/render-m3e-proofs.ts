/**
 * M3e Round-2 proofs (FIXLIST-R2.md): transcript from the scrubbed glm-catchup fixture.
 * DPR 2; muted Chromium; --no-sandbox; browser closed in finally.
 * Viewports: 1440×900 and 1100×700.
 *
 * PNGs under docs/verification/m3e-2026-09-14/:
 *   proof-seven-turns-{1440,1100}.png
 *   proof-tool-expanded-multiline-{1440,1100}.png
 *   proof-tool-error-{1440,1100}.png
 *   proof-thinking-expanded-{1440,1100}.png
 *   proof-meter-tooltip-real-{1440,1100}.png
 *   proof-meter-14pct-{1440,1100}.png
 *
 * Usage: npm run proof:m3e
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { normalizeCliLine } from '../src/adapters/cliAdapter.js';
import type { Conversation, RunEvent, TranscriptBlock } from '../src/domain.js';
import { contextCeilingFor } from '../src/services/contextCeiling.js';
import {
  findToolBlockForResult,
  reduceRunEventsToTurns,
} from '../src/services/runTranscript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test/fixtures');
const media = path.join(root, 'media');
const outDir = path.resolve(root, '../docs/verification/m3e-2026-09-14');
const DPR = 2;
const VIEWPORTS = [
  { width: 1440, height: 900, tag: '1440' },
  { width: 1100, height: 700, tag: '1100' },
] as const;

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/html; charset=utf-8';
}

const efforts = [{ id: 'default', label: 'Workbench default' }, { id: 'high', label: 'High' }];

function loadEvents(lines: string[]): RunEvent[] {
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

function buildConversationFromFixture(lines: string[]): {
  conversation: Conversation;
  occupancy: number;
  firstOccupancy: number;
  sessionSpend: number;
} {
  const events = loadEvents(lines);
  // Production bubble + correlation path (MAJOR 1).
  const turns = reduceRunEventsToTurns(events);

  for (const event of events) {
    if (event.type !== 'tool-result') continue;
    for (const turn of turns) {
      const match = findToolBlockForResult(turn.blocks, event.toolUseId);
      if (match) {
        match.status = event.ok ? 'ok' : 'error';
        match.resultPreview = event.preview;
        if (event.body !== undefined) match.result = event.body;
        break;
      }
    }
  }

  let occupancy = 0;
  let firstOccupancy = 0;
  let sessionSpend = 0;
  for (const event of events) {
    if (event.type === 'context-usage') {
      occupancy = event.usedTokens;
      if (!firstOccupancy) firstOccupancy = event.usedTokens;
    } else if (event.type === 'session-spend') {
      sessionSpend = event.tokens;
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
  for (const [index, turn] of turns.entries()) {
    const text = turn.blocks
      .filter((block): block is Extract<TranscriptBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n') || turn.text;
    messages.push({
      id: `asst-${index + 1}`,
      role: 'assistant',
      text,
      createdAt: now - 50_000 + index * 1000,
      status: 'complete',
      blocks: turn.blocks,
    });
  }

  const assistantCount = messages.filter((message) => message.role === 'assistant').length;
  if (assistantCount !== 7) {
    throw new Error(`expected 7 assistant bubbles, got ${assistantCount}`);
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
  await page.waitForSelector('.lanes-context-hovercard', { state: 'attached' });
  await page.waitForSelector('.card-chevron');
  await page.waitForSelector('.thinking-glyph');
  await page.waitForSelector('.tool-glyph');
  await page.waitForSelector('.assistant-bubble');
}

async function shootProofs(page: Page, tag: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  await page.locator('.message-stream').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(outDir, `proof-seven-turns-${tag}.png`),
    type: 'png',
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  });
  console.log(`wrote proof-seven-turns-${tag}.png`);

  const tool = page.locator('.tool-card', { hasText: 'git log --oneline -8' }).first();
  await tool.scrollIntoViewIfNeeded();
  await tool.locator('summary').click();
  await page.waitForTimeout(150);
  const resultText = await tool.locator('.tool-card-result').innerText();
  if (!resultText.includes('\n')) {
    throw new Error(`expanded tool result missing newlines: ${JSON.stringify(resultText)}`);
  }
  await tool.screenshot({
    path: path.join(outDir, `proof-tool-expanded-multiline-${tag}.png`),
    type: 'png',
  });
  console.log(`wrote proof-tool-expanded-multiline-${tag}.png`);
  await tool.locator('summary').click();

  const err = page.locator('.tool-card.status-error').first();
  await err.scrollIntoViewIfNeeded();
  await err.screenshot({ path: path.join(outDir, `proof-tool-error-${tag}.png`), type: 'png' });
  console.log(`wrote proof-tool-error-${tag}.png`);

  const thinking = page.locator('.thinking-card').first();
  await thinking.scrollIntoViewIfNeeded();
  const open = await thinking.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) await thinking.locator('summary').click();
  await page.waitForTimeout(150);
  await thinking.screenshot({
    path: path.join(outDir, `proof-thinking-expanded-${tag}.png`),
    type: 'png',
  });
  console.log(`wrote proof-thinking-expanded-${tag}.png`);
  await thinking.locator('summary').click();

  const meter = page.locator('.lanes-context-meter').first();
  await meter.scrollIntoViewIfNeeded();
  const titleAttr = await meter.getAttribute('title');
  if (titleAttr) throw new Error('meter still has native title= (LOOK G5 regression)');
  await meter.hover();
  await page.waitForTimeout(250);
  const hovercard = page.locator('.lanes-context-hovercard').first();
  await hovercard.waitFor({ state: 'visible' });
  const meterBox = await meter.boundingBox();
  const tipBox = await hovercard.boundingBox();
  if (!meterBox || !tipBox) throw new Error('meter/hovercard boxes missing');
  const x = Math.max(0, Math.min(meterBox.x, tipBox.x) - 8);
  const y = Math.max(0, Math.min(meterBox.y, tipBox.y) - 8);
  const width = Math.min(
    viewport.width - x,
    Math.max(meterBox.x + meterBox.width, tipBox.x + tipBox.width) - x + 16,
  );
  const height = Math.min(
    viewport.height - y,
    Math.max(meterBox.y + meterBox.height, tipBox.y + tipBox.height) - y + 16,
  );
  await page.screenshot({
    path: path.join(outDir, `proof-meter-tooltip-real-${tag}.png`),
    type: 'png',
    clip: { x, y, width, height },
  });
  console.log(`wrote proof-meter-tooltip-real-${tag}.png`);

  const label = await page.locator('.lanes-context-copy').first().innerText();
  if (!/\(14%\)/.test(label)) throw new Error(`expected 14% meter label, got ${JSON.stringify(label)}`);
  await meter.screenshot({ path: path.join(outDir, `proof-meter-14pct-${tag}.png`), type: 'png' });
  console.log(`wrote proof-meter-14pct-${tag}.png`);
}

async function main(): Promise<void> {
  const raw = await readFile(path.join(fixtures, 'glm-catchup-m3e.jsonl'), 'utf8');
  const lines = raw.split(/\r?\n/u).filter(Boolean);
  const built = buildConversationFromFixture(lines);
  if (built.occupancy !== 140_628) throw new Error(`expected occupancy 140628, got ${built.occupancy}`);
  if (built.firstOccupancy !== 132_479) throw new Error(`expected first 132479, got ${built.firstOccupancy}`);
  if (built.sessionSpend !== 957_944) throw new Error(`expected spend 957944, got ${built.sessionSpend}`);

  const gitLog = built.conversation.messages
    .flatMap((message) => message.blocks ?? [])
    .find((block) => block.type === 'tool' && /git log --oneline -8/.test(block.summary));
  if (!gitLog || gitLog.type !== 'tool' || !gitLog.result?.includes('\n')) {
    throw new Error('git log tool missing multiline result body for LOOK D1 proof');
  }

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
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: DPR,
      });
      await page.goto(`${base}/command?theme=paper`, { waitUntil: 'networkidle' });
      await injectState(
        page,
        built.conversation,
        built.occupancy,
        built.firstOccupancy,
        built.sessionSpend,
      );
      await page.waitForTimeout(250);
      await shootProofs(page, vp.tag);
      await page.close();
    }

    const aliases: Array<[string, string]> = [
      ['proof-seven-turns-1440.png', 'm3e-transcript-first.png'],
      ['proof-tool-expanded-multiline-1440.png', 'm3e-tool-card-expanded.png'],
      ['proof-thinking-expanded-1440.png', 'm3e-thinking-collapsed.png'],
      ['proof-meter-tooltip-real-1440.png', 'm3e-meter-tooltip.png'],
      ['proof-seven-turns-1440.png', 'proof-seven-turns.png'],
      ['proof-tool-expanded-multiline-1440.png', 'proof-tool-expanded-multiline.png'],
      ['proof-tool-error-1440.png', 'proof-tool-error.png'],
      ['proof-thinking-expanded-1440.png', 'proof-thinking-expanded.png'],
      ['proof-meter-tooltip-real-1440.png', 'proof-meter-tooltip-real.png'],
      ['proof-meter-14pct-1440.png', 'proof-meter-14pct.png'],
    ];
    for (const [from, to] of aliases) {
      await copyFile(path.join(outDir, from), path.join(outDir, to));
    }

    const whatChanged = `M3e R2: occupancy meter (140,628 → 14% of the door's 1M), real hovercard tooltip (preamble vs added), exchange-counted priorContext, decision text on the first block only, expanded tool cards keep full multiline results, thinking cards visually distinct with chevrons, assistant prose in contained bubbles. Dual-viewport DPR-2 proofs at 1440×900 and 1100×700.\n`;
    await writeFile(path.join(outDir, 'WHAT-CHANGED.md'), whatChanged);
    console.log('wrote WHAT-CHANGED.md');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
