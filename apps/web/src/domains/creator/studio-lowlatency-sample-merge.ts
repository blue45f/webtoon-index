/**
 * Deterministic merge of the three pointer sample channels into one ordered stream.
 *
 * The browser hands the same physical pen motion to the page through channels that overlap:
 *
 * - `pointerrawupdate` fires as soon as the compositor sees the hardware sample. It is the earliest
 *   observation available to script, but it is not guaranteed to report every sample.
 * - the processed `pointermove` (plus `getCoalescedEvents()`) reports the complete hardware history
 *   for the frame, later, and therefore usually *re-describes* points a raw update already showed.
 * - `getPredictedEvents()` reports estimates that never happened and must never become durable.
 *
 * Consuming them independently either double-inks the overlap or throws away the raw lead. This
 * module merges them once, with an explicit role per emitted record, so the renderer can paint the
 * earliest possible tip while the document only ever stores hardware-backed geometry.
 *
 * ## Ordering contract
 *
 * 1. Records are emitted in browser delivery order. Timestamps are used for *classification* and
 *    *deduplication* only, never for reordering: reduced-precision clocks legitimately emit runs of
 *    equal or zero timestamps, and sorting those visibly kinks a stroke.
 * 2. `sequence` is strictly increasing across the whole session and never reused.
 * 3. A hardware sample is emitted at most once as geometry. A later channel that re-describes it
 *    yields a `confirmed` record carrying `promotes`, which changes durability, not shape.
 * 4. Predicted records never advance the authoritative watermark and are invalidated by the next
 *    delivery from any authoritative channel.
 *
 * ## Dedupe identity
 *
 * `pointerId | timeStamp | x | y | pressure`. Timestamp alone is unusable (Safari and several
 * tablet drivers emit distinct coordinates sharing timestamp 0), and coordinates alone are unusable
 * (a stationary pen emits distinct pressure-only samples). The window is bounded and FIFO-evicted
 * so a long stroke cannot grow the merger without limit; eviction order is delivery order, so the
 * merge stays deterministic for a given delivery sequence.
 */

export type StudioLowLatencyChannel = "rawupdate" | "coalesced" | "predicted";

export type StudioLowLatencySampleRole =
  /** Earliest hardware observation. Renderable now, not yet known to the processed stream. */
  | "provisional"
  /** Hardware sample from the processed stream. Durable. */
  | "confirmed"
  /** Processed hardware sample older than the current tip; fills the path behind a raw tip. */
  | "backfill"
  /** Estimate. Never durable, replaced wholesale by the next authoritative delivery. */
  | "predicted";

export type StudioLowLatencyDropReason =
  | "foreign-pointer"
  | "malformed"
  | "duplicate"
  | "predicted-behind-authority"
  | "predicted-suppressed";

export interface StudioLowLatencySampleLike {
  readonly pointerId?: unknown;
  readonly timeStamp?: unknown;
  readonly clientX?: unknown;
  readonly clientY?: unknown;
  readonly pressure?: unknown;
}

export interface StudioLowLatencyDelivery<T extends StudioLowLatencySampleLike> {
  readonly channel: StudioLowLatencyChannel;
  readonly samples: readonly T[];
  /**
   * `performance.now()` at which the page observed this delivery. Optional; used only to measure
   * how much lead time the raw channel actually bought, never to order or dedupe.
   */
  readonly arrivalTimeStamp?: number;
}

export interface StudioLowLatencyMergedSample<T extends StudioLowLatencySampleLike> {
  readonly sequence: number;
  readonly role: StudioLowLatencySampleRole;
  readonly channel: StudioLowLatencyChannel;
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeStamp: number;
  readonly sample: T;
  /** Sequence of the provisional record this confirmation promotes, else null. */
  readonly promotes: number | null;
  /** Milliseconds the raw channel led the processed stream for this sample, when measurable. */
  readonly promotedLeadMs: number | null;
  /** Generation of the predicted tail this record belongs to; 0 for authoritative records. */
  readonly predictedTailGeneration: number;
}

export interface StudioLowLatencyDrop {
  readonly channel: StudioLowLatencyChannel;
  readonly reason: StudioLowLatencyDropReason;
  readonly key: string;
}

