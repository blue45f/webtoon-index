/**
 * Studio Lift 3D — 업로드한 이미지 파일을 파이프라인이 먹는 RGBA 로 푸는 브라우저 경계.
 *
 * 디코드 자체는 브라우저 API 가 하지만, "얼마나 크게 풀 것인가"와 "어떤 형식을 텍스처로
 * 실어보낼 것인가"는 순수 함수로 떼어 뒀다. 그 두 판단이 결과 품질과 메모리를 좌우한다.
 */

import {
  STUDIO_LIFT3D_LIMITS,
  type StudioLift3dSourceImage,
  type StudioLift3dTexture,
} from "./studio-lift3d-contract";

export const STUDIO_LIFT3D_ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/**
 * 원본을 통째로 풀지 않는다. 파이프라인은 어차피 256px 격자로 내려받으므로, 디코드는
 * 그 격자를 여유 있게 덮는 크기면 충분하다 — 8000px 원고를 RGBA 로 다 펴면 256MB 다.
 */
export const STUDIO_LIFT3D_DECODE_MAX_DIMENSION = 1600;

export function studioLift3dTextureMimeType(
  type: string | undefined,
): StudioLift3dTexture["mimeType"] | null {
  return (STUDIO_LIFT3D_ACCEPTED_MIME_TYPES as readonly string[]).includes(type ?? "")
    ? type as StudioLift3dTexture["mimeType"]
    : null;
}

/** 종횡비를 지키면서 한 변이 상한을 넘지 않는 디코드 크기. 확대는 하지 않는다. */
export function studioLift3dDecodeSize(
  width: number,
  height: number,
  maxDimension: number = STUDIO_LIFT3D_DECODE_MAX_DIMENSION,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface StudioLift3dDecodedFile {
  readonly source: StudioLift3dSourceImage;
  /** 원본 파일 바이트 — 화면 미리보기용. 크기와 무관하게 항상 있다. */
  readonly bytes: Uint8Array;
  readonly mimeType: StudioLift3dTexture["mimeType"];
  /** GLB 에 재인코딩 없이 실을 텍스처. 한도를 넘으면 null 이고 형상만 나간다. */
  readonly texture: StudioLift3dTexture | null;
  readonly fileName: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export type StudioLift3dDecodeErrorCode =
  | "decode-failed"
  | "too-large"
  | "too-narrow"
  | "too-small"
  | "unsupported-type";

export class StudioLift3dDecodeError extends Error {
  readonly code: StudioLift3dDecodeErrorCode;

  constructor(code: StudioLift3dDecodeErrorCode, message: string) {
    super(message);
    this.name = "StudioLift3dDecodeError";
    this.code = code;
  }
}

const DECODE_ERROR_MESSAGES: Readonly<Record<StudioLift3dDecodeErrorCode, string>> = Object.freeze({
  "decode-failed": "이미지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.",
  "too-large": "이미지가 너무 큽니다. 한 변 8192px, 32MP 이하로 줄여 주세요.",
  "too-narrow": "가로세로 비가 너무 극단적입니다. 긴 스트립은 장면 단위로 잘라서 올려 주세요.",
  "too-small": "이미지가 너무 작습니다. 한 변 8px 이상이어야 합니다.",
  "unsupported-type": "PNG · JPEG · WebP 이미지만 변환할 수 있습니다.",
});

export function studioLift3dDecodeErrorMessage(code: StudioLift3dDecodeErrorCode): string {
  return DECODE_ERROR_MESSAGES[code];
}

/**
 * 파일 하나를 RGBA 원본과 텍스처 바이트로 푼다.
 *
 * 알파를 지켜야 하므로 캔버스는 `willReadFrequently` + 기본 알파 조합으로 쓰고, 배경을 칠하지
 * 않는다. 배경을 칠하면 컷아웃 PNG 의 실루엣이 그 순간 사라진다.
 */
export async function decodeStudioLift3dFile(file: File): Promise<StudioLift3dDecodedFile> {
  const mimeType = studioLift3dTextureMimeType(file.type);
  if (mimeType === null) {
    throw new StudioLift3dDecodeError("unsupported-type", DECODE_ERROR_MESSAGES["unsupported-type"]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
  } catch {
    throw new StudioLift3dDecodeError("decode-failed", DECODE_ERROR_MESSAGES["decode-failed"]);
  }

  try {
    const { maxSourceDimension, maxSourcePixels, minSourceDimension } = STUDIO_LIFT3D_LIMITS;
    if (bitmap.width < minSourceDimension || bitmap.height < minSourceDimension) {
      throw new StudioLift3dDecodeError("too-small", DECODE_ERROR_MESSAGES["too-small"]);
    }
    if (
      bitmap.width > maxSourceDimension
      || bitmap.height > maxSourceDimension
      || bitmap.width * bitmap.height > maxSourcePixels
    ) {
      throw new StudioLift3dDecodeError("too-large", DECODE_ERROR_MESSAGES["too-large"]);
    }

    const size = studioLift3dDecodeSize(bitmap.width, bitmap.height);
    // 축소 뒤의 크기로 한 번 더 본다. 8192×30 같은 극단적 세로비는 원본 기준으로는 통과하지만
    // 축소하면 한 변이 8px 밑으로 내려간다 — 그대로 넘기면 파이프라인이 "원본이 작다"는,
    // 사용자가 올린 것과 맞지 않는 사유로 뒤늦게 거절한다.
    if (size.width < minSourceDimension || size.height < minSourceDimension) {
      throw new StudioLift3dDecodeError("too-narrow", DECODE_ERROR_MESSAGES["too-narrow"]);
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new StudioLift3dDecodeError("decode-failed", DECODE_ERROR_MESSAGES["decode-failed"]);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const imageData = context.getImageData(0, 0, size.width, size.height);

    return {
      source: { width: size.width, height: size.height, pixels: imageData.data },
      bytes,
      mimeType,
      texture: bytes.byteLength <= STUDIO_LIFT3D_LIMITS.maxTextureBytes
        ? { mimeType, bytes }
        : null,
      fileName: file.name.replace(/\.[^.]+$/u, ""),
      naturalWidth: bitmap.width,
      naturalHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
