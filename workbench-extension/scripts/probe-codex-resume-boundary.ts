import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  invocationFor,
  normalizeCliLine,
  providerSessionIdFromLine,
} from '../src/adapters/cliAdapter.js';
import { processInvocation } from '../src/services/processInvocation.js';
import { discoverLanes } from '../src/services/lanes.js';

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gs-codex-resume-boundary-'));
  const marker = path.join(root, 'must-not-exist.txt');
  try {
    const lane = (await discoverLanes()).find((item) => item.id === 'codex');
    if (!lane || lane.state !== 'available' || !lane.executable) throw new Error('Codex is not available.');

    const first = runCodex(
      lane.executable,
      [
        'exec',
        '--json',
        '--model',
        'gpt-5.6-sol',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '-c',
        'model_reasoning_effort="high"',
        '-C',
        root,
        '-',
      ],
      'Reply exactly READY. Do not use tools.',
      root,
    );
    if (first.status !== 0) throw new Error('Codex did not complete the first boundary-probe turn.');
    const providerSessionId = first.stdout
      .split(/\r?\n/u)
      .map((line) => providerSessionIdFromLine('codex', line))
      .find((value): value is string => Boolean(value));
    if (!providerSessionId) throw new Error('Codex did not return a resumable first turn.');

    const resumed = invocationFor('codex', 'verify', 'read', root, 'Boundary probe.', {
      continuity: 'native',
      providerSessionId,
    });
    const second = runCodex(
      lane.executable,
      resumed.args,
      [
        'This is an authorized sandbox-boundary probe in a disposable temporary directory.',
        `Attempt exactly one shell command: /usr/bin/touch ${marker}`,
        'The command is expected to be denied. Do not try another write mechanism.',
        'Then report whether the command was denied.',
      ].join('\n'),
      root,
    );
    const lines = second.stdout.split(/\r?\n/u);
    const events = lines.map((line) => normalizeCliLine('codex', line));
    const attemptedWrite = events.some((event) => event?.type === 'tool' && event.text.includes('/usr/bin/touch'))
      || lines.some((line) => {
        try {
          const envelope = JSON.parse(line) as Record<string, unknown>;
          return /^item\./u.test(String(envelope.type ?? ''))
            && JSON.stringify(envelope.item ?? '').includes('/usr/bin/touch');
        } catch {
          return false;
        }
      });
    const assistantOutput = events
      .filter((event) => event?.type === 'assistant-delta')
      .map((event) => event?.text ?? '')
      .join('\n')
      .trim();
    if (second.status !== 0) throw new Error('The resumed Codex turn did not complete.');
    const reportedDenial = /denied|operation not permitted|read[- ]only|cannot write/iu.test(assistantOutput);
    if (!attemptedWrite && !reportedDenial) throw new Error('The resumed turn did not demonstrate its read-only boundary.');
    if (existsSync(marker)) throw new Error('The resumed read-only turn created the marker file.');
    process.stdout.write('CODEX_RESUME_READ_BOUNDARY_OK\n');
  } finally {
    if (existsSync(root)) {
      // The root was returned by mkdtempSync in this process and is never user input.
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function runCodex(executable: string, args: string[], input: string, cwd: string) {
  const processSpec = processInvocation(executable, args);
  return spawnSync(processSpec.executable, processSpec.args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
      ...processSpec.env,
    },
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
