import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EffortId, EffortOption, LaneId, LaneSummary, PermissionMode, SeatId } from '../domain.js';
import {
  catalogHasModel,
  fetchOllamaCloudCatalog,
  loadOllamaCloudApiKey,
  ollamaCloudModelFor,
  type FetchLike,
} from './ollamaCloud.js';
import { processInvocation } from './processInvocation.js';

interface LaneDefinition {
  id: LaneId;
  name: string;
  detail: string;
  evidenceLabel: string;
  runners: RunnerDefinition[];
  roles: SeatId[];
  permissions: PermissionMode[];
  efforts: EffortOption[];
  defaultEffort: EffortId;
}

interface RunnerDefinition {
  id: LaneId;
  binary: string;
  candidates: string[];
  probeArgs: string[];
  probeAccept: RegExp;
  requiredFile?: { path: string; issue: string };
  availabilityProbe?: { args: string[]; accept: RegExp; issue: string };
  detailSuffix?: string;
}

const home = os.homedir();

const providerDefault: EffortOption = { id: 'default', label: 'Workbench default' };
const codexEfforts: EffortOption[] = [
  providerDefault,
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];
const claudeEfforts: EffortOption[] = [
  providerDefault,
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];
const grokEfforts: EffortOption[] = [
  providerDefault,
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];
const clineEfforts: EffortOption[] = [
  providerDefault,
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];

const laneDefinitions: LaneDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    detail: 'GPT-class agentic work through the existing Codex subscription',
    evidenceLabel: 'Repo-proven · seat provisional',
    runners: [{
      id: 'codex',
      binary: 'codex',
      candidates: ['/opt/homebrew/bin/codex', path.join(home, '.local/bin/codex')],
      probeArgs: ['login', 'status'],
      probeAccept: /logged in/iu,
    }],
    roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
    permissions: ['read', 'write'],
    efforts: codexEfforts,
    defaultEffort: 'default',
  },
  {
    id: 'claude',
    name: 'Claude Fable',
    detail: 'The operator-proven GeneralStaff judgment seat, explicitly selected',
    evidenceLabel: 'Daily operator seat · not benchmarked',
    runners: [
      {
        id: 'claude',
        binary: 'claude',
        candidates: [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude'],
        probeArgs: ['auth', 'status'],
        probeAccept: /"loggedIn"\s*:\s*true/iu,
        detailSuffix: 'via Claude subscription',
      },
      {
        id: 'cursor',
        binary: 'cursor-agent',
        candidates: [path.join(home, '.local/bin/cursor-agent'), '/opt/homebrew/bin/cursor-agent'],
        probeArgs: ['status'],
        probeAccept: /logged in/iu,
        availabilityProbe: {
          args: ['--list-models'],
          accept: /claude-fable-5-thinking-max/iu,
          issue: 'the required Fable model is unavailable',
        },
        detailSuffix: 'via Cursor subscription',
      },
    ],
    roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
    permissions: ['read', 'write'],
    efforts: claudeEfforts,
    defaultEffort: 'default',
  },
  {
    id: 'kimi',
    name: 'Kimi K3',
    detail: 'Long-context subscription lane for orchestration, specs, and implementation',
    evidenceLabel: 'Measured in the 2026-08-24 seat benchmark',
    runners: [{
      id: 'kimi',
      binary: 'kimi',
      candidates: [path.join(home, '.local/bin/kimi'), path.join(home, '.kimi-code/bin/kimi')],
      probeArgs: ['provider', 'list'],
      probeAccept: /default model/iu,
    }],
    roles: ['orchestrate', 'build'],
    permissions: ['write'],
    efforts: [{ id: 'default', label: 'Provider default' }],
    defaultEffort: 'default',
  },
  {
    id: 'cline',
    name: 'Cline / GLM',
    detail: 'Cline Pass and free GLM-5.3 Flash capacity',
    evidenceLabel: 'GLM measured in the 2026-08-24 seat benchmark',
    runners: [{
      id: 'cline',
      binary: 'cline',
      candidates: ['/opt/homebrew/bin/cline', path.join(home, '.local/bin/cline')],
      probeArgs: ['doctor'],
      probeAccept: /hub healthy\s+yes/iu,
    }],
    roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
    permissions: ['read', 'write'],
    efforts: clineEfforts,
    defaultEffort: 'default',
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    detail: 'Subscription-backed engineering lane with shell and repository tools',
    evidenceLabel: 'Engineering subscription lane · unbenchmarked',
    runners: [{
      id: 'cursor',
      binary: 'cursor-agent',
      candidates: [path.join(home, '.local/bin/cursor-agent'), '/opt/homebrew/bin/cursor-agent'],
      probeArgs: ['status'],
      probeAccept: /logged in/iu,
    }],
    roles: ['build', 'review', 'verify'],
    permissions: ['read', 'write'],
    efforts: [{ id: 'default', label: 'Provider default' }],
    defaultEffort: 'default',
  },
  {
    id: 'grok',
    name: 'Grok 4.6 (trial)',
    detail: "Trial seat rides the Grok subscription's CLI with Cursor named-model fallback",
    evidenceLabel: 'Trial seat - first on the 2026-08-28 orchestrator-seat benchmark',
    runners: [
      {
        id: 'grok',
        binary: 'grok',
        candidates: [path.join(home, '.grok/bin/grok'), path.join(home, '.local/bin/grok')],
        probeArgs: ['--version'],
        probeAccept: /grok \d/iu,
        requiredFile: {
          path: path.join(home, '.grok/auth.json'),
          issue: 'the Grok CLI auth file is missing',
        },
        detailSuffix: 'Grok CLI primary · every effort selection uses provider default',
      },
      {
        id: 'cursor',
        binary: 'cursor-agent',
        candidates: [path.join(home, '.local/bin/cursor-agent'), '/opt/homebrew/bin/cursor-agent'],
        probeArgs: ['status'],
        probeAccept: /logged in/iu,
        availabilityProbe: {
          args: ['--list-models'],
          accept: /cursor-grok-4\.6-high/iu,
          issue: 'the Grok 4.6 trial model is unavailable',
        },
        detailSuffix: 'Cursor named-model fallback',
      },
    ],
    roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
    permissions: ['read', 'write'],
    efforts: grokEfforts,
    defaultEffort: 'default',
  },
];

