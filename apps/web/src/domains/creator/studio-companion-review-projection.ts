/**
 * Bounded, presentation-safe projection shared by the primary Studio and its detached companion.
 *
 * The companion never receives the editable document. It gets a small read model plus an optional
 * WebP navigator frame, and sends validated intents back to the primary for execution.
 */

export const STUDIO_COMPANION_NAVIGATOR_MAX_EDGE = 1_280;
export const STUDIO_COMPANION_NAVIGATOR_MAX_BYTES = 2 * 1024 * 1024;
export const STUDIO_COMPANION_NAVIGATOR_MIN_CAPTURE_INTERVAL_MS = 500;
export const STUDIO_COMPANION_REVIEW_MAX_LAYERS = 48;
export const STUDIO_COMPANION_REVIEW_MAX_HISTORY = 24;
export const STUDIO_COMPANION_REVIEW_MAX_COMMENTS = 24;
export const STUDIO_COMPANION_REVIEW_MAX_BRUSHES = 32;
export const STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH = 160;
export const STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH = 120;
export const STUDIO_COMPANION_REVIEW_MAX_EXCERPT_LENGTH = 140;
export const STUDIO_COMPANION_BRUSH_SIZE_MIN = 1;
export const STUDIO_COMPANION_BRUSH_SIZE_MAX = 80;
export const STUDIO_COMPANION_VIEWPORT_MIN_EXTENT = 0.01;

export type StudioCompanionNormalizedPoint = { x: number; y: number };
export type StudioCompanionNormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StudioCompanionLayerSummary = {
  id: string;
  label: string;
  kind: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
};

export type StudioCompanionHistorySummary = {
  index: number;
  label: string;
  current: boolean;
};

export type StudioCompanionCommentSummary = {
  id: string;
  author: string;
  excerpt: string;
  resolved: boolean;
  unread: boolean;
};

export type StudioCompanionBrushChoice = {
  id: string;
  label: string;
};

export type StudioCompanionBrushState = {
  id: string;
  label: string;
  size: number;
  opacity: number;
  color: string;
  choices: StudioCompanionBrushChoice[];
};

export type StudioCompanionReviewProjection = {
  revision: number;
  documentRevision: number;
  pageLabel: string;
  selectionLabel: string | null;
  canUndo: boolean;
  canRedo: boolean;
  captureAllowed: boolean;
  viewport: StudioCompanionNormalizedRect;
  layers: StudioCompanionLayerSummary[];
  history: StudioCompanionHistorySummary[];
  comments: StudioCompanionCommentSummary[];
  brush: StudioCompanionBrushState;
  truncated: {
    layers: number;
    history: number;
    comments: number;
  };
};

export type StudioCompanionBrushPatch = {
  id?: string;
  size?: number;
  opacity?: number;
  color?: string;
};

export type StudioCompanionReviewControl =
  | { kind: "navigate"; point: StudioCompanionNormalizedPoint }
  | { kind: "navigator-demand"; active: boolean }
  | { kind: "select-layer"; layerId: string }
  | { kind: "history"; action: "undo" | "redo" }
  | { kind: "comment-focus"; threadId: string }
  | { kind: "brush"; patch: StudioCompanionBrushPatch };

export type StudioCompanionNavigatorFrame = {
  generation: number;
  revision: number;
  sequence: number;
  width: number;
  height: number;
  blob: Blob;
};

export type StudioCompanionCapturePlan =
  | { kind: "capture" }
  | { kind: "defer"; delayMs: number }
  | { kind: "skip"; reason: "active-stroke" | "clean" | "in-flight" | "invalid" };

export type StudioCompanionScreenLike = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label?: string;
  isPrimary?: boolean;
};

export type StudioCompanionScreenPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
  screenLabel: string;
};

export type ReviewProjectionInput = {
  revision: number;
  documentRevision: number;
  pageLabel: string;
  selectionLabel?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  captureAllowed: boolean;
  viewport: Partial<StudioCompanionNormalizedRect> | null | undefined;
  layers: ReadonlyArray<{
    id: string;
    label: string;
    type?: string;
    hidden?: boolean;
    locked?: boolean;
    selected?: boolean;
  }>;
  layerTotal?: number;
  historyLength: number;
  historyIndex: number;
  comments: ReadonlyArray<{
    id: string;
    author: string;
    body: string;
    resolved?: boolean;
    unread?: boolean;
  }>;
  commentTotal?: number;
  brush: {
    id: string;
    label: string;
    size: number;
    opacity: number;
    color: string;
    choices: ReadonlyArray<StudioCompanionBrushChoice>;
  };
};

export type StudioCompanionReviewProjectionSourceInput = Omit<
  ReviewProjectionInput,
  "layers" | "layerTotal" | "comments" | "commentTotal" | "brush"
