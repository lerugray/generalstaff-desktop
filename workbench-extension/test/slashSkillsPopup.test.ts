import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright';

const root = path.resolve(process.cwd());
const media = path.join(root, 'media');

const skills = [
  { id: 'audit', name: 'audit', description: 'Run a Hammerstein adversarial audit.', fileCount: 1, characterCount: 8200 },
  { id: 'delegate', name: 'delegate', description: 'Route a bounded task to a prepaid model lane.', fileCount: 4, characterCount: 118000 },
  { id: 'stop-slop', name: 'stop-slop', description: 'Remove predictable AI writing patterns.', fileCount: 4, characterCount: 12000 },
];

async function withWorkbenchPage(
  t: { after: (fn: () => Promise<void>) => void; skip: (reason: string) => void },
  catalog: typeof skills,
  run: (page: Page) => Promise<void>,
): Promise<void> {
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
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
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
  await page.goto(`http://127.0.0.1:${address.port}/?theme=paper`, { waitUntil: 'networkidle' });
  const conversationId = 'slash-skills';
  await page.evaluate(
    ({ id, catalog: nextSkills }) => {
      window.postMessage(
        {
          type: 'state',
          snapshot: {
            generatedAt: Date.now(),
            rootPath: '/fleet',
            projects: [],
            attention: [],
            activity: [],
            skills: nextSkills,
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
              },
            ],
          },
          conversations: [
            {
              id,
              kind: 'orchestrator',
              title: 'Slash skills',
              target: { kind: 'general' },
              laneId: 'glm-ollama-cc',
              seat: 'orchestrate',
              effort: 'default',
              permission: 'read',
              context: [],
              messages: [],
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
    },
    { id: conversationId, catalog },
  );
  await page.waitForSelector('#prompt');
  await run(page);
}

test('typing / at the start of the composer opens the skills list', async (t) => {
  await withWorkbenchPage(t, skills, async (page) => {
    const prompt = page.locator('#prompt');
    await prompt.click();
    await prompt.fill('');
    await prompt.press('/');
    await page.waitForSelector('#slash-skill-menu:not([hidden])');
    const text = await page.locator('#slash-skill-menu').innerText();
    assert.match(text, /\/audit/);
    assert.match(text, /\/delegate/);
    assert.equal(await page.locator('#skill-select').count(), 1, 'gear Skill menu remains as backup');
  });
});

test('mid-token slashes such as x/y do not open the skills list', async (t) => {
  await withWorkbenchPage(t, skills, async (page) => {
    const prompt = page.locator('#prompt');
    await prompt.click();
    await prompt.fill('x');
    await prompt.press('/');
    await prompt.press('y');
    await page.waitForTimeout(50);
    const menu = page.locator('#slash-skill-menu:not([hidden])');
    assert.equal(await menu.count(), 0);
    assert.equal(await prompt.inputValue(), 'x/y');
  });
});

test('Enter inserts /skill-id and Escape dismisses without changing text', async (t) => {
  await withWorkbenchPage(t, skills, async (page) => {
    const prompt = page.locator('#prompt');
    await prompt.click();
    await prompt.fill('');
    await prompt.press('/');
    await page.waitForSelector('#slash-skill-menu:not([hidden])');
    await prompt.press('Escape');
    await page.waitForSelector('#slash-skill-menu', { state: 'hidden' });
    assert.equal(await prompt.inputValue(), '/');

    await prompt.fill('');
    await prompt.press('/');
    await prompt.pressSequentially('au');
    await page.waitForSelector('#slash-skill-menu:not([hidden]) .slash-skill-option');
    const filtered = await page.locator('.slash-skill-option').allInnerTexts();
    assert.equal(filtered.length, 1);
    assert.match(filtered[0] ?? '', /\/audit/);
    await prompt.press('Enter');
    assert.equal(await prompt.inputValue(), '/audit ');
    assert.equal(await page.locator('#slash-skill-menu:not([hidden])').count(), 0);
  });
});

test('clicking a skill inserts /skill-id', async (t) => {
  await withWorkbenchPage(t, skills, async (page) => {
    const prompt = page.locator('#prompt');
    await prompt.click();
    await prompt.press('/');
    await page.waitForSelector('#slash-skill-menu:not([hidden])');
    await page.locator('[data-skill-id="delegate"]').click();
    assert.equal(await prompt.inputValue(), '/delegate ');
    assert.equal(await page.locator('#slash-skill-menu:not([hidden])').count(), 0);
  });
});

test('empty skill catalog shows a short empty state', async (t) => {
  await withWorkbenchPage(t, [], async (page) => {
    const prompt = page.locator('#prompt');
    await prompt.click();
    await prompt.press('/');
    await page.waitForSelector('#slash-skill-menu:not([hidden])');
    assert.match(await page.locator('#slash-skill-menu').innerText(), /No skills in this GeneralStaff root/);
  });
});
