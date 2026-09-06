import { encodeStudioVrmCapturePngBlob } from "./studio-vrm-raster-capture";
import {
  STUDIO_VRM_SURFACE_PAINT_MAX_DECODED_PIXELS,
  STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES,
  STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES,
  STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT,
  type StudioVrmSurfacePaintSettings,
  type StudioVrmSurfacePaintTexture,
} from "./studio-vrm-scene-document";
import {
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
  createStudioVrmTexturePaintArtifact,
  decodeStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
  type StudioVrmTexturePaintArtifactMetadata,
  type StudioVrmTexturePaintArtifactReadableImage,
} from "./studio-vrm-texture-paint-artifact";
import {
  getStudioVrmTexturePaintLibraryArtifact,
  saveStudioVrmTexturePaintLibraryArtifact,
} from "./studio-vrm-texture-paint-library";

import type {
  StudioVrmTexturePaintBindingDescriptor,
  StudioVrmTexturePaintExportTarget,
  StudioVrmTexturePaintRuntime,
} from "./studio-vrm-texture-paint-runtime";

export type StudioVrmTexturePaintPersistenceErrorCode =
  | "aborted"
  | "binding-conflict"
  | "budget-exceeded"
  | "restore-failed"
  | "runtime-export-failed"
  | "storage-receipt-mismatch";

const ERROR_MESSAGES: Readonly<Record<StudioVrmTexturePaintPersistenceErrorCode, string>> =
  Object.freeze({
    aborted: "VRM 표면 페인팅 저장·복원 작업을 취소했습니다.",
    "binding-conflict": "VRM 표면 페인팅 재질 결합 정보가 서로 충돌합니다.",
    "budget-exceeded": "VRM 표면 페인팅 PNG가 장면 문서의 안전 예산을 초과합니다.",
    "restore-failed": "저장된 VRM 표면 페인팅을 현재 모델 재질에 복원하지 못했습니다.",
    "runtime-export-failed": "VRM 표면 페인팅을 저장 가능한 픽셀로 내보내지 못했습니다.",
    "storage-receipt-mismatch": "VRM 표면 페인팅 PNG의 저장 무결성 정보가 장면과 다릅니다.",
  });

export class StudioVrmTexturePaintPersistenceError extends Error {
  constructor(
    readonly code: StudioVrmTexturePaintPersistenceErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
    this.name = code === "aborted" ? "AbortError" : "StudioVrmTexturePaintPersistenceError";
  }
}

export interface StudioVrmTexturePaintPersistenceDependencies {
  readonly encodePng: typeof encodeStudioVrmCapturePngBlob;
  readonly createArtifact: typeof createStudioVrmTexturePaintArtifact;
  readonly saveArtifact: typeof saveStudioVrmTexturePaintLibraryArtifact;
  readonly getArtifact: typeof getStudioVrmTexturePaintLibraryArtifact;
  readonly decodeArtifact: typeof decodeStudioVrmTexturePaintArtifact;
}

export interface StudioVrmTexturePaintPersistenceOptions {
  readonly signal?: AbortSignal;
  readonly dependencies?: Partial<StudioVrmTexturePaintPersistenceDependencies>;
}

export interface StudioVrmTexturePaintRestoreReceipt {
  readonly artifactCount: number;
  readonly bindingCount: number;
}

type StudioVrmTexturePaintRestoreRuntime =
  Pick<StudioVrmTexturePaintRuntime, "rehydrateTarget">
  & Partial<Pick<
    StudioVrmTexturePaintRuntime,
    "exportPaintedTargets" | "resetActiveTarget"
  >>;

interface PreparedRestoreBinding {
  readonly texture: StudioVrmSurfacePaintTexture;
  readonly image: StudioVrmTexturePaintArtifactReadableImage;
}

interface ExistingRestoreTarget {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

const DEFAULT_DEPENDENCIES: StudioVrmTexturePaintPersistenceDependencies = Object.freeze({
  encodePng: encodeStudioVrmCapturePngBlob,
  createArtifact: createStudioVrmTexturePaintArtifact,
  saveArtifact: saveStudioVrmTexturePaintLibraryArtifact,
  getArtifact: getStudioVrmTexturePaintLibraryArtifact,
  decodeArtifact: decodeStudioVrmTexturePaintArtifact,
});

function dependencies(
  overrides: Partial<StudioVrmTexturePaintPersistenceDependencies> | undefined,
): StudioVrmTexturePaintPersistenceDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StudioVrmTexturePaintPersistenceError("aborted", { cause: signal.reason });
  }
}