> & {
  selectedLayerId: string | null;
  layers: ReadonlyArray<{
    id: string;
    name?: string | null;
    type: string;
    hidden?: boolean;
    locked?: boolean;
  }>;
  layerLabel: (layerId: string) => string;
  comments: ReadonlyArray<{
    id: string;
    author: { displayName?: string | null };
    body: string;
    resolved?: boolean;
  }>;
  unreadCommentIds: readonly string[];
  brush: Omit<ReviewProjectionInput["brush"], "choices"> & {
    choices: ReadonlyArray<{ id: string; name: string }>;
  };
};

export type StudioCompanionNavigatorCaptureOrchestrationInput = {
  request: {
    generation: number;
    revision: number;
    sequence: number;
    signal: AbortSignal;
  };
  isCaptureBlocked: () => boolean;
  captureCanvas: (maximumLongestEdge: number) => HTMLCanvasElement | null;
};

// eslint-disable-next-line no-control-regex -- Reject transport control bytes in bounded labels/ids.
const CONTROL_CHARACTER_PATTERN = /[\0-\x1f\x7f]/u;
// eslint-disable-next-line no-control-regex -- Replace transport control bytes before projection.
const CONTROL_CHARACTER_REPLACE_PATTERN = /[\0-\x1f\x7f]/gu;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cleanText(value: unknown, maximum: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(CONTROL_CHARACTER_REPLACE_PATTERN, " ").replace(/\s+/gu, " ").trim();
  return normalized.slice(0, maximum) || fallback;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function hasUniqueValues<T>(values: readonly T[], select: (value: T) => string): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = select(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function normalizeStudioCompanionPoint(
  point: Partial<StudioCompanionNormalizedPoint> | null | undefined
): StudioCompanionNormalizedPoint {
  return {
    x: clamp(finite(point?.x) ? point.x : 0.5, 0, 1),
    y: clamp(finite(point?.y) ? point.y : 0.5, 0, 1),
  };
}

export function normalizeStudioCompanionViewport(
  viewport: Partial<StudioCompanionNormalizedRect> | null | undefined
): StudioCompanionNormalizedRect {
  const width = clamp(
    finite(viewport?.width) ? viewport.width : 1,
    STUDIO_COMPANION_VIEWPORT_MIN_EXTENT,
    1
  );
  const height = clamp(
    finite(viewport?.height) ? viewport.height : 1,
    STUDIO_COMPANION_VIEWPORT_MIN_EXTENT,
    1
  );
  return {
    x: clamp(finite(viewport?.x) ? viewport.x : 0, 0, 1 - width),
    y: clamp(finite(viewport?.y) ? viewport.y : 0, 0, 1 - height),
    width,
    height,
  };
}

function boundedUniqueChoices(
  choices: ReadonlyArray<StudioCompanionBrushChoice>,
  active: StudioCompanionBrushChoice
): StudioCompanionBrushChoice[] {
  const output: StudioCompanionBrushChoice[] = [];
  const seen = new Set<string>();
  const add = (candidate: StudioCompanionBrushChoice) => {
    const id = cleanText(candidate.id, STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH);
    if (!id || seen.has(id)) return;
    seen.add(id);
    output.push({
      id,
      label: cleanText(candidate.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH, id),
    });
  };
  add(active);
  for (const candidate of choices) {
    add(candidate);
    if (output.length >= STUDIO_COMPANION_REVIEW_MAX_BRUSHES) break;
  }
  return output;
}

export function createStudioCompanionReviewProjectionFromSource(
  input: StudioCompanionReviewProjectionSourceInput
): StudioCompanionReviewProjection {
  const selectedLayer = input.selectedLayerId
    ? input.layers.find((layer) => layer.id === input.selectedLayerId) ?? null
    : null;
  const layerCandidates = input.layers.slice(-STUDIO_COMPANION_REVIEW_MAX_LAYERS);
  if (selectedLayer && !layerCandidates.some((layer) => layer.id === selectedLayer.id)) {
    if (layerCandidates.length >= STUDIO_COMPANION_REVIEW_MAX_LAYERS) layerCandidates.shift();
    layerCandidates.push(selectedLayer);
  }

  const unreadIds = new Set(input.unreadCommentIds);
  const unreadComments: ReviewProjectionInput["comments"][number][] = [];
  const readComments: ReviewProjectionInput["comments"][number][] = [];
  for (const comment of input.comments) {
    if (
      unreadComments.length >= STUDIO_COMPANION_REVIEW_MAX_COMMENTS
      && readComments.length >= STUDIO_COMPANION_REVIEW_MAX_COMMENTS
    ) break;
    const unread = unreadIds.has(comment.id);
    const bucket = unread ? unreadComments : readComments;
    if (bucket.length >= STUDIO_COMPANION_REVIEW_MAX_COMMENTS) continue;
    bucket.push({
      id: comment.id,
      author: comment.author.displayName ?? "작업자",
      body: comment.body,
      resolved: comment.resolved,
      unread,
    });
  }

  return createStudioCompanionReviewProjection({
    revision: input.revision,
    documentRevision: input.documentRevision,
    pageLabel: input.pageLabel,
    selectionLabel: input.selectionLabel,
    canUndo: input.canUndo,
    canRedo: input.canRedo,
    captureAllowed: input.captureAllowed,
    viewport: input.viewport,
    layers: layerCandidates.map((layer) => ({
      id: layer.id,
      label: layer.name?.trim() || input.layerLabel(layer.id),
      type: layer.type,
      hidden: layer.hidden,
      locked: layer.locked,
      selected: layer.id === input.selectedLayerId,
    })),
    layerTotal: input.layers.length,
    historyLength: input.historyLength,
    historyIndex: input.historyIndex,
    comments: [...unreadComments, ...readComments].slice(
      0,
      STUDIO_COMPANION_REVIEW_MAX_COMMENTS
    ),
    commentTotal: input.comments.length,
    brush: {
      id: input.brush.id,
      label: input.brush.label,
      size: input.brush.size,
      opacity: input.brush.opacity,
      color: input.brush.color,
      choices: input.brush.choices.slice(0, STUDIO_COMPANION_REVIEW_MAX_BRUSHES).map((choice) => ({
        id: choice.id,
        label: choice.name,
      })),
    },
  });
}

export function createStudioCompanionReviewProjection(
  input: ReviewProjectionInput
): StudioCompanionReviewProjection {
  const revision = safeInteger(input.revision) ? input.revision : 0;
  const documentRevision = safeInteger(input.documentRevision) ? input.documentRevision : 0;
  const projectLayer = (
    layer: ReviewProjectionInput["layers"][number],
    selected: boolean
  ): StudioCompanionLayerSummary => ({
    id: cleanText(layer.id, STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH),
    label: cleanText(layer.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH, "이름 없는 레이어"),
    kind: cleanText(layer.type, 40, "other"),
    visible: layer.hidden !== true,
    locked: layer.locked === true,
    selected,
  });
  let selectedLayer: ReviewProjectionInput["layers"][number] | null = null;
  for (let index = input.layers.length - 1; index >= 0; index -= 1) {
    if (input.layers[index]?.selected === true) {
      selectedLayer = input.layers[index];
      break;
    }
  }
  const layers: StudioCompanionLayerSummary[] = [];
  const layerIds = new Set<string>();
  for (
    let index = input.layers.length - 1;
    index >= 0 && layers.length < STUDIO_COMPANION_REVIEW_MAX_LAYERS;
    index -= 1
  ) {
    const layer = input.layers[index];
    if (!layer) continue;
    const projected = projectLayer(layer, layer === selectedLayer);
    if (!projected.id || layerIds.has(projected.id)) continue;
    layerIds.add(projected.id);
    layers.push(projected);
  }
  if (selectedLayer) {
    const selected = projectLayer(selectedLayer, true);
    if (selected.id && !layerIds.has(selected.id)) {
      if (layers.length >= STUDIO_COMPANION_REVIEW_MAX_LAYERS) {
        const displaced = layers.pop();
        if (displaced) layerIds.delete(displaced.id);
      }
      layers.push(selected);
      layerIds.add(selected.id);
    }
  }

  const historyLength = clamp(
    Number.isSafeInteger(input.historyLength) ? input.historyLength : 0,
    0,
    1_000_000
  );
  const historyIndex = historyLength > 0
    ? clamp(Number.isSafeInteger(input.historyIndex) ? input.historyIndex : 0, 0, historyLength - 1)
    : 0;
  const historyStart = Math.max(0, historyIndex - STUDIO_COMPANION_REVIEW_MAX_HISTORY + 1);
  const historyEnd = Math.min(historyLength, historyStart + STUDIO_COMPANION_REVIEW_MAX_HISTORY);
  const history = Array.from({ length: Math.max(0, historyEnd - historyStart) }, (_, offset) => {
    const index = historyStart + offset;
    return {
      index,
      label: index === 0 ? "문서 시작" : `작업 ${index}`,
      current: index === historyIndex,
    };
  }).reverse();

  const unreadComments: StudioCompanionCommentSummary[] = [];
  const readComments: StudioCompanionCommentSummary[] = [];
  const commentIds = new Set<string>();
  for (const comment of input.comments) {
    const summary = {
      id: cleanText(comment.id, STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH),
      author: cleanText(comment.author, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH, "작업자"),
      excerpt: cleanText(comment.body, STUDIO_COMPANION_REVIEW_MAX_EXCERPT_LENGTH, "내용 없음"),
      resolved: comment.resolved === true,
      unread: comment.unread === true,
    };
    if (!summary.id || commentIds.has(summary.id)) continue;
    commentIds.add(summary.id);
    const bucket = summary.unread ? unreadComments : readComments;
    if (bucket.length < STUDIO_COMPANION_REVIEW_MAX_COMMENTS) bucket.push(summary);
  }
  const comments = [...unreadComments, ...readComments].slice(
    0,
    STUDIO_COMPANION_REVIEW_MAX_COMMENTS
  );

  const brushId = cleanText(input.brush.id, STUDIO_COMPANION_REVIEW_MAX_ID_LENGTH, "pen");
  const brushLabel = cleanText(
    input.brush.label,
    STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH,
    brushId
  );
  return {
    revision,
    documentRevision,
    pageLabel: cleanText(input.pageLabel, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH, "현재 페이지"),
    selectionLabel: input.selectionLabel
      ? cleanText(input.selectionLabel, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH) || null
      : null,
    canUndo: input.canUndo,
    canRedo: input.canRedo,
    captureAllowed: input.captureAllowed,
    viewport: normalizeStudioCompanionViewport(input.viewport),
    layers,
    history,
    comments,
    brush: {
      id: brushId,
      label: brushLabel,
      size: clamp(
        finite(input.brush.size) ? Math.round(input.brush.size) : STUDIO_COMPANION_BRUSH_SIZE_MIN,
        STUDIO_COMPANION_BRUSH_SIZE_MIN,
        STUDIO_COMPANION_BRUSH_SIZE_MAX
      ),
      opacity: clamp(finite(input.brush.opacity) ? input.brush.opacity : 1, 0, 1),
      color: HEX_COLOR_PATTERN.test(input.brush.color) ? input.brush.color.toLowerCase() : "#1a1a1a",
      choices: boundedUniqueChoices(input.brush.choices, { id: brushId, label: brushLabel }),
    },
    truncated: {
      layers: Math.max(
        0,
        (safeInteger(input.layerTotal) ? input.layerTotal : input.layers.length) - layers.length
      ),
      history: Math.max(0, historyLength - history.length),
      comments: Math.max(
        0,
        (safeInteger(input.commentTotal) ? input.commentTotal : input.comments.length) - comments.length
      ),
    },
  };
}

export function isStudioCompanionNormalizedPoint(
  value: unknown
): value is StudioCompanionNormalizedPoint {
  return plainRecord(value)
    && exactKeys(value, ["x", "y"])
    && finite(value.x)
    && finite(value.y)
    && value.x >= 0
    && value.x <= 1
    && value.y >= 0
    && value.y <= 1;
}

export function isStudioCompanionNormalizedRect(
  value: unknown
): value is StudioCompanionNormalizedRect {
  return plainRecord(value)
    && exactKeys(value, ["x", "y", "width", "height"])
    && finite(value.x)
    && finite(value.y)
    && finite(value.width)
    && finite(value.height)
    && value.x >= 0
    && value.y >= 0
    && value.width >= STUDIO_COMPANION_VIEWPORT_MIN_EXTENT
    && value.height >= STUDIO_COMPANION_VIEWPORT_MIN_EXTENT
    && value.x + value.width <= 1.000_001
    && value.y + value.height <= 1.000_001;
}

function isStudioCompanionBrushPatch(value: unknown): value is StudioCompanionBrushPatch {
  if (!plainRecord(value)) return false;
  const allowed = ["id", "size", "opacity", "color"] as const;
  const keys = Reflect.ownKeys(value);
  if (keys.length === 0 || keys.some((key) => typeof key !== "string" || !allowed.includes(key as never))) {
    return false;
  }
  return (value.id === undefined || validIdentifier(value.id))
    && (
      value.size === undefined
      || (finite(value.size)
        && Number.isInteger(value.size)
        && value.size >= STUDIO_COMPANION_BRUSH_SIZE_MIN
        && value.size <= STUDIO_COMPANION_BRUSH_SIZE_MAX)
    )
    && (value.opacity === undefined || (finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1))
    && (value.color === undefined || (typeof value.color === "string" && HEX_COLOR_PATTERN.test(value.color)));
}

export function isStudioCompanionReviewControl(
  value: unknown
): value is StudioCompanionReviewControl {
  if (!plainRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "navigate":
      return exactKeys(value, ["kind", "point"])
        && isStudioCompanionNormalizedPoint(value.point);
    case "navigator-demand":
      return exactKeys(value, ["kind", "active"])
        && typeof value.active === "boolean";
    case "select-layer":
      return exactKeys(value, ["kind", "layerId"])
        && validIdentifier(value.layerId);
    case "history":
      return exactKeys(value, ["kind", "action"])
        && (value.action === "undo" || value.action === "redo");
    case "comment-focus":
      return exactKeys(value, ["kind", "threadId"])
        && validIdentifier(value.threadId);
    case "brush":
      return exactKeys(value, ["kind", "patch"])
        && isStudioCompanionBrushPatch(value.patch);
    default:
      return false;
  }
}

export function mergeStudioCompanionBrushPatches(
  current: StudioCompanionBrushPatch | null,
  incoming: StudioCompanionBrushPatch
): StudioCompanionBrushPatch {
  return { ...(current ?? {}), ...incoming };
}

export function planStudioCompanionNavigatorCapture(input: {
  generation: number;
  lastCapturedGeneration: number;
  revision: number;
  lastCapturedRevision: number;
  lastCaptureAt: number;
  now: number;
  activeStroke: boolean;
  inFlight: boolean;
}): StudioCompanionCapturePlan {
  if (
    !safeInteger(input.generation)
    || input.generation <= 0
    || !safeInteger(input.lastCapturedGeneration)
    || !safeInteger(input.revision)
    || !Number.isSafeInteger(input.lastCapturedRevision)
    || input.lastCapturedRevision < -1
    || !finite(input.lastCaptureAt)
    || !finite(input.now)
  ) {
    return { kind: "skip", reason: "invalid" };
  }
  if (input.activeStroke) return { kind: "skip", reason: "active-stroke" };
  if (
    input.generation === input.lastCapturedGeneration
    && input.revision <= input.lastCapturedRevision
  ) return { kind: "skip", reason: "clean" };
  if (input.inFlight) return { kind: "skip", reason: "in-flight" };
  const remaining = STUDIO_COMPANION_NAVIGATOR_MIN_CAPTURE_INTERVAL_MS
    - Math.max(0, input.now - input.lastCaptureAt);
  return remaining > 0
    ? { kind: "defer", delayMs: Math.ceil(remaining) }
    : { kind: "capture" };
}

function waitForStudioCompanionCaptureIdle(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const idleHost = globalThis as typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number }
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  return new Promise((resolve) => {
    let settled = false;
    let idleHandle: number | null = null;
    let timerHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (idleHandle !== null) idleHost.cancelIdleCallback?.(idleHandle);
      if (timerHandle !== null) globalThis.clearTimeout(timerHandle);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof idleHost.requestIdleCallback === "function") {
      idleHandle = idleHost.requestIdleCallback(() => finish(true), { timeout: 80 });
    } else {
      timerHandle = globalThis.setTimeout(() => finish(true), 16);
    }
  });
}

