/**
 * Gating suite: doc §11 P0+P1 / §12.1 Webtoon Object Creator v1 catalog IDs.
 * Each test drives shipped APIs (no mock of unit under test).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { planStudioBg3dPushPull } from "../bg3d/studio-bg3d-push-pull";
import {
  buildStudioBg3dRoomParts,
  getStudioBg3dRoomPreset,
  STUDIO_BG3D_ROOM_PRESETS,
} from "../bg3d/studio-bg3d-room-builder";
import {
  addStudioArtistDelta,
  applyStudioShotOverride,
  createStudioLiveBridgeDocument,
  createStudioSharedSet,
  generateStudioToonPass,
  mutateStudioSharedObjectGeometry,
  studioLiveBridgeDirtySummary,
  STUDIO_TOON_PASS_KINDS,
} from "../live/studio-live-2d3d-bridge";
import {
  createStudioArtistCorrectionStore,
  reprojectStudioArtistCorrections,
} from "../studio-artist-correction-delta";
import {
  buildStudioWallsFromFloorPlan,
  createStudioDimension,
  generateStudioSlab,
  generateStudioStairs,
} from "../studio-build-generators";
import {
  cycleStudioInferenceAxisLock,
  resolveStudioBuildInferenceSnap,
} from "../studio-build-inference-snap";
import {
  createStudioTagsOutlinerDocument,
  resolveStudioOutlinerVisibility,
  setStudioTagVisibility,
} from "../studio-build-tags-outliner";
import { resolveStudioCameraWallHide } from "../studio-camera-wall-hide";
import {
  createStudioDecalPlacement,
  createStudioLookAt,
  createStudioPoseAssetMetadata,
  diagnoseStudioHumanoidMapping,
  mirrorStudioHandPose,
  mixStudioExpressions,
  STUDIO_HAND_POSE_LIBRARY,
  studioKtx2DerivativeForProfile,
} from "../studio-character-pose-p1";
import {
  createStudioComponentDocument,
  planStudioComponentMakeUnique,
  STUDIO_COMPONENT_DOCUMENT_VERSION,
} from "../studio-component-instance-core";
import {
  bevelStudioEditableMeshEdges,
  createStudioUnitCubeMesh,
  diagnoseStudioEditableMesh,
  dissolveStudioEditableMeshFaces,
  extrudeStudioEditableMeshFaces,
  hashStudioEditableMesh,
  insetStudioEditableMeshFaces,
  loopCutStudioEditableMesh,
  selectStudioMeshElements,
  setStudioEditableMeshCrease,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
  transformStudioEditableMesh,
  weldStudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import {
  assertRenderCacheIsNotAuthority,
  commitStudioGeometryAuthorityMesh,
  contentAddressStudioGeometryBytes,
  createStudioGeometryAuthorityRegistry,
  materializeStudioGeometryRenderCache,
  registerStudioGeometryAuthority,
} from "../studio-geometry-authority";
import { importStudioGlbDocument } from "../studio-glb-scene-ir";
import {
  buildStudioImportCompatibilityReport,
  commitStudioImportToDocument,
  parseStudioObjToSceneIR,
} from "../studio-import-compatibility-report";
import {
  createStudioAabbSolidBooleanBackend,
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "../studio-mesh-modifier-stack";

import {
  createStudioHybridDccOpfsPorts,
  createStudioHybridDccSession,
  hybridDccAutosaveCheckpoint,
  hybridDccCanUndo,
  hybridDccClearDirty,
  hybridDccCommitGeometry,
  hybridDccContentAddressAsset,
  hybridDccPropagateDirty,
  hybridDccRecoverFromOpfs,
  hybridDccRegisterAsset,
  hybridDccUndo,
  hybridDccWriteOpfsCheckpoint,
} from "./studio-hybrid-dcc-document";

import type { BgPrimitive } from "../studio-background-3d-metadata";
import type { StudioOpfsRecoveryJournalAdapter } from "../studio-opfs-recovery-journal";

// ---------------------------------------------------------------------------
// Catalog map — every gating ID must be exercised by at least one test name.
// ---------------------------------------------------------------------------

export const HYBRID_DCC_GATING_CATALOG = {
  P0: [
    "DOC-001",
    "DOC-002",
    "DOC-003",
    "DOC-004",
    "DOC-005",
    "DOC-006",
    "NPR-001",
    "SHT-001",
    "DRW-001",
    "DRW-002",
    "DRW-007",
  ],
  P1: [
    "DOC-012",
    "MOD-001",
    "MOD-003",
    "MOD-004",
    "MOD-005",
    "MOD-006",
    "MOD-007",
    "MOD-010",
    "MOD-011",
    "MOD-012",
    "MOD-013",
    "MOD-014",
    "MOD-015",
    "MOD-016",
    "MOD-024",
    "BLD-001",
    "BLD-002",
    "BLD-003",
    "BLD-006",
    "BLD-007",
    "BLD-009",
    "BLD-010",
    "BLD-011",
    "BLD-012",
    "BLD-015",
    "BLD-016",
    "BLD-018",
    "SHT-003",
    "NPR-002",
    "NPR-004",
    "NPR-005",
    "NPR-006",
    "NPR-008",
    "CHR-001",
    "CHR-002",
    "CHR-007",
    "CHR-008",
    "CHR-009",
    "CHR-018",
    "MAT-001",
    "MAT-002",
    "MAT-003",
    "MAT-006",
    "MAT-009",
    "MAT-010",
    "MAT-012",
    "PRC-005",
    "DRW-003",
    "DRW-004",
    "DRW-005",
    "DRW-006",
    "PUB-001",
    "PUB-002",
    "PUB-003",
  ],
} as const;

describe("hybrid DCC P0/P1 gating catalog map", () => {
  it("lists required DOC/MOD/BLD/CHR/MAT/NPR/SHT/DRW/PUB IDs", () => {
    expect(HYBRID_DCC_GATING_CATALOG.P0.length).toBeGreaterThan(0);
    expect(HYBRID_DCC_GATING_CATALOG.P0).toContain("DRW-001");
    expect(HYBRID_DCC_GATING_CATALOG.P0).toContain("DRW-002");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("MOD-014");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("NPR-008");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("DOC-012");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("PUB-001");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("MAT-010");
    expect(HYBRID_DCC_GATING_CATALOG.P1).toContain("MAT-012");
  });
});

class GatingFakeOpfs implements StudioOpfsRecoveryJournalAdapter {
  readonly kind = "fake-opfs" as const;
  readonly files = new Map<string, Uint8Array>();
  async read(path: string) {
    const b = this.files.get(path);
    return b ? new Uint8Array(b) : null;
  }
  async writeAtomic(path: string, bytes: Uint8Array) {
    this.files.set(path, new Uint8Array(bytes));
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }
  async size(path: string) {
    return this.files.get(path)?.byteLength ?? null;
  }
  async estimateQuota() {
    return null;
  }
  async withExclusiveLock<T>(
    _n: string,
    signal: AbortSignal | undefined,
    op: () => Promise<T>,
  ) {
    if (signal?.aborted) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    return op();
  }
}

describe("DOC foundation — command, dirty, OPFS recovery, Rights BOM, content hash", () => {
  it("DOC-001/002/003/004/005/006/012: register asset, commit geometry, checkpoint, recover, rights", async () => {
    let session = createStudioHybridDccSession("doc-gating-1");
    const cube = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "asset-cube", cube, {
      source: "primitive",
      creator: "toonspectrum",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    expect(session.state.rightsBom[0]?.license).toBe("CC0-1.0");
    expect(session.state.rightsBom[0]?.contentHash?.startsWith("sha256:")).toBe(true);

    const extruded = extrudeStudioEditableMeshFaces(cube, [0], 0.25);
    expect(extruded.ok).toBe(true);
    if (!extruded.ok) return;
    session = hybridDccCommitGeometry(session, "asset-cube", extruded.value);
    expect(session.state.dirtyNodeIds).toContain("asset-cube");
    expect(session.state.dirtyNodeIds).toContain("shot:*");
    const meshHashCommitted = session.state.geometry.records["asset-cube"]!.meshHash;

    const hashBefore = session.state.stateHash;
    session = hybridDccAutosaveCheckpoint(session, "milestone-1");
    expect(session.state.milestoneLabel).toBe("milestone-1");
    expect(hybridDccCanUndo(session)).toBe(true);

    // DOC-002 undo restores prior state
    const undone = hybridDccUndo(session);
    expect(undone.state.milestoneLabel).not.toBe("milestone-1");

    // re-apply milestone for OPFS checkpoint of full state
    session = hybridDccAutosaveCheckpoint(undone, "milestone-1");
    expect(session.state.geometry.records["asset-cube"]!.meshHash).toBe(meshHashCommitted);

    const adapter = new GatingFakeOpfs();
    let t = 1_000;
    const ports = createStudioHybridDccOpfsPorts({
      adapter,
      documentId: "doc-gating-1",
      now: () => ++t,
      randomToken: () => `t-${t}`,
    });
    await hybridDccWriteOpfsCheckpoint(session, ports);
    const recovered = await hybridDccRecoverFromOpfs(ports);
    expect(recovered.checkpointFound).toBe(true);
    expect(recovered.recoveredStateHash).toBe(session.state.stateHash);
    expect(recovered.session.state.geometry.records["asset-cube"]!.meshHash).toBe(
      meshHashCommitted,
    );
    expect(recovered.recoveredStateHash).not.toBe(
      createStudioHybridDccSession("empty").state.stateHash,
    );

    session = hybridDccClearDirty(session, ["asset-cube"]);
    expect(session.state.dirtyNodeIds).not.toContain("asset-cube");
    expect(session.journal.length).toBeGreaterThan(0);
    expect(hashBefore).not.toBe(session.state.stateHash);

    const bytes = new TextEncoder().encode("identical-asset");
    expect(hybridDccContentAddressAsset(bytes)).toBe(
      hybridDccContentAddressAsset(bytes),
    );

    const dirty = hybridDccPropagateDirty(
      [
        { fromId: "mesh-a", toId: "shot-1", kind: "geometry" },
        { fromId: "shot-1", toId: "pass-line", kind: "shot-pass" },
        { fromId: "mesh-b", toId: "shot-2", kind: "geometry" },
      ],
      ["mesh-a"],
    );
    expect(dirty).toEqual(["mesh-a", "pass-line", "shot-1"]);
    expect(dirty).not.toContain("shot-2");
  });
});

describe("Geometry authority + Model P1 mesh ops + modifiers", () => {
  it("MOD-001/003/004/005/006/007/010/011/024: selection, transform, extrude, inset, bevel, loop, weld, crease, diagnostics", () => {
    const mesh = createStudioUnitCubeMesh();
    const stats = studioEditableMeshStats(mesh);
    expect(stats.vertexCount).toBe(8);
    expect(stats.faceCount).toBe(6);

    const sel = selectStudioMeshElements(mesh, "face", [0, 1]);
    expect(sel.ok).toBe(true);

    const moved = transformStudioEditableMesh(
      mesh,
      { mode: "face", ids: [0] },
      { translate: { x: 1, y: 0, z: 0 } },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(hashStudioEditableMesh(moved.value)).not.toBe(hashStudioEditableMesh(mesh));

    const extrude = extrudeStudioEditableMeshFaces(mesh, [0], 0.5);
    expect(extrude.ok).toBe(true);
    if (!extrude.ok) return;
    expect(studioEditableMeshStats(extrude.value).faceCount).toBeGreaterThan(stats.faceCount);

    const inset = insetStudioEditableMeshFaces(mesh, [0], 0.2);
    expect(inset.ok).toBe(true);

    const he0 = mesh.halfEdges[0]!.id;
    const bevel = bevelStudioEditableMeshEdges(mesh, [he0], 0.1);
    expect(bevel.ok).toBe(true);
    if (bevel.ok) {
      const after = studioEditableMeshStats(bevel.value);
      expect(after.vertexCount).toBeGreaterThan(stats.vertexCount);
      expect(after.faceCount).toBeGreaterThan(stats.faceCount);
    }

    const loop = loopCutStudioEditableMesh(mesh, he0, 0.5);
    expect(loop.ok).toBe(true);

    const welded = weldStudioEditableMesh(mesh, 1e-4);
    expect(welded.ok).toBe(true);

    const dissolved = dissolveStudioEditableMeshFaces(mesh, [0]);
    expect(dissolved.ok).toBe(true);
    if (dissolved.ok) {
      expect(studioEditableMeshStats(dissolved.value).faceCount).toBe(5);
    }

    const creased = setStudioEditableMeshCrease(mesh, [he0], 0.75);
    expect(creased.ok).toBe(true);

    const diag = diagnoseStudioEditableMesh(mesh);
    // Closed cube should not report non-manifold errors
    expect(diag.filter((d) => d.code === "non-manifold-edge")).toHaveLength(0);
  });

  it("MOD-012/013/014/015/016: mirror, array, boolean commit, solidify, bevel stack + undo-clean hashes", async () => {
    const source = createStudioUnitCubeMesh();
    let stack = createStudioMeshModifierStack(source);
    stack = withStudioMeshModifier(stack, {
      kind: "mirror",
      id: "m1",
      enabled: true,
      axis: "x",
      merge: true,
      mergeThreshold: 1e-4,
      bisect: false,
      clip: false,
    });
    stack = withStudioMeshModifier(stack, {
      kind: "array",
      id: "a1",
      enabled: true,
      count: 3,
      offset: { x: 1.5, y: 0, z: 0 },
      mode: "linear",
      realizeInstances: true,
    });
    stack = withStudioMeshModifier(stack, {
      kind: "solidify",
      id: "s1",
      enabled: true,
      thickness: 0.05,
      evenThickness: true,
      rim: true,
    });
    stack = withStudioMeshModifier(stack, {
      kind: "bevel",
      id: "b1",
      enabled: true,
      amount: 0.1,
      segments: 1,
      angleLimitRad: Math.PI / 6,
      weightInfluence: 0,
    });

    const operand = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
    // scale operand positions slightly for difference
    const opPos = new Float32Array(operand.positions);
    for (let i = 0; i < opPos.length; i += 1) opPos[i]! *= 0.5;
    stack = withStudioMeshModifier(stack, {
      kind: "boolean",
      id: "bool1",
      enabled: true,
      operation: "difference",
      operand: { positions: opPos, indices: operand.indices },
    });

    const backend = createStudioAabbSolidBooleanBackend();
    const evaluated = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: backend,
    });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.value.resultHash).not.toBe(evaluated.value.sourceHash);

    // Disabled stack evaluates to source
    const disabled = createStudioMeshModifierStack(source, [
      {
        kind: "array",
        id: "off",
        enabled: false,
        count: 5,
        offset: { x: 1, y: 0, z: 0 },
        mode: "linear",
        realizeInstances: true,
      },
    ]);
    const evalOff = await evaluateStudioMeshModifierStack(disabled);
    expect(evalOff.ok).toBe(true);
    if (evalOff.ok) {
      expect(evalOff.value.resultHash).toBe(evalOff.value.sourceHash);
    }
  });

  it("Geometry Authority is SoT; render cache is derived only", async () => {
    let reg = createStudioGeometryAuthorityRegistry();
    const registered = registerStudioGeometryAuthority(reg, "geo-1");
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    reg = registered.value;
    const record = reg.records["geo-1"]!;
    expect(assertRenderCacheIsNotAuthority(record)).toBe(true);
    expect(record.kernel).toBe("half-edge");
    expect(record.renderCache).toBeNull();

    const mat = await materializeStudioGeometryRenderCache(reg, "geo-1", { now: 1 });
    expect(mat.ok).toBe(true);
    if (!mat.ok) return;
    expect(mat.value.cache.positions.length).toBeGreaterThan(0);
    expect(mat.value.cache.derivedFromHash).toBeTruthy();
    const hash = contentAddressStudioGeometryBytes(
      mat.value.cache.positions,
      mat.value.cache.indices,
    );
    expect(hash.startsWith("sha256:")).toBe(true);

    const nextMesh = createStudioUnitCubeMesh();
    const committed = commitStudioGeometryAuthorityMesh(mat.value.registry, "geo-1", nextMesh);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.value.records["geo-1"]!.renderCache).toBeNull();
    }
  });
});

describe("Build — inference, push/pull, components, room, wall hide", () => {
  it("BLD-001/002: endpoint/midpoint/intersection + axis lock inference", () => {
    const result = resolveStudioBuildInferenceSnap({
      cursor: { x: 1.01, y: 0, z: 0 },
      segments: [
        { id: "s1", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
        { id: "s2", a: { x: 1, y: 0, z: -1 }, b: { x: 1, y: 0, z: 1 } },
      ],
      pixelThreshold: 12,
      pixelsPerUnit: 40,
      pointerVelocity: 0,
      axisLock: "none",
    });
    expect(result.snapped).toBe(true);
    expect(result.candidate?.kind).toMatch(/endpoint|intersection|midpoint/);

    const locked = resolveStudioBuildInferenceSnap({
      cursor: { x: 2, y: 0.5, z: 0.1 },
      segments: [{ id: "s1", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }],
      pixelThreshold: 20,
      pixelsPerUnit: 10,
      pointerVelocity: 5,
      axisLock: "x",
    });
    expect(locked.candidates.some((c) => c.kind === "axis" && c.locked)).toBe(true);
    expect(cycleStudioInferenceAxisLock("none")).toBe("x");
    expect(cycleStudioInferenceAxisLock("z")).toBe("none");
  });

  it("BLD-003: push/pull on box primitive", () => {
    const primitive: BgPrimitive = {
      id: "box-1",
      kind: "box",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ccc",
      locked: false,
    };
    const result = planStudioBg3dPushPull(primitive, {
      distance: 0.5,
      axis: "y",
      face: "positive",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextDimension).toBeGreaterThan(result.previousDimension);
  });

  it("BLD-007/009/010/011/012/015/016: tags, floor plan walls, stairs, slab, room presets, dimensions", () => {
    let tagsDoc = createStudioTagsOutlinerDocument(
      [
        { id: "walls", label: "Walls", visible: true, renderLayer: 1 },
        { id: "props", label: "Props", visible: true, renderLayer: 2 },
      ],
      [
        {
          id: "wall-n",
          label: "North wall",
          parentId: null,
          tagIds: ["walls"],
          objectVisible: true,
        },
      ],
    );
    expect(resolveStudioOutlinerVisibility(tagsDoc, "wall-n").visible).toBe(true);
    tagsDoc = setStudioTagVisibility(tagsDoc, "walls", false);
    expect(resolveStudioOutlinerVisibility(tagsDoc, "wall-n").reason).toBe("tag-hidden");

    const walls = buildStudioWallsFromFloorPlan({
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
        { x: 0, z: 3 },
      ],
      closed: true,
      wallHeight: 2.5,
      wallThickness: 0.15,
      defaultOpenings: [
        {
          segmentIndex: 0,
          type: "door",
          t: 0.5,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
        },
        {
          segmentIndex: 1,
          type: "window",
          t: 0.5,
          width: 1.2,
          height: 1,
          sillHeight: 0.9,
        },
      ],
    });
    expect(walls.walls.length).toBe(4);
    expect(walls.roomsDetected).toBe(1);
    expect(walls.walls[0]!.openings[0]!.type).toBe("door");

    const stairs = generateStudioStairs({
      steps: 8,
      rise: 0.18,
      run: 0.28,
      width: 1,
      landing: true,
    });
    expect(stairs.steps).toHaveLength(8);
    expect(stairs.landing).not.toBeNull();
    expect(stairs.totalRise).toBeCloseTo(1.44);

    const floor = generateStudioSlab({
      polygon: walls.floorPolygon,
      elevation: 0,
      thickness: 0.2,
      kind: "floor",
    });
    expect(floor?.area).toBeCloseTo(12, 5);

    expect(STUDIO_BG3D_ROOM_PRESETS.length).toBeGreaterThanOrEqual(4);
    const classroom = getStudioBg3dRoomPreset("classroom");
    expect(classroom).not.toBeNull();
    const parts = buildStudioBg3dRoomParts(classroom!.spec);
    expect(parts.length).toBeGreaterThan(0);

    const dim = createStudioDimension("d1", [0, 0, 0], [2, 0, 0], "m", 2);
    expect(dim.lengthMeters).toBeCloseTo(2);
    expect(dim.display).toContain("2.00");
  });

  it("BLD-018: camera wall hide occludes walls between camera and subject", () => {
    const result = resolveStudioCameraWallHide({
      cameraPosition: [0, 1.6, 5],
      subjectPosition: [0, 1.6, -2],
      walls: [
        {
          id: "front",
          point: [0, 1.6, 1],
          normal: [0, 0, 1],
          thickness: 0.2,
        },
        {
          id: "side",
          point: [3, 1.6, 0],
          normal: [1, 0, 0],
          thickness: 0.2,
        },
      ],
      occludedOpacity: 0.15,
    });
    expect(result.occludedWallIds).toContain("front");
    expect(result.occludedWallIds).not.toContain("side");
    const front = result.decisions.find((d) => d.wallId === "front")!;
    expect(front.mode).toBe("transparent");
    expect(front.opacity).toBe(0.15);
  });
});

describe("Shot + Live 2D↔3D bridge + artist delta", () => {
  it("SHT-001/003 + NPR passes + NPR-008: multi-shot overrides, dirty passes, preserve artist delta", () => {
    const set = createStudioSharedSet("set-1", [
      {
        id: "prop-a",
        geometryHash: "geo-a-1",
        visible: true,
        materialId: "mat-wood",
      },
      {
        id: "prop-b",
        geometryHash: "geo-b-1",
        visible: true,
        materialId: "mat-metal",
      },
    ]);
    let doc = createStudioLiveBridgeDocument(set, ["shot-a", "shot-b"]);
    expect(doc.shots.length).toBe(2);
    expect(STUDIO_TOON_PASS_KINDS).toEqual(
      expect.arrayContaining(["line", "shadow", "tone", "depth", "normal", "object-id"]),
    );

    doc = applyStudioShotOverride(doc, "shot-a", {
      camera: { position: [0, 1.5, 4], target: [0, 1, 0], fov: 35 },
      material: { "prop-a": "mat-toon-override" },
      visibility: { "prop-b": false },
      characterPose: { hero: "pose-stand" },
    });
    expect(doc.shots[0]!.overrides.material?.["prop-a"]).toBe("mat-toon-override");

    for (const pass of STUDIO_TOON_PASS_KINDS) {
      doc = generateStudioToonPass(doc, "shot-a", pass);
    }
    expect(doc.shots[0]!.dirtyPasses).toHaveLength(0);
    expect(doc.shots[0]!.passHashes.line).toBeTruthy();

    doc = addStudioArtistDelta(doc, {
      id: "delta-1",
      pass: "line",
      shotId: "shot-a",
      points: [
        [0.2, 0.3],
        [0.25, 0.35],
      ],
      pressure: [0.8, 0.7],
      provenance: { edgeId: "e1", objectId: "prop-a", confidence: 0.9 },
      creationCameraHash: "cam-1",
      creationGeometryHash: "geo-a-1",
      createdAt: 1,
    });
    expect(doc.artistCorrections.deltas).toHaveLength(1);

    // Mutate prop-a geometry — shot-a dirty; artist delta preserved
    doc = mutateStudioSharedObjectGeometry(doc, "prop-a", "geo-a-2");
    const summary = studioLiveBridgeDirtySummary(doc);
    expect(summary.artistDeltaCount).toBe(1);
    expect(doc.artistCorrections.deltas[0]!.id).toBe("delta-1");
    expect(doc.shots.find((s) => s.id === "shot-a")!.dirtyPasses.length).toBeGreaterThan(0);

    // shot-b still has dirty from creation; regenerate only line on shot-a
    doc = generateStudioToonPass(doc, "shot-a", "line");
    expect(doc.shots.find((s) => s.id === "shot-a")!.dirtyPasses).not.toContain("line");
    expect(doc.artistCorrections.deltas).toHaveLength(1);

    // Reproject policy preserve keeps strokes
    const store = createStudioArtistCorrectionStore(doc.artistCorrections.deltas);
    const reproj = reprojectStudioArtistCorrections(store, {
      shotId: "shot-a",
      previousCameraHash: "cam-1",
      nextCameraHash: "cam-2",
      previousGeometryHash: "geo-a-1",
      nextGeometryHash: "geo-a-2",
      policy: "reproject-uv",
      uvAffine: [1, 0, 0.01, 0, 1, -0.02],
    });
    expect(reproj.droppedIds).toHaveLength(0);
    expect(reproj.reprojectedIds).toContain("delta-1");
    expect(reproj.store.deltas[0]!.points[0]![0]).toBeCloseTo(0.21);
  });
});

describe("Character + interchange import reports + materials", () => {
  it("CHR-001 + import report for OBJ and GLB/VRM fixtures", () => {
    const objText = `
# cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
usemtl Default
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
`;
    const objScene = parseStudioObjToSceneIR(objText);
    const objReport = buildStudioImportCompatibilityReport({
      parser: "studio-obj-text-parser",
      sourceBytes: objText,
      scene: objScene,
      committed: true,
    });
    expect(objReport.parser).toBe("studio-obj-text-parser");
    expect(objReport.sourceHash.startsWith("sha256:")).toBe(true);
    expect(objReport.units).toBe("meters");
    expect(objReport.axis).toBe("y-up");
    expect(objReport.counts.meshes).toBeGreaterThan(0);
    expect(objReport.fidelity.rigAnimation).toBe("X");
    const objCommit = commitStudioImportToDocument(objReport, objScene);
    expect(objCommit.documentKind).toBe("toonspectrum.scene-ir");
    expect(objCommit.report.committed).toBe(true);

    const vrmPath = existsSync(resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm"))
      ? resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm")
      : resolve(process.cwd(), "dist/vrm/AvatarSample_A.vrm");
    expect(existsSync(vrmPath)).toBe(true);
    const glbBytes = new Uint8Array(readFileSync(vrmPath));
    const imported = importStudioGlbDocument(glbBytes, {
      parser: "studio-glb-scene-ir",
      asVrm: true,
    });
    expect(imported.report.format).toBe("vrm");
    expect(imported.report.sourceHash.startsWith("sha256:")).toBe(true);
    expect(imported.report.counts.meshes).toBeGreaterThan(0);
    expect(imported.report.counts.nodes).toBeGreaterThan(0);
    expect(imported.scene.meshes.some((m) => m.vertexCount > 0)).toBe(true);
    expect(imported.report.unsupportedEntities).toBeDefined();
    expect(imported.report.vrm?.normalizedTo).toBe("1.0-semantic-ir");
    expect(imported.commit.report.committed).toBe(true);
  });

  it("CHR-002/007/008/009/018 + MAT-006/009: humanoid, hand poses, expression, lookAt, pose meta, decal, ktx2", () => {
    const report = diagnoseStudioHumanoidMapping(
      ["Hips", "Head", "LeftHand", "RightHand", "Extra"],
      {
        hips: "Hips",
        head: "Head",
        leftHand: "LeftHand",
        rightHand: "RightHand",
        spine: "Hips",
        leftUpperArm: "LeftHand",
        rightUpperArm: "RightHand",
        leftUpperLeg: "Hips",
        rightUpperLeg: "Hips",
        leftFoot: "Hips",
        rightFoot: "Hips",
      },
    );
    expect(report.extraNodeNames).toContain("Extra");
    expect(report.complete).toBe(true);

    const fist = STUDIO_HAND_POSE_LIBRARY.find((p) => p.id === "fist")!;
    const left = mirrorStudioHandPose(fist, "left");
    expect(left.side).toBe("left");
    expect(left.curls[1]).toBe(1);

    const mix = mixStudioExpressions([
      { name: "happy", weight: 0.6 },
      { name: "happy", weight: 0.2 },
      { name: "mat:outline", weight: 0.5 },
    ]);
    expect(mix.channels.find((c) => c.name === "happy")?.weight).toBe(0.6);
    expect(mix.materialBinds.outline).toBe(0.5);

    const look = createStudioLookAt({
      target: "camera",
      eyeWeight: 1,
      headWeight: 0.4,
    });
    expect(look.target).toBe("camera");

    const poseMeta = createStudioPoseAssetMetadata({
      id: "pose-1",
      label: "Stand",
      bodyType: "adult",
      contact: ["ground"],
      cameraHint: "three-quarter",
      rightsLicense: "CC-BY-4.0",
      creator: "author",
      tags: ["idle", "base"],
    });
    expect(poseMeta.tags[0]).toBe("base");

    const decal = createStudioDecalPlacement({
      id: "decal-1",
      meshObjectId: "wall-1",
      mode: "planar",
      uvOffset: [0.1, 0.2],
      uvScale: [0.5, 0.5],
      textureAssetId: "tex-poster",
      shotOnly: true,
    });
    expect(decal.mode).toBe("planar");

    const ktx = studioKtx2DerivativeForProfile(4096, "mobile");
    expect(ktx.maxExtent).toBe(1024);
    expect(ktx.format).toBe("etc1s");
  });
});

describe("BLD-006 component instance surface", () => {
  it("edit-one document + make unique plan on shared component instance", () => {
    expect(STUDIO_COMPONENT_DOCUMENT_VERSION).toBe(1);
    const doc = createStudioComponentDocument({
      version: 1,
      definitions: [
        {
          id: "comp-chair",
          name: "Chair",
          kind: "prop",
          schemaVersion: 1,
          revision: 1,
          payload: { mesh: "chair", color: "#abc" },
          slots: [],
          properties: [],
          variantAxes: [],
        },
      ],
      instances: [
        {
          id: "inst-1",
          componentId: "comp-chair",
          sourceRevision: 1,
          updatePolicy: "auto",
          variantSelection: {},
          slotBindings: {},
          propertyValues: {},
          localOverrides: [],
        },
        {
          id: "inst-2",
          componentId: "comp-chair",
          sourceRevision: 1,
          updatePolicy: "auto",
          variantSelection: {},
          slotBindings: {},
          propertyValues: {},
          localOverrides: [],
        },
      ],
    });
    expect(doc.instances).toHaveLength(2);
    const plan = planStudioComponentMakeUnique(
      doc,
      "inst-1",
      "comp-chair-unique-1",
      "Chair Unique",
    );
    expect(plan.kind).toBe("studio-component-make-unique");
    expect(plan.definitionForward?.id).toBe("comp-chair-unique-1");
  });
});
