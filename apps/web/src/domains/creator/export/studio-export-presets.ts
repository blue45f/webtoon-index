/**
 * Studio Export Presets — 플랫폼별 내보내기 규격 프리셋 · 검증 · 스트립 슬라이스 계획·실행.
 *
 * 기존 내보내기는 배율(1/2/3)·포맷(png/jpg/webp)·투명배경만 있고, "네이버 도전만화는
 * 폭 690·JPG만·5MB" 같은 연재 규격을 알려주거나 검증하지 못했다. 이 모듈이 그 공백을
 * 메운다 — 대표 플랫폼 규격 데이터 + 현재 출력이 규격에 맞는지 한글 경고 + 긴 세로
 * 스트립을 규격 높이로 자르는 슬라이스 계획 + 그 계획을 실제 파일 저장으로 옮기는 실행부.
 *
 * 계획·검증(플랜·좌표·파일명·안내문)은 전부 순수·결정적(랜덤·부작용 없음)이라 node
 * 단위 테스트가 가능하다. 브라우저 캔버스·다운로드를 만지는 건 exportPresetSlices 실행부
 * 하나뿐이며, 저장 경로(canvasToBlob/downloadBlob)는 studio-export를 재사용한다.
 * 사용자 노출 문자열은 한글.
 */

import {
  applyAntiAiNoisePattern,
  generateWatermarkTilePositions,
  shouldDrawWatermark,
  watermarkPlacement,
  type WatermarkSettings,
} from "../studio-watermark";

import {
  planStudioEpisodeByteBudget,
  planStudioEpisodeFileByteCap,
  studioEpisodeByteBudgetMessage,
} from "./studio-episode-byte-budget";
import { MAX_CANVAS_DIM, canvasToBlob, downloadBlob, exportMimeType, exportQuality } from "./studio-export";
import {
  negotiateStudioExportQuality,
  studioQualityNegotiationMessage,
} from "./studio-export-quality-negotiation";
import {
  downscaleForExport,
  loadVipsForExport,
  planVipsExportRoute,
  type StudioVipsExportLimits,
  type StudioVipsExportRuntime,
  type StudioVipsRaster,
} from "./studio-vips-export";

export {
  planStudioEpisodeByteBudget,
  planStudioEpisodeFileByteCap,
  studioEpisodeByteBudgetMessage,
  negotiateStudioExportQuality,
  studioQualityNegotiationMessage,
};

export type ExportFormat = "png" | "jpg" | "webp";

export interface ExportPreset {
  id: string;
  label: string;
  platform: string;
  /** 권장 출력 폭(px). 0이면 "원본 유지"(폭 변환 없음). */
  width: number;
  allowedFormats: ExportFormat[];
  recommendedFormat: ExportFormat;
  /** 이미지 1장 최대 높이(px). 초과 시 분할 권장. */
  maxImageHeight?: number;
  /** 이미지 1장 최대 용량(byte). */
  maxFileBytes?: number;
  /**
   * 회차 전체 합계 최대 용량(byte).
   *
   * 도전만화의 실제 반려 사유 1위가 이 값인데, 지금까지는 `note` 문장 안에만 있어서
   * 어떤 코드도 쓰지 않았다 — 4.9MB 12장을 저장하면 장별 경고 없이 58MB 회차가 만들어졌다.
   * 이 값이 있으면 저장 단계에서 장별 실효 상한을 역산해(studio-episode-byte-budget)
   * 품질 협상 목표로 쓰고, 저장 후 합계도 정산한다.
   */
  maxEpisodeBytes?: number;
  note: string;
}

const MB = 1024 * 1024;

/**
 * 대표 웹툰/SNS 플랫폼 내보내기 규격. 좁은 폭 → 넓은 폭, 마지막은 "원본 유지".
 * 폭/포맷/높이/용량 기준은 각 플랫폼 업로드·공모전 가이드에서 가져온 일반 기준값이다.
 */
