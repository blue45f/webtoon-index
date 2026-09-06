/**
 * Studio 그룹 선택 엔진 — 캔버스 클릭을 "그룹 = 하나의 단위"로 확장하는 순수·결정적 로직.
 *
 * 배경: 요소의 그룹 소속은 평탄 모델(`El.groupId: string`)이고, 그룹 메타는 `LayerGroup`이다.
 * StudioPage 캔버스는 단일 선택을 `selectedId`, 다중 선택을 `marqueeIds: string[]`로 표현하며
 * 두 상태는 상호 배타다(selectedId가 생기면 marqueeIds는 비워진다). 트랜스포머·그룹 드래그·정렬은
 * 모두 marqueeIds(≥2)를 하나의 변형 단위로 다룬다.
 *
 * PPT/Figma/Illustrator/Canva 공통 동작을 이 모듈이 순수 함수로 계산한다:
 *  - 그룹에 속한 요소를 (그룹 밖에서) 클릭 → 그 그룹의 모든 멤버를 한 단위로 선택.
 *  - 더블클릭 → 그룹 "진입"(activeGroupId). 진입 중엔 개별 자식만 선택.
 *  - Escape → 한 단계 위로(진입 해제 + 그룹 전체 재선택).
 *  - Shift 클릭 → 그룹 단위로 토글(가산/제거).
 *
 * 전부 Konva/DOM/React 의존이 없어 헤드리스 단위 테스트가 캔버스와 같은 로직을 검증한다.
 * 반환값은 항상 새 객체이며 입력을 변형하지 않는다. 선택 id 정규화는 레이어 내비게이터의
 * `selectLayersFromNavigator`(0/1/2+ → 없음/단일/마퀴) 규약과 바이트 동일하게 맞춘다.
 */

// 엔진이 보는 요소의 최소 형태(z-order 배열의 한 항목).
export interface GroupSelectionItemLike {
  readonly id: string;
  readonly groupId?: string;
}

// 엔진이 보는 그룹 메타의 최소 형태(존재 여부 판정용).
export interface GroupSelectionGroupLike {
  readonly id: string;
}

/**
 * 그룹 드래그가 옮길 수 있는 요소의 최소 형태.
 *
 * 좌표형 요소(image/frame/text/bubble 등)는 x/y를, 선화(draw)는 문서 좌표 points를 가진다.
 * 이 모듈은 Studio의 구체 El 유니언을 모르고도 두 저장 형태를 같은 원자적 이동 계획으로 묶는다.
 */
export interface GroupTranslationItemLike {
  readonly id: string;
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly points?: readonly number[];
}

// 캔버스 선택의 권위 상태 3종. selectedId/marqueeIds는 상호 배타(둘 중 하나만 비어 있지 않음).
export interface GroupSelectionState {
  readonly selectedId: string | null;
  readonly marqueeIds: string[];
  readonly activeGroupId: string | null;
}

// 아무것도 선택되지 않은/그룹 진입 해제 상태.
export const EMPTY_GROUP_SELECTION: GroupSelectionState = {
  selectedId: null,
  marqueeIds: [],
  activeGroupId: null,
};

/**
 * id 집합을 캔버스 선택 표현으로 정규화한다(레이어 내비게이터 규약과 동일).
 *  0개 → 선택 없음 · 1개 → 단일(selectedId) · 2개 이상 → 다중(marqueeIds).
 */
export function selectionShapeForIds(
  ids: readonly string[]
): { selectedId: string | null; marqueeIds: string[] } {
  if (ids.length === 0) return { selectedId: null, marqueeIds: [] };
  if (ids.length === 1) return { selectedId: ids[0]!, marqueeIds: [] };
  return { selectedId: null, marqueeIds: [...ids] };
}

/** 현재 선택된 id들(다중이면 marqueeIds, 단일이면 selectedId 하나, 없으면 빈 배열). */
export function currentSelectionIds(state: {
  readonly selectedId: string | null;
  readonly marqueeIds: readonly string[];
}): string[] {
  if (state.marqueeIds.length > 0) return [...state.marqueeIds];
  return state.selectedId ? [state.selectedId] : [];
}

