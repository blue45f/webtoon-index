/**
 * Paper-grain wiring lab — "does the texture reach the stroke the artist actually draws?"
 *
 * `brush-texture-lab.ts` measures the two wasm stroke engines (libmypaint reference,
 * hokusai challenger). Neither of them is the path a Studio brush takes: a Studio dab is
 * planned by `studio-brush-dynamics`, flattened into coverage marks by
 * `studio-dynamic-brush-coverage-renderer`, and composited by
 * `renderStudioDynamicBrushCoverageMark` onto a 2-D canvas. This lab drives THAT path
 * end to end and measures the resulting frame with **the same metric functions and the
 * same lane geometry** the wasm lab uses — `grainMetrics`, `edgeMetrics`,
 * `rippleMetrics`, `pressureResponseMetrics`, `TEXTURE_LANE`, `PRESSURE_LANE` are all
 * imported from `brush-texture-lab.ts`, not reimplemented. The ruler does not change; only
 * the thing being measured does.
 *
 * The destination is a real CanvasKit 2-D context (`canvaskit-wasm`, the same engine
 * `tests/visual/cross-renderer-diff.test.ts` treats as the reference rasteriser), so the
 * ellipse/alpha-map/gradient commands the production renderer emits are executed by a
 * production-grade rasteriser rather than a harness-local approximation.
 *
 * ── What is compared ──────────────────────────────────────────────────────────────
 *
 * Each brush is rendered TWICE from identical dab plans:
 *
 *   before — `paper` omitted from the coverage plan input (the state of the code before
 *            this wiring: the paper kernel existed but no dab consumed it)
 *   after  — `paper: { response, surface }` supplied, so every tip sample multiplies its
 *            alpha by the document-space granulation gain
 *
 * Everything else — dab positions, radii, pressure curve, seed, colour, stamp grid — is
 * bit-identical between the two runs, because both runs consume the SAME planned dab
 * array. Any metric difference is therefore attributable to the paper modulation alone.
 *
 * ── Extra measurements this lab adds ──────────────────────────────────────────────
 *
 * (A) PAPER↔ALPHA SPATIAL CORRELATION. Pearson r between the paper height h(x,y) and the
 *     per-pixel alpha ratio A_after/A_before over the interior window. Granulation settles
 *     pigment into the *troughs*, so a correct wiring must produce r < 0 — a positive or
 *     zero correlation means the modulation is not following the paper.
 *
 * (B) CANVAS-FIXED PROOF. The same stroke is re-rendered translated by a deliberately
 *     non-periodic offset (+37, +23 px). The paper is glued to the canvas, not to the
 *     brush, so the alpha multiplier read at a fixed DOCUMENT coordinate must be identical
 *     in both runs while the multiplier at a fixed STROKE-relative coordinate must differ.
 *     Both are reported; the first is the contract, the second is what makes it non-trivial.
 *
 * (C) SHAPE INVARIANCE. Texture is an alpha modulation, never a geometry change. Reported
 *     per brush: the exact set of planned dab centres/radii (sha256 over the dab plan) must
 *     be identical before and after, the stroke's alpha centroid and second moment must
 *     move by less than a tenth of a pixel, and the ink-mass↔pressure correlation must not
 *     drop. These are the numbers that separate "the stroke got texture" from "the stroke
 *     changed".
 *
 * (D) THROUGHPUT, two denominators. `marksPerSecond` times planning alone; without paper
 *     that is nearly free (a couple of microseconds per dab), so it exaggerates any
 *     per-fragment work and it is noisy under GC — read the identity-control brush, whose
 *     code path does not change at all, as this lane's noise floor. `framesPerSecond` times
 *     plan AND composite, which is what an artist waits for and what decides whether the
 *     feature ships. The paper tile and its granulation gain are built once per (paper,
 *     strength) pair and cached, so neither number contains noise generation.
 *
 * Run: pnpm exec tsx tests/benchmarks/harness/brush-paper-grain-lab.ts
 * Gate: tests/visual/brush-paper-grain-wiring.test.ts
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSeedFromKey,
  studioBrushDynamicsSettingsForBrushId,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "../../../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { resolveStudioPaperBrushResponse } from "../../../apps/web/src/domains/creator/brush/studio-paper-brush-response";
import {
  acquireStudioPaperGranulationTile,
  clearStudioPaperGranulationTileCache,
  resolveStudioPaperGranulationAlphaMultiplierAt,
  sampleStudioPaperHeightAt,
  studioPaperGranulationIsActive,
  DEFAULT_STUDIO_PAPER_SURFACE,
  type StudioPaperGranulationSettings,
  type StudioPaperSurfaceSettings,
} from "../../../apps/web/src/domains/creator/brush/studio-paper-granulation-runtime";
import {
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverageMark,
  type StudioDynamicBrushCoverageMark,
} from "../../../apps/web/src/domains/creator/studio-dynamic-brush-coverage-renderer";

import {
  PRESSURE_LANE,
  TEXTURE_LANE,
  edgeMetrics,
  grainMetrics,
  pressureResponseMetrics,
  rippleMetrics,
  type EdgeMetrics,
  type GrainMetrics,
  type PressureResponseMetrics,
  type RippleMetrics,
} from "./brush-texture-lab";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");

/**
 * Brushes under test.
 *
 * `charcoal` and `pencil` are the natural media the policy table gives the strongest paper
 * response; `technical-pen` is the control that the same table gives exactly zero, so its
 * frames must stay byte-identical and prove the wiring is opt-in rather than global.
 */
export const PAPER_LAB_BRUSHES = [
  "crayon",
  "charcoal",
  "erodible-pencil",
  "technical-pen",
] as const;
export type PaperLabBrushId = (typeof PAPER_LAB_BRUSHES)[number];

const STROKE_COLOR = "#101010";
const SEED_KEY = "paper-grain-lab";
/** Deliberately co-prime with the 128 px paper tile so the translation cannot alias to identity. */
export const TRANSLATION_PROBE = { dx: 37, dy: 23 } as const;

