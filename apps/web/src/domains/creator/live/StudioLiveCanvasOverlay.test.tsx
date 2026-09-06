// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioCommentThread,
  createEmptyStudioCommentsDocument,
} from "../studio-comments";

import {
  projectStudioCanvasCommentPins,
  STUDIO_LIVE_PARTICIPANT_COLORS,
  studioLiveParticipantColor,
} from "./studio-live-canvas-overlay-model";
import {
  StudioLiveCanvasOverlay,
  StudioLivePresenceDock,
  StudioRemoteCursorOverlay,
} from "./StudioLiveCanvasOverlay";

import type { StudioLiveSyncSnapshot } from "./studio-live-sync-safety";

const noop = () => undefined;

afterEach(() => cleanup());

function syncedSnapshot(
  overrides: Partial<StudioLiveSyncSnapshot> = {}
): StudioLiveSyncSnapshot {
  return {
    phase: "synced",
    pendingCount: 0,
    persistenceDurability: "durable",
    transportReady: true,
    operationSyncReady: true,
    lastAckAt: 1_000,
    lastAckServerSequence: "9",
    editsDurablyProtected: true,
    message: "팀 원고가 실시간으로 동기화됩니다.",
    mode: "server",
    ...overrides,
  };
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16) / 255
  );
  const linear = [red, green, blue].map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function commentsFixture() {
  const actor = { id: "user-1", displayName: "민지" };
  const first = addStudioCommentThread(
    createEmptyStudioCommentsDocument(),
    {
      id: "thread-page",
      anchor: { type: "page", pageId: "page-1" },
      author: actor,
      body: "페이지 호흡 확인",
    },
    new Date("2026-07-13T00:00:00.000Z")
  );
  const second = addStudioCommentThread(
    first,
    {
      id: "thread-element-1",
      anchor: { type: "element", pageId: "page-1", elementId: "element-1" },
      author: actor,
      body: "표정 확인",
    },
    new Date("2026-07-13T00:01:00.000Z")
  );
  return addStudioCommentThread(
    second,
    {
      id: "thread-element-2",
      anchor: { type: "element", pageId: "page-1", elementId: "element-1" },
      author: actor,
      body: "말풍선 간격 확인",
    },
    new Date("2026-07-13T00:02:00.000Z")
  );
}

function movablePointPin(overrides: Partial<{
  key: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  count: number;
  threadIds: readonly string[];
}> = {}) {
  return {
    key: overrides.key ?? "point-pin",
    anchor: {
      type: "point" as const,
      pageId: "page-1",
      x: overrides.anchorX ?? 0.25,
      y: overrides.anchorY ?? 0.25,
    },
    count: overrides.count ?? 1,
    threadIds: overrides.threadIds ?? ["thread-point"],
    newestThreadId: "thread-point",
    previewAuthor: "민지",
    previewBody: "이 위치를 확인해 주세요.",
    label: "검토 위치",
    x: overrides.x ?? 200,
    y: overrides.y ?? 300,
  };
}

function mockOverlayRect(
  overlay: HTMLElement,
  rect: { left: number; top: number; width: number; height: number }
): void {
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    ...rect,
    toJSON: () => ({}),
  });
}

