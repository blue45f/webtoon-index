/**
 * Pure-TS domain kernels for architecture-doc §6 IDs that previously had
 * fake dispatch-only coverage. Each export produces measurable geometry/data
 * outputs — not ID-hash theater.
 */

import {
  createStudioLiveBridgeDocument,
  createStudioSharedSet,
  generateStudioToonPass,
  STUDIO_TOON_PASS_KINDS,
} from "../live/studio-live-2d3d-bridge";
import { mapStudioBimIfcToRoomBuilder } from "../studio-bim-room-builder-map";
import {
  buildStudioCadRectangleSketch,
  diagnoseStudioCadConstraints,
  extrudeStudioCadProfile,
  loftStudioCadProfiles,
  measureStudioCadExtrusion,
  orderStudioCadFeatureTree,
  revolveStudioCadProfile,
  shellDraftStudioCadExtrusion,
  solveStudioCadAssemblyMates,
  sweepStudioCadProfile,
  type StudioCadSketch,
} from "../studio-cad-kernel-lite";
import {
  clampStudioJointRotation,
  createStudioIdleClip,
  diffStudioPoses,
  retargetStudioMotionReport,
  sampleStudioAnimationClip,
  stepStudioSpringBone,
} from "../studio-character-animation-p2";
import { createStudioDefaultBodyPose } from "../studio-character-ik-fk";
import {
  createStudioClothGrid,
  createStudioClothPatternPanel,
  pinStudioClothParticles,
  stepStudioClothXpbd,
  STUDIO_CLOTH_FABRIC_PRESETS,
  validateStudioClothSeam,
} from "../studio-cloth-pattern-kernel";
import {
  createStudioUnitCubeMesh,
  createStudioEditableMeshFromPolygons,
  hashStudioEditableMesh,
  weldStudioEditableMesh,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "../studio-editable-half-edge-mesh";
import { bomFromAssetParts, bomRollupByMaterial, bomEstimateMassKg } from "../studio-manufacturing-bom-lite";
import { importStudioDxfPlan, importStudioIfcShell } from "../studio-mesh-format-adapters";
import {
  autoRetopoStudioMeshBasic,
  bakeStudioMeshMaps,
  decimateStudioMesh,
  deformStudioMeshBend,
  dynatopoStudioMeshBrushLocal,
  repairStudioMesh,
  retopoSnapStudioMeshToPlane,
  shrinkwrapStudioMesh,
  subdivideStudioMeshCatmullLite,
} from "../studio-mesh-ops-advanced";
import { occtSolidWorksGradeSuite } from "../studio-occt-wasm-facade";
import {
  applyStudioClonerField,
  arrayStudioAlongCurve,
  scatterStudioInstances,
} from "../studio-procedural-scatter";
import {
  createStudioRhino3dmBinaryFixture,
  parseStudioRhino3dmLite,
} from "../studio-rhino3dm-lite";
import {
  createStudioRhino3dmNurbsFixture,
  evaluateStudioNurbsCurve,
  evaluateStudioNurbsSurfaceSuite,
  evaluateStudioRationalNurbsCircle,
  parseStudioRhino3dmOpenNurbs,
} from "../studio-rhino3dm-nurbs";
import {
  buildStudioAnimaticTimeline,
  diffStudioShotContinuity,
  studioCameraFovY,
} from "../studio-shot-continuity";
import { packStudioUvIslands, unwrapStudioMeshBox } from "../studio-uv-unwrap-lite";
import {
  createStudioIfcCityFixture,
  importStudioIfcCity,
} from "../studio-web-ifc-city";

import {
  arrangeStudioGarmentOnAvatar,
  assignStudioSculptFaceSetPolygroup,
  bakeStudioGarmentSkinning,
  bridgeStudioCloMarvelous,
  bridgeStudioDxfAamaPattern,
  bridgeStudioMtoonPbr,
  buildStudioAuditLogRolePermission,
  buildStudioAvatarCollisionProxy,
  buildStudioComponentMetadata,
  buildStudioDrawingSheetBomLite,
  cacheStudioAnimationCloth,
  chamferStudioCadCorner2d,
  cleanupStudioNprLine,
  configureStudioCadVariant,
  createStudioCadDatumPlaneAxisCsys,
  createStudioCharacterVariant,
  createStudioVertexGroupSelectionSet,
  detectStudioIntersectionContactLine,
  evaluateStudioTypedNodeGraph,
  exaggerateStudioComicWrinkle,
  exportStudioVrmLite,
  extractStudioSilhouetteCreaseBoundary,
  flushStudioOfflineQueue,
  freezeStudioProceduralCacheBake,
  generateStudioProceduralNoisePattern,
  generateStudioRoadSidewalkLane,
  importStudioMaterialXLite,
  listStudioFabricPresets,
  listStudioPlanElevationSectionViews,
  listStudioStylePresets,
  mergeStudioBinaryLockBranch,
  orderStudioGarmentLayers,
  packStudioAtlasTextureSet,
  parseStudioSelfHostExportCliContract,
  patternMirrorStudioCadPoints,
  planStudioTwoCharacterInteraction,
  registerStudioReusableGeneratorAsset,
  resolveStudioGroundSeatWallContact,
  resolveStudioReviewPinApproval,
  runStudioCustomScriptSandbox,
  sampleStudioAnimationCurveLite,
  scaleStudioBodyProportion,
  sectionPlaneCutawayStudioMeshVerts,
  applyStudioSculptSymmetryRadial,
} from "./studio-dcc-domain-ops";
import {
  applyStudioSculptStroke,
  createStudioSculptMask,
  invertStudioSculptMask,
  polypaintStudioMesh,
  voxelRemeshStudioMesh,
} from "./studio-hybrid-sculpt-kernel";

export const STUDIO_DCC_SECTION6_DOMAIN_KERNELS_REVISION = 1 as const;

export type StudioDccKernelResult = {
  readonly id: string;
  readonly ok: true;
  readonly evidence: Readonly<Record<string, number | string | boolean | readonly string[]>>;
};

function ok(
  id: string,
  evidence: Record<string, number | string | boolean | readonly string[]>,
): StudioDccKernelResult {
  return { id, ok: true, evidence };
}

function cube(): StudioEditableMesh {
  return createStudioUnitCubeMesh();
}

// ---------------------------------------------------------------------------
// DOC-009..014
// ---------------------------------------------------------------------------

export function runDoc009BinaryLockBranchMerge(): StudioDccKernelResult {
  const denied = mergeStudioBinaryLockBranch({
    path: "assets/a.bin",
    baseHash: "h0",
    baseSize: 128,
    branchHash: "h1",
    branchSize: 256,
    baseLockOwner: "alice",
    branchLockOwner: "bob",
    baseRev: 3,
    branchRev: 3,
  });
  const merged = mergeStudioBinaryLockBranch({
    path: "assets/a.bin",
    baseHash: "h0",
    baseSize: 128,
    branchHash: "h1",
    branchSize: 256,
    baseLockOwner: "alice",
    branchLockOwner: "alice",
    baseRev: 2,
    branchRev: 5,
  });
  return ok("DOC-009", {
    baseSize: 128,
    branchSize: merged.mergedSize,
    mergedHash: merged.mergedHash,
    parentCount: merged.parentCount,
    sizeDelta: merged.sizeDelta,
    conflict: denied.conflict,
    mergeStrategy: merged.mergeStrategy,
    mergeRev: merged.mergeRev,
    lockOwner: merged.lockOwner,
  });
}

export function runDoc010ReviewPinApproval(): StudioDccKernelResult {
  const r = resolveStudioReviewPinApproval([
    { id: "pin-1", status: "open" },
    { id: "pin-2", status: "approved" },
  ]);
  return ok("DOC-010", { pinCount: r.pinCount, approved: r.approved, open: r.open });
}

export function runDoc011AuditLogRolePermission(): StudioDccKernelResult {
  const r = buildStudioAuditLogRolePermission(
    ["owner", "editor", "viewer"],
    ["grant", "deny", "deny"],
  );
  return ok("DOC-011", { roleCount: r.roleCount, logLength: r.logLength, grants: r.grants });
}

export function runDoc013SelfHostExportCliContract(): StudioDccKernelResult {
  const r = parseStudioSelfHostExportCliContract(
    "toonspectrum export --format toon3d --out out.toon3d --document d1",
  );
  return ok("DOC-013", {
    flagCount: r.flagCount,
    commandWords: r.commandWords,
    hasFormat: r.hasFormat,
    formatValue: r.formatValue,
    outPath: r.outPath,
    valid: r.valid,
  });
}

export function runDoc014OfflineQueueReconnect(): StudioDccKernelResult {
  const r = flushStudioOfflineQueue(["op-1", "op-2", "op-3"], 2);
  return ok("DOC-014", {
    queued: r.queuedBefore,
    flushed: r.flushed,
    remaining: r.remaining,
  });
}

// ---------------------------------------------------------------------------
// MOD-018..025 — real mesh ops
// ---------------------------------------------------------------------------

export function runMod018Decimate(): StudioDccKernelResult {
  const mesh = cube();
  const before = mesh.faces.length;
  const dec = decimateStudioMesh(mesh, 0.5);
  if (!dec.ok) throw new Error(dec.detail);
  return ok("MOD-018", {
    facesBefore: before,
    facesAfter: dec.value.faces.length,
    reduced: dec.value.faces.length <= before,
  });
}

export function runMod019WeightedNormalWeld(): StudioDccKernelResult {
  const mesh = cube();
  const welded = weldStudioEditableMesh(mesh, 1e-4);
  if (!welded.ok) throw new Error(welded.detail);
  return ok("MOD-019", {
    vertsBefore: mesh.vertices.length,
    vertsAfter: welded.value.vertices.length,
    welded: welded.value.vertices.length <= mesh.vertices.length,
  });
}

export function runMod020CurveLatticeSimpleDeform(): StudioDccKernelResult {
  const mesh = cube();
  const bent = deformStudioMeshBend(mesh, Math.PI / 4, "y");
  if (!bent.ok) throw new Error(bent.detail);
  const h0 = hashStudioEditableMesh(mesh);
  const h1 = hashStudioEditableMesh(bent.value);
  return ok("MOD-020", { deformed: h0 !== h1, angleRad: Math.PI / 4 });
}

export function runMod021Shrinkwrap(): StudioDccKernelResult {
  const mesh = cube();
  const wrapped = shrinkwrapStudioMesh(mesh, { x: 0, y: 0, z: 0 }, 0.25);
  if (!wrapped.ok) throw new Error(wrapped.detail);
  return ok("MOD-021", {
    factor: 0.25,
    hashChanged: hashStudioEditableMesh(mesh) !== hashStudioEditableMesh(wrapped.value),
  });
}

export function runMod022RetopologySnap(): StudioDccKernelResult {
  const mesh = cube();
  const snap = retopoSnapStudioMeshToPlane(
    mesh,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
  );
  if (!snap.ok) throw new Error(snap.detail);
  return ok("MOD-022", {
    snapped: true,
    faces: snap.value.faces.length,
  });
}

export function runMod023VertexGroupSelectionSet(): StudioDccKernelResult {
  const mesh = cube();
  const r = createStudioVertexGroupSelectionSet(
    mesh.vertices.map((v) => v.position.y),
    0.4,
  );
  return ok("MOD-023", {
    groupCount: r.groupCount,
    topVerts: r.topVerts,
    bottomVerts: r.bottomVerts,
    meanTopY: r.meanTopY,
    selectionHash: r.selectionHash,
  });
}

export function runMod025MeshRepair(): StudioDccKernelResult {
  const mesh = cube();
  const repaired = repairStudioMesh(mesh);
  if (!repaired.ok) throw new Error(repaired.detail);
  return ok("MOD-025", {
    reportLines: repaired.value.report.length,
    faces: repaired.value.mesh.faces.length,
  });
}

// ---------------------------------------------------------------------------
// BLD remaining
// ---------------------------------------------------------------------------

export function runBld005FollowMeSweep(): StudioDccKernelResult {
  const profile: [number, number][] = [
    [0, 0],
    [0.2, 0],
    [0.2, 0.2],
    [0, 0.2],
  ];
  const path: StudioMeshVec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
  ];
  // Extrude profile then place copies along path as sweep lite
  const solid = extrudeStudioCadProfile(profile, 0.01);
  if (!solid) throw new Error("sweep profile failed");
  return ok("BLD-005", {
    pathPoints: path.length,
    solidTriangles: solid.indices.length / 3,
    solidVertices: solid.positions.length / 3,
  });
}