export async function captureStudioCompanionNavigatorFrame(
  input: StudioCompanionNavigatorCaptureOrchestrationInput
): Promise<StudioCompanionNavigatorFrame | null> {
  const { request } = input;
  const blocked = () => {
    try {
      return request.signal.aborted || input.isCaptureBlocked();
    } catch {
      return true;
    }
  };
  if (blocked()) return null;
  if (!await waitForStudioCompanionCaptureIdle(request.signal)) return null;
  const scheduling = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling;
  if (blocked() || scheduling?.isInputPending?.()) return null;

  let source: HTMLCanvasElement | null;
  try {
    source = input.captureCanvas(STUDIO_COMPANION_NAVIGATOR_MAX_EDGE);
  } catch {
    return null;
  }
  if (!source || blocked()) return null;
  return encodeStudioCompanionNavigatorWebp(source, {
    generation: request.generation,
    revision: request.revision,
    sequence: request.sequence,
    signal: request.signal,
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
  options: { signal?: AbortSignal; timeoutMs: number }
): Promise<{ blob: Blob | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob: Blob | null, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ blob, timedOut });
    };
    const onAbort = () => finish(null, false);
    const timeout = globalThis.setTimeout(() => finish(null, true), options.timeoutMs);
    if (options.signal?.aborted) {
      finish(null, false);
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      canvas.toBlob((blob) => finish(blob, false), "image/webp", quality);
    } catch {
      finish(null, false);
    }
  });
}

