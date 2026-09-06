/**
 * Studio 하드웨어 등급 모델 — 실제로 측정한 WebGPU 어댑터 한도만으로 판정하는 순수 코어.
 *
 * 판정 규율
 * - 브라우저 이름·User-Agent·엔진 문자열로 분기하지 않는다. 이 파일과 형제 모듈
 *   (studio-capability-budgets / studio-capability-probe / studio-capability-messages)에는
 *   브라우저 식별 코드가 존재하지 않으며, 앞으로도 추가하지 않는다. 같은 한도를 보고하는
 *   기기는 어떤 브라우저에서 열든 같은 등급을 받는다. "이 브라우저는 통째로 차단" 대신
 *   "모자란 한도 하나를 지목하고 그 기능만 낮춘다"가 이 모듈의 전체 목적이다.
 * - 입력은 라이브 브라우저 객체가 아니라 평범한 데이터 스냅샷(`StudioCapabilitySnapshot`)이다.
 *   probe 어댑터가 스냅샷을 만들고, 이 코어는 window·navigator·GPU 전역을 전혀 읽지 않는다
 *   (테스트·워커·서버 렌더·제한된 웹뷰에서 동일하게 동작한다).
 * - GPU 한도는 fail-closed(확인 불가 = 0 취급), 호스트 신호(CPU 코어 수·기기 메모리)는
 *   fail-open(확인 불가 = 통과). 브라우저가 노출하지 않는 값 때문에 성능 좋은 기기를 벌하지
 *   않되, 검증할 수 없는 GPU 한도 위에 무거운 작업을 올리지도 않는다.
 *
 * 등급 기준선(`lite`)은 WebGPU 명세가 모든 구현에 보장하는 기본 한도(default limits)와 같다.
 * 즉 `lite`는 "명세 최저 사양 그대로", `standard`/`full`은 그 위로 실측 여유가 확인된 기기다.
 */

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const STUDIO_CAPABILITY_LIMIT_NAMES = [
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxUniformBufferBindingSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxStorageBuffersPerShaderStage",
] as const;

export type StudioCapabilityLimitName = (typeof STUDIO_CAPABILITY_LIMIT_NAMES)[number];
export type StudioCapabilityHostSignalName = "hardwareConcurrency" | "deviceMemoryGb";
export type StudioCapabilitySignalName =
  | StudioCapabilityLimitName
  | StudioCapabilityHostSignalName;

export type StudioCapabilityAdapterLimits = {
  readonly [Name in StudioCapabilityLimitName]?: number;
};

/** 어댑터를 못 얻었을 때의 사유. 등급 판정은 같지만 사용자 문구는 달라진다. */
export type StudioCapabilityProbeFailure =
  | "webgpu-api-unavailable"
  | "adapter-unavailable"
  | "adapter-request-failed"
  | "adapter-request-timeout"
  | "adapter-request-aborted";

export interface StudioCapabilitySnapshot {
  readonly webgpuAvailable: boolean;
  readonly adapterAvailable: boolean;
  readonly limits: StudioCapabilityAdapterLimits;
  readonly features: readonly string[];
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBufferAvailable: boolean;
  /** 확인 불가는 `null` — 0 과 구분해야 문구가 정직해진다. */
  readonly hardwareConcurrency: number | null;
  readonly deviceMemoryGb: number | null;
  readonly probeFailure: StudioCapabilityProbeFailure | null;
}

export interface StudioCapabilitySnapshotInput {
  readonly webgpuAvailable?: boolean;
  readonly adapterAvailable?: boolean;
  readonly limits?: StudioCapabilityAdapterLimits | null;
  readonly features?: Iterable<string> | null;
  readonly crossOriginIsolated?: boolean;
  readonly sharedArrayBufferAvailable?: boolean;
  readonly hardwareConcurrency?: number | null;
  readonly deviceMemoryGb?: number | null;
  readonly probeFailure?: StudioCapabilityProbeFailure | null;
}

export type StudioCapabilityTier = "full" | "standard" | "lite" | "unsupported";
export type StudioCapabilityRankedTier = Exclude<StudioCapabilityTier, "unsupported">;

/** 높은 등급부터. 스냅샷은 모든 요구를 만족하는 첫 등급을 받는다. */
export const STUDIO_CAPABILITY_TIER_ORDER = ["full", "standard", "lite"] as const;

