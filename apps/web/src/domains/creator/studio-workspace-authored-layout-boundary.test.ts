import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_WORKSPACE_STATE,
  STUDIO_WORKSPACE_DEVICE_KINDS,
  STUDIO_WORKSPACE_LEFT_PANEL_WIDTH,
  STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH,
  captureStudioWorkspaceDeviceLayout,
  isStudioWorkspaceDirty,
  normalizeStudioWorkspaceLayout,
  overwriteStudioWorkspace,
  resolveStudioWorkspace,
  resolveStudioWorkspaceDeviceLayout,
  saveStudioWorkspace,
  setStudioWorkspaceDeviceOverride,
  switchStudioWorkspace,
  updateStudioWorkspaceLiveLayout,
  type StudioWorkspaceDeviceKind,
  type StudioWorkspaceLayout,
  type StudioWorkspaceState,
} from "./studio-workspaces";

/**
 * 저자가 만든 프로필과 기기에 맞춰 화면에 세운 배치의 경계.
 *
 * StudioPage 는 워크스페이스를 적용할 때 `resolveStudioWorkspaceDeviceLayout` 로 도크를 세우고,
 * 자동 저장 effect 는 그 화면 상태를 다시 읽어 `updateStudioWorkspaceLiveLayout` 로 되돌린다.
 * 두 단계 모두 순수 함수라서 React 없이 그대로 재현할 수 있고, 여기서 왕복시키면 실제 배선과
 * 같은 값이 흐른다. 소스 문자열이 아니라 상태를 검사하므로 리팩터링에는 침묵하고 회귀에는 운다.
 */

/** StudioPage 자동 저장 effect 가 화면 상태에서 layout 을 조립하는 방식 그대로. */
function autosaveFromScreen(
  state: StudioWorkspaceState,
  presented: StudioWorkspaceLayout,
  device: StudioWorkspaceDeviceKind | null = null,
): StudioWorkspaceState {
  // `deviceOverrides` 키를 넣지 않는 것이 핵심이다 — 화면에는 기기축이 존재하지 않으므로
  // 정규화가 fallback(직전 liveLayout)의 기기축을 그대로 상속한다.
  const screen = normalizeStudioWorkspaceLayout(
    {
      inspector: presented.inspector,
      desktop: {
        leftPanelOpen: presented.desktop.leftPanelOpen,
        rightPanelOpen: presented.desktop.rightPanelOpen,
        leftPanelWidth: presented.desktop.leftPanelWidth,
        rightPanelWidth: presented.desktop.rightPanelWidth,
      },
      drawingPalettes: presented.drawingPalettes,
      quickActions: presented.quickActions,
    },
    state.liveLayout,
  );
  // StudioPage 와 같이 저자형으로 되돌린 뒤에 저장한다.
  const nextLayout = captureStudioWorkspaceDeviceLayout(state.liveLayout, screen, device);
  return updateStudioWorkspaceLiveLayout(state, nextLayout);
}

/** 다섯 기기 모두에서 데스크톱 기하와 확실히 다른, 작가가 직접 저술한 프로필. */
function authoredLayout(): StudioWorkspaceLayout {
  return normalizeStudioWorkspaceLayout({
    ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
    desktop: {
      leftPanelOpen: true,
      rightPanelOpen: true,
      leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum,
      rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum,
    },
    deviceOverrides: Object.fromEntries(
      STUDIO_WORKSPACE_DEVICE_KINDS.map((device) => [device, {
        desktop: {
          leftPanelOpen: false,
          rightPanelOpen: false,
          leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum,
          rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
        },
        controlSide: "left",
      }]),
    ),
  });
}

function authoredState(): { state: StudioWorkspaceState; id: string } {
  const state = saveStudioWorkspace(
    DEFAULT_STUDIO_WORKSPACE_STATE,
    "작가가 저술한 배치",
    authoredLayout(),
  );
  const saved = state.customWorkspaces.at(-1);
  if (!saved) throw new Error("saveStudioWorkspace did not append a workspace");
  return { state, id: saved.id };
}

