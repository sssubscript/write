import { describe, expect, it } from "vitest";
import type { ScreenplayParagraph } from "./fdx";
import { paginateScreenplay } from "./pagination";

const paragraph = (id: string, type: ScreenplayParagraph["type"], text = "A short line.") => ({
  id,
  type,
  text,
});

describe("screenplay pagination", () => {
  it("starts a new page when the measured screenplay elements no longer fit", () => {
    const paragraphs = [
      paragraph("one", "action"),
      paragraph("two", "action"),
      paragraph("three", "action"),
    ];

    expect(paginateScreenplay(paragraphs, { one: 400, two: 400, three: 400 })).toEqual([
      paragraphs.slice(0, 2),
      paragraphs.slice(2),
    ]);
  });

  it("keeps a character and its dialogue together", () => {
    const paragraphs = [
      paragraph("action", "action"),
      paragraph("character", "character", "ADA"),
      paragraph("dialogue", "dialogue", "We need another page."),
    ];

    expect(paginateScreenplay(paragraphs, { action: 800, character: 40, dialogue: 80 })).toEqual([
      [paragraphs[0]],
      paragraphs.slice(1),
    ]);
  });
});
