/**
 * Dev-only prop attachment comparison page. Open /tools/browser-harnesses/props-compare.html via Vite.
 * Applies the same production path as StudioVrmPoser (pose → metrics → auto-grip →
 * follower math) and renders 4 views: full, right hand + mug(handle), left hand +
 * book(flat), and a grip contact closeup.
 */
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { pickNaturalIdlePose } from "@/src/domains/creator/studio-pose-presets";
import { resolveStudioVrmFingerAuthority } from "@/src/domains/creator/vrm/studio-vrm-auto-grip-authority";
import {
  applyFingerRotations,
  applyPoseToVrm,
  correctVrmHangingHandPalmTwist,
  refineVrmGripFingerWrap,
  stripFingerBones,
  type FingerRotationMap,
  type PoseBoneMap,
} from "@/src/domains/creator/vrm/studio-vrm-poser-utils";
import { acquireStudioVrmPropAsset } from "@/src/domains/creator/vrm/studio-vrm-prop-asset-runtime";
import {
  createAutoGripFingerOverrides,
  measureVrmPropRigMetrics,
  resolvePropAttachment,
  resolveSecondaryPropTarget,
  type VrmPropRigMetrics,
} from "@/src/domains/creator/vrm/studio-vrm-prop-rig";
import {
  buildPropObject,
  propDefById,
  type PropInstance,
  type PropRigV2,
} from "@/src/domains/creator/vrm/studio-vrm-props";

const statusEl = document.getElementById("status")!;

function setStatus(text: string) {
  statusEl.textContent = text;
}

type HandSide = "left" | "right";

async function loadVrm(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  if (vrm.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
  return vrm;
}

function extractFingers(pose: PoseBoneMap): FingerRotationMap {
  const fingers: FingerRotationMap = {};
  for (const [boneName, bone] of Object.entries(pose)) {
    const rotation = bone?.rotation;
    if (!boneName.includes("Thumb") && !boneName.includes("Index") && !boneName.includes("Middle")
      && !boneName.includes("Ring") && !boneName.includes("Little")) continue;
    if (!rotation) continue;
    fingers[boneName as keyof FingerRotationMap] = [rotation[0], rotation[1], rotation[2]];
  }
  return fingers;
}

function rigV2(autoFingerPose = true): PropRigV2 {
  return {
    version: 2,
    mode: "auto",
    anchorId: "",
    autoScale: true,
    autoFingerPose,
    gripFit: 1,
    deltaPosition: [0, 0, 0],
    deltaRotationDeg: [0, 0, 0],
    deltaScale: 1,
  };
}

function instance(
  uid: string,
  propId: string,
  bone: "leftHand" | "rightHand",
): PropInstance {
  const def = propDefById(propId)!;
  const mirrored = def.defaultBone !== bone;
  const mirrorPosition: [number, number, number] = mirrored
    ? [-def.defaultPosition[0], def.defaultPosition[1], def.defaultPosition[2]]
    : [...def.defaultPosition];
  // Production instances carry a concrete anchor id; grip readiness fails closed without it.
  const anchor = def.anchors.find((candidate) => candidate.role === "primary")
    ?? def.anchors.find((candidate) => candidate.role === "surface")
    ?? def.anchors[0];
  return {
    uid,
    propId,
    bone,
    position: mirrorPosition,
    rotationDeg: [...def.defaultRotationDeg],
    scale: def.defaultScale ?? 1,
    color: def.defaultColor ?? null,
    rig: { ...rigV2(), anchorId: anchor.id },
  };
}

/** The projection's rigid follower math, applied once (pose is static here). */
async function attachProp(
  scene: THREE.Scene,
  vrm: VRM,
  item: PropInstance,
  metrics: VrmPropRigMetrics,
): Promise<THREE.Group | null> {
  const def = propDefById(item.propId);
  const boneNode = vrm.humanoid?.getNormalizedBoneNode(item.bone);
  if (!def || !boneNode) return null;
  const resolved = resolvePropAttachment(def, item, metrics);
  if (!resolved.usesSmartRig) return null;

  let object: THREE.Object3D;
  if (def.geometrySource.kind === "gltf") {
    const lease = await acquireStudioVrmPropAsset(item.propId, def.geometrySource);
    object = lease.object;
  } else {
    object = buildPropObject(
      THREE as unknown as Parameters<typeof buildPropObject>[0],
      def,
      item.color,
    ) as unknown as THREE.Object3D;
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
    object.scale.setScalar(1);
  }

  const group = new THREE.Group();
  group.name = `prop:${item.propId}`;
  group.add(object);

  boneNode.updateWorldMatrix(true, false);
  const socketWorldPosition = new THREE.Vector3(...resolved.socketPosition);
  boneNode.localToWorld(socketWorldPosition);
  const boneWorldQuaternion = boneNode.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(resolved.rotationDeg[0]),
    THREE.MathUtils.degToRad(resolved.rotationDeg[1]),
    THREE.MathUtils.degToRad(resolved.rotationDeg[2]),
    "XYZ",
  ));
  group.quaternion.copy(boneWorldQuaternion).multiply(localQuaternion).normalize();
  group.scale.setScalar(resolved.scale);
  const anchorWorldOffset = new THREE.Vector3(...resolved.anchor.position)
    .multiplyScalar(resolved.scale)
    .applyQuaternion(group.quaternion);
  group.position.copy(socketWorldPosition).sub(anchorWorldOffset);
  scene.add(group);

  const secondary = resolveSecondaryPropTarget(def, item);
  if (secondary && secondary.influence > 0) {
    // Two-bone IK is a live-frame feature; the harness reports it in the note instead.
    setStatus(`${item.propId}: secondary ${secondary.bone} influence ${secondary.influence}`);
  }
  return group;
}

