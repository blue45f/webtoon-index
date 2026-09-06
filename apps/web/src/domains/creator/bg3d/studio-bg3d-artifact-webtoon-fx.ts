/**
 * Deterministic CPU preview compositor for Babylon/renderer-neutral multi-artifact captures.
 *
 * The GPU specialist remains responsible for producing canonical beauty/depth/normal artifacts.
 * This module consumes only those validated arrays and never sees engine objects. It is a bounded
 * preview/LT fallback: final-size rendering should use the equivalent Babylon post-process path.
 */

import {
  normalizeStudioBg3dArtifactCaptureResultV2,
  type StudioBg3dArtifactCaptureResultV2,
  type StudioBg3dBeautyArtifact,
  type StudioBg3dDepthArtifact,
  type StudioBg3dEmissionArtifact,
  type StudioBg3dNormalArtifact,
} from "./studio-bg3d-artifact-capture-v2";
import {
  normalizeStudioBg3dWebtoonFxCaptureRequest,
  type StudioBg3dWebtoonFxPass,
} from "./studio-bg3d-webtoon-fx";

import type { StudioBg3dSpecialistResult } from "./studio-bg3d-runtime-adapter";

/**
 * This synchronous fallback is intentionally limited to a 512² preview. Larger captures must use
 * the worker/GPU compositor so UI input is never held by multi-pass CPU morphology.
 */
export const STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS = 262_144;

export type StudioBg3dArtifactFxErrorCode =
  | "aborted"
  | "dimension-mismatch"
  | "invalid-capture"
  | "invalid-request"
  | "missing-artifact"
  | "pixel-budget-exceeded"
  | "unsupported-effect";

export class StudioBg3dArtifactFxError extends Error {
  readonly code: StudioBg3dArtifactFxErrorCode;

  constructor(code: StudioBg3dArtifactFxErrorCode) {
    super(`Studio 3D artifact FX failed: ${code}`);
    this.name = "StudioBg3dArtifactFxError";
    this.code = code;
  }
}

export interface RenderStudioBg3dArtifactFxOptions {
  readonly signal?: AbortSignal;
}

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
});

function linearToSrgbByte(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  const srgb = bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new StudioBg3dArtifactFxError("aborted");
}

function assertCpuPixelBudget(value: unknown): void {
  try {
    if (!value || typeof value !== "object") return;
    const widthDescriptor = Object.getOwnPropertyDescriptor(value, "width");
    const heightDescriptor = Object.getOwnPropertyDescriptor(value, "height");
    const width = widthDescriptor && "value" in widthDescriptor
      ? widthDescriptor.value
      : undefined;
    const height = heightDescriptor && "value" in heightDescriptor
      ? heightDescriptor.value
      : undefined;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      return;
    }
    const pixels = width * height;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS
    ) {
      throw new StudioBg3dArtifactFxError("pixel-budget-exceeded");
    }
  } catch (error) {
    if (error instanceof StudioBg3dArtifactFxError) throw error;
    // Getters and proxies remain the canonical normalizer's responsibility.
  }
}

function checkAbortAt(signal: AbortSignal | undefined, index: number): void {
  if ((index & 0x3fff) === 0) throwIfAborted(signal);
}

