import { describe, expect, it } from "vitest";

import {
  STUDIO_VIEW_ZOOM_MAX,
  STUDIO_VIEW_ZOOM_MIN,
  clampStudioViewZoomGestureAnchor,
  captureStudioView,
  clampStudioViewZoom,
  fitStudioViewToWidth,
  normalizeStudioViewRotation,
  planStudioViewRestore,
  planStudioViewRotationTransition,
  planStudioViewScrollToDocumentPoint,
  planStudioViewStageLayout,
  planStudioViewZoomGestureFrame,
  projectStudioDocumentPointToView,
  projectStudioDocumentRectToViewRect,
  projectStudioViewPointToDocument,
  projectStudioViewRectToDocumentRect,
  resolveStudioVisibleDocumentPlacement,
  resolveStudioViewShortcut,
  rotateStudioViewLeft,
  rotateStudioViewRight,
  stepStudioViewZoom,
  stepStudioViewWheelZoom,
  toggleStudioCanvasWheelMode,
} from "./studio-view-controls";

describe("studio view shortcuts", () => {
  it.each([
    [{ code: "Equal" }, "zoom-in"],
    [{ code: "Minus" }, "zoom-out"],
    [{ code: "Home" }, "fit-width"],
    [{ code: "End" }, "actual-pixels"],
    [{ code: "F11" }, "fullscreen"],
    // 색각 검수 흑백 명암은 `⌥Q`. 단독 `Q` 는 퀵 마스크가 갖는다
    // (conflict `q-quickmask-vs-grayscale` 해소, 2026-08-08).
    [{ code: "KeyQ", altKey: true }, "toggle-grayscale"],
    [{ code: "KeyS", shiftKey: true }, "save-view"],
    [{ code: "KeyZ", shiftKey: true }, "restore-view"],
    [{ code: "KeyG", shiftKey: true }, "toggle-perspective-guide"],
  ] as const)("maps %o to %s", (event, expected) => {
    expect(resolveStudioViewShortcut(event)).toBe(expected);
  });

  it("keeps modifier aliases and composing input available to other handlers", () => {
    expect(resolveStudioViewShortcut({ code: "Equal", metaKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "Minus", ctrlKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true, metaKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyS", shiftKey: true, repeat: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true, isComposing: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true, keyCode: 229 })).toBeNull();
  });

  it("leaves a bare Q to the quick-mask handler and never fires grayscale from it", () => {
    // 감사 D5: 캔버스 포커스에서 `Q` 가 색각 검수를 켜서 퀵 마스크 배지가 거짓이 됐다.
    expect(resolveStudioViewShortcut({ code: "KeyQ" })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", key: "q" })).toBeNull();
    // `⇧Q` 는 빠른 액세스 팔레트(StudioPage)의 것이므로 보기 리졸버가 삼키면 안 된다.
    expect(resolveStudioViewShortcut({ code: "KeyQ", shiftKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true, shiftKey: true })).toBeNull();
    expect(resolveStudioViewShortcut({ code: "KeyQ", altKey: true, repeat: true })).toBeNull();
  });

  it("allows held zoom keys but prevents repeated toggles", () => {
    expect(resolveStudioViewShortcut({ code: "Equal", repeat: true })).toBe("zoom-in");
    expect(resolveStudioViewShortcut({ code: "Minus", repeat: true })).toBe("zoom-out");
    expect(resolveStudioViewShortcut({ code: "KeyH", repeat: true })).toBeNull();
  });

  it("leaves H to the configurable application shortcut authority", () => {
    expect(resolveStudioViewShortcut({ code: "KeyH", key: "h" })).toBeNull();
  });
});

describe("studio view zoom", () => {
  it("toggles the quick wheel control between canvas zoom and scrolling", () => {
    expect(toggleStudioCanvasWheelMode("zoom")).toBe("pan");
    expect(toggleStudioCanvasWheelMode("pan")).toBe("zoom");
    expect(toggleStudioCanvasWheelMode("brush-size")).toBe("pan");
  });

  it("uses one bounded, 0.05-aligned step for menu and shortcuts", () => {
    expect(stepStudioViewZoom(1, 1)).toBe(1.2);
    expect(stepStudioViewZoom(1, -1)).toBe(0.8);
    expect(stepStudioViewZoom(5, 1)).toBe(5);
    expect(stepStudioViewZoom(0.2, -1)).toBe(0.2);
    expect(clampStudioViewZoom(Number.NaN)).toBe(1);
  });

  it("fits the webtoon canvas width with product scale bounds", () => {
    expect(fitStudioViewToWidth(720, 720, 2.5)).toBe(1);
    expect(fitStudioViewToWidth(1800, 720, 2.5)).toBe(2.5);
    expect(fitStudioViewToWidth(36, 720, 2.5)).toBe(0.1);
  });

  it("uses the same clamped canvas point for pasteboard zoom preview and settlement", () => {
    expect(clampStudioViewZoomGestureAnchor(
      { left: 100, top: 200, right: 500, bottom: 800 },
      40,
      920
    )).toEqual({
      clientX: 100,
      clientY: 800,
      originX: 0,
      originY: 600,
    });
    expect(clampStudioViewZoomGestureAnchor(
      { left: 100, top: 200, right: 500, bottom: 800 },
      275,
      450
    )).toEqual({
      clientX: 275,
      clientY: 450,
      originX: 175,
      originY: 250,
    });
  });

  it("scales wheel zoom by physical delta instead of jumping on every trackpad tick", () => {
    expect(stepStudioViewWheelZoom(1, -1, 0)).toBeCloseTo(1.002002, 5);
    expect(stepStudioViewWheelZoom(1, -60, 0)).toBeCloseTo(1.127497, 5);
    expect(stepStudioViewWheelZoom(1, -3, 1)).toBeCloseTo(1.100759, 5);
    expect(stepStudioViewWheelZoom(1, -60, 0, true)).toBeCloseTo(0.88692, 5);
    expect(stepStudioViewWheelZoom(4.9, -10_000, 0)).toBe(5);
  });

  it("accumulates fractional trackpad ticks without fixed-step quantization", () => {
    const accumulated = Array.from({ length: 100 }).reduce<number>(
      (current) => stepStudioViewWheelZoom(current, -0.25, 0),
      1
    );
    expect(accumulated).toBeCloseTo(stepStudioViewWheelZoom(1, -25, 0), 12);
    expect(accumulated).toBeGreaterThan(1);
  });

  it("makes the transient frame equal the achievable settled scroll at canvas boundaries", () => {
    const frame = planStudioViewZoomGestureFrame({
      baseZoom: 1,
      targetZoom: 0.85,
      originX: 800,
      originY: 400,
      originClientX: 800,
      originClientY: 400,
      clientX: 800,
      clientY: 400,
      baseLeft: 0,
      baseTop: 0,
      baseWidth: 1_200,
      baseHeight: 1_800,
      wrapLeft: 0,
      wrapTop: 0,
      viewportWidth: 1_200,
      viewportHeight: 800,
    });

    expect(frame.scale).toBe(0.85);
    expect(frame.targetScrollLeft).toBe(0);
    expect(frame.translateX).toBeCloseTo(-120, 6);
    // CSS scaling would move the left edge +120px; the correction cancels it to the same x=0
    // position the settled, non-negative native scroll can actually represent.
    expect(800 * (1 - frame.scale) + frame.translateX).toBeCloseTo(0, 6);
  });

  it("preserves a moving pinch centroid when native scroll has room", () => {
    const frame = planStudioViewZoomGestureFrame({
      baseZoom: 1,
      targetZoom: 1,
      originX: 500,
      originY: 400,
      originClientX: 300,
      originClientY: 250,
      clientX: 350,
      clientY: 280,
      baseLeft: -200,
      baseTop: -150,
      baseWidth: 1_200,
      baseHeight: 1_800,
      wrapLeft: 0,
      wrapTop: 0,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(frame.targetScrollLeft).toBe(150);
    expect(frame.targetScrollTop).toBe(120);
    expect(frame.translateX).toBe(50);
    expect(frame.translateY).toBe(30);
  });

  it("keeps the compositor frame inert when zoom requests overshoot either product bound", () => {
    const maximum = planStudioViewZoomGestureFrame({
      baseZoom: STUDIO_VIEW_ZOOM_MAX,
      targetZoom: 99,
      originX: 650,
      originY: 550,
      originClientX: 350,
      originClientY: 310,
      clientX: 350,
      clientY: 310,
      baseLeft: -300,
      baseTop: -240,
      baseWidth: 1_200,
      baseHeight: 1_000,
      wrapLeft: 100,
      wrapTop: 60,
      viewportWidth: 800,
      viewportHeight: 700,
    });
    expect(maximum).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
      targetScrollLeft: 400,
      targetScrollTop: 300,
    });

    const minimum = planStudioViewZoomGestureFrame({
      baseZoom: STUDIO_VIEW_ZOOM_MIN,
      targetZoom: -1,
      originX: 100,
      originY: 120,
      originClientX: 200,
      originClientY: 180,
      clientX: 200,
      clientY: 180,
      baseLeft: 100,
      baseTop: 60,
      baseWidth: 240,
      baseHeight: 300,
      wrapLeft: 100,
      wrapTop: 60,
      viewportWidth: 800,
      viewportHeight: 700,
    });
    expect(minimum).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
      targetScrollLeft: 0,
      targetScrollTop: 0,
    });
  });

  it.each([
    [0, false],
    [90, false],
    [180, false],
    [270, false],
    [0, true],
    [90, true],
    [180, true],
    [270, true],
  ] as const)(
    "matches preview and settled cursor anchors for rotation=%s flipH=%s",
    (canvasRotation, canvasFlipH) => {
      const layout = planStudioViewStageLayout({
        documentWidth: 720,
        documentHeight: 1_280,
        scale: 0.75,
        canvasFlipH,
        canvasRotation,
      });
      const wrapLeft = 80;
      const wrapTop = 50;
      const scrollLeft = Math.min(210, Math.max(0, layout.width - 640));
      const scrollTop = Math.min(160, Math.max(0, layout.height - 480));
      const baseLeft = wrapLeft - scrollLeft;
      const baseTop = wrapTop - scrollTop;
      const clientX = 390;
      const clientY = 260;
      const originX = Math.min(layout.width, Math.max(0, clientX - baseLeft));
      const originY = Math.min(layout.height, Math.max(0, clientY - baseTop));
      const frame = planStudioViewZoomGestureFrame({
        baseZoom: 1,
        targetZoom: 1.37,
        originX,
        originY,
        originClientX: baseLeft + originX,
        originClientY: baseTop + originY,
        clientX: baseLeft + originX,
        clientY: baseTop + originY,
        baseLeft,
        baseTop,
        baseWidth: layout.width,
        baseHeight: layout.height,
        wrapLeft,
        wrapTop,
        viewportWidth: 640,
        viewportHeight: 480,
      });

      // CSS preview: the transform-origin point only receives the returned translation.
      const previewX = baseLeft + originX + frame.translateX;
      const previewY = baseTop + originY + frame.translateY;
      // Settled layout: the same view-local point is scaled and offset by native scrolling.
      const settledX = wrapLeft - frame.targetScrollLeft + originX * frame.scale;
      const settledY = wrapTop - frame.targetScrollTop + originY * frame.scale;
      expect(previewX).toBeCloseTo(settledX, 10);
      expect(previewY).toBeCloseTo(settledY, 10);
    }
  );

  it("contains malformed client and host coordinates instead of emitting a NaN transform", () => {
    expect(planStudioViewZoomGestureFrame({
      baseZoom: Number.NaN,
      targetZoom: Number.POSITIVE_INFINITY,
      originX: Number.POSITIVE_INFINITY,
      originY: Number.NaN,
      originClientX: Number.NaN,
      originClientY: Number.NaN,
      clientX: Number.NaN,
      clientY: Number.NaN,
      baseLeft: Number.NaN,
      baseTop: Number.NaN,
      baseWidth: 1_000,
      baseHeight: 800,
      wrapLeft: Number.NaN,
      wrapTop: Number.NaN,
      viewportWidth: 600,
      viewportHeight: 500,
    })).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
      targetScrollLeft: 0,
      targetScrollTop: 0,
    });
  });
});

