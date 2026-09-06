import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { shouldAppRouterOwnDocumentTitle } from "../app-route-title-ownership";

import { creatorRoutes } from "./creator.routes";

function routeId(pathname: string) {
  return matchRoutes([...creatorRoutes], pathname)?.at(-1)?.route.id;
}

describe("independent Studio manual routes", () => {
  it("matches the manual index before the editor wildcard", () => {
    expect(routeId("/studio/manual")).toBe("creator-studio-manual");
    expect(routeId("/studio/manual/")).toBe("creator-studio-manual");
  });
  it("owns article deep links, including a friendly unknown article", () => {
    expect(routeId("/studio/manual/brushes")).toBe("creator-studio-manual-article");
    expect(routeId("/studio/manual/unknown-article")).toBe("creator-studio-manual-article");
  });
  it("preserves editor, 3D and publish routes", () => {
    for (const path of ["/studio", "/studio/character", "/studio/bg3d", "/studio/publish"]) {
      expect(routeId(path)).toBe("creator-studio");
    }
  });
  it("lets the manual own its article title without matching similar prefixes", () => {
    expect(shouldAppRouterOwnDocumentTitle({ pathname: "/studio/manual" })).toBe(false);
    expect(shouldAppRouterOwnDocumentTitle({ pathname: "/studio/manual/brushes" })).toBe(false);
    expect(shouldAppRouterOwnDocumentTitle({ pathname: "/guide" })).toBe(true);
    expect(routeId("/studio/manual-other")).toBe("creator-studio");
  });
});
