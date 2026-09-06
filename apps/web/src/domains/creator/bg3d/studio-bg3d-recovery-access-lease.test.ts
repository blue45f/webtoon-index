import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS,
  StudioBg3dRecoveryAccessGate,
  createStudioBg3dRecoveryAccessLease,
  isStudioBg3dRecoveryAccessLeaseReusable,
} from "./studio-bg3d-recovery-access-lease";

import type { StudioBg3dShotBatchRecoveryScope } from "./studio-bg3d-shot-batch-plan";

const scope: StudioBg3dShotBatchRecoveryScope = Object.freeze({
  durability: "durable",
  authUserId: "user-1",
  workId: "work-1",
  pageId: "page-1",
  elementId: "element-1",
});

describe("Studio BG3D recovery access lease", () => {
  it("reuses the exact scope, revision and project generation only inside the short TTL", () => {
    const lease = createStudioBg3dRecoveryAccessLease({
      scope,
      revision: 7,
      projectGeneration: 11,
      authorizedAt: 1_000,
    });
    const input = { scope, revision: 7, projectGeneration: 11 };

    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, { ...input, now: 1_000 })).toBe(true);
    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, {
      ...input,
      now: 1_000 + STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS - 1,
    })).toBe(true);
    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, {
      ...input,
      now: 1_000 + STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS,
    })).toBe(false);
  });

  it("invalidates on equivalent-but-replaced scope, revision or local project mutation", () => {
    const lease = createStudioBg3dRecoveryAccessLease({
      scope,
      revision: 7,
      projectGeneration: 11,
      authorizedAt: 1_000,
    });
    const base = { scope, revision: 7, projectGeneration: 11, now: 1_001 };

    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, {
      ...base,
      scope: { ...scope },
    })).toBe(false);
    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, { ...base, revision: 8 })).toBe(false);
    expect(isStudioBg3dRecoveryAccessLeaseReusable(lease, {
      ...base,
      projectGeneration: 12,
    })).toBe(false);
    expect(isStudioBg3dRecoveryAccessLeaseReusable(null, base)).toBe(false);
  });

  it("coalesces concurrent verification and reuses only successful, locally-current proof", async () => {
    let now = 1_000;
    let current = true;
    let resolveVerification!: (allowed: boolean) => void;
    const verify = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveVerification = resolve;
    }));
    const gate = new StudioBg3dRecoveryAccessGate(() => now);
    const controller = new AbortController();
    const input = {
      scope,
      revision: 7,
      projectGeneration: 11,
      signal: controller.signal,
      isLocallyCurrent: () => current,
      verify,
    };

    const first = gate.authorize(input);
    const second = gate.authorize(input);
    expect(verify).toHaveBeenCalledTimes(1);
    resolveVerification(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(gate.authorize(input)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);

    current = false;
    await expect(gate.authorize(input)).resolves.toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    current = true;
    now += STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS;
    const expiredVerification = gate.authorize({ ...input, verify: async () => true });
    await expect(expiredVerification).resolves.toBe(true);
  });

  it("never caches rejection, abort, or a scope superseded during remote verification", async () => {
    let now = 1_000;
    const gate = new StudioBg3dRecoveryAccessGate(() => now);
    const rejectedVerify = vi.fn(async () => false);
    const base = {
      scope,
      revision: 7,
      projectGeneration: 11,
      signal: new AbortController().signal,
      isLocallyCurrent: () => true,
    };

    await expect(gate.authorize({ ...base, verify: rejectedVerify })).resolves.toBe(false);
    await expect(gate.authorize({ ...base, verify: rejectedVerify })).resolves.toBe(false);
    expect(rejectedVerify).toHaveBeenCalledTimes(2);

    const aborted = new AbortController();
    aborted.abort();
    const abortedVerify = vi.fn(async () => true);
    await expect(gate.authorize({
      ...base,
      signal: aborted.signal,
      verify: abortedVerify,
    })).resolves.toBe(false);
    expect(abortedVerify).not.toHaveBeenCalled();

    let resolveOld!: (allowed: boolean) => void;
    const old = gate.authorize({
      ...base,
      verify: () => new Promise<boolean>((resolve) => {
        resolveOld = resolve;
      }),
    });
    const replacementScope = { ...scope };
    const replacement = gate.authorize({
      ...base,
      scope: replacementScope,
      verify: async () => true,
    });
    await expect(replacement).resolves.toBe(true);
    resolveOld(true);
    await expect(old).resolves.toBe(false);
    now += 1;
    await expect(gate.authorize({
      ...base,
      scope: replacementScope,
      verify: async () => {
        throw new Error("cached replacement lease should be reused");
      },
    })).resolves.toBe(true);
  });
});
