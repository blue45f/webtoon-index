import {
  STUDIO_WASM32_ADDRESS_LIMIT_BYTES,
  STUDIO_WASM_PAGE_BYTES,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

import {
  MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
  snapshotMemory64CrossRealmReservationToken,
  type Memory64CrossRealmAllocationAck,
  type Memory64CrossRealmReservationToken,
  type Memory64CrossRealmRuntime,
} from "./Memory64CrossRealmProtocol";

interface StudioMemory64Descriptor {
  readonly address: "i64";
  readonly initial: bigint;
  readonly maximum: bigint;
}

interface StudioMemory32Descriptor {
  readonly address: "i32";
  readonly initial: number;
  readonly maximum: number;
}

type StudioMemoryConstructor = new (
  descriptor: StudioMemory64Descriptor | StudioMemory32Descriptor,
) => WebAssembly.Memory;

export interface Memory64CrossRealmWorkerAllocationAttempt {
  readonly runtime: Memory64CrossRealmRuntime;
  readonly addressType: "i64" | "i32";
  readonly pages: bigint;
  readonly status: "allocated" | "failed";
  readonly issue: Readonly<{ readonly name: string; readonly message: string }> | null;
}

export interface Memory64CrossRealmWorkerAllocationPort {
  allocate(input: Readonly<{
    readonly runtime: Memory64CrossRealmRuntime;
    readonly addressType: "i64" | "i32";
    readonly pages: bigint;
  }>): StudioWasmLinearMemoryRuntime;
  release?(runtime: StudioWasmLinearMemoryRuntime): void;
}

export interface Memory64CrossRealmWorkerAllocationOptions {
  readonly token: Memory64CrossRealmReservationToken | unknown;
  /** Exact disposable bytes the Worker needs inside the authorized resident window. */
  readonly requiredResidentBytes: number | bigint;
  readonly webAssembly?: typeof WebAssembly | null;
  readonly allocationPort?: Memory64CrossRealmWorkerAllocationPort;
}

export interface Memory64CrossRealmWorkerLease {
  readonly token: Memory64CrossRealmReservationToken;
  readonly runtime: StudioWasmLinearMemoryRuntime;
  readonly acknowledgement: Memory64CrossRealmAllocationAck;
  readonly attempts: readonly Memory64CrossRealmWorkerAllocationAttempt[];
  readonly authority: "scratch-only";
  readonly durablePersistenceAuthority: "opfs-cas-paging";
  release(): boolean;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const WASM32_MAX_PAGES =
  STUDIO_WASM32_ADDRESS_LIMIT_BYTES / STUDIO_WASM_PAGE_BYTES;

function positiveBigInt(value: number | bigint): bigint | null {
  if (typeof value === "bigint") return value > ZERO ? value : null;
  return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
}

function ceilPages(bytes: bigint): bigint {
  return (bytes + STUDIO_WASM_PAGE_BYTES - ONE) / STUDIO_WASM_PAGE_BYTES;
}

function issue(error: unknown): Readonly<{ name: string; message: string }> {
  if (error instanceof Error) {
    return Object.freeze({
      name: error.name.slice(0, 80),
      message: error.message.slice(0, 256),
    });
  }
  return Object.freeze({ name: "Error", message: "Worker allocation failed" });
}

function defaultAllocationPort(
  override: typeof WebAssembly | null | undefined,
): Memory64CrossRealmWorkerAllocationPort {
  return Object.freeze({
    allocate(input: Readonly<{
      readonly runtime: Memory64CrossRealmRuntime;
      readonly addressType: "i64" | "i32";
      readonly pages: bigint;
    }>) {
      const webAssembly = override === undefined
        ? globalThis.WebAssembly
        : override;
      if (!webAssembly) throw new Error("WebAssembly is unavailable in the Worker realm");
      const MemoryConstructor =
        webAssembly.Memory as unknown as StudioMemoryConstructor;
      const memory = input.addressType === "i64"
        ? new MemoryConstructor({
            address: "i64",
            initial: input.pages,
            maximum: input.pages,
          })
        : new MemoryConstructor({
            address: "i32",
            initial: Number(input.pages),
            maximum: Number(input.pages),
          });
      return new StudioWasmLinearMemoryRuntime({
        memory,
        addressType: input.addressType,
        selection: input.runtime,
        maximumPages: input.pages,
      });
    },
  });
}

function* shrinkingWindows(
  authorizedPages: bigint,
  minimumPages: bigint,
): Generator<bigint, void, undefined> {
  let pages = authorizedPages;
  while (true) {
    yield pages;
    if (pages === minimumPages) return;
    const halved = pages / BigInt(2);
    pages = halved < minimumPages ? minimumPages : halved;
  }
}

function runtimeAddress(runtime: Memory64CrossRealmRuntime): "i64" | "i32" {
  return runtime === "memory64" ? "i64" : "i32";
}

/**
 * Worker-side allocator. It cannot expand the token's budget and has no
 * coordinator constructor; a valid main-realm reservation is mandatory.
 */
export function allocateMemory64CrossRealmWorkerLease(
  options: Memory64CrossRealmWorkerAllocationOptions,
): Memory64CrossRealmWorkerLease {
  const token = snapshotMemory64CrossRealmReservationToken(options.token);
  if (!token) throw new Error("Cross-realm Memory64 reservation token is invalid");
  const requiredResidentBytes = positiveBigInt(options.requiredResidentBytes);
  if (requiredResidentBytes === null) {
    throw new RangeError("Worker resident byte requirement is invalid");
  }
  const requiredPages = ceilPages(requiredResidentBytes);
  const authorizedPages = BigInt(token.authorizedResidentPages);
  const authorizedBytes = BigInt(token.authorizedResidentBytes);
  const tokenMinimumPages = BigInt(token.minimumResidentPages);
  const minimumPages = requiredPages > tokenMinimumPages
    ? requiredPages
    : tokenMinimumPages;
  if (
    requiredResidentBytes > authorizedBytes
    || minimumPages > authorizedPages
  ) throw new RangeError("Worker resident requirement exceeds its main-realm reservation");

  const port = options.allocationPort ?? defaultAllocationPort(options.webAssembly);
  const attempts: Memory64CrossRealmWorkerAllocationAttempt[] = [];
  const candidate = token.selectedRuntime;
  const addressType = runtimeAddress(candidate);
  const maximumPages = addressType === "i32"
    ? (authorizedPages < WASM32_MAX_PAGES ? authorizedPages : WASM32_MAX_PAGES)
    : authorizedPages;
  if (maximumPages < minimumPages) {
    throw new RangeError("Selected Worker runtime cannot satisfy the minimum reservation");
  }
  for (const pages of shrinkingWindows(maximumPages, minimumPages)) {
    try {
      const runtime = port.allocate({ runtime: candidate, addressType, pages });
      if (
        runtime.addressType !== addressType
        || runtime.currentPages !== pages
        || runtime.currentByteLength !== pages * STUDIO_WASM_PAGE_BYTES
      ) {
        try {
          port.release?.(runtime);
        } catch {
          // A mismatched runtime is rejected even if its cleanup hook fails.
        }
        throw new Error("Worker allocation port returned a mismatched runtime");
      }
      attempts.push(Object.freeze({
        runtime: candidate,
        addressType,
        pages,
        status: "allocated",
        issue: null,
      }));
      const acknowledgement = Object.freeze({
        kind: "epoch16-memory64/cross-realm-allocation-ack" as const,
        version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
        reservationId: token.reservationId,
        nonce: token.nonce,
        runtime: candidate,
        addressType,
        residentBytes: runtime.currentByteLength.toString(),
        residentPages: runtime.currentPages.toString(),
      });
      let released = false;
      return Object.freeze({
        token,
        runtime,
        acknowledgement,
        attempts: Object.freeze(attempts.slice()),
        authority: "scratch-only",
        durablePersistenceAuthority: "opfs-cas-paging",
        release: () => {
          if (released) return false;
          released = true;
          try {
            port.release?.(runtime);
          } catch {
            // The local Worker reference is relinquished exactly once regardless.
          }
          return true;
        },
      });
    } catch (error) {
      attempts.push(Object.freeze({
        runtime: candidate,
        addressType,
        pages,
        status: "failed",
        issue: issue(error),
      }));
    }
  }
  throw new Error(
    `Worker could not allocate the selected ${candidate} window after ${attempts.length} attempts`,
  );
}
