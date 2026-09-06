import { describe, expect, it } from "vitest";

import { planStudioAutoColorHints, type StudioAutoColorHintRequest } from "./studio-auto-color-hints";
import {
  cloneStudioAutoColorHintsWorkerRequest,
  isStudioAutoColorHintsWorkerPlan,
  isStudioAutoColorHintsWorkerRunMessage,
  STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
  studioAutoColorHintsRequestTransfers,
  studioAutoColorHintsResponseCorrelation,
  studioAutoColorHintsSuccessTransfers,
  type StudioAutoColorHintsWorkerRunMessage,
  type StudioAutoColorHintsWorkerSuccessMessage,
} from "./studio-auto-color-hints-worker-protocol";

function requestFixture(): StudioAutoColorHintRequest {
  return {
    image: {
      data: new Uint8ClampedArray([
        255, 255, 255, 255,
        0, 0, 0, 255,
        255, 255, 255, 255,
      ]),
      width: 3,
      height: 1,
    },
    seeds: [
      { id: "left", x: 0, y: 0, color: [240, 40, 30, 255] },
      { id: "right", x: 2, y: 0, color: [30, 80, 240, 255] },
    ],
    paletteLock: { colors: [[240, 40, 30, 255], [30, 80, 240, 255]] },
    options: {
      boundaryInkThreshold: 24,
      budgets: { maxPixels: 64, maxHints: 4, maxComponents: 4 },
      recommendations: { maximumRecommendations: 4 },
    },
  };
}

describe("auto-color hint worker clone and transfer protocol", () => {
  it("copies caller RGBA and strips non-clone-safe wrapper properties before transfer", () => {
    const request = requestFixture();
    Object.assign(request.image, { release() {} });
    Object.assign(request.options!, { debugCallback() {} });
    const originalData = request.image.data;
    const cloneSafe = cloneStudioAutoColorHintsWorkerRequest(request);
    const message: StudioAutoColorHintsWorkerRunMessage = {
      type: "studio-auto-color-hints/run",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: 7,
      generation: 11,
      request: cloneSafe,
    };

    expect(cloneSafe.image.data).not.toBe(originalData);
    expect(cloneSafe.image.data).toEqual(originalData);
    expect(cloneSafe.image).not.toHaveProperty("release");
    expect(cloneSafe.options).not.toHaveProperty("debugCallback");
    expect(cloneSafe.seeds[0]?.color).not.toBe(request.seeds[0]?.color);

    const received = structuredClone(message, {
      transfer: studioAutoColorHintsRequestTransfers(message),
    });
    expect(cloneSafe.image.data.byteLength).toBe(0);
    expect(received.request.image.data.byteLength).toBe(12);
    expect(originalData.byteLength).toBe(12);
    expect(originalData).toEqual(requestFixture().image.data);
  });

  it("transfers only the returned label map and validates its correlated dimensions", () => {
    const request = requestFixture();
    const plan = planStudioAutoColorHints(request);
    const response: StudioAutoColorHintsWorkerSuccessMessage = {
      type: "studio-auto-color-hints/success",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: 3,
      generation: 5,
      plan,
    };
    const expected = { width: 3, height: 1, pixelCount: 3, requestedHintCount: 2 };

    expect(isStudioAutoColorHintsWorkerPlan(plan, expected)).toBe(true);
    const received = structuredClone(response, {
      transfer: studioAutoColorHintsSuccessTransfers(response),
    });
    expect(plan.labels.byteLength).toBe(0);
    expect(received.plan.labels).toEqual(new Uint32Array([1, 0, 2]));
    expect(isStudioAutoColorHintsWorkerPlan(received.plan, expected)).toBe(true);
    expect(
      isStudioAutoColorHintsWorkerPlan(
        { ...received.plan, diagnostics: { ...received.plan.diagnostics, width: 99 } },
        expected,
      ),
    ).toBe(false);
  });

  it("strictly validates version, request id, and generation envelopes", () => {
    const valid: StudioAutoColorHintsWorkerRunMessage = {
      type: "studio-auto-color-hints/run",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      generation: 2,
      request: requestFixture(),
    };

    expect(isStudioAutoColorHintsWorkerRunMessage(valid)).toBe(true);
    expect(isStudioAutoColorHintsWorkerRunMessage({ ...valid, version: 99 })).toBe(false);
    expect(isStudioAutoColorHintsWorkerRunMessage({ ...valid, requestId: 0 })).toBe(false);
    expect(isStudioAutoColorHintsWorkerRunMessage({ ...valid, generation: Number.NaN })).toBe(false);
    expect(studioAutoColorHintsResponseCorrelation(valid)).toEqual({ requestId: 1, generation: 2 });
    expect(studioAutoColorHintsResponseCorrelation({ ...valid, generation: -1 })).toBeNull();
  });

  it("rejects hostile request payloads before any Worker transfer", () => {
    expect(() =>
      cloneStudioAutoColorHintsWorkerRequest({
        ...requestFixture(),
        image: { data: new Uint8ClampedArray(3), width: 1, height: 1 },
      }),
    ).toThrow(/data length/);
    expect(() =>
      cloneStudioAutoColorHintsWorkerRequest({
        ...requestFixture(),
        options: { budgets: { maxPixels: 1 } },
      }),
    ).toThrow(/request\.image\.width|pixel request budget/);
    expect(() =>
      cloneStudioAutoColorHintsWorkerRequest({
        ...requestFixture(),
        seeds: [
          { id: "same", x: 0, y: 0, color: [0, 0, 0, 255] },
          { id: "same", x: 2, y: 0, color: [0, 0, 0, 255] },
        ],
      }),
    ).toThrow(/duplicate id/);
  });
});
