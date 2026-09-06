import { describe, expect, it, vi } from "vitest";

import { planStudioAutoColorHints, type StudioAutoColorHintRequest } from "./studio-auto-color-hints";
import {
  runStudioAutoColorHintsWorker,
  StudioAutoColorHintsWorkerClient,
  type StudioAutoColorHintsWorkerLike,
} from "./studio-auto-color-hints-worker-client";
import {
  STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
  studioAutoColorHintsSuccessTransfers,
  type StudioAutoColorHintsWorkerFailureMessage,
  type StudioAutoColorHintsWorkerRunMessage,
  type StudioAutoColorHintsWorkerSuccessMessage,
} from "./studio-auto-color-hints-worker-protocol";

function requestFixture(): StudioAutoColorHintRequest {
  return {
    image: {
      data: new Uint8ClampedArray([
        255, 255, 255, 255,
        0, 0, 0, 255,
        255, 255, 255, 255,
      ]),
      width: 3,
      height: 1,
    },
    seeds: [
      { id: "left", x: 0, y: 0, color: [240, 40, 30, 255] },
      { id: "right", x: 2, y: 0, color: [30, 80, 240, 255] },
    ],
  };
}

interface FakeWorkerOptions {
  readonly autoReady?: boolean;
  readonly readyVersion?: number;
  readonly autoRespond?: boolean;
  readonly postError?: Error;
}

class FakeWorker implements StudioAutoColorHintsWorkerLike {
  onmessage: StudioAutoColorHintsWorkerLike["onmessage"] = null;
  onerror: StudioAutoColorHintsWorkerLike["onerror"] = null;
  onmessageerror: StudioAutoColorHintsWorkerLike["onmessageerror"] = null;
  readonly requests: StudioAutoColorHintsWorkerRunMessage[] = [];
  readonly transferCounts: number[] = [];
  terminateCount = 0;
  readonly #options: FakeWorkerOptions;

  constructor(options: FakeWorkerOptions = {}) {
    this.#options = options;
    if (options.autoReady !== false) {
      queueMicrotask(() => {
        this.emitMessage({
          type: "studio-auto-color-hints/ready",
          version: options.readyVersion ?? STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
        });
      });
    }
  }

