import { sha256HexPortable } from "../studio-sha256";

import {
  AVATAR_FORGE_PRESETS,
  createAvatarForgeState,
  parseAvatarForgeState,
  serializeAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  admitStudioVrmAvatarReferenceCatalogue,
  isStudioVrmAvatarReferenceRecommendationReceipt,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceEmbedding,
  type StudioVrmAvatarReferenceRecommendationReceipt,
} from "./studio-vrm-avatar-reference-recommendation";

export const STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL =
  "/catalog/studio-vrm-avatar-reference-catalogue-v1.json" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES = 512 * 1024;
export const STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH = 420_936 as const;
export const STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256 =
  "f482cb50758880260508d074a54060fc3c9f5fe874738c38199a63f4eed8b1f6" as const;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * The ToonSpectrum-owned CC0 VRM the shipped preset render catalogue was built from.
 *
 * This is deliberately an exact content authority rather than a mutable URL. A catalogue build
 * must hash the source bytes before rendering and must use the fixed camera/lighting contract
 * below. `public/vrm/LICENSES.md` documents the original model and its CC0 1.0 grant.
 *
 * The model itself was retired from the bundle on 2026-09-02 together with the rest of the
 * procedural character pack; the committed catalogue artifact remains the runtime authority and
 * nothing at runtime fetches the source bytes. Rebuilding the catalogue needs a new CC0 base
 * that passes the generator's uniqueness and calibration gates — every bundled 100Avatars
 * candidate (CosmicBot, Eugenia, Devil, Bloody, LadyFawn, Robert) failed them.
 */
export const STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY = deepFreeze({
  sourceAssetId: "toonspectrum-minseo-campus",
  sourceUrl: "/vrm/TS_Minseo_Campus.vrm",
  sourceByteLength: 1_325_288,
  sourceSha256: "903601a5ffa71383188a3885509653283fb842e9a3f0025dca222b1c9b78ebea",
  rendererId: "toonspectrum-avatar-forge-front",
  rendererRevision: "2",
  rendererModuleSha256: "12e7dd19fdf4d2372b5f0ac345cc4371f75d7154f01a6480bb46d3f08b21c672",
  avatarForgeStateModuleSha256: "c2b747da77a3fa2ace3635462dabc2a62cead54b74d5988a4baa02f8c3fb91cd",
  width: 512,
  height: 512,
  pixelFormat: "rgba8-unorm-top-left-row-major",
  camera: {
    id: "studio-bust-v1",
    projection: "perspective",
    fovDegrees: 27,
    position: [0, 1.68, 2.1],
    target: [0, 1.45, 0],
    up: [0, 1, 0],
    near: 0.1,
    far: 20,
  },
  lighting: {
    id: "studio-neutral-three-point-v1",
    ambient: { intensity: 0.92, color: "#ffffff" },
    directional: [
      { intensity: 1.5, color: "#ffffff", position: [2.8, 4.2, 3.6] },
      { intensity: 0.72, color: "#ffffff", position: [-3.2, 2.6, 2.1] },
      { intensity: 0.64, color: "#ffffff", position: [-1.6, 3.4, -3.2] },
    ],
  },
  color: {
    outputColorSpace: "srgb",
    toneMapping: "aces-filmic",
    exposure: 1,
    clearColor: "#f3f0e8",
    alpha: true,
  },
  packages: {
    three: "0.184.0",
    threeVrm: "3.5.3",
    reactThreeFiber: "9.6.1",
    mediaPipeTasksVision: "0.10.35",
    playwright: "1.62.1",
  },
  browser: {
    family: "chromium",
    version: "151.0.7922.34",
    revision: "1234",
    executableSha256: "a596b1cfc6353e987fcec8d71a23a28cd6a9e7a6b4e20b908e4c4fcffe51158e",
    headless: true,
  },
  softwareGpu: {
    backend: "swiftshader-angle",
    launchArgs: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    webglVersion: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
    unmaskedVendor: "Google Inc. (Google)",
    unmaskedRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)",
    swiftShaderLibraries: [
      {
        name: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151.0.7922.34/Libraries/libEGL.dylib",
        byteLength: 91_952,
        sha256: "9135359d52b77329675d7820ca55c133d5ee4a6ad31a6f799f61c919c96a00a5",
      },
      {
        name: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151.0.7922.34/Libraries/libGLESv2.dylib",
        byteLength: 6_557_440,
        sha256: "3365ee682659f08dd268be4a9b1f864fc40dbeb1493d4a8addd71979b9a0ad8e",
      },
      {
        name: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151.0.7922.34/Libraries/libvk_swiftshader.dylib",
        byteLength: 16_508_208,
        sha256: "f4813265ff3f4572bbdcf2ed917d4ed8b75df3af7a7deffabf4f925a11482d11",
      },
      {
        name: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151.0.7922.34/Libraries/vk_swiftshader_icd.json",
        byteLength: 110,
        sha256: "d717d915e31e7c27948b80b36ab34e2d897888114c5c7d0af835f93eb53e58f5",
      },
    ],
  },
  mediaPipe: {
    providerId: "google-mediapipe-tasks-vision/image-embedder",
    modelId: "mobilenet-v3-small-float32",
    modelRevision: "1",
    modelUrl: "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
    modelByteLength: 4_117_670,
    modelSha256: "bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40",
    delegate: "CPU",
    runningMode: "IMAGE",
    l2Normalize: false,
    quantize: false,
    wasmVariant: "simd",
    wasmLoaderSha256: "d30d9f253b39c31e6091692c606885c9791531cc1439e86e455c24c467c16265",
    wasmBinarySha256: "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc",
  },
  qualityGate: {
    id: "avatar-reference-calibration-v1",
    original: { requiredTopK: 1, strictRunnerUpMargin: true },
    variants: [
      { id: "horizontal-flip", requiredTopK: 3 },
      {
        id: "center-scale-90",
        scale: 0.9,
        background: "#f3f0e8",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        requiredTopK: 3,
      },
    ],
  },
} as const);

