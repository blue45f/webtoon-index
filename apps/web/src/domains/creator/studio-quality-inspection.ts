/**
 * Studio webtoon finishing / quality inspection core.
 *
 * This module intentionally audits document facts that can be reproduced without an AI model:
 * geometry, layer integrity, lettering fit/contrast, scroll rhythm, review state, unresolved
 * editorial work, and structured continuity findings. Ambiguous visual choices are emitted as
 * `review` rather than silently upgraded to a pass.
 */

import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";
import { auditBubbleTextLegibility } from "./lettering/studio-bubble-legibility-contrast";
import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleLetterSpacing,
  bubbleTextFitsInBox,
  createCanvasBubbleTextMeasurer,
  fitBubbleFontSize,
  resolveBubbleFontFamily,
  resolveBubbleFontSize,
  resolveBubbleFontStyle,
  resolveBubbleLineHeight,
  type BubbleTextMeasurer,
} from "./lettering/studio-bubble-text-fit";
import { MAX_FRAME_FPS, MIN_FRAME_FPS } from "./studio-frame-animation-timing";
import {
  hasContiguousLayerGroups,
  missingLayerGroupIds,
} from "./studio-layers";
import { normalizePageReviewState } from "./studio-page-review";

import type {
  StudioContinuityIssue,
  StudioContinuityIssueCode,
} from "./studio-continuity";
import type {
  BubbleEl,
  DrawEl,
  El,
  FrameEl,
  TextEl,
} from "./studio-element-model";
import type { PageState } from "./studio-page-state";

export const STUDIO_QUALITY_INSPECTION_VERSION = 1 as const;

export type StudioQualitySeverity = "blocking" | "error" | "warning" | "review";

export type StudioQualityCategory =
  | "document"
  | "layout"
  | "lettering"
  | "layer"
  | "asset"
  | "workflow"
  | "continuity";

export type StudioQualityIssueCode =
  | "NO_PAGES"
  | "DUPLICATE_PAGE_ID"
  | "INVALID_PAGE_ID"
  | "INVALID_CANVAS_HEIGHT"
  | "EMPTY_PAGE"
  | "DUPLICATE_ELEMENT_ID"
  | "INVALID_ELEMENT_ID"
  | "INVALID_ELEMENT_GEOMETRY"
  | "ELEMENT_OUTSIDE_PAGE"
  | "ELEMENT_CLIPPED"
  | "NEAR_INVISIBLE_ELEMENT"
  | "LARGE_TOP_GAP"
  | "LARGE_BOTTOM_GAP"
  | "LARGE_SCROLL_GAP"
  | "TIGHT_FRAME_GUTTER"
  | "FRAME_OVERLAP"
  | "MISSING_IMAGE_SOURCE"
  | "NON_PERSISTENT_IMAGE_SOURCE"
  | "INVALID_IMAGE_DATA_SOURCE"
  | "MISSING_ANIMATION_FRAME_SOURCE"
  | "MISSING_ANIMATION_FRAME_ID"
  | "DUPLICATE_ANIMATION_FRAME_ID"
  | "INVALID_ANIMATION_TIMING"
  | "DANGLING_ACTIVE_ANIMATION_FRAME"
  | "BROKEN_RASTER_ASSET"
  | "LOW_RASTER_RESOLUTION"
  | "EXTREME_RASTER_UPSCALE"
  | "RASTER_ASPECT_RATIO_DISTORTION"
  | "ANIMATION_FRAME_DIMENSION_MISMATCH"
  | "MASK_DIMENSION_MISMATCH"
  | "EMBEDDED_ASSET_LARGE"
  | "RASTER_PROBE_LIMIT_REACHED"
  | "MASK_SOURCE_MISSING"
  | "FILTER_MASK_SOURCE_MISSING"
  | "DUPLICATE_LAYER_GROUP_ID"
  | "ORPHAN_LAYER_GROUP"
  | "NONCONTIGUOUS_LAYER_GROUP"
  | "ORPHAN_CLIPPING_LAYER"
  | "HIDDEN_CONTENT_ON_APPROVED_PAGE"
  | "EMPTY_DIALOGUE"
  | "INVALID_DIALOGUE_CHARACTER"
  | "EXCESSIVE_DIALOGUE_BREAKS"
  | "DUPLICATE_DIALOGUE"
  | "SMALL_DIALOGUE_TEXT"
  | "BUBBLE_TEXT_OVERFLOW"
  | "BUBBLE_AUTO_SHRINK_TOO_SMALL"
  | "BUBBLE_LOW_CONTRAST"
  | "BUBBLE_CONTRAST_REQUIRES_PIXEL_REVIEW"
  | "INVALID_DIALOGUE_RANGE"
  | "DANGLING_BUBBLE_TAIL"
  | "PAGE_CHANGES_REQUESTED"
  | "PAGE_REVIEW_PENDING"
  | "APPROVED_PAGE_UNLOCKED"
  | "OPEN_EDITORIAL_COMMENTS"
  | "FINISH_QUALITY_FINDING"
  | "CONTINUITY_ISSUE"
  | "ISSUE_LIMIT_REACHED";

export interface StudioQualityIssueTarget {
  readonly pageId?: string;
  readonly elementId?: string;
  readonly sceneId?: string;
}

export interface StudioQualityIssue {
  /** Stable fingerprint used by local acknowledgements and report diffs. */
  readonly id: string;
  readonly code: StudioQualityIssueCode;
  readonly category: StudioQualityCategory;
  readonly severity: StudioQualitySeverity;
  readonly title: string;
  readonly message: string;
  readonly remediation: string;
  readonly pageId?: string;
  readonly pageIndex?: number;
  readonly elementId?: string;
  readonly sceneId?: string;
  readonly relatedElementIds?: readonly string[];
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
}

export interface StudioQualityInspectionInput {
  readonly pages: readonly PageState[];
  readonly continuityIssues?: readonly StudioContinuityIssue[];
  readonly openCommentCount?: number;
  /** Browser/runtime probes can add decode and intrinsic-resolution findings here. */
  readonly supplementalIssues?: readonly StudioQualityIssue[];
}

export interface StudioQualityInspectionOptions {
  readonly canvasWidth?: number;
  readonly minReadableFontSize?: number;
  readonly clipTolerancePx?: number;
  readonly largeScrollGapPx?: number;
  readonly maxIssues?: number;
  readonly textMeasurer?: BubbleTextMeasurer;
}

export interface StudioQualityCounts {
  readonly blocking: number;
  readonly error: number;
  readonly warning: number;
  readonly review: number;
}

export interface StudioQualityInspectionResult {
  readonly basis: "studio-quality-inspection";
  readonly version: typeof STUDIO_QUALITY_INSPECTION_VERSION;
  readonly canFinalize: boolean;
  /** Transparent heuristic: 100 minus severity weights, clamped to 0..100. */
  readonly readinessScore: number;
  readonly counts: StudioQualityCounts;
  readonly categoryCounts: Readonly<Record<StudioQualityCategory, number>>;
  readonly checkedPageCount: number;
  readonly checkedElementCount: number;
  readonly checkedDialogueCount: number;
  /** Lightweight revision fingerprint used to invalidate stale manual sign-off. */
  readonly revisionKey: string;
  readonly issues: readonly StudioQualityIssue[];
  readonly suppressedIssueCount: number;
}

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioQualityIssueInput
  extends Omit<StudioQualityIssue, "id"> {
  readonly idSuffix?: string;
}

