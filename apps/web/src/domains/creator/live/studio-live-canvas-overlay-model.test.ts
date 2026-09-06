import { describe, expect, it } from "vitest";

import {
  addStudioCommentReply,
  addStudioCommentThread,
  assignStudioCommentThread,
  createEmptyStudioCommentsDocument,
  listStudioCommentThreadsForAnchor,
  type StudioCommentActor,
  type StudioCommentAnchor,
  type StudioCommentsDocument,
} from "../studio-comments";

import {
  planStudioCommentPinPreviewPosition,
  projectStudioCanvasCommentPins,
  resolveStudioLivePublishedCursorTool,
  studioLiveCursorActivityLabel,
  studioLiveCursorToolLabel,
} from "./studio-live-canvas-overlay-model";

const AUTHOR: StudioCommentActor = { id: "author-1", displayName: "편집자" };

function addThread(
  document: StudioCommentsDocument,
  id: string,
  anchor: StudioCommentAnchor,
  updatedAt: string
): StudioCommentsDocument {
  return addStudioCommentThread(
    document,
    { id, anchor, author: AUTHOR, body: `${id} 검토` },
    new Date(updatedAt)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolvedPinCenter(
  pin: ReturnType<typeof projectStudioCanvasCommentPins>[number],
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth = 390,
  viewportHeight = 667
): { x: number; y: number } {
  return {
    x: clamp(
      (pin.x / canvasWidth) * viewportWidth + (pin.screenOffsetX ?? 0),
      22,
      viewportWidth - 22
    ),
    y: clamp(
      (pin.y / canvasHeight) * viewportHeight + (pin.screenOffsetY ?? 0),
      22,
      viewportHeight - 22
    ),
  };
}

function centerDistance(
  first: { x: number; y: number },
  second: { x: number; y: number }
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

describe("projectStudioCanvasCommentPins", () => {
  it("keeps a single-thread pin identity stable when its point anchor moves", () => {
    const before = addThread(createEmptyStudioCommentsDocument(), "thread-stable", {
      type: "point",
      pageId: "page-1",
      x: 0.2,
      y: 0.3,
    }, "2026-07-18T00:00:00.000Z");
    const after = addThread(createEmptyStudioCommentsDocument(), "thread-stable", {
      type: "point",
      pageId: "page-1",
      x: 0.8,
      y: 0.7,
    }, "2026-07-18T00:01:00.000Z");
    const project = (document: StudioCommentsDocument) => projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    })[0];

    expect(project(before)?.key).toBe("thread:thread-stable");
    expect(project(after)?.key).toBe(project(before)?.key);
  });

  it("keeps clustered point pins and exact-location filtering on the same canonical identity", () => {
    const firstAnchor: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.123441,
      y: 0.876541,
    };
    const nearbyAnchor: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.123449,
      y: 0.876549,
    };
    const separateAnchor: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.12356,
      y: 0.87666,
    };
    let document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-near-old", firstAnchor, "2026-07-18T00:00:00.000Z");
    document = addThread(document, "thread-far", separateAnchor, "2026-07-18T00:01:00.000Z");
    document = addThread(document, "thread-near-new", nearbyAnchor, "2026-07-18T00:02:00.000Z");

    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
      unreadThreadIds: new Set(["thread-near-new", "thread-far"]),
    });

    expect(pins).toHaveLength(2);
    const clustered = pins.find((pin) => pin.count === 2);
    expect(clustered).toMatchObject({
      threadIds: ["thread-near-old", "thread-near-new"],
      newestThreadId: "thread-near-new",
      newestUnreadThreadId: "thread-near-new",
      unreadCount: 1,
    });
    expect(clustered).toBeDefined();
    expect(
      listStudioCommentThreadsForAnchor(document, clustered!.anchor, { includeResolved: false })
        .map(({ id }) => id)
    ).toEqual(clustered!.threadIds);
  });

  it("collapses legacy frame metadata when the page-global element target is identical", () => {
    let document = createEmptyStudioCommentsDocument();
    document = addThread(
      document,
      "thread-frame-1",
      {
        type: "element",
        pageId: "page-1",
        frameId: "frame-1",
        elementId: "shared-element-id",
      },
      "2026-07-18T00:00:00.000Z"
    );
    document = addThread(
      document,
      "thread-frame-2",
      {
        type: "element",
        pageId: "page-1",
        frameId: "frame-2",
        elementId: "shared-element-id",
      },
      "2026-07-18T00:01:00.000Z"
    );

    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 800,
      canvasHeight: 1_200,
      boundsByElementId: new Map([
        ["shared-element-id", { x: 100, y: 200, width: 300, height: 150 }],
      ]),
    });

    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ count: 2 });
    expect(pins[0].threadIds).toEqual(["thread-frame-1", "thread-frame-2"]);
  });

  it("nudges distinct nearby anchors in screen pixels so both pins stay clickable", () => {
    let document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-a", {
      type: "point", pageId: "page-1", x: 0.4, y: 0.5,
    }, "2026-07-18T00:00:00.000Z");
    document = addThread(document, "thread-b", {
      type: "point", pageId: "page-1", x: 0.401, y: 0.501,
    }, "2026-07-18T00:01:00.000Z");

    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    });

    expect(pins).toHaveLength(2);
    expect(pins[0].screenOffsetX ?? 0).toBe(0);
    expect(Math.abs(pins[1].screenOffsetX ?? 0) + Math.abs(pins[1].screenOffsetY ?? 0))
      .toBeGreaterThan(0);
  });

  it("nudges edge collisions toward the canvas interior before the overlay clamp", () => {
    let document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-right-a", {
      type: "point", pageId: "page-1", x: 0.999, y: 0.5,
    }, "2026-07-18T00:00:00.000Z");
    document = addThread(document, "thread-right-b", {
      type: "point", pageId: "page-1", x: 0.9995, y: 0.5005,
    }, "2026-07-18T00:01:00.000Z");
    const rightPins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    });

    expect(rightPins).toHaveLength(2);
    expect(rightPins[1].screenOffsetX).toBeLessThan(0);
    expect(centerDistance(
      resolvedPinCenter(rightPins[0], 1_000, 2_000),
      resolvedPinCenter(rightPins[1], 1_000, 2_000)
    )).toBeGreaterThanOrEqual(44);

    document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-bottom-a", {
      type: "point", pageId: "page-1", x: 0.5, y: 0.999,
    }, "2026-07-18T00:00:00.000Z");
    document = addThread(document, "thread-bottom-b", {
      type: "point", pageId: "page-1", x: 0.5005, y: 0.9995,
    }, "2026-07-18T00:01:00.000Z");
    const bottomPins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    });

    expect(bottomPins).toHaveLength(2);
    expect(bottomPins[1].screenOffsetY).toBeLessThan(0);
    expect(centerDistance(
      resolvedPinCenter(bottomPins[0], 1_000, 2_000),
      resolvedPinCenter(bottomPins[1], 1_000, 2_000)
    )).toBeGreaterThanOrEqual(44);
  });

  it("keeps corner collisions at least one touch target apart after the overlay clamp", () => {
    let document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-corner-a", {
      type: "point", pageId: "page-1", x: 0.001, y: 0.001,
    }, "2026-07-18T00:00:00.000Z");
    document = addThread(document, "thread-corner-b", {
      type: "point", pageId: "page-1", x: 0.0015, y: 0.0015,
    }, "2026-07-18T00:01:00.000Z");

    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    });

    expect(pins).toHaveLength(2);
    expect(centerDistance(
      resolvedPinCenter(pins[0], 1_000, 2_000),
      resolvedPinCenter(pins[1], 1_000, 2_000)
    )).toBeGreaterThanOrEqual(44);
  });

  it("keeps viewer-specific unread state on the pin projection only", () => {
    let document = createEmptyStudioCommentsDocument();
    document = addThread(document, "thread-read", {
      type: "point", pageId: "page-1", x: 0.25, y: 0.25,
    }, "2026-07-18T00:02:00.000Z");
    document = addThread(document, "thread-unread", {
      type: "point", pageId: "page-1", x: 0.25, y: 0.25,
    }, "2026-07-18T00:01:00.000Z");

    const pins = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
      unreadThreadIds: new Set(["thread-unread"]),
    });

    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      count: 2,
      unreadCount: 1,
      newestThreadId: "thread-read",
      newestUnreadThreadId: "thread-unread",
      previewBody: "thread-unread 검토",
    });
    expect(document.threads.every((thread) => !("unread" in thread))).toBe(true);
  });

  it("previews the clicked thread's latest reply and bounds hidden pin text", () => {
    const anchor: StudioCommentAnchor = {
      type: "point", pageId: "page-1", x: 0.5, y: 0.5,
    };
    let document = addStudioCommentThread(createEmptyStudioCommentsDocument(), {
      id: "thread-long",
      anchor,
      author: AUTHOR,
      body: "가".repeat(500),
    }, new Date("2026-07-18T00:00:00.000Z"));
    document = addStudioCommentReply(document, "thread-long", {
      id: "reply-latest",
      author: { id: "reviewer-2", displayName: "검토자" },
      body: "최신 답글을 미리 보여 주세요.",
    }, new Date("2026-07-18T00:01:00.000Z"));
    document = assignStudioCommentThread(
      document,
      "thread-long",
      { id: "owner-2", displayName: "담당자" },
      new Date("2026-07-18T00:02:00.000Z")
    );

    const [pin] = projectStudioCanvasCommentPins({
      threads: document.threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    });

    expect(pin).toMatchObject({
      previewAuthor: "검토자",
      previewBody: "최신 답글을 미리 보여 주세요.",
    });

    const longOnly = projectStudioCanvasCommentPins({
      threads: addStudioCommentThread(createEmptyStudioCommentsDocument(), {
        id: "thread-root-only",
        anchor,
        author: AUTHOR,
        body: "나".repeat(500),
      }).threads,
      pageId: "page-1",
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      boundsByElementId: new Map(),
    })[0];
    expect(Array.from(longOnly!.previewBody ?? "")).toHaveLength(280);
    expect(longOnly!.previewBody).toMatch(/…$/u);
  });
});

