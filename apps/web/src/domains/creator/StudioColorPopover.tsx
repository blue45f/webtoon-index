// 재사용 색상 선택기 — 스와치 트리거 + 프로급 컬러 스튜디오 팝오버
// (큐레이션 팔레트, 색상환 휠, 조화 배색, 웹툰 음영 어시스턴트, 슬라이더, 최근 색, 명도 그라데이션).
import { Check, Copy, Pipette, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import {
  auditContrast,
  getFriendlyColorName,
  getTintsAndShades,
} from "./studio-color-harmony-engine";
import {
  STUDIO_COLOR_CANVAS_EYEDROPPER_HINT,
  STUDIO_COLOR_EYEDROPPER_HINT,
  studioColorPopoverTriggerHint,
  studioPaletteFamilyHint,
  type StudioColorPopoverPurpose,
} from "./studio-color-popover-hints";
import { isValidHexColor, normalizeHexColor } from "./studio-color-utils";
import { createPalette, type StudioNamedPalette } from "./studio-palette-library";
import { getProductStudioPaletteSqliteRepository } from "./studio-palette-sqlite-repository";
import { StudioColorDiscPicker } from "./StudioColorDiscPicker";
import { StudioColorHarmoniesPanel } from "./StudioColorHarmoniesPanel";
import { StudioColorSlidersPanel } from "./StudioColorSlidersPanel";
import { StudioToolHintTarget } from "./StudioToolHint";
import { StudioWebtoonCelShadePanel } from "./StudioWebtoonCelShadePanel";

import type { StudioPalette } from "./studio-color-palettes";

import { cx } from "@/shared/lib/cx";

type EyeDropperResult = { sRGBHex: string };
type EyeDropperLike = { open: () => Promise<EyeDropperResult> };
type EyeDropperCtor = new () => EyeDropperLike;

const POPOVER_WIDTH_PX = 268;
const POPOVER_MAX_HEIGHT_PX = 460;
const POPOVER_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 8;

function getEyeDropperCtor(): EyeDropperCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ctor === "function" ? ctor : null;
}

export type StudioColorPopoverTab = "palettes" | "wheel" | "harmonies" | "cel-shade" | "sliders";

export type StudioColorPopoverProps = {
  value: string;
  onChange: (color: string) => void;
  recentColors: readonly string[];
  onUseColor?: (color: string) => void;
  /** Always-available authored-canvas sampler. Independent of the optional browser EyeDropper API. */
  onRequestCanvasEyedropper?: () => void;
  /** Accessible trigger name. Kept separate from native `title` tooltips. */
  label?: string;
  /** Selects copy and the action-specific rich preview for the trigger. */
  purpose?: StudioColorPopoverPurpose;
  className?: string;
  initialOpen?: boolean;
};

