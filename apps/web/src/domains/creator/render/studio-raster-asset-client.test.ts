import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteUnreferencedStudioRasterAssetUpload,
  downloadStudioRasterAsset,
  StudioRasterAssetRequestError,
  uploadStudioRasterAsset,
} from "./studio-raster-asset-client";

import type { StudioRasterAssetReference } from "@/shared/lib/studio-crdt-raster-ops";
import type { StudioRasterAssetManifest } from "@/shared/lib/studio-raster-asset-contract";

const { deleteRequest, get, put } = vi.hoisted(() => ({
  deleteRequest: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: { delete: deleteRequest, get, put } },
  apiPath: (path: string) => `/api${path}`,
  isHttpError: () => false,
  toApiError: async (error: unknown, fallback: string) =>
    new Error(error instanceof Error ? error.message : fallback),
}));

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer
  );
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fixture(bytes: Uint8Array): Promise<{
  reference: StudioRasterAssetReference;
  manifest: StudioRasterAssetManifest;
}> {
  const sha256 = await digest(bytes);
  const reference: StudioRasterAssetReference = {
    scope: "work",
    assetId: sha256,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: "image/png",
    width: 1,
    height: 1,
  };
  return {
    reference,
    manifest: {
      version: 1,
      ...reference,
      mediaType: "image/png",
      createdAt: "2026-07-16T00:00:00.000Z",
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("studio raster asset client", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    deleteRequest.mockReset();
  });

  it("uploads bytes only after local SHA validation and requires an exact manifest receipt", async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const { reference, manifest } = await fixture(bytes);
    put.mockResolvedValueOnce(jsonResponse(manifest));

    await expect(uploadStudioRasterAsset("work / 1", reference, bytes))
      .resolves.toEqual(reference);
    expect(put.mock.calls[0]?.[0]).toContain(`/raster-assets/${reference.assetId}`);
    const options = put.mock.calls[0]?.[1] as { body?: unknown; headers?: unknown };
    expect(options.body).toBeInstanceOf(FormData);
    expect(options).not.toHaveProperty("headers");
    expect((options.body as FormData).get("file")).toBeInstanceOf(Blob);

    await expect(uploadStudioRasterAsset(
      "work-1",
      reference,
      Uint8Array.of(1, 2, 3, 5)
    )).rejects.toBeInstanceOf(StudioRasterAssetRequestError);
    expect(put).toHaveBeenCalledOnce();
  });

  it("downloads manifest and content separately, then verifies MIME, size, and SHA", async () => {
    const bytes = Uint8Array.of(9, 8, 7, 6);
    const { reference, manifest } = await fixture(bytes);
    get
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(new Response(bytes, {
        headers: { "Content-Type": "image/png" },
      }));

    const downloaded = await downloadStudioRasterAsset("work-1", reference);

    expect(downloaded.manifest).toEqual(manifest);
    expect(downloaded.bytes).toEqual(bytes);
    expect(new Uint8Array(await downloaded.blob.arrayBuffer())).toEqual(bytes);
  });

  it("rejects a same-hash manifest with altered dimensions and a tampered body", async () => {
    const bytes = Uint8Array.of(5, 4, 3, 2);
    const { reference, manifest } = await fixture(bytes);
    get.mockResolvedValueOnce(jsonResponse({ ...manifest, width: 2 }));
    await expect(downloadStudioRasterAsset("work-1", reference))
      .rejects.toBeInstanceOf(StudioRasterAssetRequestError);

    get
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(new Response(Uint8Array.of(5, 4, 3, 1), {
        headers: { "Content-Type": "image/png" },
      }));
    await expect(downloadStudioRasterAsset("work-1", reference))
      .rejects.toBeInstanceOf(StudioRasterAssetRequestError);
  });

  it("cleans up only through the exact immutable upload receipt", async () => {
    const bytes = Uint8Array.of(4, 3, 2, 1);
    const { reference } = await fixture(bytes);
    deleteRequest.mockResolvedValueOnce(jsonResponse({ deleted: true }));

    await expect(deleteUnreferencedStudioRasterAssetUpload("work / 1", reference))
      .resolves.toBe(true);
    expect(deleteRequest).toHaveBeenCalledWith(
      `/api/creator/works/work%20%2F%201/raster-assets/${reference.assetId}`,
      {
        searchParams: {
          expectedSha256: reference.sha256,
          mediaType: "image/png",
          byteLength: String(reference.byteLength),
          width: "1",
          height: "1",
        },
        signal: undefined,
      }
    );

    deleteRequest.mockResolvedValueOnce(jsonResponse({ deleted: "yes" }));
    await expect(deleteUnreferencedStudioRasterAssetUpload("work-1", reference))
      .rejects.toBeInstanceOf(StudioRasterAssetRequestError);
  });
});
