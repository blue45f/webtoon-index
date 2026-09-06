/**
 * Bounded stroke-local coverage renderer for versioned dynamic brushes.
 *
 * Dynamic dabs are flattened into deterministic ellipse, analytic-falloff or full alpha-texture
 * primitives. The coverage pass bins those marks into world-aligned tiles, renders every tile
 * completely off destination, then applies element opacity once while compositing the tiles. This
 * avoids both historical per-dab opacity darkening and a canvas-sized offscreen allocation.
 */

import {
  isStudioDynamicBrushCausalDepositPipeline,
  isStudioSoftFalloffLinearAccumulationProgramPin,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import {
  resolveNormalizedStudioBrushDabColor,
  resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt,
  resolveNormalizedStudioBrushGrainAlphaMultiplierAt,
} from "./brush/studio-brush-material-dynamics";
import {
  composeStudioBrushR8TipPaperAlphaMap,
  resetStudioBrushR8GrainRegistry,
  resolveStudioBrushR8GrainSampler,
} from "./brush/studio-brush-r8-grain-runtime";
import {
  planStudioDynamicBrushRenderBudget,
  type StudioDynamicBrushAcceptedPrefixReceipt,
  type StudioDynamicBrushRenderStampGrid,
} from "./brush/studio-brush-render-budget";
import {
  clearStudioBrushSoftFalloffStampCache,
  prepareStudioBrushSoftFalloffTintedStampSurface,
  STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  type StudioBrushSoftFalloffStampTone,
} from "./brush/studio-brush-soft-falloff-stamp";
import {
  acquireStudioBrushTextureStampSurface,
  clearStudioBrushTextureStampCache,
  studioBrushTextureAlphaMapIsValid,
  type StudioBrushTextureStampSurfaceFactory,
} from "./brush/studio-brush-textured-stamp";
import {
  composeNormalizedStudioBrushTipLayerDab,
  composeStudioBrushDualTipAlphaMap,
  studioBrushDualBrushIsActive,
  studioBrushDualTipUsesSolidEllipse,
  type StudioBrushComposableDab,
} from "./brush/studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  studioBrushTipUsesSolidEllipse,
  visitStudioBrushTipStampSamples,
  type NormalizedStudioBrushTipSettings,
  type StudioBrushTipAlphaMap,
} from "./brush/studio-brush-tip-stamp";
import {
  bridgeStudioDynamicDabVariationToDryMediaV1,
  studioDryMediaDynamicBridgeMarkMultiplier,
  type StudioDynamicBrushMaterialIdentity,
} from "./brush/studio-dry-media-dynamic-bridge";
import {
  linearizeStudioDryMediaKernelDepositionAlpha,
  resolveStudioDryMediaKernelTipAlphaMap,
  studioDryMediaKernelDabPathOwnsMaterial,
  studioDryMediaKernelStrokeToothMultiplier,
} from "./brush/studio-dry-media-kernel-tip";
import {
  planStudioDryMediaUnionRibbonCarrier,
  studioDryMediaUnionRibbonCarrierOwnsMaterial,
  type StudioDryMediaUnionRibbonPolygon,
} from "./brush/studio-dry-media-union-ribbon-carrier";
import {
  acquireStudioPaperGranulationTile,
  resolveStudioDocumentPaperSurface,
  resolveStudioPaperContactToothAlphaMultiplierAt,
  resolveStudioPaperGranulationAlphaMultiplierAt,
  studioPaperGranulationIsActive,
  type StudioPaperGranulationSettings,
  type StudioPaperGranulationTile,
  type StudioPaperSurfaceSettings,
} from "./brush/studio-paper-granulation-runtime";
import {
  STUDIO_PAPER_SUBSTRATE_FALLBACK_PRESSURE,
  studioPaperUsesContactTooth,
  type StudioPaperSubstrateModel,
} from "./brush/studio-paper-substrate-model";
import {
  composeStudioPaperTipAlphaMap,
  STUDIO_PAPER_TIP_COMPOSITION_BYTE_BUDGET,
} from "./brush/studio-paper-tip-composition";
import {
  planStudioCompetitorSpecialtyRibbonCarrier,
  studioCompetitorSpecialtyRibbonCarrierOwnsMaterial,
  studioCompetitorSpecialtyRibbonCarrierWorkMultiplier,
  type StudioCompetitorSpecialtyRibbonPolygon,
} from "./studio-competitor-specialty-ribbon-carrier";
import {
  planStudioFlatNibRibbonCarrier,
  type StudioFlatNibRibbonPolygon,
} from "./studio-flat-nib-ribbon-carrier";
import {
  planStudioPaintRollerRibbonCarrier,
  studioPaintRollerRibbonCarrierOwnsMaterial,
  type StudioPaintRollerRibbonPolygon,
} from "./studio-paint-roller-ribbon-carrier";
import {
  planStudioProfessionalShelfRibbonCarrier,
  studioProfessionalShelfRibbonCarrierOwnsMaterial,
  studioProfessionalShelfRibbonCarrierWorkMultiplier,
  type StudioProfessionalShelfRibbonPolygon,
} from "./studio-professional-shelf-ribbon-carrier";
import {
  planStudioSplatterOriginAnchorDab,
  studioSplatterOriginAnchorMarkCount,
} from "./studio-splatter-origin-anchor";

import type { StudioPaperMediumV1 } from "./brush/studio-paper-media-profile-v1";

export const STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE = 256;

/**
 * 커널 팁 가시성 상수 — 커널 텍스처가 서브픽셀 반경에서도 알파를 남기는 최소 스탬프 크기.
 * dab 크기만의 순수 함수로 적용된다(위 주석).
 */
const STUDIO_KERNEL_TIP_MIN_VISIBLE_SIZE = 2.2;
/**
 * 커널 팁 마크의 최소 가시 알파 — 선형화 침착 × stroke tooth 조합이 단일 dab(탭)에서
 * 0.03 수준으로 내려가 저장 문서에서 획이 사라지는 것을 막는다(ADR 0010).
 */
const STUDIO_KERNEL_TIP_MIN_VISIBLE_ALPHA = 0.12;
/**
 * 하한 전액이 유지되는 획 시작 램프 길이(arc px). 탭과 빠른 짧은 터치는 이 안에서 끝나므로
 * ADR 0010의 "저장 문서에서 획이 사라지지 않는다"가 그대로 성립하고, 이 너머의 완전 pore는
 * 하한이 tooth 배율로 줄어 종이로 읽힌다(위 상수의 사용처 주석 참조).
 */
const STUDIO_KERNEL_TIP_TAP_FLOOR_REACH_PX = 8;

export const STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS = 2;
/**
 * Live and committed passes intentionally share the same surface policy. A lower live resolution
 * produced a visible sharpness/texture pop at pointer-up on Retina and zoomed canvases. Live work
 * remains bounded by its upstream draft mark ceiling; causal-v3 committed continuation can exceed
 * the historical 65k ceiling and switches to the one-surface streaming compositor below.
 */
export const STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET = 64 * 1024 * 1024;
export const STUDIO_DYNAMIC_COVERAGE_COMMITTED_BYTE_BUDGET =
  STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET;
export const STUDIO_DYNAMIC_COVERAGE_ACTIVE_TILE_MARK_REFERENCE_BUDGET = 262_144;
export const STUDIO_DYNAMIC_COVERAGE_COMMITTED_TILE_MARK_REFERENCE_BUDGET =
  STUDIO_DYNAMIC_COVERAGE_ACTIVE_TILE_MARK_REFERENCE_BUDGET;
/**
 * Temporary exact Canvas/SVG R8 bridge bakes paper into one Float32 tip map per retained dab.
 * Bound that retained plan memory before allocating any per-dab maps; the future native GPU/SVG
 * sampler can replace this bridge without changing persisted source identity.
 */
export const STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET =
  16 * 1_024 * 1_024;
/**
 * Retained dynamic strokes are redrawn whenever Konva repaints their layer. Rebuilding every
 * unchanged stroke into fresh coverage tiles on each cursor frame is both redundant and extremely
 * expensive: one short G-pen stroke previously expanded into ~23k offscreen ellipse calls during
 * the following stroke. Keep a bounded LRU of immutable committed tile rasters instead.
 *
 * The cache is intentionally separate from the per-stroke 64 MiB admission budget. It holds about
 * 480 ordinary 258×258 RGBA tiles on desktop and 180 on mobile/low-memory devices, and is reclaimed
 * eagerly on eviction or Studio document teardown; active drafts never enter it, so pointer input
 * cannot fill the cache with one-frame previews.
 */
export const STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_BYTE_BUDGET =
  128 * 1024 * 1024;
export const STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_MOBILE_BYTE_BUDGET =
  48 * 1024 * 1024;

export interface StudioDynamicCoverageCommittedCacheDeviceProfile {
  readonly coarsePointer: boolean;
  readonly deviceMemoryGb: number | null;
}

export function resolveStudioDynamicCoverageCommittedCacheByteBudget(
  profile: StudioDynamicCoverageCommittedCacheDeviceProfile,
): number {
  const lowMemory = profile.deviceMemoryGb !== null
    && Number.isFinite(profile.deviceMemoryGb)
    && profile.deviceMemoryGb > 0
    && profile.deviceMemoryGb <= 4;
  return profile.coarsePointer || lowMemory
    ? STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_MOBILE_BYTE_BUDGET
    : STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_BYTE_BUDGET;
}

export interface StudioDynamicBrushCoverageMark {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  /** Dab opacity × flow × tip alpha × grain. Element/stroke opacity is deliberately absent. */
  readonly alpha: number;
  readonly color: string;
  /**
   * Connected hard flat/chisel carrier. It is mutually exclusive with texture/falloff and carries
   * the exact polygon shared by live, retained Canvas and SVG export.
   */
  readonly ribbon?:
    | StudioFlatNibRibbonPolygon
    | StudioPaintRollerRibbonPolygon
    | StudioDryMediaUnionRibbonPolygon
    | StudioProfessionalShelfRibbonPolygon
    | StudioCompetitorSpecialtyRibbonPolygon;
  /**
   * Full alpha-map stamp rendered by one affine `drawImage`. The immutable map is shared by every
   * dab; deterministic world/stroke grain is footprint-integrated into `alpha` so Canvas and SVG
   * share the same pulse-resistant material response.
   */
  readonly texture?: Readonly<{
    readonly kind: "alpha-map";
    readonly alphaMap: StudioBrushTipAlphaMap;
  }>;
  /**
   * Procedural soft tips remain one analytic mark instead of expanding into a grid of small
   * circles. Absence means the historical solid-ellipse/custom-alpha mark.
   */
  readonly falloff?: Readonly<{
    readonly kind: "analytic-radial";
    /** Alpha at normalized radius r is `(1 - r) ^ exponent`. */
    readonly exponent: number;
    /**
     * Versioned mask tone. Present only on marks planned from dynamics carrying the explicit
     * `softFalloffLinearProgram` pin: the ramp above is re-encoded through
     * `linearizeStudioBrushSoftFalloffCoverageAlpha` so overlapping skirts accumulate like linear
     * light. Absence keeps the historical sRGB ramp byte-identically.
     */
    readonly tone?: StudioBrushSoftFalloffStampTone;
  }>;
}

export interface StudioDynamicBrushCoverageBudgetContract {
  readonly settings: NormalizedStudioBrushDynamicsSettings;
  readonly materialMarkMultiplier: number;
  readonly specialistCarrier:
    | "competitor-specialty-ribbon"
    | "paint-roller-ribbon"
    | "professional-shelf-ribbon"
    | null;
}

/**
 * Returns the command-count contract used by every live, retained and SVG budget caller.
 *
 * Professional shelf ribbons intentionally replace legacy decorative tip layers with one
 * connected multi-contour command per canonical dab. The command budget still charges every
 * physical contour, so a long fan brush cannot hide ten lanes behind one nominal fill. Keeping
 * both adjustments in the shared coverage authority prevents live input from accepting a
 * different prefix than commit/export.
 */
export function resolveStudioDynamicBrushCoverageBudgetContract(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): StudioDynamicBrushCoverageBudgetContract {
  const competitorSpecialtyRibbon =
    studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
      materialIdentity,
      dynamics,
    );
  const professionalShelfRibbon =
    studioProfessionalShelfRibbonCarrierOwnsMaterial(
      materialIdentity,
      dynamics,
    );
  const paintRollerRibbon = studioPaintRollerRibbonCarrierOwnsMaterial(
    materialIdentity,
    dynamics,
  );
  const professionalContourWork =
    studioProfessionalShelfRibbonCarrierWorkMultiplier(
      materialIdentity,
      dynamics,
    );
  const competitorContourWork =
    studioCompetitorSpecialtyRibbonCarrierWorkMultiplier(
      materialIdentity,
      dynamics,
    );
  const settings = (
    professionalShelfRibbon
    || competitorSpecialtyRibbon
  ) && dynamics.tipLayers.length > 0
    ? Object.freeze({
        ...dynamics,
        tipLayers: Object.freeze([]),
      })
    : dynamics;
  return Object.freeze({
    settings,
    materialMarkMultiplier:
      competitorSpecialtyRibbon
        ? competitorContourWork
        : professionalShelfRibbon
        ? professionalContourWork
        : paintRollerRibbon
          ? 1
        : studioDryMediaDynamicBridgeMarkMultiplier(materialIdentity),
    specialistCarrier: competitorSpecialtyRibbon
      ? "competitor-specialty-ribbon"
      : professionalShelfRibbon
        ? "professional-shelf-ribbon"
        : paintRollerRibbon
        ? "paint-roller-ribbon"
        : null,
  });
}