/** 주어진 groupId의 모든 멤버 id를 z-order 순서대로 반환. */
export function groupMemberIds(
  items: readonly GroupSelectionItemLike[],
  groupId: string
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.groupId === groupId) out.push(item.id);
  }
  return out;
}

/**
 * 마퀴·우클릭처럼 여러 hit id가 한 번에 들어오는 선택을 최상위 그룹 단위로 확장한다.
 *
 * 그룹 밖에서는 자식 하나만 닿아도 해당 그룹 전체를 선택하고, 그룹 내부 편집 중에는 그 그룹의
 * 자식만 개별 선택으로 유지한다. 반환 순서는 언제나 문서 z-order이며 중복·유령 id는 제거한다.
 */
export function expandSelectionIdsToGroupUnits(
  items: readonly GroupSelectionItemLike[],
  groups: readonly GroupSelectionGroupLike[],
  hitIds: readonly string[],
  activeGroupId: string | null
): string[] {
  const hitSet = new Set(hitIds);
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const expanded = new Set<string>();

  for (const item of items) {
    if (!hitSet.has(item.id)) continue;
    const groupId = effectiveGroupId(item, knownGroupIds);
    if (groupId && groupId !== activeGroupId) {
      for (const memberId of groupMemberIds(items, groupId)) expanded.add(memberId);
    } else {
      expanded.add(item.id);
    }
  }

  return orderIdsByItems(items, expanded);
}

// id 집합을 items의 z-order로 정렬(결정적 marqueeIds 유지용).
function orderIdsByItems(
  items: readonly GroupSelectionItemLike[],
  idSet: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (idSet.has(item.id)) out.push(item.id);
  }
  return out;
}

// 요소의 유효 groupId — 메타에 실제로 존재하는 그룹만 인정(삭제된 그룹의 유령 참조는 무그룹 취급).
function effectiveGroupId(
  item: GroupSelectionItemLike | undefined,
  knownGroupIds: ReadonlySet<string>
): string | undefined {
  const groupId = item?.groupId;
  return groupId !== undefined && knownGroupIds.has(groupId) ? groupId : undefined;
}

/**
 * 클릭 한 번이 선택할 "단위"를 해석한다.
 *  - 그룹 진입 중(activeGroupId)이고 그 그룹의 자식을 클릭 → 개별 자식(진입 유지).
 *  - (진입 밖에서) 그룹 소속 요소 클릭 → 그룹 전체(진입 해제).
 *  - 무그룹 요소 클릭 → 그 요소 하나(진입 해제).
 * 존재하지 않는 요소를 클릭하면 그 id 하나를 단위로, 진입은 해제한다.
 */
export function resolveClickUnit(
  items: readonly GroupSelectionItemLike[],
  knownGroupIds: ReadonlySet<string>,
  clickedId: string,
  activeGroupId: string | null
): { unit: string[]; nextActiveGroupId: string | null } {
  const clicked = items.find((item) => item.id === clickedId);
  const groupId = effectiveGroupId(clicked, knownGroupIds);
  // 그룹 내부 편집 중 + 그 그룹의 자식 → 개별 선택(진입 유지).
  if (activeGroupId !== null && groupId === activeGroupId) {
    return { unit: [clickedId], nextActiveGroupId: activeGroupId };
  }
  // 그룹 소속 요소를 바깥에서 클릭 → 그룹 전체(진입 해제).
  if (groupId !== undefined) {
    return { unit: groupMemberIds(items, groupId), nextActiveGroupId: null };
  }
  // 무그룹(또는 유령 그룹) → 단일(진입 해제).
  return { unit: [clickedId], nextActiveGroupId: null };
}

export interface GroupClickSelectionInput {
  readonly items: readonly GroupSelectionItemLike[];
  readonly groups: readonly GroupSelectionGroupLike[];
  readonly clickedId: string;
  readonly current: GroupSelectionState;
  /** Shift 클릭 — 단위 전체를 현재 선택에 토글(가산/제거). */
  readonly additive?: boolean;
}

