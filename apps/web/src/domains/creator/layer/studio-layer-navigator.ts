import type { StudioLayerSemanticKind } from "./studio-layer-palette-visual";
import type { LayerGroup } from "../studio-layers";

export const STUDIO_LAYER_KINDS = [
  "all",
  "image",
  "text",
  "bubble",
  "draw",
  "frame",
  "sticker",
  "effect",
  "other",
] as const;

export const STUDIO_LAYER_VISIBILITY_FILTERS = ["all", "visible", "hidden"] as const;
export const STUDIO_LAYER_LOCK_FILTERS = ["all", "locked", "unlocked"] as const;
export const STUDIO_LAYER_FLAGS = [
  "reference",
  "alpha-locked",
  "masked",
  "ai",
  "clipped",
  "animated",
] as const;
export const STUDIO_LAYER_ROLES = [
  "storyboard",
  "rough",
  "lineart",
  "color",
  "tone",
  "lettering",
  "effect",
  "reference",
] as const;
export const STUDIO_LAYER_COLORS = ["red", "orange", "yellow", "green", "blue", "violet"] as const;

export type StudioLayerKind = (typeof STUDIO_LAYER_KINDS)[number];
export type StudioLayerVisibilityFilter = (typeof STUDIO_LAYER_VISIBILITY_FILTERS)[number];
export type StudioLayerLockFilter = (typeof STUDIO_LAYER_LOCK_FILTERS)[number];
export type StudioLayerFlag = (typeof STUDIO_LAYER_FLAGS)[number];
export type StudioLayerRole = (typeof STUDIO_LAYER_ROLES)[number];
export type StudioLayerColor = (typeof STUDIO_LAYER_COLORS)[number];
export type StudioLayerRoleFilter = "all" | "unassigned" | StudioLayerRole;
export type StudioLayerColorFilter = "all" | "none" | StudioLayerColor;

export interface StudioLayerNavigatorFilters {
  kind: StudioLayerKind;
  visibility: StudioLayerVisibilityFilter;
  lock: StudioLayerLockFilter;
  role: StudioLayerRoleFilter;
  color: StudioLayerColorFilter;
  flags: readonly StudioLayerFlag[];
}

export interface StudioLayerNavigatorItem {
  id: string;
  type?: string;
  /**
   * Optional visual classification for document types that share a render container.
   * Studio 3D/VRM outputs currently persist as image elements and should project `three-d`.
   */
  semanticKind?: StudioLayerSemanticKind;
  label: string;
  textContent?: string;
  zIndex: number;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
  /** 0–1. Undefined means fully opaque; the row's inline scrubber edits this. */
  opacity?: number;
  alphaLocked?: boolean;
  fillReference?: boolean;
  masked?: boolean;
  maskEnabled?: boolean;
  aiGenerated?: boolean;
  clipBelow?: boolean;
  animated?: boolean;
  role?: StudioLayerRole;
  color?: StudioLayerColor;
}

export interface StudioLayerNavigatorResult {
  item: StudioLayerNavigatorItem;
  kind: Exclude<StudioLayerKind, "all">;
  group: LayerGroup | null;
  effectivelyHidden: boolean;
  effectivelyLocked: boolean;
}

export interface StudioLayerNavigatorStats {
  total: number;
  visible: number;
  hidden: number;
  locked: number;
  referenced: number;
  masked: number;
  ai: number;
  byKind: Record<Exclude<StudioLayerKind, "all">, number>;
}

export type StudioLayerNavigatorNode =
  | {
      kind: "item";
      key: string;
      entry: StudioLayerNavigatorResult;
    }
  | {
      kind: "group";
      key: string;
      group: LayerGroup;
      entries: readonly StudioLayerNavigatorResult[];
      segmentIndex: number;
      empty: boolean;
      expanded: boolean;
    };

export type StudioLayerSelectionMode = "replace" | "toggle" | "range" | "add-range";

export interface StudioLayerSelectionInput {
  orderedVisibleIds: readonly string[];
  currentIds: readonly string[];
  anchorId: string | null;
  targetId: string;
  mode: StudioLayerSelectionMode;
  maximum?: number;
}

