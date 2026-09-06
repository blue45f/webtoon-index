import {
  WASM_MEMORY64_ACCELERATOR_POLICY,
  type WasmExactMemoryRuntime,
  type WasmScratchWorkload,
} from "./WasmMemory64Capability";

export const MEMORY64_CROSS_REALM_PROTOCOL_VERSION = 2 as const;

export type Memory64CrossRealmRuntime = WasmExactMemoryRuntime;

export interface Memory64CrossRealmReservationToken {
  readonly kind: "epoch16-memory64/cross-realm-reservation";
  readonly version: typeof MEMORY64_CROSS_REALM_PROTOCOL_VERSION;
  readonly reservationId: string;
  /** Opaque capability nonce. The Worker can echo it but cannot mint a valid reservation. */
  readonly nonce: string;
  readonly workload: WasmScratchWorkload;
  /** Exact runtime selected in the main realm before this reservation exists. */
  readonly selectedRuntime: Memory64CrossRealmRuntime;
  /** Canonical base-10 strings keep the contract structured-clone/JSON safe. */
  readonly authorizedResidentBytes: string;
  readonly authorizedResidentPages: string;
  readonly minimumResidentPages: string;
  /** Applies only while waiting for the first Worker allocation ACK. */
  readonly acknowledgementDeadlineMilliseconds: number;
  readonly source: Readonly<{
    readonly authority: "opfs-cas-paging";
    readonly access: "paged-range-only";
    readonly objectDigest?: string;
  }>;
  readonly canonicalWritesAllowed: false;
  readonly persistenceWritesAllowed: false;
}

export interface Memory64CrossRealmAllocationAck {
  readonly kind: "epoch16-memory64/cross-realm-allocation-ack";
  readonly version: typeof MEMORY64_CROSS_REALM_PROTOCOL_VERSION;
  readonly reservationId: string;
  readonly nonce: string;
  readonly runtime: Memory64CrossRealmRuntime;
  readonly addressType: "i64" | "i32";
  readonly residentBytes: string;
  readonly residentPages: string;
}

export interface Memory64CrossRealmRelease {
  readonly kind: "epoch16-memory64/cross-realm-release";
  readonly version: typeof MEMORY64_CROSS_REALM_PROTOCOL_VERSION;
  readonly reservationId: string;
  readonly nonce: string;
}

