/**
 * Studio desktop chrome information architecture (IA).
 *
 * Familiar product mental model (names not cloned):
 * - Clip Studio / Magma / Photopea: File · Edit · … top menubar, vertical tools left,
 *   properties + layers right, canvas center.
 * - PowerPoint / Office: document actions top-left (save/open), Home-style edit cluster,
 *   contextual properties for the active selection/tool.
 *
 * Pure data + pure helpers only — no React, no DOM. Live chrome (menubar builder, rail catalog,
 * inspector layout) is the source of membership; this map names regions and high-frequency loops
 * so tests can enforce discoverability without screenshot golden tests.
 */

import {
  DEFAULT_STUDIO_RAIL_TOOL_ORDER,
  STUDIO_RAIL_TOOL_CATALOG,
  type StudioRailToolId,
} from "./studio-app-settings";
import { STUDIO_EDIT_MENU_COMMAND_ORDER } from "./studio-edit-controls";
import {
  STUDIO_INSPECTOR_PRIMARY_SECTIONS,
  type StudioInspectorPrimarySection,
} from "./studio-inspector-layout";

/** Left-to-right / top-to-bottom shell regions on desktop Full density. */
export const STUDIO_CHROME_REGION_ORDER = [
  "menubar",
  "left-tool-rail",
  "canvas",
  "right-inspector",
  "status-quick-actions",
] as const;

export type StudioChromeRegionId = (typeof STUDIO_CHROME_REGION_ORDER)[number];

export interface StudioChromeRegionSpec {
  readonly id: StudioChromeRegionId;
  /** Stable product role (English enum-style) for tests and docs. */
  readonly role: string;
  /** Korean shell label for docs / settings copy. */
  readonly labelKo: string;
  readonly description: string;
}

export const STUDIO_CHROME_REGIONS: readonly StudioChromeRegionSpec[] = [
  {
    id: "menubar",
    role: "document-and-app-menus",
    labelKo: "상단 메뉴",
    description:
      "파일·편집·보기·삽입·레이어·그리기·만화·효과·AI·도움말의 워크플로 메뉴와 사용자 구성 명령 바 (정본 카탈로그는 유지하고 표시 계층만 통합)",
  },
  {
    id: "left-tool-rail",
    role: "tool-selection",
    labelKo: "왼쪽 도구",
    description: "선택·펜·지우개·채우기 등 활성 도구 전환 (CSP 도구 팔레트)",
  },
  {
    id: "canvas",
    role: "document-surface",
    labelKo: "캔버스",
    description: "원고 편집 표면 — 크롬이 가로채지 않는 작업 영역",
  },
  {
    id: "right-inspector",
    role: "context-properties",
    labelKo: "오른쪽 속성·레이어",
    description: "활성 도구/선택 속성과 레이어 스택 (CSP 속성 + 레이어)",
  },
  {
    id: "status-quick-actions",
    role: "quick-document-actions",
    labelKo: "하단 빠른 동작",
    description: "실행취소·다시실행·줌·맞춤 등 상시 단축 동작",
  },
] as const;

/**
 * Canonical menubar catalogue order — V5 §15.3, complete. The visible desktop order is a
 * presentation concern in `studio-main-menu-presentation.ts`; this list remains the stable source
 * membership order used by the command builder and coverage tests. `ai` is a product group §15.3
 * does not define. Transform joined the rendered set in Wave D; Animation and
 * Collaboration joined it in Wave E, once the menu got a door onto the keyframe
 * timeline, the team panel and the review flow — features that had shipped long
 * before anything in the menubar could reach them.
 */
export const STUDIO_CHROME_MENUBAR_GROUP_ORDER = [
  "file",
  "edit",
  "view",
  "canvas",
  "layer",
  "select",
  "transform",
  "brush",
  "filter",
  "vector",
  "text",
  "comic",
  "animation",
  "3d",
  "collaboration",
  "window",
  "ai",
  "help",
] as const;

export type StudioChromeMenubarGroupId =
  (typeof STUDIO_CHROME_MENUBAR_GROUP_ORDER)[number];

/** Familiar labels for core loops (KR product copy). */
export const STUDIO_CHROME_MENUBAR_GROUP_LABELS: Readonly<
  Record<StudioChromeMenubarGroupId, string>
