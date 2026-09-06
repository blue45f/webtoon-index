import { describe, expect, it } from "vitest";

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
  snapshotStudioProceduralArtisticBrushWorkerOutboundMessage,
  snapshotStudioProceduralArtisticBrushWorkerRenderMessage,
  studioProceduralArtisticBrushWorkerResultTransfers,
  type StudioProceduralArtisticBrushWorkerRenderMessage,
  type StudioProceduralArtisticBrushWorkerResultMessage,
} from "./studio-procedural-artistic-brush-worker-protocol";

const HASH = `sha256:${"a".repeat(64)}` as const;

function renderMessage(): StudioProceduralArtisticBrushWorkerRenderMessage {
  return {
    type: "studio-procedural-artistic-brush/render",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    request: {
      kind: "studio-procedural-artistic-brush/request",
      version: 1,
      requestSequence: 7,
      engineEpoch: 9,
      strokeId: "worker-stroke-1",
      stage: "settled",
      seed: 0x1234_abcd,
      width: 2,
      height: 2,
      pixelRatio: 1,
      plan: {
        technique: "flow-field",
        presetId: "flow-water",
        samples: [
          {
            x: 0,
            y: 0,
            pressure: 0.4,
            tiltX: 0,
            tiltY: 0,
            timeMilliseconds: 0,
          },
          {
            x: 2,
            y: 2,
            pressure: 0.8,
            tiltX: 10,
            tiltY: -5,
            timeMilliseconds: 8,
          },
        ],
        parameters: {
          brush: "HB",
          curvature: 0.5,
        },
      },
    },
  };
}

function watercolorFillRenderMessage(
  height = 3_072,
): StudioProceduralArtisticBrushWorkerRenderMessage {
  return {
    ...renderMessage(),
    request: {
      ...renderMessage().request,
      width: 4_096,
      height,
      plan: {
        technique: "watercolor-fill",
        presetId: "studio-procedural-watercolor-fill-v1",
        samples: renderMessage().request.plan.samples,
        parameters: {
          angle: 0.6109,
          color: "#336699",
          density: 0.64,
          opacity: 0.72,
          strength: 0.78,
        },
      },
    },
  };
}

function resultMessage(
  pixels = new Uint8ClampedArray(16).fill(127),
): StudioProceduralArtisticBrushWorkerResultMessage {
  const request = renderMessage().request;
  return {
    type: "studio-procedural-artistic-brush/result",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    requestSequence: request.requestSequence,
    engineEpoch: request.engineEpoch,
    result: {
      status: "completed",
      consumed: false,
      artifact: {
        kind: "studio-procedural-artistic-brush/artifact",
        version: 1,
        width: request.width,
        height: request.height,
        encoding: "rgba8-unorm",
        colorSpace: "srgb",
        alpha: "straight",
        pixels,
        receipt: {
          kind: "studio-procedural-artistic-brush/receipt",
          version: 1,
          requestSequence: request.requestSequence,
          engineEpoch: request.engineEpoch,
          strokeId: request.strokeId,
          seed: request.seed,
          technique: request.plan.technique,
          presetId: request.plan.presetId,
          width: request.width,
          height: request.height,
          outputBytes: pixels.byteLength,
          inputFingerprint: HASH,
          pixelHash: HASH,
          replayFingerprint: HASH,
          adapter: {
            id: "p5-brush-standalone-worker",
            version: "2.2.1-adapter.3",
            compatibility: "p5.brush/standalone",
          },
          execution: {
            stage: "settled",
            locality: "dedicated-worker",
            surface: "offscreen-canvas-webgl2",
            backend: "webgl2",
            mainThreadFallback: false,
          },
          authority: {
            mainScene: false,
            document: false,
            history: false,
            persistence: false,
            output: "settled-raster-suggestion",
          },
          capabilitiesUsed: ["procedural:flow-field"],
          complete: true,
        },
      },
    },
  };
}