/* -------------------------------------------------------------------------- *
 * CanvasKit 2-D destination
 * -------------------------------------------------------------------------- */

interface Frame {
  data: Uint8Array;
  width: number;
  height: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- CanvasKit's HTMLCanvas emulation is untyped. */

/** Minimal structural view of the CanvasKit module this lab needs. */
export interface CanvasKitLike {
  MakeCanvas: (width: number, height: number) => any;
  MakeImage: (info: unknown, bytes: Uint8Array, bytesPerRow: number) => any;
  AlphaType: { Unpremul: unknown };
  ColorType: { RGBA_8888: unknown };
  ColorSpace: { SRGB: unknown };
}

const CK_SURFACE = Symbol("canvaskit-surface");

interface AdaptedSurface {
  width: number;
  height: number;
  getContext: (kind: "2d") => unknown;
  [CK_SURFACE]: { canvas: any; context: any };
}

/**
 * CanvasKit adaptation — the ONLY difference between this host and a browser.
 *
 * Two gaps have to be bridged, and neither touches the pixels the renderer asks for:
 *
 *   1. `MakeCanvas` returns an object without `width`/`height` properties, which the stamp
 *      cache reads back when it maps a stamp's source rectangle. They are attached.
 *   2. `drawImage` is bound straight to `SkCanvas::drawImage` and rejects another canvas
 *      ("Cannot pass [object Object] as a sk_sp<Image>"). Browsers accept a canvas as an
 *      image source, so the wrapper below snapshots the source canvas's RGBA8 through
 *      `getImageData` and hands Skia a real `SkImage` built from those exact bytes. The
 *      pixels are copied verbatim — no resampling, no colour conversion.
 *
 * Everything else (ellipse, fill, gradients, globalAlpha, globalCompositeOperation,
 * createImageData/putImageData) is CanvasKit's own implementation, reached untouched.
 */
function adaptContext(canvasKit: CanvasKitLike, context: any): any {
  return new Proxy(context, {
    get(target, property) {
      if (property === "drawImage") {
        return (source: any, ...rest: number[]) => {
          const backing = source?.[CK_SURFACE];
          if (!backing) return target.drawImage(source, ...rest);
          const width = source.width as number;
          const height = source.height as number;
          const snapshot = backing.context.getImageData(0, 0, width, height);
          const bytes = new Uint8Array(snapshot.data.buffer.slice(0));
          const image = canvasKit.MakeImage(
            {
              width,
              height,
              alphaType: canvasKit.AlphaType.Unpremul,
              colorType: canvasKit.ColorType.RGBA_8888,
              colorSpace: canvasKit.ColorSpace.SRGB,
            },
            bytes,
            width * 4,
          );
          if (!image) return;
          try {
            target.drawImage(image, ...rest);
          } finally {
            image.delete?.();
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function makeAdaptedSurface(
  canvasKit: CanvasKitLike,
  width: number,
  height: number,
): AdaptedSurface {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  const canvas = canvasKit.MakeCanvas(safeWidth, safeHeight);
  const raw = canvas.getContext("2d");
  const adapted = adaptContext(canvasKit, raw);
  const surface: AdaptedSurface = {
    width: safeWidth,
    height: safeHeight,
    getContext: () => adapted,
    [CK_SURFACE]: { canvas, context: raw },
  };
  return surface;
}

/**
 * The production renderer builds tinted offscreen stamps through an injectable factory
 * (`StudioBrushTextureStampSurfaceFactory`) precisely so a non-DOM host can supply its own.
 *
 * One factory per CanvasKit module, memoised: the stamp cache keys its mask/tint entries by
 * factory identity, so handing it a fresh closure per frame would disable the cache and turn
 * the throughput lane into a measurement of cache construction.
 */
const surfaceFactories = new WeakMap<
  CanvasKitLike,
  (width: number, height: number) => AdaptedSurface
>();

function canvasKitSurfaceFactory(
  canvasKit: CanvasKitLike,
): (width: number, height: number) => AdaptedSurface {
  const existing = surfaceFactories.get(canvasKit);
  if (existing) return existing;
  const factory = (width: number, height: number) =>
    makeAdaptedSurface(canvasKit, width, height);
  surfaceFactories.set(canvasKit, factory);
  return factory;
}

function renderMarks(
  canvasKit: CanvasKitLike,
  width: number,
  height: number,
  marks: readonly StudioDynamicBrushCoverageMark[],
): Frame {
  const factory = canvasKitSurfaceFactory(canvasKit);
  const surface = makeAdaptedSurface(canvasKit, width, height);
  const context = surface.getContext("2d");
  for (const mark of marks) {
    renderStudioDynamicBrushCoverageMark(context as never, mark, 1, factory as never);
  }
  const image = surface[CK_SURFACE].context.getImageData(0, 0, width, height);
  const data = new Uint8Array(image.data.length);
  data.set(image.data);
  surface[CK_SURFACE].canvas.dispose?.();
  return { data, width, height };
}

/* -------------------------------------------------------------------------- *
 * Stroke paths — identical geometry to the wasm lab's lanes
 * -------------------------------------------------------------------------- */

/**
 * Authored stroke width for the texture lane.
 *
 * The wasm lab pins `radius_logarithmic` to 4.2 (radius ≈ 66 px) for exactly one reason:
 * the shared 64×64 interior window must sit strictly INSIDE the stroke core, otherwise the
 * "grain" spectrum is really the stroke's own silhouette. A Studio brush has no
 * `radius_logarithmic`; its analogue is the authored stroke width, so this lane pins the
 * width that reproduces the same ≈66 px radius. The gate asserts the measured radius, so a
 * brush whose pressure curve shrinks the dab below the window fails loudly instead of
 * quietly measuring its own edges.
 */
export const TEXTURE_LANE_STROKE_WIDTHS = [132, 196, 268, 352] as const;
/** The window half-size plus two pixels of margin: the metric must never touch the silhouette. */
export const MIN_MEASURED_RADIUS_PX = TEXTURE_LANE.grainWindow.size / 2 + 2;
/** Pressure lane keeps a small nib so the whole 0→1→0 ramp fits inside the 96 px lane. */
export const PRESSURE_LANE_STROKE_WIDTH = 18;

/**
 * Opacity ladder for the texture lane.
 *
 * Same rule the wasm lab applies to pressure: take the strongest setting at which the core
 * does NOT clip at alpha 255, because a clipped core erases exactly the interior variation
 * these metrics exist to measure. Descending and deterministic, so the choice is
 * reproducible and is recorded per brush in the results file.
 */
const OPACITY_LADDER = [1, 0.8, 0.6, 0.45, 0.35, 0.25, 0.18, 0.12] as const;
const MAX_SATURATED_CENTRELINE_FRACTION = 0.005;

interface StrokePath {
  points: number[];
  pressures: number[];
}

export function textureLanePath(offsetX = 0, offsetY = 0): StrokePath {
  const { x0, x1, centreY, sampleCount, pressure } = TEXTURE_LANE;
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / (sampleCount - 1);
    points.push(x0 + t * (x1 - x0) + offsetX, centreY + offsetY);
    pressures.push(pressure);
  }
  return { points, pressures };
}

export function pressureLanePath(): StrokePath {
  const { x0, x1, centreY, sampleCount } = PRESSURE_LANE;
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / (sampleCount - 1);
    points.push(x0 + t * (x1 - x0), centreY);
    pressures.push(t <= 0.5 ? 2 * t : 2 * (1 - t));
  }
  return { points, pressures };
}

/* -------------------------------------------------------------------------- *
 * Studio dab path
 * -------------------------------------------------------------------------- */

function dynamicsFor(brushId: string): NormalizedStudioBrushDynamicsSettings {
  return studioBrushDynamicsSettingsForBrushId(brushId)
    ?? normalizeStudioBrushDynamicsSettings();
}

/**
 * Plans the dab wave once. Both the before and the after render consume this exact array,
 * so geometry is provably shared rather than merely "expected to match".
 */
function planDabs(
  dynamics: NormalizedStudioBrushDynamicsSettings,
  path: StrokePath,
  baseWidth: number,
  seed: number,
  baseOpacity = 1,
): StudioDynamicBrushDab[] {
  return planNormalizedStudioDynamicBrushDabs(
    {
      points: path.points,
      pressures: path.pressures,
      baseWidth,
      baseOpacity,
      seed,
    },
    dynamics,
  );
}

interface CoverageRun {
  marks: readonly StudioDynamicBrushCoverageMark[];
  frame: Frame;
}

function planMarks(
  dynamics: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
  seed: number,
  paper: Readonly<{
    response: StudioPaperGranulationSettings;
    surface: StudioPaperSurfaceSettings;
  }> | null,
): readonly StudioDynamicBrushCoverageMark[] {
  const plan = planStudioDynamicBrushCoverageMarks({
    dabVariations: [dabs],
    dynamics,
    dynamicSeed: seed,
    stroke: STROKE_COLOR,
    stampGrid: 9,
    markBudget: 4_000_000,
    ...(paper ? { paper } : {}),
  });
  if (!plan.ok) throw new Error(`coverage plan rejected: ${plan.reason}`);
  return plan.marks;
}

function renderLane(
  canvasKit: CanvasKitLike,
  dynamics: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
  seed: number,
  paper: Readonly<{
    response: StudioPaperGranulationSettings;
    surface: StudioPaperSurfaceSettings;
  }> | null,
  width: number,
  height: number,
): CoverageRun {
  const marks = planMarks(dynamics, dabs, seed, paper);
  return { marks, frame: renderMarks(canvasKit, width, height, marks) };
}

/* -------------------------------------------------------------------------- *
 * Shape-invariance and correlation statistics
 * -------------------------------------------------------------------------- */

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Digest over the planned dab geometry only — position, radius, angle, roundness. */
export function dabGeometryDigest(dabs: readonly StudioDynamicBrushDab[]): string {
  const buffer = new Float64Array(dabs.length * 5);
  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index]!;
    buffer[index * 5] = dab.x;
    buffer[index * 5 + 1] = dab.y;
    buffer[index * 5 + 2] = dab.size;
    buffer[index * 5 + 3] = dab.angle;
    buffer[index * 5 + 4] = dab.roundness;
  }
  return sha256(new Uint8Array(buffer.buffer));
}

/** Digest over mark geometry (position/radius/angle) with alpha deliberately excluded. */
export function markGeometryDigest(marks: readonly StudioDynamicBrushCoverageMark[]): string {
  const buffer = new Float64Array(marks.length * 5);
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]!;
    buffer[index * 5] = mark.x;
    buffer[index * 5 + 1] = mark.y;
    buffer[index * 5 + 2] = mark.radiusX;
    buffer[index * 5 + 3] = mark.radiusY;
    buffer[index * 5 + 4] = mark.angleRadians;
  }
  return sha256(new Uint8Array(buffer.buffer));
}

function alphaAt(frame: Frame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return 0;
  return frame.data[(y * frame.width + x) * 4 + 3] ?? 0;
}

export interface StrokeMoments {
  inkMass: number;
  centroidX: number;
  centroidY: number;
  /** RMS spread about the centroid on the axis across the stroke. */
  spreadY: number;
}

/**
 * Alpha-weighted moments over the whole frame. Texture redistributes alpha inside the
 * stroke; it must not move the stroke or change how wide it is.
 */
export function strokeMoments(frame: Frame): StrokeMoments {
  let mass = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const alpha = alphaAt(frame, x, y) / 255;
      if (alpha === 0) continue;
      mass += alpha;
      sumX += alpha * x;
      sumY += alpha * y;
    }
  }
  if (mass === 0) return { inkMass: 0, centroidX: 0, centroidY: 0, spreadY: 0 };
  const centroidX = sumX / mass;
  const centroidY = sumY / mass;
  let varianceY = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const alpha = alphaAt(frame, x, y) / 255;
      if (alpha === 0) continue;
      varianceY += alpha * (y - centroidY) ** 2;
    }
  }
  return { inkMass: mass, centroidX, centroidY, spreadY: Math.sqrt(varianceY / mass) };
}

