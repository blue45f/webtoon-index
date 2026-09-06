import { applyLiquifyDisplacement, buildLiquifyDisplacementField } from "./studio-liquify";
import {
  STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
  assertStudioLiquifyRequest,
  studioLiquifySuccessTransfers,
  type StudioLiquifyWorkerFailureMessage,
  type StudioLiquifyWorkerResponseMessage,
  type StudioLiquifyWorkerRunMessage,
  type StudioLiquifyWorkerSuccessMessage,
} from "./studio-liquify-worker-protocol";

interface StudioLiquifyWorkerScope {
  onmessage: ((event: MessageEvent<StudioLiquifyWorkerRunMessage>) => void) | null;
  postMessage(message: StudioLiquifyWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioLiquifyWorkerScope;

workerScope.postMessage({
  type: "studio-liquify/ready",
  version: STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioLiquifyWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "리퀴파이 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "리퀴파이 Worker 실행에 실패했습니다." };
}

// 기본 client가 capacity 1로 직렬화하므로 이 런타임은 ready를 한 번만 보낸 뒤 순차 run 요청을
// 계속 받는다. 요청별 상태는 아래 handler 지역 변수에만 두어 stroke 간 픽셀/field가 섞이지 않는다.
workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    message.type !== "studio-liquify/run" ||
    message.version !== STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    assertStudioLiquifyRequest(message.request);
    const { src, dst } = message.request;
    const field = "stroke" in message.request
      ? buildLiquifyDisplacementField(
          message.request.stroke.points,
          message.request.stroke.radiusPx,
          message.request.stroke.strength,
          message.request.region?.canvasWidth ?? src.width,
          message.request.region?.canvasHeight ?? src.height,
          message.request.stroke.options,
        )
      : message.request.field;
    if (field) applyLiquifyDisplacement(src, dst, field, {
      ...(message.request.region === undefined ? {} : { region: message.request.region }),
    });
    const response: StudioLiquifyWorkerSuccessMessage = {
      type: "studio-liquify/success",
      version: STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
      applied: field !== null,
      dst,
    };
    workerScope.postMessage(response, studioLiquifySuccessTransfers(response));
  } catch (error) {
    const response: StudioLiquifyWorkerFailureMessage = {
      type: "studio-liquify/failure",
      version: STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
