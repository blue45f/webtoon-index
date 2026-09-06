/**
 * Rich tool hover copy — short title + longer “what it does” body + optional shortcut.
 * Pure data for StudioToolHint / rail buttons. No brand clones.
 */

import type {
  StudioToolHintPreviewFields,
  StudioToolHintPreviewCanonicalVariant,
  StudioToolHintPreviewKind,
  StudioToolHintPreviewVariant,
} from "./studio-tool-hint-preview-kind";

type StudioToolHintCopy = {
  id: string;
  title: string;
  /** Longer description shown under the title (tooltip body). */
  description: string;
  shortcut?: string;
  /** One concise workflow hint shown below the visual. */
  tip?: string;
};

/** Preview kind and variant are one discriminated contract, so cross-family pairs fail typecheck. */
export type StudioToolHintSpec = StudioToolHintCopy & (
  | Readonly<{ preview?: undefined; previewVariant?: never }>
  | StudioToolHintPreviewFields
);

const HINTS: Record<string, StudioToolHintSpec> = {
  select: {
    id: "select",
    title: "선택",
    description: "캔버스 위 요소를 클릭·드래그로 고르고 옮기거나 크기를 바꿉니다. 여러 개를 드래그해 함께 선택할 수 있어요.",
    shortcut: "V",
    preview: "select",
    tip: "Shift를 누르면 기존 선택에 요소를 더할 수 있어요.",
  },
  pen: {
    id: "pen",
    title: "펜",
    description: "자유선으로 그립니다. 필압·보정·브러시 프리셋은 하단 옵션 도크와 브러시 스튜디오에서 조절해요.",
    shortcut: "B",
    preview: "ink",
    tip: "[ 와 ] 키로 그리는 흐름을 끊지 않고 크기를 바꿔보세요.",
  },
  eraser: {
    id: "eraser",
    title: "지우개",
    description: "현재 레이어/획 위를 지웁니다. 굵기는 펜과 같은 크기 칩으로 맞출 수 있어요.",
    shortcut: "E",
    preview: "erase",
    tip: "지우개도 필압과 불투명도를 유지해 부드럽게 다듬을 수 있어요.",
  },
  fill: {
    id: "fill",
    title: "색 채우기 (페인트 버킷)",
    description: "선으로 둘러싸인 곳을 클릭해 한 번에 색칠합니다. 어느 선까지 경계로 볼지는 오른쪽 속성에서 바꿀 수 있어요.",
    shortcut: "G",
    preview: "fill",
    tip: "선이 조금 끊겼다면 ‘틈 닫기’를 올리고, 여러 레이어의 선을 보려면 ‘참조’를 바꿔보세요.",
  },
  eyedropper: {
    id: "eyedropper",
    title: "색 가져오기 (스포이드)",
    description: "캔버스에서 원하는 색을 클릭해 현재 그리기 색으로 가져옵니다. 펜을 쓰는 중에는 Alt+클릭으로 잠깐 사용할 수 있어요.",
    shortcut: "I",
    preview: "sample",
    tip: "펜 사용 중에는 Alt를 잠깐 눌러 도구 전환 없이 색을 고를 수 있어요.",
  },
  "smart-shape": {
    id: "smart-shape",
    title: "스마트 도형",
    description: "낙서를 잠시 멈추면 선·원·사각형 등 깔끔한 도형으로 자동 다듬어요. AutoDraw 계열 보조 기능입니다.",
    preview: "smart-shape",
    tip: "획 끝에서 잠깐 멈추면 원래 손맛을 유지한 채 모양만 정리합니다.",
  },
  "shape-rect": {
    id: "shape-rect",
    title: "사각형 도형",
    description: "드래그로 사각형을 그립니다. Shift를 누르면 정사각형으로 맞출 수 있어요.",
    preview: "shape",
    previewVariant: "rect",
  },
  "shape-ellipse": {
    id: "shape-ellipse",
    title: "타원 도형",
    description: "드래그로 타원을 그립니다. Shift를 누르면 정원으로 맞출 수 있어요.",
    preview: "shape",
    previewVariant: "ellipse",
  },
  text: {
    id: "text",
    title: "텍스트",
    description: "캔버스에 글자 상자를 추가합니다. 폰트·정렬·효과는 우측 속성에서 편집해요.",
    preview: "text",
    tip: "대사를 먼저 붙여넣고 우측 속성에서 스타일을 한 번에 맞출 수 있어요.",
  },
  bubble: {
    id: "bubble",
    title: "말풍선",
    description: "만화 말풍선을 넣습니다. 꼬리 위치·스타일 프리셋은 말풍선 패널에서 바꿀 수 있어요.",
    preview: "bubble",
    previewVariant: "add",
    tip: "말풍선을 배치한 뒤 캔버스에서 꼬리 끝을 화자 쪽으로 끌어보세요.",
  },
  image: {
    id: "image",
    title: "이미지 추가",
    description: "파일에서 그림을 불러와 캔버스에 배치합니다. 이후 필터·블러·스마트 필터 스택을 적용할 수 있어요.",
    preview: "image",
    tip: "클립보드 이미지는 ⌘V 또는 Ctrl+V로 바로 가져올 수 있어요.",
  },
  "frame-anim": {
    id: "frame-anim",
    title: "프레임 애니메이션",
    description: "조금씩 다른 그림을 순서대로 쌓아 움직이는 장면을 만듭니다. 타임라인에서 그림마다 보이는 시간을 조절해요.",
    preview: "frame-sequence",
  },
  filter: {
    id: "filter",
    title: "필터",
    description: "선택한 그림을 흐리게 하거나 선명하게 하고, 색과 밝기를 조절합니다. 효과를 여러 개 쌓아 순서도 바꿀 수 있어요.",
    preview: "filter",
    tip: "필터 스택은 원본을 보존하므로 순서와 강도를 언제든 다시 바꿀 수 있어요.",
  },
  lasso: {
    id: "lasso",
    title: "올가미 선택",
    description:
      "고칠 부분의 둘레를 자유롭게 그려 선택합니다. 모서리가 분명한 곳은 점을 차례로 찍고 Enter나 더블클릭으로 닫을 수 있어요.",
    preview: "lasso",
    tip: "선택을 더하거나 빼려면 오른쪽 속성의 ‘더하기’와 ‘빼기’를 사용하세요.",
  },
  "poly-lasso": {
    id: "poly-lasso",
    title: "다각형 올가미",
    description: "클릭으로 꼭짓점을 찍고, 더블클릭 또는 Enter로 닫습니다. Esc로 초안을 취소해요.",
    preview: "polygon-lasso",
  },
  "pixel-select": {
    id: "pixel-select",
    title: "픽셀 선택",
    description:
      "그림 안에서 고칠 부분만 사각형·원·올가미·브러시로 고릅니다. 선택한 부분에만 색 보정, 삭제, 자동 메우기를 적용할 수 있어요.",
    preview: "lasso",
  },
};

