import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUnitCubeMesh } from "./studio-editable-half-edge-mesh";
import {
  disposeStudioOcctWorker,
  runStudioOcctOperation,
} from "./studio-occt-worker-client";

import type {
  StudioOcctWorkerRequest,
  StudioOcctWorkerResponse,
} from "./studio-occt-worker-protocol";

class FakeOcctWorker extends EventTarget {
  static mode: "forged-solid" | "invalid-solid" | "post-message-throw" | "silent" | "success" = "success";
  static latest: FakeOcctWorker | null = null;
  static instances: FakeOcctWorker[] = [];

  lastRequest: StudioOcctWorkerRequest | null = null;
  terminated = false;

  constructor() {
    super();
    FakeOcctWorker.latest = this;
    FakeOcctWorker.instances.push(this);
  }

  postMessage(request: StudioOcctWorkerRequest): void {
    this.lastRequest = request;
    if (FakeOcctWorker.mode === "post-message-throw") {
      throw new DOMException("structured clone failed", "DataCloneError");
    }
    if (FakeOcctWorker.mode === "silent") return;
    queueMicrotask(() => {
      const validSolid = FakeOcctWorker.mode !== "invalid-solid";
      const canonicalMesh = createStudioUnitCubeMesh();
      const response: StudioOcctWorkerResponse = {
        id: request.id,
        result: {
          ok: true,
          bodyKind: "solid",
          mesh: FakeOcctWorker.mode === "forged-solid"
            ? { ...canonicalMesh, faces: canonicalMesh.faces.slice(0, -1) }
            : canonicalMesh,
          faceCount: FakeOcctWorker.mode === "forged-solid" ? 5 : 6,
          triangleCount: 12,
          vertexCount: 8,
          volumeApprox: 1,
          topology: {
            source: "tessellated-triangle-mesh",
            boundaryEdgeCount: validSolid ? 0 : 3,
            nonManifoldEdgeCount: 0,
            orientationConflictEdgeCount: 0,
            degenerateTriangleCount: 0,
            consistentOrientation: true,
            watertight: validSolid,
            closedSolid: validSolid,
            signedVolume: validSolid ? 1 : 0,
          },
          massProperties: {
            source: "occt-brep",
            density: 1,
            densityUnit: "mass/model-unit^3",
            mass: 1,
            volume: 1,
            volumeSource: "occt-brep",
            surfaceArea: 6,
            surfaceAreaSource: "occt-brep",
            centroid: { x: 0, y: 0, z: 0 },
            centroidSource: "occt-brep",
            inertia: { xx: 1, yy: 1, zz: 1, xy: 0, xz: 0, yz: 0 },
            inertiaSource: "occt-brep",
            approximate: false,
          },
          backend: "opencascade-wasm",
          operation: "BRepPrimAPI_MakeBox",
          loadPath: "browser",
        },
      };
      this.dispatchEvent(new MessageEvent("message", { data: response }));
    });
  }

  emitError(message: string): void {
    const event = new Event("error") as ErrorEvent;
    Object.defineProperty(event, "message", { value: message });
    this.dispatchEvent(event);
  }

  emitMalformedMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitMessageError(): void {
    this.dispatchEvent(new Event("messageerror"));
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  disposeStudioOcctWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeOcctWorker.latest = null;
  FakeOcctWorker.instances = [];
  FakeOcctWorker.mode = "success";
});

function useFakeBrowserWorker(): void {
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeOcctWorker);
}