> = {
  file: "파일",
  edit: "편집",
  view: "보기",
  canvas: "캔버스",
  layer: "레이어",
  select: "선택",
  transform: "변형",
  brush: "그리기",
  filter: "필터",
  vector: "벡터",
  text: "텍스트",
  comic: "만화",
  animation: "애니메이션",
  "3d": "3D",
  collaboration: "협업",
  window: "창",
  ai: "AI",
  help: "도움말",
};

/**
 * High-frequency document actions that must remain in File (open/save/export loop).
 * Ids match `buildStudioMainMenuGroups` item ids.
 */
export const STUDIO_CHROME_FILE_CORE_ACTION_IDS = [
  "save-draft",
  "publish",
  "import-json",
  "import-psd",
  "export",
  "export-json",
  "export-archive",
  "project",
] as const;

/** Edit loop: undo and clipboard — must stay under Edit. */
export const STUDIO_CHROME_EDIT_CORE_ACTION_IDS = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "duplicate",
] as const;

/**
 * §15.3 Layer: ordering and layer-scoped crop left Edit in Wave C.
 * 2026-08-20: CSP 경계 효과 문(`border-effect`)을 핀 — 메뉴에서 사라지면 IA 감사가 잡는다.
 */
export const STUDIO_CHROME_LAYER_CORE_ACTION_IDS = [
  "bring-front",
  "bring-forward",
  "send-back",
  "send-backward",
  "crop-layer",
  "border-effect",
] as const;

/** §15.3 Select: the three selection commands left Edit in Wave C. */
export const STUDIO_CHROME_SELECT_CORE_ACTION_IDS = [
  "select-all",
  "deselect",
  "invert-selection",
] as const;

/**
 * File menu item order for CSP/PPT-like document flow:
 * save & publish → import → project tools → export/share → project surfaces.
 *
 * Wave E appended the five surfaces whose only door was the desktop-only
 * 프로젝트 센터 sheet. They sit after the export loop on purpose: the export loop
 * is the high-frequency path and must not move down the menu to make room.
 */
export const STUDIO_CHROME_FILE_MENU_ITEM_ORDER = [
  "save-draft",
  "publish",
  "import-json",
  "import-psd",
  "import-ora-cbz",
  "project",
  "export",
  "copy-image",
  "export-json",
  "export-archive",
  "quick-start",
  "checkpoints",
  "publish-preflight",
  "publish-package",
  "rights-manifest",
] as const;

/** CSP-style left rail tool groups (divider boundaries). */
export const STUDIO_CHROME_RAIL_TOOL_GROUPS = [
  {
    id: "navigate-select",
    labelKo: "선택·이동",
    toolIds: ["select", "hand"] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "draw",
    labelKo: "그리기",
    toolIds: ["pen", "pixel-pencil", "eraser"] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "paint-retouch",
    labelKo: "채색·보정",
    toolIds: [
      "blend",
      "wet-mix",
      "dodge-burn",
      "liquify",
      "fill",
      "lasso-fill",
      "eyedropper",
    ] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "selection",
    labelKo: "선택 범위",
    toolIds: [
      "marquee-rect",
      "marquee-circle",
      "lasso",
    ] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "transform",
    labelKo: "변형",
    toolIds: ["transform", "crop"] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "objects",
    labelKo: "오브젝트",
    toolIds: [
      "smart-shape",
      "shape-rect",
      "shape-ellipse",
      "text",
      "bubble",
      "image",
      "comment",
      "perspective",
    ] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "media-3d",
    labelKo: "3D·참고",
    toolIds: [
      "frame-anim",
      "mannequin3d",
      "vrm3d",
      "character-shaper",
      "bg3d",
      "hybrid-dcc",
      "reference",
    ] as const satisfies readonly StudioRailToolId[],
  },
  {
    id: "view",
    labelKo: "보기",
    toolIds: ["zoom", "zoom-fit", "rotate-view"] as const satisfies readonly StudioRailToolId[],
  },
] as const;

/** Default rail order flattened from IA groups (CSP tool belt order). */
export const STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER: readonly StudioRailToolId[] =
  STUDIO_CHROME_RAIL_TOOL_GROUPS.flatMap((group) => [...group.toolIds]);

/**
 * Caption for a left-rail group divider (`data-studio-rail-group-divider`).
 * Labels the group that follows the hairline (CSP-style tool belt scan).
 */
