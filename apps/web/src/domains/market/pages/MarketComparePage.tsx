import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Layers,
  PackageSearch,
  Palette,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useRef } from "react";

import { MarketNavHeader } from "../components/MarketNavHeader";
import {
  MARKET_COMPARE_MAX_ITEMS,
  useMarketCompare,
} from "../hooks/use-market-compare";
import {
  createMarketComparisonRows,
  summarizeMarketComparison,
} from "../models/market-comparison";
import {
  formatMarketByteSize,
  marketKindMeta,
  marketLicenseMeta,
} from "../models/market-kind";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useMetaDescription,
} from "@/src/hooks/use-document-title";

export function MarketComparePage() {
  useDocumentTitle("에셋 비교 · 창작 마켓");
  useMetaDescription(
    "마켓 에셋의 라이선스, Studio 호환성, 버전, 출처와 패키지 구성을 게시 manifest 기준으로 비교합니다.",
  );

  const {
    compareItems,
    compareCount,
    removeCompare,
    clearCompare,
  } = useMarketCompare();
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => createMarketComparisonRows(compareItems),
    [compareItems],
  );
  const summary = useMemo(
    () => summarizeMarketComparison(compareItems),
    [compareItems],
  );

  function scrollComparison(direction: -1 | 1): void {
    const viewport = tableViewportRef.current;
    if (!viewport) return;
    // Native buttons retain keyboard access without making a static table a tab stop.
    // Direct scrolling also respects reduced-motion preferences on every browser.
    const distance = Math.max(240, Math.floor(viewport.clientWidth * 0.8));
    viewport.scrollLeft += direction * distance;
  }

  return (
    <Container size="wide" className="py-7 sm:py-10">
      <MarketNavHeader />

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="size-5 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-bold text-fg sm:text-2xl">에셋 비교</h1>
            <span className="numeral tnum rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
              {compareCount}/{MARKET_COMPARE_MAX_ITEMS}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-3">
            비교 목록에 담은 공개 manifest의 사실만 나란히 표시합니다. 평점·판매량·성능 등 검증되지 않은 수치는 비교에 넣지 않습니다.
          </p>
        </div>
        {compareCount > 0 ? (
          <button
            type="button"
            onClick={clearCompare}
            className={buttonClass({
              variant: "outline",
              size: "sm",
              className: "gap-1.5 text-fg-2",
            })}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            전체 비우기
          </button>
        ) : null}
      </header>

      {compareCount === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-line bg-panel/50 p-10 text-center sm:p-14">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
            <PackageSearch className="size-6" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-sm font-bold text-fg">비교할 에셋을 담아 주세요</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-fg-3">
            탐색 카드의 비교 버튼으로 최대 {MARKET_COMPARE_MAX_ITEMS}개를 선택할 수 있습니다.
          </p>
          <Link
            href="/market/browse"
            className={buttonClass({
              variant: "solid",
              size: "md",
              className: "mt-4 gap-1.5",
            })}
          >
            에셋 탐색
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {compareItems.map((record) => {
              const kind = marketKindMeta(record.kind);
              const KindIcon = kind.icon;
              return (
                <li key={record.id} className="rounded-xl border border-line bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-accent">
                        <KindIcon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-bold leading-snug text-fg">
                          {record.name}
                        </p>
                        <p className="mt-0.5 truncate text-[0.68rem] text-fg-3">
                          {record.publisher.name} · v{record.resourceVersion}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCompare(record.id)}
                      aria-label={`${record.name} 비교 목록에서 제거`}
                      className="rounded p-1.5 text-fg-3 transition-colors hover:bg-warn/10 hover:text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[0.65rem]">
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">
                      {kind.label}
                    </span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-fg-2">
                      {marketLicenseMeta(record.license).label}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/market/resource/${record.id}`}
                      className={buttonClass({
                        variant: "outline",
                        size: "sm",
                        className: "flex-1 gap-1",
                      })}
                    >
                      상세
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    </Link>
                    <Link
                      href={`/studio?installMarketResource=${record.id}&assetMarket=community`}
                      className={buttonClass({
                        variant: "solid",
                        size: "sm",
                        className: "flex-1 gap-1",
                      })}
                    >
                      <Palette className="size-3" aria-hidden="true" />
                      Studio
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          <section aria-label="비교 요약" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <ShieldCheck className="size-3.5 text-good" aria-hidden="true" />
                공통 호환 엔진
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-2">
                {summary.commonEngines.length > 0
                  ? summary.commonEngines.join(", ")
                  : "모든 선택 항목에 공통인 엔진이 없습니다."}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <Layers className="size-3.5 text-accent" aria-hidden="true" />
                패키지 구성
              </p>
              <p className="mt-1 text-xs text-fg-2">
                총 {summary.totalEntryCount}개 항목 · {formatMarketByteSize(summary.totalManifestBytes)} manifest
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <Sparkles className="size-3.5 text-warn" aria-hidden="true" />
                AI 사용 공개
              </p>
              <p className="mt-1 text-xs text-fg-2">
                {summary.aiIncludedCount}/{summary.itemCount}개가 AI 포함으로 공개되었습니다.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <AlertTriangle className="size-3.5 text-warn" aria-hidden="true" />
                사용권 확인
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-2">
                {summary.licenseCount > 1
                  ? `${summary.licenseCount}개 라이선스가 섞여 있습니다. 프로젝트 사용 전 각각 확인하세요.`
                  : "선택 항목의 라이선스 종류가 같습니다. 세부 조건은 각 상세에서 확인하세요."}
              </p>
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-line bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <p className="text-xs text-fg-3">표가 넓으면 이동 버튼으로 다른 열을 확인하세요.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-controls="market-compare-table-scroll"
                  onClick={() => scrollComparison(-1)}
                  className={buttonClass({ variant: "outline", size: "sm", className: "min-h-11 gap-1.5" })}
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                  이전 열 보기
                </button>
                <button
                  type="button"
                  aria-controls="market-compare-table-scroll"
                  onClick={() => scrollComparison(1)}
                  className={buttonClass({ variant: "outline", size: "sm", className: "min-h-11 gap-1.5" })}
                >
                  다음 열 보기
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              id="market-compare-table-scroll"
              ref={tableViewportRef}
              role="region"
              aria-label="에셋 manifest 비교표"
              className="overflow-x-auto"
            >
              <table
                className="w-full border-collapse text-left text-xs"
                style={{ minWidth: `${180 + compareCount * 220}px` }}
              >
                <caption className="sr-only">
                  선택한 에셋의 종류, 버전, 라이선스, 호환성, 출처와 패키지 정보 비교
                </caption>
                <thead>
                  <tr className="border-b border-line bg-panel/70">
                    <th scope="col" className="sticky left-0 z-10 w-44 bg-panel px-4 py-3 font-bold text-fg">
                      비교 항목
                    </th>
                    {compareItems.map((record) => (
                      <th key={record.id} scope="col" className="min-w-52 px-4 py-3 font-bold text-fg">
                        {record.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {rows.map((comparisonRow) => (
                    <tr key={comparisonRow.key} className={comparisonRow.different ? "bg-accent/[0.035]" : undefined}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-card px-4 py-3 font-semibold text-fg-2"
                      >
                        {comparisonRow.label}
                        {comparisonRow.different ? (
                          <span className="ml-1.5 rounded bg-accent/15 px-1.5 py-0.5 text-[0.6rem] font-bold text-accent">
                            차이
                          </span>
                        ) : null}
                      </th>
                      {comparisonRow.values.map((value, index) => (
                        <td
                          key={`${comparisonRow.key}-${compareItems[index]?.id ?? index}`}
                          className="whitespace-pre-wrap break-words px-4 py-3 leading-relaxed text-fg-2"
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mt-3 text-[0.68rem] leading-relaxed text-fg-3">
            비교표는 공개 manifest 스냅샷입니다. 실제 설치 가능 여부와 현재 프로젝트 영향은 Studio 적용 단계에서 다시 확인해야 합니다.
          </p>
        </>
      )}
    </Container>
  );
}