function hexToLinear(value: string): readonly [number, number, number] {
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  return [
    SRGB_TO_LINEAR[red]!,
    SRGB_TO_LINEAR[green]!,
    SRGB_TO_LINEAR[blue]!,
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function findArtifact<Kind extends StudioBg3dArtifactCaptureResultV2["artifacts"][number]["kind"]>(
  capture: StudioBg3dArtifactCaptureResultV2,
  kind: Kind,
): Extract<StudioBg3dArtifactCaptureResultV2["artifacts"][number], { readonly kind: Kind }> | null {
  return capture.artifacts.find((artifact) => artifact.kind === kind) as
    Extract<StudioBg3dArtifactCaptureResultV2["artifacts"][number], { readonly kind: Kind }>
    | undefined
    ?? null;
}

function decodeOctahedralNormal(
  packed: Uint8Array,
  pixel: number,
): readonly [number, number, number] {
  let x = (packed[pixel * 2]! / 255) * 2 - 1;
  let y = (packed[pixel * 2 + 1]! / 255) * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * (oldX < 0 ? -1 : 1);
    y = (1 - Math.abs(oldX)) * (y < 0 ? -1 : 1);
  }
  const length = Math.hypot(x, y, z);
  if (length <= 1e-8) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function edgeConfidence(
  difference: number,
  threshold: number,
): number {
  if (threshold <= 0) return difference > 1e-8 ? 1 : 0;
  return smoothstep(threshold * 0.65, threshold * 1.35, difference);
}

function compositeStraightLinearSourceOver(
  rgba: Uint8Array,
  offset: number,
  source: readonly [number, number, number],
  sourceAlphaValue: number,
): void {
  const sourceAlpha = Math.max(0, Math.min(1, sourceAlphaValue));
  if (sourceAlpha <= 0) return;
  const destinationAlpha = rgba[offset + 3]! / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 1e-8) {
    rgba.fill(0, offset, offset + 4);
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const destination = SRGB_TO_LINEAR[rgba[offset + channel]!]!;
    const outputPremultiplied =
      source[channel]! * sourceAlpha +
      destination * destinationAlpha * (1 - sourceAlpha);
    rgba[offset + channel] = linearToSrgbByte(outputPremultiplied / outputAlpha);
  }
  rgba[offset + 3] = Math.round(outputAlpha * 255);
}

function compositePremultipliedLinearSourceOver(
  rgba: Uint8Array,
  offset: number,
  sourcePremultiplied: readonly [number, number, number],
  sourceAlphaValue: number,
): void {
  const sourceAlpha = Math.max(0, Math.min(1, sourceAlphaValue));
  if (
    sourceAlpha <= 0 &&
    sourcePremultiplied[0] <= 0 &&
    sourcePremultiplied[1] <= 0 &&
    sourcePremultiplied[2] <= 0
  ) {
    return;
  }
  const destinationAlpha = rgba[offset + 3]! / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 1e-8) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const destination = SRGB_TO_LINEAR[rgba[offset + channel]!]!;
    const outputPremultiplied =
      sourcePremultiplied[channel]! +
      destination * destinationAlpha * (1 - sourceAlpha);
    rgba[offset + channel] = linearToSrgbByte(outputPremultiplied / outputAlpha);
  }
  rgba[offset + 3] = Math.round(outputAlpha * 255);
}

function maxFilterHorizontal(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const deque = new Int32Array(width);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let head = 0;
    let tail = 0;
    let incoming = 0;
    for (let x = 0; x < width; x += 1) {
      const maximum = Math.min(width - 1, x + radius);
      while (incoming <= maximum) {
        const incomingValue = source[row + incoming]!;
        while (tail > head && source[row + deque[tail - 1]!]! <= incomingValue) tail -= 1;
        deque[tail] = incoming;
        tail += 1;
        incoming += 1;
      }
      const minimum = x - radius;
      while (tail > head && deque[head]! < minimum) head += 1;
      target[row + x] = tail > head ? source[row + deque[head]!]! : 0;
    }
  }
}

function maxFilterVertical(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const deque = new Int32Array(height);
  for (let x = 0; x < width; x += 1) {
    let head = 0;
    let tail = 0;
    let incoming = 0;
    for (let y = 0; y < height; y += 1) {
      const maximum = Math.min(height - 1, y + radius);
      while (incoming <= maximum) {
        const incomingIndex = incoming * width + x;
        const incomingValue = source[incomingIndex]!;
        while (
          tail > head &&
          source[deque[tail - 1]! * width + x]! <= incomingValue
        ) {
          tail -= 1;
        }
        deque[tail] = incoming;
        tail += 1;
        incoming += 1;
      }
      const minimum = y - radius;
      while (tail > head && deque[head]! < minimum) head += 1;
      target[y * width + x] = tail > head
        ? source[deque[head]! * width + x]!
        : 0;
    }
  }
}

