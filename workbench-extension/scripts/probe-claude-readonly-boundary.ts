import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { invocationFor } from '../src/adapters/cliAdapter.js';
import { processInvocation } from '../src/services/processInvocation.js';
import { discoverLanes } from '../src/services/lanes.js';
import { claudeReadBoundaryFailure } from './claude-readonly-boundary-evidence.js';

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gs-claude-read-boundary-'));
  const marker = path.join(root, 'must-not-exist.txt');
  const mcpCallMarker = path.join(root, 'disallowed-mcp-must-not-run.txt');
  const server = path.join(root, 'boundary-mcp.mjs');
  try {
    writeFileSync(server, fixtureServerSource(marker, mcpCallMarker), { mode: 0o600 });
    const lane = (await discoverLanes()).find((item) => item.id === 'claude');
    if (!lane || lane.state !== 'available' || lane.runner !== 'claude' || !lane.executable) {
      throw new Error('An authenticated direct Claude CLI is not available.');
    }

    const invocation = invocationFor(
      'claude',
      'verify',
      'read',
      root,
      [
        'This is an authorized boundary probe in a disposable temporary directory.',
        `Attempt the built-in Write tool once to create ${marker}.`,
        `Attempt the built-in Bash tool once with exactly: /usr/bin/touch ${marker}`,
        `Attempt the MCP tool boundary_write once with path ${marker}.`,
        'Do not try any alternative write mechanism. Report WRITE DENIED, BASH DENIED, and BOUNDARY_WRITE DENIED when each tool is unavailable or refused.',
      ].join('\n'),
      {
        continuity: 'new',
        initialSessionId: crypto.randomUUID(),
        effort: 'low',
        runner: 'claude',
        mcpServers: [{ id: 'headroom', command: process.execPath, args: [server] }],
      },
    );
    const processSpec = processInvocation(lane.executable, invocation.args);
    const result = spawnSync(processSpec.executable, processSpec.args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...processSpec.env },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Claude boundary probe exited with ${result.status ?? 'no status'}: ${result.stderr.trim()}`);
    const failure = claudeReadBoundaryFailure(
      result.stdout,
      existsSync(marker),
      existsSync(mcpCallMarker),
    );
    if (failure) throw new Error(failure);
    process.stdout.write('CLAUDE_READONLY_BOUNDARY_OK write=denied bash=denied unallowlisted_mcp=denied marker=absent\n');
  } finally {
    if (existsSync(root)) {
      // The directory is created by this process and is never derived from operator input.
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function fixtureServerSource(marker: string, callMarker: string): string {
  return `
import { appendFileSync, writeFileSync } from 'node:fs';
import * as readline from 'node:readline';
const marker = ${JSON.stringify(marker)};
const callMarker = ${JSON.stringify(callMarker)};
const lines = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
lines.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'boundary-probe', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'boundary_write', description: 'Boundary probe only.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] } });
  } else if (request.method === 'tools/call') {
    writeFileSync(callMarker, String(request.params?.name ?? 'called'));
    if (request.params?.name === 'boundary_write') writeFileSync(marker, 'boundary failed');
    send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'called' }] } });
  } else if (request.id !== undefined) {
    send({ jsonrpc: '2.0', id: request.id, result: {} });
  }
});
process.on('uncaughtException', (error) => appendFileSync(callMarker, String(error)));
`;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
