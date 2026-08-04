import type { ParagraphType } from "./fdx";

const placeholders: Record<ParagraphType, string> = {
  "scene-heading": "INT. LOCATION — DAY",
  action: "Describe what happens…",
  character: "CHARACTER",
  dialogue: "Write dialogue…",
  parenthetical: "(quietly)",
  transition: "CUT TO:",
  shot: "CLOSE ON:",
  general: "Write…",
};

export const paragraphPlaceholder = (type: ParagraphType, isActive: boolean) =>
  isActive ? placeholders[type] : "";