function applyToonOutline(input: {
  readonly rgba: Uint8Array;
  readonly depth: StudioBg3dDepthArtifact;
  readonly normal: StudioBg3dNormalArtifact;
  readonly width: number;
  readonly height: number;
  readonly pass: Extract<StudioBg3dWebtoonFxPass, { readonly kind: "toon-outline" }>;
  readonly signal?: AbortSignal;
}): void {
  const { rgba, depth, normal, width, height, pass, signal } = input;
  const pixels = width * height;
  const edges = new Float32Array(pixels);
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      checkAbortAt(signal, pixel);
      const centerAlpha = rgba[pixel * 4 + 3]! / 255;
      const centerDepth = depth.data[pixel]!;
      const centerNormal = decodeOctahedralNormal(normal.data, pixel);
      let confidence = 0;
      for (const [offsetX, offsetY] of neighbors) {
        const neighborX = x + offsetX;
        const neighborY = y + offsetY;
        if (
          neighborX < 0 || neighborX >= width ||
          neighborY < 0 || neighborY >= height
        ) continue;
        const neighborPixel = neighborY * width + neighborX;
        const alphaDifference = Math.abs(
          centerAlpha - rgba[neighborPixel * 4 + 3]! / 255,
        );
        const depthDifference = Math.abs(centerDepth - depth.data[neighborPixel]!);
        const neighborNormal = decodeOctahedralNormal(normal.data, neighborPixel);
        const normalDifference = 1 - Math.max(-1, Math.min(1,
          centerNormal[0] * neighborNormal[0] +
          centerNormal[1] * neighborNormal[1] +
          centerNormal[2] * neighborNormal[2]
        ));
        confidence = Math.max(
          confidence,
          alphaDifference,
          edgeConfidence(depthDifference, pass.depthThreshold),
          edgeConfidence(normalDifference, pass.normalThreshold),
        );
      }
      edges[pixel] = confidence;
    }
  }

  const radius = Math.max(0, Math.min(8, Math.ceil((pass.thicknessPx - 1) / 2)));
  let mask = edges;
  if (radius > 0) {
    const horizontal = new Float32Array(pixels);
    const dilated = new Float32Array(pixels);
    maxFilterHorizontal(edges, horizontal, width, height, radius);
    maxFilterVertical(horizontal, dilated, width, height, radius);
    mask = dilated;
  }

  const line = hexToLinear(pass.color);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    checkAbortAt(signal, pixel);
    const blend = mask[pixel]! * pass.opacity;
    if (blend <= 0) continue;
    const offset = pixel * 4;
    compositeStraightLinearSourceOver(rgba, offset, line, blend);
  }
}

function applyDepthAtmosphere(input: {
  readonly rgba: Uint8Array;
  readonly depth: StudioBg3dDepthArtifact;
  readonly pass: Extract<StudioBg3dWebtoonFxPass, { readonly kind: "depth-atmosphere" }>;
  readonly signal?: AbortSignal;
}): void {
  const { rgba, depth, pass, signal } = input;
  const fog = hexToLinear(pass.color);
  for (let pixel = 0; pixel < depth.data.length; pixel += 1) {
    checkAbortAt(signal, pixel);
    const offset = pixel * 4;
    if (rgba[offset + 3] === 0) continue;
    const normalizedDepth = smoothstep(
      pass.startDepth,
      pass.endDepth,
      depth.data[pixel]!,
    );
    const blend = (1 - Math.exp(-pass.density * normalizedDepth)) * pass.opacity;
    if (blend <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = SRGB_TO_LINEAR[rgba[offset + channel]!]!;
      rgba[offset + channel] = linearToSrgbByte(
        base + (fog[channel]! - base) * blend,
      );
    }
  }
}

