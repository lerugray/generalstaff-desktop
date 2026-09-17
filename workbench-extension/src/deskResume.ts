export const interruptedAnswerNote = 'The desk closed before this answer finished.';

export function markInterruptedAnswer(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n${interruptedAnswerNote}` : interruptedAnswerNote;
}

export function hasVisibleConversation(conversation?: { messages?: readonly unknown[] }): boolean {
  return Boolean(conversation?.messages?.length);
}

export function deskBootCopy(returning: boolean): { title: string; detail: string } {
  if (returning) {
    return {
      title: 'Back at the desk',
      detail: 'Your conversation is still here.',
    };
  }
  return {
    title: 'Opening the desk',
    detail: 'Reading the fleet without interrupting active work…',
  };
}
