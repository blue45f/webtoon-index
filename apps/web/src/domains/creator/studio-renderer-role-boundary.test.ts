/**
 * 제품 쪽 경계 테스트.
 *
 * 원장(`@toonspectrum/studio-engine-registry`)의 `lab` 엔진은 구현이 있어도 제품
 * 호출부가 0건이어야 한다. 그 계약을 실제로 지켜야 하는 트리가 `src/` 이므로,
 * 강제 지점도 여기에 둔다. 패키지 쪽 테스트가 지워지거나 스캔 루트가 바뀌어도
 * 이 파일이 제품 코드를 계속 보호한다.
 *
 * 성능: 트리를 한 번만 걷고 파일 내용을 캐시한다.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STUDIO_RENDERER_ROLE_LEDGER,
  findLabEngineProductImports,
} from "@toonspectrum/studio-engine-registry/renderer-roles";
import { describe, expect, it } from "vitest";

// src/domains/creator -> repo root
const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
);

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__snapshots__",
]);

const fileCache = new Map<string, string>();

function walkOnce(root: string): readonly string[] {
  const absoluteRoot = join(REPO_ROOT, root);
  if (!existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  const stack: string[] = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirent.name)) continue;
        stack.push(absolute);
        continue;
      }
      if (!dirent.isFile()) continue;
      files.push(relative(REPO_ROOT, absolute).split(sep).join("/"));
    }
  }
  return files.sort();
}

function readCached(file: string): string {
  const cached = fileCache.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(join(REPO_ROOT, file), "utf-8");
  fileCache.set(file, source);
  return source;
}

describe("studio renderer role boundary", () => {
  const labEntries = STUDIO_RENDERER_ROLE_LEDGER.filter(
    (entry) => entry.role === "lab",
  );

  it("the ledger still declares lab engines to protect against", () => {
    expect(labEntries.length).toBeGreaterThan(0);
    for (const entry of labEntries) {
      expect(
        entry.moduleSpecifiers.length + (entry.productSymbols?.length ?? 0),
        `${entry.id} must declare a scannable identity`,
      ).toBeGreaterThan(0);
    }
  });

  it("no lab engine has a product import site under src/", () => {
    const violations = findLabEngineProductImports({
      roots: ["src"],
      ledger: STUDIO_RENDERER_ROLE_LEDGER,
      listFiles: walkOnce,
      readFile: readCached,
    });
    expect(
      violations.map(
        (violation) =>
          `${violation.entryId} imported by ${violation.file} via ${violation.specifierOrSymbol}`,
      ),
    ).toEqual([]);
  });

  it("scanned a non-trivial slice of the product tree", () => {
    // 스캐너가 조용히 0개 파일을 읽고 초록으로 통과하는 회귀를 막는다.
    expect(walkOnce("src").length).toBeGreaterThan(100);
  });
});