describe("studio view rotation", () => {
  it.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-450, 270],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ] as const)("normalizes %s degrees to %s", (input, expected) => {
    expect(normalizeStudioViewRotation(input)).toBe(expected);
  });

  it("rotates left and right by one canonical quarter turn", () => {
    expect(rotateStudioViewRight(0)).toBe(90);
    expect(rotateStudioViewRight(270)).toBe(0);
    expect(rotateStudioViewLeft(0)).toBe(270);
    expect(rotateStudioViewLeft(90)).toBe(0);
  });

  it.each([
    [0, false, { width: 360, height: 540, x: 0, y: 0, rotation: 0, scaleX: 0.5, scaleY: 0.5 }],
    [90, false, { width: 540, height: 360, x: 540, y: 0, rotation: 90, scaleX: 0.5, scaleY: 0.5 }],
    [180, false, { width: 360, height: 540, x: 360, y: 540, rotation: 180, scaleX: 0.5, scaleY: 0.5 }],
    [270, false, { width: 540, height: 360, x: 0, y: 360, rotation: 270, scaleX: 0.5, scaleY: 0.5 }],
    [0, true, { width: 360, height: 540, x: 360, y: 0, rotation: 0, scaleX: -0.5, scaleY: 0.5 }],
    [90, true, { width: 540, height: 360, x: 0, y: 0, rotation: 90, scaleX: 0.5, scaleY: -0.5 }],
    [180, true, { width: 360, height: 540, x: 0, y: 540, rotation: 180, scaleX: -0.5, scaleY: 0.5 }],
    [270, true, { width: 540, height: 360, x: 540, y: 360, rotation: 270, scaleX: 0.5, scaleY: -0.5 }],
  ] as const)("lays out rotation=%s flipH=%s", (canvasRotation, canvasFlipH, expected) => {
    expect(planStudioViewStageLayout({
      documentWidth: 720,
      documentHeight: 1_080,
      scale: 0.5,
      canvasFlipH,
      canvasRotation,
    })).toEqual(expected);
  });

  it.each([
    [0, false, { x: 20, y: 30 }],
    [90, false, { x: 170, y: 20 }],
    [180, false, { x: 80, y: 170 }],
    [270, false, { x: 30, y: 80 }],
    [0, true, { x: 80, y: 30 }],
    [90, true, { x: 30, y: 20 }],
    [180, true, { x: 20, y: 170 }],
    [270, true, { x: 170, y: 80 }],
  ] as const)(
    "round-trips a point for rotation=%s flipH=%s",
    (canvasRotation, canvasFlipH, expected) => {
      const projected = projectStudioDocumentPointToView({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH,
        canvasRotation,
        x: 20,
        y: 30,
      });
      expect(projected).toMatchObject(expected);
      expect(projectStudioViewPointToDocument({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH,
        canvasRotation,
        x: projected.x,
        y: projected.y,
      })).toEqual({ x: 20, y: 30 });
    }
  );

  it.each([0, 90, 180, 270] as const)(
    "keeps horizontal flip screen-relative at %s degrees",
    (canvasRotation) => {
      const normal = projectStudioDocumentPointToView({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH: false,
        canvasRotation,
        x: 20,
        y: 30,
      });
      const flipped = projectStudioDocumentPointToView({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH: true,
        canvasRotation,
        x: 20,
        y: 30,
      });

      expect(flipped.x).toBe(normal.viewWidth - normal.x);
      expect(flipped.y).toBe(normal.y);
    }
  );

  it.each([
    [0, false, { x: 10, y: 20, width: 30, height: 40 }],
    [90, false, { x: 140, y: 10, width: 40, height: 30 }],
    [180, false, { x: 60, y: 140, width: 30, height: 40 }],
    [270, false, { x: 20, y: 60, width: 40, height: 30 }],
    [0, true, { x: 60, y: 20, width: 30, height: 40 }],
    [90, true, { x: 20, y: 10, width: 40, height: 30 }],
    [180, true, { x: 10, y: 140, width: 30, height: 40 }],
    [270, true, { x: 140, y: 60, width: 40, height: 30 }],
  ] as const)(
    "round-trips an AABB for rotation=%s flipH=%s",
    (canvasRotation, canvasFlipH, expected) => {
      const projected = projectStudioDocumentRectToViewRect({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH,
        canvasRotation,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      });
      expect(projected).toEqual(expected);
      expect(projectStudioViewRectToDocumentRect({
        documentWidth: 100,
        documentHeight: 200,
        canvasFlipH,
        canvasRotation,
        ...projected,
      })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    }
  );

  it("keeps scale and the centered document point stable while rotating a long canvas", () => {
    expect(planStudioViewRotationTransition({
      documentWidth: 720,
      documentHeight: 8_000,
      canvasFlipH: false,
      canvasRotation: 0,
      nextCanvasRotation: 90,
      scale: 1,
      scrollLeft: 200,
      scrollTop: 3_000,
      viewportWidth: 300,
      viewportHeight: 300,
    })).toEqual({
      canvasRotation: 90,
      documentPoint: { x: 350, y: 3_150 },
      scrollLeft: 4_700,
      scrollTop: 200,
    });
  });

  it("clamps centered scrolling at transformed view edges", () => {
    expect(planStudioViewScrollToDocumentPoint({
      documentWidth: 100,
      documentHeight: 200,
      canvasFlipH: true,
      canvasRotation: 90,
      scale: 2,
      viewportWidth: 80,
      viewportHeight: 60,
      x: 100,
      y: 200,
    })).toEqual({ scrollLeft: 320, scrollTop: 140 });
  });
});

