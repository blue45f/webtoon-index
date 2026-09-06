import {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  normalizeStudioBrushDynamicsSettings,
  type NormalizedStudioBrushDynamicsMapping,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsSource,
} from "./brush/studio-brush-dynamics";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioBrushSnapshot,
} from "./brush/studio-brush-library";
import { encodeStudioBrushTipAlphaMapBase64 } from "./brush/studio-brush-tip-stamp";

import type { Abr, Brush, BrushDynamics, BrushShape, SampleInfo } from "ag-psd";

export const STUDIO_ABR_IMPORT_LIMITS = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxBrushes: 256,
  maxSamples: 512,
  maxSamplePixels: 16 * 1024 * 1024,
  maxTotalSamplePixels: 64 * 1024 * 1024,
  maxNameLength: 96,
  outputTipMin: 8,
  outputTipMax: 64,
});

export type StudioAbrImportErrorCode =
  | "empty"
  | "file-type"
  | "file-size"
  | "signature"
  | "unsupported-version"
  | "limits"
  | "parse"
  | "no-brushes"
  | "worker"
  | "timeout"
  | "aborted";

const ERROR_MESSAGES: Record<StudioAbrImportErrorCode, string> = {
  empty: "ABR 파일이 비어 있습니다.",
  "file-type": "Photoshop 브러시(.abr) 파일을 선택해 주세요.",
  "file-size": "ABR 파일은 32MB 이하여야 합니다.",
  signature: "올바른 Photoshop ABR 파일을 읽지 못했습니다.",
  "unsupported-version": "이 ABR 버전은 아직 지원하지 않습니다. Photoshop에서 최신 ABR로 다시 저장해 주세요.",
  limits: "ABR 브러시나 펜촉 데이터가 안전 처리 한도를 초과했습니다.",
  parse: "ABR 브러시 데이터를 해석하지 못했습니다.",
  "no-brushes": "가져올 수 있는 브러시가 ABR 파일에 없습니다.",
  worker: "ABR 변환 워커를 시작하지 못했습니다.",
  timeout: "ABR 변환 시간이 너무 오래 걸려 중지했습니다.",
  aborted: "ABR 가져오기를 취소했습니다.",
};

export function isStudioAbrImportErrorCode(value: unknown): value is StudioAbrImportErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGES, value);
}

export class StudioAbrImportError extends Error {
  constructor(readonly code: StudioAbrImportErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioAbrImportError";
  }
}

export interface StudioAbrBrushCandidate {
  readonly name: string;
  readonly snapshot: StudioBrushSnapshot;
  readonly sourceShape: BrushShape["type"];
  readonly sourceSampleId: string | null;
  readonly approximatedFeatures: readonly string[];
}

export interface StudioAbrImportResult {
  readonly brushes: readonly StudioAbrBrushCandidate[];
  readonly sourceBrushCount: number;
  readonly sourceSampleCount: number;
  readonly skippedBrushCount: number;
  readonly approximatedBrushCount: number;
}