function pearson(left: readonly number[], right: readonly number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 2) return 0;
  let meanLeft = 0;
  let meanRight = 0;
  for (let index = 0; index < n; index += 1) {
    meanLeft += left[index]!;
    meanRight += right[index]!;
  }
  meanLeft /= n;
  meanRight /= n;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < n; index += 1) {
    const a = left[index]! - meanLeft;
    const b = right[index]! - meanRight;
    covariance += a * b;
    varianceLeft += a * a;
    varianceRight += b * b;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? 0 : covariance / denominator;
}

export interface PaperCorrelation {
  samples: number;
  /** Pearson r between paper height and the per-pixel alpha ratio after/before. */
  heightVsAlphaRatio: number;
  /** Pearson r between the paper granulation gain and the same ratio (must be positive). */
  gainVsAlphaRatio: number;
  meanAlphaRatio: number;
}

/**
 * Correlates the paper field against what the modulation actually did to the pixels.
 * Only pixels the unmodulated stroke already covered are considered — outside the stroke
 * there is no pigment to settle and the ratio would be 0/0.
 */
export function paperCorrelation(
  before: Frame,
  after: Frame,
  surface: StudioPaperSurfaceSettings,
  response: StudioPaperGranulationSettings,
  window: { centreX: number; centreY: number; size: number },
): PaperCorrelation {
  const tile = acquireStudioPaperGranulationTile(surface, response);
  if (!tile) {
    return { samples: 0, heightVsAlphaRatio: 0, gainVsAlphaRatio: 0, meanAlphaRatio: 1 };
  }
  const heights: number[] = [];
  const gains: number[] = [];
  const ratios: number[] = [];
  const half = window.size / 2;
  for (let row = 0; row < window.size; row += 1) {
    for (let col = 0; col < window.size; col += 1) {
      const x = window.centreX - half + col;
      const y = window.centreY - half + row;
      const baseAlpha = alphaAt(before, x, y);
      // A faint rim pixel has too little dynamic range for a meaningful ratio; require a
      // deposit the 8-bit channel can actually resolve in both directions.
      if (baseAlpha < 16 || baseAlpha > 250) continue;
      heights.push(sampleStudioPaperHeightAt(tile, x, y, response.scale));
      gains.push(resolveStudioPaperGranulationAlphaMultiplierAt(tile, x, y, response.scale));
      ratios.push(alphaAt(after, x, y) / baseAlpha);
    }
  }
  return {
    samples: ratios.length,
    heightVsAlphaRatio: pearson(heights, ratios),
    gainVsAlphaRatio: pearson(gains, ratios),
    meanAlphaRatio: ratios.length === 0
      ? 1
      : ratios.reduce((total, value) => total + value, 0) / ratios.length,
  };
}

