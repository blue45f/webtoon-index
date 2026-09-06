import { marketKindMeta } from "./market-kind";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";


// packages/core의 SITE_URL과 동일한 출처 — 마켓 도메인 전용 JSON-LD 헬퍼.
const MARKET_SITE_URL = "https://www.toonstudio.cloud";
const ITEMLIST_TOP = 20;

function itemListElements(items: readonly CreatorMarketplaceResourceRecord[]) {
  const topCount = Math.min(items.length, ITEMLIST_TOP);
  return Array.from({ length: topCount }, (_, index) => {
    const record = items[index]!;
    return {
      "@type": "ListItem",
      position: index + 1,
      name: record.name,
      url: `${MARKET_SITE_URL}/market/resource/${record.id}`,
    };
  });
}

/** 마켓 홈 — CollectionPage + 최신 리소스 ItemList. 항목이 없으면 null(주입 안 함). */
export function marketHomeJsonLd(items: readonly CreatorMarketplaceResourceRecord[]) {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "툰스펙트럼 창작 마켓",
    url: `${MARKET_SITE_URL}/market`,
    mainEntity: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "최신 공유 리소스",
      numberOfItems: Math.min(items.length, ITEMLIST_TOP),
      itemListElement: itemListElements(items),
    },
  };
}

/** 마켓 탐색 — 현재 필터 결과의 ItemList. 항목이 없으면 null. */
export function marketBrowseJsonLd(
  items: readonly CreatorMarketplaceResourceRecord[],
  kind: string | undefined
) {
  if (items.length === 0) return null;
  const label = kind ? `${marketKindMeta(kind as never).label} · ` : "";
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `툰스펙트럼 창작 마켓 · ${label}탐색`,
    numberOfItems: Math.min(items.length, ITEMLIST_TOP),
    itemListElement: itemListElements(items),
  };
}

/** 마켓 상세 — 공유 리소스 하나의 CreativeWork. 라이선스·배급자·수정일을 검색엔진에 노출한다. */
export function marketResourceJsonLd(record: CreatorMarketplaceResourceRecord) {
  const resourceUrl = `${MARKET_SITE_URL}/market/resource/${record.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: record.name,
    description: record.description || undefined,
    url: resourceUrl,
    version: record.resourceVersion,
    author: { "@type": "Person", name: record.publisher.name },
    publisher: { "@type": "Person", name: record.publisher.name },
    dateModified: record.updatedAt,
    datePublished: record.createdAt,
    license: marketLicenseUrl(record.license),
    isAccessibleForFree: true,
    keywords: record.tags.length > 0 ? record.tags.join(", ") : undefined,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": resourceUrl,
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "창작 마켓",
            item: `${MARKET_SITE_URL}/market`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "마켓 탐색",
            item: `${MARKET_SITE_URL}/market/browse`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: record.name,
            item: resourceUrl,
          },
        ],
      },
    },
    additionalProperty: [
      {
        "@type": "PropertyValue",
        name: "리소스 종류",
        value: marketKindMeta(record.kind).label,
      },
      {
        "@type": "PropertyValue",
        name: "최소 Studio 버전",
        value: record.minimumStudioVersion,
      },
      {
        "@type": "PropertyValue",
        name: "호환 엔진",
        value: record.compatibility.engines.join(", "),
      },
    ],
  };
}

function marketLicenseUrl(license: string): string | undefined {
  switch (license) {
    case "cc0-1.0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "cc-by-4.0":
      return "https://creativecommons.org/licenses/by/4.0/";
    case "cc-by-nc-4.0":
      return "https://creativecommons.org/licenses/by-nc/4.0/";
    default:
      return `${MARKET_SITE_URL}/terms`;
  }
}
