import type { RunEvent } from '../domain.js';
import { isOllamaCloudLaneId } from '../services/ollamaCloud.js';
import { runCliAdapter, type ActiveRun, type RunRequest } from './cliAdapter.js';
import { runOllamaCloudAdapter } from './ollamaCloudAdapter.js';

export function runAdapter(request: RunRequest, onEvent: (event: RunEvent) => void): ActiveRun {
  return isOllamaCloudLaneId(request.lane.id)
    ? runOllamaCloudAdapter(request, onEvent)
    : runCliAdapter(request, onEvent);
}
