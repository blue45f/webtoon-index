import { motion } from "motion/react";
import { useEffect, useState } from "react";

import type { FortuneTab } from "./FortunePage";

import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

// 탭별 결과 형태에 맞춘 스켈레톤 로딩 — DESIGN.md "스켈레톤 로딩, 스피너 금지" 준수.
// 캐릭터 아바타 글로우 + 단계별 카피로 'AI가 점치는 중' 의식을 연출한다.

const STAGE_BY_TAB: Record<FortuneTab, string[]> = {
  today: ["오늘의 기운을 살피는 중", "일진을 맞춰보는 중", "콘티를 그리는 중"],
  zodiac: ["별자리를 짚는 중", "별의 흐름을 읽는 중", "콘티를 그리는 중"],
  saju: ["사주를 펼치는 중", "오행을 가늠하는 중", "콘티를 그리는 중"],
  compatibility: ["두 기운을 포개는 중", "합·충을 살피는 중", "콘티를 그리는 중"],
  prescription: ["마음을 들여다보는 중", "서가를 살피는 중", "처방을 적는 중"],
  tarot: ["카드의 기운을 읽는 중", "메시지를 해석하는 중", "콘티를 그리는 중"],
};

function Box({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton block ${className ?? ""}`} style={style} />;
}

function TabSkeleton({ tab }: { tab: FortuneTab }) {
  if (tab === "today" || tab === "zodiac") {
    return (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
        <Box className="h-40 rounded-2xl md:col-span-4" />
        <div className="grid grid-cols-2 gap-3 md:col-span-8">
          {Array.from({ length: 4 }).map((_, i) => <Box key={i} className="h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }
  if (tab === "saju") {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Box key={i} className="aspect-square rounded-lg" />)}
        </div>
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => <Box key={i} className="h-4 rounded-full" />)}
        </div>
      </div>
    );
  }
  if (tab === "tarot") {
    return (
      <div className="flex flex-col items-center gap-6 md:flex-row">
        <Box className="aspect-[2/3] w-52 shrink-0 rounded-2xl" />
        <div className="w-full space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => <Box key={i} className="h-4 rounded-full" />)}
        </div>
      </div>
    );
  }
  if (tab === "compatibility") {
    return (
      <div className="space-y-4">
        <Box className="h-20 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4">
          <Box className="h-16 rounded-xl" />
          <Box className="h-16 rounded-xl" />
        </div>
      </div>
    );
  }
  // prescription
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => <Box key={i} className="h-4 rounded-full" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function FortuneLoading({
  tab,
  characterName,
  avatarUrl,
}: {
  tab: FortuneTab;
  characterName: string;
  avatarUrl?: string;
}) {
  const stages = STAGE_BY_TAB[tab];
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => setStage((s) => (s + 1) % stages.length), 1300);
    return () => window.clearInterval(id);
  }, [stages.length]);

  return (
    <div className="space-y-6 py-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div
          className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-accent/50"
          animate={{ boxShadow: ["0 0 0 0 var(--color-accent-soft)", "0 0 0 10px transparent"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        >
          {avatarUrl ? (
            <img src={resolveAssetUrl(avatarUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="skeleton block h-full w-full" />
          )}
        </motion.div>
        <p className="font-serif text-sm text-fg-2" aria-live="polite">
          {characterName}가 {stages[stage]}…
        </p>
      </div>

      <TabSkeleton tab={tab} />

      {/* 웹툰 컷 스켈레톤 */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Box key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
