// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_STUDIO_LIVE_CONTEXT,
  StudioLiveCollaborationContext,
} from "./studio-live-collaboration-context";
import {
  setStudioLiveCursorFocus,
  setStudioLiveCursorTrails,
  setStudioLiveCursorVisibility,
} from "./studio-live-viewport-preferences";
import { StudioLiveCollaborationQuickControls } from "./StudioLiveCollaborationQuickControls";

import type { StudioLivePeer } from "./studio-live-collaboration-room";

const peer: StudioLivePeer = {
  sessionId: "peer-focus",
  displayName: "민호 · 이 탭",
  role: "editor",
  visibility: "active",
  pageId: "page-2",
  lastSeenAt: 1_000,
};

function renderControls(options: {
  followingSessionId?: string | null;
  onToggleFollow?: (sessionId: string) => void;
  onOpenTeam?: () => void;
} = {}) {
  return render(
    <StudioLiveCollaborationContext.Provider
      value={{
        ...EMPTY_STUDIO_LIVE_CONTEXT,
        availability: "ready",
        mode: "server",
        peers: [peer],
      }}
    >
      <StudioLiveCollaborationQuickControls
        followingSessionId={options.followingSessionId ?? null}
        onOpenTeam={options.onOpenTeam ?? (() => undefined)}
        onToggleFollow={options.onToggleFollow ?? (() => undefined)}
      />
    </StudioLiveCollaborationContext.Provider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setStudioLiveCursorFocus(null);
  setStudioLiveCursorVisibility("all");
  setStudioLiveCursorTrails(true);
});

afterEach(() => {
  cleanup();
  setStudioLiveCursorFocus(null);
  setStudioLiveCursorVisibility("all");
  setStudioLiveCursorTrails(true);
});

describe("StudioLiveCollaborationQuickControls", () => {
  it("switches between all, hidden, and trail-free local cursor views", () => {
    renderControls();

    const trigger = screen.getByRole("button", {
      name: "모든 커서 및 실시간 협업 보기 설정",
    });
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "실시간 협업 보기 설정" });

    fireEvent.click(within(panel).getByRole("button", { name: "커서 숨김" }));
    expect(trigger.getAttribute("data-studio-live-cursor-visibility")).toBe("hidden");

    fireEvent.click(
      within(panel).getByRole("button", { name: /실시간 획 트레일/u }),
    );
    expect(
      within(panel)
        .getByRole("button", { name: /실시간 획 트레일/u })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("starts a focused follow session directly from the compact participant list", () => {
    const onToggleFollow = vi.fn();
    renderControls({ onToggleFollow });

    fireEvent.click(
      screen.getByRole("button", {
        name: "모든 커서 및 실시간 협업 보기 설정",
      }),
    );
    const panel = screen.getByRole("dialog", { name: "실시간 협업 보기 설정" });
    fireEvent.click(within(panel).getByRole("button", { name: /민호 · 이 탭/u }));

    expect(onToggleFollow).toHaveBeenCalledWith("peer-focus");
    expect(
      screen.getByRole("button", {
        name: "따라가기만 및 실시간 협업 보기 설정",
      }).getAttribute("data-studio-live-cursor-visibility"),
    ).toBe("followed");
  });
});