export type StudioCapabilityTierCode =
  | "meets-full"
  | "gpu-limit-capped"
  | "host-signal-capped"
  | "below-floor"
  | "webgpu-unavailable"
  | "adapter-unavailable";

export interface StudioCapabilityRequirement {
  readonly signal: StudioCapabilitySignalName;
  readonly minimum: number;
  /** `gpu-limit` 은 확인 불가 시 실패, `host-signal` 은 확인 불가 시 통과. */
  readonly kind: "gpu-limit" | "host-signal";
}

export interface StudioCapabilityDecision {
  readonly signal: StudioCapabilitySignalName;
  readonly kind: StudioCapabilityRequirement["kind"];
  /** 실측값. `null` 은 브라우저가 값을 노출하지 않아 확인 불가. */
  readonly measured: number | null;
  readonly required: number;
  /** 이 신호 때문에 놓친 등급. */
  readonly blockedTier: StudioCapabilityRankedTier;
}

export interface StudioCapabilityClassification {
  readonly tier: StudioCapabilityTier;
  readonly code: StudioCapabilityTierCode;
  /** 등급을 결정한 한도. `full` 이면 `null`. */
  readonly deciding: StudioCapabilityDecision | null;
  readonly snapshot: StudioCapabilitySnapshot;
  readonly supportsTimestampQuery: boolean;
  readonly supportsFloat32Filterable: boolean;
  readonly supportsShaderF16: boolean;
}

/**
 * 등급별 요구 한도표.
 *
 * `lite` 행은 WebGPU 명세의 보장 기본 한도 그대로다(256MiB 버퍼 / 128MiB 저장 버퍼 바인딩 /
 * 64KiB 유니폼 바인딩 / 16KiB 워크그룹 공유 메모리 / 워크그룹당 256 호출 / 8192px 2D /
 * 2048px 3D). 이보다 낮게 보고하는 어댑터는 명세를 만족하지 못하는 것이므로 3D 가속을 켜지 않는다.
 *
 * 예외 하나: `maxStorageBuffersPerShaderStage` 만 명세 기본값(8)이 아니라 4를 기준선으로 쓴다.
 * 저장 버퍼를 4개까지만 허용하는 축소 프로필(compatibility mode) 어댑터가 실제로 존재하는데,
 * 그런 기기에서도 연기 시뮬·스컬프트·PBR 은 충분히 돌아간다. 6개 바인딩이 반드시 필요한 패스
 * 트레이서만 자기 예산 해석기에서 스스로 꺼진다 — "전부 차단" 대신 "그 기능만 끈다"의 예다.
 *
 * `standard`/`full` 행은 그 위에 실측 여유가 있는지 확인한다. 값 자체는 무거운 서브시스템의
 * 실제 바이트 계산(studio-capability-budgets)에서 역산했다 — 예: `standard` 의 384MiB
 * maxBufferSize 는 연기 시뮬 128³ 작업 세트(120MiB)를 25% 배정 정책으로는 담지 못하는
 * 구간이라, 등급은 서지만 해상도는 한 단계 내려가는 정직한 중간 지대를 만든다.
 */
export const STUDIO_CAPABILITY_TIER_REQUIREMENTS: Readonly<
  Record<StudioCapabilityRankedTier, readonly StudioCapabilityRequirement[]>
