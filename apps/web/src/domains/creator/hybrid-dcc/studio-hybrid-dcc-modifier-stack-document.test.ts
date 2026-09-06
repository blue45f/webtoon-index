import { describe, expect, it } from "vitest";

import { canonicalStudioCommandJson } from "../studio-command-journal";
import { calculateStudioCrc32 } from "../studio-crc32";
import {
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
  serializeStudioEditableMesh,
  studioEditableMeshToTriangleSoup,
} from "../studio-editable-half-edge-mesh";
import {
  createStudioMeshModifierStack,
  deserializeStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  hashStudioMeshModifierStack,
  serializeStudioMeshModifierStack,
  type StudioMeshModifier,
  type StudioMeshModifierStack,
} from "../studio-mesh-modifier-stack";
import { sha256HexPortable } from "../studio-sha256";

import {
  createStudioHybridDccSession,
  hybridDccApplyModifierStack,
  hybridDccRedo,
  hybridDccRegisterAsset,
  hybridDccRegisterAssets,
  hybridDccSetModifierStack,
  hybridDccUndo,
  restoreStudioHybridDccStateFromSnapshot,
  snapshotStudioHybridDccState,
} from "./studio-hybrid-dcc-document";
import { createStudioHybridDccIdentityTransform } from "./studio-hybrid-dcc-object-transform";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
} from "./studio-hybrid-dcc-workspace";
import {
  decodeStudioHybridDccWorkspacePersistenceEnvelope,
  encodeStudioHybridDccWorkspacePersistenceEnvelope,
} from "./studio-hybrid-dcc-workspace-persistence";

const RIGHTS = {
  source: "primitive",
  creator: "studio",
  license: "CC0-1.0",
  useScope: "commercial",
  derivative: "original",
} as const;

function allModifierStack(): StudioMeshModifierStack {
  const source = createStudioUnitCubeMesh();
  const operand = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
  return createStudioMeshModifierStack(source, [
    {
      kind: "mirror",
      id: "mirror-x",
      enabled: true,
      axis: "x",
      merge: true,
      mergeThreshold: 0.000_25,
      bisect: true,
      clip: false,
    },
    {
      kind: "array",
      id: "radial-array",
      enabled: false,
      count: 7,
      offset: { x: 1.25, y: -0.5, z: 2.75 },
      mode: "radial",
      radialAngleRad: Math.PI * 1.5,
      realizeInstances: false,
    },
    {
      kind: "boolean",
      id: "door-cut",
      enabled: true,
      operation: "difference",
      operandAssetId: "room-door-cutter",
      operand,
    },
    {
      kind: "solidify",
      id: "wall-thickness",
      enabled: true,
      thickness: -0.0375,
      evenThickness: true,
      rim: false,
    },
    {
      kind: "bevel",
      id: "soft-edge",
      enabled: true,
      amount: 0.0125,
      segments: 5,
      angleLimitRad: Math.PI / 3,
      weightInfluence: 0.625,
    },
  ]);
}