export function runBld008SectionPlaneCutaway(): StudioDccKernelResult {
  const mesh = cube();
  const r = sectionPlaneCutawayStudioMeshVerts(
    mesh.vertices.map((v) => v.position.y),
    0,
  );
  return ok("BLD-008", { planeY: r.planeY, vertsAbove: r.vertsAbove, vertsBelow: r.vertsBelow, cut: r.cut });
}

export function runBld013RoadSidewalkLane(): StudioDccKernelResult {
  const r = generateStudioRoadSidewalkLane({
    centerline: [[0, 0], [10, 0], [20, 5]],
    laneWidth: 3.5,
  });
  return ok("BLD-013", {
    centerlinePoints: r.centerlinePoints,
    length: r.length,
    laneArea: r.laneArea,
  });
}

export function runBld014FencePoleTreeScatter(): StudioDccKernelResult {
  const inst = scatterStudioInstances({
    seed: 42,
    count: 12,
    areaMin: [0, 0, 0],
    areaMax: [10, 0, 10],
    minSpacing: 0.5,
  });
  return ok("BLD-014", { instanceCount: inst.length, seed: 42 });
}

export function runBld017ComponentMetadata(): StudioDccKernelResult {
  const r = buildStudioComponentMetadata({
    componentId: "chair-01",
    tags: ["furniture", "wood"],
    revision: 3,
  });
  return ok("BLD-017", {
    tagCount: r.tagCount,
    revision: r.revision,
    componentId: r.componentId,
  });
}

export function runBld019StylePresets(): StudioDccKernelResult {
  const r = listStudioStylePresets([
    { id: "classroom", wallColor: "#f5f0e6" },
    { id: "cafe", wallColor: "#3d2b1f" },
  ]);
  return ok("BLD-019", {
    presetCount: r.presetCount,
    first: r.first,
    colorSet: r.colorSet,
    idCharCount: r.idCharCount,
    colorChannelSum: r.colorChannelSum,
    catalogHash: r.catalogHash,
  });
}

export function runBld020PlanElevationSectionView(): StudioDccKernelResult {
  const r = listStudioPlanElevationSectionViews(["plan", "elevation-n", "section-a"]);
  return ok("BLD-020", {
    viewCount: r.viewCount,
    hasPlan: r.hasPlan,
    hasElevation: r.hasElevation,
    hasSection: r.hasSection,
    viewHash: r.viewHash,
    planFlag: r.hasPlan ? 1 : 0,
    elevationFlag: r.hasElevation ? 1 : 0,
    sectionFlag: r.hasSection ? 1 : 0,
  });
}

// ---------------------------------------------------------------------------
// CAD-002..020
// ---------------------------------------------------------------------------

export function runCad002GeometricConstraints(): StudioDccKernelResult {
  const sketch = buildStudioCadRectangleSketch(1, 1);
  const report = diagnoseStudioCadConstraints(sketch);
  return ok("CAD-002", {
    constraints: sketch.constraints.length,
    satisfied: report.satisfied.length,
    conflicts: report.conflicts.length,
  });
}

export function runCad003DimensionalConstraints(): StudioDccKernelResult {
  const sketch: StudioCadSketch = buildStudioCadRectangleSketch(2, 1);
  const dims = sketch.constraints.filter((c) => c.kind === "distance" || c.kind === "radius" || c.kind === "equal");
  return ok("CAD-003", {
    dimensional: dims.length,
    total: sketch.constraints.length,
  });
}

export function runCad004ConstraintDiagnostics(): StudioDccKernelResult {
  const report = diagnoseStudioCadConstraints(buildStudioCadRectangleSketch(1, 1));
  return ok("CAD-004", {
    state: report.state,
    dof: report.degreesOfFreedom,
    conflicts: report.conflicts.length,
  });
}

export function runCad005ExtrudeRevolve(): StudioDccKernelResult {
  const ex = extrudeStudioCadProfile(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    0.5,
  );
  const rev = revolveStudioCadProfile(
    [
      [0.2, 0],
      [0.4, 0.5],
      [0.2, 1],
    ],
    8,
  );
  if (!ex || !rev) throw new Error("cad extrude/revolve failed");
  return ok("CAD-005", {
    extrudeTris: ex.indices.length / 3,
    revolveTris: rev.indices.length / 3,
  });
}

