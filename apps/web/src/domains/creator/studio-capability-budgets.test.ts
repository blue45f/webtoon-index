import { describe, expect, it } from "vitest";

import {
  STUDIO_CAPABILITY_FULL_TIER_LIMITS,
  STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS,
  collectStudioCapabilityDowngrades,
  resolveStudioCapabilityPlan,
  resolveStudioPathTraceBudget,
  resolveStudioPbrIblBudget,
  resolveStudioPbrShadowBudget,
  resolveStudioSculptBudget,
  resolveStudioSmokeGridBudget,
  studioPbrIblBytes,
  studioPbrIblPrefilterMipCount,
  studioPbrShadowBytes,
  studioSmokeVelocityBindingBytes,
  studioSmokeWorkingSetBytes,
} from "./studio-capability-budgets";
import {
  classifyStudioCapabilityTier,
  type StudioCapabilityAdapterLimits,
  type StudioCapabilityClassification,
  type StudioCapabilitySnapshotInput,
  type StudioCapabilityTier,
} from "./studio-capability-tier";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const ALL_FEATURES = ["timestamp-query", "float32-filterable", "shader-f16"];

function snapshot(overrides: StudioCapabilitySnapshotInput = {}): StudioCapabilitySnapshotInput {
  return {
    webgpuAvailable: true,
    adapterAvailable: true,
    limits: STUDIO_CAPABILITY_FULL_TIER_LIMITS,
    features: ALL_FEATURES,
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    ...overrides,
  };
}

function classify(overrides: StudioCapabilitySnapshotInput = {}): StudioCapabilityClassification {
  return classifyStudioCapabilityTier(snapshot(overrides));
}

/**
 * 등급과 스냅샷이 어긋난 입력에서도 해석기가 스스로 방어하는지 확인하기 위한 헬퍼.
 * (명세 기준선이 이미 높아서 실제 브라우저로는 도달하지 않는 안전망 분기를 검증한다.)
 */
function withForcedTier(
  tier: StudioCapabilityTier,
  overrides: StudioCapabilitySnapshotInput,
): StudioCapabilityClassification {
  return { ...classify(overrides), tier };
}

function limits(overrides: StudioCapabilityAdapterLimits): StudioCapabilityAdapterLimits {
  return { ...STUDIO_CAPABILITY_FULL_TIER_LIMITS, ...overrides };
}

const STANDARD_LIMITS = limits({
  maxBufferSize: 384 * MIB,
  maxStorageBufferBindingSize: 192 * MIB,
});

describe("연기 시뮬 격자 예산", () => {
  it("복셀 바이트 계산이 문서화된 값과 일치한다", () => {
    expect(studioSmokeWorkingSetBytes(128)).toBe(125_829_120);
    expect(studioSmokeVelocityBindingBytes(128)).toBe(33_554_432);
    expect(studioSmokeWorkingSetBytes(96)).toBe(53_084_160);
    expect(studioSmokeVelocityBindingBytes(96)).toBe(14_155_776);
    expect(studioSmokeWorkingSetBytes(64)).toBe(15_728_640);
  });

  it("full 등급에서는 128³ 를 그대로 쓴다", () => {
    const budget = resolveStudioSmokeGridBudget(classify());
    expect(budget.enabled).toBe(true);
    expect(budget.value).toBe(128);
    expect(budget.downgradedFrom).toBeNull();
    expect(budget.reason.code).toBe("within-budget");
  });

  it("저장 버퍼 바인딩 배정(12.5%)이 모자라면 96³ 로 내린다", () => {
    const budget = resolveStudioSmokeGridBudget(classify({ limits: STANDARD_LIMITS }));
    expect(budget.value).toBe(96);
    expect(budget.downgradedFrom).toBe(128);
    expect(budget.reason).toMatchObject({
      code: "storage-binding-budget",
      limit: "maxStorageBufferBindingSize",
      limitValue: 192 * MIB,
      budget: 25_165_824,
      required: 33_554_432,
      unit: "bytes",
    });
  });

  it("바인딩은 넉넉해도 작업 세트 배정(25%)이 모자라면 96³ 로 내린다", () => {
    const budget = resolveStudioSmokeGridBudget(
      classify({ limits: limits({ maxBufferSize: 384 * MIB }) }),
    );
    expect(budget.value).toBe(96);
    expect(budget.reason).toMatchObject({
      code: "buffer-budget",
      limit: "maxBufferSize",
      limitValue: 384 * MIB,
      budget: 100_663_296,
      required: 125_829_120,
    });
  });

  it("명세 최저 사양(lite)은 등급 천장 때문에 64³ 로 시작한다", () => {
    const budget = resolveStudioSmokeGridBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS }),
    );
    expect(budget.value).toBe(64);
    expect(budget.downgradedFrom).toBe(128);
    expect(budget.reason).toMatchObject({ code: "tier-ceiling", tier: "lite" });
  });

  it("WebGPU 를 못 쓰면 기능을 끈다", () => {
    const budget = resolveStudioSmokeGridBudget(classify({ webgpuAvailable: false }));
    expect(budget.enabled).toBe(false);
    expect(budget.value).toBe(0);
    expect(budget.reason.code).toBe("device-unsupported");
  });

  it("워크그룹 공유 메모리가 압력 타일보다 작으면 기능을 끈다", () => {
    const budget = resolveStudioSmokeGridBudget(
      withForcedTier("lite", {
        limits: limits({ maxComputeWorkgroupStorageSize: 8_192 }),
      }),
    );
    expect(budget.enabled).toBe(false);
    expect(budget.reason).toMatchObject({
      code: "workgroup-storage",
      limit: "maxComputeWorkgroupStorageSize",
      limitValue: 8_192,
      required: 16_384,
    });
  });

  it("가장 낮은 단(48³)도 배정에 못 들어가면 기능을 끈다", () => {
    const budget = resolveStudioSmokeGridBudget(
      withForcedTier("lite", { limits: limits({ maxStorageBufferBindingSize: 1_024 }) }),
    );
    expect(budget.enabled).toBe(false);
    expect(budget.reason).toMatchObject({
      code: "floor-exceeded",
      limit: "maxStorageBufferBindingSize",
      budget: 128,
      required: studioSmokeVelocityBindingBytes(48),
    });
  });
});

