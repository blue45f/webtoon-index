import type { PlatformId, WorkType } from "../../../web/src/shared/lib/types";

export type CatalogSourceImplementation = "crawler" | "partner-required" | "manual";
export type CatalogSourceRisk = "low" | "medium" | "high";

export interface CatalogSourceMetadata {
  id: PlatformId;
  name: string;
  workTypes: WorkType[];
  implementation: CatalogSourceImplementation;
  risk: CatalogSourceRisk;
  defaultCadenceSeconds: number;
  capabilities: Array<"catalog" | "ranking" | "status" | "search" | "availability">;
  requiredReview: string[];
  notes: string;
}

export const CATALOG_SOURCE_REGISTRY: CatalogSourceMetadata[] = [
  {
    id: "naver-webtoon",
    name: "네이버웹툰",
    workTypes: ["webtoon"],
    implementation: "crawler",
    risk: "medium",
    defaultCadenceSeconds: 1800,
    capabilities: ["catalog", "ranking", "status", "availability"],
    requiredReview: ["robots", "terms", "rate-limit"],
    notes: "요일/완결 공개 목록과 작품 상세 신호를 정규화합니다.",
  },
  {
    id: "naver-series",
    name: "네이버 시리즈",
    workTypes: ["webnovel", "webtoon"],
    implementation: "crawler",
    risk: "medium",
    defaultCadenceSeconds: 3600,
    capabilities: ["catalog", "availability"],
    requiredReview: ["robots", "terms", "rate-limit"],
    notes: "장르 목록과 웹툰 원작 연결 보강에 사용합니다.",
  },
  {
    id: "kakao-webtoon",
    name: "카카오웹툰",
    workTypes: ["webtoon"],
    implementation: "crawler",
    risk: "medium",
    defaultCadenceSeconds: 1800,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["robots", "terms", "rate-limit"],
    notes: "공개 타임테이블 기반 웹툰 후보를 수집합니다.",
  },
  {
    id: "kakao-page",
    name: "카카오페이지",
    workTypes: ["webtoon", "webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 3600,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms", "age-gate"],
    notes: "운영 환경에서는 제휴/공식 피드 우선 소스입니다.",
  },
  {
    id: "ridi",
    name: "리디",
    workTypes: ["webtoon", "webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "랭킹/검색 API 또는 제휴 피드 확인 후 활성화합니다.",
  },
  {
    id: "munpia",
    name: "문피아",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "웹소설 중심 소스입니다. 공개 목록 수집 전 약관 확인이 필요합니다.",
  },
  {
    id: "joara",
    name: "조아라",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "웹소설 중심 소스입니다.",
  },
  {
    id: "novelpia",
    name: "노벨피아",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms", "age-gate"],
    notes: "성인/구독 경계가 있어 저장 필드 제한이 필요합니다.",
  },
  {
    id: "lezhin",
    name: "레진코믹스",
    workTypes: ["webtoon"],
    implementation: "crawler",
    risk: "medium",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["robots", "terms", "rate-limit", "age-gate"],
    notes: "성인 모드 없이 공개 랭킹/카탈로그 JSON에서 비성인 메타데이터를 정규화합니다.",
  },
  {
    id: "bomtoon",
    name: "봄툰",
    workTypes: ["webtoon"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms", "age-gate"],
    notes: "BL/성인 경계 검토가 필요합니다.",
  },
  {
    id: "toptoon",
    name: "탑툰",
    workTypes: ["webtoon"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms", "age-gate"],
    notes: "성인 경계와 저장 필드 검토가 필요합니다.",
  },
  {
    id: "postype",
    name: "포스타입",
    workTypes: ["webtoon", "webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "search", "availability"],
    requiredReview: ["partner-feed", "terms", "user-generated-content"],
    notes: "UGC 성격이 강해 개인정보/저작권 검토가 필요합니다.",
  },
  {
    id: "mrblue",
    name: "미스터블루",
    workTypes: ["webtoon", "webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "상업 플랫폼 제휴 피드 우선입니다.",
  },
  {
    id: "comico",
    name: "코미코",
    workTypes: ["webtoon"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["robots", "terms"],
    notes: "공개 목록 __NEXT_DATA__ 파싱. 한국 외 IP는 방화벽 차단되므로 KR egress에서만 수집됩니다.",
  },
  {
    id: "toomics",
    name: "투믹스",
    workTypes: ["webtoon"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms", "age-gate"],
    notes: "성인 경계와 저장 필드 검토가 필요합니다.",
  },
  {
    id: "bookcube",
    name: "북큐브",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "웹소설/전자책 경계를 분리해야 합니다.",
  },
  {
    id: "onestory",
    name: "원스토리",
    workTypes: ["webnovel", "webtoon"],
    implementation: "partner-required",
    risk: "high",
    defaultCadenceSeconds: 7200,
    capabilities: ["catalog", "ranking", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "앱/스토어 API 우회 없이 공식 제공 범위를 사용합니다.",
  },
  {
    id: "kyobo",
    name: "교보문고",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "medium",
    defaultCadenceSeconds: 86400,
    capabilities: ["catalog", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "전자책과 연재 웹소설 경계를 별도 모델로 분리합니다.",
  },
  {
    id: "yes24",
    name: "예스24",
    workTypes: ["webnovel"],
    implementation: "partner-required",
    risk: "medium",
    defaultCadenceSeconds: 86400,
    capabilities: ["catalog", "availability"],
    requiredReview: ["partner-feed", "terms"],
    notes: "전자책과 연재 웹소설 경계를 별도 모델로 분리합니다.",
  },
];

// 공개 카탈로그 크롤러가 구현된 소스(partner-required → crawler 승격). scripts/crawlers/<id>.mjs 와 일치.
const IMPLEMENTED_CRAWLERS = new Set<PlatformId>([
  "ridi", "kakao-page", "munpia", "joara", "postype", "mrblue", "bookcube", "onestory", "yes24",
  "novelpia", "bomtoon", "toptoon", "toomics", "kyobo", "comico",
]);
for (const source of CATALOG_SOURCE_REGISTRY) {
  if (IMPLEMENTED_CRAWLERS.has(source.id)) source.implementation = "crawler";
}

export function parseCatalogSourceIds(raw: string | undefined): PlatformId[] {
  const registryIds = new Set(CATALOG_SOURCE_REGISTRY.map((source) => source.id));
  const fallback: PlatformId[] = [
    "naver-webtoon", "naver-series", "kakao-webtoon", "lezhin",
    ...IMPLEMENTED_CRAWLERS,
  ];
  if (!raw?.trim()) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.includes("all")) return [...registryIds];
  return values.filter((value): value is PlatformId => registryIds.has(value as PlatformId));
}

export function buildCatalogSourcePlan(sourceIds: PlatformId[]) {
  const requested = new Set(sourceIds);
  const selected = CATALOG_SOURCE_REGISTRY.filter((source) => requested.has(source.id));
  const enabled = selected.filter((source) => source.implementation === "crawler");
  const pending = selected.filter((source) => source.implementation !== "crawler");

  return {
    requested: selected,
    enabled,
    pending,
    coverage: {
      domesticSources: CATALOG_SOURCE_REGISTRY.length,
      domesticWebtoonSources: CATALOG_SOURCE_REGISTRY.filter((source) => source.workTypes.includes("webtoon")).length,
      domesticWebnovelSources: CATALOG_SOURCE_REGISTRY.filter((source) => source.workTypes.includes("webnovel")).length,
      implementedSources: CATALOG_SOURCE_REGISTRY.filter((source) => source.implementation === "crawler").length,
      pendingSources: CATALOG_SOURCE_REGISTRY.filter((source) => source.implementation !== "crawler").length,
    },
  };
}
