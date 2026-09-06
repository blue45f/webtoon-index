import { describe, expect, it } from "vitest";

import {
  createStudioCommittedInkSurfaceHandoff,
  sumStudioCommittedInkHandoffSurfaceCounts,
  transitionStudioCommittedInkHandoffHead,
  type CreateStudioCommittedInkSurfaceHandoffInput,
  type StudioCommittedInkAuthorityEvidence,
  type StudioCommittedInkHandoffTransitionResult,
  type StudioCommittedInkStrokeReparentEvidence,
  type StudioCommittedInkSurfaceCounts,
  type StudioCommittedInkSurfaceHandoff,
} from "./studio-committed-ink-handoff-coordinator";

const PAGE_A = "page-a";
const PAGE_B = "page-b";

function handoff(
  overrides: Partial<CreateStudioCommittedInkSurfaceHandoffInput> = {}
): StudioCommittedInkSurfaceHandoff {
  return createStudioCommittedInkSurfaceHandoff({
    pageId: PAGE_A,
    strokeIds: ["stroke-a"],
    overlaySettledCount: 1,
    draftSettledCount: 2,
    gpuSettledCount: 3,
    queuedRevision: 10,
    ...overrides,
  });
}

interface AuthorityFixture {
  readonly revision?: number;
  readonly visiblePageId?: string | null;
  readonly pageIds?: readonly string[];
  readonly strokePageIds?: Readonly<Record<string, string>>;
  readonly pageTombstoneIds?: readonly string[];
  readonly strokeTombstoneIds?: readonly string[];
  readonly strokeReparents?: Readonly<Record<string, StudioCommittedInkStrokeReparentEvidence>>;
}

function authority(fixture: AuthorityFixture = {}): StudioCommittedInkAuthorityEvidence {
  return {
    revision: fixture.revision ?? 11,
    visiblePageId: fixture.visiblePageId ?? null,
    pageIds: new Set(fixture.pageIds ?? [PAGE_A]),
    strokePageIds: new Map(Object.entries(fixture.strokePageIds ?? {})),
    pageTombstoneIds: new Set(fixture.pageTombstoneIds ?? []),
    strokeTombstoneIds: new Set(fixture.strokeTombstoneIds ?? []),
    strokeReparents: new Map(Object.entries(fixture.strokeReparents ?? {})),
  };
}

function expectExactAccounting(result: StudioCommittedInkHandoffTransitionResult): void {
  const keys = ["overlay", "draft", "gpu"] as const;
  for (const key of keys) {
    expect(result.accounting.queuedBefore[key]).toBe(
      result.accounting.released[key] + result.accounting.queuedAfter[key]
    );
  }
}

function addCounts(
  left: StudioCommittedInkSurfaceCounts,
  right: StudioCommittedInkSurfaceCounts
): StudioCommittedInkSurfaceCounts {
  return {
    overlay: left.overlay + right.overlay,
    draft: left.draft + right.draft,
    gpu: left.gpu + right.gpu,
  };
}

describe("committed ink handoff construction and accounting", () => {
  it("normalizes counts, IDs, and the immutable queued revision", () => {
    expect(createStudioCommittedInkSurfaceHandoff({
      pageId: PAGE_A,
      strokeIds: ["stroke-a", "", "stroke-a", "stroke-b"],
      overlaySettledCount: 2.9,
      draftSettledCount: -4,
      gpuSettledCount: Number.POSITIVE_INFINITY,
      queuedRevision: 7.8,
    })).toEqual({
      pageId: PAGE_A,
      strokeIds: ["stroke-a", "stroke-b"],
      overlaySettledCount: 2,
      draftSettledCount: 0,
      gpuSettledCount: 0,
      queuedRevision: 7,
      missingPasses: 0,
      drawFailures: 0,
      drawAttemptRevision: 7,
    });
  });

  it("returns null for an empty FIFO", () => {
    expect(transitionStudioCommittedInkHandoffHead([], authority())).toBeNull();
  });

  it("sums every independently reserved surface without converting between FIFOs", () => {
    const queue = [
      handoff({ overlaySettledCount: 3, draftSettledCount: 0, gpuSettledCount: 5 }),
      handoff({ overlaySettledCount: 0, draftSettledCount: 7, gpuSettledCount: 2 }),
      handoff({ overlaySettledCount: 11, draftSettledCount: 13, gpuSettledCount: 0 }),
    ];

    expect(sumStudioCommittedInkHandoffSurfaceCounts(queue)).toEqual({
      overlay: 14,
      draft: 20,
      gpu: 7,
    });
  });
});

