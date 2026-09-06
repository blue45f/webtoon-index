import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_WORKSPACE_STATE,
  STUDIO_DEFAULT_WORKSPACE_IDS,
  STUDIO_WORKSPACE_MAX_CUSTOM,
  normalizeStudioWorkspaceLayout,
  saveStudioWorkspace,
  type StudioWorkspaceLayout,
  type StudioWorkspaceState,
} from "./studio-workspaces";
import { StudioWorkspaceMenu, type StudioWorkspaceMenuProps } from "./StudioWorkspaceMenu";

const persisted = { status: "persisted", failure: null } as const;

const noopState: StudioWorkspaceMenuProps["onStateChange"] = () => persisted;

const noopLayout: StudioWorkspaceMenuProps["onApplyLayout"] = () => {
  // 정적 렌더에서는 실제 Studio 패널 상태를 적용하지 않는다.
};

function renderMenu(
  state: StudioWorkspaceState = DEFAULT_STUDIO_WORKSPACE_STATE,
  liveLayout: StudioWorkspaceLayout = state.liveLayout,
  persistence: StudioWorkspaceMenuProps["persistence"] = persisted,
  resolveDeviceKind?: StudioWorkspaceMenuProps["resolveDeviceKind"]
): string {
  return renderToStaticMarkup(
    <StudioWorkspaceMenu
      state={state}
      liveLayout={liveLayout}
      resolveDeviceKind={resolveDeviceKind}
      persistence={persistence}
      onStateChange={noopState}
      onApplyLayout={noopLayout}
    />
  );
}

