import { beforeEach, describe, expect, it } from "vitest";
import { loadPanelPreferences, savePanelPreferences } from "./panel_preferences";

describe("panel preferences", () => {
  beforeEach(() => localStorage.clear());

  it("uses a collapsed scene panel only as the compact-layout default", () => {
    expect(loadPanelPreferences(true)).toEqual({ scenesCollapsed: true, notesCollapsed: false });
    expect(loadPanelPreferences(false)).toEqual({ scenesCollapsed: false, notesCollapsed: false });
  });

  it("restores saved panel collapse state", () => {
    savePanelPreferences({ scenesCollapsed: false, notesCollapsed: true });

    expect(loadPanelPreferences(true)).toEqual({ scenesCollapsed: false, notesCollapsed: true });
  });
});
