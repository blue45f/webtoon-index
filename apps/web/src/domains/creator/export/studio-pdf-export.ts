/**
 * Studio PDF Export — 전체 페이지를 JPEG로 담아 PDF 한 파일로 내보내는 미니멀 PDF 1.4 라이터.
 *
 * 규격 슬라이스(studio-export-presets)가 "플랫폼 업로드용 이미지 여러 장"이라면, 이 모듈은
 * "작품 전체를 한 파일로" — 백업·공모전 제출·인쇄 공유용이다. 외부 의존성 없이 이미지 전용
 * PDF의 표준 구조(헤더 → Catalog → Pages → 페이지마다 [Page + Content stream + DCTDecode
 * Image XObject] → Info → xref → trailer)를 바이트 배열로 직접 조립한다.
 *
 * - 바이트 단위 조립: 문자열 concat으로 만들면 한글 제목·JPEG 바이너리에서 UTF-8 멀티바이트
 *   길이와 바이트 오프셋이 어긋나 xref가 깨진다. 모든 조각을 Uint8Array로 쌓고 오프셋은
 *   바이트 길이로만 계산한다(구조 문자열은 전부 ASCII, 제목은 hex 인코딩).
 * - 크기 규약: 1px = 0.75pt (CSS 96dpi ↔ PDF 72pt/inch). 690px 웹툰 폭이 화면 CSS px와
 *   같은 물리 크기(517.5pt)로 매핑되고, 페이지 크기는 이미지 크기 그대로(여백 없음).
 * - 결정성: 같은 입력 → 같은 출력 바이트. CreationDate 등 시각 메타데이터를 넣지 않는다.
 *
 * 순수 코어(buildPdfFromJpegPages)는 DOM 없이 동작하고, 캔버스→JPEG 어댑터
 * (canvasToJpegBytes), Blob 렌더러(renderPagesToPdf), 다운로드 경계(exportPagesToPdf)만
 * 브라우저를 만진다(테스트 주입 가능). 사용자 노출 문자열은 한글.
 */

import { JPEG_QUALITY, canvasToBlob, downloadBlob } from "./studio-export";
import { drawWatermarkOnSlice } from "./studio-export-presets";

import type { WatermarkSettings } from "../studio-watermark";

/** px→pt 변환 계수 — CSS 96dpi 픽셀을 PDF 72dpi 포인트로(1px = 0.75pt). */
export const PDF_PX_TO_PT = 0.75;