describe("canonical non-destructive modifier stack DTO", () => {
  it("round-trips all five modifiers, typed boolean operands, and cutter provenance exactly", () => {
    const stack = allModifierStack();
    const serialized = serializeStudioMeshModifierStack(stack);
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized)) as unknown;
    const decoded = deserializeStudioMeshModifierStack(jsonRoundTrip, stack.source);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(serializeStudioMeshModifierStack(decoded.value)).toEqual(serialized);
    expect(hashStudioMeshModifierStack(decoded.value)).toBe(hashStudioMeshModifierStack(stack));
    const booleanModifier = decoded.value.modifiers[2];
    expect(booleanModifier?.kind).toBe("boolean");
    if (booleanModifier?.kind !== "boolean") return;
    expect(booleanModifier.operand.positions).toBeInstanceOf(Float32Array);
    expect(booleanModifier.operand.indices).toBeInstanceOf(Uint32Array);
    expect(booleanModifier.operandAssetId).toBe("room-door-cutter");
    expect(Array.from(booleanModifier.operand.positions)).toEqual(
      Array.from((stack.modifiers[2] as Extract<StudioMeshModifier, { kind: "boolean" }>).operand.positions),
    );
  });

  it("binds order, every parameter, and operand bytes in a stable stack hash", () => {
    const stack = allModifierStack();
    const reordered = createStudioMeshModifierStack(stack.source, [
      stack.modifiers[1]!,
      stack.modifiers[0]!,
      ...stack.modifiers.slice(2),
    ]);
    const parameterChanged = createStudioMeshModifierStack(stack.source, stack.modifiers.map(
      (modifier) => modifier.kind === "bevel"
        ? { ...modifier, weightInfluence: 0.5 }
        : modifier,
    ));
    const boolean = stack.modifiers[2] as Extract<StudioMeshModifier, { kind: "boolean" }>;
    const changedPositions = new Float32Array(boolean.operand.positions);
    changedPositions[0] = changedPositions[0]! + 0.125;
    const operandChanged = createStudioMeshModifierStack(stack.source, stack.modifiers.map(
      (modifier) => modifier.kind === "boolean"
        ? { ...modifier, operand: { ...modifier.operand, positions: changedPositions } }
        : modifier,
    ));
    const provenanceChanged = createStudioMeshModifierStack(stack.source, stack.modifiers.map(
      (modifier) => modifier.kind === "boolean"
        ? { ...modifier, operandAssetId: "another-cutter" }
        : modifier,
    ));
    const propertyOrderChanged = createStudioMeshModifierStack(stack.source, stack.modifiers.map(
      (modifier) => modifier.kind === "mirror"
        ? {
            clip: modifier.clip,
            bisect: modifier.bisect,
            mergeThreshold: modifier.mergeThreshold,
            merge: modifier.merge,
            axis: modifier.axis,
            enabled: modifier.enabled,
            id: modifier.id,
            kind: "mirror" as const,
          }
        : modifier,
    ));

    const hash = hashStudioMeshModifierStack(stack);
    expect(hashStudioMeshModifierStack(allModifierStack())).toBe(hash);
    expect(hashStudioMeshModifierStack(reordered)).not.toBe(hash);
    expect(hashStudioMeshModifierStack(parameterChanged)).not.toBe(hash);
    expect(hashStudioMeshModifierStack(operandChanged)).not.toBe(hash);
    expect(hashStudioMeshModifierStack(provenanceChanged)).not.toBe(hash);
    expect(hashStudioMeshModifierStack(propertyOrderChanged)).toBe(hash);
  });

  it("fails closed for extra keys, duplicate IDs, invalid bounds, and corrupt operand indices", () => {
    const stack = allModifierStack();
    const dto = serializeStudioMeshModifierStack(stack);
    const extraKey = {
      ...dto,
      modifiers: [{ ...dto.modifiers[0], surprise: true }],
    };
    const duplicateIds = {
      ...dto,
      modifiers: [dto.modifiers[0], dto.modifiers[0]],
    };
    const invalidCount = {
      ...dto,
      modifiers: [{
        kind: "array",
        id: "bad-array",
        enabled: true,
        count: 65,
        offset: { x: 0, y: 0, z: 0 },
        mode: "linear",
        realizeInstances: true,
      }],
    };
    const boolean = dto.modifiers[2];
    if (boolean?.kind !== "boolean") throw new Error("boolean fixture missing");
    const corruptOperand = {
      ...dto,
      modifiers: [{
        ...boolean,
        operand: { ...boolean.operand, indices: [0, 1, 999_999] },
      }],
    };

    expect(deserializeStudioMeshModifierStack(extraKey, stack.source)).toMatchObject({
      ok: false,
      code: "invalid-stack",
    });
    expect(deserializeStudioMeshModifierStack(duplicateIds, stack.source)).toMatchObject({
      ok: false,
      code: "invalid-stack",
    });
    expect(deserializeStudioMeshModifierStack(invalidCount, stack.source)).toMatchObject({
      ok: false,
      code: "invalid-parameter",
    });
    expect(deserializeStudioMeshModifierStack(corruptOperand, stack.source)).toMatchObject({
      ok: false,
      code: "invalid-parameter",
    });
  });
});

