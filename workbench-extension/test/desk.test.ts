import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, renameSync, utimesSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { buildDeskPanelModel } from '../src/deskPanelModel.js';
import { parsePacketFolderName, scanDeskPackets } from '../src/services/deskPackets.js';
import { sessionArtifactsDirectory } from '../src/services/handoffPaths.js';
import { sanitiseHandoffHtml } from '../src/services/htmlSanitiser.js';
import {
  buildPingArgv,
  recordRuling,
  resolveDefaultSessionId,
} from '../src/services/pingRuling.js';

function makeFixtureTree(): { home: string; handoff: string; root: string } {
  const home = mkdtempSync(path.join(os.tmpdir(), 'gs-desk-home-'));
  const handoff = path.join(home, 'Desktop', 'handoff');
  mkdirSync(handoff, { recursive: true });
  writeFileSync(path.join(handoff, 'START-HERE.html'), '<html>index</html>');
  writeFileSync(path.join(handoff, 'README.txt'), 'readme');

  // Packet 1: stamps + full card + annotate
  const p1 = path.join(handoff, 'GS-HARNESS-M3-2026-09-13');
  mkdirSync(p1);
  writeFileSync(path.join(p1, 'WHAT-TO-JUDGE.html'), '<html><body><h1>Judge M3</h1><script>alert(1)</script></body></html>');
  writeFileSync(path.join(p1, 'ANNOTATE.html'), '<html><body>annotate</body></html>');
  writeFileSync(path.join(p1, '.ready-gate-passed'), '');
  writeFileSync(path.join(p1, '.replay-gate-passed'), '');
  writeFileSync(path.join(p1, 'notes.txt'), 'notes');

  // Packet 2: no stamps, has card
  const p2 = path.join(handoff, 'ORDERLY-READY-2026-09-04');
  mkdirSync(p2);
  writeFileSync(path.join(p2, 'WHAT-TO-JUDGE.html'), '<html><body><p>Ready?</p></body></html>');

  // Packet 3: no HTML card (markdown only)
  const p3 = path.join(handoff, 'LIFE-ASK-2026-08-26');
  mkdirSync(p3);
  writeFileSync(path.join(p3, 'WHAT-TO-JUDGE.md'), '# ask\n');

  const root = mkdtempSync(path.join(os.tmpdir(), 'gs-desk-root-'));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'docs', 'sessions'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'sessions', 's114-session-note.md'), 'older');
  const newer = path.join(root, 'docs', 'sessions', 's120-orchestrator-session.md');
  writeFileSync(newer, 'newer');
  const now = Date.now() / 1000 + 10;
  utimesSync(newer, now, now);

  return { home, handoff, root };
}

test('parsePacketFolderName splits GAME / GATE / date', () => {
  assert.deepEqual(parsePacketFolderName('GS-HARNESS-M3-2026-09-13'), {
    game: 'GS-HARNESS',
    gate: 'M3',
    date: '2026-09-13',
  });
  assert.deepEqual(parsePacketFolderName('ORDERLY-READY-2026-09-04'), {
    game: 'ORDERLY',
    gate: 'READY',
    date: '2026-09-04',
  });
});

test('Desk model from fixture tree: 3 packets, stamps, missing card', async (context) => {
  const { home, handoff } = makeFixtureTree();
  context.after(() => rmSync(home, { recursive: true, force: true }));

  const packets = await scanDeskPackets({ home, handoffRoot: handoff });
  assert.equal(packets.length, 3);

  const model = buildDeskPanelModel(packets);
  assert.equal(model.badgeCount, 3);
  assert.equal(model.empty, false);

  const stamped = model.leaves.find((leaf) => leaf.folderName === 'GS-HARNESS-M3-2026-09-13');
  assert.ok(stamped);
  assert.equal(stamped.game, 'GS-HARNESS');
  assert.equal(stamped.gate, 'M3');
  assert.equal(stamped.date, '2026-09-13');
  assert.equal(stamped.readyGatePassed, true);
  assert.equal(stamped.replayGatePassed, true);
  assert.equal(stamped.hasAnnotate, true);
  assert.equal(stamped.cardMissing, false);
  assert.ok(stamped.cardHtml);
  assert.doesNotMatch(stamped.cardHtml!, /<script/i);
  assert.ok(stamped.files.some((file) => file.name === 'notes.txt'));

  const noCard = model.leaves.find((leaf) => leaf.folderName === 'LIFE-ASK-2026-08-26');
  assert.ok(noCard);
  assert.equal(noCard.cardMissing, true);
  assert.equal(noCard.readyGatePassed, false);

  // Root ignores are not packets
  assert.ok(!model.leaves.some((leaf) => leaf.folderName === 'START-HERE.html'));
});

