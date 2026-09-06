/**
 * Inspector information density — the default/advanced split, as data.
 *
 * `docs/rewrite/ux-audit-v5.md` §2.5 measured 33 controls in the inspector's
 * properties tab and 13 groups / 35 leaves in the tool-properties palette,
 * against a V5 §15 budget of **5~9 default controls, everything else behind an
 * Advanced section**. The audit also pointed at
 * `StudioImageAdjustmentsPanel.tsx:575-621` (`AdjustmentSection`) as the
 * pattern already correct in this repo; `StudioInspectorAside.tsx` renders the
 * split declared here with a port of it (`InspectorSection`).
 *
 * ## Why this is data and not just JSX
 *
 * Two contracts need to be machine-checkable without mounting a 4000-line
 * component: the default budget (5~9), and "nothing was removed — every
 * control is still reachable from Advanced". Both are asserted against this
 * table in `studio-inspector-density.test.ts`.
 *
 * ## On what evidence controls were assigned to the default tier
 *
 * **There is no usage telemetry in this repo.** No module records which
 * inspector control gets touched, so a frequency ranking measured on our own
 * users does not exist and this file does not pretend otherwise. The
 * assignment below uses four stated proxies, in priority order, and every
 * default-tier row records which one it leans on in `rationale`:
 *
 * 1. **Unconditional render.** A control the current inspector shows for
 *    *every* selection type was already judged universal by the code that
 *    exists (클리핑 `:2417`, 그룹 `:2427` are the only two).
 * 2. **Earned a chord or a menu row.** A control that also appears in
 *    `studio-command-catalog.ts` with a shortcut has demonstrated traffic —
 *    nobody spends a chord on a rarely used control (복제 ⌘J, 삭제 Delete,
 *    브러시 크기 `[`·`]`).
 * 3. **Competitor default surface.** What CSP's layer palette, Photoshop's
 *    Layers panel / options bar and Procreate's always-visible rail keep on
 *    screen with no disclosure: blend mode, opacity, clipping, size, flow,
 *    hardness.
 * 4. **Direct manipulation exists.** A control with an on-canvas equivalent
 *    (numeric X/Y/W/H/rotation vs. transform handles) is demoted, because the
 *    panel is the secondary path for it.
 *
 * Section boundaries follow the component's existing contiguous JSX spans, so
 * the split is a wrap rather than a re-order. When a better frequency signal
 * exists this table is the single place to revise.
 */

/* ------------------------------------------------------------------ types */

export type StudioInspectorPanelId =
  | "element-properties"
  | "tool-properties"
  /**
   * 페이지 ▸ 캔버스. Wave D 는 두 속성 패널만 접었고 이 패널은 손대지 않아서,
   * 23개 컨트롤이 디스클로저 하나 없이 전부 펼쳐진 채 남아 있었다 — 인스펙터에서
   * 가장 긴 스크롤이자 "항상 펼쳐져 있지만 자주 쓰지 않는" 표면의 대표였다.
   */
  | "document-canvas";

export type StudioInspectorTier = "default" | "advanced";

/**
 * Canonical property key. Two groups in different panels that mean the same
 * thing must share this key **and** the label attached to it — that is the
 * "모드가 달라도 동일 명칭" requirement, enforced by contract test.
 */
export type StudioInspectorCanonicalKey =
  | "color"
  | "opacity"
  | "blend-mode"
  | "clipping"
  | "group"
  | "pixel-tools"
  | "edit-text"
  | "duplicate"
  | "delete"
  | "size"
  | "stamp-tuning"
  | "quick-shape"
  | "shape-style"
  | "text-fill"
  | "bubble"
  | "typography"
  | "typography-appearance"
  | "typography-advanced"
  | "text-align"
  | "constraints"
  | "blend-extended"
  | "layout"
  | "geometry"
  | "skew"
  | "effect-lines"
  | "order-align"
  | "line-correction"
  | "brush-studio"
  | "brush-engines"
  | "symmetry"
  | "rulers"
  | "canvas-background"
  | "canvas-height"
  | "canvas-grid"
  | "canvas-snap"
  | "canvas-webtoon-guides"
  | "canvas-surface"
  | "canvas-resize"
  | "canvas-guide-lines"
  | "canvas-style";

