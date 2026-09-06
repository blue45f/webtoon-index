import { describe, expect, it } from "vitest";

import {
  STUDIO_CAPABILITY_FULL_TIER_LIMITS,
  STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS,
} from "./studio-capability-budgets";
import {
  STUDIO_CAPABILITY_TIER_REQUIREMENTS,
  classifyStudioCapabilityTier,
  isStudioCapabilityTierAtLeast,
  normalizeStudioCapabilitySnapshot,
  readStudioCapabilitySignal,
  type StudioCapabilityAdapterLimits,
  type StudioCapabilitySnapshotInput,
} from "./studio-capability-tier";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function snapshot(overrides: StudioCapabilitySnapshotInput = {}): StudioCapabilitySnapshotInput {
  return {
    webgpuAvailable: true,
    adapterAvailable: true,
    limits: STUDIO_CAPABILITY_FULL_TIER_LIMITS,
    features: [],
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    ...overrides,
  };
}

function limitsWith(
  base: StudioCapabilityAdapterLimits,
  overrides: StudioCapabilityAdapterLimits,
): StudioCapabilityAdapterLimits {
  return { ...base, ...overrides };
}

describe("classifyStudioCapabilityTier — 사용 불가 경로", () => {
  it("WebGPU API 자체가 없으면 지원하지 않음으로 판정한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({ webgpuAvailable: false, adapterAvailable: false }),
    );
    expect(result.tier).toBe("unsupported");
    expect(result.code).toBe("webgpu-unavailable");
    expect(result.deciding).toBeNull();
  });

  it("어댑터를 얻지 못하면 실패 사유를 스냅샷에 남긴 채 지원하지 않음으로 판정한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({ adapterAvailable: false, probeFailure: "adapter-request-timeout" }),
    );
    expect(result.tier).toBe("unsupported");
    expect(result.code).toBe("adapter-unavailable");
    expect(result.snapshot.probeFailure).toBe("adapter-request-timeout");
  });

  it("입력이 아예 없어도 던지지 않고 지원하지 않음으로 수렴한다", () => {
    expect(classifyStudioCapabilityTier(undefined).tier).toBe("unsupported");
    expect(classifyStudioCapabilityTier(null).code).toBe("webgpu-unavailable");
  });

  it("기준선 미만이면 가장 많이 모자란 한도를 지목한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({
        limits: limitsWith(STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, {
          maxStorageBufferBindingSize: 128 * MIB - 1,
        }),
      }),
    );
    expect(result.tier).toBe("unsupported");
    expect(result.code).toBe("below-floor");
    expect(result.deciding).toMatchObject({
      signal: "maxStorageBufferBindingSize",
      measured: 128 * MIB - 1,
      required: 128 * MIB,
      blockedTier: "lite",
    });
  });

  it("GPU 한도를 확인할 수 없으면 fail-closed 로 기준선 미달 처리한다", () => {
    const { maxTextureDimension3D: _omitted, ...withoutTexture3d } =
      STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS;
    const result = classifyStudioCapabilityTier(snapshot({ limits: withoutTexture3d }));
    expect(result.tier).toBe("unsupported");
    expect(result.code).toBe("below-floor");
    expect(result.deciding).toMatchObject({
      signal: "maxTextureDimension3D",
      measured: null,
      required: 2_048,
    });
  });
});

describe("classifyStudioCapabilityTier — 등급 경계", () => {
  it("full 기준을 정확히 만족하면 full 이고 결정 한도가 없다", () => {
    const result = classifyStudioCapabilityTier(snapshot());
    expect(result.tier).toBe("full");
    expect(result.code).toBe("meets-full");
    expect(result.deciding).toBeNull();
  });

  it("maxBufferSize 가 1바이트 모자라면 standard 로 내려가고 그 한도를 지목한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({
        limits: limitsWith(STUDIO_CAPABILITY_FULL_TIER_LIMITS, { maxBufferSize: 1 * GIB - 1 }),
      }),
    );
    expect(result.tier).toBe("standard");
    expect(result.code).toBe("gpu-limit-capped");
    expect(result.deciding).toMatchObject({
      signal: "maxBufferSize",
      kind: "gpu-limit",
      measured: 1 * GIB - 1,
      required: 1 * GIB,
      blockedTier: "full",
    });
  });

  it("명세 기본 한도 그대로면 lite 이고 가장 모자란 한도(동률이면 표 순서)를 지목한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS }),
    );
    expect(result.tier).toBe("lite");
    expect(result.code).toBe("gpu-limit-capped");
    // 256MiB/384MiB 와 128MiB/192MiB 는 둘 다 2/3 로 동률 → 요구표에 먼저 나온 쪽이 결정 한도.
    expect(result.deciding).toMatchObject({
      signal: "maxBufferSize",
      measured: 256 * MIB,
      required: 384 * MIB,
      blockedTier: "standard",
    });
  });

  it("저장 버퍼 4개만 지원하는 축소 프로필도 lite 로 살아남는다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({
        limits: limitsWith(STUDIO_CAPABILITY_FULL_TIER_LIMITS, {
          maxStorageBuffersPerShaderStage: 4,
        }),
      }),
    );
    expect(result.tier).toBe("lite");
    expect(result.deciding).toMatchObject({
      signal: "maxStorageBuffersPerShaderStage",
      measured: 4,
      required: 8,
      blockedTier: "standard",
    });
  });

  it("호스트 신호가 낮으면 GPU 한도가 충분해도 등급이 내려간다", () => {
    const result = classifyStudioCapabilityTier(snapshot({ hardwareConcurrency: 4 }));
    expect(result.tier).toBe("standard");
    expect(result.code).toBe("host-signal-capped");
    expect(result.deciding).toMatchObject({
      signal: "hardwareConcurrency",
      kind: "host-signal",
      measured: 4,
      required: 8,
      blockedTier: "full",
    });
  });

  it("호스트 신호를 노출하지 않는 브라우저는 fail-open 으로 full 을 유지한다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({ hardwareConcurrency: null, deviceMemoryGb: null }),
    );
    expect(result.tier).toBe("full");
    expect(result.deciding).toBeNull();
  });

  it("기기 메모리가 낮으면 standard 를 거쳐 lite 까지 내려간다", () => {
    expect(classifyStudioCapabilityTier(snapshot({ deviceMemoryGb: 4 })).tier).toBe("standard");
    const low = classifyStudioCapabilityTier(snapshot({ deviceMemoryGb: 2 }));
    expect(low.tier).toBe("lite");
    expect(low.deciding).toMatchObject({
      signal: "deviceMemoryGb",
      measured: 2,
      required: 4,
      blockedTier: "standard",
    });
  });
});

