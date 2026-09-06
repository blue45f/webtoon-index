// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioCommentsPanelSession } from "./StudioCommentsPanelSession";
import { createStudioCommentsPanelSessionProps } from "./StudioCommentsPanelSession.test-fixture";

import type { StudioCommentsPanelProps } from "./StudioCommentsPanel";
import type { SetStateAction } from "react";

const panelHarness = vi.hoisted(() => ({
  nextInstanceId: 0,
  props: null as Record<string, unknown> | null,
}));

vi.mock("./StudioCommentsPanel", async () => {
  const { useEffect, useState } = await import("react");

  function MockStudioCommentsPanel(props: Record<string, unknown>) {
    const [instanceId] = useState(() => ++panelHarness.nextInstanceId);
    useEffect(() => {
      panelHarness.props = props;
    });
    return (
      <div
        data-comments-panel-instance={instanceId}
        data-comments-panel-open={String(props.open)}
      />
    );
  }

  return { StudioCommentsPanel: MockStudioCommentsPanel };
});

function currentPanelProps(): StudioCommentsPanelProps {
  expect(panelHarness.props).not.toBeNull();
  return panelHarness.props as unknown as StudioCommentsPanelProps;
}

beforeEach(() => {
  panelHarness.nextInstanceId = 0;
  panelHarness.props = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StudioCommentsPanelSession", () => {
  it("keeps the stateful panel instance mounted while the review rail closes and reopens", () => {
    const props = createStudioCommentsPanelSessionProps({ commentsOpen: true });
    const view = render(<StudioCommentsPanelSession {...props} />);
    const openedPanel = view.container.querySelector("[data-comments-panel-instance]");

    expect(openedPanel?.getAttribute("data-comments-panel-open")).toBe("true");
    expect(openedPanel?.getAttribute("data-comments-panel-instance")).toBe("1");

    view.rerender(
      <StudioCommentsPanelSession {...props} commentsOpen={false} />
    );
    const closedPanel = view.container.querySelector("[data-comments-panel-instance]");
    expect(closedPanel).toBe(openedPanel);
    expect(closedPanel?.getAttribute("data-comments-panel-open")).toBe("false");
    expect(closedPanel?.getAttribute("data-comments-panel-instance")).toBe("1");

    view.rerender(
      <StudioCommentsPanelSession {...props} commentsOpen />
    );
    const reopenedPanel = view.container.querySelector("[data-comments-panel-instance]");
    expect(reopenedPanel).toBe(openedPanel);
    expect(reopenedPanel?.getAttribute("data-comments-panel-open")).toBe("true");
    expect(reopenedPanel?.getAttribute("data-comments-panel-instance")).toBe("1");
  });

  it("forwards one controlled reply controller unchanged across rail close and reopen", () => {
    const sharedReply = {
      threadId: "thread-1",
      body: "핀에서 작성한 초안",
      mutationId: "reply-stable-1",
      submitting: true,
      onThreadChange: vi.fn(),
      onBodyChange: vi.fn(),
      onDiscard: vi.fn(),
      onSubmit: vi.fn(async () => true),
    };
    const props = createStudioCommentsPanelSessionProps({ sharedReply });
    const view = render(<StudioCommentsPanelSession {...props} />);

    expect(currentPanelProps().sharedReply).toBe(sharedReply);
    expect(currentPanelProps().sharedReply).toMatchObject({
      threadId: "thread-1",
      body: "핀에서 작성한 초안",
      mutationId: "reply-stable-1",
      submitting: true,
    });

    view.rerender(<StudioCommentsPanelSession {...props} commentsOpen={false} />);
    expect(currentPanelProps().sharedReply).toBe(sharedReply);
    view.rerender(<StudioCommentsPanelSession {...props} commentsOpen />);
    expect(currentPanelProps().sharedReply).toBe(sharedReply);
  });

  it("projects document and team permissions without exposing unsupported mutations", () => {
    const props = createStudioCommentsPanelSessionProps();
    const view = render(<StudioCommentsPanelSession {...props} />);

    expect(currentPanelProps().capabilities).toEqual({
      create: true,
      reply: true,
      editOwn: true,
      deleteOwn: true,
      resolve: true,
      assign: true,
    });
    expect(currentPanelProps().storageMode).toBe("document");
    expect(currentPanelProps().mutationDisabledReason).toBeUndefined();
    expect(currentPanelProps().onMarkThreadRead).toBeUndefined();
    expect(currentPanelProps().onMarkAllRead).toBeUndefined();

    view.rerender(
      <StudioCommentsPanelSession
        {...props}
        collaborationDocumentLocked
      />
    );
    expect(currentPanelProps().capabilities).toEqual({
      create: false,
      reply: false,
      editOwn: false,
      deleteOwn: false,
      resolve: false,
      assign: false,
    });

    view.rerender(
      <StudioCommentsPanelSession
        {...props}
        workId="work-1"
        studioTeamCommentCapabilities={null}
      />
    );
    expect(currentPanelProps().capabilities).toEqual({
      create: false,
      reply: false,
      editOwn: false,
      deleteOwn: false,
      resolve: false,
      assign: false,
    });
    expect(currentPanelProps().storageMode).toBe("team");
    expect(currentPanelProps().mutationDisabledReason).toBe(
      "팀 댓글 권한과 기록을 확인하는 중이에요."
    );

    view.rerender(
      <StudioCommentsPanelSession
        {...props}
        workId="work-1"
        studioTeamCommentsWorkId="work-1"
        studioTeamCommentCapabilities={{ view: true, comment: true, resolve: true }}
      />
    );
    expect(currentPanelProps().capabilities).toEqual({
      create: true,
      reply: true,
      editOwn: false,
      deleteOwn: false,
      resolve: true,
      assign: false,
    });
    expect(currentPanelProps().mutationDisabledReason).toBeUndefined();
    expect(currentPanelProps().onMarkThreadRead).toBe(
      props.stableHandlers.markStudioCommentThreadRead
    );
    expect(currentPanelProps().onMarkAllRead).toBe(
      props.stableHandlers.markAllStudioCommentThreadsRead
    );
    expect(currentPanelProps().onRefresh).toBe(
      props.stableHandlers.refreshStudioTeamComments
    );

    view.rerender(
      <StudioCommentsPanelSession
        {...props}
        workId="work-1"
        studioTeamCommentsWorkId="work-1"
        studioTeamCommentsSyncing
        studioTeamCommentCapabilities={{ view: true, comment: true, resolve: true }}
      />
    );
    expect(currentPanelProps().syncing).toBe(true);

    view.rerender(
      <StudioCommentsPanelSession
        {...props}
        workId="work-1"
        studioTeamCommentsWorkId="work-1"
        studioTeamCommentCapabilities={{ view: true, comment: false, resolve: false }}
      />
    );
    expect(currentPanelProps().capabilities).toEqual({
      create: false,
      reply: false,
      editOwn: false,
      deleteOwn: false,
      resolve: false,
      assign: false,
    });
    expect(currentPanelProps().mutationDisabledReason).toBe(
      "열람자는 댓글을 읽고 위치로 이동할 수 있지만 작성할 수는 없어요."
    );
    expect(currentPanelProps().onMarkThreadRead).toBe(
      props.stableHandlers.markStudioCommentThreadRead
    );
    expect(currentPanelProps().onMarkAllRead).toBe(
      props.stableHandlers.markAllStudioCommentThreadsRead
    );
  });

  it("preserves focus guards and delegates pin placement to the shared controller", () => {
    const order: string[] = [];
    const onArmCommentPinPlacement = vi.fn(() => order.push("arm"));
    const setCommentsOpen = vi.fn((value: SetStateAction<boolean>) => {
      if (value === false) order.push("close");
    });
    const props = createStudioCommentsPanelSessionProps({
      onArmCommentPinPlacement,
      setCommentsOpen,
      studioCommentFocusRequest: { threadId: "thread-1", requestId: 7 },
    });
    render(<StudioCommentsPanelSession {...props} />);

    currentPanelProps().onArmPinPlacement?.();
    expect(order).toEqual(["close", "arm"]);
    expect(onArmCommentPinPlacement).toHaveBeenCalledOnce();

    currentPanelProps().onFocusRequestHandled?.(7);
    const focusUpdater = vi.mocked(props.setStudioCommentFocusRequest).mock.calls[0]?.[0];
    expect(typeof focusUpdater).toBe("function");
    if (typeof focusUpdater !== "function") return;
    const matchingRequest = { threadId: "thread-1", requestId: 7 };
    const newerRequest = { threadId: "thread-2", requestId: 8 };
    expect(focusUpdater(matchingRequest)).toBeNull();
    expect(focusUpdater(newerRequest)).toBe(newerRequest);

    currentPanelProps().onTogglePinsHidden?.();
    const pinUpdater = vi.mocked(props.setStudioCommentPinsHidden).mock.calls[0]?.[0];
    expect(typeof pinUpdater).toBe("function");
    if (typeof pinUpdater !== "function") return;
    expect(pinUpdater(false)).toBe(true);
    expect(pinUpdater(true)).toBe(false);
  });
});
