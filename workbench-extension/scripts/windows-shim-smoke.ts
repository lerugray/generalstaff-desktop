import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { processInvocation } from '../src/services/processInvocation.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'gs-workbench-windows-smoke-'));
try {
  const entry = path.join(root, 'node_modules', 'probe', 'cli.js');
  const shim = path.join(root, 'probe.cmd');
  const marker = path.join(root, 'injected.txt');
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n');
  writeFileSync(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\probe\\cli.js" %*\r\n');
  const prompt = `safe & echo INJECTED > "${marker}"`;
  const invocation = processInvocation(shim, [prompt], 'win32');
  const result = spawnSync(invocation.executable, invocation.args, {
    encoding: 'utf8',
    env: { ...process.env, ...invocation.env },
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `child exited ${result.status}`);
  if (existsSync(marker)) throw new Error('cmd metacharacters were executed.');
  const received = JSON.parse(result.stdout) as string[];
  if (received.length !== 1 || received[0] !== prompt) throw new Error('prompt argv did not round-trip exactly.');
  const probeOutput = execFileSync(invocation.executable, invocation.args, {
    encoding: 'utf8',
    env: { ...process.env, ...invocation.env },
    windowsHide: true,
  });
  const probeReceived = JSON.parse(probeOutput) as string[];
  if (probeReceived.length !== 1 || probeReceived[0] !== prompt || existsSync(marker)) {
    throw new Error('execFile probe argv did not round-trip safely.');
  }
  process.stdout.write('WINDOWS_SHIM_OK\n');
} finally {
  if (existsSync(root)) {
    // The root was returned by mkdtempSync in this process and is never user input.
    rmSync(root, { recursive: true, force: true });
  }
}
