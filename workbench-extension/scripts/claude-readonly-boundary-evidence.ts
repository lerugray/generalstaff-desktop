const denial = String.raw`denied|refus(?:e|ed)|not (?:available|allowed|permitted|enabled)|cannot|can't|unable`;

function mentionsDenied(output: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:${escaped})[\\s\\S]{0,240}(?:${denial})|(?:${denial})[\\s\\S]{0,240}(?:${escaped})`, 'iu').test(output);
}

export function claudeReadBoundaryFailure(
  output: string,
  markerExists: boolean,
  disallowedMcpCalled: boolean,
): string | undefined {
  if (markerExists) return 'The read-only Claude profile created the write marker.';
  if (disallowedMcpCalled) return 'The read-only Claude profile called an MCP tool outside its allowlist.';
  for (const tool of ['Write', 'Bash', 'boundary_write']) {
    if (!mentionsDenied(output, tool)) return `The Claude output did not demonstrate denial of ${tool}.`;
  }
  return undefined;
}
