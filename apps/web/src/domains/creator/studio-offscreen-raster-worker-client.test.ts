import { describe, expect, it } from "vitest";

import {
  createStudioOffscreenRasterSession,
  type StudioOffscreenRasterRunInput,
  type StudioOffscreenRasterSessionOptions,
  type StudioOffscreenRasterWorkerLike,
} from "./studio-offscreen-raster-worker-client";
import {
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  adoptStudioOffscreenPixelBuffer,
  isStudioOffscreenRasterRunMessage,
  type StudioOffscreenRasterResponseMessage,
  type StudioOffscreenRasterRunMessage,
  type StudioOffscreenRasterSource,
} from "./studio-offscreen-raster-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

class FakeWorker implements StudioOffscreenRasterWorkerLike {
  readonly posted: unknown[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCalls = 0;
  throwOnPost = false;
  private readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  private readonly errorListeners = new Set<(event: ErrorEventLike) => void>();

  postMessage(message: unknown, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("structured clone failed");
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEventLike) => void);
    else this.errorListeners.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    else this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emit(data: unknown): void {
    for (const listener of Array.from(this.messageListeners)) listener({ data });
  }

  emitReady(): void {
    this.emit({ version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION, kind: "ready" });
  }

  emitError(): void {
    for (const listener of Array.from(this.errorListeners)) listener({ preventDefault: () => {} });
  }

  get runMessages(): StudioOffscreenRasterRunMessage[] {
    return this.posted.filter((message): message is StudioOffscreenRasterRunMessage =>
      isStudioOffscreenRasterRunMessage(message));
  }

  get cancelledRunIds(): number[] {
    return this.posted
      .filter((message): message is { kind: "cancel"; runId: number } =>
        typeof message === "object" && message !== null
        && (message as { kind?: unknown }).kind === "cancel")
      .map((message) => message.runId);
  }
}

function pixelSource(width = 4, height = 2): StudioOffscreenRasterSource {
  return {
    kind: "pixels",
    width,
    height,
    pixels: adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(width * height * 4)),
    placement: { dx: 0, dy: 0, dw: width, dh: height, opacity: 1, rotation: 0, flipX: false, flipY: false },
  };
}

function input(sources: readonly StudioOffscreenRasterSource[] = [pixelSource()]): StudioOffscreenRasterRunInput {
  return {
    target: { width: 8, height: 4, background: null },
    sources,
    output: { kind: "pixels" },
  };
}

function resultFor(runId: number, width = 8, height = 4): StudioOffscreenRasterResponseMessage {
  return {
    version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
    kind: "result",
    runId,
    width,
    height,
    payload: {
      kind: "pixels",
      pixels: adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(width * height * 4)),
    },
  };
}

/** 테스트는 실제 타이머를 쓰지 않는다 — 타임아웃 경로만 수동으로 발화시킨다. */
function createSession(worker: FakeWorker | null, overrides: StudioOffscreenRasterSessionOptions = {}) {
  const timers = new Map<number, () => void>();
  let nextHandle = 1;
  const session = createStudioOffscreenRasterSession({
    workerFactory: () => worker,
    setTimeoutImpl: (handler) => {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, handler);
      return handle;
    },
    clearTimeoutImpl: (handle) => {
      timers.delete(handle as number);
    },
    ...overrides,
  });
  return {
    session,
    fireOldestTimer(): boolean {
      const entry = timers.entries().next();
      if (entry.done) return false;
      const [handle, handler] = entry.value;
      timers.delete(handle);
      handler();
      return true;
    },
    get pendingTimers(): number {
      return timers.size;
    },
  };
}

