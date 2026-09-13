/**
 * Standalone Desk + Lanes calibration proof renderer (M3 / M3b).
 * Serves unmodified media CSS/JS with a ~10-line acquireVsCodeApi shim,
 * posts real desk / lanes models from fixtures, screenshots at 1204x753@2.
 *
 * Also pixel-samples the right edge of running + done rows on Kriegspiel Night
 * to refute or confirm amber leakage (writes samples JSON beside the proofs).
 *
 * Usage: npx tsx scripts/render-m3-proofs.ts
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
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

/** Brass / amber family for Kriegspiel Night (--brass #d18a5a, pale #b46a3a). */
function isAmberBrassPixel(r: number, g: number, b: number): boolean {
  // Warm orange/amber: R dominant, G mid, B low; exclude iron-red and ink paper.
  if (r < 140) return false;
  if (b > 120) return false;
  if (g < 60 || g > 200) return false;
  if (r - b < 40) return false;
  if (r <= g) return false;
  // Exclude dusty stalled browns that sit cooler / greyer than brass.
  const warmth = (r - b) / Math.max(1, r);
  return warmth > 0.28 && r >= 160;
}

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
  writeFileSync(path.join(p1, 'NOTES.txt'), 'pin A: folio leaf\npin B: amber only while waiting');

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

interface EdgeSample {
  state: string;
  clip: { x: number; y: number; width: number; height: number };
  pixelCount: number;
  amberCount: number;
  sampleRgbs: Array<[number, number, number]>;
  amberPresent: boolean;
}

