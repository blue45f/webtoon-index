/**
 * Episode production director — one preflight surface for script, continuity,
 * generation batching and QA. The planner is deterministic; applying a prompt
 * only hands the first approved batch to the existing AI hub.
 */

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clapperboard,
  ClipboardCheck,
  Copy,
  Layers3,
  Lock,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
  StudioEmptyState,
} from "../studio-panel-ui";
import { useStudioCopyFeedback } from "../use-studio-copy-feedback";
import { useStudioModalSheet } from "../useStudioModalSheet";

import {
  DEFAULT_STUDIO_AI_EPISODE_CONTINUITY_LOCKS,
  STUDIO_AI_CONTINUITY_LOCK_IDS,
  planStudioAiEpisodeProduction,
  type StudioAiContinuityLockId,
  type StudioAiEpisodeContinuityLocks,
  type StudioAiEpisodeIssueSeverity,
  type StudioAiProductionMode,
  type StudioAiVariantCount,
} from "./studio-ai-episode-production-director";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const DEFAULT_SCRIPT = `장면 1: 무너진 성벽 · 석양
주인공이 푸른 보석을 쥔 채 성벽 위로 올라선다.
주인공: "드디어 찾았다. 이제 모든 걸 끝낼 수 있어."
성문 너머에서 거대한 마수가 포효한다.

장면 2: 성문 앞 · 밤
주인공이 검은 망토를 여미고 대검을 뽑는다.
기사단장: "혼자 가면 죽는다!"
주인공이 뒤돌아 미소 짓고 적진으로 달려간다.`;

interface AnchorDraft {
  readonly character: string;
  readonly costume: string;
  readonly location: string;
  readonly lighting: string;
  readonly style: string;
  readonly props: string;
}

const DEFAULT_ANCHORS: AnchorDraft = {
  character: "주인공 · 검은 단발 · 회색 눈 · 왼쪽 눈썹 흉터, 기사단장 · 은발 포니테일",
  costume: "주인공 · 검은 망토와 가죽 갑옷, 기사단장 · 은색 제복",
  location: "무너진 성벽과 성문 · 푸른 마력 균열 · 동일한 돌기둥 배치",
  lighting: "장면 1 석양 좌측광, 장면 2 달빛 우측광",
  style: "깨끗한 한국 웹툰 셀 채색, 일정한 외곽선, 선명한 명암 경계",
  props: "주인공의 푸른 보석과 검은 대검",
};

const MODE_OPTIONS: readonly {
  readonly id: StudioAiProductionMode;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: "fast", label: "빠른 초안", description: "6컷씩 · 탐색용" },
  { id: "balanced", label: "균형 제작", description: "4컷씩 · 기본" },
  { id: "quality", label: "품질 우선", description: "3컷씩 · 정밀" },
];

const VARIANT_OPTIONS: readonly StudioAiVariantCount[] = [1, 2, 4];

const LOCK_LABELS: Readonly<Record<StudioAiContinuityLockId, string>> = {
  character: "캐릭터",
  costume: "의상",
  location: "장소",
  lighting: "광원",
  style: "화풍",
  props: "소품",
};

const ANCHOR_PLACEHOLDERS: Readonly<Record<keyof AnchorDraft, string>> = {
  character: "이름 · 얼굴 · 헤어 · 체형 · 식별 특징",
  costume: "캐릭터별 기본 의상 또는 장면별 버전",
  location: "공간 구조 · 고정 랜드마크 · 시간대",
  lighting: "장면별 주광 방향 · 색온도",
  style: "선 굵기 · 채색 · 명암 · 질감",
  props: "무기 · 액세서리 · 서사 핵심 소품",
};

const SCORE_LABELS = {
  readiness: "생성 준비도",
  continuity: "연속성",
  dialogueReadability: "대사 가독성",
  pacing: "스크롤 리듬",
} as const;

const FIELD_CLASS = cn(
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-xs leading-relaxed text-fg placeholder:text-fg-3",
  STUDIO_EASE,
  STUDIO_FOCUS_RING
);

const CARD_CLASS = "rounded-xl border border-line bg-card/65";

function scoreTone(score: number): string {
  if (score >= 85) return "text-good";
  if (score >= 65) return "text-warn";
  return "text-bad";
}

