// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketplaceBrushRecipeAccelerator } from "./MarketplaceBrushRecipeAccelerator";

import {
  createCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
} from "@/shared/lib/creator-marketplace-authoring-workshop";


afterEach(() => {
  cleanup();
});

describe("MarketplaceBrushRecipeAccelerator", () => {
  it("applies a complete multi-engine recipe and its runtime requirements", () => {
    const onChange = vi.fn<(draft: CreatorMarketplaceAuthoringDraft) => void>();
    render(
      <MarketplaceBrushRecipeAccelerator
        draft={createCreatorMarketplaceAuthoringDraft("brush")}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /수채 워시/u }));
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next?.brush.engineNodes.map((node) => node.engine)).toEqual([
      "wet-media",
      "watercolor-diffusion",
      "texture-relief",
      "post-process",
    ]);
    expect(next?.compatibility.webgl2).toBe(true);
    expect(next?.brush.presetFamily).toBe("watercolor-wash");
  });

  it("adds input mappings, layered tips and duplicate engine passes", () => {
    let current = createCreatorMarketplaceAuthoringDraft("brush");
    const onChange = vi.fn((next: CreatorMarketplaceAuthoringDraft) => {
      current = next;
    });
    const view = render(
      <MarketplaceBrushRecipeAccelerator draft={current} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "고급 편집 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "매핑 추가" }));
    view.rerender(<MarketplaceBrushRecipeAccelerator draft={current} onChange={onChange} />);
    expect(current.brush.engineNodes[0]?.mappings.length).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "+ procedural" }));
    view.rerender(<MarketplaceBrushRecipeAccelerator draft={current} onChange={onChange} />);
    expect(current.brush.engineNodes[0]?.tipLayers.length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "복제" }));
    expect(current.brush.engineNodes).toHaveLength(2);
  });
});
