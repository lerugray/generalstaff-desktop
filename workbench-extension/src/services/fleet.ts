import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ActivityItem, ArtifactSummary, AttentionItem, FleetSnapshot, ProjectSummary } from '../domain.js';
import { discoverLanes } from './lanes.js';
import { discoverPrivateRuntime, type PrivateRuntimeOptions } from './privateRuntime.js';
import { discoverSkills } from './skills.js';

interface RawTask {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  done_at?: unknown;
  interactive_only?: unknown;
  interactive_only_reason?: unknown;
  gated_on?: unknown;
}

function words(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function taskPriority(task: RawTask): number {
  return typeof task.priority === 'number' ? task.priority : 99;
}

function projectName(id: string): string {
  return id
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function missionExcerpt(text: string): string {
  const cleaned = text
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/^#+\s+.*$/gm, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 220);
}

function normalizeRepoName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/private$/, '');
}

async function siblingRepoMap(rootPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  const parent = path.dirname(rootPath);
  try {
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parent, entry.name);
      if (path.resolve(candidate) === path.resolve(rootPath)) continue;
      try {
        await fs.access(path.join(candidate, '.git'));
        const key = normalizeRepoName(entry.name);
        if (ambiguous.has(key)) continue;
        if (map.has(key)) {
          map.delete(key);
          ambiguous.add(key);
          continue;
        }
        map.set(key, candidate);
      } catch {
        // Not a sibling repository.
      }
    }
  } catch {
    // An empty map still permits state-only projects to render.
  }
  return map;
}

function artifactKind(file: string): ArtifactSummary['kind'] | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'preview';
  if (/\.(png|jpe?g|gif|webp|svg)$/u.test(lower)) return 'image';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md')) return /brief|mission|spec|design/u.test(lower) ? 'brief' : 'document';
  return undefined;
}

function artifactLabel(file: string): string {
  return path
    .basename(file)
    .replace(/\.[^.]+$/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

async function discoverArtifacts(repoPath: string | undefined, statePath: string): Promise<ArtifactSummary[]> {
  const candidates = [path.join(statePath, 'MISSION.md')];
  if (repoPath) {
    candidates.push(path.join(repoPath, 'README.md'), path.join(repoPath, 'index.html'));
    for (const directory of ['docs', 'design', 'artifacts', 'output']) {
      const root = path.join(repoPath, directory);
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries.slice(0, 80)) {
          if (entry.isFile() && artifactKind(entry.name)) candidates.push(path.join(root, entry.name));
        }
      } catch {
        // Artifact folders are optional.
      }
    }
  }

  const artifacts: ArtifactSummary[] = [];
  for (const candidate of [...new Set(candidates)]) {
    const kind = artifactKind(candidate);
    if (!kind) continue;
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      artifacts.push({
        label: artifactLabel(candidate),
        path: candidate,
        kind,
        changedAt: stat.mtimeMs,
      });
    } catch {
      // Candidate did not exist.
    }
  }

  return artifacts
    .sort((a, b) => {
      const priority = (item: ArtifactSummary) =>
        /readme/i.test(item.label) ? 0 : /mission/i.test(item.label) ? 1 : item.kind === 'preview' ? 2 : 3;
      return priority(a) - priority(b) || (b.changedAt ?? 0) - (a.changedAt ?? 0);
    })
    .slice(0, 8);
}

