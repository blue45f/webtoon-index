/**
 * Real-Chromium harness for the Studio BG3D next-generation engine.
 *
 * It exercises the production modules — the capability probe, the engine-selection policy, the
 * WebGPU renderer factory, and the WebGPU capture adapter — against a live GPU, then renders the
 * same deterministic scene through the existing WebGL adapter and compares the two rasters. That
 * comparison is the point: the engine promotion is only real if the line-and-tone pipeline gets
 * the same pixels and the same depth from either backend.
 */

import * as THREE from "three";

import {
  registerStudioBg3dCaptureExcludedObject,
  registerStudioBg3dDepthExcludedObject,
} from "../apps/web/src/domains/creator/bg3d/studio-bg3d-capture-exclusion";
import {
  EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES,
  selectStudioBg3dEngine,
} from "../apps/web/src/domains/creator/bg3d/studio-bg3d-engine-selection";
import { classifyStudioBg3dInAppBrowser } from "../apps/web/src/domains/creator/bg3d/studio-bg3d-inapp-browser";
import { createStudioBg3dKtx2RendererRuntime } from "../apps/web/src/domains/creator/bg3d/studio-bg3d-ktx2-renderer-runtime";
import { createStudioBg3dThreeWebglCaptureAdapter } from "../apps/web/src/domains/creator/bg3d/studio-bg3d-three-webgl-capture";
import {
  createStudioBg3dThreeWebGpuCaptureAdapter,
  createStudioBg3dThreeWebGpuRenderer,
  MToonNodeMaterial,
} from "../apps/web/src/domains/creator/bg3d/studio-bg3d-three-webgpu-entry";
import { probeStudioBg3dWebGpuCapability } from "../apps/web/src/domains/creator/bg3d/studio-bg3d-webgpu-capability";
import {
  loadStudioVrmAsset,
  readStudioVrmMaterialVariant,
  type StudioVrmMaterialVariant,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-asset-runtime";

import type { StudioBg3dCaptureAdapter } from "../apps/web/src/domains/creator/bg3d/studio-bg3d-capture-adapter";

declare global {
  interface Window {
    __studioBg3dWebGpuEngineResult?: unknown;
  }
}

const CAPTURE_WIDTH = 96;
const CAPTURE_HEIGHT = 64;
/** From STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE / _DEPTH_TOLERANCE. */
const CHANNEL_TOLERANCE = 4;
const DEPTH_TOLERANCE = 0.001;

interface RasterComparison {
  readonly maxChannelDelta: number;
  readonly meanChannelDelta: number;
  readonly overToleranceChannels: number;
  readonly comparedChannels: number;
  /** Alpha is the one channel that is always defined, so it is compared on its own. */
  readonly maxAlphaDelta: number;
  /**
   * Straight-alpha RGB is undefined where alpha is zero and numerically unstable where it is
   * nearly zero, so the composited (premultiplied) value is what a reader actually sees.
   */
  readonly maxCompositedDelta: number;
  readonly overToleranceCompositedChannels: number;
  readonly comparedPixels: number;
}

interface DepthComparison {
  readonly maxDepthDelta: number;
  readonly overToleranceSamples: number;
  readonly comparedSamples: number;
  readonly distinctDepthValues: number;
}

/**
 * Each backend gets its own camera on purpose. `WebGPURenderer` rewrites `camera.coordinateSystem`
 * (and therefore the projection matrix) to the WebGPU [0,1] clip convention, while `WebGLRenderer`
 * never resets it — so one camera shared between both would hand the WebGL depth pass a WebGPU
 * projection and produce a `0.5·z+0.5` shifted raster. The editor cannot hit this (switching
 * backends remounts the R3F canvas with a fresh camera), but the harness renders both at once.
 */
function buildCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, CAPTURE_WIDTH / CAPTURE_HEIGHT, 0.1, 20);
  camera.position.set(0, 0.4, 3.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  // Unlit materials on purpose: both backends must agree on colour before lighting models are
  // allowed to explain a difference away.
  const near = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xd0402a }),
  );
  near.position.set(-0.5, 0, 0.4);
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x2a63d0 }),
  );
  far.position.set(0.7, 0.1, -1.6);
  scene.add(near, far);

  // Viewport-only objects must not reach either raster. The gizmo is excluded from the whole
  // capture; the contact shadow is beauty-only and must be absent from depth. Both sit in front of
  // the boxes, so a backend that leaked one would move the depth raster far outside tolerance.
  const gizmo = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
  );
  gizmo.position.set(0, -0.6, 1.6);
  registerStudioBg3dCaptureExcludedObject(gizmo);

  const contactShadow = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x111111 }),
  );
  contactShadow.position.set(0.9, -0.6, 1.6);
  registerStudioBg3dDepthExcludedObject(contactShadow);

  scene.add(gizmo, contactShadow);
  return scene;
}

