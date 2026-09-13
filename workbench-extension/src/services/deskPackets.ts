import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { desktopHandoffDirectory, sessionArtifactsDirectory } from './handoffPaths.js';
import { sanitiseHandoffHtml } from './htmlSanitiser.js';

export { sessionArtifactsDirectory };

const ROOT_IGNORES = new Set(['START-HERE.html', 'README.txt']);
const DATE_TAIL = /^(\d{4}-\d{2}-\d{2})$/;

export interface DeskPacketFile {
  name: string;
  size: number;
  type: string;
}

export interface DeskPacket {
  folderName: string;
  path: string;
  mtimeMs: number;
  game: string;
  gate: string;
  date: string;
  cardHtml?: string;
  cardMissing: boolean;
  annotatePath?: string;
  files: DeskPacketFile[];
  readyGatePassed: boolean;
  replayGatePassed: boolean;
}

export interface ScanDeskPacketsOptions {
  home?: string;
  handoffRoot?: string;
}

function fileType(name: string): string {
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  if (!ext) return 'file';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md') return 'markdown';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'image';
  if (ext === 'wav' || ext === 'mp3' || ext === 'aiff') return 'audio';
  if (ext === 'txt') return 'text';
  return ext;
}

/**
 * Parse `<GAME>-<GATE>-<date>` where date is YYYY-MM-DD at the end.
 * Gate is the segment immediately before the date; game is everything before that.
 */
export function parsePacketFolderName(folderName: string): { game: string; gate: string; date: string } {
  const parts = folderName.split('-').filter(Boolean);
  if (parts.length >= 4) {
    const date = `${parts[parts.length - 3]}-${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
    if (DATE_TAIL.test(date)) {
      const gate = parts[parts.length - 4] ?? '—';
      const gameParts = parts.slice(0, parts.length - 4);
      return {
        game: gameParts.length ? gameParts.join('-') : gate,
        gate,
        date,
      };
    }
  }
  if (parts.length >= 2) {
    return {
      game: parts.slice(0, -2).join('-') || parts[0]!,
      gate: parts[parts.length - 2]!,
      date: parts[parts.length - 1]!,
    };
  }
  return { game: folderName, gate: '—', date: '—' };
}

export async function scanDeskPackets(options: ScanDeskPacketsOptions = {}): Promise<DeskPacket[]> {
  const handoff = options.handoffRoot
    ?? desktopHandoffDirectory(options.home ?? os.homedir());
  if (!handoff) return [];

  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(handoff, { withFileTypes: true });
  } catch {
    return [];
  }

  const packets: DeskPacket[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (ROOT_IGNORES.has(entry.name)) continue;

    const folderPath = path.join(handoff, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await fsPromises.stat(folderPath)).mtimeMs;
    } catch {
      continue;
    }

    const { game, gate, date } = parsePacketFolderName(entry.name);
    const files: DeskPacketFile[] = [];
    let cardHtml: string | undefined;
    let cardMissing = true;
    let annotatePath: string | undefined;
    let readyGatePassed = false;
    let replayGatePassed = false;

    let children: fs.Dirent[];
    try {
      children = await fsPromises.readdir(folderPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const child of children) {
      if (child.name.startsWith('.')) {
        if (child.name === '.ready-gate-passed') readyGatePassed = true;
        if (child.name === '.replay-gate-passed') replayGatePassed = true;
        continue;
      }
      if (!child.isFile()) continue;
      const childPath = path.join(folderPath, child.name);
      let size = 0;
      try {
        size = (await fsPromises.stat(childPath)).size;
      } catch {
        continue;
      }
      files.push({ name: child.name, size, type: fileType(child.name) });

      if (/^what-to-judge\.html$/i.test(child.name)) {
        try {
          const raw = await fsPromises.readFile(childPath, 'utf8');
          cardHtml = sanitiseHandoffHtml(raw);
          cardMissing = false;
        } catch {
          cardMissing = true;
        }
      }
      if (/^annotate\.html$/i.test(child.name)) {
        annotatePath = childPath;
      }
    }

    // Prefer HTML card; if only markdown exists, mark missing (never render md as the card).
    if (cardMissing && files.some((file) => /^what-to-judge\.md$/i.test(file.name))) {
      cardMissing = true;
    }

    files.sort((a, b) => a.name.localeCompare(b.name));
    packets.push({
      folderName: entry.name,
      path: folderPath,
      mtimeMs,
      game,
      gate,
      date,
      ...(cardHtml !== undefined ? { cardHtml } : {}),
      cardMissing,
      ...(annotatePath ? { annotatePath } : {}),
      files,
      readyGatePassed,
      replayGatePassed,
    });
  }

  packets.sort((a, b) => b.mtimeMs - a.mtimeMs || a.folderName.localeCompare(b.folderName));
  return packets;
}
