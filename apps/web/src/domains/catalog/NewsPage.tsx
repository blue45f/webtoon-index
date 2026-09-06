import { BookOpen, ExternalLink, Newspaper, Search } from "lucide-react";
import { useState } from "react";


import { Container } from "@/shared/components/section";
import { cn, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


// 카테고리는 scripts/news-gen.ts 의 NewsCategory 와 동일 키 — 정적 JSON 경계라 타입만 복제.
type NewsCategory = "industry" | "adaptation" | "event" | "novel" | "title";

interface NewsRelatedTitle {
  slug: string;
  title: string;
}
interface NewsItem {
  title: string;
  source: string;
  url: string;
  date: string;
  category?: NewsCategory; // 구버전 news.json 호환(없을 수 있음)
  related?: NewsRelatedTitle[]; // 카탈로그 작품 매칭(최대 2)
}
interface NewsResponse {
  items: NewsItem[];
  generatedAt: string;
}

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  industry: "산업",
  adaptation: "영상화",
  event: "공모전·행사",
  novel: "웹소설",
  title: "신작",
};
const CATEGORY_TABS: Array<{ key: NewsCategory | "all"; label: string }> = [
  { key: "all", label: "전체" },
  { key: "industry", label: CATEGORY_LABEL.industry },
  { key: "adaptation", label: CATEGORY_LABEL.adaptation },
  { key: "event", label: CATEGORY_LABEL.event },
  { key: "novel", label: CATEGORY_LABEL.novel },
  { key: "title", label: CATEGORY_LABEL.title },
];

// RSS pubDate(RFC822)·ISO 모두 받아 "오늘/어제/n일 전" 상대시간으로. 파싱 불가면 숨김.
function newsDateLabel(raw: string): string {
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return "";
  return relativeDate(new Date(time).toISOString(), new Date());
}

function fmtGeneratedAt(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 웹툰·웹소설 뉴스 — 공개 뉴스 피드(Google News)에서 받은 헤드라인을 발행처로 링크아웃.
// 저작권 안전: 헤드라인·출처·날짜만 표기하고 본문은 담지 않으며, 클릭 시 원 발행처로 이동.
// 카테고리 탭·키워드 검색은 클라이언트에서, 관련 작품 칩은 카탈로그 매칭(빌드 시) 결과.
export function NewsPage() {
  const { data, loading, error, reload } = useApiResource<NewsResponse>(
    "/data/news.json",
    "뉴스를 불러오지 못했습니다."
  );
  const [tab, setTab] = useState<NewsCategory | "all">("all");
  const [q, setQ] = useState("");

  const items = data?.items ?? [];
  const query = q.trim().toLowerCase();

  const countByCategory: Partial<Record<NewsCategory, number>> = {};
  for (const it of items) {
    if (it.category) countByCategory[it.category] = (countByCategory[it.category] ?? 0) + 1;
  }

  const filtered = items.filter((it) => {
    if (tab !== "all" && it.category !== tab) return false;
    if (!query) return true;
    const haystack = `${it.title} ${it.source} ${(it.related ?? []).map((r) => r.title).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });

  const filterActive = tab !== "all" || query.length > 0;
  const generatedAtLabel = data?.generatedAt ? fmtGeneratedAt(data.generatedAt) : "";

  return (
    <Container size="prose" className="py-10 sm:py-14">
      <header className="mb-6">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <Newspaper size={14} /> NEWS
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">웹툰·웹소설 소식</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
          산업·영상화·공모전·신작 소식을 한곳에 모았습니다. 제목을 누르면 원 기사로 이동하고,
          관련 작품 칩을 누르면 작품 상세로 이동합니다.
        </p>
      </header>

      {!loading && !error && items.length > 0 && (
        <div className="mb-5 flex flex-col gap-3">
          <div
            className="rail -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
            role="group"
            aria-label="뉴스 카테고리 필터"
          >
            {CATEGORY_TABS.map(({ key, label }) => {
              const count = key === "all" ? items.length : countByCategory[key] ?? 0;
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.78rem] transition-colors",
                    active
                      ? "border-accent/60 bg-accent-soft/50 font-medium text-fg"
                      : "border-line bg-card text-fg-2 hover:bg-raised"
                  )}
                >
                  {label}
                  <span className={cn("numeral text-[0.7rem]", active ? "text-accent" : "text-fg-3")}>
                    {count.toLocaleString("ko-KR")}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex max-w-xs items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 transition-colors focus-within:border-accent/60">
            <Search size={15} className="text-fg-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="헤드라인·매체·작품 검색"
              aria-label="뉴스 키워드 검색"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
          </div>
        </div>
      )}

      {loading ? (
        <ul className="flex flex-col gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="skeleton h-16 rounded-2xl" />
          ))}
        </ul>
      ) : error ? (
        <ErrorState title="뉴스를 불러오지 못했습니다." message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card/40 px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-raised text-fg-3">
            <Newspaper size={22} />
          </span>
          <div>
            <p className="font-semibold text-fg">표시할 소식이 없어요</p>
            <p className="mt-1 max-w-xs text-sm text-fg-3">
              새 헤드라인이 모이면 이곳에 표시됩니다. 잠시 후 다시 확인해 주세요.
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card/40 px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-raised text-fg-3">
            <Search size={20} />
          </span>
          <div>
            <p className="font-semibold text-fg">조건에 맞는 소식이 없어요</p>
            <p className="mt-1 max-w-xs text-sm text-fg-3">
              다른 카테고리를 고르거나 검색어를 바꿔 보세요.
            </p>
          </div>
          {filterActive && (
            <button
              type="button"
              onClick={() => {
                setTab("all");
                setQ("");
              }}
              className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised"
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((it, i) => {
            const dateLabel = newsDateLabel(it.date);
            const related = it.related ?? [];
            return (
              <li
                key={`${i}-${it.url}`}
                className="rounded-2xl border border-line bg-card/30 transition-colors hover:border-line-strong hover:bg-card/60"
              >
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 p-4"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                    <Newspaper size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug text-fg group-hover:text-accent">
                      {it.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-fg-3">
                      {it.category && (
                        <span className="rounded-full bg-raised px-2 py-0.5 font-medium text-fg-2">
                          {CATEGORY_LABEL[it.category]}
                        </span>
                      )}
                      {it.source && <span className="font-medium text-fg-2">{it.source}</span>}
                      {dateLabel && <span className="tnum">{dateLabel}</span>}
                    </span>
                  </span>
                  <ExternalLink
                    size={14}
                    className="mt-1 shrink-0 text-fg-3 transition-colors group-hover:text-accent"
                  />
                </a>
                {related.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-4 pb-3.5 sm:pl-16">
                    {related.map((r) => (
                      <Link
                        key={r.slug}
                        href={`/title/${encodeURIComponent(r.slug)}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/25 bg-accent-soft/40 px-2.5 py-1 text-[0.72rem] font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent-soft"
                      >
                        <BookOpen size={12} className="shrink-0" />
                        <span className="truncate">{r.title}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-[0.7rem] leading-relaxed text-fg-3">
        헤드라인·출처·날짜만 표기하며 본문은 각 발행처에 있습니다. 출처: Google News.
        {generatedAtLabel && <span className="tnum"> · {generatedAtLabel} 갱신</span>}
      </p>
    </Container>
  );
}
