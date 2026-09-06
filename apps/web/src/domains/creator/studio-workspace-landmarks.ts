export const STUDIO_WORKSPACE_LANDMARKS = [
  { id: "studio-menubar", label: "문서 메뉴" },
  { id: "studio-tool-belt", label: "도구 옵션" },
  { id: "studio-tool-rail", label: "그리기 도구" },
  { id: "studio-canvas-workspace", label: "캔버스" },
  { id: "studio-inspector", label: "작업 패널" },
  { id: "studio-status-bar", label: "캔버스 상태" },
] as const;

export type StudioWorkspaceLandmarkId =
  (typeof STUDIO_WORKSPACE_LANDMARKS)[number]["id"];

export type StudioWorkspaceLandmarkDirection = 1 | -1;

const LANDMARK_LABELS = new Map<StudioWorkspaceLandmarkId, string>(
  STUDIO_WORKSPACE_LANDMARKS.map((landmark) => [landmark.id, landmark.label]),
);

export function studioWorkspaceLandmarkLabel(
  id: StudioWorkspaceLandmarkId,
): string {
  return LANDMARK_LABELS.get(id) ?? id;
}

/**
 * F6 순환의 순수 모델. 현재 포커스가 Studio 작업영역 밖이면 정방향은 첫 영역,
 * 역방향은 마지막 영역에서 시작한다. 숨겨진 영역은 호출자가 availableIds에서 제외한다.
 */
export function cycleStudioWorkspaceLandmark(
  availableIds: readonly StudioWorkspaceLandmarkId[],
  currentId: StudioWorkspaceLandmarkId | null,
  direction: StudioWorkspaceLandmarkDirection,
): StudioWorkspaceLandmarkId | null {
  if (availableIds.length === 0) return null;
  const currentIndex = currentId === null ? -1 : availableIds.indexOf(currentId);
  if (currentIndex < 0) {
    return direction === 1
      ? availableIds[0] ?? null
      : availableIds[availableIds.length - 1] ?? null;
  }
  const nextIndex =
    (currentIndex + direction + availableIds.length) % availableIds.length;
  return availableIds[nextIndex] ?? null;
}
