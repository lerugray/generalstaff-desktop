import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  defaultThemeId,
  deskPreferenceKey,
  readDeskPreferences,
  restoreComposerDraft,
  restoreThemeId,
  writeDeskPreferences,
} from '../src/deskPreferences.js';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

test('an empty store keeps Carbon Folio and an empty composer', () => {
  const memory = new MemoryMemento();
  assert.deepEqual(readDeskPreferences(memory), {
    selectedTheme: defaultThemeId,
    composerDraft: '',
  });
  assert.equal(restoreThemeId('mystery'), 'carbon');
  assert.equal(restoreThemeId('paper'), 'paper');
  assert.equal(restoreComposerDraft('Keep talking here.'), 'Keep talking here.');
  assert.equal(restoreComposerDraft('x'.repeat(80_001)), '');
});

test('an explicit palette and unsent draft survive a new host instance', async () => {
  const memory = new MemoryMemento();
  await writeDeskPreferences(memory, { selectedTheme: 'paper', composerDraft: 'What still needs a ruling?' });
  assert.deepEqual(memory.get(deskPreferenceKey), {
    selectedTheme: 'paper',
    composerDraft: 'What still needs a ruling?',
  });

  const sameStore = readDeskPreferences(memory);
  assert.equal(sameStore.selectedTheme, 'paper');
  assert.equal(sameStore.composerDraft, 'What still needs a ruling?');

  await writeDeskPreferences(memory, { composerDraft: '' });
  assert.equal(readDeskPreferences(memory).selectedTheme, 'paper');
  assert.equal(readDeskPreferences(memory).composerDraft, '');
});
