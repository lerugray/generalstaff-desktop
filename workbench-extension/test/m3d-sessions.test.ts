import assert from 'node:assert/strict';
import test from 'node:test';
import { nextAuxToggleState, planOpenOnLaunch } from '../src/launchPlan.js';
import {
  ConversationStore,
  conversationsV1Key,
  conversationsV2Key,
  migrateV1Conversations,
} from '../src/services/conversations.js';
import { OrchestratorSessionManager } from '../src/services/orchestratorSession.js';
import { buildSessionsViewModel } from '../src/services/sessionsModel.js';

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

test('launch opens only the Command Deck — never Lanes or Desk', () => {
  const plan = planOpenOnLaunch({ openOnLaunch: true, immersiveMode: true });
  assert.equal(plan.openCommandDeck, true);
  assert.equal(plan.openLanes, false);
  assert.equal(plan.openDesk, false);
  assert.equal(plan.closeAuxiliaryBar, false);
  assert.equal(plan.closePanel, true);

  const idle = planOpenOnLaunch({ openOnLaunch: false, immersiveMode: true });
  assert.equal(idle.openCommandDeck, false);
  assert.equal(idle.openLanes, false);
  assert.equal(idle.openDesk, false);
});

test('aux panel toggles are idempotent show/hide', () => {
  assert.deepEqual(nextAuxToggleState(null, 'lanes'), { next: 'lanes', action: 'show' });
  assert.deepEqual(nextAuxToggleState('lanes', 'lanes'), { next: null, action: 'hide' });
  assert.deepEqual(nextAuxToggleState('lanes', 'desk'), { next: 'desk', action: 'show' });
  assert.deepEqual(nextAuxToggleState('desk', 'desk'), { next: null, action: 'hide' });
  assert.deepEqual(nextAuxToggleState(null, 'desk'), { next: 'desk', action: 'show' });
});

test('v1→v2 migration preserves orchestrator and project conversations including deepseek-style titles', async () => {
  const memory = new MemoryMemento();
  const v1Fixture = [
    {
      id: 'orch-deepseek',
      kind: 'orchestrator',
      title: 'deepseek test',
      target: { kind: 'general' },
      laneId: 'deepseek-ollama-cc',
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      context: [],
      messages: [
        { id: 'u1', role: 'user', text: 'deepseek test catch-up', createdAt: 10, status: 'complete' },
        { id: 'a1', role: 'assistant', text: 'Ready.', createdAt: 11, status: 'complete' },
      ],
      decisions: [],
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: 'proj-one',
      title: 'Ship the harness panels',
      projectId: 'generalstaff-desktop',
      laneId: 'codex',
      seat: 'build',
      permission: 'read',
      context: [],
      messages: [{ id: 'u2', role: 'user', text: 'Ship the harness panels', createdAt: 30, status: 'complete' }],
      decisions: [],
      createdAt: 30,
      updatedAt: 40,
    },
  ];
  await memory.update(conversationsV1Key, v1Fixture);

  const migrated = migrateV1Conversations(v1Fixture as never);
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0]?.title, 'deepseek test');
  assert.equal(migrated[1]?.target.kind, 'project');

  const store = new ConversationStore(memory);
  assert.equal(store.didMigrateFromV1(), true);
  assert.ok(memory.get(conversationsV2Key));
  const deepseek = store.get('orch-deepseek');
  assert.equal(deepseek?.title, 'deepseek test');
  assert.equal(deepseek?.laneId, 'deepseek-ollama-cc');
  assert.equal(store.get('proj-one')?.target.kind, 'project');
  const project = store.get('proj-one');
  assert.ok(project?.target.kind === 'project');
  assert.equal(project.target.projectId, 'generalstaff-desktop');
});

test('new / rename / archive / unarchive / delete session transitions', async () => {
  const memory = new MemoryMemento();
  const store = new ConversationStore(memory);
  const manager = new OrchestratorSessionManager(memory, store);
  const first = await manager.ensure({ laneId: 'claude', effort: 'default' });
  await store.append(first.id, { role: 'user', text: 'Keep this older thread around for later review.', status: 'complete' });
  assert.match(store.get(first.id)?.title ?? '', /Keep this older/);

  const second = await manager.startNew({ laneId: 'claude', effort: 'default' });
  assert.notEqual(second.id, first.id);
  assert.equal(manager.current()?.id, second.id);
  assert.equal(store.get(first.id)?.archivedAt, undefined);

  await store.rename(first.id, 'deepseek test');
  assert.equal(store.get(first.id)?.title, 'deepseek test');

  await store.archive(first.id);
  assert.ok(store.get(first.id)?.archivedAt);
  const model = buildSessionsViewModel(store.all(), store.activeIds());
  assert.equal(model.archived.some((item) => item.id === first.id), true);
  assert.equal(model.orchestrator.some((item) => item.id === first.id), false);

  await store.unarchive(first.id);
  assert.equal(store.get(first.id)?.archivedAt, undefined);

  assert.equal(await store.delete(first.id), true);
  assert.equal(store.get(first.id), undefined);
  assert.ok(store.get(second.id));
});

test('many orchestrator sessions stay listed; one is active', async () => {
  const memory = new MemoryMemento();
  const store = new ConversationStore(memory);
  const manager = new OrchestratorSessionManager(memory, store);
  const a = await manager.ensure({ laneId: 'claude', effort: 'default' });
  const b = await manager.startNew({ laneId: 'codex', effort: 'high' });
  const c = await manager.startNew({ laneId: 'claude', effort: 'default' });
  assert.equal(store.all().filter((item) => item.kind === 'orchestrator').length, 3);
  assert.equal(manager.current()?.id, c.id);
  await manager.activate(a.id);
  assert.equal(manager.current()?.id, a.id);
  assert.ok(store.get(b.id));
});
