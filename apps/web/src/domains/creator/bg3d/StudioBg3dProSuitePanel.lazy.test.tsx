// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dProSuitePanel } from "./StudioBg3dProSuitePanel";

const state = vi.hoisted(() => ({ active: false, disabled: false, loaded: vi.fn() }));

vi.mock("./studio-bg3d-pro-suite-runtime-context", () => ({
  useStudioBg3dProSuiteRuntime: () => ({
    proSuiteActive: state.active,
    disabled: state.disabled,
  }),
}));

vi.mock("./StudioBg3dProSuitePanelContent", async () => {
  const { useState } = await import("react");
  state.loaded();
  return {
    StudioBg3dProSuitePanel: ({ disabled = false }: { readonly disabled?: boolean }) => {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="전문 도구 작업 상태"
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    },
  };
});

describe("StudioBg3dProSuitePanel lazy activation", () => {
  afterEach(() => cleanup());

  it("loads only on first visible activation, retains edits and inherits every editor lock", async () => {
    const view = render(<StudioBg3dProSuitePanel disabled={false} />);
    expect(state.loaded).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();

    state.active = true;
    view.rerender(<StudioBg3dProSuitePanel disabled={false} />);
    const input = await screen.findByRole("textbox", { name: "전문 도구 작업 상태" });
    expect(state.loaded).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "작업 중인 설정" } });

    state.active = false;
    view.rerender(<StudioBg3dProSuitePanel disabled={false} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("작업 중인 설정");

    state.active = true;
    state.disabled = true;
    view.rerender(<StudioBg3dProSuitePanel disabled={false} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("작업 중인 설정");

    state.disabled = false;
    view.rerender(<StudioBg3dProSuitePanel disabled />);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(state.loaded).toHaveBeenCalledTimes(1);
  });
});
