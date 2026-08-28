import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWebviewMessage } from '../src/bridge/messages.js';

test('accepts a bounded command request', () => {
  assert.deepEqual(
    parseWebviewMessage({
      type: 'new-conversation',
      projectId: 'generalstaff',
      laneId: 'codex',
      seat: 'orchestrate',
      effort: 'high',
      permission: 'read',
      skillId: 'audit',
      contextPaths: [],
    }),
    {
      type: 'new-conversation',
      projectId: 'generalstaff',
      laneId: 'codex',
      seat: 'orchestrate',
      effort: 'high',
      permission: 'read',
      skillId: 'audit',
      contextPaths: [],
    },
  );
});

test('rejects unknown lanes, seats, and oversized prompts', () => {
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', projectId: 'generalstaff', laneId: 'mystery', seat: 'build', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', projectId: 'generalstaff', laneId: 'codex', seat: 'root', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'send-prompt', conversationId: 'one', text: 'x'.repeat(80_001) }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', projectId: 'generalstaff', laneId: 'codex', seat: 'build', effort: 'infinite', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', projectId: 'generalstaff', laneId: 'codex', seat: 'build', effort: 'high', permission: 'read', skillId: '../audit' }),
    undefined,
  );
});

test('does not accept inherited or malformed message shapes', () => {
  assert.equal(parseWebviewMessage(null), undefined);
  assert.equal(parseWebviewMessage([]), undefined);
  assert.equal(parseWebviewMessage({ type: 'open-file', path: '' }), undefined);
});

test('accepts bounded recovery and decision commands and rejects invented strategies', () => {
  assert.deepEqual(
    parseWebviewMessage({ type: 'retry-run', conversationId: 'one', strategy: 'transcript' }),
    { type: 'retry-run', conversationId: 'one', strategy: 'transcript' },
  );
  assert.equal(
    parseWebviewMessage({ type: 'retry-run', conversationId: 'one', strategy: 'bypass' }),
    undefined,
  );
  assert.deepEqual(
    parseWebviewMessage({ type: 'answer-decision', conversationId: 'one', decisionId: 'two', optionId: 'three' }),
    { type: 'answer-decision', conversationId: 'one', decisionId: 'two', optionId: 'three' },
  );
  assert.equal(
    parseWebviewMessage({ type: 'answer-decision', conversationId: 'one', decisionId: '', optionId: 'three' }),
    undefined,
  );
});
