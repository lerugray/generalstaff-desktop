import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface ProcessInvocation {
  executable: string;
  args: string[];
  env: Record<string, string>;
}

function npmEntryPoint(shim: string): string | undefined {
  const source = readFileSync(shim, 'utf8');
  const quoted = source.match(/["']([^"'\r\n]*node_modules[^"'\r\n]*\.(?:cjs|mjs|js))["']/iu)?.[1];
  const unquoted = source.match(/([^\s"']*node_modules[^\s"']*\.(?:cjs|mjs|js))/iu)?.[1];
  const raw = quoted ?? unquoted;
  if (!raw) return undefined;
  const directory = path.dirname(shim);
  const expanded = raw.replace(/%dp0%[\\/]?/giu, `${directory}${path.sep}`);
  return path.normalize(expanded);
}

/**
 * npm-installed Windows CLIs are commonly exposed as .cmd shims. Passing
 * operator arguments through the shim would let cmd.exe parse metacharacters.
 * Resolve the trusted shim's Node entry point and spawn Node directly instead;
 * unsupported batch wrappers fail closed.
 */
export function processInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): ProcessInvocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executable)) {
    return { executable, args, env: {} };
  }
  const entryPoint = npmEntryPoint(executable);
  if (!entryPoint) {
    throw new Error(`Unsupported Windows command shim: ${path.basename(executable)}.`);
  }
  const adjacentNode = path.join(path.dirname(executable), 'node.exe');
  return {
    executable: existsSync(adjacentNode) ? adjacentNode : 'node.exe',
    args: [entryPoint, ...args],
    env: {},
  };
}