export function studioChromeRailGroupLabel(
  groupId: (typeof STUDIO_CHROME_RAIL_TOOL_GROUPS)[number]["id"] | string,
): string | undefined {
  return STUDIO_CHROME_RAIL_TOOL_GROUPS.find((group) => group.id === groupId)?.labelKo;
}

export type StudioChromeInspectorContext =
  | { readonly kind: "drawing"; readonly drawMode: "pen" | "pixel" | "eraser" | "shape" }
  | { readonly kind: "selection"; readonly selectedType: string }
  | { readonly kind: "empty" };

export interface StudioChromeInspectorPropertySurface {
  readonly surfaceId: string;
  /** aria-label / tabpanel name for the context surface. */
  readonly ariaLabel: string;
  readonly testId: string;
  /** Controls the surface must expose for the active context. */
  readonly requiredControlLabels: readonly string[];
  readonly primarySection: StudioInspectorPrimarySection;
}

/**
 * Maps active tool/selection to the stable right-inspector property surface.
 * Used by tests and (optionally) shell wiring for discoverable context props.
 */
export function resolveStudioChromeInspectorPropertySurface(
  context: StudioChromeInspectorContext,
): StudioChromeInspectorPropertySurface {
  if (context.kind === "drawing") {
    if (context.drawMode === "pen") {
      return {
        surfaceId: "drawing-pen",
        ariaLabel: "그리기 도구 설정",
        testId: "studio-inspector-context-drawing",
        requiredControlLabels: ["펜", "그리기 도구 설정"],
        primarySection: "properties",
      };
    }
    if (context.drawMode === "pixel") {
      return {
        surfaceId: "drawing-pixel",
        ariaLabel: "그리기 도구 설정",
        testId: "studio-inspector-context-drawing",
        requiredControlLabels: ["픽셀 펜", "픽셀 펜 특성"],
        primarySection: "properties",
      };
    }
    if (context.drawMode === "eraser") {
      return {
        surfaceId: "drawing-eraser",
        ariaLabel: "그리기 도구 설정",
        testId: "studio-inspector-context-drawing",
        requiredControlLabels: ["지우개", "그리기 도구 설정"],
        primarySection: "properties",
      };
    }
    return {
      surfaceId: "drawing-shape",
      ariaLabel: "그리기 도구 설정",
      testId: "studio-inspector-context-drawing",
      requiredControlLabels: ["도형", "그리기 도구 설정"],
      primarySection: "properties",
    };
  }

  if (context.kind === "selection") {
    const type = context.selectedType;
    if (type === "text") {
      return {
        surfaceId: "selection-text",
        ariaLabel: "선택 속성",
        testId: "studio-inspector-context-selection",
        requiredControlLabels: ["불투명도", "텍스트"],
        primarySection: "properties",
      };
    }
    if (type === "bubble") {
      return {
        surfaceId: "selection-bubble",
        ariaLabel: "선택 속성",
        testId: "studio-inspector-context-selection",
        requiredControlLabels: ["불투명도", "말풍선"],
        primarySection: "properties",
      };
    }
    if (type === "image") {
      return {
        surfaceId: "selection-image",
        ariaLabel: "선택 속성",
        testId: "studio-inspector-context-selection",
        requiredControlLabels: ["불투명도"],
        primarySection: "properties",
      };
    }
    if (type === "draw" || type === "shape") {
      return {
        surfaceId: "selection-stroke",
        ariaLabel: "선택 속성",
        testId: "studio-inspector-context-selection",
        // Live copy in StudioInspectorAside selection panel.
        requiredControlLabels: ["선 두께", "불투명도"],
        primarySection: "properties",
      };
    }
    return {
      surfaceId: "selection-generic",
      ariaLabel: "선택 속성",
      testId: "studio-inspector-context-selection",
      requiredControlLabels: ["속성"],
      primarySection: "properties",
    };
  }

  return {
    surfaceId: "empty",
    ariaLabel: "속성",
    testId: "studio-inspector-context-empty",
    requiredControlLabels: ["레이어"],
    primarySection: "layers",
  };
}

export function studioChromeRegionIds(): readonly StudioChromeRegionId[] {
  return STUDIO_CHROME_REGION_ORDER;
}

