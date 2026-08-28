import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneSummary } from '../src/domain.js';
import {
  authorizeWriteAccess,
  contentSecurityPolicy,
  projectSupportsPermission,
  resolveOpenFilePath,
  supportsRouting,
  writeConsentPrompt,
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
    message: 'Enable edit access for Claude in Alpha?',
    options: {
      modal: true,
      detail: 'The lane may modify files inside the discovered project repository. The consent and working directory will be recorded in the run receipt.',
    },
    action: 'Enable edit access',
  });
});

test('routing gates lane state, seat, effort, permission, and repository-backed writes', () => {
  assert.equal(supportsRouting(lane, 'review', 'read', 'high'), true);
  assert.equal(supportsRouting({ ...lane, state: 'unavailable' }, 'review', 'read', 'high'), false);
  assert.equal(supportsRouting(lane, 'build', 'read', 'high'), false);
  assert.equal(supportsRouting(lane, 'review', 'write', 'high'), false);
  assert.equal(supportsRouting(lane, 'review', 'read', 'low'), false);
  assert.equal(projectSupportsPermission('read', undefined), true);
  assert.equal(projectSupportsPermission('write', undefined), false);
  assert.equal(projectSupportsPermission('write', '/work/repo'), true);
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
