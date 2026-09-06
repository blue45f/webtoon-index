import {
  migrateStudioShared3dStageCollectionDocument,
  studioShared3dStageVisibilityOverlayElementIds,
} from "../studio-shared-3d-stage-collection";

import {
  studioLayerGroupToCrdtGroup,
  studioDrawElementToCrdtStroke,
  studioElementToCrdtSceneElement,
  studioPageToCrdtPage,
  type StudioCrdtCompatibleDrawElement,
  type StudioCrdtCompatibleElement,
  type StudioCrdtCompatibleOrderedPage,
} from "./studio-crdt-page-bridge";
import { studioCrdtLayerGroupKey } from "./studio-crdt-scene-schema";

import type {
  StudioCrdtDocument,
  StudioCrdtDrawStrokePayload,
  StudioCrdtJsonObject,
  StudioCrdtLayerGroupInput,
  StudioCrdtSceneElementInput,
  StudioCrdtStrokePayloadKey,
} from "./studio-crdt-document";

export interface StudioCrdtOrderMove {
  id: string;
  beforeId: string | null;
}

export interface StudioCrdtScenePublishResult {
  sceneElementMutations: number;
  layerGroupMutations: number;
  pageMutations: number;
  elementMoves: number;
  pageMoves: number;
}

export interface StudioCrdtDrawPublishOptions {
  /** New local strokes are registered by default. History reconciliation can disable this. */
  registerNewDraws?: boolean;
}

export type StudioCrdtScenePublishOptions = StudioCrdtDrawPublishOptions;

interface StudioCrdtPropertyDiff {
  set: StudioCrdtJsonObject;
  unset: string[];
  changed: string[];
}

const STROKE_SAMPLE_KEYS = [
  "points",
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
] as const satisfies readonly StudioCrdtStrokePayloadKey[];

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => jsonValueEqual(value, right[index]!));
  }
  if (
    left === null || right === null || typeof left !== "object" || typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      jsonValueEqual(leftRecord[key], rightRecord[key]));
}

function diffStrokePayloadKeys(
  previous: StudioCrdtDrawStrokePayload,
  next: StudioCrdtDrawStrokePayload
): StudioCrdtStrokePayloadKey[] {
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)]);
  const changed: StudioCrdtStrokePayloadKey[] = [];
  for (const key of keys) {
    if (!jsonValueEqual(previousRecord[key], nextRecord[key])) {
      changed.push(key as StudioCrdtStrokePayloadKey);
    }
  }
  if (changed.some((key) => (STROKE_SAMPLE_KEYS as readonly string[]).includes(key))) {
    for (const key of STROKE_SAMPLE_KEYS) {
      if (!changed.includes(key)) changed.push(key);
    }
  }
  return changed;
}

