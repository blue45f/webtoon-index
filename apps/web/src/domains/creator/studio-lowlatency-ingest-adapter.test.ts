import { describe, expect, it } from "vitest";

import {
  createStudioLowLatencyPointerIngest,
  type StudioLowLatencyPointerEventLike,
} from "./studio-lowlatency-ingest-adapter";
import { studioLowLatencyStrokeGeometry } from "./studio-lowlatency-sample-merge";

interface FakePointerEvent extends StudioLowLatencyPointerEventLike {
  pointerId: number;
  timeStamp: number;
  clientX: number;
  clientY: number;
  pressure: number;
  getCoalescedEvents?: unknown;
  getPredictedEvents?: unknown;
}

function event(timeStamp: number, clientX: number, clientY = 0): FakePointerEvent {
  return { pointerId: 3, timeStamp, clientX, clientY, pressure: 0.5 };
}

function clock(): () => number {
  let value = 0;
  return () => {
    value += 1;
    return value;
  };
}

describe("studio low latency pointer ingest adapter", () => {
  it("routes an endpoint to its dispatched sample only, never to stale coalescing", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    const down = event(0, 10);
    down.getCoalescedEvents = () => [event(-5, 999), down];

    const result = ingest.ingest(down, "pointerdown");

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.x).toBe(10);
    expect(result.samples[0]?.role).toBe("confirmed");
  });

  it("expands a processed move through its coalesced list", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    const move = event(3, 30);
    move.getCoalescedEvents = () => [event(1, 10), event(2, 20), move];

    const result = ingest.ingest(move, "pointermove");

    expect(result.samples.map((record) => record.x)).toEqual([10, 20, 30]);
    expect(result.samples.every((record) => record.role === "confirmed")).toBe(true);
  });

  it("routes a raw update to the provisional channel and promotes it on the next move", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });

    const raw = ingest.ingest(event(1, 10), "pointerrawupdate");
    const move = event(2, 20);
    move.getCoalescedEvents = () => [event(1, 10), move];
    const processed = ingest.ingest(move, "pointermove");

    expect(raw.samples.map((record) => record.role)).toEqual(["provisional"]);
    expect(processed.samples.map((record) => record.role)).toEqual(["confirmed", "confirmed"]);
    expect(processed.samples[0]?.promotes).toBe(raw.samples[0]?.sequence);
    expect(processed.samples[1]?.promotes).toBeNull();
    expect(studioLowLatencyStrokeGeometry([...raw.samples, ...processed.samples])).toEqual({
      durable: [10, 0, 20, 0],
      provisional: [],
      predicted: [],
    });
  });

  it("measures the lead the raw channel bought using the injected clock", () => {
    let now = 100;
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: () => now,
    });

    const raw = ingest.ingest(event(1, 10), "pointerrawupdate");
    now = 106;
    const move = event(1, 10);
    move.getCoalescedEvents = () => [move];
    const processed = ingest.ingest(move, "pointermove");

    expect(raw.samples[0]?.promotedLeadMs).toBeNull();
    expect(processed.samples[0]?.promotedLeadMs).toBe(6);
  });

  it("never collects predictions from a raw update", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    const raw = event(1, 10);
    raw.getPredictedEvents = () => [event(2, 20)];

    const result = ingest.ingest(raw, "pointerrawupdate");

    expect(result.samples.map((record) => record.role)).toEqual(["provisional"]);
  });

  it("collects predictions from a processed move after its hardware samples", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    const move = event(2, 20);
    move.getCoalescedEvents = () => [event(1, 10), move];
    move.getPredictedEvents = () => [event(3, 30), event(4, 40)];

    const result = ingest.ingest(move, "pointermove");

    expect(result.samples.map((record) => record.role))
      .toEqual(["confirmed", "confirmed", "predicted", "predicted"]);
    expect(studioLowLatencyStrokeGeometry(result.samples)).toEqual({
      durable: [10, 0, 20, 0],
      provisional: [],
      predicted: [30, 0, 40, 0],
    });
  });

  it("suppresses the predicted channel entirely when disabled", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      acceptPredicted: false,
      now: clock(),
    });
    const move = event(2, 20);
    move.getPredictedEvents = () => [event(3, 30)];

    const result = ingest.ingest(move, "pointermove");

    expect(result.samples.map((record) => record.role)).toEqual(["confirmed"]);
    expect(result.drops).toHaveLength(0);
  });

  it("falls back to the dispatched event when the related-event APIs misbehave", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });

    const throwing = event(1, 10);
    throwing.getCoalescedEvents = () => {
      throw new TypeError("detached");
    };
    throwing.getPredictedEvents = () => {
      throw new TypeError("detached");
    };
    expect(ingest.ingest(throwing, "pointermove").samples.map((record) => record.x)).toEqual([10]);

    const nonArray = event(2, 20);
    nonArray.getCoalescedEvents = () => ({ length: 3 });
    expect(ingest.ingest(nonArray, "pointermove").samples.map((record) => record.x)).toEqual([20]);

    const withJunk = event(3, 30);
    withJunk.getCoalescedEvents = () => [null, 42, "junk", withJunk];
    expect(ingest.ingest(withJunk, "pointermove").samples.map((record) => record.x)).toEqual([30]);
  });

  it("drops a foreign pointer's samples without disturbing the session", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    ingest.ingest(event(1, 10), "pointermove");

    const foreign: FakePointerEvent = { ...event(2, 999), pointerId: 9 };
    const foreignResult = ingest.ingest(foreign, "pointermove");
    const own = ingest.ingest(event(3, 30), "pointermove");

    expect(foreignResult.samples).toHaveLength(0);
    expect(foreignResult.drops.map((drop) => drop.reason)).toEqual(["foreign-pointer"]);
    expect(own.samples.map((record) => record.x)).toEqual([30]);
  });

  it("produces an identical stream for a replayed gesture", () => {
    const replay = () => {
      const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
        pointerId: 3,
        now: clock(),
      });
      const records: { role: string; x: number; sequence: number }[] = [];
      const push = (item: FakePointerEvent, kind: "pointerdown" | "pointerrawupdate" | "pointermove" | "pointerup") => {
        for (const record of ingest.ingest(item, kind).samples) {
          records.push({ role: record.role, x: record.x, sequence: record.sequence });
        }
      };

      push(event(0, 0), "pointerdown");
      push(event(1, 10), "pointerrawupdate");
      const move = event(2, 20);
      move.getCoalescedEvents = () => [event(1, 10), move];
      move.getPredictedEvents = () => [event(3, 30)];
      push(move, "pointermove");
      push(event(3, 30), "pointerrawupdate");
      push(event(4, 40), "pointerup");
      return records;
    };

    expect(replay()).toEqual(replay());
    expect(replay().length).toBeGreaterThan(4);
  });

  it("restarts cleanly after reset", () => {
    const ingest = createStudioLowLatencyPointerIngest<FakePointerEvent>({
      pointerId: 3,
      now: clock(),
    });
    ingest.ingest(event(1, 10), "pointermove");
    ingest.reset();

    const afterReset = ingest.ingest(event(1, 10), "pointermove");
    expect(afterReset.samples[0]?.sequence).toBe(1);
    expect(ingest.getMerger().getAuthoritativeWatermark()).toBe(1);
  });
});
