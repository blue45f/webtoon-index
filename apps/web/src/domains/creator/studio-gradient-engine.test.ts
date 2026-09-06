import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRADIENT_SPEC,
  GRADIENT_ANGLE_RANGE,
  GRADIENT_ENGINE_PRESETS,
  GRADIENT_STOPS_MAX,
  GRADIENT_STOPS_MIN,
  GRADIENT_TYPES,
  addGradientStop,
  applyCanvasGradient,
  canvasGradientParams,
  estimateTextGradientBBox,
  flattenColorStops,
  gradientSpecsEqual,
  gradientToCss,
  isGradientSpec,
  konvaGradientProps,
  legacyTextGradientToSpec,
  linearGradientPoints,
  mixHexColors,
  normalizeGradientSpec,
  normalizeHexColor,
  radialGradientGeometry,
  removeGradientStop,
  setGradientAngle,
  setGradientType,
  updateGradientStop,
  wrapAngleDeg,
  type GradientBBox,
  type StudioGradientSpec,
} from "./studio-gradient-engine";
import { isHexColor } from "./studio-gradients";

// 좌상단 원점 노드(Rect/Text) 규약의 100×50 로컬 bbox.
const BOX: GradientBBox = { x: 0, y: 0, width: 100, height: 50 };
// 중심 원점 노드(Ellipse/Star) 규약의 100×50 로컬 bbox.
const CENTERED_BOX: GradientBBox = { x: -50, y: -25, width: 100, height: 50 };

const spec = (over: Partial<StudioGradientSpec> = {}): StudioGradientSpec => ({
  type: "linear",
  angleDeg: 180,
  stops: [
    { offset: 0, color: "#112233" },
    { offset: 1, color: "#aabbcc" },
  ],
  ...over,
});

describe("GRADIENT_ENGINE_PRESETS", () => {
  it("정확히 12종을 제공하고 id가 전부 고유", () => {
    expect(GRADIENT_ENGINE_PRESETS).toHaveLength(12);
    const ids = GRADIENT_ENGINE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 프리셋 스펙이 유효(스톱 2~5, offset 0..1 오름차순, 소문자 헥스)", () => {
    for (const preset of GRADIENT_ENGINE_PRESETS) {
      expect(isGradientSpec(preset.spec)).toBe(true);
      expect(preset.spec.stops.length).toBeGreaterThanOrEqual(GRADIENT_STOPS_MIN);
      expect(preset.spec.stops.length).toBeLessThanOrEqual(GRADIENT_STOPS_MAX);
      for (let i = 0; i < preset.spec.stops.length; i += 1) {
        const stop = preset.spec.stops[i];
        expect(stop.offset).toBeGreaterThanOrEqual(0);
        expect(stop.offset).toBeLessThanOrEqual(1);
        expect(isHexColor(stop.color)).toBe(true);
        expect(stop.color).toBe(stop.color.toLowerCase());
        if (i > 0) expect(stop.offset).toBeGreaterThan(preset.spec.stops[i - 1].offset);
      }
      // 정규화가 프리셋을 바꾸지 않아야(이미 정규형) 활성 표시가 안정적이다.
      expect(normalizeGradientSpec(preset.spec)).toEqual(preset.spec);
    }
  });

  it("선형(임의 각도)과 방사가 섞여 있고 한글 라벨·팁을 가짐", () => {
    const linear = GRADIENT_ENGINE_PRESETS.filter((p) => p.spec.type === "linear");
    const radial = GRADIENT_ENGINE_PRESETS.filter((p) => p.spec.type === "radial");
    expect(linear.length).toBeGreaterThanOrEqual(4);
    expect(radial.length).toBeGreaterThanOrEqual(3);
    // 수직/수평(0/90/180/270) 외의 대각선 각도도 최소 1개 이상.
    expect(linear.some((p) => p.spec.angleDeg % 90 !== 0)).toBe(true);
    // 3색 이상 멀티스톱도 최소 절반 이상.
    expect(GRADIENT_ENGINE_PRESETS.filter((p) => p.spec.stops.length >= 3).length).toBeGreaterThanOrEqual(6);
    for (const p of GRADIENT_ENGINE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(p.label)).toBe(true);
      expect(/[가-힣]/.test(p.tip)).toBe(true);
    }
  });
});

