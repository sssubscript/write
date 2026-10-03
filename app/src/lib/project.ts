import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import { transformAnnotations } from "./annotation_ranges";
import type { WriteConfig } from "./config";
import type { ScreenplayParagraph } from "./fdx";
import { blankParagraph } from "./fdx";
import type { DeviceIdentity, Signed } from "./identity";
import { digest, sign as signPayload, verify } from "./identity";

export type AnnotationKind = "highlight" | "strikethrough" | "replace" | "comment";

export type Annotation = {
  id: string;
  paragraphId: string;
  kind: AnnotationKind;
  start: number;
  end: number;
  quote: string;
  body: string;
  replacement?: string;
  createdAt: string;
};

export type EditOperation = {
  id: string;
  kind:
    | "create"
    | "import"
    | "edit"
    | "insert"
    | "delete"
    | "move"
    | "type"
    | "annotate"
    | "resolve";
  paragraphId?: string;
  before?: string;
  after: string;
  changes?: TextDelta[];
  createdAt: string;
};

export type TextDelta = { index: number; deleteCount: number; insert: string };

export const reorderSceneParagraphs = (
  paragraphs: ScreenplayParagraph[],
  sceneId: string,
  beforeSceneId: string | null,
) => {
  const sceneStart = paragraphs.findIndex(
    (paragraph) => paragraph.id === sceneId && paragraph.type === "scene-heading",
  );
  if (sceneStart < 0 || sceneId === beforeSceneId) return paragraphs;

  const sceneEnd = paragraphs.findIndex(
    (paragraph, index) => index > sceneStart && paragraph.type === "scene-heading",
  );
  const moving = paragraphs.slice(sceneStart, sceneEnd < 0 ? undefined : sceneEnd);
  const remaining = paragraphs.filter((paragraph) => !moving.includes(paragraph));
  const insertionIndex = beforeSceneId
    ? remaining.findIndex((paragraph) => paragraph.id === beforeSceneId)
    : remaining.length;
  if (insertionIndex < 0) return paragraphs;

  const reordered = [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];
  return reordered.every((paragraph, index) => paragraph === paragraphs[index])
    ? paragraphs
    : reordered;
};

export const shouldCreateVersion = (
  kind: Checkpoint["kind"],
  currentStateHash: string,
  currentStateHashAtVersion?: string,
) => kind === "manual" || currentStateHash !== currentStateHashAtVersion;

export type Checkpoint = {
  id: string;
  parent: string | null;
  version?: string;
  kind: "auto" | "manual";
  message: string;
  stateHash: string;
  operationCount: number;
  state?: {
    paragraphs: ScreenplayParagraph[];
    annotations: Signed<Annotation>[];
  };
  createdAt: string;
};

export type ProjectSnapshot = {
  title: string;
  logline: string;
  genres: string[];
  paragraphs: ScreenplayParagraph[];
  annotations: Signed<Annotation>[];
  operations: Signed<EditOperation>[];
  checkpoints: Signed<Checkpoint>[];
  currentVersionId: string | null;
  hasUnsavedChanges: boolean;
  peers: number;
  connected: boolean;
  presences: CollaboratorPresence[];
  canUndo: boolean;
  canRedo: boolean;
};

export type CollaboratorPresence = {
  clientId: number;
  author: { id: string; name: string; color: string };
  cursor?: { paragraphId: string; anchor: number; head: number };
  pointer?: { x: number; y: number };
};

const localOrigin = Symbol("signed-local-edit");

export const parseStoredGenres = (value?: string) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((genre): genre is string => typeof genre === "string")
      : [];
  } catch {
    return [];
  }
};

export const canDeleteAnnotation = (annotation: Signed<Annotation>, identityId?: string) =>
  annotation.author.id === identityId;

const parseVersion = (version: string) => {
  const match = /^v(\d+)(?:\.(\d+))?$/.exec(version);
  return match ? { primary: Number(match[1]), branch: match[2] ? Number(match[2]) : null } : null;
};