type MutableIssue = StudioQualityIssueInput;

const SEVERITY_RANK: Readonly<Record<StudioQualitySeverity, number>> = {
  blocking: 0,
  error: 1,
  warning: 2,
  review: 3,
};

const SEVERITY_WEIGHT: Readonly<Record<StudioQualitySeverity, number>> = {
  blocking: 30,
  error: 12,
  warning: 4,
  review: 1,
};

const CATEGORY_ORDER: readonly StudioQualityCategory[] = [
  "document",
  "workflow",
  "lettering",
  "layout",
  "layer",
  "asset",
  "continuity",
];

const DEFAULT_MAX_ISSUES = 750;
const DEFAULT_MIN_READABLE_FONT_SIZE = 12;
const DEFAULT_CLIP_TOLERANCE_PX = 6;
const DEFAULT_LARGE_SCROLL_GAP_PX = 1_200;

const CONTINUITY_TITLES: Readonly<Record<StudioContinuityIssueCode, string>> = {
  DUPLICATE_CHARACTER_NAME: "캐릭터 이름 중복",
  MISSING_CHARACTER_APPEARANCE: "캐릭터 외형 정보 누락",
  MISSING_CHARACTER_VOICE: "캐릭터 말투 정보 누락",
  MISSING_CHARACTER_GOAL: "캐릭터 목표 정보 누락",
  UNKNOWN_CHARACTER: "미등록 캐릭터",
  LOCATION_CONTINUITY_CONTRADICTION: "장소 연속성 확인",
  TIME_CONTINUITY_CONTRADICTION: "시간 연속성 확인",
  COSTUME_CONTINUITY_CONTRADICTION: "의상 연속성 확인",
  PROP_CONTINUITY_CONTRADICTION: "소품 연속성 확인",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function displayPageName(page: PageState, pageIndex: number): string {
  const name = typeof page.name === "string" ? page.name.trim() : "";
  return name || `${pageIndex + 1}페이지`;
}

function stableIssueId(issue: MutableIssue): string {
  return [
    issue.code,
    issue.pageId ?? "document",
    issue.elementId ?? "-",
    issue.sceneId ?? "-",
    issue.idSuffix ?? "-",
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function createStudioQualityIssue(issue: StudioQualityIssueInput): StudioQualityIssue {
  const { idSuffix: _idSuffix, ...publicIssue } = issue;
  return { id: stableIssueId(issue), ...publicIssue };
}

function rotatedBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0
): Bounds {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const rotatedWidth = width * cosine + height * sine;
  const rotatedHeight = width * sine + height * cosine;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return {
    left: centerX - rotatedWidth / 2,
    top: centerY - rotatedHeight / 2,
    right: centerX + rotatedWidth / 2,
    bottom: centerY + rotatedHeight / 2,
    width: rotatedWidth,
    height: rotatedHeight,
  };
}

function textBounds(el: TextEl): Bounds | null {
  if (!finite(el.x) || !finite(el.y) || !positive(el.width) || !positive(el.fontSize)) return null;
  const lineHeight = positive(el.lineHeight) ? el.lineHeight : 1.2;
  const explicitLines = Math.max(1, el.text.split(/\r?\n/u).length);
  const longestLine = el.text
    .split(/\r?\n/u)
    .reduce((longest, line) => Math.max(longest, [...line].length), 0);
  const estimatedWrappedLines = Math.max(
    explicitLines,
    Math.ceil((longestLine * el.fontSize * 0.55) / Math.max(1, el.width))
  );
  const height = Math.max(el.fontSize, estimatedWrappedLines * el.fontSize * lineHeight);
  return rotatedBounds(el.x, el.y, el.width, height, finite(el.rotation) ? el.rotation : 0);
}

function drawBounds(el: DrawEl): Bounds | null {
  if (!Array.isArray(el.points) || el.points.length < 2 || el.points.length % 2 !== 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < el.points.length; index += 2) {
    const x = el.points[index];
    const y = el.points[index + 1];
    if (!finite(x) || !finite(y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const radius = positive(el.strokeWidth) ? el.strokeWidth / 2 : 0;
  return {
    left: minX - radius,
    top: minY - radius,
    right: maxX + radius,
    bottom: maxY + radius,
    width: Math.max(0, maxX - minX + radius * 2),
    height: Math.max(0, maxY - minY + radius * 2),
  };
}

function elementBounds(el: El): Bounds | null {
  switch (el.type) {
    case "image":
    case "bubble":
    case "frame":
    case "focusLines":
    case "speedLines": {
      const rotation = el.type === "frame" ? 0 : el.rotation;
      if (
        !finite(el.x) ||
        !finite(el.y) ||
        !positive(el.width) ||
        !positive(el.height) ||
        !finite(rotation)
      ) {
        return null;
      }
      return rotatedBounds(el.x, el.y, el.width, el.height, rotation);
    }
    case "text":
      return textBounds(el);
    case "sticker": {
      if (!finite(el.x) || !finite(el.y) || !positive(el.fontSize) || !finite(el.rotation)) return null;
      const width = Math.max(el.fontSize, [...el.text].length * el.fontSize * 0.62);
      const height = el.fontSize * 1.25;
      return rotatedBounds(el.x, el.y, width, height, el.rotation);
    }
    case "draw":
      return drawBounds(el);
  }
}

function effectiveHidden(el: El, page: PageState): boolean {
  if (el.hidden) return true;
  if (!el.groupId) return false;
  return page.groups?.some((group) => group.id === el.groupId && group.hidden === true) ?? false;
}

function overlapRatio(a: Bounds, b: Bounds): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const overlapArea = width * height;
  const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlapArea / smallerArea;
}

function normalizedDialogue(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function hasInvalidRanges(
  ranges: readonly { readonly start: number; readonly end: number }[] | undefined,
  textLength: number
): boolean {
  if (!ranges || ranges.length === 0) return false;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = -1;
  for (const range of sorted) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > textLength ||
      range.start < previousEnd
    ) {
      return true;
    }
    previousEnd = range.end;
  }
  return false;
}

function inspectBubbleLettering(
  page: PageState,
  pageIndex: number,
  el: BubbleEl,
  add: (issue: MutableIssue) => void,
  options: Required<
    Pick<StudioQualityInspectionOptions, "minReadableFontSize">
  > & { readonly measurer: BubbleTextMeasurer }
): void {
  const pageName = displayPageName(page, pageIndex);
  const text = el.text ?? "";
  const trimmed = text.trim();
  if (!trimmed) {
    add({
      code: "EMPTY_DIALOGUE",
      category: "lettering",
      severity: "error",
      title: "빈 말풍선",
      message: `${pageName}의 말풍선에 대사가 없습니다.`,
      remediation: "대사를 입력하거나 사용하지 않는 말풍선을 삭제하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
    return;
  }

  const fontSize = resolveBubbleFontSize(el.fontSize);
  const lineHeight = resolveBubbleLineHeight({
    lineHeight: el.lineHeight,
    vertical: el.vertical,
  });
  const fontFamily = resolveBubbleFontFamily(el.font);
  const fontStyle = resolveBubbleFontStyle(el.fontStyle);
  const letterSpacing = bubbleLetterSpacing();

  if (fontSize < options.minReadableFontSize) {
    add({
      code: "SMALL_DIALOGUE_TEXT",
      category: "lettering",
      severity: "review",
      title: "작은 대사 글자",
      message: `${pageName}의 대사 글자 크기가 ${fontSize}px입니다.`,
      remediation: "모바일 독자 폭과 100% 확대에서 실제 가독성을 확인하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: { fontSize, recommendedMinimum: options.minReadableFontSize },
    });
  }

  const fitInput = {
    text,
    boxWidth: el.width,
    boxHeight: el.height,
    maxFontSize: fontSize,
    minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
    fontFamily,
    fontStyle,
    lineHeight,
    vertical: el.vertical,
    letterSpacing,
    blockAlign: "center" as const,
  };

  if (el.autoShrinkText) {
    const fit = fitBubbleFontSize(fitInput, options.measurer);
    if (fit.overflow) {
      add({
        code: "BUBBLE_TEXT_OVERFLOW",
        category: "lettering",
        severity: "error",
        title: "말풍선 대사 잘림 위험",
        message: `${pageName}의 말풍선은 자동 축소 하한 ${fit.fontSize}px에서도 대사가 모두 들어가지 않습니다.`,
        remediation: "말풍선을 키우거나 대사를 줄이고, 필요하면 자동 축소 하한을 다시 설정하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        evidence: { minimumFontSize: fit.fontSize, lineCount: fit.lines.length },
      });
    } else if (fit.fontSize < fontSize && fit.fontSize < options.minReadableFontSize) {
      add({
        code: "BUBBLE_AUTO_SHRINK_TOO_SMALL",
        category: "lettering",
        severity: "warning",
        title: "자동 축소 후 가독성 저하",
        message: `${pageName}의 말풍선은 ${fontSize}px에서 ${fit.fontSize}px까지 축소되어야 들어갑니다.`,
        remediation: "말풍선 크기나 대사 길이를 조정해 자동 축소 결과가 최소 가독성 기준 이상이 되게 하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        evidence: {
          originalFontSize: fontSize,
          fittedFontSize: fit.fontSize,
          recommendedMinimum: options.minReadableFontSize,
        },
      });
    }
  } else if (
    !bubbleTextFitsInBox(
      {
        text,
        boxWidth: el.width,
        boxHeight: el.height,
        fontFamily,
        fontStyle,
        lineHeight,
        vertical: el.vertical,
        letterSpacing,
        blockAlign: "center",
      },
      fontSize,
      options.measurer
    )
  ) {
    add({
      code: "BUBBLE_TEXT_OVERFLOW",
      category: "lettering",
      severity: "error",
      title: "말풍선 대사 잘림 위험",
      message: `${pageName}의 말풍선 상자에 현재 대사가 모두 들어가지 않습니다.`,
      remediation: "말풍선 높이 맞춤, 글자 자동 축소, 대사 축약 중 하나를 적용한 뒤 다시 검사하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: { fontSize, width: el.width, height: el.height },
    });
  }

  const contrast = auditBubbleTextLegibility({
    textColor: el.textFill,
    backdropColor: el.fill,
    backdropIsGradient: el.gradient !== undefined && el.gradient !== null,
    fontSizePx: fontSize,
    fontStyle: el.fontStyle,
    level: "AA",
  });
  if (contrast.verdict === "fail") {
    add({
      code: "BUBBLE_LOW_CONTRAST",
      category: "lettering",
      severity: "error",
      title: "대사 명도 대비 부족",
      message: `${pageName}의 말풍선 대비가 ${contrast.ratio}:1로 기준 ${contrast.threshold}:1보다 낮습니다.`,
      remediation: "대사색 또는 말풍선 바탕색을 바꿔 가독성 기준을 충족시키세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: {
        contrastRatio: contrast.ratio ?? 0,
        threshold: contrast.threshold ?? 0,
        criterion: contrast.successCriterion ?? "1.4.3",
      },
    });
  } else if (
    contrast.verdict === "indeterminate" &&
    contrast.reason !== "font-size-unknown" &&
    contrast.reason !== "backdrop-missing"
  ) {
    add({
      code: "BUBBLE_CONTRAST_REQUIRES_PIXEL_REVIEW",
      category: "lettering",
      severity: "review",
      title: "픽셀 기준 대비 확인 필요",
      message: `${pageName}의 말풍선은 ${contrast.reason ?? "복합 채우기"} 때문에 색 값만으로 대비를 확정할 수 없습니다.`,
      remediation: "실제 합성 결과를 100% 확대와 모바일 미리보기에서 확인하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: { reason: contrast.reason ?? "unknown" },
    });
  }

  if (
    hasInvalidRanges(el.rubySpans, text.length) ||
    hasInvalidRanges(el.rangeFormats, text.length)
  ) {
    add({
      code: "INVALID_DIALOGUE_RANGE",
      category: "lettering",
      severity: "error",
      title: "대사 범위 서식 손상",
      message: `${pageName}의 루비 또는 부분 서식 범위가 대사 문자열 범위를 벗어났거나 서로 겹칩니다.`,
      remediation: "해당 대사의 루비·부분 서식을 다시 적용하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }
}

function inspectTextLettering(
  page: PageState,
  pageIndex: number,
  el: TextEl,
  add: (issue: MutableIssue) => void,
  minReadableFontSize: number
): void {
  const pageName = displayPageName(page, pageIndex);
  const text = el.text ?? "";
  if (!text.trim()) {
    add({
      code: "EMPTY_DIALOGUE",
      category: "lettering",
      severity: "warning",
      title: "빈 텍스트 레이어",
      message: `${pageName}에 내용이 없는 텍스트 레이어가 있습니다.`,
      remediation: "내용을 입력하거나 사용하지 않는 텍스트 레이어를 삭제하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
    return;
  }
  if (el.fontSize < minReadableFontSize) {
    add({
      code: "SMALL_DIALOGUE_TEXT",
      category: "lettering",
      severity: "review",
      title: "작은 텍스트",
      message: `${pageName}의 텍스트 크기가 ${el.fontSize}px입니다.`,
      remediation: "효과음·주석 등 의도된 작은 글자인지 모바일 독자 폭에서 확인하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: { fontSize: el.fontSize, recommendedMinimum: minReadableFontSize },
    });
  }
  if (
    hasInvalidRanges(el.rubySpans, text.length) ||
    hasInvalidRanges(el.rangeFormats, text.length)
  ) {
    add({
      code: "INVALID_DIALOGUE_RANGE",
      category: "lettering",
      severity: "error",
      title: "텍스트 범위 서식 손상",
      message: `${pageName}의 루비 또는 부분 서식 범위가 문자열 범위를 벗어났거나 서로 겹칩니다.`,
      remediation: "해당 텍스트의 루비·부분 서식을 다시 적용하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }
}

function inspectTextCharacters(
  page: PageState,
  pageIndex: number,
  el: Extract<El, { type: "text" | "bubble" | "sticker" }>,
  add: (issue: MutableIssue) => void
): void {
  const text = el.text ?? "";
  if (text.includes("\u0000") || text.includes("\uFFFD")) {
    add({
      code: "INVALID_DIALOGUE_CHARACTER",
      category: "lettering",
      severity: "error",
      title: "손상된 대사 문자",
      message: `${displayPageName(page, pageIndex)}의 텍스트에 NUL 또는 대체 문자(�)가 포함되어 있습니다.`,
      remediation: "원문을 다시 붙여 넣고 폰트·인코딩을 확인하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }
  if (/\n[ \t]*\n[ \t]*\n/u.test(text)) {
    add({
      code: "EXCESSIVE_DIALOGUE_BREAKS",
      category: "lettering",
      severity: "review",
      title: "연속 빈 줄",
      message: `${displayPageName(page, pageIndex)}의 텍스트에 빈 줄이 세 줄 이상 이어집니다.`,
      remediation: "의도한 호흡인지 확인하고, 아니라면 불필요한 줄바꿈을 정리하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }
}

function inspectImageAsset(
  page: PageState,
  pageIndex: number,
  el: Extract<El, { type: "image" }>,
  add: (issue: MutableIssue) => void
): void {
  const pageName = displayPageName(page, pageIndex);
  const source = typeof el.src === "string" ? el.src.trim() : "";
  if (!source) {
    add({
      code: "MISSING_IMAGE_SOURCE",
      category: "asset",
      severity: "blocking",
      title: "이미지 원본 누락",
      message: `${pageName}의 이미지 레이어가 원본을 참조하지 않습니다.`,
      remediation: "이미지를 다시 연결하거나 손상된 레이어를 삭제하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  } else if (source.startsWith("blob:")) {
    add({
      code: "NON_PERSISTENT_IMAGE_SOURCE",
      category: "asset",
      severity: "error",
      title: "일회성 이미지 주소",
      message: `${pageName}의 이미지가 브라우저 세션이 끝나면 사라지는 blob URL을 사용합니다.`,
      remediation: "이미지를 프로젝트 자산으로 저장한 뒤 영구 참조로 교체하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  } else if (source.startsWith("data:") && !source.startsWith("data:image/")) {
    add({
      code: "INVALID_IMAGE_DATA_SOURCE",
      category: "asset",
      severity: "error",
      title: "지원되지 않는 이미지 데이터",
      message: `${pageName}의 이미지 레이어가 image MIME이 아닌 data URL을 사용합니다.`,
      remediation: "PNG, JPEG, WebP, GIF 등 지원 이미지 형식으로 다시 삽입하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }

  const frames = el.frames ?? [];
  if (
    frames.length > 0 &&
    el.frameFps !== undefined &&
    (!finite(el.frameFps) ||
      !Number.isInteger(el.frameFps) ||
      el.frameFps < MIN_FRAME_FPS ||
      el.frameFps > MAX_FRAME_FPS)
  ) {
    add({
      code: "INVALID_ANIMATION_TIMING",
      category: "asset",
      severity: "error",
      title: "애니메이션 FPS 손상",
      message: `${pageName}의 애니메이션 FPS가 지원 범위 ${MIN_FRAME_FPS}~${MAX_FRAME_FPS}를 벗어납니다.`,
      remediation: "프레임 애니메이션 패널에서 재생 속도를 다시 지정하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
      evidence: { frameFps: finite(el.frameFps) ? el.frameFps : "not-finite" },
    });
  }
  if (
    frames.length > 0 &&
    el.activeFrameId &&
    !frames.some((frame) => frame.id === el.activeFrameId)
  ) {
    add({
      code: "DANGLING_ACTIVE_ANIMATION_FRAME",
      category: "asset",
      severity: "error",
      title: "현재 애니메이션 프레임 참조 손상",
      message: `${pageName}의 현재 프레임 "${el.activeFrameId}"이 프레임 목록에 없습니다.`,
      remediation: "애니메이션 패널에서 유효한 프레임을 선택하거나 현재 프레임 참조를 초기화하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }

  const frameIds = new Set<string>();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const frameId = typeof frame.id === "string" ? frame.id.trim() : "";
    if (!frameId) {
      add({
        code: "MISSING_ANIMATION_FRAME_ID",
        category: "asset",
        severity: "error",
        title: "애니메이션 프레임 ID 누락",
        message: `${pageName}의 애니메이션 프레임 ${index + 1}에 식별자가 없습니다.`,
        remediation: "해당 프레임을 복제·교체해 고유 식별자를 다시 생성하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        idSuffix: `frame-id:${index}`,
      });
    } else if (frameIds.has(frameId)) {
      add({
        code: "DUPLICATE_ANIMATION_FRAME_ID",
        category: "asset",
        severity: "error",
        title: "애니메이션 프레임 ID 중복",
        message: `${pageName}의 애니메이션 이미지에 같은 프레임 ID가 두 번 있습니다.`,
        remediation: "중복 프레임을 제거하거나 프레임 ID를 다시 생성하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        idSuffix: `frame:${frameId}:${index}`,
      });
    }
    if (frameId) frameIds.add(frameId);
    if (typeof frame.src !== "string" || !frame.src.trim()) {
      add({
        code: "MISSING_ANIMATION_FRAME_SOURCE",
        category: "asset",
        severity: "error",
        title: "애니메이션 프레임 원본 누락",
        message: `${pageName}의 애니메이션 프레임 ${index + 1}에 이미지 원본이 없습니다.`,
        remediation: "해당 프레임 이미지를 다시 연결하거나 프레임을 삭제하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        idSuffix: `frame-source:${index}`,
      });
    }
    if (
      frame.durationMs !== undefined &&
      (!finite(frame.durationMs) || frame.durationMs < 16 || frame.durationMs > 60_000)
    ) {
      add({
        code: "INVALID_ANIMATION_TIMING",
        category: "asset",
        severity: "error",
        title: "애니메이션 프레임 노출 시간 손상",
        message: `${pageName}의 애니메이션 프레임 ${index + 1} 노출 시간이 유효하지 않습니다.`,
        remediation: "프레임 노출 시간을 16~60,000ms 범위에서 다시 지정하거나 개별 시간을 해제하세요.",
        pageId: page.id,
        pageIndex,
        elementId: el.id,
        idSuffix: `frame-duration:${index}`,
        evidence: {
          durationMs: finite(frame.durationMs) ? frame.durationMs : "not-finite",
        },
      });
    }
  }

  if (el.filterMaskEnabled && !el.filterMaskSurfaceId && !el.filterMaskSrc) {
    add({
      code: "FILTER_MASK_SOURCE_MISSING",
      category: "layer",
      severity: "error",
      title: "필터 마스크 원본 누락",
      message: `${pageName}의 필터 마스크가 활성화됐지만 마스크 표면이 없습니다.`,
      remediation: "필터 마스크를 다시 칠하거나 비어 있는 마스크를 비활성화하세요.",
      pageId: page.id,
      pageIndex,
      elementId: el.id,
    });
  }
}

function inspectFrameRhythm(
  page: PageState,
  pageIndex: number,
  visibleFrames: readonly { readonly el: FrameEl; readonly bounds: Bounds }[],
  add: (issue: MutableIssue) => void,
  largeGapPx: number
): void {
  if (visibleFrames.length < 2) return;
  const sorted = [...visibleFrames].sort(
    (a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const verticalGap = current.bounds.top - previous.bounds.bottom;
    if (verticalGap > largeGapPx) {
      add({
        code: "LARGE_SCROLL_GAP",
        category: "layout",
        severity: "review",
        title: "큰 컷 사이 여백",
        message: `${displayPageName(page, pageIndex)}의 연속 프레임 사이에 ${Math.round(verticalGap)}px 여백이 있습니다.`,
        remediation: "의도한 호흡인지 세로 스크롤 미리보기에서 확인하세요.",
        pageId: page.id,
        pageIndex,
        elementId: current.el.id,
        relatedElementIds: [previous.el.id, current.el.id],
        idSuffix: `gap:${previous.el.id}`,
        evidence: { gapPx: Math.round(verticalGap) },
      });
      continue;
    }
    const overlap = overlapRatio(previous.bounds, current.bounds);
    if (overlap >= 0.12) {
      add({
        code: "FRAME_OVERLAP",
        category: "layout",
        severity: "review",
        title: "프레임 겹침",
        message: `${displayPageName(page, pageIndex)}의 두 프레임이 약 ${Math.round(overlap * 100)}% 겹칩니다.`,
        remediation: "의도한 중첩 연출인지, 경계선이나 내용이 잘리지 않는지 확인하세요.",
        pageId: page.id,
        pageIndex,
        elementId: current.el.id,
        relatedElementIds: [previous.el.id, current.el.id],
        idSuffix: `overlap:${previous.el.id}`,
        evidence: { overlapPercent: Math.round(overlap * 100) },
      });
    } else if (verticalGap >= 0 && verticalGap < 8) {
      add({
        code: "TIGHT_FRAME_GUTTER",
        category: "layout",
        severity: "review",
        title: "좁은 프레임 간격",
        message: `${displayPageName(page, pageIndex)}의 프레임 간격이 ${Math.round(verticalGap)}px입니다.`,
        remediation: "모바일 축소 상태에서 컷 경계가 충분히 구분되는지 확인하세요.",
        pageId: page.id,
        pageIndex,
        elementId: current.el.id,
        relatedElementIds: [previous.el.id, current.el.id],
        idSuffix: `gutter:${previous.el.id}`,
        evidence: { gapPx: Math.round(verticalGap) },
      });
    }
  }
}

function categoryCounts(issues: readonly StudioQualityIssue[]): Record<StudioQualityCategory, number> {
  const result: Record<StudioQualityCategory, number> = {
    document: 0,
    layout: 0,
    lettering: 0,
    layer: 0,
    asset: 0,
    workflow: 0,
    continuity: 0,
  };
  for (const issue of issues) result[issue.category] += 1;
  return result;
}

function severityCounts(issues: readonly StudioQualityIssue[]): StudioQualityCounts {
  const counts = { blocking: 0, error: 0, warning: 0, review: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function sortIssues(issues: StudioQualityIssue[]): StudioQualityIssue[] {
  const categoryRank = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  return issues.sort((a, b) => {
    return (
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.pageIndex ?? -1) - (b.pageIndex ?? -1) ||
      (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99) ||
      a.code.localeCompare(b.code) ||
      a.id.localeCompare(b.id)
    );
  });
}

function updateRevisionHashWithText(hash: number, text: string): number {
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 16_777_619);
  }
  return next >>> 0;
}

function updateRevisionHash(
  hash: number,
  value: unknown,
  ancestors: WeakSet<object>
): number {
  if (value === null) return updateRevisionHashWithText(hash, "null;");
  switch (typeof value) {
    case "undefined":
      return updateRevisionHashWithText(hash, "undefined;");
    case "boolean":
      return updateRevisionHashWithText(hash, value ? "true;" : "false;");
    case "number":
      return updateRevisionHashWithText(
        hash,
        Number.isFinite(value) ? `${value};` : `${String(value)};`
      );
    case "bigint":
      return updateRevisionHashWithText(hash, `${value.toString()}n;`);
    case "string":
      // Hash every code unit without constructing a second full data-URL string.
      return updateRevisionHashWithText(
        updateRevisionHashWithText(updateRevisionHashWithText(hash, '"'), value),
        '";'
      );
    case "symbol":
      return updateRevisionHashWithText(hash, `symbol:${String(value.description)};`);
    case "function":
      return updateRevisionHashWithText(hash, "function;");
    case "object":
      break;
  }

  if (ancestors.has(value)) return updateRevisionHashWithText(hash, "[cycle];");
  ancestors.add(value);
  let next = hash;
  if (Array.isArray(value)) {
    next = updateRevisionHashWithText(next, `[${value.length}:`);
    for (const item of value) next = updateRevisionHash(next, item, ancestors);
    next = updateRevisionHashWithText(next, "];");
  } else {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    next = updateRevisionHashWithText(next, `{${keys.length}:`);
    for (const key of keys) {
      next = updateRevisionHashWithText(next, `${key}=`);
      next = updateRevisionHash(next, source[key], ancestors);
    }
    next = updateRevisionHashWithText(next, "};");
  }
  ancestors.delete(value);
  return next;
}

export function computeStudioQualityRevisionKey(
  input: Pick<
    StudioQualityInspectionInput,
    "pages" | "continuityIssues" | "openCommentCount" | "supplementalIssues"
  >
): string {
  const hash = updateRevisionHash(
    2_166_136_261,
    {
      pages: input.pages,
      continuityIssues: input.continuityIssues ?? [],
      openCommentCount: input.openCommentCount ?? 0,
      supplementalIssues: input.supplementalIssues ?? [],
    },
    new WeakSet<object>()
  );
  return `q${STUDIO_QUALITY_INSPECTION_VERSION}-${hash.toString(36).padStart(7, "0")}`;
}

function dedupeIssues(issues: readonly StudioQualityIssue[]): StudioQualityIssue[] {
  const byId = new Map<string, StudioQualityIssue>();
  for (const issue of issues) {
    const previous = byId.get(issue.id);
    if (!previous || SEVERITY_RANK[issue.severity] < SEVERITY_RANK[previous.severity]) {
      byId.set(issue.id, issue);
    }
  }
  return [...byId.values()];
}

export function inspectStudioQuality(
  input: StudioQualityInspectionInput,
  options: StudioQualityInspectionOptions = {}
): StudioQualityInspectionResult {
  const canvasWidth = positive(options.canvasWidth) ? options.canvasWidth : STUDIO_CANVAS_WIDTH;
  const minReadableFontSize = positive(options.minReadableFontSize)
    ? options.minReadableFontSize
    : DEFAULT_MIN_READABLE_FONT_SIZE;
  const clipTolerancePx = finite(options.clipTolerancePx) && options.clipTolerancePx >= 0
    ? options.clipTolerancePx
    : DEFAULT_CLIP_TOLERANCE_PX;
  const largeScrollGapPx = positive(options.largeScrollGapPx)
    ? options.largeScrollGapPx
    : DEFAULT_LARGE_SCROLL_GAP_PX;
  const maxIssues = positive(options.maxIssues)
    ? Math.max(1, Math.floor(options.maxIssues))
    : DEFAULT_MAX_ISSUES;
  const measurer = options.textMeasurer ?? createCanvasBubbleTextMeasurer();

  const collected: StudioQualityIssue[] = [];
  const add = (issue: MutableIssue) => collected.push(createStudioQualityIssue(issue));
  let checkedElementCount = 0;
  let checkedDialogueCount = 0;

  if (input.pages.length === 0) {
    add({
      code: "NO_PAGES",
      category: "document",
      severity: "blocking",
      title: "검사할 페이지 없음",
      message: "프로젝트에 원고 페이지가 없습니다.",
      remediation: "페이지를 만든 뒤 원고를 추가하세요.",
    });
  }

  const pageIds = new Set<string>();
  for (let pageIndex = 0; pageIndex < input.pages.length; pageIndex += 1) {
    const page = input.pages[pageIndex]!;
    const pageName = displayPageName(page, pageIndex);
    const pageId = typeof page.id === "string" ? page.id.trim() : "";

    if (!pageId) {
      add({
        code: "INVALID_PAGE_ID",
        category: "document",
        severity: "blocking",
        title: "페이지 식별자 누락",
        message: `${pageIndex + 1}번째 페이지의 식별자가 비어 있습니다.`,
        remediation: "페이지를 복제하거나 다시 생성해 안정적인 식별자를 부여하세요.",
        pageIndex,
        idSuffix: String(pageIndex),
      });
    } else if (pageIds.has(pageId)) {
      add({
        code: "DUPLICATE_PAGE_ID",
        category: "document",
        severity: "blocking",
        title: "페이지 식별자 중복",
        message: `${pageName}의 페이지 ID가 다른 페이지와 중복됩니다.`,
        remediation: "중복 페이지를 다시 생성해 고유 ID를 부여하세요.",
        pageId: page.id,
        pageIndex,
        idSuffix: String(pageIndex),
      });
    }
    if (pageId) pageIds.add(pageId);

    if (!positive(page.canvasH)) {
      add({
        code: "INVALID_CANVAS_HEIGHT",
        category: "document",
        severity: "blocking",
        title: "캔버스 높이 손상",
        message: `${pageName}의 캔버스 높이가 유효하지 않습니다.`,
        remediation: "페이지 높이를 정상 값으로 복구하거나 새 페이지로 내용을 옮기세요.",
        pageId: page.id,
        pageIndex,
        evidence: { canvasHeight: finite(page.canvasH) ? page.canvasH : "not-finite" },
      });
    }

    const review = normalizePageReviewState(page.review);
    if (review.status === "changes-requested") {
      add({
        code: "PAGE_CHANGES_REQUESTED",
        category: "workflow",
        severity: "error",
        title: "수정 요청 미해결",
        message: `${pageName}이 수정 요청 상태입니다.`,
        remediation: "검토 메모를 반영하고 다시 검토 요청 또는 승인 상태로 변경하세요.",
        pageId: page.id,
        pageIndex,
      });
    } else if (review.status !== "approved") {
      add({
        code: "PAGE_REVIEW_PENDING",
        category: "workflow",
        severity: "warning",
        title: "페이지 승인 대기",
        message: `${pageName}의 현재 검토 상태는 ${review.status === "draft" ? "작업 중" : "검토 요청"}입니다.`,
        remediation: "최종 검토가 끝나면 페이지를 승인 상태로 변경하세요.",
        pageId: page.id,
        pageIndex,
      });
    } else if (!review.locked) {
      add({
        code: "APPROVED_PAGE_UNLOCKED",
        category: "workflow",
        severity: "review",
        title: "승인 페이지 편집 가능",
        message: `${pageName}이 승인됐지만 편집 잠금이 꺼져 있습니다.`,
        remediation: "마감본을 보호하려면 승인 후 편집 잠금을 켜세요.",
        pageId: page.id,
        pageIndex,
      });
    }

    const groups = page.groups ?? [];
    const seenGroupIds = new Set<string>();
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!;
      if (seenGroupIds.has(group.id)) {
        add({
          code: "DUPLICATE_LAYER_GROUP_ID",
          category: "layer",
          severity: "error",
          title: "레이어 그룹 ID 중복",
          message: `${pageName}에 같은 레이어 그룹 ID가 두 번 있습니다.`,
          remediation: "중복 그룹을 해제한 뒤 다시 묶어 그룹 메타데이터를 복구하세요.",
          pageId: page.id,
          pageIndex,
          idSuffix: `${group.id}:${groupIndex}`,
        });
      }
      seenGroupIds.add(group.id);
    }
    for (const missingGroupId of missingLayerGroupIds(page.elements, groups)) {
      add({
        code: "ORPHAN_LAYER_GROUP",
        category: "layer",
        severity: "error",
        title: "존재하지 않는 레이어 그룹 참조",
        message: `${pageName}의 요소가 없는 그룹 "${missingGroupId}"을 참조합니다.`,
        remediation: "요소를 그룹 밖으로 빼거나 그룹을 다시 생성하세요.",
        pageId: page.id,
        pageIndex,
        idSuffix: missingGroupId,
      });
    }
    if (!hasContiguousLayerGroups(page.elements)) {
      add({
        code: "NONCONTIGUOUS_LAYER_GROUP",
        category: "layer",
        severity: "error",
        title: "레이어 그룹 순서 손상",
        message: `${pageName}의 같은 그룹 요소가 z-order에서 여러 구간으로 갈라져 있습니다.`,
        remediation: "그룹을 해제한 뒤 다시 묶어 연속된 레이어 블록으로 복구하세요.",
        pageId: page.id,
        pageIndex,
      });
    }

    const ids = new Set<string>();
    const visibleBounds: Array<{ el: El; bounds: Bounds }> = [];
    const visibleFrames: Array<{ el: FrameEl; bounds: Bounds }> = [];
    const dialogueGroups = new Map<string, string[]>();
    let visibleElementCount = 0;
    let hiddenMeaningfulCount = 0;

    for (let elementIndex = 0; elementIndex < page.elements.length; elementIndex += 1) {
      const sourceElement = page.elements[elementIndex]!;
      const invalidText =
        (sourceElement.type === "text" || sourceElement.type === "bubble" || sourceElement.type === "sticker") &&
        typeof sourceElement.text !== "string";
      // Restored fields are untrusted. Normalize once before every geometry/lettering read,
      // keep the stored object untouched, and never turn malformed content into a pass.
      const el: El = invalidText ? { ...sourceElement, text: "" } as El : sourceElement;
      if (invalidText) {
        add({
          code: "INVALID_DIALOGUE_CHARACTER",
          category: "lettering",
          severity: "blocking",
          title: "텍스트 데이터 형식 손상",
          message: `${pageName}의 ${sourceElement.type} 요소에 문자열이 아닌 텍스트가 저장되어 있습니다.`,
          remediation: "원문을 복구하거나 해당 요소를 다시 생성하세요.",
          pageId: page.id,
          pageIndex,
          elementId: typeof sourceElement.id === "string" ? sourceElement.id : undefined,
          idSuffix: `invalid-text:${elementIndex}`,
        });
      }
      checkedElementCount += 1;
      const elementId = typeof el.id === "string" ? el.id.trim() : "";
      if (!elementId) {
        add({
          code: "INVALID_ELEMENT_ID",
          category: "document",
          severity: "blocking",
          title: "요소 식별자 누락",
          message: `${pageName}의 ${elementIndex + 1}번째 요소 ID가 비어 있습니다.`,
          remediation: "해당 요소를 복제한 뒤 손상된 원본을 삭제하세요.",
          pageId: page.id,
          pageIndex,
          idSuffix: String(elementIndex),
        });
      } else if (ids.has(elementId)) {
        add({
          code: "DUPLICATE_ELEMENT_ID",
          category: "document",
          severity: "blocking",
          title: "요소 식별자 중복",
          message: `${pageName}에 같은 요소 ID "${elementId}"가 두 번 있습니다.`,
          remediation: "중복 요소를 복제·교체해 고유 ID를 다시 부여하세요.",
          pageId: page.id,
          pageIndex,
          elementId: el.id,
          idSuffix: String(elementIndex),
        });
      }
      if (elementId) ids.add(elementId);

      const hidden = effectiveHidden(el, page);
      if (!hidden) visibleElementCount += 1;
      else if (
        (el.type === "image" && Boolean(el.src)) ||
        ((el.type === "text" || el.type === "bubble" || el.type === "sticker") && Boolean(el.text.trim())) ||
        el.type === "draw" ||
        el.type === "frame"
      ) {
        hiddenMeaningfulCount += 1;
      }

      const bounds = elementBounds(el);
      if (!bounds) {
        add({
          code: "INVALID_ELEMENT_GEOMETRY",
          category: "document",
          severity: "blocking",
          title: "요소 좌표 또는 크기 손상",
          message: `${pageName}의 ${el.type} 요소에 유효하지 않은 좌표·크기·포인트가 있습니다.`,
          remediation: "변형 값을 초기화하거나 요소를 다시 생성하세요.",
          pageId: page.id,
          pageIndex,
          elementId: el.id,
        });
      } else if (!hidden && positive(page.canvasH)) {
        const outside =
          bounds.right <= 0 ||
          bounds.left >= canvasWidth ||
          bounds.bottom <= 0 ||
          bounds.top >= page.canvasH;
        if (outside) {
          add({
            code: "ELEMENT_OUTSIDE_PAGE",
            category: "layout",
            severity: "error",
            title: "페이지 밖 요소",
            message: `${pageName}의 ${el.type} 요소가 캔버스 밖에 있어 독자에게 보이지 않습니다.`,
            remediation: "요소를 캔버스 안으로 이동하거나 사용하지 않으면 삭제하세요.",
            pageId: page.id,
            pageIndex,
            elementId: el.id,
            evidence: {
              left: Math.round(bounds.left),
              top: Math.round(bounds.top),
              right: Math.round(bounds.right),
              bottom: Math.round(bounds.bottom),
            },
          });
        } else {
          const clipped =
            bounds.left < -clipTolerancePx ||
            bounds.top < -clipTolerancePx ||
            bounds.right > canvasWidth + clipTolerancePx ||
            bounds.bottom > page.canvasH + clipTolerancePx;
          if (clipped && el.type !== "draw") {
            add({
              code: "ELEMENT_CLIPPED",
              category: "layout",
              severity: "review",
              title: "캔버스 경계 잘림",
              message: `${pageName}의 ${el.type} 요소 일부가 페이지 경계를 벗어납니다.`,
              remediation: "의도한 블리드인지 확인하고, 대사·얼굴·중요 소품이 잘리지 않는지 점검하세요.",
              pageId: page.id,
              pageIndex,
              elementId: el.id,
            });
          }
        }
        visibleBounds.push({ el, bounds });
        if (el.type === "frame") visibleFrames.push({ el, bounds });
      }

      if (!hidden && finite(el.opacity) && el.opacity >= 0 && el.opacity <= 0.02) {
        add({
          code: "NEAR_INVISIBLE_ELEMENT",
          category: "layout",
          severity: "warning",
          title: "거의 보이지 않는 요소",
          message: `${pageName}의 ${el.type} 요소 불투명도가 ${Math.round(el.opacity * 100)}%입니다.`,
          remediation: "의도한 투명 연출인지 확인하고, 필요 없다면 숨김 또는 삭제로 정리하세요.",
          pageId: page.id,
          pageIndex,
          elementId: el.id,
          evidence: { opacity: el.opacity },
        });
      }

      if (el.maskEnabled && !el.maskSrc) {
        add({
          code: "MASK_SOURCE_MISSING",
          category: "layer",
          severity: "error",
          title: "레이어 마스크 원본 누락",
          message: `${pageName}의 레이어 마스크가 활성화됐지만 마스크 이미지가 없습니다.`,
          remediation: "마스크를 다시 만들거나 비어 있는 마스크를 비활성화하세요.",
          pageId: page.id,
          pageIndex,
          elementId: el.id,
        });
      }

      if (el.clipBelow) {
        const below = page.elements[elementIndex - 1];
        if (
          !below ||
          effectiveHidden(below, page) ||
          (el.groupId ?? null) !== (below.groupId ?? null)
        ) {
          add({
            code: "ORPHAN_CLIPPING_LAYER",
            category: "layer",
            severity: "error",
            title: "클리핑 기준 레이어 누락",
            message: `${pageName}의 클리핑 레이어 아래에 유효한 기준 레이어가 없습니다.`,
            remediation: "클리핑을 해제하거나 같은 그룹에서 기준 레이어 바로 위로 이동하세요.",
            pageId: page.id,
            pageIndex,
            elementId: el.id,
          });
        }
      }

      if (el.type === "image") inspectImageAsset(page, pageIndex, el, add);

      if (el.type === "bubble") {
        checkedDialogueCount += 1;
        inspectTextCharacters(page, pageIndex, el, add);
        inspectBubbleLettering(page, pageIndex, el, add, {
          minReadableFontSize,
          measurer,
        });
        if (el.tailAnchorId && !page.elements.some((candidate) => candidate.id === el.tailAnchorId)) {
          add({
            code: "DANGLING_BUBBLE_TAIL",
            category: "lettering",
            severity: "error",
            title: "말풍선 꼬리 대상 누락",
            message: `${pageName}의 말풍선 꼬리가 삭제된 요소 "${el.tailAnchorId}"을 가리킵니다.`,
            remediation: "꼬리 자동 부착 대상을 다시 선택하거나 수동 꼬리로 전환하세요.",
            pageId: page.id,
            pageIndex,
            elementId: el.id,
          });
        }
      } else if (el.type === "text") {
        checkedDialogueCount += 1;
        inspectTextCharacters(page, pageIndex, el, add);
        inspectTextLettering(page, pageIndex, el, add, minReadableFontSize);
      } else if (el.type === "sticker") {
        inspectTextCharacters(page, pageIndex, el, add);
      }

      if (
        !hidden &&
        (el.type === "bubble" || el.type === "text") &&
        el.text.trim().length >= 6
      ) {
        const key = normalizedDialogue(el.text);
        const idsForText = dialogueGroups.get(key) ?? [];
        idsForText.push(el.id);
        dialogueGroups.set(key, idsForText);
      }
    }

    if (visibleElementCount === 0) {
      add({
        code: "EMPTY_PAGE",
        category: "document",
        severity: review.status === "approved" ? "error" : "warning",
        title: "빈 페이지",
        message: `${pageName}에 표시되는 원고 요소가 없습니다.`,
        remediation: "원고를 추가하거나 불필요한 페이지를 삭제하세요.",
        pageId: page.id,
        pageIndex,
      });
    }

    if (review.status === "approved" && hiddenMeaningfulCount > 0) {
      add({
        code: "HIDDEN_CONTENT_ON_APPROVED_PAGE",
        category: "layer",
        severity: "review",
        title: "승인 페이지의 숨김 레이어",
        message: `${pageName}에 내용이 있는 숨김 레이어가 ${hiddenMeaningfulCount}개 남아 있습니다.`,
        remediation: "백업용 레이어인지 확인하고 최종 파일에 남길 필요가 없으면 정리하세요.",
        pageId: page.id,
        pageIndex,
        evidence: { hiddenLayerCount: hiddenMeaningfulCount },
      });
    }

    for (const [textKey, elementIds] of dialogueGroups) {
      if (elementIds.length < 2) continue;
      add({
        code: "DUPLICATE_DIALOGUE",
        category: "lettering",
        severity: "review",
        title: "중복 대사",
        message: `${pageName}에 같은 대사가 ${elementIds.length}번 있습니다: “${textKey.slice(0, 48)}${textKey.length > 48 ? "…" : ""}”`,
        remediation: "의도한 반복인지 확인하고 복제 실수라면 대사를 수정하세요.",
        pageId: page.id,
        pageIndex,
        elementId: elementIds[0],
        relatedElementIds: elementIds,
        idSuffix: textKey,
        evidence: { duplicateCount: elementIds.length },
      });
    }

    inspectFrameRhythm(page, pageIndex, visibleFrames, add, largeScrollGapPx);

    if (positive(page.canvasH) && visibleBounds.length > 0) {
      const firstTop = Math.min(...visibleBounds.map(({ bounds }) => bounds.top));
      const lastBottom = Math.max(...visibleBounds.map(({ bounds }) => bounds.bottom));
      if (firstTop > largeScrollGapPx) {
        add({
          code: "LARGE_TOP_GAP",
          category: "layout",
          severity: "review",
          title: "큰 시작 여백",
          message: `${pageName}의 첫 콘텐츠가 상단에서 ${Math.round(firstTop)}px 아래에 시작합니다.`,
          remediation: "회차 시작 호흡으로 의도한 여백인지 세로 스크롤 미리보기에서 확인하세요.",
          pageId: page.id,
          pageIndex,
          evidence: { gapPx: Math.round(firstTop) },
        });
      }
      const trailingGap = page.canvasH - lastBottom;
      if (
        trailingGap > largeScrollGapPx &&
        trailingGap > Math.min(2_400, page.canvasH * 0.25)
      ) {
        add({
          code: "LARGE_BOTTOM_GAP",
          category: "layout",
          severity: "review",
          title: "큰 끝 여백",
          message: `${pageName}의 마지막 콘텐츠 뒤에 ${Math.round(trailingGap)}px 여백이 남아 있습니다.`,
          remediation: "엔딩 호흡인지 확인하고, 아니라면 페이지 높이를 콘텐츠에 맞추세요.",
          pageId: page.id,
          pageIndex,
          evidence: { gapPx: Math.round(trailingGap) },
        });
      }
    }
  }

  if ((input.openCommentCount ?? 0) > 0) {
    add({
      code: "OPEN_EDITORIAL_COMMENTS",
      category: "workflow",
      severity: "error",
      title: "미해결 검토 댓글",
      message: `해결되지 않은 문서 댓글이 ${input.openCommentCount}개 있습니다.`,
      remediation: "댓글별 수정 사항을 반영하고 해결 상태로 변경하세요.",
      evidence: { openCommentCount: input.openCommentCount ?? 0 },
    });
  }

  for (let index = 0; index < (input.continuityIssues?.length ?? 0); index += 1) {
    const issue = input.continuityIssues![index]!;
    add({
      code: "CONTINUITY_ISSUE",
      category: "continuity",
      severity: issue.severity,
      title: CONTINUITY_TITLES[issue.code],
      message: issue.message,
      remediation:
        issue.severity === "error"
          ? "제작 바이블과 등장인물 식별을 먼저 바로잡으세요."
          : "의도한 변화라면 장면 비트에 전환 설명을 남기세요.",
      ...(issue.sceneRefs.length > 0
        ? { sceneId: issue.sceneRefs[issue.sceneRefs.length - 1]! }
        : {}),
      idSuffix: `${issue.code}:${issue.sceneRefs.join(",")}:${index}`,
      evidence: { relatedSceneCount: issue.sceneRefs.length },
    });
  }

  for (const issue of input.supplementalIssues ?? []) collected.push(issue);

  const sortedAll = sortIssues(dedupeIssues(collected));
  const suppressedIssueCount = Math.max(0, sortedAll.length - maxIssues);
  const visibleIssues = sortedAll.slice(0, maxIssues);
  if (suppressedIssueCount > 0) {
    visibleIssues.push(
      createStudioQualityIssue({
        code: "ISSUE_LIMIT_REACHED",
        category: "document",
        severity: "warning",
        title: "표시 한도 도달",
        message: `성능 보호를 위해 추가 문제 ${suppressedIssueCount}개를 목록에서 생략했습니다.`,
        remediation: "심각한 항목부터 수정한 뒤 다시 검사하세요.",
        evidence: { suppressedIssueCount },
      })
    );
  }

  const counts = severityCounts(visibleIssues);
  const penalty = visibleIssues.reduce(
    (sum, issue) =>
      issue.code === "ISSUE_LIMIT_REACHED" ? sum : sum + SEVERITY_WEIGHT[issue.severity],
    0
  );
  const readinessScore = Math.max(0, Math.min(100, 100 - penalty));

  return {
    basis: "studio-quality-inspection",
    version: STUDIO_QUALITY_INSPECTION_VERSION,
    canFinalize: counts.blocking === 0 && counts.error === 0,
    readinessScore,
    counts,
    categoryCounts: categoryCounts(visibleIssues),
    checkedPageCount: input.pages.length,
    checkedElementCount,
    checkedDialogueCount,
    revisionKey: computeStudioQualityRevisionKey(input),
    issues: visibleIssues,
    suppressedIssueCount,
  };
}
