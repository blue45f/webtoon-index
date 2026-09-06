import { describe, expect, it } from "vitest";

import { createStudioUnitCubeMesh } from "../studio-editable-half-edge-mesh";

import {
  hybridDccCommitObjectTransform,
  hybridDccRedo,
  hybridDccRegisterAsset,
  hybridDccUndo,
  restoreStudioHybridDccStateFromSnapshot,
  snapshotStudioHybridDccState,
  createStudioHybridDccSession,
} from "./studio-hybrid-dcc-document";
import {
  inverseTransformStudioHybridDccPoint,
  normalizeStudioHybridDccObjectTransform,
  transformStudioHybridDccPoint,
} from "./studio-hybrid-dcc-object-transform";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceCommitObjectTransform,
  workspaceRedo,
  workspaceUndo,
} from "./studio-hybrid-dcc-workspace";

const RIGHTS = {
  source: "primitive",
  creator: "studio",
  license: "CC0-1.0",
  useScope: "commercial",
  derivative: "original",
} as const;

const TRANSFORM = {
  revision: 1 as const,
  position: [4, 2, -3] as const,
  rotationEulerRad: [0, Math.PI / 2, 0] as const,
  scale: [2, 0.5, -1] as const,
};

describe("Hybrid DCC canonical object transforms", () => {
  it("stores transform authority separately from mesh and restores it through undo/redo", () => {
    let session = createStudioHybridDccSession("transform-document");
    session = hybridDccRegisterAsset(session, "cube", createStudioUnitCubeMesh(), RIGHTS);
    const meshHash = session.state.geometry.records.cube?.meshHash;
    const beforeHash = session.state.stateHash;

    session = hybridDccCommitObjectTransform(session, "cube", TRANSFORM);
    expect(session.state.objectTransforms.cube).toEqual(TRANSFORM);
    expect(session.state.geometry.records.cube?.meshHash).toBe(meshHash);
    expect(session.state.stateHash).not.toBe(beforeHash);
    expect(session.journal.records.filter((record) => record.recordType === "command").at(-1))
      .toMatchObject({ command: { kind: "object.transform" } });

    const transformedHash = session.state.stateHash;
    session = hybridDccUndo(session);
    expect(session.state.objectTransforms.cube).toMatchObject({
      position: [0, 0, 0],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });
    session = hybridDccRedo(session);
    expect(session.state.objectTransforms.cube).toEqual(TRANSFORM);
    expect(session.state.stateHash).toBe(transformedHash);
  });

  it("round-trips canonical placement in the durable document snapshot", () => {
    let session = createStudioHybridDccSession("transform-snapshot");
    session = hybridDccRegisterAsset(session, "cube", createStudioUnitCubeMesh(), RIGHTS);
    session = hybridDccCommitObjectTransform(session, "cube", TRANSFORM);

    const snapshot = snapshotStudioHybridDccState(session.state);
    const restored = restoreStudioHybridDccStateFromSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
    );

    expect(snapshot.version).toBe(3);
    expect(restored.objectTransforms.cube).toEqual(TRANSFORM);
    expect(restored.stateHash).toBe(session.state.stateHash);
  });

  it("migrates version-1 snapshots by assigning an explicit identity transform", () => {
    let session = createStudioHybridDccSession("legacy-transform-migration");
    session = hybridDccRegisterAsset(session, "cube", createStudioUnitCubeMesh(), RIGHTS);
    const current = snapshotStudioHybridDccState(session.state);
    const { objectTransforms: _discardedTransforms, ...withoutTransforms } = current;
    const legacy = {
      ...withoutTransforms,
      version: 1,
    } as unknown as Parameters<typeof restoreStudioHybridDccStateFromSnapshot>[0];

    const migrated = restoreStudioHybridDccStateFromSnapshot(legacy);
    expect(migrated.version).toBe(3);
    expect(migrated.objectTransforms.cube).toMatchObject({
      position: [0, 0, 0],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it("keeps the live 2D/3D bridge and shot dirty state aligned through workspace undo/redo", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("transform-workspace"),
      "cube",
    );
    workspace = workspaceCommitObjectTransform(workspace, "cube", TRANSFORM);

    expect(workspace.bridge.set.objects.find(({ id }) => id === "cube")?.transform)
      .toEqual(TRANSFORM);
    expect(workspace.bridge.shots[0]?.dirtyPasses.length).toBeGreaterThan(0);

    workspace = workspaceUndo(workspace);
    expect(workspace.bridge.set.objects.find(({ id }) => id === "cube")?.transform?.position)
      .toEqual([0, 0, 0]);
    workspace = workspaceRedo(workspace);
    expect(workspace.bridge.set.objects.find(({ id }) => id === "cube")?.transform)
      .toEqual(TRANSFORM);
  });

  it("matches intrinsic XYZ/Three transform math and rejects corrupt or singular values", () => {
    expect(transformStudioHybridDccPoint([1, 0, 0], TRANSFORM)).toEqual([4, 2, -5]);
    const local = [0.125, -0.75, 1.5] as const;
    const world = transformStudioHybridDccPoint(local, TRANSFORM);
    const roundTrip = inverseTransformStudioHybridDccPoint(world, TRANSFORM);
    expect(roundTrip[0]).toBeCloseTo(local[0], 12);
    expect(roundTrip[1]).toBeCloseTo(local[1], 12);
    expect(roundTrip[2]).toBeCloseTo(local[2], 12);
    expect(() => normalizeStudioHybridDccObjectTransform({
      ...TRANSFORM,
      position: [Number.NaN, 0, 0],
    })).toThrow(/finite/u);
    expect(() => normalizeStudioHybridDccObjectTransform({
      ...TRANSFORM,
      scale: [1, 0, 1],
    })).toThrow(/scale/u);
    expect(() => hybridDccCommitObjectTransform(
      createStudioHybridDccSession("missing-transform"),
      "missing",
      TRANSFORM,
    )).toThrow(/not found/u);
  });
});