/**
 * A variation can retain the causal-v3 continuation boundaries instead of flattening every dab
 * into one second, million-entry array at pointer-up. Consumers iterate the immutable segments in
 * order, and accepted-prefix truncation only slices the one boundary segment.
 */
export interface StudioDynamicBrushSegmentedDabVariation {
  readonly kind: "studio-dynamic-brush-segmented-dab-variation";
  readonly segments: readonly (readonly StudioDynamicBrushDab[])[];
}

export type StudioDynamicBrushDabVariation =
  | readonly StudioDynamicBrushDab[]
  | StudioDynamicBrushSegmentedDabVariation;

export interface StudioDynamicBrushR8TextureAlphaMapReceipt {
  readonly policy: "r8-texture-alpha-map-bytes-v1";
  /** Identity-deduplicated maps actually retained by the returned marks. */
  readonly uniqueAlphaMapCount: number;
  readonly alphaMapBytes: number;
  readonly alphaMapByteBudget: number;
}

export interface StudioDynamicBrushCoverageMarkPlanInput {
  readonly dabVariations: readonly StudioDynamicBrushDabVariation[];
  /**
   * Explicit persisted/runtime material identity. A mapped dry medium is lowered through the
   * anisotropic bridge; an unsupported identity keeps its authored tip renderer unchanged.
   */
  readonly materialIdentity?: StudioDynamicBrushMaterialIdentity;
  /**
   * Optional full-stroke origins for suffix-only planning. Without this, each variation's first
   * supplied dab is the origin, which is correct for full plans but would shift stroke-fixed grain
   * when an incremental caller supplies only newly appended dabs.
   */
  readonly strokeOrigins?: readonly Readonly<{ x: number; y: number }>[];
  readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  readonly dynamicSeed: number;
  readonly stroke: string;
  readonly stampGrid: StudioDynamicBrushRenderStampGrid;
  /** Same live/committed mark ceiling used to plan the dab count and stamp grid. */
  readonly markBudget: number;
  /**
   * Optional remaining stroke-wide R8 allocation. Full retained/export plans omit it and receive
   * the global 16 MiB allowance; incremental live callers pass the unspent suffix budget.
   */
  readonly r8AlphaMapByteBudget?: number;
  /**
   * Core dry-media live suffixes may prepend complete causal source dabs solely to recover the
   * exact previous fibre centres. The bridge and carrier consume that context but omit its
   * polygons from the returned marks. Full retained/export plans leave this at zero.
   */
  readonly dryMediaUnionLeadingSourceDabsToSkip?: number;
  /**
   * 종이 결 침착. 브러시 반응(`studio-paper-brush-response`)만 넘기면 문서가 깔아 둔 종이는
   * 렌더러가 직접 조회한다. 생략하면 정확한 항등이라 기존 호출부의 픽셀은 한 비트도 바뀌지
   * 않는다 — 배선은 호출부마다 독립적으로 켤 수 있다.
   */
  readonly paper?: Readonly<{
    readonly response: StudioPaperGranulationSettings;
    readonly surface?: StudioPaperSurfaceSettings;
    /** 획이 태어날 때 얼린 substrate 세대. 생략 = 레거시 valley-multiply(픽셀 불변). */
    readonly model?: StudioPaperSubstrateModel;
    /** 극성 taxonomy상의 상호작용 매체. `model`이 있을 때만 채워진다. */
    readonly medium?: StudioPaperMediumV1;
  }>;
}

function isStudioDynamicBrushSegmentedDabVariation(
  variation: StudioDynamicBrushDabVariation,
): variation is StudioDynamicBrushSegmentedDabVariation {
  return !Array.isArray(variation);
}

function studioDynamicBrushDabVariationCount(
  variation: StudioDynamicBrushDabVariation,
): number {
  if (!isStudioDynamicBrushSegmentedDabVariation(variation)) {
    return variation.length;
  }
  return variation.segments.reduce(
    (count, segment) => count + segment.length,
    0,
  );
}

function studioDynamicBrushDabVariationFirst(
  variation: StudioDynamicBrushDabVariation,
): StudioDynamicBrushDab | undefined {
  if (!isStudioDynamicBrushSegmentedDabVariation(variation)) {
    return variation[0];
  }
  for (const segment of variation.segments) {
    if (segment[0]) return segment[0];
  }
  return undefined;
}

function* studioDynamicBrushDabsInVariation(
  variation: StudioDynamicBrushDabVariation,
): Generator<StudioDynamicBrushDab, void> {
  if (!isStudioDynamicBrushSegmentedDabVariation(variation)) {
    yield* variation;
    return;
  }
  for (const segment of variation.segments) {
    yield* segment;
  }
}

function studioDynamicBrushDabVariationPrefix(
  variation: StudioDynamicBrushDabVariation,
  maximumDabs: number,
): StudioDynamicBrushDabVariation {
  const boundedMaximum = Math.max(0, Math.floor(maximumDabs));
  if (!isStudioDynamicBrushSegmentedDabVariation(variation)) {
    return variation.slice(0, boundedMaximum);
  }
  const acceptedSegments: Array<readonly StudioDynamicBrushDab[]> = [];
  let remaining = boundedMaximum;
  for (const segment of variation.segments) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      acceptedSegments.push(segment);
      remaining -= segment.length;
      continue;
    }
    acceptedSegments.push(segment.slice(0, remaining));
    remaining = 0;
  }
  return {
    kind: "studio-dynamic-brush-segmented-dab-variation",
    segments: acceptedSegments,
  };
}

export type StudioDynamicBrushCoverageMarkPlan =
  | {
      readonly ok: true;
      readonly marks: readonly StudioDynamicBrushCoverageMark[];
      /**
       * A causal plan that crossed the global ceiling still succeeds with this immutable complete
       * dab-wave prefix. The receipt makes truncation explicit to live, retained and SVG callers.
       */
      readonly acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
      /**
       * Actual generated R8 alpha-map memory. Incremental callers can sum immutable receipts
       * across suffix plans instead of treating the per-call 16 MiB preflight as a stroke-wide
       * allowance.
       */
      readonly r8TextureAlphaMapReceipt?: StudioDynamicBrushR8TextureAlphaMapReceipt;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "dry-media-bridge"
        | "competitor-specialty-carrier"
        | "invalid-mark"
        | "mark-budget"
        | "professional-shelf-carrier"
        | "r8-grain-unavailable"
        | "r8-grain-memory-budget";
    };

export interface StudioDynamicBrushCoverageAndLegacyMarkPlan {
  readonly coveragePlan: StudioDynamicBrushCoverageMarkPlan;
  /**
   * Complete legacy replay marks for an explicitly legacy deposit pipeline. Causal-v2 never
   * produces an unbounded second plan after a bounded preflight rejection: doing so could both
   * exceed the shared work ceiling and change the accepted live deposit sequence.
   */
  readonly legacyMarks: readonly StudioDynamicBrushCoverageMark[];
}

export type StudioCoverageSurfaceContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type StudioCoverageSurface = CanvasImageSource & {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings
  ): StudioCoverageSurfaceContext | null;
};

export type StudioCoverageSurfaceFactory = (
  width: number,
  height: number
) => StudioCoverageSurface | null;

export interface StudioDynamicBrushCoverageDestinationContext {
  globalAlpha: number;
  save(): void;
  restore(): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number
  ): void;
  /** Konva exposes the native scene context here; ordinary Canvas contexts expose getTransform. */
  _context?: Pick<CanvasRenderingContext2D, "getTransform">;
  getTransform?: () => DOMMatrix;
}

export interface StudioDynamicBrushLegacyDestinationContext
  extends StudioDynamicBrushCoverageDestinationContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradient;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number
  ): void;
  ellipse?(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number
  ): void;
  fill(fillRule?: CanvasFillRule): void;
  fill(path: Path2D, fillRule?: CanvasFillRule): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  imageSmoothingEnabled?: boolean;
  imageSmoothingQuality?: ImageSmoothingQuality;
}

export interface StudioDynamicBrushCoverageRenderOptions {
  readonly activeDraft: boolean;
  readonly opacity: number;
  readonly surfaceFactory?: StudioCoverageSurfaceFactory;
  /**
   * Stable identity for an immutable committed mark plan. When present on a committed render, the
   * prepared coverage tiles are reused across retained layer redraws at the same physical scale.
   * Reusing a key for a different marks array safely replaces the stale entry.
   */
  readonly committedCacheKey?: object | string;
}

export type StudioDynamicBrushCoverageRenderResult =
  | {
      readonly status: "rendered";
      readonly scale: number;
      readonly tileCount: number;
      readonly allocatedBytes: number;
      readonly tileMarkReferences: number;
    }
  | {
      readonly status: "empty";
    }
  | {
      /** The selected coverage surface cannot execute this operation. */
      readonly status: "unavailable";
      readonly reason: "surface-unavailable" | "surface-render-failed";
    }
  | {
      /** The selected coverage renderer rejected this source before destination mutation. */
      readonly status: "rejected";
      readonly reason:
        | "invalid-mark"
        | "planning-failed"
        | "surface-budget"
        | "tile-mark-budget";
    }
  | {
      /**
       * Destination composition started before the browser threw. Replaying legacy marks would
       * double-paint the completed prefix, so callers must not select another renderer for this
       * operation.
       */
      readonly status: "partial";
      readonly reason:
        | "destination-composite-failed"
        | "surface-render-failed";
    };

interface MarkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface TileBin {
  readonly tileX: number;
  readonly tileY: number;
  /**
   * Active/small committed plans use append-friendly arrays. Large committed plans use compact
   * Uint32 storage so the one-million-dab V3 ceiling cannot expand into millions of boxed JS
   * number references.
   */
  readonly markIndexes: readonly number[] | Uint32Array;
}

interface MutableTileBin {
  readonly tileX: number;
  readonly tileY: number;
  readonly markIndexes: number[];
}

interface TilePlan {
  readonly bins: readonly TileBin[];
  readonly scale: number;
  readonly allocatedBytes: number;
  readonly tileMarkReferences: number;
}

interface PreparedTile extends TileBin {
  readonly surface: StudioCoverageSurface;
}

type StudioDynamicCoverageCommittedCacheKey = object | string;

interface CommittedCoverageCacheEntry {
  readonly key: StudioDynamicCoverageCommittedCacheKey;
  readonly marks: readonly StudioDynamicBrushCoverageMark[];
  readonly scale: number;
  readonly plan: TilePlan;
  readonly prepared: readonly PreparedTile[];
  lastUsed: number;
}

const TAU = Math.PI * 2;
const ANALYTIC_FALLOFF_EXPONENT_MIN = 0.125;
const ANALYTIC_FALLOFF_EXPONENT_MAX = 8;
const committedCoverageCache = new Map<
  StudioDynamicCoverageCommittedCacheKey,
  Map<number, CommittedCoverageCacheEntry>
>();
let committedCoverageCacheBytes = 0;
let committedCoverageCacheClock = 0;

