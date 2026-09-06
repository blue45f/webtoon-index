/**
 * Babylon-owned view-space normal pass for the renderer-neutral BG3D artifact pipeline.
 *
 * The public result is canonical top-down octahedral RG8. Babylon scenes, textures, and GPU
 * handles remain inside this module, and the temporary G-buffer is always removed before the
 * promise settles.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { GeometryBufferRenderer } from "@babylonjs/core/Rendering/geometryBufferRenderer";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";

import {
  packStudioBg3dBabylonNormals,
  type StudioBg3dBabylonNormalReadback,
} from "./studio-bg3d-babylon-normal-packing";

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/**
 * This first synchronous normal path owns two RGBA32F G-buffer attachments plus readback/depth
 * copies and packs octahedral output on the UI thread. Keep it to a 1024² preview until the
 * readback/packing stage moves to Worker/GPU memory.
 */
export const STUDIO_BG3D_BABYLON_NORMAL_CAPTURE_MAX_PIXELS = 1_048_576;
const STUDIO_BG3D_BABYLON_NORMAL_READY_TIMEOUT_MS = 10_000;
const STUDIO_BG3D_BABYLON_NORMAL_READY_POLL_MS = 8;

export type StudioBg3dBabylonNormalCaptureBackend = "webgl2" | "webgpu";

export type StudioBg3dBabylonNormalCaptureErrorCode =
  | "aborted"
  | "readback"
  | "unsupported";

