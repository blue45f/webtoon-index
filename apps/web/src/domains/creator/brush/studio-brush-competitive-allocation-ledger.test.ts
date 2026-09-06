import { describe, expect, it } from "vitest";

import {
  createStudioBrushCompetitiveAllocationLedger,
  type StudioBrushCompetitiveAllocationInput,
  type StudioBrushCompetitiveWorkInput,
} from "./studio-brush-competitive-allocation-ledger";

function allocation(
  overrides: Partial<StudioBrushCompetitiveAllocationInput> = {},
): StudioBrushCompetitiveAllocationInput {
  return {
    allocationId: "stroke-1/source/main",
    sharedAllocationId: "backing/source-1",
    scopeId: "project-1/page-1/stroke-1",
    ownerId: "live-journal",
    category: "source",
    state: "resident",
    residentBytes: 8_192,
    logicalBytes: 8_192,
    transientBytes: 0,
    count: 1,
    ...overrides,
  };
}

function work(
  overrides: Partial<StudioBrushCompetitiveWorkInput> = {},
): StudioBrushCompetitiveWorkInput {
  return {
    ownerId: "dynamic-live",
    scopeId: "project-1/page-1/stroke-1",
    samples: 8,
    marks: 14,
    contours: 73,
    hashBytes: 1_024,
    clearCalls: 1,
    clearPixelArea: 16_384,
    drawImageCalls: 1,
    drawImagePixelArea: 16_384,
    getImageDataCalls: 0,
    getImageDataPixelArea: 0,
    putImageDataCalls: 0,
    putImageDataPixelArea: 0,
    mainThreadGetImageDataCalls: 0,
    mainThreadPutImageDataCalls: 0,
    ...overrides,
  };
}

