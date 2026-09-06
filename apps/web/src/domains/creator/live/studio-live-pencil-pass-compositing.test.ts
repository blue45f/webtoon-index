import { describe, expect, it } from "vitest";

import { studioBrushAliasEffectiveDiameter } from "../brush/studio-brush-alias-profile";
import { studioPencilAliasPasses, studioPencilAliasPassPoints, studioPencilRibbonAlphaBucket, STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT } from "../brush/studio-pencil-alias-passes";
import { planStudioRetainedMediaPressureCurve, planStudioRetainedMediaTapDab, resolveStudioRetainedMediaPressureProfileId } from "../studio-retained-media-pressure";
import { planStudioRetainedMediaRibbon } from "../studio-retained-media-ribbon";

import { StudioLiveRetainedMediaOverlayRenderer } from "./studio-live-retained-media-overlay";

import type { DrawEl } from "../studio-element-model";

function canvasWithFillRecorder() {
  const fills: number[] = [];
  const saved: number[] = [];
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    save() { saved.push(this.globalAlpha); },
    restore() { this.globalAlpha = saved.pop() ?? 1; },
    setTransform() {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
    fill() { fills.push(this.globalAlpha); },
    clearRect() { fills.length = 0; },
    drawImage() {},
  };
  return {
    canvas: { width: 250, height: 100, getContext: () => context } as unknown as HTMLCanvasElement,
    fills,
    saved,
  };
}

const brushes = ["pencil", "pencil-2b", "pencil-6b", "soft-pencil", "pencil--side-shade", "colored-pencil"] as const;
const cases = brushes.flatMap((brush) => [1, 0.68, 0.1].map((opacity) => ({ brush, opacity })));

describe("live pencil pigment-pass composition", () => {
  it.each(cases)("preserves each $brush shell and applies opacity $opacity after material quantization", ({ brush, opacity }) => {
    const renderer = new StudioLiveRetainedMediaOverlayRenderer();
    const active = canvasWithFillRecorder();
    const settled = canvasWithFillRecorder();
    renderer.attach({ activeCanvas: active.canvas, settledCanvas: settled.canvas });
    renderer.setSurface({ left: 0, top: 0, width: 250, height: 100, documentScale: 1, documentWidth: 250, flipX: false });
    const element: DrawEl = {
      id: "pigment-layers", type: "draw", kind: "freehand", mode: "pen", brush,
      points: [25, 50, 175, 50], pressures: [0.5, 0.5],
      stroke: "#563cc7", strokeWidth: 10, opacity,
      materialPressureModel: "canonical-material-v1",
    };
    // Independent committed-renderer contract: one quantized compound fill per pass/bucket,
    // with the whole-element alpha applied AFTER selecting the material bucket.
    const expected: number[] = [];
    const profile = resolveStudioRetainedMediaPressureProfileId(brush) ?? "pencil";
    const width = studioBrushAliasEffectiveDiameter(brush, element.strokeWidth);
    for (const pass of studioPencilAliasPasses(brush)) {
      const curve = planStudioRetainedMediaPressureCurve(
        studioPencilAliasPassPoints(element.points, pass.jitterRadius),
        element.pressures, profile,
      );
      const ribbon = planStudioRetainedMediaRibbon(curve, Math.max(0.5, width * pass.widthScale));
      const buckets = new Set<number>();
      for (const run of ribbon.runs) {
        for (const mark of [...run.cells, ...run.caps.filter((cap) => cap.role === "start")]) {
          const bucket = studioPencilRibbonAlphaBucket(Math.min(1, pass.opacityScale * Math.sqrt(mark.opacityScale * mark.flowScale)));
          if (bucket > 0) buckets.add(bucket);
        }
      }
      for (const bucket of [...buckets].sort((a, b) => a - b)) {
        expected.push(opacity * bucket / STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT);
      }
    }
    expect(expected.length).toBeGreaterThan(0);
    expect(renderer.begin(element).status).toBe("started");
    expect(active.fills).toEqual(expected);
    expect(active.saved).toHaveLength(0);
    renderer.clear();
    expect(renderer.retainedPencilCommandCount).toBe(0);
  });
});

describe("live pencil tap composition", () => {
  const TAP_POINT = [40, 50];
  const FULL_PRESSURE = [1];

  it("drives the plain pencil's full-pressure response past the clamp, so the order is observable", () => {
    const tap = planStudioRetainedMediaTapDab(TAP_POINT, FULL_PRESSURE, "pencil");
    expect(tap).not.toBeNull();
    expect(Math.sqrt(tap!.opacityScale * tap!.flowScale)).toBeGreaterThan(1);
  });

  it.each(brushes)("applies the whole-element opacity outside the material clamp on a %s tap", (brush) => {
    const renderer = new StudioLiveRetainedMediaOverlayRenderer();
    const active = canvasWithFillRecorder();
    const settled = canvasWithFillRecorder();
    renderer.attach({ activeCanvas: active.canvas, settledCanvas: settled.canvas });
    renderer.setSurface({ left: 0, top: 0, width: 250, height: 100, documentScale: 1, documentWidth: 250, flipX: false });
    const opacity = 0.68;
    const element: DrawEl = {
      id: "heavy-tap", type: "draw", kind: "freehand", mode: "pen", brush,
      points: TAP_POINT, pressures: FULL_PRESSURE,
      stroke: "#563cc7", strokeWidth: 10, opacity,
      materialPressureModel: "canonical-material-v1",
    };
    const profile = resolveStudioRetainedMediaPressureProfileId(brush) ?? "pencil";
    const tap = planStudioRetainedMediaTapDab(element.points, element.pressures, profile);
    expect(tap).not.toBeNull();
    // Committed: <Group opacity={element}> over one <KCircle opacity={min(1, pass × response)}>
    // per pass, and Konva multiplies the two — the element opacity never enters the clamp.
    const response = Math.sqrt(tap!.opacityScale * tap!.flowScale);
    const expected = studioPencilAliasPasses(brush)
      .map((pass) => opacity * Math.min(1, pass.opacityScale * response));
    expect(renderer.begin(element).status).toBe("started");
    expect(active.fills).toEqual(expected);
    expect(active.saved).toHaveLength(0);
    renderer.clear();
    expect(renderer.retainedPencilCommandCount).toBe(0);
  });
});
