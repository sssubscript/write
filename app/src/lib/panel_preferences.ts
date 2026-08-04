const storageKey = "subscript.editor.panel-preferences.v1";

export type PanelPreferences = {
  scenesCollapsed: boolean;
  notesCollapsed: boolean;
};

export const loadPanelPreferences = (compactLayout: boolean): PanelPreferences => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(storageKey) || "null",
    ) as Partial<PanelPreferences> | null;
    if (
      stored &&
      typeof stored.scenesCollapsed === "boolean" &&
      typeof stored.notesCollapsed === "boolean"
    ) {
      return { scenesCollapsed: stored.scenesCollapsed, notesCollapsed: stored.notesCollapsed };
    }
  } catch {
    return { scenesCollapsed: compactLayout, notesCollapsed: false };
  }
  return { scenesCollapsed: compactLayout, notesCollapsed: false };
};

export const savePanelPreferences = (preferences: PanelPreferences) => {
  localStorage.setItem(storageKey, JSON.stringify(preferences));
};
