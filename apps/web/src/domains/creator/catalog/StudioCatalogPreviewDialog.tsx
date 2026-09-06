import { X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useStudioModalSheet } from "../useStudioModalSheet";

import { STUDIO_CATALOG_CONTROL } from "./StudioCatalogControls";

import "./studio-catalog-browser.css";

/** A shared, portal-mounted detail surface. Browsing never invokes the insertion callback. */
export function StudioCatalogPreviewDialog({ title, onClose, preview, children, actions }: {
  title: string; onClose: () => void; preview: ReactNode; children: ReactNode; actions: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [background, setBackground] = useState<"checker" | "light" | "dark">("checker");
  const [zoom, setZoom] = useState(100);
  useStudioModalSheet({ rootRef, dialogRef, activeKey: "catalog-preview", onDismiss: onClose,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLButtonElement>("[data-preview-close]") });
  if (typeof document === "undefined") return null;
  return createPortal(<div ref={rootRef} className="fixed inset-0 z-[300] grid place-items-center bg-black/50 p-2 sm:p-4"
    data-studio-catalog-preview-root="true">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
      className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
        <div className="min-w-0 flex-1"><p className="text-[0.65rem] font-medium text-fg-3">소재 상세 · 적용 전 확인</p><h2 id={headingId} className="break-words text-base font-semibold text-fg">{title}</h2></div>
        <button type="button" data-preview-close aria-label="상세 미리보기 닫기" onClick={onClose} className={`${STUDIO_CATALOG_CONTROL} w-11 shrink-0`}><X size={18} className="mx-auto" aria-hidden /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="미리보기 배경" className="flex gap-1">
            {([["checker", "투명"], ["light", "밝게"], ["dark", "어둡게"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={background === value} onClick={() => setBackground(value)} className={`${STUDIO_CATALOG_CONTROL} ${background === value ? "border-accent text-accent" : ""}`}>{label}</button>)}
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-2">확대 <input type="range" aria-label="미리보기 확대" min={50} max={200} step={25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-24 accent-accent" /><output className="w-10 tabular-nums">{zoom}%</output></label>
        </div>
        <div data-background={background} className="studio-catalog-preview-surface h-[min(45dvh,24rem)] min-h-40 overflow-auto rounded-xl border border-line">
          <div className="mx-auto flex items-center justify-center p-4" style={{ width: `${zoom}%`, height: `${zoom}%` }}>
            <div className="flex h-full min-h-32 w-full items-center justify-center" data-studio-catalog-detail-preview="true">{preview}</div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-fg-2">{children}</div>
      </div>
      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-line bg-panel p-3">{actions}</footer>
    </div>
  </div>, document.body);
}