  postMessage(message: StudioAutoColorHintsWorkerRunMessage, transfer: Transferable[]): void {
    if (this.#options.postError) throw this.#options.postError;
    this.transferCounts.push(transfer.length);
    const received = structuredClone(message, { transfer });
    this.requests.push(received);
    if (this.#options.autoRespond) queueMicrotask(() => this.emitSuccess(received));
  }

  terminate(): void {
    this.terminateCount++;
  }

  emitMessage(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  emitSuccess(
    request = this.requests.at(-1),
    correlation: Partial<Pick<StudioAutoColorHintsWorkerSuccessMessage, "requestId" | "generation" | "version">> = {},
  ): void {
    if (!request) throw new Error("FakeWorker has no posted request.");
    const response: StudioAutoColorHintsWorkerSuccessMessage = {
      type: "studio-auto-color-hints/success",
      version: correlation.version ?? STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: correlation.requestId ?? request.requestId,
      generation: correlation.generation ?? request.generation,
      plan: planStudioAutoColorHints(request.request),
    };
    const received = structuredClone(response, {
      transfer: studioAutoColorHintsSuccessTransfers(response),
    });
    this.emitMessage(received);
  }

  emitFailure(
    code: StudioAutoColorHintsWorkerFailureMessage["error"]["code"],
    request = this.requests.at(-1),
  ): void {
    if (!request) throw new Error("FakeWorker has no posted request.");
    const response: StudioAutoColorHintsWorkerFailureMessage = {
      type: "studio-auto-color-hints/failure",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      error: { code, name: "RangeError", message: "bounded worker failure" },
    };
    this.emitMessage(response);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("StudioAutoColorHintsWorkerClient success and ownership", () => {
  it("transfers a private RGBA copy, preserves caller pixels, and terminates after success", async () => {
    const request = requestFixture();
    Object.assign(request.image, { release() {} });
    const original = request.image.data.slice();
    const originalBuffer = request.image.data.buffer;
    const worker = new FakeWorker({ autoRespond: true });

    const plan = await runStudioAutoColorHintsWorker(request, { workerFactory: () => worker });

    expect(plan.status).toBe("ready");
    expect(plan.operations).toHaveLength(2);
    expect(request.image.data.buffer).toBe(originalBuffer);
    expect(request.image.data).toEqual(original);
    expect(request.image.data.byteLength).toBe(12);
    expect(worker.transferCounts).toEqual([1]);
    expect(worker.requests[0]?.request.image).not.toHaveProperty("release");
    expect(worker.terminateCount).toBe(1);
  });

  it("returns an explicit error when Worker is unavailable and never runs a direct fallback", async () => {
    const request = requestFixture();
    const before = request.image.data.slice();

    await expect(runStudioAutoColorHintsWorker(request, { workerFactory: null })).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    expect(request.image.data).toEqual(before);
  });

  it("rejects hostile input before constructing a Worker", async () => {
    const workerFactory = vi.fn(() => new FakeWorker({ autoRespond: true }));
    const malformed = {
      ...requestFixture(),
      image: { data: new Uint8ClampedArray(3), width: 1, height: 1 },
    };

    await expect(runStudioAutoColorHintsWorker(malformed, { workerFactory })).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });
});

describe("StudioAutoColorHintsWorkerClient lifecycle", () => {
  it("uses latest-wins, terminates the superseded job, and ignores stale generations", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioAutoColorHintsWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const firstRun = client.run(requestFixture());
    const firstRejection = expect(firstRun).rejects.toMatchObject({ name: "AbortError" });
    await flushMicrotasks();
    const firstWorker = workers[0]!;
    expect(firstWorker.requests).toHaveLength(1);

    const secondRun = client.run(requestFixture());
    await firstRejection;
    await flushMicrotasks();
    const secondWorker = workers[1]!;
    expect(firstWorker.terminateCount).toBe(1);
    expect(secondWorker.requests).toHaveLength(1);
    const firstMessage = firstWorker.requests[0]!;
    const secondMessage = secondWorker.requests[0]!;
    expect(secondMessage.requestId).toBeGreaterThan(firstMessage.requestId);
    expect(secondMessage.generation).toBeGreaterThan(firstMessage.generation);

    let settled = false;
    void secondRun.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    secondWorker.emitSuccess(secondMessage, {
      requestId: firstMessage.requestId,
      generation: firstMessage.generation,
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    secondWorker.emitSuccess(secondMessage);
    await expect(secondRun).resolves.toMatchObject({ engine: "connected-region-hints" });
    expect(secondWorker.terminateCount).toBe(1);
    client.dispose();
  });

  it("supports AbortSignal without detaching caller input", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const request = requestFixture();
    const originalBuffer = request.image.data.buffer;
    const pending = new StudioAutoColorHintsWorkerClient({ workerFactory: () => worker }).run(request, {
      signal: controller.signal,
    });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await flushMicrotasks();

    controller.abort();

    await rejection;
    expect(worker.terminateCount).toBe(1);
    expect(request.image.data.buffer).toBe(originalBuffer);
    expect(request.image.data.byteLength).toBe(12);
  });

  it("times out, terminates, and recovers on the next generation", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioAutoColorHintsWorkerClient({
      timeoutMs: 5,
      workerFactory: () => {
        const worker = new FakeWorker({ autoRespond: workers.length > 0 });
        workers.push(worker);
        return worker;
      },
    });

    await expect(client.run(requestFixture())).rejects.toMatchObject({
      code: "worker-timeout",
      name: "TimeoutError",
    });
    const hanging = workers[0]!;
    expect(hanging.terminateCount).toBe(1);
    await expect(client.run(requestFixture())).resolves.toMatchObject({ status: "ready" });
    const recovered = workers[1]!;
    expect(recovered.terminateCount).toBe(1);
    client.dispose();
  });

  it("fails a postMessage error without fallback and can use a fresh Worker afterward", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioAutoColorHintsWorkerClient({
      workerFactory: () => {
        const worker =
          workers.length === 0
            ? new FakeWorker({ postError: new DOMException("blocked", "DataCloneError") })
            : new FakeWorker({ autoRespond: true });
        workers.push(worker);
        return worker;
      },
    });

    await expect(client.run(requestFixture())).rejects.toMatchObject({ code: "worker-post-failed" });
    const broken = workers[0]!;
    expect(broken.terminateCount).toBe(1);
    await expect(client.run(requestFixture())).resolves.toMatchObject({ status: "ready" });
    const recovered = workers[1]!;
    expect(recovered.terminateCount).toBe(1);
    client.dispose();
  });
});

describe("StudioAutoColorHintsWorkerClient protocol failures", () => {
  it("fails closed on a correlated wrong-version response after ignoring stale ids", async () => {
    const worker = new FakeWorker();
    const client = new StudioAutoColorHintsWorkerClient({ workerFactory: () => worker });
    const pending = client.run(requestFixture());
    await flushMicrotasks();
    const posted = worker.requests[0]!;

    worker.emitSuccess(posted, { requestId: posted.requestId + 100, generation: posted.generation + 100 });
    await flushMicrotasks();
    expect(client.hasActiveJob).toBe(true);
    worker.emitSuccess(posted, { version: 99 as 1 });

    await expect(pending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(worker.terminateCount).toBe(1);
    client.dispose();
  });

  it("deserializes a bounded Worker failure and rejects a malformed correlated plan", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioAutoColorHintsWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const failed = client.run(requestFixture());
    await flushMicrotasks();
    const failedWorker = workers[0]!;
    failedWorker.emitFailure("budget-exceeded");
    await expect(failed).rejects.toMatchObject({ code: "budget-exceeded", name: "RangeError" });

    const malformed = client.run(requestFixture());
    await flushMicrotasks();
    const malformedWorker = workers[1]!;
    const posted = malformedWorker.requests[0]!;
    const plan = planStudioAutoColorHints(posted.request);
    malformedWorker.emitMessage({
      type: "studio-auto-color-hints/success",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId: posted.requestId,
      generation: posted.generation,
      plan: { ...plan, diagnostics: { ...plan.diagnostics, width: 999 } },
    });

    await expect(malformed).rejects.toMatchObject({ code: "worker-protocol" });
    expect(malformedWorker.terminateCount).toBe(1);
    client.dispose();
  });
});
