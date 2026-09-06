import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

import {
  STUDIO_LIVE_INK_DEFAULT_ROLLOUT_PERCENT,
  STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY,
  resolveStudioLiveInkRollout,
  studioLiveInkRolloutInputFromGlobals,
  type StudioLiveInkRolloutRandom,
  type StudioLiveInkRolloutStorage,
} from "./studio-live-ink-rollout";

const studioPageSource = readStudioCuttoonEditorSource();
const rolloutSource = readFileSync(
  new URL("./studio-live-ink-rollout.ts", import.meta.url),
  "utf8",
);

function memoryStorage(initial?: string): StudioLiveInkRolloutStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function fixedRandom(value: number): StudioLiveInkRolloutRandom {
  return {
    getRandomValues: (array) => {
      array[0] = value;
      return array;
    },
  };
}

describe("Studio live-ink progressive rollout", () => {
  it("wires all public deployment controls into the production Studio policy", () => {
    expect(studioPageSource).toContain("resolveStudioLiveInkRollout(");
    expect(studioPageSource).toContain("studioLiveInkRolloutInputFromGlobals(");
    expect(studioPageSource).toContain("import.meta.env.VITE_STUDIO_LIVE_INK_BACKEND");
    expect(studioPageSource).toContain("import.meta.env.VITE_STUDIO_LIVE_INK_ROLLOUT_PERCENT");
    expect(studioPageSource).toContain("import.meta.env.VITE_STUDIO_LIVE_INK_KILL_SWITCH");
    expect(studioPageSource).toContain(
      "STUDIO_VISIBLE_LIVE_INK_ROLLOUT.preference",
    );
    expect(rolloutSource).toContain("resolveStudioFeatureRollout({");
    expect(rolloutSource).toContain(
      "bucketStorageKey: STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY",
    );
  });

  it("uses the quality-first WebGPU default without touching storage", () => {
    const storage = memoryStorage();
    const getItem = vi.spyOn(storage, "getItem");

    expect(resolveStudioLiveInkRollout({
      webgpuApiAvailable: true,
      storage,
      random: fixedRandom(1),
    })).toEqual({
      preference: "webgpu",
      status: "selected",
      reason: "cohort-included",
      rolloutPercent: STUDIO_LIVE_INK_DEFAULT_ROLLOUT_PERCENT,
      bucket: null,
    });
    expect(getItem).not.toHaveBeenCalled();
  });

  it("disables malformed rollout configuration without selecting Canvas2D", () => {
    const storage = memoryStorage();
    const getItem = vi.spyOn(storage, "getItem");

    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: "not-a-percent",
      webgpuApiAvailable: true,
      storage,
      random: fixedRandom(1),
    })).toMatchObject({ preference: "webgpu", status: "unavailable" });
    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: true,
      webgpuApiAvailable: true,
      storage,
      random: fixedRandom(1),
    })).toMatchObject({ preference: "webgpu", status: "unavailable" });
    expect(getItem).not.toHaveBeenCalled();
  });

  it("reports the selected WebGPU lane unavailable without backend substitution", () => {
    expect(resolveStudioLiveInkRollout({
      webgpuApiAvailable: false,
    })).toEqual({
      preference: "webgpu",
      status: "unavailable",
      reason: "webgpu-api-unavailable",
      rolloutPercent: STUDIO_LIVE_INK_DEFAULT_ROLLOUT_PERCENT,
      bucket: null,
    });
  });

  it("keeps manual selection explicit and kill-switch failure closed", () => {
    expect(resolveStudioLiveInkRollout({
      backendPreference: "webgpu",
      rolloutPercent: 100,
      killSwitch: "on",
      webgpuApiAvailable: true,
    })).toMatchObject({
      preference: "webgpu",
      status: "unavailable",
      reason: "kill-switch",
    });
    expect(resolveStudioLiveInkRollout({
      backendPreference: "webgpu",
      rolloutPercent: 0,
      webgpuApiAvailable: false,
    })).toMatchObject({
      preference: "webgpu",
      status: "selected",
      reason: "webgpu-explicit",
    });
    expect(resolveStudioLiveInkRollout({
      backendPreference: "canvas2d",
      rolloutPercent: 100,
      webgpuApiAvailable: true,
    })).toMatchObject({
      preference: "canvas2d",
      status: "selected",
      reason: "canvas2d-explicit",
    });
    expect(resolveStudioLiveInkRollout({
      backendPreference: "web-gpu",
      rolloutPercent: 100,
      webgpuApiAvailable: true,
    })).toMatchObject({ preference: "webgpu", status: "selected" });
  });

  it("requires a WebGPU API before enrolling an automatic cohort", () => {
    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: 20,
      webgpuApiAvailable: false,
      storage: memoryStorage("0"),
      random: fixedRandom(0),
    })).toEqual({
      preference: "webgpu",
      status: "unavailable",
      reason: "webgpu-api-unavailable",
      rolloutPercent: 20,
      bucket: null,
    });
  });

  it("uses a stable local percentile bucket and expands cohorts monotonically", () => {
    const storage = memoryStorage("2499");
    const base = {
      backendPreference: "auto",
      webgpuApiAvailable: true,
      storage,
      random: fixedRandom(9999),
    } as const;

    expect(resolveStudioLiveInkRollout({ ...base, rolloutPercent: 24.99 })).toMatchObject({
      preference: "webgpu",
      status: "unavailable",
      reason: "cohort-excluded",
      bucket: 2499,
    });
    expect(resolveStudioLiveInkRollout({ ...base, rolloutPercent: 25 })).toMatchObject({
      preference: "webgpu",
      status: "selected",
      reason: "cohort-included",
      bucket: 2499,
    });
    expect(resolveStudioLiveInkRollout({ ...base, rolloutPercent: 50 }).preference).toBe("webgpu");
  });

  it("stores only a four-digit-or-smaller random bucket, never a user or device identifier", () => {
    const storage = memoryStorage();
    const decision = resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: 50,
      webgpuApiAvailable: true,
      storage,
      random: fixedRandom(12_345),
    });

    expect(decision.bucket).toBe(2345);
    expect(storage.values).toEqual(new Map([
      [STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY, "2345"],
    ]));
  });

  it("fails closed for hostile storage, Web Crypto, and invalid persisted buckets", () => {
    const throwingStorage: StudioLiveInkRolloutStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: 50,
      webgpuApiAvailable: true,
      storage: throwingStorage,
      random: fixedRandom(0),
    })).toMatchObject({
      preference: "webgpu",
      status: "unavailable",
      reason: "cohort-unavailable",
    });

    const storage = memoryStorage("10000");
    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: 50,
      webgpuApiAvailable: true,
      storage,
      random: {
        getRandomValues: () => {
          throw new Error("unavailable");
        },
      },
    })).toMatchObject({
      preference: "webgpu",
      status: "unavailable",
      reason: "cohort-unavailable",
    });
  });

  it("does not require local storage for a deliberate 100% capability canary", () => {
    expect(resolveStudioLiveInkRollout({
      backendPreference: "auto",
      rolloutPercent: "100",
      webgpuApiAvailable: true,
    })).toEqual({
      preference: "webgpu",
      status: "selected",
      reason: "cohort-included",
      rolloutPercent: 100,
      bucket: null,
    });
  });

  it("reads browser capabilities defensively without throwing in restricted globals", () => {
    const globals = {
      get navigator(): { readonly gpu?: unknown } {
        throw new Error("denied");
      },
      get localStorage(): Storage {
        throw new Error("denied");
      },
      get crypto(): Crypto {
        throw new Error("denied");
      },
    };
    const input = studioLiveInkRolloutInputFromGlobals("auto", 5, "true", globals);

    expect(input).toMatchObject({
      backendPreference: "auto",
      rolloutPercent: 5,
      killSwitch: "true",
      webgpuApiAvailable: false,
      storage: null,
      random: null,
    });

    expect(studioLiveInkRolloutInputFromGlobals("auto", 5, undefined, {
      navigator: { gpu: {} },
    }).webgpuApiAvailable).toBe(false);
    expect(studioLiveInkRolloutInputFromGlobals("auto", 5, undefined, {
      navigator: { gpu: { requestAdapter: () => Promise.resolve(null) } },
    }).webgpuApiAvailable).toBe(true);
  });
});