export const STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY = Object.freeze({
  headIndex: 0,
  headName: "feature",
  dimensions: 1_024,
} as const);

export interface StudioVrmAvatarReferenceCanonicalRenderEntry {
  readonly presetId: string;
  readonly presetStateSha256: string;
  readonly referenceImageSha256: string;
  readonly referenceImageByteLength: number;
  readonly embeddingSha256: string;
}

export interface StudioVrmAvatarReferenceCatalogueEnvelope {
  readonly authority: typeof STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY;
  readonly renders: readonly StudioVrmAvatarReferenceCanonicalRenderEntry[];
  readonly catalogue: StudioVrmAvatarReferenceCatalogue;
}

export interface StudioVrmAvatarReferenceProductSelection {
  readonly presetId: string;
  readonly state: AvatarForgeState;
  readonly receipt: StudioVrmAvatarReferenceRecommendationReceipt;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const textEncoder = new TextEncoder();
const PRESET_IDS = Object.freeze(AVATAR_FORGE_PRESETS.map(({ id }) => id).sort());

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const canonicalExpected = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  return exactStringArrayMatch(actual, canonicalExpected);
}

function snapshotsMatch(left: unknown, right: unknown): boolean {
  try {
    const visited = new WeakMap<object, object>();
    const compare = (leftValue: unknown, rightValue: unknown): boolean => {
      if (Object.is(leftValue, rightValue)) return true;
      if (
        typeof leftValue !== "object"
        || leftValue === null
        || typeof rightValue !== "object"
        || rightValue === null
      ) return false;
      if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
        return Array.isArray(leftValue)
          && Array.isArray(rightValue)
          && leftValue.length === rightValue.length
          && leftValue.every((entry, index) => compare(entry, rightValue[index]));
      }
      const paired = visited.get(leftValue);
      if (paired) return paired === rightValue;
      visited.set(leftValue, rightValue);
      const leftKeys = Object.keys(leftValue).sort((a, b) => a.localeCompare(b, "en"));
      const rightKeys = Object.keys(rightValue).sort((a, b) => a.localeCompare(b, "en"));
      return exactStringArrayMatch(leftKeys, rightKeys)
        && leftKeys.every((key) => compare(
          (leftValue as Record<string, unknown>)[key],
          (rightValue as Record<string, unknown>)[key],
        ));
    };
    return compare(left, right);
  } catch {
    return false;
  }
}

function exactStringArrayMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function studioVrmAvatarReferencePresetStateSha256(presetId: string): string | null {
  if (!AVATAR_FORGE_PRESETS.some((preset) => preset.id === presetId)) return null;
  const canonical = serializeAvatarForgeState(createAvatarForgeState(presetId));
  return sha256HexPortable(textEncoder.encode(JSON.stringify(canonical)));
}

