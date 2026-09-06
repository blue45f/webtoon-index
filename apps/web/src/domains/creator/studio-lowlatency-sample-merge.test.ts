import { describe, expect, it } from "vitest";

import {
  STUDIO_LOWLATENCY_DEFAULT_KEY_WINDOW,
  createStudioLowLatencySampleMerger,
  mergeStudioLowLatencyDeliveries,
  studioLowLatencyStrokeGeometry,
  type StudioLowLatencyDelivery,
  type StudioLowLatencyMergedSample,
  type StudioLowLatencySampleLike,
} from "./studio-lowlatency-sample-merge";

interface TestSample extends StudioLowLatencySampleLike {
  readonly pointerId: number;
  readonly timeStamp: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
}

function sample(
  timeStamp: number,
  clientX: number,
  clientY = 0,
  overrides: Partial<TestSample> = {}
): TestSample {
  return { pointerId: 7, timeStamp, clientX, clientY, pressure: 0.5, ...overrides };
}

function raw(samples: readonly TestSample[], arrivalTimeStamp?: number): StudioLowLatencyDelivery<TestSample> {
  return arrivalTimeStamp === undefined
    ? { channel: "rawupdate", samples }
    : { channel: "rawupdate", samples, arrivalTimeStamp };
}

function coalesced(
  samples: readonly TestSample[],
  arrivalTimeStamp?: number
): StudioLowLatencyDelivery<TestSample> {
  return arrivalTimeStamp === undefined
    ? { channel: "coalesced", samples }
    : { channel: "coalesced", samples, arrivalTimeStamp };
}

function predicted(samples: readonly TestSample[]): StudioLowLatencyDelivery<TestSample> {
  return { channel: "predicted", samples };
}

function roles(records: readonly StudioLowLatencyMergedSample<TestSample>[]): string[] {
  return records.map((record) => record.role);
}

