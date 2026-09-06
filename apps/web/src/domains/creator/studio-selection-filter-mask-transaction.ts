/**
 * Pixel selection -> non-destructive filter-mask transaction.
 *
 * The selection raster, filter fields, and paintable filter mask are emitted as one immutable
 * payload. Callers must hand that payload to their document commit boundary exactly once; doing
 * so keeps filter application and mask creation in the same undo/CRDT snapshot.
 */
import {
  buildSelectionMaskPlan,
  isSelectionUsable,
  rasterizeSelectionMask,
  type MaskCanvasLike,
  type MaskImageSource,
  type PixelSelection,
  type SelectionCanvasFactory,
  type SelectionMaskPlan,
} from "./studio-selection-tools";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";

export type StudioSelectionFilterMaskScope = "inside" | "outside";

export type StudioSelectionFilterMaskTarget = Readonly<{
  id: string;
  type: string;
  width: number;
  flipped?: boolean;
  flippedY?: boolean;
  locked?: boolean;
}>;

export type StudioSelectionFilterMaskFailureCode =
  | "invalid-target"
  | "locked-target"
  | "empty-selection"
  | "invalid-image-size"
  | "mask-raster-failed"
  | "mask-serialization-failed";

export type StudioSelectionFilterMaskPatch = Partial<ImageFilterFields> & Readonly<{
  filterMaskSrc: string;
  filterMaskEnabled: true;
}>;

export type StudioSelectionFilterMaskTransaction = Readonly<{
  targetId: string;
  scope: StudioSelectionFilterMaskScope;
  /** One combined patch is the atomic document/undo payload. */
  patch: StudioSelectionFilterMaskPatch;
  maskPlan: SelectionMaskPlan;
  historyLabel: string;
  historyEntryCount: 1;
}>;

export type StudioSelectionFilterMaskTransactionResult =
  | Readonly<{ ok: true; transaction: StudioSelectionFilterMaskTransaction }>
  | Readonly<{
      ok: false;
      code: StudioSelectionFilterMaskFailureCode;
      message: string;
    }>;

export type StudioSelectionMaskSerializer = (
  mask: MaskCanvasLike & MaskImageSource,
) => string;

/** Async serializer (toBlob-first PNG). Preferred on the product path for large masks. */
export type StudioSelectionMaskAsyncSerializer = (
  mask: MaskCanvasLike & MaskImageSource,
) => Promise<string>;

function failure(
  code: StudioSelectionFilterMaskFailureCode,
  message: string,
): StudioSelectionFilterMaskTransactionResult {
  return { ok: false, code, message };
}

/**
 * Builds the single payload used by `patchEl`/history. `outside` is an additional inversion of the
 * current selection, so a selection that is already inverted still behaves predictably:
 * `effectiveInvert = selection.invert XOR outside`.
 */
export function createStudioSelectionFilterMaskTransaction(input: Readonly<{
  target: StudioSelectionFilterMaskTarget;
  selection: PixelSelection | null;
  scope: StudioSelectionFilterMaskScope;
  imageWidth: number;
  imageHeight: number;
  filterPatch: Partial<ImageFilterFields>;
  createCanvas: SelectionCanvasFactory;
  serializeMask: StudioSelectionMaskSerializer;
  /** Includes inherited group/review/collaboration locks resolved by the caller. */
  mutationLocked?: boolean;
}>): StudioSelectionFilterMaskTransactionResult {
  if (input.target.type !== "image" || input.target.id.length === 0) {
    return failure("invalid-target", "선택 영역 필터는 이미지 레이어에만 적용할 수 있습니다.");
  }
  if (input.mutationLocked || input.target.locked) {
    return failure("locked-target", "이미지와 상위 그룹의 잠금을 해제한 뒤 다시 적용하세요.");
  }
  if (!isSelectionUsable(input.selection)) {
    return failure("empty-selection", "필터를 적용할 픽셀 영역을 먼저 선택하세요.");
  }
  if (
    !Number.isFinite(input.imageWidth)
    || !Number.isFinite(input.imageHeight)
    || input.imageWidth <= 0
    || input.imageHeight <= 0
  ) {
    return failure("invalid-image-size", "이미지 크기를 확인하지 못해 선택 마스크를 만들 수 없습니다.");
  }

  const basePlan = buildSelectionMaskPlan(
    input.selection,
    input.imageWidth,
    input.imageHeight,
    {
      featherScale:
        input.target.width > 0 ? input.imageWidth / input.target.width : 1,
      flipX: input.target.flipped,
      flipY: input.target.flippedY,
    },
  );
  if (!basePlan) {
    return failure("mask-raster-failed", "선택 영역 마스크 계획을 만들지 못했습니다.");
  }

  const maskPlan: SelectionMaskPlan = input.scope === "outside"
    ? { ...basePlan, invert: !basePlan.invert }
    : basePlan;
  const mask = rasterizeSelectionMask(maskPlan, input.createCanvas);
  if (!mask) {
    return failure("mask-raster-failed", "선택 영역 마스크를 만들지 못했습니다.");
  }

  let filterMaskSrc: string;
  try {
    filterMaskSrc = input.serializeMask(mask);
  } catch {
    return failure("mask-serialization-failed", "선택 영역 마스크를 PNG로 저장하지 못했습니다.");
  }
  if (!filterMaskSrc.startsWith("data:image/png;base64,") || filterMaskSrc.length <= 22) {
    return failure("mask-serialization-failed", "선택 영역 마스크 PNG가 올바르지 않습니다.");
  }

  return {
    ok: true,
    transaction: {
      targetId: input.target.id,
      scope: input.scope,
      patch: {
        ...input.filterPatch,
        filterMaskSrc,
        filterMaskEnabled: true,
      },
      maskPlan,
      historyLabel: input.scope === "inside"
        ? "필터 · 선택 안에 적용"
        : "필터 · 선택 밖에 적용",
      historyEntryCount: 1,
    },
  };
}

