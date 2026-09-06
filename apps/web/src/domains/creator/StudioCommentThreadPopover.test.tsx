// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioCommentThreadPopover } from "./StudioCommentThreadPopover";

import type { StudioCommentReply, StudioCommentThread } from "./studio-comments";
import type { ComponentProps } from "react";

const CREATED_AT = "2026-07-22T04:00:00.000Z";

function reply(index: number, body = `답글 ${index}`): StudioCommentReply {
  const createdAt = new Date(Date.parse(CREATED_AT) + index * 60_000).toISOString();
  return {
    id: `reply-${index}`,
    author: { id: `user-${index}`, displayName: `검토자 ${index}` },
    body,
    mentions: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function thread(overrides: Partial<StudioCommentThread> = {}): StudioCommentThread {
  return {
    id: "thread-1",
    anchor: { type: "point", pageId: "page-1", x: 0.25, y: 0.7 },
    author: { id: "author-1", displayName: "민지 작가" },
    body: "말풍선을 인물 쪽으로 조금 더 옮겨 주세요.",
    mentions: [],
    replies: [],
    resolved: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

type PopoverProps = ComponentProps<typeof StudioCommentThreadPopover>;
type ControlledPopoverProps = Omit<PopoverProps, "replyBody" | "onReplyBodyChange"> & {
  initialReplyBody?: string;
  onReplyBodyChange?: PopoverProps["onReplyBodyChange"];
};

function ControlledPopover({
  initialReplyBody = "",
  onReplyBodyChange,
  ...props
}: ControlledPopoverProps) {
  const [replyBody, setReplyBody] = useState(initialReplyBody);
  return (
    <StudioCommentThreadPopover
      {...props}
      replyBody={replyBody}
      onReplyBodyChange={(threadId, body) => {
        setReplyBody(body);
        onReplyBodyChange?.(threadId, body);
      }}
    />
  );
}

function baseProps(overrides: Partial<ControlledPopoverProps> = {}): ControlledPopoverProps {
  return {
    thread: thread(),
    screenPoint: { x: 120, y: 240 },
    onClose: vi.fn(),
    onOpenReview: vi.fn(),
    onSubmitReply: vi.fn(async () => true),
    onResolveChange: vi.fn(async () => true),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioCommentThreadPopover", () => {
  it("presents author, time, unread and resolution state beside the selected canvas pin", () => {
    const { rerender } = render(<ControlledPopover {...baseProps({ unread: true })} />);

    const dialog = screen.getByRole("dialog", { name: "민지 작가" });
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.getAttribute("data-studio-shortcut-boundary")).toBe("true");
    expect(dialog.getAttribute("data-presentation")).toBe("anchored-popover");
    expect(dialog.getAttribute("data-placement")).toBe("right");
    expect(dialog.style.left).toBe("136px");
    expect(screen.getByText("검토 중")).toBeTruthy();
    expect(screen.getByText("미확인")).toBeTruthy();
    expect(screen.getAllByText("민지 작가").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-studio-comment-thread-active-pin="true"]'))
      .not.toBeNull();

    rerender(
      <ControlledPopover
        {...baseProps({ unread: true, screenPoint: { x: 1_010, y: 240 } })}
      />
    );
    expect(screen.getByRole("dialog", { name: "민지 작가" }).getAttribute("data-placement"))
      .toBe("left");
  });

  it("summarizes recent messages, expands the full conversation inline, and safely wraps long text", () => {
    const longBody = `긴한글문자열${"가".repeat(80)} longEnglishToken${"x".repeat(120)}`;
    const replies = [
      reply(1),
      reply(2),
      reply(3),
      reply(4, longBody),
    ];
    render(
      <ControlledPopover
        {...baseProps({ thread: thread({ replies, updatedAt: replies[3]!.updatedAt }) })}
      />
    );

    const expand = screen.getByRole("button", { name: "이전 메시지 2개 보기" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("답글 1")).toBeNull();
    expect(screen.getByText("답글 2")).toBeTruthy();
    const longMessage = screen.getByText(longBody);
    expect(longMessage.className).toContain("break-words");
    expect(longMessage.className).toContain("[overflow-wrap:anywhere]");
    expect(longMessage.className).toContain("line-clamp-3");

    fireEvent.click(expand);
    expect(screen.getByText("답글 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "최근 메시지만 보기" }).getAttribute("aria-expanded"))
      .toBe("true");
    expect(screen.getByText(longBody).className).not.toContain("line-clamp-3");

    fireEvent.click(screen.getByRole("button", { name: "최근 메시지만 보기" }));
    expect(screen.queryByText("답글 1")).toBeNull();
  });

  it("submits a trimmed quick reply once, defers draft clearing to the parent, and supports Ctrl/Command+Enter", async () => {
    let settle!: (accepted: boolean) => void;
    const onReplyBodyChange = vi.fn();
    const onSubmitReply = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve;
    }));
    render(
      <ControlledPopover
        {...baseProps({ onReplyBodyChange, onSubmitReply })}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "빠른 답글" });
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    fireEvent.change(textarea, { target: { value: "  색감을 조금 더 차갑게 해 주세요.  " } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onSubmitReply).toHaveBeenCalledTimes(1);
    expect(onSubmitReply).toHaveBeenCalledWith(
      "thread-1",
      "색감을 조금 더 차갑게 해 주세요."
    );
    expect(onReplyBodyChange).toHaveBeenLastCalledWith(
      "thread-1",
      "  색감을 조금 더 차갑게 해 주세요.  "
    );
    expect(screen.getByRole("dialog", { name: "민지 작가" }).getAttribute("aria-busy"))
      .toBe("true");

    settle(true);
    expect((await screen.findByRole("status")).textContent).toContain("답글을 등록했어요");
    expect(textarea.value).toBe("  색감을 조금 더 차갑게 해 주세요.  ");
  });

  it("keeps a failed reply draft, reports the callback reason, and unlocks retry", async () => {
    const onSubmitReply = vi.fn(async () => {
      throw new Error("연결이 끊어졌어요. 다시 시도해 주세요.");
    });
    render(
      <ControlledPopover
        {...baseProps({ onSubmitReply })}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "빠른 답글" });
    fireEvent.change(textarea, { target: { value: "보존할 답글 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "답글" }));

    expect((await screen.findByRole("alert")).textContent).toContain("연결이 끊어졌어요");
    expect(textarea.value).toBe("보존할 답글 초안");
    expect(screen.getByRole("button", { name: "답글" })).toHaveProperty("disabled", false);
  });

  it("ignores a late mutation result after the parent selects a different thread", async () => {
    let settle!: (accepted: boolean) => void;
    const onSubmitReply = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve;
    }));
    const { rerender } = render(
      <ControlledPopover {...baseProps({ onSubmitReply })} />
    );

    const textarea = screen.getByRole("textbox", { name: "빠른 답글" });
    fireEvent.change(textarea, { target: { value: "이전 스레드 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "답글" }));
    expect(onSubmitReply).toHaveBeenCalledWith("thread-1", "이전 스레드 초안");

    rerender(
      <ControlledPopover
        {...baseProps({
          thread: thread({
            id: "thread-2",
            author: { id: "author-2", displayName: "서윤 작가" },
          }),
          onSubmitReply,
        })}
      />
    );
    await act(async () => settle(true));

    expect(screen.getByRole("dialog", { name: "서윤 작가" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "답글" })).toHaveProperty("disabled", false);
  });

  it("keeps the canvas interactive while protecting a draft on incidental outside input", async () => {
    const onClose = vi.fn();
    const onOpenReview = vi.fn();
    const canvasControl = document.createElement("button");
    const onCanvasPointerDown = vi.fn();
    canvasControl.addEventListener("pointerdown", onCanvasPointerDown);
    document.body.append(canvasControl);
    const view = render(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview })}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "빠른 답글" });
    fireEvent.change(textarea, { target: { value: "사라지면 안 되는 초안" } });
    expect(document.querySelector('[data-studio-comment-thread-backdrop="true"]')).toBeNull();

    canvasControl.focus();
    fireEvent.pointerDown(canvasControl, { button: 0, isPrimary: true });
    expect(onCanvasPointerDown).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("작성 중인 답글은 유지했어요");
    expect(screen.getByRole("button", {
      name: "답글 초안을 버리고 댓글 대화창 닫기",
    })).toBeTruthy();
    expect(document.activeElement).toBe(canvasControl);

    view.rerender(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview, syncing: true })}
      />
    );
    view.rerender(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview, syncing: false })}
      />
    );
    await act(async () => {
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(canvasControl);

    textarea.focus();
    view.rerender(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview, syncing: true })}
      />
    );
    view.rerender(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview, syncing: false })}
      />
    );
    await act(async () => {
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(textarea);

    fireEvent.click(screen.getByRole("button", { name: "전체 댓글 검토함에서 열기" }));
    expect(onOpenReview).toHaveBeenCalledWith("thread-1");
    expect(textarea.value).toBe("사라지면 안 되는 초안");
    canvasControl.remove();
  });

  it("uses the opening control only for the first autofocus handoff", async () => {
    const openingControl = document.createElement("button");
    document.body.append(openingControl);
    openingControl.focus();

    try {
      const view = render(<ControlledPopover {...baseProps()} />);
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "빠른 답글" });
      await waitFor(() => expect(document.activeElement).toBe(textarea));

      openingControl.focus();
      view.rerender(<ControlledPopover {...baseProps({ syncing: true })} />);
      view.rerender(<ControlledPopover {...baseProps({ syncing: false })} />);
      await act(async () => {
        await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
      });

      expect(document.activeElement).toBe(openingControl);
    } finally {
      openingControl.remove();
    }
  });

  it("closes on an empty outside click or Escape, ignores secondary pointers, and opens review by id", () => {
    const onClose = vi.fn();
    const onOpenReview = vi.fn();
    const canvasControl = document.createElement("button");
    document.body.append(canvasControl);
    const { rerender } = render(
      <ControlledPopover
        {...baseProps({ onClose, onOpenReview })}
      />
    );

    fireEvent.pointerDown(canvasControl, { button: 2 });
    fireEvent.pointerDown(canvasControl, { button: 0, isPrimary: false });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "전체 댓글 검토함에서 열기" }));
    expect(onOpenReview).toHaveBeenCalledWith("thread-1");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "민지 작가" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith("escape");

    rerender(<ControlledPopover {...baseProps({ onClose, onOpenReview })} />);
    fireEvent.pointerDown(canvasControl, { button: 0, isPrimary: true });
    expect(onClose).toHaveBeenLastCalledWith("outside-pointer");

    fireEvent.click(screen.getByRole("button", { name: "댓글 대화창 닫기" }));
    expect(onClose).toHaveBeenLastCalledWith("explicit");
    canvasControl.remove();
  });

  it("returns focus to the canvas when resolving removes the source pin", () => {
    const sourcePin = document.createElement("button");
    const canvas = document.createElement("div");
    canvas.tabIndex = -1;
    document.body.append(sourcePin, canvas);
    sourcePin.focus();

    const view = render(
      <ControlledPopover {...baseProps({ fallbackFocusTarget: canvas })} />
    );
    sourcePin.remove();
    view.unmount();

    expect(document.activeElement).toBe(canvas);
    canvas.remove();
  });

  it("changes resolution through the parent callback and exposes permission or sync restrictions", async () => {
    const onResolveChange = vi.fn(async () => true);
    const { rerender } = render(
      <ControlledPopover
        {...baseProps({ onResolveChange })}
      />
    );

    const resolveButton = screen.getByRole("button", { name: "민지 작가의 댓글 해결 처리" });
    expect(resolveButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(resolveButton);
    await waitFor(() => expect(onResolveChange).toHaveBeenCalledWith("thread-1", true));
    expect((await screen.findByRole("status")).textContent).toContain("해결 처리했어요");

    rerender(
      <ControlledPopover
        {...baseProps({
          thread: thread({
            resolved: true,
            resolvedAt: "2026-07-22T04:10:00.000Z",
            resolvedBy: { id: "owner-1", displayName: "담당 작가" },
            updatedAt: "2026-07-22T04:10:00.000Z",
          }),
          onResolveChange,
        })}
      />
    );
    expect(screen.getByText("해결됨")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "빠른 답글" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "민지 작가의 댓글 다시 열기" }));
    await waitFor(() => expect(onResolveChange).toHaveBeenLastCalledWith("thread-1", false));

    rerender(
      <ControlledPopover
        {...baseProps({ submitting: true })}
      />
    );
    expect(screen.getByRole("dialog", { name: "민지 작가" }).getAttribute("aria-busy"))
      .toBe("true");
    expect(screen.getByRole("textbox", { name: "빠른 답글" }).getAttribute("aria-readonly"))
      .toBe("true");
    expect(screen.getByRole("button", { name: "등록 중" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "댓글 대화창 닫기" }))
      .toHaveProperty("disabled", true);

    rerender(
      <ControlledPopover
        {...baseProps({
          capabilities: { reply: false, resolve: false },
          mutationDisabledReason: "열람자는 댓글을 변경할 수 없어요.",
          syncError: "댓글 동기화를 다시 시도해 주세요.",
        })}
      />
    );
    expect(screen.getByText("열람자는 댓글을 변경할 수 없어요.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "빠른 답글" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "민지 작가의 댓글 해결 처리" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("댓글 동기화를 다시 시도해 주세요");

    rerender(
      <ControlledPopover
        {...baseProps({
          mutationDisabledReason: "다른 댓글의 초안을 먼저 복구해 주세요.",
        })}
      />
    );
    expect(screen.getByRole("textbox", { name: "빠른 답글" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "민지 작가의 댓글 해결 처리" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByText("다른 댓글의 초안을 먼저 복구해 주세요.")).toBeTruthy();
  });

  it("navigates a clustered pin one thread at a time and protects an active draft", () => {
    const onNavigateCluster = vi.fn();
    render(
      <ControlledPopover
        {...baseProps({
          clusterIndex: 1,
          clusterCount: 3,
          unreadClusterCount: 2,
          onNavigateCluster,
        })}
      />
    );

    expect(screen.getByText(/같은 위치 2/)).toBeTruthy();
    expect(screen.getByText("미확인 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 위치 댓글" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 위치 댓글" }));
    expect(onNavigateCluster.mock.calls).toEqual([[-1], [1]]);

    fireEvent.change(screen.getByRole("textbox", { name: "빠른 답글" }), {
      target: { value: "이 댓글에 남길 초안" },
    });
    expect(screen.getByRole("button", { name: "이전 위치 댓글" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "다음 위치 댓글" }))
      .toHaveProperty("disabled", true);
  });

  it("uses a keyboard-safe non-modal bottom sheet on mobile without trapping focus", async () => {
    const originalViewport = globalThis.visualViewport;
    const viewportListeners = new Set<EventListenerOrEventListenerObject>();
    const mobileViewport = {
      offsetLeft: 0,
      offsetTop: 20,
      width: 320,
      height: 300,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "resize" || type === "scroll") viewportListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "resize" || type === "scroll") viewportListeners.delete(listener);
      }),
    };
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: mobileViewport,
    });
    const trigger = document.createElement("button");
    trigger.textContent = "댓글 핀";
    document.body.append(trigger);
    trigger.focus();

    try {
      const view = render(<ControlledPopover {...baseProps()} />);
      const dialog = screen.getByRole("dialog", { name: "민지 작가" });
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "빠른 답글" });
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      expect(dialog.getAttribute("aria-modal")).toBe("false");
      expect(dialog.getAttribute("data-presentation")).toBe("bottom-sheet");
      expect(dialog.getAttribute("data-placement")).toBe("bottom");
      expect(dialog.style.left).toBe("0px");
      expect(dialog.style.top).toBe("20px");
      expect(dialog.style.width).toBe("320px");
      expect(dialog.style.maxHeight).toBe("300px");
      expect(dialog.className).toContain("motion-safe:animate-in");
      expect(dialog.className).toContain("motion-safe:slide-in-from-bottom-3");

      fireEvent.change(textarea, { target: { value: "포커스 순환" } });
      const submit = screen.getByRole("button", { name: "답글" });
      const first = screen.getByRole("button", { name: "전체 댓글 검토함에서 열기" });
      submit.focus();
      expect(fireEvent.keyDown(submit, { key: "Tab" })).toBe(true);
      expect(document.activeElement).toBe(submit);

      expect(first.className).toContain("size-11");
      expect(submit.className).toContain("min-h-11");
      expect(submit.className).toContain("motion-reduce:transition-none");
      expect(submit.closest("form")?.className).toContain("safe-area-inset-bottom");

      mobileViewport.offsetTop = 36;
      mobileViewport.height = 244;
      act(() => {
        const event = new Event("resize");
        viewportListeners.forEach((listener) => {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        });
      });
      await waitFor(() => {
        expect(dialog.style.top).toBe("36px");
        expect(dialog.style.maxHeight).toBe("244px");
      });

      view.unmount();
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
      Object.defineProperty(globalThis, "visualViewport", {
        configurable: true,
        value: originalViewport,
      });
    }
  });

  it("keeps every bottom-sheet action at least 44px on a wide coarse-pointer device", () => {
    const originalViewport = globalThis.visualViewport;
    const originalMatchMedia = globalThis.matchMedia;
    const coarsePointer = new EventTarget() as MediaQueryList;
    Object.defineProperties(coarsePointer, {
      matches: { configurable: true, value: true },
      media: { configurable: true, value: "(pointer: coarse)" },
      onchange: { configurable: true, value: null, writable: true },
      addListener: { configurable: true, value: vi.fn() },
      removeListener: { configurable: true, value: vi.fn() },
    });
    const wideViewport = new EventTarget();
    Object.assign(wideViewport, {
      offsetLeft: 0,
      offsetTop: 0,
      width: 1_024,
      height: 768,
    });
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: wideViewport,
    });
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: vi.fn(() => coarsePointer),
    });

    try {
      const view = render(
        <ControlledPopover
          {...baseProps({
            clusterCount: 2,
            onNavigateCluster: vi.fn(),
          })}
        />
      );
      const dialog = screen.getByRole("dialog", { name: "민지 작가" });
      expect(dialog.getAttribute("data-presentation")).toBe("bottom-sheet");
      expect(dialog.style.left).toBe("272px");
      expect(dialog.style.width).toBe("480px");

      const squareActions = [
        screen.getByRole("button", { name: "전체 댓글 검토함에서 열기" }),
        screen.getByRole("button", { name: "댓글 대화창 닫기" }),
        screen.getByRole("button", { name: "이전 위치 댓글" }),
        screen.getByRole("button", { name: "다음 위치 댓글" }),
      ];
      squareActions.forEach((action) => {
        expect(action.className).toContain("size-11");
        expect(action.className).not.toContain("size-10");
        expect(action.className).not.toContain("size-9");
      });
      expect(screen.getByRole("button", { name: "민지 작가의 댓글 해결 처리" }).className)
        .toContain("min-h-11");
      expect(screen.getByRole("button", { name: "답글" }).className)
        .toContain("min-h-11");
      view.unmount();
    } finally {
      Object.defineProperty(globalThis, "visualViewport", {
        configurable: true,
        value: originalViewport,
      });
      Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("tracks a live pin once per dirty frame without idle bounding-box polling", () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const observers: Array<{
      callback: ResizeObserverCallback;
      targets: Set<Element>;
    }> = [];
    class ResizeObserverMock {
      readonly callback: ResizeObserverCallback;
      readonly targets = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(target: Element): void {
        this.targets.add(target);
      }

      unobserve(target: Element): void {
        this.targets.delete(target);
      }

      disconnect(): void {
        this.targets.clear();
      }
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock,
    });
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    };
    const anchor = document.createElement("button");
    let rect = {
      left: 180,
      top: 120,
      width: 40,
      height: 40,
      right: 220,
      bottom: 160,
      x: 180,
      y: 120,
      toJSON: () => ({}),
    };
    const readAnchorRect = vi.fn(() => rect);
    anchor.getBoundingClientRect = readAnchorRect;
    document.body.append(anchor);

    try {
      const view = render(
        <ControlledPopover
          {...baseProps({
            anchorElement: anchor,
            screenPoint: { x: 12, y: 24 },
          })}
        />
      );

      const dialog = screen.getByRole("dialog", { name: "민지 작가" });
      const activePin = document.querySelector<HTMLElement>(
        '[data-studio-comment-thread-active-pin="true"]'
      );
      expect(readAnchorRect).not.toHaveBeenCalled();
      flushFrames();
      expect(readAnchorRect).toHaveBeenCalledTimes(1);
      expect(activePin?.style.left).toBe("200px");
      expect(activePin?.style.top).toBe("140px");
      expect(dialog.style.left).toBe("216px");
      expect(frames.size).toBe(0);

      rect = {
        ...rect,
        left: 680,
        top: 280,
        right: 720,
        bottom: 320,
        x: 680,
        y: 280,
      };
      fireEvent.scroll(window);
      fireEvent.pointerMove(window, { clientX: 80, clientY: 90 });
      fireEvent.wheel(window, { deltaY: 60 });
      expect(readAnchorRect).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(1);
      flushFrames();
      expect(readAnchorRect).toHaveBeenCalledTimes(2);
      expect(activePin?.style.left).toBe("700px");
      expect(activePin?.style.top).toBe("300px");
      expect(dialog.getAttribute("data-placement")).toBe("left");
      expect(dialog.style.left).toBe("324px");
      expect(frames.size).toBe(0);

      rect = {
        ...rect,
        left: 520,
        right: 560,
        x: 520,
      };
      const anchorObserver = observers.find((observer) => observer.targets.has(anchor));
      expect(anchorObserver).toBeTruthy();
      act(() => anchorObserver?.callback([], anchorObserver as unknown as ResizeObserver));
      expect(frames.size).toBe(1);
      expect(readAnchorRect).toHaveBeenCalledTimes(2);
      flushFrames();
      expect(readAnchorRect).toHaveBeenCalledTimes(3);
      expect(activePin?.style.left).toBe("540px");
      expect(frames.size).toBe(0);

      rect = {
        ...rect,
        left: 600,
        right: 640,
        x: 600,
      };
      view.rerender(
        <ControlledPopover
          {...baseProps({
            anchorElement: anchor,
            screenPoint: { x: 12, y: 24 },
            thread: thread({ updatedAt: "2026-07-22T04:01:00.000Z" }),
          })}
        />
      );
      expect(frames.size).toBe(1);
      flushFrames();
      expect(readAnchorRect).toHaveBeenCalledTimes(4);
      expect(activePin?.style.left).toBe("620px");

      anchor.remove();
      fireEvent.scroll(window);
      flushFrames();
      expect(activePin?.style.left).toBe("12px");
      expect(activePin?.style.top).toBe("24px");
      expect(readAnchorRect).toHaveBeenCalledTimes(4);
      view.unmount();
      expect(frames.size).toBe(0);
    } finally {
      anchor.remove();
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
      });
    }
  });
});
