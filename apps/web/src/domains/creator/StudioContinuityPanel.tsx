import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  ListChecks,
  LoaderCircle,
  MapPin,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { loadStudioQualityReviewState, saveStudioQualityReviewState } from "./quality-review-store";
import { inspectStudioQualityFinishSupplement } from "./studio-quality-finish-bridge";
import {
  inspectStudioQuality,
  type StudioQualityCategory,
  type StudioQualityIssue,
  type StudioQualityIssueTarget,
  type StudioQualitySeverity,
} from "./studio-quality-inspection";
import {
  inspectStudioRasterAssets,
  type StudioRasterInspectionProgress,
  type StudioRasterInspectionResult,
} from "./studio-quality-raster-inspection";
import { StudioFinishQualityView } from "./StudioFinishQualityView";

import type { StudioCommentsDocument } from "./studio-comments";
import type { StudioContinuityIssue } from "./studio-continuity";
import type { PageState } from "./studio-page-state";

const CATEGORY_LABELS: Readonly<Record<StudioQualityCategory, string>> = {
  document: "문서 무결성",
  layout: "배치·스크롤",
  lettering: "대사·식자",
  layer: "레이어",
  asset: "이미지·소재",
  workflow: "검토 흐름",
  continuity: "이야기 연속성",
};

const SEVERITY_META: Readonly<
  Record<
    StudioQualitySeverity,
    {
      label: string;
      description: string;
      badgeClass: string;
      iconClass: string;
    }
  >
> = {
  blocking: {
    label: "차단",
    description: "문서 손상이나 원본 누락처럼 내보내기 전에 반드시 해결해야 합니다.",
    badgeClass: "border-bad/45 bg-bad/12 text-bad",
    iconClass: "text-bad",
  },
  error: {
    label: "오류",
    description: "독자 화면이나 검토 결과에 직접 영향을 줄 가능성이 높습니다.",
    badgeClass: "border-bad/35 bg-bad/10 text-bad",
    iconClass: "text-bad",
  },
  warning: {
    label: "경고",
    description: "마감 전에 수정하거나 의도된 상태인지 확인해야 합니다.",
    badgeClass: "border-warning/40 bg-warning-soft/20 text-warning",
    iconClass: "text-warning",
  },
  review: {
    label: "확인",
    description: "자동 판정하기 어려운 연출이므로 실제 미리보기에서 판단해야 합니다.",
    badgeClass: "border-line bg-card text-fg-2",
    iconClass: "text-fg-2",
  },
};

const SEVERITY_ORDER: readonly StudioQualitySeverity[] = [
  "blocking",
  "error",
  "warning",
  "review",
];

const MANUAL_CHECKS = [
  {
    id: "mobile",
    title: "모바일 독자 폭",
    description: "360px·390px·430px 폭에서 대사, 얼굴, 컷 전환을 확인했습니다.",
    icon: Smartphone,
  },
  {
    id: "zoom",
    title: "100%·200% 확대",
    description: "선 끊김, 톤 모아레, 래스터 계단, 경계 누락을 확대해 확인했습니다.",
    icon: Eye,
  },
  {
    id: "scroll",
    title: "연속 스크롤 낭독",
    description: "처음부터 끝까지 실제 속도로 읽으며 여백·호흡·시선 흐름을 확인했습니다.",
    icon: ListChecks,
  },
  {
    id: "color",
    title: "색상·흑백 확인",
    description: "밝기 대비, 흑백 변환, 색각 시뮬레이션에서 정보가 유지되는지 확인했습니다.",
    icon: Eye,
  },
  {
    id: "rights",
    title: "소재·AI 출처",
    description: "폰트·사진·소재·AI 생성물의 권리와 필요한 표기 정보를 확인했습니다.",
    icon: ShieldCheck,
  },
  {
    id: "destination",
    title: "게시처 최신 규격",
    description: "업로드 직전에 선택한 게시처의 최신 크기·용량·정책을 직접 확인했습니다.",
    icon: ClipboardCheck,
  },
] as const;

type ManualCheckId = (typeof MANUAL_CHECKS)[number]["id"];
type SeverityFilter = "all" | StudioQualitySeverity;
type ScopeFilter = "all" | "current";

interface PersistedQualityState {
  readonly acknowledgedIssueIds?: readonly string[];
  readonly manualCheckIds?: readonly ManualCheckId[];
  readonly manualRevisionKey?: string;
}

