import {
  normalizeStudioBg3dArtifactCaptureResultV2,
  type StudioBg3dArtifactCaptureResultV2,
  type StudioBg3dArtifactKind,
  type StudioBg3dCaptureArtifactV2,
  type StudioBg3dStableIdLegendEntry,
} from "./studio-bg3d-artifact-capture-v2";

export type StudioBg3dArtifactRasterEncoding =
  | "beauty-rgba8-srgb"
  | "depth-rgba8-near-black-far-white"
  | "normal-rgba8-view-rh"
  | "stable-id-rgba8-palette"
  | "coverage-rgba8-white-to-black"
  | "emission-rgba8-srgb"
  | "velocity-rgba8-signed-scale";

export interface StudioBg3dArtifactRasterLegendEntry
  extends StudioBg3dStableIdLegendEntry {
  readonly color: string;
}

export interface StudioBg3dArtifactRaster {
  readonly kind: StudioBg3dArtifactKind;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly encoding: StudioBg3dArtifactRasterEncoding;
  readonly sourceProfile: string;
  readonly legend?: readonly StudioBg3dArtifactRasterLegendEntry[];
  readonly velocityScalePixelsPerSecond?: number;
}

export type StudioBg3dArtifactRasterizationErrorCode =
  | "invalid-capture"
  | "missing-artifact";

export class StudioBg3dArtifactRasterizationError extends Error {
  constructor(readonly code: StudioBg3dArtifactRasterizationErrorCode) {
    super(`Studio 3D artifact rasterization failed: ${code}`);
    this.name = "StudioBg3dArtifactRasterizationError";
  }
}

const PALETTE_PERMUTATION = 0x9e3779;

