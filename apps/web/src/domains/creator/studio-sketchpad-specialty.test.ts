import { describe, expect, it } from "vitest";

import {
  classifyStudioBrushBackendQuality,
} from "./brush/studio-brush-backend-quality-policy";
import {
  STUDIO_BRUSH_CATALOG_COUNTS,
  studioBrushCatalogItemById,
} from "./brush/studio-brush-catalog";
import {
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import { studioBrushIconId } from "./brush/studio-brush-icons";
import {
  resolveStudioBrushRuntimeContract,
} from "./brush/studio-brush-runtime-contract";
import { BRUSH_PRESETS } from "./studio-brush";
import {
  expandStudioSketchpadMirrorPath,
  isStudioSketchpadSpecialtyBrushId,
  planStudioSketchpadTileStations,
  resolveStudioSketchpadBrushSymmetryHint,
  studioSketchpadSoftMarkerPressureScale,
  STUDIO_SKETCHPAD_SPECIALTY_BRUSH_IDS,
} from "./studio-sketchpad-specialty";

describe("sketchpad specialty planners", () => {
  it("registers three Sketchpad-class core brushes with dynamics and runtime contracts", () => {
    for (const id of STUDIO_SKETCHPAD_SPECIALTY_BRUSH_IDS) {
      expect(isStudioSketchpadSpecialtyBrushId(id)).toBe(true);
      expect(BRUSH_PRESETS.some((preset) => preset.id === id)).toBe(true);
      expect(studioBrushCatalogItemById(id)?.source).toBe("core");
      expect(studioBrushDynamicsSettingsForBrushId(id)).not.toBeNull();
      expect(resolveStudioBrushRuntimeContract(id)).toMatchObject({
        id,
        engine: "dynamic-dabs",
      });
      expect(studioBrushIconId(id)).not.toBe("default");
      const classified = classifyStudioBrushBackendQuality({
        brushId: id,
        operation: "paint",
      });
      expect(classified.status, id).toBe("classified");
    }
    expect(STUDIO_BRUSH_CATALOG_COUNTS.core).toBeGreaterThanOrEqual(99);
    expect(STUDIO_BRUSH_CATALOG_COUNTS.pro).toBe(160);
    expect(STUDIO_BRUSH_CATALOG_COUNTS.total).toBe(
      STUDIO_BRUSH_CATALOG_COUNTS.core + STUDIO_BRUSH_CATALOG_COUNTS.pro,
    );
    expect(STUDIO_BRUSH_CATALOG_COUNTS.erase).toBe(2);
    expect(STUDIO_BRUSH_CATALOG_COUNTS.paint).toBe(
      STUDIO_BRUSH_CATALOG_COUNTS.total - STUDIO_BRUSH_CATALOG_COUNTS.erase,
    );
  });

  it("plans non-overlapping tile stations along a freehand path", () => {
    const path = Array.from({ length: 40 }, (_, index) => ({
      x: index * 8,
      y: Math.sin(index / 5) * 6,
      pressure: 0.4 + (index % 5) * 0.1,
    }));
    const stations = planStudioSketchpadTileStations(path, {
      tileSize: 16,
      gapRatio: 0.1,
      snapAngle: true,
    });
    expect(stations.length).toBeGreaterThan(8);
    expect(stations.length).toBeLessThan(path.length);
    for (let index = 1; index < stations.length; index += 1) {
      const previous = stations[index - 1]!;
      const current = stations[index]!;
      const gap = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(gap).toBeGreaterThanOrEqual(16 * 1.1 - 0.05);
      // 90° lattice snap
      expect(
        Math.abs(current.angleRadians % (Math.PI / 2)),
      ).toBeLessThan(1e-6);
    }
    // Prefix stability: same path yields identical first stations
    const prefix = planStudioSketchpadTileStations(path.slice(0, 20), {
      tileSize: 16,
      gapRatio: 0.1,
      snapAngle: true,
    });
    expect(stations.slice(0, prefix.length)).toEqual(prefix);
  });

  it("expands mirror paths as primary/mirror pairs with nested prefixes", () => {
    const path = [
      { x: 100, y: 50, pressure: 0.4 },
      { x: 140, y: 80, pressure: 0.7 },
      { x: 180, y: 40, pressure: 0.55 },
    ];
    const expanded = expandStudioSketchpadMirrorPath(path, {
      axis: "vertical",
      centerX: 200,
      centerY: 0,
    });
    expect(expanded).toHaveLength(6);
    expect(expanded[0]).toMatchObject({ x: 100, y: 50 });
    expect(expanded[1]).toMatchObject({ x: 300, y: 50 }); // 200*2 - 100
    expect(expanded[2]).toMatchObject({ x: 140, y: 80 });
    expect(expanded[3]).toMatchObject({ x: 260, y: 80 });
    const prefix = expandStudioSketchpadMirrorPath(path.slice(0, 2), {
      axis: "vertical",
      centerX: 200,
      centerY: 0,
    });
    expect(expanded.slice(0, prefix.length)).toEqual(prefix);
    expect(resolveStudioSketchpadBrushSymmetryHint("sketchpad-mirror"))
      .toEqual({ type: "vertical" });
    expect(resolveStudioSketchpadBrushSymmetryHint("pen")).toBeNull();
  });

  it("soft marker pressure scales width/opacity/flow monotonically", () => {
    const light = studioSketchpadSoftMarkerPressureScale(0.12);
    const heavy = studioSketchpadSoftMarkerPressureScale(0.94);
    expect(heavy.widthScale).toBeGreaterThan(light.widthScale * 1.3);
    expect(heavy.opacityScale).toBeGreaterThan(light.opacityScale * 1.2);
    expect(heavy.flowScale).toBeGreaterThan(light.flowScale * 1.15);

    const dynamics = studioBrushDynamicsSettingsForBrushId("sketchpad-soft-marker");
    expect(dynamics).not.toBeNull();
    if (!dynamics) return;
    const lightDabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 40, 8, 80, -4, 120, 6],
      pressures: [0.15, 0.15, 0.15, 0.15],
      baseWidth: dynamics.width.base,
      baseOpacity: 0.72,
      seed: dynamics.seed,
    }, dynamics);
    const heavyDabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 40, 8, 80, -4, 120, 6],
      pressures: [0.92, 0.92, 0.92, 0.92],
      baseWidth: dynamics.width.base,
      baseOpacity: 0.72,
      seed: dynamics.seed,
    }, dynamics);
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    expect(mean(heavyDabs.map((dab) => dab.size)))
      .toBeGreaterThan(mean(lightDabs.map((dab) => dab.size)) * 1.15);
  });

  it("tile dynamics keep discrete station pitch near tip diameter", () => {
    const dynamics = studioBrushDynamicsSettingsForBrushId("sketchpad-tile");
    expect(dynamics).not.toBeNull();
    if (!dynamics) return;
    expect(dynamics.spacingRatio).toBeGreaterThan(0.95);
    const dabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 30, 0, 60, 0, 90, 0, 120, 0, 150, 0],
      pressures: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6],
      baseWidth: dynamics.width.base,
      baseOpacity: 0.9,
      seed: dynamics.seed,
    }, dynamics);
    expect(dabs.length).toBeGreaterThan(4);
    expect(dabs.length).toBeLessThan(20);
    for (let index = 1; index < dabs.length; index += 1) {
      const gap = Math.hypot(
        dabs[index]!.x - dabs[index - 1]!.x,
        dabs[index]!.y - dabs[index - 1]!.y,
      );
      expect(gap).toBeGreaterThan(dynamics.width.base * 0.7);
    }
  });
});