export interface StudioContinuityScene {
  id: string;
  label: string;
}

export interface StudioContinuityPanelProps {
  open: boolean;
  onClose: () => void;
  issues: readonly StudioContinuityIssue[];
  pages?: readonly PageState[];
  /** Host-owned metadata enables additive rules without replacing legacy inspection. */
  finishDocumentTitle?: string;
  finishComments?: StudioCommentsDocument;
  currentPageId?: string;
  openCommentCount?: number;
  /** Work ID or another stable document key used only for local acknowledgements/checklist state. */
  documentKey?: string;
  /** 장면 id를 사용자용 이름으로 바꿀 때 사용합니다. 같은 id가 scenes에도 있으면 이 값이 우선합니다. */
  sceneLabels?: Readonly<Record<string, string>>;
  /** 장면 id/이름 목록. sceneLabels 대신 전달할 수 있습니다. */
  scenes?: readonly StudioContinuityScene[];
  /** 전달하면 연속성 장면 참조가 이동 버튼으로 렌더링됩니다. */
  onSelectScene?: (sceneId: string) => void;
  /** 문서·레이어·식자 문제의 페이지/요소로 이동합니다. */
  onSelectTarget?: (target: StudioQualityIssueTarget) => void;
  /** 기존 세로 스크롤 미리보기 도구로 이어지는 통합 동선입니다. */
  onOpenScrollPreview?: () => void;
  /** 기존 게시 규격 사전검사 도구로 이어지는 통합 동선입니다. */
  onOpenPublishPreflight?: () => void;
}

function resolveSceneLabel(
  sceneId: string,
  sceneLabels: Readonly<Record<string, string>> | undefined,
  scenes: readonly StudioContinuityScene[] | undefined
): string {
  const mapped = sceneLabels?.[sceneId]?.trim();
  if (mapped) return mapped;
  const listed = scenes?.find((scene) => scene.id === sceneId)?.label.trim();
  return listed || sceneId;
}

function safeStorageKey(documentKey: string | undefined): string | null {
  const normalized = documentKey?.trim();
  // Never let anonymous drafts or truncated keys share a review receipt. v2 intentionally
  // does not import v1 decisions, whose document/revision ownership was not guaranteed.
  return normalized ? `toonstudio:quality-inspection:v2:${encodeURIComponent(normalized)}` : null;
}

async function readPersistedState(storageKey: string): Promise<PersistedQualityState> {
  const serialized = await loadStudioQualityReviewState(storageKey);
  if (serialized === null) return {};
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("검토 기록 형식이 올바르지 않습니다.");
  }
  const record = parsed as Record<string, unknown>;
  if ((record.acknowledgedIssueIds !== undefined && !Array.isArray(record.acknowledgedIssueIds)) ||
      (record.manualCheckIds !== undefined && !Array.isArray(record.manualCheckIds)) ||
      (record.manualRevisionKey !== undefined && typeof record.manualRevisionKey !== "string")) {
    throw new Error("검토 기록을 안전하게 복원할 수 없습니다.");
  }
  return {
    acknowledgedIssueIds: Array.isArray(record.acknowledgedIssueIds)
      ? record.acknowledgedIssueIds.filter((id): id is string => typeof id === "string") : [],
    manualCheckIds: Array.isArray(record.manualCheckIds)
      ? record.manualCheckIds.filter((id): id is ManualCheckId => MANUAL_CHECKS.some((check) => check.id === id)) : [],
    manualRevisionKey: typeof record.manualRevisionKey === "string" ? record.manualRevisionKey : undefined,
  };
}

function pageLabel(
  issue: StudioQualityIssue,
  pages: readonly PageState[]
): string | null {
  if (typeof issue.pageIndex === "number") {
    const page = pages[issue.pageIndex];
    return page?.name?.trim() || `${issue.pageIndex + 1}페이지`;
  }
  if (!issue.pageId) return null;
  const index = pages.findIndex((page) => page.id === issue.pageId);
  if (index < 0) return issue.pageId;
  return pages[index]?.name?.trim() || `${index + 1}페이지`;
}

