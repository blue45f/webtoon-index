import {
  MIN_SELECTION_SUBPATH_AREA,
  SELECTION_FEATHER_RANGE,
  polygonAreaNorm,
  type PixelSelection,
  type SelPoint,
  type SelectionCombineMode,
  type SelectionSubpath,
} from "./studio-selection-tools";

/**
 * Pixel-selection-only undo/redo.
 *
 * This timeline deliberately does not contain image pixels, page elements, or document revisions.
 * A caller must route a shortcut here only while an image pixel-selection context is active; when
 * this core cannot apply a step, the caller leaves the event untouched for the document history.
 * Every snapshot is bound to one image element and deep-cloned/frozen before it enters the history.
 */

export type PixelSelectionHistoryOperation =
  | "initial"
  | "free-lasso"
  | "poly-lasso"
  | "marquee"
  | "brush"
  | "magic-wand"
  | "add-subpath"
  | "remove-subpath"
  | "move"
  | "transform"
  | "feather"
  | "invert"
  | "select-all"
  | "clear"
  | "other";

export type PixelSelectionHistoryLimits = Readonly<{
  /** Total retained snapshots, including the current snapshot. */
  maxEntries: number;
  /** Deterministic retained-size budget (structural estimate, not JS heap sampling). */
  maxBytes: number;
  maxSubpathsPerSnapshot: number;
  maxPointsPerSubpath: number;
  maxPointsPerSnapshot: number;
}>;

export const DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS: PixelSelectionHistoryLimits = Object.freeze({
  maxEntries: 64,
  maxBytes: 4 * 1024 * 1024,
  maxSubpathsPerSnapshot: 128,
  maxPointsPerSubpath: 4_096,
  maxPointsPerSnapshot: 8_192,
});

export type PixelSelectionHistorySnapshot = Readonly<{
  elementId: string;
  selection: PixelSelection | null;
  operation: PixelSelectionHistoryOperation;
  coalesceKey: string | null;
  sequence: number;
  estimatedBytes: number;
}>;

export type PixelSelectionHistory = Readonly<{
  ownerElementId: string | null;
  past: readonly PixelSelectionHistorySnapshot[];
  present: PixelSelectionHistorySnapshot | null;
  future: readonly PixelSelectionHistorySnapshot[];
  retainedBytes: number;
  nextSequence: number;
  limits: PixelSelectionHistoryLimits;
}>;

export type PixelSelectionHistoryTransitionReason =
  | "committed"
  | "coalesced"
  | "undone"
  | "redone"
  | "no-change"
  | "nothing-to-undo"
  | "nothing-to-redo"
  | "owner-mismatch"
  | "unbound";

export type PixelSelectionHistoryTransition = Readonly<{
  history: PixelSelectionHistory;
  selection: PixelSelection | null;
  applied: boolean;
  reason: PixelSelectionHistoryTransitionReason;
}>;

export type PixelSelectionHistoryShortcutCommand = "selection-undo" | "selection-redo";

export type PixelSelectionHistoryShortcutEvent = Readonly<{
  key?: unknown;
  code?: unknown;
  ctrlKey?: unknown;
  metaKey?: unknown;
  shiftKey?: unknown;
  altKey?: unknown;
  defaultPrevented?: unknown;
  isComposing?: unknown;
}>;

export type PixelSelectionHistoryShortcutContext = Readonly<{
  history: PixelSelectionHistory;
  activeElementId: unknown;
  /** True only while the image pixel-selection tool/state owns edit-history intent. */
  pixelSelectionContextActive: boolean;
  /** Inputs, contenteditable, menus, dialogs, and other existing shortcut boundaries set this. */
  shortcutBoundaryActive?: boolean;
  /**
   * Explicit chronological arbitration for destructive image/page edits. When the latest user edit
   * belongs to document history, selection history must not jump ahead merely because its marquee
   * is still visible.
   */
  documentHistoryOwnsLatestEdit?: boolean;
}>;

export type PixelSelectionHistoryShortcutResolution = Readonly<{
  command: PixelSelectionHistoryShortcutCommand | null;
  preventDefault: boolean;
  route: "pixel-selection" | "document-history";
}>;

