/**
 * M3d proofs: deck alone at 1280/1024 (paper+night), deck + Lanes aux,
 * Sessions list with three sessions incl. one archived.
 * Writes docs/handoffs/GS-HARNESS-M3D-PROOF-*.png
 *
 * Usage: npx tsx scripts/render-m3d-proofs.ts
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildLanesPanelModel } from '../src/lanesPanelModel.js';
import { parseLaneDeskStatus } from '../src/services/laneDeskStatus.js';
import { buildSessionsViewModel } from '../src/services/sessionsModel.js';
import type { Conversation } from '../src/domain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test/fixtures');
const media = path.join(root, 'media');
const outDir = path.resolve(root, '../docs/handoffs');

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtures, name), 'utf8')) as unknown;
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'text/html; charset=utf-8';
}

const efforts = [{ id: 'default', label: 'Workbench default' }, { id: 'high', label: 'High' }];
function ceiling(tokens: number | null, provenance: string, modelLabel: string) {
  return { tokens, provenance, modelLabel };
}

function deckSnapshot() {
  return {
    rootPath: '/fleet/private',
    generatedAt: Date.now(),
    projects: [
      { id: 'generalstaff-desktop', name: 'generalstaff-desktop', statePath: '/fleet/private/state/gs', mission: 'Ship the harness.', pending: 1, inProgress: 2, needsReview: 0, completed: 4, artifacts: [] },
    ],
    attention: [
      { id: 'a1', kind: 'decision', title: 'Gate the M3d panels', detail: 'Lanes and Desk must leave the deck alone.', projectId: 'generalstaff-desktop' },
    ],
    activity: [
      { id: 'act1', title: 'Context ceiling shipped', detail: '0.4.15 · stated / native labels', when: Date.now() - 3_600_000, tone: 'ok' },
    ],
    skills: [],
    capabilities: [],
    lanes: [
      { id: 'claude', runner: 'claude', name: 'Claude Fable', detail: 'Judgment seat', evidenceLabel: 'Daily operator seat', state: 'available', roles: ['orchestrate', 'build', 'review', 'verify', 'assist'], permissions: ['read', 'write'], efforts, defaultEffort: 'default', contextCeiling: ceiling(1000000, 'native', 'fable') },
      { id: 'deepseek-ollama-cc', runner: 'deepseek-ollama-cc', name: 'DeepSeek V4.1 Flash · Workbench seat', detail: 'Claude Code · 1M context', evidenceLabel: 'Ollama Cloud CC door', state: 'available', roles: ['orchestrate', 'build', 'review', 'verify', 'assist'], permissions: ['read', 'write'], efforts, defaultEffort: 'default', contextCeiling: ceiling(1048576, 'stated', 'deepseek-v4.1-flash') },
      { id: 'codex', runner: 'codex', name: 'Codex', detail: 'GPT-class agentic work', evidenceLabel: 'Repo-proven', state: 'available', roles: ['orchestrate', 'build', 'review', 'verify', 'assist'], permissions: ['read', 'write'], efforts, defaultEffort: 'default', contextCeiling: ceiling(null, 'unknown', 'gpt-5.6-sol') },
    ],
  };
}

function fixtureConversations(): Conversation[] {
  const now = Date.now();
  return [
    {
      id: 'sess-active',
      kind: 'orchestrator',
      title: 'deepseek test',
      target: { kind: 'general' },
      laneId: 'deepseek-ollama-cc',
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      context: [],
      messages: [
        { id: 'm1', role: 'user', text: 'deepseek test catch-up on the fleet', createdAt: now - 86_400_000, status: 'complete' },
        { id: 'm2', role: 'assistant', text: 'Catch-up complete. Lanes are quiet.', createdAt: now - 86_300_000, status: 'complete' },
      ],
      decisions: [],
      createdAt: now - 86_400_000,
      updatedAt: now - 3_600_000,
      receipt: {
        laneId: 'deepseek-ollama-cc',
        laneName: 'DeepSeek V4.1 Flash',
        seat: 'orchestrate',
        effort: 'default',
        target: { kind: 'general' },
        modelLabel: 'deepseek-v4.1-flash · 1.05M',
        startedAt: now - 86_350_000,
        finishedAt: now - 86_300_000,
        exitCode: 0,
        stopped: false,
        permission: 'read',
        workingDirectory: '/fleet/private',
        evidence: [],
        continuity: 'new',
      },
    },
    {
      id: 'sess-fresh',
      kind: 'orchestrator',
      title: 'Orchestrator session',
      target: { kind: 'general' },
      laneId: 'claude',
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      context: [],
      messages: [],
      decisions: [],
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
    },
    {
      id: 'sess-archived',
      kind: 'orchestrator',
      title: 'Old Codex routing check',
      target: { kind: 'general' },
      laneId: 'codex',
      seat: 'orchestrate',
      effort: 'high',
      permission: 'read',
      context: [],
      messages: [{ id: 'm3', role: 'user', text: 'Old Codex routing check', createdAt: now - 604_800_000, status: 'complete' }],
      decisions: [],
      createdAt: now - 604_800_000,
      updatedAt: now - 500_000_000,
      archivedAt: now - 86_400_000,
      receipt: {
        laneId: 'codex',
        laneName: 'Codex',
        seat: 'orchestrate',
        effort: 'high',
        target: { kind: 'general' },
        modelLabel: 'gpt-5.6-sol · high',
        startedAt: now - 604_700_000,
        finishedAt: now - 604_600_000,
        exitCode: 0,
        stopped: false,
        permission: 'read',
        workingDirectory: '/fleet/private',
        evidence: [],
        continuity: 'new',
      },
    },
  ];
}

const deckHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Command · M3d proof</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script src="/media/operatorIdentity.js"></script>
  <script src="/media/composerKeys.js"></script>
  <script>
    (function () {
      var params = new URLSearchParams(location.search);
      var theme = params.get('theme') || 'paper';
      var store = {
        selectedTheme: theme,
        selectedLaneId: 'claude',
        selectedSeat: 'orchestrate',
        selectedEffort: 'default',
        selectedPermission: 'read'
      };
      window.acquireVsCodeApi = function () {
        return {
          getState: function () { return store; },
          setState: function (next) { store = Object.assign({}, store, next || {}); },
          postMessage: function () {},
        };
      };
    })();
  </script>
  <script src="/media/workbench.js"></script>
</body>
</html>`;

const lanesHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Lanes · M3d aux proof</title>
</head>
<body>
  <div id="app" aria-live="polite">
    <div class="boot"><div class="boot-mark">GS</div></div>
  </div>
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
  <script src="/media/lanes.js"></script>
</body>
</html>`;

const splitHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Deck + Lanes · M3d</title>
  <style>
    html, body { margin: 0; height: 100%; }
    .split { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: 100vh; }
    .split iframe { width: 100%; height: 100%; border: 0; border-left: 1px solid #2a2a2a; }
  </style>
</head>
<body>
  <div class="split">
    <iframe id="deck" src="/command?theme=paper" title="Command Deck"></iframe>
    <iframe id="lanes" src="/lanes?theme=paper" title="Lanes"></iframe>
  </div>
</body>
</html>`;

function sessionsHtml(modelJson: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Sessions · M3d</title>
  <style>
    body { margin: 0; background: var(--ink, #1a1814); color: var(--paper, #f4f0e6); }
    .sessions-proof { width: 320px; min-height: 100vh; padding: 18px 14px; border-right: 1px solid var(--line); background: rgb(var(--surface-rgb) / 0.92); font-family: "IBM Plex Sans", "Source Sans 3", sans-serif; }
    .sessions-proof h1 { margin: 0 0 14px; font-family: Georgia, "Times New Roman", serif; font-size: 18px; font-weight: 500; }
    .sessions-proof .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
    .sessions-proof .toolbar button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font-size: 11px; }
    .section { margin-bottom: 18px; }
    .section h2 { margin: 0 0 8px; color: var(--brass); font-size: 9px; font-weight: 650; letter-spacing: 0.14em; text-transform: uppercase; }
    .row { display: grid; gap: 2px; padding: 8px 6px; border-bottom: 1px solid rgb(var(--text-rgb) / 0.08); }
    .row.active { background: rgb(var(--text-rgb) / 0.04); }
    .row.archived { opacity: 0.72; }
    .row strong { font-size: 12px; font-weight: 600; }
    .row small { color: var(--paper-muted); font-size: 10px; }
  </style>
</head>
<body data-theme="paper">
  <aside class="sessions-proof" id="sessions-root"></aside>
  <script>
    var model = ${modelJson};
    function row(item) {
      return '<div class="row ' + (item.active ? 'active' : '') + (item.archived ? ' archived' : '') + '">' +
        '<strong>' + item.title + '</strong>' +
        '<small>' + item.relativeTime + ' · ' + item.laneLabel + '</small>' +
      '</div>';
    }
    var html = '<h1>Sessions</h1><div class="toolbar"><button>New session</button><button>Filter</button></div>';
    html += '<div class="section"><h2>Orchestrator</h2>' + model.orchestrator.map(row).join('') + '</div>';
    html += '<div class="section"><h2>Projects</h2>' + (model.projects.length
      ? model.projects.map(function (p) {
          return '<div><strong style="font-size:11px">' + p.projectName + '</strong>' + p.sessions.map(row).join('') + '</div>';
        }).join('')
      : '<small style="opacity:.6">No project sessions</small>') + '</div>';
    html += '<div class="section"><h2>Archived</h2>' + model.archived.map(row).join('') + '</div>';
    document.getElementById('sessions-root').innerHTML = html;
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const conversations = fixtureConversations();
  const sessionsModel = buildSessionsViewModel(
    conversations,
    new Set(['sess-fresh']),
    new Map([['generalstaff-desktop', 'generalstaff-desktop']]),
  );
  const status = parseLaneDeskStatus(await readJson('lanes-status-partial.json'));
  const lanesModel = buildLanesPanelModel(status);

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0] || '/';
      if (pathname === '/command' || pathname.startsWith('/command')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(deckHtml);
        return;
      }
      if (pathname === '/lanes' || pathname.startsWith('/lanes')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(lanesHtml);
        return;
      }
      if (pathname === '/split') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(splitHtml);
        return;
      }
      if (pathname === '/sessions') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(sessionsHtml(JSON.stringify(sessionsModel)));
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
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--disable-audio-output'],
  });

  async function postDeckState(page: import('playwright').Page, theme: string, activeId: string): Promise<void> {
    await page.goto(`${base}/command?theme=${theme}`, { waitUntil: 'networkidle' });
    await page.evaluate(
      ({ snapshot, conversations, activeId }) => {
        window.postMessage({
          type: 'state',
          snapshot,
          conversations,
          orchestratorSessionId: activeId,
          notes: {},
          operatorDisplayName: 'Ray',
          lanesBadgeCount: 2,
          deskBadgeCount: 1,
        }, '*');
      },
      { snapshot: deckSnapshot(), conversations, activeId },
    );
    await page.waitForSelector('.topbar');
    await page.waitForSelector('[data-action="toggle-lanes"]');
    await page.waitForSelector('[data-action="new-session"]');
    const bench = await page.locator('.lane-section').count();
    if (bench !== 0) throw new Error('model bench must be removed from the deck');
  }

  const deckShots: Array<{ name: string; theme: string; width: number; height: number }> = [
    { name: 'GS-HARNESS-M3D-PROOF-deck-1280-paper.png', theme: 'paper', width: 1280, height: 800 },
    { name: 'GS-HARNESS-M3D-PROOF-deck-1280-night.png', theme: 'night', width: 1280, height: 800 },
    { name: 'GS-HARNESS-M3D-PROOF-deck-1024-paper.png', theme: 'paper', width: 1024, height: 768 },
    { name: 'GS-HARNESS-M3D-PROOF-deck-1024-night.png', theme: 'night', width: 1024, height: 768 },
  ];

  for (const shot of deckShots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    });
    await postDeckState(page, shot.theme, 'sess-fresh');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, shot.name), type: 'png' });
    console.log('wrote', shot.name);
    await page.close();
  }

  {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}/split`, { waitUntil: 'networkidle' });
    const deckFrame = page.frames().find((frame) => frame.url().includes('/command'));
    const lanesFrame = page.frames().find((frame) => frame.url().includes('/lanes'));
    if (!deckFrame || !lanesFrame) throw new Error('split frames missing');
    await deckFrame.waitForLoadState('domcontentloaded');
    await lanesFrame.waitForLoadState('domcontentloaded');
    await deckFrame.evaluate(
      ({ snapshot, conversations }) => {
        window.postMessage({
          type: 'state',
          snapshot,
          conversations,
          orchestratorSessionId: 'sess-fresh',
          notes: {},
          operatorDisplayName: 'Ray',
          lanesBadgeCount: 2,
          deskBadgeCount: 1,
        }, '*');
      },
      { snapshot: deckSnapshot(), conversations },
    );
    await lanesFrame.evaluate((model) => {
      window.postMessage({ type: 'lanes-model', model }, '*');
    }, lanesModel);
    await deckFrame.waitForSelector('.topbar');
    await lanesFrame.waitForSelector('#app');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'GS-HARNESS-M3D-PROOF-deck-lanes-aux-paper.png'), type: 'png' });
    console.log('wrote GS-HARNESS-M3D-PROOF-deck-lanes-aux-paper.png');
    await page.close();
  }

  {
    const page = await browser.newPage({
      viewport: { width: 360, height: 720 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}/sessions`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sessions-proof');
    const archived = await page.locator('.row.archived').count();
    if (archived < 1) throw new Error('sessions proof needs an archived row');
    const active = await page.locator('.row.active').count();
    if (active < 1) throw new Error('sessions proof needs an active row');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, 'GS-HARNESS-M3D-PROOF-sessions-paper.png'), type: 'png' });
    console.log('wrote GS-HARNESS-M3D-PROOF-sessions-paper.png');
    await page.close();
  }

  await browser.close();
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
