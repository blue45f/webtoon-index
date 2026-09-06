/**
 * Babylon-owned exact stable-ID pass for the renderer-neutral BG3D artifact pipeline.
 *
 * The GPU attachment is unsigned-byte linear RGBA. Zero is cleared as transparent black and each
 * renderable is drawn with an exact, opaque low-byte-first palette color. The public result is a
 * canonical top-down Uint32 ID plane plus its deterministic renderer-neutral legend.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Meshes/buffer";
import "@babylonjs/core/Shaders/picking.vertex";
import "@babylonjs/core/ShadersWGSL/picking.vertex";

import {
  createStudioBg3dStableIdPackingPlan,
  decodeStudioBg3dStableIdReadback,
  encodeStudioBg3dStableIdRgba,
  type StudioBg3dStableIdDescriptor,
  type StudioBg3dStableIdPackingPlan,
} from "./studio-bg3d-babylon-stable-id-packing";

import type { StudioBg3dStableIdLegendEntry } from "./studio-bg3d-artifact-capture-v2";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export const STUDIO_BG3D_BABYLON_STABLE_ID_CAPTURE_MAX_PIXELS = 16_777_216;
const STABLE_ID_READY_TIMEOUT_MS = 10_000;
const STABLE_ID_READY_POLL_MS = 8;

const GLSL_VERTEX_SOURCE = `
attribute vec3 position;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform mat4 viewProjection;
void main(void) {
  vec3 positionUpdated = position;
  #include<morphTargetsVertexGlobal>
  #include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
  #include<instancesVertex>
  #include<bonesVertex>
  #include<bakedVertexAnimation>
  gl_Position = viewProjection * finalWorld * vec4(positionUpdated, 1.0);
}
`;

const GLSL_FRAGMENT_SOURCE = `
precision highp float;
uniform vec4 idColor;
void main(void) {
  gl_FragColor = idColor;
}
`;

const WGSL_VERTEX_SOURCE = `
attribute position: vec3f;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var positionUpdated: vec3f = vertexInputs.position;
  #include<morphTargetsVertexGlobal>
  #include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
  #include<instancesVertex>
  #include<bonesVertex>
  #include<bakedVertexAnimation>
  vertexOutputs.position =
    uniforms.viewProjection * finalWorld * vec4f(positionUpdated, 1.0);
}
`;

const WGSL_FRAGMENT_SOURCE = `
uniform idColor: vec4f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = uniforms.idColor;
}
`;

export type StudioBg3dBabylonStableIdCaptureBackend = "webgl2" | "webgpu";

export type StudioBg3dBabylonStableIdCaptureErrorCode =
  | "aborted"
  | "readback"
  | "unsupported";

export class StudioBg3dBabylonStableIdCaptureError extends Error {
  constructor(
    readonly code: StudioBg3dBabylonStableIdCaptureErrorCode,
    cause?: unknown,
  ) {
    super(
      `Studio Babylon stable-ID capture failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dBabylonStableIdCaptureError";
  }
}

export interface StudioBg3dBabylonStableIdRenderable {
  readonly descriptor: StudioBg3dStableIdDescriptor;
  readonly mesh: AbstractMesh;
}

export interface StudioBg3dBabylonStableIdCaptureInput {
  readonly backend: StudioBg3dBabylonStableIdCaptureBackend;
  readonly height: number;
  readonly renderables: readonly StudioBg3dBabylonStableIdRenderable[];
  readonly scene: Scene;
  readonly signal: AbortSignal;
  readonly width: number;
}

export interface StudioBg3dBabylonStableIdCaptureResult {
  readonly data: Uint32Array;
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
}

/**
 * Narrow seam used by focused tests. Product calls should use the default dependency so bytes
 * always originate from Babylon's dedicated exact RGBA8 render target.
 */
export interface StudioBg3dBabylonStableIdPass {
  readonly dispose: () => void;
  readonly renderAndRead: (signal: AbortSignal) => Promise<Uint8Array>;
}

