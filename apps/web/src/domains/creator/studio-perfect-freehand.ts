/**
 * Studio Perfect Freehand — 벡터 펜 스트로크 어댑터 (perfect-freehand / tldraw 필기감 엔진).
 *
 * 획의 점·필압·브러시 프로필을 받아 perfect-freehand `getStroke`의 아웃라인 폴리곤을 만들고,
 * 이를 Konva <Path data> / SVG export가 그대로 그릴 수 있는 채워진(fill) SVG 패스 문자열로
 * 변환하는 순수 어댑터. 스트로크는 stroked Line이 아니라 "선 색으로 채운 아웃라인 폴리곤"으로
 * 렌더된다 — 필압 굵기·테이퍼가 실제 지오메트리에 새겨져 확대/내보내기에서도 동일하다.
 *  - 결정성: getStroke는 입력만의 순수 함수다(난수 없음). 필압이 없을 때의 simulatePressure도
 *    점 간 거리 기반이라 같은 입력이면 협업 복제본·재렌더·내보내기에서 항상 같은 패스가 나온다.
 *  - 첫 획 규율: perfect-freehand 본체를 이 어댑터와 함께 정적으로 준비한다. 라이브 첫 프레임과
 *    동기 SVG export가 로더 완료 시점에 좌우되지 않으므로, 동일한 브러시가 첫 획에서만 평범한
 *    Line으로 강등되는 품질 차이를 허용하지 않는다. 스트로커는 여전히 DI 파라미터로 받아 DOM
 *    의존 없이 단위 테스트할 수 있다.
 *  - 라이브 계약: 다이렉트 핫패스 초안 파이프라인(임페러티브 sceneFunc/WebGPU — pen/marker
 *    전용)은 건드리지 않는다. "perfect" 패밀리는 direct-live 대상이 아니므로 리테인드 초안과
 *    커밋 렌더 모두 StudioDrawNode의 같은 어댑터 경로를 지난다(pointer-up 커밋 스왑 계약 유지).
 *  - 크기 다이내믹스(D-08): 프로필이 sizeDynamics 를 선언하면 패키지 레인
 *    (studio-brush-platform geometry.ts, D-03)과 동일한 프리매핑으로 velocity/tilt 폭 반응을
 *    얻는다. 미선언 프로필은 종전 경로가 바이트 동일하게 유지된다.
 */
import { getStroke, type StrokeOptions } from "perfect-freehand";

import { resampleStrokePressures } from "./studio-brush";

/** 렌더러가 perfect-freehand 타입에 직접 의존하지 않도록 재노출하는 스트로커 핸들 타입. */
export type StudioPerfectFreehandStroker = (
  points: (number[] | { x: number; y: number; pressure?: number })[],
  options?: StrokeOptions
) => number[][];

// ---------------------------------------------------------------------------
// 브러시 프로필 — 카탈로그 id → getStroke 옵션 튜닝(단일 정의처)
// ---------------------------------------------------------------------------

export type StudioPerfectFreehandProfileId =
  | "perfect-ink"
  | "perfect-marker"
  | "gpen"
  | "maru-pen";

// ---------------------------------------------------------------------------
// D-08 — 아웃라인 크기 다이내믹스 프리매핑 (패키지 레인 D-03 포팅)
// ---------------------------------------------------------------------------

/**
 * 패키지 레인(studio-brush-platform geometry.ts) DynamicInputIR 의 결정적 부분집합.
 * "random"/"twist" 는 시드 다이내믹스 소관이라 여기서 받지 않는다(아웃라인 레인은 무시드).
 */
export type StudioPerfectFreehandSizeDynamicInput =
  | "pressure"
  | "velocity"
  | "tiltAltitude"
  | "tiltAzimuth"
  | "constant";

/** 패키지 DynamicMappingIR 미러 — [0,1] 균일 LUT(탭 ≥ 2), 탭 사이 선형 보간. */
export interface StudioPerfectFreehandSizeDynamicMapping {
  readonly input: StudioPerfectFreehandSizeDynamicInput;
  readonly curve: readonly number[];
  readonly min: number;
  readonly max: number;
}