describe("studio low latency sample merge", () => {
  it("passes a coalesced-only stream straight through as durable geometry", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [coalesced([sample(1, 10), sample(2, 20), sample(3, 30)])]
    );

    expect(roles(result.samples)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(result.samples.every((record) => record.promotes === null)).toBe(true);
    expect(studioLowLatencyStrokeGeometry(result.samples)).toEqual({
      durable: [10, 0, 20, 0, 30, 0],
      provisional: [],
      predicted: [],
    });
  });

  it("emits a raw sample immediately and promotes it instead of re-inking it", () => {
    const merger = createStudioLowLatencySampleMerger<TestSample>({ pointerId: 7 });
    const first = merger.ingest(raw([sample(5, 50)], 100));
    const second = merger.ingest(coalesced([sample(5, 50)], 108));

    expect(roles(first.samples)).toEqual(["provisional"]);
    expect(roles(second.samples)).toEqual(["confirmed"]);
    expect(second.samples[0]?.promotes).toBe(first.samples[0]?.sequence);
    // Measured raw lead: the processed stream arrived 8ms after the raw observation.
    expect(second.samples[0]?.promotedLeadMs).toBe(8);
    expect(studioLowLatencyStrokeGeometry([...first.samples, ...second.samples])).toEqual({
      durable: [50, 0],
      provisional: [],
      predicted: [],
    });
  });

  it("backfills hardware samples the raw channel skipped, behind the raw tip", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [raw([sample(5, 50)]), coalesced([sample(3, 30), sample(5, 50)])]
    );

    expect(roles(result.samples)).toEqual(["provisional", "backfill", "confirmed"]);
    expect(result.samples[1]?.promotes).toBeNull();
    expect(result.samples[2]?.promotes).toBe(result.samples[0]?.sequence);
    expect(studioLowLatencyStrokeGeometry(result.samples)).toEqual({
      durable: [30, 0, 50, 0],
      provisional: [],
      predicted: [],
    });
  });

  it("keeps an unconfirmed raw tip renderable but out of the durable path", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [coalesced([sample(1, 10)]), raw([sample(2, 20)])]
    );

    expect(studioLowLatencyStrokeGeometry(result.samples)).toEqual({
      durable: [10, 0],
      provisional: [20, 0],
      predicted: [],
    });
  });

  it("drops repeated raw updates describing the same physical sample", () => {
    const repeated = sample(9, 90);
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [raw([repeated]), raw([{ ...repeated }]), raw([sample(10, 100)])]
    );

    expect(roles(result.samples)).toEqual(["provisional", "provisional"]);
    expect(result.drops).toEqual([
      { channel: "rawupdate", reason: "duplicate", key: "7|9|90|0|0.5" },
    ]);
  });

  it("survives an adversarial raw/coalesced/predicted interleaving without inventing geometry", () => {
    const deliveries: StudioLowLatencyDelivery<TestSample>[] = [
      raw([sample(1, 10)]),
      predicted([sample(4, 40)]),
      raw([sample(2, 20)]),
      coalesced([sample(1, 10), sample(2, 20)]),
      predicted([sample(3, 30), sample(4, 40)]),
      raw([sample(3, 30)]),
      coalesced([sample(2, 20), sample(3, 30), sample(4, 40)]),
    ];

    const result = mergeStudioLowLatencyDeliveries<TestSample>({ pointerId: 7 }, deliveries);

    expect(roles(result.samples)).toEqual([
      "provisional",  // raw t1
      "predicted",    // speculative t4
      "provisional",  // raw t2
      "confirmed",    // promotes raw t1
      "confirmed",    // promotes raw t2
      "predicted",    // speculative t3 (t3 >= watermark 2)
      "predicted",    // speculative t4
      "provisional",  // raw t3
      "confirmed",    // promotes raw t3
      "confirmed",    // genuinely new t4
    ]);
    // The re-delivered t2 was already confirmed by an earlier processed batch, so it is dropped
    // rather than re-entering the stream a second time.
    expect(result.drops).toEqual([
      { channel: "coalesced", reason: "duplicate", key: "7|2|20|0|0.5" },
    ]);

    const geometry = studioLowLatencyStrokeGeometry(result.samples);
    expect(geometry.durable).toEqual([10, 0, 20, 0, 30, 0, 40, 0]);
    expect(geometry.provisional).toEqual([]);
    expect(geometry.predicted).toEqual([]);
  });

  it("never lets a predicted sample become durable or advance the watermark", () => {
    const merger = createStudioLowLatencySampleMerger<TestSample>({ pointerId: 7 });
    merger.ingest(coalesced([sample(1, 10)]));
    const forward = merger.ingest(predicted([sample(5, 50)]));

    expect(merger.getAuthoritativeWatermark()).toBe(1);
    expect(roles(forward.samples)).toEqual(["predicted"]);

    // The same coordinate later arrives as real hardware: it must still become geometry, so the
    // predicted key must never have entered the dedupe window.
    const real = merger.ingest(coalesced([sample(5, 50)]));
    expect(roles(real.samples)).toEqual(["confirmed"]);
    expect(real.samples[0]?.promotes).toBeNull();
    expect(merger.getAuthoritativeWatermark()).toBe(5);
  });

  it("drops predictions that point behind the authoritative watermark", () => {
    const merger = createStudioLowLatencySampleMerger<TestSample>({ pointerId: 7 });
    merger.ingest(coalesced([sample(10, 100)]));
    const stale = merger.ingest(predicted([sample(4, 40), sample(12, 120)]));

    expect(roles(stale.samples)).toEqual(["predicted"]);
    expect(stale.samples[0]?.timeStamp).toBe(12);
    expect(stale.drops).toEqual([
      { channel: "predicted", reason: "predicted-behind-authority", key: "7|4|40|0|0.5" },
    ]);
  });

  it("invalidates the predicted tail generation on every authoritative delivery", () => {
    const merger = createStudioLowLatencySampleMerger<TestSample>({ pointerId: 7 });
    merger.ingest(coalesced([sample(1, 10)]));
    const firstTail = merger.ingest(predicted([sample(2, 20)]));
    const nextAuthority = merger.ingest(coalesced([sample(2, 21)]));
    const secondTail = merger.ingest(predicted([sample(3, 30)]));

    expect(firstTail.predictedTailGeneration).toBeGreaterThan(0);
    expect(nextAuthority.predictedTailGeneration).toBeGreaterThan(firstTail.predictedTailGeneration);
    expect(secondTail.predictedTailGeneration).toBeGreaterThan(nextAuthority.predictedTailGeneration);
    expect(secondTail.samples[0]?.predictedTailGeneration)
      .toBe(secondTail.predictedTailGeneration);
  });

  it("replaces rather than accumulates the predicted tail during reconstruction", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [
        coalesced([sample(1, 10)]),
        predicted([sample(2, 20), sample(3, 30)]),
        predicted([sample(2, 22), sample(3, 33)]),
      ]
    );

    expect(studioLowLatencyStrokeGeometry(result.samples)).toEqual({
      durable: [10, 0],
      provisional: [],
      predicted: [22, 0, 33, 0],
    });
  });

  it("suppresses the whole predicted channel when the caller opts out", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7, acceptPredicted: false },
      [coalesced([sample(1, 10)]), predicted([sample(2, 20)])]
    );

    expect(roles(result.samples)).toEqual(["confirmed"]);
    expect(result.drops).toEqual([
      { channel: "predicted", reason: "predicted-suppressed", key: "7|2|20|0|0.5" },
    ]);
  });

  it("rejects foreign pointers and malformed related-event entries", () => {
    const throwing = {
      pointerId: 7,
      timeStamp: 3,
      get clientX(): number {
        throw new TypeError("detached");
      },
      clientY: 0,
      pressure: 0.5,
    } as unknown as TestSample;

    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [
        coalesced([
          sample(1, 10, 0, { pointerId: 99 }),
          sample(2, Number.NaN),
          throwing,
          null as unknown as TestSample,
          sample(4, 40),
        ]),
      ]
    );

    expect(roles(result.samples)).toEqual(["confirmed"]);
    expect(result.samples[0]?.x).toBe(40);
    expect(result.drops.map((drop) => drop.reason)).toEqual([
      "foreign-pointer",
      "malformed",
      "malformed",
      "malformed",
    ]);
  });

  it("keeps distinct coordinates that share a zero or repeated timestamp", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [coalesced([sample(0, 10), sample(0, 11), sample(0, 12), sample(0, 12)])]
    );

    expect(roles(result.samples)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(studioLowLatencyStrokeGeometry(result.samples).durable)
      .toEqual([10, 0, 11, 0, 12, 0]);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.reason).toBe("duplicate");
  });

  it("preserves delivery order and strictly increasing sequences under regressing timestamps", () => {
    const result = mergeStudioLowLatencyDeliveries<TestSample>(
      { pointerId: 7 },
      [coalesced([sample(9, 90), sample(4, 40), sample(6, 60)])]
    );

    expect(result.samples.map((record) => record.x)).toEqual([90, 40, 60]);
    expect(roles(result.samples)).toEqual(["confirmed", "backfill", "backfill"]);
    for (let index = 1; index < result.samples.length; index += 1) {
      const previous = result.samples[index - 1];
      const current = result.samples[index];
      expect(current?.sequence).toBeGreaterThan(previous?.sequence ?? 0);
    }
  });

  it("produces an identical stream and stroke for a replayed delivery sequence", () => {
    const deliveries: StudioLowLatencyDelivery<TestSample>[] = [
      raw([sample(1, 10)]),
      predicted([sample(3, 30)]),
      coalesced([sample(1, 10), sample(2, 20)]),
      raw([sample(3, 31)]),
      coalesced([sample(2, 20), sample(3, 31), sample(4, 40)]),
      predicted([sample(5, 50)]),
    ];

    const first = mergeStudioLowLatencyDeliveries<TestSample>({ pointerId: 7 }, deliveries);
    const second = mergeStudioLowLatencyDeliveries<TestSample>({ pointerId: 7 }, deliveries);

    expect(second.samples.map(({ sample: _ignored, ...rest }) => rest))
      .toEqual(first.samples.map(({ sample: _ignored, ...rest }) => rest));
    expect(second.drops).toEqual(first.drops);
    expect(studioLowLatencyStrokeGeometry(second.samples))
      .toEqual(studioLowLatencyStrokeGeometry(first.samples));
  });

  it("bounds dedupe memory and stays deterministic once the key window wraps", () => {
    const window = 4;
    const deliveries: StudioLowLatencyDelivery<TestSample>[] = [];
    for (let index = 0; index < 12; index += 1) {
      deliveries.push(coalesced([sample(index, index * 10)]));
    }
    // Re-deliver the very first sample after the window has certainly evicted it.
    deliveries.push(coalesced([sample(0, 0)]));

    const options = { pointerId: 7, keyWindow: window };
    const first = mergeStudioLowLatencyDeliveries<TestSample>(options, deliveries);
    const second = mergeStudioLowLatencyDeliveries<TestSample>(options, deliveries);

    // The evicted key is no longer recognised, so it is re-admitted as a backfill rather than
    // silently dropped. That is the documented cost of a bounded window, and it is deterministic.
    expect(first.samples).toHaveLength(13);
    expect(first.samples[12]?.role).toBe("backfill");
    expect(second.samples.map((record) => record.role))
      .toEqual(first.samples.map((record) => record.role));
    expect(STUDIO_LOWLATENCY_DEFAULT_KEY_WINDOW).toBeGreaterThan(window);
  });

  it("restarts cleanly after reset", () => {
    const merger = createStudioLowLatencySampleMerger<TestSample>({ pointerId: 7 });
    merger.ingest(coalesced([sample(5, 50)]));
    merger.reset();
    const afterReset = merger.ingest(coalesced([sample(5, 50)]));

    expect(merger.getAuthoritativeWatermark()).toBe(5);
    expect(afterReset.samples[0]?.sequence).toBe(1);
    expect(afterReset.samples[0]?.role).toBe("confirmed");
  });
});
