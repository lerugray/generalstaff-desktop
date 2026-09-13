/**
 * Standalone Lanes register proof renderer.
 * Serves unmodified media/workbench.css + media/lanes.js with a ~10-line
 * acquireVsCodeApi shim, posts real buildLanesPanelModel / buildLaneDetailModel
 * payloads from the M1/M2 fixtures, screenshots at 1204x753@2 via Chromium.
 *
 * Usage: npx tsx scripts/render-lanes-register-proofs.ts
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

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/media/workbench.css">
  <title>Lanes · register proof</title>
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

async function main(): Promise<void> {
  const status = parseLaneDeskStatus(await readJson('lanes-status-partial.json'));
  const model = buildLanesPanelModel(status);
  const detail = buildLaneDetailModel(
    'mac:gs-harness-m1',
    parseLaneDeskDetail(await readJson('lane-detail-running.json')),
    parseLaneDeskHarvest(await readJson('lane-harvest-running.json')),
  );

  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0] || '/';
      if (pathname === '/' || pathname.startsWith('/index')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
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
  const base = `http://127.0.0.1:${address.port}/`;

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--disable-audio-output'],
  });

  const shots: Array<{ name: string; theme: string; withDetail: boolean }> = [
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-paper.png', theme: 'paper', withDetail: false },
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-night.png', theme: 'night', withDetail: false },
    { name: 'GS-HARNESS-REGISTER-PROOF-detail-paper.png', theme: 'paper', withDetail: true },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: 1204, height: 753 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}?theme=${shot.theme}`, { waitUntil: 'networkidle' });
    await page.evaluate(
      ({ modelJson, detailJson, withDetail }) => {
        window.postMessage({ type: 'lanes-model', model: modelJson }, '*');
        if (withDetail) {
          window.postMessage({ type: 'lanes-detail', detail: detailJson }, '*');
        }
      },
      {
        modelJson: model,
        detailJson: detail,
        withDetail: shot.withDetail,
      },
    );
    await page.waitForSelector('.lane-counter');
    if (shot.withDetail) await page.waitForSelector('.lanes-detail:not(.is-empty)');
    await page.waitForTimeout(150);
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