export interface StudioBg3dBabylonStableIdCaptureDependencies {
  readonly createPass?: (
    input: StudioBg3dBabylonStableIdCaptureInput,
    plan: StudioBg3dStableIdPackingPlan,
  ) => StudioBg3dBabylonStableIdPass;
}

function captureError(
  code: StudioBg3dBabylonStableIdCaptureErrorCode,
  cause?: unknown,
): StudioBg3dBabylonStableIdCaptureError {
  return new StudioBg3dBabylonStableIdCaptureError(code, cause);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw captureError("aborted");
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
    const onAbort = () => finish(() => reject(captureError("aborted")));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function normalizeFailure(
  error: unknown,
  signal: AbortSignal,
  fallback: Exclude<StudioBg3dBabylonStableIdCaptureErrorCode, "aborted">,
): StudioBg3dBabylonStableIdCaptureError {
  if (error instanceof StudioBg3dBabylonStableIdCaptureError) return error;
  if (signal.aborted) return captureError("aborted", error);
  return captureError(fallback, error);
}

/**
 * Accepts Babylon's caller-owned readback contract.
 *
 * WebGL returns the tight destination view itself. WebGPU returns a zero-offset, tight-length
 * prefix view over the caller-owned padded allocation after Babylon compacts the GPU rows.
 *
 * @internal
 */
export function validateStudioBg3dBabylonStableIdReadback(
  readback: unknown,
  readDestination: Uint8Array,
  destination: Uint8Array,
): Uint8Array {
  if (
    !(readback instanceof Uint8Array) ||
    Object.getPrototypeOf(readback) !== Uint8Array.prototype ||
    readback.buffer !== readDestination.buffer ||
    readback.byteOffset !== readDestination.byteOffset ||
    readback.byteLength !== destination.byteLength
  ) {
    throw captureError("readback");
  }
  if (readback !== destination) destination.set(readback);
  return destination;
}

/**
 * Returns the exact caller allocation Babylon WebGPU needs before it compacts 256-byte GPU rows.
 *
 * @internal
 */
export function getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
  width: number,
  height: number,
  backend: StudioBg3dBabylonStableIdCaptureBackend,
): number {
  const rowBytes = width * 4;
  const allocationRowBytes = backend === "webgpu"
    ? Math.ceil(rowBytes / 256) * 256
    : rowBytes;
  return allocationRowBytes * height;
}

function isPlainRenderable(
  value: unknown,
): value is StudioBg3dBabylonStableIdRenderable {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("descriptor") ||
    !keys.includes("mesh")
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const mesh = record.mesh as {
    readonly getScene?: unknown;
    readonly isDisposed?: unknown;
  };
  return (
    typeof mesh === "object" &&
    mesh !== null &&
    typeof mesh.getScene === "function" &&
    typeof mesh.isDisposed === "function"
  );
}

function validateInput(input: StudioBg3dBabylonStableIdCaptureInput): number {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw captureError("readback");
  }
  const pixels = input.width * input.height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_BG3D_BABYLON_STABLE_ID_CAPTURE_MAX_PIXELS
  ) {
    throw captureError("unsupported");
  }
  if (
    (input.backend !== "webgl2" && input.backend !== "webgpu") ||
    !Array.isArray(input.renderables) ||
    Object.getPrototypeOf(input.renderables) !== Array.prototype ||
    typeof input.scene !== "object" ||
    input.scene === null ||
    typeof input.signal !== "object" ||
    input.signal === null
  ) {
    throw captureError("readback");
  }
  for (const renderable of input.renderables) {
    if (
      !isPlainRenderable(renderable) ||
      renderable.mesh.getScene() !== input.scene ||
      renderable.mesh.isDisposed()
    ) {
      throw captureError("readback");
    }
  }
  return pixels;
}

