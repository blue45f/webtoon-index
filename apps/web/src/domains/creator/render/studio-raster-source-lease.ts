/**
 * A bounded presentation lease for Studio raster sources.
 *
 * Ordinary browser-readable sources pass through unchanged. The reserved linked-3D CAS namespace
 * is fail-closed: a source in that namespace is exposed only as a verified, ref-counted object URL.
 */

import {
  inspectStudioLinked3dPassPng,
  parseStudioLinked3dPassLocator,
  STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES,
  type StudioLinked3dPassCasAuthority,
} from "../studio-linked-3d-pass-transaction";
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_RASTER_SOURCE_DEFAULT_MAX_SOURCE_BYTES =
  STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES;
export const STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS = 64 * 1024 * 1024;
/**
 * Browser-realm aggregate for linked raster presentation. This is a resident-memory budget, not a
 * WebAssembly address-space claim: the 16 GiB Memory64 protocol ceiling must never be treated as
 * available RAM. The cap matches the existing per-work compressed-asset ceiling while also
 * charging each live presentation for its decoded RGBA surface.
 */
export const STUDIO_RASTER_SOURCE_DEFAULT_MAX_RESIDENT_BYTES = 256 * 1024 * 1024;
export const STUDIO_RASTER_SOURCE_MAX_CONCURRENT_LOADS = 2;
const STUDIO_RASTER_SOURCE_MAX_PENDING_LOADS = 512;

const RESERVED_SOURCE_PATTERN = /^studio-opfs-cas:/iu;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PNG_MIME = "image/png" as const;

export interface StudioRasterSourceReceipt {
  readonly contentHash: `sha256:${string}`;
  readonly byteSize: number;
  readonly mime: typeof PNG_MIME;
  readonly width: number;
  readonly height: number;
}

export interface StudioRasterSourceAuthorityStat {
  readonly hash?: string;
  readonly bytes: number;
  readonly mime: string;
}

/** Local forward-compatible extension; the current linked-pass authority does not require stat. */
export type StudioRasterSourceAuthority = StudioLinked3dPassCasAuthority & {
  readonly stat?: (
    hash: string,
  ) => Promise<StudioRasterSourceAuthorityStat | null>;
};

export interface StudioRasterSourceBudgetRequest {
  readonly consumer: string;
  readonly contentHash: `sha256:${string}`;
  readonly sourceBytes: number;
  readonly decodedPixels: number;
  readonly decodedRgbaBytes: number;
}

export interface StudioRasterSourceBudgetReservation {
  release(): void;
}

/**
 * Optional route/controller budget that can tighten the mandatory browser-realm aggregate pool.
 * Returning null denies admission; a granted reservation belongs to exactly one consumer lease.
 */
export interface StudioRasterSourceBudget {
  reserve(
    request: StudioRasterSourceBudgetRequest,
  ): StudioRasterSourceBudgetReservation | null | Promise<StudioRasterSourceBudgetReservation | null>;
}

export interface StudioRasterSourceResidentBudgetSnapshot {
  readonly activeReservationCount: number;
  readonly maxResidentBytes: number;
  readonly reservedBytes: number;
}

export interface StudioRasterSourceResidentBudget extends StudioRasterSourceBudget {
  reserve(
    request: StudioRasterSourceBudgetRequest,
  ): StudioRasterSourceBudgetReservation | null;
  snapshot(): StudioRasterSourceResidentBudgetSnapshot;
}

export interface StudioRasterSourceLeaseOptions {
  readonly authority?: StudioRasterSourceAuthority;
  readonly expectedReceipt?: StudioRasterSourceReceipt;
  readonly budget?: StudioRasterSourceBudget;
  readonly consumer?: string;
  readonly signal?: AbortSignal;
  /** Tightens, but cannot raise, the independent hard cap. */
  readonly maxSourceBytes?: number;
  /** Tightens, but cannot raise, the independent hard cap. */
  readonly maxPixels?: number;
}

export interface StudioRasterSourceLease {
  readonly kind: "passthrough" | "linked-3d-cas";
  readonly src: string;
  readonly blob: Blob | null;
  readonly receipt: StudioRasterSourceReceipt | null;
  /** Idempotent. A linked-3D object URL remains valid until the final sharing lease releases it. */
  release(): void;
}

