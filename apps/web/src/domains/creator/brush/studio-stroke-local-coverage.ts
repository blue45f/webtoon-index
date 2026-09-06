/**
 * Provider-neutral stroke-local polygon coverage planning.
 *
 * Canvas non-zero filling sums the winding of every compound-path subpath. An angled nib segment
 * naturally reverses its polygon winding when the artist retraces the centre line. If both raw
 * polygons are submitted to one compound path, their windings cancel and an already opaque mark
 * becomes transparent. Every accepted polygon is therefore normalized to one winding before the
 * complete path is filled once. Overlap can increase the winding magnitude but can never remove
 * coverage, while node/stroke opacity remains a single final composition.
 */

import {
  resolveStudioRetainedMediaPressureAt,
  resolveStudioRetainedMediaPressureSeries,
  type StudioRetainedMediaPressureResponse,
  type StudioRetainedMediaPressureProfileId,
} from "../studio-retained-media-pressure";
import {
  MAX_DENSITY_BANDS,
  planStudioTonalBands,
  planStudioTonalBandsFromExtremes,
} from "../studio-tonal-band-plan";

export const STUDIO_STROKE_LOCAL_COVERAGE_VERSION = 2 as const;

export interface StudioStrokeLocalCoveragePolygon {
  /** Closed polygon coordinates `[x0,y0,x1,y1,…]`; the first point is not repeated. */
  readonly points: readonly number[];
}

/**
 * One cumulative paint layer of the mark's interior.
 *
 * Shell `k` carries every polygon whose density band is at or above `band`, so shell 0 is always
 * the whole mark — the silhouette is literally the first shell and cannot drift. A pixel sitting
 * in band `m` is therefore covered by shells 0…m and by no others, and its folded transmittance
 * telescopes: `∏(1 - opacity_k) = 1 - target(m)`. That is what buys back the property the single
 * union path had. Each shell is ONE compound fill, so a butt joint or a self-crossing inside a
 * shell is painted once, exactly as before; and where two arms of different bands cross, the
 * crossing is jointly covered by shells 0…max(band) and lands on `max`, never on the sum. No
 * seam, no double-darkening, and a tone that follows the pressure.
 *
 * `opacity` is the ABSOLUTE alpha to paint with — the element's own opacity is already folded in
 * by the planner, so both renderers paint the number verbatim and cannot disagree about where the
 * multiply happens.
 */
export interface StudioStrokeLocalCoverageShell {
  readonly band: number;
  readonly opacity: number;
  readonly polygons: readonly StudioStrokeLocalCoveragePolygon[];
}

/**
 * The same tonal plan in DISJOINT form: each polygon appears in exactly one band, and `opacity` is
 * the absolute alpha that band's pixels must end up at.
 *
 * It exists because the cumulative form is only cheap to express, not cheap to paint. Shell `k`
 * repaints everything at or above `k`, so a mark that resolves the full 32 bands is filled about
 * twenty-one times over — measured at 110.8ms for one long stroke against 8.5ms for the same
 * geometry filled once. That is not a cost a canvas renderer can pay per frame, and cutting bands
 * to afford it would be paying for speed with the tone this whole plan exists to restore.
 *
 * A painter that can composite into a surface of its own gets the identical picture for one fill
 * per polygon: walk `bands` (darkest first) with `destination-over`, and every pixel keeps the
 * FIRST band that covers it — its darkest — which is exactly where the cumulative fold lands it,
 * including where two arms of different bands cross. SVG has no private surface, so it keeps
 * `shells`; the canvas uses `bands`. Both are built from one banding pass, and the equivalence is
 * pinned by test rather than by comment.
 */
export interface StudioStrokeLocalCoverageBand {
  readonly band: number;
  readonly opacity: number;
  readonly polygons: readonly StudioStrokeLocalCoveragePolygon[];
}

