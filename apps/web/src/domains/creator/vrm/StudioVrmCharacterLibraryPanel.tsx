import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Loader2,
  Paintbrush,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEventHandler } from "react";

import { presentStudioVrmLicenseAuthority } from "./studio-vrm-license-product-gate";
import { buildFallbackVrmLibraryThumbnail, type VrmLibraryEntry } from "./vrm-library";

const LIBRARY_BATCH_SIZE = 12;
/** Prefetch margin so the next batch starts before the user hits the list end. */
const LIBRARY_INFINITE_ROOT_MARGIN = "280px 0px";

const CONTROL_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Nearest overflow-y scrollport, if any. Side-panel lists scroll inside an aside rather than the
 * document, so IntersectionObserver must use that root or the sentinel never re-fires.
 */
function resolveScrollParent(node: HTMLElement | null): Element | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const { overflowY } = globalThis.getComputedStyle?.(current) ?? { overflowY: "" };
    if (
      overflowY === "auto"
      || overflowY === "scroll"
      || overflowY === "overlay"
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

type StudioVrmCharacterLibraryPanelProps = {
  hidden: boolean;
  entries: readonly VrmLibraryEntry[];
  recentCharacterIds: readonly string[];
  libraryStatus: "loading" | "ready" | "error";
  libraryError: string;
  activeModelId: string;
  deletingModelId: string | null;
  modelStatus: "empty" | "loading" | "ready" | "error";
  isUploading: boolean;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onSelect: (entry: VrmLibraryEntry) => void;
  onDelete: (entry: VrmLibraryEntry) => void;
  onCollapse: () => void;
  onRetry: () => void;
  hasMoreEntries?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onVisibleWindowChange?: (entries: readonly VrmLibraryEntry[]) => void;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function StudioVrmCharacterLibraryPanel({
  hidden,
  entries,
  recentCharacterIds,
  libraryStatus,
  libraryError,
  activeModelId,
  deletingModelId,
  modelStatus,
  isUploading,
  onFileChange,
  onSelect,
  onDelete,
  onCollapse,
  onRetry,
  hasMoreEntries = false,
  isLoadingMore = false,
  onLoadMore,
  onVisibleWindowChange,
}: StudioVrmCharacterLibraryPanelProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(LIBRARY_BATCH_SIZE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMorePendingRef = useRef(false);
  const loadMoreActionRef = useRef<() => void>(() => undefined);

  const entryById = new Map(entries.map((entry) => [entry.id, entry] as const));
  const recentEntries = recentCharacterIds
    .map((id) => entryById.get(id))
    .filter((entry): entry is VrmLibraryEntry => entry !== undefined)
    .slice(0, 6);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredEntries = entries.filter((entry) =>
    entry.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
  );
  const visibleEntries = filteredEntries.slice(0, visibleCount);
  const visibleWindowEntries = visibleEntries.slice(-LIBRARY_BATCH_SIZE);
  const visibleWindowKey = visibleWindowEntries.map((entry) => entry.id).join("\u0000");
  const hiddenEntryCount = Math.max(0, filteredEntries.length - visibleEntries.length);
  const canExpandLocal = hiddenEntryCount > 0;
  const canFetchRemote = !canExpandLocal && hasMoreEntries && typeof onLoadMore === "function";
  const hasMoreToReveal = canExpandLocal || canFetchRemote;
  const hasUploadedModels = entries.some((entry) => entry.source !== "sample");

  // Search is a new filtered list — always restart from the first progressive window.
  useEffect(() => {
    setVisibleCount(LIBRARY_BATCH_SIZE);
    loadMorePendingRef.current = false;
  }, [normalizedQuery]);

  useEffect(() => {
    if (!hidden) onVisibleWindowChange?.(visibleWindowEntries);
  }, [hidden, onVisibleWindowChange, visibleWindowEntries, visibleWindowKey]);

  const expandLocalBatch = () => {
    setVisibleCount((count) => count + LIBRARY_BATCH_SIZE);
  };

  const revealMoreCharacters = () => {
    if (canExpandLocal) {
      expandLocalBatch();
      return;
    }
    if (canFetchRemote && !isLoadingMore) {
      onLoadMore?.();
    }
  };

  loadMoreActionRef.current = revealMoreCharacters;

  // Infinite scroll — Explore/brush-library style sentinel. Button remains an a11y/manual fallback.
  useEffect(() => {
    loadMorePendingRef.current = false;
    const sentinel = loadMoreSentinelRef.current;
    if (
      hidden
      || !hasMoreToReveal
      || !sentinel
      || typeof globalThis.IntersectionObserver !== "function"
    ) {
      return;
    }

    const observer = new globalThis.IntersectionObserver(
      (entries) => {
        if (
          loadMorePendingRef.current
          || isLoadingMore
          || !entries.some((entry) => entry.isIntersecting)
        ) {
          return;
        }
        loadMorePendingRef.current = true;
        loadMoreActionRef.current();
      },
      {
        root: resolveScrollParent(sentinel),
        rootMargin: LIBRARY_INFINITE_ROOT_MARGIN,
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      loadMorePendingRef.current = false;
    };
  }, [
    canExpandLocal,
    canFetchRemote,
    filteredEntries.length,
    hasMoreToReveal,
    hidden,
    isLoadingMore,
    visibleCount,
    visibleEntries.length,
  ]);

  return (
    <section
      id="vrm-character-section-library"
      role="tabpanel"
      aria-labelledby="vrm-character-subtab-library"
      aria-busy={libraryStatus === "loading" || isUploading}
      hidden={hidden}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
          <Upload size={15} className="text-accent" aria-hidden />
          캐릭터 라이브러리
        </h3>
        <span className="text-[0.68rem] text-fg-3" aria-live="polite">
          표시 {visibleEntries.length}/{filteredEntries.length}명
        </span>
      </div>
      <input
        ref={fileInputRef}
        accept=".vrm"
        aria-label="VRM 캐릭터 파일 선택"
        className="sr-only"
        multiple
        type="file"
        onChange={onFileChange}
      />
      <button
        type="button"
        className={cx(CONTROL_BUTTON, "w-full border-accent/50 bg-accent text-on-accent hover:bg-accent/90")}
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? <Loader2 className="animate-spin" size={14} aria-hidden /> : <Upload size={14} aria-hidden />}
        VRM 업로드
      </button>
      <p className="mt-2 rounded-xl border border-line bg-card/60 px-3 py-2 text-xs leading-relaxed text-fg-3">
        여러 .vrm 파일을 한 번에 올려 로맨스, 판타지, 학원물, 액션 등 장르별 캐릭터를 전환하세요. VRoid Studio에서 무료 애니메이션풍 VRM 캐릭터를 직접 만들 수 있습니다.
        이용 조건이 없거나 손상된 모델도 로컬 미리보기는 가능하지만, 모델 파일을 포함하는 archive·내보내기·공유는 확인 전까지 차단됩니다.
      </p>

      <details className="group mt-3 rounded-xl border border-line bg-accent-soft/30 p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs font-bold text-accent [&::-webkit-details-marker]:hidden">
          <Sparkles size={13} aria-hidden />
          무료 VRM·의상 찾기
          <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="mt-1 text-[0.68rem] leading-normal text-fg-2">
          아래 공식/커뮤니티 허브에서 무료 배포 모델을 다운로드해 보세요. 다운로드한 .vrm 파일을 ToonSpectrum에 자유롭게 추가할 수 있습니다.
        </p>
        <div className="mt-2.5 space-y-2">
          <a
            href="https://hub.vroid.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-[0.72rem] font-bold text-fg">
                VRoid Hub <ExternalLink size={10} className="opacity-60" aria-hidden />
              </span>
              <span className="truncate text-[0.68rem] text-fg-3">
                'Free' 태그가 달린 수많은 고품질 무료 3D 캐릭터 다운로드
              </span>
            </span>
          </a>
          <a
            href="https://booth.pm/ko/search/VRM?max_price=0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-[0.72rem] font-bold text-fg">
                BOOTH (무료 VRM 아바타) <ExternalLink size={10} className="opacity-60" aria-hidden />
              </span>
              <span className="truncate text-[0.68rem] text-fg-3">
                의상, 헤어, 악세사리 등 3D 소스 무료 배포 카탈로그
              </span>
            </span>
          </a>
        </div>
      </details>

      <details className="group mt-3 rounded-xl border border-line bg-card/60 p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-fg [&::-webkit-details-marker]:hidden">
          <Paintbrush size={13} className="text-accent" aria-hidden />
          더 깊은 원본 모델 제작 · VRoid 가져오기
          <ChevronDown size={13} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-2">
          ToonSpectrum의 조형 탭은 현재 VRM 리그를 보존한 빠른 비파괴 편집에 적합합니다. 새 스킨 메시·직접 그린 텍스처·VRM 파일 내보내기까지 필요하면 VRoid Studio에서 원본을 만든 뒤 가져오세요.
        </p>

        <div className="mt-2.5 space-y-1.5 rounded-lg border border-line bg-panel p-2 text-[0.68rem] text-fg-3">
          <div className="font-bold text-fg">💡 툰스펙트럼 적용 가이드:</div>
          <ul className="list-decimal space-y-1 pl-3.5">
            <li>PC/Mac 버전 VRoid Studio를 다운로드하여 설치합니다.</li>
            <li>원하는 슬롯(얼굴, 체형, 헤어, 옷 등)의 프리셋을 골라 취향대로 커스텀합니다.</li>
            <li>우측 상단 [내보내기(Export)] 아이콘 ➜ <span className="font-bold text-fg">Export as VRM</span>을 클릭합니다.</li>
            <li>정보(이름, 라이선스 등)를 입력하고 내보낸 <span className="font-semibold text-accent">.vrm 파일</span>을 ToonSpectrum에 업로드해 보세요!</li>
          </ul>
        </div>

        <a
          href="https://vroid.com/studio"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-[0.68rem] font-bold text-fg transition-colors hover:bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          VRoid Studio 공식 다운로드 <ExternalLink size={10} className="opacity-70" aria-hidden />
        </a>
      </details>

      {libraryStatus === "error" && libraryError ? (
        <div className="mt-2 rounded-xl border border-line bg-card/70 px-3 py-2 text-xs leading-relaxed text-fg-3" role="alert">
          <p>
            <AlertTriangle className="mr-1 inline align-[-2px] text-accent" size={14} aria-hidden />
            {libraryError}
          </p>
          <button
            type="button"
            className={cx(CONTROL_BUTTON, "mt-2 w-full border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
            disabled={isLoadingMore}
            onClick={onRetry}
          >
            {isLoadingMore ? <Loader2 className="animate-spin" size={14} aria-hidden /> : null}
            라이브러리 다시 불러오기
          </button>
        </div>
      ) : null}

      {!hasUploadedModels ? (
        <div className="mt-3 rounded-xl border border-dashed border-line bg-card/45 px-3 py-3 text-xs leading-relaxed text-fg-3">
          업로드한 캐릭터가 아직 없습니다. 루미로 바로 테스트하거나, 다양한 장르 캐릭터를 만들어 업로드하세요.
        </div>
      ) : null}

      <div className="relative mt-3">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(LIBRARY_BATCH_SIZE);
          }}
          placeholder="캐릭터 이름 검색..."
          aria-label="캐릭터 라이브러리 검색"
          spellCheck={false}
          className="min-h-11 w-full rounded-lg border border-line bg-card py-1.5 pl-8 pr-2 text-xs text-fg placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </div>

      {recentEntries.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">최근 캐릭터</p>
          <div className="flex flex-wrap gap-1.5">
            {recentEntries.map((entry) => {
              const isActive = entry.id === activeModelId;
              return (
                <button
                  key={`recent-${entry.id}`}
                  type="button"
                  aria-pressed={isActive}
                  disabled={modelStatus === "loading" && isActive}
                  className={cx(
                    "min-h-9 rounded-full border px-2.5 text-[0.68rem] font-semibold transition-colors",
                    isActive
                      ? "border-accent/55 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                  onClick={() => onSelect(entry)}
                >
                  {entry.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {libraryStatus === "loading" ? (
          <div className="col-span-2 rounded-xl border border-line bg-card/60 px-3 py-4 text-center text-xs text-fg-3">
            저장된 캐릭터를 불러오는 중입니다.
          </div>
        ) : null}

        {entries.length > 0 && filteredEntries.length === 0 ? (
          <div className="col-span-2 rounded-xl border border-line bg-card/60 px-3 py-4 text-center text-xs text-fg-3">
            "{query}"와 일치하는 캐릭터가 없어요.
          </div>
        ) : null}

        {visibleEntries.map((entry) => {
          const isActive = entry.id === activeModelId;
          const isDeleting = deletingModelId === entry.id;
          const licensePresentation = entry.source === "sample"
            ? null
            : presentStudioVrmLicenseAuthority(entry.licenseAuthority);

          return (
            <div
              key={entry.id}
              className={cx(
                "relative overflow-hidden rounded-xl border transition-colors",
                isActive ? "border-accent/60 bg-accent-soft" : "border-line bg-card hover:bg-raised",
              )}
            >
              <button
                type="button"
                aria-label={`${entry.name} 선택`}
                aria-pressed={isActive}
                className="grid min-h-[6.25rem] w-full grid-rows-[4.5rem_auto] gap-2 px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                disabled={modelStatus === "loading" && isActive}
                onClick={() => onSelect(entry)}
              >
                <span className="grid h-[4.5rem] place-items-center overflow-hidden rounded-lg border border-line/80 bg-panel">
                  <img
                    alt=""
                    className="h-full w-full object-contain"
                    src={entry.thumbnail ?? buildFallbackVrmLibraryThumbnail(entry.name, entry.id)}
                    onError={(event) => {
                      const fallback = buildFallbackVrmLibraryThumbnail(entry.name, entry.id);
                      if (event.currentTarget.src !== fallback) {
                        event.currentTarget.src = fallback;
                      }
                    }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-fg">{entry.name}</span>
                  <span
                    className={cx(
                      "mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[0.68rem] font-bold",
                      isActive ? "bg-accent text-on-accent" : "bg-raised text-fg-3",
                    )}
                  >
                    {entry.source === "sample"
                      ? "번들"
                      : entry.source === "memory"
                        ? "현재 탭 임시"
                        : "SQLite/OPFS"}
                  </span>
                </span>
              </button>

              {licensePresentation ? (
                <details
                  className="group/license mx-2.5 mb-2 rounded-lg border border-line/80 bg-panel/70 px-2 py-1.5 text-[0.68rem]"
                  data-studio-vrm-license-authority={licensePresentation.tone}
                >
                  <summary
                    className={cx(
                      "flex min-h-7 cursor-pointer list-none items-center gap-1 font-bold [&::-webkit-details-marker]:hidden",
                      licensePresentation.tone === "positive"
                        ? "text-success"
                        : licensePresentation.tone === "blocking"
                          ? "text-danger"
                          : "text-accent",
                    )}
                  >
                    <AlertTriangle size={11} aria-hidden />
                    {licensePresentation.badge}
                    <ChevronDown
                      className="ml-auto transition-transform group-open/license:rotate-180"
                      size={11}
                      aria-hidden
                    />
                  </summary>
                  <p className="mt-1 leading-relaxed text-fg-2">
                    {licensePresentation.summary}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-3.5 text-fg-3">
                    {licensePresentation.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  {licensePresentation.licenseUrl ? (
                    <a
                      href={licensePresentation.licenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex min-h-7 items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      라이선스 문서 <ExternalLink size={10} aria-hidden />
                    </a>
                  ) : null}
                </details>
              ) : null}

              {entry.source !== "sample" ? (
                <button
                  type="button"
                  aria-label={`${entry.name} 삭제`}
                  className="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-lg border border-line bg-panel/90 text-fg-3 transition-colors pointer-coarse:size-11 hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
                  disabled={isDeleting}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(entry);
                  }}
                >
                  {isDeleting ? <Loader2 className="animate-spin" size={13} aria-hidden /> : <Trash2 size={13} aria-hidden />}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {hasMoreToReveal ? (
        <div
          ref={loadMoreSentinelRef}
          className="mt-3 space-y-2"
          data-studio-character-library-load-more
        >
          <p className="text-center text-[0.68rem] text-fg-3" aria-live="polite">
            {isLoadingMore
              ? "다음 캐릭터를 불러오는 중…"
              : canExpandLocal
                ? `스크롤하면 자동으로 더 표시 · ${hiddenEntryCount}명 남음`
                : "스크롤하면 저장된 캐릭터를 이어서 불러옵니다"}
          </p>
          {/* Manual fallback for keyboard / reduced-motion / IO-less environments (Explore 동일). */}
          <button
            type="button"
            className={cx(
              CONTROL_BUTTON,
              "w-full border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
            )}
            disabled={isLoadingMore && canFetchRemote}
            aria-busy={isLoadingMore || undefined}
            onClick={revealMoreCharacters}
          >
            {isLoadingMore ? <Loader2 className="animate-spin" size={14} aria-hidden /> : null}
            {canExpandLocal
              ? (
                <>
                  캐릭터 {Math.min(LIBRARY_BATCH_SIZE, hiddenEntryCount)}명 더 보기
                  <span className="text-fg-3">· {hiddenEntryCount}명 남음</span>
                </>
              )
              : "저장된 캐릭터 다음 페이지 불러오기"}
          </button>
        </div>
      ) : filteredEntries.length > LIBRARY_BATCH_SIZE ? (
        <button
          type="button"
          className={cx(CONTROL_BUTTON, "mt-3 w-full border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
          onClick={() => {
            setVisibleCount(LIBRARY_BATCH_SIZE);
            onCollapse();
          }}
        >
          처음 {LIBRARY_BATCH_SIZE}명만 보기
        </button>
      ) : null}
    </section>
  );
}