const TOKEN_KEYS = new Set([
  "kind",
  "version",
  "reservationId",
  "nonce",
  "workload",
  "selectedRuntime",
  "authorizedResidentBytes",
  "authorizedResidentPages",
  "minimumResidentPages",
  "acknowledgementDeadlineMilliseconds",
  "source",
  "canonicalWritesAllowed",
  "persistenceWritesAllowed",
]);
const ACK_KEYS = new Set([
  "kind",
  "version",
  "reservationId",
  "nonce",
  "runtime",
  "addressType",
  "residentBytes",
  "residentPages",
]);
const RELEASE_KEYS = new Set([
  "kind",
  "version",
  "reservationId",
  "nonce",
]);
const SOURCE_KEYS = new Set(["authority", "access", "objectDigest"]);
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const NONCE_PATTERN = /^[a-f0-9]{32,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function decimal(value: unknown, positive = true): value is string {
  if (
    typeof value !== "string"
    || value.length > 32
    || !DECIMAL_PATTERN.test(value)
  ) return false;
  return !positive || value !== "0";
}

function runtime(value: unknown): value is Memory64CrossRealmRuntime {
  return value === "memory64" || value === "memory32-requested";
}

function workload(value: unknown): value is WasmScratchWorkload {
  return WASM_MEMORY64_ACCELERATOR_POLICY.workloads.some(
    (candidate) => candidate === value,
  );
}

function source(value: unknown): value is Memory64CrossRealmReservationToken["source"] {
  if (!isRecord(value) || !hasOnlyKeys(value, SOURCE_KEYS)) return false;
  return value.authority === "opfs-cas-paging"
    && value.access === "paged-range-only"
    && (
      value.objectDigest === undefined
      || (
        typeof value.objectDigest === "string"
        && value.objectDigest.trim().length > 0
        && value.objectDigest.length <= 512
      )
    );
}

export function snapshotMemory64CrossRealmReservationToken(
  value: unknown,
): Memory64CrossRealmReservationToken | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, TOKEN_KEYS)
    || value.kind !== "epoch16-memory64/cross-realm-reservation"
    || value.version !== MEMORY64_CROSS_REALM_PROTOCOL_VERSION
    || typeof value.reservationId !== "string"
    || value.reservationId.length < 8
    || value.reservationId.length > 160
    || typeof value.nonce !== "string"
    || !NONCE_PATTERN.test(value.nonce)
    || !workload(value.workload)
    || !runtime(value.selectedRuntime)
    || !decimal(value.authorizedResidentBytes)
    || !decimal(value.authorizedResidentPages)
    || !decimal(value.minimumResidentPages)
    || !Number.isSafeInteger(value.acknowledgementDeadlineMilliseconds)
    || (value.acknowledgementDeadlineMilliseconds as number) <= 0
    || !source(value.source)
    || value.canonicalWritesAllowed !== false
    || value.persistenceWritesAllowed !== false
  ) return null;
  return Object.freeze({
    kind: value.kind,
    version: value.version,
    reservationId: value.reservationId,
    nonce: value.nonce,
    workload: value.workload,
    selectedRuntime: value.selectedRuntime,
    authorizedResidentBytes: value.authorizedResidentBytes,
    authorizedResidentPages: value.authorizedResidentPages,
    minimumResidentPages: value.minimumResidentPages,
    acknowledgementDeadlineMilliseconds:
      value.acknowledgementDeadlineMilliseconds as number,
    source: Object.freeze({
      authority: value.source.authority,
      access: value.source.access,
      ...(value.source.objectDigest === undefined
        ? {}
        : { objectDigest: value.source.objectDigest }),
    }),
    canonicalWritesAllowed: false,
    persistenceWritesAllowed: false,
  });
}

export function snapshotMemory64CrossRealmAllocationAck(
  value: unknown,
): Memory64CrossRealmAllocationAck | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ACK_KEYS)
    || value.kind !== "epoch16-memory64/cross-realm-allocation-ack"
    || value.version !== MEMORY64_CROSS_REALM_PROTOCOL_VERSION
    || typeof value.reservationId !== "string"
    || typeof value.nonce !== "string"
    || !NONCE_PATTERN.test(value.nonce)
    || !runtime(value.runtime)
    || !["i64", "i32"].includes(String(value.addressType))
    || !decimal(value.residentBytes)
    || !decimal(value.residentPages)
  ) return null;
  return Object.freeze({
    kind: value.kind,
    version: value.version,
    reservationId: value.reservationId,
    nonce: value.nonce,
    runtime: value.runtime,
    addressType: value.addressType as "i64" | "i32",
    residentBytes: value.residentBytes,
    residentPages: value.residentPages,
  });
}

export function snapshotMemory64CrossRealmRelease(
  value: unknown,
): Memory64CrossRealmRelease | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, RELEASE_KEYS)
    || value.kind !== "epoch16-memory64/cross-realm-release"
    || value.version !== MEMORY64_CROSS_REALM_PROTOCOL_VERSION
    || typeof value.reservationId !== "string"
    || typeof value.nonce !== "string"
    || !NONCE_PATTERN.test(value.nonce)
  ) return null;
  return Object.freeze({
    kind: value.kind,
    version: value.version,
    reservationId: value.reservationId,
    nonce: value.nonce,
  });
}

export function createMemory64CrossRealmRelease(
  token: Memory64CrossRealmReservationToken,
): Memory64CrossRealmRelease {
  return Object.freeze({
    kind: "epoch16-memory64/cross-realm-release",
    version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
    reservationId: token.reservationId,
    nonce: token.nonce,
  });
}
