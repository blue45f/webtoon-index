import {
  isStudioDynamicBrushMinimumDiameterRatio,
  studioDynamicBrushDepositPipelineUsesContinuation,
} from "../brush/studio-brush-dynamics";
import { normalizeStudioBrushR8TextureGrainSource } from "../brush/studio-brush-r8-grain-asset-contract";
import {
  isStudioInkPressureModel,
  studioInkFallbackPressure,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";
import {
  isStudioPaperSubstrateModel,
  type StudioPaperSubstrateModel,
} from "../brush/studio-paper-substrate-model";
import {
  isStudioStrokePaintModel,
  isStudioStrokePaintModelCompatible,
  type StudioStrokePaintModel,
} from "../brush/studio-stroke-paint-model";
import { normalizeStudioBrushCatalogIdentityMetadata } from "../studio-element-model";
import {
  isStudioMaterialMinimumDiameterRatio,
  isStudioMaterialPressureModel,
  type StudioMaterialMinimumDiameterRatio,
  type StudioMaterialPressureModel,
} from "../studio-material-pressure-model";
import {
  normalizeStudioOutlineStrokeContract,
  type StudioOutlineStrokeContractV1,
} from "../studio-outline-stroke-contract";

import {
  STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
} from "./studio-crdt-protocol";

import type {
  StudioCrdtDrawStrokePayload,
  StudioCrdtJsonObject,
  StudioCrdtJsonValue,
  StudioCrdtStrokeInput,
  StudioCrdtStrokeSamples,
} from "./studio-crdt-document";

import {
  STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
  STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
  isStudioInkInputContractV2,
  normalizeStudioInkInputContract,
  type StudioInkInputContract,
} from "@/shared/lib/studio-ink-input-contract";

export interface StudioCrdtCompatibleDrawElement {
  id: string;
  type: "draw";
  kind?: string;
  mode?: "pen" | "eraser";
  points: number[];
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  paintModel?: StudioStrokePaintModel;
  fill?: string;
  gradient?: unknown;
  pattern?: unknown;
  brush?: string;
  brushCatalogId?: string;
  brushCatalogName?: string;
  pressures?: number[];
  inkInput?: StudioInkInputContract;
  pressureModel?: StudioInkPressureModel;
  paperModel?: StudioPaperSubstrateModel;
  outlineStroke?: StudioOutlineStrokeContractV1;
  materialPressureModel?: StudioMaterialPressureModel;
  materialMinimumDiameterRatio?: StudioMaterialMinimumDiameterRatio;
  sampleSpacing?: number;
  tiltXs?: number[];
  tiltYs?: number[];
  twists?: number[];
  speeds?: number[];
  tangentialPressures?: number[];
  altitudeAngles?: number[];
  azimuthAngles?: number[];
  contactWidths?: number[];
  contactHeights?: number[];
  sampleTimeOffsets?: number[];
  brushDynamics?: unknown;
  brushTip?: unknown;
  stamp?: unknown;
  stampPipeline?: "causal-walker-v2";
  watercolorPipeline?: "causal-walker-v2";
  strokeStyle?: unknown;
  shapeParams?: unknown;
  sketch?: unknown;
  symmetry?: unknown;
  blendMode?: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  noClip?: boolean;
  lockAspect?: boolean;
  groupId?: string;
  clipBelow?: boolean;
  alphaLocked?: boolean;
  maskSrc?: string;
  maskEnabled?: boolean;
  layerRole?: string;
  layerColor?: string;
  emeresSourceId?: string;
}

const EXTENSION_KEYS = [
  // 스탬프 브러시 튜닝(flow/hardness/minSize) — 확장 봉투로 무손실 왕복한다.
  "stamp",
  "stampPipeline",
  "watercolorPipeline",
  "name",
  "hidden",
  "locked",
  "noClip",
  "lockAspect",
  "groupId",
  "clipBelow",
  "alphaLocked",
  "maskSrc",
  "maskEnabled",
  "layerRole",
  "layerColor",
  "emeresSourceId",
] as const;

function jsonValue(value: unknown): StudioCrdtJsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: StudioCrdtJsonValue[] = [];
    for (const item of value) {
      const normalized = jsonValue(item);
      if (normalized === undefined) return undefined;
      result.push(normalized);
    }
    return result;
  }
  if (!value || typeof value !== "object") return undefined;
  const result: StudioCrdtJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = jsonValue(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function jsonObject(value: unknown): StudioCrdtJsonObject | undefined {
  const normalized = jsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized
    : undefined;
}

function dynamicMinimumDiameterRatioOf(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { minimumDiameterRatio?: unknown }).minimumDiameterRatio
    : undefined;
}

