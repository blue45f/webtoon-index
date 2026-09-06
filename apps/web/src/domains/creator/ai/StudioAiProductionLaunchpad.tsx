import {
  ArrowRight,
  Clapperboard,
  Layers3,
  Sparkles,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
} from "../studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioAiProductionLaunchpadProps {
  readonly imageConfigured: boolean;
  readonly textConfigured: boolean;
  readonly onOpenScenario?: () => void;
  readonly onOpenSuperSuite?: () => void;
  /** Warms the super-suite chunk on hover/focus, as the inline launcher used to. */
  readonly onPreloadSuperSuite?: () => void;
  readonly scenarioDisabled?: boolean;
  readonly scenarioDisabledReason?: string;
}

/**
 * Task-first launcher for the two existing high-value production flows.
 *
 * It deliberately avoids another feature carousel. The first card creates editable panels from a
 * story; the second prepares reusable style/shading/prompt/bubble recipes locally.
 */
export function StudioAiProductionLaunchpad({
  imageConfigured,
  textConfigured,
  onOpenScenario,
  onOpenSuperSuite,
  onPreloadSuperSuite,
  scenarioDisabled = false,
  scenarioDisabledReason = "현재 편집 모드에서는 시나리오 제작을 열 수 없어요.",
}: StudioAiProductionLaunchpadProps): ReactElement | null {
  const rawId = useId();
  const titleId = `studio-ai-production-${rawId.replace(/:/gu, "")}`;

  if (!onOpenScenario && !onOpenSuperSuite) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="shrink-0 rounded-xl border border-accent/30 bg-accent/5 p-2.5"
      data-studio-ai-production-launchpad="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
            웹툰 제작 시작
          </h3>
          <p className="mt-0.5 text-[0.6rem] leading-relaxed text-fg-3">
            결과 형태를 먼저 고르면 필요한 도구만 이어서 열어요.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-card px-2 py-0.5 text-[0.55rem] font-semibold text-fg-3">
          비파괴 적용
        </span>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {onOpenScenario ? (
          <button
            type="button"
            onClick={onOpenScenario}
            disabled={scenarioDisabled}
            aria-describedby={scenarioDisabled ? `${titleId}-scenario-disabled` : undefined}
            className={cn(
              "group flex min-h-[5.5rem] items-start gap-2 rounded-xl border p-2.5 text-left",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET,
              scenarioDisabled
                ? "cursor-not-allowed border-line bg-card/45 opacity-60"
                : "border-line bg-card hover:border-accent/45 hover:bg-raised"
            )}
          >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Clapperboard size={16} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-1 text-[0.68rem] font-bold text-fg">
                스토리 → 편집 가능한 컷
                <ArrowRight
                  size={13}
                  className="shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </span>
              <span className="mt-0.5 block text-[0.59rem] leading-relaxed text-fg-3">
                장면 분할, 컷 선택, 참조 팩, 개별 재생성 후 패널·대사로 적용
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
                  {textConfigured ? "장면 설계 준비" : "텍스트 AI 연결 필요"}
                </span>
                <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
                  {imageConfigured ? "이미지까지 생성" : "컷 설계 먼저 가능"}
                </span>
              </span>
            </span>
          </button>
        ) : null}

        {onOpenSuperSuite ? (
          <button
            type="button"
            onClick={onOpenSuperSuite}
            onMouseEnter={onPreloadSuperSuite}
            onFocus={onPreloadSuperSuite}
            onPointerDown={onPreloadSuperSuite}
            className={cn(
              "group flex min-h-[5.5rem] items-start gap-2 rounded-xl border border-line bg-card p-2.5 text-left hover:border-accent/45 hover:bg-raised",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET
            )}
          >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Layers3 size={16} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-1 text-[0.68rem] font-bold text-fg">
                화풍·연출 레시피 만들기
                <ArrowRight
                  size={13}
                  className="shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </span>
              <span className="mt-0.5 block text-[0.59rem] leading-relaxed text-fg-3">
                화풍, 음영, 프롬프트, 콘티, 감정 말풍선을 한곳에서 설계
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
                  로컬 계산
                </span>
                <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
                  API 없이 준비
                </span>
              </span>
            </span>
          </button>
        ) : null}
      </div>

      <a
        href="/create/promo"
        target="_blank"
        rel="noopener noreferrer"
        className={cn("mt-2 flex min-h-11 items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs font-semibold text-fg hover:bg-raised", STUDIO_FOCUS_RING)}
      >
        컷 → 홍보영상·모션툰 만들기 (새 창)
        <ArrowRight size={14} aria-hidden />
      </a>

      {scenarioDisabled ? (
        <p
          id={`${titleId}-scenario-disabled`}
          className="mt-1.5 text-[0.57rem] leading-relaxed text-warn"
        >
          {scenarioDisabledReason}
        </p>
      ) : null}
    </section>
  );
}
