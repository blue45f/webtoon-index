import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH,
  createStudioLiveEnvelope,
  studioLiveDisplayName,
} from "./studio-live-collaboration-protocol";
import {
  StudioLiveCollaborationPanelView,
  type StudioLiveCollaborationPanelViewProps,
} from "./StudioLiveCollaborationPanel";

import type {
  StudioLiveChatMessage,
  StudioLivePeer,
} from "./studio-live-collaboration-room";
import type { StudioLiveSyncSnapshot } from "./studio-live-sync-safety";
import type { StudioScreenShareState } from "../studio-screen-share";

const noop = () => undefined;

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

const peer: StudioLivePeer = {
  sessionId: "private-session-id",
  displayName: "민호 · 이 탭",
  role: "editor",
  visibility: "active",
  pageId: "private-page-id",
  lastSeenAt: 1_000_000,
};

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

function renderView(overrides: Partial<StudioLiveCollaborationPanelViewProps> = {}) {
  const props: StudioLiveCollaborationPanelViewProps = {
    availability: "ready",
    mode: "local",
    peers: [],
    chatMessages: [],
    canChat: true,
    chatDraft: "",
    chatNotice: null,
    screenState: screenState(),
    screenSupported: true,
    screenReady: true,
    screenNetworkMode: "direct",
    serverAvailable: false,
    localFallbackAllowed: true,
    usingLocalFallback: false,
    busyAction: null,
    error: null,
    onApproveRequest: noop,
    onChatDraftChange: noop,
    onChatSubmit: noop,
    onRejectRequest: noop,
    onStartShare: noop,
    onStopShare: noop,
    onRetryServer: noop,
    onUseLocalFallback: noop,
    onExportRecovery: noop,
    onReloadAuthoritative: noop,
    onStopViewer: noop,
    onWatchShare: noop,
    onStopWatching: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioLiveCollaborationPanelView {...props} />);
}

