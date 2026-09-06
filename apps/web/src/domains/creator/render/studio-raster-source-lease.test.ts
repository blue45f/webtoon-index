import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  acquireStudioRasterSourceLease,
  createStudioRasterSourceResidentBudget,
  STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS,
  type StudioRasterSourceAuthority,
  type StudioRasterSourceAuthorityStat,
  type StudioRasterSourceBudget,
  type StudioRasterSourceBudgetReservation,
  type StudioRasterSourceReceipt,
} from "./studio-raster-source-lease";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zcy8AAAAASUVORK5CYII=";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pngBytes(width = 1, height = 1): Uint8Array {
  const bytes = decodeBase64(ONE_PIXEL_PNG_BASE64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function hashOf(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function locatorFor(hash: `sha256:${string}`): string {
  return `studio-opfs-cas:${hash}`;
}

function receiptFor(bytes: Uint8Array, width = 1, height = 1): StudioRasterSourceReceipt {
  return Object.freeze({
    contentHash: hashOf(bytes),
    byteSize: bytes.byteLength,
    mime: "image/png",
    width,
    height,
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function createAuthority(options: {
  readonly get?: (
    hash: string,
    getOptions?: { readonly verify?: boolean },
  ) => Promise<Uint8Array | null>;
  readonly stat?: (hash: string) => Promise<StudioRasterSourceAuthorityStat | null>;
  readonly kind?: StudioRasterSourceAuthority["kind"];
} = {}): StudioRasterSourceAuthority & {
  readonly get: ReturnType<typeof vi.fn<NonNullable<typeof options.get>>>;
} {
  const getImplementation = options.get ?? (async () => null);
  const get = vi.fn(getImplementation);
  return {
    kind: options.kind ?? "opfs",
    async put(bytes, putOptions) {
      const hash = hashOf(bytes);
      const mime = putOptions?.mime ?? "application/octet-stream";
      return {
        ref: { hash, bytes: bytes.byteLength, mime },
        entry: {
          hash,
          path: "unused",
          bytes: bytes.byteLength,
          storedBytes: bytes.byteLength,
          codec: "identity",
          mime,
          createdAt: 0,
          lastAccessAt: 0,
        },
        deduped: false,
      };
    },
    get,
    async ownerRefs() {
      return [];
    },
    async setOwnerRefs(_owner, hashes) {
      return [...hashes] as `sha256:${string}`[];
    },
    ...(options.stat ? { stat: vi.fn(options.stat) } : {}),
  };
}

function installObjectUrlSpies(): {
  readonly create: ReturnType<typeof vi.spyOn>;
  readonly revoke: ReturnType<typeof vi.spyOn>;
} {
  let sequence = 0;
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    sequence += 1;
    return `blob:studio-raster-${sequence}`;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  return { create, revoke };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Studio raster source lease", () => {
  it("aggregates every live lease in one trusted resident pool and returns bytes atomically", () => {
    const budget = createStudioRasterSourceResidentBudget(128);
    const request = {
      consumer: "canvas",
      contentHash: `sha256:${"a".repeat(64)}` as const,
      sourceBytes: 16,
      decodedPixels: 20,
      decodedRgbaBytes: 80,
    };

    const first = budget.reserve(request);
    expect(first).not.toBeNull();
    expect(budget.snapshot()).toEqual({
      activeReservationCount: 1,
      maxResidentBytes: 128,
      reservedBytes: 96,
    });
    expect(budget.reserve({ ...request, consumer: "thumbnail" })).toBeNull();

    first?.release();
    first?.release();
    expect(budget.snapshot()).toEqual({
      activeReservationCount: 0,
      maxResidentBytes: 128,
      reservedBytes: 0,
    });
    const second = budget.reserve({ ...request, consumer: "thumbnail" });
    expect(second).not.toBeNull();
    second?.release();
  });

  it("passes ordinary sources through and fails closed for malformed reserved locators", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const ordinary = "data:image/png;base64,legacy";
    const lease = await acquireStudioRasterSourceLease(ordinary);

    expect(lease).toMatchObject({
      kind: "passthrough",
      src: ordinary,
      blob: null,
      receipt: null,
    });
    lease.release();
    lease.release();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();

    const malformed = "studio-opfs-cas:sha256:not-a-real-hash";
    const rejection = acquireStudioRasterSourceLease(malformed).catch((error: unknown) => error);
    await expect(rejection).resolves.toMatchObject({ code: "malformed-reserved-source" });
    const error = await rejection;
    expect(String(error)).not.toContain(malformed);
    expect(String(error)).not.toContain("not-a-real-hash");
  });

  it("verifies get, actual hash, PNG IHDR, optional stat, and the exact expected receipt", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes(3, 2);
    const expectedReceipt = receiptFor(bytes, 3, 2);
    const stat = vi.fn(async () => ({
      hash: expectedReceipt.contentHash,
      bytes: expectedReceipt.byteSize,
      mime: expectedReceipt.mime,
    }));
    const authority = createAuthority({
      get: async () => Uint8Array.from(bytes),
      stat,
    });

    const lease = await acquireStudioRasterSourceLease(locatorFor(expectedReceipt.contentHash), {
      authority,
      expectedReceipt,
      maxSourceBytes: expectedReceipt.byteSize,
      maxPixels: 6,
    });

    expect(stat).toHaveBeenCalledWith(expectedReceipt.contentHash);
    expect(authority.get).toHaveBeenCalledOnce();
    expect(authority.get).toHaveBeenCalledWith(expectedReceipt.contentHash, { verify: true });
    expect(lease.kind).toBe("linked-3d-cas");
    expect(lease.src).toBe("blob:studio-raster-1");
    expect(lease.receipt).toEqual(expectedReceipt);
    expect(lease.blob).toMatchObject({ size: bytes.byteLength, type: "image/png" });
    expect(create).toHaveBeenCalledOnce();

    lease.release();
    lease.release();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:studio-raster-1");
  });

  it("rejects every expected receipt field exactly and does not expose locator details", async () => {
    installObjectUrlSpies();
    const bytes = pngBytes(4, 5);
    const actual = receiptFor(bytes, 4, 5);
    const source = locatorFor(actual.contentHash);
    const mismatches: StudioRasterSourceReceipt[] = [
      { ...actual, contentHash: `sha256:${"0".repeat(64)}` },
      { ...actual, byteSize: actual.byteSize + 1 },
      { ...actual, mime: "image/jpeg" } as unknown as StudioRasterSourceReceipt,
      { ...actual, width: actual.width + 1 },
      { ...actual, height: actual.height + 1 },
    ];

    for (const expectedReceipt of mismatches) {
      const authority = createAuthority({ get: async () => Uint8Array.from(bytes) });
      const rejection = acquireStudioRasterSourceLease(source, {
        authority,
        expectedReceipt,
      }).catch((error: unknown) => error);
      await expect(rejection).resolves.toMatchObject({ code: "receipt-mismatch" });
      const error = await rejection;
      expect(String(error)).not.toContain(source);
      expect(String(error)).not.toContain(actual.contentHash);
    }
  });

  it("enforces caller byte/pixel caps and the independent decoded-pixel hard cap", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const small = pngBytes(2, 2);
    const smallHash = hashOf(small);
    const smallAuthority = createAuthority({ get: async () => Uint8Array.from(small) });

    await expect(acquireStudioRasterSourceLease(locatorFor(smallHash), {
      authority: smallAuthority,
      maxSourceBytes: small.byteLength - 1,
    })).rejects.toMatchObject({ code: "source-limit" });
    await expect(acquireStudioRasterSourceLease(locatorFor(smallHash), {
      authority: smallAuthority,
      maxPixels: 3,
    })).rejects.toMatchObject({ code: "source-limit" });

    const oversized = pngBytes(STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS + 1, 1);
    const oversizedAuthority = createAuthority({
      get: async () => Uint8Array.from(oversized),
    });
    await expect(acquireStudioRasterSourceLease(locatorFor(hashOf(oversized)), {
      authority: oversizedAuthority,
    })).rejects.toMatchObject({ code: "source-limit" });
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("mandatorily charges the shared resident pool even when a consumer omits a budget", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes(STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS, 1);
    const authority = createAuthority({ get: async () => Uint8Array.from(bytes) });

    await expect(acquireStudioRasterSourceLease(locatorFor(hashOf(bytes)), {
      authority,
      consumer: "unbudgeted-production-consumer",
    })).rejects.toMatchObject({ code: "budget-denied" });
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("deduplicates pending reads per authority/hash and ref-counts one object URL", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    const pending = deferred<Uint8Array | null>();
    const authority = createAuthority({ get: async () => await pending.promise });

    const firstPromise = acquireStudioRasterSourceLease(locatorFor(hash), { authority });
    const secondPromise = acquireStudioRasterSourceLease(locatorFor(hash), { authority });
    await vi.waitFor(() => expect(authority.get).toHaveBeenCalledOnce());
    pending.resolve(Uint8Array.from(bytes));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.src).toBe(second.src);
    expect(create).toHaveBeenCalledOnce();
    first.release();
    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();
    expect(revoke).toHaveBeenCalledOnce();

    const third = await acquireStudioRasterSourceLease(locatorFor(hash), { authority });
    expect(authority.get).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(third.src).not.toBe(first.src);
    third.release();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("does not deduplicate equal hashes across distinct authorities", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    const firstAuthority = createAuthority({ get: async () => Uint8Array.from(bytes) });
    const secondAuthority = createAuthority({ get: async () => Uint8Array.from(bytes) });

    const [first, second] = await Promise.all([
      acquireStudioRasterSourceLease(locatorFor(hash), { authority: firstAuthority }),
      acquireStudioRasterSourceLease(locatorFor(hash), { authority: secondAuthority }),
    ]);

    expect(firstAuthority.get).toHaveBeenCalledOnce();
    expect(secondAuthority.get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
    expect(first.src).not.toBe(second.src);
    first.release();
    second.release();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("admits at most two distinct CAS verification loads before a lease is budgeted", async () => {
    installObjectUrlSpies();
    const firstBytes = pngBytes(2, 1);
    const secondBytes = pngBytes(3, 1);
    const thirdBytes = pngBytes(4, 1);
    const firstRead = deferred<Uint8Array | null>();
    const secondRead = deferred<Uint8Array | null>();
    const thirdRead = deferred<Uint8Array | null>();
    const firstAuthority = createAuthority({ get: async () => await firstRead.promise });
    const secondAuthority = createAuthority({ get: async () => await secondRead.promise });
    const thirdAuthority = createAuthority({ get: async () => await thirdRead.promise });

    const firstPending = acquireStudioRasterSourceLease(locatorFor(hashOf(firstBytes)), {
      authority: firstAuthority,
    });
    const secondPending = acquireStudioRasterSourceLease(locatorFor(hashOf(secondBytes)), {
      authority: secondAuthority,
    });
    const thirdPending = acquireStudioRasterSourceLease(locatorFor(hashOf(thirdBytes)), {
      authority: thirdAuthority,
    });
    await vi.waitFor(() => {
      expect(firstAuthority.get).toHaveBeenCalledOnce();
      expect(secondAuthority.get).toHaveBeenCalledOnce();
    });
    expect(thirdAuthority.get).not.toHaveBeenCalled();

    firstRead.resolve(Uint8Array.from(firstBytes));
    const first = await firstPending;
    await vi.waitFor(() => expect(thirdAuthority.get).toHaveBeenCalledOnce());
    secondRead.resolve(Uint8Array.from(secondBytes));
    thirdRead.resolve(Uint8Array.from(thirdBytes));
    const [second, third] = await Promise.all([secondPending, thirdPending]);
    first.release();
    second.release();
    third.release();
  });

  it("isolates waiter abort so one cancellation cannot poison another waiter", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    const pending = deferred<Uint8Array | null>();
    const authority = createAuthority({ get: async () => await pending.promise });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();

    const first = acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      signal: firstAbort.signal,
    });
    const second = acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      signal: secondAbort.signal,
    });
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    pending.resolve(Uint8Array.from(bytes));
    const lease = await second;

    expect(authority.get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(lease.receipt?.contentHash).toBe(hash);
    lease.release();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("discards an all-aborted late read and admits a clean retry", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    const late = deferred<Uint8Array | null>();
    let reads = 0;
    const authority = createAuthority({
      get: async () => {
        reads += 1;
        return reads === 1 ? await late.promise : Uint8Array.from(bytes);
      },
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      signal: firstAbort.signal,
    });
    const second = acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      signal: secondAbort.signal,
    });

    await vi.waitFor(() => expect(authority.get).toHaveBeenCalledOnce());

    firstAbort.abort();
    secondAbort.abort();
    await expect(first).rejects.toMatchObject({ code: "aborted" });
    await expect(second).rejects.toMatchObject({ code: "aborted" });
    late.resolve(Uint8Array.from(bytes));
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();

    const retry = await acquireStudioRasterSourceLease(locatorFor(hash), { authority });
    expect(authority.get).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledOnce();
    retry.release();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("evicts missing, corrupt, and invalid-PNG failures so the same key is retryable", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    let reads = 0;
    const authority = createAuthority({
      get: async () => {
        reads += 1;
        if (reads === 1) return null;
        if (reads === 2) return pngBytes(2, 1);
        return Uint8Array.from(bytes);
      },
    });
    const source = locatorFor(hash);

    await expect(acquireStudioRasterSourceLease(source, { authority })).rejects.toMatchObject({
      code: "source-missing",
    });
    const corrupt = acquireStudioRasterSourceLease(source, { authority }).catch(
      (error: unknown) => error,
    );
    await expect(corrupt).resolves.toMatchObject({ code: "integrity-mismatch" });
    expect(String(await corrupt)).not.toContain(source);
    const lease = await acquireStudioRasterSourceLease(source, { authority });

    expect(authority.get).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledOnce();
    lease.release();
    expect(revoke).toHaveBeenCalledOnce();

    const invalid = new Uint8Array(33);
    const invalidAuthority = createAuthority({ get: async () => invalid });
    await expect(acquireStudioRasterSourceLease(locatorFor(hashOf(invalid)), {
      authority: invalidAuthority,
    })).rejects.toMatchObject({ code: "invalid-png" });
  });

  it("reserves injectable budget metadata and releases each grant exactly once", async () => {
    const { revoke } = installObjectUrlSpies();
    const bytes = pngBytes(7, 3);
    const hash = hashOf(bytes);
    const authority = createAuthority({ get: async () => Uint8Array.from(bytes) });
    const release = vi.fn();
    const reserve = vi.fn(async (): Promise<StudioRasterSourceBudgetReservation> => ({ release }));
    const budget: StudioRasterSourceBudget = { reserve };

    const lease = await acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      budget,
      consumer: "thumbnail",
    });
    expect(reserve).toHaveBeenCalledWith({
      consumer: "thumbnail",
      contentHash: hash,
      sourceBytes: bytes.byteLength,
      decodedPixels: 21,
      decodedRgbaBytes: 84,
    });
    lease.release();
    lease.release();
    expect(release).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("fails closed on budget denial and releases a grant that arrives after abort", async () => {
    const { create, revoke } = installObjectUrlSpies();
    const bytes = pngBytes();
    const hash = hashOf(bytes);
    const authority = createAuthority({ get: async () => Uint8Array.from(bytes) });
    const denied: StudioRasterSourceBudget = { reserve: () => null };

    await expect(acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      budget: denied,
    })).rejects.toMatchObject({ code: "budget-denied" });
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();

    const late = deferred<StudioRasterSourceBudgetReservation | null>();
    const lateRelease = vi.fn();
    const reserveLate = vi.fn(async () => await late.promise);
    const abort = new AbortController();
    const pending = acquireStudioRasterSourceLease(locatorFor(hash), {
      authority,
      budget: { reserve: reserveLate },
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(reserveLate).toHaveBeenCalledOnce());
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    late.resolve({ release: lateRelease });
    await flushPromises();

    expect(lateRelease).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
