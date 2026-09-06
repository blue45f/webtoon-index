import type {
  StudioRasterSourceLease,
  StudioRasterSourceLeaseOptions,
} from "./studio-raster-source-lease";

export const STUDIO_RASTER_SOURCE_PROJECTION_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const STUDIO_RASTER_SOURCE_PROJECTION_MAX_PIXELS = 64 * 1024 * 1024;

export interface StudioRasterSourceProjectionValue {
  readonly src: string;
}

export type StudioRasterSourceProjectionAcquire = (
  source: string,
  options: StudioRasterSourceLeaseOptions,
) => Promise<StudioRasterSourceLease>;

async function defaultAcquire(
  source: string,
  options: StudioRasterSourceLeaseOptions,
): Promise<StudioRasterSourceLease> {
  const { acquireStudioRasterSourceLease } = await import("./studio-raster-source-lease");
  return acquireStudioRasterSourceLease(source, options);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Holds verified browser-readable sources only for the lifetime of one raster operation. Linked
 * locators are deduplicated, aggregate-admitted, projected without mutating canonical values, and
 * released after success, failure, or abort.
 */
export async function withStudioRasterSourceProjection<
  Value extends StudioRasterSourceProjectionValue,
  Result,
>(input: {
  readonly acquire?: StudioRasterSourceProjectionAcquire;
  readonly consumer: string;
  readonly signal?: AbortSignal;
  readonly values: readonly Value[];
  readonly run: (projected: readonly Value[]) => Promise<Result>;
}): Promise<Result> {
  throwIfAborted(input.signal);
  const acquire = input.acquire ?? defaultAcquire;
  const leases = new Map<string, StudioRasterSourceLease>();
  let sourceBytes = 0;
  let pixels = 0;
  try {
    const reservedSources = input.values
      .map(({ src }) => src)
      .filter((source) => source.startsWith("studio-opfs-cas:"));
    for (const source of new Set(reservedSources)) {
      throwIfAborted(input.signal);
      const lease = await acquire(source, {
        consumer: input.consumer,
        signal: input.signal,
      });
      leases.set(source, lease);
      if (lease.kind !== "linked-3d-cas") continue;
      const receipt = lease.receipt;
      if (!receipt) throw new Error("검증된 raster source 영수증이 없습니다.");
      sourceBytes += receipt.byteSize;
      pixels += receipt.width * receipt.height;
      if (
        !Number.isSafeInteger(sourceBytes)
        || !Number.isSafeInteger(pixels)
        || sourceBytes > STUDIO_RASTER_SOURCE_PROJECTION_MAX_SOURCE_BYTES
        || pixels > STUDIO_RASTER_SOURCE_PROJECTION_MAX_PIXELS
      ) {
        throw new Error("Raster source projection aggregate budget을 초과했습니다.");
      }
    }
    throwIfAborted(input.signal);
    const projected = input.values.map((value) => {
      const lease = leases.get(value.src);
      return lease && lease.src !== value.src ? { ...value, src: lease.src } : value;
    });
    return await input.run(projected);
  } finally {
    for (const lease of leases.values()) lease.release();
  }
}
