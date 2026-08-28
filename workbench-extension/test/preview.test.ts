import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { PreviewServer } from '../src/services/previewServer.js';

test('local preview serves mounted assets with hardening headers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-preview-'));
  const entry = path.join(root, 'index.html');
  await fs.writeFile(entry, '<h1>Workbench preview</h1>', 'utf8');
  const preview = new PreviewServer();
  t.after(async () => {
    preview.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  const response = await fetch(await preview.urlFor(entry));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Workbench preview/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
});