function issueTone(severity: StudioAiEpisodeIssueSeverity): string {
  if (severity === "blocker") return "border-bad/35 bg-bad/10";
  if (severity === "warning") return "border-warn/35 bg-warn/10";
  return "border-line bg-raised/50";
}

function issueLabel(severity: StudioAiEpisodeIssueSeverity): string {
  if (severity === "blocker") return "차단";
  if (severity === "warning") return "주의";
  return "제안";
}

function CopyAction({
  copyKey,
  label,
  text,
  statusFor,
  onCopy,
}: {
  readonly copyKey: string;
  readonly label: string;
  readonly text: string;
  readonly statusFor: ReturnType<typeof useStudioCopyFeedback>["statusFor"];
  readonly onCopy: ReturnType<typeof useStudioCopyFeedback>["copy"];
}): ReactElement {
  const status = statusFor(copyKey);
  const copied = status === "copied";
  const failed = status === "failed";
  const Icon = copied ? Check : failed ? AlertTriangle : Copy;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg hover:bg-raised",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        STUDIO_TOUCH_TARGET,
        failed && "border-bad/35 text-bad"
      )}
      aria-label={`${label} 복사`}
    >
      <Icon size={14} aria-hidden />
      <span>{copied ? "복사됨" : failed ? "복사 실패" : label}</span>
    </button>
  );
}

function StepCard({
  number,
  title,
  description,
  active,
}: {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly active: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2",
        active ? "border-accent/45 bg-accent/10" : "border-line bg-card/50"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.62rem] font-black",
            active ? "bg-accent text-on-accent" : "bg-raised text-fg-3"
          )}
        >
          {number}
        </span>
        <span className="truncate text-xs font-bold text-fg">{title}</span>
      </div>
      <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">{description}</p>
    </div>
  );
}

export interface StudioAiEpisodeProductionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApplyPrompt?: (prompt: string) => void;
}

