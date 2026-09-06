/**
 * Studio Layer Group & Clipping-Mask Engine
 * 레이어 그룹(폴더) + 요소별 "아래로 클리핑" 마스크를 위한 순수 z-order 엔진.
 * StudioPage는 z-order로 정렬된 평탄 elements 배열(인덱스 0=BACK, 마지막=FRONT)을 들고 있고
 * 레이어 패널은 이를 역순(FRONT 먼저)으로 보여준다. 그룹은 패널에서 하나의 접이식 블록으로
 * 보이도록 z-order에서 CONTIGUOUS(연속)하게 유지된다.
 * 전부 순수·결정적 함수 — Konva/DOM 의존 없음, StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 배열 연산은 전부 불변 — 입력을 변형하지 않고 새 배열을 반환하며, groupId가 바뀐 요소만
 * 새 객체({ ...item, groupId })로 만든다(바뀌지 않은 요소는 동일 참조 유지).
 */

// 레이어 그룹(폴더) — 패널에서 하나의 접이식 블록.
export type LayerGroup = { id: string; name: string; collapsed?: boolean; hidden?: boolean; locked?: boolean };

// StudioPage El의 최소 부분집합(엔진은 이 형태만 본다).
// name/type 은 순수 플래너가 사람이 읽을 결과 이름을 만들 때만 본다 — z-order 연산은 쓰지 않는다.
// (id 를 잘라 쓴 `병합 e6659cca` 같은 해시 이름이 레이어 행에 노출되던 결함의 재발 방지.)
export type LayerItemLike = {
  id: string;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
  /** 사용자가 지정한 레이어 이름(없으면 표시 계층이 종류에서 파생한다). */
  name?: string;
  /** El의 판별자. `"image"` 만 한 장으로 구울 수 있다. */
  type?: string;
};

/** 새 레이어 그룹 생성 — 펼침/표시/잠금 해제 상태로 시작. */
export function createLayerGroup(id: string, name: string): LayerGroup {
  return { id, name, collapsed: false, hidden: false, locked: false };
}

// ---------------------------------------------------------------------------
// 조회 — 그룹 찾기, 요소의 소속 그룹, 유효 표시/잠금
// ---------------------------------------------------------------------------

/** id로 그룹 찾기. groupId가 null/undefined거나 없으면 null. */
export function findGroup(groups: LayerGroup[], groupId: string | undefined | null): LayerGroup | null {
  if (groupId === undefined || groupId === null) return null;
  for (const group of groups) {
    if (group.id === groupId) return group;
  }
  return null;
}

/** 요소가 속한 그룹(없으면 null). */
export function groupOfItem(item: LayerItemLike, groups: LayerGroup[]): LayerGroup | null {
  return findGroup(groups, item.groupId);
}

/** 유효 표시 숨김 — 요소 자체가 hidden 이거나 소속 그룹이 hidden. */
export function isEffectivelyHidden(item: LayerItemLike, groups: LayerGroup[]): boolean {
  if (item.hidden) return true;
  const group = groupOfItem(item, groups);
  return group?.hidden === true;
}

/** 유효 잠금 — 요소 자체가 locked 이거나 소속 그룹이 locked. */
export function isEffectivelyLocked(item: LayerItemLike, groups: LayerGroup[]): boolean {
  if (item.locked) return true;
  const group = groupOfItem(item, groups);
  return group?.locked === true;
}

// ---------------------------------------------------------------------------
// 그룹 멤버십 재배치 — z-order 연속성(CONTIGUOUS) 유지가 핵심
// ---------------------------------------------------------------------------

// groupId만 갈아끼운 새 객체. (불변 규칙)
function withGroupId<T extends LayerItemLike>(item: T, groupId: string | undefined): T {
  return { ...item, groupId };
}

function groupRun<T extends LayerItemLike>(items: readonly T[], groupId: string) {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]!.groupId !== groupId) continue;
    if (first < 0) first = index;
    last = index;
    count += 1;
  }
  return { first, last, count, contiguous: count === 0 || last - first + 1 === count };
}