export class StudioRasterSourceLeaseError extends Error {
  public constructor(
    public readonly code:
      | "invalid-source"
      | "malformed-reserved-source"
      | "aborted"
      | "opfs-unavailable"
      | "source-missing"
      | "integrity-mismatch"
      | "invalid-png"
      | "receipt-mismatch"
      | "source-limit"
      | "budget-denied",
    message: string,
  ) {
    super(message);
    this.name = code === "aborted" ? "AbortError" : "StudioRasterSourceLeaseError";
  }
}

interface StudioRasterResource {
  src: string | null;
  readonly blob: Blob;
  readonly receipt: StudioRasterSourceReceipt;
  readonly decodedPixels: number;
  readonly decodedRgbaBytes: number;
}

interface StudioRasterResourceEntry {
  readonly authority: StudioRasterSourceAuthority;
  readonly contentHash: `sha256:${string}`;
  readonly promise: Promise<StudioRasterResource>;
  resource: StudioRasterResource | null;
  waiters: number;
  references: number;
  abandoned: boolean;
  disposed: boolean;
  releaseLoadPermit: (() => void) | null;
}

const entriesByAuthority = new WeakMap<
  StudioRasterSourceAuthority,
  Map<`sha256:${string}`, StudioRasterResourceEntry>
>();

let activeRasterSourceLoads = 0;
const pendingRasterSourceLoadPermits: Array<{
  readonly resolve: (release: () => void) => void;
}> = [];

function grantRasterSourceLoadPermits(): void {
  while (
    activeRasterSourceLoads < STUDIO_RASTER_SOURCE_MAX_CONCURRENT_LOADS
    && pendingRasterSourceLoadPermits.length > 0
  ) {
    const waiter = pendingRasterSourceLoadPermits.shift();
    if (!waiter) return;
    activeRasterSourceLoads += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      activeRasterSourceLoads = Math.max(0, activeRasterSourceLoads - 1);
      grantRasterSourceLoadPermits();
    });
  }
}

function acquireRasterSourceLoadPermit(): Promise<() => void> {
  if (pendingRasterSourceLoadPermits.length >= STUDIO_RASTER_SOURCE_MAX_PENDING_LOADS) {
    return Promise.reject(leaseError(
      "budget-denied",
      "Raster source 검증 대기열이 안전 한도를 넘었습니다.",
    ));
  }
  return new Promise<() => void>((resolve) => {
    pendingRasterSourceLoadPermits.push({ resolve });
    grantRasterSourceLoadPermits();
  });
}

function residentBytesFor(request: StudioRasterSourceBudgetRequest): number | null {
  const residentBytes = request.sourceBytes + request.decodedRgbaBytes;
  return Number.isSafeInteger(residentBytes) && residentBytes > 0 ? residentBytes : null;
}

/**
 * Creates one aggregate pool for a route/controller lifetime. Reservations are synchronous and
 * atomic within a browser realm; callers cannot raise the trusted cap with per-request metadata.
 */
export function createStudioRasterSourceResidentBudget(
  maxResidentBytes = STUDIO_RASTER_SOURCE_DEFAULT_MAX_RESIDENT_BYTES,
): StudioRasterSourceResidentBudget {
  if (!positiveSafeInteger(maxResidentBytes)) {
    throw leaseError("invalid-source", "Raster source resident budget 한도가 유효하지 않습니다.");
  }
  let reservedBytes = 0;
  let activeReservationCount = 0;
  return Object.freeze({
    reserve(request: StudioRasterSourceBudgetRequest): StudioRasterSourceBudgetReservation | null {
      const requestedBytes = residentBytesFor(request);
      if (
        requestedBytes === null
        || requestedBytes > maxResidentBytes
        || reservedBytes > maxResidentBytes - requestedBytes
      ) {
        return null;
      }
      reservedBytes += requestedBytes;
      activeReservationCount += 1;
      let released = false;
      return Object.freeze({
        release(): void {
          if (released) return;
          released = true;
          reservedBytes = Math.max(0, reservedBytes - requestedBytes);
          activeReservationCount = Math.max(0, activeReservationCount - 1);
        },
      });
    },
    snapshot(): StudioRasterSourceResidentBudgetSnapshot {
      return Object.freeze({ activeReservationCount, maxResidentBytes, reservedBytes });
    },
  });
}