describe("classifyStudioCapabilityTier — 기능 플래그와 정규화", () => {
  it("어댑터 기능 목록을 판정 결과의 불리언으로 옮긴다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({ features: ["timestamp-query", "shader-f16"] }),
    );
    expect(result.supportsTimestampQuery).toBe(true);
    expect(result.supportsShaderF16).toBe(true);
    expect(result.supportsFloat32Filterable).toBe(false);
  });

  it("지원하지 않는 기기에서는 기능 플래그를 모두 끈다", () => {
    const result = classifyStudioCapabilityTier(
      snapshot({
        webgpuAvailable: false,
        features: ["timestamp-query", "shader-f16", "float32-filterable"],
      }),
    );
    expect(result.supportsTimestampQuery).toBe(false);
    expect(result.supportsShaderF16).toBe(false);
    expect(result.supportsFloat32Filterable).toBe(false);
  });

  it("스냅샷 정규화가 중복 기능과 잘못된 숫자를 정리한다", () => {
    const normalized = normalizeStudioCapabilitySnapshot({
      webgpuAvailable: true,
      adapterAvailable: true,
      features: ["shader-f16", "shader-f16", "", "timestamp-query"],
      limits: {
        maxBufferSize: Number.NaN,
        maxStorageBufferBindingSize: -1,
        maxTextureDimension2D: 8_192,
      },
      hardwareConcurrency: Number.POSITIVE_INFINITY,
      deviceMemoryGb: -4,
    });
    expect(normalized.features).toEqual(["shader-f16", "timestamp-query"]);
    expect(normalized.limits.maxBufferSize).toBeUndefined();
    expect(normalized.limits.maxStorageBufferBindingSize).toBeUndefined();
    expect(normalized.limits.maxTextureDimension2D).toBe(8_192);
    expect(normalized.hardwareConcurrency).toBeNull();
    expect(normalized.deviceMemoryGb).toBeNull();
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("신호 조회는 확인 불가를 null 로 유지한다", () => {
    const normalized = normalizeStudioCapabilitySnapshot({ hardwareConcurrency: 12 });
    expect(readStudioCapabilitySignal(normalized, "hardwareConcurrency")).toBe(12);
    expect(readStudioCapabilitySignal(normalized, "deviceMemoryGb")).toBeNull();
    expect(readStudioCapabilitySignal(normalized, "maxBufferSize")).toBeNull();
  });

  it("등급 비교 헬퍼는 지원하지 않는 기기를 항상 거른다", () => {
    expect(isStudioCapabilityTierAtLeast("full", "standard")).toBe(true);
    expect(isStudioCapabilityTierAtLeast("standard", "standard")).toBe(true);
    expect(isStudioCapabilityTierAtLeast("lite", "standard")).toBe(false);
    expect(isStudioCapabilityTierAtLeast("unsupported", "lite")).toBe(false);
  });

  it("요구표는 상위 등급이 하위 등급보다 느슨해지지 않는다", () => {
    for (const requirement of STUDIO_CAPABILITY_TIER_REQUIREMENTS.lite) {
      const standard = STUDIO_CAPABILITY_TIER_REQUIREMENTS.standard.find(
        (candidate) => candidate.signal === requirement.signal,
      );
      expect(standard?.minimum ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(
        requirement.minimum,
      );
    }
    for (const requirement of STUDIO_CAPABILITY_TIER_REQUIREMENTS.standard) {
      const full = STUDIO_CAPABILITY_TIER_REQUIREMENTS.full.find(
        (candidate) => candidate.signal === requirement.signal,
      );
      expect(full?.minimum ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(requirement.minimum);
    }
  });
});