/** 모든 groupId가 z-order에서 최대 한 개의 연속 구간만 차지하는지 검사한다. */
export function hasContiguousLayerGroups(items: readonly LayerItemLike[]): boolean {
  const runs = new Map<string, { last: number; closed: boolean }>();
  let previousGroupId: string | undefined;
  for (let index = 0; index < items.length; index += 1) {
    const groupId = items[index]!.groupId;
    if (previousGroupId !== undefined && previousGroupId !== groupId) {
      const previous = runs.get(previousGroupId);
      if (previous) previous.closed = true;
    }
    if (groupId !== undefined) {
      const run = runs.get(groupId);
      if (run?.closed) return false;
      runs.set(groupId, { last: index, closed: false });
    }
    previousGroupId = groupId;
  }
  return true;
}

/** 요소가 참조하지만 그룹 메타데이터에는 없는 groupId를 z-order 첫 등장 순서로 반환한다. */
export function missingLayerGroupIds(
  items: readonly LayerItemLike[],
  groups: readonly LayerGroup[]
): string[] {
  const known = new Set(groups.map((group) => group.id));
  const missing = new Set<string>();
  for (const item of items) {
    if (item.groupId !== undefined && !known.has(item.groupId)) missing.add(item.groupId);
  }
  return [...missing];
}

/**
 * 주어진 ids를 한 그룹(groupId)으로 묶고, z-order 배열에서 CONTIGUOUS가 되도록 재배치한 새 배열을 반환.
 * 규칙: 멤버들은 멤버 중 "가장 앞(가장 큰 인덱스) 멤버" 자리로 모은다. 멤버 간 상대순서 보존,
 * 비멤버 간 상대순서 보존. ids에 해당하는 요소의 groupId를 groupId로 설정. 존재하지 않는 id는 무시.
 * 예: ids [a,b,c,d,e] + ["b","d"] → [a,c,b,d,e] (멤버 b,d를 d 자리로 모음, b→d 순서 보존).
 */
export function groupItems<T extends LayerItemLike>(items: T[], ids: string[], groupId: string): T[] {
  const idSet = new Set(ids);
  const memberIndices: number[] = [];
  const affectedSourceGroups = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!idSet.has(item.id)) continue;
    memberIndices.push(index);
    if (item.groupId !== undefined) affectedSourceGroups.add(item.groupId);
  }
  if (memberIndices.length === 0) return items.slice();

  // 이미 손상된 소스/대상 그룹을 임의 복구하거나 더 쪼개지 않는다.
  for (const sourceGroupId of affectedSourceGroups) {
    if (!groupRun(items, sourceGroupId).contiguous) return items;
  }
  const targetRun = groupRun(items, groupId);
  if (!targetRun.contiguous) return items;

  // 기존 대상 그룹은 그 z-position을 보존한다. 다른 그룹에서 온 요청 항목만 원래 상대순서로
  // 뽑아 대상 블록의 FRONT 끝에 붙이면 소스 그룹도 제거된 자리를 닫아 연속성을 유지한다.
  if (targetRun.count > 0) {
    const moving = items.filter((item) => idSet.has(item.id) && item.groupId !== groupId);
    if (moving.length === 0) return items.slice();
    const movingIds = new Set(moving.map((item) => item.id));
    const rest = items.filter((item) => !movingIds.has(item.id));
    const targetEnd = groupRun(rest, groupId).last;
    if (targetEnd < 0) return items;
    return [
      ...rest.slice(0, targetEnd + 1),
      ...moving.map((item) => withGroupId(item, groupId)),
      ...rest.slice(targetEnd + 1),
    ];
  }

  // 새/빈 대상 그룹은 FRONTMOST 선택이 속했던 원래 블록의 FRONT 경계에 만든다. 선택을
  // 여러 기존 그룹에서 뽑더라도 각 소스 블록의 남은 멤버를 먼저 출력하므로 어느 그룹도 갈라지지 않는다.
  const anchorIndex = memberIndices[memberIndices.length - 1]!;
  const memberBlock = memberIndices.map((index) => withGroupId(items[index]!, groupId));
  const blocks: Array<{ indices: number[]; anchor: boolean }> = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    const indices = [index];
    if (item.groupId !== undefined) {
      let cursor = index + 1;
      while (cursor < items.length && items[cursor]!.groupId === item.groupId) {
        indices.push(cursor);
        cursor += 1;
      }
      index = cursor;
    } else {
      index += 1;
    }
    blocks.push({ indices, anchor: indices.includes(anchorIndex) });
  }

  const result: T[] = [];
  for (const block of blocks) {
    for (const index of block.indices) {
      if (!idSet.has(items[index]!.id)) result.push(items[index]!);
    }
    if (block.anchor) result.push(...memberBlock);
  }
  return result;
}

