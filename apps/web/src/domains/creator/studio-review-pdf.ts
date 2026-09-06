/**
 * Studio Review PDF — 내부 회람용 PDF 프로필과 주석 페이지 합성.
 *
 * 공개 게시 이미지/manifest와 분리된 review.pdf 전용 경계다. 기본 `image-only` 프로필은
 * 기존 renderPagesToPdf를 그대로 호출하므로 레거시 출력 바이트와 페이지 크기를 바꾸지 않는다.
 * 나머지 프로필만 원본 페이지 왼쪽에 인쇄 친화적인 검토 레일을 붙여 페이지 이름·검토 상태·
 * 콘티 메모·컷 캡션·대사를 시각적으로 굽는다. 텍스트는 PDF 문자열 오브젝트가 아니라 JPEG
 * 캔버스에만 그려져 PDF 인젝션이나 폰트 임베드 문제를 만들지 않는다.
 *
 * 이 모듈은 어떤 메타데이터도 public manifest로 직렬화하지 않는다. 호출자는 반드시 내부
 * review.pdf Blob에만 결과를 넣어야 한다.
 */

import { renderPagesToPdf } from "./export/studio-pdf-export";
import { normalizePageReviewState, PAGE_REVIEW_STATUS_LABELS } from "./studio-page-review";
import { cameraAngleLabel, shotTypeLabel } from "./studio-panel-shot-tags";
import {
  getStudioReviewPdfProfile,
  normalizeStudioReviewPdfProfileId,
} from "./studio-review-pdf-profile";

import type { PdfPagesRenderOptions, PdfRenderResult } from "./export/studio-pdf-export";
import type { StudioReviewPdfFields } from "./studio-review-pdf-profile";
import type { WatermarkSettings } from "./studio-watermark";

export {
  STUDIO_REVIEW_PDF_PROFILE_IDS,
  STUDIO_REVIEW_PDF_PROFILES,
  getStudioReviewPdfProfile,
  normalizeStudioReviewPdfProfileId,
} from "./studio-review-pdf-profile";
export type {
  StudioReviewPdfFields,
  StudioReviewPdfProfile,
  StudioReviewPdfProfileId,
} from "./studio-review-pdf-profile";

export const STUDIO_REVIEW_PDF_LIMITS = {
  pageTitle: 80,
  pageNote: 1_000,
  reviewAssignee: 80,
  reviewNote: 2_000,
  panelCaption: 500,
  dialogue: 1_000,
  panelsPerPage: 100,
  dialogueItemsPerPage: 200,
} as const;

export interface StudioReviewPdfPageLike {
  id?: unknown;
  name?: unknown;
  note?: unknown;
  review?: unknown;
  shotType?: unknown;
  cameraAngle?: unknown;
  groups?: readonly unknown[];
  elements?: readonly unknown[];
}

export interface StudioReviewPdfPanelMetadata {
  id: string;
  order: number;
  label: string;
  shotType?: string;
  cameraAngle?: string;
  caption?: string;
  dialogue?: string[];
}