type ViewKind = "full" | "right-item" | "left-item" | "close";

class Panel {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly kind: ViewKind;
  readonly host: HTMLElement;

  constructor(hostId: string, kind: ViewKind) {
    this.kind = kind;
    this.host = document.getElementById(hostId)!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.resize();
  }

  resize() {
    const w = Math.max(2, this.host.clientWidth);
    const h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(vrm: VRM) {
    const humanoid = vrm.humanoid;
    if (!humanoid) return;
    const handOf = (side: HandSide) =>
      humanoid.getNormalizedBoneNode(`${side}Hand`)?.getWorldPosition(new THREE.Vector3()) ?? null;
    const right = handOf("right");
    const left = handOf("left");
    if (this.kind === "full") {
      const hips = humanoid.getNormalizedBoneNode("hips")?.getWorldPosition(new THREE.Vector3());
      const head = humanoid.getNormalizedBoneNode("head")?.getWorldPosition(new THREE.Vector3());
      const mid = hips && head ? hips.clone().lerp(head, 0.55) : new THREE.Vector3(0, 1, 0);
      this.camera.position.set(mid.x, mid.y + 0.05, mid.z + 2.2);
      this.camera.lookAt(mid);
      return;
    }
    const focus = this.kind === "right-item" || this.kind === "close" ? right : left;
    if (!focus) return;
    const side: HandSide = this.kind === "right-item" || this.kind === "close" ? "right" : "left";
    const outside = side === "left" ? 1 : -1;
    const distance = this.kind === "close" ? 0.42 : 0.5;
    this.camera.position.set(
      focus.x + outside * distance * 0.8,
      focus.y + 0.16,
      focus.z + distance,
    );
    this.camera.lookAt(focus.x - outside * 0.02, focus.y - 0.04, focus.z);
  }

  render(scene: THREE.Scene) {
    this.renderer.render(scene, this.camera);
  }
}

const panels = {
  full: new Panel("full", "full"),
  rightItem: new Panel("right-item", "right-item"),
  leftItem: new Panel("left-item", "left-item"),
  close: new Panel("close", "close"),
};

let currentScene: THREE.Scene | null = null;
let currentVrm: VRM | null = null;

function renderAll() {
  if (!currentScene || !currentVrm) return;
  currentVrm.scene.updateMatrixWorld(true);
  for (const panel of Object.values(panels)) {
    panel.frame(currentVrm);
    panel.render(currentScene);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!currentScene || !currentVrm) return;
  renderAll();
}
animate();

async function selectCharacter(id: string, url: string, name: string) {
  setStatus(`${name} 로딩…`);
  try {
    const vrm = await loadVrm(url);
    const pose = pickNaturalIdlePose(id);
    const bones = pose.bones as PoseBoneMap;

    // Production order: stripped body pose → metrics → auto-grip → finger authority → palm twist.
    applyPoseToVrm(vrm, stripFingerBones(bones), pose.yOffset ?? 0, undefined, {
      skipPalmCorrect: true,
    });
    const metrics = measureVrmPropRigMetrics(vrm);

    const items = [
      instance(`${id}-mug`, "mug", "rightHand"),
      instance(`${id}-book`, "book", "leftHand"),
    ];
    const autoGrip = createAutoGripFingerOverrides(items, propDefById, metrics);
    const effective = resolveStudioVrmFingerAuthority(extractFingers(bones), autoGrip);
    applyFingerRotations(vrm, effective);
    correctVrmHangingHandPalmTwist(vrm);
    vrm.humanoid?.update();

    // Grip contact refinement: amplify finger curls until fingertips reach the palm socket.
    const gripTargets: Array<{
      side: "left" | "right";
      socketWorldPoint: THREE.Vector3;
      gripRadius: number;
      goalBias?: number;
    }> = [];
    for (const [side, propId] of [["right", "mug"], ["left", "book"]] as const) {
      const node = vrm.humanoid?.getNormalizedBoneNode(`${side}Hand`);
      const def2 = propDefById(propId);
      if (!node || !def2?.grip) continue;
      const socketWorld = new THREE.Vector3(...metrics.handSockets[`${side}Hand` as const].position);
      node.localToWorld(socketWorld);
      gripTargets.push({
        side,
        socketWorldPoint: socketWorld,
        gripRadius: def2.grip.radius,
        goalBias: def2.grip.kind === "flat" || def2.grip.kind === "support" ? 0.012 : 0,
      });
    }
    if (gripTargets.length > 0) {
      refineVrmGripFingerWrap(vrm, gripTargets);
      vrm.humanoid!.update();
    }

    const scene = new THREE.Scene();
    scene.add(vrm.scene);
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.4);
    keyLight.position.set(1.2, 2.2, 1.6);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const attachedGroups: THREE.Group[] = [];
    for (const item of items) {
      const group = await attachProp(scene, vrm, item, metrics);
      if (group) attachedGroups.push(group);
    }
    const gripCount = items.filter((item) => item.rig?.autoFingerPose).length;
    void gripCount;
    const gripLeft = Object.keys(autoGrip).filter((k) => k.startsWith("left")).length;
    const gripRight = Object.keys(autoGrip).filter((k) => k.startsWith("right")).length;
    const resolvedInfo = items.map((item) => {
      const def = propDefById(item.propId)!;
      const resolved = resolvePropAttachment(def, item, metrics);
      return `${item.propId}@${item.bone}: anchor=${resolved.anchorId} src=${resolved.socketSource} fit=${resolved.fit.kind} scale=${resolved.scale.toFixed(2)}`;
    }).join("\n");

    // Re-apply pose AFTER adding scene so matrices are consistent, then re-render.
    vrm.scene.updateMatrixWorld(true);
    currentScene = scene;
    currentVrm = vrm;
    renderAll();

    const note =
      `${name} · mug(오른손 handle) + book(왼손 flat)\n` +
      `autoGrip L=${gripLeft} R=${gripRight} attached=${attachedGroups.length}/2\n` +
      resolvedInfo;
    for (const id2 of ["full-note", "right-note", "left-note", "close-note"] as const) {
      const el = document.getElementById(id2);
      if (el) el.textContent = note;
    }
    setStatus(`${name} 준비`);
  } catch (error) {
    console.error(error);
    setStatus(`실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

document.querySelectorAll<HTMLButtonElement>("#bar button[data-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    void selectCharacter(btn.dataset.id!, btn.dataset.url!, btn.dataset.name!);
  });
});

// Auto-load Lumi for immediate capture.
void selectCharacter("sample-vrm", "/vrm/sample.vrm", "루미");
