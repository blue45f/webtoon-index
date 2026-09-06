import { afterEach, describe, expect, it, vi } from "vitest";

import { buildStudioPackageArchiveBlob } from "../studio-package-archive";

import {
  STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
  STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
  createStudioBg3dShotBatchPublicRenderPlan,
} from "./studio-bg3d-shot-batch";
import {
  buildStudioBg3dShotBatchArchiveInWorker,
  type StudioBg3dShotBatchWorkerLike,
} from "./studio-bg3d-shot-batch-worker-client";
import {
  STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotBatchWorkerRequest,
  isStudioBg3dShotBatchWorkerResponse,
  type StudioBg3dShotBatchWorkerRequest,
} from "./studio-bg3d-shot-batch-worker-protocol";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const ZIP_PREFIX_ONLY = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x6a, 0x75, 0x6e, 0x6b]);

class FakeWorker implements StudioBg3dShotBatchWorkerLike {
  readonly requests: StudioBg3dShotBatchWorkerRequest[] = [];
  readonly messages = new Set<(event: { readonly data: unknown }) => void>();
  readonly errors = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrors = new Set<(event: { preventDefault?(): void }) => void>();
  terminated = false;

  postMessage(message: StudioBg3dShotBatchWorkerRequest): void {
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

  emitError(type: "error" | "messageerror" = "error"): void {
    const listeners = type === "error" ? this.errors : this.messageErrors;
    for (const listener of listeners) listener({ preventDefault: vi.fn() });
  }
}

function emitReady(worker: FakeWorker): void {
  worker.emit({
    version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
    kind: "ready",
  });
}

async function validLegacyArchive(): Promise<Blob> {
  const manifest = {
    kind: "toonspectrum-bg3d-shot-batch",
    version: 1,
    files: [{
      shotId: "shot-a",
      name: "첫 컷",
      path: "shots/001.png",
      width: 320,
      height: 180,
      output: "beauty",
    }],
  };
  return buildStudioPackageArchiveBlob([
    { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { path: "shots/001.png", data: PNG_BYTES },
  ], {
    mimeType: "application/zip",
    crc32ExecutionMode: "direct-headless",
  });
}

function image() {
  return {
    shotId: "shot-a",
    shotName: "첫 컷",
    width: 320,
    height: 180,
    png: new Blob([PNG_BYTES], { type: "image/png" }),
  };
}

function publicRenderPlan() {
  return createStudioBg3dShotBatchPublicRenderPlan({
    kind: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
    version: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
    sourceDigest: "a".repeat(64),
    renderDigest: "b".repeat(64),
    implementation: {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      engineId: "three",
      engineRevision: "184",
      adapterImplementationRevision: "studio-three-webgl-capture-adapter-v1",
      graphicsApi: "webgl2",
      backend: "three-webgl",
    },
    captureProfile: {
      profileId: "studio-rgba8-straight-srgb-topdown-depth-f32-v1",
      ltPipelineId: "studio-lt-color-tone-line-depth-v1",
      pngEncodingId: "png-srgb-straight-alpha-v1",
      depthEncodingId: STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
      sourceWidth: 640,
      sourceHeight: 360,
      maxPixels: 8_388_608,
      maxEdge: 4_096,
      deviceProfile: "desktop",
      textureScale: 1,
      lodBias: 0,
    },
    artifactProfiles: {
      psdProfileId: STUDIO_BG3D_SHOT_BATCH_PSD_PROFILE_V1,
      contactSheetProfileId: STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
      archiveProfileId: STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
    },
    passes: ["beauty"],
    exportHeight: 360,
    artifactRequests: { layeredPsd: false, contactSheet: false },
    shots: [{
      shotId: "shot-a",
      shotName: "첫 컷",
      shotIndex: 1,
      capture: {
        width: 640,
        height: 360,
        requestedHeight: 360,
        wasReduced: false,
        includeDepth: false,
        shadows: false,
        shadowMapSize: 0,
        background: { color: "#ffffff", alpha: 0 },
      },
      files: [{
        shotId: "shot-a",
        shotName: "첫 컷",
        shotIndex: 1,
        pass: "beauty",
        path: "shots/001/beauty.png",
      }],
    }],
  });
}

afterEach(() => vi.useRealTimers());

describe("Studio BG3D shot batch archive Worker client", () => {
  it("waits for readiness, correlates progress, and verifies the complete ZIP response", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const result = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => worker,
      onProgress: progress,
    });
    expect(worker.requests).toHaveLength(0);
    emitReady(worker);
    const request = worker.requests[0];
    expect(request && isStudioBg3dShotBatchWorkerRequest(request)).toBe(true);
    worker.emit({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request?.requestId,
      progress: { completedFiles: 1, totalFiles: 2 },
    });
    const archive = await validLegacyArchive();
    worker.emit({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request?.requestId,
      archive,
    });

    await expect(result).resolves.toBe(archive);
    expect(progress).toHaveBeenCalledWith({ completedFiles: 1, totalFiles: 2 });
    expect(worker.terminated).toBe(true);
  });

