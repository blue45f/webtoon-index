import {
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  Sparkles,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  acceptStudioWriterRoomSuggestion,
  acceptStudioWriterRoomSuggestions,
  rejectStudioWriterRoomSuggestion,
  rejectStudioWriterRoomSuggestions,
  STUDIO_WRITER_ROOM_LIMITS,
  STUDIO_WRITER_ROOM_STAGES,
  undoLastStudioWriterRoomDecision,
  type StudioWriterRoomDocument,
  type StudioWriterRoomStage,
  type StudioWriterRoomSuggestion,
  type StudioWriterRoomSuggestionValue,
} from "./studio-writer-room";
import { STUDIO_WRITER_ROOM_STAGE_META } from "./studio-writer-room-ui";

import type { StudioCharacterBibleEntry } from "./studio-character-bible";

// 이 리뷰 표면은 AI 클라이언트 모듈을 import하지 않는다는 경계 계약(studio-writer-room-review-boundary)이
// 있어 라벨만 로컬로 둔다. studio-server-ai-client의 StudioServerAiProvider와 동일한 집합을 유지한다.
const FAILOVER_PROVIDER_LABELS: Record<string, string> = {
  zai: "Z.ai",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
};

export interface StudioWriterRoomAiReview {
  stage: StudioWriterRoomStage;
  rationale: string;
  draft: unknown;
  provider?: string;
  model?: string;
  totalTokens?: number;
  failover?: {
    attemptedProvider: keyof typeof FAILOVER_PROVIDER_LABELS;
    actualProvider: keyof typeof FAILOVER_PROVIDER_LABELS;
  };
}

export interface StudioWriterRoomCanvasPlanSummary {
  canApply: boolean;
  pageCount: number;
  panelCount: number;
  errorCount: number;
  warningCount: number;
  diagnosticMessages: readonly string[];
}

const TARGET_FIELD_LABELS: Record<string, string> = {
  text: "본문",
  title: "제목",
  summary: "요약",
  characterIds: "등장인물",
  beatIds: "연결 비트",
  heading: "장면 제목",
  location: "장소",
  time: "시간",
  sceneId: "연결 장면",
  shot: "샷",
  action: "액션",
  order: "순서",
  panelId: "연결 컷",
  characterId: "화자",
  presetId: "효과음 프리셋",
  customText: "직접 입력 효과음",
  emphasis: "강도",
  scale: "크기",
};

function suggestionStage(suggestion: StudioWriterRoomSuggestion): StudioWriterRoomStage | null {
  return (
    STUDIO_WRITER_ROOM_STAGES.find((stage) =>
      suggestion.targetPath.startsWith(`stages.${stage}.`)
    ) ?? null
  );
}

function suggestionTargetLabel(suggestion: StudioWriterRoomSuggestion): string {
  const parts = suggestion.targetPath.split(".");
  const stage = suggestionStage(suggestion);
  const rawField = parts.at(-1) ?? "";
  const field = TARGET_FIELD_LABELS[rawField] ?? rawField;
  const itemType = parts[2] === "items"
    ? stage === "beats"
      ? "비트"
      : stage === "scenes"
        ? "장면"
        : "컷"
    : parts[2] === "dialogue"
      ? "대사"
      : parts[2] === "sfx"
        ? "효과음"
        : stage
          ? STUDIO_WRITER_ROOM_STAGE_META[stage].label
          : "제안";
  return `${itemType} · ${field}`;
}

function formatSuggestionValue(
  value: StudioWriterRoomSuggestionValue,
  characters: readonly StudioCharacterBibleEntry[]
): string {
  if (value === null) return "없음";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (Array.isArray(value)) {
    if (value.length === 0) return "선택 없음";
    return value
      .map((id) => characters.find((character) => character.id === id)?.name || id)
      .join(", ");
  }
  return String(value) || "비어 있음";
}

interface StudioWriterRoomSuggestionsPanelProps {
  stage: StudioWriterRoomStage;
  document: StudioWriterRoomDocument;
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (document: StudioWriterRoomDocument) => void;
  onError: (error: string | null) => void;
}

