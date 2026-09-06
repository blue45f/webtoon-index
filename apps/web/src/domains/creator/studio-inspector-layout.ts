import {
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";

import type { StudioInspectorFocusTarget } from "./studio-inspector-focus";

export const STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY =
  "toonspectrum:studio:inspector-layout:v1";

/**
 * Every route the right panel can hold. `publish` stays a valid route (deep links,
 * the 게시 workspace and the publish CTA all open it) but it is no longer a tab —
 * see `STUDIO_INSPECTOR_PRIMARY_TABS`.
 */
export const STUDIO_INSPECTOR_PRIMARY_SECTIONS = [
  "properties",
  "layers",
  "document",
  "publish",
] as const;

/**
 * The three tabs the navigator draws: 대상 · 레이어 · 문서 (UX 감사 2026-09-02 §5.3).
 * 작품 정보 used to be a fourth, permanently visible tab although it is touched once
 * per episode; it now opens as a "게시 준비" mode from the publish CTA, the 파일 menu
 * and search, and the navigator shows a way back instead of a fourth tab.
 */
export const STUDIO_INSPECTOR_PRIMARY_TABS = [
  "properties",
  "layers",
  "document",
] as const;

/**
 * Canonical image sub-tab order — also the order the navigator draws them in.
 * The model and the UI used to keep two different orders (audit P1 defect); the
 * navigator now derives its strip from this constant.
 */
export const STUDIO_IMAGE_INSPECTOR_SECTIONS = [
  "quick",
  "fill",
  "transform",
  "retouch",
  "mask",
] as const;

export const STUDIO_DOCUMENT_INSPECTOR_SECTIONS = [
  "canvas",
  "grade",
  "navigator",
] as const;

export type StudioInspectorPrimarySection =
  (typeof STUDIO_INSPECTOR_PRIMARY_SECTIONS)[number];
export type StudioInspectorPrimaryTab =
  (typeof STUDIO_INSPECTOR_PRIMARY_TABS)[number];
export type StudioImageInspectorSection =
  (typeof STUDIO_IMAGE_INSPECTOR_SECTIONS)[number];
export type StudioDocumentInspectorSection =
  (typeof STUDIO_DOCUMENT_INSPECTOR_SECTIONS)[number];

export interface StudioInspectorLayout {
  primary: StudioInspectorPrimarySection;
  image: StudioImageInspectorSection;
  document: StudioDocumentInspectorSection;
}

export interface StudioInspectorRoute {
  primary: StudioInspectorPrimarySection;
  image?: StudioImageInspectorSection;
  document?: StudioDocumentInspectorSection;
}

export interface StudioInspectorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StudioInspectorActionContext {
  hasSelection: boolean;
  selectedType: string | null;
  drawing: boolean;
  /** Advanced brush sections are not mounted for shape or raw-pixel modes. */
  drawingToolPropertiesAvailable?: boolean;
  /**
   * 전문 픽셀 도구는 선택 타입과 별개로 발견 가능해야 한다. false/생략은 레거시
   * 호출부의 선택 기반 노출 규칙을 유지하고, Inspector는 명시적으로 true를 넘긴다.
   */
  imageToolsAvailable?: boolean;
}

export interface StudioInspectorAction {
  id: string;
  label: string;
  description: string;
  keywords: readonly string[];
  route: StudioInspectorRoute;
  /** Search result vocabulary: panels navigate, properties reveal a concrete control group. */
  kind?: "panel" | "property" | "tool";
  /** Human-readable location shown before navigation so the result is predictable. */
  path?: string;
  /** Optional deep link opened after the route mounts. */
  focusTarget?: StudioInspectorFocusTarget;
}

/**
 * Generic normalization/legacy-storage fallback. Studio startup is owned by the active workspace;
 * the shipped storyboard workspace intentionally opens Page on its navigator/minimap subtab.
 */
export const DEFAULT_STUDIO_INSPECTOR_LAYOUT: StudioInspectorLayout = {
  primary: "properties",
  image: "quick",
  document: "canvas",
};

function includesValue<Value extends string>(
  values: readonly Value[],
  value: unknown
): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

export function normalizeStudioInspectorLayout(
  value: unknown
): StudioInspectorLayout {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_STUDIO_INSPECTOR_LAYOUT };
  }

  const candidate = value as Partial<StudioInspectorLayout>;
  return {
    primary: includesValue(
      STUDIO_INSPECTOR_PRIMARY_SECTIONS,
      candidate.primary
    )
      ? candidate.primary
      : DEFAULT_STUDIO_INSPECTOR_LAYOUT.primary,
    image: includesValue(STUDIO_IMAGE_INSPECTOR_SECTIONS, candidate.image)
      ? candidate.image
      : DEFAULT_STUDIO_INSPECTOR_LAYOUT.image,
    document: includesValue(
      STUDIO_DOCUMENT_INSPECTOR_SECTIONS,
      candidate.document
    )
      ? candidate.document
      : DEFAULT_STUDIO_INSPECTOR_LAYOUT.document,
  };
}

