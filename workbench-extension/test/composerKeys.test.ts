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
  slashSkillQuery: (text: string, cursor: number) => { start: number; end: number; query: string } | null;
  filterSkills: (
    skills: Array<{ id: string; name: string; description: string }>,
    query: string,
  ) => Array<{ id: string; name: string; description: string }>;
  insertSkillToken: (
    text: string,
    range: { start: number; end: number },
    skillId: string,
  ) => { text: string; cursor: number };
  moveSkillHighlight: (index: number, count: number, delta: number) => number;
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

const skills = [
  { id: 'audit', name: 'audit', description: 'Run a Hammerstein adversarial audit.' },
  { id: 'delegate', name: 'delegate', description: 'Route a bounded task to a prepaid model lane.' },
  { id: 'stop-slop', name: 'stop-slop', description: 'Remove predictable AI writing patterns.' },
];

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

test('slash skill popup opens after a boundary / and not mid-token', () => {
  assert.deepEqual(composerKeys.slashSkillQuery('/', 1), { start: 0, end: 1, query: '' });
  assert.deepEqual(composerKeys.slashSkillQuery('/au', 3), { start: 0, end: 3, query: 'au' });
  assert.deepEqual(composerKeys.slashSkillQuery('hello /aud', 10), { start: 6, end: 10, query: 'aud' });
  assert.deepEqual(composerKeys.slashSkillQuery('\n/x', 3), { start: 1, end: 3, query: 'x' });
  assert.deepEqual(composerKeys.slashSkillQuery('  /', 3), { start: 2, end: 3, query: '' });
  assert.equal(composerKeys.slashSkillQuery('x/y', 2), null);
  assert.equal(composerKeys.slashSkillQuery('x/y', 3), null);
  assert.equal(composerKeys.slashSkillQuery('path/to', 5), null);
  assert.equal(composerKeys.slashSkillQuery('path/to', 7), null);
  assert.equal(composerKeys.slashSkillQuery('/audit extra', 12), null);
  assert.deepEqual(composerKeys.slashSkillQuery('/audit extra', 6), { start: 0, end: 6, query: 'audit' });
  assert.equal(composerKeys.slashSkillQuery('/', 0), null);
  assert.equal(composerKeys.slashSkillQuery('', 0), null);
});

test('slash skill filter matches id, name, and description', () => {
  assert.deepEqual(
    composerKeys.filterSkills(skills, '').map((skill) => skill.id),
    ['audit', 'delegate', 'stop-slop'],
  );
  assert.deepEqual(
    composerKeys.filterSkills(skills, 'AUD').map((skill) => skill.id),
    ['audit'],
  );
  assert.deepEqual(
    composerKeys.filterSkills(skills, 'hammerstein').map((skill) => skill.id),
    ['audit'],
  );
  assert.deepEqual(composerKeys.filterSkills(skills, 'zzz'), []);
});

test('inserting a skill replaces the / prefix and leaves a trailing space', () => {
  assert.deepEqual(composerKeys.insertSkillToken('/', { start: 0, end: 1 }, 'audit'), {
    text: '/audit ',
    cursor: 7,
  });
  assert.deepEqual(composerKeys.insertSkillToken('/au more', { start: 0, end: 3 }, 'audit'), {
    text: '/audit more',
    cursor: 6,
  });
  assert.deepEqual(composerKeys.insertSkillToken('hello /', { start: 6, end: 7 }, 'delegate'), {
    text: 'hello /delegate ',
    cursor: 16,
  });
});

test('arrow highlight stays inside the filtered list', () => {
  assert.equal(composerKeys.moveSkillHighlight(0, 3, 1), 1);
  assert.equal(composerKeys.moveSkillHighlight(2, 3, 1), 2);
  assert.equal(composerKeys.moveSkillHighlight(0, 3, -1), 0);
  assert.equal(composerKeys.moveSkillHighlight(0, 0, 1), 0);
});
