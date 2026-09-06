import { describe, expect, it } from "vitest";

import {
  STUDIO_LATENCY_RECORDER_DEFAULT_CAPACITY,
  StudioLatencyRecorder,
  compareStudioLatencyDistributions,
  studioInputToPresentLatency,
  studioLowLatencyPercentile,
  type StudioLatencyInputSample,
  type StudioLatencyPresent,
} from "./studio-lowlatency-latency-metrics";

describe("studio low latency percentile", () => {
  it("uses nearest rank so every reported value was actually observed", () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    expect(studioLowLatencyPercentile(series, 50)).toBe(5);
    expect(studioLowLatencyPercentile(series, 95)).toBe(10);
    expect(studioLowLatencyPercentile(series, 100)).toBe(10);
    expect(studioLowLatencyPercentile(series, 0)).toBe(1);
    // Never interpolates: 4.5 is not in the series and must never be reported.
    expect(studioLowLatencyPercentile([1, 8], 50)).toBe(1);
  });

  it("clamps hostile percentiles and handles an empty series", () => {
    expect(studioLowLatencyPercentile([], 50)).toBe(0);
    expect(studioLowLatencyPercentile([3, 4], -10)).toBe(3);
    expect(studioLowLatencyPercentile([3, 4], 900)).toBe(4);
    expect(studioLowLatencyPercentile([3, 4], Number.NaN)).toBe(3);
  });
});

describe("studio input to present latency", () => {
  it("computes the distribution over a known timeline", () => {
    // Samples every 4ms; each frame presents at 16ms boundaries carrying everything since the last.
    const inputs: StudioLatencyInputSample[] = [
      { id: "a", timeStamp: 0 },
      { id: "b", timeStamp: 4 },
      { id: "c", timeStamp: 8 },
      { id: "d", timeStamp: 12 },
    ];
    const presents: StudioLatencyPresent[] = [
      { presentedAt: 16, inputIds: ["a", "b", "c", "d"] },
    ];

    const distribution = studioInputToPresentLatency(inputs, presents);

    expect(distribution.count).toBe(4);
    expect(distribution.min).toBe(4);
    expect(distribution.max).toBe(16);
    expect(distribution.mean).toBe(10);
    expect(distribution.p50).toBe(8);
    expect(distribution.p95).toBe(16);
    expect(distribution.unpresented).toBe(0);
    expect(distribution.invalid).toBe(0);
  });

  it("credits the first present that carried a sample, not a later redraw", () => {
    const distribution = studioInputToPresentLatency(
      [{ id: "a", timeStamp: 0 }],
      [
        { presentedAt: 8, inputIds: ["a"] },
        { presentedAt: 24, inputIds: ["a"] },
      ]
    );

    expect(distribution.count).toBe(1);
    expect(distribution.max).toBe(8);
  });

  it("resolves the first present by presentation time, not by collection order", () => {
    const distribution = studioInputToPresentLatency(
      [{ id: "a", timeStamp: 0 }],
      [
        { presentedAt: 30, inputIds: ["a"] },
        { presentedAt: 10, inputIds: ["a"] },
      ]
    );

    expect(distribution.max).toBe(10);
  });

  it("counts samples that were never shown instead of silently improving the average", () => {
    const distribution = studioInputToPresentLatency(
      [
        { id: "a", timeStamp: 0 },
        { id: "dropped", timeStamp: 4 },
      ],
      [{ presentedAt: 16, inputIds: ["a"] }]
    );

    expect(distribution.count).toBe(1);
    expect(distribution.unpresented).toBe(1);
    expect(distribution.mean).toBe(16);
  });

  it("rejects impossible timings rather than reporting negative latency", () => {
    const distribution = studioInputToPresentLatency(
      [
        { id: "future", timeStamp: 100 },
        { id: "ok", timeStamp: 0 },
        { id: "bad", timeStamp: Number.NaN },
      ],
      [
        { presentedAt: 10, inputIds: ["future", "ok"] },
        { presentedAt: Number.POSITIVE_INFINITY, inputIds: ["ok"] },
      ]
    );

    expect(distribution.count).toBe(1);
    expect(distribution.max).toBe(10);
    // One NaN input, one non-finite present, one sample presented before it existed.
    expect(distribution.invalid).toBe(3);
  });

  it("keeps the pessimistic timestamp for a duplicated input id", () => {
    const distribution = studioInputToPresentLatency(
      [
        { id: "a", timeStamp: 5 },
        { id: "a", timeStamp: 0 },
      ],
      [{ presentedAt: 20, inputIds: ["a"] }]
    );

    expect(distribution.count).toBe(1);
    expect(distribution.max).toBe(20);
  });

  it("returns an all-zero distribution for an empty window", () => {
    expect(studioInputToPresentLatency([], [])).toMatchObject({ count: 0, p50: 0, p95: 0, max: 0 });
    expect(studioInputToPresentLatency([{ id: "a", timeStamp: 0 }], []))
      .toMatchObject({ count: 0, unpresented: 1 });
  });
});

