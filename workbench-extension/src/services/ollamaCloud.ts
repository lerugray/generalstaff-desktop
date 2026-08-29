import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LaneId } from '../domain.js';

export const OLLAMA_CLOUD_API_KEY_NAME = 'OLLAMA_CLOUD_API_KEY';
export const OLLAMA_CLOUD_ENV_PATH = path.join('.generalstaff', '.env');
export const OLLAMA_CLOUD_TAGS_URL = 'https://ollama.com/api/tags';
export const OLLAMA_CLOUD_CHAT_URL = 'https://ollama.com/v1/chat/completions';

const ollamaModels = {
  'glm-ollama': 'glm-5.3',
  'glm-ollama-flash': 'glm-5.3-flash',
} as const satisfies Partial<Record<LaneId, string>>;

export type OllamaCloudLaneId = keyof typeof ollamaModels;
export type FetchLike = typeof fetch;

export function isOllamaCloudLaneId(laneId: LaneId): laneId is OllamaCloudLaneId {
  return Object.hasOwn(ollamaModels, laneId);
}

export function ollamaCloudModelFor(laneId: OllamaCloudLaneId): string {
  return ollamaModels[laneId];
}

function unquoteEnvValue(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (!value) return undefined;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1) || undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded = JSON.parse(value) as unknown;
      return typeof decoded === 'string' && decoded ? decoded : undefined;
    } catch {
      return undefined;
    }
  }
  const withoutComment = value.replace(/\s+#.*$/u, '').trim();
  return withoutComment && !/\s/u.test(withoutComment) ? withoutComment : undefined;
}

export function parseExportedEnvKey(source: string, variable = OLLAMA_CLOUD_API_KEY_NAME): string | undefined {
  let found: string | undefined;
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match?.[1] !== variable) continue;
    found = unquoteEnvValue(match[2] ?? '');
  }
  return found;
}

export async function loadOllamaCloudApiKey(homeDirectory = os.homedir()): Promise<string | undefined> {
  const envPath = path.join(homeDirectory, OLLAMA_CLOUD_ENV_PATH);
  try {
    const stat = await fs.stat(envPath);
    if (!stat.isFile() || stat.size > 128 * 1024) return undefined;
    return parseExportedEnvKey(await fs.readFile(envPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function modelTag(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function catalogModelTags(payload: unknown): Set<string> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return new Set();
  const models = (payload as Record<string, unknown>).models;
  if (!Array.isArray(models)) return new Set();
  const tags = new Set<string>();
  for (const entry of models) {
    if (typeof entry === 'string') {
      const tag = modelTag(entry);
      if (tag) tags.add(tag);
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    for (const candidate of [record.name, record.model]) {
      const tag = modelTag(candidate);
      if (tag) tags.add(tag);
    }
  }
  return tags;
}

export async function fetchOllamaCloudCatalog(
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<Set<string>> {
  const response = await fetcher(OLLAMA_CLOUD_TAGS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`catalog probe returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
    throw new Error('catalog probe returned an oversized response');
  }
  const body = await response.text();
  if (body.length > 2 * 1024 * 1024) throw new Error('catalog probe returned an oversized response');
  return catalogModelTags(JSON.parse(body) as unknown);
}

export function catalogHasModel(tags: ReadonlySet<string>, model: string): boolean {
  return tags.has(model);
}