export interface StudioReviewPdfPageMetadata {
  pageNumber?: number;
  title?: string;
  pageNote?: string;
  review?: {
    status?: string;
    assignee?: string;
    note?: string;
    updatedAt?: string;
  };
  panels?: StudioReviewPdfPanelMetadata[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 제어·bidi 문자를 제거하되, 사람이 쓴 문단 개행은 보존한다. */
function normalizeReviewText(value: unknown, maxCodeUnits: number): string | undefined {
  if (typeof value !== "string") return undefined;
  let output = "";
  const normalized = value.normalize("NFKC").replace(/\r\n?/gu, "\n");
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    const allowedWhitespace = character === "\n" || character === "\t";
    const control = (code <= 31 && !allowedWhitespace) || code === 127;
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (!control && !bidi) output += character;
    if (output.length >= maxCodeUnits) break;
  }
  const trimmed = output.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 캔버스 이미지에 보이지 않는 요소/그룹의 초안 텍스트를 검수 레일에도 노출하지 않는다. */
function visiblePageElements(page: StudioReviewPdfPageLike): readonly unknown[] {
  const hiddenGroupIds = new Set(
    (Array.isArray(page.groups) ? page.groups : [])
      .filter((group) => isRecord(group) && group.hidden === true && typeof group.id === "string")
      .map((group) => (group as Record<string, unknown>).id as string)
  );
  return (Array.isArray(page.elements) ? page.elements : []).filter((element) => {
    if (!isRecord(element) || element.hidden === true) return false;
    return typeof element.groupId !== "string" || !hiddenGroupIds.has(element.groupId);
  });
}

interface NormalizedFrame {
  id: string;
  key: string;
  inputIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  caption?: string;
}

interface NormalizedDialogue {
  inputIndex: number;
  text: string;
  centerX?: number;
  centerY?: number;
}

function collectFrames(elements: readonly unknown[]): NormalizedFrame[] {
  return elements
    .map((value, inputIndex): NormalizedFrame | null => {
      if (!isRecord(value) || value.type !== "frame") return null;
      const x = finiteNumber(value.x);
      const y = finiteNumber(value.y);
      const width = finiteNumber(value.width);
      const height = finiteNumber(value.height);
      if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
        return null;
      }
      const beat = isRecord(value.storyBeat) ? value.storyBeat : undefined;
      const id = normalizeReviewText(value.id, 160) ?? `panel-${inputIndex + 1}`;
      return {
        id,
        key: `${id}:${inputIndex}`,
        inputIndex,
        x,
        y,
        width,
        height,
        caption: normalizeReviewText(beat?.summary, STUDIO_REVIEW_PDF_LIMITS.panelCaption),
      };
    })
    .filter((frame): frame is NormalizedFrame => frame !== null)
    .sort((left, right) => left.y - right.y || left.x - right.x || left.inputIndex - right.inputIndex)
    .slice(0, STUDIO_REVIEW_PDF_LIMITS.panelsPerPage);
}

function collectDialogue(elements: readonly unknown[]): NormalizedDialogue[] {
  return elements
    .map((value, inputIndex): NormalizedDialogue | null => {
      if (!isRecord(value) || (value.type !== "bubble" && value.type !== "text")) return null;
      const text = normalizeReviewText(value.text, STUDIO_REVIEW_PDF_LIMITS.dialogue);
      if (!text) return null;
      const x = finiteNumber(value.x);
      const y = finiteNumber(value.y);
      const width = finiteNumber(value.width);
      const height = finiteNumber(value.height);
      return {
        inputIndex,
        text,
        centerX: x !== undefined && width !== undefined ? x + Math.max(0, width) / 2 : x,
        centerY: y !== undefined && height !== undefined ? y + Math.max(0, height) / 2 : y,
      };
    })
    .filter((dialogue): dialogue is NormalizedDialogue => dialogue !== null)
    .slice(0, STUDIO_REVIEW_PDF_LIMITS.dialogueItemsPerPage);
}

function frameForDialogue(dialogue: NormalizedDialogue, frames: readonly NormalizedFrame[]): NormalizedFrame | undefined {
  if (dialogue.centerX === undefined || dialogue.centerY === undefined) return undefined;
  return frames
    .filter(
      (frame) =>
        dialogue.centerX! >= frame.x &&
        dialogue.centerX! <= frame.x + frame.width &&
        dialogue.centerY! >= frame.y &&
        dialogue.centerY! <= frame.y + frame.height
    )
    .sort((left, right) => left.width * left.height - right.width * right.height || left.inputIndex - right.inputIndex)[0];
}

function buildPanels(
  page: StudioReviewPdfPageLike,
  fields: Readonly<StudioReviewPdfFields>
): StudioReviewPdfPanelMetadata[] | undefined {
  if (!fields.panelMetadata && !fields.panelCaptions && !fields.dialogue) return undefined;
  const elements = visiblePageElements(page);
  const frames = collectFrames(elements);
  const dialogue = fields.dialogue ? collectDialogue(elements) : [];
  const shot = fields.panelMetadata ? shotTypeLabel(page.shotType) : undefined;
  const angle = fields.panelMetadata ? cameraAngleLabel(page.cameraAngle) : undefined;

  if (frames.length === 0) {
    if (dialogue.length === 0 && !shot && !angle) return undefined;
    return [{
      id: "page",
      order: 1,
      label: "페이지 전체",
      ...(shot ? { shotType: shot } : {}),
      ...(angle ? { cameraAngle: angle } : {}),
      ...(dialogue.length > 0 ? { dialogue: dialogue.map((item) => item.text) } : {}),
    }];
  }

  const dialogueByFrame = new Map<string, string[]>();
  const unassigned: string[] = [];
  for (const item of dialogue) {
    const frame = frameForDialogue(item, frames);
    if (!frame) {
      unassigned.push(item.text);
      continue;
    }
    const current = dialogueByFrame.get(frame.key) ?? [];
    current.push(item.text);
    dialogueByFrame.set(frame.key, current);
  }

  const panels = frames.map((frame, index): StudioReviewPdfPanelMetadata => ({
    id: frame.id,
    order: index + 1,
    label: `컷 ${index + 1}`,
    ...(shot ? { shotType: shot } : {}),
    ...(angle ? { cameraAngle: angle } : {}),
    ...(fields.panelCaptions && frame.caption ? { caption: frame.caption } : {}),
    ...(fields.dialogue && (dialogueByFrame.get(frame.key)?.length ?? 0) > 0
      ? { dialogue: dialogueByFrame.get(frame.key) }
      : {}),
  }));
  if (unassigned.length > 0) {
    panels.push({
      id: "unassigned",
      order: panels.length + 1,
      label: "프레임 밖 대사",
      dialogue: unassigned,
    });
  }
  return panels;
}

/**
 * 외부/과거 페이지 구조를 프로필이 허용한 내부 검토 필드로만 투영한다.
 * `image-only`는 빈 객체만 반환해 담당자·메모가 우발적으로 살아남을 수 없다.
 */
export function projectStudioReviewPdfPageMetadata(
  page: StudioReviewPdfPageLike,
  pageIndex: number,
  profileValue: unknown
): StudioReviewPdfPageMetadata {
  const profile = getStudioReviewPdfProfile(profileValue);
  const fields = profile.fields;
  if (profile.id === "image-only") return {};
  const safeIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
  const title = normalizeReviewText(page.name, STUDIO_REVIEW_PDF_LIMITS.pageTitle) ?? `${safeIndex + 1}페이지`;
  const pageNote = fields.pageNotes
    ? normalizeReviewText(page.note, STUDIO_REVIEW_PDF_LIMITS.pageNote)
    : undefined;
  const reviewState = normalizePageReviewState(page.review);
  const review: NonNullable<StudioReviewPdfPageMetadata["review"]> = {};

  if (fields.reviewStatus) review.status = PAGE_REVIEW_STATUS_LABELS[reviewState.status];
  if (fields.reviewAssignee) {
    const assignee = normalizeReviewText(reviewState.assignee, STUDIO_REVIEW_PDF_LIMITS.reviewAssignee);
    if (assignee) review.assignee = assignee;
  }
  if (fields.reviewNotes) {
    const note = normalizeReviewText(reviewState.note, STUDIO_REVIEW_PDF_LIMITS.reviewNote);
    if (note) review.note = note;
  }
  if (fields.reviewUpdatedAt && reviewState.updatedAt) {
    const timestamp = Date.parse(reviewState.updatedAt);
    if (Number.isFinite(timestamp)) review.updatedAt = new Date(timestamp).toISOString();
  }

  const panels = buildPanels(page, fields);
  return {
    ...(fields.pageNumber ? { pageNumber: safeIndex + 1 } : {}),
    ...(fields.pageTitle ? { title } : {}),
    ...(pageNote ? { pageNote } : {}),
    ...(Object.keys(review).length > 0 ? { review } : {}),
    ...(panels && panels.length > 0 ? { panels } : {}),
  };
}

export function projectStudioReviewPdfDocumentMetadata(
  pages: readonly StudioReviewPdfPageLike[],
  profileValue: unknown
): StudioReviewPdfPageMetadata[] {
  return pages.map((page, index) => projectStudioReviewPdfPageMetadata(page, index, profileValue));
}

export interface StudioReviewPdfPageLayout {
  width: number;
  height: number;
  railWidth: number;
  imageX: number;
}

/** 메타 레일은 원본 높이를 바꾸지 않아 긴 웹툰 캔버스의 높이 한계를 악화시키지 않는다. */
export function planStudioReviewPdfPageLayout(
  sourceWidth: number,
  sourceHeight: number,
  profileValue: unknown
): StudioReviewPdfPageLayout {
  const width = Math.round(sourceWidth);
  const height = Math.round(sourceHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("검수 PDF 페이지 크기가 올바르지 않아요.");
  }
  if (normalizeStudioReviewPdfProfileId(profileValue) === "image-only") {
    return { width, height, railWidth: 0, imageX: 0 };
  }
  const scale = Math.min(3, Math.max(0.75, width / 690));
  const railWidth = Math.max(300, Math.round(390 * scale));
  return { width: width + railWidth, height, railWidth, imageX: railWidth };
}

const REVIEW_PDF_COLORS = {
  paper: "#f8f6f0",
  imageGround: "#ffffff",
  ink: "#282622",
  secondary: "#66615a",
  line: "#d9d3c8",
  accent: "#d75b30",
  status: "#365f52",
} as const;

function canvasFactory(width: number, height: number): HTMLCanvasElement {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function font(size: number, weight = 500): string {
  return `${weight} ${Math.max(10, Math.round(size))}px Pretendard, system-ui, sans-serif`;
}

function wrapCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines;
}

function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const lines = wrapCanvasText(context, value, maxWidth);
  const visible = lines.slice(0, Math.max(1, maxLines));
  visible.forEach((line, index) => {
    let output = line;
    if (index === visible.length - 1 && lines.length > visible.length) {
      while (output && context.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
      output = `${output.trimEnd()}…`;
    }
    context.fillText(output, x, y + index * lineHeight);
  });
  return y + visible.length * lineHeight;
}

function drawReviewSectionTitle(
  context: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
  size: number
): number {
  context.font = font(size, 700);
  context.fillStyle = REVIEW_PDF_COLORS.secondary;
  context.fillText(title, x, y);
  return y + size * 1.55;
}

/** 주석 프로필 1페이지를 원본 이미지와 하나의 캔버스로 합성한다. */
export function createStudioReviewPdfPageCanvas(
  source: HTMLCanvasElement,
  metadata: StudioReviewPdfPageMetadata,
  profileValue: unknown,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = canvasFactory
): HTMLCanvasElement {
  const profile = getStudioReviewPdfProfile(profileValue);
  if (profile.id === "image-only") return source;
  const layout = planStudioReviewPdfPageLayout(source.width, source.height, profile.id);
  const output = createCanvas(layout.width, layout.height);
  try {
    const context = output.getContext("2d");
    if (!context) throw new Error("검수 PDF 주석 캔버스를 만들지 못했어요. 다시 시도해주세요.");

  const scale = Math.min(3, Math.max(0.75, source.width / 690));
  const pad = Math.round(28 * scale);
  const contentWidth = layout.railWidth - pad * 2;
  const small = 12 * scale;
  const body = 15 * scale;
  const lineHeight = Math.round(body * 1.45);
  const bottom = layout.height - pad;

  context.fillStyle = REVIEW_PDF_COLORS.imageGround;
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = REVIEW_PDF_COLORS.paper;
  context.fillRect(0, 0, layout.railWidth, layout.height);
  context.drawImage(source, layout.imageX, 0);
  context.strokeStyle = REVIEW_PDF_COLORS.line;
  context.lineWidth = Math.max(1, Math.round(scale));
  context.beginPath();
  context.moveTo(layout.railWidth - context.lineWidth, 0);
  context.lineTo(layout.railWidth - context.lineWidth, layout.height);
  context.stroke();

  context.textBaseline = "top";
  context.textAlign = "left";
  let y = pad;
  context.font = font(small, 700);
  context.fillStyle = REVIEW_PDF_COLORS.accent;
  context.fillText("ToonSpectrum · 내부 검수", pad, y);
  y += Math.round(small * 2.15);

  if (metadata.pageNumber !== undefined) {
    context.font = font(38 * scale, 700);
    context.fillStyle = REVIEW_PDF_COLORS.ink;
    context.fillText(`P.${String(metadata.pageNumber).padStart(2, "0")}`, pad, y);
    y += Math.round(46 * scale);
  }
  if (metadata.title) {
    context.font = font(20 * scale, 700);
    context.fillStyle = REVIEW_PDF_COLORS.ink;
    y = drawWrappedCanvasText(context, metadata.title, pad, y, contentWidth, Math.round(25 * scale), 2);
    y += Math.round(16 * scale);
  }

  const review = metadata.review;
  if (review && y < bottom) {
    y = drawReviewSectionTitle(context, "승인 정보", pad, y, small);
    context.font = font(body, 600);
    context.fillStyle = REVIEW_PDF_COLORS.status;
    const rows = [
      review.status ? `상태 · ${review.status}` : undefined,
      review.assignee ? `담당 · ${review.assignee}` : undefined,
      review.updatedAt ? `갱신 · ${review.updatedAt.replace("T", " ").replace(".000Z", "Z")}` : undefined,
    ].filter((value): value is string => Boolean(value));
    for (const row of rows) {
      if (y + lineHeight > bottom) break;
      y = drawWrappedCanvasText(context, row, pad, y, contentWidth, lineHeight, 2);
    }
    if (review.note && y + lineHeight < bottom) {
      y += Math.round(6 * scale);
      context.font = font(body, 500);
      context.fillStyle = REVIEW_PDF_COLORS.ink;
      y = drawWrappedCanvasText(context, review.note, pad, y, contentWidth, lineHeight, 6);
    }
    y += Math.round(18 * scale);
  }

  if (metadata.pageNote && y < bottom) {
    y = drawReviewSectionTitle(context, "페이지 메모", pad, y, small);
    context.font = font(body, 500);
    context.fillStyle = REVIEW_PDF_COLORS.ink;
    y = drawWrappedCanvasText(context, metadata.pageNote, pad, y, contentWidth, lineHeight, 7);
    y += Math.round(18 * scale);
  }

  if (metadata.panels && metadata.panels.length > 0 && y < bottom) {
    y = drawReviewSectionTitle(context, "컷·대사", pad, y, small);
    for (let index = 0; index < metadata.panels.length; index += 1) {
      const panel = metadata.panels[index];
      if (!panel || y + lineHeight * 2 > bottom) {
        context.font = font(small, 600);
        context.fillStyle = REVIEW_PDF_COLORS.secondary;
        context.fillText(`… ${metadata.panels.length - index}개 항목 생략`, pad, Math.min(y, bottom - lineHeight));
        break;
      }
      context.font = font(body, 700);
      context.fillStyle = REVIEW_PDF_COLORS.ink;
      const tags = [panel.shotType, panel.cameraAngle].filter(Boolean).join(" · ");
      context.fillText(tags ? `${panel.label} · ${tags}` : panel.label, pad, y);
      y += lineHeight;
      if (panel.caption) {
        context.font = font(body, 500);
        context.fillStyle = REVIEW_PDF_COLORS.secondary;
        y = drawWrappedCanvasText(context, `캡션 · ${panel.caption}`, pad, y, contentWidth, lineHeight, 3);
      }
      for (const dialogue of panel.dialogue ?? []) {
        if (y + lineHeight > bottom) break;
        context.font = font(body, 500);
        context.fillStyle = REVIEW_PDF_COLORS.ink;
        y = drawWrappedCanvasText(context, `“${dialogue}”`, pad, y, contentWidth, lineHeight, 3);
      }
      y += Math.round(10 * scale);
    }
  }
    return output;
  } catch (error) {
    // preparePage가 값을 반환하기 전의 실패는 하위 releasePreparedPage가 볼 수 없다. 대형 웹툰
    // backing store를 여기서 즉시 비워 재시도 전 메모리 압력을 낮추되 원래 렌더 오류는 보존한다.
    try {
      output.width = 0;
      output.height = 0;
    } catch {
      // 가짜/권한 제한 캔버스의 정리 실패가 실제 context·draw 오류를 덮어쓰면 안 된다.
    }
    throw error;
  }
}

export interface StudioReviewPdfRenderOptions {
  pages: HTMLCanvasElement[];
  pageMetadata: readonly StudioReviewPdfPageLike[];
  profile: unknown;
  title: string;
  quality?: number;
  watermark?: WatermarkSettings;
  onProgress?: (done: number, total: number) => void;
  /** 테스트/권한 제한 환경 주입용 — 주석 레일 캔버스만 만든다. */
  createReviewCanvas?: (width: number, height: number) => HTMLCanvasElement;
  releaseReviewCanvas?: (canvas: HTMLCanvasElement) => void;
  /** 테스트 주입용 — 기본은 기존 renderPagesToPdf. */
  renderPdf?: (options: PdfPagesRenderOptions) => Promise<PdfRenderResult>;
}

/**
 * 내부 review.pdf Blob을 만든다. image-only는 기존 렌더러에 원본을 그대로 위임하고, 주석
 * 프로필만 기존 PDF 렌더러의 페이지별 준비 훅으로 임시 합성 캔버스를 만든다. 각 캔버스는
 * 해당 페이지 JPEG 인코딩 직후 성공·실패와 무관하게 해제되어 긴 원고에서도 누적되지 않는다.
 */
export async function renderStudioReviewPdf(options: StudioReviewPdfRenderOptions): Promise<PdfRenderResult> {
  const profile = getStudioReviewPdfProfile(options.profile);
  const renderPdf = options.renderPdf ?? renderPagesToPdf;
  if (profile.id === "image-only") {
    return renderPdf({
      pages: options.pages,
      title: options.title,
      quality: options.quality,
      watermark: options.watermark,
      onProgress: options.onProgress,
    });
  }
  const projected = projectStudioReviewPdfDocumentMetadata(options.pageMetadata, profile.id);
  const release = options.releaseReviewCanvas ?? (options.createReviewCanvas ? undefined : releaseCanvas);
  return renderPdf({
    pages: options.pages,
    title: options.title,
    quality: options.quality,
    watermark: options.watermark,
    onProgress: options.onProgress,
    preparePage: (source, sourceIndex) =>
      createStudioReviewPdfPageCanvas(
        source,
        projected[sourceIndex] ?? projectStudioReviewPdfPageMetadata({}, sourceIndex, profile.id),
        profile.id,
        options.createReviewCanvas
      ),
    releasePreparedPage: (canvas) => {
      try {
        release?.(canvas);
      } catch {
        // 메모리 반환은 best-effort이며, 성공/실패 결과를 정리 오류로 덮어쓰지 않는다.
      }
    },
  });
}
