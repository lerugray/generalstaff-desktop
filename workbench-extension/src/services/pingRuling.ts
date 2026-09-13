import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildRulingBody, readAnnotateNotes } from './annotateNotes.js';
import { sessionArtifactsDirectory } from './handoffPaths.js';
import { processInvocation } from './processInvocation.js';

export interface RulingInput {
  rootPath: string;
  packetPath: string;
  folderName: string;
  game: string;
  gate: string;
  session: string;
  verdict: string;
  /** Optional extra tags appended after game,ray,ruling */
  tags?: string;
  /**
   * When true, append ANNOTATE notes (NOTES.txt / JSON export / ANNOTATE.html)
   * to the ping body after "<PACKET-NAME>: <verdict>".
   */
  attachAnnotateNotes?: boolean;
  /** Pre-read notes (tests); otherwise read from the packet when attaching. */
  annotateNotes?: string;
  home?: string;
}

export interface PingInvocation {
  executable: string;
  args: string[];
  cwd: string;
}

export interface RulingResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  argv: string[];
  sweptTo?: string;
  errorDetail?: string;
}

export type PingRunner = (invocation: PingInvocation) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type PacketMover = (from: string, to: string) => Promise<void>;

/** Newest `docs/sessions/*session*.md` → sNNN from the filename, if any. */
export async function resolveDefaultSessionId(rootPath: string): Promise<string | undefined> {
  if (!rootPath) return undefined;
  const sessionsDir = path.join(rootPath, 'docs', 'sessions');
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return undefined;
  }
  const sessionFiles = entries
    .filter((name) => /session/i.test(name) && name.endsWith('.md'))
    .map((name) => ({ name, full: path.join(sessionsDir, name) }));
  if (!sessionFiles.length) return undefined;

  const withMtime = await Promise.all(
    sessionFiles.map(async (entry) => {
      try {
        const stat = await fs.stat(entry.full);
        return { ...entry, mtimeMs: stat.mtimeMs };
      } catch {
        return { ...entry, mtimeMs: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const newest = withMtime[0]?.name ?? '';
  const match = newest.match(/\b(s\d{2,4})\b/i);
  return match?.[1]?.toLowerCase();
}

export function buildPingArgv(input: {
  pingScript: string;
  session: string;
  game: string;
  gate: string;
  folderName: string;
  verdict: string;
  annotateNotes?: string;
  tags?: string;
}): string[] {
  const gameTag = input.game.trim().toLowerCase().replace(/\s+/g, '-') || 'packet';
  const extras = (input.tags ?? '')
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => !['ray', 'ruling', gameTag].includes(tag.toLowerCase()));
  const tagList = [gameTag, 'ray', 'ruling', ...extras].join(',');
  const title = `${input.game}-${input.gate} — RULED (Ray)`;
  const body = buildRulingBody(input.folderName, input.verdict, input.annotateNotes);
  return [input.pingScript, '-s', input.session, '-t', tagList, title, body];
}

export function pingScriptPath(rootPath: string): string {
  return path.join(rootPath, 'scripts', 'ping.sh');
}

export async function uniqueSweepTarget(
  folderName: string,
  home = os.homedir(),
): Promise<string> {
  const base = sessionArtifactsDirectory(home);
  await fs.mkdir(base, { recursive: true });
  let candidate = path.join(base, folderName);
  if (!(await pathExists(candidate))) return candidate;
  let n = 2;
  while (await pathExists(path.join(base, `${folderName}-${n}`))) n += 1;
  return path.join(base, `${folderName}-${n}`);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

const defaultPingRunner: PingRunner = (invocation) =>
  new Promise((resolve) => {
    // argv[0] is the script path; run via bash so +x is not required.
    const script = invocation.args[0] ?? invocation.executable;
    const scriptArgs = invocation.args.slice(1);
    let processSpec: ReturnType<typeof processInvocation>;
    try {
      processSpec = processInvocation('bash', [script, ...scriptArgs]);
    } catch (error) {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'ping invocation failed',
      });
      return;
    }
    execFile(
      processSpec.executable,
      processSpec.args,
      {
        cwd: invocation.cwd,
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...processSpec.env },
        maxBuffer: 512 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
          ? Number((error as { code: number }).code)
          : error
            ? 1
            : 0;
        resolve({
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });

const defaultMover: PacketMover = async (from, to) => {
  await fs.rename(from, to);
};

/**
 * Closed write set: call gs-private `scripts/ping.sh` with the documented argv,
 * then move the packet to ~/Documents/session-artifacts/ ONLY on exit 0.
 * Never writes the pings file directly.
 */
export async function recordRuling(
  input: RulingInput,
  deps: { runPing?: PingRunner; movePacket?: PacketMover } = {},
): Promise<RulingResult> {
  const verdict = input.verdict.trim();
  const session = input.session.trim();
  if (!verdict) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      argv: [],
      errorDetail: 'Verdict is required.',
    };
  }
  if (!session) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      argv: [],
      errorDetail: 'Session id is required.',
    };
  }
  if (!input.rootPath) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      argv: [],
      errorDetail: 'GeneralStaff root is not configured.',
    };
  }

  let annotateNotes: string | undefined;
  if (input.attachAnnotateNotes) {
    if (typeof input.annotateNotes === 'string' && input.annotateNotes.trim()) {
      annotateNotes = input.annotateNotes.trim();
    } else {
      annotateNotes = await readAnnotateNotes(input.packetPath);
    }
  }

  const script = pingScriptPath(input.rootPath);
  const argv = buildPingArgv({
    pingScript: script,
    session,
    game: input.game,
    gate: input.gate,
    folderName: input.folderName,
    verdict,
    ...(annotateNotes ? { annotateNotes } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  });

  const runPing = deps.runPing ?? defaultPingRunner;
  const movePacket = deps.movePacket ?? defaultMover;

  const result = await runPing({
    executable: script,
    args: argv,
    cwd: input.rootPath,
  });

  if (result.exitCode !== 0) {
    return {
      ok: false,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      argv,
      errorDetail: result.stderr.trim() || result.stdout.trim() || `ping.sh exited ${result.exitCode}`,
    };
  }

  const home = input.home ?? os.homedir();
  const sweptTo = await uniqueSweepTarget(input.folderName, home);
  try {
    await movePacket(input.packetPath, sweptTo);
  } catch (error) {
    return {
      ok: false,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      argv,
      errorDetail: error instanceof Error
        ? `Ping wrote, but sweep failed: ${error.message}`
        : 'Ping wrote, but sweep failed.',
    };
  }

  return {
    ok: true,
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
    argv,
    sweptTo,
  };
}