describe("resolveStudioLivePublishedCursorTool", () => {
  it("encodes the active draw mode without adding a new presence field", () => {
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "eraser",
    })).toBe("eraser");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "pen",
      drawingMode: "eraser",
    })).toBe("eraser");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "select",
      drawMode: "eraser",
    })).toBe("select");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "pixel",
    })).toBe("pixel");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "lasso-fill",
    })).toBe("lasso-fill");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "shape",
    })).toBe("shape");
    expect(resolveStudioLivePublishedCursorTool({
      tool: "draw",
      drawMode: "pen",
    })).toBe("pen");
  });

  it("labels remote tools in Korean and distinguishes erase activity", () => {
    expect(studioLiveCursorToolLabel("eraser")).toBe("지우개");
    expect(studioLiveCursorToolLabel("pen")).toBe("펜");
    expect(studioLiveCursorToolLabel("draw")).toBe("펜");
    expect(studioLiveCursorActivityLabel("eraser", true)).toBe("지우는 중");
    expect(studioLiveCursorActivityLabel("pen", true)).toBe("그리는 중");
    expect(studioLiveCursorActivityLabel("lasso-fill", true)).toBe("채우는 중");
    expect(studioLiveCursorActivityLabel("eraser", false)).toBeNull();
  });
});

describe("planStudioCommentPinPreviewPosition", () => {
  const viewport = { left: 0, top: 0, width: 390, height: 667 };

  it("prefers an open side and clamps the cross axis inside the visual viewport", () => {
    expect(planStudioCommentPinPreviewPosition({
      anchor: { left: 22, top: 4, right: 66, bottom: 48, width: 44, height: 44 },
      viewport,
    })).toEqual({ left: 74, top: 12, width: 224, placement: "right" });

    expect(planStudioCommentPinPreviewPosition({
      anchor: { left: 324, top: 620, right: 368, bottom: 664, width: 44, height: 44 },
      viewport,
    })).toEqual({ left: 92, top: 547, width: 224, placement: "left" });
  });

  it("uses above or below when a narrow viewport has no complete side", () => {
    expect(planStudioCommentPinPreviewPosition({
      anchor: { left: 138, top: 280, right: 182, bottom: 324, width: 44, height: 44 },
      viewport: { left: 0, top: 0, width: 320, height: 600 },
    })).toEqual({ left: 48, top: 164, width: 224, placement: "above" });
  });
});
