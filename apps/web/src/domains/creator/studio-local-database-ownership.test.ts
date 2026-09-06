import { describe, expect, it } from "vitest";

import { StudioBrushQuickSlotsSqliteRepositoryError } from "./brush/studio-brush-slots-sqlite-repository";
import { SqliteUnavailableError } from "./studio-local-database";
import {
  isStudioLocalDatabaseOwnershipBusyError,
  STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT,
} from "./studio-local-database-ownership";
import { StudioLocalDatabaseWorkerLockError } from "./studio-local-database-worker-lock";

describe("studio local database ownership busy classifier", () => {
  it("recognizes lock-unavailable and nested Worker/Sqlite envelopes", () => {
    const lock = new StudioLocalDatabaseWorkerLockError(
      "lock-unavailable",
      "Studio OPFS SQLite is already owned by another page",
    );
    expect(isStudioLocalDatabaseOwnershipBusyError(lock)).toBe(true);

    const sqlite = new SqliteUnavailableError(
      "DedicatedWorker ownership lock failed: Studio OPFS SQLite is already owned by another page",
      { cause: lock },
    );
    expect(isStudioLocalDatabaseOwnershipBusyError(sqlite)).toBe(true);

    const product = new StudioBrushQuickSlotsSqliteRepositoryError(
      "unavailable",
      `브러시 퀵 슬롯 SQLite 열기를 완료하지 못했습니다: ${sqlite.message}`,
      { cause: sqlite },
    );
    expect(isStudioLocalDatabaseOwnershipBusyError(product)).toBe(true);
    expect(STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT).toContain("세션 전용");
  });

  it("does not treat ordinary unavailable/invalid storage failures as multi-tab ownership", () => {
    expect(
      isStudioLocalDatabaseOwnershipBusyError(
        new StudioLocalDatabaseWorkerLockError(
          "web-locks-unavailable",
          "Studio OPFS SQLite requires Web Locks inside its DedicatedWorker",
        ),
      ),
    ).toBe(false);
    expect(
      isStudioLocalDatabaseOwnershipBusyError(
        new StudioBrushQuickSlotsSqliteRepositoryError(
          "invalid",
          "브러시 퀵 슬롯 SQLite 행이 손상되었거나 비정규 형식입니다.",
        ),
      ),
    ).toBe(false);
    expect(isStudioLocalDatabaseOwnershipBusyError(new Error("disk full"))).toBe(false);
    expect(isStudioLocalDatabaseOwnershipBusyError(null)).toBe(false);
  });

  it("recognizes the tournament memory-only status object from a follower tab", () => {
    expect(
      isStudioLocalDatabaseOwnershipBusyError({
        mode: "memory-only",
        durable: false,
        reason:
          "database open failed: SQLite/OPFS unavailable: studio local sqlite unavailable: DedicatedWorker ownership lock failed: Studio OPFS SQLite is already owned by another page",
      }),
    ).toBe(true);
  });
});