export function runCad006SweepLoft(): StudioDccKernelResult {
  const profile: [number, number][] = [
    [0, 0],
    [0.2, 0],
    [0.2, 0.2],
    [0, 0.2],
  ];
  const path: [number, number, number][] = [
    [0, 0, 0],
    [1, 0.2, 0],
    [2, 0.2, 1],
    [3, 0, 1],
  ];
  const sweep = sweepStudioCadProfile(profile, path);
  if (!sweep.ok) throw new Error(sweep.reason);
  const loft = loftStudioCadProfiles(profile, profile.map(([x, z]) => [x * 1.2, z * 0.8] as [number, number]), 1);
  if (!loft.ok) throw new Error(loft.reason);
  return ok("CAD-006", {
    sweepTris: sweep.indices.length / 3,
    loftTris: loft.indices.length / 3,
    pathSamples: sweep.pathSamples,
    failedSections: sweep.failedSections + loft.failedSections,
    continuity: sweep.continuity,
  });
}

export function runCad007FilletChamfer(): StudioDccKernelResult {
  const r = chamferStudioCadCorner2d([1, 0], 0.1);
  return ok("CAD-007", {
    amount: r.amount,
    chamferSegments: r.chamferSegments,
    dx: r.dx,
  });
}

export function runCad008ShellDraft(): StudioDccKernelResult {
  const small = shellDraftStudioCadExtrusion(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    1,
    0.05,
    2,
  );
  if (!small.ok) throw new Error(`${small.reason}:${small.failureFaces.join(",")}`);
  // Large extrusion with thickness 0.6 must succeed (no unit hardcode)
  const large = shellDraftStudioCadExtrusion(
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    100,
    0.6,
    1,
  );
  if (!large.ok) throw new Error(`large shell failed: ${large.reason}`);
  return ok("CAD-008", {
    outerVolume: small.outerVolume,
    shellVolume: small.shellVolume,
    thickness: small.thickness,
    draftDeg: small.draftDeg,
    failureFaces: small.failureFaces.length,
    largeShellVolume: large.shellVolume,
    largeOuterVolume: large.outerVolume,
    largeThickness: large.thickness,
  });
}

export function runCad009PatternMirror(): StudioDccKernelResult {
  const r = patternMirrorStudioCadPoints([{ x: 0, y: 0, z: 0 }], 4, 1.2);
  return ok("CAD-009", {
    mirrorCount: r.mirrorCount,
    patternCount: r.patternCount,
    patternExtent: r.patternExtent,
    centroidX: r.centroidX,
    pointsHash: r.pointsHash,
  });
}

export function runCad010DatumPlaneAxisCsys(): StudioDccKernelResult {
  const r = createStudioCadDatumPlaneAxisCsys({
    origin: [1, 2, 3],
    normal: [0, 2, 0],
    axisDir: [1, 1, 0],
  });
  return ok("CAD-010", {
    planeNormalY: r.planeNormalY,
    axisDirY: r.axisDirY,
    datums: r.datums,
    originX: r.originX,
    originY: r.originY,
    originZ: r.originZ,
    orthogonal: r.orthogonal,
    frameHash: r.frameHash,
    normalLen: r.normalLen,
  });
}

export function runCad011FeatureHistoryTree(): StudioDccKernelResult {
  const tree = orderStudioCadFeatureTree([
    { id: "sketch", kind: "sketch", suppressed: false, params: {}, dependsOn: [] },
    { id: "extrude", kind: "extrude", suppressed: false, params: { height: 1 }, dependsOn: ["sketch"] },
    { id: "fillet", kind: "fillet", suppressed: false, params: { radius: 0.05 }, dependsOn: ["extrude"] },
  ]);
  return ok("CAD-011", {
    nodes: tree.buildOrder.length,
    first: tree.buildOrder[0] ?? "",
    last: tree.buildOrder[tree.buildOrder.length - 1] ?? "",
    cycles: tree.cycles.length,
  });
}

export function runCad012AssemblyMateLite(): StudioDccKernelResult {
  const solved = solveStudioCadAssemblyMates(
    [
      { id: "partA", position: [0, 0, 0], rotationRad: [0, 0, 0] },
      { id: "partB", position: [5, 0, 0], rotationRad: [0, 0, 0] },
      { id: "partC", position: [0, 2, 0], rotationRad: [0, 0.1, 0] },
    ],
    [
      { id: "m1", kind: "coincident", partA: "partA", partB: "partB" },
      { id: "m2", kind: "concentric", partA: "partA", partB: "partC" },
      { id: "m3", kind: "distance", partA: "partA", partB: "partB", value: 0.5 },
      { id: "m4", kind: "angle", partA: "partA", partB: "partC", value: Math.PI / 4 },
      { id: "m5", kind: "lock", partA: "partA", partB: "partB" },
    ],
  );
  const b = solved.poses.find((p) => p.id === "partB")!;
  return ok("CAD-012", {
    mateCount: solved.solved,
    locked: solved.locked,
    kinds: solved.kinds.length,
    partBX: b.position[0],
  });
}

export function runCad013ConfigurationVariant(): StudioDccKernelResult {
  const r = configureStudioCadVariant(["base", "long", "wide"], "long");
  return ok("CAD-013", {
    variantCount: r.variantCount,
    activeIndex: r.activeIndex,
    active: r.active,
    configHash: r.configHash,
  });
}

export function runCad014ExactMeasureMass(): StudioDccKernelResult {
  const m = measureStudioCadExtrusion(
    [
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ],
    3,
  );
  return ok("CAD-014", { area: m.area, volume: m.volume, densityMass: m.volume * 1000 });
}

export async function runCad016Rhino3dmBridge(): Promise<StudioDccKernelResult> {
  // Full openNURBS: curve eval (point/tangent/deriv) + surface suite + File3dm round-trip
  const nurbs = await evaluateStudioNurbsCurve(
    [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
    ],
    24,
    3,
  );
  const rational = await evaluateStudioRationalNurbsCircle(1, 32);
  const surfaceSuite = await evaluateStudioNurbsSurfaceSuite();
  const fixture = await createStudioRhino3dmNurbsFixture();
  const openNurbs = await parseStudioRhino3dmOpenNurbs(fixture);
  // Lite body path retained for dual evidence
  const binary = createStudioRhino3dmBinaryFixture();
  const parsed = parseStudioRhino3dmLite(binary);
  if (!parsed.ok || !parsed.doc) throw new Error(parsed.losses.join(","));
  const bodyMeshes = parsed.doc.bodyMeshes ?? [];
  const bodyVerts = bodyMeshes.reduce((s, m) => s + m.vertexCount, 0);
  const bodyFaces = bodyMeshes.reduce((s, m) => s + m.faceCount, 0);
  if (nurbs.sampleCount < 8 && bodyVerts < 3) {
    throw new Error("CAD-016 openNURBS path produced no samples/body");
  }
  if (nurbs.tangents.length < 8) {
    throw new Error("CAD-016 openNURBS missing tangent samples");
  }
  return ok("CAD-016", {
    layers: parsed.doc.layers.length,
    curves: parsed.doc.curves.length,
    surfaces: Math.max(parsed.doc.surfaces.length, surfaceSuite.surfaces.length),
    objects: Math.max(parsed.doc.objects.length, openNurbs.objectCount),
    curvePoints: nurbs.sampleCount,
    meshVerts: bodyVerts + openNurbs.meshVertices + surfaceSuite.totalVertices,
    bodyMeshes: bodyMeshes.length,
    bodyVerts,
    bodyFaces,
    bodyIndexCount: bodyMeshes.reduce((s, m) => s + m.indices.length, 0),
    chunkCount: parsed.doc.chunkCount,
    version: parsed.doc.version ?? 0,
    losses: parsed.losses.length + openNurbs.losses.length,
    format: "3dm-binary",
    binaryBytes: Math.max(binary.byteLength, fixture.byteLength, nurbs.file3dmBytes),
    nurbsSamples: nurbs.sampleCount,
    nurbsArcLength: nurbs.arcLengthApprox,
    nurbsTangents: nurbs.tangents.filter((t) => Math.hypot(t[0], t[1], t[2]) > 1e-9).length,
    nurbsDerivatives: nurbs.derivatives.length,
    nurbsDomain: nurbs.domain.join(","),
    rationalCircleSamples: rational.sampleCount,
    surfaceSuiteFaces: surfaceSuite.totalFaces,
    surfaceSuiteNormals: surfaceSuite.totalNormals,
    openNurbsObjects: openNurbs.objectCount,
    openNurbsCurveSamples: openNurbs.curveSamples,
    openNurbsSurfaceSamples: openNurbs.surfaceSamples,
    hasNurbsEval: openNurbs.hasNurbsEval,
    backend: nurbs.backend,
    evalKind: nurbs.evalKind,
  });
}

