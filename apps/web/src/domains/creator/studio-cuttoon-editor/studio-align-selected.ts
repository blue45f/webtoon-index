// 선택 정렬/분배 — StudioPage 에서 추출. 팩토리가 아니라 순수 함수로, 호출 시점의
// 렌더 값·헬퍼를 deps 로 주입해 추출 전과 동일한 클로저 의미를 유지한다.
import { CANVAS_W } from "../studio-assets";
import { containingPanel, elBounds } from "../studio-element-geometry";
import { planAtomicSelectionTranslation } from "../studio-group-selection";
import { isEffectivelyLocked } from "../studio-layers";
import { computeAlignDeltas, computeDistributeDeltas, unionBounds } from "../studio-selection";

import type { El, FrameEl } from "../studio-element-model";

export type StudioAlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distributeH"
  | "distributeV";

export interface StudioAlignSelectedDeps {
  elements: El[];
  marqueeIds: string[];
  selected: El | null | undefined;
  groups: Parameters<typeof isEffectivelyLocked>[1];
  activeGroupIdRef: { current: string | null };
  canvasH: number;
  completeSelectedGroupId: () => string | null;
  commit: (next: El[]) => unknown;
  patchEl: (id: string, patch: Partial<El>) => unknown;
  setError: (message: string) => void;
}

export function alignStudioSelection(mode: StudioAlignMode, deps: StudioAlignSelectedDeps): void {
  const {
    elements,
    marqueeIds,
    selected,
    groups,
    activeGroupIdRef,
    canvasH,
    completeSelectedGroupId,
    commit,
    patchEl,
    setError,
  } = deps;
  const completeGroupId = completeSelectedGroupId();
  if (completeGroupId && marqueeIds.length > 1) {
    const selectedIds = new Set(marqueeIds);
    const selectedEls = elements.filter((element) => selectedIds.has(element.id));
    if (
      selectedEls.length !== selectedIds.size ||
      selectedEls.some((element) => isEffectivelyLocked(element, groups))
    ) {
      setError("그룹 전체를 정렬하려면 모든 멤버의 잠금을 먼저 해제하세요.");
      return;
    }
    if (mode === "distributeH" || mode === "distributeV") {
      setError("그룹 내부 분배는 더블클릭으로 그룹에 들어간 뒤 자식들을 선택해 사용하세요.");
      return;
    }
    const box = unionBounds(selectedEls.map((element) => elBounds(element)));
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    const frame = elements.find(
      (element): element is FrameEl =>
        element.type === "frame" &&
        !selectedIds.has(element.id) &&
        !element.hidden &&
        centerX >= element.x &&
        centerX <= element.x + element.width &&
        centerY >= element.y &&
        centerY <= element.y + element.height
    );
    const originX = frame?.x ?? 0;
    const originY = frame?.y ?? 0;
    const areaWidth = frame?.width ?? CANVAS_W;
    const areaHeight = frame?.height ?? canvasH;
    let deltaX = 0;
    let deltaY = 0;
    if (mode === "left") deltaX = originX - box.x;
    else if (mode === "right") deltaX = originX + areaWidth - box.w - box.x;
    else if (mode === "hcenter") deltaX = originX + (areaWidth - box.w) / 2 - box.x;
    else if (mode === "top") deltaY = originY - box.y;
    else if (mode === "bottom") deltaY = originY + areaHeight - box.h - box.y;
    else if (mode === "vcenter") deltaY = originY + (areaHeight - box.h) / 2 - box.y;
    if (deltaX === 0 && deltaY === 0) return;
    const next = planAtomicSelectionTranslation({
      items: elements,
      selectedIds: marqueeIds,
      deltaX,
      deltaY,
      isLocked: (element) => isEffectivelyLocked(element, groups),
    });
    if (next.some((element, index) => element !== elements[index])) commit(next);
    return;
  }
  if (marqueeIds.length > 1) {
    const selectedEls = elements.filter((el) => marqueeIds.includes(el.id));
    if (selectedEls.length === 0) return;
    if (selectedEls.some((element) => isEffectivelyLocked(element, groups))) {
      setError("잠긴 멤버가 포함된 선택은 일부만 정렬하지 않아요. 잠금을 먼저 해제하세요.");
      return;
    }
    const topLevelGroupIds = new Set(
      selectedEls
        .map((element) => element.groupId)
        .filter(
          (groupId): groupId is string =>
            Boolean(groupId) && groupId !== activeGroupIdRef.current
        )
    );
    if (topLevelGroupIds.size > 0) {
      // 여러 최상위 그룹(또는 그룹+일반 객체)을 자식 배열로 정렬/분배하면 각 그룹
      // 내부 간격이 파괴된다. aggregate group-unit planner가 도입되기 전까지는
      // 일부만 움직이는 것보다 명확히 차단하는 편이 데이터 보존에 안전하다.
      setError(
        "여러 그룹이 포함된 선택은 그룹 내부 배치를 보호하기 위해 정렬·분배하지 않아요. 그룹별로 선택해 정렬해 주세요."
      );
      return;
    }

    const boundsList = selectedEls.map((el) => ({ el, b: elBounds(el) }));
    const bounds = boundsList.map(({ b }) => b);
    const deltas = mode === "distributeH" || mode === "distributeV"
      ? computeDistributeDeltas(bounds, mode)
      : computeAlignDeltas(bounds, mode, unionBounds(bounds));
    if (!deltas) return;
    const deltaById = new Map(selectedEls.map((el, index) => [el.id, deltas[index]!]));
    const next = elements.map((el) => {
      if (!marqueeIds.includes(el.id)) return el;
      const delta = deltaById.get(el.id);
      if (!delta || (delta.dx === 0 && delta.dy === 0)) return el;
      return el.type === "draw"
        ? ({
            ...el,
            points: el.points.map((v, i) => v + (i % 2 === 0 ? delta.dx : delta.dy)),
          } as El)
        : ({ ...el, x: (el as { x: number }).x + delta.dx, y: (el as { y: number }).y + delta.dy } as El);
    });
    commit(next);
    return;
  }

  if (!selected || isEffectivelyLocked(selected, groups)) return;
  if (mode === "distributeH" || mode === "distributeV") return;
  const b = elBounds(selected);
  const frame = containingPanel(selected, elements);
  const ox = frame ? frame.x : 0;
  const ow = frame ? frame.width : CANVAS_W;
  const oy = frame ? frame.y : 0;
  const oh = frame ? frame.height : canvasH;
  let dx = 0;
  let dy = 0;
  if (mode === "left") dx = ox - b.x;
  else if (mode === "right") dx = ox + ow - b.w - b.x;
  else if (mode === "hcenter") dx = ox + (ow - b.w) / 2 - b.x;
  else if (mode === "top") dy = oy - b.y;
  else if (mode === "bottom") dy = oy + oh - b.h - b.y;
  else if (mode === "vcenter") dy = oy + (oh - b.h) / 2 - b.y;
  if (dx === 0 && dy === 0) return;
  if (selected.type === "draw") {
    patchEl(selected.id, { points: selected.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) } as Partial<El>);
  } else {
    patchEl(selected.id, { x: b.x + dx, y: b.y + dy } as Partial<El>);
  }
}
