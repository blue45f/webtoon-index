import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureStudioBg3dRaster } from "./studio-bg3d-capture-adapter";
import {
  createStudioBg3dModelThumbnailThreeCapture,
  StudioBg3dModelThumbnailThreeCaptureError,
} from "./studio-bg3d-model-thumbnail-three-capture";

import type { StudioBg3dCaptureAdapter } from "./studio-bg3d-capture-adapter";

// The WebGPU adapter lives behind the approved lazy entry, which pulls Three's whole WebGPU build.
// Thumbnails only need to prove they route to it, so the module is stubbed here.
const webgpuAdapterFactory = vi.hoisted(() => vi.fn());
vi.mock("./studio-bg3d-three-webgpu-entry", () => ({
  createStudioBg3dThreeWebGpuCaptureAdapter: webgpuAdapterFactory,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface RendererFixtureOptions {
  readonly readback?: Promise<THREE.TypedArray>;
  readonly renderFailure?: Error;
  readonly onSceneRender?: (scene: THREE.Scene, camera: THREE.Camera) => void;
}

function rendererFixture(options: RendererFixtureOptions = {}) {
  const bottomUpRgba = Uint8Array.from([
    1, 2, 3, 255,
    4, 5, 6, 128,
    7, 8, 9, 64,
    10, 11, 12, 0,
  ]);
  const initialTarget = new THREE.WebGLRenderTarget(7, 5);
  let renderTarget: THREE.WebGLRenderTarget | null = initialTarget;
  let activeCubeFace = 3;
  let activeMipmapLevel = 2;
  let clearColor = new THREE.Color("#172233");
  let clearAlpha = 0.42;
  let viewport = new THREE.Vector4(9, 8, 7, 6);
  let scissor = new THREE.Vector4(5, 4, 3, 2);
  let scissorTest = true;
  let sceneRenderCount = 0;
  const renderer = {
    isWebGLRenderer: true,
    domElement: { width: 640, height: 360 } as HTMLCanvasElement,
    autoClear: false,
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 2.25,
    xr: { enabled: true },
    getRenderTarget: vi.fn(() => renderTarget),
    getActiveCubeFace: vi.fn(() => activeCubeFace),
    getActiveMipmapLevel: vi.fn(() => activeMipmapLevel),
    getClearColor: vi.fn((target: THREE.Color) => target.copy(clearColor)),
    getClearAlpha: vi.fn(() => clearAlpha),
    getViewport: vi.fn((target: THREE.Vector4) => target.copy(viewport)),
    getScissor: vi.fn((target: THREE.Vector4) => target.copy(scissor)),
    getScissorTest: vi.fn(() => scissorTest),
    setRenderTarget: vi.fn(
      (next: THREE.WebGLRenderTarget | null, cubeFace = 0, mipmapLevel = 0) => {
        renderTarget = next;
        activeCubeFace = cubeFace;
        activeMipmapLevel = mipmapLevel;
      },
    ),
    setViewport: vi.fn((next: THREE.Vector4) => {
      viewport = next.clone();
    }),
    setScissor: vi.fn((next: THREE.Vector4) => {
      scissor = next.clone();
    }),
    setScissorTest: vi.fn((next: boolean) => {
      scissorTest = next;
    }),
    setClearColor: vi.fn((next: THREE.Color | string | number, alpha: number) => {
      clearColor = next instanceof THREE.Color ? next.clone() : new THREE.Color(next);
      clearAlpha = alpha;
    }),
    clear: vi.fn(),
    render: vi.fn((object: THREE.Object3D, camera: THREE.Camera) => {
      if ((object as THREE.Scene & { readonly isScene?: boolean }).isScene !== true) return;
      sceneRenderCount += 1;
      options.onSceneRender?.(object as THREE.Scene, camera);
      if (sceneRenderCount === 1 && options.renderFailure) throw options.renderFailure;
    }),
    readRenderTargetPixelsAsync: vi.fn(
      (
        _target: THREE.WebGLRenderTarget,
        _x: number,
        _y: number,
        width: number,
        height: number,
        packed: THREE.TypedArray,
      ) => {
        expect(width).toBe(2);
        expect(height).toBe(2);
        (packed as Uint8Array).set(bottomUpRgba);
        return options.readback ?? Promise.resolve(packed);
      },
    ),
  } as unknown as THREE.WebGLRenderer;
  return {
    bottomUpRgba,
    initialTarget,
    renderer,
    current: () => ({
      activeCubeFace,
      activeMipmapLevel,
      autoClear: renderer.autoClear,
      clearAlpha,
      clearColor: clearColor.clone(),
      outputColorSpace: renderer.outputColorSpace,
      renderTarget,
      scissor: scissor.clone(),
      scissorTest,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
      viewport: viewport.clone(),
      xrEnabled: renderer.xr.enabled,
    }),
  };
}

function expectOriginalRendererState(fixture: ReturnType<typeof rendererFixture>) {
  expect(fixture.current()).toEqual({
    activeCubeFace: 3,
    activeMipmapLevel: 2,
    autoClear: false,
    clearAlpha: 0.42,
    clearColor: new THREE.Color("#172233"),
    outputColorSpace: THREE.LinearSRGBColorSpace,
    renderTarget: fixture.initialTarget,
    scissor: new THREE.Vector4(5, 4, 3, 2),
    scissorTest: true,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 2.25,
    viewport: new THREE.Vector4(9, 8, 7, 6),
    xrEnabled: true,
  });
}

function modelFixture() {
  const texture = new THREE.DataTexture(
    Uint8Array.from([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  const material = new THREE.MeshStandardMaterial({ color: "#ca7959", map: texture });
  const geometry = new THREE.BoxGeometry(3, 5, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0.4, 2.5, -0.25);
  const cachedRoot = new THREE.Group();
  cachedRoot.name = "cache-owned model";
  cachedRoot.position.set(1.5, -0.75, 2.25);
  cachedRoot.rotation.set(0.08, 0.31, -0.04);
  cachedRoot.scale.set(1.2, 0.85, 1.1);
  cachedRoot.add(mesh);
  const importedLight = new THREE.PointLight(0xff0000, 100);
  importedLight.name = "imported light";
  cachedRoot.add(importedLight);
  const parent = new THREE.Group();
  parent.position.set(-4, 1.2, 3);
  parent.rotation.set(-0.12, 0.44, 0.07);
  parent.scale.set(0.9, 1.35, 1.1);
  parent.add(cachedRoot);
  parent.updateWorldMatrix(true, true);
  return { cachedRoot, geometry, importedLight, material, parent, texture };
}

const cloneRoot = (root: THREE.Object3D) => Promise.resolve(root.clone(true));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isolated Three model thumbnail capture", () => {
  it("keeps the cached root parented, frames its world AABB, and uses clone-local neutral lighting", async () => {
    const model = modelFixture();
    const expectedBounds = new THREE.Box3().setFromObject(model.cachedRoot, true);
    let capturedScene: THREE.Scene | null = null;
    let capturedCamera: THREE.Camera | null = null;
    const renderer = rendererFixture({
      onSceneRender(scene, camera) {
        capturedScene = scene;
        capturedCamera = camera;
      },
    });
    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot },
    });

    expect(model.cachedRoot.parent).toBe(model.parent);
    expect(handle.framing.worldBoundsMin).toEqual([
      expectedBounds.min.x,
      expectedBounds.min.y,
      expectedBounds.min.z,
    ]);
    expect(handle.framing.worldBoundsMax).toEqual([
      expectedBounds.max.x,
      expectedBounds.max.y,
      expectedBounds.max.z,
    ]);

    await captureStudioBg3dRaster(handle.adapter, {
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#f5f3ef", alpha: 1 },
    });
    expect(capturedScene).toBeInstanceOf(THREE.Scene);
    expect(capturedCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    const clonedModel = capturedScene!.getObjectByName("cache-owned model");
    expect(clonedModel).toBeDefined();
    expect(clonedModel).not.toBe(model.cachedRoot);
    expect(capturedScene!.getObjectByName("imported light")?.visible).toBe(false);
    expect(model.importedLight.visible).toBe(true);
    expect(capturedScene!.getObjectByName("Studio thumbnail neutral hemisphere")).toBeInstanceOf(
      THREE.HemisphereLight,
    );
    expect(capturedScene!.getObjectByName("Studio thumbnail neutral key")).toBeInstanceOf(
      THREE.DirectionalLight,
    );
    expect(capturedScene!.getObjectByName("Studio thumbnail neutral fill")).toBeInstanceOf(
      THREE.DirectionalLight,
    );

    const framing = handle.framing;
    const camera = new THREE.PerspectiveCamera(
      framing.fovDegrees,
      framing.aspect,
      framing.near,
      framing.far,
    );
    camera.position.fromArray(framing.cameraPosition);
    camera.lookAt(new THREE.Vector3().fromArray(framing.target));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3(
      new THREE.Vector3().fromArray(framing.worldBoundsMin),
      new THREE.Vector3().fromArray(framing.worldBoundsMax),
    );
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.94);
          expect(Math.abs(projected.y)).toBeLessThan(0.94);
          expect(projected.z).toBeGreaterThanOrEqual(-1);
          expect(projected.z).toBeLessThanOrEqual(1);
        }
      }
    }
    handle.dispose();
    expect(handle.disposed).toBe(true);
    expect(capturedScene!.children).toHaveLength(0);
    expect(model.cachedRoot.parent).toBe(model.parent);
  });

  it("restores every live renderer field before the GPU fence settles and returns top-down RGBA", async () => {
    const readback = deferred<THREE.TypedArray>();
    const model = modelFixture();
    let sawNeutralState = false;
    const renderer = rendererFixture({
      readback: readback.promise,
      onSceneRender() {
        const current = renderer.current();
        expect(current.outputColorSpace).toBe(THREE.SRGBColorSpace);
        expect(current.toneMapping).toBe(THREE.NeutralToneMapping);
        expect(current.toneMappingExposure).toBe(1);
        expect(current.autoClear).toBe(true);
        expect(current.xrEnabled).toBe(false);
        expect(current.viewport).toEqual(new THREE.Vector4(0, 0, 2, 2));
        expect(current.scissor).toEqual(new THREE.Vector4(0, 0, 2, 2));
        expect(current.scissorTest).toBe(false);
        sawNeutralState = true;
      },
    });
    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot },
    });
    const pending = captureStudioBg3dRaster(handle.adapter, {
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#f5f3ef", alpha: 1 },
    });

    expect(sawNeutralState).toBe(true);
    expectOriginalRendererState(renderer);
    readback.resolve(renderer.bottomUpRgba);
    await expect(pending).resolves.toMatchObject({
      width: 2,
      height: 2,
      rgba: Uint8ClampedArray.from([
        7, 8, 9, 64,
        10, 11, 12, 0,
        1, 2, 3, 255,
        4, 5, 6, 128,
      ]),
    });
    expectOriginalRendererState(renderer);
    handle.dispose();
  });

  it("restores renderer state on render failure and never disposes cache-owned render resources", async () => {
    const failure = new Error("thumbnail render failed");
    const renderer = rendererFixture({ renderFailure: failure });
    const model = modelFixture();
    const geometryDispose = vi.spyOn(model.geometry, "dispose");
    const materialDispose = vi.spyOn(model.material, "dispose");
    const textureDispose = vi.spyOn(model.texture, "dispose");
    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot },
    });

    await expect(captureStudioBg3dRaster(handle.adapter, {
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#f5f3ef", alpha: 1 },
    })).rejects.toBe(failure);
    expectOriginalRendererState(renderer);
    handle.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    expect(model.cachedRoot.parent).toBe(model.parent);
  });

  it("fails closed for aborted or stale epochs before cloning and after GPU readback", async () => {
    const model = modelFixture();
    const renderer = rendererFixture();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const cloneSpy = vi.fn(cloneRoot);
    await expect(createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      signal: alreadyAborted.signal,
      dependencies: { cloneRoot: cloneSpy },
    })).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(cloneSpy).not.toHaveBeenCalled();
    await expect(createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      isCurrent: () => false,
      dependencies: { cloneRoot: cloneSpy },
    })).rejects.toMatchObject({ code: "stale" });
    expect(cloneSpy).not.toHaveBeenCalled();

    const lateReadback = deferred<THREE.TypedArray>();
    let current = true;
    const lateRenderer = rendererFixture({ readback: lateReadback.promise });
    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: lateRenderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      isCurrent: () => current,
      dependencies: { cloneRoot },
    });
    const pending = captureStudioBg3dRaster(handle.adapter, {
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#f5f3ef", alpha: 1 },
    });
    current = false;
    lateReadback.resolve(lateRenderer.bottomUpRgba);
    await expect(pending).rejects.toMatchObject({ code: "stale" });
    expectOriginalRendererState(lateRenderer);
    handle.dispose();

    const abortReadback = deferred<THREE.TypedArray>();
    const abortController = new AbortController();
    const abortRenderer = rendererFixture({ readback: abortReadback.promise });
    const abortHandle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: abortRenderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      signal: abortController.signal,
      dependencies: { cloneRoot },
    });
    const abortedCapture = captureStudioBg3dRaster(abortHandle.adapter, {
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#f5f3ef", alpha: 1 },
    });
    abortController.abort();
    // Renderer state is no longer borrowed even though the adapter retains its isolated graph
    // until the already-submitted GPU fence resolves.
    expectOriginalRendererState(abortRenderer);
    abortReadback.resolve(abortRenderer.bottomUpRgba);
    await expect(abortedCapture).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    abortHandle.dispose();
  });

  it("rejects oversized dimensions, wrong capture dimensions, depth, and non-clones before rendering", async () => {
    const model = modelFixture();
    const renderer = rendererFixture();
    const cloneSpy = vi.fn(cloneRoot);
    await expect(createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 513,
      height: 2,
      dependencies: { cloneRoot: cloneSpy },
    })).rejects.toMatchObject({ code: "invalid-dimensions" });
    expect(cloneSpy).not.toHaveBeenCalled();
    await expect(createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot: async () => model.cachedRoot },
    })).rejects.toMatchObject({ code: "clone-failed" });
    expect(model.cachedRoot.parent).toBe(model.parent);

    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer.renderer,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot },
    });
    await expect(handle.adapter.capture({
      width: 3,
      height: 2,
      includeDepth: false,
      background: { color: "#ffffff", alpha: 1 },
    })).rejects.toMatchObject({ code: "invalid-dimensions" });
    await expect(handle.adapter.capture({
      width: 2,
      height: 2,
      includeDepth: true,
      background: { color: "#ffffff", alpha: 1 },
    })).rejects.toMatchObject({ code: "invalid-dimensions" });
    expect(renderer.renderer.render).not.toHaveBeenCalled();
    handle.dispose();
    await expect(handle.adapter.capture({
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#ffffff", alpha: 1 },
    })).rejects.toBeInstanceOf(StudioBg3dModelThumbnailThreeCaptureError);
    await expect(handle.adapter.capture({
      width: 2,
      height: 2,
      includeDepth: false,
      background: { color: "#ffffff", alpha: 1 },
    })).rejects.toMatchObject({ code: "disposed" });
  });
});

