import type { StudioLiveAvailability } from "./studio-live-collaboration-context";
import type { StudioLiveTransportMode } from "./studio-live-collaboration-transport";

export type StudioLiveSyncPhase =
  | "initializing"
  | "synced"
  | "syncing"
  | "offline-queued"
  | "retrying"
  | "repairing"
  | "durability-risk"
  | "read-only-follower"
  | "revoked"
  | "recovery-required";

export type StudioLivePersistenceDurability =
  | "checking"
  | "durable"
  | "degraded"
  | "unavailable"
  | "not-applicable";

/**
 * User-facing, fail-closed summary of the two independent durability sinks used by live editing.
 * `editsDurablyProtected` is true only when the CRDT binding is usable and either the
 * authoritative server or the browser-durable outbox can retain a newly authored operation.
 */
export interface StudioLiveSyncSnapshot {
  phase: StudioLiveSyncPhase;
  pendingCount: number;
  persistenceDurability: StudioLivePersistenceDurability;
  transportReady: boolean;
  operationSyncReady: boolean;
  lastAckAt: number | null;
  lastAckServerSequence: string | null;
  editsDurablyProtected: boolean;
  message: string;
  mode: StudioLiveTransportMode | null;
}

export const INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT: StudioLiveSyncSnapshot = {
  phase: "initializing",
  pendingCount: 0,
  persistenceDurability: "checking",
  transportReady: false,
  operationSyncReady: false,
  lastAckAt: null,
  lastAckServerSequence: null,
  editsDurablyProtected: false,
  message: "실시간 원고 보호 상태를 확인하는 중입니다.",
  mode: null,
};

export interface StudioCrdtSyncTelemetry {
  state:
    | "idle"
    | "syncing"
    | "ready"
    | "retrying"
    | "repairing"
    | "revoked"
    | "recovery-required"
    | "error";
  message: string;
  pendingCount: number;
  persistenceDurability: StudioLivePersistenceDurability;
  transportReady: boolean;
  lastAckAt: number | null;
  lastAckServerSequence: string | null;
  durabilityAtRisk?: boolean;
}

export interface ProjectStudioLiveSyncSnapshotInput {
  availability: StudioLiveAvailability;
  mode: StudioLiveTransportMode | null;
  canEdit: boolean;
  telemetry: StudioCrdtSyncTelemetry | null;
  /** True only after the initial authoritative frontier has been applied and exposed to Studio. */
  operationSyncReady?: boolean;
  /**
   * False when another tab holds the document's autosave leadership, so this tab cannot persist.
   *
   * Without this signal, `mode === "local"` alone counted as durable and a follower tab showed the
   * green "안전하게 동기화됨" while every one of its saves was being rejected — the measured
   * two-tab fork advertised safety on the exact tab that had none. Undefined means "not tracked"
   * and keeps the historical behaviour, so callers that predate leadership stay unchanged.
   */
  documentWritable?: boolean;
  terminalTransportState?: "revoked" | "recovery-required" | null;
  transportMessage?: string | null;
}

function safePendingCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function browserDurable(persistence: StudioLivePersistenceDurability): boolean {
  return persistence === "durable";
}

function serverDurable(options: {
  mode: StudioLiveTransportMode | null;
  transportReady: boolean;
  operationSyncReady: boolean;
}): boolean {
  return options.mode === "server" && options.transportReady && options.operationSyncReady;
}

/** Converts low-level transport/binding events into one conservative and deterministic UI state. */
export function projectStudioLiveSyncSnapshot({
  availability,
  mode,
  canEdit,
  telemetry,
  operationSyncReady: exposedOperationSyncReady,
  documentWritable,
  terminalTransportState = null,
  transportMessage = null,
}: ProjectStudioLiveSyncSnapshotInput): StudioLiveSyncSnapshot {
  const pendingCount = safePendingCount(telemetry?.pendingCount ?? 0);
  const persistenceDurability = canEdit
    ? telemetry?.persistenceDurability ?? "checking"
    : "not-applicable";
  const transportReady = telemetry?.transportReady ?? availability === "ready";
  const operationSyncReady = exposedOperationSyncReady ?? telemetry?.state === "ready";
  const message = transportMessage?.trim() || telemetry?.message || INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT.message;
  const editsDurablyProtected = canEdit
    ? documentWritable !== false && operationSyncReady && (
        mode === "local" ||
        serverDurable({ mode, transportReady, operationSyncReady }) ||
        browserDurable(persistenceDurability)
      )
    : operationSyncReady;

  const common = {
    pendingCount,
    persistenceDurability,
    transportReady,
    operationSyncReady,
    lastAckAt: telemetry?.lastAckAt ?? null,
    lastAckServerSequence: telemetry?.lastAckServerSequence ?? null,
    editsDurablyProtected,
    message,
    mode,
  } satisfies Omit<StudioLiveSyncSnapshot, "phase">;

  if (terminalTransportState === "revoked" || telemetry?.state === "revoked") {
    return { ...common, phase: "revoked", editsDurablyProtected: false };
  }
  if (
    terminalTransportState === "recovery-required" ||
    telemetry?.state === "recovery-required"
  ) {
    return { ...common, phase: "recovery-required", editsDurablyProtected: false };
  }
  // A follower tab is healthy, not at risk — its document lives safely in the leader tab. What it
  // must never do is claim the green "안전하게 동기화됨" while its own saves are being rejected, so
  // this branch sits above every optimistic phase and below the terminal ones.
  if (canEdit && documentWritable === false) {
    return { ...common, phase: "read-only-follower" };
  }
  if (telemetry?.state === "repairing") return { ...common, phase: "repairing" };

  if (!telemetry) {
    if (availability === "error" && canEdit) {
      return { ...common, phase: "durability-risk", editsDurablyProtected: false };
    }
    return { ...common, phase: "initializing" };
  }
  if (telemetry.state === "idle" || telemetry.state === "syncing") {
    return { ...common, phase: telemetry.state === "syncing" ? "syncing" : "initializing" };
  }

  // The binding publishes its authoritative `ready` frontier before `start()` has finished
  // draining the restored outbox and exposing the operation runtime to Studio. During that boot
  // gap edits must remain locked, but it is not a durability failure: presenting the fail-closed
  // lock as the assertive red "저장 보호 필요" warning makes a healthy cold start look broken.
  // Keep the real safety flags false and soften only the user-facing phase until the runtime is
  // exposed. Explicit storage/transport risk still falls through to the risk branch below.
  if (
    telemetry.state === "ready" &&
    !operationSyncReady &&
    availability !== "error" &&
    !telemetry.durabilityAtRisk
  ) {
    return {
      ...common,
      phase: "initializing",
      message: "원고 보호 경로를 마무리하는 중입니다.",
    };
  }

  if (telemetry.durabilityAtRisk || (canEdit && !editsDurablyProtected)) {
    return { ...common, phase: "durability-risk" };
  }

  if (
    (mode === "local" || !transportReady) &&
    pendingCount > 0 &&
    browserDurable(persistenceDurability)
  ) {
    return { ...common, phase: "offline-queued" };
  }

  if (
    telemetry.state === "retrying" ||
    telemetry.state === "error" ||
    availability === "connecting" ||
    !transportReady
  ) {
    return { ...common, phase: "retrying" };
  }

  if (telemetry.state === "ready" && pendingCount === 0) {
    return { ...common, phase: "synced" };
  }

  return { ...common, phase: "syncing" };
}

