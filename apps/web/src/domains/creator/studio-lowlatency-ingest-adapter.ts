/**
 * Thin adapter from browser PointerEvents to the pure merge core.
 *
 * It owns exactly two things the core must not know about: which native API supplies which channel,
 * and how to read a browser- or polyfill-owned related-event array without letting one throwing
 * accessor abort the delivery. Everything else — ordering, dedupe, roles, geometry — stays in
 * `studio-lowlatency-sample-merge`.
 *
 * Channel mapping mirrors the transport the repo already installs
 * (`studio-drawing-pointer-transport.ts` adds a capture-phase `pointerrawupdate` listener for pen
 * contacts only, alongside the authoritative `pointermove`):
 *
 * | event             | channel      | source                                    |
 * |-------------------|--------------|-------------------------------------------|
 * | pointerdown       | coalesced    | dispatched event only                     |
 * | pointerrawupdate  | rawupdate    | its coalesced list, else the event        |
 * | pointermove       | coalesced    | its coalesced list, else the event        |
 * | pointermove       | predicted    | getPredictedEvents()                      |
 * | pointerup         | coalesced    | dispatched event only                     |
 *
 * `pointerdown`/`pointerup` deliberately never consume a coalesced list: an endpoint owns exactly
 * its dispatched sample, and replaying stale move coalescing there would move the stroke ends.
 */

import {
  createStudioLowLatencySampleMerger,
  type StudioLowLatencyDelivery,
  type StudioLowLatencyMergeResult,
  type StudioLowLatencySampleLike,
  type StudioLowLatencySampleMerger,
} from "./studio-lowlatency-sample-merge";

export interface StudioLowLatencyPointerEventLike extends StudioLowLatencySampleLike {
  readonly getCoalescedEvents?: unknown;
  readonly getPredictedEvents?: unknown;
}

export type StudioLowLatencyPointerEventKind =
  | "pointerdown"
  | "pointerrawupdate"
  | "pointermove"
  | "pointerup";

export interface StudioLowLatencyIngestOptions {
  readonly pointerId: number;
  readonly keyWindow?: number;
  /** Whether native predictions may enter the stream at all. */
  readonly acceptPredicted?: boolean;
  /** Injected arrival clock, for lead-time telemetry. Defaults to performance.now(). */
  readonly now?: () => number;
}

function defaultNow(): number {
  const performanceLike = (globalThis as { performance?: { now?: () => number } }).performance;
  if (typeof performanceLike?.now === "function") {
    try {
      return performanceLike.now();
    } catch {
      return Number.NaN;
    }
  }
  return Number.NaN;
}

/**
 * Reads a related-event array defensively.
 *
 * The dispatched event may be trusted while its related-event array is not: embedded WebViews and
 * polyfills have shipped implementations that throw, return non-arrays, or include nulls and
 * primitives. Any of those degrade to "no related samples", which the merge core already handles by
 * falling back to the dispatched event.
 */
function safeRelatedSamples<T extends StudioLowLatencyPointerEventLike>(
  event: T,
  methodName: "getCoalescedEvents" | "getPredictedEvents"
): readonly T[] {
  const method = event[methodName];
  if (typeof method !== "function") return [];
  try {
    const result = (method as (this: T) => unknown).call(event);
    if (!Array.isArray(result)) return [];
    return result.filter((entry): entry is T => Boolean(entry) && typeof entry === "object");
  } catch {
    return [];
  }
}

export class StudioLowLatencyPointerIngest<T extends StudioLowLatencyPointerEventLike> {
  private readonly merger: StudioLowLatencySampleMerger<T>;
  private readonly acceptPredicted: boolean;
  private readonly now: () => number;

  constructor(options: StudioLowLatencyIngestOptions) {
    this.merger = createStudioLowLatencySampleMerger<T>(options);
    this.acceptPredicted = options.acceptPredicted !== false;
    this.now = typeof options.now === "function" ? options.now : defaultNow;
  }

  getMerger(): StudioLowLatencySampleMerger<T> {
    return this.merger;
  }

  reset(): void {
    this.merger.reset();
  }

  /**
   * Feeds one browser delivery through the merge core.
   *
   * Returns the merged records in emission order. Authoritative records are safe to append to the
   * document; `provisional` ones are renderable immediately but must wait for their `confirmed`
   * promotion before they may be committed.
   */
  ingest(
    event: T,
    kind: StudioLowLatencyPointerEventKind
  ): StudioLowLatencyMergeResult<T> {
    const arrivalTimeStamp = this.now();
    const deliveries = this.deliveriesFor(event, kind, arrivalTimeStamp);
    if (deliveries.length === 1) {
      const only = deliveries[0];
      return only
        ? this.merger.ingest(only)
        : { samples: [], drops: [], predictedTailGeneration: this.merger.getPredictedTailGeneration() };
    }

    const samples: StudioLowLatencyMergeResult<T>["samples"][number][] = [];
    const drops: StudioLowLatencyMergeResult<T>["drops"][number][] = [];
    for (const delivery of deliveries) {
      const result = this.merger.ingest(delivery);
      samples.push(...result.samples);
      drops.push(...result.drops);
    }
    return {
      samples,
      drops,
      predictedTailGeneration: this.merger.getPredictedTailGeneration(),
    };
  }

  private deliveriesFor(
    event: T,
    kind: StudioLowLatencyPointerEventKind,
    arrivalTimeStamp: number
  ): readonly StudioLowLatencyDelivery<T>[] {
    if (kind === "pointerdown" || kind === "pointerup") {
      return [{ channel: "coalesced", samples: [event], arrivalTimeStamp }];
    }

    const coalesced = safeRelatedSamples(event, "getCoalescedEvents");
    const hardware = coalesced.length > 0 ? coalesced : [event];

    if (kind === "pointerrawupdate") {
      return [{ channel: "rawupdate", samples: hardware, arrivalTimeStamp }];
    }

    const deliveries: StudioLowLatencyDelivery<T>[] = [
      { channel: "coalesced", samples: hardware, arrivalTimeStamp },
    ];
    if (this.acceptPredicted) {
      const predicted = safeRelatedSamples(event, "getPredictedEvents");
      if (predicted.length > 0) {
        deliveries.push({ channel: "predicted", samples: predicted, arrivalTimeStamp });
      }
    }
    return deliveries;
  }
}

export function createStudioLowLatencyPointerIngest<
  T extends StudioLowLatencyPointerEventLike,
>(options: StudioLowLatencyIngestOptions): StudioLowLatencyPointerIngest<T> {
  return new StudioLowLatencyPointerIngest<T>(options);
}
