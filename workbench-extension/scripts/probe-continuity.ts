import * as path from 'node:path';
import { runCliAdapter } from '../src/adapters/cliAdapter.js';
import type { LaneId, RunEvent, SeatId } from '../src/domain.js';
import { discoverLanes } from '../src/services/lanes.js';

const nativeLanes: LaneId[] = ['codex', 'kimi', 'cursor'];
const nonce = 'AMBER-FALCON-482';

async function main(): Promise<void> {
  const requested = process.argv[2] as LaneId | undefined;
  if (!requested || !nativeLanes.includes(requested)) {
    throw new Error(`Choose one live-probed native lane: ${nativeLanes.join(', ')}`);
  }
  const lane = (await discoverLanes()).find((item) => item.id === requested);
  if (!lane || lane.state !== 'available') throw new Error(`${requested} is not available.`);
  const cwd = path.resolve(process.argv[3] ?? process.cwd());
  const seat: SeatId = requested === 'kimi' ? 'orchestrate' : requested === 'cursor' ? 'verify' : 'assist';
  const permission = requested === 'kimi' ? 'write' as const : 'read' as const;

  const first = await turn(
    `Remember the nonce ${nonce} for the next turn. Do not use tools or modify files. Reply exactly ACK.`,
    'new',
  );
  if (!first.completion.providerSessionId || first.completion.receipt.exitCode !== 0) {
    throw new Error(`${requested} did not return a resumable first turn.`);
  }
  const second = await turn(
    'Without using tools or modifying files, reply with only the nonce I asked you to remember in the prior turn.',
    'native',
    first.completion.providerSessionId,
  );
  const remembered = second.output.trim() === nonce;
  process.stdout.write(`${JSON.stringify({
    lane: requested,
    firstExit: first.completion.receipt.exitCode,
    secondExit: second.completion.receipt.exitCode,
    firstContinuity: first.completion.receipt.continuity,
    secondContinuity: second.completion.receipt.continuity,
    sessionStable: second.completion.providerSessionId === first.completion.providerSessionId,
    remembered,
  })}\n`);
  if (second.completion.receipt.exitCode !== 0 || !remembered) process.exitCode = 1;

  async function turn(prompt: string, continuity: 'new' | 'native', providerSessionId?: string) {
    let output = '';
    const run = runCliAdapter(
      {
        conversationId: 'continuity-probe',
        projectId: 'continuity-probe',
        cwd,
        lane,
        seat,
        effort: 'default',
        permission,
        prompt,
        continuity,
        ...(providerSessionId ? { providerSessionId } : {}),
      },
      (event: RunEvent) => {
        if (event.type === 'assistant-delta') output += event.text;
      },
    );
    return { completion: await run.completed, output };
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
