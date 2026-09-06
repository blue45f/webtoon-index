import { describe, expect, it } from "vitest";

import {
  STUDIO_3D_ATTACHMENT_DOCUMENT_KIND,
  STUDIO_3D_ATTACHMENT_MAX_CONSTRAINTS,
  STUDIO_3D_ATTACHMENT_MAX_DOCUMENT_BYTES,
  STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY,
  canStudio3dAttachmentAuthorityWrite,
  isStudio3dAttachmentAuthorityFlowAllowed,
  normalizeStudio3dAttachmentDocument,
  parseStudio3dAttachmentDocument,
  validateStudio3dAttachmentBindings,
} from "./studio-3d-attachment-contract";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const SKELETON_A = `sha256:${"d".repeat(64)}`;

interface MutableTransformFixture {
  position: number[];
  rotation: number[];
  scale: number[];
}

interface MutableNodeFixture {
  id: string;
  assetKind: string;
  contentHash: string;
  skeletonHash?: string;
}

interface MutableSecondaryHandFixture {
  drivenAnchor: Record<string, unknown>;
  handAnchor: Record<string, unknown>;
  weight: number;
}

interface MutableConstraintFixture {
  id: string;
  drivenNodeId: string;
  targetNodeId: string;
  drivenAnchor: Record<string, unknown>;
  targetAnchor: Record<string, unknown>;
  offset: MutableTransformFixture;
  grip: { preset: string; strength: number };
  secondaryHand?: MutableSecondaryHandFixture;
  enabled: boolean;
  weight: number;
  authority: string;
}

interface MutableDocumentFixture {
  kind: string;
  version: number;
  authority: Record<string, string>;
  nodes: MutableNodeFixture[];
  constraints: MutableConstraintFixture[];
}

function identityTransform(): MutableTransformFixture {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 2],
    scale: [1, 1, 1],
  };
}

function validDocument(): MutableDocumentFixture {
  return {
    kind: STUDIO_3D_ATTACHMENT_DOCUMENT_KIND,
    version: 1,
    authority: { ...STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY },
    nodes: [
      {
        id: "character-1",
        assetKind: "vrm",
        contentHash: HASH_A.toUpperCase(),
        skeletonHash: SKELETON_A.toUpperCase(),
      },
      {
        id: "sword-1",
        assetKind: "static-glb",
        contentHash: HASH_B,
      },
      {
        id: "shield-1",
        assetKind: "static-glb",
        contentHash: HASH_C,
      },
    ],
    constraints: [
      {
        id: "attach-sword",
        drivenNodeId: "sword-1",
        targetNodeId: "character-1",
        drivenAnchor: { kind: "asset", anchorId: "grip.primary" },
        targetAnchor: { kind: "humanoid", bone: "rightHand" },
        offset: identityTransform(),
        grip: { preset: "power", strength: 0.85 },
        secondaryHand: {
          drivenAnchor: { kind: "asset", anchorId: "grip.secondary" },
          handAnchor: { kind: "humanoid", bone: "leftHand" },
          weight: 0.7,
        },
        enabled: true,
        weight: 1,
        authority: "attachment-document",
      },
    ],
  };
}

