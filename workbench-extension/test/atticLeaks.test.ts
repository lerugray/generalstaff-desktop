import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  applyDeskLayout,
  atticToolsAllowed,
  deskGuardKeybindings,
  deskStayNotice,
  leftoverDeskSettings,
  leftoverDeskWorkspaceSettings,
  returnToDeskStatusText,
} from '../src/deskLayout.js';

function assertPlainCopy(value: string): void {
  assert.doesNotMatch(value, /\u2014/u, `user-facing copy must not use an em dash: ${value}`);
  assert.doesNotMatch(value, /\u2013/u, `user-facing copy must not use an en dash: ${value}`);
}

test('file, terminal, and project tools stay closed unless workshop is already open', () => {
  assert.equal(atticToolsAllowed(false), false);
  assert.equal(atticToolsAllowed(true), true);
  assert.match(deskStayNotice, /Stay at the desk/u);
  assert.match(deskStayNotice, /Open workshop/u);
  assertPlainCopy(deskStayNotice);
  assert.equal(returnToDeskStatusText, 'Return to desk');
  assertPlainCopy(returnToDeskStatusText);
});

test('desk layout also hides leftover explorer, menu, breadcrumb, and terminal chrome', async () => {
  const leftovers: Array<[string, string, unknown]> = [];
  const host = {
    executeCommand: async () => undefined,
    updateWorkbenchSetting: async () => undefined,
    updateSetting: async (section: string, key: string, value: unknown) => {
      leftovers.push([section, key, value]);
    },
  };

  await applyDeskLayout(host);
  assert.deepEqual(leftovers, leftoverDeskSettings.map((item) => [item.section, item.key, item.value]));
  assert.equal(leftoverDeskWorkspaceSettings['breadcrumbs.enabled'], false);
  assert.equal(leftoverDeskWorkspaceSettings['window.menuBarVisibility'], 'hidden');
  assert.equal(leftoverDeskWorkspaceSettings['terminal.integrated.hideOnStartup'], 'always');
  assert.equal(leftoverDeskWorkspaceSettings['explorer.autoReveal'], false);
  assert.equal(leftoverDeskWorkspaceSettings['explorer.openEditors.visible'], 0);
});

test('leftover attic key chords return to the desk instead of opening IDE chrome', () => {
  const keys = deskGuardKeybindings.map((item) => item.key);
  assert.ok(keys.includes('ctrl+b'));
  assert.ok(keys.includes('ctrl+j'));
  assert.ok(keys.includes('ctrl+`'));
  assert.ok(keys.includes('ctrl+shift+e'));
  for (const binding of deskGuardKeybindings) {
    assert.equal(binding.command, 'generalstaff.returnToDesk');
    assert.equal(binding.when, 'generalstaff.deskActive');
  }
});

test('product surfaces no longer dump into attic from the desk or a lone slash', async () => {
  const repoRoot = path.resolve(process.cwd(), '..');
  const [manifestRaw, workspaceRaw, webview, css, host] = await Promise.all([
    readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'distribution/generalstaff-workbench.code-workspace'), 'utf8'),
    readFile(path.join(process.cwd(), 'media/workbench.js'), 'utf8'),
    readFile(path.join(process.cwd(), 'media/workbench.css'), 'utf8'),
    readFile(path.join(process.cwd(), 'src/extension.ts'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw) as {
    contributes: {
      keybindings: Array<{ command: string; key: string; when?: string }>;
    };
  };
  const workspace = JSON.parse(workspaceRaw) as { settings: Record<string, unknown> };

  assert.equal(workspace.settings['breadcrumbs.enabled'], false);
  assert.equal(workspace.settings['window.menuBarVisibility'], 'hidden');
  assert.equal(workspace.settings['terminal.integrated.hideOnStartup'], 'always');
  assert.equal(workspace.settings['explorer.autoReveal'], false);
  assert.equal(workspace.settings['explorer.openEditors.visible'], 0);

  assert.ok(manifest.contributes.keybindings.some((item) => (
    item.command === 'generalstaff.returnToDesk' && item.key === 'ctrl+`' && item.when === 'generalstaff.deskActive'
  )));
  assert.ok(manifest.contributes.keybindings.some((item) => (
    item.command === 'generalstaff.returnToDesk' && item.key === 'ctrl+shift+e' && item.when === 'generalstaff.deskActive'
  )));

  assert.match(host, /atticToolsAllowed\(workshopOpen\)/u);
  assert.match(host, /deskStayNotice/u);
  assert.match(host, /returnToDeskStatus/u);
  assert.match(host, /generalstaff\.deskActive/u);
  assert.match(host, /composerKeys\.js/u);
  assert.doesNotMatch(host, /setWorkshopOpen\(true\)\.then/u);
  assert.doesNotMatch(host, /await setWorkshopOpen\(true\)/u);

  assert.match(webview, /class="composer-input"/u);
  assert.match(webview, /slash-skill-menu/u);
  assert.match(webview, /data-action="pick-slash-skill"/u);
  assert.match(webview, /syncSlashSkillMenu\(true\)/u);
  assert.match(webview, /GSComposerKeys\.slashSkillQuery/u);
  assert.match(webview, /handleSlashSkillKeys\(event\)/u);
  assert.match(webview, /shouldSelectAll\(event\)/u);
  assert.match(webview, /postRoomEntry\(true\)/u);
  assert.match(webview, /state\.workshopOpen \? '<button class="context-action" data-action="open-project">Open primary/u);
  assert.match(webview, /project && state\.workshopOpen \? '<button data-action="open-project">Open project/u);
  assert.match(webview, /if \(!state\.workshopOpen\) return;/u);
  assert.match(webview, /event\.metaKey \|\| event\.ctrlKey/u);
  assert.doesNotMatch(webview, /GSComposerKeys\.shouldSendOnEnter/u);
  assert.doesNotMatch(webview, /\u2014/u);

  assert.match(css, /\.slash-skill-menu \{/u);
  assert.match(css, /\.composer-input \{/u);
  assert.match(css, /transition:/u);
});
