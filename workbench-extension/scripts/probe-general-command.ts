import * as path from 'node:path';
import { runCliAdapter } from '../src/adapters/cliAdapter.js';
import type { LaneId, RunEvent } from '../src/domain.js';
import { discoverLanes } from '../src/services/lanes.js';

async function main(): Promise<void> {
  const cwd = path.resolve(process.argv[2] ?? process.env.GENERALSTAFF_ROOT ?? '');
  if (!cwd) throw new Error('Pass the GeneralStaff root as the first argument or set GENERALSTAFF_ROOT.');
  const laneId = (process.argv[3] ?? 'codex') as LaneId;
  const lane = (await discoverLanes()).find((item) => item.id === laneId);
  if (!lane || lane.state !== 'available') throw new Error(`${laneId} is not available for the General Command probe.`);

  let output = '';
  const errors: string[] = [];
  const run = runCliAdapter(
    {
      conversationId: 'general-command-cwd-probe',
      target: { kind: 'general' },
      cwd,
      lane,
      seat: 'orchestrate',
      effort: 'default',
      permission: 'read',
      prompt: 'Run the pwd command exactly once. Do not modify anything. Reply with only GS_GENERAL_CWD=<the exact pwd output>.',
      continuity: 'new',
    },
    (event: RunEvent) => {
      if (event.type === 'assistant-delta') output += event.text;
      if (event.type === 'error') errors.push(event.text);
    },
  );
  const completion = await run.completed;
  const cwdEvidence = completion.receipt.evidence
    .filter((line) => /(?:"cwd"|\bpwd\b|CLI run started)/iu.test(line))
    .slice(0, 12);
  process.stdout.write(`${JSON.stringify({
    output: output.trim(),
    exitCode: completion.receipt.exitCode,
    target: completion.receipt.target,
    workingDirectory: completion.receipt.workingDirectory,
    permission: completion.receipt.permission,
    errors,
    evidence: cwdEvidence,
  })}\n`);
  if (
    completion.receipt.exitCode !== 0 ||
    !new RegExp(`^GS_GENERAL_CWD=.*${path.basename(cwd)}$`, 'u').test(output.trim())
  ) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