> = Object.freeze({
  full: Object.freeze([
    { signal: "maxBufferSize", minimum: 1 * GIB, kind: "gpu-limit" },
    { signal: "maxStorageBufferBindingSize", minimum: 512 * MIB, kind: "gpu-limit" },
    { signal: "maxUniformBufferBindingSize", minimum: 65_536, kind: "gpu-limit" },
    { signal: "maxComputeWorkgroupStorageSize", minimum: 32_768, kind: "gpu-limit" },
    { signal: "maxComputeInvocationsPerWorkgroup", minimum: 256, kind: "gpu-limit" },
    { signal: "maxTextureDimension2D", minimum: 16_384, kind: "gpu-limit" },
    { signal: "maxTextureDimension3D", minimum: 2_048, kind: "gpu-limit" },
    { signal: "maxStorageBuffersPerShaderStage", minimum: 8, kind: "gpu-limit" },
    { signal: "deviceMemoryGb", minimum: 8, kind: "host-signal" },
    { signal: "hardwareConcurrency", minimum: 8, kind: "host-signal" },
  ] as const),
  standard: Object.freeze([
    { signal: "maxBufferSize", minimum: 384 * MIB, kind: "gpu-limit" },
    { signal: "maxStorageBufferBindingSize", minimum: 192 * MIB, kind: "gpu-limit" },
    { signal: "maxUniformBufferBindingSize", minimum: 65_536, kind: "gpu-limit" },
    { signal: "maxComputeWorkgroupStorageSize", minimum: 16_384, kind: "gpu-limit" },
    { signal: "maxComputeInvocationsPerWorkgroup", minimum: 256, kind: "gpu-limit" },
    { signal: "maxTextureDimension2D", minimum: 8_192, kind: "gpu-limit" },
    { signal: "maxTextureDimension3D", minimum: 2_048, kind: "gpu-limit" },
    { signal: "maxStorageBuffersPerShaderStage", minimum: 8, kind: "gpu-limit" },
    { signal: "deviceMemoryGb", minimum: 4, kind: "host-signal" },
    { signal: "hardwareConcurrency", minimum: 4, kind: "host-signal" },
  ] as const),
  lite: Object.freeze([
    { signal: "maxBufferSize", minimum: 256 * MIB, kind: "gpu-limit" },
    { signal: "maxStorageBufferBindingSize", minimum: 128 * MIB, kind: "gpu-limit" },
    { signal: "maxUniformBufferBindingSize", minimum: 65_536, kind: "gpu-limit" },
    { signal: "maxComputeWorkgroupStorageSize", minimum: 16_384, kind: "gpu-limit" },
    { signal: "maxComputeInvocationsPerWorkgroup", minimum: 256, kind: "gpu-limit" },
    { signal: "maxTextureDimension2D", minimum: 8_192, kind: "gpu-limit" },
    { signal: "maxTextureDimension3D", minimum: 2_048, kind: "gpu-limit" },
    { signal: "maxStorageBuffersPerShaderStage", minimum: 4, kind: "gpu-limit" },
  ] as const),
});

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeLimits(input: StudioCapabilityAdapterLimits | null | undefined) {
  const limits: { -readonly [Name in StudioCapabilityLimitName]?: number } = {};
  for (const name of STUDIO_CAPABILITY_LIMIT_NAMES) {
    const value = finiteNonNegative(input?.[name]);
    if (value !== null) limits[name] = value;
  }
  return Object.freeze(limits) as StudioCapabilityAdapterLimits;
}

function normalizeFeatures(input: Iterable<string> | null | undefined): readonly string[] {
  if (!input) return Object.freeze([]);
  const seen = new Set<string>();
  for (const feature of input) {
    if (typeof feature === "string" && feature.length > 0) seen.add(feature);
  }
  return Object.freeze([...seen]);
}

/** 부분 fixture·probe 결과를 모두 같은 형태로 정규화한다(테스트와 런타임이 같은 경로). */
export function normalizeStudioCapabilitySnapshot(
  input: StudioCapabilitySnapshotInput | null | undefined,
): StudioCapabilitySnapshot {
  return Object.freeze({
    webgpuAvailable: input?.webgpuAvailable === true,
    adapterAvailable: input?.adapterAvailable === true,
    limits: normalizeLimits(input?.limits),
    features: normalizeFeatures(input?.features),
    crossOriginIsolated: input?.crossOriginIsolated === true,
    sharedArrayBufferAvailable: input?.sharedArrayBufferAvailable === true,
    hardwareConcurrency: finiteNonNegative(input?.hardwareConcurrency),
    deviceMemoryGb: finiteNonNegative(input?.deviceMemoryGb),
    probeFailure: input?.probeFailure ?? null,
  });
}

/** GPU 한도는 확인 불가를 `null` 로 유지한다 — 문구에서 "0" 과 "모름"을 구분하기 위해서다. */
export function readStudioCapabilitySignal(
  snapshot: StudioCapabilitySnapshot,
  signal: StudioCapabilitySignalName,
): number | null {
  if (signal === "hardwareConcurrency") return snapshot.hardwareConcurrency;
  if (signal === "deviceMemoryGb") return snapshot.deviceMemoryGb;
  return snapshot.limits[signal] ?? null;
}

interface RequirementFailure {
  readonly requirement: StudioCapabilityRequirement;
  readonly measured: number | null;
  readonly ratio: number;
}