export function studioChromeMenubarGroupIds(): readonly StudioChromeMenubarGroupId[] {
  return STUDIO_CHROME_MENUBAR_GROUP_ORDER;
}

/** Assert rail catalog and IA groups cover the same tools (no orphan / no phantom). */
export function studioChromeRailCatalogMatchesIaGroups(): {
  readonly ok: boolean;
  readonly missingFromGroups: readonly string[];
  readonly extraInGroups: readonly string[];
  readonly orderMatchesDefault: boolean;
} {
  const catalogIds = new Set<StudioRailToolId>(
    STUDIO_RAIL_TOOL_CATALOG.map((entry) => entry.id),
  );
  const groupIds = new Set<StudioRailToolId>(STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER);
  const missingFromGroups = [...catalogIds].filter((id) => !groupIds.has(id));
  const extraInGroups = [...groupIds].filter((id) => !catalogIds.has(id));
  const orderMatchesDefault =
    STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER.length === DEFAULT_STUDIO_RAIL_TOOL_ORDER.length
    && STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER.every(
      (id, index) => id === DEFAULT_STUDIO_RAIL_TOOL_ORDER[index],
    );
  return {
    ok: missingFromGroups.length === 0 && extraInGroups.length === 0,
    missingFromGroups,
    extraInGroups,
    orderMatchesDefault,
  };
}

/** Edit-menu command catalog must still publish the high-frequency edit loop. */
export function studioChromeEditCommandOrderIncludesCore(): boolean {
  const order = new Set<string>(STUDIO_EDIT_MENU_COMMAND_ORDER);
  return STUDIO_CHROME_EDIT_CORE_ACTION_IDS.every((id) => order.has(id));
}

export function studioChromeInspectorPrimarySections(): readonly StudioInspectorPrimarySection[] {
  return STUDIO_INSPECTOR_PRIMARY_SECTIONS;
}

/**
 * Given menubar groups from `buildStudioMainMenuGroups`, verify IA membership.
 * Pure check over the live builder output — no reimplementation of menu items.
 */
export function auditStudioChromeMenubarAgainstIa(
  groups: readonly { readonly id: string; readonly items: readonly { readonly id: string }[] }[],
): {
  readonly ok: boolean;
  readonly groupOrderOk: boolean;
  readonly missingFileCore: readonly string[];
  readonly missingEditCore: readonly string[];
  readonly missingLayerCore: readonly string[];
  readonly missingSelectCore: readonly string[];
  readonly fileOrderOk: boolean;
} {
  const groupIds = groups.map((group) => group.id);
  const groupOrderOk =
    groupIds.length === STUDIO_CHROME_MENUBAR_GROUP_ORDER.length
    && groupIds.every((id, index) => id === STUDIO_CHROME_MENUBAR_GROUP_ORDER[index]);

  const idsIn = (groupId: string): Set<string> =>
    new Set(groups.find((group) => group.id === groupId)?.items.map((item) => item.id) ?? []);
  const fileIds =
    groups.find((group) => group.id === "file")?.items.map((item) => item.id) ?? [];

  const missingFileCore = STUDIO_CHROME_FILE_CORE_ACTION_IDS.filter(
    (id) => !fileIds.includes(id),
  );
  const editIds = idsIn("edit");
  const layerIds = idsIn("layer");
  const selectIds = idsIn("select");
  const missingEditCore = STUDIO_CHROME_EDIT_CORE_ACTION_IDS.filter((id) => !editIds.has(id));
  const missingLayerCore = STUDIO_CHROME_LAYER_CORE_ACTION_IDS.filter((id) => !layerIds.has(id));
  const missingSelectCore = STUDIO_CHROME_SELECT_CORE_ACTION_IDS.filter(
    (id) => !selectIds.has(id),
  );

  const fileOrderOk =
    fileIds.length === STUDIO_CHROME_FILE_MENU_ITEM_ORDER.length
    && fileIds.every((id, index) => id === STUDIO_CHROME_FILE_MENU_ITEM_ORDER[index]);

  return {
    ok:
      groupOrderOk
      && missingFileCore.length === 0
      && missingEditCore.length === 0
      && missingLayerCore.length === 0
      && missingSelectCore.length === 0
      && fileOrderOk,
    groupOrderOk,
    missingFileCore,
    missingEditCore,
    missingLayerCore,
    missingSelectCore,
    fileOrderOk,
  };
}
