import { Compass, MessageCircle, UsersRound } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";

import type { FanCafeScopeFilter } from "@/shared/lib/types";

import { FanCafePanel } from "@/shared/components/fan-cafe-panel";
import { Container } from "@/shared/components/section";
import {
  COMMUNITY_SCOPE_DESCRIPTION,
  COMMUNITY_SCOPE_DIRECTORIES,
  COMMUNITY_SCOPE_LABEL,
} from "@/shared/lib/community-ui";
import Link from "@/src/compat/router-link";


const SCOPES = ["title", "author", "pencafe"] as const;

function parseScope(raw: string | undefined): Exclude<FanCafeScopeFilter, "all" | "cafe"> | null {
  return SCOPES.find((scope) => scope === raw) ?? null;
}

export function CommunityPage() {
  return (
    <Container size="wide" className="relative py-6 sm:py-8 lg:py-10">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-panel/55 p-5 text-fg sm:p-6 md:p-10">
        <div className="pointer-events-none absolute right-[-20%] top-[-25%] h-[450px] w-[450px] rounded-full bg-[radial-gradient(circle_at_top,_oklch(0.72_0.185_42/0.22),_transparent_70%)]" />
        <div className="relative z-10">
          <p className="eyebrow flex items-center gap-1.5 text-accent">
            <Compass size={14} />
            COMMUNITY HUB
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[clamp(1.5rem,6.5vw,1.875rem)] font-bold tracking-tight text-fg">작품·작가·펜카페 커뮤니티</h1>
              <p className="lede mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">
                작품 해석부터 번역/팬카페 이슈까지. 스코프별로 분리된 실시간 팬카페를 탐색하세요.
              </p>
            </div>
            <Link
              href="/reviews"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-canvas/45 px-3.5 py-2 text-xs font-medium text-fg-2 transition-colors hover:border-accent/45 hover:text-fg"
            >
              <MessageCircle size={14} />
              리뷰도 함께 보기
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 sm:mt-6">
            {COMMUNITY_SCOPE_DIRECTORIES.map((entry) => (
              <Link
                key={entry.value}
                href={entry.href}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-card/50 px-3.5 py-1.5 text-xs text-fg-2 transition-colors hover:border-accent/45 hover:bg-accent-soft/40 hover:text-fg pointer-coarse:text-sm"
              >
                <span aria-hidden>{entry.icon}</span>
                {entry.label} 디렉토리
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-panel/45 p-1">
        <FanCafePanel scope="all" targetLabel="통합 커뮤니티 피드" compact />
      </section>
    </Container>
  );
}

export function CommunityScopePage() {
  const { scope: rawScope } = useParams();
  const scope = parseScope(rawScope);

  // 장르 카페는 전용 분할 라우트(목록·상세·생성)를 쓴다.
  if (rawScope === "cafe" || rawScope === "cafes") {
    return <Navigate to="/community/cafes" replace />;
  }

  if (!scope) {
    return (
      <Container size="wide" className="py-16">
        <p className="eyebrow text-accent">COMMUNITY</p>
        <h1 className="mt-2 text-2xl font-bold">커뮤니티 범주를 찾을 수 없어요</h1>
        <Link href="/community" className="mt-5 inline-flex text-sm font-medium text-accent">
          통합 커뮤니티로 이동
        </Link>
      </Container>
    );
  }

  return (
    <Container size="wide" className="relative py-6 sm:py-8 lg:py-10">
      <header className="mb-6 sm:mb-8">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <UsersRound size={14} />
          COMMUNITY DIRECTORY
        </p>
        <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">{COMMUNITY_SCOPE_LABEL[scope]} 커뮤니티</h1>
        <p className="lede mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">{COMMUNITY_SCOPE_DESCRIPTION[scope]}</p>
      </header>
      <FanCafePanel scope={scope} targetLabel={`${COMMUNITY_SCOPE_LABEL[scope]} 커뮤니티`} compact />
    </Container>
  );
}
