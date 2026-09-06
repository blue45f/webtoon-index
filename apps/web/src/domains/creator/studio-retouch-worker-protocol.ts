import type {
  WetMixPixelPoint,
  WetMixSettings,
} from "./brush/studio-wet-mix";
import type {
  DodgeBurnPixelPoint,
  DodgeBurnSettings,
} from "./studio-dodge-burn";

export const STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_RETOUCH_MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
export const STUDIO_RETOUCH_DIRECT_MAX_IMAGE_PIXELS = 4 * 1024 * 1024;
export const STUDIO_RETOUCH_MAX_INPUT_POINTS = 8_192;

interface StudioRetouchWorkerRasterRequest {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
}

export interface StudioRetouchWorkerDodgeBurnRequest
  extends StudioRetouchWorkerRasterRequest {
  readonly kind: "dodge-burn";
  readonly points: readonly DodgeBurnPixelPoint[];
  readonly settings: DodgeBurnSettings;
}

export interface StudioRetouchWorkerWetMixRequest
  extends StudioRetouchWorkerRasterRequest {
  readonly kind: "wet-mix";
  readonly points: readonly WetMixPixelPoint[];
  readonly settings: WetMixSettings;
}

export type StudioRetouchWorkerRunRequest =
  | StudioRetouchWorkerDodgeBurnRequest
  | StudioRetouchWorkerWetMixRequest;

export interface StudioRetouchWorkerRunMessage {
  readonly type: "studio-retouch/run";
  readonly version: typeof STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION;
  readonly request: StudioRetouchWorkerRunRequest;
}

export interface StudioRetouchWorkerReadyMessage {
  readonly type: "studio-retouch/ready";
  readonly version: typeof STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION;
}

export interface StudioRetouchWorkerSuccessMessage {
  readonly type: "studio-retouch/success";
  readonly version: typeof STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION;
  readonly kind: StudioRetouchWorkerRunRequest["kind"];
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
}

export interface StudioRetouchWorkerFailureMessage {
  readonly type: "studio-retouch/failure";
  readonly version: typeof STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION;
  readonly error: Readonly<{
    name: string;
    message: string;
  }>;
}

export type StudioRetouchWorkerResponseMessage =
  | StudioRetouchWorkerReadyMessage
  | StudioRetouchWorkerSuccessMessage
  | StudioRetouchWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} 값이 올바르지 않습니다.`);
  }
}

function assertUnitInterval(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} 값은 0 이상 1 이하여야 합니다.`);
  }
}

function assertPoints(value: unknown): void {
  if (!Array.isArray(value) || value.length > STUDIO_RETOUCH_MAX_INPUT_POINTS) {
    throw new RangeError("리터치 스트로크 점 수가 안전 한도를 초과했습니다.");
  }
  for (const point of value) {
    if (!isRecord(point)) throw new TypeError("리터치 스트로크 좌표가 올바르지 않습니다.");
    assertFiniteNumber(point.x, "리터치 스트로크 x 좌표");
    assertFiniteNumber(point.y, "리터치 스트로크 y 좌표");
  }
}

function assertDodgeBurnSettings(value: unknown): asserts value is DodgeBurnSettings {
  if (!isRecord(value)) throw new TypeError("닷지/번 설정이 올바르지 않습니다.");
  assertFiniteNumber(value.radiusPx, "닷지/번 반경");
  if (value.radiusPx <= 0) throw new RangeError("닷지/번 반경은 0보다 커야 합니다.");
  assertUnitInterval(value.hardness, "닷지/번 경도");
  assertFiniteNumber(value.exposure, "닷지/번 노출");
  if (value.exposure < 0 || value.exposure > 100) {
    throw new RangeError("닷지/번 노출은 0 이상 100 이하여야 합니다.");
  }
  if (value.mode !== "dodge" && value.mode !== "burn" && value.mode !== "sponge") {
    throw new TypeError("닷지/번 모드가 올바르지 않습니다.");
  }
  if (
    value.range !== "shadows"
    && value.range !== "midtones"
    && value.range !== "highlights"
  ) {
    throw new TypeError("닷지/번 톤 범위가 올바르지 않습니다.");
  }
  if (value.sponge !== "saturate" && value.sponge !== "desaturate") {
    throw new TypeError("스펀지 모드가 올바르지 않습니다.");
  }
}