const MIN_HISTORY_ENTRIES = 2;
const MAX_HISTORY_ENTRIES = 256;
const MIN_HISTORY_BYTES = 32 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_ELEMENT_ID_LENGTH = 256;
const MAX_COALESCE_KEY_LENGTH = 128;
const MAX_SUBPATHS_HARD = 512;
const MAX_POINTS_PER_SUBPATH_HARD = 65_536;
const MAX_POINTS_PER_SNAPSHOT_HARD = 131_072;
const SEL_POINT_MIN = -0.25;
const SEL_POINT_MAX = 1.25;
const MAX_BRUSH_RADIUS_NORM = 4;

const OPERATIONS: ReadonlySet<string> = new Set<PixelSelectionHistoryOperation>([
  "initial",
  "free-lasso",
  "poly-lasso",
  "marquee",
  "brush",
  "magic-wand",
  "add-subpath",
  "remove-subpath",
  "move",
  "transform",
  "feather",
  "invert",
  "select-all",
  "clear",
  "other",
]);

const COMBINE_MODES: ReadonlySet<string> = new Set<SelectionCombineMode>([
  "add",
  "subtract",
  "intersect",
]);

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function plainRecord(value: unknown): Record<PropertyKey, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? (value as Record<PropertyKey, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read only own data properties; hostile accessors are treated as malformed instead of invoked. */
function dataProperty(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function arrayDataItem(array: readonly unknown[], index: number): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeElementId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let normalized: string;
  try {
    normalized = value.normalize("NFKC").trim();
  } catch {
    return null;
  }
  if (!normalized) return null;
  return normalized.slice(0, MAX_ELEMENT_ID_LENGTH);
}

function normalizeOperation(value: unknown): PixelSelectionHistoryOperation {
  return typeof value === "string" && OPERATIONS.has(value)
    ? (value as PixelSelectionHistoryOperation)
    : "other";
}

function normalizeCoalesceKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().slice(0, MAX_COALESCE_KEY_LENGTH);
  return key || null;
}

