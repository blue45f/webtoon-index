// @vitest-environment jsdom

/**
 * 통합 Command Search UI 계약.
 *
 * 검색 랭킹·별칭 커버리지는 `studio-command-search.test.ts` 가 잡는다. 여기서는
 * 그 결과가 화면에서 실제로 구획으로 나뉘어 나오고, 급증하지 않고, **행이 광고한
 * 대로 실제로 동작하며**, 보조기술에 결과가 보이는지를 본다.
 *
 * 회귀 배경(감사 D1/D11, 2026-08-08 실측): 푸터는 언제나 `Enter 실행` 이라고
 * 적혀 있었지만 명령 행의 활성화 분기는 마운트 지점이 넘기지 않는 옵셔널 콜백
 * 하나뿐이라 클릭·↑↓+Enter·Tab+Enter 네 경로가 전부 조용한 no-op 이었고, ↑↓
 * 하이라이트는 `data-active` 라는 시각 전용 속성으로만 움직여 스크린리더에는
 * 결과가 아예 없는 화면이었다. 아래 두 describe 가 그 두 가지를 고정한다.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installStudioCommandExecutionBindings,
  resetStudioCommandExecutionBindingsForTests,
} from "./studio-command-execution-registry";
import {
  STUDIO_SEARCH_DEFAULT_SECTION_LIMIT,
  STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT,
} from "./studio-command-search";
import { StudioCommandSearchDialog } from "./StudioCommandSearchDialog";
import { StudioCommandSearchHost } from "./StudioCommandSearchHost";

afterEach(() => {
  cleanup();
  resetStudioCommandExecutionBindingsForTests();
});

function openDialog(
  overrides: Partial<
    Parameters<typeof StudioCommandSearchDialog>[0]
  > = {},
) {
  const onClose = vi.fn();
  render(
    <StudioCommandSearchDialog open onClose={onClose} {...overrides} />,
  );
  return { onClose };
}

function combobox(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

function type(value: string) {
  const input = combobox();
  fireEvent.change(input, { target: { value } });
  return input;
}

function footerText(): string {
  return screen.getByRole("dialog").lastElementChild?.textContent ?? "";
}

const ALL_HANDLERS = {
  onNavigateInspector: vi.fn(),
  onExpandPalette: vi.fn(),
  onOpenTutorial: vi.fn(),
  onOpenHelp: vi.fn(),
};

describe("StudioCommandSearchDialog", () => {
  it("모달 계약을 지킨다", () => {
    openDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(combobox()).toBeTruthy();
  });

  it("타사 용어로 검색하면 우리 기능과 '무엇으로 맞았는지'가 함께 나온다", () => {
    openDialog();
    type("Paint Bucket");
    expect(screen.getByText("채우기")).toBeTruthy();
    expect(screen.getByText(/Photoshop "Paint Bucket"/u)).toBeTruthy();
  });

  it("결과를 구획으로 나눠 보여준다", () => {
    openDialog();
    type("레이어");
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent);
    expect(headings.length).toBeGreaterThan(1);
    // 구획 제목은 선언된 순서를 따른다.
    expect(headings).toEqual([...headings].sort(
      (a, b) =>
        ["명령", "속성·보정", "패널·팔레트", "튜토리얼"].indexOf(a ?? "") -
        ["명령", "속성·보정", "패널·팔레트", "튜토리얼"].indexOf(b ?? ""),
    ));
  });

  it("넓은 질의에도 화면에 쏟아붓지 않고 잘린 수를 알린다", () => {
    openDialog();
    type("레이어");
    expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(
      STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT,
    );
    for (const group of screen.getAllByRole("group")) {
      expect(within(group).queryAllByRole("option").length).toBeLessThanOrEqual(
        STUDIO_SEARCH_DEFAULT_SECTION_LIMIT,
      );
    }
  });

  it("결과를 고르면 인스펙터 라우트로 이동하고 닫힌다", () => {
    const onNavigateInspector = vi.fn();
    const { onClose } = openDialog({ onNavigateInspector });
    type("레이어 마스크");
    fireEvent.click(screen.getByText("레이어 마스크"));
    expect(onNavigateInspector).toHaveBeenCalledWith({
      primary: "properties",
      image: "mask",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("선택 전용 속성은 빈 캔버스에서 이동한다고 광고하지 않는다", () => {
    const onNavigateInspector = vi.fn();
    openDialog({
      onNavigateInspector,
      inspectorContext: {
        hasSelection: false,
        selectedType: null,
        drawing: false,
        imageToolsAvailable: true,
      },
    });
    type("자유 변형");
    const result = screen.getByRole("option", { name: /위치·크기/u });
    expect(result.getAttribute("aria-disabled")).toBe("true");
    expect(within(result).getByText("선택 필요")).toBeTruthy();
    fireEvent.click(result);
    expect(onNavigateInspector).not.toHaveBeenCalled();
  });

  it("숫자 배치 결과는 실제 선택 속성 카드까지 포커스하도록 전달한다", () => {
    const onNavigateInspector = vi.fn();
    openDialog({ onNavigateInspector });
    type("위치 크기");
    fireEvent.click(screen.getByText("위치·크기"));
    expect(onNavigateInspector).toHaveBeenCalledWith(
      { primary: "properties" },
      "selection.geometry",
    );
  });

  it("도구 속성 결과는 접힘 상태가 아니라 실제 팔레트 열기 요청을 전달한다", () => {
    const onExpandPalette = vi.fn();
    openDialog({ onExpandPalette });
    type("도구 속성");
    const paletteResult = screen.getAllByRole("option").find(
      (option) => option.getAttribute("data-action") === "palette"
        && within(option).queryByText("도구 속성"),
    );
    expect(paletteResult).toBeTruthy();
    fireEvent.click(paletteResult as HTMLElement);
    expect(onExpandPalette).toHaveBeenCalledWith("tool-properties");
  });

  it("브러시 스튜디오 결과는 도구 속성 안의 실제 섹션까지 전달한다", () => {
    const onNavigateInspector = vi.fn();
    openDialog({ onNavigateInspector });
    type("브러시 스튜디오");
    const inspectorResult = screen.getAllByRole("option").find(
      (option) => option.getAttribute("data-action") === "inspector"
        && within(option).queryByText("브러시 스튜디오"),
    );
    expect(inspectorResult).toBeTruthy();
    fireEvent.click(inspectorResult as HTMLElement);
    expect(onNavigateInspector).toHaveBeenCalledWith(
      { primary: "properties" },
      "tool.brush-studio",
    );
  });

  it("문서 서브탭을 가진 결과는 탭만이 아니라 서브탭·포커스까지 전달한다", () => {
    // PR #517 회귀: 인스펙터 행이 `primary` 만 실어서 문서 탭은 열리지만
    // 서브탭은 직전 상태에 남고 컨트롤 그룹은 열리지 않았다.
    const onNavigateInspector = vi.fn();
    openDialog({ onNavigateInspector });
    type("가이드와 스냅");
    const inspectorResult = screen.getAllByRole("option").find(
      (option) => option.getAttribute("data-action") === "inspector"
        && within(option).queryByText("가이드와 스냅"),
    );
    expect(inspectorResult).toBeTruthy();
    fireEvent.click(inspectorResult as HTMLElement);
    expect(onNavigateInspector).toHaveBeenCalledWith(
      { primary: "document", document: "canvas" },
      "canvas.guide-lines",
    );
  });

  it("빈 질의는 목록 대신 안내만 보여준다", () => {
    openDialog();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Esc 로 닫는다", () => {
    const { onClose } = openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * D1 — "찾아놓고 실행이 안 된다". 네 경로 중 어느 하나라도 다시 no-op 이 되면
 * 아래가 깨진다.
 */
