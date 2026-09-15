import type { CommandTarget, EffortId, FleetSnapshot, LaneSummary, PermissionMode, ProjectSummary, SeatId } from './domain.js';
import { requireAllowedPath } from './security/paths.js';
import { desktopHandoffDirectory } from './services/handoffPaths.js';

type RoutingLane = Pick<LaneSummary, 'state' | 'roles' | 'permissions' | 'efforts'>;
type OpenFileProject = Pick<ProjectSummary, 'statePath' | 'repoPath'>;

export function supportsRouting(
  lane: RoutingLane,
  seat: SeatId,
  permission: PermissionMode,
  effort: EffortId,
): boolean {
  return lane.state === 'available' &&
    lane.roles.includes(seat) &&
    lane.permissions.includes(permission) &&
    lane.efforts.some((option) => option.id === effort);
}

export interface ResolvedCommandTarget {
  target: CommandTarget;
  name: string;
  workingDirectory: string;
  contextRoots: string[];
  canWrite: boolean;
}

/** Extra roots the composer may attach — Desktop/handoff is Ray's standing staging surface. */
export function standingContextRoots(): string[] {
  const handoff = desktopHandoffDirectory();
  return handoff ? [handoff] : [];
}

export function resolveCommandTarget(
  target: CommandTarget,
  snapshot: Pick<FleetSnapshot, 'rootPath' | 'projects'>,
): ResolvedCommandTarget | undefined {
  const extra = standingContextRoots();
  if (target.kind === 'general') {
    if (!snapshot.rootPath) return undefined;
    return {
      target,
      name: 'General Staff — orchestrator',
      workingDirectory: snapshot.rootPath,
      contextRoots: [snapshot.rootPath, ...extra],
      canWrite: true,
    };
  }
  const project = snapshot.projects.find((item) => item.id === target.projectId);
  if (!project) return undefined;
  return {
    target,
    name: project.name,
    workingDirectory: project.repoPath ?? project.statePath,
    contextRoots: [project.statePath, ...(project.repoPath ? [project.repoPath] : []), ...extra],
    canWrite: project.repoPath !== undefined,
  };
}

export function targetSupportsPermission(permission: PermissionMode, target: ResolvedCommandTarget): boolean {
  return permission !== 'write' || target.canWrite;
}

export async function authorizeWriteAccess(
  permission: PermissionMode,
  alreadyEnabled: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return permission !== 'write' || alreadyEnabled || await confirm();
}

export function writeConsentPrompt(
  targetName: string,
  laneName: string,
  target: CommandTarget = { kind: 'project', projectId: 'unknown' },
): {
  message: string;
  options: { modal: true; detail: string };
  action: 'Enable edit access';
} {
  const detail = target.kind === 'general'
    ? 'The lane may use write-capable local tools across the registered General Staff portfolio and the standing handoff surface when the operator request requires it. Claude-Code-backed cloud seats run those tools without individual approval prompts. The consent and working directory will be recorded in the run receipt.'
    : 'The lane may modify files inside the selected project repository only. The consent and working directory will be recorded in the run receipt.';
  return {
    message: `Enable edit access for ${laneName} in ${targetName}?`,
    options: {
      modal: true,
      detail,
    },
    action: 'Enable edit access',
  };
}

export function resolveOpenFilePath(
  candidate: string,
  rootPath: string,
  projects: readonly OpenFileProject[],
): string {
  const allowedRoots = [
    rootPath,
    ...projects.flatMap((project) => [project.statePath, ...(project.repoPath ? [project.repoPath] : [])]),
  ];
  return requireAllowedPath(candidate, allowedRoots);
}

export function contentSecurityPolicy(
  cspSource: string,
  nonce: string,
  options: { frameSrc?: boolean } = {},
): string {
  const parts = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    options.frameSrc
      ? `style-src ${cspSource} 'unsafe-inline'`
      : `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
  ];
  // Desk plate: sanitised WHAT-TO-JUDGE HTML in a sandboxed srcdoc iframe.
  if (options.frameSrc) {
    parts.push("frame-src data: blob: about:");
  }
  return parts.join('; ');
}