function savedLayoutJson(state: StudioWorkspaceState, id: string): string {
  const workspace = resolveStudioWorkspace(state, id);
  if (!workspace) throw new Error(`workspace ${id} disappeared`);
  return JSON.stringify(workspace.layout);
}

/** 한 기기에서 프로필을 열고, 자동 저장을 두 번(패널 조정마다 한 번) 돌린 상태. */
function openAndAutosave(
  device: StudioWorkspaceDeviceKind | null,
): { state: StudioWorkspaceState; id: string; presented: StudioWorkspaceLayout } {
  const opened = authoredState();
  // 다른 프로필로 나갔다 돌아오는 실제 전환 왕복까지 포함한다.
  let state = switchStudioWorkspace(opened.state, "publish");
  state = switchStudioWorkspace(state, opened.id);
  const active = resolveStudioWorkspace(state, opened.id);
  if (!active) throw new Error(`workspace ${opened.id} disappeared`);
  const presented = resolveStudioWorkspaceDeviceLayout(active.layout, device);
  state = autosaveFromScreen(state, presented, device);
  state = autosaveFromScreen(state, presented, device);
  return { state, id: opened.id, presented };
}

describe("device-resolved layout never rewrites the authored workspace", () => {
  it("leaves the saved profile byte-identical after opening and autosaving on every device", () => {
    const authoredJson = JSON.stringify(authoredState().state.customWorkspaces.at(-1)?.layout);
    for (const device of [...STUDIO_WORKSPACE_DEVICE_KINDS, null]) {
      const { state, id } = openAndAutosave(device);
      expect(savedLayoutJson(state, id), `device: ${device ?? "none"}`).toBe(authoredJson);
    }
  });

  it("still routes the adapted geometry to the screen, so the check is not vacuous", () => {
    const { state, presented } = openAndAutosave("mobile");
    // 화면에 선 것은 기기 오버라이드다 — 여기서 저자 기하가 나오면 적용 자체가 죽은 것이다.
    expect(presented.desktop.leftPanelOpen).toBe(false);
    expect(presented.desktop).not.toEqual(authoredLayout().desktop);
    // liveLayout 은 저자형을 유지하고, 기기 기하는 그 기기 슬롯에만 남는다. 이 분리가 깨지면
    // 폰에서 한 번 연 것만으로 데스크톱 도크가 접힌 채 굳는다.
    expect(state.liveLayout.desktop).toEqual(authoredLayout().desktop);
    expect(state.liveLayout.deviceOverrides.mobile?.desktop).toEqual(presented.desktop);
  });

  it("keeps the desktop profile intact when a device session hands off to a desktop one", () => {
    const mobileSession = openAndAutosave("mobile");
    // 같은 프로필을 데스크톱에서 다시 열면 저자 기하가 그대로 돌아와야 한다.
    const desktop = resolveStudioWorkspaceDeviceLayout(
      resolveStudioWorkspace(mobileSession.state, mobileSession.id)?.layout ??
        DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      null,
    );
    expect(desktop.desktop).toEqual(authoredLayout().desktop);
    // liveLayout 으로 다시 그려도 마찬가지다 — 새로고침 경로가 여기다.
    expect(
      resolveStudioWorkspaceDeviceLayout(mobileSession.state.liveLayout, null).desktop,
    ).toEqual(authoredLayout().desktop);
  });

  it("reads as unmodified when a workspace is merely opened on an adapted surface", () => {
    // 이 판정이 어긋나면 작가가 손대지 않았는데도 '변경됨' 이 뜨고, 그 상태에서 누르는
    // '저장하고 전환' 이 바로 저자 배치를 덮어쓴다.
    for (const device of [...STUDIO_WORKSPACE_DEVICE_KINDS, null]) {
      const { state } = openAndAutosave(device);
      expect(isStudioWorkspaceDirty(state), `device: ${device ?? "none"}`).toBe(false);
    }
  });
});

