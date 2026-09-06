/** Tiny, DOM-free profile model shared by publish-package settings and the lazy review PDF renderer. */

export const STUDIO_REVIEW_PDF_PROFILE_IDS = [
  "image-only",
  "editorial",
  "approval",
  "production-full",
] as const;

export type StudioReviewPdfProfileId = (typeof STUDIO_REVIEW_PDF_PROFILE_IDS)[number];

export interface StudioReviewPdfFields {
  pageNumber: boolean;
  pageTitle: boolean;
  pageNotes: boolean;
  reviewStatus: boolean;
  reviewAssignee: boolean;
  reviewNotes: boolean;
  reviewUpdatedAt: boolean;
  panelMetadata: boolean;
  panelCaptions: boolean;
  dialogue: boolean;
}

export interface StudioReviewPdfProfile {
  id: StudioReviewPdfProfileId;
  label: string;
  description: string;
  /** 모든 프로필은 review.pdf 내부 전용이다. 공개 manifest 투영 금지의 명시적 계약. */
  internalOnly: true;
  fields: Readonly<StudioReviewPdfFields>;
}

const IMAGE_ONLY_FIELDS: StudioReviewPdfFields = {
  pageNumber: false,
  pageTitle: false,
  pageNotes: false,
  reviewStatus: false,
  reviewAssignee: false,
  reviewNotes: false,
  reviewUpdatedAt: false,
  panelMetadata: false,
  panelCaptions: false,
  dialogue: false,
};

export const STUDIO_REVIEW_PDF_PROFILES: Readonly<
  Record<StudioReviewPdfProfileId, StudioReviewPdfProfile>
> = {
  "image-only": {
    id: "image-only",
    label: "이미지만 · 기존 방식",
    description: "페이지 이미지만 담습니다. 기존 검수 PDF와 같은 구성입니다.",
    internalOnly: true,
    fields: IMAGE_ONLY_FIELDS,
  },
  editorial: {
    id: "editorial",
    label: "편집 교정",
    description: "페이지 번호·제목·콘티 메모와 컷 캡션·대사를 함께 봅니다.",
    internalOnly: true,
    fields: {
      ...IMAGE_ONLY_FIELDS,
      pageNumber: true,
      pageTitle: true,
      pageNotes: true,
      panelMetadata: true,
      panelCaptions: true,
      dialogue: true,
    },
  },
  approval: {
    id: "approval",
    label: "승인 회람",
    description: "페이지 정보와 검토 상태·담당자·검토 메모·갱신 시각을 표시합니다.",
    internalOnly: true,
    fields: {
      ...IMAGE_ONLY_FIELDS,
      pageNumber: true,
      pageTitle: true,
      pageNotes: true,
      reviewStatus: true,
      reviewAssignee: true,
      reviewNotes: true,
      reviewUpdatedAt: true,
    },
  },
  "production-full": {
    id: "production-full",
    label: "제작 전체",
    description: "승인 정보, 콘티 메모, 컷 태그·캡션과 대사를 모두 표시합니다.",
    internalOnly: true,
    fields: {
      pageNumber: true,
      pageTitle: true,
      pageNotes: true,
      reviewStatus: true,
      reviewAssignee: true,
      reviewNotes: true,
      reviewUpdatedAt: true,
      panelMetadata: true,
      panelCaptions: true,
      dialogue: true,
    },
  },
};

for (const profile of Object.values(STUDIO_REVIEW_PDF_PROFILES)) {
  Object.freeze(profile.fields);
  Object.freeze(profile);
}
Object.freeze(STUDIO_REVIEW_PDF_PROFILES);

const PROFILE_ALIASES: Readonly<Record<string, StudioReviewPdfProfileId>> = {
  "image-only": "image-only",
  image: "image-only",
  legacy: "image-only",
  default: "image-only",
  editorial: "editorial",
  proof: "editorial",
  approval: "approval",
  review: "approval",
  internal: "approval",
  "production-full": "production-full",
  production: "production-full",
  full: "production-full",
};

export function normalizeStudioReviewPdfProfileId(value: unknown): StudioReviewPdfProfileId {
  if (typeof value !== "string") return "image-only";
  return PROFILE_ALIASES[value.trim().toLowerCase()] ?? "image-only";
}

export function getStudioReviewPdfProfile(value: unknown): StudioReviewPdfProfile {
  return STUDIO_REVIEW_PDF_PROFILES[normalizeStudioReviewPdfProfileId(value)];
}
