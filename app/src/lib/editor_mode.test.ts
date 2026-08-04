import { describe, expect, it } from "vitest";
import { editorModes } from "./editor_mode";

describe("editor modes", () => {
  it("keeps writing and annotation controls as distinct modes", () => {
    expect(editorModes.write.toolbarLabel).toBe("Writing tools");
    expect(editorModes.annotate.toolbarLabel).toBe("Annotation tools");
  });
});
