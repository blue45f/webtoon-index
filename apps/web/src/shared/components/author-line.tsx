import Link from "@/src/compat/router-link";

function authorPageHref(name: string): string {
  return `/author/${encodeURIComponent(name)}`;
}

function Names({ raw }: { raw: string }) {
  const names = raw
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <>
      {names.map((n, i) => (
        <span key={`${n}-${i}`}>
          {i > 0 && ", "}
          {n === "미상" ? (
            <span>{n}</span>
          ) : (
            <Link
              href={authorPageHref(n)}
              className="inline-flex items-center gap-0.5 underline-offset-2 transition-colors hover:text-accent hover:underline"
              title={`${n} 작가 페이지`}
            >
              {n}
            </Link>
          )}
        </span>
      ))}
    </>
  );
}

// 상세 페이지 작가 라인 — 글/그림 이름 클릭 시 작가 페이지로
export function AuthorLine({
  author,
  artist,
  year,
}: {
  author: string;
  artist?: string;
  year: number;
}) {
  const showArtist = artist && artist !== author;
  return (
    <p className="mt-2 text-sm text-fg-2">
      글 <Names raw={author} />
      {showArtist && (
        <>
          {" · "}그림 <Names raw={artist} />
        </>
      )}
      <span className="text-fg-3"> · {year}</span>
    </p>
  );
}
