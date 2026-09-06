import { describe, expect, it } from "vitest";

import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  isStudioQualityWorkerResponseForAuthority,
  isStudioQualityWorkerResponseMessage,
  validateStudioQualityWorkerInboundMessage,
  type StudioQualityWorkerRequestMessage,
} from "./studio-quality-worker-protocol";

function pathRequest(
  overrides: Partial<StudioQualityWorkerRequestMessage> = {},
): StudioQualityWorkerRequestMessage {
  return {
    type: "studio-quality/request",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: 7,
    requestId: 1,
    requestToken: "q:7:1:path-boolean",
    operation: {
      kind: "path-boolean",
      a: "M0 0H10V10Z",
      b: "M5 0H15V10Z",
      op: "union",
    },
    ...overrides,
  };
}

function portableGeometry() {
  return {
    kind: "studio-portable-path-geometry",
    version: 1,
    fillRule: "nonzero",
    flatnessPx: 0.25,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      width: 10,
      height: 10,
    },
    contours: [
      {
        points: [0, 0, 10, 0, 0, 10],
        closed: true,
      },
    ],
    flattenedPointCount: 3,
    sourceCommandValueCount: 10,
  };
}

describe("Studio quality Worker protocol", () => {
  it("accepts exact initialize, boolean, stroke, cancel, and dispose messages", () => {
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/initialize",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: 7,
        clientBuild: "test",
      }).ok,
    ).toBe(true);
    expect(validateStudioQualityWorkerInboundMessage(pathRequest()).ok).toBe(true);
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/request",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: 7,
        requestId: 2,
        requestToken: "q:7:2:stroke-to-fill",
        operation: {
          kind: "stroke-to-fill",
          pathData: "M0 0L20 0",
          style: {
            widthPx: 6,
            cap: "round",
            join: "miter",
            miterLimit: 4,
            dash: { pattern: [10, 5], phase: -2 },
          },
        },
      }).ok,
    ).toBe(true);
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/cancel",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: 7,
        requestId: 2,
        requestToken: "q:7:2:stroke-to-fill",
        operationKind: "stroke-to-fill",
      }).ok,
    ).toBe(true);
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/dispose",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: 7,
      }).ok,
    ).toBe(true);
  });

  it("distinguishes future revisions from generally malformed input", () => {
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/initialize",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION + 1,
        workerEpoch: 7,
        clientBuild: "future",
      }),
    ).toMatchObject({
      ok: false,
      code: "unsupported-protocol",
      workerEpoch: 7,
      requestId: null,
    });
    expect(validateStudioQualityWorkerInboundMessage(null)).toMatchObject({
      ok: false,
      code: "invalid-message",
    });
  });

  it("fails closed on extra fields, malformed tokens, and non-monotonic identities", () => {
    expect(
      validateStudioQualityWorkerInboundMessage({
        ...pathRequest(),
        unexpected: true,
      }).ok,
    ).toBe(false);
    expect(
      validateStudioQualityWorkerInboundMessage(
        pathRequest({ requestToken: "token with spaces" }),
      ).ok,
    ).toBe(false);
    expect(
      validateStudioQualityWorkerInboundMessage(
        pathRequest({ requestId: 0 }),
      ).ok,
    ).toBe(false);
  });

  it("enforces input path and combined boolean budgets", () => {
    const oversized = `M${"0".repeat(
      STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits,
    )}`;
    expect(
      validateStudioQualityWorkerInboundMessage(
        pathRequest({
          operation: {
            kind: "path-boolean",
            a: oversized,
            b: "M0 0Z",
            op: "union",
          },
        }),
      ).ok,
    ).toBe(false);

    const half = "M".repeat(
      Math.floor(STUDIO_QUALITY_WORKER_BUDGETS.maxTotalInputCodeUnits / 2) + 1,
    );
    expect(
      validateStudioQualityWorkerInboundMessage(
        pathRequest({
          operation: {
            kind: "path-boolean",
            a: half,
            b: half,
            op: "union",
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it.each([
    { widthPx: 0, cap: "round", join: "round", miterLimit: 4 },
    { widthPx: 2, cap: "invalid", join: "round", miterLimit: 4 },
    { widthPx: 2, cap: "round", join: "round", miterLimit: Number.NaN },
    {
      widthPx: 2,
      cap: "round",
      join: "round",
      miterLimit: 4,
      dash: { pattern: [1, 2, 3], phase: 0 },
    },
  ])("rejects malformed stroke style %#", (style) => {
    expect(
      validateStudioQualityWorkerInboundMessage({
        type: "studio-quality/request",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: 7,
        requestId: 2,
        requestToken: "q:7:2:stroke-to-fill",
        operation: {
          kind: "stroke-to-fill",
          pathData: "M0 0L1 1",
          style,
        },
      }).ok,
    ).toBe(false);
  });

  it("accepts only portable, bounded response objects with exact keys", () => {
    const response = {
      type: "studio-quality/result",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 7,
      requestId: 1,
      requestToken: "q:7:1:path-boolean",
      operationKind: "path-boolean",
      providerId: "canvaskit",
      result: { ok: true, pathData: "M0 0Z" },
    };
    expect(isStudioQualityWorkerResponseMessage(response)).toBe(true);
    expect(
      isStudioQualityWorkerResponseMessage({
        ...response,
        embindPath: { delete() {} },
      }),
    ).toBe(false);
    expect(
      isStudioQualityWorkerResponseMessage({
        ...response,
        result: { ok: true, pathData: "" },
      }),
    ).toBe(false);
  });

  it("accepts exact revision 2 portable geometry and rejects malformed geometry", () => {
    expect(STUDIO_QUALITY_WORKER_PROTOCOL_REVISION).toBe(2);
    const geometry = portableGeometry();
    const response = {
      type: "studio-quality/result",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 7,
      requestId: 1,
      requestToken: "q:7:1:path-boolean",
      operationKind: "path-boolean",
      providerId: "canvaskit",
      result: {
        ok: true,
        pathData: "M0 0H10L0 10Z",
        geometry,
      },
    };

    expect(isStudioQualityWorkerResponseMessage(response)).toBe(true);
    expect(
      isStudioQualityWorkerResponseMessage({
        ...response,
        result: {
          ...response.result,
          geometry: {
            ...geometry,
            bounds: {
              ...geometry.bounds,
              width: 9,
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isStudioQualityWorkerResponseMessage({
        ...response,
        result: {
          ...response.result,
          geometry: {
            ...geometry,
            vendorPathHandle: 42,
          },
        },
      }),
    ).toBe(false);
  });

  it("requires epoch, id, token, and operation kind for exact result correlation", () => {
    const authority = {
      workerEpoch: 7,
      requestId: 1,
      requestToken: "q:7:1:path-boolean",
      operationKind: "path-boolean" as const,
    };
    const response = {
      type: "studio-quality/failure",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 7,
      requestId: 1,
      requestToken: "q:7:1:path-boolean",
      operationKind: "path-boolean",
      error: { code: "queue-full", message: "full" },
    };
    expect(isStudioQualityWorkerResponseForAuthority(response, authority)).toBe(true);
    expect(
      isStudioQualityWorkerResponseForAuthority(
        { ...response, requestToken: "q:7:1:stroke-to-fill" },
        authority,
      ),
    ).toBe(false);
    expect(
      isStudioQualityWorkerResponseForAuthority(
        { ...response, operationKind: "stroke-to-fill" },
        authority,
      ),
    ).toBe(false);
  });
});
