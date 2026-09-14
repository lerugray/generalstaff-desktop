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
import { parseClaudeStreamUsage } from '../services/claudeUsage.js';
import { extraAddDirArgs } from '../services/handoffPaths.js';
import { ollamaCcDoorFor } from '../services/ollamaCloud.js';
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

export type SteeringMode = 'none' | 'hold-until-turn';

export interface ActiveRun {
  stop(): void;
  completed: Promise<RunCompletion>;
  /** When set, mid-run follow-ups go to this live process instead of spawning again. */
  steering?: SteeringMode;
  /**
   * Deliver a follow-up onto the live stdin immediately (harness enqueues mid-turn).
   * Returns false when the write could not be performed — caller must fall through
   * to pendingFollowUps so the message is never silently lost.
   */
  enqueueFollowUp?(text: string): boolean;
}

/** One stream-json user line for Claude Code `--input-format stream-json`. */
export function streamJsonUserLine(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  })}\n`;
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
  return !['cline', 'glm-ollama', 'glm-ollama-flash', 'deepseek-ollama'].includes(laneId);
}

const laneEfforts: Record<LaneId, ReadonlySet<EffortId>> = {
  codex: new Set(['default', 'minimal', 'low', 'medium', 'high', 'xhigh']),
  claude: new Set(['default', 'low', 'medium', 'high', 'xhigh', 'max']),
  kimi: new Set(['default']),
  cline: new Set(['default', 'none', 'low', 'medium', 'high', 'xhigh']),
  cursor: new Set(['default']),
  grok: new Set(['default', 'low', 'medium', 'high', 'xhigh']),
  'glm-ollama': new Set(['default']),
  'glm-ollama-flash': new Set(['default']),
  'deepseek-ollama': new Set(['default']),
  'deepseek-ollama-cc': new Set(['default', 'low', 'medium', 'high', 'xhigh']),
  'glm-ollama-cc': new Set(['default', 'low', 'medium', 'high', 'xhigh']),
};

export function effectiveEffortFor(laneId: LaneId, seat: SeatId, requested: EffortId = 'default'): EffortId {
  if (!laneEfforts[laneId].has(requested)) {
    throw new Error(`${laneId} does not support the requested effort level.`);
  }
  if (requested !== 'default') return requested;
  if (laneId === 'codex') return 'high';
  if (laneId === 'claude') return seat === 'assist' ? 'high' : 'max';
  if (laneId === 'grok') return 'high';
  if (laneId === 'cline') return seat === 'assist' ? 'medium' : 'high';
  if (laneId === 'deepseek-ollama-cc' || laneId === 'glm-ollama-cc') return 'high';
  return 'default';
}

export function effortLabel(effort: EffortId): string {
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

function cursorGrokModel(effort: EffortId): string {
  if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    throw new Error(`Cursor Grok does not support ${effort} effort.`);
  }
  return `cursor-grok-4.6-${effort}`;
}

const SEAT_CONDUCT = [
  'SEAT CONDUCT:',
  '(a) Work in rounds. End every round — at most ~10 minutes of activity, or immediately when a dispatch/harvest lands — with a 3-6 line plain-English status covering DONE / RUNNING (lane + sentinel + expected time) / NEXT / NEEDS YOU, then hand control back.',
  '(b) Never block inside a tool call: no sleep over 60 s, no polling loops in a foreground call. Long waits go to a background `until` loop (run_in_background) or a Monitor; report the event in a new round when it fires.',
  '(c) Filter shell output: keep what the operator needs; drop noise.',
  '(d) The decision-card protocol below is unchanged.',
  '(e) If the operator queued a message while you were in a round, acknowledge it and act on it at the next turn boundary before continuing prior work.',
  'Speak plain English to the operator. No jargon dumps.',
].join('\n');

export function promptForSeat(seat: SeatId, permission: PermissionMode, prompt: string): string {
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
  return `${boundaries[seat]}\n\n${SEAT_CONDUCT}\n\nPermission boundary:\n${permissionBoundary}\n\n${decisionBoundary}\n\nOperator request:\n${prompt}`;
}

export function invocationFor(
  laneId: LaneId,
  seat: SeatId,
  permission: PermissionMode,
  cwd: string,
  prompt: string,
  options: ContinuityOptions = {},
): {
  args: string[];
  stdin?: string;
  keepStdinOpen?: boolean;
  steering?: SteeringMode;
  label: string;
  effort: EffortId;
} {
  const groundedPrompt = promptForSeat(seat, permission, prompt);
  const writeCapable = permission === 'write';
  const runner = options.runner ?? laneId;
  const requestedEffort = effectiveEffortFor(laneId, seat, options.effort);
  const effort = laneId === 'grok' && runner === 'grok' ? 'default' : requestedEffort;
  if (
    runner !== laneId &&
    !(laneId === 'claude' && runner === 'cursor') &&
    !(laneId === 'grok' && runner === 'cursor')
  ) {
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
            ...extraAddDirArgs(),
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
          ...extraAddDirArgs(),
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
            ...extraAddDirArgs(),
            groundedPrompt,
          ],
          label: `Claude Fable 5 via Cursor · ${effortLabel(effort)}`,
          effort,
        };
      }
      // Claude's plan mode is the provider-enforced read boundary. Never weaken
      // it to expose MCP tools: caller-supplied servers are stripped from every
      // read-only invocation and are available only after explicit write consent.
      // M5: stream-json INPUT keeps stdin open so mid-run steering lands on the
      // same live process (hold-until-turn fallback — see PROBE-STEERING.md).
      const claudeMcpServers = writeCapable ? mcpServers : [];
      return {
        args: [
          '-p',
          ...(nativeSession
            ? ['--resume', nativeSession]
            : options.initialSessionId
              ? ['--session-id', options.initialSessionId]
              : []),
          '--model',
          'fable',
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          writeCapable ? 'acceptEdits' : 'plan',
          '--effort',
          effort,
          ...extraAddDirArgs(),
          ...claudeMcpPermissionArgs(claudeMcpServers),
          ...claudeMcpArgs(claudeMcpServers),
        ],
        stdin: streamJsonUserLine(groundedPrompt),
        keepStdinOpen: true,
        steering: 'hold-until-turn',
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
          ...extraAddDirArgs(),
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
          ...extraAddDirArgs(),
          groundedPrompt,
        ],
        label: 'Cursor auto-selected model · provider default effort',
        effort,
      };
    case 'grok':
      if (runner === 'grok') {
        return {
          args: [
            ...(nativeSession ? ['--resume', nativeSession] : []),
            '--permission-mode',
            writeCapable ? 'bypassPermissions' : 'plan',
            '--output-format',
            'plain',
            '-p',
            groundedPrompt,
          ],
          label: 'Grok 4.6 via Grok CLI · provider default effort',
          effort,
        };
      }
      return {
        args: [
          ...(nativeSession ? ['--resume', nativeSession] : []),
          '--model',
          cursorGrokModel(effort),
          ...(writeCapable ? ['--force'] : ['--mode', 'plan']),
          '--print',
          '--output-format',
          'stream-json',
          '--stream-partial-output',
          ...extraAddDirArgs(),
          groundedPrompt,
        ],
        label: `Grok 4.6 via Cursor fallback · ${effortLabel(effort)}`,
        effort,
      };
    case 'deepseek-ollama-cc':
    case 'glm-ollama-cc': {
      // The CC door runs the real Claude Code binary, so the operator's plan-mode read
      // boundary, effort levels and session resume all behave exactly as they do on the Fable
      // seat. Only the provider behind it differs. MCP servers are withheld on read-only runs
      // for the same reason they are on the Claude lane.
      // M5: stream-json INPUT + open stdin — mid-run messages are held until the next
      // turn boundary, then written on this same live process (PROBE-STEERING.md).
      const ccMcpServers = writeCapable ? mcpServers : [];
      return {
        args: [
          ollamaCcDoorFor(laneId).door,
          '-p',
          ...(nativeSession
            ? ['--resume', nativeSession]
            : options.initialSessionId
              ? ['--session-id', options.initialSessionId]
              : []),
          '--model',
          'sonnet',
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          writeCapable ? 'acceptEdits' : 'plan',
          '--effort',
          effort,
          ...extraAddDirArgs(),
          ...claudeMcpPermissionArgs(ccMcpServers),
          ...claudeMcpArgs(ccMcpServers),
        ],
        stdin: streamJsonUserLine(groundedPrompt),
        keepStdinOpen: true,
        steering: 'hold-until-turn',
        label: `${ollamaCcDoorFor(laneId).model} via Claude Code · ${effortLabel(effort)}`,
        effort,
      };
    }
    case 'glm-ollama':
    case 'glm-ollama-flash':
    case 'deepseek-ollama':
      throw new Error(`${laneId} uses the Ollama Cloud API adapter.`);
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
  if (
    laneId === 'kimi' || laneId === 'cursor' || laneId === 'claude' ||
    laneId === 'deepseek-ollama-cc' || laneId === 'glm-ollama-cc'
  ) {
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
  // tool_use / tool_result blocks often contain a `content` key (e.g. Write
  // tool input). Never treat those payloads as assistant prose.
  if (record.type === 'tool_use' || record.type === 'tool_result') return undefined;
  for (const key of ['text', 'result', 'content', 'message', 'delta']) {
    if (record[key] !== undefined) {
      const found = nestedText(record[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function claudeMessageContent(record: Record<string, unknown>): unknown[] | undefined {
  const message = record.message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? content : undefined;
}

function claudeMessageId(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const id = (message as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/**
 * Clip to a UTF-16 budget without splitting surrogate pairs (FIXLIST-R3 CODE 4).
 * Used by capPersisted for 8KB bodies. clipOneLine stays rune-counted (below).
 */
export function clipAtRuneBudget(value: string, maxCodeUnits: number): string {
  if (maxCodeUnits <= 0) return '';
  if (value.length <= maxCodeUnits) return value;
  const budget = Math.max(0, maxCodeUnits - 1); // leave room for …
  let out = '';
  for (const rune of value) {
    if (out.length + rune.length > budget) break;
    out += rune;
  }
  return `${out}…`;
}

/** Clip to one line on a Unicode rune boundary (MINOR 9) — never split surrogate pairs. */
export function clipOneLine(value: string, max: number): string {
  const line = value.replace(/\s+/gu, ' ').trim();
  const runes = Array.from(line);
  if (runes.length <= max) return line;
  return `${runes.slice(0, Math.max(0, max - 1)).join('')}…`;
}

const TOOL_DETAIL_MAX = 8_192;
const TOOL_RESULT_MAX = 8_192;

/** Persist at most `max` UTF-16 code units without splitting a rune (NEW-3). */
function capPersisted(value: string, max: number): string {
  return clipAtRuneBudget(value, max);
}

function toolInputRecord(item: Record<string, unknown>): Record<string, unknown> {
  const input = item.input;
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

/** One-line label for a Claude-protocol tool_use (Claude Code desktop shape). */
export function claudeProtocolToolLabel(item: Record<string, unknown>): {
  name: string;
  summary: string;
  detail: string;
  toolUseId?: string;
} {
  const name = textAt(item, ['name', 'tool']) ?? 'tool';
  const input = toolInputRecord(item);
  const toolUseId = typeof item.id === 'string' && item.id.trim() ? item.id : undefined;
  let summary = '';
  let detail = '';

  if (name === 'Bash' || name === 'bash') {
    const command = textAt(input, ['command']) ?? '';
    summary = clipOneLine(command, 80);
    detail = command;
  } else if (name === 'Read' || name === 'Edit' || name === 'Write'
    || name === 'read' || name === 'edit' || name === 'write') {
    const filePath = textAt(input, ['file_path', 'path', 'filePath']) ?? '';
    summary = filePath;
    detail = filePath;
  } else if (name === 'Grep' || name === 'Glob' || name === 'grep' || name === 'glob') {
    const pattern = textAt(input, ['pattern', 'glob', 'glob_pattern']) ?? '';
    summary = pattern;
    detail = pattern;
  } else if (name === 'Agent' || name === 'Task' || name === 'agent' || name === 'task') {
    const description = textAt(input, ['description', 'prompt']) ?? '';
    summary = clipOneLine(description, 80);
    detail = description;
  } else {
    const description = textAt(input, ['description', 'command', 'path', 'file_path', 'pattern']) ?? '';
    summary = clipOneLine(description, 80);
    detail = description;
  }

  return {
    name,
    summary: summary || name,
    detail: capPersisted(detail || summary || name, TOOL_DETAIL_MAX),
    ...(toolUseId ? { toolUseId } : {}),
  };
}

function toolResultBody(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string' && block.trim()) {
        parts.push(block);
        continue;
      }
      if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
      const item = block as Record<string, unknown>;
      if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text);
    }
    return parts.join('\n');
  }
  if (typeof content === 'object' && content !== null) {
    const text = textAt(content as Record<string, unknown>, ['text', 'content', 'message']);
    if (text) return text;
  }
  return '';
}

/** Explicit Claude-protocol assistant text: only `type: "text"` content blocks. */
export function claudeProtocolAssistantText(record: Record<string, unknown>): string | undefined {
  const content = claudeMessageContent(record);
  if (!content) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    const item = block as Record<string, unknown>;
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text);
    }
  }
  return parts.length ? parts.join('') : undefined;
}

/**
 * Walk Claude-protocol assistant content in order: thinking → text → tool cards.
 * Never leaks tool_use input bodies into assistant prose.
 */
export function claudeProtocolAssistantEvents(record: Record<string, unknown>): RunEvent[] {
  const content = claudeMessageContent(record);
  if (!content) return [];
  const turnId = claudeMessageId(record);
  const events: RunEvent[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    const item = block as Record<string, unknown>;
    if (item.type === 'thinking' && typeof item.thinking === 'string' && item.thinking.trim()) {
      events.push({ type: 'thinking', text: item.thinking, ...(turnId ? { turnId } : {}) });
      continue;
    }
    // Some builds nest thinking under `text` with type thinking.
    if (item.type === 'thinking' && typeof item.text === 'string' && item.text.trim()) {
      events.push({ type: 'thinking', text: item.text, ...(turnId ? { turnId } : {}) });
      continue;
    }
    // Redacted thinking still surfaces as a collapsed placeholder (MINOR 7) — never drop it.
    if (item.type === 'redacted_thinking' || item.type === 'redacted-thinking') {
      events.push({ type: 'thinking', text: 'Thinking · redacted', ...(turnId ? { turnId } : {}) });
      continue;
    }
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      events.push({ type: 'assistant-delta', text: item.text, ...(turnId ? { turnId } : {}) });
      continue;
    }
    if (item.type === 'tool_use') {
      const labeled = claudeProtocolToolLabel(item);
      const oneLine = labeled.summary && labeled.summary !== labeled.name
        ? `${labeled.name} · ${labeled.summary}`
        : labeled.name;
      events.push({
        type: 'tool',
        text: oneLine,
        name: labeled.name,
        summary: labeled.summary,
        detail: labeled.detail,
        ...(labeled.toolUseId ? { toolUseId: labeled.toolUseId } : {}),
        ...(turnId ? { turnId } : {}),
      });
    }
  }
  return events;
}

/** tool_result blocks on a Claude-protocol `user` envelope (ok/error + full body). */
export function claudeProtocolToolResultEvents(record: Record<string, unknown>): RunEvent[] {
  const content = claudeMessageContent(record);
  if (!content) return [];
  const events: RunEvent[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    const item = block as Record<string, unknown>;
    if (item.type !== 'tool_result') continue;
    const toolUseId = typeof item.tool_use_id === 'string' ? item.tool_use_id
      : typeof item.toolUseId === 'string' ? item.toolUseId
        : undefined;
    const ok = item.is_error !== true && item.isError !== true;
    const body = capPersisted(toolResultBody(item.content), TOOL_RESULT_MAX);
    // Collapsed summary line only — expanded card uses `body` with newlines (LOOK D1).
    const preview = clipOneLine(body, 120);
    events.push({
      type: 'tool-result',
      ok,
      preview,
      body,
      ...(toolUseId ? { toolUseId } : {}),
    });
  }
  return events;
}

function packEvents(events: RunEvent[]): RunEvent | RunEvent[] | undefined {
  if (!events.length) return undefined;
  return events.length === 1 ? events[0] : events;
}

export function speaksClaudeProtocol(laneId: LaneId): boolean {
  return laneId === 'claude' || laneId === 'deepseek-ollama-cc' || laneId === 'glm-ollama-cc';
}

function titleCaseToolBase(base: string): string {
  if (!base) return 'tool';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Cursor stream-json nests tools under `tool_call.readToolCall` / `writeToolCall` / … */
export function cursorToolCallName(toolCall: unknown): string | undefined {
  if (typeof toolCall !== 'object' || toolCall === null || Array.isArray(toolCall)) return undefined;
  const record = toolCall as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith('ToolCall')) {
      return titleCaseToolBase(key.slice(0, -'ToolCall'.length));
    }
    if (key === 'function' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const name = textAt(value, ['name']);
      if (name) return name;
    }
  }
  return undefined;
}

function normalizeCodexLine(record: Record<string, unknown>, type: string): RunEvent | RunEvent[] | undefined {
  if (type === 'thread.started' || type === 'turn.started') {
    return { type: 'status', text: type.replace(/\./g, ' ') };
  }
  if (type === 'turn.completed' || type === 'turn.failed') {
    if (type === 'turn.failed') {
      const error =
        textAt(record, ['message', 'text']) ??
        (typeof record.error === 'object' && record.error !== null
          ? textAt(record.error as Record<string, unknown>, ['message', 'text'])
          : undefined) ??
        'The selected lane reported an error.';
      return { type: 'error', text: error };
    }
    return { type: 'status', text: 'turn completed' };
  }
  if (type !== 'item.started' && type !== 'item.completed' && type !== 'item.updated') {
    return undefined;
  }
  const item = record.item;
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
  const itemRecord = item as Record<string, unknown>;
  const itemType = String(itemRecord.type ?? itemRecord.item_type ?? '');

  if (itemType === 'agent_message' || itemType === 'assistant_message') {
    if (type !== 'item.completed') return undefined;
    const text = textAt(itemRecord, ['text']);
    return text ? { type: 'assistant-delta', text } : undefined;
  }
  if (itemType === 'command_execution') {
    // Emit once when the command starts; completed carries aggregated_output (never prose).
    if (type !== 'item.started') return undefined;
    const command = textAt(itemRecord, ['command']);
    return command ? { type: 'tool', text: command } : { type: 'tool', text: 'command' };
  }
  if (itemType === 'file_change') {
    if (type !== 'item.completed') return undefined;
    const changes = Array.isArray(itemRecord.changes) ? itemRecord.changes : [];
    const paths = changes
      .map((change) => {
        if (typeof change !== 'object' || change === null) return undefined;
        return textAt(change as Record<string, unknown>, ['path']);
      })
      .filter((path): path is string => Boolean(path));
    return { type: 'tool', text: paths.length ? `file_change ${paths.join(', ')}` : 'file_change' };
  }
  if (itemType === 'mcp_tool_call') {
    if (type === 'item.updated') return undefined;
    const tool = textAt(itemRecord, ['tool', 'name']) ?? 'mcp';
    const server = textAt(itemRecord, ['server']);
    return { type: 'tool', text: server ? `${server}/${tool}` : tool };
  }
  if (itemType === 'reasoning' || itemType === 'todo_list' || itemType === 'web_search') {
    return { type: 'status', text: itemType.replace(/_/g, ' ') };
  }
  if (itemType === 'error') {
    const error = textAt(itemRecord, ['message', 'text', 'error']) ?? 'The selected lane reported an error.';
    return { type: 'error', text: error };
  }
  return undefined;
}

function normalizeCursorLine(record: Record<string, unknown>, type: string): RunEvent | RunEvent[] | undefined {
  if (type === 'result' || type === 'run_result' || type === 'system' || type === 'user') {
    return undefined;
  }
  if (type === 'tool_call') {
    // Only announce on started — completed carries file bodies under result.success.content.
    if (record.subtype === 'completed') return undefined;
    const name = cursorToolCallName(record.tool_call) ?? textAt(record, ['name', 'tool', 'command']);
    return name ? { type: 'tool', text: name } : undefined;
  }
  if (type === 'assistant') {
    // --stream-partial-output: only timestamped deltas without model_call_id are new text.
    // model_call_id flushes and untimestamped finals duplicate prior prose (Cursor docs).
    if (record.timestamp_ms === undefined || record.model_call_id !== undefined) return undefined;
    const events: RunEvent[] = [];
    for (const event of claudeProtocolAssistantEvents(record)) {
      // Cursor path keeps tools as compact names; thinking stays out of the bubble.
      if (event.type === 'thinking') continue;
      if (event.type === 'tool') {
        events.push({ type: 'tool', text: event.name ?? event.text });
        continue;
      }
      if (event.type === 'assistant-delta') {
        events.push({ type: 'assistant-delta', text: event.text });
      }
    }
    return packEvents(events);
  }
  if (/error|failed/i.test(type)) {
    const error = textAt(record, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
    return { type: 'error', text: error };
  }
  if (/started|thinking|progress|status/i.test(type)) {
    return { type: 'status', text: type.replace(/[._-]+/g, ' ') };
  }
  return undefined;
}

function kimiAssistantContent(record: Record<string, unknown>): string | undefined {
  const content = record.content;
  if (typeof content === 'string') return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string' && block.trim()) {
      parts.push(block);
      continue;
    }
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    const item = block as Record<string, unknown>;
    if (item.type === 'tool_use' || item.type === 'tool_result') continue;
    if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text);
  }
  return parts.length ? parts.join('') : undefined;
}

function kimiToolNames(record: Record<string, unknown>): string[] {
  const top = textAt(record, ['name', 'tool']);
  if (top && /tool/i.test(String(record.type ?? ''))) return [top];
  const calls = record.tool_calls;
  if (!Array.isArray(calls)) return [];
  const names: string[] = [];
  for (const call of calls) {
    if (typeof call !== 'object' || call === null || Array.isArray(call)) continue;
    const item = call as Record<string, unknown>;
    const direct = textAt(item, ['name', 'tool']);
    if (direct) {
      names.push(direct);
      continue;
    }
    const fn = item.function;
    if (typeof fn === 'object' && fn !== null && !Array.isArray(fn)) {
      const name = textAt(fn as Record<string, unknown>, ['name']);
      if (name) names.push(name);
    }
  }
  return names;
}

function normalizeKimiLine(record: Record<string, unknown>, type: string): RunEvent | RunEvent[] | undefined {
  const role = String(record.role ?? '');
  if (role === 'tool' || type === 'tool' || type === 'tool_result') {
    // Tool results often carry file bodies in `content` — never treat as prose.
    return undefined;
  }
  if (role === 'meta' || role === 'system') return undefined;
  if (/tool|command|action/i.test(type) && role !== 'assistant') {
    const tool = textAt(record, ['name', 'tool', 'command', 'text']);
    return tool ? { type: 'tool', text: tool } : undefined;
  }
  if (role === 'assistant' || type === 'assistant' || (!type && role === 'assistant')) {
    const events: RunEvent[] = [];
    for (const name of kimiToolNames(record)) {
      events.push({ type: 'tool', text: name });
    }
    const text = kimiAssistantContent(record);
    if (text) events.push({ type: 'assistant-delta', text });
    return packEvents(events);
  }
  if (/error|failed/i.test(type)) {
    const error = textAt(record, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
    return { type: 'error', text: error };
  }
  return undefined;
}

function normalizeClineLine(record: Record<string, unknown>, type: string): RunEvent | RunEvent[] | undefined {
  if (type === 'run_result') return undefined;
  if (type === 'agent_event' && typeof record.event === 'object' && record.event !== null) {
    const event = record.event as Record<string, unknown>;
    const eventType = String(event.type ?? '');
    if (eventType === 'content_end') return undefined;
    if (eventType === 'content_start') {
      const contentType = String(event.contentType ?? '');
      if (contentType === 'text') {
        const text = textAt(event, ['text']);
        return text ? { type: 'assistant-delta', text } : undefined;
      }
      if (contentType === 'tool' || contentType === 'tool_use' || contentType === 'tool_call') {
        const tool = textAt(event, ['toolName', 'name', 'tool', 'command']) ?? 'tool';
        return { type: 'tool', text: tool };
      }
      // Unknown content types (thinking, etc.) stay out of the chat bubble.
      return { type: 'status', text: contentType || eventType };
    }
    if (/tool/i.test(eventType)) {
      const tool = textAt(event, ['toolName', 'name', 'tool', 'command']);
      return tool ? { type: 'tool', text: tool } : undefined;
    }
    if (/error|failed/i.test(eventType)) {
      const error = textAt(event, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
      return { type: 'error', text: error };
    }
    return undefined;
  }
  if (/error|failed/i.test(type)) {
    const error = textAt(record, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
    return { type: 'error', text: error };
  }
  return undefined;
}

export function normalizeCliLine(laneId: LaneId, line: string): RunEvent | RunEvent[] | undefined {
  const safeLine = redact(line.trim());
  if (!safeLine) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(safeLine);
  } catch {
    // Grok CLI --output-format plain (and similar) emit prose lines, not JSON.
    return { type: 'assistant-delta', text: `${safeLine}\n` };
  }

  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const type = String(record.type ?? record.event ?? record.role ?? '');

  // Claude's terminal `result` repeats the accumulated assistant response that
  // has already arrived as assistant stream events. Suppress that known final
  // envelope's prose. Its usage is SESSION SPEND (cumulative), not occupancy —
  // emit session-spend only; never overwrite the meter with it (M3e).
  // Also emit turn-boundary so the steering channel can flush a held follow-up
  // onto the same live stdin (M5 hold-until-turn fallback).
  if (speaksClaudeProtocol(laneId) && (type === 'result' || type === 'run_result')) {
    const events: RunEvent[] = [{ type: 'turn-boundary' }];
    const usage = parseClaudeStreamUsage(safeLine);
    if (usage?.source === 'result') {
      events.push({ type: 'session-spend', tokens: usage.usedTokens });
    }
    return events;
  }

  // Claude-protocol lanes: walk message.content[] explicitly. Never use the
  // generic nestedText key-name crawl — it leaks Write/Edit tool payloads.
  if (speaksClaudeProtocol(laneId)) {
    if (type === 'assistant') {
      const events = claudeProtocolAssistantEvents(record);
      const usage = parseClaudeStreamUsage(safeLine);
      if (usage?.source === 'assistant') {
        events.push({ type: 'context-usage', usedTokens: usage.usedTokens });
      }
      return packEvents(events);
    }
    if (type === 'user') {
      return packEvents(claudeProtocolToolResultEvents(record));
    }
    // M3 "woke on:" — system/task_notification with status completed (FIX 6 / R2-4).
    // Require a task-notification subtype; a bare status:completed must not claim the wake branch.
    if (type === 'system') {
      const subtype = String(record.subtype ?? record.kind ?? '');
      if (/task_notification|task-notification|task_complete/i.test(subtype)) {
        const summary = textAt(record, ['summary', 'description', 'text', 'message'])
          ?? (typeof record.task_id === 'string' ? record.task_id : undefined)
          ?? 'background task';
        const status = String(record.status ?? '');
        if (!status || /completed|finished|success/i.test(status)) {
          return { type: 'status', text: `woke on: ${summary}` };
        }
      }
    }
    // M3 per-call clock — tool_progress carries authoritative elapsed_time_seconds (FIX 8).
    if (type === 'tool_progress' || type === 'tool-progress' || /tool_progress/i.test(type)) {
      const elapsed = Number(
        record.elapsed_time_seconds
          ?? record.elapsedTimeSeconds
          ?? record.elapsed_seconds
          ?? record.elapsed,
      );
      const tool = textAt(record, ['tool_name', 'name', 'tool']) ?? 'tool';
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        return {
          type: 'status',
          // Plain words for the activity-strip fallback (R2-3); webview also parses this form.
          text: `${tool} · ${Math.floor(elapsed)}s`,
        };
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
    return undefined;
  }

  if (laneId === 'codex') return normalizeCodexLine(record, type);
  // Grok-via-Cursor and Claude-via-Cursor set protocolLaneId to `cursor` at spawn time.
  if (laneId === 'cursor') return normalizeCursorLine(record, type);
  if (laneId === 'kimi') return normalizeKimiLine(record, type);
  if (laneId === 'cline') return normalizeClineLine(record, type);

  // Grok native CLI uses plain text (handled above). Any unexpected JSON stays quiet.
  if (laneId === 'grok') {
    if (/error|failed/i.test(type)) {
      const error = textAt(record, ['error', 'message', 'text']) ?? 'The selected lane reported an error.';
      return { type: 'error', text: error };
    }
    return undefined;
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

  const steering: SteeringMode = invocation.steering ?? 'none';
  const keepStdinOpen = Boolean(invocation.keepStdinOpen && child.stdin);
  /** Fallback queue only when an immediate write fails. */
  const heldFollowUps: string[] = [];
  let turnBusy = true;
  let stdinClosed = false;
  /** True after a successful mid-run write until the seat emits assistant/result output. */
  let awaitingFollowUpAck = false;

  const writeStdinLine = (line: string): boolean => {
    if (stdinClosed || !child.stdin || child.stdin.destroyed) return false;
    try {
      child.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
      return true;
    } catch {
      return false;
    }
  };

  const writeFollowUpNow = (text: string): boolean => {
    if (!writeStdinLine(streamJsonUserLine(text))) return false;
    turnBusy = true;
    awaitingFollowUpAck = true;
    // Defer so extension can register the message id before the chip flip (FIX 4).
    queueMicrotask(() => onEvent({ type: 'status', text: 'follow-up sent to seat' }));
    return true;
  };

  const flushHeldFollowUps = () => {
    if (!keepStdinOpen) return;
    while (heldFollowUps.length) {
      const next = heldFollowUps.shift();
      if (!next) break;
      if (!writeFollowUpNow(next)) {
        heldFollowUps.unshift(next);
        break;
      }
      return; // one follow-up per flush
    }
    // R2-6: keep stdin open across rounds so the next follow-up reuses this process
    // instead of paying a fresh spawn. Stop / dispose still closes the channel.

  };

  if (invocation.stdin !== undefined) {
    if (keepStdinOpen) {
      writeStdinLine(invocation.stdin);
    } else {
      child.stdin.end(invocation.stdin);
      stdinClosed = true;
    }
  } else if (!keepStdinOpen) {
    child.stdin.end();
    stdinClosed = true;
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
    const normalized = normalizeCliLine(protocolLaneId, line);
    if (!normalized) return;
    for (const event of Array.isArray(normalized) ? normalized : [normalized]) {
      if (event.type === 'turn-boundary') {
        turnBusy = false;
        if (awaitingFollowUpAck) {
          awaitingFollowUpAck = false;
          onEvent({ type: 'status', text: 'follow-up delivered' });
        }
        flushHeldFollowUps();
      } else if (event.type === 'assistant-delta' || event.type === 'tool' || event.type === 'thinking') {
        turnBusy = true;
        if (awaitingFollowUpAck && event.type === 'assistant-delta') {
          awaitingFollowUpAck = false;
          onEvent({ type: 'status', text: 'follow-up delivered' });
        }
      }
      onEvent(event);
    }
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
      stdinClosed = true;
      try {
        child.stdin.destroy();
      } catch {
        // already closed
      }
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
      stdinClosed = true;
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      stopProcessTree(child);
    },
    completed,
    ...(steering !== 'none' ? { steering } : {}),
    ...(keepStdinOpen
      ? {
          enqueueFollowUp(text: string): boolean {
            const trimmed = text.trim();
            // stdin closed (turn-boundary closed it; activeRuns not deleted yet) → caller
            // must fall through to pendingFollowUps so the message is never lost (FIX 2).
            if (!trimmed || stdinClosed) return false;
            // Primary path (real-door probe): write immediately; harness enqueues mid-turn.
            if (writeFollowUpNow(trimmed)) return true;
            // Soft write failure while the process is still live — retry at next boundary.
            // Do NOT also return false (that would double-queue into pendingFollowUps).
            heldFollowUps.push(trimmed);
            return true;
          },
        }
      : {}),
  };
}