const SUPPORTED_ABR_VERSIONS = new Set([6, 7, 9, 10]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function cleanName(value: unknown, index: number): string {
  const source = typeof value === "string" ? value.trim() : "";
  const printable = Array.from(source)
    .filter((character) => (character.codePointAt(0) ?? 0) >= 0x20)
    .join("")
    .trim();
  return (printable || `ABR 브러시 ${index + 1}`).slice(0, STUDIO_ABR_IMPORT_LIMITS.maxNameLength);
}

function stableSeed(value: string, index: number): number {
  let hash = 0x811c9dc5 ^ index;
  for (let cursor = 0; cursor < value.length; cursor++) {
    hash ^= value.charCodeAt(cursor);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedSampleId(value: string): string {
  return value.replaceAll("\0", "").trim().toLowerCase();
}

function sampleLookup(samples: readonly SampleInfo[]): Map<string, SampleInfo> {
  const result = new Map<string, SampleInfo>();
  for (const sample of samples) {
    const key = normalizedSampleId(sample.id);
    if (key && !result.has(key)) result.set(key, sample);
  }
  return result;
}

function bilinearAlpha(
  source: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const left = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const tx = Math.max(0, Math.min(1, x - left));
  const ty = Math.max(0, Math.min(1, y - top));
  const topValue = source[top * width + left]! * (1 - tx) + source[top * width + right]! * tx;
  const bottomValue = source[bottom * width + left]! * (1 - tx) + source[bottom * width + right]! * tx;
  return Math.round(topValue * (1 - ty) + bottomValue * ty);
}

/** Convert an arbitrary rectangular ABR sample into the square compact alpha payload used by Studio. */
export function convertStudioAbrSampleToTip(sample: SampleInfo): {
  readonly alphaMapBase64: string;
  readonly alphaMapSize: number;
} {
  const { w: width, h: height } = sample.bounds;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width * height > STUDIO_ABR_IMPORT_LIMITS.maxSamplePixels
    || sample.alpha.length !== width * height
  ) {
    throw new StudioAbrImportError("limits");
  }
  const size = Math.round(clamp(
    Math.max(width, height),
    STUDIO_ABR_IMPORT_LIMITS.outputTipMin,
    STUDIO_ABR_IMPORT_LIMITS.outputTipMax
  ));
  const scale = size / Math.max(width, height);
  const drawnWidth = Math.max(1, Math.round(width * scale));
  const drawnHeight = Math.max(1, Math.round(height * scale));
  const offsetX = Math.floor((size - drawnWidth) / 2);
  const offsetY = Math.floor((size - drawnHeight) / 2);
  const alpha = new Uint8Array(size * size);
  let maximum = 0;
  let total = 0;
  for (let y = 0; y < drawnHeight; y++) {
    const sourceY = ((y + 0.5) / drawnHeight) * height - 0.5;
    for (let x = 0; x < drawnWidth; x++) {
      const sourceX = ((x + 0.5) / drawnWidth) * width - 0.5;
      const value = bilinearAlpha(sample.alpha, width, height, sourceX, sourceY);
      alpha[(offsetY + y) * size + offsetX + x] = value;
      maximum = Math.max(maximum, value);
      total += value;
    }
  }
  if (maximum < 8 || total < 32) throw new StudioAbrImportError("parse");
  return {
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alpha),
    alphaMapSize: size,
  };
}

function dynamicsSource(value: BrushDynamics["control"]): StudioBrushDynamicsSource | null {
  if (value === "pen pressure") return "pressure";
  if (value === "pen tilt") return "tilt-magnitude";
  if (value === "stylus wheel") return "tangential-pressure";
  if (value === "direction" || value === "initial direction") return "direction";
  if (value === "rotation" || value === "initial rotation") return "twist";
  return null;
}

function multiplicativeMapping(
  dynamics: BrushDynamics | undefined,
  approximated: string[]
): NormalizedStudioBrushDynamicsMapping[] {
  if (!dynamics || dynamics.control === "off") return [];
  const source = dynamicsSource(dynamics.control);
  if (!source) {
    approximated.push(`지원하지 않는 ${dynamics.control} 제어`);
    return [];
  }
  return [{
    source,
    mode: "multiply",
    from: clamp(dynamics.minimum, 0, 1),
    to: 1,
    amount: 1,
    curve: 1,
    invert: false,
  }];
}

function additiveAngleMapping(
  dynamics: BrushDynamics | undefined,
  approximated: string[]
): NormalizedStudioBrushDynamicsMapping[] {
  if (!dynamics || dynamics.control === "off") return [];
  const source = dynamicsSource(dynamics.control);
  if (!source) {
    approximated.push(`지원하지 않는 ${dynamics.control} 각도 제어`);
    return [];
  }
  return [{
    source,
    mode: "add",
    from: -180 * clamp(dynamics.jitter, 0, 1),
    to: 180 * clamp(dynamics.jitter || 1, 0, 1),
    amount: 1,
    curve: 1,
    invert: false,
  }];
}

function proceduralTipFor(shape: BrushShape): NormalizedStudioBrushDynamicsSettings["tip"] {
  const hardness = shape.type === "computed"
    ? clamp(shape.hardness, 0, 1)
    : shape.type === "tips"
      ? clamp(shape.tipsHardness, 0, 1)
      : 0.58;
  const flat = shape.type === "dynamic" || shape.type === "tips"
    ? shape.shape.startsWith("flat")
    : false;
  return {
    shape: flat ? "bristle" : hardness > 0.78 ? "hard" : hardness < 0.28 ? "soft" : "round",
    softness: 1 - hardness,
    alphaMapBase64: null,
    alphaMapSize: 24,
  };
}

function shapeSettings(
  brush: Brush,
  samples: ReadonlyMap<string, SampleInfo>,
  approximated: string[]
): {
  readonly tip: NormalizedStudioBrushDynamicsSettings["tip"];
  readonly sampleId: string | null;
} | null {
  const shape = brush.shape;
  if (shape.type === "sampled") {
    const sample = samples.get(normalizedSampleId(shape.sampledData));
    if (!sample) return null;
    try {
      const tip = convertStudioAbrSampleToTip(sample);
      return {
        tip: {
          shape: "round",
          softness: 0,
          alphaMapBase64: tip.alphaMapBase64,
          alphaMapSize: tip.alphaMapSize,
        },
        sampleId: sample.id,
      };
    } catch {
      return null;
    }
  }
  if (shape.type === "tips" && shape.tipsErodibleTipHeightMap?.length && shape.tipsGridSize) {
    const grid = Math.trunc(shape.tipsGridSize);
    if (grid > 0 && shape.tipsErodibleTipHeightMap.length === grid * grid) {
      try {
        const tip = convertStudioAbrSampleToTip({
          id: "tips-heightmap",
          bounds: { x: 0, y: 0, w: grid, h: grid },
          alpha: Uint8Array.from(shape.tipsErodibleTipHeightMap, (value) => clamp(value, 0, 255)),
        });
        return {
          tip: {
            shape: "bristle",
            softness: 1 - clamp(shape.tipsHardness, 0, 1),
            alphaMapBase64: tip.alphaMapBase64,
            alphaMapSize: tip.alphaMapSize,
          },
          sampleId: null,
        };
      } catch {
        approximated.push("침식형 펜촉 높이맵");
      }
    }
  }
  return { tip: proceduralTipFor(shape), sampleId: null };
}

function brushSnapshot(
  brush: Brush,
  name: string,
  index: number,
  tip: NormalizedStudioBrushDynamicsSettings["tip"],
  approximated: string[]
): StudioBrushSnapshot {
  const shape = brush.shape;
  const size = clamp(shape.size, 1, 80);
  const angle = clamp(shape.angle, -180, 180);
  const roundness = clamp(
    shape.type === "computed" || shape.type === "sampled"
      ? shape.roundness
      : shape.shape.startsWith("flat")
        ? 0.3
        : 1,
    0.08,
    1
  );
  const spacingRatio = clamp(shape.spacingOn ? shape.spacing : brush.spacing, 0.01, 16);
  const sizeMappings = multiplicativeMapping(brush.shapeDynamics?.sizeDynamics, approximated);
  const opacityMappings = multiplicativeMapping(
    brush.transfer?.opacityDynamics ?? brush.toolOptions?.opacityDynamics,
    approximated
  );
  const flowMappings = multiplicativeMapping(
    brush.transfer?.flowDynamics ?? brush.toolOptions?.flowDynamics,
    approximated
  );
  const angleMappings = additiveAngleMapping(brush.shapeDynamics?.angleDynamics, approximated);
  const roundnessMappings = multiplicativeMapping(brush.shapeDynamics?.roundnessDynamics, approximated);
  const scatterAmount = brush.scatter
    ? clamp(Math.max(brush.scatter.scatterDynamics.jitter, brush.scatter.countDynamics.jitter), 0, 1)
    : 0;
  const scatterMappings = brush.scatter
    ? multiplicativeMapping(brush.scatter.scatterDynamics, approximated)
    : [];
  const importedOpacity = clamp(brush.toolOptions?.opacity ?? 1, 0.05, 1);
  const importedFlow = clamp(brush.toolOptions?.flow ?? 1, 0, 1);
  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
    seed: stableSeed(name, index),
    spacingRatio,
    scatterRatio: scatterAmount > 0 ? scatterAmount * 2 : null,
    tip,
    width: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.width,
      base: size,
      mappings: sizeMappings,
    },
    opacity: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.opacity,
      base: importedOpacity,
      mappings: opacityMappings,
    },
    flow: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.flow,
      base: importedFlow,
      mappings: flowMappings,
    },
    scatter: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.scatter,
      mappings: scatterMappings,
    },
    angle: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.angle,
      base: angle,
      mappings: angleMappings,
    },
    roundness: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.roundness,
      base: roundness,
      mappings: roundnessMappings,
    },
  });
  if (brush.texture) approximated.push("Photoshop 텍스처 블렌드");
  if (brush.dualBrush) approximated.push("듀얼 브러시");
  if (brush.colorDynamics) approximated.push("색상 다이내믹스");
  if (brush.toolOptions?.type === "mixer brush") approximated.push("믹서 브러시 습윤 혼합");
  if (brush.toolOptions?.type === "smudge brush") approximated.push("스머지 브러시 혼합");
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    brushId: "ink-particle",
    strokeWidth: size,
    brushOpacity: importedOpacity,
    stabilizer: clamp((brush.toolOptions?.smoothingValue ?? 0) / 10, 0, 10),
    postCorrection: clamp((brush.toolOptions?.smooth ?? 0) / 10, 0, 10),
    tipAngle: angle,
    tipRoundness: roundness,
    brushDynamics: dynamics,
  };
}