/** All production consumers in this browser realm share one trusted aggregate resident pool. */
export const studioRasterSourceResidentBudget = createStudioRasterSourceResidentBudget();

function leaseError(
  code: StudioRasterSourceLeaseError["code"],
  message: string,
): StudioRasterSourceLeaseError {
  return new StudioRasterSourceLeaseError(code, message);
}

function abortError(): StudioRasterSourceLeaseError {
  return leaseError("aborted", "Raster source lease 요청이 취소되었습니다.");
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizeLimit(
  value: number | undefined,
  hardCap: number,
  label: string,
): number {
  if (value === undefined) return hardCap;
  if (!positiveSafeInteger(value)) {
    throw leaseError("invalid-source", `${label} 한도는 양의 안전 정수여야 합니다.`);
  }
  return Math.min(value, hardCap);
}

function assertExpectedReceipt(
  expected: StudioRasterSourceReceipt,
  contentHash: `sha256:${string}`,
  maxSourceBytes: number,
  maxPixels: number,
): void {
  if (
    !SHA256_PATTERN.test(expected.contentHash)
    || expected.contentHash !== contentHash
    || !positiveSafeInteger(expected.byteSize)
    || expected.mime !== PNG_MIME
    || !positiveSafeInteger(expected.width)
    || !positiveSafeInteger(expected.height)
  ) {
    throw leaseError("receipt-mismatch", "Raster source 기대 영수증이 locator와 일치하지 않습니다.");
  }
  const pixels = expected.width * expected.height;
  if (!Number.isSafeInteger(pixels)) {
    throw leaseError("source-limit", "Raster source 픽셀 수가 안전 범위를 벗어났습니다.");
  }
  if (expected.byteSize > maxSourceBytes || pixels > maxPixels) {
    throw leaseError("source-limit", "Raster source가 이 소비자의 안전 한도를 넘었습니다.");
  }
}

function assertActualReceipt(
  actual: StudioRasterSourceReceipt,
  expected: StudioRasterSourceReceipt | undefined,
  maxSourceBytes: number,
  maxPixels: number,
): void {
  const pixels = actual.width * actual.height;
  if (actual.byteSize > maxSourceBytes || pixels > maxPixels) {
    throw leaseError("source-limit", "Raster source가 이 소비자의 안전 한도를 넘었습니다.");
  }
  if (
    expected
    && (
      actual.contentHash !== expected.contentHash
      || actual.byteSize !== expected.byteSize
      || actual.mime !== expected.mime
      || actual.width !== expected.width
      || actual.height !== expected.height
    )
  ) {
    throw leaseError("receipt-mismatch", "Raster source가 기대 영수증과 일치하지 않습니다.");
  }
}

function mapFor(
  authority: StudioRasterSourceAuthority,
): Map<`sha256:${string}`, StudioRasterResourceEntry> {
  let entries = entriesByAuthority.get(authority);
  if (!entries) {
    entries = new Map();
    entriesByAuthority.set(authority, entries);
  }
  return entries;
}

function removeEntry(entry: StudioRasterResourceEntry): void {
  const entries = entriesByAuthority.get(entry.authority);
  if (entries?.get(entry.contentHash) === entry) entries.delete(entry.contentHash);
  if (entries?.size === 0) entriesByAuthority.delete(entry.authority);
}

function revokeResource(resource: StudioRasterResource): void {
  if (!resource.src) return;
  try {
    URL.revokeObjectURL(resource.src);
  } catch {
    // release() is a best-effort, idempotent teardown boundary.
  }
  resource.src = null;
}

function releaseEntryLoadPermit(entry: StudioRasterResourceEntry): void {
  const release = entry.releaseLoadPermit;
  entry.releaseLoadPermit = null;
  release?.();
}

function disposeEntry(entry: StudioRasterResourceEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  removeEntry(entry);
  if (entry.resource) revokeResource(entry.resource);
  entry.resource = null;
  releaseEntryLoadPermit(entry);
}

function settleUnusedEntry(entry: StudioRasterResourceEntry): void {
  if (entry.waiters > 0 || entry.references > 0) return;
  if (entry.resource) {
    disposeEntry(entry);
    return;
  }
  entry.abandoned = true;
  removeEntry(entry);
}

function asBlobPart(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return Uint8Array.from(bytes).buffer;
}

function assertStat(
  stat: StudioRasterSourceAuthorityStat,
  contentHash: `sha256:${string}`,
): void {
  if (
    (stat.hash !== undefined && stat.hash !== contentHash)
    || !positiveSafeInteger(stat.bytes)
    || stat.bytes > STUDIO_RASTER_SOURCE_DEFAULT_MAX_SOURCE_BYTES
    || stat.mime !== PNG_MIME
  ) {
    throw leaseError("integrity-mismatch", "Raster source CAS metadata가 유효하지 않습니다.");
  }
}

async function loadResource(
  entry: StudioRasterResourceEntry,
): Promise<StudioRasterResource> {
  const { authority, contentHash } = entry;
  const statAuthority = authority.stat;
  const hasStat = typeof statAuthority === "function";
  let stat: StudioRasterSourceAuthorityStat | null;
  try {
    stat = hasStat ? await statAuthority(contentHash) : null;
  } catch {
    throw leaseError("opfs-unavailable", "Raster source CAS metadata를 읽지 못했습니다.");
  }
  if (hasStat && !stat) {
    throw leaseError("source-missing", "Raster source CAS 항목을 찾지 못했습니다.");
  }
  if (stat) assertStat(stat, contentHash);

  let bytes: Uint8Array | null;
  try {
    bytes = await authority.get(contentHash, { verify: true });
  } catch {
    throw leaseError("integrity-mismatch", "Raster source CAS 바이트를 검증하지 못했습니다.");
  }
  if (!bytes) throw leaseError("source-missing", "Raster source CAS 항목을 찾지 못했습니다.");
  if (
    bytes.byteLength < 1
    || bytes.byteLength > STUDIO_RASTER_SOURCE_DEFAULT_MAX_SOURCE_BYTES
  ) {
    throw leaseError("source-limit", "Raster source 바이트 수가 독립 안전 한도를 넘었습니다.");
  }
  if (stat?.bytes !== undefined && stat.bytes !== bytes.byteLength) {
    throw leaseError("integrity-mismatch", "Raster source CAS 크기가 metadata와 다릅니다.");
  }
  const actualHash = `sha256:${sha256HexPortable(bytes)}` as const;
  if (actualHash !== contentHash) {
    throw leaseError("integrity-mismatch", "Raster source CAS 내용 무결성 검증에 실패했습니다.");
  }
  const png = inspectStudioLinked3dPassPng(bytes);
  if (!png) throw leaseError("invalid-png", "Raster source가 유효한 PNG IHDR을 갖지 않습니다.");
  const decodedPixels = png.width * png.height;
  if (
    !Number.isSafeInteger(decodedPixels)
    || decodedPixels > STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS
  ) {
    throw leaseError("source-limit", "Raster source 픽셀 수가 독립 안전 한도를 넘었습니다.");
  }
  if (entry.abandoned) throw abortError();
  const blob = new Blob([asBlobPart(bytes)], { type: PNG_MIME });
  const receipt = Object.freeze({
    contentHash,
    byteSize: bytes.byteLength,
    mime: PNG_MIME,
    width: png.width,
    height: png.height,
  });
  const resource: StudioRasterResource = {
    src: null,
    blob,
    receipt,
    decodedPixels,
    decodedRgbaBytes: png.decodedRgbaBytes,
  };
  if (entry.abandoned) {
    throw abortError();
  }
  return resource;
}

function ensureResourceObjectUrl(resource: StudioRasterResource): string {
  if (resource.src) return resource.src;
  if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    throw leaseError("opfs-unavailable", "이 환경에서는 안전한 raster 표시 URL을 만들 수 없습니다.");
  }
  try {
    resource.src = URL.createObjectURL(resource.blob);
    return resource.src;
  } catch {
    throw leaseError("opfs-unavailable", "안전한 raster 표시 URL을 만들지 못했습니다.");
  }
}