async function sampleRowRightEdge(page: Page, state: string, tmpDir: string): Promise<EdgeSample> {
  const locator = page.locator(`.lane-counter[data-state="${state}"]`).first();
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for state=${state}`);
  const edgeWidth = Math.min(28, Math.max(12, Math.floor(box.width * 0.12)));
  const clip = {
    x: Math.max(0, box.x + box.width - edgeWidth),
    y: box.y,
    width: edgeWidth,
    height: box.height,
  };
  const clipPath = path.join(tmpDir, `edge-${state}.png`);
  await page.screenshot({ path: clipPath, type: 'png', clip });

  const py = `
from PIL import Image
import json
im = Image.open(${JSON.stringify(clipPath)}).convert('RGB')
w, h = im.size
amber = 0
samples = []
step_x = max(1, w // 6)
step_y = max(1, h // 8)
for y in range(0, h, step_y):
  for x in range(0, w, step_x):
    r, g, b = im.getpixel((x, y))
    samples.append([r, g, b])
    # Night brass family (~#d18a5a / #b46a3a)
    if r >= 160 and 60 <= g <= 200 and b <= 120 and (r - b) >= 40 and r > g:
      warmth = (r - b) / max(1, r)
      if warmth > 0.28:
        amber += 1
print(json.dumps({
  "pixelCount": len(samples),
  "amberCount": amber,
  "sampleRgbs": samples[:24],
}))
`;
  const result = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`pixel sample failed for ${state}: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout.trim()) as {
    pixelCount: number;
    amberCount: number;
    sampleRgbs: Array<[number, number, number]>;
  };
  return {
    state,
    clip,
    pixelCount: parsed.pixelCount,
    amberCount: parsed.amberCount,
    sampleRgbs: parsed.sampleRgbs,
    amberPresent: parsed.amberCount > 0,
  };
}

async function countNestedBordersInDetail(page: Page): Promise<{
  detailBorderCount: number;
  innerBoxBorders: number;
  monoTailBorderZero: boolean;
}> {
  return page.evaluate(() => {
    const detail = document.querySelector('.lanes-detail:not(.is-empty)');
    if (!detail) return { detailBorderCount: 0, innerBoxBorders: 0, monoTailBorderZero: false };
    const detailStyle = getComputedStyle(detail);
    const detailBorderCount = ['Top', 'Right', 'Bottom', 'Left']
      .map((side) => detailStyle.getPropertyValue(`border-${side.toLowerCase()}-width`))
      .filter((w) => w && w !== '0px').length;
    let innerBoxBorders = 0;
    for (const el of detail.querySelectorAll('.lanes-detail-section, .lanes-mono-tail, .lanes-harvest-preview, .lanes-detail-field, pre, ul')) {
      const style = getComputedStyle(el);
      const sides = ['top', 'right', 'bottom', 'left']
        .map((side) => style.getPropertyValue(`border-${side}-width`))
        .filter((w) => w && w !== '0px');
      // Rule-line separators (top only) are allowed; full boxes (2+ sides) are not.
      if (sides.length >= 2) innerBoxBorders += 1;
    }
    const mono = detail.querySelector('.lanes-mono-tail');
    const monoTailBorderZero = !mono || getComputedStyle(mono).borderWidth === '0px';
    return { detailBorderCount, innerBoxBorders, monoTailBorderZero };
  });
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
    { name: 'GS-HARNESS-M3-PROOF-desk-night.png', path: '/desk', theme: 'night', kind: 'desk' },
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-paper.png', path: '/lanes', theme: 'paper', kind: 'lanes' },
    { name: 'GS-HARNESS-REGISTER-PROOF-lanes-night.png', path: '/lanes', theme: 'night', kind: 'lanes' },
    { name: 'GS-HARNESS-REGISTER-PROOF-detail-paper.png', path: '/lanes', theme: 'paper', kind: 'detail' },
    { name: 'GS-HARNESS-M3B-PROOF-detail-night.png', path: '/lanes', theme: 'night', kind: 'detail' },
  ];

  const sampleTmp = mkdtempSync(path.join(os.tmpdir(), 'gs-m3b-pixels-'));
  let nightEdgeSamples: EdgeSample[] | undefined;
  let detailNightAudit: Awaited<ReturnType<typeof countNestedBordersInDetail>> | undefined;

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

    if (shot.name === 'GS-HARNESS-REGISTER-PROOF-lanes-night.png') {
      nightEdgeSamples = [
        await sampleRowRightEdge(page, 'running', sampleTmp),
        await sampleRowRightEdge(page, 'done', sampleTmp),
        await sampleRowRightEdge(page, 'failed', sampleTmp),
      ];
    }
    if (shot.name === 'GS-HARNESS-M3B-PROOF-detail-night.png') {
      detailNightAudit = await countNestedBordersInDetail(page);
    }

    const outPath = path.join(outDir, shot.name);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log('wrote', outPath);
    await page.close();
  }

  const report = {
    theme: 'night',
    brassToken: '#d18a5a',
    rule: 'amber only on failed/inconsistent attention marks, unreachable-host row, and icon badge',
    edgeSamples: nightEdgeSamples,
    runningOrDoneAmberLeak: Boolean(
      nightEdgeSamples?.some((s) => (s.state === 'running' || s.state === 'done') && s.amberPresent),
    ),
    detailNight: detailNightAudit,
  };
  const reportPath = path.join(outDir, 'GS-HARNESS-M3B-PIXEL-SAMPLES-2026-09-13.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('wrote', reportPath);
  console.log('runningOrDoneAmberLeak', report.runningOrDoneAmberLeak);
  console.log('detailNight', detailNightAudit);

  // Keep unused helper referenced for typecheck of the amber detector.
  void isAmberBrassPixel;

  await browser.close();
  server.close();
  rmSync(path.dirname(path.dirname(handoff)), { recursive: true, force: true });
  rmSync(sampleTmp, { recursive: true, force: true });

  if (report.runningOrDoneAmberLeak) {
    throw new Error('Amber/brass pixels found on running/done row right edge — fix CSS before shipping.');
  }
  if (detailNightAudit && detailNightAudit.innerBoxBorders > 0) {
    throw new Error(`Detail night still has nested bordered boxes: ${detailNightAudit.innerBoxBorders}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
