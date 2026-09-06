import { describe, expect, it } from "vitest";

import {
  createStudioDccNavigationState,
  isStudioWorkspaceLocation,
  isStudioWorkspaceRoutePathname,
  parseStudioWorkspaceRoute,
  shouldPreserveStudioRouteLifecycle,
  studio2dHref,
  studioCanvasHref,
  studioDccHref,
  studioRouteStageKey,
  studioWorkspaceReturnHref,
} from "./studio-workspace-route";

describe("studio workspace routes", () => {
  it.each([
    ["/studio", "", "canvas", null, null, "/studio"],
    ["/studio?id=legacy", "?id=legacy", "canvas", "legacy", null, "/studio/work/legacy/canvas"],
    ["/studio/work/work-1", "", "canvas", "work-1", null, "/studio/work/work-1/canvas"],
    ["/studio/work/work-1/canvas", "", "canvas", "work-1", null, "/studio/work/work-1/canvas"],
    ["/studio/comic", "", "comic", null, null, "/studio/comic"],
    ["/studio/work/work-1/animation", "", "animation", "work-1", null, "/studio/work/work-1/animation"],
    ["/studio/work/work-1/brushes", "", "brushes", "work-1", null, "/studio/work/work-1/brushes"],
    ["/studio/work/work-1/bg3d", "", "bg3d", "work-1", null, "/studio/work/work-1/bg3d"],
    ["/studio/work/work-1/poser", "", "poser", "work-1", null, "/studio/work/work-1/poser"],
    ["/studio/character", "", "character", null, null, "/studio/character"],
    ["/studio/work/work-1/character", "", "character", "work-1", null, "/studio/work/work-1/character"],
    ["/studio/remix/source-1/canvas", "", "canvas", null, null, "/studio/remix/source-1/canvas"],
    ["/studio?remix=source-1", "?remix=source-1", "canvas", null, null, "/studio/remix/source-1/canvas"],
    ["/studio/3d", "", "dcc", null, "model", "/studio/3d/dcc/model"],
    ["/studio/3d/dcc/sculpt", "", "dcc", null, "sculpt", "/studio/3d/dcc/sculpt"],
    ["/studio/work/work-1/3d", "", "dcc", "work-1", "model", "/studio/work/work-1/3d/dcc/model"],
    ["/studio/work/work-1/3d/dcc/shot", "", "dcc", "work-1", "shot", "/studio/work/work-1/3d/dcc/shot"],
  ] as const)(
    "parses %s as a durable %s workspace route",
    (rawPath, search, surface, workId, dccMode, canonicalPathname) => {
      const pathname = rawPath.split("?")[0];
      const route = parseStudioWorkspaceRoute({ pathname, search });
      expect(route).toMatchObject({
        canonicalPathname,
        dccMode,
        surface,
        valid: true,
        workId,
      });
    },
  );

  it.each([
    ["/studio/work", "", "invalid-work-id"],
    ["/studio//3d/dcc/model", "", "invalid-path"],
    ["/studio/work//canvas", "", "invalid-path"],
    ["/studio/work/work-1//3d/dcc/model", "", "invalid-path"],
    ["/studio/work/%5C/canvas", "", "invalid-work-id"],
    ["/studio/work/work-1/3d/dcc/unknown", "", "invalid-path"],
    ["/studio/avatar", "", "invalid-path"],
    ["/studio/work/work-1/canvas", "?id=work-2", "work-id-conflict"],
    ["/studio/work/work-1/canvas", "?id=work-1&id=work-1", "invalid-work-id"],
    ["/studio", "?id=work-1&id=work-2", "invalid-work-id"],
    ["/studio", "?id=..", "invalid-work-id"],
    ["/studio/remix", "", "invalid-remix-id"],
    ["/studio", "?remix=source-1&remix=source-1", "invalid-remix-id"],
    ["/studio/work/work-1/canvas", "?remix=source-1", "identity-conflict"],
    ["/studio", "?id=work-1&remix=source-1", "identity-conflict"],
    ["/studio", "?mode=upload&mode=upload", "invalid-mode"],
    ["/studio/3d/dcc/model", "?mode=upload", "invalid-mode"],
  ] as const)("fails closed for %s", (pathname, search, errorCode) => {
    expect(parseStudioWorkspaceRoute({ pathname, search })).toEqual({
      errorCode,
      valid: false,
    });
  });

  it("builds canonical canvas and DCC hrefs without legacy identity or upload switches", () => {
    const search = "?id=work-1&mode=upload&room=room-2&remix=source-3";
    expect(studioCanvasHref({ search, workId: "work/한글" })).toBe(
      "/studio/work/work%2F%ED%95%9C%EA%B8%80/canvas?room=room-2",
    );
    expect(studioDccHref({ mode: "cad", search, workId: "work/한글" })).toBe(
      "/studio/work/work%2F%ED%95%9C%EA%B8%80/3d/dcc/cad?room=room-2",
    );
    expect(studio2dHref({
      remixSourceWorkId: "source/한글",
      search,
      surface: "animation",
      workId: null,
    })).toBe(
      "/studio/remix/source%2F%ED%95%9C%EA%B8%80/animation?room=room-2",
    );
    expect(studio2dHref({
      search: "",
      surface: "brushes",
      workId: "work-1",
    })).toBe("/studio/work/work-1/brushes");
    expect(parseStudioWorkspaceRoute({
      pathname: "/studio/work/work%2F%ED%95%9C%EA%B8%80/3d/dcc/cad",
    })).toMatchObject({ valid: true, workId: "work/한글" });
  });

  it("keeps one route-stage lifecycle only within the same Studio document", () => {
    expect(studioRouteStageKey("/studio")).toBe("/studio/draft/editor");
    expect(studioRouteStageKey("/studio/work/work-1/3d/dcc/model")).toBe(
      "/studio/work:work-1/editor",
    );
    expect(studioRouteStageKey({
      pathname: "/studio",
      search: "?id=work-1",
    })).toBe("/studio/work:work-1/editor");
    expect(studioRouteStageKey({
      pathname: "/studio/work/work-1/canvas",
      search: "?mode=upload",
    })).toBe("/studio/work:work-1/upload");
    expect(studioRouteStageKey({
      pathname: "/studio",
      search: "?remix=source-1",
    })).toBe("/studio/remix:source-1/editor");
    expect(studioRouteStageKey({
      pathname: "/studio/work/work-1/canvas",
      search: "?mode=upload&mode=upload",
    })).toBe("/studio/work/work-1/canvas?mode=upload&mode=upload");
    expect(studioRouteStageKey({
      pathname: "/studio/tools-companion",
      search: "?session=primary-a-1234",
    })).toBe("/studio/tools-companion?session=primary-a-1234");
    expect(studioRouteStageKey({
      pathname: "/studio/work/work-1/canvas",
      search: "?id=work-2",
    })).toBe("/studio/work/work-1/canvas?id=work-2");
    expect(studioRouteStageKey("/ranking")).toBe("/ranking");
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/work/work-1/canvas",
      "/studio/work/work-1/3d/dcc/model",
    )).toBe(true);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/work/work-1/3d/dcc/model",
      "/studio/work/work-1/3d/dcc/shot",
    )).toBe(true);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/work/work-1/canvas",
      "/studio/work/work-2/3d/dcc/model",
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio",
      "/studio/work/work-1/canvas",
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      { pathname: "/studio", search: "?id=work-1" },
      { pathname: "/studio/work/work-1/canvas", search: "" },
    )).toBe(true);
    expect(shouldPreserveStudioRouteLifecycle(
      { pathname: "/studio", search: "?remix=source-1" },
      { pathname: "/studio/remix/source-1/3d/dcc/model", search: "" },
    )).toBe(true);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/remix/source-1/canvas",
      "/studio/remix/source-2/canvas",
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/work/work-1/canvas",
      "/studio/tools-companion",
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      "/studio/work/work-1/canvas",
      "/studio/avatar",
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      { pathname: "/studio/work/work-1/canvas", search: "" },
      { pathname: "/studio/work/work-1/canvas", search: "?mode=upload" },
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle(
      { pathname: "/studio/work/work-1/canvas", search: "" },
      {
        pathname: "/studio/work/work-1/canvas",
        search: "?mode=upload&mode=upload",
      },
    )).toBe(false);
    expect(shouldPreserveStudioRouteLifecycle("/studio", "/ranking")).toBe(false);
  });

  it("distinguishes Studio delivery paths from actual workspace routes", () => {
    expect(isStudioWorkspaceRoutePathname("/studio")).toBe(true);
    expect(isStudioWorkspaceRoutePathname("/studio/work/work-1/3d/dcc/cad")).toBe(true);
    expect(isStudioWorkspaceRoutePathname("/studio/tools-companion")).toBe(false);
    expect(isStudioWorkspaceRoutePathname("/studio//3d/dcc/model")).toBe(false);
    expect(isStudioWorkspaceRoutePathname("/studio/avatar")).toBe(false);
    expect(isStudioWorkspaceLocation({
      pathname: "/studio/work/work-1/canvas",
      search: "?id=work-2",
    })).toBe(false);
  });

  it("accepts only same-document canvas return receipts", () => {
    const canvasRoute = parseStudioWorkspaceRoute({
      pathname: "/studio/work/work-1/canvas",
    });
    const dccRoute = parseStudioWorkspaceRoute({
      pathname: "/studio/work/work-1/3d/dcc/model",
    });
    expect(canvasRoute.valid).toBe(true);
    expect(dccRoute.valid).toBe(true);
    if (!canvasRoute.valid || !dccRoute.valid) throw new Error("fixture route failed");
    const state = createStudioDccNavigationState(canvasRoute, {
      key: "canvas-entry",
      pathname: "/studio/work/work-1/canvas",
      search: "?room=team-2",
    });
    expect(studioWorkspaceReturnHref(state, dccRoute)).toBe(
      "/studio/work/work-1/canvas?room=team-2",
    );
    expect(studioWorkspaceReturnHref({
      studioWorkspaceReturn: {
        ...state.studioWorkspaceReturn,
        workId: "work-2",
      },
    }, dccRoute)).toBeNull();
    expect(studioWorkspaceReturnHref({
      studioWorkspaceReturn: {
        ...state.studioWorkspaceReturn,
        pathname: "/ranking",
      },
    }, dccRoute)).toBeNull();
  });

  it("reads return receipts without invoking hostile accessors", () => {
    const route = parseStudioWorkspaceRoute({ pathname: "/studio/3d/dcc/model" });
    if (!route.valid) throw new Error("fixture route failed");
    const state = {};
    Object.defineProperty(state, "studioWorkspaceReturn", {
      get() {
        throw new Error("must not execute");
      },
    });
    expect(studioWorkspaceReturnHref(state, route)).toBeNull();
  });

  it("keeps remix identity in DCC entry and return receipts", () => {
    const canvasRoute = parseStudioWorkspaceRoute({
      pathname: "/studio/remix/source-1/animation",
    });
    const dccRoute = parseStudioWorkspaceRoute({
      pathname: "/studio/remix/source-1/3d/dcc/model",
    });
    if (!canvasRoute.valid || !dccRoute.valid) throw new Error("fixture route failed");
    const state = createStudioDccNavigationState(canvasRoute, {
      key: "remix-entry",
      pathname: "/studio/remix/source-1/animation",
      search: "?room=team-2",
    });
    expect(state.studioWorkspaceReturn.remixSourceWorkId).toBe("source-1");
    expect(studioWorkspaceReturnHref(state, dccRoute)).toBe(
      "/studio/remix/source-1/animation?room=team-2",
    );
    const otherDccRoute = parseStudioWorkspaceRoute({
      pathname: "/studio/remix/source-2/3d/dcc/model",
    });
    if (!otherDccRoute.valid) throw new Error("fixture route failed");
    expect(studioWorkspaceReturnHref(state, otherDccRoute)).toBeNull();
  });
});