function utf8ByteLength(value: string): number {
  // Count Unicode scalar UTF-8 bytes without depending on DOM or Node APIs.
  let bytes = 0;
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function normalizePixelSelectionHistoryLimits(
  input?: Partial<PixelSelectionHistoryLimits>,
): PixelSelectionHistoryLimits {
  const inputRecord = plainRecord(input);
  const maxEntries = clampInteger(
    inputRecord ? dataProperty(inputRecord, "maxEntries") : undefined,
    MIN_HISTORY_ENTRIES,
    MAX_HISTORY_ENTRIES,
    DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS.maxEntries,
  );
  const maxBytes = clampInteger(
    inputRecord ? dataProperty(inputRecord, "maxBytes") : undefined,
    MIN_HISTORY_BYTES,
    MAX_HISTORY_BYTES,
    DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS.maxBytes,
  );
  // Reserve enough space for snapshot/owner/selection metadata. The remaining structural budget
  // caps both path objects and points, so even a malicious snapshot fits as the current entry.
  const structuralBudget = Math.max(3_072, maxBytes - 4_096);
  const memoryBoundSubpaths = Math.max(1, Math.floor(structuralBudget / (128 + 48)));
  const maxSubpathsPerSnapshot = clampInteger(
    inputRecord ? dataProperty(inputRecord, "maxSubpathsPerSnapshot") : undefined,
    1,
    Math.min(MAX_SUBPATHS_HARD, memoryBoundSubpaths),
    Math.min(DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS.maxSubpathsPerSnapshot, memoryBoundSubpaths),
  );
  const pointsBudget = Math.max(
    3,
    Math.floor((structuralBudget - maxSubpathsPerSnapshot * 128) / 48),
  );
  const maxPointsPerSnapshot = clampInteger(
    inputRecord ? dataProperty(inputRecord, "maxPointsPerSnapshot") : undefined,
    3,
    Math.min(MAX_POINTS_PER_SNAPSHOT_HARD, pointsBudget),
    Math.min(DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS.maxPointsPerSnapshot, pointsBudget),
  );
  const maxPointsPerSubpath = clampInteger(
    inputRecord ? dataProperty(inputRecord, "maxPointsPerSubpath") : undefined,
    3,
    Math.min(MAX_POINTS_PER_SUBPATH_HARD, maxPointsPerSnapshot),
    Math.min(DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS.maxPointsPerSubpath, maxPointsPerSnapshot),
  );
  return Object.freeze({
    maxEntries,
    maxBytes,
    maxSubpathsPerSnapshot,
    maxPointsPerSubpath,
    maxPointsPerSnapshot,
  });
}

function normalizedSampleIndexes(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  if (limit <= 1) return [0];
  const indexes: number[] = [];
  for (let index = 0; index < limit; index += 1) {
    indexes.push(Math.floor((index * (length - 1)) / (limit - 1)));
  }
  return indexes;
}

function normalizePoint(value: unknown): SelPoint | null {
  const record = plainRecord(value);
  if (!record) return null;
  const rawX = dataProperty(record, "x");
  const rawY = dataProperty(record, "y");
  if (typeof rawX !== "number" || !Number.isFinite(rawX)) return null;
  if (typeof rawY !== "number" || !Number.isFinite(rawY)) return null;
  return Object.freeze({
    x: Math.max(SEL_POINT_MIN, Math.min(SEL_POINT_MAX, rawX)),
    y: Math.max(SEL_POINT_MIN, Math.min(SEL_POINT_MAX, rawY)),
  });
}

function normalizePoints(value: unknown, limit: number): SelPoint[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const points: SelPoint[] = [];
  for (const index of normalizedSampleIndexes(value.length, limit)) {
    const point = normalizePoint(arrayDataItem(value, index));
    if (point) points.push(point);
  }
  return points;
}

function sampledSubpathIndexes(length: number, limit: number): number[] {
  return normalizedSampleIndexes(length, limit);
}

/**
 * Deep-clone, clamp, cap, and freeze untrusted selection data.
 * `null`/`undefined` means a deliberate cleared selection. A malformed object becomes a safe empty
 * selection rather than inheriting attacker-controlled prototypes or accessors.
 */
export function normalizePixelSelection(
  value: unknown,
  inputLimits: Partial<PixelSelectionHistoryLimits> = DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS,
): PixelSelection | null {
  if (value === null || value === undefined) return null;
  const record = plainRecord(value);
  if (!record) return null;
  const rawSubpaths = dataProperty(record, "subpaths");
  const rawInvert = dataProperty(record, "invert");
  const rawFeather = dataProperty(record, "featherPx");
  const limits = normalizePixelSelectionHistoryLimits(inputLimits);
  const subpaths: SelectionSubpath[] = [];
  let pointsRemaining = limits.maxPointsPerSnapshot;

  if (Array.isArray(rawSubpaths)) {
    for (const index of sampledSubpathIndexes(rawSubpaths.length, limits.maxSubpathsPerSnapshot)) {
      if (pointsRemaining <= 0) break;
      const rawSubpath = plainRecord(arrayDataItem(rawSubpaths, index));
      if (!rawSubpath) continue;
      const rawMode = dataProperty(rawSubpath, "mode");
      if (typeof rawMode !== "string" || !COMBINE_MODES.has(rawMode)) continue;
      const mode = rawMode as SelectionCombineMode;
      const kind = dataProperty(rawSubpath, "kind");
      const pathLimit = Math.min(limits.maxPointsPerSubpath, pointsRemaining);
      const points = normalizePoints(dataProperty(rawSubpath, "points"), pathLimit);
      if (kind === "brush") {
        const radius = clampFinite(dataProperty(rawSubpath, "radius"), 0, MAX_BRUSH_RADIUS_NORM, 0);
        if (points.length < 1 || radius <= 0) continue;
        const frozenPoints = Object.freeze(points.slice()) as unknown as SelPoint[];
        subpaths.push(Object.freeze({ mode, kind: "brush", points: frozenPoints, radius }));
        pointsRemaining -= points.length;
        continue;
      }
      if (kind !== undefined || points.length < 3 || polygonAreaNorm(points) < MIN_SELECTION_SUBPATH_AREA) {
        continue;
      }
      const frozenPoints = Object.freeze(points.slice()) as unknown as SelPoint[];
      subpaths.push(Object.freeze({ mode, points: frozenPoints }));
      pointsRemaining -= points.length;
    }
  }

  const selection: PixelSelection = {
    subpaths: Object.freeze(subpaths.slice()) as unknown as SelectionSubpath[],
    featherPx: clampInteger(
      rawFeather,
      SELECTION_FEATHER_RANGE.min,
      SELECTION_FEATHER_RANGE.max,
      0,
    ),
    invert: typeof rawInvert === "boolean" ? rawInvert : false,
  };
  return Object.freeze(selection);
}

function estimateSelectionBytes(selection: PixelSelection | null): number {
  if (!selection) return 32;
  let bytes = 96;
  for (const subpath of selection.subpaths) {
    bytes += 128 + subpath.points.length * 48;
  }
  return bytes;
}

function snapshotsEqual(left: PixelSelection | null, right: PixelSelection | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.featherPx !== right.featherPx || left.invert !== right.invert) return false;
  if (left.subpaths.length !== right.subpaths.length) return false;
  for (let pathIndex = 0; pathIndex < left.subpaths.length; pathIndex += 1) {
    const a = left.subpaths[pathIndex]!;
    const b = right.subpaths[pathIndex]!;
    if (a.mode !== b.mode || a.kind !== b.kind || a.points.length !== b.points.length) return false;
    if (a.kind === "brush" && (b.kind !== "brush" || a.radius !== b.radius)) return false;
    for (let pointIndex = 0; pointIndex < a.points.length; pointIndex += 1) {
      const ap = a.points[pointIndex]!;
      const bp = b.points[pointIndex]!;
      if (ap.x !== bp.x || ap.y !== bp.y) return false;
    }
  }
  return true;
}

