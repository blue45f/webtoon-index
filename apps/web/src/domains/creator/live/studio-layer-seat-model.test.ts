import { describe, expect, it } from "vitest";

import {
  claimStudioLayerSeat,
  createStudioLayerSeatState,
  handoffStudioLayerSeat,
  isStudioLayerSeatLeaseActive,
  leaveStudioLayerSeat,
  pruneExpiredStudioLayerSeatLeases,
  requestStudioLayerSeat,
  studioLayerSeatModeAllowsIntent,
  takeoverStudioLayerSeat,
  validateStudioLayerAssignment,
  validateStudioLayerSeatLease,
  type StudioLayerAssignment,
  type StudioLayerAssignmentMode,
  type StudioLayerSeatIntent,
  type StudioLayerSeatLease,
  type StudioLayerSeatState,
} from "./studio-layer-seat-model";
import { studioLiveLayerResource } from "./studio-live-mutation-guard";

const now = 1_000_000;
const resource = studioLiveLayerResource("p1", "l1");

function assignment(
  overrides: Partial<StudioLayerAssignment> = {}
): StudioLayerAssignment {
  return {
    layerId: "l1",
    assignedUserIds: ["alice"],
    reviewerUserIds: ["rex"],
    status: "assigned",
    mode: "exclusive",
    ...overrides,
  };
}

function seatState(
  overrides: Partial<StudioLayerAssignment> = {},
  extra: Partial<Pick<StudioLayerSeatState, "leases" | "pendingRequests">> = {}
): StudioLayerSeatState {
  const state = createStudioLayerSeatState(assignment(overrides));
  if (!state) throw new Error("fixture assignment must validate");
  return {
    assignment: state.assignment,
    leases: extra.leases ?? state.leases,
    pendingRequests: extra.pendingRequests ?? state.pendingRequests,
  };
}

function lease(overrides: Partial<StudioLayerSeatLease> = {}): StudioLayerSeatLease {
  return {
    resource,
    userId: "alice",
    sessionId: "s-alice",
    leaseId: "lease-1",
    intent: "paint",
    acquiredAt: now - 1_000,
    leaseUntil: now + 10_000,
    ...overrides,
  };
}

function claim(
  state: StudioLayerSeatState,
  overrides: Partial<Parameters<typeof claimStudioLayerSeat>[0]> = {}
) {
  return claimStudioLayerSeat({
    state,
    resource,
    userId: "alice",
    sessionId: "s-alice",
    leaseId: "lease-1",
    intent: "paint",
    now,
    leaseDurationMs: 30_000,
    ...overrides,
  });
}

