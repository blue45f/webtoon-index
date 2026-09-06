import type { StudioImageDataLike } from "./studio-filters";
import type { Outline } from "./studio-outline";

export const STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION = 1 as const;

/**
 * The EDT keeps two Float64 surfaces in addition to RGBA pixels. 16 MiP is already
 * roughly 336 MiB of live Worker memory at peak, so larger interactive requests
 * fail closed instead of risking a tab-wide OOM.
 */
export const STUDIO_OUTLINE_WORKER_MAX_PIXELS = 16 * 1024 * 1024;

export interface StudioOutlineWorkerRunRequest {
  readonly imageData: StudioImageDataLike;
  readonly outline: Outline;
}

export interface StudioOutlineWorkerRunMessage {
  type: "studio-outline/run";
  version: typeof STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  epoch: number;
  request: StudioOutlineWorkerRunRequest;
}

export interface StudioOutlineWorkerReadyMessage {
  type: "studio-outline/ready";
  version: typeof STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION;
}

export interface StudioOutlineWorkerSuccessMessage {
  type: "studio-outline/success";
  version: typeof STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  epoch: number;
  imageData: StudioImageDataLike;
}

export interface StudioOutlineWorkerFailureMessage {
  type: "studio-outline/failure";
  version: typeof STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  epoch: number;
  error: {
    readonly name: string;
    readonly message: string;
  };
}

export type StudioOutlineWorkerRequestMessage = StudioOutlineWorkerRunMessage;
export type StudioOutlineWorkerResponseMessage =
  | StudioOutlineWorkerReadyMessage
  | StudioOutlineWorkerSuccessMessage
  | StudioOutlineWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertStudioOutlineEpoch(value: unknown, label = "외곽선 Worker epoch"): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
  }
}

export function assertStudioOutlineImageData(
  value: unknown,
  label = "외곽선 Worker 입력",
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
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_OUTLINE_WORKER_MAX_PIXELS
  ) {
    throw new RangeError(`${label} 크기가 안전 한도를 초과했습니다.`);
  }
  if (data.byteLength !== pixelCount * 4) {
    throw new RangeError(`${label} 픽셀 버퍼 길이가 가로·세로 크기와 일치하지 않습니다.`);
  }
}

function uniqueArrayBufferTransfer(
  view: { readonly buffer: ArrayBufferLike },
): Transferable[] {
  return view.buffer instanceof ArrayBuffer ? [view.buffer] : [];
}

export function studioOutlineRequestTransfers(
  message: StudioOutlineWorkerRunMessage,
): Transferable[] {
  return uniqueArrayBufferTransfer(message.request.imageData.data);
}

export function studioOutlineSuccessTransfers(
  message: StudioOutlineWorkerSuccessMessage,
): Transferable[] {
  return uniqueArrayBufferTransfer(message.imageData.data);
}
