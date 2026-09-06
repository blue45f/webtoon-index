// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MarketplaceAssetQualityMatrix } from "./MarketplaceAssetQualityMatrix";

import {
  createCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
} from "@/shared/lib/creator-marketplace-authoring-workshop";


function Harness({ initial }: { initial: CreatorMarketplaceAuthoringDraft }): ReactElement {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <MarketplaceAssetQualityMatrix draft={draft} onChange={setDraft} />
      <output data-testid="quality-state">
        {JSON.stringify(draft.technical.qualityScenarios ?? [])}
      </output>
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("MarketplaceAssetQualityMatrix", () => {
  it("stores required brush scenarios in the shared authoring draft", () => {
    render(<Harness initial={createCreatorMarketplaceAuthoringDraft("brush")} />);

    expect(screen.getByText("필수 계획").parentElement?.textContent).toContain("0%");
    fireEvent.click(screen.getByRole("button", { name: /빠른·느린 선/u }));
    fireEvent.click(screen.getByRole("button", { name: /필압 전 구간/u }));
    fireEvent.click(screen.getByRole("button", { name: /교차·급코너/u }));

    const state = screen.getByTestId("quality-state").textContent ?? "";
    expect(state).toContain("brush-fast-slow");
    expect(state).toContain("brush-pressure");
    expect(state).toContain("brush-crossing");
    expect(screen.getByText("필수 계획").parentElement?.textContent).toContain("100%");
  });

  it("switches to type-specific 3D validation scenarios", () => {
    render(<Harness initial={createCreatorMarketplaceAuthoringDraft("3d")} />);

    expect(screen.getByRole("button", { name: /단위·실제 스케일/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /재질·텍스처/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /LOD·폴리곤/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /WebGL2·WebGPU/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /필압 전 구간/u })).toBeNull();
  });

  it("removes a selected scenario without mutating unrelated technical metadata", () => {
    const initial = {
      ...createCreatorMarketplaceAuthoringDraft("bubble"),
      technical: {
        textDirection: "vertical",
        qualityScenarios: ["bubble-fit", "bubble-vertical"],
      },
    } satisfies CreatorMarketplaceAuthoringDraft;
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /자동 텍스트 맞춤/u }));
    const state = screen.getByTestId("quality-state").textContent ?? "";
    expect(state).not.toContain("bubble-fit");
    expect(state).toContain("bubble-vertical");
  });
});
