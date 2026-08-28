import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as readline from 'node:readline';
import type {
  ConversationReceipt,
  CommandTarget,
  EffortId,
  LaneId,
  LaneSummary,
  PermissionMode,
  RunContinuity,
  RunEvent,
  SeatId,
} from '../domain.js';
import { redact } from '../security/redaction.js';
import type { McpServerLaunch } from '../services/privateRuntime.js';
import { processInvocation } from '../services/processInvocation.js';

export interface RunRequest {
  conversationId: string;
  target: CommandTarget;
  cwd: string;
  lane: LaneSummary;
  seat: SeatId;
  effort: EffortId;
  permission: PermissionMode;
  prompt: string;
  continuity: RunContinuity;
  providerSessionId?: string;
  mcpServers?: McpServerLaunch[];
}

export interface RunCompletion {
  receipt: ConversationReceipt;
  providerSessionId?: string;
}

export interface ActiveRun {
  stop(): void;
  completed: Promise<RunCompletion>;
}

interface ContinuityOptions {
  continuity?: RunContinuity;
  providerSessionId?: string;
  initialSessionId?: string;
  effort?: EffortId;
  runner?: LaneId;
  mcpServers?: McpServerLaunch[];
}

function codexMcpArgs(servers: readonly McpServerLaunch[]): string[] {
  return servers.flatMap((server) => [
    '-c',
    `mcp_servers.${server.id}.command=${JSON.stringify(server.command)}`,
    '-c',
    `mcp_servers.${server.id}.args=${JSON.stringify(server.args)}`,
  ]);
}

function claudeMcpArgs(servers: readonly McpServerLaunch[]): string[] {
  if (!servers.length) return [];
  const mcpServers = Object.fromEntries(servers.map((server) => [server.id, {
    type: 'stdio',
    command: server.command,
    args: server.args,
  }]));
  return ['--mcp-config', JSON.stringify({ mcpServers })];
}

function claudeMcpPermissionArgs(servers: readonly McpServerLaunch[]): string[] {
  const tools = servers.flatMap((server) => server.id === 'headroom'
    ? [
        'mcp__headroom__headroom_compress',
        'mcp__headroom__headroom_retrieve',
        'mcp__headroom__headroom_stats',
      ]
    : [
        'mcp__lane-desk__lanes_status',
        'mcp__lane-desk__lane_harvest',
        'mcp__lane-desk__lane_detail',
      ]);
  return tools.length ? ['--allowedTools', tools.join(',')] : [];
}

export function supportsNativeResume(laneId: LaneId): boolean {
  return laneId !== 'cline';
}

const laneEfforts: Record<LaneId, ReadonlySet<EffortId>> = {
  codex: new Set(['default', 'minimal', 'low', 'medium', 'high', 'xhigh']),
  claude: new Set(['default', 'low', 'medium', 'high', 'xhigh', 'max']),
  kimi: new Set(['default']),
  cline: new Set(['default', 'none', 'low', 'medium', 'high', 'xhigh']),
  cursor: new Set(['default']),
};

export function effectiveEffortFor(laneId: LaneId, seat: SeatId, requested: EffortId = 'default'): EffortId {
  if (!laneEfforts[laneId].has(requested)) {
    throw new Error(`${laneId} does not support the requested effort level.`);
  }
  if (requested !== 'default') return requested;
  if (laneId === 'codex') return 'high';
  if (laneId === 'claude') return seat === 'assist' ? 'high' : 'max';
  if (laneId === 'cline') return seat === 'assist' ? 'medium' : 'high';
  return 'default';
}

function effortLabel(effort: EffortId): string {
  if (effort === 'xhigh') return 'extra high';
  if (effort === 'default') return 'provider default effort';
  return `${effort} effort`;
}

function cursorFableModel(effort: EffortId): string {
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
    throw new Error(`Cursor Fable does not support ${effort} effort.`);
  }
  return `claude-fable-5-thinking-${effort}`;
}

