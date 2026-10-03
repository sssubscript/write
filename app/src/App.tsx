import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { subscriptMark, subscriptWordmark } from "./assets/subscript-logo";
import { annotationSegments } from "./lib/annotation_ranges";
import { mergeConfig, type WriteConfig } from "./lib/config";
import {
  deleteAtSelection,
  insertLineBreak,
  insertsLineBreak,
  mergeWithNextElement,
} from "./lib/editor_key_behavior";
import { type EditorMode, editorModes } from "./lib/editor_mode";
import {
  cycleParagraphType,
  nextParagraphType,
  type ParagraphType,
  paragraphTypes,
  parseFdx,
  type ScreenplayParagraph,
  serializeFdx,
} from "./lib/fdx";
import { feedbackRedirectUrl } from "./lib/feedback";
import { type DeviceIdentity, loadIdentity, renameIdentity } from "./lib/identity";
import { paginateScreenplay } from "./lib/pagination";
import { loadPanelPreferences, savePanelPreferences } from "./lib/panel_preferences";
import { paragraphPlaceholder } from "./lib/paragraph_placeholder";
import {
  type AnnotationKind,
  type CollaboratorPresence,
  canDeleteAnnotation,
  checkpointBranchDepth,
  checkpointIsBranched,
  checkpointVersion,
  LocalProject,
  nextVersionLabel,
  type ProjectSnapshot,
} from "./lib/project";
import { formatScreenplayClipboardText } from "./lib/screenplay_clipboard";
import { listScripts, type ScriptRecord, saveScript } from "./lib/script_registry";

type Selection = {
  ranges: Array<{
    paragraph: ScreenplayParagraph;
    start: number;
    end: number;
  }>;
};

const emptySnapshot: ProjectSnapshot = {
  title: "Opening local draft…",
  logline: "",
  genres: [],
  paragraphs: [],
  annotations: [],
  operations: [],
  checkpoints: [],
  currentVersionId: null,
  hasUnsavedChanges: false,
  peers: 0,
  connected: false,
  presences: [],
  canUndo: false,
  canRedo: false,
};

function PanelCollapseIcon({ side, collapsed }: { side: "left" | "right"; collapsed: boolean }) {
  const pointsLeft = side === "left" ? !collapsed : collapsed;

  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d={side === "left" ? "M7.5 3v14" : "M12.5 3v14"} />
      <path d={pointsLeft ? "m12 7-3 3 3 3" : "m8 7 3 3-3 3"} />
    </svg>
  );
}

function RemoteCaret({ presence, text }: { presence: CollaboratorPresence; text: string }) {
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!presence.cursor) return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `textarea[data-paragraph-id="${CSS.escape(presence.cursor.paragraphId)}"]`,
    );
    if (!textarea) return;
    const style = getComputedStyle(textarea);
    const mirror = document.createElement("div");
    mirror.style.cssText = `position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;width:${textarea.clientWidth}px;font:${style.font};line-height:${style.lineHeight};letter-spacing:${style.letterSpacing};text-transform:${style.textTransform};padding:${style.padding};border:${style.border}`;
    mirror.textContent = text.slice(0, presence.cursor.head);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.append(marker);
    document.body.append(mirror);
    setPosition({
      left: textarea.offsetLeft + marker.offsetLeft - textarea.scrollLeft,
      top: textarea.offsetTop + marker.offsetTop - textarea.scrollTop,
    });
    mirror.remove();
  }, [presence.cursor, text]);

  return (
    <span
      className="remote-caret"
      style={{ left: position.left, top: position.top, background: presence.author.color }}
      aria-label={`${presence.author.name}'s cursor`}
    >
      <span style={{ background: presence.author.color }}>{presence.author.name}</span>
    </span>
  );
}

const tools: { kind: AnnotationKind; label: string; key: string }[] = [
  { kind: "highlight", label: "Highlight", key: "H" },
  { kind: "strikethrough", label: "Strike", key: "S" },
  { kind: "replace", label: "Replace", key: "R" },
  { kind: "comment", label: "Comment", key: "C" },
];

const genres = [
  "Comedy",
  "Drama",
  "Horror",
  "Sci-Fi",
  "Action",
  "Adventure",
  "Thriller",
  "Fantasy",
  "Western",
] as const;

const sceneLabel = (paragraph: ScreenplayParagraph, index: number) =>
  paragraph.type === "scene-heading"
    ? paragraph.text.trim() || "Untitled scene"
    : `Scene ${index + 1}`;

const shortId = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const avatarUrlFor = (author: { id: string; identity?: { avatarUrl?: string } }) =>
  author.identity?.avatarUrl ||
  `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(author.id)}&backgroundColor=ffdfbf,ffd5dc,d1d4f9,c0aede,b6e3f4&backgroundType=solid`;

const randomRoom = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const diffSegments = (live: string, historic: string) => {
  let start = 0;
  while (start < live.length && start < historic.length && live[start] === historic[start]) start++;
  let liveEnd = live.length;
  let historicEnd = historic.length;
  while (
    liveEnd > start &&
    historicEnd > start &&
    live[liveEnd - 1] === historic[historicEnd - 1]
  ) {
    liveEnd--;
    historicEnd--;
  }
  return [
    { type: "same", text: live.slice(0, start) },
    { type: "removed", text: live.slice(start, liveEnd) },
    { type: "added", text: historic.slice(start, historicEnd) },
    { type: "same", text: live.slice(liveEnd) },
  ].filter((segment) => segment.text);
};

function useProject(project: LocalProject | null) {
  return useSyncExternalStore(
    project?.subscribe || (() => () => undefined),
    project?.snapshot || (() => emptySnapshot),
    () => emptySnapshot,
  );
}

