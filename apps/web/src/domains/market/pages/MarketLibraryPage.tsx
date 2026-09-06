import {
  ArrowRight,
  ArrowUpRight,
  FolderOpen,
  Library,
  Palette,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { MarketNavHeader } from "../components/MarketNavHeader";
import { useMarketLibrary } from "../hooks/use-market-library";
import { MARKET_KINDS, marketKindMeta, marketLicenseMeta } from "../models/market-kind";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useMetaDescription,
} from "@/src/hooks/use-document-title";

export function MarketLibraryPage() {
  useDocumentTitle("내 보관함 · 창작 마켓");
  useMetaDescription(
    "소장한 창작 마켓 리소스를 한눈에 확인하고, ToonSpectrum Studio 캔버스에 즉시 적용하세요.",
  );

  const { activeItems, removeItem } = useMarketLibrary();
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = activeItems.filter((item) => {
    if (selectedKind !== "all" && item.resource.kind !== selectedKind) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = item.resource.name.toLowerCase().includes(q);
      const matchTag = item.resource.tags.some((t) => t.toLowerCase().includes(q));
      const matchPub = item.resource.publisher.name.toLowerCase().includes(q);
      return matchName || matchTag || matchPub;
    }
    return true;
  });

  return (
    <Container size="wide" className="py-7 sm:py-10">
      <MarketNavHeader />

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Library className="size-5 text-accent" />
            <h1 className="text-xl font-bold text-fg sm:text-2xl">내 보관함</h1>
            <span className="numeral tnum rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
              {activeItems.length}개 소장
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-3">
            내가 소장한 웹툰 리소스 목록입니다. 스튜디오에서 바로 불러와 컷 작업에 적용할 수 있습니다.
          </p>
        </div>

        <Link
          href="/market/browse"
          className={buttonClass({ variant: "outline", size: "sm", className: "gap-1.5" })}
        >
          <span>더 많은 에셋 탐색</span>
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Filters & Search */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {/* Kind Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setSelectedKind("all")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              selectedKind === "all"
                ? "bg-accent text-on-accent"
                : "bg-raised/60 text-fg-2 hover:bg-raised hover:text-fg",
            )}
          >
            전체 ({activeItems.length})
          </button>
          {MARKET_KINDS.map((k) => {
            const count = activeItems.filter((i) => i.resource.kind === k.kind).length;
            if (count === 0) return null;
            return (
              <button
                key={k.kind}
                type="button"
                onClick={() => setSelectedKind(k.kind)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  selectedKind === k.kind
                    ? "bg-accent text-on-accent"
                    : "bg-raised/60 text-fg-2 hover:bg-raised hover:text-fg",
                )}
              >
                {k.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-fg-3" />
          <input
            type="text"
            placeholder="보관함 내 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8.5 w-full rounded-lg border border-line bg-card pl-8 pr-3 text-xs text-fg focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Library Grid */}
      {filteredItems.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line bg-panel/50 p-12 text-center space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
            <FolderOpen className="size-6" />
          </div>
          <h2 className="text-sm font-bold text-fg">
            {activeItems.length === 0
              ? "보관함이 비어 있어요"
              : "검색 조건에 맞는 에셋이 없어요"}
          </h2>
          <p className="mx-auto max-w-sm text-xs text-fg-3 leading-relaxed">
            마켓에서 마음에 드는 리소스를 찾아 '무료 소장하기'를 눌러보세요.
          </p>
          {activeItems.length === 0 ? (
            <Link
              href="/market/browse"
              className={buttonClass({ variant: "solid", size: "md", className: "mt-2" })}
            >
              마켓 리소스 둘러보기
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const record = item.resource;
            const kind = marketKindMeta(record.kind);
            const license = marketLicenseMeta(record.license);

            return (
              <div
                key={item.id}
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-accent/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-accent">
                        {kind.label}
                      </span>
                      <span className="text-[0.68rem] text-fg-3">
                        v{record.resourceVersion}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      title="보관함에서 제거"
                      className="text-fg-3 opacity-40 hover:text-warn hover:opacity-100 transition-opacity p-0.5"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">삭제</span>
                    </button>
                  </div>

                  <Link href={`/market/resource/${record.id}`}>
                    <h3 className="mt-2.5 line-clamp-2 text-sm font-bold text-fg group-hover:text-accent transition-colors">
                      {record.name}
                    </h3>
                  </Link>
                  <p className="mt-1 line-clamp-2 text-xs text-fg-3 leading-relaxed">
                    {record.description || `${record.publisher.name} 작가의 리소스`}
                  </p>
                </div>

                <div className="mt-4 border-t border-line/60 pt-3 space-y-2">
                  <div className="flex items-center justify-between text-[0.68rem] text-fg-3">
                    <span className="truncate">{record.publisher.name}</span>
                    <span className="text-good font-medium">{license.label}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/studio?installMarketResource=${record.id}&assetMarket=community`}
                      className={buttonClass({
                        variant: "solid",
                        size: "sm",
                        className:
                          "flex-1 gap-1.5 bg-gradient-to-r from-accent to-accent-2 text-on-accent shadow-sm",
                      })}
                    >
                      <Palette className="size-3.5" />
                      <span>스튜디오에 적용</span>
                    </Link>
                    <Link
                      href={`/market/resource/${record.id}`}
                      className={buttonClass({
                        variant: "outline",
                        size: "sm",
                        className: "p-2",
                      })}
                      title="에셋 상세 보기"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Container>
  );
}