function runtimeCommittedCoverageCacheByteBudget(): number {
  const browserNavigator = typeof globalThis.navigator === "undefined"
    ? null
    : globalThis.navigator as Navigator & { readonly deviceMemory?: number };
  const deviceMemory = browserNavigator?.deviceMemory;
  return resolveStudioDynamicCoverageCommittedCacheByteBudget({
    coarsePointer:
      globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
    deviceMemoryGb:
      typeof deviceMemory === "number" && Number.isFinite(deviceMemory)
        ? deviceMemory
        : null,
  });
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function markIsValid(mark: StudioDynamicBrushCoverageMark): boolean {
  return Number.isFinite(mark.x)
    && Number.isFinite(mark.y)
    && finitePositive(mark.radiusX)
    && finitePositive(mark.radiusY)
    && Number.isFinite(mark.angleRadians)
    && Number.isFinite(mark.alpha)
    && typeof mark.color === "string"
    && mark.color.length > 0
    && (
      mark.ribbon === undefined
      || (
        (
          mark.ribbon.kind === "flat-nib-ribbon-polygon"
          || mark.ribbon.kind === "paint-roller-ribbon-polygon"
          || mark.ribbon.kind === "dry-media-union-ribbon-polygon"
          || mark.ribbon.kind === "professional-shelf-ribbon-polygon"
          || mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
        )
        && mark.ribbon.polygons.length > 0
        && mark.ribbon.polygons.every((points) => (
          points.length >= 6
          && points.length % 2 === 0
          && points.every(Number.isFinite)
        ))
        && (
          mark.ribbon.kind !== "competitor-specialty-ribbon-polygon"
          || mark.ribbon.contourStyles === undefined
          || (
            mark.ribbon.contourStyles.length
              === mark.ribbon.polygons.length
            && mark.ribbon.contourStyles.every((style) => (
              (
                style.role === "body"
                || style.role === "highlight"
                || style.role === "shadow"
              )
              && typeof style.color === "string"
              && style.color.length > 0
              && Number.isFinite(style.alphaMultiplier)
              && style.alphaMultiplier > 0
              && style.alphaMultiplier <= 1
            ))
          )
        )
      )
    )
    && (
      mark.texture === undefined
      || (
        mark.texture.kind === "alpha-map"
        && studioBrushTextureAlphaMapIsValid(mark.texture.alphaMap)
      )
    )
    && !(mark.texture && mark.falloff)
    && !(mark.ribbon && (mark.texture || mark.falloff))
    && (
      mark.falloff === undefined
      || (
        mark.falloff.kind === "analytic-radial"
        && finitePositive(mark.falloff.exponent)
        && mark.falloff.exponent >= ANALYTIC_FALLOFF_EXPONENT_MIN
        && mark.falloff.exponent <= ANALYTIC_FALLOFF_EXPONENT_MAX
        && (
          mark.falloff.tone === undefined
          || mark.falloff.tone
            === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
        )
      )
    );
}

function proceduralSoftTipFalloffExponent(
  tip: NormalizedStudioBrushTipSettings
): number {
  // Mirrors the renderer-neutral procedural soft-tip contract in studio-brush-tip-stamp.
  return 1.4 + tip.softness * 2.2;
}

function tipUsesAnalyticSoftFalloff(
  tip: NormalizedStudioBrushTipSettings,
  primary: boolean,
  dualBrush: NormalizedStudioBrushDynamicsSettings["dualBrush"],
  fullTextureAuthority: boolean,
): boolean {
  const activeDual = primary && studioBrushDualBrushIsActive(dualBrush);
  return tip.shape === "soft"
    && tip.alphaMapBase64 === null
    // Any enabled dual tip is a single precomposed full alpha map. Splitting a screen union into
    // an analytic carrier plus a sampled secondary changed command count and could reveal circles.
    && (
      !activeDual
      || (!fullTextureAuthority && dualBrush?.blendMode === "screen")
    );
}

/** Path2D memo for frozen carrier ribbons, keyed by ribbon identity (see the paint path below). */
const RIBBON_PATH_CACHE = new WeakMap<object, Path2D>();

/**
 * Shared mark compositor for live, bounded committed and direct legacy paths. Keeping procedural
 * falloff here prevents pointer-up/replay from changing the airbrush footprint.
 */
export function renderStudioDynamicBrushCoverageMark(
  context: StudioDynamicBrushLegacyDestinationContext,
  mark: StudioDynamicBrushCoverageMark,
  alphaMultiplier = 1,
  textureSurfaceFactory: StudioBrushTextureStampSurfaceFactory =
    defaultSurfaceFactory,
): void {
  context.globalAlpha = clampAlpha(mark.alpha * alphaMultiplier);
  if (mark.ribbon) {
    if (
      mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
      && mark.ribbon.contourStyles
    ) {
      let contourIndex = 0;
      while (contourIndex < mark.ribbon.polygons.length) {
        const style = mark.ribbon.contourStyles[contourIndex]!;
        context.globalAlpha = clampAlpha(
          mark.alpha * alphaMultiplier * style.alphaMultiplier,
        );
        if (context.fillStyle !== style.color) context.fillStyle = style.color;
        context.beginPath();
        do {
          const points = mark.ribbon.polygons[contourIndex]!;
          const len = points.length;
          if (len >= 2) {
            const firstX = points[0];
            const firstY = points[1];
            if (firstX !== undefined && firstY !== undefined) {
              context.moveTo(firstX, firstY);
              for (let index = 2; index < len; index += 2) {
                const x = points[index];
                const y = points[index + 1];
                if (x === undefined || y === undefined) break;
                context.lineTo(x, y);
              }
              context.closePath();
            }
          }
          contourIndex += 1;
        } while (
          contourIndex < mark.ribbon.polygons.length
          && mark.ribbon.contourStyles[contourIndex]?.role === style.role
          && mark.ribbon.contourStyles[contourIndex]?.color === style.color
          && mark.ribbon.contourStyles[contourIndex]?.alphaMultiplier
            === style.alphaMultiplier
        );
        if (contourIndex > 0) {
          // Same-winding subpaths are one non-zero union. Applying alpha once to the complete
          // semantic layer prevents a cusp or self-crossing from becoming darker than a straight
          // segment while keeping body/highlight/shadow as separate physical paint layers.
          context.fill();
        }
      }
      return;
    }
    if (context.fillStyle !== mark.color) context.fillStyle = mark.color;
    if (typeof Path2D !== "undefined") {
      // Carriers hand out deep-frozen ribbons, so the cache cannot live on the ribbon itself:
      // under ES-module strict mode the property write throws a TypeError and takes the whole
      // stroke down with it (measured 2026-08-14 as a blank canvas for every unstyled ribbon,
      // e.g. hard-airbrush and erodible-pencil). A keyed side table caches identically without
      // touching the frozen object.
      let path = RIBBON_PATH_CACHE.get(mark.ribbon);
      if (!path) {
        path = new Path2D();
        const polygons = mark.ribbon.polygons;
        for (let pIndex = 0; pIndex < polygons.length; pIndex += 1) {
          const points = polygons[pIndex]!;
          const len = points.length;
          if (len < 2) continue;
          path.moveTo(points[0]!, points[1]!);
          for (let index = 2; index < len; index += 2) {
            path.lineTo(points[index]!, points[index + 1]!);
          }
          path.closePath();
        }
        RIBBON_PATH_CACHE.set(mark.ribbon, path);
      }
      try {
        context.fill(path);
        return;
      } catch {
        // Fallback for mock contexts that do not accept Path2D in fill()
      }
    }
    context.beginPath();
    const polygons = mark.ribbon.polygons;
    for (let pIndex = 0; pIndex < polygons.length; pIndex += 1) {
      const points = polygons[pIndex]!;
      const len = points.length;
      if (len < 2) continue;
      context.moveTo(points[0]!, points[1]!);
      for (let index = 2; index < len; index += 2) {
        context.lineTo(points[index]!, points[index + 1]!);
      }
      context.closePath();
    }
    context.fill();
    return;
  }
  if (mark.texture) {
    const alphaMap = mark.texture.alphaMap;
    const surface = acquireStudioBrushTextureStampSurface(
      alphaMap,
      mark.color,
      textureSurfaceFactory,
    );
    if (!surface) {
      throw new Error("studio-brush-texture-stamp-unavailable");
    }
    context.save();
    context.translate(mark.x, mark.y);
    context.rotate(mark.angleRadians);
    if ("imageSmoothingEnabled" in context) context.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
    context.drawImage(
      surface,
      0,
      0,
      alphaMap.size,
      alphaMap.size,
      -mark.radiusX,
      -mark.radiusY,
      mark.radiusX * 2,
      mark.radiusY * 2,
    );
    context.restore();
    return;
  }
  if (!mark.falloff) {
    if (context.fillStyle !== mark.color) context.fillStyle = mark.color;
    if (typeof context.ellipse === "function") {
      context.beginPath();
      context.ellipse(
        mark.x,
        mark.y,
        mark.radiusX,
        mark.radiusY,
        mark.angleRadians,
        0,
        TAU
      );
      context.fill();
      return;
    }
    if (mark.angleRadians === 0 && mark.radiusX === mark.radiusY) {
      context.beginPath();
      context.arc(mark.x, mark.y, mark.radiusX, 0, TAU);
      context.fill();
      return;
    }
    context.save();
    context.translate(mark.x, mark.y);
    context.rotate(mark.angleRadians);
    context.scale(1, mark.radiusY / mark.radiusX);
    context.beginPath();
    context.arc(0, 0, mark.radiusX, 0, TAU);
    context.fill();
    context.restore();
    return;
  }

  const surface = prepareStudioBrushSoftFalloffTintedStampSurface(
    mark.falloff.exponent,
    mark.color,
    textureSurfaceFactory,
    STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
    // The mark's versioned tone selects the mask ramp; the stamp cache keys on it, so a pinned
    // stroke and a legacy stroke of the same exponent never share a surface.
    mark.falloff.tone,
  );
  if (!surface) {
    throw new Error("studio-brush-soft-falloff-stamp-unavailable");
  }
  const overscan = (
    STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION
    + STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS * 2
  ) / STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION;
  const destinationRadiusX = mark.radiusX * overscan;
  const destinationRadiusY = mark.radiusY * overscan;
  context.save();
  context.translate(mark.x, mark.y);
  context.rotate(mark.angleRadians);
  if ("imageSmoothingEnabled" in context) context.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
  context.drawImage(
    surface,
    0,
    0,
    surface.width,
    surface.height,
    -destinationRadiusX,
    -destinationRadiusY,
    destinationRadiusX * 2,
    destinationRadiusY * 2,
  );
  context.restore();
}

/**
 * 종이 결을 캐리어 하나에 적분하는 사분면 표(단위 반지름, 가중치).
 *
 * `studio-brush-material-dynamics`의 `STUDIO_BRUSH_GRAIN_FOOTPRINT_SAMPLES`와 같은 배치다 —
 * 중심에 무게를 더 주고, 축 어깨가 방향성 결을 살리고, 대각이 캐리어 전체 맥동을 죽인다.
 */
/**
 * dab 안에 종이 결이 "보일" 최소 크기(종이 텍셀 수).
 *
 * 가장 성긴 프리셋(황목)의 최저 옥타브 셀이 128px 타일에서 16텍셀이고 가장 조밀한 것(세목)이
 * 4텍셀이라, 8텍셀이면 어떤 종이에서도 마루-골이 최소 한 번은 dab 안에 들어온다. 그보다 작은
 * dab은 종이 위에서 사실상 한 점이라 캐리어 스칼라와 결과가 같다.
 */
const STUDIO_PAPER_MIN_FOOTPRINT_TEXELS = 8;

/**
 * 종이 합성 맵 하나의 바이트(기본 128² Float32 = 64 KiB).
 *
 * 실제 팁 맵 크기가 아니라 고정 상수를 쓴다 — 한도가 팁 해상도에 따라 흔들리면 같은 획이
 * 브러시 설정에 따라 다른 dab에서 잘리게 되고, 무엇보다 라이브/재생 간 결정이 갈릴 수 있다.
 */
const PAPER_TIP_MAP_BYTES_ESTIMATE = 128 * 128 * 4;

const STUDIO_PAPER_FOOTPRINT_QUADRATURE = Object.freeze([
  [0, 0, 4],
  [-0.46, 0, 1],
  [0.46, 0, 1],
  [0, -0.46, 1],
  [0, 0.46, 1],
  [-0.32, -0.32, 0.75],
  [0.32, -0.32, 0.75],
  [-0.32, 0.32, 0.75],
  [0.32, 0.32, 0.75],
] as const);

/**
 * Flattens the existing dynamic-tip pipeline without changing any material channel. The returned
 * alpha intentionally excludes element opacity so both the coverage and frozen legacy compositors
 * can consume the exact same marks.
 */
export function planStudioDynamicBrushCoverageMarks(
  input: StudioDynamicBrushCoverageMarkPlanInput
): StudioDynamicBrushCoverageMarkPlan {
  const {
    dabVariations,
    dynamics,
    dynamicSeed,
    markBudget,
    stampGrid,
    stroke,
  } = input;
  const boundedMarkBudget = Number.isFinite(markBudget)
    ? Math.max(1, Math.floor(markBudget))
    : 1;
  const boundedR8AlphaMapByteBudget = Number.isFinite(
    input.r8AlphaMapByteBudget,
  )
    ? Math.max(
        0,
        Math.min(
          STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
          Math.floor(input.r8AlphaMapByteBudget as number),
        ),
      )
    : STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET;
  const r8GrainSource = dynamics.grain.amount > 0
    ? dynamics.grain.source
    : undefined;
  const r8GrainSampler = r8GrainSource
    ? resolveStudioBrushR8GrainSampler(r8GrainSource)
    : null;
  if (r8GrainSource && !r8GrainSampler) {
    // A collaborator or export worker without the exact verified decoded bytes must not silently
    // substitute procedural or identity grain: doing so would make one persisted stroke produce
    // different pixels in different realms.
    return { ok: false, reason: "r8-grain-unavailable" };
  }
  const coverageBudgetContract =
    resolveStudioDynamicBrushCoverageBudgetContract(
      input.materialIdentity,
      dynamics,
    );
  const paintRollerRibbonAuthority =
    coverageBudgetContract.specialistCarrier === "paint-roller-ribbon";
  const competitorSpecialtyRibbonAuthority =
    coverageBudgetContract.specialistCarrier === "competitor-specialty-ribbon";
  const professionalShelfRibbonAuthority =
    coverageBudgetContract.specialistCarrier === "professional-shelf-ribbon";
  const dryMediaUnionRibbonAuthority =
    r8GrainSampler === null
    && studioDryMediaUnionRibbonCarrierOwnsMaterial(
      input.materialIdentity,
      dynamics,
    );
  /*
   * T1 de-polygon: a core dry-media stroke leaves the union carrier only when its dynamics carry
   * the explicit fresh-authoring `dryMediaKernelProgram` marker. Marked strokes keep the same
   * bridged multi-lane dabs as ellipse/alpha-map primitives whose primary tip is a verified OSS
   * kernel bake (crayon wax / chalk powder / charcoal grit / pastel velvet / oil-pastel wax
   * film); every unmarked persisted stroke — causal or legacy — replays through the union
   * authority above byte-identically. Asset-backed R8 paper keeps its byte-authoritative composed
   * maps, so the kernel tip only engages when no R8 grain sampler is active — mirroring the union
   * authority gate above.
   */
  const dryMediaKernelTipMaterial = r8GrainSampler === null
    ? studioDryMediaKernelDabPathOwnsMaterial(
        input.materialIdentity,
        dynamics,
      )
    : null;
  const dryMediaUnionLeadingSourceDabsToSkip = Math.max(
    0,
    Math.floor(input.dryMediaUnionLeadingSourceDabsToSkip ?? 0),
  );
  if (
    dryMediaUnionLeadingSourceDabsToSkip > 0
    && !dryMediaUnionRibbonAuthority
  ) {
    return { ok: false, reason: "dry-media-bridge" };
  }
  const causalRenderBudget = isStudioDynamicBrushCausalDepositPipeline(
    dynamics.depositPipeline,
  )
    && dabVariations.length > 0
    ? planStudioDynamicBrushRenderBudget({
        settings: coverageBudgetContract.settings,
        dabCount: dabVariations.reduce(
          (maximum, variation) => Math.max(
            maximum,
            studioDynamicBrushDabVariationCount(variation),
          ),
          0,
        ),
        symmetryCount: dabVariations.length,
        fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
          input.materialIdentity,
          dabVariations.some(
            (variation) =>
              studioDynamicBrushDabVariationFirst(variation)?.index === 0,
            ),
        ),
        materialMarkMultiplier:
          coverageBudgetContract.materialMarkMultiplier,
        markBudget: boundedMarkBudget,
      })
    : null;
  const acceptedDabsPerVariation = causalRenderBudget
    ? causalRenderBudget.maxDabsPerVariation
    : Number.POSITIVE_INFINITY;
  const acceptedPrefixReceipt = causalRenderBudget?.acceptedPrefixReceipt;
  const acceptedDabVariations = acceptedPrefixReceipt
    ? dabVariations.map((variation) => (
        studioDynamicBrushDabVariationPrefix(
          variation,
          acceptedDabsPerVariation,
        )
      ))
    : dabVariations;
  let materialDabVariations = acceptedDabVariations;
  if (
    input.materialIdentity
    && !paintRollerRibbonAuthority
    && !competitorSpecialtyRibbonAuthority
    && !professionalShelfRibbonAuthority
  ) {
    const bridgedVariations: StudioDynamicBrushDabVariation[] = [];
    for (const variation of acceptedDabVariations) {
      const bridged = bridgeStudioDynamicDabVariationToDryMediaV1({
        materialIdentity: input.materialIdentity,
        seed: dynamicSeed,
        variation,
      });
      if (!bridged.ok) return { ok: false, reason: "dry-media-bridge" };
      bridgedVariations.push(bridged.variation);
    }
    materialDabVariations = bridgedVariations;
  }
  const tipDefinitions = [
    dynamics.tip,
    ...dynamics.tipLayers.map((layer) => layer.tip),
  ];
  const grainActive = dynamics.grain.amount > 0;
  const dualBrush = dynamics.dualBrush;
  const fullTextureAuthority = isStudioDynamicBrushCausalDepositPipeline(
    dynamics.depositPipeline,
  );
  const decomposedLegacyScreenDual = !fullTextureAuthority
    && studioBrushDualBrushIsActive(dualBrush)
    && dualBrush?.blendMode === "screen"
    && dynamics.tip.shape === "soft"
    && dynamics.tip.alphaMapBase64 === null
      ? {
          settings: dualBrush,
          tip: dualBrush.tip,
          alphaMap: buildStudioBrushTipAlphaMap(dualBrush.tip),
        }
      : null;
  const tipUsesAnalyticFalloff = tipDefinitions.map((tip, tipIndex) => (
    r8GrainSampler === null
    && tipUsesAnalyticSoftFalloff(
        tip,
        tipIndex === 0,
        dualBrush,
        fullTextureAuthority,
      )
  ));
  /*
   * Linear-accumulation opt-in (dryMediaKernelProgram idiom): only dynamics carrying the exact
   * fresh-authoring `softFalloffLinearProgram` pin mint the versioned tone onto their analytic
   * falloff marks. Every unpinned snapshot — every persisted pre-wave stroke — plans tone-less
   * marks and replays its historical sRGB skirt byte-identically. The guard re-validates the pin
   * here so a hand-built settings object can never reach the linear ramp with a malformed pin.
   */
  const softFalloffTone: StudioBrushSoftFalloffStampTone | undefined =
    isStudioSoftFalloffLinearAccumulationProgramPin(
      dynamics.softFalloffLinearProgram,
    )
      ? STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
      : undefined;
  const tipUsesEllipse = tipDefinitions.map((tip, tipIndex) => (
    !grainActive && (tipIndex === 0
      ? studioBrushDualTipUsesSolidEllipse(tip, dualBrush)
      : studioBrushTipUsesSolidEllipse(tip))
  ));
  const tipAlphaMaps = tipDefinitions.map((tip, tipIndex) => (
    dryMediaUnionRibbonAuthority
      || (tipIndex === 0 && dryMediaKernelTipMaterial !== null)
      || tipUsesEllipse[tipIndex]
      || tipUsesAnalyticFalloff[tipIndex]
      ? null
      : tipIndex === 0
        ? composeStudioBrushDualTipAlphaMap(tip, dualBrush)
        : buildStudioBrushTipAlphaMap(tip)
  ));
  if (r8GrainSampler) {
    const enabledMapBytesPerDab = tipAlphaMaps.reduce((total, map, tipIndex) => {
      if (tipIndex > 0 && (dynamics.tipLayers[tipIndex - 1]?.opacity ?? 0) <= 0) {
        return total;
      }
      return total + (map?.alphas.byteLength ?? 0);
    }, 0);
    const acceptedDabCount = materialDabVariations.reduce(
      (total, variation) => (
        total + studioDynamicBrushDabVariationCount(variation)
      ),
      0,
    );
    if (
      !Number.isSafeInteger(enabledMapBytesPerDab)
      || !Number.isSafeInteger(acceptedDabCount)
      || enabledMapBytesPerDab <= 0
      || acceptedDabCount > Math.floor(
        boundedR8AlphaMapByteBudget
          / enabledMapBytesPerDab,
      )
    ) {
      return { ok: false, reason: "r8-grain-memory-budget" };
    }
  }
  const marks: StudioDynamicBrushCoverageMark[] = [];

  /*
   * 종이 결 침착 — 획 전체에 타일 하나. dab마다 노이즈를 만들지 않는다.
   *
   * 타일과 그 정착 이득은 (종이, 강도)당 한 번 계산되어 FIFO 캐시에 남고, 이 아래의 샘플
   * 루프는 문서 좌표에서 바이리니어 4-탭 조회만 한다. 비활성 브러시(잉크·기술펜)는 타일이
   * 아예 null이라 `resolveStudioPaperGranulationAlphaMultiplierAt`가 즉시 1을 돌려주고,
   * 마크 알파는 배선 전과 비트 단위로 같다.
   */
  const paperResponse = input.paper?.response;
  const paperModel = input.paper?.model;
  const paperTile: StudioPaperGranulationTile | null =
    paperResponse && studioPaperGranulationIsActive(paperResponse)
      ? acquireStudioPaperGranulationTile(
          input.paper?.surface ?? resolveStudioDocumentPaperSurface(),
          paperResponse,
          paperModel,
        )
      : null;
  const paperScale = paperResponse?.scale ?? 1;
  /**
   * 이 획이 교정된 substrate를 타는가. 키가 없으면 아래 조회는 **예전 함수 그대로**라
   * 기존 문서의 픽셀이 한 비트도 바뀌지 않는다.
   */
  const paperContactTooth = studioPaperUsesContactTooth(paperModel) && paperTile !== null;
  const paperMedium = paperContactTooth ? input.paper?.medium ?? null : null;
  /**
   * 지금 찍는 dab의 필압. `opacity × flow`는 이 파일이 이미 "RAW pressure-resolved alpha"라고
   * 부르는 값이다(아래 kernel tip 밴드 폭이 같은 값을 쓴다). dab 루프가 grainAt 클로저보다
   * 안쪽이라 인자로 넘길 수 없어, `paperCompositionDabIndex`와 같은 방식으로 가변 변수를 쓴다.
   */
  let paperContactPressure = STUDIO_PAPER_SUBSTRATE_FALLBACK_PRESSURE;
  const paperMultiplierAt = (x: number, y: number): number => (
    paperContactTooth
      ? resolveStudioPaperContactToothAlphaMultiplierAt(
          paperTile,
          x,
          y,
          paperScale,
          paperMedium,
          paperContactPressure,
        )
      : resolveStudioPaperGranulationAlphaMultiplierAt(paperTile, x, y, paperScale)
  );
  /*
   * 커널 팁 품질 하한(ADR 0010 손맛 우선): contact-tooth granulation이 깊은 종이 골에서
   * multiplier≈0을 반환하면 짧은 획의 소수 dab이 전부 스킵 구간에 빠져 mark.alpha가
   * 가시 임계 아래로 떨어지고, 저장 문서에서 획 자체가 사라진다(실측 간헐 실패 —
   * 패리티 리포트 §단획 간헐 실패). STUDIO_KERNEL_TIP_MIN_VISIBLE_SIZE 크기 하한은
   * 알파 스킵을 막지 못하므로, 커널 팁 재질의 스칼라 종이 이득에만 최소치를 보장한다.
   * 라이브·커밋·내보내기가 같은 플래너를 공유하므로 세 표면이 함께 이동해 재생 일관성은 유지된다.
   */
  const kernelTipPaperGainFloor = dryMediaKernelTipMaterial !== null ? 0.35 : 0;
  const paperGainFor = (x: number, y: number): number => (
    Math.max(paperMultiplierAt(x, y), kernelTipPaperGainFloor)
  );
  /**
   * 종이 결이 dab **안쪽**까지 들어가는 마지막 dab 인덱스(배타).
   *
   * 예산을 "이번 호출에서 남은 바이트"로 잡으면 라이브 증분 계획과 전체 재생이 서로 다른
   * 지점에서 예산을 소진해 같은 획이 두 경로에서 다른 픽셀이 된다. 그래서 한도를 **dab
   * 인덱스**로 고정한다 — 인덱스는 스트로크 안에서 안정적이라 접미사만 계획하든 전체를
   * 계획하든 같은 dab이 같은 결정을 받는다.
   */
  const paperTipCompositionDabCeiling = paperTile
    ? Math.floor(STUDIO_PAPER_TIP_COMPOSITION_BYTE_BUDGET / PAPER_TIP_MAP_BYTES_ESTIMATE)
    : 0;
  /** 지금 처리 중인 dab의 스트로크 내 인덱스. 위 한도와 비교하는 유일한 값이다. */
  let paperCompositionDabIndex = 0;
  /**
   * 캐리어 전체를 한 스칼라로 눌러야 하는 마크(솔리드 타원·해석적 falloff·전체 텍스처)용
   * 종이 이득. 중심 한 점만 읽으면 dab이 종이 셀을 지날 때마다 캐리어 전체가 밝아졌다
   * 어두워져 원형 격자가 드러나므로, 기존 절차적 grain과 같은 9탭 사분면 적분을 쓴다.
   */
  const paperAcrossFootprint = (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    angleRadians: number,
  ): number => {
    if (!paperTile) return 1;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    let weighted = 0;
    let totalWeight = 0;
    for (const [unitX, unitY, weight] of STUDIO_PAPER_FOOTPRINT_QUADRATURE) {
      const localX = unitX * radiusX;
      const localY = unitY * radiusY;
      weighted += paperMultiplierAt(
        x + localX * cosine - localY * sine,
        y + localX * sine + localY * cosine,
      ) * weight;
      totalWeight += weight;
    }
    return Math.max(weighted / totalWeight, kernelTipPaperGainFloor);
  };

  const appendMark = (mark: StudioDynamicBrushCoverageMark): boolean => {
    if (!markIsValid(mark)) return false;
    if (mark.alpha <= 0) return true;
    if (marks.length >= boundedMarkBudget) return false;
    marks.push(mark);
    return true;
  };

  for (const [variationIndex, dabs] of materialDabVariations.entries()) {
    const variationMarksStart = marks.length;
    const visiblePrimaryDabs: StudioDynamicBrushDab[] = [];
    const visiblePrimaryMarks: StudioDynamicBrushCoverageMark[] = [];
    const suppliedOrigin = input.strokeOrigins?.[variationIndex];
    const firstDab = studioDynamicBrushDabVariationFirst(dabs);
    const strokeOriginX = suppliedOrigin?.x ?? firstDab?.sourceX ?? firstDab?.x ?? 0;
    const strokeOriginY = suppliedOrigin?.y ?? firstDab?.sourceY ?? firstDab?.y ?? 0;
    // 절차적 grain(브러시가 들고 다니는 결)과 종이 결(캔버스에 붙어 있는 결)은 서로 독립이라
    // 곱으로 합성한다. 둘 다 꺼져 있으면 상수 1 클로저라 호출 비용도 없다.
    const proceduralGrainActive = dynamics.grain.amount > 0;
    const grainAt = !proceduralGrainActive && !paperTile
      ? () => 1
      : (x: number, y: number) => (
          (proceduralGrainActive
            ? resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
                x,
                y,
                strokeOriginX,
                strokeOriginY,
                dynamicSeed,
                dynamics.grain
              )
            : 1)
          * paperGainFor(x, y)
        );
    const grainAcrossFootprint = (
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      angleRadians: number,
    ) => (
      resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
        x,
        y,
        radiusX,
        radiusY,
        angleRadians,
        strokeOriginX,
        strokeOriginY,
        dynamicSeed,
        dynamics.grain,
      ) * paperAcrossFootprint(x, y, radiusX, radiusY, angleRadians)
    );
    const appendTipDab = (
      // Kernel-authority primary dabs carry their causal identity (index, arc distance); composed
      // layer dabs do not — and the kernel material is gated to tipIndex 0, so the fallbacks below
      // are type-level only (typecheck fix, runtime-identical).
      composedDab: StudioBrushComposableDab & Readonly<{
        index?: number;
        distanceFromStrokeStart?: number;
      }>,
      tip: NormalizedStudioBrushTipSettings,
      tipIndex: number,
      dabColor: string
    ): "ok" | "invalid-mark" | "mark-budget" => {
      /*
       * Kernel dab authority (T1): the primary dry-media tip is a verified OSS material bake
       * resolved per dab. The stable expanded dab index rotates a small immutable variant set, so
       * live suffix planning, pointer-up replay and SVG export select identical maps while
       * neighbouring fibres never tile the same grain orientation. The deposition alpha is
       * linearized per material so the overlapping fibre lanes reach the historical dry-media bed
       * density instead of reading as a lighter half-tone of it.
       */
      const kernelTipMaterial = tipIndex === 0 ? dryMediaKernelTipMaterial : null;
      // 접촉면 깊이는 이 dab의 필압에서 온다. grainAt/paperAcrossFootprint가 읽는다.
      paperContactPressure = clampAlpha(composedDab.opacity * composedDab.flow);
      const depositionAlpha = kernelTipMaterial
        ? clampAlpha(linearizeStudioDryMediaKernelDepositionAlpha(
            kernelTipMaterial,
            composedDab.opacity * composedDab.flow,
          ))
        : clampAlpha(composedDab.opacity * composedDab.flow);
      if (depositionAlpha <= 0) return "ok";
      const tipAlphaMap = kernelTipMaterial
        ? resolveStudioDryMediaKernelTipAlphaMap(
            kernelTipMaterial,
            dynamics.tip,
            // The resolver's own non-safe-integer fallback is 0, so the type-level default is
            // behavior-identical (primary kernel dabs always carry their causal index).
            composedDab.index ?? 0,
            // Band width follows the RAW pressure-resolved alpha (the union carrier's
            // coverageHalfWidth input), not the linearized deposition alpha.
            clampAlpha(composedDab.opacity * composedDab.flow),
            // Aspect-compensated grain: the bake pre-compresses its noise along map X by this
            // stamp's stretch ratio band, so the ellipse stamp lands isotropic pigment grain
            // instead of travel-aligned streaks. Banded wax ignores it by contract.
            composedDab.roundness,
          )
        : tipAlphaMaps[tipIndex] ?? null;
      if (r8GrainSampler) {
        if (!tipAlphaMap) return "invalid-mark";
        const radiusX = Math.max(0.25, composedDab.size / 2);
        const radiusY = radiusX * composedDab.roundness;
        const angleRadians = composedDab.angle * Math.PI / 180;
        const composedAlphaMap = composeStudioBrushR8TipPaperAlphaMap({
          tip: tipAlphaMap,
          sampler: r8GrainSampler,
          grain: dynamics.grain,
          centerX: composedDab.x,
          centerY: composedDab.y,
          radiusX,
          radiusY,
          angleRadians,
          strokeOriginX,
          strokeOriginY,
          strokeSeed: dynamicSeed,
        });
        if (!composedAlphaMap) return "invalid-mark";
        const mark: StudioDynamicBrushCoverageMark = {
          x: composedDab.x,
          y: composedDab.y,
          radiusX,
          radiusY,
          angleRadians,
          alpha: depositionAlpha,
          color: dabColor,
          texture: {
            kind: "alpha-map",
            alphaMap: composedAlphaMap,
          },
        };
        if (!markIsValid(mark)) return "invalid-mark";
        return appendMark(mark) ? "ok" : "mark-budget";
      }
      const appendSampledTipMap = (
        sampledDab: StudioBrushComposableDab,
        alphaMap: StudioBrushTipAlphaMap,
      ): "ok" | "invalid-mark" | "mark-budget" => {
        let failure: "invalid-mark" | "mark-budget" | null = null;
        visitStudioBrushTipStampSamples(
          sampledDab,
          alphaMap,
          (dx, dy, alpha, radius) => {
            if (failure) return;
            const sampleX = sampledDab.x + dx;
            const sampleY = sampledDab.y + dy;
            const sampledMark: StudioDynamicBrushCoverageMark = {
              x: sampleX,
              y: sampleY,
              radiusX: radius,
              radiusY: radius,
              angleRadians: 0,
              alpha: clampAlpha(
                depositionAlpha * alpha * grainAt(sampleX, sampleY),
              ),
              color: dabColor,
            };
            if (!markIsValid(sampledMark)) {
              failure = "invalid-mark";
            } else if (!appendMark(sampledMark)) {
              failure = "mark-budget";
            }
          },
          { grid: stampGrid },
        );
        return failure ?? "ok";
      };
      if (
        !tipAlphaMap
        || (
          !kernelTipMaterial
          && (tipUsesEllipse[tipIndex] || tipUsesAnalyticFalloff[tipIndex])
        )
      ) {
        const radiusX = Math.max(0.25, composedDab.size / 2);
        const radiusY = radiusX * composedDab.roundness;
        const angleRadians = composedDab.angle * Math.PI / 180;
        const mark = {
          x: composedDab.x,
          y: composedDab.y,
          radiusX,
          radiusY,
          angleRadians,
          alpha: clampAlpha(
            depositionAlpha * grainAcrossFootprint(
              composedDab.x,
              composedDab.y,
              radiusX,
              radiusY,
              angleRadians,
            ),
          ),
          color: dabColor,
          ...(tipUsesAnalyticFalloff[tipIndex]
            ? {
                falloff: {
                  kind: "analytic-radial" as const,
                  exponent: proceduralSoftTipFalloffExponent(tip),
                  ...(softFalloffTone ? { tone: softFalloffTone } : {}),
                },
              }
            : {}),
        };
        if (!markIsValid(mark)) return "invalid-mark";
        if (!appendMark(mark)) return "mark-budget";
        if (tipIndex !== 0 || !decomposedLegacyScreenDual) return "ok";

        const secondaryDab: StudioBrushComposableDab = {
          ...composedDab,
          size: Math.max(
            0.05,
            composedDab.size * decomposedLegacyScreenDual.settings.sizeRatio,
          ),
        };
        const secondaryRadiusX = Math.max(0.25, secondaryDab.size / 2);
        const secondaryRadiusY = secondaryRadiusX * secondaryDab.roundness;
        const secondaryAngleRadians = secondaryDab.angle * Math.PI / 180;
        const secondaryTip = decomposedLegacyScreenDual.tip;
        const secondaryAnalytic = secondaryTip.shape === "soft"
          && secondaryTip.alphaMapBase64 === null;
        if (secondaryAnalytic || studioBrushTipUsesSolidEllipse(secondaryTip)) {
          const secondaryMark: StudioDynamicBrushCoverageMark = {
            x: secondaryDab.x,
            y: secondaryDab.y,
            radiusX: secondaryRadiusX,
            radiusY: secondaryRadiusY,
            angleRadians: secondaryAngleRadians,
            alpha: clampAlpha(
              depositionAlpha * grainAcrossFootprint(
                secondaryDab.x,
                secondaryDab.y,
                secondaryRadiusX,
                secondaryRadiusY,
                secondaryAngleRadians,
              ),
            ),
            color: dabColor,
            ...(secondaryAnalytic
              ? {
                  falloff: {
                    kind: "analytic-radial" as const,
                    exponent: proceduralSoftTipFalloffExponent(secondaryTip),
                    ...(softFalloffTone ? { tone: softFalloffTone } : {}),
                  },
                }
              : {}),
          };
          if (!markIsValid(secondaryMark)) return "invalid-mark";
          return appendMark(secondaryMark) ? "ok" : "mark-budget";
        }
        return appendSampledTipMap(
          secondaryDab,
          decomposedLegacyScreenDual.alphaMap,
        );
      }

      if (!fullTextureAuthority) {
        return appendSampledTipMap(composedDab, tipAlphaMap);
      }

      const radiusX = Math.max(0.25, composedDab.size / 2);
      const radiusY = radiusX * composedDab.roundness;
      const angleRadians = composedDab.angle * Math.PI / 180;
      /*
       * 종이 결은 dab보다 잔 구조라 캐리어 스칼라로는 표현되지 않는다 — 알파맵 안으로 넣는다.
       *
       * 스칼라 하나만 곱하면 dab이 종이 골을 지날 때 *통째로* 진해졌다 옅어질 뿐 획 내부는
       * 그대로 매끈하다. R8 페이퍼 에셋 경로가 같은 이유로 같은 자리에서 맵을 합성하며,
       * 여기서는 절차적 종이 타일로 같은 일을 한다. 합성이 예산을 넘어가면(아주 긴 획)
       * 아래 캐리어 스칼라로 내려앉아 질감만 약해지고 획은 그대로 남는다.
       */
      let texturedAlphaMap = tipAlphaMap;
      // dab이 종이 셀 하나보다 작으면 맵 안에 결이 한 마루도 들어오지 않는다. 그 구간에서는
      // 캐리어 스칼라가 수학적으로 같은 답이면서 텍셀 루프를 통째로 아낀다.
      const paperFitsInsideDab = paperTile !== null
        && 2 * Math.min(radiusX, radiusY) >= STUDIO_PAPER_MIN_FOOTPRINT_TEXELS * paperScale;
      if (paperTile && paperFitsInsideDab && paperCompositionDabIndex < paperTipCompositionDabCeiling) {
        const composed = composeStudioPaperTipAlphaMap({
          tip: tipAlphaMap,
          tile: paperTile,
          scale: paperScale,
          centerX: composedDab.x,
          centerY: composedDab.y,
          radiusX,
          radiusY,
          angleRadians,
          medium: paperMedium,
          pressure: paperContactPressure,
        });
        if (composed) texturedAlphaMap = composed;
        if (composed && kernelTipPaperGainFloor > 0) {
          /*
           * 조성 맵의 골 텍셀은 0까지 가라앉는다 — 스칼라 하한만으로는 짧은 획의 dab이
           * 통째로 스킵 구간에 빠지는 것을 막지 못한다(실측 플레이크). 원본 팁 맵 방향으로
           * 하한 비율만큼 블렌드해 최소 가시 기반을 보장하면서 상대적 종이 결은 유지한다.
           */
          const floor = kernelTipPaperGainFloor;
          const lifted = {
            ...composed,
            alphas: composed.alphas.map((texel, texelIndex) => (
              Math.max(texel, tipAlphaMap.alphas[texelIndex]! * floor)
            )),
          };
          texturedAlphaMap = lifted;
        }
      }
      const strokeToothMultiplier = kernelTipMaterial
        ? studioDryMediaKernelStrokeToothMultiplier(
            kernelTipMaterial,
            {
              index: composedDab.index ?? 0,
              x: composedDab.x,
              y: composedDab.y,
              ...(composedDab.distanceFromStrokeStart !== undefined
                ? {
                    distanceFromStrokeStart:
                      composedDab.distanceFromStrokeStart,
                  }
                : {}),
            },
            strokeOriginX,
            strokeOriginY,
            dynamicSeed,
          )
        : 1;
      /*
       * 커널 팁 가시 알파 하한(ADR 0010): 선형화된 침착 알파에 stroke-anchored tooth 승수를
       * 곱하면 단일 dab(탭·빠른 짧은 터치)이 0.03 수준까지 내려가 저장 문서에서 획이
       * 사라진다(실측 — 패리티 리포트 §단획 실피 재정성). 겹침 코어는 이미 하한 위라
       * 무영향이고, 어떤 prefix 길이에서도 같은 값이라 라이브/커밋이 함께 이동한다.
       *
       * 하한은 tooth 계약과 충돌하지 않게 획 진행에 따라 pore를 따라간다: tooth 필드의 완전
       * pore는 "커버리지 플로어 아래로 내려가 종이로 읽힌다"가 명시 계약인데, 획 전체에
       * 평평한 0.12 하한을 두면 겹치는 fibre 5–7개가 pore 구간을 0.35–0.5 중간톤으로 메워
       * 측정 tooth 분산이 union 캐리어 아래로 떨어진다(픽셀 게이트 실측). 탭·짧은 터치의
       * 가시성은 획 시작 램프가 그대로 보장하고(시작 8px 안에서는 하한 전액), 그 너머의
       * 완전 pore만 하한이 tooth 배율로 줄어 종이가 실제로 드러난다. dab 정체성만의 순수
       * 함수이므로 prefix 길이와 무관하게 같은 값이다(라이브/커밋 동시 이동).
       */
      const texturedMarkAlpha = clampAlpha(
        Math.max(
          depositionAlpha
            * (paperFitsInsideDab
              ? resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
                  composedDab.x,
                  composedDab.y,
                  radiusX,
                  radiusY,
                  angleRadians,
                  strokeOriginX,
                  strokeOriginY,
                  dynamicSeed,
                  dynamics.grain,
                )
              : grainAcrossFootprint(
                  composedDab.x,
                  composedDab.y,
                  radiusX,
                  radiusY,
                  angleRadians,
                ))
            * strokeToothMultiplier,
          kernelTipMaterial
            ? STUDIO_KERNEL_TIP_MIN_VISIBLE_ALPHA * Math.max(
                strokeToothMultiplier,
                1 - (composedDab.distanceFromStrokeStart ?? 0)
                  / STUDIO_KERNEL_TIP_TAP_FLOOR_REACH_PX,
              )
            : 0,
        ),
      );
      const texturedMark: StudioDynamicBrushCoverageMark = {
        x: composedDab.x,
        y: composedDab.y,
        radiusX,
        radiusY,
        angleRadians,
        // Canvas and SVG consume the same footprint-integrated grain scalar. This removes the
        // carrier-wide light/dark pulses caused by one centre sample while a future R8 shader
        // evolves the same deterministic grain into per-fragment paper tooth.
        // 종이 이득이 알파맵 텍셀마다 들어가는 마크에서는 캐리어에 한 번 더 곱하지 않는다 —
        // 두 번 곱하면 같은 물리를 제곱해 획이 근거 없이 어두워진다. 판정 기준은 "합성이
        // 성공했는가"가 아니라 "이 dab이 종이를 맵 안에 담을 수 있는가"다: 예산 소진으로
        // 합성을 건너뛰더라도 알파는 그대로 남아 질감만 옅어지고 획의 농도는 흔들리지 않는다.
        alpha: texturedMarkAlpha,
                color: dabColor,
        texture: {
          kind: "alpha-map",
          alphaMap: texturedAlphaMap,
        },
      };
      if (!markIsValid(texturedMark)) return "invalid-mark";
      return appendMark(texturedMark) ? "ok" : "mark-budget";
    };

    // 커널 팁 가시성 하한: 커널 팁은 텍스처 알파맵이라 dab이 서브픽셀이면 커버리지가 0으로
    // 무너진다(빠른 짧은 터치가 완전 투명 획이 되는 실패 모드 — 패밀리 형제인 솔리드 캐리어는
    // 같은 크기에서도 보인다). 크기만의 순수 함수로 적용한다 — dab 수 조건을 붙이면 라이브
    // prefix(적은 dab)와 커밋 플랜(전체 dab)이 다른 플로어를 적용해 live→released 무게중심이
    // 흔들린다. dab당 결정적이므로 어떤 prefix 길이에서도 같은 마크가 나온다.
    const kernelTipVisibilityFloor = dryMediaKernelTipMaterial !== null
      ? STUDIO_KERNEL_TIP_MIN_VISIBLE_SIZE
      : null;

    for (const dab of studioDynamicBrushDabsInVariation(dabs)) {
      paperCompositionDabIndex = dab.index;
      // appendTipDab 안쪽은 합성 dab으로 다시 덮어쓴다. 여기 값은 그 경로를 타지 않는
      // 직결 union/폴백 dab이 읽는 필압이다.
      paperContactPressure = clampAlpha(dab.opacity * dab.flow);
      const dabColor = resolveNormalizedStudioBrushDabColor(
        stroke,
        dab.index,
        dynamicSeed,
        dynamics.colorDynamics
      );
      if (dryMediaUnionRibbonAuthority) {
        /*
         * The connected dry-media carrier consumes only the pressure-resolved footprint,
         * deposition alpha and colour. It deliberately discards the transient per-dab bitmap tip
         * after turning its five causal fibres into one non-zero union. Building and retaining a
         * full texture mark for every fibre before immediately throwing it away made a 2k input
         * stroke allocate tens of thousands of short-lived objects and blocked the pointer thread.
         *
         * Lower the exact same authoritative channels directly into the union source mark. This
         * is not a lower-quality approximation: the old path's texture/falloff fields never
         * reached the union result, and radius/alpha/colour use the identical equations below.
         * Asset-backed R8 paper is excluded by the authority gate above because its per-fragment
         * bytes must remain authoritative rather than being collapsed to a scalar.
         */
        const depositionAlpha = clampAlpha(dab.opacity * dab.flow);
        if (depositionAlpha <= 0) continue;
        const radiusX = Math.max(0.25, dab.size / 2);
        const radiusY = radiusX * dab.roundness;
        const angleRadians = dab.angle * Math.PI / 180;
        const directMark: StudioDynamicBrushCoverageMark = {
          x: dab.x,
          y: dab.y,
          radiusX,
          radiusY,
          angleRadians,
          alpha: clampAlpha(
            depositionAlpha * grainAcrossFootprint(
              dab.x,
              dab.y,
              radiusX,
              radiusY,
              angleRadians,
            ),
          ),
          color: dabColor,
        };
        if (!markIsValid(directMark)) {
          return { ok: false, reason: "invalid-mark" };
        }
        if (!appendMark(directMark)) {
          return { ok: false, reason: "mark-budget" };
        }
        visiblePrimaryDabs.push(dab);
        visiblePrimaryMarks.push(directMark);
        continue;
      }
      const primaryMarkStart = marks.length;
      const primaryResult = appendTipDab(
        kernelTipVisibilityFloor !== null && dab.size < kernelTipVisibilityFloor
          ? { ...dab, size: kernelTipVisibilityFloor }
          : dab,
        dynamics.tip,
        0,
        dabColor,
      );
      if (primaryResult !== "ok") return { ok: false, reason: primaryResult };
      if (marks.length >= primaryMarkStart + 1) {
        visiblePrimaryDabs.push(dab);
        visiblePrimaryMarks.push(marks[primaryMarkStart]!);
      }
      if (
        !professionalShelfRibbonAuthority
        && !competitorSpecialtyRibbonAuthority
      ) {
        for (const [layerIndex, layer] of dynamics.tipLayers.entries()) {
          const composedDab = composeNormalizedStudioBrushTipLayerDab(dab, layer);
          if (!composedDab) continue;
          const layerResult = appendTipDab(
            composedDab,
            layer.tip,
            layerIndex + 1,
            dabColor
          );
          if (layerResult !== "ok") return { ok: false, reason: layerResult };
        }
      }
    }
    const originAnchor = planStudioSplatterOriginAnchorDab(
      input.materialIdentity,
      firstDab,
    );
    if (originAnchor) {
      // 앵커도 자기 인덱스로 판정한다. 위 루프가 남긴 "마지막 dab 인덱스"를 물려받으면
      // 접미사만 계획하는 라이브와 전체를 계획하는 재생이 서로 다른 값을 보게 되고,
      // 같은 앵커가 경로마다 다른 종이 결을 받는다.
      paperCompositionDabIndex = originAnchor.index;
      const anchorColor = resolveNormalizedStudioBrushDabColor(
        stroke,
        originAnchor.index,
        dynamicSeed,
        dynamics.colorDynamics,
      );
      const anchorResult = appendTipDab(
        originAnchor,
        dynamics.tip,
        0,
        anchorColor,
      );
      if (anchorResult !== "ok") {
        return { ok: false, reason: anchorResult };
      }
    }
    const variationMarks = marks.slice(variationMarksStart);
    const competitorSpecialtyRibbonPlan =
      planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: visiblePrimaryDabs,
        marks: visiblePrimaryMarks,
        materialIdentity: input.materialIdentity,
        dynamics,
      });
    if (competitorSpecialtyRibbonPlan.applied) {
      marks.splice(
        variationMarksStart,
        variationMarks.length,
        ...competitorSpecialtyRibbonPlan.marks,
      );
      continue;
    }
    if (competitorSpecialtyRibbonAuthority) {
      return { ok: false, reason: "competitor-specialty-carrier" };
    }
    const professionalShelfRibbonPlan =
      planStudioProfessionalShelfRibbonCarrier({
        dabs: visiblePrimaryDabs,
        marks: visiblePrimaryMarks,
        materialIdentity: input.materialIdentity,
        dynamics,
      });
    if (professionalShelfRibbonPlan.applied) {
      marks.splice(
        variationMarksStart,
        variationMarks.length,
        ...professionalShelfRibbonPlan.marks,
      );
      continue;
    }
    if (professionalShelfRibbonAuthority) {
      return { ok: false, reason: "professional-shelf-carrier" };
    }
    const dryMediaRibbonPlan = planStudioDryMediaUnionRibbonCarrier({
      dabs: visiblePrimaryDabs,
      marks: variationMarks,
      materialIdentity: input.materialIdentity,
      dynamics,
      ...(dryMediaUnionLeadingSourceDabsToSkip > 0
        ? {
            skipLeadingMarks:
              dryMediaUnionLeadingSourceDabsToSkip
              * studioDryMediaDynamicBridgeMarkMultiplier(
                input.materialIdentity,
              ),
          }
        : {}),
    });
    if (dryMediaRibbonPlan.applied) {
      marks.splice(
        variationMarksStart,
        variationMarks.length,
        ...dryMediaRibbonPlan.marks,
      );
      continue;
    }
    if (dryMediaUnionRibbonAuthority) {
      // A core dry medium must never degrade back to visible circular carriers. The runtime can
      // retain the previous frame and report its existing fail-closed material-plan result.
      return { ok: false, reason: "dry-media-bridge" };
    }
    const ribbonPlan = planStudioFlatNibRibbonCarrier({
      dabs: visiblePrimaryDabs,
      marks: variationMarks,
      materialIdentity: input.materialIdentity,
      dynamics,
    });
    if (ribbonPlan.applied) {
      marks.splice(
        variationMarksStart,
        variationMarks.length,
        ...ribbonPlan.marks,
      );
      continue;
    }
    const paintRollerPlan = planStudioPaintRollerRibbonCarrier({
      dabs: visiblePrimaryDabs,
      marks: variationMarks,
      materialIdentity: input.materialIdentity,
      dynamics,
    });
    if (paintRollerPlan.applied) {
      marks.splice(
        variationMarksStart,
        variationMarks.length,
        ...paintRollerPlan.marks,
      );
    }
  }
  const r8TextureAlphaMapReceipt = r8GrainSampler
    ? (() => {
        const uniqueMaps = new Set<StudioBrushTipAlphaMap>();
        let alphaMapBytes = 0;
        for (const plannedMark of marks) {
          const alphaMap = plannedMark.texture?.alphaMap;
          if (!alphaMap || uniqueMaps.has(alphaMap)) continue;
          uniqueMaps.add(alphaMap);
          alphaMapBytes += alphaMap.alphas.byteLength;
        }
        return {
          policy: "r8-texture-alpha-map-bytes-v1" as const,
          uniqueAlphaMapCount: uniqueMaps.size,
          alphaMapBytes,
          alphaMapByteBudget: boundedR8AlphaMapByteBudget,
        };
      })()
    : undefined;
  return {
    ok: true,
    marks,
    ...(acceptedPrefixReceipt ? { acceptedPrefixReceipt } : {}),
    ...(r8TextureAlphaMapReceipt ? { r8TextureAlphaMapReceipt } : {}),
  };
}

