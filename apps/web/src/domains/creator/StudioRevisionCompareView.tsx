import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  MapPin,
  PanelsTopLeft,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef } from "react";

import {
  studioRevisionCurrentLocation,
  type StudioRevisionCompareLocation,
} from "./studio-revision-compare-location";
import {
  STUDIO_REVISION_CHANGE_KINDS,
  type StudioRevisionChange,
  type StudioRevisionChangeKind,
  type StudioRevisionDiff,
} from "./studio-revision-diff";

import type { StudioServerRevisionComparison } from "./studio-server-revision-comparison";

export interface StudioRevisionCompareViewProps {
  targetRevision: number;
  baseRevision: number;
  comparison: StudioServerRevisionComparison | null;
  loading: boolean;
  error: string | null;
  restoring: boolean;
  confirmingRestore: boolean;
  pageLabels?: Readonly<Record<string, string>>;
  canNavigateChange?: (change: StudioRevisionChange) => boolean;
  onBack: () => void;
  onRetry: () => void;
  onRequestRestore: () => void;
  onCancelRestore: () => void;
  onConfirmRestore: () => void;
  onNavigateChange?: (location: StudioRevisionCompareLocation) => void;
}

const CHANGE_KIND_LABELS: Readonly<Record<StudioRevisionChangeKind, string>> = {
  "document-metadata-changed": "작품 정보 변경",
  "document-content-changed": "기획·제작 문서 변경",
  "document-review-changed": "검수·댓글 변경",
  "publication-metadata-changed": "게시 설정 변경",
  "document-extension-changed": "문서 설정 변경",
  "page-added": "페이지 추가",
  "page-removed": "페이지 삭제",
  "page-order-changed": "페이지 순서 변경",
  "page-resized": "페이지 크기 변경",
  "page-style-changed": "페이지 배경·스타일 변경",
  "page-groups-changed": "페이지 그룹 변경",
  "page-animation-changed": "페이지 애니메이션 변경",
  "page-metadata-changed": "페이지 메모·연출 변경",
  "page-properties-changed": "페이지 속성 변경",
  "element-added": "요소 추가",
  "element-removed": "요소 삭제",
  "element-reparented": "요소 페이지 이동",
  "element-order-changed": "레이어 순서 변경",
  "element-type-changed": "요소 종류 변경",
  "element-moved": "요소 위치 변경",
  "element-resized": "요소 크기 변경",
  "element-rotated": "요소 회전 변경",
  "element-geometry-changed": "선·도형 변경",
  "element-text-changed": "텍스트·대사 변경",
  "element-source-changed": "이미지·3D 소스 변경",
  "element-group-changed": "요소 그룹 변경",
  "element-style-changed": "요소 스타일 변경",
  "element-metadata-changed": "레이어 설정 변경",
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  aiProvenance: "AI 이력",
  animTimeline: "타임라인",
  bg: "배경색",
  bgGrad: "배경 그라데이션",
  canvasHeight: "캔버스 높이",
  canvasWidth: "캔버스 너비",
  comments: "댓글",
  description: "설명",
  groupId: "그룹",
  height: "높이",
  master: "마스터",
  name: "이름",
  note: "메모",
  opacity: "불투명도",
  panelGutter: "컷 간격",
  points: "선 좌표",
  publishPack: "게시 패키지",
  releaseSchedule: "연재 일정",
  rotation: "회전",
  src: "소스",
  tagsText: "태그",
  text: "텍스트",
  title: "제목",
  webtoonTheme: "테마",
  width: "너비",
  writerRoom: "작가실",
  x: "가로 위치",
  y: "세로 위치",
};

const DOCUMENT_KINDS = new Set<StudioRevisionChangeKind>(STUDIO_REVISION_CHANGE_KINDS.slice(0, 5));
const PAGE_KINDS = new Set<StudioRevisionChangeKind>(STUDIO_REVISION_CHANGE_KINDS.slice(5, 14));

