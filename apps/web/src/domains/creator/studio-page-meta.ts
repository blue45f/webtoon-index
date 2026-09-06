/**
 * Studio Page Meta & Element Clipboard — 페이지 메타(이름·콘티 메모)와
 * 요소 클립보드(⌘C/⌘V 페이지 간 복사)의 순수 로직 (PPT급 편집 UX).
 *
 * 1) 페이지 메타: {name?, note?} 를 페이지 객체에 옵셔널로 실어 pagesList JSON 직렬화에
 *    그대로 편승한다 — 과거 문서(메타 없음)는 자동 이름("1페이지")으로 표시되고,
 *    메타를 지우면 키 자체를 제거해 직렬화 형태가 레거시와 동일하게 유지된다(하위호환).
 * 2) 요소 클립보드: 선택 요소들을 버전·출처 페이지 크기(canvasW/H)·출처 페이지 id 를 포함한
 *    JSON 페이로드로 직렬화한다. 붙여넣기 planner 는 대상 페이지 좌표계로
 *    스케일(캔버스 폭 비율)·오프셋(같은 페이지 겹침 방지 캐스케이드)·완전 이탈 구조 보정을
 *    수행하고 id/groupId 를 재발급한다. 시스템 클립보드가 막힌 환경을 위한
 *    localStorage 폴백(저장소 주입식)을 함께 제공한다.
 *
 * 전부 불변 · 부수효과 없음(폴백 저장소는 주입식). DOM/Konva/React 의존 없음.
 * studio-pages.ts 는 다른 소유라 수정하지 않는다 — 이 모듈은 합성으로만 동작한다.
 */

import {
  MAX_TIMELINE_FRAME_COUNT,
  MAX_TRACK_KEYFRAMES,
  type AnimationTimelineDoc,
  type StudioAnimKeyframe,
} from "./studio-anim-tracks";
import { STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS } from "./studio-upload-image-safety";
import { serializeStudioVrmSceneDocument } from "./vrm/studio-vrm-scene-document";

import type { LayerGroup } from "./studio-layers";

// ─────────────────────────────────────────────────────────────────────────────
// 1) 페이지 메타 (이름 · 콘티 메모)
// ─────────────────────────────────────────────────────────────────────────────

/** 페이지 이름 최대 길이(스트립 UI·직렬화 비대 방지). */
export const PAGE_NAME_MAX = 40;
/** 콘티 메모 최대 길이. */
export const PAGE_NOTE_MAX = 500;

/** 페이지에 실리는 메타 — 둘 다 옵셔널이라 과거 문서와 JSON 형태 호환. */
export interface PageMeta {
  name?: string;
  note?: string;
}

/** 메타를 실을 수 있는 페이지 최소 형태(외부 문서는 name/note 타입 보장이 없어 unknown). */
export interface PageMetaCarrier {
  id: string;
  name?: unknown;
  note?: unknown;
}

/** 메타 패치 — null/빈 문자열/명시적 undefined 는 "키 제거"(자동 이름 복귀)를 뜻한다. */
export interface PageMetaPatch {
  name?: string | null;
  note?: string | null;
}

/** 문자열 메타 정리: 문자열 아님/공백뿐 → undefined(제거), 초과 길이는 자름. */
function cleanMetaText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** 자동 이름 규칙 — 0-기반 인덱스로 "1페이지", "2페이지"… (음수/실수/NaN 방어). */
export function autoPageName(index: number): string {
  const n = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return `${n + 1}페이지`;
}

/** 표시 이름: 커스텀 이름(정리 후 유효)이 있으면 그것, 없으면 자동 이름. */
export function pageDisplayName(page: { name?: unknown } | null | undefined, index: number): string {
  const custom = page ? cleanMetaText(page.name, PAGE_NAME_MAX) : undefined;
  return custom ?? autoPageName(index);
}

/** 커스텀 이름 보유 여부(스트립에서 강조 표시 등에 사용). */
export function hasCustomPageName(page: { name?: unknown } | null | undefined): boolean {
  return !!page && cleanMetaText(page.name, PAGE_NAME_MAX) !== undefined;
}

/** 외부/과거 문서에서 읽은 페이지의 메타를 안전 정규화(잘못된 타입·공백·초과 길이 방어). */
export function normalizePageMeta(raw: unknown): PageMeta {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as { name?: unknown; note?: unknown };
  const meta: PageMeta = {};
  const name = cleanMetaText(o.name, PAGE_NAME_MAX);
  const note = cleanMetaText(o.note, PAGE_NOTE_MAX);
  if (name !== undefined) meta.name = name;
  if (note !== undefined) meta.note = note;
  return meta;
}

/**
 * 페이지 메타 설정/제거 — 불변. 빈 값(null/""/공백)은 키를 통째로 제거해
 * 직렬화 결과가 레거시 문서와 동일한 형태로 남는다.
 *
 * 실질 변화가 없으면 **원본 배열 참조를 그대로 반환**한다 — 호출측은
 * `next !== pages` 일 때만 커밋해 undo 히스토리 오염(blur 마다 커밋)을 막을 수 있다.
 */