export interface StudioAngledNibStrokeLocalCoveragePlan {
  readonly kind: "studio-angled-nib-stroke-local-coverage-plan";
  readonly version: typeof STUDIO_STROKE_LOCAL_COVERAGE_VERSION;
  readonly sourcePointCount: number;
  readonly sourceSegmentCount: number;
  readonly acceptedSegmentCount: number;
  readonly polygons: readonly StudioStrokeLocalCoveragePolygon[];
  /**
   * Ordered outermost (lightest band) first. Always at least one shell whenever `polygons` is
   * non-empty; a single shell means the mark carries no resolvable tonal range and is the byte
   * -identical legacy emission — one compound fill at the element's opacity.
   */
  readonly shells: readonly StudioStrokeLocalCoverageShell[];
  /**
   * The same layers, disjoint and DARKEST first, for a painter that owns its surface. Empty
   * exactly when `shells` is, and a single entry exactly when `shells` has one — so "no resolvable
   * tonal range" is one condition on both surfaces, never two that can drift apart.
   */
  readonly bands: readonly StudioStrokeLocalCoverageBand[];
}

export interface StudioAngledNibPressureInput {
  readonly pressures?: readonly number[] | null;
  readonly minimumDiameterRatio?: unknown;
  readonly profileId: Extract<
    StudioRetainedMediaPressureProfileId,
    "brush" | "flat-brush" | "marker-chisel"
  >;
  /**
   * The element's paint opacity, folded into every shell's absolute alpha so the darkest band
   * lands on exactly this value — the tone the single flat union already had.
   */
  readonly elementOpacity?: unknown;
}

const MAX_COORDINATE_ABS = 1_000_000_000;
const MAX_STROKE_WIDTH = 4_096;
const MIN_POLYGON_AREA = 1e-9;

/**
 * Pigment actually laid down at one sample, from the pressure response the planner already
 * resolves. `sizeScale` is spent on the nib's geometry; these are the two axes that were being
 * computed and thrown away. The geometric mean is the same combination the retained-media ribbon
 * uses for the same pair, so the two carriers answer "how dark is this touch" identically.
 */
function sampleDensity(
  response: { readonly opacityScale: number; readonly flowScale: number } | undefined,
): number {
  if (!response) return 1;
  const product = response.opacityScale * response.flowScale;
  return Number.isFinite(product) && product > 0 ? Math.sqrt(product) : 0;
}

function finiteUnitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_COORDINATE_ABS, Math.max(-MAX_COORDINATE_ABS, value));
}

function finiteStrokeWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_STROKE_WIDTH, value);
}

function finiteAngle(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function studioStrokeLocalCoverageSignedArea(
  points: readonly number[],
): number {
  const pointCount = Math.floor(points.length / 2);
  if (pointCount < 3) return 0;
  let twiceArea = 0;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const nextIndex = (pointIndex + 1) % pointCount;
    twiceArea +=
      points[pointIndex * 2]!
      * points[nextIndex * 2 + 1]!
      - points[nextIndex * 2]!
      * points[pointIndex * 2 + 1]!;
  }
  return twiceArea / 2;
}

/**
 * Returns a detached positive-winding polygon, or null for malformed/degenerate geometry.
 * Positive is an arbitrary canonical choice: only consistency across subpaths matters.
 */
export function normalizeStudioStrokeLocalCoveragePolygon(
  points: readonly number[],
): StudioStrokeLocalCoveragePolygon | null {
  if (points.length < 6 || points.length % 2 !== 0) return null;
  const detached = new Array<number>(points.length);
  for (let coordinateIndex = 0; coordinateIndex < points.length; coordinateIndex += 1) {
    const coordinate = finiteCoordinate(points[coordinateIndex]);
    if (coordinate === null) return null;
    detached[coordinateIndex] = coordinate;
  }
  const signedArea = studioStrokeLocalCoverageSignedArea(detached);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) <= MIN_POLYGON_AREA) {
    return null;
  }
  if (signedArea < 0) {
    const reversed: number[] = [];
    for (let coordinateIndex = detached.length - 2; coordinateIndex >= 0; coordinateIndex -= 2) {
      reversed.push(detached[coordinateIndex]!, detached[coordinateIndex + 1]!);
    }
    return Object.freeze({ points: Object.freeze(reversed) });
  }
  return Object.freeze({ points: Object.freeze(detached) });
}

