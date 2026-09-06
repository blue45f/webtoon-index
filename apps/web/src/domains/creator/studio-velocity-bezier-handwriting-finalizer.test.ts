import { describe, expect, it } from "vitest";

import {
  STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS,
  appendStudioVelocityBezierHandwritingSamples,
  createStudioVelocityBezierHandwritingStream,
  finalizeStudioVelocityBezierHandwriting,
  sealStudioVelocityBezierHandwritingStream,
  type StudioVelocityBezierFinalizerOptions,
  type StudioVelocityBezierSourceSample,
  type StudioVelocityBezierStreamState,
} from "./studio-velocity-bezier-handwriting-finalizer";

function sample(
  sequence: number,
  x: number,
  y: number,
  timeMilliseconds: number,
  pressure = 0.5,
  source: StudioVelocityBezierSourceSample["pressureProvenance"]["source"] = "hardware",
): StudioVelocityBezierSourceSample {
  return {
    sequence,
    x,
    y,
    timeMilliseconds,
    pressure,
    pressureProvenance: {
      source,
      sourceSequence: sequence + 100,
      inputPressure: source === "hardware" ? pressure : 0.5,
      resolvedPressure: pressure,
    },
  };
}

function expectSuccess<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
}

function segmentGeometry(
  value: Extract<
    ReturnType<typeof finalizeStudioVelocityBezierHandwriting>,
    { ok: true }
  >["value"],
) {
  return value.segments.map(({ lifecycle: _lifecycle, ...segment }) => segment);
}

