import type {
  StudioRasterSourceLease,
  StudioRasterSourceLeaseOptions,
} from "./render/studio-raster-source-lease";

export const STUDIO_LINKED_3D_PORTABLE_RASTER_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const STUDIO_LINKED_3D_PORTABLE_RASTER_MAX_EMBEDDED_BYTES = 96 * 1024 * 1024;

const STRICT_LOCATOR_PATTERN = /^studio-opfs-cas:sha256:[a-f0-9]{64}$/u;
const RESERVED_PREFIX = "studio-opfs-cas:";

export interface StudioPortableRasterElement {
  readonly src?: string;
  readonly type: string;
}

export type StudioPortableRasterLeaseAcquirer = (
  source: string,
  options: StudioRasterSourceLeaseOptions,
) => Promise<StudioRasterSourceLease>;

export type StudioPortableRasterEncoder = (
  blob: Blob,
  signal?: AbortSignal,
) => Promise<string>;

export class StudioLinked3dPortableRasterProjectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StudioLinked3dPortableRasterProjectionError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

async function acquireDefaultLease(
  source: string,
  options: StudioRasterSourceLeaseOptions,
): Promise<StudioRasterSourceLease> {
  const { acquireStudioRasterSourceLease } = await import("./render/studio-raster-source-lease");
  return await acquireStudioRasterSourceLease(source, options);
}

function encodeBlobAsDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (typeof globalThis.FileReader !== "function") {
    throw new StudioLinked3dPortableRasterProjectionError(
      "이 브라우저에서는 연결형 3D raster를 portable SVG로 변환할 수 없습니다.",
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      try {
        reader.abort();
      } catch {
        // FileReader may already be terminal. The AbortError below remains authoritative.
      }
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    reader.onerror = () => {
      cleanup();
      reject(new StudioLinked3dPortableRasterProjectionError(
        "연결형 3D raster를 portable SVG 데이터로 읽지 못했습니다.",
      ));
    };
    reader.onload = () => {
      cleanup();
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/png;base64,")) {
        reject(new StudioLinked3dPortableRasterProjectionError(
          "연결형 3D raster의 portable SVG 데이터가 PNG가 아닙니다.",
        ));
        return;
      }
      resolve(reader.result);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

/**
 * Replaces linked OPFS locators with verified, portable PNG data URLs in a throwaway export
 * projection. Canonical elements are never mutated and every presentation lease is released.
 */
export async function projectStudioLinked3dRasterSourcesForPortableExport<
  Element extends StudioPortableRasterElement,
>(
  elements: readonly Element[],
  options: {
    readonly acquire?: StudioPortableRasterLeaseAcquirer;
    readonly encode?: StudioPortableRasterEncoder;
    readonly signal?: AbortSignal;
  } = {},
): Promise<readonly Element[]> {
  throwIfAborted(options.signal);
  const locators = Array.from(new Set(elements.flatMap((element) => {
    if (typeof element.src !== "string" || !element.src.startsWith(RESERVED_PREFIX)) return [];
    if (!STRICT_LOCATOR_PATTERN.test(element.src)) {
      throw new StudioLinked3dPortableRasterProjectionError(
        "연결형 3D raster locator가 손상되어 portable 내보내기를 중단했습니다.",
      );
    }
    return [element.src];
  })));
  if (locators.length === 0) return elements;

  const acquire = options.acquire ?? acquireDefaultLease;
  const encode = options.encode ?? encodeBlobAsDataUrl;
  const projected = new Map<string, string>();
  let totalSourceBytes = 0;
  let totalEmbeddedBytes = 0;
  for (const locator of locators) {
    throwIfAborted(options.signal);
    const lease = await acquire(locator, {
      consumer: "studio-portable-svg-export",
      signal: options.signal,
    });
    try {
      if (lease.kind !== "linked-3d-cas" || !lease.blob) {
        throw new StudioLinked3dPortableRasterProjectionError(
          "연결형 3D raster의 검증 lease를 만들지 못했습니다.",
        );
      }
      totalSourceBytes += lease.blob.size;
      if (
        !Number.isSafeInteger(totalSourceBytes)
        || totalSourceBytes > STUDIO_LINKED_3D_PORTABLE_RASTER_MAX_SOURCE_BYTES
      ) {
        throw new StudioLinked3dPortableRasterProjectionError(
          "portable SVG raster 원본이 64MiB aggregate admission을 넘습니다.",
        );
      }
      const dataUrl = await encode(lease.blob, options.signal);
      throwIfAborted(options.signal);
      totalEmbeddedBytes += dataUrl.length;
      if (
        !Number.isSafeInteger(totalEmbeddedBytes)
        || totalEmbeddedBytes > STUDIO_LINKED_3D_PORTABLE_RASTER_MAX_EMBEDDED_BYTES
      ) {
        throw new StudioLinked3dPortableRasterProjectionError(
          "portable SVG embedded raster가 96MiB admission을 넘습니다.",
        );
      }
      projected.set(locator, dataUrl);
    } finally {
      lease.release();
    }
  }

  return elements.map((element) => {
    const src = typeof element.src === "string" ? projected.get(element.src) : undefined;
    return src === undefined ? element : { ...element, src };
  });
}
