/**
 * Browser-local webtoon animatic timeline.
 *
 * This is an edit-decision/timing document, not a video or audio container. It stores no pixels,
 * voices, network URLs or server state. A Studio integration can render `sourceRect` from the
 * existing page/cut canvas while this module deterministically supplies timing, camera and cue
 * metadata.
 */

export const STUDIO_ANIMATIC_VERSION = 1;
export const STUDIO_ANIMATIC_KIND = "toonspectrum.webtoon-animatic";
export const STUDIO_ANIMATIC_STORAGE_PREFIX =
  "toonspectrum-studio-animatic:v12";

export const STUDIO_ANIMATIC_DEFAULT_FPS = 12;
export const STUDIO_ANIMATIC_MIN_FPS = 1;
export const STUDIO_ANIMATIC_MAX_FPS = 30;
export const STUDIO_ANIMATIC_DEFAULT_HOLD_MS = 2_400;
export const STUDIO_ANIMATIC_MIN_HOLD_MS = 250;
export const STUDIO_ANIMATIC_MAX_HOLD_MS = 30_000;
export const STUDIO_ANIMATIC_DEFAULT_TRANSITION_MS = 400;
export const STUDIO_ANIMATIC_MIN_TRANSITION_MS = 100;
export const STUDIO_ANIMATIC_MAX_TRANSITION_MS = 5_000;
export const STUDIO_ANIMATIC_MAX_SEGMENTS = 180;
export const STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES = 16;
export const STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT = 32;
export const STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS = 600_000;
export const STUDIO_ANIMATIC_MAX_PREVIEW_FRAMES = 18_000;
export const STUDIO_ANIMATIC_MAX_IMPORT_BYTES = 1_000_000;
export const STUDIO_ANIMATIC_MAX_EXPORT_BYTES = 800_000;
export const STUDIO_ANIMATIC_MAX_TOTAL_TEXT_CHARS = 200_000;
export const STUDIO_ANIMATIC_MAX_LABEL_CHARS = 160;
export const STUDIO_ANIMATIC_MAX_CUE_TEXT_CHARS = 500;
export const STUDIO_ANIMATIC_MAX_ID_CHARS = 180;
export const STUDIO_ANIMATIC_MAX_SCOPE_CHARS = 200;
export const STUDIO_ANIMATIC_MAX_CANVAS_EXTENT = 100_000;

export type StudioAnimaticTransitionKind = "cut" | "fade" | "pan";
export type StudioAnimaticPreviewMode = "cuts" | "vertical-scroll";
export type StudioAnimaticCueKind = "dialogue" | "sfx";
export type StudioAnimaticCameraEasing = "linear" | "ease-in-out";

export interface StudioAnimaticTransition {
  readonly kind: StudioAnimaticTransitionKind;
  readonly durationMs: number;
}

export interface StudioAnimaticCameraKeyframe {
  /** Normalized position within the full transition+hold segment, 0..1. */
  readonly at: number;
  readonly panXPercent: number;
  readonly panYPercent: number;
  readonly zoom: number;
  readonly easing: StudioAnimaticCameraEasing;
}

export interface StudioAnimaticCue {
  readonly id: string;
  readonly kind: StudioAnimaticCueKind;
  readonly offsetMs: number;
  readonly text: string;
  readonly speaker?: string;
}

export interface StudioAnimaticSourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Absolute Y within the concatenated vertical page strip. */
  readonly stripY: number;
}

export interface StudioAnimaticSegment {
  readonly id: string;
  readonly pageId: string;
  readonly cutId: string | null;
  readonly label: string;
  readonly holdMs: number;
  readonly transition: StudioAnimaticTransition;
  readonly cameraKeyframes: readonly StudioAnimaticCameraKeyframe[];
  readonly cues: readonly StudioAnimaticCue[];
  readonly sourceRect: StudioAnimaticSourceRect;
}

export interface StudioAnimaticDocument {
  readonly kind: typeof STUDIO_ANIMATIC_KIND;
  readonly version: typeof STUDIO_ANIMATIC_VERSION;
  readonly workScope: string;
  readonly fps: number;
  readonly previewMode: StudioAnimaticPreviewMode;
  readonly loop: boolean;
  readonly segments: readonly StudioAnimaticSegment[];
}

export interface StudioAnimaticElementLike {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly text?: string;
  readonly name?: string;
  readonly speaker?: string;
  /** Explicit cue role for text/sticker/custom elements. Bubbles default to dialogue. */
  readonly animaticCueKind?: StudioAnimaticCueKind;
}

export interface StudioAnimaticPageLike {
  readonly id: string;
  readonly name?: string;
  readonly canvasH?: number;
  readonly elements?: readonly StudioAnimaticElementLike[];
}

export interface StudioAnimaticPlanSegment {
  readonly index: number;
  readonly segmentId: string;
  readonly startMs: number;
  readonly transitionEndMs: number;
  readonly endMs: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly scrollStartY: number;
  readonly scrollEndY: number;
}

