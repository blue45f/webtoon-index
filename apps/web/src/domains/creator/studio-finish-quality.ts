/**
 * Studio final-manuscript quality inspection.
 *
 * The inspector is deliberately side-effect free. It reports document corruption,
 * production-readiness gaps and review warnings without mutating the artwork or
 * guessing mutable destination policies. Platform limits remain owned by the
 * destination-aware Publish Pack preflight.
 */

import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";
import { auditBubbleTextLegibility } from "./lettering/studio-bubble-legibility-contrast";
import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleLetterSpacing,
  bubbleTextFitsInBox,
  fitBubbleFontSize,
  resolveBubbleFontFamily,
  resolveBubbleFontSize,
  resolveBubbleFontStyle,
  resolveBubbleLineHeight,
} from "./lettering/studio-bubble-text-fit";
import { hasContiguousLayerGroups, missingLayerGroupIds } from "./studio-layers";
import { normalizePageReviewState } from "./studio-page-review";

import type { StudioCommentsDocument } from "./studio-comments";
import type {
  BubbleEl,
  DrawEl,
  El,
  StudioDialogueRangeFormat,
  StudioDialogueRubySpan,
  TextEl,
} from "./studio-element-model";
import type { LayerGroup } from "./studio-layers";
import type { PageState } from "./studio-page-state";

export const STUDIO_FINISH_QUALITY_VERSION = 1 as const;
export const STUDIO_FINISH_QUALITY_MAX_ISSUES = 500;

export const STUDIO_FINISH_QUALITY_SEVERITIES = [
  "blocker",
  "error",
  "warning",
  "info",
] as const;
export type StudioFinishQualitySeverity =
  (typeof STUDIO_FINISH_QUALITY_SEVERITIES)[number];

export const STUDIO_FINISH_QUALITY_CATEGORIES = [
  "document",
  "page",
  "review",
  "layer",
  "dialogue",
  "image",
  "animation",
  "stroke",
  "comments",
] as const;
export type StudioFinishQualityCategory =
  (typeof STUDIO_FINISH_QUALITY_CATEGORIES)[number];

export type StudioFinishQualityIssueCode =
  | "DOCUMENT_TITLE_MISSING"
  | "DOCUMENT_PAGES_MISSING"
  | "PAGE_ID_MISSING"
  | "PAGE_ID_DUPLICATE"
  | "PAGE_HEIGHT_INVALID"
  | "PAGE_EMPTY"
  | "PAGE_REVIEW_MISSING"
  | "PAGE_CHANGES_REQUESTED"
  | "PAGE_REVIEW_PENDING"
  | "PAGE_APPROVED_UNLOCKED"
  | "PAGE_LOCKED_BEFORE_APPROVAL"
  | "PAGE_REVIEW_ASSIGNEE_MISSING"
  | "GROUP_ID_MISSING"
  | "GROUP_ID_DUPLICATE"
  | "GROUP_REFERENCE_MISSING"
  | "GROUP_ORDER_NONCONTIGUOUS"
  | "ELEMENT_ID_MISSING"
  | "ELEMENT_ID_DUPLICATE"
  | "ELEMENT_GEOMETRY_INVALID"
  | "ELEMENT_OUTSIDE_PAGE"
  | "ELEMENT_PARTLY_OUTSIDE_PAGE"
  | "ELEMENT_OPACITY_INVALID"
  | "VISIBLE_PRODUCTION_GUIDE"
  | "DIALOGUE_EMPTY"
  | "DIALOGUE_PLACEHOLDER"
  | "DIALOGUE_CONTROL_CHARACTER"
  | "DIALOGUE_FONT_SIZE_INVALID"
  | "DIALOGUE_FONT_TOO_SMALL"
  | "DIALOGUE_ANNOTATION_INVALID"
  | "BUBBLE_SIZE_INVALID"
  | "BUBBLE_TEXT_OVERFLOW"
  | "BUBBLE_CONTRAST_LOW"
  | "BUBBLE_CONTRAST_UNVERIFIED"
  | "IMAGE_SOURCE_MISSING"
  | "IMAGE_SOURCE_EPHEMERAL"
  | "IMAGE_SOURCE_EXTERNAL"
  | "IMAGE_DATA_URL_INVALID"
  | "IMAGE_MASK_SOURCE_MISSING"
  | "IMAGE_FILTER_MASK_SOURCE_MISSING"
  | "ANIMATION_FRAMES_EMPTY"
  | "ANIMATION_FRAME_ID_MISSING"
  | "ANIMATION_FRAME_ID_DUPLICATE"
  | "ANIMATION_FRAME_SOURCE_MISSING"
  | "ANIMATION_ACTIVE_FRAME_MISSING"
  | "ANIMATION_SOURCE_MISMATCH"
  | "ANIMATION_TIMING_INVALID"
  | "ANIMATION_MODEL_CONFLICT"
  | "STROKE_POINTS_MISSING"
  | "STROKE_POINTS_ODD"
  | "STROKE_POINT_INVALID"
  | "STROKE_WIDTH_INVALID"
  | "STROKE_SAMPLE_COUNT_MISMATCH"
  | "COMMENTS_OPEN"
  | "COMMENT_PAGE_MISSING"
  | "COMMENT_TARGET_MISSING"
  | "COMMENT_POINT_INVALID";

