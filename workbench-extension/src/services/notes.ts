import type * as vscode from 'vscode';

const storageKey = 'generalstaff.projectNotes.v1';

export class ProjectNoteStore {
  private notes: Record<string, string>;

  constructor(private readonly state: vscode.Memento) {
    this.notes = state.get<Record<string, string>>(storageKey, {});
  }

  all(): Record<string, string> {
    return { ...this.notes };
  }

  async save(projectId: string, text: string): Promise<void> {
    const normalized = text.replace(/\r\n/gu, '\n').slice(0, 10_000);
    if (normalized.trim()) this.notes[projectId] = normalized;
    else delete this.notes[projectId];
    await this.state.update(storageKey, this.notes);
  }
}
