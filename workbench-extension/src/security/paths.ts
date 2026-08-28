import * as path from 'node:path';

export function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function requireAllowedPath(candidate: string, allowedRoots: string[]): string {
  const resolved = path.resolve(candidate);
  if (!allowedRoots.some((root) => isPathInside(resolved, root))) {
    throw new Error('That path is outside the registered GeneralStaff projects.');
  }
  return resolved;
}
