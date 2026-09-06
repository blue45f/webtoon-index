/**
 * Studio History Labels — 히스토리 스냅샷 diff → 사람용 한국어 라벨(순수 로직).
 * StudioPage 의 pagesHistory(PageState[][]) 인접 항목을 비교해
 * "텍스트 추가", "요소 3개 이동", "페이지 순서 변경" 같은 단계 라벨을 만들고,
 * 히스토리 목록 점프(현재 인덱스 → 목표 인덱스) 계획을 계산한다.
 * 상태 커밋/점프 반영은 호출 측(StudioPage·StudioHistoryPanel)이 담당.
 *
 * 전부 불변 · 부수효과 없음(스냅샷 불변성을 이용한 내부 라벨 메모만). Konva/React/DOM 의존 없음.
 */

import {
  areStudioDrawingAssistDocumentsEqual,
  normalizeStudioDrawingAssistDocument,
} from "./brush/studio-drawing-assist-document";
import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";

// StudioPage 의 El 과 구조 호환되는 최소 형태 — diff 휴리스틱에 쓰는 필드만 선언한다.
export interface HistoryElementLike {
  id: string;
  type?: unknown; // "image" | "text" | "bubble" | "sticker" | "draw" | "frame" | "focusLines" | "speedLines"
  kind?: unknown; // draw 전용: "freehand" 외에는 도형으로 간주
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  fontSize?: unknown;
  rotation?: unknown;
  points?: unknown; // draw/frame: 평행이동(이동)과 형태 변화(모양 수정)를 구분
  text?: unknown;
  hidden?: unknown;
  locked?: unknown;
  groupId?: unknown;
  name?: unknown;
  opacity?: unknown;
  src?: unknown;
  fillReference?: unknown;
}

// StudioPage 의 PageState 와 구조 호환되는 최소 형태.
export interface HistoryPageLike {
  id: string;
  elements: readonly HistoryElementLike[];
  bg?: unknown;
  bgGrad?: unknown;
  canvasH?: unknown;
  grade?: unknown;
  groups?: unknown;
  name?: unknown;
  note?: unknown;
  drawingAssist?: unknown;
}

/** 히스토리 한 칸 = 전체 페이지 배열 스냅샷(StudioPage pagesHistory 의 원소). */
export type HistorySnapshot = readonly HistoryPageLike[];

/** 히스토리 목록 한 항목 — index 는 pagesHi 와 같은 좌표계, ordinal 은 사람용 순번(1부터). */
export interface HistoryTimelineEntry {
  index: number;
  ordinal: number;
  label: string;
}

/** 히스토리 점프 계획 — undo/redo 를 steps 회 반복한 것과 동일한 인덱스 이동. */
export interface HistoryJumpPlan {
  /** [0, length-1] 로 클램프된 목표 인덱스. */
  targetIndex: number;
  /** 과거로(undo) / 미래로(redo) / 제자리(none). */
  direction: "undo" | "redo" | "none";
  /** undo 또는 redo 반복 호출 횟수(=|현재-목표|). */
  steps: number;
}

/** 첫 스냅샷(비교 대상 없음)의 라벨. */
export const HISTORY_INITIAL_LABEL = "처음 상태";
/** 패널에 한 번에 그리는 최대 항목 수 — 가상화 없이 DOM 크기를 상수로 묶는다. */
export const HISTORY_PANEL_MAX_VISIBLE = 60;

// ── 요소 명칭 ──────────────────────────────────────────────────────────────
// StudioPage 레이어 목록(elementLabel)과 같은 어휘를 쓴다.
const EL_TYPE_NOUNS: Record<string, string> = {
  image: "이미지",
  text: "텍스트",
  bubble: "말풍선",
  sticker: "스티커",
  draw: "그림",
  frame: "패널",
  focusLines: "집중선",
  speedLines: "속도선",
};

/** 요소 1개의 한국어 명칭(그림 vs 도형 구분 포함). 알 수 없으면 "요소". */
export function historyElementNoun(el: HistoryElementLike): string {
  const type = typeof el.type === "string" ? el.type : "";
  if (type === "draw" && typeof el.kind === "string" && el.kind !== "freehand") return "도형";
  return EL_TYPE_NOUNS[type] ?? "요소";
}

