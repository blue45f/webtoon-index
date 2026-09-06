/**
 * Deterministic, side-effect-free planning for a Toon Studio publish package.
 *
 * The planner validates metadata that is actually available, derives portable file names, and
 * produces a privacy-safe public manifest. It does not render pixels, create a ZIP, upload to a
 * platform, or claim that a mutable destination policy is still current. Callers must perform
 * the planned renders and re-run validation with the resulting dimensions and byte sizes.
 */

import { normalizeStudioReviewPdfProfileId } from "./studio-review-pdf-profile";

import type { StudioReviewPdfProfileId } from "./studio-review-pdf-profile";

export const STUDIO_PUBLISH_PACKAGE_SCHEMA = "toonspectrum.publish-package" as const;
export const STUDIO_PUBLISH_PACKAGE_VERSION = 1 as const;
export const STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT = "2026-07-10" as const;

export const STUDIO_PUBLISH_DESTINATIONS = ["generic", "webtoon", "tapas"] as const;
export type StudioPublishPackageDestination = (typeof STUDIO_PUBLISH_DESTINATIONS)[number];

export const STUDIO_PUBLISH_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type StudioPublishPackageImageMimeType = (typeof STUDIO_PUBLISH_IMAGE_MIME_TYPES)[number];

export const STUDIO_PUBLISH_THUMBNAIL_SLOTS = [
  "episode",
  "series-square",
  "series-vertical",
  "series-cover",
  "series-banner",
] as const;
export type StudioPublishThumbnailSlot = (typeof STUDIO_PUBLISH_THUMBNAIL_SLOTS)[number];

export type StudioPublishPackageAiUsage = "none" | "assisted" | "generated";
export type StudioPublishPackageFormat = "png" | "jpeg" | "webp" | "gif";
export type StudioPublishPackageIssueSeverity = "error" | "warning";

export interface StudioPublishThumbnailPreset {
  slot: StudioPublishThumbnailSlot;
  label: string;
  required: boolean;
  width: number;
  height: number;
  allowedMimeTypes: readonly StudioPublishPackageImageMimeType[];
  /** Exclusive upper bound when present: the official wording is "less than/under". */
  maxBytesExclusive?: number;
  /** WEBTOON episode thumbnails currently require an ASCII letters-and-digits stem. */
  asciiAlphanumericFileStem?: boolean;
}

export interface StudioPublishEpisodeImagePreset {
  allowedMimeTypes: readonly StudioPublishPackageImageMimeType[];
  /** Exact final upload width. Source canvases may be resampled to this value. */
  targetWidth?: number;
  /** Inclusive final image-height ceiling. */
  maxHeight?: number;
  /** MIME-specific inclusive height ceiling, such as Tapas GIF's 1,000px limit. */
  maxHeightByMimeType?: Partial<Record<StudioPublishPackageImageMimeType, number>>;
  /** Exclusive upper bound when present. */
  maxBytesExclusive?: number;
  /** Exclusive total episode upper bound when present. */
  maxEpisodeBytesExclusive?: number;
  maxFiles?: number;
}

export interface StudioPublishPlatformPreset {
  id: StudioPublishPackageDestination;
  label: string;
  revision: string;
  policySnapshotDate: typeof STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT;
  policySourceUrls: readonly string[];
  requiresCurrentPolicyReview: boolean;
  fileNameMode: "portable-unicode" | "portable-ascii";
  aiPolicy: "allowed-with-disclosure" | "generated-prohibited";
  episode: StudioPublishEpisodeImagePreset;
  thumbnails: readonly StudioPublishThumbnailPreset[];
  note: string;
}

const KB = 1_000;
const MB = 1_000_000;
const PORTABLE_RENDER_DIMENSION = 16_384;

/**
 * A dated workflow snapshot, not a promise that third-party rules will never change.
 *
 * Tapas sizes come from its official File Size Guide. WEBTOON thumbnail sizes come from its
 * March 2026 official CANVAS help article. WEBTOON episode slicing follows ToonSpectrum's
 * existing 800x1280 export workflow and intentionally leaves byte limits unset when the official
 * benchmark source does not establish them.
 */
export const STUDIO_PUBLISH_PLATFORM_PRESETS: Readonly<
  Record<StudioPublishPackageDestination, StudioPublishPlatformPreset>
> = {
  generic: {
    id: "generic",
    label: "범용 이미지 패키지",
    revision: "generic-v1",
    policySnapshotDate: STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT,
    policySourceUrls: [],
    requiresCurrentPolicyReview: false,
    fileNameMode: "portable-unicode",
    aiPolicy: "allowed-with-disclosure",
    episode: {
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxHeight: PORTABLE_RENDER_DIMENSION,
      maxFiles: 500,
    },
    thumbnails: [
      {
        slot: "episode",
        label: "공유 썸네일",
        required: false,
        width: 1_200,
        height: 630,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      },
    ],
    note: "플랫폼 직접 업로드가 아닌 전달·보관용 이미지 패키지입니다.",
  },
  webtoon: {
    id: "webtoon",
    label: "WEBTOON CANVAS",
    revision: "webtoon-canvas-2026-03",
    policySnapshotDate: STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT,
    policySourceUrls: [
      "https://webtooncanvas.zendesk.com/hc/en-us/articles/32913712749588-File-Size-Overview-What-to-Know-before-Publishing-your-Comic-on-WEBTOON-CANVAS",
      "https://webtooncanvas.zendesk.com/hc/en-us/articles/42850360989076-Preview-Episodes-Before-Publishing",
    ],
    requiresCurrentPolicyReview: true,
    fileNameMode: "portable-ascii",
    aiPolicy: "allowed-with-disclosure",
    episode: {
      allowedMimeTypes: ["image/png", "image/jpeg"],
      targetWidth: 800,
      maxHeight: 1_280,
      maxFiles: 500,
    },
    thumbnails: [
      {
        slot: "episode",
        label: "회차 썸네일",
        required: true,
        width: 202,
        height: 142,
        allowedMimeTypes: ["image/png", "image/jpeg"],
        maxBytesExclusive: 500 * KB,
        asciiAlphanumericFileStem: true,
      },
      {
        slot: "series-square",
        label: "시리즈 정방형 썸네일",
        required: false,
        width: 1_080,
        height: 1_080,
        allowedMimeTypes: ["image/png", "image/jpeg"],
        maxBytesExclusive: 500 * KB,
      },
      {
        slot: "series-vertical",
        label: "시리즈 세로형 썸네일",
        required: false,
        width: 1_080,
        height: 1_920,
        allowedMimeTypes: ["image/png", "image/jpeg"],
        maxBytesExclusive: 700 * KB,
      },
    ],
    note: "CANVAS 업로드 전 공식 미리보기에서 모바일 글자 크기·순서·거터를 다시 확인하세요.",
  },
  tapas: {
    id: "tapas",
    label: "Tapas",
    revision: "tapas-creator-guide-2026-07",
    policySnapshotDate: STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT,
    policySourceUrls: [
      "https://www.creators.tapas.io/file-size-guide",
      "https://www.creators.tapas.io/creating-a-comic-episode",
      "https://www.creators.tapas.io/creating-a-series",
    ],
    requiresCurrentPolicyReview: true,
    fileNameMode: "portable-ascii",
    aiPolicy: "generated-prohibited",
    episode: {
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif"],
      targetWidth: 940,
      maxHeightByMimeType: { "image/gif": 1_000 },
      maxBytesExclusive: 2 * MB,
      maxEpisodeBytesExclusive: 20 * MB,
      maxFiles: 500,
    },
    thumbnails: [
      {
        slot: "episode",
        label: "회차 썸네일",
        required: true,
        width: 300,
        height: 300,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif"],
        maxBytesExclusive: 2 * MB,
      },
      {
        slot: "series-square",
        label: "시리즈 썸네일",
        required: false,
        width: 300,
        height: 300,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif"],
        maxBytesExclusive: 2 * MB,
      },
      {
        slot: "series-cover",
        label: "시리즈 북 커버",
        required: false,
        width: 960,
        height: 1_440,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif"],
        maxBytesExclusive: 2 * MB,
      },
      {
        slot: "series-banner",
        label: "시리즈 배너",
        required: false,
        width: 1_280,
        height: 460,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif"],
        maxBytesExclusive: 2 * MB,
      },
    ],
    note: "Tapas 직접 게시가 아니며, 업로드 전 최신 콘텐츠·AI 정책을 반드시 직접 확인해야 합니다.",
  },
};

