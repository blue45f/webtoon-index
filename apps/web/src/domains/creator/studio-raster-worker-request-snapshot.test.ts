import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { disposeStudioRetouchModuleWorker, runStudioRetouchWorker } from "./studio-retouch-worker-client";
import { assertStudioRetouchWorkerRequest } from "./studio-retouch-worker-protocol";
import { disposeStudioSmudgeModuleWorker, runStudioSmudgeWorker } from "./studio-smudge-worker-client";

import type { StudioRetouchWorkerClientOptions } from "./studio-retouch-worker-client";
import type { StudioRetouchWorkerRunMessage, StudioRetouchWorkerRunRequest } from "./studio-retouch-worker-protocol";
import type { StudioSmudgeWorkerClientOptions } from "./studio-smudge-worker-client";
import type { StudioSmudgeWorkerRunMessage, StudioSmudgeWorkerRunRequest } from "./studio-smudge-worker-protocol";

type Kind = "smudge" | "dodge-burn" | "wet-mix";
type Request = StudioSmudgeWorkerRunRequest | StudioRetouchWorkerRunRequest;
type Message = StudioSmudgeWorkerRunMessage | StudioRetouchWorkerRunMessage;
type Outcome = { value?: { execution: string }; error?: unknown };

function fixture(kind: Kind) {
  const points = [{ x: 2, y: 3 }, { x: 6, y: 5 }];
  const base = { data: new Uint8ClampedArray(8 * 8 * 4).fill(128), w: 8, h: 8, points };
  const request: Request = kind === "smudge"
    ? { ...base, radiusPx: 3, strength: 0.5 }
    : kind === "dodge-burn"
      ? { ...base, kind, settings: { radiusPx: 3, hardness: 0.5, exposure: 50, mode: "dodge", range: "midtones", sponge: "saturate" } }
      : { ...base, kind, settings: { radiusPx: 3, hardness: 0.5, strength: 0.6, wetness: 0.55, pickup: 0.45, paintColor: { r: 200, g: 20, b: 30 }, initialLoad: 0.8, loadDepletion: 0.1, mixModel: "spectral-wgm" } };
  return {
    request,
    mutate() {
      points[0]!.x = 700;
      points.push({ x: 900, y: 901 });
      if ("settings" in request) request.settings.hardness = 0.1;
      if ("kind" in request && request.kind === "wet-mix") {
        request.settings.paintColor.r = 7;
        request.settings.initialLoad = 0;
        request.settings.loadDepletion = 1;
        request.settings.mixModel = "lerp";
      }
    },
  };
}

function run(request: Request, options: StudioSmudgeWorkerClientOptions & StudioRetouchWorkerClientOptions = {}): Promise<Outcome> {
  const promise = "kind" in request
    ? runStudioRetouchWorker(request, options)
    : runStudioSmudgeWorker(request, options);
  // Observe rejection immediately, including cleanup after an assertion failure.
  return promise.then((value) => ({ value }), (error: unknown) => ({ error }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

async function withTransport(body: (workers: ControlledWorker[]) => Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const workers: ControlledWorker[] = [];
  class Worker extends ControlledWorker {
    constructor(_url: URL, options: { name: string }) {
      super(options.name.endsWith("smudge") ? "smudge" : "retouch");
      workers.push(this);
    }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: Worker });
  try {
    await body(workers);
  } finally {
    disposeStudioSmudgeModuleWorker();
    disposeStudioRetouchModuleWorker();
    for (const worker of workers) worker.onerror?.({ message: "test cleanup" });
    await flush();
    if (previous) Object.defineProperty(globalThis, "Worker", previous);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
}

/** Real structured clone/transfer, controlled scheduling only; no rendered-pixel assertion. */
class ControlledWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { readonly error?: unknown; readonly message?: string; preventDefault?(): void }) => void) | null = null;
  onmessageerror: ((event: { data: unknown }) => void) | null = null;
  posted: Message[] = [];
  pending: Message[] = [];
  terminated = false;
  constructor(readonly engine: "smudge" | "retouch") {}
  ready(): void {
    this.onmessage?.({ data: { type: `studio-${this.engine}/ready`, version: 1 } });
  }
  postMessage(message: Message, transfer: Transferable[]): void {
    const received = structuredClone(message, { transfer });
    if (received.type === "studio-retouch/run") assertStudioRetouchWorkerRequest(received.request);
    this.posted.push(received);
    this.pending.push(received);
  }
  complete(): void {
    const message = this.pending.shift();
    assert.ok(message, "a real client request must have reached the transport");
    const request = message.request;
    this.onmessage?.({ data: "kind" in request
      ? { type: "studio-retouch/success", version: 1, kind: request.kind, w: request.w, h: request.h, data: request.data }
      : { type: "studio-smudge/success", version: 1, data: request.data } });
  }
  terminate(): void { this.terminated = true; this.pending = []; }
}