  it("terminates immediately on abort and rejects late or malformed output", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => worker,
      signal: controller.signal,
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);

    const malformedWorker = new FakeWorker();
    const malformed = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => malformedWorker,
    });
    emitReady(malformedWorker);
    malformedWorker.emit({ kind: "result" });
    await expect(malformed).rejects.toMatchObject({ name: "ProtocolError" });
    expect(malformedWorker.terminated).toBe(true);
  });

  it("transports only the exact sanitized v3 public render context", async () => {
    const worker = new FakeWorker();
    const plan = publicRenderPlan();
    const result = buildStudioBg3dShotBatchArchiveInWorker([
      { ...image(), pass: "beauty", requestedHeight: 360, wasReduced: true },
    ], {
      workerFactory: () => worker,
      manifest: { publicRenderPlan: plan },
    });
    emitReady(worker);
    const request = worker.requests[0];
    expect(request && isStudioBg3dShotBatchWorkerRequest(request)).toBe(true);
    expect(request?.manifest).toEqual({ publicRenderPlan: plan });
    expect(JSON.stringify(request?.manifest)).not.toMatch(
      /scopeDigest|recoveryDigest|resumeKey|authUserId|workId|pageId|elementId/u,
    );
    expect(isStudioBg3dShotBatchWorkerRequest({
      ...request,
      manifest: {
        publicRenderPlan: plan,
        scopeDigest: "c".repeat(64),
      },
    })).toBe(false);
    worker.emit({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request?.requestId,
      code: "build-failed",
    });
    await expect(result).rejects.toMatchObject({ code: "build-failed", name: "WorkerError" });
  });

  it("rejects PK local-header junk after ready as archive-invalid", async () => {
    const worker = new FakeWorker();
    const result = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => worker,
    });
    emitReady(worker);
    const request = worker.requests[0];
    worker.emit({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request?.requestId,
      archive: new Blob([ZIP_PREFIX_ONLY], { type: "application/zip" }),
    });
    await expect(result).rejects.toMatchObject({ code: "archive-invalid", name: "ProtocolError" });
  });

  it("classifies only constructor, pre-ready error, and startup timeout as worker-unavailable", async () => {
    const construction = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => { throw new Error("CSP"); },
    });
    await expect(construction).rejects.toMatchObject({
      code: "worker-unavailable",
      name: "WorkerUnavailableError",
    });

    const preReadyWorker = new FakeWorker();
    const preReady = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => preReadyWorker,
    });
    preReadyWorker.emitError();
    await expect(preReady).rejects.toMatchObject({ code: "worker-unavailable" });

    vi.useFakeTimers();
    const stalledWorker = new FakeWorker();
    const stalled = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => stalledWorker,
      startupTimeoutMs: 250,
    });
    const stalledExpectation = expect(stalled).rejects.toMatchObject({ code: "worker-unavailable" });
    await vi.advanceTimersByTimeAsync(250);
    await stalledExpectation;
  });

  it("keeps post-ready runtime and protocol failures terminal", async () => {
    const runtimeWorker = new FakeWorker();
    const runtime = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => runtimeWorker,
    });
    emitReady(runtimeWorker);
    runtimeWorker.emitError();
    await expect(runtime).rejects.toMatchObject({ code: "worker-failed", name: "WorkerError" });

    const protocolWorker = new FakeWorker();
    const protocol = buildStudioBg3dShotBatchArchiveInWorker([image()], {
      workerFactory: () => protocolWorker,
    });
    emitReady(protocolWorker);
    protocolWorker.emit({ kind: "result" });
    await expect(protocol).rejects.toMatchObject({ code: "protocol", name: "ProtocolError" });
  });

  it("validates strict progress, result, and unknown response fields", () => {
    const base = {
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      requestId: 1,
    };
    expect(isStudioBg3dShotBatchWorkerResponse({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "ready",
    })).toBe(true);
    expect(isStudioBg3dShotBatchWorkerResponse({
      ...base,
      kind: "progress",
      progress: { completedFiles: 1, totalFiles: 2 },
    })).toBe(true);
    expect(isStudioBg3dShotBatchWorkerResponse({
      ...base,
      kind: "progress",
      progress: { completedFiles: 3, totalFiles: 2 },
    })).toBe(false);
    expect(isStudioBg3dShotBatchWorkerResponse({
      ...base,
      kind: "result",
      archive: new Blob([ZIP_PREFIX_ONLY], { type: "application/zip" }),
      extra: true,
    })).toBe(false);
    expect(isStudioBg3dShotBatchWorkerRequest({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "build",
      requestId: 1,
      images: [image()],
      manifest: { resumeKey: "forged" },
    })).toBe(false);
  });
});