/** Convert a parsed ABR document without DOM or worker dependencies. */
export function convertStudioAbrDocument(document: Abr): StudioAbrImportResult {
  if (!document || !Array.isArray(document.brushes) || !Array.isArray(document.samples)) {
    throw new StudioAbrImportError("parse");
  }
  if (
    document.brushes.length > STUDIO_ABR_IMPORT_LIMITS.maxBrushes
    || document.samples.length > STUDIO_ABR_IMPORT_LIMITS.maxSamples
  ) {
    throw new StudioAbrImportError("limits");
  }
  let totalSamplePixels = 0;
  for (const sample of document.samples) {
    const pixels = sample.bounds.w * sample.bounds.h;
    if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > STUDIO_ABR_IMPORT_LIMITS.maxSamplePixels) {
      throw new StudioAbrImportError("limits");
    }
    totalSamplePixels += pixels;
    if (totalSamplePixels > STUDIO_ABR_IMPORT_LIMITS.maxTotalSamplePixels) {
      throw new StudioAbrImportError("limits");
    }
  }
  const samples = sampleLookup(document.samples);
  const brushes: StudioAbrBrushCandidate[] = [];
  let skippedBrushCount = 0;
  let approximatedBrushCount = 0;
  for (let index = 0; index < document.brushes.length; index++) {
    const brush = document.brushes[index]!;
    const approximated: string[] = [];
    const shape = shapeSettings(brush, samples, approximated);
    if (!shape) {
      skippedBrushCount++;
      continue;
    }
    const name = cleanName(brush.name, index);
    const snapshot = brushSnapshot(brush, name, index, shape.tip, approximated);
    const uniqueApproximations = [...new Set(approximated)];
    if (uniqueApproximations.length > 0) approximatedBrushCount++;
    brushes.push(Object.freeze({
      name,
      snapshot,
      sourceShape: brush.shape.type,
      sourceSampleId: shape.sampleId,
      approximatedFeatures: Object.freeze(uniqueApproximations),
    }));
  }
  if (brushes.length === 0) throw new StudioAbrImportError("no-brushes");
  return Object.freeze({
    brushes: Object.freeze(brushes),
    sourceBrushCount: document.brushes.length,
    sourceSampleCount: document.samples.length,
    skippedBrushCount,
    approximatedBrushCount,
  });
}