/**
 * groupId를 가진 모든 요소의 groupId 제거(요소·위치 유지). 새 배열 반환.
 * 바뀐 요소만 새 객체, 나머지는 동일 참조.
 */
export function ungroupItems<T extends LayerItemLike>(items: T[], groupId: string): T[] {
  return items.map((item) => (item.groupId === groupId ? withGroupId(item, undefined) : item));
}

/**
 * 단일 요소를 그룹으로 이동(groupId=undefined면 그룹에서 빼기). 대상 그룹의 기존 z-position과
 * 소스/대상 그룹 연속성을 모두 보존한다. 그룹 해제 항목은 남은 소스 그룹의 FRONT 경계로 이동한다.
 */
export function setItemGroup<T extends LayerItemLike>(items: T[], id: string, groupId: string | undefined): T[] {
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex === -1) return items.slice();
  const currentGroupId = items[fromIndex]!.groupId;
  if (currentGroupId === groupId) return items.slice();

  if (groupId !== undefined) return groupItems(items, [id], groupId);
  if (currentGroupId === undefined) return items.slice();

  const sourceRun = groupRun(items, currentGroupId);
  if (!sourceRun.contiguous) return items;
  const moved = withGroupId(items[fromIndex]!, undefined);
  const rest = items.filter((_, index) => index !== fromIndex);
  const remainingRun = groupRun(rest, currentGroupId);
  const insertIndex =
    remainingRun.count > 0
      ? remainingRun.last + 1
      : Math.min(fromIndex, rest.length);
  return [...rest.slice(0, insertIndex), moved, ...rest.slice(insertIndex)];
}

/**
 * 선택한 레이어만 각 소속 그룹에서 안전하게 꺼낸다. 같은 소스 그룹에서 여러 항목을 빼는 경우
 * FRONT→BACK 순서로 처리해 남은 그룹을 한 구간으로 유지하면서 선택 항목의 원래 상대순서도 보존한다.
 * 이미 비연속으로 손상된 소스 그룹은 추가 손상을 막기 위해 전체 작업을 거부한다.
 */
export function removeItemsFromGroups<T extends LayerItemLike>(items: T[], ids: readonly string[]): T[] {
  const requested = new Set(ids);
  if (requested.size === 0) return items;

  const affectedGroups = new Set<string>();
  const movingIds: string[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (!requested.has(item.id) || item.groupId === undefined) continue;
    affectedGroups.add(item.groupId);
    movingIds.push(item.id);
  }
  if (movingIds.length === 0) return items;
  for (const groupId of affectedGroups) {
    if (!groupRun(items, groupId).contiguous) return items;
  }

  let next = items;
  for (const id of movingIds) next = setItemGroup(next, id, undefined);
  return next;
}

/**
 * 한 레이어를 인접 z-order로 이동하되 그룹의 연속 블록 불변식을 깨뜨리지 않는다.
 * 같은 groupId(무그룹은 둘 다 undefined)인 이웃끼리만 교환하며, 그룹 경계를 넘는 이동은
 * 원본 참조를 그대로 반환한다. 그룹 밖/안 이동은 명시적인 setItemGroup 명령으로만 수행한다.
 */
