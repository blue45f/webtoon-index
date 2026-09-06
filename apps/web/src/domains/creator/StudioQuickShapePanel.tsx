/**
 * Studio QuickShape Panel — 프리핸드→도형 자동 스냅.
 * 심리 설계: "대충 그려도 된다" 안심 카피 + 부드러운 상태 피드백 + warm-ink 카드.
 */
import { Sparkles, Shapes, Wand2 } from "lucide-react";

import { studioSmartShapeMatchToGlyph } from "./studio-commercial-residuals";
import { StudioSmartShapeKindRow } from "./studio-creative-visuals";
import { StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export type StudioQuickShapePanelProps = {
  /** 퀵셰이프 on/off. */
  active: boolean;
  /** 지금 이 순간 인식되어 미리보기 중인 도형의 한글 라벨(예: "사각형"). 인식 전/비활성이면 null. */
  matchedKindLabel: string | null;
  onToggleActive: () => void;
  /** 선택: 기능 튜토리얼(스마트 도형) 열기. */
  onOpenTutorial?: () => void;
  className?: string;
};

function localizeText(t: (key: string) => string, fallback: string, key: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function StudioQuickShapePanel({
  active,
  matchedKindLabel,
  onToggleActive,
  onOpenTutorial,
  className,
}: StudioQuickShapePanelProps): ReactElement {
  const highlight = studioSmartShapeMatchToGlyph(matchedKindLabel);
  const matched = Boolean(matchedKindLabel);
  const t = useT();

  return (
    <div
      data-studio-smart-shape="true"
      data-studio-smart-shape-active={active ? "true" : "false"}
      className={cn(
        "relative overflow-hidden rounded-2xl border transition-[border-color,box-shadow,background] duration-200 ease-out",
        active
          ? "border-accent/35 bg-gradient-to-b from-accent-soft/40 via-card/80 to-panel shadow-[inset_0_1px_0_oklch(0.95_0.02_85_/_0.06)]"
          : "border-line/50 bg-card/40",
        className
      )}
    >
      {/* soft ambient wash — warm-ink only, no cool blues */}
      {active ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-8 size-24 rounded-full bg-accent/10 blur-2xl"
        />
      ) : null}

      <div className="relative space-y-3 p-3">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-200",
                active
                  ? "border-accent/40 bg-accent-soft text-accent shadow-[0_0_0_3px_oklch(0.72_0.185_42_/_0.08)]"
                  : "border-line/60 bg-raised/60 text-fg-3"
              )}
              aria-hidden
            >
              {active ? <Wand2 className="size-4" strokeWidth={1.75} /> : <Shapes className="size-4" strokeWidth={1.75} />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[0.78rem] font-semibold tracking-tight text-fg">
                {localizeText(t, "스마트 도형", "studio.quickShape.title")}
              </p>
              <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
                {active
                  ? localizeText(
                      t,
                      "선·네모·원·삼각을 느긋하게 그어요. 손을 떼면 알아서 단정해집니다.",
                      "studio.quickShape.description.active",
                    )
                  : localizeText(
                      t,
                      "끄적여도 괜찮아요. 켜 두면 손그림이 깔끔한 도형으로 다듬어집니다.",
                      "studio.quickShape.description.inactive",
                    )}
              </p>
            </div>
          </div>
          <StudioToggleChip
            active={active}
            onClick={onToggleActive}
            title={localizeText(
              t,
              "펜으로 대충 그린 도형을 손을 떼는 순간 정확한 도형으로 스냅합니다. 그리는 중 잠시 멈춰도 미리보기가 뜹니다",
              "studio.quickShape.toggleHint",
            )}
            aria-label={active
              ? localizeText(t, "스마트 도형 켜짐", "studio.quickShape.toggleAria.on")
              : localizeText(t, "스마트 도형 꺼짐", "studio.quickShape.toggleAria.off")}
          >
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3.5" aria-hidden />
              <span className="text-[0.65rem] font-semibold">{active ? "ON" : "OFF"}</span>
            </span>
          </StudioToggleChip>
        </div>

        {active ? (
          <div className="space-y-2.5">
            <StudioSmartShapeKindRow highlightKind={highlight} />

            <div
              role="status"
              data-studio-smart-shape-status="true"
              className={cn(
                "flex items-center gap-2 rounded-xl px-2.5 py-2 text-[0.68rem] leading-snug transition-colors duration-200",
                matched
                  ? "bg-accent-soft/55 text-fg ring-1 ring-accent/25"
                  : "bg-canvas/50 text-fg-3 ring-1 ring-line/40"
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-lg",
                  matched ? "bg-accent/20 text-accent" : "bg-raised text-fg-3"
                )}
                aria-hidden
              >
                <Sparkles className="size-3.5" />
              </span>
              {matched ? (
                <p className="min-w-0">
                  <span className="font-semibold text-accent">{matchedKindLabel}</span>
                  <span className="text-fg-2">
                    {localizeText(
                      t,
                      " 느낌이 나요 · 손을 떼면 확정",
                      "studio.quickShape.matchedSuffix",
                    )}
                  </span>
                </p>
              ) : (
                <p className="min-w-0 text-fg-3">
                  {localizeText(
                    t,
                    "도형을 그리고 손을 떼거나, 끝에서 잠깐만 머물러 보세요",
                    "studio.quickShape.emptyStatus",
                  )}
                </p>
              )}
            </div>
          </div>
        ) : null}
        {onOpenTutorial ? (
          <button
            type="button"
            onClick={onOpenTutorial}
            className="min-h-11 w-full rounded-xl border border-line/50 bg-canvas/30 px-2 py-1.5 text-[0.65rem] font-medium text-fg-3 transition-colors hover:border-accent/30 hover:bg-raised/60 hover:text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9 pointer-coarse:min-h-11"
          >
            {localizeText(t, "스마트 도형 튜토리얼 보기", "studio.quickShape.openTutorial")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
