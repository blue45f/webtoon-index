import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES, type StudioHumanoidBoneName } from "../studio-humanoid-bones";

import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  STUDIO_VRM_PROPORTION_PRESETS,
  STUDIO_VRM_REFERENCE_BONE_SNAPSHOT,
  createStudioVrmProportions,
  resolveVrmProportionSkeleton,
  sanitizeStudioVrmProportions,
  type StudioVrmProportionBoneTarget,
  type StudioVrmProportions,
} from "./studio-vrm-proportion-core";
import {
  createStudioVrmProportionRigRuntime,
  type StudioVrmProportionRigAdapter,
  type StudioVrmProportionRigRuntime,
} from "./studio-vrm-proportion-rig-runtime";

type Transform = {
  readonly position: readonly number[];
  readonly quaternion: readonly number[];
  readonly scale: readonly number[];
};

type RigFixtureOptions = {
  readonly headLength?: number;
  readonly missing?: ReadonlySet<StudioHumanoidBoneName>;
  readonly intermediaryBones?: ReadonlySet<StudioHumanoidBoneName>;
  readonly unsafeIntermediaryBone?: StudioHumanoidBoneName;
  readonly rotatedBones?: ReadonlySet<StudioHumanoidBoneName>;
  readonly rotatedBoneEuler?: readonly [number, number, number];
  readonly includeManagers?: boolean;
  readonly includeColliderSync?: boolean;
  readonly rootTransform?: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
    readonly scale: readonly [number, number, number];
  };
};

const REFERENCE = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT;
const REFERENCE_BY_NAME = new Map(REFERENCE.bones.map((bone) => [bone.name, bone]));
const NEUTRAL_SKELETON = resolveVrmProportionSkeleton(NEUTRAL_STUDIO_VRM_PROPORTIONS);

function snapshotTransform(node: THREE.Object3D): Transform {
  return {
    position: node.position.toArray(),
    quaternion: node.quaternion.toArray(),
    scale: node.scale.toArray(),
  };
}

function snapshotRig(nodes: ReadonlyMap<StudioHumanoidBoneName, THREE.Object3D>) {
  return new Map([...nodes].map(([name, node]) => [name, snapshotTransform(node)]));
}

function expectTransform(node: THREE.Object3D, transform: Transform) {
  expect(node.position.toArray()).toEqual(transform.position);
  expect(node.quaternion.toArray()).toEqual(transform.quaternion);
  expect(node.scale.toArray()).toEqual(transform.scale);
}

function expectRig(
  nodes: ReadonlyMap<StudioHumanoidBoneName, THREE.Object3D>,
  expected: ReadonlyMap<StudioHumanoidBoneName, Transform>
) {
  for (const [name, node] of nodes) expectTransform(node, expected.get(name)!);
}

function isDescendant(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (cursor === ancestor) return true;
  }
  return false;
}

function nearestIncludedParent(
  name: StudioHumanoidBoneName,
  included: ReadonlySet<StudioHumanoidBoneName>
) {
  let parent = REFERENCE_BY_NAME.get(name)?.parent ?? null;
  while (parent && !included.has(parent)) parent = REFERENCE_BY_NAME.get(parent)?.parent ?? null;
  return parent;
}

function rootLocalPosition(root: THREE.Object3D, node: THREE.Object3D) {
  root.updateMatrixWorld(true);
  return root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
}

