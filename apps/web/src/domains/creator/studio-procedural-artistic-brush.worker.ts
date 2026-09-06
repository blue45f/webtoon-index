/// <reference lib="webworker" />

import {
  createStudioP5BrushStandaloneAdapterLoader,
} from "./brush/studio-p5-brush-standalone-runtime-adapter";
import {
  createStudioProceduralArtisticBrushProvider,
  type StudioProceduralArtisticSurfaceFactory,
} from "./studio-procedural-artistic-brush-provider";
import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
  snapshotStudioProceduralArtisticBrushWorkerRenderMessage,
  studioProceduralArtisticBrushWorkerResultTransfers,
  type StudioProceduralArtisticBrushWorkerCapabilityProbe,
  type StudioProceduralArtisticBrushWorkerFailureMessage,
  type StudioProceduralArtisticBrushWorkerOutboundMessage,
  type StudioProceduralArtisticBrushWorkerRenderMessage,
  type StudioProceduralArtisticBrushWorkerResultMessage,
  type StudioProceduralArtisticBrushWorkerUnavailableMessage,
  type StudioProceduralArtisticBrushWorkerUnavailableReason,
} from "./studio-procedural-artistic-brush-worker-protocol";

const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true,
  antialias: false,
  depth: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
  stencil: false,
});

function releaseContext(
  canvas: OffscreenCanvas,
  context: WebGL2RenderingContext,
): void {
  try {
    context.getExtension("WEBGL_lose_context")?.loseContext();
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

interface StudioProceduralArtisticBrushWorkerScope {
  readonly constructor?: Readonly<{ name?: string }>;
  onmessage:
    | ((event: MessageEvent<StudioProceduralArtisticBrushWorkerRenderMessage>) => void)
    | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioProceduralArtisticBrushWorkerOutboundMessage,
    transfer?: Transferable[],
  ): void;
  close(): void;
}

const workerScope =
  globalThis as unknown as StudioProceduralArtisticBrushWorkerScope;

function detail(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return (message || fallback).slice(0, 512);
}

function postFailure(
  requestId: number | null,
  reason: StudioProceduralArtisticBrushWorkerFailureMessage["reason"],
  message: string,
): void {
  const response: StudioProceduralArtisticBrushWorkerFailureMessage = {
    type: "studio-procedural-artistic-brush/failure",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId,
    reason,
    detail: message.slice(0, 512),
  };
  workerScope.postMessage(response);
}

function postUnavailable(
  reason: StudioProceduralArtisticBrushWorkerUnavailableReason,
  message: string,
): void {
  const response: StudioProceduralArtisticBrushWorkerUnavailableMessage = {
    type: "studio-procedural-artistic-brush/unavailable",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    reason,
    detail: message.slice(0, 512),
  };
  workerScope.postMessage(response);
}

function workerScopeName(): string {
  try {
    return Object.getPrototypeOf(globalThis)?.constructor?.name
      ?? workerScope.constructor?.name
      ?? "<unknown>";
  } catch {
    return "<unavailable>";
  }
}

function probeCapabilities():
  | StudioProceduralArtisticBrushWorkerCapabilityProbe
  | StudioProceduralArtisticBrushWorkerUnavailableReason {
  if (workerScopeName() !== "DedicatedWorkerGlobalScope") {
    return "dedicated-worker-unavailable";
  }
  if (typeof OffscreenCanvas !== "function") {
    return "offscreen-canvas-unavailable";
  }
  const canvas = new OffscreenCanvas(2, 2);
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!context) return "webgl2-unavailable";
  const webglVersion = String(context.getParameter(context.VERSION));
  releaseContext(canvas, context);
  return Object.freeze({
    workerScope: "DedicatedWorkerGlobalScope",
    dedicatedWorker: true,
    offscreenCanvas: true,
    webgl2: true,
    privateSurface: true,
    mainThreadFallback: false,
    webglVersion,
  });
}

const createSurface: StudioProceduralArtisticSurfaceFactory = ({
  width,
  height,
}) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!context) {
    canvas.width = 1;
    canvas.height = 1;
    return null;
  }
  return {
    kind: "offscreen-canvas-webgl2",
    executionLocality: "dedicated-worker",
    transferredFromMainThread: false,
    width,
    height,
    canvas,
    context,
    dispose: () => {
      releaseContext(canvas, context);
    },
  };
};

let requestAccepted = false;

workerScope.onmessageerror = () => {
  if (requestAccepted) return;
  requestAccepted = true;
  postFailure(
    null,
    "invalid-message",
    "The artistic brush Worker could not clone the inbound message.",
  );
  workerScope.close();
};

workerScope.onmessage = (event) => {
  if (requestAccepted) {
    postFailure(
      null,
      "invalid-message",
      "The one-shot artistic brush Worker accepts exactly one request.",
    );
    workerScope.close();
    return;
  }
  requestAccepted = true;
  const message =
    snapshotStudioProceduralArtisticBrushWorkerRenderMessage(event.data);
  if (!message) {
    postFailure(
      null,
      "invalid-message",
      "The artistic brush Worker request failed structured-clone validation.",
    );
    workerScope.close();
    return;
  }
  void (async () => {
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: message.request.engineEpoch,
      executionLocality: "dedicated-worker",
      loadAdapter: createStudioP5BrushStandaloneAdapterLoader(),
      createSurface,
    });
    if (creation.status !== "ready") {
      postFailure(
        message.requestId,
        "provider-creation-failed",
        "The production artistic brush provider could not be created.",
      );
      workerScope.close();
      return;
    }
    try {
      const result = await creation.provider.render(message.request);
      const response: StudioProceduralArtisticBrushWorkerResultMessage = {
        type: "studio-procedural-artistic-brush/result",
        version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestSequence: message.request.requestSequence,
        engineEpoch: message.request.engineEpoch,
        result,
      };
      workerScope.postMessage(
        response,
        studioProceduralArtisticBrushWorkerResultTransfers(response),
      );
    } catch (error) {
      postFailure(
        message.requestId,
        "execution-failed",
        detail(error, "The production artistic brush provider failed."),
      );
    } finally {
      await creation.provider.dispose();
      workerScope.close();
    }
  })();
};

const probe = probeCapabilities();
if (typeof probe === "string") {
  postUnavailable(
    probe,
    "A private Dedicated Worker OffscreenCanvas WebGL2 surface is required.",
  );
  workerScope.close();
} else {
  workerScope.postMessage({
    type: "studio-procedural-artistic-brush/ready",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    probe,
  });
}
