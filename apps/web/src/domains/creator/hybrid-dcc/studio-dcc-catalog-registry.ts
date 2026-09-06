/**
 * Compatibility registry for callable §12.1 / P0–P1 kernel surfaces.
 *
 * This is deliberately not the product-delivery SSOT. Product delivery evidence
 * (UI, document, persistence, collaboration, browser, and production stages)
 * lives in `studio-dcc-section6-full-catalog.ts`. A row in this registry proves
 * only that a kernel/bridge API exists at the documented ceiling.
 */

export const STUDIO_DCC_KERNEL_COVERAGE_REVISION = 8 as const;

export type StudioCatalogKernelStatus =
  | "kernel-shipped"
  | "partial"
  | "deferred-p2"
  | "deferred-p3"
  | "deferred-p4"
  | "deferred-p5"
  | "bridge-only";

export interface StudioCatalogKernelEntry {
  readonly id: string;
  readonly priority: "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
  readonly kernelStatus: StudioCatalogKernelStatus;
  readonly apis: readonly string[];
  readonly module: string;
  /** When kernelStatus is partial/bridge-only: the explicit implementation ceiling. */
  readonly ceilingNote?: string;
}

/**
 * Historical kernel-boundary notes. "kernel-ready" here is not product-delivery
 * evidence; the delivery assessment remains authoritative for later stages.
 */
export const STUDIO_DCC_KERNEL_BOUNDARY_POLICY = {
  "DOC-008":
    "kernel-ready: Yjs scene/layer metadata CRDT + collab shell presence/locks",
  "FMT-FBX":
    "kernel-ready: ASCII mesh + binary uncompressed Vertices/PolygonVertexIndex lite; skin/anim grade note only",
  "FMT-IFC":
    "kernel-ready: semantic entities + AABB/point-fan mesh (grade B)",
  "FMT-STEP":
    "kernel-ready: cartesian/product + AABB/point-fan mesh (grade B)",
  "CAD-001":
    "kernel-ready: line/arc/circle/ellipse/spline + units + construction + trim/extend",
} as const;

type LegacyKernelCoverageStatus = "shipped" | Exclude<StudioCatalogKernelStatus, "kernel-shipped">;
type LegacyKernelCoverageEntry = Omit<StudioCatalogKernelEntry, "kernelStatus"> & {
  /** Private migration encoding: "shipped" means callable kernel only. */
  readonly status: LegacyKernelCoverageStatus;
};