describe("normalizeHexColor / mixHexColors / wrapAngleDeg", () => {
  it("#RGB 대문자를 소문자 #rrggbb로 확장하고 무효값은 폴백", () => {
    expect(normalizeHexColor("#A1B2C3", "#000000")).toBe("#a1b2c3");
    expect(normalizeHexColor("#AbC", "#000000")).toBe("#aabbcc");
    expect(normalizeHexColor("red", "#123456")).toBe("#123456");
    expect(normalizeHexColor(undefined, "#123456")).toBe("#123456");
  });

  it("중간색 보간 — 검정/흰색의 절반은 #808080, t는 0..1로 클램프", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHexColors("#000000", "#ffffff", -1)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixHexColors("#ff0000", "#00ff00", 0)).toBe("#ff0000");
  });

  it("각도 감싸기 — 음수/초과/무한 처리", () => {
    expect(wrapAngleDeg(-90)).toBe(270);
    expect(wrapAngleDeg(450)).toBe(90);
    expect(wrapAngleDeg(360)).toBe(0);
    expect(wrapAngleDeg(Number.NaN)).toBe(DEFAULT_GRADIENT_SPEC.angleDeg);
  });
});

describe("isGradientSpec / normalizeGradientSpec", () => {
  it("유효 스펙을 통과시키고 쓰레기 값을 거른다", () => {
    expect(isGradientSpec(spec())).toBe(true);
    expect(isGradientSpec(DEFAULT_GRADIENT_SPEC)).toBe(true);
    expect(isGradientSpec(null)).toBe(false);
    expect(isGradientSpec({})).toBe(false);
    expect(isGradientSpec({ type: "conic", angleDeg: 0, stops: [] })).toBe(false);
    expect(isGradientSpec({ type: "linear", angleDeg: Number.NaN, stops: [{ offset: 0, color: "#fff" }] })).toBe(false);
    expect(isGradientSpec({ type: "linear", angleDeg: 0, stops: [{ offset: "0", color: "#fff" }] })).toBe(false);
  });

  it("쓰레기 입력은 기본 스펙으로 폴백", () => {
    expect(normalizeGradientSpec(undefined)).toEqual(DEFAULT_GRADIENT_SPEC);
    expect(normalizeGradientSpec("junk")).toEqual(DEFAULT_GRADIENT_SPEC);
    expect(normalizeGradientSpec({ type: "conic" })).toEqual(DEFAULT_GRADIENT_SPEC);
  });

  it("스톱을 정렬·클램프·최대 5개로 자르고 무효 스톱은 버린다", () => {
    const out = normalizeGradientSpec({
      type: "radial",
      angleDeg: -45,
      stops: [
        { offset: 1.5, color: "#FFFFFF" },
        { offset: -0.5, color: "#000" },
        { offset: 0.5, color: "not-a-color" }, // 버림
        { offset: 0.25, color: "#ff0000" },
      ],
    });
    expect(out.type).toBe("radial");
    expect(out.angleDeg).toBe(315);
    expect(out.stops).toEqual([
      { offset: 0, color: "#000000" },
      { offset: 0.25, color: "#ff0000" },
      { offset: 1, color: "#ffffff" },
    ]);
  });

  it("유효 스톱이 2개 미만이면 기본 스톱으로 대체하고 입력을 변이하지 않는다", () => {
    const input = { type: "linear", angleDeg: 90, stops: [{ offset: 0.3, color: "#abc" }] };
    const frozen = JSON.stringify(input);
    const out = normalizeGradientSpec(input);
    expect(out.stops).toEqual(DEFAULT_GRADIENT_SPEC.stops);
    expect(out.stops).not.toBe(DEFAULT_GRADIENT_SPEC.stops); // 방어적 복사
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("6개 초과 스톱은 5개까지만 채택", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ offset: i / 6, color: "#112233" }));
    expect(normalizeGradientSpec(spec({ stops: many })).stops).toHaveLength(GRADIENT_STOPS_MAX);
  });
});

