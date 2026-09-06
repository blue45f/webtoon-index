import { describe, expect, it } from "vitest";

import {
  STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT,
  StudioFeatureRolloutError,
  canonicalStudioFeatureRolloutJson,
  checksumStudioFeatureRolloutValue,
  clearStudioFeatureRolloutFailures,
  normalizeStudioFeatureRolloutPolicy,
  recordStudioFeatureRolloutFailure,
  resolveStudioFeatureCohort,
  resolveStudioFeatureRollout,
  studioFeatureRolloutBucketStorageKey,
  validateStudioFeatureRolloutPolicySet,
  type StudioFeatureRolloutPolicy,
  type StudioFeatureRolloutRandom,
  type StudioFeatureRolloutStorage,
} from "./studio-feature-rollout";

class MemoryStorage implements StudioFeatureRolloutStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("storage read blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage write blocked");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function randomWord(value: number): StudioFeatureRolloutRandom {
  return {
    getRandomValues(array) {
      array[0] = value;
      return array;
    },
  };
}

function buildPolicy(
  overrides: Partial<StudioFeatureRolloutPolicy> = {},
): StudioFeatureRolloutPolicy {
  return {
    schemaVersion: 1,
    featureId: "canvas.live-ink",
    policyVersion: 1,
    authority: "build",
    issuedAtMs: 1_000,
    expiresAtMs: null,
    rolloutPercent: 25,
    killSwitch: false,
    dependencies: [],
    ...overrides,
  };
}

function remotePolicy(
  overrides: Partial<StudioFeatureRolloutPolicy> = {},
): StudioFeatureRolloutPolicy {
  return buildPolicy({
    authority: "validated-remote",
    expiresAtMs: 20_000,
    ...overrides,
  });
}

function resolveBuild(
  policy: StudioFeatureRolloutPolicy,
  overrides: Partial<Parameters<typeof resolveStudioFeatureRollout>[0]> = {},
) {
  return resolveStudioFeatureRollout({
    featureId: policy.featureId,
    policy,
    environment: "production",
    nowMs: 2_000,
    storage: new MemoryStorage(),
    random: randomWord(0),
    ...overrides,
  });
}

