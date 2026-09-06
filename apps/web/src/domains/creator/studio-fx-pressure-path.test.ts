import { describe, expect, it } from "vitest";

import {
  planStudioFxBrushPressurePath,
  resolveStudioFxBrushPressureResponse,
  resolveStudioFxBrushTapPressureResponse,
  resolveStudioFxPressurePassResponse,
  type StudioFxPressureBrushId,
} from "./studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

const PRESSURE_BRUSHES: readonly StudioFxPressureBrushId[] = [
  "highlighter",
  "chisel-highlighter",
  "pastel-highlighter",
  "neon",
  "glow",
  "soft-glow",
];

describe("fixed-path FX pressure", () => {
  it.each(PRESSURE_BRUSHES)(
    "%s keeps canonical 0→0.8→1 response monotonic and preserves both nominal contracts",
    (brushId) => {
      const canonical = [0, 0.2, 0.4, 0.6, 0.8, 0.85, 0.9, 0.95, 1]
        .map((pressure) => resolveStudioFxBrushPressureResponse(brushId, pressure));
      const legacyTap = resolveStudioFxBrushTapPressureResponse(brushId, 0.5);
      const canonicalTap = resolveStudioFxBrushTapPressureResponse(
        brushId,
        0.5,
        STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      );
      const currentNominal = resolveStudioFxBrushPressureResponse(brushId, 0.8);

      expect(legacyTap).toMatchObject({
        pressure: 0.5,
        widthScale: 1,
        opacityScale: 1,
        haloScale: 1,
      });
      expect(currentNominal).toMatchObject({
        pressure: 0.8,
        widthScale: 1,
        opacityScale: 1,
        haloScale: 1,
      });
      expect(canonicalTap.widthScale).not.toBe(legacyTap.widthScale);
      expect(canonicalTap.opacityScale).not.toBe(legacyTap.opacityScale);
      expect(canonical[0]!.widthScale).toBeLessThanOrEqual(1);
      expect(canonical[0]!.opacityScale).toBeLessThan(1);
      expect(canonical.at(-1)!.widthScale).toBeGreaterThan(1);
      expect(canonical.at(-1)!.opacityScale).toBeGreaterThan(1);
      for (const key of ["widthScale", "opacityScale", "haloScale"] as const) {
        for (let index = 1; index < canonical.length; index += 1) {
          expect(canonical[index]![key]).toBeGreaterThanOrEqual(
            canonical[index - 1]![key],
          );
        }
      }
    },
  );

  it.each(PRESSURE_BRUSHES)(
    "%s preserves every omitted-model legacy series and versions canonical pressure explicitly",
    (brushId) => {
      const input = {
        brushId,
        points: [0, 0, 12, 8, 24, -2, 40, 6],
        tension: 0.35,
      } as const;
      const omitted = planStudioFxBrushPressurePath(input);
      const legacy = planStudioFxBrushPressurePath({
        ...input,
        pressures: [0, 0.2, 0.8, 1],
      });
      const mixed = planStudioFxBrushPressurePath({
        ...input,
        pressures: [0.5, 0.2, 0.8, 1],
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      });

      expect(legacy).toEqual(omitted);
      expect(legacy.segments.every((segment) => (
        segment.widthScale === 1
        && segment.opacityScale === 1
        && segment.haloScale === 1
      ))).toBe(true);
      expect(mixed.segments.some((segment) => (
        segment.widthScale !== 1
        || segment.opacityScale !== 1
        || segment.haloScale !== 1
      ))).toBe(true);
    },
  );

  it("retains the historical cardinal Q/C/Q geometry while attaching pressure per segment", () => {
    const plan = planStudioFxBrushPressurePath({
      brushId: "neon",
      points: [0, 0, 10, 20, 20, -5, 30, 15],
      pressures: [0, 0.4, 0.9, 1],
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.3,
    });

    expect(plan.sourcePointCount).toBe(4);
    expect(plan.segments.map(({ command }) => command)).toEqual([
      "quadratic",
      "cubic",
      "quadratic",
    ]);
    expect(plan.segments.map(({ sourceSegmentIndex }) => sourceSegmentIndex))
      .toEqual([0, 1, 2]);
    expect(plan.segments[0]).toMatchObject({ moveX: 0, moveY: 0 });
    expect(plan.segments.at(-1)).toMatchObject({ endX: 30, endY: 15 });
    expect(plan.segments.at(-1)!.haloScale).toBeGreaterThan(
      plan.segments[0]!.haloScale,
    );
  });

  it("routes outer halo pressure into radius while keeping the luminous core nib-led", () => {
    const heavy = resolveStudioFxBrushPressureResponse("soft-glow", 1);
    const outer = resolveStudioFxPressurePassResponse(heavy, 4.2, false);
    const core = resolveStudioFxPressurePassResponse(heavy, 0.85, true);

    expect(outer.widthScale).toBeGreaterThan(core.widthScale);
    expect(core.opacityScale).toBeCloseTo(Math.sqrt(heavy.opacityScale));
    expect(outer.opacityScale).toBe(heavy.opacityScale);
  });

  it("floors highlighter geometry without lifting pigment or halo pressure", () => {
    const sliderZero = resolveStudioFxBrushPressureResponse("highlighter", 0, 0);
    const sliderFull = resolveStudioFxBrushPressureResponse("highlighter", 0, 1);

    expect(sliderFull.widthScale).toBe(1);
    expect(sliderFull.widthScale).toBeGreaterThan(sliderZero.widthScale);
    expect(sliderFull.opacityScale).toBe(sliderZero.opacityScale);
    expect(sliderFull.haloScale).toBe(sliderZero.haloScale);
    expect(sliderFull.pressure).toBe(sliderZero.pressure);
  });

  it("keeps long-stroke planning linear in source-array reads", () => {
    const pointCount = 16_384;
    let coordinateReads = 0;
    let pressureReads = 0;
    const numericKey = /^(?:0|[1-9]\d*)$/u;
    const points = new Proxy(
      Array.from(
        { length: pointCount * 2 },
        (_, coordinateIndex) => coordinateIndex % 2 === 0
          ? coordinateIndex / 2
          : Math.sin(coordinateIndex / 31) * 12,
      ),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && numericKey.test(property)) {
            coordinateReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const pressures = new Proxy(
      Array.from({ length: pointCount }, (_, index) => index / (pointCount - 1)),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && numericKey.test(property)) {
            pressureReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const plan = planStudioFxBrushPressurePath({
      brushId: "glow",
      points,
      pressures,
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.3,
    });

    expect(plan.segments).toHaveLength(pointCount - 1);
    expect(coordinateReads).toBeLessThan(pointCount * 16);
    expect(pressureReads).toBeLessThan(pointCount * 12);
  });
});
