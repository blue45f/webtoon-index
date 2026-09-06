import type { StudioRasterAssetReference } from "@/shared/lib/studio-crdt-raster-ops";

import {
  STUDIO_RASTER_ASSET_MAX_BYTES,
  StudioRasterAssetManifestSchema,
  isStudioRasterAssetReferenceStoredExactly,
  parseStudioRasterStoredReference,
  type StudioRasterAssetManifest,
} from "@/shared/lib/studio-raster-asset-contract";
import { api, apiPath, isHttpError, toApiError } from "@/src/infrastructure/api";

export interface DownloadedStudioRasterAsset {
  readonly manifest: StudioRasterAssetManifest;
  readonly bytes: Uint8Array;
  readonly blob: Blob;
}

export class StudioRasterAssetRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioRasterAssetRequestError";
  }
}

function rasterAssetPath(workId: string, assetId: string): string {
  return `/creator/works/${encodeURIComponent(workId)}/raster-assets/${encodeURIComponent(assetId)}`;
}

function exactManifest(
  value: unknown,
  expected: StudioRasterAssetReference
): StudioRasterAssetManifest {
  const parsed = StudioRasterAssetManifestSchema.safeParse(value);
  if (!parsed.success || !isStudioRasterAssetReferenceStoredExactly(parsed.data, expected)) {
    throw new StudioRasterAssetRequestError(
      "래스터 타일 manifest가 요청한 내용 주소와 일치하지 않습니다.",
      null
    );
  }
  return parsed.data;
}

async function requestError(
  error: unknown,
  fallback: string
): Promise<StudioRasterAssetRequestError> {
  const status = isHttpError(error) ? error.response.status : null;
  const message = await toApiError(error, fallback).then((value) => value.message);
  return new StudioRasterAssetRequestError(message, status, error);
}

async function sha256(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new StudioRasterAssetRequestError(
      "이 브라우저에서는 래스터 타일 SHA-256을 검증할 수 없습니다.",
      null
    );
  }
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("래스터 타일 요청이 취소되었습니다.", "AbortError");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer
  );
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("래스터 타일 요청이 취소되었습니다.", "AbortError");
  }
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function getStudioRasterAssetManifest(
  workId: string,
  referenceValue: StudioRasterAssetReference,
  signal?: AbortSignal
): Promise<StudioRasterAssetManifest> {
  const reference = parseStudioRasterStoredReference(referenceValue);
  try {
    const response = await api.raw.get(
      apiPath(rasterAssetPath(workId, reference.assetId)),
      { signal }
    );
    return exactManifest(await response.json<unknown>(), reference);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioRasterAssetRequestError) throw error;
    throw await requestError(error, "래스터 타일 정보를 불러오지 못했습니다.");
  }
}

export async function downloadStudioRasterAsset(
  workId: string,
  referenceValue: StudioRasterAssetReference,
  signal?: AbortSignal
): Promise<DownloadedStudioRasterAsset> {
  const reference = parseStudioRasterStoredReference(referenceValue);
  const manifest = await getStudioRasterAssetManifest(workId, reference, signal);
  try {
    const response = await api.raw.get(
      apiPath(`${rasterAssetPath(workId, reference.assetId)}/content`),
      { signal }
    );
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== manifest.mediaType) {
      throw new StudioRasterAssetRequestError(
        "래스터 타일 MIME 형식이 manifest와 다릅니다.",
        null
      );
    }
    // Keep the experimental raster contract out of the Studio startup graph:
    // this bounded reader is already shared by ordinary work assets and can be
    // resolved on demand when raster hydration is actually requested.
    const { readBoundedStudioAssetResponse } = await import("../studio-bounded-asset-response");
    const bytes = await readBoundedStudioAssetResponse(
      response,
      manifest.byteLength,
      STUDIO_RASTER_ASSET_MAX_BYTES,
      signal
    );
    if ((await sha256(bytes, signal)) !== manifest.sha256) {
      throw new StudioRasterAssetRequestError(
        "래스터 타일 SHA-256 무결성 검증에 실패했습니다.",
        null
      );
    }
    return {
      manifest,
      bytes,
      blob: new Blob([bytes], { type: manifest.mediaType }),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioRasterAssetRequestError) throw error;
    throw await requestError(error, "래스터 타일 원본을 불러오지 못했습니다.");
  }
}

export async function uploadStudioRasterAsset(
  workId: string,
  referenceValue: StudioRasterAssetReference,
  bytesValue: Uint8Array,
  signal?: AbortSignal
): Promise<StudioRasterAssetReference> {
  const reference = parseStudioRasterStoredReference(referenceValue);
  const bytes = Uint8Array.from(bytesValue);
  if (bytes.byteLength !== reference.byteLength) {
    throw new StudioRasterAssetRequestError(
      "업로드할 래스터 타일 크기가 내용 주소와 다릅니다.",
      null
    );
  }
  if ((await sha256(bytes, signal)) !== reference.sha256) {
    throw new StudioRasterAssetRequestError(
      "업로드할 래스터 타일 SHA-256이 내용 주소와 다릅니다.",
      null
    );
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: reference.mediaType }),
    `${reference.assetId}.png`
  );
  try {
    const response = await api.raw.put(
      apiPath(rasterAssetPath(workId, reference.assetId)),
      { body: form, signal }
    );
    const manifest = exactManifest(await response.json<unknown>(), reference);
    return parseStudioRasterStoredReference({
      scope: manifest.scope,
      assetId: manifest.assetId,
      sha256: manifest.sha256,
      byteLength: manifest.byteLength,
      mediaType: manifest.mediaType,
      width: manifest.width,
      height: manifest.height,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioRasterAssetRequestError) throw error;
    throw await requestError(error, "래스터 타일을 업로드하지 못했습니다.");
  }
}

/**
 * Best-effort compensation for one exact upload receipt. This is not a user-facing delete: the
 * server accepts it only from the original uploader and only before the asset enters durable CRDT
 * history.
 */
export async function deleteUnreferencedStudioRasterAssetUpload(
  workId: string,
  referenceValue: StudioRasterAssetReference,
  signal?: AbortSignal
): Promise<boolean> {
  const reference = parseStudioRasterStoredReference(referenceValue);
  try {
    const response = await api.raw.delete(
      apiPath(rasterAssetPath(workId, reference.assetId)),
      {
        searchParams: {
          expectedSha256: reference.sha256,
          mediaType: reference.mediaType,
          byteLength: String(reference.byteLength),
          width: String(reference.width),
          height: String(reference.height),
        },
        signal,
      }
    );
    const result = await response.json<unknown>();
    if (
      !result || typeof result !== "object" || Array.isArray(result) ||
      typeof (result as { deleted?: unknown }).deleted !== "boolean"
    ) {
      throw new StudioRasterAssetRequestError("래스터 타일 정리 응답 형식이 올바르지 않습니다.", null);
    }
    return (result as { deleted: boolean }).deleted;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioRasterAssetRequestError) throw error;
    throw await requestError(error, "사용하지 않는 래스터 타일을 정리하지 못했습니다.");
  }
}