export interface StudioFinishQualityIssue {
  readonly id: string;
  readonly fingerprint: string;
  readonly code: StudioFinishQualityIssueCode;
  readonly severity: StudioFinishQualitySeverity;
  readonly category: StudioFinishQualityCategory;
  readonly title: string;
  readonly message: string;
  readonly pageId?: string;
  readonly pageIndex?: number;
  readonly elementId?: string;
  readonly elementIndex?: number;
  readonly path?: string;
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
}

export interface StudioFinishQualityInput {
  readonly documentTitle?: string | null;
  readonly pages: readonly PageState[];
  readonly comments?: StudioCommentsDocument | null;
}

export interface StudioFinishQualityOptions {
  readonly includeHiddenElements?: boolean;
  readonly maxIssues?: number;
}

export interface StudioFinishQualityCounts {
  readonly blocker: number;
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
}

export type StudioFinishQualityStatus =
  | "blocked"
  | "needs-work"
  | "review"
  | "ready";

export interface StudioFinishQualityResult {
  readonly version: typeof STUDIO_FINISH_QUALITY_VERSION;
  readonly status: StudioFinishQualityStatus;
  readonly score: number;
  readonly canExport: boolean;
  readonly readyForFinalReview: boolean;
  readonly checkedPageCount: number;
  readonly checkedElementCount: number;
  readonly checkedDialogueCount: number;
  readonly checkedImageCount: number;
  readonly checkedStrokeCount: number;
  readonly openCommentCount: number;
  readonly counts: StudioFinishQualityCounts;
  readonly issues: readonly StudioFinishQualityIssue[];
  readonly truncated: boolean;
}

type ElementBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type InspectionCounters = {
  checkedElementCount: number;
  checkedDialogueCount: number;
  checkedImageCount: number;
  checkedStrokeCount: number;
};

const SEVERITY_ORDER: Readonly<Record<StudioFinishQualitySeverity, number>> = {
  blocker: 0,
  error: 1,
  warning: 2,
  info: 3,
};

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\{\{[^{}]+\}\}/u,
  /\$\{[^{}]+\}/u,
  /%(?:[A-Z][A-Z0-9_]*|\d+\$?[a-z])%/iu,
  /\b(?:TODO|TBD|FIXME|LOREM\s+IPSUM)\b/iu,
  /(?:대사|텍스트|문구)\s*(?:입력|예정|작성)/u,
];

const TEMPORARY_LAYER_PATTERN =
  /(?:^|[\s_[\]().-])(?:guide|reference|rough|draft|temp|note|가이드|참고|러프|임시|메모)(?:$|[\s_[\]().-])/iu;
function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function elementLabel(element: El): string {
  const authored = element.name?.trim();
  if (authored) return authored;
  const labels: Readonly<Record<El["type"], string>> = {
    image: "이미지",
    text: "텍스트",
    bubble: "말풍선",
    sticker: "스티커",
    draw: "드로잉",
    frame: "컷 프레임",
    focusLines: "집중선",
    speedLines: "속도선",
  };
  return labels[element.type];
}

function pageLabel(page: PageState, index: number): string {
  return page.name?.trim() || `${index + 1}페이지`;
}

function groupHidden(element: El, groups: readonly LayerGroup[]): boolean {
  if (element.hidden === true) return true;
  if (!element.groupId) return false;
  return groups.find((group) => group.id === element.groupId)?.hidden === true;
}

function pointBox(points: readonly number[]): ElementBox | null {
  if (points.length < 2) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function elementBox(element: El): ElementBox | null {
  switch (element.type) {
    case "image":
    case "bubble":
    case "frame":
    case "focusLines":
    case "speedLines":
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
    case "text": {
      const lineCount = Math.max(1, element.text.split("\n").length);
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: Math.max(element.fontSize, lineCount * element.fontSize * (element.lineHeight ?? 1.4)),
      };
    }
    case "sticker":
      return {
        x: element.x,
        y: element.y,
        width: Math.max(element.fontSize, [...element.text].length * element.fontSize * 0.65),
        height: Math.max(1, element.fontSize * 1.4),
      };
    case "draw":
      return pointBox(element.points);
  }
}

function invalidBox(box: ElementBox): boolean {
  return (
    !finiteNumber(box.x) ||
    !finiteNumber(box.y) ||
    !finitePositive(box.width) ||
    !finitePositive(box.height)
  );
}

function fullyOutsidePage(box: ElementBox, canvasHeight: number): boolean {
  return (
    box.x + box.width <= 0 ||
    box.y + box.height <= 0 ||
    box.x >= STUDIO_CANVAS_WIDTH ||
    box.y >= canvasHeight
  );
}

function partlyOutsidePage(box: ElementBox, canvasHeight: number): boolean {
  return (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > STUDIO_CANVAS_WIDTH ||
    box.y + box.height > canvasHeight
  );
}

function invalidAnnotationSpan(
  span: StudioDialogueRubySpan | StudioDialogueRangeFormat,
  textLength: number
): boolean {
  return (
    !Number.isSafeInteger(span.start) ||
    !Number.isSafeInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > textLength
  );
}