export function normalizePixelSelectionSnapshot(
  elementId: unknown,
  selection: unknown,
  options?: Readonly<{
    limits?: PixelSelectionHistoryLimits;
    operation?: PixelSelectionHistoryOperation;
    coalesceKey?: string | null;
    sequence?: number;
  }>,
): PixelSelectionHistorySnapshot | null {
  const owner = normalizeElementId(elementId);
  if (!owner) return null;
  const normalizedSelection = normalizePixelSelection(
    selection,
    options?.limits ?? DEFAULT_PIXEL_SELECTION_HISTORY_LIMITS,
  );
  const operation = normalizeOperation(options?.operation ?? "other");
  const coalesceKey = normalizeCoalesceKey(options?.coalesceKey);
  const sequence = clampInteger(options?.sequence, 0, Number.MAX_SAFE_INTEGER, 0);
  const estimatedBytes =
    256
    + utf8ByteLength(owner)
    + utf8ByteLength(operation)
    + (coalesceKey ? utf8ByteLength(coalesceKey) : 0)
    + estimateSelectionBytes(normalizedSelection);
  return Object.freeze({
    elementId: owner,
    selection: normalizedSelection,
    operation,
    coalesceKey,
    sequence,
    estimatedBytes,
  });
}

function retainedBytes(
  past: readonly PixelSelectionHistorySnapshot[],
  present: PixelSelectionHistorySnapshot | null,
  future: readonly PixelSelectionHistorySnapshot[],
): number {
  return (
    past.reduce((total, snapshot) => total + snapshot.estimatedBytes, 0)
    + (present?.estimatedBytes ?? 0)
    + future.reduce((total, snapshot) => total + snapshot.estimatedBytes, 0)
  );
}

function makeHistory(input: {
  ownerElementId: string | null;
  past: readonly PixelSelectionHistorySnapshot[];
  present: PixelSelectionHistorySnapshot | null;
  future: readonly PixelSelectionHistorySnapshot[];
  nextSequence: number;
  limits: PixelSelectionHistoryLimits;
}): PixelSelectionHistory {
  const past = Object.freeze(input.past.slice());
  const future = Object.freeze(input.future.slice());
  return Object.freeze({
    ownerElementId: input.ownerElementId,
    past,
    present: input.present,
    future,
    retainedBytes: retainedBytes(past, input.present, future),
    nextSequence: input.nextSequence,
    limits: input.limits,
  });
}

