import { admitStudioBg3dShotPsdLayers } from "./studio-bg3d-shot-psd-contract";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

export const STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION = 1;

export interface StudioBg3dShotPsdWorkerRequest {
  readonly version: typeof STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION;
  readonly kind: "build";
  readonly requestId: number;
  readonly layers: readonly StudioBg3dLtRasterLayer[];
}

export type StudioBg3dShotPsdWorkerResponse =
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION;
      readonly kind: "result";
      readonly requestId: number;
      readonly psd: Blob;
    }
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION;
      readonly kind: "error";
      readonly requestId: number;
      readonly code: "build-failed" | "protocol";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isStudioBg3dShotPsdWorkerRequest(
  value: unknown,
): value is StudioBg3dShotPsdWorkerRequest {
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) => ["version", "kind", "requestId", "layers"].includes(key)) &&
    value.version === STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION &&
    value.kind === "build" &&
    validRequestId(value.requestId) &&
    Array.isArray(value.layers) &&
    admitStudioBg3dShotPsdLayers(value.layers as StudioBg3dLtRasterLayer[]).ok;
}

export function isStudioBg3dShotPsdWorkerResponse(
  value: unknown,
): value is StudioBg3dShotPsdWorkerResponse {
  if (
    !isRecord(value) ||
    value.version !== STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION ||
    !validRequestId(value.requestId)
  ) return false;
  if (value.kind === "result") {
    return Object.keys(value).every((key) => ["version", "kind", "requestId", "psd"].includes(key)) &&
      value.psd instanceof Blob;
  }
  return value.kind === "error" &&
    Object.keys(value).every((key) => ["version", "kind", "requestId", "code"].includes(key)) &&
    (value.code === "build-failed" || value.code === "protocol");
}
