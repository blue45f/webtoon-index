/**
 * Browser half of the deterministic Avatar Forge reference-catalogue generator.
 *
 * This harness deliberately mounts the production `StudioVrmAvatarForge` component around the
 * tracked VRM. It does not reproduce the hair/face renderer. The fixed camera, lighting, color,
 * Chromium and SwiftShader contract is owned by the Node generator and copied here verbatim so
 * every raw readback has an auditable authority.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";

import {
  resolveStudioMediaPipeVisionWasmFileset,
} from "../apps/web/src/domains/creator/studio-mediapipe-vision-assets";
import {
  loadStudioMediaPipeVisionModule,
  runStudioMediaPipeVisionTaskCreation,
} from "../apps/web/src/domains/creator/studio-mediapipe-vision-init-arbiter";
import {
  disposeStudioVrmAsset,
  loadStudioVrmAsset,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-asset-runtime.ts";
import {
  createStudioVrmAvatarForgeFaceController,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-avatar-forge-face-controller.ts";
import {
  AVATAR_FORGE_PRESETS,
  createAvatarForgeState,
  type AvatarForgeState,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-avatar-forge.ts";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  type StudioVrmAvatarReferenceEmbedding,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-avatar-reference-recommendation.ts";
import {
  StudioVrmAvatarForge,
} from "../apps/web/src/domains/creator/vrm/StudioVrmAvatarForge.tsx";

import type { ImageEmbedder as MediaPipeImageEmbedder } from "@mediapipe/tasks-vision";
import type { VRM } from "@pixiv/three-vrm";

export const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH = 512 as const;
export const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT = 512 as const;
export const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_MODEL_ROUTE =
  "/__studio_vrm_avatar_reference_model_v1__.tflite" as const;

const CAMERA = Object.freeze({
  position: [0, 1.68, 2.1] as const,
  target: [0, 1.45, 0] as const,
  up: [0, 1, 0] as const,
  fovDegrees: 27,
  near: 0.1,
  far: 20,
});

const LIGHTING = Object.freeze({
  ambient: Object.freeze({ intensity: 0.92, color: "#ffffff" }),
  directional: Object.freeze([
    Object.freeze({ intensity: 1.5, color: "#ffffff", position: [2.8, 4.2, 3.6] as const }),
    Object.freeze({ intensity: 0.72, color: "#ffffff", position: [-3.2, 2.6, 2.1] as const }),
    Object.freeze({ intensity: 0.64, color: "#ffffff", position: [-1.6, 3.4, -3.2] as const }),
  ]),
});

const QUALITY_GATE = Object.freeze({
  id: "avatar-reference-calibration-v1",
  original: Object.freeze({
    requiredTopK: 1,
    strictRunnerUpMargin: true,
  }),
  variants: Object.freeze([
    Object.freeze({
      id: "horizontal-flip",
      requiredTopK: 3,
    }),
    Object.freeze({
      id: "center-scale-90",
      scale: 0.9,
      background: "#f3f0e8",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      requiredTopK: 3,
    }),
  ]),
});

type BrowserRenderResult = Readonly<{
  presetId: string;
  width: number;
  height: number;
  rgbaBase64: string;
  embedding: StudioVrmAvatarReferenceEmbedding;
  calibration: readonly Readonly<{
    id: "horizontal-flip" | "center-scale-90";
    embedding: StudioVrmAvatarReferenceEmbedding;
  }>[];
}>;

type BrowserAuthorityEvidence = Readonly<{
  wasmVariant: "simd" | "nosimd";
  wasmLoaderSha256: string;
  wasmBinarySha256: string;
  webglVersion: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
  contextAttributes: Readonly<{
    alpha: boolean;
    antialias: boolean;
    depth: boolean;
    premultipliedAlpha: boolean;
    preserveDrawingBuffer: boolean;
    stencil: boolean;
  }>;
  qualityGate: typeof QUALITY_GATE;
}>;

type QualityQueryResult = Readonly<{
  queryId: string;
  targetPresetId: string;
  topPresetIds: readonly string[];
  targetRank: number;
  targetSimilarity: number;
  runnerUpSimilarity: number;
}>;

declare global {
  interface Window {
    __studioVrmAvatarReferenceCatalogueReady?: boolean;
    __studioVrmAvatarReferenceCatalogueError?: string;
    __studioVrmAvatarReferenceCatalogueAuthority?: () => Promise<BrowserAuthorityEvidence>;
    __studioVrmAvatarReferenceCatalogueRender?: (
      presetId: string,
    ) => Promise<BrowserRenderResult>;
    __studioVrmAvatarReferenceCatalogueRankQueries?: (
      entries: readonly Readonly<{
        presetId: string;
        embedding: StudioVrmAvatarReferenceEmbedding;
      }>[],
      queries: readonly Readonly<{
        queryId: string;
        targetPresetId: string;
        embedding: StudioVrmAvatarReferenceEmbedding;
      }>[],
    ) => Promise<readonly QualityQueryResult[]>;
    __studioVrmAvatarReferenceCatalogueDispose?: () => Promise<void>;
  }
}

type HarnessRuntime = Readonly<{
  root: Root;
  host: HTMLDivElement;
  vrm: VRM;
  embedder: MediaPipeImageEmbedder;
  cosineSimilarity: typeof import("@mediapipe/tasks-vision").ImageEmbedder.cosineSimilarity;
  wasmVariant: "simd" | "nosimd";
  wasmLoaderSha256: string;
  wasmBinarySha256: string;
}>;

const faceController = createStudioVrmAvatarForgeFaceController();
let renderRevision = 0;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8ClampedArray): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)),
    );
  }
  return btoa(binary);
}

function normalizeEmbedding(value: unknown): StudioVrmAvatarReferenceEmbedding {
  invariant(typeof value === "object" && value !== null, "MediaPipe returned no embedding");
  const candidate = value as {
    readonly headIndex?: unknown;
    readonly headName?: unknown;
    readonly floatEmbedding?: unknown;
  };
  invariant(
    typeof candidate.headIndex === "number"
      && Number.isSafeInteger(candidate.headIndex)
      && candidate.headIndex >= 0,
    "MediaPipe returned an invalid embedding head index",
  );
  invariant(
    typeof candidate.headName === "string",
    "MediaPipe returned an invalid embedding head name",
  );
  const vector = Array.from(candidate.floatEmbedding as ArrayLike<unknown> | undefined ?? []);
  invariant(
    vector.length > 0
      && vector.every((component) => typeof component === "number" && Number.isFinite(component)),
    "MediaPipe returned a missing or non-finite embedding vector",
  );
  return {
    headIndex: candidate.headIndex,
    headName: candidate.headName,
    floatEmbedding: vector as number[],
  };
}

function settleFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

/** Frames that let React effects, the R3F portal and shader compilation start. */
const SETTLE_MIN_FRAMES = 24;
/** Frames between two stability probes. */
const SETTLE_PROBE_FRAMES = 6;
/** Give up rather than publish a frame that never settled. */
const SETTLE_MAX_PROBES = 24;

