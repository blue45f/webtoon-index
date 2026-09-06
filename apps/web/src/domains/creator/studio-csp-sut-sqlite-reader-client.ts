import {
  STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
  isStudioCspSutSqliteWorkerResponse,
  type StudioCspSutSqliteWorkerRequest,
} from "./studio-csp-sut-sqlite-reader-protocol";
import { StudioCspSutSqliteReaderError } from "./studio-csp-sut-sqlite-reader-runtime";

import type {
  CspSqliteReadContext,
  CspSqliteSnapshot,
  CspSutSqliteReader,
} from "../../../../../packages/studio-format-gateway/src/csp-sut";

export const STUDIO_CSP_SUT_SQLITE_WORKER_TIMEOUT_MS = 45_000;

export interface StudioCspSutSqliteWorkerLike {
  postMessage(message: StudioCspSutSqliteWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
}

export interface BrowserCspSutSqliteReaderOptions {
  readonly timeoutMs?: number;
  readonly workerFactory?: () => StudioCspSutSqliteWorkerLike;
}

function defaultWorkerFactory(): StudioCspSutSqliteWorkerLike {
  if (typeof Worker === "undefined") {
    throw new StudioCspSutSqliteReaderError(
      "이 브라우저에는 격리 SQLite Worker가 없습니다.",
      "worker-unavailable",
    );
  }
  return new Worker(
    new URL("./studio-csp-sut-sqlite-reader.worker.ts", import.meta.url),
    { type: "module", name: "studio-csp-sut-sqlite-reader" },
  );
}

function readWithWorker(
  bytes: Uint8Array,
  context: CspSqliteReadContext,
  options: BrowserCspSutSqliteReaderOptions,
): Promise<CspSqliteSnapshot> {
  if (context.signal?.aborted) {
    return Promise.reject(new StudioCspSutSqliteReaderError("SUT/SUTG 읽기가 취소되었습니다.", "aborted"));
  }
  let worker: StudioCspSutSqliteWorkerLike;
  try {
    worker = (options.workerFactory ?? defaultWorkerFactory)();
  } catch (cause) {
    return Promise.reject(
      cause instanceof StudioCspSutSqliteReaderError
        ? cause
        : new StudioCspSutSqliteReaderError(
          "격리 SQLite Worker를 시작하지 못했습니다.",
          "worker-unavailable",
          { cause },
        ),
    );
  }
  const requestId = 1;
  const timeoutMs = Math.max(1_000, Math.min(120_000, options.timeoutMs ?? STUDIO_CSP_SUT_SQLITE_WORKER_TIMEOUT_MS));
  const transferable = bytes.slice().buffer;
  return new Promise<CspSqliteSnapshot>((resolve, reject) => {
    let settled = false;
    const finish = (
      result: { ok: true; snapshot: CspSqliteSnapshot } | { ok: false; error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerFailure);
      worker.removeEventListener("messageerror", onWorkerFailure);
      worker.terminate();
      if (result.ok) resolve(result.snapshot);
      else reject(result.error);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isStudioCspSutSqliteWorkerResponse(event.data, requestId)) {
        finish({
          ok: false,
          error: new StudioCspSutSqliteReaderError("SQLite Worker 응답 계약이 잘못되었습니다.", "worker-failed"),
        });
        return;
      }
      if (event.data.ok) finish({ ok: true, snapshot: event.data.snapshot });
      else finish({
        ok: false,
        error: new StudioCspSutSqliteReaderError(event.data.message, event.data.code),
      });
    };
    const onWorkerFailure = (): void => finish({
      ok: false,
      error: new StudioCspSutSqliteReaderError("SQLite Worker 실행이 실패했습니다.", "worker-failed"),
    });
    const onAbort = (): void => finish({
      ok: false,
      error: new StudioCspSutSqliteReaderError("SUT/SUTG 읽기가 취소되었습니다.", "aborted"),
    });
    const timeout = setTimeout(() => finish({
      ok: false,
      error: new StudioCspSutSqliteReaderError("SQLite Worker 읽기 시간이 초과되었습니다.", "timeout"),
    }), timeoutMs);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerFailure);
    worker.addEventListener("messageerror", onWorkerFailure);
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const { signal: _signal, ...wireContext } = context;
    const request: StudioCspSutSqliteWorkerRequest = {
      version: STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
      requestId,
      bytes: transferable,
      context: wireContext,
    };
    try {
      worker.postMessage(request, [transferable]);
    } catch (cause) {
      finish({
        ok: false,
        error: new StudioCspSutSqliteReaderError(
          "SQLite 원본 바이트를 격리 Worker로 전송하지 못했습니다.",
          "worker-failed",
          { cause },
        ),
      });
    }
  });
}

/**
 * Production CspSutSqliteReader. It deliberately has no main-thread fallback:
 * if isolation cannot be established, FormatGateway returns preserve-only.
 */
export function createBrowserCspSutSqliteReader(
  options: BrowserCspSutSqliteReaderOptions = {},
): CspSutSqliteReader {
  return (bytes, context) => readWithWorker(bytes, context, options);
}
