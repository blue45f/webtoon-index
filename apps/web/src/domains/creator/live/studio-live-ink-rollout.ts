import {
  STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT,
  resolveStudioFeatureRollout,
} from "../studio-feature-rollout";

import {
  resolveStudioLiveInkBackendPreference,
  type StudioLiveInkBackendPreference,
} from "./studio-live-ink-backend";

/**
 * A cohort is a local percentile bucket, not a user or device identifier. It is never sent to the
 * server and deliberately contains too little information to identify a browser installation.
 */
export const STUDIO_LIVE_INK_ROLLOUT_BUCKET_COUNT =
  STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT;
export const STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY =
  "toonspectrum:studio:live-ink-rollout-bucket:v1";
/**
 * Quality-first engine policy.
 *
 * The WebGPU path still has stroke-scoped capability, exact-output, first-frame receipt and
 * device-loss gates. Those gates report the selected engine unavailable; they do not grant
 * Canvas2D ownership. A missing deployment percentage admits every capable browser. Malformed
 * percentages disable the selected lane without substituting a different renderer.
 */
export const STUDIO_LIVE_INK_DEFAULT_ROLLOUT_PERCENT = 100;

export interface StudioLiveInkRolloutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StudioLiveInkRolloutRandom {
  getRandomValues(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer>;
}

export type StudioLiveInkRolloutReason =
  | "canvas2d-explicit"
  | "webgpu-explicit"
  | "kill-switch"
  | "rollout-disabled"
  | "webgpu-api-unavailable"
  | "cohort-included"
  | "cohort-excluded"
  | "cohort-unavailable";

export interface StudioLiveInkRolloutDecision {
  readonly preference: StudioLiveInkBackendPreference;
  /** `unavailable` disables this selection; it never means “run the other backend”. */
  readonly status: "selected" | "unavailable";
  readonly reason: StudioLiveInkRolloutReason;
  readonly rolloutPercent: number;
  /** Null for forced/off decisions that do not need to create or read a local cohort. */
  readonly bucket: number | null;
}

export interface StudioLiveInkRolloutInput {
  readonly backendPreference?: unknown;
  readonly rolloutPercent?: unknown;
  readonly killSwitch?: unknown;
  /** A synchronous API check only. Adapter/device readiness remains the stroke-level hard gate. */
  readonly webgpuApiAvailable: boolean;
  readonly storage?: StudioLiveInkRolloutStorage | null;
  readonly random?: StudioLiveInkRolloutRandom | null;
}

interface StudioLiveInkRolloutGlobals {
  readonly navigator?: { readonly gpu?: unknown };
  readonly localStorage?: Storage;
  readonly crypto?: Crypto;
}

function parseRolloutPercent(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return STUDIO_LIVE_INK_DEFAULT_ROLLOUT_PERCENT;
  }
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 0;
  return parsed;
}

function parseKillSwitch(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return /^(?:1|true|on)$/iu.test(value.trim());
}

/**
 * Resolves the fleet-level preference only. The existing stroke-scoped backend policy still
 * requires an initialized WebGPU device, a compatible brush contract, an exact first-frame
 * receipt, and a recoverable immutable source journal before a GPU surface can become visible.
 */
export function resolveStudioLiveInkRollout(
  input: StudioLiveInkRolloutInput,
): StudioLiveInkRolloutDecision {
  const configuredPreference = resolveStudioLiveInkBackendPreference(input.backendPreference);
  const rolloutPercent = parseRolloutPercent(input.rolloutPercent);

  if (parseKillSwitch(input.killSwitch)) {
    return {
      preference: configuredPreference,
      status: "unavailable",
      reason: "kill-switch",
      rolloutPercent,
      bucket: null,
    };
  }
  if (configuredPreference === "canvas2d") {
    return {
      preference: "canvas2d",
      status: "selected",
      reason: "canvas2d-explicit",
      rolloutPercent,
      bucket: null,
    };
  }
  if (configuredPreference === "webgpu") {
    if (input.backendPreference === "webgpu") {
      return {
        preference: "webgpu",
        status: "selected",
        reason: "webgpu-explicit",
        rolloutPercent,
        bucket: null,
      };
    }
  }
  if (rolloutPercent <= 0) {
    return {
      preference: "webgpu",
      status: "unavailable",
      reason: "rollout-disabled",
      rolloutPercent,
      bucket: null,
    };
  }
  if (!input.webgpuApiAvailable) {
    return {
      preference: "webgpu",
      status: "unavailable",
      reason: "webgpu-api-unavailable",
      rolloutPercent,
      bucket: null,
    };
  }
  if (rolloutPercent >= 100) {
    return {
      preference: "webgpu",
      status: "selected",
      reason: "cohort-included",
      rolloutPercent,
      bucket: null,
    };
  }

  const rollout = resolveStudioFeatureRollout({
    featureId: "canvas.live-ink",
    policy: {
      schemaVersion: 1,
      featureId: "canvas.live-ink",
      policyVersion: 1,
      authority: "build",
      issuedAtMs: 0,
      expiresAtMs: null,
      rolloutPercent,
      killSwitch: false,
      dependencies: [],
    },
    environment: "production",
    nowMs: 0,
    storage: input.storage,
    random: input.random,
    bucketStorageKey: STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY,
  });
  if (rollout.reason === "cohort-unavailable") {
    return {
      preference: "webgpu",
      status: "unavailable",
      reason: "cohort-unavailable",
      rolloutPercent,
      bucket: null,
    };
  }
  return rollout.enabled
    ? {
        preference: "webgpu",
        status: "selected",
        reason: "cohort-included",
        rolloutPercent,
        bucket: rollout.bucket,
      }
    : {
        preference: "webgpu",
        status: "unavailable",
        reason: "cohort-excluded",
        rolloutPercent,
        bucket: rollout.bucket,
      };
}

function safely<Value>(read: () => Value, fallback: Value): Value {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Browser adapter kept separate so the policy above remains deterministic and unit-testable. */
export function studioLiveInkRolloutInputFromGlobals(
  backendPreference: unknown,
  rolloutPercent: unknown,
  killSwitch: unknown,
  globals: StudioLiveInkRolloutGlobals = globalThis as StudioLiveInkRolloutGlobals,
): StudioLiveInkRolloutInput {
  const navigatorLike = safely(() => globals.navigator ?? null, null);
  const storage = safely<Storage | null>(() => globals.localStorage ?? null, null);
  const random = safely<Crypto | null>(() => globals.crypto ?? null, null);
  const webgpuApiAvailable = safely(
    () => typeof (navigatorLike?.gpu as { readonly requestAdapter?: unknown } | null | undefined)
      ?.requestAdapter === "function",
    false,
  );
  return {
    backendPreference,
    rolloutPercent,
    killSwitch,
    webgpuApiAvailable,
    storage,
    random,
  };
}
