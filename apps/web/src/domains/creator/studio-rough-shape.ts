/**
 * Studio Rough Shape — 손그림(스케치) 도형 어댑터 (rough.js / Excalidraw 렌더 엔진).
 *
 * 도형 종류 + 지오메트리 + 스케치 옵션 + 시드를 받아 rough.js generator의 드로어블을 만들고,
 * 그 op-set들을 Konva <Path data>로 그릴 수 있는 SVG 패스 문자열로 변환하는 순수 어댑터.
 *  - 결정성: rough.js `seed` 옵션에 요소 id의 FNV-1a 해시를 넣는다. 같은 (id, 지오메트리,
 *    옵션)은 협업 복제본·재렌더에서 항상 같은 패스 문자열을 만든다(Math.random 경로 없음).
 *  - 번들 규율: rough.js 자체는 이 모듈의 `loadStudioRoughGenerator()` 동적 import 뒤에만
 *    로드된다. 이 파일의 나머지(타입·정규화·ops→path 매핑)는 eager 그래프에 안전한 순수
 *    코드다. generator는 DI 파라미터로 받아 DOM/canvas 의존 없이 단위 테스트할 수 있다.
 *  - `StudioSketchStyle`은 DrawEl의 `sketch?` 필드로 영속될 스키마의 단일 정의처다
 *    (element-model 한 줄 추가는 통합 스펙에서 수행).
 */
import {
  lineArrowHeadGeoms,
  polygonPathPointsInBounds,
  starPathPoints,
  type ShapeParams,
  type StrokeShapeKind,
} from "./brush/studio-stroke-shapes";

import type { Op as RoughOp, Options as RoughOptions } from "roughjs/bin/core";
import type { RoughGenerator } from "roughjs/bin/generator";

/** 렌더러가 rough.js 타입에 직접 의존하지 않도록 재노출하는 generator 핸들 타입. */
export type StudioRoughGeneratorHandle = RoughGenerator;

// ---------------------------------------------------------------------------
// 스케치 스타일 스키마 — 정규화·기본값·패널 선택지
// ---------------------------------------------------------------------------

/** rough.js fillStyle 중 스튜디오가 노출하는 4종. */
export type StudioSketchFillStyle = "hachure" | "solid" | "cross-hatch" | "zigzag";

/** 도형별 손그림(스케치) 렌더 스타일 — DrawEl.sketch 로 영속된다. */
export type StudioSketchStyle = {
  /** true면 도형이 깨끗한 Konva 프리미티브 대신 rough.js 손그림 패스로 그려진다. */
  enabled: boolean;
  /** 선의 흔들림 정도(0.5 = 거의 곧음, 3 = 매우 거침). */
  roughness: number;
  /** 선이 활처럼 휘는 정도(0 = 곧게, 6 = 크게 휨). */
  bowing: number;
  /** 채우기 질감 — 채우기 색이 있는 도형에서만 의미가 있다. */
  fillStyle: StudioSketchFillStyle;
};

/** 채우기 질감 선택지 — 패널 칩에 한글 라벨 그대로 노출. */
export const STUDIO_SKETCH_FILL_STYLES: {
  id: StudioSketchFillStyle;
  label: string;
  tip: string;
}[] = [
  { id: "hachure", label: "빗금", tip: "손으로 그은 사선 빗금으로 채웁니다." },
  { id: "solid", label: "단색", tip: "흔들리는 외곽선 안쪽을 단색으로 채웁니다." },
  { id: "cross-hatch", label: "교차 빗금", tip: "두 방향 빗금을 교차해 촘촘히 채웁니다." },
  { id: "zigzag", label: "지그재그", tip: "지그재그 획으로 거칠게 채웁니다." },
];

/** 패널 슬라이더 범위 — normalize와 UI가 같은 값을 공유한다. */
export const STUDIO_SKETCH_RANGES = {
  roughness: { min: 0.5, max: 3, step: 0.1 },
  bowing: { min: 0, max: 6, step: 0.5 },
} as const;

/** 기본 스케치 스타일 — 끔 상태 + Excalidraw 감성의 중간 거칠기. */
export const DEFAULT_STUDIO_SKETCH_STYLE: StudioSketchStyle = {
  enabled: false,
  roughness: 1.5,
  bowing: 1,
  fillStyle: "hachure",
};

