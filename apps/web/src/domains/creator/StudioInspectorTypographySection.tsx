/**
 * Text typography — split into three disclosures (UX 감사 2026-09-02 §5.8 텍스트 선택).
 *
 * One 타이포그래피 section used to fold ~15 controls into a single block: tidy while
 * closed, a wall again the moment it opened. The controls now sit under the headings a
 * type tool uses — 글꼴 (family, custom fonts, size, weight, italic), 외형 (outline,
 * shadow) and 고급 조판 (effects, curved text) — and the paragraph controls (alignment,
 * vertical writing, letter/line spacing) live in the 문단 section next door
 * (`StudioInspectorSelectionSection`, `element.text-align`) so alignment is exposed
 * once, not twice.
 *
 * `element.typography` keeps its id: search rows and menu deep links land on the 글꼴
 * block, which is where "typography" starts.
 */
import { Bold, Italic } from "lucide-react";
import { Suspense } from "react";

import { normalizeTextPath, type TextPathConfig } from "./lettering/studio-text-path";
import { BRAND_KIT_FONTS, DEFAULT_BRAND_KIT_FONT } from "./studio-brand-kit";
import {
  StudioCustomFontsPanel,
  StudioTextEffectPanel,
  StudioTextPathPanel,
} from "./studio-page-lazy-ui";
import { StudioCircularTextPanel } from "./text/StudioCircularTextPanel";
import { StudioPresetFontPreload } from "./studio-preset-font-loading";
import { StudioInspectorSection } from "./StudioInspectorSection";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type { BubbleEl, El, TextEl } from "./studio-element-model";

import { cn } from "@/shared/lib/utils";

interface StudioInspectorTypographySectionProps {
  selected: TextEl | BubbleEl;
  patchEl: (id: string, patch: Partial<El>) => void;
}

const SLIDER_CLASS = "w-24 accent-accent cursor-pointer sm:w-28 h-2";

function countActiveAppearance(selected: TextEl): number {
  return (selected.stroke ? 1 : 0) + (selected.shadowColor ? 1 : 0);
}

