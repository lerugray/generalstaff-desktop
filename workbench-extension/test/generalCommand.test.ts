import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const extensionRoot = path.resolve(process.cwd());

test('the orchestrator session is the default dominant surface and project orders stay secondary', async () => {
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);

  assert.match(webview, /state\.activeConversationId = state\.orchestratorSessionId;\s+state\.selectedTargetKind = 'general';\s+const session/u);
  assert.match(webview, /state\.snapshot\.rootPath \? renderConversation\(\) : renderSetup\(\)/u);
  assert.match(webview, /Orchestrator session[\s\S]*Live seat · private root/u);
  assert.match(webview, /Every message continues this same session from the private GeneralStaff root/u);
  assert.match(webview, /orchestrator \? 'Send' : 'Issue order'/u);
  assert.ok(
    webview.indexOf('class="general-command-target') < webview.indexOf('<nav class="rail-nav"'),
    'the orchestrator session must remain above the scrolling project-order rail',
  );
  assert.ok(
    webview.indexOf('Orchestrator session') < webview.indexOf('Project commands'),
    'the live session must precede project order controls in the visual hierarchy',
  );
  assert.match(css, /\.general-command-target/u);
  assert.match(css, /\.session-identity/u);
});