describe("Studio 3D attachment canonical v1 contract", () => {
  it("normalizes hashes, quaternions, and freezes a renderer-neutral document", () => {
    const input = validDocument();
    const document = normalizeStudio3dAttachmentDocument(input);

    expect(document).not.toBeNull();
    expect(document?.nodes[0]?.contentHash).toBe(HASH_A);
    expect(document?.nodes[0]?.skeletonHash).toBe(SKELETON_A);
    expect(document?.constraints[0]?.offset.rotation).toEqual([0, 0, 0, 1]);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document?.nodes)).toBe(true);
    expect(Object.isFrozen(document?.constraints[0]?.secondaryHand)).toBe(true);

    input.nodes[0]!.contentHash = HASH_C;
    input.constraints[0]!.offset.position[0] = 99;
    expect(document?.nodes[0]?.contentHash).toBe(HASH_A);
    expect(document?.constraints[0]?.offset.position).toEqual([0, 0, 0]);
  });

  it("canonicalizes equivalent negative quaternions to one sign", () => {
    const positive = validDocument();
    positive.constraints[0]!.offset.rotation = [0.2, 0.4, 0.6, 0.8];
    const negative = validDocument();
    negative.constraints[0]!.offset.rotation = [-0.2, -0.4, -0.6, -0.8];

    expect(normalizeStudio3dAttachmentDocument(positive)?.constraints[0]?.offset.rotation)
      .toEqual(normalizeStudio3dAttachmentDocument(negative)?.constraints[0]?.offset.rotation);
  });

  it("supports asset/local/humanoid/joint anchors across VRM and rigged GLB", () => {
    const input = validDocument();
    input.nodes[0] = {
      id: "character-1",
      assetKind: "rigged-glb",
      contentHash: HASH_A,
      skeletonHash: SKELETON_A,
    };
    input.constraints[0]!.drivenAnchor = {
      kind: "local",
      transform: {
        position: [0.01, -0.02, 0.03],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    };
    input.constraints[0]!.targetAnchor = {
      kind: "joint",
      jointKey: "skin-0:joint-12",
    };

    const document = normalizeStudio3dAttachmentDocument(input);
    expect(document?.nodes[0]?.assetKind).toBe("rigged-glb");
    expect(document?.constraints[0]?.drivenAnchor.kind).toBe("local");
    expect(document?.constraints[0]?.targetAnchor).toEqual({
      kind: "joint",
      jointKey: "skin-0:joint-12",
    });
  });

  it("parses bounded canonical JSON and rejects invalid, future, oversized, or injected payloads", () => {
    expect(parseStudio3dAttachmentDocument(JSON.stringify(validDocument()))).not.toBeNull();
    expect(parseStudio3dAttachmentDocument("{")).toBeNull();
    expect(parseStudio3dAttachmentDocument("[]")).toBeNull();
    expect(parseStudio3dAttachmentDocument(" ".repeat(STUDIO_3D_ATTACHMENT_MAX_DOCUMENT_BYTES + 1)))
      .toBeNull();

    const future = validDocument();
    future.version = 2;
    expect(normalizeStudio3dAttachmentDocument(future)).toBeNull();

    expect(normalizeStudio3dAttachmentDocument({
      ...validDocument(),
      renderer: "three",
    })).toBeNull();
    expect(normalizeStudio3dAttachmentDocument({
      ...validDocument(),
      constraints: [{
        ...validDocument().constraints[0],
        runtimeObjectUrl: "blob:secret",
      }],
    })).toBeNull();
  });

  it("rejects getters, sparse arrays, non-finite transforms, zero quaternions, and unsafe scale", () => {
    const getterPayload = validDocument();
    Object.defineProperty(getterPayload, "nodes", {
      enumerable: true,
      get: () => [],
    });
    expect(normalizeStudio3dAttachmentDocument(getterPayload)).toBeNull();

    const sparse = validDocument();
    sparse.nodes = new Array(2);
    sparse.nodes[0] = validDocument().nodes[0]!;
    expect(normalizeStudio3dAttachmentDocument(sparse)).toBeNull();

    for (const transform of [
      { position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { position: [0, 0, 0], rotation: [0, 0, 0, 0], scale: [1, 1, 1] },
      { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [0, 1, 1] },
    ]) {
      const input = validDocument();
      input.constraints[0]!.offset = transform;
      expect(normalizeStudio3dAttachmentDocument(input)).toBeNull();
    }
  });

  it("requires rig identities, forbids skeleton identity on static assets, and validates references", () => {
    const missingSkeleton = validDocument();
    delete missingSkeleton.nodes[0]!.skeletonHash;
    expect(normalizeStudio3dAttachmentDocument(missingSkeleton)).toBeNull();

    const staticSkeleton = validDocument();
    staticSkeleton.nodes[1]!.skeletonHash = SKELETON_A;
    expect(normalizeStudio3dAttachmentDocument(staticSkeleton)).toBeNull();

    const missingNode = validDocument();
    missingNode.constraints[0]!.targetNodeId = "not-present";
    expect(normalizeStudio3dAttachmentDocument(missingNode)).toBeNull();

    const noRigIdentity = validDocument();
    noRigIdentity.nodes[0] = {
      id: "character-1",
      assetKind: "static-glb",
      contentHash: HASH_A,
    };
    expect(normalizeStudio3dAttachmentDocument(noRigIdentity)).toBeNull();
  });

  it("rejects duplicate node IDs, constraint IDs, and competing constraints for one driven node", () => {
    const duplicateNode = validDocument();
    duplicateNode.nodes.push({ ...duplicateNode.nodes[1]! });
    expect(normalizeStudio3dAttachmentDocument(duplicateNode)).toBeNull();

    const duplicateConstraint = validDocument();
    duplicateConstraint.constraints.push({
      ...duplicateConstraint.constraints[0]!,
      drivenNodeId: "shield-1",
    });
    expect(normalizeStudio3dAttachmentDocument(duplicateConstraint)).toBeNull();

    const competingDriver = validDocument();
    competingDriver.constraints.push({
      ...competingDriver.constraints[0]!,
      id: "attach-sword-again",
      targetAnchor: { kind: "humanoid", bone: "leftHand" },
      secondaryHand: undefined,
    });
    expect(normalizeStudio3dAttachmentDocument(competingDriver)).toBeNull();
  });

  it("rejects self-links, longer attachment cycles, and duplicate two-hand anchors", () => {
    const selfLink = validDocument();
    selfLink.constraints[0]!.targetNodeId = "sword-1";
    expect(normalizeStudio3dAttachmentDocument(selfLink)).toBeNull();

    const cycle = validDocument();
    cycle.nodes[1] = {
      id: "sword-1",
      assetKind: "rigged-glb",
      contentHash: HASH_B,
      skeletonHash: `sha256:${"e".repeat(64)}`,
    };
    cycle.constraints.push({
      id: "attach-character",
      drivenNodeId: "character-1",
      targetNodeId: "sword-1",
      drivenAnchor: { kind: "asset", anchorId: "body" },
      targetAnchor: { kind: "joint", jointKey: "skin-0:joint-1" },
      offset: identityTransform(),
      grip: { preset: "none", strength: 0 },
      enabled: true,
      weight: 1,
      authority: "attachment-document",
    });
    expect(normalizeStudio3dAttachmentDocument(cycle)).toBeNull();

    const duplicateSecondaryAnchor = validDocument();
    duplicateSecondaryAnchor.constraints[0]!.secondaryHand!.drivenAnchor =
      duplicateSecondaryAnchor.constraints[0]!.drivenAnchor;
    expect(normalizeStudio3dAttachmentDocument(duplicateSecondaryAnchor)).toBeNull();
  });

  it("enforces the explicit node/constraint limits", () => {
    const overConstraintLimit = validDocument();
    overConstraintLimit.constraints = Array.from(
      { length: STUDIO_3D_ATTACHMENT_MAX_CONSTRAINTS + 1 },
      (_, index) => ({
        ...validDocument().constraints[0]!,
        id: `constraint-${index}`,
      }),
    );
    expect(normalizeStudio3dAttachmentDocument(overConstraintLimit)).toBeNull();
  });
});