function boxBlurHorizontal(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
  signal: AbortSignal | undefined,
): void {
  const kernelSize = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    checkAbortAt(signal, y * width);
    const row = y * width;
    let sum = 0;
    for (let sample = 0; sample <= radius && sample < width; sample += 1) {
      sum += source[row + sample]!;
    }
    for (let x = 0; x < width; x += 1) {
      target[row + x] = sum / kernelSize;
      const outgoing = x - radius;
      if (outgoing >= 0) sum -= source[row + outgoing]!;
      const incoming = x + radius + 1;
      if (incoming < width) sum += source[row + incoming]!;
    }
  }
}

function boxBlurVertical(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
  signal: AbortSignal | undefined,
): void {
  const kernelSize = radius * 2 + 1;
  for (let x = 0; x < width; x += 1) {
    checkAbortAt(signal, x);
    let sum = 0;
    for (let sample = 0; sample <= radius && sample < height; sample += 1) {
      sum += source[sample * width + x]!;
    }
    for (let y = 0; y < height; y += 1) {
      target[y * width + x] = sum / kernelSize;
      const outgoing = y - radius;
      if (outgoing >= 0) sum -= source[outgoing * width + x]!;
      const incoming = y + radius + 1;
      if (incoming < height) sum += source[incoming * width + x]!;
    }
  }
}

function applyEmissiveBloom(input: {
  readonly rgba: Uint8Array;
  readonly emission: StudioBg3dEmissionArtifact | null;
  readonly width: number;
  readonly height: number;
  readonly pass: Extract<StudioBg3dWebtoonFxPass, { readonly kind: "emissive-bloom" }>;
  readonly signal?: AbortSignal;
}): void {
  const { rgba, emission, width, height, pass, signal } = input;
  const pixels = width * height;
  const radius = Math.max(0, Math.min(64, Math.round(pass.radiusPx)));
  const threshold = pass.threshold;
  const source = emission?.data ?? rgba;
  const sourceIsLinear = emission !== null;
  const alphaBuffer = new Float32Array(pixels);
  const alphaBlurBuffer = new Float32Array(pixels);
  const premultipliedChannels = [
    new Float32Array(pixels),
    new Float32Array(pixels),
    new Float32Array(pixels),
  ] as const;
  const channelBlurBuffer = new Float32Array(pixels);

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    checkAbortAt(signal, pixel);
    const offset = pixel * 4;
    const coverage = source[offset + 3]! / 255;
    if (coverage <= 0) continue;
    const red = sourceIsLinear ? source[offset]! / 255 : SRGB_TO_LINEAR[source[offset]!]!;
    const green = sourceIsLinear
      ? source[offset + 1]! / 255
      : SRGB_TO_LINEAR[source[offset + 1]!]!;
    const blue = sourceIsLinear
      ? source[offset + 2]! / 255
      : SRGB_TO_LINEAR[source[offset + 2]!]!;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const bright = threshold >= 1
      ? 0
      : Math.max(0, (luminance - threshold) / Math.max(1e-6, 1 - threshold));
    const glowAlpha = coverage * bright;
    alphaBuffer[pixel] = glowAlpha;
    premultipliedChannels[0][pixel] = red * glowAlpha;
    premultipliedChannels[1][pixel] = green * glowAlpha;
    premultipliedChannels[2][pixel] = blue * glowAlpha;
  }

  boxBlurHorizontal(alphaBuffer, alphaBlurBuffer, width, height, radius, signal);
  boxBlurVertical(alphaBlurBuffer, alphaBuffer, width, height, radius, signal);
  for (const channel of premultipliedChannels) {
    boxBlurHorizontal(channel, channelBlurBuffer, width, height, radius, signal);
    boxBlurVertical(channelBlurBuffer, channel, width, height, radius, signal);
  }

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    checkAbortAt(signal, pixel);
    const sourceAlpha = Math.min(1, alphaBuffer[pixel]! * pass.intensity);
    const sourcePremultiplied = [
      premultipliedChannels[0][pixel]! * pass.intensity,
      premultipliedChannels[1][pixel]! * pass.intensity,
      premultipliedChannels[2][pixel]! * pass.intensity,
    ] as const;
    if (
      sourceAlpha > 0 ||
      sourcePremultiplied.some((channel) => channel > 0)
    ) {
      compositePremultipliedLinearSourceOver(
        rgba,
        pixel * 4,
        sourcePremultiplied,
        sourceAlpha,
      );
    }
  }
}

