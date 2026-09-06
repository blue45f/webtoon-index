import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("2D scene lazy import ownership", () => {
  it("keeps the literal scene boundary behind the shared retryable loader", () => {
    const registry = read("./studio-page-lazy-ui.ts");
    expect(registry).toContain("export const Studio2dSceneBrowser = lazyRetry(");
    expect(registry.match(/import\("\.\/Studio2dSceneBrowser"\)/gu)).toHaveLength(1);
    expect(registry).not.toMatch(/from ["']\.\/Studio2dSceneBrowser["']/u);
  });
  it("uses the shared lazy binding inside the scene-only Suspense boundary", () => {
    const body = read("./StudioSceneToolPopoverBody.tsx");
    expect(body).not.toContain('import("./Studio2dSceneBrowser")');
    expect(body).toMatch(/import \{\s*Studio2dSceneBrowser,[^}]+\} from "\.\/studio-page-lazy-ui"/u);
    const start = body.indexOf('{menu === "bgScene"');
    const end = body.indexOf('{menu === "tone"', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const scene = body.slice(start, end);
    expect(scene.indexOf("<Suspense")).toBeLessThan(scene.indexOf("<Studio2dSceneBrowser"));
    expect(scene).toContain('onPick={addBgScene}');
  });
});
