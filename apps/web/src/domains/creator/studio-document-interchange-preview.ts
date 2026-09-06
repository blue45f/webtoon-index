import {
  STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
  STUDIO_PROJECT_MAX_PAGES,
} from "./studio-project-file";

import type { StudioCbzImportResult } from "./studio-cbz-interchange";
import type {
  StudioInterchangeLossConstraint,
  StudioInterchangeLossPreviewInput,
} from "./studio-interchange-loss-preview";
import type { StudioOpenRasterImportResult } from "./studio-openraster-interchange";
import type {
  PsdImportResult,
  PsdInterchangeFeature,
} from "./studio-psd-import";

export interface StudioDocumentInterchangePreviewOptions {
  readonly canvasWidth: number;
  readonly maxEmbeddedBytes: number;
  readonly currentPageCount?: number;
}

function scaledDimensions(
  width: number,
  height: number,
  canvasWidth: number,
): { width: number; height: number } {
  const scale = Math.min(1, canvasWidth / Math.max(1, width));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function embeddedBudgetConstraint(
  bytes: number,
  maximum: number,
): StudioInterchangeLossConstraint | null {
  if (bytes <= maximum) return null;
  return {
    category: "editability",
    gate: "blocking",
    message: `검증된 이미지 ${Math.ceil(bytes / 1024 / 1024)}MB가 이 기기의 프로젝트 포함 한도 ${Math.round(maximum / 1024 / 1024)}MB를 넘습니다. 파일을 나누거나 이미지를 줄여 주세요.`,
  };
}

function estimateDataUrlStorageBytes(value: unknown): number {
  if (typeof value !== "string") return 0;
  // PSD proxy sources are data URLs already. Their ASCII string length, rather than decoded
  // pixels, is the durable JSON payload that counts against the project budget.
  return value.length;
}

function estimateBlobDataUrlStorageBytes(rawBytes: number, itemCount: number): number {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(rawBytes / 3) * 4 + Math.max(0, itemCount) * 128;
}

function boundedMessages(
  messages: readonly string[],
  category: StudioInterchangeLossConstraint["category"],
  severity: "notice" | "warning" = "warning",
): StudioInterchangeLossConstraint[] {
  const visible = messages.slice(0, 12).map((message) => ({ category, severity, message }) as const);
  if (messages.length > visible.length) {
    visible.push({
      category,
      severity,
      message: `같은 유형의 추가 알림 ${messages.length - visible.length}건은 가져오기 결과에서 확인할 수 있습니다.`,
    });
  }
  return visible;
}

function aggregateCodecWarnings<T extends Readonly<{ code: string; message: string }>>(
  warnings: readonly T[],
  map: (warning: T, count: number) => StudioInterchangeLossConstraint,
): StudioInterchangeLossConstraint[] {
  const groups = new Map<string, { first: T; count: number }>();
  for (const warning of warnings) {
    const current = groups.get(warning.code);
    if (current) current.count += 1;
    else groups.set(warning.code, { first: warning, count: 1 });
  }
  return [...groups.values()].map(({ first, count }) => map(first, count));
}

function withWarningCount(message: string, count: number): string {
  return count > 1 ? `${message} · 같은 유형 ${count.toLocaleString("ko-KR")}건` : message;
}

function canvasHeightConstraint(height: number): StudioInterchangeLossConstraint | null {
  if (height <= STUDIO_PROJECT_MAX_CANVAS_HEIGHT) return null;
  return {
    category: "resolution",
    gate: "blocking",
    message: `적용될 페이지 높이 ${height.toLocaleString("ko-KR")}px가 프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_CANVAS_HEIGHT.toLocaleString("ko-KR")}px를 넘습니다. 원본을 나누거나 축소해 주세요.`,
  };
}

function psdFeatureCategory(
  feature: PsdInterchangeFeature,
): StudioInterchangeLossConstraint["category"] {
  if (feature === "layers" || feature === "groups" || feature === "blend-mode") return "layers";
  if (feature === "resolution") return "resolution";
  if (feature === "layer-mask") return "alpha";
  if (feature === "color-space" || feature === "bit-depth") return "color-space";
  return "editability";
}

export function createStudioPsdImportLossPreview(
  fileName: string,
  result: PsdImportResult,
  options: StudioDocumentInterchangePreviewOptions,
): StudioInterchangeLossPreviewInput {
  const displayed = scaledDimensions(result.sourceWidth, result.sourceHeight, options.canvasWidth);
  const constraints: StudioInterchangeLossConstraint[] =
    result.lossManifest?.decisions
      .filter((decision) => decision.disposition !== "preserved")
      .map((decision) => ({
        category: psdFeatureCategory(decision.feature),
        ...(decision.disposition === "blocked" ? { gate: "blocking" as const } : {}),
        severity: "warning" as const,
        message: decision.alternative
          ? `${decision.message} 대안: ${decision.alternative}`
          : decision.message,
      })) ?? [];
  constraints.push(...boundedMessages(result.skipped, "editability"));
  const embeddedBytes = result.elements.reduce(
    (total, element) =>
      total
      + estimateDataUrlStorageBytes(element.src)
      + estimateDataUrlStorageBytes(element.maskSrc),
    0,
  );
  const budget = embeddedBudgetConstraint(embeddedBytes, options.maxEmbeddedBytes);
  if (budget) constraints.push(budget);
  const height = canvasHeightConstraint(displayed.height);
  if (height) constraints.push(height);
  return {
    format: "psd",
    fileName,
    source: {
      pageCount: 1,
      layerCount: result.elements.length,
      width: result.sourceWidth,
      height: result.sourceHeight,
      alpha: "unknown",
      colorSpace: result.lossManifest
        ? `${result.lossManifest.source.colorMode} ${result.lossManifest.source.bitsPerChannel}bit`
        : "PSD 내장 프로필 또는 미확인",
      editability: "layered",
    },
    result: {
      pageCount: 1,
      layerCount: result.elements.length,
      width: displayed.width,
      height: displayed.height,
      alpha: "present",
      colorSpace: result.lossManifest
        ? `${result.lossManifest.target.colorMode} ${result.lossManifest.target.bitsPerChannel}bit`
        : "sRGB 캔버스",
      editability: "layered",
    },
    proxy: {
      enabled: result.scale < 1 || result.sourceWidth > 1_280 || result.sourceHeight > 1_280,
      format: result.elements.some((element) => element.maskSrc)
        ? "WebP 레이어 + 무손실 PNG 마스크"
        : "WebP 레이어",
      width: displayed.width,
      height: displayed.height,
      originalRetained: false,
    },
    constraints,
  };
}

function openRasterAlpha(result: StudioOpenRasterImportResult) {
  const colorType = result.mergedImageInfo.colorType;
  if (colorType === 4 || colorType === 6) return "present" as const;
  return colorType === 0 || colorType === 2
    ? "opaque" as const
    : "unknown" as const;
}

export function createStudioOpenRasterImportLossPreview(
  fileName: string,
  result: StudioOpenRasterImportResult,
  options: StudioDocumentInterchangePreviewOptions,
): StudioInterchangeLossPreviewInput {
  const displayed = scaledDimensions(result.width, result.height, options.canvasWidth);
  const layerBytes = result.layers.reduce((total, layer) => total + layer.byteLength, 0);
  const embeddedBytes = estimateBlobDataUrlStorageBytes(layerBytes, result.layers.length);
  const constraints = aggregateCodecWarnings(result.warnings, (warning, count) => ({
    category: warning.code === "GROUPS_FLATTENED"
      ? "layers"
      : warning.code === "PREVIEW_DIMENSION_MISMATCH"
        ? "resolution"
        : warning.code === "MASKS_IGNORED"
          ? "alpha"
          : "editability",
    severity: warning.code === "UNSUPPORTED_XML_ATTRIBUTE" || warning.code === "UNSUPPORTED_XML_ELEMENT"
      ? "notice"
      : "warning",
    message: withWarningCount(warning.message, count),
  }));
  const budget = embeddedBudgetConstraint(embeddedBytes, options.maxEmbeddedBytes);
  if (budget) constraints.push(budget);
  if (
    result.groups.some((group) => group.depth > 1) &&
    !result.warnings.some((warning) => warning.code === "GROUPS_FLATTENED")
  ) {
    constraints.push({
      category: "layers",
      severity: "warning",
      message: "중첩 ORA 그룹은 시각적 불투명도와 표시 상태를 유지하면서 ‘상위 / 하위’ 이름의 단일 Studio 그룹으로 평탄화됩니다.",
    });
  }
  if (result.groups.some((group) => group.opacity < 1 || group.blendMode !== "normal")) {
    constraints.push({
      category: "layers",
      severity: "warning",
      message: "그룹 단위 opacity·blend 합성은 자식 레이어의 유효 값으로 근사됩니다. 겹치는 반투명 자식의 픽셀 결과는 원본과 달라질 수 있습니다.",
    });
  }
  const height = canvasHeightConstraint(displayed.height);
  if (height) constraints.push(height);
  return {
    format: "ora",
    fileName,
    source: {
      pageCount: 1,
      layerCount: result.layers.length,
      width: result.width,
      height: result.height,
      alpha: openRasterAlpha(result),
      colorSpace: "PNG 내장 프로필 또는 sRGB",
      editability: "layered",
    },
    result: {
      pageCount: 1,
      layerCount: result.layers.length,
      width: displayed.width,
      height: displayed.height,
      alpha: openRasterAlpha(result),
      colorSpace: "sRGB 캔버스",
      editability: "layered",
    },
    proxy: {
      enabled: false,
      originalRetained: true,
    },
    constraints,
  };
}

export function createStudioCbzImportLossPreview(
  fileName: string,
  result: StudioCbzImportResult,
  options: StudioDocumentInterchangePreviewOptions,
): StudioInterchangeLossPreviewInput {
  const representativePage = result.pages.reduce(
    (largest, page) => (
      page.width * page.height > largest.width * largest.height ? page : largest
    ),
    result.pages[0]!,
  );
  const sourceWidth = representativePage.width;
  const sourceHeight = representativePage.height;
  const displayed = scaledDimensions(sourceWidth, sourceHeight, options.canvasWidth);
  const constraints = aggregateCodecWarnings(result.warnings, (warning, count) => ({
    category: warning.code === "COMICINFO_MISSING" ? "editability" : "pages",
    severity: warning.code === "PAGE_COUNT_MISMATCH" ? "warning" : "notice",
    message: withWarningCount(warning.message, count),
  }));
  const embeddedBytes = estimateBlobDataUrlStorageBytes(
    result.summary.totalEncodedBytes,
    result.pages.length,
  );
  const budget = embeddedBudgetConstraint(embeddedBytes, options.maxEmbeddedBytes);
  if (budget) constraints.push(budget);
  const currentPageCount = options.currentPageCount ?? 0;
  if (
    !Number.isSafeInteger(currentPageCount) ||
    currentPageCount < 0 ||
    result.pages.length > STUDIO_PROJECT_MAX_PAGES ||
    currentPageCount > STUDIO_PROJECT_MAX_PAGES - result.pages.length
  ) {
    constraints.push({
      category: "pages",
      gate: "blocking",
      message: `현재 ${Number.isSafeInteger(currentPageCount) && currentPageCount >= 0 ? currentPageCount.toLocaleString("ko-KR") : "확인 불가"}페이지에 CBZ ${result.pages.length.toLocaleString("ko-KR")}페이지를 더하면 프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES.toLocaleString("ko-KR")}페이지를 넘습니다. 파일을 나누거나 기존 페이지를 정리해 주세요.`,
    });
  }
  const maximumAppliedHeight = Math.max(
    ...result.pages.map((page) => (
      scaledDimensions(page.width, page.height, options.canvasWidth).height
    )),
  );
  const height = canvasHeightConstraint(maximumAppliedHeight);
  if (height) constraints.push(height);
  const minWidth = Math.min(...result.pages.map((page) => page.width));
  const minHeight = Math.min(...result.pages.map((page) => page.height));
  if (
    minWidth !== result.summary.maxWidth ||
    minHeight !== result.summary.maxHeight
  ) {
    constraints.push({
      category: "resolution",
      severity: "notice",
      message: `대표 페이지 ${sourceWidth.toLocaleString("ko-KR")}×${sourceHeight.toLocaleString("ko-KR")}px로 비교합니다. 전체 범위는 너비 ${minWidth.toLocaleString("ko-KR")}–${result.summary.maxWidth.toLocaleString("ko-KR")}px, 높이 ${minHeight.toLocaleString("ko-KR")}–${result.summary.maxHeight.toLocaleString("ko-KR")}px입니다.`,
    });
  }
  if (displayed.width !== sourceWidth || displayed.height !== sourceHeight) {
    constraints.push({
      category: "resolution",
      severity: "notice",
      message: `원본 픽셀은 보관하지만 ${options.canvasWidth.toLocaleString("ko-KR")}px Studio 페이지 폭에 맞춰 표시 크기를 조정합니다.`,
    });
  }
  return {
    format: "cbz",
    fileName,
    source: {
      pageCount: result.pages.length,
      layerCount: null,
      width: sourceWidth,
      height: sourceHeight,
      alpha: "unknown",
      colorSpace: "페이지 이미지 내장 프로필 또는 미확인",
      editability: "page-images",
    },
    result: {
      pageCount: result.pages.length,
      layerCount: null,
      width: displayed.width,
      height: displayed.height,
      alpha: "unknown",
      colorSpace: "sRGB 캔버스",
      editability: "page-images",
    },
    proxy: {
      enabled: false,
      originalRetained: true,
    },
    constraints,
  };
}
