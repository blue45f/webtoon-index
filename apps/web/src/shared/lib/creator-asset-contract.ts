export const CREATOR_ASSET_LICENSES = [
  {
    id: "toonspectrum-standard",
    label: "ToonSpectrum 표준 사용권",
    shortLabel: "표준 사용권",
    attributionRequired: false,
    commercialUse: true,
    url: null,
    description: "ToonSpectrum에서 완성 작품의 일부로 편집·사용할 수 있고, 원본 에셋 자체의 재판매는 허용하지 않습니다.",
  },
  {
    id: "cc0-1.0",
    label: "CC0 1.0",
    shortLabel: "CC0",
    attributionRequired: false,
    commercialUse: true,
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    description: "저작자가 허용한 범위에서 출처 표시 없이 상업·비상업 용도로 사용할 수 있습니다.",
  },
  {
    id: "cc-by-4.0",
    label: "CC BY 4.0",
    shortLabel: "CC BY",
    attributionRequired: true,
    commercialUse: true,
    url: "https://creativecommons.org/licenses/by/4.0/",
    description: "저작자와 사용권을 표시하면 상업·비상업 용도로 사용할 수 있습니다.",
  },
  {
    id: "cc-by-nc-4.0",
    label: "CC BY-NC 4.0",
    shortLabel: "CC BY-NC",
    attributionRequired: true,
    commercialUse: false,
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    description: "저작자와 사용권을 표시한 비상업적 용도로만 사용할 수 있습니다.",
  },
] as const;

export type CreatorAssetLicenseId = (typeof CREATOR_ASSET_LICENSES)[number]["id"];
export type CreatorAssetCatalogSort = "newest" | "popular" | "name";
export type CreatorAssetModerationStatus = "published" | "under_review" | "rejected";
export type CreatorAssetReportReason = "copyright" | "unsafe" | "spam" | "misleading" | "other";

export const CREATOR_ASSET_REPORT_REASONS: ReadonlyArray<{
  id: CreatorAssetReportReason;
  label: string;
}> = [
  { id: "copyright", label: "저작권 또는 사용권 문제" },
  { id: "unsafe", label: "유해하거나 부적절한 콘텐츠" },
  { id: "spam", label: "스팸 또는 반복 게시" },
  { id: "misleading", label: "설명·태그·사용권이 실제와 다름" },
  { id: "other", label: "기타" },
];

const LICENSE_IDS = new Set<string>(CREATOR_ASSET_LICENSES.map((license) => license.id));
const CATALOG_SORTS = new Set<CreatorAssetCatalogSort>(["newest", "popular", "name"]);
const REPORT_REASONS = new Set<CreatorAssetReportReason>(CREATOR_ASSET_REPORT_REASONS.map((reason) => reason.id));

export const CREATOR_ASSET_TAG_LIMIT = 8;
export const CREATOR_ASSET_TAG_LENGTH = 24;
/**
 * Preview data is still embedded in JSON, so page sizes are a production response-body boundary.
 * Twenty worst-case 180k-character previews plus bounded metadata stay below the 4.5MB Vercel
 * Function response limit with a separate 4.0MB application ceiling.
 */
export const CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE = 20;
export const CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE = 20;
export const CREATOR_ASSET_LEGACY_FULL_MAX_PAGE_SIZE = 1;
export const CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS = 180_000;
export const CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES = 4_000_000;

export function creatorAssetSerializedResponseBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") return 0;
  return new TextEncoder().encode(serialized).byteLength;
}

/**
 * Final, platform-facing guard. Per-field validation remains mandatory because this only bounds
 * transport size; it does not make untrusted or legacy database content safe to render.
 */
export function assertCreatorAssetListResponseBudget(value: unknown): void {
  if (creatorAssetSerializedResponseBytes(value) > CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES) {
    throw new Error("공유 에셋 목록 응답이 안전한 전송 크기를 초과했습니다.");
  }
}

export function isCreatorAssetLicenseId(value: unknown): value is CreatorAssetLicenseId {
  return typeof value === "string" && LICENSE_IDS.has(value);
}

export function creatorAssetLicenseOf(value: unknown) {
  const id = isCreatorAssetLicenseId(value) ? value : "toonspectrum-standard";
  return CREATOR_ASSET_LICENSES.find((license) => license.id === id) ?? CREATOR_ASSET_LICENSES[0];
}

export function parseCreatorAssetCatalogSort(value: unknown): CreatorAssetCatalogSort {
  return CATALOG_SORTS.has(value as CreatorAssetCatalogSort)
    ? (value as CreatorAssetCatalogSort)
    : "newest";
}

export function isCreatorAssetReportReason(value: unknown): value is CreatorAssetReportReason {
  return REPORT_REASONS.has(value as CreatorAssetReportReason);
}

export function normalizeCreatorAssetTags(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,#]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of source) {
    const tag = String(raw ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CREATOR_ASSET_TAG_LENGTH);
    const key = tag.toLocaleLowerCase("ko");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= CREATOR_ASSET_TAG_LIMIT) break;
  }
  return tags;
}
