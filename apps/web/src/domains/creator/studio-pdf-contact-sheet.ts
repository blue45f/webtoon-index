/**
 * Studio PDF Contact Sheet — 여러 페이지를 한 인쇄용 시트에 격자로 모아 담는 콘택트시트(스토리보드
 * 검토용) 합성. studio-pdf-export.ts 의 buildPdfFromJpegPages/canvasToJpegBytes 를 그대로
 * 재사용해 PDF 바이트 조립은 다시 만들지 않는다 — 이 모듈이 새로 하는 일은 "여러 페이지 캔버스를
 * 격자로 배치한 시트 캔버스"를 만드는 것뿐이다.
 *
 * 격자 수학(열/행/여백/라벨 줄 높이)은 순수(DOM 무관) — planContactSheetLayout 은
 * "페이지 수"만 받고 실제 이미지를 만지지 않아 숫자만으로 유닛 테스트할 수 있다. 실제 캔버스에
 * 그리는 단계(drawContactSheet)만 이미지 소스를 다루며, 각 칸 안에서는 원본 페이지 비율을
 * 보존한 채(contain) 가운데 정렬한다 — 페이지마다 세로 길이가 달라도(PageState.canvasH 는
 * 페이지별 자유값) 잘리지 않는다. 실행 오케스트레이터(exportContactSheetPdf)는 studio-pdf-export
 * 와 studio-export-presets 의 기존 실행부와 동일한 모양(캡처된 캔버스 배열 → 옵션 → 결과, 테스트
 * 주입 가능한 createCanvas/toJpeg/download)을 따른다.
 */

import { JPEG_QUALITY, downloadBlob } from "./export/studio-export";
import { buildPdfFromJpegPages, canvasToJpegBytes } from "./export/studio-pdf-export";

import type { PdfJpegPage } from "./export/studio-pdf-export";

// ─────────────────────────────────────────────────────────────────────────────
// 칩 선택지 · 기본값 — EXPORT_SCALES/EXPORT_PRESETS 와 동일 관례.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTACT_SHEET_COLUMN_CHOICES = [2, 3, 4, 5] as const;
export const CONTACT_SHEET_ROW_CHOICES = [2, 3, 4, 5, 6] as const;
export const DEFAULT_CONTACT_SHEET_COLUMNS = 3;
export const DEFAULT_CONTACT_SHEET_ROWS = 4;
export const DEFAULT_CONTACT_SHEET_MARGIN = 32; // px, 시트 바깥 여백
export const DEFAULT_CONTACT_SHEET_GAP = 14; // px, 칸 사이 간격
export const DEFAULT_CONTACT_SHEET_LABEL_HEIGHT = 24; // px, showLabels=true 일 때 칸마다 확보하는 라벨 줄 높이

export interface ContactSheetPagePreset {
  id: string;
  label: string;
  /** 96dpi(CSS px) 기준 실제 종이 크기 — buildPdfFromJpegPages 의 PDF_PX_TO_PT=0.75 규약과 동일 dpi. */
  widthPx: number;
  heightPx: number;
}