function assertSuccess(result: Outcome): void {
  if (result.error) throw result.error;
  assert.equal(result.value?.execution, "worker");
}

for (const kind of ["smudge", "dodge-burn", "wet-mix"] as const) {
  describe(`${kind} admission snapshot`, () => {
    it("owns points and settings while the Worker is preparing", async () => withTransport(async (workers) => {
      const input = fixture(kind);
      const expected = structuredClone(input.request);
      const result = run(input.request);
      input.mutate();
      await flush();
      workers[0]!.ready();
      await flush();
      assert.deepEqual(workers[0]!.posted[0]?.request, expected);
      workers[0]!.complete();
      assertSuccess(await result);
    }));

    it("also snapshots the isolated custom Worker path before readiness", async () => withTransport(async (workers) => {
      const input = fixture(kind);
      const expected = structuredClone(input.request);
      const worker = new ControlledWorker(kind === "smudge" ? "smudge" : "retouch");
      workers.push(worker);
      const result = run(input.request, { workerFactory: () => worker });
      input.mutate();
      worker.ready();
      assert.deepEqual(worker.posted[0]?.request, expected);
      worker.complete();
      assertSuccess(await result);
      assert.equal(worker.terminated, true);
    }));

    it("owns a waiting request independently of the active stroke", async () => withTransport(async (workers) => {
      const active = run(fixture(kind).request);
      await flush();
      workers[0]!.ready();
      const input = fixture(kind);
      const expected = structuredClone(input.request);
      const waiting = run(input.request);
      input.mutate();
      workers[0]!.complete();
      assertSuccess(await active);
      await flush();
      assert.deepEqual(workers[0]!.posted[1]?.request, expected);
      workers[0]!.complete();
      assertSuccess(await waiting);
      assert.equal(workers.length, 1);
    }));

    for (const location of ["request", "point", ...(kind !== "smudge" ? ["settings"] : []), ...(kind === "wet-mix" ? ["color"] : [])]) {
      it(`does not serialize incidental functions on ${location}`, async () => withTransport(async (workers) => {
        const { request } = fixture(kind);
        const expected = structuredClone(request);
        const target = location === "request" ? request
          : location === "point" ? request.points[0]!
            : "settings" in request
              ? location === "settings" ? request.settings
                : request.kind === "wet-mix" ? request.settings.paintColor : request.settings
              : request;
        Object.assign(target, { uiCallback: () => undefined });
        const result = run(request);
        await flush();
        workers[0]!.ready();
        await flush();
        if (!workers[0]!.posted.length) assertSuccess(await result);
        assert.deepEqual(workers[0]!.posted[0]?.request, expected);
        workers[0]!.complete();
        assertSuccess(await result);
      }));
    }

    for (const storage of ["dedicated", "subarray", "shared"] as const) {
      it(`preserves ${storage} pixel ownership semantics`, async () => withTransport(async (workers) => {
        const buffer = storage === "shared" ? new SharedArrayBuffer(264) : new ArrayBuffer(storage === "dedicated" ? 256 : 264);
        const whole = new Uint8ClampedArray(buffer).fill(73);
        const data = storage === "dedicated" ? whole : whole.subarray(4, 260);
        const request = { ...fixture(kind).request, data };
        const result = run(request);
        await flush();
        workers[0]!.ready();
        await flush();
        const posted = workers[0]!.posted[0]!.request.data;
        assert.equal(posted.byteLength, 256);
        assert.equal(posted.buffer.byteLength, 256);
        assert.ok(posted.every((value) => value === 73));
        if (storage === "dedicated") assert.equal(buffer.byteLength, 0);
        else { assert.equal(buffer.byteLength, 264); assert.ok(whole.every((value) => value === 73)); }
        workers[0]!.complete();
        assertSuccess(await result);
      }));
    }

    it("does not visit extra getters or change frozen non-pixel inputs", async () => withTransport(async (workers) => {
      const { request } = fixture(kind);
      const expected = structuredClone(request);
      const fail = () => { throw new Error("unrelated UI property was read"); };
      Object.defineProperty(request, "uiOnly", { enumerable: true, get: fail });
      for (const point of request.points) {
        Object.defineProperty(point, "uiOnly", { enumerable: true, get: fail });
        Object.freeze(point);
      }
      Object.freeze(request.points);
      if ("settings" in request) {
        Object.defineProperty(request.settings, "uiOnly", { enumerable: true, get: fail });
        if (request.kind === "wet-mix") Object.freeze(request.settings.paintColor);
        Object.freeze(request.settings);
      }
      Object.freeze(request);
      const result = run(request);
      await flush();
      if (!workers[0]) assertSuccess(await result);
      workers[0]!.ready();
      if (!workers[0]!.posted.length) assertSuccess(await result);
      assert.deepEqual(workers[0]!.posted[0]?.request, expected);
      workers[0]!.complete();
      assertSuccess(await result);
    }));

    it("rejects invalid coordinates before constructing a Worker", async () => withTransport(async (workers) => {
      const { request } = fixture(kind);
      request.points[0]!.x = Number.NaN;
      assert.ok((await run(request)).error instanceof TypeError);
      assert.equal(workers.length, 0);
    }));

    it("cancels a waiting snapshot without posting it or stopping the active stroke", async () => withTransport(async (workers) => {
      const active = run(fixture(kind).request);
      await flush();
      workers[0]!.ready();
      const input = fixture(kind);
      const controller = new AbortController();
      const waiting = run(input.request, { signal: controller.signal });
      input.mutate();
      controller.abort();
      assert.equal(((await waiting).error as Error).name, "AbortError");
      assert.equal(workers[0]!.terminated, false);
      assert.equal(workers[0]!.posted.length, 1);
      workers[0]!.complete();
      assertSuccess(await active);
    }));

    it("isolates 1,000 queued submissions while the caller reuses one mutable journal", async () => withTransport(async (workers) => {
      const active = run(fixture(kind).request);
      await flush();
      workers[0]!.ready();
      const input = fixture(kind);
      const results: Promise<Outcome>[] = [];
      const expected: Request[] = [];
      for (let index = 0; index < 1_000; index++) {
        input.request.points[0]!.x = index;
        if ("settings" in input.request) input.request.settings.hardness = (index % 10) / 10;
        const request = { ...input.request, data: new Uint8ClampedArray(256).fill(index % 256) };
        expected.push(structuredClone(request));
        results.push(run(request));
      }
      input.mutate();
      workers[0]!.complete();
      assertSuccess(await active);
      const observed: Request[] = [];
      for (const result of results) {
        await flush();
        observed.push(workers[0]!.pending[0]!.request);
        workers[0]!.complete();
        assertSuccess(await result);
      }
      assert.equal(workers.length, 1);
      assert.equal(workers[0]!.posted.length, 1_001);
      for (let index = 0; index < expected.length; index++) {
        assert.deepEqual(observed[index], expected[index], `submission ${index}`);
      }
    }));
  });
}

