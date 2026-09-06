import {
  verifyStudioLayerLiftArtifactPairReceipt,
  type StudioLayerLiftTrustedArtifactPair,
} from "./layer/studio-layer-lift-artifact";
import { readBoundedStudioAssetResponse } from "./studio-bounded-asset-response";

import type {
  StudioWorkAssetDescriptor,
  StudioWorkAssetLayerLiftBatchMetadata,
  StudioWorkAssetLayerLiftBatchReceipt,
  StudioWorkAssetManifest,
  StudioWorkAssetType,
} from "@/shared/lib/studio-work-asset-contract";

import {
  parseStudioWorkAssetDescriptor,
  STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE,
  StudioWorkAssetLayerLiftBatchMetadataSchema,
  StudioWorkAssetLayerLiftBatchReceiptSchema,
  StudioWorkAssetManifestSchema,
  serializeStudioWorkAssetDescriptorCanonical,
} from "@/shared/lib/studio-work-asset-contract";
import { api, apiPath, isHttpError, toApiError } from "@/src/infrastructure/api";

export { readBoundedStudioAssetResponse as readBoundedStudioWorkAssetResponse } from "./studio-bounded-asset-response";


export interface StudioWorkAssetReference {
  assetId: string;
  elementType: StudioWorkAssetType;
}

export interface DownloadedStudioWorkAsset {
  manifest: StudioWorkAssetManifest;
  blob: Blob;
}

export class StudioWorkAssetRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioWorkAssetRequestError";
  }
}

function assetPath(workId: string, assetId: string): string {
  return `/creator/works/${encodeURIComponent(workId)}/assets/${encodeURIComponent(assetId)}`;
}

function layerLiftBatchPath(workId: string): string {
  return `/creator/works/${encodeURIComponent(workId)}/asset-batches/layer-lift`;
}

function exactManifest(
  value: unknown,
  expected: StudioWorkAssetReference
): StudioWorkAssetManifest {
  const parsed = StudioWorkAssetManifestSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.assetId !== expected.assetId ||
    parsed.data.elementType !== expected.elementType
  ) {
    throw new StudioWorkAssetRequestError("작품 에셋 응답 형식이 올바르지 않습니다.", null);
  }
  return parsed.data;
}

async function requestError(error: unknown, fallback: string): Promise<StudioWorkAssetRequestError> {
  const status = isHttpError(error) ? error.response.status : null;
  return new StudioWorkAssetRequestError(await toApiError(error, fallback).then((value) => value.message), status, error);
}

export interface UploadStudioWorkAssetLayerLiftBatchInput {
  readonly batchId: string;
  readonly artifacts: StudioLayerLiftTrustedArtifactPair;
  readonly backgroundDescriptor: StudioWorkAssetDescriptor;
  readonly foregroundDescriptor: StudioWorkAssetDescriptor;
}

function exactLayerLiftBatchReceipt(
  value: unknown,
  expected: StudioWorkAssetLayerLiftBatchMetadata,
): StudioWorkAssetLayerLiftBatchReceipt {
  const parsed = StudioWorkAssetLayerLiftBatchReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.batchId !== expected.batchId) {
    throw new StudioWorkAssetRequestError(
      "레이어 분리 에셋 배치 응답 형식이 올바르지 않습니다.",
      null,
    );
  }
  for (const [index, expectedEntry] of expected.assets.entries()) {
    const received = parsed.data.assets[index];
    if (
      received?.role !== expectedEntry.role
      || received.manifest.assetId !== expectedEntry.assetId
      || received.manifest.elementType !== "image"
      || received.manifest.mimeType !== "image/png"
      || received.manifest.sha256 !== expectedEntry.expectedSha256
      || received.manifest.byteSize !== expectedEntry.byteSize
      || received.manifest.intrinsicImage?.width !== expectedEntry.width
      || received.manifest.intrinsicImage.height !== expectedEntry.height
      || serializeStudioWorkAssetDescriptorCanonical(
        received.manifest.descriptor,
      ) !== serializeStudioWorkAssetDescriptorCanonical(
        expectedEntry.descriptor,
      )
    ) {
      throw new StudioWorkAssetRequestError(
        "레이어 분리 에셋 배치 응답이 요청한 산출물과 다릅니다.",
        null,
      );
    }
  }
  return parsed.data;
}

/**
 * Uploads the trusted background/foreground pair through the server's one-transaction endpoint.
 *
 * The pair is re-hashed and its PNG envelope is revalidated immediately before FormData is built,
 * so a mutated ArrayBuffer cannot be admitted under an older receipt. Keeping `batchId` in the
 * caller-owned input lets a lost-response retry reuse the exact same correlation identity.
 */