export interface StudioAngledNibCoverageWorkUpperBound {
  /** Numeric coordinate fields the Canvas path emits across every band. */
  readonly canvasCoordinateScalars: number;
  /** `moveTo`/`lineTo`/`closePath` plus one `beginPath`+`fill` per band. */
  readonly canvasPathCommands: number;
}

/**
 * O(1) ceiling on the Canvas work one angled-nib mark can produce, from its sample count alone.
 *
 * The planner emits AT MOST one quadrilateral per source segment -- `sourcePointCount - 1` of them,
 * fewer when a malformed sample drops its segment -- and `planStudioTonalBands` partitions those
 * same polygons into DISJOINT bands, so the total painted polygon count never exceeds the segment
 * count however the tone splits. Each quadrilateral is four vertices: one `moveTo`, three `lineTo`
 * and a `closePath`, for eight coordinate scalars. Each band adds a `beginPath` and a `fill`.
 *
 * Used by live-transform work admission, which must decide before it plans; anything that raises
 * the planner's per-segment emission has to raise this with it.
 */
export function studioAngledNibCoverageWorkUpperBound(
  pointCount: number,
): StudioAngledNibCoverageWorkUpperBound {
  if (!Number.isSafeInteger(pointCount) || pointCount <= 1) {
    return { canvasCoordinateScalars: 0, canvasPathCommands: 0 };
  }
  const segments = pointCount - 1;
  return {
    canvasCoordinateScalars: segments * 8,
    canvasPathCommands: segments * 5 + MAX_DENSITY_BANDS * 2,
  };
}

/**
 * Plans the historical fixed-angle brush/flat-brush ribbon as independent coverage polygons.
 *
 * Geometry is unchanged from the legacy renderer: each accepted centre-line segment becomes the
 * same four nib-offset corners. Only subpath winding is canonicalized. This keeps old dimensions,
 * angle, joins and serialization intact while making retracing monotonic.
 */
