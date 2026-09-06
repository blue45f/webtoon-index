import { vi } from "vitest";

import { createEmptyStudioCommentsDocument } from "./studio-comments";

import type { StudioCommentsPanelSessionProps } from "./StudioCommentsPanelSession";

type StudioCommentsPanelSessionOverrides = Omit<
  Partial<StudioCommentsPanelSessionProps>,
  "stableHandlers"
> & {
  stableHandlers?: Partial<StudioCommentsPanelSessionProps["stableHandlers"]>;
};

export function createStudioCommentsPanelSessionProps(
  overrides: StudioCommentsPanelSessionOverrides = {}
): StudioCommentsPanelSessionProps {
  const { stableHandlers: stableHandlerOverrides, ...propOverrides } = overrides;
  const activeCommentAnchor = { type: "page", pageId: "page-1" } as const;
  const stableHandlers: StudioCommentsPanelSessionProps["stableHandlers"] = {
    applyStudioCommentsPanelChange: vi.fn(async () => true),
    markAllStudioCommentThreadsRead: vi.fn(async () => true),
    markStudioCommentThreadRead: vi.fn(async () => true),
    refreshStudioTeamComments: vi.fn(),
    selectStudioCommentAnchor: vi.fn(),
    ...stableHandlerOverrides,
  };

  return {
    activeCommentAnchor,
    collaborationDocumentLocked: false,
    commentsOpen: true,
    isStudioCommentAnchorValid: vi.fn(() => true),
    onArmCommentPinPlacement: vi.fn(),
    setCommentsOpen: vi.fn(),
    setStudioCommentFocusRequest: vi.fn(),
    setStudioCommentPinsHidden: vi.fn(),
    stableHandlers,
    studioCommentActor: { id: "user-1", displayName: "작가" },
    studioCommentAnchorOptions: [
      { anchor: activeCommentAnchor, label: "1페이지" },
    ],
    studioCommentFocusRequest: null,
    studioComments: createEmptyStudioCommentsDocument(),
    studioCommentPinsHidden: false,
    studioCommentSyncError: null,
    studioLegacyCommentThreadIdSet: new Set<string>(),
    studioTeamCommentCapabilities: null,
    studioTeamCommentsSyncing: false,
    studioTeamCommentsWorkId: null,
    studioTeamUnreadCommentIdSet: new Set<string>(),
    workId: null,
    ...propOverrides,
  };
}