function createPackingPlan(
  renderables: readonly StudioBg3dBabylonStableIdRenderable[],
  signal: AbortSignal,
): StudioBg3dStableIdPackingPlan {
  const descriptorByStableId = new Map<string, StudioBg3dStableIdDescriptor>();
  const stableIdByMesh = new Map<AbstractMesh, string>();
  for (const renderable of renderables) {
    throwIfAborted(signal);
    const previousDescriptor = descriptorByStableId.get(
      renderable.descriptor.stableId,
    );
    if (
      previousDescriptor &&
      previousDescriptor.label !== renderable.descriptor.label
    ) {
      throw captureError("unsupported");
    }
    descriptorByStableId.set(
      renderable.descriptor.stableId,
      renderable.descriptor,
    );
    const previousStableId = stableIdByMesh.get(renderable.mesh);
    if (
      previousStableId !== undefined &&
      previousStableId !== renderable.descriptor.stableId
    ) {
      throw captureError("unsupported");
    }
    stableIdByMesh.set(renderable.mesh, renderable.descriptor.stableId);
  }
  try {
    return createStudioBg3dStableIdPackingPlan([
      ...descriptorByStableId.values(),
    ]);
  } catch (error) {
    throw normalizeFailure(error, signal, "unsupported");
  }
}

function assertBackend(
  scene: Scene,
  backend: StudioBg3dBabylonStableIdCaptureBackend,
): void {
  const engine = scene.getEngine() as ReturnType<Scene["getEngine"]> & {
    readonly isWebGPU?: unknown;
    readonly webGLVersion?: unknown;
  };
  if (
    (backend === "webgl2" &&
      (engine.isWebGPU === true || engine.webGLVersion !== 2)) ||
    (backend === "webgpu" && engine.isWebGPU !== true)
  ) {
    throw captureError("unsupported");
  }
}

function boundedFillMode(mesh: AbstractMesh): number {
  const fillMode = mesh.material?.fillMode;
  return Number.isSafeInteger(fillMode) && fillMode! >= 0 && fillMode! <= 8
    ? fillMode!
    : Material.TriangleFillMode;
}

function materialStyleKey(mesh: AbstractMesh): string {
  const source = mesh.material;
  return [
    boundedFillMode(mesh),
    source?.backFaceCulling === false ? 0 : 1,
    source?.cullBackFaces === false ? 0 : 1,
    source?.sideOrientation ?? Material.CounterClockWiseSideOrientation,
  ].join(":");
}

function createStableIdMaterial(
  scene: Scene,
  stableId: string,
  numericId: number,
  mesh: AbstractMesh,
  shaderLanguage: ShaderLanguage,
): ShaderMaterial {
  const webGpu = shaderLanguage === ShaderLanguage.WGSL;
  const material = new ShaderMaterial(
    `studio-stable-id:${stableId}`,
    scene,
    {
      fragmentSource: webGpu ? WGSL_FRAGMENT_SOURCE : GLSL_FRAGMENT_SOURCE,
      spectorName: "studio-stable-id",
      vertexSource: webGpu ? WGSL_VERTEX_SOURCE : GLSL_VERTEX_SOURCE,
    },
    {
      attributes: [VertexBuffer.PositionKind],
      defines: [],
      needAlphaBlending: false,
      needAlphaTesting: false,
      shaderLanguage,
      uniforms: ["world", "viewProjection", "idColor"],
      useClipPlane: false,
    },
    true,
  );
  const source = mesh.material;
  material.alphaMode = Constants.ALPHA_DISABLE;
  material.backFaceCulling = source?.backFaceCulling ?? true;
  material.cullBackFaces = source?.cullBackFaces ?? true;
  material.fillMode = boundedFillMode(mesh);
  material.sideOrientation =
    source?.sideOrientation ?? Material.CounterClockWiseSideOrientation;
  const [red, green, blue, alpha] = encodeStudioBg3dStableIdRgba(numericId);
  material.setColor4(
    "idColor",
    new Color4(red / 255, green / 255, blue / 255, alpha / 255),
  );
  return material;
}