export function moveLayerItem<T extends LayerItemLike>(
  items: T[],
  id: string,
  direction: "up" | "down"
): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const targetIndex = direction === "up" ? index + 1 : index - 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const item = items[index]!;
  const target = items[targetIndex]!;
  if (item.groupId !== target.groupId) return items;
  const next = items.slice();
  [next[index], next[targetIndex]] = [target, item];
  return next;
}

/**
 * 연속된 그룹 블록 전체를 바로 앞/뒤의 레이어 또는 다른 그룹 블록과 교환한다.
 * 손상된 비연속 그룹은 사용자의 z-order를 임의 복구하지 않고 원본을 그대로 반환한다.
 */
export function moveLayerGroup<T extends LayerItemLike>(
  items: T[],
  groupId: string,
  direction: "up" | "down"
): T[] {
  const memberIndices: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]!.groupId === groupId) memberIndices.push(index);
  }
  if (memberIndices.length === 0) return items;
  const start = memberIndices[0]!;
  const end = memberIndices[memberIndices.length - 1]!;
  if (end - start + 1 !== memberIndices.length) return items;
  const groupBlock = items.slice(start, end + 1);

  if (direction === "up") {
    if (end >= items.length - 1) return items;
    const neighborGroupId = items[end + 1]!.groupId;
    let neighborEnd = end + 1;
    if (neighborGroupId !== undefined) {
      if (!groupRun(items, neighborGroupId).contiguous) return items;
      while (neighborEnd + 1 < items.length && items[neighborEnd + 1]!.groupId === neighborGroupId) {
        neighborEnd += 1;
      }
    }
    const neighborBlock = items.slice(end + 1, neighborEnd + 1);
    return [...items.slice(0, start), ...neighborBlock, ...groupBlock, ...items.slice(neighborEnd + 1)];
  }

  if (start === 0) return items;
  const neighborGroupId = items[start - 1]!.groupId;
  let neighborStart = start - 1;
  if (neighborGroupId !== undefined) {
    if (!groupRun(items, neighborGroupId).contiguous) return items;
    while (neighborStart - 1 >= 0 && items[neighborStart - 1]!.groupId === neighborGroupId) {
      neighborStart -= 1;
    }
  }
  const neighborBlock = items.slice(neighborStart, start);
  return [...items.slice(0, neighborStart), ...groupBlock, ...neighborBlock, ...items.slice(end + 1)];
}

export type LayerItemReorderDirection = "front" | "back" | "forward" | "backward";

/**
 * 다중 선택을 한 개의 시각적 블록처럼 문서 맨 앞/뒤로 이동한다.
 *
 * PPT/Figma 계열 편집기처럼 그룹 자식 하나가 선택 집합에 들어오면 그 그룹 전체를
 * 이동 단위에 포함한다. 그래야 다중 선택의 z-order 명령이 기존 그룹의 연속 구간을
 * 찢지 않는다. 선택된 항목과 선택되지 않은 항목 안의 상대 순서는 모두 보존한다.
 */