describe("패스 트레이싱 예산", () => {
  it("full 등급에서 요청 해상도를 그대로 누적한다", () => {
    const plan = resolveStudioPathTraceBudget(classify(), { width: 1_920, height: 1_080 });
    expect(plan.accumulation.value).toMatchObject({
      width: 1_920,
      height: 1_080,
      scale: 1,
      bytesPerPixel: 8,
      bytes: 1_920 * 1_080 * 8,
    });
    expect(plan.accumulation.downgradedFrom).toBeNull();
    expect(plan.bounces.value).toBe(8);
    expect(plan.bvh.value).toMatchObject({ nodes: 4_194_304, bytes: 4_194_304 * 32 });
    expect(plan.bvh.downgradedFrom).toBeNull();
  });

  it("shader-f16 이 없으면 누적 픽셀당 16바이트를 쓴다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ features: ["float32-filterable"] }),
      { width: 1_920, height: 1_080 },
    );
    expect(plan.accumulation.value.bytesPerPixel).toBe(16);
    expect(plan.accumulation.value.bytes).toBe(33_177_600);
  });

  it("standard 등급은 등급 천장으로 반사 횟수와 BVH 예산을 함께 내린다", () => {
    const plan = resolveStudioPathTraceBudget(classify({ limits: STANDARD_LIMITS }));
    expect(plan.accumulation.value).toMatchObject({ width: 1_440, height: 810, scale: 0.75 });
    expect(plan.accumulation.reason.code).toBe("tier-ceiling");
    expect(plan.bounces.value).toBe(5);
    expect(plan.bounces.downgradedFrom).toBe(8);
    expect(plan.bvh.value.nodes).toBe(1_048_576);
    expect(plan.bvh.reason.code).toBe("tier-ceiling");
  });

  it("요청 해상도가 커지면 배정 바이트가 사다리를 한 단 더 내린다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
      { width: 7_680, height: 4_320 },
    );
    expect(plan.accumulation.value).toMatchObject({ width: 1_920, height: 1_080, scale: 0.25 });
    expect(plan.accumulation.reason).toMatchObject({
      code: "storage-binding-budget",
      limit: "maxStorageBufferBindingSize",
      limitValue: 128 * MIB,
      budget: 33_554_432,
      required: 3_840 * 2_160 * 16,
    });
  });

  it("shader-f16 이 있으면 같은 요청이 한 단 위에서 통과한다", () => {
    const floor = { limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS } as const;
    const request = { width: 5_120, height: 2_880 } as const;
    const withoutF16 = resolveStudioPathTraceBudget(classify({ ...floor, features: [] }), request);
    const withF16 = resolveStudioPathTraceBudget(
      classify({ ...floor, features: ["shader-f16"] }),
      request,
    );
    expect(withoutF16.accumulation.value).toMatchObject({ width: 1_280, height: 720, scale: 0.25 });
    expect(withF16.accumulation.value).toMatchObject({ width: 2_560, height: 1_440, scale: 0.5 });
    expect(withF16.accumulation.value.bytes).toBe(29_491_200);
  });

  it("저장 버퍼 개수가 6개에 못 미치면 패스 트레이서만 끈다", () => {
    const classification = classify({ limits: limits({ maxStorageBuffersPerShaderStage: 4 }) });
    expect(classification.tier).toBe("lite");
    const plan = resolveStudioPathTraceBudget(classification);
    expect(plan.accumulation.enabled).toBe(false);
    expect(plan.bounces.enabled).toBe(false);
    expect(plan.bvh.enabled).toBe(false);
    expect(plan.accumulation.reason).toMatchObject({
      code: "storage-buffer-count",
      limit: "maxStorageBuffersPerShaderStage",
      limitValue: 4,
      required: 6,
      unit: "count",
    });
    // 같은 기기에서 연기 시뮬은 계속 동작한다 — 기능 단위 강등의 핵심.
    expect(resolveStudioSmokeGridBudget(classification).enabled).toBe(true);
  });

  it("가장 낮은 배율도 배정에 안 들어가면 기능을 끈다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
      { width: 16_384, height: 16_384 },
    );
    expect(plan.accumulation.enabled).toBe(false);
    expect(plan.accumulation.reason.code).toBe("floor-exceeded");
  });

  it("잘못된 요청 크기는 기본 해상도로 대체한다", () => {
    const plan = resolveStudioPathTraceBudget(classify(), {
      width: Number.NaN,
      height: -1,
    });
    expect(plan.accumulation.value).toMatchObject({ width: 1_920, height: 1_080 });
  });

  it("지원하지 않는 기기에서는 세 예산이 모두 꺼진다", () => {
    const plan = resolveStudioPathTraceBudget(classify({ adapterAvailable: false }));
    expect([plan.accumulation.enabled, plan.bounces.enabled, plan.bvh.enabled]).toEqual([
      false,
      false,
      false,
    ]);
    expect(plan.bvh.reason.code).toBe("device-unsupported");
  });
});

