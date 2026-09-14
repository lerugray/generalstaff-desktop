import * as vscode from 'vscode';
import type { Conversation } from './domain.js';
import { ConversationStore } from './services/conversations.js';
import { buildSessionsViewModel, type SessionListItem } from './services/sessionsModel.js';

export type SessionTreeNode =
  | { type: 'section'; id: string; label: string; collapsible: vscode.TreeItemCollapsibleState }
  | { type: 'project'; id: string; label: string }
  | { type: 'session'; item: SessionListItem };

export class SessionsNavProvider implements vscode.TreeDataProvider<SessionTreeNode> {
  private readonly emitter = new vscode.EventEmitter<SessionTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private filter = '';
  private projectNames = new Map<string, string>();

  constructor(private readonly store: ConversationStore) {}

  refresh(projectNames?: ReadonlyMap<string, string>): void {
    if (projectNames) this.projectNames = new Map(projectNames);
    this.emitter.fire();
  }

  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.emitter.fire();
  }

  getFilter(): string {
    return this.filter;
  }

  getTreeItem(element: SessionTreeNode): vscode.TreeItem {
    if (element.type === 'section') {
      const item = new vscode.TreeItem(element.label, element.collapsible);
      item.contextValue = 'sessionSection';
      item.id = element.id;
      return item;
    }
    if (element.type === 'project') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'sessionProject';
      item.id = `project:${element.id}`;
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    const session = element.item;
    const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
    item.id = `session:${session.id}`;
    item.description = `${session.relativeTime} · ${session.laneLabel}`;
    item.tooltip = `${session.title}\n${session.scopeLabel}\n${session.laneLabel}\n${session.relativeTime}`;
    item.contextValue = session.archived
      ? 'sessionArchived'
      : session.active
        ? 'sessionActive'
        : 'sessionIdle';
    item.iconPath = new vscode.ThemeIcon(
      session.archived ? 'archive' : session.active ? 'comment-discussion' : 'comment',
    );
    item.command = {
      command: 'generalstaff.openSession',
      title: 'Open session',
      arguments: [session.id],
    };
    return item;
  }

  getChildren(element?: SessionTreeNode): SessionTreeNode[] {
    const model = buildSessionsViewModel(
      this.store.all(),
      this.store.activeIds(),
      this.projectNames,
    );
    const match = (item: SessionListItem): boolean => {
      if (!this.filter) return true;
      const hay = `${item.title} ${item.scopeLabel} ${item.laneLabel}`.toLowerCase();
      return hay.includes(this.filter);
    };

    if (!element) {
      const roots: SessionTreeNode[] = [
        {
          type: 'section',
          id: 'orchestrator',
          label: 'Orchestrator',
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        },
        {
          type: 'section',
          id: 'projects',
          label: 'Projects',
          collapsible: vscode.TreeItemCollapsibleState.Expanded,
        },
      ];
      if (model.archived.some(match)) {
        roots.push({
          type: 'section',
          id: 'archived',
          label: 'Archived',
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        });
      }
      return roots;
    }

    if (element.type === 'section' && element.id === 'orchestrator') {
      return model.orchestrator.filter(match).map((item) => ({ type: 'session', item }));
    }
    if (element.type === 'section' && element.id === 'projects') {
      return model.projects
        .filter((project) => project.sessions.some(match))
        .map((project) => ({ type: 'project', id: project.projectId, label: project.projectName }));
    }
    if (element.type === 'section' && element.id === 'archived') {
      return model.archived.filter(match).map((item) => ({ type: 'session', item }));
    }
    if (element.type === 'project') {
      const project = model.projects.find((entry) => entry.projectId === element.id);
      return (project?.sessions ?? []).filter(match).map((item) => ({ type: 'session', item }));
    }
    return [];
  }
}

export function conversationScopeKey(conversation: Conversation): string {
  if (conversation.kind === 'orchestrator' || conversation.target.kind === 'general') return 'general';
  return `project:${conversation.target.projectId}`;
}
