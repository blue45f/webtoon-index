/**
 * Versioned creator self-check for publication rights and content declarations.
 *
 * This intentionally checks whether the creator supplied internally consistent answers. It does
 * not certify legality, guarantee platform acceptance, or freeze destination policies that can
 * change independently of ToonSpectrum.
 */

import {
  planStudioAiGenerationLabel,
  type StudioAiGenerationLabelPlan,
} from "./studio-ai-generation-label";

export const STUDIO_PUBLISH_COMPLIANCE_VERSION = 1 as const;

export const STUDIO_PUBLISH_COMPLIANCE_DESTINATIONS = ["generic", "webtoon", "tapas"] as const;
export type StudioPublishComplianceDestination =
  (typeof STUDIO_PUBLISH_COMPLIANCE_DESTINATIONS)[number];

export const STUDIO_PUBLISH_AUDIENCE_RATINGS = ["all", "teen", "mature"] as const;
export type StudioPublishAudienceRating = (typeof STUDIO_PUBLISH_AUDIENCE_RATINGS)[number];

export type StudioPublishComplianceAiUsage = "none" | "assisted" | "generated";
export type StudioPublishComplianceSeverity = "error" | "warning";

/** `null` means the creator has not explicitly answered the flag yet. */
export interface StudioPublishContentFlags {
  sexualContent: boolean | null;
  violence: boolean | null;
  strongLanguage: boolean | null;
}

export interface StudioPublishThirdPartyDeclaration {
  /** `null` is unanswered, `false` is an explicit declaration that no third-party material is used. */
  used: boolean | null;
  licensesConfirmed: boolean;
  attributionNotes: string;
}

export interface StudioPublishComplianceChecklist {
  version: typeof STUDIO_PUBLISH_COMPLIANCE_VERSION;
  audienceRating: StudioPublishAudienceRating | null;
  contentFlags: StudioPublishContentFlags;
  ownershipRightsConfirmed: boolean;
  referenceRightsConfirmed: boolean;
  thirdParty: StudioPublishThirdPartyDeclaration;
  aiDisclosureConfirmed: boolean;
  policyReviewConfirmed: boolean;
}

export type StudioPublishComplianceIssueCode =
  | "AUDIENCE_RATING_REQUIRED"
  | "CONTENT_FLAG_ANSWER_REQUIRED"
  | "AUDIENCE_RATING_CONTENT_REVIEW_REQUIRED"
  | "OWNERSHIP_RIGHTS_UNCONFIRMED"
  | "REFERENCE_RIGHTS_UNCONFIRMED"
  | "THIRD_PARTY_USE_ANSWER_REQUIRED"
  | "THIRD_PARTY_LICENSES_UNCONFIRMED"
  | "THIRD_PARTY_ATTRIBUTION_MISSING"
  | "THIRD_PARTY_DECLARATION_INCONSISTENT"
  | "AI_DISCLOSURE_UNCONFIRMED"
  | "AI_RESULT_LABEL_REQUIRED"
  | "AI_RESULT_LABEL_ADVISED"
  | "POLICY_REVIEW_UNCONFIRMED"
  | "DESTINATION_MATURE_REVIEW_REQUIRED"
  | "DESTINATION_CONTENT_REVIEW_REQUIRED"
  | "TAPAS_AI_GENERATED_CONTENT_PROHIBITED";

export interface StudioPublishComplianceIssue {
  code: StudioPublishComplianceIssueCode;
  severity: StudioPublishComplianceSeverity;
  message: string;
  /** Dot path into StudioPublishComplianceChecklist, suitable for focusing a form control. */
  path?: string;
}

export interface StudioPublishComplianceValidationOptions {
  aiUsage?: StudioPublishComplianceAiUsage;
  /**
   * 배포 대상 로케일(BCP-47). AI 표기 의무는 관할마다 다르므로 studio-ai-generation-label 로
   * 그대로 넘긴다. 생략하면 그 모듈의 기본 로케일이 쓰인다.
   */
  locale?: string;
  /**
   * Opt in only when the caller is not already running studio-publish-preflight. That preflight
   * owns the same current Tapas AI-generation rule, so the default avoids duplicate issues.
   */
  includeTapasAiPolicy?: boolean;
}

