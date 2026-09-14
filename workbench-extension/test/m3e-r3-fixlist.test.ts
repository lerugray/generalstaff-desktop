import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { clipAtRuneBudget, clipOneLine } from '../src/adapters/cliAdapter.js';
import { CC_DOOR_STATED_CONTEXT_TOKENS } from '../src/services/contextCeiling.js';

test('R3 CODE 4: clipAtRuneBudget (capPersisted path) does not split a surrogate at the budget', () => {
  // 8190 ASCII + one emoji = 8192 UTF-16 units; append one more char so we must truncate.
  const value = `${'a'.repeat(8_190)}😀x`;
  assert.equal(value.length, 8_193);
  // Unfixed slice(0, max-1) with max=8192 cuts at 8191 → lone high surrogate.
  const unfixed = `${value.slice(0, 8_191)}…`;
  assert.equal(/[\uD800-\uDFFF]/.test(unfixed) || unfixed.includes('\uFFFD'), true);

  const fixed = clipAtRuneBudget(value, 8_192);
  assert.equal(fixed.includes('\uFFFD'), false);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(fixed), false);
  assert.ok(fixed.endsWith('…'));
  assert.ok(fixed.length <= 8_192);
});

test('R3 CODE 5: clipOneLine at max=4 fails on unfixed UTF-16 slice and passes on production', () => {
  const emoji = '😀😀😀😀😀';
  const fixed = clipOneLine(emoji, 4);
  assert.equal(fixed.includes('\uFFFD'), false);
  assert.equal(Array.from(fixed.replace(/…$/u, '')).length, 3);
  const unfixed = `${emoji.slice(0, 3)}…`;
  assert.equal(unfixed.includes('\uFFFD') || /[\uD800-\uDFFF]/.test(unfixed), true);
});

test('R3 CODE 6: door script export equals CC_DOOR_STATED_CONTEXT_TOKENS (1048576)', () => {
  const doorPath = path.resolve(process.cwd(), '../scripts/gsd-cc-door.sh');
  assert.ok(fs.existsSync(doorPath), `missing ${doorPath}`);
  const door = fs.readFileSync(doorPath, 'utf8');
  const match = door.match(/CLAUDE_CODE_MAX_CONTEXT_TOKENS=["']?(\d+)/);
  assert.ok(match);
  assert.equal(Number(match[1]), 1_048_576);
  assert.equal(CC_DOOR_STATED_CONTEXT_TOKENS, 1_048_576);
});