function createRigFixture(options: RigFixtureOptions = {}) {
  const root = new THREE.Group();
  root.name = "vrm-model-root";
  const rootTransform = options.rootTransform ?? {
    position: [0, 0, 0] as const,
    rotation: [0, 0, 0] as const,
    scale: [1, 1, 1] as const,
  };
  root.position.set(...rootTransform.position);
  root.quaternion.setFromEuler(new THREE.Euler(...rootTransform.rotation));
  root.scale.set(...rootTransform.scale);

  const missing = options.missing ?? new Set<StudioHumanoidBoneName>();
  const included = new Set(STUDIO_HUMANOID_BONE_NAMES.filter((name) => !missing.has(name)));
  const nodes = new Map<StudioHumanoidBoneName, THREE.Object3D>();
  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    if (!included.has(name)) continue;
    const node = new THREE.Object3D();
    node.name = `raw:${name}`;
    nodes.set(name, node);
  }

  const intermediaries = new Map<StudioHumanoidBoneName, THREE.Object3D>();
  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    const node = nodes.get(name);
    if (!node) continue;
    const parentName = nearestIncludedParent(name, included);
    const logicalParent = parentName ? nodes.get(parentName)! : root;
    let actualParent = logicalParent;
    if (options.intermediaryBones?.has(name) || options.unsafeIntermediaryBone === name) {
      const intermediary = new THREE.Group();
      intermediary.name = `intermediary:${name}`;
      intermediary.position.set(0.013, -0.007, 0.004);
      intermediary.quaternion.setFromEuler(new THREE.Euler(0.08, -0.11, 0.05));
      if (options.unsafeIntermediaryBone === name) intermediary.scale.set(1, 1.2, 1);
      else intermediary.scale.setScalar(1.03);
      logicalParent.add(intermediary);
      intermediaries.set(name, intermediary);
      actualParent = intermediary;
    }
    actualParent.add(node);
    if (options.rotatedBones?.has(name)) {
      node.quaternion.setFromEuler(
        new THREE.Euler(...(options.rotatedBoneEuler ?? [0.19, -0.13, 0.17]))
      );
    }
    root.updateMatrixWorld(true);
    const desiredRootPosition = NEUTRAL_SKELETON.get(name)?.worldPosition;
    if (!desiredRootPosition) throw new Error(`Reference skeleton is missing ${name}`);
    const desiredWorld = new THREE.Vector3(...desiredRootPosition).applyMatrix4(root.matrixWorld);
    node.position.copy(actualParent.worldToLocal(desiredWorld));
    root.updateMatrixWorld(true);
  }

  const restQuaternions = new Map(
    [...nodes].map(([name, node]) => [name, node.quaternion.clone()] as const)
  );
  const authoredQuaternions = new Map(
    [...nodes].map(([name, node]) => [name, node.quaternion.clone()] as const)
  );
  const authoredRoot = snapshotTransform(root);
  const events: string[] = [];
  const colliderScales: number[] = [];
  const colliderScaledRoots: ReadonlySet<THREE.Object3D>[] = [];
  let generation = 1;
  let activeNodes: ReadonlyMap<StudioHumanoidBoneName, THREE.Object3D> = nodes;
  let failSpringCount = 0;
  let generationOnNextReset: number | null = null;

  const normalizedMount = new THREE.Group();
  normalizedMount.name = "normalized-mount";
  const beforeNormalized = new THREE.Object3D();
  const afterNormalized = new THREE.Object3D();
  normalizedMount.add(beforeNormalized);
  let normalizedRoot = new THREE.Group();
  normalizedRoot.name = "normalized-root:0";
  normalizedMount.add(normalizedRoot, afterNormalized);
  root.add(normalizedMount);
  const retiredNormalizedRoots: THREE.Object3D[] = [];
  let normalizedPositions = new Map<StudioHumanoidBoneName, readonly number[]>();
  let rebuildCount = 0;
  const rootTransformsAtRebuild: Transform[] = [];

  const rebuildNormalizedRig = () => {
    events.push("rebuild");
    rootTransformsAtRebuild.push(snapshotTransform(root));
    const oldRoot = normalizedRoot;
    const parent = oldRoot.parent;
    if (!parent) return false;
    const siblingIndex = parent.children.indexOf(oldRoot);
    const replacement = new THREE.Group();
    rebuildCount += 1;
    replacement.name = `normalized-root:${rebuildCount}`;
    parent.remove(oldRoot);
    parent.add(replacement);
    const appendedIndex = parent.children.indexOf(replacement);
    parent.children.splice(appendedIndex, 1);
    parent.children.splice(siblingIndex, 0, replacement);
    normalizedRoot = replacement;
    retiredNormalizedRoots.push(oldRoot);
    normalizedPositions = new Map(
      [...nodes].map(([name, node]) => [name, rootLocalPosition(root, node).toArray()] as const)
    );
    return true;
  };

  const adapter: StudioVrmProportionRigAdapter = {
    root,
    getModelGeneration: () => generation,
    getRawBoneNode: (name) => activeNodes.get(name) ?? null,
    resetNormalizedPoseAndSyncRawRest: () => {
      events.push("reset");
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.scale.set(1, 1, 1);
      for (const [name, node] of nodes) node.quaternion.copy(restQuaternions.get(name)!);
      root.updateMatrixWorld(true);
      if (generationOnNextReset !== null) {
        generation = generationOnNextReset;
        generationOnNextReset = null;
      }
      return true;
    },
    rebuildNormalizedRig,
    ...(options.includeManagers === false
      ? {}
      : {
          setNodeConstraintInitState: () => {
            events.push("constraint");
            return true;
          },
          setSpringBoneInitState: () => {
            events.push("spring");
            if (failSpringCount <= 0) return true;
            failSpringCount -= 1;
            return false;
          },
          ...(options.includeColliderSync === false
            ? {}
            : {
                syncSpringBoneColliderShapes: (
                  uniformScale: number,
                  scaledSubtreeRoots: ReadonlySet<THREE.Object3D>,
                ) => {
                  events.push("colliders");
                  colliderScales.push(uniformScale);
                  colliderScaledRoots.push(scaledSubtreeRoots);
                  return true;
                },
              }),
        }),
    reapplyAuthoredPose: () => {
      events.push("pose");
      root.position.fromArray(authoredRoot.position);
      root.quaternion.fromArray(authoredRoot.quaternion);
      root.scale.fromArray(authoredRoot.scale);
      for (const [name, node] of nodes) node.quaternion.copy(authoredQuaternions.get(name)!);
      root.updateMatrixWorld(true);
      return true;
    },
  };

  return {
    adapter,
    colliderScales,
    colliderScaledRoots,
    events,
    headLength: options.headLength ?? REFERENCE.headLength,
    intermediaries,
    nodes,
    normalizedMount,
    retiredNormalizedRoots,
    root,
    rootTransformsAtRebuild,
    get normalizedPositions() {
      return normalizedPositions;
    },
    get normalizedRoot() {
      return normalizedRoot;
    },
    setActiveNodes(value: ReadonlyMap<StudioHumanoidBoneName, THREE.Object3D>) {
      activeNodes = value;
    },
    setGeneration(value: number) {
      generation = value;
    },
    setGenerationOnNextReset(value: number) {
      generationOnNextReset = value;
    },
    failNextSpring(count = 1) {
      failSpringCount = count;
    },
  };
}