describe("StudioCommandSearchDialog — 범위(scope)", () => {
  it("범위 칩은 전체·현재 패널·명령·도움말 넷이고 기본은 전체다", () => {
    openDialog(ALL_HANDLERS);
    const group = screen.getByRole("radiogroup", { name: "검색 범위" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "전체",
      "현재 패널",
      "명령",
      "도움말",
    ]);
    expect(within(group).getByRole("radio", { name: "전체" }).getAttribute("aria-checked")).toBe("true");
  });

  it("'현재 패널' 범위는 속성·패널 구획만 남긴다", () => {
    openDialog({ ...ALL_HANDLERS, initialScope: "inspector" });
    type("블러");
    // 가우시안 블러는 명령 구획이라 현재 패널 범위에서는 나오지 않는다.
    expect(screen.queryByText("가우시안 블러")).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("좁힌 범위가 비면 전체에서 몇 건이 맞는지 알려 주고 한 번에 넓힌다", () => {
    openDialog({ ...ALL_HANDLERS, initialScope: "help" });
    type("가우시안 블러");
    const widen = screen.getByRole("button", { name: /전체에서 \d+건 보기/u });
    fireEvent.click(widen);
    expect(
      screen.getByRole("radio", { name: "전체" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("가우시안 블러")).toBeTruthy();
  });

  it("'명령' 범위에서는 속성 행이 나오지 않는다", () => {
    openDialog({ ...ALL_HANDLERS, initialScope: "command" });
    type("마스크");
    expect(screen.queryByRole("option", { name: /대상 › 마스크/u })).toBeNull();
  });
});

describe("StudioCommandSearchDialog — 결과 활성화", () => {
  it("검토된 메뉴 명령은 검색에서 같은 실행 함수를 직접 호출한다", () => {
    const execute = vi.fn();
    installStudioCommandExecutionBindings([
      {
        commandId: "filter.gaussian-blur",
        label: "가우시안 블러",
        execute,
        disabled: false,
      },
    ]);
    const onOpenHelp = vi.fn();
    const { onClose } = openDialog({ onOpenHelp });
    type("가우시안 블러");
    const option = screen.getAllByRole("option").find(
      (candidate) => within(candidate).queryByText("가우시안 블러", { exact: true }),
    );
    if (!option) throw new Error("missing exact 가우시안 블러 option");
    expect(option.getAttribute("data-action")).toBe("execute");
    expect(within(option).getByText("실행")).toBeTruthy();
    fireEvent.click(option);
    expect(execute).toHaveBeenCalledOnce();
    expect(onOpenHelp).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("action");
  });

  it("현재 비활성인 직접 명령은 실행하지 않고 이유를 푸터에 표시한다", () => {
    const execute = vi.fn();
    installStudioCommandExecutionBindings([
      {
        commandId: "filter.gaussian-blur",
        label: "가우시안 블러",
        execute,
        disabled: true,
        unavailableReason: "이미지 레이어를 먼저 선택하세요.",
      },
    ]);
    openDialog({ onOpenHelp: vi.fn() });
    type("가우시안 블러");
    const option = screen.getAllByRole("option").find(
      (candidate) => within(candidate).queryByText("가우시안 블러", { exact: true }),
    );
    if (!option) throw new Error("missing exact 가우시안 블러 option");
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(within(option).getByText("사용 불가")).toBeTruthy();
    expect(footerText()).toContain("이미지 레이어를 먼저 선택하세요");
    fireEvent.click(option);
    expect(execute).not.toHaveBeenCalled();
  });

  it("명령 행을 클릭하면 도움말 소비자가 helpNodeId 와 commandId 를 함께 받는다", () => {
    const onOpenHelp = vi.fn();
    const { onClose } = openDialog({ onOpenHelp });
    type("가우시안 블러");
    fireEvent.click(screen.getByText("가우시안 블러"));
    expect(onOpenHelp).toHaveBeenCalledWith(
      "help/filter/gaussian-blur",
      "filter.gaussian-blur",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("↑↓ 로 고른 명령 행도 Enter 로 같은 일을 한다", () => {
    const onOpenHelp = vi.fn();
    openDialog({ onOpenHelp });
    type("가우시안 블러");
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    const selected = screen
      .queryAllByRole("option")
      .find((node) => node.getAttribute("aria-selected") === "true");
    // `open` 은 제어 prop 이고 onClose 는 스파이라 목록은 그대로 남는다 —
    // Enter 가 향한 행이 두 번째 행이었음을 선택 상태로 확인한다.
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(onOpenHelp.mock.calls[0]?.[1]).toMatch(/^filter\./u);
    expect(selected).toBeTruthy();
  });

  it("도움말 소비자가 없으면 명령 행은 실행된다고 광고하지 않는다", () => {
    openDialog();
    type("가우시안 블러");
    const option = screen.getAllByRole("option")[0];
    expect(option?.getAttribute("aria-disabled")).toBe("true");
    expect(within(option as HTMLElement).getByText("열 수 없음")).toBeTruthy();
    expect(footerText()).not.toContain("Enter 실행");
    expect(footerText()).toContain("열 수 없습니다");
  });

  it("푸터는 활성 행이 실제로 하는 일을 말한다", () => {
    openDialog({ onOpenHelp: vi.fn() });
    type("가우시안 블러");
    expect(footerText()).toContain("Enter 도움말 열기");
    // 실행한다고 적힌 곳은 어디에도 없다.
    expect(footerText()).not.toContain("Enter 실행");
  });

  it("행마다 보이는 배지가 그 행의 실제 능력과 일치한다", () => {
    const BADGE: Record<string, string> = {
      execute: "실행",
      inspector: "이동",
      palette: "펼치기",
      tutorial: "튜토리얼",
      help: "도움말",
      none: "열 수 없음",
    };
    openDialog(ALL_HANDLERS);
    type("레이어");
    const kinds = new Set<string>();
    for (const option of screen.getAllByRole("option")) {
      const kind = option.getAttribute("data-action") ?? "";
      kinds.add(kind);
      expect(within(option).getByText(BADGE[kind] ?? "?")).toBeTruthy();
      // 어떤 행도 "실행"이라고 적지 않는다 — 실행 배선이 아직 없다.
      expect(option.textContent).not.toContain("실행");
    }
    // 명령 행과 이동 행이 섞인 질의라 두 종류 이상이 나온다.
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("소비자가 없는 타깃(`panel`)은 핸들러를 다 넘겨도 열린다고 하지 않는다", () => {
    openDialog(ALL_HANDLERS);
    type("자동 액션");
    const autoActions = screen
      .getAllByRole("option")
      .find((node) => within(node).queryByText("자동 액션"));
    expect(autoActions).toBeTruthy();
    // `panel` 타깃에는 아직 소비자가 없다 — 없는 능력을 지어내지 않는다.
    expect(autoActions?.getAttribute("data-action")).toBe("none");
    expect(autoActions?.getAttribute("aria-disabled")).toBe("true");
  });
});

/** D11 — 결과가 보조기술에 존재하고, ↑↓ 가 그 존재를 따라 움직인다. */
describe("StudioCommandSearchDialog — 스크린리더 계약", () => {
  it("입력은 콤보박스이고 결과는 listbox/option 이다", () => {
    openDialog({ onOpenHelp: vi.fn() });
    type("레이어");
    const input = combobox();
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.id).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("↑↓ 가 aria-activedescendant 와 aria-selected 를 함께 옮긴다", () => {
    openDialog({ onOpenHelp: vi.fn() });
    type("레이어");
    const dialog = screen.getByRole("dialog");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);

    const first = combobox().getAttribute("aria-activedescendant");
    expect(first).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const second = combobox().getAttribute("aria-activedescendant");
    expect(second).toBe(options[1]?.id);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(combobox().getAttribute("aria-activedescendant")).toBe(first);
  });

  it("결과가 없으면 콤보박스가 펼쳐졌다고 말하지 않는다", () => {
    openDialog();
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("결과 행은 탭 순서에 없다 — 콤보박스 계약", () => {
    openDialog({ onOpenHelp: vi.fn() });
    type("레이어");
    for (const option of screen.getAllByRole("option")) {
      expect((option as HTMLButtonElement).tabIndex).toBe(-1);
    }
  });
});

describe("StudioCommandSearchHost", () => {
  it("F1 이 통합 검색을 연다 (감사 §2.8 'F1 바인딩 없음' 해소)", async () => {
    const onRequestOpen = vi.fn();
    render(<StudioCommandSearchHost onRequestOpen={onRequestOpen} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "F1" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(onRequestOpen).toHaveBeenCalledOnce();
  });

  it("입력 중에는 F1 을 가로채지 않는다", () => {
    render(
      <>
        <input data-testid="editing" />
        <StudioCommandSearchHost />
      </>,
    );
    const input = screen.getByTestId("editing");
    input.focus();
    fireEvent.keyDown(input, { key: "F1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("트리거 버튼도 같은 검색을 연다", async () => {
    render(<StudioCommandSearchHost />);
    fireEvent.click(screen.getByTestId("studio-command-search-trigger"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("Escape로 닫으면 검색을 연 원래 요소로 포커스를 돌려준다", async () => {
    render(
      <>
        <button type="button">캔버스 도구</button>
        <StudioCommandSearchHost />
      </>,
    );
    const origin = screen.getByRole("button", { name: "캔버스 도구" });
    origin.focus();
    fireEvent.keyDown(window, { key: "F1" });
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it("검색 결과가 목적지에 포커스하면 실행 요소로 덮어쓰지 않는다", async () => {
    render(
      <>
        <button type="button">목적지</button>
        <StudioCommandSearchHost
          onNavigateInspector={() => {
            screen.getByRole("button", { name: "목적지" }).focus();
          }}
        />
      </>,
    );
    const trigger = screen.getByTestId("studio-command-search-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    type("레이어 마스크");
    fireEvent.click(screen.getByRole("option", { name: /대상 › 마스크/u }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "목적지" }),
      );
    });
  });

  it("모바일에서는 트리거를 숨기고 F1 만 남긴다", () => {
    render(<StudioCommandSearchHost hideTrigger />);
    expect(screen.queryByTestId("studio-command-search-trigger")).toBeNull();
  });
});