/**
 * "이미 선택된 멤버를 Shift 없이 눌렀다" — 누름(press) 단계에서 다중 선택을 유지해야 하는가.
 *
 * Figma·PowerPoint·클립스튜디오·일러스트레이터가 공유하는 규약이다. 여러 개를 골라 둔 상태에서
 * 그중 하나를 눌러 끌면 선택 전체가 함께 움직여야 한다. 누름 즉시 하나로 좁히면 그 드래그는
 * 클릭한 하나만 옮기고 정렬해 둔 컷이 찢어진다(측정된 결함 D4).
 *
 * 좁히기는 버리는 게 아니라 미루는 것이다 — `planGroupClickSelectionRelease` 가 "드래그 없이 뗀"
 * 순간에만 같은 판정을 재사용해 클릭한 단위로 좁힌다.
 *
 * `unit.length >= currentIds.length` 는 유지할 이유가 없다. 그 경우 단위가 곧 현재 선택이므로
 * 유지하든 대체하든 결과가 같고, 좁힐 여지도 없다.
 */
function preservesMultiSelectionOnPress(
  current: GroupSelectionState,
  unit: readonly string[],
  additive: boolean | undefined
): boolean {
  if (additive === true) return false;
  if (unit.length === 0) return false;
  const currentIds = currentSelectionIds(current);
  if (currentIds.length < 2) return false;
  if (unit.length >= currentIds.length) return false;
  const currentSet = new Set(currentIds);
  return unit.every((id) => currentSet.has(id));
}

/**
 * 캔버스 단일/Shift 클릭의 다음 선택 상태를 계산한다.
 *  - 일반 클릭: 단위(그룹 전체 또는 개별)로 통째로 대체.
 *  - 단, 단위가 이미 현재 다중 선택 안에 통째로 들어 있으면 그 다중 선택을 유지한다(위 참고).
 *  - Shift 클릭: 단위가 전부 이미 선택돼 있으면 단위 전체 제거, 아니면 단위 전체 추가(z-order 유지).
 * 가산 선택은 최상위 레벨 작업이므로 진입 상태를 해제한다(단, 활성 그룹 내부 자식 토글이면 유지).
 */
export function planGroupClickSelection(input: GroupClickSelectionInput): GroupSelectionState {
  const knownGroupIds = new Set(input.groups.map((group) => group.id));
  const { unit, nextActiveGroupId } = resolveClickUnit(
    input.items,
    knownGroupIds,
    input.clickedId,
    input.current.activeGroupId
  );

  if (!input.additive) {
    if (preservesMultiSelectionOnPress(input.current, unit, input.additive)) {
      return {
        selectedId: input.current.selectedId,
        marqueeIds: [...input.current.marqueeIds],
        activeGroupId: nextActiveGroupId,
      };
    }
    const shape = selectionShapeForIds(unit);
    return { ...shape, activeGroupId: nextActiveGroupId };
  }

  // 가산(Shift) — 단위를 하나의 덩어리로 토글.
  const currentIds = currentSelectionIds(input.current);
  const currentSet = new Set(currentIds);
  const unitSet = new Set(unit);
  const allSelected = unit.length > 0 && unit.every((id) => currentSet.has(id));

  const nextSet = new Set(currentIds);
  if (allSelected) {
    for (const id of unitSet) nextSet.delete(id);
  } else {
    for (const id of unit) nextSet.add(id);
  }
  const nextIds = orderIdsByItems(input.items, nextSet);
  const shape = selectionShapeForIds(nextIds);

  // 활성 그룹 내부 자식을 가산 토글하는 경우만 진입 유지, 그 외 가산은 최상위이므로 해제.
  const stayInside =
    input.current.activeGroupId !== null && nextActiveGroupId === input.current.activeGroupId;
  return { ...shape, activeGroupId: stayInside ? input.current.activeGroupId : null };
}

/**
 * "드래그 없이 뗐다"(pointerup/click)에서만 일어나는 좁히기를 계산한다.
 *
 * `planGroupClickSelection` 이 누름 단계에서 다중 선택을 유지한 그 경우에만 클릭한 단위로 좁히고,
 * 그 밖에는 `null`(할 일 없음)을 돌려준다. 누름과 같은 판정을 재사용하므로 두 단계는 갈라질 수 없다.
 *
 * 이 함수는 "드래그였는가"를 스스로 알지 못한다 — 호출부가 드래그 없는 뗌에서만 불러야 한다.
 * Konva 는 실제 드래그가 일어나면 `click`/`tap` 을 아예 발화하지 않으므로(DragAndDrop
 * `_endDragBefore` 가 `_mouseListenClick`/`_touchListenClick` 을 내린다) 그 이벤트가 곧 규약이다.
 */