export interface StudioLowLatencyMergeResult<T extends StudioLowLatencySampleLike> {
  readonly samples: readonly StudioLowLatencyMergedSample<T>[];
  readonly drops: readonly StudioLowLatencyDrop[];
  readonly predictedTailGeneration: number;
}

export interface StudioLowLatencySampleMergerOptions {
  readonly pointerId: number;
  /** Bounded dedupe memory. Must cover one browser delivery burst with headroom. */
  readonly keyWindow?: number;
  /** When false, predicted deliveries are dropped without ever reaching the stream. */
  readonly acceptPredicted?: boolean;
}

export const STUDIO_LOWLATENCY_DEFAULT_KEY_WINDOW = 512;

const EMPTY_RESULT_DROPS: readonly StudioLowLatencyDrop[] = Object.freeze([]);

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

interface NormalizedSample {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeStamp: number;
}

/**
 * Bounded FIFO map from dedupe key to the sequence that first emitted it.
 *
 * A plain Map would retain every sample of a multi-thousand-point stroke. Eviction is in insertion
 * order, which is delivery order, so replaying the same deliveries evicts identically.
 */
interface KeyWindowEntry {
  readonly sequence: number;
  /** True while the sample is only known from the raw channel and still awaits confirmation. */
  provisional: boolean;
}

class BoundedKeyWindow {
  private readonly order: string[] = [];
  private readonly entries = new Map<string, KeyWindowEntry>();

  constructor(private readonly capacity: number) {}

  get(key: string): KeyWindowEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: KeyWindowEntry): void {
    if (this.entries.has(key)) {
      this.entries.set(key, entry);
      return;
    }
    this.entries.set(key, entry);
    this.order.push(key);
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.entries.delete(evicted);
    }
  }

  clear(): void {
    this.order.length = 0;
    this.entries.clear();
  }
}

/**
 * Single-pointer merger. Stateful by design: the dedupe window and watermark must survive across
 * browser deliveries, and rebuilding them per delivery would be O(stroke) per frame.
 */
export class StudioLowLatencySampleMerger<T extends StudioLowLatencySampleLike> {
  private readonly pointerId: number;
  private readonly acceptPredicted: boolean;
  private readonly keys: BoundedKeyWindow;
  private readonly provisionalArrival = new Map<number, number>();
  private sequence = 0;
  private authoritativeWatermark = Number.NEGATIVE_INFINITY;
  private lastTimeStamp = 0;
  private predictedGeneration = 0;

  constructor(options: StudioLowLatencySampleMergerOptions) {
    this.pointerId = options.pointerId;
    this.acceptPredicted = options.acceptPredicted !== false;
    const requested = options.keyWindow;
    const capacity = typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : STUDIO_LOWLATENCY_DEFAULT_KEY_WINDOW;
    this.keys = new BoundedKeyWindow(capacity);
  }

  getPredictedTailGeneration(): number {
    return this.predictedGeneration;
  }

  getAuthoritativeWatermark(): number {
    return this.authoritativeWatermark;
  }

  reset(): void {
    this.keys.clear();
    this.provisionalArrival.clear();
    this.sequence = 0;
    this.authoritativeWatermark = Number.NEGATIVE_INFINITY;
    this.lastTimeStamp = 0;
    this.predictedGeneration = 0;
  }