export function loadStudioInspectorLayout(
  storage: StudioInspectorStorage | null | undefined
): StudioInspectorLayout {
  if (!storage) return { ...DEFAULT_STUDIO_INSPECTOR_LAYOUT };

  try {
    const raw = storage.getItem(STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STUDIO_INSPECTOR_LAYOUT };
    return normalizeStudioInspectorLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STUDIO_INSPECTOR_LAYOUT };
  }
}

export function saveStudioInspectorLayout(
  storage: StudioInspectorStorage | null | undefined,
  layout: StudioInspectorLayout
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY,
      JSON.stringify(normalizeStudioInspectorLayout(layout))
    );
  } catch {
    // 작업공간 선호 저장이 막혀도 편집 자체는 계속되어야 한다.
  }
}

export function navigateStudioInspector(
  current: StudioInspectorLayout,
  route: StudioInspectorRoute
): StudioInspectorLayout {
  return normalizeStudioInspectorLayout({
    ...current,
    primary: route.primary,
    ...(route.image ? { image: route.image } : {}),
    ...(route.document ? { document: route.document } : {}),
  });
}

const ALWAYS_AVAILABLE_ACTIONS: readonly StudioInspectorAction[] = [
  {
    id: "layers",
    label: "레이어",
    description: "레이어 순서, 그룹, 표시와 잠금을 관리합니다.",
    keywords: ["layer", "folder", "그룹", "잠금", "표시", "참조"],
    route: { primary: "layers" },
    kind: "panel",
    path: "레이어",
  },
  {
    id: "canvas",
    label: "캔버스 설정",
    description: "배경, 높이, 여백, 그리드와 가이드를 조절합니다.",
    keywords: ["canvas", "배경", "높이", "gutter", "그리드", "가이드"],
    route: { primary: "document", document: "canvas" },
    kind: "panel",
    path: "문서 › 캔버스",
  },
  {
    id: "grade",
    label: "페이지 색보정",
    description: "페이지 전체의 밝기, 대비, 채도와 무드를 조절합니다.",
    keywords: ["grade", "color", "밝기", "대비", "채도", "무드", "비네트"],
    route: { primary: "document", document: "grade" },
    kind: "panel",
    path: "문서 › 색보정",
  },
  {
    id: "navigator",
    label: "미니맵·탐색",
    description: "긴 웹툰 페이지의 현재 위치를 확인하고 이동합니다.",
    keywords: ["navigator", "minimap", "미니맵", "이동", "스크롤"],
    route: { primary: "document", document: "navigator" },
    kind: "panel",
    path: "문서 › 미니맵",
  },
  {
    id: "publish",
    label: "작품 정보",
    description: "초안 저장과 게시에 공통으로 쓰는 제목, 설명과 태그를 입력합니다.",
    keywords: ["publish", "게시", "작품", "제목", "설명", "태그", "업로드"],
    route: { primary: "publish" },
    kind: "panel",
    path: "게시 준비 › 작품 정보",
  },
  {
    id: "canvas-resize",
    label: "캔버스 크기",
    description: "페이지 높이와 여백, 크기 변경 방식을 조절합니다.",
    keywords: ["canvas", "resize", "height", "캔버스", "높이", "크기", "여백"],
    route: { primary: "document", document: "canvas" },
    kind: "property",
    path: "문서 › 캔버스 › 크기",
    focusTarget: "canvas.resize",
  },
  {
    id: "canvas-guides",
    label: "가이드와 스냅",
    description: "사용자 가이드, 웹툰 가이드와 맞춤 동작을 설정합니다.",
    keywords: ["guide", "snap", "grid", "가이드", "스냅", "그리드", "맞춤"],
    route: { primary: "document", document: "canvas" },
    kind: "property",
    path: "문서 › 캔버스 › 가이드",
    focusTarget: "canvas.guide-lines",
  },
  {
    id: "canvas-style",
    label: "용지와 캔버스 스타일",
    description: "배경색, 종이 질감과 웹툰 테마를 조절합니다.",
    keywords: ["paper", "style", "background", "용지", "종이", "질감", "배경", "테마"],
    route: { primary: "document", document: "canvas" },
    kind: "property",
    path: "문서 › 캔버스 › 스타일",
    focusTarget: "canvas.style",
  },
];