describe("studio-velocity-bezier-handwriting-finalizer", () => {
  it("creates an immutable, bounded tap while retaining exact pressure provenance", () => {
    const source = sample(7, 12, 18, 4, 0.23, "hardware");
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "tap",
      samples: [source],
      phase: "committed",
    });
    expectSuccess(result);

    expect(result.value.segments).toHaveLength(0);
    expect(result.value.settledSegmentCount).toBe(0);
    expect(result.value.tap).toMatchObject({
      sequence: 7,
      x: 12,
      y: 18,
      pressure: 0.23,
    });
    expect(result.value.sourceSamples[0]?.pressureProvenance).toEqual(
      source.pressureProvenance,
    );
    expect(result.value.knots[0]?.pressureProvenance).toBe(
      result.value.sourceSamples[0]?.pressureProvenance,
    );
    expect(result.value.tap?.pressureProvenance).toBe(
      result.value.sourceSamples[0]?.pressureProvenance,
    );
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.sourceSamples)).toBe(true);
    expect(Object.isFrozen(result.value.sourceSamples[0]!)).toBe(true);
    expect(Object.isFrozen(result.value.sourceSamples[0]!.pressureProvenance)).toBe(true);
    expect(result.value.bounds).toEqual({
      minX: 11.3475,
      minY: 17.3475,
      maxX: 12.6525,
      maxY: 18.6525,
    });
  });

  it("represents a two-sample short stroke as one finite cubic", () => {
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "short",
      samples: [sample(0, 0, 0, 0), sample(1, 12, 6, 8)],
      phase: "committed",
    });
    expectSuccess(result);

    expect(result.value.tap).toBeNull();
    expect(result.value.segments).toHaveLength(1);
    expect(result.value.segments[0]).toMatchObject({
      lifecycle: "settled",
      fromSequence: 0,
      toSequence: 1,
      p0: { x: 0, y: 0 },
      p3: { x: 12, y: 6 },
    });
    for (const coordinate of [
      result.value.segments[0]!.c1.x,
      result.value.segments[0]!.c1.y,
      result.value.segments[0]!.c2.x,
      result.value.segments[0]!.c2.y,
    ]) {
      expect(Number.isFinite(coordinate)).toBe(true);
    }
  });

  it("keeps every source pressure and provenance record instead of interpolating ownership", () => {
    const samples = [
      sample(3, 0, 0, 0, 0.12, "hardware"),
      sample(8, 4, 3, 5, 0.91, "velocity"),
      sample(15, 10, 5, 11, 0.42, "nominal"),
      sample(21, 14, 9, 16, 0.77, "canonical"),
    ];
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "provenance",
      samples,
      phase: "committed",
    });
    expectSuccess(result);

    expect(result.value.sourceSamples.map((entry) => entry.pressure)).toEqual(
      samples.map((entry) => entry.pressure),
    );
    expect(result.value.knots.map((entry) => entry.pressure)).toEqual([
      0.12,
      0.91,
      0.42,
      0.77,
    ]);
    for (let index = 0; index < samples.length; index += 1) {
      expect(result.value.sourceSamples[index]?.pressureProvenance).toEqual(
        samples[index]?.pressureProvenance,
      );
      expect(result.value.knots[index]?.pressureProvenance).toBe(
        result.value.sourceSamples[index]?.pressureProvenance,
      );
    }
  });

  it("uses source pressure for hardware/canonical input and causal velocity fallback otherwise", () => {
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "width-policy",
      samples: [
        sample(0, 0, 0, 0, 0.2, "hardware"),
        sample(1, 20, 0, 10, 0.2, "velocity"),
        sample(2, 21, 0, 20, 0.8, "canonical"),
      ],
      options: {
        minimumWidth: 0,
        maximumWidth: 10,
        maximumVelocity: 2,
        velocityFilterWeight: 1,
        minimumVelocityPressure: 0.1,
      },
      phase: "committed",
    });
    expectSuccess(result);

    expect(result.value.knots[0]?.width).toBeCloseTo(2);
    // 2 px/ms reaches the kinematic floor: 0.1 * 10.
    expect(result.value.knots[1]?.width).toBeCloseTo(1);
    expect(result.value.knots[2]?.width).toBeCloseTo(8);
  });

  it.each([
    ["velocity", [10, 1, 9.55]],
    ["source-pressure", [2, 2, 8]],
  ] as const)("supports the explicit %s width strategy", (widthStrategy, expected) => {
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: widthStrategy,
      samples: [
        sample(0, 0, 0, 0, 0.2, "hardware"),
        sample(1, 20, 0, 10, 0.2, "velocity"),
        sample(2, 21, 0, 20, 0.8, "canonical"),
      ],
      options: {
        minimumWidth: 0,
        maximumWidth: 10,
        maximumVelocity: 2,
        velocityFilterWeight: 1,
        minimumVelocityPressure: 0.1,
        widthStrategy,
      },
      phase: "committed",
    });
    expectSuccess(result);
    result.value.knots.forEach((knot, index) => {
      expect(knot.width).toBeCloseTo(expected[index]!);
    });
  });

  it("filters velocity causally and preserves old knots when a sample is appended", () => {
    const first = finalizeStudioVelocityBezierHandwriting({
      strokeId: "causal",
      samples: [
        sample(0, 0, 0, 0, 0.5, "velocity"),
        sample(1, 8, 0, 8, 0.5, "velocity"),
        sample(2, 24, 0, 16, 0.5, "velocity"),
      ],
      options: { velocityFilterWeight: 0.5 },
    });
    const appended = finalizeStudioVelocityBezierHandwriting({
      strokeId: "causal",
      samples: [
        sample(0, 0, 0, 0, 0.5, "velocity"),
        sample(1, 8, 0, 8, 0.5, "velocity"),
        sample(2, 24, 0, 16, 0.5, "velocity"),
        sample(3, 25, 2, 24, 0.5, "velocity"),
      ],
      options: { velocityFilterWeight: 0.5 },
    });
    expectSuccess(first);
    expectSuccess(appended);

    expect(first.value.knots.map((knot) => knot.filteredVelocity)).toEqual([0, 0.5, 1.25]);
    expect(appended.value.knots.slice(0, 3)).toEqual(first.value.knots);
  });

  it("keeps settled geometry prefix-stable and only replaces the live tail", () => {
    const samples = [
      sample(0, 0, 0, 0),
      sample(1, 8, 1, 8),
      sample(2, 17, 7, 16),
      sample(3, 25, 4, 24),
    ];
    const before = finalizeStudioVelocityBezierHandwriting({
      strokeId: "prefix",
      samples,
    });
    const after = finalizeStudioVelocityBezierHandwriting({
      strokeId: "prefix",
      samples: [...samples, sample(4, 36, 10, 32)],
    });
    expectSuccess(before);
    expectSuccess(after);

    expect(before.value.settledSegmentCount).toBe(2);
    expect(before.value.previewSegments).toHaveLength(1);
    expect(after.value.settledSegmentCount).toBe(3);
    expect(after.value.previewSegments).toHaveLength(1);
    expect(after.value.segments.slice(0, before.value.settledSegmentCount)).toEqual(
      before.value.settledSegments,
    );
    expect(before.value.segments.at(-1)?.lifecycle).toBe("preview");
    expect(after.value.segments.at(-2)?.lifecycle).toBe("settled");
  });

  it("sealing changes lifecycle only, so live tail and committed replay render identically", () => {
    const samples = [
      sample(0, 0, 0, 0),
      sample(1, 5, 3, 4),
      sample(2, 13, 11, 9),
      sample(3, 21, 7, 15),
    ];
    const preview = finalizeStudioVelocityBezierHandwriting({
      strokeId: "seal-geometry",
      samples,
      phase: "preview",
    });
    const committed = finalizeStudioVelocityBezierHandwriting({
      strokeId: "seal-geometry",
      samples,
      phase: "committed",
    });
    expectSuccess(preview);
    expectSuccess(committed);

    expect(segmentGeometry(committed.value)).toEqual(segmentGeometry(preview.value));
    expect(committed.value.previewSegments).toHaveLength(0);
    expect(committed.value.settledSegmentCount).toBe(committed.value.segments.length);
  });

  it("matches immutable one-sample streaming with a sealed batch exactly", () => {
    const samples = Array.from({ length: 24 }, (_, index) =>
      sample(
        index * 3,
        index * 2.25,
        Math.sin(index / 3) * 12,
        index * 7,
        0.15 + (index % 7) * 0.1,
        index % 3 === 0 ? "hardware" : "velocity",
      ),
    );
    const options: StudioVelocityBezierFinalizerOptions = {
      velocityFilterWeight: 0.61,
      maximumVelocity: 3.2,
      minimumVelocityPressure: 0.04,
      minimumWidth: 0.25,
      maximumWidth: 9,
      handleTension: 0.74,
      maximumHandleRatio: 0.68,
    };
    const created = createStudioVelocityBezierHandwritingStream("parity", options);
    expectSuccess(created);
    let state: StudioVelocityBezierStreamState = created.state;
    let priorState = state;
    for (const next of samples) {
      const advanced = appendStudioVelocityBezierHandwritingSamples(state, [next]);
      expectSuccess(advanced);
      expect(advanced.state).not.toBe(state);
      expect(state).toBe(priorState);
      priorState = advanced.state;
      state = advanced.state;
    }
    const sealed = sealStudioVelocityBezierHandwritingStream(state);
    expectSuccess(sealed);
    const batch = finalizeStudioVelocityBezierHandwriting({
      strokeId: "parity",
      samples,
      options,
      phase: "committed",
    });
    expectSuccess(batch);

    expect(sealed.path).toEqual(batch.value);
    expect(sealed.state.sealed).toBe(true);
    expect(Object.isFrozen(sealed.state)).toBe(true);
    expect(sealed.state.metrics).toEqual({
      acceptedSamples: samples.length,
      // One live tail is evaluated per transition after the first, and each segment settles once.
      evaluatedSegments: samples.length * 2 - 3,
      appendTransitions: samples.length,
      branchPrefixCopies: 0,
    });
    expect(
      appendStudioVelocityBezierHandwritingSamples(sealed.state, [sample(100, 1, 1, 999)]),
    ).toEqual({ ok: false, reason: "sealed-stream" });
  });

  it("keeps old snapshots immutable and copies a prefix only when an older state is branched", () => {
    const created = createStudioVelocityBezierHandwritingStream("branching");
    expectSuccess(created);
    const trunk = appendStudioVelocityBezierHandwritingSamples(created.state, [
      sample(0, 0, 0, 0),
      sample(1, 4, 1, 4),
      sample(2, 8, 3, 8),
      sample(3, 12, 1, 12),
    ]);
    expectSuccess(trunk);
    const trunkSnapshot = trunk.path.sourceSamples.map((entry) => entry.sequence);
    const forward = appendStudioVelocityBezierHandwritingSamples(trunk.state, [
      sample(4, 16, 2, 16),
      sample(5, 20, 4, 20),
    ]);
    expectSuccess(forward);
    const branch = appendStudioVelocityBezierHandwritingSamples(trunk.state, [
      sample(40, 13, -4, 17),
      sample(41, 14, -8, 22),
    ]);
    expectSuccess(branch);

    expect(trunk.path.sourceSamples.map((entry) => entry.sequence)).toEqual(trunkSnapshot);
    expect(forward.path.sourceSamples.map((entry) => entry.sequence)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(branch.path.sourceSamples.map((entry) => entry.sequence)).toEqual([
      0, 1, 2, 3, 40, 41,
    ]);
    expect(forward.state.metrics.branchPrefixCopies).toBe(0);
    expect(branch.state.metrics.branchPrefixCopies).toBeGreaterThan(0);
    expect(Object.isFrozen(trunk.path.sourceSamples)).toBe(true);
    expect(() => {
      (trunk.path.sourceSamples as StudioVelocityBezierSourceSample[])[0] =
        sample(99, 0, 0, 0);
    }).toThrow();
  });

  it(
    "admits a 65k long stroke incrementally with linear work and rejects one extra sample",
    () => {
      const maximum = STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSamples;
      const chunkSize = 1_024;
      const created = createStudioVelocityBezierHandwritingStream("long-stroke");
      expectSuccess(created);
      let state = created.state;
      let latestPath = created.path;
      const startedAt = performance.now();

      for (let offset = 0; offset < maximum; offset += chunkSize) {
        const count = Math.min(chunkSize, maximum - offset);
        const chunk = Array.from({ length: count }, (_, localIndex) => {
          const index = offset + localIndex;
          return sample(
            index,
            index * 0.25,
            Math.sin(index / 23) * 18,
            index * 2,
            0.2 + (index % 13) * 0.05,
            index % 4 === 0 ? "hardware" : "velocity",
          );
        });
        const advanced = appendStudioVelocityBezierHandwritingSamples(state, chunk);
        expectSuccess(advanced);
        state = advanced.state;
        latestPath = advanced.path;
      }
      const elapsedMilliseconds = performance.now() - startedAt;
      const transitions = Math.ceil(maximum / chunkSize);

      expect(state.samples).toHaveLength(maximum);
      expect(latestPath.knots).toHaveLength(maximum);
      expect(latestPath.segments).toHaveLength(maximum - 1);
      expect(latestPath.settledSegmentCount).toBe(maximum - 2);
      expect(latestPath.previewSegments).toHaveLength(1);
      expect(state.metrics).toEqual({
        acceptedSamples: maximum,
        // N-2 settled segments plus one preview per non-empty chunk.
        evaluatedSegments: maximum - 2 + transitions,
        appendTransitions: transitions,
        branchPrefixCopies: 0,
      });
      // Deliberately generous CI ceiling: an O(N²) full-prefix replan cannot satisfy this at 65k.
      expect(elapsedMilliseconds).toBeLessThan(8_000);

      const rejected = appendStudioVelocityBezierHandwritingSamples(state, [
        sample(maximum, maximum * 0.25, 0, maximum * 2),
      ]);
      expect(rejected).toEqual({ ok: false, reason: "budget-exceeded" });
      expect(state.samples).toHaveLength(maximum);
    },
    15_000,
  );

  it("does not mutate source arrays or nested provenance", () => {
    const provenance = {
      source: "hardware" as const,
      sourceSequence: 4,
      inputPressure: 0.34,
      resolvedPressure: 0.34,
    };
    const source = {
      sequence: 4,
      x: 1,
      y: 2,
      timeMilliseconds: 3,
      pressure: 0.34,
      pressureProvenance: provenance,
    };
    const samples = [source];
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "no-mutation",
      samples,
    });
    expectSuccess(result);

    expect(Object.isFrozen(samples)).toBe(false);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(provenance)).toBe(false);
    expect(result.value.sourceSamples).not.toBe(samples);
    expect(result.value.sourceSamples[0]).not.toBe(source);
    expect(result.value.sourceSamples[0]?.pressureProvenance).not.toBe(provenance);
  });

  it.each([
    [{ velocityFilterWeight: Number.NaN }, "invalid-options"],
    [{ velocityFilterWeight: 2 }, "invalid-options"],
    [{ maximumVelocity: 0 }, "invalid-options"],
    [{ minimumWidth: 5, maximumWidth: 4 }, "invalid-options"],
    [{ handleTension: Number.POSITIVE_INFINITY }, "invalid-options"],
    [{ maximumHandleRatio: -1 }, "invalid-options"],
    [{ maximumSamples: 0 }, "invalid-options"],
  ] as const)("rejects invalid options fail-closed: %o", (options, reason) => {
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "bad-options",
        samples: [sample(0, 0, 0, 0)],
        options,
      }),
    ).toEqual({ ok: false, reason });
  });

  it.each([
    [{ ...sample(0, 0, 0, 0), x: Number.NaN }, "invalid-sample"],
    [{ ...sample(0, 0, 0, 0), pressure: 1.1 }, "invalid-sample"],
    [
      {
        ...sample(0, 0, 0, 0),
        pressureProvenance: {
          ...sample(0, 0, 0, 0).pressureProvenance,
          resolvedPressure: 0.8,
        },
      },
      "pressure-provenance-mismatch",
    ],
  ] as const)("rejects corrupt samples fail-closed: %o", (badSample, reason) => {
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "bad-sample",
        samples: [badSample],
      }),
    ).toEqual({ ok: false, reason, sampleIndex: 0 });
  });

  it("rejects reverse/duplicate sequence or regressing time with the exact sample index", () => {
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "order",
        samples: [sample(4, 0, 0, 4), sample(4, 2, 1, 5)],
      }),
    ).toEqual({ ok: false, reason: "sample-order", sampleIndex: 1 });
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "time-order",
        samples: [sample(4, 0, 0, 4), sample(5, 2, 1, 3)],
      }),
    ).toEqual({ ok: false, reason: "sample-order", sampleIndex: 1 });
  });

  it("handles same-time duplicate positions and movement without NaN or Infinity", () => {
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "same-time",
      samples: [
        sample(0, 0, 0, 1, 0.5, "velocity"),
        sample(1, 0, 0, 1, 0.5, "velocity"),
        sample(2, 10, 0, 1, 0.5, "velocity"),
        sample(3, 20, 2, 2, 0.5, "velocity"),
      ],
      phase: "committed",
    });
    expectSuccess(result);
    for (const knot of result.value.knots) {
      expect(Number.isFinite(knot.instantaneousVelocity)).toBe(true);
      expect(Number.isFinite(knot.filteredVelocity)).toBe(true);
      expect(Number.isFinite(knot.width)).toBe(true);
    }
    for (const segment of result.value.segments) {
      expect(
        [
          segment.p0.x,
          segment.p0.y,
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
          segment.p3.x,
          segment.p3.y,
        ].every(Number.isFinite),
      ).toBe(true);
    }
  });

  it("clamps cubic handles to the configured local-chord ratio", () => {
    const ratio = 0.2;
    const result = finalizeStudioVelocityBezierHandwriting({
      strokeId: "handle-bound",
      samples: [
        sample(0, 0, 0, 0),
        sample(1, 100, 0, 10),
        sample(2, 100.01, 100, 20),
        sample(3, 101, 100, 30),
      ],
      options: {
        handleTension: 1,
        maximumHandleRatio: ratio,
      },
      phase: "committed",
    });
    expectSuccess(result);

    for (const segment of result.value.segments) {
      const chord = Math.hypot(segment.p3.x - segment.p0.x, segment.p3.y - segment.p0.y);
      const startHandle = Math.hypot(
        segment.c1.x - segment.p0.x,
        segment.c1.y - segment.p0.y,
      );
      const endHandle = Math.hypot(
        segment.c2.x - segment.p3.x,
        segment.c2.y - segment.p3.y,
      );
      expect(startHandle).toBeLessThanOrEqual(chord * ratio + 1e-10);
      expect(endHandle).toBeLessThanOrEqual(chord * ratio + 1e-10);
    }
  });

  it("fails admission before processing a global or caller-defined oversized journal", () => {
    const one = sample(0, 0, 0, 0);
    const globalOversized = Array(
      STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSamples + 1,
    ).fill(one) as StudioVelocityBezierSourceSample[];
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "global-budget",
        samples: globalOversized,
      }),
    ).toEqual({ ok: false, reason: "budget-exceeded" });
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "local-budget",
        samples: [one, sample(1, 1, 1, 1), sample(2, 2, 2, 2)],
        options: { maximumSamples: 2 },
      }),
    ).toEqual({ ok: false, reason: "budget-exceeded" });
  });

  it("rejects malformed identifiers and keeps an empty preview stream valid", () => {
    expect(
      finalizeStudioVelocityBezierHandwriting({
        strokeId: "",
        samples: [],
      }),
    ).toEqual({ ok: false, reason: "invalid-identifier" });
    const created = createStudioVelocityBezierHandwritingStream("empty");
    expectSuccess(created);
    expect(created.path.sourceSamples).toHaveLength(0);
    expect(created.path.bounds).toBeNull();
    expect(created.path.tap).toBeNull();
    expect(Object.isFrozen(created.state.samples)).toBe(true);
  });
});
