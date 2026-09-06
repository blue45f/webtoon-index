/**
 * Studio 하드웨어 등급 안내 문구 — 판정 결과를 사용자에게 정직하게 설명한다.
 *
 * 규율
 * - 브라우저 이름을 절대 말하지 않는다. "이 브라우저는 안 됩니다"가 아니라 "이 한도가 이만큼
 *   이라 이 기능을 이만큼 낮췄습니다"라고만 말한다. 숫자는 전부 실측값과 계산값이고, 제품이
 *   정한 배정 비율은 "배정"이라고 구분해 적는다.
 * - 강등이 없으면 문장을 만들지 않는다(`null`). 아무 일도 없었는데 경고를 띄우지 않기 위해서다.
 * - 종결은 스튜디오 상태/오류 문구와 같은 합쇼체("~했습니다")를 쓴다.
 */

import type {
  StudioCapabilityAmountUnit,
  StudioCapabilityBudget,
  StudioCapabilityDowngradeReason,
  StudioCapabilityFeatureId,
  StudioCapabilityPlan,
} from "./studio-capability-budgets";
import type {
  StudioCapabilityClassification,
  StudioCapabilitySignalName,
  StudioCapabilityTier,
} from "./studio-capability-tier";

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

export const STUDIO_CAPABILITY_TIER_LABELS: Readonly<Record<StudioCapabilityTier, string>> =
  Object.freeze({
    full: "고급",
    standard: "표준",
    lite: "경량",
    unsupported: "미지원",
  });

interface SignalDescriptor {
  readonly label: string;
  readonly unit: StudioCapabilityAmountUnit | "gigabytes";
}

const SIGNAL_DESCRIPTORS: Readonly<Record<StudioCapabilitySignalName, SignalDescriptor>> =
  Object.freeze({
    maxBufferSize: { label: "버퍼 한도", unit: "bytes" },
    maxStorageBufferBindingSize: { label: "저장 버퍼 바인딩 한도", unit: "bytes" },
    maxUniformBufferBindingSize: { label: "유니폼 버퍼 바인딩 한도", unit: "bytes" },
    maxComputeWorkgroupStorageSize: { label: "컴퓨트 워크그룹 공유 메모리 한도", unit: "bytes" },
    maxComputeInvocationsPerWorkgroup: { label: "워크그룹당 컴퓨트 호출 한도", unit: "count" },
    maxTextureDimension2D: { label: "2D 텍스처 최대 크기", unit: "pixels" },
    maxTextureDimension3D: { label: "3D 텍스처 최대 크기", unit: "pixels" },
    maxStorageBuffersPerShaderStage: {
      label: "셰이더 단계당 저장 버퍼 개수 한도",
      unit: "count",
    },
    hardwareConcurrency: { label: "CPU 코어 수", unit: "count" },
    deviceMemoryGb: { label: "메모리 용량", unit: "gigabytes" },
  });

interface FeatureDescriptor {
  /** 강등 문구에서 쓰는 설정 이름. */
  readonly label: string;
  /** 목적격 조사 — 라벨 끝 음절의 받침에 맞춰 미리 확정해 둔다. */
  readonly objectParticle: "을" | "를";
  /** 기능을 통째로 끌 때 쓰는 이름(설정이 아니라 기능을 가리킨다). */
  readonly disabledLabel: string;
  readonly disabledParticle: "을" | "를";
}