export interface StudioPublishComplianceResult {
  destination: StudioPublishComplianceDestination;
  checklist: StudioPublishComplianceChecklist;
  /** Means the self-check has no blocking omissions; it is not a legal or platform certification. */
  readyForDestinationReview: boolean;
  /**
   * 생성형 AI 표기 판정. 표기 문구·근거 조문·워터마크 사양이 여기 들어 있으므로, 패널은 경고
   * 문구를 다시 조립하지 말고 이 값을 그대로 읽는다.
   */
  aiLabel: StudioAiGenerationLabelPlan;
  errors: readonly StudioPublishComplianceIssue[];
  warnings: readonly StudioPublishComplianceIssue[];
  issues: readonly StudioPublishComplianceIssue[];
  disclaimer: typeof STUDIO_PUBLISH_COMPLIANCE_DISCLAIMER;
}

export const STUDIO_PUBLISH_COMPLIANCE_MAX_ATTRIBUTION_LENGTH = 4_000;

export const STUDIO_PUBLISH_COMPLIANCE_DISCLAIMER =
  "이 체크리스트는 창작자의 자체 확인을 돕는 도구이며 법률 자문, 권리 인증 또는 플랫폼 승인 보장이 아닙니다. 게시 전 대상 플랫폼의 최신 정책과 필요한 권리 문서를 직접 확인하세요." as const;

export const DEFAULT_STUDIO_PUBLISH_COMPLIANCE: StudioPublishComplianceChecklist = {
  version: STUDIO_PUBLISH_COMPLIANCE_VERSION,
  audienceRating: null,
  contentFlags: {
    sexualContent: null,
    violence: null,
    strongLanguage: null,
  },
  ownershipRightsConfirmed: false,
  referenceRightsConfirmed: false,
  thirdParty: {
    used: null,
    licensesConfirmed: false,
    attributionNotes: "",
  },
  aiDisclosureConfirmed: false,
  policyReviewConfirmed: false,
};

const DESTINATION_LABELS: Record<StudioPublishComplianceDestination, string> = {
  generic: "선택한 게시처",
  webtoon: "WEBTOON",
  tapas: "Tapas",
};

const FLAG_LABELS: Record<keyof StudioPublishContentFlags, string> = {
  sexualContent: "성적 표현",
  violence: "폭력 표현",
  strongLanguage: "강한 언어 표현",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return record[key];
  }
  return undefined;
}

function normalizeAudienceRating(value: unknown): StudioPublishAudienceRating | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["all", "general", "everyone", "전체", "전체이용가"].includes(normalized)) return "all";
  if (["teen", "teens", "청소년", "12", "15"].includes(normalized)) return "teen";
  if (["mature", "adult", "성인", "18", "18+"].includes(normalized)) return "mature";
  return null;
}

