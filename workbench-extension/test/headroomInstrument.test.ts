import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  bandFromPressure,
  emptyHeadroomSignals,
  headroomBands,
  occupancyPressure,
  poolPressure,
  readHeadroom,
  rise,
  sessionPressure,
  type HeadroomSignals,
} from '../src/headroomInstrument.js';

function signals(overrides: Partial<HeadroomSignals> = {}): HeadroomSignals {
  return {
    ...emptyHeadroomSignals(),
    availableLanes: 5,
    totalLanes: 5,
    availableHelpers: 2,
    totalHelpers: 2,
    projectCount: 8,
    ...overrides,
  };
}

function userFacingText(value: string): void {
  assert.doesNotMatch(value, /\u2014/u, `user-facing copy must not use an em dash: ${value}`);
  assert.doesNotMatch(value, /\u2013/u, `user-facing copy must not use an en dash: ${value}`);
}

test('bands stay in plain operator words', () => {
  assert.deepEqual([...headroomBands], ['comfortable', 'tight', 'stop soon']);
  assert.equal(bandFromPressure(0), 'comfortable');
  assert.equal(bandFromPressure(0.39), 'comfortable');
  assert.equal(bandFromPressure(0.4), 'tight');
  assert.equal(bandFromPressure(0.74), 'tight');
  assert.equal(bandFromPressure(0.75), 'stop soon');
});

test('session uses transcript, pinned files, and skill size already on the desk', () => {
  assert.equal(bandFromPressure(sessionPressure(signals())), 'comfortable');
  assert.equal(bandFromPressure(sessionPressure(signals({ transcriptCharacters: 24_000 }))), 'tight');
  assert.equal(bandFromPressure(sessionPressure(signals({ attachedFiles: 4 }))), 'tight');
  assert.equal(bandFromPressure(sessionPressure(signals({ skillCharacters: 80_000 }))), 'stop soon');
  assert.equal(bandFromPressure(sessionPressure(signals({ attachedFiles: 9 }))), 'stop soon');
});

test('lane pool is the real capacity signal, not an invented monthly quota', () => {
  assert.equal(bandFromPressure(poolPressure(signals())), 'comfortable');
  assert.equal(bandFromPressure(poolPressure(signals({ availableLanes: 4 }))), 'tight');
  assert.equal(bandFromPressure(poolPressure(signals({ availableHelpers: 0 }))), 'tight');
  assert.equal(bandFromPressure(poolPressure(signals({ availableLanes: 0 }))), 'stop soon');
  assert.equal(bandFromPressure(poolPressure(signals({ totalLanes: 0, availableLanes: 0 }))), 'stop soon');
});

test('fleet occupancy uses live work, review, attention, and desk runs', () => {
  assert.equal(bandFromPressure(occupancyPressure(signals())), 'comfortable');
  assert.equal(bandFromPressure(occupancyPressure(signals({ reviewTasks: 3 }))), 'tight');
  assert.equal(bandFromPressure(occupancyPressure(signals({ deskRuns: 1 }))), 'tight');
  assert.equal(bandFromPressure(occupancyPressure(signals({ activeTasks: 16 }))), 'tight');
  assert.equal(bandFromPressure(occupancyPressure(signals({ reviewTasks: 9 }))), 'stop soon');
  assert.equal(bandFromPressure(occupancyPressure(signals({ activeTasks: 40 }))), 'stop soon');
});

test('the instrument takes the tightest of the three needles', () => {
  const quiet = readHeadroom(signals());
  assert.equal(quiet.band, 'comfortable');
  assert.equal(quiet.glance, 'Room to keep going');
  assert.deepEqual(quiet.signals.map((item) => item.name), ['Session', 'Lane pool', 'Fleet']);

  const busy = readHeadroom(signals({ availableLanes: 4, activeTasks: 31, reviewTasks: 6, attentionCount: 3 }));
  assert.equal(busy.band, 'tight');
  assert.equal(busy.glance, 'Headroom is getting short');
  assert.equal(busy.signals.find((item) => item.id === 'pool')?.reading, 'Some lanes are down.');
  assert.match(busy.signals.find((item) => item.id === 'pool')?.detail || '', /4 of 5 lanes ready/u);

  const heavy = readHeadroom(signals({ transcriptCharacters: 90_000, availableLanes: 0, reviewTasks: 9 }));
  assert.equal(heavy.band, 'stop soon');
  assert.equal(heavy.glance, 'Stop soon');
  assert.equal(heavy.signals.find((item) => item.id === 'session')?.reading, 'This session is heavy. Wrap up soon.');

  for (const reading of [quiet, busy, heavy]) {
    userFacingText(reading.band);
    userFacingText(reading.glance);
    for (const signal of reading.signals) {
      userFacingText(signal.name);
      userFacingText(signal.reading);
      userFacingText(signal.detail);
    }
  }
});

test('rise keeps a living needle that still lands on the named bands', () => {
  assert.equal(rise(0, 4, 9), 0);
  assert.equal(rise(4, 4, 9), 0.4);
  assert.equal(rise(9, 4, 9), 0.75);
  assert.ok(rise(31, 16, 40) > 0.4);
  assert.ok(rise(31, 16, 40) < 0.75);
});

test('desk chrome has one headroom instrument and keeps numbers off the default desk', async () => {
  const extensionRoot = path.resolve(process.cwd());
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);

  assert.match(webview, /class="headroom-instrument/u);
  assert.match(webview, /<summary class="headroom-face"/u);
  assert.match(webview, /class="headroom-details"/u);
  assert.match(webview, /Room to keep going/u);
  assert.match(webview, /Headroom is getting short/u);
  assert.match(webview, /Stop soon/u);
  assert.match(webview, /This session is still light/u);
  assert.match(webview, /The installed lanes are ready/u);
  assert.match(webview, /The fleet has room/u);
  assert.doesNotMatch(webview, /meter-chip/u);
  assert.doesNotMatch(webview, /function renderLaneMeter/u);
  assert.doesNotMatch(webview, /class="hero-stats"/u);
  assert.doesNotMatch(webview, /\$\{available\} of \$\{lanes\.length\} lanes ready/u);
  assert.doesNotMatch(webview, /\u2014/u);
  assert.match(css, /\.headroom-instrument \{/u);
  assert.match(css, /\.headroom-dial \{/u);
  assert.match(css, /\.headroom-needle \{/u);
  assert.match(css, /transition:/u);
  assert.match(css, /\.headroom-instrument:not\(\[open\]\):hover \.headroom-details/u);
  assert.match(css, /\.headroom-instrument\[open\] \.headroom-details/u);
});
