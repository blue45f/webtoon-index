/**
 * Destination-aware publish preflight for rendered creator work packages.
 *
 * This module deliberately avoids hard-coded platform pixel, file-size, and page-count
 * limits: those policies can change independently of the app. Callers can use the
 * structural checks here before applying a separately refreshed destination preset.
 */

import {
  DEFAULT_STUDIO_PUBLISH_COMPLIANCE,
  normalizeStudioPublishCompliance,
  type StudioPublishComplianceChecklist,
} from "./studio-publish-compliance";

export type StudioPublishProfile = "generic" | "webtoon" | "tapas";

export type StudioPublishIssueSeverity = "error" | "warning";

export type StudioPublishAiUsage = "none" | "assisted" | "generated";

export type StudioPublishIssueCode =
  | "TITLE_REQUIRED"
  | "TAGS_MISSING"
  | "TAG_DUPLICATE"
  | "EDITORIAL_COMMENTS_OPEN"
  | "PAGES_REQUIRED"
  | "PAGE_ID_REQUIRED"
  | "PAGE_ID_DUPLICATE"
  | "PAGE_CHANGES_REQUESTED"
  | "PAGE_NOT_APPROVED"
  | "APPROVED_PAGE_UNLOCKED"
  | "PAGE_WITHOUT_IMAGE"
  | "IMAGE_ID_REQUIRED"
  | "IMAGE_ID_DUPLICATE"
  | "IMAGE_TYPE_MISSING"
  | "IMAGE_TYPE_UNSUPPORTED"
  | "IMAGE_DIMENSIONS_MISSING"
  | "IMAGE_DIMENSIONS_INVALID"
  | "IMAGE_BYTE_SIZE_MISSING"
  | "IMAGE_BYTE_SIZE_INVALID"
  | "VERTICAL_IMAGE_RECOMMENDED"
  | "IMAGE_WIDTHS_INCONSISTENT"
  | "AI_METADATA_INCONSISTENT"
  | "AI_DISCLOSURE_MISSING"
  | "AI_PROVENANCE_MISSING"
  | "TAPAS_AI_GENERATED_CONTENT_PROHIBITED";

export interface StudioPublishImageMetadata {
  /** Stable package-local ID, used to connect an image to AI provenance. */
  id: string;
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  aiGenerated?: boolean;
}

export interface StudioPublishPageMetadata {
  /** Stable package-local ID. Array order is the publication order. */
  id: string;
  images: readonly StudioPublishImageMetadata[];
  /** Optional editorial workflow metadata. Omitted legacy packages are not guessed. */
  reviewStatus?: "draft" | "needs-review" | "changes-requested" | "approved";
  reviewLocked?: boolean;
}

export interface StudioPublishAiProvenance {
  /** Image or other asset ID affected by this operation, when applicable. */
  assetId?: string;
  action: "generated" | "edited" | "translated" | "other";
  provider?: string;
  model?: string;
  transport?: "server" | "byok";
  promptVersion?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  createdAt?: string;
}

export interface StudioPublishAiMetadata {
  usage: StudioPublishAiUsage;
  /** Human-readable disclosure intended to travel with the publish pack. */
  disclosure?: string;
  /** Generation/modification history retained for the publish manifest. */
  provenance?: readonly StudioPublishAiProvenance[];
}

export interface StudioPublishPreflightInput {
  title: string;
  tags: readonly string[];
  pages: readonly StudioPublishPageMetadata[];
  aiContent?: StudioPublishAiMetadata;
  editorial?: {
    openCommentThreads?: number;
  };
}

export interface StudioPublishIssue {
  code: StudioPublishIssueCode;
  severity: StudioPublishIssueSeverity;
  message: string;
  /** Dot/bracket path into StudioPublishPreflightInput for UI focus and inline messages. */
  path?: string;
}

export interface StudioPublishPreflightResult {
  profile: StudioPublishProfile;
  canPublish: boolean;
  errors: readonly StudioPublishIssue[];
  warnings: readonly StudioPublishIssue[];
  issues: readonly StudioPublishIssue[];
}

