/**
 * M3c proofs: seat picker (Command) + Lanes detail with context meter.
 * paper + night. Writes docs/handoffs/GS-HARNESS-M3C-PROOF-*.png
 *
 * Usage: npx tsx scripts/render-m3c-proofs.ts
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  buildLaneDetailModel,
  buildLanesPanelModel,
} from '../src/lanesPanelModel.js';
import { contextCeilingFor } from '../src/services/contextCeiling.js';
import {
  parseLaneDeskDetail,
  parseLaneDeskHarvest,
} from '../src/services/laneDeskDetail.js';
import { parseLaneDeskStatus } from '../src/services/laneDeskStatus.js';

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

const lanesHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Lanes · M3c proof</title>
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

const seatPickerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Command · M3c seat picker</title>
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
        selectedLaneId: 'deepseek-ollama-cc',
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
  <script>
    (function () {
      var ceiling = function (tokens, provenance, modelLabel) {
        return { tokens: tokens, provenance: provenance, modelLabel: modelLabel };
      };
      var efforts = [{ id: 'default', label: 'Workbench default' }, { id: 'high', label: 'High' }];
      var snapshot = {
        rootPath: '/fleet/private',
        generatedAt: Date.now(),
        projects: [],
        attention: [],
        activity: [],
        skills: [],
        capabilities: [],
        lanes: [
          { id: 'codex', runner: 'codex', name: 'Codex', detail: 'GPT-class agentic work', evidenceLabel: 'Repo-proven', state: 'available', roles: ['orchestrate','build','review','verify','assist'], permissions: ['read','write'], efforts: efforts, defaultEffort: 'default', contextCeiling: ceiling(null, 'unknown', 'gpt-5.6-sol') },
          { id: 'claude', runner: 'claude', name: 'Claude Fable', detail: 'Judgment seat', evidenceLabel: 'Daily operator seat', state: 'available', roles: ['orchestrate','build','review','verify','assist'], permissions: ['read','write'], efforts: efforts, defaultEffort: 'default', contextCeiling: ceiling(200000, 'native', 'fable') },
          { id: 'cline', runner: 'cline', name: 'Cline / GLM', detail: 'Cline Pass', evidenceLabel: 'GLM measured', state: 'available', roles: ['orchestrate','build','review','verify','assist'], permissions: ['read','write'], efforts: efforts, defaultEffort: 'default', contextCeiling: ceiling(null, 'unknown', 'glm-5.3 via cline') },
          { id: 'deepseek-ollama-cc', runner: 'deepseek-ollama-cc', name: 'DeepSeek V4.1 Flash · Workbench seat', detail: 'Claude Code · 1M context', evidenceLabel: 'Ollama Cloud CC door', state: 'available', roles: ['orchestrate','build','review','verify','assist'], permissions: ['read','write'], efforts: efforts, defaultEffort: 'default', contextCeiling: ceiling(1048576, 'stated', 'deepseek-v4.1-flash') },
          { id: 'glm-ollama', runner: 'glm-ollama', name: 'GLM 5.3 (Ollama)', detail: 'Ollama Cloud', evidenceLabel: 'Ollama Cloud', state: 'available', roles: ['orchestrate','build','review','verify','assist'], permissions: ['read'], efforts: efforts, defaultEffort: 'default', contextCeiling: ceiling(1048576, 'stated', 'glm-5.3') }
        ]
      };
      window.postMessage({
        type: 'state',
        snapshot: snapshot,
        conversations: [],
        orchestratorSessionId: null,
        activeConversationId: null,
        notes: {},
        operatorDisplayName: 'Ray'
      }, '*');
    })();
  </script>
</body>
</html>`;

async function main(): Promise<void> {
  const status = parseLaneDeskStatus(await readJson('lanes-status-partial.json'));
  // Patch one running row to look like a CC-door seat so the list shows a stated ceiling.
  if (status.lanes?.[0]) {
    status.lanes[0] = {
      ...status.lanes[0],
      model: 'deepseek-v4.1-flash',
      door: 'ollama-deepseek',
    };
  }
  const model = buildLanesPanelModel(status);

  const rawDetail = await readJson('lane-detail-running.json') as Record<string, unknown>;
  const rawHarvest = await readJson('lane-harvest-running.json') as Record<string, unknown>;
  rawDetail.model = 'deepseek-v4.1-flash';
  rawDetail.door = 'ollama-deepseek';
  rawHarvest.model = 'deepseek-v4.1-flash';
  rawHarvest.door = 'ollama-deepseek';
  const detail = buildLaneDetailModel(
    'mac:gs-harness-m1',
    parseLaneDeskDetail(rawDetail),
    parseLaneDeskHarvest(rawHarvest),
    {
      usedTokens: 196_200,
      contextCeiling: contextCeilingFor('deepseek-ollama-cc'),
    },
  );

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0] || '/';
      if (pathname === '/lanes' || pathname.startsWith('/lanes')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(lanesHtml);
        return;
      }
      if (pathname === '/command' || pathname.startsWith('/command')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(seatPickerHtml);
        return;
      }
      if (pathname === '/' || pathname.startsWith('/index')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(lanesHtml);
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

  const shots: Array<{ name: string; theme: string; kind: 'lanes-detail' | 'seat-picker' }> = [
    { name: 'GS-HARNESS-M3C-PROOF-detail-paper.png', theme: 'paper', kind: 'lanes-detail' },
    { name: 'GS-HARNESS-M3C-PROOF-detail-night.png', theme: 'night', kind: 'lanes-detail' },
    { name: 'GS-HARNESS-M3C-PROOF-seat-picker-paper.png', theme: 'paper', kind: 'seat-picker' },
    { name: 'GS-HARNESS-M3C-PROOF-seat-picker-night.png', theme: 'night', kind: 'seat-picker' },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: 1204, height: 753 },
      deviceScaleFactor: 2,
    });
    if (shot.kind === 'lanes-detail') {
      await page.goto(`${base}/lanes?theme=${shot.theme}`, { waitUntil: 'networkidle' });
      await page.evaluate(
        ({ modelJson, detailJson }) => {
          window.postMessage({ type: 'lanes-model', model: modelJson }, '*');
          window.postMessage({ type: 'lanes-detail', detail: detailJson }, '*');
        },
        { modelJson: model, detailJson: detail },
      );
      await page.waitForSelector('.lanes-detail:not(.is-empty)');
      await page.waitForSelector('.lanes-context-meter');
    } else {
      await page.goto(`${base}/command?theme=${shot.theme}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#lane-select');
      await page.waitForSelector('.lane-card');
      const selected = await page.locator('#lane-select option:checked').textContent();
      if (!selected?.includes('1.05M') || !selected.includes('stated by launcher')) {
        throw new Error(`seat picker missing stated ceiling: ${selected}`);
      }
      await page.locator('.lane-section').scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(200);
    const outPath = path.join(outDir, shot.name);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log('wrote', outPath);
    await page.close();
  }

  await browser.close();
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
