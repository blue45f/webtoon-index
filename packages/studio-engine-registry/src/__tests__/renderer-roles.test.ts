import { describe, expect, it } from "vitest";

import {
  RENDERER_AUTHORITIES,
  RENDERER_AUTHORITIES_WITHOUT_PRIMARY,
  RENDERER_ROLES_DOC_PATH,
  STUDIO_RENDERER_ROLE_LEDGER,
  findLabEngineProductImports,
  isRendererRoleProductSourceFile,
  renderRendererRoleLedgerMarkdown,
  rendererRoleLedgerInvariants,
} from "../renderer-roles";

import type { RendererRoleEntry } from "../renderer-roles";

// ---------------------------------------------------------------------------
// node 내장 모듈 접근 — 이 패키지 tsconfig 는 @types/node 를 포함하지 않으므로
// (types 필드 없음 + 패키지 devDep 없음) 정적 `node:*` import 는 타입 해석이
// 안 된다. 같은 폴더의 브라우저 프로브/코퍼스 테스트와 동일하게 변수 지정자
// 동적 import + 최소 구조 타입으로 접근한다.
// ---------------------------------------------------------------------------

const dynamicImport = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

interface NodeDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface NodeFsPromisesModule {
  access(path: URL): Promise<void>;
  readdir(path: URL, options: { withFileTypes: true }): Promise<NodeDirent[]>;
  readFile(path: URL, encoding: "utf8"): Promise<string>;
}

const loadFs = async (): Promise<NodeFsPromisesModule> =>
  (await dynamicImport("node:fs/promises")) as NodeFsPromisesModule;

// packages/studio-engine-registry/src/__tests__/ -> repo root
const REPO_ROOT_URL = new URL("../../../../", import.meta.url);

const SCAN_ROOTS = ["src", "apps"] as const;
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "__snapshots__",
]);

async function pathExists(relativePath: string): Promise<boolean> {
  const fs = await loadFs();
  try {
    await fs.access(new URL(relativePath, REPO_ROOT_URL));
    return true;
  } catch {
    return false;
  }
}

/**
 * 제품 소스 파일만 한 번 걷고 내용을 미리 읽어 둔다. findLabEngineProductImports
 * 는 동기 fs 를 받으므로, 여기서 만든 맵을 그대로 주입한다.
 */