describe("committed ink handoff FIFO authority", () => {
  it("classifies only the head and leaves an otherwise-ready tail untouched", () => {
    const blocked = handoff({
      strokeIds: ["missing-head"],
      queuedRevision: 4,
      overlaySettledCount: 2,
    });
    const readyTail = {
      ...handoff({
        strokeIds: ["ready-tail"],
        queuedRevision: 4,
        overlaySettledCount: 9,
      }),
      missingPasses: 17,
      drawFailures: 2,
    };
    const queue = [blocked, readyTail];

    const result = transitionStudioCommittedInkHandoffHead(
      queue,
      authority({
        revision: 8,
        strokePageIds: { "ready-tail": PAGE_A },
      })
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "awaiting-authoritative-topology",
      missingStrokeIds: ["missing-head"],
      head: { missingPasses: 4, queuedRevision: 4 },
    });
    expect(result?.queue[1]).toBe(readyTail);
    expect(result?.queue[1]).toMatchObject({ missingPasses: 17, drawFailures: 2 });
    expect(result?.accounting.released).toEqual({ overlay: 0, draft: 0, gpu: 0 });
    if (result) expectExactAccounting(result);
  });

  it("advances the tail only after authoritative evidence disposes of the head", () => {
    const queue = [
      handoff({ strokeIds: ["old"], queuedRevision: 4 }),
      handoff({ strokeIds: ["new"], queuedRevision: 4 }),
    ];
    const first = transitionStudioCommittedInkHandoffHead(
      queue,
      authority({
        revision: 5,
        strokePageIds: { new: PAGE_A },
        strokeTombstoneIds: ["old"],
      })
    );

    expect(first).toMatchObject({ status: "authoritative-discard" });
    expect(first?.queue).toHaveLength(1);
    const second = transitionStudioCommittedInkHandoffHead(
      first?.queue ?? [],
      authority({ revision: 5, strokePageIds: { new: PAGE_A } })
    );
    expect(second).toMatchObject({ status: "ready", reason: "committed-offscreen" });
    expect(second?.queue).toEqual([]);
  });

  it("accumulates missing passes from queuedRevision once per newer revision", () => {
    const initial = handoff({ queuedRevision: 20, strokeIds: ["lagging"] });
    const atRevision23 = transitionStudioCommittedInkHandoffHead(
      [initial],
      authority({ revision: 23 })
    );
    expect(atRevision23).toMatchObject({
      status: "wait",
      head: { queuedRevision: 20, missingPasses: 3 },
    });

    const repeatedRevision = transitionStudioCommittedInkHandoffHead(
      atRevision23?.queue ?? [],
      authority({ revision: 23 })
    );
    expect(repeatedRevision).toMatchObject({
      status: "wait",
      head: { queuedRevision: 20, missingPasses: 3 },
    });

    const atRevision29 = transitionStudioCommittedInkHandoffHead(
      repeatedRevision?.queue ?? [],
      authority({ revision: 29 })
    );
    expect(atRevision29).toMatchObject({
      status: "wait",
      head: { queuedRevision: 20, missingPasses: 9 },
    });
  });

  it("never turns prolonged absence into an invented tombstone", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ queuedRevision: 1, strokeIds: ["not-projected-yet"] })],
      authority({ revision: 1_001, pageIds: [] })
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "awaiting-authoritative-topology",
      failVisible: true,
      head: { queuedRevision: 1, missingPasses: 1_000 },
    });
    expect(result?.accounting.released).toEqual({ overlay: 0, draft: 0, gpu: 0 });
  });

  it("keeps an unbound empty-stroke surface fail-visible", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: [] })],
      authority({ revision: 99, pageTombstoneIds: [PAGE_A] })
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "empty-stroke-set",
      failVisible: true,
    });
  });
});