export interface StudioLayerSelectionResult {
  selectedIds: readonly string[];
  anchorId: string | null;
}

export const DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS: StudioLayerNavigatorFilters = {
  kind: "all",
  visibility: "all",
  lock: "all",
  role: "all",
  color: "all",
  flags: [],
};

const KIND_KEYWORDS: Record<Exclude<StudioLayerKind, "all">, readonly string[]> = {
  image: ["image", "raster", "이미지", "래스터", "사진"],
  text: ["text", "type", "텍스트", "글자", "대사"],
  bubble: ["bubble", "speech", "balloon", "말풍선", "대사"],
  draw: ["draw", "pen", "line", "stroke", "선화", "펜", "그리기", "도형"],
  frame: ["frame", "panel", "컷", "패널", "프레임"],
  sticker: ["sticker", "emoji", "스티커", "장식"],
  effect: ["effect", "focus", "speed", "효과", "집중선", "속도선"],
  other: ["other", "unknown", "기타", "알 수 없음"],
};

type StudioLayerSearchCacheEntry = {
  label: string;
  textContent: string | undefined;
  id: string;
  groupName: string | undefined;
  kind: Exclude<StudioLayerKind, "all">;
  role: StudioLayerRole | undefined;
  color: StudioLayerColor | undefined;
  haystack: string;
};

// 검색어만 바뀌는 동안 동일한 불변 레이어 객체의 최대 4KB NFKC 정규화를 반복하지 않는다.
// WeakMap이라 문서 교체로 객체가 사라지면 캐시도 함께 수거된다.
const STUDIO_LAYER_SEARCH_CACHE = new WeakMap<StudioLayerNavigatorItem, StudioLayerSearchCacheEntry>();

export const STUDIO_LAYER_KIND_LABELS: Record<StudioLayerKind, string> = {
  all: "전체",
  image: "이미지",
  text: "텍스트",
  bubble: "말풍선",
  draw: "선화",
  frame: "컷",
  sticker: "스티커",
  effect: "효과",
  other: "기타",
};

export const STUDIO_LAYER_FLAG_LABELS: Record<StudioLayerFlag, string> = {
  reference: "채우기 참조",
  "alpha-locked": "알파 락",
  masked: "마스크",
  ai: "AI 작업",
  clipped: "아래 클리핑",
  animated: "애니메이션",
};

export const STUDIO_LAYER_ROLE_LABELS: Record<StudioLayerRole, string> = {
  storyboard: "콘티",
  rough: "밑그림",
  lineart: "선화",
  color: "채색",
  tone: "톤",
  lettering: "레터링",
  effect: "효과",
  reference: "참고",
};

export const STUDIO_LAYER_COLOR_LABELS: Record<StudioLayerColor, string> = {
  red: "빨강",
  orange: "주황",
  yellow: "노랑",
  green: "초록",
  blue: "파랑",
  violet: "보라",
};

export function normalizeStudioLayerRole(value: unknown): StudioLayerRole | undefined {
  return includesValue(STUDIO_LAYER_ROLES, value) ? value : undefined;
}

export function normalizeStudioLayerColor(value: unknown): StudioLayerColor | undefined {
  return includesValue(STUDIO_LAYER_COLORS, value) ? value : undefined;
}

function includesValue<Value extends string>(values: readonly Value[], value: unknown): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

