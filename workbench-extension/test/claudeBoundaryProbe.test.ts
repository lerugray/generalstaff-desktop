import assert from 'node:assert/strict';
import test from 'node:test';
import { invocationFor } from '../src/adapters/cliAdapter.js';
import { claudeReadBoundaryFailure } from '../scripts/claude-readonly-boundary-evidence.js';

test('the Claude deny-side probe uses the exact production plan profile and strips MCP definitions', () => {
  const invocation = invocationFor('claude', 'verify', 'read', '/tmp/probe', 'Probe.', {
    mcpServers: [{ id: 'headroom', command: process.execPath, args: ['/tmp/boundary-mcp.mjs'] }],
  });
  assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(invocation.args.includes('--tools'), false);
  assert.equal(invocation.args.includes('--allowedTools'), false);
  assert.equal(invocation.args.includes('--mcp-config'), false);
});

test('the Claude deny-side probe fails unless every write surface is denied and markers are absent', () => {
  const denied = 'Write was not available. Bash was denied. boundary_write was not permitted.';
  assert.equal(claudeReadBoundaryFailure(denied, false, false), undefined);
  assert.match(claudeReadBoundaryFailure('Write denied. Bash denied.', false, false) ?? '', /boundary_write/u);
  assert.match(claudeReadBoundaryFailure(denied, true, false) ?? '', /created the write marker/u);
  assert.match(claudeReadBoundaryFailure(denied, false, true) ?? '', /outside its allowlist/u);
});
