import { Image, encodePng } from "image-js";
import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { isStudioLayerLiftTrustedArtifactPair } from "./studio-layer-lift-artifact";
import {
  StudioLayerLiftComposeWorkerClient,
  isStudioLayerLiftTrustedWorkerComposition,
} from "./studio-layer-lift-compose-worker-client";
import {
  studioLayerLiftComposeWorkerResultTransfers,
} from "./studio-layer-lift-compose-worker-protocol";
import {
  executeStudioLayerLiftComposeWorkerMessage,
} from "./studio-layer-lift-compose.worker";
import { isTrustedStudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";

import type {
  StudioLayerLiftComposeWorkerLike,
} from "./studio-layer-lift-compose-worker-client";
import type {
  StudioLayerLiftComposeWorkerRequest,
  StudioLayerLiftComposeWorkerResponse,
} from "./studio-layer-lift-compose-worker-protocol";
import type {
  StudioLayerLiftCompositorInput,
  StudioLayerLiftCompositorPngEncoder,
} from "./studio-layer-lift-compositor";

function hash(bytes: Uint8Array | Uint8ClampedArray): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ))}`;
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function input(suffix = "1"): StudioLayerLiftCompositorInput {
  const sourceRgba = Uint8ClampedArray.from([
    10, 20, 30, 255,
    200, 10, 20, 128,
    50, 60, 70, 255,
    90, 100, 110, 255,
  ]);
  const foregroundMask = Uint8Array.from([0, 255, 128, 0]);
  return {
    requestId: `worker-request-${suffix}`,
    sourceId: `worker-source-${suffix}`,
    width: 4,
    height: 1,
    sourceSha256: hash(sourceRgba),
    sourceRgba,
    providerReceiptSha256: digest("a"),
    providerLayers: [{
      layerId: "character",
      role: "character",
      order: 0,
      rgbaSha256: digest("b"),
      maskSha256: hash(foregroundMask),
    }],
    foregroundLayerId: "character",
    foregroundMaskSha256: hash(foregroundMask),
    foregroundMask,
    backgroundOutputId: `background-output-${suffix}`,
    foregroundOutputId: `foreground-output-${suffix}`,
    fillTilePixels: 8,
  };
}

const encodePlane: StudioLayerLiftCompositorPngEncoder = async (plane) => {
  const png = encodePng(new Image(plane.width, plane.height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: new Uint8Array(
      plane.bytes.buffer,
      plane.bytes.byteOffset,
      plane.bytes.byteLength,
    ),
  }));
  return png.slice().buffer as ArrayBuffer;
};

const decodeDimensions = async () => ({ width: 4, height: 1 });

class ControlledWorker implements StudioLayerLiftComposeWorkerLike {
  onmessage: StudioLayerLiftComposeWorkerLike["onmessage"] = null;
  onerror: StudioLayerLiftComposeWorkerLike["onerror"] = null;
  onmessageerror: StudioLayerLiftComposeWorkerLike["onmessageerror"] = null;
  readonly messages: StudioLayerLiftComposeWorkerRequest[] = [];
  readonly requestTransferCounts: number[] = [];
  readonly responseTransferCounts: number[] = [];
  terminateCount = 0;

  postMessage(
    message: StudioLayerLiftComposeWorkerRequest,
    transfer: Transferable[],
  ): void {
    this.requestTransferCounts.push(transfer.length);
    this.messages.push(structuredClone(message, { transfer }));
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  async complete(
    index = this.messages.length - 1,
    options: Readonly<{
      readonly identity?: {
        readonly generation: number;
        readonly sequence: number;
      };
      readonly mutate?: (
        response: StudioLayerLiftComposeWorkerResponse,
      ) => StudioLayerLiftComposeWorkerResponse;
      readonly listener?: StudioLayerLiftComposeWorkerLike["onmessage"];
    }> = {},
  ): Promise<void> {
    const request = this.messages[index]!;
    const dispatch = await executeStudioLayerLiftComposeWorkerMessage(request, {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    });
    let response: StudioLayerLiftComposeWorkerResponse = dispatch.response;
    if (options.identity) {
      response = { ...response, ...options.identity };
    }
    if (options.mutate) response = options.mutate(response);
    const transfers = response.kind === "studio-layer-lift-compose/result"
      ? [...studioLayerLiftComposeWorkerResultTransfers(response)]
      : [];
    this.responseTransferCounts.push(transfers.length);
    const delivered = structuredClone(response, { transfer: transfers });
    (options.listener ?? this.onmessage)?.({
      data: delivered,
    } as MessageEvent<StudioLayerLiftComposeWorkerResponse>);
    expect(transfers.every(
      (transfer) => (transfer as ArrayBuffer).byteLength === 0,
    )).toBe(true);
  }
}

describe("StudioLayerLiftComposeWorkerClient", () => {
  it("keeps caller pixels, transfers two request copies, and re-admits five outputs", async () => {
    const worker = new ControlledWorker();
    let factoryCalls = 0;
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => {
        factoryCalls += 1;
        return worker;
      },
    });
    const raw = input();
    const sourceBefore = new Uint8ClampedArray(raw.sourceRgba);
    const maskBefore = new Uint8Array(raw.foregroundMask);
    const pending = client.run(raw);

    expect(raw.sourceRgba).toEqual(sourceBefore);
    expect(raw.foregroundMask).toEqual(maskBefore);
    expect(raw.sourceRgba.byteLength).toBe(16);
    expect(raw.foregroundMask.byteLength).toBe(4);
    expect(worker.requestTransferCounts).toEqual([2]);
    await worker.complete();
    const result = await pending;

    expect(isStudioLayerLiftTrustedWorkerComposition(result)).toBe(true);
    expect(isStudioLayerLiftTrustedArtifactPair(result.artifacts)).toBe(true);
    expect(
      isTrustedStudioLayerLiftCompositionReceipt(result.compositionReceipt),
    ).toBe(true);
    expect(result.backgroundRgba.sha256)
      .toBe(result.diagnostics.backgroundRgbaSha256);
    expect(result.foregroundRgba.sha256)
      .toBe(result.diagnostics.foregroundRgbaSha256);
    expect(result.removalMask.bytes).toEqual(maskBefore);
    expect(worker.responseTransferCounts).toEqual([5]);

    const second = client.run(input("2"));
    await worker.complete(1);
    await expect(second).resolves.toMatchObject({
      requestId: "worker-request-2",
    });
    expect(factoryCalls).toBe(1);
    client.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("terminates on abort and ignores a retired Worker response", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => workers.shift() ?? null,
    });
    const controller = new AbortController();
    const first = client.run(input("abort"), { signal: controller.signal });
    const retiredListener = firstWorker.onmessage;
    const firstGeneration = firstWorker.messages[0]!.generation;

    controller.abort();
    await expect(first).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(firstWorker.terminateCount).toBe(1);
    await firstWorker.complete(0, { listener: retiredListener });

    const second = client.run(input("recovered"));
    expect(secondWorker.messages[0]!.generation)
      .toBeGreaterThan(firstGeneration);
    await secondWorker.complete();
    await expect(second).resolves.toMatchObject({
      requestId: "worker-request-recovered",
    });
    client.dispose();
  });

  it("hard-terminates synchronous interpolation at timeout", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ControlledWorker();
      const client = new StudioLayerLiftComposeWorkerClient({
        workerFactory: () => worker,
        timeoutMs: 5,
      });
      const pending = client.run(input("timeout"));
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

  it("ignores stale generation/sequence and accepts only the active response", async () => {
    const worker = new ControlledWorker();
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => worker,
    });
    const pending = client.run(input("stale"));
    const request = worker.messages[0]!;

    await worker.complete(0, {
      identity: {
        generation: request.generation,
        sequence: request.sequence + 1,
      },
    });
    expect(client.activeCount).toBe(1);
    await worker.complete();
    await expect(pending).resolves.toMatchObject({
      requestId: "worker-request-stale",
    });
    client.dispose();
  });

  it("keeps capacity one by superseding onto a fresh Worker generation", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => workers.shift() ?? null,
    });
    const first = client.run(input("first"));
    const firstRejected = expect(first).rejects.toMatchObject({
      code: "aborted",
    });
    const second = client.run(input("second"));

    await firstRejected;
    expect(firstWorker.terminateCount).toBe(1);
    expect(client.activeCount).toBe(1);
    await secondWorker.complete();
    await expect(second).resolves.toMatchObject({
      requestId: "worker-request-second",
    });
    client.dispose();
  });

  it("rejects same-length RGBA mutation and terminates the compromised realm", async () => {
    const worker = new ControlledWorker();
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => worker,
    });
    const pending = client.run(input("tamper"));
    await worker.complete(0, {
      mutate(response) {
        if (response.kind !== "studio-layer-lift-compose/result") {
          return response;
        }
        new Uint8Array(response.backgroundRgbaBuffer)[0] ^= 0xff;
        return response;
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(worker.terminateCount).toBe(1);
    client.dispose();
  });

  it("rejects PNG mutation during main-realm receipt verification", async () => {
    const worker = new ControlledWorker();
    const client = new StudioLayerLiftComposeWorkerClient({
      workerFactory: () => worker,
    });
    const pending = client.run(input("png-tamper"));
    await worker.complete(0, {
      mutate(response) {
        if (response.kind !== "studio-layer-lift-compose/result") {
          return response;
        }
        const bytes = new Uint8Array(response.backgroundPngBuffer);
        bytes[Math.max(24, bytes.length - 20)]! ^= 0xff;
        return response;
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "artifact-invalid" });
    expect(worker.terminateCount).toBe(1);
    client.dispose();
  });
});