describe("studio offscreen raster client — 핸드셰이크와 전송", () => {
  it("warms the Worker handshake without posting a raster job", () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);

    expect(session.warm()).toBe(true);

    expect(worker.runMessages).toHaveLength(0);
    worker.emitReady();
    expect(worker.runMessages).toHaveLength(0);
    session.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  it("reports a warm handshake unavailable after startup failure or disposal", () => {
    const worker = new FakeWorker();
    const harness = createSession(worker);

    expect(harness.session.warm()).toBe(true);
    expect(harness.fireOldestTimer()).toBe(true);
    expect(worker.terminateCalls).toBe(1);
    expect(harness.session.warm()).toBe(false);

    harness.session.dispose();
    expect(harness.session.warm()).toBe(false);
    expect(createSession(null).session.warm()).toBe(false);
    expect(createStudioOffscreenRasterSession({ workerFactory: null }).warm()).toBe(false);
  });

  it("ready 이전에는 post 하지 않고, ready 직후 하나만 보낸다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("page:1", input());

    expect(worker.runMessages).toHaveLength(0);
    worker.emitReady();
    expect(worker.runMessages).toHaveLength(1);

    const posted = worker.runMessages[0];
    worker.emit(resultFor(posted.runId));
    await expect(pending).resolves.toMatchObject({ ok: true, runId: posted.runId, width: 8, height: 4 });
    session.dispose();
  });

  it("요청의 모든 픽셀 버퍼를 정확히 transfer 목록에 싣는다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const first = pixelSource(4, 2);
    const second = pixelSource(2, 2);
    const pending = session.run("page:1", input([first, second]));
    worker.emitReady();

    const transfers = worker.transfers[0];
    expect(transfers).toHaveLength(2);
    expect(transfers).toContain((first as { pixels: ArrayBuffer }).pixels);
    expect(transfers).toContain((second as { pixels: ArrayBuffer }).pixels);

    worker.emit(resultFor(worker.runMessages[0].runId));
    await pending;
    session.dispose();
  });

  it("Worker 를 만들 수 없으면 throw 대신 worker-failed 로 정산한다", async () => {
    const { session } = createSession(null);
    await expect(session.run("page:1", input())).resolves.toMatchObject({
      ok: false,
      code: "worker-failed",
    });
    session.dispose();
  });

  it("workerFactory: null 은 unsupported 를 돌려줘 호출자가 메인스레드로 폴백하게 한다", async () => {
    const session = createStudioOffscreenRasterSession({ workerFactory: null });
    await expect(session.run("page:1", input())).resolves.toMatchObject({
      ok: false,
      code: "unsupported",
    });
    session.dispose();
  });

  it("Worker 가 unavailable 을 알리면 그 이후 모든 요청이 unsupported 로 즉시 실패한다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("page:1", input());
    worker.emit({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "unavailable",
      code: "offscreen-canvas",
    });

    await expect(pending).resolves.toMatchObject({ ok: false, code: "unsupported" });
    expect(worker.terminateCalls).toBe(1);
    await expect(session.run("page:2", input())).resolves.toMatchObject({ ok: false, code: "unsupported" });
    session.dispose();
  });
});

describe("studio offscreen raster client — runId 중재", () => {
  it("늦게 도착한 옛 런의 결과를 커밋하지 않는다(stale rejected)", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker, { policy: "queue-all" });
    const first = session.run("a", input());
    worker.emitReady();
    const firstRunId = worker.runMessages[0].runId;
    worker.emit(resultFor(firstRunId, 8, 4));
    await expect(first).resolves.toMatchObject({ ok: true, runId: firstRunId });

    const second = session.run("b", input());
    const secondRunId = worker.runMessages[1].runId;
    // 이미 정산된 옛 런의 결과가 다시 도착해도 두 번째 요청을 오염시키면 안 된다.
    worker.emit(resultFor(firstRunId, 2, 2));
    worker.emit(resultFor(secondRunId, 8, 4));

    await expect(second).resolves.toMatchObject({ ok: true, runId: secondRunId, width: 8 });
    session.dispose();
  });

  it("모르는 runId 응답은 조용히 무시되고 비행 중 잡을 죽이지 않는다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("a", input());
    worker.emitReady();
    const runId = worker.runMessages[0].runId;

    worker.emit(resultFor(runId + 999));
    worker.emit(resultFor(runId));
    await expect(pending).resolves.toMatchObject({ ok: true, runId });
    session.dispose();
  });
});

describe("studio offscreen raster client — 코얼레싱과 백프레셔", () => {
  it("버스트 중 같은 jobKey 요청은 최신 하나만 Worker 로 나간다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const results = [
      session.run("thumb", input()),
      session.run("thumb", input()),
      session.run("thumb", input()),
    ];
    worker.emitReady();

    expect(worker.runMessages).toHaveLength(1);
    const survivor = worker.runMessages[0];
    worker.emit(resultFor(survivor.runId));

    const settled = await Promise.all(results);
    expect(settled.filter((entry) => entry.ok)).toHaveLength(1);
    expect(settled.filter((entry) => !entry.ok && entry.code === "superseded")).toHaveLength(2);
    session.dispose();
  });

  it("비행 중인 잡이 같은 키로 대체되면 Worker 에 cancel 을 보낸다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const first = session.run("thumb", input());
    worker.emitReady();
    const firstRunId = worker.runMessages[0].runId;

    const second = session.run("thumb", input());
    expect(worker.cancelledRunIds).toEqual([firstRunId]);
    // 대체된 런은 결과를 기다리지 않고 즉시 superseded 로 정산된다.
    await expect(first).resolves.toMatchObject({ ok: false, code: "superseded" });
    // 직렬 계약: 옛 런의 응답이 오기 전에는 다음 잡을 밀어넣지 않는다.
    expect(worker.runMessages).toHaveLength(1);

    // Worker 가 취소를 확인해 응답하면 슬롯이 열리고 최신 잡이 나간다.
    worker.emit({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "failure",
      runId: firstRunId,
      code: "cancelled",
      message: "취소",
    });
    expect(worker.runMessages).toHaveLength(2);
    const secondRunId = worker.runMessages[1].runId;
    expect(secondRunId).toBeGreaterThan(firstRunId);
    worker.emit(resultFor(secondRunId));
    await expect(second).resolves.toMatchObject({ ok: true, runId: secondRunId });
    session.dispose();
  });

  it("서로 다른 키가 상한을 넘으면 가장 오래된 요청을 superseded 로 버린다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker, { maxQueued: 2 });
    const first = session.run("a", input());
    const second = session.run("b", input());
    const third = session.run("c", input());

    await expect(first).resolves.toMatchObject({ ok: false, code: "superseded" });
    worker.emitReady();
    expect(worker.runMessages).toHaveLength(1);
    expect(worker.runMessages[0].jobKey).toBe("b");

    worker.emit(resultFor(worker.runMessages[0].runId));
    await expect(second).resolves.toMatchObject({ ok: true });
    worker.emit(resultFor(worker.runMessages[1].runId));
    await expect(third).resolves.toMatchObject({ ok: true });
    session.dispose();
  });
});

