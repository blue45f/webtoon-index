import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_EDIT_MENU_COMMAND_ORDER,
  STUDIO_EDIT_MENU_COMMANDS,
} from "./studio-edit-controls";
import {
  resolveStudioMainMenuItemIndex,
  StudioMainMenu,
  type StudioMainMenuGroup,
} from "./StudioMainMenu";
import mainMenuSource from "./StudioMainMenu.tsx?raw";

/** Mirrors production IA labels from StudioPage `studioMainMenuGroups` (structure only). */
const PRODUCTION_MENU_CATALOG: StudioMainMenuGroup[] = [
  {
    id: "file",
    label: "파일",
    items: [
      { id: "save-draft", label: "초안 저장", shortcut: "⌘S", onSelect: vi.fn() },
      { id: "publish", label: "게시", onSelect: vi.fn(), separatorAfter: true },
      { id: "import-json", label: "프로젝트 가져오기…", onSelect: vi.fn() },
      { id: "import-psd", label: "PSD 가져오기…", onSelect: vi.fn() },
      { id: "import-ora-cbz", label: "ORA · CBZ · WILL 가져오기…", onSelect: vi.fn(), separatorAfter: true },
      { id: "project", label: "프로젝트 센터…", onSelect: vi.fn(), separatorAfter: true },
      { id: "export", label: "내보내기 / 다운로드", onSelect: vi.fn() },
      { id: "copy-image", label: "이미지를 클립보드로", onSelect: vi.fn(), separatorAfter: true },
      { id: "export-json", label: "백업 (.json)", onSelect: vi.fn() },
      { id: "export-archive", label: "아카이브 백업", onSelect: vi.fn() },
    ],
  },
  {
    id: "edit",
    label: "편집",
    items: [
      { ...STUDIO_EDIT_MENU_COMMANDS.undo, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS.redo, onSelect: vi.fn(), separatorAfter: true },
      { ...STUDIO_EDIT_MENU_COMMANDS.cut, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS.copy, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS.paste, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["paste-in-place"], onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["paste-file"], onSelect: vi.fn(), separatorAfter: true },
      { ...STUDIO_EDIT_MENU_COMMANDS["select-all"], onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS.deselect, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["invert-selection"], onSelect: vi.fn() },
      {
        ...STUDIO_EDIT_MENU_COMMANDS["clear-selection"],
        onSelect: vi.fn(),
        danger: true,
        separatorAfter: true,
      },
      { ...STUDIO_EDIT_MENU_COMMANDS.duplicate, onSelect: vi.fn(), separatorAfter: true },
      { ...STUDIO_EDIT_MENU_COMMANDS["bring-front"], onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["bring-forward"], onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["send-back"], onSelect: vi.fn() },
      {
        ...STUDIO_EDIT_MENU_COMMANDS["send-backward"],
        onSelect: vi.fn(),
        separatorAfter: true,
      },
      { ...STUDIO_EDIT_MENU_COMMANDS["crop-layer"], onSelect: vi.fn(), separatorAfter: true },
      { ...STUDIO_EDIT_MENU_COMMANDS.history, onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["pen-pressure"], onSelect: vi.fn() },
      { ...STUDIO_EDIT_MENU_COMMANDS["app-settings"], onSelect: vi.fn() },
    ],
  },
  {
    id: "insert",
    label: "삽입",
    items: [
      { id: "template", label: "템플릿 · 에셋", onSelect: vi.fn() },
      { id: "bubble", label: "말풍선", onSelect: vi.fn() },
      { id: "text", label: "텍스트", onSelect: vi.fn() },
      { id: "image", label: "이미지…", onSelect: vi.fn(), separatorAfter: true },
      { id: "char", label: "3D 캐릭터", onSelect: vi.fn() },
      { id: "bg3d", label: "3D 배경", onSelect: vi.fn() },
      { id: "ref", label: "참고 이미지", onSelect: vi.fn() },
      { id: "page", label: "새 페이지", onSelect: vi.fn() },
    ],
  },
  {
    id: "view",
    label: "보기",
    items: [
      { id: "zoom-in", label: "확대", shortcut: "=", onSelect: vi.fn() },
      { id: "zoom-out", label: "축소", shortcut: "-", onSelect: vi.fn() },
      { id: "flip-horizontal", label: "수평 반전", shortcut: "H", checked: false, onSelect: vi.fn() },
      { id: "fit", label: "화면에 맞게 조정", shortcut: "Home", onSelect: vi.fn() },
      { id: "actual-pixels", label: "실제 픽셀 (100%)", shortcut: "End", onSelect: vi.fn(), separatorAfter: true },
      { id: "fullscreen", label: "전체화면", shortcut: "F11", checked: false, onSelect: vi.fn() },
      { id: "grayscale", label: "흑백으로 표시", shortcut: "Q", checked: false, onSelect: vi.fn() },
      { id: "reference-window", label: "참고 이미지 창 열기", checked: false, onSelect: vi.fn(), separatorAfter: true },
      { id: "save-current-view", label: "현재 보기 저장", shortcut: "⇧S", onSelect: vi.fn() },
      { id: "restore-view", label: "보기 복원", shortcut: "⇧Z", disabled: true, onSelect: vi.fn(), separatorAfter: true },
      { id: "perspective-guide", label: "원근 도우미 보기", shortcut: "⇧G", checked: false, onSelect: vi.fn() },
      { id: "reset-local-visibility", label: "나만 숨긴 레이어 모두 표시", disabled: true, onSelect: vi.fn() },
      { id: "production-insights", label: "제작 인사이트…", onSelect: vi.fn(), separatorAfter: true },
      { id: "density-focus", label: "슈퍼심플 레이아웃", onSelect: vi.fn() },
      { id: "density-full", label: "전체 레이아웃", onSelect: vi.fn() },
      { id: "wide", label: "패널 접어 넓게", onSelect: vi.fn() },
      { id: "canvas-only", label: "캔버스만", shortcut: "`", onSelect: vi.fn(), separatorAfter: true },
      { id: "left-panel", label: "왼쪽 패널 보이기", onSelect: vi.fn() },
      { id: "right-panel", label: "속성 패널 보이기", onSelect: vi.fn() },
    ],
  },
  {
    id: "filter",
    label: "필터",
    items: [
      { id: "last-filter", label: "마지막 필터…", onSelect: vi.fn(), separatorAfter: true },
      { id: "gaussian-blur", label: "가우시안 블러", shortcut: "⌘⇧1", onSelect: vi.fn() },
      { id: "motion-blur", label: "모션 블러", shortcut: "⌘⇧2", onSelect: vi.fn() },
      {
        id: "hue-saturation-brightness",
        label: "색조 / 채도 / 밝기",
        shortcut: "⌘⇧3",
        onSelect: vi.fn(),
      },
      { id: "brightness-contrast", label: "명도 / 대비", shortcut: "⌘⇧4", onSelect: vi.fn() },
      { id: "color-curves", label: "색상 커브", shortcut: "⌘⇧5", onSelect: vi.fn() },
    ],
  },
  {
    id: "draw",
    label: "그리기",
    items: [
      { id: "pen", label: "펜", shortcut: "B", onSelect: vi.fn() },
      { id: "eraser", label: "지우개", shortcut: "E", onSelect: vi.fn() },
      { id: "fill", label: "채우기", shortcut: "G", onSelect: vi.fn() },
      { id: "smart-shape", label: "스마트 도형", onSelect: vi.fn(), separatorAfter: true },
      { id: "bg", label: "배경 · 톤", onSelect: vi.fn() },
      { id: "style", label: "팔레트 · 브랜드", onSelect: vi.fn() },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { id: "ai-assist", label: "AI 어시스트", onSelect: vi.fn() },
      { id: "stock", label: "스톡 이미지", onSelect: vi.fn() },
      { id: "integrations", label: "연동 설정", onSelect: vi.fn() },
    ],
  },
  {
    id: "help",
    label: "도움말",
    items: [
      { id: "feature-tutorials", label: "사용법 · 기능 튜토리얼", onSelect: vi.fn() },
      { id: "shortcuts", label: "단축키 · 기본 조작", shortcut: "?", onSelect: vi.fn() },
    ],
  },
];

