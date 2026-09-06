import { useId, useLayoutEffect, useRef } from "react";

import { getStudioPaperBrushResponseSummaries } from "./brush/studio-paper-surface-brush-response";
import {
  getStudioPaperSurfaceCatalogEntry,
  getStudioPaperSurfaceCharacteristics,
  listStudioPaperSurfaceCatalogByGroup,
  studioPaperSurfaceSwatchStyle,
} from "./brush/studio-paper-surface-catalog";
import { getStudioPaperSurfacePreviewTile } from "./brush/studio-paper-surface-preview";

import type { PaperGrainKind } from "./brush/studio-paper-texture";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface StudioPaperSurfacePickerProps {
  readonly controlsDisabled: boolean;
  readonly paperGrainKind: PaperGrainKind;
  readonly paperGrainVisible: boolean;
  readonly onPaperGrainKindChange: (kind: PaperGrainKind) => void;
  readonly onPaperGrainVisibleChange: (visible: boolean) => void;
  readonly onApplyPaperTintBackground: () => void;
}

function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function StudioPaperTexturePreview({
  kind,
  label,
}: {
  readonly kind: PaperGrainKind;
  readonly label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paper = getStudioPaperSurfaceCatalogEntry(kind);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (
      !canvas
      || typeof globalThis.CanvasRenderingContext2D !== "function"
    ) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const tile = getStudioPaperSurfacePreviewTile(
      { kind, seed: 41 },
      { size: 64, grainStrength: 0.82 },
    );
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!tile) return;
    const pattern = context.createPattern(tile, "repeat");
    if (!pattern) return;
    context.fillStyle = pattern;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, [kind]);

  return (
    <div className="relative mt-2 overflow-hidden rounded-md border border-line bg-white">
      <canvas
        ref={canvasRef}
        width={240}
        height={56}
        role="img"
        aria-label={`${label} 실제 결 확대 미리보기`}
        className="block h-14 w-full"
        style={studioPaperSurfaceSwatchStyle(paper)}
      />
      <span className="absolute bottom-1 right-1 rounded border border-line/80 bg-panel/90 px-1.5 py-0.5 text-[0.58rem] font-semibold text-fg-2 shadow-sm">
        결 확대
      </span>
    </div>
  );
}