export interface StudioAnimaticPreviewPlan {
  readonly fps: number;
  readonly mode: StudioAnimaticPreviewMode;
  readonly totalDurationMs: number;
  readonly frameCount: number;
  readonly remainingDurationMs: number;
  readonly remainingFrames: number;
  readonly segments: readonly StudioAnimaticPlanSegment[];
}

export interface StudioAnimaticPreviewSample {
  readonly timeMs: number;
  readonly frameIndex: number;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly localTimeMs: number;
  readonly transitionKind: StudioAnimaticTransitionKind;
  readonly transitionProgress: number;
  readonly camera: {
    readonly panXPercent: number;
    readonly panYPercent: number;
    readonly zoom: number;
  };
  readonly scrollY: number;
  readonly cues: readonly StudioAnimaticCue[];
  readonly reducedMotion: boolean;
}

export type StudioAnimaticStorage = Pick<Storage, "getItem" | "setItem">;

export interface StudioAnimaticLoadResult {
  readonly document: StudioAnimaticDocument | null;
  readonly status: "ok" | "empty" | "unavailable" | "invalid";
  readonly error?: string;
}

export interface StudioAnimaticSaveResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface StudioAnimaticExportResult {
  readonly ok: true;
  readonly json: string;
  readonly bytes: number;
}

export interface StudioAnimaticFailure {
  readonly ok: false;
  readonly error: string;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function normalizeText(value: string): string {
  try {
    return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  } catch {
    return value.replace(/\s+/gu, " ").trim();
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(value: string, seed = 0x811c9dc5): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function deterministicId(prefix: string, identity: string): string {
  return `${prefix}-${stableHash(identity)}-${stableHash(identity, 0x9e3779b1)}`;
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 3;
}

function finiteWithin(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= min
    && value <= max
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string"
    && normalizeText(value).length > 0
    && normalizeText(value).length <= STUDIO_ANIMATIC_MAX_ID_CHARS
  );
}

function validLabel(value: unknown): value is string {
  return (
    typeof value === "string"
    && normalizeText(value).length > 0
    && normalizeText(value).length <= STUDIO_ANIMATIC_MAX_LABEL_CHARS
  );
}

function normalizeFps(value: number): number {
  return Math.round(
    clamp(value, STUDIO_ANIMATIC_MIN_FPS, STUDIO_ANIMATIC_MAX_FPS)
  );
}

function segmentDurationMs(segment: StudioAnimaticSegment): number {
  return segment.holdMs + segment.transition.durationMs;
}

function defaultCameraKeyframes(): StudioAnimaticCameraKeyframe[] {
  return [
    {
      at: 0,
      panXPercent: 0,
      panYPercent: 0,
      zoom: 1,
      easing: "linear",
    },
    {
      at: 1,
      panXPercent: 0,
      panYPercent: 0,
      zoom: 1,
      easing: "ease-in-out",
    },
  ];
}

function sanitizeCameraKeyframe(
  value: unknown
): StudioAnimaticCameraKeyframe | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !finiteWithin(raw.at, 0, 1)
    || !finiteWithin(raw.panXPercent, -100, 100)
    || !finiteWithin(raw.panYPercent, -100, 100)
    || !finiteWithin(raw.zoom, 0.25, 4)
    || (raw.easing !== "linear" && raw.easing !== "ease-in-out")
  ) {
    return null;
  }
  return {
    at: raw.at,
    panXPercent: raw.panXPercent,
    panYPercent: raw.panYPercent,
    zoom: raw.zoom,
    easing: raw.easing,
  };
}

function sanitizeCameraKeyframes(
  value: unknown
): StudioAnimaticCameraKeyframe[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES
  ) {
    return null;
  }
  const keyframes = value.map(sanitizeCameraKeyframe);
  if (keyframes.some((keyframe) => keyframe === null)) return null;
  const normalized = (
    keyframes as StudioAnimaticCameraKeyframe[]
  ).sort((left, right) => left.at - right.at);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]!.at === normalized[index]!.at) return null;
  }
  return normalized;
}

function sanitizeCue(value: unknown, durationMs: number): StudioAnimaticCue | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !validId(raw.id)
    || (raw.kind !== "dialogue" && raw.kind !== "sfx")
    || !finiteWithin(raw.offsetMs, 0, durationMs)
    || typeof raw.text !== "string"
  ) {
    return null;
  }
  const text = normalizeText(raw.text);
  if (
    text.length === 0
    || text.length > STUDIO_ANIMATIC_MAX_CUE_TEXT_CHARS
  ) {
    return null;
  }
  if (
    raw.speaker !== undefined
    && (typeof raw.speaker !== "string"
      || normalizeText(raw.speaker).length > STUDIO_ANIMATIC_MAX_LABEL_CHARS)
  ) {
    return null;
  }
  return {
    id: normalizeText(raw.id),
    kind: raw.kind,
    offsetMs: Math.round(raw.offsetMs),
    text,
    speaker:
      typeof raw.speaker === "string" && normalizeText(raw.speaker)
        ? normalizeText(raw.speaker)
        : undefined,
  };
}

