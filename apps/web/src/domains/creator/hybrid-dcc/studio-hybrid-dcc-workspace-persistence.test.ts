import { describe, expect, it } from "vitest";

import {
  createStudioSharedSet,
  type StudioLiveBridgeDocument,
} from "../live/studio-live-2d3d-bridge";
import {
  canonicalStudioCommandJson,
  serializeStudioCommandJournal,
} from "../studio-command-journal";
import { calculateStudioCrc32 } from "../studio-crc32";
import {
  hashStudioEditableMesh,
  studioEditableMeshStats,
} from "../studio-editable-half-edge-mesh";
import { createStudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";
import { sha256HexPortable } from "../studio-sha256";

import {
  createStudioHybridDccComponentSelection,
  mutateStudioHybridDccComponentSelection,
} from "./studio-hybrid-dcc-component-selection";
import {
  workspaceAddActiveModifier,
  workspaceRefreshModifierPreviews,
} from "./studio-hybrid-dcc-modifier-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceAddArtistInk,
  workspaceAddUnitCube,
  workspaceClothStep,
  workspaceCollabJoin,
  workspaceCommitActiveObjectTransform,
  workspaceDeleteActive,
  workspaceDuplicateActive,
  workspaceEnsureShots,
  workspaceExportActiveMesh,
  workspaceExtrudeActive,
  workspaceExtrudeRegionActive,
  workspaceLoadRoomPreset,
  workspaceComponentSelectionSource,
  workspaceRedo,
  workspaceRetargetFromBvhExtras,
  workspaceSampleIdleClip,
  workspaceSelectAsset,
  workspaceSetAssetVisibility,
  workspaceStepSpring,
  workspaceUndo,
  workspaceUvUnwrapActive,
  type StudioHybridDccWorkspace,
} from "./studio-hybrid-dcc-workspace";
import {
  createStudioHybridDccWorkspacePersistence,
  createStudioHybridDccWorkspacePersistenceFromFileSystem,
  decodeStudioHybridDccWorkspacePersistenceEnvelope,
  encodeStudioHybridDccWorkspacePersistenceEnvelope,
  resolveStudioHybridDccWorkspacePersistenceScope,
  StudioHybridDccWorkspacePersistenceError,
  type StudioHybridDccWorkspacePersistenceScope,
} from "./studio-hybrid-dcc-workspace-persistence";

import type { StudioHybridDccPersistedSnapshot } from "./studio-hybrid-dcc-document";
import type { StudioOpfsRecoveryJournalAdapter } from "../studio-opfs-recovery-journal";

class FakeWorkspaceOpfsAdapter implements StudioOpfsRecoveryJournalAdapter {
  readonly kind = "fake-opfs" as const;
  readonly files = new Map<string, Uint8Array>();
  quota: number | null = null;
  failNextHeadWrite = false;

  async read(path: string): Promise<Uint8Array | null> {
    const value = this.files.get(path);
    return value ? new Uint8Array(value) : null;
  }

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    if (this.failNextHeadWrite && /\/head-[ab]\.bin$/u.test(path)) {
      this.failNextHeadWrite = false;
      throw new Error("simulated crash before head commit");
    }
    this.files.set(path, new Uint8Array(bytes));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right));
  }

  async size(path: string): Promise<number | null> {
    return this.files.get(path)?.byteLength ?? null;
  }

  async estimateQuota(): Promise<{ readonly usage: number; readonly quota: number } | null> {
    if (this.quota === null) return null;
    const usage = [...this.files.values()]
      .reduce((total, bytes) => total + bytes.byteLength, 0);
    return { usage, quota: this.quota };
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

  corruptLatestPayloadChunk(): void {
    const path = [...this.files.keys()]
      .filter((candidate) => /\/cp-\d+-e\d+-c\d+\.bin$/u.test(candidate))
      .sort((left, right) => left.localeCompare(right))
      .at(-1);
    if (!path) throw new Error("checkpoint payload chunk not found");
    const bytes = new Uint8Array(this.files.get(path)!);
    bytes[Math.floor(bytes.byteLength / 2)]! ^= 0xff;
    this.files.set(path, bytes);
  }
}

class FifoWorkspaceOpfsAdapter extends FakeWorkspaceOpfsAdapter {
  #lockTail: Promise<void> = Promise.resolve();

  override withExclusiveLock<T>(
    _name: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.#lockTail.then(async () => {
      if (signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      return operation();
    });
    this.#lockTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const SCOPE: StudioHybridDccWorkspacePersistenceScope = {
  userId: "사용자-42",
  workId: "작품-3D-세트",
};

function deterministicClock(start = 10_000) {
  let value = start;
  return () => {
    value += 1;
    return value;
  };
}

const PRE_SLICE_CUBE_HASH = "mesh:1d31fe58";
const PRE_SLICE_CUBE_RIGHTS_HASH =
  "sha256:04781d901bb09f48a12ebf893ae59bec75abeeb4abeaf0c4beea2cff4d3854c8";
const PRE_SLICE_CURRENT_STATE_HASH =
  "sha256:34a91323fd71e7561ff1a6ba7741d882712d7572afd9938ad95aca113f256649";