const FEATURE_DESCRIPTORS: Readonly<Record<StudioCapabilityFeatureId, FeatureDescriptor>> =
  Object.freeze({
    "smoke-grid": {
      label: "연기 시뮬 해상도",
      objectParticle: "를",
      disabledLabel: "연기 시뮬레이션",
      disabledParticle: "을",
    },
    "path-trace-accumulation": {
      label: "패스 트레이서 누적 버퍼 해상도",
      objectParticle: "를",
      disabledLabel: "패스 트레이서",
      disabledParticle: "를",
    },
    "path-trace-bounces": {
      label: "패스 트레이서 최대 반사 횟수",
      objectParticle: "를",
      disabledLabel: "패스 트레이서",
      disabledParticle: "를",
    },
    "path-trace-bvh": {
      label: "패스 트레이서 BVH 노드 예산",
      objectParticle: "을",
      disabledLabel: "패스 트레이서",
      disabledParticle: "를",
    },
    "sculpt-vertices": {
      label: "스컬프트 최대 정점 수",
      objectParticle: "를",
      disabledLabel: "스컬프트",
      disabledParticle: "를",
    },
    "pbr-shadow-map": {
      label: "PBR 그림자 맵 크기",
      objectParticle: "를",
      disabledLabel: "PBR 그림자",
      disabledParticle: "를",
    },
    "pbr-ibl": {
      label: "PBR 환경광 큐브맵 크기",
      objectParticle: "를",
      disabledLabel: "PBR 환경광",
      disabledParticle: "을",
    },
  });

