import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STUDIO_RASTER_CRDT_VERSION } from "../../../shared/lib/studio-crdt-raster-ops";

import { STUDIO_RASTER_CRDT_VERSION as liveFacadeVersion } from "./studio-crdt-raster-ops";

const CREATOR_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIB_ROOT = fileURLToPath(new URL("../../../../lib", import.meta.url));
const TEST_MODULE_IMPORT = /\.test\.tsx?(?:["']|$)/u;
const PRODUCTION_IMPORT = /^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gmu;

function isProductionSource(name: string): boolean {
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  if (name.includes(".test-fixture.")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

function walkProductionFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
        continue;
      }
      if (isProductionSource(entry)) files.push(full);
    }
  }
  return files.sort();
}

function importedSpecifiers(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  return [...withoutComments.matchAll(PRODUCTION_IMPORT)].map((match) => match[1] ?? "");
}

describe("studio production raster-ops import hygiene", () => {
  it("binds STUDIO_RASTER_CRDT_VERSION from the lib implementation through the live facade", () => {
    expect(STUDIO_RASTER_CRDT_VERSION).toBe(1);
    expect(liveFacadeVersion).toBe(STUDIO_RASTER_CRDT_VERSION);
    const facade = readFileSync(
      fileURLToPath(new URL("./studio-crdt-raster-ops.ts", import.meta.url)),
      "utf8",
    );
    expect(facade).toContain('export * from "../../../shared/lib/studio-crdt-raster-ops"');
    expect(facade).not.toMatch(/studio-crdt-raster-ops\.test/);
  });

  it("never lets production creator or lib modules import a *.test.ts(x) runtime path", () => {
    const offenders: string[] = [];
    for (const file of [...walkProductionFiles(CREATOR_ROOT), ...walkProductionFiles(LIB_ROOT)]) {
      const source = readFileSync(file, "utf8");
      const hits = importedSpecifiers(source).filter((specifier) => TEST_MODULE_IMPORT.test(specifier));
      if (hits.length === 0) continue;
      offenders.push(
        `${relative(join(CREATOR_ROOT, "../.."), file)}: ${hits.join(", ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("does not bind STUDIO_RASTER_CRDT_VERSION from studio-crdt-raster-ops.test.ts", () => {
    const rasterImporters: string[] = [];
    for (const file of [...walkProductionFiles(CREATOR_ROOT), ...walkProductionFiles(LIB_ROOT)]) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("STUDIO_RASTER_CRDT_VERSION")) continue;
      if (!source.includes("studio-crdt-raster-ops.test")) continue;
      rasterImporters.push(relative(join(CREATOR_ROOT, "../.."), file));
    }
    expect(rasterImporters).toEqual([]);
  });
});