describe("StudioMainMenu", () => {
  it("renders desktop-style application menu groups", () => {
    const html = renderToStaticMarkup(
      <StudioMainMenu
        groups={[
          {
            id: "file",
            label: "파일",
            items: [
              { id: "export", label: "내보내기", onSelect: vi.fn() },
              { id: "save", label: "저장", shortcut: "⌘S", onSelect: vi.fn() },
            ],
          },
          {
            id: "edit",
            label: "편집",
            items: [{ id: "undo", label: "실행취소", shortcut: "⌘Z", onSelect: vi.fn() }],
          },
        ]}
      />
    );
    expect(html).toContain('data-studio-main-menu="true"');
    expect(html).toContain("파일");
    expect(html).toContain("편집");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("data-studio-main-menu-trigger");
    expect(html).toContain('data-studio-main-menu-chevron="true"');
    expect(html).toContain("hidden opacity-50");
    expect(html).toContain("2xl:block");
    expect(html).toContain("min-w-max shrink-0");
  });

  it("keeps disabled APG menuitems discoverable at the first and last positions", () => {
    const items = [
      { disabled: true },
      { disabled: false },
      { disabled: true },
      {},
      { disabled: true },
    ];

    expect(resolveStudioMainMenuItemIndex(items, -1, "first")).toBe(0);
    expect(resolveStudioMainMenuItemIndex(items, -1, "last")).toBe(4);
  });

  it("includes disabled menuitems while wrapping ArrowUp/ArrowDown roving navigation", () => {
    const items = [
      {},
      { disabled: true },
      {},
      { disabled: true },
      {},
    ];

    expect(resolveStudioMainMenuItemIndex(items, 0, "next")).toBe(1);
    expect(resolveStudioMainMenuItemIndex(items, 2, "next")).toBe(3);
    expect(resolveStudioMainMenuItemIndex(items, 4, "next")).toBe(0);
    expect(resolveStudioMainMenuItemIndex(items, 0, "previous")).toBe(4);
    expect(resolveStudioMainMenuItemIndex(items, 4, "previous")).toBe(3);
  });

  it("recovers from a missing active item and traverses all-disabled menus", () => {
    const mixedItems = [{ disabled: true }, {}, { disabled: true }, {}];

    expect(resolveStudioMainMenuItemIndex(mixedItems, 0, "next")).toBe(1);
    expect(resolveStudioMainMenuItemIndex(mixedItems, 0, "previous")).toBe(3);
    expect(resolveStudioMainMenuItemIndex(mixedItems, 99, "next")).toBe(0);
    expect(resolveStudioMainMenuItemIndex(mixedItems, 99, "previous")).toBe(3);
    expect(resolveStudioMainMenuItemIndex(
      [{ disabled: true }, { disabled: true }],
      -1,
      "first",
    )).toBe(0);
  });

  it("does not steal focus back from a control clicked outside an open menu", () => {
    expect(mainMenuSource).toContain("closeMenuRef.current(false);");
    expect(mainMenuSource).toContain("if (restoreFocus) buttonRef.current?.focus");
    expect(mainMenuSource).not.toContain("restoreFocusTimerRef");
  });

  it("exposes the full commercial File/Edit/Insert/View/Filter/Draw/AI/Help catalog labels", () => {
    const html = renderToStaticMarkup(<StudioMainMenu groups={PRODUCTION_MENU_CATALOG} />);
    expect(html).toContain('aria-label="메인 메뉴"');
    for (const group of PRODUCTION_MENU_CATALOG) {
      expect(html).toContain(group.label);
      expect(group.items.length).toBeGreaterThan(0);
    }
    expect(PRODUCTION_MENU_CATALOG.map((g) => g.id)).toEqual([
      "file",
      "edit",
      "insert",
      "view",
      "filter",
      "draw",
      "ai",
      "help",
    ]);
    const itemLabels = PRODUCTION_MENU_CATALOG.flatMap((g) => g.items.map((i) => i.label));
    for (const required of [
      "초안 저장",
      "게시",
      "내보내기 / 다운로드",
      "프로젝트 가져오기…",
      "PSD 가져오기…",
      "프로젝트 센터…",
      "잘라내기",
      "복사",
      "붙여넣기",
      "현재 위치에 붙여넣기",
      "이미지 파일 붙여넣기…",
      "복제",
      "모두 선택",
      "선택 해제",
      "선택 반전",
      "선택 제거",
      "레이어 · 맨 위로",
      "레이어 · 위로",
      "레이어 · 맨 뒤로",
      "레이어 · 뒤로",
      "레이어 자르기…",
      "펜 압력 설정…",
      "애플리케이션 설정…",
      "템플릿 · 에셋",
      "3D 배경",
      "새 페이지",
      "슈퍼심플 레이아웃",
      "확대",
      "축소",
      "수평 반전",
      "화면에 맞게 조정",
      "실제 픽셀 (100%)",
      "흑백으로 표시",
      "참고 이미지 창 열기",
      "현재 보기 저장",
      "보기 복원",
      "원근 도우미 보기",
      "나만 숨긴 레이어 모두 표시",
      "제작 인사이트…",
      "사용법 · 기능 튜토리얼",
      "단축키 · 기본 조작",
      "마지막 필터…",
      "가우시안 블러",
      "모션 블러",
      "색조 / 채도 / 밝기",
      "명도 / 대비",
      "색상 커브",
      "스마트 도형",
      "AI 어시스트",
    ]) {
      expect(itemLabels).toContain(required);
    }
  });

  it("keeps the Magma-style View command order and shortcuts explicit", () => {
    const view = PRODUCTION_MENU_CATALOG.find((group) => group.id === "view");
    expect(view?.items.slice(0, 13).map((item) => [item.id, item.shortcut ?? null])).toEqual([
      ["zoom-in", "="],
      ["zoom-out", "-"],
      ["flip-horizontal", "H"],
      ["fit", "Home"],
      ["actual-pixels", "End"],
      ["fullscreen", "F11"],
      ["grayscale", "Q"],
      ["reference-window", null],
      ["save-current-view", "⇧S"],
      ["restore-view", "⇧Z"],
      ["perspective-guide", "⇧G"],
      ["reset-local-visibility", null],
      ["production-insights", null],
    ]);
  });

  it("keeps the Magma-style Edit command order and shortcuts explicit", () => {
    const edit = PRODUCTION_MENU_CATALOG.find((group) => group.id === "edit");
    expect(edit?.items.map((item) => [item.id, item.shortcut ?? null])).toEqual(
      STUDIO_EDIT_MENU_COMMAND_ORDER.map((id) => {
        const command = STUDIO_EDIT_MENU_COMMANDS[id];
        return [id, "shortcut" in command ? command.shortcut : null];
      })
    );
  });

  it("maps broad application menus to result-focused rich previews", () => {
    for (const [group, preview] of [
      ["file", "file-workflow"],
      ["edit", "edit-workflow"],
      ["view", "view-workflow"],
      ["brush", "draw-workflow"],
      ["help", "settings"],
    ]) {
      const groupStart = mainMenuSource.indexOf(`  ${group}: {`);
      expect(groupStart, `missing ${group} menu hint`).toBeGreaterThanOrEqual(0);
      expect(mainMenuSource.slice(groupStart, groupStart + 600)).toContain(
        `preview: "${preview}"`,
      );
    }
  });
});