for (const preset of Object.values(STUDIO_PUBLISH_PLATFORM_PRESETS)) {
  Object.freeze(preset.episode.allowedMimeTypes);
  if (preset.episode.maxHeightByMimeType) Object.freeze(preset.episode.maxHeightByMimeType);
  Object.freeze(preset.episode);
  for (const thumbnail of preset.thumbnails) {
    Object.freeze(thumbnail.allowedMimeTypes);
    Object.freeze(thumbnail);
  }
  Object.freeze(preset.thumbnails);
  Object.freeze(preset.policySourceUrls);
  Object.freeze(preset);
}
Object.freeze(STUDIO_PUBLISH_PLATFORM_PRESETS);

export function getStudioPublishPlatformPreset(
  destination: StudioPublishPackageDestination
): StudioPublishPlatformPreset {
  return STUDIO_PUBLISH_PLATFORM_PRESETS[destination];
}

export interface StudioPublishPackageSettings {
  version: typeof STUDIO_PUBLISH_PACKAGE_VERSION;
  destination: StudioPublishPackageDestination;
  outputFormat: Exclude<StudioPublishPackageFormat, "gif">;
  requestedThumbnailSlots: StudioPublishThumbnailSlot[];
  includeReviewPdf: boolean;
  /** 내부 review.pdf에만 쓰는 구성. 공개 manifest에는 프로필이나 검토 메타데이터를 투영하지 않는다. */
  reviewPdfProfile: StudioReviewPdfProfileId;
  includeCredits: boolean;
  aiUsage: StudioPublishPackageAiUsage;
  aiDisclosure: string;
  policyReviewConfirmed: boolean;
  thumbnailSafetyConfirmed: boolean;
}

export const DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS: StudioPublishPackageSettings = {
  version: STUDIO_PUBLISH_PACKAGE_VERSION,
  destination: "generic",
  outputFormat: "png",
  requestedThumbnailSlots: ["episode"],
  includeReviewPdf: false,
  reviewPdfProfile: "image-only",
  includeCredits: true,
  aiUsage: "none",
  aiDisclosure: "",
  policyReviewConfirmed: false,
  thumbnailSafetyConfirmed: false,
};

export const STUDIO_PUBLISH_PACKAGE_LIMITS = {
  maxCanvases: 500,
  maxImages: 1_000,
  maxThumbnails: 20,
  maxArtifacts: 1_100,
  maxTitleCodeUnits: 200,
  maxDisclosureCodeUnits: 1_000,
  maxCreditsCodeUnits: 20_000,
  maxIdCodeUnits: 160,
  maxFileNameCodeUnits: 180,
  maxCanvasDimension: 100_000,
  maxByteSize: 10_000_000_000,
} as const;

export interface StudioPublishCanvasMetadata {
  id: string;
  width?: number;
  height?: number;
}

export interface StudioPublishRenderedImageMetadata {
  /** Internal source identifier; omitted from the public manifest. */
  id: string;
  sourceCanvasId?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  sha256?: string;
  /** Imported names and paths are never trusted as output names. */
  fileName?: string;
  localPath?: string;
}

export interface StudioPublishThumbnailMetadata extends StudioPublishRenderedImageMetadata {
  slot: StudioPublishThumbnailSlot;
}

export interface StudioPublishPackagePlanInput {
  settings?: unknown;
  seriesTitle: string;
  episodeTitle: string;
  episodeNumber?: number | null;
  canvases?: readonly StudioPublishCanvasMetadata[];
  episodeImages: readonly StudioPublishRenderedImageMetadata[];
  thumbnails?: readonly StudioPublishThumbnailMetadata[];
  creditsText?: string;
  /** Optional caller-supplied timestamp; no clock is read when it is omitted. */
  generatedAt?: string | Date;
}

export type StudioPublishPackageIssueCode =
  | "SERIES_TITLE_REQUIRED"
  | "EPISODE_TITLE_REQUIRED"
  | "EPISODE_NUMBER_INVALID"
  | "CANVAS_METADATA_MISSING"
  | "CANVAS_LIMIT_EXCEEDED"
  | "CANVAS_ID_REQUIRED"
  | "CANVAS_ID_DUPLICATE"
  | "CANVAS_DIMENSIONS_MISSING"
  | "CANVAS_DIMENSIONS_INVALID"
  | "CANVAS_RESAMPLE_REQUIRED"
  | "CANVAS_VERTICAL_RECOMMENDED"
  | "CANVAS_PIXEL_AREA_LARGE"
  | "EPISODE_IMAGES_REQUIRED"
  | "EPISODE_IMAGE_LIMIT_EXCEEDED"
  | "IMAGE_ID_REQUIRED"
  | "IMAGE_ID_DUPLICATE"
  | "IMAGE_SOURCE_UNKNOWN"
  | "IMAGE_MIME_MISSING"
  | "IMAGE_MIME_UNSUPPORTED"
  | "IMAGE_DIMENSIONS_MISSING"
  | "IMAGE_DIMENSIONS_INVALID"
  | "IMAGE_WIDTH_MISMATCH"
  | "IMAGE_HEIGHT_EXCEEDED"
  | "IMAGE_BYTE_SIZE_MISSING"
  | "IMAGE_BYTE_SIZE_INVALID"
  | "IMAGE_FILE_TOO_LARGE"
  | "EPISODE_TOTAL_SIZE_UNVERIFIED"
  | "EPISODE_TOTAL_SIZE_EXCEEDED"
  | "CHECKSUM_INVALID"
  | "THUMBNAIL_LIMIT_EXCEEDED"
  | "THUMBNAIL_REQUIRED"
  | "THUMBNAIL_SLOT_DUPLICATE"
  | "THUMBNAIL_SLOT_UNSUPPORTED"
  | "THUMBNAIL_MIME_MISSING"
  | "THUMBNAIL_MIME_UNSUPPORTED"
  | "THUMBNAIL_DIMENSIONS_MISSING"
  | "THUMBNAIL_DIMENSIONS_INVALID"
  | "THUMBNAIL_DIMENSIONS_MISMATCH"
  | "THUMBNAIL_BYTE_SIZE_MISSING"
  | "THUMBNAIL_BYTE_SIZE_INVALID"
  | "THUMBNAIL_FILE_TOO_LARGE"
  | "THUMBNAIL_CONTENT_REVIEW_REQUIRED"
  | "AI_DISCLOSURE_REQUIRED"
  | "TAPAS_AI_GENERATED_CONTENT_PROHIBITED"
  | "POLICY_REVIEW_REQUIRED"
  | "CREDITS_EMPTY"
  | "ARTIFACT_FILENAME_COLLISION";

