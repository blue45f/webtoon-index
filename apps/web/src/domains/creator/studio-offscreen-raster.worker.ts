/// <reference lib="webworker" />

/**
 * OffscreenCanvas 래스터화 Worker 엔트리.
 *
 * 얇게 유지한다 — 합성 로직은 studio-offscreen-raster-runtime 의 주입 seam 뒤에 있고, 메시지
 * 형태 검증은 프로토콜 모듈이 한다. 이 파일이 하는 일은 (1) 능력 프로브, (2) cancel 장부,
 * (3) 직렬 실행, (4) transfer 계산된 응답 post 뿐이다.
 *
 * Worker 쪽도 취소를 존중한다: 비행 중 잡의 runId 가 cancel 로 들어오면 다음 소스 경계에서
 * 즉시 멈추고 `cancelled` 실패를 보낸다. 클라이언트가 중재로 버리는 것과 이중 방어다.
 */

import {
  createStudioOffscreenCanvasHost,
  executeStudioOffscreenRasterJob,
  type StudioOffscreenRasterHost,
} from "./studio-offscreen-raster-runtime";
import {
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  isStudioOffscreenRasterCancelMessage,
  studioOffscreenRasterFailure,
  studioOffscreenRasterResponseTransfers,
  type StudioOffscreenRasterResponseMessage,
} from "./studio-offscreen-raster-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;

function post(response: StudioOffscreenRasterResponseMessage): void {
  scope.postMessage(response, studioOffscreenRasterResponseTransfers(response));
}

const host: StudioOffscreenRasterHost | null = createStudioOffscreenCanvasHost();

if (!host) {
  post({
    version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
    kind: "unavailable",
    code: "offscreen-canvas",
  });
} else {
  const activeHost = host;
  const cancelled = new Set<number>();
  let running = false;

  scope.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (isStudioOffscreenRasterCancelMessage(data)) {
      cancelled.add(data.runId);
      return;
    }
    if (running) {
      // 클라이언트는 직렬로만 post 한다. 겹쳐 들어온 요청은 계약 위반이라 정직하게 거부한다.
      post(studioOffscreenRasterFailure(
        typeof (data as { runId?: unknown })?.runId === "number" ? (data as { runId: number }).runId : 1,
        "protocol",
        "이전 래스터 잡이 아직 실행 중입니다.",
      ));
      return;
    }
    running = true;
    const runId = typeof (data as { runId?: unknown })?.runId === "number"
      ? (data as { runId: number }).runId
      : 1;
    void executeStudioOffscreenRasterJob({
      host: activeHost,
      request: data,
      isCancelled: () => cancelled.has(runId),
    }).then((response) => {
      cancelled.delete(runId);
      running = false;
      post(response);
    });
  });

  post({ version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION, kind: "ready" });
}

export {};
