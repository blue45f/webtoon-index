import { describe, expect, it } from "vitest";

import {
  captureStudioOutlineStrokeContractV1,
} from "../studio-outline-stroke-contract";

import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
  planStudioHokusaiNaturalMediaRender,
  studioHokusaiSourceRevision,
} from "./studio-hokusai-natural-media-contract";

import type { DrawEl } from "../studio-element-model";

function stroke(patch: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [10, 20, 30, 40, 60, 45],
    pressures: [0.2, 0.6, 1],
    tiltXs: [0, 45, 90],
    tiltYs: [0, -45, -90],
    speeds: [0.2, 0.4, 0.8],
    stroke: "#102030",
    strokeWidth: 8,
    brush: "gpen",
    ...patch,
  };
}

describe("Studio Hokusai natural-media render contract", () => {
  it("snapshots pressure, normalized tilt, crop-local coordinates and engine identity", () => {
    const result = planStudioHokusaiNaturalMediaRender(
      stroke(),
      {
        presetId: "charcoal",
        color: "#AABBCC",
        sizeScale: 1.5,
        opacity: 0.8,
        seed: 42,
      },
      { width: 800, height: 1_200 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      version: STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
      engine: {
        id: "reearth-hokusai",
        version: "0.3.0",
        brushFormat: "libmypaint-myb-v3",
        alpha: "transparent-straight-rgba8",
        execution: "dedicated-worker-wasm",
      },
      source: {
        elementId: "draw-1",
        brushId: "gpen",
        sourcePointCount: 3,
        revision: expect.stringMatching(/^hokusai-source-v1:[a-f0-9]{16}$/u),
      },
      presetId: "charcoal",
      materialProfileId: "charcoal",
      color: "#aabbcc",
      opacity: 0.8,
      seed: 42,
    });
    expect(result.plan.samples).toHaveLength(3);
    expect(result.plan.samples.map(({ pressure }) => pressure))
      .toEqual([0.2, 0.6, 1]);
    expect(result.plan.samples.map(({ tiltX, tiltY }) => [tiltX, tiltY]))
      .toEqual([[0, 0], [0.5, -0.5], [1, -1]]);
    expect(result.plan.samples[0]).toMatchObject({
      timeMilliseconds: 0,
    });
    expect(result.plan.samples[2]!.timeMilliseconds)
      .toBeGreaterThan(result.plan.samples[1]!.timeMilliseconds);
    expect(result.plan.raster.radiusPixels).toBe(12);
    expect(result.plan.logicalBounds.x).toBe(0);
    expect(result.plan.logicalBounds.y).toBe(0);
  });

  it("downscales oversized logical crops without crossing the resident RGBA budget", () => {
    const result = planStudioHokusaiNaturalMediaRender(
      stroke({
        points: [0, 0, 100_000, 100_000],
        pressures: [0.5, 0.5],
      }),
      {
        presetId: "oil",
        color: "#102030",
        sizeScale: 1,
        opacity: 1,
        seed: 0,
      },
      { width: 100_000, height: 100_000 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.raster.width)
      .toBeLessThanOrEqual(STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension);
    expect(result.plan.raster.height)
      .toBeLessThanOrEqual(STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension);
    expect(result.plan.raster.width * result.plan.raster.height)
      .toBeLessThanOrEqual(STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPixels);
    expect(result.plan.raster.scale).toBeLessThan(1);
  });

  it("uses durable outline diameter authority and includes it in the source revision", () => {
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "mapping-pen",
      pressureSource: "recorded",
    });
    expect(outlineStroke).not.toBeNull();
    // mapping-pen rides the perfect-freehand contract branch (capsule lanes are pinned ids only).
    if (outlineStroke?.engine !== "perfect-freehand-outline") {
      throw new Error("mapping-pen must capture the perfect-freehand outline contract");
    }
    expect(outlineStroke.profile.diameterScale).toBe(0.45);
    const source = stroke({
      brush: "mapping-pen",
      outlineStroke,
    });
    const result = planStudioHokusaiNaturalMediaRender(
      source,
      {
        presetId: "pencil",
        color: "#102030",
        sizeScale: 1.5,
        opacity: 1,
        seed: 7,
      },
      { width: 800, height: 1_200 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.raster.radiusPixels).toBeCloseTo(5.4, 8);

    const changedOutline = {
      ...outlineStroke,
      profile: {
        ...outlineStroke.profile,
        diameterScale: 0.46,
      },
    };
    expect(studioHokusaiSourceRevision({
      ...source,
      outlineStroke: changedOutline,
    })).not.toBe(studioHokusaiSourceRevision(source));
  });

  it("fails closed for an unsupported durable outline contract", () => {
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    });
    expect(outlineStroke).not.toBeNull();
    if (!outlineStroke) return;
    expect(planStudioHokusaiNaturalMediaRender(
      stroke({
        outlineStroke: {
          ...outlineStroke,
          version: 99,
        } as unknown as DrawEl["outlineStroke"],
      }),
      {
        presetId: "pencil",
        color: "#000000",
        sizeScale: 1,
        opacity: 1,
        seed: 1,
      },
      { width: 800, height: 1_200 },
    )).toMatchObject({ ok: false, reason: "invalid-source" });
  });

  it.each([
    stroke({ kind: "line" }),
    stroke({ mode: "eraser" }),
    stroke({ points: [0, Number.NaN, 1, 1] }),
    stroke({ points: [0, 0] }),
  ])("fails closed for an unsupported or malformed source", (source) => {
    expect(planStudioHokusaiNaturalMediaRender(
      source,
      {
        presetId: "pencil",
        color: "#000000",
        sizeScale: 1,
        opacity: 1,
        seed: 1,
      },
      { width: 800, height: 1_200 },
    )).toMatchObject({ ok: false });
  });

  it("rejects unknown presets, invalid colors and non-uint32 seeds", () => {
    expect(planStudioHokusaiNaturalMediaRender(
      stroke(),
      {
        presetId: "unknown" as "pencil",
        color: "#000000",
        sizeScale: 1,
        opacity: 1,
        seed: 1,
      },
      { width: 800, height: 1_200 },
    )).toMatchObject({ ok: false, reason: "invalid-settings" });
    expect(planStudioHokusaiNaturalMediaRender(
      stroke(),
      {
        presetId: "charcoal",
        materialProfileId: "acrylic",
        color: "#000000",
        sizeScale: 1,
        opacity: 1,
        seed: 1,
      },
      { width: 800, height: 1_200 },
    )).toMatchObject({ ok: false, reason: "invalid-settings" });
    expect(planStudioHokusaiNaturalMediaRender(
      stroke(),
      {
        presetId: "pencil",
        color: "red" as `#${string}`,
        sizeScale: 1,
        opacity: 1,
        seed: -1,
      },
      { width: 800, height: 1_200 },
    )).toMatchObject({ ok: false, reason: "invalid-settings" });
  });
});