export interface StudioPublishPackageIssue {
  code: StudioPublishPackageIssueCode;
  severity: StudioPublishPackageIssueSeverity;
  message: string;
  path?: string;
}

export type StudioPublishArtifactRole =
  | "episode-image"
  | "thumbnail"
  | "review-pdf"
  | "credits"
  | "ai-disclosure"
  | "validation-report"
  | "manifest";

export type StudioPublishArtifactState = "ready" | "metadata-incomplete" | "needs-source" | "planned";

export interface StudioPublishArtifactPlan {
  role: StudioPublishArtifactRole;
  slot?: StudioPublishThumbnailSlot;
  fileName: string;
  state: StudioPublishArtifactState;
  mimeType?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  sha256?: string;
  /** Internal-only mapping. The public manifest projection drops this field. */
  sourceId?: string;
}

export interface StudioPublishPackagePublicArtifact {
  role: StudioPublishArtifactRole;
  slot?: StudioPublishThumbnailSlot;
  fileName: string;
  state: StudioPublishArtifactState;
  mimeType?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  sha256?: string;
}

export interface StudioPublishPackageManifest {
  schema: typeof STUDIO_PUBLISH_PACKAGE_SCHEMA;
  version: typeof STUDIO_PUBLISH_PACKAGE_VERSION;
  destination: StudioPublishPackageDestination;
  preset: {
    id: StudioPublishPackageDestination;
    revision: string;
    policySnapshotDate: string;
    requiresCurrentPolicyReview: boolean;
  };
  publication: {
    seriesTitle: string;
    episodeTitle: string;
    episodeNumber?: number;
  };
  generatedAt?: string;
  artifacts: StudioPublishPackagePublicArtifact[];
  totals: {
    episodeImageCount: number;
    thumbnailCount: number;
    knownEpisodeBytes?: number;
  };
  ai: {
    usage: StudioPublishPackageAiUsage;
    disclosure?: string;
  };
  creditsIncluded: boolean;
  validation: {
    canExport: boolean;
    errorCount: number;
    warningCount: number;
  };
}

export interface StudioPublishPackagePlan {
  settings: StudioPublishPackageSettings;
  preset: StudioPublishPlatformPreset;
  canExport: boolean;
  errors: StudioPublishPackageIssue[];
  warnings: StudioPublishPackageIssue[];
  issues: StudioPublishPackageIssue[];
  artifacts: StudioPublishArtifactPlan[];
  manifest: StudioPublishPackageManifest;
}

const DESTINATION_ALIASES: Record<string, StudioPublishPackageDestination> = {
  generic: "generic",
  general: "generic",
  png: "generic",
  webtoon: "webtoon",
  "webtoon-canvas": "webtoon",
  canvas: "webtoon",
  tapas: "tapas",
};

const MIME_ALIASES: Record<string, StudioPublishPackageImageMimeType> = {
  "image/png": "image/png",
  png: "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  "image/webp": "image/webp",
  webp: "image/webp",
  "image/gif": "image/gif",
  gif: "image/gif",
};

const FORMAT_TO_MIME: Record<StudioPublishPackageFormat, StudioPublishPackageImageMimeType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const MIME_TO_EXTENSION: Record<StudioPublishPackageImageMimeType, StudioPublishPackageFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
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

function normalizeDestination(value: unknown): StudioPublishPackageDestination {
  if (typeof value !== "string") return "generic";
  return DESTINATION_ALIASES[value.trim().toLowerCase()] ?? "generic";
}

function normalizeOutputFormat(value: unknown): Exclude<StudioPublishPackageFormat, "gif"> {
  if (value === "jpg" || value === "jpeg" || value === "image/jpeg") return "jpeg";
  if (value === "webp" || value === "image/webp") return "webp";
  return "png";
}

function normalizeAiUsage(value: unknown): StudioPublishPackageAiUsage {
  return value === "assisted" || value === "generated" ? value : "none";
}

function normalizeThumbnailSlot(value: unknown): StudioPublishThumbnailSlot | null {
  return STUDIO_PUBLISH_THUMBNAIL_SLOTS.includes(value as StudioPublishThumbnailSlot)
    ? (value as StudioPublishThumbnailSlot)
    : null;
}

function normalizeRequestedThumbnailSlots(value: unknown): StudioPublishThumbnailSlot[] {
  if (!Array.isArray(value)) return ["episode"];
  const unique = new Set<StudioPublishThumbnailSlot>();
  for (const candidate of value.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxThumbnails)) {
    const slot = normalizeThumbnailSlot(candidate);
    if (slot) unique.add(slot);
  }
  return [...unique].sort(
    (left, right) =>
      STUDIO_PUBLISH_THUMBNAIL_SLOTS.indexOf(left) - STUDIO_PUBLISH_THUMBNAIL_SLOTS.indexOf(right)
  );
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

function cloneDefaultStudioPublishPackageSettings(): StudioPublishPackageSettings {
  return {
    ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
    requestedThumbnailSlots: [...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS.requestedThumbnailSlots],
  };
}

/**
 * Reads v1 and conservative unversioned/legacy settings. Unknown fields are dropped, so API keys,
 * raw prompts, provider request IDs, local paths, and other unrelated fields cannot survive.
 */
export function normalizeStudioPublishPackageSettings(value: unknown): StudioPublishPackageSettings {
  const decoded = decodeJson(value, "게시 패키지 설정");
  if (!isRecord(decoded)) return cloneDefaultStudioPublishPackageSettings();
  rejectFutureVersion(decoded, "게시 패키지 설정");
  const destination = normalizeDestination(decoded.destination ?? decoded.platform ?? decoded.profile);
  const requestedThumbnailSlots = normalizeRequestedThumbnailSlots(
    decoded.requestedThumbnailSlots ?? decoded.thumbnailSlots ?? decoded.thumbnails
  );
  return {
    version: STUDIO_PUBLISH_PACKAGE_VERSION,
    destination,
    outputFormat: normalizeOutputFormat(decoded.outputFormat ?? decoded.format),
    requestedThumbnailSlots,
    includeReviewPdf: decoded.includeReviewPdf === true || decoded.includePdf === true,
    reviewPdfProfile: normalizeStudioReviewPdfProfileId(
      decoded.reviewPdfProfile ?? decoded.reviewProfile ?? decoded.pdfProfile
    ),
    includeCredits: decoded.includeCredits !== false,
    aiUsage: normalizeAiUsage(decoded.aiUsage ?? decoded.aiContent),
    aiDisclosure: normalizeText(
      decoded.aiDisclosure ?? decoded.disclosure,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxDisclosureCodeUnits
    ),
    policyReviewConfirmed:
      decoded.policyReviewConfirmed === true || decoded.policyReviewed === true,
    thumbnailSafetyConfirmed:
      decoded.thumbnailSafetyConfirmed === true || decoded.thumbnailReviewed === true,
  };
}

export function serializeStudioPublishPackageSettings(value: unknown): string {
  return JSON.stringify(normalizeStudioPublishPackageSettings(value));
}

export interface StudioPublishFileNameOptions {
  fallback?: string;
  asciiOnly?: boolean;
  alphanumericOnly?: boolean;
  maxCodeUnits?: number;
}

/**
 * Produces a path-free cross-platform file stem. It removes control/bidi characters, traversal,
 * Windows device names, trailing dots/spaces, and optionally all non-ASCII/non-alphanumeric text.
 */
