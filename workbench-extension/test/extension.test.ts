import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneSummary } from '../src/domain.js';
import { writeConsentPrompt } from '../src/consentRoom.js';
import {
  authorizeWriteAccess,
  contentSecurityPolicy,
  resolveCommandTarget,
  resolveOpenFilePath,
  seatCanChangeFiles,
  supportsRouting,
  targetSupportsPermission,
  writeLaneForSeat,
} from '../src/extensionPolicy.js';

const lane: Pick<LaneSummary, 'state' | 'roles' | 'permissions' | 'efforts'> = {
  state: 'available',
  roles: ['review'],
  permissions: ['read'],
  efforts: [{ id: 'high', label: 'High' }],
};

test('write access requires the host confirmation callback to approve it', async () => {
  let confirmations = 0;
  const denied = await authorizeWriteAccess('write', false, async () => {
    confirmations += 1;
    return false;
  });
  assert.equal(denied, false);
  assert.equal(confirmations, 1);

  const read = await authorizeWriteAccess('read', false, async () => {
    confirmations += 1;
    return true;
  });
  assert.equal(read, true);
  assert.equal(confirmations, 1);

  assert.deepEqual(writeConsentPrompt('Alpha', 'Claude'), {
    message: 'About to change files in Alpha.',
    options: {
      modal: true,
      detail: 'Claude can change files in Alpha. After you enter, a receipt stays on the desk so you can see the grant.',
    },
    action: 'Enter Alpha',
  });
});

test('routing gates lane state, seat, effort, permission, and target-backed writes', () => {
  assert.equal(supportsRouting(lane, 'review', 'read', 'high'), true);
  assert.equal(supportsRouting({ ...lane, state: 'unavailable' }, 'review', 'read', 'high'), false);
  assert.equal(supportsRouting(lane, 'build', 'read', 'high'), false);
  assert.equal(supportsRouting(lane, 'review', 'write', 'high'), false);
  assert.equal(supportsRouting(lane, 'review', 'read', 'low'), false);
  const snapshot = {
    rootPath: '/fleet/private',
    projects: [{
      id: 'alpha', name: 'Alpha', statePath: '/fleet/private/state/alpha', mission: '', pending: 0,
      inProgress: 0, needsReview: 0, completed: 0, artifacts: [], repoPath: '/work/alpha',
    }],
  };
  const general = resolveCommandTarget({ kind: 'general' }, snapshot);
  const project = resolveCommandTarget({ kind: 'project', projectId: 'alpha' }, snapshot);
  const { repoPath: _repoPath, ...stateOnlyProject } = snapshot.projects[0]!;
  const stateOnly = resolveCommandTarget({ kind: 'project', projectId: 'state-only' }, {
    ...snapshot,
    projects: [{ ...stateOnlyProject, id: 'state-only' }],
  });
  assert.equal(general?.workingDirectory, '/fleet/private');
  assert.deepEqual(general?.contextRoots, ['/fleet/private']);
  assert.equal(project?.workingDirectory, '/work/alpha');
  assert.equal(targetSupportsPermission('write', general as NonNullable<typeof general>), true);
  assert.equal(targetSupportsPermission('write', project as NonNullable<typeof project>), true);
  assert.equal(targetSupportsPermission('read', stateOnly as NonNullable<typeof stateOnly>), true);
  assert.equal(targetSupportsPermission('write', stateOnly as NonNullable<typeof stateOnly>), false);
  assert.equal(resolveCommandTarget({ kind: 'project', projectId: 'missing' }, snapshot), undefined);
});

test('write lane pick prefers the current lane and ignores read-only or missing seats', () => {
  const readOnly: LaneSummary = {
    id: 'glm-ollama',
    runner: 'glm-ollama',
    name: 'GLM',
    detail: '',
    evidenceLabel: '',
    state: 'available',
    roles: ['orchestrate'],
    permissions: ['read'],
    efforts: [{ id: 'default', label: 'Default' }],
    defaultEffort: 'default',
  };
  const missing: LaneSummary = { ...readOnly, id: 'codex', runner: 'codex', name: 'Codex', state: 'missing', permissions: ['read', 'write'] };
  const claude: LaneSummary = { ...readOnly, id: 'claude', runner: 'claude', name: 'Claude Fable', permissions: ['read', 'write'] };
  assert.equal(writeLaneForSeat([readOnly, missing, claude], 'orchestrate', 'glm-ollama')?.id, 'claude');
  assert.equal(writeLaneForSeat([readOnly, missing, claude], 'orchestrate', 'claude')?.id, 'claude');
  assert.equal(writeLaneForSeat([readOnly, missing], 'orchestrate'), undefined);
  assert.equal(seatCanChangeFiles([readOnly, missing, claude], 'orchestrate', 'glm-ollama'), true);
  assert.equal(seatCanChangeFiles([readOnly, missing], 'orchestrate'), false);
  assert.equal(seatCanChangeFiles([], 'orchestrate'), false);
});

test('open-file resolution refuses paths outside the registered allowlist', () => {
  const projects = [{ statePath: '/fleet/state/projects/alpha', repoPath: '/work/alpha' }];
  assert.equal(
    resolveOpenFilePath('/work/alpha/src/index.ts', '/fleet', projects),
    '/work/alpha/src/index.ts',
  );
  assert.throws(
    () => resolveOpenFilePath('/work/alpha-secret/credentials.txt', '/fleet', projects),
    /outside the registered GeneralStaff projects/,
  );
});

test('constructs the exact webview content security policy', () => {
  assert.equal(
    contentSecurityPolicy('vscode-webview://command-deck', 'fixed-nonce'),
    "default-src 'none'; img-src vscode-webview://command-deck data:; font-src vscode-webview://command-deck; style-src vscode-webview://command-deck; script-src 'nonce-fixed-nonce'; connect-src 'none'",
  );
});