function App({ config: configOverrides }: { config?: Partial<WriteConfig> } = {}) {
  const config = useMemo(() => mergeConfig(configOverrides), [configOverrides]);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [project, setProject] = useState<LocalProject | null>(null);
  const [projectId, setProjectId] = useState("local-draft");
  const [scripts, setScripts] = useState<ScriptRecord[]>(() => listScripts());
  const [scenePanelTab, setScenePanelTab] = useState<"scenes" | "scripts">("scenes");
  const [mode, setMode] = useState<EditorMode>("write");
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [singlePageMode, setSinglePageMode] = useState(false);
  const [scenesCollapsed, setScenesCollapsed] = useState(
    () =>
      loadPanelPreferences(
        typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches,
      ).scenesCollapsed,
  );
  const [notesCollapsed, setNotesCollapsed] = useState(
    () =>
      loadPanelPreferences(
        typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches,
      ).notesCollapsed,
  );
  const [activeSidebarTab, setActiveSidebarTab] = useState<"notes" | "history">("notes");
  const [previewCommitId, setPreviewCommitId] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationKind>("comment");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState("");
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [loglineDraft, setLoglineDraft] = useState("");
  const [genreDraft, setGenreDraft] = useState<string[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [newScriptOpen, setNewScriptOpen] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState("");
  const [pendingProjectTitle, setPendingProjectTitle] = useState("Untitled screenplay");
  const [focusParagraphId, setFocusParagraphId] = useState<string | null>(null);
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null);
  const [hoveredParagraphId, setHoveredParagraphId] = useState<string | null>(null);
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [dropBeforeSceneId, setDropBeforeSceneId] = useState<string | null>(null);
  const [audit, setAudit] = useState({ valid: 0, total: 0 });
  const [paragraphHeights, setParagraphHeights] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<{ paragraphId: string; offset: number } | null>(null);
  const pageWrap = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const pointerFrame = useRef<number | null>(null);
  const snapshot = useProject(project);
  const previewCommit = useMemo(
    () => snapshot.checkpoints.find((entry) => entry.payload.id === previewCommitId) || null,
    [previewCommitId, snapshot.checkpoints],
  );
  const isHistoryPreview = Boolean(previewCommit);
  const viewedParagraphs = previewCommit?.payload.state?.paragraphs || snapshot.paragraphs;
  const viewedAnnotations = previewCommit?.payload.state?.annotations || snapshot.annotations;
  const currentVersion = useMemo(
    () =>
      snapshot.checkpoints.find((entry) => entry.payload.id === snapshot.currentVersionId) || null,
    [snapshot.checkpoints, snapshot.currentVersionId],
  );
  const currentVersionLabel = currentVersion
    ? checkpointVersion(currentVersion, snapshot.checkpoints)
    : "v0";
  const workingVersionLabel = snapshot.hasUnsavedChanges
    ? nextVersionLabel(
        currentVersion ? checkpointVersion(currentVersion, snapshot.checkpoints) : null,
        snapshot.checkpoints.map((entry) => checkpointVersion(entry, snapshot.checkpoints)),
      )
    : currentVersionLabel;
  const historyEntries = useMemo(
    () =>
      [...snapshot.checkpoints].sort((left, right) => {
        if (left.payload.id === snapshot.currentVersionId) return -1;
        if (right.payload.id === snapshot.currentVersionId) return 1;
        return right.payload.createdAt.localeCompare(left.payload.createdAt);
      }),
    [snapshot.checkpoints, snapshot.currentVersionId],
  );

  useLayoutEffect(() => {
    if (!focusParagraphId) return;
    const input = document.querySelector<HTMLElement>(
      `.paragraph-editor[data-paragraph-id="${CSS.escape(focusParagraphId)}"]`,
    );
    if (!input) return;
    const editor = input.closest<HTMLElement>(".screenplay-editable");
    editor?.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setActiveParagraphId(focusParagraphId);
    setFocusParagraphId(null);
  }, [focusParagraphId, snapshot.paragraphs.length]);

  useLayoutEffect(() => {
    const nextCaret = pendingCaret.current;
    if (!nextCaret) return;
    const input = document.querySelector<HTMLElement>(
      `.paragraph-editor[data-paragraph-id="${CSS.escape(nextCaret.paragraphId)}"]`,
    );
    if (!input) return;
    const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    let remaining = nextCaret.offset;
    let node = walker.nextNode();
    while (node && remaining > node.textContent!.length) {
      remaining -= node.textContent!.length;
      node = walker.nextNode();
    }
    if (!node) return;
    const range = document.createRange();
    range.setStart(node, remaining);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    pendingCaret.current = null;
  }, [snapshot.paragraphs]);

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 760px)");
    const collapseDrawer = (event: MediaQueryListEvent) => {
      if (event.matches) setScenesCollapsed(true);
    };
    compactLayout.addEventListener("change", collapseDrawer);
    return () => compactLayout.removeEventListener("change", collapseDrawer);
  }, []);

  useEffect(() => {
    savePanelPreferences({ scenesCollapsed, notesCollapsed });
  }, [notesCollapsed, scenesCollapsed]);

  useEffect(() => {
    const updateActiveParagraph = () => {
      const selection = window.getSelection();
      if (!selection?.anchorNode) return;
      const element =
        selection.anchorNode.nodeType === Node.ELEMENT_NODE
          ? (selection.anchorNode as Element)
          : selection.anchorNode.parentElement;
      const paragraph = element?.closest<HTMLElement>(".paragraph[data-paragraph-id]");
      if (paragraph?.closest(".screenplay-editable")) {
        setActiveParagraphId(paragraph.dataset.paragraphId || null);
      }
    };

    document.addEventListener("selectionchange", updateActiveParagraph);
    return () => document.removeEventListener("selectionchange", updateActiveParagraph);
  }, []);

  useEffect(() => {
    let active = true;
    let opened: LocalProject | null = null;
    void (async () => {
      // Identity loading can't be cancelled, so ignore its result (or failure) after unmount.
      const loadedIdentity = await loadIdentity(config).catch((error) => {
        if (active) throw error;
        return null;
      });
      if (!active || !loadedIdentity) return;
      const loadedProject = await LocalProject.open(
        loadedIdentity,
        config,
        projectId,
        pendingProjectTitle,
      );
      opened = loadedProject;
      if (!active) return loadedProject.destroy();
      setIdentity(loadedIdentity);
      setProject(loadedProject);
      setFocusParagraphId(loadedProject.snapshot().paragraphs[0]?.id || null);
      const room = new URLSearchParams(location.hash.slice(1)).get("room");
      if (room) loadedProject.connect(room);
    })();
    return () => {
      active = false;
      opened?.destroy();
    };
  }, [config, pendingProjectTitle, projectId]);

  useEffect(() => {
    if (!project || !snapshot.title || snapshot.title === "Opening local draftâ€¦") return;
    setScripts(
      saveScript({ id: projectId, title: snapshot.title, updatedAt: new Date().toISOString() }),
    );
  }, [project, projectId, snapshot.paragraphs.length, snapshot.title]);

  useEffect(() => {
    setTitleDraft(snapshot.title);
  }, [snapshot.title]);

  useEffect(() => {
    const handleUndoRedo = (event: KeyboardEvent) => {
      if (!project || mode !== "write" || isHistoryPreview || !(event.metaKey || event.ctrlKey))
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[role=dialog], input, textarea")) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) project.redo();
        else project.undo();
      } else if (key === "y") {
        event.preventDefault();
        project.redo();
      }
    };
    window.addEventListener("keydown", handleUndoRedo);
    return () => window.removeEventListener("keydown", handleUndoRedo);
  }, [isHistoryPreview, mode, project]);

  useEffect(() => {
    let saving = false;
    const handleSave = (event: KeyboardEvent) => {
      if (
        !project ||
        isHistoryPreview ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "s"
      )
        return;
      if (event.target instanceof HTMLElement && event.target.closest("[role=dialog]")) return;
      event.preventDefault();
      if (saving) return;
      saving = true;
      void (async () => {
        await project.checkpoint("Saved with keyboard shortcut");
      })().finally(() => {
        saving = false;
      });
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [isHistoryPreview, project]);

  useEffect(() => {
    if (!project) return;
    let active = true;
    void project.audit().then((result) => active && setAudit(result));
    return () => {
      active = false;
    };
  }, [
    project,
    snapshot.operations.length,
    snapshot.annotations.length,
    snapshot.checkpoints.length,
  ]);

  const scenes = useMemo(
    () => snapshot.paragraphs.filter((paragraph) => paragraph.type === "scene-heading"),
    [snapshot.paragraphs],
  );

  useEffect(() => {
    if (!draggedSceneId) return;
    const cancelSceneDrag = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraggedSceneId(null);
      setDropBeforeSceneId(null);
    };
    window.addEventListener("keydown", cancelSceneDrag);
    return () => window.removeEventListener("keydown", cancelSceneDrag);
  }, [draggedSceneId]);
  const authoritativeIdentity =
    identity?.identity?.assurance === "authoritative" ? identity.identity : null;
  const identityAvatarUrl = identity ? avatarUrlFor(identity) : null;

  const pages = useMemo(
    () =>
      singlePageMode ? [viewedParagraphs] : paginateScreenplay(viewedParagraphs, paragraphHeights),
    [paragraphHeights, singlePageMode, viewedParagraphs],
  );

  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    pageWrap.current
      ?.querySelectorAll<HTMLElement>(".paragraph[data-paragraph-id]")
      .forEach((element) => {
        const style = getComputedStyle(element);
        next[element.dataset.paragraphId || ""] =
          element.getBoundingClientRect().height +
          Number.parseFloat(style.marginTop) +
          Number.parseFloat(style.marginBottom);
      });
    if (Object.keys(next).some((id) => Math.abs((paragraphHeights[id] || 0) - next[id]) > 1)) {
      setParagraphHeights(next);
    }
  }, [pages, paragraphHeights]);

  const importFile = async (file: File) => {
    if (!project) return;
    const paragraphs = parseFdx(await file.text());
    if (!paragraphs.length)
      throw new Error("The Final Draft file contains no screenplay paragraphs.");
    await project.replaceDocument(file.name.replace(/\.fdx$/i, ""), paragraphs);
  };

  const exportFile = () => {
    const blob = new Blob([serializeFdx(snapshot.paragraphs)], { type: "application/xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${snapshot.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "screenplay"}.fdx`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportArchive = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project.archive(), null, 2)], {
      type: "application/vnd.subscript.signed-draft+json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${snapshot.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "screenplay"}.subscript`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const getFeedback = async () => {
    if (feedbackStatus === "uploading") return;
    setFeedbackStatus("uploading");
    const body = new FormData();
    body.append("title", snapshot.title);
    body.append("logline", snapshot.logline);
    for (const genre of snapshot.genres) body.append("categories[]", genre);
    body.append(
      "file",
      new Blob([serializeFdx(snapshot.paragraphs)], { type: "application/vnd.finaldraft" }),
      `${snapshot.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "screenplay"}.fdx`,
    );

    try {
      const response = await fetch("/write/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": identity?.idp.csrfToken || "" },
        body,
      });
      const result = (await response.json()) as { redirect_url?: string; error?: string };
      if (!response.ok || !result.redirect_url) throw new Error(result.error || "Upload failed");
      window.location.assign(
        feedbackRedirectUrl(result.redirect_url, config.homepage, window.location.origin),
      );
    } catch {
      setFeedbackStatus("error");
    }
  };

  const selectText = async (paragraph: ScreenplayParagraph, target: HTMLTextAreaElement) => {
    if (mode !== "annotate") return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start === end || !project) return;
    const nextSelection = { ranges: [{ paragraph, start, end }] };
    setSelection(nextSelection);
    setNote("");
    setReplacement("");
    setDialogOpen(true);
  };

  const saveAnnotation = async () => {
    if (!project || !selection) return;
    await Promise.all(
      selection.ranges.map((range) =>
        project.addAnnotation({
          paragraphId: range.paragraph.id,
          kind: tool,
          start: range.start,
          end: range.end,
          quote: range.paragraph.text.slice(range.start, range.end),
          body: note,
          replacement: tool === "replace" ? replacement : undefined,
        }),
      ),
    );
    setDialogOpen(false);
    setSelection(null);
    setNote("");
    setReplacement("");
  };

  const selectAcrossElements = () => {
    if (mode !== "annotate") return;
    const nativeSelection = window.getSelection();
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) return;
    const nativeRange = nativeSelection.getRangeAt(0);
    const rootFor = (node: Node) =>
      (node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      )?.closest<HTMLElement>(".annotation-selectable[data-paragraph-id]");
    const startRoot = rootFor(nativeRange.startContainer);
    const endRoot = rootFor(nativeRange.endContainer);
    if (!startRoot || !endRoot) return;
    const roots = [
      ...document.querySelectorAll<HTMLElement>(".annotation-selectable[data-paragraph-id]"),
    ];
    const startIndex = roots.indexOf(startRoot);
    const endIndex = roots.indexOf(endRoot);
    if (startIndex < 0 || endIndex < startIndex) return;
    const offsetIn = (root: HTMLElement, node: Node, offset: number) => {
      const before = document.createRange();
      before.selectNodeContents(root);
      before.setEnd(node, offset);
      return before.toString().length;
    };
    const ranges = roots.slice(startIndex, endIndex + 1).flatMap((root, index) => {
      const paragraph = snapshot.paragraphs.find((item) => item.id === root.dataset.paragraphId);
      if (!paragraph) return [];
      const start =
        index === 0 ? offsetIn(root, nativeRange.startContainer, nativeRange.startOffset) : 0;
      const end =
        index === endIndex - startIndex
          ? offsetIn(root, nativeRange.endContainer, nativeRange.endOffset)
          : paragraph.text.length;
      return start === end ? [] : [{ paragraph, start, end }];
    });
    if (!ranges.length) return;
    setSelection({ ranges });
    setNote("");
    setReplacement("");
    setDialogOpen(true);
  };

  const copyFormattedSelection = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const nativeSelection = window.getSelection();
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) return;
    const nativeRange = nativeSelection.getRangeAt(0);
    const rootFor = (node: Node) =>
      (node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      )?.closest<HTMLElement>(".paragraph-editor[data-paragraph-id]");
    const startRoot = rootFor(nativeRange.startContainer);
    const endRoot = rootFor(nativeRange.endContainer);
    if (!startRoot || !endRoot) return;
    const roots = [
      ...document.querySelectorAll<HTMLElement>(".paragraph-editor[data-paragraph-id]"),
    ];
    const startIndex = roots.indexOf(startRoot);
    const endIndex = roots.indexOf(endRoot);
    if (startIndex < 0 || endIndex < startIndex) return;
    const offsetIn = (root: HTMLElement, node: Node, offset: number) => {
      const before = document.createRange();
      before.selectNodeContents(root);
      before.setEnd(node, offset);
      return before.toString().length;
    };
    const selected = roots.slice(startIndex, endIndex + 1).flatMap((root, index) => {
      const paragraph = snapshot.paragraphs.find((item) => item.id === root.dataset.paragraphId);
      if (!paragraph) return [];
      const start =
        index === 0 ? offsetIn(root, nativeRange.startContainer, nativeRange.startOffset) : 0;
      const end =
        index === endIndex - startIndex
          ? offsetIn(root, nativeRange.endContainer, nativeRange.endOffset)
          : paragraph.text.length;
      return start === end
        ? []
        : [{ type: paragraph.type, text: paragraph.text.slice(start, end) }];
    });
    if (!selected.length) return;
    const escapeHtml = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const styles: Partial<Record<ParagraphType, string>> = {
      character: "margin-left:205px;text-transform:uppercase",
      dialogue: "margin-left:100px",
      parenthetical: "margin-left:150px",
      transition: "text-align:right;text-transform:uppercase",
      "scene-heading": "text-transform:uppercase;margin-top:28px",
    };
    event.preventDefault();
    event.clipboardData.setData("text/plain", formatScreenplayClipboardText(selected));
    event.clipboardData.setData(
      "text/html",
      selected
        .map(
          (paragraph) =>
            `<div style="font:16px/1.25 'Courier New',monospace;white-space:pre-wrap;margin-bottom:16px;${styles[paragraph.type] || ""}">${escapeHtml(paragraph.text)}</div>`,
        )
        .join(""),
    );
  };

  const updateHoveredParagraph = (event: React.MouseEvent<HTMLElement>) => {
    const paragraph = [...event.currentTarget.querySelectorAll<HTMLElement>(".paragraph")].find(
      (element) => {
        const bounds = element.getBoundingClientRect();
        return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      },
    );
    const nextParagraphId = paragraph?.dataset.paragraphId || null;
    setHoveredParagraphId((current) => (current === nextParagraphId ? current : nextParagraphId));
  };

  const handleAnnotationDialogKey = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDialogOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void saveAnnotation();
    }
  };

  const share = () => {
    if (!project) return;
    const parameters = new URLSearchParams(location.hash.slice(1));
    const room = parameters.get("room") || randomRoom();
    parameters.set("room", room);
    history.replaceState(null, "", `${location.pathname}${location.search}#${parameters}`);
    project.connect(room);
    setShareOpen(true);
  };

  const openDetails = () => {
    setLoglineDraft(snapshot.logline);
    setGenreDraft(snapshot.genres);
    setDetailsOpen(true);
  };

  const toggleGenre = (genre: string) => {
    setGenreDraft((selected) => {
      if (selected.includes(genre)) return selected.filter((item) => item !== genre);
      if (selected.length === 2) return selected;
      return [...selected, genre];
    });
  };

  const saveDetails = () => {
    project?.updateDetails(loglineDraft, genreDraft);
    setDetailsOpen(false);
  };

  const switchScript = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setPreviewCommitId(null);
    setFocusParagraphId(null);
    setProject(null);
    setProjectId(nextProjectId);
  };

  const createScript = () => {
    const title = newScriptTitle.trim() || "Untitled screenplay";
    const nextProjectId = crypto.randomUUID();
    flushSync(() => {
      setNewScriptOpen(false);
      setNewScriptTitle("");
      setPendingProjectTitle(title);
      setScripts(saveScript({ id: nextProjectId, title, updatedAt: new Date().toISOString() }));
      setScenePanelTab("scripts");
      setProject(null);
      setProjectId(nextProjectId);
    });
    document.querySelector<HTMLElement>(".editor-stage")?.scrollTo({ top: 0 });
    setFocusParagraphId(null);
  };

  const insertElement = async (afterId: string, type: ParagraphType) => {
    if (!project) return;
    const paragraphId = await project.insertParagraph(afterId, type);
    setFocusParagraphId(paragraphId);
  };

  const previewHistoryEntry = async (commitId: string) => {
    if (!project) return;
    await project.saveWorkingCopy("Saved before viewing history");
    const currentVersionId = project.snapshot().currentVersionId;
    setPreviewCommitId(commitId === currentVersionId ? null : commitId);
  };

  const deleteSelectionAcrossElements = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!project || (event.key !== "Backspace" && event.key !== "Delete")) return false;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed) return false;
    const editorFor = (node: Node) =>
      (node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      )?.closest<HTMLElement>(".paragraph-editor[data-paragraph-id]");
    const startEditor = editorFor(range.startContainer);
    const endEditor = editorFor(range.endContainer);
    if (!startEditor || !endEditor || startEditor === endEditor) return false;
    const startIndex = snapshot.paragraphs.findIndex(
      (item) => item.id === startEditor.dataset.paragraphId,
    );
    const endIndex = snapshot.paragraphs.findIndex(
      (item) => item.id === endEditor.dataset.paragraphId,
    );
    if (startIndex < 0 || endIndex <= startIndex) return false;
    const offsetIn = (target: HTMLElement, node: Node, offset: number) => {
      const before = document.createRange();
      before.selectNodeContents(target);
      before.setEnd(node, offset);
      return before.toString().length;
    };
    const startOffset = offsetIn(startEditor, range.startContainer, range.startOffset);
    const endOffset = offsetIn(endEditor, range.endContainer, range.endOffset);
    const startParagraph = snapshot.paragraphs[startIndex];
    const endParagraph = snapshot.paragraphs[endIndex];

    event.preventDefault();
    pendingCaret.current = { paragraphId: startParagraph.id, offset: startOffset };
    project.updateParagraph(
      startParagraph.id,
      `${startParagraph.text.slice(0, startOffset)}${endParagraph.text.slice(endOffset)}`,
    );
    void (async () => {
      for (let index = endIndex; index > startIndex; index -= 1) {
        await project.deleteParagraph(snapshot.paragraphs[index].id);
      }
    })();
    return true;
  };

  const handleWritingKey = async (
    event: React.KeyboardEvent<HTMLDivElement>,
    paragraph: ScreenplayParagraph,
    target: HTMLElement,
  ) => {
    if (!project || event.nativeEvent.isComposing) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const selectionOffset = (node: Node, offset: number) => {
      const before = document.createRange();
      before.selectNodeContents(target);
      before.setEnd(node, offset);
      return before.toString().length;
    };
    let start = 0;
    let end = 0;
    if (range && target.contains(range.startContainer) && target.contains(range.endContainer)) {
      start = selectionOffset(range.startContainer, range.startOffset);
      end = selectionOffset(range.endContainer, range.endOffset);
    }
    const text = target.textContent || "";

    if ((event.key === "Delete" || event.key === "Backspace") && start !== end) {
      event.preventDefault();
      const result = deleteAtSelection(text, start, end);
      if (!result) return;
      pendingCaret.current = { paragraphId: paragraph.id, offset: result.caret };
      project.updateParagraph(paragraph.id, result.text);
      return;
    }
    if (event.key === "Delete" && text === "") {
      event.preventDefault();
      const index = snapshot.paragraphs.findIndex((item) => item.id === paragraph.id);
      const nextId = snapshot.paragraphs[index + 1]?.id;
      if (!nextId) return;
      await project.deleteParagraph(paragraph.id);
      setFocusParagraphId(nextId);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const result = deleteAtSelection(text, start, end);
      if (result) {
        pendingCaret.current = { paragraphId: paragraph.id, offset: result.caret };
        project.updateParagraph(paragraph.id, result.text);
        return;
      }
      const index = snapshot.paragraphs.findIndex((item) => item.id === paragraph.id);
      const nextParagraph = snapshot.paragraphs[index + 1];
      if (!nextParagraph) return;
      const merged = mergeWithNextElement(text, nextParagraph.text);
      await project.deleteParagraph(nextParagraph.id);
      pendingCaret.current = { paragraphId: paragraph.id, offset: merged.caret };
      project.updateParagraph(paragraph.id, merged.text);
      return;
    }
    if (event.key === "Enter" && insertsLineBreak(start, end, text.length, event.shiftKey)) {
      event.preventDefault();
      const result = insertLineBreak(text, start, end);
      pendingCaret.current = { paragraphId: paragraph.id, offset: result.caret };
      project.updateParagraph(paragraph.id, result.text);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      project.updateParagraph(paragraph.id, text);
      await project.commitParagraph(paragraph.id);
      await insertElement(paragraph.id, nextParagraphType(paragraph.type));
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      project.updateParagraph(paragraph.id, target.textContent || "");
      await project.commitParagraph(paragraph.id);
      await project.changeParagraphType(paragraph.id, cycleParagraphType(paragraph.type));
      setFocusParagraphId(paragraph.id);
      return;
    }
    if (event.key === "Backspace" && target.textContent === "") {
      event.preventDefault();
      const previousId = await project.deleteParagraph(paragraph.id);
      if (previousId) setFocusParagraphId(previousId);
    }
  };

  const handleScreenplayKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "write") return;
    if (deleteSelectionAcrossElements(event)) return;
    const anchorNode = window.getSelection()?.anchorNode;
    const paragraphElement =
      (event.target as HTMLElement).closest<HTMLElement>(".paragraph-editor[data-paragraph-id]") ||
      (anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element)
        : anchorNode?.parentElement
      )?.closest<HTMLElement>(".paragraph-editor[data-paragraph-id]");
    const paragraph = snapshot.paragraphs.find(
      (item) => item.id === paragraphElement?.dataset.paragraphId,
    );
    if (paragraph && paragraphElement) void handleWritingKey(event, paragraph, paragraphElement);
  };

  const publishCursor = (paragraphId: string, target: HTMLTextAreaElement) => {
    project?.setCursor(paragraphId, target.selectionStart, target.selectionEnd);
  };

  const publishPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (!project || event.pointerType === "touch" || pointerFrame.current !== null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pointerFrame.current = requestAnimationFrame(() => {
      project.setPointer(x, y);
      pointerFrame.current = null;
    });
  };

  const previewSceneDrop = (
    scene: ScreenplayParagraph,
    event: React.DragEvent<HTMLButtonElement>,
  ) => {
    if (!draggedSceneId) return;
    event.preventDefault();
    const index = scenes.findIndex((item) => item.id === scene.id);
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropBeforeSceneId(
      event.clientY < bounds.top + bounds.height / 2 ? scene.id : (scenes[index + 1]?.id ?? null),
    );
  };

  const completeSceneDrop = async () => {
    if (project && draggedSceneId) await project.moveScene(draggedSceneId, dropBeforeSceneId);
    setDraggedSceneId(null);
    setDropBeforeSceneId(null);
  };

  return (
    <Tooltip.Provider delayDuration={350}>
      <div
        className={`app-shell subscript-write${scenesCollapsed ? " is-scenes-collapsed" : ""}${notesCollapsed ? " is-notes-collapsed" : ""}${snapshot.logline ? " has-document-logline" : ""}`}
      >
        <header className="topbar">
          <a className="wordmark" href={config.homepage} aria-label="Subscript Write home">
            <span className="wordmark-mark" dangerouslySetInnerHTML={{ __html: subscriptMark }} />
            <span
              className="wordmark-logo"
              dangerouslySetInnerHTML={{ __html: subscriptWordmark }}
            />
            <span className="wordmark-product">Write</span>
          </a>
          <div className="document-title">
            <div className="document-title__heading">
              <input
                className="document-title__input"
                aria-label="Screenplay title"
                value={titleDraft}
                placeholder="Untitled screenplay"
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                onBlur={() => project?.updateTitle(titleDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setTitleDraft(snapshot.title);
                    event.currentTarget.blur();
                  }
                }}
              />
              {snapshot.genres.map((genre) => (
                <button
                  className="document-genre"
                  type="button"
                  key={genre}
                  onClick={openDetails}
                  aria-label={`Edit ${genre} screenplay details`}
                >
                  {genre}
                </button>
              ))}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    className="document-details-button"
                    type="button"
                    onClick={openDetails}
                    aria-label="Edit screenplay details"
                  >
                    <DocumentTextIcon aria-hidden="true" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal container={portalRoot}>
                  <Tooltip.Content className="tooltip" sideOffset={7}>
                    Details
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              {snapshot.logline && (
                <button className="document-logline" type="button" onClick={openDetails}>
                  {snapshot.logline}
                </button>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <span className="presence-stack" aria-label={`${snapshot.peers} collaborators present`}>
              {snapshot.presences.slice(0, 3).map((presence) => (
                <i
                  key={presence.clientId}
                  style={{ background: presence.author.color }}
                  title={presence.author.name}
                >
                  {presence.author.name.slice(0, 1).toUpperCase()}
                </i>
              ))}
            </span>
            <span className={`connection ${snapshot.connected ? "is-connected" : ""}`}>
              <i /> {snapshot.connected ? `${snapshot.peers + 1} in room` : "Local only"}
            </span>
            <button
              className={`quiet-button panel-visibility-button${scenesCollapsed ? " is-active" : ""}`}
              type="button"
              onClick={() => setScenesCollapsed((collapsed) => !collapsed)}
              aria-pressed={scenesCollapsed}
              aria-label={scenesCollapsed ? "Show left panel" : "Hide left panel"}
              title={scenesCollapsed ? "Show left panel" : "Hide left panel"}
            >
              <PanelCollapseIcon side="left" collapsed={scenesCollapsed} />
            </button>
            <button
              className={`quiet-button panel-visibility-button panel-visibility-button-right${notesCollapsed ? " is-active" : ""}`}
              type="button"
              onClick={() => setNotesCollapsed((collapsed) => !collapsed)}
              aria-pressed={notesCollapsed}
              aria-label={notesCollapsed ? "Show right panel" : "Hide right panel"}
              title={notesCollapsed ? "Show right panel" : "Hide right panel"}
            >
              <PanelCollapseIcon side="right" collapsed={notesCollapsed} />
            </button>
            <button
              className="quiet-button new-script-button"
              type="button"
              onClick={() => setNewScriptOpen(true)}
            >
              New script
            </button>
            <button
              className="quiet-button import-button"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              Import FDX
            </button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".fdx,application/xml,text/xml"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importFile(file);
                event.currentTarget.value = "";
              }}
            />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="quiet-button icon-button"
                  type="button"
                  aria-label="Document menu"
                >
                  •••
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={portalRoot}>
                <DropdownMenu.Content className="menu" align="end">
                  <DropdownMenu.Item className="menu-item" onSelect={exportFile}>
                    Export Final Draft
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={exportArchive}>
                    Export signed archive
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={() => setCheckpointOpen(true)}>
                    Save version
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <button className="share-button" type="button" onClick={share}>
              Share draft
            </button>
            {config.subscriptEnabled && (
              <button
                className="feedback-button"
                type="button"
                onClick={() => void getFeedback()}
                disabled={feedbackStatus === "uploading"}
              >
                <span className="feedback-button-label">
                  {feedbackStatus === "uploading" ? "Uploading…" : "Get Feedback"}
                </span>
              </button>
            )}
            {feedbackStatus === "error" && (
              <span className="feedback-error" role="status">
                Upload failed. Try again.
              </span>
            )}
          </div>
        </header>

        <aside className="scene-panel">
          <div
            className="panel-heading panel-heading-tabs"
            role="tablist"
            aria-label="Write navigation"
          >
            <button
              className={scenePanelTab === "scenes" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={scenePanelTab === "scenes"}
              onClick={() => setScenePanelTab("scenes")}
            >
              Scenes <b>{scenes.length}</b>
            </button>
            <button
              className={scenePanelTab === "scripts" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={scenePanelTab === "scripts"}
              onClick={() => setScenePanelTab("scripts")}
            >
              Scripts <b>{scripts.length}</b>
            </button>
          </div>
          {scenePanelTab === "scenes" ? (
            <nav className="scene-list" aria-label="Scenes">
              {scenes.map((scene, index) => (
                <div className="scene-list-item" key={scene.id}>
                  {draggedSceneId &&
                    dropBeforeSceneId === scene.id &&
                    draggedSceneId !== scene.id && (
                      <span className="scene-drop-indicator" aria-hidden="true" />
                    )}
                  <button
                    className={draggedSceneId === scene.id ? "is-dragging" : ""}
                    type="button"
                    draggable={!isHistoryPreview}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", scene.id);
                      setDraggedSceneId(scene.id);
                      setDropBeforeSceneId(scene.id);
                    }}
                    onDragOver={(event) => previewSceneDrop(scene, event)}
                    onDrop={completeSceneDrop}
                    onDragEnd={() => {
                      setDraggedSceneId(null);
                      setDropBeforeSceneId(null);
                    }}
                    onClick={() =>
                      document
                        .getElementById(`paragraph-${scene.id}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {sceneLabel(scene, index)}
                  </button>
                </div>
              ))}
              {draggedSceneId && dropBeforeSceneId === null && (
                <span className="scene-drop-indicator" aria-hidden="true" />
              )}
            </nav>
          ) : (
            <nav className="scene-list script-list" aria-label="Scripts">
              {scripts.map((script) => (
                <button
                  className={script.id === projectId ? "is-active" : ""}
                  type="button"
                  key={script.id}
                  onClick={() => switchScript(script.id)}
                >
                  <span>{script.id === projectId ? workingVersionLabel : "DRAFT"}</span>
                  {script.title}
                </button>
              ))}
              <button
                className="script-list__new"
                type="button"
                onClick={() => setNewScriptOpen(true)}
              >
                <span>＋</span> New script
              </button>
            </nav>
          )}
          {!authoritativeIdentity && identity?.idp.signInUrl && (
            <button
              className="identity-sign-in-cta"
              type="button"
              onClick={() => window.location.assign(identity.idp.signInUrl!)}
            >
              Sign In
            </button>
          )}
          <div className="local-card">
            {identityAvatarUrl ? (
              <img
                className="identity-avatar"
                src={identityAvatarUrl}
                alt={`${authoritativeIdentity?.fullName || "Local device"} avatar`}
              />
            ) : (
              <span className="key-glyph">⌁</span>
            )}
            <div>
              <span className="identity-name">
                {authoritativeIdentity?.profileUrl ? (
                  <a href={authoritativeIdentity.profileUrl} target="_blank" rel="noreferrer">
                    {authoritativeIdentity.fullName}
                  </a>
                ) : identity ? (
                  <input
                    aria-label="Local device username"
                    className="identity-name-input"
                    defaultValue={identity.name}
                    onBlur={async (event) =>
                      setIdentity(await renameIdentity(identity, event.currentTarget.value, config))
                    }
                  />
                ) : (
                  <strong>Creating identity…</strong>
                )}
                {authoritativeIdentity && (
                  <CheckBadgeIcon className="identity-verified-badge" aria-label="Verified" />
                )}
                {!authoritativeIdentity && identity && (
                  <ComputerDesktopIcon
                    className="identity-verified-badge"
                    aria-label="Local device"
                  />
                )}
              </span>
              <span>
                {authoritativeIdentity
                  ? authoritativeIdentity.username
                    ? `@${authoritativeIdentity.username}`
                    : ""
                  : ""}
              </span>
            </div>
          </div>
        </aside>

        <main className="editor-stage">
          <div className="toolstrip" aria-label={editorModes[mode].toolbarLabel}>
            <div className="mode-switch" role="tablist" aria-label="Mode">
              {(Object.keys(editorModes) as EditorMode[]).map((item) => (
                <button
                  type="button"
                  className={mode === item ? "is-active" : ""}
                  key={item}
                  role="tab"
                  aria-selected={mode === item}
                  onClick={() => setMode(item)}
                >
                  {editorModes[item].label}
                </button>
              ))}
            </div>
            <span className="tool-divider" />
            <button
              type="button"
              className="history-action"
              disabled={!snapshot.canUndo || isHistoryPreview}
              onClick={() => project?.undo()}
              title="Undo (Ctrl+Z)"
            >
              <ArrowUturnLeftIcon aria-hidden="true" /> Undo
            </button>
            <button
              type="button"
              className="history-action"
              disabled={!snapshot.canRedo || isHistoryPreview}
              onClick={() => project?.redo()}
              title="Redo (Ctrl+Shift+Z)"
            >
              <ArrowUturnRightIcon aria-hidden="true" /> Redo
            </button>
            {previewCommit && (
              <div className="history-preview-bar">
                <span>Viewing {checkpointVersion(previewCommit, snapshot.checkpoints)}</span>
                <button type="button" onClick={() => setPreviewCommitId(null)}>
                  Return to current version
                </button>
                <button
                  type="button"
                  className="is-active edit-from-here"
                  onClick={() =>
                    void project
                      ?.checkout(previewCommit.payload.id)
                      .then(() => setPreviewCommitId(null))
                  }
                >
                  Edit from here
                </button>
              </div>
            )}
            <button
              type="button"
              aria-pressed={singlePageMode}
              onClick={() => setSinglePageMode((singlePage) => !singlePage)}
            >
              {singlePageMode ? "Paged view" : "Single page"}
            </button>
            {mode === "write" && (
              <>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" className="insert-element-button">
                      <span className="insert-plus">＋</span> Element
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal container={portalRoot}>
                    <DropdownMenu.Content className="menu element-menu" align="start">
                      {paragraphTypes.map((item) => (
                        <DropdownMenu.Item
                          className="menu-item element-menu-item"
                          key={item.value}
                          onSelect={() => {
                            const last = snapshot.paragraphs.at(-1);
                            if (last) void insertElement(last.id, item.value);
                          }}
                        >
                          <span>{item.label}</span>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button
                  type="button"
                  className={showAnnotations ? "is-active" : ""}
                  aria-pressed={showAnnotations}
                  onClick={() => setShowAnnotations((visible) => !visible)}
                >
                  {showAnnotations ? "Hide notes" : "Show notes"}
                </button>
              </>
            )}
            {mode === "annotate" &&
              tools.map((item) => (
                <Tooltip.Root key={item.kind}>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className={tool === item.kind ? "is-active" : ""}
                      onClick={() => setTool(item.kind)}
                      aria-pressed={tool === item.kind}
                    >
                      <span className={`tool-icon tool-${item.kind}`} />
                      {item.label}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal container={portalRoot}>
                    <Tooltip.Content className="tooltip" sideOffset={8}>
                      Select text to {item.label.toLowerCase()} · {item.key}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ))}
          </div>

          <div className={`page-wrap${singlePageMode ? " page-wrap--single" : ""}`} ref={pageWrap}>
            {pages.map((page, pageIndex) => (
              <section
                className={`screenplay-page${mode === "annotate" ? " screenplay-page--annotate" : ""}${isHistoryPreview ? " screenplay-page--history-preview" : ""}`}
                aria-label={`Editable screenplay page ${pageIndex + 1}`}
                data-page-number={pageIndex + 1}
                key={`page-${page.map((paragraph) => paragraph.id).join("-")}`}
                onPointerMove={pageIndex === 0 ? publishPointer : undefined}
                onPointerLeave={pageIndex === 0 ? () => project?.clearPointer() : undefined}
                onMouseMove={
                  mode === "write" && !isHistoryPreview ? updateHoveredParagraph : undefined
                }
                onMouseLeave={() => setHoveredParagraphId(null)}
                onMouseUp={selectAcrossElements}
              >
                {snapshot.presences.map(
                  (presence) =>
                    presence.pointer && (
                      <span
                        className="remote-pointer"
                        key={`pointer-${presence.clientId}`}
                        style={{
                          left: `${presence.pointer.x * 100}%`,
                          top: `${presence.pointer.y * 100}%`,
                          color: presence.author.color,
                        }}
                        aria-label={`${presence.author.name}'s pointer`}
                      >
                        <span style={{ background: presence.author.color }}>
                          {presence.author.name}
                        </span>
                      </span>
                    ),
                )}
                <span className="page-number">{pageIndex + 1}.</span>
                <div
                  className="screenplay-editable"
                  contentEditable={mode === "write" && !isHistoryPreview}
                  suppressContentEditableWarning
                  onKeyDown={handleScreenplayKey}
                  onCopy={copyFormattedSelection}
                >
                  {page.map((paragraph) => {
                    const marks = viewedAnnotations.filter(
                      (entry) => entry.payload.paragraphId === paragraph.id,
                    );
                    const visibleMarks = mode !== "write" || showAnnotations ? marks : [];
                    return (
                      <div
                        className={`paragraph paragraph-${paragraph.type}${
                          paragraph.id === activeParagraphId ? " is-active" : ""
                        }${paragraph.id === hoveredParagraphId ? " is-hovered" : ""}`}
                        data-paragraph-id={paragraph.id}
                        id={`paragraph-${paragraph.id}`}
                        key={paragraph.id}
                      >
                        <span
                          className="element-type-placeholder"
                          contentEditable={false}
                          aria-hidden="true"
                        >
                          {paragraphTypes.find((item) => item.value === paragraph.type)?.label}
                        </span>
                        <select
                          className="element-type-select"
                          contentEditable={false}
                          aria-label={`Element type for ${paragraph.type} paragraph`}
                          value={paragraph.type}
                          disabled={mode === "annotate" || isHistoryPreview}
                          onChange={(event) => {
                            void project?.changeParagraphType(
                              paragraph.id,
                              event.currentTarget.value as ParagraphType,
                            );
                          }}
                        >
                          {paragraphTypes.map((item) => (
                            <option value={item.value} key={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        {visibleMarks.length > 0 && (
                          <div className="annotation-backdrop" aria-hidden="true">
                            {annotationSegments(
                              paragraph.text,
                              visibleMarks.map((entry) => entry.payload),
                            ).map((segment, index) => (
                              <span
                                className={segment.kinds
                                  .map((kind) => `annotation-${kind}`)
                                  .join(" ")}
                                key={`${index}-${segment.text}`}
                              >
                                {segment.text}
                              </span>
                            ))}
                          </div>
                        )}
                        {isHistoryPreview ? (
                          <div
                            className="version-diff"
                            aria-label="Difference from current version"
                          >
                            {diffSegments(
                              snapshot.paragraphs.find((item) => item.id === paragraph.id)?.text ||
                                "",
                              paragraph.text,
                            ).map((segment, index) => (
                              <span
                                className={`version-diff__${segment.type}`}
                                key={`${index}-${segment.text}`}
                              >
                                {segment.text}
                              </span>
                            ))}
                          </div>
                        ) : mode === "write" ? (
                          <div
                            className={
                              visibleMarks.length > 0
                                ? "paragraph-editor has-annotation-backdrop"
                                : "paragraph-editor"
                            }
                            data-paragraph-id={paragraph.id}
                            tabIndex={0}
                            aria-label={`${paragraph.type} paragraph`}
                            data-placeholder={paragraphPlaceholder(
                              paragraph.type,
                              paragraph.id === activeParagraphId,
                            )}
                            onFocus={() => setActiveParagraphId(paragraph.id)}
                            onInput={(event) => {
                              project?.updateParagraph(
                                paragraph.id,
                                event.currentTarget.textContent || "",
                              );
                            }}
                            onBlur={() => {
                              setActiveParagraphId(null);
                              void project?.commitParagraph(paragraph.id);
                            }}
                          >
                            {paragraph.text}
                          </div>
                        ) : (
                          <textarea
                            aria-label={`${paragraph.type} paragraph`}
                            data-paragraph-id={paragraph.id}
                            value={paragraph.text}
                            readOnly
                            rows={Math.max(1, paragraph.text.split("\n").length)}
                            onMouseUp={(event) => void selectText(paragraph, event.currentTarget)}
                          />
                        )}
                        {mode === "annotate" && !isHistoryPreview && (
                          <div
                            className="annotation-selectable"
                            data-paragraph-id={paragraph.id}
                            aria-label={`${paragraph.type} paragraph`}
                          >
                            {visibleMarks.length > 0
                              ? annotationSegments(
                                  paragraph.text,
                                  visibleMarks.map((entry) => entry.payload),
                                ).map((segment, index) => (
                                  <span
                                    className={segment.kinds
                                      .map((kind) => `annotation-${kind}`)
                                      .join(" ")}
                                    key={`${index}-${segment.text}`}
                                  >
                                    {segment.text}
                                  </span>
                                ))
                              : paragraph.text}
                          </div>
                        )}
                        {snapshot.presences.map(
                          (presence) =>
                            presence.cursor?.paragraphId === paragraph.id && (
                              <RemoteCaret
                                key={`caret-${presence.clientId}`}
                                presence={presence}
                                text={paragraph.text}
                              />
                            ),
                        )}
                        {visibleMarks.length > 0 && (
                          <span
                            className="signed-mark"
                            title={`${visibleMarks.length} signed annotation${visibleMarks.length === 1 ? "" : "s"}`}
                          >
                            ✦
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pageIndex === pages.length - 1 &&
                  mode === "write" &&
                  !isHistoryPreview &&
                  snapshot.paragraphs.length > 0 && (
                    <button
                      className="page-add-element"
                      type="button"
                      onClick={() => void insertElement(snapshot.paragraphs.at(-1)!.id, "action")}
                    >
                      <span>＋</span> Add screenplay element
                    </button>
                  )}
                {pageIndex === pages.length - 1 && (
                  <p className="writing-hint">{editorModes[mode].description}</p>
                )}
              </section>
            ))}
          </div>
        </main>

        <aside className="provenance-panel">
          <div className="panel-tabs" role="tablist" aria-label="Draft activity">
            <button
              className={activeSidebarTab === "notes" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeSidebarTab === "notes"}
              onClick={() => setActiveSidebarTab("notes")}
            >
              Notes <span>{snapshot.annotations.length}</span>
            </button>
            <button
              className={activeSidebarTab === "history" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeSidebarTab === "history"}
              onClick={() => setActiveSidebarTab("history")}
            >
              History <span>{snapshot.checkpoints.length}</span>
            </button>
          </div>
          <div className="audit-stamp">
            <span className={audit.total === audit.valid ? "verified" : "invalid"}>✓</span>
            <div>
              <strong>
                {audit.valid}/{audit.total} signatures verified
              </strong>
              <small>Ed25519 provenance audit</small>
            </div>
          </div>
          <div className="provenance-feed">
            {activeSidebarTab === "notes" && snapshot.annotations.length === 0 ? (
              <div className="empty-notes">
                <span>⌁</span>
                <strong>No notes on this draft</strong>
                <p>Select screenplay text, then choose a markup tool.</p>
              </div>
            ) : activeSidebarTab === "notes" ? (
              [...snapshot.annotations].reverse().map((entry) => (
                <article className={`note-card note-${entry.payload.kind}`} key={entry.payload.id}>
                  <div className="note-head">
                    <img
                      className="note-avatar"
                      src={avatarUrlFor(entry.author)}
                      alt={`${entry.author.name} avatar`}
                    />
                    <div>
                      <strong>{entry.author.name}</strong>
                      <small>{entry.payload.kind} · signed</small>
                    </div>
                    <time>
                      {new Date(entry.payload.createdAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                    {canDeleteAnnotation(entry, identity?.id) && (
                      <button
                        className="note-remove"
                        type="button"
                        onClick={() => void project?.deleteAnnotation(entry.payload.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <blockquote>{entry.payload.quote}</blockquote>
                  {entry.payload.replacement && (
                    <p className="replacement">→ {entry.payload.replacement}</p>
                  )}
                  {entry.payload.body && <p>{entry.payload.body}</p>}
                  <code>{shortId(entry.signature)}</code>
                </article>
              ))
            ) : snapshot.checkpoints.length === 0 && !snapshot.hasUnsavedChanges ? (
              <div className="empty-notes">
                <span>⌁</span>
                <strong>No saved versions yet</strong>
                <p>Pause for 10 seconds to save automatically, or save a signed version now.</p>
              </div>
            ) : (
              <>
                {snapshot.hasUnsavedChanges && (
                  <div className="history-card is-current history-card--working">
                    <strong>{workingVersionLabel}</strong>
                    <time>Current Working Version</time>
                    <p>Unsaved Changes · Saves Automatically After You Pause</p>
                    <small>
                      {currentVersion ? `Based on ${currentVersionLabel}` : "Initial Version"}
                    </small>
                  </div>
                )}
                {historyEntries.map((entry) => (
                  <button
                    className={`history-card${entry.payload.id === snapshot.currentVersionId ? " is-current" : ""}${entry.payload.id === previewCommitId ? " is-preview" : ""}`}
                    type="button"
                    key={entry.payload.id}
                    style={{
                      marginLeft: `${Math.min(3, checkpointBranchDepth(entry.payload.id, snapshot.checkpoints)) * 10}px`,
                    }}
                    disabled={!entry.payload.state}
                    onClick={() => void previewHistoryEntry(entry.payload.id)}
                  >
                    <strong>{checkpointVersion(entry, snapshot.checkpoints)}</strong>
                    <time>
                      {new Date(entry.payload.createdAt).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                    <p>
                      {entry.payload.kind === "auto" ? "Saved automatically" : "Saved manually"} ·{" "}
                      {entry.payload.operationCount} signed changes
                    </p>
                    <small>
                      {entry.payload.id === snapshot.currentVersionId
                        ? "Current Saved Version"
                        : !entry.payload.state
                          ? "Legacy Version · Not Previewable"
                          : entry.payload.parent
                            ? `${checkpointIsBranched(entry, snapshot.checkpoints) ? "Branched from" : "After"} ${checkpointVersion(snapshot.checkpoints.find((candidate) => candidate.payload.id === entry.payload.parent) || entry, snapshot.checkpoints)}`
                            : "Initial Version"}
                    </small>
                    <code>{shortId(entry.payload.stateHash)}</code>
                  </button>
                ))}
              </>
            )}
          </div>
          <button
            className="checkpoint-button"
            type="button"
            onClick={() => setCheckpointOpen(true)}
          >
            <span>＋</span> Save signed version
          </button>
        </aside>

        <Dialog.Root open={newScriptOpen} onOpenChange={setNewScriptOpen}>
          <Dialog.Portal container={portalRoot}>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content compact-dialog">
              <Dialog.Title>Start a new screenplay</Dialog.Title>
              <Dialog.Description>
                Begin with a blank page. The draft stays on this device until you share it.
              </Dialog.Description>
              <label className="field-label" htmlFor="new-script-title">
                Title
              </label>
              <input
                id="new-script-title"
                autoFocus
                value={newScriptTitle}
                onChange={(event) => setNewScriptTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createScript();
                }}
                placeholder="Untitled screenplay"
              />
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button className="quiet-button" type="button">
                    Cancel
                  </button>
                </Dialog.Close>
                <button className="share-button" type="button" onClick={createScript}>
                  Create blank script
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={detailsOpen} onOpenChange={setDetailsOpen}>
          <Dialog.Portal container={portalRoot}>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content details-dialog">
              <Dialog.Title>Screenplay details</Dialog.Title>
              <Dialog.Description>
                Add the story at a glance. Choose up to two genres.
              </Dialog.Description>
              <div className="details-field-heading">
                <label className="field-label">Genres</label>
                <span>{genreDraft.length}/2 selected</span>
              </div>
              <div className="genre-selector" aria-label="Genres">
                {genres.map((genre) => {
                  const selected = genreDraft.includes(genre);
                  return (
                    <button
                      className={selected ? "is-selected" : ""}
                      type="button"
                      key={genre}
                      aria-pressed={selected}
                      disabled={!selected && genreDraft.length === 2}
                      onClick={() => toggleGenre(genre)}
                    >
                      {genre}
                    </button>
                  );
                })}
              </div>
              <label className="field-label" htmlFor="screenplay-logline">
                Logline
              </label>
              <textarea
                id="screenplay-logline"
                value={loglineDraft}
                maxLength={1000}
                onChange={(event) => setLoglineDraft(event.currentTarget.value)}
                placeholder="A single sentence that captures the central conflict…"
              />
              <div className="details-character-count">{loglineDraft.length}/1000</div>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button className="quiet-button" type="button">
                    Cancel
                  </button>
                </Dialog.Close>
                <button className="share-button" type="button" onClick={saveDetails}>
                  Save details
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Portal container={portalRoot}>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content">
              <Dialog.Title>
                {tool === "replace" ? "Suggest replacement" : `Add ${tool} note`}
              </Dialog.Title>
              <Dialog.Description>
                “
                {selection?.ranges
                  .map((range) => range.paragraph.text.slice(range.start, range.end))
                  .join(" ")}
                ”
              </Dialog.Description>
              {tool === "replace" && (
                <input
                  autoFocus
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  onKeyDown={handleAnnotationDialogKey}
                  placeholder="Replacement text"
                />
              )}
              <textarea
                autoFocus={tool !== "replace"}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={handleAnnotationDialogKey}
                placeholder="Add context for collaborators…"
              />
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button className="quiet-button" type="button">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  className="share-button"
                  type="button"
                  onClick={() => void saveAnnotation()}
                >
                  Sign and add
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={checkpointOpen} onOpenChange={setCheckpointOpen}>
          <Dialog.Portal container={portalRoot}>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content compact-dialog">
              <Dialog.Title>Save signed version</Dialog.Title>
              <Dialog.Description>
                This creates the next version and resets the automatic-save timer.
              </Dialog.Description>
              <input
                autoFocus
                value={checkpointMessage}
                onChange={(event) => setCheckpointMessage(event.target.value)}
                placeholder="What changed?"
              />
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button className="quiet-button" type="button">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  className="share-button"
                  type="button"
                  onClick={() =>
                    void project?.checkpoint(checkpointMessage).then(() => {
                      setCheckpointOpen(false);
                      setCheckpointMessage("");
                    })
                  }
                >
                  Save version
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={shareOpen} onOpenChange={setShareOpen}>
          <Dialog.Portal container={portalRoot}>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content compact-dialog">
              <Dialog.Title>Share this local draft</Dialog.Title>
              <Dialog.Description>
                The fragment below is the room secret. The signaling service coordinates peers but
                never receives the draft.
              </Dialog.Description>
              <input
                readOnly
                value={location.href}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="privacy-note">
                <span>◉</span>
                <p>
                  <strong>No project upload</strong>Your browser sends encrypted Yjs updates
                  directly to invited peers. TURN may relay encrypted transport when direct
                  connections fail.
                </p>
              </div>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button className="quiet-button" type="button">
                    Done
                  </button>
                </Dialog.Close>
                <button
                  className="share-button"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(location.href)}
                >
                  Copy invite link
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <div className="subscript-write-portal-root" ref={setPortalRoot} />
      </div>
    </Tooltip.Provider>
  );
}

export default App;