describe("studio brush competitive physical allocation ledger", () => {
  it("charges one physical backing exactly once while primitive aliases change ownership", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    expect(ledger.upsertAllocation(allocation()).status).toBe("accepted");
    expect(ledger.upsertAllocation(allocation({
      allocationId: "stroke-1/source/worker-view",
    })).status).toBe("accepted");

    const aliased = ledger.snapshot(100);
    expect(aliased).toMatchObject({
      physicalAllocationCount: 1,
      aliasCount: 1,
      residentBytes: 8_192,
      logicalBytes: 8_192,
      transientBytes: 0,
    });
    expect(aliased.categories.source).toEqual({
      count: 1,
      residentBytes: 8_192,
      logicalBytes: 8_192,
      transientBytes: 0,
    });
    expect(aliased.physicalAllocations).toEqual([{
      sharedAllocationId: "backing/source-1",
      scopeId: "project-1/page-1/stroke-1",
      ownerId: "live-journal",
      category: "source",
      state: "resident",
      aliasCount: 2,
      count: 1,
      residentBytes: 8_192,
      logicalBytes: 8_192,
      transientBytes: 0,
    }]);

    expect(ledger.releaseAllocation("stroke-1/source/main").status).toBe("accepted");
    expect(ledger.snapshot(101)).toMatchObject({
      physicalAllocationCount: 1,
      aliasCount: 0,
      residentBytes: 8_192,
    });
    expect(ledger.releaseAllocation("stroke-1/source/worker-view").status).toBe("accepted");
    expect(ledger.snapshot(102)).toMatchObject({
      physicalAllocationCount: 0,
      residentBytes: 0,
      logicalBytes: 0,
    });
  });

  it("rejects contradictory shared-backing claims atomically", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    expect(ledger.upsertAllocation(allocation()).status).toBe("accepted");
    const before = ledger.snapshot(0);
    expect(ledger.upsertAllocation(allocation({
      allocationId: "stroke-1/source/forged-view",
      residentBytes: 16_384,
    }))).toEqual({
      status: "rejected",
      reason: "shared-allocation-mismatch",
      revision: before.revision,
    });
    expect(ledger.snapshot(1)).toEqual({ ...before });
    expect(ledger.upsertAllocation(allocation({
      allocationId: "stroke-1/source/foreign-owner",
      ownerId: "unreleased-second-owner",
    }))).toEqual({
      status: "rejected",
      reason: "shared-allocation-mismatch",
      revision: before.revision,
    });
    expect(ledger.upsertAllocation(allocation({
      allocationId: "stroke-1/source/overflow",
      sharedAllocationId: "backing/source-overflow",
      residentBytes: Number.MAX_SAFE_INTEGER,
    }))).toEqual({
      status: "rejected",
      reason: "invalid-input",
      revision: before.revision,
    });
  });

  it("uses own data descriptors without invoking hostile accessors", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    let getterCalls = 0;
    const hostile = {
      ...allocation(),
      get residentBytes() {
        getterCalls += 1;
        throw new Error("must not run");
      },
    };
    expect(ledger.upsertAllocation(
      hostile as unknown as StudioBrushCompetitiveAllocationInput,
    )).toEqual({
      status: "rejected",
      reason: "invalid-input",
      revision: 0,
    });
    expect(getterCalls).toBe(0);
    expect(ledger.snapshot(0).physicalAllocationCount).toBe(0);
  });

  it("tracks bounded queue age, backpressure and CAS spill without payload references", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    expect(ledger.setQueue({
      queueId: "handoff-failed",
      scopeId: "project-1/page-1",
      ownerId: "handoff-coordinator",
      count: 17,
      bytes: 196_608,
      oldestEnqueuedAtMilliseconds: 1_000,
      backpressure: "waiting",
      spill: "cas",
    }).status).toBe("accepted");
    expect(ledger.snapshot(31_500)).toMatchObject({
      queueCount: 17,
      queueBytes: 196_608,
      oldestQueueAgeMilliseconds: 30_500,
      backpressuredQueueCount: 1,
      spilledQueueCount: 1,
    });
    expect(ledger.snapshot(31_500).queues).toEqual([expect.objectContaining({
      queueId: "handoff-failed",
      ageMilliseconds: 30_500,
      spill: "cas",
    })]);
    expect(ledger.releaseQueue("handoff-failed").status).toBe("accepted");
    expect(ledger.snapshot(31_501)).toMatchObject({
      queueCount: 0,
      queueBytes: 0,
      oldestQueueAgeMilliseconds: 0,
    });
  });

  it("adds primitive work counters and exposes forbidden main-thread readbacks", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    expect(ledger.addWork(work()).status).toBe("accepted");
    expect(ledger.addWork(work({
      samples: 32,
      marks: 50,
      contours: 200,
      mainThreadGetImageDataCalls: 1,
      getImageDataCalls: 1,
      getImageDataPixelArea: 65_536,
    })).status).toBe("accepted");
    const snapshot = ledger.snapshot(0);
    expect(snapshot.work).toEqual([expect.objectContaining({
      ownerId: "dynamic-live",
      samples: 40,
      marks: 64,
      contours: 273,
      clearCalls: 2,
      drawImageCalls: 2,
      getImageDataCalls: 1,
      mainThreadGetImageDataCalls: 1,
    })]);
    expect(snapshot.mainThreadGetImageDataCalls).toBe(1);
    expect(snapshot.mainThreadPutImageDataCalls).toBe(0);
  });

  it("releases every allocation, queue and work counter in an editor scope", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    const scopeId = "project-1/page-1/stroke-1";
    expect(ledger.upsertAllocation(allocation({ scopeId })).status).toBe("accepted");
    expect(ledger.setQueue({
      queueId: "dry-frame-queue",
      scopeId,
      ownerId: "dry-worker-client",
      count: 2,
      bytes: 128_000,
      oldestEnqueuedAtMilliseconds: 1,
      backpressure: "none",
      spill: "none",
    }).status).toBe("accepted");
    expect(ledger.addWork(work({ scopeId })).status).toBe("accepted");

    expect(ledger.releaseScope(scopeId)).toEqual({
      status: "accepted",
      releasedAllocationCount: 1,
      releasedQueueCount: 1,
      releasedWorkOwnerCount: 1,
      revision: 4,
    });
    const released = ledger.snapshot(2);
    expect(released.physicalAllocationCount).toBe(0);
    expect(released.queueCount).toBe(0);
    expect(released.work).toEqual([]);
  });

  it("snapshots input values rather than retaining or observing later input mutation", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    const mutable = allocation();
    expect(ledger.upsertAllocation(mutable).status).toBe("accepted");
    (mutable as { residentBytes: number }).residentBytes = 99_999;
    (mutable as { ownerId: string }).ownerId = "changed-owner";
    expect(ledger.snapshot(0)).toMatchObject({ residentBytes: 8_192 });
  });

  it("accounts 8k long-session allocations without shared-id scans or double charging", () => {
    const ledger = createStudioBrushCompetitiveAllocationLedger();
    for (let ordinal = 0; ordinal < 8_000; ordinal += 1) {
      expect(ledger.upsertAllocation(allocation({
        allocationId: `stroke-${ordinal}/geometry`,
        sharedAllocationId: `backing/geometry-${ordinal}`,
        scopeId: "project-1/page-long-session",
        ownerId: "committed-geometry",
        category: "geometry",
        residentBytes: 64,
        logicalBytes: 1_024,
      })).status).toBe("accepted");
    }
    const snapshot = ledger.snapshot(0);
    expect(snapshot.physicalAllocationCount).toBe(8_000);
    expect(snapshot.aliasCount).toBe(0);
    expect(snapshot.categories.geometry).toEqual({
      count: 8_000,
      residentBytes: 512_000,
      logicalBytes: 8_192_000,
      transientBytes: 0,
    });
    const released = ledger.releaseScope("project-1/page-long-session");
    expect(released.releasedAllocationCount).toBe(8_000);
    expect(ledger.snapshot(0).residentBytes).toBe(0);
  });
});