/**
 * Wait until the canvas stops changing, then let the caller read it back.
 *
 * A fixed 24-frame budget was enough while the reference model carried no textures and a preset
 * only ADDED hair to it. Rendering the preset AS the hair does more work per preset, and 24 frames
 * stopped being enough intermittently: two of the twenty-one renders differed between runs, which
 * made the whole artifact irreproducible and `--check` fail at random. Raising the constant would
 * only move the threshold, so settle on evidence instead — probe the canvas until two reads agree
 * — and throw if it never does, because a frame that never settles must not become a pinned byte.
 */
async function settleUntilStable(host: HTMLElement, label: string): Promise<void> {
  await settleFrames(SETTLE_MIN_FRAMES);
  const probe = document.createElement("canvas");
  probe.width = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH;
  probe.height = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  invariant(probeContext, "settle probe context is unavailable");
  let previous: Uint8ClampedArray | null = null;
  for (let attempt = 0; attempt < SETTLE_MAX_PROBES; attempt += 1) {
    const canvas = host.querySelector("canvas");
    invariant(canvas instanceof HTMLCanvasElement, `${label}: R3F canvas disappeared while settling`);
    probeContext.drawImage(canvas, 0, 0);
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
    if (previous !== null && previous.length === pixels.length) {
      let identical = true;
      for (let index = 0; index < pixels.length; index += 1) {
        if (pixels[index] !== previous[index]) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }
    previous = new Uint8ClampedArray(pixels);
    await settleFrames(SETTLE_PROBE_FRAMES);
  }
  throw new Error(
    `${label}: canvas never produced two identical frames within `
    + `${SETTLE_MIN_FRAMES + SETTLE_MAX_PROBES * SETTLE_PROBE_FRAMES} frames`,
  );
}

function CanonicalActor({ vrm }: { readonly vrm: VRM }) {
  useFrame(() => {
    // Zero-delta update keeps the production normalized humanoid in sync without introducing any
    // time- or frame-rate-dependent animation into the catalogue pixels.
    vrm.update(0);
  }, -1);
  return <primitive object={vrm.scene} />;
}

function CanonicalScene({
  vrm,
  state,
  revision,
}: {
  readonly vrm: VRM;
  readonly state: AvatarForgeState;
  readonly revision: number;
}) {
  return (
    <>
      <ambientLight
        intensity={LIGHTING.ambient.intensity}
        color={LIGHTING.ambient.color}
      />
      {LIGHTING.directional.map((light, index) => (
        <directionalLight
          key={index}
          intensity={light.intensity}
          color={light.color}
          position={[...light.position]}
        />
      ))}
      <CanonicalActor vrm={vrm} />
      <StudioVrmAvatarForge
        vrm={vrm}
        state={state}
        rigRevision={revision}
        faceController={faceController}
      />
    </>
  );
}

function renderHarness(root: Root, vrm: VRM, state: AvatarForgeState, revision: number): void {
  root.render(
    <Canvas
      camera={{
        fov: CAMERA.fovDegrees,
        position: [...CAMERA.position],
        near: CAMERA.near,
        far: CAMERA.far,
      }}
      dpr={1}
      frameloop="always"
      gl={{
        // Product Studio uses an alpha-capable WebGL canvas. The catalogue clears it to alpha=1
        // over the fixed background before readback so every RGBA byte remains deterministic.
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      }}
      onCreated={({ camera, gl }) => {
        camera.up.set(...CAMERA.up);
        camera.position.set(...CAMERA.position);
        camera.lookAt(...CAMERA.target);
        camera.updateMatrixWorld(true);
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
        gl.setClearColor("#f3f0e8", 1);
        gl.setClearAlpha(1);
      }}
    >
      <CanonicalScene vrm={vrm} state={state} revision={revision} />
    </Canvas>,
  );
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  invariant(response.ok, `failed to fetch ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function initialize(): Promise<HarnessRuntime> {
  document.documentElement.lang = "en";
  document.documentElement.style.width = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH}px`;
  document.documentElement.style.height = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT}px`;
  document.documentElement.style.overflow = "hidden";
  document.body.style.margin = "0";
  document.body.style.width = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH}px`;
  document.body.style.height = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT}px`;
  document.body.style.overflow = "hidden";

  const host = document.createElement("div");
  host.id = "studio-vrm-avatar-reference-catalogue-host";
  host.style.width = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH}px`;
  host.style.height = `${STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT}px`;
  document.body.appendChild(host);

  const [{ FilesetResolver, ImageEmbedder }, vrm, modelAssetBuffer] = await Promise.all([
    loadStudioMediaPipeVisionModule(),
    loadStudioVrmAsset("/vrm/TS_Minseo_Campus.vrm"),
    fetchBytes(STUDIO_VRM_AVATAR_REFERENCE_BROWSER_MODEL_ROUTE),
  ]);
  invariant(
    modelAssetBuffer.byteLength === STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
    "served MediaPipe model byte length drifted",
  );
  invariant(
    await sha256Hex(modelAssetBuffer) === STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    "served MediaPipe model hash drifted",
  );
  const wasm = await resolveStudioMediaPipeVisionWasmFileset({
    isSimdSupported: () => FilesetResolver.isSimdSupported(false),
  });
  const [wasmLoaderBytes, wasmBinaryBytes] = await Promise.all([
    fetchBytes(wasm.fileset.wasmLoaderPath),
    fetchBytes(wasm.fileset.wasmBinaryPath),
  ]);
  const embedder = await runStudioMediaPipeVisionTaskCreation({
    owner: "vrm-avatar-reference-image",
    create: () => ImageEmbedder.createFromOptions(wasm.fileset, {
      baseOptions: {
        delegate: "CPU",
        modelAssetBuffer,
      },
      runningMode: "IMAGE",
      l2Normalize: false,
      quantize: false,
    }),
  });
  const root = createRoot(host);
  renderHarness(root, vrm, createAvatarForgeState(AVATAR_FORGE_PRESETS[0]?.id), renderRevision);
  await settleFrames(24);
  invariant(host.querySelector("canvas") instanceof HTMLCanvasElement, "R3F did not mount a canvas");
  return {
    root,
    host,
    vrm,
    embedder,
    cosineSimilarity: ImageEmbedder.cosineSimilarity,
    wasmVariant: wasm.variant,
    wasmLoaderSha256: await sha256Hex(wasmLoaderBytes),
    wasmBinarySha256: await sha256Hex(wasmBinaryBytes),
  };
}

