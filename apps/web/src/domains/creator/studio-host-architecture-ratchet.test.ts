import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Architecture contracts for the StudioCuttoonEditor host.
 *
 * 2026-09-02 아키텍처 리뷰 결론: "파일이 몇 줄인가"만 재는 게이트는 기계적 추출(closure bag을
 * 넘기는 분할)로 손쉽게 통과되면서 결합도는 그대로 남긴다. 그래서 이 파일은 크기 대신
 * *결합의 방향과 개수*를 고정한다 — 역방향 import, UI 컴포넌트가 받는 raw React setter 수,
 * 공개 타입의 `any` 수, UI 레이어의 직접 브라우저 API 접근 수.
 *
 * 모든 임계값은 래칫이다: 측정한 현재 값으로 얼어 있고, 정리하면서 내려갈 수는 있어도
 * 올라갈 수는 없다. 값을 올리려면 이 파일을 고쳐야 하고, 그 diff가 리뷰 대상이 된다.
 */

const CREATOR_DIR = fileURLToPath(new URL("./", import.meta.url));
const SRC_DIR = path.resolve(CREATOR_DIR, "../..");

const HOST_FILE = path.join(CREATOR_DIR, "StudioCuttoonEditorHost.tsx");
const RAIL_FILE = path.join(CREATOR_DIR, "StudioLeftToolRail.tsx");
const APP_ROUTER_FILE = path.join(SRC_DIR, "app/routes/AppRouter.tsx");
const STUDIO_ROUTER_FILE = path.join(CREATOR_DIR, "studio-router/StudioRouter.tsx");
const STUDIO_RUNTIME_DIR = path.join(CREATOR_DIR, "studio-cuttoon-editor/runtime");
const APP_ROUTE_GROUP_DIR = path.join(SRC_DIR, "app/routes/groups");
const SESSION_CORE_FILE = path.join(
  CREATOR_DIR,
  "studio-cuttoon-editor/StudioCuttoonEditorViewSessionCore.ts",
);
const SESSION_REST_FILE = path.join(
  CREATOR_DIR,
  "studio-cuttoon-editor/StudioCuttoonEditorViewSessionRest.ts",
);

/**
 * ratchet: may only decrease. 측정 2026-09-02 = 30,961줄(상한 31,000). 같은 날 저녁 main 에 먼저
 * 들어간 3D 에디터 배선(14469764)·live-ink 지우개(b49203df)·ink-wash settle(3201a1e2) 이 호스트를
 * 31,011줄로 늘려 상한을 실측값으로 재설정했다 — 그 커밋들은 이 래칫이 생기기 전에 작성된 것이다.
 * 이후로는 다시 올리지 않는다.
 *
 * 2026-09-04: 런타임 훅 추출(984251d8c)이 30,929 → 29,482줄로 줄이면서 상한을 29,459 로 적었는데
 * 그 값은 같은 커밋의 트리보다 23줄 낮아 어느 시점에도 성립한 적이 없다(호스트가 자란 것이 아니라
 * 상한이 실측보다 낮게 적힌 것). 마지막으로 성립했던 31,011 대비 1,529줄 내린 실측값으로 고정한다.
 */
const HOST_MAX_LINES = 29_482;
const ROUTER_SEAM_MAX_LINES = 100;
const STUDIO_RUNTIME_MODULE_MAX_LINES = 300;
const APP_ROUTE_GROUP_MAX_LINES = 120;

/** ratchet: may only decrease. 측정 2026-09-02. */
const SESSION_BAG_ANY_BASELINE = {
  "StudioCuttoonEditorViewSessionCore.ts": 552,
  "StudioCuttoonEditorViewSessionRest.ts": 552,
} as const;

/**
 * ratchet: fixed at zero.
 * 2026-09-04: the rail now receives one EditorClient and resolves all state changes through
 * registered commands. Host-owned React setters remain behind the adapter and may not re-enter
 * the component prop contract.
 */
const RAIL_REACT_SETTER_PROPS_MAX = 0;

/**
 * ratchet: may only decrease.
 * React 컴포넌트(.tsx)가 브라우저 플랫폼 API 를 직접 잡는 지점. 어댑터/서비스 뒤로
 * 옮길 때마다 내려간다. 측정 2026-09-02.
 */
