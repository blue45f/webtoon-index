
import {
  isStudioDynamicBrushMinimumDiameterRatio,
  studioDynamicBrushDepositPipelineUsesContinuation,
} from "../brush/studio-brush-dynamics";
import { serializeStudioBrushR8TextureGrainSourceCanonical } from "../brush/studio-brush-r8-grain-asset-contract";
import {
  isStudioInkPressureModel,
  studioInkFallbackPressure,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";
import { isStudioStrokePaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH,
  STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH,
  normalizeStudioBrushCatalogIdentityMetadata,
} from "../studio-element-model";
import {
  isStudioMaterialMinimumDiameterRatio,
  isStudioMaterialPressureModel,
} from "../studio-material-pressure-model";
import { normalizeStudioOutlineStrokeContract } from "../studio-outline-stroke-contract";

import {
  BASE_SAMPLE_ARRAY_KEYS,
  EXTENDED_INK_SAMPLE_ARRAY_KEYS,
  JSON_PAYLOAD_KEYS,
  MAX_COORDINATE,
  MAX_STROKE_WIDTH,
  STUDIO_CRDT_METADATA_MAX_BYTES,
  STUDIO_CRDT_STROKE_MAX_SAMPLES,
  TEXT_ENCODER,
} from "./studio-crdt-document-constants";
import {
  assertFiniteRange,
  cloneJsonObject,
  exactText,
  readJsonObject,
  readNumber,
  readString,
  yArray,
} from "./studio-crdt-document-helpers";
import {
  OPTIONAL_STRING_PAYLOAD_KEYS,
  SAMPLE_ARRAY_KEYS,
  type StudioCrdtDrawStrokePayload,
  type StudioCrdtSampleArrayKey,
  type StudioCrdtStringPayloadKey,
  type StudioCrdtStrokePayloadKey,
  type StudioCrdtStrokeSamples,
} from "./studio-crdt-document-types";
import {
  STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
} from "./studio-crdt-protocol";

import type { StudioCrdtJsonObject } from "./studio-crdt-scene-schema";
import type * as Y from "yjs";

import {
  STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
  STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
  isStudioInkInputContractV2,
  normalizeStudioInkInputContract,
} from "@/shared/lib/studio-ink-input-contract";

export function payloadMetadataByteLength(payload: StudioCrdtDrawStrokePayload): number {
  const metadata: Record<string, unknown> = {
    version: payload.version,
    type: payload.type,
    kind: payload.kind,
    mode: payload.mode,
    stroke: payload.stroke,
    strokeWidth: payload.strokeWidth,
  };
  if (payload.opacity !== undefined) metadata.opacity = payload.opacity;
  if (payload.sampleSpacing !== undefined) metadata.sampleSpacing = payload.sampleSpacing;
  for (const key of OPTIONAL_STRING_PAYLOAD_KEYS) {
    if (payload[key] !== undefined) metadata[key] = payload[key];
  }
  for (const key of JSON_PAYLOAD_KEYS) {
    if (payload[key] !== undefined) metadata[key] = payload[key];
  }
  return TEXT_ENCODER.encode(JSON.stringify(metadata)).byteLength;
}

export function sampleCount(
  samples: StudioCrdtStrokeSamples,
  allowEmpty: boolean,
  requireExtendedInkChannels = false,
  requireZeroTimeOrigin = false,
): number {
  if (
    !Array.isArray(samples.points) ||
    samples.points.length % 2 !== 0 ||
    (!allowEmpty && samples.points.length === 0)
  ) {
    throw new Error("획 좌표는 x/y가 정렬된 쌍이어야 합니다.");
  }
  const count = samples.points.length / 2;
  if (count > STUDIO_CRDT_STROKE_MAX_SAMPLES) throw new Error("획 샘플 수가 너무 많습니다.");
  for (const coordinate of samples.points) {
    assertFiniteRange(coordinate, -MAX_COORDINATE, MAX_COORDINATE, "획 좌표");
  }
  const aligned = [
    samples.pressures,
    samples.tiltXs,
    samples.tiltYs,
    samples.twists,
    samples.speeds,
    samples.tangentialPressures,
    samples.altitudeAngles,
    samples.azimuthAngles,
    samples.contactWidths,
    samples.contactHeights,
    samples.sampleTimeOffsets,
  ];
  for (const values of aligned) {
    if (values !== undefined && (!Array.isArray(values) || values.length !== count)) {
      throw new Error("획 포인터 메타데이터가 좌표 샘플과 정렬되지 않았습니다.");
    }
  }
  for (const pressure of samples.pressures ?? []) assertFiniteRange(pressure, 0, 1, "필압");
  for (const tilt of samples.tiltXs ?? []) assertFiniteRange(tilt, -90, 90, "가로 틸트");
  for (const tilt of samples.tiltYs ?? []) assertFiniteRange(tilt, -90, 90, "세로 틸트");
  for (const twist of samples.twists ?? []) assertFiniteRange(twist, 0, 359, "펜 회전");
  for (const speed of samples.speeds ?? []) assertFiniteRange(speed, 0, 1_000_000, "포인터 속도");
  for (const pressure of samples.tangentialPressures ?? []) {
    assertFiniteRange(pressure, -1, 1, "배럴 압력");
  }
  if (
    requireExtendedInkChannels
    && EXTENDED_INK_SAMPLE_ARRAY_KEYS.some((key) => samples[key] === undefined)
  ) {
    throw new Error("v2 획 입력 센서 채널이 누락되었습니다.");
  }
  for (const angle of samples.altitudeAngles ?? []) {
    assertFiniteRange(angle, 0, Math.PI / 2, "펜 고도각");
  }
  for (const angle of samples.azimuthAngles ?? []) {
    if (
      typeof angle !== "number"
      || !Number.isFinite(angle)
      || angle < 0
      || angle >= Math.PI * 2
    ) {
      throw new Error("펜 방위각 값이 올바르지 않습니다.");
    }
  }
  for (const dimension of [
    ...(samples.contactWidths ?? []),
    ...(samples.contactHeights ?? []),
  ]) {
    assertFiniteRange(
      dimension,
      0,
      STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
      "포인터 접촉 크기",
    );
  }
  let previousTimeOffset = -1;
  for (const timeOffset of samples.sampleTimeOffsets ?? []) {
    assertFiniteRange(
      timeOffset,
      0,
      STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
      "획 상대 시간",
    );
    if (timeOffset < previousTimeOffset) {
      throw new Error("획 상대 시간이 역행했습니다.");
    }
    previousTimeOffset = timeOffset;
  }
  if (
    requireZeroTimeOrigin
    && count > 0
    && samples.sampleTimeOffsets?.[0] !== 0
  ) {
    throw new Error("획 상대 시간은 포인터 시작의 0ms에서 시작해야 합니다.");
  }
  return count;
}

export function normalizedSamples(
  samples: StudioCrdtStrokeSamples,
  allowEmpty: boolean,
  storedPressureModel?: StudioInkPressureModel,
  requireExtendedInkChannels?: boolean,
) {
  const extensions = "extensions" in samples && samples.extensions
    && typeof samples.extensions === "object"
    && !Array.isArray(samples.extensions)
    ? samples.extensions
    : undefined;
  const pressureModelValue = extensions && "pressureModel" in extensions
    ? extensions.pressureModel
    : undefined;
  const pressureModel = storedPressureModel ?? (isStudioInkPressureModel(pressureModelValue)
    ? pressureModelValue
    : undefined);
  const embeddedInkContract = normalizeStudioInkInputContract(
    extensions && "inkInput" in extensions ? extensions.inkInput : undefined,
  );
  const embeddedV2 = isStudioInkInputContractV2(embeddedInkContract);
  const requireExtended = requireExtendedInkChannels ?? embeddedV2;
  const count = sampleCount(
    samples,
    allowEmpty,
    requireExtended,
    embeddedV2,
  );
  return {
    points: [...samples.points],
    pressures: [
      ...(samples.pressures ?? Array<number>(count).fill(studioInkFallbackPressure(pressureModel))),
    ],
    tiltXs: [...(samples.tiltXs ?? Array<number>(count).fill(0))],
    tiltYs: [...(samples.tiltYs ?? Array<number>(count).fill(0))],
    twists: [...(samples.twists ?? Array<number>(count).fill(0))],
    speeds: [...(samples.speeds ?? Array<number>(count).fill(0))],
    tangentialPressures: [
      ...(samples.tangentialPressures ?? Array<number>(count).fill(0)),
    ],
    altitudeAngles: samples.altitudeAngles
      ? [...samples.altitudeAngles]
      : requireExtended
        ? Array<number>(count).fill(Math.PI / 2)
        : undefined,
    azimuthAngles: samples.azimuthAngles
      ? [...samples.azimuthAngles]
      : requireExtended
        ? Array<number>(count).fill(0)
        : undefined,
    contactWidths: samples.contactWidths
      ? [...samples.contactWidths]
      : requireExtended
        ? Array<number>(count).fill(1)
        : undefined,
    contactHeights: samples.contactHeights
      ? [...samples.contactHeights]
      : requireExtended
        ? Array<number>(count).fill(1)
        : undefined,
    sampleTimeOffsets: samples.sampleTimeOffsets
      ? [...samples.sampleTimeOffsets]
      : requireExtended
        ? Array<number>(count).fill(0)
        : undefined,
  };
}

export function hasCanonicalRendererSignificantR8Grain(
  brushDynamics: StudioCrdtJsonObject | undefined,
): boolean {
  if (!brushDynamics) return false;
  let grainDescriptor: PropertyDescriptor | undefined;
  try {
    grainDescriptor = Object.getOwnPropertyDescriptor(brushDynamics, "grain");
  } catch {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  if (!grainDescriptor) return false;
  if (!("value" in grainDescriptor) || grainDescriptor.enumerable !== true) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  const grain = grainDescriptor.value;
  if (!grain || typeof grain !== "object" || Array.isArray(grain)) return false;
  let sourceDescriptor: PropertyDescriptor | undefined;
  try {
    sourceDescriptor = Object.getOwnPropertyDescriptor(grain, "source");
  } catch {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  if (!sourceDescriptor) return false;
  if (!("value" in sourceDescriptor) || sourceDescriptor.enumerable !== true) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  const source = sourceDescriptor.value;
  if (source == null) return false;
  const canonical = serializeStudioBrushR8TextureGrainSourceCanonical(source);
  if (canonical === null || canonical !== JSON.stringify(source)) {
    throw new Error("R8 브러시 그레인 자산 참조가 올바르지 않습니다.");
  }
  return true;
}

export function validatePayload(payload: StudioCrdtDrawStrokePayload, allowEmpty: boolean): void {
  if (
    (payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
      && payload.version !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
      && payload.version !== STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION
      && payload.version !== STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION)
    || payload.type !== "draw"
  ) {
    throw new Error("지원하지 않는 획 페이로드 버전입니다.");
  }
  if (!exactText(payload.kind, 80)) throw new Error("획 종류가 올바르지 않습니다.");
  if (payload.mode !== "pen" && payload.mode !== "eraser") {
    throw new Error("획 합성 모드가 올바르지 않습니다.");
  }
  if (!exactText(payload.stroke, 256)) throw new Error("획 색상이 올바르지 않습니다.");
  assertFiniteRange(payload.strokeWidth, 0.01, MAX_STROKE_WIDTH, "획 굵기");
  if (payload.opacity !== undefined) assertFiniteRange(payload.opacity, 0, 1, "불투명도");
  if (payload.sampleSpacing !== undefined) {
    // Zero is the intentional fixed-rate contract: the 5 ms input filter already owns thinning,
    // so the renderer must not apply a second distance gate. Undefined still identifies legacy
    // geometry; a finite zero therefore cannot be normalized away or rejected at the wire edge.
    assertFiniteRange(payload.sampleSpacing, 0, MAX_STROKE_WIDTH, "샘플 간격");
  }
  for (const key of OPTIONAL_STRING_PAYLOAD_KEYS) {
    const value = payload[key];
    const maximum = key === "brushCatalogId"
      ? STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH
      : key === "brushCatalogName"
        ? STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH
        : 512;
    if (value !== undefined && !exactText(value, maximum)) {
      throw new Error(`${key} 값이 올바르지 않습니다.`);
    }
  }
  const normalizedCatalogIdentity = normalizeStudioBrushCatalogIdentityMetadata(payload);
  if (
    normalizedCatalogIdentity.brushCatalogId !== payload.brushCatalogId
    || normalizedCatalogIdentity.brushCatalogName !== payload.brushCatalogName
  ) {
    throw new Error("브러시 카탈로그 식별 정보가 올바르지 않습니다.");
  }
  const usesR8TextureGrain =
    hasCanonicalRendererSignificantR8Grain(payload.brushDynamics);
  for (const key of JSON_PAYLOAD_KEYS) {
    const value = payload[key];
    if (value !== undefined) cloneJsonObject(value);
  }
  const dynamicMinimumDiameterRatio =
    payload.brushDynamics?.minimumDiameterRatio;
  if (
    dynamicMinimumDiameterRatio !== undefined
    && (
      (
        payload.version !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
        && payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
      )
      || !isStudioDynamicBrushMinimumDiameterRatio(
        dynamicMinimumDiameterRatio,
      )
    )
  ) {
    throw new Error("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다.");
  }
  if (
    studioDynamicBrushDepositPipelineUsesContinuation(
      payload.brushDynamics?.depositPipeline,
    )
    && payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) {
    throw new Error("분할 연속 브러시 파이프라인과 페이로드 버전이 호환되지 않습니다.");
  }
  if (
    usesR8TextureGrain
    && payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) {
    throw new Error("R8 브러시 그레인과 페이로드 버전이 호환되지 않습니다.");
  }
  const outlineStroke = payload.extensions?.outlineStroke;
  if (outlineStroke !== undefined) {
    if (payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION) {
      throw new Error("외곽선 획 계약과 페이로드 버전이 호환되지 않습니다.");
    }
    const normalizedOutlineStroke = normalizeStudioOutlineStrokeContract(outlineStroke);
    if (!normalizedOutlineStroke) {
      throw new Error("외곽선 획 계약이 올바르지 않습니다.");
    }
  }
  const inkInput = payload.extensions?.inkInput;
  const normalizedInkInput = inkInput === undefined
    ? null
    : normalizeStudioInkInputContract(inkInput);
  if (
    inkInput !== undefined
    && normalizedInkInput === null
  ) {
    throw new Error("획 입력 센서 계약이 올바르지 않습니다.");
  }
  const paintModel = payload.extensions?.paintModel;
  if (
    paintModel !== undefined
    && (
      (
        payload.version !== STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION
        && payload.version !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
        && payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
      )
      || !isStudioStrokePaintModelCompatible({
        ...payload,
        paintModel,
        pressureModel: payload.extensions?.pressureModel,
        stampPipeline: payload.extensions?.stampPipeline,
        watercolorPipeline: payload.extensions?.watercolorPipeline,
      })
    )
  ) {
    throw new Error("획 페인트 모델과 브러시 합성 모드가 호환되지 않습니다.");
  }
  const materialPressureModel = payload.extensions?.materialPressureModel;
  const materialMinimumDiameterRatio =
    payload.extensions?.materialMinimumDiameterRatio;
  const hasMaterialPressureSnapshot =
    materialPressureModel !== undefined
    || materialMinimumDiameterRatio !== undefined;
  if (
    hasMaterialPressureSnapshot
    && payload.version !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
    && payload.version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) {
    throw new Error("획 재질 필압 모델과 페이로드 버전이 호환되지 않습니다.");
  }
  if (
    hasMaterialPressureSnapshot
    && !isStudioMaterialPressureModel(materialPressureModel)
  ) {
    throw new Error("획 재질 필압 모델이 올바르지 않습니다.");
  }
  if (
    hasMaterialPressureSnapshot
    && !isStudioMaterialMinimumDiameterRatio(materialMinimumDiameterRatio)
  ) {
    throw new Error("획 재질 최소 굵기 스냅샷이 올바르지 않습니다.");
  }
  if (payloadMetadataByteLength(payload) > STUDIO_CRDT_METADATA_MAX_BYTES) {
    throw new Error(
      "획 메타데이터가 실시간 동기화 한도를 초과했습니다. 큰 마스크와 자산은 외부 참조로 저장해 주세요."
    );
  }
  const requiresExtendedInkChannels =
    isStudioInkInputContractV2(normalizedInkInput);
  sampleCount(
    payload,
    allowEmpty,
    requiresExtendedInkChannels,
    requiresExtendedInkChannels,
  );
}

export function setOptionalRecordValue(
  record: Y.Map<unknown>,
  key: StudioCrdtStringPayloadKey | "opacity" | "sampleSpacing",
  value: string | number | undefined
): void {
  if (value === undefined) record.delete(key);
  else record.set(key, value);
}

export function setPayloadMetadata(record: Y.Map<unknown>, payload: StudioCrdtDrawStrokePayload): void {
  record.set("payloadVersion", payload.version);
  record.set("type", payload.type);
  record.set("kind", payload.kind);
  record.set("mode", payload.mode);
  record.set("stroke", payload.stroke);
  record.set("strokeWidth", payload.strokeWidth);
  setOptionalRecordValue(record, "opacity", payload.opacity);
  setOptionalRecordValue(record, "sampleSpacing", payload.sampleSpacing);
  for (const key of OPTIONAL_STRING_PAYLOAD_KEYS) setOptionalRecordValue(record, key, payload[key]);
  for (const key of JSON_PAYLOAD_KEYS) {
    const value = payload[key];
    if (value === undefined) record.delete(key);
    else record.set(key, cloneJsonObject(value));
  }
}

export function setPayloadMetadataField(
  record: Y.Map<unknown>,
  payload: StudioCrdtDrawStrokePayload,
  key: Exclude<StudioCrdtStrokePayloadKey, StudioCrdtSampleArrayKey>
): void {
  if (key === "version") record.set("payloadVersion", payload.version);
  else if (key === "type") record.set("type", payload.type);
  else if (key === "kind") record.set("kind", payload.kind);
  else if (key === "mode") record.set("mode", payload.mode);
  else if (key === "stroke") record.set("stroke", payload.stroke);
  else if (key === "strokeWidth") record.set("strokeWidth", payload.strokeWidth);
  else if (key === "opacity" || key === "sampleSpacing") {
    setOptionalRecordValue(record, key, payload[key]);
  } else if ((OPTIONAL_STRING_PAYLOAD_KEYS as readonly string[]).includes(key)) {
    const stringKey = key as StudioCrdtStringPayloadKey;
    setOptionalRecordValue(record, stringKey, payload[stringKey]);
  } else {
    const jsonKey = key as (typeof JSON_PAYLOAD_KEYS)[number];
    const value = payload[jsonKey];
    if (value === undefined) record.delete(jsonKey);
    else record.set(jsonKey, cloneJsonObject(value));
  }
}

export function mergeStrokePayloadFields(
  current: StudioCrdtDrawStrokePayload,
  next: StudioCrdtDrawStrokePayload,
  changedKeys: readonly StudioCrdtStrokePayloadKey[]
): StudioCrdtDrawStrokePayload {
  const merged = { ...current } as Record<string, unknown>;
  for (const key of changedKeys) {
    const value = next[key];
    if (value === undefined) {
      delete merged[key];
    } else if (Array.isArray(value)) {
      merged[key] = [...value];
    } else if (value !== null && typeof value === "object") {
      merged[key] = cloneJsonObject(value as StudioCrdtJsonObject);
    } else {
      merged[key] = value;
    }
  }
  return merged as unknown as StudioCrdtDrawStrokePayload;
}

export function readPayload(record: Y.Map<unknown>): StudioCrdtDrawStrokePayload | null {
  const version = record.get("payloadVersion");
  const type = record.get("type");
  const kind = readString(record, "kind");
  const mode = record.get("mode");
  const stroke = readString(record, "stroke");
  const strokeWidth = readNumber(record, "strokeWidth");
  const sharedArrays = Object.fromEntries(
    SAMPLE_ARRAY_KEYS.map((key) => [key, yArray(record, key)])
  ) as Record<StudioCrdtSampleArrayKey, Y.Array<number> | null>;
  const pointsLength = sharedArrays.points?.length ?? -1;
  const count = pointsLength / 2;
  if (
    (version !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
      && version !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
      && version !== STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION
      && version !== STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION) ||
    type !== "draw" ||
    !kind ||
    (mode !== "pen" && mode !== "eraser") ||
    !stroke ||
    strokeWidth === null ||
    BASE_SAMPLE_ARRAY_KEYS.some((key) => sharedArrays[key] === null) ||
    pointsLength < 0 ||
    pointsLength % 2 !== 0 ||
    count > STUDIO_CRDT_STROKE_MAX_SAMPLES ||
    BASE_SAMPLE_ARRAY_KEYS.slice(1).some(
      (key) => sharedArrays[key]!.length !== count,
    )
    || EXTENDED_INK_SAMPLE_ARRAY_KEYS.some(
      (key) => sharedArrays[key] !== null && sharedArrays[key]!.length !== count,
    )
  ) {
    return null;
  }
  const arrays = Object.fromEntries(
    SAMPLE_ARRAY_KEYS.flatMap((key) => {
      const shared = sharedArrays[key];
      return shared ? [[key, shared.toArray()]] : [];
    }),
  ) as Partial<Record<StudioCrdtSampleArrayKey, number[]>>;
  const payload: StudioCrdtDrawStrokePayload = {
    version,
    type,
    kind,
    mode,
    stroke,
    strokeWidth,
    points: arrays.points!,
    pressures: arrays.pressures!,
    tiltXs: arrays.tiltXs!,
    tiltYs: arrays.tiltYs!,
    twists: arrays.twists!,
    speeds: arrays.speeds!,
    tangentialPressures: arrays.tangentialPressures!,
  };
  for (const key of EXTENDED_INK_SAMPLE_ARRAY_KEYS) {
    const values = arrays[key];
    if (values !== undefined) Object.assign(payload, { [key]: values });
  }
  const opacity = readNumber(record, "opacity");
  const sampleSpacing = readNumber(record, "sampleSpacing");
  if (opacity !== null) payload.opacity = opacity;
  if (sampleSpacing !== null) payload.sampleSpacing = sampleSpacing;
  for (const key of OPTIONAL_STRING_PAYLOAD_KEYS) {
    const value = readString(record, key);
    if (value !== null) payload[key] = value;
  }
  for (const key of JSON_PAYLOAD_KEYS) {
    const value = readJsonObject(record, key);
    if (value !== undefined) payload[key] = value;
  }
  try {
    validatePayload(payload, true);
    return payload;
  } catch {
    return null;
  }
}