describe("linearGradientPoints — CSS 각도 규약", () => {
  it("180°(세로, 위→아래): 상단 중앙 → 하단 중앙", () => {
    const { start, end } = linearGradientPoints({ angleDeg: 180 }, BOX);
    expect(start).toEqual({ x: 50, y: 0 });
    expect(end).toEqual({ x: 50, y: 50 });
  });

  it("90°(가로, 좌→우): 좌측 중앙 → 우측 중앙", () => {
    const { start, end } = linearGradientPoints({ angleDeg: 90 }, BOX);
    expect(start).toEqual({ x: 0, y: 25 });
    expect(end).toEqual({ x: 100, y: 25 });
  });

  it("0°(아래→위)와 270°(우→좌)는 반대 방향", () => {
    const up = linearGradientPoints({ angleDeg: 0 }, BOX);
    expect(up.start).toEqual({ x: 50, y: 50 });
    expect(up.end).toEqual({ x: 50, y: 0 });
    const left = linearGradientPoints({ angleDeg: 270 }, BOX);
    expect(left.start).toEqual({ x: 100, y: 25 });
    expect(left.end).toEqual({ x: 0, y: 25 });
  });

  it("정사각 bbox의 45°는 좌하단→우상단 꼭짓점을 정확히 잇는다(CSS와 동일)", () => {
    const square: GradientBBox = { x: 0, y: 0, width: 100, height: 100 };
    const { start, end } = linearGradientPoints({ angleDeg: 45 }, square);
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(100, 6);
    expect(end.x).toBeCloseTo(100, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it("중심 원점 bbox(Ellipse/Star 로컬 좌표)도 축이 중심을 지난다", () => {
    const { start, end } = linearGradientPoints({ angleDeg: 180 }, CENTERED_BOX);
    expect(start).toEqual({ x: 0, y: -25 });
    expect(end).toEqual({ x: 0, y: 25 });
  });

  it("각도를 [0,360)으로 감싼 뒤 계산한다(-90° == 270°)", () => {
    expect(linearGradientPoints({ angleDeg: -90 }, BOX)).toEqual(linearGradientPoints({ angleDeg: 270 }, BOX));
  });
});

describe("radialGradientGeometry", () => {
  it("중심은 bbox 중앙, 끝 반지름은 최원거리 꼭짓점(farthest-corner)", () => {
    const geo = radialGradientGeometry(BOX);
    expect(geo.center).toEqual({ x: 50, y: 25 });
    expect(geo.startRadius).toBe(0);
    expect(geo.endRadius).toBeCloseTo(Math.hypot(50, 25), 6);
  });

  it("중심 원점 bbox의 중심은 (0,0)", () => {
    expect(radialGradientGeometry(CENTERED_BOX).center).toEqual({ x: 0, y: 0 });
  });
});

describe("konvaGradientProps", () => {
  it("선형: fillPriority + 시작/끝 점 + 평탄 colorStops", () => {
    const props = konvaGradientProps(spec(), BOX);
    expect(props.fillPriority).toBe("linear-gradient");
    expect(props.fillLinearGradientStartPoint).toEqual({ x: 50, y: 0 });
    expect(props.fillLinearGradientEndPoint).toEqual({ x: 50, y: 50 });
    expect(props.fillLinearGradientColorStops).toEqual([0, "#112233", 1, "#aabbcc"]);
    expect(props.fillRadialGradientColorStops).toBeUndefined();
  });

  it("방사: 시작=끝=중심, 반지름 0→farthest-corner", () => {
    const props = konvaGradientProps(spec({ type: "radial" }), BOX);
    expect(props.fillPriority).toBe("radial-gradient");
    expect(props.fillRadialGradientStartPoint).toEqual({ x: 50, y: 25 });
    expect(props.fillRadialGradientEndPoint).toEqual({ x: 50, y: 25 });
    expect(props.fillRadialGradientStartRadius).toBe(0);
    expect(props.fillRadialGradientEndRadius).toBeCloseTo(Math.hypot(50, 25), 6);
    expect(props.fillRadialGradientColorStops).toEqual([0, "#112233", 1, "#aabbcc"]);
    expect(props.fillLinearGradientColorStops).toBeUndefined();
  });

  it("null/undefined면 빈 객체(스프레드 no-op)", () => {
    expect(konvaGradientProps(null, BOX)).toEqual({});
    expect(konvaGradientProps(undefined, BOX)).toEqual({});
  });

  it("flattenColorStops는 [offset, color] 반복 배열", () => {
    expect(
      flattenColorStops([
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#ff0000" },
        { offset: 1, color: "#ffffff" },
      ])
    ).toEqual([0, "#000000", 0.5, "#ff0000", 1, "#ffffff"]);
  });
});

describe("canvasGradientParams / applyCanvasGradient", () => {
  it("선형 파라미터가 Konva 기하와 일치", () => {
    const params = canvasGradientParams(spec({ angleDeg: 90 }), BOX);
    expect(params).toEqual({
      type: "linear",
      x0: 0,
      y0: 25,
      x1: 100,
      y1: 25,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#aabbcc" },
      ],
    });
  });

  it("방사 파라미터 — createRadialGradient(x0,y0,0,x1,y1,r1) 인자", () => {
    const params = canvasGradientParams(spec({ type: "radial" }), CENTERED_BOX);
    expect(params.type).toBe("radial");
    if (params.type !== "radial") return;
    expect(params.x0).toBe(0);
    expect(params.y0).toBe(0);
    expect(params.r0).toBe(0);
    expect(params.r1).toBeCloseTo(Math.hypot(50, 25), 6);
  });

  it("applyCanvasGradient가 스텁 ctx에 올바른 호출·스톱을 남긴다", () => {
    const calls: unknown[][] = [];
    const stops: Array<[number, string]> = [];
    const gradient = { addColorStop: (o: number, c: string) => stops.push([o, c]) };
    const ctx = {
      createLinearGradient: (...args: number[]) => {
        calls.push(["linear", ...args]);
        return gradient;
      },
      createRadialGradient: (...args: number[]) => {
        calls.push(["radial", ...args]);
        return gradient;
      },
    };

    const out = applyCanvasGradient(ctx, spec({ angleDeg: 180 }), BOX);
    expect(out).toBe(gradient);
    expect(calls).toEqual([["linear", 50, 0, 50, 50]]);
    expect(stops).toEqual([
      [0, "#112233"],
      [1, "#aabbcc"],
    ]);

    calls.length = 0;
    stops.length = 0;
    applyCanvasGradient(ctx, spec({ type: "radial" }), BOX);
    expect(calls).toEqual([["radial", 50, 25, 0, 50, 25, Math.hypot(50, 25)]]);
    expect(stops).toHaveLength(2);
  });
});

describe("gradientToCss", () => {
  it("선형 — 각도 + 퍼센트 스톱", () => {
    expect(gradientToCss(spec({ angleDeg: 135 }))).toBe("linear-gradient(135deg, #112233 0%, #aabbcc 100%)");
  });

  it("방사 — circle(farthest-corner)로 캔버스 기하와 일치", () => {
    expect(
      gradientToCss(
        spec({
          type: "radial",
          stops: [
            { offset: 0, color: "#ffffff" },
            { offset: 0.333, color: "#ff0000" },
            { offset: 1, color: "#000000" },
          ],
        })
      )
    ).toBe("radial-gradient(circle, #ffffff 0%, #ff0000 33.3%, #000000 100%)");
  });

  it("무효 입력도 기본 스펙 CSS로 안전하게 떨어진다", () => {
    expect(gradientToCss({} as StudioGradientSpec)).toBe("linear-gradient(180deg, #ff3b30 0%, #ffcc00 100%)");
  });
});

describe("스톱 편집 헬퍼", () => {
  it("addGradientStop — 가장 넓은 구간 중앙에 중간색을 삽입", () => {
    const out = addGradientStop(
      spec({
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 0.2, color: "#222222" },
          { offset: 1, color: "#ffffff" },
        ],
      })
    );
    expect(out.stops).toHaveLength(4);
    expect(out.stops[2]).toEqual({ offset: 0.6, color: mixHexColors("#222222", "#ffffff", 0.5) });
  });

  it("addGradientStop — 최대 5개면 입력 참조 그대로(no-op)", () => {
    const full = spec({
      stops: [0, 0.25, 0.5, 0.75, 1].map((offset) => ({ offset, color: "#112233" })),
    });
    expect(addGradientStop(full)).toBe(full);
  });

  it("removeGradientStop — 중간 스톱 제거, 최소 2개에선 no-op, 범위 밖 인덱스 no-op", () => {
    const three = spec({
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#808080" },
        { offset: 1, color: "#ffffff" },
      ],
    });
    expect(removeGradientStop(three, 1).stops.map((s) => s.offset)).toEqual([0, 1]);
    const two = spec();
    expect(removeGradientStop(two, 0)).toBe(two);
    expect(removeGradientStop(three, 9)).toBe(three);
  });

  it("updateGradientStop — offset을 이웃 사이로 클램프해 순서를 보존", () => {
    const three = spec({
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#808080" },
        { offset: 1, color: "#ffffff" },
      ],
    });
    // 가운데 스톱을 1.0으로 끌어도 끝 스톱(1)을 넘지 못한다 → 정렬 유지, 인덱스 불변.
    expect(updateGradientStop(three, 1, { offset: 2 }).stops[1].offset).toBe(1);
    expect(updateGradientStop(three, 1, { offset: -1 }).stops[1].offset).toBe(0);
    expect(updateGradientStop(three, 1, { color: "#F00" }).stops[1].color).toBe("#ff0000");
    // 무효 색은 기존 색 유지, 범위 밖 인덱스는 입력 그대로.
    expect(updateGradientStop(three, 1, { color: "oops" }).stops[1].color).toBe("#808080");
    expect(updateGradientStop(three, 5, { offset: 0.1 })).toBe(three);
  });

  it("setGradientType / setGradientAngle — 나머지 필드 보존 + 무변이", () => {
    const s = spec();
    const radial = setGradientType(s, "radial");
    expect(radial.type).toBe("radial");
    expect(radial.stops).toEqual(s.stops);
    expect(s.type).toBe("linear");
    expect(setGradientAngle(s, 405).angleDeg).toBe(45);
  });
});