describe("thumbnail capture on a WebGPU editor session", () => {
  it("routes to the WebGPU adapter instead of refusing the renderer", async () => {
    // Before this, the guard demanded `isWebGLRenderer`, and the caller swallows thumbnail
    // failures — so every imported model on a WebGPU session kept its placeholder card silently.
    const model = modelFixture();
    const base = rendererFixture();
    let isolatedScene: THREE.Scene | null = null;
    webgpuAdapterFactory.mockImplementation((input: {
      readonly scene: THREE.Scene;
    }): StudioBg3dCaptureAdapter => {
      isolatedScene = input.scene;
      return {
        backend: "three-webgpu",
        engineId: "three",
        engineVersion: "test",
        implementationRevision: "test",
        graphicsApi: "webgpu",
        profileId: "STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1",
        getSourceSize: () => ({ width: 2, height: 2 }),
        capture: () => Promise.reject(new Error("not exercised")),
      } as unknown as StudioBg3dCaptureAdapter;
    });

    const renderer = {
      ...(base.renderer as unknown as Record<string, unknown>),
      isWebGLRenderer: undefined,
      isWebGPURenderer: true,
      // Three's WebGPU renderer may expose no XR manager; the state fence must survive that.
      xr: undefined,
    };

    const handle = await createStudioBg3dModelThumbnailThreeCapture({
      renderer: renderer as never,
      cachedRoot: model.cachedRoot,
      width: 2,
      height: 2,
      dependencies: { cloneRoot },
    });

    expect(webgpuAdapterFactory).toHaveBeenCalledTimes(1);
    expect(handle.adapter.backend).toBe("three-webgpu");
    // The isolated scene is still the module's own clone graph, not the cache-owned root.
    expect(isolatedScene).not.toBeNull();
    expect(model.cachedRoot.parent).toBe(model.parent);
    handle.dispose();
  });

  it("still refuses a renderer that is neither backend", async () => {
    const model = modelFixture();
    await expect(createStudioBg3dModelThumbnailThreeCapture({
      renderer: { isWebGLRenderer: false } as never,
      cachedRoot: model.cachedRoot,
      dependencies: { cloneRoot },
    })).rejects.toBeInstanceOf(StudioBg3dModelThumbnailThreeCaptureError);
  });
});
