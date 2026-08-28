import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const extensionRoot = path.resolve(process.cwd());

test('ports every legacy GSD palette and persists an accessible rail switcher', async () => {
  const [css, webview] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
  ]);
  const palettes = [
    ['paper', 'Kriegspiel Paper', '#f1e7d3'],
    ['night', 'Kriegspiel Night', '#1a1812'],
    ['linen', 'Linen Folio', '#ece5d5'],
    ['vellum', 'Map Vellum', '#e7e0c0'],
    ['iron', 'Iron Press', '#ebe2cb'],
    ['carbon', 'Carbon Folio', '#0b0a06'],
  ] as const;

  for (const [id, name, surface] of palettes) {
    assert.match(css, new RegExp(`body\\[data-theme="${id}"\\]`));
    assert.match(css, new RegExp(`data-theme-id="${id}"\\] \\{ background: ${surface}`));
    assert.match(webview, new RegExp(`id: '${id}', name: '${name}'`));
  }
  assert.match(webview, /selectedTheme: state\.selectedTheme/);
  assert.match(webview, /aria-pressed=/);
  assert.doesNotMatch(css, /rgba\(210, 165, 87|rgba\(239, 230, 212/);
});
