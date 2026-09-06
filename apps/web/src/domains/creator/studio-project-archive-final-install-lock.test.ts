import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_PROJECT_ARCHIVE_FINAL_INSTALL_LOCK_NAME,
  StudioProjectArchiveFinalInstallLockError,
  runStudioProjectArchiveFinalInstallExclusive,
  type StudioProjectArchiveFinalInstallLockManagerLike,
} from "./studio-project-archive-final-install-lock";

function immediateLockManager(): StudioProjectArchiveFinalInstallLockManagerLike {
  return {
    request: vi.fn(async (_name, _options, callback) => await callback()),
  };
}

describe("Studio project archive final install lock", () => {
  it("fails closed before running final install when Web Locks are unavailable", async () => {
    const task = vi.fn(async () => true);

    await expect(runStudioProjectArchiveFinalInstallExclusive(task, { lockManager: null }))
      .rejects.toBeInstanceOf(StudioProjectArchiveFinalInstallLockError);
    expect(task).not.toHaveBeenCalled();
  });

  it("holds one origin lock across rollback before admitting a concurrent import", async () => {
    const manager = immediateLockManager();
    const events: string[] = [];
    let provisionalRowExists = false;
    let releaseFirst = (): void => undefined;
    const firstApplyDecision = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runStudioProjectArchiveFinalInstallExclusive(async () => {
      events.push("a-created");
      provisionalRowExists = true;
      await firstApplyDecision;
      events.push("a-rollback");
      provisionalRowExists = false;
      throw new Error("A apply rejected");
    }, { lockManager: manager });
    await vi.waitFor(() => expect(provisionalRowExists).toBe(true));

    let secondStarted = false;
    const second = runStudioProjectArchiveFinalInstallExclusive(async () => {
      secondStarted = true;
      events.push("b-entered");
      // B must never classify A's provisional row as durable/shared reuse.
      expect(provisionalRowExists).toBe(false);
      events.push("b-created-own-row");
      return "B committed" as const;
    }, { lockManager: manager });
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    releaseFirst();
    await expect(first).rejects.toThrow("A apply rejected");
    await expect(second).resolves.toBe("B committed");
    expect(events).toEqual([
      "a-created",
      "a-rollback",
      "b-entered",
      "b-created-own-row",
    ]);
    expect(manager.request).toHaveBeenCalledTimes(2);
    expect(manager.request).toHaveBeenNthCalledWith(
      1,
      STUDIO_PROJECT_ARCHIVE_FINAL_INSTALL_LOCK_NAME,
      { mode: "exclusive" },
      expect.any(Function),
    );
  });
});
