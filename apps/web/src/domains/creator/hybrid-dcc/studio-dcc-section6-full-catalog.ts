/**
 * SSOT: architecture doc §6 kernel catalog (auto-synced coverage).
 *
 * `kernelStatus` only describes the callable kernel/bridge surface. Product delivery
 * evidence is tracked separately so a fixture result cannot be mistaken for UI,
 * persistence, collaboration, browser, or production completion.
 */

export const STUDIO_DCC_SECTION6_CATALOG_REVISION = 2 as const;

export type StudioSection6Priority = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
export type StudioSection6KernelStatus = "kernel-shipped" | "partial" | "bridge-only";
export type StudioSection6DeliveryStage =
  | "kernel-shipped"
  | "ui-wired"
  | "document-integrated"
  | "persistence-verified"
  | "collaboration-verified"
  | "browser-verified"
  | "production-activated";

export interface StudioSection6CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly priority: StudioSection6Priority;
  readonly kernelStatus: StudioSection6KernelStatus;
  readonly module: string;
  readonly apis: readonly string[];
  readonly ceilingNote?: string;
}

export interface StudioSection6DeliveryAssessment {
  readonly id: string;
  readonly verifiedStages: readonly StudioSection6DeliveryStage[];
  readonly unverifiedStages: readonly Exclude<
    StudioSection6DeliveryStage,
    "kernel-shipped"
  >[];
}

const STUDIO_SECTION6_PRODUCT_STAGES = [
  "ui-wired",
  "document-integrated",
  "persistence-verified",
  "collaboration-verified",
  "browser-verified",
  "production-activated",
] as const satisfies readonly Exclude<StudioSection6DeliveryStage, "kernel-shipped">[];