async function collectProductSources(
  roots: readonly string[],
): Promise<{
  readonly filesByRoot: ReadonlyMap<string, readonly string[]>;
  readonly contents: ReadonlyMap<string, string>;
}> {
  const fs = await loadFs();
  const filesByRoot = new Map<string, readonly string[]>();
  const contents = new Map<string, string>();

  for (const root of roots) {
    const files: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
      const currentDirectory = stack.pop() as string;
      let entries: NodeDirent[];
      try {
        entries = await fs.readdir(
          new URL(`${currentDirectory}/`, REPO_ROOT_URL),
          { withFileTypes: true },
        );
      } catch {
        continue;
      }
      for (const entry of entries) {
        const relativePath = `${currentDirectory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(entry.name)) continue;
          stack.push(relativePath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!isRendererRoleProductSourceFile(relativePath)) continue;
        files.push(relativePath);
      }
    }
    files.sort();
    filesByRoot.set(root, files);
    for (const file of files) {
      contents.set(
        file,
        await fs.readFile(new URL(file, REPO_ROOT_URL), "utf8"),
      );
    }
  }

  return { filesByRoot, contents };
}

describe("renderer role ledger invariants", () => {
  it("the real ledger has no invariant issues", () => {
    expect(rendererRoleLedgerInvariants(STUDIO_RENDERER_ROLE_LEDGER)).toEqual([]);
  });

  it("every declared authority has exactly one primary owner or an explicit reason", () => {
    const unowned = new Set(
      RENDERER_AUTHORITIES_WITHOUT_PRIMARY.map(
        (declaration) => declaration.authority,
      ),
    );
    for (const authority of RENDERER_AUTHORITIES) {
      const owners = STUDIO_RENDERER_ROLE_LEDGER.filter(
        (entry) =>
          entry.role === "primary" && entry.authorities.includes(authority),
      );
      expect(
        owners.length,
        `${authority} owners: ${owners.map((entry) => entry.id).join(", ") || "none"}`,
      ).toBe(unowned.has(authority) ? 0 : 1);
    }
  });

  it("only primary entries own authorities", () => {
    for (const entry of STUDIO_RENDERER_ROLE_LEDGER) {
      if (entry.role === "primary") {
        expect(entry.authorities.length, entry.id).toBeGreaterThan(0);
      } else {
        expect(entry.authorities, entry.id).toEqual([]);
      }
    }
  });

  it("ledger ids are unique", () => {
    const ids = STUDIO_RENDERER_ROLE_LEDGER.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports the failures it is supposed to report", () => {
    const base: RendererRoleEntry = {
      id: "fake",
      displayName: "Fake",
      role: "primary",
      authorities: ["document-display"],
      evidence: ["package.json"],
      moduleSpecifiers: [],
      note: "fake",
    };
    const issues = rendererRoleLedgerInvariants(
      [
        base,
        { ...base, targetRole: "primary" },
        { ...base, id: "empty", evidence: [] },
        { ...base, id: "labless", role: "lab", authorities: [] },
        { ...base, id: "provider-owner", role: "provider" },
      ],
      [],
    );
    expect(issues.some((issue) => issue.includes("duplicate ledger id"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("targetRole"))).toBe(true);
    expect(
      issues.some((issue) => issue.includes("evidence must not be empty")),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes("scannable identity"))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.includes('role "provider" must not own')),
    ).toBe(true);
    expect(
      issues.some((issue) => issue.includes("expected exactly 1 primary owner")),
    ).toBe(true);
  });
});

describe("renderer role ledger evidence", () => {
  it("every evidence path exists on disk", async () => {
    const missing: string[] = [];
    for (const entry of STUDIO_RENDERER_ROLE_LEDGER) {
      for (const path of entry.evidence) {
        if (!(await pathExists(path))) missing.push(`${entry.id} -> ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every adr path exists on disk", async () => {
    const missing: string[] = [];
    for (const entry of STUDIO_RENDERER_ROLE_LEDGER) {
      if (entry.adr === undefined) continue;
      if (!(await pathExists(entry.adr))) missing.push(`${entry.id} -> ${entry.adr}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("lab engines have zero product import sites", () => {
  it("classifies test and story files out of the product scan", () => {
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.ts")).toBe(true);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.tsx")).toBe(true);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.mts")).toBe(true);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.test.ts")).toBe(false);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.test.mts")).toBe(false);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.stories.tsx")).toBe(false);
    expect(isRendererRoleProductSourceFile("apps/web/src/__tests__/b.ts")).toBe(false);
    expect(isRendererRoleProductSourceFile("apps/web/src/a/b.json")).toBe(false);
  });

  it("finds a planted violation with an injected filesystem", () => {
    const violations = findLabEngineProductImports({
      roots: ["fake"],
      ledger: [
        {
          id: "planted",
          displayName: "Planted",
          role: "lab",
          authorities: [],
          evidence: ["package.json"],
          moduleSpecifiers: ["planted-engine"],
          productSymbols: ["plantedSymbol"],
          note: "planted",
        },
      ],
      listFiles: () => ["fake/product.ts", "fake/product.test.ts", "fake/clean.ts"],
      readFile: (file) => {
        if (file === "fake/product.ts") {
          return 'import { x } from "planted-engine/deep";\nplantedSymbol();\n';
        }
        if (file === "fake/product.test.ts") return 'import "planted-engine";\n';
        return 'import { y } from "other";\n';
      },
    });
    expect(violations.map((violation) => violation.file)).toEqual([
      "fake/product.ts",
      "fake/product.ts",
    ]);
    expect(
      [...violations].map((violation) => violation.specifierOrSymbol).sort(),
    ).toEqual(["planted-engine", "plantedSymbol"]);
  });

  it("has zero violations against the real src/ and apps/ trees", async () => {
    const { filesByRoot, contents } = await collectProductSources(SCAN_ROOTS);
    // 스캐너가 조용히 0개 파일을 읽고 초록으로 통과하는 회귀를 막는다.
    expect((filesByRoot.get("src") ?? []).length).toBeGreaterThan(100);

    const violations = findLabEngineProductImports({
      roots: [...SCAN_ROOTS],
      ledger: STUDIO_RENDERER_ROLE_LEDGER,
      listFiles: (root) => filesByRoot.get(root) ?? [],
      readFile: (file) => contents.get(file) ?? "",
    });
    expect(
      violations.map(
        (violation) =>
          `${violation.entryId}: ${violation.file} (${violation.specifierOrSymbol})`,
      ),
    ).toEqual([]);
  });
});

describe("renderer role ledger markdown", () => {
  it("renders deterministically", () => {
    const first = renderRendererRoleLedgerMarkdown(STUDIO_RENDERER_ROLE_LEDGER);
    const second = renderRendererRoleLedgerMarkdown(STUDIO_RENDERER_ROLE_LEDGER);
    expect(second).toBe(first);
    expect(first).toContain("GENERATED FILE");
    expect(first).toContain(
      "| id | 역할 | 목표 역할 | 권위 | 근거 경로 | 후보ID | 비고 |",
    );
  });

  it("groups primary rows before lab rows", () => {
    const markdown = renderRendererRoleLedgerMarkdown(STUDIO_RENDERER_ROLE_LEDGER);
    expect(markdown.indexOf("`konva`")).toBeLessThan(markdown.indexOf("`wesl`"));
  });

  it(`${RENDERER_ROLES_DOC_PATH} on disk equals the rendered ledger`, async () => {
    expect(
      await pathExists(RENDERER_ROLES_DOC_PATH),
      `${RENDERER_ROLES_DOC_PATH} is missing; run pnpm generate:studio-renderer-roles`,
    ).toBe(true);
    const fs = await loadFs();
    const onDisk = await fs.readFile(
      new URL(RENDERER_ROLES_DOC_PATH, REPO_ROOT_URL),
      "utf8",
    );
    expect(onDisk).toBe(
      renderRendererRoleLedgerMarkdown(STUDIO_RENDERER_ROLE_LEDGER),
    );
  });
});