export function sanitizeStudioPublishFileStem(
  value: unknown,
  options: StudioPublishFileNameOptions = {}
): string {
  const maxCodeUnits = Math.max(
    1,
    Math.min(
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxFileNameCodeUnits,
      Math.floor(options.maxCodeUnits ?? STUDIO_PUBLISH_PACKAGE_LIMITS.maxFileNameCodeUnits)
    )
  );
  const fallback = normalizeText(options.fallback, maxCodeUnits) || "toonspectrum";
  const prepare = (candidate: string): string => {
    let result = normalizeText(candidate, maxCodeUnits * 2)
      .replace(/[\\/:*?"<>|%#&{}$!'@+=`~;,()[\]]+/gu, "-")
      .replace(/\.+/gu, "-")
      .replace(/\s+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^[\s.-]+|[\s.-]+$/gu, "");
    if (options.asciiOnly || options.alphanumericOnly) {
      result = result.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
      result = options.alphanumericOnly
        ? result.replace(/[^A-Za-z0-9]/gu, "")
        : result.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-");
    }
    result = result.slice(0, maxCodeUnits).replace(/[\s.-]+$/gu, "");
    if (!result || WINDOWS_RESERVED_NAMES.test(result)) return "";
    return result;
  };
  return prepare(normalizeText(value, maxCodeUnits * 2)) || prepare(fallback) || "toonspectrum";
}

function normalizeMimeType(value: unknown): StudioPublishPackageImageMimeType | null {
  if (typeof value !== "string") return null;
  return MIME_ALIASES[value.trim().toLowerCase()] ?? null;
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

function validPositiveInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
}

function makeIssue(
  severity: StudioPublishPackageIssueSeverity,
  code: StudioPublishPackageIssueCode,
  message: string,
  path?: string
): StudioPublishPackageIssue {
  return path ? { code, severity, message, path } : { code, severity, message };
}

function outputMimeForSettings(
  settings: StudioPublishPackageSettings,
  preset: StudioPublishPlatformPreset
): StudioPublishPackageImageMimeType {
  const requested = FORMAT_TO_MIME[settings.outputFormat];
  return preset.episode.allowedMimeTypes.includes(requested)
    ? requested
    : preset.episode.allowedMimeTypes[0];
}

function plannedContentBaseName(
  seriesTitle: string,
  episodeNumber: number | null | undefined,
  destination: StudioPublishPackageDestination,
  index: number
): string {
  const episode = validPositiveInteger(episodeNumber, 999_999)
    ? String(episodeNumber).padStart(3, "0")
    : "000";
  if (destination !== "generic") {
    return `episode-${episode}-${destination}-${String(index + 1).padStart(3, "0")}`;
  }
  const title = sanitizeStudioPublishFileStem(seriesTitle, {
    fallback: "toonspectrum",
    maxCodeUnits: 90,
  });
  return `${title}-episode-${episode}-${String(index + 1).padStart(3, "0")}`;
}

function contentBaseName(
  input: StudioPublishPackagePlanInput,
  settings: StudioPublishPackageSettings,
  index: number
): string {
  return plannedContentBaseName(
    input.seriesTitle,
    input.episodeNumber,
    settings.destination,
    index
  );
}

function thumbnailBaseName(
  seriesTitle: string,
  episodeNumber: number | null | undefined,
  destination: StudioPublishPackageDestination,
  spec: StudioPublishThumbnailPreset
): string {
  const episode = validPositiveInteger(episodeNumber, 999_999)
    ? String(episodeNumber).padStart(3, "0")
    : "000";
  if (spec.asciiAlphanumericFileStem) return `episode${episode}thumbnail`;
  if (destination !== "generic") return `${destination}-${spec.slot}`;
  const title = sanitizeStudioPublishFileStem(seriesTitle, {
    fallback: "toonspectrum",
    maxCodeUnits: 90,
  });
  return `${title}-${spec.slot}`;
}

function artifactFileName(stem: string, mimeType: StudioPublishPackageImageMimeType): string {
  return `${sanitizeStudioPublishFileStem(stem, { fallback: "artifact" })}.${MIME_TO_EXTENSION[mimeType]}`;
}

/**
 * Returns the exact thumbnail filename used by the final public manifest. Renderers must call
 * this helper instead of inventing a parallel name, otherwise a valid archive can contain files
 * that the manifest does not reference (notably WEBTOON's alphanumeric episode thumbnail rule).
 */
export function studioPublishThumbnailFileName(input: {
  destination: StudioPublishPackageDestination;
  seriesTitle: string;
  episodeNumber?: number | null;
  slot: StudioPublishThumbnailSlot;
  mimeType: StudioPublishPackageImageMimeType;
}): string {
  const preset = getStudioPublishPlatformPreset(input.destination);
  const spec = preset.thumbnails.find((candidate) => candidate.slot === input.slot);
  if (!spec) throw new Error("선택한 목적지에서 지원하지 않는 썸네일 종류예요.");
  return artifactFileName(
    thumbnailBaseName(input.seriesTitle, input.episodeNumber, input.destination, spec),
    input.mimeType
  );
}

export interface StudioPublishCanvasSlicePlanInput {
  destination: StudioPublishPackageDestination;
  seriesTitle: string;
  episodeNumber?: number | null;
  canvases: readonly StudioPublishCanvasMetadata[];
  format?: StudioPublishPackageFormat;
}

export interface StudioPublishCanvasSlicePlan {
  sourceCanvasId: string;
  sourceCanvasIndex: number;
  sliceIndex: number;
  sliceCount: number;
  source: { x: 0; y: number; width: number; height: number };
  output: { width: number; height: number };
  mimeType: StudioPublishPackageImageMimeType;
  fileName: string;
}

function roundGeometry(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Turns valid source canvases into a deterministic, browser-safe slice render plan. Invalid or
 * incomplete canvases are omitted; use planStudioPublishPackage for user-facing diagnostics.
 */
export function planStudioPublishCanvasSlices(
  input: StudioPublishCanvasSlicePlanInput
): StudioPublishCanvasSlicePlan[] {
  const preset = getStudioPublishPlatformPreset(input.destination);
  const requestedMime = FORMAT_TO_MIME[input.format ?? "png"];
  const mimeType = preset.episode.allowedMimeTypes.includes(requestedMime)
    ? requestedMime
    : preset.episode.allowedMimeTypes[0];
  const maxHeight = Math.min(
    preset.episode.maxHeightByMimeType?.[mimeType] ??
      preset.episode.maxHeight ??
      PORTABLE_RENDER_DIMENSION,
    PORTABLE_RENDER_DIMENSION
  );
  const drafts: Array<Omit<StudioPublishCanvasSlicePlan, "sliceIndex" | "sliceCount" | "fileName">> = [];
  input.canvases.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvases).forEach((canvas, sourceCanvasIndex) => {
    const sourceCanvasId = normalizeText(canvas.id, STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits);
    if (
      !sourceCanvasId ||
      !validPositiveInteger(canvas.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension) ||
      !validPositiveInteger(canvas.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
    ) {
      return;
    }
    const outputWidth = Math.min(
      preset.episode.targetWidth ?? canvas.width,
      PORTABLE_RENDER_DIMENSION
    );
    const scale = outputWidth / canvas.width;
    const scaledHeight = Math.max(1, Math.round(canvas.height * scale));
    const sliceCount = Math.ceil(scaledHeight / maxHeight);
    for (let localSliceIndex = 0; localSliceIndex < sliceCount; localSliceIndex += 1) {
      const outputY = localSliceIndex * maxHeight;
      const outputHeight = Math.min(maxHeight, scaledHeight - outputY);
      const sourceY = outputY / scale;
      const sourceHeight =
        localSliceIndex === sliceCount - 1
          ? canvas.height - sourceY
          : outputHeight / scale;
      drafts.push({
        sourceCanvasId,
        sourceCanvasIndex,
        source: {
          x: 0,
          y: roundGeometry(sourceY),
          width: canvas.width,
          height: roundGeometry(sourceHeight),
        },
        output: { width: outputWidth, height: outputHeight },
        mimeType,
      });
    }
  });
  return drafts.map((draft, sliceIndex) => ({
    ...draft,
    sliceIndex,
    sliceCount: drafts.length,
    fileName: artifactFileName(
      plannedContentBaseName(
        input.seriesTitle,
        input.episodeNumber,
        input.destination,
        sliceIndex
      ),
      mimeType
    ),
  }));
}

export interface StudioPublishThumbnailCropPlanInput {
  destination: StudioPublishPackageDestination;
  slot: StudioPublishThumbnailSlot;
  sourceWidth: number;
  sourceHeight: number;
  /** Normalized 0..1 focus point. Values outside the range are clamped. */
  focalX?: number;
  focalY?: number;
}

export interface StudioPublishThumbnailCropPlan {
  slot: StudioPublishThumbnailSlot;
  strategy: "cover";
  source: { x: number; y: number; width: number; height: number };
  output: { width: number; height: number };
  scale: number;
}

function clampUnit(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.5;
}

/** Plans a center/focal-point cover crop for one destination thumbnail slot. */
export function planStudioPublishThumbnailCrop(
  input: StudioPublishThumbnailCropPlanInput
): StudioPublishThumbnailCropPlan | null {
  const spec = getStudioPublishPlatformPreset(input.destination).thumbnails.find(
    (candidate) => candidate.slot === input.slot
  );
  if (
    !spec ||
    !validPositiveInteger(input.sourceWidth, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension) ||
    !validPositiveInteger(input.sourceHeight, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
  ) {
    return null;
  }
  const sourceAspect = input.sourceWidth / input.sourceHeight;
  const outputAspect = spec.width / spec.height;
  const cropWidth = sourceAspect > outputAspect
    ? input.sourceHeight * outputAspect
    : input.sourceWidth;
  const cropHeight = sourceAspect > outputAspect
    ? input.sourceHeight
    : input.sourceWidth / outputAspect;
  const maxX = input.sourceWidth - cropWidth;
  const maxY = input.sourceHeight - cropHeight;
  const desiredX = input.sourceWidth * clampUnit(input.focalX) - cropWidth / 2;
  const desiredY = input.sourceHeight * clampUnit(input.focalY) - cropHeight / 2;
  const x = Math.min(maxX, Math.max(0, desiredX));
  const y = Math.min(maxY, Math.max(0, desiredY));
  return {
    slot: input.slot,
    strategy: "cover",
    source: {
      x: roundGeometry(x),
      y: roundGeometry(y),
      width: roundGeometry(cropWidth),
      height: roundGeometry(cropHeight),
    },
    output: { width: spec.width, height: spec.height },
    scale: roundGeometry(spec.width / cropWidth),
  };
}

function artifactStateForImage(
  image: StudioPublishRenderedImageMetadata,
  requiresBytes: boolean
): StudioPublishArtifactState {
  if (
    normalizeMimeType(image.mimeType) === null ||
    image.width === undefined ||
    image.height === undefined ||
    (requiresBytes && image.byteSize === undefined)
  ) {
    return "metadata-incomplete";
  }
  return "ready";
}

function validateCanvases(
  canvases: readonly StudioPublishCanvasMetadata[] | undefined,
  preset: StudioPublishPlatformPreset,
  issues: StudioPublishPackageIssue[]
): Set<string> {
  const canvasIds = new Set<string>();
  if (!canvases || canvases.length === 0) {
    issues.push(
      makeIssue(
        "warning",
        "CANVAS_METADATA_MISSING",
        "원본 캔버스 메타데이터가 없어 리샘플링 필요 여부를 확인할 수 없습니다.",
        "canvases"
      )
    );
    return canvasIds;
  }
  if (canvases.length > STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvases) {
    issues.push(
      makeIssue(
        "error",
        "CANVAS_LIMIT_EXCEEDED",
        `캔버스는 최대 ${STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvases.toLocaleString()}개까지 검증할 수 있습니다.`,
        "canvases"
      )
    );
  }
  canvases.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvases).forEach((canvas, index) => {
    const path = `canvases[${index}]`;
    const id = normalizeText(canvas.id, STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits);
    if (!id) {
      issues.push(makeIssue("error", "CANVAS_ID_REQUIRED", "캔버스 식별자가 비어 있습니다.", `${path}.id`));
    } else if (canvasIds.has(id)) {
      issues.push(
        makeIssue("error", "CANVAS_ID_DUPLICATE", `캔버스 식별자가 중복되었습니다: ${id}`, `${path}.id`)
      );
    } else {
      canvasIds.add(id);
    }
    if (canvas.width === undefined || canvas.height === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "CANVAS_DIMENSIONS_MISSING",
          "캔버스 크기 정보가 없어 출력 배율을 확인할 수 없습니다.",
          canvas.width === undefined ? `${path}.width` : `${path}.height`
        )
      );
      return;
    }
    if (
      !validPositiveInteger(canvas.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension) ||
      !validPositiveInteger(canvas.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
    ) {
      issues.push(
        makeIssue(
          "error",
          "CANVAS_DIMENSIONS_INVALID",
          "캔버스 폭과 높이는 유효한 양의 정수여야 합니다.",
          path
        )
      );
      return;
    }
    if (preset.episode.targetWidth && canvas.width !== preset.episode.targetWidth) {
      issues.push(
        makeIssue(
          "warning",
          "CANVAS_RESAMPLE_REQUIRED",
          `원본 폭 ${canvas.width.toLocaleString()}px를 최종 폭 ${preset.episode.targetWidth.toLocaleString()}px로 리샘플해야 합니다.`,
          `${path}.width`
        )
      );
    }
    if (preset.id !== "generic" && canvas.height <= canvas.width) {
      issues.push(
        makeIssue(
          "warning",
          "CANVAS_VERTICAL_RECOMMENDED",
          "세로 스크롤 게시처에서는 세로형 캔버스와 모바일 미리보기를 권장합니다.",
          path
        )
      );
    }
    if (canvas.width * canvas.height > 250_000_000) {
      issues.push(
        makeIssue(
          "warning",
          "CANVAS_PIXEL_AREA_LARGE",
          "원본 캔버스 픽셀 수가 커 브라우저 렌더링 메모리를 많이 사용할 수 있습니다. 분할 렌더를 사용하세요.",
          path
        )
      );
    }
  });
  return canvasIds;
}

function validateEpisodeImages(
  input: StudioPublishPackagePlanInput,
  settings: StudioPublishPackageSettings,
  preset: StudioPublishPlatformPreset,
  canvasIds: ReadonlySet<string>,
  issues: StudioPublishPackageIssue[]
): { artifacts: StudioPublishArtifactPlan[]; knownEpisodeBytes?: number } {
  const images = input.episodeImages;
  const artifacts: StudioPublishArtifactPlan[] = [];
  if (images.length === 0) {
    issues.push(
      makeIssue("error", "EPISODE_IMAGES_REQUIRED", "게시할 회차 이미지가 한 장 이상 필요합니다.", "episodeImages")
    );
    return { artifacts };
  }
  if (
    images.length > STUDIO_PUBLISH_PACKAGE_LIMITS.maxImages ||
    (preset.episode.maxFiles !== undefined && images.length > preset.episode.maxFiles)
  ) {
    const max = Math.min(
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxImages,
      preset.episode.maxFiles ?? STUDIO_PUBLISH_PACKAGE_LIMITS.maxImages
    );
    issues.push(
      makeIssue(
        "error",
        "EPISODE_IMAGE_LIMIT_EXCEEDED",
        `회차 이미지가 검증 가능한 최대 ${max.toLocaleString()}장을 넘었습니다.`,
        "episodeImages"
      )
    );
  }
  const ids = new Set<string>();
  let knownBytes = 0;
  let allBytesKnown = true;
  const fallbackMime = outputMimeForSettings(settings, preset);
  images.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxImages).forEach((image, index) => {
    const path = `episodeImages[${index}]`;
    const id = normalizeText(image.id, STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits);
    if (!id) {
      issues.push(makeIssue("error", "IMAGE_ID_REQUIRED", "이미지 식별자가 비어 있습니다.", `${path}.id`));
    } else if (ids.has(id)) {
      issues.push(makeIssue("error", "IMAGE_ID_DUPLICATE", `이미지 식별자가 중복되었습니다: ${id}`, `${path}.id`));
    } else {
      ids.add(id);
    }
    const sourceCanvasId = normalizeText(
      image.sourceCanvasId,
      STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits
    );
    if (sourceCanvasId && canvasIds.size > 0 && !canvasIds.has(sourceCanvasId)) {
      issues.push(
        makeIssue(
          "warning",
          "IMAGE_SOURCE_UNKNOWN",
          "이미지가 현재 원본 캔버스 목록과 연결되지 않습니다.",
          `${path}.sourceCanvasId`
        )
      );
    }
    const mimeType = normalizeMimeType(image.mimeType);
    if (!mimeType) {
      issues.push(
        makeIssue(
          "warning",
          "IMAGE_MIME_MISSING",
          "출력 형식 정보가 없어 설정의 기본 형식으로 파일명을 계획했습니다.",
          `${path}.mimeType`
        )
      );
    } else if (!preset.episode.allowedMimeTypes.includes(mimeType)) {
      issues.push(
        makeIssue(
          "error",
          "IMAGE_MIME_UNSUPPORTED",
          `${preset.label} 회차 이미지는 ${preset.episode.allowedMimeTypes.join(", ")} 형식만 허용합니다.`,
          `${path}.mimeType`
        )
      );
    }
    if (image.width === undefined || image.height === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "IMAGE_DIMENSIONS_MISSING",
          "최종 이미지 크기 정보가 없어 게시처 규격을 확인할 수 없습니다.",
          image.width === undefined ? `${path}.width` : `${path}.height`
        )
      );
    } else if (
      !validPositiveInteger(image.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension) ||
      !validPositiveInteger(image.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
    ) {
      issues.push(
        makeIssue("error", "IMAGE_DIMENSIONS_INVALID", "이미지 폭과 높이가 유효하지 않습니다.", path)
      );
    } else {
      if (preset.episode.targetWidth && image.width !== preset.episode.targetWidth) {
        issues.push(
          makeIssue(
            "error",
            "IMAGE_WIDTH_MISMATCH",
            `최종 이미지 폭은 ${preset.episode.targetWidth.toLocaleString()}px여야 합니다.`,
            `${path}.width`
          )
        );
      }
      const effectiveMime = mimeType ?? fallbackMime;
      const maxHeight = preset.episode.maxHeightByMimeType?.[effectiveMime] ?? preset.episode.maxHeight;
      if (maxHeight !== undefined && image.height > maxHeight) {
        issues.push(
          makeIssue(
            "error",
            "IMAGE_HEIGHT_EXCEEDED",
            `이 형식의 이미지 높이는 ${maxHeight.toLocaleString()}px 이하여야 합니다.`,
            `${path}.height`
          )
        );
      }
    }
    if (image.byteSize === undefined) {
      allBytesKnown = false;
      if (preset.episode.maxBytesExclusive !== undefined) {
        issues.push(
          makeIssue(
            "warning",
            "IMAGE_BYTE_SIZE_MISSING",
            "파일 용량 정보가 없어 게시처의 개별 파일 제한을 확인할 수 없습니다.",
            `${path}.byteSize`
          )
        );
      }
    } else if (!validPositiveInteger(image.byteSize, STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize)) {
      allBytesKnown = false;
      issues.push(
        makeIssue("error", "IMAGE_BYTE_SIZE_INVALID", "파일 용량 정보가 유효하지 않습니다.", `${path}.byteSize`)
      );
    } else {
      knownBytes += image.byteSize;
      if (
        preset.episode.maxBytesExclusive !== undefined &&
        image.byteSize >= preset.episode.maxBytesExclusive
      ) {
        issues.push(
          makeIssue(
            "error",
            "IMAGE_FILE_TOO_LARGE",
            `개별 파일은 ${(preset.episode.maxBytesExclusive / MB).toLocaleString()}MB 미만이어야 합니다.`,
            `${path}.byteSize`
          )
        );
      }
    }
    const checksum = normalizeSha256(image.sha256);
    if (image.sha256 !== undefined && checksum === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "CHECKSUM_INVALID",
          "SHA-256 값이 올바르지 않아 공개 manifest에서 제외했습니다.",
          `${path}.sha256`
        )
      );
    }
    const outputMime = mimeType ?? fallbackMime;
    artifacts.push({
      role: "episode-image",
      fileName: artifactFileName(contentBaseName(input, settings, index), outputMime),
      state: artifactStateForImage(image, preset.episode.maxBytesExclusive !== undefined),
      mimeType: outputMime,
      ...(validPositiveInteger(image.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
        ? { width: image.width }
        : {}),
      ...(validPositiveInteger(image.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
        ? { height: image.height }
        : {}),
      ...(validPositiveInteger(image.byteSize, STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize)
        ? { byteSize: image.byteSize }
        : {}),
      ...(checksum ? { sha256: checksum } : {}),
      ...(id ? { sourceId: id } : {}),
    });
  });
  if (preset.episode.maxEpisodeBytesExclusive !== undefined) {
    if (!allBytesKnown) {
      issues.push(
        makeIssue(
          "warning",
          "EPISODE_TOTAL_SIZE_UNVERIFIED",
          "일부 파일 용량이 없어 회차 전체 용량 제한을 확인할 수 없습니다.",
          "episodeImages"
        )
      );
    } else if (knownBytes >= preset.episode.maxEpisodeBytesExclusive) {
      issues.push(
        makeIssue(
          "error",
          "EPISODE_TOTAL_SIZE_EXCEEDED",
          `회차 전체 파일은 ${(preset.episode.maxEpisodeBytesExclusive / MB).toLocaleString()}MB 미만이어야 합니다.`,
          "episodeImages"
        )
      );
    }
  }
  return { artifacts, ...(allBytesKnown ? { knownEpisodeBytes: knownBytes } : {}) };
}