export function createPixelSelectionHistory(
  elementId: unknown,
  initialSelection?: unknown,
  limits?: Partial<PixelSelectionHistoryLimits>,
): PixelSelectionHistory {
  const normalizedLimits = normalizePixelSelectionHistoryLimits(limits);
  const owner = normalizeElementId(elementId);
  if (!owner) {
    return makeHistory({
      ownerElementId: null,
      past: [],
      present: null,
      future: [],
      nextSequence: 0,
      limits: normalizedLimits,
    });
  }
  const present = normalizePixelSelectionSnapshot(owner, initialSelection, {
    limits: normalizedLimits,
    operation: "initial",
    sequence: 0,
  });
  return makeHistory({
    ownerElementId: owner,
    past: [],
    present,
    future: [],
    nextSequence: 1,
    limits: normalizedLimits,
  });
}

/** Bind to a new image element; switching or clearing ownership starts a fresh isolated timeline. */
export function bindPixelSelectionHistory(
  history: PixelSelectionHistory,
  elementId: unknown,
  initialSelection?: unknown,
): PixelSelectionHistory {
  const owner = normalizeElementId(elementId);
  if (owner === history.ownerElementId && historySnapshotsMatchOwner(history)) return history;
  return createPixelSelectionHistory(owner, initialSelection, history.limits);
}

function historySnapshotsMatchOwner(history: PixelSelectionHistory): boolean {
  const owner = history.ownerElementId;
  if (!owner) {
    return history.present === null && history.past.length === 0 && history.future.length === 0;
  }
  return (
    history.present?.elementId === owner
    && history.past.every((snapshot) => snapshot.elementId === owner)
    && history.future.every((snapshot) => snapshot.elementId === owner)
  );
}

function ownerReason(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): "unbound" | "owner-mismatch" | null {
  if (!history.ownerElementId || !history.present) return "unbound";
  if (!historySnapshotsMatchOwner(history)) return "owner-mismatch";
  return normalizeElementId(activeElementId) === history.ownerElementId ? null : "owner-mismatch";
}

function transition(
  history: PixelSelectionHistory,
  selection: PixelSelection | null,
  applied: boolean,
  reason: PixelSelectionHistoryTransitionReason,
): PixelSelectionHistoryTransition {
  return Object.freeze({ history, selection, applied, reason });
}

export function readPixelSelectionHistoryCurrent(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): PixelSelection | null {
  return ownerReason(history, activeElementId) === null ? history.present?.selection ?? null : null;
}

export function commitPixelSelectionHistory(
  history: PixelSelectionHistory,
  elementId: unknown,
  nextSelection: unknown,
  options?: Readonly<{
    operation?: PixelSelectionHistoryOperation;
    coalesceKey?: string | null;
  }>,
): PixelSelectionHistoryTransition {
  const ownershipFailure = ownerReason(history, elementId);
  if (ownershipFailure) return transition(history, null, false, ownershipFailure);
  const present = history.present!;
  const next = normalizePixelSelectionSnapshot(history.ownerElementId, nextSelection, {
    limits: history.limits,
    operation: options?.operation ?? "other",
    coalesceKey: options?.coalesceKey,
    sequence: history.nextSequence,
  })!;
  if (snapshotsEqual(present.selection, next.selection)) {
    return transition(history, present.selection, false, "no-change");
  }

  const canCoalesce =
    next.coalesceKey !== null
    && present.coalesceKey === next.coalesceKey
    && present.operation === next.operation
    && history.future.length === 0
    && history.past.length > 0;
  if (canCoalesce) {
    const coalesced = makeHistory({
      ownerElementId: history.ownerElementId,
      past: history.past,
      present: next,
      future: [],
      nextSequence: history.nextSequence + 1,
      limits: history.limits,
    });
    return transition(coalesced, next.selection, true, "coalesced");
  }

  const past = [...history.past, present];
  while (past.length + 1 > history.limits.maxEntries) past.shift();
  while (
    past.length > 0
    && retainedBytes(past, next, []) > history.limits.maxBytes
  ) {
    past.shift();
  }
  const committed = makeHistory({
    ownerElementId: history.ownerElementId,
    past,
    present: next,
    future: [],
    nextSequence: history.nextSequence + 1,
    limits: history.limits,
  });
  return transition(committed, next.selection, true, "committed");
}

