import { smoothStrokePoints } from "../studio-brush";

import {
  STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
  studioStrokePostprocessWorkerRequestFailureCode,
  studioStrokePostprocessWorkerResponseIdentity,
  type StudioStrokePostprocessWorkerFailureCode,
  type StudioStrokePostprocessWorkerFailureMessage,
  type StudioStrokePostprocessWorkerResponseMessage,
  type StudioStrokePostprocessWorkerRunMessage,
  type StudioStrokePostprocessWorkerSuccessMessage,
} from "./studio-stroke-postprocess-worker-protocol";

function failureMessageFor(code: StudioStrokePostprocessWorkerFailureCode): string {
  if (code === "budget-exceeded") return "획 후보정 입력이 Worker 안전 예산을 초과했습니다.";
  if (code === "invalid-request") return "획 후보정 Worker 요청 프로토콜이 올바르지 않습니다.";
  return "획 후보정 Worker 실행에 실패했습니다.";
}

export function createStudioStrokePostprocessWorkerFailure(
  requestId: number,
  generationId: number,
  code: StudioStrokePostprocessWorkerFailureCode,
  error?: unknown,
): StudioStrokePostprocessWorkerFailureMessage {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message = error instanceof Error && error.message
    ? error.message
    : failureMessageFor(code);
  return {
    type: "studio-stroke-postprocess/failure",
    version: STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
    requestId,
    generationId,
    error: {
      code,
      name: name.slice(0, 128),
      message: message.slice(0, 2_048),
    },
  };
}

/** Pure Worker runtime used by both the module entry and deterministic parity tests. */
export function executeStudioStrokePostprocessWorkerRequest(
  value: unknown,
): StudioStrokePostprocessWorkerResponseMessage | null {
  const identity = studioStrokePostprocessWorkerResponseIdentity(value);
  if (!identity) return null;
  const failureCode = studioStrokePostprocessWorkerRequestFailureCode(value);
  if (failureCode) {
    return createStudioStrokePostprocessWorkerFailure(
      identity.requestId,
      identity.generationId,
      failureCode,
    );
  }

  // The exact validator above establishes this type without a second O(n) coordinate scan.
  const request = value as StudioStrokePostprocessWorkerRunMessage;
  try {
    const smoothed = smoothStrokePoints(
      Array.from(request.points),
      request.strength,
      request.options,
    );
    const points = Float64Array.from(smoothed);
    if (points.length !== request.points.length || points.byteLength !== request.coordinateByteLength) {
      return createStudioStrokePostprocessWorkerFailure(
        request.requestId,
        request.generationId,
        "execution-failed",
        new Error("획 후보정 Worker 결과 길이가 입력과 일치하지 않습니다."),
      );
    }
    const response: StudioStrokePostprocessWorkerSuccessMessage = {
      type: "studio-stroke-postprocess/success",
      version: STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      generationId: request.generationId,
      pointCount: request.pointCount,
      coordinateByteLength: request.coordinateByteLength,
      points,
    };
    return response;
  } catch (error) {
    return createStudioStrokePostprocessWorkerFailure(
      request.requestId,
      request.generationId,
      "execution-failed",
      error,
    );
  }
}
