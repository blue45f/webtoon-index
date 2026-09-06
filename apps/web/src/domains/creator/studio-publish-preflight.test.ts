import { describe, expect, it } from "vitest";

import {
  normalizeStudioPublishPackSettings,
  type StudioPublishPreflightInput,
  validateStudioPublishPreflight,
} from "./studio-publish-preflight";

describe("normalizeStudioPublishPackSettings", () => {
  it("normalizes persisted settings without letting malformed values escape", () => {
    expect(
      normalizeStudioPublishPackSettings({
        profile: "tapas",
        aiUsage: "assisted",
        disclosure: "  사람이 검수함  ",
        compliance: { audienceRating: "teen", ownershipRightsConfirmed: true },
      })
    ).toMatchObject({
      profile: "tapas",
      aiUsage: "assisted",
      disclosure: "사람이 검수함",
      compliance: { audienceRating: "teen", ownershipRightsConfirmed: true },
    });
    expect(
      normalizeStudioPublishPackSettings({ profile: "unknown", aiUsage: "wrong", disclosure: 42 })
    ).toMatchObject({
      profile: "generic",
      aiUsage: "none",
      disclosure: "",
      compliance: { audienceRating: null, ownershipRightsConfirmed: false },
    });
  });
});

function makeWork(overrides: Partial<StudioPublishPreflightInput> = {}): StudioPublishPreflightInput {
  return {
    title: "오늘의 툰",
    tags: ["일상", "코미디"],
    pages: [
      {
        id: "page-1",
        images: [
          {
            id: "image-1",
            fileName: "page-1.webp",
            mimeType: "image/webp",
            width: 720,
            height: 1280,
            byteSize: 128_000,
          },
        ],
      },
    ],
    aiContent: { usage: "none" },
    ...overrides,
  };
}

function codes(result: ReturnType<typeof validateStudioPublishPreflight>) {
  return result.issues.map((candidate) => candidate.code);
}

