import type { CommandTarget, EffortId, FleetSnapshot, LaneSummary, PermissionMode, ProjectSummary, SeatId } from './domain.js';
import { requireAllowedPath } from './security/paths.js';

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

export function resolveCommandTarget(
  target: CommandTarget,
  snapshot: Pick<FleetSnapshot, 'rootPath' | 'projects'>,
): ResolvedCommandTarget | undefined {
  if (target.kind === 'general') {
    if (!snapshot.rootPath) return undefined;
    return {
      target,
      name: 'General Staff — orchestrator',
      workingDirectory: snapshot.rootPath,
      contextRoots: [snapshot.rootPath],
      canWrite: true,
    };
  }
  const project = snapshot.projects.find((item) => item.id === target.projectId);
  if (!project) return undefined;
  return {
    target,
    name: project.name,
    workingDirectory: project.repoPath ?? project.statePath,
    contextRoots: [project.statePath, ...(project.repoPath ? [project.repoPath] : [])],
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

export function writeConsentPrompt(targetName: string, laneName: string): {
  message: string;
  options: { modal: true; detail: string };
  action: 'Enable edit access';
} {
  return {
    message: `Enable edit access for ${laneName} in ${targetName}?`,
    options: {
      modal: true,
      detail: 'The lane may modify files inside the selected command target repository. The consent and working directory will be recorded in the run receipt.',
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

export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
  ].join('; ');
}
