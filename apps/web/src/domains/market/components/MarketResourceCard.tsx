import { ArrowUpRight, Heart, Layers } from "lucide-react";

import { useMarketWishlist } from "../hooks/use-market-wishlist";
import { formatMarketDate, marketKindMeta, marketLicenseMeta } from "../models/market-kind";
import {
  brushPreviewData,
  palettePreviewColors,
} from "../models/market-preview";

import { MarketCompareToggle } from "./MarketCompareToggle";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

interface MarketResourceCardProps {
  readonly record: CreatorMarketplaceResourceRecord;
  className?: string;
}

export function MarketResourceCard({ record, className }: MarketResourceCardProps) {
  const kind = marketKindMeta(record.kind);
  const license = marketLicenseMeta(record.license);
  const KindIcon = kind.icon;
  const paletteColors = palettePreviewColors(record);
  const brushPreviews = brushPreviewData(record);
  const { isWishlisted, toggleWishlist } = useMarketWishlist();
  const wishlisted = isWishlisted(record.id);

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-sm",
        "transition-[border-color,transform,box-shadow] duration-200 ease-out-expo",
        "hover:-translate-y-1 hover:border-line-strong hover:shadow-md",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex aspect-[16/9] items-end justify-between overflow-hidden p-3.5",
          !paletteColors
            && "bg-[linear-gradient(140deg,var(--color-card)_0%,var(--color-panel)_55%,var(--color-canvas)_100%)] text-fg",
        )}
      >
        <Link
          href={`/market/resource/${record.id}`}
          aria-label={`${record.name} 상세 보기`}
          className="absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
        >
          <span className="sr-only">{record.name} 상세 보기</span>
        </Link>

        {paletteColors ? (
          <span className="absolute inset-0 flex" aria-hidden="true">
            {paletteColors.slice(0, 10).map((color, index) => (
              <span
                key={`${color}-${index}`}
                className="h-full flex-1 transition-[flex-grow] duration-200 ease-out-expo group-hover:grow-[1.35]"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        ) : null}

        {record.kind === "brush" && !paletteColors ? (
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full opacity-35 transition-opacity duration-200 group-hover:opacity-55"
            viewBox="0 0 200 100"
            preserveAspectRatio="none"
          >
            <path
              d="M 10 70 Q 50 15 100 55 T 190 35"
              fill="none"
              stroke={`oklch(0.85 0.12 ${kind.hue})`}
              strokeWidth={Math.max(3, Math.min(14, brushPreviews?.[0]?.size ?? 8))}
              strokeLinecap="round"
            />
          </svg>
        ) : null}

        {record.kind === "template" && !paletteColors ? (
          <div
            aria-hidden="true"
            className="absolute inset-4 grid grid-cols-2 gap-1.5 opacity-25 transition-opacity duration-200 group-hover:opacity-45"
          >
            <div className="rounded border border-dashed border-fg" />
            <div className="rounded border border-dashed border-fg" />
            <div className="col-span-2 rounded border border-dashed border-fg" />
          </div>
        ) : null}

        {record.kind === "3d-asset" && !paletteColors ? (
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full opacity-30 transition-opacity duration-200 group-hover:opacity-50"
            viewBox="0 0 200 100"
            preserveAspectRatio="none"
          >
            <polygon
              points="60,30 100,15 140,30 100,45"
              fill="none"
              stroke={`oklch(0.85 0.12 ${kind.hue})`}
              strokeWidth="1.5"
            />
            <line x1="60" y1="30" x2="60" y2="65" stroke={`oklch(0.85 0.12 ${kind.hue})`} strokeWidth="1.5" />
            <line x1="100" y1="45" x2="100" y2="80" stroke={`oklch(0.85 0.12 ${kind.hue})`} strokeWidth="1.5" />
            <line x1="140" y1="30" x2="140" y2="65" stroke={`oklch(0.85 0.12 ${kind.hue})`} strokeWidth="1.5" />
            <polygon
              points="60,65 100,80 140,65 100,50"
              fill="none"
              stroke={`oklch(0.85 0.12 ${kind.hue})`}
              strokeWidth="1.5"
              strokeDasharray="4,3"
            />
            <line x1="40" y1="85" x2="160" y2="85" stroke={`oklch(0.7 0.08 ${kind.hue})`} strokeWidth="0.8" strokeOpacity="0.4" />
            <line x1="70" y1="82" x2="70" y2="88" stroke={`oklch(0.7 0.08 ${kind.hue})`} strokeWidth="0.6" strokeOpacity="0.3" />
            <line x1="100" y1="82" x2="100" y2="88" stroke={`oklch(0.7 0.08 ${kind.hue})`} strokeWidth="0.6" strokeOpacity="0.3" />
            <line x1="130" y1="82" x2="130" y2="88" stroke={`oklch(0.7 0.08 ${kind.hue})`} strokeWidth="0.6" strokeOpacity="0.3" />
          </svg>
        ) : null}

        <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleWishlist(record)}
            aria-label={wishlisted ? `${record.name} 찜 해제` : `${record.name} 찜하기`}
            aria-pressed={wishlisted}
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-card/80 shadow-sm backdrop-blur-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              wishlisted ? "text-warn" : "text-fg-3 hover:text-warn",
            )}
          >
            <Heart
              className={cn("size-3.5", wishlisted && "fill-warn text-warn")}
              aria-hidden="true"
            />
          </button>
          <MarketCompareToggle record={record} compact />
        </div>

        <span className="relative z-[2] rounded-md bg-canvas px-1.5 py-1 font-display text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-fg shadow-sm">
          {kind.english}
        </span>

        {!paletteColors ? (
          <KindIcon
            strokeWidth={1.5}
            className="relative z-[2] h-9 w-9 text-fg/45 transition-colors duration-200 group-hover:text-fg/75"
            aria-hidden="true"
          />
        ) : null}

        {!paletteColors ? (
          <span
            className="absolute inset-x-0 bottom-0 h-[3px]"
            style={{
              background: `linear-gradient(90deg, oklch(0.72 0.15 ${kind.hue}), oklch(0.62 0.12 ${(kind.hue + 40) % 360}), oklch(0.52 0.09 ${(kind.hue + 90) % 360}))`,
            }}
          />
        ) : null}

        <span className="numeral tnum absolute right-3.5 top-3 z-[2] inline-flex min-h-6 items-center gap-1 rounded-md bg-canvas px-1.5 text-[0.65rem] font-semibold text-fg shadow-sm">
          <Layers className="h-3 w-3" aria-hidden="true" />
          {record.entries.length}개
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 border-t border-line p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/market/resource/${record.id}`}
            className="line-clamp-2 text-pretty text-sm font-semibold leading-snug text-fg transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {record.name}
          </Link>
          <span className="shrink-0 rounded bg-good/15 px-1.5 py-0.5 text-[0.62rem] font-bold text-good">
            무료
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-fg-2">
          <span className="truncate">{record.publisher.name}</span>
          <span className="numeral tnum shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.65rem] font-semibold text-fg-2">
            v{record.resourceVersion}
          </span>
        </div>
        <div className="mt-auto flex items-center gap-1.5 pt-1.5 text-[0.68rem] text-fg-3">
          <span className="inline-flex min-h-6 items-center rounded bg-accent px-2 font-semibold text-on-accent">
            {kind.label}
          </span>
          <span className="truncate">{license.label}</span>
          <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true" />
        </div>
        {record.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {record.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-raised px-1.5 py-0.5 text-[0.65rem] text-fg-2">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <time dateTime={record.updatedAt} className="text-[0.65rem] text-fg-3">
          {formatMarketDate(record.updatedAt)} 업데이트
        </time>
      </div>
    </article>
  );
}
