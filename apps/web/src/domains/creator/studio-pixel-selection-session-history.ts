/**
 * Trusted in-editor pixel-selection timeline.
 *
 * The import/archive boundary keeps the exhaustive hostile-payload normalizer in
 * studio-pixel-selection-history.ts. Live pointer gestures already produce normalized
 * PixelSelection values, so this compact path preserves the same immutable, owner-scoped,
 * bounded undo/redo contract without charging that validator to Studio startup.
 */
import type {
  PixelSelectionHistory,
  PixelSelectionHistoryLimits,
  PixelSelectionHistoryOperation,
  PixelSelectionHistoryShortcutContext,
  PixelSelectionHistoryShortcutEvent,
  PixelSelectionHistoryShortcutResolution,
  PixelSelectionHistorySnapshot,
  PixelSelectionHistoryTransition,
} from "./studio-pixel-selection-history";
import type { PixelSelection, SelectionSubpath, SelPoint } from "./studio-selection-tools";

export type { PixelSelectionHistoryOperation } from "./studio-pixel-selection-history";

const LIMITS: PixelSelectionHistoryLimits = Object.freeze({
  maxEntries: 64,
  maxBytes: 4 * 1024 * 1024,
  maxSubpathsPerSnapshot: 128,
  maxPointsPerSubpath: 4_096,
  maxPointsPerSnapshot: 8_192,
});

function cloneSelection(selection: PixelSelection | null): PixelSelection | null {
  if (!selection) return null;
  const subpaths = selection.subpaths.map((path): SelectionSubpath => {
    const points = Object.freeze(
      path.points.map((point) => Object.freeze({ x: point.x, y: point.y })),
    ) as unknown as SelPoint[];
    return Object.freeze(path.kind === "brush"
      ? { mode: path.mode, kind: "brush", radius: path.radius, points }
      : { mode: path.mode, points });
  });
  return Object.freeze({
    subpaths: Object.freeze(subpaths) as unknown as SelectionSubpath[],
    featherPx: selection.featherPx,
    invert: selection.invert,
  });
}

function selectionBytes(selection: PixelSelection | null): number {
  return selection
    ? 96 + selection.subpaths.reduce((bytes, path) => bytes + 128 + path.points.length * 48, 0)
    : 32;
}

function snapshot(
  elementId: string,
  selection: PixelSelection | null,
  operation: PixelSelectionHistoryOperation,
  sequence: number,
  coalesceKey: string | null = null,
): PixelSelectionHistorySnapshot {
  const saved = cloneSelection(selection);
  return Object.freeze({
    elementId,
    selection: saved,
    operation,
    coalesceKey,
    sequence,
    estimatedBytes: 256 + elementId.length * 4 + selectionBytes(saved),
  });
}

function history(input: Omit<PixelSelectionHistory, "retainedBytes">): PixelSelectionHistory {
  const past = Object.freeze([...input.past]);
  const future = Object.freeze([...input.future]);
  return Object.freeze({
    ...input,
    past,
    future,
    retainedBytes: [...past, ...(input.present ? [input.present] : []), ...future]
      .reduce((bytes, item) => bytes + item.estimatedBytes, 0),
  });
}

function sameSelection(left: PixelSelection | null, right: PixelSelection | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.featherPx !== right.featherPx || left.invert !== right.invert
    || left.subpaths.length !== right.subpaths.length) return false;
  return left.subpaths.every((path, pathIndex) => {
    const other = right.subpaths[pathIndex];
    if (!other || path.mode !== other.mode || path.kind !== other.kind
      || path.points.length !== other.points.length) return false;
    if (path.kind === "brush" && (other.kind !== "brush" || path.radius !== other.radius)) return false;
    return path.points.every((point, pointIndex) => {
      const candidate = other.points[pointIndex];
      return candidate?.x === point.x && candidate.y === point.y;
    });
  });
}

function transition(
  current: PixelSelectionHistory,
  selection: PixelSelection | null,
  applied: boolean,
  reason: PixelSelectionHistoryTransition["reason"],
): PixelSelectionHistoryTransition {
  return Object.freeze({ history: current, selection, applied, reason });
}

function owns(current: PixelSelectionHistory, elementId: unknown): elementId is string {
  return typeof elementId === "string"
    && current.ownerElementId === elementId
    && current.present?.elementId === elementId;
}

export function createPixelSelectionHistory(
  elementId: unknown,
  initialSelection: PixelSelection | null = null,
  limits: PixelSelectionHistoryLimits = LIMITS,
): PixelSelectionHistory {
  const owner = typeof elementId === "string" && elementId ? elementId : null;
  return history({
    ownerElementId: owner,
    past: [],
    present: owner ? snapshot(owner, initialSelection, "initial", 0) : null,
    future: [],
    nextSequence: owner ? 1 : 0,
    limits,
  });
}

