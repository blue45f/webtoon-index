import { Hash } from "lucide-react";


import { Container } from "@/shared/components/section";
import { genreTint, genreBorder, genreTextColor } from "@/shared/lib/genre-color";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";



interface TagsResponse {
  tags: { tag: string; count: number }[];
}

// 카운트 → 폰트 크기(rem). 상위 태그일수록 크게.
function sizeFor(count: number, max: number): number {
  if (max <= 0) return 0.85;
  const t = Math.sqrt(count / max); // 제곱근으로 완만하게
  return 0.8 + t * 1.15; // 0.8 ~ 1.95rem
}

export function TagsPage() {
  const { data, loading, error, reload } = useApiResource<TagsResponse>(
    "/api/tags",
    "태그를 불러오지 못했습니다."
  );
  const tags = data?.tags ?? [];
  const max = tags.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <Container size="default" className="py-10">
      <header className="mb-7">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <Hash size={14} /> TAG SPECTRUM
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">태그로 찾기</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
          작품 특성 태그(#회빙환 #사이다 #힐링 …)를 한눈에. 태그를 누르면 해당 태그가 달린 작품을 탐색에서 모아 봅니다.
          {tags.length > 0 && <span className="text-fg-3"> · 총 {tags.length.toLocaleString("ko-KR")}개 태그</span>}
        </p>
      </header>

      {error ? (
        <ErrorState title="태그를 불러오지 못했습니다." message={error} onRetry={reload} />
      ) : loading ? (
        <div className="flex flex-wrap gap-2.5">
          {Array.from({ length: 40 }).map((_, i) => (
            <span key={i} className="skeleton h-8 rounded-full" style={{ width: `${50 + (i % 5) * 25}px` }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          {tags.map(({ tag, count }) => (
            <Link
              key={tag}
              href={`/explore?tags=${encodeURIComponent(tag)}`}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1 font-medium leading-tight transition-transform duration-150 ease-out-expo hover:-translate-y-0.5"
              style={{
                fontSize: `${sizeFor(count, max)}rem`,
                color: genreTextColor(tag, 0.85),
                backgroundColor: genreTint(tag, 0.12),
                borderColor: genreBorder(tag, 0.3),
              }}
              title={`${tag} · ${count.toLocaleString("ko-KR")}편`}
            >
              <span className="opacity-50">#</span>
              {tag}
              <span className="ml-0.5 text-[0.72rem] text-fg-3">{count.toLocaleString("ko-KR")}</span>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