describe("studio latency comparison", () => {
  it("reports the deltas and calls an improvement on p95", () => {
    const baseline = studioInputToPresentLatency(
      [
        { id: "a", timeStamp: 0 },
        { id: "b", timeStamp: 0 },
      ],
      [{ presentedAt: 20, inputIds: ["a", "b"] }]
    );
    const candidate = studioInputToPresentLatency(
      [
        { id: "a", timeStamp: 0 },
        { id: "b", timeStamp: 0 },
      ],
      [{ presentedAt: 12, inputIds: ["a", "b"] }]
    );

    const comparison = compareStudioLatencyDistributions(baseline, candidate);

    expect(comparison.p50Delta).toBe(-8);
    expect(comparison.p95Delta).toBe(-8);
    expect(comparison.maxDelta).toBe(-8);
    expect(comparison.meanDelta).toBe(-8);
    expect(comparison.p95Ratio).toBeCloseTo(-0.4, 9);
    expect(comparison.improved).toBe(true);
  });

  it("does not call an unchanged or worse p95 an improvement", () => {
    const flat = studioInputToPresentLatency(
      [{ id: "a", timeStamp: 0 }],
      [{ presentedAt: 10, inputIds: ["a"] }]
    );

    expect(compareStudioLatencyDistributions(flat, flat).improved).toBe(false);
    expect(compareStudioLatencyDistributions(
      flat,
      studioInputToPresentLatency([{ id: "a", timeStamp: 0 }], [{ presentedAt: 30, inputIds: ["a"] }])
    )).toMatchObject({ improved: false, p95Delta: 20 });
  });

  it("avoids dividing by a zero baseline", () => {
    const empty = studioInputToPresentLatency([], []);
    expect(compareStudioLatencyDistributions(empty, empty).p95Ratio).toBe(0);
  });
});

describe("studio latency recorder", () => {
  it("accumulates both timelines and snapshots the distribution", () => {
    const recorder = new StudioLatencyRecorder();
    recorder.recordInput(1, 0);
    recorder.recordInput(2, 4);
    recorder.recordPresent(16, [1, 2]);

    expect(recorder.snapshot()).toMatchObject({ count: 2, min: 12, max: 16 });
    recorder.clear();
    expect(recorder.snapshot().count).toBe(0);
  });

  it("bounds its memory with a FIFO ring", () => {
    const recorder = new StudioLatencyRecorder({ capacity: 2 });
    recorder.recordInput("a", 0);
    recorder.recordInput("b", 1);
    recorder.recordInput("c", 2);
    recorder.recordPresent(10, ["a", "b", "c"]);

    // "a" was evicted, so only the retained inputs are scored.
    expect(recorder.snapshot()).toMatchObject({ count: 2, max: 9 });
    expect(STUDIO_LATENCY_RECORDER_DEFAULT_CAPACITY).toBeGreaterThan(2);
  });

  it("copies the id list so a caller's reused buffer cannot rewrite history", () => {
    const recorder = new StudioLatencyRecorder();
    const ids = ["a"];
    recorder.recordInput("a", 0);
    recorder.recordPresent(8, ids);
    ids[0] = "b";

    expect(recorder.snapshot()).toMatchObject({ count: 1, max: 8 });
  });

  it("falls back to the default capacity for hostile options", () => {
    const recorder = new StudioLatencyRecorder({ capacity: Number.NaN });
    for (let index = 0; index < 10; index += 1) recorder.recordInput(index, index);
    recorder.recordPresent(100, [0]);

    expect(recorder.snapshot()).toMatchObject({ count: 1, unpresented: 9 });
  });
});
