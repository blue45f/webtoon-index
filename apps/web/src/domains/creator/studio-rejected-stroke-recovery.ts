/**
 * Rejected-stroke recovery — keeps the geometry of a stroke whose *selected* live provider failed.
 *
 * ADR 0018 forbids automatic renderer substitution: when the selected WebGPU / wet-ink / dynamic /
 * retained-media provider fails mid-stroke or at pointer-up, the same operation must not continue
 * through Canvas2D or Konva, and the failed presentation stays `unavailable`. Until 2026-09-02 the
 * host implemented that by discarding the whole operation — including the CPU-side `DrawEl`
 * (points, pressures, tilts) that was fully intact at that moment. A GPU hiccup therefore deleted
 * finished user work, which the product principle "무손실 입력" does not allow.
 *
 * This module separates the two concerns. The provider failure still cancels the live operation
 * exactly as before (no re-presentation, no promotion to another renderer). The completed geometry
 * is parked here as a recovery record and surfaced in the reliability rail, where the user can
 * **explicitly** restore it as an ordinary document element ("사용자 명시적 선택" — the one form of
 * provider change ADR 0018 permits) or throw it away. Nothing in this module renders anything.
 *
 * The store is React-free (bindings live in use-studio-reliability-status.ts), bounded, and
 * idempotent per stroke id. Restoration is delegated to a host-registered restorer so the store never
 * imports editor state.
 */

import { isCompleteStudioDrawOp } from "./brush/studio-draw-completion";

import type { DrawEl } from "./studio-element-model";

/** Most records kept at once; the oldest is dropped first. A rail cannot usefully show more. */
export const STUDIO_REJECTED_STROKE_RECOVERY_LIMIT = 8;

/**
 * Reasons that mean the *user or tool* ended the stroke, not the provider. Those are real
 * cancellations and must stay discards — recording them would resurrect intentionally abandoned
 * marks.
 */
const CANCELLATION_REASONS: ReadonlySet<string> = new Set([
  "cancelled",
  "canonical-commit-cancelled",
  "pointercancel",
]);

export type StudioRejectedStrokeSalvagePlan =
  | {
      readonly action: "discard";
      readonly reason: "no-stroke" | "incomplete-stroke" | "cancelled" | "already-recorded";
    }
  | { readonly action: "salvage"; readonly strokeId: string };

export interface StudioRejectedStrokeSalvageInput {
  readonly stroke: DrawEl | null | undefined;
  /** Provider failure reason (`StudioLiveStrokeUnavailableReason` or a provider outcome reason). */
  readonly reason: string;
  readonly recordedIds: ReadonlySet<string>;
}

/**
 * Decides whether a rejected stroke is worth keeping. Only a complete mark (same rule as history
 * promotion) that the provider — not the user — abandoned, and that is not already recorded.
 */
export function planStudioRejectedStrokeSalvage(
  input: StudioRejectedStrokeSalvageInput,
): StudioRejectedStrokeSalvagePlan {
  const stroke = input.stroke;
  if (!stroke) return { action: "discard", reason: "no-stroke" };
  if (CANCELLATION_REASONS.has(input.reason)) return { action: "discard", reason: "cancelled" };
  if (!isCompleteStudioDrawOp(stroke)) return { action: "discard", reason: "incomplete-stroke" };
  if (input.recordedIds.has(stroke.id)) return { action: "discard", reason: "already-recorded" };
  return { action: "salvage", strokeId: stroke.id };
}

export interface StudioRejectedStrokeRecord {
  /** Equals the rejected stroke's id so a second failure report for the same stroke is a no-op. */
  readonly id: string;
  readonly pageId: string;
  /** The exact CPU-side operation at the moment of rejection. Never mutated. */
  readonly stroke: DrawEl;
  /** Human label of the selected provider that failed ("WebGPU 라이브 잉크", "습식 매체", …). */
  readonly provider: string;
  readonly reason: string;
  readonly at: number;
}

