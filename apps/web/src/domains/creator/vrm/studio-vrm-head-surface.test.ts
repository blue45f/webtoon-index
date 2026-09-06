import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { Group, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import { measureStudioVrmHeadSurface, studioVrmHeadwearSurfaceSocket } from "./studio-vrm-head-surface";
import { measureVrmPropRigMetrics, resolvePropAttachment, sanitizeVrmPropRigMetrics, scaleVrmPropRigMetrics } from "./studio-vrm-prop-rig";
import { createPropInstance, propDefById } from "./studio-vrm-props";

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;
const fixtures = new Map<string, Promise<VRM>>();
function fixture(name: string): Promise<VRM> {
  const existing = fixtures.get(name);
  if (existing) return existing;
  const pending = (async () => {
    const bytes = readFileSync(join(process.cwd(), "apps/web/public/vrm", name));
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "");
    const vrm = gltf.userData.vrm as VRM;
    if (vrm.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    return vrm;
  })();
  fixtures.set(name, pending);
  return pending;
}

for (const filename of ["sample.vrm", "AvatarSample_B.vrm"]) {
  describe(`surface-derived wearable fit: ${filename}`, () => {
    it("measures the skull surface instead of the neck-to-head pivot gap", async () => {
      const vrm = await fixture(filename);
      const surface = measureStudioVrmHeadSurface(vrm)!;
      expect(surface).not.toBeNull();
      expect(surface.head).toBeGreaterThan(0.18);
      expect(surface.head).toBeLessThan(0.27);
      expect(surface.eyeDistance).toBeGreaterThan(0.06);
      expect(surface.eyeDistance).toBeLessThan(0.10);
      expect(["derived", "measured"]).toContain(surface.eyeDistanceSource);
      expect(Boolean(surface.faceSocket.hairClearanceRequired)).toBe(filename === "AvatarSample_B.vrm");
      expect(surface.faceSocket.surfaceCrownHeight).toBeGreaterThan(0.18);
      expect(surface.faceSocket.surfaceCrownHeight).toBeLessThan(0.28);
      expect(measureVrmPropRigMetrics(vrm).head).toBeCloseTo(surface.head, 5);
    });

    it("places eyewear at the actual eye height and on the visible front in VRM0 and VRM1", async () => {
      const vrm = await fixture(filename);
      const metrics = measureVrmPropRigMetrics(vrm);
      const head = vrm.humanoid.getNormalizedBoneNode("head")!;
      const eyes = ["leftEye", "rightEye"] as const;
      const eyeY = eyes.map((name) => head.worldToLocal(vrm.humanoid.getNormalizedBoneNode(name)!.getWorldPosition(new Vector3())).y);
      expect(metrics.faceSocket.position[1]).toBeCloseTo((eyeY[0]! + eyeY[1]!) / 2, 5);
      const world = head.localToWorld(new Vector3(...metrics.faceSocket.position));
      expect(world.z - head.getWorldPosition(new Vector3()).z).toBeGreaterThan(0.05);
      const expectedYaw = vrm.meta.metaVersion === "0" ? Math.PI : 0;
      const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), expectedYaw);
      expect(new Quaternion(...metrics.faceSocket.rotationQuaternion).angleTo(expected)).toBeLessThan(0.00001);
      const item = createPropInstance("sunglasses", "head-surface-test")!;
      const attached = resolvePropAttachment(propDefById("sunglasses")!, item, metrics);
      expect(attached.socketPosition).toEqual(metrics.faceSocket.position);
      expect(attached.scale).toBeGreaterThan(1);
    });

    it("uses reviewed crown contacts, preserves local sockets under body scaling and respects explicit bones", async () => {
      const metrics = measureVrmPropRigMetrics(await fixture(filename));
      const crown = metrics.faceSocket.surfaceCrownHeight!;
      for (const id of ["cap", "beret", "beanie", "headphones", "ribbon", "blender_wizard_hat"]) {
        const socket = studioVrmHeadwearSurfaceSocket(id, "head", metrics.faceSocket)!;
        expect(socket).not.toBeNull();
        expect(socket.position[1]).toBeGreaterThan(0.04);
        expect(socket.position[1]).toBeLessThan(crown + 0.02);
        const instance = createPropInstance(id, `surface-${id}`)!;
        expect(resolvePropAttachment(propDefById(id)!, instance, metrics).socketPosition).toEqual(socket.position);
        expect(studioVrmHeadwearSurfaceSocket(id, "neck", metrics.faceSocket)).toBeNull();
        expect(studioVrmHeadwearSurfaceSocket(id, "rightHand", metrics.faceSocket)).toBeNull();
      }
      const scaled = scaleVrmPropRigMetrics(metrics, { height: 1.3, width: 1.1 });
      expect(scaled.faceSocket).toEqual(metrics.faceSocket);
      expect(scaled.head).toBeCloseTo(metrics.head * 1.1, 5);
      expect(scaled.eyeDistance).toBeCloseTo(metrics.eyeDistance * 1.1, 5);
    });

    it("does not rewrite legacy placement or apply a new headwear socket in manual mode", async () => {
      const metrics = measureVrmPropRigMetrics(await fixture(filename));
      const definition = propDefById("cap")!;
      const item = createPropInstance("cap", "saved-cap")!;
      item.position = [0.02, 0.13, 0.03];
      item.rotationDeg = [10, 20, 30];
      delete item.rig;
      const attached = resolvePropAttachment(definition, item, metrics);
      expect(attached.position).toEqual(item.position);
      expect(attached.rotationDeg).toEqual(item.rotationDeg);
      expect(attached.usesSmartRig).toBe(false);
      const manual = createPropInstance("cap", "manual-cap")!;
      manual.rig = { ...manual.rig!, mode: "custom" };
      expect(resolvePropAttachment(definition, manual, metrics).socketPosition).toEqual(definition.defaultPosition);
    });
  });
}

describe("surface fitting fallback", () => {
  it("keeps partial rigs and old metrics on the existing fallback path", () => {
    const partial = { scene: new Group(), humanoid: { getNormalizedBoneNode: () => null } } as unknown as VRM;
    expect(measureStudioVrmHeadSurface(partial)).toBeNull();
    const metrics = sanitizeVrmPropRigMetrics(null);
    expect(metrics.faceSocket.surfaceMeasured).toBeUndefined();
    expect(studioVrmHeadwearSurfaceSocket("cap", "head", metrics.faceSocket)).toBeNull();
    expect(studioVrmHeadwearSurfaceSocket("unknown", "head", metrics.faceSocket)).toBeNull();
  });
});

describe("reviewed hanging-handle orientation", () => {
  it("keeps the medical bag below its handle without moving the serialized contact", () => {
    const primary = propDefById("medicalBag")!.anchors.find((anchor) => anchor.role === "primary")!;
    expect(primary.position).toEqual([0, 0.155, 0]);
    expect(primary.forward).toEqual([0, -1, 0]);
    expect(primary.up).toEqual([0, 0, 1]);
  });
});