export function withPageMeta<P extends PageMetaCarrier>(
  pages: readonly P[],
  pageId: string,
  patch: PageMetaPatch
): P[] {
  const idx = pages.findIndex((p) => p.id === pageId);
  // 대상 없음 → 변화 없음(원본 참조 반환).
  if (idx < 0) return pages as P[];
  const page = pages[idx];

  const curName = cleanMetaText(page.name, PAGE_NAME_MAX);
  const curNote = cleanMetaText(page.note, PAGE_NOTE_MAX);
  const nextName = "name" in patch ? cleanMetaText(patch.name, PAGE_NAME_MAX) : curName;
  const nextNote = "note" in patch ? cleanMetaText(patch.note, PAGE_NOTE_MAX) : curNote;
  if (nextName === curName && nextNote === curNote) return pages as P[];

  const nextPage = { ...page } as P & PageMeta;
  if (nextName === undefined) delete (nextPage as { name?: unknown }).name;
  else nextPage.name = nextName;
  if (nextNote === undefined) delete (nextPage as { note?: unknown }).note;
  else nextPage.note = nextNote;
  return pages.map((p, i) => (i === idx ? (nextPage as P) : p));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) 요소 클립보드 (⌘C/⌘V — 페이지 간 복사)
// ─────────────────────────────────────────────────────────────────────────────

/** 페이로드 식별 마커 — 일반 텍스트/타 앱 JSON 과 구분. */
export const STUDIO_CLIPBOARD_KIND = "toonspectrum/studio-elements";
/** 페이로드 버전 — 상위 버전 페이로드는 거부(미래 포맷 오독 방지). */
export const STUDIO_CLIPBOARD_VERSION = 2;
/** 시스템 클립보드가 막힌 환경(권한 차단·구형 브라우저)용 storage 폴백 키. */
export const CLIPBOARD_FALLBACK_KEY = "toonspectrum-studio-clipboard";
/** 같은 페이지 붙여넣기 시 겹침 방지 오프셋(px) — 복제(⌘J)와 동일 감각. */
export const PASTE_OFFSET = 16;
/** External clipboard admission budgets. They bound JSON parsing/render work without truncation. */
export const STUDIO_CLIPBOARD_MAX_SERIALIZED_CHARS = 64 * 1024 * 1024;
export const STUDIO_CLIPBOARD_MAX_ELEMENTS = 10_000;
export const STUDIO_CLIPBOARD_MAX_ID_CHARS = 256;
export const STUDIO_CLIPBOARD_MAX_SOURCE_CHARS = 20 * 1024 * 1024;
export const STUDIO_CLIPBOARD_MAX_POINT_VALUES = 200_000;
/** Canvas/filter paths allocate by displayed image dimensions, so bound both axes and area. */
export const STUDIO_CLIPBOARD_MAX_IMAGE_AXIS = 16_384;
export const STUDIO_CLIPBOARD_MAX_IMAGE_PIXELS = STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS;
const STUDIO_CLIPBOARD_MAX_TEXT_CHARS = 1_000_000;
const STUDIO_CLIPBOARD_MAX_STYLE_CHARS = 4_096;
const STUDIO_CLIPBOARD_MAX_GROUP_NAME_CHARS = 512;
const STUDIO_CLIPBOARD_MAX_ABS_NUMBER = 10_000_000;
const STUDIO_CLIPBOARD_MAX_JSON_DEPTH = 32;
const STUDIO_CLIPBOARD_MAX_JSON_NODES = 1_000_000;
const STUDIO_CLIPBOARD_MAX_OBJECT_KEYS = 512;
const STUDIO_CLIPBOARD_ELEMENT_TYPES = new Set([
  "image",
  "text",
  "bubble",
  "sticker",
  "draw",
  "frame",
  "focusLines",
  "speedLines",
]);

/** 직렬화된 스튜디오 요소 최소 형태 — 메인 루프가 El 로 캐스팅한다. */
export interface ClipboardElementLike {
  id: string;
  [key: string]: unknown;
}

/** 복사 출처 정보 — 대상 페이지 좌표 보정(스케일·오프셋)의 기준. */
export interface ClipboardSourceInfo {
  canvasW: number;
  canvasH: number;
  /** 출처 페이지 id — 같은 페이지 붙여넣기 판정(겹침 방지 오프셋)에 사용. */
  pageId?: string;
}

/** 클립보드 페이로드 — 버전·출처 페이지 크기 포함 JSON 직렬화 단위. */
export interface StudioClipboardPayload {
  kind: typeof STUDIO_CLIPBOARD_KIND;
  version: number;
  copiedAt: number;
  source: ClipboardSourceInfo;
  els: ClipboardElementLike[];
  /** Selected group metadata. Optional so v1 clipboard payloads keep parsing. */
  groups?: LayerGroup[];
  /** Selected layer tracks. Target pages keep their own fps and grow frameCount when needed. */
  animation?: {
    frameCount: number;
    tracks: Record<string, StudioAnimKeyframe[]>;
  };
}

export interface BuildClipboardPayloadExtras {
  groups?: readonly LayerGroup[];
  animationTimeline?: Pick<AnimationTimelineDoc, "frameCount" | "tracks">;
}

