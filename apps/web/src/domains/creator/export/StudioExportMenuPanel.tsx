import { Copy, FileImage, FileText, Layers, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  publishStudioExportPrintBoxMm,
  publishStudioExportResolutionDpi,
} from "../render/studio-raster-resolution-metadata";
import {
  CONTACT_SHEET_PAGE_PRESETS,
  contactSheetResultMessage,
  DEFAULT_CONTACT_SHEET_COLUMNS,
  DEFAULT_CONTACT_SHEET_ROWS,
  exportContactSheetPdf,
} from "../studio-pdf-contact-sheet";
import { WATERMARK_POSITIONS, type WatermarkSettings } from "../studio-watermark";
import { StudioContactSheetPanel } from "../StudioContactSheetPanel";

import {
  loadStudioPsdExportModule,
  loadStudioSvgExportModule,
  preloadStudioPsdExportModule,
  preloadStudioSvgExportModule,
} from "./studio-document-export-loaders";
import {
  EXPORT_FORMATS,
  EXPORT_SCALES,
  canCopyImageToClipboard,
  canvasToBlob,
  downloadBlob,
  exportFormatLabel,
  exportQuality,
  type ExportFormat,
} from "./studio-export";
import {
  readStudioExportGeometryDraft,
  writeStudioExportGeometryDraft,
} from "./studio-export-geometry-draft";
import {
  formatExportPageRangeLabel,
  planMultiPageExportCapture,
  preflightStudioExportPackage,
  STUDIO_EXPORT_BLEED_MM_RANGE,
  STUDIO_EXPORT_DPI_RANGE,
  STUDIO_EXPORT_TRIM_MM_RANGE,
  studioExportGeometryPreset,
  type StudioExportGeometryPresetId,
  type StudioExportPackageIssue,
} from "./studio-export-package-preflight";
import {
  EXPORT_PRESETS,
  exportPresetSlices,
  planStripSlices,
  presetExportResultMessage,
  recommendScale,
  validateExport,
  type PresetExportScope,
} from "./studio-export-presets";
import { exportPagesToPdf, pdfExportResultMessage } from "./studio-pdf-export";

import type {
  StudioRasterEncoded,
  StudioRasterInterchangeFormat,
} from "../render/studio-raster-interchange";
import type { StudioInkMlExportResult } from "../studio-inkml-interchange";
import type { PsdExportResult } from "./studio-psd-export";
import type { SvgExportResult } from "./studio-svg-export";
import type { StudioWillV1PageExportResult } from "./studio-will-v1-export-bridge";
import type { Dispatch, SetStateAction } from "react";

import { cx } from "@/shared/lib/cx";

/** 내보내기 진행/결과 안내(규격 슬라이스·PDF 공용) — tone에 따라 색을 달리해 표시한다. */
interface ExportRunStatus {
  tone: "info" | "good" | "warn";
  text: string;
}

const OPEN_RASTER_FORMATS: readonly {
  id: StudioRasterInterchangeFormat;
  label: string;
  detail: string;
}[] = [
  { id: "qoi", label: "QOI", detail: "빠른 무손실 RGBA" },
  { id: "tga", label: "TGA", detail: "게임·3D RGBA" },
  { id: "pam", label: "PAM", detail: "Netpbm RGBA" },
  { id: "bmp", label: "BMP", detail: "범용 24-bit" },
  { id: "ppm", label: "PPM", detail: "범용 RGB" },
  { id: "tiff", label: "TIFF", detail: "무압축 RGBA 교환" },
] as const;

function safeExportBaseName(title: string): string {
  return Array.from(title.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && !"\\/:*?\"<>|".includes(character);
    })
    .join("")
    .trim()
    .slice(0, 120) || "toonspectrum-comic";
}

export interface StudioExportMenuPanelProps {
  canvasWidth: number;
  canvasHeight: number;
  exportScale: number;
  exportFormat: ExportFormat;
  exportTransparent: boolean;
  exportPresetId: string | null;
  watermark: WatermarkSettings;
  isExporting: boolean;
  /** 규격 슬라이스 파일명에 쓸 작품 제목(비어 있으면 기본 파일명). */
  exportTitle: string;
  /** 전체 페이지 수 — 2 이상이면 "전체 페이지" 규격 내보내기 버튼을 보여준다. */
  pageCount: number;
  /** 페이지별 표시 이름(pageDisplayName 결과) — 콘택트시트 라벨에 쓴다. pages와 같은 순서/길이. */
  pageLabels: string[];
  /**
   * Optional package preflight inputs for page-range / DPI / dialogue TXT checks.
   * When omitted, the panel keeps legacy full-range export behavior.
   */
  exportDpi?: number;
  exportTrimWidthMm?: number;
  exportTrimHeightMm?: number;
  exportBleedMm?: number;
  /** When provided, enables 대사 TXT package export for the selected page range. */
  dialoguePages?: readonly import( "../lettering/studio-dialogue-batch").DialoguePageLike[] | null;
  setExportScale: Dispatch<SetStateAction<number>>;
  setExportFormat: Dispatch<SetStateAction<ExportFormat>>;
  setExportTransparent: Dispatch<SetStateAction<boolean>>;
  setExportPresetId: Dispatch<SetStateAction<string | null>>;
  setWatermark: (next: WatermarkSettings) => void;
  onCopyToClipboard: () => void;
  /**
   * 규격 슬라이스용 페이지 캡처 — 현재 페이지("current") 또는 전체 페이지("all")를
   * 내보내기 배율·색보정 합성으로 캡처해 페이지 순서대로 반환한다. 워터마크는 여기서
   * 찍지 않는다(슬라이스 단계에서 장마다 합성 — 절단면에서 잘리지 않게).
   */
  capturePagesForPreset: (scope: PresetExportScope) => Promise<HTMLCanvasElement[]>;
  /**
   * Optional range-aware capture — 0-based page indices in document order.
   * When provided, multi-page CBZ/PDF/preset/contact-sheet paths prefer this over
   * capturePagesForPreset("all") so only the package page range is rasterized.
   * Parent (StudioPage) may omit this; the panel then falls back to "all" (+ slice).
   */
  capturePagesForIndices?: (indices: number[]) => Promise<HTMLCanvasElement[]>;
  /**
   * 현재 페이지를 벡터 SVG로 직렬화 — 요소 데이터가 필요하므로 StudioPage가 페이지
   * elements/배경/그룹/테마를 넘겨 studio-svg-export.exportPageToSvg 를 호출해 결과를 준다.
   * (래스터 캡처와 달리 원본 벡터를 보존하되, 픽셀 필터·톤 등 일부는 스킵 집계로 고지.)
   */
  exportCurrentPageToSvg?: () => Promise<SvgExportResult>;
  /** 현재 페이지의 보이는 펜 자유곡선을 검증된 bounded InkML로 내보냅니다. */
  exportCurrentPageToInkMl?: () => Promise<StudioInkMlExportResult>;
  /** 보이는 펜 자유곡선을 ToonSpectrum bounded public-spec WILL v1 Annex B로 내보냅니다. */
  exportCurrentPageToWillV1?: () => Promise<StudioWillV1PageExportResult>;
  /**
   * 현재 페이지를 요소별 레이어를 가진 PSD로 캡처 — Konva 스테이지에서 요소를 하나씩
   * 래스터화해야 하므로(여러 번의 toCanvas) SVG와 달리 비동기다. StudioPage가 stage/요소/
   * 배율을 묶어 studio-psd-export.exportPagePsd 를 호출해 결과를 준다.
   */
  exportCurrentPageToPsd?: () => Promise<PsdExportResult>;
  /** 브라우저 Canvas가 직접 인코딩하지 못하는 공개 래스터 포맷을 Worker/코덱 경계로 출력한다. */
  exportCurrentPageToRasterInterchange?: (
    format: StudioRasterInterchangeFormat
  ) => Promise<StudioRasterEncoded>;
}

