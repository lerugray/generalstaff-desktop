import type { ConversationReceipt, RunEvent } from '../domain.js';
import { redact } from '../security/redaction.js';
import {
  OLLAMA_CLOUD_CHAT_URL,
  isOllamaCloudLaneId,
  loadOllamaCloudApiKey,
  ollamaCloudModelFor,
  type FetchLike,
} from '../services/ollamaCloud.js';
import {
  effortLabel,
  promptForSeat,
  type ActiveRun,
  type RunCompletion,
  type RunRequest,
} from './cliAdapter.js';

export interface OllamaCloudAdapterOptions {
  fetcher?: FetchLike;
  loadApiKey?: () => Promise<string | undefined>;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return [];
    const candidate = (part as Record<string, unknown>).text;
    return typeof candidate === 'string' ? [candidate] : [];
  }).join('');
  return text.trim() ? text : undefined;
}

export function answerFromOllamaChatCompletion(payload: unknown): { answer: string; model?: string } | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.choices)) return undefined;
  const choice = record.choices[0];
  if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) return undefined;
  const message = (choice as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  // Ollama may return private reasoning in message.thinking. Only the answer in
  // message.content is operator-visible or retained as transcript evidence.
  const answer = contentText((message as Record<string, unknown>).content);
  if (!answer) return undefined;
  const model = typeof record.model === 'string' && record.model.trim() ? record.model.trim() : undefined;
  return { answer, ...(model ? { model } : {}) };
}

export function runOllamaCloudAdapter(
  request: RunRequest,
  onEvent: (event: RunEvent) => void,
  options: OllamaCloudAdapterOptions = {},
): ActiveRun {
  if (!isOllamaCloudLaneId(request.lane.id)) {
    throw new Error(`${request.lane.name} is not an Ollama Cloud lane.`);
  }
  if (request.permission !== 'read') {
    throw new Error(`${request.lane.name} is a read-only direct API lane.`);
  }

  const model = ollamaCloudModelFor(request.lane.id);
  const fetcher = options.fetcher ?? fetch;
  const loadApiKey = options.loadApiKey ?? loadOllamaCloudApiKey;
  const controller = new AbortController();
  const startedAt = Date.now();
  const evidence: string[] = [];
  let stopped = false;
  onEvent({ type: 'status', text: `Starting ${request.lane.name}` });

  const completed = (async (): Promise<RunCompletion> => {
    let exitCode: number | null = 1;
    let observedModel: string | undefined;
    try {
      const apiKey = await loadApiKey();
      if (!apiKey) throw new Error('OLLAMA_CLOUD_API_KEY is missing from ~/.generalstaff/.env.');
      if (stopped) throw new DOMException('Stopped', 'AbortError');
      const response = await fetcher(OLLAMA_CLOUD_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: promptForSeat(request.seat, request.permission, request.prompt) }],
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      });
      evidence.push(`http: ${response.status}`, `model: ${model}`);
      if (!response.ok) throw new Error(`${request.lane.name} returned HTTP ${response.status}.`);
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
        throw new Error(`${request.lane.name} returned an oversized response.`);
      }
      const body = await response.text();
      if (body.length > 2 * 1024 * 1024) throw new Error(`${request.lane.name} returned an oversized response.`);
      const completion = answerFromOllamaChatCompletion(JSON.parse(body) as unknown);
      if (!completion) throw new Error(`${request.lane.name} completed without answer content.`);
      observedModel = completion.model;
      onEvent({ type: 'assistant-delta', text: redact(completion.answer) });
      exitCode = 0;
    } catch (error) {
      if (stopped || (error instanceof DOMException && error.name === 'AbortError')) {
        stopped = true;
        exitCode = null;
      } else {
        const message = redact(error instanceof Error ? error.message : `${request.lane.name} could not complete the request.`);
        onEvent({ type: 'error', text: message });
        evidence.push(`error: ${message}`);
      }
    }

    const receipt: ConversationReceipt = {
      laneId: request.lane.id,
      laneName: request.lane.name,
      seat: request.seat,
      target: request.target,
      modelLabel: `${observedModel ?? model} · ${effortLabel(request.effort)}`,
      startedAt,
      finishedAt: Date.now(),
      exitCode,
      stopped,
      permission: request.permission,
      effort: request.effort,
      workingDirectory: redact(request.cwd),
      evidence,
      continuity: request.continuity,
    };
    onEvent({ type: 'complete', receipt });
    return { receipt };
  })();

  return {
    stop() {
      stopped = true;
      controller.abort();
    },
    completed,
  };
}