export const nextVersionLabel = (currentVersion: string | null, savedVersions: string[]) => {
  if (!currentVersion) return "v0";
  const current = parseVersion(currentVersion);
  if (!current) return "v0";
  const parsedVersions = savedVersions.map(parseVersion).filter((version) => version !== null);

  if (current.branch !== null) {
    const nextBranch =
      Math.max(
        -1,
        ...parsedVersions
          .filter((version) => version.primary === current.primary && version.branch !== null)
          .map((version) => version.branch as number),
      ) + 1;
    return `v${current.primary}.${nextBranch}`;
  }

  const latestPrimary = Math.max(-1, ...parsedVersions.map((version) => version.primary));
  if (current.primary === latestPrimary) return `v${latestPrimary + 1}`;
  const nextBranch =
    Math.max(
      -1,
      ...parsedVersions
        .filter((version) => version.primary === current.primary && version.branch !== null)
        .map((version) => version.branch as number),
    ) + 1;
  return `v${current.primary}.${nextBranch}`;
};

export const checkpointVersion = (
  checkpoint: Signed<Checkpoint>,
  checkpoints: Signed<Checkpoint>[],
) =>
  checkpoint.payload.version ||
  `v${Math.max(
    0,
    checkpoints.findIndex((entry) => entry.payload.id === checkpoint.payload.id),
  )}`;

export const checkpointBranchDepth = (checkpointId: string, checkpoints: Signed<Checkpoint>[]) => {
  const checkpoint = checkpoints.find((entry) => entry.payload.id === checkpointId);
  return checkpoint && checkpointVersion(checkpoint, checkpoints).includes(".") ? 1 : 0;
};

export const checkpointIsBranched = (
  checkpoint: Signed<Checkpoint>,
  checkpoints: Signed<Checkpoint>[],
) => checkpointVersion(checkpoint, checkpoints).includes(".");

const paragraphText = (paragraph: Y.Map<unknown>) => {
  const value = paragraph.get("text");
  return value instanceof Y.Text ? value.toString() : typeof value === "string" ? value : "";
};

export const updateYText = (text: Y.Text, next: string): TextDelta | null => {
  const current = text.toString();
  if (current === next) return null;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
    currentEnd--;
    nextEnd--;
  }
  if (currentEnd > start) text.delete(start, currentEnd - start);
  if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
  return {
    index: start,
    deleteCount: currentEnd - start,
    insert: next.slice(start, nextEnd),
  };
};

const mapParagraph = (paragraph: ScreenplayParagraph) => {
  const map = new Y.Map<unknown>();
  const text = new Y.Text();
  if (paragraph.text) text.insert(0, paragraph.text);
  map.set("id", paragraph.id);
  map.set("type", paragraph.type);
  map.set("text", text);
  return map;
};

const openingProjects = new Map<string, Promise<LocalProject>>();

export class LocalProject {
  readonly doc = new Y.Doc();
  readonly persistence: IndexeddbPersistence;
  private readonly meta = this.doc.getMap<string>("meta");
  private readonly paragraphStore = this.doc.getArray<Y.Map<unknown>>("paragraphs");
  private readonly annotationStore = this.doc.getArray<Signed<Annotation>>("annotations");
  private readonly operationStore = this.doc.getArray<Signed<EditOperation>>("operations");
  private readonly checkpointStore = this.doc.getArray<Signed<Checkpoint>>("checkpoints");
  private readonly undoManager = new Y.UndoManager([this.paragraphStore, this.annotationStore], {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 500,
  });
  private listeners = new Set<() => void>();
  private provider: WebrtcProvider | null = null;
  private peerCount = 0;
  private snapshotCache: ProjectSnapshot | null = null;
  private pendingEditBefore = new Map<string, string>();
  private pendingEditAfter = new Map<string, string>();
  private pendingEditChanges = new Map<string, TextDelta[]>();
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private committingEdits = new Map<string, Promise<void>>();
  private idleCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private hasUnsavedChanges = false;

  private sign = <T>(payload: T) => signPayload(this.identity, payload, this.config);