export function StudioPaperSurfacePicker({
  controlsDisabled,
  paperGrainKind,
  paperGrainVisible,
  onPaperGrainKindChange,
  onPaperGrainVisibleChange,
  onApplyPaperTintBackground,
}: StudioPaperSurfacePickerProps) {
  const t = useT();
  const previewToggleId = useId();
  const paperSections = listStudioPaperSurfaceCatalogByGroup();
  const activePaper = getStudioPaperSurfaceCatalogEntry(paperGrainKind);
  const characteristics = getStudioPaperSurfaceCharacteristics(paperGrainKind);
  const brushResponses = getStudioPaperBrushResponseSummaries(paperGrainKind);

  return (
    <section
      className="mt-3 border-t border-line/70 pt-3"
      aria-label={localizeText(t, "종이 표면", "studio.canvas.paperSurface")}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[0.72rem] font-semibold text-fg-2">
            {localizeText(t, "종이 표면", "studio.canvas.paperSurface")}
          </h3>
          <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
            {localizeText(
              t,
              "종이의 결·흡수성에 따라 브러시의 자국과 번짐이 달라져요. 배경색은 별도예요.",
              "studio.canvas.paperSurfaceHint",
            )}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-line bg-raised/60 px-1.5 py-0.5 text-[0.58rem] font-bold text-fg-2">
          {activePaper.shortLabel}
        </span>
      </div>

      {paperSections.map((section) => (
        <div key={section.group} className="mb-2.5 last:mb-0">
          <p className="mb-1 text-[0.58rem] font-semibold text-fg-3">
            {section.label}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {section.entries.map((entry) => {
              const active = entry.id === paperGrainKind;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={controlsDisabled}
                  title={`${entry.description} 잘 맞는 도구: ${entry.bestFor}`}
                  aria-label={entry.label}
                  aria-pressed={active}
                  onClick={() => onPaperGrainKindChange(entry.id)}
                  className={cn(
                    "flex min-h-9 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50",
                    active
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-line bg-panel/50 text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                >
                  <span
                    className="size-7 shrink-0 rounded border border-line/80"
                    style={studioPaperSurfaceSwatchStyle(entry)}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.62rem] font-semibold leading-tight">
                      {entry.shortLabel}
                    </span>
                    <span className="block truncate text-[0.52rem] leading-tight text-fg-3">
                      {entry.cue}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-3 border-t border-line/60 pt-2.5">
        <div className="flex items-center justify-between gap-2" aria-live="polite" aria-atomic="true">
          <p className="text-[0.68rem] font-bold text-fg-2">{activePaper.label}</p>
          <span className="text-[0.55rem] font-semibold text-fg-3">
            미리보기 {paperGrainVisible ? "켜짐" : "꺼짐"}
          </span>
        </div>
        <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-2">
          {activePaper.description}
        </p>

        <StudioPaperTexturePreview
          kind={paperGrainKind}
          label={activePaper.label}
        />

        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
          {characteristics.map((axis) => {
            const percentage = Math.round(axis.value * 100);
            return (
              <div key={axis.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-1 text-[0.55rem]">
                  <dt className="font-medium text-fg-3">{axis.label}</dt>
                  <dd className="truncate font-semibold text-fg-2">{axis.valueLabel}</dd>
                </div>
                <div
                  role="meter"
                  aria-label={`${axis.label} ${axis.valueLabel}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentage}
                  className="mt-1 h-1 overflow-hidden rounded-full bg-raised"
                >
                  <span
                    className="block h-full rounded-full bg-accent/75 transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>

        <div className="mt-2.5 border-t border-line/50 pt-2">
          <p className="text-[0.58rem] font-bold text-fg-2">브러시 성질별 반응</p>
          <ul className="mt-1 divide-y divide-line/45">
            {brushResponses.map((response) => (
              <li key={response.id} className="py-1.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.58rem] font-semibold text-fg-2">{response.label}</span>
                  <span className="shrink-0 text-[0.55rem] font-bold text-accent">{response.level}</span>
                </div>
                <p className="mt-0.5 text-[0.56rem] leading-relaxed text-fg-3">
                  {response.description}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-2 text-[0.58rem] leading-relaxed text-fg-3">
          <span className="font-semibold text-fg-2">잘 맞는 도구</span> · {activePaper.bestFor}
        </p>
      </div>

      <div className="mt-2.5 border-t border-line/60 pt-2.5">
        <label
          htmlFor={previewToggleId}
          aria-label="편집 화면에서 종이 결 미리보기"
          className={cn(
            "flex items-center gap-2.5 rounded-md py-1.5 text-fg-2",
            controlsDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[0.62rem] font-semibold">
              {localizeText(
                t,
                "편집 화면에서 종이 결 미리보기",
                "studio.canvas.paperGrainVisible",
              )}
            </span>
            <span className="mt-0.5 block text-[0.55rem] leading-relaxed text-fg-3">
              화면 표시만 바꾸며 브러시의 종이 반응은 유지됩니다.
            </span>
          </span>
          <input
            id={previewToggleId}
            type="checkbox"
            className="peer sr-only"
            checked={paperGrainVisible}
            disabled={controlsDisabled}
            onChange={(event) => onPaperGrainVisibleChange(event.currentTarget.checked)}
          />
          <span
            aria-hidden
            className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-raised transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-3.5 after:rounded-full after:bg-fg-3 after:transition-transform peer-checked:border-accent/70 peer-checked:bg-accent/25 peer-checked:after:translate-x-4 peer-checked:after:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 motion-reduce:transition-none motion-reduce:after:transition-none"
          />
        </label>
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={onApplyPaperTintBackground}
          title={activePaper.tintBg}
          className="mt-1 w-full rounded-md border border-line bg-raised/50 px-2 py-1.5 text-left text-[0.6rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          배경도 {activePaper.shortLabel} 색으로 맞추기
        </button>
      </div>
    </section>
  );
}
