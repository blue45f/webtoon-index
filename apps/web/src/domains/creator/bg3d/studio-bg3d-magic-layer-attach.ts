/**
 * Renderer-neutral, atomic Magic Layer attachment for a planned 3D LT insertion.
 *
 * This module deliberately knows neither StudioPage nor Babylon. It validates an optional
 * full-frame object mask and attaches it only to a newly-created color image, falling back to a
 * newly-created tone image. Line rasters are never eligible.
 */

import {
  isStudioBg3dLtPngDataUrl,
  STUDIO_BG3D_LT_MAX_RASTER_EDGE,
} from "./studio-bg3d-lt-layer-plan";

import type {
  StudioBg3dLtLayerPlanSuccess,
  StudioBg3dLtPageElementLike,
} from "./studio-bg3d-lt-layer-plan";
import type {
  StudioBackground3DInsertResult,
  StudioBackground3DMagicFilterMask,
} from "../scene-3d/studio-3d-insert-contract";

const OBJECT_STABLE_ID_PATTERN = /^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_NODE_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const MAGIC_MASK_KEYS = Object.freeze([
  "height",
  "pngDataUrl",
  "selectedObjectStableId",
  "width",
] as const);
const MAGIC_MASK_KEY_SET = new Set<string>(MAGIC_MASK_KEYS);

export type StudioBg3dMagicLayerAttachErrorCode =
  | "invalid-render-dimensions"
  | "invalid-mask-shape"
  | "invalid-mask-dimensions"
  | "mismatched-mask-dimensions"
  | "invalid-mask-png-data-url"
  | "invalid-selected-object-stable-id"
  | "no-eligible-target";

export interface StudioBg3dMagicLayerAttachFailure {
  readonly ok: false;
  readonly code: StudioBg3dMagicLayerAttachErrorCode;
  readonly message: string;
}

export interface StudioBg3dMagicLayerAttachPassthrough<
  TElement extends StudioBg3dLtPageElementLike,
> {
  readonly ok: true;
  readonly applied: false;
  readonly targetElementId: null;
  /** Exact planner array when the optional sidecar is absent. */
  readonly nextElements: TElement[];
}

export interface StudioBg3dMagicLayerAttachApplied<
  TElement extends StudioBg3dLtPageElementLike,
> {
  readonly ok: true;
  readonly applied: true;
  readonly targetElementId: string;
  /** Same order as the planner output, with exactly one cloned image element. */
  readonly nextElements: TElement[];
}

export type StudioBg3dMagicLayerAttachResult<
  TElement extends StudioBg3dLtPageElementLike,
> =
  | StudioBg3dMagicLayerAttachFailure
  | StudioBg3dMagicLayerAttachPassthrough<TElement>
  | StudioBg3dMagicLayerAttachApplied<TElement>;

export interface AttachStudioBg3dMagicFilterMaskToLtPlanInput<
  TElement extends StudioBg3dLtPageElementLike,
> {
  readonly plan: StudioBg3dLtLayerPlanSuccess<TElement>;
  readonly insertResult: Pick<
    StudioBackground3DInsertResult,
    "width" | "height" | "magicFilterMask"
  >;
}

function failure(
  code: StudioBg3dMagicLayerAttachErrorCode,
  message: string,
): StudioBg3dMagicLayerAttachFailure {
  return { ok: false, code, message };
}

type UnknownRecord = Record<PropertyKey, unknown>;

function isPlainRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isValidRasterDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= STUDIO_BG3D_LT_MAX_RASTER_EDGE
  );
}

function hasExactMagicMaskKeys(value: UnknownRecord): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === MAGIC_MASK_KEYS.length &&
    keys.every((key) => typeof key === "string" && MAGIC_MASK_KEY_SET.has(key))
  );
}

function readOwnDataValue(value: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : null;
}

