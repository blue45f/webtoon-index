/**
 * User-triggered publish-manifest parsing, reconciliation, and serialization.
 *
 * The Studio route keeps package settings, presets, and planning synchronous for autosave and
 * panel rendering. Import this module only after an explicit manifest download/package export so
 * legacy migration and final archive verification do not tax the drawing workspace's initial JS.
 */

import {
  STUDIO_PUBLISH_PACKAGE_LIMITS,
  STUDIO_PUBLISH_PACKAGE_SCHEMA,
  STUDIO_PUBLISH_PACKAGE_VERSION,
  STUDIO_PUBLISH_THUMBNAIL_SLOTS,
  getStudioPublishPlatformPreset,
  normalizeStudioPublishPackageSettings,
  sanitizeStudioPublishFileStem,
  type StudioPublishArtifactRole,
  type StudioPublishArtifactState,
  type StudioPublishPackageManifest,
  type StudioPublishPackagePublicArtifact,
  type StudioPublishThumbnailSlot,
} from "./studio-publish-package";

const ARTIFACT_ROLES = new Set<StudioPublishArtifactRole>([
  "episode-image",
  "thumbnail",
  "review-pdf",
  "credits",
  "ai-disclosure",
  "validation-report",
  "manifest",
]);
const ARTIFACT_STATES = new Set<StudioPublishArtifactState>([
  "ready",
  "metadata-incomplete",
  "needs-source",
  "planned",
]);
const SAFE_SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIMESTAMP_MAX_CODE_UNITS = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUnsafeCharacters(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      continue;
    }
    output += character;
  }
  return output;
}

function normalizeText(value: unknown, maxCodeUnits: number): string {
  if (typeof value !== "string") return "";
  return stripUnsafeCharacters(value).normalize("NFKC").trim().slice(0, maxCodeUnits);
}

function decodeJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} JSON을 읽을 수 없습니다.`);
  }
}

function rejectFutureVersion(record: Record<string, unknown>, label: string): void {
  const version = record.version ?? record.schemaVersion;
  const numericVersion =
    typeof version === "number"
      ? version
      : typeof version === "string" && /^\d+$/u.test(version.trim())
        ? Number(version)
        : undefined;
  if (
    numericVersion !== undefined &&
    Number.isFinite(numericVersion) &&
    numericVersion > STUDIO_PUBLISH_PACKAGE_VERSION
  ) {
    throw new Error(`이 ${label}은(는) 더 최신 버전에서 만들어졌습니다.`);
  }
}

function validPositiveInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
}

function safeOptionalPositiveInteger(value: unknown, max: number): number | undefined {
  return validPositiveInteger(value, max) ? value : undefined;
}

function normalizeSha256(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_SHA256.test(normalized) ? normalized : undefined;
}

function normalizeCanonicalTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isFinite(value.getTime())) return undefined;
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (
    typeof candidate !== "string" ||
    candidate.length > ISO_TIMESTAMP_MAX_CODE_UNITS ||
    !Number.isFinite(Date.parse(candidate))
  ) {
    return undefined;
  }
  try {
    return new Date(candidate).toISOString();
  } catch {
    return undefined;
  }
}

function normalizeThumbnailSlot(value: unknown): StudioPublishThumbnailSlot | null {
  return STUDIO_PUBLISH_THUMBNAIL_SLOTS.includes(value as StudioPublishThumbnailSlot)
    ? (value as StudioPublishThumbnailSlot)
    : null;
}

function normalizeArtifactFileName(
  value: unknown,
  role: StudioPublishArtifactRole,
  index: number
): string {
  const raw = normalizeText(value, STUDIO_PUBLISH_PACKAGE_LIMITS.maxFileNameCodeUnits * 2);
  const lastDot = raw.lastIndexOf(".");
  const stem = lastDot > 0 ? raw.slice(0, lastDot) : raw;
  const rawExtension = lastDot > 0 ? raw.slice(lastDot + 1).toLowerCase() : "";
  const extension = /^[a-z0-9]{1,10}$/u.test(rawExtension)
    ? rawExtension
    : role === "review-pdf"
      ? "pdf"
      : role === "credits"
        ? "txt"
        : role === "episode-image" || role === "thumbnail"
          ? "png"
          : "json";
  return `${sanitizeStudioPublishFileStem(stem, { fallback: `${role}-${index + 1}` })}.${extension}`;
}

function normalizeManifestArtifact(
  value: unknown,
  index: number
): StudioPublishPackagePublicArtifact | null {
  if (!isRecord(value)) return null;
  const roleValue = value.role ?? value.type;
  if (typeof roleValue !== "string" || !ARTIFACT_ROLES.has(roleValue as StudioPublishArtifactRole)) {
    return null;
  }
  const role = roleValue as StudioPublishArtifactRole;
  const stateValue = value.state;
  const state =
    typeof stateValue === "string" && ARTIFACT_STATES.has(stateValue as StudioPublishArtifactState)
      ? (stateValue as StudioPublishArtifactState)
      : "planned";
  const slot = normalizeThumbnailSlot(value.slot);
  const mimeType = normalizeText(value.mimeType ?? value.mime, 100).toLowerCase();
  const sha256 = normalizeSha256(value.sha256 ?? value.checksum);
  return {
    role,
    ...(role === "thumbnail" && slot ? { slot } : {}),
    fileName: normalizeArtifactFileName(value.fileName ?? value.name, role, index),
    state,
    ...(mimeType ? { mimeType } : {}),
    ...(safeOptionalPositiveInteger(
      value.width,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension
    ) !== undefined
      ? { width: value.width as number }
      : {}),
    ...(safeOptionalPositiveInteger(
      value.height,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension
    ) !== undefined
      ? { height: value.height as number }
      : {}),
    ...(safeOptionalPositiveInteger(
      value.byteSize ?? value.bytes,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize
    ) !== undefined
      ? { byteSize: (value.byteSize ?? value.bytes) as number }
      : {}),
    ...(sha256 ? { sha256 } : {}),
  };
}

function dedupeManifestArtifacts(
  artifacts: readonly StudioPublishPackagePublicArtifact[]
): StudioPublishPackagePublicArtifact[] {
  const seen = new Set<string>();
  const result: StudioPublishPackagePublicArtifact[] = [];
  for (const artifact of artifacts) {
    const key = artifact.fileName.normalize("NFKC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artifact);
  }
  return result;
}

/**
 * Reads current or unversioned legacy manifests into the public v1 projection. Unknown/private
 * keys are dropped. Future versions are rejected instead of silently losing their semantics.
 */
export function parseStudioPublishPackageManifest(value: unknown): StudioPublishPackageManifest {
  const decoded = decodeJson(value, "게시 패키지 manifest");
  if (!isRecord(decoded)) throw new Error("올바르지 않은 게시 패키지 manifest입니다.");
  rejectFutureVersion(decoded, "게시 패키지 manifest");
  const destination = normalizeStudioPublishPackageSettings({
    destination: decoded.destination ?? decoded.platform ?? decoded.profile,
  }).destination;
  const preset = getStudioPublishPlatformPreset(destination);
  const publicationValue = isRecord(decoded.publication) ? decoded.publication : decoded;
  const seriesTitle = normalizeText(
    publicationValue.seriesTitle ?? publicationValue.title,
    STUDIO_PUBLISH_PACKAGE_LIMITS.maxTitleCodeUnits
  );
  const episodeTitle = normalizeText(
    publicationValue.episodeTitle ?? publicationValue.episodeName,
    STUDIO_PUBLISH_PACKAGE_LIMITS.maxTitleCodeUnits
  );
  const episodeNumber = safeOptionalPositiveInteger(
    publicationValue.episodeNumber ?? publicationValue.episode,
    999_999
  );
  const candidates = Array.isArray(decoded.artifacts)
    ? decoded.artifacts
    : Array.isArray(decoded.files)
      ? decoded.files
      : [];
  if (candidates.length > STUDIO_PUBLISH_PACKAGE_LIMITS.maxArtifacts) {
    throw new Error("게시 패키지 manifest의 파일 수가 안전 한도를 넘었습니다.");
  }
  const artifacts = dedupeManifestArtifacts(
    candidates.flatMap((candidate, index) => {
      const artifact = normalizeManifestArtifact(candidate, index);
      return artifact ? [artifact] : [];
    })
  );
  const aiValue = isRecord(decoded.ai) ? decoded.ai : decoded;
  const usage = normalizeStudioPublishPackageSettings({
    aiUsage: aiValue.usage ?? aiValue.aiUsage,
  }).aiUsage;
  const disclosure = normalizeText(
    aiValue.disclosure ?? aiValue.aiDisclosure,
    STUDIO_PUBLISH_PACKAGE_LIMITS.maxDisclosureCodeUnits
  );
  const validationValue = isRecord(decoded.validation) ? decoded.validation : {};
  const errorCount = safeOptionalPositiveInteger(validationValue.errorCount, 100_000) ?? 0;
  const warningCount = safeOptionalPositiveInteger(validationValue.warningCount, 100_000) ?? 0;
  const knownEpisodeBytes = artifacts
    .filter((artifact) => artifact.role === "episode-image")
    .reduce<number | undefined>((total, artifact) => {
      if (total === undefined || artifact.byteSize === undefined) return undefined;
      return total + artifact.byteSize;
    }, 0);
  const generatedAt = normalizeCanonicalTimestamp(decoded.generatedAt ?? decoded.createdAt);
  return {
    schema: STUDIO_PUBLISH_PACKAGE_SCHEMA,
    version: STUDIO_PUBLISH_PACKAGE_VERSION,
    destination,
    preset: {
      id: preset.id,
      revision:
        normalizeText(isRecord(decoded.preset) ? decoded.preset.revision : undefined, 120)
        || preset.revision,
      policySnapshotDate:
        normalizeText(
          isRecord(decoded.preset) ? decoded.preset.policySnapshotDate : undefined,
          40
        ) || preset.policySnapshotDate,
      requiresCurrentPolicyReview: preset.requiresCurrentPolicyReview,
    },
    publication: {
      seriesTitle,
      episodeTitle,
      ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    },
    ...(generatedAt ? { generatedAt } : {}),
    artifacts,
    totals: {
      episodeImageCount: artifacts.filter((artifact) => artifact.role === "episode-image").length,
      thumbnailCount: artifacts.filter((artifact) => artifact.role === "thumbnail").length,
      ...(knownEpisodeBytes !== undefined ? { knownEpisodeBytes } : {}),
    },
    ai: {
      usage,
      ...(usage !== "none" && disclosure ? { disclosure } : {}),
    },
    creditsIncluded: artifacts.some((artifact) => artifact.role === "credits"),
    validation: {
      canExport: validationValue.canExport === true && errorCount === 0,
      errorCount,
      warningCount,
    },
  };
}

export interface StudioPublishPackageActualArtifact {
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Reconciles a planned public manifest with files that were actually rendered before archiving.
 * Every planned artifact except manifest.json must exist exactly once, and no unlisted file may
 * slip into the package. manifest.json itself remains `planned` because embedding its own hash
 * would be recursively self-referential.
 */
export function finalizeStudioPublishPackageManifest(
  value: unknown,
  actualArtifacts: readonly StudioPublishPackageActualArtifact[]
): StudioPublishPackageManifest {
  const manifest = parseStudioPublishPackageManifest(value);
  const expected = new Map(
    manifest.artifacts
      .filter((artifact) => artifact.role !== "manifest")
      .map((artifact) => [artifact.fileName, artifact])
  );
  const actual = new Map<string, StudioPublishPackageActualArtifact>();
  for (const candidate of actualArtifacts) {
    const fileName = normalizeArtifactFileName(candidate.fileName, "validation-report", actual.size);
    const rawFileName = normalizeText(
      candidate.fileName,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxFileNameCodeUnits * 2
    );
    if (!fileName || fileName !== rawFileName || actual.has(fileName)) {
      throw new Error("실제 게시 패키지 파일명이 비어 있거나 중복되었습니다.");
    }
    const planned = expected.get(fileName);
    if (!planned) throw new Error(`manifest에 없는 파일이 생성되었습니다: ${fileName}`);
    if (!validPositiveInteger(candidate.byteSize, STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize)) {
      throw new Error(`실제 게시 패키지 파일 크기가 올바르지 않습니다: ${fileName}`);
    }
    const sha256 = normalizeSha256(candidate.sha256);
    if (!sha256) throw new Error(`실제 게시 패키지 파일 해시가 올바르지 않습니다: ${fileName}`);
    const mimeType = normalizeText(candidate.mimeType, 120).toLowerCase().split(";", 1)[0] ?? "";
    const plannedMime = normalizeText(planned.mimeType, 120).toLowerCase().split(";", 1)[0] ?? "";
    if (!mimeType || (plannedMime && mimeType !== plannedMime)) {
      throw new Error(`실제 게시 패키지 파일 형식이 manifest와 다릅니다: ${fileName}`);
    }
    actual.set(fileName, { fileName, mimeType, byteSize: candidate.byteSize, sha256 });
  }
  for (const fileName of expected.keys()) {
    if (!actual.has(fileName)) throw new Error(`게시 패키지 파일이 생성되지 않았습니다: ${fileName}`);
  }

  const artifacts = manifest.artifacts.map((artifact) => {
    const rendered = actual.get(artifact.fileName);
    return rendered
      ? {
          ...artifact,
          state: "ready" as const,
          mimeType: rendered.mimeType,
          byteSize: rendered.byteSize,
          sha256: rendered.sha256,
        }
      : artifact;
  });
  const knownEpisodeBytes = artifacts
    .filter((artifact) => artifact.role === "episode-image")
    .reduce((total, artifact) => total + (artifact.byteSize ?? 0), 0);
  return {
    ...manifest,
    artifacts,
    totals: {
      episodeImageCount: artifacts.filter((artifact) => artifact.role === "episode-image").length,
      thumbnailCount: artifacts.filter((artifact) => artifact.role === "thumbnail").length,
      knownEpisodeBytes,
    },
  };
}

/** Serializes only the normalized public manifest. Internal source IDs and unknown keys never pass. */
export function serializeStudioPublishPackageManifest(value: unknown): string {
  return JSON.stringify(parseStudioPublishPackageManifest(value), null, 2);
}
