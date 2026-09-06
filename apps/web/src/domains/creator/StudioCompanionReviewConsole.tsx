import { Brush, Check, Eye, EyeOff, History, MessageSquare, Redo2, Undo2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import {
  STUDIO_COMPANION_BRUSH_SIZE_MAX,
  STUDIO_COMPANION_BRUSH_SIZE_MIN,
  type StudioCompanionBrushPatch,
  type StudioCompanionReviewProjection,
} from "./studio-companion-review-projection";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

type ReviewSection = "layers" | "history" | "comments";

type StudioReviewT = (key: string, fallback?: string) => string;

function localizeText(t: StudioReviewT, fallback: string, key: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function interpolateText(
  message: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return message;
  return Object.entries(values).reduce(
    (memo, [key, value]) => memo.replaceAll(`{${key}}`, String(value)),
    message,
  );
}

function tText(
  t: StudioReviewT,
  fallback: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  return interpolateText(localizeText(t, fallback, key), values);
}

export interface StudioCompanionReviewConsoleProps {
  projection: StudioCompanionReviewProjection | null;
  connected: boolean;
  presentationSafe: boolean;
  layout?: "embedded" | "dedicated";
  onSelectLayer: (layerId: string) => void;
  onHistory: (action: "undo" | "redo") => void;
  onCommentFocus: (threadId: string) => void;
  onBrushPatch: (patch: StudioCompanionBrushPatch) => void;
}

const sectionButtonClass =
  "min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/35";

export function StudioCompanionReviewConsole({
  projection,
  connected,
  presentationSafe,
  layout = "embedded",
  onSelectLayer,
  onHistory,
  onCommentFocus,
  onBrushPatch,
}: StudioCompanionReviewConsoleProps) {
  const [section, setSection] = useState<ReviewSection>("layers");
  const controlsReady = connected && projection !== null && !presentationSafe;
  const t = useT();

  if (!projection) {
    return (
      <section
        aria-label={t("studio.toolsCompanion.review.title")}
        className={cn(
          "grid min-h-72 place-items-center rounded-xl border border-line bg-card px-6 text-center",
          layout === "dedicated" && "min-h-80 flex-1"
        )}
      >
        <span>
          <History className="mx-auto size-6 text-fg-3" aria-hidden />
          <strong className="mt-3 block text-sm font-semibold text-fg-2">
            {t("studio.toolsCompanion.review.waitingData")}
          </strong>
          <span className="mt-1 block text-xs leading-relaxed text-fg-3">
            {t("studio.toolsCompanion.review.emptyStateHint")}
          </span>
        </span>
      </section>
    );
  }

  const sections = ["layers", "history", "comments"] as const;
  function handleSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + sections.length) % sections.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = sections[nextIndex];
    if (!next) return;
    setSection(next);
    globalThis.requestAnimationFrame?.(() => {
      document.getElementById(`companion-review-tab-${next}`)?.focus();
    });
  }

  return (
    <section
      aria-labelledby="companion-review-title"
      className={cn(
        "space-y-3",
        layout === "dedicated" && "flex min-h-0 flex-1 flex-col space-y-0 gap-3"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="companion-review-title" className="text-sm font-semibold text-fg">
            {t("studio.toolsCompanion.review.title")}
          </h2>
          <p className="mt-0.5 truncate text-xs text-fg-3">
            {presentationSafe
              ? t("studio.toolsCompanion.review.presentationSafeTitle")
              : tText(
                t,
                `${projection.pageLabel} · ${projection.selectionLabel ?? "선택 없음"}`,
                "studio.toolsCompanion.review.subtitle",
                {
                  pageLabel: projection.pageLabel,
                  selectionLabel: projection.selectionLabel ?? t("studio.toolsCompanion.review.emptySelection"),
                },
              )}
          </p>
        </div>
      </div>

      {presentationSafe ? (
        <div role="status" className="rounded-xl border border-good/35 bg-good/10 px-3 py-2.5 text-xs leading-relaxed text-good">
          {t("studio.toolsCompanion.review.presentationSafeBanner")}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-2">
              <Brush className="size-3.5" aria-hidden /> {t("studio.toolsCompanion.review.brushRemoteTitle")}
            </span>
            <span className="text-[0.65rem] tabular-nums text-fg-3">
              {projection.brush.size}px · {Math.round(projection.brush.opacity * 100)}%
            </span>
          </div>
          <label className="block text-[0.68rem] font-medium text-fg-3">
            {t("studio.toolsCompanion.review.brushLabel")}
            <select
              aria-label={t("studio.toolsCompanion.review.brushSelectAria")}
              value={projection.brush.id}
              disabled={!controlsReady}
              onChange={(event) => onBrushPatch({ id: event.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-raised px-2 text-xs text-fg outline-none focus:border-accent disabled:opacity-50"
            >
              {projection.brush.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-[0.68rem] font-medium text-fg-3">
            {tText(t, `크기 ${projection.brush.size}px`, "studio.toolsCompanion.review.brushSize", {
              size: projection.brush.size,
            })}
            <input
              type="range"
              aria-label={t("studio.toolsCompanion.review.brushSizeAria")}
              min={STUDIO_COMPANION_BRUSH_SIZE_MIN}
              max={STUDIO_COMPANION_BRUSH_SIZE_MAX}
              value={projection.brush.size}
              disabled={!controlsReady}
              onChange={(event) => onBrushPatch({ size: Number(event.target.value) })}
              className="mt-1 h-11 w-full accent-accent disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-end gap-3">
            <label className="block text-[0.68rem] font-medium text-fg-3">
              {tText(
                t,
                `불투명도 ${Math.round(projection.brush.opacity * 100)}%`,
                "studio.toolsCompanion.review.brushOpacity",
                { opacity: Math.round(projection.brush.opacity * 100) },
              )}
              <input
                type="range"
                aria-label={t("studio.toolsCompanion.review.brushOpacityAria")}
                min={0}
                max={100}
                value={Math.round(projection.brush.opacity * 100)}
                disabled={!controlsReady}
                onChange={(event) => onBrushPatch({ opacity: Number(event.target.value) / 100 })}
                className="mt-1 h-11 w-full accent-accent disabled:opacity-50"
              />
            </label>
            <label
              className="grid min-h-11 cursor-pointer place-items-center rounded-lg border border-line bg-raised"
              title={t("studio.toolsCompanion.review.brushColor")}
            >
              <span className="sr-only">{t("studio.toolsCompanion.review.brushColorAria")}</span>
              <input
                type="color"
                aria-label={t("studio.toolsCompanion.review.brushColorAria")}
                value={projection.brush.color}
                disabled={!controlsReady}
                onChange={(event) => onBrushPatch({ color: event.target.value })}
                className="size-8 cursor-pointer border-0 bg-transparent p-0 disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      )}

      <div
        className="flex rounded-xl border border-line bg-card p-1"
        role="tablist"
        aria-label={t("studio.toolsCompanion.review.sectionTabs")}
      >
        {([
          [
            "layers",
            tText(t, `레이어 ${projection.layers.length}`, "studio.toolsCompanion.review.section.layers", {
              count: projection.layers.length,
            }),
          ],
          [
            "history",
            tText(t, `기록 ${projection.history.length}`, "studio.toolsCompanion.review.section.history", {
              count: projection.history.length,
            }),
          ],
          [
            "comments",
            tText(
              t,
              `댓글 ${projection.comments.length}`,
              "studio.toolsCompanion.review.section.comments",
              { count: projection.comments.length },
            ),
          ],
        ] as const).map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`companion-review-tab-${id}`}
            aria-selected={section === id}
            aria-controls={`companion-review-panel-${id}`}
            tabIndex={section === id ? 0 : -1}
            onClick={() => setSection(id)}
            onKeyDown={(event) => handleSectionKeyDown(event, index)}
            className={cn(
              sectionButtonClass,
              section === id ? "bg-raised text-fg" : "text-fg-3 hover:text-fg-2"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
          role="tabpanel"
          id="companion-review-panel-layers"
          aria-labelledby="companion-review-tab-layers"
          hidden={section !== "layers"}
          className={cn(
            "space-y-1 overflow-y-auto pr-0.5",
            layout === "dedicated" ? "min-h-40 flex-1" : "max-h-72"
          )}
        >
          {projection.layers.map((layer, index) => (
            <button
              key={layer.id}
              type="button"
              aria-pressed={presentationSafe ? false : layer.selected}
              disabled={!controlsReady}
              onClick={() => onSelectLayer(layer.id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-lg border px-2.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-default",
                layer.selected && !presentationSafe
                  ? "border-accent/45 bg-accent-soft text-fg"
                  : "border-line/70 bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {layer.visible ? <Eye className="size-3.5 shrink-0" aria-hidden /> : <EyeOff className="size-3.5 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {presentationSafe
                  ? tText(t, `레이어 ${index + 1}`, "studio.toolsCompanion.review.layerItem", {
                    index: index + 1,
                  })
                  : layer.label}
              </span>
              <span className="max-w-16 truncate text-[0.62rem] text-fg-3">
                {presentationSafe
                  ? t("studio.toolsCompanion.review.layerKindFallback")
                  : layer.kind}
              </span>
              {layer.selected && !presentationSafe ? <Check className="size-3.5 text-accent" aria-hidden /> : null}
            </button>
          ))}
          {projection.layers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-fg-3">
              {t("studio.toolsCompanion.review.noLayers")}
            </p>
          ) : null}
          {projection.truncated.layers > 0 ? (
            <p className="py-1 text-center text-[0.65rem] text-fg-3">
              {tText(t, `외 ${projection.truncated.layers}개 레이어`, "studio.toolsCompanion.review.truncatedLayers", {
                count: projection.truncated.layers,
              })}
            </p>
          ) : null}
      </div>

      <div
          role="tabpanel"
          id="companion-review-panel-history"
          aria-labelledby="companion-review-tab-history"
          hidden={section !== "history"}
          className={cn(
            "space-y-2",
            layout === "dedicated" && "flex min-h-40 flex-1 flex-col gap-2 space-y-0 overflow-hidden"
          )}
        >
          {!presentationSafe ? (
            <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!controlsReady || !projection.canUndo}
                  onClick={() => onHistory("undo")}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card text-xs font-semibold text-fg-2 outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Undo2 className="size-3.5" aria-hidden /> {t("studio.toolsCompanion.review.undo")}
                </button>
                <button
                  type="button"
                  disabled={!controlsReady || !projection.canRedo}
                  onClick={() => onHistory("redo")}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card text-xs font-semibold text-fg-2 outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Redo2 className="size-3.5" aria-hidden /> {t("studio.toolsCompanion.review.redo")}
                </button>
              </div>
            ) : null}
          <ol className={cn(
            "space-y-1 overflow-y-auto",
            layout === "dedicated" ? "max-h-none min-h-0 flex-1" : "max-h-64"
          )}>
            {projection.history.map((entry, index) => (
              <li key={entry.index} className={cn(
                "flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs",
                entry.current ? "border-accent/40 bg-accent-soft text-fg" : "border-line/60 bg-card text-fg-3"
              )}>
                <History className="size-3.5" aria-hidden />
                <span className="flex-1">
                  {presentationSafe
                    ? tText(
                      t,
                      "작업 기록 {index}",
                      "studio.toolsCompanion.review.historyItem",
                      { index: index + 1 },
                    )
                    : entry.label}
                </span>
                {entry.current ? (
                  <span className="text-[0.62rem] font-semibold text-accent">
                    {t("studio.toolsCompanion.review.current")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {projection.history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-fg-3">
              {t("studio.toolsCompanion.review.noHistory")}
            </p>
          ) : null}
      </div>

      <div
          role="tabpanel"
          id="companion-review-panel-comments"
          aria-labelledby="companion-review-tab-comments"
          hidden={section !== "comments"}
          className={cn(
            "space-y-1.5 overflow-y-auto pr-0.5",
            layout === "dedicated" ? "min-h-40 flex-1" : "max-h-72"
          )}
        >
          {projection.comments.map((comment) => (
            <button
              key={comment.id}
              type="button"
              disabled={!controlsReady}
              onClick={() => onCommentFocus(comment.id)}
              className="flex min-h-11 w-full items-start gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-left outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-default"
            >
              <MessageSquare className={cn("mt-0.5 size-3.5 shrink-0", comment.unread ? "text-accent" : "text-fg-3")} aria-hidden />
              <span className="min-w-0 flex-1">
                {presentationSafe ? (
                  <span className="block text-xs text-fg-3">
                    {t("studio.toolsCompanion.review.commentStatusLabel")}
                    {comment.resolved
                      ? ` ${t("studio.toolsCompanion.review.commentState.resolved")}`
                      : ` ${t("studio.toolsCompanion.review.commentState.open")}`}
                  </span>
                ) : (
                  <>
                    <span className="block truncate text-[0.68rem] font-semibold text-fg-2">{comment.author}</span>
                    <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-fg-3">{comment.excerpt}</span>
                  </>
                )}
              </span>
            </button>
          ))}
          {projection.comments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-fg-3">
              {t("studio.toolsCompanion.review.noComments")}
            </p>
          ) : null}
          {projection.truncated.comments > 0 ? (
            <p className="py-1 text-center text-[0.65rem] text-fg-3">
              {tText(t, `외 {count}개 댓글`, "studio.toolsCompanion.review.truncatedComments", {
                count: projection.truncated.comments,
              })}
            </p>
          ) : null}
      </div>
    </section>
  );
}

export default StudioCompanionReviewConsole;