function scopeTotals(diff: StudioRevisionDiff): { document: number; page: number; element: number } {
  let document = 0;
  let page = 0;
  let element = 0;
  for (const kind of STUDIO_REVISION_CHANGE_KINDS) {
    const count = diff.summary[kind];
    if (DOCUMENT_KINDS.has(kind)) document += count;
    else if (PAGE_KINDS.has(kind)) page += count;
    else element += count;
  }
  return { document, page, element };
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function changeContext(
  change: StudioRevisionChange,
  pageLabels: Readonly<Record<string, string>>
): string {
  const parts: string[] = [];
  const pageId = change.pageId ?? change.previousPageId;
  if (pageId) parts.push(pageLabels[pageId] || `페이지 ${compactId(pageId)}`);
  if (change.elementId) {
    const type = change.elementType && change.elementType !== "unknown" ? change.elementType : "요소";
    parts.push(`${type} ${compactId(change.elementId)}`);
  }
  const fields = change.fields ?? (change.field ? [change.field] : []);
  if (fields.length > 0) {
    const labels = fields.slice(0, 3).map((field) => {
      const label = FIELD_LABELS[field] ?? field;
      const before = change.before?.[field];
      const after = change.after?.[field];
      return before !== undefined && after !== undefined && (before !== null || after !== null)
        ? `${label} ${before ?? "—"} → ${after ?? "—"}`
        : label;
    });
    const fieldCount = change.fieldCount ?? fields.length;
    parts.push(`${labels.join(" · ")}${fieldCount > 3 ? ` 외 ${fieldCount - 3}개` : ""}`);
  }
  if (change.elementCount) parts.push(`요소 ${change.elementCount.toLocaleString("ko-KR")}개`);
  if (change.commonElementCount) {
    parts.push(`공통 요소 ${change.commonElementCount.toLocaleString("ko-KR")}개 순서 변경`);
  }
  if (change.beforePageIds && change.afterPageIds) {
    parts.push(`공통 페이지 ${change.afterPageIds.length.toLocaleString("ko-KR")}개 순서 변경`);
  }
  return parts.join(" · ") || "문서 전체";
}

function publicationStatusLabel(value: "draft" | "published" | null): string {
  if (value === "published") return "공개";
  if (value === "draft") return "초안";
  return "미설정";
}

const PUBLICATION_RELATION_LABELS: Readonly<Record<string, string>> = {
  titleId: "타이틀 연결",
  seriesId: "시리즈 연결",
  challengeId: "도전만화 연결",
  episodeNo: "회차 번호",
  remixFromId: "리믹스 원본",
};

export function StudioRevisionCompareView({
  targetRevision,
  baseRevision,
  comparison,
  loading,
  error,
  restoring,
  confirmingRestore,
  pageLabels = {},
  canNavigateChange,
  onBack,
  onRetry,
  onRequestRestore,
  onCancelRestore,
  onConfirmRestore,
  onNavigateChange,
}: StudioRevisionCompareViewProps) {
  const cancelRestoreRef = useRef<HTMLButtonElement | null>(null);
  const requestRestoreRef = useRef<HTMLButtonElement | null>(null);
  const previousConfirmingRef = useRef(false);
  const restoreStatusRef = useRef<HTMLDivElement | null>(null);
  const diff = comparison?.localToTarget ?? null;
  const unsavedDiff = comparison?.serverToLocal ?? null;
  const totals = diff ? scopeTotals(diff) : null;
  const restoreMeaningful = Boolean(diff?.hasChanges || unsavedDiff?.hasChanges);
  const publicationImpact = comparison?.publicationImpact;

  useEffect(() => {
    if (restoring) restoreStatusRef.current?.focus();
    else if (confirmingRestore) cancelRestoreRef.current?.focus();
    else if (previousConfirmingRef.current && !restoring) requestRestoreRef.current?.focus();
    previousConfirmingRef.current = confirmingRestore;
  }, [confirmingRestore, restoring]);

  return (
    <section
      aria-label={`서버 revision ${targetRevision} 변경 검토`}
      aria-busy={loading || restoring}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="studio-revision-compare"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/25 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          disabled={restoring}
          aria-label="서버 버전 목록으로 돌아가기"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-panel text-fg-2 hover:bg-raised disabled:cursor-wait disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <GitCompareArrows size={15} className="text-accent" aria-hidden /> 변경 검토
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-3">
            서버 r{targetRevision}와 현재 편집본 · 기준 r{baseRevision}
          </p>
        </div>
        <span className="hidden rounded-full border border-accent/25 bg-accent-soft/20 px-2.5 py-1 text-[0.68rem] font-semibold text-accent sm:inline-flex">
          복원 전 안전 확인
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
        {loading ? (
          <div role="status" aria-live="polite" className="grid min-h-64 place-items-center rounded-2xl border border-line bg-card/30 px-6 text-center">
            <div>
              <LoaderCircle size={26} className="mx-auto animate-spin text-accent" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-fg">두 버전을 안전하게 비교하는 중…</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-3">
                선택한 버전과 현재 서버 기준만 불러옵니다. 이미지 원문과 비공개 AI 프롬프트는 비교 결과에 표시하지 않아요.
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-bad/30 bg-bad/10 px-6 text-center">
            <div>
              <AlertTriangle size={26} className="mx-auto text-bad" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-fg">변경 내용을 확인하지 못했어요</p>
              <p role="alert" className="mt-1 max-w-md text-xs leading-relaxed text-bad">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-xs font-semibold text-fg-2 hover:bg-raised"
              >
                <RefreshCw size={14} aria-hidden /> 다시 비교
              </button>
            </div>
          </div>
        ) : diff && unsavedDiff && totals ? (
          <div className="space-y-3">
            {publicationImpact?.statusChange || publicationImpact?.changedRelations.length ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-bad/35 bg-bad/10 px-3 py-3 text-bad">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-xs font-bold">복원하면 게시 연결 정보도 바뀝니다</p>
                  {publicationImpact.statusChange ? (
                    <p className="mt-1 text-xs leading-relaxed text-fg-2">
                      공개 상태: {publicationStatusLabel(publicationImpact.statusChange.before)} → {publicationStatusLabel(publicationImpact.statusChange.after)}
                      {publicationImpact.statusChange.before === "published" && publicationImpact.statusChange.after !== "published"
                        ? " · 현재 공개 중인 작품이 비공개 초안으로 전환됩니다."
                        : ""}
                    </p>
                  ) : null}
                  {publicationImpact.changedRelations.length > 0 ? (
                    <p className="mt-1 text-xs leading-relaxed text-fg-2">
                      연결 변경: {publicationImpact.changedRelations.map((field) => PUBLICATION_RELATION_LABELS[field] ?? field).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {unsavedDiff.hasChanges ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/10 px-3 py-3 text-warn">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-xs font-bold">서버 r{baseRevision} 이후 로컬 변경 {unsavedDiff.totalChanges.toLocaleString("ko-KR")}건</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-2">
                    복원 직전에 현재 편집본을 이름 있는 브라우저 복구 지점으로 자동 보관합니다. 보관에 실패하면 복원도 시작하지 않습니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 rounded-xl border border-good/25 bg-good-soft/30 px-3 py-3 text-good">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-xs font-bold">현재 편집본이 서버 r{baseRevision}와 일치합니다</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">저장되지 않은 로컬 변경은 감지되지 않았어요.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2" aria-label="변경 범위 요약">
              {[
                { label: "문서", count: totals.document, icon: FileText },
                { label: "페이지", count: totals.page, icon: PanelsTopLeft },
                { label: "요소", count: totals.element, icon: Layers3 },
              ].map(({ label, count, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-line bg-card/45 px-2.5 py-3 text-center">
                  <Icon size={15} className="mx-auto text-fg-3" aria-hidden />
                  <p className="mt-1.5 text-lg font-black tabular-nums text-fg">{count.toLocaleString("ko-KR")}</p>
                  <p className="text-[0.65rem] font-semibold text-fg-3">{label}</p>
                </div>
              ))}
            </div>

            {!diff.hasChanges ? (
              <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-line bg-card/25 px-4 text-center">
                <div>
                  <CheckCircle2 size={24} className="mx-auto text-good" aria-hidden />
                  <p className="mt-2 text-sm font-semibold text-fg">편집 의미가 같은 버전입니다</p>
                  <p className="mt-1 text-xs text-fg-3">현재 페이지 위치나 저장 시각처럼 작업 내용이 아닌 차이는 제외했어요.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-card/30">
                <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-fg">의미 있는 변경 {diff.totalChanges.toLocaleString("ko-KR")}건</h3>
                    <p className="mt-0.5 text-xs text-fg-3">페이지·레이어 ID 기준으로 추가, 삭제, 이동, 내용을 구분했어요.</p>
                  </div>
                  <ShieldCheck size={17} className="shrink-0 text-good" aria-label="민감 데이터 비노출 비교" />
                </div>
                <ol className="divide-y divide-line/70" aria-label="서버 버전 변경 항목">
                  {diff.changes.map((change, index) => {
                    const pageId = change.pageId ?? change.previousPageId;
                    const navigationLocation = studioRevisionCurrentLocation(change);
                    const navigable = Boolean(
                      !restoring &&
                      navigationLocation &&
                      onNavigateChange &&
                      (canNavigateChange?.(change) ?? true)
                    );
                    return (
                      <li key={`${change.kind}:${pageId ?? "document"}:${change.elementId ?? ""}:${index}`} className="flex min-h-14 items-center gap-2 px-3 py-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel text-fg-3">
                          {change.scope === "document" ? <FileText size={14} aria-hidden /> : change.scope === "page" ? <PanelsTopLeft size={14} aria-hidden /> : <Layers3 size={14} aria-hidden />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-fg">{CHANGE_KIND_LABELS[change.kind]}</p>
                          <p className="mt-0.5 truncate text-xs text-fg-3">{changeContext(change, pageLabels)}</p>
                        </div>
                        {navigable && navigationLocation ? (
                          <button
                            type="button"
                            onClick={() => onNavigateChange?.(navigationLocation)}
                            disabled={restoring}
                            aria-label={`${changeContext(change, pageLabels)} 위치로 이동`}
                            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[0.68rem] font-semibold text-accent hover:bg-accent-soft/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            <MapPin size={13} aria-hidden /> 이동 <ChevronRight size={12} aria-hidden />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {diff.truncated ? (
                  <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-fg-3">
                    화면 성능을 위해 대표 변경만 표시합니다. 위 합계에는 모든 변경이 포함되어 있어요.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {diff && unsavedDiff && !loading && !error ? (
        <div className="shrink-0 border-t border-line bg-panel px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
          {confirmingRestore ? (
            <div
              ref={restoreStatusRef}
              role={restoring ? "status" : "alert"}
              aria-live={restoring ? "polite" : undefined}
              tabIndex={restoring ? 0 : -1}
              className="rounded-xl border border-bad/30 bg-bad/10 p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <p className="text-xs font-bold text-fg">정말 서버 버전 r{targetRevision}를 현재 버전으로 복원할까요?</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-3">
                기준 버전이 r{baseRevision}에서 바뀌면 서버가 복원을 거부합니다. 성공하면 복원 기록도 새 버전으로 남습니다.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  ref={cancelRestoreRef}
                  type="button"
                  onClick={onCancelRestore}
                  disabled={restoring}
                  className="min-h-11 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-fg-2 hover:bg-raised disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={onConfirmRestore}
                  disabled={restoring}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bad px-3 text-xs font-bold text-white hover:brightness-105 disabled:cursor-wait disabled:opacity-55"
                >
                  {restoring ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                  {restoring ? "복원 중…" : `r${targetRevision} 복원 확정`}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-3">
                {restoreMeaningful ? `복원하면 현재 서버·편집 상태와 다른 버전이 새 기록으로 남습니다.` : "복원해도 서버와 편집 내용은 달라지지 않습니다."}
              </p>
              <button
                ref={requestRestoreRef}
                type="button"
                onClick={onRequestRestore}
                disabled={!restoreMeaningful || restoring}
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-xs font-bold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                <RotateCcw size={14} aria-hidden /> 이 버전 복원
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