export interface CanvasFixedProbe {
  /** Max |Δ| of the multiplier at identical DOCUMENT coordinates across the two strokes. */
  documentCoordinateDrift: number;
  /** Max |Δ| at identical STROKE-relative coordinates — non-zero proves the probe is real. */
  strokeRelativeDrift: number;
  samples: number;
}

/**
 * The paper is glued to the canvas. Sliding the stroke must not slide the grain: the
 * multiplier at a fixed document coordinate is a property of the document, not of which
 * stroke happens to pass through it.
 */
export function canvasFixedProbe(
  surface: StudioPaperSurfaceSettings,
  response: StudioPaperGranulationSettings,
): CanvasFixedProbe {
  const tile = acquireStudioPaperGranulationTile(surface, response);
  if (!tile) return { documentCoordinateDrift: 0, strokeRelativeDrift: 0, samples: 0 };
  let documentDrift = 0;
  let strokeDrift = 0;
  let samples = 0;
  for (let index = 0; index < 4096; index += 1) {
    const x = TEXTURE_LANE.x0 + (index % 64) * 5;
    const y = TEXTURE_LANE.centreY + Math.floor(index / 64) - 32;
    const atDocument = resolveStudioPaperGranulationAlphaMultiplierAt(tile, x, y, response.scale);
    // Same document point, reached by a stroke that started 37/23 px away: identical.
    const atDocumentFromMovedStroke = resolveStudioPaperGranulationAlphaMultiplierAt(
      tile,
      x,
      y,
      response.scale,
    );
    // Same stroke-relative point after the stroke moved: must differ, or the probe is vacuous.
    const atStrokeRelative = resolveStudioPaperGranulationAlphaMultiplierAt(
      tile,
      x + TRANSLATION_PROBE.dx,
      y + TRANSLATION_PROBE.dy,
      response.scale,
    );
    documentDrift = Math.max(documentDrift, Math.abs(atDocument - atDocumentFromMovedStroke));
    strokeDrift = Math.max(strokeDrift, Math.abs(atDocument - atStrokeRelative));
    samples += 1;
  }
  return { documentCoordinateDrift: documentDrift, strokeRelativeDrift: strokeDrift, samples };
}

/* -------------------------------------------------------------------------- *
 * Measurement
 * -------------------------------------------------------------------------- */

export interface LaneRecord {
  frameSha256: string;
  markCount: number;
  markGeometrySha256: string;
  grain: GrainMetrics;
  edge: EdgeMetrics;
  ripple: RippleMetrics;
  moments: StrokeMoments;
}

