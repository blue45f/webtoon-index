import {
  LIQUIFY_MAX_FIELD_CELLS,
  LIQUIFY_MAX_INPUT_POINTS,
  STUDIO_LIQUIFY_MODES,
  type StudioLiquifyBrushDynamics,
  type StudioLiquifyMode,
} from "./studio-liquify-contract";

import type { StudioImageDataLike } from "./studio-filters";
import type {
  LiquifyDisplacementField,
  LiquifyImageRegion,
  LiquifyPixelPoint,
} from "./studio-liquify";

export const STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_LIQUIFY_MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

export interface StudioLiquifyWorkerFieldRunRequest {
  /** 변위 계산의 색 소스(frozen) — 워커에서 읽기만 한다. */
  readonly src: StudioImageDataLike;
  /** src와 동일 픽셀로 미리 채워진 작업 버퍼(work) — 워커가 변위 적용 결과로 덮어써 돌려준다. */
  readonly dst: StudioImageDataLike;
  /** 생략하면 src/dst가 전체 이미지다. 지정하면 두 버퍼는 같은 전역 crop을 나타낸다. */
  readonly region?: LiquifyImageRegion;
  readonly field: LiquifyDisplacementField;
}

export type StudioLiquifyWorkerStrokeOptions = StudioLiquifyBrushDynamics & {
  readonly mode?: StudioLiquifyMode;
};

export interface StudioLiquifyWorkerStrokePlan {
  readonly points: readonly LiquifyPixelPoint[];
  readonly radiusPx: number;
  readonly strength: number;
  readonly options?: StudioLiquifyWorkerStrokeOptions;
}

/**
 * 스트로크 입력을 그대로 Worker로 넘긴다. 필드 생성은 대형 브러시에서 적용 자체보다 더 비쌀 수
 * 있으므로 이 요청의 build→apply 전체가 Worker 안에서 실행되어야 한다.
 */
export interface StudioLiquifyWorkerStrokeRunRequest {
  readonly src: StudioImageDataLike;
  readonly dst: StudioImageDataLike;
  /** stroke/field 좌표는 region과 무관하게 전체 canvas 좌표를 유지한다. */
  readonly region?: LiquifyImageRegion;
  readonly stroke: StudioLiquifyWorkerStrokePlan;
}

/** 기존 Reconstruct/Smooth용 field 요청과 일반 브러시 stroke 요청을 모두 유지한다. */
export type StudioLiquifyWorkerRunRequest =
  | StudioLiquifyWorkerFieldRunRequest
  | StudioLiquifyWorkerStrokeRunRequest;

export interface StudioLiquifyWorkerRunMessage {
  type: "studio-liquify/run";
  version: typeof STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION;
  request: StudioLiquifyWorkerRunRequest;
}

export interface StudioLiquifyWorkerSuccessMessage {
  type: "studio-liquify/success";
  version: typeof STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION;
  /** false면 유효한 변위 필드가 만들어지지 않아 dst가 원본 그대로임을 뜻한다. */
  applied: boolean;
  dst: StudioImageDataLike;
}

export interface StudioLiquifyWorkerReadyMessage {
  type: "studio-liquify/ready";
  version: typeof STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION;
}

