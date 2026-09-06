import { describe, expect, it } from "vitest";

import {
  STUDIO_CAPABILITY_FULL_TIER_LIMITS,
  STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS,
  resolveStudioCapabilityPlan,
  resolveStudioPathTraceBudget,
  resolveStudioPbrIblBudget,
  resolveStudioSculptBudget,
  resolveStudioSmokeGridBudget,
} from "./studio-capability-budgets";
import {
  describeStudioCapabilityBudget,
  describeStudioCapabilityTier,
  formatStudioCapabilityBytes,
  summarizeStudioCapabilityPlan,
} from "./studio-capability-messages";
import {
  classifyStudioCapabilityTier,
  type StudioCapabilityAdapterLimits,
  type StudioCapabilityClassification,
  type StudioCapabilitySnapshotInput,
} from "./studio-capability-tier";

const MIB = 1024 * 1024;

const ALL_FEATURES = ["timestamp-query", "float32-filterable", "shader-f16"];

/** 문구에 절대 등장하면 안 되는 단어 — 브라우저·엔진 이름으로 분기하지 않는다는 계약. */
const FORBIDDEN_WORDS = [
  "Safari",
  "사파리",
  "Chrome",
  "크롬",
  "Firefox",
  "파이어폭스",
  "Edge",
  "WebKit",
  "Blink",
  "Gecko",
];

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

function limits(overrides: StudioCapabilityAdapterLimits): StudioCapabilityAdapterLimits {
  return { ...STUDIO_CAPABILITY_FULL_TIER_LIMITS, ...overrides };
}

describe("formatStudioCapabilityBytes", () => {
  it("GPU 한도 관례(1MB = 1024×1024)로 적고 불필요한 소수점을 지운다", () => {
    expect(formatStudioCapabilityBytes(125_829_120)).toBe("120MB");
    expect(formatStudioCapabilityBytes(53_084_160)).toBe("50.6MB");
    expect(formatStudioCapabilityBytes(1 * MIB)).toBe("1MB");
    expect(formatStudioCapabilityBytes(65_536)).toBe("64KB");
    expect(formatStudioCapabilityBytes(512)).toBe("512B");
  });
});

