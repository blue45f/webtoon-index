import {
  ArrowRight,
  FolderHeart,
  Heart,
} from "lucide-react";

import { MarketNavHeader } from "../components/MarketNavHeader";
import { MarketResourceCard } from "../components/MarketResourceCard";
import { useMarketWishlist } from "../hooks/use-market-wishlist";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useMetaDescription,
} from "@/src/hooks/use-document-title";

export function MarketWishlistPage() {
  useDocumentTitle("찜 목록 · 창작 마켓");
  useMetaDescription(
    "내가 찜한 웹툰 창작 마켓 리소스들을 모아보고, 필요할 때 언제든 스튜디오에 적용하거나 소장하세요.",
  );

  const { wishlistItems, wishlistCount } = useMarketWishlist();

  return (
    <Container size="wide" className="py-7 sm:py-10">
      <MarketNavHeader />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2">
            <FolderHeart className="size-5 text-warn" />
            <h1 className="text-xl font-bold text-fg sm:text-2xl">찜 목록</h1>
            <span className="numeral tnum rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-bold text-warn">
              {wishlistCount}개
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-3">
            나중에 활용하기 위해 하트를 눌러둔 에셋 목록입니다. 언제든 1클릭으로 스튜디오에 적용할 수 있습니다.
          </p>
        </div>

        <Link
          href="/market/browse"
          className={buttonClass({ variant: "outline", size: "sm", className: "gap-1.5" })}
        >
          <span>더 둘러보기</span>
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Grid */}
      {wishlistItems.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line bg-panel/50 p-12 text-center space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
            <Heart className="size-6" />
          </div>
          <h2 className="text-sm font-bold text-fg">찜한 에셋이 아직 없어요</h2>
          <p className="mx-auto max-w-sm text-xs text-fg-3 leading-relaxed">
            마켓 카탈로그를 둘러보시면서 마음에 드는 에셋 카드 좌측 상단의 하트 버튼을 눌러보세요.
          </p>
          <Link
            href="/market/browse"
            className={buttonClass({ variant: "solid", size: "md", className: "mt-2" })}
          >
            에셋 탐색하러 가기
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {wishlistItems.map((record) => (
            <MarketResourceCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </Container>
  );
}
