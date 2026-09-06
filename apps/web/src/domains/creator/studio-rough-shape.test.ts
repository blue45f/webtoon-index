import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_SHAPE_PARAMS } from "./brush/studio-stroke-shapes";
import {
  buildStudioRoughShapeRenderPlan,
  DEFAULT_STUDIO_SKETCH_STYLE,
  isDefaultStudioSketchStyle,
  loadStudioRoughGenerator,
  normalizeStudioSketchStyle,
  peekStudioRoughGenerator,
  STUDIO_SKETCH_FILL_STYLES,
  STUDIO_SKETCH_RANGES,
  studioRoughOpsToPathData,
  studioRoughSeedFromElementId,
  studioSketchStyleOfElement,
  type StudioRoughGeneratorHandle,
  type StudioRoughShapeInput,
  type StudioSketchStyle,
} from "./studio-rough-shape";

import type { Op as RoughOp } from "roughjs/bin/core";

// 로더 상태는 모듈 전역이므로, 로드 전 peek 검증이 항상 첫 테스트로 실행돼야 한다.
describe("loadStudioRoughGenerator / peekStudioRoughGenerator", () => {
  it("로드 전에는 null, 로드 후에는 같은 인스턴스를 캐시한다", async () => {
    expect(peekStudioRoughGenerator()).toBeNull();
    const generator = await loadStudioRoughGenerator();
    expect(generator).toBeTruthy();
    expect(peekStudioRoughGenerator()).toBe(generator);
    await expect(loadStudioRoughGenerator()).resolves.toBe(generator);
  });
});

describe("normalizeStudioSketchStyle / studioSketchStyleOfElement", () => {
  it("미설정(undefined)은 기본값 복사본을 반환한다", () => {
    const normalized = normalizeStudioSketchStyle(undefined);
    expect(normalized).toEqual(DEFAULT_STUDIO_SKETCH_STYLE);
    expect(normalized).not.toBe(DEFAULT_STUDIO_SKETCH_STYLE);
  });

  it("유효한 값은 그대로 통과한다", () => {
    const style: StudioSketchStyle = { enabled: true, roughness: 2.4, bowing: 3, fillStyle: "zigzag" };
    expect(normalizeStudioSketchStyle(style)).toEqual(style);
  });

  it("범위 밖 값은 클램프하고 이상값은 필드별 기본값으로 되돌린다", () => {
    const normalized = normalizeStudioSketchStyle({
      enabled: "yes",
      roughness: 99,
      bowing: -5,
      fillStyle: "plaid",
    });
    expect(normalized.enabled).toBe(false);
    expect(normalized.roughness).toBe(STUDIO_SKETCH_RANGES.roughness.max);
    expect(normalized.bowing).toBe(STUDIO_SKETCH_RANGES.bowing.min);
    expect(normalized.fillStyle).toBe(DEFAULT_STUDIO_SKETCH_STYLE.fillStyle);
  });

  it("isDefaultStudioSketchStyle은 기본값에서만 true", () => {
    expect(isDefaultStudioSketchStyle({ ...DEFAULT_STUDIO_SKETCH_STYLE })).toBe(true);
    expect(isDefaultStudioSketchStyle({ ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true })).toBe(false);
    expect(isDefaultStudioSketchStyle({ ...DEFAULT_STUDIO_SKETCH_STYLE, roughness: 2 })).toBe(false);
  });

  it("요소에서 sketch 객체가 없으면 null, 있으면 정규화해 읽는다", () => {
    expect(studioSketchStyleOfElement(null)).toBeNull();
    expect(studioSketchStyleOfElement({ id: "a", type: "draw" })).toBeNull();
    expect(studioSketchStyleOfElement({ sketch: "on" })).toBeNull();
    expect(
      studioSketchStyleOfElement({ sketch: { enabled: true, roughness: 0.1 } })
    ).toEqual({
      ...DEFAULT_STUDIO_SKETCH_STYLE,
      enabled: true,
      roughness: STUDIO_SKETCH_RANGES.roughness.min,
    });
  });

  it("패널 선택지는 한글 라벨과 유일한 id를 가진 4종이다", () => {
    expect(STUDIO_SKETCH_FILL_STYLES).toHaveLength(4);
    expect(new Set(STUDIO_SKETCH_FILL_STYLES.map((item) => item.id)).size).toBe(4);
    for (const item of STUDIO_SKETCH_FILL_STYLES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tip.length).toBeGreaterThan(0);
    }
  });
});

describe("studioRoughSeedFromElementId", () => {
  it("같은 id는 같은 시드, 다른 id는 다른 시드를 만든다", () => {
    expect(studioRoughSeedFromElementId("el-1")).toBe(studioRoughSeedFromElementId("el-1"));
    expect(studioRoughSeedFromElementId("el-1")).not.toBe(studioRoughSeedFromElementId("el-2"));
  });

  it("시드는 항상 1 이상의 정수다(rough.js는 0을 무작위로 취급)", () => {
    for (const id of ["a", "el-9", "협업-복제본", ""]) {
      const seed = studioRoughSeedFromElementId(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1);
    }
    expect(studioRoughSeedFromElementId(undefined)).toBe(1);
    expect(studioRoughSeedFromElementId(42)).toBe(1);
  });
});

