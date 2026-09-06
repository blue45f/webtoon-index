import { describe, expect, it } from "vitest";

import { STUDIO_BRUSH_MATERIAL_GROUPS } from "./studio-brush-material-group";
import {
  studioBrushChipSurface,
  studioBrushPreviewDashArray,
  studioBrushPreviewDotCenters,
  studioBrushPreviewOpacity,
  studioBrushPreviewPathD,
  studioBrushPreviewRibbonD,
  studioBrushPreviewStrokeWidth,
} from "./studio-brush-visual";

describe("studio brush commercial visuals", () => {
  it("shows the exact catalogue outer opacity instead of an opaque decorative preview", () => {
    expect(studioBrushPreviewOpacity(0.2)).toBe(0.2);
    expect(studioBrushPreviewOpacity(0.55)).toBe(0.55);
    expect(studioBrushPreviewOpacity(1)).toBe(1);
    expect(studioBrushPreviewOpacity(-2)).toBe(0);
    expect(studioBrushPreviewOpacity(4)).toBe(1);
    expect(studioBrushPreviewOpacity(Number.NaN)).toBe(1);
  });

  it("returns a distinct warm-ink chip surface for every material group", () => {
    const inks = new Set<string>();
    for (const media of STUDIO_BRUSH_MATERIAL_GROUPS) {
      const surface = studioBrushChipSurface(media);
      expect(surface.tile, media).toMatch(/^oklch\(/);
      expect(surface.ink, media).toMatch(/^oklch\(/);
      expect(surface.paper, media).toMatch(/^oklch\(/);
      inks.add(surface.ink);
    }
    // 재질이 곧 색 단서다. 두 재질이 같은 잉크 색을 쓰면 타일만 보고 구분할 수 없다.
    expect(inks.size).toBe(STUDIO_BRUSH_MATERIAL_GROUPS.length);
    // Marker family leans toward accent hue (persimmon-ish)
    expect(studioBrushChipSurface("marker").ink).toContain("42");
  });

  it("builds deterministic stroke paths and widths for SVG chips", () => {
    const solid = studioBrushPreviewPathD("solid");
    const wavy = studioBrushPreviewPathD("wavy");
    expect(solid.startsWith("M2")).toBe(true);
    expect(wavy).not.toBe(solid);
    expect(studioBrushPreviewStrokeWidth(0.5, "solid")).toBeGreaterThan(1);
    expect(studioBrushPreviewStrokeWidth(0.5, "calligraphy")).toBeGreaterThan(
      studioBrushPreviewStrokeWidth(0.5, "solid")
    );
    expect(studioBrushPreviewDashArray("dashed")).toBeTruthy();
    expect(studioBrushPreviewDashArray("solid")).toBeUndefined();
  });

  it("emits tone/spray dots for texture previews", () => {
    const spray = studioBrushPreviewDotCenters("dots");
    const tone = studioBrushPreviewDotCenters("tone");
    expect(spray.length).toBeGreaterThan(3);
    expect(tone.length).toBeGreaterThan(spray.length);
    expect(studioBrushPreviewDotCenters("solid")).toHaveLength(0);
  });

  it("builds a closed pressure-taper ribbon that swells mid-stroke and thins at both ends", () => {
    const ribbon = studioBrushPreviewRibbonD("solid", 36, 16, 0.9);
    expect(ribbon).toBeTruthy();
    expect(ribbon!.startsWith("M")).toBe(true);
    expect(ribbon!.endsWith("Z")).toBe(true);
    // 좌표를 되읽어 리본 반폭(상·하 경계 거리)의 형태를 검증한다: 양 끝이 가늘고 중간이 최대.
    const coords = ribbon!
      .replace(/[MLZ]/g, " ")
      .trim()
      .split(/\s+/)
      .map(Number);
    const pointCount = coords.length / 2;
    const half = pointCount / 2;
    const widthAt = (index: number) => {
      const ux = coords[index * 2]!;
      const uy = coords[index * 2 + 1]!;
      // lower 배열은 역순 — 같은 t 의 짝은 반대편 끝에서 센다.
      const lx = coords[(pointCount - 1 - index) * 2]!;
      const ly = coords[(pointCount - 1 - index) * 2 + 1]!;
      return Math.hypot(ux - lx, uy - ly);
    };
    const startWidth = widthAt(0);
    const midWidth = widthAt(Math.floor(half / 2));
    const endWidth = widthAt(Math.floor(half) - 1);
    expect(midWidth).toBeGreaterThan(startWidth * 1.5);
    expect(midWidth).toBeGreaterThan(endWidth * 1.5);
    // 칼리그래피는 고정 촉 — 폭이 거의 일정하다.
    const chisel = studioBrushPreviewRibbonD("calligraphy", 36, 16, 0.9);
    expect(chisel).toBeTruthy();
    // 리본 미지원 스타일은 기존 스트로크 프리뷰를 유지한다.
    expect(studioBrushPreviewRibbonD("soft")).toBeNull();
    expect(studioBrushPreviewRibbonD("dots")).toBeNull();
  });
});