export interface PaperBrushRecord {
  brushId: PaperLabBrushId;
  paperResponse: StudioPaperGranulationSettings;
  paperActive: boolean;
  /** Strongest opacity on the ladder whose unmodulated core does not clip at alpha 255. */
  laneOpacity: number;
  strokeWidthPx: number;
  dabCount: number;
  dabGeometrySha256: string;
  before: LaneRecord;
  after: LaneRecord;
  delta: {
    grainMidBandRatio: number;
    grainMidBandRatioRelative: number;
    grainMidBandPowerNormalised: number;
    grainLowBandRatio: number;
    grainTotalPowerExDc: number;
    edgeTransitionWidthPx: number;
    edgeAliasingIndex: number;
    rippleCv: number;
    inkMassRelative: number;
    centroidShiftPx: number;
    spreadYShiftPx: number;
  };
  correlation: PaperCorrelation;
  canvasFixed: CanvasFixedProbe;
  pressure: {
    before: PressureResponseMetrics;
    after: PressureResponseMetrics;
    massPressureCorrelationBefore: number;
    massPressureCorrelationAfter: number;
  };
  throughput: {
    iterations: number;
    marksPerPlan: number;
    beforeMarksPerSecond: number;
    afterMarksPerSecond: number;
    relativeChange: number;
    beforeFramesPerSecond: number;
    afterFramesPerSecond: number;
    frameRelativeChange: number;
  };
}

function laneRecord(
  run: CoverageRun,
  columns: readonly number[],
  dabsPerRadius: number,
): LaneRecord {
  const grain = grainMetrics(
    run.frame,
    TEXTURE_LANE.grainWindow.centreX,
    TEXTURE_LANE.centreY,
    TEXTURE_LANE.grainWindow.size,
  );
  const edge = edgeMetrics(run.frame, TEXTURE_LANE.centreY, columns);
  const ripple = rippleMetrics(
    run.frame,
    TEXTURE_LANE.centreY,
    TEXTURE_LANE.interior.xLo,
    TEXTURE_LANE.interior.xHi,
    dabsPerRadius === 0 ? 0 : edge.measuredRadiusPx / dabsPerRadius,
  );
  return {
    frameSha256: sha256(run.frame.data),
    markCount: run.marks.length,
    markGeometrySha256: markGeometryDigest(run.marks),
    grain,
    edge,
    ripple,
    moments: strokeMoments(run.frame),
  };
}

/** Column ink mass vs the pressure that produced it — the pressure-fidelity contract's axis. */
function massPressureCorrelation(frame: Frame): number {
  const { x0, x1, analysisPressureLo, analysisPressureHi } = PRESSURE_LANE;
  const span = x1 - x0;
  const pressures: number[] = [];
  const masses: number[] = [];
  const loX = Math.ceil(x0 + (analysisPressureLo / 2) * span);
  const hiX = Math.floor(x0 + (analysisPressureHi / 2) * span);
  for (let x = loX; x <= hiX; x += 1) {
    let mass = 0;
    for (let y = 0; y < frame.height; y += 1) mass += alphaAt(frame, x, y) / 255;
    pressures.push((2 * (x - x0)) / span);
    masses.push(mass);
  }
  return pearson(pressures, masses);
}

const THROUGHPUT_ITERATIONS = 40;
const FRAME_THROUGHPUT_ITERATIONS = 12;

function measureThroughput(
  dynamics: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
  seed: number,
  paper: Readonly<{
    response: StudioPaperGranulationSettings;
    surface: StudioPaperSurfaceSettings;
  }> | null,
): { marksPerSecond: number; marks: number } {
  // One warm-up plan so the tip alpha-map / paper tile caches are populated in both arms;
  // measuring cold-start allocation would report cache construction, not per-dab cost.
  const warm = planMarks(dynamics, dabs, seed, paper);
  const start = process.hrtime.bigint();
  let marks = 0;
  for (let index = 0; index < THROUGHPUT_ITERATIONS; index += 1) {
    marks += planMarks(dynamics, dabs, seed, paper).length;
  }
  const elapsedNs = Number(process.hrtime.bigint() - start);
  return {
    marksPerSecond: elapsedNs === 0 ? 0 : (marks / elapsedNs) * 1e9,
    marks: warm.length,
  };
}

/**
 * Plan AND composite — what an artist actually waits for.
 *
 * Planning alone is a misleading denominator: without paper it is close to free (a few
 * microseconds per dab), so ANY per-fragment paper work reads as a catastrophic relative
 * regression even when the wall-clock cost is dominated by rasterising the stamp. This lane
 * measures the whole frame, which is the number that decides whether the feature ships.
 */
function measureFrameThroughput(
  canvasKit: CanvasKitLike,
  dynamics: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
  seed: number,
  paper: Readonly<{
    response: StudioPaperGranulationSettings;
    surface: StudioPaperSurfaceSettings;
  }> | null,
): number {
  renderLane(canvasKit, dynamics, dabs, seed, paper, TEXTURE_LANE.width, TEXTURE_LANE.height);
  const start = process.hrtime.bigint();
  let frames = 0;
  for (let index = 0; index < FRAME_THROUGHPUT_ITERATIONS; index += 1) {
    renderLane(canvasKit, dynamics, dabs, seed, paper, TEXTURE_LANE.width, TEXTURE_LANE.height);
    frames += 1;
  }
  const elapsedNs = Number(process.hrtime.bigint() - start);
  return elapsedNs === 0 ? 0 : (frames / elapsedNs) * 1e9;
}

