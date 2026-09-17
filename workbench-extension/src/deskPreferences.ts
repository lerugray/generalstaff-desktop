export const deskPreferenceKey = 'generalstaff.deskPreferences.v1';

export const workbenchThemeIds = ['paper', 'night', 'linen', 'vellum', 'iron', 'carbon'] as const;

export type WorkbenchThemeId = (typeof workbenchThemeIds)[number];

export const defaultThemeId: WorkbenchThemeId = 'carbon';

const themeIdSet = new Set<string>(workbenchThemeIds);

export interface DeskPreferences {
  selectedTheme: WorkbenchThemeId;
  composerDraft: string;
}

export interface PreferenceStore {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export function isThemeId(value: unknown): value is WorkbenchThemeId {
  return typeof value === 'string' && themeIdSet.has(value);
}

export function restoreThemeId(value: unknown): WorkbenchThemeId {
  return isThemeId(value) ? value : defaultThemeId;
}

export function restoreComposerDraft(value: unknown): string {
  return typeof value === 'string' && value.length <= 80_000 ? value : '';
}

export function readDeskPreferences(state: Pick<PreferenceStore, 'get'>): DeskPreferences {
  const stored = state.get<Partial<DeskPreferences>>(deskPreferenceKey, {});
  return {
    selectedTheme: restoreThemeId(stored?.selectedTheme),
    composerDraft: restoreComposerDraft(stored?.composerDraft),
  };
}

export async function writeDeskPreferences(
  state: PreferenceStore,
  patch: Partial<DeskPreferences>,
): Promise<DeskPreferences> {
  const current = readDeskPreferences(state);
  const next: DeskPreferences = {
    selectedTheme: patch.selectedTheme !== undefined ? restoreThemeId(patch.selectedTheme) : current.selectedTheme,
    composerDraft: patch.composerDraft !== undefined ? restoreComposerDraft(patch.composerDraft) : current.composerDraft,
  };
  await state.update(deskPreferenceKey, next);
  return next;
}
