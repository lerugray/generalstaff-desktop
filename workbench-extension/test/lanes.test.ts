import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { discoverCliLanes, type CliLaneDiscoveryOptions } from '../src/services/lanes.js';

const grokExecutable = path.join(os.homedir(), '.grok/bin/grok');
const cursorExecutable = path.join(os.homedir(), '.local/bin/cursor-agent');

function discoveryOptions(authFilePresent: boolean): CliLaneDiscoveryOptions & { calls: string[] } {
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
      if (executable === grokExecutable) return { authenticated: args.join(' ') === '--version' };
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
  assert.equal(options.calls.some((call) => call.startsWith(`${grokExecutable}:`) && call.includes('models')), false);
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