export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "naver-challenge",
    label: "네이버 도전만화",
    platform: "네이버 웹툰",
    width: 690,
    allowedFormats: ["jpg"],
    recommendedFormat: "jpg",
    maxImageHeight: 1280,
    maxFileBytes: 5 * MB,
    maxEpisodeBytes: 50 * MB,
    note: "폭 690px · JPG만 지원(PNG 불가) · 이미지당 5MB · 회차 합계 약 50MB.",
  },
  {
    id: "webtoon-canvas",
    label: "웹툰 캔버스",
    platform: "WEBTOON Canvas",
    width: 800,
    allowedFormats: ["jpg", "png"],
    recommendedFormat: "jpg",
    maxImageHeight: 1280,
    note: "폭 800px 권장 · 세로 1280px 단위로 잘라 업로드.",
  },
  {
    id: "lezhin",
    label: "레진코믹스",
    platform: "레진",
    width: 1440,
    allowedFormats: ["jpg"],
    recommendedFormat: "jpg",
    note: "폭 1440px · JPG · 300dpi 고해상 권장(공모전 기준).",
  },
  {
    id: "kakaopage",
    label: "카카오페이지",
    platform: "카카오",
    width: 720,
    allowedFormats: ["jpg", "png"],
    recommendedFormat: "jpg",
    maxImageHeight: 4200,
    note: "폭 720px · 이미지 1장 세로 4200px 이내.",
  },
  {
    id: "instagram-square",
    label: "인스타그램 정방형",
    platform: "Instagram",
    width: 1080,
    allowedFormats: ["jpg", "png"],
    recommendedFormat: "jpg",
    maxImageHeight: 1080,
    note: "1080×1080 정방형 피드.",
  },
  {
    id: "instagram-portrait",
    label: "인스타그램 세로",
    platform: "Instagram",
    width: 1080,
    allowedFormats: ["jpg", "png"],
    recommendedFormat: "jpg",
    maxImageHeight: 1350,
    note: "1080×1350 세로 피드(4:5).",
  },
  {
    id: "original",
    label: "원본 고해상도",
    platform: "범용",
    width: 0,
    allowedFormats: ["png", "jpg", "webp"],
    recommendedFormat: "png",
    note: "폭 변환 없이 현재 배율 그대로 — 백업·재편집용.",
  },
];

/** id로 프리셋 조회(없으면 undefined). */
export function findExportPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => p.id === id);
}

export interface StripSlice {
  index: number;
  y: number;
  height: number;
}

/**
 * 전체 세로 길이를 sliceHeight 단위로 자른 슬라이스 목록. 마지막 칸은 남은 높이.
 * sliceHeight<=0 또는 totalHeight<=0 이면 [].
 */
export function planStripSlices(totalHeight: number, sliceHeight: number): StripSlice[] {
  if (sliceHeight <= 0 || totalHeight <= 0) return [];
  const slices: StripSlice[] = [];
  let y = 0;
  let index = 0;
  while (y < totalHeight) {
    const height = Math.min(sliceHeight, totalHeight - y);
    slices.push({ index, y, height });
    y += sliceHeight;
    index += 1;
  }
  return slices;
}

/**
 * 캔버스 폭을 프리셋 권장 폭에 맞추는 출력 배율.
 * - preset.width<=0(원본 유지) 또는 canvasWidth<=0 이면 1.
 * - 그 외 preset.width/canvasWidth 를 0.25~4로 클램프, 소수 셋째 자리 반올림.
 *   690/720 같은 플랫폼 폭은 둘째 자리 반올림 시 691px가 되므로 실제 출력 폭 기준을 우선한다.
 */
export function recommendScale(canvasWidth: number, preset: ExportPreset): number {
  if (preset.width <= 0 || canvasWidth <= 0) return 1;
  const raw = preset.width / canvasWidth;
  const clamped = Math.min(4, Math.max(0.25, raw));
  return Math.round(clamped * 1000) / 1000;
}

export type ExportWarningCode = "format" | "height" | "filesize" | "width";
export interface ExportWarning {
  code: ExportWarningCode;
  message: string;
}
export interface ExportValidation {
  ok: boolean;
  warnings: ExportWarning[];
}

/**
 * 현재 출력 사양(폭·높이·포맷·용량)이 프리셋 규격에 맞는지 검사. 경고는 한글 메시지.
 * 경고가 하나도 없으면 ok:true.
 */
