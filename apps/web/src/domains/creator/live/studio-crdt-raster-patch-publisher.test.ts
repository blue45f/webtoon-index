import { describe, expect, it, vi } from "vitest";

import {
  createStudioRasterBrowserPngEncoder,
  publishStudioRasterPatch,
  StudioRasterPatchPublicationError,
  type StudioRasterPatchCompensationInput,
  type StudioRasterPatchEncoder,
  type StudioRasterPatchPublishInput,
  type StudioRasterPatchPublisherDependencies,
  type StudioRasterPngCanvas,
} from "./studio-crdt-raster-patch-publisher";

import {
  STUDIO_RASTER_CRDT_VERSION,
  type StudioRasterAssetReference,
} from "@/shared/lib/studio-crdt-raster-ops";

const surface = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 300,
  height: 260,
  tileSize: 128,
} as const;

function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number] = () => [1, 2, 3, 255]
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      result.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return result;
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function testPng(width: number, height: number, payload: Uint8Array = Uint8Array.of(1)): Uint8Array {
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
  overrides: Partial<StudioRasterPatchPublishInput> = {}
): StudioRasterPatchPublishInput {
  const rect = overrides.rect ?? { x: 0, y: 0, width: 16, height: 16 };
  return {
    surface,
    operationId: "00000000-0000-4000-8000-000000000001",
    actorId: "artist-a",
    logicalClock: "7",
    pageId: "page-1",
    layerId: "layer-ink",
    intent: "paint",
    semanticParametersSha256: "a".repeat(64),
    rect,
    pixels: rgba(rect.width, rect.height),
    ...overrides,
  };
}

function deterministicEncoder(): StudioRasterPatchEncoder {
  return vi.fn(async ({ width, height, rgba: pixels }) => ({
    bytes: testPng(width, height, Uint8Array.from(pixels)),
    mediaType: "image/png" as const,
  }));
}

function exactUploader() {
  return vi.fn(async ({ reference }: { reference: StudioRasterAssetReference }) => ({ ...reference }));
}

function dependencies(overrides: Partial<StudioRasterPatchPublisherDependencies> = {}) {
  const append = vi.fn();
  return {
    value: {
      encode: deterministicEncoder(),
      upload: exactUploader(),
      append,
      ...overrides,
    } satisfies StudioRasterPatchPublisherDependencies,
    append,
  };
}

