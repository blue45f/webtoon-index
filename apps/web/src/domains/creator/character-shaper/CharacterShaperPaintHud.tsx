/**
 * Character Shaper — 표면 드로잉 HUD.
 *
 * A floating toolbar over the viewport for the runtime's texture-paint session: the four tools
 * mapped onto the real settings (브러시 / 지우개 = surface brush with the erase blend, 스포이드 =
 * the eyedropper toggle, 채우기 = ColorDrop), compact size and opacity ranges, the paint color,
 * undo / redo / reset and the exit button. `[` and `]` resize the brush while the HUD is mounted.
 *
 * Every control reflects the host's own state; when the runtime reports a disabled reason the HUD
 * shows it instead of pretending the tools work.
 */
import { Brush, Eraser, PaintBucket, Pipette, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { DEFAULT_STUDIO_VRM_TEXTURE_PAINT_SETTINGS } from "../vrm/StudioVrmPoserTypes";

import { isCharacterShaperTypingTarget, pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";

import type { CharacterShaperPaintHudProps } from "./character-shaper-ui-contract";
import type { StudioVrmTexturePaintPanelSettings } from "../vrm/StudioVrmTexturePaintPanel";

import { cn } from "@/shared/lib/utils";

type PaintTool = "brush" | "eraser" | "eyedropper" | "fill";

const SIZE_MIN = 2;
const SIZE_MAX = 192;
const RESET_ARM_MS = 4000;

const CHIP = cn(
  "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2",
  "transition-colors duration-150 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const CHIP_ACTIVE = "border-accent/60 bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent";

/** One `[` / `]` press moves a small brush by a pixel and a large one by eight. */
function sizeStep(size: number): number {
  if (size < 16) return 1;
  if (size < 48) return 4;
  return 8;
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return SIZE_MIN;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(value)));
}

export function CharacterShaperPaintHud({ h, onExit }: CharacterShaperPaintHudProps) {
  const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const [resetArmed, setResetArmed] = useState(false);

  const settings: StudioVrmTexturePaintPanelSettings =
    (h.texturePaintSettings as StudioVrmTexturePaintPanelSettings | undefined)
    ?? DEFAULT_STUDIO_VRM_TEXTURE_PAINT_SETTINGS;
  const disabledReason: string =
    typeof h.texturePaintDisabledReason === "string" ? h.texturePaintDisabledReason : "";
  const strokeActive = Boolean(h.texturePaintStrokeActive);
  const disabled = disabledReason.length > 0 || strokeActive;
  const eyedropperActive = Boolean(h.texturePaintEyedropperActive);
  const snapshot = h.texturePaintSnapshot ?? null;
  const canUndo = (snapshot?.history?.undoCount ?? 0) > 0;
  const canRedo = (snapshot?.history?.redoCount ?? 0) > 0;
  const status: string = typeof h.texturePaintStatus === "string" ? h.texturePaintStatus : "";
  const size = clampSize(settings.sizeTexels);

  const activeTool: PaintTool = eyedropperActive
    ? "eyedropper"
    : settings.tool === "fill"
      ? "fill"
      : settings.blend === "erase"
        ? "eraser"
        : "brush";

  const update = (patch: Parameters<typeof h.handleTexturePaintSettingsChange>[0]) => {
    h.handleTexturePaintSettingsChange?.(patch);
  };

  const selectTool = (tool: PaintTool) => {
    if (disabled) return;
    if (tool === "eyedropper") {
      h.setTexturePaintEyedropperActive?.((active: boolean) => !active);
      return;
    }
    if (eyedropperActive) h.setTexturePaintEyedropperActive?.(false);
    if (tool === "fill") {
      update({ tool: "fill" });
      return;
    }
    update({ tool: "surface-brush", blend: tool === "eraser" ? "erase" : "normal" });
  };

  const nudgeSize = (direction: 1 | -1) => {
    if (disabled) return;
    const next = clampSize(size + sizeStep(size) * direction);
    if (next === size) return;
    update({ sizeTexels: next });
  };

  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => setResetArmed(false), RESET_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [resetArmed]);

  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent): boolean => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key !== "[" && event.key !== "]") return false;
      if (isCharacterShaperTypingTarget(event.target)) return false;
      event.preventDefault();
      nudgeSize(event.key === "]" ? 1 : -1);
      return true;
    };
  });

  useEffect(() => pushCharacterShaperKeyLayer((event) => keyHandlerRef.current(event), window), []);

  const tools: readonly { readonly id: PaintTool; readonly label: string; readonly icon: typeof Brush; readonly hint: string }[] = [
    { id: "brush", label: "브러시", icon: Brush, hint: "모델 표면을 따라 직접 그립니다" },
    { id: "eraser", label: "지우개", icon: Eraser, hint: "칠한 자리를 원래 텍스처로 되돌립니다" },
    { id: "eyedropper", label: "스포이드", icon: Pipette, hint: "표면 색을 집어 옵니다 (Alt+클릭)" },
    { id: "fill", label: "채우기", icon: PaintBucket, hint: "이어진 같은 색 영역을 한 번에 채웁니다" },
  ];

  return (
    <div
      role="toolbar"
      aria-label="표면 드로잉 도구"
      data-character-shaper-paint-hud="true"
      className="flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-line/70 bg-panel/95 p-1.5 shadow-[0_12px_36px_oklch(0.05_0.01_70/0.4)] backdrop-blur"
    >
      <div role="group" aria-label="도구" className="flex shrink-0 items-center gap-1">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={active}
              aria-label={tool.label}
              title={`${tool.label} · ${tool.hint}`}
              disabled={disabled}
              onClick={() => selectTool(tool.id)}
              className={cn(CHIP, active && CHIP_ACTIVE)}
            >
              <Icon size={16} aria-hidden />
            </button>
          );
        })}
      </div>

      <span aria-hidden className="h-6 w-px shrink-0 bg-line/70" />

      <label className="flex min-w-0 shrink-0 items-center gap-1.5 text-[0.66rem] font-semibold text-fg-2">
        <span className="shrink-0">굵기</span>
        <input
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          value={size}
          disabled={disabled}
          aria-label="브러시 굵기"
          aria-keyshortcuts="[ ]"
          aria-valuetext={`${size} px`}
          className="h-11 w-24 min-w-0 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-45"
          onChange={(event) => update({ sizeTexels: clampSize(Number(event.currentTarget.value)) })}
        />
        <output aria-live="off" className="w-9 shrink-0 text-right tabular-nums text-fg-3">{size}px</output>
      </label>

      <label className="flex min-w-0 shrink-0 items-center gap-1.5 text-[0.66rem] font-semibold text-fg-2">
        <span className="shrink-0">농도</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={settings.opacity}
          disabled={disabled}
          aria-label="브러시 농도"
          aria-valuetext={`${Math.round(settings.opacity * 100)}%`}
          className="h-11 w-20 min-w-0 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-45"
          onChange={(event) => update({ opacity: Number(event.currentTarget.value) })}
        />
        <output aria-live="off" className="w-9 shrink-0 text-right tabular-nums text-fg-3">
          {Math.round(settings.opacity * 100)}%
        </output>
      </label>

      <input
        type="color"
        value={settings.color}
        disabled={disabled}
        aria-label="칠할 색"
        title={`칠할 색 ${settings.color.toUpperCase()}`}
        className={cn(
          "size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-card p-1 disabled:cursor-not-allowed disabled:opacity-45",
          STUDIO_FOCUS_RING,
        )}
        onChange={(event) => update({ color: event.currentTarget.value.toLowerCase() })}
      />

      <span aria-hidden className="h-6 w-px shrink-0 bg-line/70" />

      <div role="group" aria-label="되돌리기" className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="드로잉 되돌리기"
          title="드로잉 되돌리기"
          disabled={!canUndo}
          onClick={() => h.handleTexturePaintUndo?.()}
          className={CHIP}
        >
          <Undo2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="드로잉 다시 실행"
          title="드로잉 다시 실행"
          disabled={!canRedo}
          onClick={() => h.handleTexturePaintRedo?.()}
          className={CHIP}
        >
          <Redo2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={resetArmed ? "이 표면의 드로잉 전부 지우기 확인" : "이 표면의 드로잉 전부 지우기"}
          title={resetArmed ? "한 번 더 누르면 이 표면의 드로잉이 모두 지워집니다" : "이 표면의 드로잉을 원본 텍스처로 되돌립니다"}
          disabled={disabled}
          onClick={() => {
            if (!resetArmed) {
              setResetArmed(true);
              return;
            }
            setResetArmed(false);
            h.handleTexturePaintReset?.();
          }}
          className={cn(CHIP, resetArmed && "border-bad/55 bg-bad/10 text-bad")}
        >
          <RotateCcw size={16} aria-hidden />
        </button>
      </div>

      <button
        type="button"
        aria-label="표면 드로잉 끝내기"
        title="표면 드로잉 끝내기 (B)"
        aria-keyshortcuts="B"
        onClick={onExit}
        className={cn(CHIP, "ml-auto")}
      >
        <X size={16} aria-hidden />
      </button>

      <p
        role="status"
        aria-label="표면 드로잉 상태"
        className={cn(
          "w-full min-w-0 px-1 text-[0.64rem] leading-relaxed",
          disabledReason ? "font-semibold text-warn" : "text-fg-3",
        )}
      >
        {disabledReason
          || (resetArmed ? "한 번 더 누르면 이 표면의 드로잉이 모두 지워집니다." : "")
          || status
          || "뷰포트에서 칠할 표면을 누른 뒤 드래그하세요. [ ] 로 굵기를 바꿉니다."}
      </p>
    </div>
  );
}