describe("visible document placement", () => {
  it("uses the scrolled canvas intersection instead of the full long-document center", () => {
    expect(resolveStudioVisibleDocumentPlacement({
      documentWidth: 720,
      documentHeight: 4_000,
      canvasFlipH: false,
      canvasRotation: 0,
      hostRect: { left: 100, top: 100, right: 820, bottom: 4_100 },
      viewportRect: { left: 100, top: 1_500, right: 820, bottom: 2_300 },
    })).toEqual({
      center: { x: 360, y: 1_800 },
      bounds: { x: 0, y: 1_400, width: 720, height: 800 },
    });
  });

  it("uses the document center when a zoomed-out canvas is fully visible", () => {
    expect(resolveStudioVisibleDocumentPlacement({
      documentWidth: 720,
      documentHeight: 4_000,
      canvasFlipH: false,
      canvasRotation: 0,
      hostRect: { left: 320, top: 200, right: 680, bottom: 2_200 },
      viewportRect: { left: 0, top: 0, right: 1_000, bottom: 3_000 },
    })).toEqual({
      center: { x: 360, y: 2_000 },
      bounds: { x: 0, y: 0, width: 720, height: 4_000 },
    });
  });

  it("maps the visible intersection back through a quarter-turn rotation", () => {
    expect(resolveStudioVisibleDocumentPlacement({
      documentWidth: 720,
      documentHeight: 4_000,
      canvasFlipH: false,
      canvasRotation: 90,
      hostRect: { left: 0, top: 0, right: 4_000, bottom: 720 },
      viewportRect: { left: 1_000, top: 0, right: 1_800, bottom: 720 },
    })).toEqual({
      center: { x: 360, y: 2_600 },
      bounds: { x: 0, y: 2_200, width: 720, height: 800 },
    });
  });

  it("returns null when the canvas is outside the viewport", () => {
    expect(resolveStudioVisibleDocumentPlacement({
      documentWidth: 720,
      documentHeight: 4_000,
      canvasFlipH: false,
      hostRect: { left: 0, top: 0, right: 720, bottom: 4_000 },
      viewportRect: { left: 900, top: 0, right: 1_200, bottom: 500 },
    })).toBeNull();
  });
});