export function planStudioAngledNibStrokeLocalCoverage(
  sourcePoints: readonly number[],
  strokeWidthInput: unknown,
  angleRadiansInput: unknown = -Math.PI / 6,
  pressureInput?: StudioAngledNibPressureInput | null,
): StudioAngledNibStrokeLocalCoveragePlan {
  const sourcePointCount = Math.floor(sourcePoints.length / 2);
  const sourceSegmentCount = Math.max(0, sourcePointCount - 1);
  const strokeWidth = finiteStrokeWidth(strokeWidthInput);
  const angleRadians = finiteAngle(angleRadiansInput);
  if (strokeWidth === null || angleRadians === null || sourceSegmentCount === 0) {
    return Object.freeze({
      kind: "studio-angled-nib-stroke-local-coverage-plan",
      version: STUDIO_STROKE_LOCAL_COVERAGE_VERSION,
      sourcePointCount,
      sourceSegmentCount,
      acceptedSegmentCount: 0,
      polygons: Object.freeze([]),
      shells: Object.freeze([]),
      bands: Object.freeze([]),
    });
  }

  const responses = pressureInput
    ? resolveStudioRetainedMediaPressureSeries(
        pressureInput.profileId,
        pressureInput.pressures,
        sourcePointCount,
        pressureInput.minimumDiameterRatio,
      )
    : null;
  const nibOffset = (pointIndex: number): readonly [number, number] => {
    const scale = responses?.[pointIndex]?.sizeScale ?? 1;
    const radius = strokeWidth * scale / 2;
    return [
      radius * Math.cos(angleRadians),
      radius * Math.sin(angleRadians),
    ];
  };
  const polygons: StudioStrokeLocalCoveragePolygon[] = [];
  // Aligned with `polygons`, not with the source samples: a malformed sample drops its segment, so
  // the two would otherwise slide apart and band the mark against the wrong pressures.
  const densities: number[] = [];
  for (let segmentIndex = 0; segmentIndex < sourceSegmentCount; segmentIndex += 1) {
    const sourceOffset = segmentIndex * 2;
    const startX = finiteCoordinate(sourcePoints[sourceOffset]);
    const startY = finiteCoordinate(sourcePoints[sourceOffset + 1]);
    const endX = finiteCoordinate(sourcePoints[sourceOffset + 2]);
    const endY = finiteCoordinate(sourcePoints[sourceOffset + 3]);
    if (startX === null || startY === null || endX === null || endY === null) {
      continue;
    }
    const [startNibX, startNibY] = nibOffset(segmentIndex);
    const [endNibX, endNibY] = nibOffset(segmentIndex + 1);
    const polygon = normalizeStudioStrokeLocalCoveragePolygon([
      startX - startNibX,
      startY - startNibY,
      startX + startNibX,
      startY + startNibY,
      endX + endNibX,
      endY + endNibY,
      endX - endNibX,
      endY - endNibY,
    ]);
    if (!polygon) continue;
    polygons.push(polygon);
    // A segment spans two samples, so it carries the pigment of both.
    densities.push((
      sampleDensity(responses?.[segmentIndex])
      + sampleDensity(responses?.[segmentIndex + 1])
    ) / 2);
  }

  const frozenPolygons = Object.freeze(polygons);
  const layers = planStudioTonalBands(
    frozenPolygons,
    densities,
    finiteUnitInterval(pressureInput?.elementOpacity) ?? 1,
  );
  return Object.freeze({
    kind: "studio-angled-nib-stroke-local-coverage-plan",
    version: STUDIO_STROKE_LOCAL_COVERAGE_VERSION,
    sourcePointCount,
    sourceSegmentCount,
    acceptedSegmentCount: polygons.length,
    polygons: frozenPolygons,
    shells: layers.shells,
    bands: layers.bands,
  });
}

export interface StudioIncrementalAngledNibCoverageBuilder {
  /**
   * 배치 `planStudioAngledNibStrokeLocalCoverage`와 값이 같은 플랜을 돌려주되, 세그먼트
   * 폴리곤·밀도의 안정 prefix 를 호출 사이에 유지한다 — 세그먼트는 양 끝점의 국소 함수라
   * 소급점이 아예 없다. 필압 응답은 소비 시점 진행률로 잠근다(나란한 배열에서 인덱스 조회로
   * 환원 — fx 압력 경로 빌더와 같은 계약, 커밋 배치 리플랜이 정본). 나란하지 않은 필압 배열은
   * 배치로 위임한다(전방 보간이 배열 길이에 소급 의존하므로 유지 불가). 톤 밴딩은 마크 자체의
   * 관측 피크/플로어에 상대적인 의도적 전역 설계라 매 호출 유지 배열 위에서 그대로 접는다 —
   * 프로브가 재는 무필압 형상은 단일 평면 레이어로 접혀 조립이 O(1)이다. 반환 플랜의
   * `polygons`는 내부 보관 배열이므로 수정하면 안 된다.
   */
  plan(
    sourcePoints: readonly number[],
    strokeWidthInput: unknown,
    angleRadiansInput?: unknown,
    pressureInput?: StudioAngledNibPressureInput | null,
  ): StudioAngledNibStrokeLocalCoveragePlan;
}

