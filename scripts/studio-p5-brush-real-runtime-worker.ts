/// <reference lib="webworker" />

import {
  createStudioP5BrushStandaloneAdapterLoader,
} from "../apps/web/src/domains/creator/brush/studio-p5-brush-standalone-runtime-adapter";


import {
  studioP5BrushExactPixelsEqual,
  studioP5BrushRealRuntimeRequest,
} from "./studio-p5-brush-real-runtime-fixture";

import type {
  StudioP5BrushContextAffinityStressResult,
} from "./studio-p5-brush-real-runtime-protocol";
import type {
  StudioProceduralArtisticBrushAdapterInput,
  StudioProceduralArtisticOffscreenWebGl2Surface,
} from "../apps/web/src/domains/creator/studio-procedural-artistic-brush-provider";

const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true,
  antialias: false,
  depth: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
  stencil: false,
});
const MAX_WEBGL_ERRORS_PER_AUDIT = 32;

interface StressSurface {
  readonly surface: StudioProceduralArtisticOffscreenWebGl2Surface;
  dispose(): void;
}

function serializedError(error: unknown): Readonly<{
  message: string;
  stack: string | null;
}> {
  return error instanceof Error
    ? Object.freeze({ message: error.message, stack: error.stack ?? null })
    : Object.freeze({ message: String(error), stack: null });
}

function workerScopeConstructor(): string {
  try {
    return Object.getPrototypeOf(globalThis)?.constructor?.name ?? "<unknown>";
  } catch {
    return "<unavailable>";
  }
}

function assertHealthyWebGlContext(
  gl: WebGL2RenderingContext,
  label: string,
): void {
  if (gl.isContextLost()) {
    throw new Error(`${label} lost its WebGL2 context before disposal.`);
  }
  const errors: string[] = [];
  for (let index = 0; index < MAX_WEBGL_ERRORS_PER_AUDIT; index += 1) {
    const code = gl.getError();
    if (code === gl.NO_ERROR) {
      if (errors.length > 0) {
        throw new Error(
          `${label} reported WebGL errors: ${errors.join(", ")}.`,
        );
      }
      return;
    }
    errors.push(`0x${code.toString(16).padStart(4, "0")}`);
  }
  throw new Error(
    `${label} WebGL error queue did not drain after `
    + `${MAX_WEBGL_ERRORS_PER_AUDIT} reads (${errors.join(", ")}).`,
  );
}

function createStressSurface(
  width: number,
  height: number,
  onDispose: () => void,
): StressSurface {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!(context instanceof WebGL2RenderingContext)) {
    throw new Error("Context-affinity stress could not create WebGL2.");
  }
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      assertHealthyWebGlContext(context, "context-affinity stress surface");
      const extension = context.getExtension("WEBGL_lose_context");
      if (!extension) {
        throw new Error("WEBGL_lose_context is unavailable during stress cleanup.");
      }
      extension.loseContext();
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      onDispose();
    }
  };
  return Object.freeze({
    surface: Object.freeze({
      kind: "offscreen-canvas-webgl2",
      executionLocality: "dedicated-worker",
      transferredFromMainThread: false,
      width,
      height,
      canvas,
      context,
      dispose,
    }),
    dispose,
  });
}

function adapterInput(
  request: ReturnType<typeof studioP5BrushRealRuntimeRequest>,
  surface: StudioProceduralArtisticOffscreenWebGl2Surface,
): StudioProceduralArtisticBrushAdapterInput {
  return Object.freeze({
    requestSequence: request.requestSequence,
    engineEpoch: request.engineEpoch,
    strokeId: request.strokeId,
    stage: "settled",
    seed: request.seed,
    width: request.width,
    height: request.height,
    pixelRatio: request.pixelRatio,
    plan: request.plan,
    surface,
  });
}

async function run(): Promise<StudioP5BrushContextAffinityStressResult> {
  if (
    workerScopeConstructor() !== "DedicatedWorkerGlobalScope"
    || typeof OffscreenCanvas !== "function"
  ) {
    throw new Error(
      "Context-affinity stress requires a Dedicated Worker OffscreenCanvas.",
    );
  }
  let surfaceDisposeCount = 0;
  const first = createStressSurface(160, 128, () => {
    surfaceDisposeCount += 1;
  });
  const foreign = createStressSurface(160, 128, () => {
    surfaceDisposeCount += 1;
  });
  try {
    const adapter = await createStudioP5BrushStandaloneAdapterLoader()();
    if (!adapter) {
      throw new Error("The production p5.brush standalone adapter did not load.");
    }
    const firstRequest = studioP5BrushRealRuntimeRequest(
      "watercolor-fill",
      1_001,
    );
    const replayRequest = studioP5BrushRealRuntimeRequest(
      "watercolor-fill",
      1_002,
    );
    const firstOutput = await adapter.renderSettled(
      adapterInput(firstRequest, first.surface),
      new AbortController().signal,
    );
    const replayOutput = await adapter.renderSettled(
      adapterInput(replayRequest, first.surface),
      new AbortController().signal,
    );
    if (!studioP5BrushExactPixelsEqual(
      firstOutput.pixels,
      replayOutput.pixels,
    )) {
      throw new Error(
        "Same-context seeded p5.brush replay changed exact RGBA bytes.",
      );
    }

    let crossContextMessage = "";
    try {
      await adapter.renderSettled(
        adapterInput(
          studioP5BrushRealRuntimeRequest("watercolor-fill", 1_003),
          foreign.surface,
        ),
        new AbortController().signal,
      );
    } catch (error: unknown) {
      crossContextMessage = serializedError(error).message;
    }
    if (!/context-affine/u.test(crossContextMessage)) {
      throw new Error(
        "The standalone adapter did not fail closed on a foreign context.",
      );
    }

    first.dispose();
    foreign.dispose();
    if (surfaceDisposeCount !== 2) {
      throw new Error(
        `Context-affinity stress leaked surfaces (${surfaceDisposeCount}/2).`,
      );
    }
    return Object.freeze({
      status: "ok",
      sameContextExactPixelReplay: true,
      crossContextRejected: true,
      crossContextMessage,
      surfaceCount: 2,
      surfaceDisposeCount: 2,
      webGlErrorFree: true,
    });
  } finally {
    first.dispose();
    foreign.dispose();
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    typeof event.data !== "object"
    || event.data === null
    || !("type" in event.data)
    || event.data.type !== "studio-p5-brush-context-affinity/start"
  ) return;
  void run()
    .then((result) => self.postMessage(result))
    .catch((error: unknown) => {
      const serialized = serializedError(error);
      const result: StudioP5BrushContextAffinityStressResult = Object.freeze({
        status: "error",
        message: serialized.message,
        stack: serialized.stack,
      });
      self.postMessage(result);
    });
}, { once: true });