function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/** 저장/외부 입력을 안전한 StudioSketchStyle로 정규화 — 이상값은 필드별 기본값·클램프. */
export function normalizeStudioSketchStyle(raw: unknown): StudioSketchStyle {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STUDIO_SKETCH_STYLE };
  const obj = raw as Partial<Record<keyof StudioSketchStyle, unknown>>;
  const ranges = STUDIO_SKETCH_RANGES;
  return {
    enabled: obj.enabled === true,
    roughness: clampTo(
      obj.roughness,
      ranges.roughness.min,
      ranges.roughness.max,
      DEFAULT_STUDIO_SKETCH_STYLE.roughness
    ),
    bowing: clampTo(obj.bowing, ranges.bowing.min, ranges.bowing.max, DEFAULT_STUDIO_SKETCH_STYLE.bowing),
    fillStyle: STUDIO_SKETCH_FILL_STYLES.some((item) => item.id === obj.fillStyle)
      ? (obj.fillStyle as StudioSketchFillStyle)
      : DEFAULT_STUDIO_SKETCH_STYLE.fillStyle,
  };
}

/** 기본 스케치 스타일(끔·기본 파라미터)인지 — 패널 "기본값" 버튼 비활성 판정용. */
export function isDefaultStudioSketchStyle(style: StudioSketchStyle): boolean {
  return (
    style.enabled === DEFAULT_STUDIO_SKETCH_STYLE.enabled &&
    style.roughness === DEFAULT_STUDIO_SKETCH_STYLE.roughness &&
    style.bowing === DEFAULT_STUDIO_SKETCH_STYLE.bowing &&
    style.fillStyle === DEFAULT_STUDIO_SKETCH_STYLE.fillStyle
  );
}

/**
 * 요소에서 스케치 스타일을 읽는다 — DrawEl.sketch 필드가 element-model에 추가되기 전까지의
 * 단일 접근 지점(구조적 unknown 읽기). sketch 객체가 아예 없으면 null.
 */
export function studioSketchStyleOfElement(el: unknown): StudioSketchStyle | null {
  if (!el || typeof el !== "object") return null;
  const raw = (el as { sketch?: unknown }).sketch;
  if (!raw || typeof raw !== "object") return null;
  return normalizeStudioSketchStyle(raw);
}

// ---------------------------------------------------------------------------
// 결정적 시드 — 요소 id → rough.js seed
// ---------------------------------------------------------------------------

// rough.js는 seed 0을 "무작위(Math.random)"로 취급하므로 반드시 1 이상을 만든다.
const ROUGH_SEED_SPAN = 2147483646; // 2^31 - 2

/**
 * 요소 id의 FNV-1a 32비트 해시 → rough.js seed(1..2^31-1).
 * 같은 id는 항상 같은 seed — 재렌더·협업 복제본·내보내기에서 픽셀이 동일하다.
 */
export function studioRoughSeedFromElementId(id: unknown): number {
  if (typeof id !== "string" || id.length === 0) return 1;
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 1 + ((hash >>> 0) % ROUGH_SEED_SPAN);
}

// ---------------------------------------------------------------------------
// ops → SVG 패스 문자열 매핑(순수)
// ---------------------------------------------------------------------------

/** 소수 둘째 자리 반올림 — 패스 문자열을 결정적·직렬화 친화적으로 유지. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * rough.js op 목록 → SVG 패스 `d` 문자열. move→M, lineTo→L, bcurveTo→C.
 * 좌표는 소수 둘째 자리로 반올림한다. 알 수 없는 op·좌표 부족은 건너뛴다.
 */
