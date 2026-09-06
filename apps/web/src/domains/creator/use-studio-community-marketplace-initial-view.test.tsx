// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { useStudioCommunityMarketplaceInitialView } from "./use-studio-community-marketplace-initial-view";

function InitialViewProbe() {
  const initialView = useStudioCommunityMarketplaceInitialView();
  return <output data-testid="initial-view">{initialView}</output>;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({
        hash: location.hash,
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      })}
    </output>
  );
}

function RemountProbe() {
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setGeneration((current) => current + 1)}>
        패널 다시 열기
      </button>
      <InitialViewProbe key={generation} />
      <LocationProbe />
    </>
  );
}

afterEach(cleanup);

describe("useStudioCommunityMarketplaceInitialView", () => {
  it("share를 한 번만 적용하고 다른 URL 부분과 route state를 보존한다", async () => {
    const routeState = {
      studioWorkspaceReturn: {
        pathname: "/studio/work/work-1/canvas",
        version: 1,
      },
    };

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/studio/work/work-1/canvas",
            search:
              "?room=live-1&assetMarket=community&communityView=share&titleId=title-1",
            hash: "#asset-market",
            state: routeState,
          },
        ]}
      >
        <RemountProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("initial-view").textContent).toBe("share");
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
        hash: "#asset-market",
        pathname: "/studio/work/work-1/canvas",
        search: "?room=live-1&assetMarket=community&titleId=title-1",
        state: routeState,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "패널 다시 열기" }));

    expect(screen.getByTestId("initial-view").textContent).toBe("community");
  });
});
