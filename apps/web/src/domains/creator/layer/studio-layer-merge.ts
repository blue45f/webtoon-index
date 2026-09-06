/**
 * Layer merge / flatten planners — pure z-order document ops.
 *
 * Rasterization is intentionally out of scope: plans describe which elements to remove and
 * the composite bounds so StudioPage can bake a single image el and insert it.
 * BACK = index 0, FRONT = last (matches studio-layers.ts).
 */

import { isEffectivelyHidden, isEffectivelyLocked, type LayerGroup, type LayerItemLike } from "../studio-layers";

export type StudioLayerMergeKind = "merge-down" | "merge-selected" | "flatten-visible";

export interface StudioLayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioLayerMergeSource {
  id: string;
  /** Document z index (BACK→FRONT position). */
  zIndex: number;
}

export interface StudioLayerMergePlan {
  kind: StudioLayerMergeKind;
  /** Elements removed after successful bake. FRONT-most source id is preferred for naming. */
  removeIds: readonly string[];
  sources: readonly StudioLayerMergeSource[];
  /** Insert index in BACK→FRONT array for the new composite image (replaces lowest source). */
  insertIndex: number;
  /** Union bounds of sources when bounds map is provided; otherwise null. */
  bounds: StudioLayerBounds | null;
  /**
   * Suggested name for the result row. Never a raw element id — the row this names is read by a
   * human, and `병합 e6659cca` told them nothing except that something hashed happened.
   */
  resultName: string;
  /**
   * False when at least one source is not an image layer. The bake can only composite images, so
   * such a plan lands on the non-destructive group fallback and the row count goes *up*.
   * Surfaces must say so before the click instead of calling the result a merge.
   */
  bakesToSingleLayer: boolean;
}

export type StudioLayerMergeResult =
  | { ok: true; plan: StudioLayerMergePlan }
  | { ok: false; reason: string };

function finiteBounds(value: StudioLayerBounds | null | undefined): StudioLayerBounds | null {
  if (!value) return null;
  if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return value;
}

