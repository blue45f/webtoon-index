import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioLivePresenceDock } from "./StudioLiveCanvasOverlay";

const CONSTRAINED_CURSOR_QUALITY = {
  workId: "work-1",
  cadenceMs: 96,
  compactPoints: true,
  tier: "constrained" as const,
  reason: "save-data" as const,
  peerCount: 18,
  pending: false,
  acceptedCount: 42,
  sentCount: 17,
  coalescedCount: 25,
  compactedCount: 8,
  failedCount: 0,
  updatedAt: 1_000,
};

describe("StudioLivePresenceDock cursor collaboration controls", () => {
  it("exposes persistent cursor visibility and constrained-network feedback", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        alwaysOn
        operationSyncReady
        peers={[]}
        followingSessionId={null}
        onOpenTeam={vi.fn()}
        onToggleFollow={vi.fn()}
        remoteCursorsVisible={false}
        onToggleRemoteCursors={vi.fn()}
        cursorQuality={CONSTRAINED_CURSOR_QUALITY}
      />,
    );

    expect(html).toContain('data-studio-remote-cursor-visibility="hidden"');
    expect(html).toContain('aria-label="팀원 커서 표시하기"');
    expect(html).toContain('data-studio-cursor-quality="constrained"');
    expect(html).toContain("커서 절약");
    expect(html).toContain("96ms");
  });

  it("keeps the cursor control pressed while remote cursors are visible", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        alwaysOn
        peers={[]}
        followingSessionId={null}
        onOpenTeam={vi.fn()}
        onToggleFollow={vi.fn()}
        remoteCursorsVisible
        onToggleRemoteCursors={vi.fn()}
      />,
    );

    expect(html).toContain('data-studio-remote-cursor-visibility="visible"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="팀원 커서 숨기기"');
  });
});