/** 붙여넣기 대상 페이지 정보. */
export interface ClipboardPasteTarget {
  canvasW: number;
  canvasH: number;
  pageId?: string;
}

/** 붙여넣기 계획 — 좌표 보정·id 재발급이 끝난 요소들과 선택 갱신용 새 id 목록. */
export interface ClipboardPastePlan {
  els: ClipboardElementLike[];
  ids: string[];
  groups: LayerGroup[];
  animationTracks: Record<string, StudioAnimKeyframe[]>;
  animationFrameCount?: number;
}

/** localStorage 호환 폴백 저장소(주입식 — 테스트/SSR 안전). */
export interface ClipboardFallbackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Account/work-scoped key prevents a copied draft from crossing an auth or document boundary. */
export function studioClipboardFallbackStorageKey(scope: {
  authScopeKey?: string | null;
  workId?: string | null;
}): string {
  const auth = scope.authScopeKey?.trim() || "anonymous";
  const work = scope.workId?.trim() || "local";
  return `${CLIPBOARD_FALLBACK_KEY}:${encodeURIComponent(auth)}:${encodeURIComponent(work)}`;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isBoundedString(v: unknown, max: number, allowEmpty = true): v is string {
  return typeof v === "string" && (allowEmpty || v.length > 0) && v.length <= max;
}

function isFiniteClipboardNumber(v: unknown, positive = false): v is number {
  return typeof v === "number" && Number.isFinite(v) &&
    Math.abs(v) <= STUDIO_CLIPBOARD_MAX_ABS_NUMBER && (!positive || v > 0);
}

function isSafeClipboardLineCount(v: unknown, max: number): v is number {
  return isFiniteClipboardNumber(v, true) && Number.isInteger(v) && v <= max;
}

function hasSafeClipboardImageDimensions(value: Record<string, unknown>): boolean {
  const width = value.width;
  const height = value.height;
  if (
    !isFiniteClipboardNumber(width, true) ||
    !isFiniteClipboardNumber(height, true) ||
    width > STUDIO_CLIPBOARD_MAX_IMAGE_AXIS ||
    height > STUDIO_CLIPBOARD_MAX_IMAGE_AXIS
  ) {
    return false;
  }
  const pixels = Math.ceil(width) * Math.ceil(height);
  return Number.isSafeInteger(pixels) && pixels <= STUDIO_CLIPBOARD_MAX_IMAGE_PIXELS;
}

function hasFiniteFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  positiveFields: readonly string[] = []
): boolean {
  const positive = new Set(positiveFields);
  return fields.every((field) => isFiniteClipboardNumber(value[field], positive.has(field)));
}

function isBoundedNumberArray(value: unknown, exactLength?: number): value is number[] {
  if (!Array.isArray(value)) return false;
  if (exactLength !== undefined && value.length !== exactLength) return false;
  if (value.length > STUDIO_CLIPBOARD_MAX_POINT_VALUES) return false;
  return value.every((entry) => isFiniteClipboardNumber(entry));
}

function hasSafeClipboardJsonComplexity(root: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number; exit?: boolean; inArray?: boolean }> = [
    { value: root, depth: 0 },
  ];
  const activePath = new WeakSet<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.exit) {
      activePath.delete(current.value as object);
      continue;
    }
    nodes += 1;
    if (nodes > STUDIO_CLIPBOARD_MAX_JSON_NODES || current.depth > STUDIO_CLIPBOARD_MAX_JSON_DEPTH) {
      return false;
    }
    const value = current.value;
    if (value === undefined) {
      // JSON.stringify drops undefined object properties, but coerces array entries to null.
      if (current.inArray) return false;
      continue;
    }
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value === "string") {
      if (value.length > STUDIO_CLIPBOARD_MAX_SOURCE_CHARS) return false;
      continue;
    }
    if (typeof value !== "object" || activePath.has(value)) return false;
    activePath.add(value);
    stack.push({ value, depth: current.depth, exit: true });
    if (Array.isArray(value)) {
      if (value.length > STUDIO_CLIPBOARD_MAX_POINT_VALUES) return false;
      for (const entry of value) {
        stack.push({ value: entry, depth: current.depth + 1, inArray: true });
      }
      continue;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > STUDIO_CLIPBOARD_MAX_OBJECT_KEYS) return false;
    for (const [key, entry] of entries) {
      if (key.length > STUDIO_CLIPBOARD_MAX_ID_CHARS) return false;
      stack.push({ value: entry, depth: current.depth + 1, inArray: false });
    }
  }
  return true;
}

function hasSafeImageClipboardOptionals(value: Record<string, unknown>): boolean {
  if (value.maskSrc !== undefined && !isBoundedString(value.maskSrc, STUDIO_CLIPBOARD_MAX_SOURCE_CHARS)) {
    return false;
  }
  if (value.bg3dScene !== undefined && !isRecord(value.bg3dScene)) return false;
  if (value.communityAssetCredit !== undefined && !isRecord(value.communityAssetCredit)) return false;
  if (
    value.vrmScene !== undefined
    && (!isRecord(value.vrmScene) || serializeStudioVrmSceneDocument(value.vrmScene) === null)
  ) return false;
  if (value.smartFilters !== undefined && !isRecord(value.smartFilters)) return false;
  if (value.frames !== undefined) {
    if (!Array.isArray(value.frames) || value.frames.length > 60) return false;
    for (const frame of value.frames) {
      if (
        !isRecord(frame) ||
        !isBoundedString(frame.id, STUDIO_CLIPBOARD_MAX_ID_CHARS, false) ||
        !isBoundedString(frame.src, STUDIO_CLIPBOARD_MAX_SOURCE_CHARS, false) ||
        (frame.durationMs !== undefined && !isFiniteClipboardNumber(frame.durationMs, true))
      ) return false;
    }
  }
  return true;
}