function createEntry(
  authority: StudioRasterSourceAuthority,
  contentHash: `sha256:${string}`,
): StudioRasterResourceEntry {
  const entry = {
    authority,
    contentHash,
    resource: null,
    waiters: 0,
    references: 0,
    abandoned: false,
    disposed: false,
    releaseLoadPermit: null,
  } as StudioRasterResourceEntry;
  const promise = acquireRasterSourceLoadPermit().then(async (releaseLoadPermit) => {
    entry.releaseLoadPermit = releaseLoadPermit;
    if (entry.abandoned || entry.disposed) throw abortError();
    return await loadResource(entry);
  }).then((resource) => {
    if (entry.abandoned || entry.disposed) {
      revokeResource(resource);
      throw abortError();
    }
    entry.resource = resource;
    return resource;
  }).catch((error: unknown) => {
    releaseEntryLoadPermit(entry);
    removeEntry(entry);
    throw error;
  });
  Object.defineProperty(entry, "promise", { value: promise, enumerable: true });
  void promise.catch(() => undefined);
  return entry;
}

function getOrCreateEntry(
  authority: StudioRasterSourceAuthority,
  contentHash: `sha256:${string}`,
): StudioRasterResourceEntry {
  const entries = mapFor(authority);
  const current = entries.get(contentHash);
  if (current && !current.abandoned && !current.disposed) return current;
  const created = createEntry(authority, contentHash);
  entries.set(contentHash, created);
  return created;
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function safeRelease(reservation: StudioRasterSourceBudgetReservation | null): void {
  if (!reservation) return;
  try {
    reservation.release();
  } catch {
    // A release failure must not invalidate an otherwise idempotent source teardown.
  }
}

async function reserveBudget(
  budget: StudioRasterSourceBudget | undefined,
  request: StudioRasterSourceBudgetRequest,
  signal: AbortSignal | undefined,
): Promise<StudioRasterSourceBudgetReservation | null> {
  if (!budget) return null;
  const pending = Promise.resolve().then(() => budget.reserve(request));
  let abortedGrantReleased = false;
  const releaseAbortedGrant = (
    reservation: StudioRasterSourceBudgetReservation | null,
  ): void => {
    if (abortedGrantReleased || !reservation) return;
    abortedGrantReleased = true;
    safeRelease(reservation);
  };
  try {
    const reservation = await waitForSignal(pending, signal);
    if (!reservation || typeof reservation.release !== "function") {
      throw leaseError("budget-denied", "Raster source resident budget이 요청을 거절했습니다.");
    }
    if (signal?.aborted) {
      releaseAbortedGrant(reservation);
      throw abortError();
    }
    return reservation;
  } catch (error) {
    if (signal?.aborted) {
      void pending.then(releaseAbortedGrant, () => undefined);
      throw abortError();
    }
    if (error instanceof StudioRasterSourceLeaseError) throw error;
    throw leaseError("budget-denied", "Raster source resident budget을 예약하지 못했습니다.");
  }
}

async function reserveResidentBudgets(
  scopedBudget: StudioRasterSourceBudget | undefined,
  request: StudioRasterSourceBudgetRequest,
  signal: AbortSignal | undefined,
): Promise<StudioRasterSourceBudgetReservation> {
  const aggregateReservation = await reserveBudget(
    studioRasterSourceResidentBudget,
    request,
    signal,
  );
  if (!aggregateReservation) {
    throw leaseError("budget-denied", "Raster source resident budget을 예약하지 못했습니다.");
  }
  if (!scopedBudget || scopedBudget === studioRasterSourceResidentBudget) {
    return aggregateReservation;
  }
  let scopedReservation: StudioRasterSourceBudgetReservation | null = null;
  try {
    scopedReservation = await reserveBudget(scopedBudget, request, signal);
    if (!scopedReservation) {
      throw leaseError("budget-denied", "Raster source route budget을 예약하지 못했습니다.");
    }
  } catch (error) {
    safeRelease(aggregateReservation);
    throw error;
  }
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      safeRelease(scopedReservation);
      safeRelease(aggregateReservation);
    },
  });
}