const PRE_SLICE_CUBE_UNDO_STATE_HASH =
  "sha256:fb3b8fc04806c5db816c986ff67c77bf5457496da805811af0c141681b25cb74";
const PRE_SLICE_CUBE_REDO_STATE_HASH =
  "sha256:daf2cf2f92f2a0b32d03d4ccdddc91778ed5a2889a76580c7c582c5d7317973d";
const PRE_SLICE_BRIDGE_SET_HASH =
  "sha256:375deff3f915d9707b663e4e8113db2940080020d24219329eb44cb6df62bb31";
const PRE_SLICE_ARRAY_SOLIDIFY_PREVIEW_HASH = "mesh:eeca9c4f";
const PRE_SLICE_ARRAY_SOLIDIFY_STATE_HASH =
  "sha256:4bab60b27daaced8bee1a6057c49ead19973839eab8564b5262a9264cabc0fa6";

interface MutableWorkspaceEnvelopeFixture extends Record<string, unknown> {
  payload: {
    readonly session: Record<string, unknown> & {
      readonly state: StudioHybridDccPersistedSnapshot;
      readonly undoStack: readonly StudioHybridDccPersistedSnapshot[];
      readonly redoStack: readonly StudioHybridDccPersistedSnapshot[];
    };
    readonly bridge: StudioLiveBridgeDocument;
    readonly aux: unknown;
  };
  documentStateHash: string;
  payloadByteLength: number;
  payloadCrc32: number;
  sourceHash: string;
}

function migrateFixtureSnapshotToPreSlice(
  snapshot: StudioHybridDccPersistedSnapshot,
  stateHash: string,
): StudioHybridDccPersistedSnapshot {
  return {
    ...snapshot,
    stateHash,
    rightsBom: snapshot.rightsBom.map((record) => (
      record.assetId === "cube"
        ? { ...record, contentHash: PRE_SLICE_CUBE_RIGHTS_HASH }
        : record
    )),
    assets: snapshot.assets.map((asset) => (
      asset.assetId === "cube" ? { ...asset, meshHash: PRE_SLICE_CUBE_HASH } : asset
    )),
  };
}

function sealWorkspaceEnvelopeFixture(
  envelope: MutableWorkspaceEnvelopeFixture,
): Uint8Array {
  const payloadBytes = new TextEncoder().encode(canonicalStudioCommandJson(envelope.payload));
  return new TextEncoder().encode(canonicalStudioCommandJson({
    ...envelope,
    payloadByteLength: payloadBytes.byteLength,
    payloadCrc32: calculateStudioCrc32(payloadBytes),
    sourceHash: `sha256:${sha256HexPortable(payloadBytes)}`,
  }));
}

/** Real v3 pre-slice hashes are fixed outputs of the implementation at 7b039bbc. */
function createPreSliceV3WorkspaceFixture(): {
  readonly bytes: Uint8Array;
  readonly currentWorkspace: StudioHybridDccWorkspace;
} {
  let workspace = createStudioHybridDccWorkspace("legacy-v3-workspace-fixture");
  workspace = workspaceAddUnitCube(workspace, "cube");
  workspace = workspaceCommitActiveObjectTransform(workspace, {
    revision: 1,
    position: [1, 2, 3],
    rotationEulerRad: [0.1, 0.2, 0.3],
    scale: [1, 1, 1],
  });
  workspace = workspaceCommitActiveObjectTransform(workspace, {
    revision: 1,
    position: [9, 8, 7],
    rotationEulerRad: [0.4, 0.5, 0.6],
    scale: [2, 2, 2],
  });
  workspace = workspaceUndo(workspace);
  workspace = workspaceLoadRoomPreset(workspace, "classroom");
  const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
    workspace,
    scope: SCOPE,
    savedAt: 7_003_900,
  });
  const envelope = JSON.parse(
    new TextDecoder().decode(encoded.bytes),
  ) as MutableWorkspaceEnvelopeFixture;
  if (envelope.payload.session.undoStack.length !== 2
    || envelope.payload.session.redoStack.length !== 1) {
    throw new Error("pre-slice fixture must contain empty/cube undo and cube redo snapshots");
  }
  const bridgeSet = createStudioSharedSet(
    envelope.payload.bridge.set.id,
    envelope.payload.bridge.set.objects.map((object) => (
      object.id === "cube" ? { ...object, geometryHash: PRE_SLICE_CUBE_HASH } : object
    )),
  );
  if (bridgeSet.setHash !== PRE_SLICE_BRIDGE_SET_HASH) {
    throw new Error("pre-slice bridge fixture no longer matches 7b039bbc");
  }
  const undoStack = envelope.payload.session.undoStack.map((snapshot, index) => (
    index === 1
      ? migrateFixtureSnapshotToPreSlice(snapshot, PRE_SLICE_CUBE_UNDO_STATE_HASH)
      : snapshot
  ));
  const redoStack = envelope.payload.session.redoStack.map((snapshot) => (
    migrateFixtureSnapshotToPreSlice(snapshot, PRE_SLICE_CUBE_REDO_STATE_HASH)
  ));
  const legacyEnvelope: MutableWorkspaceEnvelopeFixture = {
    ...envelope,
    documentStateHash: PRE_SLICE_CURRENT_STATE_HASH,
    payload: {
      ...envelope.payload,
      session: {
        ...envelope.payload.session,
        state: migrateFixtureSnapshotToPreSlice(
          envelope.payload.session.state,
          PRE_SLICE_CURRENT_STATE_HASH,
        ),
        undoStack,
        redoStack,
      },
      bridge: { ...envelope.payload.bridge, set: bridgeSet },
    },
  };
  return { bytes: sealWorkspaceEnvelopeFixture(legacyEnvelope), currentWorkspace: workspace };
}

