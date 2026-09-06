import { describe, expect, it } from "vitest";

import { smoothStrokePoints } from "../studio-brush";

import {
  STUDIO_STROKE_POSTPROCESS_MAX_COORDINATES,
  STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
  isStudioStrokePostprocessWorkerResponseForAuthority,
  isStudioStrokePostprocessWorkerRunMessage,
  studioStrokePostprocessWorkerRequestTransfers,
  studioStrokePostprocessWorkerSuccessTransfers,
  type StudioStrokePostprocessWorkerRunMessage,
} from "./studio-stroke-postprocess-worker-protocol";
import { executeStudioStrokePostprocessWorkerRequest } from "./studio-stroke-postprocess-worker-runtime";

function request(
  source: readonly number[],
  overrides: Partial<StudioStrokePostprocessWorkerRunMessage> = {},
): StudioStrokePostprocessWorkerRunMessage {
  const points = Float64Array.from(source);
  return {
    type: "studio-stroke-postprocess/run",
    version: STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
    requestId: 7,
    generationId: 11,
    pointCount: points.length / 2,
    coordinateByteLength: points.byteLength,
    points,
    strength: 8,
    options: { preserveCorners: true, cornerThresholdDeg: 55 },
    ...overrides,
  };
}

function patternedPoints(count: number): number[] {
  return Array.from({ length: count }, (_, index) => [
    index * 1.25,
    Math.sin(index / 3) * 8 + Math.cos(index / 11) * 3,
  ]).flat();
}

describe("studio stroke postprocess Worker protocol", () => {
  it("accepts the exact Float64 request and exposes its buffer as the sole Transferable", () => {
    const message = request(patternedPoints(12));

    expect(isStudioStrokePostprocessWorkerRunMessage(message)).toBe(true);
    expect(studioStrokePostprocessWorkerRequestTransfers(message)).toEqual([message.points.buffer]);
    expect(isStudioStrokePostprocessWorkerRunMessage({ ...message, extra: true })).toBe(false);
    expect(isStudioStrokePostprocessWorkerRunMessage({ ...message, requestId: 0 })).toBe(false);
    expect(isStudioStrokePostprocessWorkerRunMessage({ ...message, points: new Float32Array(24) })).toBe(false);
  });

  it.each([
    { strength: 1, preserveCorners: false, cornerThresholdDeg: 55 },
    { strength: 5, preserveCorners: true, cornerThresholdDeg: 42 },
    { strength: 6, preserveCorners: false, cornerThresholdDeg: 55 },
    { strength: 10, preserveCorners: true, cornerThresholdDeg: 80 },
  ])(
    "matches smoothStrokePoints exactly at strength $strength and preserveCorners=$preserveCorners",
    ({ strength, preserveCorners, cornerThresholdDeg }) => {
      const source = patternedPoints(180);
      const message = request(source, {
        strength,
        options: { preserveCorners, cornerThresholdDeg },
      });
      const before = Array.from(message.points);
      const response = executeStudioStrokePostprocessWorkerRequest(message);

      expect(response?.type).toBe("studio-stroke-postprocess/success");
      if (!response || response.type !== "studio-stroke-postprocess/success") return;
      expect(Array.from(response.points)).toEqual(
        smoothStrokePoints(source, strength, { preserveCorners, cornerThresholdDeg }),
      );
      expect(Array.from(message.points)).toEqual(before);
      expect(response.points).not.toBe(message.points);
      expect(studioStrokePostprocessWorkerSuccessTransfers(response)).toEqual([response.points.buffer]);
      expect(isStudioStrokePostprocessWorkerResponseForAuthority(response, {
        requestId: message.requestId,
        generationId: message.generationId,
        pointCount: message.pointCount,
        coordinateByteLength: message.coordinateByteLength,
      })).toBe(true);
    },
  );

  it("classifies malformed and over-budget requests without executing smoothing", () => {
    const malformed = request([0, 0, 1, Number.NaN, 2, 2]);
    expect(executeStudioStrokePostprocessWorkerRequest(malformed)).toMatchObject({
      type: "studio-stroke-postprocess/failure",
      error: { code: "invalid-request" },
    });

    const oversizedPoints = new Float64Array(STUDIO_STROKE_POSTPROCESS_MAX_COORDINATES + 2);
    const oversized = request([], {
      pointCount: oversizedPoints.length / 2,
      coordinateByteLength: oversizedPoints.byteLength,
      points: oversizedPoints,
    });
    expect(executeStudioStrokePostprocessWorkerRequest(oversized)).toMatchObject({
      type: "studio-stroke-postprocess/failure",
      error: { code: "budget-exceeded" },
    });
  });

  it("drops uncorrelated garbage instead of inventing a request identity", () => {
    expect(executeStudioStrokePostprocessWorkerRequest({ type: "unknown" })).toBeNull();
  });
});
