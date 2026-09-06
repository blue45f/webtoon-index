import { uid } from "../studio-id";
import { isEffectivelyLocked } from "../studio-layers";

import { studioHokusaiSourceRevision } from "./studio-hokusai-natural-media-contract";

import type { El } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";
import type { StudioHokusaiNaturalMediaProductResult } from "./studio-hokusai-natural-media-product";

/**
 * Hokusai 자연매체 변환의 순수 코어 — "이 결과를 지금 문서에 반영해도 되는가"를
 * 판정하고, 반영한다면 다음 요소 배열을 만든다.
 *
 * StudioPage 쪽에는 **스코프 가드**(페이지/마스터 모드 일치, 협업 잠금, 리뷰 잠금)와
 * **커밋 부수효과**(commit·setSelectedId·announceDrawingShortcut)만 남는다. 그쪽
 * 가드들은 렌더 시점 ref/상태를 읽으므로 여기로 옮기면 의미가 달라진다.
 *
 * 낙관적 동시성: `studioHokusaiSourceRevision(source) !== result.sourceRevision`
 * 이면 워커가 돌던 사이 원본 벡터가 바뀐 것이므로 반영하지 않는다.
 */
export interface StudioHokusaiNaturalMediaReplacementPlan {
  /** 변환 결과 래스터의 새 요소 id. 호출부가 선택 상태로 만든다. */
  readonly rasterId: string;
  /** 원본 벡터를 숨김 보존하고 그 바로 위에 래스터를 끼운 다음 배열. */
  readonly nextElements: El[];
}

export function planStudioHokusaiNaturalMediaReplacement(
  elements: readonly El[],
  groups: LayerGroup[],
  result: StudioHokusaiNaturalMediaProductResult,
): StudioHokusaiNaturalMediaReplacementPlan | null {
  const sourceIndex = elements.findIndex(
    ({ id }) => id === result.sourceElementId,
  );
  const source = sourceIndex >= 0 ? elements[sourceIndex] : null;
  if (
    !source
    || source.type !== "draw"
    || isEffectivelyLocked(source, groups)
    || studioHokusaiSourceRevision(source) !== result.sourceRevision
    || !result.src.startsWith("data:image/png;base64,")
    || !Number.isFinite(result.logicalBounds.x)
    || !Number.isFinite(result.logicalBounds.y)
    || !Number.isFinite(result.logicalBounds.width)
    || !Number.isFinite(result.logicalBounds.height)
    || result.logicalBounds.width <= 0
    || result.logicalBounds.height <= 0
  ) {
    return null;
  }
  const rasterId = uid();
  const hiddenSource: El = {
    ...source,
    hidden: true,
    name: `${source.name ?? source.brush ?? "선화"} · Hokusai 원본 벡터`,
  };
  const raster: El = {
    id: rasterId,
    type: "image",
    src: result.src,
    x: result.logicalBounds.x,
    y: result.logicalBounds.y,
    width: result.logicalBounds.width,
    height: result.logicalBounds.height,
    rotation: 0,
    name: result.name,
    lockAspect: true,
    ...(source.groupId ? { groupId: source.groupId } : {}),
    ...(source.noClip !== undefined ? { noClip: source.noClip } : {}),
    ...(source.blendMode ? { blendMode: source.blendMode } : {}),
    ...(source.clipBelow !== undefined
      ? { clipBelow: source.clipBelow }
      : {}),
    ...(source.alphaLocked !== undefined
      ? { alphaLocked: source.alphaLocked }
      : {}),
    ...(source.layerRole ? { layerRole: source.layerRole } : {}),
    ...(source.layerColor ? { layerColor: source.layerColor } : {}),
  };
  const nextElements = elements.map((element, index) =>
    index === sourceIndex ? hiddenSource : element);
  nextElements.splice(sourceIndex + 1, 0, raster);
  return { rasterId, nextElements };
}
