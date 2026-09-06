import { describe, expect, it } from "vitest";

import { smoothStrokePoints } from "./studio-brush";
import {
  STUDIO_POST_CORRECTION_MAX_TAIL_SAMPLES,
  STUDIO_POST_CORRECTION_MIN_TAIL_SAMPLES,
  appendStudioCausalPostCorrection,
  createStudioCausalPostCorrectionState,
  materializeStudioCausalPostCorrection,
  resolveStudioPostCorrectionTailSamples,
  sealStudioCausalPostCorrection,
  studioPostCorrectionDependencySamples,
  studioPostCorrectionRunsDuringPointerContact,
  type StudioCausalPostCorrectionState,
} from "./studio-causal-post-correction";

function jitteryStroke(sampleCount = 96): number[] {
  return Array.from({ length: sampleCount }, (_, index) => [
    index * 3.75,
    Math.sin(index * 1.713) * 9 + Math.cos(index * 0.317) * 4,
  ]).flat();
}

function appendInChunks(
  points: readonly number[],
  state: StudioCausalPostCorrectionState,
  chunkPattern: readonly number[]
): StudioCausalPostCorrectionState {
  let cursor = 0;
  let patternIndex = 0;
  let current = state;
  while (cursor < points.length / 2) {
    const chunkSamples = chunkPattern[patternIndex % chunkPattern.length]!;
    const end = Math.min(points.length / 2, cursor + chunkSamples);
    current = appendStudioCausalPostCorrection(
      current,
      points.slice(cursor * 2, end * 2)
    ).state;
    cursor = end;
    patternIndex += 1;
  }
  return current;
}

