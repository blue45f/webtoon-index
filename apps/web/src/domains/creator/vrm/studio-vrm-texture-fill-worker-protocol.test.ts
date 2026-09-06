import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
  isStudioVrmTextureFillRequest,
  isStudioVrmTextureFillWorkerResponseMessage,
  isStudioVrmTextureFillWorkerRunMessage,
  studioVrmTextureFillRequestTransfers,
  studioVrmTextureFillSuccessTransfers,
  type StudioVrmTextureFillWorkerFailureMessage,
  type StudioVrmTextureFillWorkerRunMessage,
  type StudioVrmTextureFillWorkerSuccessMessage,
} from "./studio-vrm-texture-fill-worker-protocol";

import type {
  StudioVrmTextureFillRequest,
  StudioVrmTextureFillResult,
} from "./studio-vrm-texture-fill";

function coreRequest(
  pixels: Uint8ClampedArray = new Uint8ClampedArray(4 * 3 * 4),
): StudioVrmTextureFillRequest {
  return {
    pixels,
    width: 4,
    height: 3,
    seed: { x: 1, y: 2 },
    tolerance: 24,
    scope: "contiguous",
  };
}

function runMessage(
  request: StudioVrmTextureFillRequest = coreRequest(),
): StudioVrmTextureFillWorkerRunMessage {
  return {
    type: "studio-vrm-texture-fill/run",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId: "fill-request-1",
    request,
  };
}

function fillResult(bitMask: Uint8Array = Uint8Array.of(0b0000_0011)): StudioVrmTextureFillResult {
  return {
    bitMask,
    bounds: { x: 0, y: 0, width: 2, height: 1 },
    matchedCount: 2,
    seedRgba: [12, 34, 56, 255],
  };
}

function successMessage(
  result: StudioVrmTextureFillResult = fillResult(),
): StudioVrmTextureFillWorkerSuccessMessage {
  return {
    type: "studio-vrm-texture-fill/success",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId: "fill-request-1",
    result,
  };
}

describe("studio VRM texture fill Worker protocol", () => {
  it("uses the immutable v1 ready/run/success/failure message namespace", () => {
    expect(STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION).toBe(1);
    expect(isStudioVrmTextureFillWorkerRunMessage(runMessage())).toBe(true);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      type: "studio-vrm-texture-fill/ready",
      version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    })).toBe(true);
    expect(isStudioVrmTextureFillWorkerResponseMessage(successMessage())).toBe(true);

    const failure: StudioVrmTextureFillWorkerFailureMessage = {
      type: "studio-vrm-texture-fill/failure",
      version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
      requestId: null,
      error: {
        name: "ProtocolError",
        message: "invalid request",
        code: "INVALID_REQUEST",
      },
    };
    expect(isStudioVrmTextureFillWorkerResponseMessage(failure)).toBe(true);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...failure,
      type: "studio-vrm-texture-fill/error",
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...failure,
      version: 2,
    })).toBe(false);
  });

  it("admits only exact, owned, clone-safe fill requests", () => {
    const request = coreRequest();
    expect(isStudioVrmTextureFillRequest(request)).toBe(true);
    expect(isStudioVrmTextureFillWorkerRunMessage(runMessage(request))).toBe(true);
    expect(isStudioVrmTextureFillRequest({ ...request, debug: true })).toBe(false);
    expect(isStudioVrmTextureFillRequest({
      ...request,
      pixels: new Uint8Array(request.pixels),
    })).toBe(false);
    expect(isStudioVrmTextureFillRequest({
      ...request,
      pixels: new Uint8ClampedArray(new ArrayBuffer(request.pixels.byteLength + 4), 4),
    })).toBe(false);
    expect(isStudioVrmTextureFillRequest({
      ...request,
      seed: { ...request.seed, x: request.width },
    })).toBe(false);
    expect(isStudioVrmTextureFillRequest({ ...request, tolerance: 256 })).toBe(false);
    expect(isStudioVrmTextureFillRequest({ ...request, scope: "all-scenes" })).toBe(false);
    expect(isStudioVrmTextureFillWorkerRunMessage({
      ...runMessage(request),
      requestId: "x".repeat(129),
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerRunMessage({
      ...runMessage(request),
      extra: true,
    })).toBe(false);
  });

  it("transfers the owned input pixel buffer exactly once", () => {
    const message = runMessage();
    const transfers = studioVrmTextureFillRequestTransfers(message);
    expect(transfers).toEqual([message.request.pixels.buffer]);
    expect(new Set(transfers).size).toBe(transfers.length);
  });

  it("transfers the owned result bit mask exactly once and validates correlated metadata", () => {
    const message = successMessage();
    const transfers = studioVrmTextureFillSuccessTransfers(message);
    expect(transfers).toEqual([message.result.bitMask.buffer]);
    expect(new Set(transfers).size).toBe(transfers.length);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: { ...message.result, matchedCount: 9 },
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: { ...message.result, bounds: null },
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: { ...message.result, seedRgba: [0, 0, 0, 999] },
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: { ...message.result, seedRgba: new Array<number>(4) },
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: {
        ...message.result,
        bounds: { ...message.result.bounds!, materialIndex: 0 },
      },
    })).toBe(false);
    expect(isStudioVrmTextureFillWorkerResponseMessage({
      ...message,
      result: {
        ...message.result,
        bitMask: new Uint8Array(new ArrayBuffer(2), 1),
      },
    })).toBe(false);
  });

  it("never puts SharedArrayBuffer-backed views in a transfer list", () => {
    const sharedPixels = new Uint8ClampedArray(new SharedArrayBuffer(4 * 3 * 4));
    const sharedRequest = coreRequest(sharedPixels);
    const sharedRun = runMessage(sharedRequest);
    expect(isStudioVrmTextureFillRequest(sharedRequest)).toBe(false);
    expect(isStudioVrmTextureFillWorkerRunMessage(sharedRun)).toBe(false);
    expect(studioVrmTextureFillRequestTransfers(sharedRun)).toEqual([]);

    const sharedMask = new Uint8Array(new SharedArrayBuffer(1));
    const sharedSuccess = successMessage(fillResult(sharedMask));
    expect(isStudioVrmTextureFillWorkerResponseMessage(sharedSuccess)).toBe(false);
    expect(studioVrmTextureFillSuccessTransfers(sharedSuccess)).toEqual([]);
  });

  it("keeps the Worker one-shot, handshake-first, transferable, and termination-cancellable", () => {
    const source = readFileSync(
      new URL("./studio-vrm-texture-fill.worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"studio-vrm-texture-fill/ready"');
    expect(source).toContain("let consumed = false");
    expect(source).toContain("if (consumed) return");
    expect(source).toContain("consumed = true");
    expect(source).toContain("isStudioVrmTextureFillWorkerRunMessage(message)");
    expect(source).toContain("computeStudioVrmTextureFillMask(message.request)");
    expect(source).not.toContain("computeStudioVrmTextureFillMask(message.request,");
    expect(source).toContain("studioVrmTextureFillSuccessTransfers(response)");
    expect(source).toContain('"studio-vrm-texture-fill/failure"');
    expect(source).toContain("serializeWorkerError");
    expect(source).not.toContain("shouldAbort");
  });
});