export async function uploadStudioWorkAssetLayerLiftBatch(
  workId: string,
  input: UploadStudioWorkAssetLayerLiftBatchInput,
  signal?: AbortSignal,
): Promise<StudioWorkAssetLayerLiftBatchReceipt> {
  try {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("레이어 분리 에셋 업로드가 취소되었습니다.", "AbortError");
    }
    const artifactReceipt = input.artifacts.receipt;
    const verified = await verifyStudioLayerLiftArtifactPairReceipt({
      requestId: artifactReceipt.requestId,
      sourceId: artifactReceipt.sourceId,
      sourceWidth: artifactReceipt.sourceWidth,
      sourceHeight: artifactReceipt.sourceHeight,
      backgroundOutputId: artifactReceipt.background.outputId,
      foregroundOutputId: artifactReceipt.foreground.outputId,
      receipt: artifactReceipt,
      backgroundBytes: input.artifacts.background.bytes,
      foregroundBytes: input.artifacts.foreground.bytes,
    });
    const backgroundDescriptor = parseStudioWorkAssetDescriptor(
      input.backgroundDescriptor,
      {
        assetId: verified.background.outputId,
        elementType: "image",
      },
    );
    const foregroundDescriptor = parseStudioWorkAssetDescriptor(
      input.foregroundDescriptor,
      {
        assetId: verified.foreground.outputId,
        elementType: "image",
      },
    );
    const metadata = StudioWorkAssetLayerLiftBatchMetadataSchema.parse({
      version: 1,
      batchId: input.batchId,
      assets: [
        {
          role: "background",
          assetId: verified.background.outputId,
          descriptor: backgroundDescriptor,
          expectedSha256: verified.background.sha256.slice("sha256:".length),
          byteSize: verified.background.byteLength,
          width: verified.background.width,
          height: verified.background.height,
        },
        {
          role: "foreground",
          assetId: verified.foreground.outputId,
          descriptor: foregroundDescriptor,
          expectedSha256: verified.foreground.sha256.slice("sha256:".length),
          byteSize: verified.foreground.byteLength,
          width: verified.foreground.width,
          height: verified.foreground.height,
        },
      ],
    });
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append(
      "background",
      new Blob([verified.background.bytes], { type: "image/png" }),
      `${verified.background.outputId}.png`,
    );
    form.append(
      "foreground",
      new Blob([verified.foreground.bytes], { type: "image/png" }),
      `${verified.foreground.outputId}.png`,
    );
    const response = await api.raw.put(apiPath(layerLiftBatchPath(workId)), {
      body: form,
      signal,
    });
    return exactLayerLiftBatchReceipt(
      await response.json<unknown>(),
      metadata,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioWorkAssetRequestError) throw error;
    throw await requestError(
      error,
      "레이어 분리 에셋 두 개를 원자적으로 업로드하지 못했습니다.",
    );
  }
}

export async function getStudioWorkAssetManifest(
  workId: string,
  reference: StudioWorkAssetReference,
  signal?: AbortSignal
): Promise<StudioWorkAssetManifest> {
  try {
    const response = await api.raw.get(apiPath(assetPath(workId, reference.assetId)), {
      searchParams: { elementType: reference.elementType },
      signal,
    });
    return exactManifest(await response.json<unknown>(), reference);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioWorkAssetRequestError) throw error;
    throw await requestError(error, "작품 에셋 정보를 불러오지 못했습니다.");
  }
}

export async function downloadStudioWorkAsset(
  workId: string,
  reference: StudioWorkAssetReference,
  signal?: AbortSignal
): Promise<DownloadedStudioWorkAsset> {
  const manifest = await getStudioWorkAssetManifest(workId, reference, signal);
  try {
    const response = await api.raw.get(
      apiPath(`${assetPath(workId, reference.assetId)}/content`),
      { searchParams: { elementType: reference.elementType }, signal }
    );
    const responseMime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (responseMime !== manifest.mimeType) {
      throw new StudioWorkAssetRequestError("작품 에셋 MIME 형식이 manifest와 다릅니다.", null);
    }
    const bytes = await readBoundedStudioAssetResponse(
      response,
      manifest.byteSize,
      STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE[reference.elementType],
      signal
    );
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (sha256 !== manifest.sha256) {
      throw new StudioWorkAssetRequestError("작품 에셋 무결성 검증에 실패했습니다.", null);
    }
    return {
      manifest,
      blob: new Blob([bytes], { type: manifest.mimeType }),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioWorkAssetRequestError) throw error;
    throw await requestError(error, "작품 에셋 원본을 불러오지 못했습니다.");
  }
}

export async function uploadStudioWorkAsset(
  workId: string,
  reference: StudioWorkAssetReference,
  descriptorValue: StudioWorkAssetDescriptor,
  file: Blob,
  signal?: AbortSignal
): Promise<StudioWorkAssetManifest> {
  const descriptor = parseStudioWorkAssetDescriptor(descriptorValue, reference);
  const form = new FormData();
  form.append("elementType", reference.elementType);
  form.append("descriptor", JSON.stringify(descriptor));
  form.append("file", file, `${reference.assetId}.${reference.elementType === "image" ? "bin" : "glb"}`);
  try {
    const response = await api.raw.put(apiPath(assetPath(workId, reference.assetId)), {
      body: form,
      signal,
    });
    return exactManifest(await response.json<unknown>(), reference);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioWorkAssetRequestError) throw error;
    throw await requestError(error, "작품 에셋을 업로드하지 못했습니다.");
  }
}

/**
 * Best-effort compensation for an upload receipt the editor no longer accepts. The server deletes
 * only the exact SHA uploaded by the caller and only when that identity never entered the durable
 * CRDT scene; this is deliberately not a general-purpose asset deletion API.
 */
export async function deleteUnreferencedStudioWorkAssetUpload(
  workId: string,
  reference: StudioWorkAssetReference,
  expectedSha256: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const response = await api.raw.delete(apiPath(assetPath(workId, reference.assetId)), {
      searchParams: {
        elementType: reference.elementType,
        expectedSha256,
      },
      signal,
    });
    const result = await response.json<unknown>();
    if (
      !result || typeof result !== "object" || Array.isArray(result) ||
      typeof (result as { deleted?: unknown }).deleted !== "boolean"
    ) {
      throw new StudioWorkAssetRequestError("작품 에셋 정리 응답 형식이 올바르지 않습니다.", null);
    }
    return (result as { deleted: boolean }).deleted;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StudioWorkAssetRequestError) throw error;
    throw await requestError(error, "사용하지 않는 작품 에셋을 정리하지 못했습니다.");
  }
}
