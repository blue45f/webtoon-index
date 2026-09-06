import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

const SHOW_AFTER_PX = 640; // 한 화면 남짓 내려갔을 때부터 노출(짧은 페이지에선 안 뜸)

// 긴 페이지(랭킹·검색·탐색·상세)에서 빠르게 최상단으로 돌아가는 플로팅 버튼.
// 전역 1개만 마운트한다. 우하단 고정 — 좌하단 테마/언어 스위처와 충돌하지 않는다.
// 스크롤 동작은 prefers-reduced-motion 을 존중(감소 선호 시 즉시 점프).
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const t = useT();

  useEffect(() => {
    const onScroll = () => setVisible(globalThis.scrollY > SHOW_AFTER_PX);
    onScroll(); // 초기 위치 반영(딥링크로 중간에 진입한 경우)
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);

  const onClick = () => {
    const reduce =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
    globalThis.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // 키보드 사용자가 본문 시작으로 자연스럽게 이어가도록 포커스도 최상단 랜드마크로 옮긴다.
    document.getElementById("main-content")?.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("common.backToTop")}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={cn(
        // 모바일: 우하단 FloatingControls(z60) 위로 스택하되, 전역 모달(z80+) 아래에 둔다.
        "fixed bottom-4 right-4 z-[70] grid size-11 place-items-center rounded-full border border-line-strong bg-panel/90 text-fg-2 shadow-[0_10px_30px_-12px_oklch(0.1_0.02_70/0.5)] backdrop-blur-md transition-[opacity,transform,color,border-color] duration-200 ease-out-expo hover:border-accent/55 hover:text-accent max-md:bottom-[calc(8.75rem+env(safe-area-inset-bottom))] max-md:right-4",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      )}
    >
      <ArrowUp size={18} strokeWidth={2.2} />
    </button>
  );
}
