import type { ScreenplayParagraph } from "./fdx";

const PAGE_CONTENT_HEIGHT = 860;

const charactersPerLine: Record<ScreenplayParagraph["type"], number> = {
  "scene-heading": 60,
  action: 60,
  character: 27,
  parenthetical: 28,
  dialogue: 38,
  transition: 60,
  shot: 60,
  general: 60,
};

const verticalSpace: Record<ScreenplayParagraph["type"], number> = {
  "scene-heading": 44,
  action: 16,
  character: 25,
  parenthetical: 0,
  dialogue: 16,
  transition: 48,
  shot: 16,
  general: 16,
};

const lineCount = (text: string, width: number) =>
  Math.max(
    1,
    text
      .split("\n")
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0),
  );

const estimatedHeight = (paragraph: ScreenplayParagraph) =>
  lineCount(paragraph.text, charactersPerLine[paragraph.type]) * 20 + verticalSpace[paragraph.type];

const unitsFor = (paragraphs: ScreenplayParagraph[]) => {
  const units: ScreenplayParagraph[][] = [];

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph.type === "character") {
      const dialogue: ScreenplayParagraph[] = [paragraph];
      while (["parenthetical", "dialogue"].includes(paragraphs[index + 1]?.type || "")) {
        dialogue.push(paragraphs[index + 1]);
        index += 1;
      }
      units.push(dialogue);
    } else {
      units.push([paragraph]);
    }
  }

  return units;
};

export const paginateScreenplay = (
  paragraphs: ScreenplayParagraph[],
  measuredHeights: Record<string, number> = {},
) => {
  const pages: ScreenplayParagraph[][] = [[]];
  let occupied = 0;

  for (const unit of unitsFor(paragraphs)) {
    const height = unit.reduce(
      (total, paragraph) => total + (measuredHeights[paragraph.id] || estimatedHeight(paragraph)),
      0,
    );

    if (pages.at(-1)!.length > 0 && occupied + height > PAGE_CONTENT_HEIGHT) {
      pages.push([]);
      occupied = 0;
    }

    pages.at(-1)!.push(...unit);
    occupied += height;
  }

  return pages;
};
