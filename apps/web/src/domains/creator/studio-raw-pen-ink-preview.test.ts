import { describe, expect, it } from "vitest";

import {
  appendStudioAuthoritativeInk,
  createStudioPredictedInkTailState,
} from "./studio-predicted-ink-tail";
import {
  createStudioRawPenInkPreviewState,
  endStudioRawPenInkPreview,
  isStudioRawPenInkPreviewEligible,
  replaceStudioRawPenInkPreview,
  syncStudioRawPenInkPreviewAuthority,
  type StudioRawPenInkPreviewEligibility,
} from "./studio-raw-pen-ink-preview";

const ELIGIBLE: StudioRawPenInkPreviewEligibility = {
  enabled: true,
  pointerType: "pen",
  tool: "draw",
  strokeMode: "pen",
  strokeKind: "freehand",
  directCanvas2d: true,
  opacity: 1,
  fillActive: false,
  symmetryType: "none",
  gpuActive: false,
  stampActive: false,
  stabilizerActive: false,
  postCorrectionActive: false,
  rulerActive: false,
  shiftActive: false,
};

function authoritativeTail(points = [1, 2], pressures = [0.4]) {
  return appendStudioAuthoritativeInk(createStudioPredictedInkTailState(), {
    points,
    pressures,
  }).state;
}

function activeState() {
  const state = createStudioRawPenInkPreviewState({
    pointerId: 7,
    generation: 3,
    eligibility: ELIGIBLE,
    authoritativeTail: authoritativeTail(),
  });
  if (!state) throw new Error("expected an eligible raw preview state");
  return state;
}