function countResult(issues: readonly StudioFinishQualityIssue[]): StudioFinishQualityCounts {
  const counts = { blocker: 0, error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { ...counts, total: issues.length };
}

function scoreFor(counts: StudioFinishQualityCounts): number {
  const penalty =
    counts.blocker * 25 + counts.error * 10 + counts.warning * 2 + counts.info * 0.25;
  return Math.max(0, Math.round(100 - Math.min(100, penalty)));
}

function statusFor(counts: StudioFinishQualityCounts): StudioFinishQualityStatus {
  if (counts.blocker > 0) return "blocked";
  if (counts.error > 0) return "needs-work";
  if (counts.warning > 0) return "review";
  return "ready";
}

function inspectAnnotations(
  element: TextEl | BubbleEl,
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void,
  location: Pick<StudioFinishQualityIssue, "pageId" | "pageIndex" | "elementId" | "elementIndex">
): void {
  const invalidRuby = element.rubySpans?.filter((span) => invalidAnnotationSpan(span, element.text.length)) ?? [];
  const invalidFormats =
    element.rangeFormats?.filter((span) => invalidAnnotationSpan(span, element.text.length)) ?? [];
  const emptyRuby = element.rubySpans?.filter((span) => !span.ruby.trim()).length ?? 0;
  if (invalidRuby.length === 0 && invalidFormats.length === 0 && emptyRuby === 0) return;
  add({
    ...location,
    code: "DIALOGUE_ANNOTATION_INVALID",
    severity: "error",
    category: "dialogue",
    title: "대사 주석 범위가 손상되었습니다",
    message: "루비 또는 부분 서식 범위가 대사 길이를 벗어나거나 비어 있습니다.",
    path: `${location.pageId}.elements.${location.elementId}`,
    evidence: {
      invalidRuby: invalidRuby.length,
      invalidRangeFormats: invalidFormats.length,
      emptyRuby,
    },
  });
}

function inspectDialogue(
  element: TextEl | BubbleEl,
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void,
  location: Pick<StudioFinishQualityIssue, "pageId" | "pageIndex" | "elementId" | "elementIndex">
): void {
  const text = element.text;
  const label = element.type === "bubble" ? "말풍선" : "텍스트";
  if (!text.trim()) {
    add({
      ...location,
      code: "DIALOGUE_EMPTY",
      severity: element.type === "bubble" ? "error" : "warning",
      category: "dialogue",
      title: `${label} 내용이 비어 있습니다`,
      message: "의도한 빈 요소인지 확인하고, 불필요한 요소라면 제거하세요.",
    });
  }
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
    add({
      ...location,
      code: "DIALOGUE_PLACEHOLDER",
      severity: "error",
      category: "dialogue",
      title: "임시 문구가 남아 있습니다",
      message: `최종 원고에 치환되지 않은 문구가 있습니다: ${text.trim().slice(0, 80)}`,
    });
  }
  if (hasControlCharacter(text)) {
    add({
      ...location,
      code: "DIALOGUE_CONTROL_CHARACTER",
      severity: "error",
      category: "dialogue",
      title: "보이지 않는 제어 문자가 있습니다",
      message: "복사·붙여넣기 과정에서 들어온 제어 문자는 검색과 내보내기를 방해할 수 있습니다.",
    });
  }

  const fontSize = element.type === "bubble" ? resolveBubbleFontSize(element.fontSize) : element.fontSize;
  if (!finitePositive(fontSize)) {
    add({
      ...location,
      code: "DIALOGUE_FONT_SIZE_INVALID",
      severity: "blocker",
      category: "dialogue",
      title: "글자 크기가 유효하지 않습니다",
      message: "글자 크기는 0보다 큰 유한한 값이어야 합니다.",
      evidence: { fontSize: Number.isFinite(fontSize) ? fontSize : String(fontSize) },
    });
  } else if (fontSize < 12) {
    add({
      ...location,
      code: "DIALOGUE_FONT_TOO_SMALL",
      severity: "warning",
      category: "dialogue",
      title: "모바일에서 글자가 작게 보일 수 있습니다",
      message: `현재 글자 크기는 ${fontSize}px입니다. 실제 독자 폭 미리보기에서 가독성을 확인하세요.`,
      evidence: { fontSize },
    });
  }

  inspectAnnotations(element, add, location);
}

