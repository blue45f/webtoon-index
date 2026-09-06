/**
 * Product-facing eligibility boundary for the first Semantic Layer Lift beta.
 *
 * The first slice deliberately accepts one plain, static ImageEl only. Placement transforms are
 * retained as document metadata and are not part of the source raster. Element-local image
 * filters are supported because the snapshot adapter can run the exact Studio filter pipeline.
 * Anything whose visible result depends on another layer, another raster, or a scene runtime
 * fails closed until the compositor has an explicit parity contract for it.
 */

import { hasActiveImageFilters } from "../render/studio-konva-filter-fields";

import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  type StudioSceneLayerLiftSourceMimeType,
} from "./studio-layer-lift-contract";
import { fingerprintStudioLayerLiftSource } from "./studio-layer-lift-plan";

import type { El, ImageEl } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";

const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const NORMAL_BLEND_MODES = new Set(["normal", "source-over"]);
const SOURCE_MIME_TYPES = new Set<StudioSceneLayerLiftSourceMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const STUDIO_LAYER_LIFT_UNAVAILABLE_CODES = Object.freeze([
  "selection-empty",
  "selection-multiple",
  "selection-missing",
  "selection-not-image",
  "document-duplicate-id",
  "source-invalid-id",
  "source-hidden",
  "source-locked",
  "source-grouped",
  "source-clipping-dependent",
  "source-mask-dependent",
  "source-animation",
  "source-3d",
  "source-opacity",
  "source-blend-mode",
  "source-layer-style",
  "source-invalid-placement",
  "source-raster-budget-exceeded",
  "source-unreadable",
  "source-format-unsupported",
  "source-unfingerprintable",
] as const);

export type StudioLayerLiftUnavailableCode =
  (typeof STUDIO_LAYER_LIFT_UNAVAILABLE_CODES)[number];

export type StudioLayerLiftSourceReadbackRequirement =
  | "inline"
  | "same-origin"
  | "cors-probe";

export interface StudioLayerLiftSourcePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly flipped: boolean;
  readonly flippedY: boolean;
  readonly skewX: number;
  readonly skewY: number;
}

/**
 * A render-only source can be supplied for a durable work-asset URI. The override must belong to
 * the selected element and is never written back to the authored document.
 */
export interface StudioLayerLiftReadableSourceOverride {
  readonly sourceId: string;
  readonly src: string;
  readonly mimeType: StudioSceneLayerLiftSourceMimeType;
}

export interface StudioLayerLiftAvailabilityInput {
  readonly elements: readonly El[];
  readonly groups: readonly LayerGroup[];
  readonly selectedIds: readonly string[];
  /**
   * `undefined` means use ImageEl.src. `null` means the caller tried to resolve a durable/external
   * source but no readable render projection is available.
   */
  readonly readableSource?: StudioLayerLiftReadableSourceOverride | null;
}

export interface StudioLayerLiftAvailabilitySuccess {
  readonly available: true;
  readonly sourceId: string;
  readonly sourceIndex: number;
  readonly sourceName: string;
  readonly sourceMimeType: StudioSceneLayerLiftSourceMimeType;
  readonly readableSource: string;
  readonly readbackRequirement: StudioLayerLiftSourceReadbackRequirement;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly pixelCount: number;
  readonly sourceFingerprint: string;
  readonly placement: StudioLayerLiftSourcePlacement;
  readonly filtersWillBeBaked: boolean;
}

export interface StudioLayerLiftAvailabilityFailure {
  readonly available: false;
  readonly code: StudioLayerLiftUnavailableCode;
  readonly message: string;
  readonly sourceId: string | null;
}

export type StudioLayerLiftAvailability =
  | StudioLayerLiftAvailabilitySuccess
  | StudioLayerLiftAvailabilityFailure;

type StudioLayerLiftImage = ImageEl & El;