function promptForSeat(seat: SeatId, permission: PermissionMode, prompt: string): string {
  const boundaries: Record<SeatId, string> = {
    orchestrate:
      'Act as the GeneralStaff orchestrator. Ground yourself in the repository instructions, route or execute proportionately, preserve operator-reserved decisions, and report evidence honestly.',
    build:
      'Implement the requested outcome in this repository. Inspect governing instructions first, keep scope bounded, run relevant checks, and do not claim completion without evidence.',
    review:
      'Review only. Do not modify files. Inspect the relevant current sources and return concise, evidence-backed findings ordered by impact.',
    verify:
      'Verify only. Re-run the relevant checks and compare claims with primary evidence. Do not alter product files unless the user explicitly asks for a fix.',
    assist:
      'Provide a concise, practical answer grounded in the selected command target. Do not expand the scope without asking.',
  };
  const permissionBoundary = permission === 'write'
    ? 'The operator explicitly enabled repository edits for this run. Keep changes inside the selected repository and remain within the request.'
    : 'This is a read-only run. Do not modify files, configuration, git state, or external systems.';
  const decisionBoundary = [
    'Decision card protocol:',
    'Only when work genuinely cannot continue without operator judgment, end your response with one block in this exact shape:',
    '<gs-decision>{"title":"Short decision title","question":"What must the operator decide?","options":[{"label":"First option","description":"Concrete consequence"},{"label":"Second option","description":"Concrete consequence"}]}</gs-decision>',
    'Use two to four mutually exclusive options. Do not emit the block for ordinary suggestions, and never choose on the operator\'s behalf.',
  ].join('\n');
  return `${boundaries[seat]}\n\nPermission boundary:\n${permissionBoundary}\n\n${decisionBoundary}\n\nOperator request:\n${prompt}`;
}

export function invocationFor(
  laneId: LaneId,
  seat: SeatId,
  permission: PermissionMode,
  cwd: string,
  prompt: string,
  options: ContinuityOptions = {},
): { args: string[]; stdin?: string; label: string; effort: EffortId } {
  const groundedPrompt = promptForSeat(seat, permission, prompt);
  const writeCapable = permission === 'write';
  const effort = effectiveEffortFor(laneId, seat, options.effort);
  const runner = options.runner ?? laneId;
  if (runner !== laneId && !(laneId === 'claude' && runner === 'cursor')) {
    throw new Error(`${laneId} cannot use the ${runner} runner.`);
  }
  const nativeSession = options.continuity === 'native' ? options.providerSessionId : undefined;
  const mcpServers = options.mcpServers ?? [];
  if (options.continuity === 'native' && !nativeSession) {
    throw new Error('Native continuation requires a provider session identifier.');
  }

  switch (laneId) {
    case 'codex': {
      if (nativeSession) {
        return {
          args: [
            'exec',
            'resume',
            '--json',
            '--model',
            'gpt-5.6-sol',
            '-c',
            `sandbox_mode="${writeCapable ? 'workspace-write' : 'read-only'}"`,
            '-c',
            `model_reasoning_effort="${effort}"`,
            ...codexMcpArgs(mcpServers),
            '--skip-git-repo-check',
            nativeSession,
            '-',
          ],
          stdin: groundedPrompt,
          label: `GPT-5.6 Sol · ${effortLabel(effort)}`,
          effort,
        };
      }
      return {
        args: [
          'exec',
          '--json',
          '--model',
          'gpt-5.6-sol',
          '--sandbox',
          writeCapable ? 'workspace-write' : 'read-only',
          '--skip-git-repo-check',
          '-c',
          `model_reasoning_effort="${effort}"`,
          ...codexMcpArgs(mcpServers),
          '-C',
          cwd,
        ],
        stdin: groundedPrompt,
        label: `GPT-5.6 Sol · ${effortLabel(effort)}`,
        effort,
      };
    }
    case 'claude':
      if (runner === 'cursor') {
        return {
          args: [
            ...(nativeSession ? ['--resume', nativeSession] : []),
            '--model',
            cursorFableModel(effort),
            ...(writeCapable ? ['--force'] : ['--mode', 'plan']),
            '--print',
            '--output-format',
            'stream-json',
            '--stream-partial-output',
            groundedPrompt,
          ],
          label: `Claude Fable 5 via Cursor · ${effortLabel(effort)}`,
          effort,
        };
      }
      // Claude's plan mode is the provider-enforced read boundary. Never weaken
      // it to expose MCP tools: caller-supplied servers are stripped from every
      // read-only invocation and are available only after explicit write consent.
      const claudeMcpServers = writeCapable ? mcpServers : [];
      return {
        args: [
          '-p',
          groundedPrompt,
          ...(nativeSession
            ? ['--resume', nativeSession]
            : options.initialSessionId
              ? ['--session-id', options.initialSessionId]
              : []),
          '--model',
          'fable',
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          writeCapable ? 'acceptEdits' : 'plan',
          '--effort',
          effort,
          ...claudeMcpPermissionArgs(claudeMcpServers),
          ...claudeMcpArgs(claudeMcpServers),
        ],
        label: `Claude Fable · ${effortLabel(effort)}`,
        effort,
      };
    case 'kimi':
      if (!writeCapable) {
        throw new Error('Kimi prompt mode cannot provide a read-only plan boundary. Enable edit access explicitly or choose another lane.');
      }
      return {
        args: [
          ...(nativeSession ? ['--session', nativeSession] : []),
          '-p',
          groundedPrompt,
          '--output-format',
          'stream-json',
        ],
        label: 'Kimi for Coding (configured default) · provider default effort',
        effort,
      };
    case 'cline':
      if (nativeSession) {
        throw new Error('Cline JSON prompt mode does not currently accept resumed non-interactive turns.');
      }
      return {
        args: [
          ...(!writeCapable ? ['--plan'] : []),
          '--auto-approve',
          writeCapable ? 'true' : 'false',
          '--json',
          '--thinking',
          effort,
          '-c',
          cwd,
          groundedPrompt,
        ],
        label: `Cline configured model · ${effortLabel(effort)}`,
        effort,
      };
    case 'cursor':
      return {
        args: [
          ...(nativeSession ? ['--resume', nativeSession] : []),
          '--model',
          'auto',
          ...(writeCapable ? ['--force'] : ['--mode', 'plan']),
          '--print',
          '--output-format',
          'stream-json',
          '--stream-partial-output',
          groundedPrompt,
        ],
        label: 'Cursor auto-selected model · provider default effort',
        effort,
      };
  }
}

function safeProviderSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^(?:[a-z][a-z0-9_-]*_)?[a-z0-9][a-z0-9-]{7,159}$/iu.test(trimmed) ? trimmed : undefined;
}

export function providerSessionIdFromLine(laneId: LaneId, line: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (laneId === 'codex') return safeProviderSessionId(record.thread_id);
  if (laneId === 'kimi' || laneId === 'cursor' || laneId === 'claude') {
    return safeProviderSessionId(record.session_id);
  }
  return undefined;
}

export function redactProviderSessionEvidence(value: string): string {
  return value
    .replace(/((?:"|')?(?:session|thread|chat)[_-]?id(?:"|')?\s*:\s*(?:"|')?)[a-z0-9_-]{8,160}/giu, '$1[redacted]')
    .replace(/\bsession_[a-z0-9-]{8,160}\b/giu, '[redacted-session]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/giu, '[redacted-session]');
}

function textAt(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return undefined;
}

function nestedText(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => nestedText(item, depth + 1))
      .filter((item): item is string => Boolean(item))
      .join('');
    return joined || undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'result', 'content', 'message', 'delta']) {
    if (record[key] !== undefined) {
      const found = nestedText(record[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function normalizeCliLine(laneId: LaneId, line: string): RunEvent | undefined {
  const safeLine = redact(line.trim());
  if (!safeLine) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(safeLine);
  } catch {
    return { type: 'assistant-delta', text: `${safeLine}\n` };
  }

  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const type = String(record.type ?? record.event ?? record.role ?? '');

  // Claude's terminal `result` repeats the accumulated assistant response that
  // has already arrived as assistant stream events. Suppress that known final
  // envelope without deduplicating arbitrary text from other lanes.
  if (laneId === 'claude' && (type === 'result' || type === 'run_result')) {
    return undefined;
  }

  // With --stream-partial-output Cursor emits timestamped assistant deltas,
  // followed by an untimestamped accumulated assistant envelope and a result
  // envelope. The latter two are receipts, not additional prose.
  if (laneId === 'cursor') {
    if (type === 'result' || type === 'run_result') return undefined;
    if (type === 'assistant' && record.timestamp_ms === undefined) return undefined;
  }

  if (laneId === 'cline') {
    if (type === 'run_result') return undefined;
    if (type === 'agent_event' && typeof record.event === 'object' && record.event !== null) {
      const event = record.event as Record<string, unknown>;
      if (event.type === 'content_start' && event.contentType === 'text') {
        const text = textAt(event, ['text']);
        if (text) return { type: 'assistant-delta', text };
      }
      if (event.type === 'content_end') return undefined;
    }
  }

  if (laneId === 'codex' && type === 'item.completed') {
    const item = record.item;
    if (typeof item === 'object' && item !== null) {
      const itemRecord = item as Record<string, unknown>;
      if (itemRecord.type === 'agent_message') {
        const text = textAt(itemRecord, ['text', 'content']);
        if (text) return { type: 'assistant-delta', text };
      }
      const command = textAt(itemRecord, ['command', 'name']);
      if (command) return { type: 'tool', text: command };
    }
  }

  if (/tool|command|action/i.test(type)) {
    const tool = textAt(record, ['name', 'tool', 'command', 'text']);
    return tool ? { type: 'tool', text: tool } : undefined;
  }

  if (/error|failed/i.test(type)) {
    const error = textAt(record, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
    return { type: 'error', text: error };
  }

  if (/started|thinking|progress|status/i.test(type)) {
    return { type: 'status', text: type.replace(/[._-]+/g, ' ') };
  }

  const direct = nestedText(record);
  if (direct && /assistant|content|message|delta|result|run_result|say|text/i.test(type)) {
    return { type: 'assistant-delta', text: direct };
  }

  return undefined;
}

export function stopProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined || child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const escalation = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-(child.pid as number), 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 4_000);
  escalation.unref();
}

export function runCliAdapter(request: RunRequest, onEvent: (event: RunEvent) => void): ActiveRun {
  if (!request.lane.executable) {
    throw new Error(`${request.lane.name} is not installed on this machine.`);
  }

  const initialSessionId = request.lane.id === 'claude' && request.lane.runner === 'claude' && request.continuity !== 'native'
    ? crypto.randomUUID()
    : undefined;
  const invocation = invocationFor(request.lane.id, request.seat, request.permission, request.cwd, request.prompt, {
    continuity: request.continuity,
    ...(request.providerSessionId ? { providerSessionId: request.providerSessionId } : {}),
    ...(initialSessionId ? { initialSessionId } : {}),
    effort: request.effort,
    runner: request.lane.runner,
    ...(request.mcpServers ? { mcpServers: request.mcpServers } : {}),
  });
  const protocolLaneId = request.lane.runner === 'cursor' ? 'cursor' : request.lane.id;
  const startedAt = Date.now();
  let stopped = false;
  const evidence: string[] = [];
  let observedModel: string | undefined;
  let providerSessionId = request.providerSessionId ?? initialSessionId;
  let sawStdout = false;
  const rememberEvidence = (source: 'stdout' | 'stderr', value: string) => {
    if (evidence.length >= 80) return;
    const safe = redactProviderSessionEvidence(redact(value.trim())).slice(0, 800);
    if (safe) evidence.push(`${source}: ${safe}`);
  };

  onEvent({ type: 'status', text: `Starting ${request.lane.name}` });
  const processSpec = processInvocation(request.lane.executable, invocation.args);
  const child = spawn(processSpec.executable, processSpec.args, {
    cwd: request.cwd,
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
      ...processSpec.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (invocation.stdin !== undefined) {
    child.stdin.end(invocation.stdin);
  } else {
    child.stdin.end();
  }

  const stdout = readline.createInterface({ input: child.stdout });
  stdout.on('line', (line) => {
    sawStdout = true;
    rememberEvidence('stdout', line);
    providerSessionId ??= providerSessionIdFromLine(protocolLaneId, line);
    try {
      const envelope = JSON.parse(line) as Record<string, unknown>;
      const model = envelope.model;
      if (typeof model === 'string' && model.trim()) observedModel = model.trim();
      if (typeof model === 'object' && model !== null) {
        const modelId = (model as Record<string, unknown>).id;
        if (typeof modelId === 'string' && modelId.trim()) observedModel = modelId.trim();
      }
    } catch {
      // Plain-text lanes still produce normalized assistant output.
    }
    const event = normalizeCliLine(protocolLaneId, line);
    if (!event) return;
    onEvent(event);
  });

  const stderr = readline.createInterface({ input: child.stderr });
  const stderrLines: string[] = [];
  stderr.on('line', (line) => {
    rememberEvidence('stderr', line);
    const safe = redact(line.trim());
    if (safe && !/\bwarn(?:ing)?\b|deprecated/i.test(safe)) {
      stderrLines.push(safe.slice(0, 240));
      stderrLines.splice(0, Math.max(0, stderrLines.length - 4));
    }
  });

  const completed = new Promise<RunCompletion>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(redact(error.message))));
    child.once('close', (exitCode) => {
      stdout.close();
      stderr.close();
      if (exitCode !== 0 && !stopped) {
        onEvent({ type: 'error', text: stderrLines.at(-1) ?? `${request.lane.name} exited before completing the run.` });
      }
      const receipt: ConversationReceipt = {
        laneId: request.lane.id,
        laneName: request.lane.name,
        seat: request.seat,
        target: request.target,
        modelLabel: observedModel
          ? `${observedModel} · ${effortLabel(invocation.effort)}`
          : invocation.label,
        startedAt,
        finishedAt: Date.now(),
        exitCode,
        stopped,
        permission: request.permission,
        effort: invocation.effort,
        workingDirectory: redact(request.cwd),
        evidence,
        continuity: request.continuity,
        ...(request.permission === 'write' ? { consentedAt: startedAt } : {}),
      };
      onEvent({ type: 'complete', receipt });
      const resumableSessionId = request.lane.id === 'claude' && exitCode !== 0 && !sawStdout
        ? undefined
        : providerSessionId;
      resolve({ receipt, ...(resumableSessionId ? { providerSessionId: resumableSessionId } : {}) });
    });
  });

  return {
    stop() {
      stopped = true;
      stopProcessTree(child);
    },
    completed,
  };
}
