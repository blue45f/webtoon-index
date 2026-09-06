import { describe, expect, it } from "vitest";

import { appRoutes } from "./app-routes";

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

interface RouteSurface {
  readonly id: string;
  readonly path: string;
}

function byId(a: RouteSurface, b: RouteSurface): number {
  return a.id.localeCompare(b.id);
}

/** Independent public pages under /studio that never boot the editor (PR #794 manual, PR #816 brush lab). */
const STUDIO_PUBLIC_SURFACES: readonly RouteSurface[] = [
  { id: "creator-studio-manual", path: "/studio/manual" },
  { id: "creator-studio-manual-article", path: "/studio/manual/:articleId" },
  { id: "creator-studio-brush-lab", path: "/studio/brush-lab" },
  { id: "creator-studio-work-brush-lab", path: "/studio/work/:workId/brush-lab" },
  { id: "creator-studio-remix-brush-lab", path: "/studio/remix/:sourceWorkId/brush-lab" },
];

describe("application route registry", () => {
  it("keeps every route id and path unique", () => {
    expect(duplicates(appRoutes.map((route) => route.id))).toEqual([]);
    expect(duplicates(appRoutes.map((route) => route.path))).toEqual([]);
  });

  it("keeps the catch-all last so domain routes remain explicit", () => {
    expect(appRoutes.at(-1)).toMatchObject({
      id: "not-found",
      path: "*",
    });
  });

  it("keeps Character Shaper in the creator route registry", () => {
    expect(appRoutes).toContainEqual(
      expect.objectContaining({
        id: "creator-character-shaper",
        path: "/shaper",
      }),
    );
  });

  it("keeps Studio behind one canonical wildcard entry", () => {
    const studioRoutes = appRoutes.filter((route) => route.path.startsWith("/studio"));
    const editorEntries = studioRoutes.filter((route) => route.path.includes("*"));

    expect(editorEntries).toEqual([
      expect.objectContaining({
        id: "creator-studio",
        path: "/studio/*",
      }),
    ]);
    expect(studioRoutes.at(-1)).toMatchObject({ id: "creator-studio", path: "/studio/*" });

    // Every other /studio path is an independent public surface that must stay on this
    // allowlist. Registering a second editor entry (or any new /studio route) fails here.
    const publicSurfaces = studioRoutes
      .filter((route) => route.path !== "/studio/*")
      .map(({ id, path }) => ({ id, path }))
      .sort(byId);
    expect(publicSurfaces).toEqual([...STUDIO_PUBLIC_SURFACES].sort(byId));
  });
});