function normalizeExplicitAnswer(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "present", "used", "있음", "예"].includes(normalized)) return true;
  if (["false", "no", "n", "none", "not-used", "없음", "아니요"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeConfirmation(value: unknown): boolean {
  return normalizeExplicitAnswer(value) === true;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cloneDefaultStudioPublishCompliance(): StudioPublishComplianceChecklist {
  return {
    ...DEFAULT_STUDIO_PUBLISH_COMPLIANCE,
    contentFlags: { ...DEFAULT_STUDIO_PUBLISH_COMPLIANCE.contentFlags },
    thirdParty: { ...DEFAULT_STUDIO_PUBLISH_COMPLIANCE.thirdParty },
  };
}

/**
 * Accepts v1 and unversioned legacy records. Legacy aliases are intentionally conservative:
 * a broad old `rightsConfirmed` answer can confirm ownership, but never silently confirms the
 * separate reference or third-party-license declarations.
 */
export function normalizeStudioPublishCompliance(value: unknown): StudioPublishComplianceChecklist {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return cloneDefaultStudioPublishCompliance();
    }
  }
  if (!isRecord(decoded)) return cloneDefaultStudioPublishCompliance();

  const contentFlags = isRecord(decoded.contentFlags) ? decoded.contentFlags : decoded;
  const thirdParty = isRecord(decoded.thirdParty) ? decoded.thirdParty : decoded;

  return {
    version: STUDIO_PUBLISH_COMPLIANCE_VERSION,
    audienceRating: normalizeAudienceRating(
      firstDefined(decoded, ["audienceRating", "rating", "audience"])
    ),
    contentFlags: {
      sexualContent: normalizeExplicitAnswer(
        firstDefined(contentFlags, ["sexualContent", "sexual", "hasSexualContent"])
      ),
      violence: normalizeExplicitAnswer(
        firstDefined(contentFlags, ["violence", "violentContent", "hasViolence"])
      ),
      strongLanguage: normalizeExplicitAnswer(
        firstDefined(contentFlags, ["strongLanguage", "language", "hasStrongLanguage"])
      ),
    },
    ownershipRightsConfirmed: normalizeConfirmation(
      firstDefined(decoded, ["ownershipRightsConfirmed", "ownershipConfirmed", "rightsConfirmed"])
    ),
    referenceRightsConfirmed: normalizeConfirmation(
      firstDefined(decoded, ["referenceRightsConfirmed", "referencesConfirmed", "referenceRights"])
    ),
    thirdParty: {
      used: normalizeExplicitAnswer(
        firstDefined(thirdParty, ["used", "thirdPartyUsed", "usesThirdPartyContent"])
      ),
      licensesConfirmed: normalizeConfirmation(
        firstDefined(thirdParty, [
          "licensesConfirmed",
          "thirdPartyLicensesConfirmed",
          "licenseConfirmed",
        ])
      ),
      attributionNotes: normalizeText(
        firstDefined(thirdParty, ["attributionNotes", "attribution", "licenseNotes"]),
        STUDIO_PUBLISH_COMPLIANCE_MAX_ATTRIBUTION_LENGTH
      ),
    },
    aiDisclosureConfirmed: normalizeConfirmation(
      firstDefined(decoded, ["aiDisclosureConfirmed", "aiDisclosure", "aiDisclosed"])
    ),
    policyReviewConfirmed: normalizeConfirmation(
      firstDefined(decoded, ["policyReviewConfirmed", "policyReviewed", "reviewedPolicy"])
    ),
  };
}

/** Serializes only the normalized v1 shape, dropping unknown and legacy fields. */
export function serializeStudioPublishCompliance(value: unknown): string {
  return JSON.stringify(normalizeStudioPublishCompliance(value));
}

function makeIssue(
  severity: StudioPublishComplianceSeverity,
  code: StudioPublishComplianceIssueCode,
  message: string,
  path?: string
): StudioPublishComplianceIssue {
  return path ? { code, severity, message, path } : { code, severity, message };
}

function normalizeDestination(value: unknown): StudioPublishComplianceDestination {
  return value === "webtoon" || value === "tapas" ? value : "generic";
}

function normalizeAiUsage(value: unknown): StudioPublishComplianceAiUsage {
  return value === "assisted" || value === "generated" ? value : "none";
}

/**
 * Checks completeness and internal consistency without claiming legal compliance.
 *
 * Destination-specific warnings deliberately ask for a current manual policy review instead of
 * encoding mutable rating thresholds. The only opt-in hard policy is Tapas's current generated-AI
 * prohibition, which is disabled by default because studio-publish-preflight already reports it.
 *
 * The AI result-label warnings come from studio-ai-generation-label and stay warnings on purpose:
 * only the creator can place text on the artwork, so blocking on a condition this repo cannot
 * resolve would produce a gate nobody can clear.
 */
export function validateStudioPublishCompliance(
  value: unknown,
  destination: StudioPublishComplianceDestination = "generic",
  options: StudioPublishComplianceValidationOptions = {}
): StudioPublishComplianceResult {
  const checklist = normalizeStudioPublishCompliance(value);
  const normalizedDestination = normalizeDestination(destination);
  const destinationLabel = DESTINATION_LABELS[normalizedDestination];
  const aiUsage = normalizeAiUsage(options.aiUsage);
  const issues: StudioPublishComplianceIssue[] = [];

  if (checklist.audienceRating === null) {
    issues.push(
      makeIssue(
        "error",
        "AUDIENCE_RATING_REQUIRED",
        "전체·청소년·성인 중 작품의 예상 독자 등급을 직접 선택해 주세요.",
        "audienceRating"
      )
    );
  }

  const answeredFlags = Object.entries(checklist.contentFlags) as Array<
    [keyof StudioPublishContentFlags, boolean | null]
  >;
  for (const [flag, answer] of answeredFlags) {
    if (answer !== null) continue;
    issues.push(
      makeIssue(
        "error",
        "CONTENT_FLAG_ANSWER_REQUIRED",
        `${FLAG_LABELS[flag]} 포함 여부를 직접 확인해 주세요.`,
        `contentFlags.${flag}`
      )
    );
  }

  const presentFlags = answeredFlags.filter(([, answer]) => answer === true);
  if (checklist.audienceRating === "all" && presentFlags.length > 0) {
    issues.push(
      makeIssue(
        "warning",
        "AUDIENCE_RATING_CONTENT_REVIEW_REQUIRED",
        "전체 이용가로 표시했지만 민감 표현 플래그가 있습니다. 표현 강도와 독자 등급의 일관성을 다시 확인해 주세요.",
        "audienceRating"
      )
    );
  }

  if (!checklist.ownershipRightsConfirmed) {
    issues.push(
      makeIssue(
        "error",
        "OWNERSHIP_RIGHTS_UNCONFIRMED",
        "게시할 원본 콘텐츠를 소유하거나 게시할 권한이 있음을 확인해 주세요.",
        "ownershipRightsConfirmed"
      )
    );
  }

  if (!checklist.referenceRightsConfirmed) {
    issues.push(
      makeIssue(
        "error",
        "REFERENCE_RIGHTS_UNCONFIRMED",
        "사용한 참고 자료와 원본에 필요한 이용 권리가 있음을 확인해 주세요.",
        "referenceRightsConfirmed"
      )
    );
  }

  if (checklist.thirdParty.used === null) {
    issues.push(
      makeIssue(
        "error",
        "THIRD_PARTY_USE_ANSWER_REQUIRED",
        "폰트·사진·소재 등 제3자 콘텐츠 사용 여부를 직접 선택해 주세요.",
        "thirdParty.used"
      )
    );
  } else if (checklist.thirdParty.used) {
    if (!checklist.thirdParty.licensesConfirmed) {
      issues.push(
        makeIssue(
          "error",
          "THIRD_PARTY_LICENSES_UNCONFIRMED",
          "사용한 제3자 콘텐츠의 게시·상업 이용 범위와 라이선스를 확인해 주세요.",
          "thirdParty.licensesConfirmed"
        )
      );
    }
    if (!checklist.thirdParty.attributionNotes) {
      issues.push(
        makeIssue(
          "warning",
          "THIRD_PARTY_ATTRIBUTION_MISSING",
          "사용한 제3자 콘텐츠의 출처, 라이선스 및 필요한 저작자 표시를 기록해 두세요.",
          "thirdParty.attributionNotes"
        )
      );
    }
  } else if (checklist.thirdParty.licensesConfirmed || checklist.thirdParty.attributionNotes) {
    issues.push(
      makeIssue(
        "warning",
        "THIRD_PARTY_DECLARATION_INCONSISTENT",
        "제3자 콘텐츠를 사용하지 않았다고 답했지만 라이선스 확인 또는 출처 메모가 남아 있습니다.",
        "thirdParty"
      )
    );
  }

  if (aiUsage !== "none" && !checklist.aiDisclosureConfirmed) {
    issues.push(
      makeIssue(
        "error",
        "AI_DISCLOSURE_UNCONFIRMED",
        "AI 보조 또는 생성 사용 내역이 있으므로 게시처에 필요한 고지를 확인해 주세요.",
        "aiDisclosureConfirmed"
      )
    );
  }

  /*
   * 위 오류는 "고지했는가"만 묻는다. 아래 경고는 "어디에 고지했는가"를 묻는다 — 내보내기는 고지
   * 문구를 패키지 안 별도 JSON에만 남기므로, 이미지 한 장만 전달받은 독자는 표기를 보지 못한다.
   * 체크박스를 하나 더 만들지 않고 경고로 두는 이유는, 이 저장소가 픽셀을 대신 바꿔 줄 수 없어
   * 창작자만 해소할 수 있는 항목이기 때문이다. 해소할 수 없는 조건으로 게시를 막지는 않는다.
   */
  const aiLabel = planStudioAiGenerationLabel({ usage: aiUsage, locale: options.locale });
  if (aiLabel.obligation === "required-on-result") {
    issues.push(
      makeIssue(
        "warning",
        "AI_RESULT_LABEL_REQUIRED",
        `${aiLabel.rationale} 내보내기는 이 문구를 패키지 안 별도 JSON에만 기록하므로, 작품 이미지에 「${aiLabel.labelText}」를 직접 넣어 주세요.`,
        "aiDisclosureConfirmed"
      )
    );
  } else if (aiLabel.obligation === "advisory") {
    issues.push(
      makeIssue(
        "warning",
        "AI_RESULT_LABEL_ADVISED",
        `${aiLabel.rationale} 표기하려면 작품 이미지에 「${aiLabel.labelText}」를 직접 넣어 주세요.`,
        "aiDisclosureConfirmed"
      )
    );
  }

  if (!checklist.policyReviewConfirmed) {
    issues.push(
      makeIssue(
        normalizedDestination === "generic" ? "warning" : "error",
        "POLICY_REVIEW_UNCONFIRMED",
        normalizedDestination === "generic"
          ? "실제 게시처를 정한 뒤 최신 콘텐츠·권리·AI 정책을 직접 검토해 주세요."
          : `${destinationLabel}의 최신 콘텐츠·권리·AI 정책을 직접 검토했는지 확인해 주세요.`,
        "policyReviewConfirmed"
      )
    );
  }

  if (normalizedDestination !== "generic" && checklist.audienceRating === "mature") {
    issues.push(
      makeIssue(
        "warning",
        "DESTINATION_MATURE_REVIEW_REQUIRED",
        `${destinationLabel}의 현재 성인·민감 콘텐츠 분류, 노출 및 게시 가능 범위를 다시 확인해 주세요.`,
        "audienceRating"
      )
    );
  }

  if (normalizedDestination !== "generic") {
    for (const [flag] of presentFlags) {
      issues.push(
        makeIssue(
          "warning",
          "DESTINATION_CONTENT_REVIEW_REQUIRED",
          `${destinationLabel}의 현재 ${FLAG_LABELS[flag]} 기준과 작품의 표시 등급이 맞는지 확인해 주세요.`,
          `contentFlags.${flag}`
        )
      );
    }
  }

  if (
    options.includeTapasAiPolicy === true &&
    normalizedDestination === "tapas" &&
    aiUsage === "generated"
  ) {
    issues.push(
      makeIssue(
        "error",
        "TAPAS_AI_GENERATED_CONTENT_PROHIBITED",
        "현재 Tapas 정책상 AI 생성 콘텐츠는 게시할 수 없습니다. 정책 변경 여부를 게시 전에 다시 확인하세요.",
        "aiDisclosureConfirmed"
      )
    );
  }

  const errors = issues.filter((candidate) => candidate.severity === "error");
  const warnings = issues.filter((candidate) => candidate.severity === "warning");
  return {
    destination: normalizedDestination,
    checklist,
    readyForDestinationReview: errors.length === 0,
    aiLabel,
    errors,
    warnings,
    issues,
    disclaimer: STUDIO_PUBLISH_COMPLIANCE_DISCLAIMER,
  };
}
