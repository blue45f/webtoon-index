import { describe, expect, it } from "vitest";

import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceBevelEdgesActive,
  workspaceDeleteActive,
  workspaceDuplicateActive,
  workspaceInsetActive,
  workspaceLoopCutActive,
  workspaceSculptActive,
  workspaceSetAssetVisibility,
  workspaceShadeActive,
  workspaceUndo,
  workspaceWeldActive,
} from "./studio-hybrid-dcc-workspace";

function cubeWorkspace(documentId: string) {
  return workspaceAddUnitCube(createStudioHybridDccWorkspace(documentId), "cube");
}

describe("Hybrid DCC product mesh-edit tools", () => {
  it("adds repeated primitive cubes with unique names and visible non-overlapping placement", () => {
    const first = workspaceAddUnitCube(createStudioHybridDccWorkspace("repeat-cubes"));
    const second = workspaceAddUnitCube(first);
    const third = workspaceAddUnitCube(second);
    expect(Object.keys(third.session.state.geometry.records)).toEqual([
      "asset-cube",
      "asset-cube-2",
      "asset-cube-3",
    ]);
    expect(third.session.state.objectTransforms["asset-cube"]?.position).toEqual([0, 0, 0]);
    expect(third.session.state.objectTransforms["asset-cube-2"]?.position).toEqual([1.25, 0, 0]);
    expect(third.session.state.objectTransforms["asset-cube-3"]?.position).toEqual([2.5, 0, 0]);
    expect(third.activeAssetId).toBe("asset-cube-3");
  });

  it("duplicates and reversibly deletes canonical objects with transforms, rights and bridge sync", () => {
    const original = cubeWorkspace("duplicate-delete");
    const duplicate = workspaceDuplicateActive(original);
    expect(duplicate.activeAssetId).toBe("cube-copy");
    expect(Object.keys(duplicate.session.state.geometry.records)).toEqual(["cube", "cube-copy"]);
    expect(duplicate.session.state.geometry.records["cube-copy"]?.meshHash)
      .toBe(original.session.state.geometry.records.cube?.meshHash);
    expect(duplicate.session.state.objectTransforms["cube-copy"]?.position).toEqual([1, 0, 0]);
    expect(duplicate.bridge.set.objects.map(({ id }) => id).sort()).toEqual(["cube", "cube-copy"]);

    const deleted = workspaceDeleteActive(duplicate);
    expect(deleted.activeAssetId).toBeNull();
    expect(deleted.session.state.geometry.records["cube-copy"]).toBeUndefined();
    expect(deleted.bridge.set.objects.map(({ id }) => id)).toEqual(["cube"]);

    const restored = workspaceUndo(deleted);
    expect(restored.session.state.geometry.records["cube-copy"]?.meshHash)
      .toBe(duplicate.session.state.geometry.records["cube-copy"]?.meshHash);
    expect(restored.session.state.objectTransforms["cube-copy"]?.position).toEqual([1, 0, 0]);
    expect(restored.bridge.set.objects.map(({ id }) => id).sort()).toEqual(["cube", "cube-copy"]);
  });

  it("toggles viewport visibility while preserving geometry authority and dirtying shots", () => {
    const original = workspaceAddUnitCube(createStudioHybridDccWorkspace("visibility"));
    const hidden = workspaceSetAssetVisibility(original, "asset-cube", false);
    expect(hidden.session).toBe(original.session);
    expect(hidden.bridge.set.objects[0]?.visible).toBe(false);
    expect(hidden.bridge.commandSequence).toBe(original.bridge.commandSequence + 1);
    expect(hidden.bridge.shots[0]?.dirtyPasses).toEqual(expect.arrayContaining([
      "line",
      "shadow",
      "tone",
      "depth",
      "normal",
      "object-id",
    ]));
    expect(workspaceSetAssetVisibility(hidden, "asset-cube", false)).toBe(hidden);
  });

  it("wires inset, edge bevel, loop cut and merge-by-distance into undoable authority commits", () => {
    const operations = [
      ["inset", workspaceInsetActive],
      ["bevel", workspaceBevelEdgesActive],
      ["loop-cut", workspaceLoopCutActive],
      ["weld", workspaceWeldActive],
    ] as const;

    for (const [name, operation] of operations) {
      const before = cubeWorkspace(`edit-${name}`);
      const beforeRecord = before.session.state.geometry.records.cube!;
      const after = operation(before);
      const afterRecord = after.session.state.geometry.records.cube!;
      expect(afterRecord.revision, name).toBe(beforeRecord.revision + 1);
      expect(after.session.state.commandCount, name).toBe(before.session.state.commandCount + 1);
      expect(after.bridge.set.objects.find(({ id }) => id === "cube")?.geometryHash, name)
        .toBe(afterRecord.meshHash);
      const undone = workspaceUndo(after);
      expect(undone.session.state.geometry.records.cube?.meshHash, name)
        .toBe(beforeRecord.meshHash);
    }
  });

  it("preserves flat/smooth face attributes exactly through snapshot-backed undo", () => {
    const flat = cubeWorkspace("shade-undo");
    const smooth = workspaceShadeActive(flat, true);
    expect(smooth.session.state.geometry.records.cube?.mesh.faces.every((face) => face.smooth))
      .toBe(true);

    const restoredFlat = workspaceUndo(smooth);
    expect(restoredFlat.session.state.geometry.records.cube?.mesh.faces.every((face) => !face.smooth))
      .toBe(true);
  });

  it("sculpts with an explicit brush kind, radius and dig direction", () => {
    const ws = cubeWorkspace("sculpt-options");
    const before = ws.session.state.geometry.records.cube!.meshHash;

    const inflated = workspaceSculptActive(ws, {
      kind: "inflate",
      center: { x: 0, y: 0.5, z: 0 },
      radius: 1,
      strength: 0.25,
    });
    expect(inflated.session.state.geometry.records.cube!.meshHash).not.toBe(before);

    const dug = workspaceSculptActive(ws, {
      kind: "clay",
      center: { x: 0, y: 0.5, z: 0 },
      radius: 1,
      strength: -0.3,
    });
    const dugHash = dug.session.state.geometry.records.cube!.meshHash;
    expect(dugHash).not.toBe(inflated.session.state.geometry.records.cube!.meshHash);

    // 숫자 시그니처 호환 유지: 기존 호출도 같은 결과 경로를 쓴다.
    const legacy = workspaceSculptActive(dug, 0);
    expect(legacy.session.state.geometry.records.cube!.meshHash).toBe(
      dug.session.state.geometry.records.cube!.meshHash,
    );
  });
});