export function bindPixelSelectionHistory(
  current: PixelSelectionHistory,
  elementId: unknown,
  initialSelection: PixelSelection | null = null,
): PixelSelectionHistory {
  return owns(current, elementId)
    ? current
    : createPixelSelectionHistory(elementId, initialSelection, current.limits);
}

export function commitPixelSelectionHistory(
  current: PixelSelectionHistory,
  elementId: unknown,
  nextSelection: PixelSelection | null,
  options?: { operation?: PixelSelectionHistoryOperation; coalesceKey?: string },
): PixelSelectionHistoryTransition {
  if (!owns(current, elementId)) {
    return transition(current, null, false, current.ownerElementId ? "owner-mismatch" : "unbound");
  }
  const present = current.present!;
  if (sameSelection(present.selection, nextSelection)) {
    return transition(current, present.selection, false, "no-change");
  }
  const operation = options?.operation ?? "other";
  const coalesceKey = options?.coalesceKey || null;
  const next = snapshot(elementId, nextSelection, operation, current.nextSequence, coalesceKey);
  const coalesced = coalesceKey !== null && present.coalesceKey === coalesceKey
    && present.operation === operation && current.future.length === 0 && current.past.length > 0;
  const past = coalesced ? [...current.past] : [...current.past, present];
  while (past.length + 1 > current.limits.maxEntries) past.shift();
  while (past.length && past.reduce((bytes, item) => bytes + item.estimatedBytes, next.estimatedBytes)
    > current.limits.maxBytes) past.shift();
  const committed = history({
    ...current,
    past,
    present: next,
    future: [],
    nextSequence: current.nextSequence + 1,
  });
  return transition(committed, next.selection, true, coalesced ? "coalesced" : "committed");
}

export function canUndoPixelSelectionHistory(current: PixelSelectionHistory, elementId: unknown): boolean {
  return owns(current, elementId) && current.past.length > 0;
}

export function canRedoPixelSelectionHistory(current: PixelSelectionHistory, elementId: unknown): boolean {
  return owns(current, elementId) && current.future.length > 0;
}

export function undoPixelSelectionHistory(
  current: PixelSelectionHistory,
  elementId: unknown,
): PixelSelectionHistoryTransition {
  if (!owns(current, elementId)) {
    return transition(current, null, false, current.ownerElementId ? "owner-mismatch" : "unbound");
  }
  const target = current.past.at(-1);
  if (!target) return transition(current, current.present!.selection, false, "nothing-to-undo");
  const next = history({
    ...current,
    past: current.past.slice(0, -1),
    present: target,
    future: [current.present!, ...current.future],
  });
  return transition(next, target.selection, true, "undone");
}

export function redoPixelSelectionHistory(
  current: PixelSelectionHistory,
  elementId: unknown,
): PixelSelectionHistoryTransition {
  if (!owns(current, elementId)) {
    return transition(current, null, false, current.ownerElementId ? "owner-mismatch" : "unbound");
  }
  const target = current.future[0];
  if (!target) return transition(current, current.present!.selection, false, "nothing-to-redo");
  const next = history({
    ...current,
    past: [...current.past, current.present!],
    present: target,
    future: current.future.slice(1),
  });
  return transition(next, target.selection, true, "redone");
}

export function resolvePixelSelectionHistoryShortcut(
  event: PixelSelectionHistoryShortcutEvent,
  context: PixelSelectionHistoryShortcutContext,
): PixelSelectionHistoryShortcutResolution {
  const documentHistory = {
    command: null,
    preventDefault: false,
    route: "document-history",
  } as const;
  if (event.defaultPrevented === true || event.isComposing === true
    || context.shortcutBoundaryActive === true || context.documentHistoryOwnsLatestEdit === true
    || !context.pixelSelectionContextActive || event.altKey === true
    || (event.ctrlKey !== true && event.metaKey !== true)) return documentHistory;
  const key = typeof event.key === "string" ? event.key.toLowerCase()
    : event.code === "KeyZ" ? "z" : event.code === "KeyY" ? "y" : "";
  if (key === "z" && event.shiftKey !== true
    && canUndoPixelSelectionHistory(context.history, context.activeElementId)) {
    return { command: "selection-undo", preventDefault: true, route: "pixel-selection" };
  }
  if (((key === "z" && event.shiftKey === true) || (key === "y" && event.shiftKey !== true))
    && canRedoPixelSelectionHistory(context.history, context.activeElementId)) {
    return { command: "selection-redo", preventDefault: true, route: "pixel-selection" };
  }
  return documentHistory;
}
