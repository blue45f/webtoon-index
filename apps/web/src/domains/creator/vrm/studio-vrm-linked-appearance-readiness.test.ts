import { describe, expect, it } from "vitest";

import {
  applyStudioVrmLinkedAppearanceReadinessReceipt,
  createStudioVrmLinkedAppearanceReadiness,
  snapshotStudioVrmLinkedAppearanceReadiness,
} from "./studio-vrm-linked-appearance-readiness";

import type {
  StudioVrmLinkedAppearanceReadinessIdentity,
  StudioVrmLinkedAppearanceReadinessReceipt,
  StudioVrmLinkedAppearanceReadinessState,
} from "./studio-vrm-linked-appearance-readiness";

const IDENTITY: StudioVrmLinkedAppearanceReadinessIdentity = Object.freeze({
  runtimeKey: "character-1:source-hash-a",
  placementHash: "placement-hash-a",
  projectionSignature: "appearance-signature-a",
  generation: 7,
});

function fullState(): StudioVrmLinkedAppearanceReadinessState {
  return createStudioVrmLinkedAppearanceReadiness({
    identity: IDENTITY,
    wardrobe: [
      { slot: "top", itemId: "classic-shirt" },
      { slot: "shoes", itemId: "ankle-boots" },
    ],
    props: [
      { uid: "prop-sword", propId: "long-sword" },
      { uid: "prop-mug", propId: "ceramic-mug" },
    ],
  });
}

function emptyState(): StudioVrmLinkedAppearanceReadinessState {
  return createStudioVrmLinkedAppearanceReadiness({
    identity: IDENTITY,
    wardrobe: [],
    props: [],
  });
}

function receipt<T extends Omit<StudioVrmLinkedAppearanceReadinessReceipt, "identity">>(
  value: T
): T & { readonly identity: StudioVrmLinkedAppearanceReadinessIdentity } {
  return { ...value, identity: IDENTITY };
}

function apply(
  state: StudioVrmLinkedAppearanceReadinessState,
  nextReceipt: StudioVrmLinkedAppearanceReadinessReceipt
) {
  return applyStudioVrmLinkedAppearanceReadinessReceipt(state, nextReceipt);
}

