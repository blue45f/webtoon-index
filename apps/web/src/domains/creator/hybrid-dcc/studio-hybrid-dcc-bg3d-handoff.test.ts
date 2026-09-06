import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  applyStudioShotOverride,
  mutateStudioSharedObjectGeometry,
} from "../live/studio-live-2d3d-bridge";

import {
  handoffStudioHybridDccWorkspaceToBg3d,
  StudioHybridDccBg3dHandoffError,
  type StudioHybridDccBg3dHandoffPorts,
  type StudioHybridDccBg3dPersistRequest,
} from "./studio-hybrid-dcc-bg3d-handoff";
import { hybridDccCommitGeometry } from "./studio-hybrid-dcc-document";
import { workspaceAddActiveModifier } from "./studio-hybrid-dcc-modifier-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceAddArtistInk,
  workspaceAddUnitCube,
  workspaceCommitObjectTransform,
  workspaceEnsureShots,
  workspaceLoadRoomPreset,
} from "./studio-hybrid-dcc-workspace";

function testPorts(
  transform?: (request: StudioHybridDccBg3dPersistRequest) => StudioHybridDccBg3dPersistRequest,
): StudioHybridDccBg3dHandoffPorts & {
  readonly persistAttachments: ReturnType<typeof vi.fn>;
} {
  const persistAttachments = vi.fn(
    async (requests: readonly StudioHybridDccBg3dPersistRequest[]) => requests.map((source) => {
      const request = transform?.(source) ?? source;
      return {
        assetId: request.assetId,
        attachment: {
          id: request.attachmentId,
          name: request.fileName,
          mime: "model/gltf-binary" as const,
          byteSize: request.bytes.byteLength,
          hash: request.expectedSha256,
          rights: request.rights,
          source: "local-library" as const,
          generic3dWorkflow: {
            version: 1 as const,
            classification: "prop" as const,
            sourceFormat: "glb" as const,
          },
        },
      };
    }),
  );
  return {
    glbExportExecutionBackend: "direct",
    persistAttachments,
  };
}

