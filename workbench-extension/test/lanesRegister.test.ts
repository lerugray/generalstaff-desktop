import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const media = path.resolve(process.cwd(), 'media');

test('register CSS: iron-red/dust/ink/quiet counters; amber class only for permitted targets', async () => {
  const css = await readFile(path.join(media, 'workbench.css'), 'utf8');
  const js = await readFile(path.join(media, 'lanes.js'), 'utf8');

  assert.match(css, /--iron-red:/);
  assert.match(css, /\.counter-iron-red\s*\{[^}]*border-color:\s*var\(--iron-red\)/s);
  assert.match(css, /\.counter-dust\s*\{[^}]*border-color:\s*var\(--dust\)/s);
  assert.match(css, /\.counter-ink\s*\{[^}]*border-color:\s*var\(--paper\)/s);
  assert.match(css, /\.counter-quiet\s*\{[^}]*border-color:\s*var\(--quiet-grey\)/s);
  assert.match(css, /\.counter-amber\s*\{[^}]*border-color:\s*var\(--brass\)/s);

  // Amber colour token is only applied via .lanes-amber (not stale/loading/host chips).
  assert.match(css, /\.lanes-amber\s*\{[^}]*color:\s*var\(--brass\)/s);
  assert.doesNotMatch(css, /\.lanes-stale[^{]*\{[^}]*var\(--brass\)/s);
  assert.doesNotMatch(css, /\.lanes-loading[^{]*\{[^}]*var\(--brass\)/s);
  assert.doesNotMatch(css, /\.lanes-host-chip\.is-down[^{]*\{[^}]*var\(--brass/s);
  assert.doesNotMatch(css, /\.lanes-attention-chip/);

  // Markup: amber class only on badge count, iron-red attention mark, gone marker.
  assert.match(js, /lanes-badge-count lanes-amber/);
  assert.match(js, /lane-attention-mark lanes-amber/);
  assert.match(js, /lanes-gone lanes-amber/);
  assert.match(js, /counterColor === 'iron-red'/);
  // No amber on stale / host timeout pills / partial banner / summary counts line.
  assert.doesNotMatch(js, /lanes-stale lanes-amber|lanes-amber.*stale/);
  assert.doesNotMatch(js, /lanes-counts/);
  assert.doesNotMatch(js, /Partial envelope/);
  assert.doesNotMatch(js, /lanes-attention-chip/);
  // State is not a visible badge — screen-reader only class retained.
  assert.match(js, /class="lane-state"/);
  assert.match(css, /\.lane-state\s*\{[^}]*clip:\s*rect/s);
});