export interface StudioPublishPackSettings {
  profile: StudioPublishProfile;
  aiUsage: StudioPublishAiUsage;
  disclosure: string;
  compliance: StudioPublishComplianceChecklist;
}

export const DEFAULT_STUDIO_PUBLISH_PACK_SETTINGS: StudioPublishPackSettings = {
  profile: "generic",
  aiUsage: "none",
  disclosure: "",
  compliance: DEFAULT_STUDIO_PUBLISH_COMPLIANCE,
};

export function normalizeStudioPublishPackSettings(value: unknown): StudioPublishPackSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...DEFAULT_STUDIO_PUBLISH_PACK_SETTINGS,
      compliance: normalizeStudioPublishCompliance(undefined),
    };
  }
  const record = value as Record<string, unknown>;
  const profile = record.profile;
  const aiUsage = record.aiUsage;
  return {
    profile: profile === "webtoon" || profile === "tapas" ? profile : "generic",
    aiUsage: aiUsage === "assisted" || aiUsage === "generated" ? aiUsage : "none",
    disclosure: typeof record.disclosure === "string" ? record.disclosure.trim().slice(0, 1_000) : "",
    compliance: normalizeStudioPublishCompliance(record.compliance),
  };
}

/** Formats accepted by the existing ToonSpectrum image-upload publishing flow. */
export const STUDIO_PUBLISH_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const SUPPORTED_IMAGE_TYPES = new Set<string>(STUDIO_PUBLISH_IMAGE_MIME_TYPES);

function issue(
  severity: StudioPublishIssueSeverity,
  code: StudioPublishIssueCode,
  message: string,
  path?: string
): StudioPublishIssue {
  return path ? { code, severity, message, path } : { code, severity, message };
}

function normalizedTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isVerticalScrollProfile(profile: StudioPublishProfile): boolean {
  return profile === "webtoon" || profile === "tapas";
}

/**
 * Runs deterministic, side-effect-free checks for a rendered publish package.
 *
 * Errors mean the package is structurally unsafe or conflicts with a documented
 * destination policy. Warnings identify missing verification metadata or quality
 * recommendations that should not silently block a publish flow.
 */
