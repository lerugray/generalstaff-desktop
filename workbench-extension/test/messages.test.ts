import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWebviewMessage } from '../src/bridge/messages.js';

test('accepts a bounded command request', () => {
  assert.deepEqual(
    parseWebviewMessage({
      type: 'new-conversation',
      target: { kind: 'general' },
      laneId: 'codex',
      seat: 'orchestrate',
      effort: 'high',
      permission: 'read',
      skillId: 'audit',
      contextPaths: [],
    }),
    {
      type: 'new-conversation',
      target: { kind: 'general' },
      laneId: 'codex',
      seat: 'orchestrate',
      effort: 'high',
      permission: 'read',
      skillId: 'audit',
      contextPaths: [],
    },
  );
  assert.equal(
    parseWebviewMessage({
      type: 'new-conversation',
      target: { kind: 'general' },
      laneId: 'glm-ollama',
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      contextPaths: [],
    })?.type,
    'new-conversation',
  );
});

test('rejects unknown lanes, seats, and oversized prompts', () => {
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', target: { kind: 'general' }, laneId: 'mystery', seat: 'build', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', target: { kind: 'general' }, laneId: 'codex', seat: 'root', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'send-prompt', conversationId: 'one', text: 'x'.repeat(80_001) }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', target: { kind: 'general' }, laneId: 'codex', seat: 'build', effort: 'infinite', permission: 'read' }),
    undefined,
  );
  assert.equal(
    parseWebviewMessage({ type: 'new-conversation', target: { kind: 'general' }, laneId: 'codex', seat: 'build', effort: 'high', permission: 'read', skillId: '../audit' }),
    undefined,
  );
});

test('accepts first-class project targets and rejects target-shaped extras', () => {
  const projectMessage = parseWebviewMessage({
    type: 'new-conversation',
    target: { kind: 'project', projectId: 'alpha' },
    laneId: 'codex',
    seat: 'build',
    effort: 'high',
    permission: 'write',
    contextPaths: [],
  });
  assert.equal(projectMessage?.type, 'new-conversation');
  assert.deepEqual(projectMessage && 'target' in projectMessage ? projectMessage.target : undefined, {
    kind: 'project', projectId: 'alpha',
  });
  assert.equal(
    parseWebviewMessage({
      type: 'new-conversation', target: { kind: 'general', projectId: 'spoof' }, laneId: 'codex',
      seat: 'orchestrate', effort: 'high', permission: 'read', contextPaths: [],
    }),
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