function assertWetMixSettings(value: unknown): asserts value is WetMixSettings {
  if (!isRecord(value)) throw new TypeError("혼색 설정이 올바르지 않습니다.");
  assertFiniteNumber(value.radiusPx, "혼색 반경");
  if (value.radiusPx <= 0) throw new RangeError("혼색 반경은 0보다 커야 합니다.");
  assertUnitInterval(value.hardness, "혼색 경도");
  assertUnitInterval(value.strength, "혼색 도포량");
  assertUnitInterval(value.wetness, "혼색률");
  assertUnitInterval(value.pickup, "혼색 묻힘률");
  if (value.loadDepletion !== undefined) {
    assertUnitInterval(value.loadDepletion, "혼색 로드 고갈");
  }
  if (value.initialLoad !== undefined) {
    assertUnitInterval(value.initialLoad, "혼색 초기 로드");
  }
  if (
    value.mixModel !== undefined
    && value.mixModel !== "lerp"
    && value.mixModel !== "spectral-wgm"
  ) {
    throw new TypeError("혼색 모델이 올바르지 않습니다.");
  }
  if (!isRecord(value.paintColor)) throw new TypeError("혼색 안료 색상이 올바르지 않습니다.");
  for (const channel of ["r", "g", "b"] as const) {
    assertFiniteNumber(value.paintColor[channel], `혼색 안료 ${channel}`);
    if (value.paintColor[channel] < 0 || value.paintColor[channel] > 255) {
      throw new RangeError("혼색 안료 채널은 0 이상 255 이하여야 합니다.");
    }
  }
}

export function assertStudioRetouchWorkerRequest(
  value: unknown,
): asserts value is StudioRetouchWorkerRunRequest {
  if (!isRecord(value)) throw new TypeError("리터치 Worker 요청이 올바르지 않습니다.");
  const { data, w, h, points, settings } = value;
  if (!(data instanceof Uint8ClampedArray)) {
    throw new TypeError("리터치 픽셀 버퍼는 Uint8ClampedArray여야 합니다.");
  }
  if (
    typeof w !== "number"
    || typeof h !== "number"
    || !Number.isSafeInteger(w)
    || !Number.isSafeInteger(h)
    || w <= 0
    || h <= 0
  ) {
    throw new RangeError("리터치 이미지 크기는 1 이상의 정수여야 합니다.");
  }
  const pixels = w * h;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_RETOUCH_MAX_IMAGE_PIXELS) {
    throw new RangeError("리터치 이미지가 Worker 안전 한도를 초과했습니다.");
  }
  if (data.byteLength !== pixels * 4) {
    throw new RangeError("리터치 픽셀 버퍼 길이가 이미지 크기와 일치하지 않습니다.");
  }
  assertPoints(points);
  if (value.kind === "dodge-burn") {
    assertDodgeBurnSettings(settings);
    return;
  }
  if (value.kind === "wet-mix") {
    assertWetMixSettings(settings);
    return;
  }
  throw new TypeError("지원하지 않는 리터치 Worker 작업입니다.");
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

export function studioRetouchRequestTransfers(
  message: StudioRetouchWorkerRunMessage,
): Transferable[] {
  return uniqueArrayBufferTransfers([message.request.data.buffer]);
}

export function studioRetouchSuccessTransfers(
  message: StudioRetouchWorkerSuccessMessage,
): Transferable[] {
  return uniqueArrayBufferTransfers([message.data.buffer]);
}
