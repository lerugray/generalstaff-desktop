import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LaneSummary, PermissionMode, PrivateCapabilitySummary } from '../domain.js';
import { processInvocation } from './processInvocation.js';

export interface McpServerLaunch {
  id: 'headroom' | 'lane-desk';
  command: string;
  args: string[];
}

export interface PrivateRuntimeProfile {
  capabilities: PrivateCapabilitySummary[];
  mcpServers: McpServerLaunch[];
  laneDeskCli?: string;
  laneDeskConfig?: string;
}

export interface PrivateRuntimeOptions {
  laneDeskRuntimePath?: string;
  headroomCommand?: string;
  pythonCommand?: string;
}

async function executable(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readable(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function regularFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(candidate);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function externalRuntimeDirectory(rootPath: string, candidate: string): Promise<string | undefined> {
  if (!rootPath || !path.isAbsolute(candidate)) return undefined;
  try {
    const [root, runtime] = await Promise.all([fs.realpath(rootPath), fs.realpath(candidate)]);
    const stat = await fs.lstat(candidate);
    const relative = path.relative(root, runtime);
    const insideRoot = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    if (!stat.isDirectory() || stat.isSymbolicLink() || insideRoot) {
      return undefined;
    }
    return runtime;
  } catch {
    return undefined;
  }
}

async function healthProbe(command: string, args: string[], requireJson = false): Promise<boolean> {
  let processSpec: ReturnType<typeof processInvocation>;
  try {
    processSpec = processInvocation(command, args);
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    execFile(
      processSpec.executable,
      processSpec.args,
      {
        timeout: 5_000,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...processSpec.env },
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        if (!requireJson) {
          resolve(true);
          return;
        }
        try {
          JSON.parse(stdout);
          resolve(true);
        } catch {
          resolve(false);
        }
      },
    );
  });
}

export async function discoverPrivateRuntime(
  rootPath: string,
  options: PrivateRuntimeOptions = {},
): Promise<PrivateRuntimeProfile> {
  const headroomCommand = options.headroomCommand ?? path.join(os.homedir(), '.local', 'bin', 'headroom-mcp-pure');
  const pythonCommand = options.pythonCommand ?? 'python3';
  const laneDeskRoot = options.laneDeskRuntimePath
    ? await externalRuntimeDirectory(rootPath, options.laneDeskRuntimePath)
    : undefined;
  const laneDeskServer = laneDeskRoot ? path.join(laneDeskRoot, 'mcp_server.py') : '';
  const laneDeskCli = laneDeskRoot ? path.join(laneDeskRoot, 'lane_desk.py') : '';
  const laneDeskConfig = laneDeskRoot ? path.join(laneDeskRoot, 'lane-desk.toml') : '';
  const headroomAvailable = await executable(headroomCommand) && await healthProbe(headroomCommand, ['--help']);
  const laneDeskFilesAvailable = Boolean(
    laneDeskRoot &&
    await regularFile(laneDeskServer) &&
    await regularFile(laneDeskCli) &&
    await regularFile(laneDeskConfig) &&
    await readable(laneDeskServer) &&
    await readable(laneDeskCli) &&
    await readable(laneDeskConfig),
  );
  const laneDeskAvailable = laneDeskFilesAvailable && await healthProbe(
    pythonCommand,
    [laneDeskCli, '--config', laneDeskConfig, 'status', '--json'],
    true,
  );

  const capabilities: PrivateCapabilitySummary[] = [
    {
      id: 'headroom',
      name: 'Headroom',
      detail: 'Local MCP compression and retrieval in pure-server mode; proxy and wrap modes remain prohibited.',
      state: headroomAvailable ? 'available' : 'missing',
      nativeLanes: headroomAvailable ? ['codex', 'claude'] : [],
      fallbackLanes: [],
    },
    {
      id: 'lane-desk',
      name: 'Lane Desk',
      detail: laneDeskAvailable
        ? 'Read-only status, harvest evidence, and bounded lane detail from the configured machine-scoped runtime.'
        : 'Requires a healthy machine-scoped runtime outside the selected GeneralStaff root.',
      state: laneDeskAvailable ? 'available' : 'missing',
      nativeLanes: laneDeskAvailable ? ['codex', 'claude'] : [],
      fallbackLanes: laneDeskAvailable ? ['kimi', 'cline', 'cursor', 'grok'] : [],
    },
  ];
  const mcpServers: McpServerLaunch[] = [];
  if (headroomAvailable) mcpServers.push({ id: 'headroom', command: headroomCommand, args: [] });
  if (laneDeskAvailable) {
    mcpServers.push({
      id: 'lane-desk',
      command: pythonCommand,
      args: [laneDeskServer, '--config', laneDeskConfig],
    });
  }
  return {
    capabilities,
    mcpServers,
    ...(laneDeskAvailable ? { laneDeskCli, laneDeskConfig } : {}),
  };
}

