/**
 * Product render boundary for the deterministic wet-ink field.
 *
 * This module deliberately sits between immutable DrawEl snapshots and Canvas/Konva. Planning is
 * renderer-neutral and performs the complete fixed-clock deposition/simulation/upload pass before
 * a destination is touched. Rendering then prepares every tile off-destination, rechecks
 * visibility/abort/revision authority, and applies the element opacity exactly once.
 *
 * Only explicitly versioned, causal `watercolor` and `ink-wash` snapshots opt in. Legacy
 * watercolor, gouache, erasers, shapes, malformed imports and every budget failure are declared
 * ineligible before rendering so StudioDrawNode can select its compatibility renderer up front.
 */

import { parseStudioGpuColor } from "../render/studio-webgpu-color";

import {
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasWatercolorPlanSettings,
} from "./studio-brush-alias-profile";
import {
  depositStudioInkwashFluidStroke,
  stepStudioInkwashFluid,
  studioInkwashFluidDigest,
  studioInkwashActiveRegionSteps,
  studioInkwashFluidStepParams,
  type StudioInkwashFluidSession,
} from "./studio-inkwash-fluid";
import {
  isStudioInkwashFluidBrush,
  type StudioInkwashFluidBrushId,
} from "./studio-inkwash-fluid-brushes";
import {
  commitStudioInkwashWash,
  ensureStudioInkwashWash,
  getStudioInkwashWash,
  markStudioInkwashWashDeposited,
  resetStudioInkwashWash,
  studioInkwashDocumentToField,
  studioInkwashWashDigest,
  studioInkwashWashDisplay,
  studioInkwashWashNeedsDeposit,
  studioInkwashStrokeSignature,
  studioInkwashWashAppliedEntries,
  studioInkwashWashVisualOwnerId,
  upsertStudioInkwashWashStroke,
} from "./studio-inkwash-wash";
import { watercolorBrushSeedFromKey } from "./studio-watercolor-brush";
import {
  createStudioWetInkField,
  depositStudioWetInkStroke,
  planStudioWetInkTileUploads,
  simulateStudioWetInkField,
  studioWetInkFieldDigest,
  type StudioWetInkTileUpload,
} from "./studio-wet-ink-field";

import type { DrawEl, El } from "../studio-element-model";
import type { StudioLivingInkFluidReferenceRegion } from "../studio-living-ink-fluid-reference";

export const STUDIO_WET_INK_BRUSH_RUNTIME_VERSION =
  "wet-ink-brush-runtime-v1" as const;
export const STUDIO_WET_INK_BRUSH_FIELD_SCALE = 4;
export const STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ = 240;
export const STUDIO_WET_INK_BRUSH_SIMULATION_STEPS = 16;
export const STUDIO_WET_INK_BRUSH_SURFACE_BYTE_BUDGET = 64 * 1024 * 1024;

const STUDIO_WET_INK_BRUSH_MAX_PHYSICAL_SCALE =
  STUDIO_WET_INK_BRUSH_FIELD_SCALE;
const STUDIO_WET_INK_BRUSH_MAX_DABS = 4_096;
const STUDIO_WET_INK_BRUSH_MAX_TILES = 4_096;
const STUDIO_WET_INK_BRUSH_MAX_CELLS = 4_194_304;
const STUDIO_WET_INK_BRUSH_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const STUDIO_WET_INK_BRUSH_MAX_COORDINATE_ABS = 1_000_000;
const STUDIO_WET_INK_BRUSH_MAX_POINT_COUNT = 65_536;
const REVISION_HASH_OFFSET = 0x811c9dc5;
const REVISION_HASH_PRIME = 0x01000193;

export type StudioWetInkBrushId =
  | "watercolor"
  | "ink-wash"
  | "inkwash-pen"
  | "inkwash-water-brush"
  | "inkwash-bleed-wash"
  | "inkwash-white-ink";
export type StudioWetInkBrushReplayPhase = "live" | "committed";

export interface StudioWetInkBrushReplayOptions {
  /**
   * Live vs committed. Watercolor/ink-wash keep byte-identical physics across phases.
   * InkWash pen/water use committed as the dry-commit (fix/settle) of the shared wash.
   */
  readonly phase: StudioWetInkBrushReplayPhase;
}

export type StudioWetInkBrushPlanUnavailableReason =
  | "unsupported-snapshot"
  | "invalid-geometry"
  | "invalid-style"
  | "invalid-color"
  | "field-budget"
  | "deposition-budget"
  | "simulation-budget"
  | "upload-budget";

export interface StudioWetInkBrushReplayPlan {
  readonly runtimeVersion: typeof STUDIO_WET_INK_BRUSH_RUNTIME_VERSION;
  readonly phase: StudioWetInkBrushReplayPhase;
  readonly brushId: StudioWetInkBrushId;
  readonly strokeId: string;
  readonly revision: number;
  readonly seed: number;
  readonly fieldDigest: string;
  /** Fixed physical field samples per document pixel. */
  readonly fieldScale: typeof STUDIO_WET_INK_BRUSH_FIELD_SCALE;
  /** Document-space origin corresponding to field coordinate (0, 0). */
  readonly originX: number;
  readonly originY: number;
  /** Element opacity × embedded CSS color alpha; neither is baked into tile alpha. */
  readonly compositeOpacity: number;
  readonly uploads: readonly StudioWetInkTileUpload[];
  readonly allocatedCells: number;
  readonly simulationSteps: number;
}