function byteFromUnit(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function linearToSrgbByte(byte: number): number {
  const linear = byte / 255;
  const srgb = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
  return byteFromUnit(srgb);
}

function colorHex(red: number, green: number, blue: number): string {
  return `#${red.toString(16).padStart(2, "0")}${green
    .toString(16)
    .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

function paletteColor(ordinal: number): readonly [number, number, number] {
  const encoded = Math.imul(ordinal, PALETTE_PERMUTATION) & 0x00ff_ffff;
  return [
    (encoded >>> 16) & 0xff,
    (encoded >>> 8) & 0xff,
    encoded & 0xff,
  ];
}

function decodeOctahedralNormal(
  packed: Uint8Array,
  pixel: number,
): readonly [number, number, number] {
  let x = (packed[pixel * 2]! / 255) * 2 - 1;
  let y = (packed[pixel * 2 + 1]! / 255) * 2 - 1;
  let z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * (oldX < 0 ? -1 : 1);
    y = (1 - Math.abs(oldX)) * (y < 0 ? -1 : 1);
  }
  const length = Math.hypot(x, y, z);
  if (length <= 1e-8) return [0, 0, 1];
  x /= length;
  y /= length;
  z /= length;
  return [x, y, z];
}

function rasterBase(
  artifact: StudioBg3dCaptureArtifactV2,
  data: Uint8ClampedArray,
  encoding: StudioBg3dArtifactRasterEncoding,
): StudioBg3dArtifactRaster {
  return Object.freeze({
    kind: artifact.kind,
    width: artifact.width,
    height: artifact.height,
    data,
    encoding,
    sourceProfile: artifact.profile,
  });
}

function rasterizeBeauty(
  artifact: Extract<StudioBg3dCaptureArtifactV2, { readonly kind: "beauty" }>,
): StudioBg3dArtifactRaster {
  return rasterBase(
    artifact,
    new Uint8ClampedArray(artifact.data),
    "beauty-rgba8-srgb",
  );
}

function rasterizeDepth(
  artifact: Extract<StudioBg3dCaptureArtifactV2, { readonly kind: "depth" }>,
): StudioBg3dArtifactRaster {
  const output = new Uint8ClampedArray(artifact.data.length * 4);
  for (let pixel = 0; pixel < artifact.data.length; pixel += 1) {
    const value = byteFromUnit(artifact.data[pixel]!);
    const offset = pixel * 4;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  return rasterBase(artifact, output, "depth-rgba8-near-black-far-white");
}

function rasterizeNormal(
  artifact: Extract<StudioBg3dCaptureArtifactV2, { readonly kind: "normal" }>,
): StudioBg3dArtifactRaster {
  const pixels = artifact.width * artifact.height;
  const output = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const normal = decodeOctahedralNormal(artifact.data, pixel);
    const offset = pixel * 4;
    output[offset] = byteFromUnit(normal[0] * 0.5 + 0.5);
    output[offset + 1] = byteFromUnit(normal[1] * 0.5 + 0.5);
    output[offset + 2] = byteFromUnit(normal[2] * 0.5 + 0.5);
    output[offset + 3] = 255;
  }
  return rasterBase(artifact, output, "normal-rgba8-view-rh");
}

function rasterizeStableIds(
  artifact: Extract<
    StudioBg3dCaptureArtifactV2,
    { readonly kind: "object-id" | "material-id" }
  >,
): StudioBg3dArtifactRaster {
  const colorById = new Map<number, readonly [number, number, number]>();
  const legend = artifact.legend.map((entry, index) => {
    const color = paletteColor(index + 1);
    colorById.set(entry.id, color);
    return Object.freeze({
      ...entry,
      color: colorHex(color[0], color[1], color[2]),
    });
  });
  const output = new Uint8ClampedArray(artifact.data.length * 4);
  for (let pixel = 0; pixel < artifact.data.length; pixel += 1) {
    const id = artifact.data[pixel]!;
    const color = id === 0 ? ([0, 0, 0] as const) : colorById.get(id)!;
    const offset = pixel * 4;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = 255;
  }
  return Object.freeze({
    ...rasterBase(artifact, output, "stable-id-rgba8-palette"),
    legend: Object.freeze(legend),
  });
}

function rasterizeCoverage(
  artifact: Extract<
    StudioBg3dCaptureArtifactV2,
    { readonly kind: "shadow" | "ambient-occlusion" }
  >,
): StudioBg3dArtifactRaster {
  const output = new Uint8ClampedArray(artifact.data.length * 4);
  for (let pixel = 0; pixel < artifact.data.length; pixel += 1) {
    const value = 255 - artifact.data[pixel]!;
    const offset = pixel * 4;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  return rasterBase(artifact, output, "coverage-rgba8-white-to-black");
}

function rasterizeEmission(
  artifact: Extract<StudioBg3dCaptureArtifactV2, { readonly kind: "emission" }>,
): StudioBg3dArtifactRaster {
  const output = new Uint8ClampedArray(artifact.data.length);
  for (let offset = 0; offset < artifact.data.length; offset += 4) {
    output[offset] = linearToSrgbByte(artifact.data[offset]!);
    output[offset + 1] = linearToSrgbByte(artifact.data[offset + 1]!);
    output[offset + 2] = linearToSrgbByte(artifact.data[offset + 2]!);
    output[offset + 3] = artifact.data[offset + 3]!;
  }
  return rasterBase(artifact, output, "emission-rgba8-srgb");
}

function rasterizeVelocity(
  artifact: Extract<StudioBg3dCaptureArtifactV2, { readonly kind: "velocity" }>,
): StudioBg3dArtifactRaster {
  let scale = 1;
  for (const value of artifact.data) scale = Math.max(scale, Math.abs(value));
  const pixels = artifact.width * artifact.height;
  const output = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const x = artifact.data[pixel * 2]!;
    const y = artifact.data[pixel * 2 + 1]!;
    const offset = pixel * 4;
    output[offset] = byteFromUnit(x / scale * 0.5 + 0.5);
    output[offset + 1] = byteFromUnit(y / scale * 0.5 + 0.5);
    output[offset + 2] = byteFromUnit(Math.min(1, Math.hypot(x, y) / scale));
    output[offset + 3] = 255;
  }
  return Object.freeze({
    ...rasterBase(artifact, output, "velocity-rgba8-signed-scale"),
    velocityScalePixelsPerSecond: scale,
  });
}

export function rasterizeStudioBg3dCaptureArtifact(
  artifact: StudioBg3dCaptureArtifactV2,
): StudioBg3dArtifactRaster {
  switch (artifact.kind) {
    case "beauty":
      return rasterizeBeauty(artifact);
    case "depth":
      return rasterizeDepth(artifact);
    case "normal":
      return rasterizeNormal(artifact);
    case "object-id":
    case "material-id":
      return rasterizeStableIds(artifact);
    case "shadow":
    case "ambient-occlusion":
      return rasterizeCoverage(artifact);
    case "emission":
      return rasterizeEmission(artifact);
    case "velocity":
      return rasterizeVelocity(artifact);
  }
}

/**
 * Validates and snapshots a capture before exposing PNG-ready RGBA rasters. Requested order is
 * preserved; duplicate requested kinds are collapsed by the capture contract before this point.
 */
export function rasterizeStudioBg3dArtifactCapture(
  capture: StudioBg3dArtifactCaptureResultV2,
  requestedKinds?: readonly StudioBg3dArtifactKind[],
): readonly StudioBg3dArtifactRaster[] {
  const normalized = normalizeStudioBg3dArtifactCaptureResultV2(capture);
  if (!normalized) throw new StudioBg3dArtifactRasterizationError("invalid-capture");
  const byKind = new Map(normalized.artifacts.map((artifact) => [artifact.kind, artifact] as const));
  const kinds = requestedKinds ?? normalized.artifacts.map((artifact) => artifact.kind);
  const result: StudioBg3dArtifactRaster[] = [];
  const seen = new Set<StudioBg3dArtifactKind>();
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    const artifact = byKind.get(kind);
    if (!artifact) throw new StudioBg3dArtifactRasterizationError("missing-artifact");
    result.push(rasterizeStudioBg3dCaptureArtifact(artifact));
  }
  return Object.freeze(result);
}
