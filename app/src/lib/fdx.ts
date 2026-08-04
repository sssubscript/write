export type ParagraphType =
  | "scene-heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "shot"
  | "general";

export type ScreenplayParagraph = {
  id: string;
  type: ParagraphType;
  text: string;
};

export const paragraphTypes: { value: ParagraphType; label: string }[] = [
  { value: "scene-heading", label: "Scene heading" },
  { value: "action", label: "Action" },
  { value: "character", label: "Character" },
  { value: "dialogue", label: "Dialogue" },
  { value: "parenthetical", label: "Parenthetical" },
  { value: "transition", label: "Transition" },
  { value: "shot", label: "Shot" },
  { value: "general", label: "General" },
];

const typeOrder = paragraphTypes.map(({ value }) => value);

export const nextParagraphType = (type: ParagraphType): ParagraphType => {
  switch (type) {
    case "scene-heading":
    case "transition":
    case "shot":
      return "action";
    case "character":
    case "parenthetical":
      return "dialogue";
    case "dialogue":
    case "general":
    case "action":
      return "action";
  }
};

export const cycleParagraphType = (type: ParagraphType): ParagraphType => {
  const index = typeOrder.indexOf(type);
  return typeOrder[(index + 1) % typeOrder.length];
};

const typeMap: Record<string, ParagraphType> = {
  "scene heading": "scene-heading",
  slugline: "scene-heading",
  action: "action",
  character: "character",
  parenthetical: "parenthetical",
  dialogue: "dialogue",
  transition: "transition",
  shot: "shot",
  general: "general",
};

const finalDraftType: Record<ParagraphType, string> = {
  "scene-heading": "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  shot: "Shot",
  general: "General",
};

const id = () => crypto.randomUUID();

export function parseFdx(xml: string): ScreenplayParagraph[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "FinalDraft"
  ) {
    throw new Error("This file is not a valid Final Draft document.");
  }

  const content = Array.from(document.documentElement.children).find(
    (child) => child.localName.toLowerCase() === "content",
  );
  if (!content) return [];

  return Array.from(
    content.querySelectorAll(":scope > Paragraph, :scope > DualDialogue > Paragraph"),
  )
    .map((element) => ({
      id: element.getAttribute("UUID") || element.getAttribute("Id") || id(),
      type: typeMap[(element.getAttribute("Type") || "Action").trim().toLowerCase()] || "action",
      text:
        Array.from(element.children)
          .filter((child) => child.localName.toLowerCase() === "text")
          .map((child) => child.textContent || "")
          .join("") ||
        element.textContent ||
        "",
    }))
    .filter((paragraph) => paragraph.text.trim() || paragraph.type !== "action");
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function serializeFdx(paragraphs: ScreenplayParagraph[]) {
  const body = paragraphs
    .map(
      (paragraph) =>
        `    <Paragraph Type="${finalDraftType[paragraph.type]}" UUID="${escapeXml(paragraph.id)}"><Text>${escapeXml(paragraph.text)}</Text></Paragraph>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<FinalDraft DocumentType="Script" Version="3">\n  <Content>\n${body}\n  </Content>\n</FinalDraft>\n`;
}

export const blankParagraph = (): ScreenplayParagraph => ({
  id: id(),
  type: "scene-heading",
  text: "",
});
