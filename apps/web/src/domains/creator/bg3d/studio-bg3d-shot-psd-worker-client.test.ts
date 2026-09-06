import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStudioBg3dShotLayeredPsdInWorker,
  type StudioBg3dShotPsdWorkerLike,
} from "./studio-bg3d-shot-psd-worker-client";
import {
  STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
  type StudioBg3dShotPsdWorkerRequest,
} from "./studio-bg3d-shot-psd-worker-protocol";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

class FakeWorker implements StudioBg3dShotPsdWorkerLike {
  request: StudioBg3dShotPsdWorkerRequest | null = null;
  messages = new Set<(event: { data: unknown }) => void>();
  errors = new Set<(event: { preventDefault?(): void }) => void>();
  messageErrors = new Set<(event: { preventDefault?(): void }) => void>();
  terminated = false;
  postMessage(message: StudioBg3dShotPsdWorkerRequest) { this.request = message; }
  addEventListener(type: "message" | "error" | "messageerror", listener: never) {
    if (type === "message") this.messages.add(listener);
    else if (type === "error") this.errors.add(listener);
    else this.messageErrors.add(listener);
  }
  removeEventListener(type: "message" | "error" | "messageerror", listener: never) {
    if (type === "message") this.messages.delete(listener);
    else if (type === "error") this.errors.delete(listener);
    else this.messageErrors.delete(listener);
  }
  terminate() { this.terminated = true; }
  emit(data: unknown) { for (const listener of this.messages) listener({ data }); }
}

const layers: StudioBg3dLtRasterLayer[] = [{
  role: "color",
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([1, 2, 3, 255]),
}];
function psdHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(26);
  bytes.set([0x38, 0x42, 0x50, 0x53, 0, 1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(12, 4, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes.buffer;
}

afterEach(() => vi.useRealTimers());

describe("Studio BG3D shot PSD Worker client", () => {
  it("correlates and validates an 8BPS v1 result", async () => {
    const worker = new FakeWorker();
    const result = buildStudioBg3dShotLayeredPsdInWorker(layers, { workerFactory: () => worker });
    worker.emit({
      version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: worker.request?.requestId,
      psd: new Blob([psdHeader(1, 1)], { type: "image/vnd.adobe.photoshop" }),
    });
    await expect(result).resolves.toBeInstanceOf(Blob);
    expect(worker.terminated).toBe(true);
  });

  it("terminates on abort and rejects a forged result", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = buildStudioBg3dShotLayeredPsdInWorker(layers, {
      workerFactory: () => worker,
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });

    const forgedWorker = new FakeWorker();
    const forged = buildStudioBg3dShotLayeredPsdInWorker(layers, {
      workerFactory: () => forgedWorker,
    });
    forgedWorker.emit({
      version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: forgedWorker.request?.requestId,
      psd: new Blob([new Uint8Array(8)], { type: "image/vnd.adobe.photoshop" }),
    });
    await expect(forged).rejects.toMatchObject({ name: "ProtocolError" });
    expect(forgedWorker.terminated).toBe(true);
  });
});
