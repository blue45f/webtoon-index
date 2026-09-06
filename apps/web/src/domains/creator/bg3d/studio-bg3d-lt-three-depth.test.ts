import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerStudioBg3dDepthExcludedObject } from "./studio-bg3d-capture-exclusion";
import { captureStudioBg3dThreeDepth } from "./studio-bg3d-lt-three-depth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function rendererFixture(readback: Promise<THREE.TypedArray>) {
  const initialColor = new THREE.Color("#234567");
  let clearColor = initialColor.clone();
  let clearAlpha = 0.4;
  let renderTarget: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    autoClear: false,
    xr: { enabled: true },
    getRenderTarget: vi.fn(() => renderTarget),
    getClearColor: vi.fn((target: THREE.Color) => target.copy(clearColor)),
    getClearAlpha: vi.fn(() => clearAlpha),
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      renderTarget = next;
    }),
    setClearColor: vi.fn((next: THREE.Color | number | string, alpha: number) => {
      clearColor = next instanceof THREE.Color ? next.clone() : new THREE.Color(next);
      clearAlpha = alpha;
    }),
    clear: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn(
      (
        _target: THREE.WebGLRenderTarget,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        packed: THREE.TypedArray
      ) => {
        (packed as Uint8Array).set([
          64, 0, 0, 0,
          128, 0, 0, 0,
          192, 0, 0, 0,
          255, 255, 255, 255,
        ]);
        return readback;
      }
    ),
  } as unknown as THREE.WebGLRenderer;
  return {
    initialColor,
    renderer,
    current: () => ({ clearAlpha, clearColor, renderTarget }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureStudioBg3dThreeDepth", () => {
  it("restores live renderer state before asynchronous GPU readback settles", async () => {
    const readback = deferred<THREE.TypedArray>();
    const fixture = rendererFixture(readback.promise);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const originalOverride = new THREE.MeshBasicMaterial();
    const originalBackground = new THREE.DataTexture();
    scene.overrideMaterial = originalOverride;
    scene.background = originalBackground;
    scene.backgroundRotation.set(0.1, 0.8, 0.2);
    const originalBackgroundRotation = scene.backgroundRotation.clone();
    vi.mocked(fixture.renderer.clear).mockImplementationOnce(() => {
      scene.background = new THREE.Color("#abcdef");
      scene.backgroundRotation.set(1, 2, 3);
    });
    vi.mocked(fixture.renderer.render).mockImplementation((renderedScene) => {
      expect(renderedScene).toBe(scene);
      expect(scene.background).toBeNull();
    });
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.MeshDepthMaterial.prototype, "dispose");

    const pending = captureStudioBg3dThreeDepth({
      renderer: fixture.renderer,
      scene,
      camera,
      width: 2,
      height: 2,
    });

    expect(scene.overrideMaterial).toBe(originalOverride);
    expect(scene.background).toBe(originalBackground);
    expect(scene.backgroundRotation).toEqual(originalBackgroundRotation);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.current().renderTarget).toBeNull();
    expect(fixture.current().clearColor).toEqual(fixture.initialColor);
    expect(fixture.current().clearAlpha).toBe(0.4);
    expect(targetDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();

    readback.resolve(new Uint8Array(16));
    await expect(pending).resolves.toEqual(Float32Array.from([0.75, 1, 0.25, 0.5]));
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    originalOverride.dispose();
  });

  it("restores state and disposes temporary resources when readback rejects", async () => {
    const failure = new Error("context lost");
    const readback = deferred<THREE.TypedArray>();
    const fixture = rendererFixture(readback.promise);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const originalBackground = new THREE.Color("#102030");
    scene.background = originalBackground;
    vi.mocked(fixture.renderer.render).mockImplementation(() => {
      expect(scene.background).toBeNull();
    });
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.MeshDepthMaterial.prototype, "dispose");
    const pending = captureStudioBg3dThreeDepth({
      renderer: fixture.renderer,
      scene,
      camera,
      width: 2,
      height: 2,
    });

    expect(scene.overrideMaterial).toBeNull();
    expect(scene.background).toBe(originalBackground);
    expect(fixture.current().renderTarget).toBeNull();
    readback.reject(failure);

    await expect(pending).rejects.toBe(failure);
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("hides beauty-only contact geometry only for depth submission and restores it before readback", async () => {
    const readback = deferred<THREE.TypedArray>();
    const fixture = rendererFixture(readback.promise);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const visibleContactShadow = new THREE.Mesh();
    const alreadyHiddenContactShadow = new THREE.Mesh();
    alreadyHiddenContactShadow.visible = false;
    const importedLookingObject = new THREE.Mesh();
    importedLookingObject.userData.studioBg3dDepthExcluded = true;
    registerStudioBg3dDepthExcludedObject(visibleContactShadow);
    registerStudioBg3dDepthExcludedObject(alreadyHiddenContactShadow);
    scene.add(visibleContactShadow, alreadyHiddenContactShadow, importedLookingObject);
    vi.mocked(fixture.renderer.render).mockImplementation(() => {
      expect(visibleContactShadow.visible).toBe(false);
      expect(alreadyHiddenContactShadow.visible).toBe(false);
      expect(importedLookingObject.visible).toBe(true);
    });

    const pending = captureStudioBg3dThreeDepth({
      renderer: fixture.renderer,
      scene,
      camera,
      width: 2,
      height: 2,
    });

    expect(visibleContactShadow.visible).toBe(true);
    expect(alreadyHiddenContactShadow.visible).toBe(false);
    expect(importedLookingObject.visible).toBe(true);
    readback.resolve(new Uint8Array(16));
    await expect(pending).resolves.toBeInstanceOf(Float32Array);
  });

  it("restores and disposes when rendering fails before readback submission", async () => {
    const fixture = rendererFixture(Promise.resolve(new Uint8Array(4)));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const failure = new Error("render failed");
    const originalBackground = new THREE.DataTexture();
    const contactShadow = new THREE.Mesh();
    registerStudioBg3dDepthExcludedObject(contactShadow);
    scene.add(contactShadow);
    scene.background = originalBackground;
    vi.mocked(fixture.renderer.render).mockImplementation(() => {
      expect(scene.background).toBeNull();
      expect(contactShadow.visible).toBe(false);
      throw failure;
    });
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.MeshDepthMaterial.prototype, "dispose");

    await expect(
      captureStudioBg3dThreeDepth({
        renderer: fixture.renderer,
        scene,
        camera,
        width: 1,
        height: 1,
      })
    ).rejects.toBe(failure);

    expect(scene.overrideMaterial).toBeNull();
    expect(scene.background).toBe(originalBackground);
    expect(contactShadow.visible).toBe(true);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.current().renderTarget).toBeNull();
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("rejects malformed inputs and over-budget dimensions", async () => {
    const fixture = rendererFixture(Promise.resolve(new Uint8Array(4)));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    await expect(
      captureStudioBg3dThreeDepth({
        renderer: fixture.renderer,
        scene,
        camera,
        width: 0,
        height: 1,
      })
    ).rejects.toThrow(/dimensions/u);
    await expect(
      captureStudioBg3dThreeDepth({
        renderer: null as unknown as THREE.WebGLRenderer,
        scene,
        camera,
        width: 1,
        height: 1,
      })
    ).rejects.toThrow(/requires/u);
  });
});