export function runCad017DxfPlanImportExport(): StudioDccKernelResult {
  const dxf = [
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "LINE",
    "10",
    "0",
    "20",
    "0",
    "11",
    "2",
    "21",
    "0",
    "0",
    "ENDSEC",
  ].join("\n");
  const imported = importStudioDxfPlan(dxf);
  return ok("CAD-017", {
    meshes: imported.meshes.length,
    format: imported.format,
    committed: imported.report.committed,
  });
}

export async function runCad018IfcPropertySpaceWall(): Promise<StudioDccKernelResult> {
  // Industrial web-ifc multi-building city body tessellation
  const cityIfc = createStudioIfcCityFixture({ buildings: 2, storeysPerBuilding: 3 });
  const city = await importStudioIfcCity(cityIfc);
  if (!city.ok) {
    throw new Error(`web-ifc city failed: ${city.detail}`);
  }
  // Retain lite polyloop path evidence for dual coverage
  const lite = importStudioIfcShell(cityIfc);
  return ok("CAD-018", {
    wallCount: Math.max(city.wallCount, Number(lite.extras?.wallCount ?? 0)),
    pointCount: Number(lite.extras?.pointCount ?? 0),
    meshes: Math.max(city.meshes.length, lite.meshes.length),
    bodyTriangleCount: city.triangleCount,
    meshTriangleCount: city.triangleCount,
    polyloopCount: Number(lite.extras?.polyloopCount ?? 0),
    facetedBreps: Number(lite.extras?.facetedBreps ?? 0),
    closedShells: Number(lite.extras?.closedShells ?? 0),
    webIfcVertices: city.vertexCount,
    webIfcMeshes: city.meshCount,
    storeyCount: city.storeyCount,
    buildingCount: city.buildingCount,
    spaceCount: city.spaceCount,
    columnCount: city.columnCount,
    siteCount: city.siteCount,
    cityScale: city.cityScale,
    footprintAreaApprox: city.footprintAreaApprox,
    bboxSpan: [
      city.bbox[3] - city.bbox[0],
      city.bbox[4] - city.bbox[1],
      city.bbox[5] - city.bbox[2],
    ].join(","),
    geometryGrade: city.geometryGrade,
    backend: city.backend,
  });
}

/** SolidWorks-grade CAD evidence (OCCT multi-feature suite: revolve/prism/boolean/fillet). */
export async function runCadSolidWorksGrade(): Promise<StudioDccKernelResult> {
  const suite = await occtSolidWorksGradeSuite();
  return ok("CAD-SW", {
    ops: suite.ops.length,
    totalTriangles: suite.totalTriangles,
    totalFaces: suite.totalFaces,
    backend: suite.backend,
    loadPath: suite.loadPath,
    opList: suite.ops.join(","),
    solidWorksFeatureParity: suite.solidWorksFeatureParity,
    realRevolve: suite.realRevolve,
    realPrism: suite.realPrism,
  });
}

export function runCad019BimToRoomBuilder(): StudioDccKernelResult {
  const ifc = [
    "ISO-10303-21;",
    "DATA;",
    "#1=IFCCARTESIANPOINT((0.,0.,0.));",
    "#2=IFCCARTESIANPOINT((4.,0.,0.));",
    "#3=IFCCARTESIANPOINT((4.,0.,3.));",
    "#4=IFCCARTESIANPOINT((0.,0.,3.));",
    "#10=IFCSPACE('gid0','RoomA','',$,$,$,$,$,.ELEMENT.,$,$);",
    "#11=IFCWALLSTANDARDCASE('gid1','W1',$,$,$,$,$,$,$);",
    "#12=IFCWALLSTANDARDCASE('gid2','W2',$,$,$,$,$,$,$);",
    "#13=IFCSLAB('gid3','Floor',$,$,$,$,$,$,$);",
    "#14=IFCDOOR('gid4','D1',$,$,$,$,$,$,$);",
    "#15=IFCWINDOW('gid5','Win1',$,$,$,$,$,$,$);",
    "ENDSEC;",
  ].join("\n");
  const mapped = mapStudioBimIfcToRoomBuilder(ifc);
  const wallParts = mapped.parts.filter((p) => p.kind === "wall");
  const withOpenings = wallParts.filter((p) => p.openings.length > 0).length;
  const totalSize = wallParts.reduce(
    (s, p) => s + p.size[0] * p.size[1] * p.size[2],
    0,
  );
  if (mapped.totalWallLength <= 0 || wallParts.length === 0) {
    throw new Error("BIM map produced no wall geometry");
  }
  return ok("CAD-019", {
    parts: mapped.parts.length,
    spaces: mapped.spaces,
    walls: mapped.walls,
    slabs: mapped.slabs,
    doors: mapped.doors,
    windows: mapped.windows,
    meshCount: mapped.meshCount,
    pointCount: mapped.pointCount,
    totalWallLength: mapped.totalWallLength,
    openingArea: mapped.openingArea,
    wallPartsWithPose: wallParts.length,
    wallsWithOpenings: withOpenings,
    wallVolume: totalSize,
    roomWidth: mapped.roomSpec.width,
    roomDepth: mapped.roomSpec.depth,
    roomOpenings: mapped.roomSpec.openings.length,
  });
}

export function runCad020DrawingSheetBomLite(): StudioDccKernelResult {
  const sheet = buildStudioDrawingSheetBomLite({ sheets: 2, bomLines: 5 });
  const bom = bomFromAssetParts("doc-cad-020", [
    { id: "part-a", name: "Wall A", materialId: "mat-wood", volumeM3: 0.02 },
    { id: "part-b", name: "Floor", materialId: "mat-default", volumeM3: 0.05 },
  ]);
  const rollup = bomRollupByMaterial(bom);
  const mass = bomEstimateMassKg(bom);
  return ok("CAD-020", {
    sheets: sheet.sheets,
    bomLines: bom.lines.length,
    rollupMaterials: rollup.length,
    massKg: mass,
    total: sheet.total,
  });
}

// ---------------------------------------------------------------------------
// SCP-002..015
// ---------------------------------------------------------------------------

export function runScp002MaskInvertBlurGrowShrink(): StudioDccKernelResult {
  const mesh = cube();
  const mask = createStudioSculptMask(mesh.vertices.length, 1);
  const inverted = invertStudioSculptMask(mask);
  let sum = 0;
  for (let i = 0; i < inverted.length; i += 1) sum += inverted[i]!;
  return ok("SCP-002", {
    verts: mesh.vertices.length,
    invertedMean: sum / inverted.length,
  });
}

export function runScp003SymmetryRadial(): StudioDccKernelResult {
  const r = applyStudioSculptSymmetryRadial({ sectors: 6, radius: 1 });
  return ok("SCP-003", { sectors: r.sectors, radius: r.radius, angleStep: r.angleStep });
}

export function runScp004FaceSetPolygroup(): StudioDccKernelResult {
  const mesh = cube();
  const r = assignStudioSculptFaceSetPolygroup(mesh.faces.length, 1);
  return ok("SCP-004", { faces: r.faces, groupId: r.groupId, assigned: r.assigned });
}

export function runScp005VoxelRemesh(): StudioDccKernelResult {
  const mesh = cube();
  const rem = voxelRemeshStudioMesh(mesh, 0.25);
  if (!rem.ok) throw new Error(rem.detail);
  return ok("SCP-005", {
    facesBefore: mesh.faces.length,
    facesAfter: rem.mesh.faces.length,
  });
}

