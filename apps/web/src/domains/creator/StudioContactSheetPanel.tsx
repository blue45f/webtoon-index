/**
 * Studio Contact Sheet Panel — 콘택트시트 PDF 옵션(용지·열·행·라벨) + 실행 버튼.
 * 이 패널 자신은 캡처도 합성도 하지 않는 순수 컨트롤이다(마술봉·노드 편집 패널과 동일한 관례) —
 * 실제 캡처(capturePagesForPreset)·합성(exportContactSheetPdf)·busy/상태 관리는
 * StudioExportMenuPanel 이 PDF/PSD 버튼과 동일한 패턴으로 소유한다. 이유: capturePagesForPreset
 * 는 재진입 불가능(페이지를 순회하며 currentPageId 를 바꿈)이라, 다른 내보내기 버튼들과 같은
 * busy 잠금 아래에 있어야 동시 실행 경쟁을 막을 수 있다 — 이 패널 안에 독립된 busy state 를
 * 두면 그 잠금이 깨진다.
 */
import { LayoutGrid, Loader2 } from "lucide-react";

import { CONTACT_SHEET_COLUMN_CHOICES, CONTACT_SHEET_PAGE_PRESETS, CONTACT_SHEET_ROW_CHOICES } from "./studio-pdf-contact-sheet";

import type { ReactElement } from "react";

import { cx } from "@/shared/lib/cx";

export interface StudioContactSheetPanelProps {
  columns: number;
  rows: number;
  pagePresetId: string;
  showLabels: boolean;
  /** 전체 페이지 수 — 미리보기 문구·실행 버튼 활성 조건에 쓴다. */
  pageCount: number;
  /** 콘택트시트 자체 캡처/합성이 진행 중인지. */
  busy: boolean;
  /** 다른 내보내기(PDF/규격/PSD)가 실행 중이면 true — 버튼을 잠근다. */
  disabled: boolean;
  status: { tone: "info" | "good" | "warn"; text: string } | null;
  setColumns: (n: number) => void;
  setRows: (n: number) => void;
  setPagePresetId: (id: string) => void;
  setShowLabels: (v: boolean) => void;
  onExport: () => void;
}

export function StudioContactSheetPanel({
  columns,
  rows,
  pagePresetId,
  showLabels,
  pageCount,
  busy,
  disabled,
  status,
  setColumns,
  setRows,
  setPagePresetId,
  setShowLabels,
  onExport,
}: StudioContactSheetPanelProps): ReactElement {
  const perSheet = Math.max(1, columns) * Math.max(1, rows);
  const sheetCount = pageCount > 0 ? Math.ceil(pageCount / perSheet) : 0;

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <LayoutGrid size={12} aria-hidden />
          콘택트시트 PDF
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <div>
        <span className="mb-1 block text-[0.68rem] font-semibold text-fg-2">용지</span>
        <div className="flex flex-wrap gap-1">
          {CONTACT_SHEET_PAGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPagePresetId(preset.id)}
              aria-pressed={pagePresetId === preset.id}
              className={cx(
                "h-7 rounded-lg border px-2 text-[0.68rem] font-semibold transition-colors",
                pagePresetId === preset.id
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold text-fg-2">열</span>
        <div className="flex items-center gap-1">
          {CONTACT_SHEET_COLUMN_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setColumns(n)}
              aria-pressed={columns === n}
              className={cx(
                "h-7 w-7 rounded-lg border text-[0.68rem] font-semibold transition-colors",
                columns === n ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold text-fg-2">행</span>
        <div className="flex items-center gap-1">
          {CONTACT_SHEET_ROW_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRows(n)}
              aria-pressed={rows === n}
              className={cx(
                "h-7 w-7 rounded-lg border text-[0.68rem] font-semibold transition-colors",
                rows === n ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <label
        className="flex cursor-pointer items-center gap-1.5 text-[0.68rem] text-fg-2"
        title="1페이지, 표지 등 페이지 이름을 칸 아래에 작게 표시해요."
      >
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(event) => setShowLabels(event.target.checked)}
          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
        />
        페이지 이름 표시
      </label>

      <p className="tabular-nums text-[0.66rem] text-fg-3">
        {columns}×{rows} = 한 장에 {perSheet}칸 · 전체 {pageCount}페이지 → {sheetCount}장
      </p>

      <button
        type="button"
        onClick={onExport}
        disabled={busy || disabled || pageCount < 1}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
        title={
          busy
            ? "콘택트시트를 만드는 중이에요"
            : disabled
              ? "다른 내보내기가 끝난 뒤 이용할 수 있어요"
              : pageCount < 1
                ? "내보낼 페이지가 없어요"
                : `전체 ${pageCount}페이지를 ${columns}×${rows} 격자로 모은 인쇄용 PDF로 저장`
        }
      >
        <LayoutGrid size={13} /> 콘택트시트 PDF로 저장
      </button>
      <p
        aria-live="polite"
        className={cx(
          status ? "rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
          status?.tone === "info" && "border-line bg-card text-fg-3",
          status?.tone === "good" && "border-good/40 bg-good/10 text-good",
          status?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
        )}
      >
        {status?.text}
      </p>
    </div>
  );
}