function hasSafeDrawClipboardOptionals(value: Record<string, unknown>): boolean {
  for (const field of [
    "pressures",
    "tiltXs",
    "tiltYs",
    "twists",
    "speeds",
    "tangentialPressures",
  ]) {
    if (value[field] !== undefined && !isBoundedNumberArray(value[field])) return false;
  }
  return true;
}

function hasSafeCommonClipboardFields(value: Record<string, unknown>): boolean {
  if (!isBoundedString(value.id, STUDIO_CLIPBOARD_MAX_ID_CHARS, false)) return false;
  if (!isBoundedString(value.type, 32, false) || !STUDIO_CLIPBOARD_ELEMENT_TYPES.has(value.type)) {
    return false;
  }
  if (value.groupId !== undefined && !isBoundedString(value.groupId, STUDIO_CLIPBOARD_MAX_ID_CHARS, false)) {
    return false;
  }
  if (value.name !== undefined && !isBoundedString(value.name, STUDIO_CLIPBOARD_MAX_TEXT_CHARS)) {
    return false;
  }
  if (value.opacity !== undefined && !isFiniteClipboardNumber(value.opacity)) return false;
  return true;
}

function isClipboardLayerGroup(value: unknown): value is LayerGroup {
  if (!isRecord(value) || !hasSafeClipboardJsonComplexity(value)) return false;
  if (!isBoundedString(value.id, STUDIO_CLIPBOARD_MAX_ID_CHARS, false)) return false;
  if (
    !isBoundedString(value.name, STUDIO_CLIPBOARD_MAX_GROUP_NAME_CHARS, false) ||
    [...value.name].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    })
  ) return false;
  for (const field of ["collapsed", "hidden", "locked"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") return false;
  }
  return true;
}

function isClipboardAnimationKeyframe(
  value: unknown,
  frameCount: number
): value is StudioAnimKeyframe {
  if (!isRecord(value) || !hasSafeClipboardJsonComplexity(value)) return false;
  if (
    typeof value.frameIndex !== "number" ||
    !Number.isInteger(value.frameIndex) ||
    value.frameIndex < 0 ||
    value.frameIndex >= frameCount
  ) return false;
  const frame = value.frame;
  if (
    !isRecord(frame) ||
    !isBoundedString(frame.id, STUDIO_CLIPBOARD_MAX_ID_CHARS, false) ||
    !isBoundedString(frame.src, STUDIO_CLIPBOARD_MAX_SOURCE_CHARS, false) ||
    (frame.durationMs !== undefined && (
      !isFiniteClipboardNumber(frame.durationMs, true) || frame.durationMs > 60_000
    ))
  ) return false;
  if (
    value.ease !== undefined
    && value.ease !== "linear"
    && value.ease !== "ease-in"
    && value.ease !== "ease-out"
    && value.ease !== "ease-in-out"
  ) {
    return false;
  }
  if (value.transform !== undefined) {
    if (!isRecord(value.transform)) return false;
    if (!hasFiniteFields(value.transform, ["x", "y", "rotation", "scaleX", "scaleY"], ["scaleX", "scaleY"])) {
      return false;
    }
  }
  return true;
}

function isClipboardAnimation(
  value: unknown,
  elementTypes: ReadonlyMap<string, unknown>
): value is NonNullable<StudioClipboardPayload["animation"]> {
  if (!isRecord(value) || !hasSafeClipboardJsonComplexity(value)) return false;
  const frameCount = value.frameCount;
  if (
    typeof frameCount !== "number" ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > MAX_TIMELINE_FRAME_COUNT ||
    !isRecord(value.tracks)
  ) return false;
  const tracks = Object.entries(value.tracks);
  if (tracks.length > elementTypes.size) return false;
  for (const [trackId, keyframes] of tracks) {
    if (
      elementTypes.get(trackId) !== "image" ||
      !Array.isArray(keyframes) ||
      keyframes.length < 1 ||
      keyframes.length > MAX_TRACK_KEYFRAMES
    ) {
      return false;
    }
    let previousFrameIndex = -1;
    for (const keyframe of keyframes) {
      if (!isClipboardAnimationKeyframe(keyframe, frameCount) || keyframe.frameIndex <= previousFrameIndex) {
        return false;
      }
      previousFrameIndex = keyframe.frameIndex;
    }
  }
  return true;
}

