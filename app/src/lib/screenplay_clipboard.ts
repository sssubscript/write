import type { ParagraphType } from "./fdx";

export type ClipboardParagraph = { type: ParagraphType; text: string };

const indentation: Partial<Record<ParagraphType, string>> = {
  character: "                    ",
  dialogue: "          ",
  parenthetical: "               ",
};

export const formatScreenplayClipboardText = (paragraphs: ClipboardParagraph[]) =>
  paragraphs
    .map((paragraph) => `${indentation[paragraph.type] || ""}${paragraph.text}`)
    .join("\n\n");
