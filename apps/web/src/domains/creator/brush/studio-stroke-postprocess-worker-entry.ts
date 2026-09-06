import {
  STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
  studioStrokePostprocessWorkerResponseIdentity,
  studioStrokePostprocessWorkerSuccessTransfers,
  type StudioStrokePostprocessWorkerResponseMessage,
} from "./studio-stroke-postprocess-worker-protocol";
import {
  createStudioStrokePostprocessWorkerFailure,
  executeStudioStrokePostprocessWorkerRequest,
} from "./studio-stroke-postprocess-worker-runtime";

interface StudioStrokePostprocessWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioStrokePostprocessWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioStrokePostprocessWorkerScope;
let acceptedRequest = false;

workerScope.onmessage = (event) => {
  const identity = studioStrokePostprocessWorkerResponseIdentity(event.data);
  if (acceptedRequest) {
    if (identity) {
      workerScope.postMessage(
        createStudioStrokePostprocessWorkerFailure(
          identity.requestId,
          identity.generationId,
          "invalid-request",
          new Error("획 후보정 Worker는 한 세대에 하나의 요청만 허용합니다."),
        ),
        [],
      );
    }
    return;
  }
  acceptedRequest = true;

  const response = executeStudioStrokePostprocessWorkerRequest(event.data);
  if (!response) return;
  if (response.version !== STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION) return;
  workerScope.postMessage(
    response,
    response.type === "studio-stroke-postprocess/success"
      ? studioStrokePostprocessWorkerSuccessTransfers(response)
      : [],
  );
};