function passthroughLease(src: string): StudioRasterSourceLease {
  let released = false;
  return Object.freeze({
    kind: "passthrough" as const,
    src,
    blob: null,
    receipt: null,
    release: () => {
      if (released) return;
      released = true;
    },
  });
}

function linkedLease(
  entry: StudioRasterResourceEntry,
  resource: StudioRasterResource,
  reservation: StudioRasterSourceBudgetReservation | null,
): StudioRasterSourceLease {
  const src = ensureResourceObjectUrl(resource);
  entry.references += 1;
  releaseEntryLoadPermit(entry);
  let released = false;
  return Object.freeze({
    kind: "linked-3d-cas" as const,
    src,
    blob: resource.blob,
    receipt: resource.receipt,
    release: () => {
      if (released) return;
      released = true;
      safeRelease(reservation);
      entry.references = Math.max(0, entry.references - 1);
      settleUnusedEntry(entry);
    },
  });
}

function normalizeLoadError(error: unknown): StudioRasterSourceLeaseError {
  if (error instanceof StudioRasterSourceLeaseError) return error;
  return leaseError("integrity-mismatch", "Raster source를 안전하게 확인하지 못했습니다.");
}

/**
 * Acquires a browser-readable source without ever exposing a reserved OPFS locator to presentation.
 */
