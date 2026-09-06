import { describe, expect, it, vi } from "vitest";

import {
  StudioBg3dObjPreflightWorkerClient,
  StudioBg3dObjPreflightWorkerClientError,
  type StudioBg3dObjPreflightWorkerLike,
} from "./studio-bg3d-obj-preflight-worker-client";
import {
  STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS,
  STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES,
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjPreflightWorkerRequest,
  isStudioBg3dObjPreflightWorkerResponse,
  studioBg3dObjPreflightWorkerRequestTransfers,
  studioBg3dObjPreflightWorkerResponseTransfers,
  type StudioBg3dObjPreflightWorkerMtlRequest,
  type StudioBg3dObjPreflightWorkerObjRequest,
  type StudioBg3dObjPreflightWorkerRequest,
  type StudioBg3dObjPreflightWorkerResponse,
} from "./studio-bg3d-obj-preflight-worker-protocol";
import {
  StudioBg3dObjPreflightWorkerRuntimeError,
  preflightStudioBg3dObjWorkerRequest,
} from "./studio-bg3d-obj-preflight-worker-runtime";

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function objRequest(
  source: ArrayBuffer,
  overrides: Partial<StudioBg3dObjPreflightWorkerObjRequest> = {},
): StudioBg3dObjPreflightWorkerObjRequest {
  return {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-obj",
    requestId: 1,
    generationId: 1,
    sourceByteLength: source.byteLength,
    bytes: source,
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
    ...overrides,
  };
}

function mtlRequest(
  entries: readonly { readonly path: string; readonly bytes: ArrayBuffer }[],
): StudioBg3dObjPreflightWorkerMtlRequest {
  return {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-mtl",
    requestId: 2,
    generationId: 1,
    materialLibraries: entries.map((entry) => ({
      path: entry.path,
      sourceByteLength: entry.bytes.byteLength,
      bytes: entry.bytes,
    })),
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  };
}

function resultResponse(
  request: StudioBg3dObjPreflightWorkerRequest,
  identity: { readonly requestId: number; readonly generationId: number } = request,
): StudioBg3dObjPreflightWorkerResponse {
  return {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: identity.requestId,
    generationId: identity.generationId,
    result: preflightStudioBg3dObjWorkerRequest(request),
  };
}

class FakeWorker implements StudioBg3dObjPreflightWorkerLike {
  readonly messages = new Set<(event: { readonly data: unknown }) => void>();
  readonly errors = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrors = new Set<(event: { preventDefault?(): void }) => void>();
  readonly postMessage = vi.fn((
    request: StudioBg3dObjPreflightWorkerRequest,
    transfer: Transferable[],
  ) => this.onPost?.(request, transfer));
  readonly terminate = vi.fn();

  constructor(
    readonly onPost?: (
      request: StudioBg3dObjPreflightWorkerRequest,
      transfer: Transferable[],
    ) => void,
  ) {}

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void)
      | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") {
      this.messages.add(listener as (event: { readonly data: unknown }) => void);
    } else if (type === "error") {
      this.errors.add(listener as (event: { preventDefault?(): void }) => void);
    } else {
      this.messageErrors.add(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void)
      | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") {
      this.messages.delete(listener as (event: { readonly data: unknown }) => void);
    } else if (type === "error") {
      this.errors.delete(listener as (event: { preventDefault?(): void }) => void);
    } else {
      this.messageErrors.delete(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messages) listener({ data });
  }
}