describe("Hybrid DCC document v3 modifier authority", () => {
  it("persists stack state, hashes it, and restores exact typed operands through undo/redo", () => {
    const stack = allModifierStack();
    let session = createStudioHybridDccSession("modifier-v3");
    session = hybridDccRegisterAsset(session, "room", stack.source, RIGHTS);
    const registeredHash = session.state.stateHash;
    const registeredCommandCount = session.state.commandCount;
    const sourceSnapshot = serializeStudioEditableMesh(stack.source);

    session = hybridDccSetModifierStack(session, "room", stack);
    const stackedHash = session.state.stateHash;
    expect(session.state.commandCount).toBe(registeredCommandCount + 1);
    expect(stackedHash).not.toBe(registeredHash);
    expect(session.state.geometry.records.room?.meshHash).toBe(hashStudioEditableMesh(stack.source));
    expect(serializeStudioEditableMesh(session.state.geometry.records.room!.mesh)).toEqual(sourceSnapshot);
    expect(session.journal.records.filter((record) => record.recordType === "command").at(-1))
      .toMatchObject({ command: { kind: "geometry.modifier-stack.set" } });

    const snapshot = snapshotStudioHybridDccState(session.state);
    expect(snapshot.version).toBe(3);
    expect(snapshot.assets[0]?.modifierStack.modifiers).toHaveLength(5);
    const restored = restoreStudioHybridDccStateFromSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
    );
    expect(restored.stateHash).toBe(stackedHash);
    expect(restored.geometry.records.room?.revision)
      .toBe(session.state.geometry.records.room?.revision);
    expect(hashStudioMeshModifierStack(restored.geometry.records.room!.modifierStack))
      .toBe(hashStudioMeshModifierStack(stack));
    expect(restored.geometry.records.room?.modifierStack.modifiers[2]).toMatchObject({
      kind: "boolean",
      operandAssetId: "room-door-cutter",
    });

    session = hybridDccUndo(session);
    expect(session.state.stateHash).toBe(registeredHash);
    expect(session.state.geometry.records.room?.modifierStack.modifiers).toHaveLength(0);
    session = hybridDccRedo(session);
    expect(session.state.stateHash).toBe(stackedHash);
    expect(hashStudioMeshModifierStack(session.state.geometry.records.room!.modifierStack))
      .toBe(hashStudioMeshModifierStack(stack));
  });

  it("applies an evaluated mesh and clears the stack in one atomic undoable command", async () => {
    const source = createStudioUnitCubeMesh();
    const sourceSnapshot = serializeStudioEditableMesh(source);
    const stack = createStudioMeshModifierStack(source, [{
      kind: "array",
      id: "two-columns",
      enabled: true,
      count: 2,
      offset: { x: 2, y: 0, z: 0 },
      mode: "linear",
      realizeInstances: true,
    }]);
    let session = createStudioHybridDccSession("modifier-apply");
    session = hybridDccRegisterAsset(session, "columns", source, RIGHTS);
    session = hybridDccSetModifierStack(session, "columns", stack);
    const stackedStateHash = session.state.stateHash;
    const stackedStackHash = hashStudioMeshModifierStack(
      session.state.geometry.records.columns!.modifierStack,
    );
    const beforeApplyCommandCount = session.state.commandCount;
    const evaluated = await evaluateStudioMeshModifierStack(
      session.state.geometry.records.columns!.modifierStack,
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;

    session = hybridDccApplyModifierStack(session, "columns", {
      ...evaluated.value,
      stackHash: stackedStackHash,
    });
    expect(session.state.commandCount).toBe(beforeApplyCommandCount + 1);
    expect(session.state.geometry.records.columns?.meshHash).toBe(evaluated.value.resultHash);
    expect(session.state.geometry.records.columns?.modifierStack.modifiers).toHaveLength(0);
    expect(serializeStudioEditableMesh(source)).toEqual(sourceSnapshot);
    expect(session.journal.records.filter((record) => record.recordType === "command").at(-1))
      .toMatchObject({ command: { kind: "geometry.modifier-stack.apply" } });
    const appliedStateHash = session.state.stateHash;

    session = hybridDccUndo(session);
    expect(session.state.stateHash).toBe(stackedStateHash);
    expect(session.state.geometry.records.columns?.meshHash).toBe(hashStudioEditableMesh(source));
    expect(hashStudioMeshModifierStack(session.state.geometry.records.columns!.modifierStack))
      .toBe(stackedStackHash);
    session = hybridDccRedo(session);
    expect(session.state.stateHash).toBe(appliedStateHash);
    expect(session.state.geometry.records.columns?.modifierStack.modifiers).toHaveLength(0);
  });

  it("rejects stale source/stack/result receipts without mutating state or journal", async () => {
    const source = createStudioUnitCubeMesh();
    const stack = createStudioMeshModifierStack(source, [{
      kind: "array",
      id: "two-columns",
      enabled: true,
      count: 2,
      offset: { x: 2, y: 0, z: 0 },
      mode: "linear",
      realizeInstances: true,
    }]);
    let session = createStudioHybridDccSession("modifier-stale-apply");
    session = hybridDccRegisterAsset(session, "columns", source, RIGHTS);
    session = hybridDccSetModifierStack(session, "columns", stack);
    const evaluated = await evaluateStudioMeshModifierStack(stack);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    const receipt = {
      ...evaluated.value,
      stackHash: hashStudioMeshModifierStack(stack),
    };
    const stateBefore = session.state;
    const journalBefore = session.journal.records;

    expect(() => hybridDccApplyModifierStack(session, "columns", {
      ...receipt,
      sourceHash: "mesh:00000000",
    })).toThrow(/sourceHash/u);
    expect(() => hybridDccApplyModifierStack(session, "columns", {
      ...receipt,
      resultHash: "mesh:00000000",
    })).toThrow(/resultHash/u);
    expect(session.state).toBe(stateBefore);
    expect(session.journal.records).toEqual(journalBefore);

    const changedStack = createStudioMeshModifierStack(source, [{
      ...stack.modifiers[0] as Extract<StudioMeshModifier, { kind: "array" }>,
      count: 3,
    }]);
    const changed = hybridDccSetModifierStack(session, "columns", changedStack);
    const changedStateBefore = changed.state;
    const changedJournalBefore = changed.journal.records;
    expect(() => hybridDccApplyModifierStack(changed, "columns", receipt))
      .toThrow(/stackHash/u);
    expect(changed.state).toBe(changedStateBefore);
    expect(changed.journal.records).toEqual(changedJournalBefore);
    expect(session.journal.records).toEqual(journalBefore);
  });

  it("migrates v1/v2 assets to empty stacks and rejects a corrupt v3 stack", () => {
    const stack = allModifierStack();
    let session = createStudioHybridDccSession("modifier-migration");
    session = hybridDccRegisterAsset(session, "room", stack.source, RIGHTS);
    session = hybridDccSetModifierStack(session, "room", stack);
    const current = snapshotStudioHybridDccState(session.state);
    const legacyAssets = current.assets.map(({ modifierStack: _modifierStack, ...asset }) => asset);
    const versionTwo = {
      ...current,
      version: 2,
      assets: legacyAssets,
    } as unknown as Parameters<typeof restoreStudioHybridDccStateFromSnapshot>[0];
    const { objectTransforms: _objectTransforms, ...withoutTransforms } = current;
    const versionOne = {
      ...withoutTransforms,
      version: 1,
      assets: legacyAssets,
    } as unknown as Parameters<typeof restoreStudioHybridDccStateFromSnapshot>[0];

    const migratedV2 = restoreStudioHybridDccStateFromSnapshot(versionTwo);
    const migratedV1 = restoreStudioHybridDccStateFromSnapshot(versionOne);
    expect(migratedV2.version).toBe(3);
    expect(migratedV2.geometry.records.room?.modifierStack.modifiers).toHaveLength(0);
    expect(migratedV1.geometry.records.room?.modifierStack.modifiers).toHaveLength(0);
    expect(migratedV1.objectTransforms.room).toMatchObject({
      position: [0, 0, 0],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });

    const corruptV3 = {
      ...current,
      assets: current.assets.map(({ modifierStack: _modifierStack, ...asset }) => asset),
    } as unknown as typeof current;
    expect(() => restoreStudioHybridDccStateFromSnapshot(corruptV3)).toThrow(/modifier stack/u);
  });

  it("registers a room set as one atomic batch command and preflights failures", () => {
    const identity = createStudioHybridDccIdentityTransform();
    let session = createStudioHybridDccSession("room-batch");
    session = hybridDccRegisterAssets(session, [
      { assetId: "floor", mesh: createStudioUnitCubeMesh(), rights: RIGHTS, initialTransform: identity },
      {
        assetId: "wall",
        mesh: createStudioUnitCubeMesh(),
        rights: RIGHTS,
        initialTransform: { ...identity, position: [0, 1, -2] },
      },
    ]);

    expect(session.state.commandCount).toBe(1);
    expect(Object.keys(session.state.geometry.records).sort()).toEqual(["floor", "wall"]);
    expect(session.journal.records.filter((record) => record.recordType === "command"))
      .toHaveLength(1);
    const registered = session;
    session = hybridDccUndo(session);
    expect(Object.keys(session.state.geometry.records)).toHaveLength(0);

    const journalCount = registered.journal.records.length;
    expect(() => hybridDccRegisterAssets(registered, [
      { assetId: "door", mesh: createStudioUnitCubeMesh(), rights: RIGHTS, initialTransform: identity },
      { assetId: "door", mesh: createStudioUnitCubeMesh(), rights: RIGHTS, initialTransform: identity },
    ])).toThrow(/duplicate batch asset/u);
    expect(registered.journal.records).toHaveLength(journalCount);
    expect(Object.keys(registered.state.geometry.records).sort()).toEqual(["floor", "wall"]);
  });

  it("enforces the 256-object document budget before changing journal or state", () => {
    const identity = createStudioHybridDccIdentityTransform();
    const mesh = createStudioUnitCubeMesh();
    let session = createStudioHybridDccSession("asset-budget");
    session = hybridDccRegisterAssets(
      session,
      Array.from({ length: 255 }, (_, index) => ({
        assetId: `asset-${index}`,
        mesh,
        rights: RIGHTS,
        initialTransform: identity,
      })),
    );
    const stateBefore = session.state;
    const journalBefore = session.journal.records;

    expect(() => hybridDccRegisterAssets(session, [
      { assetId: "asset-255", mesh, rights: RIGHTS, initialTransform: identity },
      { assetId: "asset-256", mesh, rights: RIGHTS, initialTransform: identity },
    ])).toThrow(/document asset budget/u);
    expect(session.state).toBe(stateBefore);
    expect(session.journal.records).toEqual(journalBefore);
    expect(Object.keys(session.state.geometry.records)).toHaveLength(255);
  });
});

