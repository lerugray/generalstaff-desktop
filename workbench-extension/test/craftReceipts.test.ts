import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  continuityLabel,
  humanError,
  keepStatusCard,
  receiptWhere,
  rememberCard,
  runReceiptFromResult,
  sealCards,
  shortPlace,
  toolAction,
  toolReceiptFromEvent,
} from '../src/craftReceipts.js';

const slop = /—/;

test('tool cards say what happened in workshop words', () => {
  assert.equal(toolAction('ReadFile'), 'Read a file');
  assert.equal(toolAction('Read'), 'Read a file');
  assert.equal(toolAction('Write /fleet/snesos/src/main.ts'), 'Wrote a file');
  assert.equal(toolAction('StrReplace'), 'Changed a file');
  assert.equal(toolAction('Grep'), 'Searched the files');
  assert.equal(toolAction('Starting Codex'), 'Taking the Codex seat');
  assert.equal(toolAction('git status'), 'Ran git');
  assert.equal(toolAction(''), 'Did a workshop step');
});

test('cards name the project or path when it is known', () => {
  assert.equal(shortPlace('/fleet/snesos/src/main.ts'), 'src/main.ts');
  assert.equal(receiptWhere({ roomName: 'SnesOS' }), 'in SnesOS');
  assert.equal(
    receiptWhere({ place: '/fleet/snesos/src/main.ts', roomName: 'SnesOS' }),
    'src/main.ts in SnesOS',
  );
  assert.equal(receiptWhere({}), 'place not recorded');
});

test('live tool cards keep a working status and never dump a stack', () => {
  const card = toolReceiptFromEvent({
    kind: 'tool',
    text: 'Read',
    place: 'state/MISSION.md',
    roomName: 'General Staff',
  });
  assert.deepEqual(card, {
    title: 'Read a file',
    what: 'Read a file.',
    where: 'state/MISSION.md in General Staff',
    status: 'In progress',
    tone: 'working',
  });
  const failed = toolReceiptFromEvent({
    kind: 'error',
    text: 'Error: boom\n    at run (/tmp/lane.js:12:3)\n    at Object.<anonymous> (/tmp/lane.js:40:1)',
    roomName: 'SnesOS',
  });
  assert.equal(failed.title, 'This step failed');
  assert.equal(failed.what, 'This pass hit a problem.');
  assert.equal(failed.where, 'in SnesOS');
  assert.equal(failed.status, 'Did not finish');
  assert.equal(failed.tone, 'failed');
  assert.equal(humanError('Cursor could not complete the verification because its authenticated session is unavailable.'), 'Cursor could not complete the verification because its authenticated session is unavailable.');
  assert.equal(keepStatusCard('Starting Codex'), true);
  assert.equal(keepStatusCard('thinking'), false);
});

test('finished and failed run receipts share the same shape', () => {
  assert.deepEqual(
    runReceiptFromResult({
      exitCode: 0,
      stopped: false,
      permission: 'read',
      roomName: 'General Staff',
      workingDirectory: '/fleet',
    }),
    {
      title: 'Work finished',
      what: 'Looked through General Staff.',
      where: 'in General Staff',
      status: 'Finished',
      tone: 'done',
    },
  );
  assert.deepEqual(
    runReceiptFromResult({
      exitCode: 0,
      stopped: false,
      permission: 'write',
      roomName: 'SnesOS',
    }),
    {
      title: 'Work finished',
      what: 'Changed files in SnesOS.',
      where: 'in SnesOS',
      status: 'Finished',
      tone: 'done',
    },
  );
  const failed = runReceiptFromResult({
    exitCode: 1,
    stopped: false,
    permission: 'read',
    roomName: 'GeneralStaff',
    workingDirectory: '/fleet/generalstaff',
  });
  assert.equal(failed.title, 'Work did not finish');
  assert.equal(failed.what, 'This pass could not finish in GeneralStaff.');
  assert.equal(failed.status, 'Did not finish');
  assert.equal(failed.tone, 'failed');
  assert.doesNotMatch(failed.what, /exit/i);
  const stopped = runReceiptFromResult({
    exitCode: null,
    stopped: true,
    permission: 'write',
    roomName: 'SnesOS',
  });
  assert.equal(stopped.title, 'Work stopped');
  assert.equal(stopped.status, 'Stopped');
  assert.equal(continuityLabel('native'), 'Continued the same session');
  assert.equal(continuityLabel('transcript'), 'Continued from the written record');
});

test('duplicate slips collapse and new copy has no em dashes', () => {
  const first = toolReceiptFromEvent({ kind: 'tool', text: 'Read', roomName: 'SnesOS' });
  const kept = rememberCard(rememberCard([], first), first);
  assert.equal(kept.length, 1);
  assert.deepEqual(sealCards(kept)[0], { ...first, status: 'Recorded', tone: 'done' });
  const copy = JSON.stringify({
    tools: ['Read a file', 'Wrote a file', 'Changed a file', 'Taking the Codex seat', 'Recorded'],
    run: runReceiptFromResult({ exitCode: 1, stopped: false, permission: 'read', roomName: 'SnesOS' }),
    labels: [continuityLabel('native'), continuityLabel('new'), receiptWhere({})],
  });
  assert.doesNotMatch(copy, slop);
});

test('desk chrome renders craft receipts instead of exit codes', async () => {
  const extensionRoot = path.resolve(process.cwd());
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);
  assert.match(webview, /class="craft-receipt/u);
  assert.match(webview, /receipt-what/u);
  assert.match(webview, /receipt-where/u);
  assert.match(webview, /receipt-status/u);
  assert.match(webview, /Work finished/u);
  assert.match(webview, /Work did not finish/u);
  assert.match(webview, /place not recorded/u);
  assert.doesNotMatch(webview, /Lane completed/u);
  assert.doesNotMatch(webview, /Lane needs attention/u);
  assert.doesNotMatch(webview, /exit \$\{receipt\.exitCode/u);
  assert.match(css, /\.craft-receipt \{/u);
  assert.match(css, /@keyframes receipt-arrive/u);
  assert.match(css, /\.craft-receipt\.failed/u);
});
