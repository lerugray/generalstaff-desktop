export interface LayoutHost {
  executeCommand(command: string): PromiseLike<unknown>;
  updateWorkbenchSetting(key: string, value: unknown): PromiseLike<void>;
}

export const deskWorkbenchSettings: Readonly<Record<string, string | boolean>> = {
  'activityBar.location': 'hidden',
  'statusBar.visible': false,
  'editor.showTabs': 'none',
};

export const workshopWorkbenchSettings: Readonly<Record<string, string | boolean>> = {
  'activityBar.location': 'default',
  'statusBar.visible': true,
  'editor.showTabs': 'multiple',
};

export const deskChromeCommands: readonly string[] = [
  'workbench.action.closeSidebar',
  'workbench.action.closeAuxiliaryBar',
  'workbench.action.closePanel',
  'workbench.action.activityBarLocation.hide',
];

export const deskEditorCommands: readonly string[] = [
  'workbench.action.closeOtherEditors',
];

export const workshopChromeCommands: readonly string[] = [
  'workbench.action.activityBarLocation.side',
  'workbench.action.activityBarLocation.default',
];

export function workshopButtonLabel(workshopOpen: boolean): 'Return to desk' | 'Open workshop' {
  return workshopOpen ? 'Return to desk' : 'Open workshop';
}

async function applySettings(
  host: LayoutHost,
  settings: Readonly<Record<string, string | boolean>>,
): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    try {
      await host.updateWorkbenchSetting(key, value);
    } catch {
      // Isolated hosts can reject a setting write; commands still hide the chrome.
    }
  }
}

async function executeAll(host: LayoutHost, commands: readonly string[]): Promise<void> {
  for (const command of commands) {
    try {
      await host.executeCommand(command);
    } catch {
      // Older VS Code builds omit some layout commands. Continue the rest.
    }
  }
}

async function executeFirstAvailable(host: LayoutHost, commands: readonly string[]): Promise<void> {
  for (const command of commands) {
    try {
      await host.executeCommand(command);
      return;
    } catch {
      // Try the next equivalent command.
    }
  }
}

export async function applyDeskLayout(
  host: LayoutHost,
  options: { closeOtherEditors?: boolean } = {},
): Promise<void> {
  await applySettings(host, deskWorkbenchSettings);
  await executeAll(host, deskChromeCommands);
  if (options.closeOtherEditors) {
    await executeAll(host, deskEditorCommands);
  }
}

export async function applyWorkshopLayout(host: LayoutHost): Promise<void> {
  await applySettings(host, workshopWorkbenchSettings);
  await executeFirstAvailable(host, workshopChromeCommands);
}
