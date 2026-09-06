// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUiPreferencesRepository } from "./studio-ui-preferences-sqlite";
import { StudioBackgroundPanel } from "./StudioBackgroundPanel";

function createUiPreferencesHarness(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const repository = createStudioUiPreferencesRepository({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  return { values, acquire: async () => repository };
}

afterEach(() => cleanup());

describe("StudioBackgroundPanel SQLite preferences", () => {
  it("hydrates recent backgrounds and persists a newly selected preset", async () => {
    const preferences = createUiPreferencesHarness({
      "background-recent": JSON.stringify({ version: 1, ids: ["g-sunset"] }),
    });
    const onApply = vi.fn();
    const { container } = render(
      <StudioBackgroundPanel
        canvasW={720}
        canvasH={1_080}
        currentBg="#ffffff"
        onApply={onApply}
        acquireUiPreferences={preferences.acquire}
      />,
    );

    await waitFor(() => {
      const recentHeading = screen.getByText(/^(?:Recent|최근)$/u);
      expect(recentHeading.nextElementSibling?.querySelector("button")).not.toBeNull();
      expect(
        container.firstElementChild?.getAttribute("data-studio-ui-preferences-authority"),
      ).toBe("sqlite-opfs");
    });

    const white = container.querySelector<HTMLButtonElement>("[data-studio-bg-preset='s-white']");
    expect(white).not.toBeNull();
    fireEvent.click(white!);

    await waitFor(() => {
      expect(preferences.values.get("background-recent")).toContain("s-white");
    });
    expect(onApply).toHaveBeenCalledWith({
      kind: "solid",
      color: "#ffffff",
      presetId: "s-white",
    });
  });

  it("keeps the in-session editor usable and visibly marks unavailable persistence", async () => {
    const onApply = vi.fn();
    const { container } = render(
      <StudioBackgroundPanel
        canvasW={720}
        canvasH={1_080}
        currentBg="#ffffff"
        onApply={onApply}
        acquireUiPreferences={async () => { throw new Error("OPFS unavailable"); }}
      />,
    );

    expect((await screen.findByRole("status")).textContent).toContain("이번 탭에서만 유지");
    expect(
      container.firstElementChild?.getAttribute("data-studio-ui-preferences-authority"),
    ).toBe("memory-only");

    const white = container.querySelector<HTMLButtonElement>("[data-studio-bg-preset='s-white']");
    expect(white).not.toBeNull();
    fireEvent.click(white!);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