describe("Studio 3D attachment stale-binding validation", () => {
  it("accepts only exact current content and skeleton identities", () => {
    const validation = validateStudio3dAttachmentBindings(validDocument(), [
      { nodeId: "character-1", contentHash: HASH_A, skeletonHash: SKELETON_A },
      { nodeId: "sword-1", contentHash: HASH_B },
    ]);

    expect(validation).toEqual({
      ok: true,
      issues: [],
      validatedNodeIds: ["character-1", "sword-1"],
    });
    expect(Object.isFrozen(validation)).toBe(true);
    expect(Object.isFrozen(validation.validatedNodeIds)).toBe(true);
  });

  it.each([
    [
      [{ nodeId: "character-1", contentHash: HASH_C, skeletonHash: SKELETON_A },
        { nodeId: "sword-1", contentHash: HASH_B }],
      "content-hash-mismatch",
    ],
    [
      [{ nodeId: "character-1", contentHash: HASH_A },
        { nodeId: "sword-1", contentHash: HASH_B }],
      "skeleton-hash-missing",
    ],
    [
      [{ nodeId: "character-1", contentHash: HASH_A, skeletonHash: HASH_C },
        { nodeId: "sword-1", contentHash: HASH_B }],
      "skeleton-hash-mismatch",
    ],
    [
      [{ nodeId: "character-1", contentHash: HASH_A, skeletonHash: SKELETON_A }],
      "missing-runtime-node",
    ],
  ] as const)("fails closed on stale binding: %s", (runtimeNodes, expectedCode) => {
    const validation = validateStudio3dAttachmentBindings(validDocument(), runtimeNodes);
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain(expectedCode);
    expect(validation.validatedNodeIds).toEqual([]);
  });

  it("rejects malformed and duplicate runtime identities even if one matching record exists", () => {
    const validation = validateStudio3dAttachmentBindings(validDocument(), [
      { nodeId: "character-1", contentHash: HASH_A, skeletonHash: SKELETON_A },
      { nodeId: "character-1", contentHash: HASH_A, skeletonHash: SKELETON_A },
      { nodeId: "sword-1", contentHash: HASH_B },
      { nodeId: "bad", contentHash: "not-a-hash" },
    ]);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-runtime-node", nodeId: "character-1" }),
      expect.objectContaining({ code: "invalid-runtime-node", runtimeIndex: 3 }),
    ]));
  });

  it("does not require identities for unused library nodes", () => {
    const validation = validateStudio3dAttachmentBindings(validDocument(), [
      { nodeId: "character-1", contentHash: HASH_A, skeletonHash: SKELETON_A },
      { nodeId: "sword-1", contentHash: HASH_B },
    ]);
    expect(validation.ok).toBe(true);
    expect(validation.validatedNodeIds).not.toContain("shield-1");
  });
});

