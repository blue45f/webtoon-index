import type {
  StudioAbrImportErrorCode,
  StudioAbrImportResult,
} from "./studio-abr-import";

export const STUDIO_ABR_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioAbrWorkerRequest {
  readonly version: typeof STUDIO_ABR_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
}

export type StudioAbrWorkerResponse =
  | {
      readonly version: typeof STUDIO_ABR_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: true;
      readonly result: StudioAbrImportResult;
    }
  | {
      readonly version: typeof STUDIO_ABR_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: false;
      readonly code: StudioAbrImportErrorCode;
    };
