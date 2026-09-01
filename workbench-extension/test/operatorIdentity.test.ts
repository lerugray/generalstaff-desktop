import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as path from 'node:path';
import test from 'node:test';

const extensionRoot = path.resolve(process.cwd());

function loadOperatorIdentity() {
  const source = readFile(path.join(extensionRoot, 'media', 'operatorIdentity.js'), 'utf8');
  const context: { operatorQueueHeading?: (name: string) => string; operatorAvatarLabel?: (name: string) => string } = {};
  vm.createContext(context);
  return source.then((code) => {
    vm.runInContext(code, context as vm.Context);
    assert.equal(typeof context.operatorQueueHeading, 'function');
    assert.equal(typeof context.operatorAvatarLabel, 'function');
    return context as {
      operatorQueueHeading: (name: string) => string;
      operatorAvatarLabel: (name: string) => string;
    };
  });
}

test('operator queue heading defaults to Needs You and personalizes from the first token', async () => {
  const { operatorQueueHeading } = await loadOperatorIdentity();
  assert.equal(operatorQueueHeading(''), 'Needs You');
  assert.equal(operatorQueueHeading('   '), 'Needs You');
  assert.equal(operatorQueueHeading('Ray Weiss'), 'Needs Ray');
  assert.equal(operatorQueueHeading('Alex'), 'Needs Alex');
});

test('operator avatar label defaults to a neutral glyph and derives initials when configured', async () => {
  const { operatorAvatarLabel } = await loadOperatorIdentity();
  assert.equal(operatorAvatarLabel(''), '◉');
  assert.equal(operatorAvatarLabel('   '), '◉');
  assert.equal(operatorAvatarLabel('Ray Weiss'), 'RW');
  assert.equal(operatorAvatarLabel('Alex'), 'AL');
});

test('workbench rendering uses configured operator identity instead of hardcoded personal strings', async () => {
  const [webview, extensionSource] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(webview, /\bNeeds Ray\b/u);
  assert.doesNotMatch(webview, />\s*RW\s*</u);
  assert.match(webview, /operatorQueueHeading\(state\.operatorDisplayName\)/u);
  assert.match(webview, /operatorAvatarLabel\(state\.operatorDisplayName\)/u);
  assert.match(webview, /state\.operatorDisplayName = typeof message\.operatorDisplayName === 'string'/u);
  assert.match(extensionSource, /operatorDisplayName: this\.operatorDisplayName\(\)/u);
  assert.match(extensionSource, /operatorIdentity\.js/u);
});
