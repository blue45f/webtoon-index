import { createAdClient, type AdClient } from "@heejun/deskcloud";
import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowUpRight, Megaphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card3D } from "./ui/card-3d";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { adConfig } from "@/src/components/deskcloud-native/config";
import { useAppConfig } from "@/src/hooks/use-app-config";

// 한 지면이 묶어서 서빙하는 스폰서 슬롯들. 페이지마다 한 곳에만 두며(복잡도 ↓),
// 여러 슬롯을 모아 스와이프 캐러셀 한 줄로 보여준다. 기본은 홈 스포트라이트 3종.
const DEFAULT_SLOTS = ["home-spotlight-1", "home-spotlight-2", "home-spotlight-3"];

interface AdSlotProps {
  /** 서빙할 슬롯 키들(미지정 시 홈 스포트라이트). 페이지별 지면 분리에 사용. */
  slots?: string[];
  /** AdDesk 미연동(env 없음)일 때 하우스 자리표시자에 노출할 문구. */
  label?: string;
  className?: string;
}

interface AdCreative {
  creativeId: string;
  imageUrl: string;
  linkUrl: string;
  alt: string;
}

// 토글 가능한 광고 지면. 전역 수익화(monetizationEnabled)가 켜져 있을 때만 렌더한다.
// 기본값은 OFF라 평소엔 아무것도 노출하지 않는다(return null).
//
// 수익화 ON + AdDesk 연동(VITE_ADDESK_URL)이면 공식 SDK(@heejun/deskcloud)로 실제 스폰서
// 크리에이티브를 서빙해 스와이프 캐러셀로 보여준다. 연동 전(env 없음)이면 하우스 자리표시자.
// 어느 쪽이든 "AD" 배지로 광고 지면임을 분명히 표시해 콘텐츠로 위장하지 않는다(정직·비기만).
export function AdSlot({ slots = DEFAULT_SLOTS, label, className }: AdSlotProps) {
  const { monetizationEnabled } = useAppConfig();
  const config = useMemo(() => adConfig(), []);

  // 수익화 OFF → 아무것도 노출하지 않음(기본 상태).
  if (!monetizationEnabled) return null;

  // AdDesk 미연동(env 없음) → 하우스 자리표시자(연동 전 안전 폴백).
  if (!config) return <HousePlaceholder label={label} className={className} />;

  return <SponsoredRail config={config} slots={slots} className={className} />;
}

// AdDesk 연동 지면 — 슬롯들을 병렬 서빙해 받은 크리에이티브만 캐러셀로 렌더한다.
// 서빙 결과가 비면(활성 광고 없음) 아무것도 렌더하지 않는다(레이아웃 공백 없음).
function SponsoredRail({
  config,
  slots,
  className,
}: {
  config: { endpoint: string; publishableKey: string };
  slots: string[];
  className?: string;
}) {
  const client = useMemo(() => createAdClient(config), [config]);
  const slotsKey = slots.join(",");
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [resolved, setResolved] = useState(false);
  const t = useT();

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    const keys = slotsKey.split(",");
    Promise.allSettled(keys.map((slot) => client.serve({ slot, signal: ac.signal }))).then(
      (results) => {
        if (!alive) return;
        const seen = new Set<string>();
        const next: AdCreative[] = [];
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const ad = r.value;
          if (!ad.served || !ad.creativeId || !ad.imageUrl || !ad.linkUrl) continue;
          if (seen.has(ad.creativeId)) continue;
          seen.add(ad.creativeId);
          next.push({
            creativeId: ad.creativeId,
            imageUrl: ad.imageUrl,
            linkUrl: ad.linkUrl,
            alt: ad.alt ?? t("ad.creativeFallbackAlt"),
          });
        }
        setCreatives(next);
        setResolved(true);
      }
    );
    return () => {
      alive = false;
      ac.abort();
    };
  }, [client, slotsKey, t]);

  // 미해결(첫 서빙 전) 또는 서빙된 광고 0건이면 렌더하지 않음(빈 박스/깜빡임 방지).
  if (!resolved || creatives.length === 0) return null;

  return <AdCarousel creatives={creatives} client={client} className={className} />;
}