const runtimePromise = initialize();

window.__studioVrmAvatarReferenceCatalogueAuthority = async () => {
  const runtime = await runtimePromise;
  const canvas = runtime.host.querySelector("canvas");
  invariant(canvas instanceof HTMLCanvasElement, "R3F canvas disappeared");
  const gl = canvas.getContext("webgl2");
  invariant(gl, "the locked Chromium did not provide WebGL2");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const attributes = gl.getContextAttributes();
  invariant(attributes, "WebGL context attributes are unavailable");
  return {
    wasmVariant: runtime.wasmVariant,
    wasmLoaderSha256: runtime.wasmLoaderSha256,
    wasmBinarySha256: runtime.wasmBinarySha256,
    webglVersion: String(gl.getParameter(gl.VERSION)),
    unmaskedVendor: debug
      ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR)),
    unmaskedRenderer: debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER)),
    contextAttributes: {
      alpha: attributes.alpha,
      antialias: attributes.antialias,
      depth: attributes.depth,
      premultipliedAlpha: attributes.premultipliedAlpha,
      preserveDrawingBuffer: attributes.preserveDrawingBuffer,
      stencil: attributes.stencil,
    },
    qualityGate: QUALITY_GATE,
  };
};

window.__studioVrmAvatarReferenceCatalogueRender = async (presetId) => {
  const runtime = await runtimePromise;
  invariant(
    AVATAR_FORGE_PRESETS.some((preset) => preset.id === presetId),
    `unknown Avatar Forge preset: ${presetId}`,
  );
  renderRevision += 1;
  // This catalogue exists to give one reference image per hair preset, so the preset has to BE
  // the hair. `replaceOriginal` defaults to false, which layers the preset over whatever the base
  // avatar already wears -- correct in Studio, wrong here, and invisible for as long as the pinned
  // reference model happened to be effectively hairless.
  //
  // The moment it is not, every render shares one large hair mass and the presets stop separating:
  // measured on a reference avatar with real hair, 11 of 42 calibration queries fell out of top-3
  // (ranks 4-16, every one of them the center-scale-90 variant, none the horizontal flip).
  // Rendering the preset as the hair returns all 42. Encoding the assumption here is what keeps
  // the catalogue answering the question it claims to answer, whichever model it renders.
  const presetState = createAvatarForgeState(presetId);
  renderHarness(
    runtime.root,
    runtime.vrm,
    { ...presetState, hair: { ...presetState.hair, replaceOriginal: true } },
    renderRevision,
  );
  // The production component uses layout/effects plus an R3F portal; settle on the canvas itself
  // rather than a frame count, so the one authoritative readback is of a frame that has stopped
  // moving. See settleUntilStable for the irreproducibility a fixed budget produced.
  await settleUntilStable(runtime.host, presetId);
  const source = runtime.host.querySelector("canvas");
  invariant(source instanceof HTMLCanvasElement, "R3F canvas disappeared before readback");
  invariant(
    source.width === STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH
      && source.height === STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT,
    `unexpected drawing buffer ${source.width}x${source.height}`,
  );
  const capture = document.createElement("canvas");
  capture.width = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH;
  capture.height = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT;
  const context = capture.getContext("2d", { willReadFrequently: true });
  invariant(context, "2-D capture context is unavailable");
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(
    0,
    0,
    STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH,
    STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT,
  );
  const result = runtime.embedder.embed(capture);
  const embedding = normalizeEmbedding(result.embeddings[0]);
  const horizontalFlip = document.createElement("canvas");
  horizontalFlip.width = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH;
  horizontalFlip.height = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT;
  const horizontalFlipContext = horizontalFlip.getContext("2d");
  invariant(horizontalFlipContext, "horizontal-flip calibration context is unavailable");
  horizontalFlipContext.translate(STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH, 0);
  horizontalFlipContext.scale(-1, 1);
  horizontalFlipContext.drawImage(capture, 0, 0);
  const horizontalFlipEmbedding = normalizeEmbedding(
    runtime.embedder.embed(horizontalFlip).embeddings[0],
  );

  const centerScale = document.createElement("canvas");
  centerScale.width = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH;
  centerScale.height = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT;
  const centerScaleContext = centerScale.getContext("2d");
  invariant(centerScaleContext, "center-scale calibration context is unavailable");
  centerScaleContext.fillStyle = QUALITY_GATE.variants[1].background;
  centerScaleContext.fillRect(0, 0, centerScale.width, centerScale.height);
  centerScaleContext.imageSmoothingEnabled = QUALITY_GATE.variants[1].imageSmoothingEnabled;
  centerScaleContext.imageSmoothingQuality = QUALITY_GATE.variants[1].imageSmoothingQuality;
  const scaledWidth = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH * QUALITY_GATE.variants[1].scale;
  const scaledHeight = STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT * QUALITY_GATE.variants[1].scale;
  centerScaleContext.drawImage(
    capture,
    (STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH - scaledWidth) / 2,
    (STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT - scaledHeight) / 2,
    scaledWidth,
    scaledHeight,
  );
  const centerScaleEmbedding = normalizeEmbedding(
    runtime.embedder.embed(centerScale).embeddings[0],
  );
  capture.width = 1;
  capture.height = 1;
  horizontalFlip.width = 1;
  horizontalFlip.height = 1;
  centerScale.width = 1;
  centerScale.height = 1;
  return {
    presetId,
    width: imageData.width,
    height: imageData.height,
    // ImageData is defined as top-left row-major, non-premultiplied RGBA8.
    rgbaBase64: toBase64(imageData.data),
    embedding,
    calibration: [
      { id: "horizontal-flip", embedding: horizontalFlipEmbedding },
      { id: "center-scale-90", embedding: centerScaleEmbedding },
    ],
  };
};