export function StudioExportMenuPanel({
  canvasWidth,
  canvasHeight,
  exportScale,
  exportFormat,
  exportTransparent,
  exportPresetId,
  watermark,
  isExporting,
  exportTitle,
  pageCount,
  pageLabels,
  exportDpi = 72,
  exportTrimWidthMm,
  exportTrimHeightMm,
  exportBleedMm,
  dialoguePages = null,
  setExportScale,
  setExportFormat,
  setExportTransparent,
  setExportPresetId,
  setWatermark,
  onCopyToClipboard,
  capturePagesForPreset,
  capturePagesForIndices,
  exportCurrentPageToSvg,
  exportCurrentPageToInkMl,
  exportCurrentPageToWillV1,
  exportCurrentPageToPsd,
  exportCurrentPageToRasterInterchange,
}: StudioExportMenuPanelProps) {
  // 규격 슬라이스 실행 상태 — 캡처·저장이 비동기라 패널 안에서 진행/결과를 안내한다.
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetStatus, setPresetStatus] = useState<ExportRunStatus | null>(null);
  // PDF 내보내기 실행 상태 — 규격 슬라이스와 독립 실행이라 상태도 따로 안내한다.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<ExportRunStatus | null>(null);
  // SVG(벡터) 내보내기 결과 안내 — 스킵/근사 집계를 사용자에게 고지한다.
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgStatus, setSvgStatus] = useState<ExportRunStatus | null>(null);
  // PSD(레이어별) 내보내기 실행 상태 — 요소별 캡처가 여러 번 돌아 비동기라 진행/결과를 안내한다.
  const [psdBusy, setPsdBusy] = useState(false);
  const [psdStatus, setPsdStatus] = useState<ExportRunStatus | null>(null);
  const [openRasterFormat, setOpenRasterFormat] = useState<StudioRasterInterchangeFormat>("qoi");
  const [openRasterBusy, setOpenRasterBusy] = useState(false);
  const [openRasterStatus, setOpenRasterStatus] = useState<ExportRunStatus | null>(null);
  const [archiveBusy, setArchiveBusy] = useState<"cbz" | "inkml" | "ora" | "will" | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<ExportRunStatus | null>(null);
  // 콘택트시트(다중 페이지 축소판을 인쇄용 한 장에 타일링) 실행 상태 — 다른 내보내기와 독립.
  const [contactColumns, setContactColumns] = useState<number>(DEFAULT_CONTACT_SHEET_COLUMNS);
  const [contactRows, setContactRows] = useState<number>(DEFAULT_CONTACT_SHEET_ROWS);
  const [contactPagePresetId, setContactPagePresetId] = useState<string>(CONTACT_SHEET_PAGE_PRESETS[0].id);
  const [contactShowLabels, setContactShowLabels] = useState(true);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactStatus, setContactStatus] = useState<ExportRunStatus | null>(null);
  /** Inclusive 1-based page numbers for package range (user-facing). */
  const [rangeFromPage, setRangeFromPage] = useState(1);
  const [rangeToPage, setRangeToPage] = useState(Math.max(1, pageCount));
  const [includeDialogueTxt, setIncludeDialogueTxt] = useState(false);
  const [packageStatus, setPackageStatus] = useState<ExportRunStatus | null>(null);
  /**
   * Editable print geometry for package preflight. Seeded from the surviving draft first —
   * this panel unmounts whenever the menu closes, and losing "인쇄 A4 300" on every close made
   * the geometry (and the resolution written into the file) silently fall back to 72 DPI.
   */
  const geometryDraft = readStudioExportGeometryDraft();
  const [geometryDpi, setGeometryDpi] = useState(geometryDraft?.dpi ?? exportDpi);
  const [geometryTrimW, setGeometryTrimW] = useState<number | null>(
    geometryDraft ? geometryDraft.trimWidthMm : exportTrimWidthMm ?? null
  );
  const [geometryTrimH, setGeometryTrimH] = useState<number | null>(
    geometryDraft ? geometryDraft.trimHeightMm : exportTrimHeightMm ?? null
  );
  const [geometryBleed, setGeometryBleed] = useState<number | null>(
    geometryDraft ? geometryDraft.bleedMm : exportBleedMm ?? null
  );
  const [geometryPresetId, setGeometryPresetId] = useState<StudioExportGeometryPresetId | null>(
    geometryDraft?.presetId ?? null
  );
  // 페이지당 요소 수만큼 순차 캡처라 다른 내보내기보다 오래 걸린다 — 진행 중 패널이 닫히거나
  // 언마운트되면(다른 내보내기 형식으로 전환 등) 뒤늦게 도착한 결과가 상태를 덮어쓰지 않게 막는다.
  const mountedRef = useRef(true);
  useEffect(() => {
    // React StrictMode는 개발 환경에서 effect를 setup → cleanup → setup 순으로 재실행한다.
    // setup 때 다시 활성화하지 않으면 모든 비동기 내보내기 결과와 finally가 영구 폐기된다.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    setRangeFromPage((current) => Math.min(Math.max(1, current), Math.max(1, pageCount)));
    setRangeToPage((current) => Math.min(Math.max(1, current), Math.max(1, pageCount)));
  }, [pageCount]);
  const selectedPreset = exportPresetId ? EXPORT_PRESETS.find((preset) => preset.id === exportPresetId) : null;

  const packagePreflight = preflightStudioExportPackage({
    pageCount: Math.max(0, pageCount),
    pageRange: {
      fromIndex: Math.max(0, rangeFromPage - 1),
      toIndex: Math.max(0, rangeToPage - 1),
    },
    geometry: {
      widthPx: canvasWidth,
      heightPx: canvasHeight,
      dpi: geometryDpi,
      ...(geometryTrimW != null ? { trimWidthMm: geometryTrimW } : {}),
      ...(geometryTrimH != null ? { trimHeightMm: geometryTrimH } : {}),
      ...(geometryBleed != null ? { bleedMm: geometryBleed } : {}),
    },
    requireDialogueTxt: includeDialogueTxt,
    pagesForDialogue: dialoguePages ?? undefined,
    dialogueTitle: exportTitle,
    exportScale,
  });

  /**
   * 인쇄 지오메트리 계획 — 트림/도련은 픽셀에 굽지 않고(그림을 자르지 않기 위해) "지금 배율이
   * 실제로 몇 DPI인가"와 "목표 DPI에 닿으려면 무엇이 바뀌어야 하는가"만 계산한다.
   * 계획은 프리플라이트가 소유한다 — 여기서 다시 계산하면 표기와 차단 판정이 어긋날 수 있다.
   */
  const printPlan = packagePreflight.printPlan;
  /**
   * 해상도 오류는 지오메트리 섹션의 전용 알림(export-geometry-dpi-alert)이 이미 띄운다 —
   * 하단 차단 목록에서 한 번 더 반복하지 않는다.
   */
  const nonPrintDpiErrors = packagePreflight.errors.filter(
    (issue) => !issue.code.startsWith("PRINT_DPI_")
  );
  /**
   * 파일에 실제로 기록할 해상도 — 트림이 있으면 "출력 크기를 덮는 실측 DPI", 없으면 사용자가
   * 고른 DPI 그대로. UI 표기와 파일 바이트가 같은 값을 말하게 하는 단일 출처다.
   */
  const exportResolutionDpi = printPlan ? printPlan.currentDpi : geometryDpi;
  /**
   * 인쇄 출력 상자(트림+도련) — 이 값이 게시되면 파일에 박히는 DPI는 예측이 아니라 인코딩된
   * 픽셀에서 실측된다. 내보내기 픽셀 수는 편집기 줌(effectiveScale)에 따라 1px 달라질 수 있어
   * 순수 계산으로는 정확히 맞출 수 없기 때문이다.
   */
  const printBoxWidthMm = printPlan?.outputWidthMm ?? null;
  const printBoxHeightMm = printPlan?.outputHeightMm ?? null;

  useEffect(() => {
    // 언마운트(메뉴 닫힘)에서 지우지 않는다 — 툴바 다운로드는 이 패널이 닫힌 뒤에 눌린다.
    publishStudioExportResolutionDpi(exportResolutionDpi);
  }, [exportResolutionDpi]);

  useEffect(() => {
    publishStudioExportPrintBoxMm(
      printBoxWidthMm != null && printBoxHeightMm != null
        ? { widthMm: printBoxWidthMm, heightMm: printBoxHeightMm }
        : null
    );
  }, [printBoxWidthMm, printBoxHeightMm]);

  useEffect(() => {
    writeStudioExportGeometryDraft({
      dpi: geometryDpi,
      trimWidthMm: geometryTrimW,
      trimHeightMm: geometryTrimH,
      bleedMm: geometryBleed,
      presetId: geometryPresetId,
    });
  }, [geometryDpi, geometryTrimW, geometryTrimH, geometryBleed, geometryPresetId]);

  function applyGeometryPreset(id: StudioExportGeometryPresetId) {
    const preset = studioExportGeometryPreset(id);
    setGeometryPresetId(id);
    setGeometryDpi(preset.dpi);
    if (id === "webtoon72") {
      setGeometryTrimW(null);
      setGeometryTrimH(null);
      setGeometryBleed(null);
    } else {
      setGeometryTrimW(preset.trimWidthMm ?? null);
      setGeometryTrimH(preset.trimHeightMm ?? null);
      setGeometryBleed(preset.bleedMm ?? null);
    }
  }

  function clampGeometryNumber(
    value: number,
    range: { min: number; max: number }
  ): number {
    if (!Number.isFinite(value)) return range.min;
    return Math.min(range.max, Math.max(range.min, value));
  }

  function issueTone(issues: readonly StudioExportPackageIssue[]): ExportRunStatus["tone"] {
    if (issues.some((issue) => issue.severity === "error")) return "warn";
    if (issues.some((issue) => issue.severity === "warning")) return "warn";
    return "good";
  }

  /**
   * Multi-page capture for CBZ/PDF/preset/contact-sheet — honors package pageIndices.
   * Prefers capturePagesForIndices when the parent wired it; otherwise "all" (+ slice).
   */
  async function captureMultiPageExportCanvases(): Promise<{
    pages: HTMLCanvasElement[];
    indices: number[];
    fromPage: number;
    toPage: number;
    rangeLabel: string;
  }> {
    const plan = planMultiPageExportCapture({
      pageIndices: packagePreflight.pageIndices,
      pageCount,
      hasIndicesCapture: typeof capturePagesForIndices === "function",
    });
    if (plan.indices.length === 0) {
      const rangeError = packagePreflight.errors.find((issue) =>
        issue.code === "PAGE_RANGE_INVALID"
        || issue.code === "PAGE_RANGE_EMPTY"
        || issue.code === "PAGE_COUNT_INVALID"
      );
      throw new Error(
        rangeError?.message ?? "선택한 페이지 범위에 내보낼 페이지가 없습니다."
      );
    }
    const fromPage = plan.indices[0]! + 1;
    const toPage = plan.indices[plan.indices.length - 1]! + 1;
    const rangeLabel = formatExportPageRangeLabel(fromPage, toPage);

    if (plan.mode === "indices" && capturePagesForIndices) {
      const pages = await capturePagesForIndices(plan.indices);
      return { pages, indices: plan.indices, fromPage, toPage, rangeLabel };
    }

    const all = await capturePagesForPreset("all");
    if (plan.mode === "all-then-slice") {
      const pages = plan.indices
        .map((index) => all[index])
        .filter((canvas): canvas is HTMLCanvasElement => canvas != null);
      if (pages.length === 0) {
        throw new Error("내보낼 페이지를 캡처하지 못했습니다.");
      }
      return { pages, indices: plan.indices, fromPage, toPage, rangeLabel };
    }
    return { pages: all, indices: plan.indices, fromPage, toPage, rangeLabel };
  }

  function exportDialogueTxtPackage() {
    if (!packagePreflight.canExport || !packagePreflight.dialogueTxt) {
      setPackageStatus({
        tone: "warn",
        text: packagePreflight.errors[0]?.message
          ?? packagePreflight.warnings[0]?.message
          ?? "대사 TXT를 내보낼 수 없습니다.",
      });
      return;
    }
    const file = packagePreflight.dialogueTxt;
    downloadBlob(new Blob([file.text], { type: file.mimeType }), file.fileName);
    setPackageStatus({
      tone: issueTone(packagePreflight.issues),
      text: [
        `대사 TXT ${file.cueCount}개를 저장했어요. (페이지 ${rangeFromPage}–${rangeToPage})`,
        ...packagePreflight.warnings.map((issue) => issue.message),
      ].join(" "),
    });
  }

  async function runOpenRasterExport() {
    if (
      !exportCurrentPageToRasterInterchange || openRasterBusy || psdBusy || svgBusy || pdfBusy ||
      presetBusy || isExporting || contactBusy || archiveBusy !== null
    ) return;
    setOpenRasterBusy(true);
    setOpenRasterStatus({ tone: "info", text: `${openRasterFormat.toUpperCase()} 픽셀을 인코딩하는 중...` });
    try {
      const result = await exportCurrentPageToRasterInterchange(openRasterFormat);
      if (!mountedRef.current) return;
      const owned = new Uint8Array(result.bytes.byteLength);
      owned.set(result.bytes);
      const safeTitle = safeExportBaseName(exportTitle);
      downloadBlob(new Blob([owned.buffer], { type: result.mimeType }), `${safeTitle}${result.extension}`);
      setOpenRasterStatus({
        tone: result.lossy || result.warnings.length > 0 ? "warn" : "good",
        text: [
          `${openRasterFormat.toUpperCase()} 파일을 저장했어요.`,
          ...result.warnings,
        ].join(" "),
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setOpenRasterStatus({
        tone: "warn",
        text: error instanceof Error ? error.message : "공개 래스터 파일을 만들지 못했습니다.",
      });
    } finally {
      if (mountedRef.current) setOpenRasterBusy(false);
    }
  }

  async function runArchiveExport(kind: "cbz" | "ora") {
    if (
      archiveBusy !== null || openRasterBusy || psdBusy || svgBusy || pdfBusy || presetBusy ||
      isExporting || contactBusy
    ) return;
    setArchiveBusy(kind);
    setArchiveStatus({
      tone: "info",
      text:
        kind === "cbz"
          ? `CBZ로 묶는 중… (${formatExportPageRangeLabel(rangeFromPage, rangeToPage)})`
          : "현재 페이지를 OpenRaster로 묶는 중…",
    });
    try {
      let canvases: HTMLCanvasElement[];
      let rangeLabel = "현재 페이지";
      if (kind === "cbz") {
        const captured = await captureMultiPageExportCanvases();
        canvases = captured.pages;
        rangeLabel = captured.rangeLabel;
      } else {
        canvases = await capturePagesForPreset("current");
      }
      if (canvases.length === 0) throw new Error("내보낼 페이지를 캡처하지 못했습니다.");
      const pngPages: Blob[] = [];
      for (let index = 0; index < canvases.length; index += 1) {
        if (mountedRef.current) {
          setArchiveStatus({
            tone: "info",
            text: `${index + 1}/${canvases.length}페이지를 무손실 PNG로 변환하는 중… (${rangeLabel})`,
          });
        }
        pngPages.push(await canvasToBlob(canvases[index]!, "image/png"));
      }
      if (!mountedRef.current) return;
      const safeTitle = safeExportBaseName(exportTitle);
      if (kind === "cbz") {
        const { buildStudioCbzBlob } = await import("../studio-cbz-interchange");
        const result = await buildStudioCbzBlob(
          {
            pages: pngPages.map((image) => ({ image })),
            metadata: {
              title: exportTitle.trim() || safeTitle,
              count: pngPages.length,
              format: "Webtoon",
            },
          },
          { crc32ExecutionMode: "worker" },
        );
        downloadBlob(result.blob, `${safeTitle}.cbz`);
        setArchiveStatus({
          tone: result.warnings.length > 0 ? "warn" : "good",
          text: [
            `CBZ ${pngPages.length}페이지와 ComicInfo.xml을 저장했어요. (${rangeLabel})`,
            ...result.warnings.map((item) => item.message),
          ].join(" "),
        });
      } else {
        const { buildStudioOpenRasterBlob } = await import("../studio-openraster-interchange");
        const canvas = canvases[0]!;
        const image = pngPages[0]!;
        const result = await buildStudioOpenRasterBlob(
          {
            width: canvas.width,
            height: canvas.height,
            name: exportTitle.trim() || safeTitle,
            layers: [{ name: "합성 페이지", png: image }],
            mergedImage: image,
            thumbnail: image,
          },
          { crc32ExecutionMode: "worker" },
        );
        downloadBlob(result.blob, `${safeTitle}.ora`);
        setArchiveStatus({
          tone: "warn",
          text: [
            "OpenRaster를 저장했어요. 현재 메뉴 경로는 화면과 같은 합성 1레이어이며, 요소별 레이어 교환은 PSD를 사용하세요.",
            ...result.warnings.map((item) => item.message),
          ].join(" "),
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setArchiveStatus({
        tone: "warn",
        text: error instanceof Error ? error.message : "문서 교환 파일을 만들지 못했습니다.",
      });
    } finally {
      if (mountedRef.current) setArchiveBusy(null);
    }
  }

  async function runInkMlExport() {
    if (
      !exportCurrentPageToInkMl || archiveBusy !== null || openRasterBusy || psdBusy || svgBusy ||
      pdfBusy || presetBusy || isExporting || contactBusy
    ) return;
    setArchiveBusy("inkml");
    setArchiveStatus({
      tone: "info",
      text: "자유곡선 채널과 InkML 왕복 적합성을 검사하는 중…",
    });
    try {
      const result = await exportCurrentPageToInkMl();
      if (!mountedRef.current) return;
      downloadBlob(
        new Blob([result.xml], { type: `${result.mediaType};charset=utf-8` }),
        `${safeExportBaseName(exportTitle)}.inkml`,
      );
      setArchiveStatus({
        tone: result.skipped.length > 0 ? "warn" : "good",
        text: [
          `InkML ${result.exportedStrokeIds.length}개 획을 검증해 저장했어요.`,
          result.skipped.length > 0
            ? `숨김·지우개·도형 ${result.skipped.length}개는 의미 손실을 막기 위해 제외했어요.`
            : "",
        ].filter(Boolean).join(" "),
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setArchiveStatus({
        tone: "warn",
        text: error instanceof Error ? error.message : "InkML 파일을 만들지 못했습니다.",
      });
    } finally {
      if (mountedRef.current) setArchiveBusy(null);
    }
  }

  async function runWillV1Export() {
    if (
      !exportCurrentPageToWillV1 || archiveBusy !== null || openRasterBusy || psdBusy || svgBusy ||
      pdfBusy || presetBusy || isExporting || contactBusy
    ) return;
    setArchiveBusy("will");
    setArchiveStatus({
      tone: "info",
      text: "보이는 자유곡선을 bounded WILL v1 Annex B Worker로 패키징하는 중…",
    });
    try {
      const result = await exportCurrentPageToWillV1();
      if (!mountedRef.current) return;
      const owned = Uint8Array.from(result.bytes);
      downloadBlob(
        new Blob([owned.buffer], { type: result.mediaType }),
        `${safeExportBaseName(exportTitle)}${result.extension}`,
      );
      const quantized = result.loss.items.reduce(
        (total, item) => total + item.changedValues,
        0,
      );
      setArchiveStatus({
        tone:
          result.skipped.length > 0 || result.adaptations.length > 0 || quantized > 0
            ? "warn"
            : "good",
        text: [
          `WILL v1 ${result.exportedStrokeIds.length}개 획을 저장했어요.`,
          result.skipped.length > 0
            ? `표현할 수 없는 ${result.skipped.length}개 요소는 제외했어요.`
            : "",
          result.adaptations.length > 0 || quantized > 0
            ? `bounded profile 변환 ${result.adaptations.length + quantized}건을 결과에 반영했어요.`
            : "",
          result.disclaimer,
        ].filter(Boolean).join(" "),
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setArchiveStatus({
        tone: "warn",
        text: error instanceof Error ? error.message : "WILL v1 파일을 만들지 못했습니다.",
      });
    } finally {
      if (mountedRef.current) setArchiveBusy(null);
    }
  }

  const outW = Math.round(canvasWidth * exportScale);
  const outH = Math.round(canvasHeight * exportScale);
  const validation = selectedPreset
    ? validateExport({ width: outW, height: outH, format: exportFormat }, selectedPreset)
    : null;
  const maxH = selectedPreset?.maxImageHeight;
  const slices = maxH !== undefined && outH > maxH ? planStripSlices(outH, maxH) : null;
  const quality = exportQuality(exportFormat);
  /** Selected package range size for multi-page chrome (falls back to full document). */
  const exportRangeCount =
    packagePreflight.pageIndices.length > 0 ? packagePreflight.pageIndices.length : Math.max(1, pageCount);
  const exportRangeLabel = formatExportPageRangeLabel(rangeFromPage, rangeToPage);
  const exportRangeIsPartial = exportRangeCount < Math.max(1, pageCount);

  // 선택 범위 페이지 캡처 → JPEG 인코드 → 미니멀 PDF 조립 → 한 파일 다운로드.
  async function runPdfExport() {
    if (pdfBusy || presetBusy || psdBusy || svgBusy || isExporting || contactBusy || archiveBusy !== null) return;
    setPdfBusy(true);
    const pendingRange = formatExportPageRangeLabel(rangeFromPage, rangeToPage);
    setPdfStatus({
      tone: "info",
      text: pageCount > 1 ? `${pendingRange} 캡처 중…` : "페이지 캡처 중…",
    });
    try {
      const captured = await captureMultiPageExportCanvases();
      const result = await exportPagesToPdf({
        pages: captured.pages,
        title: exportTitle,
        watermark,
        onProgress: (done, total) =>
          setPdfStatus({
            tone: "info",
            text: `${done}/${total}페이지 PDF 변환 중… (${captured.rangeLabel})`,
          }),
      });
      setPdfStatus({
        tone: "good",
        text: `${pdfExportResultMessage(result)} (${captured.rangeLabel})`,
      });
    } catch (err) {
      setPdfStatus({
        tone: "warn",
        text: err instanceof Error ? err.message : "PDF 내보내기에 실패했어요.",
      });
    } finally {
      setPdfBusy(false);
    }
  }

  // 페이지 축소판 여러 장을 한 인쇄용 시트에 격자로 배치 → PDF 한 파일. PDF 바이트 조립은
  // exportPagesToPdf와 동일한 buildPdfFromJpegPages를 재사용(studio-pdf-contact-sheet 내부).
  async function runContactSheetExport() {
    if (contactBusy || pdfBusy || presetBusy || psdBusy || svgBusy || isExporting || archiveBusy !== null) return;
    const preset = CONTACT_SHEET_PAGE_PRESETS.find((p) => p.id === contactPagePresetId) ?? CONTACT_SHEET_PAGE_PRESETS[0];
    setContactBusy(true);
    const pendingRange = formatExportPageRangeLabel(rangeFromPage, rangeToPage);
    setContactStatus({
      tone: "info",
      text: pageCount > 1 ? `${pendingRange} 캡처 중…` : "페이지 캡처 중…",
    });
    try {
      const captured = await captureMultiPageExportCanvases();
      const rangedLabels = captured.indices.map(
        (index) => pageLabels[index] ?? String(index + 1)
      );
      const result = await exportContactSheetPdf({
        pages: captured.pages,
        pageLabels: rangedLabels,
        columns: contactColumns,
        rows: contactRows,
        sheetWidth: preset.widthPx,
        sheetHeight: preset.heightPx,
        showLabels: contactShowLabels,
        title: exportTitle,
        onProgress: (done, total) =>
          setContactStatus({
            tone: "info",
            text: `${done}/${total}장 합성 중… (${captured.rangeLabel})`,
          }),
      });
      if (!mountedRef.current) return;
      setContactStatus({
        tone: "good",
        text: `${contactSheetResultMessage(result)} (${captured.rangeLabel})`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setContactStatus({ tone: "warn", text: err instanceof Error ? err.message : "콘택트시트 내보내기에 실패했어요." });
    } finally {
      if (mountedRef.current) setContactBusy(false);
    }
  }

  // 현재 페이지 → 벡터 SVG 한 파일. 요소 직렬화는 StudioPage(exportCurrentPageToSvg)가 하고,
  // 여기선 Blob 다운로드 + 스킵/근사 고지만 담당한다.
  async function runSvgExport() {
    if (
      !exportCurrentPageToSvg || svgBusy || psdBusy || pdfBusy || presetBusy || isExporting ||
      contactBusy || archiveBusy !== null
    ) return;
    setSvgBusy(true);
    setSvgStatus({ tone: "info", text: "벡터 내보내기 엔진을 준비하는 중…" });
    try {
      const [result, { SVG_EXPORT_MIME, svgExportFileName, svgExportResultMessage }] =
        await Promise.all([exportCurrentPageToSvg(), loadStudioSvgExportModule()]);
      if (!mountedRef.current) return;
      const blob = new Blob([result.svg], { type: SVG_EXPORT_MIME });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = svgExportFileName(exportTitle);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSvgStatus({ tone: result.skipped.length > 0 ? "warn" : "good", text: svgExportResultMessage(result) });
    } catch (err) {
      if (!mountedRef.current) return;
      setSvgStatus({ tone: "warn", text: err instanceof Error ? err.message : "SVG 내보내기에 실패했어요." });
    } finally {
      if (mountedRef.current) setSvgBusy(false);
    }
  }

  // 현재 페이지 → 요소별 레이어를 가진 PSD 한 파일. 캡처(stage.toCanvas 여러 번)는
  // StudioPage(exportCurrentPageToPsd)가 하고, 여기선 Blob 다운로드 + 스킵 고지만 담당한다.
  async function runPsdExport() {
    if (
      !exportCurrentPageToPsd || psdBusy || svgBusy || pdfBusy || presetBusy || isExporting ||
      contactBusy || archiveBusy !== null
    ) return;
    setPsdBusy(true);
    setPsdStatus({ tone: "info", text: "레이어별로 캡처하는 중…" });
    try {
      const [result, { psdExportFileName, psdExportResultMessage }] = await Promise.all([
        exportCurrentPageToPsd(),
        loadStudioPsdExportModule(),
      ]);
      if (!mountedRef.current) return; // 언마운트 후 도착한 결과는 버린다.
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = psdExportFileName(exportTitle);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPsdStatus({ tone: result.skipped.length > 0 ? "warn" : "good", text: psdExportResultMessage(result) });
    } catch (err) {
      if (!mountedRef.current) return;
      setPsdStatus({ tone: "warn", text: err instanceof Error ? err.message : "PSD 내보내기에 실패했어요." });
    } finally {
      if (mountedRef.current) setPsdBusy(false);
    }
  }

  // 규격 선택 → 캡처 → 리샘플·분할 → 순차 다운로드까지 한 번에 실행.
  // scope "all"은 패키지 페이지 범위를 존중(전체 문서가 아닌 선택 범위 가능).
  async function runPresetSliceExport(scope: PresetExportScope) {
    if (!selectedPreset || presetBusy || pdfBusy || psdBusy || svgBusy || contactBusy || archiveBusy !== null) return;
    setPresetBusy(true);
    const pendingRange = formatExportPageRangeLabel(rangeFromPage, rangeToPage);
    setPresetStatus({
      tone: "info",
      text: scope === "all" ? `${pendingRange} 캡처 중…` : "페이지 캡처 중…",
    });
    try {
      let pages: HTMLCanvasElement[];
      let rangeSuffix = "";
      if (scope === "all") {
        const captured = await captureMultiPageExportCanvases();
        pages = captured.pages;
        rangeSuffix = ` (${captured.rangeLabel})`;
      } else {
        pages = await capturePagesForPreset("current");
      }
      const result = await exportPresetSlices({
        pages,
        preset: selectedPreset,
        format: exportFormat,
        title: exportTitle,
        watermark,
        onProgress: (done, total) =>
          setPresetStatus({
            tone: "info",
            text: `${done}/${total}장 저장 중…${rangeSuffix}`,
          }),
      });
      setPresetStatus({
        tone: result.oversized > 0 ? "warn" : "good",
        text: `${presetExportResultMessage(result, selectedPreset)}${rangeSuffix}`,
      });
    } catch (err) {
      setPresetStatus({
        tone: "warn",
        text: err instanceof Error ? err.message : "규격 내보내기에 실패했어요.",
      });
    } finally {
      setPresetBusy(false);
    }
  }

  // Always fixed (never absolute): menubar uses overflow-x-auto which clips absolute
  // children to the chrome row — File → 내보내기 then looked like a dead click.
  return (
    <div
      data-studio-export-menu-panel="true"
      className="fixed inset-x-2 top-12 z-[100] max-h-[calc(100dvh-4rem)] w-auto overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl sm:inset-x-auto sm:right-3 sm:w-72"
    >
      <div className="mb-2.5">
        <span className="mb-1 block text-xs font-semibold text-fg-2">플랫폼 규격</span>
        <div className="flex flex-wrap gap-1">
          {EXPORT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setExportPresetId(preset.id);
                setPresetStatus(null);
                if (!preset.allowedFormats.includes(exportFormat)) setExportFormat(preset.recommendedFormat);
                if (preset.width > 0) setExportScale(recommendScale(canvasWidth, preset));
              }}
              aria-pressed={exportPresetId === preset.id}
              title={preset.note}
              className={cx(
                "h-7 rounded-lg border px-2 text-[0.68rem] font-semibold transition-colors",
                exportPresetId === preset.id
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div
        data-studio-export-package-preflight="true"
        className="mb-2.5 space-y-1.5 rounded-lg border border-line/70 bg-card/40 p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="block text-xs font-semibold text-fg-2">페이지 범위 · 사전검사</span>
          <span className="tabular-nums text-[0.58rem] text-fg-3">
            {pageCount}P · {packagePreflight.canExport ? "통과" : "차단"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="범위 빠른 선택">
          <button
            type="button"
            onClick={() => {
              setRangeFromPage(1);
              setRangeToPage(Math.max(1, pageCount));
            }}
            className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised"
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => {
              setRangeFromPage(1);
              setRangeToPage(1);
            }}
            className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised"
          >
            1페이지만
          </button>
          {pageCount > 1 ? (
            <button
              type="button"
              onClick={() => {
                setRangeFromPage(pageCount);
                setRangeToPage(pageCount);
              }}
              className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised"
            >
              마지막
            </button>
          ) : null}
          {rangeFromPage > rangeToPage ? (
            <button
              type="button"
              onClick={() => {
                setRangeFromPage(rangeToPage);
                setRangeToPage(rangeFromPage);
              }}
              className="min-h-9 rounded-lg border border-warn/50 bg-warn/10 px-2 text-[0.6rem] font-semibold text-warn hover:bg-warn/15"
            >
              시작·끝 맞바꾸기
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[0.62rem] font-medium text-fg-3">
            시작 (1–{Math.max(1, pageCount)})
            <input
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              value={rangeFromPage}
              onChange={(event) => {
                const next = Number(event.target.value) || 1;
                setRangeFromPage(Math.min(Math.max(1, next), Math.max(1, pageCount)));
              }}
              className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="내보내기 시작 페이지"
            />
          </label>
          <label className="text-[0.62rem] font-medium text-fg-3">
            끝 (1–{Math.max(1, pageCount)})
            <input
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              value={rangeToPage}
              onChange={(event) => {
                const next = Number(event.target.value) || 1;
                setRangeToPage(Math.min(Math.max(1, next), Math.max(1, pageCount)));
              }}
              className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="내보내기 끝 페이지"
            />
          </label>
        </div>
        <div className="space-y-1.5 border-t border-line/50 pt-1.5">
          <span className="block text-[0.62rem] font-semibold text-fg-2">인쇄 지오메트리</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="지오메트리 프리셋">
            {(
              [
                { id: "webtoon72" as const, label: "화면 72", testId: "export-geometry-preset-webtoon72" },
                { id: "print300-b6" as const, label: "인쇄 B6 300", testId: "export-geometry-preset-print300-b6" },
                { id: "print300-a4" as const, label: "인쇄 A4 300", testId: "export-geometry-preset-print300-a4" },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={preset.testId}
                onClick={() => applyGeometryPreset(preset.id)}
                aria-pressed={geometryPresetId === preset.id}
                className={cx(
                  "min-h-9 rounded-lg border px-2 text-[0.6rem] font-semibold transition-colors",
                  geometryPresetId === preset.id
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[0.62rem] font-medium text-fg-3">
              DPI ({STUDIO_EXPORT_DPI_RANGE.min}–{STUDIO_EXPORT_DPI_RANGE.max})
              <input
                type="number"
                data-testid="export-geometry-dpi"
                min={STUDIO_EXPORT_DPI_RANGE.min}
                max={STUDIO_EXPORT_DPI_RANGE.max}
                step={1}
                value={geometryDpi}
                onChange={(event) => {
                  setGeometryPresetId(null);
                  setGeometryDpi(
                    clampGeometryNumber(Number(event.target.value), STUDIO_EXPORT_DPI_RANGE)
                  );
                }}
                className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label="내보내기 해상도 DPI"
              />
            </label>
            <label className="text-[0.62rem] font-medium text-fg-3">
              도련 (mm)
              <input
                type="number"
                data-testid="export-geometry-bleed"
                min={STUDIO_EXPORT_BLEED_MM_RANGE.min}
                max={STUDIO_EXPORT_BLEED_MM_RANGE.max}
                step={0.5}
                value={geometryBleed ?? ""}
                placeholder="없음"
                onChange={(event) => {
                  setGeometryPresetId(null);
                  const raw = event.target.value;
                  if (raw === "") {
                    setGeometryBleed(null);
                    return;
                  }
                  setGeometryBleed(
                    clampGeometryNumber(Number(raw), STUDIO_EXPORT_BLEED_MM_RANGE)
                  );
                }}
                className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label="도련 블리드 밀리미터"
              />
            </label>
            <label className="text-[0.62rem] font-medium text-fg-3">
              트림 폭 (mm)
              <input
                type="number"
                data-testid="export-geometry-trim-w"
                min={STUDIO_EXPORT_TRIM_MM_RANGE.min}
                max={STUDIO_EXPORT_TRIM_MM_RANGE.max}
                step={0.1}
                value={geometryTrimW ?? ""}
                placeholder="없음"
                onChange={(event) => {
                  setGeometryPresetId(null);
                  const raw = event.target.value;
                  if (raw === "") {
                    setGeometryTrimW(null);
                    return;
                  }
                  setGeometryTrimW(
                    clampGeometryNumber(Number(raw), STUDIO_EXPORT_TRIM_MM_RANGE)
                  );
                }}
                className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label="재단 트림 폭 밀리미터"
              />
            </label>
            <label className="text-[0.62rem] font-medium text-fg-3">
              트림 높이 (mm)
              <input
                type="number"
                data-testid="export-geometry-trim-h"
                min={STUDIO_EXPORT_TRIM_MM_RANGE.min}
                max={STUDIO_EXPORT_TRIM_MM_RANGE.max}
                step={0.1}
                value={geometryTrimH ?? ""}
                placeholder="없음"
                onChange={(event) => {
                  setGeometryPresetId(null);
                  const raw = event.target.value;
                  if (raw === "") {
                    setGeometryTrimH(null);
                    return;
                  }
                  setGeometryTrimH(
                    clampGeometryNumber(Number(raw), STUDIO_EXPORT_TRIM_MM_RANGE)
                  );
                }}
                className="mt-0.5 h-9 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label="재단 트림 높이 밀리미터"
              />
            </label>
          </div>
          <p className="text-[0.6rem] leading-snug text-fg-3">
            목표 DPI {geometryDpi}
            {geometryTrimW != null && geometryTrimH != null
              ? ` · 트림 ${geometryTrimW}×${geometryTrimH}mm`
              : " · 웹툰 화면용(트림 없음)"}
            {geometryBleed != null ? ` · 도련 ${geometryBleed}mm` : ""}
            {packagePreflight.outputSizeMm
              ? ` · 출력 ${packagePreflight.outputSizeMm.width}×${packagePreflight.outputSizeMm.height}mm`
              : ""}
          </p>
          <p data-testid="export-geometry-actual" className="text-[0.6rem] leading-snug text-fg-2">
            {printPlan
              ? `실제 저장: ${exportScale}× → 약 ${printPlan.currentWidthPx}×${printPlan.currentHeightPx}px `
                + `· 약 ${Math.round(printPlan.currentDpi)}DPI 기록`
              : `실제 저장: ${exportScale}× → ${Math.floor(canvasWidth * exportScale)}×${Math.floor(canvasHeight * exportScale)}px `
                + `· ${Math.round(geometryDpi)}DPI 기록`}
          </p>
          <p className="text-[0.58rem] leading-snug text-fg-3">
            트림·도련은 픽셀에 적용하지 않습니다 — 캔버스 비율을 유지해 그림을 자르지 않고, 출력
            크기에 맞춘 해상도만 PNG(pHYs)·JPG(JFIF)·PSD에 기록합니다. WebP·QOI는 규격상 해상도
            태그를 담지 못합니다. 위 픽셀·DPI는 예상치이며(화면 배율에 따라 1px 차이가 날 수
            있음), 파일에는 저장된 실제 픽셀에서 실측한 DPI가 기록됩니다.
            {printPlan && (printPlan.overflowWidthMm > 0.5 || printPlan.overflowHeightMm > 0.5)
              ? ` 캔버스 비율이 출력 비율과 달라 인쇄 시 ${
                  printPlan.overflowHeightMm >= printPlan.overflowWidthMm ? "세로" : "가로"
                }가 ${Math.round(Math.max(printPlan.overflowWidthMm, printPlan.overflowHeightMm))}mm 넘칩니다(재단 영역 밖).`
              : ""}
          </p>
          {printPlan?.issue ? (
            <p
              role="alert"
              data-testid="export-geometry-dpi-alert"
              className="rounded-md bg-warn/10 px-2 py-1.5 text-[0.62rem] leading-snug text-warn"
            >
              {printPlan.issue.message}
            </p>
          ) : null}
          {printPlan ? (
            <button
              type="button"
              data-testid="export-geometry-recommend-scale"
              onClick={() => {
                setExportScale(printPlan.recommendedScale);
                setExportPresetId(null);
              }}
              className="flex h-9 w-full items-center justify-center rounded-lg border border-line bg-card text-[0.62rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              title={
                printPlan.reachable
                  ? `${printPlan.recommendedScale}×(${printPlan.recommendedWidthPx}×${printPlan.recommendedHeightPx}px)에서 목표 ${Math.round(printPlan.targetDpi)}DPI를 채웁니다`
                  : `안전 배율 상한 ${printPlan.maxSafeScale}×에서 낼 수 있는 최대 해상도(${Math.round(printPlan.recommendedDpi)}DPI)를 적용합니다`
              }
            >
              배율 권장 {printPlan.recommendedScale}× · {Math.round(printPlan.recommendedDpi)}DPI
            </button>
          ) : null}
        </div>
        {!packagePreflight.canExport && nonPrintDpiErrors.length > 0 ? (
          <div role="alert" className="space-y-0.5 rounded-md bg-warn/10 px-2 py-1.5">
            {nonPrintDpiErrors.map((issue) => (
              <p key={issue.code} className="text-[0.62rem] leading-snug text-warn">
                {issue.message}
              </p>
            ))}
          </div>
        ) : !packagePreflight.canExport ? null : packagePreflight.warnings[0] ? (
          <p role="status" className="rounded-md bg-raised/50 px-2 py-1.5 text-[0.62rem] leading-snug text-fg-2">
            {packagePreflight.warnings[0].message}
          </p>
        ) : (
          <p role="status" className="rounded-md bg-good/10 px-2 py-1.5 text-[0.62rem] leading-snug text-good">
            {packagePreflight.pageIndices.length}페이지 범위가 유효합니다
            {packagePreflight.dialogueTxt
              ? ` · 대사 ${packagePreflight.dialogueTxt.cueCount}개`
              : ""}
            .
          </p>
        )}
        {dialoguePages ? (
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[0.66rem] text-fg-2">
            <input
              type="checkbox"
              checked={includeDialogueTxt}
              onChange={(event) => setIncludeDialogueTxt(event.target.checked)}
              className="accent-accent"
            />
            대사 TXT 포함(범위 내 · 검수 필수 시 체크)
          </label>
        ) : null}
        <button
          type="button"
          onClick={exportDialogueTxtPackage}
          disabled={!dialoguePages || !packagePreflight.canExport || !packagePreflight.dialogueTxt}
          className="flex h-11 w-full items-center justify-center gap-1 rounded-lg border border-line bg-card text-[0.68rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          title="선택한 페이지 범위의 대사를 TXT로 저장합니다"
        >
          <FileText size={13} aria-hidden /> 대사 TXT 내보내기
          {packagePreflight.dialogueTxt
            ? ` · ${packagePreflight.dialogueTxt.cueCount}개`
            : ""}
        </button>
        {packageStatus ? (
          <p
            role="status"
            className={cx(
              "rounded-md px-2 py-1.5 text-[0.62rem] leading-snug",
              packageStatus.tone === "good" ? "bg-good/10 text-good" : "bg-warn/10 text-warn"
            )}
          >
            {packageStatus.text}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-2">배율</span>
        <div className="flex items-center gap-1">
          {EXPORT_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => {
                setExportScale(scale);
                setExportPresetId(null);
              }}
              aria-pressed={exportScale === scale}
              className={cx(
                "h-7 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                exportScale === scale ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {scale}×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-2">포맷</span>
        <div className="flex items-center gap-1">
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => setExportFormat(format)}
              aria-pressed={exportFormat === format}
              className={cx(
                "h-7 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                exportFormat === format ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {exportFormatLabel(format)}
            </button>
          ))}
        </div>
      </div>

      <label
        className={cx(
          "mt-2.5 flex items-center gap-1.5 text-xs",
          exportFormat === "jpg" ? "cursor-not-allowed text-fg-3 opacity-50" : "cursor-pointer text-fg-2"
        )}
        title={exportFormat === "jpg" ? "JPG는 투명도를 지원하지 않아요" : "배경 없이 투명하게 내보내기"}
      >
        <input
          type="checkbox"
          checked={exportTransparent && exportFormat !== "jpg"}
          disabled={exportFormat === "jpg"}
          onChange={(event) => setExportTransparent(event.target.checked)}
          className="size-3.5 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
        />
        투명 배경 (PNG·WebP)
      </label>

      <div className="mt-2.5 border-t border-line pt-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-fg-2">
          <input
            type="checkbox"
            checked={watermark.enabled}
            onChange={(event) => setWatermark({ ...watermark, enabled: event.target.checked })}
            className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
          />
          서명·워터마크
        </label>
        {watermark.enabled && (
          <div className="mt-1.5 space-y-1.5">
            <input
              type="text"
              value={watermark.text}
              onChange={(event) => setWatermark({ ...watermark, text: event.target.value })}
              placeholder="© 작가명 / @아이디"
              maxLength={60}
              className="w-full rounded-lg border border-line bg-card px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
            />
            <div className="flex items-center gap-1.5">
              <select
                value={watermark.position}
                onChange={(event) =>
                  setWatermark({ ...watermark, position: event.target.value as WatermarkSettings["position"] })
                }
                className="h-7 flex-1 rounded-lg border border-line bg-card px-1.5 text-[0.7rem] text-fg outline-none focus:border-accent/50"
                aria-label="워터마크 위치"
              >
                {WATERMARK_POSITIONS.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.label}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={watermark.opacity}
                onChange={(event) => setWatermark({ ...watermark, opacity: Number(event.target.value) })}
                className="h-1 w-16 cursor-pointer accent-[var(--color-accent)]"
                title="워터마크 투명도"
                aria-label="워터마크 투명도"
              />
            </div>
          </div>
        )}
      </div>

      {canCopyImageToClipboard() && (
        <button
          type="button"
          onClick={onCopyToClipboard}
          disabled={isExporting}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:opacity-50"
          title="현재 페이지를 클립보드에 이미지로 복사 (붙여넣기로 바로 사용)"
        >
          <Copy size={13} /> 클립보드로 복사
        </button>
      )}

      {exportCurrentPageToRasterInterchange && (
        <section className="mt-2.5 rounded-xl border border-line bg-card/45 p-2" aria-label="공개 래스터 포맷">
          <div className="flex items-center gap-2">
            <FileImage size={14} className="shrink-0 text-accent" aria-hidden />
            <label className="min-w-0 flex-1 text-[0.65rem] font-semibold text-fg-2">
              공개 래스터 포맷
              <select
                value={openRasterFormat}
                onChange={(event) => setOpenRasterFormat(event.target.value as StudioRasterInterchangeFormat)}
                aria-label="공개 래스터 내보내기 형식"
                disabled={openRasterBusy || isExporting}
                className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
              >
                {OPEN_RASTER_FORMATS.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.label} · {format.detail}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void runOpenRasterExport()}
            disabled={
              openRasterBusy || pdfBusy || presetBusy || psdBusy || svgBusy || isExporting || contactBusy ||
              archiveBusy !== null
            }
            className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/35 bg-accent/10 px-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileImage size={13} aria-hidden />
            {openRasterBusy ? "픽셀 인코딩 중" : `${openRasterFormat.toUpperCase()} 저장`}
          </button>
          <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-4">
            QOI·TGA·PAM·TIFF는 투명도를 보존합니다. BMP·PPM은 호환성을 위해 흰색 배경에 합성합니다.
          </p>
          <p
            aria-live="polite"
            className={cx(
              openRasterStatus ? "mt-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
              openRasterStatus?.tone === "info" && "border-line bg-panel text-fg-3",
              openRasterStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
              openRasterStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            {openRasterStatus?.text}
          </p>
        </section>
      )}

      <section className="mt-2.5 rounded-xl border border-line bg-card/45 p-2" aria-label="문서 교환 포맷">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Layers size={14} className="text-accent" aria-hidden />
          <span className="text-[0.68rem] font-semibold text-fg-2">문서·만화 교환</span>
        </div>
        <div
          className={cx(
            "grid gap-1.5",
            exportCurrentPageToWillV1
              ? "grid-cols-2"
              : exportCurrentPageToInkMl
                ? "grid-cols-3"
                : "grid-cols-2",
          )}
        >
          <button
            type="button"
            onClick={() => void runArchiveExport("cbz")}
            disabled={
              archiveBusy !== null || openRasterBusy || pdfBusy || presetBusy || psdBusy || svgBusy ||
              isExporting || contactBusy
            }
            className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            title={`${exportRangeLabel}(${exportRangeCount}장)를 ComicInfo.xml 메타데이터와 함께 CBZ로 저장`}
          >
            <FileImage size={13} aria-hidden />
            {archiveBusy === "cbz" ? "CBZ 생성 중" : `CBZ · ${exportRangeCount}P`}
          </button>
          <button
            type="button"
            onClick={() => void runArchiveExport("ora")}
            disabled={
              archiveBusy !== null || openRasterBusy || pdfBusy || presetBusy || psdBusy || svgBusy ||
              isExporting || contactBusy
            }
            className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            title="현재 페이지를 OpenRaster 합성 1레이어 파일로 저장"
          >
            <Layers size={13} aria-hidden />
            {archiveBusy === "ora" ? "ORA 중" : "ORA"}
          </button>
          {exportCurrentPageToInkMl && (
            <button
              type="button"
              onClick={() => void runInkMlExport()}
              disabled={
                archiveBusy !== null || openRasterBusy || pdfBusy || presetBusy || psdBusy || svgBusy ||
                isExporting || contactBusy
              }
              className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-1.5 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              title="현재 페이지의 보이는 펜 자유곡선을 필압·기울기 채널이 있는 검증된 InkML로 저장"
            >
              <FileText size={13} aria-hidden />
              {archiveBusy === "inkml" ? "검증 중" : "InkML"}
            </button>
          )}
          {exportCurrentPageToWillV1 && (
            <button
              type="button"
              onClick={() => void runWillV1Export()}
              disabled={
                archiveBusy !== null || openRasterBusy || pdfBusy || presetBusy || psdBusy || svgBusy ||
                isExporting || contactBusy
              }
              className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-accent/35 bg-accent-soft/35 px-1.5 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              title="현재 페이지의 보이는 펜 자유곡선을 ToonSpectrum bounded WILL v1 Annex B .will 파일로 저장"
            >
              <FileText size={13} aria-hidden />
              {archiveBusy === "will" ? "WILL 생성 중" : "WILL v1"}
            </button>
          )}
        </div>
        <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-4">
          CBZ는 선택 범위와 ComicInfo.xml, ORA는 현재 화면의 합성을 보존합니다.
          {exportCurrentPageToInkMl ? " InkML은 펜 자유곡선의 입력 채널을 검증해 교환합니다." : null}
          {exportCurrentPageToWillV1
            ? " WILL v1은 ToonSpectrum bounded 공개 명세 프로필이며 Wacom 공식 SDK·인증 파일이 아닙니다."
            : null}
        </p>
        <p
          aria-live="polite"
          className={cx(
            archiveStatus ? "mt-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
            archiveStatus?.tone === "info" && "border-line bg-panel text-fg-3",
            archiveStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
            archiveStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
          )}
        >
          {archiveStatus?.text}
        </p>
      </section>

      {/* 선택 범위 페이지 → PDF 한 파일 — JPG(품질 92%)로 담는 규격 무관 백업·제출·공유용. */}
      <button
        type="button"
        onClick={() => void runPdfExport()}
        disabled={pdfBusy || presetBusy || psdBusy || svgBusy || isExporting || contactBusy || archiveBusy !== null}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
        title={`${exportRangeLabel}(${exportRangeCount}장)를 JPG로 담은 PDF 한 파일로 저장`}
      >
        <FileText size={13} />{" "}
        {exportRangeIsPartial
          ? `PDF (${exportRangeLabel} · ${exportRangeCount}장)`
          : `PDF (전체 ${pageCount}페이지)`}
      </button>
      <p
        aria-live="polite"
        className={cx(
          pdfStatus ? "mt-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
          pdfStatus?.tone === "info" && "border-line bg-card text-fg-3",
          pdfStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
          pdfStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
        )}
      >
        {pdfStatus?.text}
      </p>

      <StudioContactSheetPanel
        columns={contactColumns}
        rows={contactRows}
        pagePresetId={contactPagePresetId}
        showLabels={contactShowLabels}
        pageCount={pageCount}
        busy={contactBusy}
        disabled={pdfBusy || presetBusy || psdBusy || svgBusy || isExporting || archiveBusy !== null}
        status={contactStatus}
        setColumns={setContactColumns}
        setRows={setContactRows}
        setPagePresetId={setContactPagePresetId}
        setShowLabels={setContactShowLabels}
        onExport={() => void runContactSheetExport()}
      />

      {/* 현재 페이지 → 벡터 SVG — 도형·말풍선·텍스트를 벡터로 보존(픽셀 필터·톤 등 일부는 스킵 고지). */}
      {exportCurrentPageToSvg && (
        <>
          <button
            type="button"
            onClick={() => void runSvgExport()}
            onPointerEnter={preloadStudioSvgExportModule}
            onPointerDown={preloadStudioSvgExportModule}
            onFocus={preloadStudioSvgExportModule}
            disabled={
              svgBusy || psdBusy || pdfBusy || presetBusy || isExporting || contactBusy || archiveBusy !== null
            }
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
            title="현재 페이지를 벡터 SVG 파일로 저장 (도형·텍스트·말풍선 벡터 보존)"
          >
            <FileText size={13} /> SVG (벡터, 현재 페이지)
          </button>
          <p
            aria-live="polite"
            className={cx(
              svgStatus ? "mt-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
              svgStatus?.tone === "info" && "border-line bg-card text-fg-3",
              svgStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
              svgStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            {svgStatus?.text}
          </p>
        </>
      )}

      {/* 현재 페이지 → 레이어별 PSD — 요소 하나당 레이어 하나(포토샵에서 개별 편집 가능). */}
      {exportCurrentPageToPsd && (
        <>
          <button
            type="button"
            onClick={() => void runPsdExport()}
            onPointerEnter={preloadStudioPsdExportModule}
            onPointerDown={preloadStudioPsdExportModule}
            onFocus={preloadStudioPsdExportModule}
            disabled={
              psdBusy || svgBusy || pdfBusy || presetBusy || isExporting || contactBusy || archiveBusy !== null
            }
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
            title="현재 페이지를 요소별 레이어를 가진 PSD 파일로 저장 (포토샵에서 레이어별 편집 가능)"
          >
            <Layers size={13} /> PSD (레이어별)
          </button>
          <p
            aria-live="polite"
            className={cx(
              psdStatus ? "mt-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug" : "sr-only",
              psdStatus?.tone === "info" && "border-line bg-card text-fg-3",
              psdStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
              psdStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            {psdStatus?.text}
          </p>
        </>
      )}

      <p className="mt-2 text-[10px] tabular-nums text-fg-3">
        출력 폭 {outW.toLocaleString()}px
        {quality !== undefined ? ` · 품질 ${Math.round(quality * 100)}%` : ""}
      </p>

      {selectedPreset && validation && (
        <div className="mt-2 space-y-1">
          {validation.warnings.map((warning) => (
            <p
              key={warning.code}
              className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-[10px] leading-snug text-warn"
            >
              ⚠ {warning.message}
            </p>
          ))}
          {slices && maxH !== undefined && (
            <p className="rounded-md border border-line bg-card px-2 py-1 text-[10px] leading-snug text-fg-3">
              규격 높이 {maxH.toLocaleString()}px 기준 {slices.length}장으로 나눠 올리는 걸 권장해요.
            </p>
          )}
          {validation.ok && !slices && (
            <p className="rounded-md border border-good/40 bg-good/10 px-2 py-1 text-[10px] leading-snug text-good">
              {selectedPreset.label} 규격에 맞아요.
            </p>
          )}

          {/* 규격 실행 — 규격 폭 리샘플 + 규격 높이 자동 분할을 실제 파일 저장으로. */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => void runPresetSliceExport("current")}
              disabled={
                presetBusy || pdfBusy || psdBusy || svgBusy || isExporting || contactBusy || archiveBusy !== null
              }
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2 text-[0.68rem] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={`현재 페이지를 ${selectedPreset.label} 규격(폭 리샘플·세로 분할)으로 저장`}
            >
              <Scissors size={12} /> 규격으로 저장
            </button>
            {pageCount > 1 && (
              <button
                type="button"
                onClick={() => void runPresetSliceExport("all")}
                disabled={
                  presetBusy || pdfBusy || psdBusy || svgBusy || isExporting || contactBusy || archiveBusy !== null
                }
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                title={`${exportRangeLabel}(${exportRangeCount}장)를 이어 붙여 ${selectedPreset.label} 규격으로 나눠 저장`}
              >
                <Scissors size={12} />{" "}
                {exportRangeIsPartial
                  ? `${exportRangeLabel} · ${exportRangeCount}장`
                  : `전체 ${pageCount}페이지`}
              </button>
            )}
          </div>
          <p
            aria-live="polite"
            className={cx(
              presetStatus
                ? "rounded-md border px-2 py-1 text-[10px] leading-snug"
                : "sr-only",
              presetStatus?.tone === "info" && "border-line bg-card text-fg-3",
              presetStatus?.tone === "good" && "border-good/40 bg-good/10 text-good",
              presetStatus?.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            {presetStatus?.text}
          </p>
        </div>
      )}
    </div>
  );
}
