import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationStore } from '../src/services/conversations.js';
import { OrchestratorSessionManager } from '../src/services/orchestratorSession.js';

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

test('the host reattaches to one orchestrator transcript and native provider session after reopen', async () => {
  const memory = new MemoryMemento();
  const firstStore = new ConversationStore(memory);
  const firstManager = new OrchestratorSessionManager(memory, firstStore);
  const firstSession = await firstManager.ensure({ laneId: 'codex', effort: 'high' });

  await firstStore.append(firstSession.id, {
    role: 'user',
    text: 'Remember that the harvest call sign is amber heron.',
    status: 'complete',
  });
  await firstStore.append(firstSession.id, {
    role: 'assistant',
    text: 'I will retain amber heron for this session.',
    status: 'complete',
  });
  await firstStore.setProviderSession(
    firstSession.id,
    'codex',
    'codex',
    'read',
    undefined,
    '/private/generalstaff',
    '01a046d5-26b6-7813-bf9b-9c7321080a0f',
  );
  await firstStore.setReceipt(firstSession.id, {
    laneId: 'codex',
    laneName: 'Codex',
    seat: 'orchestrate',
    effort: 'high',
    target: { kind: 'general' },
    modelLabel: 'GPT-5.6 Sol · high effort',
    startedAt: 1,
    finishedAt: 2,
    exitCode: 0,
    stopped: false,
    permission: 'read',
    workingDirectory: '/private/generalstaff',
    evidence: [],
    continuity: 'new',
  });

  const reopenedStore = new ConversationStore(memory);
  const reopenedManager = new OrchestratorSessionManager(memory, reopenedStore);
  const reopenedSession = await reopenedManager.ensure({ laneId: 'claude', effort: 'max' });
  const continuation = reopenedManager.continuationFor(
    reopenedSession,
    'codex',
    undefined,
    '/private/generalstaff',
  );

  assert.equal(reopenedSession.id, firstSession.id, 'reopen must attach to the existing seat, not create an order');
  assert.equal(reopenedSession.laneId, 'codex', 'reopen must retain the operator-selected model');
  assert.equal(continuation.continuity, 'native');
  assert.equal(continuation.providerSessionId, '01a046d5-26b6-7813-bf9b-9c7321080a0f');
  assert.match(continuation.transcript, /amber heron/);

  await reopenedStore.append(reopenedSession.id, {
    role: 'user',
    text: 'What was the harvest call sign?',
    status: 'complete',
  });
  assert.deepEqual(
    new ConversationStore(memory).get(firstSession.id)?.messages.map((message) => message.text),
    [
      'Remember that the harvest call sign is amber heron.',
      'I will retain amber heron for this session.',
      'What was the harvest call sign?',
    ],
  );

  await reopenedStore.setRouting(reopenedSession.id, 'claude', 'orchestrate', 'max', 'read');
  const afterModelSwitch = reopenedManager.continuationFor(
    reopenedSession,
    'claude',
    undefined,
    '/private/generalstaff',
  );
  assert.equal(afterModelSwitch.continuity, 'transcript', 'a different model must receive the complete visible handoff');
  assert.equal(afterModelSwitch.providerSessionId, undefined);
  assert.match(afterModelSwitch.transcript, /What was the harvest call sign/);
});

test('a v2.4 General command is promoted in place and non-resumable lanes receive transcript continuity', async () => {
  const memory = new MemoryMemento();
  const firstStore = new ConversationStore(memory);
  const legacy = await firstStore.create({ kind: 'general' }, 'cline', 'orchestrate', 'high', 'read');
  await firstStore.append(legacy.id, { role: 'user', text: 'The ruling is cedar.', status: 'complete' });
  await firstStore.append(legacy.id, { role: 'assistant', text: 'Ruling recorded.', status: 'complete' });

  const reopenedStore = new ConversationStore(memory);
  const manager = new OrchestratorSessionManager(memory, reopenedStore);
  const session = await manager.ensure({ laneId: 'codex', effort: 'high' });
  const continuation = manager.continuationFor(session, 'cline', undefined, '/private/generalstaff');

  assert.equal(session.id, legacy.id);
  assert.equal(session.kind, 'orchestrator');
  assert.equal(session.title, 'Orchestrator session');
  assert.equal(continuation.continuity, 'transcript');
  assert.match(continuation.transcript, /The ruling is cedar/);
});

test('migration moves an incompatible v2.4 project-only lane to a read-only orchestrator lane', async () => {
  const memory = new MemoryMemento();
  const firstStore = new ConversationStore(memory);
  const legacy = await firstStore.create({ kind: 'general' }, 'cursor', 'build', 'default', 'write');

  const reopenedStore = new ConversationStore(memory);
  const manager = new OrchestratorSessionManager(memory, reopenedStore);
  const session = await manager.ensure({
    laneId: 'codex',
    effort: 'high',
    permission: 'read',
    compatibleLaneIds: ['codex', 'claude', 'cline'],
  });

  assert.equal(session.id, legacy.id);
  assert.equal(session.laneId, 'codex');
  assert.equal(session.seat, 'orchestrate');
  assert.equal(session.permission, 'read');
  assert.equal(session.writeConsent, undefined);
});
