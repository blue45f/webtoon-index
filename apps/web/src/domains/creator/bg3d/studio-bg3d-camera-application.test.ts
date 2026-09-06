import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  applyStudioBg3dProjectionAwareZoom,
  applyStudioBg3dViewportAfterTransition,
  applyStudioBg3dViewToThreeCamera,
  isStudioBg3dViewportControlTarget,
  readStudioBg3dObjectWorldBounds,
  readStudioBg3dWorldSurfaceHit,
  type BgViewportApi,
} from "./studio-bg3d-camera-application";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

describe("Studio BG3D complete camera application", () => {
  it("distinguishes floating viewport controls from genuine scene misses", () => {
    const controlTarget = {
      closest: (selector: string) => selector === '[data-bg3d-viewport-control="true"]'
        ? { dataset: { bg3dViewportControl: "true" } }
        : null,
    } as unknown as EventTarget;
    const sceneTarget = { closest: () => null } as unknown as EventTarget;

    expect(isStudioBg3dViewportControlTarget(controlTarget)).toBe(true);
    expect(isStudioBg3dViewportControlTarget(sceneTarget)).toBe(false);
    expect(isStudioBg3dViewportControlTarget(null)).toBe(false);
  });

  it("waits for a replacement viewport identity and paints on both sides of view application", async () => {
    const events: string[] = [];
    const view = DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera;
    const makeApi = (name: string): BgViewportApi => ({
      zoomBy: () => true,
      applyPreset: () => true,
      applyView: () => {
        events.push(`apply:${name}`);
        return true;
      },
      readView: () => view,
      readFramingState: () => ({ view, viewportAspect: 1 }),
      focusOn: () => undefined,
    });
    const previous = makeApi("stale");
    const replacement = makeApi("replacement");
    let current: BgViewportApi | null = previous;
    let paints = 0;

    const result = await applyStudioBg3dViewportAfterTransition({
      view,
      previousApi: previous,
      requireReplacement: true,
      readApi: () => current,
      isActive: () => true,
      waitForPaintFrame: async () => {
        paints += 1;
        events.push(`paint:${paints}`);
        if (paints === 1) current = replacement;
      },
      timeoutMs: 1_000,
    });

    expect(result).toBe(replacement);
    expect(events).toEqual(["paint:1", "apply:replacement", "paint:2"]);
  });

  it("preserves perspective fov, zoom, near plane, Dutch roll, position, and target", () => {
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 200);
    const target = new THREE.Vector3(0, 0, 0);
    const update = vi.fn();
    const view = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      position: [8, 5, 11] as const,
      target: [1.5, 2.25, -3] as const,
      fovDegrees: 37,
      projection: "perspective" as const,
      zoom: 1.75,
      lensShift: [0.125, -0.2] as const,
      nearClip: 0.025,
      up: [0, 0.8, 0.6] as const,
    };

    expect(applyStudioBg3dViewToThreeCamera(camera, { target, update }, view)).toBe(true);
    expect(camera.fov).toBe(37);
    expect(camera.zoom).toBe(1.75);
    expect(camera.near).toBe(0.025);
    expect(camera.up.toArray()).toEqual([0, 0.8, 0.6]);
    expect(camera.position.toArray()).toEqual([8, 5, 11]);
    expect(target.toArray()).toEqual([1.5, 2.25, -3]);
    expect(camera.view?.enabled).toBe(true);
    expect((camera.view?.offsetX ?? 0) / (camera.view?.fullWidth ?? 1)).toBeCloseTo(0.125);
    expect((camera.view?.offsetY ?? 0) / (camera.view?.fullHeight ?? 1)).toBeCloseTo(-0.2);
    expect(update).toHaveBeenCalledOnce();
  });

  it("fails closed on a stale projection camera and applies orthographic zoom after replacement", () => {
    const stalePerspective = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    const target = new THREE.Vector3(9, 9, 9);
    const view = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      position: [4, 7, 10] as const,
      target: [-2, 1, 3] as const,
      projection: "orthographic" as const,
      zoom: 3.5,
      lensShift: [-0.1, 0.15] as const,
      nearClip: 0.5,
      up: [1, 0, 0] as const,
    };

    expect(applyStudioBg3dViewToThreeCamera(stalePerspective, { target }, view)).toBe(false);
    expect(stalePerspective.position.toArray()).toEqual([0, 0, 0]);
    expect(target.toArray()).toEqual([9, 9, 9]);

    const replacement = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 200);
    expect(applyStudioBg3dViewToThreeCamera(replacement, { target }, view)).toBe(true);
    expect(replacement.zoom).toBe(3.5);
    expect(replacement.near).toBe(0.5);
    expect(replacement.up.toArray()).toEqual([1, 0, 0]);
    expect(replacement.position.toArray()).toEqual([4, 7, 10]);
    expect(target.toArray()).toEqual([-2, 1, 3]);
    expect((replacement.view?.offsetX ?? 0) / (replacement.view?.fullWidth ?? 1)).toBeCloseTo(-0.1);
    expect((replacement.view?.offsetY ?? 0) / (replacement.view?.fullHeight ?? 1)).toBeCloseTo(0.15);
  });

  it("clears a previous lens shift when the restored view has none", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.setViewOffset(1_000, 1_000, 120, -80, 1_000, 1_000);
    const view = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      lensShift: undefined,
    };

    expect(applyStudioBg3dViewToThreeCamera(camera, null, view)).toBe(true);
    expect(camera.view?.enabled).toBe(false);
  });

  it("fails malformed clipping and up vectors closed before mutating the live camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(1, 2, 3);
    const target = new THREE.Vector3(4, 5, 6);
    const baseline = {
      position: camera.position.clone(),
      target: target.clone(),
      near: camera.near,
      up: camera.up.clone(),
    };

    expect(applyStudioBg3dViewToThreeCamera(camera, { target }, {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      nearClip: 0,
    })).toBe(false);
    expect(applyStudioBg3dViewToThreeCamera(camera, { target }, {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      up: [0, 0, 0],
    })).toBe(false);
    expect(camera.position).toEqual(baseline.position);
    expect(target).toEqual(baseline.target);
    expect(camera.near).toBe(baseline.near);
    expect(camera.up).toEqual(baseline.up);
  });

  it("uses camera.zoom for orthographic buttons and preserves the current target", () => {
    const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200);
    camera.position.set(7, 5, 9);
    camera.zoom = 2;
    const target = new THREE.Vector3(1, 2, 3);
    const update = vi.fn();

    expect(applyStudioBg3dProjectionAwareZoom(
      camera,
      { target, update },
      0.82,
      [0, 0, 0],
    )).toBe(true);
    expect(camera.zoom).toBeCloseTo(2 / 0.82);
    expect(camera.position.toArray()).toEqual([7, 5, 9]);
    expect(target.toArray()).toEqual([1, 2, 3]);
    expect(update).toHaveBeenCalledOnce();
  });

  it("keeps perspective zoom on the view ray instead of changing projection zoom", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 0, 10);
    camera.zoom = 1.5;
    const target = new THREE.Vector3(0, 0, 2);

    expect(applyStudioBg3dProjectionAwareZoom(camera, { target }, 0.5, [0, 0, 0])).toBe(true);
    expect(camera.position.toArray()).toEqual([0, 0, 6]);
    expect(camera.zoom).toBe(1.5);
  });

  it("reads precise registered world bounds and rejects empty objects", () => {
    const parent = new THREE.Group();
    parent.position.set(4, 3, -2);
    parent.rotation.y = Math.PI / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
    mesh.position.set(1, 0, 0);
    parent.add(mesh);

    const bounds = readStudioBg3dObjectWorldBounds(parent);
    expect(bounds).not.toBeNull();
    expect(bounds?.min[0]).toBeCloseTo(1);
    expect(bounds?.max[0]).toBeCloseTo(7);
    expect(bounds?.min[1]).toBeCloseTo(1);
    expect(bounds?.max[1]).toBeCloseTo(5);
    expect(readStudioBg3dObjectWorldBounds(new THREE.Group())).toBeNull();
    mesh.geometry.dispose();
  });

  it("converts regular and instanced local normals through the complete world transform", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.rotation.z = Math.PI / 2;
    mesh.updateMatrixWorld(true);
    const regular = readStudioBg3dWorldSurfaceHit({
      object: mesh,
      point: new THREE.Vector3(1, 2, 3),
      normal: new THREE.Vector3(1, 0, 0),
    });
    expect(regular?.normal[0]).toBeCloseTo(0);
    expect(regular?.normal[1]).toBeCloseTo(1);

    const instanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      1,
    );
    instanced.setMatrixAt(0, new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    instanced.updateMatrixWorld(true);
    const hit = readStudioBg3dWorldSurfaceHit({
      object: instanced,
      instanceId: 0,
      point: new THREE.Vector3(0, 0, 0),
      normal: new THREE.Vector3(1, 0, 0),
    });
    expect(hit?.normal[0]).toBeCloseTo(0);
    expect(hit?.normal[1]).toBeCloseTo(-1);
    expect(readStudioBg3dWorldSurfaceHit({
      object: instanced,
      instanceId: 2,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(1, 0, 0),
    })).toBeNull();
    mesh.geometry.dispose();
    instanced.geometry.dispose();
    (instanced.material as THREE.Material).dispose();
  });
});
