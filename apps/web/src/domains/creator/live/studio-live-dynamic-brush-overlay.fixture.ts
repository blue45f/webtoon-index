/**
 * Shared fixtures for the live dynamic-brush overlay suites.
 *
 * These live outside a `.test.ts` file so that more than one suite can use them, which is what
 * lets the COLD-START measurements run in their own module process. Vitest isolates modules per
 * file, so a gate that has to observe one-time initialisation cannot share a file with fourteen
 * tests that construct renderers first — measured, that gap is a cold reading of 4.05 in file
 * order against 14.69 process-first. An ordering convention inside one file would be silently
 * breakable by anyone adding a test above; a separate file is the enforcement.
 */
import { vi } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsPresetSettings,
} from "../brush/studio-brush-dynamics";
import { sha256HexPortable } from "../studio-sha256";

import { StudioLiveDynamicBrushOverlayRenderer } from "./studio-live-dynamic-brush-overlay";

import type { StudioPerfCalibrationSample } from "../brush/studio-perf-calibration";
import type { DrawEl } from "../studio-element-model";
import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";

export interface RecordedEllipse {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  readonly alpha: number;
  readonly color: string;
  readonly unionGeometry?: Readonly<{
    readonly coordinateCount: number;
    readonly byteLength: number;
    readonly sha256: string;
    /**
     * Raw rounded coordinate stream of this one fill command. Incremental union appends paint one
     * suffix fill per pointer frame, so semantic live/pointer-up parity is asserted by comparing
     * the order-preserving concatenation of these streams against the canonical one-fill union.
     */
    readonly coordinates: readonly number[];
  }>;
}

export interface RecordedComposite {
  readonly opacity: number;
  readonly marks: readonly RecordedEllipse[];
}

export interface RecordedCopy {
  readonly opacity: number;
  readonly sourceRect: readonly [number, number, number, number];
  readonly destinationRect: readonly [number, number, number, number];
}

export interface RecordingCanvas extends HTMLCanvasElement {
  readonly recordedMarks: RecordedEllipse[];
  readonly recordedComposites: RecordedComposite[];
  readonly recordedCopies: RecordedCopy[];
  readonly clearCount: () => number;
  readonly radialGradientCount: () => number;
  textureStamp: boolean;
  textureColor: string;
}

function rounded(value: number): number {
  return Number(value.toFixed(9));
}

