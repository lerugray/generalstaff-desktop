import type { LaneId } from '../domain.js';
import { OLLAMA_CLOUD_CONTEXT_TOKENS } from './ollamaCloud.js';

/**
 * Provenance of a seat's context ceiling (M3c).
 *
 * - `stated` — the launcher sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (CC-door) or the Workbench
 *   states the window for a direct Ollama seat.
 * - `native` — an Anthropic model whose window Claude Code already knows.
 * - `assumed-default` — Claude Code does not recognise the model and nothing states a ceiling;
 *   the CLI will compact at 200k.
 * - `unknown` — not a Claude Code seat; show a documented window if the repo records one, else none.
 */
export type ContextCeilingProvenance = 'stated' | 'native' | 'assumed-default' | 'unknown';

export interface ContextCeiling {
  /** Absolute token ceiling, or null when the window is not recorded. */
  tokens: number | null;
  provenance: ContextCeilingProvenance;
  /** Short model/door label for picker copy (e.g. deepseek-v4.1-flash, fable, sonnet). */
  modelLabel: string;
}

/**
 * Claude Code's assumed default for any model name it does not recognise.
 * Source: operator observation + Workbench README/CHANGELOG (2026-09-13); Claude Code
 * silently treats unrecognised models as 200k unless `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is set.
 */
export const CLAUDE_CODE_ASSUMED_DEFAULT_TOKENS = 200_000;

/**
 * Native Anthropic Claude context window used by Claude Code for recognised Anthropic models
 * (including the Fable seat's `--model fable`). Source: Anthropic Claude / Claude Code default
 * context window for standard Claude models; the CLI does not require an env override for these.
 */
export const ANTHROPIC_NATIVE_CONTEXT_TOKENS = 200_000;

/**
 * Token count the CC-door launcher injects via `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.
 * The handoff names `1000000`; the Workbench already carries the verified Ollama
 * `context_length` (`OLLAMA_CLOUD_CONTEXT_TOKENS` = 1_048_576 from /api/show, 2026-09-13)
 * and states that window on every Ollama seat. Ceiling display uses that constant so the
 * picker matches the real model window the launcher is protecting.
 */
export const CC_DOOR_STATED_CONTEXT_TOKENS = OLLAMA_CLOUD_CONTEXT_TOKENS;

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
    // lane id in discovery; the ceiling remains Fable's Anthropic-native window (the Cursor
    // door does not stream Claude usage — the UI shows ceiling only).
    tokens: ANTHROPIC_NATIVE_CONTEXT_TOKENS,
    provenance: 'native',
    modelLabel: 'fable',
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
 *   `deepseek-v4.1-flash · 1.05M context (stated by launcher)`
 *   `fable · 200k context`
 *   `glm-5.3 via cline · context unknown`
 */
export function formatContextCeilingLabel(ceiling: ContextCeiling): string {
  const { modelLabel, tokens, provenance } = ceiling;
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
  return `${modelLabel} · ${amount} context`;
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
  if (text.includes('fable') || text.includes('claude')) {
    return CONTEXT_CEILING_BY_LANE.claude;
  }
  if (text.includes('sonnet') || text.includes('opus') || text.includes('haiku')) {
    return {
      tokens: ANTHROPIC_NATIVE_CONTEXT_TOKENS,
      provenance: 'native',
      modelLabel: text.includes('opus') ? 'opus' : text.includes('haiku') ? 'haiku' : 'sonnet',
    };
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