describe("saving from an adapted surface", () => {
  /** 메뉴의 '현재 배치 저장' 이 하는 일: 지금 liveLayout 을 활성 프로필에 덮어쓴다. */
  function saveCurrentChanges(state: StudioWorkspaceState, id: string): StudioWorkspaceState {
    return overwriteStudioWorkspace(state, id, state.liveLayout);
  }

  it("stores the artist's pen-display edit as a pen-display override, not as the desktop layout", () => {
    const { state, id } = openAndAutosave("pen-display");
    // 펜 디스플레이에서 오른쪽 도크를 더 넓게 끌었다.
    const widened = resolveStudioWorkspaceDeviceLayout(
      resolveStudioWorkspace(state, id)?.layout ?? state.liveLayout,
      "pen-display",
    );
    const dragged = autosaveFromScreen(
      state,
      normalizeStudioWorkspaceLayout(
        { ...widened, desktop: { ...widened.desktop, rightPanelWidth: 321 } },
        widened,
      ),
      "pen-display",
    );
    const saved = resolveStudioWorkspace(saveCurrentChanges(dragged, id), id);

    // 저자 데스크톱 기하는 그대로다.
    expect(saved?.layout.desktop).toEqual(authoredLayout().desktop);
    // 끌어놓은 폭은 펜 디스플레이 슬롯에 남는다.
    expect(saved?.layout.deviceOverrides["pen-display"]?.desktop.rightPanelWidth).toBe(321);
    // 다른 기기는 물들지 않는다.
    expect(saved?.layout.deviceOverrides.mobile?.desktop.rightPanelWidth)
      .toBe(authoredLayout().deviceOverrides.mobile?.desktop.rightPanelWidth);
  });

  it("still moves the authored layout when the surface has no override to route into", () => {
    // 오버라이드가 없는 기기(평범한 마우스 데스크톱)에서 도크를 옮기면 프로필 자체가 움직여야 한다.
    // 그러지 않으면 아무도 데스크톱 배치를 다시는 바꿀 수 없다.
    const plain = normalizeStudioWorkspaceLayout({
      ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
      desktop: {
        leftPanelOpen: true,
        rightPanelOpen: true,
        leftPanelWidth: 240,
        rightPanelWidth: 300,
      },
    });
    const state = saveStudioWorkspace(DEFAULT_STUDIO_WORKSPACE_STATE, "마우스 전용", plain);
    const id = state.customWorkspaces.at(-1)?.id ?? "";
    const dragged = autosaveFromScreen(
      state,
      normalizeStudioWorkspaceLayout(
        { ...plain, desktop: { ...plain.desktop, leftPanelWidth: 199 } },
        plain,
      ),
      "mouse",
    );
    expect(dragged.liveLayout.desktop.leftPanelWidth).toBe(199);
    expect(dragged.liveLayout.deviceOverrides.mouse).toBeUndefined();
    expect(resolveStudioWorkspace(saveCurrentChanges(dragged, id), id)?.layout.desktop.leftPanelWidth)
      .toBe(199);
  });

  it("keeps a handedness override when the geometry happens to match the authored docks", () => {
    // 손 위치는 도크 기하와 별개의 선택이다. 기하가 같아졌다고 해서 뒤집어 놓은 그립까지
    // 되돌리면, 왼손잡이 설정이 조용히 사라진다.
    const withGrip = setStudioWorkspaceDeviceOverride(
      normalizeStudioWorkspaceLayout(DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout),
      "pen-display",
      { controlSide: "left" },
    );
    const captured = captureStudioWorkspaceDeviceLayout(
      withGrip,
      resolveStudioWorkspaceDeviceLayout(withGrip, "pen-display"),
      "pen-display",
    );
    expect(captured.deviceOverrides["pen-display"]?.controlSide).toBe("left");
    expect(captured.desktop).toEqual(withGrip.desktop);
  });
});