function ownDataProperty(
  value: unknown,
  key: string,
): { present: false } | { present: true; value: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { present: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { present: false };
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
    return { present: true, value: descriptor.value };
  } catch {
    return null;
  }
}

function normalizeRendererSignificantR8GrainSource(
  brushDynamics: unknown,
): StudioCrdtJsonObject | null {
  const grainProperty = ownDataProperty(brushDynamics, "grain");
  if (grainProperty === null) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  if (!grainProperty.present) return null;
  const sourceProperty = ownDataProperty(grainProperty.value, "source");
  if (sourceProperty === null) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  if (!sourceProperty.present || sourceProperty.value == null) return null;
  const normalized = normalizeStudioBrushR8TextureGrainSource(sourceProperty.value);
  if (!normalized) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  return jsonObject(normalized)!;
}

function aligned(values: number[] | undefined, count: number, fallback: number): number[] | undefined {
  if (!values) return undefined;
  return Array.from({ length: count }, (_, index) => {
    const value = values[index];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  });
}

function assertStudioInkV2AlignedChannels(
  element: StudioCrdtCompatibleDrawElement,
  sampleCount: number,
): void {
  if (!isStudioInkInputContractV2(element.inkInput)) return;
  const channels = [
    ["altitudeAngles", element.altitudeAngles, 0, Math.PI / 2],
    ["azimuthAngles", element.azimuthAngles, 0, Math.PI * 2],
    [
      "contactWidths",
      element.contactWidths,
      0,
      STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
    ],
    [
      "contactHeights",
      element.contactHeights,
      0,
      STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
    ],
    [
      "sampleTimeOffsets",
      element.sampleTimeOffsets,
      0,
      STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
    ],
  ] as const;
  for (const [name, values, minimum, maximum] of channels) {
    if (!Array.isArray(values) || values.length !== sampleCount) {
      throw new Error(`${name} 채널이 획 좌표와 정렬되지 않았습니다.`);
    }
    for (const value of values) {
      const upperBoundValid = name === "azimuthAngles"
        ? value < maximum
        : value <= maximum;
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < minimum
        || !upperBoundValid
      ) {
        throw new Error(`${name} 채널 범위가 올바르지 않습니다.`);
      }
    }
  }
  if (element.sampleTimeOffsets?.[0] !== 0) {
    throw new Error("획 상대 시간은 포인터 시작의 0ms에서 시작해야 합니다.");
  }
  for (let index = 1; index < sampleCount; index += 1) {
    if (element.sampleTimeOffsets[index]! < element.sampleTimeOffsets[index - 1]!) {
      throw new Error("획 상대 시간이 역행했습니다.");
    }
  }
}

/**
 * Aligns only the append suffix that is about to enter the CRDT. Long in-progress strokes call
 * this for every pointer batch, so aligning the complete history here would turn streaming into
 * quadratic work even though the CRDT consumes only samples after `start`.
 */
function alignedSlice(
  values: number[] | undefined,
  count: number,
  start: number,
  fallback: number
): number[] | undefined {
  if (!values) return undefined;
  const result = new Array<number>(count - start);
  for (let sourceIndex = start, resultIndex = 0; sourceIndex < count; sourceIndex += 1) {
    const value = values[sourceIndex];
    result[resultIndex] = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    resultIndex += 1;
  }
  return result;
}

