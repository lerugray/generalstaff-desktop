import { consentRoomName, type ConsentRoomTarget } from './consentRoom.js';
import type {
  CommandTarget,
  ConversationReceipt,
  CraftReceipt,
  CraftReceiptTone,
  PermissionMode,
  RunContinuity,
} from './domain.js';

export const maxCraftCards = 24;

export interface ToolReceiptInput {
  kind: 'tool' | 'status' | 'error';
  text: string;
  place?: string;
  roomName?: string;
  workingDirectory?: string;
}

export interface RunReceiptInput {
  exitCode: number | null;
  stopped: boolean;
  permission: PermissionMode;
  workingDirectory?: string;
  roomName?: string;
  laneName?: string;
  continuity?: RunContinuity;
  skillId?: string;
}

const toolActions: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(read_?file|read_?path|read|open_file)$/iu, 'Read a file'],
  [/^(write_?file|write|create_file)$/iu, 'Wrote a file'],
  [/^(edit_?file|edit|str_?replace|apply_?patch|multi_?edit|notebook_?edit)$/iu, 'Changed a file'],
  [/^(delete_?file|delete|unlink)$/iu, 'Removed a file'],
  [/^(grep|rg|search_files|file_search|codebase_search|semsearch|search)$/iu, 'Searched the files'],
  [/^(glob_file_search|glob|find_files)$/iu, 'Looked for files'],
  [/^(list_?dir|listdir|ls)$/iu, 'Listed a folder'],
  [/^(bash|shell|run_command|command_execution|terminal)$/iu, 'Ran a command'],
  [/^(web_?search|search_web)$/iu, 'Looked something up'],
  [/^(web_?fetch|fetch|open_page)$/iu, 'Opened a page'],
  [/^(todo_?write|todo_?read|todo)$/iu, 'Updated the work list'],
  [/^(task|agent|delegate)$/iu, 'Asked another seat'],
];

export function roomNameForTarget(target: CommandTarget, projectName?: string): string {
  const room: ConsentRoomTarget = target.kind === 'general'
    ? { kind: 'general' }
    : { kind: 'project', ...(projectName ? { name: projectName } : {}) };
  return consentRoomName(room);
}

export function shortPlace(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/u, '').trim();
  if (!normalized) return undefined;
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return undefined;
  const last = parts[parts.length - 1] ?? normalized;
  if (last.includes('.') && parts.length >= 2) return parts.slice(-2).join('/');
  return last;
}

export function receiptWhere(options: {
  place?: string;
  roomName?: string;
  workingDirectory?: string;
}): string {
  const file = shortPlace(options.place);
  const room = options.roomName?.trim();
  if (file && room) return `${file} in ${room}`;
  if (file) return file;
  if (room) return `in ${room}`;
  const folder = shortPlace(options.workingDirectory);
  if (folder) return folder;
  return 'place not recorded';
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/u)[0] ?? '';
}

