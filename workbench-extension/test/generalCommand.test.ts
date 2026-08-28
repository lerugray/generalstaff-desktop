import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const extensionRoot = path.resolve(process.cwd());

test('General Command is the default pinned target and does not depend on a project', async () => {
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);

  assert.match(webview, /activeConversationId: null,\s+selectedTargetKind: 'general'/u);
  assert.match(webview, /target: currentTarget\(\)/u);
  assert.match(webview, /state\.snapshot\.rootPath \? renderConversation\(\) : renderSetup\(\)/u);
  assert.match(webview, /General Staff[\s\S]*Orchestrator · private root/u);
  assert.ok(
    webview.indexOf('class="general-command-target') < webview.indexOf('<nav class="rail-nav"'),
    'General Command must remain outside the scrolling project rail',
  );
  assert.match(css, /\.general-command-target/u);
});