/** Validate the minimum render contract before an external JSON value is ever cast to Studio El. */
function isClipboardElement(v: unknown): v is ClipboardElementLike {
  if (
    !isRecord(v) ||
    !hasSafeClipboardJsonComplexity(v) ||
    !hasSafeCommonClipboardFields(v)
  ) return false;
  switch (v.type) {
    case "image":
      return isBoundedString(v.src, STUDIO_CLIPBOARD_MAX_SOURCE_CHARS, false) &&
        hasFiniteFields(v, ["x", "y", "rotation"]) &&
        hasSafeClipboardImageDimensions(v) &&
        hasSafeImageClipboardOptionals(v);
    case "text":
      return isBoundedString(v.text, STUDIO_CLIPBOARD_MAX_TEXT_CHARS) &&
        isBoundedString(v.fill, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        hasFiniteFields(v, ["x", "y", "width", "fontSize", "rotation"], ["width", "fontSize"]);
    case "bubble":
      return isBoundedString(v.variant, 64, false) &&
        isBoundedString(v.text, STUDIO_CLIPBOARD_MAX_TEXT_CHARS) &&
        isBoundedString(v.fill, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        isBoundedString(v.textFill, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        hasFiniteFields(v, ["x", "y", "width", "height", "rotation"], ["width", "height"]) &&
        (v.tailAnchorId === undefined || isBoundedString(v.tailAnchorId, STUDIO_CLIPBOARD_MAX_ID_CHARS, false)) &&
        (v.tailAnchorPoint === undefined || (
          isRecord(v.tailAnchorPoint) && hasFiniteFields(v.tailAnchorPoint, ["x", "y"])
        )) &&
        (v.customShapePoints === undefined || isBoundedNumberArray(v.customShapePoints));
    case "sticker":
      return isBoundedString(v.text, STUDIO_CLIPBOARD_MAX_TEXT_CHARS) &&
        hasFiniteFields(v, ["x", "y", "fontSize", "rotation"], ["fontSize"]);
    case "draw":
      return isBoundedNumberArray(v.points) && v.points.length >= 2 && v.points.length % 2 === 0 &&
        isBoundedString(v.stroke, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        isFiniteClipboardNumber(v.strokeWidth, true) && hasSafeDrawClipboardOptionals(v);
    case "frame":
      return hasFiniteFields(v, ["x", "y", "width", "height"], ["width", "height"]) &&
        (v.points === undefined || isBoundedNumberArray(v.points, 8));
    case "focusLines":
      return isBoundedString(v.stroke, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        isSafeClipboardLineCount(v.lineCount, 200) &&
        hasFiniteFields(
          v,
          ["x", "y", "width", "height", "innerRadius", "outerRadius", "strokeWidth", "noise", "rotation"],
          ["width", "height", "outerRadius", "strokeWidth"]
        );
    case "speedLines":
      return (v.direction === "horizontal" || v.direction === "vertical") &&
        isBoundedString(v.stroke, STUDIO_CLIPBOARD_MAX_STYLE_CHARS, false) &&
        isSafeClipboardLineCount(v.lineCount, 150) &&
        hasFiniteFields(
          v,
          ["x", "y", "width", "height", "strokeWidth", "rotation"],
          ["width", "height", "strokeWidth"]
        );
    default:
      return false;
  }
}

/** 페이로드 형식 검증 — kind/version/source/els 전부 맞아야 통과. */
export function isClipboardPayload(v: unknown): v is StudioClipboardPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.kind !== STUDIO_CLIPBOARD_KIND) return false;
  if (
    typeof o.version !== "number" ||
    !Number.isInteger(o.version) ||
    o.version < 1 ||
    o.version > STUDIO_CLIPBOARD_VERSION
  ) {
    return false;
  }
  if (typeof o.copiedAt !== "number" || !Number.isFinite(o.copiedAt) || o.copiedAt < 0) {
    return false;
  }
  const src = o.source as Record<string, unknown> | null | undefined;
  if (!src || typeof src !== "object") return false;
  if (!isPositiveFinite(src.canvasW) || !isPositiveFinite(src.canvasH)) return false;
  if (
    src.pageId !== undefined &&
    !isBoundedString(src.pageId, STUDIO_CLIPBOARD_MAX_ID_CHARS, false)
  ) return false;
  if (!Array.isArray(o.els) || o.els.length > STUDIO_CLIPBOARD_MAX_ELEMENTS) return false;
  const ids = new Set<string>();
  const elementTypes = new Map<string, unknown>();
  const referencedGroupIds = new Set<string>();
  for (const element of o.els) {
    if (!isClipboardElement(element) || ids.has(element.id)) return false;
    ids.add(element.id);
    elementTypes.set(element.id, element.type);
    if (typeof element.groupId === "string") referencedGroupIds.add(element.groupId);
  }
  if (o.groups !== undefined) {
    if (!Array.isArray(o.groups) || o.groups.length > referencedGroupIds.size) return false;
    const groupIds = new Set<string>();
    for (const group of o.groups) {
      if (
        !isClipboardLayerGroup(group) ||
        !referencedGroupIds.has(group.id) ||
        groupIds.has(group.id)
      ) return false;
      groupIds.add(group.id);
    }
  }
  if (o.animation !== undefined && !isClipboardAnimation(o.animation, elementTypes)) return false;
  return true;
}

/** JSON 왕복 깊은 복사 — 원본 요소와 참조를 완전히 분리(undefined 키는 자연 탈락). */
function deepCopyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 선택 요소들 → 클립보드 페이로드. 좌표는 원본 그대로 실어 보내고(정규화 없음),
 * 보정은 붙여넣기 planner 가 담당한다. id 없는 항목은 걸러낸다.
 */
export function buildClipboardPayload(
  els: readonly unknown[],
  source: ClipboardSourceInfo,
  now: number = Date.now(),
  extras?: BuildClipboardPayloadExtras
): StudioClipboardPayload {
  const valid = els.filter(isClipboardElement);
  const src: ClipboardSourceInfo = {
    canvasW: isPositiveFinite(source.canvasW) ? source.canvasW : 1,
    canvasH: isPositiveFinite(source.canvasH) ? source.canvasH : 1,
  };
  if (typeof source.pageId === "string" && source.pageId) src.pageId = source.pageId;
  const payload: StudioClipboardPayload = {
    kind: STUDIO_CLIPBOARD_KIND,
    version: STUDIO_CLIPBOARD_VERSION,
    copiedAt: now,
    source: src,
    els: deepCopyJson(valid),
  };
  const elementIds = new Set(valid.map((element) => element.id));
  const elementTypes = new Map(valid.map((element) => [element.id, element.type] as const));
  const referencedGroupIds = new Set(
    valid.flatMap((element) => typeof element.groupId === "string" ? [element.groupId] : [])
  );
  const selectedGroups = (extras?.groups ?? []).filter(
    (group) => referencedGroupIds.has(group.id) && isClipboardLayerGroup(group)
  );
  if (selectedGroups.length > 0) payload.groups = deepCopyJson(selectedGroups);

  if (extras?.animationTimeline) {
    const tracks: Record<string, StudioAnimKeyframe[]> = {};
    for (const elementId of elementIds) {
      const track = extras.animationTimeline.tracks[elementId];
      if (track?.length) tracks[elementId] = deepCopyJson(track);
    }
    const animation = {
      frameCount: extras.animationTimeline.frameCount,
      tracks,
    };
    if (Object.keys(tracks).length > 0 && isClipboardAnimation(animation, elementTypes)) {
      payload.animation = animation;
    }
  }
  return payload;
}

/** Cut safety gate: every captured member must survive admission in the exact document order. */
export function clipboardPayloadMatchesMembers(
  payload: StudioClipboardPayload,
  memberIds: readonly string[],
  expectedRelations?: {
    groupIds?: readonly string[];
    trackIds?: readonly string[];
  }
): boolean {
  if (
    !isClipboardPayload(payload) ||
    payload.els.length !== memberIds.length ||
    !payload.els.every((element, index) => element.id === memberIds[index])
  ) return false;
  if (expectedRelations?.groupIds !== undefined) {
    const expectedGroups = new Set(expectedRelations.groupIds);
    const payloadGroups = new Set(payload.groups?.map((group) => group.id) ?? []);
    if (
      payloadGroups.size !== expectedGroups.size ||
      [...expectedGroups].some((id) => !payloadGroups.has(id))
    ) return false;
  }
  if (expectedRelations?.trackIds !== undefined) {
    const expectedTracks = new Set(expectedRelations.trackIds);
    const payloadTracks = new Set(Object.keys(payload.animation?.tracks ?? {}));
    if (
      payloadTracks.size !== expectedTracks.size ||
      [...expectedTracks].some((id) => !payloadTracks.has(id))
    ) return false;
  }
  return true;
}

/** 페이로드 → JSON 문자열(시스템 클립보드 text/plain 및 폴백 저장용). */
export function serializeClipboardPayload(payload: StudioClipboardPayload): string {
  return JSON.stringify(payload);
}

/** JSON 문자열 → 페이로드. 우리 형식이 아니거나 파싱 실패면 null(일반 텍스트 무해 통과). */
export function parseClipboardPayload(raw: string | null | undefined): StudioClipboardPayload | null {
  if (typeof raw !== "string") return null;
  if (raw.length > STUDIO_CLIPBOARD_MAX_SERIALIZED_CHARS) return null;
  const text = raw.trim();
  // 빠른 배제: JSON 객체 형태가 아니면 파싱 시도조차 하지 않는다(일반 텍스트 대량 붙여넣기 대비).
  if (!text.startsWith("{") || !text.includes(STUDIO_CLIPBOARD_KIND)) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isClipboardPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 복사 대상 수집(문서 순서 보존) — 다중 선택(marquee)이 있으면 그 요소들,
 * 아니면 단일 선택(그룹 소속이면 그룹 전체 — PPT 그룹 복사 감각). 없으면 빈 배열.
 */
export function collectCopyElements<E extends { id: string; groupId?: string }>(
  elements: readonly E[],
  selectedId: string | null | undefined,
  marqueeIds: readonly string[]
): E[] {
  if (marqueeIds.length > 0) {
    const set = new Set(marqueeIds);
    return elements.filter((e) => set.has(e.id));
  }
  if (!selectedId) return [];
  const selected = elements.find((e) => e.id === selectedId);
  if (!selected) return [];
  if (selected.groupId) {
    const groupId = selected.groupId;
    return elements.filter((e) => e.groupId === groupId);
  }
  return [selected];
}

// ── 붙여넣기 planner 내부 유틸 ────────────────────────────────────────────────

/** 스케일 대상 스칼라 키 — 캔버스 폭 비율이 다른 문서 간 붙여넣기에서 비례 유지. */
const SCALE_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "fontSize",
  "strokeWidth",
  "letterSpacing",
  "innerRadius",
  "outerRadius",
  "tailHeight",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowBlur",
] as const;

/** 부동소수 잡음 제거(직렬화 비대·좌표 떨림 방지). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 요소 지오메트리를 균일 스케일(s)로 보정한 사본. s=1 이면 사본만 반환. */
function scaleElement(el: ClipboardElementLike, s: number): ClipboardElementLike {
  const next: ClipboardElementLike = { ...el };
  if (s === 1) return next;
  for (const key of SCALE_KEYS) {
    const v = next[key];
    if (typeof v === "number" && Number.isFinite(v)) next[key] = round2(v * s);
  }
  const points = next.points;
  if (Array.isArray(points)) {
    next.points = points.map((v) => (typeof v === "number" && Number.isFinite(v) ? round2(v * s) : v));
  }
  if (isRecord(next.tailAnchorPoint)) {
    next.tailAnchorPoint = {
      x: round2((next.tailAnchorPoint.x as number) * s),
      y: round2((next.tailAnchorPoint.y as number) * s),
    };
  }
  return next;
}

/** 관대한 바운딩 박스 — StudioPage.elBounds 와 동일 규칙(draw/text/sticker/기타). */
function looseElBounds(el: ClipboardElementLike): { x: number; y: number; w: number; h: number } {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (el.type === "draw" && Array.isArray(el.points) && el.points.length >= 2) {
    const pts = el.points as unknown[];
    let minX = num(pts[0]);
    let minY = num(pts[1]);
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i + 1 < pts.length; i += 2) {
      const x = num(pts[i]);
      const y = num(pts[i + 1]);
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") return { x: num(el.x), y: num(el.y), w: num(el.width), h: num(el.fontSize) * 1.4 };
  if (el.type === "sticker") return { x: num(el.x), y: num(el.y), w: num(el.fontSize), h: num(el.fontSize) };
  return { x: num(el.x), y: num(el.y), w: num(el.width), h: num(el.height) };
}

/** 요소 묶음의 합집합 바운딩 박스. */
function unionLooseBounds(els: readonly ClipboardElementLike[]): { x: number; y: number; w: number; h: number } | null {
  if (els.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    const b = looseElBounds(el);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 평행이동 — draw 는 points(x,y 교차 배열), 그 외는 x/y. */
function shiftLooseElement(el: ClipboardElementLike, dx: number, dy: number): ClipboardElementLike {
  if (dx === 0 && dy === 0) return el;
  const next: ClipboardElementLike = { ...el };
  if (el.type === "draw" && Array.isArray(el.points)) {
    next.points = (el.points as unknown[]).map((v, i) =>
      typeof v === "number" && Number.isFinite(v) ? round2(v + (i % 2 === 0 ? dx : dy)) : v
    );
    return next;
  }
  if (typeof next.x === "number" && Number.isFinite(next.x)) next.x = round2(next.x + dx);
  if (typeof next.y === "number" && Number.isFinite(next.y)) next.y = round2(next.y + dy);
  if (isRecord(next.tailAnchorPoint)) {
    next.tailAnchorPoint = {
      x: round2((next.tailAnchorPoint.x as number) + dx),
      y: round2((next.tailAnchorPoint.y as number) + dy),
    };
  }
  return next;
}

/**
 * 한 축 구조 보정: 묶음이 캔버스에서 **완전히 벗어난 경우에만** 안으로 끌어온다.
 * (부분 겹침은 의도된 배치로 보고 존중 — PPT 도 다른 슬라이드에 같은 좌표로 붙인다.)
 * 캔버스보다 큰 묶음은 시작 모서리(0)에 맞춘다.
 */
function rescueAxis(pos: number, size: number, limit: number): number {
  if (!isPositiveFinite(limit)) return 0;
  if (pos >= limit) return size > limit ? -pos : limit - size - pos; // 오른쪽/아래로 완전 이탈
  if (pos + size <= 0) return -pos; // 왼쪽/위로 완전 이탈
  return 0;
}

/**
 * 붙여넣기 planner — 페이로드를 대상 페이지 좌표계로 보정해 새 요소 목록을 만든다.
 *
 * 1) 스케일: 캔버스 폭 비율(target/source)로 지오메트리 균일 보정(같은 폭이면 무보정).
 * 2) 오프셋: 같은 페이지면 PASTE_OFFSET 캐스케이드(offsetSteps 로 연속 붙여넣기 단수 지정,
 *    미지정 시 같은 페이지=1 · 다른 페이지=0), 다른 페이지면 원좌표 유지.
 * 3) 구조: 묶음이 대상 캔버스에서 완전히 벗어나면(짧은 페이지로 붙여넣기 등) 안으로 끌어온다.
 * 4) id 재발급 + groupId 재매핑(묶음 구조 보존) + hidden/locked 해제.
 *
 * 페이로드가 비었거나 형식이 어긋나면 null.
 */
export function planClipboardPaste(
  payload: StudioClipboardPayload,
  target: ClipboardPasteTarget,
  makeId: () => string,
  opts?: { offsetSteps?: number }
): ClipboardPastePlan | null {
  if (!isClipboardPayload(payload) || payload.els.length === 0) return null;

  const srcW = payload.source.canvasW;
  const tgtW = isPositiveFinite(target.canvasW) ? target.canvasW : srcW;
  const tgtH = isPositiveFinite(target.canvasH) ? target.canvasH : payload.source.canvasH;
  const scale = isPositiveFinite(tgtW / srcW) ? tgtW / srcW : 1;

  // 1) 깊은 복사 + 스케일 보정
  const scaled = payload.els.map((el) => scaleElement(deepCopyJson(el), scale));
  // External source metadata can claim a tiny canvas and force a huge target scale. Reject the
  // resulting allocation before any Image/Konva filter path can create a browser canvas.
  if (scaled.some((el) => el.type === "image" && !hasSafeClipboardImageDimensions(el))) {
    return null;
  }

  // 2) 같은 페이지 겹침 방지 오프셋(캐스케이드)
  const samePage =
    typeof payload.source.pageId === "string" &&
    payload.source.pageId.length > 0 &&
    payload.source.pageId === target.pageId;
  const rawSteps = opts?.offsetSteps ?? (samePage ? 1 : 0);
  const steps = Number.isFinite(rawSteps) ? Math.max(0, Math.floor(rawSteps)) : 0;
  let dx = PASTE_OFFSET * steps;
  let dy = PASTE_OFFSET * steps;

  // 3) 완전 이탈 구조 보정(묶음 기준)
  const bounds = unionLooseBounds(scaled);
  if (bounds) {
    dx += rescueAxis(bounds.x + dx, bounds.w, tgtW);
    dy += rescueAxis(bounds.y + dy, bounds.h, tgtH);
  }

  // 4) 이동 적용 + 관계 id 재발급 + hidden/locked 해제. Element IDs are allocated first so
  // bubble tail anchors can be remapped without depending on element order.
  const idMap = new Map<string, string>();
  const ids = scaled.map((el) => {
    const id = makeId();
    idMap.set(el.id, id);
    return id;
  });
  const groupMap = new Map<string, string>();
  const els = scaled.map((el, index) => {
    const id = ids[index]!;
    const next: ClipboardElementLike = { ...shiftLooseElement(el, dx, dy), id, hidden: false, locked: false };
    const group = el.groupId;
    if (typeof group === "string" && group) {
      if (!groupMap.has(group)) groupMap.set(group, makeId());
      next.groupId = groupMap.get(group);
    }
    if (el.type === "bubble" && typeof el.tailAnchorId === "string") {
      const copiedAnchorId = idMap.get(el.tailAnchorId);
      if (copiedAnchorId) next.tailAnchorId = copiedAnchorId;
      else if (!samePage) delete next.tailAnchorId;
    }
    return next;
  });

  // Preserve user-authored group names, but pasted content always starts expanded, visible and
  // unlocked just like its member elements. Missing v1 metadata is recreated by StudioPage.
  const groups = (payload.groups ?? []).flatMap((group) => {
    const id = groupMap.get(group.id);
    return id
      ? [{ ...deepCopyJson(group), id, collapsed: false, hidden: false, locked: false }]
      : [];
  });

  const animationTracks: Record<string, StudioAnimKeyframe[]> = {};
  for (const [sourceElementId, keyframes] of Object.entries(payload.animation?.tracks ?? {})) {
    const targetElementId = idMap.get(sourceElementId);
    if (!targetElementId) continue;
    animationTracks[targetElementId] = keyframes.map((keyframe) => {
      const copied = deepCopyJson(keyframe);
      return {
        ...copied,
        frame: { ...copied.frame, id: makeId() },
        ...(copied.transform
          ? {
              transform: {
                ...copied.transform,
                x: round2(copied.transform.x * scale),
                y: round2(copied.transform.y * scale),
              },
            }
          : {}),
      };
    });
  }
  return {
    els,
    ids,
    groups,
    animationTracks,
    ...(payload.animation ? { animationFrameCount: payload.animation.frameCount } : {}),
  };
}

// ── localStorage 폴백 ────────────────────────────────────────────────────────

/** 폴백 저장 — 시스템 클립보드 기록 성공 여부와 무관하게 항상 함께 남겨 ⌘V 를 보장한다. */
export function writeClipboardFallback(
  storage: ClipboardFallbackStorage | null | undefined,
  payload: StudioClipboardPayload,
  storageKey: string = CLIPBOARD_FALLBACK_KEY
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey, serializeClipboardPayload(payload));
  } catch {
    // 저장 불가(쿼터 초과·시크릿 모드) — 무시
  }
}

/** 폴백 읽기 — 저장소 부재·파싱 실패·형식 불일치는 null. */
export function readClipboardFallback(
  storage: ClipboardFallbackStorage | null | undefined,
  storageKey: string = CLIPBOARD_FALLBACK_KEY
): StudioClipboardPayload | null {
  if (!storage) return null;
  try {
    return parseClipboardPayload(storage.getItem(storageKey));
  } catch {
    return null;
  }
}
