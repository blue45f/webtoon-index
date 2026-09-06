// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCanvasStatusRail,
  type StudioCanvasStatusRailProps,
} from "./StudioCanvasStatusRail";

import type { ReactNode } from "react";

const viewportState = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/src/hooks/use-media-query", () => ({
  useIsMobile: () => viewportState.mobile,
}));

vi.mock("../StudioToolHint", () => ({
  StudioToolHintTarget: ({
    hint,
    children,
  }: {
    hint: {
      id: string;
      description: string;
      preview?: string;
      previewVariant?: string;
    };
    children: ReactNode;
  }) => (
    <span
      data-testid={`hint-${hint.id}`}
      data-hint-description={hint.description}
      data-hint-preview={hint.preview}
      data-hint-preview-variant={hint.previewVariant}
    >
      {children}
    </span>
  ),
}));

afterEach(() => {
  cleanup();
  viewportState.mobile = false;
});

function createProps(
  overrides: Partial<StudioCanvasStatusRailProps> = {}
): StudioCanvasStatusRailProps {
  return {
    mobileImmersive: false,
    hasAutosave: false,
    autosaveRestoreBlockedReason: null,
    selectionCount: 0,
    advancedFillBusy: false,
    advancedFillPreviewMessage: null,
    advancedFillActive: false,
    onDownloadAutosaveBackup: vi.fn(),
    onRestoreAutosave: vi.fn(),
    onClearAutosave: vi.fn(),
    onGroupSelection: vi.fn(),
    onUngroupSelection: vi.fn(),
    onToggleSelectionLock: vi.fn(),
    onReorderSelection: vi.fn(),
    onAlignSelection: vi.fn(),
    onDuplicateSelection: vi.fn(),
    onRemoveSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onCancelAdvancedFillPreview: vi.fn(),
    onApplyAdvancedFillPreview: vi.fn(),
    onCancelAdvancedFillCalculation: vi.fn(),
    ...overrides,
  };
}

