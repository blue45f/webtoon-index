export type StudioLiveCursorQualityTier = "live" | "balanced" | "constrained";

export type StudioLiveCursorQualityReason =
  | "direct"
  | "drawing"
  | "crowded"
  | "large-room"
  | "save-data"
  | "slow-network"
  | "background";

export interface StudioLiveCursorNetworkProfile {
  readonly saveData: boolean;
  readonly effectiveType: string | null;
}

export interface StudioLiveCursorCadenceInput {
  readonly drawing: boolean;
  readonly peerCount: number;
  readonly visibility: "visible" | "hidden";
  readonly network: StudioLiveCursorNetworkProfile;
}

export interface StudioLiveCursorCadencePlan {
  readonly cadenceMs: number;
  readonly compactPoints: boolean;
  readonly tier: StudioLiveCursorQualityTier;
  readonly reason: StudioLiveCursorQualityReason;
}

export interface StudioLiveCursorQualitySnapshot extends StudioLiveCursorCadencePlan {
  readonly workId: string;
  readonly peerCount: number;
  readonly pending: boolean;
  readonly acceptedCount: number;
  readonly sentCount: number;
  readonly coalescedCount: number;
  readonly compactedCount: number;
  readonly failedCount: number;
  readonly updatedAt: number;
}

export interface StudioLiveCursorQualityPresentation {
  readonly shortLabel: string;
  readonly detail: string;
  readonly tone: "good" | "cool" | "warn";
}

const MIN_CURSOR_CADENCE_MS = 16;
const MAX_CURSOR_CADENCE_MS = 250;
const CURSOR_POINT_COMPACTION_THRESHOLD_MS = 64;

function boundedPeerCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedEffectiveType(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

/**
 * Latest-wins cursor traffic deliberately scales independently from durable CRDT and ink lanes.
 * Small active rooms get a near-frame cadence; large rooms and constrained networks trade only
 * disposable cursor detail for bounded server fan-out and main-thread work.
 */
export function resolveStudioLiveCursorCadence(
  input: StudioLiveCursorCadenceInput,
): StudioLiveCursorCadencePlan {
  const peerCount = boundedPeerCount(input.peerCount);
  const effectiveType = normalizedEffectiveType(input.network.effectiveType);
  let cadenceMs = input.drawing ? 16 : 24;
  let reason: StudioLiveCursorQualityReason = input.drawing ? "drawing" : "direct";

  if (peerCount >= 8) {
    cadenceMs = Math.max(cadenceMs, 32);
    reason = "crowded";
  }
  if (peerCount >= 24) {
    cadenceMs = Math.max(cadenceMs, 48);
    reason = "large-room";
  }
  if (peerCount >= 64) cadenceMs = Math.max(cadenceMs, 72);
  if (peerCount >= 128) cadenceMs = Math.max(cadenceMs, 120);

  if (effectiveType === "3g") {
    cadenceMs = Math.max(cadenceMs, 64);
    reason = "slow-network";
  } else if (effectiveType === "2g") {
    cadenceMs = Math.max(cadenceMs, 100);
    reason = "slow-network";
  } else if (effectiveType === "slow-2g") {
    cadenceMs = Math.max(cadenceMs, 160);
    reason = "slow-network";
  }

  if (input.network.saveData) {
    cadenceMs = Math.max(cadenceMs, 96);
    reason = "save-data";
  }
  if (input.visibility === "hidden") {
    cadenceMs = MAX_CURSOR_CADENCE_MS;
    reason = "background";
  }

  cadenceMs = Math.min(
    MAX_CURSOR_CADENCE_MS,
    Math.max(MIN_CURSOR_CADENCE_MS, Math.round(cadenceMs)),
  );
  const tier: StudioLiveCursorQualityTier =
    cadenceMs <= 32 ? "live" : cadenceMs <= 72 ? "balanced" : "constrained";
  return {
    cadenceMs,
    compactPoints: cadenceMs >= CURSOR_POINT_COMPACTION_THRESHOLD_MS,
    tier,
    reason,
  };
}

export function presentStudioLiveCursorQuality(
  snapshot: StudioLiveCursorQualitySnapshot,
): StudioLiveCursorQualityPresentation {
  if (snapshot.tier === "live") {
    return {
      shortLabel: "커서 실시간",
      detail: `상대 커서를 ${snapshot.cadenceMs}ms 간격으로 전송합니다.`,
      tone: "good",
    };
  }
  if (snapshot.tier === "balanced") {
    return {
      shortLabel: "커서 균형",
      detail: `참여자 수와 연결 상태에 맞춰 ${snapshot.cadenceMs}ms 간격으로 전송합니다. 최신 위치는 유지됩니다.`,
      tone: "cool",
    };
  }
  return {
    shortLabel: "커서 절약",
    detail: `저속망 또는 대규모 세션을 보호하기 위해 ${snapshot.cadenceMs}ms 간격과 간소화된 궤적을 사용합니다.`,
    tone: "warn",
  };
}

const snapshots = new Map<string, StudioLiveCursorQualitySnapshot>();
const listeners = new Map<string, Set<() => void>>();

export function getStudioLiveCursorQualitySnapshot(
  workId: string | null,
): StudioLiveCursorQualitySnapshot | null {
  return workId ? snapshots.get(workId) ?? null : null;
}

export function subscribeStudioLiveCursorQuality(
  workId: string | null,
  listener: () => void,
): () => void {
  if (!workId) return () => undefined;
  let scoped = listeners.get(workId);
  if (!scoped) {
    scoped = new Set();
    listeners.set(workId, scoped);
  }
  scoped.add(listener);
  return () => {
    scoped?.delete(listener);
    if (scoped?.size === 0) listeners.delete(workId);
  };
}

export function publishStudioLiveCursorQuality(
  snapshot: StudioLiveCursorQualitySnapshot,
): void {
  snapshots.set(snapshot.workId, snapshot);
  for (const listener of [...(listeners.get(snapshot.workId) ?? [])]) listener();
}

export function clearStudioLiveCursorQuality(workId: string): void {
  if (!snapshots.delete(workId)) return;
  for (const listener of [...(listeners.get(workId) ?? [])]) listener();
}

/** Test isolation seam; production code should clear through transport lifecycle instead. */
export function resetStudioLiveCursorQualityForTests(): void {
  const affectedWorkIds = [...snapshots.keys()];
  snapshots.clear();
  for (const workId of affectedWorkIds) {
    for (const listener of [...(listeners.get(workId) ?? [])]) listener();
  }
}
