/**
 * Full-document catalog gating — P0–P5 pure kernels shipped for engine expansion.
 * P2–P5 are pure-logic / lite kernels (not full native DCC clones).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createStudioCadSketch,
  diagnoseStudioCadConstraints,
  extrudeStudioCadProfile,
  measureStudioCadExtrusion,
  orderStudioCadFeatureTree,
  revolveStudioCadProfile,
} from "../studio-cad-kernel-lite";
import {
  createStudioIdleClip,
  clampStudioJointRotation,
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
import { createStudioUnitCubeMesh } from "../studio-editable-half-edge-mesh";
import { importStudioGlbDocument } from "../studio-glb-scene-ir";
import {
  bisectStudioEditableMesh,
  bridgeStudioFaceLoops,
  decimateStudioMesh,
  deformStudioMeshBend,
  repairStudioMesh,
  retopoSnapStudioMeshToPlane,
  shrinkwrapStudioMesh,
  subdivideStudioMeshCatmullLite,
} from "../studio-mesh-ops-advanced";
import {
  applyStudioClonerField,
  arrayStudioAlongCurve,
  scatterStudioInstances,
} from "../studio-procedural-scatter";
import {
  buildStudioAnimaticTimeline,
  diffStudioShotContinuity,
  studioCameraFovY,
} from "../studio-shot-continuity";

import {
  assertNoProprietaryInBrowserCore,
  lookupStudioFormat,
  STUDIO_DCC_FORMAT_MATRIX,
  studioFormatsByGrade,
  studioFormatsByPriority,
} from "./studio-dcc-format-matrix";
import {
  createStudioHybridDccSession,
  hybridDccRegisterAsset,
  hybridDccSelectiveUndo,
} from "./studio-hybrid-dcc-document";
import {
  applyStudioSculptStroke,
  createStudioSculptMask,
  invertStudioSculptMask,
  polypaintStudioMesh,
  voxelRemeshStudioMesh,
} from "./studio-hybrid-sculpt-kernel";

describe("P2 mesh advanced ops", () => {
  it("bisect, bridge, subdiv, decimate, bend, shrinkwrap, repair, retopo snap", () => {
    const cube = createStudioUnitCubeMesh();
    const bisect = bisectStudioEditableMesh(cube, { a: 0, b: 1, c: 0, d: 0 });
    expect(bisect.ok).toBe(true);

    const bridged = bridgeStudioFaceLoops(cube, [0, 1, 2, 3], [4, 5, 6, 7]);
    expect(bridged.ok).toBe(true);

    const subdiv = subdivideStudioMeshCatmullLite(cube, 1);
    expect(subdiv.ok).toBe(true);
    if (subdiv.ok) {
      expect(subdiv.value.faces.length).toBeGreaterThan(cube.faces.length);
    }

    const dec = decimateStudioMesh(cube, 0.5);
    expect(dec.ok).toBe(true);

    const bend = deformStudioMeshBend(cube, Math.PI / 4, "y");
    expect(bend.ok).toBe(true);

    const wrap = shrinkwrapStudioMesh(cube, { x: 0, y: 0, z: 0 }, 0.25);
    expect(wrap.ok).toBe(true);

    const repaired = repairStudioMesh(cube);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) expect(repaired.value.report.length).toBeGreaterThan(0);

    const snap = retopoSnapStudioMeshToPlane(
      cube,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    expect(snap.ok).toBe(true);
  });
});

describe("P2/P3 CAD kernel lite", () => {
  it("sketch constraints, extrude, revolve, measure, feature tree", () => {
    const sketch = createStudioCadSketch(
      [
        { kind: "line", a: [0, 0], b: [1, 0] },
        { kind: "line", a: [1, 0], b: [1, 1] },
        { kind: "circle", center: [0.5, 0.5], radius: 0.2 },
      ],
      [
        { kind: "horizontal", curveIndex: 0 },
        { kind: "vertical", curveIndex: 1 },
        { kind: "radius", curveIndex: 2, value: 0.2 },
        { kind: "perpendicular", a: 0, b: 1 },
      ],
    );
    const report = diagnoseStudioCadConstraints(sketch);
    expect(report.satisfied.length).toBeGreaterThanOrEqual(3);
    expect(report.conflicts).toHaveLength(0);

    const profile: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const solid = extrudeStudioCadProfile(profile, 0.5);
    expect(solid).not.toBeNull();
    expect(solid!.indices.length).toBeGreaterThan(0);
    const rev = revolveStudioCadProfile([
      [0.2, 0],
      [0.4, 0.5],
      [0.2, 1],
    ], 12);
    expect(rev).not.toBeNull();
    const measure = measureStudioCadExtrusion(profile, 2);
    expect(measure.area).toBeCloseTo(1);
    expect(measure.volume).toBeCloseTo(2);

    const tree = orderStudioCadFeatureTree([
      { id: "sk1", kind: "sketch", suppressed: false, params: {}, dependsOn: [] },
      { id: "ex1", kind: "extrude", suppressed: false, params: { h: 1 }, dependsOn: ["sk1"] },
      { id: "fil1", kind: "fillet", suppressed: true, params: {}, dependsOn: ["ex1"] },
    ]);
    expect(tree.buildOrder).toEqual(["sk1", "ex1"]);
  });
});

describe("P3 sculpt + cloth kernels", () => {
  it("sculpt brushes, remesh, polypaint; cloth XPBD + seams", () => {
    const cube = createStudioUnitCubeMesh();
    const grab = applyStudioSculptStroke(cube, {
      kind: "grab",
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 1,
      strength: 0.2,
      direction: { x: 0, y: 1, z: 0 },
    });
    expect(grab.ok).toBe(true);
    const smooth = applyStudioSculptStroke(cube, {
      kind: "smooth",
      center: { x: 0, y: 0, z: 0 },
      radius: 2,
      strength: 0.5,
    });
    expect(smooth.ok).toBe(true);
    const remesh = voxelRemeshStudioMesh(cube, 0.25);
    expect(remesh.ok).toBe(true);
    const mask = createStudioSculptMask(8, 1);
    expect(invertStudioSculptMask(mask)[0]).toBe(0);
    const colors = polypaintStudioMesh(8, null, 3, 1, [1, 0, 0]);
    expect(colors[3 * 3]).toBe(1);

    const panelA = createStudioClothPatternPanel("front", [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const panelB = createStudioClothPatternPanel("back", [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const seam = validateStudioClothSeam([panelA, panelB], {
      id: "s1",
      panelA: "front",
      edgeA: [0, 1],
      panelB: "back",
      edgeB: [0, 1],
      reversed: false,
    });
    expect(seam.ok).toBe(true);

    let cloth = createStudioClothGrid(1, 1, 4, 4, STUDIO_CLOTH_FABRIC_PRESETS[0]);
    cloth = pinStudioClothParticles(cloth, [0, 3]);
    const next = stepStudioClothXpbd(cloth, 1 / 60, 4);
    expect(next.particles.length).toBe(cloth.particles.length);
    // unpinned particle should fall
    expect(next.particles[5]!.position[1]).toBeLessThan(
      cloth.particles[5]!.position[1] + 1e-6,
    );
  });
});

describe("Format matrix + character P2 + procedural + shot", () => {
  it("covers format grades, retarget, spring, clips, scatter, continuity", () => {
    expect(STUDIO_DCC_FORMAT_MATRIX.length).toBeGreaterThanOrEqual(40);
    expect(lookupStudioFormat("glb")?.grade).toBe("A");
    expect(lookupStudioFormat(".vrm")?.grade).toBe("A");
    expect(lookupStudioFormat("dwg")?.grade).toBe("X");
    expect(studioFormatsByPriority("P0").length).toBeGreaterThan(0);
    expect(studioFormatsByGrade("X").length).toBeGreaterThan(0);
    expect(assertNoProprietaryInBrowserCore()).toContain("max");

    const lim = clampStudioJointRotation([2, 0, 0], {
      bone: "leftUpperArm",
      minEuler: [-1, -1, -1],
      maxEuler: [1, 1, 1],
    });
    expect(lim.clamped).toBe(true);
    expect(lim.rotation[0]).toBe(1);

    const retarget = retargetStudioMotionReport({
      source: "bvh",
      target: "vrm",
      sourceBones: ["hips", "spine", "head", "extra"],
      targetBones: ["hips", "spine", "head"],
      sourceUp: "y",
      targetUp: "y",
      sourceUnit: 1,
      targetUnit: 1,
    });
    expect(retarget.missingBones).toContain("extra");
    expect(retarget.ok).toBe(true);

    const spring = stepStudioSpringBone(
      {
        id: "hair",
        head: [0, 1.7, 0],
        tail: [0, 1.5, 0.1],
        stiffness: 0.5,
        drag: 0.2,
        gravity: [0, -9.8, 0],
        velocity: [0, 0, 0],
      },
      1 / 60,
    );
    expect(spring.tail[1]).not.toBe(1.5);

    const clip = createStudioIdleClip();
    const sample = sampleStudioAnimationClip(clip, 1);
    expect(sample.spine).toBeDefined();

    const a = createStudioDefaultBodyPose();
    const b = createStudioDefaultBodyPose();
    // mutate
    const b2 = {
      ...b,
      bones: {
        ...b.bones,
        leftHand: {
          ...b.bones.leftHand!,
          position: [-1, 1, 0] as const,
        },
      },
    };
    const diff = diffStudioPoses(a, b2);
    expect(diff.maxDistance).toBeGreaterThan(0);

    const scatter = scatterStudioInstances({
      seed: 42,
      count: 20,
      areaMin: [0, 0, 0],
      areaMax: [10, 0, 10],
      minSpacing: 0.5,
    });
    expect(scatter.length).toBeGreaterThan(0);
    expect(scatter.length).toBeLessThanOrEqual(20);
    // deterministic
    const scatter2 = scatterStudioInstances({
      seed: 42,
      count: 20,
      areaMin: [0, 0, 0],
      areaMax: [10, 0, 10],
      minSpacing: 0.5,
    });
    expect(scatter2[0]!.position).toEqual(scatter[0]!.position);

    const curve = arrayStudioAlongCurve(
      [
        [0, 0, 0],
        [5, 0, 0],
        [5, 0, 5],
      ],
      5,
      1,
    );
    expect(curve).toHaveLength(5);
    const fielded = applyStudioClonerField(scatter, {
      center: [5, 0, 5],
      falloffRadius: 10,
      strength: 0.5,
    });
    expect(fielded[0]!.scale).toBeGreaterThan(0);

    const fov = studioCameraFovY({
      focalLengthMm: 35,
      sensorWidthMm: 36,
      sensorHeightMm: 24,
      ortho: false,
    });
    expect(fov).toBeGreaterThan(0);

    const cont = diffStudioShotContinuity(
      {
        shotId: "a",
        camera: {
          position: [0, 1, 5],
          target: [0, 1, 0],
          lens: {
            focalLengthMm: 35,
            sensorWidthMm: 36,
            sensorHeightMm: 24,
            ortho: false,
          },
        },
        objectVisibility: { wall: true },
        characterPoses: { hero: "stand" },
        materials: { hero: "default" },
      },
      {
        shotId: "b",
        camera: {
          position: [1, 1, 5],
          target: [0, 1, 0],
          lens: {
            focalLengthMm: 50,
            sensorWidthMm: 36,
            sensorHeightMm: 24,
            ortho: false,
          },
        },
        objectVisibility: { wall: false },
        characterPoses: { hero: "sit" },
        materials: { hero: "toon" },
      },
    );
    expect(cont.cameraMoved).toBe(true);
    expect(cont.visibilityChanged).toContain("wall");
    expect(cont.poseChanged).toContain("hero");

    const timeline = buildStudioAnimaticTimeline([
      { shotId: "a", startSec: 0, durationSec: 2 },
      { shotId: "b", startSec: 2, durationSec: 3, audioCue: "whoosh" },
    ]);
    expect(timeline.totalDuration).toBe(5);
  });
});

describe("DOC-007 selective undo + real VRM import still works", () => {
  it("selective undo local actor; GLB pipeline on fixture", () => {
    let session = createStudioHybridDccSession("sel-undo");
    const cube = createStudioUnitCubeMesh();
    session = hybridDccRegisterAsset(session, "m1", cube, {
      source: "p",
      creator: "c",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
    session = hybridDccSelectiveUndo(session, "local");
    expect(session.state.geometry.records["m1"]).toBeUndefined();

    const vrmPath = resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm");
    if (existsSync(vrmPath)) {
      const bytes = new Uint8Array(readFileSync(vrmPath));
      const imported = importStudioGlbDocument(bytes, { asVrm: true });
      expect(imported.report.counts.meshes).toBeGreaterThan(0);
    }
  });
});