const ollamaLaneDefinitions = [
  {
    id: 'glm-ollama',
    name: 'GLM 5.3 (Ollama)',
    detail: 'GLM 5.3 through the Ollama Cloud flat subscription',
  },
  {
    id: 'glm-ollama-flash',
    name: 'GLM 5.3 Flash (Ollama)',
    detail: 'GLM 5.3 Flash through the Ollama Cloud flat subscription',
  },
] as const;

export interface OllamaLaneDiscoveryOptions {
  fetcher?: FetchLike;
  loadApiKey?: () => Promise<string | undefined>;
}

export async function discoverOllamaCloudLanes(
  options: OllamaLaneDiscoveryOptions = {},
): Promise<LaneSummary[]> {
  const loadApiKey = options.loadApiKey ?? loadOllamaCloudApiKey;
  const apiKey = await loadApiKey();
  let tags = new Set<string>();
  let issue: string | undefined;
  if (!apiKey) {
    issue = 'OLLAMA_CLOUD_API_KEY is missing from ~/.generalstaff/.env';
  } else {
    try {
      tags = await fetchOllamaCloudCatalog(apiKey, options.fetcher);
    } catch (error) {
      issue = error instanceof Error ? error.message : 'catalog probe failed';
    }
  }

  return ollamaLaneDefinitions.map((definition) => {
    const model = ollamaCloudModelFor(definition.id);
    const available = !issue && catalogHasModel(tags, model);
    const detailIssue = issue ?? `the ${model} tag is unavailable`;
    return {
      id: definition.id,
      runner: definition.id,
      name: definition.name,
      detail: available ? definition.detail : `${definition.detail} · ${detailIssue}`,
      evidenceLabel: 'Ollama Cloud subscription lane · unbenchmarked',
      state: available ? 'available' : 'unavailable',
      roles: ['orchestrate', 'build', 'review', 'verify', 'assist'],
      permissions: ['read'],
      efforts: [{ id: 'default', label: 'Provider default' }],
      defaultEffort: 'default',
    } satisfies LaneSummary;
  });
}