/**
 * 포인트별 스타일러스 다이내믹스 입력. 결측 필드의 기본값은 패키지 modeledSampleIRSchema 의
 * 기본값과 같다(velocity 0, altitudeDeg 90, azimuthDeg 0) — 두 레인의 폭 패리티 전제.
 */
export interface StudioPerfectFreehandDynamicsSample {
  /** 장면 좌표 px/ms — 패키지 ModeledSampleIR.velocity 와 같은 단위. min(1, v/4)로 정규화. */
  readonly velocity?: number;
  /** 0(완전 눕힘)–90(수직). */
  readonly altitudeDeg?: number;
  /** 0–360. */
  readonly azimuthDeg?: number;
}

/**
 * 패키지 studio-project-model `evaluateDynamicMapping` 미러 — 식 순서까지 동일하다.
 * 값 배럴(zod) import 는 핫 청크(StudioDrawNode)로 zod 를 끌어들이므로 로컬 미러를 쓰고,
 * 크로스 레인 패리티 테스트(studio-perfect-freehand.test.ts)가 두 구현을 상호 고정한다.
 */
function evaluateStudioPerfectFreehandSizeDynamicMapping(
  mapping: StudioPerfectFreehandSizeDynamicMapping,
  inputValue: number
): number {
  const clamped = Math.min(1, Math.max(0, inputValue));
  const scaled = clamped * (mapping.curve.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(mapping.curve.length - 1, lower + 1);
  const t = scaled - lower;
  const lowerValue = mapping.curve[lower] ?? 0;
  const upperValue = mapping.curve[upper] ?? lowerValue;
  const curveValue = lowerValue + (upperValue - lowerValue) * t;
  return mapping.min + (mapping.max - mapping.min) * curveValue;
}

/** 패키지 geometry `effectiveSizeAt` 미러 — 다이내믹스 곱 누적과 0.1px 바닥까지 동일. */
export function studioPerfectFreehandEffectiveSizeAt(
  sizeDynamics: readonly StudioPerfectFreehandSizeDynamicMapping[],
  baseSizePx: number,
  pressure: number,
  sample?: StudioPerfectFreehandDynamicsSample
): number {
  let size = baseSizePx;
  for (const mapping of sizeDynamics) {
    const input =
      mapping.input === "pressure"
        ? pressure
        : mapping.input === "velocity"
          ? Math.min(1, (sample?.velocity ?? 0) / 4)
          : mapping.input === "tiltAltitude"
            ? (sample?.altitudeDeg ?? 90) / 90
            : mapping.input === "tiltAzimuth"
              ? (sample?.azimuthDeg ?? 0) / 360
              : 1; // "constant"
    size *= evaluateStudioPerfectFreehandSizeDynamicMapping(mapping, input);
  }
  return Math.max(0.1, size);
}

/**
 * D-08 프리매핑: 다이내믹스가 해석한 샘플별 목표 반지름을 perfect-freehand 필압 채널로
 * 인코딩한다. perfect-freehand 의 포인트 반지름은 size * (0.5 - thinning * (0.5 - pressure))
 * 이므로 thinning 을 1로 고정하면 반지름 = size × p — 인코딩된 필압이 반지름을 선형으로
 * 지정해, 지오메트리 자체 thinning 이 "샘플의 유효 크기"에서 만들었을 반지름을 그대로
 * 재현한다. 패키지 레인 strokeOutlinePath(D-03)와 같은 식·같은 clamp 다.
 */
export function studioPerfectFreehandEncodeDynamicsPressure(
  effectiveSize: number,
  thinning: number,
  pressure: number,
  baseSizePx: number
): number {
  const radius = effectiveSize * (0.5 - thinning * (0.5 - pressure));
  return Math.min(1, Math.max(0, radius / baseSizePx));
}

/**
 * Selectable brushes backed by the outline stroker.
 *
 * G-pen siblings share one geometry profile except maru-pen, which keeps a hairline outline
 * captured into the outline-stroke snapshot so persisted pre-change strokes stay on the G-pen
 * numbers they already stored.
 */
export type StudioPerfectFreehandBrushId =
  | StudioPerfectFreehandProfileId
  | "school-pen"
  | "maru-pen"
  | "mapping-pen"
  | "kaburapen"
  | "liner"
  | "pen--perfect-taper"
  | "calligraphy--perfect-chisel";

/** 퍼펙트-프리핸드 렌더 경로를 쓰는 브러시의 획 성격 — 카탈로그 계약과 함께 감사된다. */
export interface StudioPerfectFreehandProfile {
  readonly id: StudioPerfectFreehandProfileId;
  /** 필압이 굵기에 미치는 영향(0=균일 굵기, 1=최대) — getStroke thinning. */
  readonly thinning: number;
  /** 아웃라인 모서리 연화 정도 — getStroke smoothing. */
  readonly smoothing: number;
  /** 입력 점 지터를 억제하는 보간 강도 — getStroke streamline. */
  readonly streamline: number;
  /** 획 시작을 펜촉처럼 가늘게 뽑는 길이 = strokeWidth × factor (0이면 테이퍼 없음). */
  readonly taperStartFactor: number;
  /** 획 끝 테이퍼 길이 = strokeWidth × factor (0이면 테이퍼 없음). */
  readonly taperEndFactor: number;
  /** 테이퍼가 0일 때 끝을 둥근 캡으로 마감할지. */
  readonly capStart: boolean;
  readonly capEnd: boolean;
  /**
   * D-08: 프로필이 선언하는 크기 다이내믹스(패키지 BrushProgramIR.sizeDynamics 와 동일 의미론).
   * 선언한 프로필만 프리매핑 분기를 타고, 미선언 프로필은 기존 렌더 경로가 바이트 동일하게
   * 유지된다. 2026-08-20 현재 카탈로그 프로필은 아직 아무것도 선언하지 않는다 — 영속
   * outlineStroke 계약 스냅샷(StudioOutlineStrokeProfileSnapshotV1)이 이 필드를 운반하지 않아,
   * 지금 선언하면 라이브 프리뷰와 커밋/SVG 리플레이가 어긋난다. 계약 v-next 가 스냅샷에
   * sizeDynamics 를 실은 뒤에만 카탈로그 선언을 켠다.
   */
  readonly sizeDynamics?: readonly StudioPerfectFreehandSizeDynamicMapping[];
}

/**
 * 퍼펙트-프리핸드 브러시 카탈로그 프로필.
 *  - perfect-ink: 강한 thinning + 양끝 테이퍼 — 붓펜/캘리 잉크의 눌림·빠짐 필기감.
 *  - perfect-marker: 약한 thinning + 캡 마감 — 균일에 가까운 매끈한 마커 획.
 */
export const STUDIO_PERFECT_FREEHAND_PROFILES: Readonly<
  Record<StudioPerfectFreehandProfileId, StudioPerfectFreehandProfile>
> = {
  "perfect-ink": {
    id: "perfect-ink",
    thinning: 0.72,
    smoothing: 0.52,
    streamline: 0.45,
    taperStartFactor: 2.8,
    taperEndFactor: 3.4,
    capStart: true,
    capEnd: true,
  },
  "perfect-marker": {
    id: "perfect-marker",
    thinning: 0.16,
    smoothing: 0.62,
    streamline: 0.32,
    taperStartFactor: 0,
    taperEndFactor: 0,
    capStart: true,
    capEnd: true,
  },
  gpen: {
    id: "gpen",
    // perfect-freehand's pressure diameter is `1 + 2 * thinning * (p - .5)`.
    // 0.775 therefore reproduces the historical G-pen curve (0.225 + 1.55p) while replacing
    // discrete constant-width capsules with one continuous variable-width outline.
    thinning: 0.775,
    smoothing: 0.68,
    // Upstream input stabilization already owns centre-line correction. A very small streamline
    // value avoids moving the visible prefix again whenever a live stroke appends one sample.
    streamline: 0.06,
    taperStartFactor: 0.85,
    taperEndFactor: 1.2,
    capStart: true,
    capEnd: true,
  },
  "maru-pen": {
    id: "maru-pen",
    // Hairline manga nib: stronger thinning so light pressure stays a thread and deliberate
    // pressure opens late. New strokes snapshot these numbers; older elements keep the G-pen
    // snapshot they already stored.
    thinning: 0.88,
    smoothing: 0.74,
    streamline: 0.05,
    taperStartFactor: 0.95,
    taperEndFactor: 1.4,
    capStart: true,
    capEnd: true,
  },
};

const STUDIO_PERFECT_FREEHAND_PROFILE_BY_BRUSH: Readonly<
  Record<StudioPerfectFreehandBrushId, StudioPerfectFreehandProfileId>
> = {
  "perfect-ink": "perfect-ink",
  "perfect-marker": "perfect-marker",
  gpen: "gpen",
  "school-pen": "gpen",
  "maru-pen": "maru-pen",
  "mapping-pen": "gpen",
  kaburapen: "gpen",
  liner: "gpen",
  // 엔진 레인 카탈로그가 engine "perfect-outline" 로 선언한 두 레인. 여기에 없으면
  // resolveStudioPerfectFreehandProfile 이 null 을 돌려주고, 두 브러시는 선언과 달리 가변 폭
  // 아웃라인도 테이퍼도 없는 균일 굵기 폴리라인으로 그려진다 — 획의 시작과 끝이 뭉툭해지는
  // 원인이다. 각 행이 canonicalId 로 지목한 프로필을 그대로 쓴다(gpen 계열과 같은 규약).
  "pen--perfect-taper": "perfect-ink",
  "calligraphy--perfect-chisel": "perfect-marker",
};

/** 브러시 id가 연속 가변 폭 아웃라인 경로를 쓰면 프로필, 아니면 null — 렌더러의 단일 판정 지점. */
export function resolveStudioPerfectFreehandProfile(
  brushId: unknown
): StudioPerfectFreehandProfile | null {
  if (typeof brushId !== "string" || !brushId) return null;
  const profileId =
    STUDIO_PERFECT_FREEHAND_PROFILE_BY_BRUSH[brushId as StudioPerfectFreehandBrushId];
  return profileId ? STUDIO_PERFECT_FREEHAND_PROFILES[profileId] : null;
}

function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

const STUDIO_PERFECT_FREEHAND_MIN_SIZE = 0.5;
const STUDIO_PERFECT_FREEHAND_MAX_SIZE = 400;
const STUDIO_PERFECT_FREEHAND_FALLBACK_SIZE = 6;
const STUDIO_PERFECT_FREEHAND_MAX_COMPACT_DOT_FLOOR = 3;

function studioPerfectFreehandClampedSize(strokeWidth: unknown): number {
  return clampTo(
    strokeWidth,
    STUDIO_PERFECT_FREEHAND_MIN_SIZE,
    STUDIO_PERFECT_FREEHAND_MAX_SIZE,
    STUDIO_PERFECT_FREEHAND_FALLBACK_SIZE,
  );
}

/**
 * Largest distance from the centre line that the retained perfect-freehand renderer can paint.
 * The pinned v1 profiles and dynamic-size branch keep thinning in [-1, 1] and pressure in [0, 1],
 * so perfect-freehand's radius expression never exceeds its clamped `size` option. StudioDrawNode
 * bypasses that planner for compact legacy taps and floors their radius at 3px for perfect-ink
 * (1.4px for other perfect profiles); its short-stroke Line fallback also floors endpoint dots at
 * 2px. The 3px maximum therefore bounds every perfect route without changing the planner's size.
 */
export function studioPerfectFreehandMaximumPaintRadius(strokeWidth: unknown): number {
  return Math.max(
    STUDIO_PERFECT_FREEHAND_MAX_COMPACT_DOT_FLOOR,
    studioPerfectFreehandClampedSize(strokeWidth),
  );
}

export interface StudioPerfectFreehandWorkUpperBound {
  readonly strokePointCount: number;
  readonly outlinePointCount: number;
  readonly outlineCoordinateScalars: number;
  /** Numeric coordinate fields serialized into the M/Q path data. */
  readonly pathCoordinateScalars: number;
  /** M + one Q per outline point + Z. */
  readonly pathCommands: number;
}

/**
 * O(1) renderer-expanded work bound for the pinned `perfect-freehand@1.2.3:getStroke` algorithm.
 *
 * `getStrokePoints` expands exactly two source points to five and otherwise cannot increase the
 * source count. `getStrokeOutlinePoints` can append 14 points to each side at a sharp turn (28 per
 * stroke point), then at most 13 start-cap plus 29 end-cap points. Studio's path adapter emits one
 * quadratic command with four numeric coordinate fields per outline point. These constants come
 * from the dependency's loop structure, not a benchmark-tuned sample threshold; the regression
 * test compares real adversarial outlines against this bound so a package upgrade must revisit it.
 */
export function studioPerfectFreehandWorkUpperBound(
  sourcePointCount: number,
): StudioPerfectFreehandWorkUpperBound | null {
  if (!Number.isSafeInteger(sourcePointCount) || sourcePointCount < 0) return null;
  if (sourcePointCount === 0) {
    return {
      strokePointCount: 0,
      outlinePointCount: 0,
      outlineCoordinateScalars: 0,
      pathCoordinateScalars: 0,
      pathCommands: 0,
    };
  }
  const strokePointCount = Math.max(sourcePointCount, 5);
  const outlinePointCount = 28 * strokePointCount + 42;
  return {
    strokePointCount,
    outlinePointCount,
    outlineCoordinateScalars: outlinePointCount * 2,
    pathCoordinateScalars: 2 + outlinePointCount * 4,
    pathCommands: outlinePointCount + 2,
  };
}

/**
 * 프로필 + 브러시 굵기 → getStroke 옵션. easing은 기본값(결정적)을 쓰고, 하드웨어 필압
 * 배열이 없을 때만 속도 기반 시뮬레이션을 켠다(입력 좌표만의 함수라 역시 결정적).
 */
export function studioPerfectFreehandStrokeOptions(
  profile: StudioPerfectFreehandProfile,
  strokeWidth: number,
  hasPressures: boolean,
  segmentLength?: number
): StrokeOptions {
  const size = studioPerfectFreehandClampedSize(strokeWidth);
  const safeShortLength = size * 1.4;
  const measured = segmentLength !== undefined;
  const usableLength = measured && Number.isFinite(segmentLength) && segmentLength > 0
    ? segmentLength
    : 0;
  // 짧은 획에서 테이퍼를 끄는 규칙은 필요하다 — 양끝 테이퍼가 길이보다 길면 획이 제 굵기에
  // 닿지 못하고 바늘이 된다. 문제는 그게 boolean 이었다는 것이다. 길이 1.4×size 를 경계로
  // 1.39배는 테이퍼 0(뭉툭한 막대), 1.41배는 프로필 테이퍼 전량(perfect-ink 는 양끝 합
  // 6.2×size)이 한꺼번에 걸려서, 거의 같은 길이의 두 획이 전혀 다른 모양으로 나왔다. 짧은
  // 해칭이나 점을 여러 번 찍는 웹툰 선화에서 바로 드러나는 불연속이다.
  //
  // 경계 위로 남는 길이를 테이퍼 예산으로 삼아 프로필 값까지 선형으로 열어준다. 경계에서
  // 정확히 0 이라 기존 동작과 연속이고, 긴 획은 종전대로 프로필 값을 그대로 받는다. 예산은
  // 양끝의 factor 비율대로 나눠 시작/끝의 성격 차이(perfect-ink 는 끝이 더 길다)를 지킨다.
  const taperBudget = measured ? Math.max(0, usableLength - safeShortLength) : Infinity;
  const totalFactor = Math.max(0, profile.taperStartFactor) + Math.max(0, profile.taperEndFactor);
  const taperFor = (factor: number): number => {
    if (factor <= 0 || totalFactor <= 0) return 0;
    return Math.min(size * factor, taperBudget * (factor / totalFactor));
  };
  return {
    size,
    thinning: profile.thinning,
    smoothing: profile.smoothing,
    streamline: profile.streamline,
    simulatePressure: !hasPressures,
    last: true,
    start: {
      cap: profile.capStart,
      taper: taperFor(profile.taperStartFactor),
    },
    end: {
      cap: profile.capEnd,
      taper: taperFor(profile.taperEndFactor),
    },
  };
}

// ---------------------------------------------------------------------------
// outline → SVG 패스 문자열 매핑(순수)
// ---------------------------------------------------------------------------

/** 소수 둘째 자리 반올림 — 패스 문자열을 결정적·직렬화 친화적으로 유지. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * getStroke 아웃라인 폴리곤 → 채워질 SVG 패스 `d` 문자열.
 * 표준 perfect-freehand 레시피: 각 정점을 제어점으로, 이웃 정점과의 중점을 끝점으로 하는
 * 이차 곡선(Q) 체인으로 폴리곤을 부드럽게 닫는다. 정점이 3개 미만이거나 비유한 좌표가
 * 섞여 있으면 빈 문자열을 반환한다(렌더러는 깨끗한 Line 폴백).
 */
export function studioPerfectFreehandOutlineToPathData(
  outline: readonly (readonly number[])[]
): string {
  if (outline.length < 3) return "";
  for (const vertex of outline) {
    if (
      vertex.length < 2
      || !Number.isFinite(vertex[0])
      || !Number.isFinite(vertex[1])
    ) {
      return "";
    }
  }
  const first = outline[0]!;
  const parts: string[] = [`M${round2(first[0]!)} ${round2(first[1]!)}`];
  for (let index = 0; index < outline.length; index++) {
    const current = outline[index]!;
    const next = outline[(index + 1) % outline.length]!;
    parts.push(
      `Q${round2(current[0]!)} ${round2(current[1]!)} ` +
        `${round2((current[0]! + next[0]!) / 2)} ${round2((current[1]! + next[1]!) / 2)}`
    );
  }
  parts.push("Z");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 획 → 아웃라인/패스 빌드(순수, 스트로커는 DI)
// ---------------------------------------------------------------------------

export interface StudioPerfectFreehandStrokeInput {
  /** 평탄 좌표 [x0,y0,x1,y1,...] — DrawEl.points(대칭 변형본 포함) 그대로. */
  readonly points: readonly number[];
  /** DrawEl.pressures — 없으면 getStroke의 속도 기반 시뮬레이션을 쓴다. */
  readonly pressures?: readonly number[] | null;
  readonly strokeWidth: number;
  readonly profile: StudioPerfectFreehandProfile;
  /**
   * D-08: 소스 포인트 인덱스와 정렬된 포인트별 다이내믹스 샘플(velocity/tilt).
   * 프로필이 sizeDynamics 를 선언한 경우에만 소비된다 — 미선언 프로필은 이 값과 무관하게
   * 기존 경로 그대로다(결측 인덱스는 패키지 스키마 기본값으로 해석).
   */
  readonly dynamics?: readonly StudioPerfectFreehandDynamicsSample[] | null;
}

/**
 * 평탄 점·필압을 getStroke 입력으로 정규화해 아웃라인 폴리곤을 만든다. 스트로커는
 * loadStudioPerfectFreehandStroker()가 만든 getStroke(DI — 테스트에서는 직접 import 주입 가능).
 * 유효한 점이 2개 미만이면 빈 배열을 반환한다(렌더러는 깨끗한 Line/도트 폴백).
 */
export function buildStudioPerfectFreehandOutline(
  stroker: StudioPerfectFreehandStroker,
  input: StudioPerfectFreehandStrokeInput
): number[][] {
  const pointCount = Math.floor(input.points.length / 2);
  if (pointCount < 2) return [];

  const hasPressures = Array.isArray(input.pressures) && input.pressures.length > 0;
  const sampledPressures = hasPressures
    ? resampleStrokePressures(input.pressures, pointCount, 0.5)
    : null;

  // D-08: 프로필이 sizeDynamics 를 선언하면 샘플별 유효 크기를 필압 채널로 프리매핑한다.
  // baseSizePx 는 getStroke 로 전달되는 클램프된 size 와 반드시 같아야 반지름 인코딩
  // (radius / size)이 어긋나지 않는다(studioPerfectFreehandStrokeOptions 와 같은 클램프).
  const sizeDynamics = input.profile.sizeDynamics;
  const hasSizeDynamics = sizeDynamics !== undefined && sizeDynamics.length > 0;
  const baseSizePx = studioPerfectFreehandClampedSize(input.strokeWidth);

  const strokePoints: number[][] = [];
  for (let index = 0; index < pointCount; index++) {
    const x = input.points[index * 2];
    const y = input.points[index * 2 + 1];
    if (
      typeof x !== "number" || !Number.isFinite(x)
      || typeof y !== "number" || !Number.isFinite(y)
    ) {
      continue;
    }
    const pressure = sampledPressures?.[index] ?? 0.5;
    if (hasSizeDynamics) {
      const effectiveSize = studioPerfectFreehandEffectiveSizeAt(
        sizeDynamics,
        baseSizePx,
        pressure,
        input.dynamics?.[index]
      );
      strokePoints.push([
        x,
        y,
        studioPerfectFreehandEncodeDynamicsPressure(
          effectiveSize,
          input.profile.thinning,
          pressure,
          baseSizePx
        ),
      ]);
    } else {
      strokePoints.push([x, y, pressure]);
    }
  }
  if (strokePoints.length < 2) return [];
  let pathLength = 0;
  for (let index = 1; index < strokePoints.length; index += 1) {
    const previous = strokePoints[index - 1]!;
    const current = strokePoints[index]!;
    pathLength += Math.hypot(current[0]! - previous[0]!, current[1]! - previous[1]!);
  }

  const options = studioPerfectFreehandStrokeOptions(
    input.profile,
    input.strokeWidth,
    hasPressures,
    pathLength
  );
  // D-08: 다이내믹스 분기는 필압 채널이 반지름을 직접 지정하므로 thinning 1 고정 +
  // 속도 시뮬레이션 해제(패키지 레인과 동일). 미선언 프로필은 options 를 손대지 않는다.
  return stroker(
    strokePoints,
    hasSizeDynamics ? { ...options, thinning: 1, simulatePressure: false } : options
  );
}

/**
 * 획 → Konva <Path data>/SVG로 그릴 채워진 아웃라인 패스 문자열.
 * 지오메트리가 부족하거나 비정상이면 빈 문자열(렌더러 폴백).
 */
export function buildStudioPerfectFreehandPathData(
  stroker: StudioPerfectFreehandStroker,
  input: StudioPerfectFreehandStrokeInput
): string {
  const path = studioPerfectFreehandOutlineToPathData(
    buildStudioPerfectFreehandOutline(stroker, input)
  );
  if (typeof globalThis !== "undefined") {
    const debug = (globalThis as { __debugPerfectInk?: boolean }).__debugPerfectInk;
    if (debug) {
      const pointCount = Math.floor(input.points.length / 2);
      const profileId = input.profile.id;
      console.log(
        `[debug-perfect-ink] ${profileId} points=${pointCount} inputWidth=${input.strokeWidth} pathLen=${path.length}`
      );
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// perfect-freehand 정적 준비 어댑터
// ---------------------------------------------------------------------------

const STUDIO_PERFECT_FREEHAND_STROKER: StudioPerfectFreehandStroker = getStroke;
const STUDIO_PERFECT_FREEHAND_STROKER_PROMISE =
  Promise.resolve(STUDIO_PERFECT_FREEHAND_STROKER);

/**
 * 동기 프레임에서 즉시 쓸 수 있는 스트로커.
 *
 * 반환 타입의 `null`은 기존 호출자 호환성을 위해 유지하지만 정적 import 이후 실제 런타임에서는
 * 항상 함수다. 따라서 StudioDrawNode와 SVG export의 기존 null 폴백은 정상 제품 경로에서
 * 도달하지 않는다.
 */
export function peekStudioPerfectFreehandStroker(): StudioPerfectFreehandStroker | null {
  return STUDIO_PERFECT_FREEHAND_STROKER;
}

/**
 * 기존 비동기 호출 계약을 보존하는 정적 준비 핸들. 호출 시점과 관계없이 `peek`과 같은
 * 스트로커로 이미 이행된 Promise를 반환한다.
 */
export function loadStudioPerfectFreehandStroker(): Promise<StudioPerfectFreehandStroker> {
  return STUDIO_PERFECT_FREEHAND_STROKER_PROMISE;
}
