import { describe, expect, it } from "vitest";

import {
  resolveStudioBrushDynamicsPresetId,
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import { studioBrushIconId } from "./brush/studio-brush-icons";
import { resolveStudioBrushRuntimeContract } from "./brush/studio-brush-runtime-contract";
import { BRUSH_PRESETS } from "./studio-brush";
import {
  STUDIO_WEB_ASSIST_BRUSH_IDS,
} from "./studio-web-drawing-assist-kit";
import {
  STUDIO_WEB_COLORING_BRUSH_IDS,
} from "./studio-web-drawing-coloring-kit";
import {
  DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC,
  DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC,
  DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC,
  isStudioWebCompetitiveBrushId,
  planStudioWebCalligraphyRibbonSamples,
  planStudioWebCompetitiveSamplesForBrush,
  planStudioWebDashStitchSamples,
  planStudioWebGravityDripSamples,
  planStudioWebKaleidoscopeSamples,
  planStudioWebLazyInkSamples,
  planStudioWebMultiAgentSamples,
  planStudioWebRainbowFlowSamples,
  planStudioWebRoughInkSamples,
  planStudioWebScatterStampSamples,
  planStudioWebSoftCloudSamples,
  STUDIO_WEB_COMPETITIVE_BRUSH_IDS,
} from "./studio-web-drawing-competitive-kit";

const PATH = Object.freeze([
  { x: 100, y: 100, pressure: 0.4, t: 0 },
  { x: 120, y: 108, pressure: 0.7, t: 0.25 },
  { x: 150, y: 120, pressure: 0.9, t: 0.5 },
  { x: 180, y: 140, pressure: 0.6, t: 0.75 },
  { x: 200, y: 160, pressure: 0.35, t: 1 },
]);

describe("studio web drawing competitive kit", () => {
  it("exposes nine competitive brush ids", () => {
    expect(STUDIO_WEB_COMPETITIVE_BRUSH_IDS).toHaveLength(9);
    expect(isStudioWebCompetitiveBrushId("web-multi-agent")).toBe(true);
    expect(isStudioWebCompetitiveBrushId("web-lazy-ink")).toBe(true);
    expect(isStudioWebCompetitiveBrushId("silk-flow")).toBe(false);
  });

  it("wires all 25 web competitive+coloring+assist brushes into the core catalogue", () => {
    const webIds = [
      ...STUDIO_WEB_COMPETITIVE_BRUSH_IDS,
      ...STUDIO_WEB_COLORING_BRUSH_IDS,
      ...STUDIO_WEB_ASSIST_BRUSH_IDS,
    ];
    expect(webIds).toHaveLength(25);
    const presetIds = new Set(BRUSH_PRESETS.map((preset) => preset.id));
    for (const id of webIds) {
      expect(presetIds.has(id), `${id}: missing preset`).toBe(true);
      expect(resolveStudioBrushDynamicsPresetId(id), `${id}: no dynamics route`).not.toBeNull();
      expect(studioBrushDynamicsSettingsForBrushId(id), `${id}: no dynamics profile`).not.toBeNull();
      expect(resolveStudioBrushRuntimeContract(id)?.id, `${id}: no runtime contract`).toBe(id);
      expect(studioBrushIconId(id), `${id}: missing icon`).toBeTruthy();
    }
  });

  it("multi-agent swarm is deterministic and multiplies samples by agent count", () => {
    const a = planStudioWebMultiAgentSamples(PATH, { agentCount: 5, seed: 7 });
    const b = planStudioWebMultiAgentSamples(PATH, { agentCount: 5, seed: 7 });
    expect(a).toEqual(b);
    expect(a.length).toBe(PATH.length * 5);
    expect(a.some((s) => s.agent === 4)).toBe(true);
    // Agents diverge from the raw path.
    expect(a.some((s) => Math.hypot(s.x - PATH[2]!.x, s.y - PATH[2]!.y) > 2)).toBe(true);
  });

  it("rough ink emits multiple jittered passes", () => {
    const samples = planStudioWebRoughInkSamples(PATH, {
      passes: 3,
      jitter: 2,
      seed: DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.seed,
    });
    expect(samples.length).toBe(PATH.length * 3);
    const firstPass = samples.filter((s) => s.agent === 0);
    const secondPass = samples.filter((s) => s.agent === 1);
    expect(firstPass[1]!.x).not.toBe(secondPass[1]!.x);
  });

  it("gravity drip adds downward beads under high pressure", () => {
    const samples = planStudioWebGravityDripSamples(PATH, {
      ...DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC,
      dripChance: 1,
      maxDrips: 8,
      seed: 99,
    });
    expect(samples.length).toBeGreaterThan(PATH.length);
    const drips = samples.filter((s) => s.agent === 1);
    expect(drips.length).toBeGreaterThan(0);
    expect(drips.every((s) => s.y >= 100)).toBe(true);
  });

  it("soft cloud sprays a bounded particle field", () => {
    const samples = planStudioWebSoftCloudSamples(PATH, {
      ...DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC,
      particlesPerStation: 5,
    });
    expect(samples.length).toBeGreaterThan(PATH.length);
    expect(samples.every((s) => s.opacity <= 0.55)).toBe(true);
  });

  it("kaleidoscope folds path around a centre", () => {
    const samples = planStudioWebKaleidoscopeSamples(PATH, {
      folds: 4,
      centerX: 150,
      centerY: 150,
      mirror: false,
    });
    expect(samples.length).toBe(PATH.length * 4);
  });

  it("rejects invalid coordinates and stays empty for empty paths", () => {
    expect(planStudioWebMultiAgentSamples([])).toEqual([]);
    expect(
      planStudioWebRoughInkSamples([{ x: Number.NaN, y: 1 }]),
    ).toEqual([]);
  });

  it("wave-2 planners: calligraphy, dash, scatter, rainbow, lazy ink", () => {
    const calli = planStudioWebCalligraphyRibbonSamples(PATH);
    expect(calli.length).toBe(PATH.length);
    expect(calli[1]!.angleRadians).toBeTypeOf("number");

    const dash = planStudioWebDashStitchSamples(PATH, { dashLength: 6, gapLength: 6 });
    expect(dash.length).toBeGreaterThan(0);
    expect(dash.length).toBeLessThan(PATH.length * 8);

    const stamps = planStudioWebScatterStampSamples(PATH, { stampsPerStation: 3 });
    expect(stamps.length).toBeGreaterThan(PATH.length);
    expect(stamps.some((s) => s.hueShift !== undefined)).toBe(true);

    const rainbow = planStudioWebRainbowFlowSamples(PATH, { hueSpeed: 40 });
    expect(rainbow.every((s) => typeof s.hueShift === "number")).toBe(true);

    const lazy = planStudioWebLazyInkSamples(PATH, { smoothness: 0.8 });
    expect(lazy.length).toBe(PATH.length);
    // Lazy tip should lag behind the raw path on later samples.
    expect(Math.hypot(lazy[4]!.x - PATH[4]!.x, lazy[4]!.y - PATH[4]!.y)).toBeGreaterThan(0.5);

    const viaDispatch = planStudioWebCompetitiveSamplesForBrush("web-lazy-ink", PATH);
    expect(viaDispatch.length).toBe(lazy.length);
  });
});