export function planStudioDynamicBrushCoverageAndLegacyMarks(
  input: StudioDynamicBrushCoverageMarkPlanInput
): StudioDynamicBrushCoverageAndLegacyMarkPlan {
  const coveragePlan = planStudioDynamicBrushCoverageMarks(input);
  if (coveragePlan.ok) {
    return { coveragePlan, legacyMarks: coveragePlan.marks };
  }
  if (
    isStudioDynamicBrushCausalDepositPipeline(
      input.dynamics.depositPipeline,
    )
  ) {
    return { coveragePlan, legacyMarks: [] };
  }
  const legacyPlan = planStudioDynamicBrushCoverageMarks({
    ...input,
    markBudget: Number.MAX_SAFE_INTEGER,
  });
  return {
    coveragePlan,
    legacyMarks: legacyPlan.ok ? legacyPlan.marks : [],
  };
}

function markBounds(mark: StudioDynamicBrushCoverageMark): MarkBounds {
  if (mark.ribbon) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const points of mark.ribbon.polygons) {
      for (let index = 0; index < points.length; index += 2) {
        const x = points[index]!;
        const y = points[index + 1]!;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return { minX, minY, maxX, maxY };
  }
  const cosine = Math.cos(mark.angleRadians);
  const sine = Math.sin(mark.angleRadians);
  // Alpha maps occupy their complete square/rectangular footprint. Ellipse equations under-bound
  // opaque corner texels after rotation and could omit the neighbouring coverage tile.
  const halfWidth = mark.texture
    ? Math.abs(mark.radiusX * cosine) + Math.abs(mark.radiusY * sine)
    : Math.hypot(mark.radiusX * cosine, mark.radiusY * sine);
  const halfHeight = mark.texture
    ? Math.abs(mark.radiusX * sine) + Math.abs(mark.radiusY * cosine)
    : Math.hypot(mark.radiusX * sine, mark.radiusY * cosine);
  return {
    minX: mark.x - halfWidth,
    minY: mark.y - halfHeight,
    maxX: mark.x + halfWidth,
    maxY: mark.y + halfHeight,
  };
}