  private constructor(
    readonly identity: DeviceIdentity,
    projectId: string,
    private readonly config: WriteConfig,
  ) {
    this.persistence = new IndexeddbPersistence(`subscript-editor-${projectId}`, this.doc);
    this.doc.on("update", this.emit);
    this.undoManager.on("stack-item-added", this.emit);
    this.undoManager.on("stack-item-popped", this.emit);
    this.undoManager.on("stack-cleared", this.emit);
  }

  static async open(
    identity: DeviceIdentity,
    config: WriteConfig,
    projectId = "local-draft",
    initialTitle = "Untitled screenplay",
  ) {
    // Opening the same empty project twice (e.g. a StrictMode double effect) would create two
    // blank documents that merge in IndexedDB, so each open waits for the previous one to finish.
    const previous = openingProjects.get(projectId);
    const opening = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
      const project = new LocalProject(identity, projectId, config);
      await project.persistence.whenSynced;
      project.migrateParagraphText();
      if (project.paragraphStore.length === 0) {
        project.createDocument(initialTitle);
      }
      return project;
    });
    openingProjects.set(projectId, opening);
    try {
      return await opening;
    } finally {
      if (openingProjects.get(projectId) === opening) openingProjects.delete(projectId);
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private migrateParagraphText() {
    this.doc.transact(() => {
      for (const paragraph of this.paragraphStore) {
        const value = paragraph.get("text");
        if (value instanceof Y.Text) continue;
        const text = new Y.Text();
        if (typeof value === "string" && value) text.insert(0, value);
        paragraph.set("text", text);
      }
    }, localOrigin);
  }

  private emit = () => {
    this.snapshotCache = null;
    for (const listener of this.listeners) listener();
  };

  snapshot = (): ProjectSnapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        title: this.meta.get("title") || "Untitled screenplay",
        logline: this.meta.get("logline") || "",
        genres: parseStoredGenres(this.meta.get("genres")),
        paragraphs: this.paragraphStore.map((paragraph) => ({
          id: String(paragraph.get("id") || crypto.randomUUID()),
          type: String(paragraph.get("type") || "action") as ScreenplayParagraph["type"],
          text: paragraphText(paragraph),
        })),
        annotations: this.annotationStore.toArray(),
        operations: this.operationStore.toArray(),
        checkpoints: this.checkpointStore.toArray(),
        currentVersionId:
          this.meta.get("currentVersionId") || this.meta.get("headCommitId") || null,
        hasUnsavedChanges: this.hasUnsavedChanges || this.checkpointStore.length === 0,
        peers: this.peerCount,
        connected: Boolean(this.provider?.connected),
        presences: this.remotePresences(),
        canUndo: this.undoManager.undoStack.length > 0,
        canRedo: this.undoManager.redoStack.length > 0,
      };
    }
    return this.snapshotCache;
  };

  async replaceDocument(
    title: string,
    paragraphs: ScreenplayParagraph[],
    kind: "create" | "import" = "import",
  ) {
    const documentId = crypto.randomUUID();
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind,
      after: await digest(paragraphs),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.meta.set("title", title);
      this.meta.delete("logline");
      this.meta.delete("genres");
      this.meta.set("owner", this.identity.id);
      this.meta.set("documentId", documentId);
      this.paragraphStore.delete(0, this.paragraphStore.length);
      this.annotationStore.delete(0, this.annotationStore.length);
      this.operationStore.delete(0, this.operationStore.length);
      this.checkpointStore.delete(0, this.checkpointStore.length);
      this.meta.delete("currentVersionId");
      this.meta.delete("headCommitId");
      this.paragraphStore.push(paragraphs.map(mapParagraph));
      this.operationStore.push([operation]);
    }, localOrigin);
    this.undoManager.clear();
    this.markActivity();
  }

  createDocument(title: string) {
    const paragraph = blankParagraph();
    const paragraphs = [paragraph];
    const documentId = crypto.randomUUID();
    this.doc.transact(() => {
      this.meta.set("title", title.trim() || "Untitled screenplay");
      this.meta.delete("logline");
      this.meta.delete("genres");
      this.meta.set("owner", this.identity.id);
      this.meta.set("documentId", documentId);
      this.paragraphStore.delete(0, this.paragraphStore.length);
      this.annotationStore.delete(0, this.annotationStore.length);
      this.operationStore.delete(0, this.operationStore.length);
      this.checkpointStore.delete(0, this.checkpointStore.length);
      this.meta.delete("currentVersionId");
      this.meta.delete("headCommitId");
      this.paragraphStore.push(paragraphs.map(mapParagraph));
    }, localOrigin);
    this.undoManager.clear();
    void this.signCreatedDocument(documentId, paragraphs);
    this.markActivity();
    return paragraph.id;
  }

  updateTitle(title: string) {
    this.doc.transact(() => {
      this.meta.set("title", title.trim() || "Untitled screenplay");
    }, localOrigin);
    this.markActivity();
  }

  updateDetails(logline: string, genres: string[]) {
    this.doc.transact(() => {
      this.meta.set("logline", logline.trim());
      this.meta.set("genres", JSON.stringify(genres));
    }, localOrigin);
    this.markActivity();
  }

  private async signCreatedDocument(documentId: string, paragraphs: ScreenplayParagraph[]) {
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "create",
      after: await digest(paragraphs),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    if (this.meta.get("documentId") !== documentId) return;
    this.doc.transact(() => this.operationStore.push([operation]), localOrigin);
  }

  updateParagraph(id: string, text: string) {
    const paragraph = this.paragraphStore.toArray().find((candidate) => candidate.get("id") === id);
    if (!paragraph || paragraphText(paragraph) === text) return;
    if (!this.pendingEditBefore.has(id)) this.pendingEditBefore.set(id, paragraphText(paragraph));
    let change: TextDelta | null = null;
    this.doc.transact(() => {
      const sharedText = paragraph.get("text");
      if (sharedText instanceof Y.Text) change = updateYText(sharedText, text);
    }, localOrigin);
    if (!change) return;
    this.pendingEditAfter.set(id, text);
    this.pendingEditChanges.set(id, [...(this.pendingEditChanges.get(id) || []), change]);
    const previousTimer = this.editTimers.get(id);
    if (previousTimer) clearTimeout(previousTimer);
    this.editTimers.set(
      id,
      setTimeout(() => void this.commitParagraph(id), 400),
    );
    this.markActivity();
  }

  undo() {
    if (!this.undoManager.undoStack.length) return false;
    this.discardPendingEdits();
    this.undoManager.undo();
    this.markActivity();
    return true;
  }

  redo() {
    if (!this.undoManager.redoStack.length) return false;
    this.discardPendingEdits();
    this.undoManager.redo();
    this.markActivity();
    return true;
  }

  async flushPendingEdits() {
    while (this.editTimers.size || this.committingEdits.size) {
      const pending = [...this.editTimers.keys()].map((id) => this.commitParagraph(id));
      await Promise.all([...pending, ...this.committingEdits.values()]);
    }
  }

  async commitParagraph(id: string) {
    const inFlight = this.committingEdits.get(id);
    if (inFlight) return inFlight;
    const commit = this.commitParagraphNow(id);
    this.committingEdits.set(id, commit);
    try {
      await commit;
    } finally {
      this.committingEdits.delete(id);
    }
  }

  private async commitParagraphNow(id: string) {
    const paragraph = this.paragraphStore.toArray().find((candidate) => candidate.get("id") === id);
    const beforeText = this.pendingEditBefore.get(id);
    const afterText = this.pendingEditAfter.get(id);
    const changes = this.pendingEditChanges.get(id);
    const timer = this.editTimers.get(id);
    if (timer) clearTimeout(timer);
    this.editTimers.delete(id);
    this.pendingEditBefore.delete(id);
    this.pendingEditAfter.delete(id);
    this.pendingEditChanges.delete(id);
    if (!paragraph || beforeText === undefined || afterText === undefined || !changes?.length)
      return;
    if (beforeText === afterText) return;
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "edit",
      paragraphId: id,
      before: await digest(beforeText),
      after: await digest(afterText),
      changes,
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    const currentAnnotations = this.annotationStore
      .toArray()
      .filter((annotation) => annotation.payload.paragraphId === id);
    const nextAnnotations = transformAnnotations(
      currentAnnotations.map((annotation) => annotation.payload),
      changes,
      afterText,
    );
    const changedAnnotationIds = new Set(
      currentAnnotations
        .filter((annotation) => {
          const next = nextAnnotations.find((candidate) => candidate.id === annotation.payload.id);
          return (
            !next ||
            next.start !== annotation.payload.start ||
            next.end !== annotation.payload.end ||
            next.quote !== annotation.payload.quote
          );
        })
        .map((annotation) => annotation.payload.id),
    );
    const resignedAnnotations = await Promise.all(
      nextAnnotations.map(async (annotation) =>
        changedAnnotationIds.has(annotation.id)
          ? this.sign(annotation)
          : currentAnnotations.find((entry) => entry.payload.id === annotation.id)!,
      ),
    );
    this.doc.transact(() => this.operationStore.push([operation]), localOrigin);
    if (!changedAnnotationIds.size) return;
    this.doc.transact(() => {
      const retained = this.annotationStore
        .toArray()
        .filter((annotation) => annotation.payload.paragraphId !== id);
      this.annotationStore.delete(0, this.annotationStore.length);
      this.annotationStore.push([...retained, ...resignedAnnotations]);
    }, localOrigin);
    this.undoManager.stopCapturing();
    this.markActivity();
  }

  async insertParagraph(afterId: string, type: ScreenplayParagraph["type"]) {
    const paragraphs = this.paragraphStore.toArray();
    const afterIndex = paragraphs.findIndex((paragraph) => paragraph.get("id") === afterId);
    const paragraph: ScreenplayParagraph = { id: crypto.randomUUID(), type, text: "" };
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "insert",
      paragraphId: paragraph.id,
      after: await digest({ afterId, paragraph }),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.paragraphStore.insert(afterIndex < 0 ? this.paragraphStore.length : afterIndex + 1, [
        mapParagraph(paragraph),
      ]);
      this.operationStore.push([operation]);
    }, localOrigin);
    this.undoManager.stopCapturing();
    this.markActivity();
    return paragraph.id;
  }

  async moveScene(sceneId: string, beforeSceneId: string | null) {
    const current = this.paragraphStore.toArray().map((paragraph) => ({
      id: String(paragraph.get("id")),
      type: String(paragraph.get("type")) as ScreenplayParagraph["type"],
      text: paragraphText(paragraph),
    }));
    const reordered = reorderSceneParagraphs(current, sceneId, beforeSceneId);
    if (reordered === current) return false;

    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "move",
      paragraphId: sceneId,
      before: await digest(current.map((paragraph) => paragraph.id)),
      after: await digest(reordered.map((paragraph) => paragraph.id)),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.paragraphStore.delete(0, this.paragraphStore.length);
      this.paragraphStore.push(reordered.map(mapParagraph));
      this.operationStore.push([operation]);
    }, localOrigin);
    this.undoManager.stopCapturing();
    this.markActivity();
    return true;
  }

  async deleteParagraph(id: string) {
    if (this.paragraphStore.length <= 1) return null;
    const paragraphs = this.paragraphStore.toArray();
    const index = paragraphs.findIndex((paragraph) => paragraph.get("id") === id);
    if (index < 0) return null;
    const previousValue = paragraphs[Math.max(0, index - 1)].get("id");
    const previous = typeof previousValue === "string" ? previousValue : null;
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "delete",
      paragraphId: id,
      before: await digest({
        id: paragraphs[index].get("id"),
        type: paragraphs[index].get("type"),
        text: paragraphText(paragraphs[index]),
      }),
      after: await digest(null),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.paragraphStore.delete(index, 1);
      this.operationStore.push([operation]);
    }, localOrigin);
    this.undoManager.stopCapturing();
    this.markActivity();
    return previous;
  }

  async changeParagraphType(id: string, type: ScreenplayParagraph["type"]) {
    const paragraph = this.paragraphStore.toArray().find((candidate) => candidate.get("id") === id);
    if (!paragraph || paragraph.get("type") === type) return;
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "type",
      paragraphId: id,
      before: await digest(paragraph.get("type")),
      after: await digest(type),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      paragraph.set("type", type);
      this.operationStore.push([operation]);
    }, localOrigin);
    this.undoManager.stopCapturing();
    this.markActivity();
  }

  async addAnnotation(annotation: Omit<Annotation, "id" | "createdAt">) {
    const complete: Annotation = {
      ...annotation,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const signedAnnotation = await this.sign(complete);
    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "annotate",
      paragraphId: annotation.paragraphId,
      after: await digest(complete),
      createdAt: complete.createdAt,
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.annotationStore.push([signedAnnotation]);
      this.operationStore.push([operation]);
    }, localOrigin);
    this.markActivity();
  }

  async deleteAnnotation(id: string) {
    const annotations = this.annotationStore.toArray();
    const index = annotations.findIndex((annotation) => annotation.payload.id === id);
    const annotation = annotations[index];
    if (!annotation || !canDeleteAnnotation(annotation, this.identity.id)) return false;

    const operation = await this.sign({
      id: crypto.randomUUID(),
      kind: "resolve",
      paragraphId: annotation.payload.paragraphId,
      before: await digest(annotation.payload),
      after: await digest(null),
      createdAt: new Date().toISOString(),
    } satisfies EditOperation);
    this.doc.transact(() => {
      this.annotationStore.delete(index, 1);
      this.operationStore.push([operation]);
    }, localOrigin);
    this.markActivity();
    return true;
  }

  async checkpoint(message: string) {
    await this.flushPendingEdits();
    return this.commit(message, "manual");
  }

  async saveWorkingCopy(message = "Saved automatically") {
    await this.flushPendingEdits();
    return this.commit(message, "auto");
  }

  async commit(message: string, kind: Checkpoint["kind"] = "manual") {
    if (kind === "manual") this.clearIdleCommitTimer();
    const state = {
      paragraphs: this.snapshot().paragraphs,
      annotations: this.annotationStore.toArray(),
    };
    const stateHash = await digest(state);
    const checkpoints = this.checkpointStore.toArray();
    const currentVersionId =
      this.meta.get("currentVersionId") || this.meta.get("headCommitId") || null;
    const currentVersion = currentVersionId
      ? checkpoints.find((entry) => entry.payload.id === currentVersionId)
      : undefined;
    if (!shouldCreateVersion(kind, stateHash, currentVersion?.payload.stateHash))
      return currentVersion?.payload.id || null;
    const version = nextVersionLabel(
      currentVersion ? checkpointVersion(currentVersion, checkpoints) : null,
      checkpoints.map((entry) => checkpointVersion(entry, checkpoints)),
    );
    const payload: Checkpoint = {
      id: crypto.randomUUID(),
      parent: currentVersionId,
      version,
      kind,
      message: message.trim() || (kind === "auto" ? "Saved automatically" : "Saved version"),
      stateHash,
      operationCount: this.operationStore.length,
      state,
      createdAt: new Date().toISOString(),
    };
    const commit = await this.sign(payload);
    this.doc.transact(() => {
      this.checkpointStore.push([commit]);
      this.meta.set("currentVersionId", payload.id);
    }, localOrigin);
    this.hasUnsavedChanges = false;
    this.emit();
    return payload.id;
  }

  async checkout(commitId: string) {
    const commit = this.checkpointStore.toArray().find((entry) => entry.payload.id === commitId);
    const state = commit?.payload.state;
    if (!commit || !state) return false;
    await this.flushPendingEdits();
    this.clearIdleCommitTimer();
    this.discardPendingEdits();
    this.doc.transact(() => {
      this.paragraphStore.delete(0, this.paragraphStore.length);
      this.paragraphStore.push(state.paragraphs.map(mapParagraph));
      this.annotationStore.delete(0, this.annotationStore.length);
      this.annotationStore.push(state.annotations);
      this.meta.set("currentVersionId", commit.payload.id);
    }, localOrigin);
    this.undoManager.clear();
    this.hasUnsavedChanges = false;
    this.emit();
    return true;
  }

  private discardPendingEdits() {
    for (const timer of this.editTimers.values()) clearTimeout(timer);
    this.editTimers.clear();
    this.pendingEditBefore.clear();
    this.pendingEditAfter.clear();
    this.pendingEditChanges.clear();
  }

  private markActivity() {
    this.hasUnsavedChanges = true;
    this.emit();
    this.clearIdleCommitTimer();
    this.idleCommitTimer = setTimeout(() => {
      this.idleCommitTimer = null;
      void this.commit("Saved automatically", "auto");
    }, 10_000);
  }

  private clearIdleCommitTimer() {
    if (!this.idleCommitTimer) return;
    clearTimeout(this.idleCommitTimer);
    this.idleCommitTimer = null;
  }

  async audit() {
    const entries: Signed<unknown>[] = [
      ...this.operationStore.toArray(),
      ...this.annotationStore.toArray(),
      ...this.checkpointStore.toArray(),
    ];
    const results = await Promise.all(entries.map(verify));
    return { valid: results.filter(Boolean).length, total: results.length };
  }

  archive() {
    const snapshot = this.snapshot();
    return {
      schema: "org.subscript.signed-draft/v1",
      exportedAt: new Date().toISOString(),
      owner: this.meta.get("owner"),
      title: snapshot.title,
      logline: snapshot.logline,
      genres: snapshot.genres,
      paragraphs: snapshot.paragraphs,
      annotations: snapshot.annotations,
      operations: snapshot.operations,
      checkpoints: snapshot.checkpoints,
    };
  }

  connect(room: string) {
    this.provider?.destroy();
    const signaling = this.config.signalingUrl
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    const iceServers: RTCIceServer[] = [{ urls: this.config.stunUrl }];
    if (this.config.turnUrl) {
      iceServers.push({
        urls: this.config.turnUrl,
        username: this.config.turnUsername,
        credential: this.config.turnCredential,
      });
    }
    this.provider = new WebrtcProvider(room, this.doc, {
      signaling,
      peerOpts: { config: { iceServers } },
    });
    this.provider.awareness.setLocalStateField("author", {
      id: this.identity.id,
      name: this.identity.name,
      color: this.presenceColor(),
    });
    const refresh = () => {
      this.peerCount = Math.max(0, this.provider!.awareness.getStates().size - 1);
      this.emit();
    };
    this.provider.on("status", refresh);
    this.provider.on("peers", refresh);
    this.provider.awareness.on("change", refresh);
    refresh();
  }

  private presenceColor() {
    let hash = 0;
    for (const character of this.identity.id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 68% 58%)`;
  }

  private remotePresences(): CollaboratorPresence[] {
    if (!this.provider) return [];
    return [...this.provider.awareness.getStates()].flatMap(([clientId, state]) => {
      if (clientId === this.doc.clientID || !state.author) return [];
      return [{ clientId, ...state } as CollaboratorPresence];
    });
  }

  setCursor(paragraphId: string, anchor: number, head: number) {
    this.provider?.awareness.setLocalStateField("cursor", { paragraphId, anchor, head });
  }

  clearCursor() {
    this.provider?.awareness.setLocalStateField("cursor", null);
  }

  setPointer(x: number, y: number) {
    this.provider?.awareness.setLocalStateField("pointer", { x, y });
  }

  clearPointer() {
    this.provider?.awareness.setLocalStateField("pointer", null);
  }

  disconnect() {
    this.provider?.destroy();
    this.provider = null;
    this.peerCount = 0;
    this.emit();
  }

  destroy() {
    this.discardPendingEdits();
    this.clearIdleCommitTimer();
    this.provider?.destroy();
    this.persistence.destroy();
    this.doc.destroy();
  }
}
