// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioRouter } from "./StudioRouter";

/**
 * The canonical redirect must happen at render time: no studio frame — not even
 * a Suspense fallback — may mount under a legacy alias URL, and location.state
 * (studioWorkspaceReturn v1 receipt, linked-3D recovery notice) must survive
 * the replace navigation untouched.
 */
const probe = vi.hoisted(() => ({
  editorHrefs: [] as string[],
  fallbackHrefs: [] as string[],
}));

vi.mock("@/src/compat/auth-session-store", () => ({
  useSession: () => ({
    data: null,
    ready: true,
    status: "unauthenticated",
    update: async () => null,
  }),
}));

vi.mock("../StudioLazySurfaceFallback", async () => {
  const { useLocation: useRouterLocation } = await import("react-router-dom");
  function StudioRouteLoading({ label }: { readonly label?: string }) {
    const location = useRouterLocation();
    probe.fallbackHrefs.push(`${location.pathname}${location.search}`);
    return <output data-testid="route-loading">{label}</output>;
  }
  return { StudioPanelLoading: StudioRouteLoading, StudioRouteLoading };
});

vi.mock("../studio-legacy-editor-adapter", async () => {
  const { useLocation: useRouterLocation } = await import("react-router-dom");
  return {
    LegacyStudioEditorAdapter: ({ studioRoute }: {
      readonly studioRoute: { readonly workId: string | null };
    }) => {
      const location = useRouterLocation();
      probe.editorHrefs.push(`${location.pathname}${location.search}`);
      return (
        <div data-testid="editor-surface" data-work-id={studioRoute.workId ?? ""} />
      );
    },
  };
});

vi.mock("../StudioUploadPublish", () => ({
  StudioUploadPublish: ({ workId }: { readonly workId: string | null }) => (
    <div data-testid="publish-surface" data-work-id={workId ?? ""} />
  ),
}));

vi.mock("../StudioToolsCompanionPage", () => ({
  StudioToolsCompanionPage: () => <div data-testid="companion-surface" />,
}));

vi.mock("../studio-production/StudioProductionHubPage", () => ({
  StudioProductionHubPage: ({ surface }: { readonly surface: string }) => (
    <div data-testid="production-surface" data-surface={surface} />
  ),
}));

interface ObservedLocation {
  readonly pathname: string;
  readonly search: string;
  readonly state: unknown;
}

const observedLocations: ObservedLocation[] = [];

function LocationProbe() {
  const location = useLocation();
  observedLocations.push({
    pathname: location.pathname,
    search: location.search,
    state: location.state,
  });
  return null;
}

function renderStudioShell(entry: {
  readonly pathname: string;
  readonly search?: string;
  readonly state?: unknown;
}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/studio/*" element={<StudioRouter />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const workspaceReturnState = Object.freeze({
  studioWorkspaceReturn: Object.freeze({
    entryKey: "entry-1",
    pathname: "/studio/work/work-1/canvas",
    remixSourceWorkId: null,
    search: "",
    version: 1,
    workId: "work-1",
  }),
});

const linked3dRecoveryState = Object.freeze({
  studioLinked3dCloudSaveRecovery: Object.freeze({ version: 1, workId: "work-1" }),
});

beforeEach(() => {
  probe.editorHrefs.length = 0;
  probe.fallbackHrefs.length = 0;
  observedLocations.length = 0;
});

afterEach(cleanup);

describe("StudioRouter canonical redirect", () => {
  it("redirects the legacy ?id alias before any studio frame renders and keeps state", async () => {
    renderStudioShell({
      pathname: "/studio",
      search: "?id=work-1&room=team-a",
      state: workspaceReturnState,
    });

    await screen.findByTestId("editor-surface");
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/work/work-1/canvas");
    expect(finalLocation?.search).toBe("?room=team-a");
    expect(finalLocation?.state).toBe(workspaceReturnState);

    const canonicalHref = "/studio/work/work-1/canvas?room=team-a";
    expect(probe.fallbackHrefs.length).toBeGreaterThan(0);
    expect(probe.fallbackHrefs).toEqual(
      probe.fallbackHrefs.map(() => canonicalHref),
    );
    expect(probe.editorHrefs).toEqual(
      probe.editorHrefs.map(() => canonicalHref),
    );
    expect(screen.getByTestId("editor-surface").dataset.workId).toBe("work-1");
  });

  it("keeps the linked-3D recovery state across the ?remix alias redirect", async () => {
    renderStudioShell({
      pathname: "/studio",
      search: "?remix=source-1",
      state: linked3dRecoveryState,
    });

    await screen.findByTestId("editor-surface");
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/remix/source-1/canvas");
    expect(finalLocation?.search).toBe("");
    expect(finalLocation?.state).toBe(linked3dRecoveryState);
    expect(probe.fallbackHrefs).not.toContain("/studio?remix=source-1");
    expect(probe.editorHrefs).not.toContain("/studio?remix=source-1");
  });

  it("redirects the ?mode=upload alias to the publish canonical URL with state intact", async () => {
    renderStudioShell({
      pathname: "/studio",
      search: "?mode=upload&id=work-1&titleId=title-2",
      state: workspaceReturnState,
    });

    await screen.findByTestId("publish-surface");
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/work/work-1/publish");
    expect(finalLocation?.search).toBe("?titleId=title-2");
    expect(finalLocation?.state).toBe(workspaceReturnState);
    expect(screen.getByTestId("publish-surface").dataset.workId).toBe("work-1");
  });

  it("redirects the /studio/upload alias to /studio/publish with state intact", async () => {
    renderStudioShell({
      pathname: "/studio/upload",
      search: "?challengeId=challenge-1",
      state: workspaceReturnState,
    });

    await screen.findByTestId("publish-surface");
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/publish");
    expect(finalLocation?.search).toBe("?challengeId=challenge-1");
    expect(finalLocation?.state).toBe(workspaceReturnState);
  });

  it("redirects the tools-companion alias to the companion canonical URL with state intact", async () => {
    renderStudioShell({
      pathname: "/studio/tools-companion",
      search: "?view=review&session=primary-1",
      state: workspaceReturnState,
    });

    await screen.findByTestId("companion-surface");
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/companion/review");
    expect(finalLocation?.search).toBe("?view=review&session=primary-1");
    expect(finalLocation?.state).toBe(workspaceReturnState);
  });

  it("renders the production command center route without mounting the editor", async () => {
    renderStudioShell({
      pathname: "/studio/work/work-1/review",
      state: workspaceReturnState,
    });

    const surface = await screen.findByTestId("production-surface");
    expect(surface.dataset.surface).toBe("review");
    expect(screen.queryByTestId("editor-surface")).toBeNull();
    const finalLocation = observedLocations.at(-1);
    expect(finalLocation?.pathname).toBe("/studio/work/work-1/review");
    expect(finalLocation?.state).toBe(workspaceReturnState);
  });

  it("renders a canonical URL in place without navigating and keeps its state", async () => {
    renderStudioShell({
      pathname: "/studio/work/work-1/comic",
      state: workspaceReturnState,
    });

    await screen.findByTestId("editor-surface");
    expect(observedLocations.length).toBeGreaterThan(0);
    for (const location of observedLocations) {
      expect(location.pathname).toBe("/studio/work/work-1/comic");
      expect(location.search).toBe("");
      expect(location.state).toBe(workspaceReturnState);
    }
  });
});