function destinationPhysicalScale(
  context: StudioDynamicBrushCoverageDestinationContext
): number {
  try {
    const transform = context._context?.getTransform()
      ?? context.getTransform?.();
    if (!transform) return 1;
    const scaleX = Math.hypot(transform.a, transform.b);
    const scaleY = Math.hypot(transform.c, transform.d);
    const scale = Math.max(scaleX, scaleY);
    return finitePositive(scale) ? scale : 1;
  } catch {
    return 1;
  }
}

function candidateScales(
  context: StudioDynamicBrushCoverageDestinationContext,
  _activeDraft: boolean
): readonly number[] {
  const maximumQualityScale = 4;
  // 텍스처 스탬프는 타일 래스터를 한 번만 리샘플해야 피크 알파가 살아남는다(ADR 0010).
  // 1× 미만 타일은 조판 뒤 확대 블릿이라 겹침 코어가 무너진다 — 실측 0.8×에서 sumAlpha
  // 216→81(2026-08-24 패리티 리포트 §8). 그래서 하한은 물리 배율이 아니라 1×이다.
  const minimum = 1;
  const physicalScale = destinationPhysicalScale(context);
  // Below 0.75x we oversample and let the destination transform downsample. This spends extra
  // pixels but never lowers output quality or changes document-space geometry.
  //
  // Above 4x, keeping a 1:1 physical backing store can multiply a stroke's tile count without
  // bound. Cap the first attempt at the renderer's quality ceiling, then progressively lower only
  // the *offscreen raster resolution* when the sparse-tile/reference budget cannot admit it.
  // Geometry, dab alpha and the final stroke-local opacity composite remain unchanged at every
  // candidate, so budget pressure cannot turn bounded-flow-v2 into legacy per-dab-opacity pixels.
  const wanted = Math.min(
    maximumQualityScale,
    Math.max(minimum, physicalScale),
  );
  const candidates = [wanted, 2, 1, minimum];
  return candidates.filter((scale, index) => (
    scale <= wanted
    && candidates.findIndex((candidate) => Math.abs(candidate - scale) < 1e-9) === index
  ));
}

