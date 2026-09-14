import type { LaneId } from '../domain.js';
import { OLLAMA_CLOUD_CONTEXT_TOKENS } from './ollamaCloud.js';

/**
 * Provenance of a seat's context ceiling (M3c).
 *
 * - `stated` — the launcher sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (CC-door) or the Workbench
 *   states the window for a direct Ollama seat.
 * - `native` — an Anthropic model whose window Claude Code already knows (per model — not one
 *   constant for the whole Claude family).
 * - `assumed-default` — Claude Code does not recognise the model and nothing states a ceiling;
 *   the CLI will compact at 200k.
 * - `unknown` — not a Claude Code seat; show a documented window if the repo records one, else none.
 */
export type ContextCeilingProvenance = 'stated' | 'native' | 'assumed-default' | 'unknown';

export type ClaudeNativeModelFamily = 'fable' | 'sonnet' | 'opus' | 'haiku';

export interface ContextCeiling {
  /** Absolute token ceiling, or null when the window is not recorded. */
  tokens: number | null;
  provenance: ContextCeilingProvenance;
  /** Short model/door label for picker copy (e.g. deepseek-v4.1-flash, fable, sonnet). */
  modelLabel: string;
  /**
   * Optional qualifier appended inside the native provenance paren, e.g. Opus
   * `1M on Max tiers` → `opus · 1M context (native, 1M on Max tiers)`.
   */
  provenanceNote?: string;
}

/**
 * Claude Code's assumed default for any model name it does not recognise.
 * Source: operator observation + Workbench README/CHANGELOG (2026-09-13); Claude Code
 * silently treats unrecognised models as 200k unless `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is set.
 */
export const CLAUDE_CODE_ASSUMED_DEFAULT_TOKENS = 200_000;

/**
 * Native 1M window for Sonnet 5 and the Fable models.
 *
 * Claude Code model-config ("Extended context", https://code.claude.com/docs/en/model-config.md):
 *   "On models with a native 1M window, such as Sonnet 5 and the Fable models, …"
 *   "On the Anthropic API, Sonnet 5 always runs with the 1M context window. There is no 200K
 *    variant, no `[1m]` suffix to select, and no usage credits required on any plan."
 *   Availability note: "On the Anthropic API, Fable 5.1, Fable 5, Sonnet 5, and Opus 4.7 and
 *    later run with the 1M window by default."
 */
export const CLAUDE_NATIVE_1M_TOKENS = 1_000_000;

/**
 * Haiku's native window remains 200k (not listed among the native-1M models in Extended context).
 */
export const CLAUDE_NATIVE_HAIKU_TOKENS = 200_000;

/**
 * Opus 1M is plan-conditional on subscription tiers.
 *
 * Claude Code model-config § Extended context
 * (https://code.claude.com/docs/en/model-config.md):
 *   "On Max, Team, and Enterprise plans, including both Team Standard and Team Premium seats,
 *    Opus is automatically upgraded to 1M context with no additional configuration."
 * This operator is on Max 20x, so the Workbench records Opus as 1M native with the qualifier
 * `1M on Max tiers`. Pro still needs usage credits for Opus 1M per that same table.
 */
export const CLAUDE_NATIVE_OPUS_TOKENS = CLAUDE_NATIVE_1M_TOKENS;
export const CLAUDE_OPUS_MAX_TIER_NOTE = '1M on Max tiers';

/**
 * Token count the CC-door launcher injects via `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.
 * One source of truth with `scripts/gsd-cc-door.sh` (exports `1048576`) — Ollama Cloud's
 * real /api/show window (FIXLIST-R3 CODE 6). Direct Ollama seats use the same
 * `OLLAMA_CLOUD_CONTEXT_TOKENS` (1_048_576); CC-door seats divide by this constant so
 * the meter matches the process env.
 */
export const CC_DOOR_STATED_CONTEXT_TOKENS = 1_048_576;