export function StudioAiEpisodeProductionModal({
  open,
  onClose,
  onApplyPrompt,
}: StudioAiEpisodeProductionModalProps): ReactElement | null {
  const rawId = useId();
  const idPrefix = `ai-episode-production-${rawId.replace(/:/gu, "")}`;
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  const scriptId = `${idPrefix}-script`;

  const dialogRef = useRef<HTMLElement | null>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body
  );

  const [episodeTitle, setEpisodeTitle] = useState("푸른 보석 12화");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [mode, setMode] = useState<StudioAiProductionMode>("balanced");
  const [variants, setVariants] = useState<StudioAiVariantCount>(2);
  const [locks, setLocks] = useState<StudioAiEpisodeContinuityLocks>(
    DEFAULT_STUDIO_AI_EPISODE_CONTINUITY_LOCKS
  );
  const [anchors, setAnchors] = useState<AnchorDraft>(DEFAULT_ANCHORS);

  const plan = useMemo(
    () =>
      planStudioAiEpisodeProduction({
        episodeTitle,
        script,
        mode,
        variants,
        locks,
        characterAnchor: anchors.character,
        costumeAnchor: anchors.costume,
        locationAnchor: anchors.location,
        lightingAnchor: anchors.lighting,
        styleAnchor: anchors.style,
        propAnchor: anchors.props,
      }),
    [anchors, episodeTitle, locks, mode, script, variants]
  );

  const clipboard = useStudioCopyFeedback(2400);
  const firstBatchPrompt = plan.batches[0]?.positivePrompt ?? "";
  const hasBlocker = plan.issues.some((issue) => issue.severity === "blocker");
  const canApply = Boolean(onApplyPrompt && firstBatchPrompt && !hasBlocker);
  const copyStatusMessage =
    clipboard.current === null
      ? ""
      : clipboard.current.status === "copied"
        ? "클립보드에 복사했어요."
        : "클립보드에 복사하지 못했어요. 텍스트를 직접 선택해 복사해 주세요.";

  useStudioModalSheet({
    activeKey: open ? "ai-episode-production" : null,
    dialogRef,
    onDismiss: onClose,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousRootOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const updateAnchor = (key: keyof AnchorDraft, value: string) => {
    setAnchors((current) => ({ ...current, [key]: value.slice(0, 700) }));
  };

  const toggleLock = (id: StudioAiContinuityLockId) => {
    setLocks((current) => ({ ...current, [id]: !current[id] }));
  };

  const content = (
    <div
      data-studio-ai-episode-production-overlay="true"
      className="fixed inset-0 z-[122] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/80 backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="studio-ai-episode-production-modal"
        data-studio-modal-owner="ai-episode-production"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative z-10 flex max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-panel text-fg shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-raised px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Clapperboard size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-sm font-black tracking-tight text-fg sm:text-base">
                  회차 AI 프로덕션 디렉터
                </h2>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[0.6rem] font-bold text-accent">
                  생성 전 품질 게이트
                </span>
              </div>
              <p id={descriptionId} className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                대본을 장면·컷으로 묶고 캐릭터·의상·장소·광원을 잠근 뒤, 생성 비용이 발생하기 전에
                연속성·대사·카메라 문제를 찾습니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="회차 AI 프로덕션 디렉터 닫기"
            className={cn(
              "inline-flex min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-fg-3 hover:bg-card hover:text-fg",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET
            )}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="shrink-0 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="회차 AI 제작 단계">
            <StepCard number={1} title="대본" description={`${plan.scenes.length}장면 · ${plan.totalCuts}컷`} active />
            <StepCard
              number={2}
              title="연속성 잠금"
              description={`${STUDIO_AI_CONTINUITY_LOCK_IDS.filter((id) => locks[id]).length}개 기준 활성`}
              active={plan.anchors.characters.length > 0}
            />
            <StepCard
              number={3}
              title="생성 묶음"
              description={`${plan.batchCount}배치 · ${plan.projectedOutputCount}결과`}
              active={plan.batchCount > 0}
            />
            <StepCard
              number={4}
              title="품질 QA"
              description={`준비도 ${plan.scores.readiness}점`}
              active={!hasBlocker && plan.totalCuts > 0}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] lg:overflow-hidden">
          <div className="space-y-3 p-3 sm:p-4 lg:overflow-y-auto lg:overscroll-contain">
            <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-script-heading`}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id={`${idPrefix}-script-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                    <Clapperboard size={14} className="text-accent" aria-hidden />
                    1. 회차 대본
                  </h3>
                  <p className="mt-0.5 text-[0.62rem] text-fg-3">
                    ‘장면 1: 장소’ 제목과 줄바꿈을 사용하면 생성 실패 범위를 작게 나눌 수 있어요.
                  </p>
                </div>
                <span className="text-[0.62rem] tabular-nums text-fg-3">{script.length.toLocaleString()} / 6,000자</span>
              </div>
              <label className="mt-3 block text-[0.65rem] font-bold text-fg-2" htmlFor={`${idPrefix}-episode-title`}>
                회차명
              </label>
              <input
                id={`${idPrefix}-episode-title`}
                value={episodeTitle}
                onChange={(event) => setEpisodeTitle(event.target.value.slice(0, 80))}
                className={cn(FIELD_CLASS, "mt-1")}
                placeholder="예: 푸른 보석 12화"
              />
              <label className="mt-3 block text-[0.65rem] font-bold text-fg-2" htmlFor={scriptId}>
                대본 원문
              </label>
              <textarea
                id={scriptId}
                data-autofocus="true"
                value={script}
                onChange={(event) => setScript(event.target.value.slice(0, 6000))}
                rows={11}
                className={cn(FIELD_CLASS, "mt-1 min-h-52 resize-y font-mono text-[0.68rem]")}
                placeholder="장면 제목, 행동, 대사를 입력하세요."
                aria-invalid={script.trim().length === 0}
              />
            </section>

            <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-generation-heading`}>
              <h3 id={`${idPrefix}-generation-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                <Layers3 size={14} className="text-accent" aria-hidden />
                2. 생성 전략
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="생성 품질 모드">
                {MODE_OPTIONS.map((option) => {
                  const selected = option.id === mode;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMode(option.id)}
                      className={cn(
                        "min-h-14 rounded-xl border px-3 py-2 text-left",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        selected
                          ? "border-accent bg-accent/10 text-fg"
                          : "border-line bg-card text-fg-2 hover:bg-raised"
                      )}
                    >
                      <span className="block text-xs font-bold">{option.label}</span>
                      <span className="mt-0.5 block text-[0.6rem] text-fg-3">{option.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised/45 p-2.5">
                <div>
                  <p className="text-xs font-bold text-fg">컷당 후보 수</p>
                  <p className="text-[0.6rem] text-fg-3">후보가 많을수록 선택 폭과 상대 작업량이 함께 늘어요.</p>
                </div>
                <div className="inline-flex rounded-lg border border-line bg-card p-1" role="radiogroup" aria-label="컷당 후보 수">
                  {VARIANT_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={variants === value}
                      onClick={() => setVariants(value)}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-xs font-black",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        variants === value ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-raised"
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-continuity-heading`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id={`${idPrefix}-continuity-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                    <Lock size={14} className="text-accent" aria-hidden />
                    3. 프로덕션 바이블 잠금
                  </h3>
                  <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
                    켜진 기준은 모든 장면·후보 프롬프트에 영수증처럼 반복 주입됩니다.
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {STUDIO_AI_CONTINUITY_LOCK_IDS.map((id) => {
                  const anchorKey = id === "props" ? "props" : id;
                  return (
                    <div key={id} className="rounded-xl border border-line bg-raised/35 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-fg" htmlFor={`${idPrefix}-${id}-anchor`}>
                          {LOCK_LABELS[id]} 기준
                        </label>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={locks[id]}
                          aria-label={`${LOCK_LABELS[id]} 연속성 잠금 ${locks[id] ? "끄기" : "켜기"}`}
                          onClick={() => toggleLock(id)}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-[0.62rem] font-bold",
                            STUDIO_EASE,
                            STUDIO_FOCUS_RING,
                            locks[id]
                              ? "border-accent/40 bg-accent/10 text-accent"
                              : "border-line bg-card text-fg-3"
                          )}
                        >
                          {locks[id] ? <CheckCircle2 size={13} aria-hidden /> : <Lock size={13} aria-hidden />}
                          {locks[id] ? "잠금 켬" : "잠금 끔"}
                        </button>
                      </div>
                      <input
                        id={`${idPrefix}-${id}-anchor`}
                        value={anchors[anchorKey]}
                        onChange={(event) => updateAnchor(anchorKey, event.target.value)}
                        disabled={!locks[id]}
                        placeholder={ANCHOR_PLACEHOLDERS[anchorKey]}
                        className={cn(FIELD_CLASS, "mt-2 disabled:cursor-not-allowed disabled:opacity-45")}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="space-y-3 border-t border-line bg-card/25 p-3 sm:p-4 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-t-0" aria-label="AI 생성 품질 검사 결과">
            {plan.totalCuts === 0 ? (
              <div className={cn(CARD_CLASS, "p-4")}>
                <StudioEmptyState
                  icon={<Clapperboard size={22} aria-hidden />}
                  title="대본을 입력하면 제작 계획을 만들어요"
                  description="장면·컷·연속성 기준을 분석한 뒤 생성 묶음과 수정 우선순위를 보여줍니다."
                />
              </div>
            ) : (
              <>
                <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-score-heading`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`${idPrefix}-score-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                      <ClipboardCheck size={14} className="text-accent" aria-hidden />
                      품질 게이트
                    </h3>
                    <span
                      className={cn(
                        "rounded-full border border-line bg-raised px-2 py-1 text-[0.62rem] font-black tabular-nums",
                        scoreTone(plan.scores.readiness)
                      )}
                    >
                      {hasBlocker ? "수정 필요" : "생성 가능"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((key) => (
                      <div key={key} className="rounded-xl border border-line bg-raised/45 p-2.5">
                        <p className="text-[0.6rem] font-semibold text-fg-3">{SCORE_LABELS[key]}</p>
                        <p className={cn("mt-1 text-xl font-black tabular-nums", scoreTone(plan.scores[key]))}>
                          {plan.scores[key]}
                          <span className="ml-0.5 text-[0.6rem] font-semibold text-fg-3">/100</span>
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[0.62rem] sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg bg-raised/55 p-2"><span className="block text-fg-3">장면</span><strong className="text-fg">{plan.scenes.length}</strong></div>
                    <div className="rounded-lg bg-raised/55 p-2"><span className="block text-fg-3">컷</span><strong className="text-fg">{plan.totalCuts}</strong></div>
                    <div className="rounded-lg bg-raised/55 p-2"><span className="block text-fg-3">배치</span><strong className="text-fg">{plan.batchCount}</strong></div>
                    <div className="rounded-lg bg-raised/55 p-2"><span className="block text-fg-3">상대 작업량</span><strong className="text-fg">{plan.generationWorkUnits}</strong></div>
                  </div>
                </section>

                <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-issues-heading`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`${idPrefix}-issues-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                      <AlertTriangle size={14} className="text-warn" aria-hidden />
                      생성 전 수정 항목
                    </h3>
                    <span className="text-[0.62rem] font-bold text-fg-3">{plan.issues.length}건</span>
                  </div>
                  {plan.issues.length === 0 ? (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-good/30 bg-good/10 p-3 text-xs text-good" role="status">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
                      <p className="leading-relaxed">차단·주의 항목이 없습니다. 첫 생성 묶음을 기존 구도 도구로 넘겨 후속 작업을 이어갈 수 있어요.</p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {plan.issues.map((issue) => (
                        <article key={issue.id} className={cn("rounded-xl border p-2.5", issueTone(issue.severity))}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-fg">{issue.title}</p>
                              <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">{issue.description}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-current/20 px-1.5 py-0.5 text-[0.55rem] font-black text-fg-2">
                              {issueLabel(issue.severity)}
                            </span>
                          </div>
                          <p className="mt-2 border-t border-line/70 pt-2 text-[0.6rem] leading-relaxed text-fg-2">
                            <strong>수정:</strong> {issue.resolution}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className={cn(CARD_CLASS, "p-3")} aria-labelledby={`${idPrefix}-batches-heading`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`${idPrefix}-batches-heading`} className="flex items-center gap-1.5 text-xs font-black text-fg">
                      <Layers3 size={14} className="text-accent" aria-hidden />
                      생성 묶음
                    </h3>
                    <span className="text-[0.62rem] font-bold text-fg-3">{plan.modeLabel} · 컷당 {plan.variants}개</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {plan.batches.map((batch, index) => (
                      <details key={batch.id} className="group rounded-xl border border-line bg-raised/40" open={index === 0}>
                        <summary className={cn("flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2", STUDIO_FOCUS_RING)}>
                          <span className="min-w-0">
                            <strong className="block truncate text-xs text-fg">배치 {batch.order} · {batch.sceneTitle}</strong>
                            <span className="text-[0.6rem] text-fg-3">컷 {batch.cutNumbers.join(", ")} · 결과 {batch.outputCount}개</span>
                          </span>
                          <span className="text-[0.6rem] font-bold text-accent group-open:hidden">열기</span>
                          <span className="hidden text-[0.6rem] font-bold text-accent group-open:inline">접기</span>
                        </summary>
                        <div className="border-t border-line p-2.5">
                          <p className="text-[0.6rem] font-bold text-fg-2">연속성 영수증</p>
                          <ul className="mt-1 space-y-1 text-[0.6rem] leading-relaxed text-fg-3">
                            {batch.continuityReceipt.map((entry) => <li key={entry}>• {entry}</li>)}
                          </ul>
                          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-2 text-[0.58rem] leading-relaxed text-fg-3">{batch.positivePrompt}</pre>
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              </>
            )}
          </aside>
        </div>

        <footer className="shrink-0 border-t border-line bg-raised px-3 py-2.5 sm:px-4">
          <p className="sr-only" aria-live="polite">{copyStatusMessage}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[0.6rem] leading-relaxed text-fg-3">
              예상 결과 {plan.projectedOutputCount}개 · 작업량은 제공자별 시간·금액이 아닌 상대 비교 단위입니다.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <CopyAction
                copyKey="episode-master-prompt"
                label="마스터 프롬프트"
                text={plan.masterPrompt}
                statusFor={clipboard.statusFor}
                onCopy={clipboard.copy}
              />
              <CopyAction
                copyKey="episode-manifest"
                label="제작 매니페스트"
                text={plan.manifestJson}
                statusFor={clipboard.statusFor}
                onCopy={clipboard.copy}
              />
              {onApplyPrompt ? (
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() => {
                    if (!canApply) return;
                    onApplyPrompt(firstBatchPrompt);
                    onClose();
                  }}
                  className={cn(
                    "col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-black text-on-accent hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45 sm:col-span-1",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET
                  )}
                >
                  <WandSparkles size={14} aria-hidden />
                  첫 배치를 구도 도구에 적용
                </button>
              ) : null}
            </div>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, portalRootRef.current ?? document.body);
}
