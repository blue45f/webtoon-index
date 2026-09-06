import { describe, expect, it, vi } from "vitest";

import { prepareStudioLayerLiftMask } from "./studio-layer-lift-mask";
import {
  StudioLayerLiftMaskWorkerClient,
  type StudioLayerLiftMaskWorkerLike,
} from "./studio-layer-lift-mask-worker-client";
import {
  createStudioLayerLiftMaskWorkerResultMessage,
  studioLayerLiftMaskWorkerResponseTransfers,
  type StudioLayerLiftMaskWorkerInput,
  type StudioLayerLiftMaskWorkerResponseMessage,
  type StudioLayerLiftMaskWorkerRunMessage,
} from "./studio-layer-lift-mask-worker-protocol";

function input(
  options: StudioLayerLiftMaskWorkerInput["options"] = {
    threshold: 0.5,
  },
): StudioLayerLiftMaskWorkerInput {
  return {
    confidence: {
      width: 2,
      height: 1,
      confidence: Float32Array.from([1, 0]),
    },
    sourceAlpha: {
      width: 4,
      height: 1,
      alpha: Uint8ClampedArray.from([64, 128, 192, 255]),
    },
    options,
  };
}

function prepareReceived(message: StudioLayerLiftMaskWorkerRunMessage) {
  const confidence = message.request.planes[0];
  const source = message.request.planes[1];
  const options = message.request.options;
  return prepareStudioLayerLiftMask({
    confidence: {
      width: confidence.width,
      height: confidence.height,
      confidence: new Float32Array(confidence.buffer),
    },
    sourceAlpha: {
      width: source.width,
      height: source.height,
      alpha: new Uint8ClampedArray(source.buffer),
    },
    options: {
      threshold: options.threshold,
      feather: options.feather,
      ...(options.morphology === null
        ? {}
        : { morphology: options.morphology }),
      ...(options.islands === null ? {} : { islands: options.islands }),
    },
  });
}

class ControlledWorker implements StudioLayerLiftMaskWorkerLike {
  onmessage: StudioLayerLiftMaskWorkerLike["onmessage"] = null;
  onerror: StudioLayerLiftMaskWorkerLike["onerror"] = null;
  onmessageerror: StudioLayerLiftMaskWorkerLike["onmessageerror"] = null;
  readonly messages: StudioLayerLiftMaskWorkerRunMessage[] = [];
  readonly requestTransfers: Transferable[][] = [];
  readonly responseTransferCounts: number[] = [];
  terminateCount = 0;