describe("committed ink handoff tombstone and reparent evidence", () => {
  it("authoritatively discards a handoff when its page is tombstoned", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["gone-with-page"] })],
      authority({ pageIds: [], pageTombstoneIds: [PAGE_A] })
    );

    expect(result).toMatchObject({
      status: "authoritative-discard",
      reason: "page-tombstoned",
      removedStrokeIds: ["gone-with-page"],
    });
    expect(result?.queue).toEqual([]);
    if (result) expectExactAccounting(result);
  });

  it("lets an explicit stroke tombstone beat stale projected membership", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["deleted"] })],
      authority({
        strokePageIds: { deleted: PAGE_A },
        strokeTombstoneIds: ["deleted"],
      })
    );

    expect(result).toMatchObject({
      status: "authoritative-discard",
      reason: "strokes-tombstoned-or-reparented",
      removedStrokeIds: ["deleted"],
    });
  });

  it("discards an old-page surface from durable offscreen reparent evidence", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["moved"] })],
      authority({
        visiblePageId: PAGE_A,
        pageIds: [PAGE_A, PAGE_B],
        // Deliberately leave the destination projection absent: the durable move is enough to
        // remove the stale source-page surface when the destination is offscreen.
        strokeReparents: {
          moved: { fromPageId: PAGE_A, toPageId: PAGE_B },
        },
      })
    );

    expect(result).toMatchObject({
      status: "authoritative-discard",
      reason: "strokes-tombstoned-or-reparented",
      removedStrokeIds: ["moved"],
    });
  });

  it("waits for a visible reparent destination to enter the projected scene", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["moving-visible"] })],
      authority({
        visiblePageId: PAGE_B,
        pageIds: [PAGE_A, PAGE_B],
        strokeReparents: {
          "moving-visible": { fromPageId: PAGE_A, toPageId: PAGE_B },
        },
      })
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "awaiting-authoritative-topology",
      missingStrokeIds: ["moving-visible"],
      drawReceiptRequired: false,
    });
  });

  it("requires a draw receipt after a reparent materializes on the visible destination", () => {
    const evidence = authority({
      revision: 31,
      visiblePageId: PAGE_B,
      pageIds: [PAGE_A, PAGE_B],
      strokePageIds: { moved: PAGE_B },
      strokeReparents: {
        moved: { fromPageId: PAGE_A, toPageId: PAGE_B },
      },
    });
    const pending = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["moved"] })],
      evidence
    );

    expect(pending).toMatchObject({
      status: "wait",
      reason: "visible-draw-receipt-required",
      drawReceiptRequired: true,
      drawRequest: { pageId: PAGE_B, revision: 31, attempt: 1, strokeIds: ["moved"] },
    });
    const token = pending?.status === "wait" ? pending.drawRequest?.token : undefined;
    expect(token).toBeTypeOf("string");

    const ready = transitionStudioCommittedInkHandoffHead(
      pending?.queue ?? [],
      evidence,
      { drawReceipt: { token: token ?? "", outcome: "drawn" } }
    );
    expect(ready).toMatchObject({
      status: "ready",
      reason: "visible-draw-receipted",
      visibleCommittedStrokeIds: ["moved"],
    });
  });

  it("gives a surviving reparent precedence over a source-page tombstone", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["survivor"] })],
      authority({
        visiblePageId: PAGE_B,
        pageIds: [PAGE_B],
        pageTombstoneIds: [PAGE_A],
        strokePageIds: { survivor: PAGE_B },
        strokeReparents: {
          survivor: { fromPageId: PAGE_A, toPageId: PAGE_B },
        },
      })
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "visible-draw-receipt-required",
      drawReceiptRequired: true,
    });
  });

  it("treats mixed committed and tombstoned strokes as ready rather than total discard", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["kept", "deleted"] })],
      authority({
        strokePageIds: { kept: PAGE_A },
        strokeTombstoneIds: ["deleted"],
      })
    );

    expect(result).toMatchObject({
      status: "ready",
      reason: "committed-offscreen",
      visibleCommittedStrokeIds: [],
    });
  });
});