export function validateExport(
  input: { width: number; height: number; format: ExportFormat; bytes?: number },
  preset: ExportPreset
): ExportValidation {
  const warnings: ExportWarning[] = [];
  if (!preset.allowedFormats.includes(input.format)) {
    warnings.push({
      code: "format",
      message: `${preset.label}은(는) ${input.format.toUpperCase()} 형식을 지원하지 않아요. 권장: ${preset.recommendedFormat.toUpperCase()}.`,
    });
  }
  if (preset.maxImageHeight !== undefined && input.height > preset.maxImageHeight) {
    warnings.push({
      code: "height",
      message: `이미지 높이가 ${preset.maxImageHeight.toLocaleString()}px를 넘어요. 여러 장으로 나눠 내보내는 걸 권장해요.`,
    });
  }
  if (
    preset.maxFileBytes !== undefined &&
    input.bytes !== undefined &&
    input.bytes > preset.maxFileBytes
  ) {
    warnings.push({
      code: "filesize",
      message: `용량이 ${Math.round(preset.maxFileBytes / MB)}MB를 넘어요. 품질을 낮추거나 분할하세요.`,
    });
  }
  if (preset.width > 0 && input.width !== preset.width) {
    warnings.push({
      code: "width",
      message: `출력 폭 ${input.width.toLocaleString()}px가 권장 폭 ${preset.width.toLocaleString()}px와 달라요.`,
    });
  }
  return { ok: warnings.length === 0, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// 규격 슬라이스 내보내기 실행 — 위 규격 데이터를 "안내"에서 "실행"으로 옮긴다.
// 페이지 캡처(색보정 합성)는 StudioPage의 기존 내보내기 경로가 담당하고, 여기서는
// 캡처된 캔버스들을 규격 폭으로 리샘플해 이어 붙인 "가상 스트립"을 규격 높이 단위로
// 잘라 여러 장으로 순차 저장한다(zip·추가 의존성 없음). 전체 스트립을 한 장의 중간
// 캔버스로 합치지 않고 페이지→슬라이스로 직접 그려 브라우저 캔버스 한계를 피한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 규격 내보내기 범위 — 현재 페이지 1장 또는 전체 페이지 세로 연결. */
export type PresetExportScope = "current" | "all";

/** 가상 스트립(규격 폭 기준) 안에서 페이지 하나가 차지하는 세로 구간. */
export interface PresetPageLayout {
  /** 스트립 안 시작 y(타깃 px). */
  y: number;
  /** 규격 폭으로 리샘플된 페이지 높이(px). */
  height: number;
  /** 캡처 원본 폭(px) — drawImage 소스 좌표 환산용. */
  sourceWidth: number;
  /** 캡처 원본 높이(px). */
  sourceHeight: number;
}

export interface PresetSlicePlan {
  /** 최종 출력 폭(px) — 프리셋 권장 폭, 원본 유지(0)면 첫 페이지 캡처 폭. */
  targetWidth: number;
  /** 리샘플 후 전체 스트립 높이(px). */
  totalHeight: number;
  /** 슬라이스 1장 기준 높이(px) — 프리셋 최대 높이, 없으면 브라우저 캔버스 한계. */
  sliceHeight: number;
  /** 프리셋 허용 포맷으로 강제된 최종 포맷. */
  format: ExportFormat;
  slices: StripSlice[];
  pages: PresetPageLayout[];
}

/** 프리셋이 허용하지 않는 포맷이면 권장 포맷으로 바꾼다(네이버=JPG 전용 등). */
export function resolvePresetFormat(preset: ExportPreset, format: ExportFormat): ExportFormat {
  return preset.allowedFormats.includes(format) ? format : preset.recommendedFormat;
}

/**
 * 캡처된 페이지 크기 목록 → 규격 슬라이스 실행 계획(순수).
 * - 페이지마다 규격 폭 리샘플 후 높이를 구해 간격 0으로 이어 붙인다(연재 업로드는
 *   슬라이스가 뷰어에서 다시 이어 보이므로 페이지 사이 여백을 넣지 않는다).
 * - 프리셋에 최대 높이가 없어도 브라우저 캔버스 한계(maxCanvasDim)로는 자른다 —
 *   한계를 넘는 캔버스는 조용히 빈 이미지가 되기 때문(studio-export의 MAX_CANVAS_DIM).
 * - 유효한(양수 크기) 페이지가 하나도 없으면 null.
 */
export function planPresetSliceExport(
  pageSizes: { width: number; height: number }[],
  preset: ExportPreset,
  format: ExportFormat,
  maxCanvasDim = MAX_CANVAS_DIM
): PresetSlicePlan | null {
  const valid = pageSizes.filter((size) => size.width > 0 && size.height > 0);
  if (valid.length === 0 || maxCanvasDim <= 0) return null;
  const targetWidth = preset.width > 0 ? preset.width : Math.max(1, Math.round(valid[0].width));
  const pages: PresetPageLayout[] = [];
  let y = 0;
  for (const size of valid) {
    const height = Math.max(1, Math.round((size.height * targetWidth) / size.width));
    pages.push({ y, height, sourceWidth: size.width, sourceHeight: size.height });
    y += height;
  }
  const sliceHeight = Math.min(preset.maxImageHeight ?? maxCanvasDim, maxCanvasDim);
  return {
    targetWidth,
    totalHeight: y,
    sliceHeight,
    format: resolvePresetFormat(preset, format),
    slices: planStripSlices(y, sliceHeight),
    pages,
  };
}

/** 슬라이스 캔버스에 그릴 페이지 조각 — 원본(src)·슬라이스(dest) 좌표 쌍. */
export interface SliceDrawOp {
  pageIndex: number;
  /** 원본 페이지 캔버스 안 시작 y(px). */
  srcY: number;
  /** 원본에서 가져올 높이(px). */
  srcHeight: number;
  /** 슬라이스 캔버스 안 시작 y(px). */
  destY: number;
  /** 슬라이스에 그릴 높이(px). */
  destHeight: number;
}

/**
 * 슬라이스 하나와 겹치는 페이지 구간들을 그리기 좌표로 변환(순수).
 * 원본 좌표는 리샘플 비율(sourceHeight/height)로 환산하며 소수를 허용한다
 * (drawImage가 서브픽셀 보간). 겹치지 않는 페이지는 결과에서 빠진다.
 */
export function planSliceDrawOps(slice: StripSlice, pages: PresetPageLayout[]): SliceDrawOp[] {
  const ops: SliceDrawOp[] = [];
  const sliceTop = slice.y;
  const sliceBottom = slice.y + slice.height;
  pages.forEach((page, pageIndex) => {
    const top = Math.max(sliceTop, page.y);
    const bottom = Math.min(sliceBottom, page.y + page.height);
    if (bottom <= top) return;
    const ratio = page.sourceHeight / page.height;
    ops.push({
      pageIndex,
      srcY: (top - page.y) * ratio,
      srcHeight: (bottom - top) * ratio,
      destY: top - sliceTop,
      destHeight: bottom - top,
    });
  });
  return ops;
}

/** 규격 슬라이스 파일명 — `<제목>-<프리셋id>.<확장자>`, 여러 장이면 `-1of3` 접미사. */
export function presetSliceFileName(
  title: string,
  presetId: string,
  format: ExportFormat,
  part: { index: number; total: number }
): string {
  const suffix = part.total > 1 ? `-${part.index + 1}of${part.total}` : "";
  return `${title.trim() || "toonspectrum-webtoon"}-${presetId}${suffix}.${format}`;
}

export interface PresetExportResult {
  /** 저장한 파일 수. */
  files: number;
  /** 프리셋 용량 제한을 넘은 파일 수(저장은 됨 — 업로드 전 확인 필요). */
  oversized: number;
  /** 실제 저장에 쓴 포맷(프리셋 허용 포맷으로 강제된 값). */
  format: ExportFormat;
  /** 실제 저장 폭(px). */
  targetWidth: number;
  /**
   * wasm-vips 고품질 축소 레인으로 처리된 대형 페이지 수.
   * 라우팅된 페이지가 없으면 키 자체가 없다(기존 결과 shape 불변 — pristine 계약).
  */
  vipsRoutedPages?: number;
}

/** 실행 결과를 한 줄 한글 안내로 — 용량 초과·vips 레인 정보를 덧붙인다. */
export function presetExportResultMessage(result: PresetExportResult, preset: ExportPreset): string {
  const parts = [
    `폭 ${result.targetWidth.toLocaleString()}px ${result.format.toUpperCase()} ${result.files}장으로 저장했어요.`,
  ];
  if (result.oversized > 0 && preset.maxFileBytes !== undefined) {
    parts.push(
      `${result.oversized}장은 ${Math.round(preset.maxFileBytes / MB)}MB 제한을 넘어요 — 업로드 전에 용량을 줄여주세요.`
    );
  }
  if (result.vipsRoutedPages !== undefined && result.vipsRoutedPages > 0) {
    parts.push(`고해상 페이지 ${result.vipsRoutedPages}장은 고품질 축소(wasm-vips)로 저장했어요.`);
  }
  return parts.join(" ");
}

export interface PresetSliceExportOptions {
  /** 캡처된 페이지 캔버스(색보정 합성 완료, 페이지 순서). */
  pages: HTMLCanvasElement[];
  preset: ExportPreset;
  /** 사용자가 고른 포맷 — 프리셋이 허용하지 않으면 권장 포맷으로 강제된다. */
  format: ExportFormat;
  /** 파일명에 쓸 작품 제목(비어 있으면 기본 파일명). */
  title: string;
  /** 있으면 슬라이스마다 서명 — 파일 단위 귀속이 유지되고 절단면에서 잘리지 않는다. */
  watermark?: WatermarkSettings;
  onProgress?: (done: number, total: number) => void;
  /**
   * 다운로드 사이 **최소 간격**(ms) — 연속 다운로드 차단 회피. 기본 250, 테스트에선 0.
   * 다운로드 뒤에 무조건 쉬는 시간이 아니라, 다음 슬라이스의 합성·인코딩 시간이
   * 함께 차감되는 간격이다(§exportPresetSlices 주석).
   */
  delayMs?: number;
  /** 테스트 주입용 — 기본은 performance.now()(없으면 Date.now()). 단조 시계만 쓴다. */
  now?: () => number;
  /** 테스트 주입용 — 기본은 setTimeout 기반 대기. */
  sleep?: (ms: number) => Promise<void>;
  /** 테스트 주입용 — 기본은 document.createElement("canvas"). */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /** 테스트 주입용 — 기본은 downloadBlob(실제 파일 저장). */
  download?: (blob: Blob, filename: string) => void;
  /** 테스트 주입용 — 기본은 loadVipsForExport(wasm-vips 공유 캐시, dynamic import 유지). */
  loadVipsRuntime?: () => Promise<StudioVipsExportRuntime>;
  /** 테스트 주입용 — 기본은 getImageData 픽셀 읽기(null이면 선택된 vips 작업 실패). */
  readPageRgba?: (page: HTMLCanvasElement) => Uint8Array | null;
  /** 테스트 주입용 — 기본은 putImageData 로 리샘플 결과를 새 캔버스에 옮긴다. */
  createResampledPage?: (raster: StudioVipsRaster) => HTMLCanvasElement | null;
  /** 테스트 주입용 — 기본은 studio-vips-export 기본 예산(8192 edge / 8192² area / 16384² input). */
  vipsLimits?: StudioVipsExportLimits;
}

// ─────────────────────────────────────────────────────────────────────────────
// wasm-vips 대형 페이지 다운스케일 레인 — V12 게이트 매트릭스 Large image 행 실배선.
// 근거(tests/benchmarks/results/quality-lab.json 2026-08-07): downscale 에서
// wasm-vips lanczos3 가 PSNR 27.26dB/SSIM 0.9887 로 브라우저 drawImage 상당의
// canvaskit-linear(25.31dB/0.9834)를 이긴다. 단일 인코어 표면 예산(8192 edge /
// 8192² area — studio-vips-export planVipsExportRoute)을 넘는 페이지만 라우팅하고,
// 예산 안 페이지는 작업 시작 전에 Canvas2D 경로를 선택해 바이트 그대로 유지한다
// (pristine 계약). vips/out-of-core가 선택된 뒤에는 다른 provider로 재실행하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

export type PresetVipsUnavailableStage =
  | "out-of-core"
  | "load"
  | "read"
  | "resample"
  | "materialize";

/**
 * 선택된 대용량 내보내기 provider가 작업을 완료하지 못했다.
 * 다른 provider로 같은 내보내기를 다시 실행하지 않도록 단계와 페이지를 보존한다.
 */
export class PresetVipsUnavailableError extends Error {
  readonly stage: PresetVipsUnavailableStage;
  readonly pageIndex: number | null;
  override readonly cause?: unknown;

  constructor(input: {
    stage: PresetVipsUnavailableStage;
    message: string;
    pageIndex?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "PresetVipsUnavailableError";
    this.stage = input.stage;
    this.pageIndex = input.pageIndex ?? null;
    this.cause = input.cause;
  }
}

/** vips 레인 준비 결과 — 슬라이스 합성 루프가 그대로 소비한다. */
export interface PresetVipsPreparedPages {
  /** 슬라이스 drawImage 가 쓸 페이지 캔버스 — 라우팅 안 된 페이지는 원본 참조 그대로. */
  drawPages: HTMLCanvasElement[];
  /** 라우팅된 페이지는 source 크기가 리샘플 결과로 갱신된 레이아웃(1:1 blit). */
  layouts: PresetPageLayout[];
  /** wasm-vips 로 실제 리샘플된 페이지 수. */
  vipsRoutedPages: number;
}

/** getImageData 기반 기본 픽셀 읽기 — 컨텍스트가 없으면 선택된 vips 작업이 실패한다. */
function defaultReadPresetPageRgba(page: HTMLCanvasElement): Uint8Array | null {
  const ctx = page.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, page.width, page.height);
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

/** putImageData 기반 기본 결과 캔버스 — DOM 이 없으면 선택된 vips 작업이 실패한다. */
function defaultCreateResampledPresetPage(raster: StudioVipsRaster): HTMLCanvasElement | null {
  if (typeof document === "undefined" || typeof ImageData === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // 새 ArrayBuffer 로 복사 — ImageData 는 SharedArrayBuffer 뷰를 받지 않는다.
  const pixels = new Uint8ClampedArray(raster.rgba);
  ctx.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  return canvas;
}

/**
 * 인코어 표면 예산(8192 edge/면적)을 넘는 페이지만 wasm-vips lanczos3 로 규격 폭까지
 * 미리 축소한다. 리샘플된 페이지의 레이아웃은 1:1 blit 이 되도록 source 크기를 결과
 * 크기로 바꿔치기하므로 슬라이스 합성의 drawImage 는 더 이상 화질을 결정하지 않는다.
 * 라우팅 대상이 하나도 없으면 wasm 로드조차 하지 않고 원본 배열 사본을 돌려준다
 * (작업 전 Canvas2D 선택, 기존 경로 바이트 불변). vips 또는 out-of-core가 선택된 뒤
 * provider가 준비/실행되지 않으면 다운로드 전에 명시적으로 실패한다.
 */
export async function prepareVipsRoutedPresetPages(
  pages: HTMLCanvasElement[],
  plan: PresetSlicePlan,
  options: Pick<
    PresetSliceExportOptions,
    "loadVipsRuntime" | "readPageRgba" | "createResampledPage" | "vipsLimits"
  > = {}
): Promise<PresetVipsPreparedPages> {
  // 슬라이스 합성 루프와 같은 인덱스 규약: layouts[k] ↔ pages[k].
  const drawPages = pages.slice();
  const layouts = plan.pages.slice();

  // 라우팅 판정만 먼저 — 대상이 없으면 wasm 로드 자체가 일어나지 않는다(pristine).
  const routedIndices: number[] = [];
  layouts.forEach((layout, index) => {
    const route = planVipsExportRoute(layout.sourceWidth, layout.sourceHeight, options.vipsLimits).route;
    if (route === "out-of-core") {
      throw new PresetVipsUnavailableError({
        stage: "out-of-core",
        pageIndex: index,
        message: `페이지 ${index + 1}은 단일 vips 처리 한계를 넘어 타일 내보내기 provider가 필요해요.`,
      });
    }
    // vips 는 다운스케일 전용 레인 — 규격 폭이 원본 폭 이상이면 기존 경로 유지.
    if (route === "vips" && plan.targetWidth < layout.sourceWidth) routedIndices.push(index);
  });
  const finish = (routed: number): PresetVipsPreparedPages => ({
    drawPages,
    layouts,
    vipsRoutedPages: routed,
  });
  if (routedIndices.length === 0) return finish(0);

  let runtime: StudioVipsExportRuntime;
  try {
    runtime = await (options.loadVipsRuntime ?? loadVipsForExport)();
  } catch (cause) {
    throw new PresetVipsUnavailableError({
      stage: "load",
      message: "선택된 고품질 축소 엔진(wasm-vips)을 불러오지 못해 내보내기를 중단했어요.",
      cause,
    });
  }

  const readPageRgba = options.readPageRgba ?? defaultReadPresetPageRgba;
  const createResampledPage = options.createResampledPage ?? defaultCreateResampledPresetPage;
  let routed = 0;
  for (const index of routedIndices) {
    const layout = layouts[index];
    const page = drawPages[index];
    if (!layout || !page) continue;
    const rgba = readPageRgba(page);
    if (!rgba) {
      throw new PresetVipsUnavailableError({
        stage: "read",
        pageIndex: index,
        message: `페이지 ${index + 1}의 픽셀을 vips 입력으로 읽지 못해 내보내기를 중단했어요.`,
      });
    }
    let raster: StudioVipsRaster;
    try {
      // 목표 높이는 슬라이스 계획과 동일한 반올림(layout.height) — 크기 드리프트 없음.
      raster = await downscaleForExport(
        rgba,
        layout.sourceWidth,
        layout.sourceHeight,
        plan.targetWidth,
        layout.height,
        { runtime }
      );
    } catch (cause) {
      throw new PresetVipsUnavailableError({
        stage: "resample",
        pageIndex: index,
        message: `페이지 ${index + 1}을 wasm-vips로 축소하지 못해 내보내기를 중단했어요.`,
        cause,
      });
    }
    const resampled = createResampledPage(raster);
    if (!resampled) {
      throw new PresetVipsUnavailableError({
        stage: "materialize",
        pageIndex: index,
        message: `페이지 ${index + 1}의 vips 결과를 합성 표면으로 만들지 못해 내보내기를 중단했어요.`,
      });
    }
    drawPages[index] = resampled;
    // source 크기 = 결과 크기 → planSliceDrawOps 비율 1(무손실 1:1 blit).
    layouts[index] = { ...layout, sourceWidth: raster.width, sourceHeight: raster.height };
    routed += 1;
  }
  return finish(routed);
}

/** 기본 슬라이스 캔버스 팩토리 — 브라우저 전용(호출 시점에만 document 접근). */
function createSliceCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * StudioPage 내보내기 경로와 같은 규칙의 워터마크 합성(어두운 외곽선 + 흰 채움).
 * PDF 내보내기(studio-pdf-export)도 페이지 단위 서명에 이 함수를 재사용한다.
 */
export function drawWatermarkOnSlice(canvas: HTMLCanvasElement, settings: WatermarkSettings): void {
  if (!shouldDrawWatermark(settings)) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1. Anti-AI Protection Noise Pattern (CSP 3.1/4.0)
  if (settings.antiAiNoiseEnabled) {
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyAntiAiNoisePattern(
        imgData.data,
        canvas.width,
        canvas.height,
        settings.antiAiNoiseIntensity ?? 35,
      );
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Ignore if canvas is tainted by external resources
    }
  }

  // 2. Text Watermark (Single or Repeat Tiling)
  const text = settings.text.trim();
  if (text.length === 0) return;

  const placement = watermarkPlacement(canvas.width, canvas.height, settings);
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, settings.opacity));
  if (settings.blendMode && settings.blendMode !== "normal") {
    ctx.globalCompositeOperation = settings.blendMode;
  }
  ctx.font = `700 ${placement.fontPx}px "Pretendard", system-ui, sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, placement.fontPx * 0.09);

  if (settings.repeatTile) {
    // Tiled watermark across entire page
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tiles = generateWatermarkTilePositions(
      canvas.width,
      canvas.height,
      settings.tileSpacing ?? 180,
    );
    for (const tile of tiles) {
      ctx.save();
      ctx.translate(tile.x, tile.y);
      ctx.rotate((-25 * Math.PI) / 180);
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  } else {
    // Single placement
    ctx.textAlign = placement.textAlign;
    ctx.textBaseline = placement.textBaseline;
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(text, placement.x, placement.y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, placement.x, placement.y);
  }
  ctx.restore();
}

/**
 * 다운로드 사이 최소 간격(ms).
 *
 * 왜 0 이 아닌가 — 브라우저에는 "저장이 끝났다"는 신호가 페이지 쪽에 없다.
 * a[download] + object URL 조합은 이벤트를 돌려주지 않고, downloadBlob 은 click 직후
 * revokeObjectURL 까지 한다. 그래서 완료 신호를 기다리는 코드로 바꿀 수가 없고,
 * 짧은 간격 안에 click 을 연달아 때리면 WebKit 계열에서 뒤 파일이 조용히 사라진다.
 * 남길 수 있는 건 "간격 보장"뿐이므로 값은 유지하되, 아래 루프가 이 간격을
 * **마감시각**으로 다뤄 다음 슬라이스의 합성·인코딩 시간이 간격에 함께 계산되게 했다.
 * 인코딩이 이 값보다 오래 걸리는 큰 페이지에서는 추가 정지가 0 이 된다.
 */
const DEFAULT_SLICE_DOWNLOAD_INTERVAL_MS = 250;

function defaultMonotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 규격 슬라이스 내보내기 실행 — 캡처된 페이지들을 규격 폭으로 리샘플해 이어 붙인 뒤
 * 규격 높이 단위 이미지 여러 장으로 순차 다운로드한다. 플랫폼 업로드용이라 배경은
 * 흰색 불투명(네이버 등 JPG 전용 + 뷰어 배경 일치). 저장한 파일 수·용량 초과 수를
 * 담은 결과를 돌려주며, 페이지가 없거나 캔버스 생성이 막히면 한글 메시지로 throw.
 */
export async function exportPresetSlices(options: PresetSliceExportOptions): Promise<PresetExportResult> {
  const { pages, preset, title, watermark, onProgress } = options;
  const plan = planPresetSliceExport(
    pages.map((canvas) => ({ width: canvas.width, height: canvas.height })),
    preset,
    options.format
  );
  if (!plan || plan.slices.length === 0) throw new Error("내보낼 페이지가 없어요.");
  // 인코어 표면 예산(8192 edge/면적)을 넘는 페이지만 wasm-vips lanczos3 로 선축소 —
  // 예산 안 문서는 아무 것도 바뀌지 않고(원본 참조·원본 레이아웃) 기존 바이트 그대로다.
  const prepared = await prepareVipsRoutedPresetPages(pages, plan, options);
  const createCanvas = options.createCanvas ?? createSliceCanvas;
  const download = options.download ?? downloadBlob;
  const delayMs = options.delayMs ?? DEFAULT_SLICE_DOWNLOAD_INTERVAL_MS;
  const now = options.now ?? defaultMonotonicNow;
  const sleep = options.sleep ?? defaultSleep;
  const mime = exportMimeType(plan.format);
  const quality = exportQuality(plan.format);
  let oversized = 0;
  // 다음 다운로드를 시작해도 되는 가장 이른 시각. 다운로드 뒤에 고정으로 쉬는 대신
  // 마감시각을 잡아 두면, 다음 슬라이스의 합성·인코딩에 흘러간 시간이 그대로 간격에
  // 차감된다 — 다운로드 사이 최소 간격(delayMs)은 그대로 지켜지고 누적 정지만 사라진다.
  let nextDownloadAt = Number.NEGATIVE_INFINITY;
  for (const slice of plan.slices) {
    const canvas = createCanvas(plan.targetWidth, slice.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("슬라이스 캔버스를 만들지 못했어요. 다시 시도해주세요.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.targetWidth, slice.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const op of planSliceDrawOps(slice, prepared.layouts)) {
      const page = prepared.drawPages[op.pageIndex];
      ctx.drawImage(page, 0, op.srcY, page.width, op.srcHeight, 0, op.destY, plan.targetWidth, op.destHeight);
    }
    if (watermark) drawWatermarkOnSlice(canvas, watermark);
    const blob = await canvasToBlob(canvas, mime, quality);
    if (preset.maxFileBytes !== undefined && blob.size > preset.maxFileBytes) oversized += 1;
    // 아직 간격이 안 찼을 때만, 모자란 만큼만 쉰다(첫 장은 항상 즉시 저장).
    const waitMs = nextDownloadAt - now();
    if (waitMs > 0) await sleep(waitMs);
    download(blob, presetSliceFileName(title, preset.id, plan.format, { index: slice.index, total: plan.slices.length }));
    nextDownloadAt = now() + delayMs;
    onProgress?.(slice.index + 1, plan.slices.length);
  }
  return {
    files: plan.slices.length,
    oversized,
    format: plan.format,
    targetWidth: plan.targetWidth,
    // pristine 계약: 라우팅이 없으면 결과 shape 도 기존 그대로(키 부재).
    ...(prepared.vipsRoutedPages > 0 ? { vipsRoutedPages: prepared.vipsRoutedPages } : {}),
  };
}