interface MarkTileRange {
  readonly minTileX: number;
  readonly minTileY: number;
  readonly maxTileX: number;
  readonly maxTileY: number;
  readonly columns: number;
  readonly rows: number;
}

function markTileRangeAtScale(
  mark: StudioDynamicBrushCoverageMark,
  scale: number,
): MarkTileRange | null {
  const bounds = markBounds(mark);
  const tilePixels = STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE;
  const antialiasPadding = 1 / scale;
  const minTileX = Math.floor(
    (bounds.minX - antialiasPadding) * scale / tilePixels,
  );
  const minTileY = Math.floor(
    (bounds.minY - antialiasPadding) * scale / tilePixels,
  );
  const maxTileX = Math.floor(
    (bounds.maxX + antialiasPadding) * scale / tilePixels,
  );
  const maxTileY = Math.floor(
    (bounds.maxY + antialiasPadding) * scale / tilePixels,
  );
  const columns = maxTileX - minTileX + 1;
  const rows = maxTileY - minTileY + 1;
  if (
    !Number.isSafeInteger(columns)
    || !Number.isSafeInteger(rows)
    || columns <= 0
    || rows <= 0
    || !Number.isSafeInteger(columns * rows)
  ) return null;
  return {
    minTileX,
    minTileY,
    maxTileX,
    maxTileY,
    columns,
    rows,
  };
}

