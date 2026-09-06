import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StudioLiveCollaborationCommandCenter,
  buildStudioLiveHandoffSummary,
  filterStudioLiveCollaborationPeers,
  projectStudioLiveCollaborationAttention,
} from "./StudioLiveCollaborationCommandCenter";

import type { StudioLivePeer } from "./studio-live-collaboration-room";
import type { StudioLiveSyncSnapshot } from "./studio-live-sync-safety";
import type { StudioScreenShareState } from "../studio-screen-share";

function peer(
  sessionId: string,
  displayName: string,
  overrides: Partial<StudioLivePeer> = {}
): StudioLivePeer {
  return {
    sessionId,
    displayName,
    role: "editor",
    visibility: "active",
    pageId: null,
    lastSeenAt: 1_000_000,
    ...overrides,
  };
}

function screenState(overrides: Partial<StudioScreenShareState> = {}): StudioScreenShareState {
  return {
    localSharing: false,
    shares: [],
    watching: null,
    pendingRequests: [],
    viewers: [],
    ...overrides,
  };
}

function syncSnapshot(
  overrides: Partial<StudioLiveSyncSnapshot> = {}
): StudioLiveSyncSnapshot {
  return {
    phase: "synced",
    pendingCount: 0,
    persistenceDurability: "durable",
    transportReady: true,
    operationSyncReady: true,
    lastAckAt: 1_000_000,
    lastAckServerSequence: "18",
    editsDurablyProtected: true,
    message: "팀 원고가 실시간으로 동기화됩니다.",
    mode: "server",
    ...overrides,
  };
}

const peers = [
  peer("viewer-id", "지우", { role: "viewer", visibility: "idle" }),
  peer("owner-id", "희준", { role: "owner" }),
  peer("commenter-id", "서연", { role: "commenter" }),
  peer("followed-id", "민호", { role: "editor", visibility: "idle" }),
  peer("admin-id", "가람", { role: "admin" }),
];

describe("StudioLiveCollaborationCommandCenter", () => {
  it("searches every peer by normalized name or role and keeps the followed tab first", () => {
    const followedFirst = filterStudioLiveCollaborationPeers(
      peers,
      "",
      "all",
      false,
      "followed-id"
    );
    expect(followedFirst.map((item) => item.sessionId)).toEqual([
      "followed-id",
      "owner-id",
      "admin-id",
      "commenter-id",
      "viewer-id",
    ]);

    expect(
      filterStudioLiveCollaborationPeers(peers, "검토자", "all", false).map(
        (item) => item.displayName
      )
    ).toEqual(["서연"]);
    expect(
      filterStudioLiveCollaborationPeers(peers, "  ㅎㅣㅈㅜㄴ ", "owner", false)
    ).toEqual([]);
    expect(
      filterStudioLiveCollaborationPeers(peers, "희준", "owner", true).map(
        (item) => item.sessionId
      )
    ).toEqual(["owner-id"]);
  });

  it("prioritizes recovery, permission, screen approval, and sync work in that order", () => {
    const emptyScreen = screenState();
    const recovery = projectStudioLiveCollaborationAttention({
      availability: "ready",
      mode: "server",
      peers,
      screenState: emptyScreen,
      syncSnapshot: syncSnapshot({ phase: "recovery-required" }),
      recovery: {
        vaultId: "private-vault",
        updateCount: 3,
        exportAvailable: true,
        exported: false,
        message: "복구 파일을 내보내 주세요.",
      },
    });
    expect(recovery.target).toBe("sync");
    expect(recovery.tone).toBe("bad");
    expect(recovery.label).toContain("복구 파일");

    const pendingRequest = projectStudioLiveCollaborationAttention({
      availability: "ready",
      mode: "server",
      peers,
      screenState: screenState({
        pendingRequests: [
          {} as StudioScreenShareState["pendingRequests"][number],
        ],
      }),
      syncSnapshot: syncSnapshot({ pendingCount: 5, phase: "syncing" }),
    });
    expect(pendingRequest.target).toBe("screen");
    expect(pendingRequest.label).toContain("1건");

    const pendingSync = projectStudioLiveCollaborationAttention({
      availability: "ready",
      mode: "server",
      peers,
      screenState: emptyScreen,
      syncSnapshot: syncSnapshot({ pendingCount: 5, phase: "syncing" }),
    });
    expect(pendingSync.target).toBe("sync");
    expect(pendingSync.detail).toContain("5개");
  });

  it("builds a bounded async handoff summary without protocol ids or chat contents", () => {
    const summary = buildStudioLiveHandoffSummary({
      availability: "ready",
      mode: "server",
      peers,
      chatMessageCount: 12,
      screenState: screenState(),
      syncSnapshot: syncSnapshot({ pendingCount: 2, phase: "syncing" }),
      followingSessionId: "followed-id",
      generatedAt: new Date("2026-09-05T00:00:00.000Z"),
    });

    expect(summary).toContain("ToonSpectrum Studio 협업 인계 요약");
    expect(summary).toContain("나 포함 6개 작업 탭");
    expect(summary).toContain("세션 채팅: 12개");
    expect(summary).toContain("승인 대기 2개");
    expect(summary).toContain("집중 따라가기: 민호");
    expect(summary).not.toContain("followed-id");
    expect(summary).not.toContain("private");
  });

  it("renders a mobile-safe command surface with all four direct destinations", () => {
    const html = renderToStaticMarkup(
      <StudioLiveCollaborationCommandCenter
        availability="ready"
        mode="server"
        peers={peers}
        chatMessages={[]}
        screenState={screenState()}
        syncSnapshot={syncSnapshot()}
        followingSessionId="followed-id"
        onToggleFollow={() => undefined}
      />
    );

    expect(html).toContain('data-studio-live-command-center="v20"');
    expect(html).toContain('data-studio-collaboration-jump="people"');
    expect(html).toContain('data-studio-collaboration-jump="chat"');
    expect(html).toContain('data-studio-collaboration-jump="screen"');
    expect(html).toContain('data-studio-collaboration-jump="sync"');
    expect(html).toContain("전체 참여 탭 찾기");
    expect(html).toContain("집중 모드 종료 · 민호");
    expect(html).toContain("인계 요약 복사");
  });
});
