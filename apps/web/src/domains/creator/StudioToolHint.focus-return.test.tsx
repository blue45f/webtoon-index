// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { suppressNextStudioToolHintFocus } from "./studio-tool-hint-focus-suppression";
import {
  StudioToolHintPreferencesProvider,
  StudioToolHintTarget,
} from "./StudioToolHint";

afterEach(cleanup);

function renderHintTarget() {
  render(
    <StudioToolHintPreferencesProvider
      mode="compact"
      touchHoldDelayMs={640}
      reduceMotion
    >
      <StudioToolHintTarget
        hint={{
          id: "brush-library",
          title: "현재 브러시",
          description: "브러시 프리셋을 엽니다.",
        }}
      >
        <button type="button">브러시</button>
      </StudioToolHintTarget>
    </StudioToolHintPreferencesProvider>,
  );
  return screen.getByRole("button", { name: "브러시" });
}

describe("StudioToolHint focus return suppression", () => {
  it("keeps ordinary keyboard focus discoverable", () => {
    const trigger = renderHintTarget();

    fireEvent.focus(trigger);

    expect(screen.getByRole("tooltip").textContent).toContain("현재 브러시");
  });

  it("consumes exactly one selection-driven focus return without reopening the coach", () => {
    const trigger = renderHintTarget();

    suppressNextStudioToolHintFocus(trigger);
    fireEvent.focus(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.blur(trigger);
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toContain("현재 브러시");
  });
});