function sanitizeTransition(value: unknown): StudioAnimaticTransition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.kind !== "cut"
    && raw.kind !== "fade"
    && raw.kind !== "pan"
  ) {
    return null;
  }
  if (raw.kind === "cut") {
    return raw.durationMs === 0 ? { kind: "cut", durationMs: 0 } : null;
  }
  if (
    !finiteWithin(
      raw.durationMs,
      STUDIO_ANIMATIC_MIN_TRANSITION_MS,
      STUDIO_ANIMATIC_MAX_TRANSITION_MS
    )
  ) {
    return null;
  }
  return { kind: raw.kind, durationMs: Math.round(raw.durationMs) };
}

function sanitizeSourceRect(value: unknown): StudioAnimaticSourceRect | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !finiteWithin(raw.x, 0, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
    || !finiteWithin(raw.y, 0, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
    || !finiteWithin(raw.width, 1, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
    || !finiteWithin(raw.height, 1, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
    || !finiteWithin(raw.stripY, 0, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
  ) {
    return null;
  }
  return {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    stripY: raw.stripY,
  };
}

function sanitizeSegment(value: unknown): StudioAnimaticSegment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !validId(raw.id)
    || !validId(raw.pageId)
    || (raw.cutId !== null && !validId(raw.cutId))
    || !validLabel(raw.label)
    || !finiteWithin(
      raw.holdMs,
      STUDIO_ANIMATIC_MIN_HOLD_MS,
      STUDIO_ANIMATIC_MAX_HOLD_MS
    )
  ) {
    return null;
  }
  const transition = sanitizeTransition(raw.transition);
  const cameraKeyframes = sanitizeCameraKeyframes(raw.cameraKeyframes);
  const sourceRect = sanitizeSourceRect(raw.sourceRect);
  if (!transition || !cameraKeyframes || !sourceRect) return null;
  const durationMs = raw.holdMs + transition.durationMs;
  if (
    !Array.isArray(raw.cues)
    || raw.cues.length > STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT
  ) {
    return null;
  }
  const cues = raw.cues.map((cue) => sanitizeCue(cue, durationMs));
  if (cues.some((cue) => cue === null)) return null;
  const normalizedCues = (cues as StudioAnimaticCue[]).sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || compareCodeUnits(left.id, right.id)
  );
  if (new Set(normalizedCues.map((cue) => cue.id)).size !== normalizedCues.length) {
    return null;
  }
  return {
    id: normalizeText(raw.id),
    pageId: normalizeText(raw.pageId),
    cutId: raw.cutId === null ? null : normalizeText(raw.cutId),
    label: normalizeText(raw.label),
    holdMs: Math.round(raw.holdMs),
    transition,
    cameraKeyframes,
    cues: normalizedCues,
    sourceRect,
  };
}

function totalTextChars(document: StudioAnimaticDocument): number {
  let total = document.workScope.length;
  for (const segment of document.segments) {
    total += segment.id.length + segment.pageId.length + segment.label.length;
    total += segment.cutId?.length ?? 0;
    for (const cue of segment.cues) {
      total += cue.id.length + cue.text.length + (cue.speaker?.length ?? 0);
    }
  }
  return total;
}

export function validateStudioAnimaticDocument(
  value: unknown
):
  | { readonly ok: true; readonly document: StudioAnimaticDocument }
  | StudioAnimaticFailure {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "애니매틱 문서 형식이 아닙니다." };
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.kind !== STUDIO_ANIMATIC_KIND
    || raw.version !== STUDIO_ANIMATIC_VERSION
  ) {
    return {
      ok: false,
      error: "지원하는 ToonSpectrum 애니매틱 v1 문서가 아닙니다.",
    };
  }
  if (
    typeof raw.workScope !== "string"
    || normalizeText(raw.workScope).length === 0
    || normalizeText(raw.workScope).length > STUDIO_ANIMATIC_MAX_SCOPE_CHARS
    || !finiteWithin(
      raw.fps,
      STUDIO_ANIMATIC_MIN_FPS,
      STUDIO_ANIMATIC_MAX_FPS
    )
    || (raw.previewMode !== "cuts" && raw.previewMode !== "vertical-scroll")
    || typeof raw.loop !== "boolean"
    || !Array.isArray(raw.segments)
    || raw.segments.length > STUDIO_ANIMATIC_MAX_SEGMENTS
  ) {
    return { ok: false, error: "애니매틱 설정 또는 세그먼트 한도가 올바르지 않습니다." };
  }
  const segments = raw.segments.map(sanitizeSegment);
  if (segments.some((segment) => segment === null)) {
    return { ok: false, error: "유효하지 않은 컷·카메라·cue 항목이 있습니다." };
  }
  const normalizedSegments = segments as StudioAnimaticSegment[];
  if (
    new Set(normalizedSegments.map((segment) => segment.id)).size
    !== normalizedSegments.length
  ) {
    return { ok: false, error: "중복된 애니매틱 세그먼트 ID가 있습니다." };
  }
  const document: StudioAnimaticDocument = {
    kind: STUDIO_ANIMATIC_KIND,
    version: STUDIO_ANIMATIC_VERSION,
    workScope: normalizeText(raw.workScope),
    fps: Math.round(raw.fps),
    previewMode: raw.previewMode,
    loop: raw.loop,
    segments: normalizedSegments,
  };
  if (totalTextChars(document) > STUDIO_ANIMATIC_MAX_TOTAL_TEXT_CHARS) {
    return { ok: false, error: "애니매틱 텍스트 메타데이터 한도를 넘었습니다." };
  }
  const plan = planStudioAnimaticPreview(document, false);
  if (!plan.ok) return plan;
  return { ok: true, document };
}