export function StudioWriterRoomSuggestionsPanel({
  stage,
  document,
  characters,
  onChange,
  onError,
}: StudioWriterRoomSuggestionsPanelProps) {
  const pending = document.suggestions.filter(
    (suggestion) => suggestion.status === "pending" && suggestionStage(suggestion) === stage
  );
  const resolvedCount = document.suggestions.filter(
    (suggestion) => suggestion.status !== "pending" && suggestionStage(suggestion) === stage
  ).length;
  const bulkCount = Math.min(pending.length, STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch);

  const decide = (suggestionId: string, kind: "accept" | "reject") => {
    try {
      const timestamp = new Date().toISOString();
      const next = kind === "accept"
        ? acceptStudioWriterRoomSuggestion(document, suggestionId, timestamp)
        : rejectStudioWriterRoomSuggestion(document, suggestionId, timestamp);
      onChange(next);
      onError(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "제안을 처리하지 못했어요.");
    }
  };

  const decideVisible = (kind: "accept" | "reject") => {
    try {
      const ids = pending
        .slice(0, STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch)
        .map((suggestion) => suggestion.id);
      const timestamp = new Date().toISOString();
      const next = kind === "accept"
        ? acceptStudioWriterRoomSuggestions(document, ids, timestamp)
        : rejectStudioWriterRoomSuggestions(document, ids, timestamp);
      onChange(next);
      onError(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "제안 묶음을 처리하지 못했어요.");
    }
  };

  return (
    <aside
      className="border-t border-line bg-card/20 xl:min-h-0 xl:border-l xl:border-t-0"
      aria-labelledby="writer-room-suggestions-title"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h3 id="writer-room-suggestions-title" className="text-sm font-bold text-fg">
              AI 제안 검토함
            </h3>
            <p className="mt-0.5 text-[0.65rem] tabular-nums text-fg-3">
              대기 {pending.length}개 · 처리 {resolvedCount}개
            </p>
          </div>
          {document.lastDecision && (
            <button
              type="button"
              onClick={() => {
                try {
                  onChange(undoLastStudioWriterRoomDecision(document));
                  onError(null);
                } catch (cause) {
                  onError(
                    cause instanceof Error ? cause.message : "마지막 결정을 되돌리지 못했어요."
                  );
                }
              }}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Undo2 size={13} aria-hidden /> 마지막 결정 취소
            </button>
          )}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[0.68rem] leading-relaxed text-fg-3">
          <CircleAlert size={13} className="mt-0.5 shrink-0 text-cool" aria-hidden />
          AI 결과는 여기서 대기하며, 승인 버튼을 누르기 전에는 원고에 적용되지 않습니다.
        </p>
        {pending.length > 1 && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => decideVisible("accept")}
              className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-accent px-2 text-[0.68rem] font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <CheckCheck size={14} aria-hidden />
              {pending.length > bulkCount ? `앞 ${bulkCount}개 승인` : "모두 승인"}
            </button>
            <button
              type="button"
              onClick={() => decideVisible("reject")}
              className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line px-2 text-[0.68rem] font-semibold text-fg-2 hover:border-bad/40 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad"
            >
              <XCircle size={14} aria-hidden />
              {pending.length > bulkCount ? `앞 ${bulkCount}개 거절` : "모두 거절"}
            </button>
          </div>
        )}
      </div>

      <div className="divide-y divide-line xl:max-h-full xl:overflow-y-auto">
        {pending.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Sparkles size={21} className="mx-auto text-fg-3" aria-hidden />
            <p className="mt-2 text-xs font-semibold text-fg-2">검토할 제안이 없습니다</p>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
              직접 작성하거나 상단의 AI 제안 받기로 현재 단계만 검토할 수 있어요.
            </p>
          </div>
        ) : (
          pending.map((suggestion) => (
            <article key={suggestion.id} className="px-4 py-4">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-[0.68rem] font-semibold text-accent">
                  {suggestionTargetLabel(suggestion)}
                </span>
                <time className="shrink-0 text-[0.62rem] tabular-nums text-fg-3">
                  {new Date(suggestion.createdAt).toLocaleDateString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </time>
              </div>
              <div className="mt-2 grid gap-2">
                <div>
                  <p className="text-[0.62rem] font-semibold text-fg-3">현재</p>
                  <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg-2">
                    {formatSuggestionValue(suggestion.currentValue, characters)}
                  </p>
                </div>
                <div>
                  <p className="text-[0.62rem] font-semibold text-accent">제안</p>
                  <p className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-accent/35 bg-accent-soft/10 px-2.5 py-2 text-xs leading-relaxed text-fg">
                    {formatSuggestionValue(suggestion.proposedValue, characters)}
                  </p>
                </div>
              </div>
              {suggestion.rationale && (
                <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">
                  <strong className="font-semibold text-fg-2">이유</strong> · {suggestion.rationale}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => decide(suggestion.id, "accept")}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Check size={14} aria-hidden /> 승인
                </button>
                <button
                  type="button"
                  onClick={() => decide(suggestion.id, "reject")}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:border-bad/40 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad"
                >
                  <X size={14} aria-hidden /> 거절
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

function nonNegativeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

interface StudioWriterRoomCanvasPlanHandoffProps {
  plan: StudioWriterRoomCanvasPlanSummary;
  onApply?: () => void | Promise<void>;
  busy: boolean;
  onError: (message: string | null) => void;
}

export function StudioWriterRoomCanvasPlanHandoff({
  plan,
  onApply,
  busy,
  onError,
}: StudioWriterRoomCanvasPlanHandoffProps) {
  const applyInFlightRef = useRef(false);
  const [requestingApply, setRequestingApply] = useState(false);
  const pageCount = nonNegativeCount(plan.pageCount);
  const panelCount = nonNegativeCount(plan.panelCount);
  const errorCount = nonNegativeCount(plan.errorCount);
  const warningCount = nonNegativeCount(plan.warningCount);
  const ready = plan.canApply && pageCount > 0 && panelCount > 0;
  /**
   * 아직 컷이 하나도 없는 상태는 **오류가 아니라 빈 상태**다. 처음 연 Writer Room 이
   * 붉은 "수정 필요 / 오류 1"로 시작하면, 사용자가 무언가 망가뜨렸다고 읽는다.
   *
   * 구분 기준은 투영된 컷 수 하나다. 컷이 0개면 아직 만들지 않은 것이고(중립 빈 상태),
   * 컷이 있는데 적용할 수 없으면 그건 진짜 오류다(붉은 상태 유지). 빈 상태에서도 진단은
   * 지우지 않고 조용한 접힘(details) 안에 그대로 둔다 — 조용하게 만들되 숨기지는 않는다.
   */
  const pending = panelCount === 0;
  const effectiveBusy = busy || requestingApply;
  const diagnosticMessages = plan.diagnosticMessages
    .map((message) => message.trim().slice(0, 400))
    .filter(Boolean);
  const displayedWarningCount = Math.max(warningCount, ready ? diagnosticMessages.length : 0);
  const visibleDiagnostics = diagnosticMessages.slice(0, ready ? 5 : 3);
  const hiddenDiagnosticCount = diagnosticMessages.length - visibleDiagnostics.length;

  const apply = async () => {
    if (!ready || !onApply || effectiveBusy || applyInFlightRef.current) return;
    applyInFlightRef.current = true;
    setRequestingApply(true);
    onError(null);
    try {
      await onApply();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "컷 플랜을 캔버스에 적용하지 못했어요.");
    } finally {
      applyInFlightRef.current = false;
      setRequestingApply(false);
    }
  };

  return (
    <section
      aria-labelledby="writer-room-canvas-plan-title"
      aria-live="polite"
      className={`shrink-0 border-b px-3 py-3 sm:px-5 ${
        pending
          ? "border-line bg-card/40"
          : ready
            ? "border-good/30 bg-good/10"
            : "border-bad/35 bg-bad/10"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="writer-room-canvas-plan-title" className="text-xs font-bold text-fg">
              캔버스 컷 플랜
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-[0.68rem] font-semibold ${
                pending ? "text-fg-3" : ready ? "text-good" : "text-bad"
              }`}
            >
              {pending ? (
                <CircleDashed size={13} aria-hidden />
              ) : ready ? (
                <CheckCheck size={13} aria-hidden />
              ) : (
                <CircleAlert size={13} aria-hidden />
              )}
              {pending ? "아직 없음" : ready ? "적용 준비" : "수정 필요"}
            </span>
          </div>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-2">
            {pending
              ? "1단계 기획부터 순서대로 채워 보세요. 5단계 컷 구성이 생기면 여기에서 새 페이지 계획으로 정리해 드려요."
              : ready
                ? onApply
                  ? "검토된 컷 순서대로 새 페이지를 만듭니다. 버튼을 누르기 전에는 캔버스를 바꾸지 않습니다."
                  : "컷과 페이지 구성이 준비되었습니다. 캔버스 적용 연결은 아직 제공되지 않습니다."
                : "끊어진 참조나 빈 컷을 수정하면 안전한 새 페이지 계획으로 다시 계산됩니다."}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] tabular-nums text-fg-3">
            <span className={pending ? "font-semibold text-fg-3" : "font-semibold text-fg-2"}>
              {panelCount.toLocaleString("ko-KR")}컷
            </span>
            <span aria-hidden>·</span>
            <span>새 페이지 {pageCount.toLocaleString("ko-KR")}개</span>
            {!pending && errorCount > 0 && (
              <span className="font-semibold text-bad">
                오류 {errorCount.toLocaleString("ko-KR")}
              </span>
            )}
            {!pending && warningCount > 0 && (
              <span className="font-semibold text-warn">
                경고 {warningCount.toLocaleString("ko-KR")}
              </span>
            )}
          </div>
        </div>

        {ready && onApply && (
          <button
            type="button"
            onClick={() => void apply()}
            disabled={effectiveBusy}
            aria-busy={effectiveBusy}
            aria-describedby="writer-room-canvas-plan-title"
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-55 sm:w-auto"
          >
            {effectiveBusy ? (
              <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <ArrowRight size={14} aria-hidden />
            )}
            {effectiveBusy
              ? "새 페이지 만드는 중…"
              : `컷 플랜 → 새 페이지 ${pageCount.toLocaleString("ko-KR")}개`}
          </button>
        )}
      </div>

      {/* 빈 상태의 진단은 지우지 않고 접어 둔다 — 화면은 조용하지만 내용은 그대로 남는다. */}
      {pending && diagnosticMessages.length > 0 && (
        <details className="mt-2 border-t border-line pt-1" aria-label="컷 플랜 확인 항목">
          <summary className="flex min-h-11 cursor-pointer items-center text-[0.68rem] font-medium text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            확인 항목 {diagnosticMessages.length.toLocaleString("ko-KR")}개 보기
          </summary>
          {(errorCount > 0 || warningCount > 0) && (
            <p className="pb-1 text-[0.65rem] tabular-nums text-fg-3">
              진단 상세 — 오류 {errorCount.toLocaleString("ko-KR")}건 · 경고{" "}
              {warningCount.toLocaleString("ko-KR")}건
            </p>
          )}
          <ul className="space-y-1 pb-1 text-[0.68rem] leading-relaxed text-fg-2">
            {visibleDiagnostics.map((message, index) => (
              <li key={`${message}-${index}`} className="flex min-w-0 items-start gap-1.5">
                <CircleDashed size={12} className="mt-0.5 shrink-0 text-fg-4" aria-hidden />
                <span className="min-w-0 break-words">{message}</span>
              </li>
            ))}
          </ul>
          {hiddenDiagnosticCount > 0 && (
            <p className="pb-1 text-[0.65rem] tabular-nums text-fg-3">
              그 밖의 확인 항목 {hiddenDiagnosticCount.toLocaleString("ko-KR")}개
            </p>
          )}
        </details>
      )}

      {!pending && !ready && (
        <div className="mt-3 border-t border-bad/25 pt-2.5" aria-label="컷 플랜 수정 항목">
          <p className="text-[0.68rem] font-semibold text-bad">적용 전 확인</p>
          {visibleDiagnostics.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-[0.68rem] leading-relaxed text-fg-2">
              {visibleDiagnostics.map((message, index) => (
                <li key={`${message}-${index}`} className="flex min-w-0 items-start gap-1.5">
                  <CircleAlert size={12} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                  <span className="min-w-0 break-words">{message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-2">
              연결된 장면과 캐릭터, 빈 컷 여부를 확인해 주세요.
            </p>
          )}
          {hiddenDiagnosticCount > 0 && (
            <p className="mt-1.5 text-[0.65rem] tabular-nums text-fg-3">
              그 밖의 확인 항목 {hiddenDiagnosticCount.toLocaleString("ko-KR")}개
            </p>
          )}
        </div>
      )}

      {ready && visibleDiagnostics.length > 0 && (
        <details className="mt-2 border-t border-good/25 pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-[0.68rem] font-semibold text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            적용 가능한 경고 {displayedWarningCount.toLocaleString("ko-KR")}개 확인
          </summary>
          <ul className="space-y-1 pb-1 text-[0.68rem] leading-relaxed text-fg-2">
            {visibleDiagnostics.map((message, index) => (
              <li key={`${message}-${index}`} className="flex min-w-0 items-start gap-1.5">
                <CircleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span className="min-w-0 break-words">{message}</span>
              </li>
            ))}
          </ul>
          {hiddenDiagnosticCount > 0 && (
            <p className="pb-1 text-[0.65rem] tabular-nums text-fg-3">
              그 밖의 확인 항목 {hiddenDiagnosticCount.toLocaleString("ko-KR")}개
            </p>
          )}
        </details>
      )}
    </section>
  );
}

interface StudioWriterRoomAiReviewPanelProps {
  review: StudioWriterRoomAiReview;
  currentValue: unknown;
  onApply?: () => void;
  onDiscard?: () => void;
}

export function StudioWriterRoomAiReviewPanel({
  review,
  currentValue,
  onApply,
  onDiscard,
}: StudioWriterRoomAiReviewPanelProps) {
  return (
    <section
      aria-label="AI 단계 초안 검토"
      className="shrink-0 border-b border-cool/30 bg-cool/8 px-3 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-fg">
              <Sparkles size={14} className="text-cool" aria-hidden />
              {STUDIO_WRITER_ROOM_STAGE_META[review.stage].label} AI 검토 초안
            </span>
            <span className="rounded-full border border-cool/30 bg-cool/10 px-2 py-0.5 text-[0.64rem] text-cool">
              아직 원고에 적용되지 않음
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-2">{review.rationale}</p>
          {review.provider || review.model || review.totalTokens !== undefined ? (
            <p className="mt-1 text-[0.65rem] text-fg-3">
              {[review.provider, review.model].filter(Boolean).join(" / ") || "AI 제공자"}
              {review.totalTokens !== undefined
                ? ` · ${review.totalTokens.toLocaleString("ko-KR")} tokens`
                : ""}
            </p>
          ) : null}
          {review.failover ? (
            <p
              className="mt-1 rounded-md border border-warn/35 bg-warn/10 px-2 py-1 text-[0.65rem] leading-relaxed text-warn"
              role="status"
            >
              {FAILOVER_PROVIDER_LABELS[review.failover.attemptedProvider]} 잔액·패키지
              한도 소진으로 {FAILOVER_PROVIDER_LABELS[review.failover.actualProvider]}에
              자동 전환했어요.
            </p>
          ) : null}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {onDiscard ? (
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none"
            >
              초안 버리기
            </button>
          ) : null}
          {onApply ? (
            <button
              type="button"
              onClick={onApply}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-none"
            >
              <Check size={14} aria-hidden /> 검토 후 이 단계에 반영
            </button>
          ) : null}
        </div>
      </div>
      <details className="mt-2 rounded-lg border border-line bg-panel/80">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          현재 단계와 AI 초안 비교
        </summary>
        <div className="grid gap-px overflow-hidden border-t border-line bg-line md:grid-cols-2">
          <div className="min-w-0 bg-panel p-3">
            <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wide text-fg-3">현재</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[0.68rem] leading-relaxed text-fg-2">
              {JSON.stringify(currentValue, null, 2)}
            </pre>
          </div>
          <div className="min-w-0 bg-panel p-3">
            <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wide text-cool">제안</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[0.68rem] leading-relaxed text-fg-2">
              {JSON.stringify(review.draft, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </section>
  );
}