function diffProperties(
  previous: StudioCrdtJsonObject,
  next: StudioCrdtJsonObject
): StudioCrdtPropertyDiff {
  const set: StudioCrdtJsonObject = {};
  const unset: string[] = [];
  const changed: string[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (!(key in next)) {
      unset.push(key);
      continue;
    }
    if (!(key in previous) || !jsonValueEqual(previous[key]!, next[key]!)) {
      set[key] = next[key]!;
      changed.push(key);
    }
  }
  return { set, unset, changed };
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isCompatibleDrawElement<TElement extends StudioCrdtCompatibleElement>(
  element: TElement
): element is TElement & StudioCrdtCompatibleDrawElement {
  return element.type === "draw";
}

/**
 * Produces a minimum-cardinality move set for unique IDs by retaining one LIS/LCS. Moves are
 * emitted tail-to-head, matching the CRDT's `move(id, beforeId)` primitive.
 */
export function planStudioCrdtOrderMoves(
  currentIds: readonly string[],
  desiredIds: readonly string[]
): StudioCrdtOrderMove[] {
  const current = uniqueIds(currentIds);
  const desired = uniqueIds(desiredIds);
  const desiredPosition = new Map(desired.map((id, index) => [id, index]));
  const common = current.filter((id) => desiredPosition.has(id));
  const positions = common.map((id) => desiredPosition.get(id)!);
  const tails: number[] = [];
  const tailIndices: number[] = [];
  const previousIndices = Array<number>(positions.length).fill(-1);
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (tails[middle]! < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    previousIndices[index] = low > 0 ? tailIndices[low - 1]! : -1;
    tailIndices[low] = index;
  }
  const retained = new Set<string>();
  let retainedIndex = tailIndices[tails.length - 1] ?? -1;
  while (retainedIndex >= 0) {
    retained.add(common[retainedIndex]!);
    retainedIndex = previousIndices[retainedIndex]!;
  }

  const moves: StudioCrdtOrderMove[] = [];
  let beforeId: string | null = null;
  for (let index = desired.length - 1; index >= 0; index -= 1) {
    const id = desired[index]!;
    if (!retained.has(id)) moves.push({ id, beforeId });
    beforeId = id;
  }
  return moves;
}

function supportedSceneInputs<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(pages: readonly TPage[]): Map<string, StudioCrdtSceneElementInput> {
  const result = new Map<string, StudioCrdtSceneElementInput>();
  for (const page of pages) {
    const stageVisibilityElementIds = studioShared3dStageVisibilityOverlayElementIds(
      page.shared3dStage,
      page.elements,
    );
    for (const element of page.elements) {
      if (isCompatibleDrawElement(element)) continue;
      if (result.has(element.id)) throw new Error("페이지 간에 중복된 장면 요소 식별자가 있습니다.");
      // `hidden` remains the artist-authored visibility scalar. A Shared Stage receipt owns only a
      // derived overlay, so connect/unlink never creates a cross-root LWW race between the element
      // scalar and the remove-wins receipt events.
      const persistentElement = stageVisibilityElementIds.has(element.id)
        ? { ...element, hidden: false }
        : element;
      result.set(
        element.id,
        studioElementToCrdtSceneElement(page.id, persistentElement)
      );
    }
  }
  return result;
}

function sharedStageVisibilityElementIds<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(pages: readonly TPage[]): Set<string> {
  const result = new Set<string>();
  for (const page of pages) {
    for (const id of studioShared3dStageVisibilityOverlayElementIds(
      page.shared3dStage,
      page.elements,
    )) result.add(id);
  }
  return result;
}

function removesSharedStageAuthority(
  previous: StudioCrdtCompatibleOrderedPage<StudioCrdtCompatibleElement>["shared3dStage"],
  next: StudioCrdtCompatibleOrderedPage<StudioCrdtCompatibleElement>["shared3dStage"],
): boolean {
  const before = migrateStudioShared3dStageCollectionDocument(previous);
  if (!before) return false;
  const after = migrateStudioShared3dStageCollectionDocument(next);
  if (!after) return true;
  const stageIds = new Set(after.stages.map(({ id }) => id));
  if (before.stages.some(({ id }) => !stageIds.has(id))) return true;
  const receiptRuntimeById = new Map(after.visibilityReceipts.map((receipt) => [
    receipt.elementId,
    receipt.modelRuntimeKey,
  ]));
  return before.visibilityReceipts.some((receipt) =>
    receiptRuntimeById.get(receipt.elementId) !== receipt.modelRuntimeKey);
}

function supportedLayerGroupInputs<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(pages: readonly TPage[]): Map<string, StudioCrdtLayerGroupInput> {
  const result = new Map<string, StudioCrdtLayerGroupInput>();
  for (const page of pages) {
    for (const group of page.groups ?? []) {
      const key = studioCrdtLayerGroupKey(page.id, group.id);
      if (result.has(key)) throw new Error("같은 페이지에 중복된 레이어 그룹 식별자가 있습니다.");
      result.set(key, studioLayerGroupToCrdtGroup(page.id, group));
    }
  }
  return result;
}

interface StudioCrdtDrawLocation {
  pageId: string;
  layerId: string;
  element: StudioCrdtCompatibleDrawElement;
}

function supportedDrawInputs<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(pages: readonly TPage[]): Map<string, StudioCrdtDrawLocation> {
  const result = new Map<string, StudioCrdtDrawLocation>();
  for (const page of pages) {
    for (const element of page.elements) {
      if (!isCompatibleDrawElement(element)) continue;
      if (result.has(element.id)) throw new Error("페이지 간에 중복된 드로우 식별자가 있습니다.");
      result.set(element.id, {
        pageId: page.id,
        layerId: element.groupId ?? "page-root",
        element,
      });
    }
  }
  return result;
}

function drawInput(location: StudioCrdtDrawLocation) {
  return studioDrawElementToCrdtStroke(location.pageId, location.element);
}

/**
 * Publishes draw payload edits using document-global identity. The global comparison is important:
 * a stroke moved from page A to B is a reparent, not a delete on A followed by a resurrection on B.
 * When a peer has already moved the stroke, a scalar-only local edit preserves the peer page/layer.
 */
export function publishStudioCrdtDrawGraphDiff<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(
  document: StudioCrdtDocument,
  previousPages: readonly TPage[],
  nextPages: readonly TPage[],
  options: StudioCrdtDrawPublishOptions = {}
): number {
  const previous = supportedDrawInputs(previousPages);
  const next = supportedDrawInputs(nextPages);
  const registerNewDraws = options.registerNewDraws ?? true;
  let mutations = 0;

  for (const [id, previousLocation] of previous) {
    if (next.has(id)) continue;
    let current = document.getStroke(id, true);
    if (!current) {
      document.replaceStroke(drawInput(previousLocation));
      mutations += 1;
      current = document.getStroke(id, true);
    }
    if (current && !current.deleted && document.deleteStroke(id)) mutations += 1;
  }

  for (const [id, nextLocation] of next) {
    const previousLocation = previous.get(id) ?? null;
    const current = document.getStroke(id, true);
    const nextInput = drawInput(nextLocation);
    const previousInput = previousLocation ? drawInput(previousLocation) : null;
    const changedPayloadKeys = previousInput
      ? diffStrokePayloadKeys(previousInput.payload, nextInput.payload)
      : [];
    const locallyReparented = previousLocation !== null && (
      previousLocation.pageId !== nextLocation.pageId ||
      previousLocation.layerId !== nextLocation.layerId
    );
    const topologyWriteNeeded = locallyReparented && (
      current?.pageId !== nextLocation.pageId || current.layerId !== nextLocation.layerId
    );
    const locallyEdited = changedPayloadKeys.length > 0;

    if (!current) {
      if (!previousLocation) {
        if (registerNewDraws) {
          document.replaceStroke(nextInput);
          mutations += 1;
        }
      } else if (locallyEdited || locallyReparented) {
        // The first real edit of a legacy stroke materializes it in the durable CRDT. Unchanged
        // legacy snapshots remain local until an operation actually touches them.
        document.replaceStroke(nextInput);
        mutations += 1;
      }
      continue;
    }
    if (current.deleted) {
      // Preserve a peer tombstone for stale snapshots. Only an explicit absent -> present local
      // transition (redo/re-add) owns resurrection.
      if (!previousLocation) {
        document.restoreStroke(id);
        document.replaceStroke(nextInput);
        mutations += 2;
      }
      continue;
    }
    if (!previousLocation) {
      // This is the pointer-up/final commit for a draw created after the previous React snapshot.
      // A peer-streaming draw that exists in both snapshots takes the branch below and is untouched.
      if (current.status === "drawing") {
        const completionKeys = diffStrokePayloadKeys(current.payload, nextInput.payload);
        document.patchStroke(id, {
          pageId: nextLocation.pageId,
          layerId: nextLocation.layerId,
          payload: nextInput.payload,
          changedPayloadKeys: completionKeys,
        });
        if (document.getStroke(id, true)?.status === "drawing") document.finalizeStroke(id);
        mutations += 1;
      }
      continue;
    }
    if (locallyEdited || topologyWriteNeeded) {
      document.patchStroke(id, {
        pageId: topologyWriteNeeded ? nextLocation.pageId : undefined,
        layerId: topologyWriteNeeded ? nextLocation.layerId : undefined,
        payload: nextInput.payload,
        changedPayloadKeys,
      });
      mutations += 1;
    }
  }
  return mutations;
}

function publishDrawTopologyRecords(
  document: StudioCrdtDocument,
  previous: ReadonlyMap<string, StudioCrdtDrawLocation>,
  next: ReadonlyMap<string, StudioCrdtDrawLocation>,
  registerNewDraws: boolean
): number {
  let mutations = 0;
  for (const [id, previousLocation] of previous) {
    if (next.has(id)) continue;
    let current = document.getStroke(id, true);
    if (!current) {
      document.replaceStroke(drawInput(previousLocation));
      mutations += 1;
      current = document.getStroke(id, true);
    }
    if (current && !current.deleted && document.deleteStroke(id)) mutations += 1;
  }
  for (const [id, nextLocation] of next) {
    const previousLocation = previous.get(id) ?? null;
    const current = document.getStroke(id, true);
    if (!previousLocation) {
      if (!current) {
        if (!registerNewDraws) continue;
        document.replaceStroke(drawInput(nextLocation));
        mutations += 1;
      } else if (current.deleted) {
        document.restoreStroke(id);
        document.replaceStroke(drawInput(nextLocation));
        mutations += 2;
      }
      continue;
    }
    const locallyReparented = previousLocation.pageId !== nextLocation.pageId ||
      previousLocation.layerId !== nextLocation.layerId;
    if (!locallyReparented || current?.deleted) continue;
    if (
      current &&
      current.pageId === nextLocation.pageId &&
      current.layerId === nextLocation.layerId
    ) continue;
    // Missing means a local reparent is the first operation on a legacy stroke. Existing means the
    // same durable record changes ownership; there is no page-local delete/resurrect window.
    if (current) {
      document.patchStroke(id, {
        pageId: nextLocation.pageId,
        layerId: nextLocation.layerId,
      });
    } else {
      document.replaceStroke(drawInput(nextLocation));
    }
    mutations += 1;
  }
  return mutations;
}

function publishSceneElementRecords(
  document: StudioCrdtDocument,
  previous: ReadonlyMap<string, StudioCrdtSceneElementInput>,
  next: ReadonlyMap<string, StudioCrdtSceneElementInput>,
  forceRegisterIds: ReadonlySet<string> = new Set(),
): number {
  let mutations = 0;

  for (const [id, previousInput] of previous) {
    if (next.has(id)) continue;
    let current = document.getSceneElement(id, true);
    if (!current) {
      document.upsertSceneElement(previousInput, {
        baselineProps: previousInput.payload.props,
        changedProps: [],
      });
      mutations += 1;
      current = document.getSceneElement(id, true);
    }
    if (current && !current.deleted && document.deleteSceneElement(id)) mutations += 1;
  }

  for (const [id, nextInput] of next) {
    const previousInput = previous.get(id) ?? null;
    const current = document.getSceneElement(id, true);
    if (!current) {
      if (!previousInput) {
        document.addSceneElement(nextInput);
        mutations += 1;
        continue;
      }
      const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
      const reparented = previousInput.pageId !== nextInput.pageId ||
        previousInput.layerId !== nextInput.layerId;
      if (
        diff.changed.length === 0 && diff.unset.length === 0 && !reparented
        && !forceRegisterIds.has(id)
      ) continue;
      document.upsertSceneElement(nextInput, {
        baselineProps: previousInput.payload.props,
        changedProps: diff.changed,
        unsetProps: diff.unset,
      });
      mutations += 1;
      continue;
    }
    if (current.deleted) {
      // A stale React snapshot must not resurrect a peer tombstone. Only a real absent -> present
      // transition (redo or explicit re-add) owns resurrection.
      if (!previousInput) {
        document.upsertSceneElement(nextInput, { resurrect: true });
        mutations += 1;
      }
      continue;
    }
    if (!previousInput) continue; // Durable remote addition already won; never overwrite it here.
    if (current.payload.type !== nextInput.payload.type) {
      throw new Error("같은 장면 요소 식별자의 타입을 변경할 수 없습니다.");
    }
    const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
    // A pre-existing topology reference may predate the synchronized image visibility scalar.
    // Shared Stage receipts derive hidden=true in memory, so the durable scalar underneath that
    // overlay must explicitly converge to the normalized next value before an unlink reveals it.
    // Patch only this one scalar: peer placement/filter edits and tombstones remain untouched.
    const forcedHidden = forceRegisterIds.has(id) &&
      typeof nextInput.payload.props.hidden === "boolean" &&
      current.payload.props.hidden !== nextInput.payload.props.hidden
        ? nextInput.payload.props.hidden
        : undefined;
    const pageChanged = previousInput.pageId !== nextInput.pageId;
    const layerChanged = previousInput.layerId !== nextInput.layerId;
    if (
      diff.changed.length === 0 && diff.unset.length === 0 && forcedHidden === undefined &&
      !pageChanged && !layerChanged
    ) continue;
    document.patchSceneElement(id, {
      set: forcedHidden === undefined ? diff.set : { ...diff.set, hidden: forcedHidden },
      unset: diff.unset,
      pageId: pageChanged ? nextInput.pageId : undefined,
      layerId: layerChanged ? nextInput.layerId : undefined,
    });
    mutations += 1;
  }
  return mutations;
}

function publishLayerGroupRecords(
  document: StudioCrdtDocument,
  previous: ReadonlyMap<string, StudioCrdtLayerGroupInput>,
  next: ReadonlyMap<string, StudioCrdtLayerGroupInput>
): number {
  let mutations = 0;
  for (const [key, previousInput] of previous) {
    if (next.has(key)) continue;
    let current = document.getLayerGroup(previousInput.pageId, previousInput.id, true);
    if (!current) {
      document.upsertLayerGroup(previousInput, {
        baselineProps: previousInput.payload.props,
        changedProps: [],
      });
      mutations += 1;
      current = document.getLayerGroup(previousInput.pageId, previousInput.id, true);
    }
    if (
      current && !current.deleted &&
      document.deleteLayerGroup(previousInput.pageId, previousInput.id)
    ) {
      mutations += 1;
    }
  }

  for (const [key, nextInput] of next) {
    const previousInput = previous.get(key) ?? null;
    const current = document.getLayerGroup(nextInput.pageId, nextInput.id, true);
    if (!current) {
      if (!previousInput) {
        document.addLayerGroup(nextInput);
      } else {
        const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
        // Register unchanged legacy metadata too. A grouped element may be the actual operation in
        // this transition, and its canonical layer target must exist before that element is sent.
        document.upsertLayerGroup(nextInput, {
          baselineProps: previousInput.payload.props,
          changedProps: diff.changed,
          unsetProps: diff.unset,
        });
      }
      mutations += 1;
      continue;
    }
    if (current.deleted) {
      // Stale snapshots cannot revive a peer tombstone. Re-add/redo is the only absent -> present
      // transition that owns an explicit resurrection.
      if (!previousInput) {
        document.upsertLayerGroup(nextInput, { resurrect: true });
        mutations += 1;
      }
      continue;
    }
    if (!previousInput) continue;
    const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
    if (diff.changed.length === 0 && diff.unset.length === 0) continue;
    document.patchLayerGroup(nextInput.pageId, nextInput.id, {
      set: diff.set,
      unset: diff.unset,
    });
    mutations += 1;
  }
  return mutations;
}

function publishSceneOrderForPage<TElement extends StudioCrdtCompatibleElement>(
  document: StudioCrdtDocument,
  pageId: string,
  previousElements: readonly TElement[],
  nextElements: readonly TElement[],
  previous: ReadonlyMap<string, StudioCrdtSceneElementInput>,
  next: ReadonlyMap<string, StudioCrdtSceneElementInput>,
  forceBootstrap: boolean
): { mutations: number; moves: number } {
  let mutations = 0;
  const previousMixedOrder = previousElements.map((element) => element.id);
  const nextMixedOrder = nextElements.map((element) => element.id);
  if (!forceBootstrap && previousMixedOrder.join("\0") === nextMixedOrder.join("\0")) {
    return { mutations: 0, moves: 0 };
  }

  // Add/delete/reorder all need complete sibling context, including legacy draw operations.
  for (const element of nextElements) {
    if (!isCompatibleDrawElement(element)) {
      const id = element.id;
      if (document.getSceneElement(id, true)) continue;
      const previousInput = previous.get(id);
      const nextInput = next.get(id);
      if (!nextInput) continue;
      if (previousInput) {
        document.upsertSceneElement(nextInput, {
          baselineProps: previousInput.payload.props,
          changedProps: [],
        });
      } else {
        document.addSceneElement(nextInput);
      }
      mutations += 1;
      continue;
    }
    const current = document.getStroke(element.id, true);
    if (current?.deleted) continue;
    if (!current) {
      document.replaceStroke(studioDrawElementToCrdtStroke(pageId, element));
      mutations += 1;
    }
  }

  const desiredIds = nextElements.map((element) => element.id)
    .filter((id) => document.getStroke(id) !== null || document.getSceneElement(id) !== null);
  const desiredSet = new Set(desiredIds);
  const currentIds = [
    ...document.getStrokes({ pageId }),
    ...document.getSceneElements({ pageId }),
  ].sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
    .map((record) => record.id)
    .filter((id) => desiredSet.has(id));
  const moves = planStudioCrdtOrderMoves(currentIds, desiredIds);
  for (const move of moves) document.moveElement(move.id, move.beforeId);
  return { mutations, moves: moves.length };
}

export function publishStudioCrdtSceneGraphDiff<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(
  document: StudioCrdtDocument,
  previousPages: readonly TPage[],
  nextPages: readonly TPage[],
  options: StudioCrdtScenePublishOptions = {}
): StudioCrdtScenePublishResult {
  const registerNewDraws = options.registerNewDraws ?? true;
  const previousById = new Map(previousPages.map((page) => [page.id, page]));
  const nextById = new Map(nextPages.map((page) => [page.id, page]));
  // Validate every bounded page envelope and every unbounded Shared Stage collection before the
  // first document mutation. Shared Stage itself is intentionally not copied into the 8 KiB page
  // payload; it is published per entry below so independent stage edits do not become one opaque
  // last-writer-wins value.
  const previousPageInputs = new Map(previousPages.map((page) => [
    page.id,
    studioPageToCrdtPage(page),
  ]));
  const nextPageInputs = new Map(nextPages.map((page) => [
    page.id,
    studioPageToCrdtPage(page),
  ]));
  const canonicalSharedStageByPage = <T extends TPage>(pages: readonly T[]) => new Map(
    pages.map((page) => {
      const canonical = page.shared3dStage === undefined
        ? null
        : migrateStudioShared3dStageCollectionDocument(page.shared3dStage);
      if (page.shared3dStage !== undefined && canonical === null) {
        throw new Error("페이지 공유 3D 장면 연결 정보가 손상되었습니다.");
      }
      return [page.id, canonical] as const;
    }),
  );
  const previousCanonicalSharedStageByPageId = canonicalSharedStageByPage(previousPages);
  const nextCanonicalSharedStageByPageId = canonicalSharedStageByPage(nextPages);
  const previousSceneInputs = supportedSceneInputs(previousPages);
  const nextSceneInputs = supportedSceneInputs(nextPages);
  const sharedStageVisibilityIds = new Set([
    ...sharedStageVisibilityElementIds(previousPages),
    ...sharedStageVisibilityElementIds(nextPages),
  ]);
  const previousLayerGroupInputs = supportedLayerGroupInputs(previousPages);
  const nextLayerGroupInputs = supportedLayerGroupInputs(nextPages);
  const previousDrawInputs = supportedDrawInputs(previousPages);
  const nextDrawInputs = supportedDrawInputs(nextPages);
  const managedElementIdsBefore = new Set([
    ...document.getStrokes({ includeDeleted: true }).map(({ id }) => id),
    ...document.getSceneElements({ includeDeleted: true }).map(({ id }) => id),
  ]);
  const managedPageIdsBefore = new Set(document.getPages(true).map(({ id }) => id));
  let pageMutations = 0;

  // A first Shared Stage bootstrap needs a durable page identity before the server can admit its
  // sidecar records. Materialize only pages that participate in Shared Stage authority; the main
  // page diff below retains its existing lazy registration behavior for every other page.
  const sharedStagePageIds = new Set<string>();
  const deferredSharedStagePageIds = new Set<string>();
  const managedSharedStagePageIds = new Set(
    document.getShared3dStageFrontier()
      .filter(({ managed }) => managed)
      .map(({ pageId }) => pageId),
  );
  for (const pageId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const previousValue = previousById.get(pageId)?.shared3dStage;
    const nextValue = nextById.get(pageId)?.shared3dStage;
    const managed = managedSharedStagePageIds.has(pageId);
    const participatesInSharedStage = previousValue !== undefined
      || nextValue !== undefined
      || managed;
    const pageDeleted = !nextById.has(pageId);
    const needsPageBootstrap = !pageDeleted
      && participatesInSharedStage
      && !managedPageIdsBefore.has(pageId);
    const needsUnmanagedStageBootstrap = !managed && nextValue !== undefined;
    const canonicalChanged = !jsonValueEqual(
      previousCanonicalSharedStageByPageId.get(pageId) ?? null,
      nextCanonicalSharedStageByPageId.get(pageId) ?? null,
    );
    const needsManagedPageDeletion = managed && pageDeleted;
    if (
      !canonicalChanged
      && !needsPageBootstrap
      && !needsUnmanagedStageBootstrap
      && !needsManagedPageDeletion
    ) continue;
    sharedStagePageIds.add(pageId);
    if (pageDeleted || removesSharedStageAuthority(previousValue, nextValue)) {
      deferredSharedStagePageIds.add(pageId);
    }
  }
  // Pure-plan every sidecar change before page bootstrap or any scene/group mutation. The actual
  // publisher reuses the same plan and therefore cannot discover an aggregate or 48 KiB failure
  // only after a linked source has already changed visibility.
  for (const pageId of sharedStagePageIds) {
    document.preflightShared3dStagePageDiff(
      pageId,
      previousById.get(pageId)?.shared3dStage,
      nextById.get(pageId)?.shared3dStage,
      { pageDeleted: !nextById.has(pageId) },
    );
  }
  for (const pageId of sharedStagePageIds) {
    if (document.getPage(pageId, true)) continue;
    const nextInput = nextPageInputs.get(pageId);
    const previousInput = previousPageInputs.get(pageId);
    const pageInput = nextInput ?? previousInput;
    if (!pageInput) continue;
    if (nextInput && !previousInput) document.addPage(nextInput);
    else {
      document.upsertPage(pageInput, {
        baselineProps: previousInput?.payload.props ?? pageInput.payload.props,
        changedProps: [],
      });
    }
    pageMutations += 1;
  }
  // Additive authority is published first so a peer can derive Stage-owned hiding immediately.
  // Destructive authority is deferred until the normalized visible source record is durable below.
  for (const pageId of sharedStagePageIds) {
    if (deferredSharedStagePageIds.has(pageId)) continue;
    document.publishShared3dStagePageDiff(
      pageId,
      previousById.get(pageId)?.shared3dStage,
      nextById.get(pageId)?.shared3dStage,
      { pageDeleted: !nextById.has(pageId) },
    );
  }
  const layerGroupMutations = publishLayerGroupRecords(
    document,
    previousLayerGroupInputs,
    nextLayerGroupInputs
  );
  let sceneElementMutations = publishStudioCrdtDrawGraphDiff(
    document,
    previousPages,
    nextPages,
    { registerNewDraws }
  );
  sceneElementMutations += publishSceneElementRecords(
    document,
    previousSceneInputs,
    nextSceneInputs,
    sharedStageVisibilityIds,
  );
  sceneElementMutations += publishDrawTopologyRecords(
    document,
    previousDrawInputs,
    nextDrawInputs,
    registerNewDraws
  );
  // Unlink after the Stage-owned `hidden` overlay has been removed from the durable scene scalar.
  // If transport stops between these updates, an active receipt still derives hidden=true; after
  // the tombstone arrives the already-visible scalar is revealed, so neither partial order strands
  // a linked source in the wrong state.
  for (const pageId of deferredSharedStagePageIds) {
    document.publishShared3dStagePageDiff(
      pageId,
      previousById.get(pageId)?.shared3dStage,
      nextById.get(pageId)?.shared3dStage,
      { pageDeleted: !nextById.has(pageId) },
    );
  }
  const bootstrapElementOrderPages = new Set<string>();
  for (const page of nextPages) {
    if (page.elements.some((element) =>
      !managedElementIdsBefore.has(element.id) &&
      (document.getStroke(element.id, true) !== null ||
        document.getSceneElement(element.id, true) !== null)
    )) bootstrapElementOrderPages.add(page.id);
  }
  let elementMoves = 0;
  const pageIds = new Set([...previousById.keys(), ...nextById.keys()]);
  for (const pageId of pageIds) {
    const result = publishSceneOrderForPage(
      document,
      pageId,
      previousById.get(pageId)?.elements ?? [],
      nextById.get(pageId)?.elements ?? [],
      previousSceneInputs,
      nextSceneInputs,
      bootstrapElementOrderPages.has(pageId)
    );
    sceneElementMutations += result.mutations;
    elementMoves += result.moves;
  }

  for (const id of previousById.keys()) {
    if (nextById.has(id)) continue;
    let current = document.getPage(id, true);
    if (!current) {
      const previousInput = previousPageInputs.get(id)!;
      document.upsertPage(previousInput, {
        baselineProps: previousInput.payload.props,
        changedProps: [],
      });
      pageMutations += 1;
      current = document.getPage(id, true);
    }
    if (current && !current.deleted && document.deletePage(id)) pageMutations += 1;
  }
  for (const id of nextById.keys()) {
    const nextInput = nextPageInputs.get(id)!;
    const previousInput = previousById.has(id) ? previousPageInputs.get(id)! : null;
    const current = document.getPage(id, true);
    if (!current) {
      if (!previousInput) {
        document.addPage(nextInput);
        pageMutations += 1;
        continue;
      }
      const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
      if (diff.changed.length === 0 && diff.unset.length === 0) continue;
      document.upsertPage(nextInput, {
        baselineProps: previousInput.payload.props,
        changedProps: diff.changed,
        unsetProps: diff.unset,
      });
      pageMutations += 1;
      continue;
    }
    if (current.deleted) {
      if (!previousInput) {
        document.upsertPage(nextInput, { resurrect: true });
        pageMutations += 1;
      }
      continue;
    }
    if (!previousInput) continue;
    const diff = diffProperties(previousInput.payload.props, nextInput.payload.props);
    if (diff.changed.length === 0 && diff.unset.length === 0) continue;
    document.patchPage(id, { set: diff.set, unset: diff.unset });
    pageMutations += 1;
  }

  const previousOrder = previousPages.map((page) => page.id);
  const nextOrder = nextPages.map((page) => page.id);
  const pageTopologyChanged = previousOrder.join("\0") !== nextOrder.join("\0");
  const pageOrderNeedsBootstrap = pageTopologyChanged || nextPages.some(
    (page) => !managedPageIdsBefore.has(page.id) && document.getPage(page.id, true) !== null
  );
  if (pageOrderNeedsBootstrap) {
    for (const page of nextPages) {
      if (document.getPage(page.id, true)) continue;
      const previousPage = previousById.get(page.id);
      if (!previousPage) continue;
      const previousInput = previousPageInputs.get(page.id)!;
      const nextInput = nextPageInputs.get(page.id)!;
      document.upsertPage(nextInput, {
        baselineProps: previousInput.payload.props,
        changedProps: [],
      });
      pageMutations += 1;
    }
    const desiredPageIds = nextPages.map((page) => page.id)
      .filter((id) => document.getPage(id) !== null);
    const desiredPageSet = new Set(desiredPageIds);
    const currentPageIds = document.getPages().map((record) => record.id)
      .filter((id) => desiredPageSet.has(id));
    const pageMoves = planStudioCrdtOrderMoves(currentPageIds, desiredPageIds);
    for (const move of pageMoves) document.movePage(move.id, move.beforeId);
    return {
      sceneElementMutations,
      layerGroupMutations,
      pageMutations,
      elementMoves,
      pageMoves: pageMoves.length,
    };
  }

  return {
    sceneElementMutations,
    layerGroupMutations,
    pageMutations,
    elementMoves,
    pageMoves: 0,
  };
}
