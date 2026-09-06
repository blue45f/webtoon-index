import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_PUBLISH_COMPLIANCE,
  STUDIO_PUBLISH_COMPLIANCE_DISCLAIMER,
  STUDIO_PUBLISH_COMPLIANCE_MAX_ATTRIBUTION_LENGTH,
  normalizeStudioPublishCompliance,
  serializeStudioPublishCompliance,
  type StudioPublishComplianceChecklist,
  validateStudioPublishCompliance,
} from "./studio-publish-compliance";

function completeChecklist(
  overrides: Partial<StudioPublishComplianceChecklist> = {}
): StudioPublishComplianceChecklist {
  return {
    version: 1,
    audienceRating: "teen",
    contentFlags: {
      sexualContent: false,
      violence: false,
      strongLanguage: false,
    },
    ownershipRightsConfirmed: true,
    referenceRightsConfirmed: true,
    thirdParty: {
      used: false,
      licensesConfirmed: false,
      attributionNotes: "",
    },
    aiDisclosureConfirmed: false,
    policyReviewConfirmed: true,
    ...overrides,
  };
}

function issueCodes(result: ReturnType<typeof validateStudioPublishCompliance>) {
  return result.issues.map((issue) => issue.code);
}

describe("normalizeStudioPublishCompliance", () => {
  it("손상되거나 배열인 데이터는 확인되지 않은 독립 기본값으로 복원한다", () => {
    expect(normalizeStudioPublishCompliance("{not-json")).toEqual(
      DEFAULT_STUDIO_PUBLISH_COMPLIANCE
    );
    expect(normalizeStudioPublishCompliance([])).toEqual(DEFAULT_STUDIO_PUBLISH_COMPLIANCE);

    const first = normalizeStudioPublishCompliance(null);
    first.contentFlags.violence = true;
    expect(normalizeStudioPublishCompliance(null).contentFlags.violence).toBeNull();
  });

  it("현재 v1 값을 정규화하고 긴 출처 메모와 알 수 없는 답을 제한한다", () => {
    const normalized = normalizeStudioPublishCompliance({
      version: 1,
      audienceRating: " MATURE ",
      contentFlags: { sexualContent: "yes", violence: "no", strongLanguage: "unknown" },
      ownershipRightsConfirmed: 1,
      referenceRightsConfirmed: true,
      thirdParty: {
        used: "used",
        licensesConfirmed: "yes",
        attributionNotes: `  ${"가".repeat(STUDIO_PUBLISH_COMPLIANCE_MAX_ATTRIBUTION_LENGTH + 5)}  `,
      },
      aiDisclosureConfirmed: "true",
      policyReviewConfirmed: "yes",
      ignored: "drop me",
    });

    expect(normalized).toEqual({
      version: 1,
      audienceRating: "mature",
      contentFlags: { sexualContent: true, violence: false, strongLanguage: null },
      ownershipRightsConfirmed: true,
      referenceRightsConfirmed: true,
      thirdParty: {
        used: true,
        licensesConfirmed: true,
        attributionNotes: "가".repeat(STUDIO_PUBLISH_COMPLIANCE_MAX_ATTRIBUTION_LENGTH),
      },
      aiDisclosureConfirmed: true,
      policyReviewConfirmed: true,
    });
  });

  it("보수적으로 레거시 평면 필드를 마이그레이션한다", () => {
    expect(
      normalizeStudioPublishCompliance({
        rating: "전체이용가",
        sexual: "없음",
        violentContent: 1,
        language: false,
        rightsConfirmed: true,
        referencesConfirmed: "yes",
        thirdPartyUsed: true,
        thirdPartyLicensesConfirmed: true,
        attribution: "CC BY 소재 — 작가명 표시",
        aiDisclosed: true,
        reviewedPolicy: true,
      })
    ).toEqual({
      version: 1,
      audienceRating: "all",
      contentFlags: { sexualContent: false, violence: true, strongLanguage: false },
      ownershipRightsConfirmed: true,
      referenceRightsConfirmed: true,
      thirdParty: {
        used: true,
        licensesConfirmed: true,
        attributionNotes: "CC BY 소재 — 작가명 표시",
      },
      aiDisclosureConfirmed: true,
      policyReviewConfirmed: true,
    });
  });

  it("직렬화할 때 알 수 없는 필드와 버전을 버리고 v1 형태만 남긴다", () => {
    const serialized = serializeStudioPublishCompliance({
      version: 999,
      rating: "teen",
      sexualContent: false,
      violence: false,
      language: false,
      ownershipConfirmed: true,
      referencesConfirmed: true,
      thirdPartyUsed: false,
      aiDisclosureConfirmed: false,
      policyReviewed: true,
      unsafeExtra: "secret",
    });
    const decoded = JSON.parse(serialized) as Record<string, unknown>;

    expect(decoded.version).toBe(1);
    expect(decoded).not.toHaveProperty("unsafeExtra");
    expect(decoded).toEqual(completeChecklist());
  });
});