describe("studio offscreen raster client — 취소와 오류", () => {
  it("대기 중 abort 는 Worker 로 나가지 않고 cancelled 로 정산한다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const controller = new AbortController();
    const pending = session.run("a", input(), { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ ok: false, code: "cancelled" });
    worker.emitReady();
    expect(worker.runMessages).toHaveLength(0);
    session.dispose();
  });

  it("이미 abort 된 시그널은 즉시 cancelled 로 끝난다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const controller = new AbortController();
    controller.abort();

    await expect(session.run("a", input(), { signal: controller.signal })).resolves.toMatchObject({
      ok: false,
      code: "cancelled",
    });
    session.dispose();
  });

  it("비행 중 abort 는 busy Worker 를 닫고 새 ready Worker 에서 다음 잡을 진행시킨다", async () => {
    const firstWorker = new FakeWorker();
    const replacementWorker = new FakeWorker();
    const workers = [firstWorker, replacementWorker];
    const { session } = createSession(firstWorker, {
      policy: "queue-all",
      workerFactory: () => workers.shift() ?? null,
    });
    const controller = new AbortController();
    const first = session.run("a", input(), { signal: controller.signal });
    firstWorker.emitReady();
    const second = session.run("b", input());

    controller.abort();
    expect(firstWorker.cancelledRunIds).toEqual([]);
    expect(firstWorker.terminateCalls).toBe(1);
    expect(replacementWorker.runMessages).toHaveLength(0);
    await expect(first).resolves.toMatchObject({ ok: false, code: "cancelled" });

    replacementWorker.emitReady();
    expect(replacementWorker.runMessages).toHaveLength(1);
    const secondRunId = replacementWorker.runMessages[0].runId;
    replacementWorker.emit(resultFor(secondRunId));
    await expect(second).resolves.toMatchObject({ ok: true, runId: secondRunId });
    session.dispose();
  });

  it("Worker 실패 응답은 코드를 보존한 타입 실패로 전달된다(throw 아님)", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("a", input());
    worker.emitReady();

    worker.emit({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "failure",
      runId: worker.runMessages[0].runId,
      code: "encode-failed",
      message: "인코딩 실패",
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      runId: worker.runMessages[0].runId,
      code: "encode-failed",
      message: "인코딩 실패",
    });
    session.dispose();
  });

  it("알 수 없는 응답은 Worker 를 닫고 protocol 실패로 전부 정산한다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("a", input());
    worker.emitReady();
    worker.emit({ version: 99, kind: "result" });

    await expect(pending).resolves.toMatchObject({ ok: false, code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
    expect(session.warm()).toBe(false);
    await expect(session.run("after-protocol", input())).resolves.toMatchObject({
      ok: false,
      code: "protocol",
    });
    session.dispose();
  });

  it("Worker onerror 는 worker-failed 로 환원된다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    const pending = session.run("a", input());
    worker.emitReady();
    worker.emitError();

    await expect(pending).resolves.toMatchObject({ ok: false, code: "worker-failed" });
    expect(session.warm()).toBe(false);
    await expect(session.run("after-error", input())).resolves.toMatchObject({
      ok: false,
      code: "worker-failed",
    });
    session.dispose();
  });

  it("postMessage 가 던지면 그 요청만 worker-failed 로 끝난다", async () => {
    const worker = new FakeWorker();
    worker.throwOnPost = true;
    const { session } = createSession(worker);
    const pending = session.run("a", input());
    worker.emitReady();

    await expect(pending).resolves.toMatchObject({ ok: false, code: "worker-failed" });
    session.dispose();
  });

  it("실행 타임아웃은 Worker 를 재생성하고 timeout 으로 정산한다", async () => {
    const worker = new FakeWorker();
    const harness = createSession(worker);
    const pending = harness.session.run("a", input());
    worker.emitReady();
    expect(worker.runMessages).toHaveLength(1);

    expect(harness.fireOldestTimer()).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(worker.terminateCalls).toBe(1);
    harness.session.dispose();
  });

  it("dispose 는 대기·비행 요청을 모두 cancelled 로 회수하고 Worker 를 종료한다", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker, { policy: "queue-all" });
    const first = session.run("a", input());
    const second = session.run("b", input());
    worker.emitReady();

    session.dispose();
    await expect(first).resolves.toMatchObject({ ok: false, code: "cancelled" });
    await expect(second).resolves.toMatchObject({ ok: false, code: "cancelled" });
    expect(worker.terminateCalls).toBe(1);
    await expect(session.run("c", input())).resolves.toMatchObject({ ok: false, code: "cancelled" });
  });
});