function validateThumbnails(
  input: StudioPublishPackagePlanInput,
  settings: StudioPublishPackageSettings,
  preset: StudioPublishPlatformPreset,
  issues: StudioPublishPackageIssue[]
): StudioPublishArtifactPlan[] {
  const artifacts: StudioPublishArtifactPlan[] = [];
  const thumbnails = input.thumbnails ?? [];
  if (thumbnails.length > STUDIO_PUBLISH_PACKAGE_LIMITS.maxThumbnails) {
    issues.push(
      makeIssue(
        "error",
        "THUMBNAIL_LIMIT_EXCEEDED",
        `썸네일은 최대 ${STUDIO_PUBLISH_PACKAGE_LIMITS.maxThumbnails}개까지 검증할 수 있습니다.`,
        "thumbnails"
      )
    );
  }
  const specs = new Map(preset.thumbnails.map((spec) => [spec.slot, spec]));
  const selectedSlots = new Set(settings.requestedThumbnailSlots);
  for (const spec of preset.thumbnails) {
    if (spec.required) selectedSlots.add(spec.slot);
  }
  const bySlot = new Map<StudioPublishThumbnailSlot, StudioPublishThumbnailMetadata>();
  thumbnails.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxThumbnails).forEach((thumbnail, index) => {
    const path = `thumbnails[${index}]`;
    const spec = specs.get(thumbnail.slot);
    if (!spec) {
      issues.push(
        makeIssue(
          "warning",
          "THUMBNAIL_SLOT_UNSUPPORTED",
          `${preset.label} 패키지에서 사용하지 않는 썸네일 종류입니다: ${thumbnail.slot}`,
          `${path}.slot`
        )
      );
      return;
    }
    selectedSlots.add(thumbnail.slot);
    if (bySlot.has(thumbnail.slot)) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_SLOT_DUPLICATE",
          `같은 썸네일 종류가 중복되었습니다: ${thumbnail.slot}`,
          `${path}.slot`
        )
      );
      return;
    }
    bySlot.set(thumbnail.slot, thumbnail);
  });
  for (const slot of [...selectedSlots].sort(
    (left, right) =>
      STUDIO_PUBLISH_THUMBNAIL_SLOTS.indexOf(left) - STUDIO_PUBLISH_THUMBNAIL_SLOTS.indexOf(right)
  )) {
    const spec = specs.get(slot);
    if (!spec) continue;
    const thumbnail = bySlot.get(slot);
    if (!thumbnail) {
      if (spec.required) {
        issues.push(
          makeIssue(
            "error",
            "THUMBNAIL_REQUIRED",
            `${spec.label} 이미지가 필요합니다.`,
            `thumbnails.${slot}`
          )
        );
      }
      const fallbackMime = spec.allowedMimeTypes.includes(FORMAT_TO_MIME[settings.outputFormat])
        ? FORMAT_TO_MIME[settings.outputFormat]
        : spec.allowedMimeTypes[0];
      artifacts.push({
        role: "thumbnail",
        slot,
        fileName: studioPublishThumbnailFileName({
          destination: settings.destination,
          seriesTitle: input.seriesTitle,
          episodeNumber: input.episodeNumber,
          slot: spec.slot,
          mimeType: fallbackMime,
        }),
        state: "needs-source",
        mimeType: fallbackMime,
        width: spec.width,
        height: spec.height,
      });
      continue;
    }
    const path = `thumbnails[${thumbnails.indexOf(thumbnail)}]`;
    const mimeType = normalizeMimeType(thumbnail.mimeType);
    if (!mimeType) {
      issues.push(
        makeIssue(
          "warning",
          "THUMBNAIL_MIME_MISSING",
          "썸네일 형식 정보가 없어 기본 형식으로 파일명을 계획했습니다.",
          `${path}.mimeType`
        )
      );
    } else if (!spec.allowedMimeTypes.includes(mimeType)) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_MIME_UNSUPPORTED",
          `${spec.label}은(는) ${spec.allowedMimeTypes.join(", ")} 형식만 허용합니다.`,
          `${path}.mimeType`
        )
      );
    }
    if (thumbnail.width === undefined || thumbnail.height === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "THUMBNAIL_DIMENSIONS_MISSING",
          "썸네일 크기 정보가 없어 정확한 크기를 확인할 수 없습니다.",
          thumbnail.width === undefined ? `${path}.width` : `${path}.height`
        )
      );
    } else if (
      !validPositiveInteger(thumbnail.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension) ||
      !validPositiveInteger(thumbnail.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
    ) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_DIMENSIONS_INVALID",
          "썸네일 폭과 높이가 유효하지 않습니다.",
          path
        )
      );
    } else if (thumbnail.width !== spec.width || thumbnail.height !== spec.height) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_DIMENSIONS_MISMATCH",
          `${spec.label}은(는) ${spec.width.toLocaleString()}×${spec.height.toLocaleString()}px여야 합니다.`,
          path
        )
      );
    }
    if (thumbnail.byteSize === undefined) {
      if (spec.maxBytesExclusive !== undefined) {
        issues.push(
          makeIssue(
            "warning",
            "THUMBNAIL_BYTE_SIZE_MISSING",
            "썸네일 파일 용량이 없어 제한을 확인할 수 없습니다.",
            `${path}.byteSize`
          )
        );
      }
    } else if (!validPositiveInteger(thumbnail.byteSize, STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize)) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_BYTE_SIZE_INVALID",
          "썸네일 파일 용량이 유효하지 않습니다.",
          `${path}.byteSize`
        )
      );
    } else if (spec.maxBytesExclusive !== undefined && thumbnail.byteSize >= spec.maxBytesExclusive) {
      issues.push(
        makeIssue(
          "error",
          "THUMBNAIL_FILE_TOO_LARGE",
          `${spec.label}은(는) ${(spec.maxBytesExclusive / KB).toLocaleString()}KB 미만이어야 합니다.`,
          `${path}.byteSize`
        )
      );
    }
    const checksum = normalizeSha256(thumbnail.sha256);
    if (thumbnail.sha256 !== undefined && checksum === undefined) {
      issues.push(
        makeIssue(
          "warning",
          "CHECKSUM_INVALID",
          "SHA-256 값이 올바르지 않아 공개 manifest에서 제외했습니다.",
          `${path}.sha256`
        )
      );
    }
    const fallbackMime = spec.allowedMimeTypes.includes(FORMAT_TO_MIME[settings.outputFormat])
      ? FORMAT_TO_MIME[settings.outputFormat]
      : spec.allowedMimeTypes[0];
    const outputMime = mimeType ?? fallbackMime;
    artifacts.push({
      role: "thumbnail",
      slot,
      fileName: studioPublishThumbnailFileName({
        destination: settings.destination,
        seriesTitle: input.seriesTitle,
        episodeNumber: input.episodeNumber,
        slot: spec.slot,
        mimeType: outputMime,
      }),
      state: artifactStateForImage(thumbnail, spec.maxBytesExclusive !== undefined),
      mimeType: outputMime,
      ...(validPositiveInteger(thumbnail.width, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
        ? { width: thumbnail.width }
        : {}),
      ...(validPositiveInteger(thumbnail.height, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCanvasDimension)
        ? { height: thumbnail.height }
        : {}),
      ...(validPositiveInteger(thumbnail.byteSize, STUDIO_PUBLISH_PACKAGE_LIMITS.maxByteSize)
        ? { byteSize: thumbnail.byteSize }
        : {}),
      ...(checksum ? { sha256: checksum } : {}),
      ...(normalizeText(thumbnail.id, STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits)
        ? { sourceId: normalizeText(thumbnail.id, STUDIO_PUBLISH_PACKAGE_LIMITS.maxIdCodeUnits) }
        : {}),
    });
  }
  if (artifacts.length > 0 && !settings.thumbnailSafetyConfirmed) {
    issues.push(
      makeIssue(
        preset.requiresCurrentPolicyReview ? "error" : "warning",
        "THUMBNAIL_CONTENT_REVIEW_REQUIRED",
        preset.requiresCurrentPolicyReview
          ? "정식 게시 패키지 전 썸네일의 전 연령 노출 적합성, 텍스트 잘림, 안전 영역을 직접 확인해야 합니다."
          : "썸네일의 전 연령 노출 적합성, 텍스트 잘림, 안전 영역을 사람이 직접 확인하세요.",
        "settings.thumbnailSafetyConfirmed"
      )
    );
  }
  return artifacts;
}