describe("StudioLiveCollaborationPanelView", () => {
  it("sanitizes the 120-character team-name contract into a valid local protocol name", () => {
    const displayName = studioLiveDisplayName(
      `${"긴이름".repeat(40)}\n\t\u0085${"🙂".repeat(20)}`,
      { suffix: "· 이 탭", fallback: "내 작업" }
    );

    expect(displayName).toHaveLength(STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH);
    expect(displayName).toMatch(/ · 이 탭$/u);
    expect(
      Array.from(displayName).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      })
    ).toBe(false);
    expect(() =>
      createStudioLiveEnvelope({
        workId: "work-1",
        sender: { sessionId: "session-1", displayName, role: "owner" },
        sentAt: 1_000_000,
        sequence: 1,
        kind: "presence:hello",
        payload: { visibility: "active", pageId: null },
      })
    ).not.toThrow();
    expect(
      studioLiveDisplayName("\n\t\u0085", { suffix: "· 이 탭", fallback: "내 작업" })
    ).toBe("내 작업 · 이 탭");
  });

  it("truthfully labels BroadcastChannel as same-origin local tabs rather than internet presence", () => {
    const html = renderView();

    expect(html).toContain('data-studio-live-mode="local"');
    expect(html).toContain("로컬 탭 미리보기");
    expect(html).toContain("같은 출처 탭 연결");
    expect(html).toContain("같은 브라우저에서 이 주소로 탭을 하나 더 열면");
    expect(html).toContain("서버 없이 이 기기 안에서만 동기화합니다");
  });

  it("renders an injected authenticated server transport as a separate mode", () => {
    const html = renderView({ mode: "server" });

    expect(html).toContain('data-studio-live-mode="server"');
    expect(html).toContain("서버 팀 세션");
    expect(html).toContain("팀 서버 연결");
    expect(html).toContain("로그인 세션과 작품 권한을 확인한 팀 연결");
    expect(html).not.toContain("로컬 탭 미리보기");
  });

  it("explains server, local durability, pending operations, and ACK recency without protocol ids", () => {
    const html = renderView({
      mode: "server",
      syncSnapshot: syncSnapshot({
        phase: "offline-queued",
        transportReady: false,
        pendingCount: 4,
        lastAckAt: null,
        lastAckServerSequence: "private-sequence-never-render",
      }),
    });

    expect(html).toContain('data-studio-sync-safety-detail="offline-queued"');
    expect(html).toContain("오프라인 · 4개 보관");
    expect(html).toContain("서버 경로");
    expect(html).toContain("연결 대기");
    expect(html).toContain("기기 복구 저장소");
    expect(html).toContain("보호됨");
    expect(html).toContain("아직 서버 승인 없음");
    expect(html).toContain("서버 승인을 기다리는 변경 4개");
    expect(html).not.toContain("private-sequence-never-render");
  });

  it("offers explicit server retry and local fallback recovery controls", () => {
    const failed = renderView({
      availability: "error",
      mode: "server",
      serverAvailable: true,
      error: "팀 서버에 연결하지 못했습니다.",
    });
    expect(failed).toContain("팀 서버 다시 연결");
    expect(failed).toContain("로컬 탭 모드");
    expect(failed.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);

    const terminalFailure = renderView({
      availability: "error",
      mode: "server",
      serverAvailable: true,
      localFallbackAllowed: false,
      error: "작품 접근 권한이 회수되었습니다.",
      syncSnapshot: syncSnapshot({
        phase: "revoked",
        operationSyncReady: false,
        editsDurablyProtected: false,
      }),
    });
    expect(terminalFailure).not.toContain("팀 서버 다시 연결");
    expect(terminalFailure).not.toContain("로컬 탭 모드");

    const operationFailure = renderView({
      availability: "ready",
      mode: "server",
      serverAvailable: true,
      error: "다른 팀원이 이 항목을 편집하고 있습니다.",
    });
    expect(operationFailure).toContain("다른 팀원이 이 항목을 편집하고 있습니다.");
    expect(operationFailure).not.toContain("팀 서버 다시 연결");
    expect(operationFailure).not.toContain("로컬 탭 모드");

    const fallback = renderView({
      mode: "local",
      serverAvailable: true,
      usingLocalFallback: true,
    });
    expect(fallback).toContain("현재 같은 출처 로컬 탭 모드");
    expect(fallback).toContain("팀 서버 다시 연결");
    expect(fallback).not.toContain("> 로컬 탭 모드<");
  });

  it("replaces retry and local-fallback bypasses with an explicit export/reload boundary", () => {
    const recoveryRequired = renderView({
      availability: "error",
      mode: "server",
      serverAvailable: true,
      localFallbackAllowed: false,
      error: "서버가 이 변경을 영구 거부했습니다.",
      syncSnapshot: syncSnapshot({
        phase: "recovery-required",
        operationSyncReady: false,
        editsDurablyProtected: false,
      }),
      recovery: {
        vaultId: "private-vault-id",
        updateCount: 3,
        exportAvailable: true,
        exported: false,
        message: "복구 파일을 먼저 내보내야 합니다.",
      },
    });

    expect(recoveryRequired).toContain('data-studio-crdt-recovery-boundary="true"');
    expect(recoveryRequired).toContain("거부된 로컬 변경을 먼저 보존해 주세요");
    expect(recoveryRequired).toContain("복구 파일 내보내기");
    expect(recoveryRequired).toContain("서버 원고 다시 열기");
    expect(recoveryRequired).not.toContain("팀 서버 다시 연결");
    expect(recoveryRequired).not.toContain("로컬 탭 모드");
    expect(recoveryRequired).not.toContain("private-vault-id");
    expect(recoveryRequired).toMatch(
      /<button[^>]*disabled=""[^>]*title="복구 파일을 먼저 내보내야 서버 원고를 다시 열 수 있습니다\."[^>]*>[\s\S]*?서버 원고 다시 열기/
    );

    const exported = renderView({
      availability: "error",
      mode: "server",
      serverAvailable: true,
      syncSnapshot: syncSnapshot({
        phase: "recovery-required",
        operationSyncReady: false,
        editsDurablyProtected: false,
      }),
      recovery: {
        vaultId: "private-vault-id",
        updateCount: 3,
        exportAvailable: true,
        exported: true,
        message: "복구 파일을 내보냈습니다.",
      },
    });
    expect(exported).toContain("복구 파일 다시 내보내기");
    expect(exported).toContain("현재 낙관적 화면을 버리고 서버 권위 원고를 새로 엽니다");
  });

  it("shows ephemeral tab names and roles without rendering session, page or database ids", () => {
    const html = renderView({ peers: [peer] });

    expect(html).toContain("나 포함 2개 작업 탭");
    expect(html).toContain("다른 탭 1개");
    expect(html).toContain("민호 · 이 탭");
    expect(html).toContain("편집자");
    expect(html).toContain('aria-label="활성 탭"');
    expect(html).not.toContain(peer.sessionId);
    expect(html).not.toContain(peer.pageId);
    expect(html).not.toContain("userId");
  });

  it("provides 44px capture controls, video-only disclosure and unsupported state", () => {
    const ready = renderView();
    expect(ready).toContain("화면 공유");
    expect(ready).toContain("min-h-11");
    expect(ready).toContain("영상만 · 오디오는 캡처하지 않음");

    const unsupported = renderView({
      availability: "unsupported",
      mode: null,
      screenSupported: false,
    });
    expect(unsupported).toContain("브라우저 미지원");
    expect(unsupported).toContain("이 브라우저는 화면 공유를 지원하지 않음");
    expect(unsupported).toContain("disabled");
  });

  it("loads authenticated relay policy on demand and discloses active TURN mode", () => {
    const onDemand = renderView({
      mode: "server",
      screenReady: true,
      screenNetworkMode: null,
    });
    expect(onDemand).toContain('data-studio-screen-network-mode="on-demand"');
    expect(onDemand).toContain("사용할 때 보안 연결 준비 · 영상만");
    const shareButton = onDemand.match(
      /<button[^>]*aria-busy="false"[^>]*>[\s\S]*?화면 공유<\/button>/u
    )?.[0];
    expect(shareButton).toBeTruthy();
    expect(shareButton).not.toContain(' disabled=""');

    const loading = renderView({
      mode: "server",
      screenReady: true,
      screenNetworkMode: null,
      busyAction: "start-share",
    });
    expect(loading).toContain('data-studio-screen-network-mode="loading"');
    expect(loading).toContain("보안 화면 연결 확인 중");

    const relayed = renderView({
      mode: "server",
      screenReady: true,
      screenNetworkMode: "turn",
    });
    expect(relayed).toContain('data-studio-screen-network-mode="turn"');
    expect(relayed).toContain("TURN 중계 · 원격 지원");
    expect(relayed).toContain("영상만 · 오디오는 캡처하지 않음");
    expect(relayed).toContain("TURN은 운영자가 명시한 경우에만 사용");
  });

  it("keeps nonessential microphone calling out of the collaboration surface", () => {
    const html = renderView({ mode: "server" });

    expect(html).not.toContain("음성 작업실");
    expect(html).not.toContain("마이크 권한");
    expect(html).not.toContain("data-studio-voice-call");
  });

  it("renders host approval and current-viewer termination controls without leaking ids", () => {
    const request = { viewer: peer, shareId: "private-share-id" };
    const html = renderView({
      screenState: screenState({
        localSharing: true,
        pendingRequests: [request],
        viewers: [{ ...request, status: "live" }],
      }),
    });

    expect(html).toContain("시청 승인 대기");
    expect(html).toContain("승인하기 전에는 화면 트랙이나 WebRTC 연결 제안을 만들지 않습니다");
    expect(html).toContain('aria-label="민호 · 이 탭 시청 요청 승인"');
    expect(html).toContain('aria-label="민호 · 이 탭 시청 요청 거절"');
    expect(html).toContain("현재 시청자");
    expect(html).toContain('aria-label="민호 · 이 탭 시청 종료"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain(peer.sessionId);
    expect(html).not.toContain(request.shareId);
  });

  it("requires an explicit 보기 action before rendering a requested or live remote screen", () => {
    const share = {
      host: {
        sessionId: "host-session-private",
        displayName: "서윤 · 이 탭",
        role: "owner" as const,
      },
      shareId: "share-id-private",
      label: "작업 화면",
    };
    const available = renderView({ screenState: screenState({ shares: [share] }) });
    expect(available).toContain('aria-label="서윤 · 이 탭 화면 보기"');
    expect(available).toContain("보기");
    expect(available).not.toContain(share.host.sessionId);
    expect(available).not.toContain(share.shareId);

    const requesting = renderView({
      screenState: screenState({
        shares: [share],
        watching: { ...share, host: share.host, status: "requesting", stream: null },
      }),
    });
    expect(requesting).toContain("시청 요청 보내는 중");
    expect(requesting).toContain("보기 중지");

    const live = renderView({
      screenState: screenState({
        shares: [share],
        watching: { ...share, host: share.host, status: "live", stream: {} as MediaStream },
      }),
    });
    expect(live).toContain("<video");
    expect(live).toContain('aria-label="서윤 · 이 탭 공유 화면"');
    expect(live).toContain('playsInline=""');
  });

  it("renders ephemeral session chat with sender names, times and no ids", () => {
    const messages: StudioLiveChatMessage[] = [
      {
        id: "chat-message-private-id-1",
        participant: peer,
        text: "이 컷 배경 톤 조금만 밝게 갈까요?",
        sentAt: Date.UTC(2026, 6, 16, 3, 24),
        self: false,
      },
      {
        id: "chat-message-private-id-2",
        participant: { sessionId: "self-session", displayName: "나의 탭", role: "owner" },
        text: "좋아요, 지금 바로 반영할게요.",
        sentAt: Date.UTC(2026, 6, 16, 3, 25),
        self: true,
      },
    ];
    const html = renderView({ chatMessages: messages });

    expect(html).toContain("세션 채팅");
    expect(html).toContain("기록에 저장되지 않음");
    expect(html).toContain('role="log"');
    expect(html).toContain("이 컷 배경 톤 조금만 밝게 갈까요?");
    expect(html).toContain("좋아요, 지금 바로 반영할게요.");
    expect(html).toContain("민호 · 이 탭");
    expect(html).toContain(">나<");
    expect(html).not.toContain("chat-message-private-id-1");
    expect(html).not.toContain(peer.sessionId);
  });

  it("keeps chat input usable only for roles that may write", () => {
    const writable = renderView({ chatDraft: "안녕하세요" });
    expect(writable).toContain('id="studio-live-chat-input"');
    expect(writable).toContain('aria-label="채팅 메시지 보내기"');
    expect(writable).not.toContain("열람자 권한은 채팅을 보낼 수 없습니다");

    const readOnly = renderView({ canChat: false });
    expect(readOnly).toContain("열람자 권한은 채팅을 보낼 수 없습니다");
    expect(readOnly).toContain("disabled");

    const notice = renderView({
      chatNotice: "채팅 메시지를 보내지 못했습니다. 연결 상태를 확인해 주세요.",
    });
    expect(notice).toContain("채팅 메시지를 보내지 못했습니다");
  });

  it("discloses consent, no-audio, memory-only signaling and deterministic cleanup", () => {
    const html = renderView({ error: "화면 공유 권한이 허용되지 않았습니다." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("화면 공유 권한이 허용되지 않았습니다");
    expect(html).toContain("브라우저 선택기에서 허용한 탭·창·화면만 캡처");
    expect(html).toContain("보기 요청을 화면 공유자가 개별 승인한 뒤에만 WebRTC");
    expect(html).toContain("오디오는 요청하지 않으며");
    expect(html).toContain("패널을 닫으면 로컬 트랙과 모든 피어 연결을 정리");
    expect(html).toContain("SDP·ICE 신호는 메모리에서만 전달");
  });
});
