import { describe, expect, it } from "vitest";

import { parseStudioWorkspaceRoute, studioWorkspaceDocumentIdentity } from "../studio-workspace-route";

import { resolveStudioRoute, studioRouteOwnsDocumentTitle } from "./studio-route-manifest";

describe("Storyworld route integration", () => {
  it.each([
    ["/studio/storyworld", "", "/studio/storyworld", "/studio/draft/storyworld", null, null],
    ["/studio/storyworld/", "", "/studio/storyworld", "/studio/draft/storyworld", null, null],
    ["/studio/storyworld", "?id=work-1&room=team-a", "/studio/work/work-1/storyworld?room=team-a", "/studio/work:work-1/storyworld", "work-1", null],
    ["/studio/work/work-1/storyworld", "", "/studio/work/work-1/storyworld", "/studio/work:work-1/storyworld", "work-1", null],
    ["/studio/remix/source-1/storyworld", "?room=team-a", "/studio/remix/source-1/storyworld?room=team-a", "/studio/remix:source-1/storyworld", null, "source-1"],
    ["/studio/storyworld", "?remix=source-1", "/studio/remix/source-1/storyworld", "/studio/remix:source-1/storyworld", null, "source-1"],
  ] as const)("canonicalizes %s%s without borrowing another document", (pathname, search, canonicalHref, lifecycleKey, workId, remixSourceWorkId) => {
    expect(resolveStudioRoute({ pathname, search })).toMatchObject({ kind: "storyworld", canonicalHref, lifecycleKey, workId, remixSourceWorkId });
  });

  it.each([
    ["/studio/storyworld", "?mode=upload"],
    ["/studio/storyworld", "?mode=canvas"],
    ["/studio/storyworld", "?mode=upload&mode=upload"],
    ["/studio/storyworld", "?id=work-1&remix=source-1"],
    ["/studio/storyworld", "?id=work-1&id=work-1"],
    ["/studio/storyworld", "?remix=source-1&remix=source-1"],
    ["/studio/work/work-1/storyworld", "?id=work-2"],
    ["/studio/remix/source-1/storyworld", "?remix=source-2"],
    ["/studio/work/%5C/storyworld", ""],
    ["/studio/work/%00/storyworld", ""],
    ["/studio/remix/%7F/storyworld", ""],
    ["/studio/work/%2E/storyworld", ""],
    ["/studio/remix/%2E%2E/storyworld", ""],
    ["/studio/work/%20work/storyworld", ""],
    ["/studio/work/%/storyworld", ""],
    ["/studio/work//storyworld", ""],
    ["/studio/storyworld/extra", ""],
  ] as const)("rejects conflicting or invalid Storyworld routes %s%s", (pathname, search) => {
    expect(resolveStudioRoute({ pathname, search }).kind).toBe("invalid");
  });

  // Studio identities are opaque: an encoded slash is data, not a path separator.
  // Verify parity with the shared validator rather than inventing a second ID policy.
  it.each(["/", "part/one", "%2F", "작품 1"])("preserves opaque identity %s across work and remix routes", (identity) => {
    for (const scope of ["work", "remix"] as const) {
      const pathname = `/studio/${scope}/${encodeURIComponent(identity)}/storyworld`;
      const workspace = parseStudioWorkspaceRoute({ pathname: pathname.replace(/storyworld$/, "canvas") });
      expect(workspace.valid).toBe(true);
      if (!workspace.valid) throw new Error("Shared Studio identity fixture must be valid");
      const resolved = resolveStudioRoute({ pathname });
      expect(resolved).toMatchObject({
        kind: "storyworld",
        canonicalHref: pathname,
        workId: workspace.workId,
        remixSourceWorkId: workspace.remixSourceWorkId,
        lifecycleKey: `/studio/${studioWorkspaceDocumentIdentity(workspace)}/storyworld`,
      });
      const queryKey = scope === "work" ? "id" : "remix";
      expect(resolveStudioRoute({ pathname: "/studio/storyworld", search: new URLSearchParams({ [queryKey]: identity }) }))
        .toEqual(resolved);
      expect(resolveStudioRoute({ pathname: resolved.kind === "storyworld" ? resolved.canonicalPathname : pathname }))
        .toEqual(resolved);
    }
  });

  it("owns its title and has distinct document lifetimes", () => {
    expect(studioRouteOwnsDocumentTitle({ pathname: "/studio/storyworld" })).toBe(true);
    const first = resolveStudioRoute({ pathname: "/studio/work/first/storyworld" });
    const second = resolveStudioRoute({ pathname: "/studio/work/second/storyworld" });
    const remix = resolveStudioRoute({ pathname: "/studio/remix/first/storyworld" });
    expect(first.lifecycleKey).not.toBe(second.lifecycleKey);
    expect(first.lifecycleKey).not.toBe(remix.lifecycleKey);
    expect(resolveStudioRoute({ pathname: "/studio/work/%2F/storyworld" }).lifecycleKey)
      .not.toBe(resolveStudioRoute({ pathname: "/studio/work/%252F/storyworld" }).lifecycleKey);
  });
});
