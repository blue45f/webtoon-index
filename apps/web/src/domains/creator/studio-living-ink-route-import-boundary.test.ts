import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Route-side living-ink import boundary (2026-08-14 brush wave, bundle-discipline fix).
 *
 * Adversarial review probe being reproduced: the wave's static chain
 * `studio-brush-alias-profile.ts → studio-living-ink-settled-bake-v1.ts →
 * studio-living-ink-wgsl-shaders.ts` leaked all seventeen `@compute` WGSL kernel sources
 * (~74 KB raw / ~21.6 KB gzip, duplicated with the Worker chunk) into the eager studio route
 * chunk, and the bundle ratchet had been re-recorded from that same build so the gate could not
 * veto it. The route only ever executes the CPU reference solver, which now lives in the
 * shader-free leaf `studio-living-ink-fluid-reference.ts`.
 *
 * This test walks the STATIC value-import graph (dynamic `import()` boundaries excluded — they
 * split chunks; `import type` excluded — erased at build) from the durable render surfaces and
 * fails if the WGSL shader library becomes route-reachable again. Before the split this walk
 * reached `studio-living-ink-wgsl-shaders.ts` in three hops; after it, the shader library must
 * stay Worker/test-only.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

/** Durable render surfaces: retained Canvas, SVG export, and the shared alias/bake boundary. */
const ROUTE_ROOTS = [
  "apps/web/src/domains/creator/brush/StudioDrawNode.tsx",
  "apps/web/src/domains/creator/export/studio-svg-export.ts",
  "apps/web/src/domains/creator/brush/studio-brush-alias-profile.ts",
  "apps/web/src/domains/creator/studio-living-ink-settled-bake-v1.ts",
] as const;

const WGSL_LIBRARY = "apps/web/src/domains/creator/studio-living-ink-wgsl-shaders.ts";
const FLUID_REFERENCE_LEAF = "apps/web/src/domains/creator/studio-living-ink-fluid-reference.ts";
const SETTLED_BAKE = "apps/web/src/domains/creator/studio-living-ink-settled-bake-v1.ts";

/**
 * Static value-import specifiers of one TS/TSX source. Line-anchored so commented-out imports
 * (`// import …`, JSDoc ` * import …`) are ignored; `[^;]*?` keeps a lazy match from crossing
 * statement boundaries while still spanning multi-line brace lists. Dynamic `import("…")` never
 * matches (no bare quote after the keyword), which is exactly the boundary this gate protects:
 * lazily loaded modules are allowed to reach the shader library, static ones are not.
 */
function staticImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    /^[ \t]*import[ \t]+(?!type\b)[^;]*?\bfrom[ \t]*["']([^"']+)["']/gm,
    /^[ \t]*import[ \t]*["']([^"']+)["']/gm,
    /^[ \t]*export[ \t]+(?!type\b)[^;]*?\bfrom[ \t]*["']([^"']+)["']/gm,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Resolves a relative or `@/` specifier to a repo-relative TS/TSX path, or null for bare deps. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const bare = specifier.split("?")[0]!.split("#")[0]!;
  let absolute: string;
  if (bare.startsWith(".")) {
    absolute = path.resolve(ROOT, path.dirname(fromFile), bare);
  } else if (bare.startsWith("@/")) {
    absolute = path.resolve(ROOT, bare.slice(2));
  } else {
    return null;
  }
  const candidates = [
    absolute,
    `${absolute}.ts`,
    `${absolute}.tsx`,
    path.join(absolute, "index.ts"),
    path.join(absolute, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (!/\.tsx?$/u.test(candidate)) continue;
    if (existsSync(candidate)) return path.relative(ROOT, candidate);
  }
  return null;
}

/** Breadth-first closure over static value imports, repo-relative paths. */
function staticImportClosure(roots: readonly string[]): ReadonlySet<string> {
  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const specifier of staticImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

describe("living-ink route import boundary", () => {
  const closure = staticImportClosure(ROUTE_ROOTS);

  it("walks through the settled bake into the CPU reference leaf (walker sanity)", () => {
    // If the walker silently under-matched imports, the boundary assertions below would pass
    // vacuously. The alias profile must reach the bake, and the bake must reach the solver leaf.
    expect(closure.has(SETTLED_BAKE)).toBe(true);
    expect(closure.has(FLUID_REFERENCE_LEAF)).toBe(true);
  });

  it("never reaches the WGSL shader library from a durable render surface", () => {
    // Reviewer probe: pre-fix, alias-profile → settled-bake → wgsl-shaders put every compute
    // kernel into the eager studio route chunk. The shader library is Worker/test territory.
    expect(closure.has(WGSL_LIBRARY)).toBe(false);
  });

  it("keeps WGSL compute-kernel text out of the entire route-reachable closure", () => {
    const filesCarryingKernels = [...closure].filter((file) =>
      readFileSync(path.join(ROOT, file), "utf8").includes("@compute"),
    );
    expect(filesCarryingKernels).toEqual([]);
  });

  it("keeps the CPU reference leaf shader-free and the shader library a re-export surface", () => {
    const leaf = readFileSync(path.join(ROOT, FLUID_REFERENCE_LEAF), "utf8");
    expect(leaf).not.toContain("@compute");
    expect(leaf).not.toContain("/* wgsl */");
    // Worker runtimes and the Node suites keep one import surface: the shader library re-exports
    // the solver bindings from the leaf, so the split cannot fork the certified reference.
    const wgsl = readFileSync(path.join(ROOT, WGSL_LIBRARY), "utf8");
    expect(wgsl).toContain('} from "./studio-living-ink-fluid-reference";');
    expect(wgsl).toContain("createStudioLivingInkFluidReference,");
    expect(wgsl).toContain("stepStudioLivingInkFluidReference,");
    expect(wgsl).toContain("depositStudioLivingInkReference,");
    // The settled bake itself must import the leaf, not the shader library.
    const bake = readFileSync(path.join(ROOT, SETTLED_BAKE), "utf8");
    expect(bake).not.toMatch(/from "\.\/studio-living-ink-wgsl-shaders"/u);
  });
});