describe("linked VRM appearance readiness", () => {
  it("becomes ready only after every exact attachment, the commit, and a later post-commit frame", () => {
    let state = fullState();
    let snapshot = snapshotStudioVrmLinkedAppearanceReadiness(state);

    expect(snapshot).toMatchObject({
      status: "loading",
      attachmentsComplete: false,
      commitFrame: null,
      postCommitFrame: null,
    });
    expect(snapshot.missing).toEqual({
      wardrobe: [
        { slot: "shoes", itemId: "ankle-boots" },
        { slot: "top", itemId: "classic-shirt" },
      ],
      props: [
        { uid: "prop-mug", propId: "ceramic-mug" },
        { uid: "prop-sword", propId: "long-sword" },
      ],
    });

    state = apply(state, receipt({
      kind: "wardrobe-attached",
      frame: 4,
      slot: "top",
      itemId: "classic-shirt",
    })).state;
    state = apply(state, receipt({
      kind: "prop-attached",
      frame: 4,
      uid: "prop-sword",
      propId: "long-sword",
    })).state;
    state = apply(state, receipt({
      kind: "wardrobe-attached",
      frame: 5,
      slot: "shoes",
      itemId: "ankle-boots",
    })).state;
    state = apply(state, receipt({
      kind: "prop-attached",
      frame: 5,
      uid: "prop-mug",
      propId: "ceramic-mug",
    })).state;

    snapshot = snapshotStudioVrmLinkedAppearanceReadiness(state);
    expect(snapshot.status).toBe("loading");
    expect(snapshot.attachmentsComplete).toBe(true);
    expect(snapshot.missing).toEqual({ wardrobe: [], props: [] });

    const committed = apply(state, receipt({ kind: "runtime-commit", frame: 5 }));
    expect(committed.disposition).toBe("accepted");
    expect(committed.snapshot).toMatchObject({ status: "loading", commitFrame: 5 });

    const painted = apply(committed.state, receipt({ kind: "post-commit", frame: 6 }));
    expect(painted.disposition).toBe("accepted");
    expect(painted.snapshot).toMatchObject({
      status: "ready",
      attachmentsComplete: true,
      commitFrame: 5,
      postCommitFrame: 6,
      failure: null,
    });
    expect(painted.snapshot.received).toEqual(painted.snapshot.expected);
  });

  it("requires commit and post-commit receipts even when the appearance is empty", () => {
    const initial = snapshotStudioVrmLinkedAppearanceReadiness(emptyState());
    expect(initial).toMatchObject({ status: "loading", attachmentsComplete: true });

    const committed = apply(emptyState(), receipt({ kind: "runtime-commit", frame: 0 }));
    expect(committed.snapshot).toMatchObject({ status: "loading", commitFrame: 0 });

    const painted = apply(committed.state, receipt({ kind: "post-commit", frame: 1 }));
    expect(painted.snapshot.status).toBe("ready");
  });

  it("keeps missing attachments loading until a premature commit fails the generation closed", () => {
    let state = fullState();
    state = apply(state, receipt({
      kind: "wardrobe-attached",
      frame: 1,
      slot: "top",
      itemId: "classic-shirt",
    })).state;

    expect(snapshotStudioVrmLinkedAppearanceReadiness(state)).toMatchObject({
      status: "loading",
      missing: {
        wardrobe: [{ slot: "shoes", itemId: "ankle-boots" }],
        props: [
          { uid: "prop-mug", propId: "ceramic-mug" },
          { uid: "prop-sword", propId: "long-sword" },
        ],
      },
    });

    const committed = apply(state, receipt({ kind: "runtime-commit", frame: 1 }));
    expect(committed).toMatchObject({
      disposition: "failed",
      reason: "missing-attachments-before-commit",
      snapshot: {
        status: "unavailable",
        failure: {
          kind: "protocol",
          code: "missing-attachments-before-commit",
          receiptKind: "runtime-commit",
        },
      },
    });
  });

  it.each([
    ["runtimeKey", { runtimeKey: "character-1:source-hash-old" }],
    ["placementHash", { placementHash: "placement-hash-old" }],
    ["projectionSignature", { projectionSignature: "appearance-signature-old" }],
    ["generation", { generation: 6 }],
  ] as const)("ignores a receipt with a mismatched %s", (_label, identityPatch) => {
    const state = emptyState();
    const transition = apply(state, {
      kind: "runtime-commit",
      frame: 0,
      identity: { ...IDENTITY, ...identityPatch },
    });

    expect(transition).toMatchObject({
      disposition: "ignored",
      reason: "identity-mismatch",
      state,
      snapshot: { status: "loading" },
    });
    expect(transition.state).toBe(state);
  });

  it("does not let a stale explicit failure poison the current generation", () => {
    const state = emptyState();
    const transition = apply(state, {
      kind: "failure",
      code: "missing-right-hand",
      identity: { ...IDENTITY, generation: IDENTITY.generation - 1 },
    });

    expect(transition).toMatchObject({
      disposition: "ignored",
      reason: "identity-mismatch",
      snapshot: { status: "loading", failure: null },
    });
  });

  it.each([
    [
      "unexpected wardrobe slot",
      receipt({ kind: "wardrobe-attached", frame: 1, slot: "hat", itemId: "beret" }),
      "unexpected-wardrobe-receipt",
    ],
    [
      "mismatched wardrobe item",
      receipt({ kind: "wardrobe-attached", frame: 1, slot: "top", itemId: "wrong-shirt" }),
      "wardrobe-item-mismatch",
    ],
    [
      "unexpected prop uid",
      receipt({ kind: "prop-attached", frame: 1, uid: "prop-extra", propId: "ceramic-mug" }),
      "unexpected-prop-receipt",
    ],
    [
      "mismatched prop id",
      receipt({ kind: "prop-attached", frame: 1, uid: "prop-mug", propId: "long-sword" }),
      "prop-id-mismatch",
    ],
  ] as const)("fails closed for an %s", (_label, nextReceipt, reason) => {
    const transition = apply(fullState(), nextReceipt);
    expect(transition).toMatchObject({
      disposition: "failed",
      reason,
      snapshot: { status: "unavailable", failure: { kind: "protocol", code: reason } },
    });
  });

  it("rejects duplicate wardrobe receipts", () => {
    const first = apply(fullState(), receipt({
      kind: "wardrobe-attached",
      frame: 2,
      slot: "top",
      itemId: "classic-shirt",
    }));
    const duplicate = apply(first.state, receipt({
      kind: "wardrobe-attached",
      frame: 2,
      slot: "top",
      itemId: "classic-shirt",
    }));

    expect(duplicate).toMatchObject({
      disposition: "failed",
      reason: "duplicate-wardrobe-receipt",
      snapshot: { status: "unavailable" },
    });
  });

  it("rejects duplicate prop receipts while allowing the same prop type under distinct uids", () => {
    let state = createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [],
      props: [
        { uid: "mug-left", propId: "ceramic-mug" },
        { uid: "mug-right", propId: "ceramic-mug" },
      ],
    });
    state = apply(state, receipt({
      kind: "prop-attached",
      frame: 2,
      uid: "mug-left",
      propId: "ceramic-mug",
    })).state;
    state = apply(state, receipt({
      kind: "prop-attached",
      frame: 2,
      uid: "mug-right",
      propId: "ceramic-mug",
    })).state;
    expect(snapshotStudioVrmLinkedAppearanceReadiness(state).attachmentsComplete).toBe(true);

    const duplicate = apply(state, receipt({
      kind: "prop-attached",
      frame: 2,
      uid: "mug-left",
      propId: "ceramic-mug",
    }));
    expect(duplicate).toMatchObject({
      disposition: "failed",
      reason: "duplicate-prop-receipt",
      snapshot: { status: "unavailable" },
    });
  });

  it("rejects attachment and commit frame regressions", () => {
    const wardrobe = apply(fullState(), receipt({
      kind: "wardrobe-attached",
      frame: 3,
      slot: "top",
      itemId: "classic-shirt",
    }));
    const regressedAttachment = apply(wardrobe.state, receipt({
      kind: "prop-attached",
      frame: 2,
      uid: "prop-mug",
      propId: "ceramic-mug",
    }));
    expect(regressedAttachment).toMatchObject({
      disposition: "failed",
      reason: "frame-regression",
      snapshot: { status: "unavailable" },
    });

    const oneWardrobeState = createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [{ slot: "top", itemId: "classic-shirt" }],
      props: [],
    });
    const attached = apply(oneWardrobeState, receipt({
      kind: "wardrobe-attached",
      frame: 3,
      slot: "top",
      itemId: "classic-shirt",
    }));
    const regressedCommit = apply(attached.state, receipt({ kind: "runtime-commit", frame: 2 }));
    expect(regressedCommit).toMatchObject({
      disposition: "failed",
      reason: "frame-regression",
      snapshot: { status: "unavailable" },
    });
  });

  it("permits attachments and commit in one frame but requires post-commit in a later frame", () => {
    const onePropState = createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [],
      props: [{ uid: "prop-mug", propId: "ceramic-mug" }],
    });
    const attached = apply(onePropState, receipt({
      kind: "prop-attached",
      frame: 9,
      uid: "prop-mug",
      propId: "ceramic-mug",
    }));
    const committed = apply(attached.state, receipt({ kind: "runtime-commit", frame: 9 }));
    expect(committed.snapshot.status).toBe("loading");

    const sameFrame = apply(committed.state, receipt({ kind: "post-commit", frame: 9 }));
    expect(sameFrame).toMatchObject({
      disposition: "failed",
      reason: "post-commit-frame-not-after-commit",
      snapshot: { status: "unavailable" },
    });
  });

  it("rejects a post-commit receipt before the runtime commit", () => {
    const transition = apply(emptyState(), receipt({ kind: "post-commit", frame: 1 }));
    expect(transition).toMatchObject({
      disposition: "failed",
      reason: "post-commit-before-commit",
      snapshot: { status: "unavailable" },
    });
  });

  it("rejects an attachment after commit and duplicate commit receipts", () => {
    const committed = apply(emptyState(), receipt({ kind: "runtime-commit", frame: 2 }));
    const lateAttachment = apply(committed.state, receipt({
      kind: "prop-attached",
      frame: 2,
      uid: "late-prop",
      propId: "ceramic-mug",
    }));
    expect(lateAttachment).toMatchObject({
      disposition: "failed",
      reason: "attachment-after-commit",
      snapshot: { status: "unavailable" },
    });

    const duplicateCommit = apply(committed.state, receipt({ kind: "runtime-commit", frame: 2 }));
    expect(duplicateCommit).toMatchObject({
      disposition: "failed",
      reason: "duplicate-commit-receipt",
      snapshot: { status: "unavailable" },
    });
  });

  it("rejects duplicate or later receipts after post-commit instead of preserving a false ready", () => {
    const committed = apply(emptyState(), receipt({ kind: "runtime-commit", frame: 1 }));
    const ready = apply(committed.state, receipt({ kind: "post-commit", frame: 2 }));
    expect(ready.snapshot.status).toBe("ready");

    const duplicatePostCommit = apply(ready.state, receipt({ kind: "post-commit", frame: 3 }));
    expect(duplicatePostCommit).toMatchObject({
      disposition: "failed",
      reason: "duplicate-post-commit-receipt",
      snapshot: { status: "unavailable" },
    });

    const lateCommit = apply(ready.state, receipt({ kind: "runtime-commit", frame: 3 }));
    expect(lateCommit).toMatchObject({
      disposition: "failed",
      reason: "receipt-after-post-commit",
      snapshot: { status: "unavailable" },
    });
  });

  it("turns an explicit current-generation runtime failure into a terminal unavailable snapshot", () => {
    const failed = apply(fullState(), receipt({
      kind: "failure",
      code: "missing-secondary-hand-bone",
      detail: "rightHand could not be resolved",
    }));

    expect(failed).toMatchObject({
      disposition: "failed",
      reason: "runtime-failure",
      snapshot: {
        status: "unavailable",
        failure: {
          kind: "runtime",
          code: "missing-secondary-hand-bone",
          detail: "rightHand could not be resolved",
        },
      },
    });

    const later = apply(failed.state, receipt({
      kind: "wardrobe-attached",
      frame: 1,
      slot: "top",
      itemId: "classic-shirt",
    }));
    expect(later).toMatchObject({
      disposition: "ignored",
      reason: "terminal-unavailable",
      snapshot: {
        status: "unavailable",
        failure: { code: "missing-secondary-hand-bone" },
      },
    });
    expect(later.state).toBe(failed.state);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed for an invalid frame value: %s",
    (frame) => {
      const transition = apply(emptyState(), receipt({ kind: "runtime-commit", frame }));
      expect(transition).toMatchObject({
        disposition: "failed",
        reason: "invalid-receipt",
        snapshot: { status: "unavailable" },
      });
    }
  );

  it("fails closed for malformed current-identity payloads but ignores unidentifiable payloads", () => {
    const blankCode = apply(emptyState(), receipt({ kind: "failure", code: "   " }));
    expect(blankCode).toMatchObject({
      disposition: "failed",
      reason: "invalid-receipt",
      snapshot: { status: "unavailable" },
    });

    const unknownKind = applyStudioVrmLinkedAppearanceReadinessReceipt(
      emptyState(),
      { kind: "mystery", frame: 0, identity: IDENTITY } as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );
    expect(unknownKind).toMatchObject({
      disposition: "failed",
      reason: "invalid-receipt",
      snapshot: { status: "unavailable" },
    });

    const noIdentity = applyStudioVrmLinkedAppearanceReadinessReceipt(
      emptyState(),
      null as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );
    expect(noIdentity).toMatchObject({
      disposition: "ignored",
      reason: "invalid-receipt",
      snapshot: { status: "loading" },
    });
  });

  it("rejects every structurally forged readiness state before snapshot or receipt processing", () => {
    const trusted = fullState();
    const forgedStates: readonly unknown[] = [
      { ...trusted, kind: "wrong-state-kind" },
      {
        ...trusted,
        receivedProps: [{ uid: 42, propId: null }],
      },
      {
        ...trusted,
        receivedWardrobe: [
          { slot: "top", itemId: "classic-shirt" },
          { slot: "top", itemId: "classic-shirt" },
        ],
      },
      {
        ...trusted,
        lastAcceptedFrame: 3,
        commitFrame: 4,
        postCommitFrame: 3,
      },
    ];

    for (const forged of forgedStates) {
      expect(() => snapshotStudioVrmLinkedAppearanceReadiness(
        forged as StudioVrmLinkedAppearanceReadinessState
      )).toThrow(/state created by this coordinator module/u);
      expect(() => applyStudioVrmLinkedAppearanceReadinessReceipt(
        forged as StudioVrmLinkedAppearanceReadinessState,
        receipt({ kind: "runtime-commit", frame: 4 })
      )).toThrow(/state created by this coordinator module/u);
    }

    expect(snapshotStudioVrmLinkedAppearanceReadiness(trusted).status).toBe("loading");
  });

  it("fails closed for current-generation receipts with extra root or identity keys", () => {
    const state = emptyState();
    const extraRoot = applyStudioVrmLinkedAppearanceReadinessReceipt(
      state,
      {
        kind: "runtime-commit",
        frame: 0,
        identity: { ...IDENTITY },
        injected: true,
      } as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );
    expect(extraRoot).toMatchObject({
      disposition: "failed",
      reason: "invalid-receipt",
      snapshot: {
        status: "unavailable",
        failure: { receiptKind: "runtime-commit" },
      },
    });

    const extraIdentity = applyStudioVrmLinkedAppearanceReadinessReceipt(
      state,
      {
        kind: "runtime-commit",
        frame: 0,
        identity: { ...IDENTITY, injected: true },
      } as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );
    expect(extraIdentity).toMatchObject({
      disposition: "failed",
      reason: "invalid-receipt",
      snapshot: {
        status: "unavailable",
        failure: { receiptKind: "runtime-commit" },
      },
    });
  });

  it("fails closed for wrong receipt kinds and malformed attachment identifiers", () => {
    const malformedReceipts: readonly unknown[] = [
      { kind: 42, frame: 0, identity: { ...IDENTITY } },
      {
        kind: "wardrobe-attached",
        frame: 0,
        slot: 42,
        itemId: "classic-shirt",
        identity: { ...IDENTITY },
      },
      {
        kind: "prop-attached",
        frame: 0,
        uid: "   ",
        propId: { value: "ceramic-mug" },
        identity: { ...IDENTITY },
      },
    ];

    for (const malformedReceipt of malformedReceipts) {
      expect(applyStudioVrmLinkedAppearanceReadinessReceipt(
        emptyState(),
        malformedReceipt as StudioVrmLinkedAppearanceReadinessReceipt
      )).toMatchObject({
        disposition: "failed",
        reason: "invalid-receipt",
        snapshot: { status: "unavailable" },
      });
    }
  });

  it("canonicalizes a cyclic object receipt kind without throwing, freezing, or retaining it", () => {
    const cyclicKind: { self?: unknown } = {};
    cyclicKind.self = cyclicKind;
    const inputIdentity = { ...IDENTITY };
    const malformedReceipt = {
      kind: cyclicKind,
      frame: 0,
      identity: inputIdentity,
    };

    const transition = applyStudioVrmLinkedAppearanceReadinessReceipt(
      emptyState(),
      malformedReceipt as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );

    expect(transition).toMatchObject({
      disposition: "failed",
      reason: "invalid-receipt",
      snapshot: {
        status: "unavailable",
        failure: {
          kind: "protocol",
          code: "invalid-receipt",
          receiptKind: "unknown",
        },
      },
    });
    expect(Object.isFrozen(malformedReceipt)).toBe(false);
    expect(Object.isFrozen(inputIdentity)).toBe(false);
    expect(Object.isFrozen(cyclicKind)).toBe(false);
    expect(cyclicKind.self).toBe(cyclicKind);
    expect(transition.snapshot.failure).not.toHaveProperty("self");
  });

  it("bounds and sanitizes detached runtime diagnostics", () => {
    const code = `  runtime\u0000failure\n${"c".repeat(256)}  `;
    const detail = `  attachment\tdetail\r${"d".repeat(2_048)}  `;
    const transition = apply(emptyState(), receipt({ kind: "failure", code, detail }));

    expect(transition).toMatchObject({
      disposition: "failed",
      reason: "runtime-failure",
      snapshot: { status: "unavailable", failure: { kind: "runtime" } },
    });
    const failure = transition.snapshot.failure;
    expect(failure?.kind).toBe("runtime");
    if (!failure || failure.kind !== "runtime") throw new Error("Expected a runtime failure.");
    expect(failure.code.length).toBeLessThanOrEqual(128);
    expect(failure.code).not.toContain("\n");
    expect(failure.code).not.toContain("\r");
    expect(failure.code).not.toContain("\u0000");
    expect(failure.detail?.length).toBeLessThanOrEqual(1_024);
    expect(failure.detail).not.toContain("\n");
    expect(failure.detail).not.toContain("\r");
    expect(failure.detail).not.toContain("\t");
  });

  it("ignores stale malformed receipts before inspecting their hostile payload", () => {
    const staleIdentity = { ...IDENTITY, generation: IDENTITY.generation - 1, extra: true };
    const cyclicKind: { self?: unknown } = {};
    cyclicKind.self = cyclicKind;
    const staleReceiptTarget = {
      identity: staleIdentity,
      kind: cyclicKind,
      frame: -100,
      uid: null,
      propId: null,
      extra: true,
    };
    let inspectedKind = false;
    const staleReceipt = new Proxy(staleReceiptTarget, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "kind") {
          inspectedKind = true;
          throw new Error("stale receipt kind must not be inspected");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const state = emptyState();
    const transition = applyStudioVrmLinkedAppearanceReadinessReceipt(
      state,
      staleReceipt as unknown as StudioVrmLinkedAppearanceReadinessReceipt
    );

    expect(transition).toMatchObject({
      disposition: "ignored",
      reason: "identity-mismatch",
      state,
      snapshot: { status: "loading", failure: null },
    });
    expect(transition.state).toBe(state);
    expect(inspectedKind).toBe(false);
    expect(Object.isFrozen(staleReceiptTarget)).toBe(false);
    expect(Object.isFrozen(staleIdentity)).toBe(false);
    expect(Object.isFrozen(cyclicKind)).toBe(false);
  });

  it("rejects non-exact identities when creating a readiness state", () => {
    expect(() => createStudioVrmLinkedAppearanceReadiness({
      identity: { ...IDENTITY, extra: true } as StudioVrmLinkedAppearanceReadinessIdentity,
      wardrobe: [],
      props: [],
    })).toThrow(/requires non-empty/u);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-positive-safe-integer generation: %s",
    (generation) => {
      expect(() => createStudioVrmLinkedAppearanceReadiness({
        identity: { ...IDENTITY, generation },
        wardrobe: [],
        props: [],
      })).toThrow(/positive safe-integer generation/u);
    }
  );

  it("rejects missing identity parts, duplicate expectation keys, and blank expectation ids", () => {
    expect(() => createStudioVrmLinkedAppearanceReadiness({
      identity: { ...IDENTITY, placementHash: "" },
      wardrobe: [],
      props: [],
    })).toThrow(/requires non-empty/u);

    expect(() => createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [
        { slot: "top", itemId: "classic-shirt" },
        { slot: "top", itemId: "hoodie" },
      ],
      props: [],
    })).toThrow(/Duplicate wardrobe expectation/u);

    expect(() => createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [],
      props: [
        { uid: "prop-1", propId: "ceramic-mug" },
        { uid: "prop-1", propId: "long-sword" },
      ],
    })).toThrow(/Duplicate prop expectation/u);

    expect(() => createStudioVrmLinkedAppearanceReadiness({
      identity: IDENTITY,
      wardrobe: [{ slot: " ", itemId: "classic-shirt" }],
      props: [],
    })).toThrow(/non-empty slot/u);
  });

  it("defensively copies expectations and deeply freezes every public snapshot and transition", () => {
    const wardrobe = [{ slot: "top", itemId: "classic-shirt" }];
    const props = [{ uid: "prop-mug", propId: "ceramic-mug" }];
    const state = createStudioVrmLinkedAppearanceReadiness({ identity: IDENTITY, wardrobe, props });

    wardrobe[0]!.itemId = "mutated-shirt";
    wardrobe.push({ slot: "shoes", itemId: "ankle-boots" });
    props[0]!.propId = "mutated-prop";

    const transition = apply(state, receipt({
      kind: "wardrobe-attached",
      frame: 1,
      slot: "top",
      itemId: "classic-shirt",
    }));
    const snapshot = transition.snapshot;

    expect(snapshot.expected).toEqual({
      wardrobe: [{ slot: "top", itemId: "classic-shirt" }],
      props: [{ uid: "prop-mug", propId: "ceramic-mug" }],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.identity)).toBe(true);
    expect(Object.isFrozen(state.expectedWardrobe)).toBe(true);
    expect(Object.isFrozen(state.expectedWardrobe[0])).toBe(true);
    expect(Object.isFrozen(transition)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.expected)).toBe(true);
    expect(Object.isFrozen(snapshot.expected.wardrobe)).toBe(true);
    expect(Object.isFrozen(snapshot.expected.wardrobe[0])).toBe(true);
    expect(Object.isFrozen(snapshot.received)).toBe(true);
    expect(Object.isFrozen(snapshot.received.wardrobe[0])).toBe(true);
    expect(Object.isFrozen(snapshot.missing)).toBe(true);
    expect(Object.isFrozen(snapshot.missing.props[0])).toBe(true);
  });
});