describe("StudioWorkspaceMenu selector and built-in workspaces", () => {
  it("hands the initial lazy-dialog focus off in a layout effect without an RAF race", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./StudioWorkspaceMenu.tsx", import.meta.url)),
      "utf8",
    );
    const handoff = source.slice(
      source.indexOf("useLayoutEffect(() =>"),
      source.indexOf("}, [onInitialOpenReady, open]);") + 32,
    );

    expect(handoff).toContain("(initial ?? dialog).focus");
    expect(handoff).toContain("onInitialOpenReady?.(true)");
    expect(handoff).not.toContain("requestAnimationFrame");
  });

  it("summarizes the active workspace and exposes an accessible dialog trigger", () => {
    const html = renderMenu();

    expect(html).toContain('data-testid="studio-workspace-menu"');
    expect(html).toContain('data-testid="studio-workspace-menu-toggle"');
    expect(html.match(/data-studio-shortcut-boundary="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("스토리보드");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('data-testid="studio-workspace-dialog"');
    expect(html).toContain('data-workspace-initial-focus="true"');
    expect(html).toContain('hidden=""');
  });

  it("preserves all six classic presets and adds the immutable professional comic preset", () => {
    const html = renderMenu();

    expect(html.match(/data-workspace-kind="builtin"/g)).toHaveLength(
      STUDIO_DEFAULT_WORKSPACE_IDS.length
    );
    for (const id of STUDIO_DEFAULT_WORKSPACE_IDS) {
      expect(html).toContain(`data-workspace-id="${id}"`);
    }
    expect(html).toContain("스토리보드");
    expect(html).toContain("선화");
    expect(html).toContain("채색");
    expect(html).toContain("대사·레터링");
    expect(html).toContain("검수");
    expect(html).toContain("게시");
    expect(html).toContain("작품 정보와 최종 화면 맞춤 검사");
    expect(html).toContain("프로 만화");
    expect(html).toContain('data-workspace-id="pro-comic"');
    expect(html).toContain("수정 불가");
    expect(html).not.toContain("변경 저장");
    expect(html).not.toContain("이름 변경");
    expect(html).not.toContain("작업공간 삭제");
    expect(html).toContain('id="_R_0_-builtin-list" hidden=""');
  });

  it("explains the professional palette order, dock geometry, quick order, and mobile fallback", () => {
    const html = renderMenu();

    expect(html).toContain('data-testid="studio-pro-comic-palette-plan"');
    expect(html).toContain('aria-label="프로 만화 팔레트 우선순위"');
    expect(html).toContain("권장 시작");
    expect(html).toContain("1 도구 속성");
    expect(html).toContain("2 레이어");
    expect(html).toContain("3 페이지");
    expect(html).toContain("4 소재·빠른 실행");
    expect(html).toContain(
      "왼쪽 페이지 176px · 오른쪽 대상 속성 304px · 모바일은 캔버스 우선 시트"
    );
    expect(html).toContain('title="1. 되돌리기"');
    expect(html).toContain('title="2. 다시 실행"');
    expect(html).toContain('title="3. 펜"');
    expect(html).toContain('title="4. 고급 채우기"');
    expect(html).toContain('title="5. 말풍선 추가"');
    expect(html).toContain('title="6. 폭 맞춤"');
  });

  it("marks the selector and dialog when the live layout differs from the active preset", () => {
    const dirtyLayout = normalizeStudioWorkspaceLayout({
      ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      inspector: {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.inspector,
        primary: "layers",
      },
    });
    const html = renderMenu(DEFAULT_STUDIO_WORKSPACE_STATE, dirtyLayout);

    expect(html.match(/변경됨/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("현재 · 변경됨");
  });
});

describe("StudioWorkspaceMenu custom workspace lifecycle", () => {
  it("exposes save, overwrite, reload, rename, and guarded delete controls", () => {
    const customState = saveStudioWorkspace(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      "야간 채색"
    );
    const dirtyLayout = normalizeStudioWorkspaceLayout({
      ...customState.liveLayout,
      desktop: {
        ...customState.liveLayout.desktop,
        leftPanelOpen: !customState.liveLayout.desktop.leftPanelOpen,
      },
    });
    const html = renderMenu(customState, dirtyLayout);

    expect(html).toContain("현재 배치를 새 작업공간으로 저장");
    expect(html).toContain("새 작업공간 이름");
    expect(html).toContain(`maxLength="48"`);
    expect(html.match(/data-workspace-kind="custom"/g)).toHaveLength(1);
    expect(html).toContain("야간 채색");
    expect(html).toContain("현재 · 변경됨");
    expect(html).toContain('aria-label="야간 채색 관리"');
    expect(html).toContain("변경 저장");
    expect(html).toContain("다시 불러오기");
    expect(html).toContain("이름 변경");
    expect(html).toContain("복제");
    expect(html).toContain("위로 이동");
    expect(html).toContain("아래로 이동");
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp"');
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowDown"');
    expect(html).toContain("작업공간 삭제");
    expect(html).toContain("원고 내용은 삭제되지 않아요.");
    expect(html).toContain('aria-current="true"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-current="true"/);
  });

  it("disables creating another custom workspace at the 24-workspace limit", () => {
    let state: StudioWorkspaceState = DEFAULT_STUDIO_WORKSPACE_STATE;
    for (let index = 0; index < STUDIO_WORKSPACE_MAX_CUSTOM; index += 1) {
      state = saveStudioWorkspace(state, `공간 ${index + 1}`);
    }
    const html = renderMenu(state);

    expect(html).toContain(`${STUDIO_WORKSPACE_MAX_CUSTOM}/${STUDIO_WORKSPACE_MAX_CUSTOM}`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?현재 배치를 새 작업공간으로 저장/);
  });
});

describe("StudioWorkspaceMenu guarded switching and compact navigation", () => {
  it("renders an explicit save, discard, or cancel guard for dirty switches", () => {
    const html = renderMenu();

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-testid="studio-workspace-switch-guard"');
    expect(html).toContain("변경을 저장하고 전환할까요?");
    expect(html).toContain("취소");
    expect(html).toContain("저장하지 않고 전환");
    expect(html).toContain("사본 저장 후 전환");
    expect(html).toContain("Esc를 누르면 전환을 취소합니다.");
  });

  it("uses current/recent hierarchy, collapsible catalogs, and local search for larger catalogs", () => {
    let state = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "야간 채색");
    state = saveStudioWorkspace(state, "레터링 집중");
    const html = renderMenu(state);

    expect(html).toContain("현재 및 최근");
    expect(html).toContain('aria-controls="_R_0_-builtin-list"');
    expect(html).toContain('aria-controls="_R_0_-custom-list"');
    expect(html).toContain('role="search"');
    expect(html).toContain("작업공간 이름 또는 용도 검색");
    // Fifteen built-ins (the twelve V5 catalogue profiles plus three pipeline presets) and the
    // two saved above.
    expect(html).toContain("검색 결과 17개");
  });

  it("separates quick switching from the workspace management and preferences views", () => {
    const customState = saveStudioWorkspace(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      "야간 채색"
    );
    const html = renderMenu(customState);

    expect(html).toContain('data-workspace-view="switch"');
    expect(html).toContain('data-workspace-view="manage-catalog"');
    expect(html).toContain('data-workspace-view="manage-preferences"');
    expect(html).toContain("작업공간 관리");
    expect(html).toContain('aria-label="빠른 작업공간 전환으로 돌아가기"');
    expect(html).toContain('role="group" aria-label="작업공간 관리 보기"');
    expect(html).toContain("내 작업공간");
    expect(html).toContain("전환 설정");
    expect(html).toContain('aria-controls="_R_0_-management-tabs"');
    expect(html).toContain('id="_R_0_-quick-custom-list"');
    expect(html).toContain('id="_R_0_-custom-list"');
    expect(html).toContain('data-workspace-kind="custom-switch"');
    expect(html).toContain("저장 배치 복제");
  });
});

describe("StudioWorkspaceMenu responsive settings", () => {
  it("shows the actual current dock geometry and a responsive icon/name quick-access summary", () => {
    const html = renderMenu();

    expect(html).toContain('data-testid="studio-workspace-layout-preview"');
    expect(html).toContain('data-mobile-fallback="canvas-first-sheets"');
    expect(html).toContain("페이지 160px");
    expect(html).toContain("문서 설정 320px");
    expect(html).toContain(
      "모바일은 캔버스 우선 · 페이지/속성 시트 · 오른손 주요 도구"
    );
    expect(html).toContain('data-quick-access-density="responsive-icon-name"');
    expect(html).toContain("max-[359px]:sr-only");
    expect(html).toContain("주요 도구 순서");
  });

  it("provides device-scoped quick-action and mobile hand preferences", () => {
    const html = renderMenu();

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("주요 도구도 함께 전환");
    expect(html).toContain("현재 6방향 퀵 액션 배치를 유지해요.");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="모바일 주요 도구 위치"');
    expect(html).toContain("왼쪽");
    expect(html).toContain("오른쪽");
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the dialog bounded, independently scrollable, and mobile-touch safe", () => {
    const html = renderMenu();

    expect(html).toContain("max-h-[calc(100dvh-1rem)]");
    expect(html).toContain("lg:max-h-[min(42rem,calc(100dvh-5rem))]");
    expect(html).toContain("top-[max(0.5rem,env(safe-area-inset-top))]");
    expect(html).toContain("bottom-[max(0.5rem,env(safe-area-inset-bottom))]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(12);
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html.match(/size-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/text-\[0\.(?:5|6)[0-6]?rem\]/);
  });

  it("discloses the local scope and excluded content next to the controls", () => {
    const html = renderMenu();

    expect(html).toContain("이 기기 저장 확인됨");
    expect(html).toContain("현재 브라우저와 계정 범위");
    expect(html).toContain("원고와 AI 설정은 포함하지 않아요");
  });

  it("truthfully exposes failed persistence as session-only instead of saved", () => {
    const html = renderMenu(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      { status: "session-only", failure: "write-failed" }
    );

    expect(html).toContain("변경은 이 세션에서만 유지");
    expect(html).toContain("작업공간: 스토리보드 세션, 변경은 이 세션에서만 유지");
    expect(html).toContain("브라우저 저장에 실패해 이 세션에서만 유지");
    expect(html).toContain(">세션</span>");
    expect(html).not.toContain("이 기기 저장 확인됨");
  });
});

describe("StudioWorkspaceMenu per-device overrides", () => {
  function customState() {
    const state = saveStudioWorkspace(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      "내 펜 배치",
      normalizeStudioWorkspaceLayout({
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        deviceOverrides: {
          "pen-display": {
            desktop: {
              leftPanelOpen: false,
              rightPanelOpen: true,
              leftPanelWidth: 160,
              rightPanelWidth: 240,
            },
            controlSide: "left",
          },
        },
      }),
    );
    return state;
  }

  it("offers every device on the closed axis as an editable surface", () => {
    const html = renderMenu(customState(), undefined, persisted, () => "pen-display");

    expect(html).toContain("기기별 배치");
    for (const label of ["펜 디스플레이", "모바일", "키보드", "마우스", "터치"]) {
      expect(html, label).toContain(label);
    }
  });

  it("opens on the surface under the artist's hands and says which it is", () => {
    const html = renderMenu(customState(), undefined, persisted, () => "mobile");

    // 지금 이 기기가 먼저 선택되어 있어야 눈으로 보고 판단할 수 있다.
    expect(html).toContain("모바일 · 지금 이 기기");
    expect(html).toContain('aria-label="모바일 · 지금 이 기기 · 저장된 배치를 따름"');
  });

  it("distinguishes an adapted surface from one that inherits the saved layout", () => {
    const html = renderMenu(customState(), undefined, persisted, () => "pen-display");

    expect(html).toContain("펜 디스플레이 · 지금 이 기기 · 따로 조정됨");
    expect(html).toContain('aria-label="마우스 · 저장된 배치를 따름"');
    // 이 프로필의 펜 그립은 왼쪽으로 잡혀 있다.
    expect(html).toContain('aria-label="펜 디스플레이 주요 도구 왼쪽 배치" class');
  });

  it("locks the editor on a built-in profile, which cannot be rewritten", () => {
    // 기본 작업공간은 불변이라 오버라이드를 쓰면 예외가 난다. 버튼을 눌러보게 두는 대신
    // 왜 못 고치는지 먼저 말한다.
    const html = renderMenu(DEFAULT_STUDIO_WORKSPACE_STATE, undefined, persisted, () => "mouse");

    expect(html).toContain("기본 작업공간은 고칠 수 없어요. 복사본을 저장한 뒤 조정하세요.");
    expect(html).toContain("disabled=\"\"");
  });
});