function bindingIdentity(binding: StudioVrmTexturePaintBindingDescriptor): string {
  return `${binding.materialLocator}\u0000${binding.textureSlot}`;
}

function receiptForTexture(
  texture: StudioVrmSurfacePaintTexture,
): StudioVrmTexturePaintArtifactMetadata {
  return Object.freeze({
    schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
    kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
    bindingKey: texture.bindingKey,
    contentHash: texture.hash as StudioVrmTexturePaintArtifactHash,
    mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
    byteLength: texture.byteSize,
    width: texture.width,
    height: texture.height,
  });
}

function textureFromArtifact(
  binding: StudioVrmTexturePaintBindingDescriptor,
  artifact: StudioVrmTexturePaintArtifact,
): StudioVrmSurfacePaintTexture {
  return Object.freeze({
    bindingKey: binding.bindingKey,
    materialLocator: binding.materialLocator,
    textureSlot: binding.textureSlot,
    hash: artifact.metadata.contentHash,
    mime: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
    byteSize: artifact.metadata.byteLength,
    width: artifact.metadata.width,
    height: artifact.metadata.height,
  });
}

function compareTextures(
  left: StudioVrmSurfacePaintTexture,
  right: StudioVrmSurfacePaintTexture,
): number {
  return left.materialLocator < right.materialLocator
    ? -1
    : left.materialLocator > right.materialLocator
      ? 1
      : left.textureSlot < right.textureSlot
        ? -1
        : left.textureSlot > right.textureSlot
          ? 1
          : left.bindingKey < right.bindingKey
            ? -1
            : left.bindingKey > right.bindingKey
              ? 1
              : 0;
}

function ensureSceneBudgets(textures: readonly StudioVrmSurfacePaintTexture[]): void {
  if (textures.length > STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES) {
    throw new StudioVrmTexturePaintPersistenceError("budget-exceeded");
  }
  const unique = new Map<string, StudioVrmSurfacePaintTexture>();
  const identities = new Map<string, StudioVrmSurfacePaintTexture>();
  for (const texture of textures) {
    const identity = `${texture.materialLocator}\u0000${texture.textureSlot}`;
    const existingBinding = identities.get(identity);
    if (
      existingBinding
      && (
        existingBinding.hash !== texture.hash
        || existingBinding.bindingKey !== texture.bindingKey
      )
    ) {
      throw new StudioVrmTexturePaintPersistenceError("binding-conflict");
    }
    identities.set(identity, texture);
    const existingArtifact = unique.get(texture.hash);
    if (
      existingArtifact
      && (
        existingArtifact.byteSize !== texture.byteSize
        || existingArtifact.width !== texture.width
        || existingArtifact.height !== texture.height
      )
    ) {
      throw new StudioVrmTexturePaintPersistenceError("storage-receipt-mismatch");
    }
    unique.set(texture.hash, texture);
  }
  let bytes = 0;
  let pixels = 0;
  for (const texture of unique.values()) {
    bytes += texture.byteSize;
    pixels += texture.width * texture.height;
  }
  if (
    !Number.isSafeInteger(bytes)
    || bytes > STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES
    || !Number.isSafeInteger(pixels)
    || pixels > STUDIO_VRM_SURFACE_PAINT_MAX_DECODED_PIXELS
  ) {
    throw new StudioVrmTexturePaintPersistenceError("budget-exceeded");
  }
}

/**
 * Encodes changed runtime targets one-by-one. A shared source texture becomes one PNG artifact and
 * one scene record per material binding, so archive bytes remain deduplicated.
 */