export function createStudioIncrementalAngledNibCoverageBuilder(): StudioIncrementalAngledNibCoverageBuilder {
  let configStrokeWidth = 0;
  let configAngle = 0;
  let configProfileId: string | null = null;
  let configMinimumDiameterRatio: unknown;
  let configHasPressures = false;

  let consumedPairs = 0;
  let lastRawX = 0;
  let lastRawY = 0;
  let lastRawPressure: number | undefined;
  const polygons: StudioStrokeLocalCoveragePolygon[] = [];
  const densities: number[] = [];
  /** 밀도 극값의 러닝 폴드 — 톤 밴딩의 평면 판정을 이동당 O(1)로 만든다(전체 스캔 제거). */
  let densityPeak = 0;
  let densityMin = Number.POSITIVE_INFINITY;
  let previousResponse: StudioRetainedMediaPressureResponse | undefined;
  let previousNibX = 0;
  let previousNibY = 0;
  let previousX: number | null = null;
  let previousY: number | null = null;

  const reset = (): void => {
    consumedPairs = 0;
    lastRawPressure = undefined;
    polygons.length = 0;
    densities.length = 0;
    densityPeak = 0;
    densityMin = Number.POSITIVE_INFINITY;
    previousResponse = undefined;
    previousX = null;
    previousY = null;
  };

  return {
    plan(sourcePoints, strokeWidthInput, angleRadiansInput = -Math.PI / 6, pressureInput) {
      const sourcePointCount = Math.floor(sourcePoints.length / 2);
      const sourceSegmentCount = Math.max(0, sourcePointCount - 1);
      const strokeWidth = finiteStrokeWidth(strokeWidthInput);
      const angleRadians = finiteAngle(angleRadiansInput);
      if (strokeWidth === null || angleRadians === null || sourceSegmentCount === 0) {
        reset();
        configProfileId = null;
        return {
          kind: "studio-angled-nib-stroke-local-coverage-plan",
          version: STUDIO_STROKE_LOCAL_COVERAGE_VERSION,
          sourcePointCount,
          sourceSegmentCount,
          acceptedSegmentCount: 0,
          polygons: [],
          shells: [],
          bands: [],
        };
      }
      const pressures = pressureInput?.pressures ?? null;
      if (pressureInput && pressures && pressures.length !== sourcePointCount) {
        reset();
        configProfileId = null;
        return planStudioAngledNibStrokeLocalCoverage(
          sourcePoints,
          strokeWidthInput,
          angleRadiansInput,
          pressureInput,
        );
      }
      const profileId = pressureInput ? pressureInput.profileId : null;
      if (
        strokeWidth !== configStrokeWidth
        || angleRadians !== configAngle
        || profileId !== configProfileId
        || !Object.is(configMinimumDiameterRatio, pressureInput?.minimumDiameterRatio)
        || configHasPressures !== (pressures !== null)
        || sourcePointCount < consumedPairs
      ) {
        reset();
        configStrokeWidth = strokeWidth;
        configAngle = angleRadians;
        configProfileId = profileId;
        configMinimumDiameterRatio = pressureInput?.minimumDiameterRatio;
        configHasPressures = pressures !== null;
      }
      if (consumedPairs > 0) {
        const lastIndex = consumedPairs - 1;
        if (
          sourcePoints[lastIndex * 2] !== lastRawX
          || sourcePoints[lastIndex * 2 + 1] !== lastRawY
          || (pressures ? pressures[lastIndex] : undefined) !== lastRawPressure
        ) {
          reset();
        }
      }

      for (let index = consumedPairs; index < sourcePointCount; index += 1) {
        const response = pressureInput
          ? resolveStudioRetainedMediaPressureAt(
              pressureInput.profileId,
              pressures,
              index,
              sourcePointCount,
              pressureInput.minimumDiameterRatio,
            )
          : undefined;
        const scale = response?.sizeScale ?? 1;
        const radius = strokeWidth * scale / 2;
        const nibX = radius * Math.cos(angleRadians);
        const nibY = radius * Math.sin(angleRadians);
        const x = finiteCoordinate(sourcePoints[index * 2]);
        const y = finiteCoordinate(sourcePoints[index * 2 + 1]);
        if (index >= 1 && previousX !== null && previousY !== null && x !== null && y !== null) {
          const polygon = normalizeStudioStrokeLocalCoveragePolygon([
            previousX - previousNibX,
            previousY - previousNibY,
            previousX + previousNibX,
            previousY + previousNibY,
            x + nibX,
            y + nibY,
            x - nibX,
            y - nibY,
          ]);
          if (polygon) {
            polygons.push(polygon);
            // 세그먼트는 두 표본에 걸치므로 두 표본의 안료를 나른다(배치 주석 그대로).
            const density = (
              sampleDensity(previousResponse)
              + sampleDensity(response)
            ) / 2;
            densities.push(density);
            densityPeak = Math.max(densityPeak, density);
            densityMin = Math.min(densityMin, density);
          }
        }
        previousResponse = response;
        previousNibX = nibX;
        previousNibY = nibY;
        previousX = x;
        previousY = y;
        lastRawX = sourcePoints[index * 2] as number;
        lastRawY = sourcePoints[index * 2 + 1] as number;
        lastRawPressure = pressures ? pressures[index] : undefined;
        consumedPairs = index + 1;
      }

      // 톤 밴딩은 관측 피크/플로어 상대 설계(의도적 전역) — 유지 배열 위에서 매 호출 접는다.
      // 밀도 극값은 러닝 폴드로 넘겨 무필압/평탄 밀도 획의 평면 판정을 이동당 O(1)로 만든다
      // (CI 러너에서 두 전체 스캔이 x2.0 경계를 넘겼다).
      const layers = planStudioTonalBandsFromExtremes(
        polygons,
        densities,
        finiteUnitInterval(pressureInput?.elementOpacity) ?? 1,
        densityPeak,
        densityMin,
      );
      return {
        kind: "studio-angled-nib-stroke-local-coverage-plan",
        version: STUDIO_STROKE_LOCAL_COVERAGE_VERSION,
        sourcePointCount,
        sourceSegmentCount,
        acceptedSegmentCount: polygons.length,
        polygons,
        shells: layers.shells,
        bands: layers.bands,
      };
    },
  };
}

