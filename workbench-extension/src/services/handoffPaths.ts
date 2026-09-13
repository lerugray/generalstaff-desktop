import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Standing staging surface for out-of-repo handoffs (`~/Desktop/handoff`).
 *
 * Claude Code's Read/Glob tools do NOT expand a literal `~/…` path argument
 * (anthropics/claude-code#7605, #11521). Prefer absolute paths — via the
 * context attach picker, or `--add-dir` on lanes that accept it — instead of
 * relying on the model to expand tildes.
 */
export function desktopHandoffDirectory(home = os.homedir()): string | undefined {
  const candidate = path.join(home, 'Desktop', 'handoff');
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    // Missing handoff folder is fine — callers omit --add-dir / extra roots.
  }
  return undefined;
}

/** Swept packets land here after a successful ruling (`~/Documents/session-artifacts`). */
export function sessionArtifactsDirectory(home = os.homedir()): string {
  return path.join(home, 'Documents', 'session-artifacts');
}

/** `--add-dir <absolute Desktop/handoff>` when the folder exists; empty otherwise. */
export function extraAddDirArgs(home = os.homedir()): string[] {
  const handoff = desktopHandoffDirectory(home);
  return handoff ? ['--add-dir', handoff] : [];
}

/** @deprecated Prefer extraAddDirArgs — kept for Claude-protocol call sites and tests. */
export function claudeExtraDirectoryArgs(home = os.homedir()): string[] {
  return extraAddDirArgs(home);
}
