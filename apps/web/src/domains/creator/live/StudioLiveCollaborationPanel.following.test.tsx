// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  StudioLiveCollaborationPanelView,
  type StudioLiveCollaborationPanelViewProps,
} from "./StudioLiveCollaborationPanel";

import type { StudioLivePeer } from "./studio-live-collaboration-room";

const noop = () => undefined;
const originalViewportWidth = window.innerWidth;

const peer: StudioLivePeer = {
  sessionId: "peer-mobile-follow",
  displayName: "민호 · 이 탭",
  role: "editor",
  visibility: "active",
  pageId: "page-2",
  lastSeenAt: 1_000_000,
};

function createViewProps(
  overrides: Partial<StudioLiveCollaborationPanelViewProps> = {}
): StudioLiveCollaborationPanelViewProps {
  return {
    availability: "ready",
    mode: "server",
    peers: [peer],
    chatMessages: [],
    canChat: true,
    chatDraft: "",
    chatNotice: null,
    screenState: {
      localSharing: false,
      shares: [],
      watching: null,
      pendingRequests: [],
      viewers: [],
    },
    screenSupported: true,
    screenReady: true,
    screenNetworkMode: "direct",
    serverAvailable: true,
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
}

function MobileTeamFollowHarness({
  initialFollowingSessionId = null,
  peers = [peer],
}: {
  initialFollowingSessionId?: string | null;
  peers?: StudioLivePeer[];
}) {
  const [followingSessionId, setFollowingSessionId] = useState<string | null>(
    initialFollowingSessionId
  );
  return (
    <div aria-label="팀 작업 공간" role="dialog">
      <StudioLiveCollaborationPanelView
        {...createViewProps({ peers })}
        followingSessionId={followingSessionId}
        onToggleFollow={(sessionId) =>
          setFollowingSessionId((current) =>
            current === sessionId ? null : sessionId
          )
        }
      />
    </div>
  );
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalViewportWidth,
    writable: true,
  });
});

describe("StudioLiveCollaborationPanelView participant follow controls", () => {
  it("starts following from the accessible participant action", () => {
    render(<MobileTeamFollowHarness />);

    const start = screen.getByRole("button", {
      name: "민호 · 이 탭 작업 페이지 따라가기",
    });
    expect(start.getAttribute("aria-pressed")).toBe("false");
    expect(start.getAttribute("data-studio-live-peer-follow")).toBe("idle");

    fireEvent.click(start);

    const stop = screen.getByRole("button", { name: "민호 · 이 탭 따라가기 중지" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    expect(stop.getAttribute("data-studio-live-peer-follow")).toBe("active");
  });

  it("keeps stop-follow reachable after an already-following editor resizes to 430px", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
    render(<MobileTeamFollowHarness initialFollowingSessionId={peer.sessionId} />);

    const teamPanel = screen.getByRole("dialog", { name: "팀 작업 공간" });
    expect(
      within(teamPanel).getByRole("button", { name: "민호 · 이 탭 따라가기 중지" })
        .getAttribute("aria-pressed")
    ).toBe("true");

    window.innerWidth = 430;
    fireEvent(window, new Event("resize"));

    const stop = within(teamPanel).getByRole("button", {
      name: "민호 · 이 탭 따라가기 중지",
    });
    expect(stop.className).not.toContain("hidden");
    fireEvent.click(stop);

    expect(
      within(teamPanel)
        .getByRole("button", { name: "민호 · 이 탭 작업 페이지 따라가기" })
        .getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("keeps a followed ninth participant visible without exceeding or duplicating eight rows", () => {
    const peers = Array.from({ length: 10 }, (_, index): StudioLivePeer => ({
      ...peer,
      sessionId: `peer-${index + 1}`,
      displayName: `참여자 ${index + 1}`,
      lastSeenAt: 1_000_000 - index,
    }));
    render(
      <MobileTeamFollowHarness
        initialFollowingSessionId="peer-9"
        peers={peers}
      />
    );

    const teamPanel = screen.getByRole("dialog", { name: "팀 작업 공간" });
    const participantActions = within(teamPanel).getAllByRole("button", {
      name: /(?:작업 페이지 따라가기|따라가기 중지)$/u,
    });
    expect(participantActions).toHaveLength(8);
    expect(
      participantActions.map((action) => action.getAttribute("aria-label"))
    ).toEqual([
      "참여자 1 작업 페이지 따라가기",
      "참여자 2 작업 페이지 따라가기",
      "참여자 3 작업 페이지 따라가기",
      "참여자 4 작업 페이지 따라가기",
      "참여자 5 작업 페이지 따라가기",
      "참여자 6 작업 페이지 따라가기",
      "참여자 7 작업 페이지 따라가기",
      "참여자 9 따라가기 중지",
    ]);
    expect(
      within(teamPanel).getAllByRole("button", {
        name: "참여자 9 따라가기 중지",
      })
    ).toHaveLength(1);

    fireEvent.click(
      within(teamPanel).getByRole("button", {
        name: "참여자 9 따라가기 중지",
      })
    );

    expect(
      within(teamPanel).queryByRole("button", {
        name: "참여자 9 따라가기 중지",
      })
    ).toBeNull();
    expect(
      within(teamPanel).getAllByRole("button", {
        name: /작업 페이지 따라가기$/u,
      })
    ).toHaveLength(8);
  });
});
