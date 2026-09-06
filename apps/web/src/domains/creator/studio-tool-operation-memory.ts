import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  sanitizeBrushSnapshot,
  type StudioBrushSnapshot,
} from "./brush/studio-brush-library";
import {
  resolveStudioBrushPresetOperation,
  type StudioToolOperation,
} from "./studio-brush";

export const STUDIO_TOOL_OPERATION_MEMORY_VERSION = 1 as const;

export interface StudioToolOperationMemory {
  readonly version: typeof STUDIO_TOOL_OPERATION_MEMORY_VERSION;
  readonly paint: StudioBrushSnapshot;
  readonly erase: StudioBrushSnapshot;
}

const DEFAULT_STANDARD_ERASER_SNAPSHOT: StudioBrushSnapshot = {
  ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  brushId: "standard-eraser",
  strokeWidth: 20,
  brushOpacity: 1,
  stampTuning: null,
};

function defaultSnapshotForOperation(
  operation: StudioToolOperation,
): StudioBrushSnapshot {
  return operation === "erase"
    ? { ...DEFAULT_STANDARD_ERASER_SNAPSHOT }
    : { ...DEFAULT_STUDIO_BRUSH_SNAPSHOT };
}

export interface NormalizedStudioToolOperationSnapshot {
  readonly snapshot: StudioBrushSnapshot;
  readonly repaired: boolean;
}

export function normalizeStudioToolOperationSnapshot(
  raw: unknown,
  operation: StudioToolOperation,
): NormalizedStudioToolOperationSnapshot {
  const { snapshot, adjustedFields } = sanitizeBrushSnapshot(raw);
  if (resolveStudioBrushPresetOperation(snapshot.brushId) !== operation) {
    return { snapshot: defaultSnapshotForOperation(operation), repaired: true };
  }
  return { snapshot, repaired: adjustedFields.length > 0 };
}

function normalizeOperationSnapshot(
  raw: unknown,
  operation: StudioToolOperation,
): StudioBrushSnapshot {
  return normalizeStudioToolOperationSnapshot(raw, operation).snapshot;
}

/**
 * Normalizes an untrusted/legacy payload without inferring an erase operation from a name.
 * Missing family slots fall back independently, so corrupt erase state cannot replace paint state.
 */
export function normalizeStudioToolOperationMemory(
  value: unknown,
): StudioToolOperationMemory {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    version: STUDIO_TOOL_OPERATION_MEMORY_VERSION,
    paint: normalizeOperationSnapshot(record.paint, "paint"),
    erase: normalizeOperationSnapshot(record.erase, "erase"),
  };
}

export function areStudioToolOperationSnapshotsEqual(
  operation: StudioToolOperation,
  left: StudioBrushSnapshot,
  right: StudioBrushSnapshot,
): boolean {
  return JSON.stringify(normalizeOperationSnapshot(left, operation))
    === JSON.stringify(normalizeOperationSnapshot(right, operation));
}

export interface StudioToolOperationMemoryHydrationMerge {
  readonly memory: StudioToolOperationMemory;
  readonly activeSnapshotDiverged: boolean;
  readonly shouldApplyHydratedActiveSnapshot: boolean;
}

/**
 * Resolves the UI race between async SQLite hydration and edits made from the deterministic
 * first-paint defaults. Explicit tool transitions and any active snapshot divergence both win
 * for that operation only; the untouched sibling operation still comes from SQLite.
 */
export function mergeHydratedStudioToolOperationMemory(options: {
  readonly hydratedMemory: StudioToolOperationMemory;
  readonly initialMemory: StudioToolOperationMemory;
  readonly activeOperation: StudioToolOperation | null;
  readonly activeSnapshot: StudioBrushSnapshot | null;
  readonly operationTransitionTouched: boolean;
}): StudioToolOperationMemoryHydrationMerge {
  const {
    hydratedMemory,
    initialMemory,
    activeOperation,
    activeSnapshot,
    operationTransitionTouched,
  } = options;
  const activeSnapshotDiverged = activeOperation !== null
    && activeSnapshot !== null
    && !areStudioToolOperationSnapshotsEqual(
      activeOperation,
      initialMemory[activeOperation],
      activeSnapshot,
    );
  const preserveActiveSnapshot = operationTransitionTouched || activeSnapshotDiverged;
  return {
    memory: preserveActiveSnapshot && activeOperation !== null && activeSnapshot !== null
      ? rememberStudioToolOperationSnapshot(
          hydratedMemory,
          activeOperation,
          activeSnapshot,
        )
      : hydratedMemory,
    activeSnapshotDiverged,
    shouldApplyHydratedActiveSnapshot:
      !preserveActiveSnapshot && activeOperation !== null,
  };
}

export function rememberStudioToolOperationSnapshot(
  memory: StudioToolOperationMemory,
  operation: StudioToolOperation,
  brushSnapshot: StudioBrushSnapshot,
): StudioToolOperationMemory {
  return {
    ...memory,
    version: STUDIO_TOOL_OPERATION_MEMORY_VERSION,
    [operation]: normalizeOperationSnapshot(brushSnapshot, operation),
  };
}