/** Per-model native Claude Code ceilings (Claude 5 family + Haiku). */
export function nativeContextCeilingFor(family: ClaudeNativeModelFamily): ContextCeiling {
  switch (family) {
    case 'fable':
      return { tokens: CLAUDE_NATIVE_1M_TOKENS, provenance: 'native', modelLabel: 'fable' };
    case 'sonnet':
      return { tokens: CLAUDE_NATIVE_1M_TOKENS, provenance: 'native', modelLabel: 'sonnet' };
    case 'opus':
      return {
        tokens: CLAUDE_NATIVE_OPUS_TOKENS,
        provenance: 'native',
        modelLabel: 'opus',
        provenanceNote: CLAUDE_OPUS_MAX_TIER_NOTE,
      };
    case 'haiku':
      return { tokens: CLAUDE_NATIVE_HAIKU_TOKENS, provenance: 'native', modelLabel: 'haiku' };
  }
}

/**
 * Single source of truth: every Workbench lane id has a ceiling + provenance.
 * Values are attached to `LaneSummary` at discovery time — never computed in the webview.
 */
export const CONTEXT_CEILING_BY_LANE: Record<LaneId, ContextCeiling> = {
  codex: {
    tokens: null,
    provenance: 'unknown',
    modelLabel: 'gpt-5.6-sol',
  },
  claude: {
    // Claude Fable via the Claude CLI (`--model fable`). Cursor-runner fallback is still this
    // lane id in discovery; the ceiling remains Fable's Anthropic-native 1M window (the Cursor
    // door does not stream Claude usage — the UI shows ceiling only).
    ...nativeContextCeilingFor('fable'),
  },
  kimi: {
    tokens: null,
    provenance: 'unknown',
    modelLabel: 'kimi-k3',
  },
  cline: {
    tokens: null,
    provenance: 'unknown',
    modelLabel: 'glm-5.3 via cline',
  },
  cursor: {
    tokens: null,
    provenance: 'unknown',
    modelLabel: 'cursor-auto',
  },
  grok: {
    tokens: null,
    provenance: 'unknown',
    modelLabel: 'grok-4.6',
  },
  'glm-ollama': {
    tokens: OLLAMA_CLOUD_CONTEXT_TOKENS,
    provenance: 'stated',
    modelLabel: 'glm-5.3',
  },
  'glm-ollama-flash': {
    tokens: OLLAMA_CLOUD_CONTEXT_TOKENS,
    provenance: 'stated',
    modelLabel: 'glm-5.3-flash',
  },
  'deepseek-ollama': {
    tokens: OLLAMA_CLOUD_CONTEXT_TOKENS,
    provenance: 'stated',
    modelLabel: 'deepseek-v4.1-flash',
  },
  'deepseek-ollama-cc': {
    // gsd-cc-door.sh sets CLAUDE_CODE_MAX_CONTEXT_TOKENS before exec'ing claude.
    tokens: CC_DOOR_STATED_CONTEXT_TOKENS,
    provenance: 'stated',
    modelLabel: 'deepseek-v4.1-flash',
  },
  'glm-ollama-cc': {
    tokens: CC_DOOR_STATED_CONTEXT_TOKENS,
    provenance: 'stated',
    modelLabel: 'glm-5.3',
  },
};

export function contextCeilingFor(laneId: LaneId): ContextCeiling {
  return CONTEXT_CEILING_BY_LANE[laneId];
}

