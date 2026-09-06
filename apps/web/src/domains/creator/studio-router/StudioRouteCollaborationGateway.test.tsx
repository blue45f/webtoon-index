// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioProductionHubPage } from "../studio-production/StudioProductionHubPage";

import { resolveStudioRoute } from "./studio-route-manifest";
import { StudioRoutePlaceholder } from "./StudioRouteFallbacks";

const database = vi.hoisted(() => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
}));

vi.mock("../studio-local-database-runtime", () => ({
  acquireStudioLocalDatabase: async () => database,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderPlaceholder(placeholderId: Parameters<typeof StudioRoutePlaceholder>[0]["placeholderId"]) {
  render(
    <MemoryRouter>
      <StudioRoutePlaceholder placeholderId={placeholderId} onOpenStudio={() => undefined} />
    </MemoryRouter>,
  );
}

describe("Studio collaboration route gateways", () => {
  // Review is now an actual production surface, not an asset-guidance placeholder. Exercise the
  // shipped surface and its scope-preserving editor exit instead of widening the placeholder API.
  it.each([
    ["/studio/review", "draft", "/studio"],
    ["/studio/work/work-1/review", "work:work-1", "/studio/work/work-1/canvas"],
    ["/studio/remix/source-1/review", "remix:source-1", "/studio/remix/source-1/canvas"],
  ])("opens the review workspace rather than a dead end at %s", async (pathname, scopeKey, editorHref) => {
    expect(resolveStudioRoute({ pathname })).toMatchObject({ kind: "production" });
    const onOpenStudio = vi.fn();
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <StudioProductionHubPage surface="review" onOpenStudio={onOpenStudio} />
      </MemoryRouter>,
    );

    await screen.findByText("SQLite/OPFS 저장됨");
    expect(database.kvGet).toHaveBeenCalledWith("studio-production-command-center-v1", scopeKey);
    expect(screen.getByRole("heading", { name: "리뷰 및 승인" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^리뷰$/u }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "원고 열기" }).getAttribute("href")).toBe(editorHref);
    expect(screen.queryByRole("button", { name: "리뷰가 연결된 Studio 열기" })).toBeNull();
    expect(database.kvSet).not.toHaveBeenCalled();
    expect(onOpenStudio).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Studio 편집기로 돌아가기" }));
    expect(onOpenStudio).toHaveBeenCalledTimes(1);
    expect(database.kvSet).not.toHaveBeenCalled();
  });

  it("keeps non-collaboration asset guidance outside the collaboration gateway contract", () => {
    renderPlaceholder("assets");

    expect(document.querySelector("[data-studio-collaboration-gateway]")).toBeNull();
    expect(screen.getByRole("button", { name: "에셋을 사용할 Studio 열기" })).toBeTruthy();
  });
});

// Preserve the complementary quality-branch checks when merging the independently migrated UI.
describe("quality review route ownership", () => {
  it.each([
    "/studio/review",
    "/studio/work/work-1/review",
    "/studio/remix/source-1/review",
  ])("retains exact production ownership for %s", (pathname) => {
    const resolution = resolveStudioRoute({ pathname, search: "", hash: "" });
    expect(resolution).toMatchObject({
      kind: "production",
      surface: "review",
      canonicalHref: pathname,
      ownsDocumentTitle: true,
    });
    expect(resolution).not.toHaveProperty("placeholderId");
  });

  it("delegates the asset guidance exit exactly once", () => {
    const onOpenStudio = vi.fn();
    render(
      <MemoryRouter>
        <StudioRoutePlaceholder placeholderId="assets" onOpenStudio={onOpenStudio} />
      </MemoryRouter>
    );
    expect(document.querySelector("[data-studio-collaboration-gateway]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "에셋을 사용할 Studio 열기" }));
    expect(onOpenStudio).toHaveBeenCalledTimes(1);
  });
});