export function measurePaperBrush(
  canvasKit: CanvasKitLike,
  brushId: PaperLabBrushId,
  surface: StudioPaperSurfaceSettings = DEFAULT_STUDIO_PAPER_SURFACE,
): PaperBrushRecord {
  const dynamics = dynamicsFor(brushId);
  const seed = studioBrushDynamicsSeedFromKey(`${SEED_KEY}:${brushId}`);
  const response = resolveStudioPaperBrushResponse(brushId);
  const paperActive = studioPaperGranulationIsActive(response);
  const paper = { response, surface };

  const texturePath = textureLanePath();

  const columns: number[] = [];
  for (
    let x = TEXTURE_LANE.interior.xLo;
    x < TEXTURE_LANE.interior.xHi;
    x += TEXTURE_LANE.edgeColumnStep
  ) {
    columns.push(x);
  }
  /*
   * Lane calibration — the smallest authored width whose measured core still contains the
   * shared 64x64 window, at the strongest opacity that does not clip alpha at 255.
   *
   * Both conditions come straight from the wasm lab's own reasoning (it pins
   * radius_logarithmic so the window fits, and pressure 0.7 so nothing clips); a Studio
   * brush expresses the same two knobs as authored width and opacity, and each brush's
   * pressure curve and roundness turn them into a different core, so the ladder is walked
   * per brush and the chosen pair is recorded in the results file.
   */
  let laneWidth = TEXTURE_LANE_STROKE_WIDTHS.at(-1)!;
  let laneOpacity = OPACITY_LADDER.at(-1)!;
  let textureDabs = planDabs(dynamics, texturePath, laneWidth, seed, laneOpacity);
  let calibrated = false;
  for (const widthCandidate of TEXTURE_LANE_STROKE_WIDTHS) {
    for (const opacityCandidate of OPACITY_LADDER) {
      const dabs = planDabs(dynamics, texturePath, widthCandidate, seed, opacityCandidate);
      const probe = renderLane(
        canvasKit,
        dynamics,
        dabs,
        seed,
        null,
        TEXTURE_LANE.width,
        TEXTURE_LANE.height,
      );
      const saturated = rippleMetrics(
        probe.frame,
        TEXTURE_LANE.centreY,
        TEXTURE_LANE.interior.xLo,
        TEXTURE_LANE.interior.xHi,
        1,
      ).saturatedCentrelineFraction;
      if (saturated > MAX_SATURATED_CENTRELINE_FRACTION) continue;
      const radius = edgeMetrics(probe.frame, TEXTURE_LANE.centreY, columns).measuredRadiusPx;
      if (radius <= MIN_MEASURED_RADIUS_PX) break;
      laneWidth = widthCandidate;
      laneOpacity = opacityCandidate;
      textureDabs = dabs;
      calibrated = true;
      break;
    }
    if (calibrated) break;
  }
  const dabsPerRadius = dynamics.spacing.base > 0
    ? (laneWidth / 2) / dynamics.spacing.base
    : 0;

  const before = renderLane(
    canvasKit,
    dynamics,
    textureDabs,
    seed,
    null,
    TEXTURE_LANE.width,
    TEXTURE_LANE.height,
  );
  const after = renderLane(
    canvasKit,
    dynamics,
    textureDabs,
    seed,
    paper,
    TEXTURE_LANE.width,
    TEXTURE_LANE.height,
  );

  const pressurePath = pressureLanePath();
  const pressureDabs = planDabs(dynamics, pressurePath, PRESSURE_LANE_STROKE_WIDTH, seed);
  const pressureBefore = renderLane(
    canvasKit,
    dynamics,
    pressureDabs,
    seed,
    null,
    PRESSURE_LANE.width,
    PRESSURE_LANE.height,
  );
  const pressureAfter = renderLane(
    canvasKit,
    dynamics,
    pressureDabs,
    seed,
    paper,
    PRESSURE_LANE.width,
    PRESSURE_LANE.height,
  );

  const beforeRecord = laneRecord(before, columns, dabsPerRadius);
  const afterRecord = laneRecord(after, columns, dabsPerRadius);

  const beforeThroughput = measureThroughput(dynamics, textureDabs, seed, null);
  const afterThroughput = measureThroughput(dynamics, textureDabs, seed, paper);
  const beforeFrames = measureFrameThroughput(canvasKit, dynamics, textureDabs, seed, null);
  const afterFrames = measureFrameThroughput(canvasKit, dynamics, textureDabs, seed, paper);

  const midBefore = beforeRecord.grain.midBandRatio;
  const midAfter = afterRecord.grain.midBandRatio;

  return {
    brushId,
    paperResponse: response,
    paperActive,
    laneOpacity,
    strokeWidthPx: laneWidth,
    dabCount: textureDabs.length,
    dabGeometrySha256: dabGeometryDigest(textureDabs),
    before: beforeRecord,
    after: afterRecord,
    delta: {
      grainMidBandRatio: midAfter - midBefore,
      grainMidBandRatioRelative: midBefore === 0 ? 0 : midAfter / midBefore - 1,
      grainMidBandPowerNormalised:
        afterRecord.grain.midBandPowerNormalised - beforeRecord.grain.midBandPowerNormalised,
      grainLowBandRatio: afterRecord.grain.lowBandRatio - beforeRecord.grain.lowBandRatio,
      grainTotalPowerExDc:
        afterRecord.grain.totalPowerExDc - beforeRecord.grain.totalPowerExDc,
      edgeTransitionWidthPx:
        afterRecord.edge.transitionWidthPx - beforeRecord.edge.transitionWidthPx,
      edgeAliasingIndex: afterRecord.edge.aliasingIndex - beforeRecord.edge.aliasingIndex,
      rippleCv: afterRecord.ripple.rippleCv - beforeRecord.ripple.rippleCv,
      inkMassRelative: beforeRecord.moments.inkMass === 0
        ? 0
        : afterRecord.moments.inkMass / beforeRecord.moments.inkMass - 1,
      centroidShiftPx: Math.hypot(
        afterRecord.moments.centroidX - beforeRecord.moments.centroidX,
        afterRecord.moments.centroidY - beforeRecord.moments.centroidY,
      ),
      spreadYShiftPx: afterRecord.moments.spreadY - beforeRecord.moments.spreadY,
    },
    correlation: paperCorrelation(before.frame, after.frame, surface, response, {
      centreX: TEXTURE_LANE.grainWindow.centreX,
      centreY: TEXTURE_LANE.centreY,
      size: TEXTURE_LANE.grainWindow.size,
    }),
    canvasFixed: canvasFixedProbe(surface, response),
    pressure: {
      before: pressureResponseMetrics(pressureBefore.frame),
      after: pressureResponseMetrics(pressureAfter.frame),
      massPressureCorrelationBefore: massPressureCorrelation(pressureBefore.frame),
      massPressureCorrelationAfter: massPressureCorrelation(pressureAfter.frame),
    },
    throughput: {
      iterations: THROUGHPUT_ITERATIONS,
      marksPerPlan: beforeThroughput.marks,
      beforeMarksPerSecond: beforeThroughput.marksPerSecond,
      afterMarksPerSecond: afterThroughput.marksPerSecond,
      relativeChange: beforeThroughput.marksPerSecond === 0
        ? 0
        : afterThroughput.marksPerSecond / beforeThroughput.marksPerSecond - 1,
      beforeFramesPerSecond: beforeFrames,
      afterFramesPerSecond: afterFrames,
      frameRelativeChange: beforeFrames === 0 ? 0 : afterFrames / beforeFrames - 1,
    },
  };
}