const INCREMENTAL_ANGLED_NIB_CACHE = new Map<
  string,
  StudioIncrementalAngledNibCoverageBuilder
>();
/** 활성 초안은 하나지만 draft/commit 리렌더가 겹치는 짧은 창을 위해 소수의 최근 획을 유지한다. */
const INCREMENTAL_ANGLED_NIB_CACHE_LIMIT = 8;

/**
 * 획 키(요소 id)로 보관된 증분 앵글드 닙 커버리지 플랜 — `StudioDrawNode` 활성 초안의
 * `planStudioAngledNibStrokeLocalCoverage` 자리 교체용. 반환 플랜의 `polygons`는 내부 보관
 * 배열이므로 수정하면 안 된다.
 */
export function planStudioAngledNibStrokeLocalCoverageIncremental(
  strokeKey: string,
  sourcePoints: readonly number[],
  strokeWidthInput: unknown,
  angleRadiansInput?: unknown,
  pressureInput?: StudioAngledNibPressureInput | null,
): StudioAngledNibStrokeLocalCoveragePlan {
  let builder = INCREMENTAL_ANGLED_NIB_CACHE.get(strokeKey);
  if (builder) {
    // LRU 갱신: 재삽입으로 삽입 순서를 최근 사용 순서로 유지한다.
    INCREMENTAL_ANGLED_NIB_CACHE.delete(strokeKey);
  } else {
    builder = createStudioIncrementalAngledNibCoverageBuilder();
  }
  INCREMENTAL_ANGLED_NIB_CACHE.set(strokeKey, builder);
  while (INCREMENTAL_ANGLED_NIB_CACHE.size > INCREMENTAL_ANGLED_NIB_CACHE_LIMIT) {
    const oldest = INCREMENTAL_ANGLED_NIB_CACHE.keys().next().value;
    if (oldest === undefined) break;
    INCREMENTAL_ANGLED_NIB_CACHE.delete(oldest);
  }
  return builder.plan(sourcePoints, strokeWidthInput, angleRadiansInput, pressureInput);
}
