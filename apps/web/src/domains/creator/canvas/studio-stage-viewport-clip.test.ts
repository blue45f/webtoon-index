/**
 * The adaptive viewport clip: threshold behaviour, window geometry, and — the part that decides
 * whether this feature can ship at all — **pointer coordinate identity**.
 *
 * Clipping the Stage moves two things in opposite directions: the Stage's own translation loses the
 * clip offset, and the Stage container's CSS transform gains it. If those ever disagree, or if the
 * composition is wrong under a quarter turn or a flip, the artist's cursor stops landing where the
 * ink appears. That is a silent, magnification-dependent failure, so the grid below asserts that a
 * screen point maps to the *identical* document point clipped and unclipped, across the
 * magnifications, rotations and flips the product actually offers.
 */

import { describe, expect, it } from "vitest";

import { planStudioCanvasStageLayout } from "../studio-view-controls";

import {
  applyStudioStageViewportClip,
  planStudioStageViewportClipBox,
  positionStudioStageViewportClip,
  resolveStudioStageViewportClipArmed,
  studioStageBackingPixels,
  STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS,
  STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX,
  STUDIO_STAGE_VIEWPORT_CLIP_QUANTUM_PX,
  STUDIO_STAGE_VIEWPORT_CLIP_RELEASE_PIXELS,
  type StudioStageViewportClipRuntime,
} from "./studio-stage-viewport-clip";

import type { StudioViewStageLayout } from "../studio-view-controls";

const DOCUMENT_WIDTH = 924;
const DOCUMENT_HEIGHT = 1386;
const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 } as const;

/**
 * Screen point -> document point, exactly the way the browser and Konva compose it.
 *
 * The Stage container sits at `containerOffset` inside the document-sized zoom host, and Konva maps
 * a client point through `container rect` then the inverse Stage transform. Konva's absolute
 * transform is `translate(x, y) · rotate(rotation) · scale(scaleX, scaleY)`, so the inverse is
 * applied in the opposite order here.
 */
