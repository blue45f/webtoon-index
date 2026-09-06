import { clamp, LAST_FRAME, type LabKind } from "./learning-model";

export type LabView = "both" | "reference" | "comparison";
export interface LabState { value: number; frame: number; view: LabView }
export const LAB_CONFIGS: Record<LabKind, { title: string; label: string; min: number; max: number; initial: number; unit: string; comparable: boolean; stages: readonly string[] }> = {
  pacing: { title: "컷 사이의 호흡", label: "오른쪽 컷 간격", min: 8, max: 64, initial: 28, unit: "도식 단위", comparable: true, stages: ["상황을 제시합니다.", "변화가 생깁니다. 여백의 연결감을 비교하세요.", "반응으로 마무리합니다. 여백은 고정된 읽기 시간이 아닙니다."] },
  perspective: { title: "1점 투시의 깊이", label: "아이레벨 높이", min: 60, max: 312, initial: 130, unit: "도식 y좌표", comparable: false, stages: ["앞면과 아이레벨을 구분합니다.", "깊이 방향의 모서리를 소실점에 연결합니다.", "눈높이를 바꾸며 어떤 면이 보이는지 관찰하세요."] },
  strokes: { title: "균일선과 강약선", label: "기준 선 굵기", min: 2, max: 18, initial: 8, unit: "도식 단위", comparable: true, stages: ["같은 경로를 균일한 두께로 봅니다.", "오른쪽은 구간별로 굵기가 달라집니다.", "강조할 부분이 다른지 비교하세요. 실제 브러시 엔진은 아닙니다."] },
  layers: { title: "범위와 진하기는 다릅니다", label: "음영 불투명도", min: 0, max: 100, initial: 55, unit: "%", comparable: true, stages: ["두 그림은 같은 밑색과 음영을 사용합니다.", "오른쪽만 원 영역으로 음영을 제한합니다.", "불투명도를 바꾸어도 클리핑 전의 범위는 잘리지 않습니다."] },
  lettering: { title: "말풍선의 여유 공간", label: "글자 크기", min: 14, max: 28, initial: 20, unit: "도식 단위", comparable: false, stages: ["위쪽 질문을 먼저 읽습니다.", "아래쪽 대답으로 시선이 이어집니다.", "크기뿐 아니라 테두리 안 여백도 확인하세요."] },
  values: { title: "작게 보아도 읽히는 형태", label: "도식의 대비 강도", min: 0, max: 100, initial: 65, unit: "%", comparable: true, stages: ["왼쪽은 밝기 차이가 작은 예시입니다.", "오른쪽의 형태와 배경 분리를 조절합니다.", "대비가 정답을 보장하지는 않습니다. 장면의 초점을 확인하세요."] },
};

function numberFromQuery(value: string | null, fallback: number, min: number, max: number): number {
  if (!value || value.length > 16 || !/^-?\d+(?:\.\d+)?$/u.test(value)) return fallback;
  return Math.round(clamp(Number(value), min, max));
}
export function readLabState(kind: LabKind, search: string, compact = false): LabState {
  const config = LAB_CONFIGS[kind];
  const params = new URLSearchParams(search);
  const rawView = params.get("labView");
  const defaultView = config.comparable && compact ? "comparison" : "both";
  const view = config.comparable && (rawView === "both" || rawView === "reference" || rawView === "comparison") ? rawView : defaultView;
  return {
    value: numberFromQuery(params.get("labValue"), config.initial, config.min, config.max),
    frame: numberFromQuery(params.get("labFrame"), 0, 0, LAST_FRAME),
    view,
  };
}
/** Only the public exercise state is shared. Notes, tokens and unrelated query parameters are omitted. */
export function buildLabLink(pathname: string, kind: LabKind, state: LabState): string {
  if (!/^\/learn\/lessons\/[a-z0-9-]+\/?$/u.test(pathname)) throw new Error("강좌 주소가 올바르지 않습니다.");
  const config = LAB_CONFIGS[kind];
  const params = new URLSearchParams({
    labValue: String(Math.round(clamp(state.value, config.min, config.max))),
    labFrame: String(Math.floor(clamp(state.frame, 0, LAST_FRAME))),
    labView: config.comparable && (state.view === "reference" || state.view === "comparison") ? state.view : "both",
  });
  return `${pathname.replace(/\/$/u, "")}?${params}`;
}
