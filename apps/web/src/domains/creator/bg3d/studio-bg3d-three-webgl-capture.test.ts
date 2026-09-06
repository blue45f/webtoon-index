import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureStudioBg3dRaster } from "./studio-bg3d-capture-adapter";
import { captureStudioBg3dThreeDepth } from "./studio-bg3d-lt-three-depth";
import {
  createStudioBg3dThreeWebglCaptureAdapter,
  registerStudioBg3dCaptureExcludedObject,
  registerStudioBg3dDepthExcludedObject,
} from "./studio-bg3d-three-webgl-capture";

vi.mock("./studio-bg3d-lt-three-depth", () => ({
  captureStudioBg3dThreeDepth: vi.fn(),
}));

const captureDepthMock = vi.mocked(captureStudioBg3dThreeDepth);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface FixtureOptions {
  readonly readback?: Promise<THREE.TypedArray>;
}

function fixture(options: FixtureOptions = {}) {
  // WebGL readPixels starts at the framebuffer's bottom row. The adapter must return the second
  // row first so downstream LT rasterization always sees top-down image coordinates.
  const bottomUpRgba = Uint8Array.from([
    1, 2, 3, 255,
    4, 5, 6, 128,
    7, 8, 9, 64,
    10, 11, 12, 0,
  ]);
  const initialTarget = new THREE.WebGLRenderTarget(3, 2);
  let renderTarget: THREE.WebGLRenderTarget | null = initialTarget;
  let activeCubeFace = 2;
  let activeMipmapLevel = 3;
  let clearColor = new THREE.Color("#102030");
  let clearAlpha = 0.35;
  let viewport = new THREE.Vector4(3, 5, 7, 11);
  let scissor = new THREE.Vector4(13, 17, 19, 23);
  let scissorTest = true;
  const sourceCanvas = { width: 320, height: 180 } as unknown as HTMLCanvasElement;
  const renderer = {
    isWebGLRenderer: true,
    domElement: sourceCanvas,
    autoClear: false,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.25,
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
      (next: THREE.WebGLRenderTarget | null, nextCubeFace = 0, nextMipmapLevel = 0) => {
        renderTarget = next;
        activeCubeFace = nextCubeFace;
        activeMipmapLevel = nextMipmapLevel;
      }
    ),
    setClearColor: vi.fn((next: THREE.Color | string | number, alpha: number) => {
      clearColor = next instanceof THREE.Color ? next.clone() : new THREE.Color(next);
      clearAlpha = alpha;
    }),
    setViewport: vi.fn((next: THREE.Vector4) => {
      viewport = next.clone();
    }),
    setScissor: vi.fn((next: THREE.Vector4) => {
      scissor = next.clone();
    }),
    setScissorTest: vi.fn((next: boolean) => {
      scissorTest = next;
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
        (packed as Uint8Array).set(bottomUpRgba);
        return options.readback ?? Promise.resolve(packed);
      }
    ),
  } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return {
    adapter: createStudioBg3dThreeWebglCaptureAdapter({ renderer, scene, camera }),
    bottomUpRgba,
    camera,
    initialTarget,
    renderer,
    scene,
    sourceCanvas,
    current: () => ({
      activeCubeFace,
      activeMipmapLevel,
      clearAlpha,
      clearColor,
      renderTarget,
      scissor,
      scissorTest,
      viewport,
    }),
  };
}

function expectLiveRendererStateRestored(f: ReturnType<typeof fixture>) {
  expect(f.current().renderTarget).toBe(f.initialTarget);
  expect(f.current().activeCubeFace).toBe(2);
  expect(f.current().activeMipmapLevel).toBe(3);
  expect(f.current().clearColor).toEqual(new THREE.Color("#102030"));
  expect(f.current().clearAlpha).toBe(0.35);
  expect(f.renderer.autoClear).toBe(false);
  expect(f.renderer.xr.enabled).toBe(true);
  expect(f.current().viewport).toEqual(new THREE.Vector4(3, 5, 7, 11));
  expect(f.current().scissor).toEqual(new THREE.Vector4(13, 17, 19, 23));
  expect(f.current().scissorTest).toBe(true);
}

afterEach(() => {
  captureDepthMock.mockReset();
  vi.restoreAllMocks();
});

