import type { FanCafeScopeFilter } from "./types";

export const COMMUNITY_SCOPE_TABS: {
  value: FanCafeScopeFilter;
  label: string;
  icon: string;
  description: string;
}[] = [
  { value: "all", label: "통합", icon: "🌐", description: "작품·작가·펜카페·소모임 피드를 한 번에" },
  { value: "title", label: "작품", icon: "📚", description: "작품별 토론 스레드의 최근 대화" },
  { value: "author", label: "작가", icon: "🖋", description: "작가 중심 커뮤니티 활동" },
  { value: "pencafe", label: "펜카페", icon: "☕", description: "번역·편집·작가 팬모임 공간" },
  { value: "cafe", label: "장르 카페", icon: "🫧", description: "회원이 직접 만드는 장르 소모임" },
] as const;

export const COMMUNITY_SCOPE_DIRECTORIES = COMMUNITY_SCOPE_TABS.filter((entry) => entry.value !== "all").map((entry) => ({
  ...entry,
  // 장르 카페는 전용 분할 라우트(목록/생성/상세)를 쓴다.
  href: entry.value === "cafe" ? "/community/cafes" : `/community/${entry.value}`,
}));

export const COMMUNITY_SCOPE_TARGET_PATH: Record<Exclude<FanCafeScopeFilter, "all">, string> = {
  title: "/title",
  author: "/author",
  pencafe: "/pencafe",
  cafe: "/community/cafes",
};

export const COMMUNITY_SCOPE_LABEL: Record<Exclude<FanCafeScopeFilter, "all">, string> = {
  title: "작품",
  author: "작가",
  pencafe: "펜카페",
  cafe: "장르 카페",
};

export const COMMUNITY_SCOPE_LABEL_WITH_ALL: Record<FanCafeScopeFilter, string> = {
  ...COMMUNITY_SCOPE_LABEL,
  all: "통합",
};

export const FAN_CAFE_SCOPE_COPY: Record<FanCafeScopeFilter, string> = {
  all: "작품·작가·펜카페·소모임의 실시간 실타래를 한 화면에서 탐색합니다.",
  title: "작품 해석, 정주행 메모, 팬아트 아이디어를 한 곳에 모읍니다.",
  author: "작가의 세계관, 연재 흐름, 차기작 기대를 독자들이 함께 정리합니다.",
  pencafe: "창작자·커뮤니티 간 소규모 모임, 번역자, 편집자, 플랫폼별 소통 채널을 운영합니다.",
  cafe: "같은 장르를 파는 독자들이 모이는 소모임. 가입하면 글을 쓸 수 있습니다.",
};


export function getCommunityScopeTargetLink(
  scope: Exclude<FanCafeScopeFilter, "all">,
  targetId: string,
  targetLabel: string
) {
  const root = COMMUNITY_SCOPE_TARGET_PATH[scope];
  const rawKey = scope === "title" || scope === "cafe" ? targetId : targetLabel;
  const encodedKey = scope === "author" ? encodeReadablePathSegment(rawKey) : encodeURIComponent(rawKey);
  return `${root}/${encodedKey}`;
}

function encodeReadablePathSegment(value: string) {
  return value.replace(/[\s%/?#\\]/g, (char) => encodeURIComponent(char));
}

export const COMMUNITY_SORT_OPTIONS = [
  { value: "popular", label: "인기순" },
  { value: "recent", label: "최신순" },
] as const;
export type CommunitySortOption = (typeof COMMUNITY_SORT_OPTIONS)[number]["value"];
export const COMMUNITY_SORT_LABEL: Record<CommunitySortOption, string> = COMMUNITY_SORT_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {} as Record<CommunitySortOption, string>
);

export const COMMUNITY_SCOPE_DESCRIPTION: Record<Exclude<FanCafeScopeFilter, "all">, string> = {
  title: "작품별 토론 스레드를 한 곳에 모아 탐색합니다.",
  author: "작가 작품과 에피소드 중심으로 토론이 올라옵니다.",
  pencafe: "번역·편집·연재 운영 노하우를 함께 정리합니다.",
  cafe: "회원이 직접 만든 장르 소모임을 둘러보고 가입합니다.",
};

export function parseCommunityScope(value: string | null | undefined): Exclude<FanCafeScopeFilter, "all"> | null {
  return value === "title" || value === "author" || value === "pencafe" || value === "cafe"
    ? (value as Exclude<FanCafeScopeFilter, "all">)
    : null;
}

export function parseCommunityScopeWithAll(value: string | null | undefined): FanCafeScopeFilter {
  return value === "title" || value === "author" || value === "pencafe" || value === "cafe" || value === "all"
    ? value
    : "all";
}

export function parseCommunitySort(value: string | null | undefined): CommunitySortOption {
  return value === "recent" ? "recent" : "popular";
}
