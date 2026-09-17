import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import {
  deskBootCopy,
  hasVisibleConversation,
  interruptedAnswerNote,
  markInterruptedAnswer,
} from '../src/deskResume.js';

const extensionRoot = path.resolve(process.cwd());

test('reopen boot copy sits back down at the desk instead of recovering a session', () => {
  assert.deepEqual(deskBootCopy(false), {
    title: 'Opening the desk',
    detail: 'Reading the fleet without interrupting active work…',
  });
  assert.deepEqual(deskBootCopy(true), {
    title: 'Back at the desk',
    detail: 'Your conversation is still here.',
  });
  assert.equal(hasVisibleConversation({ messages: [{ text: 'hello' }] }), true);
  assert.equal(hasVisibleConversation({ messages: [] }), false);
  assert.equal(hasVisibleConversation(undefined), false);
  assert.doesNotMatch(`${deskBootCopy(true).title} ${deskBootCopy(true).detail}`, /—|session recovered|crash/i);
});

test('an interrupted turn is marked in human terms without debug chrome', () => {
  assert.equal(markInterruptedAnswer(''), interruptedAnswerNote);
  assert.equal(
    markInterruptedAnswer('  I had started the wrap-up.  '),
    `I had started the wrap-up.\n\n${interruptedAnswerNote}`,
  );
  assert.match(interruptedAnswerNote, /desk closed before this answer finished/);
  assert.doesNotMatch(interruptedAnswerNote, /—|run completed|recover/i);
});

test('the desk restores a living conversation on reopen, not a recovery form', async () => {
  const [webview, css, host] = await Promise.all([
    readFile(path.join(extensionRoot, 'media', 'workbench.js'), 'utf8'),
    readFile(path.join(extensionRoot, 'media', 'workbench.css'), 'utf8'),
    readFile(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8'),
  ]);

  assert.match(webview, /streamScroll: readStreamScroll\(saved\.streamScroll\)/u);
  assert.match(webview, /streamScroll: state\.streamScroll/u);
  assert.match(webview, /restoreStreamScroll\(/u);
  assert.match(webview, /returningToConversation = hasVisibleConversation\(session\)/u);
  assert.match(webview, /Continue the conversation/u);
  assert.match(webview, /Pick up the thread\. The composer is ready\./u);
  assert.match(webview, /Same conversation/u);
  assert.match(webview, /GENERAL STAFF · SAME CONVERSATION/u);
  assert.match(webview, /The last answer did not finish\./u);
  assert.match(webview, /just keep talking below/u);
  assert.match(webview, /class="recovery-card\$\{orchestrator \? ' continue-card' : ''\}"/u);
  assert.match(webview, /Trying again/u);
  assert.match(webview, /arriving && state\.returningToConversation \? ' returning'/u);
  assert.match(webview, /document\.getElementById\('prompt'\)\?\.focus\(\)/u);
  assert.doesNotMatch(webview, /session recovered/i);
  assert.doesNotMatch(webview, /Continuous session/u);
  assert.doesNotMatch(webview, /Transcript retained; compatible provider sessions resume after reopen/u);
  assert.match(host, /deskBootCopy\(hasVisibleConversation\(session\)\)/u);
  assert.match(css, /\.workbench\.arriving\.returning/u);
  assert.match(css, /\.recovery-card\.continue-card/u);
});
