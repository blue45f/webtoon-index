import { describe, expect, it } from "vitest";

import {
  acquireSemanticLock,
  checkSemanticLockPermission,
  createStudioSemanticLockTable,
  forceRevokeSemanticLock,
  purgeExpiredLeases,
  releaseSemanticLock,
  renewSemanticLease,
} from "./studio-semantic-lock";

describe("Studio Semantic Lock Manager", () => {
  it("acquires and releases hard locks", () => {
    let table = createStudioSemanticLockTable({ id: "t_1" });
    const now = 1_000_000;

    const res = acquireSemanticLock(table, {
      id: "l_1",
      targetId: "panel_1",
      targetKind: "panel",
      kind: "hard",
      holderUserId: "user_a",
      holderRole: "lineart",
      nowMs: now,
    });
    table = res.table;

    // Check permission for holder
    const holderPerm = checkSemanticLockPermission(table, "panel_1", "user_a", "lineart", now);
    expect(holderPerm.allowed).toBe(true);

    // Check permission for other user
    const otherPerm = checkSemanticLockPermission(table, "panel_1", "user_b", "colorist", now);
    expect(otherPerm.allowed).toBe(false);
    expect(otherPerm.suggestionOnly).toBe(true);

    // Release lock
    table = releaseSemanticLock(table, "l_1", "user_a");
    const afterRelease = checkSemanticLockPermission(table, "panel_1", "user_b", "colorist", now);
    expect(afterRelease.allowed).toBe(true);
  });

  it("handles lease lock TTL expiration and renewal", () => {
    let table = createStudioSemanticLockTable({ id: "t_2" });
    const now = 1_000_000;

    const res = acquireSemanticLock(table, {
      id: "lease_1",
      targetId: "shot_10",
      targetKind: "shot",
      kind: "lease",
      durationSeconds: 60, // 60s
      holderUserId: "user_a",
      holderRole: "3d-layout",
      nowMs: now,
    });
    table = res.table;

    // Within lease duration -> blocked for others
    expect(checkSemanticLockPermission(table, "shot_10", "user_b", "pd", now + 30_000).allowed).toBe(false);

    // Expired lease -> allowed
    expect(checkSemanticLockPermission(table, "shot_10", "user_b", "pd", now + 70_000).allowed).toBe(true);

    // Renew lease before expiry
    table = renewSemanticLease(table, "lease_1", "user_a", 100, now + 30_000);
    // At now + 70s it is still valid due to renewal
    expect(checkSemanticLockPermission(table, "shot_10", "user_b", "pd", now + 70_000).allowed).toBe(false);

    // Purge
    table = purgeExpiredLeases(table, now + 200_000);
    expect(table.locks).toHaveLength(0);
  });

  it("enforces role-based locks and approved-version freeze", () => {
    let table = createStudioSemanticLockTable({ id: "t_3" });
    const now = 1_000_000;

    // Role based lock: only colorist and pd
    table = acquireSemanticLock(table, {
      id: "role_1",
      targetId: "layer_color",
      targetKind: "layer",
      kind: "role-based",
      allowedRoles: ["colorist", "pd"],
      holderUserId: "user_a",
      holderRole: "colorist",
      nowMs: now,
    }).table;

    expect(checkSemanticLockPermission(table, "layer_color", "user_c", "colorist", now).allowed).toBe(true);
    expect(checkSemanticLockPermission(table, "layer_color", "user_l", "lineart", now).allowed).toBe(false);

    // Approved version lock
    table = acquireSemanticLock(table, {
      id: "appr_1",
      targetId: "episode_1",
      targetKind: "episode",
      kind: "approved-version",
      holderUserId: "pd_1",
      holderRole: "pd",
      nowMs: now,
    }).table;

    const editAttempt = checkSemanticLockPermission(table, "episode_1", "user_any", "lineart", now);
    expect(editAttempt.allowed).toBe(false);
    expect(editAttempt.suggestionOnly).toBe(true);

    // Admin force revoke
    table = forceRevokeSemanticLock(table, "appr_1", "admin_1", "admin");
    expect(table.locks.find((l) => l.id === "appr_1")).toBeUndefined();
  });
});