export async function persistStudioVrmTexturePaintRuntime(
  runtime: Pick<StudioVrmTexturePaintRuntime, "exportPaintedTargets">,
  options: StudioVrmTexturePaintPersistenceOptions = {},
): Promise<StudioVrmSurfacePaintSettings> {
  throwIfAborted(options.signal);
  const exported = runtime.exportPaintedTargets();
  if (!exported.ok) {
    throw new StudioVrmTexturePaintPersistenceError("runtime-export-failed", {
      cause: new Error(exported.error.message),
    });
  }
  const deps = dependencies(options.dependencies);
  const textures: StudioVrmSurfacePaintTexture[] = [];
  const artifacts = new Map<StudioVrmTexturePaintArtifactHash, StudioVrmTexturePaintArtifact>();
  const seenBindings = new Map<string, StudioVrmSurfacePaintTexture>();
  const exportedBindingCount = exported.value.reduce(
    (count, target) => count + target.bindings.length,
    0,
  );
  if (
    !Number.isSafeInteger(exportedBindingCount)
    || exportedBindingCount > STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES
  ) {
    throw new StudioVrmTexturePaintPersistenceError("budget-exceeded");
  }
  for (const target of exported.value) {
    throwIfAborted(options.signal);
    const firstBinding = target.bindings[0];
    if (!firstBinding) {
      throw new StudioVrmTexturePaintPersistenceError("binding-conflict");
    }
    const png = await deps.encodePng(
      target.pixels,
      { width: target.width, height: target.height },
      { signal: options.signal },
    );
    throwIfAborted(options.signal);
    const artifact = await deps.createArtifact({
      bindingKey: firstBinding.bindingKey,
      source: png,
      expectedWidth: target.width,
      expectedHeight: target.height,
    }, { signal: options.signal });
    artifacts.set(artifact.metadata.contentHash, artifact);
    for (const binding of target.bindings) {
      const texture = textureFromArtifact(binding, artifact);
      const identity = bindingIdentity(binding);
      const existing = seenBindings.get(identity);
      if (
        existing
        && (
          existing.hash !== texture.hash
          || existing.bindingKey !== texture.bindingKey
        )
      ) {
        throw new StudioVrmTexturePaintPersistenceError("binding-conflict");
      }
      seenBindings.set(identity, texture);
      textures.push(texture);
    }
  }
  textures.sort(compareTextures);
  ensureSceneBudgets(textures);
  for (const artifact of artifacts.values()) {
    throwIfAborted(options.signal);
    await deps.saveArtifact(artifact, { signal: options.signal });
  }
  return Object.freeze({
    version: 1,
    textures: Object.freeze(textures),
  });
}

function groupTexturesByHash(
  settings: StudioVrmSurfacePaintSettings,
): Map<string, StudioVrmSurfacePaintTexture[]> {
  const grouped = new Map<string, StudioVrmSurfacePaintTexture[]>();
  for (const texture of settings.textures) {
    const current = grouped.get(texture.hash);
    if (current) current.push(texture);
    else grouped.set(texture.hash, [texture]);
  }
  return grouped;
}

function assertArtifactReceiptMatchesScene(
  artifact: StudioVrmTexturePaintArtifact,
  texture: StudioVrmSurfacePaintTexture,
): void {
  if (
    artifact.metadata.contentHash !== texture.hash
    || artifact.metadata.byteLength !== texture.byteSize
    || artifact.metadata.width !== texture.width
    || artifact.metadata.height !== texture.height
    || artifact.metadata.mimeType !== texture.mime
    || artifact.archiveEntry.data.size !== texture.byteSize
  ) {
    throw new StudioVrmTexturePaintPersistenceError("storage-receipt-mismatch");
  }
}

function pixelsEqual(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function existingRestoreTargets(
  exported: readonly StudioVrmTexturePaintExportTarget[],
): Map<string, ExistingRestoreTarget> {
  const targets = new Map<string, ExistingRestoreTarget>();
  for (const target of exported) {
    const existing = {
      id: target.id,
      width: target.width,
      height: target.height,
      pixels: target.pixels,
    };
    for (const binding of target.bindings) {
      targets.set(bindingIdentity(binding), existing);
    }
  }
  return targets;
}

function preflightAlreadyRestoredBindings(
  runtime: StudioVrmTexturePaintRestoreRuntime,
  prepared: readonly PreparedRestoreBinding[],
): Set<string> {
  if (typeof runtime.exportPaintedTargets !== "function") return new Set();
  const exported = runtime.exportPaintedTargets();
  if (!exported.ok) {
    throw new StudioVrmTexturePaintPersistenceError("restore-failed", {
      cause: new Error(exported.error.message),
    });
  }
  const existing = existingRestoreTargets(exported.value);
  const comparedTargets = new Map<string, boolean>();
  const alreadyRestored = new Set<string>();
  for (const entry of prepared) {
    const identity = `${entry.texture.materialLocator}\u0000${entry.texture.textureSlot}`;
    const target = existing.get(identity);
    if (!target) continue;
    const comparisonKey = `${target.id}\u0000${entry.texture.hash}`;
    let matches = comparedTargets.get(comparisonKey);
    if (matches === undefined) {
      matches =
        target.width === entry.image.width
        && target.height === entry.image.height
        && pixelsEqual(target.pixels, entry.image.data);
      comparedTargets.set(comparisonKey, matches);
    }
    if (!matches) {
      throw new StudioVrmTexturePaintPersistenceError("restore-failed");
    }
    alreadyRestored.add(identity);
  }
  return alreadyRestored;
}

async function rollbackAppliedBindings(
  runtime: StudioVrmTexturePaintRestoreRuntime,
  applied: readonly PreparedRestoreBinding[],
): Promise<void> {
  if (typeof runtime.resetActiveTarget !== "function") return;
  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const entry = applied[index];
    if (!entry) continue;
    try {
      const selected = await runtime.rehydrateTarget({
        binding: {
          bindingKey: entry.texture.bindingKey,
          materialLocator: entry.texture.materialLocator,
          textureSlot: STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT,
        },
        image: entry.image,
      });
      if (!selected.ok) continue;
      runtime.resetActiveTarget();
    } catch {
      // Public runtime APIs provide best-effort visual rollback. Preserve the original failure.
    }
  }
}

