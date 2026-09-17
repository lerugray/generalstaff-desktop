import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  consentNotices,
  consentPromptHasSingleAction,
  consentReceiptCopy,
  consentRoomName,
  writeConsentPrompt,
} from '../src/consentRoom.js';

const slop = /—/;

test('consent rooms use the real project or General Staff name', () => {
  assert.equal(consentRoomName({ kind: 'general', name: 'General Staff — orchestrator' }), 'General Staff');
  assert.equal(consentRoomName({ kind: 'project', name: 'SnesOS' }), 'SnesOS');
  assert.equal(consentRoomName({ kind: 'project', name: '  Appendix N  ' }), 'Appendix N');
  assert.equal(consentRoomName({ kind: 'project' }), 'this project');
});

test('the key-turn prompt is one plain-language enter action', () => {
  const prompt = writeConsentPrompt('SnesOS', 'Claude Fable');
  assert.deepEqual(prompt, {
    message: 'About to change files in SnesOS.',
    options: {
      modal: true,
      detail: 'Claude Fable can change files in SnesOS. After you enter, a receipt stays on the desk so you can see the grant.',
    },
    action: 'Enter SnesOS',
  });
  assert.equal(consentPromptHasSingleAction(prompt), true);
  assert.doesNotMatch(JSON.stringify(prompt), slop);
  assert.doesNotMatch(prompt.message, /edit access|permission|checkbox|repo/i);
});

test('the visible receipt names the grant and the room', () => {
  const receipt = consentReceiptCopy('General Staff');
  assert.equal(receipt.title, 'Inside General Staff');
  assert.equal(receipt.body, 'This seat can change files in General Staff.');
  assert.equal(receipt.enterAction, 'Enter General Staff');
  assert.equal(receipt.leaveAction, 'Look only');
  assert.equal(receipt.pendingBody, 'About to change files in General Staff.');
  assert.doesNotMatch(JSON.stringify(receipt), slop);
  assert.doesNotMatch(JSON.stringify(consentNotices), slop);
});

test('desk chrome treats consent as a room, not a developer checkbox', async () => {
  const extensionRoot = path.resolve(process.cwd());
  const [webview, css] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
  ]);

  assert.match(webview, /class="consent-receipt"/u);
  assert.match(webview, /data-action="enter-room"/u);
  assert.match(webview, /data-action="leave-room"/u);
  assert.match(webview, /postRoomEntry\(true\)/u);
  assert.match(webview, /type: enter \? 'enter-room' : 'leave-room'/u);
  assert.match(webview, /Inside \$\{/u);
  assert.match(webview, /This seat can change files in/u);
  assert.match(webview, /About to change files in/u);
  assert.match(webview, /Look only/u);
  assert.match(webview, /writeConsent/u);
  assert.doesNotMatch(webview, /id="permission-select"/u);
  assert.doesNotMatch(webview, /Can edit repo/u);
  assert.doesNotMatch(webview, /Enable edit access/u);
  assert.doesNotMatch(webview, /Edit access enabled/u);
  assert.match(css, /\.consent-receipt,/u);
  assert.match(css, /\.room-gate \{/u);
  assert.match(css, /@keyframes room-enter/u);
});
