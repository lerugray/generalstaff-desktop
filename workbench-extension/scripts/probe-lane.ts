import * as path from 'node:path';
import { runAdapter } from '../src/adapters/runAdapter.js';
import type { LaneId } from '../src/domain.js';
import { discoverLanes } from '../src/services/lanes.js';

const known: LaneId[] = ['codex', 'claude', 'kimi', 'cline', 'cursor', 'grok', 'glm-ollama', 'glm-ollama-flash'];

async function main(): Promise<void> {
  const requested = process.argv[2] as LaneId | undefined;
  if (!requested || !known.includes(requested)) {
    throw new Error(`Choose one lane: ${known.join(', ')}`);
  }

  const lane = (await discoverLanes()).find((item) => item.id === requested);
  if (!lane || lane.state !== 'available') {
    throw new Error(`${requested} is not available.`);
  }

  const cwd = path.resolve(process.argv[3] ?? process.cwd());
  const run = runAdapter(
    {
      conversationId: 'manual-probe',
      target: { kind: 'general' },
      cwd,
      lane,
      seat: 'assist',
      effort: 'default',
      permission: requested === 'kimi' ? 'write' : 'read',
      prompt: 'Do not use tools. Reply with exactly GS_LANE_OK and no other text.',
      continuity: 'new',
    },
    (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  );

  const completion = await run.completed;
  if (completion.receipt.exitCode !== 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
