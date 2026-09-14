import type { DeskPacket } from './services/deskPackets.js';

export interface DeskLeafFile {
  name: string;
  sizeLabel: string;
  type: string;
}

export interface DeskLeaf {
  key: string;
  folderName: string;
  path: string;
  game: string;
  gate: string;
  date: string;
  mtimeLabel: string;
  cardHtml?: string;
  cardMissing: boolean;
  hasAnnotate: boolean;
  annotatePath?: string;
  /** True when NOTES.txt / JSON export / ANNOTATE.html scrape found notes. */
  hasAnnotateNotes: boolean;
  files: DeskLeafFile[];
  readyGatePassed: boolean;
  replayGatePassed: boolean;
  waiting: true;
}

export interface DeskPanelModel {
  empty: boolean;
  emptyMessage: string;
  badgeCount: number;
  leaves: DeskLeaf[];
  defaultSession?: string;
  notice?: string;
  errorDetail?: string;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(mtimeMs: number): string {
  if (!mtimeMs) return '';
  try {
    return new Date(mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '';
  }
}

export function buildDeskPanelModel(
  packets: DeskPacket[],
  options: { defaultSession?: string; notice?: string; errorDetail?: string } = {},
): DeskPanelModel {
  const leaves: DeskLeaf[] = packets.map((packet) => ({
    key: packet.folderName,
    folderName: packet.folderName,
    path: packet.path,
    game: packet.game,
    gate: packet.gate,
    date: packet.date,
    mtimeLabel: formatMtime(packet.mtimeMs),
    ...(packet.cardHtml !== undefined ? { cardHtml: packet.cardHtml } : {}),
    cardMissing: packet.cardMissing,
    hasAnnotate: Boolean(packet.annotatePath),
    ...(packet.annotatePath ? { annotatePath: packet.annotatePath } : {}),
    hasAnnotateNotes: Boolean(packet.annotateNotes?.trim()),
    files: packet.files.map((file) => ({
      name: file.name,
      sizeLabel: formatSize(file.size),
      type: file.type,
    })),
    readyGatePassed: packet.readyGatePassed,
    replayGatePassed: packet.replayGatePassed,
    waiting: true as const,
  }));

  return {
    empty: leaves.length === 0,
    emptyMessage: 'No packets on the desk.',
    badgeCount: leaves.length,
    leaves,
    ...(options.defaultSession ? { defaultSession: options.defaultSession } : {}),
    ...(options.notice ? { notice: options.notice } : {}),
    ...(options.errorDetail ? { errorDetail: options.errorDetail } : {}),
  };
}

export function emptyDeskPanelModel(detail?: string): DeskPanelModel {
  return {
    empty: true,
    emptyMessage: 'No packets on the desk.',
    badgeCount: 0,
    leaves: [],
    ...(detail ? { errorDetail: detail } : {}),
  };
}
