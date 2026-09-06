import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS,
  isStudioBg3dShotContactSheetImageList,
  isStudioBg3dShotContactSheetLayoutOptions,
  isStudioBg3dShotContactSheetResult,
  type StudioBg3dShotContactSheetImage,
  type StudioBg3dShotContactSheetLayoutOptions,
  type StudioBg3dShotContactSheetProgress,
  type StudioBg3dShotContactSheetResult,
} from "./studio-bg3d-shot-contact-sheet-contract";

export const STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION = 1;

export interface StudioBg3dShotContactSheetWorkerRequest {
  readonly version: typeof STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION;
  readonly kind: "build";
  readonly requestId: number;
  readonly images: readonly StudioBg3dShotContactSheetImage[];
  readonly layout?: StudioBg3dShotContactSheetLayoutOptions;
}

export type StudioBg3dShotContactSheetWorkerResponse =
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION;
      readonly kind: "progress";
      readonly requestId: number;
      readonly progress: StudioBg3dShotContactSheetProgress;
    }
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION;
      readonly kind: "result";
      readonly requestId: number;
      readonly result: StudioBg3dShotContactSheetResult;
    }
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION;
      readonly kind: "error";
      readonly requestId: number;
      readonly code: "protocol" | "unsupported-runtime" | "build-failed";
    };

const REQUEST_KEYS = ["version", "kind", "requestId", "images", "layout"] as const;
const RESPONSE_BASE_KEYS = ["version", "kind", "requestId"] as const;
const PROGRESS_KEYS = ["completedShots", "totalShots", "completedSheets", "totalSheets"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isProgress(value: unknown): value is StudioBg3dShotContactSheetProgress {
  if (!isRecord(value) || !hasOnlyKeys(value, PROGRESS_KEYS)) return false;
  return Number.isSafeInteger(value.completedShots) &&
    Number.isSafeInteger(value.totalShots) &&
    Number.isSafeInteger(value.completedSheets) &&
    Number.isSafeInteger(value.totalSheets) &&
    (value.totalShots as number) >= 1 &&
    (value.totalShots as number) <= STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS &&
    (value.completedShots as number) >= 0 &&
    (value.completedShots as number) <= (value.totalShots as number) &&
    (value.totalSheets as number) >= 1 &&
    (value.totalSheets as number) <= STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS &&
    (value.completedSheets as number) >= 0 &&
    (value.completedSheets as number) <= (value.totalSheets as number);
}

export function isStudioBg3dShotContactSheetWorkerRequest(
  value: unknown,
): value is StudioBg3dShotContactSheetWorkerRequest {
  return isRecord(value) &&
    hasOnlyKeys(value, REQUEST_KEYS) &&
    value.version === STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION &&
    value.kind === "build" &&
    isRequestId(value.requestId) &&
    isStudioBg3dShotContactSheetImageList(value.images) &&
    isStudioBg3dShotContactSheetLayoutOptions(value.layout);
}

export function isStudioBg3dShotContactSheetWorkerResponse(
  value: unknown,
): value is StudioBg3dShotContactSheetWorkerResponse {
  if (
    !isRecord(value) ||
    value.version !== STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    !RESPONSE_BASE_KEYS.every((key) => key in value)
  ) {
    return false;
  }
  if (value.kind === "progress") {
    return hasOnlyKeys(value, [...RESPONSE_BASE_KEYS, "progress"]) && isProgress(value.progress);
  }
  if (value.kind === "result") {
    return hasOnlyKeys(value, [...RESPONSE_BASE_KEYS, "result"]) &&
      isStudioBg3dShotContactSheetResult(value.result);
  }
  return value.kind === "error" &&
    hasOnlyKeys(value, [...RESPONSE_BASE_KEYS, "code"]) &&
    (value.code === "protocol" || value.code === "unsupported-runtime" || value.code === "build-failed");
}