  ingest(delivery: StudioLowLatencyDelivery<T>): StudioLowLatencyMergeResult<T> {
    const samples: StudioLowLatencyMergedSample<T>[] = [];
    const drops: StudioLowLatencyDrop[] = [];
    const arrival = finiteNumber(delivery.arrivalTimeStamp, Number.NaN);

    if (delivery.channel === "predicted") {
      // A predicted tail is always replaced wholesale, so the generation advances even when the
      // delivery turns out to be entirely stale. The renderer can clear on generation change alone.
      this.predictedGeneration += 1;
    } else if (delivery.samples.length > 0) {
      this.predictedGeneration += 1;
    }

    for (const sample of delivery.samples) {
      const normalized = this.normalize(sample);
      if (normalized === null) {
        drops.push({ channel: delivery.channel, reason: this.dropReasonFor(sample), key: "" });
        continue;
      }
      this.lastTimeStamp = normalized.timeStamp;

      if (delivery.channel === "predicted") {
        if (!this.acceptPredicted) {
          drops.push({
            channel: "predicted",
            reason: "predicted-suppressed",
            key: normalized.key,
          });
          continue;
        }
        if (this.keys.get(normalized.key) !== undefined) {
          drops.push({ channel: "predicted", reason: "duplicate", key: normalized.key });
          continue;
        }
        if (normalized.timeStamp < this.authoritativeWatermark) {
          drops.push({
            channel: "predicted",
            reason: "predicted-behind-authority",
            key: normalized.key,
          });
          continue;
        }
        // Predicted keys are deliberately NOT written into the dedupe window. The same coordinate
        // may later arrive as a real hardware sample, and that one must still become geometry.
        this.sequence += 1;
        samples.push({
          sequence: this.sequence,
          role: "predicted",
          channel: "predicted",
          key: normalized.key,
          x: normalized.x,
          y: normalized.y,
          pressure: normalized.pressure,
          timeStamp: normalized.timeStamp,
          sample,
          promotes: null,
          promotedLeadMs: null,
          predictedTailGeneration: this.predictedGeneration,
        });
        continue;
      }

      const seen = this.keys.get(normalized.key);
      if (seen !== undefined) {
        // Only an unconfirmed raw tip can be promoted. A second processed delivery describing an
        // already-confirmed sample is an ordinary duplicate and must not re-enter the stream.
        if (delivery.channel === "coalesced" && seen.provisional) {
          seen.provisional = false;
          const provisionalArrival = this.provisionalArrival.get(seen.sequence);
          this.provisionalArrival.delete(seen.sequence);
          this.sequence += 1;
          samples.push({
            sequence: this.sequence,
            role: "confirmed",
            channel: "coalesced",
            key: normalized.key,
            x: normalized.x,
            y: normalized.y,
            pressure: normalized.pressure,
            timeStamp: normalized.timeStamp,
            sample,
            promotes: seen.sequence,
            promotedLeadMs: Number.isFinite(arrival) && provisionalArrival !== undefined
              ? arrival - provisionalArrival
              : null,
            predictedTailGeneration: 0,
          });
          this.authoritativeWatermark = Math.max(
            this.authoritativeWatermark,
            normalized.timeStamp
          );
          continue;
        }
        drops.push({ channel: delivery.channel, reason: "duplicate", key: normalized.key });
        continue;
      }

      const role: StudioLowLatencySampleRole = delivery.channel === "rawupdate"
        ? "provisional"
        : normalized.timeStamp < this.authoritativeWatermark
          ? "backfill"
          : "confirmed";
      this.sequence += 1;
      this.keys.set(normalized.key, {
        sequence: this.sequence,
        provisional: role === "provisional",
      });
      if (role === "provisional" && Number.isFinite(arrival)) {
        this.provisionalArrival.set(this.sequence, arrival);
      }
      samples.push({
        sequence: this.sequence,
        role,
        channel: delivery.channel,
        key: normalized.key,
        x: normalized.x,
        y: normalized.y,
        pressure: normalized.pressure,
        timeStamp: normalized.timeStamp,
        sample,
        promotes: null,
        promotedLeadMs: null,
        predictedTailGeneration: 0,
      });
      this.authoritativeWatermark = Math.max(this.authoritativeWatermark, normalized.timeStamp);
    }

    return {
      samples,
      drops: drops.length === 0 ? EMPTY_RESULT_DROPS : drops,
      predictedTailGeneration: this.predictedGeneration,
    };
  }

  private dropReasonFor(sample: T): StudioLowLatencyDropReason {
    try {
      if (!sample || typeof sample !== "object") return "malformed";
      const pointerId = sample.pointerId;
      if (pointerId !== undefined && pointerId !== null) {
        const value = finiteNumber(pointerId, Number.NaN);
        if (Number.isFinite(value) && value !== this.pointerId) return "foreign-pointer";
      }
      return "malformed";
    } catch {
      return "malformed";
    }
  }

