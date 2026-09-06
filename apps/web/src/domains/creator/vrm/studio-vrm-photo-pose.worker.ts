/// <reference lib="webworker" />

import {
  STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
  StudioVrmPhotoPoseError,
  createStudioVrmPhotoPoseOutputPlan,
  inspectStudioVrmPhotoPoseImage,
} from "./studio-vrm-photo-pose";
import {
  isStudioVrmPhotoPoseWorkerRequest,
  studioVrmPhotoPoseResponseTransfers,
  type StudioVrmPhotoPoseWorkerErrorResponse,
  type StudioVrmPhotoPoseWorkerPreprocessRequest,
  type StudioVrmPhotoPoseWorkerResponse,
  type StudioVrmPhotoPoseWorkerStage,
} from "./studio-vrm-photo-pose-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const activeRequests = new Set<number>();
const cancelledRequests = new Set<number>();

function postProgress(
  request: StudioVrmPhotoPoseWorkerPreprocessRequest,
  stage: StudioVrmPhotoPoseWorkerStage,
  progress: number,
): void {
  if (cancelledRequests.has(request.requestId)) return;
  const response: StudioVrmPhotoPoseWorkerResponse = {
    version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
    kind: "progress",
    requestId: request.requestId,
    generationId: request.generationId,
    stage,
    progress,
  };
  scope.postMessage(response);
}

function finishRequest(requestId: number): boolean {
  activeRequests.delete(requestId);
  return cancelledRequests.delete(requestId);
}

function workerErrorCode(error: unknown): StudioVrmPhotoPoseWorkerErrorResponse["code"] {
  if (error instanceof StudioVrmPhotoPoseError) {
    if (
      error.code === "decode-failed"
      || error.code === "empty-file"
      || error.code === "file-too-large"
      || error.code === "image-dimensions"
      || error.code === "mime-mismatch"
      || error.code === "unsupported-browser"
      || error.code === "unsupported-type"
    ) return error.code;
  }
  return "decode-failed";
}

async function preprocess(request: StudioVrmPhotoPoseWorkerPreprocessRequest): Promise<void> {
  let decoded: ImageBitmap | null = null;
  let output: ImageBitmap | null = null;
  try {
    postProgress(request, "inspecting", 0.1);
    const byteSize = request.bytes.byteLength;
    const inspection = inspectStudioVrmPhotoPoseImage(
      new Uint8Array(request.bytes),
      request.admission.mimeType,
    );
    const plan = createStudioVrmPhotoPoseOutputPlan(inspection, request.options);
    if (cancelledRequests.has(request.requestId)) return;

    if (typeof scope.createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
      throw new StudioVrmPhotoPoseError("unsupported-browser");
    }
    postProgress(request, "decoding", 0.3);
    decoded = await scope.createImageBitmap(
      new Blob([request.bytes], { type: inspection.mimeType }),
      { imageOrientation: "none", premultiplyAlpha: "default", colorSpaceConversion: "default" },
    );
    // A decoder that ignores imageOrientation:none could apply EXIF before our explicit transform.
    // Reject that ambiguous boundary instead of accidentally rotating a pose twice.
    if (decoded.width !== inspection.width || decoded.height !== inspection.height) {
      throw new StudioVrmPhotoPoseError("decode-failed");
    }
    if (cancelledRequests.has(request.requestId)) return;

    postProgress(request, "transforming", 0.7);
    const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new StudioVrmPhotoPoseError("unsupported-browser");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scaleX = plan.outputWidth / plan.orientedWidth;
    const scaleY = plan.outputHeight / plan.orientedHeight;
    const a = plan.matrix.a * scaleX;
    const b = plan.matrix.b * scaleY;
    const c = plan.matrix.c * scaleX;
    const d = plan.matrix.d * scaleY;
    const e = plan.outputWidth / 2 - a * inspection.width / 2 - c * inspection.height / 2;
    const f = plan.outputHeight / 2 - b * inspection.width / 2 - d * inspection.height / 2;
    context.setTransform(a, b, c, d, e, f);
    context.drawImage(decoded, 0, 0);
    context.resetTransform();
    if (cancelledRequests.has(request.requestId)) return;

    const transferredOutput = canvas.transferToImageBitmap();
    output = transferredOutput;
    if (transferredOutput.width !== plan.outputWidth || transferredOutput.height !== plan.outputHeight) {
      throw new StudioVrmPhotoPoseError("decode-failed");
    }
    if (finishRequest(request.requestId)) return;
    const response: StudioVrmPhotoPoseWorkerResponse = {
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      result: {
        generationId: request.generationId,
        bitmap: transferredOutput,
        source: { ...inspection, byteSize },
        output: {
          outputWidth: plan.outputWidth,
          outputHeight: plan.outputHeight,
          scale: plan.scale,
          appliedExifOrientation: plan.appliedExifOrientation,
          rotation: request.options.rotation,
          mirrorHorizontal: request.options.mirrorHorizontal,
        },
      },
    };
    scope.postMessage(response, studioVrmPhotoPoseResponseTransfers(response));
    output = null;
  } catch (error) {
    if (finishRequest(request.requestId)) return;
    const response: StudioVrmPhotoPoseWorkerResponse = {
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: workerErrorCode(error),
    };
    scope.postMessage(response);
  } finally {
    decoded?.close();
    output?.close();
    activeRequests.delete(request.requestId);
    cancelledRequests.delete(request.requestId);
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isStudioVrmPhotoPoseWorkerRequest(request)) return;
  if (request.kind === "cancel") {
    if (activeRequests.has(request.requestId)) cancelledRequests.add(request.requestId);
    return;
  }
  if (activeRequests.has(request.requestId)) return;
  activeRequests.add(request.requestId);
  void preprocess(request);
});

export {};