test('sanitiser drops scripts, handlers, and javascript URIs', () => {
  const dirty = `<html><body>
    <h1 onclick="evil()">Title</h1>
    <script>alert(1)</script>
    <a href="javascript:alert(2)">x</a>
    <img src=x onerror=alert(3)>
    <p>keep</p>
  </body></html>`;
  const clean = sanitiseHandoffHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.match(clean, /keep/);
});

test('buildPingArgv matches the closed M3 argv shape', () => {
  const argv = buildPingArgv({
    pingScript: '/gs/scripts/ping.sh',
    session: 's120',
    game: 'GS-HARNESS',
    gate: 'M3',
    verdict: 'ship it',
    tags: 'folio',
  });
  assert.deepEqual(argv, [
    '/gs/scripts/ping.sh',
    '-s',
    's120',
    '-t',
    'gs-harness,ray,ruling,folio',
    'GS-HARNESS-M3 — RULED (Ray)',
    'ship it',
  ]);
});

test('resolveDefaultSessionId reads newest docs/sessions/*session*.md', async (context) => {
  const { home, root } = makeFixtureTree();
  context.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const session = await resolveDefaultSessionId(root);
  assert.equal(session, 's120');
});

test('ruling flow: exact argv, no move on non-zero, move only on zero', async (context) => {
  const { home, handoff, root } = makeFixtureTree();
  context.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  const packetPath = path.join(handoff, 'GS-HARNESS-M3-2026-09-13');
  writeFileSync(path.join(root, 'scripts', 'ping.sh'), '#!/bin/bash\necho stub\n');

  let seenArgv: string[] | undefined;
  const fail = await recordRuling(
    {
      rootPath: root,
      packetPath,
      folderName: 'GS-HARNESS-M3-2026-09-13',
      game: 'GS-HARNESS',
      gate: 'M3',
      session: 's120',
      verdict: 'hold',
      home,
    },
    {
      runPing: async (invocation) => {
        seenArgv = invocation.args;
        return { exitCode: 2, stdout: '', stderr: 'boom' };
      },
      movePacket: async () => {
        throw new Error('must not move on failure');
      },
    },
  );
  assert.equal(fail.ok, false);
  assert.equal(fail.exitCode, 2);
  assert.deepEqual(seenArgv, [
    path.join(root, 'scripts', 'ping.sh'),
    '-s',
    's120',
    '-t',
    'gs-harness,ray,ruling',
    'GS-HARNESS-M3 — RULED (Ray)',
    'hold',
  ]);
  assert.equal(existsSync(packetPath), true);

  const moved: string[] = [];
  const ok = await recordRuling(
    {
      rootPath: root,
      packetPath,
      folderName: 'GS-HARNESS-M3-2026-09-13',
      game: 'GS-HARNESS',
      gate: 'M3',
      session: 's120',
      verdict: 'ship folio',
      home,
    },
    {
      runPing: async (invocation) => {
        seenArgv = invocation.args;
        return { exitCode: 0, stdout: '## 2026-09-13 22:00 ray\nship folio\n', stderr: '' };
      },
      movePacket: async (from, to) => {
        moved.push(from, to);
        renameSync(from, to);
      },
    },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /ship folio/);
  assert.equal(existsSync(packetPath), false);
  assert.ok(ok.sweptTo);
  assert.equal(ok.sweptTo, path.join(sessionArtifactsDirectory(home), 'GS-HARNESS-M3-2026-09-13'));
  assert.equal(existsSync(ok.sweptTo!), true);
  assert.deepEqual(seenArgv?.[3], '-t');
  assert.equal(moved[0], packetPath);

  // Target collision → suffix -2
  mkdirSync(path.join(handoff, 'GS-HARNESS-M3-2026-09-13'));
  writeFileSync(path.join(handoff, 'GS-HARNESS-M3-2026-09-13', 'WHAT-TO-JUDGE.html'), '<p>x</p>');
  const again = await recordRuling(
    {
      rootPath: root,
      packetPath: path.join(handoff, 'GS-HARNESS-M3-2026-09-13'),
      folderName: 'GS-HARNESS-M3-2026-09-13',
      game: 'GS-HARNESS',
      gate: 'M3',
      session: 's120',
      verdict: 'again',
      home,
    },
    {
      runPing: async () => ({ exitCode: 0, stdout: 'row', stderr: '' }),
      movePacket: async (from, to) => renameSync(from, to),
    },
  );
  assert.equal(again.ok, true);
  assert.equal(again.sweptTo, path.join(sessionArtifactsDirectory(home), 'GS-HARNESS-M3-2026-09-13-2'));
});

test('empty desk message', () => {
  const model = buildDeskPanelModel([]);
  assert.equal(model.empty, true);
  assert.equal(model.emptyMessage, 'No packets on the desk.');
  assert.equal(model.badgeCount, 0);
});
