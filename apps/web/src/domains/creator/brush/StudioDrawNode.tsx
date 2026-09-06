import { memo, useEffect, useReducer, useRef, useState } from "react";
import {
  Arrow,
  Circle as KCircle,
  Ellipse,
  Group,
  Line,
  Path,
  Rect,
  Shape,
  Star,
} from "react-konva/lib/ReactKonvaCore";

import {
  requestStudioGpuBristleOverlay,
  STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX,
  studioGpuBristleOilRequest,
} from "../render/studio-gpu-bristle-host";
import {
  buildCalligraphySegments,
  processFreehandPoints,
  processPencilPoints,
  resampleStrokePressures,
  resolveStudioBrushRenderFamily,
  resolveStudioFreehandRenderPath,
  screentoneDotRadius,
  screentoneDotsForStroke,
  screentoneDotsForStrokeIncremental,
  strokeRenderDistance,
} from "../studio-brush";
import {
  DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
  planCausalWatercolorBrushDabs,
  planCausalWatercolorBrushDabsIncremental,
} from "../studio-causal-watercolor-brush";
import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  renderStudioDynamicBrushCoverage,
  renderStudioDynamicBrushCoverageMark,
  renderStudioDynamicBrushLegacyMarks,
} from "../studio-dynamic-brush-coverage-renderer";
import { planStudioDynamicBrushRender } from "../studio-dynamic-brush-render-plan";
import {
  FX_OIL_DAB_CAP,
  FX_PASTEL_DAB_CAP,
  STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION,
  fxBrushSeedFromKey,
  isStudioFxPressureBrushId,
  planGlitterBrushParticles,
  planGlowBrushPasses,
  createStudioIncrementalFxLuminousRibbonBuilder,
  createStudioIncrementalFxPressurePathBuilder,
  planNeonBrushPasses,
  planOilBrushDabs,
  planOilBrushDabsIncremental,
  releaseOilBrushDabDraftPlanners,
  planPastelBrushDabs,
  planStudioFxBrushPressurePath,
  planStudioFxLuminousRibbonPass,
  resolveStudioFxBrushTapPressureResponse,
  resolveStudioFxPressurePassResponse,
  studioLuminousCoreColor,
} from "../studio-fx-brush";
import { konvaGradientProps } from "../studio-gradient-engine";
import {
  planStudioHighlighterWashRibbon,
  planStudioHighlighterWashTap,
  resolveStudioHighlighterWashBrushId,
  traceStudioHighlighterWashDetail,
  traceStudioHighlighterWashPlan,
} from "../studio-highlighter-wash-ribbon";
import {
  requestStudioLivingInkSettledBakeDabs,
  resolveStudioLivingInkSettledBakeProgram,
} from "../studio-living-ink-settled-bake-v1";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  planStudioPerfectFreehandRender,
  planStudioPerfectFreehandRenderIncremental,
} from "../studio-outline-stroke-contract";
import {
  konvaPatternProps,
  loadPatternTileImage,
  patternDataUrl,
} from "../studio-pattern-fill";
import {
  buildStudioPerfectFreehandOutline,
  loadStudioPerfectFreehandStroker,
  peekStudioPerfectFreehandStroker,
  studioPerfectFreehandOutlineToPathData,
  resolveStudioPerfectFreehandProfile,
} from "../studio-perfect-freehand";
import {
  fillStudioPixelPencilCells,
  isStudioPixelPencilRenderMode,
  planStudioPixelPencilCells,
} from "../studio-pixel-pencil";
import {
  planStudioRetainedMediaPressureCurve,
  planStudioRetainedMediaTapDab,
  resolveStudioRetainedMediaPressure,
  resolveStudioRetainedMediaPressureProfileId,
} from "../studio-retained-media-pressure";
import { planStudioRetainedMediaRibbon } from "../studio-retained-media-ribbon";
import {
  buildStudioRoughShapeRenderPlan,
  loadStudioRoughGenerator,
  peekStudioRoughGenerator,
  studioRoughSeedFromElementId,
  studioSketchStyleOfElement,
} from "../studio-rough-shape";
import { StudioStampDrawShape } from "../StudioStampDrawShape";

import {
  applyStudioBrushAliasWatercolorMaterial,
  isStudioBrushEraserAliasId,
  mapStudioBrushAliasPressure,
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasPencilPasses,
  resolveStudioBrushAliasWatercolorPlanSettings,
  studioBrushAliasEffectiveDiameter,
  type StudioBrushAliasWatercolorDab,
} from "./studio-brush-alias-profile";
import {
  resolveStudioCapturedBrushDynamicsPresetId,
} from "./studio-brush-dynamics";
import { resolveStudioBrushEngineLaneWatercolorMaterial } from "./studio-brush-engine-lane-catalog";
import {
  resolveStudioBrushRuntimeContract,
  resolveStudioBrushSinglePointRoute,
} from "./studio-brush-runtime-contract";
import {
  resolveStudioStampBrushKind,
} from "./studio-brush-stamp-engine";
import { STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS } from "./studio-brush-symmetry";
import { resolveStudioCalligraphyRenderTip } from "./studio-calligraphy-nib-profile";
import { planStudioCalligraphyRibbon } from "./studio-calligraphy-ribbon";
import {
  drawBounds,
  drawFreehandPenSegments,
  drawStudioCausalInkContract,
  getSymmetricPoints,
  resolveStudioCausalInkDrawContract,
} from "./studio-draw-rendering";
import { studioOilFamilyPlanFields } from "./studio-fluid-paint-reference";
import {
  createStudioFxLuminousRetainedPass,
  fillStudioFxLuminousRibbonPass,
  studioFxLuminousDraftRetentionFits,
  type StudioFxLuminousRetainedPass,
} from "./studio-fx-luminous-retained-path";
import { resolveStudioDrawTapRadius } from "./studio-live-visible-tap";
import {
  paintStudioOilRibbonCarrier,
  paintStudioOilRibbonHit,
  planStudioOilRibbonCarrier,
  planStudioOilRibbonCarrierIncremental,
  releaseStudioOilRibbonDraftPlanners,
  studioOilRibbonProgramsForBrush,
} from "./studio-oil-ribbon-carrier";
import { paintStudioOilRibbonCarrierIncremental } from "./studio-oil-ribbon-incremental-paint";
import {
  STUDIO_PENCIL_DEFAULT_ALIAS_PASS,
  STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT,
  studioPencilAliasPassPoints,
  studioPencilRibbonAlphaBucket,
} from "./studio-pencil-alias-passes";
import { rasterizeStudioCoverageBands } from "./studio-stroke-coverage-raster";
import {
  planStudioAngledNibStrokeLocalCoverage,
  planStudioAngledNibStrokeLocalCoverageIncremental,
} from "./studio-stroke-local-coverage";
import {
  isStudioBoundedFlowPaintModelCompatible,
} from "./studio-stroke-paint-model";
import {
  effectiveCornerRadius,
  lineArrowHeadGeoms,
  normalizeShapeParams,
  normalizeStrokeStyle,
  polygonPathNodeLayoutInBounds,
  strokeDashArray,
} from "./studio-stroke-shapes";
import {
  planWatercolorBrushDabs,
  watercolorBrushSeedFromKey,
} from "./studio-watercolor-brush";
import { planStudioInteractiveWetInkBrushReplay } from "./studio-wet-ink-backend-capability";
import {
  renderStudioWetInkBrushReplay,
} from "./studio-wet-ink-brush-runtime";
import {
  planStudioWetRibbonCarrier,
  traceStudioWetRibbonCarrierBatch,
} from "./studio-wet-ribbon-carrier";
import { planStudioWetWashLivePipeline } from "./studio-wet-wash-live-pipeline";


import type { CalligraphyStylusInput } from "../studio-brush";
import type { DrawEl } from "../studio-element-model";
import type { StudioIncrementalFxPressurePathBuilder } from "../studio-fx-brush";
import type { StudioPaperSurfaceSettings } from "./studio-paper-granulation-runtime";
import type { StudioPatternSpec } from "../studio-pattern-fill";
import type { StudioPerfectFreehandStroker } from "../studio-perfect-freehand";
import type { StudioRoughGeneratorHandle } from "../studio-rough-shape";

export { STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT };

type PerfectInkDebugState = {
  brush: string;
  pointCount: number;
  strokeDistance: number;
  isVeryShort: boolean;
  isSparseLong: boolean;
  profile: string;
  outlineDistance?: number;
  outlinePointCount?: number;
  isDegeneratePath?: boolean;
};

function setPerfectInkDebugState(state: PerfectInkDebugState | null): void {
  if (typeof globalThis === "undefined") {
    return;
  }
  (globalThis as { __perfectInkDebugState?: PerfectInkDebugState | null }).__perfectInkDebugState =
    state;
}


// 손그림(스케치) 도형용 rough.js generator 훅 — 스케치가 켜진 도형이 처음 보일 때만
// 동적 import로 로드한다(Studio eager 청크에 rough.js 미포함). 로드 전에는 null을 반환해
// 깨끗한 Konva 프리미티브 폴백으로 그리고, 로드가 끝나면 상태 변경으로 다시 그린다.
function useStudioRoughGenerator(wanted: boolean): StudioRoughGeneratorHandle | null {
  const [generator, setGenerator] = useState<StudioRoughGeneratorHandle | null>(
    () => peekStudioRoughGenerator()
  );
  useEffect(() => {
    if (!wanted || generator) return;
    let active = true;
    loadStudioRoughGenerator()
      .then((loaded) => {
        if (active) setGenerator(loaded);
      })
      .catch(() => {
        // 로드 실패 시 깨끗한 프리미티브 렌더를 유지한다 — 다음 마운트가 재시도.
      });
    return () => {
      active = false;
    };
  }, [wanted, generator]);
  return wanted ? generator : null;
}

// 퍼펙트-프리핸드(tldraw 필기감) 스트로커 훅 — 퍼펙트 브러시 획이 처음 보일 때만 동적
// import로 로드한다(Studio eager 청크에 perfect-freehand 미포함). 로드 전에는 null을 반환해
// 깨끗한 Line 폴백으로 그리고, 로드가 끝나면 상태 변경으로 다시 그린다.
function useStudioPerfectFreehandStroker(wanted: boolean): StudioPerfectFreehandStroker | null {
  const [stroker, setStroker] = useState<StudioPerfectFreehandStroker | null>(
    () => peekStudioPerfectFreehandStroker()
  );
  useEffect(() => {
    if (!wanted || stroker) return;
    let active = true;
    loadStudioPerfectFreehandStroker()
      .then((loaded) => {
        // 스트로커는 함수 값이라 updater 로 오인되지 않게 반드시 클로저로 감싼다.
        if (active) setStroker(() => loaded);
      })
      .catch(() => {
        // 로드 실패 시 깨끗한 Line 폴백 렌더를 유지한다 — 다음 마운트가 재시도.
      });
    return () => {
      active = false;
    };
  }, [wanted, stroker]);
  return wanted ? stroker : null;
}


const STUDIO_DRAW_PATTERN_IMAGE_CACHE_LIMIT = 128;
const resolvedPatternTileImages = new Map<string, HTMLImageElement>();
const pendingPatternTileImageLoads = new Map<string, Promise<HTMLImageElement>>();

function cacheResolvedPatternTileImage(tileSrc: string, image: HTMLImageElement): void {
  if (!resolvedPatternTileImages.has(tileSrc)) {
    while (resolvedPatternTileImages.size >= STUDIO_DRAW_PATTERN_IMAGE_CACHE_LIMIT) {
      const oldestTileSrc = resolvedPatternTileImages.keys().next().value;
      if (typeof oldestTileSrc !== "string") break;
      resolvedPatternTileImages.delete(oldestTileSrc);
    }
  }
  resolvedPatternTileImages.set(tileSrc, image);
}

function loadSharedPatternTileImage(tileSrc: string): Promise<HTMLImageElement> {
  const resolved = resolvedPatternTileImages.get(tileSrc);
  if (resolved) return Promise.resolve(resolved);
  const pending = pendingPatternTileImageLoads.get(tileSrc);
  if (pending) return pending;

  const request = loadPatternTileImage(tileSrc, () => new globalThis.Image()).then(
    (image) => {
      cacheResolvedPatternTileImage(tileSrc, image);
      pendingPatternTileImageLoads.delete(tileSrc);
      return image;
    },
    (error: unknown) => {
      pendingPatternTileImageLoads.delete(tileSrc);
      throw error;
    },
  );
  pendingPatternTileImageLoads.set(tileSrc, request);
  return request;
}

