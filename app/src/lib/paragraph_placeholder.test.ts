import { describe, expect, it } from "vitest";
import { paragraphPlaceholder } from "./paragraph_placeholder";

describe("paragraphPlaceholder", () => {
  it("shows the action prompt only on the final action row", () => {
    expect(paragraphPlaceholder("action", false)).toBe("");
    expect(paragraphPlaceholder("action", false)).toBe("");
    expect(paragraphPlaceholder("action", true)).toBe("Describe what happens…");
  });

  it("keeps screenplay prompts for other element types", () => {
    expect(paragraphPlaceholder("dialogue", true)).toBe("Write dialogue…");
  });
});
