/**
 * Studio Mode Switch Floating Button (스튜디오 ↔ 심플 모드 전환 플로팅 버튼)
 *
 * CLIP STUDIO PAINT Ver.4.1.0 Parity:
 * - One-tap floating switch between "Studio Mode" (전문가 작업 영역) and "Simple Mode" (미니멀 심플 모드).
 * - Compact, accessible HUD button with keyboard shortcut hint.
 */

import { Layers, Sparkles } from "lucide-react";

export interface StudioModeSwitchFloatingButtonProps {
  readonly currentMode: "studio" | "simple";
  readonly onToggleMode: () => void;
  readonly className?: string;
}

export function StudioModeSwitchFloatingButton({
  currentMode,
  onToggleMode,
  className = "",
}: StudioModeSwitchFloatingButtonProps) {
  const isSimple = currentMode === "simple";

  return (
    <button
      type="button"
      onClick={onToggleMode}
      aria-label={isSimple ? "스튜디오 모드로 전환" : "심플 모드로 전환"}
      className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line/80 bg-card/90 px-3.5 py-2 text-xs font-semibold text-fg shadow-lg backdrop-blur hover:bg-raised transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {isSimple ? (
        <>
          <Layers className="size-4 text-accent" />
          <span>스튜디오 모드</span>
        </>
      ) : (
        <>
          <Sparkles className="size-4 text-accent" />
          <span>심플 모드</span>
        </>
      )}
    </button>
  );
}
