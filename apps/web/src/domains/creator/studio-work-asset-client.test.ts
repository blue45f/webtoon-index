import { beforeEach, describe, expect, it, vi } from "vitest";

import { admitStudioLayerLiftArtifactPair } from "./layer/studio-layer-lift-artifact";
import {
  deleteUnreferencedStudioWorkAssetUpload,
  downloadStudioWorkAsset,
  readBoundedStudioWorkAssetResponse,
  StudioWorkAssetRequestError,
  uploadStudioWorkAssetLayerLiftBatch,
  uploadStudioWorkAsset,
} from "./studio-work-asset-client";

import type {
  StudioWorkAssetDescriptor,
  StudioWorkAssetLayerLiftBatchReceipt,
  StudioWorkAssetManifest,
} from "@/shared/lib/studio-work-asset-contract";


const { del, get, put } = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: { delete: del, get, put } },
  apiPath: (path: string) => `/api${path}`,
  isHttpError: () => false,
  toApiError: async (error: unknown, fallback: string) =>
    new Error(error instanceof Error ? error.message : fallback),
}));

const reference = { assetId: "asset / 한글", elementType: "image" as const };
const descriptor = {
  version: 1 as const,
  element: {
    id: reference.assetId,
    type: reference.elementType,
    x: 1,
    y: 2,
    width: 100,
    height: 200,
    rotation: 0,
  },
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function manifest(bytes: Uint8Array): Promise<StudioWorkAssetManifest> {
  return {
    version: 1,
    assetId: reference.assetId,
    elementType: "image",
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: await sha256(bytes),
    intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
    descriptor,
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

const BACKGROUND_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";
const FOREGROUND_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR42mMQ0bBxCEipaGCAAgAbbQJlJs9SqgAAAABJRU5ErkJggg==";
const LAYER_LIFT_BATCH_ID = "8fca58d7-20ad-4c38-9d57-3da0fcb70061";

function base64Buffer(value: string): ArrayBuffer {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
}

function layerLiftDescriptor(
  assetId: string,
  name: string,
): StudioWorkAssetDescriptor {
  return {
    version: 1,
    element: {
      id: assetId,
      type: "image",
      name,
      x: 10,
      y: 20,
      width: 4,
      height: 1,
      rotation: 0,
    },
  };
}

async function layerLiftUploadFixture() {
  const artifacts = await admitStudioLayerLiftArtifactPair({
    requestId: "layer-lift-request",
    sourceId: "source-image",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: "layer-lift-background",
      bytes: base64Buffer(BACKGROUND_PNG),
    },
    foreground: {
      outputId: "layer-lift-foreground",
      bytes: base64Buffer(FOREGROUND_PNG),
    },
  }, {
    decodePngDimensions: async () => ({ width: 4, height: 1 }),
  });
  const backgroundDescriptor = layerLiftDescriptor(
    artifacts.background.outputId,
    "분리 배경",
  );
  const foregroundDescriptor = layerLiftDescriptor(
    artifacts.foreground.outputId,
    "분리 전경",
  );
  const receipt: StudioWorkAssetLayerLiftBatchReceipt = {
    version: 1,
    batchId: LAYER_LIFT_BATCH_ID,
    assets: [
      {
        role: "background",
        manifest: {
          version: 1,
          assetId: artifacts.background.outputId,
          elementType: "image",
          mimeType: "image/png",
          byteSize: artifacts.background.byteLength,
          sha256: artifacts.background.sha256.slice("sha256:".length),
          intrinsicImage: { width: 4, height: 1, decodedRgbaBytes: 16 },
          descriptor: backgroundDescriptor,
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      },
      {
        role: "foreground",
        manifest: {
          version: 1,
          assetId: artifacts.foreground.outputId,
          elementType: "image",
          mimeType: "image/png",
          byteSize: artifacts.foreground.byteLength,
          sha256: artifacts.foreground.sha256.slice("sha256:".length),
          intrinsicImage: { width: 4, height: 1, decodedRgbaBytes: 16 },
          descriptor: foregroundDescriptor,
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      },
    ],
  };
  return {
    artifacts,
    backgroundDescriptor,
    foregroundDescriptor,
    receipt,
  };
}

describe("studio work asset client", () => {
  beforeEach(() => {
    del.mockReset();
    get.mockReset();
    put.mockReset();
  });

  it("downloads manifest and binary separately, then verifies MIME, size, and SHA-256", async () => {
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const expected = await manifest(bytes);
    get
      .mockResolvedValueOnce(jsonResponse(expected))
      .mockResolvedValueOnce(new Response(bytes, { headers: { "Content-Type": "image/png" } }));

    const result = await downloadStudioWorkAsset("work / 1", reference);

    expect(result.manifest).toEqual(expected);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(get.mock.calls[0]?.[0]).toBe("/api/creator/works/work%20%2F%201/assets/asset%20%2F%20%ED%95%9C%EA%B8%80");
    expect(get.mock.calls[1]?.[0]).toContain("/content");
    expect(get.mock.calls[0]?.[1]).toMatchObject({
      searchParams: { elementType: "image" },
    });
  });

  it("fails closed on a stale/tampered body and never returns a Blob", async () => {
    const expectedBytes = Uint8Array.of(1, 2, 3, 4);
    get
      .mockResolvedValueOnce(jsonResponse(await manifest(expectedBytes)))
      .mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3, 5), {
        headers: { "Content-Type": "image/png" },
      }));
    await expect(downloadStudioWorkAsset("work-1", reference))
      .rejects.toBeInstanceOf(StudioWorkAssetRequestError);
  });

  it("rejects Content-Length before reading and cancels an over-limit stream", async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const expected = await manifest(bytes);
    get
      .mockResolvedValueOnce(jsonResponse(expected))
      .mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3, 4, 5), {
        headers: { "Content-Type": "image/png", "Content-Length": "5" },
      }));
    await expect(downloadStudioWorkAsset("work-1", reference))
      .rejects.toThrow(/Content-Length/u);

    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3));
        controller.enqueue(Uint8Array.of(4, 5, 6));
      },
      cancel,
    });
    get
      .mockResolvedValueOnce(jsonResponse(expected))
      .mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "image/png" } }));
    await expect(downloadStudioWorkAsset("work-1", reference))
      .rejects.toThrow(/허용 크기/u);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("allows the non-stream fallback only after an exact bounded length", async () => {
    const arrayBuffer = vi.fn(async () => Uint8Array.of(1, 2, 3, 4).buffer);
    const response = {
      headers: new Headers({ "Content-Length": "4" }),
      body: null,
      arrayBuffer,
    } as unknown as Response;
    await expect(readBoundedStudioWorkAssetResponse(response, 4, 8))
      .resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(arrayBuffer).toHaveBeenCalledOnce();

    const unbounded = {
      ...response,
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => new ArrayBuffer(100)),
    } as unknown as Response;
    await expect(readBoundedStudioWorkAssetResponse(unbounded, 4, 8))
      .rejects.toThrow(/길이가 확인된/u);
    expect(unbounded.arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects a same-ID response with a different type", async () => {
    const bytes = Uint8Array.of(1);
    const wrong = {
      ...(await manifest(bytes)),
      elementType: "vrm",
      mimeType: "model/gltf-binary",
      intrinsicImage: null,
      descriptor: {
        ...descriptor,
        element: { ...descriptor.element, type: "vrm" },
      },
    };
    get.mockResolvedValueOnce(jsonResponse(wrong));
    await expect(downloadStudioWorkAsset("work-1", reference))
      .rejects.toBeInstanceOf(StudioWorkAssetRequestError);
    expect(get).toHaveBeenCalledOnce();
  });

  it("uploads multipart without putting bytes or data URLs in JSON/CRDT-shaped fields", async () => {
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const expected = await manifest(bytes);
    put.mockResolvedValueOnce(jsonResponse(expected));
    await expect(uploadStudioWorkAsset(
      "work-1",
      reference,
      descriptor,
      new Blob([bytes], { type: "image/png" })
    )).resolves.toEqual(expected);
    const options = put.mock.calls[0]?.[1] as { body?: unknown; headers?: unknown };
    expect(options.body).toBeInstanceOf(FormData);
    expect(options).not.toHaveProperty("headers");
    const form = options.body as FormData;
    expect(form.get("elementType")).toBe("image");
    expect(form.get("descriptor")).toBe(JSON.stringify(descriptor));
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(String(form.get("descriptor"))).not.toContain("data:");
  });

  it("uploads a receipt-bound layer-lift pair through one ordered multipart request", async () => {
    const fixture = await layerLiftUploadFixture();
    put.mockResolvedValueOnce(jsonResponse(fixture.receipt));

    await expect(uploadStudioWorkAssetLayerLiftBatch("work / 1", {
      batchId: LAYER_LIFT_BATCH_ID,
      artifacts: fixture.artifacts,
      backgroundDescriptor: fixture.backgroundDescriptor,
      foregroundDescriptor: fixture.foregroundDescriptor,
    })).resolves.toEqual(fixture.receipt);

    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toBe(
      "/api/creator/works/work%20%2F%201/asset-batches/layer-lift",
    );
    const options = put.mock.calls[0]?.[1] as { body?: unknown; headers?: unknown };
    expect(options.body).toBeInstanceOf(FormData);
    expect(options).not.toHaveProperty("headers");
    const form = options.body as FormData;
    const metadata = JSON.parse(String(form.get("metadata"))) as {
      batchId: string;
      assets: Array<{ role: string; assetId: string; expectedSha256: string }>;
    };
    expect(metadata).toMatchObject({
      batchId: LAYER_LIFT_BATCH_ID,
      assets: [
        {
          role: "background",
          assetId: fixture.artifacts.background.outputId,
          expectedSha256: fixture.artifacts.background.sha256.slice("sha256:".length),
        },
        {
          role: "foreground",
          assetId: fixture.artifacts.foreground.outputId,
          expectedSha256: fixture.artifacts.foreground.sha256.slice("sha256:".length),
        },
      ],
    });
    expect(form.get("background")).toBeInstanceOf(Blob);
    expect(form.get("foreground")).toBeInstanceOf(Blob);
  });

  it("rejects a swapped/tampered layer-lift batch receipt", async () => {
    const fixture = await layerLiftUploadFixture();
    put.mockResolvedValueOnce(jsonResponse({
      ...fixture.receipt,
      assets: [fixture.receipt.assets[1], fixture.receipt.assets[0]],
    }));

    await expect(uploadStudioWorkAssetLayerLiftBatch("work-1", {
      batchId: LAYER_LIFT_BATCH_ID,
      artifacts: fixture.artifacts,
      backgroundDescriptor: fixture.backgroundDescriptor,
      foregroundDescriptor: fixture.foregroundDescriptor,
    })).rejects.toBeInstanceOf(StudioWorkAssetRequestError);
  });

  it("revalidates artifact bytes immediately before a layer-lift batch upload", async () => {
    const fixture = await layerLiftUploadFixture();
    new Uint8Array(fixture.artifacts.background.bytes)[0] ^= 0xff;

    await expect(uploadStudioWorkAssetLayerLiftBatch("work-1", {
      batchId: LAYER_LIFT_BATCH_ID,
      artifacts: fixture.artifacts,
      backgroundDescriptor: fixture.backgroundDescriptor,
      foregroundDescriptor: fixture.foregroundDescriptor,
    })).rejects.toBeInstanceOf(StudioWorkAssetRequestError);
    expect(put).not.toHaveBeenCalled();
  });

  it("deletes only an exact receipt-bound orphan and validates the response", async () => {
    del.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await expect(deleteUnreferencedStudioWorkAssetUpload(
      "work / 1",
      reference,
      "a".repeat(64)
    )).resolves.toBe(true);
    expect(del).toHaveBeenCalledWith(
      "/api/creator/works/work%20%2F%201/assets/asset%20%2F%20%ED%95%9C%EA%B8%80",
      expect.objectContaining({
        searchParams: {
          elementType: "image",
          expectedSha256: "a".repeat(64),
        },
      })
    );

    del.mockResolvedValueOnce(jsonResponse({ deleted: "yes" }));
    await expect(deleteUnreferencedStudioWorkAssetUpload(
      "work-1",
      reference,
      "a".repeat(64)
    )).rejects.toBeInstanceOf(StudioWorkAssetRequestError);
  });

});
