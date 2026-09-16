import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationStore } from '../src/services/conversations.js';
import { ProjectNoteStore } from '../src/services/notes.js';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  readonly keys = (): readonly string[] => [...this.values.keys()];

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

test('write consent survives restore as a grant for the same target', async () => {
  const memory = new MemoryMemento();
  const first = new ConversationStore(memory);
  const conversation = await first.create({ kind: 'project', projectId: 'snesos' }, 'codex', 'build', 'default', 'write');
  assert.equal(conversation.permission, 'write');
  assert.deepEqual(conversation.writeConsent?.target, { kind: 'project', projectId: 'snesos' });
  assert.equal(typeof conversation.writeConsent?.at, 'number');

  const restored = new ConversationStore(memory).get(conversation.id);
  assert.equal(restored?.permission, 'write');
  assert.deepEqual(restored?.writeConsent?.target, { kind: 'project', projectId: 'snesos' });
  assert.equal(restored?.writeConsent?.at, conversation.writeConsent?.at);
});

test('craft receipt cards survive restore on the run receipt', async () => {
  const memory = new MemoryMemento();
  const first = new ConversationStore(memory);
  const conversation = await first.create({ kind: 'project', projectId: 'snesos' }, 'codex', 'build', 'default', 'read');
  await first.setReceipt(conversation.id, {
    laneId: 'codex',
    laneName: 'Codex',
    seat: 'build',
    effort: 'default',
    target: { kind: 'project', projectId: 'snesos' },
    modelLabel: 'GPT-5.6 Sol · high',
    startedAt: 1,
    finishedAt: 2,
    exitCode: 1,
    stopped: false,
    permission: 'read',
    workingDirectory: '/fleet/snesos',
    evidence: ['stderr: authentication unavailable'],
    continuity: 'new',
    cards: [{
      title: 'This step failed',
      what: 'This pass hit a problem.',
      where: 'in SnesOS',
      status: 'Did not finish',
      tone: 'failed',
    }],
    summary: {
      title: 'Work did not finish',
      what: 'This pass could not finish in SnesOS.',
      where: 'in SnesOS',
      status: 'Did not finish',
      tone: 'failed',
    },
  });

  const restored = new ConversationStore(memory).get(conversation.id);
  assert.equal(restored?.receipt?.summary?.title, 'Work did not finish');
  assert.equal(restored?.receipt?.cards?.[0]?.where, 'in SnesOS');
  assert.doesNotMatch(JSON.stringify(restored?.receipt?.summary), /exit/i);
});

test('conversation state survives a new store instance', async () => {
  const memory = new MemoryMemento();
  const first = new ConversationStore(memory);
  const conversation = await first.create({ kind: 'project', projectId: 'generalstaff' }, 'codex', 'orchestrate', 'default', 'read');
  const updated = await first.append(conversation.id, { role: 'user', text: 'Carry this context forward.', status: 'complete' });
  assert.equal(updated?.title, 'Carry this context forward.');

  const restored = new ConversationStore(memory).get(conversation.id);
  assert.equal(restored?.messages[0]?.text, 'Carry this context forward.');
  assert.equal(restored?.laneId, 'codex');
  assert.equal(restored?.permission, 'read');
  assert.deepEqual(restored?.decisions, []);
});

test('provider sessions remain host-only and are scoped to lane, runner, permission, and directory', async () => {
  const memory = new MemoryMemento();
  const first = new ConversationStore(memory);
  const conversation = await first.create({ kind: 'project', projectId: 'generalstaff' }, 'codex', 'orchestrate', 'default', 'read');
  const sessionId = '01a046d5-26b6-7813-bf9b-9c7321080a0f';
  await first.setProviderSession(conversation.id, 'codex', 'codex', 'read', undefined, '/work/repo', sessionId);
  assert.equal(first.providerSession(conversation.id, 'codex', 'codex', 'read', undefined, '/work/repo'), sessionId);
  assert.equal(first.providerSession(conversation.id, 'codex', 'cursor', 'read', undefined, '/work/repo'), undefined);
  assert.equal(first.providerSession(conversation.id, 'codex', 'codex', 'write', undefined, '/work/repo'), undefined);
  assert.equal(first.providerSession(conversation.id, 'codex', 'codex', 'read', undefined, '/work/other'), undefined);
  assert.equal(first.providerSession(conversation.id, 'codex', 'codex', 'read', 'audit', '/work/repo'), undefined);
  assert.doesNotMatch(JSON.stringify(first.all()), new RegExp(sessionId));

  const restored = new ConversationStore(memory);
  assert.equal(restored.providerSession(conversation.id, 'codex', 'codex', 'read', undefined, '/work/repo'), sessionId);
  await restored.clearProviderSession(conversation.id, 'codex');
  assert.equal(restored.providerSession(conversation.id, 'codex', 'codex', 'read', undefined, '/work/repo'), undefined);
});

