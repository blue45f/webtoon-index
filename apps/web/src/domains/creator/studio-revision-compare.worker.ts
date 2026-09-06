import { buildStudioServerRevisionComparison } from "./studio-server-revision-comparison";

import type {
  StudioRevisionCompareWorkerFailure,
  StudioRevisionCompareWorkerRequest,
  StudioRevisionCompareWorkerResponse,
  StudioRevisionCompareWorkerSuccess,
} from "./studio-revision-compare-worker-client";

interface StudioRevisionCompareWorkerScope {
  onmessage: ((event: MessageEvent<StudioRevisionCompareWorkerRequest>) => void) | null;
  postMessage(message: StudioRevisionCompareWorkerResponse): void;
}

const workerScope = globalThis as unknown as StudioRevisionCompareWorkerScope;

const SAFE_COMPARISON_ERROR_MESSAGES = new Set([
  "업로드형 과거 버전은 컷툰 편집기에서 복원할 수 없습니다.",
  "현재 서버 작품 형식이 컷툰 편집기와 호환되지 않습니다.",
  "비교할 작품 버전 데이터가 올바르지 않습니다.",
  "비교할 작품 버전의 편집 문서가 손상되었습니다.",
  "비교할 작품 버전의 페이지 목록이 손상되었습니다.",
  "비교할 작품 버전의 레거시 요소 목록이 손상되었습니다.",
  "올바르지 않은 ToonSpectrum 프로젝트 파일입니다.",
  "3D 배경 장면 데이터가 손상되었거나 지원하지 않는 버전입니다.",
]);

function safeWorkerError(error: unknown): StudioRevisionCompareWorkerFailure["error"] {
  if (error instanceof Error && SAFE_COMPARISON_ERROR_MESSAGES.has(error.message)) {
    return {
      name: "StudioRevisionComparisonError",
      message: error.message,
    };
  }
  return {
    name: "StudioRevisionComparisonError",
    message: "버전 비교 데이터가 손상되었거나 안전 한도를 벗어났습니다.",
  };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type !== "studio-revision-compare/run" || message.version !== 1) return;
  try {
    const response: StudioRevisionCompareWorkerSuccess = {
      type: "studio-revision-compare/success",
      version: 1,
      comparison: buildStudioServerRevisionComparison(message.input),
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: StudioRevisionCompareWorkerFailure = {
      type: "studio-revision-compare/failure",
      version: 1,
      error: safeWorkerError(error),
    };
    workerScope.postMessage(response);
  }
};