function failedRequirements(
  snapshot: StudioCapabilitySnapshot,
  tier: StudioCapabilityRankedTier,
): readonly RequirementFailure[] {
  const failures: RequirementFailure[] = [];
  for (const requirement of STUDIO_CAPABILITY_TIER_REQUIREMENTS[tier]) {
    const measured = readStudioCapabilitySignal(snapshot, requirement.signal);
    if (measured === null) {
      // 호스트 신호는 노출하지 않는 브라우저가 흔하다 — 모른다고 강등하지 않는다.
      if (requirement.kind === "host-signal") continue;
      failures.push({ requirement, measured: null, ratio: -1 });
      continue;
    }
    if (measured >= requirement.minimum) continue;
    failures.push({ requirement, measured, ratio: measured / requirement.minimum });
  }
  return failures;
}

/** 기준선에서 가장 많이 모자란 신호가 결정 한도다(동률이면 표 순서). */
function worstFailure(failures: readonly RequirementFailure[]): RequirementFailure | null {
  let worst: RequirementFailure | null = null;
  for (const failure of failures) {
    if (worst === null || failure.ratio < worst.ratio) worst = failure;
  }
  return worst;
}

function decisionOf(
  failure: RequirementFailure,
  blockedTier: StudioCapabilityRankedTier,
): StudioCapabilityDecision {
  return Object.freeze({
    signal: failure.requirement.signal,
    kind: failure.requirement.kind,
    measured: failure.measured,
    required: failure.requirement.minimum,
    blockedTier,
  });
}

function classification(
  tier: StudioCapabilityTier,
  code: StudioCapabilityTierCode,
  deciding: StudioCapabilityDecision | null,
  snapshot: StudioCapabilitySnapshot,
): StudioCapabilityClassification {
  const features = new Set(snapshot.features);
  return Object.freeze({
    tier,
    code,
    deciding,
    snapshot,
    supportsTimestampQuery: tier !== "unsupported" && features.has("timestamp-query"),
    supportsFloat32Filterable: tier !== "unsupported" && features.has("float32-filterable"),
    supportsShaderF16: tier !== "unsupported" && features.has("shader-f16"),
  });
}

/**
 * 스냅샷을 등급으로 환산하고, 그 등급을 만든 한도 하나를 이름으로 돌려준다.
 *
 * 반환된 `deciding` 은 UI 가 "왜 낮아졌는지"를 추측 없이 말하기 위한 유일한 근거다.
 * `measured === null` 은 값 자체를 확인하지 못했다는 뜻이고, 그 경우에도 브라우저 이름이
 * 아니라 "이 한도를 확인할 수 없었다"고만 설명한다.
 */
export function classifyStudioCapabilityTier(
  input: StudioCapabilitySnapshotInput | null | undefined,
): StudioCapabilityClassification {
  const snapshot = normalizeStudioCapabilitySnapshot(input);
  if (!snapshot.webgpuAvailable) {
    return classification("unsupported", "webgpu-unavailable", null, snapshot);
  }
  if (!snapshot.adapterAvailable) {
    return classification("unsupported", "adapter-unavailable", null, snapshot);
  }

  for (let index = 0; index < STUDIO_CAPABILITY_TIER_ORDER.length; index += 1) {
    const tier = STUDIO_CAPABILITY_TIER_ORDER[index];
    if (failedRequirements(snapshot, tier).length > 0) continue;
    if (index === 0) return classification(tier, "meets-full", null, snapshot);
    const blockedTier = STUDIO_CAPABILITY_TIER_ORDER[index - 1];
    const failure = worstFailure(failedRequirements(snapshot, blockedTier));
    // 상위 등급이 실패했으므로 failure 는 항상 존재하지만, 계약을 타입으로 좁혀 둔다.
    if (!failure) return classification(tier, "meets-full", null, snapshot);
    return classification(
      tier,
      failure.requirement.kind === "host-signal" ? "host-signal-capped" : "gpu-limit-capped",
      decisionOf(failure, blockedTier),
      snapshot,
    );
  }

  const floorFailure = worstFailure(failedRequirements(snapshot, "lite"));
  return classification(
    "unsupported",
    "below-floor",
    floorFailure ? decisionOf(floorFailure, "lite") : null,
    snapshot,
  );
}

export function isStudioCapabilityTierAtLeast(
  tier: StudioCapabilityTier,
  minimum: StudioCapabilityRankedTier,
): boolean {
  if (tier === "unsupported") return false;
  return (
    STUDIO_CAPABILITY_TIER_ORDER.indexOf(tier) <= STUDIO_CAPABILITY_TIER_ORDER.indexOf(minimum)
  );
}
