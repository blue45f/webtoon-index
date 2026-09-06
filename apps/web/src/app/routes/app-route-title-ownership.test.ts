import { describe, expect, it } from "vitest";

import { shouldAppRouterOwnDocumentTitle } from "./app-route-title-ownership";

describe("AppRouter document title ownership", () => {
  it.each([
    ["/studio", ""],
    ["/studio/work/work-1/canvas", ""],
    ["/studio/work/work-1/3d/dcc/model", ""],
    ["/studio/work/work-1/3d/dcc/shot", "?room=team-1"],
    ["/studio", "?id=legacy-work"],
    ["/studio", "?mode=upload&id=legacy-work"],
    ["/studio/publish", "?id=legacy-work"],
    ["/studio/work/work-1/publish", ""],
    ["/studio/remix/source-1/animation", ""],
    ["/studio/projects", ""],
    ["/studio/work/work-1/versions", ""],
    ["/studio/review", ""],
    ["/studio/remix/source-1/present", ""],
    ["/studio/share", "?scope=work%3Awork-1"],
    ["/studio/join", "?invite=ts-demo"],
  ])("leaves a valid Studio child in charge for %s%s", (pathname, search) => {
    expect(shouldAppRouterOwnDocumentTitle({ pathname, search })).toBe(false);
  });

  it("does not overwrite the detached companion's surface-specific title", () => {
    expect(shouldAppRouterOwnDocumentTitle({
      pathname: "/studio/tools-companion",
      search: "?session=primary-a-1234",
    })).toBe(false);
    expect(shouldAppRouterOwnDocumentTitle({
      pathname: "/studio/companion/review",
      search: "?view=review&session=primary-a-1234",
    })).toBe(false);
  });

  it.each([
    ["/ranking", ""],
    ["/studio/avatar", ""],
    ["/studio//3d/dcc/model", ""],
    ["/studio/work/work-1/canvas", "?id=work-2"],
    ["/studio/work/work-1/canvas", "?id=work-1&id=work-1"],
    ["/studio/assets", ""],
  ])("keeps generic ownership for non-child or invalid route %s%s", (pathname, search) => {
    expect(shouldAppRouterOwnDocumentTitle({ pathname, search })).toBe(true);
  });
});