function looksLikeStack(text: string): boolean {
  return /(?:^|\n)\s*at\s+\S+\s+\(|\sat\s+\S+\s+\(|traceback \(most recent call last\)|errno\b/iu.test(text);
}

export function humanError(text: string): string {
  if (!text.trim()) return 'This pass hit a problem.';
  if (looksLikeStack(text)) return 'This pass hit a problem.';
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (cleaned.length > 160 && /\{|\}|error:/iu.test(cleaned)) {
    return 'This pass hit a problem.';
  }
  const sentence = cleaned.split(/(?<=[.!?])\s/u)[0] ?? cleaned;
  return sentence.slice(0, 140);
}

function humanizeToolName(name: string): string {
  const spaced = name
    .replace(/[/\\]/gu, ' ')
    .replace(/[_-]+/gu, ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  if (!spaced) return 'Did a workshop step';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function canonicalToken(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/gu, '$1_$2')
    .replace(/-/gu, '_')
    .toLowerCase();
}

export function toolAction(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'Did a workshop step';
  const starting = trimmed.match(/^starting\s+(.+)$/iu);
  if (starting?.[1]) return `Taking the ${starting[1].trim()} seat`;
  const token = firstToken(trimmed).replace(/[()[\],]+$/u, '');
  const canonical = canonicalToken(token);
  for (const [pattern, label] of toolActions) {
    if (pattern.test(token) || pattern.test(canonical) || pattern.test(trimmed)) return label;
  }
  if (/\s/u.test(trimmed) || /[\\/]/u.test(token)) {
    const bin = token.split(/[\\/]/u).pop() || token;
    return `Ran ${bin}`;
  }
  if (/^[a-z][a-z0-9_-]{0,24}$/iu.test(token)) {
    return `Ran ${token}`;
  }
  return humanizeToolName(token);
}

export function keepStatusCard(text: string): boolean {
  return /^starting\b/iu.test(text.trim());
}

function card(
  title: string,
  what: string,
  where: string,
  status: string,
  tone: CraftReceiptTone,
): CraftReceipt {
  return { title, what, where, status, tone };
}

export function toolReceiptFromEvent(input: ToolReceiptInput): CraftReceipt {
  const place = input.place || placeFromText(input.text);
  const where = receiptWhere({
    ...(place ? { place } : {}),
    ...(input.roomName ? { roomName: input.roomName } : {}),
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
  });
  if (input.kind === 'error') {
    const what = humanError(input.text);
    return card('This step failed', what, where, 'Did not finish', 'failed');
  }
  const action = toolAction(input.text);
  if (input.kind === 'status') {
    return card(action, `${action}.`, where, 'In progress', 'working');
  }
  return card(action, `${action}.`, where, 'In progress', 'working');
}

export function placeFromText(text: string): string | undefined {
  const match = text.match(
    /(?:^|[\s="'`])((?:~|\.{1,2}\/|\/|[A-Za-z]:[\\/])[\w.@+/-]+(?:\.[\w]{1,8})?|[\w.-]+\/[\w./@+-]+)/u,
  );
  const candidate = match?.[1];
  if (!candidate || candidate.length > 240) return undefined;
  if (!/[\\/]|\.[\w]{1,8}$/u.test(candidate)) return undefined;
  return candidate;
}

export function runReceiptFromResult(input: RunReceiptInput): CraftReceipt {
  const room = input.roomName?.trim();
  const where = receiptWhere({
    ...(room ? { roomName: room } : {}),
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
  });
  const place = room || shortPlace(input.workingDirectory) || 'this room';
  if (input.stopped) {
    return card(
      'Work stopped',
      `This pass was stopped in ${place}.`,
      where,
      'Stopped',
      'stopped',
    );
  }
  if (input.exitCode !== 0) {
    return card(
      'Work did not finish',
      `This pass could not finish in ${place}.`,
      where,
      'Did not finish',
      'failed',
    );
  }
  const what = input.permission === 'write'
    ? `Changed files in ${place}.`
    : `Looked through ${place}.`;
  return card('Work finished', what, where, 'Finished', 'done');
}

export function continuityLabel(continuity: RunContinuity | undefined): string {
  if (continuity === 'native') return 'Continued the same session';
  if (continuity === 'transcript') return 'Continued from the written record';
  return 'Started a new session';
}

export function rememberCard(cards: CraftReceipt[], next: CraftReceipt | undefined): CraftReceipt[] {
  if (!next) return cards;
  const last = cards.at(-1);
  if (
    last &&
    last.title === next.title &&
    last.what === next.what &&
    last.where === next.where &&
    last.status === next.status &&
    last.tone === next.tone
  ) {
    return cards;
  }
  return [...cards, next].slice(-maxCraftCards);
}

export function sealCards(cards: CraftReceipt[]): CraftReceipt[] {
  return cards.map((card) => (
    card.tone === 'working' ? { ...card, status: 'Recorded', tone: 'done' } : card
  ));
}

export function receiptFromConversation(receipt: ConversationReceipt, roomName?: string): CraftReceipt {
  return receipt.summary ?? runReceiptFromResult({
    exitCode: receipt.exitCode,
    stopped: receipt.stopped,
    permission: receipt.permission,
    workingDirectory: receipt.workingDirectory,
    ...(roomName ? { roomName } : {}),
    laneName: receipt.laneName,
    continuity: receipt.continuity,
    ...(receipt.skillId ? { skillId: receipt.skillId } : {}),
  });
}
