import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_WASM_PAGE_BYTES,
  type StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

import {
  MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
  createMemory64CrossRealmRelease,
  snapshotMemory64CrossRealmReservationToken,
  type Memory64CrossRealmAllocationAck,
  type Memory64CrossRealmReservationToken,
} from "./Memory64CrossRealmProtocol";
import {
  allocateMemory64CrossRealmWorkerLease,
} from "./Memory64CrossRealmWorker";
import {
  Memory64WorkloadCoordinator,
  type Memory64WorkloadRequest,
} from "./Memory64WorkloadCoordinator";
import {
  probeWasmMemory64Capability,
  type WasmMemory64CapabilityReceipt,
  type WasmMemoryRuntimeSelection,
} from "./WasmMemory64Capability";

const PAGE = STUDIO_WASM_PAGE_BYTES;
const BASE_CAPABILITY = probeWasmMemory64Capability({ webAssembly: null });
const SOURCE = Object.freeze({
  authority: "opfs-cas-paging",
  access: "paged-range-only",
  objectDigest: "b".repeat(64),
} as const);

function capability(
  selectedRuntime: WasmMemoryRuntimeSelection = "memory64",
): WasmMemory64CapabilityReceipt {
  return Object.freeze({
    ...BASE_CAPABILITY,
    requestedRuntime: selectedRuntime === "memory32-requested"
      ? "memory32-requested"
      : "memory64",
    selectedRuntime,
    isMemory64Supported: selectedRuntime === "memory64",
    isMemory32ReferenceSupported: selectedRuntime === "memory32-requested",
  });
}

function nonceFactory(): () => string {
  let next = BigInt(0);
  return () => {
    next += BigInt(1);
    return next.toString(16).padStart(64, "0");
  };
}

function coordinator(
  options: Readonly<{
    selectedRuntime?: WasmMemoryRuntimeSelection;
    now?: () => number;
    timeoutMs?: number;
  }> = {},
): Memory64WorkloadCoordinator {
  return new Memory64WorkloadCoordinator({
    capabilityProbe: () => capability(options.selectedRuntime),
    crossRealmNonceFactory: nonceFactory(),
    now: options.now,
    crossRealmAcknowledgementTimeoutMs: options.timeoutMs,
  });
}

function request(
  preferredPages = BigInt(1),
  minimumPages = BigInt(1),
  availablePages = BigInt(128),
): Memory64WorkloadRequest {
  return {
    workload: "brush",
    logicalByteLength: preferredPages * PAGE,
    preferredChunkBytes: preferredPages * PAGE,
    minimumChunkBytes: minimumPages * PAGE,
    budget: {
      availableBytes: availablePages * PAGE,
      availablePages,
    },
    source: SOURCE,
  };
}

function acknowledgement(
  token: Memory64CrossRealmReservationToken,
  pages = BigInt(token.authorizedResidentPages),
  runtime = token.selectedRuntime,
): Memory64CrossRealmAllocationAck {
  return Object.freeze({
    kind: "epoch16-memory64/cross-realm-allocation-ack",
    version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
    reservationId: token.reservationId,
    nonce: token.nonce,
    runtime,
    addressType: runtime === "memory64" ? "i64" : "i32",
    residentBytes: (pages * PAGE).toString(),
    residentPages: pages.toString(),
  });
}

function fakeRuntime(
  addressType: "i64" | "i32",
  runtime: "memory64" | "memory32-requested",
  pages: bigint,
): StudioWasmLinearMemoryRuntime {
  return {
    addressType,
    selection: runtime,
    currentPages: pages,
    currentByteLength: pages * PAGE,
  } as unknown as StudioWasmLinearMemoryRuntime;
}