describe("wet-mix optional settings", () => {
  for (const state of ["absent", "zero", "explicit-undefined"] as const) {
    it(`preserves ${state} optional controls without changing kernel defaults`, async () => withTransport(async (workers) => {
      const { request } = fixture("wet-mix");
      assert.ok("kind" in request && request.kind === "wet-mix");
      delete request.settings.loadDepletion;
      delete request.settings.initialLoad;
      delete request.settings.mixModel;
      if (state === "zero") Object.assign(request.settings, { loadDepletion: 0, initialLoad: 0, mixModel: "lerp" });
      const expected = structuredClone(request);
      if (state === "explicit-undefined") Object.assign(request.settings, { loadDepletion: undefined, initialLoad: undefined, mixModel: undefined });
      const result = run(request);
      await flush();
      workers[0]!.ready();
      const posted = workers[0]!.posted[0]!.request;
      assert.ok("kind" in posted && posted.kind === "wet-mix");
      assert.deepEqual(posted.settings.paintColor, expected.settings.paintColor);
      assert.equal(posted.settings.initialLoad, expected.settings.initialLoad);
      assert.equal(posted.settings.loadDepletion, expected.settings.loadDepletion);
      assert.equal(posted.settings.mixModel, expected.settings.mixModel);
      workers[0]!.complete();
      assertSuccess(await result);
    }));
  }
});
