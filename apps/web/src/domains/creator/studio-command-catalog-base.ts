/**
 * Studio Command Catalog — the single declaration that the five hand-maintained
 * command lists collapse into.
 *
 * This file is **declaration data only**. It carries no `execute`, no React, no
 * store access; wiring the entries into `CommandRegistry` and retiring the old
 * lists happens in later waves (see `docs/rewrite/command-consolidation-plan.md`).
 * Keeping it inert is what lets the coverage tests run against the live lists
 * without dragging StudioPage into the test graph.
 *
 * Provenance rule: every entry records **which of the five lists it came from**
 * (`origins`). Nothing is silently merged — where two lists disagree on an id, a
 * shortcut or a behaviour, the disagreement is recorded in `COMMAND_CONFLICTS`
 * rather than resolved by picking a winner here.
 *
 * Wave C (2026-08-08) regrouped the main menu to V5 §15.3. The regroup itself
 * added and dropped nothing (116 items) — but the qualified menu
 * `nativeId`s moved with their groups (`edit/select-all` → `select/select-all`,
 * `draw/pen` → `brush/pen`, and so on) and `view/app-settings` was renamed to
 * `window/app-settings-window` to make menu item ids globally unique
 * (conflict `menu-item-id-collision`). Which §15.3 rows we cover lives in
 * `studio-main-menu-group-spec.ts`.
 *
 * 후속 메뉴 진입점 확장으로 카탈로그가 166개까지 늘어난 뒤, 툴벨트 전용이던
 * 검수·미리보기 3종은 View 중복이 제거되어 Animation/Comic 메뉴의 단일 행과
 * "프로젝트 센터" 시트가 소유한다(메뉴당 한 문 원칙).
 *
 * Measured 2026-08-09 against:
 * - `studio-main-menu-items-*.ts`     17 rendered groups / 169 items
 * - `studio-edit-controls.ts`         STUDIO_EDIT_MENU_COMMANDS, 20 entries
 * - `studio-quick-access-integration.ts` STUDIO_QUICK_ACCESS_COMMAND_IDS, 18
 * - `studio-quick-actions.ts`         QUICK_ACTION_IDS, 16
 * - `studio-app-settings.ts`          STUDIO_SHORTCUT_ACTIONS, 34
 * - `StudioShortcutsHelp.tsx`         GROUPS, 37 rows
 */

import {
  STUDIO_FILTER_ALL_LABELS,
  type StudioFilterCoreKindName,
  type StudioFilterPackKind,
} from "./filter/studio-filter-pack-registry";

import type {
  CommandId,
  LocaleTag,
  LocalizedLabel,
  TerminologyAlias,
  TerminologyVendor,
} from "@toonspectrum/studio-command-registry";

/* ------------------------------------------------------------------ types */

export type StudioCommandSource =
  | "menu"
  | "edit-menu"
  | "quick-access"
  | "radial"
  | "keymap"
  | "help";

/**
 * `wired` — a reachable execution path exists.
 * `dead` — the entry exists in its list but nothing routes to it.
 * `advertised-only` — a chord is displayed but no handler claims it.
 * `documented-only` — a help row that describes host behaviour, not a command.
 */
export type StudioCommandOriginStatus =
  | "wired"
  | "dead"
  | "advertised-only"
  | "documented-only";

export interface StudioCommandOrigin {
  source: StudioCommandSource;
  /**
   * The id exactly as the source list spells it. Menu items stay qualified
   * `<group>/<item>` — bare ids became globally unique in Wave C (conflict
   * `menu-item-id-collision`, resolved), but the group is the useful half of the
   * provenance. Help rows use their `labelKey` suffix.
   */
  nativeId: string;
  /** Chord as that list advertises it — display text, not a parsed chord. */
  shortcut?: string;
  status?: StudioCommandOriginStatus;
  note?: string;
}

export interface StudioCommandCatalogEntry {
  id: CommandId;
  /** Namespace segment of `id`. §15.3 menu group where one exists. */
  category: string;
  labels: readonly LocalizedLabel[];
  aliases: readonly TerminologyAlias[];
  /** Chord this command should own after consolidation. */
  shortcut?: string;
  helpNodeId: string;
  origins: readonly StudioCommandOrigin[];
  note?: string;
}

export type StudioCommandConflictKind =
  /** One chord claimed by two different commands. */
  | "shortcut-collision"
  /** One command documented with different chords across lists. */
  | "shortcut-divergence"
  /** One command called by different ids across lists. */
  | "id-divergence"
  /** Same name or chord, different observable result. */
  | "behavior-divergence"
  /** A chord is displayed but nothing binds it. */
  | "unbound-shortcut"
  /** The entry exists but is unreachable. */
  | "dead-entry"
  /** One source row stands in for more than one command. */
  | "row-covers-multiple-commands";

export interface StudioCommandConflict {
  id: string;
  kind: StudioCommandConflictKind;
  /** Chord involved, when the conflict is about a chord. */
  key?: string;
  commandIds: readonly CommandId[];
  detail: string;
  /** file:line evidence, measured — not inferred. */
  evidence: readonly string[];
  /** Intended resolution; the absorbing wave is expected to implement it. */
  resolution: string;
}

export interface StudioCommandSourceInfo {
  label: string;
  file: string;
  /**
   * Further files the drift guard must read alongside `file`. The menu source
   * became several modules when the catalogue was regrouped to §15.3; the guard
   * scans the union so nothing hides in a sibling module.
   */
  extraFiles?: readonly string[];
  declarationRef: string;
  /** Entry count measured 2026-08-08. Drift guards assert against this. */
  measuredCount: number;
}

/* ---------------------------------------------------------------- helpers */

const ko = (label: string, description?: string): LocalizedLabel =>
  description === undefined ? { locale: "ko", label } : { locale: "ko", label, description };

const en = (label: string, description?: string): LocalizedLabel =>
  description === undefined ? { locale: "en", label } : { locale: "en", label, description };

/**
 * Korean label of a Filter-menu row, read from the filter-pack registry — the same string the
 * menu row, the dialog gallery and the inspector chips show. #771 (c9ef0ff7) renamed twelve
 * filters in the registry (JPEG 아티팩트 감소 → JPEG 압축 깨짐 제거, 볼류메트릭 광선 → 빛줄기, …) and a
 * hand-written copy here kept the old names, so command search named a filter differently from
 * the row it opens. The registry is import-free data, so the catalog stays declaration-only.
 */
const filterLabel = (kind: StudioFilterCoreKindName | StudioFilterPackKind): LocalizedLabel =>
  ko(STUDIO_FILTER_ALL_LABELS[kind]);

const vendorAlias =
  (vendor: TerminologyVendor, locale: LocaleTag) =>
  (term: string, note?: string): TerminologyAlias =>
    note === undefined ? { vendor, term, locale } : { vendor, term, locale, note };

/** CLIP STUDIO PAINT (Korean UI). */
const csp = vendorAlias("csp", "ko");
/** CLIP STUDIO PAINT (English UI). */
const cspEn = vendorAlias("csp", "en");
const ps = vendorAlias("photoshop", "en");
/** Photoshop as Korean users actually say it, which is not always the ko UI string. */
const psKo = vendorAlias("photoshop", "ko");
const krita = vendorAlias("krita", "en");
const procreate = vendorAlias("procreate", "en");
/** Our own legacy wording, kept searchable so renames do not orphan habits. */
const ours = vendorAlias("toonstudio", "ko");

const helpNode = (id: CommandId): string => `help/${id.replace(/\./gu, "/")}`;

interface CommandSpec {
  id: CommandId;
  labels: readonly LocalizedLabel[];
  aliases?: readonly TerminologyAlias[];
  shortcut?: string;
  helpNodeId?: string;
  origins: readonly StudioCommandOrigin[];
  note?: string;
}

function defineCommand(spec: CommandSpec): StudioCommandCatalogEntry {
  return {
    id: spec.id,
    category: spec.id.split(".")[0] ?? "",
    labels: spec.labels,
    aliases: spec.aliases ?? [],
    ...(spec.shortcut === undefined ? {} : { shortcut: spec.shortcut }),
    helpNodeId: spec.helpNodeId ?? helpNode(spec.id),
    origins: spec.origins,
    ...(spec.note === undefined ? {} : { note: spec.note }),
  };
}

const menu = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "menu", nativeId, ...extra });

const editMenu = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "edit-menu", nativeId, ...extra });

const quickAccess = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "quick-access", nativeId, ...extra });

const radial = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "radial", nativeId, ...extra });

const keymap = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "keymap", nativeId, ...extra });

const help = (
  nativeId: string,
  extra: Omit<StudioCommandOrigin, "source" | "nativeId"> = {},
): StudioCommandOrigin => ({ source: "help", nativeId, ...extra });

/* ------------------------------------------------------------- inventories */

export const STUDIO_COMMAND_SOURCES: Readonly<
  Record<StudioCommandSource, StudioCommandSourceInfo>
> = Object.freeze({
  menu: {
    label: "메인 메뉴",
    file: "apps/web/src/domains/creator/studio-main-menu-items-document.ts",
    extraFiles: [
      "apps/web/src/domains/creator/studio-help-menu-items.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-animation.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-artwork.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-authoring.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-brush.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-collaboration.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-filter.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-production.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-project.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-selection.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-story.ts",
      "apps/web/src/domains/creator/studio-main-menu-items-workspace.ts",
    ],
    declarationRef:
      "studio-main-menu-item-routing.ts (STUDIO_MENU_ITEM_BUILDERS) + studio-main-menu-items-*.ts",
    // 2026-08-25: 크리에이티브 모드 해체 → 메뉴 재배치 5행 (188 → 193).
    // 2026-08-27: View 중복 검수·미리보기 3행 + 참고 이미지/앱 설정 중복 2행 제거 (193 → 188).
    // 2026-09-03: 웹툰 창작 보조 센터 + AI 슈퍼 스위트 추가 (188 → 190).
    // 2026-09-03: 텍스트 ▸ 현지화 QA(넘침·문체·MQM 점수) 추가 (190 → 191).
    // 2026-09-04: 3D ▸ 캐릭터 셰이퍼(프리셋 우선 캐릭터 작업실) 추가 (191 → 192).
    measuredCount: 192,
  },
  "edit-menu": {
    label: "편집 메뉴 명령 테이블",
    file: "apps/web/src/domains/creator/studio-edit-controls.ts",
    declarationRef: "studio-edit-controls.ts:6-111 (STUDIO_EDIT_MENU_COMMANDS)",
    measuredCount: 20,
  },
  "quick-access": {
    label: "⇧Q 빠른 액세스 팔레트",
    file: "apps/web/src/domains/creator/studio-quick-access-integration.ts",
    declarationRef:
      "studio-quick-access-integration.ts:10-28 (STUDIO_QUICK_ACCESS_COMMAND_IDS)",
    measuredCount: 18,
  },
  radial: {
    label: "라디얼 퀵 액션",
    file: "apps/web/src/domains/creator/studio-quick-actions.ts",
    declarationRef: "studio-quick-actions.ts:19-35 (QUICK_ACTION_IDS)",
    measuredCount: 16,
  },
  keymap: {
    label: "커스터마이즈 키맵",
    file: "apps/web/src/domains/creator/studio-app-settings.ts",
    declarationRef: "studio-app-settings.ts:82-117 (STUDIO_SHORTCUT_ACTIONS)",
    measuredCount: 41,
  },
  help: {
    label: "단축키 도움말",
    file: "apps/web/src/domains/creator/StudioShortcutsHelp.tsx",
    declarationRef: "StudioShortcutsHelp.tsx:34-146 (GROUPS)",
    measuredCount: 37,
  },
});

/**
 * Menu items, qualified `<group>/<item>`, in declaration order.
 * Not importable at test time (the builder needs the whole StudioPage state), so
 * this snapshot plus a source-file drift guard stands in for a live import.
 */