describe("describeStudioCapabilityBudget — 강등 사유별 문구", () => {
  it("강등도 중단도 없으면 문장을 만들지 않는다", () => {
    expect(describeStudioCapabilityBudget(resolveStudioSmokeGridBudget(classify()))).toBeNull();
  });

  it("저장 버퍼 바인딩 배정 부족을 필요/배정 숫자까지 밝힌다", () => {
    const budget = resolveStudioSmokeGridBudget(
      classify({
        limits: limits({ maxBufferSize: 384 * MIB, maxStorageBufferBindingSize: 192 * MIB }),
      }),
    );
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 브라우저 GPU의 저장 버퍼 바인딩 한도(192MB) 때문에 연기 시뮬 해상도를 " +
        "128³에서 96³까지 낮췄습니다. (필요 32MB / 배정 24MB)",
    );
  });

  it("버퍼 배정 부족도 같은 형식으로 설명한다", () => {
    const budget = resolveStudioSmokeGridBudget(classify({ limits: limits({ maxBufferSize: 384 * MIB }) }));
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 브라우저 GPU의 버퍼 한도(384MB) 때문에 연기 시뮬 해상도를 128³에서 96³까지 " +
        "낮췄습니다. (필요 120MB / 배정 96MB)",
    );
  });

  it("등급 천장으로 내려간 경우 등급 이름을 말한다", () => {
    const budget = resolveStudioSmokeGridBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS }),
    );
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 기기의 GPU 등급이 '경량'이라 연기 시뮬 해상도를 128³에서 64³까지 낮췄습니다.",
    );
  });

  it("공유 메모리 부재는 GPU 한도가 아니라 문서 상태로 설명한다", () => {
    const budget = resolveStudioSculptBudget(
      classify({ crossOriginIsolated: false, sharedArrayBufferAvailable: false }),
    );
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 문서가 교차 출처 격리(SharedArrayBuffer) 상태가 아니라 스컬프트 최대 정점 수를 " +
        "8,388,608개에서 2,097,152개까지 낮췄습니다.",
    );
  });

  it("WebGPU 기능 부재는 기능 이름을 그대로 밝힌다", () => {
    const budget = resolveStudioPbrIblBudget(classify({ features: ["shader-f16"] }));
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 브라우저 GPU에 'float32-filterable' 기능이 없어 PBR 환경광 큐브맵 크기를 " +
        "512px에서 256px까지 낮췄습니다.",
    );
  });

  it("바인딩 개수 부족으로 끈 기능은 필요 개수를 밝힌다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: limits({ maxStorageBuffersPerShaderStage: 4 }) }),
    );
    expect(describeStudioCapabilityBudget(plan.accumulation)).toBe(
      "이 브라우저 GPU의 셰이더 단계당 저장 버퍼 개수 한도(4개)가 필요한 6개에 못 미쳐 " +
        "패스 트레이서를 껐습니다.",
    );
  });

  it("가장 낮은 설정도 못 켤 때는 그렇게 말한다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
      { width: 16_384, height: 16_384 },
    );
    expect(describeStudioCapabilityBudget(plan.accumulation)).toBe(
      "이 브라우저 GPU의 저장 버퍼 바인딩 한도(128MB)로는 가장 낮은 설정도 실행할 수 없어 " +
        "패스 트레이서를 껐습니다. (필요 256MB / 배정 32MB)",
    );
  });

  it("WebGPU 자체가 없으면 기능을 껐다고만 말한다", () => {
    const budget = resolveStudioSmokeGridBudget(classify({ webgpuAvailable: false }));
    expect(describeStudioCapabilityBudget(budget)).toBe(
      "이 기기에서는 WebGPU 3D 가속을 쓸 수 없어 연기 시뮬레이션을 껐습니다.",
    );
  });

  it("요청 해상도 때문에 내려간 누적 버퍼는 전후 해상도를 함께 보여준다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
      { width: 7_680, height: 4_320 },
    );
    expect(describeStudioCapabilityBudget(plan.accumulation)).toBe(
      "이 브라우저 GPU의 저장 버퍼 바인딩 한도(128MB) 때문에 패스 트레이서 누적 버퍼 " +
        "해상도를 7,680×4,320에서 1,920×1,080까지 낮췄습니다. (필요 126.6MB / 배정 32MB)",
    );
  });

  it("반사 횟수와 BVH 예산도 각각 자기 단위로 설명한다", () => {
    const plan = resolveStudioPathTraceBudget(
      classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
    );
    expect(describeStudioCapabilityBudget(plan.bounces)).toContain("8회에서 3회까지");
    expect(describeStudioCapabilityBudget(plan.bvh)).toContain(
      "4,194,304개에서 262,144개까지",
    );
  });
});