describe("Hybrid DCC workspace v2 envelope migration", () => {
  it("accepts a checksummed v2 envelope and migrates every legacy snapshot to empty v3 stacks", () => {
    const scope = { userId: "legacy-user", workId: "legacy-room" } as const;
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("legacy-envelope-document"),
      "room",
    );
    const record = workspace.session.state.geometry.records.room!;
    workspace = {
      ...workspace,
      session: hybridDccSetModifierStack(workspace.session, "room", [{
        kind: "solidify",
        id: "legacy-wall-thickness",
        enabled: true,
        thickness: 0.05,
        evenThickness: true,
        rim: true,
      }]),
    };
    const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace,
      scope,
      savedAt: 42,
    });
    const envelope = JSON.parse(new TextDecoder().decode(encoded.bytes)) as Record<string, unknown>;
    const payload = structuredClone(envelope.payload) as {
      session: {
        state: Record<string, unknown>;
        undoStack: Record<string, unknown>[];
        redoStack: Record<string, unknown>[];
      };
    };
    const downgradeSnapshot = (snapshot: Record<string, unknown>) => ({
      ...snapshot,
      version: 2,
      assets: (snapshot.assets as Array<Record<string, unknown>>).map(
        ({ modifierStack: _modifierStack, ...asset }) => asset,
      ),
    });
    payload.session.state = downgradeSnapshot(payload.session.state);
    payload.session.undoStack = payload.session.undoStack.map(downgradeSnapshot);
    payload.session.redoStack = payload.session.redoStack.map(downgradeSnapshot);
    const payloadJson = canonicalStudioCommandJson(payload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const legacyEnvelope = {
      ...envelope,
      documentVersion: 2,
      documentStateHash: payload.session.state.stateHash,
      payload,
      payloadByteLength: payloadBytes.byteLength,
      payloadCrc32: calculateStudioCrc32(payloadBytes),
      sourceHash: `sha256:${sha256HexPortable(payloadBytes)}`,
    };
    const legacyBytes = new TextEncoder().encode(canonicalStudioCommandJson(legacyEnvelope));

    const decoded = decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: legacyBytes,
      scope,
    });
    expect(decoded.workspace?.session.state.version).toBe(3);
    expect(decoded.workspace?.session.state.geometry.records.room?.meshHash).toBe(record.meshHash);
    expect(decoded.workspace?.session.state.geometry.records.room?.modifierStack.modifiers)
      .toHaveLength(0);
    expect(decoded.workspace?.session.undoStack.every((snapshot) => snapshot.version === 3)).toBe(true);
  });
});
