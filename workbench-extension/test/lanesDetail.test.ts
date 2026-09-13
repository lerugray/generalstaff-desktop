import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  buildLaneDetailModel,
  buildLanesPanelModel,
} from '../src/lanesPanelModel.js';
import {
  parseLaneDeskDetail,
  parseLaneDeskHarvest,
} from '../src/services/laneDeskDetail.js';
import { parseLaneDeskStatus } from '../src/services/laneDeskStatus.js';

const fixtures = path.resolve(process.cwd(), 'test/fixtures');

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtures, name), 'utf8')) as unknown;
}

test('running lane detail + harvest bind fields without path reads', async () => {
  const detail = parseLaneDeskDetail(await readJson('lane-detail-running.json'));
  const harvest = parseLaneDeskHarvest(await readJson('lane-harvest-running.json'));
  assert.equal(detail.ok, true);
  assert.equal(harvest.ok, true);
  assert.equal(detail.lines?.length, 4);
  assert.equal(detail.status_tail?.length, 3);
  assert.equal(detail.sentinels?.log?.last_line, 'compiling lanes panel');

  const model = buildLaneDetailModel('mac:gs-harness-m1', detail, harvest);
  assert.equal(model.laneId, 'gs-harness-m1');
  assert.equal(model.host, 'mac');
  assert.equal(model.state, 'running');
  assert.equal(model.counterColor, 'ink');
  assert.equal(model.gone, false);
  assert.equal(model.harvestActionDisabled, true);
  assert.equal(model.harvestActionTooltip, 'M3+');

  const byLabel = Object.fromEntries(model.fields.map((field) => [field.label, field]));
  assert.equal(byLabel.tree?.value, '/Users/ray/src/generalstaff-desktop');
  assert.equal(byLabel.tree?.marginalia, true);
  assert.equal(byLabel.branch?.value, 'cursor/gs-harness-m1-lanes-bb9a');
  assert.match(byLabel.sha?.value || '', /WANT a435628 · HEAD d2eb411/);
  assert.equal(byLabel.model?.value, 'composer · cursor');
  assert.equal(byLabel.launched?.value, '2026-09-13T20:48:00Z');
  assert.equal(byLabel.cap?.value, '120m');
  assert.equal(byLabel.elapsed?.value, '12m');

  assert.deepEqual(
    model.logLines,
    [
      'activating workbench extension',
      'fetching lanes_status',
      'compiling lanes panel',
      'waiting on poll tick',
    ],
  );
  assert.equal(model.harvest.dirtyCount, '3');
  assert.equal(model.harvest.commitsSinceWant, '2');
  assert.equal(model.harvest.battery, 'ok · Mac on AC');
  assert.equal(model.harvest.process, 'running · pid 44102 · pgid 44100');
  assert.deepEqual(model.harvest.filesChanged, [
    'workbench-extension/src/lanesPanel.ts',
    'workbench-extension/media/lanes.js',
    'workbench-extension/package.json',
  ]);
  assert.equal(model.harvest.tests, 'reported no · verified no');
  assert.deepEqual(model.harvest.attention, ['dirty tree']);

  // Contract: detail model never carries a filesystem open action — only reported strings.
  assert.equal('openPath' in model, false);
  assert.equal('logPath' in model, false);
});

test('failed lane detail + harvest bind attention and stopped process', async () => {
  const detail = parseLaneDeskDetail(await readJson('lane-detail-failed.json'));
  const harvest = parseLaneDeskHarvest(await readJson('lane-harvest-failed.json'));
  const model = buildLaneDetailModel('mac:orderly-authz', detail, harvest);

  assert.equal(model.state, 'failed');
  assert.equal(model.counterColor, 'iron-red');
  assert.equal(model.harvest.process, 'stopped · pid 39011 · pgid 39011');
  assert.equal(model.harvest.dirtyCount, '0');
  assert.equal(model.harvest.commitsSinceWant, '0');
  assert.equal(model.harvest.battery, 'n/a · home-pc offline');
  assert.deepEqual(model.harvest.attention, ['failed', 'probe_timeout']);
  assert.match(model.logLines.at(-1) || '', /marking failed/);
  assert.equal(model.sentinels.find((entry) => entry.name === 'run.status')?.lastLine, 'state=failed code=probe_timeout');
});

test('gone lane keeps last detail with gone marker and stale handling', async () => {
  const status = parseLaneDeskStatus(await readJson('lanes-status-partial.json'));
  const list = buildLanesPanelModel(status);
  const stillThere = list.rows.some((row) => row.key === 'mac:wrapup-stale');
  assert.equal(stillThere, true);

  const priorDetail = parseLaneDeskDetail(await readJson('lane-detail-failed.json'));
  const priorHarvest = parseLaneDeskHarvest(await readJson('lane-harvest-failed.json'));
  // Simulate the lane disappearing from status while we retain the last envelopes.
  const goneEnvelope = parseLaneDeskDetail(await readJson('lane-detail-gone.json'));
  assert.equal(goneEnvelope.ok, false);
  assert.equal(goneEnvelope.code, 'missing_lane');

  const retained = buildLaneDetailModel('mac:wrapup-stale', priorDetail, priorHarvest, {
    gone: true,
    stale: true,
    fallbackId: 'wrapup-stale',
    fallbackHost: 'mac',
    fallbackState: 'stalled',
  });
  assert.equal(retained.gone, true);
  assert.equal(retained.stale, true);
  assert.equal(retained.laneId, 'orderly-authz');
  assert.ok(retained.logLines.length > 0);

  const missingOnly = buildLaneDetailModel('mac:wrapup-stale', goneEnvelope, undefined, {
    gone: true,
    stale: true,
    fallbackId: 'wrapup-stale',
    fallbackHost: 'mac',
    fallbackState: 'stalled',
  });
  assert.equal(missingOnly.gone, true);
  assert.equal(missingOnly.stale, true);
  assert.match(missingOnly.errorDetail || '', /missing_lane/);
  assert.equal(missingOnly.harvestActionDisabled, true);
});

test('detail/harvest parsers tolerate sparse envelopes and reject non-objects', () => {
  assert.equal(parseLaneDeskDetail(null).ok, false);
  assert.equal(parseLaneDeskHarvest('nope').ok, false);
  const sparse = parseLaneDeskDetail({ ok: true, lane_id: 'x', host: 'mac', lines: ['a', 2, 'b'] });
  assert.deepEqual(sparse.lines, ['a', 'b']);
  const harvest = parseLaneDeskHarvest({
    ok: true,
    process: { running: true },
    git: { dirty: true },
  });
  assert.equal(harvest.process?.running, true);
  assert.equal(harvest.git?.dirty, true);
  assert.equal(harvest.git?.files_changed, undefined);
});
