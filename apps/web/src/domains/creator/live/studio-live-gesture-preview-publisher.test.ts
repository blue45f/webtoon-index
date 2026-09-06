import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE,
  type StudioLiveGesturePreviewPayload,
} from "./studio-live-gesture-preview";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_BYTE_BURST,
  STUDIO_LIVE_GESTURE_PREVIEW_BYTE_REFILL_PER_SECOND,
  STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS,
  StudioLiveGesturePreviewPublisher,
  planStudioLiveGesturePreviewBegin,
  type StudioLiveGesturePreviewPublisherByteBudgetOptions,
  type StudioLiveGesturePreviewPublisherScheduler,
} from "./studio-live-gesture-preview-publisher";

import type { DrawEl } from "../studio-element-model";

class ManualScheduler implements StudioLiveGesturePreviewPublisherScheduler {
  #now = 1_000;
  #nextHandle = 1;
  #tasks = new Map<number, { readonly dueAt: number; readonly callback: () => void }>();

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#tasks.set(handle, { dueAt: this.#now + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.#tasks.delete(handle as number);
  }

  advance(milliseconds: number): void {
    const target = this.#now + milliseconds;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [handle, task] = next;
      this.#tasks.delete(handle);
      this.#now = task.dueAt;
      task.callback();
    }
    this.#now = target;
  }
}

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  const points = overrides.points ?? [10, 20];
  const sampleCount = points.length / 2;
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    stroke: "#224466",
    strokeWidth: 12,
    opacity: 0.7,
    brush: "watercolor-round",
    brushCatalogId: "watercolor-round-v2",
    brushCatalogName: "둥근 수채",
    sampleSpacing: 2,
    blendMode: "multiply",
    pressures: overrides.pressures ?? Array.from({ length: sampleCount }, (_, index) => 0.4 + index * 0.01),
    watercolorPipeline: "causal-walker-v2",
    ...overrides,
  };
}

function denseStroke(count: number): DrawEl {
  const points = Array.from({ length: count * 2 }, (_, index) => (
    index % 2 === 0 ? index * 0.123456789012345 : index * 0.234567890123456
  ));
  const values = Array.from({ length: count }, () => 0.456789012345678);
  return stroke({
    points,
    pressures: values,
    tiltXs: values.map(() => 12.3456789012345),
    tiltYs: values.map(() => -12.3456789012345),
    twists: values.map(() => 123.456789012345),
    speeds: values.map(() => 1234.56789012345),
    tangentialPressures: values,
    altitudeAngles: values,
    azimuthAngles: values,
    contactWidths: values,
    contactHeights: values,
    sampleTimeOffsets: values.map((_, index) => index),
  });
}

