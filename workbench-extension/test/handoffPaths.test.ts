import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { claudeExtraDirectoryArgs, desktopHandoffDirectory } from '../src/services/handoffPaths.js';

test('desktop handoff helpers expand to an absolute Desktop/handoff path when present', (context) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'gs-handoff-home-'));
  context.after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(desktopHandoffDirectory(home), undefined);
  assert.deepEqual(claudeExtraDirectoryArgs(home), []);

  const handoff = path.join(home, 'Desktop', 'handoff');
  mkdirSync(handoff, { recursive: true });
  assert.equal(desktopHandoffDirectory(home), handoff);
  assert.deepEqual(claudeExtraDirectoryArgs(home), ['--add-dir', handoff]);
  assert.equal(handoff.includes('~'), false);
});
