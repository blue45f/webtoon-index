import { applyImageFilters, buildImageFilters, registerStudioKonvaFilters, type KonvaLike } from "./render/studio-konva-filters";
import {
  STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
  assertStudioImageFilterImageData,
  studioImageFilterSourceSuccessTransfers,
  studioImageFilterSuccessTransfers,
  type StudioImageFilterWorkerFailureMessage,
  type StudioImageFilterWorkerRequestMessage,
  type StudioImageFilterWorkerResponseMessage,
  type StudioImageFilterWorkerSourceFailureMessage,
  type StudioImageFilterWorkerSourceSuccessMessage,
  type StudioImageFilterWorkerSuccessMessage,
} from "./studio-image-filter-worker-protocol";

interface StudioImageFilterWorkerScope {
  onmessage: ((event: MessageEvent<StudioImageFilterWorkerRequestMessage>) => void) | null;
  postMessage(message: StudioImageFilterWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioImageFilterWorkerScope;

// 빈 레지스트리로 등록 — Blur/Brighten/Contrast/HSL/Pixelate는 attrs 기반 순수 포팅
// (studio-konva-native-filters)이 채운다. konva 패키지 자체는 이 워커에서 import하지 않는다.
const workerFilterRegistry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(workerFilterRegistry);

interface ResidentSource {
  readonly imageData: {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
  };
  readonly sourceGeneration: number;
  readonly sourceId: string;
}

let residentSource: ResidentSource | null = null;

workerScope.postMessage({
  type: "studio-image-filter/ready",
  version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioImageFilterWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "이미지 필터 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "이미지 필터 Worker 실행에 실패했습니다." };
}

function postSourceFailure(
  sourceId: string,
  sourceGeneration: number,
  error: unknown,
  requestId?: number,
): void {
  const response: StudioImageFilterWorkerSourceFailureMessage = {
    type: "studio-image-filter/source-failure",
    version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
    sourceId,
    sourceGeneration,
    ...(requestId === undefined ? {} : { requestId }),
    error: serializeWorkerError(error),
  };
  workerScope.postMessage(response, []);
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    message.version !== STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  if (message.type === "studio-image-filter/load-source") {
    try {
      assertStudioImageFilterImageData(message.imageData, "이미지 필터 상주 원본");
      residentSource = {
        imageData: message.imageData,
        sourceGeneration: message.sourceGeneration,
        sourceId: message.sourceId,
      };
      workerScope.postMessage({
        type: "studio-image-filter/source-loaded",
        version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
        sourceId: message.sourceId,
        sourceGeneration: message.sourceGeneration,
      }, []);
    } catch (error) {
      residentSource = null;
      postSourceFailure(message.sourceId, message.sourceGeneration, error);
    }
    return;
  }

  if (message.type === "studio-image-filter/run-source") {
    const source = residentSource;
    if (
      !source
      || source.sourceId !== message.sourceId
      || source.sourceGeneration !== message.sourceGeneration
    ) {
      postSourceFailure(
        message.sourceId,
        message.sourceGeneration,
        new Error("이미지 필터 Worker 상주 원본의 정체성이 일치하지 않습니다."),
        message.requestId,
      );
      return;
    }
    try {
      // 필터 엔진은 제자리 변형 계약이다. 상주 원본은 절대 변형하지 않고 결과 전용 버퍼만
      // 복제해 실행하므로 다음 슬라이더 tick도 항상 같은 원본에서 시작한다.
      const imageData = {
        data: new Uint8ClampedArray(source.imageData.data),
        width: source.imageData.width,
        height: source.imageData.height,
      };
      const { filters, attrs } = buildImageFilters(message.el, workerFilterRegistry, "worker");
      applyImageFilters(imageData, filters, attrs);
      const response: StudioImageFilterWorkerSourceSuccessMessage = {
        type: "studio-image-filter/source-success",
        version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
        sourceId: message.sourceId,
        sourceGeneration: message.sourceGeneration,
        requestId: message.requestId,
        imageData,
      };
      workerScope.postMessage(response, studioImageFilterSourceSuccessTransfers(response));
    } catch (error) {
      postSourceFailure(
        message.sourceId,
        message.sourceGeneration,
        error,
        message.requestId,
      );
    }
    return;
  }

  if (message.type !== "studio-image-filter/run") return;

  try {
    const { imageData, el } = message.request;
    assertStudioImageFilterImageData(imageData);
    const { filters, attrs } = buildImageFilters(el, workerFilterRegistry, "worker");
    applyImageFilters(imageData, filters, attrs);
    const response: StudioImageFilterWorkerSuccessMessage = {
      type: "studio-image-filter/success",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      imageData,
    };
    workerScope.postMessage(response, studioImageFilterSuccessTransfers(response));
  } catch (error) {
    const response: StudioImageFilterWorkerFailureMessage = {
      type: "studio-image-filter/failure",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
