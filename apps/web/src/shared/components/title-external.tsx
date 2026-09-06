import {
  PlayCircle,
  BookOpen,
  Newspaper,
  FileText,
  Mic,
  LayoutGrid,
  ArrowUpRight,
  Play,
} from "lucide-react";
import { useState, useMemo, memo } from "react";

import { Section } from "./section";

import type { Title } from "@/shared/lib/types";

import {
  getRelatedInfoForTitle,
  CATEGORY_LABELS,
  type RelatedCategory,
  type RelatedInfoItem,
} from "@/shared/lib/title-related-info";
import { cn } from "@/shared/lib/utils";
import { useAppConfig } from "@/src/hooks/use-app-config";

const CATEGORIES: RelatedCategory[] = ["all", "youtube", "blog", "news", "wiki", "interview"];

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  all: LayoutGrid,
  youtube: PlayCircle,
  blog: BookOpen,
  news: Newspaper,
  wiki: FileText,
  interview: Mic,
};

const PLATFORM_BADGE_STYLES: Record<RelatedInfoItem["category"], string> = {
  youtube: "bg-red-500/10 text-red-500 border-red-500/20",
  blog: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  news: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  wiki: "bg-green-600/10 text-green-600 border-green-600/20",
  interview: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

interface RelatedInfoTabProps {
  category: RelatedCategory;
  count: number;
  isActive: boolean;
  onSelect: (cat: RelatedCategory) => void;
}

const RelatedInfoTab = memo(function RelatedInfoTab({
  category,
  count,
  isActive,
  onSelect,
}: RelatedInfoTabProps) {
  if (category !== "all" && count === 0) return null;

  const meta = CATEGORY_LABELS[category];
  const Icon = CATEGORY_ICONS[category] || LayoutGrid;

  return (
    <button
      type="button"
      onClick={() => onSelect(category)}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all duration-150",
        isActive
          ? "bg-accent text-white shadow-sm shadow-accent/20 font-semibold"
          : "bg-card/50 text-fg-2 hover:bg-card hover:text-fg border border-line/60"
      )}
    >
      <Icon size={14} className={isActive ? "text-white" : "text-fg-3"} />
      <span>{meta.label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.2 text-[0.68rem]",
          isActive ? "bg-white/20 text-white" : "bg-bg text-fg-3"
        )}
      >
        {count}
      </span>
    </button>
  );
});

interface RelatedInfoCardProps {
  item: RelatedInfoItem;
}

const RelatedInfoCard = memo(function RelatedInfoCard({ item }: RelatedInfoCardProps) {
  const CatIcon = CATEGORY_ICONS[item.category] || LayoutGrid;
  const badgeStyle = PLATFORM_BADGE_STYLES[item.category] || "bg-accent-soft text-accent border-accent/20";

  return (
    <li className="h-full">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-line bg-card/40 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-card hover:shadow-lg hover:shadow-black/5"
      >
        <div>
          {item.thumbnail ? (
            <div className="relative mb-3.5 aspect-video w-full overflow-hidden rounded-xl bg-bg">
              <img
                src={item.thumbnail}
                alt={item.title}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-80 transition-opacity group-hover:opacity-100">
                <span className="flex size-10 items-center justify-center rounded-full bg-red-600 text-white shadow-md transition-transform group-hover:scale-110">
                  <Play size={18} className="ml-0.5 fill-current" />
                </span>
              </div>
              {item.badge && (
                <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-0.5 text-[0.68rem] font-medium text-white backdrop-blur-sm">
                  {item.badge}
                </span>
              )}
            </div>
          ) : (
            <div className="mb-3 flex items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.7rem] font-semibold",
                  badgeStyle
                )}
              >
                <CatIcon size={12} />
                {item.sourceName}
              </span>
              {item.badge && (
                <span className="text-[0.68rem] font-medium text-fg-3">
                  {item.badge}
                </span>
              )}
            </div>
          )}

          <h3 className="line-clamp-2 text-sm font-bold text-fg transition-colors group-hover:text-accent">
            {item.title}
          </h3>

          {item.snippet && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-fg-2">
              {item.snippet}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line/40 pt-3 text-[0.72rem] text-fg-3">
          <span className="truncate">
            {item.thumbnail ? item.sourceName : item.dateOrViews || "상세 페이지"}
          </span>
          <span className="flex items-center gap-1 font-medium text-accent opacity-80 group-hover:opacity-100">
            이동하기
            <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </a>
    </li>
  );
});

export function TitleExternal({ title }: { title: Title }) {
  // 관련 정보는 크롤 링크(유튜브·뉴스·위키) 기반이라 관리자 킬스위치로 끌 수 있다.
  const { showRelatedInfo } = useAppConfig();
  const [activeCategory, setActiveCategory] = useState<RelatedCategory>("all");

  const items = useMemo(() => getRelatedInfoForTitle(title), [title]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const item of items) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter((it) => it.category === activeCategory);
  }, [items, activeCategory]);

  if (!showRelatedInfo) return null;

  return (
    <Section
      className="mt-14"
      eyebrow="RELATED MEDIA & LINKS"
      title="관련 정보 더 보기"
      desc="크롤링 및 큐레이션된 데이터를 바탕으로 개별 유튜브 리뷰 영상, 블로그 후기, 뉴스 기사, 나무위키 문서로 직접 연결합니다."
    >
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        {CATEGORIES.map((cat) => (
          <RelatedInfoTab
            key={cat}
            category={cat}
            count={categoryCounts[cat] || 0}
            isActive={activeCategory === cat}
            onSelect={setActiveCategory}
          />
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card/30 p-8 text-center text-sm text-fg-3">
          선택한 카테고리의 관련 정보가 아직 집계되지 않았습니다.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <RelatedInfoCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Section>
  );
}