/** Hashes the exact JSON embedding representation persisted by the deterministic generator. */
export function studioVrmAvatarReferenceEmbeddingSha256(
  embedding: StudioVrmAvatarReferenceEmbedding,
): string {
  return sha256HexPortable(textEncoder.encode(JSON.stringify({
    headIndex: embedding.headIndex,
    headName: embedding.headName,
    floatEmbedding: embedding.floatEmbedding,
  })));
}

function embeddingsSelfRankFirst(catalogue: StudioVrmAvatarReferenceCatalogue): boolean {
  const norms = catalogue.entries.map(({ embedding }) => Math.sqrt(
    embedding.floatEmbedding.reduce((sum, component) => sum + component * component, 0),
  ));
  if (norms.some((norm) => !Number.isFinite(norm) || norm <= 0)) return false;

  return catalogue.entries.every((query, queryIndex) => {
    let topPresetId = "";
    let topSimilarity = Number.NEGATIVE_INFINITY;
    for (let candidateIndex = 0; candidateIndex < catalogue.entries.length; candidateIndex += 1) {
      const candidate = catalogue.entries[candidateIndex]!;
      const dot = query.embedding.floatEmbedding.reduce(
        (sum, component, componentIndex) =>
          sum + component * candidate.embedding.floatEmbedding[componentIndex]!,
        0,
      );
      const similarity = dot / (norms[queryIndex]! * norms[candidateIndex]!);
      if (!Number.isFinite(similarity)) return false;
      if (
        similarity > topSimilarity
        || (
          similarity === topSimilarity
          && (topPresetId === "" || candidate.presetId.localeCompare(topPresetId, "en") < 0)
        )
      ) {
        topSimilarity = similarity;
        topPresetId = candidate.presetId;
      }
    }
    return topPresetId === query.presetId;
  });
}

/**
 * Admits output from the offline catalogue build lane.
 *
 * The build lane must render every current preset against the exact tracked VRM authority, hash
 * each transient 512x512 render, embed it with the pinned MediaPipe model, and then discard the
 * render pixels. Runtime ships only this bounded envelope. A partial shelf, stale preset state,
 * altered source model, or untraceable render is rejected instead of silently degrading ranking.
 */