describe("describeStudioCapabilityTier", () => {
  it("full 이면 낮출 것이 없다고 말한다", () => {
    expect(describeStudioCapabilityTier(classify())).toBe(
      "이 기기의 GPU 한도가 스튜디오 3D 기능 전체를 감당합니다. ('고급' 등급)",
    );
  });

  it("WebGPU 미지원과 어댑터 실패를 구분해 말한다", () => {
    expect(describeStudioCapabilityTier(classify({ webgpuAvailable: false }))).toBe(
      "이 브라우저에서 WebGPU를 사용할 수 없어 스튜디오 3D 가속 기능을 껐습니다.",
    );
    expect(
      describeStudioCapabilityTier(
        classify({ adapterAvailable: false, probeFailure: "adapter-request-timeout" }),
      ),
    ).toBe("GPU 어댑터가 시간 안에 응답하지 않아 스튜디오 3D 가속 기능을 껐습니다.");
    expect(
      describeStudioCapabilityTier(
        classify({ adapterAvailable: false, probeFailure: "adapter-request-failed" }),
      ),
    ).toBe("GPU 어댑터를 요청하는 중 오류가 발생해 스튜디오 3D 가속 기능을 껐습니다.");
    expect(
      describeStudioCapabilityTier(
        classify({ adapterAvailable: false, probeFailure: "adapter-unavailable" }),
      ),
    ).toBe("이 기기에서 사용할 수 있는 GPU 어댑터를 찾지 못해 스튜디오 3D 가속 기능을 껐습니다.");
  });

  it("기준선 미달이면 어떤 한도가 얼마나 모자란지 말한다", () => {
    expect(describeStudioCapabilityTier(classify({ limits: limits({ maxBufferSize: 64 * MIB }) }))).toBe(
      "이 브라우저 GPU의 버퍼 한도(64MB)가 최소 실행 기준(256MB)에 못 미쳐 " +
        "스튜디오 3D 가속 기능을 껐습니다.",
    );
  });

  it("한도를 확인조차 못 했으면 그렇게 말한다", () => {
    const { maxTextureDimension3D: _omitted, ...withoutTexture3d } =
      STUDIO_CAPABILITY_FULL_TIER_LIMITS;
    expect(describeStudioCapabilityTier(classify({ limits: withoutTexture3d }))).toBe(
      "이 브라우저 GPU의 3D 텍스처 최대 크기 값을 확인할 수 없어 " +
        "스튜디오 3D 가속 기능을 껐습니다.",
    );
  });

  it("GPU 한도로 등급이 내려가면 놓친 등급 기준까지 밝힌다", () => {
    expect(
      describeStudioCapabilityTier(classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS })),
    ).toBe(
      "이 브라우저 GPU의 버퍼 한도(256MB)가 '표준' 등급 기준(384MB)에 못 미쳐 " +
        "'경량' 등급으로 실행합니다.",
    );
  });

  it("호스트 신호로 내려간 경우 GPU 가 아니라 기기 이야기를 한다", () => {
    expect(describeStudioCapabilityTier(classify({ hardwareConcurrency: 4 }))).toBe(
      "이 기기의 CPU 코어 수(4개)가 '고급' 등급 기준(8개)에 못 미쳐 '표준' 등급으로 실행합니다.",
    );
    expect(describeStudioCapabilityTier(classify({ deviceMemoryGb: 2 }))).toBe(
      "이 기기의 메모리 용량(2GB)가 '표준' 등급 기준(4GB)에 못 미쳐 '경량' 등급으로 실행합니다.",
    );
  });
});

describe("summarizeStudioCapabilityPlan", () => {
  it("문제가 없으면 강등 목록이 비어 있다", () => {
    const summary = summarizeStudioCapabilityPlan(resolveStudioCapabilityPlan(classify()));
    expect(summary.tier).toBe("full");
    expect(summary.tierLabel).toBe("고급");
    expect(summary.downgradeMessages).toEqual([]);
  });

  it("명세 최저 사양에서는 일곱 문장을 모두 만든다", () => {
    const summary = summarizeStudioCapabilityPlan(
      resolveStudioCapabilityPlan(
        classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS, features: [] }),
      ),
    );
    expect(summary.tierLabel).toBe("경량");
    expect(summary.downgradeMessages).toHaveLength(7);
    expect(summary.downgradeMessages.every((message) => message.endsWith("."))).toBe(true);
  });

  it("어떤 문구에도 브라우저·엔진 이름이 등장하지 않는다", () => {
    const plans = [
      resolveStudioCapabilityPlan(classify()),
      resolveStudioCapabilityPlan(classify({ limits: STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS })),
      resolveStudioCapabilityPlan(classify({ limits: limits({ maxBufferSize: 64 * MIB }) })),
      resolveStudioCapabilityPlan(classify({ webgpuAvailable: false })),
      resolveStudioCapabilityPlan(
        classify({ crossOriginIsolated: false, sharedArrayBufferAvailable: false }),
      ),
    ];
    for (const plan of plans) {
      const summary = summarizeStudioCapabilityPlan(plan);
      const text = [summary.tierMessage, ...summary.downgradeMessages].join(" ");
      for (const word of FORBIDDEN_WORDS) {
        expect(text).not.toContain(word);
      }
    }
  });
});