export function planGroupClickSelectionRelease(
  input: GroupClickSelectionInput
): GroupSelectionState | null {
  const knownGroupIds = new Set(input.groups.map((group) => group.id));
  const { unit, nextActiveGroupId } = resolveClickUnit(
    input.items,
    knownGroupIds,
    input.clickedId,
    input.current.activeGroupId
  );
  if (!preservesMultiSelectionOnPress(input.current, unit, input.additive)) return null;
  return { ...selectionShapeForIds(unit), activeGroupId: nextActiveGroupId };
}

export interface GroupEnterInput {
  readonly items: readonly GroupSelectionItemLike[];
  readonly groups: readonly GroupSelectionGroupLike[];
  readonly clickedId: string;
}

/**
 * 더블클릭 = 그룹 진입. 그룹 소속 요소면 그 그룹으로 진입하고 클릭한 개별 자식을 선택한다.
 * 무그룹 요소면 진입 없이 그 요소만 단일 선택(일반 클릭과 동일).
 */
export function planGroupEnter(input: GroupEnterInput): GroupSelectionState {
  const knownGroupIds = new Set(input.groups.map((group) => group.id));
  const clicked = input.items.find((item) => item.id === input.clickedId);
  const groupId = effectiveGroupId(clicked, knownGroupIds);
  if (groupId === undefined) {
    return { selectedId: input.clickedId, marqueeIds: [], activeGroupId: null };
  }
  return { selectedId: input.clickedId, marqueeIds: [], activeGroupId: groupId };
}

export interface GroupEscapeInput {
  readonly items: readonly GroupSelectionItemLike[];
  readonly current: GroupSelectionState;
}

/**
 * Escape = 한 단계 위로. 그룹 진입 중이면 진입을 해제하고 그 그룹 전체를 다시 선택한다.
 * 진입 상태가 아니면 null을 반환해 호출부가 기존 Escape(선택 해제) 흐름을 타게 한다.
 */
export function planGroupEscape(input: GroupEscapeInput): GroupSelectionState | null {
  const activeGroupId = input.current.activeGroupId;
  if (activeGroupId === null) return null;
  const members = groupMemberIds(input.items, activeGroupId);
  const shape = selectionShapeForIds(members);
  return { ...shape, activeGroupId: null };
}

export interface AtomicSelectionTranslationInput<T extends GroupTranslationItemLike> {
  readonly items: readonly T[];
  readonly selectedIds: readonly string[];
  readonly deltaX: number;
  readonly deltaY: number;
  /** 요소 잠금과 상위 그룹 잠금을 모두 반영한 최종 잠금 판정. */
  readonly isLocked: (item: T) => boolean;
}

/**
 * 선택 단위의 드래그를 문서 스냅샷 한 장으로 계산한다.
 *
 * Konva 좌표형 노드는 드래그 중 화면에서 함께 움직이지만, 히스토리에는 이 함수의 결과만 한 번
 * 커밋한다. draw는 노드 x/y가 아니라 points 자체를 이동한다. 잠긴 자식·유실 멤버·지원하지 않는
 * 기하가 하나라도 있으면 전체를 fail-closed하며, 바뀌지 않은 요소 참조도 보존해 React/CRDT의
 * 불필요한 후속 작업을 막는다.
 */
