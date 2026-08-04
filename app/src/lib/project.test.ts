import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type Annotation,
  canDeleteAnnotation,
  checkpointBranchDepth,
  checkpointIsBranched,
  nextVersionLabel,
  type ProjectSnapshot,
  parseStoredGenres,
  reorderSceneParagraphs,
  shouldCreateVersion,
  updateYText,
} from "./project";

describe("live screenplay text", () => {
  it("undoes and redoes local screenplay changes", () => {
    const doc = new Y.Doc();
    const paragraphs = doc.getArray<Y.Text>("paragraphs");
    const origin = Symbol("local-edit");
    const history = new Y.UndoManager(paragraphs, { trackedOrigins: new Set([origin]) });
    const paragraph = new Y.Text();

    doc.transact(() => paragraphs.push([paragraph]), origin);
    history.stopCapturing();
    doc.transact(() => paragraph.insert(0, "FADE IN:"), origin);

    history.undo();
    expect(paragraph.toString()).toBe("");
    expect(history.redoStack).toHaveLength(1);

    history.redo();
    expect(paragraph.toString()).toBe("FADE IN:");
  });

  it("applies character edits to the existing shared Y.Text", () => {
    const doc = new Y.Doc();
    const text = doc.getText("paragraph");
    text.insert(0, "CUT TO:");

    const delta = updateYText(text, "CUT BACK TO:");

    expect(text.toString()).toBe("CUT BACK TO:");
    expect(doc.getText("paragraph")).toBe(text);
    expect(delta).toEqual({ index: 4, deleteCount: 0, insert: "BACK " });
  });

  it("does not emit a Yjs update when the value is unchanged", () => {
    const doc = new Y.Doc();
    const text = doc.getText("paragraph");
    text.insert(0, "FADE IN:");
    let updates = 0;
    doc.on("update", () => updates++);

    const delta = updateYText(text, "FADE IN:");

    expect(updates).toBe(0);
    expect(delta).toBeNull();
  });

  it("only permits the annotation author to remove it", () => {
    const annotation = {
      payload: {
        id: "annotation-1",
        paragraphId: "paragraph-1",
        kind: "comment",
        start: 0,
        end: 4,
        quote: "FADE",
        body: "Opening note",
        createdAt: "2026-08-03T00:00:00.000Z",
      } satisfies Annotation,
      author: { id: "author-1", name: "Writer", publicKey: {} },
      signature: "signature",
      algorithm: "Ed25519" as const,
    };

    expect(canDeleteAnnotation(annotation, "author-1")).toBe(true);
    expect(canDeleteAnnotation(annotation, "author-2")).toBe(false);
  });

  it("reads persisted screenplay genres defensively", () => {
    expect(parseStoredGenres('["Drama","Thriller"]')).toEqual(["Drama", "Thriller"]);
    expect(parseStoredGenres('["Drama",42]')).toEqual(["Drama"]);
    expect(parseStoredGenres("not-json")).toEqual([]);
  });

  it("keeps manual snapshots but coalesces unchanged idle commits", () => {
    expect(shouldCreateVersion("auto", "same", "same")).toBe(false);
    expect(shouldCreateVersion("auto", "next", "same")).toBe(true);
    expect(shouldCreateVersion("manual", "same", "same")).toBe(true);
  });

  it("numbers linear saves and versions branched from an older save", () => {
    expect(nextVersionLabel(null, [])).toBe("v0");
    expect(nextVersionLabel("v0", ["v0"])).toBe("v1");
    expect(nextVersionLabel("v2", ["v0", "v1", "v2", "v3"])).toBe("v2.0");
    expect(nextVersionLabel("v2.0", ["v0", "v1", "v2", "v3", "v2.0"])).toBe("v2.1");
  });

  it("only indents versions after an actual branch", () => {
    const checkpoints = [
      { payload: { id: "v0", parent: null, version: "v0" } },
      { payload: { id: "v1", parent: "v0", version: "v1" } },
      { payload: { id: "v2", parent: "v1", version: "v2" } },
      { payload: { id: "v1.0", parent: "v1", version: "v1.0" } },
    ] as ProjectSnapshot["checkpoints"];

    expect(checkpointBranchDepth("v2", checkpoints)).toBe(0);
    expect(checkpointBranchDepth("v1.0", checkpoints)).toBe(1);
    expect(checkpointBranchDepth("v1", checkpoints)).toBe(0);
    expect(checkpointIsBranched(checkpoints[3], checkpoints)).toBe(true);
  });

  it("moves a complete scene without splitting its paragraphs", () => {
    const paragraphs = [
      { id: "one", type: "scene-heading" as const, text: "INT. ONE" },
      { id: "one-action", type: "action" as const, text: "First scene" },
      { id: "two", type: "scene-heading" as const, text: "INT. TWO" },
      { id: "two-action", type: "action" as const, text: "Second scene" },
      { id: "three", type: "scene-heading" as const, text: "INT. THREE" },
    ];

    expect(
      reorderSceneParagraphs(paragraphs, "two", "one").map((paragraph) => paragraph.id),
    ).toEqual(["two", "two-action", "one", "one-action", "three"]);
    expect(reorderSceneParagraphs(paragraphs, "two", "three")).toBe(paragraphs);
  });
});
