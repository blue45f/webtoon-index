/**
 * Reads an asset response without ever allocating beyond the server-declared,
 * contract-bounded size. Kept independent from either asset contract so the
 * optional raster CRDT runtime does not enter the Studio startup graph.
 */
export async function readBoundedStudioAssetResponse(
  response: Response,
  expectedBytes: number,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 ||
    !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
    expectedBytes > maximumBytes
  ) {
    throw new Error("작품 에셋 크기 한도가 올바르지 않습니다.");
  }

  const rawLength = response.headers.get("content-length");
  let contentLength: number | null = null;
  if (rawLength !== null) {
    if (!/^(0|[1-9]\d*)$/u.test(rawLength.trim())) {
      throw new Error("작품 에셋 Content-Length가 올바르지 않습니다.");
    }
    contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength)) {
      throw new Error("작품 에셋 Content-Length가 너무 큽니다.");
    }
  }
  if (contentLength !== null && contentLength !== expectedBytes) {
    throw new Error("작품 에셋 Content-Length가 manifest와 다릅니다.");
  }

  const stream = response.body;
  if (!stream) {
    if (contentLength !== expectedBytes) {
      throw new Error("이 환경에서는 길이가 확인된 에셋만 받을 수 있습니다.");
    }
    const fallback = new Uint8Array(await response.arrayBuffer());
    if (fallback.byteLength !== expectedBytes || fallback.byteLength > maximumBytes) {
      throw new Error("작품 에셋 크기가 manifest와 다릅니다.");
    }
    return fallback;
  }

  const reader = stream.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel("studio_asset_body_rejected");
        } catch {
          // The original abort reason wins when the transport already closed.
        }
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("작품 에셋 다운로드가 취소되었습니다.", "AbortError");
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        try {
          await reader.cancel("studio_asset_body_rejected");
        } catch {
          // Preserve the bounded-read error.
        }
        throw new Error("작품 에셋 스트림 형식이 올바르지 않습니다.");
      }
      if (
        chunk.value.byteLength > expectedBytes - offset ||
        chunk.value.byteLength > maximumBytes - offset
      ) {
        try {
          await reader.cancel("studio_asset_body_rejected");
        } catch {
          // Preserve the bounded-read error.
        }
        throw new Error("작품 에셋 응답이 허용 크기를 넘었습니다.");
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) {
    throw new Error("작품 에셋 크기가 manifest와 다릅니다.");
  }
  return bytes;
}
