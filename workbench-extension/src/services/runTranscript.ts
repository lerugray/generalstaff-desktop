import type { ConversationMessage, RunEvent, TranscriptBlock } from '../domain.js';

/**
 * Whether an incoming Claude turn id should open a new assistant bubble (M3e).
 * Mutating this to always return false reverts to one bubble per run — tests must catch that.
 */
export function needsNewBubble(
  currentTurnId: string | undefined,
  nextTurnId: string | undefined,
  hasContent: boolean,
): boolean {
  return Boolean(nextTurnId && currentTurnId && nextTurnId !== currentTurnId && hasContent);
}

/**
 * Correlate a tool_result to its tool_use card by id (preferred) or last running tool.
 * Mutating this to "first tool card wins" breaks multi-tool turns — tests must catch that.
 */
export function findToolBlockForResult(
  blocks: TranscriptBlock[],
  toolUseId?: string,
): Extract<TranscriptBlock, { type: 'tool' }> | undefined {
  if (toolUseId) {
    const match = blocks.find((block) => block.type === 'tool' && block.id === toolUseId);
    return match && match.type === 'tool' ? match : undefined;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === 'tool' && block.status === 'running') return block;
  }
  return undefined;
}

export interface ReducedAssistantTurn {
  turnId?: string;
  text: string;
  blocks: TranscriptBlock[];
}

/**
 * Pure reducer: stream RunEvents → one assistant turn per Claude message id,
 * with tool cards correlated by tool_use_id. This is the bubble/correlation path
 * extension.ts must use (REVIEW MAJOR 1).
 */
export function reduceRunEventsToTurns(events: RunEvent[]): ReducedAssistantTurn[] {
  const turns: ReducedAssistantTurn[] = [];
  let current: ReducedAssistantTurn | undefined;

  const openTurn = (turnId?: string) => {
    const hasContent = Boolean(current && (current.blocks.length > 0 || current.text.trim()));
    if (!current || needsNewBubble(current.turnId, turnId, hasContent)) {
      current = { text: '', blocks: [] };
      if (turnId) current.turnId = turnId;
      turns.push(current);
    } else if (turnId && !current.turnId) {
      current.turnId = turnId;
    }
  };

  for (const event of events) {
    if (event.type === 'assistant-delta') {
      openTurn(event.turnId);
      const separator = current!.text && !current!.text.endsWith('\n') ? '' : '';
      current!.text += `${separator}${event.text}`;
      const last = current!.blocks[current!.blocks.length - 1];
      if (last?.type === 'text') {
        last.text += event.text;
      } else {
        current!.blocks.push({ type: 'text', text: event.text });
      }
      continue;
    }
    if (event.type === 'thinking') {
      openTurn(event.turnId);
      current!.blocks.push({ type: 'thinking', text: event.text });
      continue;
    }
    if (event.type === 'tool') {
      openTurn(event.turnId);
      current!.blocks.push({
        type: 'tool',
        ...(event.toolUseId ? { id: event.toolUseId } : {}),
        name: event.name ?? event.text,
        summary: event.summary ?? event.text,
        ...(event.detail ? { detail: event.detail } : {}),
        status: 'running',
      });
      continue;
    }
    if (event.type === 'tool-result') {
      if (!current) continue;
      const match = findToolBlockForResult(current.blocks, event.toolUseId);
      if (match) {
        match.status = event.ok ? 'ok' : 'error';
        match.resultPreview = event.preview;
        if (event.body !== undefined) match.result = event.body;
      }
    }
  }

  return turns;
}

/** Apply extracted decision prose to the FIRST text block only — never duplicate across blocks. */
export function applyDecisionTextToBlocks(
  blocks: TranscriptBlock[],
  finalText: string,
): TranscriptBlock[] {
  let seenText = false;
  const next: TranscriptBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'text') {
      next.push(block);
      continue;
    }
    if (seenText) continue;
    seenText = true;
    next.push({ type: 'text', text: finalText });
  }
  if (!seenText && finalText.trim()) {
    next.push({ type: 'text', text: finalText });
  }
  return next;
}

/**
 * Build the transcript handoff by EXCHANGE count, not raw message count.
 * One user turn + its following assistant bubbles = one exchange. A 7-bubble
 * M3e run therefore costs one slot, matching pre-M3e behaviour (REVIEW MAJOR 2).
 */
export function buildPriorContextTranscript(
  messages: ConversationMessage[],
  exchangeLimit = 6,
  charLimit = 30_000,
): string {
  const exchanges: ConversationMessage[][] = [];
  let current: ConversationMessage[] = [];

  for (const message of messages) {
    if (message.status === 'streaming') continue;
    const hasBody = Boolean(message.text.trim()) || Boolean(message.blocks?.length);
    if (!hasBody) continue;
    if (message.role === 'user') {
      if (current.length) exchanges.push(current);
      current = [message];
      continue;
    }
    if (!current.length) {
      current = [message];
    } else {
      current.push(message);
    }
  }
  if (current.length) exchanges.push(current);

  const kept = exchanges.slice(-exchangeLimit);
  const lines: string[] = [];
  for (const exchange of kept) {
    for (const message of exchange) {
      const label = message.role === 'user' ? 'Operator' : 'GeneralStaff';
      const text = message.text.trim()
        || message.blocks
          ?.filter((block): block is Extract<TranscriptBlock, { type: 'text' }> => block.type === 'text')
          .map((block) => block.text)
          .join('\n\n')
          .trim()
        || '';
      if (!text) continue;
      lines.push(`${label}: ${text}`);
    }
  }
  return lines.join('\n\n').slice(-charLimit);
}

/** Count exchanges in a transcript window (for tests). */
export function countExchanges(messages: ConversationMessage[]): number {
  let count = 0;
  let inExchange = false;
  for (const message of messages) {
    if (message.status === 'streaming') continue;
    const hasBody = Boolean(message.text.trim()) || Boolean(message.blocks?.length);
    if (!hasBody) continue;
    if (message.role === 'user') {
      count += 1;
      inExchange = true;
      continue;
    }
    if (!inExchange) {
      count += 1;
      inExchange = true;
    }
  }
  return count;
}
