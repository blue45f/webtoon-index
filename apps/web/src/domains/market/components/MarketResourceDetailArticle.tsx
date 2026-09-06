import {
  Box,
  CheckCircle2,
  Cpu,
  Download,
  FileJson,
  Heart,
  Layers,
  Lightbulb,
  Link2,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useMarketLibrary } from "../hooks/use-market-library";
import { useMarketWishlist } from "../hooks/use-market-wishlist";
import {
  formatMarketByteSize,
  formatMarketDate,
  marketKindMeta,
  marketLicenseMeta,
} from "../models/market-kind";
import {
  brushPreviewData,
  filterPreviewData,
  palettePreviewData,
  recipePreviewData,
  templatePreviewData,
} from "../models/market-preview";

import { CreatorMarketplaceCloudLibraryAction } from "./CreatorMarketplaceCloudLibraryAction";
import { CreatorMarketplaceReportAction } from "./CreatorMarketplaceReportAction";
import { Market3dAssetPreview } from "./Market3dAssetPreview";
import { MarketAcquisitionModal } from "./MarketAcquisitionModal";
import { MarketAssetRecipePreview } from "./MarketAssetRecipePreview";
import { MarketBrushPreview } from "./MarketBrushPreview";
import { MarketCommentsSection } from "./MarketCommentsSection";
import { MarketCompareToggle } from "./MarketCompareToggle";
import { MarketDetailStickyBar } from "./MarketDetailStickyBar";
import { MarketEditResourceModal } from "./MarketEditResourceModal";
import { MarketFilterPreview } from "./MarketFilterPreview";
import { MarketPalettePreview } from "./MarketPalettePreview";
import { MarketResourceCard } from "./MarketResourceCard";
import { MarketResourceReleaseHistory } from "./MarketResourceReleaseHistory";
import { MarketReviewsSection } from "./MarketReviewsSection";
import { MarketScene3dPreview } from "./MarketScene3dPreview";
import { MarketTemplatePreview } from "./MarketTemplatePreview";
import { MarketWebtoon3dViewerModal } from "./MarketWebtoon3dViewerModal";
import { MarketWebtoonSpecBadge } from "./MarketWebtoonSpecBadge";
import { StaleNoticeBar } from "./StaleNoticeBar";

import type { CreatorMarketplaceInstallReceipt } from "@/shared/lib/creator-marketplace-install-receipt";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import {
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_EVENT,
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
  isCreatorMarketplaceInstallReceiptKind,
  readCreatorMarketplaceInstallReceipt,
  resolveCreatorMarketplaceInstallReceiptState,
} from "@/shared/lib/creator-marketplace-install-receipt";
import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

const ENGINE_LABELS: Record<string, string> = {
  canvas2d: "Canvas 2D",
  webgl2: "WebGL 2",
  webgpu: "WebGPU",
  three: "Three.js",
};

const DELIVERY_LABELS: Record<string, string> = {
  "portable-json": "portable JSON",
  "procedural-recipe": "절차형 레시피",
  "builtin-ref": "스튜디오 내장 참조",
};

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-xs text-fg-3">{label}</dt>
      <dd className="min-w-0 max-w-full text-right text-xs font-medium text-fg">{children}</dd>
    </div>
  );
}

