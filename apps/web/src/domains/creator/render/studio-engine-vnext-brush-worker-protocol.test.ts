import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
  studioEngineVNextBrushWorkerSubmitIdentity,
  validateStudioEngineVNextBrushWorkerInbound,
  type StudioEngineVNextBrushWorkerCancelMessage,
  type StudioEngineVNextBrushWorkerDisposeMessage,
  type StudioEngineVNextBrushWorkerHelloMessage,
  type StudioEngineVNextBrushWorkerSubmitMessage,
} from "./studio-engine-vnext-brush-worker-protocol";

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(commandSequence = 1): Record<string, unknown> {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `worker-stroke-${commandSequence}`,
    seed: 42,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 1],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "worker-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 4,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          role: "authoritative",
          sequence: 1,
          x: 1,
          y: 1,
          pressure: 0.5,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          role: "authoritative",
          sequence: 2,
          x: 4,
          y: 3,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
}

const epochs = {
  sessionEpoch: 7,
  commandEpoch: 11,
  deviceEpoch: 5,
  resizeEpoch: 3,
  requestEpoch: 13,
} as const;

function hello(): StudioEngineVNextBrushWorkerHelloMessage {
  return {
    type: "studio-engine-vnext-brush/hello",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
    clientBuild: "studio-client-1",
  };
}

function submit(
  requestSequence = 1,
  commandSequence = requestSequence,
): StudioEngineVNextBrushWorkerSubmitMessage {
  return {
    type: "studio-engine-vnext-brush/submit",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
    requestSequence,
    commandSequence,
    requestToken: `request-${requestSequence}`,
    submission: {
      mode: "rebuild",
      resizeEpoch: epochs.resizeEpoch,
      deviceEpoch: epochs.deviceEpoch,
      rasterRect: { x: 0, y: 0, width: 8, height: 8 },
      layerId: "ink",
      baseDocumentRevision: commandSequence - 1,
      baseLayerRevision: commandSequence - 1,
      dirtyRects: [{ x: 0, y: 0, width: 4, height: 2 }],
      brushPlan: brushPlan(commandSequence),
    },
  };
}

function cancel(): StudioEngineVNextBrushWorkerCancelMessage {
  return {
    type: "studio-engine-vnext-brush/cancel",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
    requestSequence: 1,
    commandSequence: 1,
    requestToken: "request-1",
  };
}

function dispose(): StudioEngineVNextBrushWorkerDisposeMessage {
  return {
    type: "studio-engine-vnext-brush/dispose",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
  };
}

describe("studio-engine-vnext-brush-worker-protocol", () => {
  it("round-trips every inbound message through structuredClone", () => {
    for (const message of [hello(), submit(), cancel(), dispose()]) {
      const cloned = structuredClone(message);
      const parsed = validateStudioEngineVNextBrushWorkerInbound(cloned);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(structuredClone(parsed.message)).toEqual(parsed.message);
    }
  });

  it("rebuilds canonical samples as portable authoritative plain data", () => {
    const parsed = validateStudioEngineVNextBrushWorkerInbound(submit());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "studio-engine-vnext-brush/submit") return;
    expect(parsed.message.submission.brushPlan).not.toBe(submit().submission.brushPlan);
    expect(parsed.message.submission.brushPlan).toMatchObject({
      sessionEpoch: 7,
      strokeEpoch: 11,
      commandSequence: 1,
      source: {
        samples: [
          { role: "authoritative", sequence: 1 },
          { role: "authoritative", sequence: 2 },
        ],
      },
    });
    expect(() => structuredClone(parsed.message)).not.toThrow();
    expect(studioEngineVNextBrushWorkerSubmitIdentity(parsed.message)).toBe(
      studioEngineVNextBrushWorkerSubmitIdentity(parsed.message),
    );
  });

  it("rejects hostile accessors without invoking them", () => {
    const getter = vi.fn(() => submit().submission);
    const hostile = {
      ...submit(),
      get submission() {
        return getter();
      },
    };

    const parsed = validateStudioEngineVNextBrushWorkerInbound(hostile);

    expect(parsed).toMatchObject({
      ok: false,
      code: "invalid-message",
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects unknown fields at the envelope and nested submission boundaries", () => {
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      gpuDevice: { secret: true },
    })).toMatchObject({
      ok: false,
      code: "invalid-message",
    });
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      submission: {
        ...submit().submission,
        opfsHandle: { secret: true },
      },
    })).toMatchObject({
      ok: false,
      code: "invalid-message",
    });
  });

  it("rejects sparse dirty-rect and canonical-sample arrays", () => {
    const sparseRects = new Array(2);
    sparseRects[1] = { x: 0, y: 0, width: 1, height: 1 };
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      submission: {
        ...submit().submission,
        dirtyRects: sparseRects,
      },
    })).toMatchObject({ ok: false, code: "invalid-message" });

    const plan = brushPlan();
    const source = plan.source as { samples: unknown[] };
    const sparseSamples = new Array(2);
    sparseSamples[1] = source.samples[1];
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      submission: {
        ...submit().submission,
        brushPlan: {
          ...plan,
          source: {
            ...(plan.source as object),
            samples: sparseSamples,
          },
        },
      },
    })).toMatchObject({ ok: false, code: "invalid-message" });
  });

  it("rejects stale nested epochs, command identity mismatch, and unsupported revisions", () => {
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      submission: {
        ...submit().submission,
        resizeEpoch: 4,
      },
    })).toMatchObject({ ok: false, code: "invalid-message" });
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...submit(),
      commandSequence: 2,
    })).toMatchObject({ ok: false, code: "invalid-message" });
    expect(validateStudioEngineVNextBrushWorkerInbound({
      ...hello(),
      protocolRevision: 99,
    })).toMatchObject({ ok: false, code: "unsupported-protocol" });
  });
});