describe("studio layer seat model — validation (fail closed)", () => {
  it("accepts a well-formed assignment, normalizing and freezing it", () => {
    const validated = validateStudioLayerAssignment(
      assignment({ assignedUserIds: [" alice ", "alice", "bob"] })
    );
    expect(validated).not.toBeNull();
    expect(validated?.assignedUserIds).toEqual(["alice", "bob"]);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated?.assignedUserIds)).toBe(true);
  });

  it("rejects malformed assignments", () => {
    expect(validateStudioLayerAssignment(null)).toBeNull();
    expect(validateStudioLayerAssignment("layer")).toBeNull();
    expect(validateStudioLayerAssignment(assignment({ layerId: "  " }))).toBeNull();
    expect(
      validateStudioLayerAssignment({ ...assignment(), status: "done" as never })
    ).toBeNull();
    expect(
      validateStudioLayerAssignment({ ...assignment(), mode: "open" as never })
    ).toBeNull();
    expect(
      validateStudioLayerAssignment({ ...assignment(), assignedUserIds: ["a", ""] })
    ).toBeNull();
    expect(
      validateStudioLayerAssignment({ ...assignment(), reviewerUserIds: [42] as never })
    ).toBeNull();
    expect(
      validateStudioLayerAssignment({ ...assignment(), assignedUserIds: "alice" as never })
    ).toBeNull();
  });

  it("accepts a well-formed lease and rejects malformed ones", () => {
    expect(validateStudioLayerSeatLease(lease())).toEqual(lease());
    expect(validateStudioLayerSeatLease(null)).toBeNull();
    // Resource must parse as the first-class layer grammar.
    expect(validateStudioLayerSeatLease(lease({ resource: "page:p1" }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ resource: "element:p1:e1" }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ resource: "layer:p1:" }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ userId: " " }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ sessionId: "" }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ leaseId: "" }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ intent: "smudge" as never }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ acquiredAt: Number.NaN }))).toBeNull();
    expect(validateStudioLayerSeatLease(lease({ leaseUntil: Number.POSITIVE_INFINITY }))).toBeNull();
    // Time window must be coherent.
    expect(
      validateStudioLayerSeatLease(lease({ acquiredAt: now, leaseUntil: now }))
    ).toBeNull();
  });

  it("createStudioLayerSeatState fails closed on invalid assignments", () => {
    expect(createStudioLayerSeatState(assignment({ layerId: "" }))).toBeNull();
    const state = createStudioLayerSeatState(assignment());
    expect(state?.leases).toEqual([]);
    expect(state?.pendingRequests).toEqual([]);
    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe("studio layer seat model — mode/intent matrix", () => {
  it("gates every mode × intent combination exhaustively", () => {
    const expected: Record<StudioLayerAssignmentMode, readonly StudioLayerSeatIntent[]> = {
      exclusive: ["paint", "erase", "transform", "text", "filter", "merge"],
      "shared-strokes": ["paint", "erase"],
      "shared-elements": ["transform", "text"],
      "review-only": [],
    };
    for (const mode of Object.keys(expected) as StudioLayerAssignmentMode[]) {
      for (const intent of [
        "paint",
        "erase",
        "transform",
        "text",
        "filter",
        "merge",
      ] as const) {
        expect(studioLayerSeatModeAllowsIntent(mode, intent)).toBe(
          expected[mode].includes(intent)
        );
      }
    }
  });
});

describe("studio layer seat model — lease expiry", () => {
  it("treats the boundary and non-finite windows as expired", () => {
    expect(isStudioLayerSeatLeaseActive({ leaseUntil: now + 1 }, now)).toBe(true);
    expect(isStudioLayerSeatLeaseActive({ leaseUntil: now }, now)).toBe(false);
    expect(isStudioLayerSeatLeaseActive({ leaseUntil: Number.NaN }, now)).toBe(false);
  });

  it("prunes only expired leases", () => {
    const active = lease({ leaseId: "keep" });
    const expired = lease({ leaseId: "drop", leaseUntil: now - 1 });
    expect(pruneExpiredStudioLayerSeatLeases([active, expired], now)).toEqual([active]);
  });
});

describe("studio layer seat model — claim", () => {
  it("seats an assigned user and promotes assigned → in-progress", () => {
    const result = claim(seatState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lease).toMatchObject({
      resource,
      userId: "alice",
      sessionId: "s-alice",
      intent: "paint",
      acquiredAt: now,
      leaseUntil: now + 30_000,
    });
    expect(result.state.assignment.status).toBe("in-progress");
    expect(result.state.leases).toHaveLength(1);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.leases)).toBe(true);
  });

  it("keeps in-progress/review statuses untouched on claim", () => {
    const inProgress = claim(seatState({ status: "in-progress" }));
    expect(inProgress.ok && inProgress.state.assignment.status).toBe("in-progress");
    const review = claim(seatState({ status: "review" }), {
      userId: "rex",
      sessionId: "s-rex",
    });
    expect(review.ok && review.state.assignment.status).toBe("review");
  });

  it("re-claim by the same session replaces its lease instead of stacking", () => {
    const first = claim(seatState({ status: "in-progress" }));
    if (!first.ok) throw new Error("fixture claim must succeed");
    const renewed = claim(first.state, { leaseId: "lease-2", intent: "erase", now: now + 5_000 });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.state.leases).toHaveLength(1);
    expect(renewed.state.leases[0]).toMatchObject({ leaseId: "lease-2", intent: "erase" });
  });

  it("exclusive mode denies while another session holds an active seat", () => {
    const occupied = seatState({ status: "in-progress", assignedUserIds: ["alice", "bob"] }, {
      leases: [lease({ userId: "bob", sessionId: "s-bob", leaseId: "lease-bob" })],
    });
    const result = claim(occupied);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("seat-occupied");
  });

  it("an expired peer lease no longer blocks an exclusive claim", () => {
    const stale = seatState({ status: "in-progress", assignedUserIds: ["alice", "bob"] }, {
      leases: [
        lease({ userId: "bob", sessionId: "s-bob", leaseId: "lease-bob", leaseUntil: now - 1 }),
      ],
    });
    const result = claim(stale);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.leases).toHaveLength(1);
  });

  it("shared-strokes admits concurrent stroke seats but denies element/structural intents", () => {
    const base = seatState({
      status: "in-progress",
      mode: "shared-strokes",
      assignedUserIds: ["alice", "bob"],
    });
    const first = claim(base);
    if (!first.ok) throw new Error("fixture claim must succeed");
    const second = claim(first.state, {
      userId: "bob",
      sessionId: "s-bob",
      leaseId: "lease-bob",
      intent: "erase",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.state.leases).toHaveLength(2);
    const transform = claim(first.state, {
      userId: "bob",
      sessionId: "s-bob",
      leaseId: "lease-bob2",
      intent: "transform",
    });
    expect(transform.ok).toBe(false);
    if (!transform.ok) expect(transform.code).toBe("mode-denies-intent");
    const merge = claim(first.state, {
      userId: "bob",
      sessionId: "s-bob",
      leaseId: "lease-bob3",
      intent: "merge",
    });
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.code).toBe("mode-denies-intent");
  });

  it("shared-elements admits transform/text and denies strokes", () => {
    const base = seatState({ status: "in-progress", mode: "shared-elements" });
    const transform = claim(base, { intent: "transform" });
    expect(transform.ok).toBe(true);
    const paint = claim(base, { intent: "paint" });
    expect(paint.ok).toBe(false);
    if (!paint.ok) expect(paint.code).toBe("mode-denies-intent");
  });

  it("review-only mode denies every mutating seat intent", () => {
    for (const intent of [
      "paint",
      "erase",
      "transform",
      "text",
      "filter",
      "merge",
    ] as const) {
      const result = claim(seatState({ status: "in-progress", mode: "review-only" }), { intent });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("mode-denies-intent");
    }
  });

  it("enforces workflow-status role gates", () => {
    const unassigned = claim(seatState({ status: "unassigned", assignedUserIds: [] }));
    expect(unassigned.ok).toBe(false);
    if (!unassigned.ok) expect(unassigned.code).toBe("not-assigned");

    const outsider = claim(seatState(), { userId: "mallory", sessionId: "s-mallory" });
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.code).toBe("not-assigned");

    // Review: reviewers only — even the assignee is denied.
    const assigneeInReview = claim(seatState({ status: "review" }));
    expect(assigneeInReview.ok).toBe(false);
    if (!assigneeInReview.ok) expect(assigneeInReview.code).toBe("not-reviewer");
    const reviewer = claim(seatState({ status: "review" }), {
      userId: "rex",
      sessionId: "s-rex",
    });
    expect(reviewer.ok).toBe(true);

    const approved = claim(seatState({ status: "approved" }));
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.code).toBe("wrong-status");
  });

  it("fails closed on malformed claim input", () => {
    expect(claim(seatState(), { leaseId: " " }).ok).toBe(false);
    expect(claim(seatState(), { sessionId: "" }).ok).toBe(false);
    expect(claim(seatState(), { now: Number.NaN }).ok).toBe(false);
    expect(claim(seatState(), { leaseDurationMs: 0 }).ok).toBe(false);
    expect(claim(seatState(), { leaseDurationMs: -5 }).ok).toBe(false);
    expect(claim(seatState(), { intent: "smudge" as never }).ok).toBe(false);
    const corrupt = claim({
      ...seatState(),
      assignment: { ...assignment(), status: "done" as never },
    });
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.code).toBe("invalid-input");
  });

  it("denies resources that do not match this layer's lock grammar", () => {
    const wrongLayer = claim(seatState(), {
      resource: studioLiveLayerResource("p1", "l9"),
    });
    expect(wrongLayer.ok).toBe(false);
    if (!wrongLayer.ok) expect(wrongLayer.code).toBe("layer-mismatch");
    const notLayer = claim(seatState(), { resource: "element:p1:e1" });
    expect(notLayer.ok).toBe(false);
    if (!notLayer.ok) expect(notLayer.code).toBe("layer-mismatch");
  });

  it("denies a lease id already used by another session", () => {
    const occupied = seatState(
      { status: "in-progress", mode: "shared-strokes", assignedUserIds: ["alice", "bob"] },
      { leases: [lease({ userId: "bob", sessionId: "s-bob", leaseId: "lease-1" })] }
    );
    const result = claim(occupied);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-input");
  });

  it("consumes the claimant's stale pending request on success", () => {
    const withRequest = seatState({ status: "in-progress" }, {
      pendingRequests: [{ userId: "alice", intent: "paint", requestedAt: now - 100 }],
    });
    const result = claim(withRequest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.pendingRequests).toEqual([]);
  });
});