export interface StudioInkwashAbsorptionSpectrum {
  readonly name: string;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const STUDIO_INKWASH_SPECTRA_PRESETS: Readonly<Record<string, StudioInkwashAbsorptionSpectrum>> = Object.freeze({
  "sumi-black": { name: "수묵 먹빛 (Sumi Black)", r: 1.0, g: 0.96, b: 0.88 },
  "indigo-wash": { name: "인디고 수채 (Indigo Wash)", r: 0.2, g: 0.6, b: 1.0 },
  "sepia-ink": { name: "세피아 잉크 (Sepia Ink)", r: 0.9, g: 0.6, b: 0.3 },
  "vermilion-red": { name: "주홍 연지 (Vermilion Red)", r: 1.0, g: 0.25, b: 0.15 },
  "cobalt-blue": { name: "코발트 블루 (Cobalt Blue)", r: 0.1, g: 0.45, b: 0.95 },
  "forest-green": { name: "녹송 수묵 (Forest Green)", r: 0.2, g: 0.75, b: 0.35 },
  "plum-blossom": { name: "매화 자홍 (Plum Blossom Ink)", r: 0.85, g: 0.2, b: 0.55 },
  "pine-smoke": { name: "송묵 연묵 (Pine Smoke Ink)", r: 0.98, g: 0.95, b: 0.90 },
  "bamboo-green": { name: "청죽 먹빛 (Bamboo Ink)", r: 0.25, g: 0.72, b: 0.45 },
  "autumn-gold": { name: "추황 묵빛 (Autumn Gold Ink)", r: 0.88, g: 0.65, b: 0.18 },
  "mineral-azurite": { name: "석청 藍 (Mineral Azurite)", r: 0.15, g: 0.38, b: 0.88 },
  "white-highlight": { name: "화이트 하이라이트 (White Ink)", r: -1.0, g: -1.0, b: -1.0 },
});

export interface StudioWetInkBrushPhysicalMaterial {
  readonly absorption: number;
  readonly bleed: number;
  readonly chromatography?: number;
  readonly dryingRate: number;
  readonly edgeDarkening: number;
  readonly fixationRate: number;
  readonly granulation: number;
  readonly hardness: number;
  readonly paperRoughness: number;
  readonly pigmentLoad: number;
  readonly waterLoad: number;
  readonly wetnessLoad: number;
  readonly spectralAbsorption?: StudioInkwashAbsorptionSpectrum;
}

/**
 * Immutable physical recipe shared by the append-only live overlay and committed replay. Point
 * geometry is intentionally absent: a live owner can consume only the unseen suffix without
 * changing seed, material, opacity or the authoritative 4x field contract.
 */
export interface StudioWetInkBrushPhysicalRecipe {
  readonly runtimeVersion: typeof STUDIO_WET_INK_BRUSH_RUNTIME_VERSION;
  readonly brushId: StudioWetInkBrushId;
  readonly strokeId: string;
  readonly seed: number;
  readonly fieldScale: typeof STUDIO_WET_INK_BRUSH_FIELD_SCALE;
  readonly baseWidth: number;
  readonly spacing: number;
  readonly compositeOpacity: number;
  readonly inkColor: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
  };
  readonly material: StudioWetInkBrushPhysicalMaterial;
}

export type StudioWetInkBrushReplayPlanResult =
  | {
      readonly ok: true;
      readonly value: StudioWetInkBrushReplayPlan;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWetInkBrushPlanUnavailableReason;
      readonly detail: string;
    };

export interface StudioWetInkBrushDestinationContext {
  globalAlpha: number;
  save(): void;
  restore(): void;
  drawImage(
    image: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void;
  /** Konva wraps its native Canvas context here. */
  _context?: Pick<CanvasRenderingContext2D, "getTransform">;
  getTransform?: () => DOMMatrix;
}

export interface StudioWetInkBrushSurfaceContext {
  createImageData(width: number, height: number): ImageData;
  putImageData(imageData: ImageData, destinationX: number, destinationY: number): void;
}

export type StudioWetInkBrushSurface = CanvasImageSource & {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): StudioWetInkBrushSurfaceContext | null;
};

export type StudioWetInkBrushSurfaceFactory = (
  width: number,
  height: number,
) => StudioWetInkBrushSurface | null;

export interface StudioWetInkBrushRenderOptions {
  readonly surfaceFactory?: StudioWetInkBrushSurfaceFactory;
  readonly maximumSurfaceBytes?: number;
  readonly signal?: Pick<AbortSignal, "aborted"> | null;
  readonly hidden?: boolean | (() => boolean);
  /**
   * An async/live owner can retain the plan revision and expose its current revision. Both are
   * checked before allocation and again immediately before the first destination draw.
   */
  readonly expectedRevision?: number;
  readonly currentRevision?: number | (() => number);
}

export type StudioWetInkBrushRenderResult =
  | {
      readonly status: "rendered";
      readonly fieldDigest: string;
      readonly nativeScale: number;
      readonly tileCount: number;
      readonly surfaceBytes: number;
    }
  | {
      readonly status: "empty";
      readonly fieldDigest: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: "hidden" | "aborted" | "stale-revision";
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "native-scale-unsupported"
        | "surface-budget"
        | "surface-unavailable"
        | "surface-preparation-failed";
    }
  | {
      readonly status: "partial";
      readonly reason: "destination-composite-failed";
    };

