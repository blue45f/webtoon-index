import { Shuffle } from "lucide-react";
import { useEffect, useState } from "react";

import { Container } from "@/shared/components/section";
import { useRouter, useSearchParams } from "@/src/compat/navigation";
import { api } from "@/src/infrastructure/api";

// /random — 품질 풀에서 무작위 작품을 골라 상세로 보낸다(replace로 뒤로가기 오염 방지).
// type·genre 쿼리를 그대로 /api/random에 전달해 맥락 있는 랜덤도 지원한다.
export function RandomPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [failed, setFailed] = useState(false);
  const query = sp.toString();

  useEffect(() => {
    let alive = true;
    // type·genre 쿼리를 그대로 전달(sp.toString() → searchParams 문자열).
    api
      .get<{ slug?: string | null }>("/random", query ? { searchParams: query } : undefined)
      .then((d) => {
        if (!alive) return;
        if (d?.slug) router.replace(`/title/${d.slug}`);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [router, query]);

  return (
    <Container size="wide" className="grid min-h-[50vh] place-items-center py-20">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Shuffle size={26} className={failed ? "" : "animate-pulse"} />
        </span>
        {failed ? (
          <>
            <p className="font-semibold text-fg">랜덤 작품을 고르지 못했어요</p>
            <button
              onClick={() => router.replace("/explore")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent"
            >
              탐색으로 가기
            </button>
          </>
        ) : (
          <p className="text-sm text-fg-3">무작위로 한 편 고르는 중…</p>
        )}
      </div>
    </Container>
  );
}
