import { ArrowUpRight, Clock3, CreditCard, Gift, Ticket } from "lucide-react";

import { PRICING_TONE } from "./availability-utils";
import { PlatformMark } from "./visual-marks";

import type { Availability } from "@/shared/lib/types";


import { cx } from "@/shared/lib/cx";
import { PLATFORMS, PRICING_FULL } from "@/shared/lib/platforms";
import { useAppConfig } from "@/src/hooks/use-app-config";

const PRICING_ICON = {
  free: Gift,
  "wait-free": Clock3,
  paid: CreditCard,
  subscription: Ticket,
} as const;

// 컴팩트 — 플랫폼 브랜드 도트 (카드용)
export function AvailabilityDots({
  availability,
  className,
  max = 4,
}: {
  availability: Availability[];
  className?: string;
  max?: number;
}) {
  const { showAvailability } = useAppConfig();
  if (!showAvailability) return null;
  const shown = availability.slice(0, max);
  const rest = availability.length - shown.length;
  return (
    <span role="img" className={cx("inline-flex items-center gap-1.5", className)} aria-label="연재 플랫폼">
      {shown.map((a) => {
        const p = PLATFORMS[a.platformId];
        return (
          <PlatformMark
            key={a.platformId}
            platform={p}
            size="sm"
            title={`${p.name} · ${PRICING_FULL[a.pricing]}`}
          />
        );
      })}
      {rest > 0 && (
        <span className="rounded-full border border-line bg-canvas/50 px-1 text-[0.62rem] text-fg-3 tnum">
          +{rest}
        </span>
      )}
    </span>
  );
}

// 플랫폼 회사명 태그 (브랜드 컬러 도트 + 이름) — 목록용
export function PlatformTags({
  availability,
  max = 2,
  className,
}: {
  availability: Availability[];
  max?: number;
  className?: string;
}) {
  const { showAvailability } = useAppConfig();
  if (!showAvailability) return null;
  const shown = availability.slice(0, max);
  const rest = availability.length - shown.length;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((a) => {
        const p = PLATFORMS[a.platformId];
        return (
          <span
            key={a.platformId}
            className="inline-flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[0.68rem] font-medium leading-none"
            style={{
              color: p.color,
              borderColor: `color-mix(in oklch, ${p.color} 38%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${p.color} 12%, transparent)`,
            }}
            title={`${p.name} · ${PRICING_FULL[a.pricing]}`}
          >
            <PlatformMark platform={p} size="sm" />
            {p.short}
          </span>
        );
      })}
      {rest > 0 && <span className="rounded-md border border-line bg-canvas/45 px-1 text-[0.65rem] text-fg-3 tnum">+{rest}</span>}
    </span>
  );
}

// 풀 라우터 — "어디서 봐" 신호판 (상세 페이지)
export function AvailabilityRouter({
  availability,
  className,
}: {
  availability: Availability[];
  className?: string;
}) {
  const { showAvailability } = useAppConfig();
  if (!showAvailability) return null;
  // 무료/기다무 우선 정렬
  const order: Record<string, number> = { free: 0, "wait-free": 1, subscription: 2, paid: 3 };
  const sorted = [...availability].sort((a, b) => order[a.pricing] - order[b.pricing]);

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {sorted.map((a) => {
        const p = PLATFORMS[a.platformId];
        const hasUrl = Boolean(a.url);
        const PricingIcon = PRICING_ICON[a.pricing];
        const inner = (
          <>
            <PlatformMark platform={p} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
              <span className={cx("mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium", PRICING_TONE[a.pricing])}>
                <PricingIcon size={12} />
                {PRICING_FULL[a.pricing]}
                {a.isOriginal && <span className="ml-1.5 text-accent">· 독점</span>}
              </span>
            </span>
            {hasUrl ? (
              <span className="flex items-center gap-1 text-xs text-fg-3 transition-colors group-hover:text-fg">
                보러가기
                <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            ) : (
              <span className="text-xs text-fg-3">링크 준비 중</span>
            )}
          </>
        );
        return hasUrl ? (
          <a
            key={a.platformId}
            href={`/api/go/${a.platformId}?to=${encodeURIComponent(a.url ?? "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-3 transition-[background,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {inner}
          </a>
        ) : (
          <div
            key={a.platformId}
            className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-card/60 px-3.5 py-3"
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
