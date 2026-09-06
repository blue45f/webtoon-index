import { Check } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { STUDIO_COLOR_VISION_HINTS } from "./studio-color-vision-coach";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { CvdMode } from "./studio-color-vision-model";

import { cn } from "@/shared/lib/utils";

const CVD_OPTIONS = [
  {
    mode: "none" as const,
    label: "원본",
    accessibleLabel: "색각 미리보기 끄기 · 원본 색상",
    hint: STUDIO_COLOR_VISION_HINTS.none,
  },
  {
    mode: "grayscale" as const,
    label: "흑백",
    accessibleLabel: "흑백 명암 미리보기",
    hint: STUDIO_COLOR_VISION_HINTS.grayscale,
  },
  {
    mode: "protanopia" as const,
    label: "적색맹",
    accessibleLabel: "1형 적록 색각 시뮬레이션",
    hint: STUDIO_COLOR_VISION_HINTS.protanopia,
  },
  {
    mode: "deuteranopia" as const,
    label: "녹색맹",
    accessibleLabel: "2형 적록 색각 시뮬레이션",
    hint: STUDIO_COLOR_VISION_HINTS.deuteranopia,
  },
  {
    mode: "tritanopia" as const,
    label: "청색맹",
    accessibleLabel: "3형 청황 색각 시뮬레이션 · 근사치",
    hint: STUDIO_COLOR_VISION_HINTS.tritanopia,
  },
] as const;

function cvdBtnClass(active: boolean) {
  return cn(
    "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 text-[10px] font-semibold transition-colors pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-3 pointer-coarse:text-[0.8125rem]",
    active ? "border-accent/60 bg-accent-soft/50 text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
  );
}

export function StudioColorBlindPreviewToggle({
  value,
  onChange,
}: {
  value: CvdMode;
  onChange: (mode: CvdMode) => void;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = CVD_OPTIONS.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : (currentIndex + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + CVD_OPTIONS.length) % CVD_OPTIONS.length;
    const next = CVD_OPTIONS[nextIndex];
    if (!next) return;
    onChange(next.mode);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="흑백·색각 시뮬레이션 미리보기" className="flex items-center gap-1">
      {CVD_OPTIONS.map(({ mode, label, accessibleLabel, hint }, index) => (
        <StudioToolHintTarget key={mode} hint={hint} preferredSide="bottom">
          <button
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            onClick={() => onChange(mode)}
            onKeyDown={(event) => handleRadioKeyDown(event, index)}
            aria-label={accessibleLabel}
            aria-checked={value === mode}
            // 단독 `Q` 는 퀵 마스크의 화음이다 — 흑백 명암은 `⌥Q`
            // (conflict `q-quickmask-vs-grayscale` 해소, 2026-08-08).
            aria-keyshortcuts={mode === "grayscale" ? "Alt+Q" : undefined}
            tabIndex={value === mode ? 0 : -1}
            data-studio-color-vision-mode={mode}
            className={cvdBtnClass(value === mode)}
          >
            <span aria-hidden className="grid size-3 shrink-0 place-items-center">
              {value === mode ? <Check size={11} strokeWidth={2.4} /> : null}
            </span>
            {label}
          </button>
        </StudioToolHintTarget>
      ))}
    </div>
  );
}