describe("Memory64 cross-realm reservations", () => {
  it("backpressures the 129th concurrent Worker and returns all 128 reservations exactly once", () => {
    const instance = coordinator();
    const reservations = Array.from({ length: 128 }, () => (
      instance.reserveCrossRealm(request())
    ));
    expect(reservations.every((receipt) => receipt.ok)).toBe(true);
    expect(instance.activeCrossRealmReservationCount).toBe(128);
    expect(instance.pendingCrossRealmAcknowledgementCount).toBe(128);
    expect(instance.activeLeaseCount).toBe(128);
    expect(instance.activeResidentPages).toBe(BigInt(128));
    expect(instance.reserveCrossRealm(request())).toMatchObject({
      ok: false,
      status: "backpressure",
      terminal: {
        reason: "insufficient-runtime-budget",
        action: "wait-for-budget",
      },
    });

    for (const receipt of reservations) {
      if (!receipt.ok) throw new Error("reservation unexpectedly failed");
      expect(instance.acknowledgeCrossRealmReservation(
        receipt.token,
        acknowledgement(receipt.token),
      )).toMatchObject({ ok: true, status: "acknowledged" });
    }
    expect(instance.pendingCrossRealmAcknowledgementCount).toBe(0);
    for (const receipt of reservations) {
      if (!receipt.ok) continue;
      expect(receipt.release()).toBe(true);
      expect(receipt.release()).toBe(false);
    }
    expect(instance.activeCrossRealmReservationCount).toBe(0);
    expect(instance.activeResidentBytes).toBe(BigInt(0));
    expect(instance.activeResidentPages).toBe(BigInt(0));
  });

  it("replaces the pending maximum with the Worker's exact smaller i64 ACK", () => {
    const instance = coordinator();
    const reservation = instance.reserveCrossRealm(request(BigInt(8), BigInt(2)));
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;
    expect(instance.activeResidentPages).toBe(BigInt(8));

    expect(instance.acknowledgeCrossRealmReservation(
      reservation.token,
      acknowledgement(reservation.token, BigInt(2)),
    )).toEqual({
      ok: true,
      status: "acknowledged",
      reservationId: reservation.token.reservationId,
      workload: "brush",
      runtime: "memory64",
      residentBytes: BigInt(2) * PAGE,
      residentPages: BigInt(2),
      authority: "main-realm-memory64-workload-coordinator",
    });
    expect(instance.activeResidentPages).toBe(BigInt(2));
    expect(instance.activeResidentBytes).toBe(BigInt(2) * PAGE);
    expect(reservation.release()).toBe(true);
  });

  it("aggregates a main-realm lease with the Worker's acknowledged resident pages", () => {
    const instance = new Memory64WorkloadCoordinator({
      capabilityProbe: () => capability(),
      crossRealmNonceFactory: nonceFactory(),
      allocationPort: {
        allocate: (allocation) => fakeRuntime(
          allocation.addressType,
          allocation.runtime,
          allocation.initialPages,
        ),
      },
    });
    const local = instance.coordinate(request(BigInt(4), BigInt(2), BigInt(8)));
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const worker = instance.reserveCrossRealm(
      request(BigInt(4), BigInt(2), BigInt(8)),
    );
    expect(worker.ok).toBe(true);
    if (!worker.ok) return;
    expect(instance.activeResidentPages).toBe(BigInt(8));

    expect(instance.acknowledgeCrossRealmReservation(
      worker.token,
      acknowledgement(worker.token, BigInt(2)),
    )).toMatchObject({ ok: true, residentPages: BigInt(2) });
    expect(instance.activeLeaseCount).toBe(2);
    expect(instance.activeResidentPages).toBe(BigInt(6));
    expect(instance.activeResidentBytes).toBe(BigInt(6) * PAGE);

    expect(worker.release()).toBe(true);
    expect(instance.activeResidentPages).toBe(BigInt(4));
    expect(local.lease.release()).toBe(true);
    expect(instance.activeResidentPages).toBe(BigInt(0));
  });

  it("admits an 8 GiB OPFS/CAS logical stream through a tiny resident token", () => {
    const instance = coordinator();
    const reservation = instance.reserveCrossRealm({
      ...request(BigInt(8), BigInt(2), BigInt(32)),
      logicalByteLength: BigInt(8) * BigInt(1_024) ** BigInt(3),
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;
    expect(reservation.plan).toMatchObject({
      logicalByteLength: BigInt(8) * BigInt(1_024) ** BigInt(3),
      workingSetPages: BigInt(8),
      workingSetBytes: BigInt(8) * PAGE,
      readsCanonicalProjectBytes: false,
      materializesWholeDocument: false,
      materializesWholeJson: false,
    });
    expect(reservation.token.source).toEqual(SOURCE);
    expect(BigInt(reservation.token.authorizedResidentBytes))
      .toBeLessThan(BigInt(256) * BigInt(1_024) ** BigInt(2));
    expect(instance.acknowledgeCrossRealmReservation(
      reservation.token,
      acknowledgement(reservation.token, BigInt(2)),
    )).toMatchObject({
      ok: true,
      runtime: "memory64",
      residentPages: BigInt(2),
    });
    expect(reservation.release()).toBe(true);
  });

  it("makes an exact Memory32 reference selection explicit in the reservation receipt", () => {
    const instance = coordinator({ selectedRuntime: "memory32-requested" });
    const reservation = instance.reserveCrossRealm(request(BigInt(4), BigInt(1)));
    expect(reservation).toMatchObject({
      ok: true,
      status: "reserved",
      selectedRuntime: "memory32-requested",
      plan: {
        status: "ready",
        runtime: "memory32-requested",
        addressType: "i32",
      },
      token: {
        selectedRuntime: "memory32-requested",
      },
      opfsSpill: {
        authority: "opfs-cas-paging",
        access: "paged-range-only",
      },
    });
    if (reservation.ok) reservation.release();
  });

  it("fails closed for forged, oversized, duplicate and stale token traffic", () => {
    const instance = coordinator();
    const first = instance.reserveCrossRealm(request(BigInt(4), BigInt(1)));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const forged = {
      ...first.token,
      authorizedResidentPages: "3",
      authorizedResidentBytes: (BigInt(3) * PAGE).toString(),
    };
    expect(instance.acknowledgeCrossRealmReservation(
      forged,
      acknowledgement(first.token),
    )).toEqual({ ok: false, status: "rejected", reason: "forged-token" });
    expect(instance.activeCrossRealmReservationCount).toBe(1);

    expect(instance.acknowledgeCrossRealmReservation(first.token, {
      ...acknowledgement(first.token),
      residentPages: "5",
      residentBytes: (BigInt(5) * PAGE).toString(),
    })).toEqual({ ok: false, status: "rejected", reason: "invalid-ack" });
    expect(instance.activeCrossRealmReservationCount).toBe(0);

    const second = instance.reserveCrossRealm(request());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const ack = acknowledgement(second.token);
    expect(instance.acknowledgeCrossRealmReservation(second.token, ack).ok).toBe(true);
    expect(instance.acknowledgeCrossRealmReservation(second.token, ack)).toEqual({
      ok: false,
      status: "rejected",
      reason: "duplicate-ack",
    });
    expect(instance.activeCrossRealmReservationCount).toBe(0);
    expect(instance.acknowledgeCrossRealmReservation(second.token, ack)).toEqual({
      ok: false,
      status: "rejected",
      reason: "stale-token",
    });
    expect(instance.releaseCrossRealmReservation(
      createMemory64CrossRealmRelease(second.token),
    )).toBe(false);
  });

  it("expires an unacknowledged Worker without touching an acknowledged lease", () => {
    let now = 1_000;
    const instance = coordinator({ now: () => now, timeoutMs: 10 });
    const expired = instance.reserveCrossRealm(request());
    const live = instance.reserveCrossRealm(request());
    expect(expired.ok && live.ok).toBe(true);
    if (!expired.ok || !live.ok) return;
    expect(instance.acknowledgeCrossRealmReservation(
      live.token,
      acknowledgement(live.token),
    ).ok).toBe(true);
    now = 1_011;
    expect(instance.expireCrossRealmReservations()).toBe(1);
    expect(instance.activeCrossRealmReservationCount).toBe(1);
    expect(instance.acknowledgeCrossRealmReservation(
      expired.token,
      acknowledgement(expired.token),
    )).toEqual({ ok: false, status: "rejected", reason: "stale-token" });
    expect(live.release()).toBe(true);
    expect(instance.activeResidentPages).toBe(BigInt(0));
  });

  it("round-trips tokens through JSON but rejects unknown fields", () => {
    const instance = coordinator();
    const reservation = instance.reserveCrossRealm(request());
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;
    expect(snapshotMemory64CrossRealmReservationToken(
      JSON.parse(JSON.stringify(reservation.token)),
    )).toEqual(reservation.token);
    expect(snapshotMemory64CrossRealmReservationToken({
      ...reservation.token,
      canonicalPayload: { project: "forbidden" },
    })).toBeNull();
    expect(snapshotMemory64CrossRealmReservationToken({
      ...reservation.token,
      preferredRuntime: "memory64",
    })).toBeNull();
    reservation.release();
  });

  it("fails closed after smaller i64 windows without attempting Memory32", () => {
    const instance = coordinator();
    const reservation = instance.reserveCrossRealm(request(BigInt(8), BigInt(2)));
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;
    const allocate = vi.fn((input: Readonly<{
      runtime: "memory64" | "memory32-requested";
      addressType: "i64" | "i32";
      pages: bigint;
    }>) => {
      throw new RangeError(`deny ${input.runtime} window`);
    });
    const release = vi.fn();
    expect(() => allocateMemory64CrossRealmWorkerLease({
      token: reservation.token,
      requiredResidentBytes: BigInt(2) * PAGE,
      allocationPort: { allocate, release },
    })).toThrow(/selected memory64 window/u);
    expect(allocate.mock.calls.map(([input]) => ({
      runtime: input.runtime,
      pages: input.pages,
    }))).toEqual([
      { runtime: "memory64", pages: BigInt(8) },
      { runtime: "memory64", pages: BigInt(4) },
      { runtime: "memory64", pages: BigInt(2) },
    ]);
    expect(release).not.toHaveBeenCalled();
    expect(reservation.release()).toBe(true);
  });

  it("allocates Memory32 only when its exact reference provider was preselected", () => {
    const instance = coordinator({ selectedRuntime: "memory32-requested" });
    const reservation = instance.reserveCrossRealm(request(BigInt(8), BigInt(2)));
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;
    const allocate = vi.fn((input) => (
      fakeRuntime(input.addressType, input.runtime, input.pages)
    ));
    const release = vi.fn();

    const workerLease = allocateMemory64CrossRealmWorkerLease({
      token: reservation.token,
      requiredResidentBytes: BigInt(2) * PAGE,
      allocationPort: { allocate, release },
    });

    expect(allocate).toHaveBeenCalledTimes(1);
    expect(allocate).toHaveBeenCalledWith({
      runtime: "memory32-requested",
      addressType: "i32",
      pages: BigInt(8),
    });
    expect(workerLease.acknowledgement).toMatchObject({
      runtime: "memory32-requested",
      addressType: "i32",
      residentPages: "8",
    });
    expect(instance.acknowledgeCrossRealmReservation(
      reservation.token,
      workerLease.acknowledgement,
    ).ok).toBe(true);
    expect(workerLease.release()).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(reservation.release()).toBe(true);
  });
});