async function hasStateDirectory(candidate: string | undefined): Promise<boolean> {
  if (!candidate) return false;
  try {
    return (await fs.stat(path.join(candidate, 'state'))).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveGeneralStaffRoot(
  configured: string | undefined,
  workspaceRoot?: string,
): Promise<string> {
  if (configured?.trim()) {
    return path.resolve(configured.trim());
  }

  const legacy = await readJson<{ generalstaff_path?: string }>(
    path.join(os.homedir(), '.generalstaff-desktop', 'config.json'),
  );
  if (legacy?.generalstaff_path) {
    return path.resolve(legacy.generalstaff_path);
  }

  const environmentRoot = process.env.GENERALSTAFF_ROOT?.trim();
  if (await hasStateDirectory(environmentRoot)) {
    return path.resolve(environmentRoot as string);
  }
  if (await hasStateDirectory(workspaceRoot)) {
    return path.resolve(workspaceRoot as string);
  }
  return '';
}

export async function scanFleet(rootPath: string, runtimeOptions: PrivateRuntimeOptions = {}): Promise<FleetSnapshot> {
  const stateRoot = rootPath ? path.join(rootPath, 'state') : '';
  const repos = rootPath ? await siblingRepoMap(rootPath) : new Map<string, string>();
  const projects: ProjectSummary[] = [];
  const attention: AttentionItem[] = [];
  const activity: ActivityItem[] = [];

  let entries: import('node:fs').Dirent[] = [];
  try {
    if (stateRoot) entries = await fs.readdir(stateRoot, { withFileTypes: true });
  } catch {
    // The caller renders a useful setup state from an empty snapshot.
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === 'pings') {
      continue;
    }

    const statePath = path.join(stateRoot, entry.name);
    const tasks = await readJson<RawTask[]>(path.join(statePath, 'tasks.json'));
    if (!Array.isArray(tasks)) continue;

    const pendingTasks = tasks.filter((task) => words(task.status) === 'pending').sort((a, b) => taskPriority(a) - taskPriority(b));
    const inProgressTasks = tasks.filter((task) => words(task.status) === 'in_progress');
    const reviewTasks = tasks.filter((task) => ['needs_review', 'review'].includes(words(task.status)));
    const blockedTasks = tasks.filter((task) => words(task.status) === 'blocked' || Boolean(words(task.gated_on)));
    const completeTasks = tasks.filter((task) => ['done', 'completed'].includes(words(task.status)));
    const top = inProgressTasks[0] ?? pendingTasks[0] ?? reviewTasks[0];
    const mission = missionExcerpt(await readText(path.join(statePath, 'MISSION.md')));
    const repoPath = repos.get(normalizeRepoName(entry.name));
    const artifacts = await discoverArtifacts(repoPath, statePath);

    let lastChangedAt: number | undefined;
    try {
      lastChangedAt = (await fs.stat(path.join(statePath, 'tasks.json'))).mtimeMs;
    } catch {
      // Optional display metadata.
    }

    projects.push({
      id: entry.name,
      name: projectName(entry.name),
      ...(repoPath ? { repoPath } : {}),
      statePath,
      mission: mission || 'No mission summary is available yet.',
      pending: pendingTasks.length,
      inProgress: inProgressTasks.length,
      needsReview: reviewTasks.length,
      completed: completeTasks.length,
      artifacts,
      ...(top && words(top.title) ? { topTask: words(top.title) } : {}),
      ...(lastChangedAt ? { lastChangedAt } : {}),
    });

    for (const task of [...reviewTasks, ...inProgressTasks.filter((item) => item.interactive_only === true)].slice(0, 2)) {
      attention.push({
        id: `${entry.name}:${words(task.id) || words(task.title)}`,
        projectId: entry.name,
        kind: reviewTasks.includes(task) ? 'review' : 'decision',
        title: words(task.title) || words(task.id) || 'Operator attention needed',
        detail: words(task.interactive_only_reason) || words(task.gated_on) || 'This item is waiting for operator judgment.',
      });
    }

    for (const task of blockedTasks.slice(0, 2)) {
      attention.push({
        id: `${entry.name}:blocked:${words(task.id) || words(task.title)}`,
        projectId: entry.name,
        kind: 'blocked',
        title: words(task.title) || words(task.id) || 'Blocked work',
        detail: words(task.gated_on) || 'This item is blocked and needs a dependency or decision.',
      });
    }

    const recentDone = completeTasks
      .filter((task) => words(task.done_at))
      .sort((a, b) => words(b.done_at).localeCompare(words(a.done_at)))
      .slice(0, 1);
    for (const task of recentDone) {
      activity.push({
        id: `${entry.name}:done:${words(task.id)}`,
        projectId: entry.name,
        tone: 'good',
        title: words(task.title) || words(task.id) || 'Completed work',
        detail: `${projectName(entry.name)} recorded this item complete.`,
        when: words(task.done_at),
      });
    }
  }

  projects.sort((a, b) => {
    const aHeat = a.inProgress * 100 + a.needsReview * 50 + a.pending;
    const bHeat = b.inProgress * 100 + b.needsReview * 50 + b.pending;
    return bHeat - aHeat || a.name.localeCompare(b.name);
  });

  attention.splice(12);
  activity.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
  activity.splice(12);

  const [lanes, skills, runtime] = await Promise.all([
    discoverLanes(),
    discoverSkills(rootPath),
    discoverPrivateRuntime(rootPath, runtimeOptions),
  ]);
  return {
    generatedAt: Date.now(),
    rootPath,
    projects,
    attention,
    activity,
    lanes,
    skills,
    capabilities: runtime.capabilities,
  };
}
