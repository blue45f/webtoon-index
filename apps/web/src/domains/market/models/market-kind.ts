import {
  Brush,
  Box,
  Cuboid,
  LayoutTemplate,
  Palette,
  Shapes,
  SlidersHorizontal,
} from "lucide-react";

import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
} from "@/shared/lib/creator-marketplace-resource-contract";
import type { LucideIcon } from "lucide-react";


export interface MarketKindMeta {
  readonly kind: CreatorMarketplaceResourceKind;
  readonly label: string;
  readonly english: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** 데이터 맥락(커버 그라디언트·칩 틴트) 전용 hue. 악센트(persimmon, hue 42)와 충돌하지 않게 우회 배치. */
  readonly hue: number;
}

export const MARKET_KINDS: readonly MarketKindMeta[] = Object.freeze([
  {
    kind: "brush",
    label: "브러시",
    english: "BRUSH",
    description: "펜·붓 질감을 그대로 공유하는 portable JSON 브러시",
    icon: Brush,
    hue: 150,
  },
  {
    kind: "filter",
    label: "필터",
    english: "FILTER",
    description: "색보정·효과 프리셋을 한 번에 적용",
    icon: SlidersHorizontal,
    hue: 280,
  },
  {
    kind: "palette",
    label: "팔레트",
    english: "PALETTE",
    description: "작가의 컬러 무드를 통째로 가져오기",
    icon: Palette,
    hue: 330,
  },
  {
    kind: "template",
    label: "템플릿",
    english: "TEMPLATE",
    description: "장면 구도와 캔버스 세팅이 담긴 시작판",
    icon: LayoutTemplate,
    hue: 232,
  },
  {
    kind: "3d-preset",
    label: "3D 프리셋",
    english: "3D PRESET",
    description: "절차형 3D 배경 프리셋으로 스크린 잡기",
    icon: Box,
    hue: 200,
  },
  {
    kind: "3d-asset",
    label: "3D 에셋",
    english: "3D ASSET",
    description: "3D 모델·소품·캐릭터 파츠를 공유하고 Studio에서 바로 배치",
    icon: Cuboid,
    hue: 170,
  },
  {
    kind: "asset",
    label: "에셋",
    english: "ASSET",
    description: "절차형 2D 오브제와 소품 레시피",
    icon: Shapes,
    hue: 95,
  },
]);

const MARKET_KIND_BY_KIND = new Map(MARKET_KINDS.map((meta) => [meta.kind, meta]));

export function marketKindMeta(kind: CreatorMarketplaceResourceKind): MarketKindMeta {
  return (
    MARKET_KIND_BY_KIND.get(kind) ?? {
      kind,
      label: kind,
      english: kind.toUpperCase(),
      description: "",
      icon: Shapes,
      hue: 70,
    }
  );
}

export interface MarketLicenseMeta {
  readonly license: CreatorMarketplaceResourceLicense;
  readonly label: string;
  readonly summary: string;
  readonly url: string | null;
}

export const MARKET_LICENSES: readonly MarketLicenseMeta[] = Object.freeze([
  {
    license: "toonspectrum-standard",
    label: "ToonSpectrum 표준 사용권",
    summary: "작품 사용은 자유, 리소스 파일 재배포는 불가",
    url: null,
  },
  {
    license: "cc0-1.0",
    label: "CC0 1.0",
    summary: "상업 이용·수정·재배포 모두 가능한 공개 리소스",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  {
    license: "cc-by-4.0",
    label: "CC BY 4.0",
    summary: "저작자 표시 조건 하에 상업 이용·수정·재배포 가능",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  {
    license: "cc-by-nc-4.0",
    label: "CC BY-NC 4.0",
    summary: "저작자 표시 필요, 비상업 작품에만 사용 가능",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
]);

const MARKET_LICENSE_BY_LICENSE = new Map(
  MARKET_LICENSES.map((meta) => [meta.license, meta])
);

export function marketLicenseMeta(
  license: CreatorMarketplaceResourceLicense
): MarketLicenseMeta {
  return MARKET_LICENSE_BY_LICENSE.get(license) ?? MARKET_LICENSES[0]!;
}

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });

export function formatMarketDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : isoDate;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatMarketDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : isoDate;
}

export function formatMarketByteSize(bytes: number): string {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