async function createPreSliceModifierPreviewFixture(): Promise<{
  readonly bytes: Uint8Array;
  readonly currentWorkspace: StudioHybridDccWorkspace;
}> {
  let workspace = createStudioHybridDccWorkspace("legacy-modifier-preview");
  workspace = workspaceAddUnitCube(workspace, "cube");
  workspace = await workspaceAddActiveModifier(workspace, "array");
  workspace = await workspaceAddActiveModifier(workspace, "solidify");
  // History fidelity is covered by the main legacy fixture. Keep this fixture bounded to the
  // nonempty persisted stack and its disposable evaluated bridge presentation.
  workspace = {
    ...workspace,
    session: {
      ...workspace.session,
      undoStack: [],
      redoStack: [],
      lastGroupId: null,
      undoGroupStack: [],
      redoGroupStack: [],
    },
  };
  const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
    workspace,
    scope: SCOPE,
    savedAt: 7_003_903,
  });
  const envelope = JSON.parse(
    new TextDecoder().decode(encoded.bytes),
  ) as MutableWorkspaceEnvelopeFixture;
  const legacyBridgeSet = createStudioSharedSet(
    envelope.payload.bridge.set.id,
    envelope.payload.bridge.set.objects.map((object) => (
      object.id === "cube"
        ? { ...object, geometryHash: PRE_SLICE_ARRAY_SOLIDIFY_PREVIEW_HASH }
        : object
    )),
  );
  const legacyEnvelope: MutableWorkspaceEnvelopeFixture = {
    ...envelope,
    documentStateHash: PRE_SLICE_ARRAY_SOLIDIFY_STATE_HASH,
    payload: {
      ...envelope.payload,
      session: {
        ...envelope.payload.session,
        state: migrateFixtureSnapshotToPreSlice(
          envelope.payload.session.state,
          PRE_SLICE_ARRAY_SOLIDIFY_STATE_HASH,
        ),
      },
      bridge: { ...envelope.payload.bridge, set: legacyBridgeSet },
    },
  };
  return { bytes: sealWorkspaceEnvelopeFixture(legacyEnvelope), currentWorkspace: workspace };
}

function buildFullWorkspace(): StudioHybridDccWorkspace {
  let workspace = createStudioHybridDccWorkspace("persist-roundtrip");
  workspace = workspaceAddUnitCube(workspace, "hero-prop");
  workspace = workspaceExtrudeActive(workspace, 0.25);
  workspace = workspaceCommitActiveObjectTransform(workspace, {
    revision: 1,
    position: [3.25, -0.5, 7],
    rotationEulerRad: [0.1, 0.2, -0.3],
    scale: [1.25, 0.8, 2],
  });
  workspace = workspaceEnsureShots(workspace, 3);
  workspace = workspaceAddArtistInk(workspace, "shot-2");
  workspace = workspaceUvUnwrapActive(workspace, "box");
  workspace = workspaceRetargetFromBvhExtras(workspace, [
    "hips",
    "spine",
    "head",
    "leftUpperArm",
    "rightUpperArm",
  ]);
  workspace = workspaceExportActiveMesh(workspace, "obj");
  workspace = workspaceStepSpring(workspace);
  workspace = workspaceClothStep(workspace);
  workspace = workspaceSampleIdleClip(workspace, 0.375);
  workspace = workspaceCollabJoin(workspace, "peer-a", "민지");
  workspace = {
    ...workspace,
    lastImportReport: {
      revision: 1,
      parser: "test-import",
      sourceHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      warnings: ["material extension retained as evidence"],
    },
  };
  const mesh = workspace.session.state.geometry.records["hero-prop"]!.mesh;
  const stats = studioEditableMeshStats(mesh);
  workspace = {
    ...workspace,
    lastOcct: {
      ok: true,
      bodyKind: "solid",
      mesh,
      faceCount: stats.faceCount,
      triangleCount: stats.faceCount * 2,
      vertexCount: stats.vertexCount,
      volumeApprox: 1,
      topology: {
        source: "tessellated-triangle-mesh",
        boundaryEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        orientationConflictEdgeCount: 0,
        degenerateTriangleCount: 0,
        consistentOrientation: true,
        watertight: true,
        closedSolid: true,
        signedVolume: 1,
      },
      massProperties: {
        source: "occt-brep",
        density: 1,
        densityUnit: "mass/model-unit^3",
        mass: 1,
        volume: 1,
        volumeSource: "occt-brep",
        surfaceArea: 6,
        surfaceAreaSource: "occt-brep",
        centroid: { x: 0.5, y: 0.5, z: 0.5 },
        centroidSource: "occt-brep",
        inertia: { xx: 1, yy: 1, zz: 1, xy: 0, xz: 0, yz: 0 },
        inertiaSource: "occt-brep",
        approximate: false,
      },
      backend: "opencascade-wasm",
      operation: "BRepPrimAPI_MakeBox",
      loadPath: "browser",
    },
    lastDynatopo: {
      facesBefore: 6,
      facesAfter: 24,
      boundaryEdges: 0,
      mode: "refine",
    },
    lastRetopo: {
      facesBefore: 24,
      facesAfter: 8,
      targetFaces: 8,
      meanError: 0.0125,
    },
  };
  // Preserve a non-empty redo stack as part of cold-start authoring fidelity.
  return workspaceUndo(workspace);
}

