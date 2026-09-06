import {
  STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS,
  type StudioBg3dProceduralInsertionFailureReason,
  type StudioBg3dProceduralStarterAsset,
  type StudioBg3dProceduralStarterCategory,
} from "./studio-bg3d-procedural-starter-pack";

export type StudioBg3dProceduralStarterCategoryFilter =
  | "all"
  | StudioBg3dProceduralStarterCategory;

export const STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_FILTERS = Object.freeze([
  { id: "all", label: "전체" },
  ...Object.entries(STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS).map(
    ([id, label]) => ({
      id: id as StudioBg3dProceduralStarterCategory,
      label,
    }),
  ),
] satisfies ReadonlyArray<{
  readonly id: StudioBg3dProceduralStarterCategoryFilter;
  readonly label: string;
}>);

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
}

export function filterStudioBg3dProceduralStarterAssets(
  assets: readonly StudioBg3dProceduralStarterAsset[],
  input: {
    readonly query: string;
    readonly category: StudioBg3dProceduralStarterCategoryFilter;
  },
): StudioBg3dProceduralStarterAsset[] {
  const query = normalizeSearchText(input.query);
  return assets.filter((asset) => {
    if (input.category !== "all" && asset.category !== input.category) return false;
    if (!query) return true;
    return [
      asset.label,
      asset.description,
      STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS[asset.category],
      ...asset.tags,
    ].some((value) => normalizeSearchText(value).includes(query));
  });
}

export function describeStudioBg3dProceduralInsertionFailure(
  reason: StudioBg3dProceduralInsertionFailureReason,
): string {
  switch (reason) {
    case "node-budget-exceeded":
      return "장면 노드 예산이 부족합니다. 사용하지 않는 도형·모델을 줄인 뒤 다시 추가해 주세요.";
    case "triangle-budget-exceeded":
      return "장면 삼각형 예산이 부족합니다. 고밀도 모델을 숨기는 대신 삭제하거나 더 가벼운 모델로 바꿔 주세요.";
    case "draw-call-budget-exceeded":
      return "장면 드로우콜 예산이 부족합니다. 재질과 파츠가 많은 모델을 정리한 뒤 다시 추가해 주세요.";
    case "material-budget-exceeded":
      return "장면 재질 예산이 부족합니다. 재질 슬롯이 많은 모델을 정리한 뒤 다시 추가해 주세요.";
    case "instance-id-exhausted":
      return "같은 에셋 인스턴스가 너무 많아 새 식별자를 만들지 못했습니다.";
    case "node-id-collision":
      return "장면 노드 식별자가 겹쳐 삽입을 중단했습니다. 장면을 다시 연 뒤 시도해 주세요.";
    case "invalid-budget":
      return "현재 장면의 안전 예산을 확인할 수 없습니다. 모델 분석 또는 장면 복원이 끝난 뒤 다시 시도해 주세요.";
    case "invalid-transform":
      return "삽입 위치가 안전 범위를 벗어나 추가하지 않았습니다.";
    case "invalid-instance-id":
      return "안전한 인스턴스 식별자를 만들지 못해 추가하지 않았습니다.";
    case "unknown-asset":
      return "이 스타터 에셋을 찾을 수 없습니다. 패널을 다시 열어 주세요.";
  }
}