const HINT_ID_BY_DESCRIPTION = new Map(
  Object.values(HINTS).map((hint) => [hint.description, hint.id] as const)
);

export function studioToolHint(id: string): StudioToolHintSpec | null {
  return HINTS[id] ?? null;
}

const REGISTERED_HINT_ID_BY_LABEL: Readonly<Record<string, string>> = {
  선택: "select",
  변형: "transform",
  자르기: "crop",
  핸드: "hand",
  펜: "pen",
  "픽셀 펜": "pixel-pencil",
  브러시: "brush-settings",
  "브러시 설정": "brush-settings",
  "브러시 크기": "brush-size",
  굵기: "brush-size",
  불투명도: "opacity",
  "선 보정": "stabilizer",
  보정: "stabilizer",
  필압: "pressure",
  "대칭 그리기": "symmetry",
  대칭: "symmetry",
  지우개: "eraser",
  혼합: "blend",
  리퀴파이: "liquify",
  채우기: "fill",
  스포이드: "eyedropper",
  "라쏘 필": "lasso-fill",
  "올가미 채우기": "lasso-fill",
  도형: "smart-shape",
  "스마트 도형": "smart-shape",
  "사각형 도형": "shape-rect",
  "타원 도형": "shape-ellipse",
  텍스트: "text",
  "텍스트 추가": "text",
  말풍선: "bubble",
  "말풍선 추가": "bubble",
  "프레임 애니메이션": "frame-anim",
  이미지: "image",
  "이미지 추가": "image",
  필터: "filter",
  "다각형 올가미": "poly-lasso",
  "올가미 선택": "lasso",
  올가미: "lasso",
  "사각 선택": "marquee-rect",
  "원형 선택": "marquee-circle",
  댓글: "comment",
  "댓글 핀 배치": "comment",
  "댓글 핀 배치 취소": "comment",
  투시도: "perspective",
  "참고 이미지": "reference",
  "보기 확대·축소": "zoom-view",
  "보기 회전": "rotate-view",
  "더보기 · 툴바 설정": "settings",
  "화면 맞춤": "zoom-view",
  "보기 반전": "flip-view",
  확대: "zoom-view",
  축소: "zoom-view",
  되돌리기: "undo",
  실행취소: "undo",
  다시: "redo",
  다시실행: "redo",
  레이어: "layer",
};

export function normalizeStudioToolHintStableId(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-");
}

export function studioToolHintFromLabel(
  title: string,
  description: string,
  shortcut?: string
): StudioToolHintSpec;
export function studioToolHintFromLabel<
  const Kind extends StudioToolHintPreviewKind,
>(
  title: string,
  description: string,
  shortcut: string | undefined,
  preview: Kind,
  ...variant: [StudioToolHintPreviewCanonicalVariant<Kind>] extends [never]
    ? []
    : [previewVariant?: NoInfer<StudioToolHintPreviewVariant<Kind>>]
): StudioToolHintSpec;
export function studioToolHintFromLabel(
  title: string,
  description: string,
  shortcut?: string,
  preview?: StudioToolHintPreviewKind,
  previewVariant?: string
): StudioToolHintSpec {
  const cleanTitle = title.replace(/(?:\s*\([^)]*\))+\s*$/u, "").trim() || title;
  const normalizedLabel = cleanTitle.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  const registeredId =
    REGISTERED_HINT_ID_BY_LABEL[normalizedLabel] ??
    HINT_ID_BY_DESCRIPTION.get(description) ??
    null;
  const registered = registeredId ? HINTS[registeredId] : null;
  const slug = normalizeStudioToolHintStableId(cleanTitle)
    .replace(/[^a-z0-9가-힣-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "");
  return {
    id: (registeredId ?? slug) || "studio-tool",
    title: cleanTitle,
    description,
    shortcut: shortcut ?? registered?.shortcut,
    preview: preview ?? registered?.preview,
    previewVariant: previewVariant ?? registered?.previewVariant,
    tip: registered?.tip,
  } as StudioToolHintSpec;
}
