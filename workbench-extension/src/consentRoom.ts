import type { CommandTarget } from './domain.js';

export interface ConsentRoomTarget {
  kind: CommandTarget['kind'];
  name?: string;
}

export interface WriteConsentPrompt {
  message: string;
  options: { modal: true; detail: string };
  action: string;
}

export interface ConsentReceiptCopy {
  title: string;
  body: string;
  enteredLabel: string;
  lookingLabel: string;
  enterAction: string;
  leaveAction: string;
  pendingBody: string;
}

export const consentNotices = {
  declined: 'You stayed outside the room.',
  stateOnly: 'This project has no files to change. It is notes only.',
  noWriteLane: 'No model lane on this seat can change files right now.',
} as const;

export function consentRoomName(target: ConsentRoomTarget): string {
  if (target.kind === 'general') return 'General Staff';
  const name = target.name?.trim();
  return name || 'this project';
}

export function writeConsentPrompt(roomName: string, laneName: string): WriteConsentPrompt {
  return {
    message: `About to change files in ${roomName}.`,
    options: {
      modal: true,
      detail: `${laneName} can change files in ${roomName}. After you enter, a receipt stays on the desk so you can see the grant.`,
    },
    action: `Enter ${roomName}`,
  };
}

export function consentReceiptCopy(roomName: string): ConsentReceiptCopy {
  return {
    title: `Inside ${roomName}`,
    body: `This seat can change files in ${roomName}.`,
    enteredLabel: 'Entered',
    lookingLabel: 'Look only',
    enterAction: `Enter ${roomName}`,
    leaveAction: 'Look only',
    pendingBody: `About to change files in ${roomName}.`,
  };
}

export function consentBlockedCopy(roomName: string): ConsentReceiptCopy {
  return {
    title: `Outside ${roomName}`,
    body: `No model lane on this seat can change files in ${roomName} right now.`,
    enteredLabel: 'Entered',
    lookingLabel: 'Look only',
    enterAction: `Enter ${roomName}`,
    leaveAction: 'Look only',
    pendingBody: `About to change files in ${roomName}.`,
  };
}

export function consentPromptHasSingleAction(prompt: WriteConsentPrompt): boolean {
  return Boolean(prompt.action) && !Array.isArray(prompt.action);
}