function disposePassResources(
  target: RenderTargetTexture | null,
  overriddenMeshes: readonly AbstractMesh[],
  materials: readonly ShaderMaterial[],
): void {
  let firstFailure: unknown;
  if (target) {
    for (const mesh of overriddenMeshes) {
      try {
        target.setMaterialForRendering(mesh, undefined);
      } catch (error) {
        firstFailure ??= error;
      }
    }
    try {
      target.renderList = null;
    } catch (error) {
      firstFailure ??= error;
    }
    try {
      target.dispose();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  for (const material of materials) {
    try {
      material.dispose();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
}

async function waitForReadiness(
  target: RenderTargetTexture,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + STABLE_ID_READY_TIMEOUT_MS;
  while (true) {
    throwIfAborted(signal);
    if (target.isReadyForRendering()) return;
    if (Date.now() >= deadline) throw captureError("unsupported");
    await withAbort(
      new Promise<void>((resolve) => {
        setTimeout(resolve, STABLE_ID_READY_POLL_MS);
      }),
      signal,
    );
  }
}

function createBabylonStableIdPass(
  input: StudioBg3dBabylonStableIdCaptureInput,
  plan: StudioBg3dStableIdPackingPlan,
): StudioBg3dBabylonStableIdPass {
  assertBackend(input.scene, input.backend);
  if (!input.scene.activeCamera) throw captureError("unsupported");
  const engine = input.scene.getEngine();
  const capabilities = engine.getCaps();
  if (
    Math.max(input.width, input.height) > capabilities.maxRenderTextureSize
  ) {
    throw captureError("unsupported");
  }

  let target: RenderTargetTexture | null = null;
  const materials: ShaderMaterial[] = [];
  const overriddenMeshes: AbstractMesh[] = [];
  try {
    target = new RenderTargetTexture(
      "studio-stable-id-pass",
      { width: input.width, height: input.height },
      input.scene,
      {
        doNotChangeAspectRatio: true,
        format: Constants.TEXTUREFORMAT_RGBA,
        gammaSpace: false,
        generateDepthBuffer: true,
        generateMipMaps: false,
        generateStencilBuffer: false,
        isCube: false,
        isMulti: false,
        samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
        samples: 1,
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
        useSRGBBuffer: false,
      },
    );
    target.activeCamera = input.scene.activeCamera;
    target.clearColor = new Color4(0, 0, 0, 0);
    target.disableImageProcessing = true;
    target.enableBoundingBoxRendering = false;
    target.enableOutlineRendering = false;
    target.hasAlpha = true;
    target.ignoreCameraViewport = true;
    target.renderParticles = false;
    target.renderSprites = false;
    target.samples = 1;
    target.useCameraPostProcesses = false;
    target.disableRescaling();

    const uniqueRenderables = new Map<
      AbstractMesh,
      StudioBg3dBabylonStableIdRenderable
    >();
    for (const renderable of input.renderables) {
      uniqueRenderables.set(renderable.mesh, renderable);
    }
    target.renderList = [...uniqueRenderables.keys()];

    const shaderLanguage = input.backend === "webgpu"
      ? ShaderLanguage.WGSL
      : ShaderLanguage.GLSL;
    const materialByKey = new Map<string, ShaderMaterial>();
    for (const renderable of uniqueRenderables.values()) {
      const numericId = plan.idByStableId[renderable.descriptor.stableId];
      if (numericId === undefined) throw captureError("unsupported");
      const materialKey =
        `${renderable.descriptor.stableId}:${materialStyleKey(renderable.mesh)}`;
      let material = materialByKey.get(materialKey);
      if (!material) {
        material = createStableIdMaterial(
          input.scene,
          renderable.descriptor.stableId,
          numericId,
          renderable.mesh,
          shaderLanguage,
        );
        materialByKey.set(materialKey, material);
        materials.push(material);
      }
      target.setMaterialForRendering(renderable.mesh, material);
      overriddenMeshes.push(renderable.mesh);
    }

    const size = target.getSize();
    if (
      size.width !== input.width ||
      size.height !== input.height ||
      target.textureFormat !== Constants.TEXTUREFORMAT_RGBA ||
      target.textureType !== Constants.TEXTURETYPE_UNSIGNED_BYTE ||
      target.samples !== 1 ||
      target.renderTargetOptions.generateMipMaps !== false ||
      target.renderTargetOptions.samplingMode !==
        Constants.TEXTURE_NEAREST_SAMPLINGMODE ||
      target.renderTargetOptions.useSRGBBuffer === true
    ) {
      throw captureError("unsupported");
    }

    let disposed = false;
    const ownedTarget = target;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        disposePassResources(ownedTarget, overriddenMeshes, materials);
      },
      renderAndRead: async (signal) => {
        throwIfAborted(signal);
        await waitForReadiness(ownedTarget, signal);
        throwIfAborted(signal);
        ownedTarget.render(false, false);
        throwIfAborted(signal);
        const destination = new Uint8Array(input.width * input.height * 4);
        const readDestination = input.backend === "webgpu"
          ? new Uint8Array(
            getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
              input.width,
              input.height,
              input.backend,
            ),
          )
          : destination;
        const operation = ownedTarget.readPixels(
          0,
          0,
          readDestination,
          true,
          true,
          0,
          0,
          input.width,
          input.height,
        );
        if (!operation) throw captureError("readback");
        const readback = await withAbort(operation, signal);
        validateStudioBg3dBabylonStableIdReadback(
          readback,
          readDestination,
          destination,
        );
        throwIfAborted(signal);
        return destination;
      },
    };
  } catch (error) {
    try {
      disposePassResources(target, overriddenMeshes, materials);
    } catch {
      // Preserve the setup failure while still attempting every cleanup operation.
    }
    throw normalizeFailure(error, input.signal, "unsupported");
  }
}

/**
 * Captures exact Babylon stable IDs and converts them to the Studio canonical stable-ID profile.
 */
export async function captureStudioBg3dBabylonStableIds(
  input: StudioBg3dBabylonStableIdCaptureInput,
  dependencies: StudioBg3dBabylonStableIdCaptureDependencies = {},
): Promise<StudioBg3dBabylonStableIdCaptureResult> {
  throwIfAborted(input.signal);
  validateInput(input);
  const plan = createPackingPlan(input.renderables, input.signal);
  throwIfAborted(input.signal);

  let pass: StudioBg3dBabylonStableIdPass;
  try {
    pass = (dependencies.createPass ?? createBabylonStableIdPass)(input, plan);
    if (
      !pass ||
      typeof pass.renderAndRead !== "function" ||
      typeof pass.dispose !== "function"
    ) {
      throw captureError("unsupported");
    }
  } catch (error) {
    throw normalizeFailure(error, input.signal, "unsupported");
  }

  let result: StudioBg3dBabylonStableIdCaptureResult | undefined;
  let failure: StudioBg3dBabylonStableIdCaptureError | undefined;
  try {
    try {
      const readback = await withAbort(
        pass.renderAndRead(input.signal),
        input.signal,
      );
      throwIfAborted(input.signal);
      const data = decodeStudioBg3dStableIdReadback({
        data: readback,
        width: input.width,
        height: input.height,
        // Babylon render-target readback is bottom-up on both supported engines. Normalize both
        // WebGL2 and WebGPU here so every public stable-ID plane is canonical top-down.
        flipY: true,
        swapRedBlue: false,
        plan,
      });
      throwIfAborted(input.signal);
      result = Object.freeze({ data, legend: plan.legend });
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
  if (!result) throw captureError("readback");
  return result;
}
