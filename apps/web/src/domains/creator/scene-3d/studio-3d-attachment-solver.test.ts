import { describe, expect, it } from "vitest";

import {
  STUDIO_3D_ATTACHMENT_DOCUMENT_KIND,
  STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY,
} from "./studio-3d-attachment-contract";
import {
  solveStudio3dAttachment,
  type Studio3dAttachmentSolveRequest,
} from "./studio-3d-attachment-solver";

const CHARACTER_HASH = `sha256:${"a".repeat(64)}`;
const PROP_HASH = `sha256:${"b".repeat(64)}`;
const SKELETON_HASH = `sha256:${"c".repeat(64)}`;

type MutableSolveRequest = {
  -readonly [Key in keyof Studio3dAttachmentSolveRequest]: Studio3dAttachmentSolveRequest[Key];
};

function degreesQuaternion(xDegrees: number, yDegrees: number, zDegrees: number) {
  const x = xDegrees * Math.PI / 180 / 2;
  const y = yDegrees * Math.PI / 180 / 2;
  const z = zDegrees * Math.PI / 180 / 2;
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function transform(
  position = [0, 0, 0],
  rotation = [0, 0, 0, 1],
  scale = [1, 1, 1],
) {
  return { position: [...position], rotation: [...rotation], scale: [...scale] };
}

function documentFixture(withSecondary = false) {
  return {
    kind: STUDIO_3D_ATTACHMENT_DOCUMENT_KIND,
    version: 1,
    authority: { ...STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY },
    nodes: [
      {
        id: "character-1",
        assetKind: "vrm",
        contentHash: CHARACTER_HASH,
        skeletonHash: SKELETON_HASH,
      },
      {
        id: "prop-1",
        assetKind: "static-glb",
        contentHash: PROP_HASH,
      },
    ],
    constraints: [
      {
        id: "grip-1",
        drivenNodeId: "prop-1",
        targetNodeId: "character-1",
        drivenAnchor: { kind: "asset", anchorId: "primary" },
        targetAnchor: { kind: "humanoid", bone: "rightHand" },
        offset: transform(),
        grip: { preset: "power", strength: 1 },
        ...(withSecondary
          ? {
              secondaryHand: {
                drivenAnchor: { kind: "asset", anchorId: "secondary" },
                handAnchor: { kind: "humanoid", bone: "leftHand" },
                weight: 1,
              },
            }
          : {}),
        enabled: true,
        weight: 1,
        authority: "attachment-document",
      },
    ],
  };
}

function runtimeNodes() {
  return [
    {
      nodeId: "character-1",
      contentHash: CHARACTER_HASH,
      skeletonHash: SKELETON_HASH,
    },
    { nodeId: "prop-1", contentHash: PROP_HASH },
  ];
}

function requestFixture(withSecondary = false): MutableSolveRequest {
  return {
    document: documentFixture(withSecondary),
    constraintId: "grip-1",
    runtimeNodes: runtimeNodes(),
    primarySocketWorld: transform(),
    propAnchorLocal: transform(),
    ...(withSecondary ? { secondaryPropAnchorLocal: transform([0.4, 0, 0]) } : {}),
  };
}

function expectVecClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
  precision = 10,
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual?.[index]).toBeCloseTo(value, precision));
}

function angleBetweenQuaternions(
  first: readonly number[],
  second: readonly number[],
): number {
  const dot = Math.min(1, Math.abs(
    first[0]! * second[0]! +
    first[1]! * second[1]! +
    first[2]! * second[2]! +
    first[3]! * second[3]!,
  ));
  return 2 * Math.acos(dot) * 180 / Math.PI;
}

