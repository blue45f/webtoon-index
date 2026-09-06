/**
 * Product surface + expanded adapters gating (UI wire, OFF/3MF/BVH/IFC, collab, UV/CAD/sculpt/cloth).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";


import {
  exportStudioMeshObj,
  exportStudioMeshStlAscii,
} from "../export/studio-mesh-export-adapters";
import { STUDIO_CLOTH_XPBD_V2_BUDGETS } from "../studio-cloth-xpbd-kernel-v2";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import {
  importStudioFbxDocument,
  isStudioFbxBinary,
} from "../studio-fbx-ascii-import";
import {
  buildStudioGeoNodesPrimitive,
  evaluateStudioGeoNodesStarterGraph,
} from "../studio-geometry-nodes-workspace-bridge";
import {
  bomEstimateMassKg,
  bomRollupByMaterial,
} from "../studio-manufacturing-bom-lite";
import {
  importStudio3mfMinimal,
  importStudioBvhMotion,
  importStudioIfcShell,
  importStudioMeshByExtension,
  importStudioOff,
  importStudioStepShell,
} from "../studio-mesh-format-adapters";

import {
  STUDIO_DCC_KERNEL_COVERAGE_REGISTRY,
  STUDIO_DCC_KERNEL_COVERAGE_REVISION,
  assertWebtoonObjectCreatorV1KernelCoverage,
} from "./studio-dcc-catalog-registry";
import {
  collabActivePeerIds,
  collabAppendOp,
  collabJoin,
  createStudioDccCollabRoom,
  STUDIO_DCC_COLLAB_SHELL_REVISION,
} from "./studio-dcc-collab-shell";
import { hybridDccCommitGeometry } from "./studio-hybrid-dcc-document";
import { transformStudioHybridDccPoint } from "./studio-hybrid-dcc-object-transform";
import {
  createStudioHybridDccWorkspace,
  runStudioHybridDccFullEngineSuite,
  STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES,
  type StudioHybridDccWorkspace,
  workspaceAddGeoNodesPrimitive,
  workspaceAddGeoNodesStarter,
  workspaceAddUnitCube,
  workspaceArrayActive,
  workspaceCadProp,
  workspaceCadRevolve,
  workspaceClothStep,
  workspaceCollabJoin,
  workspaceCommitObjectTransform,
  workspaceDecimateActive,
  workspaceDeleteActive,
  workspaceExportActiveMesh,
  workspaceExportToon3d,
  workspaceMirrorActive,
  workspaceRebuildBom,
  workspaceRetargetFromBvhExtras,
  workspaceSculptActive,
  workspaceSelectAsset,
  workspaceSubdivideActive,
  workspaceUvUnwrapActive,
  workspaceVoxelRemeshActive,
} from "./studio-hybrid-dcc-workspace";

const root = resolve(import.meta.dirname, "../..");

function clothCache(workspace: StudioHybridDccWorkspace, assetId: string) {
  return workspace.clothRuntimeCache?.entries.get(assetId);
}

function workspaceWithForgedActiveMesh(
  workspace: StudioHybridDccWorkspace,
  mesh: StudioEditableMesh,
): StudioHybridDccWorkspace {
  const assetId = workspace.activeAssetId!;
  const record = workspace.session.state.geometry.records[assetId]!;
  return {
    ...workspace,
    session: {
      ...workspace.session,
      state: {
        ...workspace.session.state,
        geometry: {
          ...workspace.session.state.geometry,
          records: {
            ...workspace.session.state.geometry.records,
            [assetId]: { ...record, mesh },
          },
        },
      },
    },
  };
}

interface HybridDccAuthTransitionWorkspace {
  readonly id: string;
}

interface HybridDccScopedWorkspace<TWorkspace> {
  readonly scope: string;
  readonly workspace: TWorkspace;
}

function createHybridDccAuthTransitionHarness<TWorkspace>(
  initialScope: string,
  initialDurableWorkspace: TWorkspace,
) {
  let currentScope = initialScope;
  let fallbackScope: string | null = null;
  let latestWorkspace: HybridDccScopedWorkspace<TWorkspace> | null = null;
  let workspaceState: HybridDccScopedWorkspace<TWorkspace> | null = null;
  let scopeTransfer: {
    readonly fromScope: string;
    readonly toScope: string;
    readonly workspace: TWorkspace;
  } | null = null;
  let durableWorkspace = initialDurableWorkspace;
  let durableSaveCount = 0;

  return {
    enterImmediateSessionOnly() {
      // Mirrors StudioPage: session-only UI and transfer eligibility become authoritative together.
      fallbackScope = currentScope;
    },
    edit(workspace: TWorkspace) {
      workspaceState = { scope: currentScope, workspace };
      latestWorkspace = { scope: currentScope, workspace };
    },
    async authenticate(nextScope: string): Promise<TWorkspace | undefined> {
      const previousScope = currentScope;
      if (previousScope !== nextScope && fallbackScope === previousScope) {
        const pendingWorkspace = latestWorkspace?.scope === previousScope
          ? latestWorkspace.workspace
          : workspaceState?.scope === previousScope
            ? workspaceState.workspace
            : null;
        if (pendingWorkspace) {
          scopeTransfer = {
            fromScope: previousScope,
            toScope: nextScope,
            workspace: pendingWorkspace,
          };
          latestWorkspace = { scope: nextScope, workspace: pendingWorkspace };
        }
      }
      currentScope = nextScope;
      const initialWorkspace = workspaceState?.scope === nextScope
        ? workspaceState.workspace
        : scopeTransfer?.toScope === nextScope
          ? scopeTransfer.workspace
          : undefined;

      // Mirrors recovery admission: transfer only after durable load, then checkpoint once.
      await Promise.resolve();
      if (scopeTransfer?.toScope === nextScope) {
        const pendingWorkspace = latestWorkspace?.scope === nextScope
          ? latestWorkspace.workspace
          : scopeTransfer.workspace;
        workspaceState = { scope: nextScope, workspace: pendingWorkspace };
        durableWorkspace = pendingWorkspace;
        durableSaveCount += 1;
        fallbackScope = null;
        scopeTransfer = null;
      } else {
        workspaceState = { scope: nextScope, workspace: durableWorkspace };
      }
      return initialWorkspace;
    },
    snapshot() {
      return {
        activeWorkspace: workspaceState?.scope === currentScope
          ? workspaceState.workspace
          : undefined,
        durableWorkspace,
        durableSaveCount,
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("product UI wiring", () => {
  it("StudioPage lazy-mounts Hybrid DCC dialog and menubar exposes open control", () => {
    const page = readStudioCuttoonEditorSource();
    const menubar = readFileSync(
      resolve(import.meta.dirname, "../StudioMenubarContent.tsx"),
      "utf8",
    );
    const handoff = readFileSync(
      resolve(import.meta.dirname, "./studio-hybrid-dcc-bg3d-handoff.ts"),
      "utf8",
    );
    expect(page).toContain("LazyStudioHybridDccDialog");
    expect(page).toContain("setHybridDccOpen");
    expect(page).toContain("hybridDccOpen");
    expect(page).toContain("onOpenInBackground3D");
    expect(page).toContain("setBg3dInitialScene(result.scene)");
    expect(page).toContain("key={hybridDccWorkspaceScope}");
    expect(page).toContain("resolveStudioHybridDccPersistenceAuthGate(studioAuthReady)");
    expect(page).toContain(
      "current?.scope === hybridDccWorkspaceScope && current?.workspace === workspace",
    );
    expect(page).toContain("hybridDccAuthFallbackScopeRef.current = hybridDccWorkspaceScope");
    expect(page).toContain('status: "session-only"');
    expect(page).toContain(
      "hybridDccAuthFallbackScopeRef.current === previousHybridDccWorkspaceScope",
    );
    expect(page).toContain("await persistence.save(pendingWorkspace)");
    expect(page).toContain(
      "hybridDccScopeTransferRef.current?.toScope === hybridDccWorkspaceScope",
    );
    expect(menubar).toContain("setHybridDccOpen");
    expect(handoff).toContain("exportStudioHybridDccGlbBatch");
    expect(handoff).toContain('glbExportExecutionBackend: "worker"');
    expect(handoff).toContain("executionBackend: ports.glbExportExecutionBackend");
    expect(handoff).not.toContain("exportStudioHybridDccAuthorityRecordGlb");
    expect(menubar).toContain('data-studio-hybrid-dcc-open="true"');
    expect(existsSync(resolve(import.meta.dirname, "./StudioHybridDccDialog.tsx"))).toBe(true);
    expect(existsSync(resolve(import.meta.dirname, "./StudioHybridDccPanel.tsx"))).toBe(true);
    expect(
      existsSync(resolve(import.meta.dirname, "./studio-hybrid-dcc-bg3d-handoff.ts")),
    ).toBe(true);
    const fallbackStart = page.indexOf("if (!authGate.shouldAttemptRecovery) {");
    const fallbackEnd = page.indexOf("const persistenceSaveQueue", fallbackStart);
    const fallbackBranch = page.slice(fallbackStart, fallbackEnd);
    expect(fallbackStart).toBeGreaterThanOrEqual(0);
    expect(fallbackEnd).toBeGreaterThan(fallbackStart);
    expect(fallbackBranch).toContain(
      "hybridDccAuthFallbackScopeRef.current = hybridDccWorkspaceScope;",
    );
    expect(fallbackBranch).not.toContain("authScopeTimeoutId");
    expect(fallbackBranch).not.toContain("STUDIO_HYBRID_DCC_AUTH_SCOPE_TIMEOUT_MS");
    expect(page).toContain("if (pendingWorkspace) {");
    void root;
  });

  it.each([
    {
      label: "auth-pending draft to an authenticated draft",
      previousScope: "auth-pending\u0000draft:auth-pending",
      nextScope: "artist-1\u0000draft:toon-1",
    },
    {
      label: "guest work to its authenticated owner",
      previousScope: "guest\u0000work:work-1",
      nextScope: "artist-1\u0000work:work-1",
    },
  ])("transfers a pre-auth edit before the old 12-second boundary: $label", async ({
    previousScope,
    nextScope,
  }) => {
    vi.useFakeTimers();
    const durableW0: HybridDccAuthTransitionWorkspace = { id: "durable-W0" };
    const authoredW1: HybridDccAuthTransitionWorkspace = { id: "session-W1" };
    const harness = createHybridDccAuthTransitionHarness(previousScope, durableW0);
    harness.enterImmediateSessionOnly();
    harness.edit(authoredW1);

    let transition: Promise<HybridDccAuthTransitionWorkspace | undefined> | undefined;
    globalThis.setTimeout(() => {
      transition = harness.authenticate(nextScope);
    }, 6_000);
    await vi.advanceTimersByTimeAsync(6_000);
    if (!transition) throw new Error("The auth transition did not run.");

    await expect(transition).resolves.toBe(authoredW1);
    expect(harness.snapshot()).toEqual({
      activeWorkspace: authoredW1,
      durableWorkspace: authoredW1,
      durableSaveCount: 1,
    });
  });

  it("admits the durable workspace without overwriting it when auth changes before any edit", async () => {
    vi.useFakeTimers();
    const durableW0: HybridDccAuthTransitionWorkspace = { id: "durable-W0" };
    const harness = createHybridDccAuthTransitionHarness(
      "auth-pending\u0000draft:auth-pending",
      durableW0,
    );
    harness.enterImmediateSessionOnly();

    let transition: Promise<HybridDccAuthTransitionWorkspace | undefined> | undefined;
    globalThis.setTimeout(() => {
      transition = harness.authenticate("artist-1\u0000draft:toon-1");
    }, 6_000);
    await vi.advanceTimersByTimeAsync(6_000);
    if (!transition) throw new Error("The auth transition did not run.");

    await expect(transition).resolves.toBeUndefined();
    expect(harness.snapshot()).toEqual({
      activeWorkspace: durableW0,
      durableWorkspace: durableW0,
      durableSaveCount: 0,
    });
  });
});

describe("expanded format adapters OFF/3MF/BVH/IFC", () => {
  it("parses OFF / 3MF / BVH / IFC fixtures", () => {
    const off = importStudioOff(
      ["OFF", "3 1 0", "0 0 0", "1 0 0", "0 1 0", "3 0 1 2"].join("\n"),
    );
    expect(off.meshes.length).toBe(1);
    expect(off.format).toBe("off");

    const mf = importStudio3mfMinimal(
      `<model><mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
        </triangles>
      </mesh></model>`,
    );
    expect(mf.meshes.length).toBe(1);
    expect(mf.format).toBe("3mf");

    const bvh = importStudioBvhMotion(
      [
        "HIERARCHY",
        "ROOT Hips",
        "{",
        "  OFFSET 0 0 0",
        "  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation",
        "  JOINT Spine",
        "  {",
        "    OFFSET 0 1 0",
        "    CHANNELS 3 Zrotation Xrotation Yrotation",
        "    End Site",
        "    {",
        "      OFFSET 0 1 0",
        "    }",
        "  }",
        "}",
        "MOTION",
        "Frames: 2",
        "Frame Time: 0.033333",
        "0 0 0 0 0 0 0 0 0",
        "0 0 0 0 0 0 0 0 0",
      ].join("\n"),
    );
    expect(bvh.format).toBe("bvh");
    expect(bvh.extras?.frameCount).toBe(2);
    expect(bvh.meshes.length).toBeGreaterThan(0);

    const ifc = importStudioIfcShell(
      [
        "ISO-10303-21;",
        "DATA;",
        "#1=IFCCARTESIANPOINT((0.,0.,0.));",
        "#2=IFCCARTESIANPOINT((1.,0.,0.));",
        "#3=IFCSPACE('1','SpaceA','Room',$,$,$,$,$,.ELEMENT.,$,$);",
        "#4=IFCWALL('2','Wall',$,$,$,$,$,$,$);",
        "ENDSEC;",
      ].join("\n"),
    );
    expect(ifc.format).toBe("ifc");
    expect(ifc.extras?.wallCount).toBe(1);
    expect((ifc.extras?.spaces as string[])?.length).toBeGreaterThan(0);

    expect(importStudioMeshByExtension("prop.off", new TextEncoder().encode("OFF\n0 0 0\n"))).not.toBeNull();
    expect(importStudioMeshByExtension("a.bvh", new TextEncoder().encode("HIERARCHY\n"))).not.toBeNull();

    const step = importStudioStepShell(
      `#10=CARTESIAN_POINT('',(0.,0.,0.));\n#20=CARTESIAN_POINT('',(1.,0.,0.));\n#30=PRODUCT('Bracket','Bracket','',(#40));\n#50=ADVANCED_FACE('',(#60),#70,.T.);`,
    );
    expect(step.format).toBe("step");
    expect(step.extras?.pointCount).toBeGreaterThan(0);
  });
});

describe("workspace expansion CAD/sculpt/cloth/collab/UV/mirror", () => {
  it("continues XPBD state and commits each admitted cloth step to canonical geometry", () => {
    const initial = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-continuation"),
      "cloth-cube",
    );
    const beforeHash = initial.session.state.geometry.records["cloth-cube"]!.meshHash;

    const first = workspaceClothStep(initial);
    const firstCache = clothCache(first, "cloth-cube");
    const firstHash = first.session.state.geometry.records["cloth-cube"]!.meshHash;
    const firstMesh = first.session.state.geometry.records["cloth-cube"]!.mesh;
    expect(firstCache?.stepIndex).toBe(1);
    expect(firstHash).not.toBe(beforeHash);
    expect(firstMesh.faces).toHaveLength(firstCache!.triangleIndices.length / 3);
    expect(firstMesh.faces.every((face) => {
      const firstHalfEdge = firstMesh.halfEdges[face.he]!;
      return firstMesh.halfEdges[firstHalfEdge.next]!.next === firstHalfEdge.prev;
    })).toBe(true);
    expect(first.bridge.set.objects.find(({ id }) => id === "cloth-cube")?.geometryHash)
      .toBe(firstHash);

    const second = workspaceClothStep(first);
    const secondCache = clothCache(second, "cloth-cube");
    const secondHash = second.session.state.geometry.records["cloth-cube"]!.meshHash;
    expect(second.clothStep).toBe(2);
    expect(secondCache?.stepIndex).toBe(2);
    expect(secondHash).not.toBe(firstHash);
    expect(Array.from(secondCache?.positions ?? []))
      .not.toEqual(Array.from(firstCache?.positions ?? []));
    expect(Array.from(secondCache?.velocities ?? []).some((value) => value !== 0)).toBe(true);

    for (const particle of secondCache?.fixedParticleIndices ?? []) {
      const offset = particle * 3;
      expect(Array.from(secondCache!.positions.slice(offset, offset + 3))).toEqual(
        Array.from(secondCache!.restPositions.slice(offset, offset + 3)),
      );
    }

    const record = second.session.state.geometry.records["cloth-cube"]!;
    const microEdited = {
      ...record.mesh,
      vertices: record.mesh.vertices.map((vertex, index) => index === 0
        ? {
            ...vertex,
            position: { ...vertex.position, x: vertex.position.x + 1e-7 },
          }
        : vertex),
    };
    const microSession = hybridDccCommitGeometry(second.session, "cloth-cube", microEdited);
    // Exact streaming geometry authority and the cloth cache identity must both notice a
    // sub-micrometre edit, so stale solver state can never overwrite it.
    expect(microSession.state.geometry.records["cloth-cube"]!.meshHash).not.toBe(secondHash);
    const restarted = workspaceClothStep({ ...second, session: microSession });
    expect(clothCache(restarted, "cloth-cube")?.stepIndex).toBe(1);
  });

  it("solves gravity in world space and invalidates continuation after object TRS changes", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-world-gravity"),
      "rotated-cloth",
    );
    const firstTransform = {
      revision: 1 as const,
      position: [2, 3, -1] as const,
      rotationEulerRad: [0, 0, Math.PI / 2] as const,
      scale: [2, 0.5, 1] as const,
    };
    workspace = workspaceCommitObjectTransform(workspace, "rotated-cloth", firstTransform);
    const beforeWorldY = workspace.session.state.geometry.records["rotated-cloth"]!.mesh.vertices
      .map(({ position }) => transformStudioHybridDccPoint(
        [position.x, position.y, position.z],
        firstTransform,
      )[1])
      .reduce((sum, value) => sum + value, 0);

    workspace = workspaceClothStep(workspace);
    const afterWorldY = workspace.session.state.geometry.records["rotated-cloth"]!.mesh.vertices
      .map(({ position }) => transformStudioHybridDccPoint(
        [position.x, position.y, position.z],
        firstTransform,
      )[1])
      .reduce((sum, value) => sum + value, 0);
    expect(afterWorldY).toBeLessThan(beforeWorldY);
    expect(clothCache(workspace, "rotated-cloth")?.stepIndex).toBe(1);

    workspace = workspaceCommitObjectTransform(workspace, "rotated-cloth", {
      ...firstTransform,
      rotationEulerRad: [0, Math.PI / 4, Math.PI / 2],
    });
    workspace = workspaceClothStep(workspace);
    expect(clothCache(workspace, "rotated-cloth")?.stepIndex).toBe(1);
  });

  it("keeps independent XPBD continuation across A → B → A asset switching", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-multi-asset"),
      "cloth-a",
    );
    workspace = workspaceClothStep(workspace);
    const firstA = clothCache(workspace, "cloth-a")!;

    workspace = workspaceAddUnitCube(workspace, "cloth-b");
    workspace = workspaceClothStep(workspace);
    const firstB = clothCache(workspace, "cloth-b")!;
    expect(workspace.clothRuntimeCache?.entries.size).toBe(2);

    workspace = workspaceSelectAsset(workspace, "cloth-a");
    workspace = workspaceClothStep(workspace);
    const secondA = clothCache(workspace, "cloth-a")!;
    expect(secondA.stepIndex).toBe(2);
    expect(Array.from(secondA.positions)).not.toEqual(Array.from(firstA.positions));
    expect(clothCache(workspace, "cloth-b")).toBe(firstB);
    expect(clothCache(workspace, "cloth-b")?.stepIndex).toBe(1);
  });

  it("invalidates only the edited asset while moving collider frames preserve XPBD continuity", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-targeted-invalidation"),
      "cloth-a",
    );
    workspace = workspaceClothStep(workspace);
    workspace = workspaceAddUnitCube(workspace, "cloth-b");
    workspace = workspaceClothStep(workspace);
    const originalB = clothCache(workspace, "cloth-b")!;

    workspace = workspaceSelectAsset(workspace, "cloth-a");
    workspace = workspaceClothStep(workspace, { solverIterations: 7 });
    expect(clothCache(workspace, "cloth-a")?.stepIndex).toBe(1);
    expect(clothCache(workspace, "cloth-b")).toBe(originalB);

    workspace = workspaceClothStep(workspace, {
      solverIterations: 7,
      capsules: [{
        id: "body",
        previousHead: [100, 100, 100],
        previousTail: [100, 101, 100],
        currentHead: [100, 100, 100],
        currentTail: [100, 101, 100],
        radius: 0.25,
      }],
    });
    expect(clothCache(workspace, "cloth-a")?.stepIndex).toBe(1);
    expect(clothCache(workspace, "cloth-b")).toBe(originalB);
    const firstColliderConfig = clothCache(workspace, "cloth-a")!.simulationConfigSha256;

    workspace = workspaceClothStep(workspace, {
      solverIterations: 7,
      capsules: [{
        id: "body",
        previousHead: [100, 100, 100],
        previousTail: [100, 101, 100],
        currentHead: [100.25, 100, 100],
        currentTail: [100.25, 101, 100],
        radius: 0.25,
        friction: 0,
        compliance: 0,
      }],
    });
    expect(clothCache(workspace, "cloth-a")?.stepIndex).toBe(2);
    expect(clothCache(workspace, "cloth-a")?.simulationConfigSha256).toBe(firstColliderConfig);

    workspace = workspaceClothStep(workspace, {
      solverIterations: 7,
      capsules: [{
        id: "body",
        previousHead: [100.25, 100, 100],
        previousTail: [100.25, 101, 100],
        currentHead: [100.5, 100, 100],
        currentTail: [100.5, 101, 100],
        radius: 0.3,
      }],
    });
    expect(clothCache(workspace, "cloth-a")?.stepIndex).toBe(1);

    const transformB = workspace.session.state.objectTransforms["cloth-b"]!;
    workspace = workspaceCommitObjectTransform(workspace, "cloth-b", {
      ...transformB,
      position: [3, 2, 1],
    });
    expect(clothCache(workspace, "cloth-b")).toBeUndefined();
    const aAfterColliderChange = clothCache(workspace, "cloth-a")!;
    workspace = workspaceSelectAsset(workspace, "cloth-b");
    workspace = workspaceClothStep(workspace);
    expect(clothCache(workspace, "cloth-b")?.stepIndex).toBe(1);
    expect(clothCache(workspace, "cloth-a")).toBe(aAfterColliderChange);

    workspace = workspaceSelectAsset(workspace, "cloth-a");
    workspace = workspaceSubdivideActive(workspace, 1);
    const bAfterTransform = clothCache(workspace, "cloth-b")!;
    workspace = workspaceClothStep(workspace);
    expect(clothCache(workspace, "cloth-a")?.stepIndex).toBe(1);
    expect(clothCache(workspace, "cloth-b")).toBe(bAfterTransform);
  });

  it("canonicalizes capsule order without losing continuation", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-capsule-order"),
      "cloth",
    );
    const capsule = (
      id: string,
      offset: number,
      movement: number,
    ) => ({
      id,
      previousHead: [100 + offset, 100, 100] as const,
      previousTail: [100 + offset, 101, 100] as const,
      currentHead: [100 + offset + movement, 100, 100] as const,
      currentTail: [100 + offset + movement, 101, 100] as const,
      radius: 0.2,
      friction: 0.25,
      compliance: 0.001,
    });

    workspace = workspaceClothStep(workspace, {
      capsules: [capsule("z-body", 2, 0), capsule("a-hand", 0, 0)],
    });
    const first = clothCache(workspace, "cloth")!;
    workspace = workspaceClothStep(workspace, {
      capsules: [capsule("a-hand", 0, 0.2), capsule("z-body", 2, -0.1)],
    });
    const second = clothCache(workspace, "cloth")!;
    expect(second.stepIndex).toBe(2);
    expect(second.simulationConfigSha256).toBe(first.simulationConfigSha256);
  });

  it("enforces LRU capacity, discards oversized stores, and prunes deleted assets", () => {
    let workspace = createStudioHybridDccWorkspace("ws-cloth-cache-budget");
    for (let index = 0; index < STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES; index += 1) {
      workspace = workspaceAddUnitCube(workspace, `cloth-${index}`);
      workspace = workspaceClothStep(workspace);
    }
    workspace = workspaceSelectAsset(workspace, "cloth-0");
    workspace = workspaceClothStep(workspace);
    workspace = workspaceAddUnitCube(workspace, "cloth-overflow");
    workspace = workspaceClothStep(workspace);
    expect(workspace.clothRuntimeCache?.entries.size)
      .toBe(STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES);
    expect(clothCache(workspace, "cloth-0")?.stepIndex).toBe(2);
    expect(clothCache(workspace, "cloth-1")).toBeUndefined();

    workspace = workspaceDeleteActive(workspace);
    expect(clothCache(workspace, "cloth-overflow")).toBeUndefined();
    expect(workspace.clothRuntimeCache?.entries.size)
      .toBe(STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES - 1);

    workspace = workspaceSelectAsset(workspace, "cloth-0");
    const seed = clothCache(workspace, "cloth-0")!;
    const oversized = new Map<string, typeof seed>();
    for (let index = 0; index < 10_000; index += 1) {
      oversized.set(`forged-${index}`, seed);
    }
    workspace = workspaceClothStep({
      ...workspace,
      clothRuntimeCache: {
        kind: "studio-hybrid-dcc-cloth-runtime-cache-store",
        version: 1,
        maxEntries: STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES,
        entries: oversized,
      },
    });
    expect(workspace.clothRuntimeCache?.entries.size).toBe(1);
    expect(clothCache(workspace, "cloth-0")?.stepIndex).toBe(1);
  });

  it("discards malformed cache arrays before copying and cold-starts from authority", () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-cache-array-bounds"),
      "cloth",
    );
    workspace = workspaceClothStep(workspace);
    const seed = clothCache(workspace, "cloth")!;
    const forged = {
      ...seed,
      positions: new Float32Array(STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticles * 3 + 3),
      velocities: new Float32Array(0),
      triangleIndices: new Uint32Array(STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles * 3 + 3),
    };
    workspace = workspaceClothStep({
      ...workspace,
      clothRuntimeCache: {
        kind: "studio-hybrid-dcc-cloth-runtime-cache-store",
        version: 1,
        maxEntries: STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES,
        entries: new Map([["cloth", forged]]),
      },
    });
    expect(clothCache(workspace, "cloth")?.stepIndex).toBe(1);
    expect(clothCache(workspace, "cloth")?.positions).toHaveLength(8 * 3);
    expect(clothCache(workspace, "cloth")?.triangleIndices).toHaveLength(12 * 3);
  });

  it("rejects vertex, face, and n-gon budgets before exact mesh hashing", () => {
    const workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-prehash-budget"),
      "hostile-cloth",
    );
    const base = workspace.session.state.geometry.records["hostile-cloth"]!.mesh;

    const oversizedVertices = new Array(STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticles + 1);
    Object.defineProperty(oversizedVertices, 0, {
      get: () => { throw new Error("exact hash touched oversized vertices"); },
    });
    expect(() => workspaceClothStep(workspaceWithForgedActiveMesh(workspace, {
      ...base,
      vertices: oversizedVertices as StudioEditableMesh["vertices"],
    }))).toThrow(/budget-exceeded:vertices/u);

    const oversizedFaces = new Array(STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles + 1);
    Object.defineProperty(oversizedFaces, 0, {
      get: () => { throw new Error("exact hash touched oversized faces"); },
    });
    expect(() => workspaceClothStep(workspaceWithForgedActiveMesh(workspace, {
      ...base,
      faces: oversizedFaces as StudioEditableMesh["faces"],
    }))).toThrow(/budget-exceeded:faces/u);

    const nGonCornerCount = STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles + 3;
    const guardedVertices = base.vertices.map((vertex) => ({ ...vertex }));
    Object.defineProperty(guardedVertices[0]!, "position", {
      get: () => { throw new Error("exact hash touched over-budget n-gon vertices"); },
    });
    const nGon: StudioEditableMesh = {
      ...base,
      vertices: guardedVertices,
      faces: [{ id: 0, he: 0, materialSlot: 0, smooth: false }],
      halfEdges: Array.from({ length: nGonCornerCount }, (_, index) => ({
        id: index,
        vertex: index % guardedVertices.length,
        face: 0,
        next: (index + 1) % nGonCornerCount,
        prev: (index + nGonCornerCount - 1) % nGonCornerCount,
        twin: -1,
        crease: 0,
      })),
      nextHalfEdgeId: nGonCornerCount,
      nextFaceId: 1,
    };
    expect(() => workspaceClothStep(workspaceWithForgedActiveMesh(workspace, nGon)))
      .toThrow(/budget-exceeded:triangles/u);
  });

  it("rejects unsafe fan polygons before they can become triangle authority", () => {
    const baseWorkspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-safe-fan"),
      "cloth",
    );
    const cases = [
      createStudioEditableMeshFromPolygons(
        [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 1, y: 0, z: 1 },
          { x: 2, y: 0, z: 2 },
          { x: 0, y: 0, z: 2 },
        ],
        [[0, 1, 2, 3, 4]],
      ),
      createStudioEditableMeshFromPolygons(
        [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 2 },
          { x: 0, y: 0, z: 2 },
          { x: 2, y: 0, z: 0 },
        ],
        [[0, 1, 2, 3]],
      ),
      createStudioEditableMeshFromPolygons(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 2, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
        [[0, 1, 2, 3, 4]],
      ),
      createStudioEditableMeshFromPolygons(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0.2, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
        [[0, 1, 2, 3]],
      ),
    ];

    for (const mesh of cases) {
      const hostile = workspaceWithForgedActiveMesh(baseWorkspace, mesh);
      const beforeRecord = hostile.session.state.geometry.records.cloth;
      expect(() => workspaceClothStep(hostile)).toThrow(/cloth-v2-compile:invalid-input/u);
      expect(hostile.session.state.geometry.records.cloth).toBe(beforeRecord);
      expect(hostile.clothRuntimeCache).toBeNull();
    }
  });

  it("rejects malformed half-edge authority instead of coercing missing vertex ids to zero", () => {
    const workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("ws-cloth-structural-preflight"),
      "cloth",
    );
    const triangle = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      [[0, 1, 2]],
    );
    const malformed: StudioEditableMesh[] = [
      {
        ...triangle,
        halfEdges: triangle.halfEdges.map((halfEdge, index) => (
          index === 0 ? { ...halfEdge, vertex: 999 } : halfEdge
        )),
      },
      {
        ...triangle,
        vertices: triangle.vertices.map((vertex, index) => (
          index === 1 ? { ...vertex, id: 0 } : vertex
        )),
      },
      {
        ...triangle,
        halfEdges: triangle.halfEdges.map((halfEdge, index) => (
          index === 0 ? { ...halfEdge, next: 2 } : halfEdge
        )),
      },
      {
        ...triangle,
        halfEdges: triangle.halfEdges.map((halfEdge, index) => (
          index === 0 ? { ...halfEdge, face: 99 } : halfEdge
        )),
      },
    ];
    for (const mesh of malformed) {
      expect(() => workspaceClothStep(workspaceWithForgedActiveMesh(workspace, mesh)))
        .toThrow(/cloth-v2-compile:invalid-input/u);
    }
  });

  it("runs expanded workspace ops and packs toon3d", async () => {
    let ws = createStudioHybridDccWorkspace("ws-product");
    expect(ws.revision).toBeGreaterThanOrEqual(3);
    ws = workspaceAddUnitCube(ws, "hero");
    ws = await workspaceMirrorActive(ws);
    ws = workspaceUvUnwrapActive(ws, "box");
    expect(ws.lastUvMap?.mode).toBe("box");
    expect(ws.lastUvMap!.uvs.length).toBeGreaterThan(0);
    ws = workspaceSculptActive(ws, 0.1);
    ws = workspaceCadProp(ws, "cad-1");
    expect(ws.activeAssetId).toBe("cad-1");
    ws = workspaceClothStep(ws);
    expect(ws.clothStep).toBe(1);
    ws = workspaceCollabJoin(ws, "p1", "Kim");
    expect(ws.collab.peers).toHaveLength(1);
    ws = workspaceRetargetFromBvhExtras(ws, ["Hips", "Spine", "Head", "LeftArm"]);
    expect(ws.lastRetarget).not.toBeNull();
    expect(ws.lastRetarget!.source).toBe("bvh");
    ws = workspaceAddUnitCube(ws, "subdiv-target");
    ws = workspaceSubdivideActive(ws, 1);
    ws = await workspaceArrayActive(ws, 2);
    ws = workspaceRebuildBom(ws);
    expect(ws.bom.lines.length).toBeGreaterThan(0);
    expect(bomRollupByMaterial(ws.bom).length).toBeGreaterThan(0);
    expect(bomEstimateMassKg(ws.bom)).toBeGreaterThan(0);
    const pkg = workspaceExportToon3d(ws);
    expect(pkg.manifest.format).toBe("toonspectrum.toon3d");
  });

  it("sniffs binary FBX without fabricating geometry", () => {
    const magic = new TextEncoder().encode("Kaydara FBX Binary  \0");
    const bytes = new Uint8Array(64);
    bytes.set(magic);
    expect(isStudioFbxBinary(bytes)).toBe(true);
    const result = importStudioFbxDocument(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail.startsWith("binary-fbx:")).toBe(true);
  });

  it("geometry-nodes primitives and decimate land in workspace", () => {
    const sphere = buildStudioGeoNodesPrimitive("sphere", 6);
    expect(sphere.ok).toBe(true);
    if (sphere.ok) {
      expect(sphere.triangleCount).toBeGreaterThan(0);
    }
    let ws = createStudioHybridDccWorkspace("ws-geonodes");
    ws = workspaceAddGeoNodesPrimitive(ws, "cylinder", "cyl-1", 6);
    expect(ws.activeAssetId).toBe("cyl-1");
    ws = workspaceDecimateActive(ws, 0.6);
    expect(ws.session.state.geometry.records["cyl-1"]).toBeDefined();
  });

  it("evaluates real geometry-nodes starter graph into workspace", () => {
    const starter = evaluateStudioGeoNodesStarterGraph();
    expect(starter.ok).toBe(true);
    if (starter.ok) {
      expect(starter.vertexCount).toBe(8);
      expect(starter.triangleCount).toBe(12);
    }
    let ws = createStudioHybridDccWorkspace("ws-starter");
    ws = workspaceAddGeoNodesStarter(ws, "gn-box");
    expect(ws.activeAssetId).toBe("gn-box");
    expect(ws.session.state.geometry.records["gn-box"]).toBeDefined();
  });

  it("exports mesh formats with non-empty hashes from shipped adapters", () => {
    const cube = createStudioUnitCubeMesh();
    const stl = exportStudioMeshStlAscii(cube, "cube");
    expect(stl.triangleCount).toBeGreaterThan(0);
    expect(stl.text).toContain("solid cube");
    expect(stl.contentHash.startsWith("sha256:")).toBe(true);
    const obj = exportStudioMeshObj(cube);
    expect(obj.text).toMatch(/^v /m);
    expect(obj.text).toMatch(/^f /m);
    let ws = createStudioHybridDccWorkspace("ws-export");
    ws = workspaceAddUnitCube(ws, "ex");
    ws = workspaceExportActiveMesh(ws, "ply");
    expect(ws.lastExport?.format).toBe("ply");
    expect(ws.lastExport!.triangleCount).toBeGreaterThan(0);
  });

  it("full multi-kernel engine suite asserts engine coverage metrics", async () => {
    const result = await runStudioHybridDccFullEngineSuite("suite-gate");
    expect(result.metrics.assetCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.engines).toContain("geometry-nodes-starter");
    expect(result.metrics.engines).toContain("modifier-solidify");
    expect(result.metrics.engines).toContain("cad-extrude");
    expect(result.metrics.engines).toContain("export-stl");
    expect(result.metrics.engines).toContain("toon3d-pack");
    expect(result.metrics.exportFormat).toBe("stl");
    expect(result.metrics.exportTriangles).toBeGreaterThan(0);
    expect(result.metrics.springTailY).not.toBeNull();
    expect(result.metrics.packageHash.startsWith("sha256:")).toBe(true);
    expect(result.metrics.toonPassCount).toBeGreaterThan(0);
    expect(result.metrics.diagnosticErrors).toBe(0);
    expect(result.package.files["document/document.json"]).toContain("gn-starter");
  });

  it("CAD revolve and voxel remesh produce non-empty meshes via shipped APIs", () => {
    let ws = createStudioHybridDccWorkspace("ws-revolve-remesh");
    ws = workspaceCadRevolve(ws, "lathe");
    const lathe = ws.session.state.geometry.records["lathe"]?.mesh;
    expect(lathe).toBeDefined();
    expect(lathe!.faces.length).toBeGreaterThan(0);
    ws = workspaceAddUnitCube(ws, "remesh-src");
    ws = workspaceVoxelRemeshActive(ws, 0.25);
    expect(ws.session.state.geometry.records["remesh-src"]!.mesh.faces.length).toBeGreaterThan(0);
  });
});

describe("collab shell + catalog revision", () => {
  it("tracks presence and keeps §12.1 coverage", () => {
    let room = createStudioDccCollabRoom("r1");
    room = collabJoin(room, { peerId: "a", displayName: "A", color: "#f00" });
    room = collabAppendOp(room, {
      kind: "geometry-hint",
      peerId: "a",
      assetId: "mesh-1",
      geometryHash: "h1",
      at: Date.now(),
    });
    expect(collabActivePeerIds(room).includes("a")).toBe(true);
    expect(STUDIO_DCC_COLLAB_SHELL_REVISION).toBeGreaterThanOrEqual(4);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REVISION).toBeGreaterThanOrEqual(8);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.some((entry) => entry.id === "WS-FULL-ENGINE")).toBe(true);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.some((entry) => entry.id === "FMT-OFF")).toBe(true);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.some((entry) => entry.id === "UI-HYBRID-PANEL")).toBe(true);
    const { ok, missing } = assertWebtoonObjectCreatorV1KernelCoverage();
    expect(missing).toEqual([]);
    expect(ok).toBe(true);
  });
});