describe("스컬프트 정점 예산", () => {
  it("full 등급은 512MiB 바인딩 배정을 정확히 채운 8,388,608 정점을 쓴다", () => {
    const budget = resolveStudioSculptBudget(classify());
    expect(budget.value).toMatchObject({
      maxVertices: 8_388_608,
      brushWorkgroupSize: 256,
      vertexBufferBytes: 268_435_456,
      workingSetBytes: 402_653_184,
    });
    expect(budget.downgradedFrom).toBeNull();
  });

  it("교차 출처 격리가 아니면 구조화 복제 한계까지 내린다", () => {
    const budget = resolveStudioSculptBudget(
      classify({ crossOriginIsolated: false, sharedArrayBufferAvailable: false }),
    );
    expect(budget.value.maxVertices).toBe(2_097_152);
    expect(budget.reason).toMatchObject({
      code: "shared-memory-unavailable",
      budget: 2_097_152,
      required: 8_388_608,
      unit: "count",
    });
  });

  it("등급 천장이 정점 상한을 정한다", () => {
    expect(
      resolveStudioSculptBudget(classify({ limits: STANDARD_LIMITS })).value.maxVertices,
    ).toBe(2_097_152);
    const lite = resolveStudioSculptBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS }),
    );
    expect(lite.value.maxVertices).toBe(524_288);
    expect(lite.reason.code).toBe("tier-ceiling");
  });

  it("바인딩 배정이 모자라면 사다리를 정확히 한 단 내린다", () => {
    const budget = resolveStudioSculptBudget(
      withForcedTier("full", { limits: limits({ maxStorageBufferBindingSize: 256 * MIB }) }),
    );
    expect(budget.value.maxVertices).toBe(4_194_304);
    expect(budget.reason).toMatchObject({
      code: "storage-binding-budget",
      budget: 134_217_728,
      required: 268_435_456,
    });
  });

  it("워크그룹 호출 한도가 너무 낮으면 기능을 끈다", () => {
    const budget = resolveStudioSculptBudget(
      withForcedTier("lite", { limits: limits({ maxComputeInvocationsPerWorkgroup: 16 }) }),
    );
    expect(budget.enabled).toBe(false);
    expect(budget.reason).toMatchObject({
      code: "compute-invocations",
      limitValue: 16,
      required: 32,
    });
  });
});