async function canExecute(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(binary: string): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
    : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${binary}${extension.toLowerCase()}`);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export interface ProbeResult {
  authenticated: boolean;
  issue?: string;
}

async function probeLane(executable: string, args: string[], accept: RegExp): Promise<ProbeResult> {
  let processSpec: ReturnType<typeof processInvocation>;
  try {
    processSpec = processInvocation(executable, args);
  } catch (error) {
    return { authenticated: false, issue: error instanceof Error ? error.message : 'Unsupported command shim.' };
  }
  return new Promise((resolve) => {
    execFile(
      processSpec.executable,
      processSpec.args,
      {
        timeout: 12_000,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...processSpec.env },
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/gu, '');
        if (error) {
          const timedOut = (error as Error & { killed?: boolean }).killed === true;
          resolve({ authenticated: false, ...(timedOut ? { issue: 'Authentication probe timed out.' } : {}) });
          return;
        }
        resolve({ authenticated: accept.test(output) });
      },
    );
  });
}

export interface CliLaneDiscoveryOptions {
  canExecute?: (candidate: string) => Promise<boolean>;
  findOnPath?: (binary: string) => Promise<string | undefined>;
  probe?: (executable: string, args: string[], accept: RegExp) => Promise<ProbeResult>;
  fileExists?: (candidate: string) => Promise<boolean>;
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverCliLanes(options: CliLaneDiscoveryOptions = {}): Promise<LaneSummary[]> {
  const executableCheck = options.canExecute ?? canExecute;
  const pathLookup = options.findOnPath ?? findOnPath;
  const probe = options.probe ?? probeLane;
  const exists = options.fileExists ?? fileExists;
  return Promise.all(
    laneDefinitions.map(async (definition) => {
      const discovered: Array<RunnerDefinition & { executable: string; probe: ProbeResult }> = [];
      for (const runner of definition.runners) {
        let executable: string | undefined;
        for (const candidate of runner.candidates) {
          if (await executableCheck(candidate)) {
            executable = candidate;
            break;
          }
        }
        executable ??= await pathLookup(runner.binary);
        if (!executable) continue;
        let result = await probe(executable, runner.probeArgs, runner.probeAccept);
        if (result.authenticated && runner.requiredFile && !(await exists(runner.requiredFile.path))) {
          result = { authenticated: false, issue: runner.requiredFile.issue };
        }
        if (result.authenticated && runner.availabilityProbe) {
          const availability = await probe(
            executable,
            runner.availabilityProbe.args,
            runner.availabilityProbe.accept,
          );
          if (!availability.authenticated) {
            result = { authenticated: false, issue: availability.issue ?? runner.availabilityProbe.issue };
          }
        }
        discovered.push({ ...runner, executable, probe: result });
      }
      const selected = discovered.find((runner) => runner.probe.authenticated) ?? discovered[0];
      const authenticated = selected?.probe.authenticated === true;

      return {
        id: definition.id,
        runner: selected?.id ?? definition.id,
        name: definition.name,
        detail: authenticated
          ? `${definition.detail}${selected?.detailSuffix ? ` · ${selected.detailSuffix}` : ''}`
          : selected
            ? `${definition.detail} · ${selected.probe.issue ?? 'needs login or repair'}`
            : definition.detail,
        evidenceLabel: definition.evidenceLabel,
        state: authenticated ? 'available' : selected ? 'unavailable' : 'missing',
        ...(selected ? { executable: selected.executable } : {}),
        roles: definition.roles,
        permissions: definition.permissions,
        efforts: definition.efforts,
        defaultEffort: definition.defaultEffort,
      } satisfies LaneSummary;
    }),
  );
}

export async function discoverLanes(): Promise<LaneSummary[]> {
  const ollamaLanesPromise = discoverOllamaCloudLanes();
  const cliLanes = await discoverCliLanes();
  const ollamaLanes = await ollamaLanesPromise;
  return [...cliLanes, ...ollamaLanes];
}
