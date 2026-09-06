import type { SmudgePixelPoint } from "./studio-smudge";

export const STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioSmudgeWorkerRunRequest {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  readonly points: readonly SmudgePixelPoint[];
  readonly radiusPx: number;
  readonly strength: number;
}

export interface StudioSmudgeWorkerRunMessage {
  type: "studio-smudge/run";
  version: typeof STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION;
  request: StudioSmudgeWorkerRunRequest;
}

export interface StudioSmudgeWorkerSuccessMessage {
  type: "studio-smudge/success";
  version: typeof STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION;
  data: Uint8ClampedArray;
}

export interface StudioSmudgeWorkerReadyMessage {
  type: "studio-smudge/ready";
  version: typeof STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION;
}

export interface StudioSmudgeWorkerFailureMessage {
  type: "studio-smudge/failure";
  version: typeof STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioSmudgeWorkerResponseMessage =
  | StudioSmudgeWorkerReadyMessage
  | StudioSmudgeWorkerSuccessMessage
  | StudioSmudgeWorkerFailureMessage;

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

export function studioSmudgeRequestTransfers(message: StudioSmudgeWorkerRunMessage): Transferable[] {
  return uniqueArrayBufferTransfers([message.request.data.buffer]);
}

export function studioSmudgeSuccessTransfers(message: StudioSmudgeWorkerSuccessMessage): Transferable[] {
  return uniqueArrayBufferTransfers([message.data.buffer]);
}