/** Compact token label: 1048576 → "1.05M", 1000000 → "1M", 200000 → "200k". */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0';
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    const rounded = Math.round(millions * 100) / 100;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/u, '');
    return `${text}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    const rounded = Math.round(thousands * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
    return `${text}k`;
  }
  return String(Math.round(tokens));
}

/**
 * Plain-words ceiling for the seat picker / lane cards.
 * Examples:
 *   `deepseek-v4.1-flash · 1M context (stated by launcher)`
 *   `fable · 1M context (native)`
 *   `opus · 1M context (native, 1M on Max tiers)`
 *   `glm-5.3 via cline · context unknown`
 */
export function formatContextCeilingLabel(ceiling: ContextCeiling): string {
  const { modelLabel, tokens, provenance, provenanceNote } = ceiling;
  if (tokens == null) {
    return `${modelLabel} · context unknown`;
  }
  const amount = formatTokenCount(tokens);
  if (provenance === 'stated') {
    return `${modelLabel} · ${amount} context (stated by launcher)`;
  }
  if (provenance === 'assumed-default') {
    return `${modelLabel} · ${amount} context (CLI default)`;
  }
  if (provenance === 'unknown') {
    return `${modelLabel} · ${amount} context`;
  }
  // native
  const note = provenanceNote ? `, ${provenanceNote}` : '';
  return `${modelLabel} · ${amount} context (native${note})`;
}

export const ASSUMED_DEFAULT_WARNING =
  'Claude Code will compact at 200k unless the launcher states the window.';

export function contextCeilingWarns(ceiling: ContextCeiling): boolean {
  return ceiling.provenance === 'assumed-default';
}

/** Used / ceiling copy for the live meter. Never invents a used count. */
export function formatContextUsageMeter(
  ceiling: ContextCeiling,
  usedTokens: number | null | undefined,
): { label: string; percent: number | null; warn: boolean } {
  const warn = contextCeilingWarns(ceiling);
  if (ceiling.tokens == null) {
    return { label: 'context unknown', percent: null, warn };
  }
  const ceilingLabel = formatTokenCount(ceiling.tokens);
  if (usedTokens == null || !Number.isFinite(usedTokens) || usedTokens < 0) {
    return { label: `${ceilingLabel} ceiling only`, percent: null, warn };
  }
  const percent = Math.min(100, Math.max(0, Math.round((usedTokens / ceiling.tokens) * 100)));
  return {
    label: `${formatTokenCount(usedTokens)} / ${ceilingLabel} (${percent}%)`,
    percent,
    warn,
  };
}

/**
 * Best-effort map from a detached Lanes model/door string onto a Workbench lane ceiling.
 * Detached runs are not Command seats — when the door is unrecognised, return unknown.
 */
export function contextCeilingFromModelDoor(modelDoor: string): ContextCeiling {
  const text = modelDoor.toLowerCase();
  if (text.includes('deepseek') && (text.includes('cc') || text.includes('ollama-deepseek') || text.includes('claude'))) {
    return CONTEXT_CEILING_BY_LANE['deepseek-ollama-cc'];
  }
  if (text.includes('deepseek')) {
    return CONTEXT_CEILING_BY_LANE['deepseek-ollama'];
  }
  if ((text.includes('glm-5.3') || text.includes('glm 5.3') || /\bglm\b/u.test(text))
    && (text.includes('cc') || text.includes('ollama-glm') || text.includes('claude'))) {
    return CONTEXT_CEILING_BY_LANE['glm-ollama-cc'];
  }
  if (text.includes('glm-5.3-flash') || text.includes('glm-ollama-flash')) {
    return CONTEXT_CEILING_BY_LANE['glm-ollama-flash'];
  }
  if (text.includes('glm')) {
    return CONTEXT_CEILING_BY_LANE['glm-ollama'];
  }
  if (text.includes('fable')) {
    return nativeContextCeilingFor('fable');
  }
  if (text.includes('sonnet')) {
    return nativeContextCeilingFor('sonnet');
  }
  if (text.includes('opus')) {
    return nativeContextCeilingFor('opus');
  }
  if (text.includes('haiku')) {
    return nativeContextCeilingFor('haiku');
  }
  if (text.includes('claude')) {
    return CONTEXT_CEILING_BY_LANE.claude;
  }
  if (text.includes('codex') || text.includes('gpt')) {
    return CONTEXT_CEILING_BY_LANE.codex;
  }
  if (text.includes('kimi')) return CONTEXT_CEILING_BY_LANE.kimi;
  if (text.includes('cline')) return CONTEXT_CEILING_BY_LANE.cline;
  if (text.includes('grok')) return CONTEXT_CEILING_BY_LANE.grok;
  if (text.includes('cursor') || text.includes('composer')) {
    return CONTEXT_CEILING_BY_LANE.cursor;
  }
  return { tokens: null, provenance: 'unknown', modelLabel: modelDoor.trim() || 'model' };
}