/** PDF 한 페이지가 될 JPEG 이미지 — 크기는 캔버스 픽셀(px) 기준. */
export interface PdfJpegPage {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

export interface BuildPdfOptions {
  /** 문서 정보(docinfo) 제목 — 비어 있으면 /Title을 생략한다. */
  title?: string;
}

const textEncoder = new TextEncoder();

// %PDF 헤더 다음 줄의 바이너리 마커 주석 — 고비트(≥0x80) 바이트 4개로 "이 파일은
// 바이너리"임을 전송 도구에 알리는 PDF 권장 관례. TextEncoder(UTF-8)를 타면 바이트가
// 불어나 오프셋이 어긋나므로 raw 바이트로 둔다.
const PDF_BINARY_MARKER = Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/** PDF 숫자 표기 — 정수는 그대로, 소수는 둘째 자리까지(0.25pt 단위라 정확) 꼬리 0 제거. */
function formatPdfNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** UTF-16BE(BOM) hex 문자열 — 한글 등 비ASCII 제목을 이스케이프 없이 ASCII로 담는다. */
function pdfHexTextString(value: string): string {
  let hex = "FEFF";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

/**
 * JPEG 페이지들 → PDF 1.4 파일 바이트(순수·결정적).
 *
 * 오브젝트 번호 배치: 1=Catalog, 2=Pages, 페이지 i마다 [3+3i]=Page, [4+3i]=Contents,
 * [5+3i]=Image(DCTDecode), 마지막 [3+3N]=Info. xref /Size = 3+3N+1.
 * 페이지가 없거나 크기가 잘못됐거나 SOI(FFD8)가 아니면(캔버스 toBlob의 PNG 폴백 가드)
 * 한글 메시지로 throw.
 */
export function buildPdfFromJpegPages(pages: PdfJpegPage[], opts?: BuildPdfOptions): Uint8Array {
  if (pages.length === 0) throw new Error("PDF로 내보낼 페이지가 없어요.");
  pages.forEach((page, index) => {
    const widthPx = Math.round(page.width);
    const heightPx = Math.round(page.height);
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new Error(`페이지 ${index + 1}의 크기가 올바르지 않아요.`);
    }
    // canvas.toBlob("image/jpeg")는 브라우저가 JPEG 인코딩을 지원하지 않으면 PNG로 조용히
    // 폴백한다 — PNG를 DCTDecode로 임베드하면 깨진 PDF가 되므로 여기서 잡는다.
    if (page.jpegBytes.length < 4 || page.jpegBytes[0] !== 0xff || page.jpegBytes[1] !== 0xd8) {
      throw new Error(`페이지 ${index + 1}의 이미지가 JPEG 형식이 아니에요. 다시 시도해주세요.`);
    }
  });

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushText = (text: string): void => push(textEncoder.encode(text));

  const pageObjNum = (i: number): number => 3 + i * 3;
  const contentObjNum = (i: number): number => 4 + i * 3;
  const imageObjNum = (i: number): number => 5 + i * 3;
  const infoObjNum = 3 + pages.length * 3;
  const size = infoObjNum + 1;

  const objectOffsets = new Map<number, number>();
  const pushObject = (num: number, body: string): void => {
    objectOffsets.set(num, offset);
    pushText(`${num} 0 obj\n${body}\nendobj\n`);
  };
  const pushStreamObject = (num: number, dict: string, data: Uint8Array): void => {
    objectOffsets.set(num, offset);
    const entries = dict.length > 0 ? `${dict} /Length ${data.length}` : `/Length ${data.length}`;
    pushText(`${num} 0 obj\n<< ${entries} >>\nstream\n`);
    push(data);
    // stream 데이터 뒤 EOL은 /Length에 포함되지 않는다(PDF 스펙).
    pushText("\nendstream\nendobj\n");
  };

  pushText("%PDF-1.4\n");
  push(PDF_BINARY_MARKER);

  pushObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");
  pushObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  pages.forEach((page, i) => {
    const widthPx = Math.round(page.width);
    const heightPx = Math.round(page.height);
    const widthPt = formatPdfNumber(widthPx * PDF_PX_TO_PT);
    const heightPt = formatPdfNumber(heightPx * PDF_PX_TO_PT);
    pushObject(
      pageObjNum(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /XObject << /Im0 ${imageObjNum(i)} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>`
    );
    // 콘텐츠 스트림 — 이미지 XObject(단위 정사각형 좌표계)를 cm 행렬로 페이지 전체에 편다.
    pushStreamObject(contentObjNum(i), "", textEncoder.encode(`q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ`));
    // 캔버스 JPEG는 항상 3채널(YCbCr→RGB)이라 DeviceRGB 고정이 안전하다.
    pushStreamObject(
      imageObjNum(i),
      `/Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      page.jpegBytes
    );
  });

  const title = opts?.title?.trim();
  const titleEntry = title ? `/Title ${pdfHexTextString(title)} ` : "";
  pushObject(infoObjNum, `<< ${titleEntry}/Producer (ToonSpectrum Studio) >>`);

  // xref — 엔트리는 정확히 20바이트(오프셋 10 + 공백 + 세대 5 + 공백 + 타입 + " \n").
  const xrefOffset = offset;
  pushText(`xref\n0 ${size}\n`);
  pushText("0000000000 65535 f \n");
  for (let num = 1; num < size; num++) {
    const objOffset = objectOffsets.get(num);
    if (objOffset === undefined) throw new Error(`PDF 조립에 실패했어요(오브젝트 ${num} 누락). 다시 시도해주세요.`);
    pushText(`${String(objOffset).padStart(10, "0")} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 어댑터 — 캔버스→JPEG 인코드와 다운로드 실행. DOM 접근은 전부 주입 가능.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 캔버스 → JPEG 바이트. convert 주입은 테스트용(기본 studio-export의 canvasToBlob).
 * toBlob이 PNG로 폴백한 경우는 buildPdfFromJpegPages의 SOI 가드가 잡는다.
 */
export async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality: number = JPEG_QUALITY,
  convert: (canvas: HTMLCanvasElement, type: string, quality?: number) => Promise<Blob> = canvasToBlob
): Promise<Uint8Array> {
  const blob = await convert(canvas, "image/jpeg", quality);
  return new Uint8Array(await blob.arrayBuffer());
}

/** PDF 파일명 — `<제목>.pdf`(빈 제목은 기본 파일명). */
export function pdfExportFileName(title: string): string {
  return `${title.trim() || "toonspectrum-webtoon"}.pdf`;
}

/** 파일 크기 한글 안내 표기 — 1MB 미만은 KB(최소 1KB), 이상은 소수 1자리 MB. */
export function formatPdfFileSize(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes < mb) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / mb).toFixed(1)}MB`;
}

export interface PdfExportResult {
  /** PDF에 담긴 페이지 수. */
  pageCount: number;
  /** 최종 PDF 파일 크기(byte). */
  bytes: number;
  /** 저장 파일명. */
  fileName: string;
}

/** 다운로드 전 PDF 산출물 — 게시 패키지·미리보기·업로드 흐름에서 Blob을 직접 재사용한다. */
export interface PdfRenderResult extends PdfExportResult {
  blob: Blob;
}

/** 실행 결과 한 줄 한글 안내. */
export function pdfExportResultMessage(result: PdfExportResult): string {
  return `전체 ${result.pageCount}페이지를 PDF 한 파일(${formatPdfFileSize(result.bytes)})로 저장했어요.`;
}

export interface PdfPagesRenderOptions {
  /** 캡처된 페이지 캔버스(색보정 합성 완료, 페이지 순서). */
  pages: HTMLCanvasElement[];
  /** 작품 제목 — 파일명과 PDF docinfo /Title에 쓴다(비어 있으면 기본 파일명·/Title 생략). */
  title: string;
  /** JPEG 품질(0..1) — 기본 0.92(studio-export JPEG_QUALITY). */
  quality?: number;
  /** 있으면 페이지마다 서명 합성 — 규격 슬라이스 내보내기와 같은 규칙. */
  watermark?: WatermarkSettings;
  onProgress?: (done: number, total: number) => void;
  /**
   * 선택적 페이지별 전처리. 긴 원고의 주석 레일처럼 큰 임시 캔버스를 전 페이지 분량 쌓지 않고
   * 현재 페이지 하나만 합성한 뒤 즉시 JPEG로 인코드할 때 쓴다. sourceIndex는 원본 pages 인덱스다.
   */
  preparePage?: (page: HTMLCanvasElement, sourceIndex: number) => HTMLCanvasElement;
  /** preparePage가 새 캔버스를 반환했을 때의 즉시 해제 훅. 원본 페이지에는 호출하지 않는다. */
  releasePreparedPage?: (page: HTMLCanvasElement, sourceIndex: number) => void;
  /** 테스트 주입용 — 기본은 document.createElement("canvas"). */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /** 테스트 주입용 — 기본은 canvasToJpegBytes. */
  toJpeg?: (canvas: HTMLCanvasElement, quality: number) => Promise<Uint8Array>;
  /**
   * 임시 평탄화 캔버스 해제 주입. createCanvas를 직접 주입하면 소유권도 호출자에게 있으므로
   * 명시한 경우에만 호출하고, 기본 브라우저 팩토리에는 width/height=0 해제를 자동 적용한다.
   */
  releaseCanvas?: (canvas: HTMLCanvasElement) => void;
}

export interface PdfPagesExportOptions extends PdfPagesRenderOptions {
  /** 테스트 주입용 — 기본은 downloadBlob(실제 파일 저장). */
  download?: (blob: Blob, filename: string) => void;
}

/** 기본 페이지 캔버스 팩토리 — 브라우저 전용(호출 시점에만 document 접근). */
function createPageCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 임시 캔버스 backing store를 즉시 반납한다. 원본 페이지 캔버스는 호출자 소유라 건드리지 않는다. */
function releasePageCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * 전체 페이지 → 다운로드하지 않은 PDF Blob. 페이지마다 흰 배경에 눌러 붙이고(JPEG 인코드 시
 * 투명 영역이 검게 뭉개지는 것 방지) 워터마크를 찍은 뒤 JPEG로 인코드, 순수 코어로
 * PDF를 조립한다. 유효한(양수 크기) 페이지가 없거나 캔버스 생성이 막히면 한글 메시지로
 * throw. 이 함수는 URL 생성이나 다운로드를 절대 실행하지 않는다.
 */
export async function renderPagesToPdf(options: PdfPagesRenderOptions): Promise<PdfRenderResult> {
  const valid = options.pages
    .map((page, sourceIndex) => ({ page, sourceIndex }))
    .filter(({ page }) => page.width > 0 && page.height > 0);
  if (valid.length === 0) throw new Error("내보낼 페이지가 없어요.");
  const createCanvas = options.createCanvas ?? createPageCanvas;
  const toJpeg = options.toJpeg ?? canvasToJpegBytes;
  const releaseCanvas = options.releaseCanvas ?? (options.createCanvas ? undefined : releasePageCanvas);
  const quality = options.quality ?? JPEG_QUALITY;
  const jpegPages: PdfJpegPage[] = [];
  for (let index = 0; index < valid.length; index++) {
    const { page: sourcePage, sourceIndex } = valid[index];
    let page = sourcePage;
    let flat: HTMLCanvasElement | null = null;
    try {
      page = options.preparePage?.(sourcePage, sourceIndex) ?? sourcePage;
      if (
        !Number.isFinite(page.width) ||
        !Number.isFinite(page.height) ||
        page.width <= 0 ||
        page.height <= 0
      ) {
        throw new Error(`PDF 페이지 ${sourceIndex + 1}의 준비된 크기가 올바르지 않아요.`);
      }
      flat = createCanvas(page.width, page.height);
      const ctx = flat.getContext("2d");
      if (!ctx) throw new Error("PDF 페이지 캔버스를 만들지 못했어요. 다시 시도해주세요.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, page.width, page.height);
      ctx.drawImage(page, 0, 0);
      if (options.watermark) drawWatermarkOnSlice(flat, options.watermark);
      jpegPages.push({ jpegBytes: await toJpeg(flat, quality), width: page.width, height: page.height });
    } finally {
      if (flat) {
        try {
          releaseCanvas?.(flat);
        } catch {
          // 메모리 정리는 best-effort다. 인코딩 성공/실패 결과를 정리 오류로 덮어쓰지 않는다.
        }
      }
      if (page !== sourcePage) {
        try {
          options.releasePreparedPage?.(page, sourceIndex);
        } catch {
          // 준비 캔버스 해제도 best-effort다. 인코딩 성공/실패 결과를 정리 오류로 덮지 않는다.
        }
      }
    }
    options.onProgress?.(index + 1, valid.length);
  }
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = buildPdfFromJpegPages(jpegPages, { title: options.title });
  } finally {
    // buildPdfFromJpegPages가 PDF 바이트로 복사한 뒤 대용량 JPEG 참조를 즉시 놓는다.
    jpegPages.length = 0;
  }
  const fileName = pdfExportFileName(options.title);
  // TS6 타입드어레이 제네릭: Blob은 ArrayBuffer 기반 뷰만 받으므로 명시 복사로 백킹 버퍼를 고정한다.
  const blobBytes = new Uint8Array(pdfBytes.length);
  blobBytes.set(pdfBytes);
  return {
    blob: new Blob([blobBytes], { type: "application/pdf" }),
    pageCount: valid.length,
    bytes: pdfBytes.length,
    fileName,
  };
}

/**
 * 기존 다운로드 API. 렌더링·워터마크·진행률은 renderPagesToPdf에 단일화하고, 여기서는
 * 완성 Blob을 한 번 다운로드한 뒤 기존의 Blob 없는 결과 계약을 그대로 반환한다.
 */
export async function exportPagesToPdf(options: PdfPagesExportOptions): Promise<PdfExportResult> {
  const rendered = await renderPagesToPdf(options);
  const download = options.download ?? downloadBlob;
  download(rendered.blob, rendered.fileName);
  return {
    pageCount: rendered.pageCount,
    bytes: rendered.bytes,
    fileName: rendered.fileName,
  };
}
