import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeStudioRasterInterchange } from "./studio-raster-interchange";
import {
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  type StudioRasterInterchangeWorkerRequest,
  type StudioRasterInterchangeWorkerResponse,
} from "./studio-raster-interchange-worker-protocol";

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<StudioRasterInterchangeWorkerRequest>) => void) | null;
  postMessage(message: StudioRasterInterchangeWorkerResponse, transfers: Transferable[]): void;
}

async function loadWorkerHarness(): Promise<{
  messages: StudioRasterInterchangeWorkerResponse[];
  transfers: Transferable[][];
  scope: WorkerScopeHarness;
}> {
  vi.resetModules();
  const messages: StudioRasterInterchangeWorkerResponse[] = [];
  const transfers: Transferable[][] = [];
  vi.stubGlobal("postMessage", vi.fn((message: StudioRasterInterchangeWorkerResponse, transfer: Transferable[]) => {
    messages.push(message);
    transfers.push(transfer);
  }));
  await import("./studio-raster-interchange.worker");
  return { messages, transfers, scope: globalThis as unknown as WorkerScopeHarness };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio raster interchange Worker runtime", () => {
  it("announces readiness and transfers decoded RGBA pixels", async () => {
    const { messages, transfers, scope } = await loadWorkerHarness();
    const encoded = encodeStudioRasterInterchange("qoi", {
      width: 1,
      height: 1,
      data: new Uint8Array([12, 34, 56, 200]),
    });

    scope.onmessage?.({ data: {
      type: "studio-raster-interchange/decode",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: "decode-1",
      expectedFormat: "qoi",
      bytes: encoded.bytes,
    } } as MessageEvent<StudioRasterInterchangeWorkerRequest>);

    expect(messages[0]).toEqual({
      type: "studio-raster-interchange/ready",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    });
    expect(messages[1]?.type).toBe("studio-raster-interchange/decode-success");
    if (messages[1]?.type !== "studio-raster-interchange/decode-success") {
      throw new Error("decode success expected");
    }
    expect([...messages[1].result.bitmap.data]).toEqual([12, 34, 56, 200]);
    expect(transfers[1]).toEqual([messages[1].result.bitmap.data.buffer]);
  });

  it("encodes pixels and returns structured codec failures", async () => {
    const { messages, transfers, scope } = await loadWorkerHarness();
    scope.onmessage?.({ data: {
      type: "studio-raster-interchange/encode",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: "encode-1",
      format: "pam",
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255]),
    } } as MessageEvent<StudioRasterInterchangeWorkerRequest>);
    expect(messages[1]?.type).toBe("studio-raster-interchange/encode-success");
    if (messages[1]?.type !== "studio-raster-interchange/encode-success") {
      throw new Error("encode success expected");
    }
    expect(messages[1].result.extension).toBe(".pam");
    expect(transfers[1]).toEqual([messages[1].result.bytes.buffer]);

    scope.onmessage?.({ data: {
      type: "studio-raster-interchange/decode",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: "decode-invalid",
      expectedFormat: "bmp",
      bytes: new Uint8Array([0]),
    } } as MessageEvent<StudioRasterInterchangeWorkerRequest>);
    expect(messages[2]).toMatchObject({
      type: "studio-raster-interchange/failure",
      requestId: "decode-invalid",
      error: { name: "StudioRasterInterchangeError" },
    });
  });
});