export const STUDIO_MENU_ITEM_INVENTORY: readonly string[] = Object.freeze([
  // file (10) — studio-main-menu-items-document.ts
  "file/save-draft",
  "file/publish",
  "file/import-json",
  "file/import-psd",
  "file/import-ora-cbz",
  "file/project",
  "file/export",
  "file/copy-image",
  "file/export-json",
  "file/export-archive",
  // file, Wave E (5) — studio-main-menu-items-project.ts. The 프로젝트 센터
  // sheet was the only door to these, and it is `max-sm:hidden`.
  "file/quick-start",
  "file/checkpoints",
  "file/publish-preflight",
  "file/publish-package",
  "file/rights-manifest",
  // edit (12) — spread from STUDIO_EDIT_MENU_COMMANDS
  "edit/undo",
  "edit/redo",
  "edit/cut",
  "edit/copy",
  "edit/paste",
  "edit/paste-in-place",
  "edit/paste-file",
  "edit/clear-selection",
  "edit/duplicate",
  "edit/history",
  "edit/pen-pressure",
  "edit/app-settings",
  // edit, Wave E (1) — studio-main-menu-items-project.ts
  "edit/auto-actions",
  // view (17)
  "view/zoom-in",
  "view/zoom-out",
  "view/flip-horizontal",
  "view/rotate-left",
  "view/rotate-right",
  "view/reset-rotation",
  "view/fit",
  "view/actual-pixels",
  "view/fullscreen",
  "view/color-vision-original",
  "view/color-vision-grayscale",
  "view/color-vision-protanopia",
  "view/color-vision-deuteranopia",
  "view/color-vision-tritanopia",
  "view/save-current-view",
  "view/restore-view",
  "view/production-insights",
  // 검수·미리보기 3종 — 툴벨트에서 승격(studio-project-review-actions.ts 주석).
  // view, Wave E (2) — studio-main-menu-items-authoring.ts
  "view/navigator",
  "view/underlay",
  // canvas (2) — lifted out of view
  "canvas/canvas-rulers",
  "canvas/perspective-guide",
  // canvas, Wave E (2) — studio-main-menu-items-authoring.ts
  "canvas/canvas-settings",
  "canvas/grid",
  "canvas/sticky-note",
  // layer (9) — lifted out of edit, insert and view; Mask/Clipping is Wave D's own row
  "layer/image",
  "layer/bring-front",
  "layer/bring-forward",
  "layer/send-back",
  "layer/send-backward",
  "layer/crop-layer",
  "layer/clipping-mask",
  "layer/mask",
  // CSP 경계 효과(fuchi) 진입점 — 187 → 188 (2026-08-20).
  "layer/border-effect",
  "layer/reset-local-visibility",
  // select (10) — the seven §15.3 tool rows (studio-main-menu-items-selection.ts)
  // come first, then the three commands lifted out of edit.
  "select/marquee-rect",
  "select/marquee-ellipse",
  "select/lasso",
  "select/poly-lasso",
  "select/magic-wand",
  "select/color-range",
  "select/quick-mask",
  "select/select-all",
  "select/deselect",
  "select/invert-selection",
  // transform (1) — §15.3 group that shipped nothing until Wave D
  "transform/pixel-transform",
  // brush (13) — former `draw` group + §15.3 Brush doors + pixel/silk from the
  // retired floating creative-modes pill.
  "brush/pen",
  "brush/eraser",
  "brush/fill",
  "brush/smart-shape",
  "brush/preset-browser",
  "brush/brush-studio",
  "brush/natural-media",
  "brush/my-brushes",
  "brush/import-pack",
  "brush/bg",
  "brush/style",
  "brush/pixel-art",
  "brush/silk-flow",
  // filter (52) — 마지막 필터 + 코어 5 + 레이어 보정 2 + 필터 팩 44.
  // 순서는 렌더링 순서다: orderStudioFilterMenuItems 가 #771(c9ef0ff7, 7bda3fbec 에서 배선)의
  // 용도별 분류로 구간을 나눈다 — 마지막 필터, STUDIO_FILTER_DIALOG_GROUP_ORDER 순의 다이얼로그
  // 종류, 그리고 공유 분류 밖에 남는 레이어 보정 2행. 메뉴가 그 순서를 렌더링하므로 여기
  // 순서를 임의로 바꾸면 studio-main-menu-groups.test.ts 의 순서 가드가 즉시 깨진다.
  "filter/last-filter",
  "filter/brightness-contrast",
  "filter/color-curves",
  "filter/hue-saturation-brightness",
  "filter/color-to-alpha",
  "filter/duotone",
  "filter/gaussian-blur",
  "filter/motion-blur",
  "filter/radial-blur",
  "filter/zoom-blur",
  "filter/lens-blur",
  "filter/field-iris-blur",
  "filter/tilt-shift-blur",
  "filter/selective-gaussian-blur",
  "filter/tileable-blur",
  "filter/surface-blur",
  "filter/threshold",
  "filter/line-cleanup",
  "filter/screentone-removal",
  "filter/jpeg-artifact-reduction",
  "filter/edge-aware-denoise",
  "filter/dust-scratches",
  "filter/difference-of-gaussians",
  "filter/chromatic-aberration",
  "filter/vignette",
  "filter/lens-flare",
  "filter/god-rays",
  "filter/mosaic",
  "filter/emboss",
  "filter/solarize",
  "filter/oil-paint",
  "filter/pointillize",
  "filter/stained-glass",
  "filter/poster-edges",
  "filter/photocopy",
  "filter/glitch",
  "filter/scanline",
  "filter/noise-add",
  "filter/film-grain-pro",
  "filter/salt-pepper",
  "filter/rgb-noise",
  "filter/perlin-texture",
  "filter/normal-map",
  "filter/wave-warp",
  "filter/ripple-warp",
  "filter/fisheye",
  "filter/twirl",
  "filter/pinch-bloat",
  "filter/lens-distortion",
  "filter/polar-coordinates",
  "filter/levels",
  "filter/tone-curve",
  // vector (2) — lifted out of insert, plus the eraser's vector mode
  "vector/elements",
  "vector/erase-to-intersection",
  // text (5) — lifted out of insert, plus the two dialogue panels and the QA door
  "text/bubble",
  "text/text",
  "text/dialogue-batch",
  "text/dialogue-translate",
  "text/localization-qa",
  // comic (3) — lifted out of insert and view
  "comic/page",
  "comic/page-sequence",
  "comic/collage",
  // comic, Wave E (7) — studio-main-menu-items-production.ts
  "comic/tone",
  "comic/writer-room",
  "comic/storyboard",
  "comic/story-bible",
  "comic/continuity",
  "comic/scroll-preview",
  "comic/animatic",
  "comic/webtoon-assistant",
  "comic/ai-super-suite",
  // animation (3) — the group left the never-rendered list in Wave E
  "animation/timeline",
  "animation/frame-anim",
  "animation/onion-skin",
  // 3d (5) — insert tools + 캐릭터 셰이퍼 + sculpt workbench (was creative-modes pill)
  "3d/mannequin3d",
  "3d/char",
  "3d/character",
  "3d/bg3d",
  "3d/sculpt",
  // collaboration (4) — Wave E doors + ephemeral whiteboard
  "collaboration/team",
  "collaboration/comments",
  "collaboration/page-review",
  "collaboration/ephemeral-board",
  // window (13) — lifted out of view and insert; the command bar toggle (§15.3
  // Action Bar, CSP 커맨드 바) joined when the menubar history cluster became a
  // user-configurable slotted strip (186 → 187).
  "window/density-focus",
  "window/density-full",
  "window/left-panel",
  "window/right-panel",
  "window/wide",
  "window/canvas-only",
  "window/quick-access-palette",
  "window/command-bar",
  "window/template",
  "window/reference-window",
  "window/tools-companion",
  // ai (3)
  "ai/ai-assist",
  "ai/stock",
  "ai/integrations",
  // help (9) — Wave "Help 그룹 신설"이 §15.3 Help 8행에 문을 냈다.
  "help/command-search",
  "help/terminology-search",
  "help/current-tool",
  "help/feature-tutorials",
  "help/shortcuts",
  "help/diagnostics",
  "help/recovery",
  "help/licenses",
  "help/bug-report",
]);

/**
 * Help rows by `labelKey` suffix (the part after `studio.shortcuts.row.`), in
 * declaration order. `StudioShortcutsHelp.tsx` does not export `GROUPS`, so this
 * snapshot plus a drift guard stands in for a live import.
 */
export const STUDIO_HELP_ROW_INVENTORY: readonly string[] = Object.freeze([
  // drawing (11)
  "drawing.pen",
  "drawing.eraser",
  "drawing.blendWet",
  "drawing.dodgeBurn",
  "drawing.brushSize",
  "drawing.brushSizeStep",
  "drawing.opacity",
  "drawing.recentBrushSlots",
  "drawing.saveBrushSlot",
  "drawing.straighten",
  "drawing.swapColors",
  // edit (14)
  "edit.text",
  "edit.confirmBubble",
  "edit.undo",
  "edit.redo",
  "edit.cutCopy",
  "edit.paste",
  "edit.selectAll",
  "edit.deselect",
  "edit.invert",
  "edit.quickMask",
  "edit.duplicate",
  "edit.fill",
  "edit.delete",
  "edit.cancel",
  // layers (4)
  "layers.forward",
  "layers.backward",
  "layers.move1px",
  "layers.move10px",
  // view (8)
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomFit",
  "view.zoomAtPointer",
  "view.pan",
  "view.toggleCanvas",
  "view.flipCanvas",
  "view.help",
]);

/* ----------------------------------------------------------------- catalog */

