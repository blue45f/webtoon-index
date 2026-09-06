import type { MagicWandRegion } from "./studio-magic-wand";

export const STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioMagicWandWorkerRunRequest {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  readonly startX: number;
  readonly startY: number;
  readonly tolerance: number;
}

export interface StudioMagicWandWorkerRunMessage {
  type: "studio-magic-wand/run";
  version: typeof STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION;
  request: StudioMagicWandWorkerRunRequest;
}

export interface StudioMagicWandWorkerSuccessMessage {
  type: "studio-magic-wand/success";
  version: typeof STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION;
  region: MagicWandRegion;
}

export interface StudioMagicWandWorkerReadyMessage {
  type: "studio-magic-wand/ready";
  version: typeof STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION;
}

export interface StudioMagicWandWorkerFailureMessage {
  type: "studio-magic-wand/failure";
  version: typeof STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioMagicWandWorkerResponseMessage =
  | StudioMagicWandWorkerReadyMessage
  | StudioMagicWandWorkerSuccessMessage
  | StudioMagicWandWorkerFailureMessage;

/** 픽셀 버퍼는 편도 전송(worker→메인 응답은 폴리곤뿐이라 되돌려 보낼 버퍼가 없다). */
export function studioMagicWandRequestTransfers(message: StudioMagicWandWorkerRunMessage): Transferable[] {
  const buffer = message.request.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
