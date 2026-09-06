/**
 * Studio PSD Layer Export — 레이어별 PSD(.psd) 내보내기.
 *
 * 래스터 내보내기(studio-export, png/jpg/webp)는 스테이지를 한 장으로 평탄화하고,
 * SVG 내보내기(studio-svg-export)는 요소를 벡터로 재직렬화한다. 이 모듈은 그 중간 —
 * "포토샵에서 요소별로 다시 만질 수 있는" 결과가 목표라, 각 요소를 Konva 가 실제로 그린
 * 픽셀 그대로 **개별 래스터 레이어**로 캡처해 ag-psd 로 조립한다. 일반 가로쓰기 TextEl은
 * 같은 레이어에 ag-psd `Layer.text` descriptor도 함께 기록해 단방향 편집성을 제공한다.
 * 래스터 프리뷰는 항상 유지하므로 Photoshop이 텍스트 엔진 데이터를 다시 그리기 전에도 현재
 * 화면이 보존된다. 회전·세로쓰기·곡선·그라데이션·효과·미지원 글꼴은 descriptor를 쓰지 않고
 * 기존 래스터 경로를 유지하며 `skipped`에 정확한 손실 사유를 남긴다.
 *
 * 좌표계 규약(중요): 캡처는 Stage 의 **현재 화면 줌**(effScale)과 무관해야 한다 — 그렇지
 * 않으면 사용자가 줌인/줌아웃한 상태에서 내보내기 결과가 매번 달라진다.
 *  - `node.getClientRect({ relativeTo: stage })` 로 줌·팬에이 반영되지 않은 문서 좌표를 얻어
 *    레이어의 left/top 을 정한다.
 *  - `pixelRatio: scale / effScale` 로 Stage 자체 스케일(현재 줌)을 상쇄해, 항상 논리적
 *    "출력 배율(scale)" 기준 픽셀 크기가 나오게 한다(기존 PNG 내보내기와 동일한 트릭).
 *
 * z-order 규약: Studio 는 `elements[0]`=맨 뒤 → `elements[last]`=맨 앞(z-order 오름차순)이지만
 * ag-psd 의 `Psd.children` 은 그 반대(0번째=포토샵 레이어 패널의 맨 위) — 뒤집어 넣지 않으면
 * 스택 순서가 통째로 반전된다.
 *
 * 회전: PSD 클래식 레이어엔 회전 필드가 없다. `toCanvas()` 는 노드의 절대(회전 포함) 변환으로
 * 그리므로 회전된 요소도 이미 "회전이 픽셀에 구워진" 래스터로 캡처된다 — 별도 처리가 필요 없다
 * (다만 포토샵에서 회전 값 자체를 다시 되돌릴 순 없다).
 *
 * 숨김 레이어: `isEffectivelyHidden` 인 요소는 렌더 시점에 Konva 노드 자체가 만들어지지 않는다
 * (StudioPage 렌더 루프가 `return null`) — 캡처할 대상이 없으므로 **호출부가 이미 걸러서** 넘긴
 * `elements` 를 받는다는 게 이 모듈의 전제다(studio-svg-export/studio-page-thumbs 와 같은
 * skip-hidden 관례). "숨겼지만 PSD엔 포함"은 화면에 없는 걸 다시 그려야 해 v1 범위 밖이다.
 *
 * 그 외 재현 불가/근사 항목은 SVG 내보내기와 같은 정직성 규약으로 `skipped` 문자열 목록에
 * 모아 반환한다(콜러가 사용자에게 고지).
 */

import {
  writePsd,
  type BlendMode,
  type Color,
  type Layer,
  type LayerTextData,
  type Psd,
} from "ag-psd";

import {
  buildDialogueRubyExportXmp,
  createDialogueRubyMetadataRecord,
  planDialogueRubyPdfOps,
  type DialogueRubyExportIssue,
  type DialogueRubyExportWarning,
  type DialogueRubyExportMetadataRecord,
} from "../lettering/studio-dialogue-ruby-export";
import { readStudioExportResolutionDpi } from "../render/studio-raster-resolution-metadata";

import type {
  PsdInterchangeLossDecision,
  PsdInterchangeLossManifest,
  PsdInterchangeProfile,
} from "../studio-psd-import";
import type Konva from "konva";

// ---------------------------------------------------------------------------
// 요소 구조 타입 — StudioPage 의 El 유니온과 구조 호환(필요한 필드만). studio-svg-export.ts 와
// 같은 순수 모듈 규약 — StudioPage 를 임포트하지 않고 구조 타이핑으로 받는다.
// ---------------------------------------------------------------------------

/** 모든 요소가 공유하는 레이어 메타(El 인터섹션과 동일 필드 중 이 모듈이 쓰는 것만). */
interface PsdElMeta {
  id: string;
  name?: string;
  opacity?: number;
  blendMode?: string;
  clipBelow?: boolean;
  noClip?: boolean;
  groupId?: string;
  maskSrc?: string;
  filterMaskSrc?: string;
  smartFilters?: { entries?: readonly unknown[] };
  bg3dScene?: unknown;
  vrmScene?: unknown;
}

