// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_COMMENTS_MAX_BODY_LENGTH } from "./studio-comments";
import {
  StudioPointCommentComposer,
  type StudioPointCommentComposerProps,
} from "./StudioPointCommentComposer";

const originalVisualViewport = globalThis.visualViewport;
const originalMatchMedia = globalThis.matchMedia;

function restoreGlobalProperty<K extends "visualViewport" | "matchMedia">(
  key: K,
  value: Window[K]
): void {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

interface MutableVisualViewport extends EventTarget {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
}

interface MutableMediaQueryList extends EventTarget {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null;
  addListener: (listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null) => void;
  removeListener: (listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null) => void;
}

function installVisualViewport(values: {
  offsetLeft?: number;
  offsetTop?: number;
  width: number;
  height: number;
}): MutableVisualViewport {
  const viewport = new EventTarget() as MutableVisualViewport;
  viewport.offsetLeft = values.offsetLeft ?? 0;
  viewport.offsetTop = values.offsetTop ?? 0;
  viewport.width = values.width;
  viewport.height = values.height;
  Object.defineProperty(globalThis, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  return viewport;
}

function installCoarsePointer(matches: boolean): MutableMediaQueryList {
  const query = new EventTarget() as MutableMediaQueryList;
  query.matches = matches;
  query.media = "(pointer: coarse)";
  query.onchange = null;
  query.addListener = vi.fn();
  query.removeListener = vi.fn();
  restoreGlobalProperty("matchMedia", vi.fn(() => query as MediaQueryList));
  return query;
}

function renderComposer(
  overrides: Partial<StudioPointCommentComposerProps> = {}
): ReturnType<typeof render> {
  return render(
    <StudioPointCommentComposer
      anchor={{ type: "point", pageId: "page-1", x: 0.257, y: 0.734 }}
      authorName="민지 작가"
      screenPoint={{ x: 120, y: 240 }}
      onCancel={vi.fn()}
      onSubmit={vi.fn(async () => true)}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreGlobalProperty("visualViewport", originalVisualViewport);
  restoreGlobalProperty("matchMedia", originalMatchMedia);
});

describe("StudioPointCommentComposer", () => {
  it("is a non-modal anchored popover with no viewport-intercepting backdrop", async () => {
    const onCancel = vi.fn();
    renderComposer({ onCancel });

    const dialog = screen.getByRole("dialog", { name: "위치 댓글 작성" });
    const textarea = screen.getByRole("textbox", { name: "위치 댓글 내용" });
    await waitFor(() => expect(globalThis.document.activeElement).toBe(textarea));

    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.getAttribute("data-studio-point-comment-layout")).toBe("popover");
    expect(dialog.getAttribute("data-presentation")).toBe("anchored-popover");
    expect(dialog.getAttribute("data-studio-shortcut-boundary")).toBe("true");
    expect(document.querySelector('[data-studio-point-comment-backdrop="true"]')).toBeNull();
    expect(screen.getByText("26%, 73% · 민지 작가")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("leaves canvas wheel and pan gestures outside the card untouched", () => {
    const onCancel = vi.fn();
    const onWheel = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    render(
      <>
        <canvas
          aria-label="편집 캔버스"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        <StudioPointCommentComposer
          anchor={{ type: "point", pageId: "page-1", x: 0.5, y: 0.5 }}
          authorName="검토자"
          screenPoint={{ x: 200, y: 200 }}
          onCancel={onCancel}
          onSubmit={vi.fn(async () => true)}
        />
      </>
    );

    const canvas = screen.getByLabelText("편집 캔버스");
    expect(fireEvent.wheel(canvas, { deltaY: 80 })).toBe(true);
    expect(fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, isPrimary: true })).toBe(true);
    expect(fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 40 })).toBe(true);
    expect(fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, isPrimary: true })).toBe(true);

    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("autofocuses and submits the trimmed draft with Ctrl/Command+Enter", async () => {
    const onSubmit = vi.fn(async () => true);
    renderComposer({ onSubmit });

    const textarea = screen.getByRole("textbox", { name: "위치 댓글 내용" });
    await waitFor(() => expect(globalThis.document.activeElement).toBe(textarea));
    expect(textarea.getAttribute("aria-keyshortcuts")).toBe(
      "Meta+Enter Control+Enter Escape"
    );
    fireEvent.change(textarea, { target: { value: "  말풍선을 조금 위로 옮겨 주세요.  " } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("말풍선을 조금 위로 옮겨 주세요.");
    });
  });

  it("supports Command+Enter and ignores submit or cancel shortcuts during IME composition", async () => {
    const onSubmit = vi.fn(async () => true);
    const onCancel = vi.fn();
    renderComposer({ onCancel, onSubmit });

    const textarea = screen.getByRole("textbox", { name: "위치 댓글 내용" });
    fireEvent.change(textarea, { target: { value: "한글 조합 뒤 등록" } });
    fireEvent.keyDown(textarea, {
      isComposing: true,
      key: "Enter",
      metaKey: true,
    });
    fireEvent.keyDown(textarea, { isComposing: true, key: "Escape" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("한글 조합 뒤 등록"));
  });

  it("cancels with Escape but does not trap ordinary Tab navigation", () => {
    const onCancel = vi.fn();
    renderComposer({ onCancel, onOpenReview: vi.fn() });

    const close = screen.getByRole("button", { name: "위치 댓글 작성 취소" });
    close.focus();
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("preserves a draft while the canvas is used and guards the review transition", async () => {
    const onCancel = vi.fn();
    const onOpenReview = vi.fn();
    render(
      <>
        <canvas aria-label="편집 캔버스" />
        <StudioPointCommentComposer
          anchor={{ type: "point", pageId: "page-1", x: 0.5, y: 0.5 }}
          authorName="검토자"
          screenPoint={{ x: 200, y: 200 }}
          onCancel={onCancel}
          onOpenReview={onOpenReview}
          onSubmit={vi.fn(async () => true)}
        />
      </>
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "위치 댓글 내용",
    });
    fireEvent.change(textarea, { target: { value: "지우면 안 되는 작성 중 피드백" } });
    fireEvent.pointerDown(screen.getByLabelText("편집 캔버스"), {
      button: 0,
      pointerId: 1,
      isPrimary: true,
    });

    expect(textarea.value).toBe("지우면 안 되는 작성 중 피드백");
    expect(onCancel).not.toHaveBeenCalled();
    const reviewButton = screen.getByRole("button", { name: "댓글 검토함 열기" });
    expect(reviewButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(reviewButton);
    expect(onOpenReview).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("작성 중인 댓글은 유지했어요");
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it("opens the review inbox directly when the draft is empty", () => {
    const onOpenReview = vi.fn();
    renderComposer({ onOpenReview });

    const reviewButton = screen.getByRole("button", { name: "댓글 검토함 열기" });
    expect(reviewButton.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(reviewButton);
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });

  it("keeps cancel, review, and duplicate submit transitions locked in flight", async () => {
    let settle!: (accepted: boolean) => void;
    const onCancel = vi.fn();
    const onOpenReview = vi.fn();
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve;
    }));
    renderComposer({ onCancel, onOpenReview, onSubmit });

    const textarea = screen.getByRole("textbox", { name: "위치 댓글 내용" });
    fireEvent.change(textarea, { target: { value: "저장 중인 댓글" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "위치 댓글 작성" }).getAttribute("aria-busy"))
        .toBe("true");
    });

    expect(screen.getByRole("button", { name: "댓글 검토함 열기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "위치 댓글 작성 취소" }))
      .toHaveProperty("disabled", true);
    expect(textarea).toHaveProperty("readOnly", true);
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.submit(screen.getByRole("dialog", { name: "위치 댓글 작성" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOpenReview).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => settle(false));
    expect((await screen.findByRole("alert")).textContent).toContain("댓글을 저장하지 못했어요");
    expect(screen.getByRole("button", { name: "위치 댓글 작성 취소" }))
      .toHaveProperty("disabled", false);
  });

  it("keeps a failed draft and exposes a specific retry reason", async () => {
    renderComposer({
      onSubmit: async () => {
        throw new Error("네트워크 연결을 확인해 주세요.");
      },
    });

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "위치 댓글 내용",
    });
    fireEvent.change(textarea, { target: { value: "보존할 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    expect((await screen.findByRole("alert")).textContent).toContain("네트워크 연결을 확인해 주세요.");
    expect(textarea.value).toBe("보존할 초안");
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it("bounds very long feedback and keeps the form body scrollable", () => {
    const onSubmit = vi.fn(async () => true);
    renderComposer({ onSubmit });
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "위치 댓글 내용",
    });
    const longBody = "가".repeat(STUDIO_COMMENTS_MAX_BODY_LENGTH + 25);

    fireEvent.change(textarea, { target: { value: longBody } });
    expect(textarea.value).toHaveLength(STUDIO_COMMENTS_MAX_BODY_LENGTH);
    expect(screen.getByText("4,000/4,000")).toBeTruthy();
    expect(textarea.parentElement?.className).toContain("overflow-y-auto");
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    expect(onSubmit).toHaveBeenCalledWith("가".repeat(STUDIO_COMMENTS_MAX_BODY_LENGTH));
  });

  it("uses a visual-viewport bottom sheet with safe-area and 44px controls on mobile", async () => {
    const viewport = installVisualViewport({
      offsetTop: 20,
      width: 320,
      height: 500,
    });
    renderComposer({ screenPoint: { x: 160, y: 300 }, onOpenReview: vi.fn() });

    const dialog = screen.getByRole("dialog", { name: "위치 댓글 작성" });
    expect(dialog.getAttribute("data-studio-point-comment-layout")).toBe("sheet");
    expect(dialog.style.left).toBe("0px");
    expect(dialog.style.top).toBe("296px");
    expect(dialog.style.width).toBe("320px");
    expect(dialog.style.maxHeight).toBe("492px");
    expect(dialog.className).toContain("safe-area-inset-bottom");
    expect(dialog.className).toContain("safe-area-inset-left");
    expect(dialog.className).toContain("safe-area-inset-right");
    expect(screen.getByRole("button", { name: "위치 댓글 작성 취소" }).className)
      .toContain("size-11");
    expect(screen.getByRole("button", { name: "댓글 검토함 열기" }).className)
      .toContain("min-h-11");
    expect(screen.getByRole("button", { name: "등록" }).className)
      .toContain("min-h-11");

    viewport.offsetTop = 120;
    viewport.height = 260;
    act(() => viewport.dispatchEvent(new Event("resize")));
    await waitFor(() => {
      expect(dialog.style.top).toBe("156px");
      expect(dialog.style.maxHeight).toBe("252px");
    });
  });

  it("switches a wide hybrid device between coarse sheet and fine-pointer popover layouts", async () => {
    installVisualViewport({ width: 1_024, height: 768 });
    const coarsePointer = installCoarsePointer(true);
    renderComposer({ screenPoint: { x: 240, y: 280 }, onOpenReview: vi.fn() });

    const dialog = screen.getByRole("dialog", { name: "위치 댓글 작성" });
    expect(dialog.getAttribute("data-studio-point-comment-layout")).toBe("sheet");
    expect(dialog.style.left).toBe("272px");
    expect(dialog.style.width).toBe("480px");
    expect(screen.getByRole("button", { name: "위치 댓글 작성 취소" }).className)
      .toContain("size-11");
    expect(screen.getByRole("button", { name: "댓글 검토함 열기" }).className)
      .toContain("min-h-11");
    expect(screen.getByRole("button", { name: "등록" }).className)
      .toContain("min-h-11");

    coarsePointer.matches = false;
    act(() => coarsePointer.dispatchEvent(new Event("change")));
    await waitFor(() => {
      expect(dialog.getAttribute("data-studio-point-comment-layout")).toBe("popover");
      expect(dialog.style.left).toBe("256px");
      expect(dialog.style.width).toBe("336px");
    });
  });

  it("reprojects a live anchor once per dirty frame without idle layout polling", () => {
    let nextPoint: { x: number; y: number } | null = { x: 260, y: 320 };
    const getScreenPoint = vi.fn(() => nextPoint);
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

    const view = renderComposer({ getScreenPoint });
    const pin = document.querySelector<HTMLElement>('[data-studio-point-comment-pin="true"]')!;
    expect(pin.style.left).toBe("120px");
    expect(pin.style.top).toBe("240px");
    expect(getScreenPoint).not.toHaveBeenCalled();

    flushFrames();
    expect(getScreenPoint).toHaveBeenCalledTimes(1);
    expect(pin.style.left).toBe("260px");
    expect(pin.style.top).toBe("320px");
    expect(frames.size).toBe(0);

    nextPoint = { x: 420, y: 360 };
    fireEvent.pointerMove(window, { clientX: 20, clientY: 30 });
    fireEvent.wheel(window, { deltaY: 80 });
    fireEvent.scroll(window);
    expect(getScreenPoint).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(getScreenPoint).toHaveBeenCalledTimes(2);
    expect(pin.style.left).toBe("420px");
    expect(pin.style.top).toBe("360px");
    expect(frames.size).toBe(0);

    fireEvent.pointerMove(window, { clientX: 21, clientY: 31 });
    flushFrames();
    expect(getScreenPoint).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);

    nextPoint = null;
    fireEvent.scroll(window);
    flushFrames();
    expect(getScreenPoint).toHaveBeenCalledTimes(4);
    expect(pin.style.left).toBe("120px");
    expect(pin.style.top).toBe("240px");

    view.unmount();
    expect(frames.size).toBe(0);
  });
});