export function StudioInspectorTypographySection({
  selected,
  patchEl,
}: StudioInspectorTypographySectionProps) {
  const fontSize = selected.type === "text" ? selected.fontSize : selected.fontSize ?? 24;
  const fsVal = selected.fontStyle ?? "bold";
  const isBold = fsVal.includes("bold");
  const isItalic = fsVal.includes("italic");
  const text = selected.type === "text" ? selected : null;

  return (
    <>
      <StudioInspectorSection sectionId="element.typography" loadingLabel="글꼴을 여는 중...">
        <div className="mt-2">
          <p className="mb-1 text-[0.6875rem] font-medium text-fg-3">글꼴</p>
          <StudioPresetFontPreload />
          <div className="flex flex-wrap gap-1">
            {BRAND_KIT_FONTS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => patchEl(selected.id, { font: f.value } as Partial<El>)}
                style={{ fontFamily: f.value }}
                data-inspector-priority="advanced"
                data-inspector-control-id={`typography.font.${f.label}`}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  (selected.font ?? DEFAULT_BRAND_KIT_FONT) === f.value
                    ? "border-accent/60 bg-accent-soft/50 text-fg"
                    : "border-line text-fg-2 hover:bg-raised"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 border-t border-line/30 pt-3">
          <StudioCustomFontsPanel
            canApplyFont
            onApplyFont={(font) => patchEl(selected.id, { font } as Partial<El>)}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-sm text-fg-2">
          글자 크기
          <div className="flex items-center gap-1">
            {[-4, 4].map((d) => (
              <button
                key={d}
                type="button"
                aria-label={d < 0 ? "글자 작게" : "글자 크게"}
                data-inspector-priority="advanced"
                data-inspector-control-id={d < 0 ? "typography.size.decrease" : "typography.size.increase"}
                onClick={() => {
                  patchEl(selected.id, { fontSize: Math.max(12, Math.min(96, fontSize + d)) } as Partial<El>);
                }}
                className="grid size-7 place-items-center rounded-md border border-line text-fg-2 hover:bg-raised"
              >
                {d < 0 ? "−" : "+"}
              </button>
            ))}
            <span className="w-7 text-center text-xs tabular-nums text-fg-3">
              {fontSize}
            </span>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 text-sm text-fg-2">
          스타일
          <div className="flex gap-0.5 rounded-lg border border-line bg-panel p-0.5">
            <button
              type="button"
              aria-pressed={isBold}
              data-inspector-priority="advanced"
              data-inspector-control-id="typography.bold"
              onClick={() => {
                let nextStyle: "normal" | "bold" | "italic" | "bold italic";
                if (isBold) {
                  nextStyle = isItalic ? "italic" : "normal";
                } else {
                  nextStyle = isItalic ? "bold italic" : "bold";
                }
                patchEl(selected.id, { fontStyle: nextStyle } as Partial<El>);
              }}
              className={cn(
                "grid size-7 place-items-center rounded transition-colors cursor-pointer",
                isBold ? "bg-accent/20 text-accent font-bold border border-accent/35" : "text-fg-3 hover:bg-raised hover:text-fg-2"
              )}
              title="굵게"
            >
              <Bold size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={isItalic}
              data-inspector-priority="advanced"
              data-inspector-control-id="typography.italic"
              onClick={() => {
                let nextStyle: "normal" | "bold" | "italic" | "bold italic";
                if (isItalic) {
                  nextStyle = isBold ? "bold" : "normal";
                } else {
                  nextStyle = isBold ? "bold italic" : "italic";
                }
                patchEl(selected.id, { fontStyle: nextStyle } as Partial<El>);
              }}
              className={cn(
                "grid size-7 place-items-center rounded transition-colors cursor-pointer",
                isItalic ? "bg-accent/20 text-accent font-bold border border-accent/35" : "text-fg-3 hover:bg-raised hover:text-fg-2"
              )}
              title="기울임꼴"
            >
              <Italic size={14} aria-hidden />
            </button>
          </div>
        </div>
      </StudioInspectorSection>

      {text ? (
        <StudioInspectorSection
          sectionId="element.typography-appearance"
          activeCount={countActiveAppearance(text)}
          loadingLabel="외형을 여는 중..."
        >
          <div className="space-y-2.5">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-3">글자 외곽선 (Border)</p>

            <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
              외곽선 사용
              <input
                type="checkbox"
                checked={!!text.stroke}
                aria-label="글자 외곽선 사용"
                data-inspector-priority="advanced"
                data-inspector-control-id="typography.stroke"
                onChange={(e) => {
                  const hasStroke = e.target.checked;
                  patchEl(text.id, {
                    stroke: hasStroke ? (text.stroke || "#ffffff") : undefined,
                    strokeWidth: hasStroke ? (text.strokeWidth || 3) : 0,
                  } as Partial<El>);
                }}
                className="size-4 accent-accent cursor-pointer"
              />
            </div>

            {!!text.stroke && (
              <>
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  외곽선 색상
                  <input
                    type="color"
                    value={text.stroke || "#ffffff"}
                    data-inspector-priority="advanced"
                    data-inspector-control-id="typography.stroke.color"
                    onChange={(e) => patchEl(text.id, { stroke: e.target.value } as Partial<El>)}
                    className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  외곽선 두께
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0.5}
                      max={16}
                      step={0.5}
                      value={text.strokeWidth ?? 3}
                      data-inspector-priority="advanced"
                      data-inspector-control-id="typography.stroke.width"
                      onChange={(e) => patchEl(text.id, { strokeWidth: Number(e.target.value) } as Partial<El>)}
                      className={SLIDER_CLASS}
                    />
                    <span className="w-8 text-right text-xs tabular-nums text-fg-3">{(text.strokeWidth ?? 3).toFixed(1)}px</span>
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="space-y-2.5 border-t border-line/40 pt-2.5">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-3">글자 그림자 (Shadow)</p>

            <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
              그림자 사용
              <input
                type="checkbox"
                checked={!!text.shadowColor}
                aria-label="글자 그림자 사용"
                data-inspector-priority="advanced"
                data-inspector-control-id="typography.shadow"
                onChange={(e) => {
                  const hasShadow = e.target.checked;
                  patchEl(text.id, {
                    shadowColor: hasShadow ? (text.shadowColor || "#000000") : undefined,
                    shadowBlur: hasShadow ? (text.shadowBlur || 5) : undefined,
                    shadowOffsetX: hasShadow ? (text.shadowOffsetX || 3) : undefined,
                    shadowOffsetY: hasShadow ? (text.shadowOffsetY || 3) : undefined,
                    shadowOpacity: hasShadow ? (text.shadowOpacity || 0.6) : undefined,
                  } as Partial<El>);
                }}
                className="size-4 accent-accent cursor-pointer"
              />
            </div>

            {!!text.shadowColor && (
              <>
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  그림자 색상
                  <input
                    type="color"
                    value={text.shadowColor || "#000000"}
                    data-inspector-priority="advanced"
                    data-inspector-control-id="typography.shadow.color"
                    onChange={(e) => patchEl(text.id, { shadowColor: e.target.value } as Partial<El>)}
                    className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
                  />
                </label>

                {([
                  ["흐림 정도 (Blur)", "shadowBlur", 0, 20, 1, text.shadowBlur ?? 5, "px"],
                  ["가로 오프셋 (X)", "shadowOffsetX", -15, 15, 1, text.shadowOffsetX ?? 3, "px"],
                  ["세로 오프셋 (Y)", "shadowOffsetY", -15, 15, 1, text.shadowOffsetY ?? 3, "px"],
                ] as const).map(([label, key, min, max, step, value, unit]) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-sm text-fg-2">
                    {label}
                    <span className="flex items-center gap-2">
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        data-inspector-priority="advanced"
                        data-inspector-control-id={`typography.${key}`}
                        onChange={(e) => patchEl(text.id, { [key]: Number(e.target.value) } as Partial<El>)}
                        className={SLIDER_CLASS}
                      />
                      <span className="w-8 text-right text-xs tabular-nums text-fg-3">{value}{unit}</span>
                    </span>
                  </label>
                ))}

                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  불투명도
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={text.shadowOpacity ?? 0.6}
                      data-inspector-priority="advanced"
                      data-inspector-control-id="typography.shadowOpacity"
                      onChange={(e) => patchEl(text.id, { shadowOpacity: Number(e.target.value) } as Partial<El>)}
                      className={SLIDER_CLASS}
                    />
                    <span className="w-8 text-right text-xs tabular-nums text-fg-3">{Math.round((text.shadowOpacity ?? 0.6) * 100)}%</span>
                  </span>
                </label>
              </>
            )}
          </div>
        </StudioInspectorSection>
      ) : null}

      {text ? (
        <StudioInspectorSection
          sectionId="element.typography-advanced"
          activeCount={text.textPath ? 1 : 0}
          loadingLabel="고급 조판을 여는 중..."
        >
          <Suspense fallback={<StudioPanelLoading label="글자 효과 패널을 여는 중..." />}>
            <StudioTextEffectPanel onApply={(patch) => patchEl(text.id, patch as Partial<El>)} />
          </Suspense>
          <div className="border-t border-line/40 pt-2.5">
            <Suspense fallback={<StudioPanelLoading label="곡선 텍스트 패널을 여는 중..." />}>
              <StudioTextPathPanel
                value={normalizeTextPath(text.textPath)}
                onPatch={(patch: Partial<TextPathConfig>) =>
                  patchEl(text.id, {
                    textPath: normalizeTextPath({ ...normalizeTextPath(text.textPath), ...patch }),
                  } as Partial<El>)
                }
                onApplyPreset={(v: TextPathConfig) => patchEl(text.id, { textPath: v } as Partial<El>)}
                onReset={() => patchEl(text.id, { textPath: undefined } as Partial<El>)}
              />
            </Suspense>
          </div>
          {/* CSP 패리티(main 6ddf0406): 원형 텍스트. 외곽선·그림자는 외형 섹션이, 자간·행간은 문단
              섹션이 이미 소유하므로 main 의 중복 블록은 들이지 않는다 — 밀도 감사의
              duplicate-control-id 계약이 그 이유다. */}
          <div className="mt-2.5 border-t border-line/40 pt-2.5">
            <StudioCircularTextPanel
              text={text.text}
              enabled={
                text.textPath?.shape === "circleUp" ||
                text.textPath?.shape === "circleDown"
              }
              options={{
                centerX: text.x + text.width / 2,
                centerY: text.y + (text.fontSize || 24),
                radius: Math.max(30, (text.textPath?.curve ?? 50) * 2),
                startAngleDeg: -90,
                direction:
                  text.textPath?.shape === "circleDown"
                    ? "counter-clockwise"
                    : "clockwise",
                orientation: "outward",
              }}
              onToggleEnabled={(enabled) => {
                if (enabled) {
                  patchEl(text.id, {
                    textPath: { shape: "circleUp", curve: 50 },
                  } as Partial<El>);
                } else {
                  patchEl(text.id, {
                    textPath: undefined,
                  } as Partial<El>);
                }
              }}
              onOptionsChange={(options) => {
                const shape =
                  options.direction === "counter-clockwise"
                    ? "circleDown"
                    : "circleUp";
                patchEl(text.id, {
                  textPath: {
                    shape,
                    curve: Math.round(options.radius / 2),
                  },
                } as Partial<El>);
              }}
            />
          </div>
        </StudioInspectorSection>
      ) : null}
    </>
  );
}