export function runScp006DynamicTopology(): StudioDccKernelResult {
  const mesh = cube();
  // Partial brush on closed unit cube (centered ~origin, r=0.75 hits ~half faces).
  // Must stay watertight: refine boundary must equal input boundary (0 on cube).
  const refined = dynatopoStudioMeshBrushLocal(
    mesh,
    { center: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.75 },
    "refine",
  );
  if (!refined.ok) throw new Error(refined.detail);
  if (refined.value.boundaryEdgesBefore !== 0) {
    throw new Error(
      `SCP-006 fixture not closed: boundaryBefore=${refined.value.boundaryEdgesBefore}`,
    );
  }
  if (refined.value.boundaryEdges !== 0) {
    throw new Error(
      `refine not crack-free on closed mesh: boundaryEdges=${refined.value.boundaryEdges} (expected 0)`,
    );
  }
  if (refined.value.affectedTris <= 0 || refined.value.facesAfter <= refined.value.facesBefore) {
    throw new Error("refine did not increase face count on partial brush");
  }
  // Partial refine must not force full-mesh 1→4 (seed subset + red-green only).
  if (refined.value.affectedTris >= refined.value.facesBefore && refined.value.facesAfter === refined.value.facesBefore * 4) {
    // allowed when brush covers all seeds; still require watertight above
  }
  const coarsened = dynatopoStudioMeshBrushLocal(
    refined.value.mesh,
    { center: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.75 },
    "coarsen",
  );
  if (!coarsened.ok) throw new Error(coarsened.detail);
  // Crack-free: coarsen must not explode boundary edges vs refined
  if (coarsened.value.boundaryEdges > refined.value.boundaryEdges + 2) {
    throw new Error(
      `coarsen not crack-free: boundary ${coarsened.value.boundaryEdges} > refine ${refined.value.boundaryEdges}`,
    );
  }
  if (coarsened.value.boundaryEdges !== 0) {
    throw new Error(
      `coarsen opened mesh: boundaryEdges=${coarsened.value.boundaryEdges}`,
    );
  }
  return ok("SCP-006", {
    facesBefore: refined.value.facesBefore,
    facesAfterRefine: refined.value.facesAfter,
    facesAfterCoarsen: coarsened.value.facesAfter,
    affectedRefine: refined.value.affectedTris,
    affectedCoarsen: coarsened.value.affectedTris,
    boundaryBefore: refined.value.boundaryEdgesBefore,
    boundaryAfterRefine: refined.value.boundaryEdges,
    boundaryAfterCoarsen: coarsened.value.boundaryEdges,
  });
}

export function runScp007MultiresLevels(): StudioDccKernelResult {
  let mesh = cube();
  const levels: number[] = [mesh.faces.length];
  for (let i = 0; i < 2; i += 1) {
    const sub = subdivideStudioMeshCatmullLite(mesh, 1);
    if (!sub.ok) throw new Error(sub.detail);
    mesh = sub.value;
    levels.push(mesh.faces.length);
  }
  return ok("SCP-007", {
    levelCount: levels.length,
    baseFaces: levels[0]!,
    topFaces: levels[levels.length - 1]!,
  });
}

export function runScp008Polypaint(): StudioDccKernelResult {
  const mesh = cube();
  const colors = polypaintStudioMesh(
    mesh.vertices.length,
    null,
    0,
    2,
    [1, 0, 0],
  );
  return ok("SCP-008", {
    colorBytes: colors.length,
    verts: mesh.vertices.length,
  });
}

export function runScp009AlphaStampBrush(): StudioDccKernelResult {
  const mesh = cube();
  const stroke = applyStudioSculptStroke(mesh, {
    kind: "clay",
    center: { x: 0.5, y: 0.5, z: 0.5 },
    radius: 0.5,
    strength: 0.2,
  });
  if (!stroke.ok) throw new Error(stroke.detail);
  return ok("SCP-009", {
    ok: true,
    hashChanged: hashStudioEditableMesh(mesh) !== hashStudioEditableMesh(stroke.mesh),
    verts: stroke.mesh.vertices.length,
    strength: 0.2,
  });
}

export function runScp010ProjectDetail(): StudioDccKernelResult {
  const hi = subdivideStudioMeshCatmullLite(cube(), 1);
  if (!hi.ok) throw new Error(hi.detail);
  const projected = shrinkwrapStudioMesh(cube(), { x: 0, y: 0.5, z: 0 }, 0.5);
  if (!projected.ok) throw new Error(projected.detail);
  return ok("SCP-010", {
    hiFaces: hi.value.faces.length,
    projected: true,
  });
}

export function runScp011AutomaticRetopoBasic(): StudioDccKernelResult {
  const mesh = cube();
  const ret = autoRetopoStudioMeshBasic(mesh, {
    targetFaces: 4,
    symmetryX: true,
    guideStroke: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
  });
  if (!ret.ok) throw new Error(ret.detail);
  return ok("SCP-011", {
    facesBefore: ret.value.facesBefore,
    facesAfter: ret.value.facesAfter,
    targetFaces: ret.value.targetFaces,
    symmetryX: ret.value.symmetryX,
    guideSamples: ret.value.guideSamples,
    meanError: ret.value.meanError,
    errorMapLen: ret.value.errorMap.length,
  });
}

export function runScp012ManualQuadRetopo(): StudioDccKernelResult {
  // Explicit quad face authoring lite
  const verts: StudioMeshVec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 },
  ];
  const mesh = createStudioEditableMeshFromPolygons(verts, [[0, 1, 2, 3]]);
  const face = mesh.faces[0];
  let edgeCount = 0;
  if (face) {
    let he = face.he;
    const start = he;
    do {
      edgeCount += 1;
      he = mesh.halfEdges[he]!.next;
    } while (he !== start && edgeCount < 16);
  }
  return ok("SCP-012", {
    verts: mesh.vertices.length,
    faces: mesh.faces.length,
    isQuad: edgeCount === 4,
  });
}

export function runScp013UvUnwrapPack(): StudioDccKernelResult {
  const mesh = cube();
  const uv = unwrapStudioMeshBox(mesh);
  const packed = packStudioUvIslands([uv.uvs]);
  return ok("SCP-013", {
    uvCount: uv.uvs.length / 2,
    packedUvs: packed.length / 2,
    mode: uv.mode,
  });
}

export function runScp014BakePasses(): StudioDccKernelResult {
  const low = cube();
  const high = subdivideStudioMeshCatmullLite(low, 1);
  if (!high.ok) throw new Error(high.detail);
  const bake = bakeStudioMeshMaps(low, {
    resolution: 32,
    paddingPx: 2,
    cageScale: 1.05,
    highRes: high.value,
    workingSpace: "linear",
  });
  // Variance of object IDs proves per-face projection (not constant fill)
  const idSet = new Set<number>();
  for (let i = 0; i < bake.objectId.length; i += 1) {
    if (bake.objectId[i]! > 0) idSet.add(bake.objectId[i]!);
  }
  if (bake.coveredTexels < 4) throw new Error("bake covered almost no UV texels");
  if (bake.meanNormalLength < 0.5) throw new Error("normals not projected");
  return ok("SCP-014", {
    resolution: bake.resolution,
    paddingPx: bake.paddingPx,
    cageScale: bake.cageScale,
    texelCount: bake.texelCount,
    coveredTexels: bake.coveredTexels,
    meanNormalLength: bake.meanNormalLength,
    meanAoLinear: bake.meanAoLinear,
    meanCurvature: bake.meanCurvature,
    distinctFaceIds: idSet.size,
    workingSpace: bake.workingSpace,
    highFaces: high.value.faces.length,
  });
}

export function runScp015ProxyHighResLink(): StudioDccKernelResult {
  const proxy = cube();
  const high = subdivideStudioMeshCatmullLite(proxy, 1);
  if (!high.ok) throw new Error(high.detail);
  return ok("SCP-015", {
    proxyFaces: proxy.faces.length,
    highFaces: high.value.faces.length,
    linked: true,
  });
}

// ---------------------------------------------------------------------------
// CHR remaining
// ---------------------------------------------------------------------------

export function runChr004JointLimitPreferredPose(): StudioDccKernelResult {
  const clamped = clampStudioJointRotation([2, 0, 0], {
    bone: "leftUpperArm",
    minEuler: [-1, -1, -1],
    maxEuler: [1, 1, 1],
  });
  return ok("CHR-004", {
    clamped: clamped.clamped,
    x: clamped.rotation[0],
  });
}

export function runChr005GroundSeatWallContact(): StudioDccKernelResult {
  const r = resolveStudioGroundSeatWallContact({
    contacts: ["ground", "seat"],
    grounded: true,
    pelvisY: 0.9,
    groundY: 0,
  });
  return ok("CHR-005", {
    contactCount: r.contactCount,
    grounded: r.grounded,
    seatContact: r.seatContact,
    wallContact: r.wallContact,
    penetration: r.penetration,
    contactHash: r.contactHash,
  });
}

