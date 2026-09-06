import {
  STUDIO_WASM_PAGE_BYTES,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

import {
  MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
  createMemory64CrossRealmRelease,
  snapshotMemory64CrossRealmAllocationAck,
  snapshotMemory64CrossRealmRelease,
  snapshotMemory64CrossRealmReservationToken,
  type Memory64CrossRealmRelease,
  type Memory64CrossRealmReservationToken,
  type Memory64CrossRealmRuntime,
} from "./Memory64CrossRealmProtocol";
import {
  attemptWasmScratchAllocation,
  iterateWasmScratchChunks,
  planWasmScratchWorkingSet,
  probeWasmMemory64Capability,
  WASM_MEMORY64_ACCELERATOR_POLICY,
  type WasmMemory64CapabilityReceipt,
  type WasmExactMemoryRuntime,
  type WasmScratchAllocationReceipt,
  type WasmScratchAllocationRequest,
  type WasmScratchBackpressureReceipt,
  type WasmScratchCapabilitySelection,
  type WasmScratchChunkDescriptor,
  type WasmScratchRuntimeBudget,
  type WasmScratchWorkingSetPlan,
  type WasmScratchWorkingSetRequest,
  type WasmScratchWorkload,
} from "./WasmMemory64Capability";

export const EPOCH16_MEMORY64_PRODUCT_WORKLOADS = Object.freeze([
  "brush",
  "texture",
  "scene3d",
  "physics",
  "vision",
  "project",
  "animation",
] as const satisfies readonly WasmScratchWorkload[]);

/**
 * A workload supplies only an OPFS/CAS range identity. Canonical JSON, project IR,
 * decoded whole-document bytes, and other payload objects are deliberately absent.
 */
export interface Memory64PagedWorkloadSource {
  readonly authority: "opfs-cas-paging";
  readonly access: "paged-range-only";
  readonly objectDigest?: string;
}

export interface Memory64WorkloadRequest
  extends WasmScratchWorkingSetRequest {
  readonly budget: WasmScratchRuntimeBudget;
  readonly source: Memory64PagedWorkloadSource;
}

export interface Memory64WorkloadAllocationPort {
  allocate(request: WasmScratchAllocationRequest): StudioWasmLinearMemoryRuntime;
  release?(runtime: StudioWasmLinearMemoryRuntime): void;
}

export interface Memory64WorkloadCoordinatorOptions {
  /** Exact runtime selected before this coordinator accepts any operation. */
  readonly selectedRuntime?: WasmExactMemoryRuntime;
  /** Test/embedding seam. It is invoked exactly once for one coordinator. */
  readonly capabilityProbe?: () => WasmMemory64CapabilityReceipt;
  /** Used by the default one-probe allocator; omitted resolves the global host. */
  readonly webAssembly?: typeof WebAssembly | null;
  readonly allocationPort?: Memory64WorkloadAllocationPort;
  /** Opaque capability nonce seam. Production uses Web Crypto. */
  readonly crossRealmNonceFactory?: () => string;
  /** Monotonic wall-clock seam used only for the pre-ACK deadline. */
  readonly now?: () => number;
  readonly crossRealmAcknowledgementTimeoutMs?: number;
}

export interface Memory64WorkloadAttemptReceipt {
  readonly plan: WasmScratchWorkingSetPlan;
  readonly allocation: WasmScratchAllocationReceipt;
}

export interface Memory64WorkloadOpfsSpillReceipt {
  readonly disposition: "not-required" | "available" | "required";
  readonly authority: "opfs-cas-paging";
  readonly access: "paged-range-only";
  readonly action:
    | "continue-in-wasm"
    | WasmScratchBackpressureReceipt["action"];
}

export interface Memory64WorkloadLease {
  readonly leaseId: string;
  readonly workload: WasmScratchWorkload;
  readonly runtime: StudioWasmLinearMemoryRuntime;
  readonly plan: WasmScratchWorkingSetPlan;
  readonly source: Memory64PagedWorkloadSource;
  /** Creates descriptors lazily and never accumulates the logical job. */
  chunks(): Generator<WasmScratchChunkDescriptor, void, undefined>;
  release(): boolean;
}

export interface Memory64WorkloadAllocatedReceipt {
  readonly ok: true;
  readonly status: "allocated";
  readonly workload: WasmScratchWorkload;
  readonly selectedRuntime: WasmExactMemoryRuntime;
  readonly capability: WasmMemory64CapabilityReceipt;
  readonly plan: WasmScratchWorkingSetPlan;
  readonly allocation: Extract<
    WasmScratchAllocationReceipt,
    { readonly status: "allocated" }
  >;
  readonly attempts: readonly Memory64WorkloadAttemptReceipt[];
  readonly opfsSpill: Memory64WorkloadOpfsSpillReceipt;
  readonly lease: Memory64WorkloadLease;
  readonly readsCanonicalProjectBytes: false;
  readonly materializesWholeDocument: false;
  readonly materializesWholeJson: false;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
}

export interface Memory64WorkloadBackpressureReceipt {
  readonly ok: false;
  readonly status: "backpressure";
  readonly workload: WasmScratchWorkload | null;
  readonly selectedRuntime:
    | "memory64"
    | "memory32-requested"
    | "unavailable";
  readonly capability: WasmMemory64CapabilityReceipt;
  readonly attempts: readonly Memory64WorkloadAttemptReceipt[];
  /** Exact planner/allocation receipt; no failure or recommended action is erased. */
  readonly terminal:
    | WasmScratchBackpressureReceipt
    | Extract<
        WasmScratchAllocationReceipt,
        { readonly status: "backpressure" }
      >;
  readonly opfsSpill: Memory64WorkloadOpfsSpillReceipt;
  readonly readsCanonicalProjectBytes: false;
  readonly materializesWholeDocument: false;
  readonly materializesWholeJson: false;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
}

export type Memory64WorkloadReceipt =
  | Memory64WorkloadAllocatedReceipt
  | Memory64WorkloadBackpressureReceipt;

export interface Memory64CrossRealmReservedReceipt {
  readonly ok: true;
  readonly status: "reserved";
  readonly workload: WasmScratchWorkload;
  readonly selectedRuntime: Memory64CrossRealmRuntime;
  readonly capability: WasmMemory64CapabilityReceipt;
  readonly plan: WasmScratchWorkingSetPlan;
  readonly token: Memory64CrossRealmReservationToken;
  readonly opfsSpill: Memory64WorkloadOpfsSpillReceipt;
  readonly readsCanonicalProjectBytes: false;
  readonly materializesWholeDocument: false;
  readonly materializesWholeJson: false;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
  release(): boolean;
}

export type Memory64CrossRealmReservationReceipt =
  | Memory64CrossRealmReservedReceipt
  | Memory64WorkloadBackpressureReceipt;

export type Memory64CrossRealmAckRejectionReason =
  | "invalid-token"
  | "forged-token"
  | "stale-token"
  | "acknowledgement-expired"
  | "invalid-ack"
  | "duplicate-ack";

export type Memory64CrossRealmAckReceipt =
  | Readonly<{
      readonly ok: true;
      readonly status: "acknowledged";
      readonly reservationId: string;
      readonly workload: WasmScratchWorkload;
      readonly runtime: Memory64CrossRealmRuntime;
      readonly residentBytes: bigint;
      readonly residentPages: bigint;
      readonly authority: "main-realm-memory64-workload-coordinator";
    }>
  | Readonly<{
      readonly ok: false;
      readonly status: "rejected";
      readonly reason: Memory64CrossRealmAckRejectionReason;
    }>;

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

interface ActiveMemory64Lease {
  readonly runtime: StudioWasmLinearMemoryRuntime;
  readonly residentBytes: bigint;
  readonly residentPages: bigint;
}

interface ActiveCrossRealmReservation {
  readonly token: Memory64CrossRealmReservationToken;
  readonly plan: WasmScratchWorkingSetPlan;
  state: "pending-ack" | "acknowledged";
  residentBytes: bigint;
  residentPages: bigint;
}

const REQUEST_KEYS = new Set([
  "workload",
  "logicalByteLength",
  "preferredChunkBytes",
  "minimumChunkBytes",
  "budget",
  "source",
]);
const SOURCE_KEYS = new Set(["authority", "access", "objectDigest"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkload(value: unknown): value is WasmScratchWorkload {
  return WASM_MEMORY64_ACCELERATOR_POLICY.workloads.some(
    (candidate) => candidate === value,
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPagedSource(value: unknown): value is Memory64PagedWorkloadSource {
  if (!isRecord(value) || !hasOnlyKeys(value, SOURCE_KEYS)) return false;
  if (
    value.authority !== "opfs-cas-paging"
    || value.access !== "paged-range-only"
  ) return false;
  return value.objectDigest === undefined
    || (
      typeof value.objectDigest === "string"
      && value.objectDigest.trim().length > 0
      && value.objectDigest.length <= 512
    );
}

function freezeAttempts(
  attempts: readonly Memory64WorkloadAttemptReceipt[],
): readonly Memory64WorkloadAttemptReceipt[] {
  return Object.freeze(attempts.slice());
}

function spillReceipt(
  action: Memory64WorkloadOpfsSpillReceipt["action"],
): Memory64WorkloadOpfsSpillReceipt {
  return Object.freeze({
    disposition: action === "continue-in-wasm"
      ? "not-required"
      : action === "stream-through-opfs"
        ? "required"
        : "available",
    authority: "opfs-cas-paging",
    access: "paged-range-only",
    action,
  });
}

function invalidRequestReceipt(
  workload: WasmScratchWorkload | null,
): WasmScratchBackpressureReceipt {
  return Object.freeze({
    ok: false,
    status: "backpressure",
    workload,
    reason: "invalid-request",
    action: "stream-through-opfs",
    message:
      "Memory64 workloads accept only bounded OPFS/CAS range descriptors; whole JSON, IR, or payload objects are forbidden.",
    recommendedPages: BigInt(0),
    policy: WASM_MEMORY64_ACCELERATOR_POLICY,
  });
}

function normalizeCapability(
  capability: WasmMemory64CapabilityReceipt,
): WasmScratchCapabilitySelection {
  return Object.freeze({
    selectedRuntime: capability.selectedRuntime,
  });
}

function createDefaultAllocationPort(
  override: typeof WebAssembly | null | undefined,
): Memory64WorkloadAllocationPort {
  return Object.freeze({
    allocate(request: WasmScratchAllocationRequest) {
      const webAssembly = override === undefined
        ? globalThis.WebAssembly
        : override;
      if (!webAssembly) throw new Error("WebAssembly is unavailable");
      const MemoryConstructor =
        webAssembly.Memory as unknown as StudioMemoryConstructor;
      const memory = request.addressType === "i64"
        ? new MemoryConstructor({
            address: "i64",
            initial: request.initialPages,
            maximum: request.maximumPages,
          })
        : new MemoryConstructor({
            address: "i32",
            initial: Number(request.initialPages),
            maximum: Number(request.maximumPages),
          });
      return new StudioWasmLinearMemoryRuntime({
        memory,
        addressType: request.addressType,
        selection: request.addressType === "i64"
          ? "memory64"
          : "memory32-requested",
        maximumPages: request.maximumPages,
      });
    },
  });
}

function selectedRuntime(
  selection: WasmScratchCapabilitySelection,
): Memory64WorkloadBackpressureReceipt["selectedRuntime"] {
  return selection.selectedRuntime;
}

function nonNegativeBudgetValue(value: number | bigint | undefined): bigint | null {
  if (value === undefined) return BigInt(0);
  if (typeof value === "bigint") return value >= BigInt(0) ? value : null;
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

function reserveActiveResidentBytes(
  budget: WasmScratchRuntimeBudget,
  activeResidentBytes: bigint,
): WasmScratchRuntimeBudget {
  const hostReservedBytes = nonNegativeBudgetValue(budget.reservedBytes);
  if (hostReservedBytes === null) return budget;
  return Object.freeze({
    availableBytes: budget.availableBytes,
    availablePages: budget.availablePages,
    reservedBytes: hostReservedBytes + activeResidentBytes,
  });
}

function defaultCrossRealmNonce(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto is required for cross-realm Memory64 reservations");
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function sameCrossRealmToken(
  left: Memory64CrossRealmReservationToken,
  right: Memory64CrossRealmReservationToken,
): boolean {
  return left.kind === right.kind
    && left.version === right.version
    && left.reservationId === right.reservationId
    && left.nonce === right.nonce
    && left.workload === right.workload
    && left.selectedRuntime === right.selectedRuntime
    && left.authorizedResidentBytes === right.authorizedResidentBytes
    && left.authorizedResidentPages === right.authorizedResidentPages
    && left.minimumResidentPages === right.minimumResidentPages
    && left.acknowledgementDeadlineMilliseconds
      === right.acknowledgementDeadlineMilliseconds
    && left.source.authority === right.source.authority
    && left.source.access === right.source.access
    && left.source.objectDigest === right.source.objectDigest
    && left.canonicalWritesAllowed === right.canonicalWritesAllowed
    && left.persistenceWritesAllowed === right.persistenceWritesAllowed;
}

function rejectedCrossRealmAck(
  reason: Memory64CrossRealmAckRejectionReason,
): Memory64CrossRealmAckReceipt {
  return Object.freeze({ ok: false, status: "rejected", reason });
}

/**
 * Owns the single Epoch16 Memory64 capability decision and bounded scratch leases.
 * Allocation attempts shrink geometrically; neither attempts nor leases contain
 * canonical project payloads.
 */
export class Memory64WorkloadCoordinator {
  public readonly capability: WasmMemory64CapabilityReceipt;

  private readonly allocationPort: Memory64WorkloadAllocationPort;
  private readonly activeLeases = new Map<
    string,
    ActiveMemory64Lease
  >();
  private readonly crossRealmReservations = new Map<
    string,
    ActiveCrossRealmReservation
  >();
  private readonly crossRealmNonceFactory: () => string;
  private readonly now: () => number;
  private readonly crossRealmAcknowledgementTimeoutMs: number;
  private activeResidentBytesValue = BigInt(0);
  private activeResidentPagesValue = BigInt(0);
  private nextLeaseId = BigInt(1);
  private nextCrossRealmReservationId = BigInt(1);
  private closed = false;

  public constructor(options: Memory64WorkloadCoordinatorOptions = {}) {
    this.capability = (
      options.capabilityProbe
      ?? (() => probeWasmMemory64Capability({
        webAssembly: options.webAssembly,
        selectedRuntime: options.selectedRuntime ?? "memory64",
      }))
    )();
    this.allocationPort = options.allocationPort
      ?? createDefaultAllocationPort(options.webAssembly);
    this.crossRealmNonceFactory = options.crossRealmNonceFactory
      ?? defaultCrossRealmNonce;
    this.now = options.now ?? (() => Date.now());
    this.crossRealmAcknowledgementTimeoutMs =
      options.crossRealmAcknowledgementTimeoutMs ?? 30_000;
    if (!validTimeout(this.crossRealmAcknowledgementTimeoutMs)) {
      throw new RangeError("Cross-realm Memory64 acknowledgement timeout is invalid");
    }
  }

  public get activeLeaseCount(): number {
    return this.activeLeases.size + this.crossRealmReservations.size;
  }

  public get activeCrossRealmReservationCount(): number {
    return this.crossRealmReservations.size;
  }

  public get pendingCrossRealmAcknowledgementCount(): number {
    let count = 0;
    for (const reservation of this.crossRealmReservations.values()) {
      if (reservation.state === "pending-ack") count += 1;
    }
    return count;
  }

  /** Maximum resident bytes reserved by all live leases in this coordinator. */
  public get activeResidentBytes(): bigint {
    return this.activeResidentBytesValue;
  }

  /** Maximum WebAssembly pages reserved by all live leases in this coordinator. */
  public get activeResidentPages(): bigint {
    return this.activeResidentPagesValue;
  }

  public coordinate(request: Memory64WorkloadRequest): Memory64WorkloadReceipt {
    if (this.closed) throw new Error("Memory64 workload coordinator is closed");

    const requestRecord = request as unknown as Record<string, unknown>;
    const workload = isWorkload(requestRecord.workload)
      ? requestRecord.workload
      : null;
    if (
      !hasOnlyKeys(requestRecord, REQUEST_KEYS)
      || !isPagedSource(requestRecord.source)
    ) {
      const terminal = invalidRequestReceipt(workload);
      return this.backpressure(
        terminal,
        normalizeCapability(this.capability),
        [],
      );
    }

    const source = Object.freeze({
      authority: requestRecord.source.authority,
      access: requestRecord.source.access,
      ...(requestRecord.source.objectDigest === undefined
        ? {}
        : { objectDigest: requestRecord.source.objectDigest }),
    });
    const attempts: Memory64WorkloadAttemptReceipt[] = [];
    const capability = normalizeCapability(this.capability);
    let preferredChunkBytes = request.preferredChunkBytes;

    while (true) {
      const plan = planWasmScratchWorkingSet(
        capability,
        reserveActiveResidentBytes(
          request.budget,
          this.activeResidentBytesValue,
        ),
        {
          workload: request.workload,
          logicalByteLength: request.logicalByteLength,
          preferredChunkBytes,
          ...(request.minimumChunkBytes === undefined
            ? {}
            : { minimumChunkBytes: request.minimumChunkBytes }),
        },
      );
      if (!plan.ok) {
        return this.backpressure(
          plan,
          capability,
          attempts,
        );
      }

      let allocatedRuntime: StudioWasmLinearMemoryRuntime | null = null;
      const allocation = attemptWasmScratchAllocation(plan, {
        allocate: (allocationRequest) => {
          allocatedRuntime = this.allocationPort.allocate(allocationRequest);
        },
      });
      attempts.push(Object.freeze({ plan, allocation }));

      if (allocation.ok) {
        if (allocatedRuntime === null) {
          throw new Error("Memory64 allocation port returned no runtime");
        }
        return this.allocated(
          plan,
          allocation,
          allocatedRuntime,
          source,
          attempts,
        );
      }

      if (
        allocation.action === "retry-smaller-working-set"
        && allocation.recommendedPages > BigInt(0)
      ) {
        preferredChunkBytes =
          allocation.recommendedPages * STUDIO_WASM_PAGE_BYTES;
        continue;
      }

      return this.backpressure(
        allocation,
        capability,
        attempts,
      );
    }
  }

  /**
   * Reserves the main-realm budget without allocating memory in the wrong realm.
   * The Dedicated Worker must echo the opaque token with its exact resident
   * allocation before work begins.
   */
  public reserveCrossRealm(
    request: Memory64WorkloadRequest,
  ): Memory64CrossRealmReservationReceipt {
    if (this.closed) throw new Error("Memory64 workload coordinator is closed");
    const requestRecord = request as unknown as Record<string, unknown>;
    const workload = isWorkload(requestRecord.workload)
      ? requestRecord.workload
      : null;
    const capability = normalizeCapability(this.capability);
    if (
      !hasOnlyKeys(requestRecord, REQUEST_KEYS)
      || !isPagedSource(requestRecord.source)
    ) {
      return this.backpressure(
        invalidRequestReceipt(workload),
        capability,
        [],
      );
    }

    const plan = planWasmScratchWorkingSet(
      capability,
      reserveActiveResidentBytes(request.budget, this.activeResidentBytesValue),
      request,
    );
    if (!plan.ok) return this.backpressure(plan, capability, []);

    const now = this.now();
    const deadline = now + this.crossRealmAcknowledgementTimeoutMs;
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(deadline) || now < 0) {
      throw new Error("Cross-realm Memory64 clock is invalid");
    }
    const nonce = this.crossRealmNonceFactory();
    const reservationId = `epoch16-xrealm-${this.nextCrossRealmReservationId.toString()}`;
    this.nextCrossRealmReservationId += BigInt(1);
    const token = snapshotMemory64CrossRealmReservationToken({
      kind: "epoch16-memory64/cross-realm-reservation",
      version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
      reservationId,
      nonce,
      workload: plan.workload,
      selectedRuntime: plan.runtime,
      authorizedResidentBytes: plan.workingSetBytes.toString(),
      authorizedResidentPages: plan.workingSetPages.toString(),
      minimumResidentPages: plan.minimumWorkingSetPages.toString(),
      acknowledgementDeadlineMilliseconds: deadline,
      source: request.source,
      canonicalWritesAllowed: false,
      persistenceWritesAllowed: false,
    });
    if (!token) throw new Error("Cross-realm Memory64 token generation failed closed");

    this.crossRealmReservations.set(reservationId, {
      token,
      plan,
      state: "pending-ack",
      residentBytes: plan.workingSetBytes,
      residentPages: plan.workingSetPages,
    });
    this.activeResidentBytesValue += plan.workingSetBytes;
    this.activeResidentPagesValue += plan.workingSetPages;
    return Object.freeze({
      ok: true,
      status: "reserved",
      workload: plan.workload,
      selectedRuntime: plan.runtime,
      capability: this.capability,
      plan,
      token,
      opfsSpill: spillReceipt("continue-in-wasm"),
      readsCanonicalProjectBytes: false,
      materializesWholeDocument: false,
      materializesWholeJson: false,
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
      release: () => this.releaseCrossRealmReservation(
        createMemory64CrossRealmRelease(token),
      ),
    });
  }

  public acknowledgeCrossRealmReservation(
    tokenCandidate: unknown,
    acknowledgementCandidate: unknown,
  ): Memory64CrossRealmAckReceipt {
    const token = snapshotMemory64CrossRealmReservationToken(tokenCandidate);
    if (!token) return rejectedCrossRealmAck("invalid-token");
    const reservation = this.crossRealmReservations.get(token.reservationId);
    if (!reservation) return rejectedCrossRealmAck("stale-token");
    if (!sameCrossRealmToken(reservation.token, token)) {
      return rejectedCrossRealmAck("forged-token");
    }
    if (
      reservation.state === "pending-ack"
      && this.now() > token.acknowledgementDeadlineMilliseconds
    ) {
      this.releaseCrossRealmReservation(createMemory64CrossRealmRelease(token));
      return rejectedCrossRealmAck("acknowledgement-expired");
    }
    if (reservation.state === "acknowledged") {
      this.releaseCrossRealmReservation(createMemory64CrossRealmRelease(token));
      return rejectedCrossRealmAck("duplicate-ack");
    }

    const acknowledgement = snapshotMemory64CrossRealmAllocationAck(
      acknowledgementCandidate,
    );
    if (
      !acknowledgement
      || acknowledgement.reservationId !== token.reservationId
      || acknowledgement.nonce !== token.nonce
    ) {
      this.releaseCrossRealmReservation(createMemory64CrossRealmRelease(token));
      return rejectedCrossRealmAck("invalid-ack");
    }
    const residentBytes = BigInt(acknowledgement.residentBytes);
    const residentPages = BigInt(acknowledgement.residentPages);
    const authorizedBytes = BigInt(token.authorizedResidentBytes);
    const authorizedPages = BigInt(token.authorizedResidentPages);
    const minimumPages = BigInt(token.minimumResidentPages);
    const runtimeAllowed = acknowledgement.runtime === token.selectedRuntime;
    const addressMatchesRuntime = acknowledgement.runtime === "memory64"
      ? acknowledgement.addressType === "i64"
      : acknowledgement.addressType === "i32";
    if (
      !runtimeAllowed
      || !addressMatchesRuntime
      || residentPages < minimumPages
      || residentPages > authorizedPages
      || residentBytes > authorizedBytes
      || residentBytes !== residentPages * STUDIO_WASM_PAGE_BYTES
    ) {
      this.releaseCrossRealmReservation(createMemory64CrossRealmRelease(token));
      return rejectedCrossRealmAck("invalid-ack");
    }

    this.activeResidentBytesValue -= reservation.residentBytes;
    this.activeResidentPagesValue -= reservation.residentPages;
    reservation.residentBytes = residentBytes;
    reservation.residentPages = residentPages;
    reservation.state = "acknowledged";
    this.activeResidentBytesValue += residentBytes;
    this.activeResidentPagesValue += residentPages;
    return Object.freeze({
      ok: true,
      status: "acknowledged",
      reservationId: token.reservationId,
      workload: token.workload,
      runtime: acknowledgement.runtime,
      residentBytes,
      residentPages,
      authority: "main-realm-memory64-workload-coordinator",
    });
  }

  public releaseCrossRealmReservation(
    candidate: Memory64CrossRealmReservationToken | Memory64CrossRealmRelease | unknown,
  ): boolean {
    const token = snapshotMemory64CrossRealmReservationToken(candidate);
    const release = token
      ? createMemory64CrossRealmRelease(token)
      : snapshotMemory64CrossRealmRelease(candidate);
    if (!release) return false;
    const reservation = this.crossRealmReservations.get(release.reservationId);
    if (!reservation || reservation.token.nonce !== release.nonce) return false;
    this.crossRealmReservations.delete(release.reservationId);
    this.activeResidentBytesValue -= reservation.residentBytes;
    this.activeResidentPagesValue -= reservation.residentPages;
    return true;
  }

  /** Releases only never-ACKed reservations whose Worker handshake timed out. */
  public expireCrossRealmReservations(now = this.now()): number {
    if (!Number.isSafeInteger(now) || now < 0) return 0;
    let released = 0;
    for (const reservation of [...this.crossRealmReservations.values()]) {
      if (
        reservation.state === "pending-ack"
        && now > reservation.token.acknowledgementDeadlineMilliseconds
        && this.releaseCrossRealmReservation(
          createMemory64CrossRealmRelease(reservation.token),
        )
      ) released += 1;
    }
    return released;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const leaseId of [...this.activeLeases.keys()]) this.releaseLease(leaseId);
    for (const reservation of [...this.crossRealmReservations.values()]) {
      this.releaseCrossRealmReservation(
        createMemory64CrossRealmRelease(reservation.token),
      );
    }
  }

  private allocated(
    plan: WasmScratchWorkingSetPlan,
    allocation: Extract<
      WasmScratchAllocationReceipt,
      { readonly status: "allocated" }
    >,
    runtime: StudioWasmLinearMemoryRuntime,
    source: Memory64PagedWorkloadSource,
    attempts: readonly Memory64WorkloadAttemptReceipt[],
  ): Memory64WorkloadAllocatedReceipt {
    const leaseId = `epoch16-wasm-${this.nextLeaseId.toString()}`;
    this.nextLeaseId += BigInt(1);
    this.activeLeases.set(leaseId, Object.freeze({
      runtime,
      residentBytes: plan.workingSetBytes,
      residentPages: plan.workingSetPages,
    }));
    this.activeResidentBytesValue += plan.workingSetBytes;
    this.activeResidentPagesValue += plan.workingSetPages;
    const lease = Object.freeze({
      leaseId,
      workload: plan.workload,
      runtime,
      plan,
      source,
      chunks: () => iterateWasmScratchChunks(plan),
      release: () => this.releaseLease(leaseId),
    });
    return Object.freeze({
      ok: true,
      status: "allocated",
      workload: plan.workload,
      selectedRuntime: plan.runtime,
      capability: this.capability,
      plan,
      allocation,
      attempts: freezeAttempts(attempts),
      opfsSpill: spillReceipt("continue-in-wasm"),
      lease,
      readsCanonicalProjectBytes: false,
      materializesWholeDocument: false,
      materializesWholeJson: false,
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
  }

  private backpressure(
    terminal: Memory64WorkloadBackpressureReceipt["terminal"],
    capability: WasmScratchCapabilitySelection,
    attempts: readonly Memory64WorkloadAttemptReceipt[],
  ): Memory64WorkloadBackpressureReceipt {
    return Object.freeze({
      ok: false,
      status: "backpressure",
      workload: terminal.status === "backpressure"
        && "workload" in terminal
        ? terminal.workload
        : attempts.at(-1)?.plan.workload ?? null,
      selectedRuntime: selectedRuntime(capability),
      capability: this.capability,
      attempts: freezeAttempts(attempts),
      terminal,
      opfsSpill: spillReceipt(terminal.action),
      readsCanonicalProjectBytes: false,
      materializesWholeDocument: false,
      materializesWholeJson: false,
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
  }

  private releaseLease(leaseId: string): boolean {
    const active = this.activeLeases.get(leaseId);
    if (!active) return false;
    this.activeLeases.delete(leaseId);
    this.activeResidentBytesValue -= active.residentBytes;
    this.activeResidentPagesValue -= active.residentPages;
    try {
      this.allocationPort.release?.(active.runtime);
    } catch {
      // The lease is no longer resident even if a custom cleanup hook fails.
    }
    return true;
  }
}

export function createMemory64WorkloadCoordinator(
  options: Memory64WorkloadCoordinatorOptions = {},
): Memory64WorkloadCoordinator {
  return new Memory64WorkloadCoordinator(options);
}

let mainRealmMemory64WorkloadCoordinator: Memory64WorkloadCoordinator | null = null;

/**
 * App-lifetime main-realm budget authority. Dedicated Workers receive only
 * reservation tokens and must never instantiate this singleton themselves.
 */
export function getMainRealmMemory64WorkloadCoordinator(): Memory64WorkloadCoordinator {
  mainRealmMemory64WorkloadCoordinator ??= new Memory64WorkloadCoordinator();
  return mainRealmMemory64WorkloadCoordinator;
}
