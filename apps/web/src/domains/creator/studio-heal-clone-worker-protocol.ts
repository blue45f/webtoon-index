import type { StudioImageDataLike } from "./studio-filters";
import type { HealCloneDab, HealCloneMode } from "./studio-heal-clone";

export const STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioHealCloneWorkerRunRequest {
  /** source footprint의 frozen 픽셀. dab.srcX/srcY는 이 버퍼의 로컬 좌표다. */
  readonly src: StudioImageDataLike;
  /** destination footprint의 원본 픽셀. dab.destX/destY는 이 버퍼의 독립 로컬 좌표다. */
  readonly dst: StudioImageDataLike;
  readonly dabs: readonly HealCloneDab[];
  readonly radiusPx: number;
  readonly hardness: number;
  readonly opacity: number;
  readonly mode: HealCloneMode;
}

export interface StudioHealCloneWorkerRunMessage {
  type: "studio-heal-clone/run";
  version: typeof STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION;
  request: StudioHealCloneWorkerRunRequest;
}

export interface StudioHealCloneWorkerSuccessMessage {
  type: "studio-heal-clone/success";
  version: typeof STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION;
  dst: StudioImageDataLike;
}

export interface StudioHealCloneWorkerReadyMessage {
  type: "studio-heal-clone/ready";
  version: typeof STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION;
}

export interface StudioHealCloneWorkerFailureMessage {
  type: "studio-heal-clone/failure";
  version: typeof STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioHealCloneWorkerResponseMessage =
  | StudioHealCloneWorkerReadyMessage
  | StudioHealCloneWorkerSuccessMessage
  | StudioHealCloneWorkerFailureMessage;

export function assertStudioHealCloneImageData(
  value: unknown,
  label: string,
): asserts value is StudioImageDataLike {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label}가 올바른 픽셀 버퍼가 아닙니다.`);
  }
  const image = value as Partial<StudioImageDataLike>;
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${label} 픽셀이 Uint8ClampedArray가 아닙니다.`);
  }
  if (
    !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width! <= 0
    || image.height! <= 0
    || !Number.isSafeInteger(image.width! * image.height! * 4)
    || image.data.byteLength !== image.width! * image.height! * 4
  ) {
    throw new RangeError(`${label} 크기와 픽셀 버퍼 길이가 일치하지 않습니다.`);
  }
}

export function assertStudioHealCloneWorkerRequest(
  value: unknown,
): asserts value is StudioHealCloneWorkerRunRequest {
  if (!value || typeof value !== "object") {
    throw new TypeError("복구 브러시 Worker 요청이 올바르지 않습니다.");
  }
  const request = value as Partial<StudioHealCloneWorkerRunRequest>;
  assertStudioHealCloneImageData(request.src, "복구 브러시 source");
  assertStudioHealCloneImageData(request.dst, "복구 브러시 destination");
  if (!Array.isArray(request.dabs)) {
    throw new TypeError("복구 브러시 dab 목록이 올바르지 않습니다.");
  }
  for (const dab of request.dabs) {
    if (
      !dab
      || typeof dab !== "object"
      || !Number.isFinite(dab.srcX)
      || !Number.isFinite(dab.srcY)
      || !Number.isFinite(dab.destX)
      || !Number.isFinite(dab.destY)
    ) {
      throw new TypeError("복구 브러시 dab 좌표가 올바르지 않습니다.");
    }
  }
  if (!Number.isFinite(request.radiusPx) || request.radiusPx! <= 0) {
    throw new RangeError("복구 브러시 반경이 올바르지 않습니다.");
  }
  if (
    !Number.isFinite(request.hardness)
    || request.hardness! < 0
    || request.hardness! > 1
    || !Number.isFinite(request.opacity)
    || request.opacity! < 0
    || request.opacity! > 1
  ) {
    throw new RangeError("복구 브러시 경도 또는 불투명도가 올바르지 않습니다.");
  }
  if (request.mode !== "heal" && request.mode !== "clone") {
    throw new TypeError("복구 브러시 모드가 올바르지 않습니다.");
  }
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
export function studioHealCloneRequestTransfers(message: StudioHealCloneWorkerRunMessage): Transferable[] {
  return uniqueArrayBufferTransfers([message.request.src.data.buffer, message.request.dst.data.buffer]);
}

export function studioHealCloneSuccessTransfers(message: StudioHealCloneWorkerSuccessMessage): Transferable[] {
  return uniqueArrayBufferTransfers([message.dst.data.buffer]);
}
