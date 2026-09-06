import { STUDIO_PROJECT_MAX_PAGES } from "./studio-project-file";

const MiB = 1024 * 1024;

export interface StudioDocumentImportDeviceProfile {
  readonly maxEmbeddedBytes: number;
  readonly remainingPageCapacity: number;
  readonly openRasterLimits: Readonly<{
    maxArchiveBytes: number;
    maxLayerBytes: number;
    maxMergedImageBytes: number;
    maxThumbnailBytes: number;
    maxTotalImageBytes: number;
    maxTotalDecodedRgbaBytes: number;
  }>;
  readonly cbzLimits: Readonly<{
    maxArchiveBytes: number;
    maxArchiveEntries: number;
    maxPages: number;
    maxPageBytes: number;
    maxTotalPageBytes: number;
    maxPageDimension: number;
    maxPagePixels: number;
    maxTotalDecodedPixels: number;
    maxTotalDecodedBytes: number;
  }>;
}

/**
 * Narrows codec budgets before a local archive is materialized. The later apply preflight still
 * checks the same durable byte/page limits; this earlier profile protects mobile memory first.
 */
export function studioDocumentImportDeviceProfile(
  mobile: boolean,
  currentPageCount: number,
): StudioDocumentImportDeviceProfile {
  if (
    !Number.isSafeInteger(currentPageCount) ||
    currentPageCount < 0 ||
    currentPageCount > STUDIO_PROJECT_MAX_PAGES
  ) {
    throw new Error("현재 Studio 페이지 수를 확인할 수 없습니다.");
  }
  const maxEmbeddedBytes = (mobile ? 64 : 128) * MiB;
  // Data URLs expand binary payloads by roughly 4/3 and add a small header per image. Keep the
  // codec's materialized image budget below the durable JSON payload limit before extraction.
  const maxMaterializedImageBytes = Math.max(
    1,
    Math.floor(maxEmbeddedBytes * 3 / 4) - 64 * 1024,
  );
  const remainingPageCapacity = STUDIO_PROJECT_MAX_PAGES - currentPageCount;
  return Object.freeze({
    maxEmbeddedBytes,
    remainingPageCapacity,
    openRasterLimits: Object.freeze({
      maxArchiveBytes: maxEmbeddedBytes,
      maxLayerBytes: Math.min(maxMaterializedImageBytes, 128_000_000),
      maxMergedImageBytes: maxMaterializedImageBytes,
      maxThumbnailBytes: Math.min(maxMaterializedImageBytes, 16_000_000),
      maxTotalImageBytes: maxMaterializedImageBytes,
      maxTotalDecodedRgbaBytes: (mobile ? 96 : 128) * MiB,
    }),
    cbzLimits: Object.freeze({
      maxArchiveBytes: maxEmbeddedBytes,
      maxArchiveEntries: Math.min(1_163, Math.max(1, remainingPageCapacity) + 64),
      // The codec requires a positive configured limit. `remainingPageCapacity` is checked before
      // invoking it, so one here is an unreachable fail-closed placeholder at a full document.
      maxPages: Math.max(1, remainingPageCapacity),
      maxPageBytes: Math.min(maxMaterializedImageBytes, 192_000_000),
      maxTotalPageBytes: maxMaterializedImageBytes,
      maxPageDimension: mobile ? 32_768 : 65_536,
      maxPagePixels: (mobile ? 16 : 32) * 1024 * 1024,
      maxTotalDecodedPixels: (mobile ? 64 : 128) * 1024 * 1024,
      maxTotalDecodedBytes: (mobile ? 256 : 512) * MiB,
    }),
  });
}