describe("studio view snapshots", () => {
  it("restores the same document center after viewport dimensions change", () => {
    const snapshot = captureStudioView({
      pageId: "page-1",
      scale: 1.5,
      zoom: 2,
      scrollLeft: 900,
      scrollTop: 1_800,
      viewportWidth: 600,
      viewportHeight: 800,
      canvasWidth: 720,
      canvasHeight: 2_000,
      canvasFlipH: true,
    });

    expect(snapshot.centerX).toBe(320);
    expect(snapshot.centerY).toBeCloseTo(733.333333, 5);
    expect(snapshot.canvasRotation).toBe(0);

    const restored = planStudioViewRestore({
      snapshot,
      pageId: "page-1",
      viewportWidth: 400,
      viewportHeight: 600,
      canvasWidth: 720,
      canvasHeight: 2_000,
    });

    expect(restored).toEqual({
      scale: 1.5,
      zoom: 2,
      scrollLeft: 1_000,
      scrollTop: 1_900,
      canvasFlipH: true,
      canvasRotation: 0,
    });
  });

  it("preserves a rotated view and restores against the swapped visual bounds", () => {
    const snapshot = captureStudioView({
      pageId: "page-1",
      scale: 1,
      zoom: 1,
      scrollLeft: 900,
      scrollTop: 100,
      viewportWidth: 200,
      viewportHeight: 300,
      canvasWidth: 720,
      canvasHeight: 2_000,
      canvasFlipH: true,
      canvasRotation: 450,
    });

    expect(snapshot).toMatchObject({
      centerX: 250,
      centerY: 1_000,
      canvasFlipH: true,
      canvasRotation: 90,
    });

    expect(planStudioViewRestore({
      snapshot,
      pageId: "page-1",
      viewportWidth: 400,
      viewportHeight: 200,
      canvasWidth: 720,
      canvasHeight: 2_000,
    })).toEqual({
      scale: 1,
      zoom: 1,
      scrollLeft: 800,
      scrollTop: 150,
      canvasFlipH: true,
      canvasRotation: 90,
    });
  });

  it("does not restore a saved view onto another page", () => {
    const snapshot = captureStudioView({
      pageId: "page-1",
      scale: 1,
      zoom: 1,
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 720,
      viewportHeight: 800,
      canvasWidth: 720,
      canvasHeight: 1_080,
      canvasFlipH: false,
    });
    expect(planStudioViewRestore({
      snapshot,
      pageId: "page-2",
      viewportWidth: 720,
      viewportHeight: 800,
      canvasWidth: 720,
      canvasHeight: 1_080,
    })).toBeNull();
  });

  it("clamps restored scrolling to the canvas bounds", () => {
    const snapshot = {
      pageId: "page-1",
      scale: 1,
      zoom: 1,
      centerX: 10_000,
      centerY: 10_000,
      canvasFlipH: false,
      canvasRotation: 0 as const,
    };
    expect(planStudioViewRestore({
      snapshot,
      pageId: "page-1",
      viewportWidth: 500,
      viewportHeight: 600,
      canvasWidth: 720,
      canvasHeight: 1_080,
    })).toMatchObject({ scrollLeft: 220, scrollTop: 480 });
  });
});
