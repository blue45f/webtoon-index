// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioAiProductionLaunchpad } from "./StudioAiProductionLaunchpad";

afterEach(cleanup);

describe("StudioAiProductionLaunchpad", () => {
  it("opens the task-first story and recipe workflows", () => {
    const onOpenScenario = vi.fn();
    const onOpenSuperSuite = vi.fn();

    render(
      <StudioAiProductionLaunchpad
        imageConfigured
        textConfigured
        onOpenScenario={onOpenScenario}
        onOpenSuperSuite={onOpenSuperSuite}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /스토리 → 편집 가능한 컷/u }));
    fireEvent.click(screen.getByRole("button", { name: /화풍·연출 레시피 만들기/u }));

    expect(onOpenScenario).toHaveBeenCalledTimes(1);
    expect(onOpenSuperSuite).toHaveBeenCalledTimes(1);
  });

  it("explains why scenario creation is unavailable without disabling local recipes", () => {
    const onOpenScenario = vi.fn();
    const onOpenSuperSuite = vi.fn();

    render(
      <StudioAiProductionLaunchpad
        imageConfigured={false}
        textConfigured={false}
        onOpenScenario={onOpenScenario}
        onOpenSuperSuite={onOpenSuperSuite}
        scenarioDisabled
        scenarioDisabledReason="마스터 편집 중에는 사용할 수 없어요."
      />
    );

    const scenarioButton = screen.getByRole("button", {
      name: /스토리 → 편집 가능한 컷/u,
    }) as HTMLButtonElement;

    expect(scenarioButton.disabled).toBe(true);
    expect(screen.queryByText("마스터 편집 중에는 사용할 수 없어요.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /화풍·연출 레시피 만들기/u }));
    expect(onOpenSuperSuite).toHaveBeenCalledTimes(1);
    expect(onOpenScenario).not.toHaveBeenCalled();
  });
});