function AdCarousel({
  creatives,
  client,
  className,
}: {
  creatives: AdCreative[];
  client: AdClient;
  className?: string;
}) {
  const t = useT();
  const multi = creatives.length > 1;
  const autoplay = useRef(
    Autoplay({ delay: 5200, stopOnInteraction: false, stopOnMouseEnter: true })
  );
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: multi, align: "center", containScroll: "trimSnaps" },
    multi ? [autoplay.current] : []
  );
  const [snaps, setSnaps] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) return undefined;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    const sync = () => {
      setSnaps(emblaApi.scrollSnapList());
      onSelect();
    };
    // 초기 동기화는 rAF로 미뤄 effect 내 즉시 set-state 린트를 피한다.
    const raf = requestAnimationFrame(sync);
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", sync);
    return () => {
      cancelAnimationFrame(raf);
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", sync);
    };
  }, [emblaApi]);

  return (
    <aside aria-label={t("ad.slotAriaLabel")} className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between">
        <p className="eyebrow text-accent">{t("ad.slotLabel")}</p>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-fg-3"
          title={t("ad.slotTitle")}
        >
          <Megaphone size={10} aria-hidden />
          AD
        </span>
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {creatives.map((creative) => (
            <div key={creative.creativeId} className="min-w-0 flex-[0_0_100%] pr-3 last:pr-0">
              <AdCard creative={creative} client={client} />
            </div>
          ))}
        </div>
      </div>

      {multi && snaps.length > 1 && (
        <div className="flex justify-center gap-1.5 pt-0.5" aria-hidden>
          {snaps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => emblaApi?.scrollTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === selected ? "w-5 bg-accent" : "w-1.5 bg-line-strong hover:bg-fg-3"
              )}
              tabIndex={-1}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function AdCard({ creative, client }: { creative: AdCreative; client: AdClient }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const tracked = useRef(false);
  const t = useT();

  // 노출 추적 — 카드가 화면에 50% 이상 들어오면 크리에이티브당 1회만 impression을 기록한다.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !tracked.current) {
            tracked.current = true;
            client.trackImpression(creative.creativeId).catch(() => {});
            io.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [client, creative.creativeId]);

  return (
    <Card3D maxTilt={10} scale={1.02}>
      <a
        ref={ref}
        href={creative.linkUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => client.trackClick(creative.creativeId).catch(() => {})}
        className="group relative block overflow-hidden rounded-2xl border border-line/70 bg-panel/40 surface-hl transition-[box-shadow,border-color] duration-200 ease-out-expo hover:border-line-strong hover:shadow-[0_22px_45px_-18px_oklch(0.14_0.02_68/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="aspect-[16/9] w-full overflow-hidden bg-card">
          <img
            src={creative.imageUrl}
            alt={creative.alt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 ease-out-expo group-hover:scale-[1.03]"
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[oklch(0.14_0.02_68/0.85)] to-transparent p-3 pt-10">
          <p className="line-clamp-1 text-sm font-semibold text-on-accent drop-shadow-sm">
            {creative.alt}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[0.7rem] font-semibold text-on-accent">
            {t("ad.ctaDetails")}
            <ArrowUpRight size={12} aria-hidden />
          </span>
        </div>
      </a>
    </Card3D>
  );
}

// AdDesk 미연동 시 폴백 — 정적 하우스 자리표시자(기존 동작 보존).
function HousePlaceholder({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  return (
    <aside
      aria-label={t("ad.placeholderAriaLabel")}
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border border-line bg-panel px-6 py-7 text-center",
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-fg-3">
        <Megaphone size={11} aria-hidden />
        AD · {t("ad.tag")}
      </span>
      <p className="text-sm text-fg-3">
        {label ?? t("ad.placeholderText")}
      </p>
    </aside>
  );
}
