/**
 * Browser harness for the brush texture-defect lab.
 *
 * This entry renders the REAL committed-stroke renderer (`StudioDrawNode`, the same React/Konva
 * node `StudioCanvasViewport` mounts for every persisted stroke) into a real 2-D canvas inside a
 * real GPU Chromium, then hands the raw RGBA readback back to Node. No metric is computed here:
 * the numbers are produced by `tests/benchmarks/harness/brush-texture-lab.ts`
 * (`edgeMetrics` / `rippleMetrics` / `grainMetrics`), exactly like `brush-paper-grain-lab.ts`
 * imports them rather than reimplementing them.
 *
 * Driven by `tests/benchmarks/harness/brush-defect-lab.ts`.
 */
import Konva from "konva";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Layer, Stage } from "react-konva/lib/ReactKonvaCore";

import { studioBrushDynamicsSettingsForBrushId } from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "../apps/web/src/domains/creator/brush/studio-brush-library";
import {
  resolveStudioStampBrushKind,
  STUDIO_STAMP_BRUSH_DEFAULTS,
} from "../apps/web/src/domains/creator/brush/studio-brush-stamp-engine";
import { planStudioDrawPointerStart } from "../apps/web/src/domains/creator/brush/studio-draw-pointer-start-plan";
import { StudioDrawNode } from "../apps/web/src/domains/creator/brush/StudioDrawNode";
import "../apps/web/src/domains/creator/render/studio-konva-runtime.ts";

import type { DrawEl } from "../apps/web/src/domains/creator/studio-element-model";

export interface StudioBrushDefectLaneRequest {
  readonly key: string;
  readonly brush: string;
  readonly color: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly width: number;
  readonly height: number;
  readonly axis: "horizontal" | "vertical";
  readonly start: number;
  readonly end: number;
  readonly centre: number;
  readonly sampleCount: number;
  readonly pressure: number;
}

export interface StudioBrushDefectLaneFrame {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** base64 of the raw RGBA8 readback (non-premultiplied, transparent background). */
  readonly rgbaBase64: string;
}

declare global {
  interface Window {
    __studioBrushDefectRenderLane?: (
      request: StudioBrushDefectLaneRequest,
    ) => Promise<StudioBrushDefectLaneFrame>;
    __studioBrushDefectReady?: boolean;
    __studioBrushDefectError?: string;
  }
}

/** Mirror of `defaultStampTuningForBrushId` in StudioPage (which is module-private there). */
function stampTuningForBrushId(brushId: string) {
  const kind = resolveStudioStampBrushKind(brushId);
  if (!kind) return null;
  const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[kind];
  return { flow: defaults.flow, hardness: defaults.hardness, minSize: defaults.minSizeRatio };
}

/**
 * Build the element through the SAME planner the app runs at pointer-down
 * (`planStudioDrawPointerStart`), then replace only its sample arrays with the lane geometry.
 * This is what makes the lane a real stroke: `sampleSpacing`, `pressureModel`, `paintModel`,
 * `brushTip`, `outlineStroke`, `stampPipeline` and the ink-input contract are produced by
 * production code with the app's own default brush snapshot, not guessed by the harness.
 */
function laneElement(request: StudioBrushDefectLaneRequest): DrawEl {
  const points: number[] = [];
  const pressures: number[] = [];
  const span = request.end - request.start;
  for (let index = 0; index < request.sampleCount; index += 1) {
    const t = index / (request.sampleCount - 1);
    const along = request.start + span * t;
    if (request.axis === "horizontal") {
      points.push(along, request.centre);
    } else {
      points.push(request.centre, along);
    }
    pressures.push(request.pressure);
  }
  const snapshot = DEFAULT_STUDIO_BRUSH_SNAPSHOT;
  const plan = planStudioDrawPointerStart({
    id: `defect-lane-${request.key}`,
    position: { x: points[0]!, y: points[1]! },
    pointer: {
      pointerType: "mouse",
      pressure: request.pressure,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      timeStamp: 0,
    },
    drawMode: "pen",
    drawShape: "line",
    shapeFill: false,
    color: request.color,
    strokeWidth: request.strokeWidth,
    brushOpacity: request.opacity,
    brush: request.brush,
    // `applyBrushSlot` in StudioPage installs exactly these two per-brush snapshots when a preset
    // is selected; using the generic defaults instead would silently flatten every dynamics brush.
    stampTuning: stampTuningForBrushId(request.brush),
    brushDynamics: studioBrushDynamicsSettingsForBrushId(request.brush) ?? snapshot.brushDynamics,
    stabilizer: snapshot.stabilizer,
    stabilizerMode: snapshot.stabilizerMode,
    velocitySensitivity: snapshot.velocitySensitivity,
    pressureCurve: snapshot.pressureCurve,
    pressureMinSize: snapshot.pressureMinSize,
    positionScale: 1,
    brushTip: {
      tiltEnabled: snapshot.tiltEnabled,
      angleDeg: snapshot.tipAngle,
      roundness: snapshot.tipRoundness,
    },
    symmetry: { type: "none", centerX: 0, centerY: 0, radialCount: 0 },
  });
  // The planner resolves the pressure a real pointer of this type would have recorded (mouse
  // strokes take the versioned linear-ink full-pressure fallback). Replaying it at every sample is
  // what makes the lane a constant-speed, constant-pressure stroke rather than a synthetic 0.5.
  return { ...plan.element, points, pressures: pressures.map(() => plan.pressure) };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function ensureHost(): HTMLDivElement {
  if (host) return host;
  const node = document.createElement("div");
  node.id = "studio-brush-defect-host";
  node.style.position = "fixed";
  node.style.left = "0";
  node.style.top = "0";
  document.body.appendChild(node);
  host = node;
  return node;
}

function frameSettled(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function toBase64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)),
    );
  }
  return btoa(binary);
}

async function renderLane(
  request: StudioBrushDefectLaneRequest,
): Promise<StudioBrushDefectLaneFrame> {
  const container = ensureHost();
  root ??= createRoot(container);
  const element = laneElement(request);
  root.render(
    createElement(
      Stage,
      { width: request.width, height: request.height, key: request.key },
      createElement(
        Layer,
        { key: `${request.key}-layer` },
        createElement(StudioDrawNode, { el: element }),
      ),
    ),
  );
  // Async renderer dependencies (perfect-freehand stroker, pattern tiles) resolve on a
  // microtask + one paint; give them several frames before the readback.
  for (let attempt = 0; attempt < 12; attempt += 1) await frameSettled();
  const stage = Konva.stages.at(-1);
  if (!stage) throw new Error("no Konva stage was mounted");
  stage.batchDraw();
  await frameSettled();
  const canvas = stage.toCanvas({
    x: 0,
    y: 0,
    width: request.width,
    height: request.height,
    pixelRatio: 1,
  });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2-D readback context unavailable");
  const image = context.getImageData(0, 0, request.width, request.height);
  return {
    key: request.key,
    width: image.width,
    height: image.height,
    rgbaBase64: toBase64(image.data),
  };
}

try {
  Konva.pixelRatio = 1;
  window.__studioBrushDefectRenderLane = renderLane;
  window.__studioBrushDefectReady = true;
} catch (error) {
  window.__studioBrushDefectError =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
}