describe("studioRoughOpsToPathData", () => {
  it("move/lineTo/bcurveTo를 M/L/C로 매핑하고 소수 둘째 자리로 반올림한다", () => {
    const ops: RoughOp[] = [
      { op: "move", data: [1.234, 5.678] },
      { op: "lineTo", data: [10.005, 20] },
      { op: "bcurveTo", data: [1.111, 2.222, 3.333, 4.444, 5.555, 6.666] },
    ];
    expect(studioRoughOpsToPathData(ops)).toBe(
      "M1.23 5.68 L10.01 20 C1.11 2.22, 3.33 4.44, 5.56 6.67"
    );
  });

  it("비유한 좌표를 가진 op는 건너뛴다", () => {
    const ops: RoughOp[] = [
      { op: "move", data: [0, 0] },
      { op: "lineTo", data: [Number.NaN, 4] },
      { op: "lineTo", data: [8, 9] },
    ];
    expect(studioRoughOpsToPathData(ops)).toBe("M0 0 L8 9");
  });

  it("빈 목록은 빈 문자열이다", () => {
    expect(studioRoughOpsToPathData([])).toBe("");
  });
});

describe("buildStudioRoughShapeRenderPlan", () => {
  let generator: StudioRoughGeneratorHandle;

  beforeAll(async () => {
    generator = await loadStudioRoughGenerator();
  });

  function input(overrides: Partial<StudioRoughShapeInput> = {}): StudioRoughShapeInput {
    return {
      kind: "rect",
      points: [10, 10, 210, 130],
      strokeWidth: 4,
      hasFill: false,
      shapeParams: { ...DEFAULT_SHAPE_PARAMS },
      style: { ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true },
      seed: studioRoughSeedFromElementId("el-deterministic"),
      ...overrides,
    };
  }

  it("같은 입력은 항상 동일한 패스 문자열을 만든다(결정성)", () => {
    const first = buildStudioRoughShapeRenderPlan(generator, input());
    const second = buildStudioRoughShapeRenderPlan(generator, input());
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("다른 시드는 다른 패스를 만든다", () => {
    const first = buildStudioRoughShapeRenderPlan(generator, input({ seed: 7 }));
    const second = buildStudioRoughShapeRenderPlan(generator, input({ seed: 8 }));
    expect(first.map((path) => path.data)).not.toEqual(second.map((path) => path.data));
  });

  it("모든 도형 종류가 외곽선 패스를 만든다", () => {
    const kinds = ["line", "rect", "ellipse", "star", "arrow", "triangle", "polygon"] as const;
    for (const kind of kinds) {
      const plan = buildStudioRoughShapeRenderPlan(generator, input({ kind }));
      expect(plan.length, kind).toBeGreaterThan(0);
      expect(plan.some((path) => path.role === "outline"), kind).toBe(true);
      for (const path of plan) {
        expect(path.data.startsWith("M"), kind).toBe(true);
      }
    }
  });

  it("채우기가 있으면 빗금(fill-hatch)이 외곽선보다 먼저 온다", () => {
    const plan = buildStudioRoughShapeRenderPlan(generator, input({ hasFill: true }));
    const hatchIndex = plan.findIndex((path) => path.role === "fill-hatch");
    const outlineIndex = plan.findIndex((path) => path.role === "outline");
    expect(hatchIndex).toBeGreaterThanOrEqual(0);
    expect(outlineIndex).toBeGreaterThan(hatchIndex);
    // 빗금 굵기는 선 굵기의 절반(최소 0.5px).
    expect(plan[hatchIndex]!.strokeWidth).toBe(2);
  });

  it("단색(solid) 채우기는 fill 역할의 채움 패스를 만든다", () => {
    const plan = buildStudioRoughShapeRenderPlan(
      generator,
      input({
        hasFill: true,
        style: { ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true, fillStyle: "solid" },
      })
    );
    const fill = plan.find((path) => path.role === "fill");
    expect(fill).toBeTruthy();
    expect(fill!.strokeWidth).toBe(0);
  });

  it("선·화살표는 hasFill이어도 채우기 패스를 만들지 않는다", () => {
    for (const kind of ["line", "arrow"] as const) {
      const plan = buildStudioRoughShapeRenderPlan(generator, input({ kind, hasFill: true }));
      expect(plan.some((path) => path.role === "fill" || path.role === "fill-hatch")).toBe(false);
    }
  });

  it("화살표는 선 색으로 채우는 solid 머리(outline-fill)를 포함한다", () => {
    const plan = buildStudioRoughShapeRenderPlan(generator, input({ kind: "arrow" }));
    expect(plan.some((path) => path.role === "outline-fill")).toBe(true);
  });

  it("지오메트리가 부족하거나 비정상이면 빈 배열이다(깨끗한 렌더 폴백)", () => {
    expect(buildStudioRoughShapeRenderPlan(generator, input({ points: [10, 10] }))).toEqual([]);
    expect(
      buildStudioRoughShapeRenderPlan(generator, input({ points: [Number.NaN, 0, 10, 10] }))
    ).toEqual([]);
    expect(buildStudioRoughShapeRenderPlan(generator, input({ points: [] }))).toEqual([]);
  });

  it("스타일 이상값은 계획 생성 전에 정규화된다", () => {
    const plan = buildStudioRoughShapeRenderPlan(
      generator,
      input({
        style: { enabled: true, roughness: 999, bowing: -1, fillStyle: "nope" } as unknown as StudioSketchStyle,
        seed: 0.5,
      })
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((path) => path.data.length > 0)).toBe(true);
  });
});
