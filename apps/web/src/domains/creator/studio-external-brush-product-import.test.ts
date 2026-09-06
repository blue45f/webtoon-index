import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CSP_TOOL_FILE_LIMITS } from "../../../../../packages/studio-format-gateway/src/csp-sut";
import { buildAuthoredSutFixture } from "../../../../../tests/corpus/formats/csp-sut-fixtures";
import { buildKritaBundleFixture } from "../../../../../tests/corpus/formats/krita-bundle-fixtures";

import {
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  type BrushLibraryStorage,
} from "./brush/studio-brush-library";
import {
  openProductBrushLibraryRepository,
  readAllBrushesFromRepository,
} from "./brush/studio-brush-library-sqlite-repository";
import {
  importAndCommitStudioBrushProgramFile,
  commitStudioBrushPackImport,
  importStudioCspToolBytes,
  studioBrushPackImportNotes,
} from "./brush/studio-brush-pack-import";
import {
  createBrowserCspSutSqliteReader,
  type StudioCspSutSqliteWorkerLike,
} from "./studio-csp-sut-sqlite-reader-client";
import {
  STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
  type StudioCspSutSqliteWorkerRequest,
  type StudioCspSutSqliteWorkerResponse,
} from "./studio-csp-sut-sqlite-reader-protocol";
import { readStudioCspSutSqliteSnapshot } from "./studio-csp-sut-sqlite-reader-runtime";
import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "./studio-local-database";

let sqlite3: StudioSqliteApiHandle;
const databases: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = await module.default() as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of databases) await database.close();
});

async function openProduct() {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  databases.push(database);
  const legacyStorage: BrushLibraryStorage = {
    getItem: (key) => key === BRUSH_LIBRARY_KEY
      ? JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes: [] })
      : null,
    setItem: vi.fn(),
  };
  return openProductBrushLibraryRepository({
    storage: legacyStorage,
    acquireDatabase: () => Promise.resolve(database),
  });
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

class ProductFixtureWorker implements StudioCspSutSqliteWorkerLike {
  private readonly messages = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly failures = new Set<() => void>();
  readonly terminate = vi.fn();

  postMessage(request: StudioCspSutSqliteWorkerRequest, transfer: Transferable[]): void {
    const cloned = structuredClone(request, { transfer });
    queueMicrotask(() => {
      void readStudioCspSutSqliteSnapshot(new Uint8Array(cloned.bytes), cloned.context).then(
        (snapshot) => {
          const response: StudioCspSutSqliteWorkerResponse = {
            version: STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION,
            requestId: cloned.requestId,
            ok: true,
            snapshot,
          };
          for (const listener of this.messages) {
            listener({ data: response } as MessageEvent<unknown>);
          }
        },
        () => {
          for (const listener of this.failures) listener();
        },
      );
    });
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | (() => void),
  ): void {
    if (type === "message") this.messages.add(listener as (event: MessageEvent<unknown>) => void);
    else this.failures.add(listener as () => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | (() => void),
  ): void {
    if (type === "message") this.messages.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.failures.delete(listener as () => void);
  }
}

describe("external creative formats → V12 SQLite brush catalog", () => {
  it("reads authored SUT in the isolated Worker and batch-commits all verified programs", async () => {
    const product = await openProduct();
    expect(product.authority).toBe("sqlite");
    expect(product.migration).toBeNull();
    const worker = new ProductFixtureWorker();
    const bytes = buildAuthoredSutFixture({ group: true });
    const committed = await importAndCommitStudioBrushProgramFile(
      new File([ownedArrayBuffer(bytes)], "authored.sut", { type: "application/octet-stream" }),
      "sut",
      product.repository,
      {
        cspSqliteReader: createBrowserCspSutSqliteReader({
          workerFactory: () => worker,
        }),
      },
    );

    expect(committed.saved).toEqual({ savedCount: 2, skippedDuplicateCount: 0 });
    expect(committed.result.preservation).toMatchObject({
      status: "structured-partial",
      originalBytesUnmodified: true,
    });
    expect(committed.result.rights?.licenses).toContain("CC0-1.0");
    expect(committed.result.unsupported?.some(({ code }) => code === "sut-column-unmapped"))
      .toBe(true);
    const stored = await readAllBrushesFromRepository(product.repository);
    expect(stored).toHaveLength(2);
    expect(stored.every(({ sourcePresetId }) => sourcePresetId?.startsWith("csp-sut:"))).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("materializes every verified KPP/MYB resource and surfaces bundle rights", async () => {
    const product = await openProduct();
    const bytes = buildKritaBundleFixture({ compression: "stored" });
    const committed = await importAndCommitStudioBrushProgramFile(
      new File([ownedArrayBuffer(bytes)], "authored.bundle", {
        type: "application/x-krita-resourcebundle",
      }),
      "bundle",
      product.repository,
    );

    expect(committed.saved.savedCount).toBe(3);
    expect(committed.materialized).toHaveLength(3);
    expect(committed.result.brushes.map(({ sourcePath }) => sourcePath)).toEqual([
      "paintoppresets/ink-basic.kpp",
      "paintoppresets/pressure.kpp",
      "paintoppresets/wash.myb",
    ]);
    expect(studioBrushPackImportNotes(committed.result).join(" ")).toContain("CC0-1.0");
    expect(studioBrushPackImportNotes(committed.result).join(" ")).toContain("미지원 항목");
    expect(await readAllBrushesFromRepository(product.repository)).toHaveLength(3);
  });

  it("does not call putMany or report success for a preserve-only SUT", async () => {
    const product = await openProduct();
    const putMany = vi.spyOn(product.repository, "putMany");
    const result = await importStudioCspToolBytes(
      buildAuthoredSutFixture({ includeMaterial: false }),
      "opaque.sut",
      "sut",
      async () => ({
        sqliteVersion: "3.53.0",
        tables: [{
          name: "OpaqueVendorState",
          columns: ["Payload"],
          rows: [{ Payload: Uint8Array.from([1, 2, 3]) }],
        }],
      }),
    );
    expect(result.brushes).toHaveLength(0);
    expect(result.preservation?.status).toBe("preserve-only");
    await expect(commitStudioBrushPackImport(result, product.repository)).rejects.toThrow(
      "보존 판정",
    );
    expect(putMany).not.toHaveBeenCalled();
    expect(await product.repository.query({ limit: CSP_TOOL_FILE_LIMITS.maxRows })).toMatchObject({
      items: [],
    });
  });
});