/**
 * Async product path — same contract as {@link createStudioSelectionFilterMaskTransaction}
 * but allows non-blocking PNG serialization (toBlob).
 */
export async function createStudioSelectionFilterMaskTransactionAsync(input: Readonly<{
  target: StudioSelectionFilterMaskTarget;
  selection: PixelSelection | null;
  scope: StudioSelectionFilterMaskScope;
  imageWidth: number;
  imageHeight: number;
  filterPatch: Partial<ImageFilterFields>;
  createCanvas: SelectionCanvasFactory;
  serializeMask: StudioSelectionMaskAsyncSerializer;
  mutationLocked?: boolean;
}>): Promise<StudioSelectionFilterMaskTransactionResult> {
  if (input.target.type !== "image" || input.target.id.length === 0) {
    return failure("invalid-target", "선택 영역 필터는 이미지 레이어에만 적용할 수 있습니다.");
  }
  if (input.mutationLocked || input.target.locked) {
    return failure("locked-target", "이미지와 상위 그룹의 잠금을 해제한 뒤 다시 적용하세요.");
  }
  if (!isSelectionUsable(input.selection)) {
    return failure("empty-selection", "필터를 적용할 픽셀 영역을 먼저 선택하세요.");
  }
  if (
    !Number.isFinite(input.imageWidth)
    || !Number.isFinite(input.imageHeight)
    || input.imageWidth <= 0
    || input.imageHeight <= 0
  ) {
    return failure("invalid-image-size", "이미지 크기를 확인하지 못해 선택 마스크를 만들 수 없습니다.");
  }

  const basePlan = buildSelectionMaskPlan(
    input.selection,
    input.imageWidth,
    input.imageHeight,
    {
      featherScale:
        input.target.width > 0 ? input.imageWidth / input.target.width : 1,
      flipX: input.target.flipped,
      flipY: input.target.flippedY,
    },
  );
  if (!basePlan) {
    return failure("mask-raster-failed", "선택 영역 마스크 계획을 만들지 못했습니다.");
  }

  const maskPlan: SelectionMaskPlan = input.scope === "outside"
    ? { ...basePlan, invert: !basePlan.invert }
    : basePlan;
  const mask = rasterizeSelectionMask(maskPlan, input.createCanvas);
  if (!mask) {
    return failure("mask-raster-failed", "선택 영역 마스크를 만들지 못했습니다.");
  }

  let filterMaskSrc: string;
  try {
    filterMaskSrc = await input.serializeMask(mask);
  } catch {
    return failure("mask-serialization-failed", "선택 영역 마스크를 PNG로 저장하지 못했습니다.");
  }
  if (!filterMaskSrc.startsWith("data:image/png;base64,") || filterMaskSrc.length <= 22) {
    return failure("mask-serialization-failed", "선택 영역 마스크 PNG가 올바르지 않습니다.");
  }

  return {
    ok: true,
    transaction: {
      targetId: input.target.id,
      scope: input.scope,
      patch: {
        ...input.filterPatch,
        filterMaskSrc,
        filterMaskEnabled: true,
      },
      maskPlan,
      historyLabel: input.scope === "inside"
        ? "필터 · 선택 안에 적용"
        : "필터 · 선택 밖에 적용",
      historyEntryCount: 1,
    },
  };
}

/** Execute one document commit callback for one combined filter+mask history payload. */
export function commitStudioSelectionFilterMaskTransaction(
  transaction: StudioSelectionFilterMaskTransaction,
  commit: (transaction: StudioSelectionFilterMaskTransaction) => boolean,
): boolean {
  return commit(transaction);
}