export function planAtomicSelectionTranslation<T extends GroupTranslationItemLike>(
  input: AtomicSelectionTranslationInput<T>
): T[] {
  if (
    input.selectedIds.length === 0 ||
    !Number.isFinite(input.deltaX) ||
    !Number.isFinite(input.deltaY)
  ) {
    return [...input.items];
  }
  const deltaX = input.deltaX;
  const deltaY = input.deltaY;
  if (deltaX === 0 && deltaY === 0) return [...input.items];

  const selected = new Set(input.selectedIds);
  const selectedItems = input.items.filter((item) => selected.has(item.id));
  // 그룹은 한 객체처럼 움직인다. 멤버가 사라졌거나 잠겼거나 이동 가능한 문서 기하가 아니면
  // 일부만 옮겨 그룹을 찢지 않고 전체 제스처를 fail-closed 한다.
  if (
    selectedItems.length !== selected.size ||
    selectedItems.some(input.isLocked) ||
    selectedItems.some((item) => {
      if (item.type === "draw") {
        return (
          item.points === undefined ||
          item.points.length < 2 ||
          item.points.length % 2 !== 0 ||
          !item.points.every(Number.isFinite)
        );
      }
      return (
        typeof item.x !== "number" ||
        !Number.isFinite(item.x) ||
        typeof item.y !== "number" ||
        !Number.isFinite(item.y)
      );
    })
  ) {
    return [...input.items];
  }

  return input.items.map((item) => {
    if (!selected.has(item.id)) return item;

    if (item.type === "draw" && item.points) {
      return {
        ...item,
        points: item.points.map((value, index) =>
          value + (index % 2 === 0 ? deltaX : deltaY)
        ),
      } as T;
    }

    if (
      typeof item.x === "number" &&
      Number.isFinite(item.x) &&
      typeof item.y === "number" &&
      Number.isFinite(item.y)
    ) {
      return {
        ...item,
        x: item.x + deltaX,
        y: item.y + deltaY,
      } as T;
    }

    return item;
  });
}

export interface GroupSelectionAffineBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AtomicSelectionAffineTransformInput<T extends GroupTranslationItemLike> {
  readonly items: readonly T[];
  readonly selectedIds: readonly string[];
  /** 변형 전 혼합 선택 전체의 문서 좌표 합집합. 이 박스의 좌상단이 affine 기준점이다. */
  readonly sourceBounds: GroupSelectionAffineBounds;
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** 요소 잠금과 상위 그룹 잠금을 모두 반영한 최종 잠금 판정. */
  readonly isLocked: (item: T) => boolean;
}

export type AtomicSelectionAffineTransformNoopReason =
  | "empty-selection"
  | "missing-selection-member"
  | "locked-selection-member"
  | "invalid-transform"
  | "invalid-source-bounds"
  | "zero-size-source-bounds"
  | "unsupported-member-geometry"
  | "identity-transform";

export type AtomicSelectionAffineTransformResult<T extends GroupTranslationItemLike> =
  | {
      readonly kind: "applied";
      readonly items: T[];
      /** 입력 순서가 아니라 문서 items 순서로 정규화된 선택 ID. */
      readonly orderedSelectedIds: string[];
    }
  | {
      readonly kind: "no-op";
      readonly reason: AtomicSelectionAffineTransformNoopReason;
      readonly items: T[];
      /** 입력 순서가 아니라 문서 items 순서로 정규화된 선택 ID. */
      readonly orderedSelectedIds: string[];
    };

function noOpAffineTransform<T extends GroupTranslationItemLike>(
  input: AtomicSelectionAffineTransformInput<T>,
  reason: AtomicSelectionAffineTransformNoopReason,
  orderedSelectedIds: readonly string[]
): AtomicSelectionAffineTransformResult<T> {
  return {
    kind: "no-op",
    reason,
    items: [...input.items],
    orderedSelectedIds: [...orderedSelectedIds],
  };
}

function hasFiniteDrawGeometry(item: GroupTranslationItemLike): boolean {
  return (
    item.type === "draw" &&
    item.points !== undefined &&
    item.points.length >= 2 &&
    item.points.length % 2 === 0 &&
    item.points.every(Number.isFinite)
  );
}

function hasFiniteBoxGeometry(item: GroupTranslationItemLike): boolean {
  return (
    typeof item.x === "number" &&
    Number.isFinite(item.x) &&
    typeof item.y === "number" &&
    Number.isFinite(item.y) &&
    typeof item.width === "number" &&
    Number.isFinite(item.width) &&
    item.width >= 0 &&
    typeof item.height === "number" &&
    Number.isFinite(item.height) &&
    item.height >= 0
  );
}

