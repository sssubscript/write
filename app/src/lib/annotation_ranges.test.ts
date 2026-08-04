import { describe, expect, it } from "vitest";
import { annotationSegments, transformAnnotations } from "./annotation_ranges";

describe("annotation ranges", () => {
  it("splits screenplay text into annotation-marked display segments", () => {
    expect(annotationSegments("FADE IN", [{ kind: "highlight", start: 0, end: 4 }])).toEqual([
      { text: "FADE", kinds: ["highlight"] },
      { text: " IN", kinds: [] },
    ]);
  });

  it("shifts annotations after an edit and truncates annotations cut by it", () => {
    const annotations = [
      {
        id: "shift",
        paragraphId: "p",
        kind: "highlight" as const,
        start: 5,
        end: 7,
        quote: "IN",
        body: "",
        createdAt: "now",
      },
      {
        id: "cut",
        paragraphId: "p",
        kind: "comment" as const,
        start: 0,
        end: 4,
        quote: "FADE",
        body: "",
        createdAt: "now",
      },
    ];

    expect(
      transformAnnotations(annotations, [{ index: 2, deleteCount: 2, insert: "" }], "FA IN"),
    ).toEqual([
      { ...annotations[0], start: 3, end: 5, quote: "IN" },
      { ...annotations[1], start: 0, end: 2, quote: "FA" },
    ]);
  });
});