describe("Studio OCCT Worker client", () => {
  it("runs browser operations off the UI thread and returns the canonical mesh", async () => {
    useFakeBrowserWorker();
    const result = await runStudioOcctOperation({ kind: "box", size: [1, 1, 1] });
    expect(result.loadPath).toBe("browser");
    expect(result.vertexCount).toBe(8);
    expect(result.mesh.faces).toHaveLength(6);
    expect(FakeOcctWorker.latest?.terminated).toBe(false);
  });

  it("realm-isolates Embind no-delete operations in a fresh one-shot Worker", async () => {
    useFakeBrowserWorker();
    await runStudioOcctOperation({
      kind: "thick-shell-box",
      size: [1, 1, 1],
      thickness: 0.1,
    });
    const first = FakeOcctWorker.latest;
    expect(first?.terminated).toBe(true);

    await runStudioOcctOperation({
      kind: "fillet2d-extrude",
      width: 1,
      height: 1,
      depth: 0.5,
      filletRadius: 0.1,
    });
    const second = FakeOcctWorker.latest;
    expect(second).not.toBe(first);
    expect(second?.terminated).toBe(true);

    await runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    });
    const third = FakeOcctWorker.latest;
    expect(third).not.toBe(second);
    expect(third?.terminated).toBe(true);
    expect(FakeOcctWorker.instances).toHaveLength(3);
  });

  it("disposes an in-flight realm-isolated operation", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    });
    const assertion = expect(operation).rejects.toThrow("OCCT Worker disposed");
    disposeStudioOcctWorker();
    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("cancels an isolated operation without leaving its realm alive", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const controller = new AbortController();
    const operation = runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    }, { signal: controller.signal });
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("times out and terminates an isolated operation", async () => {
    vi.useFakeTimers();
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    }, { timeoutMs: 1_000 });
    const assertion = expect(operation).rejects.toThrow(/timed out after 1000ms/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("terminates the shared Worker and rejects on cancellation", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const controller = new AbortController();
    const operation = runStudioOcctOperation(
      { kind: "box", size: [1, 1, 1] },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("keeps queued work alive when the active shared operation is cancelled", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const controller = new AbortController();
    const cancelled = runStudioOcctOperation(
      { kind: "box", size: [1, 1, 1] },
      { signal: controller.signal },
    );
    const survivor = runStudioOcctOperation({ kind: "sphere", radius: 1 });
    const firstGeneration = FakeOcctWorker.latest;
    expect(FakeOcctWorker.instances).toHaveLength(1);

    FakeOcctWorker.mode = "success";
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(survivor).resolves.toMatchObject({ bodyKind: "solid" });
    expect(firstGeneration?.terminated).toBe(true);
    expect(FakeOcctWorker.instances).toHaveLength(2);
  });

  it("ignores late errors from a terminated Worker generation", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const controller = new AbortController();
    const first = runStudioOcctOperation(
      { kind: "box", size: [1, 1, 1] },
      { signal: controller.signal },
    );
    const oldGeneration = FakeOcctWorker.latest;
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    const second = runStudioOcctOperation({ kind: "sphere", radius: 1 });
    const currentGeneration = FakeOcctWorker.latest;
    expect(currentGeneration).not.toBe(oldGeneration);
    oldGeneration?.emitError("late old-generation error");
    expect(currentGeneration?.terminated).toBe(false);

    FakeOcctWorker.mode = "success";
    const currentRequest = currentGeneration?.lastRequest;
    expect(currentRequest).not.toBeNull();
    if (currentRequest) currentGeneration?.postMessage(currentRequest);
    await expect(second).resolves.toMatchObject({ bodyKind: "solid" });
  });

  it("terminates a wedged Worker at the bounded timeout", async () => {
    vi.useFakeTimers();
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation(
      { kind: "box", size: [1, 1, 1] },
      { timeoutMs: 1_000 },
    );
    const assertion = expect(operation).rejects.toThrow(/timed out after 1000ms/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("fails closed when Worker is unavailable in a browser", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("Worker", undefined);

    await expect(
      runStudioOcctOperation({ kind: "box", size: [1, 1, 1] }),
    ).rejects.toThrow("OCCT Worker is unavailable in this browser");
    expect(FakeOcctWorker.latest).toBeNull();
  });

  it("terminates and rejects pending work on a Worker error", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation({ kind: "box", size: [1, 1, 1] });
    const assertion = expect(operation).rejects.toThrow("OCCT kernel crashed");

    FakeOcctWorker.latest?.emitError("OCCT kernel crashed");

    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("terminates and rejects pending work on message deserialization failure", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation({ kind: "box", size: [1, 1, 1] });
    const assertion = expect(operation).rejects.toThrow(
      "OCCT Worker returned an unreadable result",
    );

    FakeOcctWorker.latest?.emitMessageError();

    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("rejects malformed response payloads instead of trusting TypeScript types", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "silent";
    const operation = runStudioOcctOperation({ kind: "box", size: [1, 1, 1] });
    const assertion = expect(operation).rejects.toThrow(
      "OCCT Worker returned an invalid response payload",
    );

    FakeOcctWorker.latest?.emitMalformedMessage({
      id: FakeOcctWorker.latest.lastRequest?.id,
      result: { ok: true, mesh: null },
    });

    await assertion;
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("rejects a nominal solid response whose topology is open", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "invalid-solid";
    await expect(
      runStudioOcctOperation({ kind: "box", size: [1, 1, 1] }),
    ).rejects.toThrow("invalid response payload");
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("rejects an open canonical mesh even when the Worker forges a closed-solid receipt", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "forged-solid";
    await expect(
      runStudioOcctOperation({ kind: "box", size: [1, 1, 1] }),
    ).rejects.toThrow("invalid response payload");
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("cleans up immediately when postMessage throws synchronously", async () => {
    useFakeBrowserWorker();
    FakeOcctWorker.mode = "post-message-throw";

    await expect(
      runStudioOcctOperation({ kind: "box", size: [1, 1, 1] }),
    ).rejects.toThrow("OCCT Worker postMessage failed: structured clone failed");
    expect(FakeOcctWorker.latest?.terminated).toBe(true);
  });

  it("realm-isolates repeated unsafe Node operations and keeps the caller runtime healthy", async () => {
    const first = await runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    }, { timeoutMs: 120_000 });
    const second = await runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    }, { timeoutMs: 120_000 });
    const ordinary = await runStudioOcctOperation({
      kind: "box",
      size: [1, 1, 1],
    });

    expect(first).toMatchObject({
      bodyKind: "solid",
      loadPath: "node",
      topology: { closedSolid: true, watertight: true },
    });
    expect(second.massProperties.volume).toBeCloseTo(1, 6);
    expect(ordinary).toMatchObject({
      bodyKind: "solid",
      loadPath: "node",
      topology: { closedSolid: true },
    });
  }, 180_000);

  it("aborts an in-flight unsafe Node realm without affecting later calls", async () => {
    const controller = new AbortController();
    const operation = runStudioOcctOperation({
      kind: "step-roundtrip-box",
      size: [1, 1, 1],
    }, {
      signal: controller.signal,
      timeoutMs: 120_000,
    });
    setTimeout(() => controller.abort(), 10);

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await expect(runStudioOcctOperation({
      kind: "box",
      size: [1, 1, 1],
    })).resolves.toMatchObject({
      bodyKind: "solid",
      topology: { closedSolid: true },
    });
  }, 120_000);
});
