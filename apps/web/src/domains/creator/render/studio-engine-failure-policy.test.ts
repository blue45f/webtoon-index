import { describe, expect, it } from "vitest";

import {
  STUDIO_ENGINE_FAILURE_POLICY,
  StudioEngineUnavailableError,
  assertNoStudioEngineFallback,
} from "./studio-engine-failure-policy";

describe("Studio engine failure policy", () => {
  it("forbids automatic cross-provider fallback while preserving explicit engines", () => {
    expect(STUDIO_ENGINE_FAILURE_POLICY).toMatchObject({
      version: 2,
      automaticCrossProviderFallbackAllowed: false,
      automaticExecutionBackendFallbackAllowed: false,
      retryDifferentProviderAllowed: false,
      workerDirectSubstitutionAllowed: false,
      wasmJsSubstitutionAllowed: false,
      gpuCpuSubstitutionAllowed: false,
      cpuReferenceRole: "explicit-reference-or-export-only",
      alternateEngineSelection: "explicit-next-operation-only",
    });
  });

  it("allows retries of only the selected provider", () => {
    expect(() => assertNoStudioEngineFallback({
      selectedProviderId: "vello-gpu-browser",
      attemptedProviderIds: ["vello-gpu-browser", "vello-gpu-browser"],
    })).not.toThrow();
  });

  it("rejects a provider substitution in the same operation", () => {
    expect(() => assertNoStudioEngineFallback({
      selectedProviderId: "vello-gpu-browser",
      attemptedProviderIds: ["vello-gpu-browser", "skia-canvaskit"],
    })).toThrow(/Automatic Studio engine fallback is disabled/u);
  });

  it("carries provider and failure-stage evidence without suggesting an alternate", () => {
    const cause = new Error("GPU device lost");
    const error = new StudioEngineUnavailableError({
      providerId: "vello-gpu-browser",
      stage: "device-loss",
      message: "선택한 Vello WebGPU 엔진을 현재 사용할 수 없습니다.",
      cause,
    });

    expect(error).toMatchObject({
      name: "StudioEngineUnavailableError",
      providerId: "vello-gpu-browser",
      stage: "device-loss",
      cause,
    });
  });
});
