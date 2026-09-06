import { describe, expect, it } from "vitest";

import {
  formatStudioLiveLastAck,
  presentStudioLiveSyncSnapshot,
  projectStudioLiveSyncSnapshot,
  type StudioCrdtSyncTelemetry,
} from "./studio-live-sync-safety";

function telemetry(
  overrides: Partial<StudioCrdtSyncTelemetry> = {}
): StudioCrdtSyncTelemetry {
  return {
    state: "ready",
    message: "팀 원고가 실시간으로 동기화됩니다.",
    pendingCount: 0,
    persistenceDurability: "durable",
    transportReady: true,
    lastAckAt: 1_000,
    lastAckServerSequence: "12",
    ...overrides,
  };
}

describe("studio live sync safety", () => {
  it("reports synced only after operation sync and an actual durable sink are ready", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "server",
      canEdit: true,
      telemetry: telemetry(),
    });

    expect(snapshot).toMatchObject({
      phase: "synced",
      editsDurablyProtected: true,
      pendingCount: 0,
      transportReady: true,
      lastAckServerSequence: "12",
    });
    expect(presentStudioLiveSyncSnapshot(snapshot).shortLabel).toBe("안전하게 동기화됨");
  });

  it("presents the ready-to-runtime boot gap as preparation without weakening the edit lock", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "server",
      canEdit: true,
      operationSyncReady: false,
      telemetry: telemetry(),
    });

    expect(snapshot).toMatchObject({
      phase: "initializing",
      operationSyncReady: false,
      editsDurablyProtected: false,
      message: "원고 보호 경로를 마무리하는 중입니다.",
    });
    const presentation = presentStudioLiveSyncSnapshot(snapshot);
    expect(presentation).toMatchObject({
      shortLabel: "협업 준비 중",
      tone: "neutral",
      assertive: false,
    });
    expect(presentation.detail).not.toContain("저장 보호 필요");
  });

  it("promotes the same ready telemetry to synced after the operation runtime is exposed", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "server",
      canEdit: true,
      operationSyncReady: true,
      telemetry: telemetry(),
    });

    expect(snapshot).toMatchObject({
      phase: "synced",
      operationSyncReady: true,
      editsDurablyProtected: true,
    });
  });

  it("keeps explicit boot-time storage and availability failures assertive", () => {
    const storageRisk = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "server",
      canEdit: true,
      operationSyncReady: false,
      telemetry: telemetry({ durabilityAtRisk: true }),
    });
    const availabilityFailure = projectStudioLiveSyncSnapshot({
      availability: "error",
      mode: "server",
      canEdit: true,
      operationSyncReady: false,
      telemetry: telemetry(),
    });

    for (const snapshot of [storageRisk, availabilityFailure]) {
      expect(snapshot).toMatchObject({
        phase: "durability-risk",
        editsDurablyProtected: false,
      });
      expect(presentStudioLiveSyncSnapshot(snapshot)).toMatchObject({
        shortLabel: "저장 보호 필요",
        tone: "bad",
        assertive: true,
      });
    }
  });

  it("never shows the green synced label on a tab that cannot persist", () => {
    // The measured two-tab fork: a follower tab's every save was rejected by the leader's lease,
    // yet `mode === "local"` alone counted as durable and the rail showed "안전하게 동기화됨" on
    // the exact tab that had no durability at all.
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "local",
      canEdit: true,
      documentWritable: false,
      telemetry: telemetry(),
    });

    expect(snapshot.phase).toBe("read-only-follower");
    expect(snapshot.editsDurablyProtected).toBe(false);
    const presentation = presentStudioLiveSyncSnapshot(snapshot);
    expect(presentation.shortLabel).toBe("다른 탭이 편집 중");
    expect(presentation.tone).toBe("warn");
    expect(presentation.assertive).toBe(true);
  });

  it("keeps the historical behaviour when writability is not tracked", () => {
    // Callers that predate document leadership pass no `documentWritable`; their snapshots must
    // be byte-identical to before, or every existing rail would need auditing at once.
    const untracked = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "local",
      canEdit: true,
      telemetry: telemetry(),
    });
    const explicitlyWritable = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "local",
      canEdit: true,
      documentWritable: true,
      telemetry: telemetry(),
    });

    expect(untracked.phase).toBe("synced");
    expect(untracked.editsDurablyProtected).toBe(true);
    expect(explicitlyWritable).toEqual(untracked);
  });

  it("lets terminal states outrank the follower notice", () => {
    // A revoked session is a stronger fact than "another tab is editing"; the follower notice
    // must never mask it.
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "local",
      canEdit: true,
      documentWritable: false,
      terminalTransportState: "revoked",
      telemetry: telemetry(),
    });

    expect(snapshot.phase).toBe("revoked");
  });

  it("fails closed when neither the authoritative server nor IndexedDB is durable", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "connecting",
      mode: "server",
      canEdit: true,
      operationSyncReady: true,
      telemetry: telemetry({
        state: "retrying",
        transportReady: false,
        persistenceDurability: "degraded",
        pendingCount: 2,
      }),
    });

    expect(snapshot.phase).toBe("durability-risk");
    expect(snapshot.editsDurablyProtected).toBe(false);
    const presentation = presentStudioLiveSyncSnapshot(snapshot);
    expect(presentation.shortLabel).toBe("저장 보호 필요");
    expect(presentation.detail).toContain("모두 준비되지 않아");
    expect(presentation.assertive).toBe(true);
  });

  it("shows an explicit durability risk when an editor transport fails before binding telemetry exists", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "error",
      mode: "server",
      canEdit: true,
      telemetry: null,
      transportMessage: "인증된 팀 연결 정보가 없습니다.",
    });

    expect(snapshot).toMatchObject({
      phase: "durability-risk",
      transportReady: false,
      operationSyncReady: false,
      editsDurablyProtected: false,
    });
  });

  it("distinguishes durable offline operations from unsafe memory-only edits", () => {
    const durable = projectStudioLiveSyncSnapshot({
      availability: "connecting",
      mode: "server",
      canEdit: true,
      operationSyncReady: true,
      telemetry: telemetry({
        state: "retrying",
        transportReady: false,
        persistenceDurability: "durable",
        pendingCount: 7,
      }),
    });
    expect(durable).toMatchObject({
      phase: "offline-queued",
      editsDurablyProtected: true,
      pendingCount: 7,
    });
    expect(presentStudioLiveSyncSnapshot(durable).shortLabel).toBe("오프라인 · 7개 보관");
  });

  it("never treats a local BroadcastChannel receipt as an authoritative server sync", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "local",
      canEdit: true,
      operationSyncReady: true,
      telemetry: telemetry({
        state: "retrying",
        pendingCount: 2,
        persistenceDurability: "durable",
        transportReady: true,
        lastAckAt: null,
        lastAckServerSequence: null,
      }),
    });

    expect(snapshot).toMatchObject({
      phase: "offline-queued",
      mode: "local",
      pendingCount: 2,
      editsDurablyProtected: true,
      lastAckAt: null,
    });
    const presentation = presentStudioLiveSyncSnapshot(snapshot);
    expect(presentation.shortLabel).toBe("오프라인 · 2개 보관");
    expect(presentation.detail).toContain("서버가 다시 연결될 때까지");
    expect(presentation.detail).not.toContain("팀 서버와 이 기기의 복구 저장소에 원고를 보호");
  });

  it("keeps terminal authorization and recovery states above ordinary retry states", () => {
    const revoked = projectStudioLiveSyncSnapshot({
      availability: "error",
      mode: "server",
      canEdit: true,
      telemetry: telemetry({ state: "retrying" }),
      terminalTransportState: "revoked",
      transportMessage: "작품 접근 권한이 회수되었습니다.",
    });
    expect(revoked).toMatchObject({ phase: "revoked", editsDurablyProtected: false });
    expect(presentStudioLiveSyncSnapshot(revoked).shortLabel).toBe("편집 권한 회수됨");

    const recovery = projectStudioLiveSyncSnapshot({
      availability: "error",
      mode: "server",
      canEdit: true,
      telemetry: telemetry(),
      terminalTransportState: "recovery-required",
    });
    expect(recovery).toMatchObject({ phase: "recovery-required", editsDurablyProtected: false });
  });

  it("does not require an editor durability sink for read-only participants", () => {
    const snapshot = projectStudioLiveSyncSnapshot({
      availability: "ready",
      mode: "server",
      canEdit: false,
      telemetry: telemetry({ persistenceDurability: "unavailable" }),
    });
    expect(snapshot).toMatchObject({
      phase: "synced",
      persistenceDurability: "not-applicable",
      editsDurablyProtected: true,
    });
  });

  it("formats server ACK recency without exposing protocol sequence ids", () => {
    expect(formatStudioLiveLastAck(null, 10_000)).toBe("아직 서버 승인 없음");
    expect(formatStudioLiveLastAck(8_000, 10_000)).toBe("방금 서버 승인");
    expect(formatStudioLiveLastAck(40_000, 80_000)).toBe("40초 전 서버 승인");
    expect(formatStudioLiveLastAck(20_000, 200_000)).toBe("3분 전 서버 승인");
  });
});