export class StudioBg3dBabylonNormalCaptureError extends Error {
  constructor(
    readonly code: StudioBg3dBabylonNormalCaptureErrorCode,
    cause?: unknown,
  ) {
    super(
      `Studio Babylon normal capture failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dBabylonNormalCaptureError";
  }
}

export interface StudioBg3dBabylonNormalCaptureInput {
  readonly backend: StudioBg3dBabylonNormalCaptureBackend;
  /** Canonical top-down normalized view depth. */
  readonly depth: Float32Array;
  readonly height: number;
  readonly meshes: readonly AbstractMesh[];
  readonly scene: Scene;
  readonly signal: AbortSignal;
  readonly width: number;
}

export interface StudioBg3dBabylonNormalPassReadback {
  readonly data: StudioBg3dBabylonNormalReadback;
  readonly unsigned: boolean;
}

/**
 * Narrow seam used by focused tests and future specialist-host adapters. Product calls should use
 * the default dependency so the readback always comes from Babylon's real normal attachment.
 */
export interface StudioBg3dBabylonNormalPass {
  readonly dispose: () => void;
  readonly renderAndRead: (
    signal: AbortSignal,
  ) => Promise<StudioBg3dBabylonNormalPassReadback>;
}

export interface StudioBg3dBabylonNormalCaptureDependencies {
  readonly createPass?: (
    input: StudioBg3dBabylonNormalCaptureInput,
  ) => StudioBg3dBabylonNormalPass;
}

function normalCaptureError(
  code: StudioBg3dBabylonNormalCaptureErrorCode,
  cause?: unknown,
): StudioBg3dBabylonNormalCaptureError {
  return new StudioBg3dBabylonNormalCaptureError(code, cause);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw normalCaptureError("aborted");
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(normalCaptureError("aborted")));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function waitForNormalPassReadiness(
  renderer: GeometryBufferRenderer,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + STUDIO_BG3D_BABYLON_NORMAL_READY_TIMEOUT_MS;
  const gBuffer = renderer.getGBuffer();
  while (true) {
    throwIfAborted(signal);
    if (renderer.isSupported && gBuffer.isReadyForRendering()) return;
    if (Date.now() >= deadline) throw normalCaptureError("unsupported");
    await withAbort(
      new Promise<void>((resolve) => {
        setTimeout(resolve, STUDIO_BG3D_BABYLON_NORMAL_READY_POLL_MS);
      }),
      signal,
    );
  }
}

function validateInput(input: StudioBg3dBabylonNormalCaptureInput): number {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw normalCaptureError("readback");
  }
  const pixels = input.width * input.height;
  if (!Number.isSafeInteger(pixels)) {
    throw normalCaptureError("readback");
  }
  if (pixels > STUDIO_BG3D_BABYLON_NORMAL_CAPTURE_MAX_PIXELS) {
    throw normalCaptureError("unsupported");
  }
  if (
    !(input.depth instanceof Float32Array) ||
    Object.getPrototypeOf(input.depth) !== Float32Array.prototype ||
    input.depth.length !== pixels ||
    !Array.isArray(input.meshes) ||
    (input.backend !== "webgl2" && input.backend !== "webgpu")
  ) {
    throw normalCaptureError("readback");
  }
  for (const value of input.depth) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw normalCaptureError("readback");
    }
  }
  return pixels;
}

function normalizeFailure(
  error: unknown,
  signal: AbortSignal,
  fallback: Exclude<StudioBg3dBabylonNormalCaptureErrorCode, "aborted">,
): StudioBg3dBabylonNormalCaptureError {
  if (error instanceof StudioBg3dBabylonNormalCaptureError) return error;
  if (signal.aborted) return normalCaptureError("aborted", error);
  return normalCaptureError(fallback, error);
}

function assertBackend(scene: Scene, backend: StudioBg3dBabylonNormalCaptureBackend): void {
  const engine = scene.getEngine() as ReturnType<Scene["getEngine"]> & {
    readonly isWebGPU?: unknown;
    readonly webGLVersion?: unknown;
  };
  if (
    (backend === "webgl2" && (engine.isWebGPU === true || engine.webGLVersion !== 2)) ||
    (backend === "webgpu" && engine.isWebGPU !== true)
  ) {
    throw normalCaptureError("unsupported");
  }
}

function disposeTemporaryRenderer(
  scene: Scene,
  renderer: GeometryBufferRenderer,
): void {
  renderer.renderList = null;
  if (scene.geometryBufferRenderer === renderer) {
    scene.disableGeometryBufferRenderer();
    return;
  }
  renderer.dispose();
}

function createBabylonNormalPass(
  input: StudioBg3dBabylonNormalCaptureInput,
): StudioBg3dBabylonNormalPass {
  assertBackend(input.scene, input.backend);
  if (input.scene.geometryBufferRenderer || !input.scene.activeCamera) {
    throw normalCaptureError("unsupported");
  }
  const engine = input.scene.getEngine();
  const capabilities = engine.getCaps();
  if (
    !capabilities.drawBuffersExtension ||
    (capabilities.maxDrawBuffers ?? 0) < 2 ||
    Math.max(input.width, input.height) > capabilities.maxRenderTextureSize
  ) {
    throw normalCaptureError("unsupported");
  }

  // Keep this checkpoint's attachment/readback contract exact: Babylon must render RGBA32F and
  // return a Float32Array. A HALF_FLOAT attachment can expose backend-specific Uint16 readback,
  // which would require an independently tested IEEE-754 half decoder before it is safe to admit.
  if (!capabilities.textureFloat || !capabilities.textureFloatRender) {
    throw normalCaptureError("unsupported");
  }
  const textureType = Constants.TEXTURETYPE_FLOAT;

  let renderer: GeometryBufferRenderer | null = null;
  try {
    const attachment = Object.freeze({
      samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      textureFormat: Constants.TEXTUREFORMAT_RGBA,
      textureType,
    });
    renderer = new GeometryBufferRenderer(
      input.scene,
      { width: input.width, height: input.height },
      Constants.TEXTUREFORMAT_DEPTH16,
      {
        [GeometryBufferRenderer.DEPTH_TEXTURE_TYPE]: attachment,
        [GeometryBufferRenderer.NORMAL_TEXTURE_TYPE]: attachment,
      },
    );
    if (!renderer.isSupported) throw normalCaptureError("unsupported");
    input.scene.geometryBufferRenderer = renderer;
    if (input.scene.geometryBufferRenderer !== renderer) {
      throw normalCaptureError("unsupported");
    }

    renderer.generateNormalsInWorldSpace = false;
    renderer.renderTransparentMeshes = true;
    renderer.renderList = [...input.meshes];
    renderer.samples = 1;
    if (
      !renderer.enableDepth ||
      !renderer.enableNormal ||
      renderer.normalsAreUnsigned
    ) {
      throw normalCaptureError("unsupported");
    }

    let disposed = false;
    const ownedRenderer = renderer;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        disposeTemporaryRenderer(input.scene, ownedRenderer);
      },
      renderAndRead: async (signal) => {
        throwIfAborted(signal);
        await withAbort(input.scene.whenReadyAsync(true), signal);
        throwIfAborted(signal);

        const gBuffer = ownedRenderer.getGBuffer();
        const bufferSize = gBuffer.getSize();
        await waitForNormalPassReadiness(ownedRenderer, signal);
        throwIfAborted(signal);
        if (
          !ownedRenderer.isSupported ||
          bufferSize.width !== input.width ||
          bufferSize.height !== input.height
        ) {
          throw normalCaptureError("unsupported");
        }

        gBuffer.render(false, false);
        throwIfAborted(signal);
        const normalIndex = ownedRenderer.getTextureIndex(
          GeometryBufferRenderer.NORMAL_TEXTURE_TYPE,
        );
        const normalTexture = gBuffer.textures[normalIndex];
        if (
          normalIndex < 0 ||
          !normalTexture ||
          normalTexture.textureType !== textureType ||
          normalTexture.getSize().width !== input.width ||
          normalTexture.getSize().height !== input.height
        ) {
          throw normalCaptureError("unsupported");
        }
        const operation = normalTexture.readPixels(
          0,
          0,
          null,
          true,
          false,
          0,
          0,
          input.width,
          input.height,
        );
        if (!operation) throw normalCaptureError("readback");
        const data = await withAbort(operation, signal);
        if (
          !(data instanceof Float32Array) ||
          Object.getPrototypeOf(data) !== Float32Array.prototype ||
          data.length !== input.width * input.height * 4
        ) {
          throw normalCaptureError("readback");
        }
        return Object.freeze({
          data,
          unsigned: ownedRenderer.normalsAreUnsigned,
        });
      },
    };
  } catch (error) {
    if (renderer) {
      try {
        disposeTemporaryRenderer(input.scene, renderer);
      } catch {
        // Preserve the setup failure; this path already fails closed and exposes no GPU result.
      }
    }
    throw normalizeFailure(error, input.signal, "unsupported");
  }
}

/**
 * Captures Babylon view-space normals and converts them to the Studio canonical normal profile.
 */
export async function captureStudioBg3dBabylonNormals(
  input: StudioBg3dBabylonNormalCaptureInput,
  dependencies: StudioBg3dBabylonNormalCaptureDependencies = {},
): Promise<Uint8Array> {
  throwIfAborted(input.signal);
  validateInput(input);
  throwIfAborted(input.signal);

  let pass: StudioBg3dBabylonNormalPass;
  try {
    pass = (dependencies.createPass ?? createBabylonNormalPass)(input);
    if (
      !pass ||
      typeof pass.renderAndRead !== "function" ||
      typeof pass.dispose !== "function"
    ) {
      throw normalCaptureError("unsupported");
    }
  } catch (error) {
    throw normalizeFailure(error, input.signal, "unsupported");
  }

  let result: Uint8Array | undefined;
  let failure: StudioBg3dBabylonNormalCaptureError | undefined;
  try {
    try {
      const readback = await withAbort(pass.renderAndRead(input.signal), input.signal);
      throwIfAborted(input.signal);
      if (
        !readback ||
        typeof readback.unsigned !== "boolean" ||
        !(
          readback.data instanceof Uint8Array ||
          readback.data instanceof Float32Array
        ) ||
        Object.getPrototypeOf(readback.data) !== (
          readback.data instanceof Uint8Array
            ? Uint8Array.prototype
            : Float32Array.prototype
        ) ||
        readback.data.length !== input.width * input.height * 4
      ) {
        throw normalCaptureError("readback");
      }
      result = packStudioBg3dBabylonNormals({
        data: readback.data,
        width: input.width,
        height: input.height,
        unsigned: readback.unsigned,
        flipY: input.backend === "webgl2",
        swapRedBlue: false,
        depth: input.depth,
      });
      throwIfAborted(input.signal);
    } catch (error) {
      failure = normalizeFailure(error, input.signal, "readback");
    }
  } finally {
    try {
      pass.dispose();
    } catch (error) {
      failure ??= normalizeFailure(error, input.signal, "readback");
    }
  }
  if (failure) throw failure;
  if (!result) throw normalCaptureError("readback");
  return result;
}
