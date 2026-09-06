import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CSP_TOOL_FILE_LIMITS } from "../../../../../packages/studio-format-gateway/src/csp-sut";
import { buildAuthoredSutFixture } from "../../../../../tests/corpus/formats/csp-sut-fixtures";

import type { Browser, Page } from "playwright";
import type { ViteDevServer } from "vite";

const ENABLED = process.env.CSP_SUT_BROWSER_PROBE === "1";
const describeBrowser = ENABLED ? describe : describe.skip;

interface BrowserSnapshotSummary {
  readonly sqliteVersion: string;
  readonly tableNames: string[];
  readonly toolRows: number;
  readonly firstToolName: string;
  readonly elapsedMs: number;
}

describeBrowser("real Chromium SUT sqlite-wasm Worker fixture", () => {
  let vite: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let baseUrl: string;

  beforeAll(async () => {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: resolve(import.meta.dirname, "../../.."),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("Vite fixture server did not bind a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(`${baseUrl}/tests/format-gateway/csp-sut-worker-harness.html`);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
  });

  it("loads sqlite-wasm inside the production module Worker and snapshots authored bytes", async () => {
    const source = buildAuthoredSutFixture({ group: true });
    const original = source.slice();
    const base64 = Buffer.from(source).toString("base64");
    const summary = await page.evaluate(async ({ encoded, limits }) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const importModule = new Function("u", "return import(u)") as (
        url: string,
      ) => Promise<{
        createBrowserCspSutSqliteReader: () => (
          input: Uint8Array,
          context: Record<string, number | string>,
        ) => Promise<{
          sqliteVersion?: string;
          tables: Array<{
            name: string;
            rows: Array<Record<string, unknown>>;
          }>;
        }>;
      }>;
      const module = await importModule(
        "/src/domains/creator/studio-csp-sut-sqlite-reader-client.ts",
      );
      const reader = module.createBrowserCspSutSqliteReader();
      const startedAt = performance.now();
      const snapshot = await reader(bytes, { kind: "sut", ...limits });
      const elapsedMs = performance.now() - startedAt;
      const tools = snapshot.tables.find(({ name }) => name === "ToolProperty");
      return {
        sqliteVersion: snapshot.sqliteVersion ?? "",
        tableNames: snapshot.tables.map(({ name }) => name),
        toolRows: tools?.rows.length ?? 0,
        firstToolName: String(tools?.rows[0]?.Name ?? ""),
        elapsedMs,
      } satisfies BrowserSnapshotSummary;
    }, {
      encoded: base64,
      limits: {
        maxTables: CSP_TOOL_FILE_LIMITS.maxTables,
        maxColumnsPerTable: CSP_TOOL_FILE_LIMITS.maxColumnsPerTable,
        maxRows: CSP_TOOL_FILE_LIMITS.maxRows,
        maxBlobBytes: CSP_TOOL_FILE_LIMITS.maxBlobBytes,
        maxTextCharacters: CSP_TOOL_FILE_LIMITS.maxTextCharacters,
      },
    });

    expect(summary.sqliteVersion).toMatch(/^3\./u);
    expect(summary.tableNames).toEqual(["MaterialFile", "ToolProperty"]);
    expect(summary.toolRows).toBe(2);
    expect(summary.firstToolName).toBe("Authored CSP Ink");
    expect(summary.elapsedMs).toBeGreaterThan(0);
    expect(source).toEqual(original);
    console.info(
      `CSP SUT browser Worker: ${summary.elapsedMs.toFixed(2)}ms, SQLite ${summary.sqliteVersion}`,
    );
  });
});