describe("studio causal post-correction", () => {
  it("keeps replaceable correction tails off the canvas until pointer release", () => {
    expect(studioPostCorrectionRunsDuringPointerContact()).toBe(false);
  });

  it("derives an exact dependency lag while keeping the replaceable budget inside 8..16", () => {
    expect(studioPostCorrectionDependencySamples(0, true)).toBe(0);
    expect(studioPostCorrectionDependencySamples(5, false)).toBe(2);
    expect(studioPostCorrectionDependencySamples(10, false)).toBe(8);
    expect(studioPostCorrectionDependencySamples(9, true)).toBe(9);
    expect(studioPostCorrectionDependencySamples(10, true)).toBe(12);

    expect(resolveStudioPostCorrectionTailSamples({ strength: 2 })).toBe(8);
    expect(resolveStudioPostCorrectionTailSamples({ strength: 10, preserveCorners: true })).toBe(12);
    expect(resolveStudioPostCorrectionTailSamples({
      strength: 10,
      preserveCorners: true,
      tailSampleCount: 8,
    })).toBe(12);
    expect(resolveStudioPostCorrectionTailSamples({ strength: 4, tailSampleCount: 99 })).toBe(16);
    expect(resolveStudioPostCorrectionTailSamples({
      strength: 4,
      tailSampleCount: Number.NaN,
    })).toBe(8);

    for (let strength = 0; strength <= 10; strength += 1) {
      for (const preserveCorners of [false, true]) {
        const tail = resolveStudioPostCorrectionTailSamples({ strength, preserveCorners });
        expect(tail).toBeGreaterThanOrEqual(STUDIO_POST_CORRECTION_MIN_TAIL_SAMPLES);
        expect(tail).toBeLessThanOrEqual(STUDIO_POST_CORRECTION_MAX_TAIL_SAMPLES);
        expect(tail).toBeGreaterThanOrEqual(
          studioPostCorrectionDependencySamples(strength, preserveCorners)
        );
      }
    }
  });

  it("never mutates a visible settled prefix and replaces only a bounded tail", () => {
    const points = jitteryStroke(72);
    let state = createStudioCausalPostCorrectionState({
      strength: 10,
      preserveCorners: true,
    });
    const retainedHead: number[] = [];

    for (let sampleIndex = 0; sampleIndex < points.length / 2; sampleIndex += 1) {
      const settledBefore = retainedHead.slice();
      const transition = appendStudioCausalPostCorrection(
        state,
        points.slice(sampleIndex * 2, sampleIndex * 2 + 2)
      );
      state = transition.state;
      retainedHead.push(...transition.settledSpan.points);

      expect(retainedHead.slice(0, settledBefore.length)).toEqual(settledBefore);
      expect(state.tailPoints.length / 2).toBeLessThanOrEqual(state.tailSampleCount);
      expect(transition.tailSurface.kind).toBe("replace");
      expect(materializeStudioCausalPostCorrection(state)).toEqual(
        smoothStrokePoints(points.slice(0, (sampleIndex + 1) * 2), 10, {
          preserveCorners: true,
        })
      );
    }

    expect(retainedHead).toEqual(
      materializeStudioCausalPostCorrection(state).slice(0, retainedHead.length)
    );
  });

  it("seals to the exact whole-stroke correction for every strength and corner mode", () => {
    const points = jitteryStroke(83);
    for (let strength = 0; strength <= 10; strength += 1) {
      for (const preserveCorners of [false, true]) {
        const active = appendInChunks(
          points,
          createStudioCausalPostCorrectionState({ strength, preserveCorners }),
          [1, 4, 2, 7, 3]
        );
        const sealed = sealStudioCausalPostCorrection(active);
        const expected = smoothStrokePoints([...points], strength, { preserveCorners });

        expect(sealed.finalPoints).toEqual(expected);
        expect(sealed.state.finalPoints).toBe(sealed.finalPoints);
        expect(sealed.state.settledSampleCount).toBe(points.length / 2);
        expect(sealed.state.tailPoints).toEqual([]);
        expect(sealed.tailSurface).toEqual({ kind: "clear" });
        expect(materializeStudioCausalPostCorrection(sealed.state)).toBe(sealed.finalPoints);
      }
    }
  });

  it("preserves a sharp corner without permitting later input to rewrite the settled head", () => {
    const elbow = [
      0, 0, 10, 0, 20, 0, 30, 0, 40, 0,
      40, 10, 40, 20, 40, 30, 40, 40,
      40, 50, 40, 60, 40, 70, 40, 80,
      45, 90, 50, 100, 55, 110, 60, 120,
    ];
    const active = appendInChunks(
      elbow,
      createStudioCausalPostCorrectionState({
        strength: 10,
        preserveCorners: true,
      }),
      [1]
    );
    const stableBeforeSeal = materializeStudioCausalPostCorrection(active).slice(
      0,
      active.settledSampleCount * 2
    );
    const sealed = sealStudioCausalPostCorrection(active);

    expect(sealed.finalPoints?.[8]).toBe(40);
    expect(sealed.finalPoints?.[9]).toBe(0);
    expect(sealed.finalPoints?.slice(0, stableBeforeSeal.length)).toEqual(stableBeforeSeal);
    expect(sealed.finalPoints).toEqual(
      smoothStrokePoints([...elbow], 10, { preserveCorners: true })
    );
  });

  it("emits connected append spans with source indices suitable for pressure alignment", () => {
    let state = createStudioCausalPostCorrectionState({ strength: 8, tailSampleCount: 8 });
    const firstPoints = jitteryStroke(11);
    const first = appendStudioCausalPostCorrection(state, firstPoints);
    state = first.state;

    expect(first.settledSpan).toMatchObject({
      anchor: null,
      startSampleIndex: 0,
    });
    expect(first.settledSpan.points).toHaveLength(6);
    expect(first.tailSurface).toMatchObject({
      kind: "replace",
      startSampleIndex: 3,
      anchor: {
        x: first.settledSpan.points[4],
        y: first.settledSpan.points[5],
      },
    });

    const second = appendStudioCausalPostCorrection(state, jitteryStroke(4).map((value, index) => (
      index % 2 === 0 ? value + 100 : value
    )));
    expect(second.settledSpan.startSampleIndex).toBe(3);
    expect(second.settledSpan.anchor).toEqual(state.settledEndpoint);
    expect(second.settledSpan.points).toHaveLength(8);
    expect(second.tailSurface).toMatchObject({
      kind: "replace",
      startSampleIndex: 7,
    });
  });

  it("accepts only a finite coordinate-pair prefix and leaves caller arrays untouched", () => {
    const suffix = [0, 1, 2, 3, Number.NaN, 5, 6, 7, 8];
    const before = suffix.slice();
    const initial = createStudioCausalPostCorrectionState({ strength: 7 });
    const transition = appendStudioCausalPostCorrection(initial, suffix);

    expect(suffix).toEqual(before);
    expect(transition.state.sourceSampleCount).toBe(2);
    expect(materializeStudioCausalPostCorrection(transition.state)).toEqual(
      smoothStrokePoints([0, 1, 2, 3], 7)
    );

    const noOp = appendStudioCausalPostCorrection(transition.state, [Number.POSITIVE_INFINITY, 0]);
    expect(noOp.state).toBe(transition.state);
    expect(noOp.settledSpan.points).toEqual([]);
    expect(noOp.tailSurface).toEqual({ kind: "keep" });
  });

  it("seals taps and tiny strokes deterministically and rejects late input", () => {
    const tap = appendStudioCausalPostCorrection(
      createStudioCausalPostCorrectionState({ strength: 10, preserveCorners: true }),
      [7, 9]
    );
    const sealed = sealStudioCausalPostCorrection(tap.state);

    expect(sealed.finalPoints).toEqual([7, 9]);
    expect(sealed.settledSpan).toEqual({
      anchor: null,
      startSampleIndex: 0,
      points: [7, 9],
    });
    expect(sealed.tailSurface).toEqual({ kind: "clear" });

    const late = appendStudioCausalPostCorrection(sealed.state, [20, 30]);
    expect(late.state).toBe(sealed.state);
    expect(late.tailSurface).toEqual({ kind: "keep" });
    expect(late.finalPoints).toBe(sealed.finalPoints);
    expect(sealStudioCausalPostCorrection(sealed.state).state).toBe(sealed.state);
  });
});