function extensionsOf(element: StudioCrdtCompatibleDrawElement): StudioCrdtJsonObject | undefined {
  const extensions: StudioCrdtJsonObject = {};
  for (const key of EXTENSION_KEYS) {
    const normalized = jsonValue(element[key]);
    if (normalized !== undefined) extensions[key] = normalized;
  }
  // Keep this versioned opt-in out of the generic JSON whitelist: an unknown future string must
  // never be persisted as if this client knew how to render its pressure semantics.
  if (isStudioInkPressureModel(element.pressureModel)) {
    extensions.pressureModel = element.pressureModel;
  }
  // 같은 이유로 종이 substrate 세대도 화이트리스트 밖에서 직접 검증한다. 협업 상대가 이 키를
  // 떨어뜨리면 그 획만 조용히 레거시 valley-multiply로 강등되어 두 클라이언트가 다른 그림을 본다.
  if (isStudioPaperSubstrateModel(element.paperModel)) {
    extensions.paperModel = element.paperModel;
  }
  if (element.outlineStroke !== undefined) {
    const outlineStroke = normalizeStudioOutlineStrokeContract(element.outlineStroke);
    if (!outlineStroke) {
      throw new Error("외곽선 획 계약이 올바르지 않습니다.");
    }
    extensions.outlineStroke = jsonObject(outlineStroke)!;
  }
  if (element.inkInput !== undefined) {
    const inkInput = normalizeStudioInkInputContract(element.inkInput);
    if (!inkInput) {
      throw new Error("획 입력 센서 계약이 올바르지 않습니다.");
    }
    extensions.inkInput = jsonObject(inkInput)!;
  }
  const materialPressureModel = element.materialPressureModel;
  const materialMinimumDiameterRatio = element.materialMinimumDiameterRatio;
  const hasMaterialPressureSnapshot =
    materialPressureModel !== undefined
    || materialMinimumDiameterRatio !== undefined;
  if (hasMaterialPressureSnapshot) {
    if (!isStudioMaterialPressureModel(materialPressureModel)) {
      throw new Error("획 재질 필압 모델이 올바르지 않습니다.");
    }
    if (!isStudioMaterialMinimumDiameterRatio(materialMinimumDiameterRatio)) {
      throw new Error("획 재질 최소 굵기 스냅샷이 올바르지 않습니다.");
    }
    extensions.materialPressureModel = materialPressureModel;
    extensions.materialMinimumDiameterRatio = materialMinimumDiameterRatio;
  }
  // Stroke alpha semantics are versioned just like pressure geometry. Unknown future values must
  // never enter the shared document through the generic JSON extension whitelist.
  if (isStudioStrokePaintModelCompatible(element)) {
    extensions.paintModel = element.paintModel;
  }
  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

export function studioDrawElementToCrdtStroke(
  pageId: string,
  element: StudioCrdtCompatibleDrawElement
): StudioCrdtStrokeInput {
  if (
    isStudioStrokePaintModel(element.paintModel)
    && !isStudioStrokePaintModelCompatible(element)
  ) {
    throw new Error("획 페인트 모델과 브러시 합성 모드가 호환되지 않습니다.");
  }
  const sampleCount = Math.floor(element.points.length / 2);
  assertStudioInkV2AlignedChannels(element, sampleCount);
  const pressureFallback = studioInkFallbackPressure(element.pressureModel);
  const pressures = element.pressures === undefined
    && isStudioInkPressureModel(element.pressureModel)
    ? Array<number>(sampleCount).fill(pressureFallback)
    : aligned(element.pressures, sampleCount, pressureFallback);
  const extensions = extensionsOf(element);
  const brushCatalogIdentity = normalizeStudioBrushCatalogIdentityMetadata(element);
  const r8TextureGrain =
    normalizeRendererSignificantR8GrainSource(element.brushDynamics);
  const brushDynamics = jsonObject(element.brushDynamics);
  if (r8TextureGrain) {
    const grain = brushDynamics?.grain;
    if (!grain || typeof grain !== "object" || Array.isArray(grain)) {
      throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
    }
    grain.source = r8TextureGrain;
  }
  const usesR8TextureGrain = r8TextureGrain !== null;
  const dynamicMinimumDiameterRatio =
    dynamicMinimumDiameterRatioOf(element.brushDynamics);
  const usesSegmentedCausalDeposit =
    studioDynamicBrushDepositPipelineUsesContinuation(
      brushDynamics?.depositPipeline,
    );
  if (
    dynamicMinimumDiameterRatio !== undefined
    && !isStudioDynamicBrushMinimumDiameterRatio(dynamicMinimumDiameterRatio)
  ) {
    throw new Error("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다.");
  }
  // Keep ordinary strokes on v1 so long-open v1 collaborators continue to render them. Only
  // renderer-significant layered paint requires v2; material/dynamic geometry snapshots require
  // v3, while segmented causal continuation and immutable R8 grain require v4.
  const payloadVersion = usesSegmentedCausalDeposit
    || usesR8TextureGrain
    || extensions?.outlineStroke !== undefined
    ? STUDIO_CRDT_STROKE_PAYLOAD_VERSION
    : extensions?.materialPressureModel !== undefined
      || dynamicMinimumDiameterRatio !== undefined
      || brushDynamics !== undefined
      ? STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
      : extensions?.paintModel !== undefined
        ? STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION
        : STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION;
  const payload: StudioCrdtDrawStrokePayload = {
    version: payloadVersion,
    type: "draw",
    kind: element.kind ?? "freehand",
    mode: element.mode ?? "pen",
    points: element.points.slice(0, sampleCount * 2),
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
  };
  Object.assign(payload, {
    pressures,
    tiltXs: aligned(element.tiltXs, sampleCount, 0),
    tiltYs: aligned(element.tiltYs, sampleCount, 0),
    twists: aligned(element.twists, sampleCount, 0),
    speeds: aligned(element.speeds, sampleCount, 0),
    tangentialPressures: aligned(element.tangentialPressures, sampleCount, 0),
    ...(element.altitudeAngles
      ? { altitudeAngles: aligned(element.altitudeAngles, sampleCount, Math.PI / 2) }
      : {}),
    ...(element.azimuthAngles
      ? { azimuthAngles: aligned(element.azimuthAngles, sampleCount, 0) }
      : {}),
    ...(element.contactWidths
      ? { contactWidths: aligned(element.contactWidths, sampleCount, 1) }
      : {}),
    ...(element.contactHeights
      ? { contactHeights: aligned(element.contactHeights, sampleCount, 1) }
      : {}),
    ...(element.sampleTimeOffsets
      ? { sampleTimeOffsets: aligned(element.sampleTimeOffsets, sampleCount, 0) }
      : {}),
  });
  if (element.opacity !== undefined) payload.opacity = element.opacity;
  if (element.fill !== undefined) payload.fill = element.fill;
  if (element.brush !== undefined) payload.brush = element.brush;
  Object.assign(payload, brushCatalogIdentity);
  if (element.sampleSpacing !== undefined) payload.sampleSpacing = element.sampleSpacing;
  if (element.blendMode !== undefined) payload.blendMode = element.blendMode;
  payload.gradient = jsonObject(element.gradient);
  payload.pattern = jsonObject(element.pattern);
  payload.brushDynamics = brushDynamics;
  payload.brushTip = jsonObject(element.brushTip);
  payload.strokeStyle = jsonObject(element.strokeStyle);
  payload.shapeParams = jsonObject(element.shapeParams);
  payload.sketch = jsonObject(element.sketch);
  payload.symmetry = jsonObject(element.symmetry);
  payload.extensions = extensions;
  return {
    id: element.id,
    pageId,
    layerId: element.groupId ?? "page-root",
    payload,
  };
}

export function studioDrawElementSampleSlice(
  element: StudioCrdtCompatibleDrawElement,
  startSample: number
): StudioCrdtStrokeSamples | null {
  const sampleCount = Math.floor(element.points.length / 2);
  const truncatedStart = Math.trunc(startSample);
  const start = Number.isNaN(truncatedStart)
    ? 0
    : Math.max(0, Math.min(sampleCount, truncatedStart));
  if (start >= sampleCount) return null;
  const pressureFallback = studioInkFallbackPressure(element.pressureModel);
  assertStudioInkV2AlignedChannels(element, sampleCount);
  const pressures = element.pressures === undefined
    && isStudioInkPressureModel(element.pressureModel)
    ? Array<number>(sampleCount - start).fill(pressureFallback)
    : alignedSlice(element.pressures, sampleCount, start, pressureFallback);
  return {
    points: element.points.slice(start * 2, sampleCount * 2),
    pressures,
    tiltXs: alignedSlice(element.tiltXs, sampleCount, start, 0),
    tiltYs: alignedSlice(element.tiltYs, sampleCount, start, 0),
    twists: alignedSlice(element.twists, sampleCount, start, 0),
    speeds: alignedSlice(element.speeds, sampleCount, start, 0),
    tangentialPressures: alignedSlice(element.tangentialPressures, sampleCount, start, 0),
    ...(element.altitudeAngles
      ? {
          altitudeAngles: alignedSlice(
            element.altitudeAngles,
            sampleCount,
            start,
            Math.PI / 2,
          ),
        }
      : {}),
    ...(element.azimuthAngles
      ? { azimuthAngles: alignedSlice(element.azimuthAngles, sampleCount, start, 0) }
      : {}),
    ...(element.contactWidths
      ? { contactWidths: alignedSlice(element.contactWidths, sampleCount, start, 1) }
      : {}),
    ...(element.contactHeights
      ? { contactHeights: alignedSlice(element.contactHeights, sampleCount, start, 1) }
      : {}),
    ...(element.sampleTimeOffsets
      ? {
          sampleTimeOffsets: alignedSlice(
            element.sampleTimeOffsets,
            sampleCount,
            start,
            0,
          ),
        }
      : {}),
  };
}