function inspectBubble(
  bubble: BubbleEl,
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void,
  location: Pick<StudioFinishQualityIssue, "pageId" | "pageIndex" | "elementId" | "elementIndex">
): void {
  if (!finitePositive(bubble.width) || !finitePositive(bubble.height)) {
    add({
      ...location,
      code: "BUBBLE_SIZE_INVALID",
      severity: "blocker",
      category: "dialogue",
      title: "말풍선 크기가 손상되었습니다",
      message: "말풍선 너비와 높이는 0보다 큰 유한한 값이어야 합니다.",
    });
    return;
  }

  const fontSize = resolveBubbleFontSize(bubble.fontSize);
  const fitInput = {
    text: bubble.text,
    boxWidth: bubble.width,
    boxHeight: bubble.height,
    fontFamily: resolveBubbleFontFamily(bubble.font),
    fontStyle: resolveBubbleFontStyle(bubble.fontStyle),
    lineHeight: resolveBubbleLineHeight({
      lineHeight: bubble.lineHeight,
      vertical: bubble.vertical,
    }),
    vertical: bubble.vertical,
    letterSpacing: bubbleLetterSpacing(),
  };
  const overflows = bubble.autoShrinkText
    ? fitBubbleFontSize({
        ...fitInput,
        maxFontSize: fontSize,
        minFontSize: bubble.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
      }).overflow
    : !bubbleTextFitsInBox(fitInput, fontSize);
  if (overflows) {
    add({
      ...location,
      code: "BUBBLE_TEXT_OVERFLOW",
      severity: "error",
      category: "dialogue",
      title: "말풍선 대사가 잘릴 수 있습니다",
      message: "현재 조판 규칙에서 대사가 말풍선 안에 모두 들어가지 않습니다.",
      evidence: {
        width: bubble.width,
        height: bubble.height,
        fontSize,
        autoShrink: bubble.autoShrinkText === true,
      },
    });
  }

  const contrast = auditBubbleTextLegibility({
    textColor: bubble.textFill,
    backdropColor: bubble.fill,
    backdropIsGradient: bubble.gradient !== undefined,
    fontSizePx: fontSize,
    fontStyle: bubble.fontStyle,
  });
  if (contrast.verdict === "fail") {
    add({
      ...location,
      code: "BUBBLE_CONTRAST_LOW",
      severity: "warning",
      category: "dialogue",
      title: "말풍선 글자 대비가 낮습니다",
      message: `명도 대비 ${contrast.ratio ?? "?"}:1이 기준 ${contrast.threshold ?? "?"}:1보다 낮습니다.`,
      evidence: {
        ratio: contrast.ratio ?? 0,
        threshold: contrast.threshold ?? 0,
        criterion: contrast.successCriterion ?? "unknown",
      },
    });
  } else if (contrast.verdict === "indeterminate") {
    add({
      ...location,
      code: "BUBBLE_CONTRAST_UNVERIFIED",
      severity: "info",
      category: "dialogue",
      title: "말풍선 대비를 자동 판정하지 못했습니다",
      message: `그라데이션·반투명·색상 형식 등으로 픽셀 기반 확인이 필요합니다 (${contrast.reason ?? "unknown"}).`,
    });
  }
}

function inspectImage(
  image: Extract<El, { type: "image" }>,
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void,
  location: Pick<StudioFinishQualityIssue, "pageId" | "pageIndex" | "elementId" | "elementIndex">
): void {
  const source = image.src.trim();
  if (!source) {
    add({
      ...location,
      code: "IMAGE_SOURCE_MISSING",
      severity: "error",
      category: "image",
      title: "이미지 원본이 없습니다",
      message: "빈 이미지 요소는 렌더링과 출고 패키지에서 누락됩니다.",
    });
  } else if (source.startsWith("blob:")) {
    add({
      ...location,
      code: "IMAGE_SOURCE_EPHEMERAL",
      severity: "error",
      category: "image",
      title: "임시 Blob 이미지가 남아 있습니다",
      message: "Blob URL은 브라우저 세션이 끝나면 복원할 수 없습니다. 영구 자산으로 저장하세요.",
    });
  } else if (/^https?:\/\//iu.test(source)) {
    add({
      ...location,
      code: "IMAGE_SOURCE_EXTERNAL",
      severity: "warning",
      category: "image",
      title: "외부 이미지 연결을 확인하세요",
      message: "외부 URL은 만료·권한·CORS 변경으로 출고 시점에 실패할 수 있습니다.",
    });
  } else if (source.startsWith("data:") && !/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/iu.test(source)) {
    add({
      ...location,
      code: "IMAGE_DATA_URL_INVALID",
      severity: "error",
      category: "image",
      title: "이미지 Data URL 형식이 손상되었습니다",
      message: "유효한 이미지 MIME과 데이터 구분 쉼표가 필요합니다.",
    });
  }

  if (image.maskEnabled === true && !image.maskSrc?.trim()) {
    add({
      ...location,
      code: "IMAGE_MASK_SOURCE_MISSING",
      severity: "error",
      category: "image",
      title: "활성 레이어 마스크 원본이 없습니다",
      message: "마스크를 끄거나 마스크 이미지를 다시 연결하세요.",
    });
  }
  if (
    image.filterMaskEnabled === true &&
    !image.filterMaskSurfaceId &&
    !image.filterMaskSrc?.trim()
  ) {
    add({
      ...location,
      code: "IMAGE_FILTER_MASK_SOURCE_MISSING",
      severity: "error",
      category: "image",
      title: "활성 필터 마스크 원본이 없습니다",
      message: "필터 마스크 표면 또는 로컬 마스크 이미지를 다시 연결하세요.",
    });
  }

  const frames = image.frames;
  if (frames !== undefined) {
    if (frames.length === 0) {
      add({
        ...location,
        code: "ANIMATION_FRAMES_EMPTY",
        severity: "error",
        category: "animation",
        title: "애니메이션 프레임이 비어 있습니다",
        message: "프레임 배열이 있는 이미지에는 최소 한 장의 프레임이 필요합니다.",
      });
    }
    const frameIds = new Set<string>();
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const id = frame.id.trim();
      if (!id) {
        add({
          ...location,
          code: "ANIMATION_FRAME_ID_MISSING",
          severity: "error",
          category: "animation",
          title: "애니메이션 프레임 식별자가 비어 있습니다",
          message: `${index + 1}번째 프레임에 안정적인 식별자가 필요합니다.`,
        });
      } else if (frameIds.has(id)) {
        add({
          ...location,
          code: "ANIMATION_FRAME_ID_DUPLICATE",
          severity: "error",
          category: "animation",
          title: "애니메이션 프레임 식별자가 중복되었습니다",
          message: `프레임 ID ${id}가 두 번 이상 사용되었습니다.`,
        });
      } else {
        frameIds.add(id);
      }
      if (!frame.src.trim()) {
        add({
          ...location,
          code: "ANIMATION_FRAME_SOURCE_MISSING",
          severity: "error",
          category: "animation",
          title: "애니메이션 프레임 이미지가 없습니다",
          message: `${index + 1}번째 프레임의 래스터 원본이 비어 있습니다.`,
        });
      }
      if (frame.durationMs !== undefined && !finitePositive(frame.durationMs)) {
        add({
          ...location,
          code: "ANIMATION_TIMING_INVALID",
          severity: "error",
          category: "animation",
          title: "애니메이션 프레임 시간이 유효하지 않습니다",
          message: `${index + 1}번째 프레임 노출 시간은 0보다 커야 합니다.`,
        });
      }
    }
    if (image.activeFrameId && !frameIds.has(image.activeFrameId)) {
      add({
        ...location,
        code: "ANIMATION_ACTIVE_FRAME_MISSING",
        severity: "error",
        category: "animation",
        title: "현재 애니메이션 프레임을 찾을 수 없습니다",
        message: `activeFrameId ${image.activeFrameId}가 프레임 목록에 없습니다.`,
      });
    }
    const activeFrame = image.activeFrameId
      ? frames.find((frame) => frame.id === image.activeFrameId)
      : frames[0];
    if (activeFrame?.src && source && activeFrame.src !== source) {
      add({
        ...location,
        code: "ANIMATION_SOURCE_MISMATCH",
        severity: "warning",
        category: "animation",
        title: "표시 이미지와 활성 프레임이 다릅니다",
        message: "저장·미리보기·내보내기 경로에서 서로 다른 프레임이 보일 수 있습니다.",
      });
    }
    if (image.frameFps !== undefined && !finitePositive(image.frameFps)) {
      add({
        ...location,
        code: "ANIMATION_TIMING_INVALID",
        severity: "error",
        category: "animation",
        title: "애니메이션 FPS가 유효하지 않습니다",
        message: "FPS는 0보다 큰 유한한 값이어야 합니다.",
      });
    }
  }
  if (image.isAnimatedGif === true && frames !== undefined) {
    add({
      ...location,
      code: "ANIMATION_MODEL_CONFLICT",
      severity: "error",
      category: "animation",
      title: "두 애니메이션 모델이 동시에 설정되었습니다",
      message: "브라우저 GIF 재생과 Studio 셀 프레임 배열 중 하나만 사용하세요.",
    });
  }
}

