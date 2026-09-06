import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import {
  planStudioVrmContactReplay,
  refineStudioVrmContact,
  releaseStudioVrmContactReplay,
  sameStudioVrmContactValues,
  type StudioVrmContactReplay,
} from "./studio-vrm-contact-refinement";
import { createAutoGripFingerOverrides, resolvePropAttachment, resolveSecondaryPropTarget } from "./studio-vrm-prop-rig";
import { propDefById } from "./studio-vrm-props";

import type { VrmPropRigMetrics, ResolvedPropAttachment } from "./studio-vrm-prop-rig";
import type { PropInstance, PropAnchorDef } from "./studio-vrm-props";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

// Base pose (-3), prop IK (-2), contact (-1.5), then raw-skeleton commit (-1).
const STUDIO_VRM_GRIP_CONTACT_PRIORITY = -1.5;
const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const LIMITS = [80, 100, 65].map(THREE.MathUtils.degToRad);
type ContactPass = { run(): void; release(): boolean };

function createContactPasses(vrm: VRM, items: readonly PropInstance[], metrics: VrmPropRigMetrics, locked: readonly string[]) {
  const authority = createAutoGripFingerOverrides(items, propDefById, metrics);
  const passes: ContactPass[] = [];
  for (const item of items) {
    const def = propDefById(item.propId);
    // Flat, precision-pinch and support poses keep their own authored profiles.
    if (!item.rig?.autoFingerPose || !def?.grip || !["cylinder", "handle"].includes(def.grip.kind)) continue;
    let resolved: ResolvedPropAttachment;
    try { resolved = resolvePropAttachment(def, item, metrics); } catch { continue; }
    if (!resolved.usesSmartRig) continue;
    const sourceHand = vrm.humanoid?.getNormalizedBoneNode(item.bone);
    if (!sourceHand) continue;
    const secondary = resolveSecondaryPropTarget(def, item);
    const contacts: Array<{ side: "left" | "right"; anchor: PropAnchorDef }> = [];
    if (item.bone === "leftHand" || item.bone === "rightHand") {
      contacts.push({ side: item.bone === "leftHand" ? "left" : "right", anchor: resolved.anchor });
    }
    if (secondary && secondary.influence >= 0.999) contacts.push({
      side: secondary.bone === "leftHand" ? "left" : "right", anchor: secondary.anchor,
    });
    for (const { side, anchor } of contacts) {
      if (!authority[`${side}IndexProximal`]) continue;
      const hand = vrm.humanoid?.getNormalizedBoneNode(`${side}Hand`);
      if (!hand) continue;
      const chains: THREE.Object3D[][] = [];
      for (const finger of FINGERS) {
        const names = SEGMENTS.map((segment) => `${side}${finger}${segment}` as VRMHumanBoneName);
        // A locked joint protects its entire finger, not unrelated unlocked fingers.
        if (names.some((name) => locked.includes(name))) continue;
        const nodes = names.map((name) => vrm.humanoid?.getNormalizedBoneNode(name));
        if (nodes.some((node) => !node)) continue;
        chains.push(nodes as THREE.Object3D[]);
      }
      if (chains.length === 0) continue;
      const bones = chains.flat();
      const endpoints = chains.map((chain) => chain[2]);
      const groups = chains.map((_, index) => [index * 3, index * 3 + 1, index * 3 + 2]);
      const radius = (anchor.gripRadius ?? def.grip.radius) * resolved.scale;
      const handSize = side === "left" ? metrics.leftHand : metrics.rightHand;
      if (![radius, handSize].every((value) => Number.isFinite(value) && value > 0)) continue;
      const target = new THREE.Vector3();
      const localTarget = new THREE.Vector3();
      const scratch = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const offset = new THREE.Vector3(...anchor.position).sub(new THREE.Vector3(...resolved.anchor.position)).multiplyScalar(resolved.scale);
      const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(resolved.rotationDeg[0]),
        THREE.MathUtils.degToRad(resolved.rotationDeg[1]),
        THREE.MathUtils.degToRad(resolved.rotationDeg[2]),
      ));
      let cache: StudioVrmContactReplay | null = null;
      let faulted = false;
      const read = () => bones.map((bone) => bone.rotation.z);
      const readShape = () => bones.flatMap((bone) => [
        bone.rotation.x, bone.rotation.y,
        bone.position.x, bone.position.y, bone.position.z,
        bone.scale.x, bone.scale.y, bone.scale.z,
      ]);
      const apply = (angles: readonly number[]) => {
        bones.forEach((bone, index) => { bone.rotation.z = angles[index]; });
        hand.updateWorldMatrix(true, true);
      };
      const release = (): boolean => {
        const previous = cache;
        cache = null;
        try {
          const original = releaseStudioVrmContactReplay(previous, read(), readShape());
          if (!original) return false;
          apply(original);
          return true;
        } catch {
          faulted = true;
          return false;
        }
      };
      passes.push({
        run() {
          if (faulted) return;
          try {
            if (vrm.humanoid?.getNormalizedBoneNode(`${side}Hand`) !== hand) {
              release();
              faulted = true;
              return;
            }
            sourceHand.updateWorldMatrix(true, false);
            target.set(...resolved.socketPosition);
            sourceHand.localToWorld(target);
            sourceHand.getWorldQuaternion(rotation).multiply(localRotation).normalize();
            target.add(scratch.copy(offset).applyQuaternion(rotation));
            hand.updateWorldMatrix(true, true);
            const determinant = hand.matrixWorld.determinant();
            if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12
              || !target.toArray().every(Number.isFinite)
              || target.distanceTo(hand.getWorldPosition(scratch)) > handSize * 1.8) {
              release(); // Do not leave a previous correction on an unreachable contact.
              return;
            }
            localTarget.copy(target);
            hand.worldToLocal(localTarget);
            const m = hand.matrixWorld.elements;
            const context = [localTarget.x, localTarget.y, localTarget.z];
            // Scale/shear Gram matrix is invariant under common rigid movement.
            for (let a = 0; a < 3; a += 1) {
              for (let b = a; b < 3; b += 1) context.push(m[a * 4] * m[b * 4] + m[a * 4 + 1] * m[b * 4 + 1] + m[a * 4 + 2] * m[b * 4 + 2]);
            }
            const shape = readShape();
            const current = read();
            if (![...context, ...shape, ...current].every(Number.isFinite)) { release(); return; }
            const plan = planStudioVrmContactReplay(cache, current, shape, context);
            if (plan.kind === "unchanged") return;
            if (plan.kind === "replay") { apply(plan.angles); return; }
            const initial = [...plan.angles];
            if (!sameStudioVrmContactValues(initial, current)) apply(initial);
            const result = refineStudioVrmContact({
              initial, groups,
              limits: bones.map((_, index) => LIMITS[index % 3]),
              goal: radius * 2.2 + handSize * 0.4,
              minImprovement: Math.max(1e-5, handSize * 0.008),
              allowRelaxation: true,
              maxAngularChange: THREE.MathUtils.degToRad(20),
              maxEvaluations: 64,
              apply,
              measure: () => Math.max(...endpoints.map((node) => node.getWorldPosition(scratch).distanceTo(target))),
              measureContacts: () => endpoints.map((node) => node.getWorldPosition(scratch).distanceTo(target)),
            });
            if (result.reason === "invalid" || !result.restored) {
              cache = null;
              faulted = true;
              return;
            }
            cache = { input: initial, output: [...result.angles], shape, context };
          } catch {
            release();
            faulted = true;
          }
        },
        release,
      });
    }
  }
  return passes;
}

const NO_LOCKS: readonly string[] = [];

export function StudioVrmGripContactRefine({ vrm, items, metrics, rigRevision, lockedBones = NO_LOCKS, disabled = false }: {
  vrm: VRM;
  items: readonly PropInstance[];
  metrics: VrmPropRigMetrics;
  rigRevision?: number;
  lockedBones?: readonly string[];
  disabled?: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const passes = useMemo(() => {
    void rigRevision;
    return disabled ? [] : createContactPasses(vrm, items, metrics, lockedBones);
  }, [disabled, items, lockedBones, metrics, rigRevision, vrm]);
  // Release old passes before the new frame callbacks run, including StrictMode replay.
  useLayoutEffect(() => {
    invalidate();
    return () => {
      let changed = false;
      passes.forEach((pass) => { changed = pass.release() || changed; });
      if (changed) {
        vrm.humanoid?.update();
        vrm.scene.updateMatrixWorld(true);
        invalidate();
      }
    };
  }, [invalidate, passes, vrm]);
  useFrame(() => { passes.forEach((pass) => pass.run()); }, STUDIO_VRM_GRIP_CONTACT_PRIORITY);
  return null;
}