export interface StudioLiquifyWorkerFailureMessage {
  type: "studio-liquify/failure";
  version: typeof STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioLiquifyWorkerResponseMessage =
  | StudioLiquifyWorkerReadyMessage
  | StudioLiquifyWorkerSuccessMessage
  | StudioLiquifyWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertStudioLiquifyImageData(
  value: unknown,
  label: string,
): asserts value is StudioImageDataLike {
  if (!isRecord(value)) throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  const { data, width, height } = value;
  if (!(data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${label} 픽셀 버퍼는 Uint8ClampedArray여야 합니다.`);
  }
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError(`${label} 크기는 1 이상의 정수여야 합니다.`);
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_LIQUIFY_MAX_IMAGE_PIXELS) {
    throw new RangeError(`${label} 크기가 안전 한도를 초과했습니다.`);
  }
  if (data.byteLength !== pixels * 4) {
    throw new RangeError(`${label} 픽셀 버퍼 길이가 가로·세로 크기와 일치하지 않습니다.`);
  }
}

export function assertStudioLiquifyField(
  value: unknown,
  label = "리퀴파이 변위 필드",
): asserts value is LiquifyDisplacementField {
  if (!isRecord(value)) throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  const { originX, originY, width, height, dx, dy } = value;
  if (
    typeof originX !== "number"
    || typeof originY !== "number"
    || !Number.isSafeInteger(originX)
    || !Number.isSafeInteger(originY)
    || typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError(`${label} 좌표와 크기가 올바르지 않습니다.`);
  }
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells > LIQUIFY_MAX_FIELD_CELLS) {
    throw new RangeError(`${label} 크기가 안전 한도를 초과했습니다.`);
  }
  if (!(dx instanceof Float32Array) || !(dy instanceof Float32Array)) {
    throw new TypeError(`${label} 버퍼는 Float32Array여야 합니다.`);
  }
  if (dx.length !== cells || dy.length !== cells) {
    throw new RangeError(`${label} 버퍼 길이가 필드 크기와 일치하지 않습니다.`);
  }
}

function assertOptionalFiniteNumber(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`${label} 값은 유한한 숫자여야 합니다.`);
  }
}

function assertStudioLiquifyStroke(
  value: unknown,
): asserts value is StudioLiquifyWorkerStrokePlan {
  if (!isRecord(value)) throw new TypeError("리퀴파이 스트로크 형식이 올바르지 않습니다.");
  const { points, radiusPx, strength, options } = value;
  if (!Array.isArray(points) || points.length > LIQUIFY_MAX_INPUT_POINTS) {
    throw new RangeError("리퀴파이 스트로크 점 개수가 안전 한도를 초과했습니다.");
  }
  for (const point of points) {
    if (
      !isRecord(point)
      || typeof point.x !== "number"
      || !Number.isFinite(point.x)
      || typeof point.y !== "number"
      || !Number.isFinite(point.y)
      || (
        point.pressure !== undefined
        && (typeof point.pressure !== "number" || !Number.isFinite(point.pressure))
      )
    ) {
      throw new TypeError("리퀴파이 스트로크 점 좌표가 올바르지 않습니다.");
    }
  }
  if (typeof radiusPx !== "number" || !Number.isFinite(radiusPx)) {
    throw new TypeError("리퀴파이 브러시 반경은 유한한 숫자여야 합니다.");
  }
  if (typeof strength !== "number" || !Number.isFinite(strength)) {
    throw new TypeError("리퀴파이 강도는 유한한 숫자여야 합니다.");
  }
  if (options === undefined) return;
  if (!isRecord(options)) throw new TypeError("리퀴파이 스트로크 옵션 형식이 올바르지 않습니다.");
  if (
    options.mode !== undefined
    && (
      typeof options.mode !== "string"
      || !(STUDIO_LIQUIFY_MODES as readonly string[]).includes(options.mode)
    )
  ) {
    throw new TypeError("리퀴파이 모드가 올바르지 않습니다.");
  }
  assertOptionalFiniteNumber(options.hardness, "리퀴파이 경도");
  assertOptionalFiniteNumber(options.minimumRadiusRatio, "리퀴파이 최소 반경");
  assertOptionalFiniteNumber(options.stabilizer, "리퀴파이 안정화");
  assertOptionalFiniteNumber(options.spacingRatio, "리퀴파이 간격");
  if (
    options.pressureAffectsRadius !== undefined
    && typeof options.pressureAffectsRadius !== "boolean"
  ) {
    throw new TypeError("리퀴파이 압력 반경 옵션이 올바르지 않습니다.");
  }
  if (
    options.pressureAffectsStrength !== undefined
    && typeof options.pressureAffectsStrength !== "boolean"
  ) {
    throw new TypeError("리퀴파이 압력 강도 옵션이 올바르지 않습니다.");
  }
}

export function assertStudioLiquifyRequest(
  value: unknown,
): asserts value is StudioLiquifyWorkerRunRequest {
  if (!isRecord(value)) throw new TypeError("리퀴파이 요청 형식이 올바르지 않습니다.");
  assertStudioLiquifyImageData(value.src, "리퀴파이 원본");
  assertStudioLiquifyImageData(value.dst, "리퀴파이 결과");
  if (value.src.width !== value.dst.width || value.src.height !== value.dst.height) {
    throw new RangeError("리퀴파이 원본과 결과 크기가 일치하지 않습니다.");
  }
  if (value.region !== undefined) {
    const region = value.region;
    if (
      !isRecord(region)
      || !Number.isSafeInteger(region.originX)
      || !Number.isSafeInteger(region.originY)
      || !Number.isSafeInteger(region.canvasWidth)
      || !Number.isSafeInteger(region.canvasHeight)
      || (region.originX as number) < 0
      || (region.originY as number) < 0
      || (region.canvasWidth as number) <= 0
      || (region.canvasHeight as number) <= 0
      || (region.originX as number) + value.src.width > (region.canvasWidth as number)
      || (region.originY as number) + value.src.height > (region.canvasHeight as number)
    ) {
      throw new RangeError("리퀴파이 ROI가 전체 이미지 경계를 벗어났습니다.");
    }
  }
  if ("stroke" in value) {
    assertStudioLiquifyStroke(value.stroke);
    return;
  }
  assertStudioLiquifyField(value.field);
}

function uniqueArrayBufferTransfers(buffers: readonly ArrayBufferLike[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const transfers: Transferable[] = [];
  for (const buffer of buffers) {
    if (!(buffer instanceof ArrayBuffer) || seen.has(buffer)) continue;
    seen.add(buffer);
    transfers.push(buffer);
  }
  return transfers;
}

/** src는 다시 쓰지 않으므로(putImageData는 dst만 소비) 두 버퍼 모두 편도 전송한다. */
export function studioLiquifyRequestTransfers(message: StudioLiquifyWorkerRunMessage): Transferable[] {
  const buffers: ArrayBufferLike[] = [
    message.request.src.data.buffer,
    message.request.dst.data.buffer,
  ];
  if ("field" in message.request) {
    buffers.push(message.request.field.dx.buffer, message.request.field.dy.buffer);
  }
  return uniqueArrayBufferTransfers(buffers);
}

export function studioLiquifySuccessTransfers(message: StudioLiquifyWorkerSuccessMessage): Transferable[] {
  return uniqueArrayBufferTransfers([message.dst.data.buffer]);
}
