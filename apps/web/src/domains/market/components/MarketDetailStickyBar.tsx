import {
  Check,
  Download,
  Heart,
  Palette,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useMarketLibrary } from "../hooks/use-market-library";
import { useMarketWishlist } from "../hooks/use-market-wishlist";
import { marketKindMeta } from "../models/market-kind";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

interface MarketDetailStickyBarProps {
  record: CreatorMarketplaceResourceRecord;
  onOpenAcquisition: () => void;
}

export function MarketDetailStickyBar({
  record,
  onOpenAcquisition,
}: MarketDetailStickyBarProps) {
  const [visible, setVisible] = useState(false);
  const { isWishlisted, toggleWishlist } = useMarketWishlist();
  const { isAcquired } = useMarketLibrary();
  const wishlisted = isWishlisted(record.id);
  const acquired = isAcquired(record.id);
  const kind = marketKindMeta(record.kind);

  useEffect(() => {
    const handleScroll = () => {
      // Show sticky bar when scrolled past 260px
      setVisible(window.scrollY > 260);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <aside
      aria-label="에셋 빠른 실행 바"
      className={cn(
        "fixed bottom-0 inset-x-0 z-40 border-t border-line/80 bg-card/90 backdrop-blur-md px-4 py-2.5 shadow-xl",
        "animate-in slide-in-from-bottom-3 duration-200",
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        {/* Left info */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-accent font-bold">
            <kind.icon className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-bold text-fg sm:text-sm">
                {record.name}
              </span>
              <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-accent">
                v{record.resourceVersion}
              </span>
            </div>
            <p className="text-[0.68rem] text-fg-3">
              {record.publisher.name} · <span className="text-good font-semibold">무료 라이선스</span>
            </p>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => toggleWishlist(record)}
            aria-label={wishlisted ? "찜 해제" : "찜하기"}
            className={buttonClass({
              variant: "outline",
              size: "sm",
              className: cn(
                "gap-1 px-2.5",
                wishlisted && "border-warn/40 bg-warn/10 text-warn",
              ),
            })}
          >
            <Heart
              className={cn("size-4", wishlisted && "fill-warn text-warn")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{wishlisted ? "찜함" : "찜하기"}</span>
          </button>

          {acquired ? (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-good/15 px-3 py-1.5 text-xs font-semibold text-good">
              <Check className="size-3.5" /> 소장 중
            </span>
          ) : (
            <button
              type="button"
              onClick={onOpenAcquisition}
              className={buttonClass({
                variant: "outline",
                size: "sm",
                className: "gap-1.5 border-accent text-accent hover:bg-accent/10",
              })}
            >
              <Download className="size-3.5" />
              <span>무료 소장</span>
            </button>
          )}

          <Link
            href={`/studio?installMarketResource=${record.id}&assetMarket=community`}
            className={buttonClass({
              variant: "solid",
              size: "sm",
              className: "gap-1.5 bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-sm",
            })}
          >
            <Palette className="size-3.5" />
            <span>스튜디오에 적용</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