function createStore(adapter: FakeWorkspaceOpfsAdapter, scope = SCOPE) {
  return createStudioHybridDccWorkspacePersistence({
    adapter,
    scope,
    now: deterministicClock(),
    randomToken: (() => {
      let sequence = 0;
      return () => `workspace-token-${++sequence}`;
    })(),
  });
}

function expectPersistenceError(
  code: InstanceType<typeof StudioHybridDccWorkspacePersistenceError>["code"],
) {
  return expect.objectContaining({
    name: "StudioHybridDccWorkspacePersistenceError",
    code,
  });
}

describe("Hybrid DCC workspace OPFS persistence", () => {
  it("reopens region-extruded geometry exactly while keeping transient selection out of cold state", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const initial = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("persist-region-extrude"),
      "hero-prop",
    );
    const source = workspaceComponentSelectionSource(initial);
    if (!source) throw new Error("expected an active mesh selection source");
    const selected = mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      {
        mode: "face",
        operation: "replace",
        ids: [0, 2],
        activeId: 2,
        source,
      },
    );
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error("expected a canonical face selection");
    const mutation = workspaceExtrudeRegionActive(initial, selected.value, 0.25);
    const expectedRecord = mutation.workspace.session.state.geometry.records["hero-prop"]!;
    const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace: mutation.workspace,
      scope: SCOPE,
      savedAt: 123,
    });
    expect(encoded).not.toContain("componentSelection");

    await createStore(adapter).save(mutation.workspace);
    const loaded = await createStore(adapter).load();
    expect(loaded.status).toBe("restored");
    if (loaded.status !== "restored") return;
    const reopenedRecord = loaded.workspace.session.state.geometry.records["hero-prop"]!;
    expect(reopenedRecord.meshHash).toBe(expectedRecord.meshHash);
    expect(reopenedRecord.mesh.faces).toHaveLength(expectedRecord.mesh.faces.length);
    expect(reopenedRecord.mesh.vertices).toHaveLength(expectedRecord.mesh.vertices.length);
    expect(reopenedRecord.mesh.halfEdges).toHaveLength(expectedRecord.mesh.halfEdges.length);
    expect(JSON.stringify(loaded.workspace.session.journal.records)).toContain(
      "geometry.extrude-region",
    );

    const coldSelection = createStudioHybridDccComponentSelection();
    expect(coldSelection).toMatchObject({
      mode: "object",
      objectIds: [],
      elementIds: [],
      provenance: null,
    });
  });

  it("round-trips document, command history, bridge, typed UVs, CAD evidence and aux state", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const before = buildFullWorkspace();
    const beforeJournal = serializeStudioCommandJournal(before.session.journal);
    const expectedAfterRedoHash = before.session.redoStack.at(-1)?.stateHash;
    const store = createStore(adapter);

    const receipt = await store.save(before);
    const restored = await store.load();

    expect(receipt.scopeKey).toBe(resolveStudioHybridDccWorkspacePersistenceScope(SCOPE).scopeKey);
    expect(receipt.documentStateHash).toBe(before.session.state.stateHash);
    expect(restored.status).toBe("restored");
    if (restored.status !== "restored") return;
    expect(restored.workspace.session.state.stateHash).toBe(before.session.state.stateHash);
    expect(restored.workspace.session.state.geometry.records["hero-prop"]!.revision).toBe(
      before.session.state.geometry.records["hero-prop"]!.revision,
    );
    expect(serializeStudioCommandJournal(restored.workspace.session.journal)).toBe(beforeJournal);
    expect(restored.workspace.session.undoStack).toEqual(before.session.undoStack);
    expect(restored.workspace.session.redoStack).toEqual(before.session.redoStack);
    expect(restored.workspace.session.undoGroupStack).toEqual(before.session.undoGroupStack);
    expect(restored.workspace.session.redoGroupStack).toEqual(before.session.redoGroupStack);
    expect(restored.workspace.bridge).toEqual(before.bridge);
    expect(restored.workspace.lastImportReport).toEqual(before.lastImportReport);
    expect(restored.workspace.lastUvMap?.uvs).toBeInstanceOf(Float32Array);
    expect(Array.from(restored.workspace.lastUvMap?.uvs ?? [])).toEqual(
      Array.from(before.lastUvMap?.uvs ?? []),
    );
    expect(restored.workspace.lastOcct).toEqual(before.lastOcct);
    expect(restored.workspace.lastRetarget).toEqual(before.lastRetarget);
    expect(restored.workspace.lastExport).toEqual(before.lastExport);
    expect(restored.workspace.lastSpring).toEqual(before.lastSpring);
    expect(restored.workspace.lastDynatopo).toEqual(before.lastDynatopo);
    expect(restored.workspace.lastRetopo).toEqual(before.lastRetopo);
    expect(restored.workspace.bom).toEqual(before.bom);
    expect(restored.workspace.collab).toEqual(before.collab);
    expect(restored.workspace.clothStep).toBe(before.clothStep);
    expect(restored.workspace.animSampleTime).toBe(before.animSampleTime);
    expect(workspaceRedo(restored.workspace).session.state.stateHash).toBe(
      expectedAfterRedoHash,
    );
  });

  it("isolates arbitrary Unicode user/work scopes into stable path-safe OPFS document IDs", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const firstScope = { userId: " 김 민지 ", workId: "작품 A/1" };
    const secondScope = { userId: "김 민지", workId: "작품 B/1" };
    const firstIdentity = resolveStudioHybridDccWorkspacePersistenceScope(firstScope);
    const repeatedIdentity = resolveStudioHybridDccWorkspacePersistenceScope({
      userId: "김 민지",
      workId: "작품 A/1",
    });
    const secondIdentity = resolveStudioHybridDccWorkspacePersistenceScope(secondScope);

    expect(firstIdentity).toEqual(repeatedIdentity);
    expect(firstIdentity.scopeKey).not.toBe(secondIdentity.scopeKey);
    expect(firstIdentity.storageDocumentId).toMatch(/^dccw-[0-9a-f]{48}$/u);

    await createStore(adapter, firstScope).save(buildFullWorkspace());
    expect((await createStore(adapter, secondScope).load()).status).toBe("empty");
    expect((await createStore(adapter, firstScope).load()).status).toBe("restored");
  });

  it("preserves visibility plus duplicate/delete authority and its undo snapshot", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    let before = createStudioHybridDccWorkspace("persist-scene-ops");
    before = workspaceAddUnitCube(before, "source");
    before = workspaceDuplicateActive(before, "source-copy");
    before = workspaceSetAssetVisibility(before, "source", false);
    before = workspaceDeleteActive(before);
    const deletedStateHash = before.session.state.stateHash;
    const restoreCopyStateHash = before.session.undoStack.at(-1)?.stateHash;
    const sourceBridgeObject = before.bridge.set.objects.find((object) => object.id === "source");
    expect(sourceBridgeObject?.visible).toBe(false);
    expect(before.session.state.geometry.records["source-copy"]).toBeUndefined();

    const store = createStore(adapter);
    await store.save(before);
    const loaded = await store.load();

    expect(loaded.status).toBe("restored");
    if (loaded.status !== "restored") return;
    expect(loaded.workspace.session.state.stateHash).toBe(deletedStateHash);
    expect(loaded.workspace.activeAssetId).toBeNull();
    expect(loaded.workspace.bridge.set.objects.find((object) => object.id === "source")?.visible)
      .toBe(false);
    expect(loaded.workspace.session.state.geometry.records["source-copy"]).toBeUndefined();
    expect(loaded.workspace.session.undoStack.at(-1)?.stateHash).toBe(restoreCopyStateHash);

    const undone = workspaceUndo(loaded.workspace);
    expect(undone.session.state.stateHash).toBe(restoreCopyStateHash);
    expect(undone.session.state.geometry.records["source-copy"]).toBeDefined();
    // Selection remains explicit and can be restored after the delete undo.
    expect(workspaceSelectAsset(undone, "source-copy").activeAssetId).toBe("source-copy");
  });

  it("keeps the previous committed workspace when a crash occurs before the next head commit", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const store = createStore(adapter);
    const first = buildFullWorkspace();
    await store.save(first);
    const second = workspaceCommitActiveObjectTransform(workspaceRedo(first), {
      revision: 1,
      position: [99, 1, 2],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });

    adapter.failNextHeadWrite = true;
    await expect(store.save(second)).rejects.toMatchObject(expectPersistenceError("STORAGE_FAILED"));

    const recovered = await store.load();
    expect(recovered.status).toBe("restored");
    if (recovered.status === "restored") {
      expect(recovered.workspace.session.state.stateHash).toBe(first.session.state.stateHash);
    }
  });

  it("serializes overlapping saves so the newest workspace remains recoverable", async () => {
    const adapter = new FifoWorkspaceOpfsAdapter();
    const store = createStore(adapter);
    const older = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("persist-concurrent-save"),
      "asset-old",
    );
    const newer = workspaceAddUnitCube(older, "asset-new");

    const [olderReceipt, newerReceipt] = await Promise.all([
      store.save(older),
      store.save(newer),
    ]);
    const loaded = await store.load();

    expect([olderReceipt.sequence, newerReceipt.sequence]).toEqual([1, 2]);
    expect(loaded.status).toBe("restored");
    if (loaded.status !== "restored") return;
    expect(loaded.workspace.session.state.stateHash).toBe(newer.session.state.stateHash);
    expect(Object.keys(loaded.workspace.session.state.geometry.records).sort()).toEqual([
      "asset-new",
      "asset-old",
    ]);
  });

  it("serializes overlapping save and clear mutations in invocation order", async () => {
    const adapter = new FifoWorkspaceOpfsAdapter();
    const store = createStore(adapter);
    const workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("persist-concurrent-clear"),
      "asset-before-clear",
    );

    const [saveReceipt, clearReceipt] = await Promise.all([
      store.save(workspace),
      store.clear(),
    ]);
    const loaded = await store.load();

    expect([saveReceipt.sequence, clearReceipt.sequence]).toEqual([1, 2]);
    expect(loaded.status).toBe("cleared");
  });

  it("fails closed on corrupted OPFS payload bytes instead of opening an empty workspace", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const store = createStore(adapter);
    await store.save(buildFullWorkspace());
    adapter.corruptLatestPayloadChunk();

    await expect(store.load()).rejects.toMatchObject(expectPersistenceError("CORRUPT_PAYLOAD"));
  });

  it("writes an atomic tombstone for clear and no longer exposes the prior workspace", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    const store = createStore(adapter);
    await store.save(buildFullWorkspace());

    const receipt = await store.clear();
    const loaded = await store.load();

    expect(receipt.documentStateHash).toBeNull();
    expect(receipt.physicalCleanupComplete).toBe(true);
    expect(loaded.status).toBe("cleared");
    if (loaded.status === "cleared") expect(loaded.clearedAt).toBe(receipt.savedAt);
  });

  it("rejects quota exhaustion without publishing a workspace", async () => {
    const adapter = new FakeWorkspaceOpfsAdapter();
    adapter.quota = 1;
    const store = createStore(adapter);

    await expect(store.save(buildFullWorkspace())).rejects.toMatchObject(
      expectPersistenceError("QUOTA_EXCEEDED"),
    );
    expect((await store.load()).status).toBe("empty");
  });

  it("rejects memory fallback and missing native OPFS durability", () => {
    const memory = createStudioOpfsMemoryFileSystem();
    expect(() => createStudioHybridDccWorkspacePersistenceFromFileSystem({
      fileSystem: memory,
      lockManager: {
        request: async (_name, _options, operation) => operation(),
      },
      scope: SCOPE,
    })).toThrow(expectPersistenceError("OPFS_UNAVAILABLE"));
    expect(() => createStudioHybridDccWorkspacePersistence({
      adapter: null,
      scope: SCOPE,
    })).toThrow(expectPersistenceError("OPFS_UNAVAILABLE"));
  });
});