describe("Studio generic feature rollout", () => {
  it("normalizes the exact v1 policy and sorts dependency ids", () => {
    expect(normalizeStudioFeatureRolloutPolicy(buildPolicy({
      dependencies: ["storage.opfs", "canvas.webgpu"],
    }))).toEqual({
      schemaVersion: 1,
      featureId: "canvas.live-ink",
      policyVersion: 1,
      authority: "build",
      issuedAtMs: 1_000,
      expiresAtMs: null,
      rolloutPercent: 25,
      killSwitch: false,
      dependencies: ["canvas.webgpu", "storage.opfs"],
    });
  });

  it.each([
    ["unknown key", { ...buildPolicy(), unknown: true }],
    ["invalid feature id", buildPolicy({ featureId: "Canvas Live Ink" })],
    ["zero policy version", buildPolicy({ policyVersion: 0 })],
    ["invalid percent", buildPolicy({ rolloutPercent: Number.NaN })],
    ["remote without expiry", remotePolicy({ expiresAtMs: null })],
    ["expiry before issue", buildPolicy({ expiresAtMs: 999 })],
    ["self dependency", buildPolicy({ dependencies: ["canvas.live-ink"] })],
    [
      "duplicate dependency",
      buildPolicy({ dependencies: ["canvas.webgpu", "canvas.webgpu"] }),
    ],
  ])("rejects %s", (_label, policy) => {
    expect(() => normalizeStudioFeatureRolloutPolicy(policy))
      .toThrow(StudioFeatureRolloutError);
  });

  it("detects duplicate policies and dependency cycles", () => {
    expect(() => validateStudioFeatureRolloutPolicySet([
      buildPolicy(),
      buildPolicy({ policyVersion: 2 }),
    ])).toThrow(expect.objectContaining({ code: "duplicate-feature" }));

    expect(() => validateStudioFeatureRolloutPolicySet([
      buildPolicy({
        featureId: "feature.a",
        dependencies: ["feature.b"],
      }),
      buildPolicy({
        featureId: "feature.b",
        dependencies: ["feature.c"],
      }),
      buildPolicy({
        featureId: "feature.c",
        dependencies: ["feature.a"],
      }),
    ])).toThrow(expect.objectContaining({ code: "dependency-cycle" }));
  });

  it("canonicalizes keys deterministically and protects checksums from mutation", () => {
    const left = { z: [3, { b: true, a: "툰" }], a: -0 };
    const right = { a: 0, z: [3, { a: "툰", b: true }] };
    expect(canonicalStudioFeatureRolloutJson(left))
      .toBe(canonicalStudioFeatureRolloutJson(right));
    expect(checksumStudioFeatureRolloutValue(left))
      .toBe(checksumStudioFeatureRolloutValue(right));
    expect(checksumStudioFeatureRolloutValue({ ...right, a: 1 }))
      .not.toBe(checksumStudioFeatureRolloutValue(right));

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalStudioFeatureRolloutJson(cyclic)).toThrow(/cycle/u);
    expect(() => canonicalStudioFeatureRolloutJson(new Map())).toThrow(/plain JSON/u);
  });

  it("keeps a stable local bucket and expands cohorts monotonically", () => {
    const storage = new MemoryStorage();
    const storageKey = studioFeatureRolloutBucketStorageKey("canvas.live-ink");
    const random = randomWord(2_499);
    expect(resolveStudioFeatureCohort({
      rolloutPercent: 24.99,
      storageKey,
      storage,
      random,
    })).toEqual({
      included: false,
      bucket: 2_499,
      reason: "cohort-excluded",
    });
    expect(resolveStudioFeatureCohort({
      rolloutPercent: 25,
      storageKey,
      storage,
      random: randomWord(9_999),
    })).toEqual({
      included: true,
      bucket: 2_499,
      reason: "cohort-included",
    });
    expect(storage.values.get(storageKey)).toBe("2499");
  });

  it("does not need storage for 0 or 100 percent and fails closed for partial cohorts", () => {
    expect(resolveStudioFeatureCohort({
      rolloutPercent: 0,
      storageKey: "unused",
    })).toEqual({
      included: false,
      bucket: null,
      reason: "rollout-disabled",
    });
    expect(resolveStudioFeatureCohort({
      rolloutPercent: 100,
      storageKey: "unused",
    })).toEqual({
      included: true,
      bucket: null,
      reason: "rollout-full",
    });
    expect(resolveStudioFeatureCohort({
      rolloutPercent: 50,
      storageKey: "missing",
    })).toEqual({
      included: false,
      bucket: null,
      reason: "cohort-unavailable",
    });
    expect(STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT).toBe(10_000);
  });

  it("applies kill switches before QA overrides and dependency gates", () => {
    const killed = buildPolicy({
      rolloutPercent: 100,
      killSwitch: true,
      dependencies: ["canvas.webgpu"],
    });
    expect(resolveBuild(killed, {
      environment: "development",
      qaOverride: "force-on",
      dependencyDecisions: { "canvas.webgpu": true },
    })).toMatchObject({
      enabled: false,
      reason: "kill-switch",
      bucket: null,
    });

    expect(resolveBuild(buildPolicy({
      rolloutPercent: 100,
      dependencies: ["canvas.webgpu"],
    }))).toMatchObject({
      enabled: false,
      reason: "dependency-disabled",
    });
  });

  it("allows QA force-on outside production or with explicit production authorization", () => {
    const policy = buildPolicy({ rolloutPercent: 0 });
    expect(resolveBuild(policy, {
      environment: "development",
      qaOverride: "force-on",
    })).toMatchObject({ enabled: true, reason: "qa-force-on" });
    expect(resolveBuild(policy, {
      environment: "production",
      qaOverride: "force-on",
    })).toMatchObject({ enabled: false, reason: "rollout-disabled" });
    expect(resolveBuild(policy, {
      environment: "production",
      qaOverride: "force-on",
      qaOverrideAuthorized: true,
    })).toMatchObject({ enabled: true, reason: "qa-force-on" });
  });

  it("persists a validated remote policy and restores it as last-known-good", () => {
    const storage = new MemoryStorage();
    const policy = remotePolicy({ rolloutPercent: 100 });
    const accepted = resolveStudioFeatureRollout({
      featureId: policy.featureId,
      policy,
      policyValidated: true,
      environment: "production",
      nowMs: 2_000,
      storage,
    });
    expect(accepted).toMatchObject({
      enabled: true,
      reason: "rollout-full",
      policySource: "incoming",
      policySelection: "incoming-persisted",
    });
    expect(accepted.policyChecksum).toMatch(/^fnv1a32:[0-9a-f]{8}$/u);

    expect(resolveStudioFeatureRollout({
      featureId: policy.featureId,
      environment: "production",
      nowMs: 3_000,
      storage,
    })).toMatchObject({
      enabled: true,
      policySource: "last-known-good",
      policySelection: "last-known-good-fallback",
    });
  });

  it("rejects unvalidated remote enabling but accepts its fail-safe kill switch", () => {
    const policy = remotePolicy({ rolloutPercent: 100 });
    expect(resolveStudioFeatureRollout({
      featureId: policy.featureId,
      policy,
      policyValidated: false,
      environment: "production",
      nowMs: 2_000,
    })).toMatchObject({
      enabled: false,
      reason: "policy-unvalidated",
    });

    expect(resolveStudioFeatureRollout({
      featureId: policy.featureId,
      policy: { ...policy, killSwitch: true },
      policyValidated: false,
      environment: "production",
      nowMs: 2_000,
    })).toMatchObject({
      enabled: false,
      reason: "kill-switch",
    });
  });

  it("keeps a newer LKG over a downgrade and rejects same-version equivocation", () => {
    const storage = new MemoryStorage();
    const newer = remotePolicy({ policyVersion: 3, rolloutPercent: 100 });
    resolveStudioFeatureRollout({
      featureId: newer.featureId,
      policy: newer,
      policyValidated: true,
      environment: "production",
      nowMs: 2_000,
      storage,
    });

    expect(resolveStudioFeatureRollout({
      featureId: newer.featureId,
      policy: remotePolicy({ policyVersion: 2, rolloutPercent: 0 }),
      policyValidated: true,
      environment: "production",
      nowMs: 3_000,
      storage,
    })).toMatchObject({
      enabled: true,
      policyVersion: 3,
      policySource: "last-known-good",
      policySelection: "last-known-good-newer",
    });

    expect(resolveStudioFeatureRollout({
      featureId: newer.featureId,
      policy: remotePolicy({ policyVersion: 3, rolloutPercent: 50 }),
      policyValidated: true,
      environment: "production",
      nowMs: 3_000,
      storage,
      random: randomWord(0),
    })).toMatchObject({
      enabled: false,
      reason: "policy-conflict",
    });
  });

  it("fails closed for future, expired, corrupt, or unwritable remote state", () => {
    expect(resolveStudioFeatureRollout({
      featureId: "canvas.live-ink",
      policy: buildPolicy({ issuedAtMs: 1_000_000 }),
      environment: "production",
      nowMs: 1_000,
    })).toMatchObject({
      enabled: false,
      reason: "policy-issued-in-future",
    });

    expect(resolveStudioFeatureRollout({
      featureId: "canvas.live-ink",
      policy: remotePolicy({ expiresAtMs: 1_500 }),
      policyValidated: true,
      environment: "production",
      nowMs: 2_000,
      storage: new MemoryStorage(),
    })).toMatchObject({
      enabled: false,
      reason: "policy-expired",
    });

    const corruptStorage = new MemoryStorage();
    corruptStorage.values.set(
      "toonspectrum:studio:feature-rollout:v1:lkg:canvas.live-ink",
      '{"schemaVersion":1,"policy":{},"checksum":"fnv1a32:00000000"}',
    );
    expect(resolveStudioFeatureRollout({
      featureId: "canvas.live-ink",
      environment: "production",
      nowMs: 2_000,
      storage: corruptStorage,
    })).toMatchObject({
      enabled: false,
      reason: "last-known-good-corrupt",
    });

    const unwritable = new MemoryStorage();
    unwritable.failWrites = true;
    expect(resolveStudioFeatureRollout({
      featureId: "canvas.live-ink",
      policy: remotePolicy({ rolloutPercent: 100 }),
      policyValidated: true,
      environment: "production",
      nowMs: 2_000,
      storage: unwritable,
    })).toMatchObject({
      enabled: false,
      reason: "policy-storage-unavailable",
    });
  });

  it("enters a version-scoped cooldown after the configured failure threshold", () => {
    const storage = new MemoryStorage();
    const policy = buildPolicy({ rolloutPercent: 100, policyVersion: 7 });
    const guard = { threshold: 2, cooldownMs: 5_000 };

    expect(recordStudioFeatureRolloutFailure({
      featureId: policy.featureId,
      policyVersion: policy.policyVersion,
      nowMs: 2_000,
      guard,
      storage,
    })).toMatchObject({
      failureCount: 1,
      disabledUntilMs: 0,
    });
    expect(resolveBuild(policy, {
      nowMs: 2_100,
      storage,
      failureGuard: guard,
    })).toMatchObject({ enabled: true, reason: "rollout-full" });

    expect(recordStudioFeatureRolloutFailure({
      featureId: policy.featureId,
      policyVersion: policy.policyVersion,
      nowMs: 2_200,
      guard,
      storage,
    })).toMatchObject({
      failureCount: 2,
      disabledUntilMs: 7_200,
    });
    expect(resolveBuild(policy, {
      nowMs: 3_000,
      storage,
      failureGuard: guard,
    })).toMatchObject({ enabled: false, reason: "failure-cooldown" });
    expect(resolveBuild(policy, {
      nowMs: 7_200,
      storage,
      failureGuard: guard,
    })).toMatchObject({ enabled: true, reason: "rollout-full" });

    expect(clearStudioFeatureRolloutFailures(policy.featureId, storage)).toBe(true);
    expect(resolveBuild(policy, {
      nowMs: 3_000,
      storage,
      failureGuard: guard,
    })).toMatchObject({ enabled: true, reason: "rollout-full" });
  });

  it("fails closed when the failure guard state cannot be read or is corrupt", () => {
    const policy = buildPolicy({ rolloutPercent: 100 });
    expect(resolveBuild(policy, {
      storage: null,
      failureGuard: { threshold: 2, cooldownMs: 5_000 },
    })).toMatchObject({
      enabled: false,
      reason: "failure-state-unavailable",
    });

    const storage = new MemoryStorage();
    storage.values.set(
      "toonspectrum:studio:feature-rollout:v1:failure:canvas.live-ink",
      '{"state":{},"checksum":"fnv1a32:00000000"}',
    );
    expect(resolveBuild(policy, {
      storage,
      failureGuard: { threshold: 2, cooldownMs: 5_000 },
    })).toMatchObject({
      enabled: false,
      reason: "failure-state-corrupt",
    });
  });
});
