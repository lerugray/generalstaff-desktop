import type { EffortId, LaneSummary, PermissionMode, ProjectSummary, SeatId } from './domain.js';
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

export function projectSupportsPermission(permission: PermissionMode, repoPath: string | undefined): boolean {
  return permission !== 'write' || repoPath !== undefined;
}

export async function authorizeWriteAccess(
  permission: PermissionMode,
  alreadyEnabled: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return permission !== 'write' || alreadyEnabled || await confirm();
}

export function writeConsentPrompt(projectName: string, laneName: string): {
  message: string;
  options: { modal: true; detail: string };
  action: 'Enable edit access';
} {
  return {
    message: `Enable edit access for ${laneName} in ${projectName}?`,
    options: {
      modal: true,
      detail: 'The lane may modify files inside the discovered project repository. The consent and working directory will be recorded in the run receipt.',
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