describe("studio layer seat model — leave", () => {
  it("releases only the owning session's lease", () => {
    const state = seatState({ status: "in-progress" }, { leases: [lease()] });
    const left = leaveStudioLayerSeat({ state, leaseId: "lease-1", sessionId: "s-alice", now });
    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.state.leases).toEqual([]);
      expect(left.state.assignment.status).toBe("in-progress");
    }

    const stranger = leaveStudioLayerSeat({
      state,
      leaseId: "lease-1",
      sessionId: "s-mallory",
      now,
    });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.code).toBe("not-lease-owner");

    const missing = leaveStudioLayerSeat({ state, leaseId: "nope", sessionId: "s-alice", now });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("lease-not-found");

    expect(leaveStudioLayerSeat({ state, leaseId: "", sessionId: "s-alice", now }).ok).toBe(false);
  });

  it("prunes other expired leases while leaving", () => {
    const state = seatState({ status: "in-progress" }, {
      leases: [
        lease(),
        lease({ userId: "bob", sessionId: "s-bob", leaseId: "lease-bob", leaseUntil: now - 1 }),
      ],
    });
    const left = leaveStudioLayerSeat({ state, leaseId: "lease-1", sessionId: "s-alice", now });
    expect(left.ok).toBe(true);
    if (left.ok) expect(left.state.leases).toEqual([]);
  });
});