  private normalize(sample: T): NormalizedSample | null {
    try {
      if (!sample || typeof sample !== "object") return null;
      const pointerId = sample.pointerId;
      if (pointerId !== undefined && pointerId !== null) {
        const value = finiteNumber(pointerId, Number.NaN);
        if (!Number.isFinite(value) || value !== this.pointerId) return null;
      }
      const x = sample.clientX;
      const y = sample.clientY;
      if (typeof x !== "number" || !Number.isFinite(x)) return null;
      if (typeof y !== "number" || !Number.isFinite(y)) return null;
      // A missing or hostile timestamp must not create a new dedupe identity per delivery, so it
      // inherits the last observed one instead of NaN or Date.now().
      const timeStamp = finiteNumber(sample.timeStamp, this.lastTimeStamp);
      const pressure = finiteNumber(sample.pressure, 0);
      return {
        key: `${this.pointerId}|${timeStamp}|${x}|${y}|${pressure}`,
        x,
        y,
        pressure,
        timeStamp,
      };
    } catch {
      // Related-event arrays can be browser- or polyfill-owned and expose throwing accessors.
      return null;
    }
  }
}

export function createStudioLowLatencySampleMerger<T extends StudioLowLatencySampleLike>(
  options: StudioLowLatencySampleMergerOptions
): StudioLowLatencySampleMerger<T> {
  return new StudioLowLatencySampleMerger<T>(options);
}

/** Runs a whole delivery sequence through a fresh merger. Used for determinism assertions. */
export function mergeStudioLowLatencyDeliveries<T extends StudioLowLatencySampleLike>(
  options: StudioLowLatencySampleMergerOptions,
  deliveries: readonly StudioLowLatencyDelivery<T>[]
): StudioLowLatencyMergeResult<T> {
  const merger = createStudioLowLatencySampleMerger<T>(options);
  const samples: StudioLowLatencyMergedSample<T>[] = [];
  const drops: StudioLowLatencyDrop[] = [];
  for (const delivery of deliveries) {
    const result = merger.ingest(delivery);
    samples.push(...result.samples);
    drops.push(...result.drops);
  }
  return {
    samples,
    drops,
    predictedTailGeneration: merger.getPredictedTailGeneration(),
  };
}

export interface StudioLowLatencyStrokeGeometry {
  /** Flat `[x0, y0, ...]` hardware-backed path, safe to store in the document. */
  readonly durable: readonly number[];
  /** Flat coordinates of raw tips not yet confirmed by the processed stream. */
  readonly provisional: readonly number[];
  /** Flat coordinates of the current predicted tail. */
  readonly predicted: readonly number[];
}

/**
 * Reference reconstruction of the merged stream, and the normative definition of each role.
 *
 * `durable ++ provisional` is what the user sees; `durable` alone is what may be committed. This
 * function is intentionally allocation-simple rather than incremental — the renderer keeps its own
 * incremental buffers, while this stays the executable specification the tests compare against.
 */
export function studioLowLatencyStrokeGeometry<T extends StudioLowLatencySampleLike>(
  records: Iterable<StudioLowLatencyMergedSample<T>>
): StudioLowLatencyStrokeGeometry {
  const durable: number[] = [];
  const provisionalSequences: number[] = [];
  const provisional: number[] = [];
  const predicted: number[] = [];
  let predictedGeneration = 0;

  for (const record of records) {
    if (record.role === "predicted") {
      if (record.predictedTailGeneration !== predictedGeneration) {
        predictedGeneration = record.predictedTailGeneration;
        predicted.length = 0;
      }
      predicted.push(record.x, record.y);
      continue;
    }
    // Any authoritative record invalidates the speculative tail.
    predicted.length = 0;
    if (record.role === "provisional") {
      provisionalSequences.push(record.sequence);
      provisional.push(record.x, record.y);
      continue;
    }
    if (record.promotes !== null) {
      const index = provisionalSequences.indexOf(record.promotes);
      if (index >= 0) {
        provisionalSequences.splice(index, 1);
        provisional.splice(index * 2, 2);
      }
      durable.push(record.x, record.y);
      continue;
    }
    durable.push(record.x, record.y);
  }

  return { durable, provisional, predicted };
}