describe("Studio 3D attachment one-way authority", () => {
  it("assigns exactly one writer to every state channel", () => {
    const authorities = [
      "attachment-document",
      "rig-runtime",
      "attachment-solver",
      "secondary-hand-ik",
    ] as const;
    const channels = [
      "constraint-intent",
      "target-pose",
      "driven-world-transform",
      "secondary-hand-pose",
    ] as const;
    const expected = [
      "attachment-document",
      "rig-runtime",
      "attachment-solver",
      "secondary-hand-ik",
    ] as const;

    channels.forEach((channel, index) => {
      expect(authorities.filter((authority) =>
        canStudio3dAttachmentAuthorityWrite(authority, channel))).toEqual([expected[index]]);
    });
  });

  it("allows only document/rig -> solver -> secondary IK and rejects feedback", () => {
    expect(isStudio3dAttachmentAuthorityFlowAllowed(
      "attachment-document",
      "attachment-solver",
    )).toBe(true);
    expect(isStudio3dAttachmentAuthorityFlowAllowed("rig-runtime", "attachment-solver")).toBe(true);
    expect(isStudio3dAttachmentAuthorityFlowAllowed(
      "attachment-solver",
      "secondary-hand-ik",
    )).toBe(true);

    expect(isStudio3dAttachmentAuthorityFlowAllowed(
      "secondary-hand-ik",
      "attachment-solver",
    )).toBe(false);
    expect(isStudio3dAttachmentAuthorityFlowAllowed(
      "attachment-solver",
      "rig-runtime",
    )).toBe(false);
    expect(isStudio3dAttachmentAuthorityFlowAllowed(
      "attachment-solver",
      "attachment-document",
    )).toBe(false);
  });
});
