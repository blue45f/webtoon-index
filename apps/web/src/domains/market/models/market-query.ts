import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceSort,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourceLicenseSchema,
  CreatorMarketplaceResourcePublisherQuerySchema,
  CreatorMarketplaceResourceSearchQuerySchema,
  CreatorMarketplaceResourceSortSchema,
  CreatorMarketplaceResourceTagQuerySchema,
} from "@/shared/lib/creator-marketplace-resource-contract";

export type MarketBrowseQueryParam =
  | "q"
  | "tag"
  | "kind"
  | "license"
  | "publisher"
  | "sort";
export type MarketBrowseQueryIssueCode = "duplicate" | "too-long" | "invalid";

export interface MarketBrowseQueryIssue {
  readonly param: MarketBrowseQueryParam;
  readonly code: MarketBrowseQueryIssueCode;
  readonly message: string;
}

export interface MarketBrowseQueryValues {
  readonly search?: string;
  readonly tag?: string;
  readonly kind?: CreatorMarketplaceResourceKind;
  readonly license?: CreatorMarketplaceResourceLicense;
  readonly publisher?: string;
  readonly sort?: CreatorMarketplaceResourceSort;
}

export interface ParsedMarketBrowseQuery {
  readonly values: MarketBrowseQueryValues;
  /** 첫 q 값은 잘못된 길이라도 편집할 수 있도록 입력창에 그대로 돌려준다. */
  readonly searchDraft: string;
  readonly issues: readonly MarketBrowseQueryIssue[];
}

const LABEL_BY_PARAM: Record<MarketBrowseQueryParam, string> = {
  q: "검색어",
  tag: "태그",
  kind: "리소스 종류",
  license: "라이선스",
  publisher: "배급자",
  sort: "정렬 기준",
};

function readSingleParam(
  searchParams: URLSearchParams,
  param: MarketBrowseQueryParam,
  issues: MarketBrowseQueryIssue[]
): string | undefined {
  const values = searchParams.getAll(param);
  if (values.length > 1) {
    issues.push({
      param,
      code: "duplicate",
      message: `${LABEL_BY_PARAM[param]} 조건이 주소에 여러 번 들어 있어 적용하지 않았어요.`,
    });
    return undefined;
  }
  const value = values[0]?.trim();
  return value || undefined;
}

function pushBoundedTextIssue(
  issues: MarketBrowseQueryIssue[],
  param: "q" | "tag",
  code: "too-long" | "invalid"
): void {
  const limit = param === "q"
    ? CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS
    : CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS;
  const label = LABEL_BY_PARAM[param];
  issues.push({
    param,
    code,
    message: code === "too-long"
      ? `${label}는 최대 ${limit}자까지 사용할 수 있어요. 결과가 달라질 수 있어 자동으로 자르지 않았어요.`
      : `${label}에 사용할 수 없는 문자가 포함되어 있어요.`,
  });
}

/**
 * Read external URL state without silently widening a query. Invalid supplied filters are reported
 * and omitted; callers should pause the request while issues exist and let the user repair them.
 */
export function parseMarketBrowseQuery(
  searchParams: URLSearchParams
): ParsedMarketBrowseQuery {
  const issues: MarketBrowseQueryIssue[] = [];
  const firstSearchDraft = searchParams.getAll("q")[0]?.trim() ?? "";
  const rawSearch = readSingleParam(searchParams, "q", issues);
  const rawTag = readSingleParam(searchParams, "tag", issues);
  const rawKind = readSingleParam(searchParams, "kind", issues);
  const rawLicense = readSingleParam(searchParams, "license", issues);
  const rawPublisher = readSingleParam(searchParams, "publisher", issues);
  const rawSort = readSingleParam(searchParams, "sort", issues);

  let search: string | undefined;
  if (rawSearch !== undefined) {
    const parsed = CreatorMarketplaceResourceSearchQuerySchema.safeParse(rawSearch);
    if (parsed.success) search = parsed.data || undefined;
    else {
      pushBoundedTextIssue(
        issues,
        "q",
        rawSearch.length > CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS
          ? "too-long"
          : "invalid"
      );
    }
  }

  let tag: string | undefined;
  if (rawTag !== undefined) {
    const parsed = CreatorMarketplaceResourceTagQuerySchema.safeParse(rawTag);
    if (parsed.success) tag = parsed.data || undefined;
    else {
      pushBoundedTextIssue(
        issues,
        "tag",
        rawTag.length > CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS
          ? "too-long"
          : "invalid"
      );
    }
  }

  let kind: CreatorMarketplaceResourceKind | undefined;
  if (rawKind !== undefined) {
    const parsed = CreatorMarketplaceResourceKindSchema.safeParse(rawKind);
    if (parsed.success) kind = parsed.data;
    else {
      issues.push({
        param: "kind",
        code: "invalid",
        message: "지원하지 않는 리소스 종류라 적용하지 않았어요.",
      });
    }
  }

  let license: CreatorMarketplaceResourceLicense | undefined;
  if (rawLicense !== undefined) {
    const parsed = CreatorMarketplaceResourceLicenseSchema.safeParse(rawLicense);
    if (parsed.success) license = parsed.data;
    else {
      issues.push({
        param: "license",
        code: "invalid",
        message: "지원하지 않는 라이선스라 적용하지 않았어요.",
      });
    }
  }

  let publisher: string | undefined;
  if (rawPublisher !== undefined) {
    const parsed = CreatorMarketplaceResourcePublisherQuerySchema.safeParse(rawPublisher);
    if (parsed.success) publisher = parsed.data.toLowerCase();
    else {
      issues.push({
        param: "publisher",
        code: "invalid",
        message: "배급자 식별자 형식이 올바르지 않아 적용하지 않았어요.",
      });
    }
  }

  let sort: CreatorMarketplaceResourceSort | undefined;
  if (rawSort !== undefined) {
    const parsed = CreatorMarketplaceResourceSortSchema.safeParse(rawSort);
    if (parsed.success) sort = parsed.data;
    else {
      issues.push({
        param: "sort",
        code: "invalid",
        message: "지원하지 않는 정렬 기준이라 적용하지 않았어요.",
      });
    }
  }
  if (sort === "relevance" && !search) {
    issues.push({
      param: "sort",
      code: "invalid",
      message: "관련도순 정렬에는 올바른 검색어가 필요해요.",
    });
  }

  return {
    values: { search, tag, kind, license, publisher, sort },
    searchDraft: firstSearchDraft,
    issues,
  };
}

export function resolveMarketBrowseSort(
  values: MarketBrowseQueryValues
): CreatorMarketplaceResourceSort {
  return values.sort ?? (values.search ? "relevance" : "newest");
}