/**
 * Applies the first production slice of the webtoon-FX recipe: outline, depth atmosphere, and
 * emissive bloom. Unsupported recipe passes fail closed instead of silently disappearing. The
 * synchronous fallback supports pre-abort and a strict 512² budget; larger or mid-flight
 * cancellable work belongs to the worker/GPU compositor.
 */
export function renderStudioBg3dArtifactWebtoonFx(
  captureValue: unknown,
  requestValue: unknown,
  options: RenderStudioBg3dArtifactFxOptions = {},
): StudioBg3dSpecialistResult {
  throwIfAborted(options.signal);
  // Reject CPU-ineligible dimensions before the canonical normalizer clones artifact buffers.
  assertCpuPixelBudget(captureValue);
  const capture = normalizeStudioBg3dArtifactCaptureResultV2(captureValue);
  if (!capture) throw new StudioBg3dArtifactFxError("invalid-capture");
  const request = normalizeStudioBg3dWebtoonFxCaptureRequest(requestValue);
  if (!request) throw new StudioBg3dArtifactFxError("invalid-request");
  if (capture.width !== request.width || capture.height !== request.height) {
    throw new StudioBg3dArtifactFxError("dimension-mismatch");
  }
  const pixels = capture.width * capture.height;
  if (pixels > STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS) {
    throw new StudioBg3dArtifactFxError("pixel-budget-exceeded");
  }

  const beauty = findArtifact(capture, "beauty") as StudioBg3dBeautyArtifact | null;
  if (!beauty) throw new StudioBg3dArtifactFxError("missing-artifact");
  const depth = findArtifact(capture, "depth") as StudioBg3dDepthArtifact | null;
  const normal = findArtifact(capture, "normal") as StudioBg3dNormalArtifact | null;
  const emission = findArtifact(capture, "emission") as StudioBg3dEmissionArtifact | null;
  if (request.includeDepth && !depth) {
    throw new StudioBg3dArtifactFxError("missing-artifact");
  }
  const rgba = Uint8Array.from(beauty.data);

  for (const effect of request.effects) {
    throwIfAborted(options.signal);
    switch (effect.kind) {
      case "toon-outline":
        if (!depth || !normal) throw new StudioBg3dArtifactFxError("missing-artifact");
        applyToonOutline({
          rgba,
          depth,
          normal,
          width: capture.width,
          height: capture.height,
          pass: effect,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        break;
      case "depth-atmosphere":
        if (!depth) throw new StudioBg3dArtifactFxError("missing-artifact");
        applyDepthAtmosphere({
          rgba,
          depth,
          pass: effect,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        break;
      case "emissive-bloom":
        applyEmissiveBloom({
          rgba,
          emission,
          width: capture.width,
          height: capture.height,
          pass: effect,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        break;
      default:
        throw new StudioBg3dArtifactFxError("unsupported-effect");
    }
  }

  return Object.freeze({
    kind: "capture",
    width: capture.width,
    height: capture.height,
    rgba,
    ...(request.includeDepth && depth
      ? { depthFloat32: Float32Array.from(depth.data) }
      : {}),
  } satisfies StudioBg3dSpecialistResult);
}