describe("validateStudioPublishCompliance", () => {
  it("완결된 일반 자가 점검은 수동 게시처 검토 단계로 진행할 수 있다", () => {
    const result = validateStudioPublishCompliance(completeChecklist());

    expect(result).toMatchObject({
      destination: "generic",
      readyForDestinationReview: true,
      errors: [],
      warnings: [],
      disclaimer: STUDIO_PUBLISH_COMPLIANCE_DISCLAIMER,
    });
    expect(result.disclaimer).toContain("법률 자문");
    expect(result.disclaimer).toContain("승인 보장");
  });

  it("기본값은 누락된 등급·민감표현·권리·제3자 사용 답을 모두 차단 이슈로 보존한다", () => {
    const result = validateStudioPublishCompliance(DEFAULT_STUDIO_PUBLISH_COMPLIANCE);

    expect(result.readyForDestinationReview).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual([
      "AUDIENCE_RATING_REQUIRED",
      "CONTENT_FLAG_ANSWER_REQUIRED",
      "CONTENT_FLAG_ANSWER_REQUIRED",
      "CONTENT_FLAG_ANSWER_REQUIRED",
      "OWNERSHIP_RIGHTS_UNCONFIRMED",
      "REFERENCE_RIGHTS_UNCONFIRMED",
      "THIRD_PARTY_USE_ANSWER_REQUIRED",
    ]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(["POLICY_REVIEW_UNCONFIRMED"]);
  });

  it("제3자 콘텐츠 사용 시 라이선스 미확인은 오류, 출처 메모 누락은 경고다", () => {
    const result = validateStudioPublishCompliance(
      completeChecklist({
        thirdParty: { used: true, licensesConfirmed: false, attributionNotes: "" },
      })
    );

    expect(result.readyForDestinationReview).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "THIRD_PARTY_LICENSES_UNCONFIRMED",
        path: "thirdParty.licensesConfirmed",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "THIRD_PARTY_ATTRIBUTION_MISSING",
        path: "thirdParty.attributionNotes",
      }),
    ]);
  });

  it("제3자 미사용 답과 남은 라이선스·출처 데이터의 불일치를 경고한다", () => {
    const result = validateStudioPublishCompliance(
      completeChecklist({
        thirdParty: {
          used: false,
          licensesConfirmed: true,
          attributionNotes: "이 메모는 사용 선언과 맞지 않음",
        },
      })
    );

    expect(result.readyForDestinationReview).toBe(true);
    expect(issueCodes(result)).toEqual(["THIRD_PARTY_DECLARATION_INCONSISTENT"]);
  });

  it("AI를 쓰지 않으면 고지 확인을 강요하지 않고, 보조·생성 사용 때만 요구한다", () => {
    const noAi = validateStudioPublishCompliance(completeChecklist(), "webtoon", {
      aiUsage: "none",
    });
    const assisted = validateStudioPublishCompliance(completeChecklist(), "webtoon", {
      aiUsage: "assisted",
    });

    expect(issueCodes(noAi)).not.toContain("AI_DISCLOSURE_UNCONFIRMED");
    expect(assisted.errors).toEqual([
      expect.objectContaining({ code: "AI_DISCLOSURE_UNCONFIRMED" }),
    ]);
  });

  it("WEBTOON·Tapas는 최신 정책 미확인을 차단하고 일반 프로필은 경고만 한다", () => {
    const checklist = completeChecklist({ policyReviewConfirmed: false });

    const generic = validateStudioPublishCompliance(checklist, "generic");
    const webtoon = validateStudioPublishCompliance(checklist, "webtoon");
    const tapas = validateStudioPublishCompliance(checklist, "tapas");

    expect(generic.errors).toEqual([]);
    expect(generic.warnings).toEqual([
      expect.objectContaining({ code: "POLICY_REVIEW_UNCONFIRMED", severity: "warning" }),
    ]);
    expect(webtoon.errors).toEqual([
      expect.objectContaining({ code: "POLICY_REVIEW_UNCONFIRMED", severity: "error" }),
    ]);
    expect(tapas.errors).toEqual([
      expect.objectContaining({ code: "POLICY_REVIEW_UNCONFIRMED", severity: "error" }),
    ]);
  });

  it("목적지별 성인 등급과 민감 표현은 고정 임계값 대신 최신 정책 수동 검토를 경고한다", () => {
    const result = validateStudioPublishCompliance(
      completeChecklist({
        audienceRating: "mature",
        contentFlags: { sexualContent: true, violence: true, strongLanguage: false },
      }),
      "webtoon"
    );

    expect(result.readyForDestinationReview).toBe(true);
    expect(issueCodes(result)).toEqual([
      "DESTINATION_MATURE_REVIEW_REQUIRED",
      "DESTINATION_CONTENT_REVIEW_REQUIRED",
      "DESTINATION_CONTENT_REVIEW_REQUIRED",
    ]);
    expect(result.warnings[0]?.message).toContain("WEBTOON");
  });

  it("전체 등급과 민감 표현의 불일치는 차단하지 않고 재검토를 경고한다", () => {
    const result = validateStudioPublishCompliance(
      completeChecklist({
        audienceRating: "all",
        contentFlags: { sexualContent: false, violence: true, strongLanguage: false },
      })
    );

    expect(result.readyForDestinationReview).toBe(true);
    expect(issueCodes(result)).toEqual(["AUDIENCE_RATING_CONTENT_REVIEW_REQUIRED"]);
  });

  it("Tapas AI 생성 금지는 opt-in일 때 generated에만 추가해 기존 사전검사와 중복되지 않는다", () => {
    const checklist = completeChecklist({ aiDisclosureConfirmed: true });

    const defaultResult = validateStudioPublishCompliance(checklist, "tapas", {
      aiUsage: "generated",
    });
    const assisted = validateStudioPublishCompliance(checklist, "tapas", {
      aiUsage: "assisted",
      includeTapasAiPolicy: true,
    });
    const generated = validateStudioPublishCompliance(checklist, "tapas", {
      aiUsage: "generated",
      includeTapasAiPolicy: true,
    });

    expect(issueCodes(defaultResult)).not.toContain("TAPAS_AI_GENERATED_CONTENT_PROHIBITED");
    expect(issueCodes(assisted)).not.toContain("TAPAS_AI_GENERATED_CONTENT_PROHIBITED");
    expect(generated.errors).toEqual([
      expect.objectContaining({ code: "TAPAS_AI_GENERATED_CONTENT_PROHIBITED" }),
    ]);
  });

  it("검사는 입력을 변경하지 않고 같은 입력에 같은 순서의 결과를 낸다", () => {
    const checklist = completeChecklist({
      audienceRating: "all",
      contentFlags: { sexualContent: true, violence: false, strongLanguage: true },
    });
    const before = structuredClone(checklist);

    const first = validateStudioPublishCompliance(checklist, "webtoon");
    const second = validateStudioPublishCompliance(checklist, "webtoon");

    expect(checklist).toEqual(before);
    expect(first).toEqual(second);
  });
});
