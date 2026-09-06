import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router-dom";

import { MarketResourceDetailArticle } from "../components/MarketResourceDetailArticle";
import { useMarketResourceDetail } from "../hooks/use-market-resource-detail";
import { useMarketResources } from "../hooks/use-market-resources";
import { marketResourceJsonLd } from "../models/market-jsonld";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useJsonLd,
  useMetaDescription,
  usePageSocialMeta,
} from "@/src/hooks/use-document-title";

export function MarketResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { record, loading, notFound, error, staleSavedAt, reload } = useMarketResourceDetail(id);
  const metaTitle = record?.name ?? (notFound ? "리소스를 찾을 수 없어요" : "창작 마켓");
  const metaDescription = record?.description?.trim()
    || (record
      ? `${record.name} 리소스의 구성, 사용권, 호환성과 Studio 적용 방법을 확인하세요.`
      : "ToonSpectrum 창작 마켓 리소스의 구성, 사용권, 호환성과 Studio 적용 방법을 확인하세요.");

  useDocumentTitle(metaTitle);
  useMetaDescription(metaDescription);
  usePageSocialMeta({
    canonicalPath: record ? `/market/resource/${encodeURIComponent(record.id)}` : "/market",
    title: `${metaTitle} · 툰스펙트럼`,
    description: metaDescription,
    type: record ? "article" : "website",
  });
  useJsonLd(record ? marketResourceJsonLd(record) : null);

  const related = useMarketResources(
    record ? { kind: record.kind, limit: 5, sort: "newest" } : null
  );
  const relatedItems = related.items.filter((item) => item.id !== record?.id).slice(0, 4);

  return (
    <Container size="wide" className="py-7 sm:py-10">
      <Link
        href="/market/browse"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-2 transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        마켓으로 돌아가기
      </Link>

      {loading ? (
        <div className="mt-6">
          <p role="status" className="sr-only">
            마켓 리소스 상세 정보를 불러오는 중입니다.
          </p>
          <div
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
            aria-hidden="true"
          >
            <div className="space-y-3">
              <div className="skeleton aspect-[16/9] w-full rounded-xl" />
              <div className="skeleton h-5 w-3/5" />
              <div className="skeleton h-4 w-2/5" />
            </div>
            <div className="space-y-2 rounded-xl border border-line bg-card p-5">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="skeleton h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      ) : notFound ? (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-panel p-12 text-center">
          <p className="text-sm font-medium text-fg">리소스를 찾을 수 없어요</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-2">
            삭제되었거나 주소가 잘못되었을 수 있어요. 마켓에서 다른 리소스를 둘러보세요.
          </p>
          <Link href="/market/browse" className={buttonClass({ variant: "outline", size: "sm", className: "mt-4" })}>
            마켓 탐색으로 이동
          </Link>
        </div>
      ) : error || !record ? (
        <div role="status" className="mt-8 rounded-xl border border-warn/40 bg-warn/10 p-10 text-center">
          <p className="text-sm font-medium text-fg">지금은 리소스를 불러올 수 없어요</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-2">
            일시적인 장애일 수 있어요. 잠시 후 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={reload}
            className={buttonClass({ variant: "outline", size: "sm", className: "mt-4" })}
          >
            다시 시도
          </button>
        </div>
      ) : (
        <MarketResourceDetailArticle
          record={record}
          relatedItems={relatedItems}
          staleSavedAt={staleSavedAt}
          onRetry={reload}
        />
      )}
    </Container>
  );
}