describe("Studio 3D pure attachment solver", () => {
  it("computes primary socket world × inverse(prop anchor local)", () => {
    const request = requestFixture();
    request.primarySocketWorld = transform(
      [2, 3, 4],
      degreesQuaternion(0, 0, 90),
      [2, 2, 2],
    );
    request.propAnchorLocal = transform(
      [0.5, 0, 0],
      degreesQuaternion(0, 0, 30),
      [2, 2, 2],
    );

    const result = solveStudio3dAttachment(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Applying the solved prop transform back to its local anchor must recover the socket.
    expectVecClose(result.propWorld.position, [
      1.75,
      3 - Math.sqrt(3) / 4,
      4,
    ]);
    expectVecClose(result.propWorld.scale, [1, 1, 1]);
    expect(angleBetweenQuaternions(
      result.propWorld.rotation,
      degreesQuaternion(0, 0, 60),
    )).toBeLessThan(1e-5);
  });

  it("applies the document offset between target socket and inverse prop anchor", () => {
    const request = requestFixture();
    const document = documentFixture();
    document.constraints[0]!.offset = transform(
      [0.001, -0.002, 0.003],
      degreesQuaternion(0, 1, 0),
    );
    request.document = document;
    request.primarySocketWorld = transform([1, 2, 3], degreesQuaternion(0, 30, 0));

    const result = solveStudio3dAttachment(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1 mm position and 1 degree rotation remain numerically distinguishable.
    const expectedOffset = [
      0.001 * Math.cos(Math.PI / 6) + 0.003 * Math.sin(Math.PI / 6),
      -0.002,
      -0.001 * Math.sin(Math.PI / 6) + 0.003 * Math.cos(Math.PI / 6),
    ];
    expectVecClose(result.propWorld.position, [
      1 + expectedOffset[0]!,
      2 + expectedOffset[1]!,
      3 + expectedOffset[2]!,
    ], 9);
    expect(angleBetweenQuaternions(
      result.propWorld.rotation,
      degreesQuaternion(0, 31, 0),
    )).toBeLessThan(1e-7);
  });

  it("emits the opposite-hand IK world target from the solved prop and secondary anchor", () => {
    const request = requestFixture(true);
    request.primarySocketWorld = transform([1, 2, 3], degreesQuaternion(0, 0, 90));
    request.secondaryPropAnchorLocal = transform([0.4, 0, 0], degreesQuaternion(0, 15, 0));

    const result = solveStudio3dAttachment(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectVecClose(result.propWorld.position, [1, 2, 3]);
    expectVecClose(result.secondaryHandIkTargetWorld?.position, [1, 2.4, 3]);
    const halfZ = 45 * Math.PI / 180;
    const halfY = 7.5 * Math.PI / 180;
    expect(angleBetweenQuaternions(
      result.secondaryHandIkTargetWorld?.rotation ?? [],
      [
        -Math.sin(halfZ) * Math.sin(halfY),
        Math.cos(halfZ) * Math.sin(halfY),
        Math.sin(halfZ) * Math.cos(halfY),
        Math.cos(halfZ) * Math.cos(halfY),
      ],
    )).toBeLessThan(1e-7);
    expect(Object.isFrozen(result.secondaryHandIkTargetWorld)).toBe(true);
  });

  it("does not mutate request, document, runtime identities, or transform arrays", () => {
    const request = requestFixture(true);
    request.primarySocketWorld = transform([1, 2, 3], [0, 0, 0, 2], [2, 2, 2]);
    request.propAnchorLocal = transform([0.1, 0.2, 0.3], [0, 0, 0, -4], [2, 2, 2]);
    const before = JSON.stringify(request);

    const result = solveStudio3dAttachment(request);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(request)).toBe(before);
    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(request.primarySocketWorld)).toBe(false);
    if (result.ok) {
      expect(result.propWorld).not.toBe(request.primarySocketWorld);
      expect(Object.isFrozen(result.propWorld)).toBe(true);
      expect(Object.isFrozen(result.propWorld.position)).toBe(true);
      expect(Object.isFrozen(result.propWorld.rotation)).toBe(true);
    }
  });

  it.each([
    {
      label: "primary socket",
      field: "primarySocketWorld",
      value: transform([0, 0, 0], [0, 0, 0, 1], [1, 2, 1]),
    },
    {
      label: "primary prop anchor",
      field: "propAnchorLocal",
      value: transform([0, 0, 0], [0, 0, 0, 1], [1, 1, 0.5]),
    },
    {
      label: "document offset",
      field: "documentOffset",
      value: transform([0, 0, 0], [0, 0, 0, 1], [1, 1.01, 1]),
    },
    {
      label: "secondary prop anchor",
      field: "secondaryPropAnchorLocal",
      value: transform([0, 0, 0], [0, 0, 0, 1], [2, 1, 1]),
    },
  ])("fails closed on non-uniform scale in $label", ({ field, value }) => {
    const request = requestFixture(field === "secondaryPropAnchorLocal");
    if (field === "documentOffset") {
      const document = documentFixture();
      document.constraints[0]!.offset = value;
      request.document = document;
    } else {
      Object.assign(request, { [field]: value });
    }

    expect(solveStudio3dAttachment(request)).toMatchObject({
      ok: false,
      code: "non-uniform-scale",
    });
  });

  it.each([
    [transform([0, 0, 0], [0, 0, 0, 1], [0, 0, 0]), "invalid-scale"],
    [transform([0, 0, 0], [0, 0, 0, 1], [-1, -1, -1]), "invalid-scale"],
    [transform([0, 0, 0], [0, 0, 0, 0]), "degenerate-quaternion"],
    [transform([0, 0, Number.NaN]), "invalid-primary-socket"],
    [transform([0, 0, 0], [0, Number.POSITIVE_INFINITY, 0, 1]), "degenerate-quaternion"],
  ] as const)("rejects invalid socket transform %#", (primarySocketWorld, code) => {
    const request = requestFixture();
    request.primarySocketWorld = primarySocketWorld;
    expect(solveStudio3dAttachment(request)).toMatchObject({ ok: false, code });
  });

  it("requires a secondary prop anchor only for a declared two-hand constraint", () => {
    const missing = requestFixture(true);
    delete (missing as { secondaryPropAnchorLocal?: unknown }).secondaryPropAnchorLocal;
    expect(solveStudio3dAttachment(missing)).toMatchObject({
      ok: false,
      code: "missing-secondary-prop-anchor",
    });

    const unexpected = requestFixture();
    (unexpected as { secondaryPropAnchorLocal?: unknown }).secondaryPropAnchorLocal = transform();
    expect(solveStudio3dAttachment(unexpected)).toMatchObject({
      ok: false,
      code: "unexpected-secondary-prop-anchor",
    });
  });
});

describe("Studio 3D attachment solver binding gate", () => {
  it.each([
    [
      [{ nodeId: "character-1", contentHash: `sha256:${"f".repeat(64)}`, skeletonHash: SKELETON_HASH },
        { nodeId: "prop-1", contentHash: PROP_HASH }],
      "stale-content-binding",
    ],
    [
      [{ nodeId: "character-1", contentHash: CHARACTER_HASH, skeletonHash: `sha256:${"f".repeat(64)}` },
        { nodeId: "prop-1", contentHash: PROP_HASH }],
      "stale-skeleton-binding",
    ],
    [
      [{ nodeId: "character-1", contentHash: CHARACTER_HASH, skeletonHash: SKELETON_HASH }],
      "missing-node-binding",
    ],
    [
      [{ nodeId: "character-1", contentHash: CHARACTER_HASH, skeletonHash: SKELETON_HASH },
        { nodeId: "character-1", contentHash: CHARACTER_HASH, skeletonHash: SKELETON_HASH },
        { nodeId: "prop-1", contentHash: PROP_HASH }],
      "invalid-binding-set",
    ],
  ] as const)("returns an explicit binding failure: %s", (nodes, code) => {
    const request = requestFixture();
    request.runtimeNodes = nodes;

    const result = solveStudio3dAttachment(request);
    expect(result).toMatchObject({ ok: false, code });
    if (!result.ok) {
      expect(result.bindingIssues?.length).toBeGreaterThan(0);
      expect(Object.isFrozen(result.bindingIssues)).toBe(true);
    }
  });

  it("checks binding freshness before consuming hostile transform input", () => {
    const request = requestFixture();
    request.runtimeNodes = [];
    const hostileSocket = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileSocket, "position", {
      enumerable: true,
      get: () => {
        throw new Error("socket must not be read before binding admission");
      },
    });
    request.primarySocketWorld = hostileSocket;

    expect(solveStudio3dAttachment(request)).toMatchObject({
      ok: false,
      code: "missing-node-binding",
    });
  });

  it("returns an explicit invalid-document/constraint error without throwing", () => {
    expect(solveStudio3dAttachment({
      ...requestFixture(),
      document: { kind: "wrong" },
    })).toEqual({ ok: false, code: "invalid-document" });

    expect(solveStudio3dAttachment({
      ...requestFixture(),
      constraintId: "missing",
    })).toEqual({
      ok: false,
      code: "constraint-not-found",
      constraintId: "missing",
    });
  });
});
