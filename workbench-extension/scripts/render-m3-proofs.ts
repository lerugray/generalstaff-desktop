/**
 * Standalone Desk + Lanes calibration proof renderer.
 * Serves unmodified media CSS/JS with a ~10-line acquireVsCodeApi shim,
 * posts real desk / lanes models from fixtures, screenshots at 1204x753@2.
 *
 * Usage: npx tsx scripts/render-m3-proofs.ts
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildDeskPanelModel } from '../src/deskPanelModel.js';
import {
  buildLaneDetailModel,
  buildLanesPanelModel,
} from '../src/lanesPanelModel.js';
import { scanDeskPackets } from '../src/services/deskPackets.js';
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

function buildFixtureHandoff(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'gs-m3-proof-'));
  const handoff = path.join(home, 'Desktop', 'handoff');
  mkdirSync(handoff, { recursive: true });
  writeFileSync(path.join(handoff, 'START-HERE.html'), '<html>start</html>');
  writeFileSync(path.join(handoff, 'README.txt'), 'readme');

  const p1 = path.join(handoff, 'GS-HARNESS-M3-2026-09-13');
  mkdirSync(p1);
  writeFileSync(
    path.join(p1, 'WHAT-TO-JUDGE.html'),
    `<!doctype html><html><head><style>
      body{font:14px/1.45 Georgia,serif;margin:18px;color:#2a2418;background:#f1e7d3}
      h1{font-size:20px;font-weight:500;margin:0 0 8px}
      p{margin:0 0 8px;color:#4a4131}
      .q{border-top:1px solid #d8ccae;padding-top:8px;margin-top:12px}
    </style></head><body>
      <h1>GS-HARNESS · M3</h1>
      <p>Does the Desk folio read as one packet one leaf, with the card as a printed plate?</p>
      <div class="q"><strong>Rule:</strong> amber only while a packet waits.</div>
      <script>alert('should be stripped')</script>
    </body></html>`,
  );
  writeFileSync(path.join(p1, 'ANNOTATE.html'), '<html><body>annotate</body></html>');
  writeFileSync(path.join(p1, '.ready-gate-passed'), '');
  writeFileSync(path.join(p1, '.replay-gate-passed'), '');
  writeFileSync(path.join(p1, 'notes.txt'), 'operator notes');

  const p2 = path.join(handoff, 'ORDERLY-READY-2026-09-04');
  mkdirSync(p2);
  writeFileSync(
    path.join(p2, 'WHAT-TO-JUDGE.html'),
    '<!doctype html><html><body style="font:14px Georgia,serif;margin:16px"><h1>ORDERLY · READY</h1><p>Stage gate?</p></body></html>',
  );

  const p3 = path.join(handoff, 'LIFE-ASK-2026-08-26');
  mkdirSync(p3);
  writeFileSync(path.join(p3, 'WHAT-TO-JUDGE.md'), '# ask\nmarkdown only\n');

  return handoff;
}

function pageHtml(scriptName: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>${title}</title>
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
  <script src="/media/${scriptName}"></script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const handoff = buildFixtureHandoff();
  const packets = await scanDeskPackets({ handoffRoot: handoff });
  const deskModel = buildDeskPanelModel(packets, { defaultSession: 's120' });
  const selectedKey = 'GS-HARNESS-M3-2026-09-13';

  const status = parseLaneDeskStatus(await readJson('lanes-status-partial.json'));
  const lanesModel = buildLanesPanelModel(status);
  const detail = buildLaneDetailModel(
    'mac:gs-harness-m1',
    parseLaneDeskDetail(await readJson('lane-detail-running.json')),
    parseLaneDeskHarvest(await readJson('lane-harvest-running.json')),
  );

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0] || '/';
      if (pathname === '/' || pathname.startsWith('/lanes')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageHtml('lanes.js', 'Lanes · M3 proof'));
        return;
      }
      if (pathname.startsWith('/desk')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageHtml('desk.js', 'Desk · M3 proof'));
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

  const shots: Array<{
    name: string;
    path: string;
    theme: string;
    kind: 'desk' | 'lanes' | 'detail';
  }> = [
    { name: 'GS-HARNESS-M3-PROOF-desk-paper.png', path: '/desk', theme: 'paper', kind: 'desk' },
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-paper.png', path: '/lanes', theme: 'paper', kind: 'lanes' },
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-night.png', path: '/lanes', theme: 'night', kind: 'lanes' },
    { name: 'GS-HARNESS-REGISTER-PROOF-detail-paper.png', path: '/lanes', theme: 'paper', kind: 'detail' },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: 1204, height: 753 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}${shot.path}?theme=${shot.theme}`, { waitUntil: 'networkidle' });
    if (shot.kind === 'desk') {
      await page.evaluate(
        ({ modelJson, key }) => {
          window.postMessage({ type: 'desk-model', model: modelJson, selectedKey: key }, '*');
        },
        { modelJson: deskModel, key: selectedKey },
      );
      await page.waitForSelector('.desk-leaf');
      await page.waitForSelector('.desk-plate');
    } else {
      await page.evaluate(
        ({ modelJson, detailJson, withDetail }) => {
          window.postMessage({ type: 'lanes-model', model: modelJson }, '*');
          if (withDetail) {
            window.postMessage({ type: 'lanes-detail', detail: detailJson }, '*');
          }
        },
        {
          modelJson: lanesModel,
          detailJson: detail,
          withDetail: shot.kind === 'detail',
        },
      );
      await page.waitForSelector('.lane-counter');
      if (shot.kind === 'detail') await page.waitForSelector('.lanes-detail:not(.is-empty)');
    }
    await page.waitForTimeout(200);
    const outPath = path.join(outDir, shot.name);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log('wrote', outPath);
    await page.close();
  }

  await browser.close();
  server.close();
  rmSync(path.dirname(path.dirname(handoff)), { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
