import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import test from 'node:test';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const composerKeys = require(path.join(process.cwd(), 'media/composerKeys.js')) as {
  shouldSendOnEnter: (event: {
    target?: { id?: string };
    key?: string;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
  }) => boolean;
};

function promptEvent(overrides: Record<string, unknown> = {}) {
  return {
    target: { id: 'prompt' },
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

test('plain Enter and Cmd/Ctrl+Enter send from the prompt', () => {
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent()), true);
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ metaKey: true })), true);
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ ctrlKey: true })), true);
});

test('Shift+Enter does not send so the textarea can insert a newline', () => {
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ shiftKey: true })), false);
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ altKey: true })), false);
});

test('non-prompt targets and non-Enter keys never send', () => {
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ target: { id: 'skill-select' } })), false);
  assert.equal(composerKeys.shouldSendOnEnter(promptEvent({ key: 'a' })), false);
  assert.equal(composerKeys.shouldSendOnEnter(null as unknown as { key?: string }), false);
});