function validateMagicFilterMask(
  value: unknown,
  renderWidth: unknown,
  renderHeight: unknown,
): StudioBackground3DMagicFilterMask | StudioBg3dMagicLayerAttachFailure {
  if (!isValidRasterDimension(renderWidth) || !isValidRasterDimension(renderHeight)) {
    return failure(
      "invalid-render-dimensions",
      "Magic Layer를 적용할 3D LT 렌더 크기가 올바르지 않아요.",
    );
  }
  if (!isPlainRecord(value) || !hasExactMagicMaskKeys(value)) {
    return failure(
      "invalid-mask-shape",
      "Magic Layer 마스크 형식이 올바르지 않아요.",
    );
  }
  const width = readOwnDataValue(value, "width");
  const height = readOwnDataValue(value, "height");
  const pngDataUrl = readOwnDataValue(value, "pngDataUrl");
  const selectedObjectStableId = readOwnDataValue(value, "selectedObjectStableId");
  if (!isValidRasterDimension(width) || !isValidRasterDimension(height)) {
    return failure(
      "invalid-mask-dimensions",
      "Magic Layer 마스크 크기가 허용 범위를 벗어났어요.",
    );
  }
  if (width !== renderWidth || height !== renderHeight) {
    return failure(
      "mismatched-mask-dimensions",
      "Magic Layer 마스크와 3D LT 렌더 크기가 서로 달라요.",
    );
  }
  if (!isStudioBg3dLtPngDataUrl(pngDataUrl)) {
    return failure(
      "invalid-mask-png-data-url",
      "Magic Layer 마스크 PNG 데이터가 올바르지 않아요.",
    );
  }
  if (
    typeof selectedObjectStableId !== "string" ||
    !OBJECT_STABLE_ID_PATTERN.test(selectedObjectStableId) ||
    FORBIDDEN_NODE_ID_SET.has(
      selectedObjectStableId.slice("obj/".length).toLowerCase(),
    )
  ) {
    return failure(
      "invalid-selected-object-stable-id",
      "Magic Layer에서 선택한 3D 객체 식별자가 올바르지 않아요.",
    );
  }
  return {
    pngDataUrl,
    width,
    height,
    selectedObjectStableId,
  };
}

function isFailure(
  value: StudioBackground3DMagicFilterMask | StudioBg3dMagicLayerAttachFailure,
): value is StudioBg3dMagicLayerAttachFailure {
  return "ok" in value && value.ok === false;
}

/**
 * Attaches the optional Magic Layer sidecar to one newly-created LT image atomically.
 *
 * The function can be called unconditionally: a missing sidecar is a zero-copy passthrough.
 * Every failure is detected before an output array or element clone is created.
 */
export function attachStudioBg3dMagicFilterMaskToLtPlan<
  TElement extends StudioBg3dLtPageElementLike,
>(
  input: AttachStudioBg3dMagicFilterMaskToLtPlanInput<TElement>,
): StudioBg3dMagicLayerAttachResult<TElement> {
  const magicFilterMask = input.insertResult.magicFilterMask;
  if (magicFilterMask === undefined) {
    return {
      ok: true,
      applied: false,
      targetElementId: null,
      nextElements: input.plan.nextElements,
    };
  }

  const validatedMask = validateMagicFilterMask(
    magicFilterMask,
    input.insertResult.width,
    input.insertResult.height,
  );
  if (isFailure(validatedMask)) return validatedMask;

  const targetLayer = (["color", "tone"] as const)
    .map((role) => input.plan.layers.find((layer) => layer.role === role && layer.created))
    .find((layer) => layer !== undefined);
  if (!targetLayer) {
    return failure(
      "no-eligible-target",
      "Magic Layer 마스크를 적용할 새 컬러 또는 톤 이미지 레이어가 없어요.",
    );
  }

  const targetIndex = input.plan.nextElements.findIndex(
    (element) => element.id === targetLayer.elementId,
  );
  const target = input.plan.nextElements[targetIndex] as
    | (TElement & { readonly bg3dLtRole?: unknown })
    | undefined;
  if (
    targetIndex < 0 ||
    !target ||
    target.type !== "image" ||
    target.bg3dLtRole !== targetLayer.role
  ) {
    return failure(
      "no-eligible-target",
      "Magic Layer 마스크를 적용할 새 컬러 또는 톤 이미지 레이어가 올바르지 않아요.",
    );
  }

  const nextElements = [...input.plan.nextElements];
  nextElements[targetIndex] = {
    ...target,
    filterMaskSrc: validatedMask.pngDataUrl,
    filterMaskEnabled: true,
  };
  return {
    ok: true,
    applied: true,
    targetElementId: target.id,
    nextElements,
  };
}
