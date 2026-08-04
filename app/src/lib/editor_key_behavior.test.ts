import { describe, expect, it } from "vitest";
import {
  deleteAtSelection,
  insertLineBreak,
  insertsLineBreak,
  mergeWithNextElement,
} from "./editor_key_behavior";

describe("editor key behavior", () => {
  it("deletes the next character without moving the caret", () => {
    expect(deleteAtSelection("ACTION", 2, 2)).toEqual({ text: "ACION", caret: 2 });
    expect(deleteAtSelection("ACTION", 1, 4)).toEqual({ text: "AON", caret: 1 });
  });

  it("merges the next element when Delete is at a paragraph end", () => {
    expect(deleteAtSelection("ACTION", 6, 6)).toBeNull();
    expect(mergeWithNextElement("ACTION", "CONTINUED")).toEqual({
      text: "ACTIONCONTINUED",
      caret: 6,
    });
  });

  it("uses a line break for Enter in the middle of text or Shift+Enter", () => {
    expect(insertsLineBreak(3, 3, 6, false)).toBe(true);
    expect(insertsLineBreak(6, 6, 6, false)).toBe(false);
    expect(insertsLineBreak(6, 6, 6, true)).toBe(true);
    expect(insertLineBreak("ACTION", 3, 3)).toEqual({ text: "ACT\nION", caret: 4 });
  });
});
