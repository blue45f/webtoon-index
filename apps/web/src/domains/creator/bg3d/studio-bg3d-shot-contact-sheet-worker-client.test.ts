import { describe, expect, it, vi } from "vitest";

import {
  resolveStudioBg3dShotContactSheetLayout,
  type StudioBg3dShotContactSheetImage,
  type StudioBg3dShotContactSheetResult,
} from "./studio-bg3d-shot-contact-sheet-contract";
import {
  buildStudioBg3dShotContactSheetsInWorker,
  type StudioBg3dShotContactSheetWorkerLike,
} from "./studio-bg3d-shot-contact-sheet-worker-client";
import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotContactSheetWorkerRequest,
  isStudioBg3dShotContactSheetWorkerResponse,
  type StudioBg3dShotContactSheetWorkerRequest,
} from "./studio-bg3d-shot-contact-sheet-worker-protocol";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: "image/png" });
}

function image(): StudioBg3dShotContactSheetImage {
  return {
    shotId: "shot-a",
    shotName: "첫 컷",
    width: 320,
    height: 180,
    png: png(320, 180),
  };
}

function resultFor(input: readonly StudioBg3dShotContactSheetImage[]): StudioBg3dShotContactSheetResult {
  const layout = resolveStudioBg3dShotContactSheetLayout(input.length);
  return {
    layout,
    sheets: [{
      sheetNumber: 1,
      fileName: "contact-sheet-001.png",
      width: layout.sheetWidth,
      height: layout.sheetHeight,
      shotIds: input.map((entry) => entry.shotId),
      png: png(layout.sheetWidth, layout.sheetHeight),
    }],
  };
}

class FakeWorker implements StudioBg3dShotContactSheetWorkerLike {
  readonly requests: StudioBg3dShotContactSheetWorkerRequest[] = [];
  readonly messages = new Set<(event: { readonly data: unknown }) => void>();
  readonly errors = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrors = new Set<(event: { preventDefault?(): void }) => void>();
  terminated = false;

  postMessage(message: StudioBg3dShotContactSheetWorkerRequest): void {
    this.requests.push(message);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void) | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") this.messages.add(listener as (event: { readonly data: unknown }) => void);
    else if (type === "error") this.errors.add(listener as (event: { preventDefault?(): void }) => void);
    else this.messageErrors.add(listener as (event: { preventDefault?(): void }) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void) | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") this.messages.delete(listener as (event: { readonly data: unknown }) => void);
    else if (type === "error") this.errors.delete(listener as (event: { preventDefault?(): void }) => void);
    else this.messageErrors.delete(listener as (event: { preventDefault?(): void }) => void);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    for (const listener of this.messages) listener({ data });
  }
}

async function waitForRequest(worker: FakeWorker): Promise<StudioBg3dShotContactSheetWorkerRequest> {
  await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
  const request = worker.requests[0];
  if (!request) throw new Error("missing request");
  return request;
}

describe("Studio BG3D shot contact-sheet Worker client", () => {
  it("validates source PNGs, correlates progress, and accepts exact PNG sheet output", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const input = [image()];
    const pending = buildStudioBg3dShotContactSheetsInWorker(input, {
      workerFactory: () => worker,
      onProgress: progress,
    });
    const request = await waitForRequest(worker);

    expect(isStudioBg3dShotContactSheetWorkerRequest(request)).toBe(true);
    expect(request.layout).toMatchObject({ columns: 4, rows: 3 });
    worker.emit({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      progress: { completedShots: 1, totalShots: 1, completedSheets: 0, totalSheets: 1 },
    });
    const result = resultFor(input);
    worker.emit({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      result,
    });

    await expect(pending).resolves.toEqual(result);
    expect(progress).toHaveBeenCalledWith({
      completedShots: 1,
      totalShots: 1,
      completedSheets: 0,
      totalSheets: 1,
    });
    expect(worker.terminated).toBe(true);
  });

  it("terminates the active Worker on cancellation", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = buildStudioBg3dShotContactSheetsInWorker([image()], {
      workerFactory: () => worker,
      signal: controller.signal,
    });
    await waitForRequest(worker);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects forged input before Worker allocation and mismatched output after termination", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(buildStudioBg3dShotContactSheetsInWorker([{
      ...image(),
      png: new Blob([new Uint8Array(24)], { type: "image/png" }),
    }], { workerFactory })).rejects.toMatchObject({ name: "ProtocolError" });
    expect(workerFactory).not.toHaveBeenCalled();

    const worker = new FakeWorker();
    const input = [image()];
    const pending = buildStudioBg3dShotContactSheetsInWorker(input, { workerFactory: () => worker });
    const request = await waitForRequest(worker);
    const mismatched = resultFor(input);
    worker.emit({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      result: {
        ...mismatched,
        sheets: [{ ...mismatched.sheets[0]!, shotIds: ["other-shot"] }],
      },
    });

    await expect(pending).rejects.toMatchObject({ name: "ProtocolError" });
    expect(worker.terminated).toBe(true);
  });

  it("enforces strict request, progress, result, and unknown-field protocol shapes", () => {
    const input = [image()];
    const request = {
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "build",
      requestId: 1,
      images: input,
    };
    expect(isStudioBg3dShotContactSheetWorkerRequest(request)).toBe(true);
    expect(isStudioBg3dShotContactSheetWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isStudioBg3dShotContactSheetWorkerResponse({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      progress: { completedShots: 2, totalShots: 1, completedSheets: 0, totalSheets: 1 },
    })).toBe(false);
    expect(isStudioBg3dShotContactSheetWorkerResponse({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: resultFor(input),
      extra: true,
    })).toBe(false);
  });
});