function inspectDraw(
  draw: DrawEl,
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void,
  location: Pick<StudioFinishQualityIssue, "pageId" | "pageIndex" | "elementId" | "elementIndex">
): void {
  if (draw.points.length < 2) {
    add({
      ...location,
      code: "STROKE_POINTS_MISSING",
      severity: "warning",
      category: "stroke",
      title: "빈 획이 남아 있습니다",
      message: "화면에 보이지 않는 획은 문서와 히스토리 크기만 늘릴 수 있습니다.",
    });
  }
  if (draw.points.length % 2 !== 0) {
    add({
      ...location,
      code: "STROKE_POINTS_ODD",
      severity: "blocker",
      category: "stroke",
      title: "획 좌표 배열이 손상되었습니다",
      message: "x/y 좌표 쌍이 완성되지 않아 안정적으로 렌더링할 수 없습니다.",
      evidence: { pointValueCount: draw.points.length },
    });
  }
  const invalidPointCount = draw.points.filter((value) => !Number.isFinite(value)).length;
  if (invalidPointCount > 0) {
    add({
      ...location,
      code: "STROKE_POINT_INVALID",
      severity: "blocker",
      category: "stroke",
      title: "획에 유효하지 않은 좌표가 있습니다",
      message: "NaN 또는 무한대 좌표는 렌더러와 내보내기 결과를 손상시킬 수 있습니다.",
      evidence: { invalidPointCount },
    });
  }
  if (!finitePositive(draw.strokeWidth)) {
    add({
      ...location,
      code: "STROKE_WIDTH_INVALID",
      severity: "blocker",
      category: "stroke",
      title: "획 굵기가 유효하지 않습니다",
      message: "획 굵기는 0보다 큰 유한한 값이어야 합니다.",
    });
  }
  const expectedSampleCount = Math.floor(draw.points.length / 2);
  const sampleArrays: ReadonlyArray<readonly number[] | undefined> = [
    draw.pressures,
    draw.tiltXs,
    draw.tiltYs,
    draw.twists,
    draw.speeds,
    draw.tangentialPressures,
    draw.altitudeAngles,
    draw.azimuthAngles,
    draw.contactWidths,
    draw.contactHeights,
    draw.sampleTimeOffsets,
  ];
  const mismatchedArrays = sampleArrays.filter(
    (samples) => samples !== undefined && samples.length !== expectedSampleCount
  ).length;
  if (mismatchedArrays > 0) {
    add({
      ...location,
      code: "STROKE_SAMPLE_COUNT_MISMATCH",
      severity: "warning",
      category: "stroke",
      title: "획 입력 샘플 수가 좌표 수와 다릅니다",
      message: "필압·기울기·시간 샘플이 좌표와 어긋나 재생 품질이 달라질 수 있습니다.",
      evidence: { expectedSampleCount, mismatchedArrays },
    });
  }
}