describe("Three WebGL Studio 3D capture adapter", () => {
  it("uses GPU render targets, normalizes bottom-up readback, and never needs a 2D canvas", async () => {
    const f = fixture();
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    expect(f.adapter.getSourceSize()).toEqual({ width: 320, height: 180 });
    f.sourceCanvas.width = 640;
    f.sourceCanvas.height = 360;
    expect(f.adapter.getSourceSize()).toEqual({ width: 640, height: 360 });

    const result = await captureStudioBg3dRaster(f.adapter, {
      width: 2,
      height: 2,
      background: { color: "#abcdef", alpha: 0 },
      includeDepth: false,
    });

    // The first pass is the scene's premultiplied linear target; the second restores straight alpha
    // before tone mapping/sRGB. No sourceCanvas ownerDocument, drawImage, or getImageData is involved.
    expect(f.renderer.render).toHaveBeenCalledTimes(2);
    expect(f.renderer.render).toHaveBeenNthCalledWith(1, f.scene, f.camera);
    const sceneTarget = vi.mocked(f.renderer.setRenderTarget).mock.calls[0]?.[0];
    const outputTarget = vi.mocked(f.renderer.readRenderTargetPixelsAsync).mock.calls[0]?.[0];
    expect(sceneTarget).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(outputTarget).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(sceneTarget).not.toBe(outputTarget);
    expect(sceneTarget).toMatchObject({ depthBuffer: true, height: 2, width: 2 });
    expect(outputTarget).toMatchObject({ depthBuffer: false, height: 2, width: 2 });
    const outputMesh = vi.mocked(f.renderer.render).mock.calls[1]?.[0] as THREE.Mesh;
    const outputMaterial = outputMesh.material as THREE.ShaderMaterial;
    expect(outputMaterial.fragmentShader.indexOf("gl_FragColor.rgb /= gl_FragColor.a;")).toBeLessThan(
      outputMaterial.fragmentShader.indexOf("// tone mapping")
    );
    expect(f.renderer.clear).toHaveBeenCalledWith(true, true, true);
    expect(f.renderer.readRenderTargetPixelsAsync).toHaveBeenCalledWith(
      outputTarget,
      0,
      0,
      2,
      2,
      expect.any(Uint8Array)
    );
    expect(result.rgba).toEqual(Uint8ClampedArray.from([
      7, 8, 9, 64,
      10, 11, 12, 0,
      1, 2, 3, 255,
      4, 5, 6, 128,
    ]));
    expect(result.depth).toBeUndefined();
    expect(captureDepthMock).not.toHaveBeenCalled();
    expectLiveRendererStateRestored(f);
    expect(targetDispose).toHaveBeenCalledTimes(2);
  });

  it("keeps a procedural scene background in opaque color captures", async () => {
    const f = fixture();
    const panorama = new THREE.DataTexture();
    const reentrantBackground = new THREE.Color("#abcdef");
    f.scene.background = panorama;
    f.scene.backgroundRotation.set(0.1, 0.75, 0.2);
    const initialRotation = f.scene.backgroundRotation.clone();
    vi.mocked(f.renderer.clear).mockImplementationOnce(() => {
      f.scene.background = reentrantBackground;
      f.scene.backgroundRotation.set(1, 2, 3);
    });
    vi.mocked(f.renderer.render).mockImplementation((renderedScene) => {
      if (renderedScene !== f.scene) return;
      expect(f.scene.background).toBe(panorama);
      expect(f.scene.backgroundRotation).toEqual(initialRotation);
    });

    await captureStudioBg3dRaster(f.adapter, {
      width: 2,
      height: 2,
      background: { color: "#ffffff", alpha: 1 },
      includeDepth: false,
    });

    expect(f.scene.background).toBe(panorama);
    expect(f.scene.backgroundRotation).toEqual(initialRotation);
  });

  it("restores renderer and helper visibility before color/depth GPU fences settle", async () => {
    const colorReadback = deferred<THREE.TypedArray>();
    const depthReadback = deferred<Float32Array>();
    const f = fixture({ readback: colorReadback.promise });
    const visibleHelper = new THREE.Group();
    registerStudioBg3dCaptureExcludedObject(visibleHelper);
    const alreadyHiddenHelper = new THREE.Group();
    registerStudioBg3dCaptureExcludedObject(alreadyHiddenHelper);
    alreadyHiddenHelper.visible = false;
    const importedLookingNode = new THREE.Group();
    importedLookingNode.userData.studioCaptureExcluded = true;
    const beautyOnlyContactShadow = new THREE.Group();
    registerStudioBg3dDepthExcludedObject(beautyOnlyContactShadow);
    f.scene.add(
      visibleHelper,
      alreadyHiddenHelper,
      importedLookingNode,
      beautyOnlyContactShadow,
    );
    const panorama = new THREE.DataTexture();
    f.scene.background = panorama;
    vi.mocked(f.renderer.render).mockImplementation((renderedScene) => {
      if (renderedScene !== f.scene) return;
      expect(f.scene.background).toBeNull();
      expect(visibleHelper.visible).toBe(false);
      expect(alreadyHiddenHelper.visible).toBe(false);
      expect(importedLookingNode.visible).toBe(true);
      expect(beautyOnlyContactShadow.visible).toBe(true);
    });
    captureDepthMock.mockImplementationOnce(() => {
      expect(visibleHelper.visible).toBe(false);
      expect(alreadyHiddenHelper.visible).toBe(false);
      expect(importedLookingNode.visible).toBe(true);
      return depthReadback.promise;
    });

    const pending = captureStudioBg3dRaster(f.adapter, {
      width: 2,
      height: 2,
      background: { color: "#fedcba", alpha: 0 },
      includeDepth: true,
    });

    expect(captureDepthMock).toHaveBeenCalledWith({
      renderer: f.renderer,
      scene: f.scene,
      camera: f.camera,
      width: 2,
      height: 2,
    });
    expectLiveRendererStateRestored(f);
    expect(f.scene.background).toBe(panorama);
    expect(visibleHelper.visible).toBe(true);
    expect(alreadyHiddenHelper.visible).toBe(false);
    expect(importedLookingNode.visible).toBe(true);
    expect(beautyOnlyContactShadow.visible).toBe(true);

    colorReadback.resolve(f.bottomUpRgba);
    const depth = Float32Array.from([0, 0.25, 0.75, 1]);
    depthReadback.resolve(depth);
    await expect(pending).resolves.toMatchObject({ depth });
  });

  it("restores state and disposes both temporary targets when color or depth readback fails", async () => {
    const colorFailure = new Error("color GPU readback failed");
    const colorReadback = deferred<THREE.TypedArray>();
    const failedColor = fixture({ readback: colorReadback.promise });
    const colorTargetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    const colorPending = captureStudioBg3dRaster(failedColor.adapter, {
      width: 2,
      height: 2,
      background: { color: "#ffffff", alpha: 1 },
      includeDepth: false,
    });
    expectLiveRendererStateRestored(failedColor);
    colorReadback.reject(colorFailure);
    await expect(colorPending).rejects.toBe(colorFailure);
    expect(colorTargetDispose).toHaveBeenCalledTimes(2);

    const depthFailure = new Error("depth GPU readback failed");
    const failedDepth = fixture();
    const depthTargetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    captureDepthMock.mockRejectedValueOnce(depthFailure);
    await expect(
      captureStudioBg3dRaster(failedDepth.adapter, {
        width: 2,
        height: 2,
        background: { color: "#ffffff", alpha: 1 },
        includeDepth: true,
      })
    ).rejects.toBe(depthFailure);
    expectLiveRendererStateRestored(failedDepth);
    // The first spy remains active, so count only calls made after its previous two disposals.
    expect(depthTargetDispose).toHaveBeenCalledTimes(4);
  });

  it("restores state when the offscreen color scene pass throws before readback submission", async () => {
    const f = fixture();
    const failure = new Error("offscreen scene render failed");
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
    vi.mocked(f.renderer.render).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      captureStudioBg3dRaster(f.adapter, {
        width: 2,
        height: 2,
        background: { color: "#ffffff", alpha: 1 },
        includeDepth: false,
      })
    ).rejects.toBe(failure);
    expectLiveRendererStateRestored(f);
    expect(targetDispose).toHaveBeenCalledTimes(2);
  });

  it("rejects non-Three runtime objects at the factory boundary", () => {
    expect(() =>
      createStudioBg3dThreeWebglCaptureAdapter({
        renderer: {} as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
      })
    ).toThrow(/requires/u);
  });
});
