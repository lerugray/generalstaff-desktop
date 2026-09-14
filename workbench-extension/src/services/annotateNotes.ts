import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * ANNOTATE.html (from gs-private scripts/make-annotate.py) keeps live pins in
 * browser localStorage and persists a sidecar the operator can leave in the
 * packet. Observed / contracted sidecars, in preference order:
 *   - NOTES.txt / notes.txt  — plain-text "COPY ALL NOTES" dump
 *   - notes.json / annotate-notes.json / .annotate-notes.json /
 *     localStorage-notes.json — JSON export of the same notes
 * gs-private is not in this workspace; the reader is tolerant of those shapes.
 */

const TEXT_CANDIDATES = ['NOTES.txt', 'notes.txt', 'notes-export.txt', 'COPY-ALL-NOTES.txt'];
const JSON_CANDIDATES = [
  'notes.json',
  'annotate-notes.json',
  '.annotate-notes.json',
  'localStorage-notes.json',
  'localStorage.json',
];

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function notesFromJson(raw: unknown): string | undefined {
  if (typeof raw === 'string') return asTrimmedString(raw);
  if (Array.isArray(raw)) {
    const lines = raw
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (!entry || typeof entry !== 'object') return '';
        const obj = entry as Record<string, unknown>;
        return (
          asTrimmedString(obj.text)
          || asTrimmedString(obj.note)
          || asTrimmedString(obj.body)
          || asTrimmedString(obj.content)
          || asTrimmedString(obj.comment)
          || ''
        );
      })
      .filter(Boolean);
    return lines.length ? lines.join('\n') : undefined;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.notes)) return notesFromJson(obj.notes);
    if (Array.isArray(obj.items)) return notesFromJson(obj.items);
    const single =
      asTrimmedString(obj.notes)
      || asTrimmedString(obj.text)
      || asTrimmedString(obj.body);
    if (single) return single;
  }
  return undefined;
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return asTrimmedString(await fs.readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function readJsonNotes(filePath: string): Promise<string | undefined> {
  const text = await readTextFile(filePath);
  if (!text) return undefined;
  try {
    return notesFromJson(JSON.parse(text));
  } catch {
    // Non-JSON dump left with a .json name — treat as plain text.
    return text;
  }
}

/**
 * Best-effort scrape when the only artifact is ANNOTATE.html itself
 * (notes embedded for offline reopen, not yet exported to NOTES.txt).
 */
export function extractNotesFromAnnotateHtml(html: string): string | undefined {
  if (!html.trim()) return undefined;

  const jsonBlocks: string[] = [];
  const scriptJson = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptJson.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (body) jsonBlocks.push(body);
  }
  for (const block of jsonBlocks) {
    try {
      const notes = notesFromJson(JSON.parse(block));
      if (notes) return notes;
    } catch {
      // keep looking
    }
  }

  const textareas = [...html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)]
    .map((m) => asTrimmedString(m[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')))
    .filter((value): value is string => Boolean(value));
  if (textareas.length) return textareas.join('\n\n');

  const dataNotes = html.match(/\bdata-notes=["']([^"']+)["']/i);
  if (dataNotes?.[1]) {
    try {
      return asTrimmedString(decodeURIComponent(dataNotes[1])) || asTrimmedString(dataNotes[1]);
    } catch {
      return asTrimmedString(dataNotes[1]);
    }
  }

  return undefined;
}

/** Compose the closed ping body: "<PACKET-NAME>: <verdict>" (+ notes when opted in). */
export function buildRulingBody(
  folderName: string,
  verdict: string,
  annotateNotes?: string,
): string {
  const name = folderName.trim() || 'packet';
  const head = `${name}: ${verdict.trim()}`;
  const notes = annotateNotes?.trim();
  if (!notes) return head;
  return `${head}\n\n${notes}`;
}

/**
 * Read ANNOTATE notes from a packet directory. Returns undefined when none exist.
 * Never writes. Preference: NOTES.txt sidecars → JSON exports → ANNOTATE.html scrape.
 */
export async function readAnnotateNotes(packetPath: string): Promise<string | undefined> {
  if (!packetPath) return undefined;

  let entries: string[];
  try {
    entries = await fs.readdir(packetPath);
  } catch {
    return undefined;
  }
  const byLower = new Map(entries.map((name) => [name.toLowerCase(), name]));

  for (const candidate of TEXT_CANDIDATES) {
    const actual = byLower.get(candidate.toLowerCase());
    if (!actual) continue;
    const notes = await readTextFile(path.join(packetPath, actual));
    if (notes) return notes;
  }

  for (const candidate of JSON_CANDIDATES) {
    const actual = byLower.get(candidate.toLowerCase());
    if (!actual) continue;
    const notes = await readJsonNotes(path.join(packetPath, actual));
    if (notes) return notes;
  }

  const annotateName = byLower.get('annotate.html');
  if (annotateName) {
    const html = await readTextFile(path.join(packetPath, annotateName));
    if (html) {
      const fromHtml = extractNotesFromAnnotateHtml(html);
      if (fromHtml) return fromHtml;
    }
  }

  return undefined;
}
