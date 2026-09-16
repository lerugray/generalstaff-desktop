import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import type { LaneState, SeatId } from '../src/domain.js';
import {
  healthForSeat,
  instrumentsForLanes,
  readingForSeat,
  seatCopy,
  seatOrder,
} from '../src/seatInstruments.js';

function lane(roles: SeatId[], state: LaneState) {
  return { roles, state };
}

test('seat health is ready when every supporting lane is available', () => {
  const lanes = [
    lane(['orchestrate', 'build'], 'available'),
    lane(['orchestrate'], 'available'),
  ];
  assert.equal(healthForSeat('orchestrate', lanes), 'ready');
  assert.deepEqual(readingForSeat('orchestrate', lanes), {
    id: 'orchestrate',
    name: 'Orchestrate',
    detail: 'Direct work, preserve decisions, and judge completion.',
    health: 'ready',
    availableLanes: 2,
    supportingLanes: 2,
  });
});

test('seat health is thin when some supporting lanes are missing or still checking', () => {
  assert.equal(
    healthForSeat('build', [
      lane(['build'], 'available'),
      lane(['build'], 'missing'),
    ]),
    'thin',
  );
  assert.equal(
    healthForSeat('review', [
      lane(['review'], 'unavailable'),
      lane(['review'], 'checking'),
    ]),
    'thin',
  );
});

test('seat health is down only when no supporting lane is available or still checking', () => {
  assert.equal(healthForSeat('verify', [lane(['verify'], 'missing')]), 'down');
  assert.equal(healthForSeat('assist', []), 'down');
  assert.equal(healthForSeat('verify', [lane(['build'], 'available')]), 'down');
});

test('instrument bank keeps the five full job names in desk order', () => {
  assert.deepEqual([...seatOrder], ['orchestrate', 'build', 'review', 'verify', 'assist']);
  assert.deepEqual(
    instrumentsForLanes([lane(['orchestrate', 'build', 'review', 'verify', 'assist'], 'available')]).map((seat) => [
      seat.name,
      seat.health,
    ]),
    [
      ['Orchestrate', 'ready'],
      ['Build', 'ready'],
      ['Review', 'ready'],
      ['Verify', 'ready'],
      ['Fast assist', 'ready'],
    ],
  );
  assert.equal(seatCopy.assist.name, 'Fast assist');
});

test('desk chrome renders full seat names and health, never two-letter chips', async () => {
  const extensionRoot = path.resolve(process.cwd());
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);

  assert.match(webview, /class="seat-bank"/u);
  assert.match(webview, /class="seat-instrument/u);
  assert.match(webview, /data-seat-id="/u);
  assert.match(webview, /class="seat-health"/u);
  assert.match(webview, /class="seat-reading"/u);
  for (const name of ['Orchestrate', 'Build', 'Review', 'Verify', 'Fast assist']) {
    assert.match(webview, new RegExp(name.replace(' ', '\\s'), 'u'));
  }
  for (const health of ['ready', 'thin', 'down']) {
    assert.match(webview, new RegExp(`health === '${health}'|health = '${health}'|'${health}'`, 'u'));
  }
  assert.doesNotMatch(webview, /id="seat-select"/u);
  assert.doesNotMatch(webview, /seatCopy\[[^\]]+\]\s*\?\.\s*\[0\]\.slice\(0,\s*2\)/u);
  assert.match(css, /\.seat-bank \{[^}]*grid-template-columns:/u);
  assert.match(css, /\.seat-instrument \{/u);
  assert.match(css, /flex-wrap:\s*wrap/u);
  assert.match(css, /\.seat-instrument strong \{[^}]*white-space:\s*normal/u);
  assert.doesNotMatch(css, /\.seat-instrument strong \{[^}]*white-space:\s*nowrap/u);
  assert.match(css, /\.meta-chips \.evidence-chip \{ display: none; \}/u);
  assert.doesNotMatch(css, /\.seat-bank[^{]*\{[^}]*display:\s*none/u);
  assert.doesNotMatch(css, /\.seat-instrument strong[^{]*\{[^}]*display:\s*none/u);
});