export function normalizeStudioLayerNavigatorFilters(value: unknown): StudioLayerNavigatorFilters {
  if (!value || typeof value !== "object") return { ...DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS };
  const candidate = value as Partial<StudioLayerNavigatorFilters>;
  const flags = Array.isArray(candidate.flags)
    ? [...new Set(candidate.flags.filter((flag): flag is StudioLayerFlag => includesValue(STUDIO_LAYER_FLAGS, flag)))]
    : [];
  const role =
    candidate.role === "all" || candidate.role === "unassigned" || includesValue(STUDIO_LAYER_ROLES, candidate.role)
      ? candidate.role
      : "all";
  const color =
    candidate.color === "all" || candidate.color === "none" || includesValue(STUDIO_LAYER_COLORS, candidate.color)
      ? candidate.color
      : "all";
  return {
    kind: includesValue(STUDIO_LAYER_KINDS, candidate.kind) ? candidate.kind : "all",
    visibility: includesValue(STUDIO_LAYER_VISIBILITY_FILTERS, candidate.visibility)
      ? candidate.visibility
      : "all",
    lock: includesValue(STUDIO_LAYER_LOCK_FILTERS, candidate.lock) ? candidate.lock : "all",
    role,
    color,
    flags,
  };
}

export function studioLayerKindForType(type: string | null | undefined): Exclude<StudioLayerKind, "all"> {
  if (type === "image") return "image";
  if (type === "text") return "text";
  if (type === "bubble") return "bubble";
  if (type === "draw") return "draw";
  if (type === "frame") return "frame";
  if (type === "sticker") return "sticker";
  if (type === "focusLines" || type === "speedLines") return "effect";
  return "other";
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function boundedSearchPart(value: string | null | undefined, maximum = 4_096): string {
  if (!value) return "";
  return value.slice(0, maximum);
}

function createGroupIndex(groups: readonly LayerGroup[]): Map<string, LayerGroup> {
  const result = new Map<string, LayerGroup>();
  for (const group of groups) {
    if (!result.has(group.id)) result.set(group.id, group);
  }
  return result;
}

function effectiveLayerState(item: StudioLayerNavigatorItem, group: LayerGroup | null) {
  return {
    hidden: item.hidden === true || group?.hidden === true,
    locked: item.locked === true || group?.locked === true,
  };
}

function itemFlags(item: StudioLayerNavigatorItem): ReadonlySet<StudioLayerFlag> {
  const flags = new Set<StudioLayerFlag>();
  if (item.fillReference) flags.add("reference");
  if (item.alphaLocked) flags.add("alpha-locked");
  if (item.masked) flags.add("masked");
  if (item.aiGenerated) flags.add("ai");
  if (item.clipBelow) flags.add("clipped");
  if (item.animated) flags.add("animated");
  return flags;
}

function matchesRole(item: StudioLayerNavigatorItem, role: StudioLayerRoleFilter): boolean {
  if (role === "all") return true;
  if (role === "unassigned") return item.role === undefined;
  return item.role === role;
}

function matchesColor(item: StudioLayerNavigatorItem, color: StudioLayerColorFilter): boolean {
  if (color === "all") return true;
  if (color === "none") return item.color === undefined;
  return item.color === color;
}

function searchHaystack(
  item: StudioLayerNavigatorItem,
  kind: Exclude<StudioLayerKind, "all">,
  group: LayerGroup | null
): string {
  const cached = STUDIO_LAYER_SEARCH_CACHE.get(item);
  if (
    cached?.label === item.label &&
    cached.textContent === item.textContent &&
    cached.id === item.id &&
    cached.groupName === group?.name &&
    cached.kind === kind &&
    cached.role === item.role &&
    cached.color === item.color
  ) return cached.haystack;
  const haystack = normalizeSearchText(
    [
      boundedSearchPart(item.label, 512),
      boundedSearchPart(item.textContent),
      boundedSearchPart(item.id, 256),
      boundedSearchPart(group?.name, 256),
      ...KIND_KEYWORDS[kind],
      item.role ? `${item.role} ${STUDIO_LAYER_ROLE_LABELS[item.role]}` : "",
      item.color ? `${item.color} ${STUDIO_LAYER_COLOR_LABELS[item.color]}` : "",
    ].join(" ")
  );
  STUDIO_LAYER_SEARCH_CACHE.set(item, {
    label: item.label,
    textContent: item.textContent,
    id: item.id,
    groupName: group?.name,
    kind,
    role: item.role,
    color: item.color,
    haystack,
  });
  return haystack;
}

export function filterStudioLayerNavigatorItems(
  items: readonly StudioLayerNavigatorItem[],
  groups: readonly LayerGroup[],
  query: string,
  filters: StudioLayerNavigatorFilters
): readonly StudioLayerNavigatorResult[] {
  const normalized = normalizeStudioLayerNavigatorFilters(filters);
  const terms = normalizeSearchText(query.slice(0, 512)).split(" ").filter(Boolean);
  const groupIndex = createGroupIndex(groups);

  const result: StudioLayerNavigatorResult[] = [];
  for (const item of items) {
    const kind = studioLayerKindForType(item.type);
    if (normalized.kind !== "all" && normalized.kind !== kind) continue;
    const group = item.groupId ? (groupIndex.get(item.groupId) ?? null) : null;
    const effectiveState = effectiveLayerState(item, group);
    const effectivelyHidden = effectiveState.hidden;
    const effectivelyLocked = effectiveState.locked;
    if (normalized.visibility === "visible" && effectivelyHidden) continue;
    if (normalized.visibility === "hidden" && !effectivelyHidden) continue;
    if (normalized.lock === "locked" && !effectivelyLocked) continue;
    if (normalized.lock === "unlocked" && effectivelyLocked) continue;
    if (!matchesRole(item, normalized.role) || !matchesColor(item, normalized.color)) continue;
    if (normalized.flags.length > 0) {
      const flags = itemFlags(item);
      if (!normalized.flags.every((flag) => flags.has(flag))) continue;
    }
    if (terms.length > 0) {
      const haystack = searchHaystack(item, kind, group);
      if (!terms.every((term) => haystack.includes(term))) continue;
    }
    result.push({ item, kind, group, effectivelyHidden, effectivelyLocked });
  }
  return result;
}

export function countActiveStudioLayerFilters(filters: StudioLayerNavigatorFilters): number {
  const normalized = normalizeStudioLayerNavigatorFilters(filters);
  return (
    Number(normalized.kind !== "all") +
    Number(normalized.visibility !== "all") +
    Number(normalized.lock !== "all") +
    Number(normalized.role !== "all") +
    Number(normalized.color !== "all") +
    normalized.flags.length
  );
}

export function summarizeStudioLayerNavigator(
  items: readonly StudioLayerNavigatorItem[],
  groups: readonly LayerGroup[]
): StudioLayerNavigatorStats {
  const byKind: StudioLayerNavigatorStats["byKind"] = {
    image: 0,
    text: 0,
    bubble: 0,
    draw: 0,
    frame: 0,
    sticker: 0,
    effect: 0,
    other: 0,
  };
  let visible = 0;
  let hidden = 0;
  let locked = 0;
  let referenced = 0;
  let masked = 0;
  let ai = 0;
  const groupIndex = createGroupIndex(groups);
  for (const item of items) {
    byKind[studioLayerKindForType(item.type)] += 1;
    const group = item.groupId ? (groupIndex.get(item.groupId) ?? null) : null;
    const effectiveState = effectiveLayerState(item, group);
    if (effectiveState.hidden) hidden += 1;
    else visible += 1;
    if (effectiveState.locked) locked += 1;
    if (item.fillReference) referenced += 1;
    if (item.masked) masked += 1;
    if (item.aiGenerated) ai += 1;
  }
  return { total: items.length, visible, hidden, locked, referenced, masked, ai, byKind };
}

/**
 * 필터된 FRONT→BACK 엔트리를 안전한 표시 노드로 묶는다. 손상된 비연속 그룹은 세그먼트를
 * 보존하되 고유 key를 부여하고, 필터 중에는 문서의 collapsed 값을 쓰지 않고 일시 펼친다.
 */
export function buildStudioLayerNavigatorNodes(
  entriesInDisplayOrder: readonly StudioLayerNavigatorResult[],
  groups: readonly LayerGroup[],
  options: { filterActive: boolean; includeEmptyGroups?: boolean }
): readonly StudioLayerNavigatorNode[] {
  const nodes: StudioLayerNavigatorNode[] = [];
  const segmentCount = new Map<string, number>();
  const groupsWithMembers = new Set<string>();
  let current: { group: LayerGroup; entries: StudioLayerNavigatorResult[] } | null = null;

  const flush = () => {
    if (!current) return;
    const segmentIndex = segmentCount.get(current.group.id) ?? 0;
    segmentCount.set(current.group.id, segmentIndex + 1);
    groupsWithMembers.add(current.group.id);
    nodes.push({
      kind: "group",
      key: `group:${current.group.id}:${segmentIndex}`,
      group: current.group,
      entries: current.entries,
      segmentIndex,
      empty: false,
      expanded: options.filterActive || current.group.collapsed !== true,
    });
    current = null;
  };

  for (let index = 0; index < entriesInDisplayOrder.length; index += 1) {
    const entry = entriesInDisplayOrder[index]!;
    if (entry.group) {
      if (current?.group.id === entry.group.id) current.entries.push(entry);
      else {
        flush();
        current = { group: entry.group, entries: [entry] };
      }
    } else {
      flush();
      nodes.push({ kind: "item", key: `item:${entry.item.id}`, entry });
    }
  }
  flush();

  if (options.includeEmptyGroups !== false && !options.filterActive) {
    const emitted = new Set<string>();
    for (const group of groups) {
      if (emitted.has(group.id)) continue;
      emitted.add(group.id);
      if (groupsWithMembers.has(group.id)) continue;
      nodes.push({
        kind: "group",
        key: `group:${group.id}:empty`,
        group,
        entries: [],
        segmentIndex: 0,
        empty: true,
        expanded: group.collapsed !== true,
      });
    }
  }
  return nodes;
}

export function selectStudioLayerRange(
  displayOrderIds: readonly string[],
  anchorId: string | null,
  targetId: string
): readonly string[] {
  const targetIndex = displayOrderIds.indexOf(targetId);
  if (targetIndex < 0) return [];
  const anchorIndex = anchorId ? displayOrderIds.indexOf(anchorId) : -1;
  if (anchorIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return displayOrderIds.slice(start, end + 1);
}

export function toggleStudioLayerSelection(
  selectedIds: readonly string[],
  targetId: string,
  maximum = 500
): readonly string[] {
  const unique = [...new Set(selectedIds.filter(Boolean))];
  if (unique.includes(targetId)) return unique.filter((id) => id !== targetId);
  if (unique.length >= Math.max(1, Math.floor(maximum))) return unique;
  return [...unique, targetId];
}

export function reduceStudioLayerSelection(input: StudioLayerSelectionInput): StudioLayerSelectionResult {
  const maximum = Math.max(1, Math.floor(input.maximum ?? 500));
  const current = [...new Set(input.currentIds.filter(Boolean))].slice(0, maximum);
  if (!input.orderedVisibleIds.includes(input.targetId)) {
    return { selectedIds: current, anchorId: input.anchorId };
  }

  if (input.mode === "replace") {
    return { selectedIds: [input.targetId], anchorId: input.targetId };
  }
  if (input.mode === "toggle") {
    return {
      selectedIds: toggleStudioLayerSelection(current, input.targetId, maximum),
      anchorId: input.targetId,
    };
  }

  const range = selectStudioLayerRange(input.orderedVisibleIds, input.anchorId, input.targetId);
  if (input.mode === "add-range") {
    return {
      selectedIds: [...new Set([...current, ...range])].slice(0, maximum),
      anchorId: input.anchorId && input.orderedVisibleIds.includes(input.anchorId) ? input.anchorId : input.targetId,
    };
  }
  return {
    selectedIds: range.slice(0, maximum),
    anchorId: input.anchorId && input.orderedVisibleIds.includes(input.anchorId) ? input.anchorId : input.targetId,
  };
}

export function countStudioLayerSelectionOutsideResults(
  selectedIds: readonly string[],
  resultIds: readonly string[]
): number {
  const resultSet = new Set(resultIds);
  return [...new Set(selectedIds)].filter((id) => !resultSet.has(id)).length;
}