function compareRasters(
  left: Uint8Array | Uint8ClampedArray,
  right: Uint8Array | Uint8ClampedArray,
): RasterComparison {
  const length = Math.min(left.length, right.length);
  let maxChannelDelta = 0;
  let total = 0;
  let overTolerance = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = Math.abs((left[index] ?? 0) - (right[index] ?? 0));
    total += delta;
    if (delta > maxChannelDelta) maxChannelDelta = delta;
    if (delta > CHANNEL_TOLERANCE) overTolerance += 1;
  }

  let maxAlphaDelta = 0;
  let maxCompositedDelta = 0;
  let overToleranceComposited = 0;
  const pixels = Math.floor(length / 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const leftAlpha = left[offset + 3] ?? 0;
    const rightAlpha = right[offset + 3] ?? 0;
    maxAlphaDelta = Math.max(maxAlphaDelta, Math.abs(leftAlpha - rightAlpha));
    for (let channel = 0; channel < 3; channel += 1) {
      const composited = Math.abs(
        ((left[offset + channel] ?? 0) * leftAlpha - (right[offset + channel] ?? 0) * rightAlpha)
        / 255,
      );
      if (composited > maxCompositedDelta) maxCompositedDelta = composited;
      if (composited > CHANNEL_TOLERANCE) overToleranceComposited += 1;
    }
  }

  return {
    maxChannelDelta,
    meanChannelDelta: length > 0 ? total / length : 0,
    overToleranceChannels: overTolerance,
    comparedChannels: length,
    maxAlphaDelta,
    maxCompositedDelta,
    overToleranceCompositedChannels: overToleranceComposited,
    comparedPixels: pixels,
  };
}

function sampleDepthDeltas(left: Float32Array, right: Float32Array) {
  const rows: Array<{ index: number; webgpu: number; webgl: number; delta: number }> = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    rows.push({ index, webgpu: a, webgl: b, delta: Math.abs(a - b) });
  }
  rows.sort((first, second) => second.delta - first.delta);
  return rows.slice(0, 6);
}

function compareDepth(left: Float32Array, right: Float32Array): DepthComparison {
  const length = Math.min(left.length, right.length);
  let maxDepthDelta = 0;
  let overTolerance = 0;
  const distinct = new Set<number>();
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    distinct.add(Math.round(a * 1000));
    const delta = Math.abs(a - b);
    if (delta > maxDepthDelta) maxDepthDelta = delta;
    if (delta > DEPTH_TOLERANCE) overTolerance += 1;
  }
  return {
    maxDepthDelta,
    overToleranceSamples: overTolerance,
    comparedSamples: length,
    distinctDepthValues: distinct.size,
  };
}

function summarizeRaster(rgba: Uint8Array | Uint8ClampedArray) {
  let nonZeroAlpha = 0;
  let maxRed = 0;
  let maxBlue = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) > 0) nonZeroAlpha += 1;
    maxRed = Math.max(maxRed, rgba[index] ?? 0);
    maxBlue = Math.max(maxBlue, rgba[index + 2] ?? 0);
  }
  return { nonZeroAlpha, maxRed, maxBlue, byteLength: rgba.length };
}

