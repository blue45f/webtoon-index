/// <reference lib="webworker" />

import {
  STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
  isStudioCspSutSqliteWorkerRequest,
  type StudioCspSutSqliteWorkerResponse,
} from "./studio-csp-sut-sqlite-reader-protocol";
import {
  StudioCspSutSqliteReaderError,
  readStudioCspSutSqliteSnapshot,
} from "./studio-csp-sut-sqlite-reader-runtime";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isStudioCspSutSqliteWorkerRequest(event.data)) return;
  const request = event.data;
  void readStudioCspSutSqliteSnapshot(new Uint8Array(request.bytes), request.context).then(
    (snapshot) => {
      const response: StudioCspSutSqliteWorkerResponse = {
        version: STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        snapshot,
      };
      workerScope.postMessage(response);
    },
    (cause: unknown) => {
      const error = cause instanceof StudioCspSutSqliteReaderError
        ? cause
        : new StudioCspSutSqliteReaderError(
          cause instanceof Error ? cause.message : String(cause),
          "query",
          { cause },
        );
      const response: StudioCspSutSqliteWorkerResponse = {
        version: STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        code: error.code,
        message: error.message,
      };
      workerScope.postMessage(response);
    },
  );
});

export {};