export const STUDIO_COMMAND_CATALOG: readonly StudioCommandCatalogEntry[] =
  Object.freeze([
    /* ---------------------------------------------------------------- file */
    defineCommand({
      id: "file.save-draft",
      labels: [ko("초안 저장", "현재 원고를 서버 초안으로 저장합니다."), en("Save draft")],
      aliases: [csp("저장"), cspEn("Save"), ps("Save"), krita("Save"), procreate("자동 저장", "Procreate saves continuously; no explicit command.")],
      shortcut: "⌘S",
      origins: [
        menu("file/save-draft", {
          shortcut: "⌘S",
          status: "advertised-only",
          note: "studio-main-menu-groups.ts:237 은 ⌘S 를 표시하지만 KeyS+meta 핸들러가 없다.",
        }),
        quickAccess("save", { shortcut: "⌘S", status: "advertised-only" }),
      ],
    }),
    defineCommand({
      id: "file.publish",
      labels: [ko("게시 · 수정 게시"), en("Publish")],
      aliases: [ps("Publish"), ours("게시")],
      origins: [menu("file/publish")],
    }),
    defineCommand({
      id: "file.import-project",
      labels: [ko("프로젝트 가져오기…"), en("Import project…")],
      aliases: [csp("가져오기"), ps("Open"), krita("Open")],
      origins: [menu("file/import-json")],
    }),
    defineCommand({
      id: "file.import-psd",
      labels: [ko("PSD 가져오기…"), en("Import PSD…")],
      aliases: [csp("PSD 가져오기"), ps("Open PSD"), krita("Import PSD")],
      origins: [menu("file/import-psd")],
    }),
    defineCommand({
      id: "file.import-interchange",
      labels: [ko("ORA · CBZ · WILL 가져오기…"), en("Import ORA · CBZ · WILL…")],
      aliases: [krita("Open ORA"), csp("파일 가져오기")],
      origins: [menu("file/import-ora-cbz")],
    }),
    defineCommand({
      id: "file.project-tools",
      labels: [ko("프로젝트 센터…"), en("Project center…")],
      aliases: [csp("작품 관리"), ps("Bridge")],
      origins: [menu("file/project")],
    }),
    defineCommand({
      id: "file.export",
      labels: [ko("내보내기 / 다운로드"), en("Export / download")],
      aliases: [csp("내보내기"), cspEn("Export"), ps("Export As"), krita("Export"), procreate("Share")],
      origins: [
        menu("file/export", {
          note: "메뉴는 setExportMenuOpen(true), 메뉴바는 토글 — 같은 명령이 다른 의미(DUP-LOGIC 4사이트).",
        }),
      ],
    }),
    defineCommand({
      id: "file.copy-image-to-clipboard",
      labels: [ko("이미지를 클립보드로"), en("Copy image to clipboard")],
      aliases: [ps("Copy Merged"), krita("Copy Merged")],
      origins: [menu("file/copy-image")],
    }),
    defineCommand({
      id: "file.export-backup",
      labels: [ko("백업 (.json)"), en("Backup (.json)")],
      aliases: [ours("백업")],
      origins: [menu("file/export-json")],
    }),
    defineCommand({
      id: "file.export-archive",
      labels: [ko("아카이브 백업"), en("Archive backup")],
      aliases: [ours("아카이브")],
      origins: [menu("file/export-archive")],
    }),

    /* ---------------------------------------------------------------- edit */
    defineCommand({
      id: "edit.undo",
      labels: [ko("실행취소"), en("Undo")],
      aliases: [csp("실행 취소"), cspEn("Undo"), ps("Undo"), krita("Undo"), procreate("두 손가락 탭")],
      shortcut: "⌘Z",
      origins: [
        menu("edit/undo", { shortcut: "⌘Z" }),
        editMenu("undo", { shortcut: "⌘Z" }),
        keymap("undo", {
          shortcut: "Mod+Z",
          status: "dead",
          note: "studio-app-settings.ts:104 — 실제 실행은 StudioPage.tsx:23821 하드코딩이라 재매핑이 먹지 않는다.",
        }),
        radial("undo"),
        quickAccess("undo", { shortcut: "⌘Z" }),
        help("edit.undo", { shortcut: "⌘Z" }),
      ],
    }),
    defineCommand({
      id: "edit.redo",
      labels: [ko("다시실행"), en("Redo")],
      aliases: [csp("다시 실행"), cspEn("Redo"), ps("Redo"), krita("Redo"), procreate("세 손가락 탭")],
      shortcut: "⌘⇧Z",
      origins: [
        menu("edit/redo", { shortcut: "⌘⇧Z" }),
        editMenu("redo", { shortcut: "⌘⇧Z" }),
        keymap("redo", {
          shortcut: "Mod+Shift+Z",
          status: "dead",
          note: "studio-app-settings.ts:105 — undo 와 같은 이유로 dead.",
        }),
        radial("redo"),
        quickAccess("redo", { shortcut: "⇧⌘Z" }),
        help("edit.redo", { shortcut: "⌘⇧Z · ⌘Y" }),
      ],
    }),
    defineCommand({
      id: "edit.cut",
      labels: [ko("잘라내기"), en("Cut")],
      aliases: [csp("잘라내기"), ps("Cut"), krita("Cut")],
      shortcut: "⌘X",
      origins: [
        menu("edit/cut", { shortcut: "⌘X" }),
        editMenu("cut", { shortcut: "⌘X" }),
        help("edit.cutCopy", { shortcut: "⌘X · ⌘C" }),
      ],
    }),
    defineCommand({
      id: "edit.copy",
      labels: [ko("복사"), en("Copy")],
      aliases: [csp("복사"), ps("Copy"), krita("Copy"), procreate("Copy")],
      shortcut: "⌘C",
      origins: [
        menu("edit/copy", { shortcut: "⌘C" }),
        editMenu("copy", { shortcut: "⌘C" }),
        help("edit.cutCopy", { shortcut: "⌘X · ⌘C" }),
      ],
    }),
    defineCommand({
      id: "edit.paste",
      labels: [ko("붙여넣기"), en("Paste")],
      aliases: [csp("붙여넣기"), ps("Paste"), krita("Paste"), procreate("Paste")],
      shortcut: "⌘V",
      origins: [
        menu("edit/paste", { shortcut: "⌘V" }),
        editMenu("paste", { shortcut: "⌘V" }),
        help("edit.paste", { shortcut: "⌘V · ⌘⇧V" }),
      ],
    }),
    defineCommand({
      id: "edit.paste-in-place",
      labels: [ko("현재 위치에 붙여넣기"), en("Paste in place")],
      aliases: [ps("Paste in Place"), krita("Paste in Place"), csp("같은 위치에 붙여넣기")],
      shortcut: "⌘⇧V",
      origins: [
        menu("edit/paste-in-place", { shortcut: "⌘⇧V" }),
        editMenu("paste-in-place", { shortcut: "⌘⇧V" }),
        help("edit.paste", { shortcut: "⌘V · ⌘⇧V" }),
      ],
    }),
    defineCommand({
      id: "edit.paste-file",
      labels: [ko("이미지 파일 붙여넣기…"), en("Paste image file…")],
      aliases: [ps("Place Embedded"), csp("파일에서 읽어들이기")],
      origins: [menu("edit/paste-file"), editMenu("paste-file")],
    }),
    defineCommand({
      id: "edit.duplicate",
      labels: [ko("복제"), en("Duplicate")],
      aliases: [csp("복제"), ps("Duplicate"), krita("Duplicate"), procreate("Duplicate")],
      shortcut: "⌘J",
      origins: [
        menu("edit/duplicate", { shortcut: "⌘J" }),
        editMenu("duplicate", { shortcut: "⌘J" }),
        radial("duplicate"),
        quickAccess("duplicate", {
          shortcut: "⌘D",
          note: "⌘D 는 선택 해제(select.deselect)가 이미 주장한다 — conflict `cmd-d-duplicate-vs-deselect`.",
        }),
        help("edit.duplicate", { shortcut: "⌘J" }),
      ],
    }),
    defineCommand({
      id: "edit.clear-selection",
      labels: [ko("선택 제거", "선택 영역의 내용을 지웁니다."), en("Clear selection")],
      aliases: [ps("Clear"), krita("Clear"), csp("삭제")],
      shortcut: "Delete",
      origins: [
        menu("edit/clear-selection", { shortcut: "Delete" }),
        editMenu("clear-selection", { shortcut: "Delete" }),
        help("edit.delete", { shortcut: "Delete · ⌫" }),
      ],
      note: "라디얼·팔레트의 `delete`(요소 삭제)와 다른 명령이다 — conflict `delete-clear-vs-remove`.",
    }),
    defineCommand({
      id: "edit.delete-selection",
      labels: [ko("선택 삭제", "선택한 요소를 삭제합니다."), en("Delete selection")],
      aliases: [ps("Delete Layer"), csp("레이어 삭제"), procreate("Delete")],
      shortcut: "Delete",
      origins: [
        radial("delete"),
        quickAccess("delete", { shortcut: "Delete" }),
      ],
      note: "키보드 Del 경로만 말풍선 포인트 / 픽셀 영역 / 엘리먼트 3분기를 갖는다(StudioPage.tsx:24030-24058).",
    }),
    defineCommand({
      id: "edit.crop-layer",
      labels: [ko("레이어 자르기…"), en("Crop layer…")],
      aliases: [ps("Crop"), csp("자르기"), krita("Crop Layer")],
      origins: [menu("layer/crop-layer"), editMenu("crop-layer")],
    }),
    defineCommand({
      id: "edit.history",
      labels: [ko("작업 내역"), en("History")],
      aliases: [csp("히스토리"), ps("History"), krita("Undo History")],
      origins: [menu("edit/history"), editMenu("history")],
    }),
    defineCommand({
      id: "edit.pen-pressure",
      labels: [ko("펜 압력 설정…"), en("Pen pressure settings…")],
      aliases: [csp("필압 검지 레벨 조절"), ps("Pen Pressure"), krita("Tablet Settings")],
      origins: [menu("edit/pen-pressure"), editMenu("pen-pressure")],
    }),
    defineCommand({
      id: "edit.cancel",
      labels: [ko("현재 조작 취소"), en("Cancel current interaction")],
      aliases: [ps("Escape"), krita("Cancel")],
      shortcut: "Esc",
      origins: [help("edit.cancel", { shortcut: "Esc" })],
    }),
    defineCommand({
      id: "edit.confirm-balloon",
      labels: [ko("말풍선 입력 확정"), en("Confirm balloon text")],
      aliases: [csp("텍스트 확정"), ps("Commit Text")],
      shortcut: "⌘Enter",
      origins: [help("edit.confirmBubble", { shortcut: "⌘ Enter" })],
    }),

    /* -------------------------------------------------------------- select */
    defineCommand({
      id: "select.all",
      labels: [ko("모두 선택"), en("Select all")],
      aliases: [csp("모두 선택"), ps("Select All"), krita("Select All"), procreate("Select All")],
      shortcut: "⌘A",
      origins: [
        menu("select/select-all", { shortcut: "⌘A" }),
        editMenu("select-all", { shortcut: "⌘A" }),
        help("edit.selectAll", { shortcut: "⌘A" }),
      ],
    }),
    defineCommand({
      id: "select.deselect",
      labels: [ko("선택 해제"), en("Deselect")],
      aliases: [csp("선택 해제"), ps("Deselect"), krita("Deselect"), procreate("Clear")],
      shortcut: "⌘D",
      origins: [
        menu("select/deselect", { shortcut: "⌘D" }),
        editMenu("deselect", { shortcut: "⌘D" }),
        keymap("deselect-pixels", { shortcut: "Mod+D" }),
        help("edit.deselect", { shortcut: "⌘D" }),
      ],
    }),
    defineCommand({
      id: "select.invert",
      labels: [ko("선택 반전"), en("Invert selection")],
      aliases: [csp("선택 범위 반전"), ps("Inverse"), krita("Invert Selection"), procreate("Invert")],
      shortcut: "⌘⇧I",
      origins: [
        menu("select/invert-selection", { shortcut: "⌘⇧I" }),
        editMenu("invert-selection", { shortcut: "⌘⇧I" }),
        keymap("invert-pixels", { shortcut: "Mod+Shift+I" }),
        help("edit.invert", { shortcut: "⌘⇧I" }),
      ],
    }),
    defineCommand({
      id: "select.quick-mask",
      labels: [ko("퀵 마스크"), en("Quick mask")],
      aliases: [csp("퀵 마스크"), ps("Quick Mask Mode"), krita("Global Selection Mask")],
      shortcut: "Q",
      origins: [
        menu("select/quick-mask", { shortcut: "Q" }),
        radial("quick-mask"),
        quickAccess("quick-mask", { shortcut: "Q" }),
        help("edit.quickMask", { shortcut: "Q" }),
      ],
      note:
        "2026-08-08: 단독 `Q` 는 이 명령만의 것이다. view.color-vision-grayscale 이 같이 주장하던 충돌"
        + "(`q-quickmask-vs-grayscale`)은 grayscale 을 `⌥Q` 로 옮겨 해소했다. 도달 조건(편집 가능한"
        + " 이미지 레이어 선택)은 선택 메뉴 행이 `disabled` + 사유로 화면에 적는다.",
    }),

    /* --------------------------------------------------------------- layer */
    defineCommand({
      id: "layer.new-raster",
      labels: [ko("새 래스터 레이어"), en("New raster layer")],
      aliases: [csp("신규 래스터 레이어"), ps("New Layer"), krita("New Paint Layer")],
      shortcut: "⌘⇧N",
      origins: [keymap("new-layer", { shortcut: "Mod+Shift+N" })],
    }),
    defineCommand({
      id: "layer.merge-down",
      labels: [ko("아래 레이어와 결합"), en("Merge layer down")],
      aliases: [csp("아래 레이어와 결합"), ps("Merge Down"), krita("Merge with Layer Below")],
      shortcut: "⌘E",
      origins: [keymap("merge-layer-down", { shortcut: "Mod+E" })],
    }),
    defineCommand({
      id: "layer.duplicate",
      labels: [ko("레이어 복제"), en("Duplicate layer")],
      aliases: [csp("레이어 복제"), ps("Duplicate Layer"), krita("Duplicate Layer or Mask")],
      shortcut: "⌘J",
      origins: [keymap("duplicate-layer", { shortcut: "Mod+J" })],
    }),
    defineCommand({
      id: "layer.group",
      labels: [ko("선택 레이어 그룹화"), en("Group selected layers")],
      aliases: [csp("새 레이어 폴더"), ps("Group Layers"), krita("Group Layers")],
      shortcut: "⌘G",
      origins: [keymap("group-layers", { shortcut: "Mod+G" })],
    }),
    defineCommand({
      id: "layer.bring-front",
      labels: [ko("레이어 · 맨 위로"), en("Bring to front")],
      aliases: [csp("맨 앞으로"), ps("Bring to Front"), krita("Move Layer to Top")],
      shortcut: "⌘⇧]",
      origins: [
        menu("layer/bring-front", { shortcut: "⌘⇧]" }),
        editMenu("bring-front", { shortcut: "⌘⇧]" }),
        radial("bring-front"),
        quickAccess("bring-front"),
        help("layers.forward", { shortcut: "⌘] · ⌘⇧]" }),
      ],
    }),
    defineCommand({
      id: "layer.bring-forward",
      labels: [ko("레이어 · 위로"), en("Bring forward")],
      aliases: [csp("앞으로"), ps("Bring Forward"), krita("Raise Layer")],
      shortcut: "⌘]",
      origins: [
        menu("layer/bring-forward", { shortcut: "⌘]" }),
        editMenu("bring-forward", { shortcut: "⌘]" }),
        help("layers.forward", { shortcut: "⌘] · ⌘⇧]" }),
      ],
    }),
    defineCommand({
      id: "layer.send-back",
      labels: [ko("레이어 · 맨 뒤로"), en("Send to back")],
      aliases: [csp("맨 뒤로"), ps("Send to Back"), krita("Move Layer to Bottom")],
      shortcut: "⌘⇧[",
      origins: [
        menu("layer/send-back", { shortcut: "⌘⇧[" }),
        editMenu("send-back", { shortcut: "⌘⇧[" }),
        help("layers.backward", { shortcut: "⌘[ · ⌘⇧[" }),
      ],
    }),
    defineCommand({
      id: "layer.send-backward",
      labels: [ko("레이어 · 뒤로"), en("Send backward")],
      aliases: [csp("뒤로"), ps("Send Backward"), krita("Lower Layer")],
      shortcut: "⌘[",
      origins: [
        menu("layer/send-backward", { shortcut: "⌘[" }),
        editMenu("send-backward", { shortcut: "⌘[" }),
        help("layers.backward", { shortcut: "⌘[ · ⌘⇧[" }),
      ],
    }),
    defineCommand({
      id: "layer.nudge-1px",
      labels: [ko("선택 1px 이동"), en("Nudge 1px")],
      aliases: [ps("Nudge"), krita("Move Layer")],
      shortcut: "방향키",
      origins: [help("layers.move1px", { shortcut: "방향키" })],
    }),
    defineCommand({
      id: "layer.nudge-10px",
      labels: [ko("선택 10px 이동"), en("Nudge 10px")],
      aliases: [ps("Big Nudge")],
      shortcut: "⇧방향키",
      origins: [help("layers.move10px", { shortcut: "⇧ + 방향키" })],
    }),
    defineCommand({
      id: "layer.show-locally-hidden",
      labels: [ko("나만 숨긴 레이어 모두 표시"), en("Show all locally hidden layers")],
      aliases: [ps("Show All Layers"), ours("로컬 숨김 해제")],
      origins: [menu("layer/reset-local-visibility")],
    }),
    defineCommand({
      id: "layer.clipping-mask",
      labels: [ko("아래 레이어에 클리핑"), en("Clip to layer below")],
      aliases: [
        csp("아래 레이어에서 클리핑"),
        ps("Create Clipping Mask"),
        krita("Inherit Alpha"),
        procreate("Clipping Mask"),
      ],
      origins: [menu("layer/clipping-mask")],
      note: "인스펙터 체크박스(`StudioInspectorAside.tsx` 클리핑)와 같은 `clipBelow` patch 를 실행한다.",
    }),
    defineCommand({
      id: "layer.mask",
      labels: [ko("레이어 마스크 편집"), en("Edit layer mask")],
      aliases: [
        cspEn("Layer Mask"),
        psKo("레이어 마스크 편집"),
        krita("Transparency Mask"),
        ours("마스크 편집"),
      ],
      origins: [menu("layer/mask")],
      note: "인스펙터 마스크 섹션으로 이동한다. 목적지 자체는 검색 코퍼스의 `property.layer-mask` 가 정본이다.",
    }),
    defineCommand({
      id: "layer.border-effect",
      labels: [ko("레이어 경계 효과"), en("Layer border effect")],
      aliases: [
        csp("경계 효과"),
        cspEn("Border Effect"),
        ours("레이어 테두리 효과"),
      ],
      origins: [menu("layer/border-effect")],
      note: "레이어 탭의 경계 효과 패널을 연다. 픽셀 적용 정본은 render/studio-layer-border-effect-compositor 다(2026-08-20).",
    }),

    /* ---------------------------------------------------------------- view */
    defineCommand({
      id: "view.zoom-in",
      labels: [ko("확대"), en("Zoom in")],
      aliases: [csp("확대"), ps("Zoom In"), krita("Zoom In"), procreate("Pinch out")],
      shortcut: "=",
      origins: [
        menu("view/zoom-in", { shortcut: "=" }),
        help("view.zoomIn", { shortcut: "⌘ +" }),
      ],
      note: "동일 식 setZoom((c)=>stepStudioViewZoom(c,1)) 이 7곳에 복붙돼 있다(ux-audit-v5 §2.4).",
    }),
    defineCommand({
      id: "view.zoom-out",
      labels: [ko("축소"), en("Zoom out")],
      aliases: [csp("축소"), ps("Zoom Out"), krita("Zoom Out"), procreate("Pinch in")],
      shortcut: "-",
      origins: [
        menu("view/zoom-out", { shortcut: "-" }),
        help("view.zoomOut", { shortcut: "⌘ −" }),
      ],
    }),
    defineCommand({
      id: "view.flip-horizontal",
      labels: [ko("수평 반전(보기)"), en("Flip view horizontally")],
      aliases: [csp("좌우 반전"), ps("Flip Horizontal"), krita("Mirror View"), procreate("Flip Canvas Horizontal")],
      shortcut: "H",
      origins: [
        menu("view/flip-horizontal", { shortcut: "H" }),
        keymap("flip-canvas", { shortcut: "H" }),
        help("view.flipCanvas", { shortcut: "H" }),
      ],
    }),
    defineCommand({
      id: "view.rotate-left",
      labels: [ko("왼쪽으로 90° 회전"), en("Rotate view 90° left")],
      aliases: [csp("왼쪽 회전"), ps("Rotate View Left"), krita("Rotate Canvas Left")],
      origins: [menu("view/rotate-left")],
    }),
    defineCommand({
      id: "view.rotate-right",
      labels: [ko("오른쪽으로 90° 회전"), en("Rotate view 90° right")],
      aliases: [csp("오른쪽 회전"), ps("Rotate View Right"), krita("Rotate Canvas Right")],
      origins: [menu("view/rotate-right")],
    }),
    defineCommand({
      id: "view.reset-rotation",
      labels: [ko("보기 회전 초기화"), en("Reset view rotation")],
      aliases: [ps("Reset View"), krita("Reset Canvas Rotation")],
      origins: [menu("view/reset-rotation")],
    }),
    defineCommand({
      id: "view.fit-width",
      labels: [ko("화면에 맞게 조정"), en("Fit on screen")],
      aliases: [csp("화면 맞춤"), ps("Fit on Screen"), krita("Fit Page"), procreate("Pinch to fit")],
      shortcut: "Home",
      origins: [
        menu("view/fit", { shortcut: "Home" }),
        quickAccess("fit-canvas", { shortcut: "Home" }),
        radial("fit-width"),
        keymap("fit-view", { shortcut: "Mod+0" }),
        help("view.zoomFit", {
          shortcut: "⌘ 0",
          note: "도움말만 ⌘0 으로 문서화 — 메뉴·팔레트는 Home.",
        }),
      ],
    }),
    defineCommand({
      id: "view.actual-pixels",
      labels: [ko("실제 픽셀 (100%)"), en("Actual pixels (100%)")],
      aliases: [csp("100%"), ps("100%"), krita("Reset Zoom")],
      shortcut: "End",
      origins: [
        menu("view/actual-pixels", { shortcut: "End" }),
        keymap("actual-size-view", { shortcut: "Mod+1" }),
      ],
    }),
    defineCommand({
      id: "view.canvas-rulers",
      labels: [ko("캔버스 px 눈금자"), en("Canvas pixel rulers")],
      aliases: [csp("자 표시"), ps("Rulers"), krita("Show Rulers")],
      shortcut: "⌥⌘R",
      origins: [menu("canvas/canvas-rulers", { shortcut: "⌥⌘R" })],
    }),
    defineCommand({
      id: "view.fullscreen",
      labels: [ko("전체화면"), en("Fullscreen")],
      aliases: [ps("Full Screen Mode"), krita("Fullscreen Mode"), procreate("Full Screen")],
      shortcut: "F11",
      origins: [menu("view/fullscreen", { shortcut: "F11" })],
    }),
    defineCommand({
      id: "view.color-vision-original",
      labels: [ko("색각 검수 · 원본"), en("Color vision proof · original")],
      aliases: [ps("Proof Colors Off")],
      origins: [menu("view/color-vision-original")],
    }),
    defineCommand({
      id: "view.color-vision-grayscale",
      labels: [ko("색각 검수 · 흑백 명암"), en("Color vision proof · grayscale")],
      aliases: [ps("Proof Colors · Grayscale"), krita("Grayscale Preview")],
      shortcut: "⌥Q",
      origins: [
        menu("view/color-vision-grayscale", { shortcut: "⌥Q" }),
      ],
      note:
        "2026-08-08: 원래 `Q` 였으나 select.quick-mask 와 같은 배지를 달고 선택 상태에 따라 갈렸다"
        + "(conflict `q-quickmask-vs-grayscale`). `⇧Q` 는 빠른 액세스 팔레트가 쓰므로 `⌥Q` 로 옮겼다.",
    }),
    defineCommand({
      id: "view.color-vision-protanopia",
      labels: [ko("색각 검수 · 1형 적록"), en("Color vision proof · protanopia")],
      aliases: [ps("Proof Colors · Protanopia")],
      origins: [menu("view/color-vision-protanopia")],
    }),
    defineCommand({
      id: "view.color-vision-deuteranopia",
      labels: [ko("색각 검수 · 2형 적록"), en("Color vision proof · deuteranopia")],
      aliases: [ps("Proof Colors · Deuteranopia")],
      origins: [menu("view/color-vision-deuteranopia")],
    }),
    defineCommand({
      id: "view.color-vision-tritanopia",
      labels: [ko("색각 검수 · 3형 청황"), en("Color vision proof · tritanopia")],
      aliases: [ps("Proof Colors · Tritanopia")],
      origins: [menu("view/color-vision-tritanopia")],
    }),
    defineCommand({
      id: "view.save-current-view",
      labels: [ko("현재 보기 저장"), en("Save current view")],
      aliases: [ps("New Window Arrangement"), krita("Save Workspace"), ours("보기 저장")],
      shortcut: "⇧S",
      origins: [menu("view/save-current-view", { shortcut: "⇧S" })],
      note: "`⇧S` 를 그리기 리졸버의 크기 잠금도 주장하지만 view 가 먼저 실행된다 — conflict `shift-s-saveview-vs-sizelock`.",
    }),
    defineCommand({
      id: "view.restore-view",
      labels: [ko("보기 복원"), en("Restore saved view")],
      aliases: [ours("보기 복원")],
      shortcut: "⇧Z",
      origins: [menu("view/restore-view", { shortcut: "⇧Z" })],
    }),
    defineCommand({
      id: "view.perspective-guide",
      labels: [ko("원근 도우미 보기"), en("Perspective guide")],
      aliases: [csp("퍼스자"), ps("Perspective Grid"), krita("Perspective Assistant")],
      shortcut: "⇧G",
      origins: [menu("canvas/perspective-guide", { shortcut: "⇧G" })],
    }),
    defineCommand({
      id: "view.reset",
      labels: [ko("화면 리셋(줌 · 위치 · 반전)"), en("Reset view")],
      aliases: [krita("Reset Canvas Transformations"), ps("Reset View")],
      shortcut: "⇧0",
      origins: [keymap("reset-view", { shortcut: "Shift+0" })],
    }),
    defineCommand({
      id: "view.zoom-to-selection",
      labels: [ko("선택 영역으로 확대"), en("Zoom to selection")],
      aliases: [ps("Zoom to Selection"), krita("Zoom to Selection")],
      shortcut: "⇧F",
      origins: [keymap("zoom-to-selection", { shortcut: "Shift+F" })],
    }),
    defineCommand({
      id: "view.zoom-at-pointer",
      labels: [ko("포인터 기준 확대·축소"), en("Zoom at pointer")],
      aliases: [ps("Scrubby Zoom"), krita("Zoom at cursor")],
      shortcut: "⌘+휠",
      origins: [help("view.zoomAtPointer", { shortcut: "⌘ + 휠", status: "documented-only" })],
    }),
    defineCommand({
      id: "view.pan",
      labels: [ko("화면 이동"), en("Pan view")],
      aliases: [csp("손바닥"), ps("Hand Tool"), krita("Pan"), procreate("두 손가락 드래그")],
      shortcut: "Space+드래그",
      origins: [help("view.pan", { shortcut: "Space + 드래그", status: "documented-only" })],
    }),
    defineCommand({
      id: "view.production-insights",
      labels: [ko("제작 인사이트…"), en("Production insights…")],
      aliases: [ours("제작 인사이트")],
      origins: [menu("view/production-insights")],
    }),

    /* -------------------------------------------------------------- window */
    defineCommand({
      id: "window.canvas-only",
      labels: [ko("캔버스만 보기"), en("Canvas only")],
      aliases: [csp("전체 화면 표시"), ps("Screen Mode"), krita("Canvas Only Mode"), procreate("Full Screen")],
      shortcut: "`",
      origins: [
        menu("window/canvas-only", { shortcut: "`" }),
        keymap("toggle-chrome", { shortcut: "`" }),
        help("view.toggleCanvas", { shortcut: "`" }),
      ],
    }),
    defineCommand({
      id: "window.quick-access-palette",
      labels: [ko("빠른 액세스 팔레트"), en("Quick access palette")],
      aliases: [csp("퀵 액세스"), ps("Command Search"), krita("Search Actions")],
      shortcut: "⇧Q",
      origins: [menu("window/quick-access-palette", { shortcut: "⇧Q" })],
    }),
    defineCommand({
      id: "window.command-bar",
      labels: [
        ko("명령 바", "메뉴바 아래 상시 명령 바를 표시하거나 숨깁니다. 슬롯은 명령 바 설정에서 바꿉니다."),
        en("Command bar"),
      ],
      aliases: [csp("커맨드 바"), cspEn("Command Bar"), krita("Toolbars")],
      origins: [
        menu("window/command-bar", {
          note: "호스트가 toggleCommandBar 를 배선하기 전에는 메뉴 행이 스스로 비활성화된다(메뉴바 명령 바 설정이 대체 경로).",
        }),
      ],
    }),
    defineCommand({
      id: "window.left-panel",
      labels: [ko("왼쪽 패널 표시 전환"), en("Toggle left panel")],
      aliases: [ps("Toggle Panels"), krita("Show Dockers")],
      origins: [menu("window/left-panel")],
    }),
    defineCommand({
      id: "window.right-panel",
      // 이 행이 여닫는 패널은 스스로를 "작업 패널"이라고 부른다
      // (`StudioInspectorNavigator` COPY.panelTitle, `StudioInspectorAsideShell`
      // aria-label). 검색 색인의 canonical 이름은 화면에 보이는 이름이어야 하므로
      // 라벨이 그쪽을 따라가고, 예전 이름 "속성 패널"은 손버릇이 끊기지 않게
      // 우리 레거시 별칭으로 남긴다.
      labels: [ko("작업 패널 표시 전환"), en("Toggle work panel")],
      aliases: [
        ours("속성 패널"),
        ps("Properties Panel"),
        krita("Tool Options Docker"),
      ],
      origins: [menu("window/right-panel")],
    }),
    defineCommand({
      id: "window.tool-properties",
      labels: [ko("도구 속성", "현재 도구와 선택 항목의 속성 팔레트를 엽니다."), en("Tool properties")],
      aliases: [csp("도구 속성"), ps("Options Bar"), krita("Tool Options"), procreate("Brush Settings")],
      origins: [radial("properties"), quickAccess("properties")],
    }),
    defineCommand({
      id: "window.reference-panel",
      labels: [ko("참고 이미지 창"), en("Reference window")],
      aliases: [csp("서브 뷰"), ps("Reference Panel"), krita("Reference Images Tool"), procreate("Reference")],
      origins: [menu("window/reference-window")],
    }),
    defineCommand({
      id: "window.page-sequence",
      labels: [ko("페이지 시퀀스"), en("Page sequence")],
      aliases: [csp("페이지 관리"), ps("Artboards")],
      origins: [menu("comic/page-sequence")],
    }),
    defineCommand({
      id: "window.density-focus",
      labels: [ko("슈퍼심플 레이아웃"), en("Focus layout")],
      aliases: [ours("슈퍼심플"), procreate("Minimal UI")],
      origins: [menu("window/density-focus")],
    }),
    defineCommand({
      id: "window.density-full",
      labels: [ko("전체 레이아웃"), en("Full layout")],
      aliases: [ours("전체 레이아웃")],
      origins: [menu("window/density-full")],
    }),
    defineCommand({
      id: "window.collapse-side-panels",
      labels: [ko("패널 접어 넓게"), en("Collapse side panels")],
      aliases: [ps("Collapse Panels"), krita("Hide Dockers")],
      origins: [menu("window/wide")],
    }),
    defineCommand({
      id: "window.tools-companion",
      labels: [ko("멀티 디스플레이 작업공간…"), en("Multi-display companion…")],
      aliases: [ps("New Window for"), krita("New Window")],
      origins: [menu("window/tools-companion")],
    }),
    defineCommand({
      id: "window.app-settings",
      labels: [ko("애플리케이션 설정"), en("Application settings")],
      aliases: [csp("환경 설정"), ps("Preferences"), krita("Configure Krita"), procreate("Settings")],
      origins: [
        menu("edit/app-settings"),
        editMenu("app-settings"),
      ],
    }),

    /* ---------------------------------------------------------------- tool */
    defineCommand({
      id: "tool.select",
      labels: [ko("오브젝트 선택", "요소를 선택하고 이동합니다."), en("Object select")],
      aliases: [csp("오브젝트"), ps("Move Tool"), krita("Select Shapes Tool"), procreate("Selection")],
      shortcut: "V",
      origins: [
        keymap("tool-select", { shortcut: "V" }),
        radial("select"),
        quickAccess("select", { shortcut: "V" }),
      ],
    }),
    defineCommand({
      id: "tool.hand",
      labels: [ko("핸드(팬)"), en("Hand (pan)")],
      aliases: [csp("손바닥"), ps("Hand Tool"), krita("Pan Tool"), procreate("두 손가락 드래그")],
      shortcut: "Space",
      origins: [
        keymap("tool-hand", {
          shortcut: "Space",
          status: "dead",
          note: "studio-app-settings.ts:85 — 재매핑해도 아무 일도 일어나지 않는다.",
        }),
      ],
    }),
    defineCommand({
      id: "tool.pen",
      labels: [ko("펜"), en("Pen")],
      aliases: [csp("펜"), cspEn("Pen"), ps("Brush Tool"), krita("Freehand Brush Tool"), procreate("Brush")],
      shortcut: "B",
      origins: [
        keymap("tool-pen", { shortcut: "B" }),
        menu("brush/pen", { shortcut: "B" }),
        radial("pen"),
        quickAccess("pen", { shortcut: "B" }),
        help("drawing.pen", { shortcut: "B" }),
      ],
      note: "펜/지우개 전환이 8사이트에 복붙돼 있고 부수효과가 4갈래다(ux-audit-v5 §2.4).",
    }),
    defineCommand({
      id: "tool.pixel-pen",
      labels: [ko("픽셀 펜"), en("Pixel pen")],
      aliases: [csp("도트 펜"), ps("Pencil Tool"), krita("Pixel Brush")],
      shortcut: "P",
      origins: [keymap("tool-pixel", { shortcut: "P" })],
    }),
    defineCommand({
      id: "tool.eraser",
      labels: [ko("지우개"), en("Eraser")],
      aliases: [csp("지우개"), ps("Eraser Tool"), krita("Eraser"), procreate("Erase")],
      shortcut: "E",
      origins: [
        keymap("tool-eraser", { shortcut: "E" }),
        menu("brush/eraser", { shortcut: "E" }),
        radial("eraser"),
        quickAccess("eraser", { shortcut: "E" }),
        help("drawing.eraser", { shortcut: "E" }),
      ],
    }),
    defineCommand({
      id: "tool.fill",
      labels: [ko("채우기"), en("Fill")],
      // "페인트 버킷"은 한국어권 Photoshop 사용자가 실제로 부르는 이름이다.
      // 감사 §2.8 8개 질의 중 1번이 이 표기로 들어온다.
      aliases: [
        csp("채우기"),
        ps("Paint Bucket"),
        psKo("페인트 버킷"),
        psKo("페인트 통"),
        krita("Fill Tool"),
        procreate("ColorDrop"),
      ],
      shortcut: "G",
      origins: [
        keymap("tool-fill", { shortcut: "G" }),
        menu("brush/fill", { shortcut: "G" }),
        quickAccess("fill", { shortcut: "G" }),
        radial("advanced-fill", {
          note: "라디얼만 `advanced-fill` 로 부른다 — conflict `fill-id-divergence`.",
        }),
        help("edit.fill", { shortcut: "G" }),
      ],
    }),
    defineCommand({
      id: "tool.eyedropper",
      labels: [ko("스포이드"), en("Eyedropper")],
      aliases: [csp("스포이트"), ps("Eyedropper Tool"), krita("Color Sampler"), procreate("Color Picker")],
      shortcut: "I",
      origins: [
        keymap("tool-eyedropper", { shortcut: "I" }),
        radial("eyedropper"),
        quickAccess("eyedropper", { shortcut: "I" }),
      ],
      note: "키보드·툴레일은 토글, Quick Deck·라디얼은 항상 ON — conflict `eyedropper-toggle-divergence`.",
    }),
    defineCommand({
      id: "tool.lasso",
      labels: [ko("올가미 선택"), en("Lasso select")],
      aliases: [csp("올가미 선택"), ps("Lasso Tool"), krita("Freehand Selection"), procreate("Freehand")],
      shortcut: "L",
      origins: [
        menu("select/lasso", { shortcut: "L" }),
        keymap("tool-lasso", { shortcut: "L" }),
      ],
    }),
    defineCommand({
      id: "tool.poly-lasso",
      labels: [ko("다각형 올가미"), en("Polygonal lasso")],
      aliases: [csp("선택 범위(꺾은선)"), ps("Polygonal Lasso"), krita("Polygonal Selection")],
      origins: [menu("select/poly-lasso")],
      note: "툴레일은 올가미 버튼을 lasso → poly-lasso → off 로 순환시켜 이름을 노출하지 않는다.",
    }),
    defineCommand({
      id: "tool.marquee-rect",
      labels: [ko("사각 선택"), en("Rectangular marquee")],
      aliases: [csp("선택 범위(직사각형)"), ps("Rectangular Marquee"), krita("Rectangular Selection"), procreate("Rectangle")],
      shortcut: "M",
      origins: [
        menu("select/marquee-rect", { shortcut: "M" }),
        keymap("tool-marquee", { shortcut: "M" }),
      ],
    }),
    defineCommand({
      id: "tool.marquee-ellipse",
      labels: [ko("원형 선택"), en("Elliptical marquee")],
      aliases: [csp("선택 범위(타원)"), ps("Elliptical Marquee"), krita("Elliptical Selection"), procreate("Ellipse")],
      shortcut: "⇧M",
      origins: [
        menu("select/marquee-ellipse", { shortcut: "⇧M" }),
        keymap("tool-marquee-circle", { shortcut: "Shift+M" }),
      ],
    }),
    defineCommand({
      id: "tool.magic-wand",
      labels: [ko("자동 선택 (마술봉)"), en("Magic wand")],
      aliases: [csp("자동 선택"), ps("Magic Wand"), krita("Contiguous Selection"), procreate("Automatic")],
      origins: [menu("select/magic-wand")],
    }),
    defineCommand({
      id: "tool.color-range",
      labels: [ko("색 범위 선택"), en("Color range select")],
      aliases: [csp("색역 선택"), ps("Color Range"), krita("Similar Color Selection")],
      origins: [menu("select/color-range")],
    }),
    defineCommand({
      id: "tool.transform",
      labels: [ko("변형"), en("Transform")],
      aliases: [csp("변형"), ps("Free Transform"), krita("Transform Tool"), procreate("Transform")],
      shortcut: "⇧T",
      origins: [keymap("tool-transform", { shortcut: "Shift+T" })],
      note: "팔레트의 `transform`(픽셀 선택 변형)과 다른 명령이다 — conflict `transform-tool-vs-pixel`.",
    }),
    defineCommand({
      id: "tool.crop",
      labels: [ko("자르기"), en("Crop")],
      aliases: [csp("자르기"), ps("Crop Tool"), krita("Crop Tool"), procreate("Crop & Resize")],
      shortcut: "C",
      origins: [keymap("tool-crop", { shortcut: "C" })],
    }),
    defineCommand({
      id: "tool.comment",
      labels: [ko("위치 댓글"), en("Pin comment")],
      aliases: [ps("Note Tool"), ours("위치 댓글")],
      shortcut: "⌥C",
      origins: [keymap("tool-comment", { shortcut: "Alt+C" })],
    }),
    defineCommand({
      id: "tool.smudge",
      labels: [ko("문지르기"), en("Smudge")],
      aliases: [csp("색 혼합"), ps("Smudge Tool"), krita("Smudge Brush"), procreate("Smudge")],
      shortcut: "N",
      origins: [
        keymap("tool-blend", { shortcut: "N" }),
        help("drawing.blendWet", {
          shortcut: "N · ⇧N",
          note: "한 행이 문지르기·혼색 두 명령을 겸한다.",
        }),
      ],
    }),
    defineCommand({
      id: "tool.wet-mix",
      labels: [ko("혼색 브러시"), en("Wet mix brush")],
      aliases: [csp("색 혼합 · 흐리기"), ps("Mixer Brush"), krita("Color Smudge Brush")],
      shortcut: "⇧N",
      origins: [
        keymap("tool-wet-mix", { shortcut: "Shift+N" }),
        radial("wet-mix"),
        quickAccess("wet-mix"),
        help("drawing.blendWet", { shortcut: "N · ⇧N" }),
      ],
    }),
    defineCommand({
      id: "tool.dodge-burn",
      labels: [ko("닷지 · 번"), en("Dodge · burn")],
      aliases: [csp("닷지"), ps("Dodge Tool"), krita("Dodge and Burn"), procreate("Adjustments")],
      shortcut: "O",
      origins: [
        keymap("tool-dodge-burn", { shortcut: "O" }),
        radial("dodge-burn"),
        quickAccess("dodge-burn"),
        help("drawing.dodgeBurn", { shortcut: "O" }),
      ],
    }),
    defineCommand({
      id: "tool.liquify",
      labels: [ko("리퀴파이"), en("Liquify")],
      aliases: [csp("액화"), ps("Liquify"), krita("Liquify Transform"), procreate("Liquify")],
      shortcut: "J",
      origins: [keymap("tool-liquify", { shortcut: "J" })],
    }),
    defineCommand({
      id: "tool.lettering",
      labels: [ko("레터링(텍스트 · 말풍선)"), en("Lettering (text · balloon)")],
      aliases: [csp("텍스트"), ps("Type Tool"), krita("Text Tool"), procreate("Add Text")],
      shortcut: "T",
      origins: [
        keymap("tool-lettering", { shortcut: "T" }),
        help("edit.text", { shortcut: "T" }),
      ],
    }),
    defineCommand({
      id: "tool.zoom",
      labels: [ko("보기 확대 · 축소"), en("Zoom tool")],
      aliases: [csp("돋보기"), ps("Zoom Tool"), krita("Zoom Tool")],
      shortcut: "Z",
      origins: [keymap("tool-zoom", { shortcut: "Z" })],
    }),
    defineCommand({
      id: "tool.rotate-view",
      labels: [ko("보기 회전"), en("Rotate view tool")],
      aliases: [csp("회전"), ps("Rotate View Tool"), krita("Rotate Canvas")],
      shortcut: "R",
      origins: [keymap("tool-rotate-view", { shortcut: "R" })],
    }),
    defineCommand({
      id: "tool.smart-shape",
      labels: [ko("스마트 도형"), en("Smart shape")],
      aliases: [csp("도형"), ps("Shape Tool"), krita("Shape Tools"), procreate("QuickShape")],
      origins: [menu("brush/smart-shape")],
    }),

    /* --------------------------------------------------------------- brush */
    defineCommand({
      id: "brush.size-decrease",
      labels: [ko("브러시 작게"), en("Decrease brush size")],
      aliases: [csp("브러시 크기 줄이기"), ps("Decrease Brush Size"), krita("Decrease Brush Size")],
      shortcut: "[",
      origins: [
        keymap("brush-smaller", { shortcut: "[" }),
        help("drawing.brushSize", { shortcut: "[ · ]" }),
      ],
      note: "클램프가 2원화돼 있다: studio-brush-library.ts:184 [1,80] vs studio-draw-ux.ts:17 {min:1,max:80}.",
    }),
    defineCommand({
      id: "brush.size-increase",
      labels: [ko("브러시 크게"), en("Increase brush size")],
      aliases: [csp("브러시 크기 늘리기"), ps("Increase Brush Size"), krita("Increase Brush Size")],
      shortcut: "]",
      origins: [
        keymap("brush-larger", { shortcut: "]" }),
        help("drawing.brushSize", { shortcut: "[ · ]" }),
      ],
    }),
    defineCommand({
      id: "brush.size-step",
      labels: [ko("브러시 크기 미세 조절"), en("Fine brush size step")],
      aliases: [ps("Brush Size Step")],
      shortcut: "⇧[ · ⇧]",
      origins: [help("drawing.brushSizeStep", { shortcut: "⇧ [ · ⇧ ]" })],
    }),
    defineCommand({
      id: "brush.opacity-step",
      labels: [ko("브러시 불투명도 조절"), en("Brush opacity step")],
      aliases: [csp("불투명도"), ps("Opacity"), krita("Opacity")],
      shortcut: "⌥[ · ⌥]",
      origins: [help("drawing.opacity", { shortcut: "⌥ [ · ⌥ ]" })],
    }),
    defineCommand({
      id: "brush.recent-slot",
      labels: [ko("최근 브러시 슬롯"), en("Recent brush slot")],
      aliases: [csp("보조 도구 전환"), procreate("Brush Library")],
      shortcut: "1–6",
      origins: [help("drawing.recentBrushSlots", { shortcut: "1–6" })],
    }),
    defineCommand({
      id: "brush.save-slot",
      labels: [ko("브러시 슬롯 저장"), en("Save brush slot")],
      aliases: [csp("보조 도구 등록"), krita("Save New Brush Preset")],
      shortcut: "⇧1–6",
      origins: [help("drawing.saveBrushSlot", { shortcut: "⇧ 1–6" })],
    }),
    defineCommand({
      id: "brush.straighten-stroke",
      labels: [ko("직선 그리기"), en("Straighten stroke")],
      aliases: [csp("직선"), ps("Straight Line"), procreate("QuickLine")],
      shortcut: "⇧+드래그",
      origins: [help("drawing.straighten", { shortcut: "⇧ + 드래그", status: "documented-only" })],
    }),
    defineCommand({
      id: "brush.background-tone",
      labels: [ko("배경 · 톤"), en("Background · tone")],
      aliases: [csp("톤"), ps("Halftone Pattern"), krita("Screentone")],
      origins: [menu("brush/bg")],
    }),
    defineCommand({
      id: "brush.palette-brand",
      labels: [ko("팔레트 · 브랜드"), en("Palette · brand")],
      aliases: [csp("컬러 세트"), ps("Swatches"), krita("Palette Docker")],
      origins: [menu("brush/style")],
    }),
    defineCommand({
      id: "brush.preset-browser",
      labels: [ko("브러시 프리셋 목록"), en("Brush preset browser")],
      aliases: [csp("보조 도구 팔레트"), ps("Brush Presets"), krita("Brush Presets Docker")],
      origins: [menu("brush/preset-browser")],
    }),
    defineCommand({
      id: "brush.studio",
      labels: [ko("브러시 스튜디오"), en("Brush Studio")],
      aliases: [csp("보조 도구 상세"), ps("Brush Settings"), procreate("Brush Studio")],
      origins: [menu("brush/brush-studio")],
    }),
    defineCommand({
      id: "brush.natural-media",
      labels: [ko("자연 매체 · 안료"), en("Natural media · pigment")],
      aliases: [csp("수채 경계"), krita("Watercolor / MyPaint engines")],
      origins: [menu("brush/natural-media")],
    }),
    defineCommand({
      id: "brush.saved-library",
      labels: [ko("내 브러시"), en("My brushes")],
      aliases: [csp("내 보조 도구"), ps("Brushes Panel"), krita("Resource Manager")],
      origins: [menu("brush/my-brushes")],
    }),
    defineCommand({
      id: "brush.import-pack",
      labels: [ko("브러시 가져오기"), en("Import brushes")],
      aliases: [csp("소재 읽어들이기"), ps("Load Brushes"), krita("Import Brush Preset")],
      origins: [menu("brush/import-pack")],
    }),
    defineCommand({
      id: "brush.pixel-art",
      labels: [ko("픽셀 아트"), en("Pixel art")],
      aliases: [ours("제한 팔레트"), ps("Pixel Grid")],
      origins: [menu("brush/pixel-art")],
    }),
    defineCommand({
      id: "brush.silk-flow",
      labels: [ko("실크 대칭"), en("Silk symmetry")],
      aliases: [ours("실크 플로우"), procreate("Symmetry")],
      origins: [menu("brush/silk-flow")],
    }),

    /* --------------------------------------------------------------- color */
    defineCommand({
      id: "color.swap-primary-secondary",
      labels: [ko("주 · 보조 색 교체"), en("Swap primary and secondary color")],
      aliases: [csp("그리기색과 배경색 전환"), ps("Switch Foreground/Background"), krita("Swap Foreground/Background")],
      shortcut: "X",
      origins: [
        keymap("swap-colors", { shortcut: "X" }),
        help("drawing.swapColors", { shortcut: "X" }),
      ],
    }),
    defineCommand({
      id: "color.toggle-transparent",
      labels: [ko("투명색 그리기 토글"), en("Toggle transparent color")],
      aliases: [csp("투명색"), cspEn("Transparent color"), ours("투명 브러시")],
      shortcut: "C",
      origins: [keymap("toggle-transparent-color", { shortcut: "C" })],
    }),

    /* ----------------------------------------------------------- transform */
    defineCommand({
      id: "transform.pixel-selection",
      labels: [ko("픽셀 선택 변형"), en("Transform pixel selection")],
      aliases: [csp("선택 범위 변형"), ps("Transform Selection"), krita("Transform Selection")],
      origins: [menu("transform/pixel-transform"), quickAccess("transform")],
    }),
    defineCommand({
      id: "transform.flip-selection-horizontal",
      labels: [ko("선택 좌우 반전"), en("Flip selection horizontally")],
      aliases: [csp("좌우 반전"), ps("Flip Horizontal"), krita("Mirror Horizontally")],
      shortcut: "⇧H",
      origins: [keymap("flip-selection-h", { shortcut: "Shift+H" })],
    }),
    defineCommand({
      id: "transform.flip-selection-vertical",
      labels: [ko("선택 상하 반전"), en("Flip selection vertically")],
      aliases: [csp("상하 반전"), ps("Flip Vertical"), krita("Mirror Vertically")],
      shortcut: "⇧V",
      origins: [keymap("flip-selection-v", { shortcut: "Shift+V" })],
    }),

    /* -------------------------------------------------------------- insert */
    defineCommand({
      id: "insert.template",
      labels: [ko("템플릿 · 에셋"), en("Template · assets")],
      aliases: [csp("소재"), ps("Libraries"), krita("Resources")],
      origins: [menu("window/template")],
    }),
    defineCommand({
      id: "insert.collage",
      labels: [ko("콜라주"), en("Collage")],
      aliases: [ours("콜라주")],
      origins: [menu("comic/collage")],
    }),
    defineCommand({
      id: "insert.elements",
      labels: [ko("요소 · 도형"), en("Elements · shapes")],
      aliases: [csp("도형"), ps("Custom Shape")],
      origins: [menu("vector/elements")],
    }),
    defineCommand({
      id: "insert.balloon",
      labels: [ko("말풍선"), en("Speech balloon")],
      aliases: [csp("말풍선"), cspEn("Balloon"), ours("말풍선 삽입")],
      origins: [menu("text/bubble")],
      note: "라디얼·팔레트의 `add-bubble`(text.add-balloon)과 중복 — conflict `balloon-id-divergence`.",
    }),
    defineCommand({
      id: "insert.text",
      labels: [ko("텍스트"), en("Text")],
      aliases: [csp("텍스트"), ps("Type Tool"), krita("Text Tool")],
      origins: [menu("text/text")],
    }),
    defineCommand({
      id: "insert.image",
      labels: [ko("이미지…"), en("Image…")],
      aliases: [csp("화상 읽어들이기"), ps("Place Embedded"), krita("Insert Image")],
      origins: [menu("layer/image")],
    }),
    defineCommand({
      id: "insert.mannequin-3d",
      labels: [ko("3D 데생 인형"), en("3D drawing mannequin")],
      aliases: [csp("3D 데생 인형"), cspEn("3D Drawing Figure")],
      origins: [menu("3d/mannequin3d")],
    }),
    defineCommand({
      id: "insert.character-3d",
      labels: [ko("3D 캐릭터"), en("3D character")],
      aliases: [csp("3D 소재"), ours("VRM 캐릭터")],
      origins: [menu("3d/char")],
    }),
    defineCommand({
      id: "insert.character-shaper",
      labels: [ko("캐릭터 셰이퍼"), en("Character Shaper")],
      aliases: [ours("3D 캐릭터 작업실"), ours("셰이퍼"), ours("프리셋 캐릭터")],
      origins: [menu("3d/character")],
    }),
    defineCommand({
      id: "insert.background-3d",
      labels: [ko("3D 배경"), en("3D background")],
      aliases: [csp("3D 배경 소재")],
      origins: [menu("3d/bg3d")],
    }),
    defineCommand({
      id: "insert.sculpt-3d",
      labels: [ko("3D 스컬프트"), en("3D sculpt")],
      aliases: [ours("스컬프트 작업대"), krita("Sculpt")],
      origins: [menu("3d/sculpt")],
    }),
    defineCommand({
      id: "insert.page",
      labels: [ko("새 페이지"), en("New page")],
      aliases: [csp("페이지 추가"), ps("New Artboard")],
      origins: [menu("comic/page")],
    }),

    /* ---------------------------------------------------------------- text */
    defineCommand({
      id: "text.add-balloon",
      labels: [ko("말풍선 추가", "기본 대사 말풍선을 현재 페이지에 추가합니다."), en("Add speech balloon")],
      aliases: [csp("말풍선 추가"), ours("대사 말풍선")],
      origins: [radial("add-bubble"), quickAccess("add-bubble")],
      note: "메뉴의 `insert/bubble` 과 같은 결과를 내지만 별도 id 로 유지되고 있다.",
    }),

    /* -------------------------------------------------------------- filter */
    defineCommand({
      id: "filter.last",
      labels: [ko("마지막 필터 다시 열기"), en("Reopen last filter")],
      aliases: [ps("Last Filter"), krita("Repeat Filter")],
      origins: [menu("filter/last-filter")],
    }),
    defineCommand({
      id: "filter.gaussian-blur",
      labels: [filterLabel("gaussian-blur"), en("Gaussian blur")],
      aliases: [csp("가우시안 흐리기"), ps("Gaussian Blur"), krita("Gaussian Blur"), procreate("Gaussian Blur")],
      shortcut: "⌘⇧1",
      origins: [menu("filter/gaussian-blur", { shortcut: "⌘⇧1" })],
    }),
    defineCommand({
      id: "filter.motion-blur",
      labels: [filterLabel("motion-blur"), en("Motion blur")],
      aliases: [csp("이동 흐리기"), ps("Motion Blur"), krita("Motion Blur"), procreate("Motion Blur")],
      shortcut: "⌘⇧2",
      origins: [menu("filter/motion-blur", { shortcut: "⌘⇧2" })],
    }),
    defineCommand({
      id: "filter.hue-saturation-brightness",
      labels: [filterLabel("hue-saturation-brightness"), en("Hue / saturation / brightness")],
      aliases: [csp("색조·채도·명도"), ps("Hue/Saturation"), krita("HSV Adjustment"), procreate("Hue, Saturation, Brightness")],
      shortcut: "⌘⇧3",
      origins: [menu("filter/hue-saturation-brightness", { shortcut: "⌘⇧3" })],
    }),
    defineCommand({
      id: "filter.brightness-contrast",
      labels: [filterLabel("brightness-contrast"), en("Brightness / contrast")],
      aliases: [csp("밝기·대비"), ps("Brightness/Contrast"), krita("Brightness/Contrast")],
      shortcut: "⌘⇧4",
      origins: [menu("filter/brightness-contrast", { shortcut: "⌘⇧4" })],
    }),
    defineCommand({
      id: "filter.color-curves",
      labels: [filterLabel("color-curves"), en("Color curves")],
      aliases: [csp("톤 커브"), ps("Curves"), krita("Color Adjustment Curves"), procreate("Curves")],
      shortcut: "⌘⇧5",
      origins: [menu("filter/color-curves", { shortcut: "⌘⇧5" })],
    }),
    // 아래 둘은 위 필터들과 달리 픽셀을 굽지 않는다 — 선택 레이어의 보정 파라미터를
    // 편집하는 비파괴 경로(§15.3 Filter ▸ Adjustment Layer)로, 인스펙터 보정 패널을 연다.
    defineCommand({
      id: "filter.levels",
      labels: [ko("레이어 보정 · 레벨"), en("Layer adjustment · Levels")],
      aliases: [cspEn("Level Correction"), ps("Levels"), krita("Levels")],
      origins: [menu("filter/levels")],
      note: "검색 코퍼스의 `property.levels` 와 같은 목적지다. 이쪽은 메뉴에서 가는 명령 경로.",
    }),
    defineCommand({
      id: "filter.tone-curve",
      labels: [ko("레이어 보정 · 톤 커브"), en("Layer adjustment · Tone curve")],
      aliases: [cspEn("Tonal Correction"), psKo("곡선"), krita("Color Adjustment Curves")],
      origins: [menu("filter/tone-curve")],
      note: "파괴적 `filter.color-curves`(색상 커브 다이얼로그)와 다른 명령이다 — 이쪽은 레이어 보정.",
    }),
    defineCommand({
      id: "filter.mosaic",
      labels: [filterLabel("mosaic"), en("Mosaic / pixelate")],
      aliases: [csp("모자이크"), ps("Mosaic"), krita("Pixelize")],
      origins: [menu("filter/mosaic")],
    }),
    defineCommand({
      id: "filter.radial-blur",
      labels: [filterLabel("radial-blur"), en("Radial blur")],
      aliases: [csp("방사 흐리기"), ps("Radial Blur"), krita("Lens Blur")],
      origins: [menu("filter/radial-blur")],
    }),
    defineCommand({
      id: "filter.zoom-blur",
      labels: [filterLabel("zoom-blur"), en("Zoom blur")],
      aliases: [csp("줌 흐리기"), ps("Radial Blur · Zoom")],
      origins: [menu("filter/zoom-blur")],
    }),
    defineCommand({
      id: "filter.chromatic-aberration",
      labels: [filterLabel("chromatic-aberration"), en("Chromatic aberration")],
      aliases: [ps("Lens Correction"), procreate("Chromatic Aberration")],
      origins: [menu("filter/chromatic-aberration")],
    }),
    defineCommand({
      id: "filter.glitch",
      labels: [filterLabel("glitch"), en("Glitch")],
      aliases: [procreate("Glitch"), ours("글리치")],
      origins: [menu("filter/glitch")],
    }),
    defineCommand({
      id: "filter.scanline",
      labels: [filterLabel("scanline"), en("Scanline (CRT)")],
      aliases: [ps("Halftone Pattern · Line"), ours("스캔라인")],
      origins: [menu("filter/scanline")],
    }),
    defineCommand({
      id: "filter.vignette",
      labels: [filterLabel("vignette"), en("Vignette")],
      aliases: [ps("Lens Correction · Vignette"), krita("Vignette"), procreate("Vignette")],
      origins: [menu("filter/vignette")],
    }),
    defineCommand({
      id: "filter.lens-flare",
      labels: [filterLabel("lens-flare"), en("Lens flare")],
      aliases: [ps("Lens Flare"), krita("Lens Flare")],
      origins: [menu("filter/lens-flare")],
    }),
    defineCommand({
      id: "filter.emboss",
      labels: [filterLabel("emboss"), en("Emboss")],
      aliases: [csp("엠보스"), ps("Emboss"), krita("Emboss")],
      origins: [menu("filter/emboss")],
    }),
    defineCommand({
      id: "filter.solarize",
      labels: [filterLabel("solarize"), en("Solarize")],
      aliases: [ps("Solarize"), krita("Solarize")],
      origins: [menu("filter/solarize")],
    }),
    defineCommand({
      id: "filter.threshold",
      labels: [filterLabel("threshold"), en("Threshold")],
      aliases: [csp("2치화"), ps("Threshold"), krita("Threshold"), ours("한계값 (흑백 2값)"), ours("먹선 임계값")],
      origins: [menu("filter/threshold")],
    }),
    defineCommand({
      id: "filter.oil-paint",
      labels: [filterLabel("oil-paint"), en("Oil paint")],
      aliases: [ps("Oil Paint"), krita("Oilpaint")],
      origins: [menu("filter/oil-paint")],
    }),
    defineCommand({
      id: "filter.surface-blur",
      labels: [filterLabel("surface-blur"), en("Surface blur")],
      aliases: [ps("Surface Blur"), krita("Edge preserving blur")],
      origins: [menu("filter/surface-blur")],
    }),
    defineCommand({
      id: "filter.lens-blur",
      labels: [filterLabel("lens-blur"), en("Lens blur")],
      aliases: [ps("Lens Blur"), krita("Lens Blur")],
      origins: [menu("filter/lens-blur")],
    }),
    defineCommand({
      id: "filter.field-iris-blur",
      labels: [filterLabel("field-iris-blur"), en("Field / iris blur")],
      aliases: [ps("Iris Blur"), ours("필드 아이리스 블러")],
      origins: [menu("filter/field-iris-blur")],
    }),
    defineCommand({
      id: "filter.tilt-shift-blur",
      labels: [filterLabel("tilt-shift-blur"), en("Tilt-shift blur")],
      aliases: [ps("Tilt-Shift"), procreate("Perspective Blur")],
      origins: [menu("filter/tilt-shift-blur")],
    }),
    defineCommand({
      id: "filter.selective-gaussian-blur",
      labels: [filterLabel("selective-gaussian-blur"), en("Selective Gaussian blur")],
      aliases: [krita("Gaussian Blur · selective")],
      origins: [menu("filter/selective-gaussian-blur")],
    }),
    defineCommand({
      id: "filter.tileable-blur",
      labels: [filterLabel("tileable-blur"), en("Tileable blur")],
      aliases: [krita("Blur · wrap around"), ours("타일러블 블러")],
      origins: [menu("filter/tileable-blur")],
    }),
    defineCommand({
      id: "filter.line-cleanup",
      labels: [filterLabel("line-cleanup"), en("Line art cleanup")],
      aliases: [csp("선화 추출"), ps("Sketch Cleanup")],
      origins: [menu("filter/line-cleanup")],
    }),
    defineCommand({
      id: "filter.screentone-removal",
      labels: [filterLabel("screentone-removal"), en("Screentone removal")],
      aliases: [csp("톤 제거"), ours("스크린톤 제거")],
      origins: [menu("filter/screentone-removal")],
    }),
    defineCommand({
      id: "filter.jpeg-artifact-reduction",
      labels: [filterLabel("jpeg-artifact-reduction"), en("JPEG artifact reduction")],
      aliases: [ps("Reduce Noise · JPEG Artifact"), ours("JPEG 아티팩트 감소")],
      origins: [menu("filter/jpeg-artifact-reduction")],
    }),
    defineCommand({
      id: "filter.edge-aware-denoise",
      labels: [filterLabel("edge-aware-denoise"), en("Edge-aware denoise")],
      aliases: [ps("Reduce Noise"), krita("Wavelet Noise Reducer"), ours("엣지 보존 노이즈 감소")],
      origins: [menu("filter/edge-aware-denoise")],
    }),
    defineCommand({
      id: "filter.dust-scratches",
      labels: [filterLabel("dust-scratches"), en("Dust and scratches")],
      aliases: [ps("Dust & Scratches")],
      origins: [menu("filter/dust-scratches")],
    }),
    defineCommand({
      id: "filter.difference-of-gaussians",
      labels: [filterLabel("difference-of-gaussians"), en("Difference of Gaussians")],
      aliases: [krita("Edge Detection · DoG"), ps("High Pass")],
      origins: [menu("filter/difference-of-gaussians")],
    }),
    defineCommand({
      id: "filter.color-to-alpha",
      labels: [filterLabel("color-to-alpha"), en("Color to alpha")],
      aliases: [krita("Color to Alpha"), ps("Blending Options · Blend If")],
      origins: [menu("filter/color-to-alpha")],
    }),
    defineCommand({
      id: "filter.duotone",
      labels: [filterLabel("duotone"), en("Sepia / duotone")],
      aliases: [ps("Duotone"), krita("Gradient Map")],
      origins: [menu("filter/duotone")],
    }),
    defineCommand({
      id: "filter.noise-add",
      labels: [filterLabel("noise-add"), en("Add noise")],
      aliases: [ps("Add Noise"), krita("Random Noise"), procreate("Noise")],
      origins: [menu("filter/noise-add")],
    }),
    // 필터 유니온 웨이브 16종. 엔진·다이얼로그·검색 메타데이터는 이미 출하돼 있었지만
    // 메뉴 행이 없어 갤러리 검색으로만 도달할 수 있었다 — 이 16개가 그 문이다.
    defineCommand({
      id: "filter.wave-warp",
      labels: [filterLabel("wave-warp"), en("Wave warp")],
      aliases: [ps("Wave"), krita("Wave"), ours("사인 웨이브")],
      origins: [menu("filter/wave-warp")],
    }),
    defineCommand({
      id: "filter.ripple-warp",
      labels: [filterLabel("ripple-warp"), en("Ripple warp")],
      aliases: [ps("Ripple"), krita("Ripple"), ours("원형 리플")],
      origins: [menu("filter/ripple-warp")],
    }),
    defineCommand({
      id: "filter.fisheye",
      labels: [filterLabel("fisheye"), en("Fisheye")],
      aliases: [ps("Spherize"), krita("Lens Correction · barrel")],
      origins: [menu("filter/fisheye")],
    }),
    defineCommand({
      id: "filter.twirl",
      labels: [filterLabel("twirl"), en("Twirl")],
      aliases: [ps("Twirl"), krita("Twirl"), ours("트월 회전")],
      origins: [menu("filter/twirl")],
    }),
    defineCommand({
      id: "filter.pinch-bloat",
      labels: [filterLabel("pinch-bloat"), en("Pinch / bloat")],
      aliases: [ps("Pinch"), ours("핀치 · 블로트"), ours("핀치 / 블로트")],
      origins: [menu("filter/pinch-bloat")],
    }),
    defineCommand({
      id: "filter.lens-distortion",
      labels: [filterLabel("lens-distortion"), en("Lens distortion")],
      aliases: [ps("Lens Correction"), krita("Lens Correction")],
      origins: [menu("filter/lens-distortion")],
    }),
    defineCommand({
      id: "filter.film-grain-pro",
      labels: [filterLabel("film-grain-pro"), en("Cinema film grain")],
      aliases: [ps("Film Grain"), krita("Film Grain")],
      origins: [menu("filter/film-grain-pro")],
    }),
    defineCommand({
      id: "filter.salt-pepper",
      labels: [filterLabel("salt-pepper"), en("Salt and pepper noise")],
      aliases: [krita("Random Pick"), ours("소금 후추 노이즈")],
      origins: [menu("filter/salt-pepper")],
    }),
    defineCommand({
      id: "filter.rgb-noise",
      labels: [filterLabel("rgb-noise"), en("RGB channel noise")],
      aliases: [krita("Noise · RGB"), ours("채널 노이즈")],
      origins: [menu("filter/rgb-noise")],
    }),
    defineCommand({
      id: "filter.perlin-texture",
      labels: [filterLabel("perlin-texture"), en("Fractal value texture")],
      aliases: [ps("Clouds · Difference"), krita("Pattern · fractal")],
      origins: [menu("filter/perlin-texture")],
    }),
    defineCommand({
      id: "filter.pointillize",
      labels: [filterLabel("pointillize"), en("Pointillize")],
      aliases: [ps("Pointillize"), krita("Halftone · dots"), ours("포인틸리즘")],
      origins: [menu("filter/pointillize")],
    }),
    defineCommand({
      id: "filter.stained-glass",
      labels: [filterLabel("stained-glass"), en("Stained glass")],
      aliases: [ps("Stained Glass"), krita("Halftone · cells")],
      origins: [menu("filter/stained-glass")],
    }),
    defineCommand({
      id: "filter.poster-edges",
      labels: [filterLabel("poster-edges"), en("Poster edges")],
      aliases: [ps("Poster Edges"), csp("포스터화")],
      origins: [menu("filter/poster-edges")],
    }),
    defineCommand({
      id: "filter.photocopy",
      labels: [filterLabel("photocopy"), en("Photocopy")],
      aliases: [ps("Photocopy"), krita("Threshold · high contrast"), ours("고대비 포토카피")],
      origins: [menu("filter/photocopy")],
    }),
    defineCommand({
      id: "filter.normal-map",
      labels: [filterLabel("normal-map"), en("Normal map")],
      aliases: [ps("Generate Normal Map"), krita("Height to Normal Map")],
      origins: [menu("filter/normal-map")],
    }),
    defineCommand({
      id: "filter.god-rays",
      labels: [filterLabel("god-rays"), en("God rays")],
      aliases: [ps("Radial Blur · zoom light"), ours("갓 레이"), ours("볼류메트릭 광선")],
      origins: [menu("filter/god-rays")],
    }),
    defineCommand({
      id: "filter.polar-coordinates",
      labels: [filterLabel("polar-coordinates"), en("Polar coordinates")],
      aliases: [csp("극좌표"), ps("Polar Coordinates"), krita("Polar Coordinates")],
      origins: [menu("filter/polar-coordinates")],
    }),

    /* ------------------------------------------------------------------ ai */
    defineCommand({
      id: "ai.assist",
      labels: [ko("AI 어시스트"), en("AI assist")],
      aliases: [ps("Generative Fill"), ours("AI 어시스트")],
      origins: [menu("ai/ai-assist")],
    }),
    defineCommand({
      id: "ai.stock-images",
      labels: [ko("스톡 이미지"), en("Stock images")],
      aliases: [ps("Adobe Stock")],
      origins: [menu("ai/stock")],
    }),
    defineCommand({
      id: "ai.integrations",
      labels: [ko("연동 설정"), en("Integrations")],
      aliases: [ours("연동 설정")],
      origins: [menu("ai/integrations")],
    }),

    /* ---------------------------------------------------------------- help */
    defineCommand({
      id: "help.feature-tutorials",
      labels: [ko("사용법 · 기능 튜토리얼"), en("Feature tutorials")],
      aliases: [csp("사용법"), ps("Learn"), krita("Tutorials")],
      origins: [menu("help/feature-tutorials")],
    }),
    defineCommand({
      id: "help.shortcuts",
      labels: [ko("단축키 · 기본 조작"), en("Shortcuts")],
      aliases: [csp("단축키 설정"), ps("Keyboard Shortcuts"), krita("Configure Shortcuts"), procreate("Gesture Controls")],
      shortcut: "?",
      origins: [
        menu("help/shortcuts", { shortcut: "?" }),
        keymap("shortcuts-help", { shortcut: "?" }),
        help("view.help", { shortcut: "?" }),
      ],
    }),
    defineCommand({
      id: "help.command-search",
      labels: [
        ko("명령 · 속성 통합 검색", "명령·속성·패널·튜토리얼을 한 색인에서 찾습니다."),
        en("Command search"),
      ],
      aliases: [
        csp("명령 검색"),
        cspEn("Command Search"),
        ps("Search"),
        krita("Search Actions"),
        procreate("빠른 메뉴"),
      ],
      shortcut: "F1",
      origins: [menu("help/command-search", { shortcut: "F1" })],
      note: "다이얼로그와 F1 바인딩은 Wave D 가 출하했고, 이 항목이 메뉴 진입점을 낸다.",
    }),
    defineCommand({
      id: "help.terminology-search",
      labels: [
        ko("CSP · Photoshop 용어 찾기", "쓰던 프로그램의 이름이 우리 쪽에서 무엇이 됐는지 훑어봅니다."),
        en("Vendor terminology dictionary"),
      ],
      aliases: [csp("용어"), ps("Terminology"), krita("Terminology")],
      origins: [menu("help/terminology-search")],
    }),
    defineCommand({
      id: "help.current-tool",
      labels: [
        ko("현재 도구 도움말", "지금 캔버스를 쥐고 있는 도구의 단축키·별칭·관련 기능을 봅니다."),
        en("Current tool help"),
      ],
      aliases: [csp("도구 설명"), ps("Tool Help"), krita("Tool Options Help")],
      origins: [menu("help/current-tool")],
      note: "산문 도움말(HelpGraph)이 아직 없어 카탈로그 실측 정보만 보여 준다.",
    }),
    defineCommand({
      id: "help.diagnostics",
      labels: [
        ko("기기 · 브라우저 진단", "WebGPU·저장소·안전 모드 상태를 실측값으로 확인합니다."),
        en("Device and browser diagnosis"),
      ],
      aliases: [ps("System Info"), krita("System Information"), ours("진단")],
      origins: [menu("help/diagnostics")],
    }),
    defineCommand({
      id: "help.recovery",
      labels: [
        ko("복구 가이드", "임시저장·체크포인트·저장 권위 상태와 지금 할 수 있는 조치를 봅니다."),
        en("Recovery guide"),
      ],
      aliases: [csp("복구"), ps("Recovery"), ours("복구 센터")],
      origins: [menu("help/recovery")],
    }),
    defineCommand({
      id: "help.licenses",
      labels: [
        ko("라이선스 · 서드파티 고지", "빌드가 생성한 오픈소스 고지와 엔진 라이선스 게이트 판정을 봅니다."),
        en("License and attribution"),
      ],
      aliases: [ps("Legal Notices"), krita("Show license text"), ours("서드파티 고지")],
      origins: [menu("help/licenses")],
    }),
    defineCommand({
      id: "help.bug-report",
      labels: [
        ko("버그 리포트 패키지", "진단 실측값과 이번 세션 오류를 개인정보 없이 묶어 복사·저장합니다."),
        en("Bug report package"),
      ],
      aliases: [ps("Report a Problem"), krita("Report Bug"), ours("버그 신고")],
      origins: [menu("help/bug-report")],
    }),

    /* ------------------------------------------- shipped-but-doorless (E) */
    /*
     * Wave E. Every entry below names a surface the product already ships and
     * the menubar could not reach: the 프로젝트 센터 sheet's five panels, the
     * animation timeline, the team/review flow and the story room. None of them
     * is a new feature; each is a new door, so the origin list is `menu` only.
     */
    defineCommand({
      id: "file.quick-start",
      labels: [ko("빠른 시작 · 새 작업", "템플릿과 웹툰 마법사로 새 작업을 시작합니다."), en("Quick start")],
      aliases: [csp("새로 만들기"), ps("New"), krita("New File"), ours("빠른 시작")],
      origins: [menu("file/quick-start")],
    }),
    defineCommand({
      id: "file.checkpoints",
      labels: [ko("버전 체크포인트", "이름 있는 복구 지점을 만들고 이전 시점과 비교·복원합니다."), en("Version checkpoints")],
      aliases: [csp("작품 이력"), ps("History Snapshot"), krita("Save Incremental Version"), ours("버전")],
      origins: [menu("file/checkpoints")],
    }),
    defineCommand({
      id: "file.publish-preflight",
      labels: [ko("게시 사전검사"), en("Publish preflight")],
      aliases: [ps("Preflight"), ours("게시 사전검사")],
      origins: [menu("file/publish-preflight")],
    }),
    defineCommand({
      id: "file.publish-package",
      labels: [ko("게시 패키지"), en("Publish package")],
      aliases: [csp("작품 내보내기"), ps("Package"), ours("게시 패키지")],
      origins: [menu("file/publish-package")],
    }),
    defineCommand({
      id: "file.rights-manifest",
      labels: [ko("에셋 권리 감사", "출처·라이선스·경고를 한 표로 모아 내보냅니다."), en("Asset rights audit")],
      aliases: [ps("Credits"), ours("에셋 권리 감사")],
      origins: [menu("file/rights-manifest")],
    }),
    defineCommand({
      id: "edit.auto-actions",
      labels: [ko("자동 액션 · 매크로", "액션 세트를 편집·적용하고 매크로를 녹음합니다."), en("Auto actions and macros")],
      aliases: [csp("오토 액션"), ps("Actions"), krita("Recorder"), procreate("Actions")],
      origins: [menu("edit/auto-actions")],
    }),
    defineCommand({
      id: "view.navigator",
      labels: [ko("미니맵 · 탐색"), en("Navigator")],
      aliases: [csp("내비게이터"), ps("Navigator"), krita("Overview Docker")],
      origins: [menu("view/navigator")],
    }),
    defineCommand({
      id: "view.underlay",
      labels: [ko("밑그림 오버레이", "이메레스 밑그림을 반투명 잠금 레이어로 깝니다."), en("Sketch underlay")],
      aliases: [csp("밑그림"), ps("Template Layer"), krita("Reference Images"), ours("이메레스")],
      origins: [menu("view/underlay")],
    }),
    defineCommand({
      id: "canvas.document-settings",
      labels: [ko("캔버스 크기 · 문서 설정"), en("Canvas size and document settings")],
      aliases: [csp("캔버스 사이즈 변경"), ps("Canvas Size"), krita("Resize Canvas"), procreate("Canvas")],
      origins: [menu("canvas/canvas-settings")],
    }),
    defineCommand({
      id: "canvas.grid",
      labels: [ko("그리드"), en("Grid")],
      aliases: [csp("그리드"), ps("Show Grid"), krita("Show Grid"), procreate("Drawing Guide")],
      origins: [menu("canvas/grid")],
    }),
    defineCommand({
      id: "canvas.sticky-note",
      labels: [ko("스티키 노트"), en("Sticky note")],
      aliases: [ours("스티키"), ps("Note")],
      origins: [menu("canvas/sticky-note")],
    }),
    defineCommand({
      id: "vector.erase-to-intersection",
      labels: [ko("교차점까지 지우기"), en("Erase to intersection")],
      aliases: [csp("교점까지"), krita("Vector Eraser"), ours("교차점까지 지우기")],
      origins: [menu("vector/erase-to-intersection")],
    }),
    defineCommand({
      id: "text.dialogue-batch",
      labels: [ko("대사 일괄 편집", "대사를 한 표에서 나누고 합치고 루비를 답니다."), en("Batch dialogue editing")],
      aliases: [csp("스토리 에디터"), ps("Paragraph Text"), ours("배치 대사 편집")],
      origins: [menu("text/dialogue-batch")],
    }),
    defineCommand({
      id: "text.dialogue-translate",
      labels: [ko("대사 번역 · 다국어"), en("Dialogue translation")],
      aliases: [ours("대사 번역"), ps("Translate")],
      origins: [menu("text/dialogue-translate")],
    }),
    defineCommand({
      id: "text.localization-qa",
      labels: [
        ko(
          "현지화 QA · 넘침·문체 검사",
          "번역 대사의 말풍선 넘침과 영문 레터링 문체를 검사해 MQM 품질 점수를 냅니다.",
        ),
        en("Localization QA"),
      ],
      aliases: [ours("현지화 QA"), ours("번역 검수"), ours("넘침 보고서")],
      origins: [menu("text/localization-qa")],
    }),
    defineCommand({
      id: "comic.tone",
      labels: [ko("톤 · 스크린톤"), en("Screentone library")],
      aliases: [csp("톤"), ps("Halftone Pattern"), krita("Screentone"), ours("톤")],
      origins: [menu("comic/tone")],
    }),
    defineCommand({
      id: "comic.writer-room",
      labels: [ko("Writer Room · 대본"), en("Writer Room")],
      aliases: [csp("스토리 에디터"), ours("Writer Room")],
      origins: [menu("comic/writer-room")],
    }),
    defineCommand({
      id: "comic.storyboard",
      labels: [ko("스토리보드 그리드", "회차 전체를 격자로 보고 샷·카메라 태그를 붙입니다."), en("Storyboard grid")],
      aliases: [ps("Contact Sheet"), ours("스토리보드 그리드")],
      origins: [menu("comic/storyboard")],
    }),
    defineCommand({
      id: "comic.story-bible",
      labels: [ko("제작 바이블", "설정과 약속·회수 원장을 한 곳에서 관리합니다."), en("Production bible")],
      aliases: [ours("제작 바이블")],
      origins: [menu("comic/story-bible")],
    }),
    defineCommand({
      id: "comic.continuity",
      labels: [ko("마감·품질 검사"), en("Finishing quality inspection")],
      aliases: [
        ours("연속성 검사"),
        ours("이야기 연속성 검사"),
        ours("마감 검사"),
        ours("품질 검사"),
      ],
      origins: [menu("comic/continuity")],
    }),
    defineCommand({
      id: "comic.scroll-preview",
      labels: [ko("세로 스크롤 미리보기"), en("Vertical scroll preview")],
      aliases: [ours("세로 스크롤 미리보기")],
      origins: [menu("comic/scroll-preview")],
    }),
    defineCommand({
      id: "comic.animatic",
      labels: [ko("애니매틱 타임라인", "컷 길이와 카메라 이동을 미리 재생합니다."), en("Animatic timeline")],
      aliases: [ours("애니매틱")],
      origins: [menu("comic/animatic")],
    }),
    defineCommand({
      id: "comic.webtoon-assistant",
      labels: [
        ko(
          "웹툰 창작 보조 센터",
          "플랫폼 규격 검사, 자동 슬라이서, 스크롤 페이싱, 효과음 사전, 컬러 조화, 포커스 타이머를 제공합니다.",
        ),
        en("Webtoon Creator Assistant"),
      ],
      aliases: [ours("웹툰 보조 툴킷"), ours("웹툰 어시스턴트")],
      origins: [menu("comic/webtoon-assistant")],
    }),
    defineCommand({
      id: "comic.ai-super-suite",
      labels: [
        ko(
          "AI 웹툰 생성 슈퍼 스위트",
          "네이버 툰필터 화풍 변환, CSP 음영 어시스트, 고화질 프롬프트 증강, TooNat 콘티 디렉터, 투닝 감정 말풍선을 제공합니다.",
        ),
        en("Webtoon AI Super Suite"),
      ],
      aliases: [ours("AI 슈퍼 스위트"), ours("툰필터"), ours("AI 음영"), ours("AI 콘티")],
      origins: [menu("comic/ai-super-suite")],
    }),
    defineCommand({
      id: "animation.timeline",
      labels: [ko("타임라인", "여러 레이어의 키프레임을 한 타임라인에서 다룹니다."), en("Animation timeline")],
      aliases: [csp("타임라인"), ps("Timeline"), krita("Animation Timeline"), procreate("Animation Assist")],
      origins: [menu("animation/timeline")],
    }),
    defineCommand({
      id: "animation.frame-cel",
      labels: [ko("프레임 애니메이션", "선택한 이미지의 프레임을 편집하고 GIF·APNG·WebM 으로 내보냅니다."), en("Frame animation")],
      aliases: [csp("애니메이션 셀"), ps("Frame Animation"), krita("Animation Docker")],
      origins: [menu("animation/frame-anim")],
    }),
    defineCommand({
      id: "animation.onion-skin",
      labels: [ko("어니언 스킨"), en("Onion skin")],
      aliases: [csp("오니언 스킨"), ps("Onion Skins"), krita("Onion Skins"), procreate("Onion Skin")],
      origins: [menu("animation/onion-skin")],
    }),
    defineCommand({
      id: "collaboration.team",
      labels: [ko("팀 · 공유 권한", "멤버·초대·권한과 라이브 세션을 엽니다."), en("Team and sharing")],
      aliases: [ps("Share"), ours("팀 작업공간")],
      origins: [menu("collaboration/team")],
      note: "데스크톱에서 라이브 세션이 없으면 이 패널은 메뉴 이전까지 열 방법이 없었다.",
    }),
    defineCommand({
      id: "collaboration.comments",
      labels: [ko("댓글 패널"), en("Comments panel")],
      aliases: [ps("Comments"), ours("댓글")],
      origins: [menu("collaboration/comments")],
      note: "위치 댓글 핀 배치는 별도 명령(`tool.comment`, ⌥C)이다.",
    }),
    defineCommand({
      id: "collaboration.page-review",
      labels: [ko("페이지 검토 · 승인"), en("Page review and approval")],
      aliases: [ps("Review"), ours("페이지 검토")],
      origins: [menu("collaboration/page-review")],
    }),
    defineCommand({
      id: "collaboration.ephemeral-board",
      labels: [ko("빠른 화이트보드"), en("Quick whiteboard")],
      aliases: [ours("휘발 보드")],
      origins: [menu("collaboration/ephemeral-board")],
    }),
  ]);

