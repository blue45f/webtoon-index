import {
  Crown,
  Cuboid,
  GraduationCap,
  Swords,
  type LucideIcon,
} from "lucide-react";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

export interface MarketCuratedTheme {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly tag: string;
  readonly badge: string;
  readonly icon: LucideIcon;
  readonly gradient: string;
  readonly accentColor: string;
}

export const MARKET_CURATED_THEMES: readonly MarketCuratedTheme[] = [
  {
    id: "rofan-royal",
    title: "로판 황실 & 티룸 완성 컬렉션",
    subtitle: "황실 티룸 배경부터 레이스 브러시까지",
    description: "로맨스 판타지 귀족 영애 드레스 프릴, 앤틱 티세트 소품, 3D 황실 티룸 배경으로 한 화를 화려하게 채워보세요.",
    tag: "로판",
    badge: "인기 기획전",
    icon: Crown,
    gradient: "from-pink-500/20 via-purple-500/10 to-amber-500/20",
    accentColor: "#ec4899",
  },
  {
    id: "school-youth",
    title: "청춘 학원물 필수 소품 & 교실 팩",
    subtitle: "햇살 비치는 오후 교실과 목재 책걸상",
    description: "한국형 고등학교 교실 3D 배경, 일상 소품 세트, 청량한 아침 햇살 팔레트로 학원물 웹툰의 현장감을 더하세요.",
    tag: "학교",
    badge: "추천 테마",
    icon: GraduationCap,
    gradient: "from-sky-500/20 via-blue-500/10 to-emerald-500/20",
    accentColor: "#0284c7",
  },
  {
    id: "action-fantasy",
    title: "액션 배틀 & 던전 공략 무기 팩",
    subtitle: "다이내믹 속도선과 기사단 롱소드",
    description: "타격감을 극대화하는 집중선 브러시, 3D 기사단 검·방패, 젖은 사이버 네온 골목으로 몰입감 넘치는 액션을 연출하세요.",
    tag: "무기",
    badge: "HOT 트렌드",
    icon: Swords,
    gradient: "from-amber-500/20 via-red-500/10 to-orange-500/20",
    accentColor: "#ea580c",
  },
  {
    id: "pose-guide-3d",
    title: "3D 인체 데생 가이드 & 소체 라이브러리",
    subtitle: "남성·여성 표준 소체와 자유로운 앵글",
    description: "어려운 투시와 역동적인 포즈도 3D 소체로 1초 만에 가이드를 잡고 즉시 스케치할 수 있는 필수 데생 소재.",
    tag: "인체",
    badge: "필수 도구",
    icon: Cuboid,
    gradient: "from-teal-500/20 via-cyan-500/10 to-emerald-500/20",
    accentColor: "#0d9488",
  },
] as const;

export function filterThemeResources(
  items: readonly CreatorMarketplaceResourceRecord[],
  themeTag: string,
): readonly CreatorMarketplaceResourceRecord[] {
  return items.filter((item) =>
    item.tags.some((t) => t.toLowerCase() === themeTag.toLowerCase()),
  );
}