function unionBounds(
  boundsById: ReadonlyMap<string, StudioLayerBounds> | undefined,
  ids: readonly string[]
): StudioLayerBounds | null {
  if (!boundsById) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const id of ids) {
    const box = finiteBounds(boundsById.get(id) ?? null);
    if (!box) continue;
    any = true;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Type-only twin of `studioMergeSourcesAreRasterizable` — no `src` needed to know a vector blocks the bake. */
export function studioLayerSourcesBakeToSingleLayer(sources: readonly LayerItemLike[]): boolean {
  return sources.length >= 2 && sources.every((source) => source.type === "image");
}

/** Type fallback for layers the author never named. Mirrors `elementLabel` without its asset imports. */
const UNNAMED_LAYER_LABEL: Record<string, string> = {
  image: "이미지",
  draw: "그림",
  text: "텍스트",
  bubble: "말풍선",
  sticker: "스티커",
  frame: "패널",
  focusLines: "집중선",
  speedLines: "속도선",
};

function resultNameFor(front: LayerItemLike, count: number, bakesToSingleLayer: boolean): string {
  const authored = front.name?.trim();
  const base = authored || UNNAMED_LAYER_LABEL[front.type ?? ""] || `레이어 ${count}장`;
  // The group fallback adds a row instead of removing one. Calling that "병합" is the lie the
  // layer panel audit caught, so the row the user ends up reading says what actually happened.
  return bakesToSingleLayer ? `${base} 병합` : `${base} 묶음(병합 보류)`;
}

function planFromIndices(
  kind: StudioLayerMergeKind,
  items: readonly LayerItemLike[],
  indices: readonly number[],
  boundsById?: ReadonlyMap<string, StudioLayerBounds>
): StudioLayerMergeResult {
  if (indices.length < 2) {
    return { ok: false, reason: "합치려면 레이어가 두 개 이상 필요합니다." };
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const sources: StudioLayerMergeSource[] = sorted.map((zIndex) => ({
    id: items[zIndex]!.id,
    zIndex,
  }));
  const removeIds = sources.map((source) => source.id);
  const front = items[sorted[sorted.length - 1]!]!;
  const bakesToSingleLayer = studioLayerSourcesBakeToSingleLayer(
    sorted.map((zIndex) => items[zIndex]!)
  );
  return {
    ok: true,
    plan: {
      kind,
      removeIds,
      sources,
      insertIndex: sorted[0]!,
      bounds: unionBounds(boundsById, removeIds),
      resultName: resultNameFor(front, sorted.length, bakesToSingleLayer),
      bakesToSingleLayer,
    },
  };
}

/**
 * Merge the selected layer with the one immediately below (toward BACK).
 * Selected must not be locked; lower neighbor must exist and not be locked.
 */
export function planStudioLayerMergeDown(input: {
  items: readonly LayerItemLike[];
  groups?: readonly LayerGroup[];
  selectedId: string;
  boundsById?: ReadonlyMap<string, StudioLayerBounds>;
}): StudioLayerMergeResult {
  const groups = [...(input.groups ?? [])];
  const index = input.items.findIndex((item) => item.id === input.selectedId);
  if (index < 0) return { ok: false, reason: "선택한 레이어를 찾을 수 없습니다." };
  if (index === 0) return { ok: false, reason: "아래에 합칠 레이어가 없습니다." };
  const upper = input.items[index]!;
  const lower = input.items[index - 1]!;
  if (isEffectivelyLocked(upper, groups) || isEffectivelyLocked(lower, groups)) {
    return { ok: false, reason: "잠긴 레이어는 합칠 수 없습니다." };
  }
  if (isEffectivelyHidden(upper, groups) || isEffectivelyHidden(lower, groups)) {
    return { ok: false, reason: "숨긴 레이어는 합칠 수 없습니다. 표시한 뒤 다시 시도하세요." };
  }
  return planFromIndices("merge-down", input.items, [index - 1, index], input.boundsById);
}

/** Merge all currently selected layers (2+) into one, preserving relative order. */
export function planStudioLayerMergeSelected(input: {
  items: readonly LayerItemLike[];
  groups?: readonly LayerGroup[];
  selectedIds: readonly string[];
  boundsById?: ReadonlyMap<string, StudioLayerBounds>;
}): StudioLayerMergeResult {
  const groups = [...(input.groups ?? [])];
  const idSet = new Set(input.selectedIds);
  const indices: number[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!;
    if (!idSet.has(item.id)) continue;
    if (isEffectivelyLocked(item, groups)) {
      return { ok: false, reason: "잠긴 레이어는 합칠 수 없습니다." };
    }
    if (isEffectivelyHidden(item, groups)) {
      return { ok: false, reason: "숨긴 레이어는 합칠 수 없습니다." };
    }
    indices.push(index);
  }
  if (indices.length < 2) {
    return { ok: false, reason: "합치려면 레이어를 두 개 이상 선택하세요." };
  }
  return planFromIndices("merge-selected", input.items, indices, input.boundsById);
}

/** Flatten all effectively visible, unlocked layers into one composite plan. */
export function planStudioLayerFlattenVisible(input: {
  items: readonly LayerItemLike[];
  groups?: readonly LayerGroup[];
  boundsById?: ReadonlyMap<string, StudioLayerBounds>;
}): StudioLayerMergeResult {
  const groups = [...(input.groups ?? [])];
  const indices: number[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!;
    if (isEffectivelyHidden(item, groups)) continue;
    if (isEffectivelyLocked(item, groups)) {
      return { ok: false, reason: "잠긴 레이어가 있어 평탄화할 수 없습니다." };
    }
    indices.push(index);
  }
  if (indices.length < 2) {
    return { ok: false, reason: "평탄화할 표시 레이어가 충분하지 않습니다." };
  }
  return planFromIndices("flatten-visible", input.items, indices, input.boundsById);
}

/**
 * Apply a merge plan's remove/insert structure after the caller built `composite`.
 * Inserts composite at plan.insertIndex after removing sources (BACK→FRONT array).
 */
export function applyStudioLayerMergePlan<T extends LayerItemLike>(
  items: readonly T[],
  plan: StudioLayerMergePlan,
  composite: T
): T[] {
  const remove = new Set(plan.removeIds);
  const kept = items.filter((item) => !remove.has(item.id));
  const insertAt = Math.max(0, Math.min(plan.insertIndex, kept.length));
  return [...kept.slice(0, insertAt), composite, ...kept.slice(insertAt)];
}
