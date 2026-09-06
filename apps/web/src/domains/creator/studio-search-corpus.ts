/**
 * Supplementary search corpus — the destinations that are **not** commands.
 *
 * `studio-command-catalog.ts` (Wave A) already carries 155 commands and their
 * vendor aliases. But the measured alias gap in `docs/rewrite/ux-audit-v5.md`
 * §2.8 is mostly *not* about commands: "레이어 마스크", "클리핑", "서브 도구",
 * "Auto action" and "Levels" are panels and layer/tool **properties**, so no
 * amount of command aliasing reaches them. This file declares those
 * destinations with the same `TerminologyAlias` shape the catalog uses, so one
 * index can answer for both.
 *
 * It is also the safety net for Wave D's other half: the inspector collapses
 * ~2/3 of its controls behind "고급". Collapsing is only acceptable because
 * every collapsed group is declared here and therefore reachable by name. The
 * contract test asserts that link (`studio-inspector-density.test.ts`).
 *
 * Declaration data only — no React, no store access.
 */

import type { StudioInspectorFocusTarget } from "./studio-inspector-focus";
import type {
  StudioDocumentInspectorSection,
  StudioImageInspectorSection,
  StudioInspectorPrimarySection,
} from "./studio-inspector-layout";
import type { TerminologyAlias } from "@toonspectrum/studio-command-registry";

/* ------------------------------------------------------------------ types */

/**
 * Where a result lives. `command` entries come from the catalog; everything
 * else is declared in this file.
 */
export type StudioSearchKind = "command" | "property" | "panel" | "tutorial";

export type StudioSearchTarget =
  /**
   * Move the right inspector to a route (see `navigateStudioInspector`).
   *
   * The shape mirrors `StudioInspectorRoute` field for field — `primary` alone
   * lands on the right tab but the *previous* subtab, so `image`/`document`
   * must ride along or "캔버스 설정" opens the document tab on whatever the
   * user last looked at. `focusTarget` is the deep link the inspector honours
   * after the route mounts (`requestStudioInspectorFocus`).
   */
  | {
      type: "inspector";
      primary: StudioInspectorPrimarySection;
      image?: StudioImageInspectorSection;
      document?: StudioDocumentInspectorSection;
      focusTarget?: StudioInspectorFocusTarget;
    }
  /** Expand one of the two drawing palettes. */
  | { type: "palette"; paletteId: "sub-tools" | "tool-properties" }
  /** Open a lazily mounted studio panel by its stack id. */
  | { type: "panel"; panelId: string }
  /** Open the feature tutorial hub on one tutorial. */
  | { type: "tutorial"; tutorialId: string }
  /** Nothing to activate yet — the breadcrumb plus help node is the answer. */
  | { type: "help" };

export interface StudioSearchCorpusEntry {
  id: string;
  kind: Exclude<StudioSearchKind, "command" | "tutorial">;
  /** Canonical Korean name. Must be the *same* string everywhere it appears. */
  label: string;
  labelEn: string;
  /** Korean breadcrumb — "어디에 있는지". Shown even when `target` is inert. */
  location: string;
  description: string;
  aliases: readonly TerminologyAlias[];
  keywords?: readonly string[];
  helpNodeId: string;
  target: StudioSearchTarget;
  /** Keep the row searchable, but explain that navigation needs an active selection. */
  requiresSelection?: boolean;
  /**
   * Ids from `studioInspectorActions()` this entry absorbs. The navigator's own
   * corpus is merged into the same index, so without this the same destination
   * would appear twice under two section headings.
   */
  supersedes?: readonly string[];
}

/* ---------------------------------------------------------------- helpers */

const alias =
  (vendor: TerminologyAlias["vendor"], locale: TerminologyAlias["locale"]) =>
  (term: string): TerminologyAlias => ({ vendor, term, locale });

/** CLIP STUDIO PAINT — Korean UI wording. */
const csp = alias("csp", "ko");
/** CLIP STUDIO PAINT — English UI wording. */
const cspEn = alias("csp", "en");
const ps = alias("photoshop", "en");
const psKo = alias("photoshop", "ko");
const krita = alias("krita", "en");
const procreate = alias("procreate", "en");
/** Our own legacy wording, kept searchable so renames do not orphan habits. */
const ours = alias("toonstudio", "ko");

/* ---------------------------------------------------------------- corpus */

