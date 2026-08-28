import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { LaneSummary } from '../src/domain.js';
import {
  discoverPrivateRuntime,
  privateCapabilityReceiptNames,
  privateRuntimePrompt,
  type PrivateRuntimeProfile,
} from '../src/services/privateRuntime.js';

const lane = (id: LaneSummary['id'], runner: LaneSummary['runner'] = id): LaneSummary => ({
  id,
  runner,
  name: id,
  detail: 'test lane',
  evidenceLabel: 'test evidence',
  state: 'available',
  executable: '/bin/test',
  roles: ['orchestrate'],
  permissions: ['read'],
  efforts: [{ id: 'default', label: 'Default' }],
  defaultEffort: 'default',
});

async function makeLaneDeskRuntime(parent: string, cliSource = 'process.stdout.write("[]")'): Promise<string> {
  const directory = path.join(parent, 'lane-desk-runtime');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'mcp_server.py'), 'process.stdin.resume();\n');
  await fs.writeFile(path.join(directory, 'lane_desk.py'), `${cliSource}\n`);
  await fs.writeFile(path.join(directory, 'lane-desk.toml'), '# test\n');
  return directory;
}

test('discovers only a healthy machine-scoped Lane Desk runtime outside the selected root', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-private-runtime-test-'));
  const machineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-private-runtime-machine-test-'));
  context.after(async () => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(machineRoot, { recursive: true, force: true }),
  ]));
  const directory = await makeLaneDeskRuntime(machineRoot);

  const profile = await discoverPrivateRuntime(root, {
    laneDeskRuntimePath: directory,
    headroomCommand: path.join(machineRoot, 'missing-headroom'),
    pythonCommand: process.execPath,
  });
  const laneDesk = profile.capabilities.find((capability) => capability.id === 'lane-desk');
  assert.equal(laneDesk?.state, 'available');
  assert.deepEqual(laneDesk?.nativeLanes, ['codex', 'claude']);
  assert.deepEqual(laneDesk?.fallbackLanes, ['kimi', 'cline', 'cursor']);
  assert.ok(profile.mcpServers.some((server) => server.id === 'lane-desk'));
  assert.match(privateRuntimePrompt(profile, lane('codex')), /native MCP server/);
  assert.match(privateRuntimePrompt(profile, lane('kimi')), /read-only CLI fallback/);
  assert.match(privateRuntimePrompt(profile, lane('claude', 'cursor')), /read-only CLI fallback/);
});

test('never executes or wires Lane Desk code carried by the selected root', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-private-runtime-root-boundary-test-'));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'tools', 'lane-desk');
  const marker = path.join(root, 'repository-code-executed');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'mcp_server.py'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad');\n`);
  await fs.writeFile(path.join(directory, 'lane_desk.py'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'); process.stdout.write('[]');\n`);
  await fs.writeFile(path.join(directory, 'lane-desk.toml'), '# test\n');

  const autoDiscovered = await discoverPrivateRuntime(root, {
    headroomCommand: path.join(root, 'missing-headroom'),
    pythonCommand: process.execPath,
  });
  const explicitlyConfiguredInsideRoot = await discoverPrivateRuntime(root, {
    laneDeskRuntimePath: directory,
    headroomCommand: path.join(root, 'missing-headroom'),
    pythonCommand: process.execPath,
  });

  for (const profile of [autoDiscovered, explicitlyConfiguredInsideRoot]) {
    assert.equal(profile.capabilities.find((capability) => capability.id === 'lane-desk')?.state, 'missing');
    assert.equal(profile.mcpServers.some((server) => server.id === 'lane-desk'), false);
  }
  await assert.rejects(fs.access(marker));
});

test('fails closed when a configured private runtime does not pass its health probe', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-private-runtime-unhealthy-root-test-'));
  const machineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-private-runtime-unhealthy-machine-test-'));
  context.after(async () => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(machineRoot, { recursive: true, force: true }),
  ]));
  const directory = await makeLaneDeskRuntime(machineRoot, 'process.exitCode = 1');

  const profile = await discoverPrivateRuntime(root, {
    laneDeskRuntimePath: directory,
    headroomCommand: path.join(machineRoot, 'missing-headroom'),
    pythonCommand: process.execPath,
  });
  assert.equal(profile.capabilities.find((capability) => capability.id === 'lane-desk')?.state, 'missing');
  assert.equal(profile.mcpServers.some((server) => server.id === 'lane-desk'), false);
});

test('receipts name only capabilities actually transported to the effective lane and runner', () => {
  const profile: PrivateRuntimeProfile = {
    capabilities: [
      {
        id: 'headroom',
        name: 'Headroom',
        detail: 'test',
        state: 'available',
        nativeLanes: ['codex', 'claude'],
        fallbackLanes: [],
      },
      {
        id: 'lane-desk',
        name: 'Lane Desk',
        detail: 'test',
        state: 'available',
        nativeLanes: ['codex', 'claude'],
        fallbackLanes: ['kimi', 'cline', 'cursor'],
      },
    ],
    mcpServers: [],
    laneDeskCli: '/machine/lane-desk/lane_desk.py',
    laneDeskConfig: '/machine/lane-desk/lane-desk.toml',
  };

  assert.deepEqual(privateCapabilityReceiptNames(profile, lane('codex'), 'read'), ['Headroom', 'Lane Desk']);
  assert.deepEqual(privateCapabilityReceiptNames(profile, lane('claude'), 'read'), []);
  assert.deepEqual(privateCapabilityReceiptNames(profile, lane('claude'), 'write'), ['Headroom', 'Lane Desk']);
  assert.deepEqual(
    privateCapabilityReceiptNames(profile, lane('claude', 'cursor'), 'read'),
    ['Lane Desk (CLI fallback)'],
  );
  assert.deepEqual(privateCapabilityReceiptNames(profile, lane('kimi'), 'read'), ['Lane Desk (CLI fallback)']);
  assert.match(privateRuntimePrompt(profile, lane('claude'), 'read'), /Headroom is not attached/);
  assert.match(privateRuntimePrompt(profile, lane('claude'), 'read'), /Lane Desk is not attached/);
});