// 패턴 채우기 타일 이미지 훅 — 패턴 스펙의 SVG 타일(data URL)을 HTMLImage로 비동기 로드한다.
// UrlImage의 effect 로드 방식을 훅으로 컴포넌트화한 것. 타일 src는 patternId/색에만
// 의존하므로(배율은 fillPatternScale로 적용) 배율 조절로는 재로드되지 않는다. 문서 노드가
// 이미 해결한 타일은 transform-draft가 같은 이미지 객체를 첫 렌더부터 재사용한다. 캐시가
// 차가워도 동일 src의 진행 중 요청을 공유하며, bounded cache라 문서별 색 조합이 누적되지 않는다.
// 로드 전/실패 시 null → konvaPatternProps가 no-op이 되어 fill/그라데이션 폴백 유지.
function usePatternFillImage(pattern: StudioPatternSpec | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{
    image: HTMLImageElement;
    tileSrc: string;
  } | null>(null);
  const tileSrc = pattern ? patternDataUrl(pattern) : null;
  const image = tileSrc
    ? (loaded?.tileSrc === tileSrc ? loaded.image : null)
      ?? resolvedPatternTileImages.get(tileSrc)
      ?? null
    : null;
  useEffect(() => {
    if (!tileSrc) return;
    const resolved = resolvedPatternTileImages.get(tileSrc);
    if (resolved) {
      // A cache hit must be visible on the first render, but the mounted node also retains its own
      // reference so a later bounded-cache eviction cannot make an existing pattern disappear.
      if (loaded?.tileSrc !== tileSrc || loaded.image !== resolved) {
        setLoaded({ image: resolved, tileSrc });
      }
      return;
    }
    if (loaded?.tileSrc === tileSrc) return;
    let active = true;
    loadSharedPatternTileImage(tileSrc)
      .then((img) => {
        if (active) setLoaded({ image: img, tileSrc });
      })
      .catch(() => {
        // 로드 실패 시 현재 fill/gradient 폴백을 유지하고 다음 마운트가 재시도한다.
      });
    return () => {
      active = false;
    };
  }, [loaded, tileSrc]);
  return image;
}

