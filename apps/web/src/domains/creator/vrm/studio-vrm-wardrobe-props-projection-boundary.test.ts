import { readFileSync } from "node:fs";

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";
import { measureStudioVrmWardrobeMetrics } from "./StudioVrmWardrobePropsProjection";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";


const poserSource = readStudioVrmPoserImplementationSource();
const projectionSource = readFileSync(
  new URL("./StudioVrmWardrobePropsProjection.tsx", import.meta.url),
  "utf8",
);
const propMaterialSource = readFileSync(
  new URL("./studio-vrm-prop-material.ts", import.meta.url),
  "utf8",
);
const propAssetRuntimeSource = readFileSync(
  new URL("./studio-vrm-prop-asset-runtime.ts", import.meta.url),
  "utf8",
);
const xpbdSkirtAttachmentSource = readFileSync(
  new URL("./StudioVrmXpbdSkirtAttachment.tsx", import.meta.url),
  "utf8",
);
const lazyUiSource = readFileSync(new URL("../studio-page-lazy-ui.ts", import.meta.url), "utf8");
const proportionFitSource = readFileSync(
  new URL("./studio-vrm-proportion-fit-transaction.ts", import.meta.url),
  "utf8",
);

function requiredIndex(source: string, token: string, from = 0): number {
  const index = source.indexOf(token, from);
  if (index < 0) throw new Error(`Expected source token was not found: ${token}`);
  return index;
}

function sourceBetween(source: string, startToken: string, endToken: string): string {
  const start = requiredIndex(source, startToken);
  const end = requiredIndex(source, endToken, start + startToken.length);
  return source.slice(start, end);
}

function createRestPoseVrm(): VRM {
  const scene = new THREE.Group();
  const bones = new Map<VRMHumanBoneName, THREE.Object3D>();
  const add = (name: VRMHumanBoneName, position: THREE.Vector3Tuple) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...position);
    scene.add(bone);
    bones.set(name, bone);
  };

  add("hips", [0, 1, 0]);
  add("spine", [0, 1.22, 0]);
  add("neck", [0, 1.62, 0]);
  add("leftUpperArm", [0.31, 1.48, 0]);
  add("rightUpperArm", [-0.31, 1.48, 0]);
  add("leftLowerArm", [0.59, 1.29, 0]);
  add("rightLowerArm", [-0.59, 1.29, 0]);
  add("leftHand", [0.79, 1.13, 0]);
  add("rightHand", [-0.79, 1.13, 0]);
  add("leftUpperLeg", [0.14, 0.91, 0]);
  add("rightUpperLeg", [-0.14, 0.91, 0]);
  add("leftLowerLeg", [0.14, 0.48, 0]);
  add("rightLowerLeg", [-0.14, 0.48, 0]);
  add("leftFoot", [0.14, 0.08, 0.12]);
  add("rightFoot", [-0.14, 0.08, 0.12]);

  return {
    scene,
    humanoid: {
      getRawBoneNode: (name: VRMHumanBoneName) => bones.get(name) ?? null,
    },
  } as unknown as VRM;
}

