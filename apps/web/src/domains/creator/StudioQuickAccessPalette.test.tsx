// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS,
  type StudioQuickAccessCommandMeta,
  type StudioQuickAccessState,
} from "./studio-quick-access";
import { StudioQuickAccessPalette } from "./StudioQuickAccessPalette";

const COMMAND_CATALOG: readonly StudioQuickAccessCommandMeta[] = [
  {
    id: "undo",
    label: "되돌리기",
    description: "마지막 작업을 되돌립니다.",
    category: "편집",
    shortcut: "⌘Z",
  },
  {
    id: "redo",
    label: "다시 실행",
    description: "되돌린 작업을 다시 실행합니다.",
    category: "편집",
    shortcut: "⇧⌘Z",
  },
  {
    id: "pen",
    label: "펜",
    description: "현재 펜으로 그립니다.",
    category: "도구",
  },
  {
    id: "save",
    label: "저장",
    description: "현재 문서를 저장합니다.",
    category: "파일",
    available: false,
  },
  {
    id: "fill",
    label: "채우기",
    description: "닫힌 영역을 채웁니다.",
    category: "도구",
    keywords: ["페인트", "버킷"],
  },
  {
    id: "eraser",
    label: "지우개",
    category: "도구",
  },
];

const INITIAL_STATE: StudioQuickAccessState = {
  version: 1,
  sets: [
    {
      id: "set-main",
      name: "주력",
      commandIds: ["undo", "pen", "save", "missing-command"],
    },
    {
      id: "set-color",
      name: "채색",
      commandIds: ["fill", "redo"],
    },
  ],
  activeSetId: "set-main",
  displayMode: "tiles",
  density: "comfortable",
};

interface ControlledPaletteProps {
  readonly initialState?: StudioQuickAccessState;
  readonly onExecute?: (commandId: string, setId: string) => void;
  readonly onStateChange?: (state: StudioQuickAccessState) => void;
}

function ControlledPalette({
  initialState = INITIAL_STATE,
  onExecute = () => undefined,
  onStateChange = () => undefined,
}: ControlledPaletteProps) {
  const [state, setState] = useState(initialState);

  return (
    <StudioQuickAccessPalette
      state={state}
      catalog={COMMAND_CATALOG}
      onExecute={onExecute}
      onStateChange={(next) => {
        onStateChange(next);
        setState(next);
      }}
    />
  );
}

afterEach(cleanup);