describe("Hybrid DCC → shipping BG3D handoff", () => {
  it("fails closed before persistence when the authoritative workspace is empty", async () => {
    const ports = testPorts();

    await expect(handoffStudioHybridDccWorkspaceToBg3d(
      createStudioHybridDccWorkspace("empty"),
      { ports },
    )).rejects.toMatchObject({
      code: "empty-workspace",
    } satisfies Partial<StudioHybridDccBg3dHandoffError>);
    expect(ports.persistAttachments).not.toHaveBeenCalled();
  });

  it("exports authoring meshes, persists one atomic batch, and opens a canonical multi-shot scene", async () => {
    let workspace = createStudioHybridDccWorkspace("product-handoff");
    workspace = workspaceAddUnitCube(workspace, "hero-prop");
    workspace = workspaceAddUnitCube(workspace, "room-prop");
    workspace = workspaceCommitObjectTransform(workspace, "room-prop", {
      revision: 1,
      position: [2, 0.5, -1],
      rotationEulerRad: [0, Math.PI / 4, 0],
      scale: [1.5, 0.75, 1],
    });
    workspace = workspaceEnsureShots(workspace, 8);
    const ports = testPorts();

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports });

    expect(ports.persistAttachments).toHaveBeenCalledTimes(1);
    const requests = ports.persistAttachments.mock.calls[0]?.[0] as readonly StudioHybridDccBg3dPersistRequest[];
    expect(requests).toHaveLength(2);
    expect(requests.map(({ assetId }) => assetId)).toEqual(["hero-prop", "room-prop"]);
    for (const request of requests) {
      expect(new TextDecoder().decode(request.bytes.slice(0, 4))).toBe("glTF");
      expect(request.expectedSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
    expect(result.scene.attachments).toHaveLength(2);
    expect(result.scene.nodes).toHaveLength(2);
    expect(new Set(result.scene.nodes.map(({ transform }) =>
      JSON.stringify(transform.position))).size).toBe(2);
    const roomTransform = result.scene.nodes.find(({ name }) => name === "room-prop")?.transform;
    expect(roomTransform).toMatchObject({
      position: [2, 0.5, -1],
      scale: [0.75, 0.375, 0.5],
    });
    expect(roomTransform?.rotation[1]).toBeCloseTo(Math.PI / 4, 12);
    expect(result.scene.shots).toHaveLength(8);
    expect(result.scene.activeShotId).toBeUndefined();
    expect(result.scene.render).toMatchObject({ toneMapping: "aces", exposure: 1.05 });
    expect(result.assets.map(({ sourceAssetId }) => sourceAssetId)).toEqual([
      "hero-prop",
      "room-prop",
    ]);
    expect(result.proceduralObjects).toEqual([]);
    expect(result.sourceBridgeSetHash).toBe(workspace.bridge.set.setHash);
    expect(result.sourceBridgeCommandSequence).toBe(workspace.bridge.commandSequence);
    expect(result.sourceWorkspaceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.deliveryEvidence).toEqual({
      canonicalSceneVerified: true,
      modelPersistence: {
        status: "receipt-verified",
        persistedAttachmentCount: 2,
      },
      canvasDocumentIntegrated: false,
      collaborationVerified: false,
      browserVerified: false,
      productionActivated: false,
    });
    expect(JSON.stringify(result.scene)).not.toMatch(/BufferGeometry|Object3D|WebGL|Babylon/iu);
  });

  it("exports the validated non-destructive result visible in the viewport, not its source cage", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-handoff"),
      "array-prop",
    );
    workspace = await workspaceAddActiveModifier(workspace, "array");
    const record = workspace.session.state.geometry.records["array-prop"]!;
    const cache = record.renderCache!;
    const ports = testPorts();

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports });

    expect(cache.indices.length / 3).toBeGreaterThan(12);
    expect(result.assets[0]).toMatchObject({
      sourceAssetId: "array-prop",
      sourceAuthorityMeshHash: record.meshHash,
      sourceMeshHash: cache.derivedFromHash,
      sourceGeometryKind: "evaluated-modifier-stack",
      triangles: cache.indices.length / 3,
    });
    expect(ports.persistAttachments).toHaveBeenCalledTimes(1);
  });

  it("fails closed before persistence when modifier preview provenance is not the visible bridge", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-handoff-gate"),
      "array-prop",
    );
    workspace = await workspaceAddActiveModifier(workspace, "array");
    const record = workspace.session.state.geometry.records["array-prop"]!;
    workspace = {
      ...workspace,
      bridge: mutateStudioSharedObjectGeometry(
        workspace.bridge,
        record.assetId,
        record.meshHash,
      ),
    };
    const ports = testPorts();

    await expect(handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports }))
      .rejects.toMatchObject({
        code: "modifier-preview-invalid",
      } satisfies Partial<StudioHybridDccBg3dHandoffError>);
    expect(ports.persistAttachments).not.toHaveBeenCalled();
  });

  it("preflights invalid Shot cameras before the atomic persistence transaction", async () => {
    let workspace = createStudioHybridDccWorkspace("shot-preflight");
    workspace = workspaceAddUnitCube(workspace, "hero");
    workspace = workspaceEnsureShots(workspace, 1);
    const sourceShot = workspace.bridge.shots[0]!;
    workspace = {
      ...workspace,
      bridge: {
        ...workspace.bridge,
        shots: [{
          ...sourceShot,
          overrides: {
            ...sourceShot.overrides,
            camera: {
              position: [Number.NaN, 2, 5],
              target: [0, 1, 0],
              fov: 40,
            },
          },
        }],
      },
    };
    const ports = testPorts();

    await expect(handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports }))
      .rejects.toMatchObject({
        code: "scene-canonicalization-failed",
      } satisfies Partial<StudioHybridDccBg3dHandoffError>);
    expect(ports.persistAttachments).not.toHaveBeenCalled();
  });

  it("rejects an over-budget Shot set instead of silently truncating delivery", async () => {
    let workspace = createStudioHybridDccWorkspace("shot-budget");
    workspace = workspaceAddUnitCube(workspace, "hero");
    workspace = workspaceEnsureShots(workspace, 1);
    const sourceShot = workspace.bridge.shots[0]!;
    workspace = {
      ...workspace,
      bridge: {
        ...workspace.bridge,
        shots: Array.from({ length: 65 }, (_, index) => ({
          ...sourceShot,
          id: `shot-${index + 1}`,
          name: `Shot ${index + 1}`,
        })),
      },
    };
    const ports = testPorts();

    await expect(handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports }))
      .rejects.toMatchObject({ code: "asset-budget-exceeded" });
    expect(ports.persistAttachments).not.toHaveBeenCalled();
  });

  it("frames a large authority mesh instead of opening with the camera inside it", async () => {
    let workspace = createStudioHybridDccWorkspace("large-camera-frame");
    workspace = workspaceAddUnitCube(workspace, "large-set");
    const record = workspace.session.state.geometry.records["large-set"]!;
    workspace = {
      ...workspace,
      session: hybridDccCommitGeometry(workspace.session, record.assetId, {
        ...record.mesh,
        vertices: record.mesh.vertices.map((vertex) => ({
          ...vertex,
          position: {
            x: vertex.position.x * 100,
            y: vertex.position.y * 100,
            z: vertex.position.z * 100,
          },
        })),
      }),
    };
    workspace = workspaceCommitObjectTransform(workspace, "large-set", {
      revision: 1,
      position: [0, 50, 0],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });
    const { position, target } = result.scene.camera;
    const cameraDistance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );

    expect(target).toEqual([0, 50, 0]);
    expect(cameraDistance).toBeGreaterThan(150);
    expect(result.scene.nodes[0]?.transform.position).toEqual([0, 50, 0]);
    // The BG3D loader normalizes the 100-unit source mesh to two units. The persisted inverse
    // instance scale restores the DCC-authored 100-unit size before the fitted camera renders it.
    expect(result.scene.nodes[0]?.transform.scale).toEqual([50, 50, 50]);
  });

  it("keeps the loader-normalized handoff mesh inside the fitted production viewport", async () => {
    let workspace = createStudioHybridDccWorkspace("loader-normalized-camera-frame");
    workspace = workspaceAddUnitCube(workspace, "hero");
    workspace = workspaceCommitObjectTransform(workspace, "hero", {
      revision: 1,
      position: [2.25, 0, 0],
      rotationEulerRad: [0, Math.PI / 6, 0],
      scale: [1, 1, 1.5],
    });
    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });
    const node = result.scene.nodes[0];
    if (!node || node.kind !== "model") throw new Error("Expected one model node");

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const loaderNormalizedRoot = new THREE.Mesh(geometry, material);
    loaderNormalizedRoot.scale.setScalar(2);
    const instance = new THREE.Group();
    instance.position.set(...node.transform.position);
    instance.rotation.set(...node.transform.rotation);
    instance.scale.set(...node.transform.scale);
    instance.add(loaderNormalizedRoot);
    instance.updateWorldMatrix(true, true);

    const bounds = new THREE.Box3().setFromObject(instance);
    const camera = new THREE.PerspectiveCamera(
      result.scene.camera.fovDegrees,
      16 / 9,
      result.scene.camera.nearClip,
      10_000,
    );
    camera.position.set(...result.scene.camera.position);
    const cameraUp = result.scene.camera.up ?? [0, 1, 0] as const;
    camera.up.set(cameraUp[0], cameraUp[1], cameraUp[2]);
    camera.lookAt(new THREE.Vector3(...result.scene.camera.target));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const projected = [] as THREE.Vector3[];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.push(new THREE.Vector3(x, y, z).project(camera));
        }
      }
    }
    expect(Math.max(...projected.map(({ x }) => Math.abs(x)))).toBeLessThan(1);
    expect(Math.max(...projected.map(({ y }) => Math.abs(y)))).toBeLessThan(1);
    expect(projected.every(({ z }) => z > -1 && z < 1)).toBe(true);

    geometry.dispose();
    material.dispose();
  });

  it("materializes a room-only bridge as editable BG3D primitives without fake GLB persistence", async () => {
    let workspace = createStudioHybridDccWorkspace("room-only");
    workspace = workspaceLoadRoomPreset(workspace, "classroom");
    workspace = {
      ...workspace,
      bridge: applyStudioShotOverride(workspace.bridge, "shot-1", {
        visibility: { "room-shell": false },
      }),
    };
    const ports = testPorts();

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports });

    expect(ports.persistAttachments).not.toHaveBeenCalled();
    expect(result.assets).toEqual([]);
    expect(result.scene.attachments).toEqual([]);
    expect(result.proceduralObjects).toHaveLength(1);
    expect(result.proceduralObjects[0]).toMatchObject({
      sourceObjectId: "room-shell",
    });
    expect(result.scene.nodes.length).toBeGreaterThan(5);
    expect(result.scene.nodes.every((node) => node.kind === "primitive")).toBe(true);
    expect(result.scene.shots?.[0]?.nodeVisibility).toHaveLength(result.scene.nodes.length);
    expect(result.scene.shots?.[0]?.nodeVisibility?.every(({ visible }) => !visible)).toBe(true);
    expect(result.losses.map(({ code }) => code)).not.toContain("bridge-object-retained-in-dcc");
    expect(result.deliveryEvidence.modelPersistence).toEqual({
      status: "not-required",
      persistedAttachmentCount: 0,
    });
    expect(result.deliveryEvidence.canvasDocumentIntegrated).toBe(false);
  });

  it.each(["cyclic", "bigint"] as const)(
    "rejects %s provenance before atomic model persistence",
    async (invalidKind) => {
      let workspace = createStudioHybridDccWorkspace(`invalid-${invalidKind}-provenance`);
      workspace = workspaceAddUnitCube(workspace, "hero");
      const bridgeWithInvalidProvenance: typeof workspace.bridge & {
        invalidProvenance?: unknown;
      } = { ...workspace.bridge };
      bridgeWithInvalidProvenance.invalidProvenance = invalidKind === "cyclic"
        ? bridgeWithInvalidProvenance
        : BigInt(1);
      workspace = { ...workspace, bridge: bridgeWithInvalidProvenance };
      const ports = testPorts();

      await expect(handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports }))
        .rejects.toMatchObject({
          code: "scene-canonicalization-failed",
        } satisfies Partial<StudioHybridDccBg3dHandoffError>);
      expect(ports.persistAttachments).not.toHaveBeenCalled();
    },
  );

  it("does not materialize a room bridge whose declared part count is forged", async () => {
    let workspace = createStudioHybridDccWorkspace("room-count-integrity");
    workspace = workspaceAddUnitCube(workspace, "hero");
    workspace = workspaceLoadRoomPreset(workspace, "classroom");
    workspace = {
      ...workspace,
      bridge: {
        ...workspace.bridge,
        set: {
          ...workspace.bridge.set,
          objects: workspace.bridge.set.objects.map((object) => (
            object.id === "room-shell"
              ? { ...object, geometryHash: "room:classroom:999" }
              : object
          )),
        },
      },
    };

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });

    expect(result.proceduralObjects).toEqual([]);
    expect(result.losses).toContainEqual(expect.objectContaining({
      code: "bridge-object-retained-in-dcc",
      assetId: "room-shell",
    }));
  });

  it("hashes the complete bridge delivery state, not geometry state alone", async () => {
    let before = createStudioHybridDccWorkspace("bridge-provenance");
    before = workspaceAddUnitCube(before, "actor");
    const beforeResult = await handoffStudioHybridDccWorkspaceToBg3d(before, {
      ports: testPorts(),
    });
    let after = workspaceEnsureShots(before, 3);
    after = workspaceAddArtistInk(after, "shot-1");
    const afterResult = await handoffStudioHybridDccWorkspaceToBg3d(after, {
      ports: testPorts(),
    });

    expect(after.session.state.stateHash).toBe(before.session.state.stateHash);
    expect(afterResult.sourceStateHash).toBe(beforeResult.sourceStateHash);
    expect(afterResult.sourceWorkspaceHash).not.toBe(beforeResult.sourceWorkspaceHash);
    expect(afterResult.sourceBridgeCommandSequence)
      .toBeGreaterThan(beforeResult.sourceBridgeCommandSequence);
  });

  it("preserves Shot overrides and linked artist ink while adding assets, rooms, and shots", () => {
    let workspace = createStudioHybridDccWorkspace("bridge-preservation");
    workspace = workspaceAddUnitCube(workspace, "actor");
    workspace = workspaceEnsureShots(workspace, 2);
    workspace = {
      ...workspace,
      bridge: applyStudioShotOverride(workspace.bridge, "shot-1", {
        material: { actor: "night" },
      }),
    };
    workspace = workspaceAddArtistInk(workspace, "shot-1");
    const retainedDeltaId = workspace.bridge.artistCorrections.deltas[0]?.id;

    workspace = workspaceAddUnitCube(workspace, "prop");
    workspace = workspaceLoadRoomPreset(workspace, "classroom");
    workspace = workspaceEnsureShots(workspace, 3);

    expect(workspace.bridge.shots.find(({ id }) => id === "shot-1")?.overrides.material)
      .toEqual({ actor: "night" });
    expect(workspace.bridge.artistCorrections.deltas.map(({ id }) => id))
      .toContain(retainedDeltaId);
  });

  it("transfers camera/visibility while explicitly retaining unsupported Shot and linked-ink data", async () => {
    let workspace = createStudioHybridDccWorkspace("loss-report");
    workspace = workspaceAddUnitCube(workspace, "actor");
    workspace = workspaceEnsureShots(workspace, 2);
    workspace = {
      ...workspace,
      bridge: applyStudioShotOverride(workspace.bridge, "shot-1", {
        camera: { position: [3, 2, 5], target: [0, 1, 0], fov: 35 },
        visibility: { actor: false },
        transform: { actor: { position: [1, 0, 0] } },
        material: { actor: "night" },
        characterPose: { actor: "pose-wave" },
      }),
    };
    workspace = workspaceAddArtistInk(workspace, "shot-1");

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });
    const firstShot = result.scene.shots?.[0];

    expect(firstShot?.camera).toMatchObject({
      position: [3, 2, 5],
      target: [0, 1, 0],
      fovDegrees: 35,
    });
    expect(firstShot?.nodeVisibility?.[0]?.visible).toBe(false);
    expect(result.losses.map(({ code }) => code)).toEqual([
      "shot-transform-retained-in-dcc",
      "shot-material-retained-in-dcc",
      "shot-character-pose-retained-in-dcc",
      "artist-ink-retained-in-dcc",
    ]);
    expect(result.retainedArtistCorrectionCount).toBe(1);
  });

  it("carries GLB derivative losses into the product handoff report", async () => {
    let workspace = createStudioHybridDccWorkspace("material-loss");
    workspace = workspaceAddUnitCube(workspace, "material-prop");
    const record = workspace.session.state.geometry.records["material-prop"]!;
    const mesh = {
      ...record.mesh,
      faces: record.mesh.faces.map((face) =>
        face.id === 0 ? { ...face, materialSlot: 2 } : face),
    };
    workspace = {
      ...workspace,
      session: hybridDccCommitGeometry(workspace.session, record.assetId, mesh),
    };

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });

    expect(result.assets[0]).toMatchObject({ exportIssueCount: 1 });
    expect(result.losses).toContainEqual(expect.objectContaining({
      code: "glb-export-loss-retained-in-dcc",
      assetId: "material-prop",
      sourceIssueCode: "material-slot-metadata-only",
      resolution: "retained-in-authority",
    }));
  });

  it("never promotes an externally authored original asset to owned rights", async () => {
    let workspace = createStudioHybridDccWorkspace("external-rights");
    workspace = workspaceAddUnitCube(workspace, "licensed-prop");
    workspace = {
      ...workspace,
      session: {
        ...workspace.session,
        state: {
          ...workspace.session.state,
          rightsBom: workspace.session.state.rightsBom.map((entry) => ({
            ...entry,
            creator: "External Artist",
            license: "CC-BY-4.0",
            useScope: "commercial",
            derivative: "original",
          })),
        },
      },
    };

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });

    expect(result.scene.attachments[0]?.rights).toEqual({
      status: "licensed",
      commercialUse: true,
      attributionRequired: true,
      attribution: "External Artist",
      licenseName: "CC-BY-4.0",
    });
  });

  it("fails closed for non-commercial and unknown licenses", async () => {
    let workspace = createStudioHybridDccWorkspace("restricted-rights");
    workspace = workspaceAddUnitCube(workspace, "nc-prop");
    workspace = workspaceAddUnitCube(workspace, "unknown-prop");
    workspace = {
      ...workspace,
      session: {
        ...workspace.session,
        state: {
          ...workspace.session.state,
          rightsBom: workspace.session.state.rightsBom.map((entry) => ({
            ...entry,
            creator: "External Artist",
            license: entry.assetId === "nc-prop" ? "CC-BY-NC-4.0" : "unknown",
            useScope: "commercial",
            derivative: "imported",
          })),
        },
      },
    };

    const result = await handoffStudioHybridDccWorkspaceToBg3d(workspace, {
      ports: testPorts(),
    });
    const rightsByAssetId = new Map(result.assets.map((asset) => [
      asset.sourceAssetId,
      result.scene.attachments.find(({ id }) => id === asset.attachmentId)?.rights,
    ] as const));

    expect(rightsByAssetId.get("nc-prop")).toMatchObject({
      status: "licensed",
      commercialUse: false,
      attributionRequired: true,
    });
    expect(rightsByAssetId.get("unknown-prop")).toMatchObject({
      status: "unknown",
      commercialUse: false,
      attributionRequired: false,
    });
  });

  it("rejects a persistence adapter that swaps the verified content hash", async () => {
    let workspace = createStudioHybridDccWorkspace("hash-swap");
    workspace = workspaceAddUnitCube(workspace, "prop");
    const ports: StudioHybridDccBg3dHandoffPorts = {
      glbExportExecutionBackend: "direct",
      persistAttachments: async (requests) => requests.map((request) => ({
        assetId: request.assetId,
        attachment: {
          id: request.attachmentId,
          name: request.fileName,
          mime: "model/gltf-binary",
          byteSize: request.bytes.byteLength,
          hash: `sha256:${"0".repeat(64)}`,
          rights: request.rights,
          source: "local-library",
        },
      })),
    };

    await expect(handoffStudioHybridDccWorkspaceToBg3d(workspace, { ports }))
      .rejects.toMatchObject({
        code: "attachment-mismatch",
      } satisfies Partial<StudioHybridDccBg3dHandoffError>);
  });
});
