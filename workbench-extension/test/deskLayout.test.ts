import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  applyDeskLayout,
  applyWorkshopLayout,
  deskChromeCommands,
  deskEditorCommands,
  deskWorkbenchSettings,
  workshopButtonLabel,
  workshopChromeCommands,
  workshopWorkbenchSettings,
} from '../src/deskLayout.js';

test('desk arrival hides IDE chrome with explicit commands, never toggles', () => {
  for (const command of [...deskChromeCommands, ...deskEditorCommands, ...workshopChromeCommands]) {
    assert.equal(command.includes('toggle'), false, `${command} would jitter the layout`);
  }
  assert.deepEqual(deskWorkbenchSettings, {
    'activityBar.location': 'hidden',
    'statusBar.visible': false,
    'editor.showTabs': 'none',
  });
  assert.ok(deskChromeCommands.includes('workbench.action.closeSidebar'));
  assert.ok(deskChromeCommands.includes('workbench.action.closePanel'));
  assert.ok(deskChromeCommands.includes('workbench.action.closeAuxiliaryBar'));
  assert.ok(deskChromeCommands.includes('workbench.action.activityBarLocation.hide'));
});

test('workshop reveal is a deliberate labeled open, and return copy stays plain', () => {
  assert.equal(workshopButtonLabel(false), 'Open workshop');
  assert.equal(workshopButtonLabel(true), 'Return to desk');
  assert.equal(workshopWorkbenchSettings['activityBar.location'], 'default');
  assert.equal(workshopWorkbenchSettings['statusBar.visible'], true);
  assert.equal(workshopWorkbenchSettings['editor.showTabs'], 'multiple');
  assert.ok(workshopChromeCommands[0]?.startsWith('workbench.action.activityBarLocation.'));
});

test('desk layout writes settings then hides chrome, and can close leftover editors', async () => {
  const settings: Array<[string, unknown]> = [];
  const commands: string[] = [];
  const host = {
    executeCommand: async (command: string) => {
      commands.push(command);
      return undefined;
    },
    updateWorkbenchSetting: async (key: string, value: unknown) => {
      settings.push([key, value]);
    },
  };

  await applyDeskLayout(host);
  assert.deepEqual(Object.fromEntries(settings), deskWorkbenchSettings);
  assert.deepEqual(commands, [...deskChromeCommands]);

  settings.length = 0;
  commands.length = 0;
  await applyDeskLayout(host, { closeOtherEditors: true });
  assert.deepEqual(commands, [...deskChromeCommands, ...deskEditorCommands]);
});

test('workshop layout restores chrome and stops after the first working activity-bar command', async () => {
  const commands: string[] = [];
  const host = {
    executeCommand: async (command: string) => {
      commands.push(command);
      if (command === 'workbench.action.activityBarLocation.side') {
        throw new Error('missing on this host');
      }
      return undefined;
    },
    updateWorkbenchSetting: async () => undefined,
  };

  await applyWorkshopLayout(host);
  assert.deepEqual(commands, [
    'workbench.action.activityBarLocation.side',
    'workbench.action.activityBarLocation.default',
  ]);

  commands.length = 0;
  const successful = {
    executeCommand: async (command: string) => {
      commands.push(command);
      return undefined;
    },
    updateWorkbenchSetting: async () => undefined,
  };
  await applyWorkshopLayout(successful);
  assert.deepEqual(commands, ['workbench.action.activityBarLocation.side']);
});

test('product defaults arrive at the desk instead of a programmer attic', async () => {
  const repoRoot = path.resolve(process.cwd(), '..');
  const [manifestRaw, workspaceRaw, webview, css, launcher, windowsLauncher] = await Promise.all([
    readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'distribution/generalstaff-workbench.code-workspace'), 'utf8'),
    readFile(path.join(process.cwd(), 'media/workbench.js'), 'utf8'),
    readFile(path.join(process.cwd(), 'media/workbench.css'), 'utf8'),
    readFile(path.join(repoRoot, 'scripts/launch-workbench.sh'), 'utf8'),
    readFile(path.join(repoRoot, 'scripts/launch-workbench.cmd'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw) as {
    contributes: {
      configuration: { properties: Record<string, { default?: unknown }> };
      commands: Array<{ command: string; title: string }>;
    };
  };
  const workspace = JSON.parse(workspaceRaw) as { settings: Record<string, unknown> };

  assert.equal(manifest.contributes.configuration.properties['generalstaff.immersiveMode']?.default, true);
  assert.equal(workspace.settings['generalstaff.immersiveMode'], true);
  assert.equal(workspace.settings['workbench.activityBar.location'], 'hidden');
  assert.equal(workspace.settings['workbench.statusBar.visible'], false);
  assert.equal(workspace.settings['workbench.editor.showTabs'], 'none');
  assert.equal(workspace.settings['workbench.startupEditor'], 'none');
  assert.equal(workspace.settings['workbench.editor.empty.hint'], 'hidden');
  assert.ok(manifest.contributes.commands.some((item) => item.command === 'generalstaff.openWorkshop'));
  assert.ok(manifest.contributes.commands.some((item) => item.command === 'generalstaff.returnToDesk'));
  assert.match(webview, /data-action="toggle-workshop"/);
  assert.match(webview, /Open workshop/);
  assert.match(webview, /Return to desk/);
  assert.match(webview, /id="target-select"/);
  assert.match(webview, /meter-chip/);
  assert.match(webview, /class="seat-bank"/);
  assert.match(webview, /class="seat-instrument/);
  assert.match(webview, /Fast assist/);
  assert.match(launcher, /workspace_file="\$runtime_root\/generalstaff-workbench\.code-workspace"/);
  assert.match(windowsLauncher, /%RUNTIME_ROOT%\\generalstaff-workbench\.code-workspace/);
  assert.match(css, /\.workbench \{\s*display: grid/u);
  assert.match(css, /\.workbench\.arriving/u);
  assert.match(css, /\.conversation-shell \{[\s\S]*?width: 100%/u);
});