describe("StudioQuickAccessPalette", () => {
  it("keeps one compact header affordance and safe touch/320px geometry", () => {
    render(<ControlledPalette />);

    const palette = screen.getByRole("region", { name: "빠른 액세스" });
    const header = screen.getByTestId("studio-quick-access-header");
    const options = within(header).getByRole("button", {
      name: "빠른 액세스 편집",
    });
    const activeTab = screen.getByRole("tab", { name: "주력" });
    const mobileSetSelect = screen.getByRole("combobox", {
      name: "활성 빠른 액세스 세트",
    });
    const commandList = screen.getByRole("list", { name: "주력 명령" });

    expect(within(header).getAllByRole("button")).toHaveLength(1);
    expect(palette.className).toContain("w-full");
    expect(palette.className).toContain("min-w-0");
    expect(palette.className).toContain("max-w-full");
    expect(palette.className).toContain("overflow-hidden");
    expect(commandList.className).toContain("grid-cols-2");
    expect(options.className).toContain("max-lg:size-11");
    expect(options.className).toContain("pointer-coarse:size-11");
    expect(activeTab.className).toContain("max-lg:min-h-11");
    expect(activeTab.className).toContain("pointer-coarse:min-h-11");
    expect(mobileSetSelect.className).toContain("min-h-11");
    expect(palette.getAttribute("data-display-mode")).toBe("tiles");
    expect(palette.getAttribute("data-density")).toBe("comfortable");
  });

  it("keeps set, layout, and density changes controlled", () => {
    const onStateChange = vi.fn();
    render(<ControlledPalette onStateChange={onStateChange} />);

    fireEvent.change(
      screen.getByRole("combobox", { name: "활성 빠른 액세스 세트" }),
      { target: { value: "set-color" } },
    );
    expect(screen.getByText("채색 · 2개")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "빠른 액세스 명령 간격" }),
      { target: { value: "compact" } },
    );

    const palette = screen.getByRole("region", { name: "빠른 액세스" });
    const latestState = onStateChange.mock.calls.at(-1)?.[0] as
      | StudioQuickAccessState
      | undefined;
    expect(palette.getAttribute("data-display-mode")).toBe("list");
    expect(palette.getAttribute("data-density")).toBe("compact");
    expect(latestState?.activeSetId).toBe("set-color");
    expect(latestState?.displayMode).toBe("list");
    expect(latestState?.density).toBe("compact");
  });

  it("executes registered available commands and fails closed otherwise", () => {
    const onExecute = vi.fn();
    render(<ControlledPalette onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: "되돌리기 실행" }));
    expect(onExecute).toHaveBeenCalledWith("undo", "set-main");

    const unavailable = screen.getByRole("button", {
      name: "저장 사용 불가",
    }) as HTMLButtonElement;
    const unknown = screen.getByRole("button", {
      name: "missing-command 사용 불가",
    }) as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);
    expect(unknown.disabled).toBe(true);

    fireEvent.click(unavailable);
    fireEvent.click(unknown);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("adds, removes, reorders, restores, and exits transient customization", async () => {
    const onStateChange = vi.fn();
    render(<ControlledPalette onStateChange={onStateChange} />);

    const options = screen.getByRole("button", {
      name: "빠른 액세스 편집",
    });
    fireEvent.click(options);
    const search = screen.getByRole("searchbox", {
      name: "추가할 빠른 액세스 명령 검색",
    });
    fireEvent.change(search, { target: { value: "다시" } });
    fireEvent.click(
      screen.getByRole("button", { name: "다시 실행 세트에 추가" }),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "다시 실행 실행" }),
      );
    });

    let latestState = onStateChange.mock.calls.at(-1)?.[0] as
      | StudioQuickAccessState
      | undefined;
    expect(latestState?.sets[0]?.commandIds).toEqual([
      "undo",
      "pen",
      "save",
      "missing-command",
      "redo",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "다시 실행 앞으로 이동" }),
    );
    latestState = onStateChange.mock.calls.at(-1)?.[0] as
      | StudioQuickAccessState
      | undefined;
    expect(latestState?.sets[0]?.commandIds).toEqual([
      "undo",
      "pen",
      "save",
      "redo",
      "missing-command",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "펜 세트에서 제거" }),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "다시 실행 실행" }),
      );
    });
    expect(
      screen.queryByRole("button", { name: "펜 실행" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "주력 기본 명령 복원" }),
    );
    latestState = onStateChange.mock.calls.at(-1)?.[0] as
      | StudioQuickAccessState
      | undefined;
    expect(latestState?.sets[0]?.id).toBe("set-main");
    expect(latestState?.sets[0]?.name).toBe("주력");
    expect(latestState?.sets[0]?.commandIds).toEqual([
      ...DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS,
    ]);

    const searchAfterRestore = screen.getByRole("searchbox", {
      name: "추가할 빠른 액세스 명령 검색",
    });
    searchAfterRestore.focus();
    fireEvent.keyDown(searchAfterRestore, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(options);
    expect(
      screen.getByRole("region", { name: "빠른 액세스" })
        .getAttribute("data-customizing"),
    ).toBe("false");
  });

  it("uses one roving command stop and arrow-key set activation", () => {
    render(<ControlledPalette />);

    const undo = screen.getByRole("button", { name: "되돌리기 실행" });
    const pen = screen.getByRole("button", { name: "펜 실행" });
    expect(undo.tabIndex).toBe(0);
    expect(pen.tabIndex).toBe(-1);

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(pen);
    expect(pen.tabIndex).toBe(0);

    const mainTab = screen.getByRole("tab", { name: "주력" });
    const colorTab = screen.getByRole("tab", { name: "채색" });
    mainTab.focus();
    fireEvent.keyDown(mainTab, { key: "ArrowRight" });
    expect(colorTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(colorTab);
  });

  it("moves vertically by the rendered tile columns and keeps focus at a missing row edge", () => {
    const tileState: StudioQuickAccessState = {
      ...INITIAL_STATE,
      sets: [{
        id: "set-grid",
        name: "격자",
        commandIds: ["undo", "pen", "fill", "redo", "eraser"],
      }],
      activeSetId: "set-grid",
    };
    render(<ControlledPalette initialState={tileState} />);

    const commandList = screen.getByRole("list", { name: "격자 명령" });
    const originalGetComputedStyle = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      (element, pseudoElement) => {
        if (element === commandList) {
          return {
            gridTemplateColumns: "100px 100px",
          } as CSSStyleDeclaration;
        }
        return originalGetComputedStyle(element, pseudoElement);
      },
    );
    const undo = screen.getByRole("button", { name: "되돌리기 실행" });
    const fill = screen.getByRole("button", { name: "채우기 실행" });
    const eraser = screen.getByRole("button", { name: "지우개 실행" });

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowDown" });
    expect(document.activeElement).toBe(fill);
    fireEvent.keyDown(fill, { key: "ArrowUp" });
    expect(document.activeElement).toBe(undo);

    eraser.focus();
    fireEvent.keyDown(eraser, { key: "ArrowDown" });
    expect(document.activeElement).toBe(eraser);
  });
});