export interface PsdImageElLike extends PsdElMeta {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PsdBubbleElLike extends PsdElMeta {
  type: "bubble";
  x: number;
  y: number;
  width: number;
  height: number;
  // 말풍선은 <Group> 자체에 그림자가 걸린다(Container.getClientRect 는 자식 bbox만 합쳐
  // 컨테이너 자신의 그림자를 패딩하지 않음) — 캡처 사각형을 수동으로 넓힐 때만 쓴다.
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface PsdTextElLike extends PsdElMeta {
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fill: string;
  rotation: number;
  font?: string;
  stroke?: string;
  strokeWidth?: number;
  letterSpacing?: number;
  lineHeight?: number;
  vertical?: boolean;
  align?: "left" | "center" | "right";
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  fillType?: "solid" | "gradient";
  gradientColorStart?: string;
  gradientColorEnd?: string;
  gradientDirection?: "vertical" | "horizontal";
  gradient?: unknown;
  textPath?: { shape?: string } | null;
  skewX?: number;
  skewY?: number;
  /** 런타임은 dialogue ruby를 구조 타이핑으로 허용한다. PSD v1은 rich runs로 승격하지 않는다. */
  rubySpans?: unknown;
}

export interface PsdStickerElLike extends PsdElMeta {
  type: "sticker";
  x: number;
  y: number;
  fontSize: number;
}

export interface PsdDrawElLike extends PsdElMeta {
  type: "draw";
  points: number[];
}

export interface PsdFrameElLike extends PsdElMeta {
  type: "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  hidden?: boolean;
}

export interface PsdFocusLinesElLike extends PsdElMeta {
  type: "focusLines";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PsdSpeedLinesElLike extends PsdElMeta {
  type: "speedLines";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** StudioPage El 유니온과 구조 호환하는 내보내기 입력 요소. */
export type PsdExportEl =
  | PsdImageElLike
  | PsdTextElLike
  | PsdBubbleElLike
  | PsdFrameElLike
  | PsdStickerElLike
  | PsdDrawElLike
  | PsdFocusLinesElLike
  | PsdSpeedLinesElLike;

// ---------------------------------------------------------------------------
// 입출력 타입
// ---------------------------------------------------------------------------

export interface PsdExportOptions {
  /** 출력 배율 — 래스터 크기·left/top 좌표에 곱한다. 기본 1(캔버스 원본 크기). */
  scale?: number;
  /** 배경(단색/그라데이션) 레이어를 맨 아래에 추가할지. `background` 가 없으면 무의미. 기본 true. */
  includeBackground?: boolean;
  /** 페이지 배경 — StudioPage 의 bg/bgGrad 를 그대로 전달(모듈 스스로는 페이지 상태를 모름). */
  background?: { color: string; gradient?: string[] | null };
  /**
   * 제품이 검증한 컨테이너는 PSD뿐이다. `"psb"`는 호출자가 지원 여부를 추측하지 않도록
   * 런타임에서 명시적으로 fail-closed하는 사전검사 용도다.
   */
  container?: "psd" | "psb";
}

export interface PsdExportResult {
  /** 완성된 .psd 파일(다운로드용 Blob, MIME=PSD_EXPORT_MIME). */
  blob: Blob;
  /** 재현 불가/근사·건너뜀 안내(비어 있으면 전부 온전히 레이어로 캡처됨). */
  skipped: string[];
  /** 실제로 PSD 레이어가 된 요소 수(배경 레이어 제외). */
  layerCount: number;
  /** 기능별 보존/래스터화/제외를 기계적으로 읽을 수 있는 왕복 손실 명세. */
  lossManifest?: PsdInterchangeLossManifest;
  /** Native PSD ruby is unavailable: visible raster + lossless XMP source preservation receipt. */
  rubyReceipts: readonly PsdRubyExportReceipt[];
}

export interface PsdRubyExportReceipt {
  readonly elementId: string;
  readonly layerName: string;
  readonly writingMode: "horizontal-tb" | "vertical-rl";
  readonly appearance: "visible-raster-layer";
  readonly editability: "source-metadata-only";
  readonly metadata: "document-xmp-v1" | "unavailable";
  readonly placementCount: number;
  readonly tateChuYokoBaseCount: number;
  readonly warnings: readonly DialogueRubyExportWarning[];
  readonly unsupported: readonly DialogueRubyExportIssue[];
}

/** 콜러가 Blob 생성·다운로드에 쓸 MIME 타입. */
export const PSD_EXPORT_MIME = "image/vnd.adobe.photoshop";
export const PSD_EXPORT_MAX_FILE_BYTES = 128 * 1024 * 1024;
export const PSD_EXPORT_MAX_DECODED_BYTES = 128 * 1024 * 1024;
export const PSD_EXPORT_MAX_DIMENSION_PX = 30_000;
export const PSD_EXPORT_MAX_CANVAS_PIXELS = 32 * 1024 * 1024;
export const PSD_EXPORT_MAX_LAYERS = 4_096;

const PSD_EXPORT_ALTERNATIVES = Object.freeze([
  "대형 문서는 페이지를 나누거나 출력 배율을 낮춰 PSD로 저장",
  "레이어 교환은 OpenRaster(.ora), 완성 픽셀은 PNG로 저장",
] as const);

export interface PsdExportPreflight {
  readonly canExport: boolean;
  readonly blockingReasons: readonly string[];
  readonly lossManifest: PsdInterchangeLossManifest;
}

function exportProfile(
  container: PsdInterchangeProfile["container"],
  width: number,
  height: number,
  channels: number,
  bitsPerChannel: number,
  colorMode: string,
): PsdInterchangeProfile {
  return { container, width, height, channels, bitsPerChannel, colorMode };
}

function exportDecision(
  feature: PsdInterchangeLossDecision["feature"],
  disposition: PsdInterchangeLossDecision["disposition"],
  count: number,
  message: string,
  alternative?: string,
): PsdInterchangeLossDecision {
  return alternative
    ? { feature, disposition, count, message, alternative }
    : { feature, disposition, count, message };
}

/** 캡처/압축을 시작하기 전에 컨테이너·크기·레이어·최소 RGBA 메모리 예산을 검증한다. */
export function preflightPsdExport(input: {
  readonly canvasW: number;
  readonly canvasH: number;
  readonly scale?: number;
  readonly layerCount: number;
  readonly container?: "psd" | "psb";
}): PsdExportPreflight {
  const scale = input.scale && input.scale > 0 ? input.scale : 1;
  const width = Math.round(input.canvasW * scale);
  const height = Math.round(input.canvasH * scale);
  const container = input.container ?? "psd";
  const blockingReasons: string[] = [];
  const decisions: PsdInterchangeLossDecision[] = [
    exportDecision("bit-depth", "preserved", 1, "Studio 8-bit/channel 픽셀을 PSD 8-bit/channel로 기록합니다."),
    exportDecision("color-space", "preserved", 1, "Studio sRGB 픽셀을 PSD RGB 8-bit로 기록합니다."),
  ];
  if (container === "psb") {
    blockingReasons.push("PSB 내보내기는 대형 문서 메모리·왕복 검증이 끝나지 않아 제공하지 않습니다.");
    decisions.push(exportDecision(
      "layers",
      "blocked",
      1,
      "ag-psd의 PSB 코드가 존재하더라도 제품 지원으로 간주하지 않고 PSD만 출력합니다.",
      PSD_EXPORT_ALTERNATIVES[0],
    ));
  }
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
  ) {
    blockingReasons.push("PSD 출력 캔버스 크기와 배율은 유한한 양의 정수 픽셀이어야 합니다.");
  } else {
    if (width > PSD_EXPORT_MAX_DIMENSION_PX || height > PSD_EXPORT_MAX_DIMENSION_PX) {
      blockingReasons.push(
        `PSD 출력 ${width.toLocaleString("ko-KR")}×${height.toLocaleString("ko-KR")}px가 안전 한 변 ${PSD_EXPORT_MAX_DIMENSION_PX.toLocaleString("ko-KR")}px를 넘습니다.`,
      );
      decisions.push(exportDecision(
        "resolution",
        "blocked",
        1,
        "PSD v1/브라우저 캔버스 안전 크기를 넘는 출력은 캡처 전에 차단합니다.",
        PSD_EXPORT_ALTERNATIVES[0],
      ));
    }
    if (width * height > PSD_EXPORT_MAX_CANVAS_PIXELS) {
      blockingReasons.push(
        `PSD 최소 합성 픽셀 ${Math.ceil(width * height / 1_000_000).toLocaleString("ko-KR")}MP가 브라우저 예산 ${Math.floor(PSD_EXPORT_MAX_CANVAS_PIXELS / 1_000_000)}MP를 넘습니다.`,
      );
      decisions.push(exportDecision(
        "resolution",
        "blocked",
        1,
        "최소 RGBA 합성 버퍼가 128MiB를 넘는 출력은 메모리 할당 전에 차단합니다.",
        PSD_EXPORT_ALTERNATIVES[0],
      ));
    }
  }
  if (!Number.isSafeInteger(input.layerCount) || input.layerCount < 0) {
    blockingReasons.push("PSD 레이어 수가 올바르지 않습니다.");
  } else if (input.layerCount > PSD_EXPORT_MAX_LAYERS) {
    blockingReasons.push(
      `PSD 레이어 ${input.layerCount.toLocaleString("ko-KR")}개가 안전 예산 ${PSD_EXPORT_MAX_LAYERS.toLocaleString("ko-KR")}개를 넘습니다.`,
    );
  }
  return {
    canExport: blockingReasons.length === 0,
    blockingReasons,
    lossManifest: {
      direction: "export",
      source: exportProfile("studio", Math.max(1, width), Math.max(1, height), 4, 8, "sRGB"),
      target: exportProfile(container, Math.max(1, width), Math.max(1, height), 4, 8, "RGB"),
      decisions,
      budgets: {
        maxFileBytes: PSD_EXPORT_MAX_FILE_BYTES,
        maxDecodedBytes: PSD_EXPORT_MAX_DECODED_BYTES,
        maxDimensionPx: PSD_EXPORT_MAX_DIMENSION_PX,
      },
      alternatives: PSD_EXPORT_ALTERNATIVES,
    },
  };
}

function assertPsdOutputBudget(buffer: ArrayBuffer): void {
  if (buffer.byteLength > PSD_EXPORT_MAX_FILE_BYTES) {
    throw new Error(
      `PSD 결과 ${Math.ceil(buffer.byteLength / 1024 / 1024)}MB가 출력 한도 ${PSD_EXPORT_MAX_FILE_BYTES / 1024 / 1024}MB를 넘습니다. ${PSD_EXPORT_ALTERNATIVES.join(" 또는 ")}해 주세요.`,
    );
  }
}

/** 단일 페이지 PSD 파일명 — 다른 내보내기 형식(svgExportFileName 등)과 같은 제목 규칙. */
export function psdExportFileName(title: string): string {
  return `${title.trim() || "toonspectrum-comic"}.psd`;
}

/** 내보내기 결과 요약 문구(패널 상태 배너용) — svgExportResultMessage 와 같은 톤. */
export function psdExportResultMessage(result: PsdExportResult): string {
  const parts = [`PSD 저장 완료 — 레이어 ${result.layerCount}개`];
  if (result.skipped.length > 0) parts.push(`알림 ${result.skipped.length}건`);
  const rasterized = result.lossManifest?.decisions
    .filter((decision) => decision.disposition === "rasterized")
    .reduce((total, decision) => total + decision.count, 0) ?? 0;
  const dropped = result.lossManifest?.decisions
    .filter((decision) => decision.disposition === "dropped")
    .reduce((total, decision) => total + decision.count, 0) ?? 0;
  if (rasterized > 0) parts.push(`래스터화 ${rasterized}건`);
  if (dropped > 0) parts.push(`편집 구조 제외 ${dropped}건`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// blendMode 매핑 — Studio 는 CSS/Canvas globalCompositeOperation 값을 그대로 쓰고,
// ag-psd 는 스페이스로 구분된 포토샵 이름을 쓴다(StudioPage.tsx 의 blendMode <select> 옵션 기준).
// ---------------------------------------------------------------------------

const BLEND_MODE_MAP: Record<string, BlendMode> = {
  "source-over": "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color dodge",
  "color-burn": "color burn",
  "hard-light": "hard light",
  "soft-light": "soft light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

/**
 * PSD ResolutionInfo(8BIM 1005) — Photoshop·인쇄 워크플로가 PSD를 물리 크기로 배치할 때 읽는
 * 유일한 해상도 태그다. 없으면 72PPI로 열린다. 내보내기 옵션이 해상도를 게시했을 때만 기록해,
 * 지오메트리를 정하지 않은 문서의 출력 바이트는 그대로 둔다.
 */
function publishedPsdResolutionInfo(): Pick<Psd, "imageResources"> {
  const dpi = readStudioExportResolutionDpi();
  if (dpi == null) return {};
  return {
    imageResources: {
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: "PPI",
        widthUnit: "Inches",
        verticalResolution: dpi,
        verticalResolutionUnit: "PPI",
        heightUnit: "Inches",
      },
    },
  };
}

function mapBlendMode(mode: string | undefined): BlendMode {
  if (!mode) return "normal";
  return BLEND_MODE_MAP[mode] ?? "normal";
}

/** opacity 는 Studio·ag-psd 둘 다 0~1 실수라 직접 대응(범위만 방어적으로 clamp). */
function clampOpacity(opacity: number | undefined): number {
  if (opacity === undefined || Number.isNaN(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

// ---------------------------------------------------------------------------
// 편집 가능한 PSD 텍스트 — ag-psd 31.x가 안정적으로 기록하는 bounded horizontal subset.
// ---------------------------------------------------------------------------

/** Photoshop 문자 패널이 허용하는 글자 크기의 상한. 그 이상은 안전하게 래스터 폴백한다. */
export const PSD_EDITABLE_TEXT_MAX_FONT_SIZE = 1_296;

/**
 * Studio가 제공하는 큐레이션 글꼴 중 PostScript full name을 확정할 수 있는 목록.
 * 사용자 업로드/임의 CSS family를 추측해 기록하면 Photoshop이 다른 글꼴로 자동 대체하면서
 * 줄바꿈과 위치가 달라지므로, 목록 밖 글꼴은 현재 래스터 프리뷰를 유지한다.
 */
const PSD_EDITABLE_TEXT_FONT_NAMES: Readonly<Record<string, string>> = {
  arial: "ArialMT",
  "arial mt": "ArialMT",
  "black and white picture": "BlackAndWhitePicture-Regular",
  "black han sans": "BlackHanSans-Regular",
  "courier new": "CourierNewPSMT",
  "cute font": "CuteFont-Regular",
  "do hyeon": "DoHyeon-Regular",
  dokdo: "Dokdo-Regular",
  "east sea dokdo": "EastSeaDokdo-Regular",
  gaegu: "Gaegu-Regular",
  "gamja flower": "GamjaFlower-Regular",
  "gowun batang": "GowunBatang-Regular",
  "gowun dodum": "GowunDodum-Regular",
  gugi: "Gugi-Regular",
  helvetica: "Helvetica",
  "hi melody": "HiMelody-Regular",
  "ibm plex sans kr": "IBMPlexSansKR-Regular",
  jua: "Jua-Regular",
  "kirang haerang": "KirangHaerang-Regular",
  "nanum brush script": "NanumBrushScript-Regular",
  "nanum gothic": "NanumGothic",
  "nanum myeongjo": "NanumMyeongjo",
  "nanum pen script": "NanumPenScript-Regular",
  "noto sans kr": "NotoSansKR-Regular",
  "noto serif kr": "NotoSerifKR-Regular",
  "poor story": "PoorStory-Regular",
  pretendard: "Pretendard-Regular",
  "single day": "SingleDay-Regular",
  "song myung": "SongMyung-Regular",
  stylish: "Stylish-Regular",
  sunflower: "Sunflower-Medium",
  "times new roman": "TimesNewRomanPSMT",
  "yeon sung": "YeonSung-Regular",
};

export interface PsdEditableTextDescriptorMetrics {
  /** 텍스트 노드의 문서 좌표 bbox. 화면 줌은 제거된 값이다. */
  documentX: number;
  documentY: number;
  documentHeight: number;
  /** PSD 출력 배율. font/transform/box bounds에 동일하게 적용한다. */
  scale: number;
  /** 패널 경계 때문에 캡처 비트맵이 실제로 잘렸다면 editable 재렌더가 경계를 벗어날 수 있다. */
  panelClipped?: boolean;
}

export interface PsdEditableTextDescriptorPlan {
  /** null이면 동일 레이어의 래스터 프리뷰만 기록한다. */
  text: LayerTextData | null;
  /** 사용자에게 보여 줄 구체적인 래스터 폴백 사유. */
  fallbackReasons: string[];
}

function firstCssFontFamily(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").trim();
}

function resolvePsdEditableTextFont(value: string | undefined): { family: string; postScriptName: string } | null {
  const family = firstCssFontFamily(value ?? "Pretendard, sans-serif");
  const postScriptName = PSD_EDITABLE_TEXT_FONT_NAMES[family.toLowerCase()];
  return postScriptName ? { family, postScriptName } : null;
}

function parsePsdSolidTextColor(value: string): Color | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value.trim());
  const compact = match?.[1];
  if (!compact) return null;
  const hex = compact.length <= 4
    ? compact.split("").map((channel) => `${channel}${channel}`).join("")
    : compact;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return hex.length === 8
    ? { r, g, b, a: Number.parseInt(hex.slice(6, 8), 16) }
    : { r, g, b };
}

function hasActiveTextShadow(el: PsdTextElLike): boolean {
  return !!el.shadowColor && (el.shadowOpacity ?? 0) > 0;
}

function hasRichTextRuns(el: PsdTextElLike): boolean {
  return Array.isArray(el.rubySpans) ? el.rubySpans.length > 0 : el.rubySpans != null;
}

function planPsdRubyReceipt(
  el: PsdTextElLike,
  layerName: string,
): { receipt: PsdRubyExportReceipt; metadata: DialogueRubyExportMetadataRecord | null } | null {
  if (!hasRichTextRuns(el)) return null;
  const plan = planDialogueRubyPdfOps({
    elementId: el.id,
    layerName,
    text: el.text,
    rubySpans: el.rubySpans,
    vertical: el.vertical,
    width: el.width,
    fontSize: el.fontSize,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    fontFamily: el.font,
    fontStyle: el.fontStyle,
    align: el.align,
  }, {
    // No PDF is built here. The shared lowering is used only to reuse the exact product planners
    // and produce a placement/issue receipt for the PSD raster+metadata path.
    fontResourceName: "PSD-RUBY-RECEIPT",
    color: { space: "gray", gray: 0 },
    pxToPt: 1,
  });
  let metadata: DialogueRubyExportMetadataRecord | null = null;
  const warnings: DialogueRubyExportWarning[] = [
    ...plan.warnings.filter((warning) => warning.code !== "pdf-vertical-glyph-overlays"),
    {
      code: "psd-ruby-raster-fallback",
      message: "ag-psd has no native editable ruby structure; appearance stays in the raster layer and source spans stay in XMP.",
      spanIndex: null,
    },
  ];
  const unsupported = [...plan.unsupported];
  try {
    metadata = createDialogueRubyMetadataRecord({
      elementId: el.id,
      layerName,
      text: el.text,
      rubySpans: el.rubySpans,
      vertical: el.vertical,
      width: el.width,
      fontSize: el.fontSize,
      lineHeight: el.lineHeight,
      letterSpacing: el.letterSpacing,
      fontFamily: el.font,
      fontStyle: el.fontStyle,
      align: el.align,
    }, "visible-raster-metadata-psd");
  } catch (error) {
    const issue: DialogueRubyExportIssue = {
      code: "metadata-not-json-compatible",
      message: error instanceof Error ? error.message : String(error),
      spanIndex: null,
    };
    if (!unsupported.some((entry) => entry.code === issue.code && entry.message === issue.message)) {
      unsupported.push(issue);
    }
  }
  if (metadata) {
    try {
      // Validate JSON compatibility per record now so one malformed extension value cannot prevent
      // every other annotation from being serialized at the document boundary.
      buildDialogueRubyExportXmp([metadata]);
    } catch (error) {
      unsupported.push({
        code: "metadata-not-json-compatible",
        message: error instanceof Error ? error.message : String(error),
        spanIndex: null,
      });
      metadata = null;
    }
  }
  return {
    receipt: Object.freeze({
      elementId: el.id,
      layerName,
      writingMode: el.vertical ? "vertical-rl" : "horizontal-tb",
      appearance: "visible-raster-layer",
      editability: "source-metadata-only",
      metadata: metadata ? "document-xmp-v1" : "unavailable",
      placementCount: plan.rubyOps.length,
      tateChuYokoBaseCount: plan.baseOps.filter(
        (op) => op.op === "text" && op.matrix?.[0] !== undefined && op.matrix[0] > 0 && op.matrix[0] < 1,
      ).length,
      warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
      unsupported: Object.freeze(unsupported.map((issue) => Object.freeze(issue))),
    }),
    metadata,
  };
}

/**
 * 일반 가로쓰기 TextEl을 ag-psd `LayerTextData`로 승격한다.
 *
 * 이 함수는 eligibility와 descriptor 생성을 함께 수행해 “지원하지 않는 속성을 조용히
 * 버리는” 경로를 없앤다. null이면 호출부는 이미 만든 Konva 래스터 레이어를 그대로 사용한다.
 */
export function planPsdEditableTextDescriptor(
  el: PsdTextElLike,
  metrics: PsdEditableTextDescriptorMetrics,
): PsdEditableTextDescriptorPlan {
  const fallbackReasons: string[] = [];
  const rotation = Number(el.rotation);
  if (!Number.isFinite(rotation) || Math.abs(rotation) > 1e-6) fallbackReasons.push("회전");
  if (el.vertical) fallbackReasons.push("세로쓰기");
  if (el.textPath && el.textPath.shape !== "none") fallbackReasons.push("곡선 텍스트");
  if (el.fillType === "gradient") fallbackReasons.push("그라데이션 채우기");
  if (el.stroke && (el.strokeWidth ?? 0) > 0) fallbackReasons.push("외곽선 효과");
  if (hasActiveTextShadow(el)) fallbackReasons.push("그림자 효과");
  if ((el.skewX ?? 0) !== 0 || (el.skewY ?? 0) !== 0) fallbackReasons.push("기울이기 효과");
  if (hasRichTextRuns(el)) fallbackReasons.push("루비/리치 텍스트");
  if (metrics.panelClipped) fallbackReasons.push("패널 경계 클리핑");

  const font = resolvePsdEditableTextFont(el.font);
  if (!font) {
    const family = firstCssFontFamily(el.font ?? "Pretendard, sans-serif") || "(빈 글꼴)";
    fallbackReasons.push(`지원하지 않는 글꼴(${family})`);
  }

  const scaledFontSize = el.fontSize * metrics.scale;
  if (
    !Number.isFinite(scaledFontSize)
    || scaledFontSize <= 0
    || scaledFontSize > PSD_EDITABLE_TEXT_MAX_FONT_SIZE
  ) {
    fallbackReasons.push(`지원하지 않는 글자 크기(${String(scaledFontSize)}px)`);
  }

  const fillColor = parsePsdSolidTextColor(el.fill);
  if (!fillColor) fallbackReasons.push(`지원하지 않는 단색(${el.fill})`);

  const align = el.align ?? "left";
  if (align !== "left" && align !== "center" && align !== "right") {
    fallbackReasons.push(`지원하지 않는 정렬(${String(align)})`);
  }

  const fontStyle = el.fontStyle ?? "bold";
  if (
    fontStyle !== "normal"
    && fontStyle !== "bold"
    && fontStyle !== "italic"
    && fontStyle !== "bold italic"
  ) {
    fallbackReasons.push(`지원하지 않는 글꼴 스타일(${String(fontStyle)})`);
  }

  const lineHeight = el.lineHeight ?? 1;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    fallbackReasons.push(`지원하지 않는 행간(${String(lineHeight)})`);
  }
  const letterSpacing = el.letterSpacing ?? 0;
  if (!Number.isFinite(letterSpacing)) {
    fallbackReasons.push(`지원하지 않는 자간(${String(letterSpacing)})`);
  }

  const boxWidth = el.width * metrics.scale;
  const boxHeight = metrics.documentHeight * metrics.scale;
  const transformX = metrics.documentX * metrics.scale;
  const transformY = metrics.documentY * metrics.scale;
  if (
    typeof el.text !== "string"
    || !Number.isFinite(boxWidth)
    || boxWidth <= 0
    || !Number.isFinite(boxHeight)
    || boxHeight <= 0
    || !Number.isFinite(transformX)
    || !Number.isFinite(transformY)
    || !Number.isFinite(metrics.scale)
    || metrics.scale <= 0
  ) {
    fallbackReasons.push("유효하지 않은 텍스트 상자 좌표/크기");
  }

  if (fallbackReasons.length > 0 || !font || !fillColor) {
    return { text: null, fallbackReasons };
  }

  const bold = fontStyle === "bold" || fontStyle === "bold italic";
  const italic = fontStyle === "italic" || fontStyle === "bold italic";
  return {
    text: {
      text: el.text,
      transform: [1, 0, 0, 1, transformX, transformY],
      left: 0,
      top: 0,
      right: boxWidth,
      bottom: boxHeight,
      orientation: "horizontal",
      antiAlias: "smooth",
      shapeType: "box",
      boxBounds: [0, 0, boxWidth, boxHeight],
      warp: { style: "none", rotate: "horizontal" },
      style: {
        font: { name: font.postScriptName },
        fontSize: scaledFontSize,
        fillColor,
        fillFlag: true,
        strokeFlag: false,
        fauxBold: bold,
        fauxItalic: italic,
        autoLeading: false,
        leading: scaledFontSize * lineHeight,
        tracking: scaledFontSize > 0 ? (letterSpacing * metrics.scale / scaledFontSize) * 1_000 : 0,
      },
      paragraphStyle: { justification: align },
      useFractionalGlyphWidths: true,
    },
    fallbackReasons: [],
  };
}

// ---------------------------------------------------------------------------
// 레이어 이름 — name 필드가 있으면 그대로, 없으면 "타입 + 순번"(과제 스펙의 sensible fallback).
// ---------------------------------------------------------------------------

const EL_TYPE_LABELS: Record<PsdExportEl["type"], string> = {
  image: "이미지",
  text: "텍스트",
  bubble: "말풍선",
  frame: "패널",
  sticker: "스티커",
  draw: "그림",
  focusLines: "집중선",
  speedLines: "속도선",
};

function elementLabel(el: PsdExportEl, index: number): string {
  const trimmed = el.name?.trim();
  return trimmed ? trimmed : `${EL_TYPE_LABELS[el.type]} ${index + 1}`;
}

// ---------------------------------------------------------------------------
// 패널 클리핑 — StudioPage elBounds/containingPanel 포트(studio-svg-export.ts 와 동일 포트).
// wrapClip 이 패널 안에 든 요소를 clipX/Y/Width/Height 로 자르는 것과 같은 조건을 재현해,
// 태그된 노드를 직접 toCanvas() 하면서 사라지는 "패널 밖으로 넘친 부분 잘림"을 복원한다.
// ---------------------------------------------------------------------------

function elBounds(el: PsdExportEl): { x: number; y: number; w: number; h: number } {
  if (el.type === "draw") {
    let minX = el.points[0] ?? 0;
    let minY = el.points[1] ?? 0;
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i + 1 < el.points.length; i += 2) {
      const x = el.points[i];
      const y = el.points[i + 1];
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") return { x: el.x, y: el.y, w: el.width, h: el.fontSize * 1.4 };
  if (el.type === "sticker") return { x: el.x, y: el.y, w: el.fontSize, h: el.fontSize };
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

function containingPanel(el: PsdExportEl, all: readonly PsdExportEl[]): PsdFrameElLike | null {
  if (el.type === "frame") return null;
  const b = elBounds(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best: PsdFrameElLike | null = null;
  let bestArea = Infinity;
  for (const f of all) {
    if (f.type !== "frame" || f.hidden) continue;
    if (cx < f.x || cx > f.x + f.width || cy < f.y || cy > f.y + f.height) continue;
    if (b.w > f.width * 1.4 || b.h > f.height * 1.4) continue;
    const area = f.width * f.height;
    if (area < bestArea) {
      bestArea = area;
      best = f;
    }
  }
  return best;
}

/**
 * 캡처된 레이어 캔버스를 패널 사각형(문서 좌표)에 맞춰 자른다. `originDocX/Y` 는 캔버스의
 * (0,0)이 위치한 문서 좌표(패딩 반영 후), `scale` 은 출력 배율 — 문서 좌표 1단위가 캔버스
 * 픽셀 `scale` 개에 대응한다(§좌표계 규약 참고). 패널과 실질적으로 안 겹치면(패딩 등으로
 * 인한 경계 오차) 원본을 그대로 두도록 null 을 반환한다 — 레이어를 통째로 지우지 않는다.
 */
function cropToPanel(
  canvas: HTMLCanvasElement,
  originDocX: number,
  originDocY: number,
  scale: number,
  panel: PsdFrameElLike
): { canvas: HTMLCanvasElement; dx: number; dy: number } | null {
  const x0 = Math.round(Math.max(0, (panel.x - originDocX) * scale));
  const y0 = Math.round(Math.max(0, (panel.y - originDocY) * scale));
  const x1 = Math.round(Math.min(canvas.width, (panel.x + panel.width - originDocX) * scale));
  const y1 = Math.round(Math.min(canvas.height, (panel.y + panel.height - originDocY) * scale));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 1 || h < 1) return null; // 겹치는 영역이 없음 — 자르지 않고 원본 유지(드문 경계 케이스)
  if (x0 === 0 && y0 === 0 && w === canvas.width && h === canvas.height) return { canvas, dx: 0, dy: 0 };
  const cropped = document.createElement("canvas");
  cropped.width = w;
  cropped.height = h;
  const ctx = cropped.getContext("2d");
  if (!ctx) {
    throw new Error("PSD 패널 크롭 표면을 만들지 못해 내보내기를 중단했어요.");
  }
  ctx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return { canvas: cropped, dx: x0, dy: y0 };
}

/** 말풍선(Group) 자체 그림자를 캡처 사각형에 반영할 여유(문서 좌표 단위). 그 외 타입은 0. */
function shadowPaddingLogical(el: PsdExportEl): number {
  if (el.type !== "bubble") return 0;
  const blur = el.shadowBlur ?? 5;
  const offX = Math.abs(el.shadowOffsetX ?? 1);
  const offY = Math.abs(el.shadowOffsetY ?? 2);
  return blur + Math.max(offX, offY);
}

function findElementNode(stage: Konva.Stage, elementId: string): Konva.Node | undefined {
  return stage.findOne<Konva.Node>((node: Konva.Node) => {
    const id = node.getAttr("studioElementId");
    return typeof id === "string" && id === elementId;
  });
}

/** 배경(단색 또는 세로 2색 그라데이션) 래스터 레이어 — studio-svg-export 의 배경 rect와 동일 규칙. */
function makeBackgroundLayer(width: number, height: number, background: { color: string; gradient?: string[] | null }): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("PSD 배경 레이어 표면을 만들지 못해 내보내기를 중단했어요.");
  }
  const grad = background.gradient;
  if (grad && grad.length >= 2) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, grad[0]);
    gradient.addColorStop(1, grad[grad.length - 1]);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = background.color;
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { name: "배경", left: 0, top: 0, canvas };
}

const PSD_BAKED_EFFECT_KEYS = Object.freeze([
  "blur",
  "brightness",
  "chromatic",
  "clarity",
  "colorBalance",
  "contrast",
  "curve",
  "detail",
  "distort",
  "duotoneHighlight",
  "duotoneShadow",
  "glow",
  "gradientMap",
  "grayscale",
  "grain",
  "halftone",
  "hue",
  "inkWash",
  "invert",
  "levelsBlack",
  "light",
  "lineart",
  "noise",
  "outline",
  "photoFilter",
  "pixelate",
  "posterize",
  "saturation",
  "screentone",
  "sepia",
  "shadowBlur",
  "shadowHighlight",
  "sharpen",
  "sketch",
  "stylize",
  "temperature",
] as const);

function hasBakedPsdEffect(element: PsdExportEl): boolean {
  const record = element as unknown as Record<string, unknown>;
  return PSD_BAKED_EFFECT_KEYS.some((key) => {
    const value = record[key];
    return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
  });
}

function withPsdExportLossDecisions(
  base: PsdInterchangeLossManifest,
  sourceElements: readonly PsdExportEl[],
  capturedElements: readonly PsdExportEl[],
  editableTextCount: number,
  rasterTextCount: number,
): PsdInterchangeLossManifest {
  const decisions = [...base.decisions];
  const capturedLayerCount = capturedElements.length;
  if (capturedLayerCount > 0) {
    decisions.push(exportDecision(
      "layers",
      "preserved",
      capturedLayerCount,
      `요소 ${capturedLayerCount.toLocaleString("ko-KR")}개를 개별 PSD 레이어로 기록합니다.`,
    ));
  }
  const missingLayerCount = Math.max(0, sourceElements.length - capturedLayerCount);
  if (missingLayerCount > 0) {
    decisions.push(exportDecision(
      "layers",
      "dropped",
      missingLayerCount,
      `캡처할 수 없는 요소 ${missingLayerCount.toLocaleString("ko-KR")}개는 PSD 레이어에서 제외합니다.`,
    ));
  }
  if (editableTextCount > 0) {
    decisions.push(exportDecision(
      "text",
      "preserved",
      editableTextCount,
      `가로 단색 텍스트 ${editableTextCount.toLocaleString("ko-KR")}개를 편집 가능한 PSD 문자 descriptor와 래스터 프리뷰로 기록합니다.`,
    ));
  }
  if (rasterTextCount > 0) {
    decisions.push(exportDecision(
      "text",
      "rasterized",
      rasterTextCount,
      `회전·세로쓰기·곡선·효과 텍스트 ${rasterTextCount.toLocaleString("ko-KR")}개는 화면 그대로 픽셀로 기록합니다.`,
    ));
  }
  const groupCount = new Set(
    capturedElements.map((element) => element.groupId).filter((id): id is string => !!id),
  ).size;
  if (groupCount > 0) {
    decisions.push(exportDecision(
      "groups",
      "dropped",
      groupCount,
      `Studio 그룹 ${groupCount.toLocaleString("ko-KR")}개의 폴더 구조는 PSD에 만들지 않고 z-order만 유지합니다.`,
    ));
  }
  const maskCount = capturedElements.filter((element) => !!element.maskSrc).length;
  if (maskCount > 0) {
    // 정직성 계약: 여기서 "레이어 픽셀에 합성한다"고 말하면 거짓말이 된다.
    //
    // 레이어 마스크는 StudioCanvasViewport 가 요소 노드를 ClipMaskGroup(마스크 형제 +
    // source-in 내용물) 으로 **바깥에서** 한 겹 더 감싸서 적용한다. 반면 이 파일의 캡처는
    // `findElementNode` 로 `studioElementId` 가 달린 **안쪽** 요소 노드를 찾아
    // `node.toCanvas()` 를 부른다 — 마스크 샌드위치는 그 노드의 조상이라 캡처 범위 밖이고,
    // 결과 레이어에는 마스크가 전혀 반영되지 않는다.
    //
    // 실측(2026-08-13, 400×400 이미지 + 숨기기 마스크 스트로크, 2× PSD):
    //   캔버스(Konva 씬 레이어) 지운 영역 픽셀 = rgba(0,0,0,0)
    //   같은 좌표의 PSD 레이어 픽셀        = rgba(0,0,255,255)  ← 가린 영역이 되살아남
    //   PSD 레이어 알파 히스토그램: a=0 은 1px 테두리뿐, 스트로크 자국 없음
    //   ag-psd `layer.mask` = 없음(마스크 채널도 기록하지 않음)
    // 즉 마스크 채널로도, 픽셀 합성으로도 남지 않는 완전한 유실이다.
    //
    // 이 항목의 범위는 합성을 구현하는 것이 아니라 **거짓 고지를 멈추는 것**이다. 나중에
    // 캡처가 마스크 샌드위치 루트를 잡도록 고쳐지면 그때 disposition 을 되돌리면 된다.
    decisions.push(exportDecision(
      "layer-mask",
      "dropped",
      maskCount,
      `Studio 레이어 마스크 ${maskCount.toLocaleString("ko-KR")}개는 PSD에 기록하지 못합니다 — 마스크 채널로도, 레이어 픽셀 합성으로도 남지 않아 마스크로 가린 영역이 PSD에서는 다시 나타납니다.`,
      "마스크 재편집이 필요하면 ToonSpectrum 프로젝트 아카이브를 함께 보관하세요.",
    ));
  }
  const adjustmentCount = capturedElements.filter((element) =>
    (element.smartFilters?.entries?.length ?? 0) > 0 || !!element.filterMaskSrc
  ).length;
  if (adjustmentCount > 0) {
    decisions.push(exportDecision(
      "adjustment-layer",
      "rasterized",
      adjustmentCount,
      `스마트 필터·필터 마스크 ${adjustmentCount.toLocaleString("ko-KR")}개는 비파괴 파라미터 대신 레이어 픽셀에 굽습니다.`,
    ));
  }
  const effectCount = capturedElements.filter(hasBakedPsdEffect).length;
  if (effectCount > 0) {
    decisions.push(exportDecision(
      "layer-effects",
      "rasterized",
      effectCount,
      `Studio 필터·레이어 효과 ${effectCount.toLocaleString("ko-KR")}개는 PSD 효과 descriptor 대신 화면 결과로 굽습니다.`,
    ));
  }
  const sceneCount = capturedElements.filter((element) =>
    !!element.bg3dScene || !!element.vrmScene
  ).length;
  if (sceneCount > 0) {
    decisions.push(exportDecision(
      "smart-object",
      "rasterized",
      sceneCount,
      `3D/VRM 재편집 장면 ${sceneCount.toLocaleString("ko-KR")}개는 PSD 스마트 오브젝트가 아니라 캡처 레이어로 기록합니다.`,
    ));
  }
  const vectorLikeCount = capturedElements.filter((element) =>
    element.type !== "image" && element.type !== "text"
  ).length;
  if (vectorLikeCount > 0) {
    decisions.push(exportDecision(
      "layers",
      "rasterized",
      vectorLikeCount,
      `말풍선·도형·드로잉 ${vectorLikeCount.toLocaleString("ko-KR")}개는 별도 레이어를 유지하되 벡터 편집 정보는 픽셀로 굽습니다.`,
    ));
  }
  return { ...base, decisions };
}

// ---------------------------------------------------------------------------
// 메인 — 페이지 → 레이어별 PSD
// ---------------------------------------------------------------------------

/**
 * 현재 페이지를 요소별 레이어를 가진 .psd 파일로 조립한다.
 *
 * @param stage 캡처 대상 Konva Stage(현재 페이지가 렌더된 상태여야 함).
 * @param elements z-order 로 정렬된(인덱스 0=맨 뒤) 페이지 요소 배열 — **호출부가 이미
 *   `isEffectivelyHidden` 기준으로 걸러 넘긴 것**이어야 한다(숨긴 요소는 Konva 노드 자체가
 *   없어 캡처가 불가능 — StudioPage 렌더 루프와 동일 전제).
 * @param canvasW 페이지 논리 폭(px, 줌 무관 — 예: StudioPage 의 CANVAS_W).
 * @param canvasH 페이지 논리 높이(px, 줌 무관).
 * @param effScale Stage 의 현재 화면 줌 배율(scaleX/scaleY) — 캡처 크기·위치에서 상쇄해야
 *   출력이 줌 레벨과 무관해진다. 0 이하로 들어오면 1 로 방어한다.
 * @param opts 배율(scale)·배경 포함 여부.
 *
 * 빈 페이지(요소 0개)는 에러 대신 레이어 없는 빈 캔버스 PSD 를 만들고 skipped 에 안내를
 * 남긴다 — 사용자가 "실패"보다 "빈 파일이라도 받는" 편이 낫다는 판단(문서화된 설계 선택).
 */
export async function exportPagePsd(
  stage: Konva.Stage,
  elements: readonly PsdExportEl[],
  canvasW: number,
  canvasH: number,
  effScale: number,
  opts: PsdExportOptions = {}
): Promise<PsdExportResult> {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const preflight = preflightPsdExport({
    canvasW,
    canvasH,
    scale,
    layerCount: elements.length,
    container: opts.container,
  });
  if (!preflight.canExport) {
    throw new Error(
      `${preflight.blockingReasons.join(" ")} ${preflight.lossManifest.alternatives.join(" 또는 ")}해 주세요.`,
    );
  }
  const safeEffScale = effScale > 0 ? effScale : 1;
  const psdWidth = Math.max(1, Math.round(canvasW * scale));
  const psdHeight = Math.max(1, Math.round(canvasH * scale));
  const skipped: string[] = [];
  const rubyReceipts: PsdRubyExportReceipt[] = [];
  const rubyMetadata: DialogueRubyExportMetadataRecord[] = [];

  const rubyByElementId = new Map<string, PsdRubyExportReceipt>();
  elements.forEach((element, index) => {
    if (element.type !== "text") return;
    const planned = planPsdRubyReceipt(element, elementLabel(element, index));
    if (!planned) return;
    rubyReceipts.push(planned.receipt);
    rubyByElementId.set(element.id, planned.receipt);
    if (planned.metadata) rubyMetadata.push(planned.metadata);
  });

  if (elements.length === 0) {
    skipped.push("페이지에 요소가 없어 빈 캔버스로 저장했어요.");
    const psd: Psd = { width: psdWidth, height: psdHeight, ...publishedPsdResolutionInfo() };
    const buffer = writePsd(psd);
    assertPsdOutputBudget(buffer);
    return {
      blob: new Blob([buffer], { type: PSD_EXPORT_MIME }),
      skipped,
      layerCount: 0,
      lossManifest: withPsdExportLossDecisions(preflight.lossManifest, elements, [], 0, 0),
      rubyReceipts,
    };
  }

  const layers: Layer[] = [];
  const capturedElements: PsdExportEl[] = [];
  let editableTextCount = 0;
  let rasterTextCount = 0;

  for (let i = 0; i < elements.length; i++) {
    // 요소별 toCanvas() 래스터화 + writePsd() 압축은 전부 동기(CPU 바운드)라, 요소가 많은 페이지를
    // 멈추지 않고 통짜로 돌리면 브라우저가 그 사이 리페인트·입력을 전혀 처리하지 못해 "먹통"으로
    // 보이거나(실측: 실제 탭이 응답불능이 됨) 최악엔 강제 종료된다. 매 요소마다 매크로태스크로
    // 한 번씩 양보해 메인스레드를 숨 쉬게 한다(작업량 자체는 그대로라 총 소요시간은 안 줄지만,
    // 브라우저가 죽었다고 오인하지 않게 하는 게 목적).
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const el = elements[i];
    const label = elementLabel(el, i);
    const node = findElementNode(stage, el.id);
    if (!node) {
      skipped.push(`${label}: 캔버스에서 찾지 못해 건너뜀`);
      continue;
    }

    // 뷰(화면 줌 반영) 공간 사각형 — toCanvas() 캡처 좌표계와 동일해야 한다.
    const rawAbs = node.getClientRect();
    // 문서(줌·팬 무관) 공간 사각형 — PSD left/top 좌표계.
    const rawDoc = node.getClientRect({ relativeTo: stage });
    if (rawAbs.width < 1 || rawAbs.height < 1) {
      skipped.push(`${label}: 캡처 영역이 비어 있어 건너뜀`);
      continue;
    }

    // 말풍선 그림자는 Container.getClientRect 가 패딩하지 않으므로 수동으로 여유를 준다.
    const padLogical = shadowPaddingLogical(el);
    const padView = padLogical * safeEffScale;

    const captureX = rawAbs.x - padView;
    const captureY = rawAbs.y - padView;
    const captureW = Math.max(1, Math.ceil(rawAbs.width + padView * 2));
    const captureH = Math.max(1, Math.ceil(rawAbs.height + padView * 2));
    const pixelRatio = scale / safeEffScale;

    let canvas: HTMLCanvasElement;
    try {
      canvas = node.toCanvas({ x: captureX, y: captureY, width: captureW, height: captureH, pixelRatio });
    } catch {
      skipped.push(`${label}: 래스터화 실패로 건너뜀`);
      continue;
    }

    // 캡처 캔버스의 (0,0)이 위치한 문서 좌표 — left/top·패널 크롭 계산에 공용으로 쓴다.
    const originDocX = rawDoc.x - padLogical;
    const originDocY = rawDoc.y - padLogical;
    let left = Math.round(originDocX * scale);
    let top = Math.round(originDocY * scale);
    let panelClipped = false;

    // 태그된 노드를 직접 캡처하면 wrapClip 의 "패널 안으로 클리핑"이 반영되지 않는다 —
    // 같은 조건으로 패널을 찾아 캡처 캔버스를 사후에 잘라 복원한다.
    const panel = !el.noClip ? containingPanel(el, elements) : null;
    if (panel) {
      const beforeCrop = canvas;
      const cropped = cropToPanel(canvas, originDocX, originDocY, scale, panel);
      if (cropped) {
        canvas = cropped.canvas;
        left += cropped.dx;
        top += cropped.dy;
        panelClipped = canvas !== beforeCrop || cropped.dx !== 0 || cropped.dy !== 0;
      }
    }

    const layer: Layer = {
      name: label,
      left,
      top,
      canvas,
      opacity: clampOpacity(el.opacity),
      blendMode: mapBlendMode(el.blendMode),
      clipping: !!el.clipBelow,
    };

    if (el.type === "text") {
      const editable = planPsdEditableTextDescriptor(el, {
        documentX: rawDoc.x,
        documentY: rawDoc.y,
        documentHeight: rawDoc.height,
        scale,
        panelClipped,
      });
      if (editable.text) {
        layer.text = editable.text;
        editableTextCount += 1;
      } else if (editable.fallbackReasons.length > 0) {
        rasterTextCount += 1;
        const rubyReceipt = rubyByElementId.get(el.id);
        if (rubyReceipt) {
          const issueSummary = rubyReceipt.unsupported.length > 0
            ? ` 범위 문제 ${rubyReceipt.unsupported.map((issue) => issue.code).join(", ")}도 원문 그대로 보존했어요.`
            : "";
          const metadataSummary = rubyReceipt.metadata === "document-xmp-v1"
            ? "원문·UTF-16 범위는 문서 XMP metadata에 보존했어요."
            : "원문 metadata는 JSON 호환 오류로 기록하지 못했어요.";
          skipped.push(
            `${label}: PSD에 편집 가능한 루비 구조가 없어 화면 그대로 보이는 래스터 레이어를 유지하고 ${metadataSummary}${issueSummary}`,
          );
        } else {
          skipped.push(
            `${label}: ${editable.fallbackReasons.join(", ")} 때문에 편집 가능한 PSD 텍스트로 보존할 수 없어 화면 그대로 래스터화했어요.`,
          );
        }
      }
    }

    layers.push(layer);
    capturedElements.push(el);

    if (el.clipBelow && layers.length < 2) {
      // 맨 뒤 요소가 clipBelow 인 경우 클리핑할 "아래 레이어"가 없다 — ag-psd 는 이를 그대로
      // 기록하지만 포토샵에서 시각 효과가 없다(정직하게 고지).
      skipped.push(`${label}: 가장 아래 레이어라 "아래로 클리핑"이 적용될 대상이 없어요.`);
    }
  }

  if (layers.length === 0) {
    skipped.push("캡처 가능한 레이어가 없어 빈 캔버스로 저장했어요.");
  }

  // Studio: 뒤→앞(elements[0]=BACK) → ag-psd: 위→아래(children[0]=TOP) — 반드시 뒤집는다.
  const children = [...layers].reverse();

  const includeBg = opts.includeBackground ?? true;
  if (includeBg && opts.background) {
    children.push(makeBackgroundLayer(psdWidth, psdHeight, opts.background));
  }

  const published = publishedPsdResolutionInfo();
  const xmpMetadata = rubyMetadata.length > 0 ? buildDialogueRubyExportXmp(rubyMetadata) : undefined;
  const imageResources = published.imageResources || xmpMetadata
    ? { ...(published.imageResources ?? {}), ...(xmpMetadata ? { xmpMetadata } : {}) }
    : undefined;
  const psd: Psd = {
    width: psdWidth,
    height: psdHeight,
    children,
    ...(imageResources ? { imageResources } : {}),
  };

  // 합성 썸네일(파일탐색기 미리보기용, 순수 장식)은 만들지 않는다 — 실측 결과 요소 2개짜리 거의
  // 빈 페이지에서도 전체 합성 캔버스를 한 번 더 렌더링+압축하는 이 단계 때문에 내보내기가 90초
  // 넘게 걸리며 끝나지 않았다(개별 레이어 캡처는 3초 안에 끝남 — 병목은 여기). 레이어는 이미
  // 각자 온전히 캡처돼 있어 포토샵에서 여는 데 썸네일이 필요 없으므로, 있으면 좋지만 없어도 되는
  // 이 단계를 완전히 생략해 실사용 가능한 시간 안에 끝나게 한다.
  let buffer: ArrayBuffer;
  try {
    // noBackground: 배경 레이어가 완전 불투명해도 ag-psd 가 "Background"(잠김, 이름 없음)로
    // 강제 전환하지 않게 한다 — 이 파일의 모든 레이어는 이름이 있고 편집 가능해야 한다.
    buffer = writePsd(psd, { noBackground: true });
  } catch (err) {
    throw new Error(`PSD 파일을 만들지 못했어요: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  assertPsdOutputBudget(buffer);

  return {
    blob: new Blob([buffer], { type: PSD_EXPORT_MIME }),
    skipped,
    layerCount: layers.length,
    lossManifest: withPsdExportLossDecisions(
      preflight.lossManifest,
      elements,
      capturedElements,
      editableTextCount,
      rasterTextCount,
    ),
    rubyReceipts,
  };
}