/**
 * Rehydrates one decoded PNG per unique hash and applies it to every authenticated material
 * binding. Fetch, receipt verification, and decoding complete for the entire restore set before
 * the first runtime mutation. Any missing/corrupt binding therefore fails closed without partially
 * applying an earlier artifact.
 */
export async function rehydrateStudioVrmTexturePaintRuntime(
  runtime: StudioVrmTexturePaintRestoreRuntime,
  settings: StudioVrmSurfacePaintSettings,
  options: StudioVrmTexturePaintPersistenceOptions = {},
): Promise<StudioVrmTexturePaintRestoreReceipt> {
  throwIfAborted(options.signal);
  ensureSceneBudgets(settings.textures);
  const deps = dependencies(options.dependencies);
  const grouped = groupTexturesByHash(settings);
  const prepared: PreparedRestoreBinding[] = [];
  for (const [hash, textures] of grouped) {
    throwIfAborted(options.signal);
    const first = textures[0];
    if (!first) continue;
    const artifact = await deps.getArtifact(hash, { signal: options.signal });
    for (const texture of textures) {
      assertArtifactReceiptMatchesScene(artifact, texture);
    }
    throwIfAborted(options.signal);
    const image: StudioVrmTexturePaintArtifactReadableImage =
      await deps.decodeArtifact(
        receiptForTexture(first),
        artifact.archiveEntry.data,
        { signal: options.signal },
      );
    for (const texture of textures) {
      prepared.push({ texture, image });
    }
  }
  throwIfAborted(options.signal);

  const alreadyRestored = preflightAlreadyRestoredBindings(runtime, prepared);
  const applied: PreparedRestoreBinding[] = [];
  try {
    for (const entry of prepared) {
      throwIfAborted(options.signal);
      const identity =
        `${entry.texture.materialLocator}\u0000${entry.texture.textureSlot}`;
      if (alreadyRestored.has(identity)) continue;
      const result = await runtime.rehydrateTarget({
        binding: {
          bindingKey: entry.texture.bindingKey,
          materialLocator: entry.texture.materialLocator,
          textureSlot: STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT,
        },
        image: entry.image,
        signal: options.signal,
      });
      if (!result.ok) {
        throw new StudioVrmTexturePaintPersistenceError("restore-failed", {
          cause: new Error(result.error.message),
        });
      }
      applied.push(entry);
    }
    throwIfAborted(options.signal);
  } catch (cause) {
    await rollbackAppliedBindings(runtime, applied);
    if (cause instanceof StudioVrmTexturePaintPersistenceError) throw cause;
    if (options.signal?.aborted) {
      throw new StudioVrmTexturePaintPersistenceError("aborted", {
        cause: options.signal.reason ?? cause,
      });
    }
    throw new StudioVrmTexturePaintPersistenceError("restore-failed", { cause });
  }
  return Object.freeze({
    artifactCount: grouped.size,
    bindingCount: prepared.length,
  });
}

/** Exposed for archive adapters that need an exact artifact verifier receipt. */
export function studioVrmSurfacePaintTextureArtifactReceipt(
  texture: StudioVrmSurfacePaintTexture,
): StudioVrmTexturePaintArtifactMetadata {
  return receiptForTexture(texture);
}
