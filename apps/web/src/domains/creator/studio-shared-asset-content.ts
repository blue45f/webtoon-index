import type {
  SharedAssetCatalogItem,
  SharedAssetContent,
} from "@/src/infrastructure/creator-client";

interface DecodedStudioSharedAssetBitmap {
  width: number;
  height: number;
  close(): void;
}

export interface StudioSharedAssetDecodeRuntime {
  decode(blob: Blob): Promise<DecodedStudioSharedAssetBitmap>;
}

const SHARED_ASSET_IMAGE_DATA_URL =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

function browserDecodeRuntime(): StudioSharedAssetDecodeRuntime {
  return {
    async decode(blob) {
      if (typeof globalThis.createImageBitmap !== "function") {
        throw new Error("이 브라우저에서는 공유 에셋의 실제 픽셀을 검증할 수 없습니다.");
      }
      return globalThis.createImageBitmap(blob);
    },
  };
}

function contentBlob(content: SharedAssetContent): Blob {
  const fragmentIndex = content.dataUrl.indexOf("#");
  if (fragmentIndex !== -1 && content.kind !== "vrm_pose") {
    throw new Error("공유 에셋 원본에 허용되지 않은 메타데이터가 포함되어 있습니다.");
  }
  const imageDataUrl = fragmentIndex === -1
    ? content.dataUrl
    : content.dataUrl.slice(0, fragmentIndex);
  const match = SHARED_ASSET_IMAGE_DATA_URL.exec(imageDataUrl);
  if (!match) {
    throw new Error("공유 에셋 원본 이미지 형식이 올바르지 않습니다.");
  }

  const encoded = match[2]!;
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch (error) {
    throw new Error("공유 에셋 원본의 base64 데이터가 손상되었습니다.", { cause: error });
  }
  if (binary.length < 1) {
    throw new Error("공유 에셋 원본 이미지가 비어 있습니다.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1]! });
}

export function assertStudioSharedAssetContentMatchesCatalog(
  asset: Pick<SharedAssetCatalogItem, "id" | "width" | "height" | "kind">,
  content: SharedAssetContent
): void {
  if (
    content.id !== asset.id ||
    content.width !== asset.width ||
    content.height !== asset.height ||
    content.kind !== asset.kind
  ) {
    throw new Error("공유 에셋 원본이 현재 카탈로그 정보와 일치하지 않습니다.");
  }
}

/**
 * A catalog thumbnail is never trusted as canvas content. The on-demand original must still match
 * the catalog snapshot and the browser decoder must be able to materialize pixels at the exact
 * server-validated dimensions before it can enter a document or a moderation view.
 */
export async function verifyStudioSharedAssetContent(
  asset: Pick<SharedAssetCatalogItem, "id" | "width" | "height" | "kind">,
  content: SharedAssetContent,
  runtime: StudioSharedAssetDecodeRuntime = browserDecodeRuntime()
): Promise<SharedAssetContent> {
  assertStudioSharedAssetContentMatchesCatalog(asset, content);
  const blob = contentBlob(content);
  let bitmap: DecodedStudioSharedAssetBitmap;
  try {
    bitmap = await runtime.decode(blob);
  } catch (error) {
    if (error instanceof Error && error.message.includes("실제 픽셀을 검증")) throw error;
    throw new Error("공유 에셋 원본의 압축 픽셀 데이터를 해석하지 못했습니다.", { cause: error });
  }
  try {
    if (bitmap.width !== content.width || bitmap.height !== content.height) {
      throw new Error("공유 에셋 원본의 실제 크기가 카탈로그 정보와 일치하지 않습니다.");
    }
  } finally {
    bitmap.close();
  }
  return content;
}
