import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";
import {
  STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH,
  STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH,
} from "../studio-element-model";
import { quantizeFixedRateStrokeSample } from "../studio-fixed-rate-stroke-filter";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "../studio-pixel-pencil";

import { materializeStudioBrushPackSelection } from "./studio-brush-pack-runtime";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";
import {
  advanceStudioBrushVelocityPressure,
  initializeStudioBrushVelocityPressure,
} from "./studio-brush-velocity-pressure";
import {
  planStudioDrawPointerStart,
  type StudioDrawPointerStartInput,
} from "./studio-draw-pointer-start-plan";
import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
} from "./studio-ink-pressure-model";
import {
  STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
  STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
} from "./studio-stroke-paint-model";
import { studioWetInkBrushRuntimeSupportsElement } from "./studio-wet-ink-brush-runtime";

function input(
  overrides: Partial<StudioDrawPointerStartInput> = {}
): StudioDrawPointerStartInput {
  return {
    id: "stroke-1",
    position: { x: 12.03, y: 34.04 },
    pointer: {
      pointerType: "mouse",
      pressure: 0.5,
      tiltX: 40,
      tiltY: -30,
      twist: 270,
      tangentialPressure: 0.25,
      timeStamp: 123,
    },
    drawMode: "pen",
    drawShape: "line",
    shapeFill: false,
    color: "#123456",
    strokeWidth: 8,
    brushOpacity: 1,
    brush: "pen",
    stampTuning: null,
    brushDynamics: {},
    stabilizer: 0,
    stabilizerMode: "standard",
    velocitySensitivity: 0.65,
    pressureCurve: 1,
    positionScale: 2,
    brushTip: { tiltEnabled: true, angleDeg: 45, roundness: 0.32 },
    symmetry: { type: "none", centerX: 400, centerY: 600, radialCount: 6 },
    ...overrides,
  };
}