describe("Studio procedural artistic brush Worker protocol", () => {
  it("snapshots a clone-safe, settled p5 technique request", () => {
    const input = renderMessage();
    const snapshot =
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(input);

    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.request.plan.samples)).toBe(true);
    (
      input.request.plan.parameters as Record<string, string | number | boolean>
    ).curvature = 0.9;
    expect(snapshot?.request.plan.parameters.curvature).toBe(0.5);
  });

  it("rejects signals, extra fields, unsupported tips, and over-budget rasters", () => {
    const withSignal = {
      ...renderMessage(),
      request: {
        ...renderMessage().request,
        signal: new AbortController().signal,
      },
    };
    expect(
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(withSignal),
    ).toBeNull();

    const withTipTechnique = {
      ...renderMessage(),
      request: {
        ...renderMessage().request,
        plan: {
          ...renderMessage().request.plan,
          technique: "image-tip",
        },
      },
    };
    expect(
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(
        withTipTechnique,
      ),
    ).toBeNull();

    const overBudget = {
      ...renderMessage(),
      request: {
        ...renderMessage().request,
        width: 8_192,
        height: 4_097,
      },
    };
    expect(
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(overBudget),
    ).toBeNull();
  });

  it("snapshots exact fill plans at the eight-frame admission boundary", () => {
    const watercolor = watercolorFillRenderMessage();
    const watercolorSnapshot =
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(watercolor);
    expect(watercolorSnapshot).toEqual(watercolor);
    expect(watercolorSnapshot?.request.plan).toEqual({
      technique: "watercolor-fill",
      presetId: "studio-procedural-watercolor-fill-v1",
      samples: watercolor.request.plan.samples,
      parameters: {
        angle: 0.6109,
        color: "#336699",
        density: 0.64,
        opacity: 0.72,
        strength: 0.78,
      },
    });

    const flatWash = {
      ...renderMessage(),
      request: {
        ...renderMessage().request,
        width: 4_096,
        height: 3_072,
        plan: {
          technique: "flat-wash",
          presetId: "studio-procedural-flat-wash-v1",
          samples: renderMessage().request.plan.samples,
          parameters: {
            color: "#336699",
            opacity: 0.78,
          },
        },
      },
    };
    expect(
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(flatWash),
    ).toMatchObject({
      request: {
        plan: {
          technique: "flat-wash",
          presetId: "studio-procedural-flat-wash-v1",
        },
      },
    });

    expect(
      snapshotStudioProceduralArtisticBrushWorkerRenderMessage(
        watercolorFillRenderMessage(3_073),
      ),
    ).toBeNull();
  });

  it("rejects non-canonical fill presets and loose parameter payloads", () => {
    const valid = watercolorFillRenderMessage();
    for (const plan of [
      {
        ...valid.request.plan,
        presetId: "watercolor-fill-v1",
      },
      {
        ...valid.request.plan,
        parameters: {
          ...valid.request.plan.parameters,
          texture: 0.4,
        },
      },
      {
        ...valid.request.plan,
        parameters: {
          ...valid.request.plan.parameters,
          strength: 1.01,
        },
      },
    ]) {
      expect(
        snapshotStudioProceduralArtisticBrushWorkerRenderMessage({
          ...valid,
          request: {
            ...valid.request,
            plan,
          },
        }),
      ).toBeNull();
    }
  });

  it("validates and freezes the complete artifact receipt without copying pixels", () => {
    const input = resultMessage();
    const output =
      snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(input);

    expect(output).toMatchObject({
      type: "studio-procedural-artistic-brush/result",
      result: {
        status: "completed",
        artifact: {
          receipt: {
            pixelHash: HASH,
            replayFingerprint: HASH,
            execution: {
              locality: "dedicated-worker",
              mainThreadFallback: false,
            },
          },
        },
      },
    });
    if (
      output?.type !== "studio-procedural-artistic-brush/result"
      || output.result.status !== "completed"
      || input.result.status !== "completed"
    ) throw new Error("expected a completed artifact");
    expect(output.result.artifact.pixels).toBe(input.result.artifact.pixels);
    expect(Object.isFrozen(output.result.artifact)).toBe(true);
    expect(Object.isFrozen(output.result.artifact.receipt)).toBe(true);
  });

  it("fails closed for malformed hash, dimensions, or unknown response fields", () => {
    const malformedHash = structuredClone(resultMessage());
    if (malformedHash.result.status !== "completed") {
      throw new Error("expected a completed artifact");
    }
    Object.assign(malformedHash.result.artifact.receipt, {
      pixelHash: "sha256:not-valid",
    });
    expect(
      snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(
        malformedHash,
      ),
    ).toBeNull();

    const mismatchedPixels = resultMessage(
      new Uint8ClampedArray(12),
    );
    expect(
      snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(
        mismatchedPixels,
      ),
    ).toBeNull();

    expect(
      snapshotStudioProceduralArtisticBrushWorkerOutboundMessage({
        ...resultMessage(),
        surprise: true,
      }),
    ).toBeNull();
  });

  it("transfers exactly the completed RGBA ownership buffer", () => {
    const message = resultMessage();
    const transfers =
      studioProceduralArtisticBrushWorkerResultTransfers(message);

    expect(transfers).toEqual([
      message.result.status === "completed"
        ? message.result.artifact.pixels.buffer
        : null,
    ]);
    const clone = structuredClone(message, { transfer: transfers });
    if (
      clone.result.status !== "completed"
      || message.result.status !== "completed"
    ) throw new Error("expected a completed artifact");
    expect(message.result.artifact.pixels.byteLength).toBe(0);
    expect(clone.result.artifact.pixels).toHaveLength(16);
  });
});