export function recordingCanvas(): RecordingCanvas {
  const recordedMarks: RecordedEllipse[] = [];
  const recordedComposites: RecordedComposite[] = [];
  const recordedCopies: RecordedCopy[] = [];
  let clears = 0;
  let radialGradients = 0;
  let alpha = 1;
  let color = "#000000";
  let composite: GlobalCompositeOperation = "source-over";
  let translatedX = 0;
  let translatedY = 0;
  let rotation = 0;
  let scaleX = 1;
  let scaleY = 1;
  let path: Omit<RecordedEllipse, "alpha" | "color"> | null = null;
  let polygonPath: number[] = [];
  const stack: Array<{
    readonly alpha: number;
    readonly color: string;
    readonly composite: GlobalCompositeOperation;
    readonly translatedX: number;
    readonly translatedY: number;
    readonly rotation: number;
    readonly scaleX: number;
    readonly scaleY: number;
  }> = [];

  const canvas = {
    width: 0,
    height: 0,
    style: { opacity: "1" },
    recordedMarks,
    recordedComposites,
    recordedCopies,
    clearCount: () => clears,
    radialGradientCount: () => radialGradients,
    textureStamp: false,
    textureColor: "#000000",
    getContext: () => context,
  } as unknown as RecordingCanvas;

  const context = {
    save: () => {
      stack.push({
        alpha,
        color,
        composite,
        translatedX,
        translatedY,
        rotation,
        scaleX,
        scaleY,
      });
    },
    restore: () => {
      const state = stack.pop();
      if (!state) return;
      alpha = state.alpha;
      color = state.color;
      composite = state.composite;
      translatedX = state.translatedX;
      translatedY = state.translatedY;
      rotation = state.rotation;
      scaleX = state.scaleX;
      scaleY = state.scaleY;
    },
    setTransform: () => {
      translatedX = 0;
      translatedY = 0;
      rotation = 0;
      scaleX = 1;
      scaleY = 1;
    },
    clearRect: () => {
      clears += 1;
      recordedMarks.length = 0;
      recordedComposites.length = 0;
    },
    beginPath: () => {
      path = null;
      polygonPath = [];
    },
    moveTo: (x: number, y: number) => {
      polygonPath.push(x, y);
    },
    lineTo: (x: number, y: number) => {
      polygonPath.push(x, y);
    },
    closePath: () => undefined,
    createRadialGradient: () => {
      radialGradients += 1;
      return {
        addColorStop: () => undefined,
      } as CanvasGradient;
    },
    arc: (
      x: number,
      y: number,
      radius: number,
    ) => {
      path = {
        x: rounded(x),
        y: rounded(y),
        radiusX: rounded(radius),
        radiusY: rounded(radius),
        angleRadians: 0,
      };
    },
    ellipse: (
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      angleRadians: number,
    ) => {
      path = {
        x: rounded(x),
        y: rounded(y),
        radiusX: rounded(radiusX),
        radiusY: rounded(radiusY),
        angleRadians: rounded(angleRadians),
      };
    },
    translate: (x: number, y: number) => {
      translatedX += x;
      translatedY += y;
    },
    rotate: (angle: number) => {
      rotation += angle;
    },
    scale: (x: number, y: number) => {
      scaleX *= x;
      scaleY *= y;
    },
    fill: () => {
      let unionGeometry: RecordedEllipse["unionGeometry"];
      if (!path && polygonPath.length >= 6) {
        const xs = polygonPath.filter((_, index) => index % 2 === 0);
        const ys = polygonPath.filter((_, index) => index % 2 === 1);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        path = {
          x: rounded((minX + maxX) / 2),
          y: rounded((minY + maxY) / 2),
          radiusX: rounded((maxX - minX) / 2),
          radiusY: rounded((maxY - minY) / 2),
          angleRadians: 0,
        };
        const roundedCoordinates = polygonPath.map(rounded);
        const geometryBytes = new TextEncoder().encode(
          roundedCoordinates.join(","),
        );
        unionGeometry = Object.freeze({
          coordinateCount: polygonPath.length,
          byteLength: geometryBytes.byteLength,
          sha256: sha256HexPortable(geometryBytes),
          coordinates: Object.freeze(roundedCoordinates),
        });
      }
      if (!path) return;
      recordedMarks.push({
        ...path,
        alpha: rounded(alpha),
        color,
        ...(unionGeometry ? { unionGeometry } : {}),
      });
    },
    createImageData: (width: number, height: number) => ({
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData),
    putImageData: (imageData: ImageData) => {
      canvas.textureStamp = true;
      const [red = 0, green = 0, blue = 0] = imageData.data;
      canvas.textureColor = `#${[red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
    },
    fillRect: () => {
      if (composite === "source-in") {
        canvas.textureStamp = true;
        canvas.textureColor = color;
      }
    },
    drawImage: (
      source: CanvasImageSource,
      ...args: readonly number[]
    ) => {
      const sourceCanvas = source as RecordingCanvas;
      if (composite === "copy" && sourceCanvas.textureStamp) {
        canvas.textureStamp = true;
        canvas.textureColor = sourceCanvas.textureColor;
        return;
      }
      if (sourceCanvas.textureStamp && args.length === 8) {
        const destinationX = args[4] ?? 0;
        const destinationY = args[5] ?? 0;
        const destinationWidth = args[6] ?? 0;
        const destinationHeight = args[7] ?? 0;
        recordedMarks.push({
          x: rounded(translatedX + (destinationX + destinationWidth / 2) * scaleX),
          y: rounded(translatedY + (destinationY + destinationHeight / 2) * scaleY),
          radiusX: rounded(Math.abs(destinationWidth * scaleX) / 2),
          radiusY: rounded(Math.abs(destinationHeight * scaleY) / 2),
          angleRadians: rounded(rotation),
          alpha: rounded(alpha),
          color: sourceCanvas.textureColor,
        });
        return;
      }
      if (args.length === 8) {
        recordedCopies.push({
          opacity: rounded(alpha),
          sourceRect: [
            args[0] ?? 0,
            args[1] ?? 0,
            args[2] ?? 0,
            args[3] ?? 0,
          ],
          destinationRect: [
            args[4] ?? 0,
            args[5] ?? 0,
            args[6] ?? 0,
            args[7] ?? 0,
          ],
        });
      }
      recordedComposites.push({
        opacity: rounded(alpha),
        marks: sourceCanvas.recordedMarks.map((mark) => ({ ...mark })),
      });
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    get globalAlpha() {
      return alpha;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      color = String(value);
    },
    get fillStyle() {
      return color;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
    },
    get globalCompositeOperation() {
      return composite;
    },
  } as unknown as CanvasRenderingContext2D;

  return canvas;
}

export const SURFACE: StudioLiveInkSurface = {
  left: 0,
  top: 0,
  width: 240,
  height: 160,
  documentScale: 1,
  documentWidth: 240,
  flipX: false,
};

export function complexDynamics() {
  const legacyDryMedia = studioBrushDynamicsPresetSettings("dry-media");
  delete legacyDryMedia.depositPipeline;
  return normalizeStudioBrushDynamicsSettings({
    ...legacyDryMedia,
    seed: 821,
    tip: { shape: "grain", softness: 0.28 },
    grain: {
      space: "stroke-fixed",
      amount: 0.58,
      scale: 5.5,
      contrast: 0.62,
      seed: 731,
    },
    tipLayers: [
      { tip: { shape: "star", softness: 0.12 }, opacity: 0.48, scale: 0.62 },
    ],
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.18 },
      blendMode: "multiply",
      sizeRatio: 0.78,
    },
    colorDynamics: {
      hueJitterDegrees: 8,
      saturationJitter: 0.12,
      lightnessJitter: 0.08,
    },
  });
}

export function drawElement(
  id: string,
  points: readonly number[],
  overrides: Partial<DrawEl> = {},
): DrawEl {
  const count = Math.floor(points.length / 2);
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...points],
    stroke: "#3257d6",
    strokeWidth: 18,
    opacity: 0.67,
    brush: "airbrush",
    sampleSpacing: 1,
    paintModel: "bounded-flow-v2",
    pressures: Array.from({ length: count }, (_, index) => 0.25 + index * 0.1),
    tangentialPressures: Array.from({ length: count }, (_, index) => index * 0.02),
    speeds: Array.from({ length: count }, (_, index) => 0.3 + index * 0.08),
    tiltXs: Array.from({ length: count }, (_, index) => 8 + index * 2),
    tiltYs: Array.from({ length: count }, (_, index) => -4 + index),
    twists: Array.from({ length: count }, (_, index) => 15 + index * 11),
    brushDynamics: complexDynamics(),
    ...overrides,
  };
}

export function attachedRenderer(surface: StudioLiveInkSurface = SURFACE) {
  vi.stubGlobal("OffscreenCanvas", class {
    constructor(width: number, height: number) {
      const canvas = recordingCanvas();
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  });
  const activeCanvas = recordingCanvas();
  const presentationCanvas = recordingCanvas();
  const settledCanvas = recordingCanvas();
  const renderer = new StudioLiveDynamicBrushOverlayRenderer();
  renderer.attach({ activeCanvas, presentationCanvas, settledCanvas });
  renderer.setSurface(surface);
  return { activeCanvas, presentationCanvas, renderer, settledCanvas };
}

/* ------------------------------------------------------------------------------------------
 * Cold-start statistics, shared so the gate that uses them can live in its OWN module process.
 * ---------------------------------------------------------------------------------------- */

/**
 * Mark delta separating this stroke's two structural append classes.
 *
 * Every eighth append re-plans a ribbon chunk and deposits 1,695-1,780 marks; every other one
 * deposits 150-320. Nothing lands between, so the split is unambiguous rather than a percentile.
 */
export const APPEND_CHUNK_MARK_THRESHOLD = 1_000;

/**
 * What the COLD first append costs in units of one ordinary append.
 *
 * The first append is its own structural class, with exactly one member per pass: it starts a
 * 60-point stroke from a fresh renderer where every later one extends by 30. It is excluded from
 * the outlier max for that reason, its mark delta is a fixed 320 whatever the planner does
 * internally, and it is never the global minimum — so a regression confined to it (a two-second
 * initialisation, say) moves nothing this file otherwise measures, and clears both smoke bounds.
 *
 * Covers PER-RENDERER cold start rather than process-wide initialisation; the gate's own comment
 * at the assertion carries the measurement that distinguishes the two.
 *
 * This is a BLOW-UP bound and not a budget, and the reason is measured. The reading is dominated
 * by JIT warm-up of the whole renderer path: 15.6ms on the first pass, 3.4 on the second, 2.4 on
 * the third, idle — and 32.5 / 8.4 / 6.3 under six spinning hogs on four cores. Reduced by the
 * cheapest pass, as every verdict here is, that leaves 2.37 idle against 5.95 loaded. A 2.5x
 * honest spread admits no gate that also convicts a doubling (that would need one below 4.74 and
 * above 5.95), so this one does not pretend to: it is sized to catch the class blowing up, which
 * is the regression that is actually invisible elsewhere.
 *
 * What covers the cold path exactly is the mark pin beside it — 320 marks, on every machine.
 */
export function appendColdStartCostRatio(
  samples: readonly StudioPerfCalibrationSample[],
  markDeltas: readonly number[],
): number {
  if (samples.length !== markDeltas.length) {
    throw new Error("Every append sample needs its own mark delta.");
  }
  const ordinary = samples.filter((_, index) => index > 0
    && markDeltas[index]! <= APPEND_CHUNK_MARK_THRESHOLD);
  if (ordinary.length === 0) throw new Error("No ordinary append to grade the cold start against.");
  const cheapestOrdinaryMs = Math.min(...ordinary.map((sample) => sample.workMs));
  if (!(cheapestOrdinaryMs > 0)) {
    throw new Error("An ordinary append that costs nothing is not a denominator.");
  }
  return samples[0]!.workMs / cheapestOrdinaryMs;
}

/**
 * Graded on the FIRST pass, not the cheapest, and that distinction is the whole point of the gate.
 *
 * Initialisation that only the first renderer in the process pays is exactly the regression this
 * covers, and it is invisible to every later pass — `[2000, 2.4, 2.4]` reduces to 2.4 under a
 * minimum and acquits a two-second stall on the user's first stroke. The cheapest pass is the
 * honest reducer for a cost that every pass pays; here it discards the only pass that is actually
 * cold.
 *
 * That costs sensitivity, because a single cold reading is JIT-dominated and cannot be reduced.
 * Measured PROCESS-COLD, in the file that exists so it can be: 9.58-15.84 idle and 10.02-65.98
 * under six spinning hogs on four cores, over nineteen runs. 250 carries 3.8x headroom over the
 * worst of those, catches a cold path that grew past ~160ms and the two-second case (~3000), and
 * does not pretend to catch a doubling. A first pass at 60, set from three loaded samples, failed
 * CI-adjacent runs at 65.98 with nothing regressed: an unreducible sample has a long tail and
 * three readings do not show it. What covers the cold path exactly is the mark pin beside it.
 */
export const APPEND_COLD_START_COST_LIMIT = 250;

/**
 * What the COLD FIRST ribbon-chunk append costs in units of one ordinary append.
 *
 * The cold gate above grades `samples[0]`, which is an ORDINARY append. The first chunk append is
 * a different structural path and its own cold start: if the renderer defers any initialisation
 * until a chunk actually arrives, nothing above sees it. `appendChunkCostRatio` is a median over
 * roughly two dozen cycles and discards a single stalled cycle by construction; the chunk-growth
 * ratio and the ordinary-append calibration take minima; and `samples[0]` is a different append
 * entirely. So a 500ms one-time stall on the first chunk moves nothing and clears both smoke
 * bounds — the same hole the ordinary cold gate was written to close, one path over.
 *
 * The denominator is the cheapest ordinary append, as above: this is a COST, whose noise is
 * one-sided, so the cheapest reading is the honest one.
 */
export function appendFirstChunkColdStartCostRatio(
  samples: readonly StudioPerfCalibrationSample[],
  markDeltas: readonly number[],
): number {
  if (samples.length !== markDeltas.length) {
    throw new Error("Every append sample needs its own mark delta.");
  }
  const firstChunkIndex = markDeltas.findIndex((delta) => delta > APPEND_CHUNK_MARK_THRESHOLD);
  if (firstChunkIndex < 0) {
    throw new Error("No ribbon-chunk append to grade a cold chunk start against.");
  }
  const ordinary = samples.filter((_, index) => index > 0
    && markDeltas[index]! <= APPEND_CHUNK_MARK_THRESHOLD);
  if (ordinary.length === 0) {
    throw new Error("No ordinary append to grade the cold chunk start against.");
  }
  const cheapestOrdinaryMs = Math.min(...ordinary.map((sample) => sample.workMs));
  if (!(cheapestOrdinaryMs > 0)) {
    throw new Error("An ordinary append that costs nothing is not a denominator.");
  }
  return samples[firstChunkIndex]!.workMs / cheapestOrdinaryMs;
}

/**
 * Blow-up bound for the COLD FIRST ribbon-chunk append, graded on the FIRST pass.
 *
 * Same shape and same reasoning as `APPEND_COLD_START_COST_LIMIT`, one structural path over: a
 * chunk append is ~20 ordinary appends by construction (it re-plans a ribbon chunk rather than
 * extending by 30 points), so the ratio is large before anything is wrong and the gate can only
 * be a blow-up bound.
 *
 * Measured PROCESS-COLD over nineteen runs: 19.54-20.28 idle, and 41.83-128.05 under six spinning
 * hogs on four cores with sibling suites in parallel workers. Contention costs this single
 * unreducible sample a factor of six, and that is what sets the limit rather than the idle
 * reading.
 *
 * 400 carries 3.1x headroom over the worst of those. Two earlier passes were too tight and both
 * are worth recording: 75 was set from WARM file-order readings, and 110 from only three loaded
 * process-cold ones. A one-time initialisation deferred to the chunk path reads its own cost in
 * ordinary appends, so a 500ms stall reads in the hundreds; ~260ms is the smallest this still
 * convicts, and nothing smaller can be caught on a single unreducible sample without failing
 * honest code on a busy machine.
 */
export const APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT = 400;
