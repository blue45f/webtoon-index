import { describe, expect, it } from "vitest";

import {
  resolveStudioBg3dSharedCharacterGrounding,
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS,
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS,
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND,
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION,
  type ResolveStudioBg3dSharedCharacterGroundingInput,
  type StudioBg3dSharedCharacterGroundingFailureCode,
} from "./studio-bg3d-shared-character-grounding";

const PLACEMENT_HASH = `sha256:${"a".repeat(64)}` as const;

function request(
  overrides: Partial<ResolveStudioBg3dSharedCharacterGroundingInput> = {},
): ResolveStudioBg3dSharedCharacterGroundingInput {
  return {
    identity: {
      stageId: "room-stage",
      elementId: "character-a",
      modelRuntimeKey: `character-a:sha256:${"b".repeat(64)}`,
      placementHash: PLACEMENT_HASH,
    },
    placementY: 2,
    anchors: [
      { kind: "right-foot", point: [0.2, 0.5, 0] },
      { kind: "lower-bound", point: [0, -0.25, 0] },
      { kind: "left-foot", point: [-0.2, 0.5, 0] },
    ],
    surfaceHit: {
      source: "background-surface",
      targetEntityId: "platform-top",
      point: [0, 0, 0],
      normal: [0, 2, 0],
    },
    ...overrides,
  };
}

function expectFailure(
  value: unknown,
  code: StudioBg3dSharedCharacterGroundingFailureCode,
): void {
  const result = resolveStudioBg3dSharedCharacterGrounding(value);
  expect(result).toEqual({ ok: false, code });
  expect(Object.isFrozen(result)).toBe(true);
}