/* --------------------------------------------------------------- conflicts */

/**
 * Every disagreement the five lists have with each other, measured rather than
 * inferred. The shortcut-uniqueness test allows a collision **only** when it is
 * declared here, so silently adding a clashing chord fails the suite.
 */
export const COMMAND_CONFLICTS: readonly StudioCommandConflict[] = Object.freeze([
  {
    id: "shift-s-saveview-vs-sizelock",
    kind: "shortcut-collision",
    key: "⇧S",
    commandIds: ["view.save-current-view"],
    detail:
      "view 리졸버(보기 저장)와 drawing 리졸버(크기 잠금)가 `⇧S` 를 동시에 주장하고 view 가 먼저 실행되므로 크기 잠금은 도달 불가 dead code 다.",
    evidence: [
      "studio-view-controls.ts:698 (보기 저장)",
      "studio-drawing-shortcuts.ts:259 (크기 잠금 — 도달 불가)",
    ],
    resolution:
      "크기 잠금은 아직 카탈로그 명령이 아니다. 키맵 흡수 시 단일 리졸버가 되면 충돌이 컴파일 타임에 드러나므로 그 시점에 크기 잠금에 별도 chord 를 배정한다.",
  },
  {
    id: "cmd-d-duplicate-vs-deselect",
    kind: "shortcut-collision",
    key: "⌘D",
    commandIds: ["edit.duplicate", "select.deselect"],
    detail:
      "빠른 액세스 팔레트는 복제를 `⌘D` 로 광고하지만, 메뉴·키맵·도움말은 `⌘D` 를 선택 해제에 배정한다. 메뉴의 복제는 `⌘J` 다.",
    evidence: [
      "studio-quick-access-integration.ts:155-161 (duplicate, ⌘D)",
      "studio-edit-controls.ts:56 (deselect, ⌘D)",
      "studio-edit-controls.ts:71 (duplicate, ⌘J)",
      "studio-app-settings.ts:106 (deselect-pixels, Mod+D)",
    ],
    resolution:
      "팔레트 흡수(3단계)에서 팔레트 표기를 `⌘J` 로 정정한다. 카탈로그의 정본은 edit.duplicate=⌘J, select.deselect=⌘D.",
  },
  {
    id: "cmd-j-duplicate-layer-vs-edit",
    kind: "shortcut-collision",
    key: "⌘J",
    commandIds: ["edit.duplicate", "layer.duplicate"],
    detail:
      "Photoshop/CSP 관례에 따라 `⌘J` 는 선택/레이어 복제에 공통으로 바인딩되어 있으며, 선택 요소가 있으면 요소 복제, 없으면 활성 레이어 복제로 동작한다.",
    evidence: [
      "studio-edit-controls.ts:71 (edit.duplicate, ⌘J)",
      "studio-app-settings.ts:118 (duplicate-layer, Mod+J)",
    ],
    resolution:
      "컨텍스트 인식 디스패처가 선택 유무에 따라 요소 복제와 레이어 복제로 분기한다.",
  },
  {
    id: "c-crop-vs-transparent",
    kind: "shortcut-collision",
    key: "C",
    commandIds: ["tool.crop", "color.toggle-transparent"],
    detail:
      "`C` 단축키는 포토샵 자르기(Crop) 툴과 클립스튜디오 투명색(Transparent) 그리기 모드에 동시 정의되어 있다. 드로잉 캔버스 포커스 시 투명색 모드로 전환된다.",
    evidence: [
      "studio-app-settings.ts:95 (tool-crop, C)",
      "studio-app-settings.ts:115 (toggle-transparent-color, C)",
      "studio-drawing-shortcuts.ts:76 (toggle-transparent-color, C)",
    ],
    resolution:
      "드로잉/브러시 활성 시에는 투명색 그리기가 우선되며, 선택 모드에서는 자르기 툴이 동작하도록 컨텍스트 기반으로 분기한다.",
  },
  {
    id: "delete-clear-vs-remove",
    kind: "behavior-divergence",
    key: "Delete",
    commandIds: ["edit.clear-selection", "edit.delete-selection"],
    detail:
      "`Delete` 키 경로만 말풍선 포인트 / 픽셀 영역 / 엘리먼트 3분기를 갖는다. 메뉴의 `선택 제거`(내용 지우기)와 팔레트·라디얼의 `선택 삭제`(요소 삭제)가 다른 결과를 낸다.",
    evidence: [
      "StudioPage.tsx:24030-24058 (키보드 3분기)",
      "studio-edit-controls.ts:64 (clear-selection, Delete)",
      "studio-quick-access-integration.ts:163-169 (delete, Delete)",
    ],
    resolution:
      "두 명령을 분리 유지하고, `Delete` 는 컨텍스트에 따라 둘 중 하나로 라우팅하는 단일 디스패처를 둔다. 메뉴·팔레트 라벨을 '내용 지우기' / '요소 삭제'로 구분한다.",
  },
  {
    id: "zoom-chord-divergence",
    kind: "shortcut-divergence",
    commandIds: ["view.zoom-in", "view.zoom-out", "view.fit-width"],
    detail:
      "메뉴는 확대·축소를 `=`/`-`, 화면 맞춤을 `Home` 으로 문서화하는데 도움말은 `⌘ +`/`⌘ −`/`⌘ 0` 으로 문서화한다. 같은 명령의 두 문서가 다르다.",
    evidence: [
      "studio-main-menu-groups.ts:603,613,662",
      "StudioShortcutsHelp.tsx:128,129,130",
    ],
    resolution:
      "키맵 흡수(1단계)에서 실제 바인딩을 계측해 정본을 정하고, 메뉴·도움말이 카탈로그의 `shortcut` 을 렌더하도록 바꾼다(수기 문자열 제거).",
  },
  {
    id: "cmd-s-unbound",
    kind: "unbound-shortcut",
    key: "⌘S",
    commandIds: ["file.save-draft"],
    detail:
      "메뉴와 빠른 액세스 deck 이 모두 `⌘S` 를 표시하지만 `KeyS`+meta 핸들러가 없다. 합성 keydown 결과 defaultPrevented=false 로 재확인됐다.",
    evidence: [
      "studio-main-menu-groups.ts:237",
      "studio-quick-access-integration.ts:85-92",
    ],
    resolution:
      "키맵 흡수(1단계)에서 바인딩을 추가하거나 표기를 제거한다. 표기만 남기는 선택지는 금지한다.",
  },
  {
    id: "dead-keymap-entries",
    kind: "dead-entry",
    commandIds: ["edit.undo", "edit.redo", "tool.hand"],
    detail:
      "커스터마이즈 키맵의 `undo`·`redo`·`tool-hand` 3개는 설정에서 바꿔도 아무 일도 일어나지 않는다. 실제 처리는 StudioPage 하드코딩이다.",
    evidence: [
      "studio-app-settings.ts:104 (undo)",
      "studio-app-settings.ts:105 (redo)",
      "studio-app-settings.ts:85 (tool-hand)",
      "StudioPage.tsx:23821 (하드코딩 undo)",
    ],
    resolution:
      "키맵 흡수(1단계)의 첫 작업. 레지스트리가 chord→CommandId 를 단일 소스로 갖게 되면 dead 엔트리는 구조적으로 불가능해진다.",
  },
  {
    id: "eyedropper-toggle-divergence",
    kind: "behavior-divergence",
    commandIds: ["tool.eyedropper"],
    detail:
      "키보드 `I` 와 툴레일은 토글이고, Quick Deck·라디얼은 항상 ON 이다. 같은 명령이 진입점에 따라 다르게 동작한다.",
    evidence: [
      "StudioPage.tsx:23581-23586 (키보드 토글)",
      "StudioLeftToolRail.tsx:787-793 (툴레일 토글)",
      "StudioPage.tsx:23117-23119 (라디얼 항상 ON)",
    ],
    resolution:
      "라디얼 흡수(4단계)에서 토글 시맨틱으로 통일한다. 스포이드는 '집고 원래 도구로 복귀'가 CSP·Procreate 공통 기대다.",
  },
  {
    id: "fill-id-divergence",
    kind: "id-divergence",
    commandIds: ["tool.fill"],
    detail:
      "같은 채우기 명령을 키맵은 `tool-fill`, 메뉴는 `draw/fill`, 팔레트는 `fill`, 라디얼은 `advanced-fill` 로 부른다.",
    evidence: [
      "studio-app-settings.ts:88",
      "studio-main-menu-groups.ts:1025",
      "studio-quick-access-integration.ts:15",
      "studio-quick-actions.ts:32 (advanced-fill)",
    ],
    resolution: "`tool.fill` 로 수렴. 라디얼의 `advanced-fill` 은 alias 로만 남긴다.",
  },
  {
    id: "balloon-id-divergence",
    kind: "id-divergence",
    commandIds: ["insert.balloon", "text.add-balloon"],
    detail:
      "메뉴 `insert/bubble` 과 라디얼·팔레트 `add-bubble` 이 같은 결과를 내지만 별도 id 로 유지된다.",
    evidence: [
      "studio-main-menu-groups.ts:528",
      "studio-quick-actions.ts:30",
      "studio-quick-access-integration.ts:24",
    ],
    resolution:
      "`text.add-balloon` 으로 수렴하고 메뉴 항목은 같은 명령을 가리키게 한다. §15.3 은 말풍선을 Text & Balloon 그룹에 둔다.",
  },
  {
    id: "transform-tool-vs-pixel",
    kind: "id-divergence",
    commandIds: ["tool.transform", "transform.pixel-selection"],
    detail:
      "키맵의 `tool-transform`(⇧T, 변형 도구)과 팔레트의 `transform`(픽셀 선택 변형)이 같은 단어를 쓰지만 다른 명령이다.",
    evidence: [
      "studio-app-settings.ts:95",
      "studio-quick-access-integration.ts:129-136",
    ],
    resolution:
      "라벨을 '변형 도구' / '픽셀 선택 변형'으로 명시 분리하고 팔레트 표기를 바꾼다.",
  },
  {
    id: "help-row-multiplexing",
    kind: "row-covers-multiple-commands",
    commandIds: [
      "tool.smudge",
      "tool.wet-mix",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "edit.paste-in-place",
      "layer.bring-front",
      "layer.bring-forward",
      "layer.send-back",
      "layer.send-backward",
      "brush.size-decrease",
      "brush.size-increase",
    ],
    detail:
      "도움말 37행 중 6행이 두 명령을 한 줄에 겸한다(`N · ⇧N`, `⌘X · ⌘C`, `⌘V · ⌘⇧V`, `⌘] · ⌘⇧]`, `⌘[ · ⌘⇧[`, `[ · ]`). 그래서 도움말 행 수(37)와 명령 수는 1:1 이 아니다.",
    evidence: [
      "StudioShortcutsHelp.tsx:49-55,63-66,91,92,111,112",
    ],
    resolution:
      "도움말이 카탈로그에서 렌더되면 행 병합은 표시 레이어의 결정이 된다. 병합 규칙을 `shortcut` 값에서 파생하도록 만든다.",
  },
]);

