import {
  Compass,
  FolderHeart,
  GitCompareArrows,
  Library,
  PackagePlus,
  Palette,
  Store,
  UserCheck,
} from "lucide-react";
import { useLocation } from "react-router-dom";

import { useMarketCompare } from "../hooks/use-market-compare";
import { useMarketLibrary } from "../hooks/use-market-library";
import { useMarketWishlist } from "../hooks/use-market-wishlist";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

interface MarketNavHeaderProps {
  className?: string;
}

export function MarketNavHeader({ className }: MarketNavHeaderProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const { totalCount: libraryCount } = useMarketLibrary();
  const { wishlistCount } = useMarketWishlist();
  const { compareCount } = useMarketCompare();

  const navItems = [
    {
      href: "/market",
      label: "마켓 홈",
      icon: Store,
      active: pathname === "/market",
    },
    {
      href: "/market/browse",
      label: "에셋 탐색",
      icon: Compass,
      active: pathname === "/market/browse" || pathname.startsWith("/market/resource"),
    },
    {
      href: "/market/library",
      label: "내 보관함",
      icon: Library,
      badge: libraryCount > 0 ? libraryCount : null,
      active: pathname === "/market/library",
    },
    {
      href: "/market/wishlist",
      label: "찜 목록",
      icon: FolderHeart,
      badge: wishlistCount > 0 ? wishlistCount : null,
      active: pathname === "/market/wishlist",
    },
    {
      href: "/market/compare",
      label: "에셋 비교",
      icon: GitCompareArrows,
      badge: compareCount > 0 ? compareCount : null,
      active: pathname === "/market/compare",
    },
    {
      href: "/market/manage",
      label: "내 등록 에셋",
      icon: UserCheck,
      active: pathname === "/market/manage",
    },
  ];

  return (
    <nav
      aria-label="마켓 주요 내비게이션"
      className={cn(
        "mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-4 pt-1",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 pointer-coarse:min-h-11",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                item.active
                  ? "bg-accent text-on-accent shadow-sm"
                  : "bg-raised/60 text-fg-2 hover:bg-raised hover:text-fg",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge !== null && item.badge !== undefined ? (
                <span
                  className={cn(
                    "ml-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.62rem] font-bold leading-none",
                    item.active
                      ? "bg-on-accent text-accent"
                      : "bg-accent/20 text-accent",
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/market/publish"
          className={buttonClass({
            variant: "solid",
            size: "sm",
            className:
              "gap-1.5 bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-sm hover:opacity-95",
          })}
        >
          <PackagePlus className="size-3.5" aria-hidden="true" />
          <span>에셋 등록하기</span>
        </Link>
        <Link
          href="/studio"
          className={buttonClass({
            variant: "outline",
            size: "sm",
            className: "gap-1.5 text-fg-2 hover:text-fg",
          })}
        >
          <Palette className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">스튜디오</span>
        </Link>
      </div>
    </nav>
  );
}
