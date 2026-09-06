/**
 * Deterministic, browser-neutral raster stage for Studio's 3D line-and-tone (LT) output.
 *
 * The engine/capture boundary owns color and optional normalized depth pixels. This module owns
 * only bounded typed-array processing: it never reaches the DOM, creates a canvas, decodes an
 * asset, or mutates caller-owned buffers. The caller can encode each returned RGBA layer as PNG.
 *
 * A captured image contains visible surfaces only, so hidden-line removal is already inherent at
 * this boundary. A requested vector line layer is deliberately rasterized here; vector tracing is
 * a separate post-process and must not be inferred from pixels by this trust boundary.
 */

import {
  STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS,
  extractStudioBg3dLtDepthEdges,
} from "./studio-bg3d-lt-depth-edges";

import type {
  StudioBg3dLineOutputSettings,
  StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";
import type { StudioBg3dLtRasterLayerRole } from "../scene-3d/studio-3d-insert-contract";

export const STUDIO_BG3D_LT_RENDER_MAX_PIXELS = STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS;

export type { StudioBg3dLtRasterLayerRole } from "../scene-3d/studio-3d-insert-contract";

export interface StudioBg3dLtRasterInput {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  /** Optional linear or device depth normalized to [0, 1], one value per pixel. */
  readonly depth?: Float32Array;
}

export interface StudioBg3dThreeRgbaDepthInput {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGBA8 bytes emitted by Three's RGBADepthPacking shader. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
  /** Set for WebGL readPixels data whose first row is the framebuffer's bottom row. */
  readonly flipY?: boolean;
}

export interface StudioBg3dLtRenderSettings {
  readonly line: StudioBg3dLineOutputSettings;
  readonly tone: StudioBg3dToneOutputSettings;
}

export interface StudioBg3dLtRasterLayer {
  readonly role: StudioBg3dLtRasterLayerRole;
  readonly width: number;
  readonly height: number;
  /** Fresh, tightly packed, non-premultiplied RGBA bytes. */
  readonly data: Uint8ClampedArray;
}

export interface StudioBg3dLtRenderResult {
  readonly width: number;
  readonly height: number;
  /** Stable paint order. Empty/disabled layers are omitted. */
  readonly layers: readonly StudioBg3dLtRasterLayer[];
}

interface ValidatedInput {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  readonly depth?: Float32Array;
}

interface ValidatedRgbaShape {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;
const LINE_LAYER_TYPE_SET = new Set(["raster", "vector"]);
const TONE_MODE_SET = new Set(["none", "flat", "cel", "screentone"]);
const TONE_TYPE_SET = new Set(["color", "grayscale", "pattern"]);
const TONE_PATTERN_SET = new Set(["dot", "line", "crosshatch", "noise"]);

function isByteArray(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray;
}

function assertFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a finite number in [${minimum}, ${maximum}].`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
}

function validateRgbaShape(
  width: unknown,
  height: unknown,
  rgba: unknown,
  label: string
): ValidatedRgbaShape {
  if (typeof width !== "number" || !Number.isSafeInteger(width) || width < 1) {
    throw new RangeError(`${label} width must be a positive safe integer.`);
  }
  if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError(`${label} height must be a positive safe integer.`);
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError(
      `${label} exceeds the ${STUDIO_BG3D_LT_RENDER_MAX_PIXELS}-pixel budget.`
    );
  }
  if (!isByteArray(rgba)) {
    throw new TypeError(`${label} rgba must be a Uint8Array or Uint8ClampedArray.`);
  }
  if (rgba.length !== pixelCount * 4) {
    throw new RangeError(`${label} rgba length must equal width * height * 4.`);
  }
  return { width, height, pixelCount, rgba };
}

function validateInput(input: StudioBg3dLtRasterInput): ValidatedInput {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("LT raster input must be an object.");
  }
  const { depth } = input;
  const shape = validateRgbaShape(input.width, input.height, input.rgba, "LT raster input");
  if (depth !== undefined) {
    if (!(depth instanceof Float32Array)) {
      throw new TypeError("LT raster depth must be a Float32Array when provided.");
    }
    if (depth.length !== shape.pixelCount) {
      throw new RangeError("LT raster depth length must equal width * height.");
    }
    for (let index = 0; index < depth.length; index += 1) {
      const value = depth[index];
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError("LT raster depth values must be finite and normalized to [0, 1].");
      }
    }
  }
  return { ...shape, ...(depth ? { depth } : {}) };
}

function validateLineSettings(line: StudioBg3dLineOutputSettings): void {
  if (typeof line !== "object" || line === null) {
    throw new TypeError("LT line settings must be an object.");
  }
  assertBoolean(line.enabled, "line.enabled");
  if (!LINE_LAYER_TYPE_SET.has(line.layerType)) {
    throw new RangeError("line.layerType must be raster or vector.");
  }
  if (typeof line.color !== "string" || !HEX_COLOR_PATTERN.test(line.color)) {
    throw new RangeError("line.color must be a canonical lowercase #rrggbb color.");
  }
  assertFiniteRange(line.widthPx, 0.25, 8, "line.widthPx");
  assertFiniteRange(line.strength, 0, 1, "line.strength");
  assertFiniteRange(line.accuracy, 0, 1, "line.accuracy");
  assertBoolean(line.scaleAwareAccuracy, "line.scaleAwareAccuracy");
  assertFiniteRange(line.exteriorOutlineStrength, 0, 2, "line.exteriorOutlineStrength");
  assertBoolean(line.depthEnabled, "line.depthEnabled");
  assertFiniteRange(line.depthStrength, 0, 1, "line.depthStrength");
  assertBoolean(line.depthOutlineOnly, "line.depthOutlineOnly");
  assertFiniteRange(line.smoothing, 0, 1, "line.smoothing");
  assertBoolean(line.textureLineEnabled, "line.textureLineEnabled");
  assertFiniteRange(line.textureLineStrength, 0, 1, "line.textureLineStrength");
  assertFiniteRange(line.creaseAngleDegrees, 0, 180, "line.creaseAngleDegrees");
  assertBoolean(line.hiddenLineRemoval, "line.hiddenLineRemoval");
}

function validateToneSettings(tone: StudioBg3dToneOutputSettings): void {
  if (typeof tone !== "object" || tone === null) {
    throw new TypeError("LT tone settings must be an object.");
  }
  if (!TONE_MODE_SET.has(tone.mode)) {
    throw new RangeError("tone.mode is not supported.");
  }
  if (!TONE_TYPE_SET.has(tone.type)) {
    throw new RangeError("tone.type is not supported.");
  }
  if (!TONE_PATTERN_SET.has(tone.pattern)) {
    throw new RangeError("tone.pattern is not supported.");
  }
  if (!Number.isSafeInteger(tone.levels) || tone.levels < 2 || tone.levels > 8) {
    throw new RangeError("tone.levels must be an integer in [2, 8].");
  }
  assertFiniteRange(tone.opacity, 0, 1, "tone.opacity");
  assertFiniteRange(tone.frequency, 1, 200, "tone.frequency");
  assertFiniteRange(tone.angleDegrees, -180, 180, "tone.angleDegrees");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/*
 * Mirrors Three r184's packing.glsl UnpackFactors4 exactly:
 *   vec4(255/256, 255/65536, 255/16777216, 1/16777216)
 * sampled RGBA8 channels are first normalized by 255, which reduces to the byte factors below.
 */
const THREE_RGBA_DEPTH_RED_FACTOR = 1 / 256;
const THREE_RGBA_DEPTH_GREEN_FACTOR = 1 / 65_536;
const THREE_RGBA_DEPTH_BLUE_FACTOR = 1 / 16_777_216;
const THREE_RGBA_DEPTH_ALPHA_FACTOR = 1 / (255 * 16_777_216);

/**
 * Decodes Three.js `RGBADepthPacking` RGBA8 pixels to normalized depth samples.
 *
 * The returned top-down Float32Array never aliases or modifies the packed input. `flipY` converts
 * the bottom-up row order produced by WebGL `readPixels` while leaving horizontal order intact.
 */
export function decodeStudioBg3dThreeRgbaDepth(
  packedInput: StudioBg3dThreeRgbaDepthInput
): Float32Array {
  if (typeof packedInput !== "object" || packedInput === null) {
    throw new TypeError("Three RGBA depth input must be an object.");
  }
  const shape = validateRgbaShape(
    packedInput.width,
    packedInput.height,
    packedInput.rgba,
    "Three RGBA depth input"
  );
  if (packedInput.flipY !== undefined && typeof packedInput.flipY !== "boolean") {
    throw new TypeError("Three RGBA depth flipY must be a boolean when provided.");
  }
  const depth = new Float32Array(shape.pixelCount);
  for (let targetY = 0; targetY < shape.height; targetY += 1) {
    const sourceY = packedInput.flipY ? shape.height - 1 - targetY : targetY;
    for (let x = 0; x < shape.width; x += 1) {
      const sourceOffset = (sourceY * shape.width + x) * 4;
      const value =
        shape.rgba[sourceOffset] * THREE_RGBA_DEPTH_RED_FACTOR +
        shape.rgba[sourceOffset + 1] * THREE_RGBA_DEPTH_GREEN_FACTOR +
        shape.rgba[sourceOffset + 2] * THREE_RGBA_DEPTH_BLUE_FACTOR +
        shape.rgba[sourceOffset + 3] * THREE_RGBA_DEPTH_ALPHA_FACTOR;
      depth[targetY * shape.width + x] = clamp01(value);
    }
  }
  return depth;
}

function byteAt(rgba: Uint8Array | Uint8ClampedArray, pixelIndex: number, channel: number): number {
  return rgba[pixelIndex * 4 + channel] ?? 0;
}

function buildLuminance(input: ValidatedInput): Float32Array {
  const luminance = new Float32Array(input.pixelCount);
  for (let index = 0; index < input.pixelCount; index += 1) {
    const red = byteAt(input.rgba, index, 0);
    const green = byteAt(input.rgba, index, 1);
    const blue = byteAt(input.rgba, index, 2);
    luminance[index] = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
  }
  return luminance;
}

/** Separable clamped-edge box blur with one image-sized allocation. */
function boxBlur(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return field;
  const output = new Float32Array(field.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += field[row + Math.min(width - 1, Math.max(0, offset))];
    }
    for (let x = 0; x < width; x += 1) {
      output[row + x] = sum / span;
      const removeX = Math.min(width - 1, Math.max(0, x - radius));
      const addX = Math.min(width - 1, Math.max(0, x + radius + 1));
      sum += field[row + addX] - field[row + removeX];
    }
  }

  const column = new Float32Array(height);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += output[Math.min(height - 1, Math.max(0, offset)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      column[y] = sum / span;
      const removeY = Math.min(height - 1, Math.max(0, y - radius));
      const addY = Math.min(height - 1, Math.max(0, y + radius + 1));
      sum += output[addY * width + x] - output[removeY * width + x];
    }
    for (let y = 0; y < height; y += 1) output[y * width + x] = column[y];
  }
  return output;
}

function clampedIndex(x: number, y: number, width: number, height: number): number {
  return Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
}

function sobelField(
  field: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const topLeft = field[clampedIndex(x - 1, y - 1, width, height)];
  const top = field[clampedIndex(x, y - 1, width, height)];
  const topRight = field[clampedIndex(x + 1, y - 1, width, height)];
  const left = field[clampedIndex(x - 1, y, width, height)];
  const right = field[clampedIndex(x + 1, y, width, height)];
  const bottomLeft = field[clampedIndex(x - 1, y + 1, width, height)];
  const bottom = field[clampedIndex(x, y + 1, width, height)];
  const bottomRight = field[clampedIndex(x + 1, y + 1, width, height)];
  const horizontal = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
  const vertical = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
  return clamp01(Math.hypot(horizontal, vertical) / 4);
}

function alphaAt(input: ValidatedInput, x: number, y: number): number {
  const index = clampedIndex(x, y, input.width, input.height);
  return byteAt(input.rgba, index, 3) / 255;
}

function sobelAlpha(input: ValidatedInput, x: number, y: number): number {
  const topLeft = alphaAt(input, x - 1, y - 1);
  const top = alphaAt(input, x, y - 1);
  const topRight = alphaAt(input, x + 1, y - 1);
  const left = alphaAt(input, x - 1, y);
  const right = alphaAt(input, x + 1, y);
  const bottomLeft = alphaAt(input, x - 1, y + 1);
  const bottom = alphaAt(input, x, y + 1);
  const bottomRight = alphaAt(input, x + 1, y + 1);
  const horizontal = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
  const vertical = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
  return clamp01(Math.hypot(horizontal, vertical) / 4);
}

function smoothResponse(value: number, threshold: number, softness: number): number {
  const normalized = clamp01((value - threshold) / Math.max(0.000_001, softness));
  return normalized * normalized * (3 - 2 * normalized);
}

/** Separable maximum filter used to turn a one-pixel response into the requested ink width. */
function expandResponse(
  response: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  if (radius < 1) return response;
  const output = new Uint8ClampedArray(response.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        maximum = Math.max(maximum, response[row + Math.min(width - 1, Math.max(0, x + offset))]);
      }
      output[row + x] = maximum;
    }
  }
  const column = new Uint8ClampedArray(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let maximum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        maximum = Math.max(
          maximum,
          output[Math.min(height - 1, Math.max(0, y + offset)) * width + x]
        );
      }
      column[y] = maximum;
    }
    for (let y = 0; y < height; y += 1) output[y * width + x] = column[y];
  }
  return output;
}

function parseColor(color: string): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function inkLayerFromResponse(
  role: "main-line" | "texture-line",
  response: Uint8ClampedArray,
  input: ValidatedInput,
  color: readonly [number, number, number]
): StudioBg3dLtRasterLayer | null {
  const data = new Uint8ClampedArray(input.pixelCount * 4);
  let hasInk = false;
  for (let index = 0; index < input.pixelCount; index += 1) {
    const alpha = Math.round((response[index] * byteAt(input.rgba, index, 3)) / 255);
    if (alpha < 1) continue;
    const offset = index * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = alpha;
    hasInk = true;
  }
  return hasInk ? { role, width: input.width, height: input.height, data } : null;
}

function lineWidthRadius(widthPx: number): number {
  return Math.min(4, Math.max(0, Math.ceil((widthPx - 1) / 2)));
}

function renderMainLineResponse(
  input: ValidatedInput,
  luminance: Float32Array,
  line: StudioBg3dLineOutputSettings
): Uint8ClampedArray {
  const smoothingRadius = Math.round(line.smoothing * 2);
  const edgeField = boxBlur(luminance, input.width, input.height, smoothingRadius);
  const response = new Uint8ClampedArray(input.pixelCount);
  const maximumDimension = Math.max(input.width, input.height);
  const scaleFactor = line.scaleAwareAccuracy
    ? Math.min(1.35, Math.max(0.65, Math.sqrt(640 / maximumDimension)))
    : 1;
  const threshold = (0.16 - line.accuracy * 0.12) * scaleFactor;
  const softness = 0.22 - line.accuracy * 0.1;
  const depthResponse =
    line.depthEnabled && input.depth
      ? extractStudioBg3dLtDepthEdges({
          width: input.width,
          height: input.height,
          depth: input.depth,
          includeCreases: !line.depthOutlineOnly,
        })
      : null;

  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      if (byteAt(input.rgba, index, 3) === 0) continue;
      const luminanceEdge = smoothResponse(
        sobelField(edgeField, x, y, input.width, input.height),
        threshold,
        softness
      );
      const exteriorEdge =
        smoothResponse(sobelAlpha(input, x, y), 0.01, 0.2) * line.exteriorOutlineStrength;
      let depthEdge = 0;
      if (depthResponse) {
        const depthFeature = depthResponse[index] / 255;
        depthEdge = smoothResponse(depthFeature, threshold * 0.5, softness) * line.depthStrength;
      }
      const combined = Math.max(luminanceEdge, exteriorEdge, depthEdge);
      response[index] = Math.round(clamp01(combined * line.strength) * 255);
    }
  }
  return expandResponse(response, input.width, input.height, lineWidthRadius(line.widthPx));
}

function renderTextureLineResponse(
  input: ValidatedInput,
  luminance: Float32Array,
  mainResponse: Uint8ClampedArray,
  line: StudioBg3dLineOutputSettings
): Uint8ClampedArray {
  const localAverage = boxBlur(
    luminance,
    input.width,
    input.height,
    line.smoothing > 0.66 ? 2 : 1
  );
  const response = new Uint8ClampedArray(input.pixelCount);
  const threshold =
    0.012 +
    (line.creaseAngleDegrees / 180) * 0.2 +
    line.smoothing * 0.025 +
    (1 - line.accuracy) * 0.035;
  const softness = 0.08 + line.smoothing * 0.08;
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      if (byteAt(input.rgba, index, 3) === 0) continue;
      const center = luminance[index];
      const residual = Math.abs(center - localAverage[index]) * 3;
      const laplacian = Math.abs(
        center * 4 -
          luminance[clampedIndex(x - 1, y, input.width, input.height)] -
          luminance[clampedIndex(x + 1, y, input.width, input.height)] -
          luminance[clampedIndex(x, y - 1, input.width, input.height)] -
          luminance[clampedIndex(x, y + 1, input.width, input.height)]
      );
      const highFrequency = clamp01(Math.max(residual, laplacian * 0.5));
      const separation = 1 - (mainResponse[index] / 255) * 0.85;
      const intensity =
        smoothResponse(highFrequency, threshold, softness) *
        separation *
        line.textureLineStrength *
        line.strength;
      response[index] = Math.round(clamp01(intensity) * 255);
    }
  }
  const radius = Math.max(0, lineWidthRadius(line.widthPx) - 1);
  return expandResponse(response, input.width, input.height, radius);
}

function quantizedLuminance(value: number, tone: StudioBg3dToneOutputSettings): number {
  const adjusted = tone.mode === "cel" ? clamp01((value - 0.5) * 1.35 + 0.5) : value;
  const steps = tone.levels - 1;
  return Math.round(adjusted * steps) / steps;
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function noiseRank(cellX: number, cellY: number): number {
  let hash = Math.imul(cellX, 374_761_393) ^ Math.imul(cellY, 668_265_263);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_296;
}

function patternRank(
  pattern: StudioBg3dToneOutputSettings["pattern"],
  x: number,
  y: number,
  period: number,
  cosine: number,
  sine: number
): number {
  const horizontal = (x + 0.5) * cosine + (y + 0.5) * sine;
  const vertical = -(x + 0.5) * sine + (y + 0.5) * cosine;
  const u = fractional(horizontal / period);
  const v = fractional(vertical / period);
  const lineU = Math.min(1, Math.abs(u - 0.5) * 2);
  const lineV = Math.min(1, Math.abs(v - 0.5) * 2);
  if (pattern === "line") return lineV;
  if (pattern === "crosshatch") return Math.min(lineU, lineV);
  if (pattern === "noise") return noiseRank(Math.floor(horizontal / period), Math.floor(vertical / period));
  const dx = u - 0.5;
  const dy = v - 0.5;
  return Math.min(1, Math.PI * (dx * dx + dy * dy));
}

function renderFillLayer(
  input: ValidatedInput,
  luminance: Float32Array,
  tone: StudioBg3dToneOutputSettings
): StudioBg3dLtRasterLayer | null {
  if (tone.mode === "none" || tone.opacity <= 0) return null;
  const data = new Uint8ClampedArray(input.pixelCount * 4);
  const angle = (tone.angleDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const period = Math.min(256, Math.max(2, 600 / tone.frequency));
  const antialiasWidth = Math.min(0.2, Math.max(0.03, 1 / period));
  let hasTone = false;

  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      const sourceAlpha = byteAt(input.rgba, index, 3);
      if (sourceAlpha === 0) continue;
      const gray = quantizedLuminance(luminance[index], tone);
      const offset = index * 4;
      if (tone.type === "color") {
        const alpha = Math.round(sourceAlpha * tone.opacity);
        if (alpha < 1) continue;
        if (tone.mode === "cel") {
          // Quantize lightness while retaining the captured material hue. Scaling all channels by
          // the same factor avoids the RGB channel posterization that tends to create false hues.
          const sourceLuminance = Math.max(1 / 255, luminance[index]);
          const lightnessScale = gray / sourceLuminance;
          data[offset] = Math.round(clamp01((byteAt(input.rgba, index, 0) / 255) * lightnessScale) * 255);
          data[offset + 1] = Math.round(clamp01((byteAt(input.rgba, index, 1) / 255) * lightnessScale) * 255);
          data[offset + 2] = Math.round(clamp01((byteAt(input.rgba, index, 2) / 255) * lightnessScale) * 255);
        } else {
          data[offset] = byteAt(input.rgba, index, 0);
          data[offset + 1] = byteAt(input.rgba, index, 1);
          data[offset + 2] = byteAt(input.rgba, index, 2);
        }
        data[offset + 3] = alpha;
        hasTone = true;
        continue;
      }
      if (tone.type === "grayscale") {
        const grayByte = Math.round(gray * 255);
        const alpha = Math.round(sourceAlpha * tone.opacity);
        if (alpha < 1) continue;
        data[offset] = grayByte;
        data[offset + 1] = grayByte;
        data[offset + 2] = grayByte;
        data[offset + 3] = alpha;
        hasTone = true;
        continue;
      }

      let coverage = 1 - gray;
      if (tone.mode === "screentone") coverage = Math.pow(coverage, 0.85);
      const rank = patternRank(tone.pattern, x, y, period, cosine, sine);
      const ink = clamp01((coverage - rank) / antialiasWidth + 0.5);
      const alpha = Math.round(sourceAlpha * tone.opacity * ink);
      if (alpha < 1) continue;
      data[offset + 3] = alpha;
      hasTone = true;
    }
  }
  return hasTone
    ? { role: tone.type === "color" ? "color" : "tone", width: input.width, height: input.height, data }
    : null;
}

/**
 * Produces separate, nonempty LT layers in stable paint order. The output never aliases input data.
 * Invalid dimensions, buffer shapes, depth samples, or non-canonical settings fail closed.
 */
export function renderStudioBg3dLtLayers(
  rasterInput: StudioBg3dLtRasterInput,
  settings: StudioBg3dLtRenderSettings
): StudioBg3dLtRenderResult {
  if (typeof settings !== "object" || settings === null) {
    throw new TypeError("LT render settings must be an object.");
  }
  const input = validateInput(rasterInput);
  validateLineSettings(settings.line);
  validateToneSettings(settings.tone);
  const luminance = buildLuminance(input);
  let mainLayer: StudioBg3dLtRasterLayer | null = null;
  let textureLayer: StudioBg3dLtRasterLayer | null = null;

  if (settings.line.enabled && settings.line.strength > 0) {
    const color = parseColor(settings.line.color);
    const mainResponse = renderMainLineResponse(input, luminance, settings.line);
    mainLayer = inkLayerFromResponse("main-line", mainResponse, input, color);
    if (settings.line.textureLineEnabled && settings.line.textureLineStrength > 0) {
      const textureResponse = renderTextureLineResponse(
        input,
        luminance,
        mainResponse,
        settings.line
      );
      textureLayer = inkLayerFromResponse("texture-line", textureResponse, input, color);
    }
  }

  const fillLayer = renderFillLayer(input, luminance, settings.tone);
  const layers: StudioBg3dLtRasterLayer[] = [];
  // The base render is always the backmost layer. A color output deliberately uses its own role so
  // Studio can classify it as editable color rather than misleadingly labelling it as screentone.
  if (fillLayer) layers.push(fillLayer);
  if (textureLayer) layers.push(textureLayer);
  if (mainLayer) layers.push(mainLayer);
  return { width: input.width, height: input.height, layers };
}