interface WetInkGeometry {
  readonly originCellX: number;
  readonly originCellY: number;
  readonly width: number;
  readonly height: number;
  readonly samples: readonly {
    readonly x: number;
    readonly y: number;
    readonly pressure: number;
    readonly timeMs: number;
  }[];
}

interface PreparedUpload {
  readonly upload: StudioWetInkTileUpload;
  readonly surface: StudioWetInkBrushSurface;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= STUDIO_WET_INK_BRUSH_MAX_COORDINATE_ABS;
}

function exactWetInkBrushId(value: unknown): StudioWetInkBrushId | null {
  return value === "watercolor"
    || value === "ink-wash"
    || value === "inkwash-pen"
    || value === "inkwash-water-brush"
    || value === "inkwash-bleed-wash"
    || value === "inkwash-white-ink"
    ? (value as StudioWetInkBrushId)
    : null;
}

/**
 * Public rollout gate. A family match is insufficient: legacy documents and aliases remain on
 * their exact historical renderer unless the stored causal watercolor pipeline explicitly opts in.
 */
export function studioWetInkBrushRuntimeSupportsElement(
  element: DrawEl,
): boolean {
  return element.type === "draw"
    && (element.kind ?? "freehand") === "freehand"
    && element.mode !== "eraser"
    && exactWetInkBrushId(element.brush) !== null
    && element.watercolorPipeline === "causal-walker-v2";
}

function planFailure(
  reason: StudioWetInkBrushPlanUnavailableReason,
  detail: string,
): StudioWetInkBrushReplayPlanResult {
  return { ok: false, reason, detail };
}

function hashRevisionNumber(hash: number, value: number): number {
  if (!Number.isFinite(value)) return Math.imul(hash ^ 0xff, REVISION_HASH_PRIME) >>> 0;
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  let next = hash;
  for (const byte of bytes) next = Math.imul(next ^ byte, REVISION_HASH_PRIME) >>> 0;
  return next;
}

function hashRevisionText(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    next = Math.imul(next ^ (code & 0xff), REVISION_HASH_PRIME) >>> 0;
    next = Math.imul(next ^ (code >>> 8), REVISION_HASH_PRIME) >>> 0;
  }
  return next;
}

function snapshotRevision(element: DrawEl): number {
  let hash = REVISION_HASH_OFFSET;
  hash = hashRevisionText(hash, STUDIO_WET_INK_BRUSH_RUNTIME_VERSION);
  hash = hashRevisionText(hash, element.id);
  hash = hashRevisionText(hash, element.brush ?? "");
  hash = hashRevisionText(hash, element.stroke);
  hash = hashRevisionNumber(hash, element.strokeWidth);
  for (const value of element.points) hash = hashRevisionNumber(hash, value);
  for (const value of element.pressures ?? []) hash = hashRevisionNumber(hash, value);
  return hash >>> 0;
}

