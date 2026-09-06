// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./command-palette";
import { CommandPaletteHost } from "./command-palette-host";

import { useUi } from "@/shared/lib/ui-store";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockPush = vi.fn();
vi.mock("@/src/compat/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@toonspectrum/core/fx", () => ({
  playSfx: vi.fn(),
  getAudioState: () => ({
    sfxEnabled: true,
    bgmEnabled: false,
    muted: false,
    volume: 0.55,
  }),
  setSfxEnabled: vi.fn(),
  setBgmEnabled: vi.fn(),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    mockPush.mockReset();
    useUi.setState({ commandPaletteOpen: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("open이 false일 때는 DOM에 렌더링되지 않는다", () => {
    render(<CommandPalette open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open이 true일 때 다이얼로그와 검색 입력창, 카테고리 탭, 푸터 키보드 힌트를 렌더링한다", () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByPlaceholderText(/작품 제목, 작가, 기능 명령, 스튜디오 도구 검색/)).toBeDefined();

    // 탭 확인
    expect(screen.getByRole("button", { name: /전체/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /작품/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /명령어/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /스튜디오/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /페이지/ })).toBeDefined();

    // 키보드 가이드 확인
    expect(screen.getByText("카테고리 전환")).toBeDefined();
    expect(screen.getByText("접두사 필터")).toBeDefined();
  });

  it("카테고리 탭 클릭 시 해당 모드로 필터링된다", async () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    const commandTab = screen.getByRole("button", { name: /명령어/ });
    await act(async () => {
      fireEvent.click(commandTab);
    });

    // 명령어 항목들이 노출되는지 확인
    await waitFor(() => {
      expect(screen.getAllByText("효과음(SFX) 토글").length).toBeGreaterThan(0);
      expect(screen.getByText("현재 페이지 링크 복사")).toBeDefined();
    });
  });

  it("접두사(>) 입력 시 명령어 모드로 자동 전환된다", async () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    const input = screen.getByPlaceholderText(/작품 제목, 작가, 기능 명령/);
    await act(async () => {
      fireEvent.input(input, { target: { value: ">링크" } });
      fireEvent.change(input, { target: { value: ">링크" } });
    });

    await waitFor(() => {
      expect(screen.getAllByText("현재 페이지 링크 복사").length).toBeGreaterThan(0);
    });
  });

  it("접두사(/) 입력 시 스튜디오 도구 모드로 자동 전환된다", async () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    const input = screen.getByPlaceholderText(/작품 제목, 작가, 기능 명령/);
    await act(async () => {
      fireEvent.input(input, { target: { value: "/펜" } });
      fireEvent.change(input, { target: { value: "/펜" } });
    });

    await waitFor(() => {
      expect(screen.getAllByText("G펜 / 잉크 브러시").length).toBeGreaterThan(0);
    });
  });

  it("닫기 버튼(배경) 클릭 시 onOpenChange(false)를 호출한다", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />);

    const backdrop = screen.getByRole("button", { name: /close|닫기/i });
    fireEvent.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CommandPaletteHost", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useUi.setState({ commandPaletteOpen: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Cmd+K 단축키 입력 시 팔레트 열림 상태가 토글된다", () => {
    render(<CommandPaletteHost />);

    expect(useUi.getState().commandPaletteOpen).toBe(false);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(useUi.getState().commandPaletteOpen).toBe(true);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(useUi.getState().commandPaletteOpen).toBe(false);
  });

  it("입력창 밖에서 '/' 키 입력 시 팔레트가 열린다", () => {
    render(<CommandPaletteHost />);

    expect(useUi.getState().commandPaletteOpen).toBe(false);

    fireEvent.keyDown(document.body, { key: "/" });
    expect(useUi.getState().commandPaletteOpen).toBe(true);
  });

  it("input 요소 안에서 '/' 키 입력 시에는 팔레트가 열리지 않는다", () => {
    render(
      <div>
        <CommandPaletteHost />
        <input data-testid="test-input" />
      </div>
    );

    const input = screen.getByTestId("test-input");
    fireEvent.keyDown(input, { key: "/" });

    expect(useUi.getState().commandPaletteOpen).toBe(false);
  });
});