window.__studioVrmAvatarReferenceCatalogueRankQueries = async (entries, queries) => {
  const runtime = await runtimePromise;
  return queries.map((query) => {
    const similarities = entries.map((candidate) => ({
      presetId: candidate.presetId,
      similarity: runtime.cosineSimilarity(
        {
          headIndex: query.embedding.headIndex,
          headName: query.embedding.headName,
          floatEmbedding: [...query.embedding.floatEmbedding],
        },
        {
          headIndex: candidate.embedding.headIndex,
          headName: candidate.embedding.headName,
          floatEmbedding: [...candidate.embedding.floatEmbedding],
        },
      ),
    }));
    invariant(
      similarities.every(({ similarity }) => Number.isFinite(similarity)),
      `${query.queryId}: official MediaPipe cosine returned a non-finite value`,
    );
    similarities.sort((left, right) => (
      right.similarity - left.similarity
      || left.presetId.localeCompare(right.presetId, "en")
    ));
    const targetIndex = similarities.findIndex(
      ({ presetId }) => presetId === query.targetPresetId,
    );
    invariant(targetIndex >= 0, `${query.queryId}: target preset is absent from the catalogue`);
    return {
      queryId: query.queryId,
      targetPresetId: query.targetPresetId,
      topPresetIds: similarities.slice(0, 3).map(({ presetId }) => presetId),
      targetRank: targetIndex + 1,
      targetSimilarity: similarities[targetIndex]!.similarity,
      runnerUpSimilarity: similarities.find(
        ({ presetId }) => presetId !== query.targetPresetId,
      )?.similarity ?? Number.NaN,
    };
  });
};

window.__studioVrmAvatarReferenceCatalogueDispose = async () => {
  const runtime = await runtimePromise;
  runtime.root.unmount();
  faceController.dispose();
  runtime.embedder.close();
  disposeStudioVrmAsset(runtime.vrm);
  runtime.host.remove();
};

void runtimePromise.then(
  () => {
    window.__studioVrmAvatarReferenceCatalogueReady = true;
  },
  (error: unknown) => {
    window.__studioVrmAvatarReferenceCatalogueError =
      error instanceof Error ? error.stack ?? error.message : String(error);
  },
);