// 여러 요소를 묶어 부르는 주어 — 전부 같은 종류면 "말풍선 2개", 섞이면 "요소 3개".
function elementSubject(els: readonly HistoryElementLike[]): string {
  if (els.length === 0) return "요소";
  const first = historyElementNoun(els[0]);
  if (els.length === 1) return first;
  const allSame = els.every((el) => historyElementNoun(el) === first);
  return allSame ? `${first} ${els.length}개` : `요소 ${els.length}개`;
}

// ── 요소 단위 변화 분류 ─────────────────────────────────────────────────────
type ElementChangeKind =
  | "text"
  | "resize"
  | "rotate"
  | "move"
  | "shape"
  | "visibility"
  | "lock"
  | "group"
  | "rename"
  | "opacity"
  | "pixels"
  | "fill-reference"
  | "style";

// points 배열 비교 — 동일 / 평행이동(모든 점이 같은 dx,dy) / 형태 변화.
function comparePoints(prev: unknown, next: unknown): "same" | "translate" | "reshape" {
  const a = Array.isArray(prev) ? prev : null;
  const b = Array.isArray(next) ? next : null;
  if (!a && !b) return "same";
  if (!a || !b || a.length !== b.length) return "reshape";
  if (a.length === 0) return "same";
  if (a.length % 2 !== 0) {
    // 홀수 길이는 좌표쌍이 아니다 — 값이 다르면 형태 변화로 취급.
    return a.every((v, i) => v === b[i]) ? "same" : "reshape";
  }
  const dx = Number(b[0]) - Number(a[0]);
  const dy = Number(b[1]) - Number(a[1]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "reshape";
  let identical = true;
  for (let i = 0; i < a.length; i += 2) {
    const ddx = Number(b[i]) - Number(a[i]);
    const ddy = Number(b[i + 1]) - Number(a[i + 1]);
    if (!Number.isFinite(ddx) || !Number.isFinite(ddy)) return "reshape";
    // 부동소수 커밋 오차 허용치(0.001px) — 그 이상 어긋나면 형태 변화.
    if (Math.abs(ddx - dx) > 1e-3 || Math.abs(ddy - dy) > 1e-3) return "reshape";
    if (ddx !== 0 || ddy !== 0) identical = false;
  }
  if (identical) return "same";
  return dx === 0 && dy === 0 ? "reshape" : "translate";
}

// 같은 id 요소의 변화 종류 1개로 축약. null 이면 실질 변화 없음(참조만 새것).
// 우선순위: 내용(텍스트) > 크기 > 회전 > 이동 > 모양 > 표시 > 잠금 > 그룹 > 이름 > 불투명도 > 기타.
// 말풍선 텍스트 확정은 height 를 함께 패치하므로 내용이 크기보다 앞선다.
function classifyElementChange(prev: HistoryElementLike, next: HistoryElementLike): ElementChangeKind | null {
  if (prev === next) return null;
  if (prev.text !== next.text) return "text";
  if (prev.width !== next.width || prev.height !== next.height || prev.fontSize !== next.fontSize) return "resize";
  if (prev.rotation !== next.rotation) return "rotate";
  const pointsDiff = comparePoints(prev.points, next.points);
  if (prev.x !== next.x || prev.y !== next.y || pointsDiff === "translate") return "move";
  if (pointsDiff === "reshape") return "shape";
  if (prev.hidden !== next.hidden) return "visibility";
  if (prev.locked !== next.locked) return "lock";
  if (prev.groupId !== next.groupId) return "group";
  if (prev.name !== next.name) return "rename";
  if (prev.opacity !== next.opacity) return "opacity";
  if (prev.fillReference !== next.fillReference) return "fill-reference";
  if (prev.src !== next.src) return "pixels";
  // 추적 필드가 모두 같음 — 참조만 새것(무변화 재구성)이면 변화 아님,
  // 아니면 색/폰트 등 스타일 계열 패치로 간주.
  return shallowEqualElementRecords(prev, next) ? null : "style";
}

// 얕은 동등성 — map 재구성 등으로 참조만 새것인 요소를 실질 변화로 오인하지 않는 마지막 관문.
// points 는 위에서 comparePoints 로 이미 "동일" 판정을 받은 상태라 건너뛴다(배열 참조가 달라도 같음).
function shallowEqualElementRecords(a: HistoryElementLike, b: HistoryElementLike): boolean {
  // 인터페이스에는 암묵적 인덱스 시그니처가 없어 unknown 경유로 변환한다.
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keysA = Object.keys(ra);
  if (keysA.length !== Object.keys(rb).length) return false;
  for (const key of keysA) {
    if (key === "points") continue;
    if (!Object.is(ra[key], rb[key])) return false;
  }
  return true;
}

// 변화 종류 → 술어(주어 뒤에 붙는 말). visibility/lock 은 방향에 따라 별도 처리.
const CHANGE_KIND_PHRASES: Record<Exclude<ElementChangeKind, "visibility" | "lock" | "fill-reference">, string> = {
  text: "내용 수정",
  resize: "크기 조절",
  rotate: "회전",
  move: "이동",
  shape: "모양 수정",
  group: "그룹 변경",
  rename: "이름 변경",
  opacity: "불투명도 변경",
  pixels: "픽셀 편집",
  style: "스타일 변경",
};

// ── 페이지 1장 diff ─────────────────────────────────────────────────────────
interface PageDiff {
  /** 요소 변화 요약(없으면 null). kind 는 변화가 전부 같은 종류일 때만 채워진다. */
  elements: {
    label: string;
    onlyTextEdits: boolean;
    onlyGroupEdits: boolean;
  } | null;
  bg: boolean;
  canvasH: boolean;
  grade: boolean;
  groups: boolean;
  meta: boolean;
  drawingAssist: boolean;
}

function drawingAssistDocumentsDiffer(
  previous: unknown,
  next: unknown,
  canvasHeight: unknown
): boolean {
  if (Object.is(previous, next)) return false;
  const viewport = {
    canvasWidth: STUDIO_CANVAS_WIDTH,
    canvasHeight: typeof canvasHeight === "number" && Number.isFinite(canvasHeight)
      ? canvasHeight
      : 1_080,
  };
  return !areStudioDrawingAssistDocumentsEqual(
    normalizeStudioDrawingAssistDocument(previous, viewport),
    normalizeStudioDrawingAssistDocument(next, viewport)
  );
}

function diffPage(prev: HistoryPageLike, next: HistoryPageLike): PageDiff {
  const diff: PageDiff = {
    elements: null,
    bg: prev.bg !== next.bg || prev.bgGrad !== next.bgGrad,
    canvasH: prev.canvasH !== next.canvasH,
    grade: prev.grade !== next.grade,
    groups: prev.groups !== next.groups,
    meta: prev.name !== next.name || prev.note !== next.note,
    drawingAssist: drawingAssistDocumentsDiffer(
      prev.drawingAssist,
      next.drawingAssist,
      next.canvasH
    ),
  };
  if (prev.elements !== next.elements) diff.elements = diffElements(prev.elements, next.elements);
  return diff;
}

function diffElements(
  prev: readonly HistoryElementLike[],
  next: readonly HistoryElementLike[]
): PageDiff["elements"] {
  const prevById = new Map<string, HistoryElementLike>();
  for (const el of prev) prevById.set(el.id, el);
  const nextIds = new Set<string>();
  const added: HistoryElementLike[] = [];
  for (const el of next) {
    nextIds.add(el.id);
    if (!prevById.has(el.id)) added.push(el);
  }
  const removed = prev.filter((el) => !nextIds.has(el.id));

  if (added.length > 0 || removed.length > 0) {
    let label: string;
    if (added.length > 0 && removed.length > 0) {
      // Raster merge / flatten: 2+ sources removed, single composite image added.
      if (removed.length >= 2 && added.length === 1 && added[0]?.type === "image") {
        label = removed.length >= 3 ? "보이는 레이어 병합" : "레이어 병합";
      } else {
        label = "요소 구성 변경";
      }
    } else if (added.length > 0) label = `${elementSubject(added)} 추가`;
    else label = `${elementSubject(removed)} 삭제`;
    return { label, onlyTextEdits: false, onlyGroupEdits: false };
  }

  // 같은 id 집합 — 내용 변화(패치) 분류.
  const changed: HistoryElementLike[] = [];
  const kinds = new Set<ElementChangeKind>();
  for (const el of next) {
    const before = prevById.get(el.id);
    if (!before || before === el) continue;
    const kind = classifyElementChange(before, el);
    if (!kind) continue;
    changed.push(el);
    kinds.add(kind);
  }

  if (changed.length === 0) {
    // 내용 변화 없이 순서만 다르면 레이어 순서 변경(앞으로/뒤로 보내기).
    const orderChanged = prev.some((el, i) => next[i]?.id !== el.id);
    if (orderChanged) return { label: "레이어 순서 변경", onlyTextEdits: false, onlyGroupEdits: false };
    return null;
  }

  const subject = elementSubject(changed);
  if (kinds.size > 1) return { label: `${subject} 편집`, onlyTextEdits: false, onlyGroupEdits: false };

  const kind = [...kinds][0];
  if (kind === "visibility") {
    const allHidden = changed.every((el) => el.hidden === true);
    const allShown = changed.every((el) => el.hidden !== true);
    const phrase = allHidden ? "숨김" : allShown ? "표시" : "표시 전환";
    return { label: `${subject} ${phrase}`, onlyTextEdits: false, onlyGroupEdits: false };
  }
  if (kind === "lock") {
    const allLocked = changed.every((el) => el.locked === true);
    const allUnlocked = changed.every((el) => el.locked !== true);
    const phrase = allLocked ? "잠금" : allUnlocked ? "잠금 해제" : "잠금 전환";
    return { label: `${subject} ${phrase}`, onlyTextEdits: false, onlyGroupEdits: false };
  }
  if (kind === "fill-reference") {
    const allEnabled = changed.every((el) => el.fillReference === true);
    const allDisabled = changed.every((el) => el.fillReference !== true);
    const phrase = allEnabled ? "채우기 참조 지정" : allDisabled ? "채우기 참조 해제" : "채우기 참조 전환";
    return { label: `${subject} ${phrase}`, onlyTextEdits: false, onlyGroupEdits: false };
  }
  return {
    label: `${subject} ${CHANGE_KIND_PHRASES[kind]}`,
    onlyTextEdits: kind === "text",
    onlyGroupEdits: kind === "group",
  };
}

// PageDiff → 그 페이지의 라벨(요소 라벨 + 페이지 속성 라벨을 " · " 로 결합, 최대 2개).
function pageDiffLabel(diff: PageDiff): string | null {
  const parts: string[] = [];
  // 그룹 만들기/해제는 groups 배열과 요소 groupId 를 한 커밋으로 바꾼다 — 한 라벨로 접는다.
  if (diff.elements && !(diff.elements.onlyGroupEdits && diff.groups)) parts.push(diff.elements.label);
  if (diff.groups && (!diff.elements || diff.elements.onlyGroupEdits)) parts.push("그룹 변경");
  else if (diff.groups) parts.push("레이어 그룹 변경");
  if (diff.bg) parts.push("배경 변경");
  if (diff.canvasH) parts.push("캔버스 높이 변경");
  if (diff.grade) parts.push("색보정 변경");
  if (diff.meta) parts.push("페이지 정보 수정");
  if (diff.drawingAssist) parts.push("드로잉 가이드 변경");
  if (parts.length === 0) return null;
  if (parts.length > 2) return "여러 항목 편집";
  return parts.join(" · ");
}

// ── 스냅샷 간 라벨 ──────────────────────────────────────────────────────────
/**
 * 인접 스냅샷(prev → next)의 변화를 한 줄 한국어 라벨로 요약.
 * prev 가 null 이면 첫 스냅샷("처음 상태").
 */
export function describeHistoryStep(prev: HistorySnapshot | null | undefined, next: HistorySnapshot): string {
  if (!prev) return HISTORY_INITIAL_LABEL;
  if (prev === next) return "변경 없음";

  // 1) 페이지 구조(추가/삭제/순서) 변화가 있으면 그것이 대표 라벨.
  const prevIds = new Set(prev.map((p) => p.id));
  const nextIds = new Set(next.map((p) => p.id));
  const addedPages = next.filter((p) => !prevIds.has(p.id)).length;
  const removedPages = prev.filter((p) => !nextIds.has(p.id)).length;
  if (addedPages > 0 && removedPages > 0) return "페이지 구성 변경";
  if (addedPages > 0) return addedPages === 1 ? "페이지 추가" : `페이지 ${addedPages}개 추가`;
  if (removedPages > 0) return removedPages === 1 ? "페이지 삭제" : `페이지 ${removedPages}개 삭제`;
  if (prev.length === next.length && prev.some((p, i) => next[i]?.id !== p.id)) return "페이지 순서 변경";

  // 2) 같은 페이지 구성 — 페이지별 diff 를 모은다.
  const prevById = new Map<string, HistoryPageLike>();
  for (const p of prev) prevById.set(p.id, p);
  const pageDiffs: PageDiff[] = [];
  for (const page of next) {
    const before = prevById.get(page.id);
    if (!before || before === page) continue;
    const diff = diffPage(before, page);
    if (pageDiffLabel(diff)) pageDiffs.push(diff);
  }

  if (pageDiffs.length === 0) return "변경 없음";
  if (pageDiffs.length === 1) return pageDiffLabel(pageDiffs[0]) ?? "편집";

  // 3) 여러 페이지가 한 커밋에 바뀐 경우 — 전체 적용/일괄 작업 휴리스틱.
  const n = pageDiffs.length;
  const isAll = n === next.length;
  const scope = isAll ? "전체" : `페이지 ${n}개`;
  if (pageDiffs.every((d) => !d.elements && d.grade && !d.bg && !d.canvasH && !d.groups && !d.meta && !d.drawingAssist)) {
    return `${scope} 색보정 변경`;
  }
  if (pageDiffs.every((d) => !d.elements && d.bg && !d.grade && !d.canvasH && !d.groups && !d.meta && !d.drawingAssist)) {
    return `${scope} 배경 변경`;
  }
  if (pageDiffs.every((d) => d.elements?.onlyTextEdits && !d.bg && !d.grade && !d.canvasH && !d.groups && !d.meta && !d.drawingAssist)) {
    return "대사 일괄 수정";
  }
  if (pageDiffs.every((d) => !d.elements && !d.bg && !d.grade && !d.canvasH && !d.groups && !d.meta && d.drawingAssist)) {
    return `${scope} 드로잉 가이드 변경`;
  }
  return `페이지 ${n}개 편집`;
}

// 스냅샷 불변성(커밋마다 새 배열)을 이용한 라벨 메모 — 드래그 중 재렌더에서
// 전체 타임라인 재계산을 피한다. 같은 (prev, next) 참조 쌍이면 같은 라벨.
const stepLabelCache = new WeakMap<object, { prev: object | null; label: string }>();

function describeHistoryStepCached(prev: HistorySnapshot | null, next: HistorySnapshot): string {
  const prevKey = (prev as object | null) ?? null;
  const cached = stepLabelCache.get(next as object);
  if (cached && cached.prev === prevKey) return cached.label;
  const label = describeHistoryStep(prev, next);
  stepLabelCache.set(next as object, { prev: prevKey, label });
  return label;
}

/** 히스토리 전체를 목록 항목으로 변환(오래된 것 → 최신 순). 표시 순서 뒤집기는 패널 몫. */
export function buildHistoryTimeline(history: readonly HistorySnapshot[]): HistoryTimelineEntry[] {
  return history.map((snapshot, index) => ({
    index,
    ordinal: index + 1,
    label: describeHistoryStepCached(index > 0 ? history[index - 1] : null, snapshot),
  }));
}

/** 현재 인덱스 → 목표 인덱스 점프 계획. 범위 밖 입력은 [0, length-1] 로 클램프. */
export function planHistoryJump(currentIndex: number, targetIndex: number, historyLength: number): HistoryJumpPlan {
  if (!Number.isFinite(historyLength) || historyLength <= 0) {
    return { targetIndex: 0, direction: "none", steps: 0 };
  }
  const clamp = (v: number) => Math.max(0, Math.min(historyLength - 1, Math.round(v)));
  const from = clamp(currentIndex);
  const to = clamp(targetIndex);
  const steps = Math.abs(to - from);
  return {
    targetIndex: to,
    direction: steps === 0 ? "none" : to < from ? "undo" : "redo",
    steps,
  };
}

/**
 * 표시용 창 — 최신 max 개만 남기고 앞(오래된 쪽)을 잘라 hiddenCount 로 알려준다.
 * 히스토리는 상한 없이 자랄 수 있어 패널 DOM 을 상수 크기로 유지하기 위함.
 */
export function sliceHistoryForDisplay<T>(
  entries: readonly T[],
  max: number = HISTORY_PANEL_MAX_VISIBLE
): { visible: T[]; hiddenCount: number } {
  const safeMax = Math.max(1, Math.floor(max));
  if (entries.length <= safeMax) return { visible: entries.slice(), hiddenCount: 0 };
  return { visible: entries.slice(entries.length - safeMax), hiddenCount: entries.length - safeMax };
}