const IMAGE_ACTIONS: readonly StudioInspectorAction[] = [
  {
    id: "image-quick",
    label: "이미지 빠른 수정",
    description: "레이어 복원, 배경 제거, AI 채색, 팔레트와 기본 보정을 엽니다.",
    keywords: ["image", "quick", "레이어 복원", "분리", "배경 제거", "ai", "채색", "팔레트", "보정"],
    route: { primary: "properties", image: "quick" },
    kind: "tool",
    path: "대상 › 이미지 › 빠른 수정",
  },
  {
    id: "image-fill",
    label: "채우기·선화",
    description: "참조 레이어 채우기와 선화 정리를 엽니다.",
    keywords: ["fill", "bucket", "paint", "채우기", "선화", "틈 닫기", "참조"],
    route: { primary: "properties", image: "fill" },
    kind: "tool",
    path: "대상 › 이미지 › 채우기·선화",
  },
  {
    id: "image-transform",
    label: "크롭·변형",
    description: "이미지 크롭과 퍼펫 워프를 엽니다.",
    keywords: ["transform", "crop", "warp", "크롭", "자르기", "퍼펫", "변형"],
    route: { primary: "properties", image: "transform" },
    kind: "tool",
    path: "대상 › 이미지 › 변형",
  },
  {
    id: "image-retouch",
    label: "선택·리터치",
    description: "선택, 마술봉, 스머지, 복제와 복원 브러시를 엽니다.",
    keywords: ["retouch", "selection", "wand", "smudge", "heal", "clone", "선택", "마술봉", "복원"],
    route: { primary: "properties", image: "retouch" },
    kind: "tool",
    path: "대상 › 이미지 › 선택·리터치",
  },
  {
    id: "image-mask",
    label: "레이어 마스크",
    description: "비파괴 마스크 추가, 반전과 페인팅을 엽니다.",
    keywords: ["mask", "마스크", "비파괴", "반전", "페인팅"],
    route: { primary: "properties", image: "mask" },
    kind: "tool",
    path: "대상 › 이미지 › 마스크",
  },
];