describe("studio raster patch publisher", () => {
  it("splits one document-space patch exactly at tile boundaries in stable row-major order", async () => {
    const setup = dependencies();
    const rect = { x: 127, y: 127, width: 3, height: 3 };
    const result = await publishStudioRasterPatch(input({
      rect,
      pixels: rgba(rect.width, rect.height, (x, y) => [x, y, x + y, 255]),
      intent: "fill",
    }), setup.value, { concurrency: 2 });

    expect(result.status).toBe("appended");
    if (result.status !== "appended") return;
    expect(result.operation.patches.map(({ tileX, tileY, region }) => ({ tileX, tileY, region }))).toEqual([
      { tileX: 0, tileY: 0, region: { x: 127, y: 127, width: 1, height: 1 } },
      { tileX: 1, tileY: 0, region: { x: 0, y: 127, width: 2, height: 1 } },
      { tileX: 0, tileY: 1, region: { x: 127, y: 0, width: 1, height: 2 } },
      { tileX: 1, tileY: 1, region: { x: 0, y: 0, width: 2, height: 2 } },
    ]);
    expect(result.operation.patches.every((patch) => (
      patch.effect.kind === "composite" && patch.effect.blendMode === "source-over"
    ))).toBe(true);
    expect(setup.append).toHaveBeenCalledOnce();
    expect(setup.append).toHaveBeenCalledWith(result.log, expect.any(AbortSignal));
  });

  it("publishes erase and clear alpha as destination-out composite operations", async () => {
    for (const intent of ["erase", "clear"] as const) {
      const setup = dependencies();
      const result = await publishStudioRasterPatch(input({ intent }), setup.value);
      expect(result.status).toBe("appended");
      if (result.status !== "appended") continue;
      expect(result.operation.intent).toBe(intent);
      expect(result.operation.patches[0]?.effect).toMatchObject({
        kind: "composite",
        blendMode: "destination-out",
      });
    }
  });

  it("fails closed before encoding when the authoritative layer is locked", async () => {
    const setup = dependencies({ canWriteLayer: vi.fn(async () => false) });

    await expect(publishStudioRasterPatch(input(), setup.value)).rejects.toMatchObject({
      code: "layer_locked",
    });
    expect(setup.value.canWriteLayer).toHaveBeenCalledOnce();
    expect(setup.value.canWriteLayer).toHaveBeenCalledWith({
      operationId: input().operationId,
      actorId: "artist-a",
      pageId: "page-1",
      layerId: "layer-ink",
      intent: "paint",
    }, expect.any(AbortSignal));
    expect(setup.value.encode).not.toHaveBeenCalled();
    expect(setup.value.upload).not.toHaveBeenCalled();
    expect(setup.append).not.toHaveBeenCalled();
  });

  it("rechecks a layer lock race before append and compensates verified uploads", async () => {
    const canWriteLayer = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const compensate = vi.fn(async () => true);
    const setup = dependencies({ canWriteLayer, compensate });

    await expect(publishStudioRasterPatch(input(), setup.value)).rejects.toMatchObject({
      code: "layer_locked",
    });
    expect(canWriteLayer).toHaveBeenCalledTimes(2);
    expect(setup.value.upload).toHaveBeenCalledOnce();
    expect(compensate).toHaveBeenCalledOnce();
    expect(setup.append).not.toHaveBeenCalled();
  });

  it("omits fully transparent tile crops and skips an entirely transparent operation", async () => {
    const partial = dependencies();
    const rect = { x: 0, y: 0, width: 256, height: 128 };
    const partialResult = await publishStudioRasterPatch(input({
      rect,
      pixels: rgba(rect.width, rect.height, (x) => x < 128 ? [0, 0, 0, 0] : [4, 5, 6, 255]),
    }), partial.value);
    expect(partialResult.status).toBe("appended");
    if (partialResult.status === "appended") {
      expect(partialResult.operation.patches).toHaveLength(1);
      expect(partialResult.operation.patches[0]).toMatchObject({ tileX: 1, tileY: 0 });
    }
    expect(partial.value.encode).toHaveBeenCalledOnce();

    const empty = dependencies();
    const emptyResult = await publishStudioRasterPatch(input({
      pixels: rgba(16, 16, () => [190, 80, 30, 0]),
    }), empty.value);
    expect(emptyResult).toEqual({
      status: "skipped-transparent",
      operation: null,
      log: null,
      assets: [],
    });
    expect(empty.value.encode).not.toHaveBeenCalled();
    expect(empty.value.upload).not.toHaveBeenCalled();
    expect(empty.append).not.toHaveBeenCalled();
  });

  it("encodes and uploads identical tile payloads once, then reuses one immutable reference", async () => {
    const setup = dependencies();
    const rect = { x: 0, y: 0, width: 256, height: 128 };
    const result = await publishStudioRasterPatch(input({
      rect,
      pixels: rgba(rect.width, rect.height, (x, y) => [x % 128, y, 90, 255]),
    }), setup.value);

    expect(result.status).toBe("appended");
    if (result.status !== "appended") return;
    expect(setup.value.encode).toHaveBeenCalledOnce();
    expect(setup.value.upload).toHaveBeenCalledOnce();
    expect(result.assets).toHaveLength(1);
    expect(result.operation.patches).toHaveLength(2);
    expect(result.operation.patches[0]?.effect.payload).toEqual(
      result.operation.patches[1]?.effect.payload
    );
    expect(result.assets[0]?.assetId).toBe(result.assets[0]?.sha256);
  });

  it("never appends when an upload fails after an earlier content-addressed upload succeeds", async () => {
    const encode = deterministicEncoder();
    const upload = vi.fn()
      .mockImplementationOnce(async ({ reference }) => ({ ...reference }))
      .mockRejectedValueOnce(new Error("storage offline"));
    const compensate = vi.fn(async (_input: StudioRasterPatchCompensationInput) => true);
    const setup = dependencies({ encode, upload, compensate });
    const rect = { x: 0, y: 0, width: 256, height: 128 };

    await expect(publishStudioRasterPatch(input({
      rect,
      pixels: rgba(rect.width, rect.height, (x) => x < 128 ? [1, 2, 3, 255] : [8, 9, 10, 255]),
    }), setup.value, { concurrency: 1 })).rejects.toThrow("storage offline");

    expect(upload).toHaveBeenCalledTimes(2);
    expect(setup.append).not.toHaveBeenCalled();
    expect(compensate).toHaveBeenCalledOnce();
    expect(compensate).toHaveBeenCalledWith({
      reference: expect.objectContaining({ scope: "work", assetId: expect.any(String) }),
      signal: expect.any(AbortSignal),
    });
  });

  it("compensates every exact upload receipt without masking an append failure", async () => {
    const appendFailure = new Error("durable append rejected");
    const compensate = vi.fn(async (_input: StudioRasterPatchCompensationInput) => true);
    const upload = exactUploader();
    const setup = dependencies({
      append: vi.fn(async () => {
        throw appendFailure;
      }),
      compensate,
      upload,
    });
    const rect = { x: 0, y: 0, width: 256, height: 128 };

    await expect(publishStudioRasterPatch(input({
      rect,
      pixels: rgba(
        rect.width,
        rect.height,
        (x) => x < 128 ? [1, 2, 3, 255] : [8, 9, 10, 255]
      ),
    }), setup.value, { concurrency: 2 })).rejects.toBe(appendFailure);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(compensate).toHaveBeenCalledTimes(2);
    const uploadedAssetIds = upload.mock.calls
      .map(([value]) => value.reference.assetId)
      .sort();
    const compensatedAssetIds = compensate.mock.calls
      .map(([value]) => value.reference.assetId)
      .sort();
    expect(compensatedAssetIds).toEqual(uploadedAssetIds);
  });

  it("preserves the publication error when receipt cleanup is refused or fails", async () => {
    const appendFailure = new Error("append offline");
    const compensate = vi.fn((_input: StudioRasterPatchCompensationInput) => Promise.resolve(true))
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("cleanup offline"));
    const setup = dependencies({
      append: vi.fn(async () => {
        throw appendFailure;
      }),
      compensate,
    });
    const rect = { x: 0, y: 0, width: 256, height: 128 };

    await expect(publishStudioRasterPatch(input({
      rect,
      pixels: rgba(
        rect.width,
        rect.height,
        (x) => x < 128 ? [1, 2, 3, 255] : [8, 9, 10, 255]
      ),
    }), setup.value, { concurrency: 2 })).rejects.toBe(appendFailure);
    expect(compensate).toHaveBeenCalledTimes(2);
  });

  it("waits for every exact upload receipt before making its single append call", async () => {
    const resolveUploads: Array<() => void> = [];
    const upload = vi.fn(({ reference }: { reference: StudioRasterAssetReference }) => (
      new Promise<StudioRasterAssetReference>((resolve) => {
        resolveUploads.push(() => resolve({ ...reference }));
      })
    ));
    const setup = dependencies({ upload });
    const rect = { x: 0, y: 0, width: 256, height: 128 };
    const publication = publishStudioRasterPatch(input({
      rect,
      pixels: rgba(rect.width, rect.height, (x) => x < 128 ? [1, 2, 3, 255] : [8, 9, 10, 255]),
    }), setup.value, { concurrency: 2 });

    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(setup.append).not.toHaveBeenCalled();
    resolveUploads[0]!();
    await Promise.resolve();
    expect(setup.append).not.toHaveBeenCalled();
    resolveUploads[1]!();
    await expect(publication).resolves.toMatchObject({ status: "appended" });
    expect(setup.append).toHaveBeenCalledOnce();
  });

  it("honors AbortSignal before work and between upload resolution and append", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const preflight = dependencies();
    await expect(publishStudioRasterPatch(
      input(),
      preflight.value,
      { signal: alreadyAborted.signal }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(preflight.value.encode).not.toHaveBeenCalled();
    expect(preflight.value.upload).not.toHaveBeenCalled();
    expect(preflight.append).not.toHaveBeenCalled();

    const duringUpload = new AbortController();
    const upload = vi.fn(async ({ reference }) => {
      duringUpload.abort();
      return { ...reference };
    });
    const active = dependencies({ upload });
    await expect(publishStudioRasterPatch(
      input(),
      active.value,
      { signal: duringUpload.signal }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(active.append).not.toHaveBeenCalled();
  });

  it("rejects a mismatched upload receipt and preserves append atomicity", async () => {
    const upload = vi.fn(async ({ reference }) => ({
      ...reference,
      sha256: "f".repeat(64),
    }));
    const setup = dependencies({ upload });

    await expect(publishStudioRasterPatch(input(), setup.value)).rejects.toMatchObject({
      code: "upload_receipt_mismatch",
    });
    expect(setup.append).not.toHaveBeenCalled();
  });

  it("preflights patch-count and unique-byte budgets before any upload", async () => {
    const patchBudget = dependencies();
    const rect = { x: 127, y: 0, width: 2, height: 1 };
    await expect(publishStudioRasterPatch(input({
      rect,
      pixels: rgba(2, 1),
    }), patchBudget.value, { maxPatchCount: 1 })).rejects.toMatchObject({
      code: "patch_count_budget",
    });
    expect(patchBudget.value.encode).not.toHaveBeenCalled();
    expect(patchBudget.value.upload).not.toHaveBeenCalled();

    const byteBudget = dependencies();
    await expect(publishStudioRasterPatch(input(), byteBudget.value, {
      maxTotalBytes: 24,
    })).rejects.toMatchObject({ code: "total_byte_budget" });
    expect(byteBudget.value.encode).toHaveBeenCalledOnce();
    expect(byteBudget.value.upload).not.toHaveBeenCalled();
    expect(byteBudget.append).not.toHaveBeenCalled();
  });

  it("produces the same immutable operation regardless of asynchronous encoder completion order", async () => {
    const run = async (reverseDelay: boolean) => {
      const encode = vi.fn(async ({ width, height, rgba: pixels }) => {
        const marker = pixels[0] ?? 0;
        const delay = reverseDelay ? 10 - marker : marker;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          bytes: testPng(width, height, Uint8Array.from(pixels)),
          mediaType: "image/png" as const,
        };
      });
      const setup = dependencies({ encode });
      const rect = { x: 0, y: 0, width: 256, height: 128 };
      const result = await publishStudioRasterPatch(input({
        rect,
        pixels: rgba(rect.width, rect.height, (x) => x < 128 ? [1, 0, 0, 255] : [9, 0, 0, 255]),
      }), setup.value, { concurrency: 2 });
      if (result.status !== "appended") throw new Error("expected appended operation");
      return result.operation;
    };

    expect(await run(false)).toEqual(await run(true));
  });

  it("fails closed when the selected OffscreenCanvas backend fails", async () => {
    const offscreen = vi.fn((): StudioRasterPngCanvas => ({
      getContext: () => null,
    }));
    const html = vi.fn((): StudioRasterPngCanvas => ({
      getContext: () => null,
    }));
    const encoder = createStudioRasterBrowserPngEncoder({
      backend: "offscreen-canvas",
      createOffscreenCanvas: offscreen,
      createHtmlCanvas: html,
    });

    await expect(encoder({
      width: 1,
      height: 1,
      rgba: Uint8ClampedArray.of(200, 100, 50, 128),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "canvas_context_unavailable" });
    expect(offscreen).toHaveBeenCalledOnce();
    expect(html).not.toHaveBeenCalled();
  });

  it("uses HTMLCanvas only when it is explicitly selected and copies straight RGBA", async () => {
    const copied: number[] = [];
    const offscreen = vi.fn((): StudioRasterPngCanvas => ({
      getContext: () => null,
    }));
    const html = vi.fn((width: number, height: number): StudioRasterPngCanvas => ({
      getContext: () => ({
        createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (imageData) => copied.push(...imageData.data),
      }),
      toBlob: (callback) => callback(new Blob([
        Uint8Array.from(testPng(width, height)).buffer,
      ], { type: "image/png" })),
    }));
    const encoder = createStudioRasterBrowserPngEncoder({
      backend: "html-canvas",
      createOffscreenCanvas: offscreen,
      createHtmlCanvas: html,
    });
    const controller = new AbortController();
    const pixels = Uint8ClampedArray.of(200, 100, 50, 128);

    const encoded = await encoder({ width: 1, height: 1, rgba: pixels, signal: controller.signal });

    expect(encoded.mediaType).toBe("image/png");
    expect(offscreen).not.toHaveBeenCalled();
    expect(html).toHaveBeenCalledOnce();
    expect(copied).toEqual([...pixels]);
  });

  it("rejects PNG IHDR dimensions that do not match the tile crop", async () => {
    const setup = dependencies({
      encode: vi.fn(async () => ({
        bytes: testPng(1, 1),
        mediaType: "image/png" as const,
      })),
    });
    await expect(publishStudioRasterPatch(input(), setup.value)).rejects.toBeInstanceOf(
      StudioRasterPatchPublicationError
    );
    expect(setup.value.upload).not.toHaveBeenCalled();
    expect(setup.append).not.toHaveBeenCalled();
  });
});