export const STUDIO_DCC_SECTION6_CATALOG: readonly StudioSection6CatalogEntry[] = [
  { id: "DOC-001", name: "versioned `StudioDocument` schema", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["createStudioHybridDccSession"] },
  { id: "DOC-002", name: "Command transaction\u00b7Undo/Redo", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccUndo", "hybridDccRedo"] },
  { id: "DOC-003", name: "dependency graph\u00b7dirty propagation", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccPropagateDirty"] },
  { id: "DOC-004", name: "OPFS journal\u00b7checkpoint", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccRecoverFromJournal"] },
  { id: "DOC-005", name: "content-addressed asset store", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccContentAddressAsset"] },
  { id: "DOC-006", name: "autosave\u00b7manual milestone", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccAutosaveCheckpoint"] },
  { id: "DOC-007", name: "selective undo", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccSelectiveUndo"] },
  { id: "DOC-008", name: "Yjs scene/layer metadata CRDT", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-yjs-scene-metadata.ts", apis: ["createStudioDccYjsSceneMetadataDoc", "mergeStudioDccYjsSceneMetadata", "exerciseStudioDccYjsSceneMetadataConvergence", "snapshotStudioDccYjsSceneMetadata"] },
  { id: "DOC-009", name: "large binary lock/branch/merge", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["mergeStudioBinaryLockBranch"] },
  { id: "DOC-010", name: "review pin\u00b7status\u00b7approval", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["resolveStudioReviewPinApproval"] },
  { id: "DOC-011", name: "audit log\u00b7role permission", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["buildStudioAuditLogRolePermission"] },
  { id: "DOC-012", name: "Rights BOM", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-document.ts", apis: ["hybridDccRegisterAsset"] },
  { id: "DOC-013", name: "self-host/export CLI contract", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["parseStudioSelfHostExportCliContract"] },
  { id: "DOC-014", name: "offline queue\u00b7reconnect", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["flushStudioOfflineQueue"] },
  { id: "DOC-015", name: "corruption scanner\u00b7repair UI", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-hybrid-dcc-diagnostics.ts", apis: ["scanStudioHybridDccCorruption"] },
  { id: "MOD-001", name: "vertex/edge/face \uc120\ud0dd", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["selectStudioMeshElements"] },
  { id: "MOD-002", name: "loop/ring\u00b7shortest path", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["selectStudioMeshEdgeLoop", "selectStudioMeshFaceRing"] },
  { id: "MOD-003", name: "move/rotate/scale\u00b7pivot\u00b7orientation", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["transformStudioEditableMesh"] },
  { id: "MOD-004", name: "extrude region/individual", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["extrudeStudioEditableMeshFacesWithReceipt"] },
  { id: "MOD-005", name: "inset", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["insetStudioEditableMeshFaces"] },
  { id: "MOD-006", name: "bevel edge/vertex", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["bevelStudioEditableMeshEdges"] },
  { id: "MOD-007", name: "loop cut\u00b7slide", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["loopCutStudioEditableMesh"] },
  { id: "MOD-008", name: "knife\u00b7bisect", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["knifeStudioEditableMesh", "bisectStudioEditableMesh"] },
  { id: "MOD-009", name: "bridge\u00b7grid fill\u00b7hole fill", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["bridgeStudioFaceLoops"] },
  { id: "MOD-010", name: "merge/weld/dissolve", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["weldStudioEditableMesh", "dissolveStudioEditableMeshFaces"] },
  { id: "MOD-011", name: "normals\u00b7smooth group\u00b7crease", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["setStudioEditableMeshCrease"] },
  { id: "MOD-012", name: "Mirror", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-013", name: "Array", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-014", name: "Boolean", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-solid-boolean-backend.ts", apis: ["createStudioManifoldSolidBooleanBackend"] },
  { id: "MOD-015", name: "Solidify", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-016", name: "Bevel modifier", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-mesh-modifier-stack.ts", apis: ["evaluateStudioMeshModifierStack"] },
  { id: "MOD-017", name: "Subdivision", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["subdivideStudioMeshCatmullLite"] },
  { id: "MOD-018", name: "Decimate", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["decimateStudioMesh"] },
  { id: "MOD-019", name: "Weighted Normal/Weld", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["weldStudioEditableMesh"] },
  { id: "MOD-020", name: "Curve/Lattice/Simple Deform", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["deformStudioMeshBend"] },
  { id: "MOD-021", name: "Shrinkwrap", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["shrinkwrapStudioMesh"] },
  { id: "MOD-022", name: "Retopology snap", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["retopoSnapStudioMeshToPlane"] },
  { id: "MOD-023", name: "vertex group/selection set", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["createStudioVertexGroupSelectionSet"] },
  { id: "MOD-024", name: "non-manifold diagnostics", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["diagnoseStudioEditableMesh"] },
  { id: "MOD-025", name: "mesh repair", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["repairStudioMesh"] },
  { id: "BLD-001", name: "endpoint/midpoint/intersection snap", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-inference-snap.ts", apis: ["resolveStudioBuildInferenceSnap"] },
  { id: "BLD-002", name: "axis/parallel/perpendicular/tangent inference", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-inference-snap.ts", apis: ["cycleStudioInferenceAxisLock"] },
  { id: "BLD-003", name: "Push/Pull", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-bg3d-push-pull.ts", apis: ["planStudioBg3dPushPull"] },
  { id: "BLD-004", name: "Offset face/path", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-generators.ts", apis: ["offsetStudioFloorPlanPolygon"] },
  { id: "BLD-005", name: "Follow Me/Sweep", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["extrudeStudioCadProfile"] },
  { id: "BLD-006", name: "group/component/instance", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-component-instance-core.ts", apis: ["planStudioComponentMakeUnique"] },
  { id: "BLD-007", name: "tags/collections/outliner", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-tags-outliner.ts", apis: ["resolveStudioOutlinerVisibility"] },
  { id: "BLD-008", name: "section plane\u00b7cutaway", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["sectionPlaneCutawayStudioMeshVerts"] },
  { id: "BLD-009", name: "floor-plan to wall", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-generators.ts", apis: ["buildStudioWallsFromFloorPlan"] },
  { id: "BLD-010", name: "door/window opening", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-bg3d-room-builder.ts", apis: ["buildStudioBg3dRoomParts"] },
  { id: "BLD-011", name: "stair/ramp/railing generator", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-generators.ts", apis: ["generateStudioStairs"] },
  { id: "BLD-012", name: "ceiling/floor/trim", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-generators.ts", apis: ["generateStudioSlab"] },
  { id: "BLD-013", name: "road/sidewalk/lane generator", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["generateStudioRoadSidewalkLane"] },
  { id: "BLD-014", name: "fence/pole/tree scatter", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-procedural-scatter.ts", apis: ["scatterStudioInstances"] },
  { id: "BLD-015", name: "room template", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-bg3d-room-builder.ts", apis: ["getStudioBg3dRoomPreset"] },
  { id: "BLD-016", name: "measurement\u00b7dimension", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-build-generators.ts", apis: ["createStudioDimension"] },
  { id: "BLD-017", name: "component metadata", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["buildStudioComponentMetadata"] },
  { id: "BLD-018", name: "camera wall hiding", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-camera-wall-hide.ts", apis: ["resolveStudioCameraWallHide"] },
  { id: "BLD-019", name: "style presets", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["listStudioStylePresets"] },
  { id: "BLD-020", name: "plan/elevation/section view", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["listStudioPlanElevationSectionViews"] },
  { id: "CAD-001", name: "sketch line/arc/circle/ellipse/spline", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["exerciseStudioCad001SketchPrimitives", "addStudioCadSketchCurve", "trimStudioCadLine", "extendStudioCadLine"] },
  { id: "CAD-002", name: "geometric constraints", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["diagnoseStudioCadConstraints", "buildStudioCadRectangleSketch"] },
  { id: "CAD-003", name: "dimensional constraints", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["buildStudioCadRectangleSketch"] },
  { id: "CAD-004", name: "under/fully/over-constrained diagnostics", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["diagnoseStudioCadConstraints"] },
  { id: "CAD-005", name: "extrude/revolve", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["extrudeStudioCadProfile", "revolveStudioCadProfile"] },
  { id: "CAD-006", name: "sweep/loft", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["sweepStudioCadProfile", "loftStudioCadProfiles"] },
  { id: "CAD-007", name: "fillet/chamfer", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["chamferStudioCadCorner2d"] },
  { id: "CAD-008", name: "shell/draft", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["shellDraftStudioCadExtrusion"] },
  { id: "CAD-009", name: "pattern/mirror", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["patternMirrorStudioCadPoints"] },
  { id: "CAD-010", name: "datum plane/axis/coordinate system", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["createStudioCadDatumPlaneAxisCsys"] },
  { id: "CAD-011", name: "feature history tree", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["orderStudioCadFeatureTree"] },
  { id: "CAD-012", name: "assembly mate lite", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["solveStudioCadAssemblyMates"] },
  { id: "CAD-013", name: "configuration/variant", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["configureStudioCadVariant"] },
  { id: "CAD-014", name: "exact measure/mass property", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["measureStudioCadExtrusion"] },
  { id: "CAD-015", name: "STEP/IGES/BREP import/export", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cad-kernel-lite.ts", apis: ["exportStudioCadStepAscii", "importStudioStepShell"] },
  { id: "CAD-016", name: "Rhino 3DM openNURBS full NURBS eval", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-rhino3dm-nurbs.ts", apis: ["evaluateStudioNurbsCurve", "evaluateStudioNurbsSurfaceSuite", "parseStudioRhino3dmOpenNurbs"] },
  { id: "CAD-017", name: "DXF plan import/export", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioDxfPlan"] },
  { id: "CAD-018", name: "IFC city/building body (web-ifc)", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-web-ifc-city.ts", apis: ["importStudioIfcCity", "createStudioIfcCityFixture"] },
  { id: "CAD-019", name: "BIM→Room Builder mapping", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-bim-room-builder-map.ts", apis: ["mapStudioBimIfcToRoomBuilder"] },
  { id: "CAD-020", name: "drawing sheet/BOM lite", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["buildStudioDrawingSheetBomLite"] },
  { id: "SCP-001", name: "grab/smooth/inflate/clay/crease", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["applyStudioSculptStroke", "workspaceSculptActive"] },
  { id: "SCP-002", name: "mask/invert/blur/grow/shrink", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["createStudioSculptMask"] },
  { id: "SCP-003", name: "symmetry/radial symmetry", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["applyStudioSculptSymmetryRadial"] },
  { id: "SCP-004", name: "face set/polygroup", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["assignStudioSculptFaceSetPolygroup"] },
  { id: "SCP-005", name: "voxel remesh", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["voxelRemeshStudioMesh"] },
  { id: "SCP-006", name: "dynamic topology", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["dynatopoStudioMeshBrushLocal"] },
  { id: "SCP-007", name: "multires subdivision levels", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["subdivideStudioMeshCatmullLite"] },
  { id: "SCP-008", name: "polypaint/material paint", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["polypaintStudioMesh"] },
  { id: "SCP-009", name: "alpha/stamp/texture brush", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["applyStudioSculptStroke"] },
  { id: "SCP-010", name: "project detail", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["subdivideStudioMeshCatmullLite", "shrinkwrapStudioMesh"] },
  { id: "SCP-011", name: "automatic retopo basic", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["autoRetopoStudioMeshBasic"] },
  { id: "SCP-012", name: "manual quad retopo", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-editable-half-edge-mesh.ts", apis: ["createStudioEditableMeshFromPolygons"] },
  { id: "SCP-013", name: "UV unwrap/pack", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-uv-unwrap-lite.ts", apis: ["unwrapStudioMeshBox", "packStudioUvIslands"] },
  { id: "SCP-014", name: "normal/AO/curvature/ID bake", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["bakeStudioMeshMaps"] },
  { id: "SCP-015", name: "proxy/high-res link", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-mesh-ops-advanced.ts", apis: ["subdivideStudioMeshCatmullLite"] },
  { id: "CHR-001", name: "glTF/VRM import", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-grade-a-import-pipeline.ts", apis: ["importStudioGradeAAsset"] },
  { id: "CHR-002", name: "humanoid bone mapping", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["diagnoseStudioHumanoidMapping"] },
  { id: "CHR-003", name: "IK/FK body posing", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-ik-fk.ts", apis: ["poseStudioBodyChainIk", "poseStudioBodyChainFk"] },
  { id: "CHR-004", name: "joint limit\u00b7preferred pose", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-animation-p2.ts", apis: ["clampStudioJointRotation"] },
  { id: "CHR-005", name: "ground/seat/wall contact", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["resolveStudioGroundSeatWallContact"] },
  { id: "CHR-006", name: "two-character interaction", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["planStudioTwoCharacterInteraction"] },
  { id: "CHR-007", name: "hand pose library", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["mirrorStudioHandPose"] },
  { id: "CHR-008", name: "facial expression mixer", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["mixStudioExpressions"] },
  { id: "CHR-009", name: "lookAt/gaze", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioLookAt"] },
  { id: "CHR-010", name: "spring bone preview", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-animation-p2.ts", apis: ["stepStudioSpringBone"] },
  { id: "CHR-011", name: "animation clip library", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-animation-p2.ts", apis: ["createStudioIdleClip", "sampleStudioAnimationClip"] },
  { id: "CHR-012", name: "retarget FBX/BVH/VRMA", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-animation-p2.ts", apis: ["retargetStudioMotionReport"] },
  { id: "CHR-013", name: "pose capture", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-ik-fk.ts", apis: ["createStudioDefaultBodyPose"] },
  { id: "CHR-014", name: "animation curve editor", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["sampleStudioAnimationCurveLite"] },
  { id: "CHR-015", name: "onion/ghost pose", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-character-animation-p2.ts", apis: ["diffStudioPoses"] },
  { id: "CHR-016", name: "body proportion control", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["scaleStudioBodyProportion"] },
  { id: "CHR-017", name: "character variant", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["createStudioCharacterVariant"] },
  { id: "CHR-018", name: "pose asset metadata", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioPoseAssetMetadata"] },
  { id: "CHR-019", name: "MToon/PBR material bridge", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["bridgeStudioMtoonPbr"] },
  { id: "CHR-020", name: "VRM export", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["exportStudioVrmLite"] },
  { id: "GAR-001", name: "2D pattern editor", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["createStudioClothPatternPanel"] },
  { id: "GAR-002", name: "seam pairing/direction", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["validateStudioClothSeam", "createStudioClothPatternPanel"] },
  { id: "GAR-003", name: "arrangement on avatar", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["arrangeStudioGarmentOnAvatar"] },
  { id: "GAR-004", name: "fabric presets", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["listStudioFabricPresets"] },
  { id: "GAR-005", name: "XPBD cloth simulation", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["stepStudioClothXpbd", "workspaceClothStep"] },
  { id: "GAR-006", name: "avatar collision proxy", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["buildStudioAvatarCollisionProxy"] },
  { id: "GAR-007", name: "pin/tack/freeze", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["pinStudioClothParticles", "createStudioClothGrid"] },
  { id: "GAR-008", name: "pose-resimulation", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-cloth-pattern-kernel.ts", apis: ["stepStudioClothXpbd", "createStudioClothGrid"] },
  { id: "GAR-009", name: "garment skinning bake", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["bakeStudioGarmentSkinning"] },
  { id: "GAR-010", name: "animation cloth cache", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["cacheStudioAnimationCloth"] },
  { id: "GAR-011", name: "garment layer/order", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["orderStudioGarmentLayers"] },
  { id: "GAR-012", name: "retopo/UV transfer", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-uv-unwrap-lite.ts", apis: ["unwrapStudioMeshBox"] },
  { id: "GAR-013", name: "DXF/AAMA pattern bridge", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["bridgeStudioDxfAamaPattern"] },
  { id: "GAR-014", name: "CLO/Marvelous bridge", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["bridgeStudioCloMarvelous"] },
  { id: "GAR-015", name: "comic wrinkle exaggeration", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["exaggerateStudioComicWrinkle"] },
  { id: "MAT-001", name: "PBR metallic-roughness", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioPbrMaterialLite"] },
  { id: "MAT-002", name: "MToon/toon material", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioMtoonMaterialLite"] },
  { id: "MAT-003", name: "material override by Shot", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["overrideStudioMaterialByShot"] },
  { id: "MAT-004", name: "UV seam/unwrap/pack", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-uv-unwrap-lite.ts", apis: ["unwrapStudioMeshBox", "unwrapStudioMeshPlanar"] },
  { id: "MAT-005", name: "texture paint on 3D", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-hybrid-sculpt-kernel.ts", apis: ["polypaintStudioMesh"] },
  { id: "MAT-006", name: "decal/sticker/poster", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["createStudioDecalPlacement"] },
  { id: "MAT-007", name: "procedural noise/pattern", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["generateStudioProceduralNoisePattern"] },
  { id: "MAT-008", name: "MaterialX import", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["importStudioMaterialXLite"] },
  { id: "MAT-009", name: "KTX2 derivative", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-character-pose-p1.ts", apis: ["studioKtx2DerivativeForProfile"] },
  { id: "MAT-010", name: "color management", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["resolveStudioColorManagementProfile"] },
  { id: "MAT-011", name: "atlas/texture set", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["packStudioAtlasTextureSet"] },
  { id: "MAT-012", name: "toon hatch/tone material", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioToonHatchToneMaterial"] },
  { id: "PRC-001", name: "typed node graph", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["evaluateStudioTypedNodeGraph"] },
  { id: "PRC-002", name: "instance/scatter", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-procedural-scatter.ts", apis: ["scatterStudioInstances"] },
  { id: "PRC-003", name: "cloner/effectors/fields", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-procedural-scatter.ts", apis: ["applyStudioClonerField", "scatterStudioInstances"] },
  { id: "PRC-004", name: "curve sweep/array", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-procedural-scatter.ts", apis: ["arrayStudioAlongCurve"] },
  { id: "PRC-005", name: "room/building generators", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-bg3d-room-builder.ts", apis: ["buildStudioBg3dRoomParts"] },
  { id: "PRC-006", name: "cache/bake/freeze", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["freezeStudioProceduralCacheBake"] },
  { id: "PRC-007", name: "custom script sandbox", priority: "P4", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["runStudioCustomScriptSandbox"] },
  { id: "PRC-008", name: "reusable generator asset", priority: "P3", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["registerStudioReusableGeneratorAsset"] },
  { id: "SHT-001", name: "multi-shot camera", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-live-2d3d-bridge.ts", apis: ["createStudioLiveBridgeDocument"] },
  { id: "SHT-002", name: "camera lens/sensor/ortho", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-shot-continuity.ts", apis: ["studioCameraFovY"] },
  { id: "SHT-003", name: "Shot Override", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-live-2d3d-bridge.ts", apis: ["applyStudioShotOverride"] },
  { id: "SHT-004", name: "continuity compare", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-shot-continuity.ts", apis: ["diffStudioShotContinuity"] },
  { id: "SHT-005", name: "camera collision/wall hide", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-camera-wall-hide.ts", apis: ["resolveStudioCameraWallHide"] },
  { id: "SHT-006", name: "storyboard/animatic", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-shot-continuity.ts", apis: ["buildStudioAnimaticTimeline"] },
  { id: "NPR-001", name: "depth/normal/object/material ID", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-live-2d3d-bridge.ts", apis: ["generateStudioToonPass"] },
  { id: "NPR-002", name: "silhouette/crease/boundary", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["extractStudioSilhouetteCreaseBoundary"] },
  { id: "NPR-003", name: "intersection/contact line", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["detectStudioIntersectionContactLine"] },
  { id: "NPR-004", name: "tone/shadow region", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-live-2d3d-bridge.ts", apis: ["generateStudioToonPass"] },
  { id: "NPR-005", name: "batch render by Shot", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-live-2d3d-bridge.ts", apis: ["generateStudioToonPass"] },
  { id: "NPR-006", name: "linked vector line", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-artist-correction-delta.ts", apis: ["appendStudioArtistCorrection"] },
  { id: "NPR-007", name: "line cleanup", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-domain-ops.ts", apis: ["cleanupStudioNprLine"] },
  { id: "NPR-008", name: "artist correction delta", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-artist-correction-delta.ts", apis: ["reprojectStudioArtistCorrections", "appendStudioArtistCorrection"] },
  { id: "DRW-001", name: "low-latency pressure brush", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["planStudioPressureBrushStroke", "measureStudioBrushLatencyBudget"] },
  { id: "DRW-002", name: "raster/vector layers", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioRasterVectorLayerStack", "transformStudioLayer"] },
  { id: "DRW-003", name: "fill/close gap/reference layer", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["fillStudioCloseGapRegion", "bindStudioReferenceLayer"] },
  { id: "DRW-004", name: "perspective/ruler", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioPerspectiveRuler", "snapStudioRulerGuide"] },
  { id: "DRW-005", name: "panels/balloons/text", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["createStudioPanelBalloonTextLayout"] },
  { id: "DRW-006", name: "tone/filter/adjustment", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["applyStudioToneFilterAdjustment"] },
  { id: "DRW-007", name: "PSD/PSB import/export", priority: "P0", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["importStudioPsdPsbHeader", "exportStudioPsdPsbLite", "reportStudioPsdPsbCompatibility"] },
  { id: "PUB-001", name: "Publish Package", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["buildStudioPublishPackageLite"] },
  { id: "PUB-002", name: "platform presets", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-publish-package.ts", apis: ["getStudioPublishPlatformPreset"] },
  { id: "PUB-003", name: "asset/license report", priority: "P1", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["buildStudioAssetLicenseReport"] },
  { id: "PUB-004", name: "archive export", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-dcc-material-publish-draw-lite.ts", apis: ["buildStudioPublishVersionManifest"] },
  { id: "FMT-FBX", name: "FBX import (ASCII+binary mesh lite)", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-fbx-ascii-import.ts", apis: ["importStudioFbxDocument", "parseStudioFbxBinaryMeshLite", "sniffStudioFbxBinaryHeader"] },
  { id: "FMT-IFC", name: "IFC import shell+semantic mesh", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioIfcShell"] },
  { id: "FMT-STEP", name: "STEP/IGES import shell+mesh", priority: "P2", kernelStatus: "kernel-shipped", module: "studio-mesh-format-adapters.ts", apis: ["importStudioStepShell"] },
] as const;

export const STUDIO_DCC_SECTION6_IDS = STUDIO_DCC_SECTION6_CATALOG.map((e) => e.id);

/**
 * Conservative delivery view. A kernel fixture is not evidence for any product
 * stage; each later stage must be promoted by its own vertical integration gate.
 */
export const STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS:
readonly StudioSection6DeliveryAssessment[] = STUDIO_DCC_SECTION6_CATALOG.map((entry) => ({
  id: entry.id,
  verifiedStages: entry.kernelStatus === "kernel-shipped" ? ["kernel-shipped"] : [],
  unverifiedStages: [...STUDIO_SECTION6_PRODUCT_STAGES],
}));

export function studioSection6ById(id: string): StudioSection6CatalogEntry | null {
  return STUDIO_DCC_SECTION6_CATALOG.find((e) => e.id === id) ?? null;
}

export function studioSection6DeliveryById(
  id: string,
): StudioSection6DeliveryAssessment | null {
  return STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS.find((entry) => entry.id === id) ?? null;
}

export function assertStudioSection6FullCoverage(): { readonly ok: boolean; readonly missing: readonly string[]; readonly withoutApis: readonly string[] } {
  const missing: string[] = [];
  const withoutApis: string[] = [];
  for (const e of STUDIO_DCC_SECTION6_CATALOG) {
    if (!e.id) missing.push("(empty)");
    if (!e.apis.length) withoutApis.push(e.id);
    if (
      e.kernelStatus !== "kernel-shipped"
      && e.kernelStatus !== "partial"
      && e.kernelStatus !== "bridge-only"
    ) missing.push(e.id);
    if (e.kernelStatus === "partial" && !e.ceilingNote) withoutApis.push(`${e.id}:no-ceiling`);
  }
  return { ok: missing.length === 0 && withoutApis.length === 0, missing, withoutApis };
}

export function studioSection6CoverageStats(): {
  readonly total: number;
  readonly kernelShipped: number;
  readonly partial: number;
  readonly bridgeOnly: number;
  readonly productionActivated: number;
} {
  let kernelShipped = 0; let partial = 0; let bridgeOnly = 0;
  for (const e of STUDIO_DCC_SECTION6_CATALOG) {
    if (e.kernelStatus === "kernel-shipped") kernelShipped += 1;
    else if (e.kernelStatus === "partial") partial += 1;
    else if (e.kernelStatus === "bridge-only") bridgeOnly += 1;
  }
  const productionActivated = STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS.filter(
    (entry) => entry.verifiedStages.includes("production-activated"),
  ).length;
  return {
    total: STUDIO_DCC_SECTION6_CATALOG.length,
    kernelShipped,
    partial,
    bridgeOnly,
    productionActivated,
  };
}