const CREATOR_BROWSER_API_BASELINE: Readonly<Record<string, number>> = {
  "navigator.gpu": 1,
  "navigator.storage": 2,
  indexedDB: 0,
  showOpenFilePicker: 0,
  // StudioReferenceRebuildPresets.tsx opens the /assets/reference-rebuild worker itself: its
  // boundary test pins the component to a "react"-only import list, so no adapter module can
  // host the construction. Counted since 2026-09-06; move it when that boundary changes.
  "new Worker(": 1,
  "new OffscreenCanvas(": 0,
  "new WebSocket(": 0,
};

const BROWSER_API_PREFILTER = Object.keys(CREATOR_BROWSER_API_BASELINE);

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".vite"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function countAnyKeywords(sourceFile: ts.SourceFile): number {
  let total = 0;
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) total += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return total;
}

function countBrowserApiAccess(sourceFile: ts.SourceFile, into: Record<string, number>): void {
  const bump = (key: string) => {
    into[key] = (into[key] ?? 0) + 1;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const owner = node.expression.getText();
      const member = node.name.text;
      if (member === "gpu" && /(^|\.)navigator$/.test(owner)) bump("navigator.gpu");
      else if (member === "storage" && /(^|\.)navigator$/.test(owner)) bump("navigator.storage");
      else if (member === "indexedDB") bump("indexedDB");
      else if (member === "showOpenFilePicker") bump("showOpenFilePicker");
    } else if (ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node.parent)) {
      // 전역 바인딩을 그대로 쓴 경우 (`indexedDB.open(...)`).
      if (node.text === "indexedDB") bump("indexedDB");
      else if (node.text === "showOpenFilePicker") bump("showOpenFilePicker");
    }
    if (ts.isNewExpression(node)) {
      const constructed = node.expression.getText().split(".").pop();
      if (constructed === "Worker") bump("new Worker(");
      else if (constructed === "OffscreenCanvas") bump("new OffscreenCanvas(");
      else if (constructed === "WebSocket") bump("new WebSocket(");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

interface ScanResult {
  readonly browserApiCounts: Record<string, number>;
  readonly hostImporters: readonly string[];
}

/** src/ 전체를 한 번만 훑고, 파일당 한 번만 읽는다. */
function scanSourceTree(): ScanResult {
  const hostImporters: string[] = [];
  const browserApiCounts: Record<string, number> = Object.fromEntries(
    BROWSER_API_PREFILTER.map((key) => [key, 0]),
  );
  const creatorTsxRoot = `${CREATOR_DIR}`;

  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    const mentionsHost = source.includes("StudioCuttoonEditorHost");
    const isCreatorComponent =
      file.startsWith(creatorTsxRoot)
      && file.endsWith(".tsx")
      && !/\.(test|spec)\.tsx$/.test(file);
    const mentionsBrowserApi =
      isCreatorComponent && BROWSER_API_PREFILTER.some((token) => source.includes(token));

    if (!mentionsHost && !mentionsBrowserApi) continue;

    const sourceFile = parseSource(file, source);
    if (mentionsHost) {
      const importsHost = moduleSpecifiers(sourceFile).some((specifier) =>
        /(^|\/)StudioCuttoonEditorHost$/.test(specifier),
      );
      if (importsHost) hostImporters.push(path.relative(SRC_DIR, file).split(path.sep).join("/"));
    }
    if (mentionsBrowserApi) countBrowserApiAccess(sourceFile, browserApiCounts);
  }

  return { browserApiCounts, hostImporters: hostImporters.sort((a, b) => a.localeCompare(b)) };
}

const scan = scanSourceTree();