function runtimeFor(fixture: ReturnType<typeof createRigFixture>): StudioVrmProportionRigRuntime {
  const created = createStudioVrmProportionRigRuntime(fixture.adapter, {
    headLength: fixture.headLength,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.message);
  return created.runtime;
}

function manualProportions(patch: Partial<StudioVrmProportions>) {
  return sanitizeStudioVrmProportions({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...patch });
}

function targetMap(targets: readonly StudioVrmProportionBoneTarget[]) {
  return new Map(targets.map((target) => [target.boneName, target]));
}

function expectVectorClose(actual: THREE.Vector3, expected: readonly number[], digits = 10) {
  expect(actual.x).toBeCloseTo(expected[0]!, digits);
  expect(actual.y).toBeCloseTo(expected[1]!, digits);
  expect(actual.z).toBeCloseTo(expected[2]!, digits);
}

describe("studio-vrm-proportion-rig-runtime", () => {
  it("applies all 3–9 head presets to real parented bones and records their root-local world positions", () => {
    const fixture = createRigFixture();
    const runtime = runtimeFor(fixture);

    for (const preset of [...STUDIO_VRM_PROPORTION_PRESETS].sort(
      (a, b) => a.targetHeadUnits - b.targetHeadUnits
    )) {
      const result = runtime.apply(preset.proportions);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.metrics.headUnits).toBeCloseTo(preset.targetHeadUnits, 5);
      expect(result.presetResolution?.targetHeadUnits).toBe(preset.targetHeadUnits);

      const expected = resolveVrmProportionSkeleton(result.runtimeProportions, runtime.snapshot);
      const receiptPositions = new Map(
        result.worldPositions.map((position) => [position.boneName, position.position])
      );
      for (const [name, node] of fixture.nodes) {
        const expectedNode = expected.get(name);
        expect(expectedNode).toBeDefined();
        expectVectorClose(rootLocalPosition(fixture.root, node), expectedNode!.worldPosition);
        expectVectorClose(
          new THREE.Vector3(...receiptPositions.get(name)!),
          expectedNode!.worldPosition
        );
      }
    }
  });

  it("solves preset head units and metrics from actual world positions on rotated raw hierarchies", () => {
    const fixture = createRigFixture({
      rotatedBones: new Set(["spine"]),
      rotatedBoneEuler: [0, 0, 0.9],
    });
    const runtime = runtimeFor(fixture);

    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      const result = runtime.apply(preset.proportions);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const head = fixture.nodes.get("head")!;
      const headPosition = rootLocalPosition(fixture.root, head);
      const headTarget = result.targets.find((target) => target.boneName === "head")!;
      const actualHeadLength = fixture.headLength * headTarget.scale;
      const actualHeadUnits = (headPosition.y + actualHeadLength) / actualHeadLength;
      const actualArmLength = rootLocalPosition(
        fixture.root,
        fixture.nodes.get("leftUpperArm")!
      ).distanceTo(rootLocalPosition(fixture.root, fixture.nodes.get("leftHand")!));

      expect(actualHeadUnits).toBeCloseTo(preset.targetHeadUnits, 8);
      expect(result.metrics.headUnits).toBeCloseTo(actualHeadUnits, 10);
      expect(result.metrics.armLength).toBeCloseTo(actualArmLength, 10);
      expect(result.presetResolution).toMatchObject({
        targetHeadUnits: preset.targetHeadUnits,
        achievedHeadUnits: result.metrics.headUnits,
        clamped: false,
      });
    }
  });

  it("re-solves recognized presets against non-reference head measurements but preserves authored values", () => {
    const fixture = createRigFixture({ headLength: 0.22 });
    const runtime = runtimeFor(fixture);

    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      const result = runtime.apply(preset.proportions);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.metrics.headUnits).toBeCloseTo(preset.targetHeadUnits, 5);
      expect(result.authoredProportions.headBodyRatio).toBe(preset.proportions.headBodyRatio);
      expect(result.presetResolution).toEqual({
        presetId: preset.id,
        targetHeadUnits: preset.targetHeadUnits,
        authoredHeadBodyRatio: preset.proportions.headBodyRatio,
        runtimeHeadBodyRatio: result.runtimeProportions.headBodyRatio,
        achievedHeadUnits: result.metrics.headUnits,
        clamped: false,
      });
    }

    const manual = manualProportions({ headBodyRatio: 1.37, legLength: 1.12 });
    const manualResult = runtime.apply(manual);
    expect(manualResult.ok).toBe(true);
    if (manualResult.ok) {
      expect(manualResult.presetResolution).toBeNull();
      expect(manualResult.runtimeProportions).toEqual(manualResult.authoredProportions);
    }
  });

  it("reports achieved head units when a model-specific preset solve reaches a safety clamp", () => {
    const fixture = createRigFixture({ headLength: 0.05 });
    const result = runtimeFor(fixture).apply(createStudioVrmProportions("sd-chibi-3"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.presetResolution?.clamped).toBe(true);
    expect(result.presetResolution?.targetHeadUnits).toBe(3);
    expect(result.presetResolution?.achievedHeadUnits).toBe(result.metrics.headUnits);
    expect(result.presetResolution?.achievedHeadUnits).toBeGreaterThan(3);
  });

  it("keeps every introduced scale uniform, every matrix orthogonal, and every logical joint connected", () => {
    const fixture = createRigFixture({
      intermediaryBones: new Set(["head", "leftHand", "rightFoot"]),
      rotatedBones: new Set(["spine", "leftUpperArm", "rightUpperLeg"]),
    });
    const runtime = runtimeFor(fixture);
    const result = runtime.apply(
      manualProportions({
        overallHeight: 1.3,
        headBodyRatio: 2.4,
        armLength: 1.4,
        legLength: 0.6,
        torsoLength: 1.3,
        shoulderWidth: 1.35,
        handScale: 1.55,
        footScale: 1.5,
        neckLength: 1.7,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    fixture.root.updateMatrixWorld(true);
    for (const node of fixture.nodes.values()) {
      expect(node.scale.x).toBeCloseTo(node.scale.y, 12);
      expect(node.scale.y).toBeCloseTo(node.scale.z, 12);
      const elements = node.matrixWorld.elements;
      const x = new THREE.Vector3(elements[0], elements[1], elements[2]).normalize();
      const y = new THREE.Vector3(elements[4], elements[5], elements[6]).normalize();
      const z = new THREE.Vector3(elements[8], elements[9], elements[10]).normalize();
      expect(x.dot(y)).toBeCloseTo(0, 10);
      expect(y.dot(z)).toBeCloseTo(0, 10);
      expect(z.dot(x)).toBeCloseTo(0, 10);
    }

    const targets = targetMap(result.targets);
    for (const bone of runtime.snapshot.bones) {
      const node = fixture.nodes.get(bone.name)!;
      const logicalParent = bone.parent ? fixture.nodes.get(bone.parent)! : fixture.root;
      const target = targets.get(bone.name)!;
      const expectedWorld = new THREE.Vector3(...target.position).applyMatrix4(
        logicalParent.matrixWorld
      );
      expectVectorClose(node.getWorldPosition(new THREE.Vector3()), expectedWorld.toArray());
    }
  });

  it("is absolute-from-rest and does not drift across repeated preset changes", () => {
    const fixture = createRigFixture({
      intermediaryBones: new Set(["head", "leftHand", "leftFoot"]),
    });
    const runtime = runtimeFor(fixture);
    const chibi = createStudioVrmProportions("sd-chibi-3");
    expect(runtime.apply(chibi).ok).toBe(true);
    const first = snapshotRig(fixture.nodes);

    for (let index = 0; index < 20; index += 1) {
      expect(runtime.apply(createStudioVrmProportions("runway-9")).ok).toBe(true);
      expect(runtime.apply(chibi).ok).toBe(true);
      expectRig(fixture.nodes, first);
    }
  });

  it("restores exact cached locals at neutral and dispose, including intermediary hierarchies", () => {
    const fixture = createRigFixture({
      intermediaryBones: new Set(["head", "leftUpperArm", "rightFoot"]),
      rootTransform: {
        position: [0.3, 0.16, -0.4],
        rotation: [0, 0.42, 0],
        scale: [1.08, 1.17, 1.08],
      },
    });
    const originalRig = snapshotRig(fixture.nodes);
    const originalRoot = snapshotTransform(fixture.root);
    const runtime = runtimeFor(fixture);

    expect(runtime.apply(createStudioVrmProportions("sd-chibi-3")).ok).toBe(true);
    const restored = runtime.restore();
    expect(restored.ok).toBe(true);
    expectRig(fixture.nodes, originalRig);
    expectTransform(fixture.root, originalRoot);

    expect(runtime.apply(createStudioVrmProportions("runway-9")).ok).toBe(true);
    const disposed = runtime.dispose();
    expect(disposed.ok).toBe(true);
    expect(runtime.disposed).toBe(true);
    expectRig(fixture.nodes, originalRig);
    expectTransform(fixture.root, originalRoot);
    const afterDispose = runtime.apply(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(afterDispose.ok).toBe(false);
    if (!afterDispose.ok) expect(afterDispose.code).toBe("disposed");
  });

  it("runs normalized rebuild, constraint init, spring init, and pose in order with canonical root TRS", () => {
    const fixture = createRigFixture({
      rootTransform: {
        position: [0.7, 0.2, -0.5],
        rotation: [0, -0.35, 0],
        scale: [1.1, 1.22, 1.1],
      },
    });
    const originalRoot = snapshotTransform(fixture.root);
    const originalNormalizedRoot = fixture.normalizedRoot;
    const originalSiblingIndex = fixture.normalizedMount.children.indexOf(originalNormalizedRoot);
    const runtime = runtimeFor(fixture);
    const result = runtime.apply(createStudioVrmProportions("mini-4"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fixture.events).toEqual([
      "reset",
      "rebuild",
      "constraint",
      "colliders",
      "spring",
      "pose",
    ]);
    expect(result.stages).toEqual([
      "reset-normalized-pose-and-sync-raw-rest",
      "write-raw-proportion-targets",
      "rebuild-normalized-rig",
      "set-node-constraint-init-state",
      "sync-spring-bone-colliders",
      "set-spring-bone-init-state",
      "reapply-authored-pose",
    ]);
    expect(fixture.rootTransformsAtRebuild[0]).toEqual({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    expectTransform(fixture.root, originalRoot);
    expect(originalNormalizedRoot.parent).toBeNull();
    expect(fixture.normalizedRoot.parent).toBe(fixture.normalizedMount);
    expect(fixture.normalizedMount.children.indexOf(fixture.normalizedRoot)).toBe(originalSiblingIndex);
  });

  it("keeps a leaf's non-uniform sculpt scale and only multiplies it uniformly", () => {
    // Sculpting rigs put shape on leaves, so `head` legitimately carries a non-uniform rest scale.
    // Collapsing it to its mean flattened the face the moment any body slider moved, and requiring
    // uniformity outright rejected 18 of the 21 shipped generated presets outright.
    const fixture = createRigFixture();
    // A bone with no humanoid bone beneath it. Generated characters put the face sculpt on `head`,
    // which is a leaf there; this fixture models a full humanoid where `head` still carries eyes.
    const leaf = [...fixture.nodes.entries()].find(
      ([, node]) => ![...fixture.nodes.values()].some((other) => other !== node && isDescendant(other, node)),
    );
    expect(leaf).toBeDefined();
    if (!leaf) return;
    const [, sculpted] = leaf;
    sculpted.scale.set(1.05, 0.94, 1);
    sculpted.updateMatrix();
    fixture.root.updateMatrixWorld(true);

    const runtime = runtimeFor(fixture);
    const result = runtime.apply(createStudioVrmProportions("sd-chibi-3"));
    expect(result.ok).toBe(true);

    // The authored aspect ratio survives; the factor the runtime introduced is the same on all axes.
    expect(sculpted.scale.x / sculpted.scale.y).toBeCloseTo(1.05 / 0.94, 12);
    expect(sculpted.scale.x / 1.05).toBeCloseTo(sculpted.scale.z / 1, 12);
    expect(sculpted.scale.y / 0.94).toBeCloseTo(sculpted.scale.z / 1, 12);
  });

  it("rejects a non-uniform leaf scale that a non-humanoid child would inherit", () => {
    // 휴머노이드 소속 여부는 기준이 아니다. 눈·턱 본이 없는 머리라도 액세서리나 스프링 계층을
    // 이고 있을 수 있고, 거기서 회전이 일어나면 전단을 물려받는다. 안전한 것은 자식이 비균등
    // 성분을 **상쇄**할 때뿐이다 — 생성 아바타의 역스케일 피벗이 하는 일이다.
    const withChild = (childScale: readonly [number, number, number]) => {
      const fixture = createRigFixture();
      const leaf = [...fixture.nodes.entries()].find(
        ([, node]) =>
          ![...fixture.nodes.values()].some((other) => other !== node && isDescendant(other, node)),
      );
      expect(leaf).toBeDefined();
      if (!leaf) return null;
      const [, sculpted] = leaf;
      sculpted.scale.set(1.25, 0.8, 1);
      const child = new THREE.Object3D();
      child.scale.set(childScale[0], childScale[1], childScale[2]);
      sculpted.add(child);
      sculpted.updateMatrix();
      fixture.root.updateMatrixWorld(true);
      return createStudioVrmProportionRigRuntime(fixture.adapter, {
        headLength: fixture.headLength,
      });
    };

    const bare = withChild([1, 1, 1]);
    expect(bare?.ok, "상쇄하지 않는 자식이 있는데 비균등 조형을 허용했다").toBe(false);
    if (bare && !bare.ok) expect(bare.code).toBe("unsafe-transform");

    // 역스케일 피벗이 비균등 성분을 되돌리면 전단이 전파될 수 없다.
    const pivoted = withChild([1 / 1.25, 1 / 0.8, 1]);
    expect(pivoted?.ok, "역스케일 피벗이 있는데도 거부했다").toBe(true);
  });

  it("rejects a cancelling pivot that also rotates", () => {
    // `S · R · S⁻¹` 는 R 이 S 와 교환될 때만 직교다. 스케일은 정확히 되돌리면서 축을 섞어
    // 돌리는 자식은 아래로 전단을 그대로 넘긴다.
    const fixture = createRigFixture();
    const leaf = [...fixture.nodes.entries()].find(
      ([, node]) =>
        ![...fixture.nodes.values()].some((other) => other !== node && isDescendant(other, node)),
    );
    expect(leaf).toBeDefined();
    if (!leaf) return;
    const [, sculpted] = leaf;
    sculpted.scale.set(1.25, 0.8, 1);
    const pivot = new THREE.Object3D();
    pivot.scale.set(1 / 1.25, 1 / 0.8, 1);
    pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6);
    sculpted.add(pivot);
    sculpted.updateMatrix();
    fixture.root.updateMatrixWorld(true);

    const created = createStudioVrmProportionRigRuntime(fixture.adapter, {
      headLength: fixture.headLength,
    });
    expect(created.ok, "축을 섞어 도는 피벗인데 비균등 조형을 허용했다").toBe(false);
    if (created.ok) return;
    expect(created.code).toBe("unsafe-transform");
  });

  it("rejects a non-uniform scale on a bone that carries another humanoid bone", () => {
    // The leaf licence must not extend to a carrying frame: a rotated descendant would inherit shear.
    const fixture = createRigFixture();
    const spine = fixture.nodes.get("spine")!;
    spine.scale.set(1.2, 1, 1);
    spine.updateMatrix();
    fixture.root.updateMatrixWorld(true);

    const created = createStudioVrmProportionRigRuntime(fixture.adapter, {
      headLength: fixture.headLength,
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.code).toBe("unsafe-transform");
  });

  it("resizes spring-bone colliders by the uniform body scale before capturing spring rest", () => {
    // `setInitState()` recaptures joint rest only, so a collider left at its authored size while
    // the body grows stops covering the anatomy it was authored against.
    const fixture = createRigFixture();
    const runtime = runtimeFor(fixture);

    expect(runtime.apply(createStudioVrmProportions("sd-chibi-3")).ok).toBe(true);
    expect(fixture.colliderScales).toHaveLength(1);
    expect(fixture.colliderScales[0]).toBeGreaterThan(0);
    // Colliders are resized before the spring rest is captured, never after.
    expect(fixture.events.indexOf("colliders")).toBeLessThan(fixture.events.indexOf("spring"));

    // Absolute from rest: a second apply must pass the new scale, not a compounded one.
    const scaled = runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, overallHeight: 1.4 });
    expect(scaled.ok).toBe(true);
    expect(fixture.colliderScales[fixture.colliderScales.length - 1]).toBeCloseTo(1.4, 12);
  });

  it("tells the adapter which subtrees it scales, by membership and not by magnitude", () => {
    // 콜라이더가 씬 그래프에 실려 통째로 옮겨졌는지는 **소속**의 문제다. 결과 배율로 되짚으면
    // 서로 상쇄하는 편집에서 판정이 뒤집힌다 — `overallHeight` 1.25 와 `headBodyRatio` 0.8 은
    // `head` 배율을 정확히 1 로 만들지만, `head` 가 스케일을 받지 않는 본이 되지는 않는다.
    const fixture = createRigFixture();
    const runtime = runtimeFor(fixture);

    const cancelling = runtime.apply({
      ...NEUTRAL_STUDIO_VRM_PROPORTIONS,
      overallHeight: 1.25,
      headBodyRatio: 0.8,
    });
    expect(cancelling.ok).toBe(true);
    const head = fixture.nodes.get("head");
    if (!head) throw new Error("expected a head bone");
    expect(head.scale.x, "상쇄 편집이라 머리 배율은 정확히 1 이어야 한다").toBeCloseTo(1, 12);

    const roots = fixture.colliderScaledRoots[fixture.colliderScaledRoots.length - 1];
    expect(roots, "머리 배율이 1 이어도 `head` 는 여전히 스케일 서브트리의 뿌리다").toContain(head);
    for (const name of ["leftHand", "rightHand", "leftFoot", "rightFoot"] as const) {
      const node = fixture.nodes.get(name);
      if (!node) throw new Error(`expected ${name}`);
      expect(roots, `${name} 이 스케일 서브트리 목록에서 빠졌다`).toContain(node);
    }
    // 이동만 받는 본은 들어가면 안 된다 — 들어가면 몸통 캡슐이 관절을 따라가지 않는다.
    for (const name of ["hips", "spine", "chest", "neck", "leftUpperArm"] as const) {
      const node = fixture.nodes.get(name);
      if (!node) continue;
      expect(roots, `${name} 은 스케일을 받지 않는데 목록에 있다`).not.toContain(node);
    }

    // 비율과 무관하게 같은 집합이어야 한다.
    expect(runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS }).ok).toBe(true);
    expect(fixture.colliderScaledRoots[fixture.colliderScaledRoots.length - 1]).toEqual(roots);
  });

  it("records collider sync as unavailable when the adapter cannot resize them", () => {
    const fixture = createRigFixture({ includeColliderSync: false });
    const result = runtimeFor(fixture).apply(createStudioVrmProportions("webtoon-7"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages).toContain("spring-bone-colliders-unavailable");
    expect(result.stages).toContain("set-spring-bone-init-state");
  });

  it("records unavailable optional managers without skipping normalized rebuild or authored pose", () => {
    const fixture = createRigFixture({ includeManagers: false });
    const result = runtimeFor(fixture).apply(createStudioVrmProportions("webtoon-7"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fixture.events).toEqual(["reset", "rebuild", "pose"]);
    expect(result.stages).toContain("node-constraint-state-unavailable");
    expect(result.stages).toContain("spring-bone-state-unavailable");
  });

  it("transactionally rebuilds the committed raw and normalized baseline after a post-rebuild failure", () => {
    const fixture = createRigFixture();
    const runtime = runtimeFor(fixture);
    expect(runtime.apply(createStudioVrmProportions("webtoon-7")).ok).toBe(true);
    const rawBaseline = snapshotRig(fixture.nodes);
    const normalizedBaseline = new Map(fixture.normalizedPositions);
    const baselineNormalizedRoot = fixture.normalizedRoot;
    fixture.events.length = 0;
    fixture.failNextSpring();

    const failed = runtime.apply(createStudioVrmProportions("sd-chibi-3"));
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.code).toBe("lifecycle-failed");
    expect(failed.recovery).toBe("restored");
    expect(fixture.events).toEqual([
      "reset",
      "rebuild",
      "constraint",
      "colliders",
      "spring",
      "reset",
      "rebuild",
      "constraint",
      "colliders",
      "spring",
      "pose",
    ]);
    expectRig(fixture.nodes, rawBaseline);
    expect(fixture.normalizedPositions).toEqual(normalizedBaseline);
    expect(baselineNormalizedRoot.parent).toBeNull();
    expect(fixture.retiredNormalizedRoots.every((root) => root.parent === null)).toBe(true);
  });

  it("restores raw bones and authored root TRS when lifecycle recovery also fails", () => {
    const fixture = createRigFixture({
      rootTransform: {
        position: [0.8, 0.4, -0.6],
        rotation: [0, 0.37, 0],
        scale: [0.82, 1.24, 0.82],
      },
    });
    const runtime = runtimeFor(fixture);
    expect(runtime.apply(createStudioVrmProportions("webtoon-7")).ok).toBe(true);
    const committedRig = snapshotRig(fixture.nodes);
    const authoredRoot = snapshotTransform(fixture.root);
    fixture.failNextSpring(2);

    const failed = runtime.apply(createStudioVrmProportions("sd-chibi-3"));

    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.code).toBe("lifecycle-recovery-failed");
    expect(failed.recovery).toBe("reload-required");
    expectRig(fixture.nodes, committedRig);
    expectTransform(fixture.root, authoredRoot);
  });

  it("accepts missing optional bones but fails closed before mutation for missing essentials", () => {
    const optional = new Set<StudioHumanoidBoneName>([
      "upperChest",
      "leftEye",
      "rightEye",
      "jaw",
      "leftToes",
      "rightToes",
      "leftShoulder",
      "rightShoulder",
      "leftThumbMetacarpal",
      "rightThumbMetacarpal",
    ]);
    const reduced = createRigFixture({ missing: optional });
    const reducedResult = runtimeFor(reduced).apply(createStudioVrmProportions("sd-chibi-3"));
    expect(reducedResult.ok).toBe(true);

    const missingHead = createRigFixture({ missing: new Set(["head"]) });
    const before = snapshotRig(missingHead.nodes);
    const rejected = createStudioVrmProportionRigRuntime(missingHead.adapter, {
      headLength: missingHead.headLength,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe("missing-required-bone");
      expect(rejected.boneName).toBe("head");
    }
    expectRig(missingHead.nodes, before);
    expect(missingHead.events).toEqual([]);
  });

  it("rejects unsafe intermediary scale and incomplete lifecycle adapters without touching raw bones", () => {
    const unsafe = createRigFixture({ unsafeIntermediaryBone: "leftHand" });
    const unsafeBefore = snapshotRig(unsafe.nodes);
    const unsafeResult = createStudioVrmProportionRigRuntime(unsafe.adapter, {
      headLength: unsafe.headLength,
    });
    expect(unsafeResult.ok).toBe(false);
    if (!unsafeResult.ok) expect(unsafeResult.code).toBe("unsafe-transform");
    expectRig(unsafe.nodes, unsafeBefore);

    const incomplete = createRigFixture();
    const incompleteBefore = snapshotRig(incomplete.nodes);
    const invalidAdapter = {
      ...incomplete.adapter,
      reapplyAuthoredPose: undefined,
    } as unknown as StudioVrmProportionRigAdapter;
    const invalidResult = createStudioVrmProportionRigRuntime(invalidAdapter, {
      headLength: incomplete.headLength,
    });
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) expect(invalidResult.code).toBe("invalid-adapter");
    expectRig(incomplete.nodes, incompleteBefore);
  });

  it("accepts float32 glTF uniform-scale noise, removes it while authored, and restores it exactly", () => {
    const fixture = createRigFixture();
    fixture.nodes.get("chest")!.scale.set(1, 1.00000012, 1);
    fixture.nodes.get("spine")!.scale.set(1, 0.9999999, 0.99999994);
    fixture.nodes.get("rightThumbProximal")!.scale.set(1.00000012, 0.99999994, 0.9999998);
    fixture.root.updateMatrixWorld(true);
    const originalRig = snapshotRig(fixture.nodes);
    const created = createStudioVrmProportionRigRuntime(fixture.adapter, {
      headLength: fixture.headLength,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      const applied = created.runtime.apply(preset.proportions);
      expect(applied.ok).toBe(true);
      for (const name of ["chest", "spine", "rightThumbProximal"] as const) {
        const scale = fixture.nodes.get(name)!.scale;
        expect(scale.x).toBe(scale.y);
        expect(scale.y).toBe(scale.z);
      }
    }

    expect(created.runtime.apply(createStudioVrmProportions("sd-chibi-3")).ok).toBe(true);
    const firstChibi = snapshotRig(fixture.nodes);
    expect(created.runtime.apply(createStudioVrmProportions("runway-9")).ok).toBe(true);
    expect(created.runtime.apply(createStudioVrmProportions("sd-chibi-3")).ok).toBe(true);
    expectRig(fixture.nodes, firstChibi);

    expect(created.runtime.restore().ok).toBe(true);
    expectRig(fixture.nodes, originalRig);

    const materiallyNonUniform = createRigFixture();
    materiallyNonUniform.nodes.get("chest")!.scale.set(1, 1.00001, 1);
    materiallyNonUniform.root.updateMatrixWorld(true);
    const rejected = createStudioVrmProportionRigRuntime(materiallyNonUniform.adapter, {
      headLength: materiallyNonUniform.headLength,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("unsafe-transform");

    const relativelyNonUniformTinyScale = createRigFixture();
    relativelyNonUniformTinyScale.nodes.get("chest")!.scale.set(0.001, 0.001, 0.0010009);
    relativelyNonUniformTinyScale.root.updateMatrixWorld(true);
    const tinyScaleRejected = createStudioVrmProportionRigRuntime(
      relativelyNonUniformTinyScale.adapter,
      { headLength: relativelyNonUniformTinyScale.headLength }
    );
    expect(tinyScaleRejected.ok).toBe(false);
    if (!tinyScaleRejected.ok) expect(tinyScaleRejected.code).toBe("unsafe-transform");

    const recoveryFixture = createRigFixture();
    recoveryFixture.nodes.get("chest")!.scale.set(1, 1.00000012, 1);
    recoveryFixture.nodes
      .get("rightThumbProximal")!
      .scale.set(1.00000012, 0.99999994, 0.9999998);
    recoveryFixture.root.updateMatrixWorld(true);
    const recoveryOriginal = snapshotRig(recoveryFixture.nodes);
    const recoveryRuntime = runtimeFor(recoveryFixture);
    recoveryFixture.failNextSpring();
    const failed = recoveryRuntime.apply(createStudioVrmProportions("sd-chibi-3"));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.recovery).toBe("restored");
    expectRig(recoveryFixture.nodes, recoveryOriginal);
  });

  it("fails closed for non-unit quaternions and manually-owned matrices", () => {
    const nonUnitQuaternion = createRigFixture();
    nonUnitQuaternion.nodes.get("spine")!.quaternion.set(0.4, 0, 0, 1);
    const nonUnitBefore = snapshotRig(nonUnitQuaternion.nodes);
    const nonUnitResult = createStudioVrmProportionRigRuntime(nonUnitQuaternion.adapter, {
      headLength: nonUnitQuaternion.headLength,
    });
    expect(nonUnitResult.ok).toBe(false);
    if (!nonUnitResult.ok) expect(nonUnitResult.code).toBe("unsafe-transform");
    expectRig(nonUnitQuaternion.nodes, nonUnitBefore);

    const manualMatrix = createRigFixture();
    manualMatrix.nodes.get("leftUpperArm")!.matrixAutoUpdate = false;
    const manualMatrixBefore = snapshotRig(manualMatrix.nodes);
    const manualMatrixResult = createStudioVrmProportionRigRuntime(manualMatrix.adapter, {
      headLength: manualMatrix.headLength,
    });
    expect(manualMatrixResult.ok).toBe(false);
    if (!manualMatrixResult.ok) expect(manualMatrixResult.code).toBe("unsafe-transform");
    expectRig(manualMatrix.nodes, manualMatrixBefore);
  });

  it("fences stale generations before callbacks and cannot mutate old or replacement bones", () => {
    const fixture = createRigFixture();
    const runtime = runtimeFor(fixture);
    const oldBefore = snapshotRig(fixture.nodes);
    const replacement = createRigFixture();
    const replacementBefore = snapshotRig(replacement.nodes);
    fixture.setActiveNodes(replacement.nodes);
    fixture.setGeneration(2);

    const result = runtime.apply(createStudioVrmProportions("sd-chibi-3"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("stale-model-generation");
      expect(result.modelGeneration).toBe(1);
      expect(result.observedModelGeneration).toBe(2);
    }
    expectRig(fixture.nodes, oldBefore);
    expectRig(replacement.nodes, replacementBefore);
    expect(fixture.events).toEqual([]);
  });

  it("restores the root and raw transforms when generation changes during rest synchronization", () => {
    const fixture = createRigFixture({
      rootTransform: {
        position: [0.6, 0.25, -0.45],
        rotation: [0, -0.31, 0],
        scale: [0.86, 1.18, 0.86],
      },
    });
    const originalRig = snapshotRig(fixture.nodes);
    const originalRoot = snapshotTransform(fixture.root);
    const runtime = runtimeFor(fixture);
    fixture.setGenerationOnNextReset(2);

    const result = runtime.apply(createStudioVrmProportions("sd-chibi-3"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("stale-model-generation");
    expect(result.observedModelGeneration).toBe(2);
    expectRig(fixture.nodes, originalRig);
    expectTransform(fixture.root, originalRoot);
  });

  it("returns deeply immutable generation, target, metric, and preset receipt data", () => {
    const fixture = createRigFixture();
    const created = createStudioVrmProportionRigRuntime(fixture.adapter, {
      headLength: fixture.headLength,
      headMeasurement: { version: 1, source: "eye-landmarks", reliable: true },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const runtime = created.runtime;
    const first = runtime.apply(createStudioVrmProportions("cartoon-5"));
    const second = runtime.apply(manualProportions({ legLength: 1.2 }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.modelGeneration).toBe(1);
    expect(first.applyGeneration).toBe(1);
    expect(second.applyGeneration).toBe(2);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.authoredProportions)).toBe(true);
    expect(Object.isFrozen(first.runtimeProportions)).toBe(true);
    expect(Object.isFrozen(first.presetResolution)).toBe(true);
    expect(Object.isFrozen(first.targets)).toBe(true);
    expect(Object.isFrozen(first.targets[0])).toBe(true);
    expect(Object.isFrozen(first.targets[0]?.position)).toBe(true);
    expect(Object.isFrozen(first.worldPositions)).toBe(true);
    expect(Object.isFrozen(first.worldPositions[0])).toBe(true);
    expect(Object.isFrozen(first.worldPositions[0]?.position)).toBe(true);
    expect(Object.isFrozen(first.metrics)).toBe(true);
    expect(Object.isFrozen(first.stages)).toBe(true);
    expect(first.headMeasurement).toEqual({
      version: 1,
      source: "eye-landmarks",
      reliable: true,
    });
    expect(Object.isFrozen(first.headMeasurement)).toBe(true);
  });
});
