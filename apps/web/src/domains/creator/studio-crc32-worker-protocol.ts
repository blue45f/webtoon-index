export const STUDIO_CRC32_WORKER_PROTOCOL_VERSION = 1 as const;

/** Matches the package writer's hard per-entry browser budget. */
export const STUDIO_CRC32_WORKER_MAX_BYTES = 256_000_000;

export interface StudioCrc32WorkerRunMessage {
  type: "studio-crc32/run";
  version: typeof STUDIO_CRC32_WORKER_PROTOCOL_VERSION;
  requestId: number;
  data: Uint8Array;
}

export interface StudioCrc32WorkerReadyMessage {
  type: "studio-crc32/ready";
  version: typeof STUDIO_CRC32_WORKER_PROTOCOL_VERSION;
}

export interface StudioCrc32WorkerSuccessMessage {
  type: "studio-crc32/success";
  version: typeof STUDIO_CRC32_WORKER_PROTOCOL_VERSION;
  requestId: number;
  crc32: number;
  /** Ownership returns to the caller so archive assembly can reuse the source without copying. */
  data: Uint8Array;
}

export interface StudioCrc32WorkerFailureMessage {
  type: "studio-crc32/failure";
  version: typeof STUDIO_CRC32_WORKER_PROTOCOL_VERSION;
  requestId: number;
  error: {
    name: string;
    message: string;
  };
}

export type StudioCrc32WorkerResponseMessage =
  | StudioCrc32WorkerReadyMessage
  | StudioCrc32WorkerSuccessMessage
  | StudioCrc32WorkerFailureMessage;

export function studioCrc32RunTransfers(
  message: StudioCrc32WorkerRunMessage,
): Transferable[] {
  const buffer = message.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

export function studioCrc32SuccessTransfers(
  message: StudioCrc32WorkerSuccessMessage,
): Transferable[] {
  const buffer = message.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