export async function encodeStudioCompanionNavigatorWebp(
  source: HTMLCanvasElement,
  options: {
    generation: number;
    revision: number;
    sequence: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  }
): Promise<StudioCompanionNavigatorFrame | null> {
  if (
    !safeInteger(options.generation)
    || options.generation <= 0
    || !safeInteger(options.revision)
    || !safeInteger(options.sequence)
    || options.sequence <= 0
    || !finite(source.width)
    || !finite(source.height)
    || source.width < 1
    || source.height < 1
  ) return null;

  const createCanvas = options.createCanvas ?? ((width: number, height: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
  const initialScale = Math.min(
    1,
    STUDIO_COMPANION_NAVIGATOR_MAX_EDGE / Math.max(source.width, source.height)
  );
  let width = Math.max(1, Math.round(source.width * initialScale));
  let height = Math.max(1, Math.round(source.height * initialScale));

  for (let resizePass = 0; resizePass < 4; resizePass += 1) {
    if (options.signal?.aborted) return null;
    let canvas: HTMLCanvasElement;
    try {
      canvas = createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
    } catch {
      return null;
    }
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: false });
      if (!context) return null;
      context.drawImage(source, 0, 0, width, height);
    } catch {
      return null;
    }
    for (const quality of [0.82, 0.68, 0.54, 0.4]) {
      const encoded = await canvasToBlob(canvas, quality, {
        signal: options.signal,
        timeoutMs: clamp(
          finite(options.timeoutMs) ? options.timeoutMs : 1_500,
          50,
          5_000
        ),
      });
      if (encoded.timedOut) return null;
      const blob = encoded.blob;
      if (
        blob
        && blob.type === "image/webp"
        && blob.size > 0
        && blob.size <= STUDIO_COMPANION_NAVIGATOR_MAX_BYTES
      ) {
        return {
          generation: options.generation,
          revision: options.revision,
          sequence: options.sequence,
          width,
          height,
          blob,
        };
      }
    }
    width = Math.max(1, Math.floor(width * 0.78));
    height = Math.max(1, Math.floor(height * 0.78));
  }
  return null;
}