export function studioRoughOpsToPathData(ops: readonly RoughOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    const data = op.data;
    if (data.some((value) => typeof value !== "number" || !Number.isFinite(value))) continue;
    if (op.op === "move" && data.length >= 2) {
      parts.push(`M${round2(data[0]!)} ${round2(data[1]!)}`);
    } else if (op.op === "lineTo" && data.length >= 2) {
      parts.push(`L${round2(data[0]!)} ${round2(data[1]!)}`);
    } else if (op.op === "bcurveTo" && data.length >= 6) {
      parts.push(
        `C${round2(data[0]!)} ${round2(data[1]!)}, ${round2(data[2]!)} ${round2(data[3]!)}, ` +
          `${round2(data[4]!)} ${round2(data[5]!)}`
      );
    }
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 도형 → 렌더 계획(순수, generator는 DI)
// ---------------------------------------------------------------------------

/**
 * 패스 하나의 페인트 역할 — 렌더러(Konva Path)가 색·굵기를 결정한다.
 *  - outline: 선 색으로 스트로크(도형 외곽선).
 *  - fill: 채우기 색으로 채움(닫힌 solid 채우기 패스).
 *  - fill-hatch: 채우기 색으로 스트로크(빗금/교차 빗금/지그재그 질감 획).
 *  - outline-fill: 선 색으로 채움(화살촉 삼각형 등 solid 머리).
 */
export type StudioRoughPathRole = "outline" | "fill" | "fill-hatch" | "outline-fill";

export interface StudioRoughRenderPath {
  readonly data: string;
  readonly role: StudioRoughPathRole;
  /** outline/fill-hatch 역할의 스트로크 굵기. 채움 역할은 0. */
  readonly strokeWidth: number;
}

export interface StudioRoughShapeInput {
  readonly kind: StrokeShapeKind;
  /** 원본 평탄 좌표 [x0,y0,x1,y1,...] — DrawEl.points(대칭 변형본 포함) 그대로. */
  readonly points: readonly number[];
  readonly strokeWidth: number;
  /** 채우기 색이 있는지(fill-hatch/fill 패스 생성 여부). 선·화살표에서는 무시된다. */
  readonly hasFill: boolean;
  /** 별 꼭짓점/다각형 변 수 — 깨끗한 렌더와 같은 정점 함수를 공유해 형태가 일치한다. */
  readonly shapeParams: ShapeParams;
  readonly style: StudioSketchStyle;
  /** studioRoughSeedFromElementId(el.id) — 1 이상 정수. */
  readonly seed: number;
}

function flatToPairs(points: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    pairs.push([points[index]!, points[index + 1]!]);
  }
  return pairs;
}

function boundsOf(points: readonly number[]): { x: number; y: number; width: number; height: number } | null {
  if (points.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    minX = Math.min(minX, points[index]!);
    maxX = Math.max(maxX, points[index]!);
    minY = Math.min(minY, points[index + 1]!);
    maxY = Math.max(maxY, points[index + 1]!);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(0.1, maxX - minX),
    height: Math.max(0.1, maxY - minY),
  };
}

/** rough 드로어블의 op-set들을 역할별 렌더 패스로 평탄화한다(빈 패스는 제외). */
function pathsFromSets(
  sets: readonly { type: string; ops: RoughOp[] }[],
  strokeWidth: number,
  fillWeight: number,
  solidFillRole: "fill" | "outline-fill"
): StudioRoughRenderPath[] {
  const paths: StudioRoughRenderPath[] = [];
  for (const set of sets) {
    const data = studioRoughOpsToPathData(set.ops);
    if (!data) continue;
    if (set.type === "path") {
      paths.push({ data, role: "outline", strokeWidth });
    } else if (set.type === "fillSketch") {
      paths.push({ data, role: "fill-hatch", strokeWidth: fillWeight });
    } else if (set.type === "fillPath") {
      paths.push({ data, role: solidFillRole, strokeWidth: 0 });
    }
  }
  return paths;
}

// 화살촉 계산에 필요한 최소 스트로크 스타일 — 끝점에만 solid 삼각 화살촉을 만든다.
const ARROW_END_ONLY = {
  dash: "solid",
  lineCap: "round",
  arrowStart: "none",
  arrowEnd: "arrow",
} as const;

/**
 * 도형 종류 + 지오메트리 + 스케치 옵션 + 시드 → Konva Path로 그릴 렌더 패스 목록.
 * generator 는 loadStudioRoughGenerator()가 만든 rough.js RoughGenerator(DI — 테스트에서는
 * 직접 생성 가능). 지오메트리가 부족하거나 비정상이면 빈 배열을 반환한다(렌더러는 깨끗한
 * 프리미티브로 폴백). 채우기 패스가 먼저, 외곽선 패스가 나중이라 그리는 순서 그대로 겹친다.
 */
