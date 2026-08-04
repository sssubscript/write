export type EditorMode = "write" | "annotate";

export const editorModes: Record<
  EditorMode,
  { label: string; description: string; toolbarLabel: string }
> = {
  write: {
    label: "Write",
    description: "Edit screenplay text and elements",
    toolbarLabel: "Writing tools",
  },
  annotate: {
    label: "Annotate",
    description: "Select text and add signed notes",
    toolbarLabel: "Annotation tools",
  },
};