function screenPointToDocument(
  layout: StudioViewStageLayout,
  containerOffset: { left: number; top: number },
  point: { x: number; y: number }
): { x: number; y: number } {
  const stageLocalX = point.x - containerOffset.left - layout.x;
  const stageLocalY = point.y - containerOffset.top - layout.y;
  const radians = (-layout.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const unrotatedX = stageLocalX * cos - stageLocalY * sin;
  const unrotatedY = stageLocalX * sin + stageLocalY * cos;
  return { x: unrotatedX / layout.scaleX, y: unrotatedY / layout.scaleY };
}

describe("clip arming threshold", () => {
  it("keeps the 100% document view unclipped and clips a 500% one", () => {
    const at = (scale: number) =>
      studioStageBackingPixels({
        documentWidth: DOCUMENT_WIDTH,
        documentHeight: DOCUMENT_HEIGHT,
        scale,
        devicePixelRatio: 1,
      });
    // 0.78 Mpx — measured as already optimal with a document-sized Stage.
    expect(resolveStudioStageViewportClipArmed(at(1), false)).toBe(false);
    // 32 Mpx — the 3.2s pan stall from docs/perf/canvas-findings.md §B-4.
    expect(resolveStudioStageViewportClipArmed(at(5), false)).toBe(true);
  });

  it("holds its decision inside the dead band", () => {
    const inside = (STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS + STUDIO_STAGE_VIEWPORT_CLIP_RELEASE_PIXELS) / 2;
    expect(resolveStudioStageViewportClipArmed(inside, true)).toBe(true);
    expect(resolveStudioStageViewportClipArmed(inside, false)).toBe(false);
  });

  /*
   * The anti-oscillation property, stated as an arithmetic fact rather than a hope. One wheel notch
   * multiplies the zoom by ~1.2, hence the Stage area by 1.44. The dead band is wider than that, so
   * rocking the wheel one notch back and forth at the boundary cannot toggle the clip.
   */
  it("has a dead band wider than one wheel notch of area change", () => {
    const notchAreaRatio = 1.2 * 1.2;
    const deadBandRatio =
      STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS / STUDIO_STAGE_VIEWPORT_CLIP_RELEASE_PIXELS;
    expect(deadBandRatio).toBeGreaterThan(notchAreaRatio);

    const justArmed = STUDIO_STAGE_VIEWPORT_CLIP_ARM_PIXELS * 1.01;
    expect(resolveStudioStageViewportClipArmed(justArmed, false)).toBe(true);
    expect(resolveStudioStageViewportClipArmed(justArmed / notchAreaRatio, true)).toBe(true);
  });

  it("counts device pixels, so a retina display clips at a lower magnification", () => {
    const retina = studioStageBackingPixels({
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      scale: 1.6,
      devicePixelRatio: 2,
    });
    const standard = studioStageBackingPixels({
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      scale: 1.6,
      devicePixelRatio: 1,
    });
    expect(retina).toBeCloseTo(standard * 4, 6);
    expect(resolveStudioStageViewportClipArmed(retina, false)).toBe(true);
    expect(resolveStudioStageViewportClipArmed(standard, false)).toBe(false);
  });

  it("refuses to arm on a non-finite measurement", () => {
    expect(resolveStudioStageViewportClipArmed(Number.NaN, true)).toBe(false);
  });
});

describe("clip window geometry", () => {
  it("returns null when the window would not shrink the stage", () => {
    expect(planStudioStageViewportClipBox(400, 500, { ...VIEWPORT, scrollLeft: 0, scrollTop: 0 }))
      .toBeNull();
    expect(planStudioStageViewportClipBox(4620, 6930, null)).toBeNull();
    expect(
      planStudioStageViewportClipBox(0, 6930, { ...VIEWPORT, scrollLeft: 0, scrollTop: 0 })
    ).toBeNull();
  });

  it("covers the viewport plus an overscan margin on every side", () => {
    const clip = planStudioStageViewportClipBox(4620, 6930, {
      ...VIEWPORT,
      scrollLeft: 2_000,
      scrollTop: 3_000,
    });
    expect(clip).not.toBeNull();
    expect(clip!.width).toBeGreaterThanOrEqual(
      VIEWPORT.viewportWidth + 2 * STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX
    );
    expect(clip!.height).toBeGreaterThanOrEqual(
      VIEWPORT.viewportHeight + 2 * STUDIO_STAGE_VIEWPORT_CLIP_OVERSCAN_PX
    );
    expect(clip!.width % STUDIO_STAGE_VIEWPORT_CLIP_QUANTUM_PX).toBe(0);
    expect(clip!.height % STUDIO_STAGE_VIEWPORT_CLIP_QUANTUM_PX).toBe(0);
    // The visible viewport is fully inside the window.
    expect(clip!.left).toBeLessThanOrEqual(2_000);
    expect(clip!.top).toBeLessThanOrEqual(3_000);
    expect(clip!.left + clip!.width).toBeGreaterThanOrEqual(2_000 + VIEWPORT.viewportWidth);
    expect(clip!.top + clip!.height).toBeGreaterThanOrEqual(3_000 + VIEWPORT.viewportHeight);
  });

  /*
   * Panning must never reallocate: changing the Stage *size* throws away every scene canvas, while
   * moving it does not. If this ever regressed, a pan would pay the zoom-settle cost on every frame.
   */
  it("keeps the window size constant across the whole scroll range", () => {
    const sizes = new Set<string>();
    for (let scroll = 0; scroll <= 6_000; scroll += 137) {
      const clip = planStudioStageViewportClipBox(4620, 6930, {
        ...VIEWPORT,
        scrollLeft: scroll % 3_800,
        scrollTop: scroll,
      });
      sizes.add(`${clip!.width}x${clip!.height}`);
    }
    expect(sizes.size).toBe(1);
  });

  it("clamps the window inside the document box at both extremes", () => {
    const box = { stageWidth: 4620, stageHeight: 6930, width: 1088, height: 896 };
    expect(positionStudioStageViewportClip(box, 0, 0)).toEqual({ left: 0, top: 0 });
    expect(positionStudioStageViewportClip(box, 99_999, 99_999)).toEqual({
      left: 4620 - 1088,
      top: 6930 - 896,
    });
    expect(positionStudioStageViewportClip(box, Number.NaN, Number.NaN)).toEqual({ left: 0, top: 0 });
  });
});

describe("pointer coordinate identity across the clip", () => {
  const magnifications = [
    { label: "100%", scale: 1 },
    { label: "246%", scale: 2.46 },
    { label: "500%", scale: 5 },
  ] as const;
  const views = [
    { label: "0deg", canvasRotation: 0, canvasFlipH: false },
    { label: "0deg flipped", canvasRotation: 0, canvasFlipH: true },
    { label: "90deg", canvasRotation: 90, canvasFlipH: false },
    { label: "90deg flipped", canvasRotation: 90, canvasFlipH: true },
    { label: "180deg", canvasRotation: 180, canvasFlipH: false },
    { label: "270deg flipped", canvasRotation: 270, canvasFlipH: true },
  ] as const;
  const scrollOffsets = [
    { scrollLeft: 0, scrollTop: 0 },
    { scrollLeft: 640, scrollTop: 1_280 },
    { scrollLeft: 3_400, scrollTop: 5_600 },
  ] as const;
  // Screen samples spread over the visible window, including its exact corners.
  const screenSamples = [0, 0.25, 0.5, 0.75, 1].flatMap((u) =>
    [0, 0.5, 1].map((v) => ({ u, v }))
  );

  for (const magnification of magnifications) {
    for (const view of views) {
      for (const scroll of scrollOffsets) {
        it(
          `maps screen to document identically at ${magnification.label} ${view.label} `
            + `scrolled ${scroll.scrollLeft},${scroll.scrollTop}`,
          () => {
            const shared = {
              documentWidth: DOCUMENT_WIDTH,
              documentHeight: DOCUMENT_HEIGHT,
              scale: magnification.scale,
              canvasFlipH: view.canvasFlipH,
              canvasRotation: view.canvasRotation,
              captureDocumentView: false,
            } as const;
            const unclipped = planStudioCanvasStageLayout({ ...shared, viewportClip: null });
            const clipped = planStudioCanvasStageLayout({
              ...shared,
              viewportClip: { ...VIEWPORT, ...scroll },
            });
            expect(unclipped.clip).toBeNull();
            // Without this the grid could pass by never clipping anything.
            expect(clipped.clip).not.toBeNull();

            const clip = clipped.clip ?? { left: 0, top: 0, width: 0, height: 0 };
            const origin = { left: clip.left, top: clip.top };
            // The clip window has to contain the visible viewport, otherwise "identical mapping"
            // would be proved over screen points that the clipped Stage does not actually paint.
            const windowLeft = clipped.clip ? clip.left : 0;
            const windowTop = clipped.clip ? clip.top : 0;
            const windowWidth = clipped.clip ? clip.width : unclipped.width;
            const windowHeight = clipped.clip ? clip.height : unclipped.height;

            for (const sample of screenSamples) {
              const point = {
                x: windowLeft + windowWidth * sample.u,
                y: windowTop + windowHeight * sample.v,
              };
              const reference = screenPointToDocument(unclipped, { left: 0, top: 0 }, point);
              const actual = screenPointToDocument(clipped, origin, point);
              // Sub-nanometre in document space: the two paths must be arithmetically identical,
              // not merely close enough to look right.
              expect(actual.x).toBeCloseTo(reference.x, 9);
              expect(actual.y).toBeCloseTo(reference.y, 9);
            }
          }
        );
      }
    }
  }

  it("keeps the document origin on the same screen pixel", () => {
    for (const magnification of magnifications) {
      for (const view of views) {
        const shared = {
          documentWidth: DOCUMENT_WIDTH,
          documentHeight: DOCUMENT_HEIGHT,
          scale: magnification.scale,
          canvasFlipH: view.canvasFlipH,
          canvasRotation: view.canvasRotation,
          captureDocumentView: false,
        } as const;
        const unclipped = planStudioCanvasStageLayout({ ...shared, viewportClip: null });
        const clipped = planStudioCanvasStageLayout({
          ...shared,
          viewportClip: { ...VIEWPORT, scrollLeft: 1_500, scrollTop: 2_500 },
        });
        const clip = clipped.clip;
        if (!clip) continue;
        expect(clipped.x + clip.left).toBeCloseTo(unclipped.x, 9);
        expect(clipped.y + clip.top).toBeCloseTo(unclipped.y, 9);
        expect(clipped.rotation).toBe(unclipped.rotation);
        expect(clipped.scaleX).toBe(unclipped.scaleX);
        expect(clipped.scaleY).toBe(unclipped.scaleY);
        expect(clipped.hostWidth).toBe(unclipped.width);
        expect(clipped.hostHeight).toBe(unclipped.height);
      }
    }
  });
});

describe("applyStudioStageViewportClip", () => {
  function createSurface() {
    const container = { style: { transform: "" } };
    const positions: { x: number; y: number }[] = [];
    let draws = 0;
    return {
      container: () => container,
      position: (point: { x: number; y: number }) => {
        positions.push(point);
      },
      batchDraw: () => {
        draws += 1;
      },
      read: () => ({ transform: container.style.transform, positions, draws }),
    };
  }

  const runtime = (): StudioStageViewportClipRuntime => ({
    stageWidth: 4620,
    stageHeight: 6930,
    width: 1088,
    height: 896,
    baseX: 0,
    baseY: 0,
    appliedLeft: Number.NaN,
    appliedTop: Number.NaN,
  });

  it("writes the container transform and the stage translation together", () => {
    const surface = createSurface();
    const state = runtime();

    expect(applyStudioStageViewportClip(surface, state, 1_000, 2_000)).toBe(true);

    const { transform, positions } = surface.read();
    const expected = positionStudioStageViewportClip(state, 1_000, 2_000);
    expect(transform).toBe(`translate3d(${expected.left}px, ${expected.top}px, 0)`);
    expect(positions).toEqual([{ x: -expected.left, y: -expected.top }]);
  });

  it("keeps the base translation of a rotated view", () => {
    const surface = createSurface();
    const state = { ...runtime(), baseX: 6_930, baseY: 0 };

    applyStudioStageViewportClip(surface, state, 500, 900);

    const expected = positionStudioStageViewportClip(state, 500, 900);
    expect(surface.read().positions).toEqual([
      { x: 6_930 - expected.left, y: -expected.top },
    ]);
  });

  it("skips the redraw when the window did not move", () => {
    const surface = createSurface();
    const state = runtime();

    applyStudioStageViewportClip(surface, state, 1_000, 2_000);
    expect(applyStudioStageViewportClip(surface, state, 1_000, 2_000)).toBe(false);
    expect(surface.read().draws).toBe(1);
  });
});