describe("studio raw pen ink preview", () => {
  it("accepts only the strict pen/freehand/direct opaque Canvas2D route", () => {
    expect(isStudioRawPenInkPreviewEligible(ELIGIBLE)).toBe(true);

    const rejected: StudioRawPenInkPreviewEligibility[] = [
      { ...ELIGIBLE, enabled: false },
      { ...ELIGIBLE, pointerType: "mouse" },
      { ...ELIGIBLE, tool: "select" },
      { ...ELIGIBLE, strokeMode: "eraser" },
      { ...ELIGIBLE, strokeKind: "line" },
      { ...ELIGIBLE, directCanvas2d: false },
      { ...ELIGIBLE, opacity: 0.999 },
      { ...ELIGIBLE, fillActive: true },
      { ...ELIGIBLE, symmetryType: "vertical" },
      { ...ELIGIBLE, gpuActive: true },
      { ...ELIGIBLE, stampActive: true },
      { ...ELIGIBLE, stabilizerActive: true },
      { ...ELIGIBLE, postCorrectionActive: true },
      { ...ELIGIBLE, rulerActive: true },
      { ...ELIGIBLE, shiftActive: true },
    ];

    for (const input of rejected) {
      expect(isStudioRawPenInkPreviewEligible(input)).toBe(false);
    }
  });

  it("requires a valid generation and an already-authoritative anchor without cloning a prefix", () => {
    const tail = authoritativeTail([1, 2, 3, 4], [0.25, 0.5]);
    const state = createStudioRawPenInkPreviewState({
      pointerId: 7,
      generation: 1,
      eligibility: ELIGIBLE,
      authoritativeTail: tail,
    });

    expect(state?.tail).toBe(tail);
    expect(createStudioRawPenInkPreviewState({
      pointerId: 7,
      generation: 0,
      eligibility: ELIGIBLE,
      authoritativeTail: tail,
    })).toBeNull();
    expect(createStudioRawPenInkPreviewState({
      pointerId: 7,
      generation: 2,
      eligibility: ELIGIBLE,
      authoritativeTail: createStudioPredictedInkTailState(),
    })).toBeNull();
  });

  it("projects raw A then replaces it with raw B while preserving authority byte-for-byte", () => {
    const initial = activeState();
    const endpoint = initial.tail.authoritativeEndpoint;
    const count = initial.tail.authoritativeSampleCount;
    const rawA = replaceStudioRawPenInkPreview(initial, {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 8, y: 9, pressure: 0.65 },
    });

    expect(rawA.authoritativeSurface).toEqual({ kind: "keep" });
    expect(rawA).not.toHaveProperty("authoritativeSpan");
    expect(rawA.predictionSurface).toEqual({
      kind: "replace",
      anchor: endpoint,
      samples: [{ x: 8, y: 9, pressure: 0.65 }],
    });

    const rawB = replaceStudioRawPenInkPreview(rawA.state, {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 12, y: 15, pressure: 0.8 },
    });
    expect(rawB.predictionSurface).toEqual({
      kind: "replace",
      anchor: endpoint,
      samples: [{ x: 12, y: 15, pressure: 0.8 }],
    });
    expect(rawB.state.tail.predictedSamples).toEqual([
      { x: 12, y: 15, pressure: 0.8 },
    ]);
    expect(rawB.state.tail.predictedSamples).not.toContainEqual({
      x: 8,
      y: 9,
      pressure: 0.65,
    });
    expect(rawB.state.tail.authoritativeEndpoint).toBe(endpoint);
    expect(rawB.state.tail.authoritativeSampleCount).toBe(count);
  });

  it("ignores foreign pointer/generation deliveries and clears a tail when a live gate closes", () => {
    const first = replaceStudioRawPenInkPreview(activeState(), {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 8, y: 9, pressure: 0.7 },
    });
    const foreignPointer = replaceStudioRawPenInkPreview(first.state, {
      pointerId: 8,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 30, y: 40, pressure: 1 },
    });
    const staleGeneration = replaceStudioRawPenInkPreview(first.state, {
      pointerId: 7,
      generation: 2,
      eligibility: ELIGIBLE,
      point: { x: 50, y: 60, pressure: 1 },
    });

    expect(foreignPointer.state).toBe(first.state);
    expect(foreignPointer.predictionSurface).toEqual({ kind: "keep" });
    expect(staleGeneration.state).toBe(first.state);
    expect(staleGeneration.predictionSurface).toEqual({ kind: "keep" });

    const shifted = replaceStudioRawPenInkPreview(first.state, {
      pointerId: 7,
      generation: 3,
      eligibility: { ...ELIGIBLE, shiftActive: true },
      point: { x: 70, y: 80, pressure: 1 },
    });
    expect(shifted.authoritativeSurface).toEqual({ kind: "keep" });
    expect(shifted.predictionSurface).toEqual({ kind: "clear" });
    expect(shifted.state.tail.predictedSamples).toEqual([]);
  });

  it("syncs only monotonic canonical authority and invalidates the old raw tail", () => {
    const first = replaceStudioRawPenInkPreview(activeState(), {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 8, y: 9, pressure: 0.7 },
    });
    const advancedAuthority = appendStudioAuthoritativeInk(first.state.tail, {
      points: [6, 7],
      pressures: [0.6],
    }).state;
    const synced = syncStudioRawPenInkPreviewAuthority(first.state, {
      pointerId: 7,
      generation: 3,
      authoritativeTail: advancedAuthority,
    });

    expect(synced.authoritativeSurface).toEqual({ kind: "keep" });
    expect(synced.predictionSurface).toEqual({ kind: "clear" });
    expect(synced.state.tail).toMatchObject({
      authoritativeSampleCount: 2,
      authoritativeEndpoint: { x: 6, y: 7, pressure: 0.6 },
      predictedSamples: [],
    });

    const stale = syncStudioRawPenInkPreviewAuthority(synced.state, {
      pointerId: 7,
      generation: 3,
      authoritativeTail: authoritativeTail(),
    });
    expect(stale.state).toBe(synced.state);
    expect(stale.predictionSurface).toEqual({ kind: "keep" });
  });

  it("seals the lifecycle and makes every late raw sample a no-op", () => {
    const active = replaceStudioRawPenInkPreview(activeState(), {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 8, y: 9, pressure: 0.7 },
    }).state;
    const mismatchedEnd = endStudioRawPenInkPreview(active, {
      pointerId: 7,
      generation: 4,
    });
    expect(mismatchedEnd.state).toBe(active);
    expect(mismatchedEnd.predictionSurface).toEqual({ kind: "keep" });

    const ended = endStudioRawPenInkPreview(active, {
      pointerId: 7,
      generation: 3,
    });
    expect(ended.authoritativeSurface).toEqual({ kind: "keep" });
    expect(ended.predictionSurface).toEqual({ kind: "clear" });
    expect(ended.state.tail.phase).toBe("ended");
    expect(ended.state.tail.predictedSamples).toEqual([]);

    const lateRaw = replaceStudioRawPenInkPreview(ended.state, {
      pointerId: 7,
      generation: 3,
      eligibility: ELIGIBLE,
      point: { x: 100, y: 200, pressure: 1 },
    });
    expect(lateRaw.state).toBe(ended.state);
    expect(lateRaw.authoritativeSurface).toEqual({ kind: "keep" });
    expect(lateRaw.predictionSurface).toEqual({ kind: "keep" });
  });
});
