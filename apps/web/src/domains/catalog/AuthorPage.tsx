import { PenLine } from "lucide-react";
import { useParams } from "react-router-dom";


import type { Title } from "@/shared/lib/types";

import { FanCafePanel } from "@/shared/components/fan-cafe-panel";
import { Container } from "@/shared/components/section";
import { TitleCard } from "@/shared/components/title-card";
import { GenreChip } from "@/shared/components/ui/chip";
import { Stars } from "@/shared/components/ui/stars";
import { formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { NotFoundPage } from "@/src/components/NotFoundPage";
import { useMetaDescription } from "@/src/hooks/use-document-title";
import { useApiResource } from "@/src/infrastructure/use-api-resource";

interface AuthorResponse {
  author: string;
  works: Title[];
  totalViews: number;
  avg: number;
  genres: string[];
  generatedAt: string;
  source: string;
}

export function AuthorPage() {
  const { name } = useParams();
  const authorParam = name ?? "";
  const decodedAuthor = decodeURIComponent(authorParam);
  const { data, loading, error, notFound, reload } = useApiResource<AuthorResponse>(
    authorParam ? `/api/authors/${encodeURIComponent(decodedAuthor)}` : null,
    "작가 데이터를 불러오지 못했습니다."
  );

  const author = data?.author ?? decodedAuthor;
  const works = data?.works ?? [];
  const totalViews = data?.totalViews ?? 0;
  const avg = data?.avg ?? 0;
  const genres = data?.genres ?? [];

  useMetaDescription(
    data
      ? `${author} 작가의 작품 ${works.length}편${genres.length ? ` · ${genres.slice(0, 3).join("·")}` : ""} — 툰스펙트럼에서 작가별로 모아 봅니다.`
      : null
  );

  if (notFound || (!loading && !error && authorParam && data === null)) return <NotFoundPage />;

  return (
    <Container size="wide" className="py-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-accent">
            <PenLine size={13} /> AUTHOR
            <Link
              href="/authors"
              className="ml-1.5 normal-case tracking-normal text-fg-3 transition-colors hover:text-accent"
            >
              · 전체 작가 보기
            </Link>
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{author}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {genres.map((genre) => (
              <GenreChip key={genre} genre={genre} size="sm" />
            ))}
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-6">
          <div>
            <dt className="text-xs text-fg-3">참여작</dt>
            <dd className="numeral text-2xl text-fg">{works.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">평균 별점</dt>
            <dd className="flex items-center gap-1.5">
              <span className="numeral text-2xl text-fg">{avg.toFixed(1)}</span>
              <Stars value={avg} size="sm" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">누적 조회</dt>
            <dd className="numeral text-2xl text-fg">{formatCount(totalViews)}</dd>
          </div>
        </dl>
      </header>

      {loading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="space-y-3">
              <span className="skeleton block aspect-[3/4] rounded-xl" />
              <span className="skeleton block h-4 w-3/4" />
              <span className="skeleton block h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState title="작가 데이터를 불러오지 못했습니다." message={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {works.map((title) => (
            <TitleCard key={title.id} title={title} />
          ))}
        </div>
      )}

      {!loading && !error && works.length > 0 && (
        <div className="mt-12">
          <FanCafePanel scope="author" targetId={author} targetLabel={author} compact />
        </div>
      )}
    </Container>
  );
}
