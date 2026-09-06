import { Bell, BellRing } from "lucide-react";
import { useState } from "react";


import { useApp, useHydrated } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";
import { useCelebrate } from "@/src/hooks/use-celebrate";

// 연재 알림 구독 토글 — 진행 중 작품 상세에서 사용
export function SubscribeButton({
  titleId,
  days,
  className,
}: {
  titleId: string;
  days?: string[];
  className?: string;
}) {
  const hydrated = useHydrated();
  const subscribed = useApp((s) => s.subscriptions[titleId]);
  const toggle = useApp((s) => s.toggleSubscription);
  const celebrate = useCelebrate();
  // 구독 성공 1회성 벨 링 — 키를 올려 재트리거. 해제·초기 렌더엔 애니메이션 없음.
  const [ringKey, setRingKey] = useState(0);
  const on = hydrated && subscribed;

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={(e) => {
        const next = !on;
        toggle(titleId);
        if (next) {
          // 구독 성공 축하 — 종 흔들림 + 작은 파티클 + 햅틱. 해제는 조용히.
          setRingKey((k) => k + 1);
          celebrate(e.currentTarget, { chars: ["🔔", "✨"], count: 10, spread: 0.75, sfx: "pop", haptic: "tickWeak" });
        }
      }}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors duration-150",
        on
          ? "border-accent/50 bg-accent-soft text-accent"
          : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg",
        className
      )}
    >
      {on ? <BellRing key={ringKey} size={16} className={ringKey > 0 ? "pf-bell-ring" : undefined} /> : <Bell size={16} />}
      {on ? `연재 알림 켜짐${days?.length ? ` · ${days.join("·")}` : ""}` : "연재 알림 받기"}
    </button>
  );
}