function ShareLinkButton() {
  const [status, setStatus] = useState<"idle" | "shared" | "copied" | "failed">("idle");

  async function shareCurrentLink() {
    const url = window.location.href;
    setStatus("idle");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title: document.title });
        setStatus("shared");
        return;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
        // 공유 시트가 실패하면 클립보드 복사를 한 번 더 시도한다.
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
    }
  }

  const label = status === "shared"
    ? "공유했어요"
    : status === "copied"
      ? "링크를 복사했어요"
      : status === "failed"
        ? "공유할 수 없어요 · 다시 시도"
        : "링크 공유";

  return (
    <button
      type="button"
      onClick={() => void shareCurrentLink()}
      className={buttonClass({ variant: "ghost", size: "sm", className: "w-full" })}
      aria-live="polite"
    >
      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

interface InstallReceiptSnapshot {
  readonly logicalPackId: string;
  readonly receipt: CreatorMarketplaceInstallReceipt | null;
}

function readInstallReceiptSnapshot(
  record: CreatorMarketplaceResourceRecord,
): InstallReceiptSnapshot {
  const logicalPackId = creatorMarketplaceStudioPackId(record);
  return {
    logicalPackId,
    receipt: isCreatorMarketplaceInstallReceiptKind(record.kind)
      ? readCreatorMarketplaceInstallReceipt(logicalPackId)
      : null,
  };
}

function useInstallReceiptSnapshot(
  record: CreatorMarketplaceResourceRecord,
): InstallReceiptSnapshot {
  const logicalPackId = creatorMarketplaceStudioPackId(record);
  const [snapshot, setSnapshot] = useState<InstallReceiptSnapshot>(() =>
    readInstallReceiptSnapshot(record));
  const activeSnapshot = snapshot.logicalPackId === logicalPackId
    ? snapshot
    : readInstallReceiptSnapshot(record);

  useEffect(() => {
    if (!isCreatorMarketplaceInstallReceiptKind(record.kind)) return undefined;
    const refresh = () => setSnapshot(readInstallReceiptSnapshot(record));
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null
        || event.key === CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY
      ) refresh();
    };
    const onReceipt = (event: Event) => {
      const eventPackId = (event as CustomEvent<{ logicalPackId?: unknown }>).detail
        ?.logicalPackId;
      if (eventPackId === undefined || eventPackId === logicalPackId) refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(CREATOR_MARKETPLACE_INSTALL_RECEIPT_EVENT, onReceipt);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CREATOR_MARKETPLACE_INSTALL_RECEIPT_EVENT, onReceipt);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [logicalPackId, record]);

  return activeSnapshot;
}

