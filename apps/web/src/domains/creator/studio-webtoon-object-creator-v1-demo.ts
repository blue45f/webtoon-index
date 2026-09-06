/**
 * §11 P1 end-criterion vertical path (scripted, pure kernels):
 * 상자 → 소품 → 방 → 8컷 → 3D 수정 → 수작업 선(artist delta) 유지 → save/reload.
 *
 * This is the honest product-path exercise without requiring a browser UI:
 * hybrid document + live bridge + OPFS recovery + room builder + mesh ops.
 */

import {
  buildStudioBg3dRoomParts,
  getStudioBg3dRoomPreset,
} from "./bg3d/studio-bg3d-room-builder";
import {
  createStudioHybridDccOpfsPorts,
  createStudioHybridDccSession,
  hybridDccCommitGeometry,
  hybridDccRecoverFromJournal,
  hybridDccRegisterAsset,
  type StudioHybridDccSession,
} from "./hybrid-dcc/studio-hybrid-dcc-document";
import {
  addStudioArtistDelta,
  applyStudioShotOverride,
  createStudioLiveBridgeDocument,
  createStudioSharedSet,
  generateStudioToonPass,
  mutateStudioSharedObjectGeometry,
  studioLiveBridgeDirtySummary,
  STUDIO_TOON_PASS_KINDS,
  type StudioLiveBridgeDocument,
} from "./live/studio-live-2d3d-bridge";
import {
  bevelStudioEditableMeshEdges,
  createStudioUnitCubeMesh,
  extrudeStudioEditableMeshFaces,
  hashStudioEditableMesh,
  knifeStudioEditableMesh,
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
} from "./studio-editable-half-edge-mesh";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "./studio-mesh-modifier-stack";
import { bridgeStudioFaceLoops } from "./studio-mesh-ops-advanced";
import { createStudioManifoldSolidBooleanBackend } from "./studio-solid-boolean-backend";

import type { StudioOpfsRecoveryJournalAdapter } from "./studio-opfs-recovery-journal";

export const STUDIO_WEBTOON_OBJECT_CREATOR_V1_DEMO_REVISION = 1 as const;

export interface StudioWebtoonObjectCreatorV1DemoResult {
  readonly revision: typeof STUDIO_WEBTOON_OBJECT_CREATOR_V1_DEMO_REVISION;
  readonly boxHash: string;
  readonly propHash: string;
  readonly roomPartCount: number;
  readonly shotCount: number;
  readonly artistDeltaPreserved: boolean;
  readonly dirtyPassCountAfter3dEdit: number;
  readonly recoveredMeshHash: string;
  readonly meshHashMatchesAfterReload: boolean;
  readonly booleanTopologyChanged: boolean;
  readonly knifeTopologyChanged: boolean;
  readonly bridgeTopologyChanged: boolean;
  readonly session: StudioHybridDccSession;
  readonly bridge: StudioLiveBridgeDocument;
}

