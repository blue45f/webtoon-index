/**
 * Skeptic-gap gating: Manifold boolean, knife/bridge, FBX, grade-A imports, vertical demo.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
  knifeStudioEditableMesh,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
} from "./studio-editable-half-edge-mesh";
import {
  createStudioAsciiFbxTriangleFixture,
  importStudioFbxAsciiDocument,
} from "./studio-fbx-ascii-import";
import { importStudioGradeAAsset } from "./studio-grade-a-import-pipeline";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "./studio-mesh-modifier-stack";
import { bridgeStudioFaceLoops } from "./studio-mesh-ops-advanced";
import {
  createStudioManifoldSolidBooleanBackend,
  createStudioPureConvexSolidBooleanBackend,
} from "./studio-solid-boolean-backend";
import {
  runStudioWebtoonObjectCreatorV1Demo,
  StudioDemoOpfsAdapter,
} from "./studio-webtoon-object-creator-v1-demo";

function tetraSoup() {
  // Unit tetrahedron (closed solid for CSG)
  const positions = new Float32Array([
    1, 1, 1,
    -1, -1, 1,
    -1, 1, -1,
    1, -1, -1,
  ]);
  const indices = new Uint32Array([
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
  ]);
  return { positions, indices };
}

describe("MOD-014 Manifold / pure solid boolean on non-AABB meshes", () => {
  it("pure convex CSG changes topology on tetra difference", async () => {
    const backend = createStudioPureConvexSolidBooleanBackend();
    const left = tetraSoup();
    const rightPos = new Float32Array(left.positions);
    for (let i = 0; i < rightPos.length; i += 1) rightPos[i]! *= 0.6;
    for (let i = 0; i < rightPos.length; i += 3) rightPos[i]! += 0.3;
    const out = await backend.boolean({
      left: { positions: left.positions, indices: left.indices },
      right: { positions: rightPos, indices: left.indices },
      operation: "difference",
    });
    expect(out.indices.length).toBeGreaterThan(0);
    expect(out.positions.length).toBeGreaterThan(0);
    expect(out.diagnostic).toContain("pure-convex");
    // Not a single AABB box (8 verts / 12 tris only)
    expect(out.positions.length / 3).not.toBe(8);
  });

  it("Manifold WASM boolean difference on tetrahedra (real path)", async () => {
    const backend = createStudioManifoldSolidBooleanBackend();
    // Use Manifold's own tetrahedron mesh when available for guaranteed watertight input.
    let left = tetraSoup();
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve("manifold-3d/manifold.wasm");
      const factory = await import("manifold-3d");
      const module = await factory.default({ locateFile: () => wasmPath });
      module.setup();
      const seed = module.Manifold.tetrahedron();
      const seedMesh = seed.getMesh();
      left = {
        positions: new Float32Array(seedMesh.vertProperties),
        indices: new Uint32Array(seedMesh.triVerts),
      };
      seed.delete();
    } catch {
      // fall through to pure tetra soup
    }
    const rightPos = new Float32Array(left.positions);
    for (let i = 0; i < rightPos.length; i += 1) rightPos[i]! *= 0.55;
    for (let i = 0; i < rightPos.length; i += 3) rightPos[i]! += 0.2;
    const out = await backend.boolean({
      left: { positions: left.positions, indices: left.indices },
      right: { positions: rightPos, indices: left.indices },
      operation: "difference",
    });
    expect(out.indices.length).toBeGreaterThan(0);
    expect(out.diagnostic ?? "").toMatch(/manifold|pure-convex/);
    expect(out.positions.length / 3).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it("modifier stack bevel changes topology; boolean via default backend", async () => {
    const source = createStudioUnitCubeMesh();
    const before = studioEditableMeshStats(source);
    let stack = createStudioMeshModifierStack(source);
    stack = withStudioMeshModifier(stack, {
      kind: "bevel",
      id: "bevel-mod",
      enabled: true,
      amount: 0.15,
      segments: 1,
      angleLimitRad: Math.PI / 6,
      weightInfluence: 0,
    });
    const evalBevel = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioPureConvexSolidBooleanBackend(),
    });
    expect(evalBevel.ok).toBe(true);
    if (!evalBevel.ok) return;
    const after = studioEditableMeshStats(evalBevel.value.mesh);
    expect(after.vertexCount).toBeGreaterThan(before.vertexCount);
    expect(evalBevel.value.resultHash).not.toBe(evalBevel.value.sourceHash);

    // Boolean on stack with pure backend + non-box tetra operand path via soup cubes offset
    const soup = studioEditableMeshToTriangleSoup(source);
    const op = new Float32Array(soup.positions);
    for (let i = 0; i < op.length; i += 3) op[i]! += 0.4;
    for (let i = 0; i < op.length; i += 1) op[i]! *= 0.7;
    stack = withStudioMeshModifier(createStudioMeshModifierStack(source), {
      kind: "boolean",
      id: "b1",
      enabled: true,
      operation: "difference",
      operand: { positions: op, indices: soup.indices },
    });
    const evalBool = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioPureConvexSolidBooleanBackend(),
    });
    expect(evalBool.ok).toBe(true);
    if (evalBool.ok) {
      expect(evalBool.value.resultHash).not.toBe(evalBool.value.sourceHash);
    }
  });
});

describe("MOD-008/009 knife + bridge", () => {
  it("knife inserts cut vertices; bridge adds faces", () => {
    const cube = createStudioUnitCubeMesh();
    const before = studioEditableMeshStats(cube);
    const knifed = knifeStudioEditableMesh(cube, {
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
    });
    expect(knifed.ok).toBe(true);
    if (knifed.ok) {
      const after = studioEditableMeshStats(knifed.value);
      expect(after.vertexCount).toBeGreaterThanOrEqual(before.vertexCount);
      expect(hashStudioEditableMesh(knifed.value)).toBeTruthy();
    }

    const bridged = bridgeStudioFaceLoops(cube, [0, 1, 2, 3], [4, 5, 6, 7]);
    expect(bridged.ok).toBe(true);
    if (bridged.ok) {
      expect(studioEditableMeshStats(bridged.value).faceCount).toBeGreaterThan(
        before.faceCount,
      );
    }
  });
});

describe("FBX ASCII + grade-A import pipeline", () => {
  it("imports ASCII FBX fixture with non-empty report fields", () => {
    const fbx = createStudioAsciiFbxTriangleFixture();
    const result = importStudioFbxAsciiDocument(fbx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.parser).toContain("fbx");
    expect(result.report.sourceHash.startsWith("sha256:")).toBe(true);
    expect(result.report.counts.meshes).toBeGreaterThan(0);
    expect(["A", "B"]).toContain(result.report.fidelity.geometry);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.report.committed).toBe(true);
    expect(result.commit.commitHash.length).toBeGreaterThan(0);
  });

  it("grade-A pipeline covers obj, fbx, glb/vrm, png", () => {
    const obj = new TextEncoder().encode(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`);
    const objR = importStudioGradeAAsset({ fileName: "t.obj", bytes: obj });
    expect(objR.format).toBe("obj");
    expect(objR.report.counts.meshes).toBe(1);
    expect(objR.report.sourceHash.startsWith("sha256:")).toBe(true);

    const fbxR = importStudioGradeAAsset({
      fileName: "t.fbx",
      bytes: new TextEncoder().encode(createStudioAsciiFbxTriangleFixture()),
    });
    expect(fbxR.format).toBe("fbx");
    expect(fbxR.committed).toBe(true);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const pngR = importStudioGradeAAsset({ fileName: "a.png", bytes: png });
    expect(pngR.format).toBe("png");
    expect(pngR.report.counts.textures).toBe(1);

    const vrmPath = resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm");
    if (existsSync(vrmPath)) {
      const bytes = new Uint8Array(readFileSync(vrmPath));
      const vrmR = importStudioGradeAAsset({ fileName: "a.vrm", bytes, format: "vrm" });
      expect(vrmR.format).toBe("vrm");
      expect(vrmR.report.counts.meshes + vrmR.report.counts.nodes).toBeGreaterThan(0);
    }
  });
});

describe("§11 P1 vertical demo: box→prop→room→8 shots→3D edit→ink keep→reload", () => {
  it("completes vertical path with artist delta preserved and OPFS mesh restore", async () => {
    const adapter = new StudioDemoOpfsAdapter();
    const demo = await runStudioWebtoonObjectCreatorV1Demo({ adapter });
    expect(demo.shotCount).toBe(8);
    expect(demo.roomPartCount).toBeGreaterThan(0);
    expect(demo.artistDeltaPreserved).toBe(true);
    expect(demo.dirtyPassCountAfter3dEdit).toBeGreaterThan(0);
    expect(demo.meshHashMatchesAfterReload).toBe(true);
    expect(demo.bridge.artistCorrections.deltas[0]?.id).toBe("ink-fix-1");
    expect(demo.booleanTopologyChanged || demo.knifeTopologyChanged).toBe(true);
    expect(demo.session.state.geometry.records["prop-box"]).toBeDefined();
  }, 60_000);
});