export function reorderLayerSelection<T extends LayerItemLike>(
  items: T[],
  selectedIds: readonly string[],
  direction: LayerItemReorderDirection
): T[] {
  const requestedIds = new Set(selectedIds);
  if (requestedIds.size === 0) return items;

  const selectedGroupIds = new Set(
    items
      .filter((item) => requestedIds.has(item.id) && item.groupId !== undefined)
      .map((item) => item.groupId!)
  );
  const isSelectedUnit = (item: T) =>
    requestedIds.has(item.id) ||
    (item.groupId !== undefined && selectedGroupIds.has(item.groupId));
  const selected = items.filter(isSelectedUnit);
  if (selected.length === 0 || selected.length === items.length) return items;

  if (direction === "front" || direction === "back") {
    const unselected = items.filter((item) => !isSelectedUnit(item));
    const next = direction === "front"
      ? [...unselected, ...selected]
      : [...selected, ...unselected];
    return next.every((item, index) => item === items[index]) ? items : next;
  }

  // 한 단계 이동도 레이어 한 장씩 교환하지 않고 "시각적 단위"끼리 교환한다.
  // 연속 그룹은 한 unit이고 무그룹 레이어는 각각 한 unit이다. 여러 선택 단위가 흩어져
  // 있어도 PPT처럼 각각 한 칸만 이동하며 선택끼리의 상대 순서는 유지한다.
  const units: T[][] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.groupId === undefined) {
      units.push([item]);
      index += 1;
      continue;
    }
    const run = groupRun(items, item.groupId);
    if (!run.contiguous) return items;
    units.push(items.slice(run.first, run.last + 1));
    index = run.last + 1;
  }
  const unitSelected = (unit: readonly T[]) => unit.some(isSelectedUnit);
  let changed = false;
  if (direction === "forward") {
    for (let index = units.length - 2; index >= 0; index -= 1) {
      if (unitSelected(units[index]!) && !unitSelected(units[index + 1]!)) {
        [units[index], units[index + 1]] = [units[index + 1]!, units[index]!];
        changed = true;
      }
    }
  } else {
    for (let index = 1; index < units.length; index += 1) {
      if (unitSelected(units[index]!) && !unitSelected(units[index - 1]!)) {
        [units[index - 1], units[index]] = [units[index]!, units[index - 1]!];
        changed = true;
      }
    }
  }

  return changed ? units.flat() : items;
}

/**
 * 단일 레이어의 모든 순서 명령을 그룹 블록 불변식에 맞춰 처리한다.
 * - 그룹 자식: 자기 그룹 안에서만 이동(front/back은 그룹 내부 양 끝).
 * - 무그룹 레이어: 이웃 그룹을 넘을 때 그룹 전체 블록을 한 번에 건넌다.
 */
export function reorderLayerItem<T extends LayerItemLike>(
  items: T[],
  id: string,
  direction: LayerItemReorderDirection
): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const item = items[index]!;

  if (item.groupId !== undefined) {
    const run = groupRun(items, item.groupId);
    if (!run.contiguous) return items;
    if (direction === "forward") return moveLayerItem(items, id, "up");
    if (direction === "backward") return moveLayerItem(items, id, "down");
    const targetIndex = direction === "front" ? run.last : run.first;
    if (index === targetIndex) return items;
    const block = items.slice(run.first, run.last + 1);
    const blockIndex = index - run.first;
    const [moved] = block.splice(blockIndex, 1);
    if (!moved) return items;
    if (direction === "front") block.push(moved);
    else block.unshift(moved);
    return [...items.slice(0, run.first), ...block, ...items.slice(run.last + 1)];
  }

  if (direction === "front" || direction === "back") {
    const targetIndex = direction === "front" ? items.length - 1 : 0;
    if (index === targetIndex) return items;
    const rest = items.filter((_, candidateIndex) => candidateIndex !== index);
    return direction === "front" ? [...rest, item] : [item, ...rest];
  }

  const neighborIndex = direction === "forward" ? index + 1 : index - 1;
  if (neighborIndex < 0 || neighborIndex >= items.length) return items;
  const neighbor = items[neighborIndex]!;
  if (neighbor.groupId === undefined) {
    const next = items.slice();
    [next[index], next[neighborIndex]] = [neighbor, item];
    return next;
  }

  const neighborRun = groupRun(items, neighbor.groupId);
  if (!neighborRun.contiguous) return items;
  if (direction === "forward") {
    return [
      ...items.slice(0, index),
      ...items.slice(index + 1, neighborRun.last + 1),
      item,
      ...items.slice(neighborRun.last + 1),
    ];
  }
  return [
    ...items.slice(0, neighborRun.first),
    item,
    ...items.slice(neighborRun.first, index),
    ...items.slice(index + 1),
  ];
}

