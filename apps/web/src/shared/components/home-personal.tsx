import { useEffect, useState } from "react";

import { Section, Rail } from "./section";
import { TitleCard } from "./title-card";

import type { Title } from "@/shared/lib/types";

import { withCsrfProtection } from "@/shared/lib/csrf";
import { useApp, useHydrated } from "@/shared/lib/store";

// 개인화 홈 섹션 — 스토어에 기록이 있을 때만 렌더(신규 방문자엔 영향 없음).
// 작품 데이터는 기록이 있을 때만 지연 로드하여 초기 번들 경량화 유지.
export function HomePersonal() {
  const hydrated = useHydrated();
  const reads = useApp((s) => s.reads);
  const ratings = useApp((s) => s.ratings);
  const recentlyViewed = useApp((s) => s.recentlyViewed);
  const [reading, setReading] = useState<Title[]>([]);
  const [recs, setRecs] = useState<Title[]>([]);
  const [recent, setRecent] = useState<Title[]>([]);

  const hasEngagement = Object.keys(reads).length > 0 || Object.keys(ratings).length > 0;
  // 저장·평가하지 않고 '둘러보기만' 한 작품 — 재방문 시 빠른 복귀용(최신순).
  const browseOnlyIds = recentlyViewed.filter((id) => !reads[id] && ratings[id] === undefined);
  const browseKey = browseOnlyIds.join(",");
  const hasData = hydrated && (hasEngagement || browseOnlyIds.length > 0);

  useEffect(() => {
    if (!hydrated || !hasEngagement) return;
    let alive = true;
    const controller = new AbortController();
    fetch("/api/recommend", withCsrfProtection({
      method: "POST",
      body: JSON.stringify({ picked: [], ratings, reads }),
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    }))
      .then((res) => {
        if (!res.ok) throw new Error("recommend failed");
        return res.json() as Promise<{ reading: Title[]; tasteRecs: { title: Title }[] }>;
      })
      .then((data) => {
        if (!alive) return;
        setReading(data.reading);
        setRecs(data.tasteRecs.map((item) => item.title));
      })
      .catch(() => {
        if (!alive) return;
        setReading([]);
        setRecs([]);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [hydrated, hasEngagement, ratings, reads]);

  useEffect(() => {
    if (!hydrated || !browseKey) {
      setRecent([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    fetch(`/api/titles?ids=${encodeURIComponent(browseKey)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items?: Title[] }) => {
        if (!alive) return;
        // 응답 순서와 무관하게 방문 순서(최신순)를 유지.
        const byId = new Map((data.items ?? []).map((t) => [t.id, t]));
        const ids = browseKey.split(",");
        setRecent(
          ids
            .map((id) => byId.get(id))
            .filter((t): t is Title => Boolean(t))
            .slice(0, 12)
        );
      })
      .catch(() => {
        if (alive) setRecent([]);
      });
    return () => {
      alive = false;
      controller.abort();
    };
    // browseKey(쉼표 결합 문자열)가 방문 목록 전체를 대표 — 개별 id 변화를 모두 포함한다.
  }, [hydrated, browseKey]);

  if (!hasData) return null;

  if (reading.length === 0 && recs.length === 0 && recent.length === 0) return null;

  return (
    <div className="flex flex-col gap-16">
      {reading.length > 0 && (
        <Section
          eyebrow="WELCOME BACK"
          title="내 서재에서 이어보기"
          desc="관심·정주행 중인 작품"
          action={{ label: "내 서재", href: "/library" }}
        >
          <Rail>
            {reading.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </Rail>
        </Section>
      )}
      {recent.length > 0 && (
        <Section
          eyebrow="JUMP BACK IN"
          title="최근 본 작품"
          desc="둘러봤던 작품으로 빠르게 돌아가기"
          action={{ label: "내 서재", href: "/library" }}
        >
          <Rail>
            {recent.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </Rail>
        </Section>
      )}
      {recs.length > 0 && (
        <Section
          eyebrow="FOR YOU"
          title="당신을 위한 추천"
          desc="평가·관심 이력으로 고른 작품"
          action={{ label: "추천 더 보기", href: "/recommend" }}
        >
          <Rail>
            {recs.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </Rail>
        </Section>
      )}
    </div>
  );
}