function planTilesAtScale(
  marks: readonly StudioDynamicBrushCoverageMark[],
  scale: number,
  byteBudget: number,
  tileMarkReferenceBudget: number
): TilePlan | "surface-budget" | "tile-mark-budget" {
  const tilePixels = STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE;
  const bleedPixels = STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS;
  const surfacePixels = tilePixels + bleedPixels * 2;
  const bytesPerTile = surfacePixels * surfacePixels * 4;
  const maximumTiles = Math.max(1, Math.floor(byteBudget / bytesPerTile));
  const bins = new Map<string, MutableTileBin>();
  let tileMarkReferences = 0;

  for (const [markIndex, mark] of marks.entries()) {
    const range = markTileRangeAtScale(mark, scale);
    if (
      !range
      || range.columns * range.rows
        > tileMarkReferenceBudget - tileMarkReferences
    ) return "tile-mark-budget";

    for (let tileY = range.minTileY; tileY <= range.maxTileY; tileY += 1) {
      for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX += 1) {
        const key = `${tileX}:${tileY}`;
        let bin = bins.get(key);
        if (!bin) {
          if (bins.size >= maximumTiles) return "surface-budget";
          bin = { tileX, tileY, markIndexes: [] };
          bins.set(key, bin);
        }
        bin.markIndexes.push(markIndex);
        tileMarkReferences += 1;
      }
    }
  }

  return {
    bins: [...bins.values()].sort((left, right) => (
      left.tileY - right.tileY || left.tileX - right.tileX
    )),
    scale,
    allocatedBytes: bins.size * bytesPerTile,
    tileMarkReferences,
  };
}

/**
 * Builds an exact committed tile index without the active renderer's surface/reference admission
 * ceilings. Two passes replace append-heavy boxed number arrays with fixed Uint32 storage. The
 * resulting memory is proportional to the finite persisted mark plan and no tile surface is
 * allocated here; large plans are consumed one tile at a time below.
 */
function planCommittedStreamingTilesAtScale(
  marks: readonly StudioDynamicBrushCoverageMark[],
  scale: number,
): TilePlan | null {
  interface CountedBin {
    readonly tileX: number;
    readonly tileY: number;
    count: number;
    cursor: number;
    markIndexes: Uint32Array;
  }

  try {
    const counted = new Map<string, CountedBin>();
    const emptyMarkIndexes = new Uint32Array(0);
    let tileMarkReferences = 0;

    for (const mark of marks) {
      const range = markTileRangeAtScale(mark, scale);
      if (!range) return null;
      for (let tileY = range.minTileY; tileY <= range.maxTileY; tileY += 1) {
        for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX += 1) {
          const key = `${tileX}:${tileY}`;
          const bin = counted.get(key);
          if (bin) {
            bin.count += 1;
          } else {
            counted.set(key, {
              tileX,
              tileY,
              count: 1,
              cursor: 0,
              markIndexes: emptyMarkIndexes,
            });
          }
          tileMarkReferences += 1;
        }
      }
      if (!Number.isSafeInteger(tileMarkReferences)) return null;
    }

    for (const bin of counted.values()) {
      bin.markIndexes = new Uint32Array(bin.count);
    }
    for (const [markIndex, mark] of marks.entries()) {
      const range = markTileRangeAtScale(mark, scale);
      if (!range) return null;
      for (let tileY = range.minTileY; tileY <= range.maxTileY; tileY += 1) {
        for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX += 1) {
          const bin = counted.get(`${tileX}:${tileY}`)!;
          bin.markIndexes[bin.cursor] = markIndex;
          bin.cursor += 1;
        }
      }
    }

    const surfacePixels =
      STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE
      + STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS * 2;
    const bytesPerTile = surfacePixels * surfacePixels * 4;
    const allocatedBytes = counted.size * bytesPerTile;
    if (!Number.isSafeInteger(allocatedBytes)) return null;
    const bins = [...counted.values()].sort((left, right) => (
      left.tileY - right.tileY || left.tileX - right.tileX
    ));
    counted.clear();
    return {
      bins,
      scale,
      // Aggregate bytes describe the equivalent all-at-once plan. The streaming renderer reports
      // its actual one-surface peak allocation in the public result.
      allocatedBytes,
      tileMarkReferences,
    };
  } catch {
    // A compact index allocation failure is an actual host allocation failure, not a policy cap.
    return null;
  }
}

function defaultSurfaceFactory(
  width: number,
  height: number
): StudioCoverageSurface | null {
  try {
    if (typeof globalThis.OffscreenCanvas === "function") {
      const surface = new globalThis.OffscreenCanvas(width, height);
      if (surface.getContext("2d")) return surface as StudioCoverageSurface;
    }
    if (typeof globalThis.document !== "undefined") {
      const surface = globalThis.document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      return surface as StudioCoverageSurface;
    }
  } catch {
    return null;
  }
  return null;
}

function releasePreparedTiles(tiles: readonly PreparedTile[]): void {
  for (const tile of tiles) {
    // Resetting dimensions releases browser backing storage immediately on both supported hosts.
    tile.surface.width = 1;
    tile.surface.height = 1;
  }
}

function removeCommittedCoverageCacheEntry(
  entry: CommittedCoverageCacheEntry,
): void {
  const variants = committedCoverageCache.get(entry.key);
  if (variants?.get(entry.scale) === entry) {
    variants.delete(entry.scale);
    if (variants.size === 0) committedCoverageCache.delete(entry.key);
  }
  committedCoverageCacheBytes = Math.max(
    0,
    committedCoverageCacheBytes - entry.plan.allocatedBytes,
  );
  releasePreparedTiles(entry.prepared);
}

function evictCommittedCoverageCacheToBudget(
  byteBudget = runtimeCommittedCoverageCacheByteBudget(),
): void {
  while (
    committedCoverageCacheBytes
      > byteBudget
  ) {
    let oldest: CommittedCoverageCacheEntry | null = null;
    for (const variants of committedCoverageCache.values()) {
      for (const entry of variants.values()) {
        if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
      }
    }
    if (!oldest) {
      committedCoverageCacheBytes = 0;
      return;
    }
    removeCommittedCoverageCacheEntry(oldest);
  }
}

function committedCoverageMarksEqual(
  left: readonly StudioDynamicBrushCoverageMark[],
  right: readonly StudioDynamicBrushCoverageMark[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftMark = left[index]!;
    const rightMark = right[index]!;
    const leftTextureMap = leftMark.texture?.alphaMap;
    const rightTextureMap = rightMark.texture?.alphaMap;
    const textureEqual = leftTextureMap === rightTextureMap
      || (
        leftTextureMap?.revision !== undefined
        && rightTextureMap?.revision !== undefined
        && Object.is(leftTextureMap.revision, rightTextureMap.revision)
        && leftTextureMap.size === rightTextureMap.size
      );
    const leftRibbon = leftMark.ribbon;
    const rightRibbon = rightMark.ribbon;
    const ribbonEqual = leftRibbon === rightRibbon
      || (
        leftRibbon?.kind === rightRibbon?.kind
        && leftRibbon?.version === rightRibbon?.version
        && leftRibbon?.role === rightRibbon?.role
        && leftRibbon?.polygons.length === rightRibbon?.polygons.length
        && leftRibbon?.polygons.every(
          (points, polygonIndex) => (
            points.length === rightRibbon?.polygons[polygonIndex]?.length
            && points.every(
              (point, pointIndex) => (
                point === rightRibbon?.polygons[polygonIndex]?.[pointIndex]
              ),
            )
          ),
        )
      );
    if (
      leftMark.x !== rightMark.x
      || leftMark.y !== rightMark.y
      || leftMark.radiusX !== rightMark.radiusX
      || leftMark.radiusY !== rightMark.radiusY
      || leftMark.angleRadians !== rightMark.angleRadians
      || leftMark.alpha !== rightMark.alpha
      || leftMark.color !== rightMark.color
      || leftMark.falloff?.kind !== rightMark.falloff?.kind
      || leftMark.falloff?.exponent !== rightMark.falloff?.exponent
      || leftMark.falloff?.tone !== rightMark.falloff?.tone
      || leftMark.texture?.kind !== rightMark.texture?.kind
      || !textureEqual
      || !ribbonEqual
    ) {
      return false;
    }
  }
  return true;
}

function readCommittedCoverageCache(
  key: StudioDynamicCoverageCommittedCacheKey,
  marks: readonly StudioDynamicBrushCoverageMark[],
  scale: number,
): CommittedCoverageCacheEntry | null {
  const variants = committedCoverageCache.get(key);
  const entry = variants?.get(scale);
  if (!entry) return null;
  // React/Konva may reconstruct a deterministic mark array while retaining the same immutable
  // document element. Compare values before discarding the raster: identity-only validation made
  // every retained-layer repaint miss even though the planned pixels were byte-for-byte equal.
  if (!committedCoverageMarksEqual(entry.marks, marks)) {
    removeCommittedCoverageCacheEntry(entry);
    return null;
  }
  entry.lastUsed = ++committedCoverageCacheClock;
  return entry;
}

