import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 창작 표면(/create·/studio) 노출 불변식 — 차별화 표면이 사이트맵 색인이나
// 홈 랜딩 동선에서 다시 빠지는 회귀를 막는다.
describe("sitemap static routes", () => {
  const script = readFileSync(join(process.cwd(), "scripts/build-static-catalog.ts"), "utf8");
  const staticRoutes = script.match(/const STATIC_ROUTES = \[([\s\S]*?)\];/)?.[1] ?? "";

  it("keeps the creator board (/create) in the sitemap static routes", () => {
    expect(staticRoutes).toContain('"/create"');
  });

  it("keeps the core product routes in the sitemap static routes", () => {
    for (const route of ['"/"', '"/search"', '"/ranking"', '"/explore"', '"/calendar"']) {
      expect(staticRoutes).toContain(route);
    }
  });

  it("keeps the creator market landing and discovery routes indexable", () => {
    expect(staticRoutes).toContain('"/market"');
    expect(staticRoutes).toContain('"/market/browse"');
  });
});

describe("home creator funnel", () => {
  const home = readFileSync(join(process.cwd(), "apps/web/src/domains/catalog/HomePage.tsx"), "utf8");

  it("links the landing page to the creator studio and the creator board", () => {
    expect(home).toContain('href="/studio"');
    expect(home).toContain('href="/create"');
  });
});