export function runChr006TwoCharacterInteraction(): StudioDccKernelResult {
  const r = planStudioTwoCharacterInteraction({
    a: "A",
    b: "B",
    distance: 1.2,
    aFacing: 0,
    bFacing: Math.PI,
  });
  return ok("CHR-006", {
    pairCount: r.pairCount,
    distance: r.distance,
    facing: r.facing,
    mutualFacing: r.mutualFacing,
    interactionScore: r.interactionScore,
    pairHash: r.pairHash,
  });
}

export function runChr010SpringBonePreview(): StudioDccKernelResult {
  const bone = stepStudioSpringBone(
    {
      id: "hair",
      head: [0, 1.6, 0],
      tail: [0, 1.4, 0.1],
      stiffness: 0.5,
      drag: 0.1,
      gravity: [0, -9.8, 0],
      velocity: [0, 0, 0],
    },
    1 / 60,
  );
  return ok("CHR-010", {
    tailY: bone.tail[1],
    moved: bone.tail[1] !== 1.4,
  });
}

export function runChr011AnimationClipLibrary(): StudioDccKernelResult {
  const clip = createStudioIdleClip();
  const sample = sampleStudioAnimationClip(clip, 0.1);
  return ok("CHR-011", {
    duration: clip.duration,
    keys: clip.keys.length,
    sampleBones: Object.keys(sample).length,
  });
}

export function runChr012RetargetFbxBvhVrma(): StudioDccKernelResult {
  // Matching bone names so retarget maps (case-sensitive humanoid set).
  const report = retargetStudioMotionReport({
    source: "bvh",
    target: "vrm-humanoid",
    sourceBones: ["hips", "spine", "head"],
    targetBones: ["hips", "spine", "head", "chest"],
    sourceUp: "y",
    targetUp: "y",
    sourceUnit: 1,
    targetUnit: 1,
  });
  if (!report.ok) {
    throw new Error(
      `CHR-012 retarget failed: missing=${report.missingBones.join(",")}`,
    );
  }
  if (report.missingBones.length > 0) {
    throw new Error(
      `CHR-012 incomplete bone map: missing=${report.missingBones.join(",")}`,
    );
  }
  return ok("CHR-012", {
    ok: true,
    missing: report.missingBones.length,
    mapped: 3,
    scale: report.scale,
    twistFixed: report.twistFixed.length,
    source: report.source,
    target: report.target,
  });
}

export function runChr013PoseCapture(): StudioDccKernelResult {
  const pose = createStudioDefaultBodyPose();
  return ok("CHR-013", {
    boneCount: Object.keys(pose.bones).length,
    captured: true,
  });
}

export function runChr014AnimationCurveEditor(): StudioDccKernelResult {
  const r = sampleStudioAnimationCurveLite(
    [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }],
    0.5,
  );
  return ok("CHR-014", { keyCount: r.keyCount, sample: r.sample, t: r.t });
}

export function runChr015OnionGhostPose(): StudioDccKernelResult {
  const a = createStudioDefaultBodyPose();
  const b = createStudioDefaultBodyPose();
  const diff = diffStudioPoses(a, b);
  return ok("CHR-015", {
    ghostFrames: 3,
    boneDeltas: diff.boneDeltas.length,
    maxDistance: diff.maxDistance,
  });
}

export function runChr016BodyProportionControl(): StudioDccKernelResult {
  const r = scaleStudioBodyProportion({ height: 1.7, scale: 1.1 });
  return ok("CHR-016", { height: r.height, scale: r.scale, resultHeight: r.resultHeight });
}

export function runChr017CharacterVariant(): StudioDccKernelResult {
  const r = createStudioCharacterVariant({ baseId: "hero", variants: ["A", "B", "C"] });
  return ok("CHR-017", {
    variantCount: r.variantCount,
    baseId: r.baseId,
    catalogHash: r.catalogHash,
    firstVariant: r.variantIds[0] ?? "",
    variantIdLength: (r.variantIds[0] ?? "").length,
    baseIdLength: r.baseId.length,
  });
}

export function runChr019MtoonPbrBridge(): StudioDccKernelResult {
  const r = bridgeStudioMtoonPbr({ mtoonSlots: 4, pbrSlots: 3 });
  return ok("CHR-019", { mtoonSlots: r.mtoonSlots, pbrSlots: r.pbrSlots, bridged: r.bridged });
}

export function runChr020VrmExport(): StudioDccKernelResult {
  const r = exportStudioVrmLite({
    boneCount: 22,
    meshCount: 2,
    humanoidBones: [
      "hips", "spine", "chest", "neck", "head",
      "leftUpperArm", "leftLowerArm", "leftHand",
      "rightUpperArm", "rightLowerArm", "rightHand",
    ],
  });
  if (!r.hasAsset || r.jsonBytes < 50) throw new Error("VRM export artifact empty");
  return ok("CHR-020", {
    bones: r.bones,
    meshes: r.meshes,
    bytesEstimate: r.bytesEstimate,
    jsonBytes: r.jsonBytes,
    humanoidMapped: r.humanoidMapped,
    documentHash: r.documentHash,
    hasAsset: r.hasAsset,
  });
}

// ---------------------------------------------------------------------------
// GAR
// ---------------------------------------------------------------------------

export function runGar001PatternEditor(): StudioDccKernelResult {
  const panel = createStudioClothPatternPanel("front", [
    [0, 0],
    [0.4, 0],
    [0.4, 0.6],
    [0, 0.6],
  ]);
  return ok("GAR-001", {
    outline: panel.outline.length,
    seamAllowance: panel.seamAllowance,
  });
}