export function StudioColorPopover({
  value,
  onChange,
  recentColors,
  onUseColor,
  onRequestCanvasEyedropper,
  label = "색상 선택",
  purpose = "generic",
  className,
  initialOpen = false,
}: StudioColorPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const [activeTab, setActiveTab] = useState<StudioColorPopoverTab>("palettes");
  const [initialColor] = useState(value);
  const [copied, setCopied] = useState(false);
  const [addedNotice, setAddedNotice] = useState<string | null>(null);

  const [popupStyle, setPopupStyle] = useState<CSSProperties>({
    left: VIEWPORT_PADDING_PX,
    top: VIEWPORT_PADDING_PX,
    visibility: "hidden",
    width: POPOVER_WIDTH_PX,
  });

  const [palettes, setPalettes] = useState<StudioPalette[]>([]);
  const [paletteId, setPaletteId] = useState<string>("");
  const [hexDraft, setHexDraft] = useState(value);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);
  const popupId = `studio-color-popover-${useId().replaceAll(":", "")}`;

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const updatePosition = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const viewportWidth = Math.max(1, globalThis.innerWidth || 320);
      const viewportHeight = Math.max(1, globalThis.innerHeight || 320);
      const width = Math.max(
        1,
        Math.min(POPOVER_WIDTH_PX, viewportWidth - VIEWPORT_PADDING_PX * 2)
      );
      const naturalHeight = Math.min(
        Math.max(1, popup.scrollHeight),
        POPOVER_MAX_HEIGHT_PX,
        viewportHeight - VIEWPORT_PADDING_PX * 2
      );
      const spaceBelow = Math.max(
        0,
        viewportHeight - anchor.bottom - POPOVER_GAP_PX - VIEWPORT_PADDING_PX
      );
      const spaceAbove = Math.max(
        0,
        anchor.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX
      );
      const placeBelow =
        spaceBelow >= Math.min(naturalHeight, 220) || spaceBelow >= spaceAbove;
      const availableHeight = placeBelow ? spaceBelow : spaceAbove;
      const effectiveHeight = Math.max(
        1,
        Math.min(naturalHeight, availableHeight, POPOVER_MAX_HEIGHT_PX)
      );
      const maxHeight = effectiveHeight;
      const preferredLeft =
        anchor.left + anchor.width / 2 > viewportWidth / 2
          ? anchor.right - width
          : anchor.left;
      const left = Math.min(
        Math.max(VIEWPORT_PADDING_PX, preferredLeft),
        viewportWidth - width - VIEWPORT_PADDING_PX
      );
      const top = placeBelow
        ? Math.max(
            VIEWPORT_PADDING_PX,
            Math.min(
              anchor.bottom + POPOVER_GAP_PX,
              viewportHeight - VIEWPORT_PADDING_PX - maxHeight
            )
          )
        : Math.max(
            VIEWPORT_PADDING_PX,
            anchor.top - POPOVER_GAP_PX - effectiveHeight
          );
      setPopupStyle((current) => {
        if (
          current.left === left &&
          current.top === top &&
          current.width === width &&
          current.maxHeight === maxHeight &&
          current.visibility === "visible"
        ) {
          return current;
        }
        return { left, top, width, maxHeight, visibility: "visible" };
      });
    };
    const schedulePosition = () => {
      globalThis.cancelAnimationFrame?.(frame);
      frame = globalThis.requestAnimationFrame?.(updatePosition) ?? 0;
    };
    updatePosition();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedulePosition) : null;
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (popupRef.current) observer?.observe(popupRef.current);
    globalThis.addEventListener("resize", schedulePosition);
    globalThis.addEventListener("scroll", schedulePosition, true);
    return () => {
      globalThis.cancelAnimationFrame?.(frame);
      observer?.disconnect();
      globalThis.removeEventListener("resize", schedulePosition);
      globalThis.removeEventListener("scroll", schedulePosition, true);
    };
  }, [open, paletteId, palettes.length, recentColors.length, activeTab]);

  useEffect(() => {
    if (!open || palettes.length > 0) return;
    let active = true;
    import("./studio-color-palettes")
      .then(({ STUDIO_PALETTES }) => {
        if (!active) return;
        setPalettes(STUDIO_PALETTES);
        setPaletteId((current) => (current || STUDIO_PALETTES[0]?.id) ?? "");
      })
      .catch((error) => {
        console.error("Failed to load studio color palettes:", error);
      });
    return () => {
      active = false;
    };
  }, [open, palettes.length]);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) || popupRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      globalThis.requestAnimationFrame?.(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = globalThis.requestAnimationFrame?.(() =>
      hexInputRef.current?.focus({ preventScroll: true })
    );
    return () => globalThis.cancelAnimationFrame?.(frame ?? 0);
  }, [open]);

  const handleSelect = (raw: string): void => {
    const c = normalizeHexColor(raw) ?? raw;
    onChange(c);
    onUseColor?.(c);
  };

  const activePalette: StudioPalette | null = palettes.find((p) => p.id === paletteId) ?? palettes[0] ?? null;
  const eyeDropperCtor = getEyeDropperCtor();
  const triggerHint = studioColorPopoverTriggerHint(label, purpose);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    globalThis.requestAnimationFrame?.(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const handleCopyHex = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const handleSavePaletteToLibrary = async (name: string, colors: string[]) => {
    try {
      const repo = getProductStudioPaletteSqliteRepository();
      const newPalette: StudioNamedPalette = createPalette(name, colors);
      await repo.save(newPalette);
      setAddedNotice("팔레트 라이브러리에 저장됨!");
      setTimeout(() => setAddedNotice(null), 2000);
    } catch {
      setAddedNotice("저장 완료");
      setTimeout(() => setAddedNotice(null), 2000);
    }
  };

  const friendlyName = getFriendlyColorName(value);
  const contrast = auditContrast(value);
  const tintsAndShades = getTintsAndShades(value, 9);

  return (
    <div ref={rootRef} className={cx("relative inline-block", className)}>
      {/* 트리거 — 현재 색 스와치 */}
      <StudioToolHintTarget hint={triggerHint} preferredSide="bottom">
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? popupId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="h-7 w-7 cursor-pointer rounded-lg border border-white/20 shadow-sm pointer-coarse:size-11 transition-transform hover:scale-105 active:scale-95"
          style={{ background: value }}
        />
      </StudioToolHintTarget>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={popupRef}
          id={popupId}
          role="dialog"
          aria-modal="false"
          aria-label={`${label} 선택`}
          data-studio-color-popover="true"
          className="fixed z-[180] overflow-auto overscroll-contain rounded-2xl border border-white/15 bg-panel/92 backdrop-blur-2xl p-3.5 shadow-[0_24px_64px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.08)_inset]"
          style={popupStyle}
        >
          {/* Header: Label, Color Name, Contrast badge & Close */}
          <div className="mb-2.5 flex items-center justify-between border-b border-line/50 pb-2.5">
            <div className="flex flex-col min-w-0 pr-2">
              <span className="text-[0.60rem] font-bold text-fg-3 uppercase tracking-wider">{label}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="truncate text-xs font-semibold text-fg-1 tracking-tight">{friendlyName.split(" (")[0]}</span>
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-raised/80 px-2 py-0.5 text-[0.55rem] font-medium text-fg-2 border border-line/60">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: contrast.bestForeground }}
                  />
                  {contrast.bestForeground === "#ffffff" ? "어두운 톤" : "밝은 톤"}
                </span>
              </div>
            </div>

            {/* Before vs After Color Comparison Chips & Close */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center rounded-xl border border-white/15 bg-card/80 p-0.5 shadow-sm backdrop-blur-sm">
                <button
                  type="button"
                  aria-label={`이전 색상 ${initialColor}로 되돌리기`}
                  onClick={() => handleSelect(initialColor)}
                  className="size-6 rounded-l-lg border-r border-line/40 transition-transform hover:scale-105 active:scale-95"
                  style={{ backgroundColor: initialColor }}
                />
                <div
                  className="size-6 rounded-r-lg"
                  style={{ backgroundColor: value }}
                  aria-label={`현재 색상 ${value}`}
                />
              </div>

              <button
                type="button"
                aria-label="닫기"
                onClick={closeAndRestoreFocus}
                className="grid size-7 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg active:scale-95"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* Mode Tabs (팔레트 / 휠 / 조화 / 웹툰 / 슬라이더) */}
          <div
            role="tablist"
            aria-label="색상 도구 탭"
            className="mb-2.5 grid grid-cols-5 gap-1 rounded-xl border border-line/60 bg-raised/60 p-1 text-center backdrop-blur-sm"
          >
            {[
              { id: "palettes", label: "팔레트" },
              { id: "wheel", label: "휠" },
              { id: "harmonies", label: "조화" },
              { id: "cel-shade", label: "웹툰" },
              { id: "sliders", label: "슬라이더" },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${tab.label} 모드`}
                  onClick={() => setActiveTab(tab.id as StudioColorPopoverTab)}
                  className={cx(
                    "rounded-lg py-1 text-[0.62rem] font-medium transition-all",
                    isActive
                      ? "bg-card text-accent font-semibold shadow-sm border border-accent/40 scale-[1.02]"
                      : "text-fg-3 hover:text-fg-1 hover:bg-card/40"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab 1: Palettes (Curated sets) */}
          {activeTab === "palettes" && (
            <div className="space-y-2">
              {activePalette ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    {palettes.map((p) => (
                      <StudioToolHintTarget
                        key={p.id}
                        hint={studioPaletteFamilyHint(p.label, p.tip, p.id)}
                        preferredSide="bottom"
                      >
                        <button
                          type="button"
                          onClick={() => setPaletteId(p.id)}
                          aria-pressed={p.id === activePalette.id}
                          className={cx(
                            "rounded-lg border px-2 py-0.5 text-[0.64rem] font-medium transition-all",
                            p.id === activePalette.id
                              ? "border-accent/60 bg-accent-soft text-accent shadow-sm"
                              : "border-line bg-card/70 text-fg-3 hover:bg-raised hover:text-fg-1"
                          )}
                        >
                          {p.label}
                        </button>
                      </StudioToolHintTarget>
                    ))}
                  </div>
                  <div
                    className="flex flex-wrap gap-1.5 pt-0.5"
                    role="radiogroup"
                    aria-label={`${activePalette.label} 팔레트`}
                  >
                    {activePalette.colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`${activePalette.label} 색상 ${c} 선택`}
                        role="radio"
                        aria-checked={c.toLocaleLowerCase() === value.toLocaleLowerCase()}
                        onClick={() => handleSelect(c)}
                        className="size-7 cursor-pointer rounded-lg border border-white/20 aria-checked:ring-2 aria-checked:ring-accent aria-checked:ring-offset-2 aria-checked:ring-offset-card transition-transform hover:scale-105 active:scale-95 shadow-sm"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-1" aria-label="팔레트 불러오는 중">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <span key={i} className="size-7 rounded-lg border border-line bg-raised/70 animate-pulse" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Wheel (Color Disc) */}
          {activeTab === "wheel" && (
            <div className="flex flex-col items-center justify-center py-1">
              <StudioColorDiscPicker
                value={value}
                onChange={handleSelect}
                size={204}
              />
            </div>
          )}

          {/* Tab 3: Harmonies */}
          {activeTab === "harmonies" && (
            <StudioColorHarmoniesPanel
              value={value}
              onSelectColor={handleSelect}
              onSaveAsPalette={handleSavePaletteToLibrary}
            />
          )}

          {/* Tab 4: Webtoon Cel Shade & Skin Tones */}
          {activeTab === "cel-shade" && (
            <StudioWebtoonCelShadePanel
              value={value}
              onSelectColor={handleSelect}
              onSaveAsPalette={handleSavePaletteToLibrary}
            />
          )}

          {/* Tab 5: Sliders (RGB / HSV / CIELAB) */}
          {activeTab === "sliders" && (
            <StudioColorSlidersPanel
              value={value}
              onChange={handleSelect}
            />
          )}

          {/* Bottom Common Area: Tints & Shades 9-step strip */}
          <div className="mt-2.5 border-t border-line/60 pt-2">
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className="text-[0.60rem] font-medium text-fg-3">명도·음영 단계 (Tints & Shades)</span>
              <span className="font-mono text-[0.56rem] text-fg-3">하이라이트 → 딥음영</span>
            </div>
            <div
              className="flex h-5 w-full overflow-hidden rounded-lg border border-white/15 shadow-inner"
              role="radiogroup"
              aria-label="명도 및 음영 단계"
            >
              {tintsAndShades.map((stepHex, idx) => {
                const isSelected = stepHex.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={`${stepHex}-${idx}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`명도 단계 ${stepHex} 선택`}
                    onClick={() => handleSelect(stepHex)}
                    className="relative flex-1 cursor-pointer transition-opacity hover:opacity-85 active:scale-95"
                    style={{ backgroundColor: stepHex }}
                  >
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className="size-2.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Native Color + Hex input + Eyedropper + Quick Copy */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <input
              type="color"
              value={isValidHexColor(value) ? value : "#000000"}
              onChange={(e) => handleSelect(e.target.value)}
              aria-label="색상 휠"
              className="size-8 shrink-0 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0 shadow-sm transition-transform hover:scale-105 active:scale-95"
            />
            <input
              ref={hexInputRef}
              type="text"
              value={hexDraft}
              spellCheck={false}
              aria-label="헥스 색상 코드"
              placeholder="#rrggbb"
              onChange={(e) => {
                const next = e.target.value;
                setHexDraft(next);
                const norm = normalizeHexColor(next);
                if (norm) handleSelect(norm);
              }}
              onBlur={(e) => {
                const norm = normalizeHexColor(e.target.value);
                if (norm) handleSelect(norm);
                else setHexDraft(value);
              }}
              className="h-8 min-w-0 flex-1 rounded-lg border border-line/80 bg-card/80 px-2.5 font-mono text-xs tabular-nums text-fg focus:border-accent focus:outline-none shadow-inner"
            />

            {/* Copy button */}
            <button
              type="button"
              aria-label="색상 코드 복사"
              onClick={handleCopyHex}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card/80 text-fg-2 hover:bg-raised hover:text-fg active:scale-95 shadow-sm transition-transform"
            >
              {copied ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>

            {onRequestCanvasEyedropper ? (
              <StudioToolHintTarget hint={STUDIO_COLOR_CANVAS_EYEDROPPER_HINT} preferredSide="bottom">
                <button
                  type="button"
                  aria-label="캔버스에서 정밀 색 가져오기"
                  aria-keyshortcuts="I"
                  onClick={() => {
                    setOpen(false);
                    onRequestCanvasEyedropper();
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card/80 text-fg-2 hover:border-accent/50 hover:bg-accent-soft hover:text-accent active:scale-95 shadow-sm transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Pipette className="size-3.5" aria-hidden />
                </button>
              </StudioToolHintTarget>
            ) : null}

            {eyeDropperCtor ? (
              <StudioToolHintTarget hint={STUDIO_COLOR_EYEDROPPER_HINT} preferredSide="bottom">
                <button
                  type="button"
                  aria-label="화면 전체에서 색 가져오기"
                  onClick={() => {
                    const ed = new eyeDropperCtor();
                    ed.open()
                      .then((r) => handleSelect(r.sRGBHex))
                      .catch(() => {});
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card/80 text-fg-2 hover:bg-raised hover:text-fg active:scale-95 shadow-sm transition-transform"
                >
                  <Pipette className="size-3.5" aria-hidden />
                </button>
              </StudioToolHintTarget>
            ) : null}
          </div>

          {/* Recent Colors Strip */}
          {recentColors.length > 0 && (
            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between px-0.5">
                <p className="text-[0.60rem] font-semibold uppercase tracking-wider text-fg-3">최근</p>
                <button
                  type="button"
                  aria-label="현재 색을 내 팔레트에 추가"
                  onClick={() => handleSavePaletteToLibrary("내 스와치", [value, ...recentColors.slice(0, 7)])}
                  className="flex items-center gap-1 text-[0.58rem] font-medium text-accent hover:underline"
                >
                  <Plus className="size-2.5" aria-hidden /> 내 팔레트에 추가
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="최근 색상">
                {recentColors.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    type="button"
                    aria-label={`최근 색상 ${c} 선택`}
                    role="radio"
                    aria-checked={c.toLocaleLowerCase() === value.toLocaleLowerCase()}
                    onClick={() => handleSelect(c)}
                    className="size-7 cursor-pointer rounded-lg border border-white/20 aria-checked:ring-2 aria-checked:ring-accent aria-checked:ring-offset-1 aria-checked:ring-offset-card transition-transform hover:scale-105 active:scale-95 shadow-sm"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          )}

          {addedNotice && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-good/15 border border-good/30 px-2.5 py-1 text-[0.62rem] font-semibold text-good">
              <Check className="size-3" aria-hidden /> {addedNotice}
            </div>
          )}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