function unavailable(
  code: StudioLayerLiftUnavailableCode,
  message: string,
  sourceId: string | null = null,
): StudioLayerLiftAvailabilityFailure {
  return Object.freeze({ available: false, code, message, sourceId });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBooleanOrUndefined(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isStaticImage(source: StudioLayerLiftImage): boolean {
  if (
    source.frames !== undefined
    || source.frameFps !== undefined
    || source.frameLoop !== undefined
    || source.activeFrameId !== undefined
    || source.isAnimatedGif === true
  ) {
    return false;
  }
  const normalizedSource = source.src.trim().toLowerCase();
  return (
    !normalizedSource.startsWith("data:image/gif")
    && !/\.gif(?:$|[?#])/u.test(normalizedSource)
  );
}

function hasLinked3dSource(source: StudioLayerLiftImage): boolean {
  return (
    source.bg3dScene !== undefined
    || source.vrmScene !== undefined
    || source.bg3dLtBundleId !== undefined
    || source.bg3dLtRole !== undefined
    || source.bg3dLtRenderMode !== undefined
  );
}

function hasMaskDependency(source: StudioLayerLiftImage): boolean {
  return (
    (typeof source.maskSrc === "string" && source.maskSrc.length > 0)
    || (
      typeof source.filterMaskSrc === "string"
      && source.filterMaskSrc.length > 0
    )
  );
}

function hasLayerStyle(source: StudioLayerLiftImage): boolean {
  return (
    (typeof source.shadowColor === "string" && source.shadowColor.length > 0)
    || (isFiniteNumber(source.cornerRadius) && source.cornerRadius !== 0)
  );
}

function placementFor(
  source: StudioLayerLiftImage,
): StudioLayerLiftSourcePlacement | null {
  if (
    !isFiniteNumber(source.x)
    || !isFiniteNumber(source.y)
    || !isFiniteNumber(source.width)
    || !isFiniteNumber(source.height)
    || source.width <= 0
    || source.height <= 0
    || !isFiniteNumber(source.rotation)
    || !isBooleanOrUndefined(source.flipped)
    || !isBooleanOrUndefined(source.flippedY)
    || (
      source.skewX !== undefined
      && !isFiniteNumber(source.skewX)
    )
    || (
      source.skewY !== undefined
      && !isFiniteNumber(source.skewY)
    )
  ) {
    return null;
  }
  return Object.freeze({
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    rotation: source.rotation,
    flipped: source.flipped === true,
    flippedY: source.flippedY === true,
    skewX: source.skewX ?? 0,
    skewY: source.skewY ?? 0,
  });
}

function dataUrlMimeType(
  source: string,
): StudioSceneLayerLiftSourceMimeType | null {
  const match = /^data:(image\/(?:png|jpeg|webp))(?:;[^,]*)?,/iu.exec(source);
  if (!match) return null;
  const mimeType = match[1]?.toLowerCase();
  return SOURCE_MIME_TYPES.has(mimeType as StudioSceneLayerLiftSourceMimeType)
    ? mimeType as StudioSceneLayerLiftSourceMimeType
    : null;
}

function pathMimeType(
  source: string,
): StudioSceneLayerLiftSourceMimeType | null {
  const withoutQuery = source.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  if (withoutQuery.endsWith(".png")) return "image/png";
  if (withoutQuery.endsWith(".jpg") || withoutQuery.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (withoutQuery.endsWith(".webp")) return "image/webp";
  return null;
}

function isHttpSource(source: string): boolean {
  return /^https?:\/\//iu.test(source);
}

function isSameOriginHttpSource(source: string): boolean {
  if (!isHttpSource(source)) return true;
  try {
    const currentOrigin = globalThis.location?.origin;
    return typeof currentOrigin === "string"
      && currentOrigin.length > 0
      && new URL(source).origin === currentOrigin;
  } catch {
    return false;
  }
}

function readbackRequirementFor(
  source: string,
): StudioLayerLiftSourceReadbackRequirement {
  if (source.startsWith("data:")) return "inline";
  if (
    source.startsWith("blob:")
    || source.startsWith("/")
    || source.startsWith("./")
    || source.startsWith("../")
    || isSameOriginHttpSource(source)
  ) {
    return "same-origin";
  }
  return "cors-probe";
}

function sourceNameFor(
  source: StudioLayerLiftImage,
  mimeType: StudioSceneLayerLiftSourceMimeType,
): string {
  const authored = typeof source.name === "string"
    ? source.name.trim()
    : "";
  const hasControlCharacter = [...authored].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    authored.length > 0
    && authored.length
      <= STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumSourceCharacters
    && !hasControlCharacter
  ) {
    return authored;
  }
  const extension =
    mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return `${source.id}.${extension}`;
}

function readableSourceFor(
  input: StudioLayerLiftAvailabilityInput,
  source: StudioLayerLiftImage,
): Readonly<{
  src: string;
  mimeType: StudioSceneLayerLiftSourceMimeType;
}> | null {
  if (input.readableSource === null) return null;
  if (input.readableSource !== undefined) {
    const override = input.readableSource;
    if (
      override.sourceId !== source.id
      || typeof override.src !== "string"
      || override.src.trim().length === 0
      || !SOURCE_MIME_TYPES.has(override.mimeType)
    ) {
      return null;
    }
    return Object.freeze({
      src: override.src,
      mimeType: override.mimeType,
    });
  }

  if (typeof source.src !== "string" || source.src.trim().length === 0) {
    return null;
  }
  const src = source.src;
  const mimeType = dataUrlMimeType(src) ?? pathMimeType(src);
  if (!mimeType) return null;
  return Object.freeze({ src, mimeType });
}

/**
 * Returns one stable disabled reason or an immutable launch description. This function does not
 * decode pixels; external CORS/readback is therefore marked as a probe requirement and is
 * reclassified to a concrete snapshot error by the async adapter.
 */
export function inspectStudioLayerLiftAvailability(
  input: StudioLayerLiftAvailabilityInput,
): StudioLayerLiftAvailability {
  if (input.selectedIds.length === 0) {
    return unavailable(
      "selection-empty",
      "레이어로 분리할 이미지 하나를 선택해 주세요.",
    );
  }
  if (input.selectedIds.length !== 1) {
    return unavailable(
      "selection-multiple",
      "첫 베타에서는 이미지 레이어 하나만 분리할 수 있습니다.",
    );
  }

  const selectedId = input.selectedIds[0]!;
  const matchingIndexes = input.elements.flatMap((element, index) =>
    element.id === selectedId ? [index] : []);
  if (matchingIndexes.length === 0) {
    return unavailable(
      "selection-missing",
      "선택한 레이어를 현재 페이지에서 찾을 수 없습니다.",
      selectedId,
    );
  }
  if (matchingIndexes.length > 1) {
    return unavailable(
      "document-duplicate-id",
      "같은 ID의 레이어가 둘 이상 있어 안전하게 원본을 고를 수 없습니다.",
      selectedId,
    );
  }

  const sourceIndex = matchingIndexes[0]!;
  const candidate = input.elements[sourceIndex]!;
  if (candidate.type !== "image") {
    return unavailable(
      "selection-not-image",
      "첫 베타에서는 정적 이미지 레이어만 분리할 수 있습니다.",
      selectedId,
    );
  }
  const source = candidate as StudioLayerLiftImage;
  if (
    source.id.length
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters
    || !SOURCE_ID_PATTERN.test(source.id)
  ) {
    return unavailable(
      "source-invalid-id",
      "선택 이미지의 ID가 의미 레이어 분리 계약에 맞지 않습니다.",
      source.id,
    );
  }
  if (source.hidden === true) {
    return unavailable(
      "source-hidden",
      "숨긴 이미지 레이어는 표시한 뒤 분리해 주세요.",
      source.id,
    );
  }
  if (source.locked === true) {
    return unavailable(
      "source-locked",
      "잠긴 이미지 레이어는 잠금을 해제한 뒤 분리해 주세요.",
      source.id,
    );
  }
  if (source.groupId !== undefined) {
    return unavailable(
      "source-grouped",
      "그룹에 속한 이미지는 그룹에서 꺼낸 뒤 분리해 주세요.",
      source.id,
    );
  }
  const frontNeighbor = input.elements[sourceIndex + 1];
  if (source.clipBelow === true || frontNeighbor?.clipBelow === true) {
    return unavailable(
      "source-clipping-dependent",
      "클리핑 관계가 있는 이미지는 먼저 평탄화한 뒤 분리해 주세요.",
      source.id,
    );
  }
  if (hasMaskDependency(source)) {
    return unavailable(
      "source-mask-dependent",
      "레이어·필터 마스크가 있는 이미지는 마스크 외형 일치 지원 후 분리할 수 있습니다.",
      source.id,
    );
  }
  if (!isStaticImage(source)) {
    return unavailable(
      "source-animation",
      "애니메이션 이미지와 GIF는 현재 한 장의 의미 레이어로 분리할 수 없습니다.",
      source.id,
    );
  }
  if (hasLinked3dSource(source)) {
    return unavailable(
      "source-3d",
      "재편집 가능한 3D·VRM 장면 이미지는 먼저 래스터 복사본을 만들어 주세요.",
      source.id,
    );
  }
  if (
    source.opacity !== undefined
    && (!isFiniteNumber(source.opacity) || source.opacity !== 1)
  ) {
    return unavailable(
      "source-opacity",
      "레이어 불투명도가 100%인 이미지부터 분리할 수 있습니다.",
      source.id,
    );
  }
  if (
    source.blendMode !== undefined
    && !NORMAL_BLEND_MODES.has(source.blendMode)
  ) {
    return unavailable(
      "source-blend-mode",
      "혼합 모드가 보통인 이미지부터 분리할 수 있습니다.",
      source.id,
    );
  }
  if (hasLayerStyle(source)) {
    return unavailable(
      "source-layer-style",
      "그림자·둥근 모서리 레이어 스타일은 먼저 평탄화한 뒤 분리해 주세요.",
      source.id,
    );
  }

  const placement = placementFor(source);
  if (!placement) {
    return unavailable(
      "source-invalid-placement",
      "이미지의 위치·크기·회전·반전·기울기 값이 올바르지 않습니다.",
      source.id,
    );
  }
  const rasterWidth = Math.max(1, Math.round(placement.width));
  const rasterHeight = Math.max(1, Math.round(placement.height));
  const pixelCount = rasterWidth * rasterHeight;
  if (
    !Number.isSafeInteger(pixelCount)
    || rasterWidth > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels
    || rasterHeight > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels
    || pixelCount > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels
  ) {
    return unavailable(
      "source-raster-budget-exceeded",
      "선택 이미지의 표시 해상도가 의미 레이어 분리 안전 한도를 넘습니다.",
      source.id,
    );
  }

  const readable = readableSourceFor(input, source);
  if (!readable) {
    const hasKnownUnsupportedFormat =
      typeof source.src === "string"
      && source.src.trim().length > 0
      && (
        source.src.startsWith("data:image/")
        || /\.(?:gif|svg|avif|bmp|tiff?)(?:$|[?#])/iu.test(source.src)
      );
    return unavailable(
      hasKnownUnsupportedFormat
        ? "source-format-unsupported"
        : "source-unreadable",
      hasKnownUnsupportedFormat
        ? "PNG·JPEG·WebP 정적 이미지부터 의미 레이어로 분리할 수 있습니다."
        : "선택 이미지의 읽을 수 있는 원본을 아직 준비하지 못했습니다.",
      source.id,
    );
  }

  const sourceFingerprint = fingerprintStudioLayerLiftSource({
    elements: input.elements,
    groups: input.groups,
    sourceId: source.id,
  });
  if (sourceFingerprint === null) {
    return unavailable(
      "source-unfingerprintable",
      "현재 이미지 상태를 안전하게 고정할 수 없어 분리를 시작하지 않았습니다.",
      source.id,
    );
  }

  return Object.freeze({
    available: true,
    sourceId: source.id,
    sourceIndex,
    sourceName: sourceNameFor(source, readable.mimeType),
    sourceMimeType: readable.mimeType,
    readableSource: readable.src,
    readbackRequirement: readbackRequirementFor(readable.src),
    rasterWidth,
    rasterHeight,
    pixelCount,
    sourceFingerprint,
    placement,
    filtersWillBeBaked: hasActiveImageFilters(source),
  });
}