describe("committed ink handoff visible draw receipts", () => {
  it("requires an exact receipt before releasing a visible committed stroke", () => {
    const queue = [handoff({
      strokeIds: ["visible"],
      overlaySettledCount: 4,
      draftSettledCount: 5,
      gpuSettledCount: 6,
    })];
    const evidence = authority({
      revision: 12,
      visiblePageId: PAGE_A,
      strokePageIds: { visible: PAGE_A },
    });
    const pending = transitionStudioCommittedInkHandoffHead(queue, evidence);

    expect(pending).toMatchObject({
      status: "wait",
      reason: "visible-draw-receipt-required",
      failVisible: true,
      drawReceiptRequired: true,
      drawRequest: {
        pageId: PAGE_A,
        revision: 12,
        attempt: 1,
        strokeIds: ["visible"],
      },
      accounting: {
        released: { overlay: 0, draft: 0, gpu: 0 },
        queuedAfter: { overlay: 4, draft: 5, gpu: 6 },
      },
    });
    if (!pending || pending.status !== "wait" || !pending.drawRequest) {
      throw new Error("expected a visible draw request");
    }

    const ready = transitionStudioCommittedInkHandoffHead(
      pending.queue,
      evidence,
      { drawReceipt: { token: pending.drawRequest.token, outcome: "drawn" } }
    );
    expect(ready).toMatchObject({
      status: "ready",
      reason: "visible-draw-receipted",
      queue: [],
      accounting: {
        released: { overlay: 4, draft: 5, gpu: 6 },
        queuedAfter: { overlay: 0, draft: 0, gpu: 0 },
      },
    });
    if (ready) expectExactAccounting(ready);
  });

  it("ignores a stale or foreign receipt without consuming retry budget", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["visible"] })],
      authority({
        revision: 12,
        visiblePageId: PAGE_A,
        strokePageIds: { visible: PAGE_A },
      }),
      { drawReceipt: { token: "stale-token", outcome: "failed" } }
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "visible-draw-receipt-required",
      ignoredDrawReceipt: true,
      head: { drawFailures: 0, drawAttemptRevision: 12 },
      drawRequest: { attempt: 1 },
    });
  });

  it("bounds draw retries, never discards on failure, and remains fail-visible", () => {
    const evidence = authority({
      revision: 42,
      visiblePageId: PAGE_A,
      strokePageIds: { visible: PAGE_A },
    });
    let queue: readonly StudioCommittedInkSurfaceHandoff[] = [handoff({
      strokeIds: ["visible"],
      overlaySettledCount: 7,
      draftSettledCount: 11,
      gpuSettledCount: 13,
    })];
    let result = transitionStudioCommittedInkHandoffHead(queue, evidence, {
      maxDrawAttempts: 3,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(result).toMatchObject({
        status: "wait",
        drawReceiptRequired: true,
        drawRequest: { attempt },
      });
      if (!result || result.status !== "wait" || !result.drawRequest) {
        throw new Error(`expected draw attempt ${attempt}`);
      }
      queue = result.queue;
      result = transitionStudioCommittedInkHandoffHead(queue, evidence, {
        maxDrawAttempts: 3,
        drawReceipt: { token: result.drawRequest.token, outcome: "failed" },
      });
    }

    expect(result).toMatchObject({
      status: "wait",
      reason: "visible-draw-failed-visible",
      failVisible: true,
      drawReceiptRequired: true,
      drawRequest: null,
      head: { drawFailures: 3, drawAttemptRevision: 42 },
      accounting: {
        released: { overlay: 0, draft: 0, gpu: 0 },
        queuedAfter: { overlay: 7, draft: 11, gpu: 13 },
      },
    });
    expect(result?.queue).toHaveLength(1);
    if (result) expectExactAccounting(result);
  });

  it("opens a fresh bounded draw budget when a newer scene revision can recover", () => {
    const failedHead = {
      ...handoff({ strokeIds: ["visible"] }),
      drawFailures: 3,
      drawAttemptRevision: 42,
    };
    const result = transitionStudioCommittedInkHandoffHead(
      [failedHead],
      authority({
        revision: 43,
        visiblePageId: PAGE_A,
        strokePageIds: { visible: PAGE_A },
      }),
      { maxDrawAttempts: 3 }
    );

    expect(result).toMatchObject({
      status: "wait",
      reason: "visible-draw-receipt-required",
      drawRequest: { revision: 43, attempt: 1 },
      head: { drawFailures: 0, drawAttemptRevision: 43 },
    });
  });

  it("does not require a receipt for a committed stroke on an offscreen page", () => {
    const result = transitionStudioCommittedInkHandoffHead(
      [handoff({ strokeIds: ["hidden"] })],
      authority({
        visiblePageId: PAGE_B,
        pageIds: [PAGE_A, PAGE_B],
        strokePageIds: { hidden: PAGE_A },
      })
    );

    expect(result).toMatchObject({
      status: "ready",
      reason: "committed-offscreen",
      drawReceiptRequired: false,
    });
  });
});