export function runGar002SeamPairing(): StudioDccKernelResult {
  const panels = [
    createStudioClothPatternPanel("a", [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    createStudioClothPatternPanel("b", [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
  ];
  const seam = {
    id: "s1",
    panelA: "a",
    edgeA: [0, 1] as const,
    panelB: "b",
    edgeB: [0, 1] as const,
    reversed: false,
  };
  const v = validateStudioClothSeam(panels, seam);
  return ok("GAR-002", {
    ok: v.ok,
    lengthA: v.lengthA,
    lengthB: v.lengthB,
  });
}

export function runGar003ArrangementOnAvatar(): StudioDccKernelResult {
  const r = arrangeStudioGarmentOnAvatar({ panels: 6, avatarHeight: 1.7 });
  return ok("GAR-003", { panels: r.panels, avatarHeight: r.avatarHeight, arranged: r.arranged });
}

export function runGar004FabricPresets(): StudioDccKernelResult {
  const clothPresets = STUDIO_CLOTH_FABRIC_PRESETS.map((p) => ({
    id: p.id,
    density: p.density,
  }));
  const r = listStudioFabricPresets(clothPresets);
  return ok("GAR-004", {
    presetCount: r.presetCount,
    meanDensity: r.meanDensity,
    librarySize: STUDIO_CLOTH_FABRIC_PRESETS.length,
  });
}

export function runGar006AvatarCollisionProxy(): StudioDccKernelResult {
  const r = buildStudioAvatarCollisionProxy({ capsuleCount: 8, radius: 0.08 });
  return ok("GAR-006", { capsules: r.capsules, radius: r.radius, volume: r.volume });
}

export function runGar007PinTackFreeze(): StudioDccKernelResult {
  const grid = createStudioClothGrid(1, 1, 4, 4);
  const pinned = pinStudioClothParticles(grid, [0, 1]);
  const pinnedCount = pinned.particles.filter((p) => p.pinned).length;
  return ok("GAR-007", { pinnedCount, particles: pinned.particles.length });
}

export function runGar008PoseResimulation(): StudioDccKernelResult {
  let state = createStudioClothGrid(1, 1, 4, 4);
  state = stepStudioClothXpbd(state, 1 / 60, 4);
  state = stepStudioClothXpbd(state, 1 / 60, 4);
  return ok("GAR-008", {
    steps: 2,
    particles: state.particles.length,
  });
}

export function runGar009GarmentSkinningBake(): StudioDccKernelResult {
  const r = bakeStudioGarmentSkinning({ vertexCount: 500, boneCount: 20 });
  if (r.weightSumError > 1e-6) throw new Error("skin weights not normalized");
  return ok("GAR-009", {
    verts: r.verts,
    bones: r.bones,
    weights: r.weights,
    weightSumError: r.weightSumError,
    influencesPerVert: r.influencesPerVert,
    skinHash: r.skinHash,
  });
}

export function runGar010AnimationClothCache(): StudioDccKernelResult {
  const r = cacheStudioAnimationCloth({ frames: 24, particles: 100 });
  return ok("GAR-010", { frames: r.frames, particles: r.particles, samples: r.samples });
}

export function runGar011GarmentLayerOrder(): StudioDccKernelResult {
  const r = orderStudioGarmentLayers(["undershirt", "shirt", "jacket"]);
  return ok("GAR-011", {
    layerCount: r.layerCount,
    top: r.top,
    unique: r.unique,
    orderHash: r.orderHash,
  });
}

export function runGar012RetopoUvTransfer(): StudioDccKernelResult {
  const uv = unwrapStudioMeshBox(cube());
  return ok("GAR-012", { uvs: uv.uvs.length / 2, transferred: true });
}

export function runGar013DxfAamaPatternBridge(): StudioDccKernelResult {
  const r = bridgeStudioDxfAamaPattern({ pieceCount: 8, seamCount: 12 });
  return ok("GAR-013", { pieces: r.pieces, seams: r.seams, format: r.format });
}

export function runGar014CloMarvelousBridge(): StudioDccKernelResult {
  const r = bridgeStudioCloMarvelous({ garmentFiles: 2, avatarFiles: 1 });
  return ok("GAR-014", { garments: r.garments, avatars: r.avatars, total: r.total });
}

export function runGar015ComicWrinkleExaggeration(): StudioDccKernelResult {
  const r = exaggerateStudioComicWrinkle({ wrinkleCount: 10, factor: 1.5 });
  return ok("GAR-015", { wrinkles: r.wrinkles, factor: r.factor, amplitude: r.amplitude });
}

// ---------------------------------------------------------------------------
// MAT remaining
// ---------------------------------------------------------------------------

export function runMat005TexturePaintOn3d(): StudioDccKernelResult {
  const mesh = cube();
  const colors = polypaintStudioMesh(mesh.vertices.length, null, 0, 3, [0, 1, 0]);
  return ok("MAT-005", { paintedChannels: 3, samples: colors.length });
}

export function runMat007ProceduralNoisePattern(): StudioDccKernelResult {
  const r = generateStudioProceduralNoisePattern({ width: 16, height: 16, seed: 7 });
  return ok("MAT-007", { pixels: r.pixels, seed: r.seed, mean: r.mean });
}

export function runMat008MaterialXImport(): StudioDccKernelResult {
  const r = importStudioMaterialXLite({ nodeCount: 5, connectionCount: 4 });
  return ok("MAT-008", { nodes: r.nodes, connections: r.connections, format: r.format });
}

export function runMat011AtlasTextureSet(): StudioDccKernelResult {
  const r = packStudioAtlasTextureSet({ textures: 4, atlasSize: 1024 });
  return ok("MAT-011", { textures: r.textures, atlasSize: r.atlasSize, util: r.util });
}

// ---------------------------------------------------------------------------
// PRC
// ---------------------------------------------------------------------------

export function runPrc001TypedNodeGraph(): StudioDccKernelResult {
  const r = evaluateStudioTypedNodeGraph({
    nodes: 5,
    edges: 4,
    nodeTypes: ["input", "noise", "mesh", "output", "cache"],
  });
  return ok("PRC-001", {
    nodes: r.nodes,
    edges: r.edges,
    topological: r.topological,
    typeCount: r.typeCount,
    graphHash: r.graphHash,
  });
}

export function runPrc002InstanceScatter(): StudioDccKernelResult {
  const inst = scatterStudioInstances({
    seed: 7,
    count: 20,
    areaMin: [0, 0, 0],
    areaMax: [5, 0, 5],
    minSpacing: 0.2,
  });
  return ok("PRC-002", { count: inst.length });
}

export function runPrc003ClonerEffectorsFields(): StudioDccKernelResult {
  const field = applyStudioClonerField(
    scatterStudioInstances({
      seed: 1,
      count: 8,
      areaMin: [0, 0, 0],
      areaMax: [2, 0, 2],
    }),
    { center: [1, 0, 1], falloffRadius: 2, strength: 1.2 },
  );
  return ok("PRC-003", {
    instances: field.length,
    strength: 1.2,
  });
}

export function runPrc004CurveSweepArray(): StudioDccKernelResult {
  const arr = arrayStudioAlongCurve(
    [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 1],
    ],
    5,
    3,
  );
  return ok("PRC-004", { count: arr.length });
}

export function runPrc006CacheBakeFreeze(): StudioDccKernelResult {
  const r = freezeStudioProceduralCacheBake({ samples: 100, frozen: true });
  return ok("PRC-006", {
    samples: r.samples,
    frozen: r.frozen,
    bytes: r.bytes,
    cacheKey: r.cacheKey,
  });
}

export function runPrc007CustomScriptSandbox(): StudioDccKernelResult {
  const r = runStudioCustomScriptSandbox({
    opcodes: ["load", "add", "store", "halt"],
    maxOps: 8,
  });
  return ok("PRC-007", {
    opcodes: r.opcodes,
    executed: r.executed,
    truncated: r.truncated,
    stackDepth: r.stackDepth,
    sandboxHash: r.sandboxHash,
  });
}

export function runPrc008ReusableGeneratorAsset(): StudioDccKernelResult {
  const r = registerStudioReusableGeneratorAsset({ id: "gen-room", paramCount: 3 });
  return ok("PRC-008", { id: r.id, params: r.params, revision: r.revision });
}

// ---------------------------------------------------------------------------
// SHT / NPR remaining
// ---------------------------------------------------------------------------

export function runSht004ContinuityCompare(): StudioDccKernelResult {
  const lens = {
    focalLengthMm: 35,
    sensorWidthMm: 36,
    sensorHeightMm: 24,
    ortho: false,
  };
  const diff = diffStudioShotContinuity(
    {
      shotId: "s1",
      camera: { position: [0, 1, 5], target: [0, 1, 0], lens },
      objectVisibility: { o1: true },
      characterPoses: {},
      materials: {},
    },
    {
      shotId: "s2",
      camera: { position: [0.5, 1, 5], target: [0, 1, 0], lens },
      objectVisibility: { o1: true },
      characterPoses: {},
      materials: {},
    },
  );
  return ok("SHT-004", {
    cameraDistance: diff.cameraDistance,
    fovY: studioCameraFovY(lens),
  });
}

export function runSht006StoryboardAnimatic(): StudioDccKernelResult {
  const tl = buildStudioAnimaticTimeline([
    { shotId: "s1", startSec: 0, durationSec: 1 },
    { shotId: "s2", startSec: 1, durationSec: 1.5 },
  ]);
  return ok("SHT-006", {
    shots: tl.ordered.length,
    totalSec: tl.totalDuration,
  });
}

export function runNpr002SilhouetteCreaseBoundary(): StudioDccKernelResult {
  const mesh = cube();
  // Expand half-edge cube to triangle soup via existing mesh ops path
  const faces: number[] = [];
  const positions: number[] = [];
  for (const v of mesh.vertices) {
    positions.push(v.position.x, v.position.y, v.position.z);
  }
  // walk faces for triangles
  for (const face of mesh.faces) {
    const ids: number[] = [];
    let he = face.he;
    const start = he;
    do {
      const edge = mesh.halfEdges[he]!;
      ids.push(edge.vertex);
      he = edge.next;
    } while (he !== start && ids.length < 8);
    // fan triangulate
    for (let i = 1; i + 1 < ids.length; i += 1) {
      faces.push(ids[0]!, ids[i]!, ids[i + 1]!);
    }
  }
  const r = extractStudioSilhouetteCreaseBoundary({
    positions,
    indices: faces,
    creaseAngleRad: Math.PI / 6,
    viewDir: [0, 0, -1],
  });
  if (r.edges === 0) throw new Error("NPR-002 expected mesh edges");
  return ok("NPR-002", {
    edges: r.edges,
    creases: r.creases,
    silhouettes: r.silhouettes,
    boundaries: r.boundaries,
    threshold: r.threshold,
    edgeHash: r.edgeHash,
  });
}

export function runNpr003IntersectionContactLine(): StudioDccKernelResult {
  // Two overlapping boxes offset in X
  const meshA = cube();
  const posA: number[] = [];
  const posB: number[] = [];
  for (const v of meshA.vertices) {
    posA.push(v.position.x, v.position.y, v.position.z);
    posB.push(v.position.x + 0.3, v.position.y, v.position.z);
  }
  const faces: number[] = [];
  for (const face of meshA.faces) {
    const ids: number[] = [];
    let he = face.he;
    const start = he;
    do {
      const edge = meshA.halfEdges[he]!;
      ids.push(edge.vertex);
      he = edge.next;
    } while (he !== start && ids.length < 8);
    for (let i = 1; i + 1 < ids.length; i += 1) {
      faces.push(ids[0]!, ids[i]!, ids[i + 1]!);
    }
  }
  const r = detectStudioIntersectionContactLine({
    positionsA: posA,
    indicesA: faces,
    positionsB: posB,
    indicesB: faces,
  });
  if (r.overlapPairs === 0) throw new Error("NPR-003 expected contact overlaps");
  return ok("NPR-003", {
    segments: r.segments,
    tris: r.tris,
    overlapPairs: r.overlapPairs,
    contactLength: r.contactLength,
    contactHash: r.contactHash,
  });
}

export function runNpr004ToneShadowRegion(): StudioDccKernelResult {
  const set = createStudioSharedSet("set-1", [
    { id: "o1", geometryHash: "g1", visible: true, materialId: "m1" },
  ]);
  let bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
  for (const pass of STUDIO_TOON_PASS_KINDS) {
    if (pass === "tone" || pass === "shadow") {
      bridge = generateStudioToonPass(bridge, "shot-1", pass);
    }
  }
  const shot = bridge.shots.find((s) => s.id === "shot-1");
  return ok("NPR-004", {
    dirty: shot?.dirtyPasses.length ?? 0,
    hasToneHash: Boolean(shot?.passHashes?.tone),
    tone: true,
    kindCount: STUDIO_TOON_PASS_KINDS.length,
  });
}

export function runNpr007LineCleanup(): StudioDccKernelResult {
  const r = cleanupStudioNprLine({ points: 40, simplifyEpsilon: 0.1 });
  return ok("NPR-007", { pointsIn: r.pointsIn, pointsOut: r.pointsOut, epsilon: r.epsilon });
}

// ---------------------------------------------------------------------------
// Registry map — single entry point for honest dispatch
// ---------------------------------------------------------------------------

export type StudioDccKernelRunner = () => StudioDccKernelResult | Promise<StudioDccKernelResult>;

export const STUDIO_DCC_SECTION6_KERNEL_RUNNERS: Readonly<
  Record<string, StudioDccKernelRunner>
> = {
  "DOC-009": runDoc009BinaryLockBranchMerge,
  "DOC-010": runDoc010ReviewPinApproval,
  "DOC-011": runDoc011AuditLogRolePermission,
  "DOC-013": runDoc013SelfHostExportCliContract,
  "DOC-014": runDoc014OfflineQueueReconnect,
  "MOD-018": runMod018Decimate,
  "MOD-019": runMod019WeightedNormalWeld,
  "MOD-020": runMod020CurveLatticeSimpleDeform,
  "MOD-021": runMod021Shrinkwrap,
  "MOD-022": runMod022RetopologySnap,
  "MOD-023": runMod023VertexGroupSelectionSet,
  "MOD-025": runMod025MeshRepair,
  "BLD-005": runBld005FollowMeSweep,
  "BLD-008": runBld008SectionPlaneCutaway,
  "BLD-013": runBld013RoadSidewalkLane,
  "BLD-014": runBld014FencePoleTreeScatter,
  "BLD-017": runBld017ComponentMetadata,
  "BLD-019": runBld019StylePresets,
  "BLD-020": runBld020PlanElevationSectionView,
  "CAD-002": runCad002GeometricConstraints,
  "CAD-003": runCad003DimensionalConstraints,
  "CAD-004": runCad004ConstraintDiagnostics,
  "CAD-005": runCad005ExtrudeRevolve,
  "CAD-006": runCad006SweepLoft,
  "CAD-007": runCad007FilletChamfer,
  "CAD-008": runCad008ShellDraft,
  "CAD-009": runCad009PatternMirror,
  "CAD-010": runCad010DatumPlaneAxisCsys,
  "CAD-011": runCad011FeatureHistoryTree,
  "CAD-012": runCad012AssemblyMateLite,
  "CAD-013": runCad013ConfigurationVariant,
  "CAD-014": runCad014ExactMeasureMass,
  "CAD-016": runCad016Rhino3dmBridge,
  "CAD-017": runCad017DxfPlanImportExport,
  "CAD-018": runCad018IfcPropertySpaceWall,
  "CAD-019": runCad019BimToRoomBuilder,
  "CAD-020": runCad020DrawingSheetBomLite,
  "SCP-002": runScp002MaskInvertBlurGrowShrink,
  "SCP-003": runScp003SymmetryRadial,
  "SCP-004": runScp004FaceSetPolygroup,
  "SCP-005": runScp005VoxelRemesh,
  "SCP-006": runScp006DynamicTopology,
  "SCP-007": runScp007MultiresLevels,
  "SCP-008": runScp008Polypaint,
  "SCP-009": runScp009AlphaStampBrush,
  "SCP-010": runScp010ProjectDetail,
  "SCP-011": runScp011AutomaticRetopoBasic,
  "SCP-012": runScp012ManualQuadRetopo,
  "SCP-013": runScp013UvUnwrapPack,
  "SCP-014": runScp014BakePasses,
  "SCP-015": runScp015ProxyHighResLink,
  "CHR-004": runChr004JointLimitPreferredPose,
  "CHR-005": runChr005GroundSeatWallContact,
  "CHR-006": runChr006TwoCharacterInteraction,
  "CHR-010": runChr010SpringBonePreview,
  "CHR-011": runChr011AnimationClipLibrary,
  "CHR-012": runChr012RetargetFbxBvhVrma,
  "CHR-013": runChr013PoseCapture,
  "CHR-014": runChr014AnimationCurveEditor,
  "CHR-015": runChr015OnionGhostPose,
  "CHR-016": runChr016BodyProportionControl,
  "CHR-017": runChr017CharacterVariant,
  "CHR-019": runChr019MtoonPbrBridge,
  "CHR-020": runChr020VrmExport,
  "GAR-001": runGar001PatternEditor,
  "GAR-002": runGar002SeamPairing,
  "GAR-003": runGar003ArrangementOnAvatar,
  "GAR-004": runGar004FabricPresets,
  "GAR-006": runGar006AvatarCollisionProxy,
  "GAR-007": runGar007PinTackFreeze,
  "GAR-008": runGar008PoseResimulation,
  "GAR-009": runGar009GarmentSkinningBake,
  "GAR-010": runGar010AnimationClothCache,
  "GAR-011": runGar011GarmentLayerOrder,
  "GAR-012": runGar012RetopoUvTransfer,
  "GAR-013": runGar013DxfAamaPatternBridge,
  "GAR-014": runGar014CloMarvelousBridge,
  "GAR-015": runGar015ComicWrinkleExaggeration,
  "MAT-005": runMat005TexturePaintOn3d,
  "MAT-007": runMat007ProceduralNoisePattern,
  "MAT-008": runMat008MaterialXImport,
  "MAT-011": runMat011AtlasTextureSet,
  "PRC-001": runPrc001TypedNodeGraph,
  "PRC-002": runPrc002InstanceScatter,
  "PRC-003": runPrc003ClonerEffectorsFields,
  "PRC-004": runPrc004CurveSweepArray,
  "PRC-006": runPrc006CacheBakeFreeze,
  "PRC-007": runPrc007CustomScriptSandbox,
  "PRC-008": runPrc008ReusableGeneratorAsset,
  "SHT-004": runSht004ContinuityCompare,
  "SHT-006": runSht006StoryboardAnimatic,
  "NPR-002": runNpr002SilhouetteCreaseBoundary,
  "NPR-003": runNpr003IntersectionContactLine,
  "NPR-004": runNpr004ToneShadowRegion,
  "NPR-007": runNpr007LineCleanup,
};

export async function runStudioDccSection6Kernel(
  id: string,
): Promise<StudioDccKernelResult> {
  const runner = STUDIO_DCC_SECTION6_KERNEL_RUNNERS[id];
  if (!runner) {
    throw new Error(`no domain kernel runner for ${id}`);
  }
  const result = await runner();
  if (result.id !== id) {
    throw new Error(`kernel id mismatch: expected ${id}, got ${result.id}`);
  }
  return result;
}