/**
 * Source rows that intentionally have **no** catalog entry, with the reason.
 * Empty means the five lists are 100% covered; the coverage test asserts that
 * every uncovered row is listed here rather than silently dropped.
 */
export const STUDIO_COMMAND_CATALOG_UNCOVERED: readonly {
  source: StudioCommandSource;
  nativeId: string;
  reason: string;
}[] = Object.freeze([]);

/* ----------------------------------------------------------------- lookups */

/** Catalog entries that claim the given source list row. */
export function findCatalogEntriesBySource(
  source: StudioCommandSource,
  nativeId: string,
): StudioCommandCatalogEntry[] {
  return STUDIO_COMMAND_CATALOG.filter((entry) =>
    entry.origins.some(
      (origin) => origin.source === source && origin.nativeId === nativeId,
    ),
  );
}

/** All native ids the catalog claims for a source list, deduplicated. */
export function catalogNativeIds(source: StudioCommandSource): string[] {
  const ids = new Set<string>();
  for (const entry of STUDIO_COMMAND_CATALOG) {
    for (const origin of entry.origins) {
      if (origin.source === source) ids.add(origin.nativeId);
    }
  }
  return [...ids];
}

/** Canonical chord → command ids. Only conflicts declared above may repeat. */
export function catalogShortcutIndex(): Map<string, CommandId[]> {
  const index = new Map<string, CommandId[]>();
  for (const entry of STUDIO_COMMAND_CATALOG) {
    if (!entry.shortcut) continue;
    const bucket = index.get(entry.shortcut);
    if (bucket) bucket.push(entry.id);
    else index.set(entry.shortcut, [entry.id]);
  }
  return index;
}