interface FrameCandidate {
  readonly element: StudioAnimaticElementLike;
  readonly sourceIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function frameCandidates(page: StudioAnimaticPageLike): FrameCandidate[] {
  const candidates: FrameCandidate[] = [];
  for (const [sourceIndex, element] of (page.elements ?? []).entries()) {
    if (
      element.type !== "frame"
      || !finiteWithin(element.x, 0, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
      || !finiteWithin(element.y, 0, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
      || !finiteWithin(element.width, 1, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
      || !finiteWithin(element.height, 1, STUDIO_ANIMATIC_MAX_CANVAS_EXTENT)
    ) {
      continue;
    }
    candidates.push({
      element,
      sourceIndex,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    });
  }
  return candidates.sort(
    (left, right) =>
      left.y - right.y
      || left.x - right.x
      || left.sourceIndex - right.sourceIndex
      || compareCodeUnits(left.element.id, right.element.id)
  );
}

function containsElement(
  frame: FrameCandidate,
  element: StudioAnimaticElementLike
): boolean {
  if (!Number.isFinite(element.x) || !Number.isFinite(element.y)) return false;
  const centerX = (element.x ?? 0) + Math.max(0, element.width ?? 0) / 2;
  const centerY = (element.y ?? 0) + Math.max(0, element.height ?? 0) / 2;
  return (
    centerX >= frame.x
    && centerX <= frame.x + frame.width
    && centerY >= frame.y
    && centerY <= frame.y + frame.height
  );
}

function cueKindForElement(
  element: StudioAnimaticElementLike
): StudioAnimaticCueKind | null {
  if (element.animaticCueKind) return element.animaticCueKind;
  if (element.type === "bubble") return "dialogue";
  if (
    element.type === "text"
    && /(?:^|\b)sfx(?:\b|$)|효과음/iu.test(element.name ?? "")
  ) {
    return "sfx";
  }
  return null;
}

function cuesForSource(
  page: StudioAnimaticPageLike,
  frame: FrameCandidate | null,
  durationMs: number
): StudioAnimaticCue[] {
  const cues: StudioAnimaticCue[] = [];
  for (const element of page.elements ?? []) {
    if (frame && !containsElement(frame, element)) continue;
    const kind = cueKindForElement(element);
    const text = normalizeText(element.text ?? "");
    if (!kind || !text) continue;
    cues.push({
      id: deterministicId("cue", `${page.id}:${element.id}:${kind}`),
      kind,
      offsetMs: Math.round(durationMs / 2),
      text: text.slice(0, STUDIO_ANIMATIC_MAX_CUE_TEXT_CHARS),
      speaker:
        kind === "dialogue" && normalizeText(element.speaker ?? "")
          ? normalizeText(element.speaker ?? "").slice(
              0,
              STUDIO_ANIMATIC_MAX_LABEL_CHARS
            )
          : undefined,
    });
  }
  return cues
    .slice(0, STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

export function createStudioAnimaticFromPages(
  pages: readonly StudioAnimaticPageLike[],
  options: {
    readonly workScope: string;
    readonly fps?: number;
    readonly previewMode?: StudioAnimaticPreviewMode;
    readonly loop?: boolean;
  }
):
  | { readonly ok: true; readonly document: StudioAnimaticDocument }
  | StudioAnimaticFailure {
  const workScope = normalizeText(options.workScope);
  if (
    !workScope
    || workScope.length > STUDIO_ANIMATIC_MAX_SCOPE_CHARS
  ) {
    return { ok: false, error: "유효한 작품 범위가 필요합니다." };
  }
  const pageIds = new Set<string>();
  const segments: StudioAnimaticSegment[] = [];
  let pageStripY = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const pageId = normalizeText(page.id);
    if (!pageId || pageId.length > STUDIO_ANIMATIC_MAX_ID_CHARS) {
      return { ok: false, error: `${pageIndex + 1}페이지 ID가 올바르지 않습니다.` };
    }
    if (pageIds.has(pageId)) {
      return { ok: false, error: "중복된 페이지 ID가 있습니다." };
    }
    pageIds.add(pageId);
    const pageHeight = Math.round(
      clamp(
        page.canvasH ?? 1_200,
        1,
        STUDIO_ANIMATIC_MAX_CANVAS_EXTENT
      )
    );
    const pageName =
      normalizeText(page.name ?? "") || `${pageIndex + 1}페이지`;
    const frames = frameCandidates(page);
    const sources: readonly (FrameCandidate | null)[] =
      frames.length > 0 ? frames : [null];
    for (const [cutIndex, frame] of sources.entries()) {
      if (segments.length >= STUDIO_ANIMATIC_MAX_SEGMENTS) {
        return {
          ok: false,
          error: `애니매틱은 최대 ${STUDIO_ANIMATIC_MAX_SEGMENTS}개 페이지·컷까지 만들 수 있습니다.`,
        };
      }
      const transition: StudioAnimaticTransition =
        segments.length === 0
          ? { kind: "cut", durationMs: 0 }
          : {
              kind: "fade",
              durationMs: STUDIO_ANIMATIC_DEFAULT_TRANSITION_MS,
            };
      const durationMs =
        STUDIO_ANIMATIC_DEFAULT_HOLD_MS + transition.durationMs;
      const cutId = frame ? normalizeText(frame.element.id) : null;
      if (cutId !== null && (!cutId || cutId.length > STUDIO_ANIMATIC_MAX_ID_CHARS)) {
        return { ok: false, error: "유효하지 않은 컷 ID가 있습니다." };
      }
      const identity = JSON.stringify([pageId, cutId]);
      const sourceRect: StudioAnimaticSourceRect = frame
        ? {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            stripY: pageStripY + frame.y,
          }
        : {
            x: 0,
            y: 0,
            width: 720,
            height: pageHeight,
            stripY: pageStripY,
          };
      segments.push({
        id: deterministicId("segment", identity),
        pageId,
        cutId,
        label:
          frame === null
            ? pageName.slice(0, STUDIO_ANIMATIC_MAX_LABEL_CHARS)
            : `${pageName} · ${cutIndex + 1}컷`.slice(
                0,
                STUDIO_ANIMATIC_MAX_LABEL_CHARS
              ),
        holdMs: STUDIO_ANIMATIC_DEFAULT_HOLD_MS,
        transition,
        cameraKeyframes: defaultCameraKeyframes(),
        cues: cuesForSource(page, frame, durationMs),
        sourceRect,
      });
    }
    pageStripY += pageHeight;
    if (pageStripY > STUDIO_ANIMATIC_MAX_CANVAS_EXTENT) {
      return { ok: false, error: "세로 페이지 스트립 길이 한도를 넘었습니다." };
    }
  }

  const document: StudioAnimaticDocument = {
    kind: STUDIO_ANIMATIC_KIND,
    version: STUDIO_ANIMATIC_VERSION,
    workScope,
    fps: normalizeFps(options.fps ?? STUDIO_ANIMATIC_DEFAULT_FPS),
    previewMode: options.previewMode ?? "cuts",
    loop: options.loop ?? false,
    segments,
  };
  const validated = validateStudioAnimaticDocument(document);
  return validated;
}

export function planStudioAnimaticPreview(
  document: StudioAnimaticDocument,
  reducedMotion = false
):
  | { readonly ok: true; readonly plan: StudioAnimaticPreviewPlan }
  | StudioAnimaticFailure {
  const fps = normalizeFps(document.fps);
  const segments: StudioAnimaticPlanSegment[] = [];
  let cursorMs = 0;
  for (const [index, segment] of document.segments.entries()) {
    const durationMs = segmentDurationMs(segment);
    if (
      !Number.isFinite(durationMs)
      || durationMs < STUDIO_ANIMATIC_MIN_HOLD_MS
    ) {
      return { ok: false, error: "유효하지 않은 컷 길이가 있습니다." };
    }
    const startMs = cursorMs;
    const effectiveTransitionMs = reducedMotion
      ? 0
      : segment.transition.durationMs;
    const endMs = startMs + durationMs;
    const currentCenter =
      segment.sourceRect.stripY + segment.sourceRect.height / 2;
    const nextSegment = document.segments[index + 1];
    const nextCenter = nextSegment
      ? nextSegment.sourceRect.stripY + nextSegment.sourceRect.height / 2
      : currentCenter;
    segments.push({
      index,
      segmentId: segment.id,
      startMs,
      transitionEndMs: startMs + effectiveTransitionMs,
      endMs,
      startFrame: Math.floor((startMs * fps) / 1_000),
      endFrame: Math.max(
        Math.floor((startMs * fps) / 1_000),
        Math.ceil((endMs * fps) / 1_000) - 1
      ),
      scrollStartY: currentCenter,
      scrollEndY:
        document.previewMode === "vertical-scroll" && !reducedMotion
          ? nextCenter
          : currentCenter,
    });
    cursorMs = endMs;
    if (cursorMs > STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS) {
      return {
        ok: false,
        error: `총 길이는 ${STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS / 60_000}분 이하여야 합니다.`,
      };
    }
  }
  const frameCount =
    cursorMs > 0 ? Math.max(1, Math.ceil((cursorMs * fps) / 1_000)) : 0;
  if (frameCount > STUDIO_ANIMATIC_MAX_PREVIEW_FRAMES) {
    return {
      ok: false,
      error: `미리보기는 최대 ${STUDIO_ANIMATIC_MAX_PREVIEW_FRAMES.toLocaleString("ko-KR")}프레임까지 만들 수 있습니다.`,
    };
  }
  return {
    ok: true,
    plan: {
      fps,
      mode: document.previewMode,
      totalDurationMs: cursorMs,
      frameCount,
      remainingDurationMs:
        STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS - cursorMs,
      remainingFrames: STUDIO_ANIMATIC_MAX_PREVIEW_FRAMES - frameCount,
      segments,
    },
  };
}

function easedProgress(
  progress: number,
  easing: StudioAnimaticCameraEasing
): number {
  const t = clamp01(progress);
  return easing === "ease-in-out" ? t * t * (3 - 2 * t) : t;
}

function cameraAt(
  keyframes: readonly StudioAnimaticCameraKeyframe[],
  progress: number,
  reducedMotion: boolean
): StudioAnimaticPreviewSample["camera"] {
  const first = keyframes[0] ?? defaultCameraKeyframes()[0]!;
  if (reducedMotion || keyframes.length === 1) {
    return {
      panXPercent: first.panXPercent,
      panYPercent: first.panYPercent,
      zoom: first.zoom,
    };
  }
  const t = clamp01(progress);
  let left = first;
  let right = keyframes[keyframes.length - 1] ?? first;
  for (let index = 1; index < keyframes.length; index += 1) {
    const candidate = keyframes[index]!;
    if (t <= candidate.at) {
      right = candidate;
      left = keyframes[index - 1] ?? first;
      break;
    }
  }
  const span = right.at - left.at;
  const local = span > 0 ? easedProgress((t - left.at) / span, right.easing) : 0;
  return {
    panXPercent:
      left.panXPercent + (right.panXPercent - left.panXPercent) * local,
    panYPercent:
      left.panYPercent + (right.panYPercent - left.panYPercent) * local,
    zoom: left.zoom + (right.zoom - left.zoom) * local,
  };
}

export function sampleStudioAnimaticPreview(
  document: StudioAnimaticDocument,
  plan: StudioAnimaticPreviewPlan,
  timeMs: number,
  reducedMotion = false
): StudioAnimaticPreviewSample | null {
  if (plan.segments.length === 0 || document.segments.length === 0) return null;
  const total = plan.totalDurationMs;
  const requested = Number.isFinite(timeMs) ? timeMs : 0;
  const t =
    document.loop && total > 0
      ? ((requested % total) + total) % total
      : clamp(requested, 0, Math.max(0, total - 0.0001));
  let planSegment = plan.segments[plan.segments.length - 1]!;
  for (const candidate of plan.segments) {
    if (t < candidate.endMs) {
      planSegment = candidate;
      break;
    }
  }
  const segment = document.segments[planSegment.index];
  if (!segment) return null;
  const durationMs = segmentDurationMs(segment);
  const localTimeMs = Math.max(0, t - planSegment.startMs);
  const progress = durationMs > 0 ? clamp01(localTimeMs / durationMs) : 0;
  const camera = cameraAt(segment.cameraKeyframes, progress, reducedMotion);
  const transitionDuration = reducedMotion ? 0 : segment.transition.durationMs;
  const transitionProgress =
    transitionDuration > 0
      ? clamp01(localTimeMs / transitionDuration)
      : 1;
  const scrollProgress =
    document.previewMode === "vertical-scroll" && !reducedMotion
      ? progress
      : 0;
  return {
    timeMs: t,
    frameIndex: Math.min(
      Math.max(0, plan.frameCount - 1),
      Math.floor((t * plan.fps) / 1_000)
    ),
    segmentIndex: planSegment.index,
    segmentId: segment.id,
    localTimeMs,
    transitionKind: reducedMotion ? "cut" : segment.transition.kind,
    transitionProgress,
    camera,
    scrollY:
      planSegment.scrollStartY
      + (planSegment.scrollEndY - planSegment.scrollStartY) * scrollProgress
      + (segment.sourceRect.height * camera.panYPercent) / 100,
    cues: segment.cues.filter(
      (cue) =>
        cue.offsetMs <= localTimeMs
        && cue.offsetMs > localTimeMs - 1_000 / plan.fps
    ),
    reducedMotion,
  };
}

function replaceSegment(
  document: StudioAnimaticDocument,
  segmentId: string,
  replacement: StudioAnimaticSegment
): StudioAnimaticDocument {
  const index = document.segments.findIndex(
    (segment) => segment.id === segmentId
  );
  if (index === -1) return document;
  const segments = document.segments.slice();
  segments[index] = replacement;
  const candidate = { ...document, segments };
  return planStudioAnimaticPreview(candidate).ok ? candidate : document;
}

export function setStudioAnimaticFps(
  document: StudioAnimaticDocument,
  fps: number
): StudioAnimaticDocument {
  const candidate = { ...document, fps: normalizeFps(fps) };
  return planStudioAnimaticPreview(candidate).ok ? candidate : document;
}

export function setStudioAnimaticPreviewMode(
  document: StudioAnimaticDocument,
  previewMode: StudioAnimaticPreviewMode
): StudioAnimaticDocument {
  return previewMode === "cuts" || previewMode === "vertical-scroll"
    ? { ...document, previewMode }
    : document;
}

export function setStudioAnimaticLoop(
  document: StudioAnimaticDocument,
  loop: boolean
): StudioAnimaticDocument {
  return { ...document, loop };
}

export function setStudioAnimaticSegmentTiming(
  document: StudioAnimaticDocument,
  segmentId: string,
  input: {
    readonly holdMs?: number;
    readonly transitionKind?: StudioAnimaticTransitionKind;
    readonly transitionDurationMs?: number;
  }
): StudioAnimaticDocument {
  const segment = document.segments.find(
    (candidate) => candidate.id === segmentId
  );
  if (!segment) return document;
  const holdMs = Math.round(
    clamp(
      input.holdMs ?? segment.holdMs,
      STUDIO_ANIMATIC_MIN_HOLD_MS,
      STUDIO_ANIMATIC_MAX_HOLD_MS
    )
  );
  const kind = input.transitionKind ?? segment.transition.kind;
  const durationMs =
    kind === "cut"
      ? 0
      : Math.round(
          clamp(
            input.transitionDurationMs
              ?? (segment.transition.durationMs || STUDIO_ANIMATIC_DEFAULT_TRANSITION_MS),
            STUDIO_ANIMATIC_MIN_TRANSITION_MS,
            STUDIO_ANIMATIC_MAX_TRANSITION_MS
          )
        );
  const total = holdMs + durationMs;
  const cues = segment.cues.map((cue) => ({
    ...cue,
    offsetMs: Math.min(total, cue.offsetMs),
  }));
  return replaceSegment(document, segmentId, {
    ...segment,
    holdMs,
    transition: { kind, durationMs },
    cues,
  });
}

export function setStudioAnimaticCameraEndpoint(
  document: StudioAnimaticDocument,
  segmentId: string,
  endpoint: "start" | "end",
  patch: Partial<
    Pick<
      StudioAnimaticCameraKeyframe,
      "panXPercent" | "panYPercent" | "zoom" | "easing"
    >
  >
): StudioAnimaticDocument {
  const segment = document.segments.find(
    (candidate) => candidate.id === segmentId
  );
  if (!segment) return document;
  const first = segment.cameraKeyframes[0] ?? defaultCameraKeyframes()[0]!;
  const last =
    segment.cameraKeyframes[segment.cameraKeyframes.length - 1]
    ?? defaultCameraKeyframes()[1]!;
  const target = endpoint === "start" ? first : last;
  const updated: StudioAnimaticCameraKeyframe = {
    at: endpoint === "start" ? 0 : 1,
    panXPercent: clamp(
      patch.panXPercent ?? target.panXPercent,
      -100,
      100
    ),
    panYPercent: clamp(
      patch.panYPercent ?? target.panYPercent,
      -100,
      100
    ),
    zoom: clamp(patch.zoom ?? target.zoom, 0.25, 4),
    easing:
      patch.easing === "linear" || patch.easing === "ease-in-out"
        ? patch.easing
        : target.easing,
  };
  const middle = segment.cameraKeyframes.filter(
    (keyframe) => keyframe.at > 0 && keyframe.at < 1
  );
  const cameraKeyframes =
    endpoint === "start"
      ? [updated, ...middle, { ...last, at: 1 }]
      : [{ ...first, at: 0 }, ...middle, updated];
  return replaceSegment(document, segmentId, {
    ...segment,
    cameraKeyframes,
  });
}

function nextCueId(
  segment: StudioAnimaticSegment,
  kind: StudioAnimaticCueKind
): string {
  let ordinal = segment.cues.length + 1;
  let id = `cue-${kind}-${ordinal}`;
  const ids = new Set(segment.cues.map((cue) => cue.id));
  while (ids.has(id)) {
    ordinal += 1;
    id = `cue-${kind}-${ordinal}`;
  }
  return id;
}

export function addStudioAnimaticCue(
  document: StudioAnimaticDocument,
  segmentId: string,
  kind: StudioAnimaticCueKind
): StudioAnimaticDocument {
  const segment = document.segments.find(
    (candidate) => candidate.id === segmentId
  );
  if (
    !segment
    || segment.cues.length >= STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT
  ) {
    return document;
  }
  const cue: StudioAnimaticCue = {
    id: nextCueId(segment, kind),
    kind,
    offsetMs: Math.round(segmentDurationMs(segment) / 2),
    text: kind === "dialogue" ? "새 대사 cue" : "새 효과음 cue",
  };
  return replaceSegment(document, segmentId, {
    ...segment,
    cues: [...segment.cues, cue].sort(
      (left, right) =>
        left.offsetMs - right.offsetMs || compareCodeUnits(left.id, right.id)
    ),
  });
}

export function patchStudioAnimaticCue(
  document: StudioAnimaticDocument,
  segmentId: string,
  cueId: string,
  patch: Partial<
    Pick<StudioAnimaticCue, "kind" | "offsetMs" | "text" | "speaker">
  >
): StudioAnimaticDocument {
  const segment = document.segments.find(
    (candidate) => candidate.id === segmentId
  );
  if (!segment) return document;
  let changed = false;
  const cues = segment.cues.map((cue) => {
    if (cue.id !== cueId) return cue;
    const text = normalizeText(patch.text ?? cue.text).slice(
      0,
      STUDIO_ANIMATIC_MAX_CUE_TEXT_CHARS
    );
    if (!text) return cue;
    changed = true;
    return {
      ...cue,
      kind:
        patch.kind === "dialogue" || patch.kind === "sfx"
          ? patch.kind
          : cue.kind,
      offsetMs: Math.round(
        clamp(
          patch.offsetMs ?? cue.offsetMs,
          0,
          segmentDurationMs(segment)
        )
      ),
      text,
      speaker:
        patch.speaker === undefined
          ? cue.speaker
          : normalizeText(patch.speaker).slice(
              0,
              STUDIO_ANIMATIC_MAX_LABEL_CHARS
            ) || undefined,
    };
  });
  if (!changed) return document;
  return replaceSegment(document, segmentId, {
    ...segment,
    cues: cues.sort(
      (left, right) =>
        left.offsetMs - right.offsetMs || compareCodeUnits(left.id, right.id)
    ),
  });
}

export function removeStudioAnimaticCue(
  document: StudioAnimaticDocument,
  segmentId: string,
  cueId: string
): StudioAnimaticDocument {
  const segment = document.segments.find(
    (candidate) => candidate.id === segmentId
  );
  if (!segment) return document;
  const cues = segment.cues.filter((cue) => cue.id !== cueId);
  return cues.length === segment.cues.length
    ? document
    : replaceSegment(document, segmentId, { ...segment, cues });
}

export function exportStudioAnimaticDocument(
  document: StudioAnimaticDocument
): StudioAnimaticExportResult | StudioAnimaticFailure {
  const validated = validateStudioAnimaticDocument(document);
  if (!validated.ok) return validated;
  const json = JSON.stringify(validated.document, null, 2);
  const bytes = utf8Bytes(json);
  if (bytes > STUDIO_ANIMATIC_MAX_EXPORT_BYTES) {
    return {
      ok: false,
      error: `애니매틱 JSON은 ${(STUDIO_ANIMATIC_MAX_EXPORT_BYTES / 1_000).toFixed(0)}KB 이하여야 합니다.`,
    };
  }
  return { ok: true, json, bytes };
}

export function importStudioAnimaticDocument(
  raw: string
):
  | { readonly ok: true; readonly document: StudioAnimaticDocument }
  | StudioAnimaticFailure {
  if (utf8Bytes(raw) > STUDIO_ANIMATIC_MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `가져오기 파일은 ${(STUDIO_ANIMATIC_MAX_IMPORT_BYTES / 1_000).toFixed(0)}KB 이하여야 합니다.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "애니매틱 JSON을 해석하지 못했습니다." };
  }
  return validateStudioAnimaticDocument(parsed);
}

export function studioAnimaticStorageKey(workScope: string): string {
  const normalized = normalizeText(workScope);
  return `${STUDIO_ANIMATIC_STORAGE_PREFIX}:${stableHash(normalized)}:${stableHash(normalized, 0x9e3779b1)}`;
}

export function loadStudioAnimaticDocument(
  storage: StudioAnimaticStorage | null,
  workScope: string
): StudioAnimaticLoadResult {
  if (!storage) {
    return {
      document: null,
      status: "unavailable",
      error: "브라우저 로컬 저장소를 사용할 수 없습니다.",
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(studioAnimaticStorageKey(workScope));
  } catch {
    return {
      document: null,
      status: "unavailable",
      error: "브라우저 로컬 저장소를 읽을 수 없습니다.",
    };
  }
  if (!raw) return { document: null, status: "empty" };
  const imported = importStudioAnimaticDocument(raw);
  if (!imported.ok) {
    return { document: null, status: "invalid", error: imported.error };
  }
  if (imported.document.workScope !== normalizeText(workScope)) {
    return {
      document: null,
      status: "invalid",
      error: "다른 작품 범위의 애니매틱 문서입니다.",
    };
  }
  return { document: imported.document, status: "ok" };
}

export function saveStudioAnimaticDocument(
  storage: StudioAnimaticStorage | null,
  document: StudioAnimaticDocument
): StudioAnimaticSaveResult {
  if (!storage) {
    return {
      ok: false,
      error: "로컬 저장소가 없어 현재 탭에서만 유지됩니다.",
    };
  }
  const exported = exportStudioAnimaticDocument(document);
  if (!exported.ok) return exported;
  try {
    storage.setItem(
      studioAnimaticStorageKey(document.workScope),
      exported.json
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "브라우저 저장 공간이 부족하거나 로컬 저장이 차단되었습니다.",
    };
  }
}

export function studioAnimaticBrowserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