export interface StudioInspectorControlGroup {
  id: string;
  canonical: StudioInspectorCanonicalKey;
  /** Header text. Must equal `STUDIO_INSPECTOR_CANONICAL_LABELS[canonical]`. */
  label: string;
  tier: StudioInspectorTier;
  /**
   * Individual controls this group renders — the audit counts leaves.
   *
   * One documented exception: a group whose children are self-contained panels counts
   * panels, not the controls inside them (their chip counts follow a preset list and
   * cannot be hand-kept). Such a row says so in its own `rationale`; the real
   * interactive count for those is measured on the DOM by `studio-inspector-dom-density`.
   */
  leaves: number;
  /** Source-of-truth line span in `StudioInspectorAside.tsx`, measured. */
  source: string;
  /** Which proxy above justifies the tier. */
  rationale: string;
  /** Search corpus id that keeps this group reachable once it is collapsed. */
  searchEntryId?: string;
}

export interface StudioInspectorPanelDensity {
  id: StudioInspectorPanelId;
  label: string;
  groups: readonly StudioInspectorControlGroup[];
}

/**
 * One name per concept, across every panel and every tool mode.
 *
 * The measured violation this fixes: the element inspector called it
 * **불투명도** (`StudioInspectorAside.tsx:2388`) while the tool-properties
 * palette called the same 0–100% control **투명도** (`:3517`).
 */
export const STUDIO_INSPECTOR_CANONICAL_LABELS: Readonly<
  Record<StudioInspectorCanonicalKey, string>
> = Object.freeze({
  color: "색상",
  opacity: "불투명도",
  "blend-mode": "혼합 모드",
  clipping: "아래 레이어에 클리핑",
  group: "그룹",
  "pixel-tools": "픽셀 도구",
  "edit-text": "글자 편집",
  duplicate: "복제",
  delete: "삭제",
  size: "크기",
  "stamp-tuning": "흐름·경도",
  "quick-shape": "퀵 셰이프",
  "shape-style": "도형 스타일",
  "text-fill": "글자 채우기 스타일",
  bubble: "말풍선",
  typography: "글꼴",
  "typography-appearance": "외형",
  "typography-advanced": "고급 조판",
  "text-align": "문단",
  constraints: "배치 제약",
  "blend-extended": "확장 블렌드",
  layout: "배치",
  geometry: "위치와 크기",
  skew: "기울이기",
  "effect-lines": "집중선·속도선",
  "order-align": "정렬·순서",
  "line-correction": "선 보정",
  "brush-studio": "브러시 스튜디오",
  "brush-engines": "브러시 엔진",
  symmetry: "대칭 자",
  rulers: "자·가이드",
  "canvas-background": "배경색",
  "canvas-height": "높이",
  "canvas-grid": "그리드 격자 표시",
  "canvas-snap": "정렬 가이드 (스냅)",
  "canvas-webtoon-guides": "웹툰 규격 가이드",
  "canvas-surface": "배경·종이 질감",
  "canvas-resize": "크기·여백",
  "canvas-guide-lines": "가이드선",
  "canvas-style": "만화/웹툰 연출 스타일",
});

/** V5 §15 budget for the default tier, counted in leaves. */
export const STUDIO_INSPECTOR_DEFAULT_BUDGET = Object.freeze({
  min: 5,
  max: 9,
});

/* ----------------------------------------------------------------- tables */

const label = (canonical: StudioInspectorCanonicalKey): string =>
  STUDIO_INSPECTOR_CANONICAL_LABELS[canonical];

