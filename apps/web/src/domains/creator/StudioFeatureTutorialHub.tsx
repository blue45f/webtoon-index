/**
 * 기능별 튜토리얼 허브 — 목록 + 단계 카드 + 따라 해보기.
 * StudioShortcutsHelp 와 같은 모달 계약(포커스·Esc·포털).
 */
import { BookOpen, Check, ChevronLeft, ChevronRight, Search, Sparkles, X } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";

import { studioTutorialSourceCopy } from "./studio-feature-tutorial-en-fallbacks";
import {
  groupStudioFeatureTutorials,
  isTutorialCompleted,
  markTutorialCompleted,
  STUDIO_FEATURE_TUTORIAL_BY_ID,
  STUDIO_FEATURE_TUTORIALS,
  tutorialCompletionRatio,
  emptyTutorialProgress,
  type StudioFeatureTutorial,
  type StudioTutorialCategory,
  type StudioTutorialProgress,
  type StudioTutorialTryAction,
} from "./studio-feature-tutorials";
import {
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";
import {
  acquireProductStudioTutorialProgressRepository,
  type StudioTutorialProgressRepository,
} from "./studio-tutorial-progress-sqlite";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

function localizeText(
  _fallback: string,
  key: string,
  t: (key: string) => string,
  preferFallback = false,
): string {
  if (preferFallback) return _fallback;
  const translated = t(key);
  return translated === key ? _fallback : translated;
}

const TUTORIAL_SEARCH_COPY = {
  ko: {
    label: "기능 튜토리얼 검색",
    placeholder: "기능이나 하고 싶은 일을 검색하세요",
    clear: "튜토리얼 검색어 지우기",
    result: (count: number) => `검색 결과 ${count}개`,
    all: (count: number) => `전체 기능 ${count}개`,
    emptyTitle: "찾는 기능이 없어요",
    emptyDescription: "‘밝게’, ‘색 섞기’, ‘말풍선’처럼 하고 싶은 결과로 검색해 보세요.",
    emptyDetailTitle: "검색 결과를 찾지 못했어요",
    emptyDetailDescription: "검색어를 지우면 카테고리와 진행도는 그대로 유지됩니다.",
    showAll: "전체 기능 보기",
  },
  en: {
    label: "Search feature tutorials",
    placeholder: "Search for a feature or what you want to do",
    clear: "Clear tutorial search",
    result: (count: number) => `${count} search result${count === 1 ? "" : "s"}`,
    all: (count: number) => `${count} features`,
    emptyTitle: "No matching feature",
    emptyDescription: "Try the result you want, such as brighten, mix color, or speech bubble.",
    emptyDetailTitle: "No tutorial found",
    emptyDetailDescription: "Clear the search to keep your categories and progress.",
    showAll: "Show all features",
  },
} as const;

const STUDIO_CATEGORY_LABEL_KEYS: Record<StudioTutorialCategory, string> = {
  drawing: "studio.tutorial.category.drawing",
  adjustments: "studio.tutorial.category.adjustments",
  dialogue: "studio.tutorial.category.dialogue",
  composition: "studio.tutorial.category.composition",
  threed: "studio.tutorial.category.threed",
  aiExport: "studio.tutorial.category.aiExport",
};

function localizedTutorialBadge(
  badge: string,
  localizedTitle: string,
  preferKoreanSource: boolean,
): string {
  if (preferKoreanSource) return badge;
  const words = localizedTitle.match(/[a-z0-9]+/giu) ?? [];
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toLocaleUpperCase();
  return words[0]?.slice(0, 2).toLocaleUpperCase() || "•";
}

function localizedTutorialSearchText(
  tutorial: StudioFeatureTutorial,
  t: (key: string) => string,
  preferKoreanSource: boolean,
): string {
  const source = studioTutorialSourceCopy(tutorial, preferKoreanSource);
  const localizedSteps = source.steps.flatMap((step, index) => [
    localizeText(
      step.title,
      `studio.tutorial.${tutorial.id}.step.${index + 1}.title`,
      t,
    ),
    localizeText(
      step.body,
      `studio.tutorial.${tutorial.id}.step.${index + 1}.body`,
      t,
    ),
    step.tip
      ? localizeText(
          step.tip,
          `studio.tutorial.${tutorial.id}.step.${index + 1}.tip`,
          t,
        )
      : "",
  ]);

  return [
    source.title,
    source.summary,
    ...source.steps.flatMap((step) => [step.title, step.body, step.tip ?? ""]),
    localizeText(source.title, `studio.tutorial.${tutorial.id}.title`, t),
    localizeText(source.summary, `studio.tutorial.${tutorial.id}.summary`, t),
    ...localizedSteps,
  ].join(" ");
}

/**
 * 매칭 규칙은 통합 Command Search 와 같은 `studio-search-text` 를 쓴다. 코퍼스만
 * 여기 고유(원문 ko + 로케일 문자열 양쪽)로 남는다.
 */
function filterStudioFeatureTutorials(
  tutorials: readonly StudioFeatureTutorial[],
  query: string,
  t: (key: string) => string,
  preferKoreanSource: boolean,
): StudioFeatureTutorial[] {
  if (tokenizeStudioSearchQuery(query).length === 0) return [...tutorials];
  return tutorials.filter((tutorial) =>
    studioSearchTextMatches(query, [
      localizedTutorialSearchText(tutorial, t, preferKoreanSource),
    ])
  );
}

export type StudioFeatureTutorialHubProps = {
  open: boolean;
  onClose: () => void;
  /** 초기 선택 튜토리얼. 없으면 진행 상태 lastId 또는 첫 항목. */
  initialTutorialId?: string | null;
  /** 「따라 해보기」— 해당 도구/메뉴를 StudioPage 가 연다. */
  onTryAction?: (
    action: StudioTutorialTryAction,
    trigger: HTMLButtonElement,
  ) => void;
  /** Test seam; product defaults to the shared SQLite/OPFS authority. */
  acquireProgressRepository?: () => Promise<StudioTutorialProgressRepository>;
};

function resolveInitialId(preferred?: string | null, progress?: StudioTutorialProgress): string {
  if (preferred && STUDIO_FEATURE_TUTORIAL_BY_ID.has(preferred)) return preferred;
  if (progress?.lastId && STUDIO_FEATURE_TUTORIAL_BY_ID.has(progress.lastId)) return progress.lastId;
  return STUDIO_FEATURE_TUTORIALS[0]!.id;
}

export function StudioFeatureTutorialHub({
  open,
  onClose,
  initialTutorialId = null,
  onTryAction,
  acquireProgressRepository = acquireProductStudioTutorialProgressRepository,
}: StudioFeatureTutorialHubProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeFromEffect = useEffectEvent(onClose);

  const [progress, setProgress] = useState<StudioTutorialProgress>(() => emptyTutorialProgress());
  const [activeId, setActiveId] = useState(() => resolveInitialId(initialTutorialId));
  const [preferenceAuthority, setPreferenceAuthority] = useState<
    "loading" | "sqlite-opfs" | "memory-only"
  >("loading");
  const progressRepositoryRef = useRef<StudioTutorialProgressRepository | null>(null);
  const progressDirtyRef = useRef(false);
  const progressLoadGenerationRef = useRef(0);
  const progressMountedRef = useRef(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const t = useT();
  const language = useI18n((state) => state.lang);
  const preferSourceCopy = language.toLocaleLowerCase().startsWith("ko");
  const searchCopy = preferSourceCopy ? TUTORIAL_SEARCH_COPY.ko : TUTORIAL_SEARCH_COPY.en;

  useEffect(() => {
    progressMountedRef.current = true;
    return () => { progressMountedRef.current = false; };
  }, []);

  const visibleTutorials = filterStudioFeatureTutorials(
    STUDIO_FEATURE_TUTORIALS,
    searchQuery,
    t,
    preferSourceCopy,
  );
  const active = visibleTutorials.find((tutorial) => tutorial.id === activeId)
    ?? visibleTutorials[0]
    ?? STUDIO_FEATURE_TUTORIAL_BY_ID.get(activeId)
    ?? STUDIO_FEATURE_TUTORIALS[0]!;
  const activeSource = studioTutorialSourceCopy(active, preferSourceCopy);
  const steps = activeSource.steps;
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const groups = groupStudioFeatureTutorials(visibleTutorials);
  const hasSearchResults = visibleTutorials.length > 0;
  const { done, total } = tutorialCompletionRatio(progress);
  const completed = isTutorialCompleted(progress, active.id);
  const isLastStep = stepIndex >= steps.length - 1;

  // open 시 초기 튜토리얼·진행 동기화
  useEffect(() => {
    if (!open) return;
    const generation = progressLoadGenerationRef.current + 1;
    progressLoadGenerationRef.current = generation;
    setPreferenceAuthority("loading");
    void acquireProgressRepository()
      .then(async (repository) => {
        progressRepositoryRef.current = repository;
        const nextProgress = await repository.load();
        if (!progressMountedRef.current || progressLoadGenerationRef.current !== generation) return;
        setPreferenceAuthority("sqlite-opfs");
        if (!progressDirtyRef.current) {
          setProgress(nextProgress);
          setActiveId(resolveInitialId(initialTutorialId, nextProgress));
        }
      })
      .catch(() => {
        if (progressMountedRef.current && progressLoadGenerationRef.current === generation) {
          setPreferenceAuthority("memory-only");
        }
      });
    if (!progressDirtyRef.current) setActiveId(resolveInitialId(initialTutorialId));
    setStepIndex(0);
    setSearchQuery("");
  }, [acquireProgressRepository, open, initialTutorialId]);

  function persistProgress(next: StudioTutorialProgress): void {
    progressDirtyRef.current = true;
    const save = progressRepositoryRef.current
      ? progressRepositoryRef.current.save(next)
      : acquireProgressRepository().then((repository) => {
          progressRepositoryRef.current = repository;
          return repository.save(next);
        });
    void save
      .then(() => {
        if (progressMountedRef.current) setPreferenceAuthority("sqlite-opfs");
      })
      .catch(() => {
        if (progressMountedRef.current) setPreferenceAuthority("memory-only");
      });
  }

  // 진짜 modal 계약: 포커스 진입·순환·복원, 배경 inert, html/body 스크롤 잠금을 함께 관리한다.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const overlay = overlayRef.current;
    const inertStates: Array<readonly [HTMLElement, boolean]> = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      inertStates.push([child, child.inert]);
      child.inert = true;
    }
    const focusFrame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFromEffect();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const [element, wasInert] of inertStates) element.inert = wasInert;
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  function selectTutorial(tutorial: StudioFeatureTutorial) {
    setActiveId(tutorial.id);
    setStepIndex(0);
    const next = { ...progress, lastId: tutorial.id };
    setProgress(next);
    persistProgress(next);
  }

  function updateSearchQuery(nextQuery: string) {
    const matches = filterStudioFeatureTutorials(
      STUDIO_FEATURE_TUTORIALS,
      nextQuery,
      t,
      preferSourceCopy,
    );
    setSearchQuery(nextQuery);
    if (matches.length === 0 || matches.some((tutorial) => tutorial.id === activeId)) return;
    setActiveId(matches[0]!.id);
    setStepIndex(0);
  }

  function goNext() {
    if (!isLastStep) {
      setStepIndex((i) => i + 1);
      return;
    }
    const next = markTutorialCompleted(progress, active.id);
    setProgress(next);
    persistProgress(next);
  }

  function goPrev() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function handleTry(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!active.tryAction || !onTryAction) return;
    onTryAction(active.tryAction, event.currentTarget);
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      role="presentation"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[oklch(0.12_0.01_70_/_0.55)] p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onPointerDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-tutorial-title"
        data-studio-tutorial-progress-authority={preferenceAuthority}
        tabIndex={-1}
        className="flex max-h-[min(92dvh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line/70 bg-panel pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl sm:pb-0"
      >
        {/* header */}
        <div className="relative shrink-0 overflow-hidden border-b border-line/50 bg-gradient-to-br from-accent-soft/40 via-card/50 to-panel px-4 py-3">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-accent/10 blur-2xl"
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent-soft text-accent">
                <BookOpen className="size-[18px]" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <h2 id="studio-tutorial-title" className="text-[0.95rem] font-semibold tracking-tight text-fg">
                  {t("studio.hub.title")}
                </h2>
                <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                  {localizeText(
                    "부담 없이 한 기능씩. {done}/{total}개 살펴봤어요.",
                    "studio.hub.subtitle",
                    t,
                  ).replace("{done}", done.toString()).replace("{total}", total.toString())}
                </p>
                <div
                  className="mt-2 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-canvas/70 ring-1 ring-line/40"
                  role="progressbar"
                  aria-valuenow={done}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-label={t("studio.hub.progressAriaLabel")}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                    style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-line/60 bg-card/70 text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-9 pointer-coarse:size-11"
              aria-label={t("common.close")}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>

        {preferenceAuthority === "memory-only" ? (
          <p
            aria-live="polite"
            data-studio-tutorial-persistence-status="memory-only"
            className="shrink-0 border-b border-warning/35 bg-warning/10 px-4 py-1.5 text-[0.65rem] text-fg-2"
          >
            {preferSourceCopy
              ? "튜토리얼 진행도는 저장소를 다시 연결하기 전까지 이번 탭에서만 유지됩니다."
              : "Tutorial progress stays in this tab until local storage is available again."}
          </p>
        ) : null}

        {/* body: list + detail */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={t("studio.hub.listAriaLabel")}
            className="max-h-[min(36dvh,16rem)] shrink-0 overflow-y-auto border-b border-line/45 md:max-h-none md:min-h-0 md:w-[13.5rem] md:border-b-0 md:border-r md:border-line/45"
          >
            <div className="sticky top-0 z-10 border-b border-line/45 bg-panel/95 p-2.5 backdrop-blur-sm">
              <div className="relative">
                <label htmlFor="studio-tutorial-search" className="sr-only">
                  {searchCopy.label}
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-3"
                  aria-hidden
                />
                <input
                  id="studio-tutorial-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => updateSearchQuery(event.currentTarget.value)}
                  placeholder={searchCopy.placeholder}
                  aria-label={searchCopy.label}
                  aria-controls="studio-tutorial-search-results"
                  className="min-h-11 w-full rounded-xl border border-line bg-card py-2 pl-9 pr-9 text-xs text-fg outline-none placeholder:text-fg-3 focus-visible:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/35 md:min-h-9 pointer-coarse:min-h-11"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => updateSearchQuery("")}
                    aria-label={searchCopy.clear}
                    className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:size-9 pointer-coarse:size-11"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 px-1 text-[0.66rem] text-fg-3" role="status" aria-live="polite">
                {searchQuery.trim()
                  ? searchCopy.result(visibleTutorials.length)
                  : searchCopy.all(STUDIO_FEATURE_TUTORIALS.length)}
              </p>
            </div>

            <div id="studio-tutorial-search-results" className="space-y-2.5 p-2.5">
              {hasSearchResults ? groups.map((group) => (
                <div key={group.category}>
                  <p className="mb-1 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-fg-3">
                    {t(STUDIO_CATEGORY_LABEL_KEYS[group.category] ?? group.category)}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = item.id === active.id;
                      const isDone = isTutorialCompleted(progress, item.id);
                      const itemSource = studioTutorialSourceCopy(item, preferSourceCopy);
                      const localizedTitle = localizeText(
                        itemSource.title,
                        `studio.tutorial.${item.id}.title`,
                        t,
                        preferSourceCopy,
                      );
                      const localizedBadge = localizedTutorialBadge(
                        item.badge,
                        localizedTitle,
                        preferSourceCopy,
                      );
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => selectTutorial(item)}
                            aria-label={localizedTitle}
                            aria-current={isActive ? "true" : undefined}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 md:min-h-9 pointer-coarse:min-h-11",
                              isActive
                                ? "bg-accent-soft/70 text-fg ring-1 ring-accent/30"
                                : "text-fg-2 hover:bg-raised/80 hover:text-fg"
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-7 shrink-0 place-items-center rounded-lg text-[0.6rem] font-bold",
                                isActive ? "bg-accent/20 text-accent" : "bg-canvas/60 text-fg-3 ring-1 ring-line/40"
                              )}
                            >
                              {localizedBadge}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.72rem] font-semibold tracking-tight">
                                {localizedTitle}
                              </span>
                            </span>
                            {isDone ? (
                              <Check className="size-3.5 shrink-0 text-good" aria-label={t("studio.hub.completed")} />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )) : (
                <div className="px-2 py-5 text-center">
                  <Search className="mx-auto size-5 text-fg-3" aria-hidden />
                  <p className="mt-2 text-xs font-semibold text-fg-2">{searchCopy.emptyTitle}</p>
                  <p className="mx-auto mt-1 max-w-[18rem] text-[0.7rem] leading-relaxed text-fg-3 text-pretty">
                    {searchCopy.emptyDescription}
                  </p>
                  <button
                    type="button"
                    onClick={() => updateSearchQuery("")}
                    className="mt-3 min-h-11 rounded-xl border border-line px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:min-h-9 pointer-coarse:min-h-11"
                  >
                    {searchCopy.showAll}
                  </button>
                </div>
              )}
            </div>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {hasSearchResults ? (
            <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-accent-soft/60 px-2 py-0.5 text-[0.6rem] font-semibold text-accent ring-1 ring-accent/20">
                {t(STUDIO_CATEGORY_LABEL_KEYS[active.category] ?? active.category)}
                </span>
                {completed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 text-[0.6rem] font-semibold text-good ring-1 ring-good/25">
                    <Check className="size-3" aria-hidden />
                    {t("studio.hub.checked")}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-fg">
                {localizeText(
                  activeSource.title,
                  `studio.tutorial.${active.id}.title`,
                  t,
                  preferSourceCopy,
                )}
              </h3>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-3">
                {localizeText(
                  activeSource.summary,
                  `studio.tutorial.${active.id}.summary`,
                  t,
                  preferSourceCopy,
                )}
              </p>

              {/* step dots */}
              <div
                className="mt-2 flex items-center gap-0.5"
                aria-label={`${t("studio.hub.stepAriaPrefix")} ${stepIndex + 1} / ${steps.length}`}
              >
                {steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-label={`${t("studio.hub.stepAriaPrefix")} ${i + 1}`}
                    aria-current={i === stepIndex ? "step" : undefined}
                    className="grid size-11 shrink-0 place-items-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:size-9 pointer-coarse:size-11"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 rounded-full transition-[width,background] duration-200 ease-out",
                        i === stepIndex ? "w-6 bg-accent" : i < stepIndex ? "w-3 bg-accent/45" : "w-3 bg-line"
                      )}
                    />
                  </button>
                ))}
              </div>

              <article
                key={`${active.id}-${stepIndex}`}
                className="mt-3 rounded-2xl border border-line/50 bg-gradient-to-b from-card/90 to-canvas/25 p-3.5 shadow-[inset_0_1px_0_oklch(0.95_0.02_85_/_0.05)]"
              >
                <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-fg-3">
                  {stepIndex + 1} / {steps.length}
                </p>
                <h4 className="mt-1 text-[0.92rem] font-semibold tracking-tight text-fg">
                  {localizeText(
                    step.title,
                    `studio.tutorial.${active.id}.step.${stepIndex + 1}.title`,
                    t,
                    preferSourceCopy,
                  )}
                </h4>
                <p className="mt-1.5 text-[0.8rem] leading-relaxed text-fg-2">
                  {localizeText(
                    step.body,
                    `studio.tutorial.${active.id}.step.${stepIndex + 1}.body`,
                    t,
                    preferSourceCopy,
                  )}
                </p>
                {step.tip ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-accent-soft/35 px-2.5 py-2 text-[0.7rem] leading-snug text-fg-2 ring-1 ring-accent/15">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                    <span>
                      {localizeText(
                        step.tip,
                        `studio.tutorial.${active.id}.step.${stepIndex + 1}.tip`,
                        t,
                        preferSourceCopy,
                      )}
                    </span>
                  </p>
                ) : null}
              </article>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line/50 bg-canvas/20 px-3 py-2.5">
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIndex === 0}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 text-[0.75rem] font-semibold transition-colors sm:min-h-9 pointer-coarse:min-h-11",
                  stepIndex === 0
                    ? "cursor-not-allowed border-line/40 text-fg-3"
                    : "border-line/60 bg-card text-fg-2 hover:bg-raised"
                )}
              >
                <ChevronLeft className="size-4" aria-hidden />
                {t("studio.hub.prev")}
              </button>

              <div className="flex flex-wrap items-center gap-1.5">
                {active.tryAction && onTryAction ? (
                  <button
                    type="button"
                    onClick={handleTry}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft/50 px-3 text-[0.75rem] font-semibold text-accent transition-colors hover:bg-accent-soft sm:min-h-9 pointer-coarse:min-h-11"
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {localizeText(
                      activeSource.tryLabel ?? "",
                      `studio.tutorial.${active.id}.tryLabel`,
                      t,
                      preferSourceCopy,
                    ) ||
                      t("studio.hub.tryLabelDefault")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-accent px-3.5 text-[0.75rem] font-semibold text-on-accent transition-opacity hover:opacity-95 sm:min-h-9 pointer-coarse:min-h-11"
                >
                  {isLastStep ? (completed ? t("studio.hub.completed") : t("studio.hub.markComplete")) : t("studio.hub.next")}
                  {!isLastStep ? <ChevronRight className="size-4" aria-hidden /> : null}
                </button>
              </div>
            </div>
            </>
            ) : (
              <div className="grid min-h-[12rem] flex-1 place-items-center p-6 text-center">
                <div className="max-w-sm">
                  <Search className="mx-auto size-6 text-fg-3" aria-hidden />
                  <p className="mt-2 text-sm font-semibold text-fg-2">
                    {searchCopy.emptyDetailTitle}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3 text-pretty">
                    {searchCopy.emptyDetailDescription}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