describe("StudioCanvasStatusRail", () => {
  it("offers a backup instead of an unsafe autosave restore", () => {
    const props = createProps({
      hasAutosave: true,
      autosaveRestoreBlockedReason: "revision-mismatch",
    });

    render(<StudioCanvasStatusRail {...props} />);

    expect(screen.getByText(/현재 서버 revision과 달라/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "복구하기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "JSON 백업" }));
    fireEvent.click(screen.getByRole("button", { name: "비우기" }));

    expect(props.onDownloadAutosaveBackup).toHaveBeenCalledOnce();
    expect(props.onClearAutosave).toHaveBeenCalledOnce();
  });

  it("replaces the recovery banner with a read-only notice in a follower tab", () => {
    // 후발 탭에서 "복구하기"를 누르면 선행 탭의 문서를 메모리에 올려놓고 저장은 못 하는
    // 최악의 상태가 된다 — 화면에는 작업이 있는데 어디에도 남지 않는다.
    const props = createProps({
      hasAutosave: true,
      autosaveDocumentLeadership: { role: "follower", basis: "web-lock" },
    });

    render(<StudioCanvasStatusRail {...props} />);

    expect(screen.getByText(/다른 탭에서 편집 중/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "복구하기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "비우기" })).toBeNull();
    expect(screen.getByRole("button", { name: "새로고침으로 다시 확인" })).toBeTruthy();
  });

  it("lets a Magma jam follower keep drawing instead of looking read-only", () => {
    const props = createProps({
      hasAutosave: true,
      autosaveLiveJam: true,
      autosaveDocumentLeadership: { role: "follower", basis: "web-lock" },
    });

    render(<StudioCanvasStatusRail {...props} />);

    expect(screen.getByText(/같이 그리는 중/u)).toBeTruthy();
    expect(screen.getByText(/이 탭에서도 바로 그릴 수 있습니다/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "새로고침으로 다시 확인" })).toBeNull();
    expect(document.querySelector("[data-studio-autosave-live-jam='true']")).toBeTruthy();
  });

  it("keeps the recovery banner for the leading tab", () => {
    const props = createProps({
      hasAutosave: true,
      autosaveDocumentLeadership: { role: "leader", basis: "web-lock" },
    });

    render(<StudioCanvasStatusRail {...props} />);

    expect(screen.getByRole("button", { name: "복구하기" })).toBeTruthy();
    expect(screen.queryByText(/다른 탭에서 편집 중/u)).toBeNull();
  });

  it("returns focus to the safe recovery action after the clear decision settles", async () => {
    // "비우기" 는 유일한 복구본을 영구 삭제하는 승인 창을 연다. 창이 닫힌 뒤 포커스가 파괴
    // 버튼에 그대로 남으면 Enter 한 번이 두 번째 파괴 시도가 된다 — 안전한 쪽으로 되돌린다.
    let settle!: () => void;
    const decision = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const props = createProps({
      hasAutosave: true,
      onClearAutosave: vi.fn(() => decision),
    });

    render(<StudioCanvasStatusRail {...props} />);
    const restore = screen.getByRole("button", { name: "복구하기" });
    fireEvent.click(screen.getByRole("button", { name: "비우기" }));

    expect(props.onClearAutosave).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(restore);

    settle();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(restore);
    });
  });

  it("restores a compatible autosave through the semantic callback", () => {
    const props = createProps({ hasAutosave: true });

    render(<StudioCanvasStatusRail {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "복구하기" }));

    expect(props.onRestoreAutosave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "JSON 백업" })).toBeNull();
  });

  it("reserves the selection command lane so selecting cannot move the canvas", () => {
    // 측정된 결함(#15): 이 바가 선택될 때만 마운트돼 아래 캔버스를 51px 밀어 내렸고, 이미
    // 시작된 Konva 드래그가 낡은 스테이지 원점을 계속 써서 요소가 정확히 그만큼 위로 튀었다.
    // 레인은 선택 유무와 무관하게 **항상 있어야** 한다 — 그래야 캔버스 기하가 선택 상태와
    // 무관해진다. 비어 있을 때는 조용한 안내만 두고, 캔버스를 덮지 않도록 흐름 안에 남는다.
    const props = createProps({ selectionCount: 0 });
    const { container, rerender } = render(<StudioCanvasStatusRail {...props} />);

    const emptyLane = container.querySelector("[data-studio-selection-command-lane]");
    expect(emptyLane).toBeTruthy();
    expect(emptyLane?.className).toContain("h-[2.6875rem]");
    expect(container.querySelector("[data-studio-selection-command-reserve]")).toBeTruthy();
    // 예약 자리는 보조기술에 잡히면 안 된다 — 실제 명령이 아니라 자리표시자다.
    expect(
      container
        .querySelector("[data-studio-selection-command-reserve]")
        ?.getAttribute("aria-hidden")
    ).toBe("true");

    rerender(<StudioCanvasStatusRail {...props} selectionCount={3} />);
    const filledLane = container.querySelector("[data-studio-selection-command-lane]");
    expect(filledLane).toBeTruthy();
    // 같은 레인, 같은 높이 클래스. 선택은 레인 안을 채울 뿐 레인 크기를 바꾸지 않는다.
    expect(filledLane?.className).toBe(emptyLane?.className);
    expect(container.querySelector("[data-studio-selection-command-reserve]")).toBeNull();
    expect(screen.getByRole("button", { name: "선택 요소 그룹화" })).toBeTruthy();
  });

  it("drops the selection command lane entirely below lg, selected or not", () => {
    // 360px 에서 이 레인은 51px(바 43px + mb-2 8px)의 그리기 면적을 상시 먹는데, 그 명령은
    // 플로팅 "선택 항목 빠른 작업" 바가 이미 엄지 영역에 제공한다. 예약을 없애도 조건이
    // **뷰포트**라서 선택 유무와 무관하게 항상 없다 — 캔버스 원점 이동 0px 불변식은 그대로다.
    viewportState.mobile = true;
    const props = createProps({ selectionCount: 0 });
    const { container, rerender } = render(<StudioCanvasStatusRail {...props} />);

    expect(container.querySelector("[data-studio-selection-command-lane]")).toBeNull();
    expect(container.querySelector("[data-studio-selection-command-reserve]")).toBeNull();

    rerender(<StudioCanvasStatusRail {...props} selectionCount={3} />);
    // 선택이 생겨도 레인이 되돌아오면 안 된다 — 그 순간이 곧 캔버스가 밀리는 순간이다.
    expect(container.querySelector("[data-studio-selection-command-lane]")).toBeNull();
    expect(screen.queryByRole("button", { name: "선택 요소 그룹화" })).toBeNull();
  });

  it("preserves selection thresholds and every semantic layout callback", () => {
    const props = createProps({ selectionCount: 1 });
    const { rerender } = render(<StudioCanvasStatusRail {...props} />);

    expect(screen.queryByRole("button", { name: "선택 요소 그룹화" })).toBeNull();
    expect(screen.getByRole("button", { name: "선택 요소 왼쪽 정렬" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "선택 요소 가로 균등 분배" })).toBeNull();

    rerender(<StudioCanvasStatusRail {...props} selectionCount={2} />);
    expect(
      screen.getByRole("button", { name: "선택 요소 그룹화" }).getAttribute("aria-keyshortcuts")
    ).toBe("Control+G Meta+G");
    expect(screen.queryByRole("button", { name: "선택 요소 가로 균등 분배" })).toBeNull();

    rerender(<StudioCanvasStatusRail {...props} selectionCount={3} />);
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 그룹화" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 잠금" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 맨 앞으로" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 맨 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 왼쪽 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 가로 가운데 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 오른쪽 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 위쪽 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 세로 가운데 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 아래쪽 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 가로 균등 분배" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 요소 세로 균등 분배" }));
    fireEvent.click(screen.getByRole("button", { name: "복제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "해제" }));

    expect(props.onGroupSelection).toHaveBeenCalledOnce();
    expect(props.onToggleSelectionLock).toHaveBeenCalledOnce();
    expect(props.onReorderSelection).toHaveBeenNthCalledWith(1, "front");
    expect(props.onReorderSelection).toHaveBeenNthCalledWith(2, "back");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(1, "left");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(2, "hcenter");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(3, "right");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(4, "top");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(5, "vcenter");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(6, "bottom");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(7, "distributeH");
    expect(props.onAlignSelection).toHaveBeenNthCalledWith(8, "distributeV");
    expect(props.onDuplicateSelection).toHaveBeenCalledOnce();
    expect(props.onRemoveSelection).toHaveBeenCalledOnce();
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });

  it("switches a complete group between ungroup and lock recovery actions", () => {
    const props = createProps({
      selectionCount: 2,
      selectionGroupName: "주인공",
      selectionLockState: "locked",
    });

    render(<StudioCanvasStatusRail {...props} />);

    expect(screen.queryByRole("button", { name: "선택 요소 그룹화" })).toBeNull();
    expect(screen.getByText("주인공")).toBeTruthy();
    expect(screen.getByRole("button", { name: "선택 그룹 왼쪽 정렬" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "선택 요소 가로 균등 분배" })).toBeNull();
    const ungroupButton = screen.getByRole("button", { name: "선택 그룹 해제" });
    expect(ungroupButton.getAttribute("aria-keyshortcuts")).toBe(
      "Shift+Control+G Shift+Meta+G"
    );
    fireEvent.click(ungroupButton);
    fireEvent.click(screen.getByRole("button", { name: "선택 잠금 해제" }));

    expect(props.onUngroupSelection).toHaveBeenCalledOnce();
    expect(props.onToggleSelectionLock).toHaveBeenCalledOnce();
  });

  it("labels mixed lock state without adding another vertical toolbar row", () => {
    const { container } = render(
      <StudioCanvasStatusRail
        {...createProps({
          selectionCount: 2,
          selectionLockState: "mixed",
        })}
      />
    );

    expect(screen.getByRole("button", { name: "선택 잠금 통일" })).toBeTruthy();
    expect(screen.getByText("혼합")).toBeTruthy();
    const actionStrip = screen.getByRole("button", { name: "선택 잠금 통일" }).parentElement
      ?.parentElement;
    expect(actionStrip?.className).toContain("overflow-x-auto");
    expect(container.querySelector("[data-studio-canvas-status-rail]")).toBeTruthy();
  });

  it("keeps the current group internal-edit mode visible without an object selection", () => {
    const { container } = render(
      <StudioCanvasStatusRail
        {...createProps({
          selectionCount: 0,
          activeGroupName: "주인공 연출 그룹",
        })}
      />
    );

    const status = screen.getByRole("status", {
      name: "주인공 연출 그룹 내부 편집 중. Esc로 그룹 전체 선택",
    });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("주인공 연출 그룹");
    expect(status.textContent).toContain("내부 편집");
    expect(status.textContent).toContain("Esc로 그룹 전체 선택");
    expect(container.querySelector("[data-studio-group-internal-edit-status]")).toBe(status);
    expect(screen.queryByRole("button", { name: "선택 요소 그룹화" })).toBeNull();
  });

  it("contains long group names responsively and preserves selection actions", () => {
    const props = createProps({
      selectionCount: 2,
      activeGroupName:
        "아주 긴 주인공과 배경 및 전경 연출을 함께 관리하는 그룹 이름",
    });
    render(<StudioCanvasStatusRail {...props} />);

    const status = screen.getByRole("status", { name: /아주 긴 주인공.*내부 편집 중/ });
    const groupName = screen.getByText(
      "아주 긴 주인공과 배경 및 전경 연출을 함께 관리하는 그룹 이름"
    );
    expect(status.className).toContain("flex-wrap");
    expect(groupName.className).toContain("truncate");
    expect(groupName.className).toContain("max-w-[min(12rem,58vw)]");

    fireEvent.click(screen.getByRole("button", { name: "선택 요소 그룹화" }));
    expect(props.onGroupSelection).toHaveBeenCalledOnce();
  });

  it("does not announce an empty active group name", () => {
    render(
      <StudioCanvasStatusRail
        {...createProps({
          activeGroupName: "   ",
        })}
      />
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps selection actions at 44px on coarse pointers and exposes unavailable reasons", () => {
    const props = createProps({
      selectionCount: 3,
      groupSelectionDisabledReason: "기존 그룹을 먼저 해제하세요.",
      alignmentSelectionDisabledReason: "여러 그룹은 그룹별로 정렬하세요.",
    });
    render(<StudioCanvasStatusRail {...props} />);

    const group = screen.getByRole("button", { name: "선택 요소 그룹화" });
    const align = screen.getByRole("button", { name: "선택 요소 왼쪽 정렬" });
    const lock = screen.getByRole("button", { name: "선택 잠금" });

    for (const button of [group, align, lock]) {
      expect(button.className).toContain("pointer-coarse:min-h-11");
      expect(button.className).toContain("pointer-coarse:min-w-11");
    }
    expect((group as HTMLButtonElement).disabled).toBe(true);
    expect((align as HTMLButtonElement).disabled).toBe(true);
    expect((lock as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", {
        name: "선택 요소 맨 앞으로",
      }) as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(group);
    fireEvent.click(align);
    expect(props.onGroupSelection).not.toHaveBeenCalled();
    expect(props.onAlignSelection).not.toHaveBeenCalled();
  });

  it("gates group-wide mutations without disabling unrelated alignment reasons", () => {
    const props = createProps({
      selectionCount: 2,
      selectionGroupName: "잠긴 원고 그룹",
      layoutSelectionDisabledReason: "검토 잠금을 먼저 해제하세요.",
    });
    render(<StudioCanvasStatusRail {...props} />);

    const ungroup = screen.getByRole("button", { name: "선택 그룹 해제" });
    const front = screen.getByRole("button", { name: "선택 요소 맨 앞으로" });
    const align = screen.getByRole("button", { name: "선택 그룹 왼쪽 정렬" });
    expect((ungroup as HTMLButtonElement).disabled).toBe(true);
    expect((front as HTMLButtonElement).disabled).toBe(true);
    expect((align as HTMLButtonElement).disabled).toBe(false);
  });

  it("exposes the bubble-merge action only when armed and gates it on the reason", () => {
    const hidden = createProps({ selectionCount: 2 });
    const { rerender } = render(<StudioCanvasStatusRail {...hidden} />);
    expect(screen.queryByRole("button", { name: "선택한 말풍선 병합" })).toBeNull();

    const enabled = createProps({
      selectionCount: 2,
      showBubbleMerge: true,
      bubbleMergeDisabledReason: null,
      onMergeBubbles: vi.fn(),
    });
    rerender(<StudioCanvasStatusRail {...enabled} />);
    const mergeButton = screen.getByRole("button", { name: "선택한 말풍선 병합" });
    expect(mergeButton).toBeTruthy();
    expect(mergeButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(mergeButton);
    expect(enabled.onMergeBubbles).toHaveBeenCalledOnce();

    const gated = createProps({
      selectionCount: 3,
      showBubbleMerge: true,
      bubbleMergeDisabledReason: "말풍선만 함께 선택해야 병합할 수 있어요.",
      onMergeBubbles: vi.fn(),
    });
    rerender(<StudioCanvasStatusRail {...gated} />);
    const disabledButton = screen.getByRole("button", { name: "선택한 말풍선 병합" });
    expect(disabledButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(disabledButton);
    expect(gated.onMergeBubbles).not.toHaveBeenCalled();
  });

  it("registers one exact rich preview per layout action without native titles", () => {
    const { container } = render(
      <StudioCanvasStatusRail {...createProps({ selectionCount: 3 })} />
    );

    expect(container.querySelector("[title]")).toBeNull();

    const previewTargets = [
      ...container.querySelectorAll<HTMLElement>('[data-hint-preview="selection-layout"]'),
    ];
    expect(previewTargets).toHaveLength(9);
    expect(previewTargets.map((target) => target.dataset.hintPreviewVariant)).toEqual([
      "group",
      "align-left",
      "align-hcenter",
      "align-right",
      "align-top",
      "align-vcenter",
      "align-bottom",
      "distribute-horizontal",
      "distribute-vertical",
    ]);
    expect(screen.getByTestId("hint-selection-layout-group").dataset.hintDescription).toContain(
      "2개 이상"
    );
    expect(
      screen.getByTestId("hint-selection-layout-distribute-horizontal").dataset.hintDescription
    ).toContain("3개 이상");
    expect(
      screen.getByTestId("hint-selection-layout-distribute-vertical").dataset.hintDescription
    ).toContain("3개 이상");
  });

  it("keeps advanced-fill cancellation and preview application distinct", () => {
    const props = createProps({ advancedFillBusy: true });
    const { rerender } = render(<StudioCanvasStatusRail {...props} />);

    expect(screen.getByRole("status").textContent).toContain("고급 채우기 분석 중");
    fireEvent.click(screen.getByRole("button", { name: "계산 취소" }));
    expect(props.onCancelAdvancedFillCalculation).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /적용/ })).toBeNull();

    rerender(
      <StudioCanvasStatusRail
        {...props}
        advancedFillBusy={false}
        advancedFillPreviewMessage="3개 영역을 찾았어요."
        advancedFillActive
      />
    );
    expect(screen.getByRole("status").textContent).toContain("다른 영역을 탭해");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "적용 · 실행취소 1회" }));

    expect(props.onCancelAdvancedFillPreview).toHaveBeenCalledOnce();
    expect(props.onApplyAdvancedFillPreview).toHaveBeenCalledOnce();
  });

  it("marks the mobile rail as its own bounded overlay scroll region when it holds a notice", () => {
    viewportState.mobile = true;
    const { container } = render(
      <StudioCanvasStatusRail {...createProps({ mobileImmersive: true, hasAutosave: true })} />
    );

    const rail = container.querySelector("[data-studio-canvas-status-rail]");
    expect(rail?.getAttribute("data-studio-canvas-status-rail-filled")).toBe("true");
    expect(rail?.className).toContain("overflow-y-auto");
    expect(rail?.className).not.toContain("contents");
    expect(rail?.className).toContain("pr-[5.25rem]");
    // 담을 게 생겨도 캔버스를 밀지 않는다 — 흐름 밖에서 덮는다. 흐름 안이었다면 배너가
    // 붙는 순간 스테이지 원점이 내려가 진행 중인 드래그·획이 그만큼 튄다.
    expect(rail?.className).toContain("absolute");
    expect((rail as HTMLElement | null)?.style.paddingTop).toBe("3.75rem");
  });

  it("gives the empty mobile notice strip zero drawing area", () => {
    // 360×640 에서 이 띠는 담긴 것이 하나도 없어도 떠 있는 상단 바를 피하는 3.75rem
    // (60px) 여백만으로 그리기 면적의 9.4% 를 먹었다.
    viewportState.mobile = true;
    const { container } = render(
      <StudioCanvasStatusRail {...createProps({ mobileImmersive: true })} />
    );

    const rail = container.querySelector("[data-studio-canvas-status-rail]");
    expect(rail?.getAttribute("data-studio-canvas-status-rail-filled")).toBe("false");
    expect(rail?.className).toContain("hidden");
    expect((rail as HTMLElement | null)?.style.paddingTop).toBe("");
  });

  it("floats the reliability rail over the canvas instead of displacing it", () => {
    // 저장 실패·GPU 로스는 획을 긋는 도중에도 들어온다. 흐름 안의 띠였다면 그 순간
    // 스테이지 원점이 통째로 내려갔다.
    const { container } = render(<StudioCanvasStatusRail {...createProps()} />);

    const reliability = container.querySelector("[data-studio-reliability-status-rail]");
    expect(reliability).toBeTruthy();
    expect(reliability?.className).toContain("absolute");
    expect(container.querySelector("[data-studio-reliability-idle]")).toBeNull();

    const anchor = container.querySelector("[data-studio-reliability-overlay-anchor]");
    // 데스크톱은 왼쪽 아래 보기/줌 HUD 와 같은 줄, 모바일은 떠 있는 편집 독 위로 띄운다.
    expect((anchor as HTMLElement | null)?.style.getPropertyValue(
      "--studio-reliability-rail-bottom"
    )).toBe("");

    cleanup();
    viewportState.mobile = true;
    const mobile = render(
      <StudioCanvasStatusRail {...createProps({ mobileImmersive: true })} />
    );
    expect(
      (mobile.container.querySelector(
        "[data-studio-reliability-overlay-anchor]"
      ) as HTMLElement | null)?.style.getPropertyValue("--studio-reliability-rail-bottom")
    ).toBe("calc(5.5rem + env(safe-area-inset-bottom))");
  });
});