describe("Studio BG3D Shared Character grounding", () => {
  it("grounds the lowest foot, preserves the v3 authority boundary, and emits an auditable receipt", () => {
    const result = resolveStudioBg3dSharedCharacterGrounding(request());

    expect(result).toEqual({
      ok: true,
      receipt: {
        kind: STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND,
        version: STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION,
        identity: {
          stageId: "room-stage",
          elementId: "character-a",
          modelRuntimeKey: `character-a:sha256:${"b".repeat(64)}`,
          placementHash: PLACEMENT_HASH,
        },
        diagnosis: "floating",
        anchorPolicy: "lowest-foot",
        selectedAnchor: { kind: "left-foot", point: [-0.2, 0.5, 0] },
        surface: {
          source: "background-surface",
          targetEntityId: "platform-top",
          point: [0, 0, 0],
          normal: [0, 1, 0],
        },
        currentPlacementY: 2,
        placementY: 1.5,
        gapY: 0.5,
        resolvedGapY: 0,
        correctionY: -0.5,
        targetAnchorY: 0,
        didMove: true,
        groundToleranceMeters:
          STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.groundToleranceMeters,
        soleClearanceMeters: 0,
        horizontalSurfaceDistanceMeters: 0.2,
        budget: {
          admittedAnchorCount: 3,
          evaluatedAnchorCount: 2,
          maxAnchorEvaluations: 3,
          maxCorrectionMeters: 1,
          maxHorizontalSurfaceDistanceMeters: 2,
        },
      },
    });
    expect(result.ok && result.receipt).not.toHaveProperty("placement");
    expect(result.ok && result.receipt).not.toHaveProperty("scene");
  });

  it("raises a penetrating character and applies optional sole clearance", () => {
    const result = resolveStudioBg3dSharedCharacterGrounding(request({
      placementY: 1,
      anchors: [
        { kind: "left-foot", point: [-0.2, -0.25, 0] },
        { kind: "right-foot", point: [0.2, 0.1, 0] },
      ],
      surfaceHit: {
        source: "background-surface",
        targetEntityId: "raised-floor",
        point: [0, 0.25, 0],
        normal: [0, 1, 0],
      },
      options: { soleClearanceMeters: 0.01 },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({
      diagnosis: "penetrating",
      currentPlacementY: 1,
      placementY: 1.51,
      gapY: -0.51,
      correctionY: 0.51,
      targetAnchorY: 0.26,
      resolvedGapY: 0,
    });
  });

  it("does not introduce sub-tolerance jitter for an already grounded foot", () => {
    const result = resolveStudioBg3dSharedCharacterGrounding(request({
      placementY: 0.75,
      anchors: [{ kind: "left-foot", point: [0, 0.104, 0] }],
      surfaceHit: {
        source: "stage-plane",
        point: [0, 0.1, 0],
        normal: [0, 1, 0],
      },
      options: { groundToleranceMeters: 0.005 },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.diagnosis).toBe("grounded");
    expect(result.receipt.placementY).toBe(0.75);
    expect(result.receipt.correctionY).toBe(0);
    expect(result.receipt.gapY).toBeCloseTo(0.004, 12);
    expect(result.receipt.resolvedGapY).toBeCloseTo(0.004, 12);
    expect(result.receipt.didMove).toBe(false);
    expect(result.receipt.surface.targetEntityId).toBeNull();
  });

  it("falls back to a lower-bound anchor only when no foot measurement is available", () => {
    const result = resolveStudioBg3dSharedCharacterGrounding(request({
      anchors: [{ kind: "lower-bound", point: [0, 0.3, 0] }],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.anchorPolicy).toBe("lower-bound-fallback");
    expect(result.receipt.selectedAnchor.kind).toBe("lower-bound");
    expect(result.receipt.placementY).toBe(1.7);
    expect(result.receipt.budget.evaluatedAnchorCount).toBe(1);
  });

  it("is deterministic across caller anchor order and uses a fixed left-foot tie break", () => {
    const firstInput = request();
    const secondInput = request({ anchors: [...firstInput.anchors].reverse() });
    const first = resolveStudioBg3dSharedCharacterGrounding(firstInput);
    const second = resolveStudioBg3dSharedCharacterGrounding(secondInput);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.ok && first.receipt.selectedAnchor.kind).toBe("left-foot");
  });

  it("deeply freezes copied receipts and never mutates caller input", () => {
    const input = request();
    const before = JSON.stringify(input);
    const result = resolveStudioBg3dSharedCharacterGrounding(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.identity)).toBe(true);
    expect(Object.isFrozen(result.receipt.selectedAnchor)).toBe(true);
    expect(Object.isFrozen(result.receipt.selectedAnchor.point)).toBe(true);
    expect(Object.isFrozen(result.receipt.surface)).toBe(true);
    expect(Object.isFrozen(result.receipt.surface.normal)).toBe(true);
    expect(Object.isFrozen(result.receipt.budget)).toBe(true);
    expect(result.receipt.selectedAnchor.point).not.toBe(input.anchors[2]?.point);
  });

  it("rejects malformed identities, unknown fields, non-finite values, and duplicate anchors", () => {
    const invalid: Array<readonly [unknown, StudioBg3dSharedCharacterGroundingFailureCode]> = [
      [null, "invalid-input"],
      [{ ...request(), extra: true }, "invalid-input"],
      [{ ...request(), placementY: Number.NaN }, "invalid-input"],
      [{ ...request(), placementY: Number.POSITIVE_INFINITY }, "invalid-input"],
      [{ ...request(), identity: { ...request().identity, elementId: "__proto__" } },
        "invalid-identity"],
      [{ ...request(), identity: { ...request().identity, placementHash: "sha256:nope" } },
        "invalid-identity"],
      [{ ...request(), identity: { ...request().identity, extra: true } }, "invalid-identity"],
      [{ ...request(), anchors: [] }, "invalid-anchor"],
      [{ ...request(), anchors: [
        { kind: "left-foot", point: [0, 0, 0] },
        { kind: "left-foot", point: [0, 0, 0] },
      ] }, "invalid-anchor"],
      [{ ...request(), anchors: [{ kind: "left-foot", point: [0, Number.NaN, 0] }] },
        "invalid-anchor"],
      [{ ...request(), anchors: [{ kind: "toe" as never, point: [0, 0, 0] }] },
        "invalid-anchor"],
      [{ ...request(), options: { groundToleranceMeters: Number.NaN } }, "invalid-input"],
      [{ ...request(), options: { soleClearanceMeters: 0.051 } }, "invalid-input"],
    ];

    for (const [value, code] of invalid) expectFailure(value, code);
  });

  it("normalizes valid surface normals and rejects missing, degenerate, downward, or steep hits", () => {
    const invalid: Array<readonly [unknown, StudioBg3dSharedCharacterGroundingFailureCode]> = [
      [{ ...request(), surfaceHit: {
        source: "background-surface",
        point: [0, 0, 0],
        normal: [0, 1, 0],
      } }, "invalid-surface-hit"],
      [{ ...request(), surfaceHit: {
        source: "stage-plane",
        targetEntityId: "not-allowed",
        point: [0, 0, 0],
        normal: [0, 1, 0],
      } }, "invalid-surface-hit"],
      [{ ...request(), surfaceHit: {
        source: "background-surface",
        targetEntityId: "floor",
        point: [0, 0, 0],
        normal: [0, 0, 0],
      } }, "invalid-surface-hit"],
      [{ ...request(), surfaceHit: {
        source: "background-surface",
        targetEntityId: "floor",
        point: [0, 0, 0],
        normal: [0, -1, 0],
      } }, "unsupported-surface-normal"],
      [{ ...request(), surfaceHit: {
        source: "background-surface",
        targetEntityId: "wall",
        point: [0, 0, 0],
        normal: [1, 0.2, 0],
      } }, "unsupported-surface-normal"],
      [{ ...request(), surfaceHit: {
        source: "background-surface",
        targetEntityId: "floor",
        point: [10_001, 0, 0],
        normal: [0, 1, 0],
      } }, "invalid-surface-hit"],
    ];

    for (const [value, code] of invalid) expectFailure(value, code);
  });

  it("enforces anchor, correction, hit-distance, and caller budget ceilings", () => {
    expectFailure(request({ budget: { maxAnchorEvaluations: 2 } }), "anchor-budget-exceeded");
    expectFailure(request({
      anchors: [{ kind: "left-foot", point: [0, 1.01, 0] }],
    }), "correction-budget-exceeded");
    expectFailure(request({
      anchors: [{ kind: "left-foot", point: [0, 0.2, 0] }],
      budget: { maxCorrectionMeters: 0.1 },
    }), "correction-budget-exceeded");
    expectFailure(request({
      anchors: [{ kind: "left-foot", point: [0, 0.2, 0] }],
      surfaceHit: {
        source: "background-surface",
        targetEntityId: "stale-floor",
        point: [2.01, 0, 0],
        normal: [0, 1, 0],
      },
    }), "surface-distance-budget-exceeded");

    const invalidBudgets = [
      { maxAnchorEvaluations: 0 },
      { maxAnchorEvaluations:
        STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAnchorEvaluations + 1 },
      { maxCorrectionMeters: 0 },
      { maxCorrectionMeters:
        STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxCorrectionMeters + 0.001 },
      { maxHorizontalSurfaceDistanceMeters: Number.NaN },
      { maxHorizontalSurfaceDistanceMeters:
        STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS
          .maxHorizontalSurfaceDistanceMeters + 0.001 },
      { maxAnchorEvaluations: 1, extra: true },
    ];
    for (const budget of invalidBudgets) {
      expectFailure(request({ budget }), "invalid-budget");
    }
  });

  it("fails closed when the recommended placement leaves the admitted world range", () => {
    expectFailure(request({
      placementY:
        STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate - 0.1,
      anchors: [{ kind: "left-foot", point: [0, -0.2, 0] }],
    }), "result-out-of-bounds");
  });
});