const STUDIO_DCC_LEGACY_KERNEL_ROWS: readonly LegacyKernelCoverageEntry[] = [
  // DOC
  { id: "DOC-001", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["createStudioHybridDccSession"] },
  { id: "DOC-002", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccUndo", "hybridDccRedo"] },
  { id: "DOC-003", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccPropagateDirty"] },
  { id: "DOC-004", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccRecoverFromJournal"] },
  { id: "DOC-005", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccContentAddressAsset"] },
  { id: "DOC-006", priority: "P0", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccAutosaveCheckpoint"] },
  { id: "DOC-007", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccSelectiveUndo"] },
  { id: "DOC-012", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccRegisterAsset"] },
  { id: "DOC-015", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-diagnostics.ts", apis: ["scanStudioHybridDccCorruption"] },
  {
    id: "DOC-008",
    priority: "P2",
    status: "shipped",
    module: "studio-dcc-yjs-scene-metadata.ts",
    apis: [
      "createStudioDccYjsSceneMetadataDoc",
      "mergeStudioDccYjsSceneMetadata",
      "exerciseStudioDccYjsSceneMetadataConvergence",
      "collabConflictReport",
      "collabCanEdit",
    ],
  },
  // MOD
  { id: "MOD-001", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["selectStudioMeshElements"] },
  { id: "MOD-002", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["selectStudioMeshEdgeLoop", "selectStudioMeshFaceRing"] },
  { id: "MOD-003", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["transformStudioEditableMesh"] },
  { id: "MOD-004", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["extrudeStudioEditableMeshFacesWithReceipt"] },
  { id: "MOD-005", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["insetStudioEditableMeshFaces"] },
  { id: "MOD-006", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["bevelStudioEditableMeshEdges"] },
  { id: "MOD-007", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["loopCutStudioEditableMesh"] },
  { id: "MOD-008", priority: "P2", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["knifeStudioEditableMesh", "bisectStudioEditableMesh"] },
  { id: "MOD-009", priority: "P2", status: "shipped", module: "studio-mesh-ops-advanced.ts", apis: ["bridgeStudioFaceLoops"] },
  { id: "MOD-010", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["weldStudioEditableMesh", "dissolveStudioEditableMeshFaces"] },
  { id: "MOD-011", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["setStudioEditableMeshCrease"] },
  { id: "MOD-012", priority: "P1", status: "shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-013", priority: "P1", status: "shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-014", priority: "P1", status: "shipped", module: "studio-solid-boolean-backend.ts", apis: ["createStudioManifoldSolidBooleanBackend"] },
  { id: "MOD-015", priority: "P1", status: "shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-016", priority: "P1", status: "shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-017", priority: "P2", status: "shipped", module: "studio-mesh-ops-advanced.ts", apis: ["subdivideStudioMeshCatmullLite"] },
  { id: "MOD-024", priority: "P1", status: "shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["diagnoseStudioEditableMesh"] },
  // BLD
  { id: "BLD-001", priority: "P1", status: "shipped", module: "studio-build-inference-snap.ts", apis: ["resolveStudioBuildInferenceSnap"] },
  { id: "BLD-002", priority: "P1", status: "shipped", module: "studio-build-inference-snap.ts", apis: ["cycleStudioInferenceAxisLock"] },
  { id: "BLD-003", priority: "P1", status: "shipped", module: "studio-bg3d-push-pull.ts", apis: ["planStudioBg3dPushPull"] },
  { id: "BLD-004", priority: "P1", status: "shipped", module: "studio-build-generators.ts", apis: ["offsetStudioFloorPlanPolygon"] },
  { id: "BLD-006", priority: "P1", status: "shipped", module: "studio-component-instance-core.ts", apis: ["planStudioComponentMakeUnique"] },
  { id: "BLD-007", priority: "P1", status: "shipped", module: "studio-build-tags-outliner.ts", apis: ["resolveStudioOutlinerVisibility"] },
  { id: "BLD-009", priority: "P1", status: "shipped", module: "studio-build-generators.ts", apis: ["buildStudioWallsFromFloorPlan"] },
  { id: "BLD-010", priority: "P1", status: "shipped", module: "studio-bg3d-room-builder.ts", apis: ["buildStudioBg3dRoomParts"] },
  { id: "BLD-011", priority: "P1", status: "shipped", module: "studio-build-generators.ts", apis: ["generateStudioStairs"] },
  { id: "BLD-012", priority: "P1", status: "shipped", module: "studio-build-generators.ts", apis: ["generateStudioSlab"] },
  { id: "BLD-015", priority: "P1", status: "shipped", module: "studio-bg3d-room-builder.ts", apis: ["getStudioBg3dRoomPreset"] },
  { id: "BLD-016", priority: "P1", status: "shipped", module: "studio-build-generators.ts", apis: ["createStudioDimension"] },
  { id: "BLD-018", priority: "P1", status: "shipped", module: "studio-camera-wall-hide.ts", apis: ["resolveStudioCameraWallHide"] },
  // CHR / import
  { id: "CHR-001", priority: "P1", status: "shipped", module: "studio-grade-a-import-pipeline.ts", apis: ["importStudioGradeAAsset"] },
  { id: "CHR-002", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["diagnoseStudioHumanoidMapping"] },
  { id: "CHR-003", priority: "P1", status: "shipped", module: "studio-character-ik-fk.ts", apis: ["poseStudioBodyChainIk", "poseStudioBodyChainFk"] },
  { id: "CHR-007", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["STUDIO_HAND_POSE_LIBRARY"] },
  { id: "CHR-008", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["mixStudioExpressions"] },
  { id: "CHR-009", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioLookAt"] },
  { id: "CHR-018", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioPoseAssetMetadata"] },
  // SHT / NPR
  { id: "SHT-001", priority: "P0", status: "shipped", module: "studio-live-2d3d-bridge.ts", apis: ["createStudioLiveBridgeDocument"] },
  { id: "SHT-002", priority: "P1", status: "shipped", module: "studio-shot-continuity.ts", apis: ["studioCameraFovY"] },
  { id: "SHT-003", priority: "P1", status: "shipped", module: "studio-live-2d3d-bridge.ts", apis: ["applyStudioShotOverride"] },
  { id: "SHT-005", priority: "P1", status: "shipped", module: "studio-camera-wall-hide.ts", apis: ["resolveStudioCameraWallHide"] },
  { id: "NPR-001", priority: "P0", status: "shipped", module: "studio-live-2d3d-bridge.ts", apis: ["STUDIO_TOON_PASS_KINDS"] },
  { id: "NPR-005", priority: "P1", status: "shipped", module: "studio-live-2d3d-bridge.ts", apis: ["generateStudioToonPass"] },
  { id: "NPR-006", priority: "P1", status: "shipped", module: "studio-artist-correction-delta.ts", apis: ["appendStudioArtistCorrection"] },
  { id: "NPR-008", priority: "P1", status: "shipped", module: "studio-artist-correction-delta.ts", apis: ["reprojectStudioArtistCorrections"] },
  // MAT / formats
  { id: "MAT-006", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioDecalPlacement"] },
  { id: "MAT-009", priority: "P1", status: "shipped", module: "studio-character-pose-p1.ts", apis: ["studioKtx2DerivativeForProfile"] },
  { id: "PRC-005", priority: "P1", status: "shipped", module: "studio-bg3d-room-builder.ts", apis: ["buildStudioBg3dRoomParts"] },
  // Formats §12.1
  { id: "FMT-GLB", priority: "P0", status: "shipped", module: "studio-glb-scene-ir.ts", apis: ["importStudioGlbDocument"] },
  { id: "FMT-VRM", priority: "P0", status: "shipped", module: "studio-glb-scene-ir.ts", apis: ["importStudioGlbDocument"] },
  { id: "FMT-OBJ", priority: "P0", status: "shipped", module: "studio-import-compatibility-report.ts", apis: ["parseStudioObjToSceneIR"] },
  {
    id: "FMT-FBX",
    priority: "P1",
    status: "shipped",
    module: "studio-fbx-ascii-import.ts",
    apis: [
      "importStudioFbxDocument",
      "parseStudioFbxBinaryMeshLite",
      "sniffStudioFbxBinaryHeader",
      "parseStudioFbxAsciiHeader",
    ],
  },
  { id: "FMT-STL", priority: "P1", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioStl"] },
  { id: "FMT-PLY", priority: "P1", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioPlyAscii"] },
  { id: "FMT-DAE", priority: "P2", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioDaeMinimal"] },
  { id: "FMT-DXF", priority: "P2", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioDxfPlan"] },
  { id: "FMT-OFF", priority: "P3", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioOff"] },
  { id: "FMT-3MF", priority: "P2", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudio3mfMinimal"] },
  { id: "FMT-BVH", priority: "P2", status: "shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioBvhMotion"] },
  {
    id: "FMT-IFC",
    priority: "P3",
    status: "shipped",
    module: "studio-mesh-format-adapters.ts",
    apis: ["importStudioIfcShell"],
  },
  {
    id: "FMT-STEP",
    priority: "P3",
    status: "shipped",
    module: "studio-mesh-format-adapters.ts",
    apis: ["importStudioStepShell"],
  },
  { id: "FMT-TOON3D", priority: "P0", status: "shipped", module: "studio-toon3d-package.ts", apis: ["packStudioToon3dPackage"] },
  { id: "MAT-004", priority: "P2", status: "shipped", module: "studio-uv-unwrap-lite.ts", apis: ["unwrapStudioMeshBox", "unwrapStudioMeshPlanar"] },
  { id: "CHR-RETARGET", priority: "P2", status: "shipped", module: "studio-character-animation-p2.ts", apis: ["retargetStudioMotionReport", "workspaceRetargetFromBvhExtras"] },
  { id: "CAD-BOM", priority: "P4", status: "shipped", module: "studio-manufacturing-bom-lite.ts", apis: ["bomFromAssetParts", "bomRollupByMaterial", "workspaceRebuildBom"] },
  { id: "MOD-ARRAY-WS", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceArrayActive", "workspaceSubdivideActive"] },
  { id: "MOD-GEONODES", priority: "P2", status: "shipped", module: "studio-geometry-nodes-workspace-bridge.ts", apis: ["buildStudioGeoNodesPrimitive", "workspaceAddGeoNodesPrimitive"] },
  { id: "MOD-DECIMATE-WS", priority: "P2", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceDecimateActive"] },
  // Workspace vertical
  { id: "V1-VERTICAL", priority: "P1", status: "shipped", module: "studio-webtoon-object-creator-v1-demo.ts", apis: ["runStudioWebtoonObjectCreatorV1Demo"] },
  { id: "WS-API", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["createStudioHybridDccWorkspace"] },
  { id: "UI-HYBRID-PANEL", priority: "P1", status: "shipped", module: "StudioHybridDccPanel.tsx", apis: ["StudioHybridDccPanel", "StudioHybridDccDialog"] },
  // CAD / sculpt / cloth promoted from deferred lite kernels
  {
    id: "CAD-001",
    priority: "P3",
    status: "shipped",
    module: "studio-cad-kernel-lite.ts",
    apis: [
      "exerciseStudioCad001SketchPrimitives",
      "addStudioCadSketchCurve",
      "trimStudioCadLine",
      "extendStudioCadLine",
      "buildStudioCadRectangleSketch",
    ],
  },
  { id: "CAD-015", priority: "P3", status: "shipped", module: "studio-cad-kernel-lite.ts", apis: ["extrudeStudioCadProfile", "workspaceCadProp"] },
  { id: "SCP-001", priority: "P3", status: "shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["applyStudioSculptStroke", "workspaceSculptActive"] },
  { id: "GAR-005", priority: "P3", status: "shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["stepStudioClothXpbd", "workspaceClothStep"] },
  { id: "WS-WAVE-LOOP", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["runStudioHybridDccWaveProductLoop"] },
  { id: "WS-FULL-ENGINE", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["runStudioHybridDccFullEngineSuite"] },
  { id: "MOD-GEONODES-EVAL", priority: "P2", status: "shipped", module: "studio-geometry-nodes-workspace-bridge.ts", apis: ["evaluateStudioGeoNodesStarterGraph"] },
  { id: "FMT-EXPORT-STL", priority: "P1", status: "shipped", module: "studio-mesh-export-adapters.ts", apis: ["exportStudioMeshStlAscii", "exportStudioMeshObj", "exportStudioMeshPlyAscii"] },
  { id: "MOD-SOLIDIFY-WS", priority: "P1", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceSolidifyActive", "workspaceBevelActive"] },
  { id: "MOD-DEFORM-WS", priority: "P2", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceBendActive", "workspaceRepairActive", "workspaceShrinkwrapActive"] },
  { id: "SCP-REMESH-WS", priority: "P3", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceVoxelRemeshActive"] },
  { id: "CAD-REVOLVE-WS", priority: "P3", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceCadRevolve"] },
  { id: "CHR-SPRING-WS", priority: "P2", status: "shipped", module: "studio-hybrid-dcc-workspace.ts", apis: ["workspaceStepSpring", "workspaceSampleIdleClip"] },
];

/**
 * Callable-kernel compatibility view. Consumers must use
 * `STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS` for product-delivery claims.
 */
export const STUDIO_DCC_KERNEL_COVERAGE_REGISTRY: readonly StudioCatalogKernelEntry[] =
  STUDIO_DCC_LEGACY_KERNEL_ROWS.map(({ status, ...entry }) => ({
    ...entry,
    kernelStatus: status === "shipped" ? "kernel-shipped" : status,
  }));

export function studioKernelCatalogByPriority(
  priority: StudioCatalogKernelEntry["priority"],
): readonly StudioCatalogKernelEntry[] {
  return STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.filter((entry) => entry.priority === priority);
}

export function studioCatalogKernelReadyIds(): readonly string[] {
  return STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.filter(
    (entry) => entry.kernelStatus === "kernel-shipped" || entry.kernelStatus === "partial",
  ).map(
    (entry) => entry.id,
  );
}

/** §12.1 required bullets mapped to IDs that must expose a callable kernel. */
export const STUDIO_WEBTOON_OBJECT_CREATOR_V1_KERNEL_REQUIRED_IDS = [
  "MOD-001", "MOD-004", "MOD-005", "MOD-006", "MOD-007", "MOD-008", "MOD-009",
  "MOD-012", "MOD-013", "MOD-014", "MOD-015",
  "BLD-001", "BLD-003", "BLD-006", "BLD-009", "BLD-010", "BLD-011",
  "FMT-GLB", "FMT-VRM", "FMT-OBJ", "FMT-FBX",
  "SHT-001", "SHT-003", "NPR-001", "NPR-008",
  "DOC-004", "DOC-012", "V1-VERTICAL",
] as const;

export function assertWebtoonObjectCreatorV1KernelCoverage(): {
  readonly missing: readonly string[];
  readonly ok: boolean;
} {
  const byId = new Map(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.map((entry) => [entry.id, entry]));
  const missing = STUDIO_WEBTOON_OBJECT_CREATOR_V1_KERNEL_REQUIRED_IDS.filter((id) => {
    const entry = byId.get(id);
    return !entry
      || (entry.kernelStatus !== "kernel-shipped" && entry.kernelStatus !== "partial");
  });
  return { missing, ok: missing.length === 0 };
}

/** Every partial kernel row must declare its implementation ceiling. */
export function assertKernelPartialCeilingNotes(): {
  readonly missing: readonly string[];
  readonly ok: boolean;
} {
  const missing = STUDIO_DCC_KERNEL_COVERAGE_REGISTRY
    .filter((entry) => entry.kernelStatus === "partial" && !entry.ceilingNote)
    .map((entry) => entry.id);
  return { missing, ok: missing.length === 0 };
}
