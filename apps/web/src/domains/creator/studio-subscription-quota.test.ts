import { describe, expect, it } from "vitest";

import {
  checkActionEntitlement,
  getTierEntitlements,
  recordResourceUsage,
  type SubscriptionUsageState,
} from "./studio-subscription-quota";

describe("Studio Subscription Entitlements & Quota Monitor", () => {
  it("provides correct tier entitlements specification", () => {
    const freeSpec = getTierEntitlements("free");
    expect(freeSpec.maxStorageMb).toBe(500);
    expect(freeSpec.allowWebGpuExport).toBe(false);

    const proSpec = getTierEntitlements("creator-pro");
    expect(proSpec.maxStorageMb).toBe(50_000);
    expect(proSpec.allowWebGpuExport).toBe(true);
  });

  it("checks storage quota and issues 80% warning before blocking at 100%", () => {
    const state: SubscriptionUsageState = {
      userIdOrOrgId: "user_free",
      tier: "free", // 500MB max
      currentStorageMbUsed: 350,
      currentAiTokensUsed: 0,
      currentCollabSeatsActive: 1,
    };

    // Consuming 60MB -> 410MB (82% of 500MB) -> allowed with warning
    const checkWarn = checkActionEntitlement(state, { type: "consume-storage", requestedMb: 60 });
    expect(checkWarn.allowed).toBe(true);
    expect(checkWarn.isWarningThreshold).toBe(true);

    // Consuming 200MB -> 550MB (exceeds 500MB) -> blocked
    const checkBlock = checkActionEntitlement(state, { type: "consume-storage", requestedMb: 200 });
    expect(checkBlock.allowed).toBe(false);
    expect(checkBlock.reason).toContain("초과");
  });

  it("gates pro features from free tier users", () => {
    const freeState: SubscriptionUsageState = {
      userIdOrOrgId: "u_free",
      tier: "free",
      currentStorageMbUsed: 0,
      currentAiTokensUsed: 0,
      currentCollabSeatsActive: 1,
    };

    const checkGpu = checkActionEntitlement(freeState, { type: "use-feature", feature: "webgpu-export" });
    expect(checkGpu.allowed).toBe(false);

    const checkCmyk = checkActionEntitlement(freeState, { type: "use-feature", feature: "cmyk-softproof" });
    expect(checkCmyk.allowed).toBe(false);
  });

  it("records resource usage additions", () => {
    let state: SubscriptionUsageState = {
      userIdOrOrgId: "u_pro",
      tier: "creator-pro",
      currentStorageMbUsed: 100,
      currentAiTokensUsed: 50,
      currentCollabSeatsActive: 1,
    };

    state = recordResourceUsage(state, { storageMb: 50, aiTokens: 20 });
    expect(state.currentStorageMbUsed).toBe(150);
    expect(state.currentAiTokensUsed).toBe(70);
  });
});
