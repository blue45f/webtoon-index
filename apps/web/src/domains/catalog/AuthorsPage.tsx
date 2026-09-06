import { PenLine, Search } from "lucide-react";
import { useState } from "react";


import { Container } from "@/shared/components/section";
import { genreTint, genreBorder, genreTextColor } from "@/shared/lib/genre-color";
import { useI18n, useT } from "@/shared/lib/i18n";
import { formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


interface AuthorEntry {
  name: string;
  workCount: number;
  totalViews: number;
  avgRating: number;
  topGenres: string[];
  types: ("webtoon" | "webnovel")[];
  cover: [string, string];
  coverImage?: string;
}
interface AuthorsResponse {
  total: number;
  authors: AuthorEntry[];
}

export function AuthorsPage() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const fallbackName = t("authors.noName");
  const { data, loading, error, reload } = useApiResource<AuthorsResponse>(
    "/api/authors",
    t("authors.error")
  );
  const [q, setQ] = useState("");
  const authors = data?.authors ?? [];
  const query = q.trim().toLowerCase();
  const filtered = query ? authors.filter((a) => a.name.toLowerCase().includes(query)) : authors;
  const formatNumber = (value: number) => new Intl.NumberFormat(lang).format(value);
  const authorStats =
    data &&
    t("authors.stats")
      .replace("{total}", formatNumber(data.total))
      .replace("{shown}", formatNumber(authors.length));

  return (
    <Container size="default" className="py-10">
      <header className="mb-7">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <PenLine size={14} /> {t("authors.eyebrow")}
          <Link
            href="/community/author"
            className="ml-1.5 normal-case tracking-normal text-fg-3 transition-colors hover:text-accent"
          >
            · {t("authors.pencafe")}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t("authors.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
          {t("authors.desc")}
          {authorStats ? <span className="text-fg-3">{` · ${authorStats}`}</span> : null}
        </p>
        {!loading && !error && authors.length > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 max-w-xs transition-colors focus-within:border-accent/60">
            <Search size={15} className="text-fg-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("authors.search")}
              aria-label={t("authors.search")}
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
          </div>
        )}
      </header>

      {error ? (
        <ErrorState title={t("authors.error")} message={error} onRetry={reload} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className="skeleton h-[88px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg-3">“{q}”{t("authors.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => (
            <Link
              key={a.name}
              href={`/author/${encodeURIComponent(a.name)}`}
              className="group flex items-center gap-3.5 rounded-xl border border-line bg-card/40 p-3 transition-colors hover:border-line-strong hover:bg-raised"
            >
              <div
                className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/60 font-display text-lg font-bold text-white/90"
                style={{ background: `linear-gradient(145deg, ${a.cover[0]}, ${a.cover[1]})` }}
              >
                {a.coverImage ? (
                  <img src={a.coverImage} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                ) : (
                  (a.name.replace(/[^가-힣A-Za-z0-9]/g, "").charAt(0) || "?")
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-fg group-hover:text-accent">{a.name ?? fallbackName}</h3>
                <p className="mt-0.5 truncate text-xs text-fg-3">
                  {formatNumber(a.workCount)}
                  {t("authors.works")}
                  {" · "}
                  {formatCount(a.totalViews)}
                  {" "}
                  {t("authors.views")}
                  {a.avgRating > 0 && <> · ★{a.avgRating.toFixed(1)}</>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {a.topGenres.slice(0, 3).map((g) => (
                    <span
                      key={g}
                      className="rounded-full border px-1.5 py-0.5 text-[0.72rem] font-medium leading-none"
                      style={{ color: genreTextColor(g, 0.85), backgroundColor: genreTint(g, 0.12), borderColor: genreBorder(g, 0.3) }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