test('legacy provider sessions without a runner fail closed to transcript continuity', async () => {
  const memory = new MemoryMemento();
  await memory.update('generalstaff.providerSessions.v1', {
    'conversation-one': {
      claude: {
        id: '01a046d5-26b6-7813-bf9b-9c7321080a0f',
        laneId: 'claude',
        permission: 'read',
        workingDirectory: '/work/repo',
        updatedAt: 1,
      },
    },
  });
  const store = new ConversationStore(memory);
  assert.equal(store.providerSession('conversation-one', 'claude', 'cursor', 'read', undefined, '/work/repo'), undefined);
  assert.equal(store.providerSession('conversation-one', 'claude', 'claude', 'read', undefined, '/work/repo'), undefined);
});

test('skill routing persists and scopes native provider continuity', async () => {
  const memory = new MemoryMemento();
  const store = new ConversationStore(memory);
  const conversation = await store.create({ kind: 'general' }, 'codex', 'orchestrate', 'high', 'read', 'audit');
  assert.deepEqual(conversation.target, { kind: 'general' });
  assert.equal(conversation.skillId, 'audit');
  await store.setProviderSession(conversation.id, 'codex', 'codex', 'read', 'audit', '/work/repo', 'session_audit_1234');
  assert.equal(store.providerSession(conversation.id, 'codex', 'codex', 'read', 'audit', '/work/repo'), 'session_audit_1234');
  assert.equal(store.providerSession(conversation.id, 'codex', 'codex', 'read', 'delegate', '/work/repo'), undefined);
  assert.equal((await store.setSkill(conversation.id, 'delegate'))?.skillId, 'delegate');
  assert.equal((await store.setSkill(conversation.id))?.skillId, undefined);
});

test('interrupted streaming messages reopen as explicit recoverable errors', async () => {
  const memory = new MemoryMemento();
  await memory.update('generalstaff.conversations.v1', [{
    id: 'conversation-one',
    title: 'Interrupted command',
    projectId: 'generalstaff',
    laneId: 'codex',
    seat: 'orchestrate',
    permission: 'read',
    context: [],
    messages: [{ id: 'assistant-one', role: 'assistant', text: '', createdAt: 1, status: 'streaming' }],
    decisions: [],
    createdAt: 1,
    updatedAt: 1,
  }]);
  const restored = new ConversationStore(memory).get('conversation-one');
  assert.deepEqual(restored?.target, { kind: 'project', projectId: 'generalstaff' });
  assert.equal(restored?.messages[0]?.status, 'error');
  assert.match(restored?.messages[0]?.text ?? '', /closed before this run completed/);
});

test('decision answers are validated and persisted once', async () => {
  const memory = new MemoryMemento();
  const store = new ConversationStore(memory);
  const conversation = await store.create({ kind: 'project', projectId: 'generalstaff' }, 'codex', 'orchestrate', 'default', 'read');
  await store.addDecisions(conversation.id, [{
    id: 'decision-one',
    messageId: 'assistant-one',
    title: 'Choose a route',
    question: 'Which route should proceed?',
    options: [{ id: 'option-one', label: 'Route one' }, { id: 'option-two', label: 'Route two' }],
    createdAt: 1,
  }]);
  assert.equal(await store.answerDecision(conversation.id, 'decision-one', 'missing'), undefined);
  assert.equal((await store.answerDecision(conversation.id, 'decision-one', 'option-two'))?.answerOptionId, 'option-two');
  assert.equal(await store.answerDecision(conversation.id, 'decision-one', 'option-one'), undefined);
  assert.equal(new ConversationStore(memory).get(conversation.id)?.decisions[0]?.answerOptionId, 'option-two');
});

test('project notes persist locally and can be cleared', async () => {
  const memory = new MemoryMemento();
  const notes = new ProjectNoteStore(memory);
  await notes.save('generalstaff', 'Keep this decision reserved.');
  assert.equal(new ProjectNoteStore(memory).all().generalstaff, 'Keep this decision reserved.');
  await notes.save('generalstaff', '  ');
  assert.equal(new ProjectNoteStore(memory).all().generalstaff, undefined);
});
