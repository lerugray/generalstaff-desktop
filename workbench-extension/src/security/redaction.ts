type Replacement = [RegExp, string | ((match: string) => string)];

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function redactHighEntropyToken(value: string): string {
  const unpadded = value.replace(/=+$/u, '');
  if (/^[a-f0-9]+$/iu.test(unpadded)) return value;
  const characterClasses = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[_~+/-]/u]
    .filter((pattern) => pattern.test(unpadded)).length;
  return characterClasses >= 3 && shannonEntropy(unpadded) >= 4
    ? '[redacted-high-entropy-token]'
    : value;
}

const replacements: Replacement[] = [
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, '[redacted-private-key]'],
  [/\bsk-(?:ws-|sp-)?[A-Za-z0-9._-]{12,}\b/g, '[redacted-key]'],
  [/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted-github-token]'],
  [/\bAKIA[A-Z0-9]{16}\b/g, '[redacted-aws-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, '[redacted-slack-token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]'],
  [/\b(?:Bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '[redacted-credential]'],
  [/((?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|PASSWORD)\s*[=:])\s*[^\s,;]+/gi, '$1[redacted]'],
  [/("(?:password|access_token|auth_token|api_key)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2'],
  [/\b[A-Za-z0-9_~+/-]{32,}={0,2}(?![A-Za-z0-9_~+/-])/g, redactHighEntropyToken],
  [/\/Users\/[^/\s]+\//g, '~/'],
  [/[A-Za-z]:\\Users\\[^\\\s]+\\/gi, '~\\'],
];

export function redact(value: string, maxLength = 20_000): string {
  let result = value;
  for (const [pattern, replacement] of replacements) {
    if (typeof replacement === 'string') {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, (match) => replacement(match));
    }
  }
  return result.slice(0, Math.max(0, maxLength));
}