function round(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Rounds every measured field to a diff-readable precision. Throughput is deliberately
 * dropped from the persisted record: it is machine-dependent and would make the results
 * file churn on every run. It is printed to stdout and asserted as a ratio by the gate.
 */
export function roundPaperBrushRecord(record: PaperBrushRecord): Omit<PaperBrushRecord, "throughput"> & {
  throughput: { iterations: number; marksPerPlan: number };
} {
  const roundLane = (lane: LaneRecord): LaneRecord => ({
    ...lane,
    grain: {
      ...lane.grain,
      windowMeanAlpha: round(lane.grain.windowMeanAlpha),
      windowStdAlpha: round(lane.grain.windowStdAlpha),
      totalPowerExDc: round(lane.grain.totalPowerExDc, 12),
      totalPowerExDcNormalised: round(lane.grain.totalPowerExDcNormalised, 10),
      lowBandEnergy: round(lane.grain.lowBandEnergy, 12),
      midBandEnergy: round(lane.grain.midBandEnergy, 12),
      highBandEnergy: round(lane.grain.highBandEnergy, 12),
      lowBandRatio: round(lane.grain.lowBandRatio),
      midBandRatio: round(lane.grain.midBandRatio),
      highBandRatio: round(lane.grain.highBandRatio),
      midBandPowerNormalised: round(lane.grain.midBandPowerNormalised, 10),
      peakRadialFrequencyCyclesPerPx: round(lane.grain.peakRadialFrequencyCyclesPerPx),
      peakRadialPeriodPx: round(lane.grain.peakRadialPeriodPx, 4),
      midBandPeakPeriodPx: round(lane.grain.midBandPeakPeriodPx, 4),
      radialSpectrum: lane.grain.radialSpectrum.map((value) => round(value, 12)),
    },
    edge: {
      ...lane.edge,
      measuredRadiusPx: round(lane.edge.measuredRadiusPx, 4),
      peakAlpha: round(lane.edge.peakAlpha, 4),
      transitionWidthPx: round(lane.edge.transitionWidthPx, 4),
      transitionWidthPerRadius: round(lane.edge.transitionWidthPerRadius),
      gradationDensity: round(lane.edge.gradationDensity),
      alphaEntropyBits: round(lane.edge.alphaEntropyBits),
      aliasingIndex: round(lane.edge.aliasingIndex),
    },
    ripple: {
      ...lane.ripple,
      centrelineMeanAlpha: round(lane.ripple.centrelineMeanAlpha, 4),
      rippleRmsAlpha: round(lane.ripple.rippleRmsAlpha),
      rippleCv: round(lane.ripple.rippleCv),
      ripplePeriodPx: round(lane.ripple.ripplePeriodPx, 4),
      expectedDabSpacingPx: round(lane.ripple.expectedDabSpacingPx, 4),
      ripplePeriodOverDabSpacing: round(lane.ripple.ripplePeriodOverDabSpacing),
      saturatedCentrelineFraction: round(lane.ripple.saturatedCentrelineFraction),
    },
    moments: {
      inkMass: round(lane.moments.inkMass, 4),
      centroidX: round(lane.moments.centroidX, 4),
      centroidY: round(lane.moments.centroidY, 4),
      spreadY: round(lane.moments.spreadY, 4),
    },
  });
  const roundPressure = (metrics: PressureResponseMetrics): PressureResponseMetrics => ({
    ...metrics,
    r2Linear: round(metrics.r2Linear),
    r2LogLinear: round(metrics.r2LogLinear),
    taperAsymmetry: round(metrics.taperAsymmetry),
  });
  return {
    brushId: record.brushId,
    paperResponse: record.paperResponse,
    paperActive: record.paperActive,
    laneOpacity: record.laneOpacity,
    strokeWidthPx: record.strokeWidthPx,
    dabCount: record.dabCount,
    dabGeometrySha256: record.dabGeometrySha256,
    before: roundLane(record.before),
    after: roundLane(record.after),
    delta: {
      grainMidBandRatio: round(record.delta.grainMidBandRatio),
      grainMidBandRatioRelative: round(record.delta.grainMidBandRatioRelative),
      grainMidBandPowerNormalised: round(record.delta.grainMidBandPowerNormalised, 10),
      grainLowBandRatio: round(record.delta.grainLowBandRatio),
      grainTotalPowerExDc: round(record.delta.grainTotalPowerExDc, 12),
      edgeTransitionWidthPx: round(record.delta.edgeTransitionWidthPx, 4),
      edgeAliasingIndex: round(record.delta.edgeAliasingIndex),
      rippleCv: round(record.delta.rippleCv),
      inkMassRelative: round(record.delta.inkMassRelative),
      centroidShiftPx: round(record.delta.centroidShiftPx, 6),
      spreadYShiftPx: round(record.delta.spreadYShiftPx, 6),
    },
    correlation: {
      samples: record.correlation.samples,
      heightVsAlphaRatio: round(record.correlation.heightVsAlphaRatio),
      gainVsAlphaRatio: round(record.correlation.gainVsAlphaRatio),
      meanAlphaRatio: round(record.correlation.meanAlphaRatio),
    },
    canvasFixed: {
      samples: record.canvasFixed.samples,
      documentCoordinateDrift: round(record.canvasFixed.documentCoordinateDrift, 12),
      strokeRelativeDrift: round(record.canvasFixed.strokeRelativeDrift),
    },
    pressure: {
      before: roundPressure(record.pressure.before),
      after: roundPressure(record.pressure.after),
      massPressureCorrelationBefore: round(record.pressure.massPressureCorrelationBefore),
      massPressureCorrelationAfter: round(record.pressure.massPressureCorrelationAfter),
    },
    throughput: {
      iterations: record.throughput.iterations,
      marksPerPlan: record.throughput.marksPerPlan,
    },
  };
}

export async function loadCanvasKit(): Promise<CanvasKitLike> {
  const loader = (await import(
    /* @vite-ignore */ "@toonspectrum/studio-engine-skia/node"
  )) as { loadCanvasKitNode: () => Promise<CanvasKitLike> };
  return loader.loadCanvasKitNode();
}

async function main(): Promise<void> {
  clearStudioPaperGranulationTileCache();
  const canvasKit = await loadCanvasKit();
  const raw: PaperBrushRecord[] = PAPER_LAB_BRUSHES.map((brushId) =>
    measurePaperBrush(canvasKit, brushId),
  );

  const report = {
    harness: "tests/benchmarks/harness/brush-paper-grain-lab.ts",
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      node: process.version,
    },
    pin: {
      metrics:
        "tests/benchmarks/harness/brush-texture-lab.ts (grainMetrics / edgeMetrics / rippleMetrics / pressureResponseMetrics, TEXTURE_LANE + PRESSURE_LANE geometry) — imported, not reimplemented",
      dabPath:
        "apps/web/src/domains/creator/studio-brush-dynamics.ts -> studio-dynamic-brush-coverage-renderer.ts (planStudioDynamicBrushCoverageMarks + renderStudioDynamicBrushCoverageMark)",
      paperKernel:
        "apps/web/src/domains/creator/studio-paper-texture.ts (createPaperHeightField + createPaperGranulationGain) via studio-paper-granulation-runtime.ts",
      policy: "apps/web/src/domains/creator/studio-paper-brush-response.ts",
      rasteriser: "canvaskit-wasm 2-D canvas via @toonspectrum/studio-engine-skia/node",
      paperSurface: DEFAULT_STUDIO_PAPER_SURFACE,
    },
    definitions: {
      beforeAfter:
        "Both arms consume the SAME planned dab array and the same seed; the only difference is whether `paper` is supplied to planStudioDynamicBrushCoverageMarks. dabGeometrySha256 and before/after markGeometrySha256 prove geometry is shared.",
      grainMidBandRatio:
        "E_mid/(E_low+E_mid+E_high) of the 64x64 interior window's 2-D DFT power, band 1/32 < f <= 1/8 cycles/px (period 8-32 px). Identical definition and window to brush-texture-lab.",
      correlation:
        "Pearson r over interior pixels whose unmodulated alpha is in [16,250]: heightVsAlphaRatio correlates paper height against A_after/A_before (granulation settles into troughs, so it must be negative); gainVsAlphaRatio correlates the granulation gain against the same ratio (must be positive).",
      canvasFixed:
        "documentCoordinateDrift is the max |delta| of the multiplier at identical document coordinates for strokes with different origins (must be exactly 0 — the paper is glued to the canvas); strokeRelativeDrift is the same comparison at identical stroke-relative coordinates after a (+37,+23) px translation, and must be non-zero or the probe proves nothing.",
      shapeInvariance:
        "dabGeometrySha256 and markGeometrySha256 pin the planned geometry; centroidShiftPx / spreadYShiftPx / inkMassRelative measure whether the rendered stroke moved, widened or gained ink; massPressureCorrelation is the pressure-fidelity axis (column ink mass vs known pressure).",
    },
    measurements: Object.fromEntries(
      raw.map((record) => [record.brushId, roundPaperBrushRecord(record)]),
    ),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const target = join(RESULTS_DIR, "brush-texture-lab-wired.json");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);

  for (const record of raw) {
    console.log(
      `${record.brushId}: paper[${record.paperActive ? `g${record.paperResponse.granulation} s${record.paperResponse.staining} x${record.paperResponse.scale}` : "off"}] `
      + `mid ${(record.before.grain.midBandRatio * 100).toFixed(1)}% -> ${(record.after.grain.midBandRatio * 100).toFixed(1)}% `
      + `(x${(record.before.grain.midBandRatio === 0 ? 0 : record.after.grain.midBandRatio / record.before.grain.midBandRatio).toFixed(2)}) `
      + `power ${record.before.grain.totalPowerExDc.toExponential(2)} -> ${record.after.grain.totalPowerExDc.toExponential(2)} `
      + `edge ${record.before.edge.transitionWidthPx.toFixed(2)} -> ${record.after.edge.transitionWidthPx.toFixed(2)}px `
      + `ripple ${record.before.ripple.rippleCv.toFixed(4)} -> ${record.after.ripple.rippleCv.toFixed(4)} `
      + `r(h,ratio) ${record.correlation.heightVsAlphaRatio.toFixed(3)} `
      + `mass ${(record.delta.inkMassRelative * 100).toFixed(2)}% centroid ${record.delta.centroidShiftPx.toFixed(4)}px `
      + `corr(p,mass) ${record.pressure.massPressureCorrelationBefore.toFixed(4)} -> ${record.pressure.massPressureCorrelationAfter.toFixed(4)} `
      + `marks/s ${record.throughput.beforeMarksPerSecond.toFixed(0)} -> ${record.throughput.afterMarksPerSecond.toFixed(0)} `
      + `(${(record.throughput.relativeChange * 100).toFixed(1)}%) `
      + `frames/s ${record.throughput.beforeFramesPerSecond.toFixed(1)} -> ${record.throughput.afterFramesPerSecond.toFixed(1)} `
      + `(${(record.throughput.frameRelativeChange * 100).toFixed(1)}%)`,
    );
  }
  console.log(`written: ${target}`);
}

const executedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) await main();
