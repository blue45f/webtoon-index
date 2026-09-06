import {
  buildStudioVrmComponentCapturePlan,
  type StudioVrmComponentCapturePlan,
  type StudioVrmComponentCaptureRequest,
  type StudioVrmRenderableDescriptor,
} from "./studio-vrm-component-pass-plan";
import {
  validateStudioVrmLinkedScene,
  writeStudioVrmComponentPsd,
  type StudioVrmComponentPass,
  type StudioVrmComponentPsdPackage,
  type StudioVrmLinkedSceneDescriptor,
} from "./studio-vrm-component-psd";

export type StudioVrmComponentCaptureProvider = (
  request: StudioVrmComponentCaptureRequest,
  context: Readonly<{
    scene: StudioVrmLinkedSceneDescriptor;
    signal: AbortSignal;
  }>,
) => Promise<Uint8Array | Uint8ClampedArray>;

export type StudioVrmComponentPsdExportProgress = Readonly<{
  phase: "planning" | "capturing" | "writing" | "complete";
  completed: number;
  total: number;
  requestId?: string;
}>;

export type StudioVrmComponentPsdExportResult = Readonly<{
  plan: StudioVrmComponentCapturePlan;
  package: StudioVrmComponentPsdPackage;
}>;

export type StudioVrmComponentPsdExportInput = Readonly<{
  scene: StudioVrmLinkedSceneDescriptor;
  renderables: readonly StudioVrmRenderableDescriptor[];
  capture: StudioVrmComponentCaptureProvider;
  signal?: AbortSignal;
  /** Ambiguous/weak component classification is rejected unless the user explicitly confirms it. */
  allowReviewedAmbiguity?: boolean;
  onProgress?: (progress: StudioVrmComponentPsdExportProgress) => void;
}>;

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("VRM component PSD export was cancelled", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function emit(
  callback: StudioVrmComponentPsdExportInput["onProgress"],
  progress: StudioVrmComponentPsdExportProgress,
): void {
  callback?.(Object.freeze(progress));
}

function passFromCapture(
  request: StudioVrmComponentCaptureRequest,
  scene: StudioVrmLinkedSceneDescriptor,
  rgba: Uint8Array | Uint8ClampedArray,
): StudioVrmComponentPass {
  return Object.freeze({
    id: request.id,
    kind: request.kind,
    name: request.label,
    width: scene.width,
    height: scene.height,
    rgba,
    visible: !request.utility,
  });
}

/**
 * Captures semantic passes serially. A renderer commonly swaps override materials and visibility
 * masks while capturing, so parallel capture would race the shared scene and produce mixed passes.
 */
export async function runStudioVrmComponentPsdExport(
  input: StudioVrmComponentPsdExportInput,
): Promise<StudioVrmComponentPsdExportResult> {
  if (typeof input.capture !== "function") throw new Error("a component capture provider is required");
  // Validate the scene before a single pass is rendered. The PSD writer validates too, but only
  // after every capture has run.
  validateStudioVrmLinkedScene(input.scene);
  const signal = input.signal ?? new AbortController().signal;
  throwIfAborted(signal);
  emit(input.onProgress, { phase: "planning", completed: 0, total: 0 });

  const plan = buildStudioVrmComponentCapturePlan(input.renderables);
  if (plan.requiresReview && input.allowReviewedAmbiguity !== true) {
    const preview = plan.unclassifiedRenderableIds.slice(0, 5).join(", ");
    throw new Error(
      `VRM component classification requires review before PSD export${preview ? `: ${preview}` : ""}`,
    );
  }

  const passes: StudioVrmComponentPass[] = [];
  const total = plan.requests.length;
  for (let index = 0; index < total; index += 1) {
    throwIfAborted(signal);
    const request = plan.requests[index];
    if (!request) throw new Error(`component capture request ${index} is unavailable`);
    emit(input.onProgress, {
      phase: "capturing",
      completed: index,
      total,
      requestId: request.id,
    });
    const rgba = await input.capture(request, { scene: input.scene, signal });
    throwIfAborted(signal);
    if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray)) {
      throw new Error(`capture provider returned an invalid RGBA buffer for ${request.id}`);
    }
    // Check the size here rather than leaving it to the PSD writer. The writer only sees the
    // passes once every capture has run, so a provider returning the wrong dimensions would be
    // asked for all the remaining passes first — each one a full scene render — before anything
    // complained.
    const expectedBytes = input.scene.width * input.scene.height * 4;
    if (rgba.byteLength !== expectedBytes) {
      throw new Error(
        `component pass ${request.id} must contain exactly ${expectedBytes} RGBA bytes`,
      );
    }
    passes.push(passFromCapture(request, input.scene, rgba));
    emit(input.onProgress, {
      phase: "capturing",
      completed: index + 1,
      total,
      requestId: request.id,
    });
  }

  throwIfAborted(signal);
  emit(input.onProgress, { phase: "writing", completed: total, total });
  const output = await writeStudioVrmComponentPsd(input.scene, passes);
  throwIfAborted(signal);
  emit(input.onProgress, { phase: "complete", completed: total, total });
  return Object.freeze({ plan, package: output });
}