export type StudioRejectedStrokeRestoreOutcome =
  | { readonly status: "restored"; readonly recordId: string; readonly restoredStrokeId: string }
  | {
      readonly status: "refused";
      readonly recordId: string;
      /** Human-readable reason (e.g. the record belongs to another page). */
      readonly reason: string;
    }
  | { readonly status: "unavailable"; readonly recordId: string };

/**
 * Host-registered restore step. It receives the record and must commit the geometry through the
 * ordinary document path (never through the failed provider). Returning `refused` keeps the record.
 */
export type StudioRejectedStrokeRestorer = (
  record: StudioRejectedStrokeRecord,
) => Exclude<StudioRejectedStrokeRestoreOutcome, { status: "unavailable" }>;

let records: readonly StudioRejectedStrokeRecord[] = Object.freeze([]);
let restorer: StudioRejectedStrokeRestorer | null = null;
const listeners = new Set<() => void>();

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * The live `DrawEl` keeps receiving pointer samples and post-correction writes after the rejection
 * is announced (the discard runs in a later microtask), and a restorer must not be able to edit the
 * parked geometry either. Snapshot the serialisable element and freeze every nested array.
 */
export function snapshotStudioRejectedStroke(stroke: DrawEl): DrawEl {
  return deepFreeze(structuredClone(stroke));
}

function publish(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Subscriber isolation — one failing listener must not hide the notice from the others.
    }
  }
}

export function subscribeStudioRejectedStrokeRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Newest first. The array identity only changes when the records change (useSyncExternalStore). */
export function getStudioRejectedStrokeRecords(): readonly StudioRejectedStrokeRecord[] {
  return records;
}

export function studioRejectedStrokeRecordIds(): ReadonlySet<string> {
  return new Set(records.map((record) => record.id));
}

/**
 * Parks a rejected stroke. Idempotent per stroke id; bounded by
 * {@link STUDIO_REJECTED_STROKE_RECOVERY_LIMIT}. Returns the plan so callers can adjust their
 * user-facing message ("취소했습니다" vs "복구할 수 있습니다").
 */
export function recordStudioRejectedStroke(input: {
  readonly stroke: DrawEl | null | undefined;
  readonly pageId: string;
  readonly provider: string;
  readonly reason: string;
  readonly at?: number;
}): StudioRejectedStrokeSalvagePlan {
  const plan = planStudioRejectedStrokeSalvage({
    stroke: input.stroke,
    reason: input.reason,
    recordedIds: studioRejectedStrokeRecordIds(),
  });
  if (plan.action !== "salvage" || !input.stroke) return plan;
  const record: StudioRejectedStrokeRecord = Object.freeze({
    id: input.stroke.id,
    pageId: input.pageId,
    stroke: snapshotStudioRejectedStroke(input.stroke),
    provider: input.provider,
    reason: input.reason,
    at: input.at ?? Date.now(),
  });
  records = Object.freeze(
    [record, ...records].slice(0, STUDIO_REJECTED_STROKE_RECOVERY_LIMIT),
  );
  publish();
  return plan;
}

export function dismissStudioRejectedStroke(id: string): void {
  if (!records.some((record) => record.id === id)) return;
  records = Object.freeze(records.filter((record) => record.id !== id));
  publish();
}

/** Registers (or clears with `null`) the editor-owned restore step. Returns an unregister function. */
export function setStudioRejectedStrokeRestorer(
  next: StudioRejectedStrokeRestorer | null,
): () => void {
  restorer = next;
  return () => {
    if (restorer === next) restorer = null;
  };
}

/**
 * Explicit user action from the rail. The record is removed only when the restorer reports success;
 * a refusal (wrong page, read-only document) keeps it so the user can retry after switching context.
 */
export function restoreStudioRejectedStroke(id: string): StudioRejectedStrokeRestoreOutcome {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) return { status: "refused", recordId: id, reason: "복구 레코드가 이미 사라졌습니다." };
  if (!restorer) return { status: "unavailable", recordId: id };
  const outcome = restorer(record);
  if (outcome.status === "restored") dismissStudioRejectedStroke(id);
  return outcome;
}

/** Test isolation. */
export function resetStudioRejectedStrokeRecovery(): void {
  records = Object.freeze([]);
  restorer = null;
  listeners.clear();
}
