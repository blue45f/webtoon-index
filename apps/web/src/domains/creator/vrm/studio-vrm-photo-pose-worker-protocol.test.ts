import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
  normalizeStudioVrmPhotoPoseOptions,
} from "./studio-vrm-photo-pose";
import {
  isStudioVrmPhotoPoseWorkerRequest,
  isStudioVrmPhotoPoseWorkerResponse,
  studioVrmPhotoPoseRequestTransfers,
  studioVrmPhotoPoseResponseTransfers,
  type StudioVrmPhotoPoseWorkerRequest,
  type StudioVrmPhotoPoseWorkerResponse,
} from "./studio-vrm-photo-pose-worker-protocol";

function request(): Extract<StudioVrmPhotoPoseWorkerRequest, { readonly kind: "preprocess" }> {
  return {
    version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
    kind: "preprocess",
    requestId: 1,
    generationId: 2,
    bytes: new ArrayBuffer(24),
    admission: { fileName: "pose.png", mimeType: "image/png", byteSize: 24 },
    options: normalizeStudioVrmPhotoPoseOptions(),
  };
}

function response(): StudioVrmPhotoPoseWorkerResponse {
  const bitmap = { width: 32, height: 16, close: vi.fn() } as unknown as ImageBitmap;
  return {
    version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
    kind: "result",
    requestId: 1,
    generationId: 2,
    result: {
      generationId: 2,
      bitmap,
      source: {
        mimeType: "image/png",
        width: 32,
        height: 16,
        pixelCount: 512,
        exifOrientation: 1,
        byteSize: 24,
      },
      output: {
        outputWidth: 32,
        outputHeight: 16,
        scale: 1,
        appliedExifOrientation: 1,
        rotation: 0,
        mirrorHorizontal: false,
      },
    },
  };
}

describe("studio VRM photo-pose worker protocol", () => {
  it("accepts a fully bounded request and transfers only its owned byte buffer", () => {
    const value = request();
    expect(isStudioVrmPhotoPoseWorkerRequest(value)).toBe(true);
    expect(studioVrmPhotoPoseRequestTransfers(value)).toEqual([
      (value as Extract<StudioVrmPhotoPoseWorkerRequest, { readonly kind: "preprocess" }>).bytes,
    ]);
    expect(isStudioVrmPhotoPoseWorkerRequest({
      ...value,
      admission: { ...value.admission, byteSize: 23 },
    })).toBe(false);
    expect(isStudioVrmPhotoPoseWorkerRequest({ ...value, generationId: 0 })).toBe(false);
    expect(isStudioVrmPhotoPoseWorkerRequest({
      ...value,
      options: { ...value.options, maxOutputDimension: 99_999 },
    })).toBe(false);
  });

  it("validates result bitmap dimensions and returns that bitmap as the only transferable", () => {
    const value = response();
    expect(isStudioVrmPhotoPoseWorkerResponse(value)).toBe(true);
    expect(studioVrmPhotoPoseResponseTransfers(value)).toEqual([
      (value as Extract<StudioVrmPhotoPoseWorkerResponse, { readonly kind: "result" }>).result.bitmap,
    ]);
    const result = (value as Extract<StudioVrmPhotoPoseWorkerResponse, { readonly kind: "result" }>).result;
    expect(isStudioVrmPhotoPoseWorkerResponse({
      ...value,
      result: { ...result, bitmap: { ...result.bitmap, width: 31 } },
    })).toBe(false);
    expect(isStudioVrmPhotoPoseWorkerResponse({
      ...value,
      result: { ...result, source: { ...result.source, pixelCount: 999 } },
    })).toBe(false);
  });

  it("rejects unknown progress stages, non-monotonic numeric domains, and internal error codes", () => {
    expect(isStudioVrmPhotoPoseWorkerResponse({
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 2,
      stage: "uploading",
      progress: 0.5,
    })).toBe(false);
    expect(isStudioVrmPhotoPoseWorkerResponse({
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 2,
      stage: "decoding",
      progress: Number.NaN,
    })).toBe(false);
    expect(isStudioVrmPhotoPoseWorkerResponse({
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "error",
      requestId: 1,
      generationId: 2,
      code: "inference-failed",
    })).toBe(false);
  });
});
