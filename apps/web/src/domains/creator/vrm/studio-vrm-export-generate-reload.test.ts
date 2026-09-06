import { VRMLoaderPlugin, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { Euler, SkinnedMesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import {
  AVATAR_FORGE_PRESETS,
  createAvatarForgeState,
  sanitizeAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { STUDIO_VRM_EXPORT_REQUIRED_BONES } from "./studio-vrm-export-vrm-extension";
import {
  buildStudioVrmGenerateAuthoringSnapshot,
  createStudioVrmGenerateRecipe,
  exportStudioVrmFromGenerateRecipe,
} from "./studio-vrm-generate-recipe";
import { buildStudioVrmHumanoidMesh } from "./studio-vrm-humanoid-mesh";
import { STUDIO_VRM_RIG_BONES } from "./studio-vrm-humanoid-rig";
import { countSpringBoneJoints } from "./studio-vrm-physics";
import { NEUTRAL_STUDIO_VRM_PROPORTIONS } from "./studio-vrm-proportion-core";
import { createStudioVrmProportionRigRuntime } from "./studio-vrm-proportion-rig-runtime";
import {
  createStudioVrmProportionVrmAdapter,
  measureStudioVrmProportionHeadLength,
} from "./studio-vrm-proportion-vrm-adapter";

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

async function loadVrmBytes(bytes: Uint8Array<ArrayBuffer>): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await new Promise<{ userData: { vrm: VRM } }>((resolve, reject) => {
    loader.parse(bytes.slice().buffer as ArrayBuffer, "", resolve as never, reject);
  });
  return gltf.userData.vrm;
}

/** `node` 가 `ancestor` 아래에 있는지 — 씬 그래프가 스케일을 물려주는 범위와 같다. */
function isUnder(node: Object3D, ancestor: Object3D): boolean {
  for (let cursor: Object3D | null = node.parent; cursor; cursor = cursor.parent) {
    if (cursor === ancestor) return true;
  }
  return false;
}

/**
 * 사용자 경로 전체를 고정한다: 조형 패널의 레시피 → 실제 .vrm 바이너리 →
 * three-vrm 로더 재적재. 내보낸 파일은 스튜디오에서 즉시 캐릭터로 쓰일 수 있어야 한다.
 */
describe("generate recipe → .vrm file reload", () => {
  it("produces a loadable VRM with a complete humanoid and meta for the default and custom states", async () => {
    const recipes = [
      createStudioVrmGenerateRecipe({ presetId: null }),
      createStudioVrmGenerateRecipe({ state: createAvatarForgeState() }),
    ];
    for (const recipe of recipes) {
      const bytes = exportStudioVrmFromGenerateRecipe(recipe);
      expect(bytes.byteLength).toBeGreaterThan(1024);

      // glTF 컨테이너 헤더 + 확장 선언을 먼저 확인한다.
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      expect(magic).toBe("glTF");

      const vrm = await loadVrmBytes(bytes);
      expect(vrm.humanoid).toBeDefined();
      for (const boneName of STUDIO_VRM_EXPORT_REQUIRED_BONES) {
        expect(
          vrm.humanoid?.getNormalizedBoneNode(boneName as VRMHumanBoneName),
          `${recipe.label}: ${boneName} 누락`,
        ).not.toBeNull();
      }
      const meta = vrm.meta as { authors?: readonly string[]; title?: string };
      expect(meta.authors?.length ?? 0).toBeGreaterThan(0);
    }
  }, 60_000);

  it("keeps distinct body parameters distinguishable after reload", async () => {
    const base = exportStudioVrmFromGenerateRecipe(
      createStudioVrmGenerateRecipe({ presetId: null }),
    );
    const modifiedState = {
      ...createAvatarForgeState(),
      proportions: {
        ...createAvatarForgeState().proportions,
        torsoLength: 1.35,
        legLength: 0.75,
      },
    };
    const modified = exportStudioVrmFromGenerateRecipe(
      createStudioVrmGenerateRecipe({ state: modifiedState }),
    );

    // 다른 체형 파라미터는 서로 다른 바이너리여야 하고(프리셋 충돌 금지),
    // 둘 다 재적재 시 유효한 휴머노이드를 유지해야 한다.
    expect(Buffer.from(modified).equals(Buffer.from(base))).toBe(false);

    const reloaded = await loadVrmBytes(modified);
    expect(reloaded.humanoid?.getNormalizedBoneNode("hips")).not.toBeNull();
  }, 60_000);

  it.each(["hime-noble", "braid-scholar"])(
    "gives %s a spring chain the studio's physics runtime can actually drive",
    async (presetId) => {
    // 헤어가 전 정점 `head` 100% 였을 때는 고개를 돌리면 긴 머리가 강체로 휩쓸렸고,
    // 리그에 헤어 조인트가 없어 스프링본이 물릴 곳도 없었다(생성 캐릭터의 스프링 조인트 0개).
    // `braid-scholar` 는 땋은 머리가 `sphere` 세그먼트 열이라, 가닥만 리그하던 시절에는
    // 본체 전체가 리그 밖이었다.
    const vrm = await loadVrmBytes(
      exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
    );
    expect(countSpringBoneJoints(vrm as never)).toBeGreaterThan(0);

    // 스프링이 실제로 움직이는지 — 머리를 돌린 뒤 고정 dt 로 돌리면 마디들이 따라와야 한다.
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (!head) throw new Error("expected a head bone");
    const joints = [...(vrm.springBoneManager?.joints ?? [])];
    expect(joints.length).toBeGreaterThan(0);

    vrm.scene.updateMatrixWorld(true);
    const before = joints.map((joint) => joint.bone.getWorldPosition(new Vector3()).clone());
    head.rotation.y = 0.9;
    head.rotation.x = 0.35;
    vrm.scene.updateMatrixWorld(true);
    for (let step = 0; step < 60; step += 1) vrm.update(1 / 60);
    const moved = joints.filter(
      (joint, index) => joint.bone.getWorldPosition(new Vector3()).distanceTo(before[index]) > 0.005,
    );
    // 일부만 움직이면 어딘가가 아직 `head` 에 강체로 붙어 있다는 뜻이다.
    expect(moved.length).toBe(joints.length);

    // 몸통 콜라이더가 없으면 흔들리는 머리카락이 등을 그대로 통과한다. 시뮬레이션이 끝난 뒤
    // 어느 마디도 몸통 캡슐 안에 들어가 있으면 안 된다.
    const capsule = vrm.springBoneManager?.colliders ?? [];
    expect(capsule.length).toBeGreaterThan(0);
    const spine = vrm.humanoid?.getRawBoneNode("spine");
    if (!spine) throw new Error("expected a spine bone");
    const spineWorld = spine.getWorldPosition(new Vector3());
    const shape = (capsule[0] as unknown as {
      shape: { offset: Vector3; tail: Vector3; radius: number };
    }).shape;
    const bottom = shape.offset.clone().add(spineWorld);
    const top = shape.tail.clone().add(spineWorld);
    const axis = top.clone().sub(bottom);
    for (const joint of joints) {
      const point = joint.bone.getWorldPosition(new Vector3());
      const t = Math.max(0, Math.min(1, point.clone().sub(bottom).dot(axis) / axis.lengthSq()));
      const closest = bottom.clone().addScaledVector(axis, t);
      // 콜라이더는 마디의 중심을 반지름 + hitRadius 밖으로 밀어낸다. 수치 오차만 허용한다.
      expect(point.distanceTo(closest)).toBeGreaterThan(shape.radius * 0.98);
    }
    },
    60_000,
  );

  it("keeps every shipped preset's skin joints and inverse bind matrices in step", async () => {
    // 헤어 조인트를 스킨에 이어 붙이면서 IBM 을 같이 늘리지 않으면 로더가 조용히
    // 어긋난 바인드를 쓴다 — 머리카락이 원점으로 날아간다.
    for (const presetId of ["hime-noble", "wave-diva", "natural-short"]) {
      const snapshot = buildStudioVrmGenerateAuthoringSnapshot(
        createStudioVrmGenerateRecipe({ presetId }),
      );
      const skin = snapshot.skins?.[0];
      expect(skin, presetId).toBeDefined();
      expect(skin?.joints.length, presetId).toBe((skin?.inverseBindMatrices?.length ?? 0) / 16);

      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      expect(vrm.humanoid?.getNormalizedBoneNode("head"), presetId).not.toBeNull();
    }
  }, 60_000);

  it.each([1, 1.5, 2.5])(
    "lands every hair joint on its intended rest position at headBodyRatio %s",
    async (headBodyRatio) => {
      // `head` 노드에는 조형 스케일이 붙어 있다. 체인을 그 밑에 바로 달면 조인트의 로컬
      // 이동에 그 스케일이 곱해져 rest 위치가 어긋난다 — 두신비 1.5 에서 28cm,
      // 2.5(SD)에서 81cm 어긋나 머리카락이 캐릭터에서 통째로 이탈했다.
      const base = createAvatarForgeState("hime-noble");
      const state = sanitizeAvatarForgeState({
        ...base,
        proportions: { ...base.proportions, headBodyRatio },
        face: { ...base.face, headWidth: 1.3 },
      });
      const mesh = buildStudioVrmHumanoidMesh(state);
      const hairRig = mesh.hairRig;
      if (!hairRig) throw new Error("expected a hair rig");

      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ state })),
      );
      vrm.scene.updateMatrixWorld(true);
      const nodeByName = new Map<string, Object3D>();
      vrm.scene.traverse((object) => nodeByName.set(object.name, object));

      for (const joint of hairRig.joints) {
        const node = nodeByName.get(joint.name);
        expect(node, `${joint.name} 노드가 없다`).toBeDefined();
        const actual = node!.getWorldPosition(new Vector3());
        expect(
          actual.distanceTo(new Vector3(...joint.worldRest)),
          `${joint.name} 이 의도한 rest 위치에서 벗어났다`,
        ).toBeLessThan(1e-4);
      }
    },
    60_000,
  );

  it("hangs the hair chains under a scale-cancelling pivot, not the scaled head node", async () => {
    // 스케일이 붙은 본 아래에서 회전하면 전단·이방성 신축이 생긴다(리그의 "스케일이 붙은
    // 본은 말단" 불변식). 배포 프리셋 21개 중 18개가 비균등 머리 스케일을 쓴다.
    // 피벗이 S⁻¹ 이므로 `S · T(t) · S⁻¹ = T(S·t)` 로 아래쪽 선형부가 항등이 된다.
    const state = createAvatarForgeState("hime-noble");
    const snapshot = buildStudioVrmGenerateAuthoringSnapshot(
      createStudioVrmGenerateRecipe({ state }),
    );
    const nodes = snapshot.nodes ?? [];
    const headIndex = nodes.findIndex((node) => node.name === "head");
    const headScale = nodes[headIndex]?.scale ?? [1, 1, 1];
    const headChildren = nodes[headIndex]?.children ?? [];

    const pivotIndex = headChildren.find((child) => nodes[child]?.name === "HairRoot");
    expect(pivotIndex, "head 아래에 HairRoot 피벗이 없다").toBeDefined();
    const pivot = nodes[pivotIndex as number];
    // 피벗은 머리 스케일을 정확히 되돌린다.
    for (let axis = 0; axis < 3; axis += 1) {
      expect((pivot.scale ?? [1, 1, 1])[axis] * headScale[axis]).toBeCloseTo(1, 10);
    }
    // 스프링 조인트는 전부 피벗 아래에만 있다 — head 의 직계 자식이면 안 된다.
    const jointNodes = new Set(
      (snapshot.springBone?.springs ?? []).flatMap((spring) =>
        spring.joints.map((joint) => joint.node),
      ),
    );
    for (const child of headChildren) {
      expect(jointNodes.has(child), `노드 ${child} 가 head 직계 자식인데 스프링 조인트다`).toBe(
        false,
      );
    }
    expect(jointNodes.size).toBeGreaterThan(0);
  });

  it.each(["natural-short", "hime-noble", "wolf-rebel"])(
    "keeps %s's dynamic bangs from swinging deeper than they rest",
    async (presetId) => {
      // 앞머리·옆머리가 스프링 체인이 되면서, 몸통 콜라이더만으로는 고개를 흔들 때 머리카락이
      // 얼굴을 그대로 통과한다. 예전처럼 `head` 에 강체로 묶여 있을 때는 불가능한 일이었다.
      //
      // 기준은 **정지 상태의 깊이**다. 앞머리는 눌린 이마에 붙도록 저작되므로 원 타원체
      // 기준으로는 이미 0.75 쯤에 있다(1.0 이 타원체 표면). 콜라이더가 할 일은 그 자리에서
      // 머리카락을 끌어내는 것이 아니라 **그보다 더 파고드는 것만** 막는 것이다.
      const mesh = buildStudioVrmHumanoidMesh(createAvatarForgeState(presetId));
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      const joints = [...(vrm.springBoneManager?.joints ?? [])];
      if (!head || joints.length === 0) throw new Error(`${presetId}: expected a spring rig`);

      // 콜라이더와 같은 프레임에서 잰다 — 헤어 피벗은 월드 스케일이 1 이고 머리 회전을 따라간다.
      let pivot: Object3D | null = null;
      vrm.scene.traverse((object) => {
        if (object.name === "HairRoot") pivot = object;
      });
      if (!pivot) throw new Error(`${presetId}: expected a HairRoot pivot`);
      const anchored = pivot as Object3D;

      const scale = mesh.rig.nodeScale.head ?? [1, 1, 1];
      const joint = mesh.rig.worldRest.head;
      const center = [0, 1, 2].map(
        (axis) => (mesh.rig.head.center[axis] - joint[axis]) * scale[axis],
      );
      const radii = [
        mesh.rig.head.radiusX * scale[0],
        mesh.rig.head.radiusY * scale[1],
        mesh.rig.head.radiusZ * scale[2],
      ];
      const skullDistance = (bone: Object3D): number => {
        const point = anchored.worldToLocal(bone.getWorldPosition(new Vector3()));
        return Math.hypot(
          (point.x - center[0]) / radii[0],
          (point.y - center[1]) / radii[1],
          (point.z - center[2]) / radii[2],
        );
      };

      vrm.scene.updateMatrixWorld(true);
      let rest = Infinity;
      for (const spring of joints) rest = Math.min(rest, skullDistance(spring.bone));

      let deepest = Infinity;
      for (let step = 0; step < 180; step += 1) {
        head.rotation.y = Math.sin(step / 8) * 1.1;
        head.rotation.x = Math.sin(step / 11) * 0.5;
        vrm.scene.updateMatrixWorld(true);
        vrm.update(1 / 60);
        if (step < 60) continue;
        for (const spring of joints) deepest = Math.min(deepest, skullDistance(spring.bone));
      }
      // 콜라이더를 떼면 −0.19 아래까지 가라앉는다. 0.14 는 그 절반보다도 빡빡한 문턱이다.
      expect(deepest - rest, `${presetId}: 머리카락이 정지 상태보다 깊이 파고들었다`).toBeGreaterThan(
        -0.14,
      );
    },
    60_000,
  );

  it.each(AVATAR_FORGE_PRESETS.map((preset) => preset.id))(
    "leaves %s's hair at rest when the head never moves",
    async (presetId) => {
      // 콜라이더가 정지 헤어를 뚫고 있으면, 고개를 전혀 움직이지 않아도 첫 프레임부터 스프링
      // 해석이 머리카락을 바깥으로 밀어낸다. 예전에는 앞머리가 4.5cm 앞으로 튀어나갔다 —
      // 두개골 캡슐을 눌리지 않은 원 타원체에서 뽑았고(렌더링된 이마는 0.87배로 눌린다),
      // 몸통 캡슐의 위쪽 반구가 반경만큼 어깨 위로 솟아 목덜미를 삼켰기 때문이다.
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const joints = [...(vrm.springBoneManager?.joints ?? [])];
      if (joints.length === 0) return;
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (!head) throw new Error(`${presetId}: expected a head bone`);
      vrm.scene.updateMatrixWorld(true);
      const skull = head.getWorldPosition(new Vector3());
      const rest = joints.map((spring) => spring.bone.getWorldPosition(new Vector3()).clone());

      for (let step = 0; step < 200; step += 1) vrm.update(1 / 60);
      vrm.scene.updateMatrixWorld(true);

      let pushed = 0;
      let worst = "";
      joints.forEach((spring, index) => {
        const now = spring.bone.getWorldPosition(new Vector3());
        // 머리 관절에서 바깥으로 향하는 성분만 본다. 아래로 처지는 것은 중력이고 정상이다.
        const outward = now.sub(rest[index]).dot(rest[index].clone().sub(skull).normalize());
        if (outward > pushed) {
          pushed = outward;
          worst = spring.bone.name;
        }
      });
      expect(pushed, `${presetId}: ${worst} 가 정지 상태에서 밀려났다`).toBeLessThan(0.012);
    },
    60_000,
  );

  it("assigns both the torso and skull collider groups to every hair spring", () => {
    const snapshot = buildStudioVrmGenerateAuthoringSnapshot(
      createStudioVrmGenerateRecipe({ presetId: "hime-noble" }),
    );
    const groups = snapshot.springBone?.colliderGroups ?? [];
    expect(groups.map((group) => group.name)).toEqual(["Torso", "Skull"]);
    // 두개골은 캡슐 두 개의 합집합이다 — 하나로는 가로 두 축 중 작은 쪽밖에 못 감싼다.
    expect(groups[1]?.colliders).toEqual([1, 2]);
    const springs = snapshot.springBone?.springs ?? [];
    expect(springs.length).toBeGreaterThan(0);
    for (const spring of springs) {
      expect(spring.colliderGroups, spring.name).toEqual([0, 1]);
    }
  });
  it("keeps the torso capsule from swallowing the neck", () => {
    // 캡슐의 겉면은 끝점에서 반경만큼 더 뻗는다. 예전에는 반경이 12cm 라 겉면이 어깨보다
    // 그만큼 위로 솟아 목과 목덜미를 통째로 감쌌고, 정지 상태의 나페 머리가 그 안에 들어가
    // 첫 프레임부터 3cm 밀려났다. 지금은 `fitRadiusInsideHair` 가 정지 헤어를 기준으로 반경을
    // 직접 줄여 같은 일을 더 정확히 한다 — 겉면이 머리 관절까지 올라오면 안 된다.
    for (const presetId of ["action-pony", "hime-noble", "natural-short"]) {
      const recipe = createStudioVrmGenerateRecipe({ presetId });
      const snapshot = buildStudioVrmGenerateAuthoringSnapshot(recipe);
      const rig = buildStudioVrmHumanoidMesh(recipe.state).rig;
      const torso = (snapshot.springBone?.colliders ?? [])[0];
      if (!torso || torso.shape !== "capsule" || !torso.tail) {
        throw new Error("expected a torso capsule");
      }
      const spineY = rig.worldRest.spine[1];
      const top = spineY + Math.max(torso.offset[1], torso.tail[1]) + torso.radius;
      expect(top, `${presetId}: 몸통 캡슐이 머리까지 올라왔다`).toBeLessThan(rig.worldRest.head[1]);
    }
  });

  it("keeps every skull collider inside the hair it has to protect", () => {
    // 콜라이더는 정지 헤어에 **내접**해야 한다. 그러지 않으면 rest 가 평형이 아니다.
    for (const presetId of ["natural-short", "hime-noble", "pixie-sport"]) {
      const recipe = createStudioVrmGenerateRecipe({ presetId });
      const snapshot = buildStudioVrmGenerateAuthoringSnapshot(recipe);
      const mesh = buildStudioVrmHumanoidMesh(recipe.state);
      const scale = mesh.rig.nodeScale.head ?? [1, 1, 1];
      // 두개골 캡슐 반경은 조형된 타원체의 가장 작은 가로 반경보다 확실히 작아야 한다.
      const smallest = Math.min(mesh.rig.head.radiusX * scale[0], mesh.rig.head.radiusZ * scale[2]);
      const skull = (snapshot.springBone?.colliders ?? []).slice(1);
      expect(skull.length, presetId).toBe(2);
      for (const collider of skull) {
        expect(collider.radius, `${presetId}: 두개골 콜라이더가 줄지 않았다`).toBeLessThan(smallest);
      }
    }
  });

  it.each(AVATAR_FORGE_PRESETS.map((preset) => preset.id))(
    "lets the studio's body sliders drive %s",
    async (presetId) => {
      // The face sculpt rides on the `head` node as a non-uniform scale. The proportion runtime
      // used to demand a uniform scale on every frame from the root to each bone, so generating a
      // character with any face proportion other than 1 made every body slider fail outright --
      // 18 of the 21 shipped presets. `head` carries no humanoid bone beneath it, which is exactly
      // what licenses the sculpt to live there.
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const headLength = measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2;
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => true,
      });
      const created = createStudioVrmProportionRigRuntime(adapter, { headLength });
      expect(created.ok, `${presetId}: 체형 런타임이 생성 캐릭터를 거부했다`).toBe(true);
      if (!created.ok) return;

      const head = vrm.humanoid?.getRawBoneNode("head");
      if (!head) throw new Error(`${presetId}: expected a head bone`);
      const authored = head.scale.clone();
      const applied = created.runtime.apply({
        ...NEUTRAL_STUDIO_VRM_PROPORTIONS,
        overallHeight: 1.6,
      });
      expect(applied.ok, `${presetId}: 체형 적용이 실패했다`).toBe(true);

      // The sculpt survives, multiplied by exactly the uniform body scale.
      expect(head.scale.x).toBeCloseTo(authored.x * 1.6, 9);
      expect(head.scale.y).toBeCloseTo(authored.y * 1.6, 9);
      expect(head.scale.z).toBeCloseTo(authored.z * 1.6, 9);
    },
    60_000,
  );

  it("keeps the torso capsule's axis on the torso after the body is resized", async () => {
    // 콜라이더 도형은 노드 로컬 좌표이고 `setInitState()` 는 조인트 rest 만 다시 잡으므로,
    // 이전에는 몸이 커져도 캡슐이 저작 당시 크기 그대로였다 — `overallHeight` 1.6 에서 캡슐
    // 축 위쪽이 어깨보다 15cm 아래에서 끝났다. 축 끝점은 엉덩이·어깨 관절을 따라가야 한다.
    const presetId = "hime-noble";
    const spans: number[] = [];
    for (const overallHeight of [1, 1.6]) {
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => true,
      });
      const created = createStudioVrmProportionRigRuntime(adapter, {
        headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
      });
      if (!created.ok) throw new Error(`${presetId}: ${created.message}`);
      expect(created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, overallHeight }).ok).toBe(
        true,
      );
      vrm.scene.updateMatrixWorld(true);

      const hips = vrm.humanoid?.getRawBoneNode("hips")?.getWorldPosition(new Vector3());
      const shoulder = vrm.humanoid
        ?.getRawBoneNode("leftUpperArm")
        ?.getWorldPosition(new Vector3());
      const torso = [...(vrm.springBoneManager?.colliders ?? [])][0];
      if (!hips || !shoulder || !torso) throw new Error(`${presetId}: expected a torso capsule`);
      const shape = (torso as unknown as {
        shape: { offset: Vector3; tail?: Vector3; radius: number };
      }).shape;
      torso.updateWorldMatrix(true, false);
      const a = shape.offset.clone().applyMatrix4(torso.matrixWorld);
      const b = (shape.tail ?? shape.offset).clone().applyMatrix4(torso.matrixWorld);
      const bottom = Math.min(a.y, b.y);
      const top = Math.max(a.y, b.y);
      // 축 끝점은 관절에 붙어 있다(저작 시 준 2cm 여유만큼만 안쪽).
      expect(Math.abs(bottom - hips.y), `overallHeight ${overallHeight}: 캡슐 축 아래가 엉덩이를 벗어났다`).toBeLessThan(
        0.03 * overallHeight,
      );
      expect(Math.abs(top - shoulder.y), `overallHeight ${overallHeight}: 캡슐 축 위가 어깨를 벗어났다`).toBeLessThan(
        0.03 * overallHeight,
      );
      spans.push(top - bottom);
    }
    // 그리고 축 길이가 몸을 따라간다 — 저작 당시 크기에 얼어붙지 않는다.
    expect(spans[1] / spans[0]).toBeCloseTo(1.6, 3);
  }, 60_000);

  it("scales each collider by what the body around it actually did", async () => {
    // three-vrm 이 캡슐을 두 조각으로 나눠 쓰는데, 나누는 선이 필드 이름과 다르다. 축은
    // `colliderMatrix` 로 변환되므로 **씬 그래프가 이미** 스케일을 물려준다 — 로컬 값까지
    // 곱하면 1.6배 대신 2.56배가 된다. 반면 `shape.radius` 는 어떤 행렬도 거치지 않는
    // 원시 스칼라라 씬 그래프가 아무것도 해주지 않는다. 그래서 여기서 재는 유효량은
    // 변환된 축 길이와 **원시** 반경이다.
    //
    // 두 콜라이더가 정반대 경우다. 두개골은 `head` 아래라 축이 이미 1.6배 — 반경도 같이
    // 1.6배여야 형태가 유지된다. 몸통은 `spine` 아래라 아무것도 안 물려받고, 관절만 벌어지고
    // 굵기는 그대로다 — 반경까지 키우면 캡슐이 몸보다 60% 뚱뚱해진다.
    const presetId = "hime-noble";
    const measured: { torsoRadius: number; skullRadius: number; torsoSpan: number }[] = [];
    for (const overallHeight of [1, 1.6]) {
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => true,
      });
      const created = createStudioVrmProportionRigRuntime(adapter, {
        headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
      });
      if (!created.ok) throw new Error(created.message);
      expect(created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, overallHeight }).ok).toBe(
        true,
      );
      vrm.scene.updateMatrixWorld(true);
      const colliders = [...(vrm.springBoneManager?.colliders ?? [])];
      expect(colliders.length).toBeGreaterThanOrEqual(3);
      const worldOf = (collider: Object3D): { radius: number; span: number } => {
        const shape = (collider as unknown as {
          shape: { offset: Vector3; tail?: Vector3; radius: number };
        }).shape;
        collider.updateWorldMatrix(true, false);
        const a = shape.offset.clone().applyMatrix4(collider.matrixWorld);
        const b = (shape.tail ?? shape.offset).clone().applyMatrix4(collider.matrixWorld);
        // `radius` 는 원시값 그대로가 유효 반경이다. 월드 스케일을 곱하면 three-vrm 이
        // 실제로 쓰지 않는 수를 재게 된다.
        return { radius: shape.radius, span: a.distanceTo(b) };
      };
      const torso = worldOf(colliders[0]);
      const skull = worldOf(colliders[1]);
      measured.push({
        torsoRadius: torso.radius,
        skullRadius: skull.radius,
        torsoSpan: torso.span,
      });
    }
    const [rest, tall] = measured;
    // 몸통: 축은 관절을 따라가고 굵기는 그대로.
    expect(tall.torsoSpan / rest.torsoSpan, "몸통 캡슐 축이 관절을 따라가지 않았다").toBeCloseTo(1.6, 3);
    expect(tall.torsoRadius, "몸통 캡슐이 몸보다 뚱뚱해졌다").toBeCloseTo(rest.torsoRadius, 6);
    // 두개골: 머리가 실제로 커지므로 반경도 딱 그만큼. 축은 씬 그래프가 이미 키웠다.
    expect(
      tall.skullRadius / rest.skullRadius,
      "두개골 반경이 머리를 따라가지 않았다 — 축만 커지고 반경은 그대로면 납작해진다",
    ).toBeCloseTo(1.6, 3);
  }, 60_000);

  it.each([
    ["headBodyRatio", { headBodyRatio: 2.5 }, 2.5],
    ["overallHeight", { overallHeight: 1.6 }, 1.6],
    ["both", { overallHeight: 1.3, headBodyRatio: 2 }, 2.6],
  ] as const)(
    "keeps the skull collider the same shape as the head it rides (%s)",
    async (_label, override, expected) => {
      // 두개골 캡슐은 `HairRoot` 를 거쳐 `head` 아래에 있고, `head` 는 `overallHeight` 와
      // `headBodyRatio` 를 **둘 다** 흡수한다. 축은 `colliderMatrix` 가 그 배율을 통째로
      // 실어 나르지만 `shape.radius` 는 원시 스칼라라 아무것도 실리지 않는다. 반경을 손대지
      // 않으면 머리만 2.5배 커지고 캡슐은 저작 당시 굵기 그대로 남아 납작해진다.
      const presetId = "hime-noble";
      const shape: { radius: number; span: number }[] = [];
      for (const proportions of [{}, override]) {
        const vrm = await loadVrmBytes(
          exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
        );
        const adapter = createStudioVrmProportionVrmAdapter({
          vrm,
          getCurrentModelGeneration: () => 1,
          reapplyAuthoredPose: () => true,
        });
        const created = createStudioVrmProportionRigRuntime(adapter, {
          headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
        });
        if (!created.ok) throw new Error(created.message);
        expect(
          created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...proportions }).ok,
        ).toBe(true);
        vrm.scene.updateMatrixWorld(true);

        const skull = [...(vrm.springBoneManager?.colliders ?? [])][1];
        if (!skull) throw new Error("expected a skull capsule");
        const geometry = (skull as unknown as {
          shape: { offset: Vector3; tail?: Vector3; radius: number };
        }).shape;
        skull.updateWorldMatrix(true, false);
        const a = geometry.offset.clone().applyMatrix4(skull.matrixWorld);
        const b = (geometry.tail ?? geometry.offset).clone().applyMatrix4(skull.matrixWorld);
        // 축은 변환된 값이, 반경은 원시값이 유효량이다 — three-vrm 이 그렇게 읽는다.
        shape.push({ radius: geometry.radius, span: a.distanceTo(b) });
      }
      const [rest, scaled] = shape;
      // 반경과 축이 **같은** 배율로 따라가야 형태가 유지된다.
      expect(scaled.radius / rest.radius, "두개골 반경이 머리를 따라가지 않았다").toBeCloseTo(expected, 3);
      expect(scaled.span / rest.span, "두개골 축이 머리를 따라가지 않았다").toBeCloseTo(expected, 3);
    },
    60_000,
  );

  it.each([
    ["headBodyRatio", { headBodyRatio: 2.5 }, 2.5],
    ["overallHeight", { overallHeight: 1.6 }, 1.6],
  ] as const)(
    "thickens spring joints with the hair hierarchy they hang from (%s)",
    async (_label, override, expected) => {
      // `settings.hitRadius` 는 `calculateCollision(colliderMatrix, tail, hitRadius, …)` 로
      // 넘어가 월드 거리와 직접 비교되는 **원시 스칼라**다. 머리카락 본은 `head` 아래라
      // 월드 길이가 머리를 따라 커지는데 hitRadius 만 저작 당시 값에 얼어붙으면, 마디가
      // 상대적으로 그만큼 가늘어져 콜라이더를 그냥 지나친다. 실제로 `headBodyRatio` 2.5 에서는
      // 콜라이더가 아예 일을 하지 못해, 머리 흔들기 스윕의 최대 침투가 콜라이더를 통째로
      // 떼어냈을 때와 소수점 셋째 자리까지 같았다(-0.376).
      const presetId = "hime-noble";
      const measured: { hair: number[]; body: number[] }[] = [];
      for (const proportions of [{}, override]) {
        const vrm = await loadVrmBytes(
          exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
        );
        const adapter = createStudioVrmProportionVrmAdapter({
          vrm,
          getCurrentModelGeneration: () => 1,
          reapplyAuthoredPose: () => true,
        });
        const created = createStudioVrmProportionRigRuntime(adapter, {
          headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
        });
        if (!created.ok) throw new Error(created.message);
        expect(
          created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...proportions }).ok,
        ).toBe(true);
        vrm.scene.updateMatrixWorld(true);

        const headNode = vrm.humanoid?.getRawBoneNode("head");
        if (!headNode) throw new Error("expected a head bone");
        const hair: number[] = [];
        const body: number[] = [];
        for (const joint of vrm.springBoneManager?.joints ?? []) {
          (isUnder(joint.bone, headNode) ? hair : body).push(joint.settings.hitRadius);
        }
        expect(hair.length, "머리 아래 스프링 마디를 하나도 못 찾았다").toBeGreaterThan(0);
        measured.push({ hair, body });
      }
      const [rest, scaled] = measured;
      expect(scaled.hair).toHaveLength(rest.hair.length);
      expect(scaled.body).toHaveLength(rest.body.length);
      for (const [index, radius] of scaled.hair.entries()) {
        expect(radius / rest.hair[index], `머리카락 마디 ${index} 가 머리를 따라가지 않았다`)
          .toBeCloseTo(expected, 3);
      }
      // 머리 밖 마디는 아무것도 물려받지 않았으므로 굵기도 그대로여야 한다.
      for (const [index, radius] of scaled.body.entries()) {
        expect(radius, `몸통 마디 ${index} 가 이유 없이 굵어졌다`).toBeCloseTo(rest.body[index], 9);
      }
    },
    60_000,
  );

  it("never moves a sphere collider, which carries a position and not a span", async () => {
    // 캡슐은 끝점 두 개로 **구간**을 표현하지만, 구와 평면의 `offset` 은 본 프레임에 붙은
    // 위치다. 어느 좌표가 구간이고 어느 좌표가 위치인지는 저작 의도이고 VRM 파일에 자리가
    // 없다(`torsoLength` 스레드). 도형 종류가 파일이 실제로 말해 주는 유일한 구분이므로,
    // 구간이 없는 도형은 건드리지 않는다 — 어깨가 벌어졌다고 몸통 한가운데 붙은 구를 같이
    // 끌면 살갗에서 떨어져 나간다.
    const vrm = await loadVrmBytes(
      exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId: "hime-noble" })),
    );
    const torso = [...(vrm.springBoneManager?.colliders ?? [])][0];
    if (!torso) throw new Error("expected a torso capsule");
    const holder = torso as unknown as {
      shape: { offset: Vector3; tail?: Vector3; radius: number };
    };
    // 임포트 VRM 이 흔히 다는 형태로 바꿔 둔다 — 꼬리가 없으면 three-vrm 은 구로 읽는다.
    const rest = new Vector3(0.1, holder.shape.offset.y, 0.06);
    holder.shape = { offset: rest.clone(), radius: holder.shape.radius };

    const adapter = createStudioVrmProportionVrmAdapter({
      vrm,
      getCurrentModelGeneration: () => 1,
      reapplyAuthoredPose: () => true,
    });
    const created = createStudioVrmProportionRigRuntime(adapter, {
      headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
    });
    if (!created.ok) throw new Error(created.message);

    for (const proportions of [
      { overallHeight: 1.6 },
      { shoulderWidth: 1.4 },
      { overallHeight: 0.7 },
    ]) {
      expect(
        created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...proportions }).ok,
      ).toBe(true);
      const label = JSON.stringify(proportions);
      expect(holder.shape.offset.distanceTo(rest), `${label} 에서 구 콜라이더가 움직였다`)
        .toBeLessThan(1e-9);
    }
  }, 60_000);

  it("keeps a collider's lateral offset when only the joints along it moved", async () => {
    // 임포트 VRM 은 평범한 본에 옆으로 밀어 둔 구 콜라이더를 흔히 단다. 체형 편집은 그 본을
    // 옮길 뿐 프레임을 늘리지 않으므로, 살갗은 본에서 같은 거리를 유지한다. 오프셋 벡터를
    // 통째로 `overallHeight` 배 하면 그 콜라이더가 표면에서 떨어져 나간다 — 가슴 앞 z=0.10 이
    // 1.6 배에서 0.16 으로 밀린다. 깊이는 한 치도 변하지 않았는데도.
    const vrm = await loadVrmBytes(
      exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId: "hime-noble" })),
    );
    const torso = [...(vrm.springBoneManager?.colliders ?? [])][0];
    if (!torso) throw new Error("expected a torso capsule");
    const shape = (torso as unknown as {
      shape: { offset: Vector3; tail: Vector3; radius: number };
    }).shape;
    // 임포트 VRM 처럼 축에서 벗어난 오프셋을 만들어 둔다. 어댑터가 rest 를 잡기 **전**이어야 한다.
    shape.offset.set(0.04, shape.offset.y, 0.1);
    shape.tail.set(0.04, shape.tail.y, 0.1);
    const rest = { offset: shape.offset.clone(), tail: shape.tail.clone() };

    const adapter = createStudioVrmProportionVrmAdapter({
      vrm,
      getCurrentModelGeneration: () => 1,
      reapplyAuthoredPose: () => true,
    });
    const created = createStudioVrmProportionRigRuntime(adapter, {
      headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
    });
    if (!created.ok) throw new Error(created.message);
    expect(
      created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, overallHeight: 1.6 }).ok,
    ).toBe(true);

    // `spine` 아래 어떤 관절도 z 를 뻗지 않으므로 깊이는 그대로다.
    expect(shape.offset.z, "몸통 깊이가 변하지 않았는데 콜라이더가 앞으로 밀렸다").toBeCloseTo(
      rest.offset.z,
      9,
    );
    expect(shape.tail.z).toBeCloseTo(rest.tail.z, 9);
    // 관절이 벌어진 축은 따라간다 — `head` 와 양 위팔이 y 로 1.6 배 멀어진다.
    expect(shape.offset.y / rest.offset.y, "축이 관절을 따라가지 않았다").toBeCloseTo(1.6, 6);
    expect(shape.tail.y / rest.tail.y).toBeCloseTo(1.6, 6);
    // 어깨는 실제로 바깥으로 벌어지므로 x 는 따라가는 것이 맞다.
    expect(shape.offset.x / rest.offset.x).toBeCloseTo(1.6, 6);
  }, 60_000);

  it("leaves the skull capsule alone when height and head edits cancel out", async () => {
    // `head` 배율은 `headBodyRatio × overallHeight` 다. 1.25 와 0.8 은 정확히 1 을 만든다 —
    // 머리와 머리카락은 저작 크기 그대로인데, 상속 배율을 보고 "스케일 안 받은 콜라이더"로
    // 분류하면 축이 25% 늘고 중심이 1.7cm 올라간다. 소속으로 갈라야 하는 이유다.
    const measure = async (proportions: Partial<typeof NEUTRAL_STUDIO_VRM_PROPORTIONS>) => {
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId: "hime-noble" })),
      );
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => true,
      });
      const created = createStudioVrmProportionRigRuntime(adapter, {
        headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
      });
      if (!created.ok) throw new Error(created.message);
      expect(
        created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...proportions }).ok,
      ).toBe(true);
      vrm.scene.updateMatrixWorld(true);
      const skull = [...(vrm.springBoneManager?.colliders ?? [])][1];
      if (!skull) throw new Error("expected a skull capsule");
      const shape = (skull as unknown as {
        shape: { offset: Vector3; tail?: Vector3; radius: number };
      }).shape;
      skull.updateWorldMatrix(true, false);
      const a = shape.offset.clone().applyMatrix4(skull.matrixWorld);
      const b = (shape.tail ?? shape.offset).clone().applyMatrix4(skull.matrixWorld);
      return {
        headScale: vrm.humanoid?.getRawBoneNode("head")?.scale.x ?? 1,
        offset: shape.offset.clone(),
        radius: shape.radius,
        span: a.distanceTo(b),
      };
    };

    const rest = await measure({});
    const cancelled = await measure({ overallHeight: 1.25, headBodyRatio: 0.8 });
    const grown = await measure({ overallHeight: 1.25 });

    // 상쇄 편집: 머리가 그대로이므로 캡슐도 그대로여야 한다.
    expect(cancelled.headScale, "상쇄 편집인데 머리 배율이 1 이 아니다").toBeCloseTo(1, 9);
    expect(cancelled.offset.distanceTo(rest.offset), "두개골 캡슐 중심이 움직였다").toBeLessThan(1e-9);
    expect(cancelled.span / rest.span, "두개골 축이 자라지 않은 머리를 따라 늘어났다").toBeCloseTo(1, 6);
    expect(cancelled.radius, "두개골 반경이 움직였다").toBeCloseTo(rest.radius, 9);

    // 대조군: 머리가 실제로 자라면 축과 반경이 딱 그만큼 따라간다.
    expect(grown.headScale).toBeCloseTo(1.25, 9);
    expect(grown.span / rest.span).toBeCloseTo(1.25, 6);
    expect(grown.radius / rest.radius).toBeCloseTo(1.25, 6);
  }, 60_000);

  it("puts every collider and joint back on its authored size when the sliders return", async () => {
    // 슬라이더는 한 런타임 위에서 여러 번 움직인다. 모든 쓰기가 rest 기준 절대값이어야
    // 왕복이 제자리로 돌아온다. 반경을 "프레임이 스케일된" 가지 안에서만 쓰면, 한 번
    // `headBodyRatio` 2.5 로 갔던 두개골이 중립으로 돌아온 뒤에도 2.5배 반경으로 남는다 —
    // 상속 배율이 1 이 되면서 그 가지를 타지 않기 때문이다.
    const vrm = await loadVrmBytes(
      exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId: "hime-noble" })),
    );
    const adapter = createStudioVrmProportionVrmAdapter({
      vrm,
      getCurrentModelGeneration: () => 1,
      reapplyAuthoredPose: () => true,
    });
    const created = createStudioVrmProportionRigRuntime(adapter, {
      headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
    });
    if (!created.ok) throw new Error(created.message);

    const shapeOf = (collider: Object3D) =>
      (collider as unknown as { shape: { offset?: Vector3; tail?: Vector3; radius?: number } }).shape;
    const colliders = [...(vrm.springBoneManager?.colliders ?? [])];
    const joints = [...(vrm.springBoneManager?.joints ?? [])];
    expect(colliders.length).toBeGreaterThanOrEqual(3);
    expect(joints.length).toBeGreaterThan(0);
    const snapshot = () => ({
      colliders: colliders.map((collider) => {
        const shape = shapeOf(collider);
        return {
          radius: shape.radius ?? 0,
          offset: shape.offset?.clone() ?? new Vector3(),
          tail: shape.tail?.clone() ?? new Vector3(),
        };
      }),
      hitRadii: joints.map((joint) => joint.settings.hitRadius),
    });

    const rest = snapshot();
    for (const detour of [{ headBodyRatio: 2.5 }, { overallHeight: 1.6 }, { overallHeight: 0.7 }]) {
      expect(created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...detour }).ok).toBe(true);
      expect(created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS }).ok).toBe(true);
      const back = snapshot();
      const label = JSON.stringify(detour);
      back.colliders.forEach((entry, index) => {
        expect(entry.radius, `${label} 왕복 후 콜라이더 ${index} 반경`).toBeCloseTo(
          rest.colliders[index].radius,
          9,
        );
        expect(
          entry.offset.distanceTo(rest.colliders[index].offset),
          `${label} 왕복 후 콜라이더 ${index} 오프셋`,
        ).toBeLessThan(1e-9);
        expect(
          entry.tail.distanceTo(rest.colliders[index].tail),
          `${label} 왕복 후 콜라이더 ${index} 꼬리`,
        ).toBeLessThan(1e-9);
      });
      back.hitRadii.forEach((radius, index) => {
        expect(radius, `${label} 왕복 후 마디 ${index} 굵기`).toBeCloseTo(rest.hitRadii[index], 9);
      });
    }
  }, 60_000);

  it("keeps the skull collider earning its keep after the head is scaled up", async () => {
    // 앞의 두 테스트가 재는 비율이 실제로 무슨 일을 하는지 고정한다. 콜라이더의 값어치는
    // "콜라이더를 붙였을 때가 뗐을 때보다 얼마나 덜 파고드는가" 하나뿐이고, 그 값어치는
    // 머리를 키워도 남아 있어야 한다. 예전에는 `headBodyRatio` 2.5 에서 둘이 완전히 같았다 —
    // 축만 커지고 반경과 hitRadius 는 저작 당시 값에 얼어붙어, 콜라이더가 아예 없는 것과
    // 구별되지 않았다.
    const presetId = "natural-short";
    const rig = buildStudioVrmHumanoidMesh(createStudioVrmGenerateRecipe({ presetId }).state).rig;
    const headScale = rig.nodeScale.head ?? [1, 1, 1];
    const skull = rig.head;
    // 두개골 타원체는 `head` 로컬(헤어 피벗 프레임)에서 저작값 그대로다. q < 1 이 안쪽이다.
    const center = new Vector3(
      (skull.center[0] - rig.worldRest.head[0]) * headScale[0],
      (skull.center[1] - rig.worldRest.head[1]) * headScale[1],
      (skull.center[2] - rig.worldRest.head[2]) * headScale[2],
    );
    const depth = (point: Vector3): number =>
      Math.hypot(
        (point.x - center.x) / (skull.radiusX * headScale[0]),
        (point.y - center.y) / (skull.radiusY * headScale[1]),
        (point.z - center.z) / (skull.radiusZ * headScale[2]),
      );

    const worstDip = async (withColliders: boolean): Promise<number> => {
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => true,
      });
      const created = createStudioVrmProportionRigRuntime(adapter, {
        headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
      });
      if (!created.ok) throw new Error(created.message);
      expect(
        created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, headBodyRatio: 2.5 }).ok,
      ).toBe(true);

      const joints = [...(vrm.springBoneManager?.joints ?? [])];
      expect(joints.length).toBeGreaterThan(0);
      if (!withColliders) for (const joint of joints) joint.colliderGroups = [];
      const pivot = vrm.scene.getObjectByName("HairRoot");
      if (!pivot) throw new Error("expected a hair pivot");
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (!head) throw new Error("expected a head bone");
      const localOf = (bone: Object3D): Vector3 =>
        pivot.worldToLocal(bone.getWorldPosition(new Vector3()));

      vrm.scene.updateMatrixWorld(true);
      const rest = joints.map((joint) => depth(localOf(joint.bone)));
      let worst = 0;
      for (let step = 0; step < 180; step += 1) {
        head.quaternion.setFromEuler(
          new Euler(Math.sin(step / 11) * 0.5, Math.sin(step / 8) * 1.1, 0, "XYZ"),
        );
        vrm.scene.updateMatrixWorld(true);
        vrm.update(1 / 60);
        if (step < 30) continue;
        vrm.scene.updateMatrixWorld(true);
        joints.forEach((joint, index) => {
          worst = Math.min(worst, depth(localOf(joint.bone)) - rest[index]);
        });
      }
      return worst;
    };

    const guarded = await worstDip(true);
    const bare = await worstDip(false);
    // 콜라이더를 뗀 쪽이 더 깊이 파고들어야 한다. 고칠 때 둘 다 -0.376 로 같았다.
    expect(guarded, "콜라이더가 머리 확대 후 아무 일도 하지 않는다").toBeGreaterThan(bare * 0.8);
    expect(bare).toBeLessThan(-0.2);
  }, 60_000);

  it("gives the loaded humanoid finger bones that actually drive the hand mesh", async () => {
    // 예전에는 손이 벙어리장갑 하나에 엄지 돌기를 붙인 형태였고 손가락 본이 아예 없었다.
    // 포즈 라이브러리도 리타게팅도 손가락을 굽힐 대상 자체가 없었다.
    const vrm = await loadVrmBytes(
      exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId: "natural-short" })),
    );
    const fingerBones = STUDIO_VRM_RIG_BONES.filter((bone) => !STUDIO_VRM_EXPORT_REQUIRED_BONES.includes(bone as never));
    expect(fingerBones).toHaveLength(30);
    for (const bone of fingerBones) {
      expect(
        vrm.humanoid?.getNormalizedBoneNode(bone as VRMHumanBoneName),
        `${bone} 이 로더에서 사라졌다`,
      ).not.toBeNull();
    }

    // 손가락을 굽히면 손 메시가 실제로 따라와야 한다 — 본만 있고 웨이트가 없으면 아무 일도 없다.
    const skinned = vrm.scene.getObjectByProperty("type", "SkinnedMesh") as
      | (Object3D & { skeleton?: { bones: Object3D[] } })
      | undefined;
    expect(skinned).toBeDefined();
    const tip = vrm.humanoid?.getNormalizedBoneNode("leftMiddleDistal" as VRMHumanBoneName);
    const proximal = vrm.humanoid?.getNormalizedBoneNode("leftMiddleProximal" as VRMHumanBoneName);
    if (!tip || !proximal) throw new Error("expected middle finger bones");
    vrm.scene.updateMatrixWorld(true);
    const before = tip.getWorldPosition(new Vector3());
    proximal.rotation.z = 1.1;
    vrm.scene.updateMatrixWorld(true);
    vrm.update(1 / 60);
    vrm.scene.updateMatrixWorld(true);
    const after = tip.getWorldPosition(new Vector3());
    expect(after.distanceTo(before), "가운뎃손가락을 굽혔는데 끝마디가 움직이지 않았다").toBeGreaterThan(
      0.01,
    );
  }, 60_000);

  it("applies the hand size once, not twice", async () => {
    // 손가락은 손 아래에 있다. 손 크기를 노드 스케일로 두면 저작이 이미 스케일된 관절 위치를
    // 쓰는 데다 바인드가 관절 기준으로 한 번 더 적용해, handScale 1.5 에서 손바닥이 2.25배로
    // 늘어나 너클보다 4.6cm 튀어나왔다.
    const reach: number[] = [];
    for (const handScale of [1, 1.5]) {
      const base = createAvatarForgeState("natural-short");
      const state = { ...base, proportions: { ...base.proportions, handScale } };
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ state })),
      );
      vrm.scene.updateMatrixWorld(true);
      const wrist = vrm.humanoid?.getRawBoneNode("leftHand")?.getWorldPosition(new Vector3());
      if (!wrist) throw new Error("no wrist");
      let body: SkinnedMesh | null = null;
      vrm.scene.traverse((object) => {
        if (object instanceof SkinnedMesh && /Body/i.test(`${object.name} ${object.parent?.name ?? ""}`)) {
          body = object;
        }
      });
      const skinned = body as SkinnedMesh | null;
      if (!skinned) throw new Error("no body mesh");
      skinned.updateMatrixWorld(true);
      const palmBone = skinned.skeleton.bones.findIndex((bone) => bone.name === "leftHand");
      expect(palmBone).toBeGreaterThanOrEqual(0);
      const skinIndex = skinned.geometry.attributes.skinIndex;
      const skinWeight = skinned.geometry.attributes.skinWeight;
      const point = new Vector3();
      let furthest = 0;
      for (let vertex = 0; vertex < skinned.geometry.attributes.position.count; vertex += 1) {
        let weight = 0;
        for (let slot = 0; slot < 4; slot += 1) {
          if (skinIndex.getComponent(vertex, slot) === palmBone) {
            weight += skinWeight.getComponent(vertex, slot);
          }
        }
        if (weight < 0.999) continue;
        skinned.getVertexPosition(vertex, point);
        point.applyMatrix4(skinned.matrixWorld);
        furthest = Math.max(furthest, point.x - wrist.x);
      }
      expect(furthest).toBeGreaterThan(0);
      reach.push(furthest);
    }
    expect(reach[1] / reach[0], "손 크기가 두 번 적용됐다").toBeCloseTo(1.5, 3);
  }, 60_000);

  it("ignores an authored root scale when sizing colliders", async () => {
    // 콜라이더 상속 배율을 월드에서 읽으면, 수명주기가 씬 루트를 항등으로 되돌리는 것을
    // 콜라이더 자체가 줄어든 것으로 오독한다 — 루트 스케일 2 인 모델에서 중립 적용만 해도
    // 로컬 오프셋이 두 배가 되고, 포즈가 복원되면 월드에서 다시 두 배가 된다.
    const presetId = "hime-noble";
    const local: number[][] = [];
    for (const rootScale of [1, 2]) {
      const vrm = await loadVrmBytes(
        exportStudioVrmFromGenerateRecipe(createStudioVrmGenerateRecipe({ presetId })),
      );
      vrm.scene.scale.setScalar(rootScale);
      vrm.scene.updateMatrixWorld(true);
      const adapter = createStudioVrmProportionVrmAdapter({
        vrm,
        getCurrentModelGeneration: () => 1,
        reapplyAuthoredPose: () => {
          vrm.scene.scale.setScalar(rootScale);
          vrm.scene.updateMatrixWorld(true);
          return true;
        },
      });
      const created = createStudioVrmProportionRigRuntime(adapter, {
        headLength: measureStudioVrmProportionHeadLength(vrm)?.value ?? 0.2,
      });
      if (!created.ok) throw new Error(created.message);
      expect(created.runtime.apply({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS }).ok).toBe(true);
      local.push(
        [...(vrm.springBoneManager?.colliders ?? [])].map((collider) => {
          const shape = (collider as unknown as { shape: { radius: number; offset: Vector3 } }).shape;
          return shape.offset.y;
        }),
      );
    }
    // 중립 적용이므로 저작 값 그대로여야 하고, 루트 스케일과 무관해야 한다.
    expect(local[1]).toHaveLength(local[0].length);
    local[0].forEach((value, index) => {
      expect(local[1][index], "루트 스케일이 콜라이더 크기에 새어 들었다").toBeCloseTo(value, 9);
    });
  }, 60_000);
});