export function assertStudioAbrEnvelope(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new StudioAbrImportError("empty");
  if (bytes.byteLength > STUDIO_ABR_IMPORT_LIMITS.maxBytes) {
    throw new StudioAbrImportError("file-size");
  }
  if (bytes.byteLength < 4) throw new StudioAbrImportError("signature");
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, false);
  if (version === 1 || version === 2) throw new StudioAbrImportError("unsupported-version");
  if (!SUPPORTED_ABR_VERSIONS.has(version)) throw new StudioAbrImportError("signature");
}

/** `ag-psd` stays outside the Studio eager graph and is loaded only inside the ABR worker/fallback. */
export async function parseStudioAbrBuffer(bytes: ArrayBuffer): Promise<StudioAbrImportResult> {
  const view = new Uint8Array(bytes);
  assertStudioAbrEnvelope(view);
  try {
    const { readAbr } = await import("ag-psd");
    return convertStudioAbrDocument(readAbr(view, { logMissingFeatures: false }));
  } catch (error) {
    if (error instanceof StudioAbrImportError) throw error;
    throw new StudioAbrImportError("parse", { cause: error });
  }
}

export function studioAbrImportErrorMessage(error: unknown): string {
  return error instanceof StudioAbrImportError
    ? error.message
    : ERROR_MESSAGES.parse;
}