function applyRenderContract(renderer: {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: string;
}): void {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

async function captureWith(
  adapter: StudioBg3dCaptureAdapter,
  alpha: number,
): Promise<{ rgba: Uint8Array | Uint8ClampedArray; depth: Float32Array }> {
  const raster = await adapter.capture({
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    background: { color: "#ffffff", alpha },
    includeDepth: true,
  });
  if (!raster.depth) throw new Error("capture adapter returned no depth for includeDepth");
  return { rgba: raster.rgba, depth: raster.depth };
}

/** Engine-selection evidence for the hosts Korean traffic actually arrives through. */
function selectionMatrix(probe: Awaited<ReturnType<typeof probeStudioBg3dWebGpuCapability>>) {
  const hosts = [
    ["desktop-chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"],
    ["kakaotalk", "Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.6.5"],
    ["naver-app", "Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.9.6)"],
    ["instagram", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0"],
    ["ios-webview", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"],
  ] as const;
  return hosts.map(([id, userAgent]) => {
    const inApp = classifyStudioBg3dInAppBrowser({ userAgent });
    const request = {
      probe,
      inApp,
      deviceProfile: id === "desktop-chrome" ? ("desktop" as const) : ("mobile" as const),
      webgpuRuntimeAvailable: true,
    };
    // 두 열은 제품이 실제로 제공하는 두 가지 명시 선택이다. 예전에는 한쪽이 preference:"auto"
    // 였는데, 그 값은 더 이상 존재하지 않고 normalizeStudioBg3dEnginePreference 가 조용히
    // "webgpu" 로 옮긴다 — 같은 계획을 두 번 계산해 두 열이 항상 일치했고, 매트릭스는 아무것도
    // 비교하지 않았다.
    const webgpuPlan = selectStudioBg3dEngine({ ...request, preference: "webgpu" });
    const webgl2Plan = selectStudioBg3dEngine({ ...request, preference: "webgl2" });
    return {
      id,
      hostId: inApp.id,
      gpuTrust: inApp.gpuTrust,
      // status 와 diagnostics 를 반드시 함께 낸다. 이 정책은 거절을 backend 교체가 아니라
      // status 로 표현하므로, backend 만 실으면 "거절됨"과 "허용됨"이 같은 JSON 이 된다.
      webgpuBackend: webgpuPlan.backend,
      webgpuStatus: webgpuPlan.status,
      webgpuReason: webgpuPlan.reason,
      webgpuDiagnostics: [...webgpuPlan.diagnostics],
      webgl2Backend: webgl2Plan.backend,
      webgl2Status: webgl2Plan.status,
      webgl2Reason: webgl2Plan.reason,
      notice: webgpuPlan.notice,
    };
  });
}

/**
 * The KTX2 transcoder guard was widened to admit a WebGPU renderer, which only means something if
 * a real `WebGPURenderer` can actually answer the feature queries the loader makes. A stub cannot
 * prove that, so the runtime is built against the live renderer here.
 */
async function probeKtx2Runtime(renderer: unknown) {
  try {
    const runtime = await createStudioBg3dKtx2RendererRuntime({
      renderer: renderer as Parameters<typeof createStudioBg3dKtx2RendererRuntime>[0]["renderer"],
    });
    const result = {
      ok: true as const,
      transcoderId: runtime.transcoderId,
      workerLimit: runtime.workerLimit,
      decodeFailure: runtime.hasDecodeFailure(),
    };
    runtime.dispose();
    return result;
  } catch (error) {
    return {
      ok: false as const,
      code: (error as { code?: string } | null)?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** WebGL-only features must pin the baseline even against an explicit WebGPU request. */
function webglOnlyFeatureMatrix(probe: Awaited<ReturnType<typeof probeStudioBg3dWebGpuCapability>>) {
  const inApp = classifyStudioBg3dInAppBrowser({ userAgent: navigator.userAgent });
  return (["webxr", "vrmCharacters"] as const).map((feature) => {
    const request = {
      probe,
      inApp,
      deviceProfile: "desktop" as const,
      webgpuRuntimeAvailable: true,
      webglOnlyFeatures: { ...EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES, [feature]: true },
    };
    const forced = selectStudioBg3dEngine({ ...request, preference: "webgpu" });
    // 의미 있는 대조는 "자동으로 무엇을 골랐나"가 아니라 "안내문이 말하는 탈출구가 실제로
    // 열려 있나"다 — WebGL-only 기능이 걸린 상태에서도 명시적 WebGL2 는 available 이어야 한다.
    const webgl2Plan = selectStudioBg3dEngine({ ...request, preference: "webgl2" });
    return {
      feature,
      webgpuBackend: forced.backend,
      webgpuStatus: forced.status,
      webgpuReason: forced.reason,
      webgpuDiagnostics: [...forced.diagnostics],
      webgl2Backend: webgl2Plan.backend,
      webgl2Status: webgl2Plan.status,
      webgl2Reason: webgl2Plan.reason,
    };
  });
}

/** A bundled VRM0 model with MToon materials — the case the engine policy used to refuse. */
const VRM_PROBE_URL = "/vrm/AliciaSolid.vrm";

/** Only the primary run loads a character; the in-app replays exist to classify a user agent. */
function probeVrmRequested(): boolean {
  return new URLSearchParams(window.location.search).get("vrm") === "1";
}

/**
 * Loads a real VRM under one renderer and proves the character actually reaches the raster.
 *
 * MToon ships one `ShaderMaterial` for WebGL and one TSL node material for WebGPU, and picking the
 * wrong one does not throw — Three simply never builds the shader and the character is missing
 * from a frame that otherwise renders fine. So this reports both halves: the material brands the
 * loader produced, and how much of the capture the character actually covers.
 *
 * The raster is returned as well, because coverage answers "is the character there" and nothing
 * more. These are two independent upstream implementations of one spec, and the product now runs
 * them side by side — the poser still owns a `WebGLRenderer` while the BG3D stage may be WebGPU —
 * so an artist can grade a character under one shading path and deliver it through the other.
 * Whether the two agree on colour is only knowable by comparing the pixels.
 */
async function probeVrmMToon(
  variant: StudioVrmMaterialVariant,
  buildAdapter: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => StudioBg3dCaptureAdapter,
) {
  let objectUrl: string | null = null;
  try {
    // Fetched to a blob URL first, which is exactly how an uploaded character reaches the loader.
    // The published-URL path adds a `HEAD` preflight whose only job is a friendlier message for a
    // missing file; Chromium reports that HEAD as ERR_ABORTED against the dev server even though
    // it succeeds, and this run treats any request failure as a defect.
    const response = await fetch(VRM_PROBE_URL);
    if (!response.ok) throw new Error(`VRM fixture ${VRM_PROBE_URL} responded ${response.status}`);
    objectUrl = URL.createObjectURL(await response.blob());
    const vrm = await loadStudioVrmAsset(objectUrl, {
      mtoonMaterialType:
        variant === "webgpu-node"
          ? (MToonNodeMaterial as unknown as typeof THREE.Material)
          : undefined,
    });
    const brands = { mtoonShader: 0, mtoonNode: 0, other: 0 };
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const brand = material as { isMToonMaterial?: boolean; isMToonNodeMaterial?: boolean };
        if (brand?.isMToonNodeMaterial === true) brands.mtoonNode += 1;
        else if (brand?.isMToonMaterial === true) brands.mtoonShader += 1;
        else brands.other += 1;
      }
    });

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    scene.add(vrm.scene);
    // Frame the head and torso: an empty crop would report "rendered" for a missing character.
    const camera = new THREE.PerspectiveCamera(30, CAPTURE_WIDTH / CAPTURE_HEIGHT, 0.1, 20);
    camera.position.set(0, 1.25, 1.5);
    camera.lookAt(0, 1.25, 0);
    camera.updateMatrixWorld(true);

    const raster = await buildAdapter(scene, camera).capture({
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      background: { color: "#ffffff", alpha: 0 },
      includeDepth: false,
    });
    // Straight alpha: a covered pixel is one the character wrote, not the cleared background.
    const summary = summarizeRaster(raster.rgba);
    return {
      ok: true as const,
      variant,
      brands,
      coveredPixels: summary.nonZeroAlpha,
      capturedPixels: CAPTURE_WIDTH * CAPTURE_HEIGHT,
      recordedVariant: readStudioVrmMaterialVariant(vrm),
      // Kept in-page only. The caller compares the pair and reports the deltas; the bytes
      // themselves would not survive the JSON hand-off to the harness.
      rgba: raster.rgba,
    };
  } catch (error) {
    return {
      ok: false as const,
      variant,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Runs both MToon implementations and compares what they actually drew.
 *
 * The raw RGBA bytes never leave this function: they are stripped from the reported shape so the
 * result stays a small JSON document, and the harness gates on the deltas instead.
 *
 * Straight-alpha RGB is undefined where alpha is zero, so — exactly as the unlit scene comparison
 * does — the composited delta is the one that describes what a reader sees.
 */
async function compareVrmMToon(
  runWebgpu: () => Promise<Awaited<ReturnType<typeof probeVrmMToon>>>,
  runWebgl: () => Promise<Awaited<ReturnType<typeof probeVrmMToon>>>,
) {
  if (!probeVrmRequested()) return { skipped: true as const };
  const webgpu = await runWebgpu();
  const webgl = await runWebgl();
  const strip = (result: Awaited<ReturnType<typeof probeVrmMToon>>) => {
    if (!result.ok) return result;
    const { rgba: _rgba, ...rest } = result;
    return rest;
  };
  return {
    webgpu: strip(webgpu),
    webgl: strip(webgl),
    // Null rather than a zeroed comparison when either side failed: a load failure is already
    // reported above, and a fabricated "identical" row would read as a pass.
    raster: webgpu.ok && webgl.ok ? compareRasters(webgpu.rgba, webgl.rgba) : null,
  };
}

/** Consecutive same-size captures, to separate one-time pipeline cost from per-capture cost. */
async function measureCaptureCost(adapter: StudioBg3dCaptureAdapter, runs: number) {
  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await adapter.capture({
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      background: { color: "#ffffff", alpha: 0 },
      includeDepth: false,
    });
    timings.push(Number((performance.now() - started).toFixed(2)));
  }
  const rest = [...timings.slice(1)].sort((left, right) => left - right);
  return {
    backend: adapter.backend,
    timings,
    first: timings[0] ?? 0,
    medianAfterFirst: rest.length > 0 ? (rest[Math.floor(rest.length / 2)] ?? 0) : 0,
  };
}

async function run(): Promise<unknown> {
  const probe = await probeStudioBg3dWebGpuCapability({
    secureContext: window.isSecureContext,
    gpu: (navigator as Navigator & { gpu?: Parameters<typeof probeStudioBg3dWebGpuCapability>[0]["gpu"] }).gpu,
  });
  if (!probe.supported) {
    return { status: "unsupported", reason: probe.reason, probe };
  }

  const webgpuCanvas = document.createElement("canvas");
  webgpuCanvas.width = CAPTURE_WIDTH;
  webgpuCanvas.height = CAPTURE_HEIGHT;
  document.body.append(webgpuCanvas);

  const deviceLosses: string[] = [];
  const runtime = await createStudioBg3dThreeWebGpuRenderer(webgpuCanvas, {
    antialias: false,
    alpha: true,
    onDeviceLost: (loss) => deviceLosses.push(`${loss.reason}: ${loss.message}`),
  });
  const webgpuRenderer = runtime.renderer;
  applyRenderContract(webgpuRenderer as unknown as Parameters<typeof applyRenderContract>[0]);
  webgpuRenderer.setSize(CAPTURE_WIDTH, CAPTURE_HEIGHT, false);

  const webglCanvas = document.createElement("canvas");
  webglCanvas.width = CAPTURE_WIDTH;
  webglCanvas.height = CAPTURE_HEIGHT;
  document.body.append(webglCanvas);
  const webglRenderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: false,
    alpha: true,
  });
  applyRenderContract(webglRenderer);
  webglRenderer.setSize(CAPTURE_WIDTH, CAPTURE_HEIGHT, false);

  const scene = buildScene();
  const webgpuAdapter = createStudioBg3dThreeWebGpuCaptureAdapter({
    renderer: webgpuRenderer,
    scene,
    camera: buildCamera(),
  });
  const webglAdapter = createStudioBg3dThreeWebglCaptureAdapter({
    renderer: webglRenderer,
    scene,
    camera: buildCamera(),
  });

  const opaqueWebgpu = await captureWith(webgpuAdapter, 1);
  const opaqueWebgl = await captureWith(webglAdapter, 1);
  const transparentWebgpu = await captureWith(webgpuAdapter, 0);
  const transparentWebgl = await captureWith(webglAdapter, 0);

  // Every capture builds a fresh straight-alpha quad and two targets, and on WebGPU a new node
  // material means a shader build plus a render pipeline. That looked like a reason to cache
  // per-size targets for a shot batch — so measure before caching on a guess.
  //
  // Reported, deliberately not asserted: a wall-clock threshold in CI buys flakes, not signal.
  // What matters is the *shape* — `first` well above `medianAfterFirst` means the pipeline cost is
  // paid once and Three/Dawn is caching by graph structure, so per-capture allocation is free and
  // a cache would be complexity for nothing. The two converging is the signal to revisit.
  const captureCost = {
    webgpu: await measureCaptureCost(webgpuAdapter, 6),
    webgl: await measureCaptureCost(webglAdapter, 6),
  };

  const result = {
    status: "ok",
    captureCost,
    backend: "real-chromium-three-webgpu",
    probe,
    adapters: {
      webgpu: {
        backend: webgpuAdapter.backend,
        graphicsApi: webgpuAdapter.graphicsApi,
        profileId: webgpuAdapter.profileId,
        implementationRevision: webgpuAdapter.implementationRevision,
        engineVersion: webgpuAdapter.engineVersion,
        sourceSize: webgpuAdapter.getSourceSize(),
      },
      webgl: {
        backend: webglAdapter.backend,
        graphicsApi: webglAdapter.graphicsApi,
        profileId: webglAdapter.profileId,
      },
    },
    opaque: {
      webgpu: summarizeRaster(opaqueWebgpu.rgba),
      webgl: summarizeRaster(opaqueWebgl.rgba),
      raster: compareRasters(opaqueWebgpu.rgba, opaqueWebgl.rgba),
      depth: compareDepth(opaqueWebgpu.depth, opaqueWebgl.depth),
      worstDepthSamples: sampleDepthDeltas(opaqueWebgpu.depth, opaqueWebgl.depth),
    },
    transparent: {
      webgpu: summarizeRaster(transparentWebgpu.rgba),
      webgl: summarizeRaster(transparentWebgl.rgba),
      raster: compareRasters(transparentWebgpu.rgba, transparentWebgl.rgba),
      depth: compareDepth(transparentWebgpu.depth, transparentWebgl.depth),
      worstDepthSamples: sampleDepthDeltas(transparentWebgpu.depth, transparentWebgl.depth),
    },
    selection: selectionMatrix(probe),
    webglOnlyFeatures: webglOnlyFeatureMatrix(probe),
    ktx2: {
      webgpu: await probeKtx2Runtime(webgpuRenderer),
      webgl: await probeKtx2Runtime(webglRenderer),
    },
    vrmMToon: await compareVrmMToon(
      () => probeVrmMToon("webgpu-node", (vrmScene, vrmCamera) =>
        createStudioBg3dThreeWebGpuCaptureAdapter({
          renderer: webgpuRenderer,
          scene: vrmScene,
          camera: vrmCamera,
        })),
      () => probeVrmMToon("webgl-shader", (vrmScene, vrmCamera) =>
        createStudioBg3dThreeWebglCaptureAdapter({
          renderer: webglRenderer,
          scene: vrmScene,
          camera: vrmCamera,
        })),
    ),
    liveUserAgent: {
      userAgent: navigator.userAgent,
      classified: classifyStudioBg3dInAppBrowser({ userAgent: navigator.userAgent }),
    },
    deviceLosses,
  };

  webglRenderer.dispose();
  await runtime.dispose();
  return result;
}

run().then(
  (value) => {
    window.__studioBg3dWebGpuEngineResult = value;
  },
  (error: unknown) => {
    window.__studioBg3dWebGpuEngineResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null,
    };
  },
);