describe("OBJ/MTL preflight Worker runtime", () => {
  it("discovers material libraries, enforces expansion metrics, and returns buffer ownership", () => {
    const source = bytes([
      "mtllib materials/body.mtl",
      "mtllib materials/body.mtl",
      "o face",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vn 0 0 1",
      "usemtl ink",
      "f 1/1/1 2/1/1 3/1/1",
    ].join("\n"));
    const request = objRequest(source);
    const result = preflightStudioBg3dObjWorkerRequest(request);

    expect(result).toMatchObject({
      kind: "obj",
      sourceByteLength: source.byteLength,
      materialLibraryReferences: ["materials/body.mtl"],
      metrics: {
        sourceVertices: 3,
        sourceAttributeRecords: 5,
        expandedVertices: 3,
        triangles: 1,
        objectNodes: 1,
        materialSections: 1,
        materialLibraryDirectives: 2,
      },
    });
    expect(result.kind === "obj" && result.bytes).toBe(source);
  });

  it("counts the full OBJLoader Unicode whitespace set before allocating parser geometry", () => {
    const source = bytes([
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1\u00a02\u202f3",
    ].join("\n"));
    const result = preflightStudioBg3dObjWorkerRequest(objRequest(source));

    expect(result).toMatchObject({
      kind: "obj",
      metrics: {
        sourceVertices: 3,
        expandedVertices: 3,
        triangles: 1,
      },
    });
  });

  it("scans canonical-path sorted MTLs cumulatively and returns every original buffer", () => {
    const first = bytes("newmtl ink\nKd 0 0 0\nmap_Kd textures/ink.png");
    const second = bytes("newmtl paper\nbump textures/paper.png");
    const request = mtlRequest([
      { path: "materials/a.mtl", bytes: first },
      { path: "materials/b.mtl", bytes: second },
    ]);
    const result = preflightStudioBg3dObjWorkerRequest(request);

    expect(result).toMatchObject({
      kind: "mtl",
      metrics: { directives: 5, materials: 2, textureSlots: 2 },
    });
    expect(result.kind === "mtl" && result.materialLibraries[0]?.bytes).toBe(first);
    expect(result.kind === "mtl" && result.materialLibraries[1]?.bytes).toBe(second);
  });

  it("fails invalid UTF-8 without a replacement-character parse", () => {
    const source = new Uint8Array([0xc3, 0x28]).buffer;
    expect(() => preflightStudioBg3dObjWorkerRequest(objRequest(source))).toThrowError(
      expect.objectContaining({ code: "invalid-text" }),
    );
  });

  it("rejects unsafe mtllib URIs and OBJ node budget overflow before parser allocation", () => {
    expect(() => preflightStudioBg3dObjWorkerRequest(
      objRequest(bytes("mtllib https://example.com/private.mtl")),
    )).toThrowError(expect.objectContaining({ code: "unsafe-resource-uri" }));

    const nodes = Array.from(
      { length: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES + 1 },
      (_, index) => `o node-${index}`,
    ).join("\n");
    expect(() => preflightStudioBg3dObjWorkerRequest(objRequest(bytes(nodes)))).toThrowError(
      expect.objectContaining({ code: "node-budget-exceeded" }),
    );
  });

  it("rejects cumulative MTL material budgets and network texture references", () => {
    const materials = Array.from(
      { length: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS + 1 },
      (_, index) => `newmtl material-${index}`,
    ).join("\n");
    expect(() => preflightStudioBg3dObjWorkerRequest(
      mtlRequest([{ path: "materials/all.mtl", bytes: bytes(materials) }]),
    )).toThrowError(expect.objectContaining({ code: "material-budget-exceeded" }));
    expect(() => preflightStudioBg3dObjWorkerRequest(
      mtlRequest([{
        path: "materials/unsafe.mtl",
        bytes: bytes("newmtl unsafe\nmap_Kd //cdn.example.com/ink.png"),
      }]),
    )).toThrowError(expect.objectContaining({ code: "unsafe-resource-uri" }));
  });

  it("validates exact envelopes and exposes each transfer exactly once", () => {
    const source = bytes("v 0 0 0");
    const request = objRequest(source);
    expect(isStudioBg3dObjPreflightWorkerRequest(request)).toBe(true);
    expect(isStudioBg3dObjPreflightWorkerRequest({ ...request, unexpected: true })).toBe(false);
    expect(studioBg3dObjPreflightWorkerRequestTransfers(request)).toEqual([source]);

    const response = resultResponse(request);
    expect(isStudioBg3dObjPreflightWorkerResponse(response)).toBe(true);
    expect(studioBg3dObjPreflightWorkerResponseTransfers(response)).toEqual([source]);
  });
});

describe("OBJ/MTL preflight Worker client authority", () => {
  it("transfers one buffer, reports ordered progress, and accepts the exact result identity", async () => {
    const progress: string[] = [];
    const worker = new FakeWorker((request, transfer) => {
      expect(transfer).toEqual(
        request.kind === "preflight-obj" ? [request.bytes] : expect.any(Array),
      );
      queueMicrotask(() => {
        worker.emitMessage({
          version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
          kind: "progress",
          requestId: request.requestId,
          generationId: request.generationId,
          stage: "decoding",
          progress: 0.1,
        });
        worker.emitMessage(resultResponse(request));
      });
    });
    const client = new StudioBg3dObjPreflightWorkerClient({
      workerFactory: () => worker,
    });
    const source = bytes("v 0 0 0");

    await expect(client.preflightObj(source, {
      onProgress: ({ stage }) => progress.push(stage),
    })).resolves.toMatchObject({ kind: "obj", bytes: source });
    expect(progress).toEqual(["queued", "decoding", "validating", "ready"]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(client.ownedInputBytes).toBe(0);
  });

  it("ignores a valid late response from an obsolete request identity", async () => {
    const worker = new FakeWorker((request) => {
      queueMicrotask(() => {
        worker.emitMessage(resultResponse(request, {
          requestId: request.requestId + 1,
          generationId: request.generationId,
        }));
        worker.emitMessage(resultResponse(request));
      });
    });
    const client = new StudioBg3dObjPreflightWorkerClient({
      workerFactory: () => worker,
    });

    await expect(client.preflightObj(bytes("v 0 0 0"))).resolves.toMatchObject({
      kind: "obj",
    });
  });

  it("terminates active work on AbortSignal and rejects late completion", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dObjPreflightWorkerClient({
      workerFactory: () => worker,
    });
    const controller = new AbortController();
    const pending = client.preflightObj(bytes("v 0 0 0"), { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed on timeout and terminates the stalled Worker", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dObjPreflightWorkerClient({
      workerFactory: () => worker,
      executionTimeoutMs: 1,
    });

    await expect(client.preflightObj(bytes("v 0 0 0"))).rejects.toMatchObject({
      code: "timeout",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps ownership attached when no Worker exists so only the caller can choose a bounded fallback", async () => {
    const source = bytes("v 0 0 0");
    const client = new StudioBg3dObjPreflightWorkerClient({
      workerFactory: () => null,
    });

    await expect(client.preflightObj(source)).rejects.toEqual(
      expect.objectContaining<Partial<StudioBg3dObjPreflightWorkerClientError>>({
        code: "worker-unavailable",
      }),
    );
    expect(source.byteLength).toBeGreaterThan(0);
  });
});

it("keeps the runtime error type inspectable across the bounded fallback boundary", () => {
  try {
    preflightStudioBg3dObjWorkerRequest(objRequest(new Uint8Array([0xff]).buffer));
    throw new Error("expected invalid-text");
  } catch (error) {
    expect(error).toBeInstanceOf(StudioBg3dObjPreflightWorkerRuntimeError);
  }
});