describe("gradientSpecsEqual", () => {
  it("정규화 후 동등 비교 — radial은 각도 무시", () => {
    expect(gradientSpecsEqual(spec(), spec())).toBe(true);
    expect(gradientSpecsEqual(spec(), spec({ angleDeg: 90 }))).toBe(false);
    expect(gradientSpecsEqual(spec({ type: "radial", angleDeg: 0 }), spec({ type: "radial", angleDeg: 90 }))).toBe(true);
    expect(gradientSpecsEqual(spec(), null)).toBe(false);
    expect(gradientSpecsEqual(null, null)).toBe(true);
  });

  it("프리셋 활성 판별에 쓸 수 있다(자기 자신과 동일)", () => {
    for (const preset of GRADIENT_ENGINE_PRESETS) {
      expect(gradientSpecsEqual(preset.spec, normalizeGradientSpec(preset.spec))).toBe(true);
    }
  });
});

describe("StudioPage 통합 헬퍼", () => {
  it("legacyTextGradientToSpec — 기존 기본색/방향 폴백과 동일", () => {
    expect(legacyTextGradientToSpec(undefined, undefined, undefined)).toEqual({
      type: "linear",
      angleDeg: 180,
      stops: [
        { offset: 0, color: "#ff3b30" },
        { offset: 1, color: "#ffcc00" },
      ],
    });
    const horizontal = legacyTextGradientToSpec("#111111", "#222222", "horizontal");
    expect(horizontal.angleDeg).toBe(90);
    expect(horizontal.stops[0].color).toBe("#111111");
  });

  it("estimateTextGradientBBox — 한 줄은 fontSize×1.3, 여러 줄은 줄수×행간", () => {
    expect(estimateTextGradientBBox({ width: 200, text: "야호", fontSize: 40, lineHeight: 1 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 52, // 40 × 1.3 (기존 한 줄 규약 유지)
    });
    const multi = estimateTextGradientBBox({ width: 200, text: "가\n나\n다", fontSize: 40, lineHeight: 1.2 });
    expect(multi.height).toBe(144); // 3줄 × 40 × 1.2 > 52
    // 0 크기 방어 — 최소 1.
    expect(estimateTextGradientBBox({ width: 0, text: "", fontSize: 0 }).width).toBe(1);
    expect(estimateTextGradientBBox({ width: 0, text: "", fontSize: 0 }).height).toBe(1);
  });
});

describe("상수·기본값", () => {
  it("종류 목록·각도 범위·기본 스펙이 패널 계약을 만족", () => {
    expect(GRADIENT_TYPES.map((t) => t.id)).toEqual(["linear", "radial"]);
    expect(GRADIENT_ANGLE_RANGE).toEqual({ min: 0, max: 360, step: 1 });
    expect(isGradientSpec(DEFAULT_GRADIENT_SPEC)).toBe(true);
    expect(normalizeGradientSpec(DEFAULT_GRADIENT_SPEC)).toEqual(DEFAULT_GRADIENT_SPEC);
  });
});