describe("planStudioDrawPointerStart", () => {
  it("captures browser-standard pen sensor provenance and aligned channels for every new pen stroke", () => {
    const plan = planStudioDrawPointerStart(input({
      pointer: {
        pointerType: "pen",
        pressure: 0.42,
        tiltX: 31,
        tiltY: -22,
        twist: 271,
        tangentialPressure: -0.35,
        altitudeAngle: 0.63,
        azimuthAngle: 2.4,
        width: 3.5,
        height: 2.25,
        timeStamp: 456,
      },
    }));

    expect(plan.capturePointerDynamics).toBe(false);
    expect(plan.element.inkInput).toMatchObject({
      kind: "studio-ink-input-contract",
      version: 2,
      pointerType: "pen",
      pressureSource: "device-or-browser",
      authoritativeSamples: "coalesced-or-dispatched-v1",
      predictedSamples: "preview-only-never-persisted-v1",
      privacy: "no-device-identifier-v1",
    });
    expect(plan.element.tiltXs).toEqual([31]);
    expect(plan.element.tiltYs).toEqual([-22]);
    expect(plan.element.twists).toEqual([271]);
    expect(plan.element.speeds).toEqual([0]);
    expect(plan.element.tangentialPressures).toEqual([-0.35]);
    expect(plan.element.altitudeAngles).toEqual([0.63]);
    expect(plan.element.azimuthAngles).toEqual([2.4]);
    expect(plan.element.contactWidths).toEqual([3.5]);
    expect(plan.element.contactHeights).toEqual([2.25]);
    expect(plan.element.sampleTimeOffsets).toEqual([0]);
  });

  it("creates a quantized immediate pen start with the versioned path pressure model", () => {
    const plan = planStudioDrawPointerStart(input());

    expect(plan.causalInputPlan).toEqual({
      mode: "immediate",
      sampleSpacing: 0,
      usesFixedRateClock: false,
      quantizeImmediately: true,
    });
    expect(plan.strokeOrigin).toEqual({ x: 12.03125, y: 34.046875 });
    expect(plan.pressure).toBe(1);
    expect(plan.stylus).toEqual({
      pointerType: "mouse",
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      hasTilt: false,
    });
    expect(plan.element).toMatchObject({
      id: "stroke-1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [12.03125, 34.046875],
      pressures: [1],
      stroke: "#123456",
      strokeWidth: 8,
      opacity: 1,
      brush: "pen",
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
      sampleSpacing: 0,
    });
    expect(plan.capturePointerDynamics).toBe(false);
    expect(plan.element.symmetry).toBeUndefined();
    expect(plan.element.paintModel).toBeUndefined();
  });

  it("selects the fixed-rate clock and one-shot translucent paint for marker ink", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "marker",
      brushOpacity: 0.45,
      stabilizer: 6,
    }));

    expect(plan.causalInputPlan).toEqual({
      mode: "fixed-rate",
      sampleSpacing: 0,
      usesFixedRateClock: true,
      quantizeImmediately: false,
    });
    expect(plan.element.pressureModel).toBe(
      STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3
    );
    expect(plan.element.paintModel).toBe(STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1);
    expect(plan.element.sampleSpacing).toBe(0);
  });

  it.each([
    "pencil",
    "pencil-2b",
    "pencil-6b",
    "soft-pencil",
    "colored-pencil",
    "brush",
    "flat-brush",
    "highlighter",
    "chisel-highlighter",
    "pastel-highlighter",
    "neon",
    "glow",
    "soft-glow",
  ] as const)(
    "versions newly authored %s material pressure without upgrading legacy snapshots",
    (brush) => {
      const plan = planStudioDrawPointerStart(input({
        brush,
        pointer: {
          pointerType: "pen",
          pressure: 0.5,
          timeStamp: 124,
        },
      }));

      expect(plan.element.materialPressureModel).toBe(
        STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      );
      expect(plan.element.pressures).toHaveLength(1);
      expect(plan.element.pressures?.[0]).toBeGreaterThan(0);
      expect(plan.element.pressures?.[0]).toBeLessThan(1);
      expect(plan.element.materialMinimumDiameterRatio).toBeTypeOf("number");
      expect(plan.element.materialMinimumDiameterRatio).toBeGreaterThanOrEqual(0);
      expect(plan.element.materialMinimumDiameterRatio).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    ["pencil", 0.18],
    ["brush", 0.08],
    ["flat-brush", 0.08],
    ["highlighter", 0.62],
  ] as const)(
    "snapshots the stricter artist/family minimum diameter for %s",
    (brush, familyMinimum) => {
      const familyFloor = planStudioDrawPointerStart(input({
        brush,
        pressureMinSize: 0,
      }));
      const artistFloor = planStudioDrawPointerStart(input({
        brush,
        pressureMinSize: 1,
      }));

      expect(familyFloor.element.materialMinimumDiameterRatio).toBe(familyMinimum);
      expect(artistFloor.element.materialMinimumDiameterRatio).toBe(1);
    },
  );

  it("keeps eraser input immediate even when the previously selected pen has dynamics", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "airbrush",
      drawMode: "eraser",
      stabilizer: 0,
    }));

    expect(plan.causalInputPlan).toEqual({
      mode: "immediate",
      sampleSpacing: 0,
      usesFixedRateClock: false,
      quantizeImmediately: true,
    });
    expect(plan.capturePointerDynamics).toBe(false);
  });

  it("preserves the standard eraser identity without enabling low-density paint", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "standard-eraser",
      brushCatalogId: "standard-eraser",
      brushCatalogName: "일반 지우개",
      brushOpacity: 1,
      drawMode: "eraser",
      strokeWidth: 20,
    }));

    expect(plan.element).toMatchObject({
      mode: "eraser",
      brush: "standard-eraser",
      brushCatalogId: "standard-eraser",
      brushCatalogName: "일반 지우개",
      opacity: 1,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      strokeWidth: 20,
    });
    expect(plan.pressure).toBe(1);
    expect(plan.element.paintModel).toBeUndefined();
  });

  it("preserves the named kneaded eraser and applies its low density once per stroke", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "kneaded-eraser",
      brushCatalogId: "kneaded-eraser",
      brushCatalogName: "떡지우개(저농도)",
      brushOpacity: 0.38,
      drawMode: "eraser",
      strokeWidth: 26,
    }));

    expect(plan.element).toMatchObject({
      mode: "eraser",
      brush: "kneaded-eraser",
      brushCatalogId: "kneaded-eraser",
      brushCatalogName: "떡지우개(저농도)",
      opacity: 0.38,
      paintModel: STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
      strokeWidth: 26,
    });
    expect(plan.pressure).toBeCloseTo(0.55, 2);
    expect(plan.element.pressures?.[0]).toBeCloseTo(plan.pressure, 6);

    const generic = planStudioDrawPointerStart(input({
      brush: "marker-bold",
      brushCatalogId: "marker-bold",
      brushCatalogName: "볼드 마커",
      brushOpacity: 0.38,
      drawMode: "eraser",
      strokeWidth: 26,
    }));
    expect(generic.element.brush).toBeUndefined();
    expect(generic.element.brushCatalogId).toBeUndefined();
    expect(generic.element.paintModel).toBeUndefined();
  });

  it("keeps a stationary kneaded-eraser mouse sample continuous with its first point", () => {
    const pointer = {
      clientX: 0,
      clientY: 0,
      pointerType: "mouse",
      pressure: 0.5,
      timeStamp: 0,
    } as const;
    const pressureSettings = {
      pressureCurve: 1,
      pressureMinSize: 0,
      useVelocityPressure: true,
      velocitySensitivity: 0.65,
    } as const;
    const plan = planStudioDrawPointerStart(input({
      position: { x: 0, y: 0 },
      pointer,
      brush: "kneaded-eraser",
      brushOpacity: 0.38,
      drawMode: "eraser",
      pressureMinSize: pressureSettings.pressureMinSize,
      positionScale: 1,
      strokeWidth: 26,
      velocitySensitivity: pressureSettings.velocitySensitivity,
    }));
    const initialState = initializeStudioBrushVelocityPressure(
      "eraser",
      pointer,
      plan.element,
      pressureSettings,
    );
    const followup = advanceStudioBrushVelocityPressure(
      initialState,
      {
        x: pointer.clientX,
        y: pointer.clientY,
        timeMs: 10,
        pointerType: pointer.pointerType,
        pressure: pointer.pressure,
      },
      {
        ...pressureSettings,
        brushId: plan.element.brush,
        fallbackPressure: plan.element.pressures?.[0],
      },
    );
    const quantizedFollowup = quantizeFixedRateStrokeSample({
      x: 0,
      y: 0,
      positionScale: 1,
      pressure: followup.pressure,
      timeStamp: 10,
    });

    expect(followup.sample.distancePx).toBe(0);
    expect(quantizedFollowup.pressure).toBe(plan.element.pressures?.[0]);
  });

  it("persists symmetry while keeping mirrored translucent ink out of layered-flow paint", () => {
    const plan = planStudioDrawPointerStart(input({
      brushOpacity: 0.5,
      symmetry: { type: "radial", centerX: 321, centerY: 654, radialCount: 8 },
    }));

    expect(plan.element.symmetry).toEqual({
      type: "radial",
      centerX: 321,
      centerY: 654,
      radialCount: 8,
    });
    expect(plan.element.paintModel).toBeUndefined();
  });

  it("keeps shape geometry on the raw endpoint contract and omits brush-only metadata", () => {
    const plan = planStudioDrawPointerStart(input({
      drawMode: "shape",
      drawShape: "ellipse",
      shapeFill: true,
      brush: "calligraphy",
    }));

    expect(plan.causalInitialSample).toBeNull();
    expect(plan.strokeOrigin).toEqual({ x: 12.03, y: 34.04 });
    expect(plan.pressure).toBe(0.5);
    expect(plan.element).toMatchObject({
      kind: "ellipse",
      mode: "pen",
      points: [12.03, 34.04, 12.03, 34.04],
      fill: "#123456",
      pressures: [0.5, 0.5],
    });
    expect(plan.element.brush).toBeUndefined();
    expect(plan.element.brushTip).toBeUndefined();
    expect(plan.element.sampleSpacing).toBeUndefined();
  });

  it.each([
    {
      mode: "pixel" as const,
      expectedMode: "pen" as const,
      expectedWidth: 1,
      expectedPressure: 1,
      expectedSpacing: 1,
      expectedFill: undefined,
    },
    {
      mode: "eraser" as const,
      expectedMode: "eraser" as const,
      expectedWidth: 8,
      expectedPressure: 1,
      expectedSpacing: 0,
      expectedFill: undefined,
    },
    {
      mode: "lasso-fill" as const,
      expectedMode: "pen" as const,
      expectedWidth: 8,
      expectedPressure: 0.5,
      expectedSpacing: 0.75,
      expectedFill: "#123456",
    },
  ])("preserves the $mode freehand storage contract", ({
    mode,
    expectedMode,
    expectedWidth,
    expectedPressure,
    expectedSpacing,
    expectedFill,
  }) => {
    const plan = planStudioDrawPointerStart(input({ drawMode: mode }));

    expect(plan.element.mode).toBe(expectedMode);
    expect(plan.element.strokeWidth).toBe(expectedWidth);
    expect(plan.element.pressures).toEqual([expectedPressure]);
    expect(plan.element.sampleSpacing).toBe(expectedSpacing);
    expect(plan.element.fill).toBe(expectedFill);
    if (mode === "eraser") {
      expect(plan.element.pressureModel).toBe(STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1);
    } else {
      expect(plan.element.pressureModel).toBeUndefined();
    }
    expect(plan.element.brush).toBe(
      mode === "pixel" ? STUDIO_PIXEL_PENCIL_RENDER_MODE : undefined
    );
  });

  it("stores pixel pencil as a versioned hard-grid stroke without pen dynamics or symmetry", () => {
    const plan = planStudioDrawPointerStart(input({
      drawMode: "pixel",
      brush: "airbrush",
      brushOpacity: 0.65,
      symmetry: { type: "radial", centerX: 10, centerY: 20, radialCount: 12 },
    }));

    expect(plan.causalInputPlan.mode).toBe("legacy");
    expect(plan.capturePointerDynamics).toBe(false);
    expect(plan.element).toMatchObject({
      brush: STUDIO_PIXEL_PENCIL_RENDER_MODE,
      strokeWidth: 1,
      pressures: [1],
      opacity: 0.65,
      sampleSpacing: 1,
    });
    expect(plan.element.pressureModel).toBeUndefined();
    expect(plan.element.brushDynamics).toBeUndefined();
    expect(plan.element.symmetry).toBeUndefined();
  });

  it("snapshots pen tilt for calligraphy without mistaking mouse tilt for stylus input", () => {
    const mouse = planStudioDrawPointerStart(input({ brush: "calligraphy" }));
    const pen = planStudioDrawPointerStart(input({
      brush: "calligraphy",
      pointer: {
        pointerType: "pen",
        pressure: 0.4,
        tiltX: 32,
        tiltY: -18,
        twist: 271,
        timeStamp: 124,
      },
    }));

    expect(mouse.element.tiltXs).toEqual([0]);
    expect(mouse.element.tiltYs).toEqual([0]);
    expect(mouse.element.twists).toEqual([0]);
    expect(pen.stylus).toMatchObject({ tiltX: 32, tiltY: -18, twist: 271, hasTilt: true });
    expect(pen.element.tiltXs).toEqual([32]);
    expect(pen.element.tiltYs).toEqual([-18]);
    expect(pen.element.twists).toEqual([271]);
    expect(pen.element.brushTip).toEqual({
      tiltEnabled: true,
      angleDeg: 45,
      roundness: 0.32,
    });
  });

  it("isolates dynamics brushes from causal input and snapshots all dynamic channels", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "airbrush",
      brushOpacity: 0.4,
      pointer: {
        pointerType: "pen",
        pressure: 0.25,
        tiltX: 20,
        tiltY: 10,
        twist: 90,
        tangentialPressure: 7,
        timeStamp: 125,
      },
    }));

    expect(plan.causalInputPlan.mode).toBe("legacy");
    expect(plan.capturePointerDynamics).toBe(true);
    expect(plan.element.sampleSpacing).toBe(0.5);
    expect(plan.element.paintModel).toBe(STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2);
    expect(plan.element.brushDynamics?.version).toBe(1);
    expect(plan.element.tiltXs).toEqual([20]);
    expect(plan.element.tiltYs).toEqual([10]);
    expect(plan.element.twists).toEqual([90]);
    expect(plan.element.speeds).toEqual([0]);
    expect(plan.element.tangentialPressures).toEqual([1]);
  });

  it("snapshots the strictest artist, family and brush-pack dynamic diameter floor", () => {
    const pack = materializeStudioBrushPackSelection("core-round");
    expect(pack).not.toBeNull();
    const familyFloor = planStudioDrawPointerStart(input({
      brush: pack!.runtimeBrushId,
      brushDynamics: pack!.brushDynamics,
      pressureMinSize: 0,
    }));
    const artistFloor = planStudioDrawPointerStart(input({
      brush: pack!.runtimeBrushId,
      brushDynamics: pack!.brushDynamics,
      pressureMinSize: 1,
    }));
    const packFloor = planStudioDrawPointerStart(input({
      brush: pack!.runtimeBrushId,
      brushDynamics: {
        ...pack!.brushDynamics,
        minimumDiameterRatio: 0.72,
      },
      pressureMinSize: 0,
    }));

    expect(familyFloor.element.brushDynamics?.minimumDiameterRatio).toBe(0.4);
    expect(artistFloor.element.brushDynamics?.minimumDiameterRatio).toBe(1);
    expect(packFloor.element.brushDynamics?.minimumDiameterRatio).toBe(0.72);
    expect(packFloor.element.brushDynamics?.width.base).toBe(
      packFloor.element.strokeWidth,
    );
    expect(packFloor.element.pressures).toEqual(familyFloor.element.pressures);
  });

  it("opts bounded dynamics symmetry into v2 only while its variation count is supported", () => {
    const supported = planStudioDrawPointerStart(input({
      brush: "airbrush",
      symmetry: {
        type: "kaleidoscope",
        centerX: 100,
        centerY: 200,
        radialCount: 32,
      },
    }));
    const unsupported = planStudioDrawPointerStart(input({
      brush: "airbrush",
      symmetry: {
        type: "kaleidoscope",
        centerX: 100,
        centerY: 200,
        radialCount: 33,
      },
    }));

    expect(supported.element.paintModel).toBe(STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2);
    expect(unsupported.element.paintModel).toBeUndefined();
  });

  it("keeps dense G-pen input while delegating geometry to the perfect-freehand profile", () => {
    const gpen = planStudioDrawPointerStart(input({ brush: "gpen" }));
    const calligraphy = planStudioDrawPointerStart(input({ brush: "calligraphy" }));
    const highlighter = planStudioDrawPointerStart(input({ brush: "highlighter" }));
    const airbrush = planStudioDrawPointerStart(input({ brush: "airbrush" }));

    expect(gpen.causalInputPlan).toEqual({
      mode: "immediate",
      sampleSpacing: 0,
      usesFixedRateClock: false,
      quantizeImmediately: true,
    });
    expect(gpen.element.sampleSpacing).toBe(0);
    expect(gpen.element.pressureModel).toBeUndefined();
    expect(gpen.pressure).toBeCloseTo(0.5, 2);
    expect(calligraphy.element.sampleSpacing).toBe(0.25);
    expect(highlighter.element.sampleSpacing).toBe(0.375);
    expect(airbrush.element.sampleSpacing).toBe(0.5);
    expect(gpen.element.sampleSpacing).toBeLessThan(airbrush.element.sampleSpacing!);
  });

  it("captures an immutable recorded-pressure outline contract only for owned line-art brushes", () => {
    const gpen = planStudioDrawPointerStart(input({ brush: "gpen" }));
    const mappingPen = planStudioDrawPointerStart(input({ brush: "mapping-pen" }));
    const ordinaryPen = planStudioDrawPointerStart(input({ brush: "pen" }));
    const eraser = planStudioDrawPointerStart(input({
      brush: "gpen",
      drawMode: "eraser",
    }));

    expect(gpen.element.outlineStroke).toMatchObject({
      kind: "studio-outline-stroke-contract",
      version: 1,
      engine: "perfect-freehand-outline",
      packageAlgorithm: "perfect-freehand@1.2.3:getStroke",
      pressureSource: "recorded",
      profile: { id: "gpen", diameterScale: 1 },
    });
    expect(mappingPen.element.outlineStroke).toMatchObject({
      profile: { id: "gpen", diameterScale: 0.45 },
    });
    expect(mappingPen.element.outlineStroke).not.toEqual(gpen.element.outlineStroke);
    expect(Object.isFrozen(gpen.element.outlineStroke)).toBe(true);
    expect(Object.isFrozen(gpen.element.outlineStroke?.profile)).toBe(true);
    expect(ordinaryPen.element.outlineStroke).toBeUndefined();
    expect(eraser.element.outlineStroke).toBeUndefined();
  });

  it("captures a sanitized, bounded catalog identity only for authored pen strokes", () => {
    const plan = planStudioDrawPointerStart(input({
      brush: "airbrush",
      brushCatalogId: ` \u0000pro:${"a".repeat(STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH + 20)} `,
      brushCatalogName: `\n${"붓".repeat(STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH + 20)}\t`,
    }));

    expect(plan.element.brush).toBe("airbrush");
    expect(plan.element.brushCatalogId).toHaveLength(STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH);
    expect(plan.element.brushCatalogId).toMatch(/^pro:/u);
    expect(plan.element.brushCatalogName).toBe(
      "붓".repeat(STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH)
    );

    for (const drawMode of ["eraser", "pixel", "shape", "lasso-fill"] as const) {
      const nonPen = planStudioDrawPointerStart(input({
        drawMode,
        brushCatalogId: "pro:heart-stamp",
        brushCatalogName: "하트 스탬프",
      }));
      expect(nonPen.element.brushCatalogId).toBeUndefined();
      expect(nonPen.element.brushCatalogName).toBeUndefined();
    }
  });

  it("versions stamp and watercolor walkers at stroke start", () => {
    const stamp = planStudioDrawPointerStart(input({
      brush: "ink-brush",
      stampTuning: { flow: 0.2, hardness: 0.8, minSize: 0.1 },
    }));
    const watercolor = planStudioDrawPointerStart(input({ brush: "watercolor" }));

    expect(stamp.causalInputPlan.mode).toBe("immediate");
    expect(stamp.element.stampPipeline).toBe("causal-walker-v2");
    expect(stamp.element.stamp).toEqual({ flow: 0.2, hardness: 0.8, minSize: 0.1 });
    expect(stamp.element.watercolorPipeline).toBeUndefined();
    expect(watercolor.causalInputPlan.mode).toBe("immediate");
    expect(watercolor.element.watercolorPipeline).toBe("causal-walker-v2");
    expect(watercolor.element.stampPipeline).toBeUndefined();
  });

  it("authors remaining core wet presets as bounded dynamic strokes while preserving legacy walkers", () => {
    // ink-wash · inkwash-bleed-wash 는 2026-09-02(b871ff48)부터 STUDIO_INKWASH_FLUID_BRUSH_IDS 에
    // 속해 dab dynamics 대신 공유 Stam 유체 워시를 탄다 — 아래 fluid 블록이 그 계약을 고정한다.
    const wetBrushIds = [
      "watercolor",
      "inkwash-white-ink",
    ] as const;

    for (const brushId of wetBrushIds) {
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === brushId);
      expect(preset, `${brushId}: missing core preset`).toBeDefined();
      if (!preset) continue;
      const selection = studioCoreBrushCatalogSelection(preset);
      const plan = planStudioDrawPointerStart(input({
        brush: brushId,
        brushCatalogId: selection.catalogId,
        brushCatalogName: selection.catalogName,
        brushDynamics: selection.brushDynamics,
        brushOpacity: selection.defaultOpacity,
        strokeWidth: selection.defaultWidth,
      }));

      expect(plan.element.paintModel, `${brushId}: bounded paint model`)
        .toBe(STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2);
      expect(plan.element.brushDynamics, `${brushId}: durable snapshot`)
        .toMatchObject(selection.brushDynamics!);
      expect(plan.element.watercolorPipeline, `${brushId}: legacy engine leaked`)
        .toBeUndefined();
      expect(plan.capturePointerDynamics, `${brushId}: sensor channels`).toBe(true);
      expect(plan.causalInputPlan.mode, `${brushId}: dynamic input isolation`).toBe("legacy");
    }

    const legacy = planStudioDrawPointerStart(input({
      brush: "ink-wash",
      brushDynamics: undefined,
    }));
    expect(legacy.element.paintModel).toBeUndefined();
    expect(legacy.element.brushDynamics).toBeUndefined();
    expect(legacy.element.watercolorPipeline).toBe("causal-walker-v2");
    expect(legacy.capturePointerDynamics).toBe(false);

    // 유체 수묵은 선택에 dynamics 스냅샷이 실려 있어도 dab 동역학으로 빠지지 않는다 — 포인터
    // 시작이 그 스냅샷을 버리고 공유 워시 경로(causal-walker-v2)를 고정해야 라이브·커밋이 같다.
    for (const brushId of ["ink-wash", "inkwash-bleed-wash"] as const) {
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === brushId);
      expect(preset, `${brushId}: missing core preset`).toBeDefined();
      if (!preset) continue;
      const selection = studioCoreBrushCatalogSelection(preset);
      const fluid = planStudioDrawPointerStart(input({
        brush: brushId,
        brushCatalogId: selection.catalogId,
        brushCatalogName: selection.catalogName,
        brushDynamics: selection.brushDynamics,
        brushOpacity: selection.defaultOpacity,
        strokeWidth: selection.defaultWidth,
      }));
      expect(fluid.element.paintModel, `${brushId}: fluid wash has no bounded paint model`)
        .toBeUndefined();
      expect(fluid.element.watercolorPipeline, `${brushId}: shared Stam wash route`)
        .toBe("causal-walker-v2");
    }
  });

  it("starts InkWash pen and water on the wet/fluid runtime instead of dab engines", () => {
    for (const brushId of ["inkwash-pen", "inkwash-water-brush"] as const) {
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === brushId);
      expect(preset, `${brushId}: missing core preset`).toBeDefined();
      if (!preset) continue;
      const selection = studioCoreBrushCatalogSelection(preset);
      const plan = planStudioDrawPointerStart(input({
        brush: brushId,
        brushCatalogId: selection.catalogId,
        brushCatalogName: selection.catalogName,
        brushDynamics: selection.brushDynamics,
        brushOpacity: selection.defaultOpacity,
        strokeWidth: selection.defaultWidth,
      }));

      expect(plan.element.watercolorPipeline, `${brushId}: wet pipeline`).toBe("causal-walker-v2");
      expect(plan.element.brushDynamics, `${brushId}: dab dynamics leaked`).toBeUndefined();
      expect(plan.element.paintModel, `${brushId}: bounded dab paint`).toBeUndefined();
      expect(plan.capturePointerDynamics, `${brushId}: dab sensor capture`).toBe(false);
      expect(
        studioWetInkBrushRuntimeSupportsElement(plan.element),
        `${brushId}: wet/fluid runtime rejected the product start snapshot`,
      ).toBe(true);
    }
  });

  it("applies CSP pressure min size to residual pen first samples", () => {
    const plan = planStudioDrawPointerStart(input({
      pressureMinSize: 0.25,
      pointer: { pointerType: "pen", pressure: 0, timeStamp: 1 },
    }));
    // Immediate residual pens may quantize the first sample; min floor must still bind near 0.25.
    expect(plan.pressure).toBeGreaterThanOrEqual(0.25);
    expect(plan.pressure).toBeLessThan(0.26);
    expect(plan.element.pressures?.[0]).toBeGreaterThanOrEqual(0.25);
    expect(plan.element.pressures?.[0]).toBeLessThan(0.26);
  });

  it("starts non-G-pen families from their distinct causal nominal pressure", () => {
    const technical = planStudioDrawPointerStart(input({ brush: "fineliner" }));
    const marker = planStudioDrawPointerStart(input({ brush: "marker" }));
    const brushPen = planStudioDrawPointerStart(input({ brush: "perfect-ink" }));

    expect(technical.pressure).toBeGreaterThan(marker.pressure);
    expect(marker.pressure).toBeGreaterThan(brushPen.pressure);
    expect(technical.element.pressures).toEqual([technical.pressure]);
    expect(marker.element.pressures).toEqual([marker.pressure]);
    expect(brushPen.element.pressures).toEqual([brushPen.pressure]);
  });

});