function inspectComments(
  comments: StudioCommentsDocument | null | undefined,
  pages: readonly PageState[],
  add: (issue: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => void
): number {
  if (!comments) return 0;
  const pageById = new Map(pages.map((page, index) => [page.id, { page, index }]));
  const openThreads = comments.threads.filter((thread) => !thread.resolved);
  if (openThreads.length > 0) {
    add({
      code: "COMMENTS_OPEN",
      severity: "warning",
      category: "comments",
      title: "해결되지 않은 검수 댓글이 있습니다",
      message: `최종 승인 전에 열린 댓글 ${openThreads.length}개의 반영 여부를 확인하세요.`,
      evidence: { openCommentCount: openThreads.length },
    });
  }

  for (const thread of comments.threads) {
    const anchor = thread.anchor;
    const owner = pageById.get(anchor.pageId);
    if (!owner) {
      add({
        code: "COMMENT_PAGE_MISSING",
        severity: "error",
        category: "comments",
        title: "댓글이 삭제된 페이지를 가리킵니다",
        message: `댓글 ${thread.id}의 페이지 ${anchor.pageId}를 찾을 수 없습니다.`,
        pageId: anchor.pageId,
      });
      continue;
    }
    const location = { pageId: owner.page.id, pageIndex: owner.index };
    if (anchor.type === "element") {
      const target = owner.page.elements.find((element) => element.id === anchor.elementId);
      if (!target) {
        add({
          ...location,
          elementId: anchor.elementId,
          code: "COMMENT_TARGET_MISSING",
          severity: "error",
          category: "comments",
          title: "댓글이 삭제된 요소를 가리킵니다",
          message: `댓글 ${thread.id}의 요소 ${anchor.elementId}를 찾을 수 없습니다.`,
        });
      }
    } else if (anchor.type === "frame") {
      const target = owner.page.elements.find(
        (element) => element.id === anchor.frameId && element.type === "frame"
      );
      if (!target) {
        add({
          ...location,
          elementId: anchor.frameId,
          code: "COMMENT_TARGET_MISSING",
          severity: "error",
          category: "comments",
          title: "댓글이 삭제된 컷을 가리킵니다",
          message: `댓글 ${thread.id}의 컷 ${anchor.frameId}를 찾을 수 없습니다.`,
        });
      }
    } else if (
      anchor.type === "point" &&
      (!Number.isFinite(anchor.x) ||
        !Number.isFinite(anchor.y) ||
        anchor.x < 0 ||
        anchor.x > 1 ||
        anchor.y < 0 ||
        anchor.y > 1)
    ) {
      add({
        ...location,
        code: "COMMENT_POINT_INVALID",
        severity: "error",
        category: "comments",
        title: "댓글 핀 좌표가 유효하지 않습니다",
        message: `댓글 ${thread.id}의 정규화 좌표는 0부터 1 사이여야 합니다.`,
      });
    }
  }
  return openThreads.length;
}

/** Runs deterministic, local-only final-manuscript checks. */
export function inspectStudioFinishQuality(
  input: StudioFinishQualityInput,
  options: StudioFinishQualityOptions = {}
): StudioFinishQualityResult {
  const issues: StudioFinishQualityIssue[] = [];
  const fingerprints = new Set<string>();
  const maxIssues = Math.max(1, Math.floor(options.maxIssues ?? STUDIO_FINISH_QUALITY_MAX_ISSUES));
  let truncated = false;
  const counters: InspectionCounters = {
    checkedElementCount: 0,
    checkedDialogueCount: 0,
    checkedImageCount: 0,
    checkedStrokeCount: 0,
  };

  const add = (draft: Omit<StudioFinishQualityIssue, "id" | "fingerprint">) => {
    const fingerprint = [
      draft.code,
      draft.pageId ?? "",
      draft.elementId ?? "",
      draft.path ?? "",
      draft.message,
    ].join("|");
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    if (issues.length >= maxIssues) {
      truncated = true;
      return;
    }
    issues.push({
      ...draft,
      id: `finish-${stableHash(fingerprint)}`,
      fingerprint,
    });
  };

  if (!input.documentTitle?.trim()) {
    add({
      code: "DOCUMENT_TITLE_MISSING",
      severity: "warning",
      category: "document",
      title: "작품 제목이 비어 있습니다",
      message: "검수 보고서와 게시 패키지에서 식별할 제목을 입력하세요.",
      path: "documentTitle",
    });
  }
  if (input.pages.length === 0) {
    add({
      code: "DOCUMENT_PAGES_MISSING",
      severity: "blocker",
      category: "document",
      title: "검사할 페이지가 없습니다",
      message: "최종 원고에는 최소 한 개의 페이지가 필요합니다.",
      path: "pages",
    });
  }

  const pageIds = new Set<string>();
  for (let pageIndex = 0; pageIndex < input.pages.length; pageIndex += 1) {
    const page = input.pages[pageIndex];
    const pageId = page.id.trim();
    const location = { pageId: page.id, pageIndex };
    if (!pageId) {
      add({
        ...location,
        code: "PAGE_ID_MISSING",
        severity: "blocker",
        category: "page",
        title: "페이지 식별자가 비어 있습니다",
        message: `${pageLabel(page, pageIndex)}에 안정적인 식별자가 필요합니다.`,
        path: `pages[${pageIndex}].id`,
      });
    } else if (pageIds.has(pageId)) {
      add({
        ...location,
        code: "PAGE_ID_DUPLICATE",
        severity: "blocker",
        category: "page",
        title: "페이지 식별자가 중복되었습니다",
        message: `페이지 ID ${pageId}가 두 번 이상 사용되었습니다.`,
        path: `pages[${pageIndex}].id`,
      });
    } else {
      pageIds.add(pageId);
    }

    if (!finitePositive(page.canvasH)) {
      add({
        ...location,
        code: "PAGE_HEIGHT_INVALID",
        severity: "blocker",
        category: "page",
        title: "페이지 높이가 유효하지 않습니다",
        message: "페이지 높이는 0보다 큰 유한한 값이어야 합니다.",
        path: `pages[${pageIndex}].canvasH`,
      });
    }
    if (page.elements.length === 0) {
      add({
        ...location,
        code: "PAGE_EMPTY",
        severity: "warning",
        category: "page",
        title: "빈 페이지가 포함되어 있습니다",
        message: `${pageLabel(page, pageIndex)}에 표시할 요소가 없습니다.`,
      });
    }

    const review = normalizePageReviewState(page.review);
    if (page.review === undefined) {
      add({
        ...location,
        code: "PAGE_REVIEW_MISSING",
        severity: "warning",
        category: "review",
        title: "페이지 검토 상태가 없습니다",
        message: `${pageLabel(page, pageIndex)}의 담당자와 승인 상태를 확인하세요.`,
      });
    } else if (review.status === "changes-requested") {
      add({
        ...location,
        code: "PAGE_CHANGES_REQUESTED",
        severity: "error",
        category: "review",
        title: "수정 요청이 남아 있습니다",
        message: `${pageLabel(page, pageIndex)}의 수정 요청을 반영한 뒤 다시 승인받으세요.`,
      });
    } else if (review.status !== "approved") {
      add({
        ...location,
        code: "PAGE_REVIEW_PENDING",
        severity: "warning",
        category: "review",
        title: "최종 승인이 완료되지 않았습니다",
        message: `${pageLabel(page, pageIndex)}의 현재 상태는 ${review.status}입니다.`,
      });
    }
    if (review.status === "approved" && !review.locked) {
      add({
        ...location,
        code: "PAGE_APPROVED_UNLOCKED",
        severity: "warning",
        category: "review",
        title: "승인된 페이지가 편집 가능 상태입니다",
        message: "승인 이후 변경을 막거나 마지막 변경 내용을 다시 검토하세요.",
      });
    }
    if (review.locked && review.status !== "approved") {
      add({
        ...location,
        code: "PAGE_LOCKED_BEFORE_APPROVAL",
        severity: "warning",
        category: "review",
        title: "승인 전 페이지가 잠겨 있습니다",
        message: "수정이 필요한 상태에서 편집 잠금이 걸렸는지 확인하세요.",
      });
    }
    if (
      (review.status === "needs-review" || review.status === "changes-requested") &&
      !review.assignee
    ) {
      add({
        ...location,
        code: "PAGE_REVIEW_ASSIGNEE_MISSING",
        severity: "info",
        category: "review",
        title: "검토 담당자가 지정되지 않았습니다",
        message: "마감 직전 책임 소재가 분명하도록 담당자를 지정하는 것을 권장합니다.",
      });
    }

    const groups = page.groups ?? [];
    const groupIds = new Set<string>();
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const groupId = groups[groupIndex].id.trim();
      if (!groupId) {
        add({
          ...location,
          code: "GROUP_ID_MISSING",
          severity: "error",
          category: "layer",
          title: "레이어 그룹 식별자가 비어 있습니다",
          message: `${groupIndex + 1}번째 그룹에 안정적인 ID가 필요합니다.`,
        });
      } else if (groupIds.has(groupId)) {
        add({
          ...location,
          code: "GROUP_ID_DUPLICATE",
          severity: "error",
          category: "layer",
          title: "레이어 그룹 식별자가 중복되었습니다",
          message: `그룹 ID ${groupId}가 두 번 이상 사용되었습니다.`,
        });
      } else {
        groupIds.add(groupId);
      }
    }
    const missingGroups = missingLayerGroupIds(page.elements, groups);
    for (const missingGroupId of missingGroups) {
      add({
        ...location,
        code: "GROUP_REFERENCE_MISSING",
        severity: "error",
        category: "layer",
        title: "요소가 존재하지 않는 그룹을 참조합니다",
        message: `그룹 ${missingGroupId}의 메타데이터를 찾을 수 없습니다.`,
      });
    }
    if (!hasContiguousLayerGroups(page.elements)) {
      add({
        ...location,
        code: "GROUP_ORDER_NONCONTIGUOUS",
        severity: "error",
        category: "layer",
        title: "레이어 그룹 순서가 분리되어 있습니다",
        message: "같은 그룹의 요소는 z-order에서 하나의 연속 구간이어야 합니다.",
      });
    }

    const elementIds = new Set<string>();
    for (let elementIndex = 0; elementIndex < page.elements.length; elementIndex += 1) {
      const element = page.elements[elementIndex];
      const elementId = element.id.trim();
      const elementLocation = {
        ...location,
        elementId: element.id,
        elementIndex,
      };
      counters.checkedElementCount += 1;
      if (!elementId) {
        add({
          ...elementLocation,
          code: "ELEMENT_ID_MISSING",
          severity: "blocker",
          category: "layer",
          title: "요소 식별자가 비어 있습니다",
          message: `${elementLabel(element)} 요소에 안정적인 ID가 필요합니다.`,
        });
      } else if (elementIds.has(elementId)) {
        add({
          ...elementLocation,
          code: "ELEMENT_ID_DUPLICATE",
          severity: "blocker",
          category: "layer",
          title: "페이지 안의 요소 ID가 중복되었습니다",
          message: `요소 ID ${elementId}가 두 번 이상 사용되었습니다.`,
        });
      } else {
        elementIds.add(elementId);
      }

      if (
        element.opacity !== undefined &&
        (!Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1)
      ) {
        add({
          ...elementLocation,
          code: "ELEMENT_OPACITY_INVALID",
          severity: "error",
          category: "layer",
          title: "요소 불투명도가 유효하지 않습니다",
          message: "불투명도는 0부터 1 사이의 유한한 값이어야 합니다.",
          evidence: { opacity: Number.isFinite(element.opacity) ? element.opacity : String(element.opacity) },
        });
      }

      const box = elementBox(element);
      if (box && invalidBox(box)) {
        add({
          ...elementLocation,
          code: "ELEMENT_GEOMETRY_INVALID",
          severity: "blocker",
          category: "page",
          title: "요소 기하 정보가 손상되었습니다",
          message: `${elementLabel(element)}의 위치와 크기를 안정적으로 계산할 수 없습니다.`,
        });
      } else if (
        box &&
        finitePositive(page.canvasH) &&
        element.type !== "focusLines" &&
        element.type !== "speedLines"
      ) {
        if (fullyOutsidePage(box, page.canvasH)) {
          add({
            ...elementLocation,
            code: "ELEMENT_OUTSIDE_PAGE",
            severity: "error",
            category: "page",
            title: "요소가 페이지 밖에 있습니다",
            message: `${elementLabel(element)}가 최종 원고에 전혀 보이지 않습니다.`,
          });
        } else if (partlyOutsidePage(box, page.canvasH)) {
          add({
            ...elementLocation,
            code: "ELEMENT_PARTLY_OUTSIDE_PAGE",
            severity: "warning",
            category: "page",
            title: "요소가 페이지 경계를 벗어납니다",
            message: `${elementLabel(element)} 일부가 내보내기에서 잘릴 수 있습니다.`,
          });
        }
      }

      if (
        !groupHidden(element, groups) &&
        element.name &&
        TEMPORARY_LAYER_PATTERN.test(` ${element.name.trim()} `)
      ) {
        add({
          ...elementLocation,
          code: "VISIBLE_PRODUCTION_GUIDE",
          severity: "warning",
          category: "layer",
          title: "제작용 가이드 레이어가 보입니다",
          message: `“${element.name.trim()}” 레이어가 최종 원고에 노출되는지 확인하세요.`,
        });
      }

      if (!options.includeHiddenElements && groupHidden(element, groups)) continue;
      if (element.type === "text" || element.type === "bubble") {
        counters.checkedDialogueCount += 1;
        inspectDialogue(element, add, elementLocation);
        if (element.type === "bubble") inspectBubble(element, add, elementLocation);
      } else if (element.type === "image") {
        counters.checkedImageCount += 1;
        inspectImage(element, add, elementLocation);
      } else if (element.type === "draw") {
        counters.checkedStrokeCount += 1;
        inspectDraw(element, add, elementLocation);
      }
    }
  }

  const openCommentCount = inspectComments(input.comments, input.pages, add);
  issues.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.pageIndex ?? Number.MAX_SAFE_INTEGER) - (b.pageIndex ?? Number.MAX_SAFE_INTEGER) ||
    (a.elementIndex ?? Number.MAX_SAFE_INTEGER) - (b.elementIndex ?? Number.MAX_SAFE_INTEGER) ||
    a.code.localeCompare(b.code) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
  const counts = countResult(issues);
  return {
    version: STUDIO_FINISH_QUALITY_VERSION,
    status: statusFor(counts),
    score: scoreFor(counts),
    canExport: counts.blocker === 0,
    readyForFinalReview: counts.blocker === 0 && counts.error === 0,
    checkedPageCount: input.pages.length,
    checkedElementCount: counters.checkedElementCount,
    checkedDialogueCount: counters.checkedDialogueCount,
    checkedImageCount: counters.checkedImageCount,
    checkedStrokeCount: counters.checkedStrokeCount,
    openCommentCount,
    counts,
    issues,
    truncated,
  };
}

export function serializeStudioFinishQualityReport(
  result: StudioFinishQualityResult,
  space = 2
): string {
  return JSON.stringify(result, null, Math.max(0, Math.min(8, Math.floor(space))));
}
