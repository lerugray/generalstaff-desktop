import * as crypto from 'node:crypto';
import type { ConversationDecision, DecisionOption } from '../domain.js';

const decisionPattern = /<gs-decision>\s*([\s\S]{1,8000}?)\s*<\/gs-decision>/gu;

export interface DecisionDraft {
  title: string;
  question: string;
  options: Array<Omit<DecisionOption, 'id'>>;
}

export interface DecisionExtraction {
  text: string;
  decisions: ConversationDecision[];
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function parseDraft(value: unknown): DecisionDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const title = shortText(record.title, 120);
  const question = shortText(record.question, 600);
  if (!title || !question || !Array.isArray(record.options) || record.options.length < 2 || record.options.length > 4) {
    return undefined;
  }

  const options: DecisionDraft['options'] = [];
  const labels = new Set<string>();
  for (const candidate of record.options) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined;
    const optionRecord = candidate as Record<string, unknown>;
    const label = shortText(optionRecord.label, 100);
    const description = optionRecord.description === undefined
      ? undefined
      : shortText(optionRecord.description, 280);
    if (!label || (optionRecord.description !== undefined && !description)) return undefined;
    const normalizedLabel = label.toLocaleLowerCase();
    if (labels.has(normalizedLabel)) return undefined;
    labels.add(normalizedLabel);
    options.push({ label, ...(description ? { description } : {}) });
  }
  return { title, question, options };
}

export function extractDecisionCards(
  source: string,
  messageId: string,
  now = Date.now(),
  idFactory: () => string = crypto.randomUUID,
): DecisionExtraction {
  const decisions: ConversationDecision[] = [];
  let text = '';
  let cursor = 0;

  for (const match of source.matchAll(decisionPattern)) {
    if (decisions.length >= 3 || match.index === undefined) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }
    const draft = parseDraft(parsed);
    if (!draft) continue;
    text += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    decisions.push({
      id: idFactory(),
      messageId,
      title: draft.title,
      question: draft.question,
      options: draft.options.map((option) => ({ id: idFactory(), ...option })),
      createdAt: now,
    });
  }

  if (!decisions.length) return { text: source, decisions: [] };
  text += source.slice(cursor);
  return { text: text.replace(/\n{3,}/gu, '\n\n').trim(), decisions };
}