/** 생성된 복제본을 각 원본 바로 FRONT 쪽에 삽입해 기존 그룹 구간을 갈라놓지 않는다. */
export function insertLayerCopiesAdjacent<T extends LayerItemLike>(
  items: T[],
  copyBySourceId: ReadonlyMap<string, T>
): T[] {
  if (copyBySourceId.size === 0) return items;
  let changed = false;
  const result: T[] = [];
  for (const item of items) {
    result.push(item);
    const copy = copyBySourceId.get(item.id);
    if (!copy) continue;
    result.push(copy);
    changed = true;
  }
  return changed ? result : items;
}

/** 명시적으로 요청된 ID를 잠금 플래그와 무관하게 제거하고 실제 제거 ID를 함께 반환한다. */
export function removeLayerItems<T extends LayerItemLike>(
  items: T[],
  ids: readonly string[]
): { items: T[]; removedIds: string[] } {
  const requested = new Set(ids);
  if (requested.size === 0) return { items, removedIds: [] };
  const removedIds: string[] = [];
  const next = items.filter((item) => {
    if (!requested.has(item.id)) return true;
    removedIds.push(item.id);
    return false;
  });
  return removedIds.length > 0 ? { items: next, removedIds } : { items, removedIds };
}

// ---------------------------------------------------------------------------
// 표시용 트리 — 패널 표시순서에서 그룹 블록을 묶는다
// ---------------------------------------------------------------------------

export type LayerTreeNode<T> = { kind: "group"; group: LayerGroup; items: T[] } | { kind: "item"; item: T };

/**
 * 표시용 트리 — itemsInDisplayOrder(이미 패널 표시순서; 보통 z-order의 역순)를 받아
 * 같은 groupId 연속 요소를 group 노드로, groupId 없는 요소를 item 노드로 묶는다.
 * groupItems가 z-order 연속성을 보장하므로 역순 표시에서도 멤버는 연속이다.
 * 알 수 없는 groupId(groups에 없음)는 item 노드로 취급. 그룹 노드의 items는 받은 표시순서 그대로.
 */
export function buildLayerTree<T extends LayerItemLike>(
  itemsInDisplayOrder: T[],
  groups: LayerGroup[]
): LayerTreeNode<T>[] {
  const nodes: LayerTreeNode<T>[] = [];
  // 진행 중인 그룹 노드(연속 멤버를 모으는 중). 끊기면 flush 후 새로 시작.
  let current: { kind: "group"; group: LayerGroup; items: T[] } | null = null;

  for (const item of itemsInDisplayOrder) {
    const group = groupOfItem(item, groups);
    if (group) {
      if (current && current.group.id === group.id) {
        // 같은 그룹이 이어짐 — 현재 그룹 노드에 추가.
        current.items.push(item);
      } else {
        // 다른 그룹 시작 — 진행 중 그룹을 닫고 새 그룹 노드 시작.
        if (current) nodes.push(current);
        current = { kind: "group", group, items: [item] };
      }
    } else {
      // 그룹 없음/알 수 없는 그룹 — 진행 중 그룹을 닫고 item 노드로.
      if (current) {
        nodes.push(current);
        current = null;
      }
      nodes.push({ kind: "item", item });
    }
  }
  if (current) nodes.push(current);
  return nodes;
}

// ---------------------------------------------------------------------------
// 정리/클리핑 유틸
// ---------------------------------------------------------------------------

/** 멤버가 0개인 그룹 id 목록(정리용). */
export function emptyGroupIds(items: LayerItemLike[], groups: LayerGroup[]): string[] {
  const used = new Set<string>();
  for (const item of items) {
    if (item.groupId !== undefined) used.add(item.groupId);
  }
  return groups.filter((group) => !used.has(group.id)).map((group) => group.id);
}

/**
 * 클리핑 마스크 — z-order id 배열에서 id 바로 아래(이전 인덱스) 요소의 id. 없으면 null.
 * (인덱스 0=BACK이므로 "아래"는 인덱스가 하나 작은 쪽. 맨 아래/없는 id면 null.)
 */
export function itemBelowId(orderedIds: string[], id: string): string | null {
  const index = orderedIds.indexOf(id);
  if (index <= 0) return null;
  return orderedIds[index - 1] ?? null;
}
