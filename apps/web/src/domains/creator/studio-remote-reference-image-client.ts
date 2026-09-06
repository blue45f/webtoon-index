import {
  STUDIO_REMOTE_REFERENCE_IMAGE_ENDPOINT,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES,
  StudioRemoteReferenceImageRequestSchema,
  StudioRemoteReferenceImageResponseSchema,
  type StudioRemoteReferenceImageResponse,
} from "@/shared/lib/studio-remote-reference-image-contract";
import { api, apiPath, isHttpError, toApiError } from "@/src/infrastructure/api";

export interface ImportedStudioRemoteReferenceImage
extends StudioRemoteReferenceImageResponse {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly blob: Blob;
}

export class StudioRemoteReferenceImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioRemoteReferenceImageRequestError";
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("원격 참고 이미지 요청이 취소되었습니다.", "AbortError");
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The validation or abort error remains authoritative after transport closure.
  }
}

async function readBoundedJsonResponse(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 서버 응답이 JSON 형식이 아닙니다.",
      null
    );
  }

  const rawLength = response.headers.get("content-length");
  const contentEncoding = response.headers
    .get("content-encoding")
    ?.trim()
    .toLowerCase();
  let declaredLength: number | null = null;
  if (rawLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(rawLength.trim())) {
      throw new StudioRemoteReferenceImageRequestError(
        "원격 참고 이미지 응답 길이가 올바르지 않습니다.",
        null
      );
    }
    const contentLength = Number(rawLength);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES
    ) {
      throw new StudioRemoteReferenceImageRequestError(
        "원격 참고 이미지 응답이 안전 크기 한도를 넘었습니다.",
        null
      );
    }
    declaredLength = contentLength;
  }

  const stream = response.body;
  if (!stream) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 응답 스트림을 읽을 수 없습니다.",
      null
    );
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        await cancelReader(reader, "remote_reference_aborted");
        throw abortReason(signal);
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        await cancelReader(reader, "remote_reference_invalid_chunk");
        throw new StudioRemoteReferenceImageRequestError(
          "원격 참고 이미지 응답 스트림이 올바르지 않습니다.",
          null
        );
      }
      if (chunk.value.byteLength > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES - byteLength) {
        await cancelReader(reader, "remote_reference_too_large");
        throw new StudioRemoteReferenceImageRequestError(
          "원격 참고 이미지 응답이 안전 크기 한도를 넘었습니다.",
          null
        );
      }
      chunks.push(Uint8Array.from(chunk.value));
      byteLength += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength < 1) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 서버가 빈 응답을 반환했습니다.",
      null
    );
  }
  // Browsers expose a decoded body while a reverse proxy can retain the compressed wire length.
  // Exact equality is meaningful only for identity responses; the decoded stream cap above remains
  // authoritative for gzip/br responses.
  if (
    declaredLength !== null &&
    (!contentEncoding || contentEncoding === "identity") &&
    declaredLength !== byteLength
  ) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 응답 길이가 Content-Length와 일치하지 않습니다.",
      null
    );
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 응답 인코딩이 올바르지 않습니다.",
      null,
      error
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 응답을 해석하지 못했습니다.",
      null,
      error
    );
  }
}

function decodeExactBase64(
  response: StudioRemoteReferenceImageResponse
): Uint8Array<ArrayBuffer> {
  const prefix = `data:${response.mediaType};base64,`;
  const encoded = response.dataUrl.slice(prefix.length);
  const expectedLength = Math.ceil(response.byteLength / 3) * 4;
  const expectedPadding = (3 - (response.byteLength % 3)) % 3;
  if (
    encoded.length !== expectedLength ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) ||
    !encoded.endsWith("=".repeat(expectedPadding)) ||
    (expectedPadding === 0 && encoded.includes("="))
  ) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 data URL 길이가 응답 계약과 일치하지 않습니다.",
      null
    );
  }
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch (error) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 data URL을 해석하지 못했습니다.",
      null,
      error
    );
  }
  if (binary.length !== response.byteLength) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지 바이트 길이가 응답 계약과 일치하지 않습니다.",
      null
    );
  }
  const bytes = new Uint8Array(response.byteLength);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw abortReason(signal);
  if (!globalThis.crypto?.subtle) {
    throw new StudioRemoteReferenceImageRequestError(
      "이 브라우저에서는 원격 참고 이미지 무결성을 확인할 수 없습니다.",
      null
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  if (signal?.aborted) throw abortReason(signal);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyBrowserDecodableImage(
  blob: Blob,
  response: StudioRemoteReferenceImageResponse,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  const decode = globalThis.createImageBitmap;
  if (typeof decode !== "function") {
    throw new StudioRemoteReferenceImageRequestError(
      "이 브라우저에서는 원격 참고 이미지의 실제 픽셀을 검증할 수 없습니다.",
      null
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(blob);
  } catch (error) {
    throw new StudioRemoteReferenceImageRequestError(
      "원격 참고 이미지의 압축 픽셀 데이터를 해석하지 못했습니다.",
      null,
      error
    );
  }
  try {
    if (signal?.aborted) throw abortReason(signal);
    if (bitmap.width !== response.width || bitmap.height !== response.height) {
      throw new StudioRemoteReferenceImageRequestError(
        "원격 참고 이미지의 실제 크기가 서버 검증 결과와 일치하지 않습니다.",
        null
      );
    }
  } finally {
    bitmap.close();
  }
}

async function requestError(
  error: unknown,
  fallback: string
): Promise<StudioRemoteReferenceImageRequestError> {
  const status = isHttpError(error) ? error.response.status : null;
  const message = await toApiError(error, fallback).then((value) => value.message);
  return new StudioRemoteReferenceImageRequestError(message, status, error);
}

export async function importStudioRemoteReferenceImage(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<ImportedStudioRemoteReferenceImage> {
  if (signal?.aborted) throw abortReason(signal);
  const request = StudioRemoteReferenceImageRequestSchema.safeParse({ url: sourceUrl });
  if (!request.success) {
    throw new StudioRemoteReferenceImageRequestError(
      request.error.issues[0]?.message ?? "올바른 원격 이미지 URL을 입력해 주세요.",
      null
    );
  }

  try {
    const rawResponse = await api.raw.post(
      apiPath(STUDIO_REMOTE_REFERENCE_IMAGE_ENDPOINT),
      { json: request.data, signal }
    );
    const parsed = StudioRemoteReferenceImageResponseSchema.safeParse(
      await readBoundedJsonResponse(rawResponse, signal)
    );
    if (!parsed.success) {
      throw new StudioRemoteReferenceImageRequestError(
        "원격 참고 이미지 서버 응답 계약이 올바르지 않습니다.",
        null
      );
    }
    const bytes = decodeExactBase64(parsed.data);
    if ((await sha256Hex(bytes, signal)) !== parsed.data.sha256) {
      throw new StudioRemoteReferenceImageRequestError(
        "원격 참고 이미지 SHA-256 무결성 검증에 실패했습니다.",
        null
      );
    }
    const blob = new Blob([bytes], { type: parsed.data.mediaType });
    await verifyBrowserDecodableImage(blob, parsed.data, signal);
    return {
      ...parsed.data,
      bytes,
      blob,
    };
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (error instanceof StudioRemoteReferenceImageRequestError) throw error;
    throw await requestError(error, "원격 참고 이미지를 가져오지 못했습니다.");
  }
}
