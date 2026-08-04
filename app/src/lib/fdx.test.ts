import { describe, expect, it } from "vitest";
import {
  blankParagraph,
  cycleParagraphType,
  nextParagraphType,
  parseFdx,
  serializeFdx,
} from "./fdx";

const document = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="3">
  <Content>
    <Paragraph Type="Scene Heading" UUID="scene-1"><Text>INT. ROOM - NIGHT</Text></Paragraph>
    <Paragraph Type="Action" UUID="action-1"><Text>One </Text><Text Style="Bold">careful</Text><Text> cut.</Text></Paragraph>
    <DualDialogue>
      <Paragraph Type="Character" UUID="ada"><Text>ADA</Text></Paragraph>
      <Paragraph Type="Dialogue" UUID="left"><Text>Left side.</Text></Paragraph>
      <Paragraph Type="Character" UUID="lin"><Text>LIN</Text></Paragraph>
      <Paragraph Type="Dialogue" UUID="right"><Text>Right side.</Text></Paragraph>
    </DualDialogue>
  </Content>
</FinalDraft>`;

describe("FDX document model", () => {
  it("imports semantic paragraphs, inline runs, and dual dialogue content", () => {
    const paragraphs = parseFdx(document);

    expect(paragraphs).toEqual([
      { id: "scene-1", type: "scene-heading", text: "INT. ROOM - NIGHT" },
      { id: "action-1", type: "action", text: "One careful cut." },
      { id: "ada", type: "character", text: "ADA" },
      { id: "left", type: "dialogue", text: "Left side." },
      { id: "lin", type: "character", text: "LIN" },
      { id: "right", type: "dialogue", text: "Right side." },
    ]);
  });

  it("exports a Final Draft document that round-trips text and element types", () => {
    const paragraphs = parseFdx(document);
    expect(parseFdx(serializeFdx(paragraphs))).toEqual(paragraphs);
  });

  it("rejects malformed and unrelated XML", () => {
    expect(() => parseFdx("<document />")).toThrow("valid Final Draft");
    expect(() => parseFdx("<FinalDraft>")).toThrow("valid Final Draft");
  });

  it("follows screenplay writing flow and supports cycling element types", () => {
    expect(nextParagraphType("scene-heading")).toBe("action");
    expect(nextParagraphType("character")).toBe("dialogue");
    expect(nextParagraphType("dialogue")).toBe("action");
    expect(cycleParagraphType("action")).toBe("character");
    expect(cycleParagraphType("general")).toBe("scene-heading");
  });

  it("creates an empty screenplay element without an imported document", () => {
    expect(blankParagraph()).toMatchObject({ type: "scene-heading", text: "" });
  });
});