export function canUndoPixelSelectionHistory(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): boolean {
  return ownerReason(history, activeElementId) === null && history.past.length > 0;
}

export function canRedoPixelSelectionHistory(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): boolean {
  return ownerReason(history, activeElementId) === null && history.future.length > 0;
}

export function undoPixelSelectionHistory(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): PixelSelectionHistoryTransition {
  const ownershipFailure = ownerReason(history, activeElementId);
  if (ownershipFailure) return transition(history, null, false, ownershipFailure);
  const target = history.past.at(-1);
  if (!target) return transition(history, history.present!.selection, false, "nothing-to-undo");
  const undone = makeHistory({
    ownerElementId: history.ownerElementId,
    past: history.past.slice(0, -1),
    present: target,
    future: [history.present!, ...history.future],
    nextSequence: history.nextSequence,
    limits: history.limits,
  });
  return transition(undone, target.selection, true, "undone");
}

export function redoPixelSelectionHistory(
  history: PixelSelectionHistory,
  activeElementId: unknown,
): PixelSelectionHistoryTransition {
  const ownershipFailure = ownerReason(history, activeElementId);
  if (ownershipFailure) return transition(history, null, false, ownershipFailure);
  const target = history.future[0];
  if (!target) return transition(history, history.present!.selection, false, "nothing-to-redo");
  const redone = makeHistory({
    ownerElementId: history.ownerElementId,
    past: [...history.past, history.present!],
    present: target,
    future: history.future.slice(1),
    nextSequence: history.nextSequence,
    limits: history.limits,
  });
  return transition(redone, target.selection, true, "redone");
}

function shortcutKey(event: PixelSelectionHistoryShortcutEvent): string {
  if (typeof event.key === "string") {
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") return key;
  }
  if (event.code === "KeyZ") return "z";
  if (event.code === "KeyY") return "y";
  return "";
}

/**
 * Decide whether a keyboard event belongs to selection history. A `document-history` resolution is
 * deliberately non-consuming: StudioPage should continue into its existing page undo/redo branch.
 */
export function resolvePixelSelectionHistoryShortcut(
  event: PixelSelectionHistoryShortcutEvent,
  context: PixelSelectionHistoryShortcutContext,
): PixelSelectionHistoryShortcutResolution {
  const documentHistory = Object.freeze({
    command: null,
    preventDefault: false,
    route: "document-history",
  }) satisfies PixelSelectionHistoryShortcutResolution;
  if (
    event.defaultPrevented === true
    || event.isComposing === true
    || context.shortcutBoundaryActive === true
    || context.documentHistoryOwnsLatestEdit === true
    || !context.pixelSelectionContextActive
    || event.altKey === true
  ) {
    return documentHistory;
  }
  const modifier = event.ctrlKey === true || event.metaKey === true;
  if (!modifier) return documentHistory;
  const key = shortcutKey(event);
  const wantsUndo = key === "z" && event.shiftKey !== true;
  const wantsRedo = (key === "z" && event.shiftKey === true) || (key === "y" && event.shiftKey !== true);
  if (wantsUndo && canUndoPixelSelectionHistory(context.history, context.activeElementId)) {
    return Object.freeze({ command: "selection-undo", preventDefault: true, route: "pixel-selection" });
  }
  if (wantsRedo && canRedoPixelSelectionHistory(context.history, context.activeElementId)) {
    return Object.freeze({ command: "selection-redo", preventDefault: true, route: "pixel-selection" });
  }
  return documentHistory;
}
