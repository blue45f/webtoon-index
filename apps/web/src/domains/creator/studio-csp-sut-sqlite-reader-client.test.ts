import { describe, expect, it, vi } from "vitest";

import { CSP_TOOL_FILE_LIMITS } from "../../../../../packages/studio-format-gateway/src/csp-sut";
import { buildAuthoredSutFixture } from "../../../../../tests/corpus/formats/csp-sut-fixtures";

import {
  createBrowserCspSutSqliteReader,
  type StudioCspSutSqliteWorkerLike,
} from "./studio-csp-sut-sqlite-reader-client";
import {
  STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
  type StudioCspSutSqliteWorkerRequest,
  type StudioCspSutSqliteWorkerResponse,
} from "./studio-csp-sut-sqlite-reader-protocol";
import { readStudioCspSutSqliteSnapshot } from "./studio-csp-sut-sqlite-reader-runtime";

const context = {
  kind: "sut" as const,
  maxTables: CSP_TOOL_FILE_LIMITS.maxTables,
  maxColumnsPerTable: CSP_TOOL_FILE_LIMITS.maxColumnsPerTable,
  maxRows: CSP_TOOL_FILE_LIMITS.maxRows,
  maxBlobBytes: CSP_TOOL_FILE_LIMITS.maxBlobBytes,
  maxTextCharacters: CSP_TOOL_FILE_LIMITS.maxTextCharacters,
};

class AuthoredFixtureWorker implements StudioCspSutSqliteWorkerLike {
  readonly terminate = vi.fn();
  readonly requests: StudioCspSutSqliteWorkerRequest[] = [];
  private readonly message = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly failure = new Set<() => void>();

  postMessage(request: StudioCspSutSqliteWorkerRequest, transfer: Transferable[]): void {
    const cloned = structuredClone(request, { transfer });
    this.requests.push(cloned);
    queueMicrotask(() => {
      void readStudioCspSutSqliteSnapshot(
        new Uint8Array(cloned.bytes),
        cloned.context,
      ).then((snapshot) => {
        const response: StudioCspSutSqliteWorkerResponse = {
          version: STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
          requestId: cloned.requestId,
          ok: true,
          snapshot,
        };
        for (const listener of this.message) listener({ data: response } as MessageEvent<unknown>);
      }, () => {
        for (const listener of this.failure) listener();
      });
    });
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | (() => void),
  ): void {
    if (type === "message") this.message.add(listener as (event: MessageEvent<unknown>) => void);
    else this.failure.add(listener as () => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | (() => void),
  ): void {
    if (type === "message") this.message.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.failure.delete(listener as () => void);
  }
}

describe("browser SUT SQLite Worker adapter", () => {
  it("transfers an isolated copy through the Worker and returns an authored snapshot", async () => {
    const source = buildAuthoredSutFixture({ group: true });
    const original = source.slice();
    const worker = new AuthoredFixtureWorker();
    const reader = createBrowserCspSutSqliteReader({ workerFactory: () => worker });
    const snapshot = await reader(source, context);

    expect(snapshot.tables.find(({ name }) => name === "ToolProperty")?.rows).toHaveLength(2);
    expect(source).toEqual(original);
    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]?.context).not.toHaveProperty("signal");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the one-shot Worker on abort without a main-thread fallback", async () => {
    const worker = new AuthoredFixtureWorker();
    const controller = new AbortController();
    const reader = createBrowserCspSutSqliteReader({ workerFactory: () => worker });
    const pending = reader(buildAuthoredSutFixture(), { ...context, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("reports unavailable isolation instead of silently decoding on the UI thread", async () => {
    const reader = createBrowserCspSutSqliteReader({
      workerFactory: () => {
        throw new Error("worker blocked");
      },
    });
    await expect(reader(buildAuthoredSutFixture(), context)).rejects.toMatchObject({
      code: "worker-unavailable",
    });
  });
});