function groupDigits(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/** GPU 한도 관례대로 1MB = 1024×1024 바이트로 적는다. */
export function formatStudioCapabilityBytes(bytes: number): string {
  if (bytes >= BYTES_PER_MB) return `${trimDecimal(bytes / BYTES_PER_MB)}MB`;
  if (bytes >= BYTES_PER_KB) return `${trimDecimal(bytes / BYTES_PER_KB)}KB`;
  return `${groupDigits(bytes)}B`;
}

export function formatStudioCapabilityAmount(
  value: number,
  unit: StudioCapabilityAmountUnit | "gigabytes" | null,
): string {
  if (unit === "bytes") return formatStudioCapabilityBytes(value);
  if (unit === "pixels") return `${groupDigits(value)}px`;
  if (unit === "gigabytes") return `${trimDecimal(value)}GB`;
  return `${groupDigits(value)}개`;
}

function numberField(value: unknown, key: string): number | null {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : null;
}

function formatFeatureValue(feature: StudioCapabilityFeatureId, value: unknown): string {
  switch (feature) {
    case "smoke-grid": {
      const grid = numberField(value, "value") ?? 0;
      return `${groupDigits(grid)}³`;
    }
    case "path-trace-accumulation": {
      const width = numberField(value, "width") ?? 0;
      const height = numberField(value, "height") ?? 0;
      return `${groupDigits(width)}×${groupDigits(height)}`;
    }
    case "path-trace-bounces":
      return `${groupDigits(numberField(value, "value") ?? 0)}회`;
    case "path-trace-bvh":
      return `${groupDigits(numberField(value, "nodes") ?? 0)}개`;
    case "sculpt-vertices":
      return `${groupDigits(numberField(value, "maxVertices") ?? 0)}개`;
    case "pbr-shadow-map":
      return `${groupDigits(numberField(value, "size") ?? 0)}px`;
    case "pbr-ibl":
      return `${groupDigits(numberField(value, "baseSize") ?? 0)}px`;
    default:
      return "";
  }
}

function signalPhrase(signal: StudioCapabilitySignalName, value: number | null): string {
  const descriptor = SIGNAL_DESCRIPTORS[signal];
  if (value === null) return `${descriptor.label} 값`;
  return `${descriptor.label}(${formatStudioCapabilityAmount(value, descriptor.unit)})`;
}

function budgetDetail(reason: StudioCapabilityDowngradeReason): string {
  if (reason.required === null || reason.budget === null) return "";
  const required = formatStudioCapabilityAmount(reason.required, reason.unit);
  const budget = formatStudioCapabilityAmount(reason.budget, reason.unit);
  return ` (필요 ${required} / 배정 ${budget})`;
}

function describeDisabledBudget(
  budget: StudioCapabilityBudget<unknown>,
  descriptor: FeatureDescriptor,
): string {
  const { reason } = budget;
  const suffix = `${descriptor.disabledLabel}${descriptor.disabledParticle} 껐습니다.`;
  switch (reason.code) {
    case "device-unsupported":
      return `이 기기에서는 WebGPU 3D 가속을 쓸 수 없어 ${suffix}`;
    case "storage-buffer-count":
    case "compute-invocations":
    case "workgroup-storage": {
      if (reason.limit === null) return `이 기기의 GPU 한도가 모자라 ${suffix}`;
      const phrase = signalPhrase(reason.limit, reason.limitValue);
      if (reason.required === null) return `이 브라우저 GPU의 ${phrase} 때문에 ${suffix}`;
      const required = formatStudioCapabilityAmount(reason.required, reason.unit);
      return `이 브라우저 GPU의 ${phrase}가 필요한 ${required}에 못 미쳐 ${suffix}`;
    }
    case "floor-exceeded": {
      if (reason.limit === null) return `이 기기의 GPU 한도로는 실행할 수 없어 ${suffix}`;
      return (
        `이 브라우저 GPU의 ${signalPhrase(reason.limit, reason.limitValue)}로는 가장 낮은 ` +
        `설정도 실행할 수 없어 ${suffix}${budgetDetail(reason)}`
      );
    }
    default:
      return `이 기기의 GPU 한도로는 실행할 수 없어 ${suffix}`;
  }
}

/**
 * 예산 하나를 한 문장으로 설명한다. 강등도 중단도 없었으면 `null` 을 돌려준다.
 *
 * 예) "이 브라우저 GPU의 버퍼 한도(384MB) 때문에 연기 시뮬 해상도를 128³에서 96³까지
 *      낮췄습니다. (필요 120MB / 배정 96MB)"
 */
export function describeStudioCapabilityBudget(
  budget: StudioCapabilityBudget<unknown>,
): string | null {
  const descriptor = FEATURE_DESCRIPTORS[budget.feature];
  if (!budget.enabled) return describeDisabledBudget(budget, descriptor);
  if (budget.downgradedFrom === null) return null;

  const { reason } = budget;
  const from = formatFeatureValue(budget.feature, budget.downgradedFrom);
  const to = formatFeatureValue(budget.feature, budget.value);
  const change = `${descriptor.label}${descriptor.objectParticle} ${from}에서 ${to}까지 낮췄습니다.`;

  switch (reason.code) {
    case "tier-ceiling":
      return `이 기기의 GPU 등급이 '${STUDIO_CAPABILITY_TIER_LABELS[reason.tier]}'이라 ${change}`;
    case "storage-binding-budget":
    case "buffer-budget": {
      if (reason.limit === null) return change;
      return `이 브라우저 GPU의 ${signalPhrase(reason.limit, reason.limitValue)} 때문에 ${change}${budgetDetail(reason)}`;
    }
    case "texture-dimension": {
      if (reason.limit === null) return change;
      return `이 브라우저 GPU의 ${signalPhrase(reason.limit, reason.limitValue)} 때문에 ${change}`;
    }
    case "shared-memory-unavailable":
      return `이 문서가 교차 출처 격리(SharedArrayBuffer) 상태가 아니라 ${change}`;
    case "missing-gpu-feature":
      return `이 브라우저 GPU에 '${reason.gpuFeature ?? "필수"}' 기능이 없어 ${change}`;
    default:
      return change;
  }
}

/** 등급 판정 자체를 한 문장으로 설명한다(왜 이 등급인지 한도 이름까지 밝힌다). */
export function describeStudioCapabilityTier(
  classification: StudioCapabilityClassification,
): string {
  const tierLabel = STUDIO_CAPABILITY_TIER_LABELS[classification.tier];
  const off = "스튜디오 3D 가속 기능을 껐습니다.";
  switch (classification.code) {
    case "meets-full":
      return `이 기기의 GPU 한도가 스튜디오 3D 기능 전체를 감당합니다. ('${tierLabel}' 등급)`;
    case "webgpu-unavailable":
      return `이 브라우저에서 WebGPU를 사용할 수 없어 ${off}`;
    case "adapter-unavailable":
      switch (classification.snapshot.probeFailure) {
        case "adapter-request-timeout":
          return `GPU 어댑터가 시간 안에 응답하지 않아 ${off}`;
        case "adapter-request-aborted":
          return `GPU 확인이 중단되어 ${off}`;
        case "adapter-request-failed":
          return `GPU 어댑터를 요청하는 중 오류가 발생해 ${off}`;
        default:
          return `이 기기에서 사용할 수 있는 GPU 어댑터를 찾지 못해 ${off}`;
      }
    case "below-floor": {
      const deciding = classification.deciding;
      if (!deciding) return `이 기기의 GPU 한도가 최소 실행 기준에 못 미쳐 ${off}`;
      const unit = SIGNAL_DESCRIPTORS[deciding.signal].unit;
      if (deciding.measured === null) {
        return `이 브라우저 GPU의 ${signalPhrase(deciding.signal, null)}을 확인할 수 없어 ${off}`;
      }
      return (
        `이 브라우저 GPU의 ${signalPhrase(deciding.signal, deciding.measured)}가 최소 실행 ` +
        `기준(${formatStudioCapabilityAmount(deciding.required, unit)})에 못 미쳐 ${off}`
      );
    }
    case "gpu-limit-capped":
    case "host-signal-capped": {
      const deciding = classification.deciding;
      if (!deciding) return `이 기기는 '${tierLabel}' 등급으로 실행합니다.`;
      const owner = deciding.kind === "host-signal" ? "이 기기의" : "이 브라우저 GPU의";
      const blocked = STUDIO_CAPABILITY_TIER_LABELS[deciding.blockedTier];
      if (deciding.measured === null) {
        return `${owner} ${signalPhrase(deciding.signal, null)}을 확인할 수 없어 '${tierLabel}' 등급으로 실행합니다.`;
      }
      const unit = SIGNAL_DESCRIPTORS[deciding.signal].unit;
      return (
        `${owner} ${signalPhrase(deciding.signal, deciding.measured)}가 '${blocked}' 등급 ` +
        `기준(${formatStudioCapabilityAmount(deciding.required, unit)})에 못 미쳐 ` +
        `'${tierLabel}' 등급으로 실행합니다.`
      );
    }
    default:
      return `이 기기는 '${tierLabel}' 등급으로 실행합니다.`;
  }
}

export interface StudioCapabilitySummary {
  readonly tier: StudioCapabilityTier;
  readonly tierLabel: string;
  readonly tierMessage: string;
  /** 실제로 낮아지거나 꺼진 항목만. 아무 문제 없으면 빈 배열이다. */
  readonly downgradeMessages: readonly string[];
}

/** 패널 하나가 그대로 렌더할 수 있는 요약. 강등이 없으면 목록은 빈 배열이다. */
export function summarizeStudioCapabilityPlan(plan: StudioCapabilityPlan): StudioCapabilitySummary {
  const budgets: readonly StudioCapabilityBudget<unknown>[] = [
    plan.smokeGrid,
    plan.pathTrace.accumulation,
    plan.pathTrace.bounces,
    plan.pathTrace.bvh,
    plan.sculpt,
    plan.pbr.shadow,
    plan.pbr.ibl,
  ];
  const messages: string[] = [];
  for (const budget of budgets) {
    const message = describeStudioCapabilityBudget(budget);
    if (message !== null) messages.push(message);
  }
  return Object.freeze({
    tier: plan.tier,
    tierLabel: STUDIO_CAPABILITY_TIER_LABELS[plan.tier],
    tierMessage: describeStudioCapabilityTier(plan.classification),
    downgradeMessages: Object.freeze(messages),
  });
}
