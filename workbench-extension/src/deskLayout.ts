export interface LayoutHost {
  executeCommand(command: string): PromiseLike<unknown>;
  updateWorkbenchSetting(key: string, value: unknown): PromiseLike<void>;
  updateSetting?(section: string, key: string, value: unknown): PromiseLike<void>;
}

export const deskWorkbenchSettings: Readonly<Record<string, string | boolean>> = {
  'activityBar.location': 'hidden',
  'statusBar.visible': false,
  'editor.showTabs': 'none',
};

export const workshopWorkbenchSettings: Readonly<Record<string, string | boolean>> = {
  'activityBar.location': 'hidden',
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
  'workbench.view.explorer',
];

export function workshopButtonLabel(workshopOpen: boolean): 'Return to desk' | 'Open workshop' {
  return workshopOpen ? 'Return to desk' : 'Open workshop';
}

export function atticToolsAllowed(workshopOpen: boolean): boolean {
  return workshopOpen;
}

export const deskStayNotice = 'Stay at the desk. Open workshop when you want the file and terminal tools.';

export const returnToDeskStatusText = 'Return to desk';

export const leftoverDeskSettings: ReadonlyArray<{
  section: string;
  key: string;
  value: string | number | boolean;
}> = [
  { section: 'breadcrumbs', key: 'enabled', value: false },
  { section: 'window', key: 'menuBarVisibility', value: 'hidden' },
  { section: 'window', key: 'commandCenter', value: false },
  { section: 'terminal.integrated', key: 'hideOnStartup', value: 'always' },
  { section: 'explorer', key: 'autoReveal', value: false },
  { section: 'explorer', key: 'openEditors.visible', value: 0 },
  { section: 'workbench.editor', key: 'empty.hint', value: 'hidden' },
  { section: 'workbench.layoutControl', key: 'enabled', value: false },
  { section: 'workbench.navigationControl', key: 'enabled', value: false },
];

export const leftoverDeskWorkspaceSettings: Readonly<Record<string, string | number | boolean>> = {
  'breadcrumbs.enabled': false,
  'window.menuBarVisibility': 'hidden',
  'window.commandCenter': false,
  'terminal.integrated.hideOnStartup': 'always',
  'explorer.autoReveal': false,
  'explorer.openEditors.visible': 0,
  'workbench.editor.empty.hint': 'hidden',
  'workbench.layoutControl.enabled': false,
  'workbench.navigationControl.enabled': false,
};

export const workshopPlaqueCopy = {
  title: 'Workshop',
  detail: 'Files and the supporting terminal live in this room. Return to desk when you want the quiet conversation back.',
};

export const deskGuardKeybindings: ReadonlyArray<{
  key: string;
  mac: string;
  command: string;
  when: string;
}> = [
  { key: 'ctrl+b', mac: 'cmd+b', command: 'generalstaff.returnToDesk', when: 'generalstaff.deskActive' },
  { key: 'ctrl+j', mac: 'cmd+j', command: 'generalstaff.returnToDesk', when: 'generalstaff.deskActive' },
  { key: 'ctrl+`', mac: 'ctrl+`', command: 'generalstaff.returnToDesk', when: 'generalstaff.deskActive' },
  { key: 'ctrl+shift+e', mac: 'cmd+shift+e', command: 'generalstaff.returnToDesk', when: 'generalstaff.deskActive' },
];

async function applyLeftoverDeskSettings(host: LayoutHost): Promise<void> {
  if (!host.updateSetting) return;
  for (const setting of leftoverDeskSettings) {
    try {
      await host.updateSetting(setting.section, setting.key, setting.value);
    } catch {
      // Isolated hosts can reject a setting write; chrome commands still hide the attic.
    }
  }
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
  await applyLeftoverDeskSettings(host);
  await executeAll(host, deskChromeCommands);
  if (options.closeOtherEditors) {
    await executeAll(host, deskEditorCommands);
  }
}

export async function applyWorkshopLayout(host: LayoutHost): Promise<void> {
  await applySettings(host, workshopWorkbenchSettings);
  await executeFirstAvailable(host, workshopChromeCommands);
}
