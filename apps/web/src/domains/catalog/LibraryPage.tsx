import { useSearchParams } from "react-router-dom";

import { LibraryView } from "@/shared/components/library-view";
import { Container } from "@/shared/components/section";
import { useApp } from "@/shared/lib/store";

const TABS = ["shelf", "rated", "alerts", "taste", "collections"] as const;

export function LibraryPage() {
  const [searchParams] = useSearchParams();
  const tab = TABS.find((entry) => entry === searchParams.get("tab")) ?? "shelf";
  const loggedIn = useApp((s) => Boolean(s.userId));

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <header className="mb-5 sm:mb-7">
        <p className="eyebrow text-accent">MY LIBRARY</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">내 서재</h1>
        <p className="lede mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">
          관심 작품과 평가를 모으면, 툰스펙트럼이 당신의 취향 스펙트럼을 분석해 다음 작품을 추천합니다.{" "}
          {loggedIn
            ? "기록은 계정에 동기화되어 어느 기기에서나 이어집니다."
            : "비로그인 상태에서는 이 브라우저에만 저장되며, 로그인하면 계정에 동기화됩니다."}
        </p>
      </header>
      <LibraryView initialTab={tab} />
    </Container>
  );
}