export function isStudioCompanionNavigatorFrame(
  value: unknown
): value is StudioCompanionNavigatorFrame {
  if (!plainRecord(value) || !exactKeys(value, ["generation", "revision", "sequence", "width", "height", "blob"])) {
    return false;
  }
  const blob = value.blob;
  return safeInteger(value.generation)
    && value.generation > 0
    && safeInteger(value.revision)
    && safeInteger(value.sequence)
    && value.sequence > 0
    && safeInteger(value.width)
    && safeInteger(value.height)
    && value.width > 0
    && value.height > 0
    && Math.max(value.width, value.height) <= STUDIO_COMPANION_NAVIGATOR_MAX_EDGE
    && typeof Blob !== "undefined"
    && blob instanceof Blob
    && blob.type === "image/webp"
    && blob.size > 0
    && blob.size <= STUDIO_COMPANION_NAVIGATOR_MAX_BYTES;
}

function isLayerSummary(value: unknown): value is StudioCompanionLayerSummary {
  return plainRecord(value)
    && exactKeys(value, ["id", "label", "kind", "visible", "locked", "selected"])
    && validIdentifier(value.id)
    && validText(value.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    && validText(value.kind, 40)
    && typeof value.visible === "boolean"
    && typeof value.locked === "boolean"
    && typeof value.selected === "boolean";
}

function isHistorySummary(value: unknown): value is StudioCompanionHistorySummary {
  return plainRecord(value)
    && exactKeys(value, ["index", "label", "current"])
    && safeInteger(value.index)
    && validText(value.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    && typeof value.current === "boolean";
}

function isCommentSummary(value: unknown): value is StudioCompanionCommentSummary {
  return plainRecord(value)
    && exactKeys(value, ["id", "author", "excerpt", "resolved", "unread"])
    && validIdentifier(value.id)
    && validText(value.author, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    && validText(value.excerpt, STUDIO_COMPANION_REVIEW_MAX_EXCERPT_LENGTH)
    && typeof value.resolved === "boolean"
    && typeof value.unread === "boolean";
}

function isBrushChoice(value: unknown): value is StudioCompanionBrushChoice {
  return plainRecord(value)
    && exactKeys(value, ["id", "label"])
    && validIdentifier(value.id)
    && validText(value.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH);
}

function isBrushState(value: unknown): value is StudioCompanionBrushState {
  return plainRecord(value)
    && exactKeys(value, ["id", "label", "size", "opacity", "color", "choices"])
    && validIdentifier(value.id)
    && validText(value.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    && finite(value.size)
    && Number.isInteger(value.size)
    && value.size >= STUDIO_COMPANION_BRUSH_SIZE_MIN
    && value.size <= STUDIO_COMPANION_BRUSH_SIZE_MAX
    && finite(value.opacity)
    && value.opacity >= 0
    && value.opacity <= 1
    && typeof value.color === "string"
    && HEX_COLOR_PATTERN.test(value.color)
    && Array.isArray(value.choices)
    && value.choices.length <= STUDIO_COMPANION_REVIEW_MAX_BRUSHES
    && value.choices.every(isBrushChoice);
}

export function isStudioCompanionReviewProjection(
  value: unknown
): value is StudioCompanionReviewProjection {
  if (!plainRecord(value) || !exactKeys(value, [
    "revision",
    "documentRevision",
    "pageLabel",
    "selectionLabel",
    "canUndo",
    "canRedo",
    "captureAllowed",
    "viewport",
    "layers",
    "history",
    "comments",
    "brush",
    "truncated",
  ])) return false;
  const brush = value.brush;
  if (
    !safeInteger(value.revision)
    || !safeInteger(value.documentRevision)
    || !validText(value.pageLabel, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    || (value.selectionLabel !== null && (
      !validText(value.selectionLabel, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH)
    ))
    || typeof value.canUndo !== "boolean"
    || typeof value.canRedo !== "boolean"
    || typeof value.captureAllowed !== "boolean"
    || !isStudioCompanionNormalizedRect(value.viewport)
    || !Array.isArray(value.layers)
    || value.layers.length > STUDIO_COMPANION_REVIEW_MAX_LAYERS
    || !value.layers.every(isLayerSummary)
    || !Array.isArray(value.history)
    || value.history.length > STUDIO_COMPANION_REVIEW_MAX_HISTORY
    || !value.history.every(isHistorySummary)
    || !Array.isArray(value.comments)
    || value.comments.length > STUDIO_COMPANION_REVIEW_MAX_COMMENTS
    || !value.comments.every(isCommentSummary)
    || !isBrushState(brush)
    || !plainRecord(value.truncated)
    || !exactKeys(value.truncated, ["layers", "history", "comments"])
  ) return false;
  if (
    !hasUniqueValues(value.layers, (layer) => layer.id)
    || value.layers.filter((layer) => layer.selected).length > 1
    || !hasUniqueValues(value.history, (entry) => String(entry.index))
    || (value.history.length > 0 && value.history.filter((entry) => entry.current).length !== 1)
    || !hasUniqueValues(value.comments, (comment) => comment.id)
    || !hasUniqueValues(brush.choices, (choice) => choice.id)
    || !brush.choices.some((choice) => choice.id === brush.id)
  ) return false;
  return safeInteger(value.truncated.layers)
    && safeInteger(value.truncated.history)
    && safeInteger(value.truncated.comments);
}

export type StudioCompanionNavigatorObjectUrlHandle = Readonly<{
  url: string;
}>;

/**
 * Owns one displayed Navigator Blob URL plus, at most, one decode candidate.
 *
 * The displayed URL is deliberately retained while the candidate is decoded. This prevents a
 * fast frame cadence from revoking the `<img>` source before the browser has consumed it.
 */
export class StudioCompanionNavigatorObjectUrlOwner {
  private currentValue: StudioCompanionNavigatorObjectUrlHandle | null = null;
  private pendingValue: StudioCompanionNavigatorObjectUrlHandle | null = null;

  constructor(private readonly api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) {}

  current(): StudioCompanionNavigatorObjectUrlHandle | null {
    return this.currentValue;
  }

  pending(): StudioCompanionNavigatorObjectUrlHandle | null {
    return this.pendingValue;
  }

  ownedCount(): number {
    return Number(this.currentValue !== null) + Number(this.pendingValue !== null);
  }

  stage(blob: Blob): StudioCompanionNavigatorObjectUrlHandle | null {
    const previousPending = this.pendingValue;
    // Once a usable current image exists, discard an obsolete decode candidate before allocating
    // another URL so the owner never transiently retains three URLs.
    if (this.currentValue && previousPending) this.releasePending();

    let url: string;
    try {
      url = this.api.createObjectURL(blob);
    } catch {
      return null;
    }

    if (
      typeof url !== "string"
      || url.length === 0
      || url.length > 2_048
      || !url.startsWith("blob:")
      || url === this.currentValue?.url
      || url === previousPending?.url
    ) {
      const retainedPendingAlias = !this.currentValue && url === previousPending?.url;
      if (
        typeof url === "string"
        && url
        && url !== this.currentValue?.url
        && !retainedPendingAlias
      ) this.safeRevoke(url);
      return null;
    }

    const handle = Object.freeze({ url });
    this.pendingValue = handle;
    if (!this.currentValue && previousPending && previousPending.url !== url) {
      this.safeRevoke(previousPending.url);
    }
    return handle;
  }

  commit(handle: StudioCompanionNavigatorObjectUrlHandle): string | null {
    if (handle !== this.pendingValue) return null;
    const previous = this.currentValue;
    this.pendingValue = null;
    this.currentValue = handle;
    if (previous && previous.url !== handle.url) this.safeRevoke(previous.url);
    return handle.url;
  }

  reject(handle: StudioCompanionNavigatorObjectUrlHandle): boolean {
    if (handle !== this.pendingValue) return false;
    this.releasePending();
    return true;
  }

  /**
   * Compatibility path for callers that do not need asynchronous decode fencing.
   * Interactive Navigator rendering uses `stage` + `commit`.
   */
  replace(blob: Blob): string | null {
    const handle = this.stage(blob);
    return handle ? this.commit(handle) : null;
  }

  clear(): void {
    const pending = this.pendingValue;
    const current = this.currentValue;
    this.pendingValue = null;
    this.currentValue = null;
    if (pending) this.safeRevoke(pending.url);
    if (current && current.url !== pending?.url) this.safeRevoke(current.url);
  }

  private releasePending(): void {
    const pending = this.pendingValue;
    this.pendingValue = null;
    if (pending) this.safeRevoke(pending.url);
  }

  private safeRevoke(url: string): void {
    try {
      this.api.revokeObjectURL(url);
    } catch {
      // Ownership is cleared before revocation, so browser failures cannot retain stale state.
    }
  }
}

const STUDIO_COMPANION_SCREEN_MAX_ABSOLUTE_COORDINATE = 1_000_000;
const STUDIO_COMPANION_SCREEN_MAX_DIMENSION = 100_000;

function sanitizeScreen(screen: unknown): StudioCompanionScreenLike | null {
  if (
    screen === null
    || (typeof screen !== "object" && typeof screen !== "function")
  ) return null;
  try {
    const candidate = screen as Record<string, unknown>;
    const { availLeft, availTop, availWidth, availHeight } = candidate;
    if (
      !finite(availLeft)
      || !finite(availTop)
      || !finite(availWidth)
      || !finite(availHeight)
      || Math.abs(availLeft) > STUDIO_COMPANION_SCREEN_MAX_ABSOLUTE_COORDINATE
      || Math.abs(availTop) > STUDIO_COMPANION_SCREEN_MAX_ABSOLUTE_COORDINATE
      || availWidth < 1
      || availHeight < 1
      || availWidth > STUDIO_COMPANION_SCREEN_MAX_DIMENSION
      || availHeight > STUDIO_COMPANION_SCREEN_MAX_DIMENSION
      || Math.abs(availLeft + availWidth) > STUDIO_COMPANION_SCREEN_MAX_ABSOLUTE_COORDINATE
      || Math.abs(availTop + availHeight) > STUDIO_COMPANION_SCREEN_MAX_ABSOLUTE_COORDINATE
    ) return null;
    return {
      availLeft,
      availTop,
      availWidth,
      availHeight,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
      ...(typeof candidate.isPrimary === "boolean" ? { isPrimary: candidate.isPrimary } : {}),
    };
  } catch {
    return null;
  }
}

function sameScreen(left: StudioCompanionScreenLike, right: StudioCompanionScreenLike): boolean {
  return left.availLeft === right.availLeft
    && left.availTop === right.availTop
    && left.availWidth === right.availWidth
    && left.availHeight === right.availHeight;
}

export function planStudioCompanionExternalScreenPlacement(input: {
  screens: readonly unknown[];
  currentScreen?: unknown;
  preferredWidth?: number;
  preferredHeight?: number;
}): StudioCompanionScreenPlacement | null {
  const screenKeys = new Set<string>();
  const screens: StudioCompanionScreenLike[] = [];
  for (const candidate of input.screens) {
    const screen = sanitizeScreen(candidate);
    if (!screen) continue;
    const key = `${screen.availLeft}:${screen.availTop}:${screen.availWidth}:${screen.availHeight}`;
    if (screenKeys.has(key)) continue;
    screenKeys.add(key);
    screens.push(screen);
  }
  if (screens.length < 2) return null;
  const current = sanitizeScreen(input.currentScreen);
  const target = screens.find((screen) => current ? !sameScreen(screen, current) : screen.isPrimary !== true)
    ?? screens.find((screen) => screen.isPrimary !== true)
    ?? null;
  if (!target) return null;
  const width = Math.round(clamp(
    finite(input.preferredWidth) ? input.preferredWidth : 520,
    Math.min(320, target.availWidth),
    target.availWidth
  ));
  const height = Math.round(clamp(
    finite(input.preferredHeight) ? input.preferredHeight : 820,
    Math.min(480, target.availHeight),
    target.availHeight
  ));
  const maximumLeft = target.availLeft + target.availWidth - width;
  const maximumTop = target.availTop + target.availHeight - height;
  const left = Math.round(clamp(
    target.availLeft + (target.availWidth - width) / 2,
    target.availLeft,
    maximumLeft
  ));
  const top = Math.round(clamp(
    target.availTop + (target.availHeight - height) / 2,
    target.availTop,
    maximumTop
  ));
  return {
    left,
    top,
    width,
    height,
    screenLabel: cleanText(target.label, STUDIO_COMPANION_REVIEW_MAX_LABEL_LENGTH, "다른 화면"),
  };
}

export function studioCompanionPlacementWindowFeatures(
  placement: StudioCompanionScreenPlacement
): string {
  return `popup=yes,left=${placement.left},top=${placement.top},width=${placement.width},height=${placement.height},menubar=no,toolbar=no,location=no,status=no`;
}