// memo 는 라이브 드로잉의 핵심 계약이다: 초안이 rAF마다 리렌더를 일으켜도 커밋된 획들은 같은
// el 참조를 받으므로 여기서 잘린다. memo 가 없으면 모든 커밋 획이 매 프레임 스무딩을 재계산해
// 새 points 배열을 만들고, react-konva 가 이를 시각 변경으로 보고 메인 레이어 전체를 다시
// 래스터한다 — 콘텐츠가 쌓일수록 스트로크가 점점 무거워지던 원인.
export const StudioDrawNode = memo(function StudioDrawNode({
  el,
  activeDraft: legacyActiveDraft = false,
  exposeSceneIdentity = true,
  paperSurface,
  renderPurpose,
}: {
  el: DrawEl;
  /** 활성 수채 초안은 움직이는 종점 pigment를 영구 station으로 굳히지 않는다. */
  activeDraft?: boolean;
  /** False for renderer-local preview copies that must never be found as document wrappers. */
  exposeSceneIdentity?: boolean;
  /** Retained document strokes re-plan when the selected paper changes. */
  paperSurface?: StudioPaperSurfaceSettings;
  /**
   * Transform drafts use settled geometry but must not start document-owned background bakes,
   * populate committed caches or write diagnostics on every animation frame.
   */
  renderPurpose?: "document" | "drawing-draft" | "transform-draft";
}) {
  const resolvedRenderPurpose = renderPurpose
    ?? (legacyActiveDraft ? "drawing-draft" : "document");
  const activeDraft = resolvedRenderPurpose === "drawing-draft";
  const durableDocumentRender = resolvedRenderPurpose === "document";
  const kind = el.kind ?? "freehand";
  // 패턴 채우기 타일(로드 전 null) — 우선순위: 패턴 > 그라데이션 > 단색(fillPriority).
  // 실제 fillPattern props를 쓰는 도형만 타일을 요청한다. 따라서 exact transform draft는
  // 문서 렌더의 resolved tile을 재사용하고, legacy/freehand의 stale pattern 필드는 어떤
  // render purpose에서도 불필요한 비동기 로드를 시작하지 않는다.
  const patternImage = usePatternFillImage(
    kind === "rect"
      || kind === "ellipse"
      || kind === "star"
      || kind === "triangle"
      || kind === "polygon"
      ? el.pattern
      : undefined,
  );
  // Opt-in living-ink settled bake (2026-08-14 stall fix): the whole-stroke fluid solve is far
  // over the 33ms chunk budget, so committed bake-lane strokes render their byte-identical base
  // wash immediately and a time-sliced background job bakes the bloom. This generation counter
  // is bumped when a requested bake lands in the deterministic cache; it flows into the request
  // call below so compiled (React Compiler) render bodies re-execute it and pick up the cache.
  const [livingInkBakeGeneration, notifyLivingInkBakeReady] = useReducer(
    (generation: number) => (generation + 1) | 0,
    0,
  );
  // Opt-in GPU bristle overlay (dli position-based-dynamics chain + per-pixel impasto). The lane
  // advances in a Worker off the render path and this counter is bumped when a result lands, so
  // the compiled (React Compiler) render body re-executes the request and picks up the bitmap.
  // A selected GPU-bristle brush owns pixels only after its bitmap is ready. Pending/unavailable
  // states preserve the source stroke but never execute the Canvas oil carrier.
  const [gpuBristleGeneration, notifyGpuBristleReady] = useReducer(
    (generation: number) => (generation + 1) | 0,
    0,
  );
  const isEraserOperation = el.mode === "eraser"
    || (el.brush ? resolveStudioBrushRuntimeContract(el.brush)?.operation === "erase" : false);
  /**
   * 압력 경로(fx 패밀리: neon/glow/highlighter)의 증분 빌더. 자라나는 요소가 이 컴포넌트를 매
   * 이동 리렌더할 때 전체 압력 경로를 다시 계획하던 것(장획 게이트가 잡는 이동당 O(n))을,
   * sceneFunc(그리기 시점)에서 append 로 소비해 이동당 상수 비용으로 만든다. 렌더 본문이 아닌
   * 그리기 콜백에서만 접근하므로 react-compiler 순수성 규약과도 충돌하지 않는다.
   *
   * 라이브 드래프트에서만 쓴다(P2 리뷰): 빌더의 prefix 검증은 마지막 소비 슬롯만 보는 O(1)
   * 앵커라, 길이·꼬리가 같은 내부 재작성(undo/복원)을 append-only 로 오인해 커밋 요소가 낡은
   * 지오메트리를 유지할 수 있다 — 커밋/재수화 경로는 배치 플래너가 값 동일로 다시 계산한다.
   * 대칭 변형은 인덱스별 빌더로 격리한다(꼬리점이 대칭축 위일 때 변형 간 앵커 충돌 방지).
   */
  const fxPressurePathBuildersRef =
    useRef<Map<number, StudioIncrementalFxPressurePathBuilder> | null>(null);
  const fxPressurePathBuilderForVariation = (
    variationIndex: number,
  ): StudioIncrementalFxPressurePathBuilder => {
    const builders = fxPressurePathBuildersRef.current ??= new Map();
    let builder = builders.get(variationIndex);
    if (!builder) {
      builder = createStudioIncrementalFxPressurePathBuilder();
      builders.set(variationIndex, builder);
    }
    return builder;
  };
  /**
   * 발광 리본 패스별 유지 상태 — (대칭 변형, 패스) 키 하나당 증분 플래너와 안정 prefix Path2D.
   *
   * 압력 경로만 증분이던 시절 glow 는 셸 48개를 매 이동 통째로 다시 계획하고 다시 그렸다(실측
   * r150 원 한 획 34.8초, 최악 이동 716 ms). 패스마다 플래너를 들고 있으면 이동당 비용이 새로
   * 들어온 섹션에만 비례한다(같은 획 0.91초, 최악 이동 25.2 ms).
   */
  const fxLuminousRetainedPassesRef =
    useRef<Map<string, StudioFxLuminousRetainedPass> | null>(null);
  const fxLuminousRetainedPass = (
    variationIndex: number,
    passIndex: number,
    retain: boolean,
  ): StudioFxLuminousRetainedPass | null => {
    // 예산을 넘긴 순간 이미 들고 있던 패스까지 놓는다 — 유지하지 않을 획의 폴리곤을 계속 붙들고
    // 있으면 예산이 상한이 아니라 그냥 미뤄진 지출이 된다.
    if (!retain) {
      fxLuminousRetainedPassesRef.current = null;
      return null;
    }
    const passes = fxLuminousRetainedPassesRef.current ??= new Map();
    const key = `${variationIndex}:${passIndex}`;
    let retained = passes.get(key);
    if (!retained) {
      retained = createStudioFxLuminousRetainedPass(
        createStudioIncrementalFxLuminousRibbonBuilder(),
      );
      passes.set(key, retained);
    }
    return retained;
  };
  const composite = isEraserOperation ? "destination-out" : "source-over";
  const opacity = el.opacity ?? 1;
  const stroke = isEraserOperation ? "#16100c" : el.stroke;
  const strokeWidth = Math.max(1, el.strokeWidth);
  // 스트로크 스타일(점선/선 끝) + 도형 파라미터 — 미설정 요소는 기본값으로 정규화된다.
  const strokeStyle = normalizeStrokeStyle(el.strokeStyle);
  const shapeParams = normalizeShapeParams(el.shapeParams);
  const shapeDash = strokeDashArray(strokeStyle.dash, strokeWidth);
  // 손그림(스케치) 스타일 — 켜진 도형은 rough.js 패스로 그린다(요소 id 시드로 결정적).
  const sketchStyle = kind !== "freehand" ? studioSketchStyleOfElement(el) : null;
  const roughGenerator = useStudioRoughGenerator(sketchStyle?.enabled === true);
  // 연속 가변 폭 아웃라인 브러시 — perfect 잉크뿐 아니라 G펜 계열도 같은 곡선 스트로커를
  // 사용한다. 짧은 직선 캡슐을 겹치던 과거 G펜 경로와 달리 급커브·필압 전환이 하나의
  // 닫힌 윤곽으로 이어진다. 프로필이 있으면 스트로커를 지연 로드한다.
  const perfectProfile = kind === "freehand"
    && el.mode !== "eraser"
    ? resolveStudioPerfectFreehandProfile(el.brush)
    : null;
  const outlineContractPresent = kind === "freehand"
    && el.outlineStroke !== undefined;
  const perfectStroker = useStudioPerfectFreehandStroker(
    perfectProfile !== null || outlineContractPresent,
  );

  const stampBrushKind = kind === "freehand" && el.mode !== "eraser"
    ? resolveStudioStampBrushKind(el.brush)
    : null;
  const dynamicBrushId = kind === "freehand" && el.mode !== "eraser"
    ? resolveStudioCapturedBrushDynamicsPresetId(el)
    : null;
  // Stamp and dynamic-dab renderers own their symmetry fan inside one bounded Shape. Do not build
  // and discard up to 64 complete transformed source-point arrays on every active-draft frame.
  const symmetricVariations = stampBrushKind || dynamicBrushId
    ? [el.points]
    : getSymmetricPoints(el.points, el.symmetry);
  // 활성 초안의 대칭 카피는 매 프레임 고정 인덱스 순서로 전부 그려지므로, 획 키 캐시가 보는
  // 작업 집합은 1이 아니라 카피 수다. 보관 한도보다 부채꼴이 넓으면 배치 플래너로 보내, 캐시가
  // 매 프레임 전멸하며 도입 이전보다 느려지는 일이 없게 한다.
  const oilDraftPlannersRetained = activeDraft
    && symmetricVariations.length <= STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS;
  // 보관 베드를 놓는 지점은 둘이다. 캡 포화 오일 획은 카피당 ~27k 런 객체를 들고 있어서, 그리기가
  // 끝난 뒤에도 붙들고 있으면 수십만 객체가 살아 있게 된다. 변형 초안은 동일한 DrawEl id를
  // 재사용하는 renderer-local 복사본일 뿐 이 슬롯의 소유자가 아니므로 전역 초안 상태를 건드리지
  // 않는다.
  //
  //  1. 초안이 끝나면 이 요소가 activeDraft=false 로 다시 그려진다 — 가장 흔한 종료 경로다.
  //  2. 그 렌더가 아예 오지 않는 종료 경로(제스처 취소, 미리보기 레이어 제거, 캔버스 언마운트)는
  //     실제 drawing-draft 소유자가 설치한 아래 정리가 유일한 해제 지점이다.
  //
  // 두 해제 모두 다른 초안이 이미 자리를 차지했으면 no-op 이라 순서에 안전하다.
  if (durableDocumentRender) {
    releaseStudioOilRibbonDraftPlanners(el.id);
    releaseOilBrushDabDraftPlanners(el.id);
  }
  useEffect(() => {
    if (!activeDraft) return undefined;
    // 발광 유지 패스는 이 인스턴스의 ref 라 오일 베드처럼 전역에서 회수할 필요가 없다. 초안이
    // 끝나는 모든 경로(커밋 리렌더·제스처 취소·언마운트)가 이 정리를 지나므로 여기 한 곳이면
    // 충분하고, 렌더 본문에서 ref 를 쓰지 않아 react-compiler 순수성 규약도 건드리지 않는다.
    const luminousPasses = fxLuminousRetainedPassesRef;
    return () => {
      releaseStudioOilRibbonDraftPlanners(el.id);
      releaseOilBrushDabDraftPlanners(el.id);
      luminousPasses.current = null;
    };
  }, [activeDraft, el.id]);
  const dynamicBrushPlanResult = dynamicBrushId
    ? planStudioDynamicBrushRender(el, dynamicBrushId, activeDraft, paperSurface)
    : null;
  const dynamicBrushPlanFailed = dynamicBrushPlanResult?.status === "rejected";
  const dynamicBrushPlan = dynamicBrushPlanResult?.status === "ready"
    ? dynamicBrushPlanResult.plan
    : null;
  const dynamicCoverageAndLegacyMarkPlan = dynamicBrushPlan
    ? planStudioDynamicBrushCoverageAndLegacyMarks({
        dabVariations: dynamicBrushPlan.dabVariations,
        dynamics: dynamicBrushPlan.dynamics,
        materialIdentity: dynamicBrushPlan.materialIdentity,
        dynamicSeed: dynamicBrushPlan.seed,
        stroke,
        stampGrid: dynamicBrushPlan.renderBudget.stampGrid,
        markBudget: dynamicBrushPlan.markBudget,
        // 종이 결은 획이 아니라 캔버스의 성질이라 요소 스냅샷이 아니라 렌더 플랜이 들고 온다.
        ...(dynamicBrushPlan.paper ? { paper: dynamicBrushPlan.paper } : {}),
      })
    : null;
  const dynamicCoverageMarkPlan = dynamicCoverageAndLegacyMarkPlan?.coveragePlan ?? null;

  // 브라우저 감사 진단(플래그 게이트): 커밋 렌더가 분기하기 전의 요소 라우팅 사실을 남긴다 —
  // "라이브는 dynamic 커버리지, 커밋은 알 수 없는 분기"였던 실측 모순의 최종 판별점.
  // 렌더 본문 부수효과는 react-compiler 계약 위반이라 커밋 후 이펙트에서 기록한다.
  useEffect(() => {
    if (
      !durableDocumentRender
      || kind !== "freehand"
      || el.mode === "eraser"
      || (globalThis as { __studioDynamicSealDebugEnabled?: boolean })
        .__studioDynamicSealDebugEnabled !== true
    ) {
      return;
    }
    (globalThis as {
      __studioCommitRouteDebug?: Record<string, unknown>;
    }).__studioCommitRouteDebug = {
      elId: el.id,
      brush: el.brush ?? null,
      brushCatalogId: el.brushCatalogId ?? null,
      dynamicBrushId,
      planStatus: dynamicBrushPlanResult?.status ?? null,
      coverageOk: dynamicCoverageMarkPlan?.ok ?? null,
      paintModel: el.paintModel ?? null,
      watercolorPipeline: el.watercolorPipeline ?? null,
      stampPipeline: el.stampPipeline ?? null,
      paperModel: el.paperModel ?? null,
      hasDynamics: typeof el.brushDynamics === "object" && el.brushDynamics !== null,
      pointCount: Math.floor(el.points.length / 2),
      stampBrushKind,
      perfectProfile: perfectProfile !== null,
    };
  }, [
    durableDocumentRender,
    dynamicBrushId,
    dynamicBrushPlanResult,
    dynamicCoverageMarkPlan,
    el,
    kind,
    perfectProfile,
    stampBrushKind,
  ]);

  return (
    <Group
      studioElementId={exposeSceneIdentity ? el.id : undefined}
      globalCompositeOperation={isEraserOperation ? "destination-out" : undefined}
      listening={false}
    >
      {symmetricVariations.map((points, index) => {
        // 손그림(스케치) 모드 — 모든 도형 종류를 rough.js 패스로 그린다. generator 로드 전이나
        // 지오메트리 부족으로 계획이 비면 아래 깨끗한 프리미티브 분기로 그대로 폴백한다.
        if (kind !== "freehand" && sketchStyle?.enabled && roughGenerator) {
          const sketchPlan = buildStudioRoughShapeRenderPlan(roughGenerator, {
            kind,
            points,
            strokeWidth,
            hasFill: Boolean(el.fill),
            shapeParams,
            style: sketchStyle,
            // 대칭 복제본은 index 오프셋으로 서로 다른(그러나 결정적인) 흔들림을 갖는다.
            seed: studioRoughSeedFromElementId(el.id) + index,
          });
          if (sketchPlan.length > 0) {
            const lineHeads =
              kind === "line" ? lineArrowHeadGeoms(points, strokeStyle, strokeWidth) : [];
            return (
              <Group key={index} opacity={opacity} listening={false}>
                {sketchPlan.map((path, pathIndex) =>
                  path.role === "outline" ? (
                    <Path
                      key={pathIndex}
                      data={path.data}
                      stroke={stroke}
                      strokeWidth={path.strokeWidth}
                      dash={shapeDash}
                      lineCap={strokeStyle.lineCap}
                      lineJoin="round"
                      globalCompositeOperation={composite}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  ) : path.role === "fill-hatch" ? (
                    <Path
                      key={pathIndex}
                      data={path.data}
                      stroke={el.fill}
                      strokeWidth={path.strokeWidth}
                      lineCap="round"
                      lineJoin="round"
                      globalCompositeOperation={composite}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  ) : (
                    <Path
                      key={pathIndex}
                      data={path.data}
                      fill={path.role === "outline-fill" ? stroke : el.fill}
                      globalCompositeOperation={composite}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  )
                )}
                {lineHeads.map((head, headIndex) =>
                  head.kind === "dot" ? (
                    <KCircle
                      key={`head-${headIndex}`}
                      x={head.cx}
                      y={head.cy}
                      radius={head.r}
                      fill={stroke}
                      globalCompositeOperation={composite}
                      listening={false}
                    />
                  ) : (
                    <Line
                      key={`head-${headIndex}`}
                      points={head.points}
                      closed
                      fill={stroke}
                      lineJoin="round"
                      globalCompositeOperation={composite}
                      listening={false}
                    />
                  )
                )}
              </Group>
            );
          }
        }

        if (kind === "rect") {
          const box = drawBounds(points);
          return (
            <Rect
              key={index}
              x={box.x}
              y={box.y}
              width={Math.max(0.1, box.width)}
              height={Math.max(0.1, box.height)}
              fill={el.fill}
              {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: Math.max(0.1, box.width), height: Math.max(0.1, box.height) })}
              {...konvaPatternProps(el.pattern, patternImage)}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              cornerRadius={effectiveCornerRadius(box.width, box.height, shapeParams.cornerRadius)}
              lineJoin="round"
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "ellipse") {
          const box = drawBounds(points);
          return (
            <Ellipse
              key={index}
              x={box.x + box.width / 2}
              y={box.y + box.height / 2}
              radiusX={Math.max(0.1, box.width / 2)}
              radiusY={Math.max(0.1, box.height / 2)}
              fill={el.fill}
              {...konvaGradientProps(el.gradient, { x: -box.width / 2, y: -box.height / 2, width: Math.max(0.1, box.width), height: Math.max(0.1, box.height) })}
              {...konvaPatternProps(el.pattern, patternImage)}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "star") {
          const box = drawBounds(points);
          return (
            <Star
              key={index}
              x={box.x + box.width / 2}
              y={box.y + box.height / 2}
              numPoints={shapeParams.starPoints}
              innerRadius={Math.max(0.1, (Math.min(box.width, box.height) / 2) * shapeParams.starInnerRatio)}
              outerRadius={Math.max(0.1, Math.min(box.width, box.height) / 2)}
              fill={el.fill}
              {...konvaGradientProps(el.gradient, { x: -Math.min(box.width, box.height) / 2, y: -Math.min(box.width, box.height) / 2, width: Math.max(0.1, Math.min(box.width, box.height)), height: Math.max(0.1, Math.min(box.width, box.height)) })}
              {...konvaPatternProps(el.pattern, patternImage)}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              lineJoin="round"
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "arrow") {
          return (
            <Arrow
              key={index}
              points={points}
              pointerLength={Math.max(8, strokeWidth * 2)}
              pointerWidth={Math.max(8, strokeWidth * 2)}
              fill={stroke}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              lineCap={strokeStyle.lineCap}
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "triangle") {
          const box = drawBounds(points);
          const layout = polygonPathNodeLayoutInBounds(box.x, box.y, box.width, box.height, 3);
          return (
            <Line
              key={index}
              x={layout.x}
              y={layout.y}
              points={[...layout.points]}
              closed
              fill={el.fill}
              {...konvaPatternProps(el.pattern, patternImage)}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              lineJoin="round"
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "polygon") {
          const box = drawBounds(points);
          const layout = polygonPathNodeLayoutInBounds(
            box.x,
            box.y,
            box.width,
            box.height,
            shapeParams.polygonSides,
          );
          return (
            <Line
              key={index}
              x={layout.x}
              y={layout.y}
              points={[...layout.points]}
              closed
              fill={el.fill}
              {...konvaPatternProps(el.pattern, patternImage)}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={shapeDash}
              lineJoin="round"
              globalCompositeOperation={composite}
              listening={false}
            />
          );
        }

        if (kind === "freehand") {
          const brush = el.brush ?? "pen";
          const brushFamily = resolveStudioBrushRenderFamily(brush);
          const aliasProfileEnabled =
            el.mode !== "eraser" || isStudioBrushEraserAliasId(brush);
          const isPerfectAliasBrush = brush.startsWith("perfect-");
          const pixelPencil = isStudioPixelPencilRenderMode(brush);
          const aliasStrokeWidth = aliasProfileEnabled
            ? studioBrushAliasEffectiveDiameter(brush, strokeWidth)
            : strokeWidth;
          const aliasPencilPasses = aliasProfileEnabled
            ? resolveStudioBrushAliasPencilPasses(brush)
            : [];
          const stampKind = stampBrushKind;
          const dynamicBrush = dynamicBrushId !== null;
          // Legacy documents predate the explicit causal-walker marker, but their four stamp
          // brushes still need the exact dab renderer for a one-point tap. The shared pure route
          // keeps Canvas, SVG and the future WebGPU playback contract in agreement.
          const singlePointRoute = resolveStudioBrushSinglePointRoute({
            brushId: brush,
            mode: el.mode,
            causalInkEnabled:
              el.sampleSpacing !== undefined || el.pressureModel !== undefined,
          });
          const renderSampleDistance = strokeRenderDistance(el.sampleSpacing);
          const pointCount = Math.floor(points.length / 2);
          const pointBounds = perfectProfile === null || pointCount < 2
            ? null
            : points.reduce<{ minX: number; minY: number; maxX: number; maxY: number }>((
              bounds,
              point,
              index,
            ) => {
              if (index % 2 === 1) return bounds;
              return {
                minX: Math.min(bounds.minX, point),
                maxX: Math.max(bounds.maxX, point),
                minY: Math.min(bounds.minY, points[index + 1]!),
                maxY: Math.max(bounds.maxY, points[index + 1]!),
              };
            }, {
              minX: points[0] ?? 0,
              maxX: points[0] ?? 0,
              minY: points[1] ?? 0,
              maxY: points[1] ?? 0,
            });
          const strokeSpanX = pointBounds ? pointBounds.maxX - pointBounds.minX : 0;
          const strokeSpanY = pointBounds ? pointBounds.maxY - pointBounds.minY : 0;
          const strokeDistance = Math.hypot(strokeSpanX, strokeSpanY);
          const isCompactPerfectDotRoute = isPerfectAliasBrush
            && singlePointRoute === "generic-dot"
            && pointCount <= 4
            && strokeDistance < 16;

          if (pixelPencil && el.mode !== "eraser") {
            const pixelPlan = planStudioPixelPencilCells({ points, strokeWidth: aliasStrokeWidth });
            if (!pixelPlan.complete) return null;
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  context.save();
                  context.fillStyle = stroke;
                  fillStudioPixelPencilCells(context, pixelPlan.cells);
                  context.restore();
                }}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
                perfectDrawEnabled={false}
              />
            );
          }

          if (outlineContractPresent) {
            const outlinePlanInput = {
              contract: el.outlineStroke,
              stroker: perfectStroker,
              points,
              // New outline contracts record canonical renderer pressure at pointer capture.
              // Applying the mutable brush-alias adapter again here would double-map that input.
              pressures: el.pressures,
              // The durable contract, rather than the mutable brush catalogue, owns alias scale.
              strokeWidth,
              sampleSpacing: el.sampleSpacing,
              legacyMinDistance: renderSampleDistance,
            };
            // 활성 초안은 요소 id 로 키된 증분 플래너가 크로키 캡슐 링·pathData 의 안정
            // prefix 를 유지한다(장획 게이트 capsule-outline; 다른 엔진은 내부에서 배치 위임).
            // 커밋 렌더는 배치 리플레이를 유지해 내부 점 재작성에도 항상 정본을 그린다.
            // 대칭 변형은 같은 요소를 변형된 점 배열로 여러 번 그린다 — 변형 인덱스를 획
            // 키에 포함해 변형끼리 유지 플래너(내부 보관 배열)를 공유하지 않게 한다(P2 리뷰).
            const outlinePlan = activeDraft
              ? planStudioPerfectFreehandRenderIncremental(`${el.id}#${index}`, outlinePlanInput)
              : planStudioPerfectFreehandRender(outlinePlanInput);
            if (outlinePlan.kind === "outline") {
              return (
                <Path
                  key={index}
                  data={outlinePlan.pathData}
                  fill={stroke}
                  opacity={opacity}
                  globalCompositeOperation={composite}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              );
            }
            if (outlinePlan.kind === "fallback-line") {
              const capRadius = outlinePlan.line.endpointCapRadius;
              const linePoints = outlinePlan.line.points;
              const hasLineStart = linePoints.length >= 2;
              const hasDistinctLineEnd = linePoints.length >= 4
                && (
                  linePoints[0] !== linePoints[linePoints.length - 2]
                  || linePoints[1] !== linePoints[linePoints.length - 1]
                );
              return (
                <Group
                  key={index}
                  name="studio-outline-contract-fallback"
                  opacity={opacity}
                  listening={false}
                >
                  <Line
                    points={[...linePoints]}
                    stroke={stroke}
                    strokeWidth={outlinePlan.line.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    tension={outlinePlan.line.tension}
                    globalCompositeOperation={composite}
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                  />
                  {capRadius !== null && hasLineStart ? (
                    <KCircle
                      x={linePoints[0]!}
                      y={linePoints[1]!}
                      radius={capRadius}
                      fill={stroke}
                      globalCompositeOperation={composite}
                      listening={false}
                    />
                  ) : null}
                  {capRadius !== null && hasDistinctLineEnd ? (
                    <KCircle
                      x={linePoints[linePoints.length - 2]!}
                      y={linePoints[linePoints.length - 1]!}
                      radius={capRadius}
                      fill={stroke}
                      globalCompositeOperation={composite}
                      listening={false}
                    />
                  ) : null}
                </Group>
              );
            }
            if (outlinePlan.kind !== "legacy-contract") {
              const finitePairs = Array.from(
                { length: Math.floor(points.length / 2) },
                (_, pointIndex) => ({
                  x: points[pointIndex * 2],
                  y: points[pointIndex * 2 + 1],
                }),
              ).filter(
                (point): point is { x: number; y: number } =>
                  Number.isFinite(point.x) && Number.isFinite(point.y),
              );
              const minX = finitePairs.length > 0
                ? Math.min(...finitePairs.map((point) => point.x))
                : 0;
              const minY = finitePairs.length > 0
                ? Math.min(...finitePairs.map((point) => point.y))
                : 0;
              const maxX = finitePairs.length > 0
                ? Math.max(...finitePairs.map((point) => point.x))
                : minX;
              const maxY = finitePairs.length > 0
                ? Math.max(...finitePairs.map((point) => point.y))
                : minY;
              const width = Math.max(16, maxX - minX);
              const height = Math.max(16, maxY - minY);
              const issueName = outlinePlan.kind === "unsupported-contract"
                ? outlinePlan.issue.code
                : outlinePlan.reason;
              // Unknown contract revisions and damaged recorded pressure must never be rendered as
              // a plausible but different legacy stroke. A compact magenta diagnostic keeps the
              // failure visible on canvas while SVG reports a structured skip receipt.
              return (
                <Group
                  key={index}
                  name={`studio-outline-contract-error:${issueName}`}
                  listening={false}
                >
                  <Rect
                    x={minX}
                    y={minY}
                    width={width}
                    height={height}
                    stroke="#ff2f7d"
                    strokeWidth={1.5}
                    dash={[4, 3]}
                    opacity={0.9}
                    listening={false}
                  />
                  <Line
                    points={[minX, minY, minX + width, minY + height]}
                    stroke="#ff2f7d"
                    strokeWidth={1.5}
                    opacity={0.9}
                    listening={false}
                  />
                  <Line
                    points={[minX + width, minY, minX, minY + height]}
                    stroke="#ff2f7d"
                    strokeWidth={1.5}
                    opacity={0.9}
                    listening={false}
                  />
                </Group>
              );
            }
          }

          if (
            points.length === 2
            && singlePointRoute === "generic-dot"
            && perfectProfile === null
            && aliasPencilPasses.length > 0
          ) {
            const sourcePressure = el.pressures?.[0] ?? 0.5;
            const pressureProfile = resolveStudioRetainedMediaPressureProfileId(brush)
              ?? "pencil";
            const pressureResponse = resolveStudioRetainedMediaPressure(
              pressureProfile,
              el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
                ? sourcePressure
                : undefined,
              el.materialMinimumDiameterRatio,
            );
            return (
              <Group key={index} opacity={opacity} listening={false}>
                {aliasPencilPasses.map((pass, passIndex) => (
                  <KCircle
                    key={`${pass.role}-${passIndex}`}
                    x={points[0]}
                    y={points[1]}
                    radius={resolveStudioDrawTapRadius(
                      activeDraft,
                      Math.max(
                        0.35,
                        aliasStrokeWidth
                        * pass.widthScale
                        * pressureResponse.sizeScale
                        / 2,
                      ),
                    )}
                    fill={stroke}
                    opacity={Math.min(
                      1,
                      pass.opacityScale
                      * Math.sqrt(
                        pressureResponse.opacityScale
                        * pressureResponse.flowScale,
                      ),
                    )}
                    globalCompositeOperation={composite}
                    listening={false}
                  />
                ))}
              </Group>
            );
          }

          if (
            points.length === 2 &&
            singlePointRoute === "generic-dot"
            && !isPerfectAliasBrush
          ) {
            const sourcePressure = Math.min(1, Math.max(0, el.pressures?.[0] ?? 0.5));
            const pressure = aliasProfileEnabled
              ? mapStudioBrushAliasPressure(brush, sourcePressure, 0.5)
              : sourcePressure;
            const retainedPressureProfile =
              resolveStudioRetainedMediaPressureProfileId(brush);
            const retainedPressure = retainedPressureProfile
              ? resolveStudioRetainedMediaPressure(
                  retainedPressureProfile,
                  el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
                    ? sourcePressure
                    : undefined,
                  el.materialMinimumDiameterRatio,
                )
              : null;
            const pressureAware = el.mode === "eraser"
              || brushFamily === "pen"
              || brushFamily === "gpen"
              || brushFamily === "calligraphy"
              || isPerfectAliasBrush
              || brushFamily === "marker"
              || retainedPressure !== null;
            const width = retainedPressure
              ? aliasStrokeWidth * retainedPressure.sizeScale
              : pressureAware
                ? aliasStrokeWidth * (0.3 + pressure * 1.4)
                : aliasStrokeWidth;
            if (brushFamily === "highlighter") {
              const pressureBrush = isStudioFxPressureBrushId(brush)
                ? brush
                : "highlighter";
              const pressureResponse = resolveStudioFxBrushTapPressureResponse(
                pressureBrush,
                sourcePressure,
                el.materialPressureModel,
                el.materialMinimumDiameterRatio,
              );
              const tapWidth = aliasStrokeWidth * pressureResponse.widthScale;
              const washPlan = planStudioHighlighterWashTap({
                brushId: resolveStudioHighlighterWashBrushId(brush),
                x: points[0],
                y: points[1],
                width: tapWidth,
                opacityScale: pressureResponse.opacityScale,
              });
              return (
                <Shape
                  key={index}
                  sceneFunc={(context) => {
                    if (washPlan.runs.length === 0) return;
                    context.save();
                    context.globalAlpha *= washPlan.opacityScale;
                    context.fillStyle = stroke;
                    context.beginPath();
                    traceStudioHighlighterWashPlan(context, washPlan);
                    context.fill();
                    context.restore();
                  }}
                  opacity={opacity}
                  globalCompositeOperation="multiply"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              );
            }
            if (brushFamily === "brush" || brushFamily === "calligraphy") {
              const calligraphyRoundness = brushFamily === "calligraphy"
                ? Math.min(1, Math.max(0.08, el.brushTip?.roundness ?? 0.35))
                : 0.36;
              const angle = brushFamily === "calligraphy"
                ? el.brushTip?.angleDeg ?? -30
                : -30;
              return (
                <Ellipse
                  key={index}
                  x={points[0]}
                  y={points[1]}
                  radiusX={Math.max(0.35, width / 2)}
                  radiusY={Math.max(0.35, width * calligraphyRoundness / 2)}
                  rotation={angle}
                  fill={stroke}
                  opacity={opacity}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              );
            }
            if (perfectProfile) {
              const dotWidth = Math.max(Math.max(aliasStrokeWidth, 2), width);
              const minimumDotRadius = brush === "perfect-ink" ? 3 : 1.4;
              return (
                <KCircle
                  key={index}
                  x={points[0]}
                  y={points[1]}
                  radius={Math.max(minimumDotRadius, dotWidth / 2)}
                  fill={stroke}
                  opacity={opacity}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              );
            }
            return (
              <KCircle
                key={index}
                x={points[0]}
                y={points[1]}
                radius={resolveStudioDrawTapRadius(activeDraft, Math.max(0.35, width / 2))}
                fill={stroke}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (
            points.length <= 4 &&
            singlePointRoute === "generic-dot"
            && isCompactPerfectDotRoute
          ) {
            const sourcePressure = Math.min(1, Math.max(0, el.pressures?.[0] ?? 0.5));
            const pressure = el.mode === "eraser"
              ? sourcePressure
              : mapStudioBrushAliasPressure(brush, sourcePressure, 0.5);
            const pressureAware = el.mode === "eraser"
              || brushFamily === "pen"
              || brushFamily === "gpen"
              || brushFamily === "calligraphy"
              || isPerfectAliasBrush
              || brushFamily === "marker";
            const width = pressureAware
              ? aliasStrokeWidth * (0.3 + pressure * 1.4)
              : aliasStrokeWidth;
            if (perfectProfile) {
              const dotWidth = Math.max(Math.max(aliasStrokeWidth, 2), width);
              const minimumDotRadius = brush === "perfect-ink" ? 3 : 1.4;
              return (
                <KCircle
                  key={index}
                  x={points[0]}
                  y={points[1]}
                  radius={Math.max(minimumDotRadius, dotWidth / 2)}
                  fill={stroke}
                  opacity={opacity}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              );
            }
            return (
              <KCircle
                key={index}
                x={points[0]}
                y={points[1]}
                radius={resolveStudioDrawTapRadius(activeDraft, Math.max(0.35, width / 2))}
                fill={stroke}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          {
            // 스탬프 엔진 계열(속도 잉크·정밀 에어브러시·그레인 연필·물맛 붓): 라이브 프리뷰와
            // 커밋이 같은 결정적 dab 시퀀스를 그린다 — 증분/재생/협업 복원에서 픽셀이 동일하다.
            if (stampKind) {
              return (
                <StudioStampDrawShape
                  key={index}
                  composite={composite}
                  el={el}
                  opacity={opacity}
                  renderSampleDistance={renderSampleDistance}
                  stampKind={stampKind}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              );
            }
          }

          if (dynamicBrush && el.mode !== "eraser") {
            if (
              dynamicBrushPlanFailed
              || !dynamicBrushPlan
              || (
                dynamicBrushPlan.usesCausalDepositPlan
                && !dynamicCoverageMarkPlan?.ok
              )
            ) {
              return null;
            }
            const legacyMarks = dynamicCoverageAndLegacyMarkPlan?.legacyMarks ?? [];
            // 브라우저 감사 진단(플래그 게이트): 커밋 sceneFunc이 실제로 택한 분기와 커버리지
            // 렌더 결과를 남긴다 — 계획은 풍부한데 커밋 픽셀이 희미한 실측 모순의 최종 판별점.
            const commitRenderDebugEnabled = durableDocumentRender
              && (globalThis as { __studioDynamicSealDebugEnabled?: boolean })
                .__studioDynamicSealDebugEnabled === true;
            const recordCommitRenderDebug = (
              branch: string,
              result: unknown,
            ): void => {
              if (!commitRenderDebugEnabled) return;
              const planMarks = dynamicCoverageMarkPlan?.ok
                ? dynamicCoverageMarkPlan.marks
                : [];
              (globalThis as {
                __studioCommitRenderDebug?: Record<string, unknown>;
              }).__studioCommitRenderDebug = {
                elId: el.id,
                branch,
                result,
                markCount: dynamicCoverageMarkPlan?.ok ? planMarks.length : -1,
                // 인앱 커밋 플랜의 강도 요약 — 오프라인 프로브와의 마지막 비교점.
                alphaPeak: planMarks.reduce((m, mark) => Math.max(m, mark.alpha), 0),
                energy: planMarks.reduce(
                  (sum, mark) => sum + mark.alpha * mark.radiusX * mark.radiusY,
                  0,
                ),
                textured: planMarks.filter((mark) => mark.texture).length,
                ribbons: planMarks.filter((mark) => mark.ribbon).length,
                legacyMarkCount: legacyMarks.length,
                opacity,
                at: performance.now(),
              };
            };
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (
                    dynamicCoverageMarkPlan?.ok
                    && isStudioBoundedFlowPaintModelCompatible(el)
                  ) {
                    const rendered = renderStudioDynamicBrushCoverage(
                      context,
                      dynamicCoverageMarkPlan.marks,
                      {
                        activeDraft,
                        opacity,
                        ...(durableDocumentRender
                          ? { committedCacheKey: el.id }
                          : {}),
                      },
                    );
                    recordCommitRenderDebug("bounded-flow-coverage", rendered);
                    // bounded-flow-v2 owns stroke opacity as one final coverage composite. A
                    // surface/budget failure must remain empty (or retain a partial prefix) rather
                    // than replaying marks with opacity on every dab, which would irreversibly
                    // darken overlaps and change the persisted paint model.
                    return;
                  }
                  // Only omitted/legacy paint models retain historical per-dab opacity pixels.
                  // A malformed causal mark plan is rejected before this Shape is constructed.
                  renderStudioDynamicBrushLegacyMarks(context, legacyMarks, opacity);
                  recordCommitRenderDebug("legacy-marks", null);
                }}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (perfectProfile && el.mode !== "eraser") {
            const debug = durableDocumentRender
              && typeof globalThis !== "undefined"
              && (globalThis as { __debugPerfectInk?: boolean }).__debugPerfectInk;
            if (debug) {
              console.log(
                `[debug-perfect-ink] render brush=${brush} mode=${el.mode} points=${pointCount} stroker=${perfectStroker ? "loaded" : "missing"}`
              );
            }
            // 퍼펙트-프리핸드(tldraw 필기감): 필압·테이퍼가 새겨진 아웃라인 폴리곤을 선 색으로
            // 채운다(stroked Line 대체). getStroke는 순수 함수라 협업 복제본·재렌더에서 결정적.
            // 라이브 계약(§핫패스): 다이렉트 라이브 초안 파이프라인(임페러티브 sceneFunc/WebGPU)
            // 은 pen/marker 전용이며 여기서 건드리지 않는다 — "perfect" 패밀리 초안은 리테인드
            // 경로로 이 브랜치를 그대로 지나고, pointer-up 커밋 스왑 계약도 동일하게 유지된다.
            // 아주 짧은 스토크는 경량 Line 폴백이 더 안정적이다.
            // 퍼펙트 경로 생성은 짧은 이동에서 Path가 1픽셀 이하로만 변화해 보이지 않는 경우가 있다.
            // 브러시 검증 시 false negative를 만들 수 있다.
            // The historical perfect-* profiles deliberately keep their compact tap fallback.
            // G-pen nibs must not use it: even a two-point flick needs pressure and taper geometry.
            const isVeryShortPerfectStroke = brushFamily === "perfect"
              && pointCount <= 3
              && strokeDistance < 16;
            const sparseSpacingPx = strokeDistance / Math.max(1, pointCount - 1);
            const isSparseLongPerfectStroke = perfectProfile.id === "perfect-ink"
              && pointCount >= 4
              && strokeDistance >= 180
              && sparseSpacingPx >= Math.max(20, aliasStrokeWidth * 4);
            if (debug) {
              setPerfectInkDebugState({
                brush,
                pointCount,
                strokeDistance,
                isVeryShort: isVeryShortPerfectStroke,
                isSparseLong: isSparseLongPerfectStroke,
                profile: perfectProfile.id,
              });
            }
            if (isVeryShortPerfectStroke || isSparseLongPerfectStroke) {
              const perfectFallback = resolveStudioFreehandRenderPath(points, {
                sampleSpacing: el.sampleSpacing,
                acceptedTension: 0.32,
                legacyMinDistance: renderSampleDistance,
                legacyTension: 0.4,
              });
              const lineWidth = Math.max(aliasStrokeWidth, 2);
              const dotRadius = Math.max(2, lineWidth * 0.22);
              return (
                <Group key={index} opacity={opacity} listening={false}>
                  <Line
                    points={perfectFallback.points}
                    stroke={stroke}
                    strokeWidth={lineWidth}
                    lineCap="round"
                    lineJoin="round"
                    tension={perfectFallback.tension}
                    globalCompositeOperation={composite}
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                  />
                  {perfectFallback.points.length >= 4 ? (
                    <>
                      <KCircle
                        x={perfectFallback.points[0]!}
                        y={perfectFallback.points[1]!}
                        radius={dotRadius}
                        fill={stroke}
                        opacity={opacity}
                        globalCompositeOperation={composite}
                        listening={false}
                      />
                      <KCircle
                        x={perfectFallback.points[perfectFallback.points.length - 2]!}
                        y={perfectFallback.points[perfectFallback.points.length - 1]!}
                        radius={dotRadius}
                        fill={stroke}
                        opacity={opacity}
                        globalCompositeOperation={composite}
                        listening={false}
                      />
                    </>
                  ) : null}
                </Group>
              );
            }
            if (perfectStroker) {
              const outlinePressures = brushFamily === "gpen"
                || (el.pressures && el.pressures.length > 0)
                ? mapStudioBrushAliasPressureSamples(
                    brush,
                    el.pressures,
                    pointCount,
                    brushFamily === "gpen" ? 0.6 : 0.5,
                  )
                : el.pressures;
              const perfectOutline = buildStudioPerfectFreehandOutline(perfectStroker, {
                points,
                pressures: outlinePressures,
                strokeWidth: aliasStrokeWidth,
                profile: perfectProfile,
              });
              const perfectPathData = studioPerfectFreehandOutlineToPathData(perfectOutline);
              const perfectOutlineBounds = perfectOutline.length < 2
                ? null
                : perfectOutline.reduce<{ minX: number; maxX: number; minY: number; maxY: number }>(
                  (bounds, point) => ({
                    minX: Math.min(bounds.minX, point[0]),
                    maxX: Math.max(bounds.maxX, point[0]),
                    minY: Math.min(bounds.minY, point[1]),
                    maxY: Math.max(bounds.maxY, point[1]),
                  }),
                  {
                    minX: perfectOutline[0]?.[0] ?? 0,
                    maxX: perfectOutline[0]?.[0] ?? 0,
                    minY: perfectOutline[0]?.[1] ?? 0,
                    maxY: perfectOutline[0]?.[1] ?? 0,
                  },
                );
              const outlineSpanX = perfectOutlineBounds
                ? perfectOutlineBounds.maxX - perfectOutlineBounds.minX
                : 0;
              const outlineSpanY = perfectOutlineBounds
                ? perfectOutlineBounds.maxY - perfectOutlineBounds.minY
                : 0;
              const outlineDistance = Math.hypot(outlineSpanX, outlineSpanY);
              const isDegeneratePerfectPath = perfectOutline.length < 12
                && strokeDistance < 120
                || outlineDistance < Math.max(6, strokeDistance * 0.35);
              if (debug) {
                console.log(
                  `[debug-perfect-ink] pathDecision brush=${brush} points=${pointCount} ` +
                    `strokeDistance=${strokeDistance.toFixed(1)} ` +
                    `outlineDistance=${outlineDistance.toFixed(1)} ` +
                    `outlinePoints=${perfectOutline.length} ` +
                    `isDegenerate=${isDegeneratePerfectPath ? "true" : "false"} ` +
                    `pathLen=${perfectPathData.length}`
                );
                setPerfectInkDebugState({
                  brush,
                  pointCount,
                  strokeDistance,
                  isVeryShort: isVeryShortPerfectStroke,
                  isSparseLong: isSparseLongPerfectStroke,
                  profile: perfectProfile.id,
                  outlineDistance,
                  outlinePointCount: perfectOutline.length,
                  isDegeneratePath: isDegeneratePerfectPath,
                });
              }
              if (perfectPathData && !isDegeneratePerfectPath) {
                return (
                  <Path
                    key={index}
                    data={perfectPathData}
                    fill={stroke}
                    opacity={opacity}
                    globalCompositeOperation={composite}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
              }
            }
            // 스트로커 로드 전/지오메트리 부족 — 깨끗한 Line 폴백(로드 완료 시 훅 상태로 재렌더).
            const perfectFallback = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              acceptedTension: 0.32,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0.4,
            });
            return (
              <Line
                key={index}
                points={perfectFallback.points}
                stroke={stroke}
                strokeWidth={aliasStrokeWidth}
                opacity={opacity}
                lineCap="round"
                lineJoin="round"
                tension={perfectFallback.tension}
                globalCompositeOperation={composite}
                listening={false}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            );
          }

          if (brushFamily === "calligraphy" && el.mode !== "eraser") {
            const smoothed = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0,
            }).points;
            const sourcePointCount = Math.floor(points.length / 2);
            const sampleCount = Math.min(
              sourcePointCount,
              Math.max(el.tiltXs?.length ?? 0, el.tiltYs?.length ?? 0, el.twists?.length ?? 0)
            );
            const stylusSamples: CalligraphyStylusInput[] = Array.from(
              { length: sampleCount },
              (_, sampleIndex) => ({
                pointerType: "pen",
                tiltX: el.tiltXs?.[sampleIndex],
                tiltY: el.tiltYs?.[sampleIndex],
                twist: el.twists?.[sampleIndex],
              })
            );
            const segments = buildCalligraphySegments(
              smoothed,
              mapStudioBrushAliasPressureSamples(
                brush,
                el.pressures,
                sourcePointCount,
                0.5,
              ),
              stylusSamples,
              aliasStrokeWidth,
              // Pre-nib-table documents carry no brushTip; the catalogue nib stands in so a stored
              // fountain/parallel pen renders as the pen it was drawn with.
              resolveStudioCalligraphyRenderTip(brush, el.brushTip)
            );
            const ribbon = planStudioCalligraphyRibbon(segments);
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (ribbon.runs.length === 0 && smoothed.length >= 2) {
                    context.beginPath();
                    context.arc(smoothed[0]!, smoothed[1]!, Math.max(0.5, aliasStrokeWidth * 0.18), 0, Math.PI * 2);
                    context.fillStyle = stroke;
                    context.fill();
                    return;
                  }
                  context.beginPath();
                  for (const run of ribbon.runs) {
                    const [firstX, firstY, ...outlineTail] = run.outlinePoints;
                    if (firstX === undefined || firstY === undefined) continue;
                    context.moveTo(firstX, firstY);
                    for (let pointIndex = 0; pointIndex < outlineTail.length; pointIndex += 2) {
                      context.lineTo(
                        outlineTail[pointIndex]!,
                        outlineTail[pointIndex + 1]!,
                      );
                    }
                    context.closePath();
                    context.moveTo(run.startCap.x + run.startCap.radius, run.startCap.y);
                    context.arc(
                      run.startCap.x,
                      run.startCap.y,
                      run.startCap.radius,
                      0,
                      Math.PI * 2,
                    );
                    context.moveTo(run.endCap.x + run.endCap.radius, run.endCap.y);
                    context.arc(
                      run.endCap.x,
                      run.endCap.y,
                      run.endCap.radius,
                      0,
                      Math.PI * 2,
                    );
                  }
                  context.fillStyle = stroke;
                  context.fill();
                }}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (brushFamily === "brush" && el.mode !== "eraser") {
            const smoothed = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0,
            }).points;
            const coveragePressureInput =
              el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
                ? {
                    profileId: brush === "flat-brush"
                      ? ("flat-brush" as const)
                      : brush === "marker--chisel-ribbon"
                        ? ("marker-chisel" as const)
                        : ("brush" as const),
                    pressures: el.pressures,
                    minimumDiameterRatio: el.materialMinimumDiameterRatio,
                    // The bands carry ABSOLUTE alpha, so the element opacity is folded in by the
                    // planner and the Shape below must not apply it a second time.
                    elementOpacity: opacity,
                  }
                : undefined;
            // 활성 초안은 요소 id 로 키된 증분 빌더가 세그먼트 폴리곤/밀도의 안정 prefix 를
            // 유지한다(장획 게이트 angled-ribbon; 톤 밴딩은 의도적 전역 설계라 매 호출 접는다).
            // 커밋 렌더는 배치 리플레이를 유지해 항상 정본을 그린다.
            const coveragePlan = activeDraft
              ? planStudioAngledNibStrokeLocalCoverageIncremental(
                  // 변형 인덱스로 키 격리 — 변형 간 내부 보관 배열 공유 금지(P2 리뷰).
                  `${el.id}#${index}`,
                  smoothed,
                  aliasStrokeWidth,
                  -Math.PI / 6,
                  coveragePressureInput,
                )
              : planStudioAngledNibStrokeLocalCoverage(
                  smoothed,
                  aliasStrokeWidth,
                  -Math.PI / 6,
                  coveragePressureInput,
                );
            // One band means the mark has no resolvable tonal range. That is the emission this
            // carrier has always had — one compound fill at the element's own opacity — and it
            // stays on the original code path, untouched, so saved documents replay to the byte.
            const tonal = coveragePlan.bands.length > 1;
            // The raster is normalised to the darkest band, so the mark's own peak alpha is
            // carried by the Shape and Konva applies it once — which is also what clamps an
            // overlap to the deepest band instead of letting two bands sum past it.
            const tonalOpacity = coveragePlan.bands[0]?.opacity ?? opacity;
            return (
              <Shape
                key={index}
                sceneFunc={(context, shape) => {
                  if (coveragePlan.polygons.length === 0) return;
                  if (tonal) {
                    // Device scale = the layer's own pixel ratio times everything the stage and
                    // its groups scale this node by. Rasterising at anything less would make the
                    // mark go soft the moment the artboard is zoomed in.
                    const nodeScale = shape.getAbsoluteScale();
                    const raster = rasterizeStudioCoverageBands(
                      coveragePlan.bands,
                      stroke,
                      context.getCanvas().getPixelRatio()
                        * Math.max(Math.abs(nodeScale.x), Math.abs(nodeScale.y)),
                    );
                    if (raster) {
                      context.drawImage(
                        raster.source,
                        0,
                        0,
                        raster.sourceWidth,
                        raster.sourceHeight,
                        raster.x,
                        raster.y,
                        raster.width,
                        raster.height,
                      );
                      return;
                    }
                    // Surface refused (no document, or a mark too large to scratch). Falling
                    // through paints the silhouette flat rather than dropping the stroke.
                  }
                  context.beginPath();
                  for (const polygon of coveragePlan.polygons) {
                    context.moveTo(polygon.points[0]!, polygon.points[1]!);
                    for (
                      let coordinateIndex = 2;
                      coordinateIndex < polygon.points.length;
                      coordinateIndex += 2
                    ) {
                      context.lineTo(
                        polygon.points[coordinateIndex]!,
                        polygon.points[coordinateIndex + 1]!,
                      );
                    }
                    context.closePath();
                  }
                  // All subpaths now have one winding, so non-zero fill is a monotonic union.
                  // Konva applies the Shape opacity once to this complete stroke-local coverage.
                  context.fillStrokeShape(shape);
                }}
                fill={stroke}
                opacity={tonal ? tonalOpacity : opacity}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (brushFamily === "watercolor" && el.mode !== "eraser") {
            const causalWatercolor = el.watercolorPipeline === "causal-walker-v2";
            const wetInkReplayPlan = planStudioInteractiveWetInkBrushReplay(
              { ...el, points },
              { phase: activeDraft ? "live" : "committed" },
            );
            const aliasPlanSettings = resolveStudioBrushAliasWatercolorPlanSettings(
              brush,
              strokeWidth,
            );
            const watercolorPressures = mapStudioBrushAliasPressureSamples(
              brush,
              el.pressures,
              Math.floor(points.length / 2),
              0.55,
            );
            const watercolorSeed = watercolorBrushSeedFromKey(el.id);
            // Legacy documents retain their fitted whole-stroke stations. New strokes use raw,
            // already-accepted samples and a residual arc-length cursor, so extending a prefix can
            // append pigment but can never move pigment that was already visible.
            const watercolorInput = {
              points: causalWatercolor
                ? points
                : processFreehandPoints(points, renderSampleDistance),
              pressures: watercolorPressures,
              baseWidth: aliasPlanSettings?.baseWidth ?? strokeWidth,
              spacing: aliasPlanSettings?.spacing,
              seed: watercolorSeed,
              // Causal stations do not redistribute at the cap, so they need the larger shared
              // bound. Legacy documents keep their historical 512-dab fit and exact old pixels.
              maxDabs: causalWatercolor
                ? DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS
                : 512,
              // The endpoint cap belongs only to this replaceable active replay. Permanent causal
              // stations stay prefix-stable, while pointer-up no longer grows the visible stroke.
              previewEndpoint: causalWatercolor && activeDraft,
            };
            // 활성 초안은 점 배열이 append 전용이므로 요소 id 로 키된 증분 파이프라인이
            // 플래너·재질 스케일·습식 리본 캐리어의 안정 prefix 를 함께 보관해 새 표본만 걷는다
            // (이동당 O(1) — 장획 게이트 wet-dabs). 웻 텍스처 프로그램이 핀된 레인은 전획 물리
            // 단계 때문에 파이프라인이 null 을 돌려주고 아래 배치 체인으로 내려간다. 커밋 렌더는
            // 오늘처럼 배치 리플레이를 유지해 후처리 워커의 전면 치환 같은 내부 점 재작성에도
            // 항상 정본을 그린다.
            const liveWetWashPlan = causalWatercolor && activeDraft
              // 변형 인덱스로 키 격리 — 변형 간 내부 보관 배열 공유 금지(P2 리뷰).
              ? planStudioWetWashLivePipeline(`${el.id}#${index}`, {
                  brushId: brush,
                  enginePrograms: el.brushEnginePrograms,
                  input: watercolorInput,
                  carrierSeed: watercolorSeed,
                })
              : null;
            const plannedDabs = liveWetWashPlan
              ? liveWetWashPlan.dabs
              : causalWatercolor
                ? activeDraft
                  ? planCausalWatercolorBrushDabsIncremental(`${el.id}#${index}`, watercolorInput, false)
                  : planCausalWatercolorBrushDabs(watercolorInput, true)
                : planWatercolorBrushDabs(watercolorInput);
            // The stroke seed feeds the opt-in wet-edge-bloom lanes; SVG export passes the same
            // seed at its two watercolor sites so Canvas and SVG stay pixel-agreeing.
            // The phase gates only the opt-in living-ink settled bake (2026-08-13 wave 3): the
            // fluid field is global, so live drafts render the base wash and the bloom lands on
            // settle — SVG export is settled by definition and passes "settled" at both sites.
            //
            // 2026-08-14 stall fix: the settled bake is a whole-stroke fluid solve measured at
            // 30–116ms — it must never run synchronously in this render body. The "live" result
            // below is byte-identical to the bake's input (the bake augments AFTER material
            // scaling and is identity for the live phase), so bake lanes render that base wash
            // now and request the settled augment from the time-sliced deterministic cache; the
            // bloom lands when the job completes — the settled-bake contract's own drying
            // language. Program resolution mirrors applyStudioBrushAliasWatercolorMaterial's
            // one-authority order (wet-edge-bloom pin wins; bake consulted only without it), so
            // lanes without a bake program keep the exact single-call path and bytes.
            const laneWatercolorMaterial =
              resolveStudioBrushEngineLaneWatercolorMaterial(brush);
            // 커스텀 프로그램 세트 오버라이드가 레인 핀보다 우선한다(단일 권위:
            // applyStudioBrushAliasWatercolorMaterial과 같은 순서).
            const watercolorOverride = el.brushEnginePrograms?.watercolor ?? null;
            const resolvedWetEdgeBloomProgramId =
              watercolorOverride?.wetEdgeBloomProgramId
              ?? laneWatercolorMaterial?.wetEdgeBloomProgramId;
            const livingInkBakeProgramId = !resolvedWetEdgeBloomProgramId
              ? (watercolorOverride?.livingInkBakeProgramId
                ?? laneWatercolorMaterial?.livingInkBakeProgramId)
              : undefined;
            const livingInkBakeProgram =
              durableDocumentRender && livingInkBakeProgramId
                ? resolveStudioLivingInkSettledBakeProgram(livingInkBakeProgramId)
                : null;
            let dabs: readonly StudioBrushAliasWatercolorDab[];
            if (liveWetWashPlan) {
              // 파이프라인이 재질 스케일까지 끝냈다(프로그램 없는 레인만 진입하므로 배치의
              // apply 결과와 값 동일).
              dabs = liveWetWashPlan.dabs;
            } else if (livingInkBakeProgram) {
              const baseDabs = applyStudioBrushAliasWatercolorMaterial(
                brush,
                plannedDabs,
                watercolorSeed,
                "live",
                el.brushEnginePrograms,
              );
              dabs =
                requestStudioLivingInkSettledBakeDabs(
                  baseDabs,
                  {
                    ...livingInkBakeProgram,
                    seed: watercolorSeed,
                    phase: "settled",
                  },
                  notifyLivingInkBakeReady,
                  livingInkBakeGeneration,
                ) ?? baseDabs;
            } else {
              dabs = applyStudioBrushAliasWatercolorMaterial(
                brush,
                plannedDabs,
                watercolorSeed,
                activeDraft ? "live" : "settled",
                el.brushEnginePrograms,
              );
            }
            const wetRibbonPlan = liveWetWashPlan
              ? liveWetWashPlan.carrierPlan
              : causalWatercolor
                ? planStudioWetRibbonCarrier(dabs, { seed: watercolorSeed })
                : null;
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (wetInkReplayPlan?.ok) {
                    renderStudioWetInkBrushReplay(
                      context,
                      wetInkReplayPlan.value,
                      {
                        hidden: el.hidden === true,
                        expectedRevision: wetInkReplayPlan.value.revision,
                        currentRevision: wetInkReplayPlan.value.revision,
                      },
                    );
                    // A selected wet-ink replay never changes renderer after execution starts.
                    return;
                  }
                  // Ineligible/legacy snapshots select the compatibility renderer before execution.
                  if (dabs.length === 0) return;
                  context.save();
                  if (wetRibbonPlan) {
                    // The v2 fail-closed carrier is a connected, direction-following ribbon. Its
                    // four pigment bands soften the wet edge without exposing repeated circles.
                    for (const batch of wetRibbonPlan.batches) {
                      context.globalAlpha = Math.min(
                        1,
                        Math.max(0, batch.opacity * opacity),
                      );
                      context.beginPath();
                      traceStudioWetRibbonCarrierBatch(context, batch);
                      context.fillStyle = stroke;
                      context.fill();
                    }
                    context.restore();
                    return;
                  }
                  for (const dab of dabs) {
                    context.globalAlpha = Math.min(1, Math.max(0, dab.opacity * opacity));
                    context.beginPath();
                    context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
                    if (dab.role === "diffuse") {
                      // 외곽이 0 alpha로 사라지는 방사 그라디언트라, 별도 blur 필터 없이도 젖은
                      // 종이 가장자리처럼 퍼진다. 중심 dab과 함께 그려져 단일 탭도 자연스러운 점이 된다.
                      const gradient = context.createRadialGradient(
                        dab.x,
                        dab.y,
                        0,
                        dab.x,
                        dab.y,
                        dab.radius
                      );
                      gradient.addColorStop(0, stroke);
                      gradient.addColorStop(0.45, stroke);
                      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
                      context.fillStyle = gradient;
                    } else {
                      context.fillStyle = stroke;
                    }
                    context.fill();
                  }
                  context.restore();
                }}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (brushFamily === "screentone" && el.mode !== "eraser") {
            // 스크린톤: 전역 격자에 정렬된 망점 도트를 스트로크 경로에 찍는다(겹쳐도 패턴 유지).
            // 활성 초안은 요소 id 로 키된 증분 빌더가 도장 워크의 안정 prefix 를 유지한다
            // (이동당 새 표본 비례 — 장획 게이트 stamp-tone). 커밋 렌더는 배치를 유지한다.
            const pitch = Math.max(3, aliasStrokeWidth * 0.42);
            const radius = Math.max(2, aliasStrokeWidth / 2);
            const dots = activeDraft
              // 변형 인덱스로 키 격리 — 변형 간 내부 보관 배열 공유 금지(P2 리뷰).
              ? screentoneDotsForStrokeIncremental(`${el.id}#${index}`, points, radius, pitch)
              : screentoneDotsForStroke(points, radius, pitch);
            const dotR = screentoneDotRadius(pitch);
            return (
              <Shape
                key={index}
                sceneFunc={(context, shape) => {
                  context.beginPath();
                  for (let i = 0; i < dots.length; i += 2) {
                    context.moveTo(dots[i]! + dotR, dots[i + 1]!);
                    context.arc(dots[i]!, dots[i + 1]!, dotR, 0, Math.PI * 2);
                  }
                  context.fillStrokeShape(shape);
                }}
                fill={stroke}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (brushFamily === "pencil" && el.mode !== "eraser") {
            const renderPath = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              acceptedTension: 0.18,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0.2,
            });
            if (
              el.materialPressureModel
              !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
            ) {
              // A pointerdown that never travelled has no polyline to stroke: a one-coordinate
              // `<Line>` only emits a `moveTo`. Legacy documents therefore need the same contact
              // dot the canonical ribbon plans below, or a tap reads as an unresponsive canvas.
              const legacyTapDab = planStudioRetainedMediaTapDab(
                renderPath.points,
                undefined,
                "pencil",
              );
              if (aliasPencilPasses.length > 0) {
                return (
                  <Group key={index} opacity={opacity} listening={false}>
                    {aliasPencilPasses.map((pass, passIndex) => {
                      const passWidth = Math.max(
                        0.5,
                        aliasStrokeWidth * pass.widthScale,
                      );
                      return legacyTapDab ? (
                        <KCircle
                          key={`${pass.role}-${passIndex}`}
                          x={legacyTapDab.x}
                          y={legacyTapDab.y}
                          radius={resolveStudioDrawTapRadius(
                            activeDraft,
                            Math.max(0.25, passWidth / 2),
                          )}
                          fill={stroke}
                          opacity={pass.opacityScale}
                          globalCompositeOperation={composite}
                          listening={false}
                        />
                      ) : (
                        <Line
                          key={`${pass.role}-${passIndex}`}
                          points={studioPencilAliasPassPoints(
                            renderPath.points,
                            pass.jitterRadius,
                          )}
                          stroke={stroke}
                          strokeWidth={passWidth}
                          opacity={pass.opacityScale}
                          lineCap="round"
                          lineJoin="round"
                          tension={renderPath.tension}
                          globalCompositeOperation={composite}
                          listening={false}
                        />
                      );
                    })}
                  </Group>
                );
              }
              return legacyTapDab ? (
                <KCircle
                  key={index}
                  x={legacyTapDab.x}
                  y={legacyTapDab.y}
                  radius={resolveStudioDrawTapRadius(
                    activeDraft,
                    Math.max(0.25, strokeWidth / 2),
                  )}
                  fill={stroke}
                  opacity={opacity}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              ) : (
                <Line
                  key={index}
                  points={processPencilPoints(renderPath.points)}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  opacity={opacity}
                  lineCap="round"
                  lineJoin="round"
                  tension={renderPath.tension}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              );
            }
            const pressureProfile = resolveStudioRetainedMediaPressureProfileId(brush)
              ?? "pencil";
            const passes = aliasPencilPasses.length > 0
              ? aliasPencilPasses
              : [STUDIO_PENCIL_DEFAULT_ALIAS_PASS];
            // Detected on the accepted geometry, never on the per-pass grain jitter: a tap whose
            // samples the jitter has nudged apart would otherwise be planned as a sub-pixel ribbon
            // sliver instead of the nib the user pressed down, and read as an unresponsive canvas.
            const tapDab = planStudioRetainedMediaTapDab(
              renderPath.points,
              el.pressures,
              pressureProfile,
              { minimumDiameterRatio: el.materialMinimumDiameterRatio },
            );
            if (tapDab) {
              return (
                <Group key={index} opacity={opacity} listening={false}>
                  {passes.map((pass, passIndex) => (
                    <KCircle
                      key={`${pass.role}-${passIndex}`}
                      x={tapDab.x}
                      y={tapDab.y}
                      radius={resolveStudioDrawTapRadius(
                        activeDraft,
                        Math.max(
                          0.35,
                          Math.max(0.5, aliasStrokeWidth * pass.widthScale)
                          * tapDab.sizeScale
                          / 2,
                        ),
                      )}
                      fill={stroke}
                      opacity={Math.min(
                        1,
                        pass.opacityScale
                        * Math.sqrt(tapDab.opacityScale * tapDab.flowScale),
                      )}
                      globalCompositeOperation={composite}
                      listening={false}
                    />
                  ))}
                </Group>
              );
            }
            const passPlans = passes.map((pass) => {
              const curve = planStudioRetainedMediaPressureCurve(
                studioPencilAliasPassPoints(
                  renderPath.points,
                  pass.jitterRadius,
                ),
                el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
                  ? el.pressures
                  : undefined,
                pressureProfile,
                {
                  tension: renderPath.tension,
                  minimumDiameterRatio: el.materialMinimumDiameterRatio,
                },
              );
              return {
                pass,
                ribbon: planStudioRetainedMediaRibbon(
                  curve,
                  Math.max(0.5, aliasStrokeWidth * pass.widthScale),
                ),
              };
            });
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  context.save();
                  const inheritedAlpha = context.globalAlpha;
                  context.fillStyle = stroke;
                  // Every adjacent cell shares one miter/bevel cross-section. Unlike independent
                  // butt strokes, the pressure mesh has neither an outer hole nor a darker inner
                  // overlap; each source segment still owns its canonical pigment response.
                  for (const { pass, ribbon } of passPlans) {
                    const buckets: number[][] = Array.from(
                      { length: STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT + 1 },
                      () => [],
                    );
                    for (const run of ribbon.runs) {
                      for (const cell of run.cells) {
                        if (cell.points.length < 6) continue;
                        const alpha = Math.min(
                          1,
                          pass.opacityScale
                          * Math.sqrt(cell.opacityScale * cell.flowScale),
                        );
                        const bIndex = studioPencilRibbonAlphaBucket(alpha);
                        if (bIndex > 0) {
                          const bucket = buckets[bIndex]!;
                          for (let ci = 0; ci < cell.points.length; ci += 1) {
                            bucket.push(cell.points[ci]!);
                          }
                          bucket.push(Number.NaN);
                        }
                      }
                      for (const cap of run.caps) {
                        if (cap.points.length < 6) continue;
                        const alpha = Math.min(
                          1,
                          pass.opacityScale
                          * Math.sqrt(cap.opacityScale * cap.flowScale),
                        );
                        const bIndex = studioPencilRibbonAlphaBucket(alpha);
                        if (bIndex > 0) {
                          const bucket = buckets[bIndex]!;
                          for (let ci = 0; ci < cap.points.length; ci += 1) {
                            bucket.push(cap.points[ci]!);
                          }
                          bucket.push(Number.NaN);
                        }
                      }
                    }

                    for (let b = 1; b <= STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT; b += 1) {
                      const coords = buckets[b]!;
                      if (coords.length === 0) continue;
                      context.globalAlpha =
                        inheritedAlpha * (b / STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT);
                      context.beginPath();
                      let startIdx = 0;
                      for (let i = 0; i <= coords.length; i += 1) {
                        if (i === coords.length || Number.isNaN(coords[i])) {
                          if (i - startIdx >= 6) {
                            context.moveTo(coords[startIdx]!, coords[startIdx + 1]!);
                            for (let c = startIdx + 2; c < i; c += 2) {
                              context.lineTo(coords[c]!, coords[c + 1]!);
                            }
                            context.closePath();
                          }
                          startIdx = i + 1;
                        }
                      }
                      context.fill();
                    }
                  }
                  context.restore();
                }}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
                perfectDrawEnabled={false}
              />
            );
          }

          if (brushFamily === "highlighter" && el.mode !== "eraser") {
            const renderPath = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              acceptedTension: 0.35,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0.35,
            });
            const pressureBrush = isStudioFxPressureBrushId(brush)
              ? brush
              : "highlighter";
            const pressurePath = planStudioFxBrushPressurePath({
              brushId: pressureBrush,
              points: renderPath.points,
              pressures: el.pressures,
              pressureModel: el.materialPressureModel,
              minimumDiameterRatio: el.materialMinimumDiameterRatio,
              tension: renderPath.tension,
            });
            const washPlan = planStudioHighlighterWashRibbon({
              brushId: resolveStudioHighlighterWashBrushId(brush),
              pressurePath,
              baseWidth: aliasStrokeWidth,
            });
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (washPlan.runs.length === 0) return;
                  context.save();
                  const washAlpha = context.globalAlpha * washPlan.opacityScale;
                  context.globalAlpha = washAlpha;
                  context.fillStyle = stroke;
                  context.beginPath();
                  traceStudioHighlighterWashPlan(context, washPlan);
                  context.fill();
                  // Rim pooling and fibre streaks: one extra compound fill, so a self-crossing
                  // still receives at most one detail wash.
                  if (washPlan.detailRuns.length > 0) {
                    context.globalAlpha = washAlpha * washPlan.detailOpacityScale;
                    context.beginPath();
                    traceStudioHighlighterWashDetail(context, washPlan);
                    context.fill();
                  }
                  context.restore();
                }}
                opacity={opacity}
                globalCompositeOperation="multiply"
                listening={false}
                perfectDrawEnabled={false}
              />
            );
          }

          if (brushFamily === "neon" && el.mode !== "eraser") {
            const renderPath = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              acceptedTension: 0.3,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0.35,
            });
            const passes = planNeonBrushPasses(strokeWidth);
            const retainLuminousPasses = studioFxLuminousDraftRetentionFits(
              activeDraft,
              renderPath.points.length,
              passes.length,
              symmetricVariations.length,
            );
            if (
              el.materialPressureModel
              !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
            ) {
              return (
                <Group key={index} opacity={opacity} listening={false}>
                  {passes.map((pass, passIndex) => {
                    const passColor = pass.tone === "white-core"
                      ? studioLuminousCoreColor(stroke)
                      : stroke;
                    const passWidth = Math.max(
                      0.5,
                      strokeWidth * pass.widthScale,
                    );
                    return renderPath.points.length === 2 ? (
                      <KCircle
                        key={passIndex}
                        x={renderPath.points[0]}
                        y={renderPath.points[1]}
                        radius={Math.max(0.25, passWidth / 2)}
                        fill={passColor}
                        opacity={pass.opacity}
                        globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                        listening={false}
                      />
                    ) : (
                      <Line
                        key={passIndex}
                        points={renderPath.points}
                        stroke={passColor}
                        strokeWidth={passWidth}
                        opacity={pass.opacity}
                        lineCap="round"
                        lineJoin="round"
                        tension={renderPath.tension}
                        globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                        listening={false}
                      />
                    );
                  })}
                </Group>
              );
            }
            const tapPressure = resolveStudioFxBrushTapPressureResponse(
              "neon",
              el.pressures?.[0],
              el.materialPressureModel,
              el.materialMinimumDiameterRatio,
            );
            return (
              <Group key={index} opacity={opacity} listening={false}>
                {passes.map((pass, passIndex) => {
                  const passColor = pass.tone === "white-core" ? studioLuminousCoreColor(stroke) : stroke;
                  const luminousCore = pass.tone === "white-core";
                  const tapPassPressure = resolveStudioFxPressurePassResponse(
                    tapPressure,
                    pass.widthScale,
                    luminousCore,
                  );
                  const passWidth = Math.max(
                    0.5,
                    strokeWidth * pass.widthScale * tapPassPressure.widthScale,
                  );
                  return renderPath.points.length === 2 ? (
                    <KCircle
                      key={passIndex}
                      x={renderPath.points[0]}
                      y={renderPath.points[1]}
                      radius={Math.max(0.25, passWidth / 2)}
                      fill={passColor}
                      opacity={Math.min(
                        1,
                        pass.opacity * tapPassPressure.opacityScale,
                      )}
                      globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                      listening={false}
                    />
                  ) : (
                    <Shape
                      key={passIndex}
                      sceneFunc={(context) => {
                        // 압력 경로도 리본도 라이브 드래프트에서만 증분 빌더로 소비한다 — 같은
                        // 스냅샷의 두 번째 이후 패스는 휘발 꼬리만 다시 방출하므로 그리기당 추가
                        // 비용이 상수다. 커밋 요소는 배치 플래너로 매번 값 동일 재계산(P2: O(1)
                        // 앵커가 같은 길이·꼬리의 내부 재작성을 놓친다).
                        const fxInput = {
                          brushId: "neon",
                          points: renderPath.points,
                          pressures: el.pressures,
                          pressureModel: el.materialPressureModel,
                          minimumDiameterRatio: el.materialMinimumDiameterRatio,
                          tension: renderPath.tension,
                        } as const;
                        const producer = activeDraft
                          ? fxPressurePathBuilderForVariation(index)
                          : null;
                        const retained = producer
                          ? fxLuminousRetainedPass(index, passIndex, retainLuminousPasses)
                          : null;
                        const passPlanInput = {
                          brushId: "neon",
                          pressurePath: producer
                            ? producer.append(fxInput)
                            : planStudioFxBrushPressurePath(fxInput),
                          baseWidth: strokeWidth,
                          passWidthScale: pass.widthScale,
                          passOpacity: pass.opacity,
                          luminousCore,
                        } as const;
                        const ribbonPlan = producer && retained
                          ? retained.builder.append({ ...passPlanInput, producer })
                          : planStudioFxLuminousRibbonPass(passPlanInput);
                        if (ribbonPlan.polygons.length === 0) return;
                        context.save();
                        context.globalAlpha *= ribbonPlan.opacity;
                        context.fillStyle = passColor;
                        fillStudioFxLuminousRibbonPass(context, ribbonPlan, retained);
                        context.restore();
                      }}
                      globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  );
                })}
              </Group>
            );
          }

          if (brushFamily === "glow" && el.mode !== "eraser") {
            const renderPath = resolveStudioFreehandRenderPath(points, {
              sampleSpacing: el.sampleSpacing,
              acceptedTension: 0.3,
              legacyMinDistance: renderSampleDistance,
              legacyTension: 0.35,
            });
            const soft = (el.brush ?? "glow") === "soft-glow";
            const passes = planGlowBrushPasses(strokeWidth, soft);
            const retainLuminousPasses = studioFxLuminousDraftRetentionFits(
              activeDraft,
              renderPath.points.length,
              passes.length,
              symmetricVariations.length,
            );
            if (
              el.materialPressureModel
              !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
            ) {
              return (
                <Group key={index} opacity={opacity} listening={false}>
                  {passes.map((pass, passIndex) => (
                    renderPath.points.length === 2 ? (
                      <KCircle
                        key={passIndex}
                        x={renderPath.points[0]}
                        y={renderPath.points[1]}
                        radius={Math.max(
                          0.25,
                          strokeWidth * pass.widthScale * 0.5,
                        )}
                        fill={stroke}
                        opacity={pass.opacity}
                        globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                        listening={false}
                      />
                    ) : (
                      <Line
                        key={passIndex}
                        points={renderPath.points}
                        stroke={stroke}
                        strokeWidth={Math.max(
                          0.5,
                          strokeWidth * pass.widthScale,
                        )}
                        opacity={pass.opacity}
                        lineCap="round"
                        lineJoin="round"
                        tension={renderPath.tension}
                        globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                        listening={false}
                      />
                    )
                  ))}
                </Group>
              );
            }
            const pressureBrush = soft ? "soft-glow" : "glow";
            const tapPressure = resolveStudioFxBrushTapPressureResponse(
              pressureBrush,
              el.pressures?.[0],
              el.materialPressureModel,
              el.materialMinimumDiameterRatio,
            );
            return (
              <Group key={index} opacity={opacity} listening={false}>
                {passes.map((pass, passIndex) => {
                  const luminousCore = passIndex === passes.length - 1;
                  const tapPassPressure = resolveStudioFxPressurePassResponse(
                    tapPressure,
                    pass.widthScale,
                    luminousCore,
                  );
                  return renderPath.points.length === 2 ? (
                    <KCircle
                      key={passIndex}
                      x={renderPath.points[0]}
                      y={renderPath.points[1]}
                      radius={Math.max(
                        0.25,
                        strokeWidth
                        * pass.widthScale
                        * tapPassPressure.widthScale
                        * 0.5,
                      )}
                      fill={stroke}
                      opacity={Math.min(
                        1,
                        pass.opacity * tapPassPressure.opacityScale,
                      )}
                      globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                      listening={false}
                    />
                  ) : (
                    <Shape
                      key={passIndex}
                      sceneFunc={(context) => {
                        // neon 분기와 같은 소비 규율 — 라이브 드래프트만 증분(이동당 상수),
                        // 커밋 요소는 배치 플래너로 값 동일 재계산. 셸이 48개인 이 분기가 유지
                        // 리본이 갚는 비용의 전부다(실측 r150 원 34.8초 → 0.91초).
                        const fxInput = {
                          brushId: pressureBrush,
                          points: renderPath.points,
                          pressures: el.pressures,
                          pressureModel: el.materialPressureModel,
                          minimumDiameterRatio: el.materialMinimumDiameterRatio,
                          tension: renderPath.tension,
                        } as const;
                        const producer = activeDraft
                          ? fxPressurePathBuilderForVariation(index)
                          : null;
                        const retained = producer
                          ? fxLuminousRetainedPass(index, passIndex, retainLuminousPasses)
                          : null;
                        const passPlanInput = {
                          brushId: pressureBrush,
                          pressurePath: producer
                            ? producer.append(fxInput)
                            : planStudioFxBrushPressurePath(fxInput),
                          baseWidth: strokeWidth,
                          passWidthScale: pass.widthScale,
                          passOpacity: pass.opacity,
                          luminousCore,
                        } as const;
                        const ribbonPlan = producer && retained
                          ? retained.builder.append({ ...passPlanInput, producer })
                          : planStudioFxLuminousRibbonPass(passPlanInput);
                        if (ribbonPlan.polygons.length === 0) return;
                        context.save();
                        context.globalAlpha *= ribbonPlan.opacity;
                        context.fillStyle = stroke;
                        fillStudioFxLuminousRibbonPass(context, ribbonPlan, retained);
                        context.restore();
                      }}
                      globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  );
                })}
              </Group>
            );
          }

          if (brushFamily === "glitter" && el.mode !== "eraser") {
            const mode = (el.brush ?? "glitter") === "star-dust"
              ? "star-dust"
              : el.brush === "sparkle-star"
                ? "sparkle-star"
                : "glitter";
            const particles = planGlitterBrushParticles({
              points: resolveStudioFreehandRenderPath(points, {
                sampleSpacing: el.sampleSpacing,
                legacyMinDistance: renderSampleDistance,
                legacyTension: 0,
              }).points,
              pressures: el.pressures,
              baseWidth: aliasStrokeWidth,
              seed: fxBrushSeedFromKey(el.id),
              mode,
              maxParticles: 512,
            });
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  context.save();
                  for (const particle of particles) {
                    context.globalAlpha = Math.min(1, Math.max(0, particle.opacity * opacity));
                    context.fillStyle = stroke;
                    if (particle.kind === 1) {
                      const s = particle.radius * 1.35;
                      context.save();
                      context.translate(particle.x, particle.y);
                      context.rotate(Math.PI / 4);
                      context.fillRect(-s * 0.5, -s * 0.5, s, s);
                      context.restore();
                    } else {
                      context.beginPath();
                      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                      context.fill();
                    }
                  }
                  context.restore();
                }}
                globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}
                listening={false}
              />
            );
          }

          if (brushFamily === "oil" && el.mode !== "eraser") {
            const oilPlanInput = {
              points: resolveStudioFreehandRenderPath(points, {
                sampleSpacing: el.sampleSpacing,
                legacyMinDistance: renderSampleDistance,
                legacyTension: 0,
              }).points,
              pressures: el.pressures,
              baseWidth: aliasStrokeWidth,
              seed: fxBrushSeedFromKey(el.id),
              maxDabs: FX_OIL_DAB_CAP,
              ...studioOilFamilyPlanFields(brush),
            };
            // 활성 초안만 요소 id 로 키된 증분 플래너를 쓴다. 대브 베드와 캐리어 모두 이동당
            // 전체를 다시 세우고 있었고(2906-대브 베드 기준 캐리어만 14.6ms), 두 플래너 모두
            // 스스로 검증한 접두만 재사용하므로 플랜은 배치와 바이트 동일하다. 커밋 렌더는
            // 배치 리플레이를 유지해 내부 점 재작성에도 항상 정본을 그린다. 대칭 변형은 같은
            // 요소를 변형된 점 배열로 여러 번 그리므로 변형 인덱스를 획 키에 포함한다.
            const dabs = oilDraftPlannersRetained
              ? planOilBrushDabsIncremental(el.id, index, oilPlanInput)
              : planOilBrushDabs(oilPlanInput);
            // 유화 기계 프로그램의 정본은 studioOilRibbonProgramsForBrush 의 id 매트릭스다. 아래는 그 요약이며
            // 매트릭스를 고치면 같이 고친다 — "bristle-physics 레인만 시뮬" 이던 2026-08-13 wave 3 서술이 확장
            // 뒤에도 남아 브러시 통합 검토를 오도한 전례가 있다. 2026-09-02 기준:
            // - WetBrush-2D 강모 물리 시뮬(bristlePhysics): brush--bristle-physics · oil--filbert-ribbon ·
            //   oil--impasto-ribbon · 기본 유화 2종(oil · acrylic). 2026-08-13 wave 3 에는 bristle-physics
            //   전용이었고 2026-08-15 에 filbert·impasto-ribbon, 2026-08-20 에 기본 유화로 확장됐다(그때
            //   함께 들어온 미출하 id — fluid-paint 4종·oil--fluid-paint-* 2행 — 은 2026-09-02 에 제거).
            // - v1 강모 고갈 다이내믹(bristleLoadDynamics, 갈필): brush--bristle-physics ·
            //   brush--bristle-depletion · 기본 유화 2종.
            // - dli GGX 릴리프 오버레이(impastoRelief): brush--impasto-relief · oil--impasto-ribbon · 기본 유화 2종.
            // 고유한 것은 조합이다: 고갈만 = bristle-depletion, 시뮬만 = filbert-ribbon, 릴리프만 =
            // impasto-relief, 시뮬+고갈(릴리프 없음) = bristle-physics, 시뮬+릴리프(고갈 없음) = impasto-ribbon,
            // 셋 다 = 기본 유화 2종. 매트릭스 밖의 유화 브러시는 캐리어 계약상 바이트 동일 플랜을 유지하고,
            // 저장된 브러시의 프로그램 세트(brushEnginePrograms.oil)는 매트릭스를 병합이 아니라 대체한다.
            // SVG 내보내기의 유화 분기와 입력(대브·시드)이 같아 두 렌더러가 픽셀 일치한다. 라이브 retained
            // 오버레이(studio-live-retained-media-overlay)는 같은 매트릭스를 부르지만 대브 입력(원시 점·
            // 비alias 폭)이 달라 이 패리티 주장의 범위 밖이다.
            const oilPrograms = studioOilRibbonProgramsForBrush(
              brush,
              fxBrushSeedFromKey(el.id),
              el.brushEnginePrograms?.oil,
            );
            const carrier = oilDraftPlannersRetained
              ? planStudioOilRibbonCarrierIncremental(el.id, index, dabs, oilPrograms)
              : planStudioOilRibbonCarrier(dabs, oilPrograms);
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  // oil--gpu-bristle 레인은 GPU bitmap만 픽셀 권한을 가진다. drawing-draft와
                  // document는 같은 Worker 상태를 이어 쓰고, renderer-local transform-draft는
                  // 새 비동기 작업을 시작하지 않는다. 요청 생성 실패, pending, unsupported,
                  // Worker/WebGPU decline은 source를 보존하고 Canvas carrier로 전환하지 않는다.
                  const gpuBristleSelected = brush?.startsWith(
                    STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX,
                  ) ?? false;
                  const gpuBristle = gpuBristleSelected && (durableDocumentRender || activeDraft)
                    ? studioGpuBristleOilRequest(el.id, brush, dabs, opacity, stroke)
                    : null;
                  if (gpuBristleSelected) {
                    if (!gpuBristle) return;
                    const overlay = requestStudioGpuBristleOverlay(
                      gpuBristle,
                      notifyGpuBristleReady,
                      gpuBristleGeneration,
                    );
                    if (!overlay) return;
                    context.drawImage(
                      overlay.bitmap,
                      overlay.dx,
                      overlay.dy,
                      overlay.dw,
                      overlay.dh,
                    );
                    return;
                  }
                  const paintInput = {
                    carrier,
                    stroke,
                    opacity,
                    points: dabs.map((dab) => ({ x: dab.x, y: dab.y })),
                    radiusPx: Math.max(
                      1,
                      dabs.reduce((sum, dab) => sum + dab.radiusY, 0)
                      / Math.max(1, dabs.length),
                    ),
                  };
                  if (activeDraft) {
                    paintStudioOilRibbonCarrierIncremental(context, {
                      ...paintInput,
                      incrementalKey: el.id,
                    });
                    return;
                  }
                  paintStudioOilRibbonCarrier(context, paintInput);
                }}
                hitFunc={(context, shape) => {
                  paintStudioOilRibbonHit(context, carrier, shape);
                }}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          if (brushFamily === "pastel" && el.mode !== "eraser") {
            const dabs = planPastelBrushDabs({
              points: resolveStudioFreehandRenderPath(points, {
                sampleSpacing: el.sampleSpacing,
                legacyMinDistance: renderSampleDistance,
                legacyTension: 0,
              }).points,
              pressures: el.pressures,
              baseWidth: aliasStrokeWidth,
              seed: fxBrushSeedFromKey(el.id),
              maxDabs: FX_PASTEL_DAB_CAP,
            });
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  context.save();
                  for (const dab of dabs) {
                    try {
                      // Reuse the same high-resolution colourless falloff mask as dynamic soft
                      // brushes. This is one cached affine drawImage per fibre instead of creating
                      // thousands of radial gradients again on every retained-layer repaint.
                      renderStudioDynamicBrushCoverageMark(
                        context,
                        {
                          x: dab.x,
                          y: dab.y,
                          radiusX: dab.radiusX,
                          radiusY: dab.radiusY,
                          angleRadians: dab.angleRad,
                          alpha: dab.opacity,
                          color: stroke,
                          falloff: {
                            kind: "analytic-radial",
                            exponent: 0.72,
                          },
                        },
                        opacity,
                      );
                    } catch {
                      // Restricted Canvas hosts without an allocatable stamp surface retain a
                      // deterministic analytic-gradient fallback rather than dropping pigment.
                      context.globalAlpha = Math.min(
                        1,
                        Math.max(0, dab.opacity * opacity),
                      );
                      context.save();
                      context.translate(dab.x, dab.y);
                      context.rotate(dab.angleRad);
                      context.scale(1, dab.radiusY / dab.radiusX);
                      const gradient = context.createRadialGradient(
                        0,
                        0,
                        0,
                        0,
                        0,
                        dab.radiusX,
                      );
                      gradient.addColorStop(0, stroke);
                      gradient.addColorStop(0.55, stroke);
                      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
                      context.beginPath();
                      context.arc(0, 0, dab.radiusX, 0, Math.PI * 2);
                      context.fillStyle = gradient;
                      context.fill();
                      context.restore();
                    }
                  }
                  context.restore();
                }}
                globalCompositeOperation={composite}
                listening={false}
              />
            );
          }

          // Default "pen" or "marker" or "eraser"
          // 라쏘 브러시: fill 이 설정된 프리핸드(라쏘 필)는 궤적을 자동으로 닫아 내부를
          // 현재 색으로 채운다. 라이브 초안도 같은 경로를 지나므로 그리는 동안 채움이 미리 보인다.
          const freehandFill = el.mode !== "eraser" ? el.fill : undefined;
          if ((el.sampleSpacing !== undefined || el.pressureModel !== undefined) && !freehandFill) {
            const causalContract = resolveStudioCausalInkDrawContract(el, points);
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (causalContract.composite !== "source-over") {
                    context.globalCompositeOperation = causalContract.composite;
                  }
                  drawStudioCausalInkContract(context, causalContract);
                }}
                opacity={causalContract.opacity}
                globalCompositeOperation={causalContract.composite}
                listening={false}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            );
          }
          const renderPath = resolveStudioFreehandRenderPath(points, {
            sampleSpacing: el.sampleSpacing,
            legacyMinDistance: renderSampleDistance,
            legacyTension: 0.4,
          });
          const smoothed = renderPath.points;
          const pressures = el.pressures;
          if (pressures && pressures.length > 0 && smoothed.length >= 4) {
            const aliasPressures = aliasProfileEnabled
              ? mapStudioBrushAliasPressureSamples(
                  brush,
                  pressures,
                  Math.floor(points.length / 2),
                  0.5,
                )
              : pressures;
            const sampledPressures = resampleStrokePressures(
              aliasPressures,
              Math.floor(smoothed.length / 2),
            );
            return (
              <Shape
                key={index}
                sceneFunc={(context) => {
                  if (smoothed.length < 4) return;
                  if (composite !== "source-over") {
                    context.globalCompositeOperation = composite;
                  }
                  if (freehandFill && smoothed.length >= 6) {
                    context.beginPath();
                    context.moveTo(smoothed[0]!, smoothed[1]!);
                    for (let i = 2; i < smoothed.length; i += 2) {
                      context.lineTo(smoothed[i]!, smoothed[i + 1]!);
                    }
                    context.closePath();
                    context.fillStyle = freehandFill;
                    context.fill();
                  }
                  // 중점 이차곡선 보간 — 다이렉트 라이브 초안과 같은 래스터라이저를 공유한다.
                  drawFreehandPenSegments(
                    context,
                    smoothed,
                    sampledPressures,
                    stroke,
                    aliasStrokeWidth,
                  );
                }}
                opacity={opacity}
                globalCompositeOperation={composite}
                listening={false}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            );
          }

          return (
            <Line
              key={index}
              points={smoothed}
              stroke={stroke}
              strokeWidth={aliasStrokeWidth}
              opacity={opacity}
              lineCap="round"
              lineJoin="round"
              tension={renderPath.tension}
              closed={Boolean(freehandFill) && smoothed.length >= 6}
              fill={freehandFill}
              globalCompositeOperation={composite}
              listening={false}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />
          );
        }

        // 직선("line") — 점선/선 끝 스타일 + 시작/끝 화살촉(삼각형·점)을 함께 그린다.
        const lineHeads = lineArrowHeadGeoms(points, strokeStyle, strokeWidth);
        return (
          <Group key={index} opacity={opacity} listening={false}>
            <Line
              points={points}
              stroke={stroke}
              strokeWidth={strokeWidth}
              dash={shapeDash}
              lineCap={strokeStyle.lineCap}
              lineJoin="round"
              globalCompositeOperation={composite}
              listening={false}
            />
            {lineHeads.map((head, headIndex) =>
              head.kind === "dot" ? (
                <KCircle
                  key={headIndex}
                  x={head.cx}
                  y={head.cy}
                  radius={head.r}
                  fill={stroke}
                  globalCompositeOperation={composite}
                  listening={false}
                />
              ) : (
                <Line
                  key={headIndex}
                  points={head.points}
                  closed
                  fill={stroke}
                  lineJoin="round"
                  globalCompositeOperation={composite}
                  listening={false}
                />
              )
            )}
          </Group>
        );
      })}
    </Group>
  );
});