describe("Hybrid DCC workspace persistence envelope", () => {
  it("verifies and atomically migrates real pre-slice v3 state, undo and bridge hashes", () => {
    const fixture = createPreSliceV3WorkspaceFixture();
    const persistedLegacy = JSON.parse(
      new TextDecoder().decode(fixture.bytes),
    ) as MutableWorkspaceEnvelopeFixture;
    const decoded = decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: fixture.bytes,
      scope: SCOPE,
    });
    const workspace = decoded.workspace;
    expect(workspace).not.toBeNull();
    if (!workspace) return;

    const exactRecord = workspace.session.state.geometry.records.cube!;
    const expectedRecord = fixture.currentWorkspace.session.state.geometry.records.cube!;
    expect(exactRecord.meshHash).toBe(hashStudioEditableMesh(exactRecord.mesh));
    expect(exactRecord.meshHash).toBe(expectedRecord.meshHash);
    expect(exactRecord.meshHash).toMatch(/^mesh:sha256:[0-9a-f]{64}$/u);
    expect(workspace.session.state.stateHash).toBe(fixture.currentWorkspace.session.state.stateHash);
    expect(decoded.documentStateHash).toBe(workspace.session.state.stateHash);
    expect(decoded.documentStateHash).not.toBe(PRE_SLICE_CURRENT_STATE_HASH);
    expect(decoded.sourceHash).not.toBe(persistedLegacy.sourceHash);
    expect(workspace.session.state.rightsBom[0]?.contentHash).toBe(
      fixture.currentWorkspace.session.state.rightsBom[0]?.contentHash,
    );

    const bridgeObject = workspace.bridge.set.objects.find(({ id }) => id === "cube");
    expect(bridgeObject?.geometryHash).toBe(exactRecord.meshHash);
    const persistedRoom = persistedLegacy.payload.bridge.set.objects.find(({ id }) => (
      id === "room-shell"
    ));
    const migratedRoom = workspace.bridge.set.objects.find(({ id }) => id === "room-shell");
    expect(persistedRoom).toEqual({
      id: "room-shell",
      geometryHash: "room:classroom:66",
      visible: true,
      materialId: "wall",
    });
    expect(migratedRoom).toEqual(persistedRoom);
    expect(workspace.bridge.set.setHash).toBe(createStudioSharedSet(
      workspace.bridge.set.id,
      workspace.bridge.set.objects,
    ).setHash);
    expect(workspace.bridge.set.setHash).not.toBe(PRE_SLICE_BRIDGE_SET_HASH);

    const migratedUndo = workspace.session.undoStack[1]!;
    expect(migratedUndo.stateHash).toBe(fixture.currentWorkspace.session.undoStack[1]?.stateHash);
    expect(migratedUndo.assets[0]?.meshHash).toBe(expectedRecord.meshHash);
    const migratedRedo = workspace.session.redoStack[0]!;
    expect(migratedRedo.stateHash).toBe(fixture.currentWorkspace.session.redoStack[0]?.stateHash);
    expect(migratedRedo.assets[0]?.meshHash).toBe(expectedRecord.meshHash);
    const redone = workspaceRedo(workspace);
    expect(redone.session.state.stateHash).toBe(migratedRedo.stateHash);
    expect(redone.session.state.geometry.records.cube?.meshHash).toBe(expectedRecord.meshHash);
    expect(redone.session.state.objectTransforms.cube?.position).toEqual([9, 8, 7]);
    const undone = workspaceUndo(workspace);
    expect(undone.session.state.stateHash).toBe(migratedUndo.stateHash);
    expect(undone.session.state.geometry.records.cube?.meshHash).toBe(expectedRecord.meshHash);

    const currentV3 = encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace: fixture.currentWorkspace,
      scope: SCOPE,
      savedAt: 7_003_901,
    });
    const reopenedCurrent = decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: currentV3.bytes,
      scope: SCOPE,
    });
    expect(reopenedCurrent.documentStateHash).toBe(
      fixture.currentWorkspace.session.state.stateHash,
    );
    expect(reopenedCurrent.sourceHash).toBe(currentV3.envelope.sourceHash);
  });

  it("resets a real legacy array/solidify preview and rematerializes it asynchronously", async () => {
    const fixture = await createPreSliceModifierPreviewFixture();
    const persisted = JSON.parse(
      new TextDecoder().decode(fixture.bytes),
    ) as MutableWorkspaceEnvelopeFixture;
    expect(persisted.payload.bridge.set.objects.find(({ id }) => id === "cube")?.geometryHash)
      .toBe(PRE_SLICE_ARRAY_SOLIDIFY_PREVIEW_HASH);

    const decoded = decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: fixture.bytes,
      scope: SCOPE,
    });
    const workspace = decoded.workspace;
    expect(workspace).not.toBeNull();
    if (!workspace) return;
    const record = workspace.session.state.geometry.records.cube!;
    const expectedRecord = fixture.currentWorkspace.session.state.geometry.records.cube!;
    expect(record.modifierStack.modifiers.map(({ kind }) => kind)).toEqual([
      "array",
      "solidify",
    ]);
    expect(record.renderCache).toBeNull();
    expect(workspace.bridge.set.objects.find(({ id }) => id === "cube")?.geometryHash)
      .toBe(record.meshHash);
    expect(record.meshHash).toBe(expectedRecord.meshHash);
    expect(decoded.documentStateHash).toBe(workspace.session.state.stateHash);

    const refreshed = await workspaceRefreshModifierPreviews(workspace);
    const refreshedRecord = refreshed.session.state.geometry.records.cube!;
    expect(refreshedRecord.renderCache?.derivedFromHash).toBe(
      expectedRecord.renderCache?.derivedFromHash,
    );
    expect(refreshedRecord.renderCache?.derivedFromHash)
      .toMatch(/^mesh:sha256:[0-9a-f]{64}$/u);
    expect(refreshedRecord.renderCache?.derivedFromHash).not.toBe(refreshedRecord.meshHash);
    expect(refreshed.bridge.set.objects.find(({ id }) => id === "cube")?.geometryHash)
      .toBe(refreshedRecord.renderCache?.derivedFromHash);
  });

  it("rejects forged pre-slice v3 state, undo and envelope hashes after outer checksum validation", () => {
    const fixture = createPreSliceV3WorkspaceFixture();
    const envelope = JSON.parse(
      new TextDecoder().decode(fixture.bytes),
    ) as MutableWorkspaceEnvelopeFixture;
    const forgedStateHash = `sha256:${"0".repeat(64)}`;
    const forgedCurrent: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      documentStateHash: forgedStateHash,
      payload: {
        ...envelope.payload,
        session: {
          ...envelope.payload.session,
          state: { ...envelope.payload.session.state, stateHash: forgedStateHash },
        },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(forgedCurrent),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const forgedUndo: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        session: {
          ...envelope.payload.session,
          undoStack: envelope.payload.session.undoStack.map((snapshot, index) => (
            index === 1 ? { ...snapshot, stateHash: forgedStateHash } : snapshot
          )),
        },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(forgedUndo),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const forgedRedo: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        session: {
          ...envelope.payload.session,
          redoStack: envelope.payload.session.redoStack.map((snapshot, index) => (
            index === 0 ? { ...snapshot, stateHash: forgedStateHash } : snapshot
          )),
        },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(forgedRedo),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const forgedEnvelope: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      documentStateHash: `sha256:${"1".repeat(64)}`,
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(forgedEnvelope),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const mismatchedBridgeSet = createStudioSharedSet(
      envelope.payload.bridge.set.id,
      envelope.payload.bridge.set.objects.map((object) => (
        object.id === "cube" ? { ...object, geometryHash: "mesh:deadbeef" } : object
      )),
    );
    const forgedBridge: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        bridge: { ...envelope.payload.bridge, set: mismatchedBridgeSet },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(forgedBridge),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const unknownRoomSet = createStudioSharedSet(
      envelope.payload.bridge.set.id,
      [
        ...envelope.payload.bridge.set.objects,
        {
          id: "mystery-room",
          geometryHash: "room:classroom:66",
          visible: true,
          materialId: "wall",
        },
      ],
    );
    const unknownRoom: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        bridge: { ...envelope.payload.bridge, set: unknownRoomSet },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(unknownRoom),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const mismatchedRoomSet = createStudioSharedSet(
      envelope.payload.bridge.set.id,
      envelope.payload.bridge.set.objects.map((object) => (
        object.id === "room-shell"
          ? { ...object, geometryHash: "room:classroom:65" }
          : object
      )),
    );
    const mismatchedRoom: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        bridge: { ...envelope.payload.bridge, set: mismatchedRoomSet },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(mismatchedRoom),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const unknownPresetSet = createStudioSharedSet(
      envelope.payload.bridge.set.id,
      envelope.payload.bridge.set.objects.map((object) => (
        object.id === "room-shell"
          ? { ...object, geometryHash: "room:not-a-preset:66" }
          : object
      )),
    );
    const unknownPreset: MutableWorkspaceEnvelopeFixture = {
      ...envelope,
      payload: {
        ...envelope.payload,
        bridge: { ...envelope.payload.bridge, set: unknownPresetSet },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(unknownPreset),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    let twoAssetWorkspace = createStudioHybridDccWorkspace("partial-v3-migration");
    twoAssetWorkspace = workspaceAddUnitCube(twoAssetWorkspace, "first");
    twoAssetWorkspace = workspaceAddUnitCube(twoAssetWorkspace, "second");
    const twoAssetEncoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace: twoAssetWorkspace,
      scope: SCOPE,
      savedAt: 7_003_902,
    });
    const partial = JSON.parse(
      new TextDecoder().decode(twoAssetEncoded.bytes),
    ) as MutableWorkspaceEnvelopeFixture;
    const firstAsset = partial.payload.session.state.assets.find(({ assetId }) => (
      assetId === "first"
    ));
    if (!firstAsset) throw new Error("partial migration fixture asset is missing");
    const partialMigration: MutableWorkspaceEnvelopeFixture = {
      ...partial,
      payload: {
        ...partial.payload,
        session: {
          ...partial.payload.session,
          state: {
            ...partial.payload.session.state,
            assets: partial.payload.session.state.assets.map((asset) => (
              asset.assetId === "first" ? { ...asset, meshHash: PRE_SLICE_CUBE_HASH } : asset
            )),
          },
        },
      },
    };
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: sealWorkspaceEnvelopeFixture(partialMigration),
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));
  });

  it("rejects legacy versions, scope mismatch, checksum tampering and oversized payloads", () => {
    const workspace = buildFullWorkspace();
    const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace,
      scope: SCOPE,
      savedAt: 42,
    });
    const parsed = JSON.parse(new TextDecoder().decode(encoded.bytes)) as Record<string, unknown>;

    const legacy = { ...parsed, version: 0 };
    const legacyBytes = new TextEncoder().encode(canonicalStudioCommandJson(legacy));
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: legacyBytes,
      scope: SCOPE,
    })).toThrow(expectPersistenceError("UNSUPPORTED_VERSION"));

    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: encoded.bytes,
      scope: { userId: SCOPE.userId, workId: "다른 작품" },
    })).toThrow(expectPersistenceError("SCOPE_MISMATCH"));

    const payload = structuredClone(parsed.payload) as {
      aux: { clothStep: number };
    };
    payload.aux.clothStep += 1;
    const tamperedBytes = new TextEncoder().encode(canonicalStudioCommandJson({
      ...parsed,
      payload,
    }));
    expect(() => decodeStudioHybridDccWorkspacePersistenceEnvelope({
      bytes: tamperedBytes,
      scope: SCOPE,
    })).toThrow(expectPersistenceError("INTEGRITY_FAILED"));

    const oversized = {
      ...workspace,
      lastImportReport: { text: "x".repeat(10_000) },
    };
    expect(() => encodeStudioHybridDccWorkspacePersistenceEnvelope({
      workspace: oversized,
      scope: SCOPE,
      savedAt: 42,
      maxPayloadBytes: 4 * 1024,
    })).toThrow(expectPersistenceError("PAYLOAD_TOO_LARGE"));
  });
});