export function validateStudioPublishPreflight(
  input: StudioPublishPreflightInput,
  profile: StudioPublishProfile = "generic"
): StudioPublishPreflightResult {
  const issues: StudioPublishIssue[] = [];

  if (!input.title.trim()) {
    issues.push(issue("error", "TITLE_REQUIRED", "게시할 작품의 제목을 입력해 주세요.", "title"));
  }

  const tagIndexes = new Map<string, number>();
  let usableTagCount = 0;
  input.tags.forEach((tag, index) => {
    const normalized = normalizedTag(tag);
    if (!normalized) return;
    usableTagCount += 1;
    const previousIndex = tagIndexes.get(normalized);
    if (previousIndex !== undefined) {
      issues.push(
        issue(
          "warning",
          "TAG_DUPLICATE",
          `같은 태그가 중복되었습니다: ${tag.trim()}`,
          `tags[${index}]`
        )
      );
      return;
    }
    tagIndexes.set(normalized, index);
  });
  if (usableTagCount === 0) {
    issues.push(
      issue(
        "warning",
        "TAGS_MISSING",
        "검색과 작품 발견을 돕는 태그가 없습니다.",
        "tags"
      )
    );
  }

  const openCommentThreads = input.editorial?.openCommentThreads;
  if (
    typeof openCommentThreads === "number" &&
    Number.isSafeInteger(openCommentThreads) &&
    openCommentThreads > 0
  ) {
    issues.push(
      issue(
        "warning",
        "EDITORIAL_COMMENTS_OPEN",
        `해결되지 않은 문서 댓글이 ${openCommentThreads}개 있습니다. 게시 전 반영 여부를 확인하세요.`,
        "editorial.openCommentThreads"
      )
    );
  }

  if (input.pages.length === 0) {
    issues.push(
      issue("error", "PAGES_REQUIRED", "게시할 이미지 페이지를 1개 이상 준비해 주세요.", "pages")
    );
  }

  const pageIds = new Set<string>();
  const imageIds = new Set<string>();
  const knownWidths: number[] = [];
  let hasAiGeneratedImage = false;

  input.pages.forEach((page, pageIndex) => {
    const pagePath = `pages[${pageIndex}]`;
    const pageId = page.id.trim();
    if (!pageId) {
      issues.push(
        issue("error", "PAGE_ID_REQUIRED", "페이지 식별자가 비어 있습니다.", `${pagePath}.id`)
      );
    } else if (pageIds.has(pageId)) {
      issues.push(
        issue(
          "error",
          "PAGE_ID_DUPLICATE",
          `페이지 식별자가 중복되었습니다: ${pageId}`,
          `${pagePath}.id`
        )
      );
    } else {
      pageIds.add(pageId);
    }

    if (page.reviewStatus === "changes-requested") {
      issues.push(
        issue(
          "error",
          "PAGE_CHANGES_REQUESTED",
          "수정 요청 상태인 페이지가 있어 게시 전에 검토 반영이 필요합니다.",
          `${pagePath}.reviewStatus`
        )
      );
    } else if (page.reviewStatus && page.reviewStatus !== "approved") {
      issues.push(
        issue(
          "warning",
          "PAGE_NOT_APPROVED",
          "아직 승인되지 않은 페이지가 있습니다.",
          `${pagePath}.reviewStatus`
        )
      );
    } else if (page.reviewStatus === "approved" && page.reviewLocked !== true) {
      issues.push(
        issue(
          "warning",
          "APPROVED_PAGE_UNLOCKED",
          "승인된 페이지가 편집 잠금 해제 상태입니다. 내보내기 전 최종 변경 여부를 확인하세요.",
          `${pagePath}.reviewLocked`
        )
      );
    }

    if (page.images.length === 0) {
      issues.push(
        issue(
          "error",
          "PAGE_WITHOUT_IMAGE",
          "렌더링된 이미지가 없는 페이지는 게시할 수 없습니다.",
          `${pagePath}.images`
        )
      );
    }

    page.images.forEach((image, imageIndex) => {
      const imagePath = `${pagePath}.images[${imageIndex}]`;
      const imageId = image.id.trim();
      if (!imageId) {
        issues.push(
          issue("error", "IMAGE_ID_REQUIRED", "이미지 식별자가 비어 있습니다.", `${imagePath}.id`)
        );
      } else if (imageIds.has(imageId)) {
        issues.push(
          issue(
            "error",
            "IMAGE_ID_DUPLICATE",
            `이미지 식별자가 중복되었습니다: ${imageId}`,
            `${imagePath}.id`
          )
        );
      } else {
        imageIds.add(imageId);
      }

      const mimeType = image.mimeType?.trim().toLowerCase();
      if (!mimeType) {
        issues.push(
          issue(
            "warning",
            "IMAGE_TYPE_MISSING",
            "이미지 형식 정보가 없어 업로드 호환성을 확인할 수 없습니다.",
            `${imagePath}.mimeType`
          )
        );
      } else if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
        issues.push(
          issue(
            "error",
            "IMAGE_TYPE_UNSUPPORTED",
            "ToonSpectrum 게시용 이미지는 PNG, JPEG 또는 WebP 형식이어야 합니다.",
            `${imagePath}.mimeType`
          )
        );
      }

      const dimensionsMissing = image.width === undefined || image.height === undefined;
      if (dimensionsMissing) {
        issues.push(
          issue(
            "warning",
            "IMAGE_DIMENSIONS_MISSING",
            "이미지 크기 정보가 없어 화면 방향과 플랫폼 호환성을 확인할 수 없습니다.",
            image.width === undefined ? `${imagePath}.width` : `${imagePath}.height`
          )
        );
      } else if (!isPositiveFinite(image.width) || !isPositiveFinite(image.height)) {
        issues.push(
          issue(
            "error",
            "IMAGE_DIMENSIONS_INVALID",
            "이미지 너비와 높이는 0보다 큰 유한한 값이어야 합니다.",
            imagePath
          )
        );
      } else {
        knownWidths.push(image.width);
        if (isVerticalScrollProfile(profile) && image.width > image.height) {
          issues.push(
            issue(
              "warning",
              "VERTICAL_IMAGE_RECOMMENDED",
              `${profile === "webtoon" ? "WEBTOON" : "Tapas"} 세로 스크롤 게시에는 세로형 이미지가 권장됩니다.`,
              imagePath
            )
          );
        }
      }

      if (image.byteSize === undefined) {
        if (profile !== "generic") {
          issues.push(
            issue(
              "warning",
              "IMAGE_BYTE_SIZE_MISSING",
              "파일 용량 정보가 없어 대상 플랫폼의 현재 용량 제한을 확인할 수 없습니다.",
              `${imagePath}.byteSize`
            )
          );
        }
      } else if (!isPositiveFinite(image.byteSize)) {
        issues.push(
          issue(
            "error",
            "IMAGE_BYTE_SIZE_INVALID",
            "이미지 파일 용량은 0보다 큰 유한한 값이어야 합니다.",
            `${imagePath}.byteSize`
          )
        );
      }

      if (image.aiGenerated === true) hasAiGeneratedImage = true;
    });
  });

  if (isVerticalScrollProfile(profile) && new Set(knownWidths).size > 1) {
    issues.push(
      issue(
        "warning",
        "IMAGE_WIDTHS_INCONSISTENT",
        "세로 스크롤 이미지의 폭이 서로 달라 이어 읽을 때 경계가 어긋날 수 있습니다.",
        "pages"
      )
    );
  }

  const declaredAiUsage = input.aiContent?.usage ?? "none";
  const hasDeclaredAiUsage = declaredAiUsage !== "none";
  const provenance = input.aiContent?.provenance ?? [];
  const hasAnyAiUsage = hasDeclaredAiUsage || hasAiGeneratedImage || provenance.length > 0;

  if (hasAiGeneratedImage && declaredAiUsage !== "generated") {
    issues.push(
      issue(
        "error",
        "AI_METADATA_INCONSISTENT",
        "AI 생성 이미지가 있으므로 AI 사용 유형을 generated로 표시해야 합니다.",
        "aiContent.usage"
      )
    );
  }
  if (!hasAiGeneratedImage && provenance.length > 0 && declaredAiUsage === "none") {
    issues.push(
      issue(
        "error",
        "AI_METADATA_INCONSISTENT",
        "AI 보조 이력이 있으므로 AI 사용 유형을 assisted 또는 generated로 표시해야 합니다.",
        "aiContent.usage"
      )
    );
  }

  if (hasAnyAiUsage && !input.aiContent?.disclosure?.trim()) {
    issues.push(
      issue(
        "warning",
        "AI_DISCLOSURE_MISSING",
        "게시 패키지에 포함할 AI 사용 고지가 없습니다.",
        "aiContent.disclosure"
      )
    );
  }

  if (hasAnyAiUsage && provenance.length === 0) {
    issues.push(
      issue(
        "warning",
        "AI_PROVENANCE_MISSING",
        "AI 생성·수정 이력이 없어 게시 후 제작 과정을 확인하기 어렵습니다.",
        "aiContent.provenance"
      )
    );
  }

  if (profile === "tapas" && (declaredAiUsage === "generated" || hasAiGeneratedImage)) {
    issues.push(
      issue(
        "error",
        "TAPAS_AI_GENERATED_CONTENT_PROHIBITED",
        "현재 Tapas 정책상 AI 생성 콘텐츠는 게시할 수 없습니다.",
        "aiContent.usage"
      )
    );
  }

  const errors = issues.filter((candidate) => candidate.severity === "error");
  const warnings = issues.filter((candidate) => candidate.severity === "warning");
  return {
    profile,
    canPublish: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