export function studioInspectorActions(
  context: StudioInspectorActionContext
): readonly StudioInspectorAction[] {
  const contextual: StudioInspectorAction[] = [];

  if (context.hasSelection) {
    contextual.push({
      id: "selection-properties",
      label: "선택 요소 속성",
      description: "선택한 요소의 기본, 배치와 스타일 설정을 엽니다.",
      keywords: ["properties", "inspector", "속성", "선택", "배치", "스타일"],
      route: { primary: "properties" },
      kind: "property",
      path: "대상 › 선택 요소",
    });

    if (context.selectedType === "text") {
      contextual.push({
        id: "text-fill",
        label: "글자 채우기 스타일",
        description: "글자색과 그라디언트, 패턴 채우기를 설정합니다.",
        keywords: ["text fill", "font color", "글자색", "채우기", "그라디언트", "패턴"],
        route: { primary: "properties" },
        kind: "property",
        path: "대상 › 글자 › 채우기",
        focusTarget: "element.text-fill",
      });
    }

    if (context.selectedType === "text" || context.selectedType === "bubble") {
      contextual.push(
        {
          id: "typography",
          label: "글꼴",
          description: "글꼴, 크기, 굵기와 기울임을 고릅니다. 외곽선·그림자는 외형, 곡선 텍스트는 고급 조판에 있습니다.",
          keywords: ["typography", "font", "타이포그래피", "글꼴", "폰트", "크기", "굵게", "기울임"],
          route: { primary: "properties" },
          kind: "property",
          path: "대상 › 글자 › 글꼴",
          focusTarget: "element.typography",
        },
        {
          id: "text-align",
          label: "문단 · 정렬과 자간·행간",
          description: "가로 정렬, 세로 쓰기, 자간·행간과 말풍선 맞춤을 설정합니다.",
          keywords: ["align", "vertical", "letter spacing", "line height", "정렬", "왼쪽", "가운데", "오른쪽", "세로 쓰기", "자간", "행간", "문단"],
          route: { primary: "properties" },
          kind: "property",
          path: "대상 › 글자 › 문단",
          focusTarget: "element.text-align",
        },
      );
    }

    contextual.push({
      id: "selection-layout",
      label: "위치와 크기",
      description: "선택 요소의 위치, 크기, 회전과 배치 제약을 편집합니다.",
      keywords: ["layout", "position", "size", "rotation", "x", "y", "width", "height", "위치", "크기", "회전", "배치"],
      route: { primary: "properties" },
      kind: "property",
      path: "대상 › 선택 요소 › 배치",
      focusTarget: "selection.geometry",
    });

    if (context.selectedType !== null) {
      contextual.push({
        id: "selection-order-align",
        label: "정렬과 순서",
        description: "앞뒤 순서, 캔버스 정렬, 복제와 삭제를 관리합니다.",
        keywords: ["order", "align", "arrange", "정렬", "순서", "앞으로", "뒤로", "복제"],
        route: { primary: "properties" },
        kind: "property",
        path: "대상 › 선택 요소 › 정렬·순서",
        focusTarget: "element.order-align",
      });
    }
  } else if (context.drawing) {
    contextual.push({
      id: "drawing-properties",
      label: "그리기 도구 설정",
      description: "브러시, 지우개, 도형, 필압과 자를 엽니다.",
      keywords: ["draw", "brush", "pen", "그리기", "브러시", "지우개", "필압", "대칭"],
      route: { primary: "properties" },
      kind: "tool",
      path: "대상 › 그리기 도구",
    });
    if (context.drawingToolPropertiesAvailable !== false) {
      contextual.push(
        {
          id: "brush-studio",
          label: "브러시 스튜디오",
          description: "브러시 끝, 간격, 압력과 질감의 고급 설정을 엽니다.",
          keywords: ["brush studio", "tip", "spacing", "pressure", "브러시", "간격", "필압", "질감"],
          route: { primary: "properties" },
          kind: "property",
          path: "대상 › 그리기 › 브러시 스튜디오",
          focusTarget: "tool.brush-studio",
        },
        {
          id: "brush-engines",
          label: "브러시 엔진",
          description: "자연매체와 고급 브러시 엔진을 선택하고 조절합니다.",
          keywords: ["brush engine", "natural media", "브러시 엔진", "자연매체", "유화", "수채"],
          route: { primary: "properties" },
          kind: "property",
          path: "대상 › 그리기 › 브러시 엔진",
          focusTarget: "tool.brush-engines",
        },
      );
    }
  }

  if (
    context.imageToolsAvailable === true ||
    context.selectedType === "image" ||
    context.selectedType === "draw"
  ) {
    contextual.push(...IMAGE_ACTIONS);
  }
  return [...contextual, ...ALWAYS_AVAILABLE_ACTIONS];
}

/**
 * 매칭 규칙은 `studio-search-text.ts` 하나로 통일돼 있다. 감사 §2.8 이 지적한
 * "네 검색창이 서로 다른 정규화를 쓴다" 문제를 여기서 끊는다.
 */
export function filterStudioInspectorActions(
  actions: readonly StudioInspectorAction[],
  query: string
): readonly StudioInspectorAction[] {
  if (tokenizeStudioSearchQuery(query).length === 0) return actions;
  return actions.filter((action) =>
    studioSearchTextMatches(query, [
      action.label,
      action.description,
      ...action.keywords,
    ])
  );
}