describe("Studio VRM wardrobe/prop projection boundary", () => {
  it("keeps the complete heavy render runtime in one one-way lazy leaf", () => {
    expect(poserSource).toContain('from "./StudioVrmWardrobePropsProjection";');
    for (const exportedName of [
      "StudioVrmPropAttachment",
      "StudioVrmWardrobeAttachment",
      "StudioVrmRuntimeCommit",
    ]) {
      expect(projectionSource).toContain(`export function ${exportedName}(`);
      expect(poserSource).toContain(exportedName);
    }
    expect(projectionSource).toContain(
      "export function measureStudioVrmWardrobeMetrics(",
    );
    expect(proportionFitSource).toContain("measureStudioVrmWardrobeMetrics");

    expect(poserSource).not.toMatch(
      /function (?:VrmPropAttachment|measureVrmWardrobeMetrics|VrmWardrobeAttachment|VrmRuntimeCommit)\b/u,
    );
    for (const privateRuntimeOwner of [
      "pendingPropDisposals",
      "STUDIO_VRM_PROP_GEOMETRY_QUALITY",
      "createGarmentWeaveTexture",
      "assembleSkinnedGarment",
      "pendingGarmentDisposals",
    ]) {
      expect(projectionSource).toContain(privateRuntimeOwner);
      expect(poserSource).not.toContain(privateRuntimeOwner);
    }

    expect(projectionSource).not.toMatch(
      /from ["']\.\/(?:StudioVrmPoser|StudioPage)["']/u,
    );
    expect(projectionSource).toContain(
      'from "./StudioVrmXpbdSkirtAttachment";',
    );
    expect(xpbdSkirtAttachmentSource).not.toMatch(
      /from ["']\.\/(?:StudioVrmPoser|StudioPage)["']/u,
    );
    expect(lazyUiSource).toMatch(/\(\)\s*=>\s*import\(\s*["']\.\/(?:vrm\/)?StudioVrmPoser["']\)/u);
    expect(lazyUiSource).not.toContain("StudioVrmWardrobePropsProjection");
  });

  it("preserves the smart prop follower, secondary-hand IK, quality, and source-aware disposal", () => {
    const propRuntime = sourceBetween(
      projectionSource,
      "const pendingPropDisposals",
      "/* ── 실장착 워드로브",
    );

    expect(propRuntime).toContain("const VRM_FRAME_PROP_PRIORITY = -2;");
    expect(propRuntime).toContain("new RoundedBoxGeometry(width, height, depth, 3, radius)");
    expect(propRuntime).toContain("group.scale.setScalar(resolved.scale);");
    expect(propRuntime).toContain(".multiplyScalar(resolved.scale)");
    expect(propRuntime).toContain(".applyQuaternion(group.quaternion)");
    expect(propRuntime).toContain("resolveSecondaryHandConstraint(");
    expect(propRuntime).toContain("metrics.handSockets[secondary.bone]");
    expect(propRuntime).toContain("applyVrmTwoBoneGrip(");
    expect(propRuntime).toContain("{ targetQuaternion, state: secondaryGripState }");
    expect(propRuntime).toContain("}, VRM_FRAME_PROP_PRIORITY);");
    expect(propRuntime.match(/queueMicrotask\(/gu)).toHaveLength(1);
    expect(propRuntime).toContain("cancelScheduledPropDisposal(proceduralObject);");
    expect(propRuntime).toContain("return () => schedulePropDisposal(proceduralObject);");
    expect(propRuntime).toContain("definition.geometrySource.kind !== \"procedural\"");
    expect(propRuntime).toContain("acquireStudioVrmPropAsset(instance.propId, source)");
    expect(propRuntime).toContain("loadedLease.release();");
    expect(propRuntime).toContain("lease?.release();");
    expect(propRuntime).toContain("!loadedGltfProp.lease.released");
    expect(propRuntime).toContain("applyStudioVrmPropTint(gltfObject, instance.propId, instance.color)");
    expect(propMaterialSource).toContain("material.userData.toonspectrum_tintable === true");
    expect(propMaterialSource).toContain(
      'propId === "smartphone" && material.name === "PhoneV2_AnodizedBody"',
    );
  });

  it("loads first-party GLBs through a cached clone lease without a procedural fallback", () => {
    expect(propAssetRuntimeSource).toContain(
      'import("three/examples/jsm/loaders/GLTFLoader.js")',
    );
    expect(propAssetRuntimeSource).toContain("const cache = new Map<string, PropAssetCacheEntry>();");
    expect(propAssetRuntimeSource).toContain("entry.reservations += 1;");
    expect(propAssetRuntimeSource).toContain("object = await dependencies.cloneRoot(root);");
    expect(propAssetRuntimeSource).toContain("object.removeFromParent();");
    expect(propAssetRuntimeSource).toContain("if (entry.root) dependencies.disposeRoot(entry.root);");
    expect(propAssetRuntimeSource).toContain(
      "scheduleCleanup: (callback) => globalThis.queueMicrotask(callback)",
    );
    expect(propAssetRuntimeSource).not.toContain("scheduleCleanup: queueMicrotask");
    expect(propAssetRuntimeSource).not.toContain("buildPropObject");
    expect(propAssetRuntimeSource).not.toMatch(/BoxGeometry|fallback cube/iu);
  });

  it("keeps skinned and explicitly selected rigid assembly isolated with material-only updates", () => {
    const wardrobeRuntime = sourceBetween(
      projectionSource,
      "function StudioVrmSelectedWardrobeAttachment(",
      "/** base pose/tracking과 모든 소품 IK가 끝난 뒤",
    );
    const renderable = sourceBetween(
      wardrobeRuntime,
      "const renderable = useMemo(() => {",
      "const entries = renderable.entries;",
    );
    const materialUpdate = sourceBetween(
      wardrobeRuntime,
      "useLayoutEffect(() => {",
      "// GPU 버퍼 정리",
    );

    expect(projectionSource).toContain("buildStudioVrmSkinnedGarment({");
    expect(projectionSource).toContain("buildStudioVrmGarmentGeometry(part.shape)");
    expect(projectionSource).toContain('mode="skinned-procedural-v1"');
    expect(projectionSource).toContain('mode="rigid-procedural"');
    const skinnedSelection = sourceBetween(
      renderable,
      'if (mode === "skinned-procedural-v1")',
      "const groups = assembleGarmentGroups(",
    );
    expect(skinnedSelection).toContain("entries: []");
    expect(skinnedSelection).not.toContain("assembleGarmentGroups(");
    expect(projectionSource).toContain("const pendingGarmentDisposals = new WeakMap");
    expect(projectionSource.match(/queueMicrotask\(/gu)).toHaveLength(2);
    expect(renderable).toContain("}, [vrm, equip.itemId, effectiveFit, metrics, mode]);");
    expect(renderable).not.toContain("equip.color");
    expect(renderable).not.toContain("equip.fabricId");
    expect(materialUpdate).toContain(
      "applyGarmentMaterialStyle(material, part, equip.color, equip.fabricId, nextWeave);",
    );
    expect(materialUpdate).toContain("}, [entries, equip.color, equip.fabricId]);");
    expect(wardrobeRuntime).toContain("cancelScheduledGarmentDisposal(entry.object)");
    expect(wardrobeRuntime).toContain("scheduleGarmentDisposal(entry.object)");
    expect(wardrobeRuntime).toContain("createPortal(<primitive object={entry.object} />, entry.node)");
  });

  it("measures wardrobe and prop fit inside the committed proportion-rig rest lifecycle", () => {
    const proportionTransaction = proportionFitSource;
    // 2026-08-21 의도적 변경: loadModelFromLibraryEntry 가 use-studio-vrm-model-loading.ts 로
    // 옮겨가, installVrm 다음 선언인 handlePoseSelect 를 종료 마커로 쓴다(구간은 동일).
    const installVrm = sourceBetween(
      poserSource,
      "function installVrm(",
      "function handlePoseSelect(",
    );
    const wardrobeMeasurement = requiredIndex(
      proportionTransaction,
      "wardrobe = measureStudioVrmWardrobeMetrics(vrm);",
    );
    const propMeasurement = requiredIndex(
      proportionTransaction,
      "props = measureVrmPropRigMetrics(vrm);",
      wardrobeMeasurement,
    );
    const poseApplication = requiredIndex(
      proportionTransaction,
      "return reapplyAuthoredState();",
      propMeasurement,
    );
    const runtimeInitialization = requiredIndex(
      installVrm,
      "initializeProportionRigRuntime(nextVrm);",
    );
    const pendingRestore = requiredIndex(installVrm, "const pending = pendingPoseDataRef.current;");
    const restore = requiredIndex(installVrm, "commitFullStateRestore(pendingFull, nextVrm, {");
    const spawnTransaction = requiredIndex(
      installVrm,
      "createStudioVrmProportionPoseTransaction(nextVrm, {",
      restore,
    );
    const spawnCommit = requiredIndex(
      installVrm,
      "applyProportionRigState(",
      spawnTransaction,
    );

    expect(wardrobeMeasurement).toBeLessThan(propMeasurement);
    expect(propMeasurement).toBeLessThan(poseApplication);
    expect(runtimeInitialization).toBeLessThan(pendingRestore);
    expect(pendingRestore).toBeLessThan(restore);
    expect(spawnTransaction).toBeLessThan(spawnCommit);
    expect(poserSource).not.toContain("requestAnimationFrame(() => {\n      if (vrmRef.current !== vrm) return;\n      setWardrobeMetrics");
    expect(projectionSource).toContain("[instance.bone, rigRevision, vrm]");
  });

  it("preserves raw-rig wardrobe measurements as an exported engine adapter", () => {
    const metrics = measureStudioVrmWardrobeMetrics(createRestPoseVrm());

    expect(metrics.source).toBe("raw-rig");
    expect(metrics.shoulderW).toBeCloseTo(0.62, 6);
    expect(metrics.hipW).toBeCloseTo(0.28, 6);
    expect(metrics.hipsToSpine).toBeCloseTo(0.22, 6);
    expect(metrics.spineToNeck).toBeCloseTo(0.4, 6);
    expect(metrics.upperArm.left.len).toBeGreaterThan(0.3);
    expect(metrics.lowerLeg.right.len).toBeGreaterThan(0.4);
    expect(metrics.footForward.left.every(Number.isFinite)).toBe(true);
  });

  it("keeps runtime commit after prop IK at the exact -1 priority", () => {
    const commitRuntime = sourceBetween(
      projectionSource,
      "export function StudioVrmRuntimeCommit(",
      "return null;\n}",
    );

    expect(projectionSource).toContain("const VRM_FRAME_COMMIT_PRIORITY = -1;");
    expect(commitRuntime).toContain("Math.min(delta, PHYSICS_PREVIEW_MAX_DELTA)");
    expect(commitRuntime).toContain("vrm.update(springDelta);");
    expect(commitRuntime).toContain("}, VRM_FRAME_COMMIT_PRIORITY);");
  });
});
