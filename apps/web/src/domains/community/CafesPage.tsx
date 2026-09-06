import { Coffee, Plus, Search, Sparkles, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { CommunityCafe } from "@/shared/lib/types";

import { Container } from "@/shared/components/section";
import { useApp, useHydrated } from "@/shared/lib/store";
import { GENRES } from "@/shared/lib/taxonomy";
import { cn, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import { api, getApiErrorMessage } from "@/src/infrastructure/api";


const CAFE_NAME_MAX = 40;
const CAFE_DESCRIPTION_MAX = 300;
const SORTS = [
  { value: "popular", label: "인기순" },
  { value: "recent", label: "최신순" },
] as const;

// 장르 카페 디렉토리(/community/cafes) — 회원이 직접 만들고 가입하는 소모임 목록 + 생성 폼.
export function CafesPage() {
  useDocumentTitle("장르 카페");
  const navigate = useNavigate();
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const hydrated = useHydrated();

  const [cafes, setCafes] = useState<CommunityCafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<string>("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("popular");
  const [searchText, setSearchText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  // 생성 폼
  const [composeOpen, setComposeOpen] = useState(false);
  const [name, setName] = useState("");
  const [composeGenre, setComposeGenre] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQueryText(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<{ items?: unknown }>("/community/cafes", {
        params: { sort, genre: genre || undefined, q: queryText || undefined },
        signal: controller.signal,
      })
      .then((data) => {
        const items = Array.isArray(data?.items) ? (data.items as CommunityCafe[]) : [];
        setCafes(items);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError("카페 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [genre, queryText, refreshTick, sort]);

  async function createCafe() {
    if (!userId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.post<CommunityCafe>(
        "/community/cafes",
        { name, description, genre: composeGenre },
        { headers: sessionToken ? { "x-user-id": sessionToken } : undefined }
      );
      if (!created?.slug) {
        setCreateError("카페 생성 응답이 유효하지 않습니다.");
        return;
      }
      navigate(`/community/cafes/${encodeURIComponent(created.slug)}`);
    } catch (err) {
      setCreateError(await getApiErrorMessage(err, "카페를 만들지 못했습니다."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Container size="wide" className="relative py-6 sm:py-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-accent">
            <Coffee size={14} />
            GENRE CAFES
          </p>
          <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">장르 카페</h1>
          <p className="lede mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">
            같은 장르를 파는 독자들의 소모임. 누구나 읽을 수 있고, 가입하면 게시판에 글을 쓸 수 있어요.
          </p>
        </div>
        <Link
          href="/community"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-line bg-canvas/45 px-3.5 py-2 text-xs font-medium text-fg-2 transition-colors hover:border-accent/45 hover:text-fg"
        >
          <UsersRound size={14} />
          통합 커뮤니티
        </Link>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="order-2 min-w-0 lg:order-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex h-10 min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-line bg-canvas/40 px-3 text-xs transition-colors focus-within:border-accent/50 sm:basis-48">
              <Search size={14} className="shrink-0 text-fg-3" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                maxLength={60}
                aria-label="카페 검색"
                placeholder="카페 이름·소개 검색"
                className="h-full w-full min-w-0 border-none bg-transparent text-sm outline-none placeholder:text-fg-3"
              />
            </div>
            <div className="inline-flex h-9 rounded-xl border border-line bg-raised/40">
              {SORTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSort(option.value)}
                  aria-pressed={sort === option.value}
                  className={cn(
                    "px-3 text-xs font-medium transition-colors first:rounded-l-xl last:rounded-r-xl",
                    sort === option.value ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-canvas/55 hover:text-fg"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rail -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
            <button
              type="button"
              onClick={() => setGenre("")}
              aria-pressed={genre === ""}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                genre === "" ? "border-accent/55 bg-accent-soft text-accent" : "border-line bg-raised/45 text-fg-2 hover:border-line-strong hover:text-fg"
              )}
            >
              전체
            </button>
            {GENRES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setGenre((current) => (current === item ? "" : item))}
                aria-pressed={genre === item}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  genre === item ? "border-accent/55 bg-accent-soft text-accent" : "border-line bg-raised/45 text-fg-2 hover:border-line-strong hover:text-fg"
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/35 bg-bad/10 px-3 py-2 text-xs text-bad">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setRefreshTick((tick) => tick + 1)}
                className="rounded-lg border border-bad/30 px-2 py-1 font-medium"
              >
                다시 시도
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-36 rounded-2xl" />
              ))}
            </div>
          ) : cafes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-card/45 px-6 py-14 text-center">
              <Sparkles className="mx-auto mb-3 text-accent" size={22} />
              <p className="text-sm font-medium text-fg">
                {genre || queryText ? "조건에 맞는 카페가 없어요." : "아직 만들어진 카페가 없어요."}
              </p>
              <p className="mt-1 text-xs text-fg-3">
                {genre || queryText ? "필터를 바꾸거나 첫 카페를 직접 만들어보세요." : "첫 카페를 만들어 같은 취향의 독자를 모아보세요."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {cafes.map((cafe) => (
                <li key={cafe.id}>
                  <Link
                    href={`/community/cafes/${encodeURIComponent(cafe.slug)}`}
                    className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-card p-4 transition-colors hover:border-accent/45 hover:bg-raised/35"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-accent-soft text-accent">
                        <Coffee size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-fg">{cafe.name}</p>
                        <p className="text-[0.68rem] text-fg-3">
                          {cafe.genre || "자유"} · 카페장 {cafe.ownerName}
                        </p>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-fg-2">{cafe.description}</p>
                    <p className="mt-auto pt-1 text-[0.68rem] text-fg-3">
                      멤버 <span className="numeral text-fg-2">{cafe.memberCount}</span> · 글{" "}
                      <span className="numeral text-fg-2">{cafe.postCount}</span> · {relativeDate(cafe.createdAt)} 개설
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="order-1 min-w-0 lg:order-2">
          <div className="sticky top-20 rounded-2xl border border-line bg-panel/40 p-4">
            <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Plus size={14} className="text-accent" />새 카페 만들기
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-fg-3">
              만든 사람이 카페장이 되고, 가입한 회원만 글을 쓸 수 있어요.
            </p>
            {!hydrated ? (
              <div className="skeleton h-36 rounded-lg" />
            ) : userId ? (
              composeOpen ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createCafe();
                  }}
                >
                  <div>
                    <label htmlFor="cafe-name" className="mb-1 block text-xs text-fg-3">
                      카페 이름
                    </label>
                    <input
                      id="cafe-name"
                      value={name}
                      onChange={(event) => setName(event.target.value.slice(0, CAFE_NAME_MAX))}
                      maxLength={CAFE_NAME_MAX}
                      placeholder="예: 로판 정주행 모임"
                      className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40"
                    />
                  </div>
                  <div>
                    <label htmlFor="cafe-genre" className="mb-1 block text-xs text-fg-3">
                      장르
                    </label>
                    <select
                      id="cafe-genre"
                      value={composeGenre}
                      onChange={(event) => setComposeGenre(event.target.value)}
                      className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <option value="">자유(장르 무관)</option>
                      {GENRES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cafe-description" className="mb-1 block text-xs text-fg-3">
                      소개
                    </label>
                    <textarea
                      id="cafe-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value.slice(0, CAFE_DESCRIPTION_MAX))}
                      maxLength={CAFE_DESCRIPTION_MAX}
                      rows={3}
                      placeholder="어떤 독자를 위한 카페인가요?"
                      className="w-full resize-none rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40"
                    />
                    <p className="mt-1 text-right text-[0.68rem] text-fg-3">
                      {description.length}/{CAFE_DESCRIPTION_MAX}
                    </p>
                  </div>
                  {createError && <p className="text-xs text-bad">{createError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setComposeOpen(false)}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-3 transition-colors hover:text-fg"
                    >
                      닫기
                    </button>
                    <button
                      type="submit"
                      disabled={creating || name.trim().length < 2 || description.trim().length < 2}
                      className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {creating ? "만드는 중..." : "카페 만들기"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2"
                >
                  <Plus size={14} />
                  카페 만들기
                </button>
              )
            ) : (
              <p className="rounded-lg border border-line bg-card/60 px-3 py-6 text-center text-xs text-fg-3">
                로그인하면 카페를 만들 수 있어요.
                <br />
                둘러보기는 누구나 가능합니다.
              </p>
            )}
          </div>
        </aside>
      </div>
    </Container>
  );
}
