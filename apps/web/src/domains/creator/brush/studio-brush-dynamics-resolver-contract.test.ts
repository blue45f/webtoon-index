import { describe, expect, it } from "vitest";

import { exportPageToSvg, type SvgExportEl, type SvgExportPageInput } from "../export/studio-svg-export";
import { planStudioDynamicBrushRender } from "../studio-dynamic-brush-render-plan";

import {
  normalizeStudioBrushDynamicsSettings,
  resolveStudioBrushDynamicsPresetId,
  resolveStudioBrushDynamicsSelectionPresetId,
  resolveStudioCapturedBrushDynamicsPresetId,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import { resolveStudioStampBrushKind } from "./studio-brush-stamp-engine";
import {
  planStudioDrawPointerStart,
  type StudioDrawPointerStartInput,
} from "./studio-draw-pointer-start-plan";
import { isStudioBoundedFlowPaintModelCompatible } from "./studio-stroke-paint-model";


import type { DrawEl } from "../studio-element-model";

/**
 * Adversarial-review regression suite for the dynamics resolver contract (wave FX1).
 *
 * F1 — captured resolver lost the installed brush-id shortcut for legacy strokes (no paint
 *      model), so Canvas dropped texture while the SVG exporter kept it via a one-surface
 *      fallback.
 * F2 — the selection resolver lost its unconditional installed shortcut, so legacy tool
 *      memory/slot snapshots (which omit presetId/depositPipeline for byte-stable
 *      serialization) silently stopped selecting dynamics.
 * F3 — a snapshot presetId hijacked ANY brush into the dynamics engine, suppressing the stamp
 *      engine and authoring bounded-flow strokes the collaboration mirror rejects.
 */

function pointerStartInput(
  overrides: Partial<StudioDrawPointerStartInput> = {}
): StudioDrawPointerStartInput {
  return {
    id: "stroke-contract-1",
    position: { x: 40, y: 60 },
    pointer: {
      pointerType: "pen",
      pressure: 0.6,
      tiltX: 10,
      tiltY: -5,
      twist: 0,
      tangentialPressure: 0,
      timeStamp: 10,
    },
    drawMode: "pen",
    drawShape: "line",
    shapeFill: false,
    color: "#3a2218",
    strokeWidth: 12,
    brushOpacity: 1,
    brush: "crayon",
    stampTuning: null,
    brushDynamics: studioBrushDynamicsSettingsForBrushId("crayon"),
    stabilizer: 0,
    stabilizerMode: "standard",
    velocitySensitivity: 0.5,
    pressureCurve: 1,
    positionScale: 1,
    brushTip: { tiltEnabled: false, angleDeg: 45, roundness: 0.32 },
    symmetry: { type: "none", centerX: 360, centerY: 500, radialCount: 6 },
    ...overrides,
  };
}

function page(elements: SvgExportEl[]): SvgExportPageInput {
  return { width: 720, height: 1000, bg: "#ffffff", elements };
}

/** Legacy persisted snapshot shape: normalization keeps presetId/depositPipeline omitted. */
function legacySnapshot() {
  const snapshot = normalizeStudioBrushDynamicsSettings({ seed: 4242 });
  expect(snapshot.presetId).toBeUndefined();
  expect(snapshot.depositPipeline).toBeUndefined();
  return snapshot;
}

describe("studio dynamics resolver contract (adversarial wave regressions)", () => {
  it("F2 — selection resolver keeps the installed engine for legacy snapshots and bare ids", () => {
    const legacy = legacySnapshot();

    // Reviewer probes: all three returned null after the wave, losing texture at authoring time.
    expect(resolveStudioBrushDynamicsSelectionPresetId("crayon", legacy)).toBe("dry-media");
    expect(resolveStudioBrushDynamicsSelectionPresetId("web-dash-stitch", legacy))
      .toBe("ink-particle");
    expect(resolveStudioBrushDynamicsSelectionPresetId("brush--dry-rake", legacy))
      .toBe("dry-media");

    // Bare ids (no snapshot object) resolve through the same installed shortcut.
    expect(resolveStudioBrushDynamicsSelectionPresetId("crayon", undefined)).toBe("dry-media");

    // Wet ids stay legacy without a captured causal snapshot (bare id = historical watercolor).
    expect(resolveStudioBrushDynamicsSelectionPresetId("watercolor", legacy)).toBeNull();
    expect(resolveStudioBrushDynamicsSelectionPresetId("watercolor", undefined)).toBeNull();
  });

  it("F3 — snapshot presetId cannot hijack brushes whose id contracts no dynamics engine", () => {
    // Stale panel snapshot left behind by a dynamics brush: carries presetId + causal pipeline.
    const stale = studioBrushDynamicsPresetSettings("dry-media");
    expect(stale.presetId).toBe("dry-media");
    expect(stale.depositPipeline).toBeDefined();

    for (const brushId of ["pen", "airbrush-fine", "mypaint-cc0--ink-blot"] as const) {
      expect(
        resolveStudioBrushDynamicsSelectionPresetId(brushId, stale),
        `${brushId}: selection hijack`,
      ).toBeNull();
      expect(
        resolveStudioCapturedBrushDynamicsPresetId({
          brush: brushId,
          brushDynamics: stale,
          paintModel: "bounded-flow-v2",
        }),
        `${brushId}: captured hijack`,
      ).toBeNull();
    }

    // Browser bounded-flow oracle now mirrors the collaboration admission contract
    // (apps/api STUDIO_CRDT_BOUNDED_FLOW_DYNAMIC_BRUSH_IDS does not admit "pen").
    expect(isStudioBoundedFlowPaintModelCompatible({
      paintModel: "bounded-flow-v2",
      kind: "freehand",
      mode: "pen",
      brush: "pen",
      sampleSpacing: 0.5,
      brushDynamics: stale,
    })).toBe(false);

    // presetId stays honored where the brush id itself contracts a dynamics engine.
    const hardAirbrush = studioBrushDynamicsSettingsForBrushId("hard-airbrush")!;
    expect(hardAirbrush.presetId).toBe("ink-particle");
    expect(resolveStudioBrushDynamicsSelectionPresetId("hard-airbrush", hardAirbrush))
      .toBe("ink-particle");
  });

  it("F3 — stamp brushes keep the stamp engine at pointer start despite a stale dynamics panel", () => {
    const plan = planStudioDrawPointerStart(pointerStartInput({
      brush: "airbrush-fine",
      brushDynamics: studioBrushDynamicsPresetSettings("dry-media"),
    }));

    expect(plan.capturePointerDynamics).toBe(false);
    expect(plan.element.stampPipeline).toBe("causal-walker-v2");
    expect(plan.element.brushDynamics).toBeUndefined();
    expect(plan.element.paintModel).toBeUndefined();
  });

  it("F1 — legacy dynamic strokes without a paint model keep their installed engine", () => {
    const legacy = legacySnapshot();

    // Reviewer probes: Canvas-side captured() returned null for both after the seam migration.
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      brush: "crayon",
      brushDynamics: legacy,
    })).toBe("dry-media");
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      brush: "web-dash-stitch",
      brushDynamics: legacy,
    })).toBe("ink-particle");

    // Pre-snapshot documents (dynamic brush id, no captured settings) replay the same engine.
    expect(resolveStudioCapturedBrushDynamicsPresetId({ brush: "crayon" })).toBe("dry-media");

    // Explicit non-bounded paint contracts and wet pipelines stay fail-closed.
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      brush: "crayon",
      brushDynamics: legacy,
      paintModel: "layered-flow-v1",
    })).toBeNull();
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      brush: "crayon",
      brushDynamics: legacy,
      watercolorPipeline: "causal-walker-v2",
    })).toBeNull();

    // Wet ids still require the versioned paint seam even with a captured causal snapshot.
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      brush: "watercolor",
      brushDynamics: studioBrushDynamicsSettingsForBrushId("watercolor"),
    })).toBeNull();
  });

  it("F1 — silk-symmetry crayon strokes take the dynamics engine on Canvas and SVG alike", () => {
    // Silk symmetry is deliberately bounded-flow-incompatible: the pointer-start plan captures
    // dynamics but persists no paint model, which is exactly the legacy-shaped element.
    const start = planStudioDrawPointerStart(pointerStartInput({
      id: "silk-crayon",
      brush: "crayon",
      brushDynamics: studioBrushDynamicsSettingsForBrushId("crayon"),
      symmetry: { type: "silk", centerX: 360, centerY: 500, radialCount: 6 },
    }));
    expect(start.capturePointerDynamics).toBe(true);
    expect(start.element.paintModel).toBeUndefined();
    expect(start.element.brushDynamics).toBeDefined();
    expect(start.element.watercolorPipeline).toBeUndefined();

    const el: DrawEl = {
      ...start.element,
      points: [40, 60, 64, 52, 90, 74, 120, 66],
      pressures: [0.35, 0.55, 0.85, 0.5],
      speeds: [0, 0.4, 0.8, 0.3],
    };

    // One shared engine decision: StudioDrawNode, the draft-preview lane, the pointer capture
    // gates and the SVG exporter all consume this exact call.
    expect(resolveStudioCapturedBrushDynamicsPresetId(el)).toBe("dry-media");

    // Canvas branch order: the stamp engine must not intercept, and the retained dynamic render
    // plan (what StudioDrawNode draws when the resolver is non-null) must be ready.
    expect(resolveStudioStampBrushKind(el.brush)).toBeNull();
    const canvasPlan = planStudioDynamicBrushRender(el, "dry-media", false);
    expect(canvasPlan.status).toBe("ready");

    // Durable surface: the exporter emits dynamic-engine marks for the same element without any
    // SVG-only fallback, and never routes it through the stamp serializer.
    const exported = exportPageToSvg(page([el]));
    expect(exported.skipped).toEqual([]);
    expect(exported.svg).not.toContain("data-stamp-brush=");
    expect(exported.svg).not.toContain('fill="none"');
    expect(exported.svg.length).toBeGreaterThan(200);
  });

  it("fail-closed parity — explicit v1 contracts never render dynamics dabs on either surface", () => {
    const el: DrawEl = {
      id: "v1-crayon",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: "crayon",
      points: [10, 10, 30, 14, 52, 26],
      pressures: [0.4, 0.6, 0.5],
      stroke: "#333333",
      strokeWidth: 9,
      paintModel: "layered-flow-v1",
      brushDynamics: normalizeStudioBrushDynamicsSettings({ seed: 7 }),
    };

    // Shared resolver decision is null — Canvas takes its plain branch...
    expect(resolveStudioCapturedBrushDynamicsPresetId(el)).toBeNull();

    // ...and the exporter must not resurrect the dynamics engine through a one-surface fallback.
    const exported = exportPageToSvg(page([el]));
    expect(exported.svg).not.toMatch(/<ellipse [^>]*transform="rotate\(/);
  });

  it("D — installed resolver truth table is unchanged by the dead-branch cleanup", () => {
    const expectations: readonly (readonly [unknown, string | null])[] = [
      // Canonical preset ids pass through.
      ["ink-particle", "ink-particle"],
      ["airbrush", "airbrush"],
      ["dry-media", "dry-media"],
      // Spray family aliases.
      ["spray", "airbrush"],
      ["soft-brush", "airbrush"],
      ["splatter", "airbrush"],
      // Core dry media.
      ["crayon", "dry-media"],
      ["chalk", "dry-media"],
      ["charcoal", "dry-media"],
      ["pastel", "dry-media"],
      ["oil-pastel", "dry-media"],
      // Commercial aliases.
      ["hard-airbrush", "ink-particle"],
      ["erodible-pencil", "ink-particle"],
      ["web-dash-stitch", "ink-particle"],
      ["web-soft-cloud", "airbrush"],
      ["web-neon-tube", "airbrush"],
      ["sketchpad-soft-marker", "airbrush"],
      // Engine-lane dynamic twins.
      ["brush--dry-rake", "dry-media"],
      ["airbrush--klecks-grit", "airbrush"],
      ["oil-pastel--wgm-mix", "dry-media"],
      // Non-dynamics ids stay null (stamp walkers, wet ids, plain families, imports).
      ["pen", null],
      ["marker", null],
      ["watercolor", null],
      ["ink-wash", null],
      ["inkwash-pen", null],
      ["airbrush-fine", null],
      ["crayon--klecks-stamp", null],
      ["mypaint-cc0--ink-blot", null],
      // Non-string inputs.
      [undefined, null],
      [null, null],
      [42, null],
    ];

    for (const [brushId, expected] of expectations) {
      expect(resolveStudioBrushDynamicsPresetId(brushId), String(brushId)).toBe(expected);
    }
  });
});