// A4 210×297mm, Letter 8.5×11in, 둘 다 96dpi(px = mm/25.4*96 반올림)로 환산 — PDF_PX_TO_PT 규약과 동일 dpi 기준.
export const CONTACT_SHEET_PAGE_PRESETS: ContactSheetPagePreset[] = [
  { id: "a4", label: "A4", widthPx: 794, heightPx: 1123 },
  { id: "letter", label: "Letter", widthPx: 816, heightPx: 1056 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 순수 격자 배치 계획 — 페이지 "개수"만으로 계산(이미지 크기/비율 불필요).
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactSheetLayoutOptions {
  sheetWidth: number;
  sheetHeight: number;
  columns: number;
  rows: number;
  showLabels: boolean;
  margin?: number; // 기본 DEFAULT_CONTACT_SHEET_MARGIN
  gap?: number; // 기본 DEFAULT_CONTACT_SHEET_GAP
  labelHeight?: number; // 기본 DEFAULT_CONTACT_SHEET_LABEL_HEIGHT(showLabels 일 때만 확보)
}

export interface ContactSheetCellPlan {
  /** 원본 pages 배열 안의 인덱스 — 페이지 순서 그대로(셔플 없음). */
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 셀 안에서 이미지가 들어갈 영역의 높이(showLabels 면 하단 라벨 줄만큼 뺀 값). */
  imageAreaHeight: number;
  /** 라벨 텍스트 베이스라인 y — showLabels=false 면 의미 없음(0이 아닐 수 있으나 draw 단계에서 쓰지 않음). */
  labelBaselineY: number;
}

export interface ContactSheetPlan {
  columns: number;
  rows: number;
  perSheet: number;
  sheetCount: number;
  sheetWidth: number;
  sheetHeight: number;
  showLabels: boolean;
  /** 시트별 셀 배열(페이지 순서로 채움) — 마지막 시트는 나머지 페이지 수만큼만 채워짐(짧을 수 있음). */
  sheets: ContactSheetCellPlan[][];
}

/**
 * 페이지 "개수"만으로 격자 배치 계획을 세운다(순수 — 이미지 크기/비율 불필요, 각 이미지는
 * drawContactSheet 단계에서 자기 칸 안에 contain-fit 된다). columns/rows 는 정수로 내림(최소 1)
 * 처리한다. 여백·간격이 시트 크기를 넘어 칸 폭/높이가 라벨 줄보다 작아지는 등 배치가 불가능하면
 * null(실행부가 한글 메시지로 throw).
 */
export function planContactSheetLayout(
  pageCount: number,
  options: ContactSheetLayoutOptions
): ContactSheetPlan | null {
  const columns = Math.max(1, Math.floor(options.columns));
  const rows = Math.max(1, Math.floor(options.rows));
  const margin = Math.max(0, options.margin ?? DEFAULT_CONTACT_SHEET_MARGIN);
  const gap = Math.max(0, options.gap ?? DEFAULT_CONTACT_SHEET_GAP);
  const labelHeight = options.showLabels ? Math.max(0, options.labelHeight ?? DEFAULT_CONTACT_SHEET_LABEL_HEIGHT) : 0;
  const { sheetWidth, sheetHeight } = options;

  if (
    pageCount <= 0 ||
    !Number.isFinite(sheetWidth) ||
    !Number.isFinite(sheetHeight) ||
    sheetWidth <= 0 ||
    sheetHeight <= 0
  ) {
    return null;
  }

  const cellW = (sheetWidth - margin * 2 - gap * (columns - 1)) / columns;
  const cellH = (sheetHeight - margin * 2 - gap * (rows - 1)) / rows;
  if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 1 || cellH <= labelHeight + 1) {
    return null;
  }

  const perSheet = columns * rows;
  const sheetCount = Math.ceil(pageCount / perSheet);
  const sheets: ContactSheetCellPlan[][] = Array.from({ length: sheetCount }, () => []);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const sheetIdx = Math.floor(pageIndex / perSheet);
    const posInSheet = pageIndex % perSheet;
    const row = Math.floor(posInSheet / columns);
    const col = posInSheet % columns;
    const x = margin + col * (cellW + gap);
    const y = margin + row * (cellH + gap);
    const imageAreaHeight = cellH - labelHeight;
    const labelBaselineY = y + cellH - labelHeight * 0.3; // 라벨 줄 안, 하단 여백 살짝 남기고 베이스라인
    sheets[sheetIdx].push({ pageIndex, x, y, width: cellW, height: cellH, imageAreaHeight, labelBaselineY });
  }

  return { columns, rows, perSheet, sheetCount, sheetWidth, sheetHeight, showLabels: options.showLabels, sheets };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM 을 만지는 그리기 단계 — 시트 캔버스 하나에 셀들을 그린다.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactSheetPageInput {
  /** 캡처된 페이지 캔버스(capturePagesForPreset("all") 과 동일 소스, 색보정 합성 완료). */
  source: HTMLCanvasElement;
  /** 표시할 페이지 이름 — pageDisplayName(page, index) 로 만든 문자열. 없으면 라벨 생략. */
  label?: string;
}

const LABEL_FONT_PX = 12;
const LABEL_H_PADDING = 6;

/** 소스 크기를 박스 안에 잘리지 않게(contain) 맞춘 크기·오프셋(가운데 정렬). */
function containFit(srcW: number, srcH: number, boxW: number, boxH: number): { width: number; height: number; x: number; y: number } {
  if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) return { width: 0, height: 0, x: 0, y: 0 };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { width, height, x: (boxW - width) / 2, y: (boxH - height) / 2 };
}