export async function acquireStudioRasterSourceLease(
  source: string,
  options: StudioRasterSourceLeaseOptions = {},
): Promise<StudioRasterSourceLease> {
  if (typeof source !== "string" || source.length === 0) {
    throw leaseError("invalid-source", "Raster source가 비어 있습니다.");
  }
  if (options.signal?.aborted) throw abortError();
  const contentHash = parseStudioLinked3dPassLocator(source);
  if (!contentHash) {
    if (RESERVED_SOURCE_PATTERN.test(source.trimStart())) {
      throw leaseError("malformed-reserved-source", "예약된 raster source locator가 잘못되었습니다.");
    }
    return passthroughLease(source);
  }

  const maxSourceBytes = normalizeLimit(
    options.maxSourceBytes,
    STUDIO_RASTER_SOURCE_DEFAULT_MAX_SOURCE_BYTES,
    "Raster source byte",
  );
  const maxPixels = normalizeLimit(
    options.maxPixels,
    STUDIO_RASTER_SOURCE_DEFAULT_MAX_PIXELS,
    "Raster source pixel",
  );
  if (options.expectedReceipt) {
    assertExpectedReceipt(options.expectedReceipt, contentHash, maxSourceBytes, maxPixels);
  }

  let authority: StudioRasterSourceAuthority;
  try {
    authority = options.authority
      ?? await waitForSignal(
        import("../studio-linked-3d-pass-product-authority").then(
          ({ acquireStudioLinked3dPassProductAuthority }) =>
            acquireStudioLinked3dPassProductAuthority(),
        ),
        options.signal,
      );
  } catch (error) {
    if (error instanceof StudioRasterSourceLeaseError) throw error;
    throw leaseError("opfs-unavailable", "Raster source OPFS authority를 열지 못했습니다.");
  }
  if (authority.kind !== "opfs") {
    throw leaseError("opfs-unavailable", "예약된 raster source에는 durable OPFS authority가 필요합니다.");
  }

  const entry = getOrCreateEntry(authority, contentHash);
  entry.waiters += 1;
  let reservation: StudioRasterSourceBudgetReservation | null = null;
  try {
    const resource = await waitForSignal(entry.promise, options.signal);
    assertActualReceipt(resource.receipt, options.expectedReceipt, maxSourceBytes, maxPixels);
    reservation = await reserveResidentBudgets(options.budget, {
      consumer: options.consumer?.trim() || "studio-raster-source",
      contentHash,
      sourceBytes: resource.receipt.byteSize,
      decodedPixels: resource.decodedPixels,
      decodedRgbaBytes: resource.decodedRgbaBytes,
    }, options.signal);
    if (options.signal?.aborted) throw abortError();
    const lease = linkedLease(entry, resource, reservation);
    reservation = null;
    return lease;
  } catch (error) {
    safeRelease(reservation);
    throw normalizeLoadError(error);
  } finally {
    entry.waiters = Math.max(0, entry.waiters - 1);
    settleUnusedEntry(entry);
  }
}
