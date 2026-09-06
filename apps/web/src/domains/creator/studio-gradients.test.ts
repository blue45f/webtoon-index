import { describe, expect, it } from "vitest";

import {
  GRADIENT_PRESETS,
  buildKonvaLinearGradient,
  gradientToBgGrad,
  isHexColor,
  type GradientDirection,
} from "./studio-gradients";

// 휘도(0.299r + 0.587g + 0.114b) — 두 색의 명암 차이 검증용.
const luminance = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const VALID_DIRECTIONS: GradientDirection[] = ["vertical", "horizontal"];

describe("isHexColor", () => {
  it("accepts #rgb and #rrggbb (대소문자 무관)", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
    expect(isHexColor("#1B2A52")).toBe(true);
  });

  it("rejects 잘못된 길이/문자/형식", () => {
    expect(isHexColor("abc")).toBe(false); // # 없음
    expect(isHexColor("#ab")).toBe(false); // 2자리
    expect(isHexColor("#abcd")).toBe(false); // 4자리
    expect(isHexColor("#abcde")).toBe(false); // 5자리
    expect(isHexColor("#abcg12")).toBe(false); // g
    expect(isHexColor("#1b2a52 ")).toBe(false); // 후행 공백
    expect(isHexColor("rgb(1,2,3)")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("GRADIENT_PRESETS", () => {
  it("프리셋 12~16개를 제공", () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(GRADIENT_PRESETS.length).toBeLessThanOrEqual(16);
  });

  it("모든 프리셋이 고유 id를 가짐", () => {
    const ids = GRADIENT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip이 비어있지 않음", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.id.trim().length).toBeGreaterThan(0);
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("stops가 2색이고 전부 소문자 #rrggbb", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.stops).toHaveLength(2);
      for (const color of preset.stops) {
        expect(isHexColor(color)).toBe(true);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("두 stop 색이 서로 다르고 휘도 차이가 충분", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.stops[0]).not.toBe(preset.stops[1]);
      const diff = Math.abs(luminance(preset.stops[0]) - luminance(preset.stops[1]));
      expect(diff).toBeGreaterThanOrEqual(30);
    }
  });

  it("direction이 유효한 값", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(VALID_DIRECTIONS).toContain(preset.direction);
    }
  });

  it("요구된 웹툰 무드 라벨을 모두 포함", () => {
    const labels = GRADIENT_PRESETS.map((preset) => preset.label);
    for (const label of [
      "새벽 하늘",
      "노을",
      "한낮 하늘",
      "밤하늘",
      "오로라",
      "벚꽃",
      "바다",
      "숲 그늘",
      "네온 시티",
      "모노 그레이",
      "로맨스 핑크",
      "공포 보라",
      "황금빛",
      "파스텔 무지개",
    ]) {
      expect(labels).toContain(label);
    }
  });
});

describe("gradientToBgGrad", () => {
  it("preset.stops를 [시작색, 끝색] 2색으로 반환", () => {
    const preset = GRADIENT_PRESETS[0]!;
    const grad = gradientToBgGrad(preset);
    expect(grad).toHaveLength(2);
    expect(grad).toEqual([preset.stops[0], preset.stops[1]]);
  });

  it("모든 프리셋에서 isHexColor를 통과하는 2색을 반환", () => {
    for (const preset of GRADIENT_PRESETS) {
      const grad = gradientToBgGrad(preset);
      expect(grad).toHaveLength(2);
      expect(isHexColor(grad[0])).toBe(true);
      expect(isHexColor(grad[1])).toBe(true);
    }
  });
});

describe("buildKonvaLinearGradient", () => {
  it("vertical: 위(0,0)→아래(0,h), colorStops [0,a,1,b]", () => {
    const cfg = buildKonvaLinearGradient(["#112233", "#445566"], 200, 120, "vertical");
    expect(cfg.fillLinearGradientStartPoint).toEqual({ x: 0, y: 0 });
    expect(cfg.fillLinearGradientEndPoint).toEqual({ x: 0, y: 120 });
    expect(cfg.fillLinearGradientColorStops).toEqual([0, "#112233", 1, "#445566"]);
  });

  it("horizontal: 좌(0,0)→우(w,0), colorStops [0,a,1,b]", () => {
    const cfg = buildKonvaLinearGradient(["#112233", "#445566"], 200, 120, "horizontal");
    expect(cfg.fillLinearGradientStartPoint).toEqual({ x: 0, y: 0 });
    expect(cfg.fillLinearGradientEndPoint).toEqual({ x: 200, y: 0 });
    expect(cfg.fillLinearGradientColorStops).toEqual([0, "#112233", 1, "#445566"]);
  });

  it("StudioPage 배경 규약과 동일 — vertical은 [0, a, 1, b] 순서", () => {
    const cfg = buildKonvaLinearGradient(["#aaaaaa", "#000000"], 50, 80, "vertical");
    expect(cfg.fillLinearGradientColorStops[0]).toBe(0);
    expect(cfg.fillLinearGradientColorStops[1]).toBe("#aaaaaa");
    expect(cfg.fillLinearGradientColorStops[2]).toBe(1);
    expect(cfg.fillLinearGradientColorStops[3]).toBe("#000000");
  });

  it("모든 프리셋을 빌드 가능하고 끝점이 방향에 맞음", () => {
    for (const preset of GRADIENT_PRESETS) {
      const cfg = buildKonvaLinearGradient(gradientToBgGrad(preset), 300, 400, preset.direction);
      if (preset.direction === "vertical") {
        expect(cfg.fillLinearGradientEndPoint).toEqual({ x: 0, y: 400 });
      } else {
        expect(cfg.fillLinearGradientEndPoint).toEqual({ x: 300, y: 0 });
      }
      expect(cfg.fillLinearGradientColorStops).toEqual([0, preset.stops[0], 1, preset.stops[1]]);
    }
  });
});