const ELEMENT_PROPERTIES: readonly StudioInspectorControlGroup[] = [
  /* -------------------------------------------------------------- default */
  {
    id: "element.color",
    canonical: "color",
    label: label("color"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "프록시 3 — 색상 스와치는 CSP 컬러 서클·PS 전경색·Procreate 상단 원 모두 상시 노출한다.",
  },
  {
    id: "element.opacity",
    canonical: "opacity",
    label: label("opacity"),
    tier: "default",
    leaves: 1,
    // 2026-09-02 감사: 표는 SelectionSection 을 가리켰지만 실제 컨트롤은 위치·크기 패널의
    // 필수 행에 있다. 출처를 실제 렌더 위치로 바로잡았다.
    source: "StudioFigmaDesignPanel.tsx:1",
    rationale:
      "프록시 3 — CSP 레이어 팔레트·PS 레이어 패널의 기본 행에 항상 있다.",
    searchEntryId: "property.opacity",
  },
  {
    id: "element.clipping",
    canonical: "clipping",
    label: label("clipping"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "프록시 1 — 선택 타입과 무관하게 무조건 렌더되는 두 컨트롤 중 하나다.",
    searchEntryId: "property.clipping",
  },
  {
    id: "element.group",
    canonical: "group",
    label: label("group"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale: "프록시 1 — 무조건 렌더되는 나머지 하나다.",
  },
  {
    id: "element.blend-mode",
    canonical: "blend-mode",
    label: label("blend-mode"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "프록시 3 — 위와 같은 근거. 16개 옵션은 select 안에 이미 접혀 있다.",
    searchEntryId: "property.blend-mode",
  },
  {
    id: "element.pixel-tools",
    canonical: "pixel-tools",
    label: label("pixel-tools"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorImageToolsSection.tsx:1",
    rationale:
      "프록시 1 — 5개 탭 스트립 자체는 컨트롤 1개다. 탭 내부는 이미 점진적 노출이라 예산에 1로 든다.",
  },
  {
    id: "element.edit-text",
    canonical: "edit-text",
    label: label("edit-text"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "프록시 3 — 텍스트/말풍선 선택의 1차 동작이며 텍스트가 아닌 선택에서는 렌더되지 않는다.",
  },
  {
    id: "element.duplicate",
    canonical: "duplicate",
    label: label("duplicate"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorOrderAlignSection.tsx:1",
    rationale: "프록시 2 — ⌘J 코드를 가진 명령(`edit.duplicate`)이다.",
  },
  {
    id: "element.delete",
    canonical: "delete",
    label: label("delete"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorOrderAlignSection.tsx:1",
    rationale:
      "프록시 2 — Delete 코드를 가진 명령(`edit.delete-selection`)이다.",
  },

  /* ------------------------------------------------------------- advanced */
  {
    id: "element.shape-style",
    canonical: "shape-style",
    label: label("shape-style"),
    tier: "advanced",
    leaves: 4,
    source: "StudioInspectorShapeSection.tsx:1",
    rationale: "그라데이션·패턴·선 스타일·도형 종류. 도형 선택에서만 의미가 있다.",
  },
  {
    id: "element.text-fill",
    canonical: "text-fill",
    label: label("text-fill"),
    tier: "advanced",
    leaves: 2,
    source: "StudioInspectorShapeSection.tsx:1",
    rationale: "텍스트 그라데이션 채우기.",
  },
  {
    id: "element.bubble",
    canonical: "bubble",
    label: label("bubble"),
    tier: "advanced",
    leaves: 4,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale: "말풍선 외형·모양·앵커·꼬리.",
  },
  /**
   * 2026-09-02 감사 §5.8: 타이포그래피 한 섹션이 실측 15개를 접고 있어 열면 다시 과밀했다.
   * 글꼴 / 외형 / 고급 조판 세 섹션으로 나누고, 정렬·자간·행간은 아래 문단 섹션 한 곳에만 둔다.
   *
   * 아래 세 행의 합은 15 가 아니다 — 산술이 아니라 재분할이기 때문이다. 같은 커밋(446d86fe)이
   * 자간·행간을 문단으로 옮기며 `element.text-align` 을 3 → 5 로 올렸고, `element.typography-advanced`
   * 는 그 뒤 원형 텍스트가 편입되며 2 → 3 이 됐다. 15 는 분할 이전에 실측한 역사적 수치라
   * 사후에 맞춰 고치지 않는다. 재분할 설명은 여기 한 곳에만 둔다.
   */
  {
    id: "element.typography",
    canonical: "typography",
    label: label("typography"),
    tier: "advanced",
    leaves: 5,
    source: "StudioInspectorTypographySection.tsx:1",
    rationale: "글꼴 프리셋·사용자 글꼴·크기·굵게·기울임. 검색/메뉴의 타이포그래피 딥링크가 여기로 착지한다.",
  },
  {
    id: "element.typography-appearance",
    canonical: "typography-appearance",
    label: label("typography-appearance"),
    tier: "advanced",
    leaves: 9,
    source: "StudioInspectorTypographySection.tsx:1",
    rationale: "외곽선(사용·색·두께) + 그림자(사용·색·흐림·X·Y·불투명도). 텍스트 요소에서만 렌더된다.",
  },
  /**
   * `leaves` 규약: 이 행은 잎이 아니라 **자식 패널 개수**를 센다. 세 자식은 각자 헤더와
   * 초기화를 가진 독립 패널이고, 그 안의 칩 수는 프리셋 목록 길이를 따라가서 손으로 유지할
   * 수 없다. 분할 이전 행도 두 패널을 2 로 셌으므로 규약을 바꾸지 않는다. 세 패널이 그리는
   * 상호작용 요소는 소스 기준 13곳(2 + 4 + 7)이고 프리셋 칩은 목록 길이만큼 더 늘어나므로,
   * 화면에 실제로 뜨는 수는 `studio-inspector-dom-density.test.tsx` 가 DOM 에서 센다.
   */
  {
    id: "element.typography-advanced",
    canonical: "typography-advanced",
    label: label("typography-advanced"),
    tier: "advanced",
    leaves: 3,
    source: "StudioInspectorTypographySection.tsx:1",
    rationale:
      "글자 효과 프리셋 + 곡선 텍스트 + 원형 텍스트(main 6ddf0406 CSP 패리티에서 편입) 세 패널. "
      + "셋 다 자체 패널을 가진 특수 조판이라 이 행의 수는 잎이 아니라 패널 개수다(위 주석).",
  },
  {
    id: "element.constraints",
    canonical: "constraints",
    label: label("constraints"),
    tier: "advanced",
    leaves: 3,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "패널 안에 가두기·꽉 채우기·비율 잠금. 비율 잠금이 같은 개념이라 한 섹션으로 모았다.",
  },
  {
    id: "element.text-align",
    canonical: "text-align",
    label: label("text-align"),
    tier: "advanced",
    leaves: 5,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale: "문단 — 정렬·세로 쓰기·자간·행간·높이를 텍스트에 맞춤. 정렬은 이 한 곳에만 노출된다.",
  },
  {
    id: "element.blend-extended",
    canonical: "blend-extended",
    label: label("blend-extended"),
    tier: "advanced",
    leaves: 3,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale: "이미지 선택 전용 확장 블렌드.",
  },
  {
    /**
     * 2026-09-02 감사 P0 결함: 이 행은 X·Y·너비·높이·회전 7개를 여기 접혀 있다고 기록했지만,
     * 그 값들은 이미 StudioFigmaDesignPanel 로 옮겨 가 **접히지 않은 채 최상단에** 그려지고
     * 이 섹션에는 기울이기만 남아 있었다 — 표가 통과해도 화면의 점진적 노출은 깨져 있었다.
     * 표를 실제 렌더에 맞춘다: 이 행은 기울이기, 숫자 배치는 아래 `selection.geometry`.
     */
    id: "element.layout",
    canonical: "skew",
    label: label("skew"),
    tier: "advanced",
    leaves: 2,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale:
      "프록시 4 — 기울이기 X·Y 는 자유 변형 핸들로도 조작 가능하다. 숫자 입력은 보조 경로다.",
  },
  {
    id: "selection.geometry",
    canonical: "geometry",
    label: label("geometry"),
    tier: "advanced",
    leaves: 8,
    source: "StudioFigmaDesignPanel.tsx:1",
    rationale:
      "프록시 4 — X·Y·너비·높이·회전은 캔버스 핸들로 직접 조작 가능하고, 확대·좌우/상하 반전은 ⇧F·⇧H·⇧V 코드가 있다. 패널은 요약 한 줄만 보이고 숫자 그리드는 펼쳐서 연다.",
    searchEntryId: "property.transform-numeric",
  },
  {
    id: "element.effect-lines",
    canonical: "effect-lines",
    label: label("effect-lines"),
    tier: "advanced",
    leaves: 2,
    source: "StudioInspectorSelectionSection.tsx:1",
    rationale: "집중선·속도선·프레임 전용 컨트롤.",
  },
  {
    id: "element.order-align",
    canonical: "order-align",
    label: label("order-align"),
    tier: "advanced",
    leaves: 12,
    source: "StudioInspectorOrderAlignSection.tsx:1",
    rationale:
      "3D·배경 재편집 2 + 좌우/상하 반전 2 + 순서 2 + 정렬 6. 액션바 15개 중 12개가 여기로 접힌다.",
  },
];

const TOOL_PROPERTIES: readonly StudioInspectorControlGroup[] = [
  /* -------------------------------------------------------------- default */
  {
    id: "tool.color",
    canonical: "color",
    label: label("color"),
    tier: "default",
    leaves: 2,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "프록시 3 — 색상과 스포이드는 Procreate 상시 레일과 CSP 도구 속성 최상단에 있다.",
  },
  {
    id: "tool.size",
    canonical: "size",
    label: label("size"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "프록시 2+3 — `[`·`]` 코드(`brush.size-decrease/increase`)를 가졌고 모든 경쟁 제품이 상시 노출한다.",
  },
  {
    id: "tool.opacity",
    canonical: "opacity",
    label: label("opacity"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "프록시 2+3 — `brush.opacity-step` 코드가 있다. 명칭을 요소 인스펙터와 '불투명도'로 통일했다(기존 '투명도').",
  },
  {
    id: "tool.stamp-tuning",
    canonical: "stamp-tuning",
    label: label("stamp-tuning"),
    tier: "default",
    leaves: 3,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "프록시 3 — Flow·Hardness 는 Photoshop 옵션 막대의 기본 노출 항목이다. 최소 굵기가 같은 map 에 묶여 있다.",
  },
  {
    id: "tool.quick-shape",
    canonical: "quick-shape",
    label: label("quick-shape"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "프록시 3 — Procreate QuickShape 대응 기능이고 펜 모드에서만 렌더된다.",
  },

  /* ------------------------------------------------------------- advanced */
  {
    id: "tool.line-correction",
    canonical: "line-correction",
    label: label("line-correction"),
    tier: "advanced",
    leaves: 5,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "입력 보정·보정 방식·즉시 반응·그린 후 보정·모서리 유지. 자체 헤더를 가진 5개짜리 묶음이다.",
  },
  {
    id: "tool.brush-studio",
    canonical: "brush-studio",
    label: label("brush-studio"),
    tier: "advanced",
    leaves: 27,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale:
      "감사 실측 21 Range + 6 Toggle. 모달+탭이라 그 안에서는 이미 기준 충족이었다.",
    searchEntryId: "panel.brush-studio",
  },
  {
    id: "tool.brush-engines",
    canonical: "brush-engines",
    label: label("brush-engines"),
    tier: "advanced",
    leaves: 2,
    source: "StudioInspectorDrawingSection.tsx:1",
    rationale: "호쿠사이 내추럴 미디어 + 절차적 아티스틱 브러시. 둘 다 자체 헤더를 가진 엔진 마운트다.",
  },
  {
    id: "tool.symmetry",
    canonical: "symmetry",
    label: label("symmetry"),
    tier: "advanced",
    leaves: 5,
    source: "StudioInspectorRulersSection.tsx:1",
    rationale: "대칭 유형·갈래 수·중앙 X/Y·중앙 정렬.",
  },
  {
    id: "tool.rulers",
    canonical: "rulers",
    label: label("rulers"),
    tier: "advanced",
    leaves: 3,
    source: "StudioInspectorRulersSection.tsx:1",
    rationale: "원근 자·아이소메트릭 그리드·고급 자. 세 패널 모두 자체 헤더를 갖는다.",
  },
];

/**
 * 페이지 ▸ 캔버스 (`StudioInspectorCanvasControls.tsx`).
 *
 * 기본 티어는 "이 문서가 어떻게 보이는지"를 매 컷 확인하는 다섯 가지다 — 배경색,
 * 높이, 그리드, 스냅, 웹툰 규격 가이드. 나머지는 문서를 처음 세울 때 한 번 만지고
 * 그 뒤로는 거의 건드리지 않는 설정이라 CSP 팔레트처럼 접었다.
 */
const DOCUMENT_CANVAS: readonly StudioInspectorControlGroup[] = [
  /* -------------------------------------------------------------- default */
  {
    id: "canvas.background",
    canonical: "canvas-background",
    label: label("canvas-background"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorCanvasControls.tsx:134-146",
    rationale:
      "프록시 3 — CSP 신규 캔버스 대화상자·PS 캔버스 설정 모두 배경색을 첫 줄에 둔다.",
  },
  {
    id: "canvas.height",
    canonical: "canvas-height",
    label: label("canvas-height"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorCanvasControls.tsx:148-176",
    rationale:
      "프록시 3 — 세로 스크롤 웹툰에서 페이지 길이는 작업 내내 조정하는 값이다.",
  },
  {
    id: "canvas.grid",
    canonical: "canvas-grid",
    label: label("canvas-grid"),
    tier: "default",
    leaves: 2,
    source: "StudioInspectorCanvasControls.tsx:178-208",
    rationale:
      "프록시 3 — 격자 표시 토글은 CSP 표시 메뉴·PS 보기 메뉴의 상시 항목이다. 간격 select 가 같은 행에 묶여 있다.",
  },
  {
    id: "canvas.snap",
    canonical: "canvas-snap",
    label: label("canvas-snap"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorCanvasControls.tsx:210-226",
    rationale:
      "프록시 3 — 스냅 on/off 는 배치 작업 중 계속 껐다 켜는 토글이라 어느 제품도 접지 않는다.",
  },
  {
    id: "canvas.webtoon-guides",
    canonical: "canvas-webtoon-guides",
    label: label("canvas-webtoon-guides"),
    tier: "default",
    leaves: 1,
    source: "StudioInspectorCanvasControls.tsx:228-262",
    rationale:
      "프록시 1 — 이 제품 고유의 규격 확인 수단이고, 켜져 있는지 아닌지가 매 컷 판단에 들어간다.",
  },

  /* ------------------------------------------------------------- advanced */
  {
    id: "canvas.surface",
    canonical: "canvas-surface",
    label: label("canvas-surface"),
    tier: "advanced",
    leaves: 6,
    source: "StudioInspectorCanvasControls.tsx:264-318",
    rationale:
      "종이 질감 3 + 배경 프리셋 + 그라디언트 프리셋 + 배경 편집기. 문서를 세울 때 한 번 정하는 값들이다.",
  },
  {
    id: "canvas.resize",
    canonical: "canvas-resize",
    label: label("canvas-resize"),
    tier: "advanced",
    leaves: 3,
    source: "StudioInspectorCanvasControls.tsx:320-352",
    rationale:
      "매직 리사이즈 2 + 패널 여백. 리사이즈는 플랫폼 납품 직전 한 번, 여백은 템플릿이 있을 때만 활성이다.",
  },
  {
    id: "canvas.guide-lines",
    canonical: "canvas-guide-lines",
    label: label("canvas-guide-lines"),
    tier: "advanced",
    leaves: 7,
    source: "StudioInspectorCanvasControls.tsx:354-430",
    rationale:
      "정렬 가이드 표시 + 세로/가로 추가 2 + 퍼센트 가이드 + 가이드 목록 3(위치·삭제·전체 삭제). 가이드를 깔고 나면 목록은 잘 안 본다.",
  },
  {
    id: "canvas.style",
    canonical: "canvas-style",
    label: label("canvas-style"),
    tier: "advanced",
    leaves: 1,
    source: "StudioInspectorCanvasControls.tsx:432-452",
    rationale: "출판만화/소프트/비비드 연출 프리셋. 작품 단위로 한 번 고른다.",
  },
];

export const STUDIO_INSPECTOR_DENSITY: Readonly<
  Record<StudioInspectorPanelId, StudioInspectorPanelDensity>
> = Object.freeze({
  "element-properties": {
    id: "element-properties",
    label: "선택 요소 속성",
    groups: Object.freeze(ELEMENT_PROPERTIES),
  },
  "tool-properties": {
    id: "tool-properties",
    label: "도구 속성",
    groups: Object.freeze(TOOL_PROPERTIES),
  },
  "document-canvas": {
    id: "document-canvas",
    label: "캔버스 설정",
    groups: Object.freeze(DOCUMENT_CANVAS),
  },
});

/* ---------------------------------------------------------------- lookups */

export function inspectorGroups(
  panel: StudioInspectorPanelId,
): readonly StudioInspectorControlGroup[] {
  return STUDIO_INSPECTOR_DENSITY[panel].groups;
}

export function inspectorGroupsByTier(
  panel: StudioInspectorPanelId,
  tier: StudioInspectorTier,
): readonly StudioInspectorControlGroup[] {
  return inspectorGroups(panel).filter((group) => group.tier === tier);
}

/** Controls visible with no disclosure — the number V5 §15 caps at 5~9. */
export function inspectorDefaultLeafCount(
  panel: StudioInspectorPanelId,
): number {
  return inspectorGroupsByTier(panel, "default").reduce(
    (total, group) => total + group.leaves,
    0,
  );
}

/** Controls reachable at all. Must not shrink — Wave D collapses, never cuts. */
export function inspectorTotalLeafCount(panel: StudioInspectorPanelId): number {
  return inspectorGroups(panel).reduce(
    (total, group) => total + group.leaves,
    0,
  );
}

/** Advanced section ids, in render order. */
export function inspectorAdvancedSectionIds(
  panel: StudioInspectorPanelId,
): string[] {
  return inspectorGroupsByTier(panel, "advanced").map((group) => group.id);
}

/** Header text for an advanced section id, or `null` when it is not declared. */
export function inspectorSectionLabel(id: string): string | null {
  for (const panel of Object.values(STUDIO_INSPECTOR_DENSITY)) {
    const group = panel.groups.find((candidate) => candidate.id === id);
    if (group) return group.label;
  }
  return null;
}