describe("PBR 그림자·환경광 예산", () => {
  it("그림자 맵 바이트 계산이 4단 CSM 기준과 일치한다", () => {
    expect(studioPbrShadowBytes(4_096)).toBe(268_435_456);
    expect(studioPbrShadowBytes(2_048)).toBe(67_108_864);
    expect(studioPbrShadowBytes(1_024)).toBe(16_777_216);
  });

  it("full 등급은 1GiB 버퍼 배정을 정확히 채운 4096px 그림자를 쓴다", () => {
    const budget = resolveStudioPbrShadowBudget(classify());
    expect(budget.value).toMatchObject({ size: 4_096, cascades: 4, bytes: 268_435_456 });
    expect(budget.downgradedFrom).toBeNull();
  });

  it("등급이 내려가면 그림자 맵도 한 단씩 내려간다", () => {
    expect(resolveStudioPbrShadowBudget(classify({ limits: STANDARD_LIMITS })).value.size).toBe(
      2_048,
    );
    expect(
      resolveStudioPbrShadowBudget(classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS })).value
        .size,
    ).toBe(1_024);
  });

  it("버퍼 배정이 4096px 를 못 담으면 2048px 로 내린다", () => {
    const budget = resolveStudioPbrShadowBudget(
      withForcedTier("full", { limits: limits({ maxBufferSize: 768 * MIB }) }),
    );
    expect(budget.value.size).toBe(2_048);
    expect(budget.reason).toMatchObject({
      code: "buffer-budget",
      limit: "maxBufferSize",
      budget: 201_326_592,
      required: 268_435_456,
    });
  });

  it("IBL 밉 체인 바이트와 러프니스 단계 수가 정확하다", () => {
    expect(studioPbrIblBytes(512)).toBe(16_777_200);
    expect(studioPbrIblBytes(256)).toBe(4_194_288);
    expect(studioPbrIblBytes(128)).toBe(1_048_560);
    expect(studioPbrIblPrefilterMipCount(512)).toBe(8);
    expect(studioPbrIblPrefilterMipCount(128)).toBe(6);
  });

  it("float32-filterable 이 있으면 512px 큐브맵을 그대로 쓴다", () => {
    const budget = resolveStudioPbrIblBudget(classify());
    expect(budget.value).toMatchObject({
      baseSize: 512,
      prefilterMipCount: 8,
      bytes: 16_777_200,
    });
    expect(budget.downgradedFrom).toBeNull();
  });

  it("float32-filterable 이 없으면 수동 보간 상한(256px)까지 내린다", () => {
    const budget = resolveStudioPbrIblBudget(classify({ features: ["shader-f16"] }));
    expect(budget.value.baseSize).toBe(256);
    expect(budget.reason).toMatchObject({
      code: "missing-gpu-feature",
      gpuFeature: "float32-filterable",
      budget: 256,
      required: 512,
    });
  });

  it("등급 천장이 이미 더 낮으면 기능 부재 사유가 등급 사유를 덮지 않는다", () => {
    const budget = resolveStudioPbrIblBudget(
      classify({ limits: STANDARD_LIMITS, features: [] }),
    );
    expect(budget.value.baseSize).toBe(256);
    expect(budget.reason.code).toBe("tier-ceiling");
  });
});

describe("통합 계획", () => {
  it("full + 전체 기능 + 공유 메모리에서는 강등이 하나도 없다", () => {
    const plan = resolveStudioCapabilityPlan(classify());
    expect(plan.tier).toBe("full");
    expect(collectStudioCapabilityDowngrades(plan)).toHaveLength(0);
  });

  it("명세 최저 사양에서는 일곱 예산이 모두 강등으로 보고된다", () => {
    const plan = resolveStudioCapabilityPlan(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
    );
    expect(plan.tier).toBe("lite");
    const downgrades = collectStudioCapabilityDowngrades(plan);
    expect(downgrades).toHaveLength(7);
    expect(downgrades.map((budget) => budget.feature)).toEqual([
      "smoke-grid",
      "path-trace-accumulation",
      "path-trace-bounces",
      "path-trace-bvh",
      "sculpt-vertices",
      "pbr-shadow-map",
      "pbr-ibl",
    ]);
  });

  it("패스 트레이스 요청 해상도는 계획 진입점으로 전달된다", () => {
    const plan = resolveStudioCapabilityPlan(classify(), {
      pathTrace: { width: 800, height: 600 },
    });
    expect(plan.pathTrace.accumulation.value).toMatchObject({ width: 800, height: 600 });
  });

  it("지원하지 않는 기기의 계획은 모든 예산이 꺼진 상태로 나온다", () => {
    const plan = resolveStudioCapabilityPlan(classify({ webgpuAvailable: false }));
    expect(plan.tier).toBe("unsupported");
    const downgrades = collectStudioCapabilityDowngrades(plan);
    expect(downgrades).toHaveLength(7);
    expect(downgrades.every((budget) => !budget.enabled)).toBe(true);
  });

  it("사다리 값이 1GiB 상수와 어긋나지 않는다", () => {
    expect(STUDIO_CAPABILITY_FULL_TIER_LIMITS.maxBufferSize).toBe(GIB);
    expect(STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS.maxBufferSize).toBe(256 * MIB);
  });
});
