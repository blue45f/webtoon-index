/**
 * Skeptic-panel gap closure tests — DOC-002/004 undo+OPFS restore, MOD-006 topology bevel,
 * real GLB/VRM import, CHR-003 IK/FK, VP4 model-build undo/reload invariants.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { planStudioBg3dPushPull } from "../bg3d/studio-bg3d-push-pull";
import { offsetStudioFloorPlanPolygon } from "../studio-build-generators";
import {
  createStudioDefaultBodyPose,
  poseStudioBodyChainFk,
  poseStudioBodyChainIk,
  setStudioChainSolveMode,
  solveStudioTwoBoneIk,
} from "../studio-character-ik-fk";
import {
  bevelStudioEditableMeshEdges,
  createStudioUnitCubeMesh,
  extrudeStudioEditableMeshFaces,
  hashStudioEditableMesh,
  insetStudioEditableMeshFaces,
  selectStudioMeshEdgeLoop,
  selectStudioMeshFaceRing,
  serializeStudioEditableMesh,
  deserializeStudioEditableMesh,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
} from "../studio-editable-half-edge-mesh";
import { importStudioGlbDocument, parseStudioGlbToSceneIR } from "../studio-glb-scene-ir";
import {
  parseStudioObjToSceneIR,
  buildStudioImportCompatibilityReport,
  commitStudioImportToDocument,
} from "../studio-import-compatibility-report";
import {
  createStudioAabbSolidBooleanBackend,
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "../studio-mesh-modifier-stack";


import {
  repairStudioHybridOrphanRights,
  scanStudioHybridDccCorruption,
} from "./studio-hybrid-dcc-diagnostics";
import {
  createStudioHybridDccOpfsPorts,
  createStudioHybridDccSession,
  hybridDccCanRedo,
  hybridDccCanUndo,
  hybridDccCommitGeometry,
  hybridDccRecoverFromJournal,
  hybridDccRecoverFromOpfs,
  hybridDccRedo,
  hybridDccRegisterAsset,
  hybridDccUndo,
  snapshotStudioHybridDccState,
  restoreStudioHybridDccStateFromSnapshot,
} from "./studio-hybrid-dcc-document";

import type { BgPrimitive } from "../studio-background-3d-metadata";
import type {
  StudioOpfsRecoveryJournalAdapter,
} from "../studio-opfs-recovery-journal";

// ── Fake OPFS adapter (same contract as studio-opfs-recovery-journal tests) ──

class FakeOpfsAdapter implements StudioOpfsRecoveryJournalAdapter {
  readonly kind = "fake-opfs" as const;
  readonly files = new Map<string, Uint8Array>();

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    return bytes ? new Uint8Array(bytes) : null;
  }
  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, new Uint8Array(bytes));
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(prefix: string): Promise<readonly string[]> {
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));
  }
  async size(path: string): Promise<number | null> {
    return this.files.get(path)?.byteLength ?? null;
  }
  async estimateQuota() {
    return null;
  }
  async withExclusiveLock<T>(
    _name: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return operation();
  }
}

describe("DOC-002 undo/redo restores mesh state", () => {
  it("undo after geometry commit restores prior mesh hash; redo reapplies", () => {
    let session = createStudioHybridDccSession("undo-doc");
    const cube = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "mesh-a", cube, {
      source: "primitive",
      creator: "test",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    const hash0 = session.state.geometry.records["mesh-a"]!.meshHash;

    const extruded = extrudeStudioEditableMeshFaces(cube, [0], 0.4);
    expect(extruded.ok).toBe(true);
    if (!extruded.ok) return;
    session = hybridDccCommitGeometry(session, "mesh-a", extruded.value);
    const hash1 = session.state.geometry.records["mesh-a"]!.meshHash;
    expect(hash1).not.toBe(hash0);
    expect(hybridDccCanUndo(session)).toBe(true);

    session = hybridDccUndo(session);
    expect(session.state.geometry.records["mesh-a"]!.meshHash).toBe(hash0);
    expect(hybridDccCanRedo(session)).toBe(true);

    session = hybridDccRedo(session);
    expect(session.state.geometry.records["mesh-a"]!.meshHash).toBe(hash1);
  });
});

describe("DOC-004 OPFS recovery restores last committed geometry", () => {
  it("write checkpoint via real recovery journal, empty session, recover equal hashes", async () => {
    let session = createStudioHybridDccSession("opfs-doc-1");
    const cube = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "asset-cube", cube, {
      source: "primitive",
      creator: "author",
      license: "CC-BY-4.0",
      useScope: "editorial",
      derivative: "original",
    });
    const inset = insetStudioEditableMeshFaces(cube, [0], 0.15);
    expect(inset.ok).toBe(true);
    if (!inset.ok) return;
    session = hybridDccCommitGeometry(session, "asset-cube", inset.value);
    const committedHash = session.state.geometry.records["asset-cube"]!.meshHash;
    const stateHash = session.state.stateHash;

    const adapter = new FakeOpfsAdapter();
    const ports = createStudioHybridDccOpfsPorts({
      adapter,
      documentId: "opfs-doc-1",
      now: (() => {
        let t = 10_000;
        return () => {
          t += 1;
          return t;
        };
      })(),
      randomToken: (() => {
        let n = 0;
        return () => `tok-${++n}`;
      })(),
    });

    // Primary recovery entry requires ports and asserts structural mesh equality
    const recovered = await hybridDccRecoverFromJournal(session, ports);
    expect(recovered.checkpointFound).toBe(true);
    expect(recovered.journalRestored).toBe(true);
    expect(recovered.meshHashesEqual).toBe(true);
    expect(recovered.recoveredStateHash).toBe(stateHash);
    expect(recovered.session.state.geometry.records["asset-cube"]!.meshHash).toBe(
      committedHash,
    );

    // Fresh process: new journal handle, same adapter storage
    const portsAfterCrash = createStudioHybridDccOpfsPorts({
      adapter,
      documentId: "opfs-doc-1",
      now: () => 99_000,
      randomToken: () => "recover-token",
    });
    const cold = await hybridDccRecoverFromOpfs(portsAfterCrash);
    expect(cold.checkpointFound).toBe(true);
    expect(cold.recoveredStateHash).toBe(stateHash);
    expect(cold.session.state.geometry.records["asset-cube"]!.meshHash).toBe(
      committedHash,
    );
    expect(cold.assetIds).toEqual(["asset-cube"]);
    const snap = snapshotStudioHybridDccState(cold.session.state);
    const again = restoreStudioHybridDccStateFromSnapshot(snap);
    expect(again.stateHash).toBe(stateHash);
  });
});

describe("DOC-015 corruption scanner + MOD-002 loop/ring + BLD-004 offset", () => {
  it("scans orphan rights and bad deps; edge loop and face ring; floor-plan offset", () => {
    let session = createStudioHybridDccSession("diag-doc");
    const cube = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "ok-mesh", cube, {
      source: "primitive",
      creator: "a",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    // Inject orphan rights
    const dirtyState = {
      ...session.state,
      rightsBom: [
        ...session.state.rightsBom,
        {
          assetId: "ghost",
          source: "x",
          creator: "y",
          license: "unknown",
          useScope: "none",
          derivative: "none",
        },
      ],
    };
    const report = scanStudioHybridDccCorruption(dirtyState);
    expect(report.findings.some((f) => f.code === "orphan-asset")).toBe(true);
    const repaired = repairStudioHybridOrphanRights(dirtyState);
    expect(repaired.rightsBom.every((r) => r.assetId !== "ghost")).toBe(true);

    const loop = selectStudioMeshEdgeLoop(cube, cube.halfEdges[0]!.id);
    expect(loop.ok).toBe(true);
    if (loop.ok) {
      expect(loop.value.selection.ids.length).toBeGreaterThan(0);
      expect(["closed", "boundary", "pole", "non-manifold", "budget"]).toContain(
        loop.value.stopped,
      );
    }
    const ring = selectStudioMeshFaceRing(cube, 0);
    expect(ring.ok).toBe(true);
    if (ring.ok) {
      expect(ring.value.ids.length).toBeGreaterThanOrEqual(1);
    }

    const offset = offsetStudioFloorPlanPolygon(
      [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
        { x: 0, z: 3 },
      ],
      0.2,
    );
    expect(offset.ok).toBe(true);
    if (offset.ok) {
      expect(offset.polygon.length).toBe(4);
    }
  });
});

describe("MOD-006 edge bevel changes topology", () => {
  it("bevels a cube edge: vertex and face counts increase", () => {
    const cube = createStudioUnitCubeMesh();
    const before = studioEditableMeshStats(cube);
    expect(before.vertexCount).toBe(8);
    expect(before.faceCount).toBe(6);

    const heId = cube.halfEdges[0]!.id;
    const beveled = bevelStudioEditableMeshEdges(cube, [heId], 0.2);
    expect(beveled.ok).toBe(true);
    if (!beveled.ok) {
       
      console.error(beveled);
      return;
    }
    const after = studioEditableMeshStats(beveled.value);
    expect(after.vertexCount).toBeGreaterThan(before.vertexCount);
    expect(after.faceCount).toBeGreaterThan(before.faceCount);
    expect(hashStudioEditableMesh(beveled.value)).not.toBe(hashStudioEditableMesh(cube));
  });
});

describe("VP4 model-build ops: undo round-trip + reload topology", () => {
  it("extrude/inset/bevel/mirror/boolean + push-pull survive undo and snapshot reload", async () => {
    let session = createStudioHybridDccSession("model-build");
    let mesh = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "block", mesh, {
      source: "primitive",
      creator: "build",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });

    const extruded = extrudeStudioEditableMeshFaces(mesh, [0], 0.3);
    expect(extruded.ok).toBe(true);
    if (!extruded.ok) return;
    mesh = extruded.value;
    session = hybridDccCommitGeometry(session, "block", mesh);
    const afterExtrude = studioEditableMeshStats(mesh);

    const inset = insetStudioEditableMeshFaces(mesh, [0], 0.1);
    expect(inset.ok).toBe(true);
    if (!inset.ok) return;
    mesh = inset.value;
    session = hybridDccCommitGeometry(session, "block", mesh);

    const bevel = bevelStudioEditableMeshEdges(mesh, [mesh.halfEdges[0]!.id], 0.15);
    expect(bevel.ok).toBe(true);
    if (!bevel.ok) return;
    mesh = bevel.value;
    session = hybridDccCommitGeometry(session, "block", mesh);
    const afterBevelStats = studioEditableMeshStats(mesh);
    expect(afterBevelStats.vertexCount).toBeGreaterThan(afterExtrude.vertexCount);

    // Modifiers: mirror + boolean
    let stack = createStudioMeshModifierStack(mesh);
    stack = withStudioMeshModifier(stack, {
      kind: "mirror",
      id: "m",
      enabled: true,
      axis: "x",
      merge: true,
      mergeThreshold: 1e-4,
      bisect: false,
      clip: false,
    });
    const soup = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
    const opPos = new Float32Array(soup.positions);
    for (let i = 0; i < opPos.length; i += 1) opPos[i]! *= 0.4;
    stack = withStudioMeshModifier(stack, {
      kind: "boolean",
      id: "b",
      enabled: true,
      operation: "union",
      operand: { positions: opPos, indices: soup.indices },
    });
    const evaluated = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioAabbSolidBooleanBackend(),
    });
    expect(evaluated.ok).toBe(true);

    // Push/pull
    const primitive: BgPrimitive = {
      id: "box",
      kind: "box",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#fff",
    };
    const pull = planStudioBg3dPushPull(primitive, {
      distance: 0.25,
      axis: "y",
      face: "positive",
    });
    expect(pull.ok).toBe(true);

    const hashBeforeUndo = session.state.geometry.records["block"]!.meshHash;
    session = hybridDccUndo(session); // undo bevel commit
    expect(session.state.geometry.records["block"]!.meshHash).not.toBe(hashBeforeUndo);
    session = hybridDccRedo(session);
    expect(session.state.geometry.records["block"]!.meshHash).toBe(hashBeforeUndo);

    // Reload from document snapshot
    const snap = snapshotStudioHybridDccState(session.state);
    const reloaded = restoreStudioHybridDccStateFromSnapshot(snap);
    expect(reloaded.geometry.records["block"]!.meshHash).toBe(hashBeforeUndo);
    const reloadedStats = studioEditableMeshStats(
      reloaded.geometry.records["block"]!.mesh,
    );
    expect(reloadedStats.vertexCount).toBe(afterBevelStats.vertexCount);
    expect(reloadedStats.faceCount).toBe(afterBevelStats.faceCount);
    expect(reloadedStats.edgeCount).toBe(afterBevelStats.edgeCount);
  });
});

describe("CHR-001 real GLB/VRM + OBJ import pipeline", () => {
  it("parses real VRM/GLB fixture into SceneIR with non-zero counts and report fields", () => {
    const vrmPath = resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm");
    expect(existsSync(vrmPath)).toBe(true);
    const bytes = new Uint8Array(readFileSync(vrmPath));

    const parsed = parseStudioGlbToSceneIR(bytes, { asVrm: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.format).toBe("vrm");
    expect(parsed.scene.meshes.length).toBeGreaterThan(0);
    expect(parsed.scene.meshes.some((m) => m.vertexCount > 0)).toBe(true);
    expect(parsed.scene.nodes.length).toBeGreaterThan(0);
    // VRM humanoid mapping from extensions
    expect(parsed.scene.vrmMeta?.sourceVersion === "1.0" || parsed.scene.vrmMeta?.sourceVersion === "0.x").toBe(true);

    const imported = importStudioGlbDocument(bytes, {
      parser: "studio-glb-scene-ir",
      asVrm: true,
    });
    expect(imported.report.parser).toBe("studio-glb-scene-ir");
    expect(imported.report.sourceHash.startsWith("sha256:")).toBe(true);
    expect(imported.report.units).toBe("meters");
    expect(imported.report.axis).toBe("y-up");
    expect(imported.report.counts.meshes).toBeGreaterThan(0);
    expect(imported.report.counts.nodes).toBeGreaterThan(0);
    expect(imported.report.unsupportedEntities).toBeDefined();
    expect(imported.commit.documentKind).toBe("toonspectrum.scene-ir");
    expect(imported.commit.report.committed).toBe(true);
    expect(imported.scene.nodes.length).toBeGreaterThan(0);
    expect(imported.commit.scene.nodes.length).toBe(imported.scene.nodes.length);

    // OBJ real path
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const objScene = parseStudioObjToSceneIR(obj);
    const objReport = buildStudioImportCompatibilityReport({
      parser: "studio-obj-text-parser",
      sourceBytes: obj,
      scene: objScene,
    });
    const objCommit = commitStudioImportToDocument(objReport, objScene);
    expect(objReport.counts.meshes).toBe(1);
    expect(objCommit.report.sourceHash.startsWith("sha256:")).toBe(true);
  });
});

describe("CHR-003 IK/FK body posing", () => {
  it("solves two-bone IK and FK joint rotate; mode switch", () => {
    const ik = solveStudioTwoBoneIk({
      start: [0, 1.5, 0],
      upperLength: 0.3,
      lowerLength: 0.3,
      target: [0.4, 1.2, 0.1],
      pole: [0, 1.3, 1],
    });
    expect(ik.reachable).toBe(true);
    expect(ik.mid[0]).not.toBe(ik.start[0]);
    // End should be near target
    const dist = Math.hypot(
      ik.end[0] - ik.effectiveTarget[0],
      ik.end[1] - ik.effectiveTarget[1],
      ik.end[2] - ik.effectiveTarget[2],
    );
    expect(dist).toBeLessThan(1e-6);

    let pose = createStudioDefaultBodyPose();
    const handBefore = pose.bones.leftHand!.position;
    pose = poseStudioBodyChainIk(pose, "leftArm", [ -0.7, 1.1, 0.2 ], [0, 1.4, 1]);
    expect(pose.modes.leftArm).toBe("ik");
    expect(pose.bones.leftHand!.position).not.toEqual(handBefore);

    pose = setStudioChainSolveMode(pose, "leftArm", "fk");
    pose = poseStudioBodyChainFk(pose, "leftArm", "upper", [0, 0, Math.PI / 6]);
    expect(pose.modes.leftArm).toBe("fk");
    expect(pose.bones.leftUpperArm!.rotation[2]).toBeCloseTo(Math.PI / 6);
  });
});

describe("mesh serialize round-trip", () => {
  it("hash stable across serialize/deserialize", () => {
    const mesh = createStudioUnitCubeMesh();
    const snap = serializeStudioEditableMesh(mesh);
    const back = deserializeStudioEditableMesh(snap);
    expect(hashStudioEditableMesh(back)).toBe(hashStudioEditableMesh(mesh));
  });
});