function issueMatchesQuery(
  issue: StudioQualityIssue,
  pages: readonly PageState[],
  query: string
): boolean {
  if (!query) return true;
  const haystack = [
    issue.title,
    issue.message,
    issue.remediation,
    issue.code,
    CATEGORY_LABELS[issue.category],
    pageLabel(issue, pages) ?? "",
  ]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function downloadReport(
  report: ReturnType<typeof inspectStudioQuality>,
  acknowledgedIssueIds: ReadonlySet<string>,
  completedManualChecks: ReadonlySet<ManualCheckId>,
  documentKey: string | undefined
): void {
  if (typeof document === "undefined") return;
  const payload = {
    ...report,
    generatedAt: new Date().toISOString(),
    documentKey: documentKey ?? null,
    acknowledgedIssueIds: [...acknowledgedIssueIds].sort(),
    manualChecklist: MANUAL_CHECKS.map((check) => ({
      id: check.id,
      title: check.title,
      completed: completedManualChecks.has(check.id),
    })),
    openIssues: report.issues.filter((issue) => !acknowledgedIssueIds.has(issue.id)),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "toonstudio-quality-inspection.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function IssueIcon({ severity }: { severity: StudioQualitySeverity }) {
  if (severity === "blocking" || severity === "error") {
    return <XCircle size={16} aria-hidden />;
  }
  if (severity === "warning") {
    return <AlertTriangle size={16} aria-hidden />;
  }
  return <Eye size={16} aria-hidden />;
}

const EMPTY_PAGES: readonly PageState[] = [];

export function StudioContinuityPanel({
  open,
  onClose,
  issues,
  pages = EMPTY_PAGES,
  finishDocumentTitle,
  finishComments,
  currentPageId,
  openCommentCount = 0,
  documentKey,
  sceneLabels,
  scenes,
  onSelectScene,
  onSelectTarget,
  onOpenScrollPreview,
  onOpenPublishPreflight,
}: StudioContinuityPanelProps) {
  const [scanEpoch, setScanEpoch] = useState(0);
  const [rasterInspection, setRasterInspection] =
    useState<StudioRasterInspectionResult | null>(null);
  const [rasterProgress, setRasterProgress] =
    useState<StudioRasterInspectionProgress>({ completed: 0, total: 0 });
  const [rasterBusy, setRasterBusy] = useState(false);
  const [visibleIssueLimit, setVisibleIssueLimit] = useState(100);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | StudioQualityCategory>("all");
  const [query, setQuery] = useState("");
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [storedAcknowledgedIssueIds, setAcknowledgedIssueIds] = useState<Set<string>>(
    () => new Set()
  );
  const [storedCompletedManualChecks, setCompletedManualChecks] = useState<Set<ManualCheckId>>(
    () => new Set()
  );
  const storageKey = useMemo(() => safeStorageKey(documentKey), [documentKey]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [writableReviewKey, setWritableReviewKey] = useState<string | null>(null);
  const [reviewPersistence, setReviewPersistence] = useState<"loading" | "saved" | "saving" | "memory">("loading");

  // A rescan is a new measurement request even when the immutable pages did not change.
  const scanInput = useMemo(() => ({ pages, epoch: scanEpoch }), [pages, scanEpoch]);
  const finishSupplement = useMemo(() =>
    finishDocumentTitle === undefined && finishComments === undefined ? null :
      inspectStudioQualityFinishSupplement({
        pages: scanInput.pages, documentTitle: finishDocumentTitle, comments: finishComments,
      }),
    [finishComments, finishDocumentTitle, scanInput]
  );
  const report = useMemo(
    () =>
      inspectStudioQuality({
        pages: scanInput.pages,
        continuityIssues: issues,
        openCommentCount,
        supplementalIssues: [
          ...(finishSupplement?.issues ?? []),
          ...(rasterInspection?.status === "complete" ? rasterInspection.issues : []),
        ],
      }),
    [issues, openCommentCount, scanInput, rasterInspection, finishSupplement]
  );
  const currentReviewKey = `${storageKey}:${report.revisionKey}`;
  const reviewStateReady = loadedStorageKey === currentReviewKey;
  const acknowledgedIssueIds = useMemo(() => new Set(
    loadedStorageKey === currentReviewKey
      ? report.issues.filter((issue) =>
          (issue.severity === "warning" || issue.severity === "review") &&
          storedAcknowledgedIssueIds.has(issue.id)).map((issue) => issue.id)
      : []
  ), [currentReviewKey, loadedStorageKey, report.issues, storedAcknowledgedIssueIds]);
  const completedManualChecks = useMemo(() =>
    loadedStorageKey === currentReviewKey ? storedCompletedManualChecks : new Set<ManualCheckId>(),
    [currentReviewKey, loadedStorageKey, storedCompletedManualChecks]
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRasterBusy(true);
    setRasterInspection(null);
    setRasterProgress({ completed: 0, total: 0 });
    void inspectStudioRasterAssets(scanInput.pages, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setRasterProgress(progress);
      },
    })
      .then((result) => {
        if (!controller.signal.aborted && result.status !== "aborted") setRasterInspection(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRasterInspection({
            status: "unavailable",
            issues: [],
            assetReferenceCount: 0,
            probedSourceCount: 0,
            skippedSourceCount: 0,
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRasterBusy(false);
      });
    return () => controller.abort();
  }, [open, scanInput]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const reviewKey = `${storageKey}:${report.revisionKey}`;
    setLoadedStorageKey(null);
    setWritableReviewKey(null);
    setReviewPersistence(storageKey === null ? "memory" : "loading");
    const restore = (persisted: PersistedQualityState, durable: boolean) => {
      if (!active) return;
      const sameRevision = persisted.manualRevisionKey === report.revisionKey;
      setAcknowledgedIssueIds(new Set(sameRevision ? persisted.acknowledgedIssueIds ?? [] : []));
      setCompletedManualChecks(new Set(sameRevision ? persisted.manualCheckIds ?? [] : []));
      setLoadedStorageKey(reviewKey);
      setWritableReviewKey(durable ? reviewKey : null);
      setReviewPersistence(durable ? "saved" : "memory");
    };
    if (storageKey === null) {
      restore({}, false);
    } else {
      void readPersistedState(storageKey)
        .then((persisted) => restore(persisted, true))
        .catch(() => restore({}, false));
    }
    return () => { active = false; };
  }, [open, report.revisionKey, storageKey]);

  useEffect(() => {
    if (storageKey === null || loadedStorageKey !== currentReviewKey || writableReviewKey !== currentReviewKey) return;
    let active = true;
    const payload: PersistedQualityState = {
      acknowledgedIssueIds: [...acknowledgedIssueIds].sort(),
      manualCheckIds: [...completedManualChecks].sort(),
      manualRevisionKey: report.revisionKey,
    };
    setReviewPersistence("saving");
    void saveStudioQualityReviewState(storageKey, JSON.stringify(payload))
      .then(() => { if (active) setReviewPersistence("saved"); })
      .catch(() => { if (active) setReviewPersistence("memory"); });
    return () => { active = false; };
  }, [acknowledgedIssueIds, completedManualChecks, currentReviewKey, loadedStorageKey, report.revisionKey, storageKey, writableReviewKey]);

  useEffect(() => {
    const validIds = new Set(
      report.issues
        .filter((issue) => issue.severity === "warning" || issue.severity === "review")
        .map((issue) => issue.id)
    );
    setAcknowledgedIssueIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [report.issues]);

  const normalizedQuery = query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();

  const visibleIssues = useMemo(
    () =>
      report.issues.filter((issue) => {
        if (!showAcknowledged && acknowledgedIssueIds.has(issue.id)) return false;
        if (
          scope === "current" &&
          currentPageId &&
          issue.pageId &&
          issue.pageId !== currentPageId
        ) {
          return false;
        }
        if (severityFilter !== "all" && issue.severity !== severityFilter) return false;
        if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
        return issueMatchesQuery(issue, pages, normalizedQuery);
      }),
    [
      acknowledgedIssueIds,
      categoryFilter,
      currentPageId,
      normalizedQuery,
      pages,
      report.issues,
      scope,
      severityFilter,
      showAcknowledged,
    ]
  );

  useEffect(() => {
    setVisibleIssueLimit(100);
  }, [
    categoryFilter,
    normalizedQuery,
    report.revisionKey,
    scope,
    severityFilter,
    showAcknowledged,
  ]);

  const displayedIssues = visibleIssues.slice(0, visibleIssueLimit);

  const openIssues = report.issues.filter(
    (issue) => !acknowledgedIssueIds.has(issue.id)
  );
  const openCounts = SEVERITY_ORDER.reduce(
    (counts, severity) => ({
      ...counts,
      [severity]: openIssues.filter((issue) => issue.severity === severity).length,
    }),
    { blocking: 0, error: 0, warning: 0, review: 0 } as Record<
      StudioQualitySeverity,
      number
    >
  );
  const manualCompletedCount = completedManualChecks.size;
  const blockingReady = openCounts.blocking === 0 && openCounts.error === 0;
  const reviewOutstanding = openCounts.warning + openCounts.review;
  const hasRasterReferences = pages.some((page) =>
    page.elements.some(
      (element) =>
        (element.type === "image" &&
          Boolean(element.src || element.frames?.some((frame) => frame.src))) ||
        Boolean(element.maskEnabled && element.maskSrc) ||
        Boolean(
          element.type === "image" &&
            element.filterMaskEnabled &&
            element.filterMaskSrc
        )
    )
  );
  // Missing capability, failed probes and incomplete coverage are not a successful scan.
  const rasterPending = hasRasterReferences && (
    rasterBusy || rasterInspection?.status !== "complete" || rasterInspection.skippedSourceCount > 0
  );
  const automaticReady = blockingReady && reviewOutstanding === 0 && !rasterPending;
  const manualReady = manualCompletedCount === MANUAL_CHECKS.length;
  const ready = automaticReady && manualReady;
  const acknowledgedCount = report.issues.length - openIssues.length;

  if (!open || typeof document === "undefined") return null;

  const navigateToIssue = (issue: StudioQualityIssue) => {
    if (issue.sceneId && onSelectScene) {
      onSelectScene(issue.sceneId);
      return;
    }
    if (!onSelectTarget || (!issue.pageId && !issue.elementId)) return;
    onSelectTarget({
      ...(issue.pageId ? { pageId: issue.pageId } : {}),
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    });
  };

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-quality-title"
      aria-describedby="studio-quality-description"
      data-studio-quality-inspection="true"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="studio-quality-title"
              className="text-base font-bold tracking-tight text-fg"
            >
              마감·품질 검사 센터
            </h2>
            <p
              id="studio-quality-description"
              className="mt-0.5 max-w-[78ch] text-xs leading-relaxed text-fg-2"
            >
              문서 무결성, 이미지 디코딩·해상도, 레이어, 대사 잘림·대비, 컷 간격,
              검토 상태와 이야기 연속성을 한 번에 검사합니다. 자동으로 확정할 수 없는 연출은
              통과시키지 않고 수동 확인으로 분리합니다.
            </p>
            <p className="mt-1 text-xs text-fg-3" role="status">
              {!reviewStateReady ? "검토 기록을 불러오는 중…" : null}
              {reviewStateReady && reviewPersistence === "saving" ? "검토 기록을 SQLite/OPFS에 저장 중…" : null}
              {reviewStateReady && reviewPersistence === "saved" ? "검토 기록: SQLite/OPFS 저장됨" : null}
              {reviewStateReady && reviewPersistence === "memory" ? "검토 기록은 현재 탭에만 보관됩니다. 저장된 원본은 변경하지 않습니다." : null}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 lg:flex" aria-label="마감 검사 요약">
            <span className="rounded-full border border-line bg-card px-2.5 py-1 text-[0.68rem] font-semibold text-fg-2">
              준비도 {report.readinessScore}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${
                ready
                  ? "border-good/40 bg-good/10 text-good"
                  : "border-warning/40 bg-warning-soft/20 text-warning"
              }`}
            >
              {ready ? "마감 준비 완료" : "확인 필요"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="마감·품질 검사 닫기"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-2 transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {finishSupplement?.detail ? (
            <details className="border-b border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-fg">
                추가 마감 검사 상세 · 통합 판정은 검사 요약 기준
              </summary>
              <StudioFinishQualityView
                result={finishSupplement.detail}
                onSelectIssue={onSelectTarget ? (issue) => onSelectTarget({
                  pageId: issue.pageId, elementId: issue.elementId,
                }) : undefined}
                onDownloadReport={() => downloadReport(report, acknowledgedIssueIds, completedManualChecks, documentKey)}
              />
            </details>
          ) : null}
          <section className="border-b border-line px-4 py-4" aria-labelledby="studio-quality-summary">
            <h3 id="studio-quality-summary" className="sr-only">
              검사 요약
            </h3>
            <div
              className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center ${
                ready
                  ? "border-good/35 bg-good/10"
                  : blockingReady
                    ? "border-warning/35 bg-warning-soft/15"
                    : "border-bad/35 bg-bad/10"
              }`}
              role="status"
              aria-live="polite"
            >
              <div
                className={`grid size-14 shrink-0 place-items-center rounded-2xl border text-xl font-black ${
                  ready
                    ? "border-good/35 bg-panel text-good"
                    : blockingReady
                      ? "border-warning/35 bg-panel text-warning"
                      : "border-bad/35 bg-panel text-bad"
                }`}
                aria-label={`자동 검사 준비도 ${report.readinessScore}점`}
              >
                {report.readinessScore}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-fg">
                  {ready
                    ? "자동 검사와 최종 수동 확인을 모두 마쳤습니다"
                    : !blockingReady
                      ? `마감 전에 차단 ${openCounts.blocking}개·오류 ${openCounts.error}개를 해결하세요`
                      : rasterPending
                        ? "이미지 디코딩·해상도 검사가 끝날 때까지 마감 판정을 보류합니다"
                        : reviewOutstanding > 0
                          ? `차단 오류는 없으며 경고·확인 ${reviewOutstanding}개를 판단해야 합니다`
                          : `수동 확인 ${MANUAL_CHECKS.length - manualCompletedCount}개가 남았습니다`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-fg-2">
                  {report.checkedPageCount}페이지 · {report.checkedElementCount}요소 · 대사/텍스트{" "}
                  {report.checkedDialogueCount}개를 검사했습니다.{" "}
                  {rasterBusy
                    ? `이미지 원본 ${rasterProgress.completed}/${rasterProgress.total} 검사 중입니다.`
                    : rasterInspection?.status === "complete"
                      ? `이미지 참조 ${rasterInspection.assetReferenceCount}개를 확인했습니다.`
                      : rasterInspection?.status === "unavailable"
                        ? "이 환경에서는 이미지 원본 해상도 검사를 실행할 수 없습니다."
                        : ""}
                  {" "}경고·확인 항목은 의도된 연출이면 확인 처리할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:w-auto">
                {SEVERITY_ORDER.map((severity) => (
                  <button
                    key={severity}
                    type="button"
                    onClick={() =>
                      setSeverityFilter((current) =>
                        current === severity ? "all" : severity
                      )
                    }
                    aria-pressed={severityFilter === severity}
                    title={SEVERITY_META[severity].description}
                    className={`min-w-14 rounded-lg border px-2 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65 ${
                      severityFilter === severity
                        ? SEVERITY_META[severity].badgeClass
                        : "border-line bg-panel text-fg-2 hover:bg-raised"
                    }`}
                  >
                    <span className="block text-[0.62rem] font-semibold">
                      {SEVERITY_META[severity].label}
                    </span>
                    <span className="mt-0.5 block text-sm font-black">
                      {openCounts[severity]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="border-b border-line bg-card/25 px-4 py-3" aria-label="검사 필터">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  aria-pressed={scope === "all"}
                  className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65 ${
                    scope === "all" ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-raised"
                  }`}
                >
                  전체 원고
                </button>
                <button
                  type="button"
                  onClick={() => setScope("current")}
                  aria-pressed={scope === "current"}
                  disabled={!currentPageId}
                  className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65 disabled:cursor-not-allowed disabled:opacity-45 ${
                    scope === "current" ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-raised"
                  }`}
                >
                  현재 페이지
                </button>
              </div>

              <label className="relative min-w-40 flex-1 sm:max-w-64">
                <span className="sr-only">문제 검색</span>
                <Search
                  size={14}
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="문제·페이지·해결 방법 검색"
                  className="min-h-9 w-full rounded-lg border border-line bg-panel py-2 pl-8 pr-3 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>

              <label className="text-xs font-semibold text-fg-2">
                <span className="sr-only">검사 범주</span>
                <select
                  value={categoryFilter}
                  onChange={(event) =>
                    setCategoryFilter(event.target.value as "all" | StudioQualityCategory)
                  }
                  className="min-h-9 rounded-lg border border-line bg-panel px-3 text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">모든 범주</option>
                  {(Object.keys(CATEGORY_LABELS) as StudioQualityCategory[]).map(
                    (category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]} ({report.categoryCounts[category]})
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2">
                <input
                  type="checkbox"
                  checked={showAcknowledged}
                  onChange={(event) => setShowAcknowledged(event.target.checked)}
                  className="accent-accent"
                />
                확인됨 {acknowledgedCount}
              </label>

              <button
                type="button"
                onClick={() => setScanEpoch((value) => value + 1)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
              >
                {rasterBusy ? (
                  <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <RotateCcw size={14} aria-hidden />
                )}
                다시 검사
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadReport(
                    report,
                    acknowledgedIssueIds,
                    completedManualChecks,
                    documentKey
                  )
                }
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
              >
                <Download size={14} aria-hidden />
                보고서
              </button>
            </div>
          </section>

          <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 border-b border-line px-4 py-4 lg:border-b-0 lg:border-r" aria-labelledby="studio-quality-findings">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 id="studio-quality-findings" className="text-sm font-bold text-fg">
                    발견 항목 {visibleIssues.length}
                  </h3>
                  <p className="mt-0.5 text-[0.7rem] text-fg-3">
                    차단·오류는 확인 처리할 수 없으며 실제 원고를 수정해야 합니다.
                  </p>
                </div>
                {(severityFilter !== "all" ||
                  categoryFilter !== "all" ||
                  scope !== "all" ||
                  query) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSeverityFilter("all");
                      setCategoryFilter("all");
                      setScope("all");
                      setQuery("");
                    }}
                    className="text-[0.7rem] font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
                  >
                    필터 초기화
                  </button>
                )}
              </div>

              {visibleIssues.length === 0 ? (
                <div className="mt-3 grid min-h-72 place-items-center rounded-xl border border-line bg-card/35 px-5 text-center">
                  <div className="max-w-sm">
                    <CheckCircle2 size={30} className="mx-auto text-good" aria-hidden />
                    <p className="mt-3 text-sm font-bold text-fg">
                      현재 조건에 표시할 문제가 없습니다
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-fg-2">
                      모든 자동 검사가 끝났다면 오른쪽 최종 수동 체크리스트까지 완료해 실제 독자
                      화면과 게시 정책을 확인하세요.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <ol className="mt-3 space-y-2.5">
                  {displayedIssues.map((issue) => {
                    const meta = SEVERITY_META[issue.severity];
                    const acknowledged = acknowledgedIssueIds.has(issue.id);
                    const location = pageLabel(issue, pages);
                    const canNavigate =
                      Boolean(issue.sceneId && onSelectScene) ||
                      Boolean(onSelectTarget && (issue.pageId || issue.elementId));
                    const canAcknowledge =
                      issue.severity === "warning" || issue.severity === "review";
                    return (
                      <li
                        key={issue.id}
                        data-quality-issue-code={issue.code}
                        data-quality-issue-severity={issue.severity}
                        className={`rounded-xl border p-3 ${
                          acknowledged
                            ? "border-line bg-card/25 opacity-70"
                            : "border-line bg-card/55"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 shrink-0 ${meta.iconClass}`}
                            aria-hidden
                          >
                            <IssueIcon severity={issue.severity} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${meta.badgeClass}`}
                              >
                                {meta.label}
                              </span>
                              <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[0.62rem] font-semibold text-fg-3">
                                {CATEGORY_LABELS[issue.category]}
                              </span>
                              {location && (
                                <span className="inline-flex max-w-44 items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.62rem] font-semibold text-fg-3">
                                  <MapPin size={10} aria-hidden />
                                  <span className="truncate">{location}</span>
                                </span>
                              )}
                              {issue.sceneId && (
                                <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[0.62rem] font-semibold text-fg-3">
                                  {resolveSceneLabel(issue.sceneId, sceneLabels, scenes)}
                                </span>
                              )}
                              {acknowledged && (
                                <span className="rounded-full border border-good/35 bg-good/10 px-2 py-0.5 text-[0.62rem] font-semibold text-good">
                                  확인됨
                                </span>
                              )}
                            </div>
                            <h4 className="mt-2 text-xs font-bold text-fg">
                              {issue.title}
                            </h4>
                            <p className="mt-1 text-xs leading-relaxed text-fg-2">
                              {issue.message}
                            </p>
                            <p className="mt-1.5 rounded-lg border border-line bg-panel/70 px-2.5 py-2 text-[0.7rem] leading-relaxed text-fg-3">
                              <strong className="font-semibold text-fg-2">해결:</strong>{" "}
                              {issue.remediation}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {canNavigate && (
                                <button
                                  type="button"
                                  onClick={() => navigateToIssue(issue)}
                                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-accent/35 bg-accent-soft px-2.5 text-[0.68rem] font-semibold text-accent transition-colors hover:border-accent/55 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
                                >
                                  <MapPin size={12} aria-hidden />
                                  위치로 이동
                                </button>
                              )}
                              {canAcknowledge && (
                                <button
                                  type="button"
                                  disabled={!reviewStateReady}
                                  onClick={() =>
                                    setAcknowledgedIssueIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(issue.id)) next.delete(issue.id);
                                      else next.add(issue.id);
                                      return next;
                                    })
                                  }
                                  aria-pressed={acknowledged}
                                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
                                >
                                  <CheckCircle2 size={12} aria-hidden />
                                  {acknowledged ? "확인 취소" : "의도된 상태로 확인"}
                                </button>
                              )}
                              {issue.relatedElementIds &&
                                issue.relatedElementIds.length > 1 && (
                                  <span className="text-[0.65rem] text-fg-3">
                                    관련 요소 {issue.relatedElementIds.length}개
                                  </span>
                                )}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  </ol>
                  {displayedIssues.length < visibleIssues.length && (
                    <button
                      type="button"
                      onClick={() => setVisibleIssueLimit((current) => current + 100)}
                      className="mt-3 w-full rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
                    >
                      문제 {Math.min(100, visibleIssues.length - displayedIssues.length)}개 더 보기
                    </button>
                  )}
                </>
              )}
            </section>

            <aside className="bg-card/20 px-4 py-4" aria-labelledby="studio-quality-manual">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h3 id="studio-quality-manual" className="text-sm font-bold text-fg">
                    최종 수동 확인
                  </h3>
                  <p className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-3">
                    픽셀·연출·게시 정책은 사람이 최종 판단합니다.
                  </p>
                </div>
                <span className="rounded-full border border-line bg-panel px-2 py-1 text-[0.65rem] font-bold text-fg-2">
                  {manualCompletedCount}/{MANUAL_CHECKS.length}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {MANUAL_CHECKS.map((check) => {
                  const checked = completedManualChecks.has(check.id);
                  const Icon = check.icon;
                  return (
                    <label
                      key={check.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                        checked
                          ? "border-good/35 bg-good/10"
                          : "border-line bg-panel hover:bg-raised"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!reviewStateReady}
                        checked={checked}
                        onChange={(event) =>
                          setCompletedManualChecks((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(check.id);
                            else next.delete(check.id);
                            return next;
                          })
                        }
                        className="mt-0.5 accent-accent"
                      />
                      <Icon
                        size={15}
                        aria-hidden
                        className={`mt-0.5 shrink-0 ${checked ? "text-good" : "text-fg-3"}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-fg">
                          {check.title}
                        </span>
                        <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3">
                          {check.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 rounded-xl border border-line bg-panel p-3">
                <p className="text-xs font-bold text-fg">판정 원칙</p>
                <ul className="mt-1.5 space-y-1 text-[0.68rem] leading-relaxed text-fg-3">
                  <li>• 구조 손상·원본 누락·대사 잘림은 차단 또는 오류입니다.</li>
                  <li>• 여백·겹침·복합 배경 대비는 자동 통과시키지 않습니다.</li>
                  <li>• 경고·확인은 의도된 연출일 때만 확인 처리합니다.</li>
                  <li>• 게시처별 변동 규격은 업로드 직전에 다시 확인합니다.</li>
                </ul>
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <p className="mr-auto max-w-[70ch] text-[0.68rem] leading-relaxed text-fg-3">
            이 센터는 문서 상태와 구조화된 값을 검사하는 마감 보조 도구입니다. 실제 합성 픽셀,
            창작 의도, 최신 게시처 정책은 수동 체크리스트와 Publish Pack 사전검사에서 최종 확인하세요.
          </p>
          {onOpenScrollPreview && (
            <button
              type="button"
              onClick={onOpenScrollPreview}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
            >
              <ScrollText size={14} aria-hidden />
              세로 미리보기
            </button>
          )}
          {onOpenPublishPreflight && (
            <button
              type="button"
              onClick={onOpenPublishPreflight}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent-soft px-3 text-xs font-semibold text-accent transition-colors hover:border-accent/55 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
            >
              <UploadCloud size={14} aria-hidden />
              게시 규격 사전검사
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            닫기
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
