import { BookOpen, CircleCheck, ImageDown, Loader2, MousePointer2 } from "lucide-react";

import {
  studioRetouchToolHelp,
  type StudioRetouchToolId,
} from "./studio-retouch-help";

import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

type RetouchPresentationState = "ready" | "active" | "busy" | "blocked";

function resolveState(active: boolean, busy: boolean, disabled: boolean): RetouchPresentationState {
  if (busy) return "busy";
  if (disabled) return "blocked";
  return active ? "active" : "ready";
}

const STATE_PRESENTATION: Readonly<
  Record<RetouchPresentationState, { label: string; icon: LucideIcon; tone: string }>
> = {
  ready: { label: "준비됨", icon: CircleCheck, tone: "text-good" },
  active: { label: "도구 켜짐", icon: MousePointer2, tone: "text-accent" },
  busy: { label: "반영 중", icon: Loader2, tone: "text-accent" },
  blocked: { label: "대상 준비 필요", icon: ImageDown, tone: "text-warn" },
};

export type StudioRetouchQuickGuideProps = {
  toolId: StudioRetouchToolId;
  active: boolean;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** 패널의 짧은 안내에서 검색 가능한 전체 튜토리얼 허브로 이동한다. */
  onOpenTutorial?: () => void;
};

/**
 * 좁은 속성 패널에서도 현재 상태와 첫 사용 흐름을 동시에 제공하는 공통 안내.
 * 상세 단계는 필요할 때만 펼쳐 세로 스크롤을 늘리지 않는다.
 */
export function StudioRetouchQuickGuide({
  toolId,
  active,
  busy = false,
  disabled = false,
  disabledReason,
  onOpenTutorial,
}: StudioRetouchQuickGuideProps): ReactElement {
  const help = studioRetouchToolHelp(toolId);
  const state = resolveState(active, busy, disabled);
  const presentation = STATE_PRESENTATION[state];
  const StateIcon = presentation.icon;
  const message = state === "busy"
    ? help.busyMessage
    : state === "blocked"
      ? disabledReason
        ?? "현재 상태에서는 편집용 이미지 복사본을 준비할 수 없습니다. 잠금과 표시할 내용을 확인하세요."
      : state === "active"
        ? `${help.activeInstruction} 손을 떼면 한 획이 저장됩니다.`
        : `${help.summary} 도구를 켜면 바로 시작할 수 있습니다.`;

  return (
    <div className="border-t border-line/60 pt-2">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={state === "busy"}
        data-studio-retouch-state={state}
        className="flex items-start gap-2 text-[0.72rem] leading-relaxed text-fg-3"
      >
        <StateIcon
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            presentation.tone,
            state === "busy" && "motion-safe:animate-spin",
          )}
          aria-hidden
        />
        <p className="min-w-0 text-pretty">
          <span className={cn("font-semibold", presentation.tone)}>{presentation.label}</span>
          <span aria-hidden> · </span>
          {message}
        </p>
      </div>

      <details className="group mt-1.5 border-t border-line/40 pt-0.5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1.5 text-[0.72rem] font-medium text-fg-2 outline-none transition-colors hover:bg-raised/70 focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
          <span>처음이라면 · 3단계</span>
          <span className="text-[0.66rem] font-normal text-fg-3 group-open:hidden">보기</span>
          <span className="hidden text-[0.66rem] font-normal text-fg-3 group-open:inline">접기</span>
        </summary>
        <ol className="space-y-2 px-1.5 pb-1.5 pt-1" aria-label={`${help.actionName} 첫 사용 3단계`}>
          {help.steps.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1.5">
              <span
                className="grid size-5 place-items-center rounded-md bg-raised text-[0.62rem] font-semibold tabular-nums text-fg-2"
                aria-hidden
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[0.7rem] font-semibold text-fg-2">{step.title}</p>
                <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {onOpenTutorial ? (
          <button
            type="button"
            onClick={onOpenTutorial}
            aria-label={`${help.actionName} 상세 튜토리얼 열기`}
            className="mb-1 ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.7rem] font-semibold text-accent outline-none transition-colors hover:bg-accent-soft/60 focus-visible:ring-2 focus-visible:ring-accent/70 md:min-h-9 pointer-coarse:min-h-11 motion-reduce:transition-none"
          >
            <BookOpen className="size-3.5" aria-hidden />
            상세 튜토리얼
          </button>
        ) : null}
      </details>
    </div>
  );
}
