import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SkillSummary } from '../domain.js';
import { redact } from '../security/redaction.js';

const skillIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const textExtensions = new Set(['.md', '.txt', '.json', '.py', '.sh', '.mjs', '.js', '.ts']);
const maxBundleCharacters = 260_000;
const maxBundleFiles = 80;
const maxSkillFileBytes = 512_000;

interface SkillSource {
  summary: SkillSummary;
  directory: string;
  files: Array<{ relativePath: string; content: string }>;
}

export interface CompiledSkillBundle {
  id: string;
  name: string;
  description: string;
  sourceDirectory: string;
  fileCount: number;
  characterCount: number;
  prompt: string;
}

export interface SkillInvocation {
  skillId?: string;
  operatorText: string;
  laneText: string;
  unknownSkillId?: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\([\\"'])/gu, '$1');
  }
  return trimmed;
}

function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const normalized = text.replaceAll('\r\n', '\n');
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return {};
  const values: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^([a-z][a-z0-9_-]*):\s*(.+)$/iu.exec(line);
    if (match?.[1] && match[2]) values[match[1].toLowerCase()] = unquote(match[2]);
  }
  return values;
}

function fallbackName(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function fallbackDescription(text: string): string {
  const normalized = text.replaceAll('\r\n', '\n');
  const withoutFrontmatter = normalized.startsWith('---\n')
    ? normalized.slice(Math.max(0, normalized.indexOf('\n---', 4) + 4))
    : normalized;
  return withoutFrontmatter
    .replace(/^#+\s+.*$/gmu, '')
    .replace(/<!--([\s\S]*?)-->/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 280);
}

async function textFiles(directory: string): Promise<Array<{ relativePath: string; content: string }>> {
  const files: Array<{ relativePath: string; content: string }> = [];
  const visit = async (current: string): Promise<void> => {
    if (files.length >= maxBundleFiles) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.name === 'SKILL.md') return -1;
      if (b.name === 'SKILL.md') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (files.length >= maxBundleFiles || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const relativePath = path.relative(directory, candidate);
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
        const stat = await fs.lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maxSkillFileBytes) continue;
        const content = await fs.readFile(candidate, 'utf8');
        files.push({ relativePath, content });
      } catch {
        // A broken or unreadable companion file does not hide the primary skill.
      }
    }
  };
  await visit(directory);
  return files;
}

async function loadSkill(rootPath: string, id: string): Promise<SkillSource | undefined> {
  if (!rootPath || !skillIdPattern.test(id) || id === 'lean-ctx') return undefined;
  const directory = path.join(rootPath, 'skills', id);
  let stat: import('node:fs').Stats;
  try {
    stat = await fs.lstat(directory);
  } catch {
    return undefined;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
  const files = await textFiles(directory);
  const primary = files.find((file) => file.relativePath === 'SKILL.md');
  if (!primary) return undefined;
  const metadata = frontmatter(primary.content);
  const rawName = metadata.name?.trim() || fallbackName(id);
  const name = redact(rawName, 120) || fallbackName(id);
  const rawDescription = metadata.description?.trim() || fallbackDescription(primary.content) || `Apply the ${name} procedure.`;
  const description = redact(rawDescription, 420) || `Apply the ${name} procedure.`;
  const characterCount = files.reduce((total, file) => total + file.content.length, 0);
  return {
    directory,
    files,
    summary: {
      id,
      name,
      description,
      fileCount: files.length,
      characterCount,
    },
  };
}

export async function discoverSkills(rootPath: string): Promise<SkillSummary[]> {
  if (!rootPath) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(path.join(rootPath, 'skills'), { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: SkillSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !skillIdPattern.test(entry.name) || entry.name === 'lean-ctx') {
      continue;
    }
    const source = await loadSkill(rootPath, entry.name);
    if (source) summaries.push(source.summary);
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function compileSkillBundle(rootPath: string, id: string): Promise<CompiledSkillBundle> {
  const source = await loadSkill(rootPath, id);
  if (!source) throw new Error(`The private skill /${id} is no longer available.`);

  const compatibility = [
    `Apply the operator-selected GeneralStaff skill /${source.summary.id} (${source.summary.name}).`,
    '',
    'Cross-model compatibility contract:',
    '- Follow the bundled skill as the governing task procedure, subject to the operator request and Workbench permission boundary.',
    '- Claude tool names such as Read, Grep, Glob, Bash, Edit, and Write mean the equivalent file, search, shell, and editing capabilities in your lane.',
    '- AskUserQuestion means return the Workbench <gs-decision> block described by the host when a real operator decision blocks progress.',
    '- Agent, Task, or subagent instructions mean use native subagents only if your lane exposes them. Otherwise do the bounded work locally or surface the blocked decision; never invent a tool or claim a delegation occurred.',
    '- Slash references name other canonical skills in the selected GeneralStaff skill catalog. They are workflow dependencies, not evidence that another skill is already loaded. Read one only when the selected procedure requires it.',
    '- A skill never expands filesystem permission, external-action authority, budget authority, or the scope of the operator request.',
    '',
    `Bundled private skill files (up to ${source.files.length} text files within the total prompt cap):`,
  ].join('\n');
  const sections: string[] = [];
  let used = compatibility.length;
  for (const file of source.files) {
    const heading = `\n\n--- ${redact(file.relativePath, 240)} ---\n`;
    const remaining = maxBundleCharacters - used - heading.length;
    if (remaining <= 0) break;
    const safe = redact(file.content, remaining);
    sections.push(`${heading}${safe}`);
    used += heading.length + safe.length;
  }

  return {
    id: source.summary.id,
    name: source.summary.name,
    description: source.summary.description,
    sourceDirectory: source.directory,
    fileCount: sections.length,
    characterCount: used,
    prompt: `${compatibility}${sections.join('')}`,
  };
}

export function resolveSkillInvocation(text: string, skills: readonly SkillSummary[]): SkillInvocation {
  const operatorText = text.trim();
  const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+|$)/u.exec(operatorText);
  if (!match?.[1]) return { operatorText, laneText: operatorText };
  const id = match[1];
  if (!skills.some((skill) => skill.id === id)) {
    return { operatorText, laneText: operatorText, unknownSkillId: id };
  }
  const remainder = operatorText.slice(match[0].length).trim();
  return {
    skillId: id,
    operatorText,
    laneText: remainder || `Apply /${id} to the current conversation context.`,
  };
}