describe("studio host architecture ratchet", () => {
  it("keeps the editor host a leaf: only StudioPage may import it", () => {
    // ratchet: may only decrease.
    expect(scan.hostImporters).toEqual(["domains/creator/StudioPage.tsx"]);
  });

  it("forbids the extracted closure modules from importing their host back", () => {
    // ratchet: may only decrease.
    const reverseImports = scan.hostImporters.filter((relative) =>
      relative.startsWith("domains/creator/studio-cuttoon-editor/"),
    );
    expect(reverseImports).toEqual([]);
  });

  it("keeps StudioPage the host's lazy orchestration owner", () => {
    const page = readFileSync(path.join(CREATOR_DIR, "StudioPage.tsx"), "utf8");
    const host = readFileSync(HOST_FILE, "utf8");
    expect(page).toContain('from "./StudioCuttoonEditorHost"');
    expect(page).toContain("export { StudioCuttoonEditor }");
    expect(host).toContain("export function StudioCuttoonEditor");
  });

  it("holds the editor host under its frozen line ceiling", () => {
    // ratchet: may only decrease.
    const lines = readFileSync(HOST_FILE, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(HOST_MAX_LINES);
  });

  it("keeps application and Studio routers as small composition seams", () => {
    const measured = {
      AppRouter: readFileSync(APP_ROUTER_FILE, "utf8").split("\n").length,
      StudioRouter: readFileSync(STUDIO_ROUTER_FILE, "utf8").split("\n").length,
    };
    expect(
      Object.entries(measured)
        .filter(([, lines]) => lines > ROUTER_SEAM_MAX_LINES)
        .map(([name, lines]) => `${name}: ${lines}`),
    ).toEqual([]);
  });

  it("keeps new Studio runtime modules typed, focused, and independent of the host", () => {
    const violations: string[] = [];
    for (const entry of readdirSync(STUDIO_RUNTIME_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
      const file = path.join(STUDIO_RUNTIME_DIR, entry.name);
      const source = readFileSync(file, "utf8");
      const sourceFile = parseSource(file, source);
      const lines = source.split("\n").length;
      if (lines > STUDIO_RUNTIME_MODULE_MAX_LINES) {
        violations.push(`${entry.name}: ${lines} lines`);
      }
      const explicitAny = countAnyKeywords(sourceFile);
      if (explicitAny > 0) violations.push(`${entry.name}: ${explicitAny} explicit any`);
      if (moduleSpecifiers(sourceFile).some((specifier) =>
        /(^|\/)StudioCuttoonEditorHost$/u.test(specifier),
      )) {
        violations.push(`${entry.name}: imports StudioCuttoonEditorHost`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps domain route registries small and free of broad barrel files", () => {
    const violations: string[] = [];
    for (const entry of readdirSync(APP_ROUTE_GROUP_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx") || entry.name.includes(".test.")) continue;
      const source = readFileSync(path.join(APP_ROUTE_GROUP_DIR, entry.name), "utf8");
      const lines = source.split("\n").length;
      if (lines > APP_ROUTE_GROUP_MAX_LINES) violations.push(`${entry.name}: ${lines} lines`);
      if (entry.name === "index.tsx") violations.push("index.tsx barrel is not allowed");
    }
    expect(violations).toEqual([]);
  });

  it("holds the session closure bags under their frozen `any` ceilings", () => {
    // ratchet: may only decrease.
    const measured = {
      "StudioCuttoonEditorViewSessionCore.ts": countAnyKeywords(
        parseSource(SESSION_CORE_FILE, readFileSync(SESSION_CORE_FILE, "utf8")),
      ),
      "StudioCuttoonEditorViewSessionRest.ts": countAnyKeywords(
        parseSource(SESSION_REST_FILE, readFileSync(SESSION_REST_FILE, "utf8")),
      ),
    };
    for (const [name, ceiling] of Object.entries(SESSION_BAG_ANY_BASELINE)) {
      expect({ [name]: measured[name as keyof typeof measured] <= ceiling }).toEqual({
        [name]: true,
      });
    }
  });

  it("holds the left tool rail under its frozen raw-React-setter prop ceiling", () => {
    // ratchet: may only decrease.
    const rail = parseSource(RAIL_FILE, readFileSync(RAIL_FILE, "utf8"));
    let setterProps: number | null = null;
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === "StudioLeftToolRailProps") {
        setterProps = node.members.filter((member) => {
          if (!ts.isPropertySignature(member) || !member.type) return false;
          const typeText = member.type.getText();
          return typeText.startsWith('import("react").Dispatch<') || typeText.startsWith("Dispatch<");
        }).length;
      }
      ts.forEachChild(node, visit);
    };
    visit(rail);

    expect(setterProps).not.toBeNull();
    expect(setterProps).toBeLessThanOrEqual(RAIL_REACT_SETTER_PROPS_MAX);
  });

  it("holds direct browser-API access in creator components under its frozen table", () => {
    // ratchet: may only decrease.
    const overBudget = Object.entries(CREATOR_BROWSER_API_BASELINE)
      .filter(([api, ceiling]) => (scan.browserApiCounts[api] ?? 0) > ceiling)
      .map(([api, ceiling]) => `${api}: ${scan.browserApiCounts[api]} > ${ceiling}`);
    expect(overBudget).toEqual([]);
  });
});