function publicArtifact(artifact: StudioPublishArtifactPlan): StudioPublishPackagePublicArtifact {
  return {
    role: artifact.role,
    ...(artifact.slot ? { slot: artifact.slot } : {}),
    fileName: artifact.fileName,
    state: artifact.state,
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    ...(artifact.width !== undefined ? { width: artifact.width } : {}),
    ...(artifact.height !== undefined ? { height: artifact.height } : {}),
    ...(artifact.byteSize !== undefined ? { byteSize: artifact.byteSize } : {}),
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
  };
}

function validateArtifactNames(
  artifacts: readonly StudioPublishArtifactPlan[],
  issues: StudioPublishPackageIssue[]
): void {
  const names = new Set<string>();
  artifacts.forEach((artifact, index) => {
    const comparison = artifact.fileName.normalize("NFKC").toLowerCase();
    if (names.has(comparison)) {
      issues.push(
        makeIssue(
          "error",
          "ARTIFACT_FILENAME_COLLISION",
          `패키지 안에서 파일명이 충돌합니다: ${artifact.fileName}`,
          `artifacts[${index}].fileName`
        )
      );
    }
    names.add(comparison);
  });
}

/** Plans artifacts and validates all known source/final-output metadata without side effects. */
export function planStudioPublishPackage(input: StudioPublishPackagePlanInput): StudioPublishPackagePlan {
  const settings = normalizeStudioPublishPackageSettings(input.settings);
  const preset = getStudioPublishPlatformPreset(settings.destination);
  const issues: StudioPublishPackageIssue[] = [];
  const seriesTitle = normalizeText(input.seriesTitle, STUDIO_PUBLISH_PACKAGE_LIMITS.maxTitleCodeUnits);
  const episodeTitle = normalizeText(input.episodeTitle, STUDIO_PUBLISH_PACKAGE_LIMITS.maxTitleCodeUnits);
  if (!seriesTitle) {
    issues.push(
      makeIssue("error", "SERIES_TITLE_REQUIRED", "시리즈 제목을 입력해 주세요.", "seriesTitle")
    );
  }
  if (!episodeTitle) {
    issues.push(
      makeIssue("error", "EPISODE_TITLE_REQUIRED", "회차 제목을 입력해 주세요.", "episodeTitle")
    );
  }
  if (
    input.episodeNumber !== undefined &&
    input.episodeNumber !== null &&
    !validPositiveInteger(input.episodeNumber, 999_999)
  ) {
    issues.push(
      makeIssue(
        "error",
        "EPISODE_NUMBER_INVALID",
        "회차 번호는 1 이상 999,999 이하의 정수여야 합니다.",
        "episodeNumber"
      )
    );
  }

  const canvasIds = validateCanvases(input.canvases, preset, issues);
  const episodePlan = validateEpisodeImages(input, settings, preset, canvasIds, issues);
  const thumbnailArtifacts = validateThumbnails(input, settings, preset, issues);
  const artifacts: StudioPublishArtifactPlan[] = [...episodePlan.artifacts, ...thumbnailArtifacts];

  const creditsText = normalizeText(
    input.creditsText,
    STUDIO_PUBLISH_PACKAGE_LIMITS.maxCreditsCodeUnits
  );
  if (settings.includeReviewPdf) {
    artifacts.push({ role: "review-pdf", fileName: "review.pdf", state: "planned", mimeType: "application/pdf" });
  }
  if (settings.includeCredits) {
    if (creditsText) {
      artifacts.push({ role: "credits", fileName: "credits.txt", state: "planned", mimeType: "text/plain" });
    } else {
      issues.push(
        makeIssue(
          "warning",
          "CREDITS_EMPTY",
          "출처·라이선스 파일을 포함하도록 설정했지만 입력된 내용이 없습니다.",
          "creditsText"
        )
      );
    }
  }
  if (settings.aiUsage !== "none") {
    if (!settings.aiDisclosure) {
      issues.push(
        makeIssue(
          "error",
          "AI_DISCLOSURE_REQUIRED",
          "AI 보조 또는 생성 사용 범위를 설명하는 공개 문구가 필요합니다.",
          "settings.aiDisclosure"
        )
      );
    }
    artifacts.push({
      role: "ai-disclosure",
      fileName: "ai-disclosure.json",
      state: "planned",
      mimeType: "application/json",
    });
  }
  if (preset.aiPolicy === "generated-prohibited" && settings.aiUsage === "generated") {
    issues.push(
      makeIssue(
        "error",
        "TAPAS_AI_GENERATED_CONTENT_PROHIBITED",
        "현재 벤치마크한 Tapas 정책에서는 AI 생성 콘텐츠 게시가 금지됩니다. 최신 원문 정책을 직접 확인하세요.",
        "settings.aiUsage"
      )
    );
  }
  if (preset.requiresCurrentPolicyReview && !settings.policyReviewConfirmed) {
    issues.push(
      makeIssue(
        "error",
        "POLICY_REVIEW_REQUIRED",
        `${preset.label} 정식 게시 패키지 전 최신 업로드·콘텐츠 정책을 직접 확인해야 합니다.`,
        "settings.policyReviewConfirmed"
      )
    );
  }
  artifacts.push(
    { role: "validation-report", fileName: "validation-report.json", state: "planned", mimeType: "application/json" },
    { role: "manifest", fileName: "manifest.json", state: "planned", mimeType: "application/json" }
  );
  validateArtifactNames(artifacts, issues);

  const errors = issues.filter((candidate) => candidate.severity === "error");
  const warnings = issues.filter((candidate) => candidate.severity === "warning");
  const canExport = errors.length === 0;
  const generatedAt = normalizeCanonicalTimestamp(input.generatedAt);
  const episodeNumber = validPositiveInteger(input.episodeNumber, 999_999)
    ? input.episodeNumber
    : undefined;
  const publicArtifacts = artifacts.map(publicArtifact);
  const manifest: StudioPublishPackageManifest = {
    schema: STUDIO_PUBLISH_PACKAGE_SCHEMA,
    version: STUDIO_PUBLISH_PACKAGE_VERSION,
    destination: settings.destination,
    preset: {
      id: preset.id,
      revision: preset.revision,
      policySnapshotDate: preset.policySnapshotDate,
      requiresCurrentPolicyReview: preset.requiresCurrentPolicyReview,
    },
    publication: {
      seriesTitle,
      episodeTitle,
      ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    },
    ...(generatedAt ? { generatedAt } : {}),
    artifacts: publicArtifacts,
    totals: {
      episodeImageCount: publicArtifacts.filter((artifact) => artifact.role === "episode-image").length,
      thumbnailCount: publicArtifacts.filter((artifact) => artifact.role === "thumbnail").length,
      ...(episodePlan.knownEpisodeBytes !== undefined
        ? { knownEpisodeBytes: episodePlan.knownEpisodeBytes }
        : {}),
    },
    ai: {
      usage: settings.aiUsage,
      ...(settings.aiUsage !== "none" && settings.aiDisclosure
        ? { disclosure: settings.aiDisclosure }
        : {}),
    },
    creditsIncluded: artifacts.some((artifact) => artifact.role === "credits"),
    validation: { canExport, errorCount: errors.length, warningCount: warnings.length },
  };
  return { settings, preset, canExport, errors, warnings, issues, artifacts, manifest };
}