/**
 * 라벨 텍스트를 maxWidth 안에 들어오게 말줄임(…) 처리한다. ctx.measureText 기준 이진 탐색으로
 * 들어가는 최대 글자 수를 찾는다(폰트마다 글자 폭이 달라 고정 문자 수 자르기는 부정확하다).
 */
function fitLabelToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (text.length === 0 || ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

/**
 * 시트 캔버스 하나에 cells 를 그린다. 각 칸: 옅은 회색 테두리 → contain-fit(잘리지 않게, 가운데
 * 정렬)한 페이지 썸네일 → (showLabels && label 있음) 셀 폭에 맞춰 말줄임 처리한 라벨 텍스트.
 * 흰 배경(인쇄 토너 절약 + 대비). 2D 컨텍스트를 못 얻으면 조용히 반환(호출부가 canvas 생성을 보장).
 */
export function drawContactSheet(
  canvas: HTMLCanvasElement,
  cells: ContactSheetCellPlan[],
  pages: ContactSheetPageInput[],
  opts: { showLabels: boolean; sheetWidth: number; sheetHeight: number }
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, opts.sheetWidth, opts.sheetHeight);

  for (const cell of cells) {
    const page = pages[cell.pageIndex];

    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 1;
    ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, Math.max(0, cell.width - 1), Math.max(0, cell.height - 1));

    if (page?.source) {
      const fit = containFit(page.source.width, page.source.height, cell.width, cell.imageAreaHeight);
      if (fit.width > 0 && fit.height > 0) {
        ctx.drawImage(page.source, cell.x + fit.x, cell.y + fit.y, fit.width, fit.height);
      }
    }

    if (opts.showLabels && page?.label) {
      ctx.font = `500 ${LABEL_FONT_PX}px "Pretendard", system-ui, sans-serif`;
      ctx.fillStyle = "#4b5563";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const maxWidth = Math.max(0, cell.width - LABEL_H_PADDING * 2);
      const text = fitLabelToWidth(ctx, page.label, maxWidth);
      if (text) ctx.fillText(text, cell.x + cell.width / 2, cell.labelBaselineY);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행 오케스트레이터 — 캡처된 페이지들 → 격자 시트 여러 장(JPEG) → PDF 한 파일 → 다운로드.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactSheetExportOptions {
  /** capturePagesForPreset("all") 의 결과를 그대로 넘긴다 — 별도 캡처 경로 없음. */
  pages: HTMLCanvasElement[];
  /**
   * pages 와 같은 길이/순서의 페이지 이름 — StudioPage 가 pageDisplayName(page, idx) 로 만들어
   * 전달한다. 길이가 안 맞거나 특정 인덱스가 비어 있어도 그 칸만 라벨 없이 그려진다(방어적 인덱싱).
   */
  pageLabels?: string[];
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
  showLabels: boolean;
  margin?: number;
  gap?: number;
  labelHeight?: number;
  /** 파일명에 쓸 작품 제목(비어 있으면 기본 파일명). */
  title: string;
  /** JPEG 품질(0..1) — 기본 studio-export 의 JPEG_QUALITY. */
  quality?: number;
  onProgress?: (doneSheets: number, totalSheets: number) => void;
  /** 테스트 주입용 — 기본 document.createElement("canvas"). */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /** 테스트 주입용 — 기본 canvasToJpegBytes(studio-pdf-export, 재사용). */
  toJpeg?: (canvas: HTMLCanvasElement, quality: number) => Promise<Uint8Array>;
  /** 테스트 주입용 — 기본 downloadBlob(studio-export, 재사용). */
  download?: (blob: Blob, filename: string) => void;
}

export interface ContactSheetExportResult {
  pageCount: number;
  sheetCount: number;
  columns: number;
  rows: number;
  bytes: number;
  fileName: string;
}

/** 기본 시트 캔버스 팩토리 — 브라우저 전용(호출 시점에만 document 접근). */
function createContactSheetCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 콘택트시트 파일명 — `<제목>-contact-sheet.pdf`(빈 제목은 기본 파일명, studio-export 의 "-strip" 접미사 관례와 동일). */
export function contactSheetFileName(title: string): string {
  return `${title.trim() || "toonspectrum-webtoon"}-contact-sheet.pdf`;
}

/** 실행 결과 한 줄 한글 안내. */
export function contactSheetResultMessage(result: ContactSheetExportResult): string {
  return `전체 ${result.pageCount}페이지를 ${result.columns}×${result.rows} 콘택트시트 ${result.sheetCount}장(PDF)으로 저장했어요.`;
}

/**
 * 캡처된 페이지들 → 격자 시트 여러 장(JPEG) → 미니멀 PDF 한 파일(studio-pdf-export.buildPdfFromJpegPages
 * 재사용, 새 PDF 인코더 없음) → 다운로드. 유효 페이지가 없거나 배치가 불가능하면 한글 메시지로 throw.
 */
export async function exportContactSheetPdf(options: ContactSheetExportOptions): Promise<ContactSheetExportResult> {
  // 원본 pages 배열 안의 인덱스를 함께 들고 다닌다 — 중간 페이지가 필터링되면(0 크기 등)
  // valid 배열 안 위치와 원본 위치가 어긋나므로, pageLabels 는 반드시 원본 인덱스로 찾아야 한다.
  const validEntries = options.pages
    .map((source, originalIndex) => ({ source, originalIndex }))
    .filter((entry) => entry.source.width > 0 && entry.source.height > 0);
  if (validEntries.length === 0) throw new Error("콘택트시트로 만들 페이지가 없어요.");
  const valid = validEntries.map((entry) => entry.source);

  const plan = planContactSheetLayout(valid.length, {
    sheetWidth: options.sheetWidth,
    sheetHeight: options.sheetHeight,
    columns: options.columns,
    rows: options.rows,
    showLabels: options.showLabels,
    margin: options.margin,
    gap: options.gap,
    labelHeight: options.labelHeight,
  });
  if (!plan) throw new Error("열/행 수가 용지 크기에 비해 너무 많아요. 열이나 행을 줄여주세요.");

  const createCanvas = options.createCanvas ?? createContactSheetCanvas;
  const toJpeg = options.toJpeg ?? canvasToJpegBytes;
  const download = options.download ?? downloadBlob;
  const quality = options.quality ?? JPEG_QUALITY;

  const pageInputs: ContactSheetPageInput[] = validEntries.map((entry) => ({
    source: entry.source,
    label: options.pageLabels?.[entry.originalIndex],
  }));

  const sheetPages: PdfJpegPage[] = [];
  for (let sheetIdx = 0; sheetIdx < plan.sheets.length; sheetIdx++) {
    const canvas = createCanvas(plan.sheetWidth, plan.sheetHeight);
    drawContactSheet(canvas, plan.sheets[sheetIdx], pageInputs, {
      showLabels: plan.showLabels,
      sheetWidth: plan.sheetWidth,
      sheetHeight: plan.sheetHeight,
    });
    const jpegBytes = await toJpeg(canvas, quality);
    sheetPages.push({ jpegBytes, width: plan.sheetWidth, height: plan.sheetHeight });
    options.onProgress?.(sheetIdx + 1, plan.sheetCount);
  }

  const pdfBytes = buildPdfFromJpegPages(sheetPages, { title: options.title });
  const fileName = contactSheetFileName(options.title);
  // TS6 타입드어레이 제네릭: Blob은 ArrayBuffer 기반 뷰만 받으므로 명시 복사로 백킹 버퍼를 고정한다(studio-pdf-export.exportPagesToPdf 와 동일 관례).
  const blobBytes = new Uint8Array(pdfBytes.length);
  blobBytes.set(pdfBytes);
  download(new Blob([blobBytes], { type: "application/pdf" }), fileName);

  return {
    pageCount: valid.length,
    sheetCount: plan.sheetCount,
    columns: plan.columns,
    rows: plan.rows,
    bytes: pdfBytes.length,
    fileName,
  };
}
