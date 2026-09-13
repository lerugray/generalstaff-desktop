import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { discoverCliLanes, type CliLaneDiscoveryOptions } from '../src/services/lanes.js';

const grokExecutable = path.join(os.homedir(), '.grok/bin/grok');
const cursorExecutable = path.join(os.homedir(), '.local/bin/cursor-agent');

/**
 * `grokEntitled` models the subscription state the CLI reports from `grok models`. An installed,
 * authenticated-looking CLI whose subscription has lapsed still passes `--version` and still has
 * an auth.json on disk - it only fails at request time, with a 402 and a prompt echo that reads
 * like an answer. The seat must demote it at discovery instead.
 */
function discoveryOptions(
  authFilePresent: boolean,
  grokEntitled = true,
): CliLaneDiscoveryOptions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    canExecute: async (candidate) => candidate === grokExecutable || candidate === cursorExecutable,
    findOnPath: async () => undefined,
    fileExists: async (candidate) => {
      calls.push(`file:${candidate}`);
      return authFilePresent;
    },
    probe: async (executable, args) => {
      calls.push(`${executable}:${args.join(' ')}`);
      if (executable === grokExecutable) {
        if (args.join(' ') === '--version') return { authenticated: true };
        if (args.join(' ') === 'models') {
          return grokEntitled
            ? { authenticated: true, output: 'You are logged in with grok.com.\n  * grok-4.6' }
            : { authenticated: true, output: 'You are not authenticated.\n  * grok-4.6' };
        }
        return { authenticated: false };
      }
      if (args.join(' ') === 'status') return { authenticated: true };
      if (args.join(' ') === '--list-models') return { authenticated: true };
      return { authenticated: false };
    },
  };
}

test('selects Grok CLI first from its exact candidates using version plus auth-file availability', async () => {
  const options = discoveryOptions(true);
  const lanes = await discoverCliLanes(options);
  const grok = lanes.find((lane) => lane.id === 'grok');
  assert.equal(grok?.runner, 'grok');
  assert.equal(grok?.executable, grokExecutable);
  assert.equal(grok?.state, 'available');
  assert.match(grok?.detail ?? '', /Grok CLI primary.*provider default/);
  assert.ok(options.calls.includes(`${grokExecutable}:--version`));
  assert.ok(options.calls.includes(`file:${path.join(os.homedir(), '.grok/auth.json')}`));
  assert.ok(options.calls.includes(`${grokExecutable}:models`));
});

test('demotes the Grok CLI to the Cursor runner when it reports itself signed out', async () => {
  const options = discoveryOptions(true, false);
  const lanes = await discoverCliLanes(options);
  const grok = lanes.find((lane) => lane.id === 'grok');
  assert.equal(grok?.runner, 'cursor');
  assert.equal(grok?.executable, cursorExecutable);
  assert.equal(grok?.state, 'available');
  assert.match(grok?.detail ?? '', /Cursor named-model fallback/);
});

test('an operator runner pin overrides discovery order for an unprobeable door', async () => {
  // Probed live 2026-09-13: the Grok CLI reports "You are logged in with grok.com" while every
  // request 402s `personal-team-blocked:spending-limit`, then echoes the prompt to stdout -
  // output indistinguishable from a real answer. No probe can see that, so the operator pins
  // the seat to the Cursor Grok 4.6 door instead.
  const options = { ...discoveryOptions(true, true), forceRunner: { grok: 'cursor' as const } };
  const lanes = await discoverCliLanes(options);
  const grok = lanes.find((lane) => lane.id === 'grok');
  assert.equal(grok?.runner, 'cursor');
  assert.equal(grok?.executable, cursorExecutable);
  assert.equal(grok?.state, 'available');
  assert.match(grok?.detail ?? '', /Cursor named-model fallback/);

  // Without the pin the same machine state keeps the CLI runner, so the pin is what changed it.
  const unpinned = await discoverCliLanes(discoveryOptions(true, true));
  assert.equal(unpinned.find((lane) => lane.id === 'grok')?.runner, 'grok');
});

test('falls back in runners-array order to Cursor when the Grok auth file is absent', async () => {
  const options = discoveryOptions(false);
  const lanes = await discoverCliLanes(options);
  const grok = lanes.find((lane) => lane.id === 'grok');
  assert.equal(grok?.runner, 'cursor');
  assert.equal(grok?.executable, cursorExecutable);
  assert.equal(grok?.state, 'available');
  assert.match(grok?.detail ?? '', /Cursor named-model fallback/);
  assert.ok(options.calls.includes(`${cursorExecutable}:status`));
  assert.ok(options.calls.includes(`${cursorExecutable}:--list-models`));
});