function capabilityTransport(
  profile: PrivateRuntimeProfile,
  capability: PrivateCapabilitySummary,
  lane: LaneSummary,
  permission: PermissionMode,
): 'native' | 'fallback' | undefined {
  const nativeMcp = lane.id === 'codex' || (lane.id === 'claude' && lane.runner === 'claude' && permission === 'write');
  if (nativeMcp && capability.nativeLanes.includes(lane.id)) return 'native';
  if (
    capability.id === 'lane-desk' &&
    profile.laneDeskCli &&
    profile.laneDeskConfig &&
    capability.fallbackLanes.includes(lane.runner)
  ) return 'fallback';
  return undefined;
}

export function privateCapabilityReceiptNames(
  profile: PrivateRuntimeProfile,
  lane: LaneSummary,
  permission: PermissionMode,
): string[] {
  return profile.capabilities.flatMap((capability) => {
    if (capability.state !== 'available') return [];
    const transport = capabilityTransport(profile, capability, lane, permission);
    if (transport === 'native') return [capability.name];
    if (transport === 'fallback') return [`${capability.name} (CLI fallback)`];
    return [];
  });
}

export function privateRuntimePrompt(
  profile: PrivateRuntimeProfile,
  lane: LaneSummary,
  permission: PermissionMode = 'read',
): string {
  const available = profile.capabilities.filter((capability) => capability.state === 'available');
  if (!available.length) return '';
  const lines = [
    'Private GeneralStaff runtime status:',
    '- Attached helpers do not expand the operator request, repository permission, or authority for external side effects.',
  ];
  const headroom = available.find((capability) => capability.id === 'headroom');
  if (headroom) {
    const transport = capabilityTransport(profile, headroom, lane, permission);
    lines.push(transport === 'native'
      ? '- Headroom is exposed as a native MCP server for local big-file compression and cached retrieval. Use its MCP tools only when they materially reduce context; it is pure MCP mode. Never invoke headroom proxy/wrap modes or lean-ctx.'
      : '- Headroom is not attached to this run. Do not claim to call it and never substitute headroom proxy/wrap modes or lean-ctx. Keep file reads bounded with native tools instead.');
  }
  const laneDesk = available.find((capability) => capability.id === 'lane-desk');
  if (laneDesk) {
    const transport = capabilityTransport(profile, laneDesk, lane, permission);
    if (transport === 'native') {
      lines.push('- Lane Desk is exposed as a native MCP server with lanes_status, lane_harvest, and lane_detail. It is strictly observational: it never launches, stops, repairs, commits, or changes a lane.');
    } else if (transport === 'fallback' && profile.laneDeskCli && profile.laneDeskConfig) {
      lines.push(
        '- Lane Desk is available through its read-only CLI fallback in this lane:',
        `  python3 "${profile.laneDeskCli}" --config "${profile.laneDeskConfig}" status --json`,
        `  python3 "${profile.laneDeskCli}" --config "${profile.laneDeskConfig}" harvest LANE_ID --host HOST --json`,
        `  python3 "${profile.laneDeskCli}" --config "${profile.laneDeskConfig}" detail LANE_ID --host HOST --lines 40 --json`,
        '  Use only discovered lane IDs. The fallback has the same read-only scanner and boundaries as the MCP server.',
      );
    } else {
      lines.push('- Lane Desk is not attached to this run. Do not claim Lane Desk evidence or tool use.');
    }
  }
  return lines.join('\n');
}
