import { describe, expect, it, vi } from "vitest";

import {
  publishStudioFilterMaskSurface,
  StudioFilterMaskSurfacePublicationError,
  type StudioFilterMaskSurfacePublicationAckInput,
  type StudioFilterMaskSurfacePublicationDependencies,
  type StudioFilterMaskSurfacePublicationGuardInput,
  type StudioFilterMaskSurfacePublicationInput,
} from "./studio-filter-mask-surface-publisher";

import type { StudioRasterAssetReference } from "@/shared/lib/studio-crdt-raster-ops";
import type { StudioFilterMaskSurfaceId } from "@/shared/lib/studio-filter-mask-surface-contract";

const SURFACE_ID =
  "filter-mask:v1:00000000-0000-4000-8000-000000000001" as StudioFilterMaskSurfaceId;
const OPERATION_ID = "00000000-0000-4000-8000-000000000002";

function rgba(
  width: number,
  height: number,
  pixel: readonly [number, number, number, number] = [255, 255, 255, 255]
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < result.length; offset += 4) result.set(pixel, offset);
  return result;
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function testPng(width: number, height: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(24 + payload.byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeUint32BigEndian(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BigEndian(bytes, 16, width);
  writeUint32BigEndian(bytes, 20, height);
  bytes.set(payload, 24);
  return bytes;
}

function input(
  overrides: Partial<StudioFilterMaskSurfacePublicationInput> = {}
): StudioFilterMaskSurfacePublicationInput {
  const width = overrides.width ?? 8;
  const height = overrides.height ?? 6;
  return {
    workId: "work-1",
    actorId: "artist-1",
    pageId: "page-1",
    layerId: "layer-1",
    targetElementId: "image-1",
    sourceIdentity: "sha256:source-image-v1",
    selectedObjectStableId: "obj/desk",
    generation: 7,
    width,
    height,
    pixels: rgba(width, height),
    ...overrides,
  };
}

interface TestSetup {
  readonly value: StudioFilterMaskSurfacePublicationDependencies;
  readonly order: string[];
  readonly append: ReturnType<typeof vi.fn>;
  readonly attach: ReturnType<typeof vi.fn>;
  readonly waitForAck: ReturnType<typeof vi.fn>;
  readonly isCurrent: ReturnType<typeof vi.fn>;
  readonly canWriteLayer: ReturnType<typeof vi.fn>;
  readonly compensate: ReturnType<typeof vi.fn>;
  readonly upload: ReturnType<typeof vi.fn>;
  readonly hash: ReturnType<typeof vi.fn>;
}

function dependencies(
  overrides: Partial<StudioFilterMaskSurfacePublicationDependencies> = {}
): TestSetup {
  const order: string[] = [];
  const append = vi.fn(() => {
    order.push("append");
  });
  const attach = vi.fn(() => {
    order.push("attach");
  });
  const waitForAck = vi.fn(async (ack: StudioFilterMaskSurfacePublicationAckInput) => {
    order.push(`ack:${ack.phase}`);
    return { phase: ack.phase, sequence: ack.phase === "raster" ? "10" : "11" };
  });
  const isCurrent = vi.fn(async (_guard: StudioFilterMaskSurfacePublicationGuardInput) => true);
  const canWriteLayer = vi.fn(async () => true);
  const compensate = vi.fn(async () => true);
  const upload = vi.fn(async (
    _workId: string,
    { reference }: { reference: StudioRasterAssetReference }
  ) => {
    order.push("upload");
    return { ...reference };
  });
  const hash = vi.fn(async () => "a".repeat(64));
  const value = {
    encode: vi.fn(async ({ width, height, rgba: pixels }) => {
      order.push("encode");
      return {
        bytes: testPng(width, height, Uint8Array.from(pixels)),
        mediaType: "image/png" as const,
      };
    }),
    upload,
    append,
    compensate,
    canWriteLayer,
    isCurrent,
    nextLogicalClock: vi.fn(() => "1"),
    sha256SemanticParameters: hash,
    waitForAuthoritativeAck: waitForAck,
    attachSceneReference: attach,
    createSurfaceId: () => SURFACE_ID,
    createOperationId: () => OPERATION_ID,
    ...overrides,
  } satisfies StudioFilterMaskSurfacePublicationDependencies;
  return {
    value,
    order,
    append: value.append as ReturnType<typeof vi.fn>,
    attach: value.attachSceneReference as ReturnType<typeof vi.fn>,
    waitForAck: value.waitForAuthoritativeAck as ReturnType<typeof vi.fn>,
    isCurrent: value.isCurrent as ReturnType<typeof vi.fn>,
    canWriteLayer: value.canWriteLayer as ReturnType<typeof vi.fn>,
    compensate: value.compensate as ReturnType<typeof vi.fn>,
    upload: value.upload as ReturnType<typeof vi.fn>,
    hash: value.sha256SemanticParameters as ReturnType<typeof vi.fn>,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("studio filter-mask surface publisher", () => {
  it("uploads and appends the raster, crosses its ACK, then attaches and ACKs the tiny scene ref", async () => {
    const setup = dependencies();
    const result = await publishStudioFilterMaskSurface(input(), setup.value);

    expect(result.status).toBe("attached");
    if (result.status !== "attached") return;
    expect(result.surface).toEqual({
      version: 1,
      surfaceId: SURFACE_ID,
      width: 8,
      height: 6,
      tileSize: 1024,
    });
    expect(result.surfaceId).toBe(SURFACE_ID);
    expect(result.operation.operationId).toBe(OPERATION_ID);
    expect(result.operation.intent).toBe("paint");
    expect(setup.order.indexOf("upload")).toBeLessThan(setup.order.indexOf("append"));
    expect(setup.order.indexOf("append")).toBeLessThan(setup.order.indexOf("ack:raster"));
    expect(setup.order.indexOf("ack:raster")).toBeLessThan(setup.order.indexOf("attach"));
    expect(setup.order.indexOf("attach")).toBeLessThan(
      setup.order.indexOf("ack:scene-reference")
    );
    expect(setup.waitForAck).toHaveBeenCalledTimes(2);
    expect(setup.attach).toHaveBeenCalledOnce();
    expect(setup.attach).toHaveBeenCalledWith(expect.objectContaining({
      workId: "work-1",
      targetElementId: "image-1",
      sourceIdentity: "sha256:source-image-v1",
      generation: 7,
      filterMaskSurfaceId: SURFACE_ID,
      filterMaskEnabled: true,
    }));
    expect(setup.upload).toHaveBeenCalledWith(
      "work-1",
      expect.objectContaining({
        reference: expect.objectContaining({ scope: "work" }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("hashes bounded canonical semantics without embedding RGBA bytes or an inline source", async () => {
    const setup = dependencies();
    await publishStudioFilterMaskSurface(input(), setup.value);

    expect(setup.hash).toHaveBeenCalledOnce();
    const [canonical] = setup.hash.mock.calls[0] as [string, AbortSignal];
    expect(JSON.parse(canonical)).toEqual({
      generation: 7,
      height: 6,
      profile: "rgba8-white-alpha-mask-topdown-v1",
      purpose: "filter-mask-surface",
      selectedObjectStableId: "obj/desk",
      sourceIdentity: "sha256:source-image-v1",
      surfaceId: SURFACE_ID,
      targetElementId: "image-1",
      tileSize: 1024,
      version: 1,
      width: 8,
    });
    expect(canonical).not.toContain("data:");
    expect(canonical).not.toContain("255,255");
  });

  it("cannot attach while the first authoritative acknowledgement is pending", async () => {
    const rasterAck = deferred<unknown>();
    const setup = dependencies({
      waitForAuthoritativeAck: vi.fn(async ({ phase }) => {
        if (phase === "raster") return rasterAck.promise;
        return { phase };
      }),
    });

    const publication = publishStudioFilterMaskSurface(input(), setup.value);
    await vi.waitFor(() => expect(setup.append).toHaveBeenCalledOnce());
    expect(setup.attach).not.toHaveBeenCalled();
    rasterAck.resolve({ phase: "raster", sequence: "10" });
    await expect(publication).resolves.toMatchObject({ status: "attached" });
    expect(setup.attach).toHaveBeenCalledOnce();
  });

  it("never acknowledges or attaches when immutable asset upload fails", async () => {
    const setup = dependencies({
      upload: vi.fn(async () => {
        throw new Error("asset storage unavailable");
      }),
    });

    await expect(
      publishStudioFilterMaskSurface(input(), setup.value)
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfacePublicationError",
      code: "raster-publication-failed",
      details: {
        surfaceId: SURFACE_ID,
        rasterAcknowledged: false,
        sceneReferenceAttached: false,
      },
    });
    expect(setup.append).not.toHaveBeenCalled();
    expect(setup.waitForAck).not.toHaveBeenCalled();
    expect(setup.attach).not.toHaveBeenCalled();
  });

  it("rechecks the scope after the raster ACK and leaves an orphan-safe durable surface when stale", async () => {
    const setup = dependencies({
      isCurrent: vi.fn(async ({ phase }) => phase !== "after-raster-ack"),
    });

    await expect(
      publishStudioFilterMaskSurface(input(), setup.value)
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfacePublicationError",
      code: "stale-scope",
      details: {
        surfaceId: SURFACE_ID,
        rasterAcknowledged: true,
        sceneReferenceAttached: false,
        sceneReferenceMayBePending: false,
      },
    });
    expect(setup.waitForAck).toHaveBeenCalledOnce();
    expect(setup.waitForAck).toHaveBeenCalledWith(expect.objectContaining({ phase: "raster" }));
    expect(setup.attach).not.toHaveBeenCalled();
  });

  it("does not attempt the scene ACK when the synchronous scene patch fails", async () => {
    const setup = dependencies({
      attachSceneReference: vi.fn(() => {
        throw new Error("target was deleted");
      }),
    });

    await expect(
      publishStudioFilterMaskSurface(input(), setup.value)
    ).rejects.toMatchObject({
      code: "scene-reference-attach-failed",
      details: {
        surfaceId: SURFACE_ID,
        rasterAcknowledged: true,
        sceneReferenceAttached: false,
      },
    });
    expect(setup.waitForAck).toHaveBeenCalledOnce();
  });

  it("reports a possibly pending scene ref when only the second ACK fails", async () => {
    const setup = dependencies({
      waitForAuthoritativeAck: vi.fn(async ({ phase }) => {
        if (phase === "scene-reference") throw new Error("connection lost");
        return { phase, sequence: "10" };
      }),
    });

    await expect(
      publishStudioFilterMaskSurface(input(), setup.value)
    ).rejects.toMatchObject({
      code: "scene-reference-ack-failed",
      details: {
        surfaceId: SURFACE_ID,
        rasterAcknowledged: true,
        sceneReferenceAttached: true,
        sceneReferenceMayBePending: true,
      },
    });
    expect(setup.attach).toHaveBeenCalledOnce();
    expect(setup.waitForAck).toHaveBeenCalledTimes(2);
  });

  it("skips a fully transparent mask without an ACK or scene reference", async () => {
    const setup = dependencies();
    const result = await publishStudioFilterMaskSurface(input({
      pixels: rgba(8, 6, [255, 255, 255, 0]),
    }), setup.value);

    expect(result).toMatchObject({
      status: "skipped-transparent",
      surfaceId: SURFACE_ID,
      operationId: OPERATION_ID,
    });
    expect(setup.append).not.toHaveBeenCalled();
    expect(setup.waitForAck).not.toHaveBeenCalled();
    expect(setup.attach).not.toHaveBeenCalled();
  });

  it("combines the stale predicate with the publisher's second layer guard and compensates", async () => {
    let rasterGuardCount = 0;
    const setup = dependencies({
      isCurrent: vi.fn(async ({ phase }) => {
        if (phase !== "raster-publish") return true;
        rasterGuardCount += 1;
        return rasterGuardCount < 2;
      }),
    });

    await expect(
      publishStudioFilterMaskSurface(input(), setup.value)
    ).rejects.toMatchObject({ code: "raster-publication-failed" });
    expect(setup.upload).toHaveBeenCalledOnce();
    expect(setup.compensate).toHaveBeenCalledOnce();
    expect(setup.append).not.toHaveBeenCalled();
    expect(setup.waitForAck).not.toHaveBeenCalled();
    expect(setup.attach).not.toHaveBeenCalled();
  });

  it("rejects inline source identities, malformed buffers and injected IDs before encoding", async () => {
    const inline = dependencies();
    await expect(publishStudioFilterMaskSurface(input({
      sourceIdentity: "data:image/png;base64,AAAA",
    }), inline.value)).rejects.toMatchObject({ code: "invalid-input" });
    expect(inline.value.encode).not.toHaveBeenCalled();

    const short = dependencies();
    await expect(publishStudioFilterMaskSurface(input({
      pixels: new Uint8Array(7),
    }), short.value)).rejects.toMatchObject({ code: "invalid-input" });
    expect(short.value.encode).not.toHaveBeenCalled();

    const malformedSurface = dependencies({
      createSurfaceId: () =>
        "filter-mask:v1:not-a-uuid" as StudioFilterMaskSurfaceId,
    });
    await expect(
      publishStudioFilterMaskSurface(input(), malformedSurface.value)
    ).rejects.toMatchObject({ code: "invalid-dependencies" });
    expect(malformedSurface.value.encode).not.toHaveBeenCalled();

    const malformedOperation = dependencies({
      createOperationId: () => "not-an-operation-uuid",
    });
    await expect(
      publishStudioFilterMaskSurface(input(), malformedOperation.value)
    ).rejects.toMatchObject({ code: "invalid-dependencies" });
    expect(malformedOperation.value.encode).not.toHaveBeenCalled();
  });

  it("preserves the original typed cause on a phase failure", async () => {
    const cause = new Error("attach refused");
    const setup = dependencies({
      attachSceneReference: vi.fn(() => {
        throw cause;
      }),
    });

    const caught = await publishStudioFilterMaskSurface(input(), setup.value).catch(
      (error: unknown) => error
    );
    expect(caught).toBeInstanceOf(StudioFilterMaskSurfacePublicationError);
    expect((caught as Error).cause).toBe(cause);
  });
});
