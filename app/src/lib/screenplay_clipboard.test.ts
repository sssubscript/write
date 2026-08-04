import { describe, expect, it } from "vitest";
import { formatScreenplayClipboardText } from "./screenplay_clipboard";

describe("formatScreenplayClipboardText", () => {
  it("preserves screenplay spacing when copying multiple elements", () => {
    expect(
      formatScreenplayClipboardText([
        { type: "action", text: "She enters." },
        { type: "character", text: "MARA" },
        { type: "dialogue", text: "Hello." },
      ]),
    ).toBe("She enters.\n\n                    MARA\n\n          Hello.");
  });
});
