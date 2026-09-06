// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceAuthoringWorkshop } from "./MarketplaceAuthoringWorkshop";

import {
  CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY,
  createCreatorMarketplaceDraftFromBrushStudio,
  serializeCreatorMarketplaceAuthoringDraft,
} from "@/shared/lib/creator-marketplace-authoring-workshop";


describe("MarketplaceAuthoringWorkshop", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("restores a Brush Studio handoff without dropping native programs", () => {
    const draft = createCreatorMarketplaceDraftFromBrushStudio({
      name: "Pencil and glow",
      enginePrograms: [
        { id: "pencil", kind: "dry-media", grain: { scale: 0.5 } },
        { id: "glow", kind: "glow", opacity: 0.4 },
      ],
    });
    window.sessionStorage.setItem(
      CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY,
      serializeCreatorMarketplaceAuthoringDraft(draft),
    );

    render(<MarketplaceAuthoringWorkshop />);

    const title = screen.getByTestId("market-authoring-title");
    expect(title).toBeInstanceOf(HTMLInputElement);
    expect((title as HTMLInputElement).value).toBe("Pencil and glow");
    fireEvent.click(screen.getByRole("tab", { name: /엔진·구성/u }));
    const list = screen.getByTestId("market-authoring-engine-list");
    expect(within(list).getAllByText("Studio 원본 보존")).toHaveLength(2);
  });

  it("adds and reorders multiple brush engine passes", () => {
    render(<MarketplaceAuthoringWorkshop />);
    fireEvent.click(screen.getByRole("tab", { name: /엔진·구성/u }));

    const add = screen.getByTestId("market-authoring-add-engine");
    const select = screen.getByLabelText("추가할 엔진");
    fireEvent.change(select, { target: { value: "watercolor-diffusion" } });
    fireEvent.click(add);
    fireEvent.change(select, { target: { value: "glow" } });
    fireEvent.click(add);

    const list = screen.getByTestId("market-authoring-engine-list");
    expect(within(list).getByText("수채 확산")).toBeTruthy();
    expect(within(list).getByText("글로우")).toBeTruthy();
    expect(within(list).getAllByRole("button", { name: "위로 이동" }).length).toBeGreaterThan(1);
  });

  it("shares the lifecycle with 3D assets while switching technical fields", () => {
    render(<MarketplaceAuthoringWorkshop />);
    fireEvent.click(screen.getByRole("button", { name: "3D 에셋" }));
    fireEvent.click(screen.getByRole("tab", { name: /엔진·구성/u }));

    expect(screen.getByLabelText("polygonCount")).toBeTruthy();
    expect(screen.getByLabelText("lodCount")).toBeTruthy();
    expect(screen.queryByTestId("market-authoring-add-engine")).toBeNull();
  });

  it("keeps publish handoff disabled until blocking rights errors are resolved", () => {
    render(<MarketplaceAuthoringWorkshop />);
    const apply = screen.getByTestId("market-authoring-apply");
    expect(apply).toBeInstanceOf(HTMLButtonElement);
    expect((apply as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("market-authoring-title"), {
      target: { value: "Production ink" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /미리보기/u }));
    fireEvent.click(screen.getByRole("button", { name: /stroke-sheet/u }));
    fireEvent.click(screen.getByRole("tab", { name: /권리/u }));
    const confirmations = screen.getAllByRole("checkbox");
    for (const checkbox of confirmations.slice(-2)) fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("tab", { name: /검수·배포/u }));
    const errorMessages = within(screen.getByTestId("market-authoring-diagnostics"))
      .queryAllByText(/필요합니다|없습니다|아닙니다/u);
    expect(errorMessages.map((node) => node.textContent).join(" ")).not.toContain("원본 제작 권리");
  });
});
