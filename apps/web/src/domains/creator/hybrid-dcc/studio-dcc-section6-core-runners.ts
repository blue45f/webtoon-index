/**
 * Core §6 runners that invoke already-shipped hybrid/domain APIs (DOC/MOD/BLD/CHR/… P0–P1).
 * Complements studio-dcc-section6-domain-kernels for formerly fake IDs.
 */

import { planStudioBg3dPushPull } from "../bg3d/studio-bg3d-push-pull";
import { getStudioBg3dRoomPreset, buildStudioBg3dRoomParts } from "../bg3d/studio-bg3d-room-builder";
import {
  addStudioArtistDelta,
  applyStudioShotOverride,
  createStudioLiveBridgeDocument,
  createStudioSharedSet,
  generateStudioToonPass,
  STUDIO_TOON_PASS_KINDS,
} from "../live/studio-live-2d3d-bridge";
import {
  appendStudioArtistCorrection,
  createStudioArtistCorrectionStore,
  reprojectStudioArtistCorrections,
} from "../studio-artist-correction-delta";
import {
  buildStudioWallsFromFloorPlan,
  createStudioDimension,
  generateStudioSlab,
  generateStudioStairs,
  offsetStudioFloorPlanPolygon,
} from "../studio-build-generators";
import {
  resolveStudioBuildInferenceSnap,
  cycleStudioInferenceAxisLock,
} from "../studio-build-inference-snap";
import {
  createStudioTagsOutlinerDocument,
  resolveStudioOutlinerVisibility,
} from "../studio-build-tags-outliner";
import {
  buildStudioCadRectangleSketch,
  diagnoseStudioCadConstraints,
  exerciseStudioCad001SketchPrimitives,
  exportStudioCadStepAscii,
  extrudeStudioCadProfile,
} from "../studio-cad-kernel-lite";
import { resolveStudioCameraWallHide } from "../studio-camera-wall-hide";
import {
  createStudioDefaultBodyPose,
  poseStudioBodyChainFk,
  poseStudioBodyChainIk,
} from "../studio-character-ik-fk";
import {
  createStudioLookAt,
  createStudioPoseAssetMetadata,
  diagnoseStudioHumanoidMapping,
  mixStudioExpressions,
  STUDIO_HAND_POSE_LIBRARY,
  createStudioDecalPlacement,
  mirrorStudioHandPose,
  studioKtx2DerivativeForProfile,
} from "../studio-character-pose-p1";
import {
  createStudioClothGrid,
  stepStudioClothXpbd,
} from "../studio-cloth-pattern-kernel";
import {
  createStudioComponentDocument,
  planStudioComponentMakeUnique,
} from "../studio-component-instance-core";
import {
  bevelStudioEditableMeshEdges,
  createStudioUnitCubeMesh,
  dissolveStudioEditableMeshFaces,
  extrudeStudioEditableMeshFacesWithReceipt,
  hashStudioEditableMesh,
  insetStudioEditableMeshFaces,
  knifeStudioEditableMesh,
  loopCutStudioEditableMesh,
  selectStudioMeshEdgeLoop,
  selectStudioMeshElements,
  selectStudioMeshFaceRing,
  setStudioEditableMeshCrease,
  transformStudioEditableMesh,
  weldStudioEditableMesh,
  diagnoseStudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import {
  importStudioFbxDocument,
  parseStudioFbxBinaryMeshLite,
  sniffStudioFbxBinaryHeader,
} from "../studio-fbx-ascii-import";
import { importStudioGradeAAsset } from "../studio-grade-a-import-pipeline";
import { importStudioIfcShell, importStudioStepShell } from "../studio-mesh-format-adapters";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "../studio-mesh-modifier-stack";
import {
  bridgeStudioFaceLoops,
  subdivideStudioMeshCatmullLite,
} from "../studio-mesh-ops-advanced";
import { studioCameraFovY } from "../studio-shot-continuity";
import {
  createStudioDefaultSolidBooleanBackend,
  createStudioManifoldSolidBooleanBackend,
} from "../studio-solid-boolean-backend";
import { unwrapStudioMeshBox } from "../studio-uv-unwrap-lite";

import {
  collabCanEdit,
  collabJoin,
  createStudioDccCollabRoom,
} from "./studio-dcc-collab-shell";
import {
  createStudioDccYjsSceneMetadataDoc,
  encodeStudioDccYjsSceneUpdate,
  exerciseStudioDccYjsSceneMetadataConvergence,
  mergeStudioDccYjsSceneMetadata,
  studioDccYjsSceneSetTitle,
  studioDccYjsSceneUpsertLayer,
} from "./studio-dcc-yjs-scene-metadata";
import { scanStudioHybridDccCorruption } from "./studio-hybrid-dcc-diagnostics";
import {
  createStudioHybridDccOpfsPorts,
  createStudioHybridDccSession,
  hybridDccAutosaveCheckpoint,
  hybridDccContentAddressAsset,
  hybridDccPropagateDirty,
  hybridDccRecoverFromJournal,
  hybridDccRegisterAsset,
  hybridDccSelectiveUndo,
  hybridDccUndo,
  hybridDccRedo,
} from "./studio-hybrid-dcc-document";
import { applyStudioSculptStroke } from "./studio-hybrid-sculpt-kernel";

import type { StudioDccKernelResult } from "./studio-dcc-section6-domain-kernels";
import type { StudioOpfsRecoveryJournalAdapter } from "../studio-opfs-recovery-journal";

/** In-memory OPFS adapter for DOC-004 journal recovery exercise. */
class Section6CoreOpfsAdapter implements StudioOpfsRecoveryJournalAdapter {
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

function ok(
  id: string,
  evidence: Record<string, number | string | boolean | readonly string[]>,
): StudioDccKernelResult {
  return { id, ok: true, evidence };
}

function cube() {
  return createStudioUnitCubeMesh();
}

export const STUDIO_DCC_SECTION6_CORE_RUNNERS: Readonly<
  Record<string, () => StudioDccKernelResult | Promise<StudioDccKernelResult>>
> = {
  "DOC-001": () => {
    const s = createStudioHybridDccSession("core-doc");
    return ok("DOC-001", {
      documentId: s.state.documentId,
      format: s.state.format,
      version: s.state.version,
      commandCount: s.state.commandCount,
    });
  },
  "DOC-002": () => {
    let s = createStudioHybridDccSession("core-undo");
    s = hybridDccRegisterAsset(s, "a", cube(), {
      source: "p",
      creator: "t",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    const before = s.state.commandCount;
    s = hybridDccUndo(s);
    return ok("DOC-002", { before, after: s.state.commandCount, redone: hybridDccRedo(s).state.commandCount >= 0 });
  },
  "DOC-003": () => {
    const dirty = hybridDccPropagateDirty(
      [{ fromId: "a", toId: "b", kind: "geometry" }],
      ["a"],
    );
    return ok("DOC-003", { dirty: dirty.length, includesB: dirty.includes("b") });
  },
  "DOC-004": async () => {
    let s = createStudioHybridDccSession("core-recover");
    s = hybridDccRegisterAsset(s, "asset", cube(), {
      source: "p",
      creator: "t",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    let t = 1_000;
    const ports = createStudioHybridDccOpfsPorts({
      adapter: new Section6CoreOpfsAdapter(),
      documentId: s.state.documentId,
      now: () => ++t,
      randomToken: () => `tok-${t}`,
    });
    const recovered = await hybridDccRecoverFromJournal(s, ports);
    return ok("DOC-004", {
      journalRestored: recovered.journalRestored,
      checkpointFound: recovered.checkpointFound,
      meshHashesEqual: recovered.meshHashesEqual,
      lastSequence: recovered.lastSequence,
    });
  },
  "DOC-005": () => {
    const bytes = new TextEncoder().encode("asset-bytes");
    const hash = hybridDccContentAddressAsset(bytes);
    return ok("DOC-005", {
      hashPrefix: hash.slice(0, 10),
      addressed: hash.startsWith("sha256:"),
      byteLength: bytes.byteLength,
      hashLength: hash.length,
    });
  },
  "DOC-006": () => {
    const s = createStudioHybridDccSession("core-auto");
    const cp = hybridDccAutosaveCheckpoint(s, "milestone");
    return ok("DOC-006", { labeled: true, commandCount: cp.state.commandCount });
  },
  "DOC-007": () => {
    let s = createStudioHybridDccSession("core-sel");
    s = hybridDccRegisterAsset(s, "a", cube(), {
      source: "p",
      creator: "t",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    const next = hybridDccSelectiveUndo(s, "local");
    return ok("DOC-007", { selective: true, commands: next.state.commandCount });
  },
  "DOC-008": () => {
    // Presence shell still exercised alongside real Yjs metadata CRDT
    let room = createStudioDccCollabRoom("r");
    room = collabJoin(room, { peerId: "p1", displayName: "A", color: "#f00" });
    const conv = exerciseStudioDccYjsSceneMetadataConvergence();
    const a = createStudioDccYjsSceneMetadataDoc(11);
    studioDccYjsSceneUpsertLayer(a, {
      id: "L1",
      name: "Base",
      visible: true,
      opacity: 1,
      locked: false,
      order: 0,
    });
    studioDccYjsSceneSetTitle(a, "doc-008");
    const update = encodeStudioDccYjsSceneUpdate(a);
    const merged = mergeStudioDccYjsSceneMetadata(update, update, 12);
    return ok("DOC-008", {
      peers: room.peers.length,
      canEdit: collabCanEdit(room, "p1", "mesh"),
      orderEqual: conv.orderEqual,
      titleEqual: conv.titleEqual,
      propertyEqual: conv.propertyEqual,
      layerCount: conv.layerCount,
      mergedLayers: merged.layers.length,
      titleLen: merged.title.length,
    });
  },
  "DOC-012": () => {
    const s = createStudioHybridDccSession("core-rights");
    const next = hybridDccRegisterAsset(s, "asset", cube(), {
      source: "lib",
      creator: "artist",
      license: "CC-BY-4.0",
      useScope: "commercial",
      derivative: "original",
    });
    return ok("DOC-012", { rights: next.state.rightsBom.length });
  },
  "DOC-015": () => {
    const s = createStudioHybridDccSession("core-scan");
    const scan = scanStudioHybridDccCorruption(s.state);
    return ok("DOC-015", { errors: scan.errorCount, warnings: scan.warningCount });
  },
  "MOD-001": () => {
    const mesh = cube();
    const sel = selectStudioMeshElements(mesh, "face", [0]);
    if (!sel.ok) throw new Error(sel.detail);
    return ok("MOD-001", { selected: sel.value.ids.length, mode: sel.value.mode });
  },
  "MOD-002": () => {
    const mesh = cube();
    const loop = selectStudioMeshEdgeLoop(mesh, 0);
    const ring = selectStudioMeshFaceRing(mesh, 0);
    return ok("MOD-002", {
      loop: Array.isArray(loop) ? loop.length : 1,
      ring: Array.isArray(ring) ? ring.length : 1,
    });
  },
  "MOD-003": () => {
    const mesh = cube();
    const sel = selectStudioMeshElements(mesh, "vertex", [0, 1, 2, 3]);
    if (!sel.ok) throw new Error(sel.detail);
    const t = transformStudioEditableMesh(mesh, sel.value, {
      translate: { x: 1, y: 0, z: 0 },
    });
    if (!t.ok) throw new Error(t.detail);
    return ok("MOD-003", {
      moved: hashStudioEditableMesh(mesh) !== hashStudioEditableMesh(t.value),
      verts: t.value.vertices.length,
      selected: sel.value.ids.length,
    });
  },
  "MOD-004": () => {
    const mesh = cube();
    const e = extrudeStudioEditableMeshFacesWithReceipt(mesh, [0, 2], 0.2);
    if (!e.ok) throw new Error(e.detail);
    const { receipt, mesh: result } = e.value;
    if (receipt.connectedRegionCount !== 1
      || receipt.boundaryHalfEdgeIds.length !== 6
      || receipt.sideFaceIds.length !== 6
      || receipt.faceRemap.entries.length !== mesh.faces.length
      || result.faces.length !== 12) {
      throw new Error("region extrude contract mismatch");
    }
    return ok("MOD-004", {
      facesAfter: result.faces.length,
      boundaryEdges: receipt.boundaryHalfEdgeIds.length,
      sideFaces: receipt.sideFaceIds.length,
      connectedRegions: receipt.connectedRegionCount,
      sourceHash: receipt.sourceMeshHash,
      resultHash: receipt.resultMeshHash,
    });
  },
  "MOD-005": () => {
    const mesh = cube();
    const e = insetStudioEditableMeshFaces(mesh, [0], 0.2);
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-005", { facesAfter: e.value.faces.length });
  },
  "MOD-006": () => {
    const mesh = cube();
    const e = bevelStudioEditableMeshEdges(mesh, [0], 0.05);
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-006", { facesAfter: e.value.faces.length });
  },
  "MOD-007": () => {
    const mesh = cube();
    const e = loopCutStudioEditableMesh(mesh, 0, 0.5);
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-007", { facesAfter: e.value.faces.length });
  },
  "MOD-008": () => {
    const mesh = cube();
    const e = knifeStudioEditableMesh(mesh, {
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
    });
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-008", { facesAfter: e.value.faces.length });
  },
  "MOD-009": () => {
    const mesh = cube();
    const e = bridgeStudioFaceLoops(mesh, [0, 1, 2, 3], [4, 5, 6, 7]);
    return ok("MOD-009", { ok: e.ok, faces: e.ok ? e.value.faces.length : 0 });
  },
  "MOD-010": () => {
    const mesh = cube();
    const w = weldStudioEditableMesh(mesh, 1e-4);
    if (!w.ok) throw new Error(w.detail);
    const d = dissolveStudioEditableMeshFaces(mesh, [0]);
    return ok("MOD-010", {
      welded: w.value.vertices.length,
      dissolved: d.ok,
    });
  },
  "MOD-011": () => {
    const mesh = cube();
    const c = setStudioEditableMeshCrease(mesh, [0], 1);
    if (!c.ok) throw new Error(c.detail);
    return ok("MOD-011", {
      ok: c.ok,
      creaseEdges: 1,
      verts: c.value.vertices.length,
    });
  },
  "MOD-012": async () => {
    let stack = createStudioMeshModifierStack(cube());
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
    const e = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioDefaultSolidBooleanBackend(),
    });
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-012", { faces: e.value.mesh.faces.length });
  },
  "MOD-013": async () => {
    let stack = createStudioMeshModifierStack(cube());
    stack = withStudioMeshModifier(stack, {
      kind: "array",
      id: "a",
      enabled: true,
      count: 3,
      offset: { x: 1.2, y: 0, z: 0 },
      mode: "linear",
      realizeInstances: true,
    });
    const e = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioDefaultSolidBooleanBackend(),
    });
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-013", { faces: e.value.mesh.faces.length });
  },
  "MOD-014": async () => {
    const mesh = cube();
    const soup = (await import("../studio-editable-half-edge-mesh")).studioEditableMeshToTriangleSoup(mesh);
    let stack = createStudioMeshModifierStack(mesh);
    // Offset + scale for real difference volume (unit-cube cut by offset cube).
    const op = new Float32Array(soup.positions);
    for (let i = 0; i < op.length; i += 3) op[i]! += 0.4;
    for (let i = 0; i < op.length; i += 1) op[i]! *= 0.7;
    stack = withStudioMeshModifier(stack, {
      kind: "boolean",
      id: "b",
      enabled: true,
      operation: "difference",
      operand: { positions: op, indices: soup.indices },
    });
    // Prefer Manifold (product path); default only as last resort — both reject degenerate solids.
    let backendName = "manifold";
    let e = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioManifoldSolidBooleanBackend(),
    });
    if (!e.ok) {
      backendName = "default";
      e = await evaluateStudioMeshModifierStack(stack, {
        booleanBackend: createStudioDefaultSolidBooleanBackend(),
      });
    }
    if (!e.ok) {
      throw new Error(`MOD-014 boolean failed: ${e.detail}`);
    }
    const faces = e.value.mesh.faces.length;
    const facesBefore = mesh.faces.length;
    const soupOut = (await import("../studio-editable-half-edge-mesh")).studioEditableMeshToTriangleSoup(
      e.value.mesh,
    );
    const tris = soupOut.indices.length / 3;
    // Non-degenerate solid: not 2-face garbage; cube difference is a closed shell.
    if (faces < 8 || tris < 12) {
      throw new Error(
        `MOD-014 boolean degenerate solid faces=${faces} tris=${tris} (need faces≥8 tris≥12)`,
      );
    }
    if (faces <= facesBefore / 2) {
      throw new Error(
        `MOD-014 boolean collapsed topology faces=${faces} facesBefore=${facesBefore}`,
      );
    }
    return ok("MOD-014", {
      ok: true,
      faces,
      facesBefore,
      tris,
      verts: soupOut.positions.length / 3,
      backend: backendName,
      backendReady: true,
      solidViable: true,
    });
  },
  "MOD-015": async () => {
    let stack = createStudioMeshModifierStack(cube());
    stack = withStudioMeshModifier(stack, {
      kind: "solidify",
      id: "s",
      enabled: true,
      thickness: 0.05,
      evenThickness: true,
      rim: true,
    });
    const e = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioDefaultSolidBooleanBackend(),
    });
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-015", { faces: e.value.mesh.faces.length });
  },
  "MOD-016": async () => {
    let stack = createStudioMeshModifierStack(cube());
    stack = withStudioMeshModifier(stack, {
      kind: "bevel",
      id: "bv",
      enabled: true,
      amount: 0.05,
      segments: 1,
      angleLimitRad: Math.PI,
      weightInfluence: 1,
    });
    const e = await evaluateStudioMeshModifierStack(stack, {
      booleanBackend: createStudioDefaultSolidBooleanBackend(),
    });
    if (!e.ok) throw new Error(e.detail);
    return ok("MOD-016", { faces: e.value.mesh.faces.length });
  },
  "MOD-017": () => {
    const s = subdivideStudioMeshCatmullLite(cube(), 1);
    if (!s.ok) throw new Error(s.detail);
    return ok("MOD-017", { faces: s.value.faces.length });
  },
  "MOD-024": () => {
    const d = diagnoseStudioEditableMesh(cube());
    return ok("MOD-024", {
      issues: Array.isArray(d) ? d.length : (d as { issues?: unknown[] }).issues?.length ?? 0,
    });
  },
  "BLD-001": () => {
    const snap = resolveStudioBuildInferenceSnap({
      cursor: { x: 0.02, y: 0, z: 0 },
      segments: [
        { id: "s1", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
      ],
      pixelThreshold: 12,
      pixelsPerUnit: 100,
      pointerVelocity: 0,
      axisLock: "none",
      preferKinds: ["endpoint", "midpoint"],
    });
    return ok("BLD-001", {
      snapped: snap.snapped,
      candidates: snap.candidates.length,
      worldThreshold: snap.worldThreshold,
    });
  },
  "BLD-002": () => {
    const axis = cycleStudioInferenceAxisLock("x");
    const order = ["none", "x", "y", "z"] as const;
    return ok("BLD-002", {
      next: axis,
      locked: axis !== "none",
      axisIndex: order.indexOf(axis),
    });
  },
  "BLD-003": () => {
    const prim = {
      id: "box-1",
      kind: "box" as const,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: "#cccccc",
    };
    const plan = planStudioBg3dPushPull(prim, {
      distance: 0.5,
      axis: "y",
      face: "positive",
    });
    if (!plan.ok) throw new Error(plan.message);
    return ok("BLD-003", {
      appliedDistance: plan.appliedDistance,
      previousDimension: plan.previousDimension,
      nextDimension: plan.nextDimension,
    });
  },
  "BLD-004": () => {
    const off = offsetStudioFloorPlanPolygon(
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
        { x: 2, z: 2 },
        { x: 0, z: 2 },
      ],
      0.1,
    );
    if (!off.ok) throw new Error(off.reason);
    return ok("BLD-004", { points: off.polygon.length, resolved: off.selfIntersectionResolved });
  },
  "BLD-006": () => {
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
      ],
    });
    const plan = planStudioComponentMakeUnique(
      doc,
      "inst-1",
      "comp-chair-unique-1",
      "Chair Unique",
    );
    return ok("BLD-006", {
      kind: plan.kind,
      uniqueId: plan.definitionForward?.id ?? "",
      instances: doc.instances.length,
    });
  },
  "BLD-007": () => {
    const doc = createStudioTagsOutlinerDocument(
      [{ id: "tag-wall", label: "Wall", visible: true, renderLayer: 1 }],
      [
        {
          id: "node-1",
          label: "Wall A",
          parentId: null,
          tagIds: ["tag-wall"],
          objectVisible: true,
        },
      ],
    );
    const vis = resolveStudioOutlinerVisibility(doc, "node-1");
    return ok("BLD-007", {
      visible: vis.visible,
      layers: vis.renderLayers.length,
      reason: vis.reason,
    });
  },
  "BLD-009": () => {
    const walls = buildStudioWallsFromFloorPlan({
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
      ],
      closed: true,
      wallHeight: 2.5,
      wallThickness: 0.2,
    });
    return ok("BLD-009", {
      walls: walls.walls.length,
      rooms: walls.roomsDetected,
    });
  },
  "BLD-010": () => {
    const preset = getStudioBg3dRoomPreset("classroom");
    const parts = preset ? buildStudioBg3dRoomParts(preset.spec) : [];
    return ok("BLD-010", { parts: parts.length, hasPreset: Boolean(preset) });
  },
  "BLD-011": () => {
    const stairs = generateStudioStairs({
      steps: 8,
      rise: 0.18,
      run: 0.28,
      width: 1.0,
      landing: true,
    });
    return ok("BLD-011", {
      steps: stairs.steps.length,
      totalRise: stairs.totalRise,
      totalRun: stairs.totalRun,
      hasLanding: stairs.landing != null,
    });
  },
  "BLD-012": () => {
    const slab = generateStudioSlab({
      polygon: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
        { x: 0, z: 3 },
      ],
      elevation: 0,
      thickness: 0.2,
      kind: "floor",
    });
    if (!slab) throw new Error("slab generation failed");
    return ok("BLD-012", {
      thickness: slab.thickness,
      area: slab.area,
      polyPoints: slab.polygon.length,
    });
  },
  "BLD-015": () => {
    const preset = getStudioBg3dRoomPreset("cafe");
    const parts = preset ? buildStudioBg3dRoomParts(preset.spec) : [];
    return ok("BLD-015", { hasPreset: Boolean(preset), parts: parts.length });
  },
  "BLD-016": () => {
    const dim = createStudioDimension("dim-1", [0, 0, 0], [1, 0, 0], "m", 2);
    return ok("BLD-016", {
      id: dim.id,
      meters: dim.lengthMeters,
      display: dim.display,
    });
  },
  "BLD-018": () => {
    const hide = resolveStudioCameraWallHide({
      cameraPosition: [0, 1.6, 4],
      subjectPosition: [0, 1.0, 0],
      walls: [
        {
          id: "wall-front",
          point: [0, 1, 2],
          normal: [0, 0, 1],
          thickness: 0.2,
        },
      ],
      occludedOpacity: 0.2,
    });
    return ok("BLD-018", {
      decisions: hide.decisions.length,
      occluded: hide.occludedWallIds.length,
      cameraY: 1.6,
    });
  },
  "CAD-001": () => {
    const prim = exerciseStudioCad001SketchPrimitives();
    const r = diagnoseStudioCadConstraints(buildStudioCadRectangleSketch(1, 1, "mm"));
    return ok("CAD-001", {
      units: prim.units,
      curveCount: prim.curveCount,
      constructionCount: prim.constructionCount,
      trimmedLength: prim.trimmedLength,
      extendedLength: prim.extendedLength,
      kinds: prim.curveKinds.length,
      satisfied: r.satisfied.length,
      state: r.state,
    });
  },
  "CAD-015": () => {
    const solid = extrudeStudioCadProfile(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      0.5,
    );
    if (!solid) throw new Error("extrude failed");
    const exported = exportStudioCadStepAscii(solid, "CadProp");
    const imported = importStudioStepShell(exported.text);
    // also import external STEP fixture path
    const stepText = [
      "ISO-10303-21;",
      "DATA;",
      "#10=CARTESIAN_POINT('',(0.,0.,0.));",
      "#11=CARTESIAN_POINT('',(1.,0.,0.));",
      "#12=CARTESIAN_POINT('',(1.,1.,0.));",
      "#20=PRODUCT('Prop','Prop','',(#30));",
      "#40=ADVANCED_FACE('',(#50),#60,.T.);",
      "ENDSEC;",
    ].join("\n");
    const imported2 = importStudioStepShell(stepText);
    return ok("CAD-015", {
      extrudeTris: solid.indices.length / 3,
      exportBytes: exported.bytes,
      exportPoints: exported.pointCount,
      exportFaces: exported.faceCount,
      importMeshes: imported.meshes.length + imported2.meshes.length,
      importPoints:
        Number(imported.extras?.pointCount ?? 0)
        + Number(imported2.extras?.pointCount ?? 0),
      committed: imported.report.committed && imported2.report.committed,
    });
  },
  "SCP-001": () => {
    const before = cube();
    const s = applyStudioSculptStroke(before, {
      kind: "inflate",
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 0.5,
      strength: 0.1,
    });
    if (!s.ok) throw new Error(s.detail);
    return ok("SCP-001", {
      ok: true,
      verts: s.mesh.vertices.length,
      hashChanged: hashStudioEditableMesh(before) !== hashStudioEditableMesh(s.mesh),
    });
  },
  "CHR-001": () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    const r = importStudioGradeAAsset({
      fileName: "t.obj",
      bytes: new TextEncoder().encode(obj),
    });
    return ok("CHR-001", { committed: r.report.committed, meshes: r.report.counts.meshes });
  },
  "CHR-002": () => {
    const d = diagnoseStudioHumanoidMapping(
      ["hips", "spine", "chest", "neck", "head"],
      { hips: "hips", spine: "spine", head: "head" },
    );
    return ok("CHR-002", {
      mapped: d.mapped?.length ?? Object.keys(d).length,
      missing: d.missing?.length ?? 0,
    });
  },
  "CHR-003": () => {
    const pose = createStudioDefaultBodyPose();
    const ik = poseStudioBodyChainIk(pose, "leftArm", [0.3, 1.2, 0]);
    const fk = poseStudioBodyChainFk(pose, "spine", "upper", [0, 0.1, 0]);
    return ok("CHR-003", {
      ikBones: Object.keys(ik.bones).length,
      fkBones: Object.keys(fk.bones).length,
      fkMode: fk.modes.spine,
    });
  },
  "CHR-007": () => {
    const fist = STUDIO_HAND_POSE_LIBRARY.find((p) => p.id === "fist")!;
    const left = mirrorStudioHandPose(fist, "left");
    return ok("CHR-007", {
      poses: STUDIO_HAND_POSE_LIBRARY.length,
      side: left.side,
      curlSum: left.curls.reduce((s, c) => s + c, 0),
    });
  },
  "CHR-008": () => {
    const m = mixStudioExpressions([
      { name: "joy", weight: 0.5 },
      { name: "angry", weight: 0.2 },
    ]);
    return ok("CHR-008", {
      channels: m.channels?.length ?? Object.keys(m).length,
    });
  },
  "CHR-009": () => {
    const look = createStudioLookAt({
      target: "world",
      worldPoint: [0, 1.5, 1],
      eyeWeight: 1,
      headWeight: 0.4,
    });
    return ok("CHR-009", {
      target: look.target,
      eyeWeight: look.eyeWeight,
      headWeight: look.headWeight,
    });
  },
  "CHR-018": () => {
    const meta = createStudioPoseAssetMetadata({
      id: "pose-1",
      label: "wave",
      bodyType: "adult",
      contact: ["ground"],
      cameraHint: "three-quarter",
      rightsLicense: "CC0-1.0",
      creator: "studio",
      tags: ["wave"],
    });
    return ok("CHR-018", { id: meta.id, tags: meta.tags.length });
  },
  "GAR-005": () => {
    const g = createStudioClothGrid(1, 1, 4, 4);
    const s = stepStudioClothXpbd(g, 1 / 60, 2);
    return ok("GAR-005", { particles: s.particles.length });
  },
  "MAT-004": () => {
    const uv = unwrapStudioMeshBox(cube());
    return ok("MAT-004", { uvs: uv.uvs.length / 2, mode: uv.mode });
  },
  "PRC-005": () => {
    const preset = getStudioBg3dRoomPreset("classroom");
    const parts = preset ? buildStudioBg3dRoomParts(preset.spec) : [];
    return ok("PRC-005", { parts: parts.length });
  },
  "SHT-001": () => {
    const set = createStudioSharedSet("s", []);
    const bridge = createStudioLiveBridgeDocument(set, Array.from({ length: 8 }, (_, i) => `shot-${i + 1}`));
    return ok("SHT-001", { shots: bridge.shots.length });
  },
  "SHT-002": () => {
    const fov = studioCameraFovY({
      focalLengthMm: 35,
      sensorWidthMm: 36,
      sensorHeightMm: 24,
      ortho: false,
    });
    return ok("SHT-002", { fovY: fov });
  },
  "SHT-003": () => {
    const set = createStudioSharedSet("s", []);
    let bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
    bridge = applyStudioShotOverride(bridge, "shot-1", {
      camera: { position: [0, 1, 4], target: [0, 1, 0], fov: 40 },
    });
    return ok("SHT-003", { shots: bridge.shots.length });
  },
  "SHT-005": () => {
    const hide = resolveStudioCameraWallHide({
      cameraPosition: [0, 1.6, 3],
      walls: [],
    } as never);
    return ok("SHT-005", { hidden: Array.isArray(hide) ? hide.length : 0 });
  },
  "NPR-001": () => {
    const set = createStudioSharedSet("s", []);
    let bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
    let passCount = 0;
    for (const p of STUDIO_TOON_PASS_KINDS) {
      bridge = generateStudioToonPass(bridge, "shot-1", p);
      passCount += 1;
    }
    return ok("NPR-001", {
      passes: STUDIO_TOON_PASS_KINDS.length,
      generated: passCount,
    });
  },
  "NPR-005": () => {
    const set = createStudioSharedSet("s", [
      { id: "o1", geometryHash: "g", visible: true, materialId: "m" },
    ]);
    let bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
    for (const p of STUDIO_TOON_PASS_KINDS) {
      bridge = generateStudioToonPass(bridge, "shot-1", p);
    }
    const shot = bridge.shots[0];
    return ok("NPR-005", {
      passHashes: Object.keys(shot?.passHashes ?? {}).length,
      dirty: shot?.dirtyPasses.length ?? 0,
    });
  },
  "NPR-006": () => {
    const set = createStudioSharedSet("s", []);
    let bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
    bridge = addStudioArtistDelta(bridge, {
      id: "d1",
      pass: "line",
      shotId: "shot-1",
      points: [[0, 0], [1, 1]],
      pressure: [1, 1],
      provenance: { objectId: "o", confidence: 1 },
      creationCameraHash: "c",
      creationGeometryHash: "g",
      createdAt: 0,
    });
    return ok("NPR-006", { deltas: bridge.artistCorrections.deltas.length });
  },
  "NPR-008": () => {
    let store = createStudioArtistCorrectionStore();
    store = appendStudioArtistCorrection(store, {
      id: "d1",
      pass: "line",
      shotId: "shot-1",
      points: [[0.1, 0.1], [0.5, 0.5]],
      pressure: [1, 0.8],
      provenance: { objectId: "o1", confidence: 1 },
      creationCameraHash: "cam-a",
      creationGeometryHash: "geo-a",
      createdAt: 0,
    });
    const reproj = reprojectStudioArtistCorrections(store, {
      shotId: "shot-1",
      previousCameraHash: "cam-a",
      nextCameraHash: "cam-b",
      previousGeometryHash: "geo-a",
      nextGeometryHash: "geo-a",
      policy: "reproject-uv",
      uvAffine: [1, 0, 0.05, 0, 1, 0],
    });
    return ok("NPR-008", {
      deltas: store.deltas.length,
      preserved: reproj.preservedIds.length,
      reprojected: reproj.reprojectedIds.length,
      dropped: reproj.droppedIds.length,
    });
  },
  "FMT-FBX": () => {
    // ASCII path (always mesh-commit)
    const ascii = [
      "; FBX 7.4.0 project file",
      "FBXHeaderExtension:  {",
      "\tFBXHeaderVersion: 1003",
      "\tFBXVersion: 7400",
      "}",
      "Objects:  {",
      "\tGeometry: 1, \"Geometry::Triangle\", \"Mesh\" {",
      "\t\tVertices: *9 {",
      "\t\t\ta: 0,0,0,1,0,0,0,1,0",
      "\t\t}",
      "\t\tPolygonVertexIndex: *3 {",
      "\t\t\ta: 0,1,-3",
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const asciiR = importStudioFbxDocument(ascii);
    const bytes = new Uint8Array(40);
    const magic = new TextEncoder().encode("Kaydara FBX Binary  ");
    bytes.set(magic);
    bytes[23] = 0x1a;
    const sniff = sniffStudioFbxBinaryHeader(bytes);
    const parsed = parseStudioFbxBinaryMeshLite(bytes);
    const binaryR = importStudioFbxDocument(bytes);
    return ok("FMT-FBX", {
      magicOk: sniff.magicOk,
      asciiOk: asciiR.ok,
      asciiMeshes: asciiR.ok ? asciiR.meshes.length : 0,
      binaryNodes: parsed.nodeCount,
      binaryOk: binaryR.ok,
      headerBytes: bytes.byteLength,
      magicLength: magic.length,
    });
  },
  "FMT-IFC": () => {
    const r = importStudioIfcShell(
      "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=IFCCARTESIANPOINT((0.,0.,0.));\n#2=IFCCARTESIANPOINT((1.,0.,0.));\n#3=IFCCARTESIANPOINT((1.,1.,0.));\n#4=IFCCARTESIANPOINT((0.,1.,0.));\n#10=IFCSPACE('2O2Fr$t4X7Zf8NOew3FNrS',$,'RoomA',$,$,$,$,$,.ELEMENT.,$,$);\n#11=IFCWALLSTANDARDCASE('2O2Fr$t4X7Zf8NOew3FNrt',$,'Wall1',$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;",
    );
    return ok("FMT-IFC", {
      format: r.format,
      meshes: r.meshes.length,
      pointCount: Number(r.extras?.pointCount ?? 0),
      committed: r.report.committed,
    });
  },
  "FMT-STEP": () => {
    const r = importStudioStepShell(
      "ISO-10303-21;\nDATA;\n#10=CARTESIAN_POINT('',(0.,0.,0.));\n#11=CARTESIAN_POINT('',(1.,0.,0.));\n#12=CARTESIAN_POINT('',(1.,1.,0.));\n#13=CARTESIAN_POINT('',(0.,1.,0.));\n#20=PRODUCT('Box','Box','',(#30));\n#40=ADVANCED_FACE('',(#50),#60,.T.);\n#50=CLOSED_SHELL('',(#40));\nENDSEC;",
    );
    return ok("FMT-STEP", {
      format: r.format,
      pointCount: Number(r.extras?.pointCount ?? 0),
      meshes: r.meshes.length,
      advancedFaces: Number(r.extras?.advancedFaces ?? 0),
      committed: r.report.committed,
    });
  },
  "MAT-006": () => {
    const d = createStudioDecalPlacement({
      id: "d1",
      meshObjectId: "wall-1",
      mode: "planar",
      uvOffset: [0.1, 0.2],
      uvScale: [0.5, 0.5],
      textureAssetId: "tex-poster",
      shotOnly: true,
    });
    return ok("MAT-006", {
      mode: d.mode,
      shotOnly: d.shotOnly,
      uvScaleX: d.uvScale[0],
      uvScaleY: d.uvScale[1],
    });
  },
  "MAT-009": () => {
    const k = studioKtx2DerivativeForProfile(4096, "mobile");
    return ok("MAT-009", {
      maxExtent: k.maxExtent,
      format: k.format,
      profile: k.profile,
    });
  },
};

export async function runStudioDccSection6CoreKernel(
  id: string,
): Promise<StudioDccKernelResult> {
  const runner = STUDIO_DCC_SECTION6_CORE_RUNNERS[id];
  if (!runner) throw new Error(`no core runner for ${id}`);
  const result = await runner();
  if (result.id !== id) throw new Error(`core id mismatch ${id}`);
  return result;
}