function downloadMetadataSnapshot(record: CreatorMarketplaceResourceRecord): void {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${record.packageId.replace(/[^a-z0-9._-]+/giu, "-")}-${record.resourceVersion}-metadata-snapshot.json`;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface MarketResourceDetailArticleProps {
  record: CreatorMarketplaceResourceRecord;
  relatedItems: readonly CreatorMarketplaceResourceRecord[];
  staleSavedAt: string | null;
  onRetry: () => void;
}

/** 로딩이 끝난 단건 리소스 본문 — 상태 분기는 페이지가, 렌더는 이 컴포넌트가 맡는다. */
export function MarketResourceDetailArticle({
  record,
  relatedItems,
  staleSavedAt,
  onRetry,
}: MarketResourceDetailArticleProps) {
  const kind = marketKindMeta(record.kind);
  const license = marketLicenseMeta(record.license);
  const KindIcon = kind.icon;
  const palettePreviews = palettePreviewData(record);
  const brushPreviews = brushPreviewData(record);
  const filterPreviews = filterPreviewData(record);
  const templatePreviews = templatePreviewData(record);
  const recipePreviews = recipePreviewData(record);
  const previewItems: readonly { readonly name: string }[] | null = record.kind === "palette"
    ? palettePreviews
    : record.kind === "brush"
      ? brushPreviews
      : record.kind === "filter"
        ? filterPreviews
        : record.kind === "template"
          ? templatePreviews
          : recipePreviews;
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const safePreviewIndex = Math.min(selectedPreviewIndex, Math.max(0, (previewItems?.length ?? 1) - 1));
  const selectedPalette = palettePreviews?.[safePreviewIndex];
  const selectedBrush = brushPreviews?.[safePreviewIndex];
  const selectedFilter = filterPreviews?.[safePreviewIndex];
  const selectedTemplate = templatePreviews?.[safePreviewIndex];
  const selectedRecipe = recipePreviews?.[safePreviewIndex];
  const installReceiptSnapshot = useInstallReceiptSnapshot(record);
  const installReceiptState = resolveCreatorMarketplaceInstallReceiptState(
    record,
    installReceiptSnapshot.receipt,
  );
  const [viewer3dOpen, setViewer3dOpen] = useState(false);

  const [currentRecord, setCurrentRecord] = useState(record);
  const [acquisitionModalOpen, setAcquisitionModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const { isAcquired } = useMarketLibrary();
  const { isWishlisted, toggleWishlist } = useMarketWishlist();
  const acquired = isAcquired(currentRecord.id);
  const wishlisted = isWishlisted(currentRecord.id);

  useEffect(() => {
    setCurrentRecord(record);
  }, [record]);

  useEffect(() => {
    setSelectedPreviewIndex(0);
  }, [record.id]);
  const isDirectAsset = record.kind === "asset";
  const studioActionLabel = isDirectAsset
    ? "스튜디오 캔버스에 에셋 삽입"
    : record.kind === "template"
      ? "장면 템플릿 카탈로그 열기"
      : record.kind === "3d-preset"
        ? "3D 배경 카탈로그 열기"
        : record.kind === "3d-asset"
          ? "3D 에셋 라이브러리 열기"
          : installReceiptState === "update-available"
            ? `스튜디오에서 v${record.resourceVersion}로 업데이트`
            : installReceiptState === "installed-current"
              ? "스튜디오에서 설치 상태 확인"
              : "스튜디오에 리소스 팩 설치";
  const studioActionSummary = isDirectAsset
    ? "Studio 커뮤니티 마켓을 열고 지원되는 첫 에셋을 현재 캔버스에 삽입합니다."
    : record.kind === "template"
      ? "Studio 장면 템플릿 카탈로그와 참조된 템플릿 계열을 엽니다. 장면 카드를 눌러야 현재 컷에 적용됩니다."
      : record.kind === "3d-preset"
        ? "Studio 배경 3D 도형·절차형 카탈로그를 엽니다. 항목을 직접 선택해야 장면에 추가됩니다."
        : record.kind === "3d-asset"
          ? "Studio 3D 에셋 라이브러리를 엽니다. 3D 모델·소품을 장면에 직접 배치할 수 있습니다."
          : "Studio 커뮤니티 마켓을 열고 이 리소스 팩을 로컬 도구 라이브러리에 설치합니다.";

  return (
    <article className="mt-6">
      {staleSavedAt ? (
        <StaleNoticeBar
          savedAt={staleSavedAt}
          onRetry={onRetry}
          className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2 [&>button]:ml-auto"
        />
      ) : null}
      <header
        className="relative overflow-hidden rounded-xl border border-line bg-[linear-gradient(140deg,var(--color-card)_0%,var(--color-panel)_60%,var(--color-canvas)_100%)] p-6 text-fg sm:p-8"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex min-h-6 items-center rounded-md bg-accent px-2 text-xs font-bold text-on-accent"
          >
            {kind.label}
          </span>
          <span className="inline-flex min-h-6 items-center rounded-md bg-raised px-2 text-xs font-semibold text-fg">
            v{record.resourceVersion}
          </span>
          {record.containsAi ? (
            <span className="inline-flex min-h-6 items-center rounded-md border border-warn/40 bg-raised px-2 text-xs font-semibold text-fg">
              AI 포함
            </span>
          ) : (
            <span className="inline-flex min-h-6 items-center rounded-md border border-good/40 bg-raised px-2 text-xs font-semibold text-fg">
              AI 미포함으로 공개
            </span>
          )}
        </div>

        <h1 className="mt-3 max-w-2xl text-pretty text-2xl font-bold leading-tight text-fg sm:text-3xl">
          {record.name}
        </h1>
        {record.description ? (
          <p className="mt-2.5 max-w-xl text-pretty font-serif text-sm italic leading-relaxed text-fg sm:text-base">
            {record.description}
          </p>
        ) : null}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <MarketWebtoonSpecBadge
            format={record.entries.length > 0 && record.entries.every((entry) => entry.delivery.mode === "portable-json") ? "portable-json" : undefined}
          />
          {record.kind.startsWith("3d") ? (
            <button
              type="button"
              onClick={() => setViewer3dOpen(true)}
              className="inline-flex min-h-6 items-center gap-1 rounded-md bg-accent/20 border border-accent/40 px-2 text-xs font-bold text-accent hover:bg-accent/30 transition-colors"
            >
              <Box className="size-3" />
              <span>3D 렌더 모드 예시 보기</span>
            </button>
          ) : null}
        </div>
        <KindIcon strokeWidth={1} aria-hidden="true" className="pointer-events-none absolute -right-4 -top-4 h-36 w-36 text-fg/10" />
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {/* Every valid pack entry remains inspectable; selection never changes install policy. */}
          {previewItems && previewItems.length > 0 ? (
            <section aria-label="패키지 미리보기">
              {previewItems.length > 1 ? (
                <div className="mb-2.5 rounded-xl border border-line bg-panel/60 p-2.5">
                  <div
                    role="tablist"
                    aria-label="미리볼 패키지 항목"
                    className="flex max-w-full gap-1.5 overflow-x-auto pb-1"
                  >
                    {previewItems.map((item, index) => (
                      <button
                        key={`${item.name}-${index}`}
                        id={`market-preview-tab-${index}`}
                        type="button"
                        role="tab"
                        aria-controls="market-preview-panel"
                        aria-selected={safePreviewIndex === index}
                        tabIndex={safePreviewIndex === index ? 0 : -1}
                        onClick={() => setSelectedPreviewIndex(index)}
                        onKeyDown={(event) => {
                          let nextIndex: number | null = null;
                          if (event.key === "ArrowRight") {
                            nextIndex = (index + 1) % previewItems.length;
                          } else if (event.key === "ArrowLeft") {
                            nextIndex = (index - 1 + previewItems.length) % previewItems.length;
                          } else if (event.key === "Home") {
                            nextIndex = 0;
                          } else if (event.key === "End") {
                            nextIndex = previewItems.length - 1;
                          }
                          if (nextIndex === null) return;
                          event.preventDefault();
                          setSelectedPreviewIndex(nextIndex);
                          const tabList = event.currentTarget.closest('[role="tablist"]');
                          const tabs = tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                          tabs?.[nextIndex]?.focus();
                        }}
                        className={`min-h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11 ${
                          safePreviewIndex === index
                            ? "border-accent bg-accent text-on-accent"
                            : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[0.68rem] leading-relaxed text-fg-3">
                    선택은 상세 미리보기만 바꾸며 Studio 동작은 패키지 적용 정책을 따릅니다.
                  </p>
                </div>
              ) : null}

              <div
                id="market-preview-panel"
                role={previewItems.length > 1 ? "tabpanel" : undefined}
                aria-labelledby={previewItems.length > 1 ? `market-preview-tab-${safePreviewIndex}` : undefined}
                tabIndex={previewItems.length > 1 ? 0 : undefined}
              >
                {selectedPalette ? (
                  <MarketPalettePreview
                    key={`palette-${safePreviewIndex}`}
                    colors={selectedPalette.colors}
                    paletteName={selectedPalette.name}
                  />
                ) : null}

                {selectedBrush ? (
                  <MarketBrushPreview key={`brush-${safePreviewIndex}`} brush={selectedBrush} />
                ) : null}

                {selectedFilter ? (
                  <MarketFilterPreview key={`filter-${safePreviewIndex}`} filter={selectedFilter} />
                ) : null}

                {selectedTemplate ? (
                  <MarketTemplatePreview key={`template-${safePreviewIndex}`} template={selectedTemplate} />
                ) : null}

                {record.kind === "asset" && selectedRecipe ? (
                  <MarketAssetRecipePreview key={`asset-${safePreviewIndex}`} recipe={selectedRecipe} />
                ) : null}

                {record.kind === "3d-preset" && selectedRecipe ? (
                  <MarketScene3dPreview key={`3d-${safePreviewIndex}`} recipe={selectedRecipe} />
                ) : null}

                {record.kind === "3d-asset" && selectedRecipe ? (
                  <Market3dAssetPreview key={`3d-asset-${safePreviewIndex}`} recipe={selectedRecipe} />
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-card p-5" aria-labelledby="market-preview-unavailable-heading">
              <h2 id="market-preview-unavailable-heading" className="text-sm font-semibold text-fg">
                웹 미리보기 없음
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-2">
                이 패키지는 웹에서 재현할 수 있는 미리보기 데이터가 없어요. 실제 결과는 Studio에서 확인해 주세요.
              </p>
            </section>
          )}

          {/* Contents Section */}
          <section aria-labelledby="market-entries-heading">
            <div className="flex items-center justify-between">
              <h2 id="market-entries-heading" className="eyebrow text-fg-3">
                패키지 항목 · <span className="numeral tnum">{record.entries.length}</span>개
              </h2>
              <span className="text-xs text-fg-3">
                manifest 크기: {formatMarketByteSize(record.manifestByteSize)}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-card">
              {record.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{entry.name}</p>
                    <p className="truncate text-xs text-fg-3">{entry.id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[0.65rem] text-fg-2">
                      {DELIVERY_LABELS[entry.delivery.mode] ?? entry.delivery.mode}
                    </span>
                    <span className="numeral tnum text-xs text-fg-3">
                      {entry.delivery.byteSize > 0 ? formatMarketByteSize(entry.delivery.byteSize) : "내장 참조"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <MarketResourceReleaseHistory resourceId={record.id} />

          {/* Pro Artist Usage Guide & Settings (Clip Studio Assets Benchmark) */}
          <section aria-labelledby="market-usage-guide-heading" className="rounded-xl border border-line bg-card p-5">
            <h2 id="market-usage-guide-heading" className="flex items-center gap-2 text-sm font-bold text-fg">
              <Lightbulb className="h-4 w-4 text-accent" aria-hidden="true" />
              프로 작가 소재 활용 팁 & 추천 설정
            </h2>
            <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
              {record.kind === "3d-asset" ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Sliders className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">3D 카메라 & 구도 잡기</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        Three.js 뷰포트에서 마우스 우클릭으로 회전하고 스크롤로 줌인/줌아웃하여 하이앵글·로우앵글 투시도를 쉽게 잡을 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Layers className="h-4 w-4 shrink-0 text-cool mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">선화(Line) 추출 가이드</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        외곽선 잉크 두께를 1.5~2.0px로 설정하면 일반 G펜 브러시 펜선과 이질감 없이 자연스럽게 블렌딩됩니다.
                      </p>
                    </div>
                  </div>
                </>
              ) : record.kind === "3d-preset" ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Sliders className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">배경 조명 & 엠비언트 매칭</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        스토리 시간대에 맞춰 주간/노을/야간 조명을 선택한 후 Studio 컬러 필터와 결합해 통일된 무드를 연출하세요.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Layers className="h-4 w-4 shrink-0 text-cool mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">소점 및 컷 스냅</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        3D 씬의 소점 가이드를 컷 박스에 맞추어 인물과 배경 사이의 투시 왜곡을 방지합니다.
                      </p>
                    </div>
                  </div>
                </>
              ) : record.kind === "brush" ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Sliders className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">추천 필압 및 손떨림 보정</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        선화 작업 시 추천 브러시 크기는 8~14px이며 손떨림 보정 15 내외에서 가장 깔끔한 펜선이 나옵니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Layers className="h-4 w-4 shrink-0 text-cool mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">레이어 블렌딩 모드</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        음영 채색 시 [곱하기(Multiply)] 모드에 불투명도 70~80%를 적용하면 부드러운 입체감을 얻을 수 있습니다.
                      </p>
                    </div>
                  </div>
                </>
              ) : record.kind === "palette" ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Sliders className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">배색 황금비율 적용</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        주조색(Base) 60%, 보조색(Sub) 30%, 포인트 강조색(Accent) 10% 비율로 채색하면 안정된 톤 밸런스가 완성됩니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Layers className="h-4 w-4 shrink-0 text-cool mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">Studio 스와치 등록</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        설치 즉시 스튜디오 컬러 피커의 팔레트 목록에 자동 등록되어 스포이드 없이 1클릭으로 색상을 추출할 수 있습니다.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Sliders className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">Studio 원터치 핸드오프</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        스튜디오 캔버스에서 해당 소재를 불러오면 즉시 해당 컷 레이어에 최적화되어 배치됩니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                    <Layers className="h-4 w-4 shrink-0 text-cool mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg">모바일 스크롤 최적화</p>
                      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                        국내 주요 웹툰 플랫폼의 세로 스크롤 규격(720px~1080px 너비)에 완벽하게 호환됩니다.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Decision evidence from the immutable public manifest. */}
          <section aria-labelledby="market-trust-guarantee-heading" className="rounded-xl border border-line bg-card p-5">
            <h2 id="market-trust-guarantee-heading" className="flex items-center gap-2 text-sm font-bold text-fg">
              <ShieldCheck className="h-4 w-4 text-good" aria-hidden="true" />
              게시 manifest 기반 권리·호환성 확인
            </h2>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
              아래 내용은 배급자가 게시한 현재 릴리스의 선언입니다. 독립적인 법률·성능 보증으로 해석하지 말고 실제 프로젝트 적용 전에 세부 조건을 확인하세요.
            </p>
            <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">{license.label}</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">사용 조건: {license.summary}</p>
                  <p className="mt-1 break-words text-[0.65rem] leading-relaxed text-fg-3">
                    {record.attributionText ? `출처 표기: ${record.attributionText}` : "게시된 출처 표기문 없음"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">Studio 호환 선언</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    {record.compatibility.engines.map((engine) => ENGINE_LABELS[engine] ?? engine).join(", ")}
                  </p>
                  <p className="mt-1 text-[0.65rem] text-fg-3">최소 Studio v{record.minimumStudioVersion}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">
                    {record.containsAi ? "AI 사용 포함으로 공개" : "AI 사용 미포함으로 공개"}
                  </p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    배급자 manifest의 공개값이며 ToonSpectrum의 독립 감정이나 NoAI 보증 배지가 아닙니다.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-panel/50 p-3">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-cool" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">
                    {record.provenance.origin === "original" ? "배급자 직접 제작으로 공개" : "외부 허용 출처로 공개"}
                  </p>
                  {record.provenance.origin === "permissive" ? (
                    <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                      {record.provenance.sourceName} ·{" "}
                      <a
                        href={record.provenance.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        원본 확인
                      </a>
                      {" · "}
                      <a
                        href={record.provenance.sourceLicenseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        원본 사용권
                      </a>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                      배급자가 원본 제작자로 선언한 릴리스입니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Artist Reviews & Ratings (Real interactive submission & feedback) */}
          <MarketReviewsSection resourceId={currentRecord.id} />

          {/* Q&A Comments & Threaded Replies (Real interactive threaded discussions) */}
          <MarketCommentsSection
            resourceId={currentRecord.id}
            publisherId={currentRecord.publisher.id}
          />

          {/* Tags */}
          {record.tags.length > 0 ? (
            <section aria-label="태그">
              <ul className="flex flex-wrap gap-1.5">
                {record.tags.map((tag) => (
                  <li key={tag}>
                    <Link
                      href={`/market/browse?tag=${encodeURIComponent(tag)}`}
                      className="inline-flex min-h-6 items-center rounded bg-raised px-2.5 text-xs text-fg-2 transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11 pointer-coarse:px-3"
                    >
                      #{tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Related Resources */}
          {relatedItems.length > 0 ? (
            <section aria-labelledby="market-related-heading">
              <h2 id="market-related-heading" className="eyebrow text-fg-3">
                같은 종류 최신 리소스
              </h2>
              <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {relatedItems.map((item) => (
                  <li key={item.id}>
                    <MarketResourceCard record={item} className="h-full" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
            <CreatorMarketplaceCloudLibraryAction record={record} />
            {isCreatorMarketplaceInstallReceiptKind(record.kind) ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-lg border border-line bg-panel px-3 py-2.5 text-left"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  <ShieldCheck
                    className={installReceiptState === "installed-current"
                      ? "h-3.5 w-3.5 text-good"
                      : "h-3.5 w-3.5 text-fg-3"}
                    aria-hidden="true"
                  />
                  {installReceiptState === "installed-current"
                    ? `이 기기·브라우저에 v${record.resourceVersion} 설치 확인됨`
                    : installReceiptState === "update-available"
                      ? `업데이트 가능 · 설치 v${installReceiptSnapshot.receipt?.packageVersion} → 마켓 v${record.resourceVersion}`
                      : "이 기기·브라우저에서 확인된 설치 영수증 없음"}
                </p>
                <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                  성공한 Studio 설치가 이 브라우저에 남긴 로컬 기록만 표시합니다. 계정 소유권이나 클라우드 동기화 상태가 아닙니다.
                </p>
              </div>
            ) : null}
            <Link
              href={`/studio?installMarketResource=${record.id}&assetMarket=community`}
              className={buttonClass({ variant: "solid", size: "md", className: "w-full" })}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {studioActionLabel}
            </Link>
            {acquired ? (
              <Link
                href="/market/library"
                className={buttonClass({
                  variant: "outline",
                  size: "sm",
                  className: "w-full gap-1.5 border-good/40 text-good hover:bg-good/10",
                })}
              >
                <CheckCircle2 className="size-3.5" />
                <span>내 보관함에 보관됨 (보관함 이동)</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setAcquisitionModalOpen(true)}
                className={buttonClass({
                  variant: "outline",
                  size: "sm",
                  className: "w-full gap-1.5 border-accent text-accent hover:bg-accent/10",
                })}
              >
                <Download className="size-3.5" />
                <span>무료 소장하기 (보관함 추가)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleWishlist(currentRecord)}
              className={buttonClass({
                variant: "outline",
                size: "sm",
                className: cn(
                  "w-full gap-1.5",
                  wishlisted && "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20",
                ),
              })}
            >
              <Heart
                className={cn("size-3.5", wishlisted && "fill-warn text-warn")}
                aria-hidden="true"
              />
              <span>{wishlisted ? "찜한 에셋에서 제거" : "찜 목록에 추가"}</span>
            </button>
            <MarketCompareToggle record={currentRecord} className="w-full" />
            {currentRecord.isOwner ? (
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className={buttonClass({
                  variant: "outline",
                  size: "sm",
                  className: "w-full gap-1.5 border-accent/60 text-accent hover:bg-accent/10",
                })}
              >
                <Sliders className="size-3.5" />
                <span>에셋 정보 수정 / 판올림</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => downloadMetadataSnapshot(record)}
              className={buttonClass({ variant: "outline", size: "sm", className: "w-full" })}
            >
              <FileJson className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              메타데이터 스냅샷 다운로드
            </button>
            <Link
              href={`/market/browse?kind=${record.kind}`}
              className={buttonClass({ variant: "ghost", size: "sm", className: "w-full" })}
            >
              같은 종류의 리소스 더 보기
            </Link>
            <ShareLinkButton />
            <CreatorMarketplaceReportAction record={record} />
            <p className="text-center text-[0.68rem] leading-relaxed text-fg-3">
              {studioActionSummary}
            </p>
          </div>

          <dl className="divide-y divide-line rounded-xl border border-line bg-card px-4 py-1">
            <MetaRow label="배급자">
              <span className="flex max-w-full flex-col items-end gap-0.5">
                <span className="inline-flex max-w-full items-center">
                  {record.publisher.avatar ? (
                    <img
                      src={record.publisher.avatar}
                      alt=""
                      className="mr-1.5 inline-block h-4 w-4 rounded-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <Link
                    href={`/u/${encodeURIComponent(record.publisher.id)}`}
                    className="inline-flex min-h-6 max-w-full items-center break-all underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11"
                  >
                    {record.publisher.name}
                  </Link>
                </span>
                <Link
                  href={`/market/browse?publisher=${encodeURIComponent(record.publisher.id)}`}
                  className="inline-flex min-h-6 items-center text-[0.68rem] font-normal text-fg-3 underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11"
                >
                  이 배급자의 마켓 리소스
                </Link>
              </span>
            </MetaRow>
            <MetaRow label="패키지 ID">
              <span className="block max-w-full break-all font-mono text-[0.68rem] text-fg-2">
                {record.packageId}
              </span>
            </MetaRow>
            <MetaRow label="버전">
              <span className="numeral tnum">v{record.resourceVersion}</span>
            </MetaRow>
            <MetaRow label="라이선스">
              <span className="flex max-w-[190px] flex-col items-end gap-1">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-good" aria-hidden="true" />
                  {license.url ? (
                    <a
                      href={license.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-6 items-center underline decoration-line-strong underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11"
                    >
                      {license.label}
                    </a>
                  ) : (
                    <Link
                      href="/terms"
                      className="inline-flex min-h-6 items-center underline decoration-line-strong underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11"
                    >
                      {license.label}
                    </Link>
                  )}
                </span>
                <span className="font-normal leading-relaxed text-fg-2">{license.summary}</span>
              </span>
            </MetaRow>
            <MetaRow label="호환 엔진">
              {record.compatibility.engines.map((engine) => ENGINE_LABELS[engine] ?? engine).join(", ")}
            </MetaRow>
            <MetaRow label="최소 스튜디오 버전">
              <span className="numeral tnum">v{record.minimumStudioVersion}</span>
            </MetaRow>
            <MetaRow label="AI 사용">
              <span className="inline-flex items-center gap-1">
                <Sparkles className={`h-3.5 w-3.5 ${record.containsAi ? "text-warn" : "text-good"}`} aria-hidden="true" />
                {record.containsAi ? "포함" : "미포함"}
              </span>
            </MetaRow>
            {record.attributionText ? (
              <MetaRow label="출처 표기">
                <span className="block max-w-[180px] whitespace-normal break-words text-fg-2">
                  {record.attributionText}
                </span>
              </MetaRow>
            ) : null}
            <MetaRow label="업데이트">
              <time dateTime={record.updatedAt}>{formatMarketDate(record.updatedAt)}</time>
            </MetaRow>
          </dl>

          {record.provenance.origin === "permissive" ? (
            <div className="rounded-xl border border-line bg-panel p-4 text-xs leading-relaxed text-fg-2">
              <p className="mb-1 inline-flex items-center gap-1 font-medium text-fg">
                <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                외부 허용 리소스
              </p>
              출처: {record.provenance.sourceName}
              <br />
              <a
                href={record.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-6 items-center break-all text-cool underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11"
              >
                원본 소스 ↗
              </a>
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-panel p-4 text-xs leading-relaxed text-fg-2">
              <p className="mb-1 inline-flex items-center gap-1 font-medium text-fg">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                오리지널 창작
              </p>
              배급자가 직접 만든 리소스입니다.
            </div>
          )}
        </div>
      </div>

      <MarketWebtoon3dViewerModal
        open={viewer3dOpen}
        onClose={() => setViewer3dOpen(false)}
        assetTitle={record.name}
        studioResourceId={record.id}
      />

      <MarketDetailStickyBar
        record={currentRecord}
        onOpenAcquisition={() => setAcquisitionModalOpen(true)}
      />

      <MarketAcquisitionModal
        open={acquisitionModalOpen}
        onClose={() => setAcquisitionModalOpen(false)}
        record={currentRecord}
      />

      <MarketEditResourceModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        record={currentRecord}
        onSaved={(updated) => setCurrentRecord(updated)}
      />
    </article>
  );
}