describe("committed ink surface FIFO invariants", () => {
  it("conserves each surface total while draining a long ready FIFO", () => {
    const queue = Array.from({ length: 24 }, (_, index) => handoff({
      pageId: PAGE_A,
      strokeIds: [`stroke-${index}`],
      overlaySettledCount: index % 4,
      draftSettledCount: (index * 3) % 5,
      gpuSettledCount: (index * 7) % 6,
      queuedRevision: index,
    }));
    const initial = sumStudioCommittedInkHandoffSurfaceCounts(queue);
    const strokePageIds = Object.fromEntries(
      queue.map((entry) => [entry.strokeIds[0], PAGE_A])
    );
    const evidence = authority({
      revision: 30,
      visiblePageId: null,
      strokePageIds,
    });
    let remaining: readonly StudioCommittedInkSurfaceHandoff[] = queue;
    let released: StudioCommittedInkSurfaceCounts = { overlay: 0, draft: 0, gpu: 0 };

    while (remaining.length > 0) {
      const result = transitionStudioCommittedInkHandoffHead(remaining, evidence);
      expect(result?.status).toBe("ready");
      if (!result) throw new Error("expected a ready head");
      expectExactAccounting(result);
      released = addCounts(released, result.accounting.released);
      remaining = result.queue;
    }

    expect(released).toEqual(initial);
    expect(sumStudioCommittedInkHandoffSurfaceCounts(remaining)).toEqual({
      overlay: 0,
      draft: 0,
      gpu: 0,
    });
  });

  it("conserves each surface total while draining tombstoned and reparented heads", () => {
    const queue = [
      handoff({
        strokeIds: ["tombstoned"],
        overlaySettledCount: 2,
        draftSettledCount: 3,
        gpuSettledCount: 5,
      }),
      handoff({
        strokeIds: ["reparented"],
        overlaySettledCount: 7,
        draftSettledCount: 11,
        gpuSettledCount: 13,
      }),
    ];
    const initial = sumStudioCommittedInkHandoffSurfaceCounts(queue);
    const evidence = authority({
      visiblePageId: PAGE_A,
      pageIds: [PAGE_A, PAGE_B],
      strokeTombstoneIds: ["tombstoned"],
      strokeReparents: {
        reparented: { fromPageId: PAGE_A, toPageId: PAGE_B },
      },
    });
    let remaining: readonly StudioCommittedInkSurfaceHandoff[] = queue;
    let released: StudioCommittedInkSurfaceCounts = { overlay: 0, draft: 0, gpu: 0 };

    while (remaining.length > 0) {
      const result = transitionStudioCommittedInkHandoffHead(remaining, evidence);
      expect(result?.status).toBe("authoritative-discard");
      if (!result) throw new Error("expected an authoritative discard");
      expectExactAccounting(result);
      released = addCounts(released, result.accounting.released);
      remaining = result.queue;
    }

    expect(released).toEqual(initial);
  });
});
