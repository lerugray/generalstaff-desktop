import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { resolveGeneralStaffRoot, scanFleet } from '../src/services/fleet.js';

test('an explicit GENERALSTAFF_ROOT wins and must contain state', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-workbench-root-test-'));
  context.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  const environmentRoot = path.join(temporary, 'environment-root');
  const configuredRoot = path.join(temporary, 'configured-root');
  await fs.mkdir(path.join(environmentRoot, 'state'), { recursive: true });
  await fs.mkdir(path.join(configuredRoot, 'state'), { recursive: true });
  const previous = process.env.GENERALSTAFF_ROOT;
  process.env.GENERALSTAFF_ROOT = environmentRoot;
  context.after(() => {
    if (previous === undefined) delete process.env.GENERALSTAFF_ROOT;
    else process.env.GENERALSTAFF_ROOT = previous;
  });

  assert.equal(await resolveGeneralStaffRoot(configuredRoot), environmentRoot);
  process.env.GENERALSTAFF_ROOT = path.join(temporary, 'missing-root');
  assert.equal(await resolveGeneralStaffRoot(configuredRoot), configuredRoot);
});

test('builds a fleet snapshot from canonical GeneralStaff state', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-workbench-test-'));
  context.after(async () => fs.rm(temporary, { recursive: true, force: true }));

  const root = path.join(temporary, 'generalstaff-private');
  const state = path.join(root, 'state', 'alpha');
  const repo = path.join(temporary, 'alpha');
  await fs.mkdir(state, { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'audit'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  await fs.writeFile(path.join(state, 'MISSION.md'), '# Alpha\n\nMake the useful thing reliable.\n');
  await fs.writeFile(path.join(root, 'skills', 'audit', 'SKILL.md'), '---\nname: audit\ndescription: Check the plan.\n---\n');
  await fs.writeFile(
    path.join(state, 'tasks.json'),
    JSON.stringify([
      { id: 'a-1', title: 'Operator decision', status: 'in_progress', interactive_only: true },
      { id: 'a-2', title: 'Review the artifact', status: 'needs_review' },
      { id: 'a-3', title: 'Queued work', status: 'pending', priority: 2 },
      { id: 'a-4', title: 'Completed work', status: 'done', done_at: '2026-08-26T20:00:00Z' },
    ]),
  );

  const snapshot = await scanFleet(root);
  assert.equal(snapshot.projects.length, 1);
  assert.deepEqual(
    {
      id: snapshot.projects[0]?.id,
      repoPath: snapshot.projects[0]?.repoPath,
      pending: snapshot.projects[0]?.pending,
      inProgress: snapshot.projects[0]?.inProgress,
      needsReview: snapshot.projects[0]?.needsReview,
      completed: snapshot.projects[0]?.completed,
    },
    { id: 'alpha', repoPath: repo, pending: 1, inProgress: 1, needsReview: 1, completed: 1 },
  );
  assert.match(snapshot.projects[0]?.mission ?? '', /Make the useful thing reliable/);
  assert.equal(snapshot.attention.length, 2);
  assert.equal(snapshot.activity[0]?.title, 'Completed work');
  assert.deepEqual(snapshot.skills.map((skill) => skill.id), ['audit']);
  assert.equal(snapshot.capabilities.some((capability) => capability.id === 'lane-desk'), true);
});

test('never maps a state project back to the private root or an ambiguous sibling', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-workbench-map-test-'));
  context.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'generalstaff-private');
  const state = path.join(root, 'state', 'generalstaff');
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, 'tasks.json'), '[]');
  let snapshot = await scanFleet(root);
  assert.equal(snapshot.projects[0]?.repoPath, undefined);

  for (const sibling of ['generalstaff', 'general-staff']) {
    await fs.mkdir(path.join(temporary, sibling, '.git'), { recursive: true });
  }
  snapshot = await scanFleet(root);
  assert.equal(snapshot.projects[0]?.repoPath, undefined);
});