export function buildStudioRoughShapeRenderPlan(
  generator: RoughGenerator,
  input: StudioRoughShapeInput
): StudioRoughRenderPath[] {
  const style = normalizeStudioSketchStyle(input.style);
  const seed = Number.isInteger(input.seed) && input.seed >= 1 ? input.seed : 1;
  const strokeWidth = clampTo(input.strokeWidth, 1, 400, 1);
  const fillWeight = Math.max(0.5, strokeWidth / 2);
  const fillable = input.kind !== "line" && input.kind !== "arrow";
  const wantsFill = input.hasFill && fillable;
  const baseOptions: RoughOptions = {
    roughness: style.roughness,
    bowing: style.bowing,
    seed,
    strokeWidth,
    fillWeight,
    hachureGap: Math.max(4, strokeWidth * 2.2),
    fillStyle: style.fillStyle,
    ...(wantsFill ? { fill: "#000" } : {}),
  };

  if (input.kind === "line" || input.kind === "arrow") {
    const pairs = flatToPairs(input.points);
    if (pairs.length < 2 || pairs.some((pair) => !pair.every(Number.isFinite))) return [];
    const paths = pathsFromSets(
      generator.linearPath(pairs, baseOptions).sets,
      strokeWidth,
      fillWeight,
      "fill"
    );
    if (input.kind === "arrow") {
      // 화살표 머리: 마지막 세그먼트 방향의 solid 삼각형을 선 색으로 채운다.
      for (const head of lineArrowHeadGeoms([...input.points], ARROW_END_ONLY, strokeWidth)) {
        if (head.kind !== "arrow") continue;
        paths.push(
          ...pathsFromSets(
            generator.polygon(flatToPairs(head.points), {
              ...baseOptions,
              fill: "#000",
              fillStyle: "solid",
            }).sets,
            strokeWidth,
            fillWeight,
            "outline-fill"
          )
        );
      }
    }
    return paths;
  }

  const box = boundsOf(input.points);
  if (!box) return [];

  if (input.kind === "rect") {
    return pathsFromSets(
      generator.rectangle(box.x, box.y, box.width, box.height, baseOptions).sets,
      strokeWidth,
      fillWeight,
      "fill"
    );
  }
  if (input.kind === "ellipse") {
    return pathsFromSets(
      generator.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        box.width,
        box.height,
        baseOptions
      ).sets,
      strokeWidth,
      fillWeight,
      "fill"
    );
  }

  // star/triangle/polygon — 깨끗한 렌더와 같은 정점 생성 함수를 공유해 실루엣이 일치한다.
  const vertices =
    input.kind === "star"
      ? starPathPoints(
          box.x + box.width / 2,
          box.y + box.height / 2,
          Math.max(0.1, Math.min(box.width, box.height) / 2),
          input.shapeParams
        )
      : polygonPathPointsInBounds(
          box.x,
          box.y,
          box.width,
          box.height,
          input.kind === "triangle" ? 3 : input.shapeParams.polygonSides
        );
  return pathsFromSets(
    generator.polygon(flatToPairs(vertices), baseOptions).sets,
    strokeWidth,
    fillWeight,
    "fill"
  );
}

// ---------------------------------------------------------------------------
// rough.js 로더 — 동적 import 뒤에만 라이브러리가 번들에 들어온다
// ---------------------------------------------------------------------------

let cachedRoughGenerator: RoughGenerator | null = null;
let pendingRoughGeneratorLoad: Promise<RoughGenerator> | null = null;

/** 이미 로드된 generator(없으면 null) — 렌더러가 동기 프레임에서 사용. */
export function peekStudioRoughGenerator(): RoughGenerator | null {
  return cachedRoughGenerator;
}

/**
 * rough.js generator를 동적 import로 로드해 캐시한다. Studio eager 청크에 rough.js가
 * 포함되지 않도록 하는 유일한 로드 경로. 실패하면 다음 호출이 재시도한다.
 */
export function loadStudioRoughGenerator(): Promise<RoughGenerator> {
  if (cachedRoughGenerator) return Promise.resolve(cachedRoughGenerator);
  pendingRoughGeneratorLoad ??= import("roughjs/bin/generator")
    .then((module) => {
      cachedRoughGenerator = new module.RoughGenerator();
      return cachedRoughGenerator;
    })
    .catch((error: unknown) => {
      pendingRoughGeneratorLoad = null;
      throw error;
    });
  return pendingRoughGeneratorLoad;
}
