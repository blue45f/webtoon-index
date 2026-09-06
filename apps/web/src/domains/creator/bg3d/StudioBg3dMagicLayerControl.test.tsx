// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WandSparkles } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dMagicLayerControl } from "./StudioBg3dLtPanel";

afterEach(cleanup);

interface RenderControlOptions {
  readonly enabled?: boolean;
  readonly unavailableReason?: string | null;
  readonly selectionName?: string | null;
  readonly busy?: boolean;
}

function renderControl(options: RenderControlOptions = {}) {
  const onToggle = vi.fn();
  const view = render(
    <StudioBg3dMagicLayerControl
      WandSparkles={WandSparkles}
      enabled={options.enabled ?? false}
      unavailableReason={options.unavailableReason ?? null}
      selectionName={options.selectionName ?? "상자"}
      busy={options.busy ?? false}
      onToggle={onToggle}
    />,
  );

  return { onToggle, ...view };
}

describe("Studio BG3D Magic Layer control", () => {
  it("keeps the available switch touch-sized, concise, and operable", () => {
    const { container, onToggle } = renderControl();
    const control = screen.getByRole("switch", {
      name: "선택 객체 매직 마스크",
    });
    const card = container.querySelector('[data-state="available"]');

    expect((control as HTMLButtonElement).disabled).toBe(false);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.getAttribute("aria-busy")).toBe("false");
    expect(control.className).toContain("min-h-11");
    expect(card?.className).toContain("border-accent/25");
    expect(card?.className).toContain("bg-accent/5");
    expect(control.getAttribute("aria-describedby")?.split(" ")).toEqual([
      "bg3d-magic-layer-description",
      "bg3d-magic-layer-status",
    ]);

    fireEvent.click(control);

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("uses a neutral surface and readable recovery copy when unavailable", () => {
    const { container, onToggle } = renderControl({
      unavailableReason: "보이는 프리미티브 한 개를 선택하면 사용할 수 있어요.",
    });
    const control = screen.getByRole("switch", {
      name: "선택 객체 매직 마스크",
    });
    const card = container.querySelector('[data-state="unavailable"]');
    const description = document.getElementById("bg3d-magic-layer-description");
    const status = document.getElementById("bg3d-magic-layer-status");

    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(card?.className).toContain("border-line");
    expect(card?.className).toContain("bg-card/55");
    expect(card?.className).not.toContain("border-accent/25");
    expect(description?.className).toContain("text-xs");
    expect(status?.className).toContain("text-xs");
    expect(status?.textContent).toBe(
      "보이는 프리미티브 한 개를 선택하면 사용할 수 있어요.",
    );

    fireEvent.click(control);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps an enabled option reversible when its selection becomes invalid", () => {
    const { container, onToggle } = renderControl({
      enabled: true,
      unavailableReason:
        "숨겨진 프리미티브나 숨겨진 그룹의 자식은 마스크에 나타나지 않아요. 먼저 표시해 주세요.",
    });
    const control = screen.getByRole("switch", {
      name: "선택 객체 매직 마스크",
    });
    const card = container.querySelector('[data-state="needs-attention"]');
    const status = document.getElementById("bg3d-magic-layer-status");

    expect((control as HTMLButtonElement).disabled).toBe(false);
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(card?.className).toContain("border-accent/45");
    expect(card?.className).toContain("bg-accent-soft");
    expect(status?.className).toContain("text-warn");
    expect(status?.textContent).toContain(
      "이 옵션을 끄거나 선택을 바로잡아 주세요.",
    );

    fireEvent.click(control);

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("announces capture work explicitly and blocks repeat changes while busy", () => {
    const { container, onToggle } = renderControl({ busy: true });
    const control = screen.getByRole("switch", {
      name: "선택 객체 매직 마스크",
    });
    const status = document.getElementById("bg3d-magic-layer-status");

    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-state="busy"]')).toBeTruthy();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.textContent).toBe(
      "3D 배경을 처리하는 동안에는 이 설정을 바꿀 수 없어요. 작업이 끝나면 다시 변경할 수 있습니다.",
    );

    fireEvent.click(control);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("names the selected object after activation without inflating the switch label", () => {
    renderControl({ enabled: true, selectionName: "비대칭 상자" });
    const control = screen.getByRole("switch", {
      name: "선택 객체 매직 마스크",
    });

    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("“비대칭 상자”를 동일 프레임에서 정밀 분리합니다."))
      .toBeTruthy();
  });
});
