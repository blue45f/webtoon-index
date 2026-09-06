// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioShapePickerGrid,
  StudioShapePickerStrip,
  STUDIO_DRAW_SHAPE_PICKER_KINDS,
} from "./studio-creative-visuals";
import { StudioToolHintPreferencesProvider } from "./StudioToolHint";

import type { ReactElement } from "react";

function withCompactHints(children: ReactElement): ReactElement {
  return (
    <StudioToolHintPreferencesProvider
      mode="compact"
      touchHoldDelayMs={480}
      reduceMotion
    >
      {children}
    </StudioToolHintPreferencesProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Studio shape picker rich hints", () => {
  it("keeps a single coordinated hint while keyboard focus moves across grid options", () => {
    render(withCompactHints(
      <StudioShapePickerGrid
        activeKind="line"
        kinds={STUDIO_DRAW_SHAPE_PICKER_KINDS}
        onSelect={() => undefined}
      />
    ));
    const line = screen.getByRole("option", { name: "선" });
    const rectangle = screen.getByRole("option", { name: "사각형" });

    fireEvent.focus(line);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toContain("수평·수직·45°");
    expect(line.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.blur(line, { relatedTarget: rectangle });
    fireEvent.focus(rectangle, { relatedTarget: line });
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toContain("정사각형");
    expect(document.body.textContent).not.toContain("수평·수직·45°");
  });

  it("preserves native button selection and keyboard-focus semantics in the compact strip", () => {
    const onSelect = vi.fn();
    render(withCompactHints(
      <StudioShapePickerStrip
        activeKind="ellipse"
        kinds={STUDIO_DRAW_SHAPE_PICKER_KINDS}
        onSelect={onSelect}
      />
    ));
    const star = screen.getByRole("option", { name: "별" });

    expect(star.tagName).toBe("BUTTON");
    expect(star.tabIndex).toBe(0);
    fireEvent.focus(star);
    expect(screen.getByRole("tooltip").textContent).toContain("별 꼭짓점과 안쪽 반경");
    fireEvent.click(star);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("star");
  });

  it.each([
    ["grid", StudioShapePickerGrid],
    ["strip", StudioShapePickerStrip],
  ] as const)(
    "keeps unavailable shapes as keyboard-discoverable listbox options in the %s",
    (_surface, Picker) => {
      const onSelect = vi.fn();
      const { container } = render(withCompactHints(
        <Picker
          activeKind="line"
          kinds={[
            {
              kind: "arrow",
              label: "화살표",
              disabled: true,
              unavailableReason: "현재 레이어에서는 화살표를 만들 수 없습니다.",
            },
          ]}
          onSelect={onSelect}
        />
      ));
      const unavailableOption = screen.getByRole("option", { name: "화살표" });

      expect(unavailableOption.tagName).toBe("BUTTON");
      expect(unavailableOption.getAttribute("aria-disabled")).toBe("true");
      expect(unavailableOption.tabIndex).toBe(0);
      expect(container.querySelector('[data-studio-tool-hint-target="true"][role="button"]')).toBeNull();
      expect(container.querySelector("button[disabled]")).toBeNull();

      fireEvent.focus(unavailableOption);
      expect(unavailableOption.getAttribute("aria-describedby")).toBeTruthy();
      expect(screen.getByRole("tooltip").textContent).toContain(
        "현재 레이어에서는 화살표를 만들 수 없습니다."
      );
      fireEvent.click(unavailableOption);
      expect(onSelect).not.toHaveBeenCalled();
    }
  );

  it("provides a useful unavailable reason when a disabled shape omits one", () => {
    render(withCompactHints(
      <StudioShapePickerGrid
        activeKind="line"
        kinds={[{ kind: "star", label: "별", disabled: true }]}
        onSelect={() => undefined}
      />
    ));

    fireEvent.focus(screen.getByRole("option", { name: "별" }));
    expect(screen.getByRole("tooltip").textContent).toContain(
      "현재 작업 상태에서는 이 도형을 사용할 수 없습니다."
    );
  });
});
