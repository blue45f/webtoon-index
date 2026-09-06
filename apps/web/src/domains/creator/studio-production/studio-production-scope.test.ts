import { describe, expect, it } from "vitest";

import { resolveStudioRoute } from "../studio-router/studio-route-manifest";

import { resolveStudioProductionScope, studioProductionLifecycleKey } from "./studio-production-scope";

const surfaces = ["projects", "review", "versions", "present", "share", "join"] as const;

describe("production document scope", () => {
  it.each(surfaces)("preserves work and remix identities in query-based %s", (surface) => {
    for (const kind of ["work", "remix"]) {
      const identity = "회차 / A:100% ?#";
      const key = `${kind}:${identity}`;
      const pathname = `/studio/${surface}`;
      const search = `?${new URLSearchParams({ scope: key })}`;
      const result = resolveStudioProductionScope({ pathname, search });
      expect(result).toMatchObject({ valid: true, scope: { key } });
      if (!result.valid) throw new Error("scope missing");
      expect(result.scope.editorHref).toBe(`/studio/${kind}/${encodeURIComponent(identity)}/canvas`);
      expect(resolveStudioRoute({ pathname, search })).toMatchObject({
        kind: "production",
        editorHref: result.scope.editorHref,
        lifecycleKey: studioProductionLifecycleKey(surface, result.scope),
      });
    }
  });

  it.each(["review", "versions", "present"])("keeps canonical path identity for %s", (surface) => {
    for (const kind of ["work", "remix"]) {
      const pathname = `/studio/${kind}/chapter%2Fone/${surface}`;
      expect(resolveStudioProductionScope({ pathname })).toMatchObject({
        valid: true, scope: { key: `${kind}:chapter/one` },
      });
      expect(resolveStudioRoute({ pathname })).toMatchObject({
        kind: "production", editorHref: `/studio/${kind}/chapter%2Fone/canvas`,
      });
    }
  });

  it.each([
    "", "unknown:a", "work:", "work:.", "work:..", "work: a", "work:a ",
    "work:a\\b", "work:a\u0000b", `work:${"a".repeat(161)}`,
  ])("rejects invalid scope without reading a draft: %j", (scope) => {
    const location = { pathname: "/studio/share", search: new URLSearchParams({ scope }) };
    expect(resolveStudioProductionScope(location).valid).toBe(false);
    expect(resolveStudioRoute(location)).toMatchObject({ kind: "invalid" });
  });

  it.each([
    ["/studio/share", "scope=work:a&scope=work:a"],
    ["/studio/share", "scope=work:a&id=b"],
    ["/studio/share", "scope=draft&id=a"],
    ["/studio/share", "scope=work:a&remix=a"],
    ["/studio/work/a/review", "scope=work:b"],
    ["/studio/work/a/review", "scope=remix:a"],
    ["/studio/remix/a/review", "scope=draft"],
  ])("rejects ambiguous identity at %s?%s", (pathname, search) => {
    expect(resolveStudioProductionScope({ pathname, search })).toMatchObject({ valid: false });
    expect(resolveStudioRoute({ pathname, search })).toMatchObject({ kind: "invalid" });
  });

  it("accepts identical redundant identities without losing opaque characters", () => {
    expect(resolveStudioProductionScope({
      pathname: "/studio/work/a%2Fb/review", search: "scope=work%3Aa%2Fb&id=a%2Fb",
    })).toMatchObject({ valid: true, scope: { key: "work:a/b" } });
  });

  it.each(["/studio/work/%ZZ/review", "/studio/work//review", "/studio//share", "/other/share"])(
    "rejects malformed paths %s", (pathname) => {
      expect(resolveStudioProductionScope({ pathname }).valid).toBe(false);
    },
  );

  it("keeps draft distinct from work and remix lifetimes", () => {
    const locations = ["", "?scope=work:a", "?scope=work:b", "?scope=remix:a"];
    const keys = locations.map((search) => {
      const route = resolveStudioRoute({ pathname: "/studio/share", search });
      expect(route.kind).toBe("production");
      return route.lifecycleKey;
    });
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe("/studio/share");
  });
});
