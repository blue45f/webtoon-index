import { planStudioAutoColorHints } from "./studio-auto-color-hints";
import {
  isStudioAutoColorHintsWorkerRunMessage,
  STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
  studioAutoColorHintsResponseCorrelation,
  studioAutoColorHintsSuccessTransfers,
  type StudioAutoColorHintsWorkerFailureCode,
  type StudioAutoColorHintsWorkerFailureMessage,
  type StudioAutoColorHintsWorkerResponseMessage,
  type StudioAutoColorHintsWorkerSuccessMessage,
} from "./studio-auto-color-hints-worker-protocol";

interface StudioAutoColorHintsWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioAutoColorHintsWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioAutoColorHintsWorkerScope;
let acceptedJob = false;

workerScope.postMessage(
  {
    type: "studio-auto-color-hints/ready",
    version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
  },
  [],
);

function classifyFailure(error: unknown): StudioAutoColorHintsWorkerFailureCode {
  if (error instanceof TypeError) return "invalid-request";
  if (error instanceof RangeError) {
    return /budget|safety limit|exceeds/i.test(error.message) ? "budget-exceeded" : "invalid-request";
  }
  return "execution-failed";
}

function serializeFailure(
  requestId: number,
  generation: number,
  error: unknown,
  code = classifyFailure(error),
): StudioAutoColorHintsWorkerFailureMessage {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message =
    error instanceof Error && error.message
      ? error.message
      : "자동 채색 힌트 Worker 실행에 실패했습니다.";
  return {
    type: "studio-auto-color-hints/failure",
    version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
    requestId,
    generation,
    error: {
      code,
      name: name.slice(0, 128),
      message: message.slice(0, 2_048),
    },
  };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  const correlation = studioAutoColorHintsResponseCorrelation(message);
  if (!isStudioAutoColorHintsWorkerRunMessage(message)) {
    if (correlation) {
      workerScope.postMessage(
        serializeFailure(
          correlation.requestId,
          correlation.generation,
          new Error("자동 채색 힌트 Worker 요청 프로토콜이 올바르지 않습니다."),
          "protocol-error",
        ),
        [],
      );
    }
    return;
  }
  if (acceptedJob) {
    workerScope.postMessage(
      serializeFailure(
        message.requestId,
        message.generation,
        new Error("자동 채색 힌트 Worker는 한 세대에 하나의 작업만 허용합니다."),
        "protocol-error",
      ),
      [],
    );
    return;
  }
  acceptedJob = true;

  try {
    const response: StudioAutoColorHintsWorkerSuccessMessage = {
      type: "studio-auto-color-hints/success",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      generation: message.generation,
      plan: planStudioAutoColorHints(message.request),
    };
    workerScope.postMessage(response, studioAutoColorHintsSuccessTransfers(response));
  } catch (error) {
    workerScope.postMessage(serializeFailure(message.requestId, message.generation, error), []);
  }
};