/**
 * PPT/Figma식 혼합 선택의 이동+배율 변형을 한 문서 스냅샷으로 계산한다.
 *
 * draw는 모든 문서 좌표 points를 직접 변환하고, 좌표형 객체는 두 모서리를 변환한 뒤 양수
 * width/height의 정규 박스로 저장한다. 따라서 음수 배율도 선택 내 위치와 선화를 정확히 반전하며
 * 객체 박스는 후속 레이아웃·hit-test가 다룰 수 있는 canonical 형태를 유지한다.
 *
 * 혼합 그룹은 부분 적용하지 않는다. 선택 ID가 사라졌거나, 멤버가 잠겼거나, 지원하지 않는 기하가
 * 하나라도 있으면 전체가 no-op이다. 이 규약은 협업/undo에 반쯤 변형된 그룹이 노출되는 것을 막는다.
 */
export function planAtomicSelectionAffineTransform<T extends GroupTranslationItemLike>(
  input: AtomicSelectionAffineTransformInput<T>
): AtomicSelectionAffineTransformResult<T> {
  const requestedIds = new Set(input.selectedIds);
  const orderedSelectedItems = input.items.filter((item) => requestedIds.has(item.id));
  const orderedSelectedIds = orderedSelectedItems.map((item) => item.id);

  if (requestedIds.size === 0) {
    return noOpAffineTransform(input, "empty-selection", orderedSelectedIds);
  }
  if (orderedSelectedIds.length !== requestedIds.size) {
    return noOpAffineTransform(input, "missing-selection-member", orderedSelectedIds);
  }
  if (orderedSelectedItems.some(input.isLocked)) {
    return noOpAffineTransform(input, "locked-selection-member", orderedSelectedIds);
  }

  const { sourceBounds } = input;
  if (
    !Number.isFinite(sourceBounds.x) ||
    !Number.isFinite(sourceBounds.y) ||
    !Number.isFinite(sourceBounds.width) ||
    !Number.isFinite(sourceBounds.height) ||
    sourceBounds.width < 0 ||
    sourceBounds.height < 0
  ) {
    return noOpAffineTransform(input, "invalid-source-bounds", orderedSelectedIds);
  }
  if (
    !Number.isFinite(input.translateX) ||
    !Number.isFinite(input.translateY) ||
    !Number.isFinite(input.scaleX) ||
    !Number.isFinite(input.scaleY)
  ) {
    return noOpAffineTransform(input, "invalid-transform", orderedSelectedIds);
  }
  if (
    (sourceBounds.width === 0 && input.scaleX !== 1) ||
    (sourceBounds.height === 0 && input.scaleY !== 1)
  ) {
    return noOpAffineTransform(input, "zero-size-source-bounds", orderedSelectedIds);
  }
  if (
    orderedSelectedItems.some(
      (item) => !hasFiniteDrawGeometry(item) && !hasFiniteBoxGeometry(item)
    )
  ) {
    return noOpAffineTransform(input, "unsupported-member-geometry", orderedSelectedIds);
  }
  if (
    input.translateX === 0 &&
    input.translateY === 0 &&
    input.scaleX === 1 &&
    input.scaleY === 1
  ) {
    return noOpAffineTransform(input, "identity-transform", orderedSelectedIds);
  }

  const transformX = (value: number) =>
    sourceBounds.x + (value - sourceBounds.x) * input.scaleX + input.translateX;
  const transformY = (value: number) =>
    sourceBounds.y + (value - sourceBounds.y) * input.scaleY + input.translateY;

  const transformedItems = input.items.map((item) => {
    if (!requestedIds.has(item.id)) return item;
    if (hasFiniteDrawGeometry(item)) {
      return {
        ...item,
        points: item.points!.map((value, index) =>
          index % 2 === 0 ? transformX(value) : transformY(value)
        ),
      } as T;
    }

    const transformedLeft = transformX(item.x!);
    const transformedRight = transformX(item.x! + item.width!);
    const transformedTop = transformY(item.y!);
    const transformedBottom = transformY(item.y! + item.height!);
    return {
      ...item,
      x: Math.min(transformedLeft, transformedRight),
      y: Math.min(transformedTop, transformedBottom),
      width: Math.abs(transformedRight - transformedLeft),
      height: Math.abs(transformedBottom - transformedTop),
    } as T;
  });

  return {
    kind: "applied",
    items: transformedItems,
    orderedSelectedIds,
  };
}