describe("validateStudioPublishPreflight", () => {
  it("완전한 일반 게시 패키지를 통과시킨다", () => {
    const result = validateStudioPublishPreflight(makeWork());

    expect(result).toMatchObject({ profile: "generic", canPublish: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("제목과 페이지가 없으면 게시를 차단하고 태그 누락은 경고한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({ title: "  ", tags: ["", "  #  "], pages: [] })
    );

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((candidate) => candidate.code)).toEqual([
      "TITLE_REQUIRED",
      "PAGES_REQUIRED",
    ]);
    expect(result.warnings.map((candidate) => candidate.code)).toEqual(["TAGS_MISSING"]);
  });

  it("해결되지 않은 편집 댓글은 게시를 막지 않되 명시적으로 경고한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({ editorial: { openCommentThreads: 3 } })
    );

    expect(result.canPublish).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "EDITORIAL_COMMENTS_OPEN",
        path: "editorial.openCommentThreads",
      }),
    ]);
  });

  it("빈 페이지와 중복된 페이지·이미지 식별자를 구조 오류로 보고한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        pages: [
          { id: "same", images: [] },
          {
            id: "same",
            images: [
              { id: "image", mimeType: "image/png", width: 720, height: 1280, byteSize: 1 },
              { id: "image", mimeType: "image/png", width: 720, height: 1280, byteSize: 1 },
            ],
          },
        ],
      })
    );

    expect(result.canPublish).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["PAGE_WITHOUT_IMAGE", "PAGE_ID_DUPLICATE", "IMAGE_ID_DUPLICATE"])
    );
  });

  it("페이지 검토 상태를 게시 게이트에 연결하되 레거시 미지정 값은 추측하지 않는다", () => {
    const basePage = makeWork().pages[0];
    const requested = validateStudioPublishPreflight(
      makeWork({ pages: [{ ...basePage, reviewStatus: "changes-requested", reviewLocked: false }] })
    );
    expect(requested.canPublish).toBe(false);
    expect(codes(requested)).toContain("PAGE_CHANGES_REQUESTED");

    const draft = validateStudioPublishPreflight(
      makeWork({ pages: [{ ...basePage, reviewStatus: "needs-review", reviewLocked: false }] })
    );
    expect(draft.canPublish).toBe(true);
    expect(codes(draft)).toContain("PAGE_NOT_APPROVED");

    const approvedUnlocked = validateStudioPublishPreflight(
      makeWork({ pages: [{ ...basePage, reviewStatus: "approved", reviewLocked: false }] })
    );
    expect(codes(approvedUnlocked)).toContain("APPROVED_PAGE_UNLOCKED");
    expect(validateStudioPublishPreflight(makeWork()).warnings).toEqual([]);
  });

  it("지원하지 않는 형식과 손상된 수치 메타데이터를 오류로 분류한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        pages: [
          {
            id: "page-1",
            images: [
              {
                id: "image-1",
                mimeType: "image/gif",
                width: Number.NaN,
                height: 0,
                byteSize: -1,
              },
            ],
          },
        ],
      })
    );

    expect(result.canPublish).toBe(false);
    expect(result.errors.map((candidate) => candidate.code)).toEqual([
      "IMAGE_TYPE_UNSUPPORTED",
      "IMAGE_DIMENSIONS_INVALID",
      "IMAGE_BYTE_SIZE_INVALID",
    ]);
  });

  it("검증에 필요한 이미지 메타데이터가 빠지면 차단 대신 경고한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({ pages: [{ id: "page-1", images: [{ id: "image-1" }] }] }),
      "webtoon"
    );

    expect(result.canPublish).toBe(true);
    expect(result.warnings.map((candidate) => candidate.code)).toEqual([
      "IMAGE_TYPE_MISSING",
      "IMAGE_DIMENSIONS_MISSING",
      "IMAGE_BYTE_SIZE_MISSING",
    ]);
  });

  it("태그는 공백·해시·대소문자를 정규화해 중복을 찾는다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({ tags: ["#Romance", " romance ", "판타지"] })
    );

    expect(result.canPublish).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "TAG_DUPLICATE", path: "tags[1]" }),
    ]);
  });

  it.each(["webtoon", "tapas"] as const)(
    "%s 세로 스크롤 프로필은 가로 이미지와 서로 다른 폭을 경고한다",
    (profile) => {
      const work = makeWork({
        pages: [
          {
            id: "page-1",
            images: [
              { id: "image-1", mimeType: "image/png", width: 1280, height: 720, byteSize: 1 },
            ],
          },
          {
            id: "page-2",
            images: [
              { id: "image-2", mimeType: "image/png", width: 720, height: 1280, byteSize: 1 },
            ],
          },
        ],
      });

      const result = validateStudioPublishPreflight(work, profile);

      expect(result.canPublish).toBe(true);
      expect(codes(result)).toEqual(
        expect.arrayContaining(["VERTICAL_IMAGE_RECOMMENDED", "IMAGE_WIDTHS_INCONSISTENT"])
      );
    }
  );

  it("일반 프로필은 이미지 방향이나 폭 차이를 플랫폼 오류로 추정하지 않는다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        pages: [
          {
            id: "page-1",
            images: [
              { id: "image-1", mimeType: "image/png", width: 1200, height: 600, byteSize: 1 },
            ],
          },
          {
            id: "page-2",
            images: [
              { id: "image-2", mimeType: "image/png", width: 720, height: 1280, byteSize: 1 },
            ],
          },
        ],
      })
    );

    expect(result.canPublish).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("AI 사용 고지와 생성·수정 이력이 없으면 경고한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({ aiContent: { usage: "assisted" } }),
      "webtoon"
    );

    expect(result.canPublish).toBe(true);
    expect(result.warnings.map((candidate) => candidate.code)).toEqual([
      "AI_DISCLOSURE_MISSING",
      "AI_PROVENANCE_MISSING",
    ]);
  });

  it("AI 수정 이력이 있는데 사용하지 않음으로 선언하면 메타데이터 불일치로 차단한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        aiContent: {
          usage: "none",
          provenance: [{ action: "edited", provider: "example" }],
        },
      })
    );

    expect(result.canPublish).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["AI_METADATA_INCONSISTENT", "AI_DISCLOSURE_MISSING"])
    );
  });

  it("이미지의 AI 생성 표시와 작품 수준 선언이 다르면 차단한다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        pages: [
          {
            id: "page-1",
            images: [
              {
                id: "image-1",
                mimeType: "image/webp",
                width: 720,
                height: 1280,
                byteSize: 1,
                aiGenerated: true,
              },
            ],
          },
        ],
        aiContent: { usage: "none" },
      })
    );

    expect(result.canPublish).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "AI_METADATA_INCONSISTENT",
        "AI_DISCLOSURE_MISSING",
        "AI_PROVENANCE_MISSING",
      ])
    );
  });

  it("Tapas에서는 AI 생성 콘텐츠를 차단하지만 WEBTOON에서는 고지·이력이 있으면 통과시킨다", () => {
    const aiContent = {
      usage: "generated" as const,
      disclosure: "일부 배경 이미지를 생성형 AI로 제작했습니다.",
      provenance: [
        {
          assetId: "image-1",
          action: "generated" as const,
          provider: "example",
          model: "example-model",
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    };
    const work = makeWork({ aiContent });

    const tapas = validateStudioPublishPreflight(work, "tapas");
    const webtoon = validateStudioPublishPreflight(work, "webtoon");

    expect(tapas.canPublish).toBe(false);
    expect(tapas.errors).toEqual([
      expect.objectContaining({ code: "TAPAS_AI_GENERATED_CONTENT_PROHIBITED" }),
    ]);
    expect(webtoon.canPublish).toBe(true);
    expect(webtoon.errors).toEqual([]);
  });

  it("Tapas의 AI 보조 사용은 생성 콘텐츠로 확대 해석해 차단하지 않는다", () => {
    const result = validateStudioPublishPreflight(
      makeWork({
        aiContent: {
          usage: "assisted",
          disclosure: "번역 초안에 AI 보조를 사용하고 사람이 검수했습니다.",
          provenance: [{ action: "translated", provider: "example" }],
        },
      }),
      "tapas"
    );

    expect(result.canPublish).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