export interface StudioLiveSyncPresentation {
  shortLabel: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad" | "cool";
  assertive: boolean;
}

function pendingLabel(count: number): string {
  return `${count.toLocaleString("ko-KR")}개`;
}

export function presentStudioLiveSyncSnapshot(
  snapshot: StudioLiveSyncSnapshot
): StudioLiveSyncPresentation {
  switch (snapshot.phase) {
    case "synced":
      return {
        shortLabel: "안전하게 동기화됨",
        detail:
          snapshot.mode === "local"
            ? "같은 출처 탭끼리 연결되었습니다. 팀 서버 승인이 필요한 변경은 이 기기의 복구 저장소에 남겨 둡니다."
            : snapshot.persistenceDurability === "durable"
            ? "팀 서버와 이 기기의 복구 저장소에 원고를 보호합니다."
            : "팀 서버가 새 원고 연산을 승인하고 있습니다.",
        tone: "good",
        assertive: false,
      };
    case "read-only-follower":
      return {
        shortLabel: "다른 탭이 편집 중",
        detail:
          "이 원고는 다른 탭에서 편집하고 있어 여기서는 저장되지 않습니다. 그 탭을 닫으면 이 탭이 이어받습니다.",
        tone: "warn",
        assertive: true,
      };
    case "syncing":
      return {
        shortLabel: snapshot.pendingCount > 0
          ? `${pendingLabel(snapshot.pendingCount)} 동기화 중`
          : "원고 동기화 중",
        detail: snapshot.message,
        tone: "cool",
        assertive: false,
      };
    case "offline-queued":
      return {
        shortLabel: `오프라인 · ${pendingLabel(snapshot.pendingCount)} 보관`,
        detail: "서버가 다시 연결될 때까지 이 기기의 복구 저장소에 변경을 보관합니다.",
        tone: "warn",
        assertive: false,
      };
    case "retrying":
      return {
        shortLabel: snapshot.pendingCount > 0
          ? `재연결 중 · ${pendingLabel(snapshot.pendingCount)} 대기`
          : "팀 서버 재연결 중",
        detail: snapshot.message,
        tone: "warn",
        assertive: false,
      };
    case "repairing":
      return {
        shortLabel: "원고 복구 중",
        detail: snapshot.message,
        tone: "cool",
        assertive: false,
      };
    case "durability-risk":
      return {
        shortLabel: "저장 보호 필요",
        detail: snapshot.editsDurablyProtected
          ? snapshot.message
          : "팀 서버와 이 기기의 복구 저장소가 모두 준비되지 않아 새 변경을 안전하게 보장할 수 없습니다.",
        tone: "bad",
        assertive: true,
      };
    case "revoked":
      return {
        shortLabel: "편집 권한 회수됨",
        detail: snapshot.message,
        tone: "bad",
        assertive: true,
      };
    case "recovery-required":
      return {
        shortLabel: "원고 복구 필요",
        detail: snapshot.message,
        tone: "bad",
        assertive: true,
      };
    default:
      return {
        shortLabel: "협업 준비 중",
        detail: snapshot.message,
        tone: "neutral",
        assertive: false,
      };
  }
}

export function formatStudioLiveLastAck(lastAckAt: number | null, now = Date.now()): string {
  if (lastAckAt === null || !Number.isFinite(lastAckAt)) return "아직 서버 승인 없음";
  const elapsedSeconds = Math.max(0, Math.floor((now - lastAckAt) / 1_000));
  if (elapsedSeconds < 5) return "방금 서버 승인";
  if (elapsedSeconds < 60) return `${elapsedSeconds}초 전 서버 승인`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전 서버 승인`;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(lastAckAt);
}