function writeCommittedCoverageCache(
  key: StudioDynamicCoverageCommittedCacheKey,
  marks: readonly StudioDynamicBrushCoverageMark[],
  plan: TilePlan,
  prepared: readonly PreparedTile[],
): CommittedCoverageCacheEntry | null {
  const byteBudget = runtimeCommittedCoverageCacheByteBudget();
  if (
    plan.allocatedBytes <= 0
    || plan.allocatedBytes
      > byteBudget
  ) return null;
  const variants = committedCoverageCache.get(key) ?? new Map();
  const previous = variants.get(plan.scale);
  if (previous) removeCommittedCoverageCacheEntry(previous);
  committedCoverageCache.set(key, variants);
  const entry: CommittedCoverageCacheEntry = {
    key,
    marks,
    scale: plan.scale,
    plan,
    prepared,
    lastUsed: ++committedCoverageCacheClock,
  };
  variants.set(plan.scale, entry);
  committedCoverageCacheBytes += plan.allocatedBytes;
  evictCommittedCoverageCacheToBudget(byteBudget);
  return variants.get(plan.scale) === entry ? entry : null;
}

/**
 * Releases every retained coverage surface owned by the current Studio JavaScript realm.
 * Studio's editor instance is the lifecycle owner and calls this synchronously during work/auth
 * scope teardown, before a replacement document can retain the previous document's backing store.
 */
export function disposeStudioDynamicCoverageCommittedCache(): void {
  const entries = [...committedCoverageCache.values()]
    .flatMap((variants) => [...variants.values()]);
  committedCoverageCache.clear();
  committedCoverageCacheBytes = 0;
  committedCoverageCacheClock = 0;
  for (const entry of entries) releasePreparedTiles(entry.prepared);
  clearStudioBrushTextureStampCache();
  clearStudioBrushSoftFalloffStampCache();
  resetStudioBrushR8GrainRegistry();
}

/** Test/debug alias retained for focused renderer isolation. */
export function clearStudioDynamicCoverageCommittedCache(): void {
  disposeStudioDynamicCoverageCommittedCache();
}

export function studioDynamicCoverageCommittedCacheStats(): Readonly<{
  bytes: number;
  entries: number;
  tiles: number;
}> {
  let entries = 0;
  let tiles = 0;
  for (const variants of committedCoverageCache.values()) {
    entries += variants.size;
    for (const entry of variants.values()) tiles += entry.prepared.length;
  }
  return Object.freeze({
    bytes: committedCoverageCacheBytes,
    entries,
    tiles,
  });
}

function prepareTileSurfaces(
  plan: TilePlan,
  marks: readonly StudioDynamicBrushCoverageMark[],
  factory: StudioCoverageSurfaceFactory
): readonly PreparedTile[] | null {
  const tilePixels = STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE;
  const bleedPixels = STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS;
  const surfacePixels = tilePixels + bleedPixels * 2;
  const prepared: PreparedTile[] = [];
  try {
    for (const bin of plan.bins) {
      const surface = factory(surfacePixels, surfacePixels);
      const context = surface?.getContext("2d", { alpha: true });
      if (!surface || !context) {
        releasePreparedTiles(prepared);
        return null;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, surfacePixels, surfacePixels);
      context.globalCompositeOperation = "source-over";
      context.setTransform(
        plan.scale,
        0,
        0,
        plan.scale,
        bleedPixels - bin.tileX * tilePixels,
        bleedPixels - bin.tileY * tilePixels
      );
      for (const markIndex of bin.markIndexes) {
        const mark = marks[markIndex]!;
        renderStudioDynamicBrushCoverageMark(context, mark, 1, factory);
      }
      prepared.push({ ...bin, surface });
    }
    return prepared;
  } catch {
    releasePreparedTiles(prepared);
    return null;
  }
}

function compositePreparedTileSurfaces(
  context: StudioDynamicBrushCoverageDestinationContext,
  prepared: readonly PreparedTile[],
  plan: TilePlan,
  opacity: number,
): "rendered" | "partial" | "failed" {
  const tileLogicalSize = STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE / plan.scale;
  const inheritedAlpha = clampAlpha(context.globalAlpha);
  let destinationStarted = false;
  try {
    context.save();
    context.globalAlpha = inheritedAlpha * opacity;
    for (const tile of prepared) {
      destinationStarted = true;
      context.drawImage(
        tile.surface,
        STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS,
        STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS,
        STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE,
        STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE,
        tile.tileX * tileLogicalSize,
        tile.tileY * tileLogicalSize,
        tileLogicalSize,
        tileLogicalSize,
      );
    }
    context.restore();
    return "rendered";
  } catch {
    try {
      context.restore();
    } catch {
      // Preserve the fail-closed result even if a host context also rejects restore().
    }
    return destinationStarted ? "partial" : "failed";
  }
}

type StudioCommittedCoverageStreamingResult =
  | Readonly<{ status: "rendered"; peakAllocatedBytes: number }>
  | Readonly<{
      status: "failed";
      reason: "surface-render-failed" | "destination-composite-failed";
    }>
  | Readonly<{
      status: "partial";
      reason: "surface-render-failed" | "destination-composite-failed";
    }>;

/**
 * Renders an arbitrarily large committed tile plan through one reusable tile surface.
 *
 * Tile cores do not overlap at the destination, so setting inherited alpha × element opacity once
 * for the complete loop preserves the stroke-local bounded-flow contract. The bleed area remains
 * source-only antialias padding and is cropped from every draw. No dab is replayed directly and no
 * per-dab element opacity is introduced.
 */
function compositeCommittedCoverageStreaming(
  context: StudioDynamicBrushCoverageDestinationContext,
  marks: readonly StudioDynamicBrushCoverageMark[],
  plan: TilePlan,
  opacity: number,
  factory: StudioCoverageSurfaceFactory,
): StudioCommittedCoverageStreamingResult {
  const tilePixels = STUDIO_DYNAMIC_COVERAGE_TILE_PIXEL_SIZE;
  const bleedPixels = STUDIO_DYNAMIC_COVERAGE_TILE_BLEED_PIXELS;
  const surfacePixels = tilePixels + bleedPixels * 2;
  const peakAllocatedBytes = surfacePixels * surfacePixels * 4;
  let destinationStarted = false;
  let phase: "surface" | "destination" = "surface";
  let destinationSaved = false;
  let surface: StudioCoverageSurface | null = null;
  try {
    surface = factory(surfacePixels, surfacePixels);
    const surfaceContext = surface?.getContext("2d", { alpha: true });
    if (!surface || !surfaceContext) {
      return { status: "failed", reason: "surface-render-failed" };
    }

    phase = "destination";
    context.save();
    destinationSaved = true;
    const inheritedAlpha = clampAlpha(context.globalAlpha);
    context.globalAlpha = inheritedAlpha * opacity;
    const tileLogicalSize = tilePixels / plan.scale;

    for (const bin of plan.bins) {
      phase = "surface";
      surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
      surfaceContext.clearRect(0, 0, surfacePixels, surfacePixels);
      surfaceContext.globalCompositeOperation = "source-over";
      surfaceContext.setTransform(
        plan.scale,
        0,
        0,
        plan.scale,
        bleedPixels - bin.tileX * tilePixels,
        bleedPixels - bin.tileY * tilePixels,
      );
      for (const markIndex of bin.markIndexes) {
        renderStudioDynamicBrushCoverageMark(
          surfaceContext,
          marks[markIndex]!,
          1,
          factory,
        );
      }

      phase = "destination";
      destinationStarted = true;
      context.drawImage(
        surface,
        bleedPixels,
        bleedPixels,
        tilePixels,
        tilePixels,
        bin.tileX * tileLogicalSize,
        bin.tileY * tileLogicalSize,
        tileLogicalSize,
        tileLogicalSize,
      );
    }
    context.restore();
    destinationSaved = false;
    return { status: "rendered", peakAllocatedBytes };
  } catch {
    if (destinationSaved) {
      try {
        context.restore();
      } catch {
        // Preserve the explicit failure result even if the host context rejects restore().
      }
    }
    const reason = phase === "destination"
      ? "destination-composite-failed"
      : "surface-render-failed";
    return destinationStarted
      ? { status: "partial", reason }
      : { status: "failed", reason };
  } finally {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
  }
}

/**
 * Renders v2 coverage. Rejected/unavailable results are returned before destination mutation.
 * They deliberately do not authorize a same-operation renderer substitution: the caller keeps
 * the immutable source and may select a different renderer only for a later operation. A partial
 * destination failure remains explicit so a completed prefix cannot be double-painted.
 */
export function renderStudioDynamicBrushCoverage(
  context: StudioDynamicBrushCoverageDestinationContext,
  marks: readonly StudioDynamicBrushCoverageMark[],
  options: StudioDynamicBrushCoverageRenderOptions
): StudioDynamicBrushCoverageRenderResult {
  const opacity = clampAlpha(options.opacity);
  if (marks.length === 0 || opacity <= 0) return { status: "empty" };
  if (!marks.every(markIsValid)) {
    return { status: "rejected", reason: "invalid-mark" };
  }

  const byteBudget = options.activeDraft
    ? STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET
    : STUDIO_DYNAMIC_COVERAGE_COMMITTED_BYTE_BUDGET;
  const tileMarkReferenceBudget = options.activeDraft
    ? STUDIO_DYNAMIC_COVERAGE_ACTIVE_TILE_MARK_REFERENCE_BUDGET
    : STUDIO_DYNAMIC_COVERAGE_COMMITTED_TILE_MARK_REFERENCE_BUDGET;
  const cacheKey = !options.activeDraft ? options.committedCacheKey : undefined;
  const factory = options.surfaceFactory ?? defaultSurfaceFactory;
  let selectedPlan: TilePlan | null = null;
  let selectedCacheEntry: CommittedCoverageCacheEntry | null = null;
  let lastFailure: "surface-budget" | "tile-mark-budget" = "surface-budget";
  const scales = candidateScales(context, options.activeDraft);
  for (const scale of scales) {
    const cached = cacheKey
      ? readCommittedCoverageCache(cacheKey, marks, scale)
      : null;
    if (cached) {
      selectedCacheEntry = cached;
      selectedPlan = cached.plan;
      break;
    }
    if (!options.activeDraft) {
      // Build one compact fixed-width index up front. The former path first accumulated as many as
      // 262,144 boxed number references, discarded them after admission failed, and then built the
      // compact plan—a large pointer-up memory spike for exactly the strokes that need streaming.
      const committedPlan = planCommittedStreamingTilesAtScale(marks, scale);
      if (!committedPlan) {
        return { status: "rejected", reason: "planning-failed" };
      }
      if (
        committedPlan.allocatedBytes <= byteBudget
        && committedPlan.tileMarkReferences <= tileMarkReferenceBudget
      ) {
        selectedPlan = committedPlan;
        break;
      }
      const streamed = compositeCommittedCoverageStreaming(
        context,
        marks,
        committedPlan,
        opacity,
        factory,
      );
      if (streamed.status !== "rendered") {
        return streamed.status === "partial"
          ? { status: "partial", reason: streamed.reason }
          : {
              status: "unavailable",
              reason: "surface-render-failed",
            };
      }
      return {
        status: "rendered",
        scale: committedPlan.scale,
        tileCount: committedPlan.bins.length,
        allocatedBytes: streamed.peakAllocatedBytes,
        tileMarkReferences: committedPlan.tileMarkReferences,
      };
    }
    const candidate = planTilesAtScale(
      marks,
      scale,
      byteBudget,
      tileMarkReferenceBudget
    );
    if (candidate === "surface-budget" || candidate === "tile-mark-budget") {
      lastFailure = candidate;
      continue;
    }
    selectedPlan = candidate;
    break;
  }
  if (!selectedPlan) return { status: "rejected", reason: lastFailure };

  const prepared = selectedCacheEntry?.prepared
    ?? prepareTileSurfaces(selectedPlan, marks, factory);
  if (!prepared) {
    return {
      status: "unavailable",
      reason: options.surfaceFactory ? "surface-render-failed" : "surface-unavailable",
    };
  }

  let retainedByCache = selectedCacheEntry !== null;
  if (!retainedByCache && cacheKey) {
    retainedByCache = writeCommittedCoverageCache(
      cacheKey,
      marks,
      selectedPlan,
      prepared,
    ) !== null;
  }
  const composite = compositePreparedTileSurfaces(
    context,
    prepared,
    selectedPlan,
    opacity,
  );
  if (!retainedByCache) releasePreparedTiles(prepared);
  if (composite !== "rendered") {
    return composite === "partial"
      ? { status: "partial", reason: "destination-composite-failed" }
      : { status: "unavailable", reason: "surface-render-failed" };
  }
  return {
    status: "rendered",
    scale: selectedPlan.scale,
    tileCount: selectedPlan.bins.length,
    allocatedBytes: selectedPlan.allocatedBytes,
    tileMarkReferences: selectedPlan.tileMarkReferences,
  };
}

/** Frozen direct compositor used only when an omitted/legacy paint model selects it up front. */
export function renderStudioDynamicBrushLegacyMarks(
  context: StudioDynamicBrushLegacyDestinationContext,
  marks: readonly StudioDynamicBrushCoverageMark[],
  opacity: number,
  textureSurfaceFactory: StudioBrushTextureStampSurfaceFactory =
    defaultSurfaceFactory,
): void {
  context.save();
  const inheritedAlpha = clampAlpha(context.globalAlpha);
  const strokeOpacity = clampAlpha(opacity);
  for (const mark of marks) {
    if (mark.alpha <= 0) continue;
    renderStudioDynamicBrushCoverageMark(
      context,
      mark,
      inheritedAlpha * strokeOpacity,
      textureSurfaceFactory,
    );
  }
  context.restore();
}
