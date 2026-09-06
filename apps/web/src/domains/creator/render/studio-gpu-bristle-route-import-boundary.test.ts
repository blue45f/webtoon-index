import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Route-side GPU-bristle import boundary.
 *
 * The failure this reproduces has already happened once in this repo, and evaded the bundle ratchet
 * because the baseline had been re-recorded from the leaking build
 * (`../studio-living-ink-route-import-boundary.test.ts:7-23`): a static chain from a durable render
 * surface pulled every WGSL kernel into the eager Studio route chunk. This lane is structured so
 * that cannot recur — the host is route-reachable and shader-free, the runtime and its WGSL are
 * reachable only through `new Worker(new URL(…, import.meta.url))`, and the host shares types with
 * the worker exclusively through `import type`, which `verbatimModuleSyntax` erases.
 *
 * The walk below is the same static value-import closure the living-ink boundary uses: dynamic
 * `import()` never matches (no bare quote after the keyword) and `import type` is excluded, which
 * is exactly the boundary being protected.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");

/** Durable render surfaces plus the lane's own route-reachable entry. */
const ROUTE_ROOTS = [
  "apps/web/src/domains/creator/brush/StudioDrawNode.tsx",
  "apps/web/src/domains/creator/export/studio-svg-export.ts",
  "apps/web/src/domains/creator/render/studio-gpu-bristle-host.ts",
] as const;

const HOST = "apps/web/src/domains/creator/render/studio-gpu-bristle-host.ts";
const DRAW_NODE = "apps/web/src/domains/creator/brush/StudioDrawNode.tsx";
const ADMISSION = "apps/web/src/domains/creator/render/studio-gpu-bristle-admission.ts";
const WGSL = "apps/web/src/domains/creator/render/studio-gpu-bristle-wgsl.ts";
const RUNTIME = "apps/web/src/domains/creator/render/studio-gpu-bristle-runtime.ts";
const WORKER = "apps/web/src/domains/creator/render/studio-gpu-bristle.worker.ts";
const FABRIC = "apps/web/src/domains/creator/render/studio-gpu-fabric.ts";

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

describe("gpu-bristle route import boundary", () => {
  const closure = staticImportClosure(ROUTE_ROOTS);

  it("walks from the host into the shader-free admission leaf (walker sanity)", () => {
    // Without this, every boundary assertion below could pass vacuously on an under-matching walker.
    expect(closure.has(HOST)).toBe(true);
    expect(closure.has(ADMISSION)).toBe(true);
  });

  it("never reaches the WGSL library, the runtime, the worker or the GPU fabric", () => {
    expect(closure.has(WGSL)).toBe(false);
    expect(closure.has(RUNTIME)).toBe(false);
    expect(closure.has(WORKER)).toBe(false);
    // studio-gpu-fabric.ts value-imports ./studio-gpu-filter-runtime at :28, so reaching the fabric
    // drags the whole GPU filter runtime into the route closure with it.
    expect(closure.has(FABRIC)).toBe(false);
  });

  it("keeps WGSL kernel text out of the entire route-reachable closure", () => {
    const filesCarryingKernels = [...closure].filter((file) =>
      readFileSync(path.join(ROOT, file), "utf8").includes("@compute"),
    );
    expect(filesCarryingKernels).toEqual([]);
  });

  it("reaches the worker only through a lazy Worker URL and shares types by `import type`", () => {
    const host = readFileSync(path.join(ROOT, HOST), "utf8");
    // Positive: the boundary mechanism is present and points at this lane's worker.
    expect(host).toContain('new Worker(new URL("./studio-gpu-bristle.worker.ts", import.meta.url)');
    // Negative: no static value import of anything GPU-bearing.
    const hostSpecifiers = staticImportSpecifiers(host);
    expect(hostSpecifiers).not.toContain("./studio-gpu-bristle-runtime");
    expect(hostSpecifiers).not.toContain("./studio-gpu-bristle-wgsl");
    expect(hostSpecifiers).not.toContain("./studio-gpu-fabric");
    // The runtime types the host shares must cross as an all-type import. Under
    // `verbatimModuleSyntax` an inline `{ type X }` import still emits a real module edge.
    expect(host).toContain('import type { StudioGpuBristleSurface } from "./studio-gpu-bristle-runtime";');
    expect(host).not.toMatch(/^import \{[^}]*\btype StudioGpuBristleSurface\b/mu);
  });

  it("keeps the worker as the single owner of the runtime and the shaders", () => {
    const worker = readFileSync(path.join(ROOT, WORKER), "utf8");
    const workerSpecifiers = staticImportSpecifiers(worker);
    expect(workerSpecifiers).toContain("./studio-gpu-bristle-runtime");
    const runtime = readFileSync(path.join(ROOT, RUNTIME), "utf8");
    const runtimeSpecifiers = staticImportSpecifiers(runtime);
    expect(runtimeSpecifiers).toContain("./studio-gpu-bristle-wgsl");
    expect(runtimeSpecifiers).toContain("./studio-gpu-fabric");
    // The WGSL module itself must stay a leaf: shader text and one grain helper, nothing else.
    const wgsl = readFileSync(path.join(ROOT, WGSL), "utf8");
    expect(wgsl).toContain("@compute");
    expect(staticImportSpecifiers(wgsl)).toEqual(["./studio-webgpu-r8-grain-native"]);
  });

  it("never executes the Canvas oil carrier for a selected GPU-bristle brush", () => {
    const drawNode = readFileSync(path.join(ROOT, DRAW_NODE), "utf8");
    const selection = drawNode.indexOf("const gpuBristleSelected =");
    const carrier = drawNode.indexOf("const paintInput =", selection);
    expect(selection).toBeGreaterThan(-1);
    expect(carrier).toBeGreaterThan(selection);
    const selectedBranch = drawNode.slice(selection, carrier);
    expect(selectedBranch).toContain("if (gpuBristleSelected) {");
    expect(selectedBranch).toContain("if (!gpuBristle) return;");
    expect(selectedBranch).toContain("if (!overlay) return;");
    expect(selectedBranch).not.toContain("paintStudioOilRibbonCarrier");
  });

  it("requests the selected GPU lane for pointer drafts without enabling transform-draft jobs", () => {
    const drawNode = readFileSync(path.join(ROOT, DRAW_NODE), "utf8");
    const selection = drawNode.indexOf("const gpuBristleSelected =");
    const selectedBranch = drawNode.slice(
      selection,
      drawNode.indexOf("const paintInput =", selection),
    );
    expect(selectedBranch).toContain("gpuBristleSelected && (durableDocumentRender || activeDraft)");
    expect(selectedBranch).not.toContain("gpuBristleSelected && durableDocumentRender");
    expect(selectedBranch).toContain("if (!gpuBristle) return;");
  });
});