describe("studio layer seat model — request", () => {
  it("queues an outsider's petition once", () => {
    const first = requestStudioLayerSeat({
      state: seatState(),
      userId: "carol",
      intent: "paint",
      now,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.pendingRequests).toEqual([
      { userId: "carol", intent: "paint", requestedAt: now },
    ]);
    const dup = requestStudioLayerSeat({
      state: first.state,
      userId: "carol",
      intent: "erase",
      now: now + 1,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("duplicate-request");
  });

  it("denies users who can already claim, and malformed petitions", () => {
    const eligible = requestStudioLayerSeat({
      state: seatState(),
      userId: "alice",
      intent: "paint",
      now,
    });
    expect(eligible.ok).toBe(false);
    if (!eligible.ok) expect(eligible.code).toBe("already-eligible");

    expect(
      requestStudioLayerSeat({ state: seatState(), userId: " ", intent: "paint", now }).ok
    ).toBe(false);
    expect(
      requestStudioLayerSeat({
        state: seatState(),
        userId: "carol",
        intent: "smudge" as never,
        now,
      }).ok
    ).toBe(false);
  });

  it("allows petitions against sealed/unassigned layers (reopen requests)", () => {
    const approved = requestStudioLayerSeat({
      state: seatState({ status: "approved" }),
      userId: "alice",
      intent: "paint",
      now,
    });
    expect(approved.ok).toBe(true);
    const unassigned = requestStudioLayerSeat({
      state: seatState({ status: "unassigned", assignedUserIds: [] }),
      userId: "carol",
      intent: "paint",
      now,
    });
    expect(unassigned.ok).toBe(true);
  });
});

describe("studio layer seat model — handoff", () => {
  it("moves the assignment, revokes the giver's leases, and consumes the receiver's request", () => {
    const state = seatState({ status: "in-progress" }, {
      leases: [lease()],
      pendingRequests: [{ userId: "carol", intent: "paint", requestedAt: now - 10 }],
    });
    const result = handoffStudioLayerSeat({
      state,
      fromUserId: "alice",
      toUserId: "carol",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assignment.assignedUserIds).toEqual(["carol"]);
    expect(result.state.assignment.status).toBe("in-progress");
    expect(result.state.leases).toEqual([]);
    expect(result.state.pendingRequests).toEqual([]);
  });

  it("gates handoff to current assignees with coherent input", () => {
    const notAssigned = handoffStudioLayerSeat({
      state: seatState(),
      fromUserId: "mallory",
      toUserId: "carol",
      now,
    });
    expect(notAssigned.ok).toBe(false);
    if (!notAssigned.ok) expect(notAssigned.code).toBe("not-assigned");

    expect(
      handoffStudioLayerSeat({ state: seatState(), fromUserId: "alice", toUserId: "alice", now })
        .ok
    ).toBe(false);
    expect(
      handoffStudioLayerSeat({ state: seatState(), fromUserId: "alice", toUserId: " ", now }).ok
    ).toBe(false);
  });

  it("keeps other assignees seated through a partial handoff", () => {
    const state = seatState(
      { status: "in-progress", assignedUserIds: ["alice", "bob"], mode: "shared-strokes" },
      { leases: [lease({ userId: "bob", sessionId: "s-bob", leaseId: "lease-bob" }), lease()] }
    );
    const result = handoffStudioLayerSeat({
      state,
      fromUserId: "alice",
      toUserId: "carol",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assignment.assignedUserIds).toEqual(["bob", "carol"]);
    expect(result.state.leases.map((entry) => entry.userId)).toEqual(["bob"]);
  });
});

describe("studio layer seat model — takeover", () => {
  it("requires the moderate capability (fail closed)", () => {
    const denied = takeoverStudioLayerSeat({
      state: seatState(),
      byUserId: "mod",
      capabilities: { moderate: false },
      now,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("missing-capability");
    const truthyButNotTrue = takeoverStudioLayerSeat({
      state: seatState(),
      byUserId: "mod",
      capabilities: { moderate: 1 as never },
      now,
    });
    expect(truthyButNotTrue.ok).toBe(false);
    if (!truthyButNotTrue.ok) expect(truthyButNotTrue.code).toBe("missing-capability");
  });

  it("seizes the seat: clears leases, reassigns, and reopens as in-progress", () => {
    const state = seatState({ status: "approved" }, {
      leases: [lease()],
      pendingRequests: [{ userId: "mod", intent: "merge", requestedAt: now - 5 }],
    });
    const result = takeoverStudioLayerSeat({
      state,
      byUserId: "mod",
      capabilities: { moderate: true },
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assignment.assignedUserIds).toEqual(["mod"]);
    expect(result.state.assignment.reviewerUserIds).toEqual(["rex"]);
    expect(result.state.assignment.status).toBe("in-progress");
    expect(result.state.leases).toEqual([]);
    expect(result.state.pendingRequests).toEqual([]);
    expect(Object.isFrozen(result.state)).toBe(true);
  });

  it("fails closed on malformed takeover input", () => {
    expect(
      takeoverStudioLayerSeat({
        state: seatState(),
        byUserId: " ",
        capabilities: { moderate: true },
        now,
      }).ok
    ).toBe(false);
    expect(
      takeoverStudioLayerSeat({
        state: { ...seatState(), assignment: { ...assignment(), mode: "open" as never } },
        byUserId: "mod",
        capabilities: { moderate: true },
        now,
      }).ok
    ).toBe(false);
  });
});
