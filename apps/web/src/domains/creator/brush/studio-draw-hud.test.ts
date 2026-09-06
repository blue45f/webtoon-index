import { describe, expect, it } from "vitest";

import {
  studioDrawHudToolLabel,
  studioPressureCurveHudLabel,
  studioPressureHudRatio,
  studioShapeFillHudLabel,
  studioShapeKindLabel,
  studioStabilizerHudLabel,
  studioSymmetryHudLabel,
} from "./studio-draw-hud";

describe("studio draw HUD labels", () => {
  it("formats pen / pixel / eraser / shape / select tool strings", () => {
    expect(
      studioDrawHudToolLabel({
        mode: "pen",
        brushName: "펜(매끈)",
        widthPx: 8,
        opacity01: 0.85,
      })
    ).toBe("펜(매끈) · 8px · 85%");
    expect(studioDrawHudToolLabel({ mode: "pixel" })).toBe(
      "픽셀 펜 · 1px · HARD · RAW"
    );
    expect(studioDrawHudToolLabel({ mode: "eraser", widthPx: 12 })).toBe("지우개 12px");
    expect(studioDrawHudToolLabel({
      mode: "eraser",
      brushName: "떡지우개(저농도)",
      widthPx: 26,
      opacity01: 0.38,
    })).toBe("떡지우개(저농도) · 26px · 38%");
    expect(studioDrawHudToolLabel({ mode: "shape", shapeLabel: "타원" })).toBe("도형 · 타원");
    expect(studioDrawHudToolLabel({ mode: "select", selectionLabel: null })).toBe("선택");
    expect(studioDrawHudToolLabel({ mode: "select", selectionLabel: "말풍선" })).toBe(
      "선택 · 말풍선"
    );
  });

  it("maps symmetry and stabilizer to status chips", () => {
    expect(studioSymmetryHudLabel("none")).toBeNull();
    expect(studioSymmetryHudLabel("vertical")).toBe("대칭 세로");
    expect(studioStabilizerHudLabel(6, "adaptive")).toContain("6");
    expect(studioStabilizerHudLabel(3.4, "standard")).toBe("보정 3.4 · 표준");
    expect(studioStabilizerHudLabel(4, "precision")).toContain("정밀");
  });

  it("clamps pressure for HUD meters", () => {
    expect(studioPressureHudRatio(null)).toBeNull();
    expect(studioPressureHudRatio(0.5)).toBe(0.5);
    expect(studioPressureHudRatio(2)).toBe(1);
    expect(studioPressureHudRatio(-1)).toBe(0);
  });

  it("localizes shape kinds and fill / pressure curve chips", () => {
    expect(studioShapeKindLabel("ellipse")).toBe("타원");
    expect(studioShapeKindLabel("polygon")).toBe("다각형");
    expect(studioShapeFillHudLabel(true, "rect")).toBe("채우기");
    expect(studioShapeFillHudLabel(true, "line")).toBeNull();
    expect(studioShapeFillHudLabel(false, "rect")).toBeNull();
    expect(studioPressureCurveHudLabel("soft")).toContain("민감");
    expect(studioPressureCurveHudLabel("firm")).toContain("단단");
    expect(studioPressureCurveHudLabel("linear")).toContain("기본");
  });
});