describe("StudioLiveCanvasOverlay", () => {
  it("groups unresolved threads by anchor and follows element bounds without changing comment data", () => {
    const document = commentsFixture();
    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 800,
      canvasHeight: 1_200,
      boundsByElementId: new Map([
        ["element-1", { x: 120, y: 260, width: 300, height: 180 }],
      ]),
    });

    expect(pins).toHaveLength(2);
    expect(pins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, x: 24, y: 24 }),
        expect.objectContaining({
          count: 2,
          x: 420,
          y: 260,
          previewAuthor: "민지",
          previewBody: "말풍선 간격 확인",
        }),
      ])
    );
    expect(document.threads).toHaveLength(3);
  });

  it("omits orphaned object anchors and clamps pins to the visible canvas", () => {
    const document = commentsFixture();
    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 200,
      canvasHeight: 160,
      boundsByElementId: new Map([
        ["element-1", { x: 190, y: -40, width: 80, height: 20 }],
      ]),
    });

    expect(pins.find((pin) => pin.anchor.type === "element")).toMatchObject({ x: 200, y: 0 });
    const withoutTarget = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 200,
      canvasHeight: 160,
      boundsByElementId: new Map(),
    });
    expect(withoutTarget).toHaveLength(1);
    expect(withoutTarget[0].anchor.type).toBe("page");
  });

  it("renders normalized remote cursors and accessible comment pins without exposing session ids", () => {
    const privateSessionId = "private-session-id-never-render";
    const html = renderToStaticMarkup(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[
          {
            participant: {
              sessionId: privateSessionId,
              displayName: "서윤 · 이 탭",
              role: "editor",
            },
            cursor: { x: 0.25, y: 0.75, pageId: "page-1", tool: "pen" },
            updatedAt: 1,
          },
        ]}
        commentPins={[
          {
            key: "page:page-1",
            anchor: { type: "page", pageId: "page-1" },
            count: 3,
            unreadCount: 2,
            previewAuthor: "민지",
            previewBody: "말풍선 간격을 조금 더 넓혀 주세요.",
            label: "1페이지",
            x: 400,
            y: 120,
          },
        ]}
        onCommentPinClick={noop}
      />
    );

    expect(html).toContain("공동작업 캔버스 오버레이");
    expect(html).toContain("left:25%");
    expect(html).toContain("top:75%");
    expect(html).toContain("서윤 · 이 탭");
    expect(html).toContain("· 펜");
    expect(html).toContain(
      "1페이지. 댓글 핀 1/1. 최근 작성자 민지. 최근 댓글 말풍선 간격을 조금 더 넓혀 주세요. 미해결 대화 3개. 읽지 않은 대화 2개. Enter 키로 대화 열기."
    );
    expect(html).toContain("size-11");
    expect(html).toContain("size-8");
    expect(html).toContain("ring-accent/30");
    expect(html).toContain('data-studio-comment-pin="true"');
    expect(html).not.toContain('data-studio-comment-pin-preview="true"');
    expect(html).not.toContain("border-white");
    expect(html).not.toContain("0.03_270");
    expect(html).toContain("clamp(1.375rem, calc(50.0000% + 0px), calc(100% - 1.375rem))");
    expect(html).not.toContain(privateSessionId);
    expect(html).not.toContain("page:page-1");
  });

  it("maps live drawing tails through the document viewBox so zoom does not shrink the preview", () => {
    const html = renderToStaticMarkup(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[
          {
            participant: {
              sessionId: "peer-draw",
              displayName: "민호 · 이 탭",
              role: "editor",
            },
            cursor: {
              x: 0.5,
              y: 0.25,
              pageId: "page-1",
              tool: "pen",
              drawing: true,
              strokeColor: "#16100c",
              strokeWidth: 8,
              points: [80, 120, 400, 300, 720, 240],
            },
            updatedAt: 1,
          },
        ]}
        commentPins={[]}
        onCommentPinClick={noop}
      />
    );

    expect(html).toContain('viewBox="0 0 800 1200"');
    expect(html).toContain("preserveAspectRatio=\"none\"");
    expect(html).toContain("80.0,120.0");
    expect(html).toContain("400.0,300.0");
    expect(html).toContain("720.0,240.0");
    expect(html).toContain('data-studio-live-cursor-trail="ink"');
    expect(html).toContain("✏️ 그리는 중");
    expect(html).not.toContain("stroke-dasharray");
  });

  it("renders a remote eraser tail as a dashed hole trail instead of ink", () => {
    const html = renderToStaticMarkup(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[
          {
            participant: {
              sessionId: "peer-erase",
              displayName: "민호 · 이 탭",
              role: "editor",
            },
            cursor: {
              x: 0.5,
              y: 0.25,
              pageId: "page-1",
              tool: "eraser",
              drawing: true,
              strokeColor: "#ff3b30",
              strokeWidth: 16,
              points: [80, 120, 400, 300, 720, 240],
            },
            updatedAt: 1,
          },
        ]}
        commentPins={[]}
        onCommentPinClick={noop}
      />
    );

    expect(html).toContain('viewBox="0 0 800 1200"');
    expect(html).toContain('data-studio-live-cursor-trail="eraser"');
    expect(html).toContain('data-studio-live-cursor-tip="eraser"');
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("· 지우개");
    expect(html).toContain("지우는 중");
    expect(html).not.toContain("그리는 중");
    expect(html).not.toContain("✏️");
    expect(html).toContain("background-color:transparent");
    expect(html).not.toContain("stroke=\"#ff3b30\"");
    expect(html).not.toContain("background-color:#ff3b30");
  });

  it("renders a remote pixel tail with square caps instead of a rounded ink stroke", () => {
    const html = renderToStaticMarkup(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[
          {
            participant: {
              sessionId: "peer-pixel",
              displayName: "서윤 · 이 탭",
              role: "editor",
            },
            cursor: {
              x: 0.2,
              y: 0.2,
              pageId: "page-1",
              tool: "pixel",
              drawing: true,
              strokeColor: "#111111",
              strokeWidth: 4,
              points: [40, 40, 80, 40, 80, 80],
            },
            updatedAt: 1,
          },
        ]}
        commentPins={[]}
        onCommentPinClick={noop}
      />
    );

    expect(html).toContain('data-studio-live-cursor-trail="pixel"');
    expect(html).toContain('stroke-linecap="square"');
    expect(html).toContain("· 픽셀");
    expect(html).not.toContain("stroke-dasharray");
  });

  it("mounts only the active pin preview and removes it after pointer leave", () => {
    const onCommentQuickReplyPreload = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[{
          key: "page:page-1",
          anchor: { type: "page", pageId: "page-1" },
          count: 1,
          unreadCount: 0,
          previewAuthor: "민지",
          previewBody: "말풍선 간격을 조금 더 넓혀 주세요.",
          label: "1페이지",
          x: 400,
          y: 120,
        }]}
        onCommentPinClick={noop}
        onCommentQuickReplyPreload={onCommentQuickReplyPreload}
      />
    );

    const pin = screen.getByRole("button", { name: /1페이지/u });
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();
    fireEvent.pointerEnter(pin);
    expect(onCommentQuickReplyPreload).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')?.textContent)
      .toContain("말풍선 간격을 조금 더 넓혀 주세요.");
    fireEvent.pointerLeave(pin);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();
    fireEvent.focus(pin);
    expect(onCommentQuickReplyPreload).toHaveBeenCalledTimes(2);
  });

  it("suppresses the hover preview while a controlled quick reply is active", () => {
    const onCommentQuickReplyPreload = vi.fn();
    const props = {
      canvasWidth: 800,
      canvasHeight: 1_200,
      cursors: [],
      commentPins: [{
        key: "page:page-1",
        anchor: { type: "page" as const, pageId: "page-1" },
        count: 1,
        previewAuthor: "민지",
        previewBody: "빠른 답글과 겹치지 않아야 합니다.",
        label: "1페이지",
        x: 400,
        y: 120,
      }],
      onCommentPinClick: noop,
      onCommentQuickReplyPreload,
    };
    const { rerender } = render(<StudioLiveCanvasOverlay {...props} />);
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /1페이지/u });

    fireEvent.pointerEnter(pin);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).not.toBeNull();

    rerender(<StudioLiveCanvasOverlay {...props} commentQuickReplyActive />);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();
    fireEvent.pointerEnter(pin);
    fireEvent.focus(pin);
    expect(onCommentQuickReplyPreload).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();

    rerender(<StudioLiveCanvasOverlay {...props} commentQuickReplyActive={false} />);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();
    fireEvent.pointerEnter(pin);
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')?.textContent)
      .toContain("빠른 답글과 겹치지 않아야 합니다.");
  });

  it("moves keyboard focus across nearby pins without opening every thread", async () => {
    const onCommentPinClick = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[
          {
            key: "first",
            anchor: { type: "point", pageId: "page-1", x: 0.2, y: 0.2 },
            count: 1,
            previewAuthor: "민지",
            previewBody: "첫 번째 댓글",
            label: "첫 번째 핀",
            x: 160,
            y: 240,
          },
          {
            key: "second",
            anchor: { type: "point", pageId: "page-1", x: 0.4, y: 0.4 },
            count: 1,
            previewAuthor: "서윤",
            previewBody: "두 번째 댓글",
            label: "두 번째 핀",
            x: 320,
            y: 480,
          },
          {
            key: "last",
            anchor: { type: "point", pageId: "page-1", x: 0.6, y: 0.6 },
            count: 1,
            threadIds: ["thread-old", "thread-unread"],
            newestThreadId: "thread-old",
            newestUnreadThreadId: "thread-unread",
            previewAuthor: "지호",
            previewBody: "마지막 댓글",
            label: "마지막 핀",
            x: 480,
            y: 720,
          },
        ]}
        onCommentPinClick={onCommentPinClick}
      />
    );

    const first = screen.getByRole<HTMLButtonElement>("button", { name: /첫 번째 핀/u });
    const second = screen.getByRole<HTMLButtonElement>("button", { name: /두 번째 핀/u });
    const last = screen.getByRole<HTMLButtonElement>("button", { name: /마지막 핀/u });
    expect(first.getAttribute("aria-keyshortcuts")).toContain("ArrowRight");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(last.getAttribute("tabindex")).toBe("-1");

    first.focus();
    await waitFor(() => {
      expect(document.querySelector('[data-studio-comment-pin-preview="true"]')?.textContent)
        .toContain("첫 번째 댓글");
    });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(first.getAttribute("tabindex")).toBe("-1");
    expect(second.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(last);
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(last.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(last);
    expect(last.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(last, { key: "Escape" });
    expect(document.querySelector('[data-studio-comment-pin-preview="true"]')).toBeNull();
    expect(document.activeElement).toBe(last);
    expect(onCommentPinClick).not.toHaveBeenCalled();

    fireEvent.click(last);
    expect(onCommentPinClick).toHaveBeenCalledWith({
      pinKey: "last",
      anchor: { type: "point", pageId: "page-1", x: 0.6, y: 0.6 },
      preferredThreadId: "thread-unread",
      threadIds: ["thread-old", "thread-unread"],
      trigger: last,
    });
  });

  it("exposes drag and keyboard movement only for one unclustered point thread", async () => {
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[
          movablePointPin(),
          movablePointPin({
            key: "cluster",
            count: 2,
            threadIds: ["thread-a", "thread-b"],
            x: 400,
          }),
          {
            key: "element",
            anchor: { type: "element", pageId: "page-1", elementId: "bubble-1" },
            count: 1,
            threadIds: ["thread-element"],
            label: "말풍선 댓글",
            x: 600,
            y: 300,
          },
        ]}
        onCommentPinClick={noop}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );

    const point = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 1\/3/u });
    const cluster = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 2\/3/u });
    const element = screen.getByRole<HTMLButtonElement>("button", { name: /말풍선 댓글/u });

    expect(point.getAttribute("data-studio-comment-pin-reanchorable")).toBe("true");
    expect(point.getAttribute("aria-roledescription")).toBe("이동 가능한 위치 댓글 핀");
    expect(point.getAttribute("aria-keyshortcuts")).toContain("Alt+ArrowLeft");
    expect(point.getAttribute("aria-keyshortcuts")).toContain("Alt+Shift+ArrowDown");
    expect(point.getAttribute("aria-label")).toContain("드래그 또는 Alt와 방향키로 위치 이동.");
    expect(point.title).toContain("드래그 또는 Alt+방향키로 위치 이동");
    expect(point.className).toContain("size-11");
    expect(point.className).toContain("touch-none");
    expect(cluster.getAttribute("data-studio-comment-pin-reanchorable")).toBeNull();
    expect(cluster.getAttribute("aria-keyshortcuts")).not.toContain("Alt+");
    expect(element.getAttribute("data-studio-comment-pin-reanchorable")).toBeNull();

    fireEvent.focus(point);
    await waitFor(() => {
      expect(document.querySelector('[data-studio-comment-pin-preview="true"]')?.textContent)
        .toContain("드래그·Alt+방향키로 위치 이동");
    });
  });

  it("keeps a sub-threshold press as an ordinary click and uses pointer capture safely", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[movablePointPin()]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 100, top: 50, width: 400, height: 600 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(pin, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    fireEvent.pointerDown(pin, {
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(pin, { pointerId: 7, clientX: 203, clientY: 202 });
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).toBeNull();
    fireEvent.pointerUp(pin, { pointerId: 7, clientX: 203, clientY: 202 });
    fireEvent.click(pin);

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onCommentPinReanchor).not.toHaveBeenCalled();
    expect(onCommentPinClick).toHaveBeenCalledOnce();
  });

  it("previews a pointer drag, clamps the drop, commits once, and suppresses its trailing click", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[movablePointPin()]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 100, top: 50, width: 400, height: 600 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });

    fireEvent.pointerDown(pin, {
      pointerId: 11,
      button: 0,
      isPrimary: true,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(pin, { pointerId: 11, clientX: 360, clientY: 410 });

    expect(pin.getAttribute("data-studio-comment-pin-reanchoring")).toBe("true");
    expect(pin.getAttribute("aria-label")).toContain("댓글 위치 이동 중.");
    expect(pin.getAttribute("data-studio-comment-pin-anchor-x")).toBe("0.6500");
    expect(pin.getAttribute("data-studio-comment-pin-anchor-y")).toBe("0.6000");
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain("댓글 위치 이동 중");

    fireEvent.pointerUp(pin, { pointerId: 11, clientX: -5_000, clientY: 5_000 });
    fireEvent.pointerUp(pin, { pointerId: 11, clientX: 300, clientY: 300 });
    fireEvent.click(pin);

    expect(onCommentPinReanchor).toHaveBeenCalledOnce();
    expect(onCommentPinReanchor).toHaveBeenCalledWith({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0, y: 1 },
      source: "pointer",
    });
    expect(onCommentPinClick).not.toHaveBeenCalled();
    expect(pin.getAttribute("data-studio-comment-pin-reanchoring")).toBeNull();
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("댓글 위치를 옮겼습니다");

    fireEvent.click(pin);
    expect(onCommentPinClick).toHaveBeenCalledOnce();
  });

  it("continues and finishes a pin drag through the window when pointer capture is unavailable", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[movablePointPin()]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 100, top: 50, width: 400, height: 600 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });
    Object.defineProperty(pin, "setPointerCapture", {
      configurable: true,
      value: vi.fn(() => {
        throw new DOMException("Pointer capture is unavailable");
      }),
    });

    fireEvent.pointerDown(pin, {
      pointerId: 31,
      button: 0,
      isPrimary: true,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 360, clientY: 410 });

    expect(pin.getAttribute("data-studio-comment-pin-reanchoring")).toBe("true");
    expect(pin.getAttribute("data-studio-comment-pin-anchor-x")).toBe("0.6500");
    expect(pin.getAttribute("data-studio-comment-pin-anchor-y")).toBe("0.6000");

    fireEvent.pointerUp(window, { pointerId: 31, clientX: 480, clientY: 620 });
    fireEvent.click(pin);

    expect(onCommentPinReanchor).toHaveBeenCalledOnce();
    expect(onCommentPinReanchor).toHaveBeenCalledWith({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0.95, y: 0.95 },
      source: "pointer",
    });
    expect(onCommentPinClick).not.toHaveBeenCalled();
    expect(pin.getAttribute("data-studio-comment-pin-reanchoring")).toBeNull();
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("댓글 위치를 옮겼습니다");
  });

  it("preserves the grab offset when an edge pin is visually clamped inward", () => {
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[movablePointPin({ anchorX: 0, anchorY: 0.5, x: 0, y: 600 })]}
        onCommentPinClick={noop}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 100, top: 50, width: 400, height: 600 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });

    // The logical x=0 pin is visually clamped to 22px from the edge. A 10px drag should move
    // only 10px in document space instead of jumping by the clamp inset.
    fireEvent.pointerDown(pin, {
      pointerId: 37,
      button: 0,
      isPrimary: true,
      clientX: 122,
      clientY: 350,
    });
    fireEvent.pointerMove(pin, { pointerId: 37, clientX: 132, clientY: 350 });
    fireEvent.pointerUp(pin, { pointerId: 37, clientX: 132, clientY: 350 });

    expect(onCommentPinReanchor).toHaveBeenCalledWith({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0.025, y: 0.5 },
      source: "pointer",
    });
  });

  it("cancels an active drag without moving or opening the thread", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[movablePointPin()]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 0, top: 0, width: 800, height: 1_200 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });

    fireEvent.pointerDown(pin, {
      pointerId: 13,
      button: 0,
      isPrimary: true,
      clientX: 200,
      clientY: 300,
    });
    fireEvent.pointerMove(pin, { pointerId: 13, clientX: 300, clientY: 400 });
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).not.toBeNull();
    fireEvent.pointerCancel(pin, { pointerId: 13 });

    expect(onCommentPinReanchor).not.toHaveBeenCalled();
    expect(onCommentPinClick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("이동을 취소했습니다");

    fireEvent.pointerDown(pin, {
      pointerId: 14,
      button: 0,
      isPrimary: true,
      clientX: 200,
      clientY: 300,
    });
    fireEvent.pointerMove(pin, { pointerId: 14, clientX: 360, clientY: 480 });
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).not.toBeNull();
    fireEvent.keyDown(pin, { key: "Escape" });
    expect(onCommentPinReanchor).not.toHaveBeenCalled();
    expect(document.querySelector('[data-studio-comment-pin-drag-origin="true"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("이동을 취소했습니다");
  });

  it("projects a pointer drop through canvas rotation and horizontal flip", () => {
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={1_200}
        canvasHeight={600}
        cursors={[]}
        commentPins={[movablePointPin({ anchorX: 0.5, anchorY: 0.5, x: 600, y: 300 })]}
        flipX
        rotation={90}
        onCommentPinClick={noop}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const overlay = screen.getByRole("group", { name: "공동작업 캔버스 오버레이" });
    mockOverlayRect(overlay, { left: 100, top: 50, width: 600, height: 300 });
    const pin = screen.getByRole<HTMLButtonElement>("button", { name: /검토 위치/u });

    fireEvent.pointerDown(pin, {
      pointerId: 17,
      button: 0,
      isPrimary: true,
      clientX: 400,
      clientY: 200,
    });
    fireEvent.pointerMove(pin, { pointerId: 17, clientX: 250, clientY: 275 });
    fireEvent.pointerUp(pin, { pointerId: 17, clientX: 250, clientY: 275 });

    expect(onCommentPinReanchor).toHaveBeenCalledWith({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0.75, y: 0.25 },
      source: "pointer",
    });
  });

  it("uses screen-relative fine and coarse Alt+Arrow nudges without breaking plain Arrow navigation", () => {
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={400}
        cursors={[]}
        commentPins={[
          movablePointPin({ anchorX: 0.5, anchorY: 0.5, x: 400, y: 200 }),
          movablePointPin({ key: "second-point", anchorX: 0.7, anchorY: 0.5, x: 560, y: 200 }),
        ]}
        flipX
        rotation={90}
        onCommentPinClick={noop}
        onCommentPinReanchor={onCommentPinReanchor}
      />
    );
    const first = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 1\/2/u });
    const second = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 2\/2/u });

    fireEvent.keyDown(first, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true, shiftKey: true });
    expect(onCommentPinReanchor).toHaveBeenCalledTimes(2);
    expect(onCommentPinReanchor.mock.calls[0]?.[0]).toEqual({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0.5, y: 0.505 },
      source: "keyboard",
    });
    expect(onCommentPinReanchor.mock.calls[1]?.[0]).toEqual({
      pinKey: "point-pin",
      threadId: "thread-point",
      anchor: { type: "point", pageId: "page-1", x: 0.525, y: 0.505 },
      source: "keyboard",
    });
    expect(screen.getByRole("status").textContent).toContain("크게 옮겼습니다");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(onCommentPinReanchor).toHaveBeenCalledTimes(2);
  });

  it("applies per-thread move authority while keeping other users' pins openable", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[
          movablePointPin({ key: "owned", threadIds: ["thread-owned"] }),
          movablePointPin({
            key: "other",
            threadIds: ["thread-other"],
            anchorX: 0.65,
            x: 520,
          }),
        ]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
        commentPinReanchorableThreadIds={new Set(["thread-owned"])}
        commentPinReanchorDisabledReason="본인이 작성한 댓글만 옮길 수 있어요."
      />
    );
    const owned = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 1\/2/u });
    const other = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 2\/2/u });

    expect(owned.getAttribute("data-studio-comment-pin-reanchorable")).toBe("true");
    expect(owned.getAttribute("aria-keyshortcuts")).toContain("Alt+ArrowRight");
    expect(other.getAttribute("data-studio-comment-pin-reanchorable")).toBeNull();
    expect(other.getAttribute("aria-keyshortcuts")).not.toContain("Alt+");
    expect(other.getAttribute("aria-label")).toContain("본인이 작성한 댓글만 옮길 수 있어요");

    fireEvent.keyDown(owned, { key: "ArrowRight", altKey: true });
    expect(onCommentPinReanchor).toHaveBeenCalledOnce();
    expect(onCommentPinReanchor.mock.calls[0]?.[0].threadId).toBe("thread-owned");
    fireEvent.keyDown(other, { key: "ArrowRight", altKey: true });
    expect(onCommentPinReanchor).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("본인이 작성한 댓글만 옮길 수 있어요");

    fireEvent.click(other);
    expect(onCommentPinClick).toHaveBeenCalledOnce();
    expect(onCommentPinClick.mock.calls[0]?.[0].pinKey).toBe("other");
  });

  it("explains a disabled move while preserving comment opening and cluster safety", () => {
    const onCommentPinClick = vi.fn();
    const onCommentPinReanchor = vi.fn();
    render(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[
          movablePointPin(),
          movablePointPin({
            key: "cluster",
            count: 2,
            threadIds: ["thread-a", "thread-b"],
            x: 400,
          }),
        ]}
        onCommentPinClick={onCommentPinClick}
        onCommentPinReanchor={onCommentPinReanchor}
        commentPinReanchorDisabledReason="동기화가 끝난 뒤 이동할 수 있어요."
      />
    );
    const point = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 1\/2/u });
    const cluster = screen.getByRole<HTMLButtonElement>("button", { name: /댓글 핀 2\/2/u });

    expect(point.getAttribute("data-studio-comment-pin-reanchorable")).toBeNull();
    expect(point.getAttribute("aria-label")).toContain("위치 이동 불가 동기화가 끝난 뒤 이동할 수 있어요.");
    expect(point.title).toContain("위치 이동 불가");
    fireEvent.keyDown(point, { key: "ArrowLeft", altKey: true });
    expect(onCommentPinReanchor).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("동기화가 끝난 뒤 이동할 수 있어요");

    fireEvent.pointerDown(cluster, {
      pointerId: 21,
      button: 0,
      isPrimary: true,
      clientX: 400,
      clientY: 300,
    });
    fireEvent.pointerMove(cluster, { pointerId: 21, clientX: 500, clientY: 400 });
    fireEvent.pointerUp(cluster, { pointerId: 21, clientX: 500, clientY: 400 });
    expect(onCommentPinReanchor).not.toHaveBeenCalled();

    fireEvent.click(point);
    expect(onCommentPinClick).toHaveBeenCalledOnce();
  });

  it("keeps exactly one surviving comment pin in the tab order as pins change", async () => {
    const firstPin = {
      key: "first",
      anchor: { type: "point" as const, pageId: "page-1", x: 0.2, y: 0.2 },
      count: 1,
      previewAuthor: "민지",
      previewBody: "  줄바꿈이\n있는   최근 댓글  ",
      label: "첫 번째 핀",
      x: 160,
      y: 240,
    };
    const secondPin = {
      key: "second",
      anchor: { type: "point" as const, pageId: "page-1", x: 0.4, y: 0.4 },
      count: 2,
      unreadCount: 1,
      previewAuthor: "서윤",
      previewBody: "두 번째 댓글",
      label: "두 번째 핀",
      x: 320,
      y: 480,
    };
    const props = {
      canvasWidth: 800,
      canvasHeight: 1_200,
      cursors: [],
      onCommentPinClick: noop,
    };
    const { rerender } = render(
      <StudioLiveCanvasOverlay {...props} commentPins={[firstPin, secondPin]} />
    );
    const first = screen.getByRole<HTMLButtonElement>("button", { name: /첫 번째 핀/u });
    const second = screen.getByRole<HTMLButtonElement>("button", { name: /두 번째 핀/u });

    expect(first.textContent).toContain("민");
    expect(first.getAttribute("aria-label")).toContain("최근 댓글 줄바꿈이 있는 최근 댓글.");
    expect(first.getAttribute("aria-label")).toContain("모두 읽음.");
    second.focus();
    await waitFor(() => {
      expect(first.getAttribute("tabindex")).toBe("-1");
      expect(second.getAttribute("tabindex")).toBe("0");
    });

    rerender(<StudioLiveCanvasOverlay {...props} commentPins={[firstPin]} />);
    await waitFor(() => expect(first.getAttribute("tabindex")).toBe("0"));
    expect(document.querySelectorAll('[data-studio-comment-pin][tabindex="0"]')).toHaveLength(1);
  });

  it("mirrors an inward pin collision nudge when the canvas is flipped", () => {
    const html = renderToStaticMarkup(
      <StudioLiveCanvasOverlay
        canvasWidth={800}
        canvasHeight={1_200}
        cursors={[]}
        commentPins={[{
          key: "right-edge",
          anchor: { type: "point", pageId: "page-1", x: 1, y: 0.5 },
          count: 1,
          label: "오른쪽 핀",
          x: 800,
          y: 600,
          screenOffsetX: -22,
        }]}
        flipX
        onCommentPinClick={noop}
      />
    );

    expect(html).toContain("calc(0.0000% + 22px)");
  });

  it.each([
    { rotation: 0, flipX: false, x: 25, y: 25, offsetX: 12, offsetY: 8 },
    { rotation: 90, flipX: false, x: 75, y: 25, offsetX: -8, offsetY: 12 },
    { rotation: 180, flipX: false, x: 75, y: 75, offsetX: -12, offsetY: -8 },
    { rotation: 270, flipX: false, x: 25, y: 75, offsetX: 8, offsetY: -12 },
    { rotation: 0, flipX: true, x: 75, y: 25, offsetX: -12, offsetY: 8 },
    { rotation: 90, flipX: true, x: 25, y: 25, offsetX: 8, offsetY: 12 },
    { rotation: 180, flipX: true, x: 25, y: 75, offsetX: 12, offsetY: -8 },
    { rotation: 270, flipX: true, x: 75, y: 75, offsetX: -8, offsetY: -12 },
  ] as const)(
    "projects pins and cursors after local flip (rotation=$rotation, flipX=$flipX)",
    ({ rotation, flipX, x, y, offsetX, offsetY }) => {
      const html = renderToStaticMarkup(
        <StudioLiveCanvasOverlay
          canvasWidth={800}
          canvasHeight={400}
          cursors={[
            {
              participant: { sessionId: "peer", displayName: "동료", role: "editor" },
              cursor: { x: 0.25, y: 0.25, pageId: "page-1", tool: null },
              updatedAt: 1,
            },
          ]}
          commentPins={[
            {
              key: "point",
              anchor: { type: "point", pageId: "page-1", x: 0.25, y: 0.25 },
              count: 1,
              label: "검토 핀",
              x: 200,
              y: 100,
              screenOffsetX: 12,
              screenOffsetY: 8,
            },
          ]}
          flipX={flipX}
          rotation={rotation}
          onCommentPinClick={noop}
        />
      );

      expect(html).toContain(
        `left:clamp(1.375rem, calc(${x.toFixed(4)}% + ${offsetX}px), calc(100% - 1.375rem))`
      );
      expect(html).toContain(
        `top:clamp(1.375rem, calc(${y.toFixed(4)}% + ${offsetY}px), calc(100% - 1.375rem))`
      );
      expect(html).toContain(`left:${x}%;top:${y}%`);
    }
  );

  it.each([false, true] as const)(
    "keeps an omitted rotation byte-for-byte compatible with rotation zero (flipX=$flipX)",
    (flipX) => {
      const props = {
        canvasWidth: 800,
        canvasHeight: 400,
        cursors: [
          {
            participant: { sessionId: "peer", displayName: "동료", role: "editor" as const },
            cursor: { x: 0.25, y: 0.25, pageId: "page-1", tool: null },
            updatedAt: 1,
          },
        ],
        commentPins: [
          {
            key: "point",
            anchor: { type: "point" as const, pageId: "page-1", x: 0.25, y: 0.25 },
            count: 1,
            label: "검토 핀",
            x: 200,
            y: 100,
            screenOffsetX: 12,
            screenOffsetY: 8,
          },
        ],
        flipX,
        onCommentPinClick: noop,
      };
      const omitted = renderToStaticMarkup(<StudioLiveCanvasOverlay {...props} />);
      const explicitZero = renderToStaticMarkup(<StudioLiveCanvasOverlay {...props} rotation={0} />);
      expect(omitted).toBe(explicitZero);
    }
  );

  it("forwards the remote overlay rotation to comment pins before live cursors arrive", () => {
    const html = renderToStaticMarkup(
      <StudioRemoteCursorOverlay
        pageId="page-1"
        canvasWidth={800}
        canvasHeight={400}
        commentPins={[
          {
            key: "point",
            anchor: { type: "point", pageId: "page-1", x: 0.25, y: 0.25 },
            count: 1,
            threadIds: ["thread-point"],
            label: "검토 핀",
            x: 200,
            y: 100,
            screenOffsetX: 12,
            screenOffsetY: 8,
          },
        ]}
        rotation={90}
        flipX
        onCommentPinClick={noop}
        onCommentPinReanchor={noop}
        commentPinReanchorableThreadIds={new Set(["thread-point"])}
      />
    );

    expect(html).toContain("left:clamp(1.375rem, calc(25.0000% + 8px)");
    expect(html).toContain("top:clamp(1.375rem, calc(25.0000% + 12px)");
    expect(html).toContain('data-studio-comment-pin-reanchorable="true"');
    expect(html).toContain("Alt+Shift+ArrowDown");
  });

  it("uses deterministic participant colors and exposes Figma-style follow controls", () => {
    const privateSessionId = "peer-private-id";
    expect(studioLiveParticipantColor(privateSessionId)).toBe(
      studioLiveParticipantColor(privateSessionId)
    );

    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        operationSyncReady
        peers={[
          {
            sessionId: privateSessionId,
            displayName: "민호 · 이 탭",
            role: "owner",
            visibility: "active",
            pageId: "page-private-id",
            lastSeenAt: 1,
          },
        ]}
        followingSessionId={privateSessionId}
        onOpenTeam={noop}
        onToggleFollow={noop}
        syncSnapshot={syncedSnapshot()}
      />
    );

    expect(html).toContain("안전하게 동기화됨");
    expect(html).toContain("팀 서버와 이 기기의 복구 저장소에 원고를 보호합니다");
    expect(html).toContain('data-studio-presence-dock="true"');
    expect(html).toContain('data-studio-presence-stack="true"');
    expect(html).toContain('data-studio-presence-link="synced"');
    expect(html).toContain('data-studio-sync-phase="synced"');
    expect(html).toContain("size-11");
    expect(html).toContain("민호 · 이 탭 따라가기 중지");
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows an active lock chip only when edit leases are present", () => {
    const withLocks = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        alwaysOn
        peers={[]}
        activeLockCount={3}
        activeLockLabel="활성 편집 잠금 3개 · 민수, 지민 · 나 1 · 레이어 소유권은 네비게이터 배지로 표시됩니다"
        followingSessionId={null}
        onOpenTeam={noop}
        onToggleFollow={noop}
      />
    );
    expect(withLocks).toContain('data-studio-presence-lock-count="3"');
    expect(withLocks).toContain("활성 편집 잠금 3개");
    expect(withLocks).toContain("민수");
    expect(withLocks).toContain('data-studio-presence-lock-label=');

    const withoutLocks = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        alwaysOn
        peers={[]}
        activeLockCount={0}
        followingSessionId={null}
        onOpenTeam={noop}
        onToggleFollow={noop}
      />
    );
    expect(withoutLocks).not.toContain("data-studio-presence-lock-count");
  });

  it("renders always-on presence dock while connecting with zero peers", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected={false}
        alwaysOn
        peers={[]}
        followingSessionId={null}
        onOpenTeam={noop}
        onToggleFollow={noop}
      />
    );
    expect(html).toContain('data-studio-presence-dock="true"');
    expect(html).toContain("팀 작업 공간 열기");
    expect(html).toContain('data-studio-presence-link="retrying"');
    expect(html).not.toContain("data-studio-presence-companion-tab");
  });

  it("offers a Magma-style open-another-tab action on the presence dock", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected
        alwaysOn
        peers={[]}
        followingSessionId={null}
        onOpenTeam={noop}
        onOpenCompanionTab={noop}
        onToggleFollow={noop}
      />
    );
    expect(html).toContain('data-studio-presence-companion-tab="true"');
    expect(html).toContain("새 탭에서 같이 그리기");
  });

  it("announces durability loss assertively and never labels it as safely synced", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected={false}
        alwaysOn
        peers={[]}
        followingSessionId={null}
        onOpenTeam={noop}
        onToggleFollow={noop}
        syncSnapshot={syncedSnapshot({
          phase: "durability-risk",
          persistenceDurability: "degraded",
          transportReady: false,
          pendingCount: 3,
          editsDurablyProtected: false,
          message: "로컬 복구 저장소를 사용할 수 없습니다.",
        })}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("저장 보호 필요");
    expect(html).toContain("팀 서버와 이 기기의 복구 저장소가 모두 준비되지 않아");
    expect(html).not.toContain("안전하게 동기화됨");
  });

  it("keeps presence chrome compact throughout mobile and expands only in the desktop shell", () => {
    const onOpenTeam = vi.fn();
    render(
      <StudioLivePresenceDock
        connected={false}
        alwaysOn
        peers={[
          {
            sessionId: "peer-compact",
            displayName: "민호",
            role: "editor",
            visibility: "active",
            pageId: "page-1",
            lastSeenAt: 1,
          },
        ]}
        followingSessionId="peer-compact"
        onOpenTeam={onOpenTeam}
        onToggleFollow={noop}
        syncSnapshot={syncedSnapshot({
          phase: "durability-risk",
          persistenceDurability: "degraded",
          transportReady: false,
          pendingCount: 3,
          editsDurablyProtected: false,
          message: "로컬 복구 저장소를 사용할 수 없습니다.",
        })}
      />
    );

    const team = screen.getByRole("button", { name: "팀 작업 공간 열기" });
    expect(team.className).toContain("hidden");
    expect(team.className).toContain("sm:grid");

    const sync = screen.getByRole("button", {
      name: /저장 보호 필요.*팀 작업 공간 열기/u,
    });
    expect(sync.className).toContain("size-11");
    expect(sync.className).toContain("min-h-11");
    expect(sync.className).toContain("min-w-11");
    expect(sync.className).toContain("sm:w-[16.5rem]");
    expect(sync.className).not.toContain("min-[412px]");
    expect(sync.querySelector("span")?.className).toContain("sm:inline");
    expect(sync.querySelector("span")?.className).toContain("tabular-nums");

    expect(screen.getByRole("group", { name: "참여자" }).className)
      .toContain("sm:flex");
    expect(
      screen.getAllByRole("button", { name: "민호 따라가기 중지" })
        .some((button) => button.className.includes("sm:inline-flex"))
    ).toBe(true);

    fireEvent.click(sync);
    expect(onOpenTeam).toHaveBeenCalledOnce();
  });

  it("shows a Korean offline queue count with reduced-motion-safe reconnect affordance", () => {
    const html = renderToStaticMarkup(
      <StudioLivePresenceDock
        connected={false}
        alwaysOn
        peers={[]}
        followingSessionId={null}
        onOpenTeam={noop}
        onToggleFollow={noop}
        syncSnapshot={syncedSnapshot({
          phase: "offline-queued",
          transportReady: false,
          pendingCount: 12,
          editsDurablyProtected: true,
        })}
      />
    );

    expect(html).toContain("오프라인 · 12개 보관");
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).toContain('data-studio-presence-link="offline-queued"');
    expect(html).toContain("sm:w-[16.5rem]");
    expect(html).not.toContain("min-[412px]:w-[13.5rem]");
    expect(html).toContain("tabular-nums");
  });

  it("keeps every participant color readable behind compact cream labels", () => {
    for (const color of STUDIO_LIVE_PARTICIPANT_COLORS) {
      const contrast = 1.05 / (relativeLuminance(color) + 0.05);
      expect(contrast, color).toBeGreaterThanOrEqual(4.5);
    }
  });
});