  postMessage(
    message: StudioLayerLiftMaskWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    this.requestTransfers.push([...transfer]);
    this.messages.push(structuredClone(message, { transfer }));
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  complete(
    index = this.messages.length - 1,
    identity: Readonly<{ requestId: number; epoch: number }> | null = null,
    listener = this.onmessage,
  ): ArrayBuffer[] {
    const request = this.messages[index]!;
    const canonical = createStudioLayerLiftMaskWorkerResultMessage(
      request,
      prepareReceived(request),
    );
    const response: StudioLayerLiftMaskWorkerResponseMessage = identity === null
      ? canonical
      : { ...canonical, ...identity };
    const transfers = studioLayerLiftMaskWorkerResponseTransfers(response);
    const buffers = transfers.map((transfer) => transfer as ArrayBuffer);
    this.responseTransferCounts.push(transfers.length);
    const delivered = structuredClone(response, { transfer: transfers });
    listener?.({
      data: delivered,
    } as MessageEvent<StudioLayerLiftMaskWorkerResponseMessage>);
    return buffers;
  }
}

describe("StudioLayerLiftMaskWorkerClient", () => {
  it("transfers ownership both ways and reuses one warm Worker sequentially", async () => {
    const worker = new ControlledWorker();
    let factoryCalls = 0;
    const client = new StudioLayerLiftMaskWorkerClient({
      workerFactory: () => {
        factoryCalls += 1;
        return worker;
      },
    });
    const firstInput = input();
    const first = client.run(firstInput);

    expect(firstInput.confidence.confidence.byteLength).toBe(0);
    expect(firstInput.sourceAlpha.alpha.byteLength).toBe(0);
    expect(worker.requestTransfers[0]).toHaveLength(2);
    const firstMessage = worker.messages[0]!;
    const workerOutputBuffers = worker.complete();
    const firstResult = await first;
    expect(workerOutputBuffers.every((buffer) => buffer.byteLength === 0))
      .toBe(true);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    expect([...firstResult.value.foregroundAlpha.alpha]).toEqual([
      64,
      128,
      0,
      0,
    ]);

    const second = client.run(input());
    const secondMessage = worker.messages[1]!;
    expect(secondMessage.epoch).toBe(firstMessage.epoch);
    expect(secondMessage.requestId).toBeGreaterThan(firstMessage.requestId);
    worker.complete(1);
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(factoryCalls).toBe(1);
    expect(worker.responseTransferCounts).toEqual([4, 4]);

    client.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("terminates on abort, ignores the retired epoch, and recovers with a new Worker", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const client = new StudioLayerLiftMaskWorkerClient({
      workerFactory: () => workers.shift() ?? null,
    });
    const controller = new AbortController();
    const first = client.run(input(), { signal: controller.signal });
    const retiredListener = firstWorker.onmessage;
    const firstEpoch = firstWorker.messages[0]!.epoch;

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminateCount).toBe(1);
    firstWorker.complete(0, null, retiredListener);

    const second = client.run(input());
    expect(secondWorker.messages[0]!.epoch).toBeGreaterThan(firstEpoch);
    secondWorker.complete();
    await expect(second).resolves.toMatchObject({ ok: true });
    client.dispose();
  });

  it("hard-terminates a synchronous core realm at timeout", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ControlledWorker();
      const client = new StudioLayerLiftMaskWorkerClient({
        workerFactory: () => worker,
        timeoutMs: 5,
      });
      const pending = client.run(input());
      const rejected = expect(pending).rejects.toMatchObject({
        code: "worker-timeout",
      });

      await vi.advanceTimersByTimeAsync(5);
      await rejected;
      expect(worker.terminateCount).toBe(1);
      expect(client.activeCount).toBe(0);
      client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale request identity while accepting the current response", async () => {
    const worker = new ControlledWorker();
    const client = new StudioLayerLiftMaskWorkerClient({
      workerFactory: () => worker,
    });
    const pending = client.run(input());
    const message = worker.messages[0]!;

    worker.complete(0, {
      requestId: message.requestId + 1,
      epoch: message.epoch,
    });
    expect(client.activeCount).toBe(1);
    worker.complete();
    await expect(pending).resolves.toMatchObject({ ok: true });
    client.dispose();
  });

  it("keeps capacity at one by superseding with a fresh epoch", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const client = new StudioLayerLiftMaskWorkerClient({
      workerFactory: () => workers.shift() ?? null,
    });
    const first = client.run(input());
    const firstRejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = client.run(input());

    await firstRejected;
    expect(firstWorker.terminateCount).toBe(1);
    expect(client.activeCount).toBe(1);
    secondWorker.complete();
    await expect(second).resolves.toMatchObject({ ok: true });
    client.dispose();
  });

  it("rejects aggregate work before creating a Worker or detaching inputs", async () => {
    const width = 2_000;
    const height = 1_000;
    const expensive: StudioLayerLiftMaskWorkerInput = {
      confidence: {
        width,
        height,
        confidence: new Float32Array(width * height),
      },
      sourceAlpha: {
        width,
        height,
        alpha: new Uint8ClampedArray(width * height),
      },
      options: {
        morphology: {
          operation: "open",
          iterations: 8,
          connectivity: 8,
        },
        islands: { minimumPixels: 2, connectivity: 8 },
      },
    };
    let factoryCalls = 0;
    const client = new StudioLayerLiftMaskWorkerClient({
      workerFactory: () => {
        factoryCalls += 1;
        return new ControlledWorker();
      },
    });

    await expect(client.run(expensive)).rejects.toMatchObject({
      code: "work-budget-exceeded",
    });
    expect(factoryCalls).toBe(0);
    expect(expensive.confidence.confidence.byteLength)
      .toBe(width * height * 4);
    expect(expensive.sourceAlpha.alpha.byteLength).toBe(width * height);
    client.dispose();
  });
});