function wetInkGeometry(
  element: DrawEl,
  baseWidth: number,
  pressures: readonly number[],
): WetInkGeometry | null {
  if (
    !Array.isArray(element.points)
    || element.points.length < 2
    || element.points.length % 2 !== 0
  ) return null;
  const pointCount = element.points.length / 2;
  if (
    !Number.isSafeInteger(pointCount)
    || pointCount < 1
    || pointCount > STUDIO_WET_INK_BRUSH_MAX_POINT_COUNT
  ) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const x = element.points[index * 2];
    const y = element.points[index * 2 + 1];
    if (!finiteCoordinate(x) || !finiteCoordinate(y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const scale = STUDIO_WET_INK_BRUSH_FIELD_SCALE;
  const radiusCells = Math.ceil(baseWidth * scale * 0.72);
  const marginCells = Math.max(
    scale * 2,
    radiusCells + STUDIO_WET_INK_BRUSH_SIMULATION_STEPS + 2,
  );
  const originCellX = Math.floor(minX * scale) - marginCells;
  const originCellY = Math.floor(minY * scale) - marginCells;
  const maximumCellX = Math.ceil(maxX * scale) + marginCells;
  const maximumCellY = Math.ceil(maxY * scale) + marginCells;
  const width = maximumCellX - originCellX + 1;
  const height = maximumCellY - originCellY + 1;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > STUDIO_WET_INK_BRUSH_MAX_COORDINATE_ABS
    || height > STUDIO_WET_INK_BRUSH_MAX_COORDINATE_ABS
    || !Number.isSafeInteger(width * height)
  ) return null;

  const interval = 1_000 / STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ;
  const samples = Array.from({ length: pointCount }, (_, index) => ({
    x: element.points[index * 2]! * scale - originCellX,
    y: element.points[index * 2 + 1]! * scale - originCellY,
    pressure: clamp01(pressures[index] ?? 0.55),
    timeMs: index * interval,
  }));
  return { originCellX, originCellY, width, height, samples };
}

function fieldMaterial(
  brushId: StudioWetInkBrushId,
): StudioWetInkBrushPhysicalMaterial {
  if (brushId === "inkwash-water-brush") {
    return {
      absorption: 0.005,
      bleed: 0.58,
      chromatography: 0.5,
      dryingRate: 0.022,
      edgeDarkening: 0.42,
      fixationRate: 0.04,
      granulation: 0.55,
      hardness: 0.2,
      paperRoughness: 0.62,
      pigmentLoad: 0,
      waterLoad: 1.55,
      wetnessLoad: 1,
      spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["indigo-wash"],
    };
  }
  if (brushId === "inkwash-bleed-wash") {
    return {
      absorption: 0.032,
      bleed: 0.62,
      chromatography: 0.72,
      dryingRate: 0.028,
      edgeDarkening: 0.92,
      fixationRate: 0.12,
      granulation: 0.82,
      hardness: 0.38,
      paperRoughness: 0.86,
      pigmentLoad: 1.28,
      waterLoad: 1.25,
      wetnessLoad: 1,
      spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["sumi-black"],
    };
  }
  if (brushId === "inkwash-pen") {
    return {
      absorption: 0.04,
      bleed: 0.28,
      chromatography: 0.5,
      dryingRate: 0.05,
      edgeDarkening: 0.88,
      fixationRate: 0.25,
      granulation: 0.38,
      hardness: 0.75,
      paperRoughness: 0.58,
      pigmentLoad: 1.45,
      waterLoad: 0.32,
      wetnessLoad: 0.16,
      spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["sumi-black"],
    };
  }
  if (brushId === "inkwash-white-ink") {
    return {
      absorption: 0.015,
      bleed: 0.3,
      chromatography: 0.2,
      dryingRate: 0.04,
      edgeDarkening: 0.4,
      fixationRate: 0.2,
      granulation: 0.34,
      hardness: 0.5,
      paperRoughness: 0.55,
      pigmentLoad: 1.22,
      waterLoad: 0.62,
      wetnessLoad: 0.66,
      spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["white-highlight"],
    };
  }
  if (brushId === "ink-wash") {
    return {
      // Competitive sumi: stronger wet-edge ring, denser core pigment, and tooth-aware granulation
      // that stays materially distinct from soft watercolor (lower bleed, flatter edge).
      absorption: 0.034,
      bleed: 0.46,
      chromatography: 0.72,
      dryingRate: 0.038,
      edgeDarkening: 0.82,
      fixationRate: 0.132,
      granulation: 0.74,
      hardness: 0.52,
      paperRoughness: 0.8,
      pigmentLoad: 1.34,
      waterLoad: 0.86,
      wetnessLoad: 0.94,
      spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["sumi-black"],
    };
  }
  return {
    absorption: 0.021,
    bleed: 0.36,
    chromatography: 0.5,
    dryingRate: 0.034,
    edgeDarkening: 0.58,
    fixationRate: 0.112,
    granulation: 0.52,
    hardness: 0.3,
    paperRoughness: 0.62,
    pigmentLoad: 0.78,
    waterLoad: 1.02,
    wetnessLoad: 1.0,
    spectralAbsorption: STUDIO_INKWASH_SPECTRA_PRESETS["indigo-wash"],
  };
}

/**
 * 이 도구가 안료를 얹는가.
 *
 * 물붓은 색소를 올리지 않고 공유 워시의 **미정착 잉크를 움직이기만** 한다 — 제품 설명("먹선을
 * 문지르면 번지고 소용돌이치며 마른 자국이 남음")과 유닛 계약(studio-ink-wash-feel: "keeps water
 * from depositing ink")이 같은 말을 한다. 빈 종이에서 아무 픽셀도 남기지 않는 것이 정상이므로,
 * "획을 그으면 픽셀이 생겨야 한다"는 게이트는 이 도구를 예외로 두어야 한다.
 */
export function studioWetInkBrushDepositsPigment(brushId: unknown): boolean {
  const exact = exactWetInkBrushId(brushId);
  return exact === null ? true : fieldMaterial(exact).pigmentLoad > 0;
}

export function isStudioInkwashFluidElement(element: DrawEl): boolean {
  return studioWetInkBrushRuntimeSupportsElement(element)
    && isStudioInkwashFluidBrush(element.brush);
}

/**
 * 문서에 한 번이라도 존재했던 수묵 획 id. 오버레이가 pointer-up 에서 정착시킨 획은 지연 커밋이 끝날
 * 때까지 문서에 없으므로, "본 적 없는 id" 는 아직 오지 않은 획이지 지워진 획이 아니다.
 */
let documentSeenInkwashIds: ReadonlySet<string> = new Set();

function isDrawElement(element: El): element is DrawEl {
  return element.type === "draw";
}

/**
 * 공유 워시를 페이지의 수묵 획 집합과 대조한다.
 *
 * 워시는 침착만 알고 삭제를 모른다. Undo·삭제·이동·페이지 전환으로 문서에서 사라지거나 형태가
 * 바뀐 획의 안료가 필드에 그대로 남고, 다음 수묵 획(특히 안료 없는 물붓)이 워시 전체를 표시하는
 * 순간 그 유령이 되살아났다 — 실측: inkwash-pen 획 → Undo → 같은 경로에 물붓 = 지운 획이 다시
 * 보임. 유체 상태는 경로 의존이라 한 획만 빼낼 수 없으므로, 문서에 남은 획을 문서 순서대로 다시
 * 침착해 워시를 재구성한다. 성장(획 추가)만 있는 갱신은 재구성하지 않는다.
 *
 * @returns 워시를 재구성했으면 true.
 */
export function reconcileStudioInkwashWashWithDocument(
  elements: readonly El[],
): boolean {
  const current: DrawEl[] = [];
  for (const element of elements) {
    if (isDrawElement(element) && isStudioInkwashFluidElement(element)) current.push(element);
  }
  const currentById = new Map(current.map((element) => [element.id, element] as const));
  const applied = studioInkwashWashAppliedEntries();
  let stale = false;
  for (const [id, signature] of applied) {
    const element = currentById.get(id);
    if (element) {
      if (studioInkwashStrokeSignature(element) !== signature) {
        stale = true;
        break;
      }
    } else if (documentSeenInkwashIds.has(id)) {
      stale = true;
      break;
    }
  }
  if (!stale) {
    const seen = new Set(currentById.keys());
    for (const [id] of applied) {
      if (documentSeenInkwashIds.has(id)) seen.add(id);
    }
    documentSeenInkwashIds = seen;
    return false;
  }
  resetStudioInkwashWash();
  documentSeenInkwashIds = new Set(currentById.keys());
  for (const element of current) {
    planStudioWetInkBrushReplay(element, { phase: "committed" });
  }
  return true;
}

export function depositStudioInkwashWashElement(
  session: StudioInkwashFluidSession,
  element: DrawEl,
): boolean {
  const recipe = resolveStudioWetInkBrushPhysicalRecipe(element);
  if (!recipe || !isStudioInkwashFluidBrush(recipe.brushId)) return false;
  const pointCount = Math.floor(element.points.length / 2);
  if (pointCount < 1) return false;
  const pressures = mapStudioBrushAliasPressureSamples(
    recipe.brushId,
    element.pressures,
    pointCount,
    0.55,
  );
  const samples = Array.from({ length: pointCount }, (_, index) => ({
    x: element.points[index * 2]!,
    y: element.points[index * 2 + 1]!,
    pressure: clamp01(pressures[index] ?? 0.55),
    timeMs: index * (1_000 / STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ),
  }));
  depositStudioInkwashFluidStroke(session, {
    tool: recipe.brushId === "inkwash-water-brush" ? "water" : "pen",
    samples,
    radius: recipe.baseWidth * 0.5,
    pigmentLoad: recipe.material.pigmentLoad,
    wetnessLoad: recipe.material.wetnessLoad,
    spectralAbsorption: recipe.material.spectralAbsorption,
    inkColor: recipe.inkColor,
  });
  return true;
}

export {
  createStudioInkwashFluidSession,
  depositStudioInkwashFluidStamp,
  fixStudioInkwashFluid,
  readStudioInkwashFluidCell,
  stepStudioInkwashFluid,
} from "./studio-inkwash-fluid";
export {
  commitStudioInkwashWash,
  getStudioInkwashWash,
  readStudioInkwashWashDocumentCell,
  resetStudioInkwashWash,
  STUDIO_INKWASH_WASH_KEY,
} from "./studio-inkwash-wash";

export type { StudioInkwashFluidSession } from "./studio-inkwash-fluid";
export type { StudioInkwashFluidBrushId };

export function resolveStudioWetInkBrushPhysicalRecipe(
  element: DrawEl,
): StudioWetInkBrushPhysicalRecipe | null {
  if (
    !studioWetInkBrushRuntimeSupportsElement(element)
    || typeof element.id !== "string"
    || element.id.length === 0
    || !Number.isFinite(element.strokeWidth)
    || element.strokeWidth <= 0
    || !Number.isFinite(element.opacity ?? 1)
  ) {
    return null;
  }
  const brushId = exactWetInkBrushId(element.brush);
  const parsedColor = parseStudioGpuColor(element.stroke);
  const aliasSettings = resolveStudioBrushAliasWatercolorPlanSettings(
    brushId,
    element.strokeWidth,
  );
  if (!brushId || !parsedColor || !aliasSettings) return null;
  return {
    runtimeVersion: STUDIO_WET_INK_BRUSH_RUNTIME_VERSION,
    brushId,
    strokeId: element.id,
    seed: watercolorBrushSeedFromKey(
      `${element.id}:${STUDIO_WET_INK_BRUSH_RUNTIME_VERSION}`,
    ),
    fieldScale: STUDIO_WET_INK_BRUSH_FIELD_SCALE,
    baseWidth: aliasSettings.baseWidth,
    spacing: aliasSettings.spacing,
    compositeOpacity: clamp01(element.opacity ?? 1) * clamp01(parsedColor[3]),
    inkColor: {
      r: Math.round(parsedColor[0] * 255),
      g: Math.round(parsedColor[1] * 255),
      b: Math.round(parsedColor[2] * 255),
    },
    material: fieldMaterial(brushId),
  };
}

/** Skip CPU Stam on huge fields — a 2048² × 16-step tick on every Konva render froze the tab. */
const INKWASH_CPU_STAM_CELL_CAP = 512 * 512;
const INKWASH_CPU_STAM_STEPS = 4;

/** 이 획의 파인 셀 bbox 를 공유 워시 좌표로 옮긴다(여백은 geometry 가 이미 반경+스텝만큼 넣었다). */
function inkwashStrokeActiveRegion(
  wash: NonNullable<ReturnType<typeof getStudioInkwashWash>>,
  geometry: WetInkGeometry,
): StudioLivingInkFluidReferenceRegion {
  const origin = studioInkwashDocumentToField(
    wash,
    geometry.originCellX / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
    geometry.originCellY / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
  );
  const x0 = Math.floor(origin.x);
  const y0 = Math.floor(origin.y);
  return { x0, y0, x1: x0 + geometry.width, y1: y0 + geometry.height };
}

function applyInkwashElementToWash(
  element: DrawEl,
  recipe: StudioWetInkBrushPhysicalRecipe,
  geometry: WetInkGeometry,
  phase: StudioWetInkBrushReplayPhase,
): ReturnType<typeof getStudioInkwashWash> {
  const wash = ensureStudioInkwashWash({
    originX: geometry.originCellX / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
    originY: geometry.originCellY / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
    width: geometry.width,
    height: geometry.height,
    fieldScale: STUDIO_WET_INK_BRUSH_FIELD_SCALE,
  });
  upsertStudioInkwashWashStroke(element);
  if (studioInkwashWashNeedsDeposit(element)) {
    const samples = geometry.samples.map((sample) => {
      const documentX = (sample.x + geometry.originCellX) / STUDIO_WET_INK_BRUSH_FIELD_SCALE;
      const documentY = (sample.y + geometry.originCellY) / STUDIO_WET_INK_BRUSH_FIELD_SCALE;
      const field = studioInkwashDocumentToField(wash, documentX, documentY);
      return {
        x: field.x,
        y: field.y,
        pressure: sample.pressure,
        timeMs: sample.timeMs,
      };
    });
    depositStudioInkwashFluidStroke(wash.session, {
      tool: recipe.brushId === "inkwash-water-brush" ? "water" : "pen",
      samples,
      radius: recipe.baseWidth * STUDIO_WET_INK_BRUSH_FIELD_SCALE * 0.5,
      pigmentLoad: recipe.material.pigmentLoad,
      wetnessLoad: recipe.material.wetnessLoad,
      spectralAbsorption: recipe.material.spectralAbsorption,
      inkColor: recipe.inkColor,
    });
    markStudioInkwashWashDeposited(element);
    // Live Konva/DrawNode replays must not Stam. Overlay owns the pointer-frame field.
    // Committed plans Stam once when this snapshot first lands, over the stroke's own active
    // region — the shared wash may be page-sized, but this stroke only wets its own bbox.
    if (phase !== "live") {
      const region = inkwashStrokeActiveRegion(wash, geometry);
      const steps = studioInkwashActiveRegionSteps(
        INKWASH_CPU_STAM_STEPS,
        region,
        wash.session.fluid,
        INKWASH_CPU_STAM_CELL_CAP,
      );
      if (steps > 0) {
        stepStudioInkwashFluid(
          wash.session,
          steps,
          studioInkwashFluidStepParams({
            bleed: recipe.material.bleed,
            dryRate: recipe.material.dryingRate,
            chromaticSeparation: recipe.material.chromatography ?? 0.5,
          }),
          region,
        );
      }
    }
  }
  return getStudioInkwashWash();
}

function planInkwashFluidReplay(input: Readonly<{
  element: DrawEl;
  options: StudioWetInkBrushReplayOptions;
  recipe: StudioWetInkBrushPhysicalRecipe;
  brushId: StudioWetInkBrushId;
  geometry: WetInkGeometry;
}>): StudioWetInkBrushReplayPlanResult {
  const { element, options, recipe, brushId, geometry } = input;
  const cells = geometry.width * geometry.height;
  if (cells > STUDIO_WET_INK_BRUSH_MAX_CELLS) {
    return planFailure("field-budget", "InkWash fluid field exceeds the cell budget.");
  }
  const wash = applyInkwashElementToWash(element, recipe, geometry, options.phase);
  if (!wash) {
    return planFailure("field-budget", "InkWash shared wash is unavailable.");
  }
  if (options.phase === "committed" && brushId === "inkwash-water-brush") {
    commitStudioInkwashWash();
  }
  const ownerId = studioInkwashWashVisualOwnerId();
  const silent = ownerId !== null && ownerId !== element.id;
  const upload = silent ? null : studioInkwashWashDisplay();
  if (upload && upload.rgba.byteLength > STUDIO_WET_INK_BRUSH_MAX_UPLOAD_BYTES) {
    return planFailure("upload-budget", "InkWash fluid upload exceeds the byte budget.");
  }
  return {
    ok: true,
    value: {
      runtimeVersion: STUDIO_WET_INK_BRUSH_RUNTIME_VERSION,
      phase: options.phase,
      brushId,
      strokeId: element.id,
      revision: snapshotRevision(element),
      seed: recipe.seed,
      fieldDigest: studioInkwashWashDigest() ?? studioInkwashFluidDigest(wash.session),
      fieldScale: STUDIO_WET_INK_BRUSH_FIELD_SCALE,
      originX: wash.originX,
      originY: wash.originY,
      compositeOpacity: recipe.compositeOpacity,
      uploads: upload && !silent ? [upload] : [],
      allocatedCells: wash.session.fluid.width * wash.session.fluid.height,
      simulationSteps: STUDIO_WET_INK_BRUSH_SIMULATION_STEPS,
    },
  };
}

/**
 * Builds the authoritative renderer-neutral replay. `phase` is carried for diagnostics but cannot
 * alter any physical input, which makes live/committed digest parity mechanically testable.
 */
export function planStudioWetInkBrushReplay(
  element: DrawEl,
  options: StudioWetInkBrushReplayOptions,
): StudioWetInkBrushReplayPlanResult {
  if (!studioWetInkBrushRuntimeSupportsElement(element)) {
    return planFailure(
      "unsupported-snapshot",
      "Only causal watercolor and ink-wash freehand snapshots opt into wet ink.",
    );
  }
  const brushId = exactWetInkBrushId(element.brush)!;
  if (
    typeof element.id !== "string"
    || element.id.length === 0
    || !Number.isFinite(element.strokeWidth)
    || element.strokeWidth <= 0
    || !Number.isFinite(element.opacity ?? 1)
  ) {
    return planFailure("invalid-style", "Wet-ink stroke style is invalid.");
  }
  const parsedColor = parseStudioGpuColor(element.stroke);
  if (!parsedColor) {
    return planFailure("invalid-color", "Wet-ink stroke color is unsupported.");
  }
  const recipe = resolveStudioWetInkBrushPhysicalRecipe(element);
  if (!recipe) {
    return planFailure("invalid-style", "Wet-ink physical material is unavailable.");
  }
  const pointCount = Math.floor(element.points.length / 2);
  const aliasSettings = resolveStudioBrushAliasWatercolorPlanSettings(
    brushId,
    element.strokeWidth,
  );
  if (!aliasSettings) {
    return planFailure("invalid-style", "Wet-ink alias material is unavailable.");
  }
  const pressures = mapStudioBrushAliasPressureSamples(
    brushId,
    element.pressures,
    pointCount,
    0.55,
  );
  const geometry = wetInkGeometry(element, aliasSettings.baseWidth, pressures);
  if (!geometry) {
    return planFailure("invalid-geometry", "Wet-ink stroke geometry is invalid or too large.");
  }

  if (isStudioInkwashFluidBrush(brushId)) {
    return planInkwashFluidReplay({
      element,
      options,
      recipe,
      brushId,
      geometry,
    });
  }

  const seed = recipe.seed;
  const material = recipe.material;
  const field = createStudioWetInkField({
    width: geometry.width,
    height: geometry.height,
    tileSize: 64,
    seed,
    maxTiles: STUDIO_WET_INK_BRUSH_MAX_TILES,
    maxCells: STUDIO_WET_INK_BRUSH_MAX_CELLS,
    maxSimulationSteps: 256,
    maxUploadBytes: STUDIO_WET_INK_BRUSH_MAX_UPLOAD_BYTES,
    absorption: material.absorption,
    bleed: material.bleed,
    chromatography: material.chromatography,
    dryingRate: material.dryingRate,
    edgeDarkening: material.edgeDarkening,
    fixationRate: material.fixationRate,
    granulation: material.granulation,
    paperRoughness: material.paperRoughness,
    inkColor: recipe.inkColor,
    spectralAbsorption: material.spectralAbsorption,
  });
  if (!field.ok) return planFailure("field-budget", field.reason);

  const deposited = depositStudioWetInkStroke(field.value, {
    samples: geometry.samples,
    radius: aliasSettings.baseWidth * STUDIO_WET_INK_BRUSH_FIELD_SCALE / 2,
    hardness: material.hardness,
    spacing: aliasSettings.spacing * STUDIO_WET_INK_BRUSH_FIELD_SCALE,
    waterLoad: material.waterLoad,
    pigmentLoad: material.pigmentLoad,
    wetnessLoad: material.wetnessLoad,
    seed,
    maxDabs: STUDIO_WET_INK_BRUSH_MAX_DABS,
    normalization: {
      fixedRateHz: STUDIO_WET_INK_BRUSH_FIXED_RATE_HZ,
      coordinateQuantum: 1 / 4_096,
    },
  });
  if (!deposited.ok) {
    return planFailure(
      deposited.code === "dab-budget-exceeded"
        ? "deposition-budget"
        : "field-budget",
      deposited.reason,
    );
  }
  const simulated = simulateStudioWetInkField(
    field.value,
    STUDIO_WET_INK_BRUSH_SIMULATION_STEPS,
  );
  if (!simulated.ok) {
    return planFailure(
      simulated.code === "step-budget-exceeded"
        ? "simulation-budget"
        : "field-budget",
      simulated.reason,
    );
  }
  const uploads = planStudioWetInkTileUploads(field.value);
  if (!uploads.ok) {
    return planFailure(
      uploads.code === "upload-budget-exceeded" ? "upload-budget" : "field-budget",
      uploads.reason,
    );
  }

  return {
    ok: true,
    value: {
      runtimeVersion: STUDIO_WET_INK_BRUSH_RUNTIME_VERSION,
      phase: options.phase,
      brushId,
      strokeId: element.id,
      revision: snapshotRevision(element),
      seed,
      fieldDigest: studioWetInkFieldDigest(field.value),
      fieldScale: STUDIO_WET_INK_BRUSH_FIELD_SCALE,
      originX: geometry.originCellX / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
      originY: geometry.originCellY / STUDIO_WET_INK_BRUSH_FIELD_SCALE,
      compositeOpacity: recipe.compositeOpacity,
      uploads: uploads.value,
      allocatedCells: field.value.allocatedCells,
      simulationSteps: simulated.value.appliedSteps,
    },
  };
}

function defaultSurfaceFactory(
  width: number,
  height: number,
): StudioWetInkBrushSurface | null {
  try {
    if (typeof globalThis.OffscreenCanvas === "function") {
      const surface = new globalThis.OffscreenCanvas(width, height);
      if (surface.getContext("2d")) return surface as StudioWetInkBrushSurface;
    }
    if (typeof globalThis.document !== "undefined") {
      const surface = globalThis.document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      return surface as StudioWetInkBrushSurface;
    }
  } catch {
    return null;
  }
  return null;
}

function destinationPhysicalScale(
  context: StudioWetInkBrushDestinationContext,
): number | null {
  try {
    const transform = context._context?.getTransform() ?? context.getTransform?.();
    if (!transform) return 1;
    const scaleX = Math.hypot(transform.a, transform.b);
    const scaleY = Math.hypot(transform.c, transform.d);
    const scale = Math.max(scaleX, scaleY);
    return Number.isFinite(scale) && scale > 0 ? scale : null;
  } catch {
    return null;
  }
}

function renderGuard(
  plan: StudioWetInkBrushReplayPlan,
  options: StudioWetInkBrushRenderOptions,
): "hidden" | "aborted" | "stale-revision" | null {
  try {
    const hidden = typeof options.hidden === "function"
      ? options.hidden()
      : options.hidden === true;
    if (hidden) return "hidden";
  } catch {
    return "hidden";
  }
  try {
    if (options.signal?.aborted) return "aborted";
  } catch {
    return "aborted";
  }
  const expected = options.expectedRevision ?? plan.revision;
  if (!Number.isSafeInteger(expected) || expected !== plan.revision) {
    return "stale-revision";
  }
  try {
    const current = typeof options.currentRevision === "function"
      ? options.currentRevision()
      : options.currentRevision ?? plan.revision;
    if (!Number.isSafeInteger(current) || current !== expected) {
      return "stale-revision";
    }
  } catch {
    return "stale-revision";
  }
  return null;
}

function releasePreparedUploads(uploads: readonly PreparedUpload[]): void {
  for (const { surface } of uploads) {
    surface.width = 1;
    surface.height = 1;
  }
}

function prepareUploads(
  uploads: readonly StudioWetInkTileUpload[],
  factory: StudioWetInkBrushSurfaceFactory,
): readonly PreparedUpload[] | null {
  const prepared: PreparedUpload[] = [];
  try {
    for (const upload of uploads) {
      const surface = factory(upload.width, upload.height);
      const context = surface?.getContext("2d", { alpha: true });
      if (!surface || !context) {
        releasePreparedUploads(prepared);
        return null;
      }
      const imageData = context.createImageData(upload.width, upload.height);
      if (
        imageData.width !== upload.width
        || imageData.height !== upload.height
        || imageData.data.length !== upload.rgba.length
      ) {
        releasePreparedUploads(prepared);
        surface.width = 1;
        surface.height = 1;
        return null;
      }
      imageData.data.set(upload.rgba);
      context.putImageData(imageData, 0, 0);
      prepared.push({ upload, surface });
    }
    return prepared;
  } catch {
    releasePreparedUploads(prepared);
    return null;
  }
}

/**
 * Composites a fully prepared physical replay. Hidden/abort/stale exits are checked both before
 * allocation and immediately before `save()`/`drawImage()`, guaranteeing those authority changes
 * cannot leave a partially mutated destination.
 */
export function renderStudioWetInkBrushReplay(
  context: StudioWetInkBrushDestinationContext,
  plan: StudioWetInkBrushReplayPlan,
  options: StudioWetInkBrushRenderOptions = {},
): StudioWetInkBrushRenderResult {
  const initialGuard = renderGuard(plan, options);
  if (initialGuard) return { status: "skipped", reason: initialGuard };
  if (plan.uploads.length === 0 || plan.compositeOpacity <= 0) {
    return { status: "empty", fieldDigest: plan.fieldDigest };
  }

  const nativeScale = destinationPhysicalScale(context);
  if (
    nativeScale === null
    || nativeScale > STUDIO_WET_INK_BRUSH_MAX_PHYSICAL_SCALE
  ) {
    return { status: "unavailable", reason: "native-scale-unsupported" };
  }
  const surfaceBytes = plan.uploads.reduce(
    (sum, upload) => sum + upload.width * upload.height * 4,
    0,
  );
  const maximumSurfaceBytes =
    options.maximumSurfaceBytes ?? STUDIO_WET_INK_BRUSH_SURFACE_BYTE_BUDGET;
  if (
    !Number.isSafeInteger(surfaceBytes)
    || !Number.isSafeInteger(maximumSurfaceBytes)
    || maximumSurfaceBytes <= 0
    || surfaceBytes > maximumSurfaceBytes
  ) {
    return { status: "unavailable", reason: "surface-budget" };
  }

  const factory = options.surfaceFactory ?? defaultSurfaceFactory;
  const prepared = prepareUploads(plan.uploads, factory);
  if (!prepared) {
    return {
      status: "unavailable",
      reason: options.surfaceFactory
        ? "surface-preparation-failed"
        : "surface-unavailable",
    };
  }
  const finalGuard = renderGuard(plan, options);
  if (finalGuard) {
    releasePreparedUploads(prepared);
    return { status: "skipped", reason: finalGuard };
  }

  const inheritedAlpha = clamp01(context.globalAlpha);
  let destinationStarted = false;
  try {
    context.save();
    context.globalAlpha = inheritedAlpha * plan.compositeOpacity;
    for (const { upload, surface } of prepared) {
      destinationStarted = true;
      context.drawImage(
        surface,
        0,
        0,
        upload.width,
        upload.height,
        plan.originX + upload.x / plan.fieldScale,
        plan.originY + upload.y / plan.fieldScale,
        upload.width / plan.fieldScale,
        upload.height / plan.fieldScale,
      );
    }
    context.restore();
  } catch {
    try {
      context.restore();
    } catch {
      // The partial result prevents a second renderer from double-painting an unknown prefix.
    }
    releasePreparedUploads(prepared);
    return destinationStarted
      ? { status: "partial", reason: "destination-composite-failed" }
      : { status: "unavailable", reason: "surface-preparation-failed" };
  }
  releasePreparedUploads(prepared);
  return {
    status: "rendered",
    fieldDigest: plan.fieldDigest,
    nativeScale,
    tileCount: plan.uploads.length,
    surfaceBytes,
  };
}