export const STUDIO_SEARCH_CORPUS: readonly StudioSearchCorpusEntry[] =
  Object.freeze([
    /* ---- 레이어 속성 (인스펙터 · 기본/고급) ---- */
    {
      id: "property.layer-mask",
      kind: "property",
      label: "레이어 마스크",
      labelEn: "Layer mask",
      location: "인스펙터 › 대상 › 마스크",
      description: "비파괴 마스크를 추가하고 반전하거나 직접 칠합니다.",
      aliases: [
        csp("레이어 마스크"),
        cspEn("Layer Mask"),
        ps("Layer Mask"),
        psKo("레이어 마스크"),
        krita("Transparency Mask"),
        procreate("Mask"),
        ours("마스크"),
      ],
      keywords: ["mask", "비파괴", "반전", "페인팅", "alpha"],
      helpNodeId: "help/property/layer-mask",
      target: { type: "inspector", primary: "properties", image: "mask" },
      supersedes: ["image-mask"],
    },
    {
      id: "property.clipping",
      kind: "property",
      label: "아래 레이어에 클리핑",
      labelEn: "Clip to layer below",
      location: "인스펙터 › 대상 › 혼합",
      description: "바로 아래 레이어의 불투명 영역으로 이 레이어를 가둡니다.",
      aliases: [
        csp("아래 레이어에서 클리핑"),
        cspEn("Clip at Layer Below"),
        ps("Clipping Mask"),
        psKo("클리핑 마스크"),
        krita("Inherit Alpha"),
        procreate("Clipping Mask"),
        ours("클리핑"),
      ],
      keywords: ["clip", "clipping", "클리핑", "가두기", "inherit alpha"],
      helpNodeId: "help/property/clipping",
      target: { type: "inspector", primary: "properties" },
      requiresSelection: true,
    },
    {
      id: "property.blend-mode",
      kind: "property",
      label: "혼합 모드",
      labelEn: "Blend mode",
      location: "인스펙터 › 대상 › 혼합",
      description: "곱하기·스크린·오버레이 등 레이어 합성 방식을 고릅니다.",
      aliases: [
        csp("합성 모드"),
        cspEn("Blending Mode"),
        ps("Blending Mode"),
        psKo("혼합 모드"),
        krita("Blending Mode"),
        procreate("Blend Mode"),
        ours("블렌드 모드"),
      ],
      keywords: ["blend", "multiply", "screen", "overlay", "곱하기", "스크린"],
      helpNodeId: "help/property/blend-mode",
      target: { type: "inspector", primary: "properties" },
      requiresSelection: true,
    },
    {
      id: "property.opacity",
      kind: "property",
      label: "불투명도",
      labelEn: "Opacity",
      location: "인스펙터 › 대상 › 혼합",
      description: "선택한 요소나 레이어의 불투명도를 조절합니다.",
      aliases: [
        csp("불투명도"),
        ps("Opacity"),
        krita("Opacity"),
        procreate("Opacity"),
      ],
      keywords: ["opacity", "alpha", "투명도"],
      helpNodeId: "help/property/opacity",
      target: {
        type: "inspector",
        primary: "properties",
        focusTarget: "selection.geometry",
      },
      requiresSelection: true,
    },
    {
      id: "property.transform-numeric",
      kind: "property",
      label: "위치·크기",
      labelEn: "Position and size",
      location: "인스펙터 › 대상 › 배치",
      description: "X·Y·너비·높이·회전을 숫자로 입력합니다.",
      aliases: [
        csp("확대·축소·회전"),
        cspEn("Scale/Rotate"),
        ps("Free Transform"),
        psKo("자유 변형"),
        krita("Transform Tool"),
        procreate("Transform"),
      ],
      keywords: ["transform", "x", "y", "width", "height", "회전", "배치"],
      helpNodeId: "help/property/transform-numeric",
      target: {
        type: "inspector",
        primary: "properties",
        focusTarget: "selection.geometry",
      },
      requiresSelection: true,
    },
    {
      id: "property.layer-style",
      kind: "property",
      label: "레이어 스타일",
      labelEn: "Layer style",
      location: "인스펙터 › 대상 › 효과",
      description: "그림자·테두리·광선 같은 레이어 효과를 켭니다.",
      aliases: [
        csp("경계 효과"),
        cspEn("Border Effect"),
        ps("Layer Style"),
        psKo("레이어 스타일"),
        ps("Drop Shadow"),
        krita("Layer Style"),
      ],
      keywords: ["style", "shadow", "stroke", "glow", "그림자", "테두리"],
      helpNodeId: "help/property/layer-style",
      target: { type: "inspector", primary: "properties" },
      requiresSelection: true,
    },

    /* ---- 색보정 (이미지 보정 패널 섹션) ---- */
    {
      id: "property.levels",
      kind: "property",
      label: "레벨 보정",
      labelEn: "Levels",
      location: "인스펙터 › 대상 › 보정 › 레벨",
      description: "입력·출력 레벨과 감마로 밝기 분포를 다시 맞춥니다.",
      aliases: [
        csp("레벨 보정"),
        cspEn("Level Correction"),
        ps("Levels"),
        psKo("레벨"),
        krita("Levels"),
        ours("레벨"),
      ],
      keywords: ["levels", "레벨", "감마", "gamma", "histogram", "히스토그램"],
      helpNodeId: "help/property/levels",
      target: { type: "inspector", primary: "properties", image: "quick" },
    },
    {
      id: "property.tone-curve-panel",
      kind: "property",
      label: "톤 커브",
      labelEn: "Tone curve",
      location: "인스펙터 › 대상 › 보정 › 톤 커브",
      description: "RGB 채널별 곡선으로 명암을 세밀하게 조절합니다.",
      aliases: [
        csp("톤 커브"),
        cspEn("Tonal Correction"),
        ps("Curves"),
        psKo("곡선"),
        krita("Color Adjustment Curves"),
        procreate("Curves"),
      ],
      keywords: ["curve", "커브", "곡선", "rgb", "명암"],
      helpNodeId: "help/property/tone-curve",
      target: { type: "inspector", primary: "properties", image: "quick" },
    },

    /* ---- 팔레트·패널 ---- */
    {
      id: "panel.sub-tools",
      kind: "panel",
      label: "서브 도구",
      labelEn: "Sub tool",
      location: "그리기 독 › 서브 도구 팔레트",
      description: "현재 도구의 프리셋 목록을 열고 브러시를 갈아 끼웁니다.",
      aliases: [
        csp("보조 도구"),
        cspEn("Sub Tool"),
        ps("Tool Presets"),
        psKo("도구 사전 설정"),
        krita("Brush Presets"),
        procreate("Brush Library"),
        ours("서브 도구"),
      ],
      keywords: ["subtool", "preset", "프리셋", "브러시 목록"],
      helpNodeId: "help/panel/sub-tools",
      target: { type: "palette", paletteId: "sub-tools" },
    },
    {
      id: "panel.tool-properties",
      kind: "panel",
      label: "도구 속성",
      labelEn: "Tool properties",
      location: "그리기 독 › 도구 속성 팔레트",
      description: "현재 도구의 크기·불투명도·보정 등 세부 설정을 엽니다.",
      aliases: [
        csp("도구 속성"),
        cspEn("Tool Property"),
        ps("Options Bar"),
        psKo("옵션 막대"),
        krita("Tool Options"),
        procreate("Brush Studio"),
      ],
      keywords: ["tool", "options", "옵션", "속성", "브러시 설정"],
      helpNodeId: "help/panel/tool-properties",
      target: { type: "palette", paletteId: "tool-properties" },
    },
    {
      id: "panel.auto-actions",
      kind: "panel",
      label: "자동 액션",
      labelEn: "Auto action",
      location: "인스펙터 › 자동화 › 자동 액션",
      description: "반복 작업을 녹화해 한 번의 클릭으로 다시 실행합니다.",
      aliases: [
        csp("오토 액션"),
        cspEn("Auto Action"),
        ps("Actions"),
        psKo("액션"),
        krita("Recorder"),
        krita("Macro"),
        ours("매크로"),
      ],
      keywords: ["auto action", "액션", "매크로", "macro", "녹화", "batch"],
      helpNodeId: "help/panel/auto-actions",
      target: { type: "panel", panelId: "auto-actions" },
    },
    {
      id: "panel.brush-studio",
      // 목적지가 인스펙터 컨트롤 그룹(`tool.brush-studio`)이라 "속성"이다.
      // `studio-inspector-density.ts` 의 같은 그룹이 `searchEntryId` 로 이
      // 행을 가리키고, 형제인 `tool.brush-engines` 도 property 로 들어온다.
      // (id 는 다른 파일이 참조하므로 legacy `panel.` 접두사를 유지한다.)
      kind: "property",
      label: "브러시 스튜디오",
      labelEn: "Brush studio",
      location: "인스펙터 › 대상 › 그리기 › 브러시 스튜디오",
      description: "브러시 끝·산포·필압 곡선까지 전부 편집합니다.",
      aliases: [
        csp("보조 도구 상세"),
        cspEn("Sub Tool Detail"),
        ps("Brush Settings"),
        psKo("브러시 설정"),
        krita("Brush Editor"),
        procreate("Brush Studio"),
      ],
      keywords: ["brush", "브러시", "필압", "산포", "scatter"],
      helpNodeId: "help/panel/brush-studio",
      target: {
        type: "inspector",
        primary: "properties",
        focusTarget: "tool.brush-studio",
      },
      // 빌더가 액션의 `focusTarget` 을 싣기 시작하면서 인스펙터 액션
      // `brush-studio` 와 목적지·라벨이 완전히 같아졌다 — 흡수하지 않으면
      // "브러시" 한 번에 같은 이름 두 줄이 두 구획에 나뉘어 뜬다.
      supersedes: ["brush-studio"],
    },
    {
      // 이 패널을 이름으로 찾을 수 있게 하는 행. 명령 카탈로그에는 여닫는 명령이 있지만 그쪽은
      // `>` 명령 모드(원격 색인)에서만 답하고, 기본 '전체' 탭이 오프라인으로 뒤지는 것은 이
      // 코퍼스다. 형제인 `panel.layer-list` 만 여기 있고 정작 그 옆 패널이 빠져 있어서
      // "작업 패널"·"속성 패널" 둘 다 0건이었다.
      id: "panel.work",
      kind: "panel",
      label: "작업 패널",
      labelEn: "Work Panel",
      location: "인스펙터 › 대상",
      description: "선택한 대상의 속성과 그리기 도구 설정을 조절합니다.",
      aliases: [
        // 이 저장소가 쓰던 옛 이름. 손버릇이 끊기지 않게 별칭으로 남긴다.
        ours("속성 패널"),
        csp("도구 속성"),
        cspEn("Tool Property"),
        ps("Properties Panel"),
        psKo("속성 패널"),
        krita("Tool Options Docker"),
        procreate("Adjustments"),
      ],
      keywords: ["작업", "속성", "패널", "대상", "properties", "inspector", "panel"],
      helpNodeId: "help/panel/work",
      target: { type: "inspector", primary: "properties" },
    },
    {
      // 캐릭터 셰이퍼는 명령 카탈로그에도 있지만, 기본 '전체' 탭이 오프라인으로 뒤지는 것은 이
      // 코퍼스다. "셰이퍼"·"캐릭터 만들기"·"프리셋" 같은 손버릇이 0건이 되지 않게 여기 둔다.
      id: "panel.character-shaper",
      kind: "panel",
      label: "캐릭터 셰이퍼",
      labelEn: "Character Shaper",
      location: "3D › 캐릭터 셰이퍼",
      description: "프리셋 카드로 얼굴·헤어·체형·의상을 고르고 포즈를 잡아 투명 PNG·레이어 PSD로 내보냅니다.",
      aliases: [
        ours("셰이퍼"),
        ours("캐릭터 만들기"),
        ours("프리셋"),
        ours("3D 캐릭터"),
        ours("포즈"),
        ours("의상"),
        ours("VRM"),
      ],
      keywords: ["셰이퍼", "shaper", "캐릭터 만들기", "프리셋", "preset", "3D 캐릭터", "포즈", "pose", "의상", "vrm"],
      helpNodeId: "help/panel/character-shaper",
      target: { type: "panel", panelId: "character-shaper" },
    },
    {
      id: "panel.layer-list",
      kind: "panel",
      label: "레이어 목록",
      labelEn: "Layers",
      location: "인스펙터 › 레이어",
      description: "레이어 순서·그룹·표시·잠금을 관리합니다.",
      aliases: [
        csp("레이어 팔레트"),
        cspEn("Layer Palette"),
        ps("Layers Panel"),
        psKo("레이어 패널"),
        krita("Layers Docker"),
        procreate("Layers"),
      ],
      keywords: ["layer", "레이어", "그룹", "폴더"],
      helpNodeId: "help/panel/layer-list",
      target: { type: "inspector", primary: "layers" },
      supersedes: ["layers"],
    },
  ]);

/** Corpus entries keyed by id. */
export const STUDIO_SEARCH_CORPUS_BY_ID: ReadonlyMap<
  string,
  StudioSearchCorpusEntry
> = new Map(STUDIO_SEARCH_CORPUS.map((entry) => [entry.id, entry]));