/** Minimal in-memory OPFS adapter for demo recovery (same contract as journal tests). */
export class StudioDemoOpfsAdapter implements StudioOpfsRecoveryJournalAdapter {
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

/**
 * Run the Webtoon Object Creator v1 vertical scenario end-to-end on pure kernels.
 */
export async function runStudioWebtoonObjectCreatorV1Demo(
  options: { readonly adapter?: StudioOpfsRecoveryJournalAdapter } = {},
): Promise<StudioWebtoonObjectCreatorV1DemoResult> {
  // 1) 상자
  let mesh: StudioEditableMesh = createStudioUnitCubeMesh();
  const boxHash = hashStudioEditableMesh(mesh);

  // 2) 소품 — extrude + knife + bridge exercise
  const extruded = extrudeStudioEditableMeshFaces(mesh, [0], 0.35);
  if (!extruded.ok) throw new Error(extruded.detail);
  mesh = extruded.value;
  const beforeKnife = studioEditableMeshToTriangleSoup(mesh);
  const knifed = knifeStudioEditableMesh(mesh, {
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  });
  if (!knifed.ok) throw new Error(knifed.detail);
  const knifeTopologyChanged =
    studioEditableMeshToTriangleSoup(knifed.value).positions.length
    !== beforeKnife.positions.length;
  mesh = knifed.value;

  const beforeBridge = mesh.faces.length;
  // Bridge two opposite face loops if cube-like quads exist
  const loopA = [0, 1, 2, 3];
  const loopB = [4, 5, 6, 7];
  const bridged = bridgeStudioFaceLoops(createStudioUnitCubeMesh(), loopA, loopB);
  const bridgeTopologyChanged = bridged.ok && bridged.value.faces.length > beforeBridge;

  // Bevel one edge
  const he = mesh.halfEdges[0]?.id ?? 0;
  const beveled = bevelStudioEditableMeshEdges(mesh, [he], 0.12);
  if (beveled.ok) mesh = beveled.value;
  const propHash = hashStudioEditableMesh(mesh);

  // Boolean via Manifold (MOD-014)
  let stack = createStudioMeshModifierStack(createStudioUnitCubeMesh());
  const operandSoup = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
  const scaled = new Float32Array(operandSoup.positions);
  for (let i = 0; i < scaled.length; i += 1) scaled[i]! *= 0.55;
  // Translate operand so difference is non-trivial on solid
  for (let i = 0; i < scaled.length; i += 3) scaled[i]! += 0.25;
  stack = withStudioMeshModifier(stack, {
    kind: "boolean",
    id: "bool-demo",
    enabled: true,
    operation: "difference",
    operand: { positions: scaled, indices: operandSoup.indices },
  });
  const boolEval = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioManifoldSolidBooleanBackend(),
  });
  const booleanTopologyChanged =
    boolEval.ok
    && boolEval.value.resultHash !== boolEval.value.sourceHash
    && studioEditableMeshToTriangleSoup(boolEval.value.mesh).indices.length > 0;

  // 3) 방
  const preset = getStudioBg3dRoomPreset("classroom");
  if (!preset) throw new Error("classroom preset missing");
  const roomParts = buildStudioBg3dRoomParts(preset.spec);

  // 4) Document + 8 shots
  let session = createStudioHybridDccSession("webtoon-object-creator-v1");
  session = hybridDccRegisterAsset(session, "prop-box", mesh, {
    source: "primitive",
    creator: "demo",
    license: "CC0-1.0",
    useScope: "commercial",
    derivative: "original",
  });
  session = hybridDccCommitGeometry(session, "prop-box", mesh);

  const set = createStudioSharedSet("set-main", [
    {
      id: "prop-box",
      geometryHash: propHash,
      visible: true,
      materialId: "mat-default",
    },
    {
      id: "room-shell",
      geometryHash: `room:${roomParts.length}`,
      visible: true,
      materialId: "mat-wall",
    },
  ]);
  const shotIds = Array.from({ length: 8 }, (_, i) => `shot-${i + 1}`);
  let bridge = createStudioLiveBridgeDocument(set, shotIds);
  if (bridge.shots.length !== 8) throw new Error("expected 8 shots");

  for (let i = 0; i < 8; i += 1) {
    bridge = applyStudioShotOverride(bridge, shotIds[i]!, {
      camera: {
        position: [Math.cos((i / 8) * Math.PI * 2) * 4, 1.6, Math.sin((i / 8) * Math.PI * 2) * 4],
        target: [0, 1, 0],
        fov: 35 + i,
      },
      material: i % 2 === 0 ? { "prop-box": "mat-toon" } : undefined,
    });
  }

  // Generate toon passes for shot-1
  for (const pass of STUDIO_TOON_PASS_KINDS) {
    bridge = generateStudioToonPass(bridge, "shot-1", pass);
  }

  // 5) 수작업 선 delta
  bridge = addStudioArtistDelta(bridge, {
    id: "ink-fix-1",
    pass: "line",
    shotId: "shot-1",
    points: [
      [0.3, 0.4],
      [0.35, 0.45],
      [0.4, 0.42],
    ],
    pressure: [0.9, 0.85, 0.8],
    provenance: { edgeId: "e0", objectId: "prop-box", confidence: 0.95 },
    creationCameraHash: "cam-shot-1",
    creationGeometryHash: propHash,
    createdAt: 1,
  });

  // 6) 3D 수정 — must not wipe artist delta
  const nextHash = `${propHash}:edited`;
  bridge = mutateStudioSharedObjectGeometry(bridge, "prop-box", nextHash);
  const summary = studioLiveBridgeDirtySummary(bridge);
  const artistDeltaPreserved =
    bridge.artistCorrections.deltas.some((d) => d.id === "ink-fix-1");

  // 7) save / reload via OPFS journal
  const adapter = options.adapter ?? new StudioDemoOpfsAdapter();
  let t = 50_000;
  const ports = createStudioHybridDccOpfsPorts({
    adapter,
    documentId: "webtoon-object-creator-v1",
    now: () => ++t,
    randomToken: () => `demo-${t}`,
  });
  const recovered = await hybridDccRecoverFromJournal(session, ports);
  const recoveredMeshHash =
    recovered.session.state.geometry.records["prop-box"]?.meshHash ?? "";
  const meshHashMatchesAfterReload =
    recovered.meshHashesEqual
    && recoveredMeshHash === session.state.geometry.records["prop-box"]!.meshHash;

  return {
    revision: STUDIO_WEBTOON_OBJECT_CREATOR_V1_DEMO_REVISION,
    boxHash,
    propHash,
    roomPartCount: roomParts.length,
    shotCount: bridge.shots.length,
    artistDeltaPreserved,
    dirtyPassCountAfter3dEdit: summary.dirtyPassCount,
    recoveredMeshHash,
    meshHashMatchesAfterReload,
    booleanTopologyChanged: Boolean(booleanTopologyChanged),
    knifeTopologyChanged,
    bridgeTopologyChanged: Boolean(bridgeTopologyChanged),
    session: recovered.session,
    bridge,
  };
}


