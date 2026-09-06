import { describe, expect, it } from "vitest";

import { CSP_TOOL_FILE_LIMITS } from "../../../../../packages/studio-format-gateway/src/csp-sut";
import {
  buildAuthoredSutFixture,
  readAuthoredSutWithNodeSqlite,
} from "../../../../../tests/corpus/formats/csp-sut-fixtures";

import {
  StudioCspSutSqliteReaderError,
  loadStudioCspSqliteWasm,
  readStudioCspSutSqliteSnapshot,
} from "./studio-csp-sut-sqlite-reader-runtime";

const context = {
  kind: "sut" as const,
  maxTables: CSP_TOOL_FILE_LIMITS.maxTables,
  maxColumnsPerTable: CSP_TOOL_FILE_LIMITS.maxColumnsPerTable,
  maxRows: CSP_TOOL_FILE_LIMITS.maxRows,
  maxBlobBytes: CSP_TOOL_FILE_LIMITS.maxBlobBytes,
  maxTextCharacters: CSP_TOOL_FILE_LIMITS.maxTextCharacters,
};

describe("production sqlite-wasm SUT reader", () => {
  it("deserializes authored source bytes read-only and matches the independent node reader", async () => {
    const bytes = buildAuthoredSutFixture({ group: true });
    const original = bytes.slice();
    const expected = await readAuthoredSutWithNodeSqlite(bytes, context);
    let deserializeFlags = 0;
    const sqlite3 = await loadStudioCspSqliteWasm();
    const actual = await readStudioCspSutSqliteSnapshot(bytes, context, {
      loadSqlite: async () => ({
        ...sqlite3,
        capi: {
          ...sqlite3.capi,
          sqlite3_deserialize: (...args) => {
            deserializeFlags = args[5];
            return sqlite3.capi.sqlite3_deserialize(...args);
          },
        },
      }),
    });

    expect(actual.tables).toEqual(expected.tables);
    expect(actual.sqliteVersion).toMatch(/^3\./u);
    expect(bytes).toEqual(original);
    expect(deserializeFlags & sqlite3.capi.SQLITE_DESERIALIZE_READONLY).not.toBe(0);
    expect(deserializeFlags & sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE).not.toBe(0);
  });

  it("returns byte-stable deterministic snapshots", async () => {
    const bytes = buildAuthoredSutFixture({ group: true, includeMaterial: false });
    const first = await readStudioCspSutSqliteSnapshot(bytes, context);
    const second = await readStudioCspSutSqliteSnapshot(bytes, context);
    expect(second).toEqual(first);
    expect(first.tables.find(({ name }) => name === "ToolProperty")?.rows).toHaveLength(2);
  });

  it("pins sqlite-wasm READONLY behavior with a real rejected write and byte-identical export", async () => {
    const bytes = buildAuthoredSutFixture({ includeMaterial: false });
    const sqlite3 = await loadStudioCspSqliteWasm();
    const database = new sqlite3.oo1.DB(":memory:", "c");
    let allocation = sqlite3.wasm.allocFromTypedArray(bytes);
    try {
      const pointer = database.pointer;
      expect(pointer).toBeTypeOf("number");
      const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        | sqlite3.capi.SQLITE_DESERIALIZE_READONLY;
      database.checkRc(sqlite3.capi.sqlite3_deserialize(
        pointer!, "main", allocation, bytes.byteLength, bytes.byteLength, flags,
      ));
      allocation = 0;
      expect(() => database.exec("UPDATE ToolProperty SET Name = 'mutated'"))
        .toThrow(/readonly/iu);
      expect(sqlite3.capi.sqlite3_js_db_export(pointer!, "main")).toEqual(bytes);
    } finally {
      if (allocation !== 0) sqlite3.wasm.dealloc(allocation);
      database.close();
    }
  });

  it.each([
    ["table", { maxTables: 1 }],
    ["row", { maxRows: 0 }],
    ["blob", { maxBlobBytes: 1 }],
    ["column", { maxColumnsPerTable: 2 }],
  ])("rejects the %s bound before returning a partial snapshot", async (_name, override) => {
    await expect(readStudioCspSutSqliteSnapshot(
      buildAuthoredSutFixture({ group: true }),
      { ...context, ...override },
    )).rejects.toMatchObject({ code: "bounds" });
  });

  it("rejects truncation and cancellation explicitly", async () => {
    await expect(readStudioCspSutSqliteSnapshot(
      buildAuthoredSutFixture().subarray(0, 128),
      context,
    )).rejects.toMatchObject({ code: "deserialize" });

    const controller = new AbortController();
    controller.abort();
    await expect(readStudioCspSutSqliteSnapshot(
      buildAuthoredSutFixture(),
      { ...context, signal: controller.signal },
    )).rejects.toEqual(expect.objectContaining<Partial<StudioCspSutSqliteReaderError>>({
      code: "aborted",
    }));
  });
});