export function admitStudioVrmAvatarReferenceCatalogueEnvelope(
  value: unknown,
): StudioVrmAvatarReferenceCatalogueEnvelope | null {
  if (!hasExactKeys(value, ["authority", "renders", "catalogue"])) return null;
  const candidate = value as Partial<StudioVrmAvatarReferenceCatalogueEnvelope>;
  if (!snapshotsMatch(candidate.authority, STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY)) {
    return null;
  }
  if (!Array.isArray(candidate.renders) || candidate.renders.length !== PRESET_IDS.length) {
    return null;
  }
  if (!hasExactKeys(candidate.catalogue, [
    "version",
    "providerId",
    "modelId",
    "modelRevision",
    "modelSha256",
    "catalogueRevision",
    "entries",
  ])) return null;
  if (!Array.isArray(candidate.catalogue.entries) || candidate.catalogue.entries.some((entry) =>
    !hasExactKeys(entry, ["presetId", "embedding"])
    || !hasExactKeys(entry.embedding, ["headIndex", "headName", "floatEmbedding"])
  )) return null;

  let catalogue: StudioVrmAvatarReferenceCatalogue;
  try {
    catalogue = admitStudioVrmAvatarReferenceCatalogue(candidate.catalogue);
  } catch {
    return null;
  }
  const catalogueIds = catalogue.entries.map(({ presetId }) => presetId);
  if (!exactStringArrayMatch(catalogueIds, PRESET_IDS)) return null;

  const renderIds = new Set<string>();
  const imageHashes = new Set<string>();
  const embeddingHashes = new Set<string>();
  const expectedReferenceImageByteLength =
    STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.width
    * STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.height
    * 4;
  const renders: StudioVrmAvatarReferenceCanonicalRenderEntry[] = [];
  for (let index = 0; index < candidate.renders.length; index += 1) {
    const raw = candidate.renders[index];
    if (!hasExactKeys(raw, [
      "presetId",
      "presetStateSha256",
      "referenceImageSha256",
      "referenceImageByteLength",
      "embeddingSha256",
    ])) return null;
    const entry = raw as Partial<StudioVrmAvatarReferenceCanonicalRenderEntry>;
    const catalogueEntry = catalogue.entries[index];
    if (
      !catalogueEntry
      || typeof entry.presetId !== "string"
      || entry.presetId !== PRESET_IDS[index]
      || entry.presetId !== catalogueEntry?.presetId
      || renderIds.has(entry.presetId)
      || typeof entry.presetStateSha256 !== "string"
      || entry.presetStateSha256 !== studioVrmAvatarReferencePresetStateSha256(entry.presetId)
      || typeof entry.referenceImageSha256 !== "string"
      || !SHA256_HEX.test(entry.referenceImageSha256)
      || imageHashes.has(entry.referenceImageSha256)
      || entry.referenceImageByteLength !== expectedReferenceImageByteLength
      || catalogueEntry.embedding.headIndex
        !== STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headIndex
      || catalogueEntry.embedding.headName
        !== STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headName
      || catalogueEntry.embedding.floatEmbedding.length
        !== STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.dimensions
      || typeof entry.embeddingSha256 !== "string"
      || !SHA256_HEX.test(entry.embeddingSha256)
      || entry.embeddingSha256 !== studioVrmAvatarReferenceEmbeddingSha256(
        catalogueEntry.embedding,
      )
      || embeddingHashes.has(entry.embeddingSha256)
      || !catalogueEntry.embedding.floatEmbedding.some((component) => component !== 0)
    ) return null;
    renderIds.add(entry.presetId);
    imageHashes.add(entry.referenceImageSha256);
    embeddingHashes.add(entry.embeddingSha256);
    renders.push(Object.freeze({
      presetId: entry.presetId,
      presetStateSha256: entry.presetStateSha256,
      referenceImageSha256: entry.referenceImageSha256,
      referenceImageByteLength: entry.referenceImageByteLength,
      embeddingSha256: entry.embeddingSha256,
    }));
  }
  if (!exactStringArrayMatch([...renderIds].sort(), PRESET_IDS)) return null;
  if (!embeddingsSelfRankFirst(catalogue)) return null;

  return Object.freeze({
    authority: STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY,
    renders: Object.freeze(renders),
    catalogue,
  });
}

/**
 * Resolves a receipt-bound recommendation into an appearance-only Avatar Forge state.
 * The current body/proportion authority is retained so applying a style cannot unexpectedly
 * rebuild the humanoid rig. The host commits the returned state as one explicit Undo command.
 */
export function resolveStudioVrmAvatarReferenceAppearanceState(input: {
  readonly current: AvatarForgeState;
  readonly selection: StudioVrmAvatarReferenceProductSelection;
  readonly catalogue: StudioVrmAvatarReferenceCatalogue | null;
}): AvatarForgeState | null {
  if (!input.catalogue) return null;
  let catalogue: StudioVrmAvatarReferenceCatalogue;
  try {
    catalogue = admitStudioVrmAvatarReferenceCatalogue(input.catalogue);
  } catch {
    return null;
  }
  const { selection } = input;
  if (!isStudioVrmAvatarReferenceRecommendationReceipt(selection.receipt)) return null;
  const catalogueIds = catalogue.entries.map(({ presetId }) => presetId).sort();
  if (
    selection.receipt.catalogueRevision !== catalogue.catalogueRevision
    || !exactStringArrayMatch(selection.receipt.cataloguePresetIds, catalogueIds)
    || !selection.receipt.recommendations.some(({ presetId }) => presetId === selection.presetId)
  ) return null;

  const canonicalPreset = createAvatarForgeState(selection.presetId);
  if (
    canonicalPreset.presetId !== selection.presetId
    || !snapshotsMatch(serializeAvatarForgeState(selection.state), canonicalPreset)
  ) return null;

  const current = parseAvatarForgeState(input.current);
  return serializeAvatarForgeState({
    ...canonicalPreset,
    // A style recommendation does not own the current body or rig proportions.
    presetId: undefined,
    bodyPresetId: current.bodyPresetId,
    body: current.body,
    proportions: current.proportions,
    ...(current.legacyHipWidth === undefined
      ? { legacyHipWidth: undefined }
      : { legacyHipWidth: current.legacyHipWidth }),
  });
}