function payloadBytes(payload: StudioLiveGesturePreviewPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function twoSampleFixture() {
  const initial = stroke();
  const updated = stroke({
    points: [10, 20, 12, 22],
    pressures: [0.4, 0.5],
  });
  const begin = planStudioLiveGesturePreviewBegin({
    pageId: "page-1",
    documentGeneration: 1,
    element: initial,
  });
  if (!begin) throw new Error("Expected a valid begin fixture.");
  const append: StudioLiveGesturePreviewPayload = {
    version: 1,
    gestureId: initial.id,
    pageId: "page-1",
    seq: 2,
    phase: "append",
    operation: "draw",
    samples: { startIndex: 1, points: [12, 22], pressures: [0.5] },
  };
  const end: StudioLiveGesturePreviewPayload = {
    version: 1,
    gestureId: initial.id,
    pageId: "page-1",
    seq: 3,
    phase: "end",
    operation: "draw",
  };
  const cancel: StudioLiveGesturePreviewPayload = {
    ...end,
    seq: 2,
    phase: "cancel",
  };
  return { initial, updated, begin, append, end, cancel };
}

function createHarness(
  accept: (payload: StudioLiveGesturePreviewPayload) => boolean = () => true,
  byteBudget?: StudioLiveGesturePreviewPublisherByteBudgetOptions,
) {
  const scheduler = new ManualScheduler();
  const sent: StudioLiveGesturePreviewPayload[] = [];
  const sentAt: number[] = [];
  const publisher = new StudioLiveGesturePreviewPublisher({
    scheduler,
    ...(byteBudget ? { byteBudget } : {}),
    publish: (payload) => {
      sent.push(payload);
      sentAt.push(scheduler.now());
      return accept(payload);
    },
  });
  return { publisher, scheduler, sent, sentAt };
}

describe("studio live gesture preview publisher", () => {
  it("plans detached begin packets for draw, erase, lasso-fill, and shape operations", () => {
    const cases: Array<{ readonly element: DrawEl; readonly operation: string }> = [
      { element: stroke(), operation: "draw" },
      { element: stroke({ mode: "eraser", brush: "hard-eraser" }), operation: "erase" },
      { element: stroke({ fill: "#224466" }), operation: "lasso-fill" },
      {
        element: stroke({
          kind: "rect",
          points: [10, 20, 80, 120],
          fill: "#ffeeaa",
          pressures: [0.4, 0.4],
        }),
        operation: "shape",
      },
    ];

    for (const { element, operation } of cases) {
      const planned = planStudioLiveGesturePreviewBegin({
        pageId: "page-1",
        documentGeneration: 9,
        element,
      });
      expect(planned).toMatchObject({
        gestureId: element.id,
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation,
        base: { documentGeneration: 9 },
      });
      expect(planned?.renderer).not.toBe(element);
    }

    const source = stroke();
    const planned = planStudioLiveGesturePreviewBegin({
      pageId: "page-1",
      documentGeneration: 9,
      element: source,
    });
    source.points[0] = 999;
    source.pressures![0] = 1;
    expect(planned?.samples?.points[0]).toBe(10);
    expect(planned?.samples?.pressures?.[0]).toBe(0.4);
  });

  it("publishes begin immediately and coalesces only the unsent authoritative suffix at 25 Hz", () => {
    const { publisher, scheduler, sent } = createHarness();
    const first = stroke();
    expect(publisher.begin({ pageId: "page-1", documentGeneration: 2, element: first })).toBe(true);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin"]);

    const third = stroke({
      points: [10, 20, 12, 22, 14, 24],
      pressures: [0.4, 0.5, 0.6],
    });
    expect(publisher.append(third, 1)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    scheduler.advance(1);
    expect(sent[1]).toMatchObject({
      seq: 2,
      phase: "append",
      samples: {
        startIndex: 1,
        points: [12, 22, 14, 24],
        pressures: [0.5, 0.6],
      },
    });

    const fourth = stroke({
      points: [10, 20, 12, 22, 14, 24, 16, 26],
      pressures: [0.4, 0.5, 0.6, 0.7],
    });
    expect(publisher.end(fourth)).toBe(true);
    expect(sent).toHaveLength(2);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS - 1);
    expect(sent).toHaveLength(2);
    scheduler.advance(1);
    expect(sent.slice(2)).toMatchObject([
      { seq: 3, phase: "append", samples: { startIndex: 3, points: [16, 26] } },
      { seq: 4, phase: "end" },
    ]);
    expect(publisher.activeGestureId).toBeNull();
  });

  it("coalesces shape endpoint replacement and skips an unchanged endpoint", () => {
    const { publisher, scheduler, sent } = createHarness();
    const initial = stroke({ kind: "rect", points: [10, 20, 10, 20], pressures: [0.5, 0.5] });
    expect(publisher.begin({ pageId: "page-1", documentGeneration: 1, element: initial })).toBe(true);

    const intermediate = stroke({ kind: "rect", points: [10, 20, 40, 50], pressures: [0.5, 0.5] });
    const latest = stroke({ kind: "rect", points: [10, 20, 80, 90], pressures: [0.5, 0.5] });
    expect(publisher.replaceShape(intermediate)).toBe(true);
    expect(publisher.replaceShape(latest)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent).toMatchObject([
      { seq: 1, phase: "begin", shape: { x1: 10, y1: 20 } },
      { seq: 2, phase: "replace", shape: { x1: 80, y1: 90 } },
    ]);

    expect(publisher.replaceShape(latest)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    expect(publisher.end(latest)).toBe(true);
    scheduler.advance(0);
    expect(sent.at(-1)).toMatchObject({ seq: 3, phase: "end", operation: "shape" });
  });

  it("chunks large suffixes without overlap and keeps every packet under the byte cap", () => {
    const { publisher, scheduler, sent } = createHarness();
    const initial = stroke({
      tiltXs: [0],
      tiltYs: [0],
      twists: [0],
      speeds: [0],
      tangentialPressures: [0],
      altitudeAngles: [1],
      azimuthAngles: [1],
      contactWidths: [1],
      contactHeights: [1],
      sampleTimeOffsets: [0],
    });
    expect(publisher.begin({ pageId: "page-1", documentGeneration: 1, element: initial })).toBe(true);

    const count = 1_201;
    const points = Array.from({ length: count * 2 }, (_, index) => (
      index % 2 === 0 ? index * 0.123456789012345 : index * 0.234567890123456
    ));
    const values = Array.from({ length: count }, () => 0.456789012345678);
    const large = stroke({
      points,
      pressures: values,
      tiltXs: values.map(() => 12.3456789012345),
      tiltYs: values.map(() => -12.3456789012345),
      twists: values.map(() => 123.456789012345),
      speeds: values.map(() => 1234.56789012345),
      tangentialPressures: values,
      altitudeAngles: values,
      azimuthAngles: values,
      contactWidths: values,
      contactHeights: values,
      sampleTimeOffsets: values.map((_, index) => index),
    });
    expect(publisher.append(large, 1)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS * 20);

    const appends = sent.filter((payload) => payload.phase === "append");
    expect(appends.length).toBeGreaterThan(2);
    let expectedStart = 1;
    for (const payload of appends) {
      const samples = payload.samples!;
      const sampleCount = samples.points.length / 2;
      expect(samples.startIndex).toBe(expectedStart);
      expect(sampleCount).toBeLessThanOrEqual(STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE);
      expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength)
        .toBeLessThanOrEqual(STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES);
      expectedStart += sampleCount;
    }
    expect(expectedStart).toBe(count);
  });

  it("serializes oversized suffix chunks across preview clock ticks", () => {
    const { publisher, scheduler, sent } = createHarness();
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(true);
    const count = STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE * 2 + 2;
    const large = stroke({
      points: Array.from({ length: count * 2 }, (_, index) => index),
      pressures: Array.from({ length: count }, () => 0.5),
    });
    expect(publisher.append(large, 1)).toBe(true);

    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent.filter((payload) => payload.phase === "append")).toHaveLength(1);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent.filter((payload) => payload.phase === "append")).toHaveLength(2);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent.filter((payload) => payload.phase === "append")).toHaveLength(3);
  });

  it("holds a one-byte-short packet intact until the exact UTF-8 budget boundary", () => {
    const fixture = twoSampleFixture();
    const { publisher, scheduler, sent } = createHarness(() => true, {
      burstBytes: payloadBytes(fixture.begin) + payloadBytes(fixture.append) - 2,
      refillBytesPerSecond: 25,
      controlBurstBytes: 0,
      controlRefillBytesPerSecond: 0,
    });
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: fixture.initial,
    })).toBe(true);
    expect(publisher.append(fixture.updated, 1)).toBe(true);

    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin"]);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    scheduler.advance(1);

    expect(sent).toMatchObject([
      { seq: 1, phase: "begin" },
      { seq: 2, phase: "append", samples: { startIndex: 1, points: [12, 22] } },
    ]);
  });

  it("keeps sustained UTF-8 payload traffic below the room byte window", () => {
    const { publisher, scheduler, sent, sentAt } = createHarness();
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: denseStroke(1),
    })).toBe(true);
    expect(publisher.append(denseStroke(20_000), 1)).toBe(true);

    scheduler.advance(3_000);

    const transmittedBytes = sent.reduce((total, payload) => total + payloadBytes(payload), 0);
    const tokenBucketMaximum = STUDIO_LIVE_GESTURE_PREVIEW_BYTE_BURST
      + STUDIO_LIVE_GESTURE_PREVIEW_BYTE_REFILL_PER_SECOND * 3;
    expect(transmittedBytes).toBeGreaterThan(STUDIO_LIVE_GESTURE_PREVIEW_BYTE_BURST);
    expect(transmittedBytes).toBeLessThanOrEqual(tokenBucketMaximum);
    expect(transmittedBytes).toBeLessThan(2 * 1_024 * 1_024);

    const dataPacketTimes = sent.flatMap((payload, index) => (
      payload.phase === "append" || payload.phase === "replace" ? [sentAt[index]!] : []
    ));
    for (let index = 1; index < dataPacketTimes.length; index += 1) {
      expect(dataPacketTimes[index]! - dataPacketTimes[index - 1]!)
        .toBeGreaterThanOrEqual(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    }
  });

  it("recovers the bounded bucket after idle time without losing the queued suffix", () => {
    const fixture = twoSampleFixture();
    const refillBytesPerSecond = 100;
    const burstBytes = payloadBytes(fixture.begin) + payloadBytes(fixture.append);
    const { publisher, scheduler, sent, sentAt } = createHarness(() => true, {
      burstBytes,
      refillBytesPerSecond,
      controlBurstBytes: 0,
      controlRefillBytesPerSecond: 0,
    });
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: fixture.initial,
    })).toBe(true);
    expect(publisher.append(fixture.updated, 1)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin", "append"]);

    scheduler.advance(Math.ceil((burstBytes / refillBytesPerSecond) * 1_000));
    const recoveredAt = scheduler.now();
    const latest = stroke({
      points: [10, 20, 12, 22, 14, 24],
      pressures: [0.4, 0.5, 0.6],
    });
    expect(publisher.append(latest, 2)).toBe(true);
    scheduler.advance(0);

    expect(sent.at(-1)).toMatchObject({
      seq: 3,
      phase: "append",
      samples: { startIndex: 2, points: [14, 24] },
    });
    expect(sentAt.at(-1)).toBe(recoveredAt);
  });

  it("uses the small control credit only after the scheduled final data packet drains", () => {
    const fixture = twoSampleFixture();
    const { publisher, scheduler, sent } = createHarness(() => true, {
      burstBytes: payloadBytes(fixture.begin) + payloadBytes(fixture.append),
      refillBytesPerSecond: 0,
      controlBurstBytes: payloadBytes(fixture.end),
      controlRefillBytesPerSecond: 0,
    });
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: fixture.initial,
    })).toBe(true);
    expect(publisher.end(fixture.updated)).toBe(true);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin"]);

    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    scheduler.advance(1);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin", "append", "end"]);
    expect(publisher.activeGestureId).toBeNull();
  });

  it("fails closed with cancel when an ordered end drain cannot finish by its deadline", () => {
    const fixture = twoSampleFixture();
    const { publisher, scheduler, sent, sentAt } = createHarness(() => true, {
      burstBytes: payloadBytes(fixture.begin),
      refillBytesPerSecond: 0,
      controlBurstBytes: payloadBytes(fixture.cancel),
      controlRefillBytesPerSecond: 0,
      endDrainDeadlineMs: STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS * 2,
    });
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: fixture.initial,
    })).toBe(true);
    expect(publisher.end(fixture.updated)).toBe(true);

    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS * 2 - 1);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin"]);
    expect(publisher.activeGestureId).toBe(fixture.initial.id);
    scheduler.advance(1);

    expect(sent.map((payload) => payload.phase)).toEqual(["begin", "cancel"]);
    expect(sentAt.at(-1)).toBe(1_080);
    expect(publisher.activeGestureId).toBeNull();
  });

  it("fails closed with a cancel when renderer or established channel schema changes", () => {
    const rendererHarness = createHarness();
    expect(rendererHarness.publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(true);
    expect(rendererHarness.publisher.append(stroke({
      points: [10, 20, 12, 22],
      pressures: [0.4, 0.5],
      stroke: "#ffffff",
    }), 1)).toBe(false);
    expect(rendererHarness.sent.map((payload) => payload.phase)).toEqual(["begin", "cancel"]);
    expect(rendererHarness.publisher.activeGestureId).toBeNull();

    const channelHarness = createHarness();
    expect(channelHarness.publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(true);
    expect(channelHarness.publisher.append(stroke({
      points: [10, 20, 12, 22],
      pressures: undefined,
    }), 1)).toBe(false);
    expect(channelHarness.sent.map((payload) => payload.phase)).toEqual(["begin", "cancel"]);
  });

  it("cancels instead of ending when release post-processing rewrites an already sent prefix", () => {
    const { publisher, scheduler, sent } = createHarness();
    expect(publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(true);
    expect(publisher.append(stroke({
      points: [10, 20, 12, 22],
      pressures: [0.4, 0.5],
    }), 1)).toBe(true);
    scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);

    expect(publisher.end(stroke({
      points: [10, 21, 12, 22],
      pressures: [0.4, 0.5],
    }))).toBe(false);
    expect(sent.map((payload) => payload.phase)).toEqual(["begin", "append", "cancel"]);
    expect(publisher.activeGestureId).toBeNull();
  });

  it("drops local state after a transport failure and reports thrown transport errors", () => {
    const failed = createHarness((payload) => payload.phase !== "append");
    expect(failed.publisher.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(true);
    expect(failed.publisher.append(stroke({
      points: [10, 20, 12, 22],
      pressures: [0.4, 0.5],
    }), 1)).toBe(true);
    failed.scheduler.advance(STUDIO_LIVE_GESTURE_PREVIEW_PUBLISH_INTERVAL_MS);
    expect(failed.publisher.activeGestureId).toBeNull();

    const onError = vi.fn();
    const throwing = new StudioLiveGesturePreviewPublisher({
      onError,
      publish: () => {
        throw new Error("transport unavailable");
      },
    });
    expect(throwing.begin({
      pageId: "page-1",
      documentGeneration: 1,
      element: stroke(),
    })).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("cancels an active remote preview on dispose", () => {
    const { publisher, sent } = createHarness();
    expect(publisher.begin({ pageId: "page-1", documentGeneration: 1, element: stroke() })).toBe(true);
    publisher.dispose();
    expect(sent.map((payload) => payload.phase)).toEqual(["begin", "cancel"]);
    expect(publisher.activeGestureId).toBeNull();
  });
});
