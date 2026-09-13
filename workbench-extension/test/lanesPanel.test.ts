import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  attentionBadgeCount,
  buildLanesPanelModel,
  laneCounterColor,
} from '../src/lanesPanelModel.js';
import { parseLaneDeskStatus, type LaneDeskStatusEnvelope } from '../src/services/laneDeskStatus.js';

const fixturePath = path.resolve(process.cwd(), 'test/fixtures/lanes-status-partial.json');

test('fixture-driven Lanes render model: sort, colours, badge, partial envelope', async () => {
  const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
  const envelope = parseLaneDeskStatus(raw);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.partial, true);
  assert.equal(envelope.hosts?.mac?.ok, true);
  assert.equal(envelope.hosts?.['home-pc']?.ok, false);

  const model = buildLanesPanelModel(envelope);
  assert.equal(model.partial, true);
  assert.equal(model.badgeCount, 3);
  assert.equal(attentionBadgeCount(envelope), 3);

  // Unreachable host row first, then attention lanes, then running, then done.
  assert.equal(model.rows[0]?.kind, 'host-unreachable');
  assert.equal(model.rows[0]?.host, 'home-pc');
  assert.equal(model.rows[0]?.counterColor, 'amber');

  const laneRows = model.rows.filter((row) => row.kind === 'lane');
  assert.deepEqual(
    laneRows.map((row) => row.state),
    ['inconsistent', 'failed', 'stalled', 'running', 'done'],
  );
  assert.deepEqual(
    laneRows.map((row) => row.counterColor),
    ['iron-red', 'iron-red', 'dust', 'ink', 'quiet'],
  );

  const failed = laneRows.find((row) => row.id === 'orderly-authz');
  assert.ok(failed);
  assert.equal(failed.modelDoor, 'generalstaff-private');
  assert.equal(failed.elapsed, '42m');
  assert.equal(failed.sha, 'abc1234');
  assert.equal(failed.lastLogLine, 'probe timed out after 30s');
  assert.match(failed.sentinel, /run\.status|sentinel/i);

  const running = laneRows.find((row) => row.id === 'gs-harness-m1');
  assert.ok(running);
  assert.equal(running.host, 'mac');
  assert.equal(laneCounterColor('running'), 'ink');
  assert.equal(laneCounterColor('done'), 'quiet');

  // Live mac lanes still render despite home-pc down — panel is never blank.
  assert.ok(laneRows.some((row) => row.host === 'mac'));
  assert.ok(model.hostSummaries.some((host) => host.host === 'home-pc' && host.ok === false));
});

test('counter colours and badge ignore non-attention states', () => {
  const envelope: LaneDeskStatusEnvelope = {
    ok: true,
    lanes: [
      { id: 'a', host: 'mac', state: 'running', age_min: 1 },
      { id: 'b', host: 'mac', state: 'done', age_min: 9 },
      { id: 'c', host: 'mac', state: 'orphaned', age_min: 3 },
    ],
  };
  assert.equal(attentionBadgeCount(envelope), 0);
  assert.equal(laneCounterColor('orphaned'), 'dust');
  assert.equal(laneCounterColor('inconsistent'), 'iron-red');
  assert.equal(laneCounterColor('stalled'), 'dust');
});

test('parseLaneDeskStatus tolerates sparse / invalid rows without inventing hosts', () => {
  const envelope = parseLaneDeskStatus({
    ok: true,
    lanes: [
      { id: 'keep', host: 'mac', state: 'running', age_min: 2 },
      { id: 'drop-me' },
      null,
    ],
    hosts: {
      mac: { ok: true, latency_ms: 11 },
    },
  });
  assert.equal(envelope.lanes?.length, 1);
  assert.equal(envelope.lanes?.[0]?.id, 'keep');
  assert.equal(envelope.hosts?.mac?.latency_ms, 11);
  assert.equal(envelope.hosts?.['home-pc'], undefined);
});
