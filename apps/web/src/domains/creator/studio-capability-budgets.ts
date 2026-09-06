/**
 * Studio 기능별 GPU 예산 해석기 — 등급과 실측 한도에서 "구체적으로 낮춘 설정"을 만든다.
 *
 * 이 모듈도 브라우저 이름을 보지 않는다(studio-capability-tier 의 규율 참조). 모든 판단은
 * 등급 + 어댑터가 보고한 숫자 + 아래에 적힌 바이트 계산으로만 이뤄지고, 결과는 boolean 이
 * 아니라 실제로 실행할 설정값이다. 모든 계산은 정수 산술이라 같은 스냅샷은 항상 같은 값을 낸다.
 *
 * 배정 정책(share)
 * ---------------
 * WebGPU 는 "이 기기의 VRAM 총량"을 노출하지 않는다. 노출되는 것은 어댑터가 허용하는 한도뿐이다.
 * 그래서 각 서브시스템은 한도의 고정 비율만 자기 몫으로 쓴다 — 스튜디오는 래스터 타일·문서
 * 이미지·다른 3D 서브시스템을 동시에 들고 있기 때문이다. 이 비율은 측정값이 아니라 제품 결정이며,
 * 아래 상수로 명시해 둔다(문구에서도 "배정"이라고 정직하게 말한다).
 */

import {
  isStudioCapabilityTierAtLeast,
  type StudioCapabilityClassification,
  type StudioCapabilityRankedTier,
  type StudioCapabilitySignalName,
  type StudioCapabilitySnapshot,
  type StudioCapabilityTier,
} from "./studio-capability-tier";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export type StudioCapabilityFeatureId =
  | "smoke-grid"
  | "path-trace-accumulation"
  | "path-trace-bounces"
  | "path-trace-bvh"
  | "sculpt-vertices"
  | "pbr-shadow-map"
  | "pbr-ibl";

export type StudioCapabilityDowngradeCode =
  | "within-budget"
  | "tier-ceiling"
  | "storage-binding-budget"
  | "buffer-budget"
  | "texture-dimension"
  | "workgroup-storage"
  | "compute-invocations"
  | "storage-buffer-count"
  | "shared-memory-unavailable"
  | "missing-gpu-feature"
  | "floor-exceeded"
  | "device-unsupported";

export type StudioCapabilityAmountUnit = "bytes" | "count" | "pixels";

export interface StudioCapabilityDowngradeReason {
  readonly code: StudioCapabilityDowngradeCode;
  readonly tier: StudioCapabilityTier;
  /** 결정을 내린 어댑터 한도/호스트 신호. 한도와 무관한 사유면 `null`. */
  readonly limit: StudioCapabilitySignalName | null;
  /** 그 한도의 실측값. `null` 은 확인 불가. */
  readonly limitValue: number | null;
  /** 이 기능에 배정된 양(share 적용 후). */
  readonly budget: number | null;
  /** 한 단계 위 설정이 요구한 양. */
  readonly required: number | null;
  readonly unit: StudioCapabilityAmountUnit | null;
  /** `missing-gpu-feature` 일 때 없는 WebGPU 기능 이름. */
  readonly gpuFeature: string | null;
}

export interface StudioCapabilityBudget<Value> {
  readonly feature: StudioCapabilityFeatureId;
  readonly enabled: boolean;
  readonly value: Value;
  /** 제약이 없었다면 썼을 최상위 설정. 강등이 없으면 `null`. */
  readonly downgradedFrom: Value | null;
  readonly reason: StudioCapabilityDowngradeReason;
}

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

interface RungRejection {
  readonly code: StudioCapabilityDowngradeCode;
  readonly limit: StudioCapabilitySignalName | null;
  readonly limitValue: number | null;
  readonly budget: number | null;
  readonly required: number | null;
  readonly unit: StudioCapabilityAmountUnit | null;
  readonly gpuFeature: string | null;
}

function rejection(partial: Partial<RungRejection> & { code: StudioCapabilityDowngradeCode }) {
  return Object.freeze({
    limit: null,
    limitValue: null,
    budget: null,
    required: null,
    unit: null,
    gpuFeature: null,
    ...partial,
  }) as RungRejection;
}

function reasonOf(
  tier: StudioCapabilityTier,
  source: RungRejection | null,
  fallbackCode: StudioCapabilityDowngradeCode = "within-budget",
): StudioCapabilityDowngradeReason {
  return Object.freeze({
    code: source?.code ?? fallbackCode,
    tier,
    limit: source?.limit ?? null,
    limitValue: source?.limitValue ?? null,
    budget: source?.budget ?? null,
    required: source?.required ?? null,
    unit: source?.unit ?? null,
    gpuFeature: source?.gpuFeature ?? null,
  });
}

function limitOf(snapshot: StudioCapabilitySnapshot, name: StudioCapabilitySignalName): number {
  if (name === "hardwareConcurrency") return snapshot.hardwareConcurrency ?? 0;
  if (name === "deviceMemoryGb") return snapshot.deviceMemoryGb ?? 0;
  return snapshot.limits[name] ?? 0;
}

function reportedLimitOf(
  snapshot: StudioCapabilitySnapshot,
  name: StudioCapabilitySignalName,
): number | null {
  if (name === "hardwareConcurrency") return snapshot.hardwareConcurrency;
  if (name === "deviceMemoryGb") return snapshot.deviceMemoryGb;
  return snapshot.limits[name] ?? null;
}

/** 저장 버퍼 작업 세트는 두 한도 모두를 만족해야 한다 — 더 빡빡한 쪽이 실제 천장이다. */
function tighterStorageLimit(snapshot: StudioCapabilitySnapshot): {
  readonly name: StudioCapabilitySignalName;
  readonly value: number;
} {
  const binding = limitOf(snapshot, "maxStorageBufferBindingSize");
  const buffer = limitOf(snapshot, "maxBufferSize");
  return binding <= buffer
    ? { name: "maxStorageBufferBindingSize", value: binding }
    : { name: "maxBufferSize", value: buffer };
}

interface LadderWalk {
  /** 채택된 사다리 인덱스. 어떤 단도 통과하지 못하면 `null`. */
  readonly acceptedIndex: number | null;
  readonly rejection: RungRejection | null;
}

/**
 * 천장(등급/기능 제약)에서 시작해 바이트 계산을 통과하는 첫 단까지 내려간다.
 * 채택 시점의 사유는 "바로 위 단을 막은 제약"이며, 아무것도 못 막았으면 천장 사유가 된다.
 */
function walkLadder(
  length: number,
  ceilingIndex: number,
  ceilingRejection: RungRejection | null,
  reject: (index: number) => RungRejection | null,
): LadderWalk {
  let lastRejection: RungRejection | null = null;
  for (let index = Math.max(0, ceilingIndex); index < length; index += 1) {
    const failure = reject(index);
    if (!failure) {
      return { acceptedIndex: index, rejection: lastRejection ?? ceilingRejection };
    }
    lastRejection = failure;
  }
  return { acceptedIndex: null, rejection: lastRejection ?? ceilingRejection };
}

function tierIndexCeiling(
  starts: Readonly<Record<StudioCapabilityRankedTier, number>>,
  tier: StudioCapabilityTier,
): number {
  return tier === "unsupported" ? Number.POSITIVE_INFINITY : starts[tier];
}

function tierCeilingRejection(startIndex: number): RungRejection | null {
  return startIndex > 0 ? rejection({ code: "tier-ceiling" }) : null;
}

/**
 * 기능을 끈 사유. 사다리의 마지막 단까지 못 들어간 경우에는 그 단을 막은 한도 정보를 그대로
 * 유지하되 코드는 `floor-exceeded` 로 바꾼다 — "한 단 내렸다"가 아니라 "아예 못 켰다"이기 때문.
 * 반대로 전제 조건(바인딩 개수·워크그룹 크기 등)이 막은 경우에는 그 코드를 보존한다.
 */
const PRECONDITION_CODES: ReadonlySet<StudioCapabilityDowngradeCode> = new Set([
  "storage-buffer-count",
  "compute-invocations",
  "workgroup-storage",
]);

function disabledReason(
  tier: StudioCapabilityTier,
  source: RungRejection | null,
): StudioCapabilityDowngradeReason {
  if (tier === "unsupported") return reasonOf(tier, null, "device-unsupported");
  if (!source) return reasonOf(tier, null, "floor-exceeded");
  if (PRECONDITION_CODES.has(source.code)) return reasonOf(tier, source);
  return reasonOf(tier, { ...source, code: "floor-exceeded" });
}

// ---------------------------------------------------------------------------
// 1. 연기 시뮬레이션 격자
// ---------------------------------------------------------------------------

/**
 * 복셀당 필드 구성(모두 f32):
 * | 버퍼            | 채널                       | f32 |
 * | velocity ping   | vec3<f32>(WGSL 정렬로 16B) | 4   |
 * | velocity pong   | vec3<f32>(WGSL 정렬로 16B) | 4   |
 * | density ping/pong   | 1 + 1                  | 2   |
 * | temperature ping/pong | 1 + 1                | 2   |
 * | pressure ping/pong  | 1 + 1                  | 2   |
 * | divergence      | 1                          | 1   |
 * 합계 15 f32 = 60B/복셀. 가장 큰 단일 바인딩은 velocity 한 장(16B/복셀)이다.
 * (스칼라 필드들은 ping/pong 버퍼에 인터리브해 묶으므로 저장 버퍼 바인딩 개수는 4개면 된다.)
 */
export const STUDIO_SMOKE_BYTES_PER_VOXEL = 60;
export const STUDIO_SMOKE_VELOCITY_BYTES_PER_VOXEL = 16;
export const STUDIO_SMOKE_GRID_LADDER = [128, 96, 64, 48] as const;
/** 작업 세트 전체가 쓸 수 있는 maxBufferSize 지분. */
export const STUDIO_SMOKE_GPU_SHARE = 0.25;
/**
 * 단일 필드가 쓸 수 있는 maxStorageBufferBindingSize 지분. 한 디스패치에 필드 버퍼가 여덟 장
 * 넘게 동시에 바인딩되므로, 한 장이 바인딩 한도의 1/8 을 넘지 않게 잡는다.
 */
export const STUDIO_SMOKE_BINDING_SHARE = 0.125;
/** 압력 Jacobi 타일이 워크그룹 공유 메모리에 올리는 최소 크기(명세 보장 기본값과 동일). */
export const STUDIO_SMOKE_REQUIRED_WORKGROUP_STORAGE = 16_384;
export const STUDIO_SMOKE_TIER_START_INDEX: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 0, standard: 0, lite: 2 });

export type StudioSmokeGridSize = (typeof STUDIO_SMOKE_GRID_LADDER)[number] | 0;

export function studioSmokeWorkingSetBytes(grid: number): number {
  return grid * grid * grid * STUDIO_SMOKE_BYTES_PER_VOXEL;
}

export function studioSmokeVelocityBindingBytes(grid: number): number {
  return grid * grid * grid * STUDIO_SMOKE_VELOCITY_BYTES_PER_VOXEL;
}

/**
 * 연기 격자 해상도. 사다리는 128³ → 96³ → 64³ → 48³.
 *
 * 실제 바이트:
 * - 128³ = 2,097,152 복셀 → velocity 32MiB / 작업 세트 120MiB
 * - 96³  =   884,736 복셀 → velocity 13.5MiB / 작업 세트 50.625MiB
 * - 64³  =   262,144 복셀 → velocity 4MiB / 작업 세트 15MiB
 * - 48³  =   110,592 복셀 → velocity 1.6875MiB / 작업 세트 6.328MiB
 *
 * 배정과 비교하면(바인딩 12.5% / 버퍼 25%):
 * - 512MiB 바인딩 · 1GiB 버퍼 → 64MiB / 256MiB → 128³ 통과
 * - 192MiB 바인딩 · 384MiB 버퍼 → 24MiB / 96MiB → 128³ 은 velocity(32MiB)에서 탈락 → 96³
 * - 512MiB 바인딩 · 384MiB 버퍼 → 64MiB / 96MiB → 128³ 은 작업 세트(120MiB)에서 탈락 → 96³
 */
export function resolveStudioSmokeGridBudget(
  classification: StudioCapabilityClassification,
): StudioCapabilityBudget<StudioSmokeGridSize> {
  const { tier, snapshot } = classification;
  const top = STUDIO_SMOKE_GRID_LADDER[0];
  if (tier === "unsupported") {
    return Object.freeze({
      feature: "smoke-grid" as const,
      enabled: false,
      value: 0 as StudioSmokeGridSize,
      downgradedFrom: top,
      reason: disabledReason(tier, null),
    });
  }

  const workgroupStorage = limitOf(snapshot, "maxComputeWorkgroupStorageSize");
  if (workgroupStorage < STUDIO_SMOKE_REQUIRED_WORKGROUP_STORAGE) {
    return Object.freeze({
      feature: "smoke-grid" as const,
      enabled: false,
      value: 0 as StudioSmokeGridSize,
      downgradedFrom: top,
      reason: reasonOf(
        tier,
        rejection({
          code: "workgroup-storage",
          limit: "maxComputeWorkgroupStorageSize",
          limitValue: reportedLimitOf(snapshot, "maxComputeWorkgroupStorageSize"),
          budget: workgroupStorage,
          required: STUDIO_SMOKE_REQUIRED_WORKGROUP_STORAGE,
          unit: "bytes",
        }),
      ),
    });
  }

  const maxTexture3d = limitOf(snapshot, "maxTextureDimension3D");
  const bindingBudget = Math.floor(
    limitOf(snapshot, "maxStorageBufferBindingSize") * STUDIO_SMOKE_BINDING_SHARE,
  );
  const bufferBudget = Math.floor(limitOf(snapshot, "maxBufferSize") * STUDIO_SMOKE_GPU_SHARE);
  const startIndex = tierIndexCeiling(STUDIO_SMOKE_TIER_START_INDEX, tier);

  const walk = walkLadder(
    STUDIO_SMOKE_GRID_LADDER.length,
    startIndex,
    tierCeilingRejection(startIndex),
    (index) => {
      const grid = STUDIO_SMOKE_GRID_LADDER[index];
      if (grid > maxTexture3d) {
        return rejection({
          code: "texture-dimension",
          limit: "maxTextureDimension3D",
          limitValue: reportedLimitOf(snapshot, "maxTextureDimension3D"),
          budget: maxTexture3d,
          required: grid,
          unit: "pixels",
        });
      }
      const velocityBytes = studioSmokeVelocityBindingBytes(grid);
      if (velocityBytes > bindingBudget) {
        return rejection({
          code: "storage-binding-budget",
          limit: "maxStorageBufferBindingSize",
          limitValue: reportedLimitOf(snapshot, "maxStorageBufferBindingSize"),
          budget: bindingBudget,
          required: velocityBytes,
          unit: "bytes",
        });
      }
      const workingSetBytes = studioSmokeWorkingSetBytes(grid);
      if (workingSetBytes > bufferBudget) {
        return rejection({
          code: "buffer-budget",
          limit: "maxBufferSize",
          limitValue: reportedLimitOf(snapshot, "maxBufferSize"),
          budget: bufferBudget,
          required: workingSetBytes,
          unit: "bytes",
        });
      }
      return null;
    },
  );

  if (walk.acceptedIndex === null) {
    return Object.freeze({
      feature: "smoke-grid" as const,
      enabled: false,
      value: 0 as StudioSmokeGridSize,
      downgradedFrom: top,
      reason: disabledReason(tier, walk.rejection),
    });
  }
  const grid = STUDIO_SMOKE_GRID_LADDER[walk.acceptedIndex];
  return Object.freeze({
    feature: "smoke-grid" as const,
    enabled: true,
    value: grid,
    downgradedFrom: grid === top ? null : top,
    reason: reasonOf(tier, grid === top ? null : walk.rejection),
  });
}

// ---------------------------------------------------------------------------
// 2. 패스 트레이싱
// ---------------------------------------------------------------------------

export const STUDIO_PATH_TRACE_SCALE_LADDER = [1, 0.75, 0.5, 0.25] as const;
export const STUDIO_PATH_TRACE_ACCUM_SHARE = 0.25;
export const STUDIO_PATH_TRACE_BVH_SHARE = 0.5;
/** rgba32float 누적. shader-f16 이 있으면 rgba16float 로 픽셀당 절반만 쓴다. */
export const STUDIO_PATH_TRACE_ACCUM_BYTES_F32 = 16;
export const STUDIO_PATH_TRACE_ACCUM_BYTES_F16 = 8;
/** BVH 노드 = aabb min/max(24B) + 자식/프리미티브 인덱스 2개(8B). */
export const STUDIO_PATH_TRACE_BVH_NODE_BYTES = 32;
/** bvhNodes·triIndices·vertices·normals·materials·accumulation 6개 저장 바인딩이 동시에 필요하다. */
export const STUDIO_PATH_TRACE_REQUIRED_STORAGE_BUFFERS = 6;
export const STUDIO_PATH_TRACE_MIN_DIMENSION = 32;
export const STUDIO_PATH_TRACE_MAX_DIMENSION = 16_384;
export const STUDIO_PATH_TRACE_DEFAULT_WIDTH = 1_920;
export const STUDIO_PATH_TRACE_DEFAULT_HEIGHT = 1_080;
export const STUDIO_PATH_TRACE_TIER_START_INDEX: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 0, standard: 1, lite: 2 });
export const STUDIO_PATH_TRACE_BOUNCE_LADDER: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 8, standard: 5, lite: 3 });
export const STUDIO_PATH_TRACE_BVH_NODE_LADDER: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 4_194_304, standard: 1_048_576, lite: 262_144 });

export interface StudioPathTraceAccumulationPlan {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly bytesPerPixel: number;
  readonly bytes: number;
}

export interface StudioPathTraceBvhPlan {
  readonly nodes: number;
  readonly bytes: number;
}

export interface StudioPathTracePlan {
  readonly accumulation: StudioCapabilityBudget<StudioPathTraceAccumulationPlan>;
  readonly bounces: StudioCapabilityBudget<number>;
  readonly bvh: StudioCapabilityBudget<StudioPathTraceBvhPlan>;
}

export interface StudioPathTraceRequest {
  readonly width?: number;
  readonly height?: number;
}

function clampDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(STUDIO_PATH_TRACE_MAX_DIMENSION, Math.max(1, Math.floor(value)));
}

function accumulationPlan(
  width: number,
  height: number,
  scaleIndex: number,
  bytesPerPixel: number,
): StudioPathTraceAccumulationPlan {
  const scale = STUDIO_PATH_TRACE_SCALE_LADDER[scaleIndex];
  const scaledWidth = Math.max(STUDIO_PATH_TRACE_MIN_DIMENSION, Math.floor(width * scale));
  const scaledHeight = Math.max(STUDIO_PATH_TRACE_MIN_DIMENSION, Math.floor(height * scale));
  return Object.freeze({
    width: scaledWidth,
    height: scaledHeight,
    scale,
    bytesPerPixel,
    bytes: scaledWidth * scaledHeight * bytesPerPixel,
  });
}

function storageBudgetCode(name: StudioCapabilitySignalName): StudioCapabilityDowngradeCode {
  return name === "maxStorageBufferBindingSize" ? "storage-binding-budget" : "buffer-budget";
}

function resolveBvhRejection(input: {
  readonly snapshot: StudioCapabilitySnapshot;
  readonly tighterName: StudioCapabilitySignalName;
  readonly tierNodes: number;
  readonly bvhBudgetBytes: number;
  readonly bvhBudgetNodes: number;
}): RungRejection | null {
  if (input.bvhBudgetNodes < input.tierNodes) {
    return rejection({
      code: storageBudgetCode(input.tighterName),
      limit: input.tighterName,
      limitValue: reportedLimitOf(input.snapshot, input.tighterName),
      budget: input.bvhBudgetBytes,
      required: input.tierNodes * STUDIO_PATH_TRACE_BVH_NODE_BYTES,
      unit: "bytes",
    });
  }
  if (input.tierNodes < STUDIO_PATH_TRACE_BVH_NODE_LADDER.full) {
    return rejection({ code: "tier-ceiling" });
  }
  return null;
}

/**
 * 패스 트레이서 예산. 누적 버퍼 해상도·최대 반사 횟수·BVH 노드 수를 각각 독립적으로 돌려준다
 * (하나의 boolean 으로 뭉치면 어떤 한도가 무엇을 낮췄는지 설명할 수 없다).
 */
export function resolveStudioPathTraceBudget(
  classification: StudioCapabilityClassification,
  request: StudioPathTraceRequest = {},
): StudioPathTracePlan {
  const { tier, snapshot } = classification;
  const width = clampDimension(request.width, STUDIO_PATH_TRACE_DEFAULT_WIDTH);
  const height = clampDimension(request.height, STUDIO_PATH_TRACE_DEFAULT_HEIGHT);
  const bytesPerPixel = classification.supportsShaderF16
    ? STUDIO_PATH_TRACE_ACCUM_BYTES_F16
    : STUDIO_PATH_TRACE_ACCUM_BYTES_F32;
  const topAccumulation = accumulationPlan(width, height, 0, bytesPerPixel);
  const topBounces = STUDIO_PATH_TRACE_BOUNCE_LADDER.full;
  const topBvh = Object.freeze({
    nodes: STUDIO_PATH_TRACE_BVH_NODE_LADDER.full,
    bytes: STUDIO_PATH_TRACE_BVH_NODE_LADDER.full * STUDIO_PATH_TRACE_BVH_NODE_BYTES,
  });

  const disable = (source: RungRejection | null): StudioPathTracePlan =>
    Object.freeze({
      accumulation: Object.freeze({
        feature: "path-trace-accumulation" as const,
        enabled: false,
        value: Object.freeze({
          width: 0,
          height: 0,
          scale: 0,
          bytesPerPixel,
          bytes: 0,
        }),
        downgradedFrom: topAccumulation,
        reason: disabledReason(tier, source),
      }),
      bounces: Object.freeze({
        feature: "path-trace-bounces" as const,
        enabled: false,
        value: 0,
        downgradedFrom: topBounces,
        reason: disabledReason(tier, source),
      }),
      bvh: Object.freeze({
        feature: "path-trace-bvh" as const,
        enabled: false,
        value: Object.freeze({ nodes: 0, bytes: 0 }),
        downgradedFrom: topBvh,
        reason: disabledReason(tier, source),
      }),
    });

  if (tier === "unsupported") return disable(null);

  const storageBuffers = limitOf(snapshot, "maxStorageBuffersPerShaderStage");
  if (storageBuffers < STUDIO_PATH_TRACE_REQUIRED_STORAGE_BUFFERS) {
    return disable(
      rejection({
        code: "storage-buffer-count",
        limit: "maxStorageBuffersPerShaderStage",
        limitValue: reportedLimitOf(snapshot, "maxStorageBuffersPerShaderStage"),
        budget: storageBuffers,
        required: STUDIO_PATH_TRACE_REQUIRED_STORAGE_BUFFERS,
        unit: "count",
      }),
    );
  }

  const tighter = tighterStorageLimit(snapshot);
  const accumulationBudget = Math.floor(tighter.value * STUDIO_PATH_TRACE_ACCUM_SHARE);
  const startIndex = tierIndexCeiling(STUDIO_PATH_TRACE_TIER_START_INDEX, tier);
  const walk = walkLadder(
    STUDIO_PATH_TRACE_SCALE_LADDER.length,
    startIndex,
    tierCeilingRejection(startIndex),
    (index) => {
      const plan = accumulationPlan(width, height, index, bytesPerPixel);
      if (plan.bytes <= accumulationBudget) return null;
      return rejection({
        code: storageBudgetCode(tighter.name),
        limit: tighter.name,
        limitValue: reportedLimitOf(snapshot, tighter.name),
        budget: accumulationBudget,
        required: plan.bytes,
        unit: "bytes",
      });
    },
  );

  if (walk.acceptedIndex === null) return disable(walk.rejection);

  const accepted = accumulationPlan(width, height, walk.acceptedIndex, bytesPerPixel);
  const bounces = STUDIO_PATH_TRACE_BOUNCE_LADDER[tier];
  const tierNodes = STUDIO_PATH_TRACE_BVH_NODE_LADDER[tier];
  const bvhBudgetBytes = Math.floor(tighter.value * STUDIO_PATH_TRACE_BVH_SHARE);
  const bvhBudgetNodes = Math.floor(bvhBudgetBytes / STUDIO_PATH_TRACE_BVH_NODE_BYTES);
  const nodes = Math.min(tierNodes, bvhBudgetNodes);
  const bvhRejection = resolveBvhRejection({
    snapshot,
    tighterName: tighter.name,
    tierNodes,
    bvhBudgetBytes,
    bvhBudgetNodes,
  });

  if (nodes <= 0) return disable(bvhRejection);

  return Object.freeze({
    accumulation: Object.freeze({
      feature: "path-trace-accumulation" as const,
      enabled: true,
      value: accepted,
      downgradedFrom: walk.acceptedIndex === 0 ? null : topAccumulation,
      reason: reasonOf(tier, walk.acceptedIndex === 0 ? null : walk.rejection),
    }),
    bounces: Object.freeze({
      feature: "path-trace-bounces" as const,
      enabled: true,
      value: bounces,
      downgradedFrom: bounces === topBounces ? null : topBounces,
      reason: reasonOf(tier, bounces === topBounces ? null : rejection({ code: "tier-ceiling" })),
    }),
    bvh: Object.freeze({
      feature: "path-trace-bvh" as const,
      enabled: true,
      value: Object.freeze({ nodes, bytes: nodes * STUDIO_PATH_TRACE_BVH_NODE_BYTES }),
      downgradedFrom: nodes === topBvh.nodes ? null : topBvh,
      reason: reasonOf(tier, nodes === topBvh.nodes ? null : bvhRejection),
    }),
  });
}

// ---------------------------------------------------------------------------
// 3. 스컬프트 정점 예산
// ---------------------------------------------------------------------------

export const STUDIO_SCULPT_VERTEX_LADDER = [
  8_388_608, 4_194_304, 2_097_152, 1_048_576, 524_288,
] as const;
/** 위치 vec3(12B) + 법선 vec3(12B) + 색 rgba8(4B) + 마스크 f32(4B). */
export const STUDIO_SCULPT_VERTEX_BYTES = 32;
/** 주 버퍼 + 브러시 커널의 위치 pong(vec3 정렬 16B). */
export const STUDIO_SCULPT_WORKING_BYTES_PER_VERTEX = 48;
export const STUDIO_SCULPT_SHARE = 0.5;
export const STUDIO_SCULPT_MIN_WORKGROUP_SIZE = 32;
export const STUDIO_SCULPT_PREFERRED_WORKGROUP_SIZE = 256;
/**
 * SharedArrayBuffer 가 없으면 undo 스냅샷을 워커로 구조화 복제해야 한다. 복제 비용이 편집
 * 지연으로 바로 드러나는 지점이 200만 정점 부근이라, 교차 출처 격리가 아닌 문서는 여기서 멈춘다.
 */
export const STUDIO_SCULPT_NO_SHARED_MEMORY_MAX_VERTICES = 2_097_152;
export const STUDIO_SCULPT_TIER_START_INDEX: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 0, standard: 2, lite: 4 });

export interface StudioSculptPlan {
  readonly maxVertices: number;
  readonly brushWorkgroupSize: number;
  readonly vertexBufferBytes: number;
  readonly workingSetBytes: number;
}

function sculptPlan(vertices: number, workgroupSize: number): StudioSculptPlan {
  return Object.freeze({
    maxVertices: vertices,
    brushWorkgroupSize: workgroupSize,
    vertexBufferBytes: vertices * STUDIO_SCULPT_VERTEX_BYTES,
    workingSetBytes: vertices * STUDIO_SCULPT_WORKING_BYTES_PER_VERTEX,
  });
}

/**
 * 스컬프트 최대 정점 수. 사다리는 8,388,608 → 4,194,304 → 2,097,152 → 1,048,576 → 524,288.
 * 정점 버퍼 32B/정점이므로 최상단은 256MiB 단일 바인딩이고, 50% 배정 기준으로 512MiB
 * 저장 버퍼 바인딩 한도를 정확히 채운다.
 */
export function resolveStudioSculptBudget(
  classification: StudioCapabilityClassification,
): StudioCapabilityBudget<StudioSculptPlan> {
  const { tier, snapshot } = classification;
  const topVertices = STUDIO_SCULPT_VERTEX_LADDER[0];
  const topPlan = sculptPlan(topVertices, STUDIO_SCULPT_PREFERRED_WORKGROUP_SIZE);
  const disabled = (source: RungRejection | null) =>
    Object.freeze({
      feature: "sculpt-vertices" as const,
      enabled: false,
      value: sculptPlan(0, 0),
      downgradedFrom: topPlan,
      reason: disabledReason(tier, source),
    });

  if (tier === "unsupported") return disabled(null);

  const invocations = limitOf(snapshot, "maxComputeInvocationsPerWorkgroup");
  const workgroupSize = Math.min(STUDIO_SCULPT_PREFERRED_WORKGROUP_SIZE, invocations);
  if (workgroupSize < STUDIO_SCULPT_MIN_WORKGROUP_SIZE) {
    return disabled(
      rejection({
        code: "compute-invocations",
        limit: "maxComputeInvocationsPerWorkgroup",
        limitValue: reportedLimitOf(snapshot, "maxComputeInvocationsPerWorkgroup"),
        budget: invocations,
        required: STUDIO_SCULPT_MIN_WORKGROUP_SIZE,
        unit: "count",
      }),
    );
  }

  const tierIndex = tierIndexCeiling(STUDIO_SCULPT_TIER_START_INDEX, tier);
  let ceilingIndex = tierIndex;
  let ceilingRejection = tierCeilingRejection(tierIndex);
  if (!snapshot.sharedArrayBufferAvailable) {
    const sharedMemoryIndex = STUDIO_SCULPT_VERTEX_LADDER.findIndex(
      (vertices) => vertices <= STUDIO_SCULPT_NO_SHARED_MEMORY_MAX_VERTICES,
    );
    if (sharedMemoryIndex > ceilingIndex) {
      ceilingIndex = sharedMemoryIndex;
      ceilingRejection = rejection({
        code: "shared-memory-unavailable",
        budget: STUDIO_SCULPT_NO_SHARED_MEMORY_MAX_VERTICES,
        required: STUDIO_SCULPT_VERTEX_LADDER[tierIndex],
        unit: "count",
      });
    }
  }

  const bindingBudget = Math.floor(
    limitOf(snapshot, "maxStorageBufferBindingSize") * STUDIO_SCULPT_SHARE,
  );
  const bufferBudget = Math.floor(limitOf(snapshot, "maxBufferSize") * STUDIO_SCULPT_SHARE);
  const walk = walkLadder(
    STUDIO_SCULPT_VERTEX_LADDER.length,
    ceilingIndex,
    ceilingRejection,
    (index) => {
      const vertices = STUDIO_SCULPT_VERTEX_LADDER[index];
      const vertexBufferBytes = vertices * STUDIO_SCULPT_VERTEX_BYTES;
      if (vertexBufferBytes > bindingBudget) {
        return rejection({
          code: "storage-binding-budget",
          limit: "maxStorageBufferBindingSize",
          limitValue: reportedLimitOf(snapshot, "maxStorageBufferBindingSize"),
          budget: bindingBudget,
          required: vertexBufferBytes,
          unit: "bytes",
        });
      }
      const workingSetBytes = vertices * STUDIO_SCULPT_WORKING_BYTES_PER_VERTEX;
      if (workingSetBytes > bufferBudget) {
        return rejection({
          code: "buffer-budget",
          limit: "maxBufferSize",
          limitValue: reportedLimitOf(snapshot, "maxBufferSize"),
          budget: bufferBudget,
          required: workingSetBytes,
          unit: "bytes",
        });
      }
      return null;
    },
  );

  if (walk.acceptedIndex === null) return disabled(walk.rejection);
  const vertices = STUDIO_SCULPT_VERTEX_LADDER[walk.acceptedIndex];
  // 워크그룹 크기는 정점 상한과 무관한 내부 디스패치 형태라 강등으로 세지 않는다.
  return Object.freeze({
    feature: "sculpt-vertices" as const,
    enabled: true,
    value: sculptPlan(vertices, workgroupSize),
    downgradedFrom: vertices === topVertices ? null : topPlan,
    reason: reasonOf(tier, vertices === topVertices ? null : walk.rejection),
  });
}

// ---------------------------------------------------------------------------
// 4. PBR 그림자 맵 / IBL 프리필터
// ---------------------------------------------------------------------------

export const STUDIO_PBR_SHADOW_MAP_LADDER = [4_096, 2_048, 1_024, 512] as const;
export const STUDIO_PBR_SHADOW_CASCADES = 4;
/** depth32float. */
export const STUDIO_PBR_SHADOW_BYTES_PER_TEXEL = 4;
export const STUDIO_PBR_SHADOW_SHARE = 0.25;
export const STUDIO_PBR_SHADOW_TIER_START_INDEX: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 0, standard: 1, lite: 2 });

export const STUDIO_PBR_IBL_BASE_LADDER = [512, 256, 128, 64] as const;
export const STUDIO_PBR_IBL_FACES = 6;
/** rgba16float. */
export const STUDIO_PBR_IBL_BYTES_PER_TEXEL = 8;
export const STUDIO_PBR_IBL_SHARE = 0.0625;
export const STUDIO_PBR_IBL_TIER_START_INDEX: Readonly<
  Record<StudioCapabilityRankedTier, number>
> = Object.freeze({ full: 0, standard: 1, lite: 2 });
/**
 * float32-filterable 이 없으면 rgba32float HDR 원본을 하드웨어 선형 필터링으로 읽을 수 없어
 * 프리필터가 밉 단계마다 수동 보간 패스를 돌아야 한다. 그 비용을 감당할 수 있는 상한이 256px 이다.
 */
export const STUDIO_PBR_IBL_NO_FLOAT_FILTER_MAX_BASE = 256;

export interface StudioPbrShadowPlan {
  readonly size: number;
  readonly cascades: number;
  readonly bytes: number;
}

export interface StudioPbrIblPlan {
  readonly baseSize: number;
  readonly prefilterMipCount: number;
  readonly bytes: number;
}

export interface StudioPbrPlan {
  readonly shadow: StudioCapabilityBudget<StudioPbrShadowPlan>;
  readonly ibl: StudioCapabilityBudget<StudioPbrIblPlan>;
}

export function studioPbrShadowBytes(size: number): number {
  return size * size * STUDIO_PBR_SHADOW_BYTES_PER_TEXEL * STUDIO_PBR_SHADOW_CASCADES;
}

/** 큐브맵 6면 밉 체인 전체 바이트(근사 없이 단계별로 더한다). */
export function studioPbrIblBytes(baseSize: number): number {
  let total = 0;
  for (let size = baseSize; size >= 1; size = Math.floor(size / 2)) {
    total += STUDIO_PBR_IBL_FACES * size * size * STUDIO_PBR_IBL_BYTES_PER_TEXEL;
  }
  return total;
}

/** 러프니스 프리필터 단계 수 — 1x1 과 그 바로 위 단계는 의미가 없어 제외한다. */
export function studioPbrIblPrefilterMipCount(baseSize: number): number {
  return Math.max(1, Math.log2(baseSize) - 1);
}

function pbrShadowPlan(size: number): StudioPbrShadowPlan {
  return Object.freeze({
    size,
    cascades: STUDIO_PBR_SHADOW_CASCADES,
    bytes: studioPbrShadowBytes(size),
  });
}

function pbrIblPlan(baseSize: number): StudioPbrIblPlan {
  return Object.freeze({
    baseSize,
    prefilterMipCount: studioPbrIblPrefilterMipCount(baseSize),
    bytes: studioPbrIblBytes(baseSize),
  });
}

/**
 * 그림자 맵 한 변. 4단 CSM · depth32float 기준 바이트:
 * 4096 = 256MiB, 2048 = 64MiB, 1024 = 16MiB, 512 = 4MiB.
 * WebGPU 는 텍스처 메모리 한도를 따로 노출하지 않으므로 maxBufferSize 를 기기 등급 대리
 * 지표로 쓰고(25% 배정), 이 사실을 문구에서도 "배정"으로 표현한다.
 */
export function resolveStudioPbrShadowBudget(
  classification: StudioCapabilityClassification,
): StudioCapabilityBudget<StudioPbrShadowPlan> {
  const { tier, snapshot } = classification;
  const topPlan = pbrShadowPlan(STUDIO_PBR_SHADOW_MAP_LADDER[0]);
  if (tier === "unsupported") {
    return Object.freeze({
      feature: "pbr-shadow-map" as const,
      enabled: false,
      value: pbrShadowPlan(0),
      downgradedFrom: topPlan,
      reason: disabledReason(tier, null),
    });
  }

  const maxTexture2d = limitOf(snapshot, "maxTextureDimension2D");
  const budget = Math.floor(limitOf(snapshot, "maxBufferSize") * STUDIO_PBR_SHADOW_SHARE);
  const startIndex = tierIndexCeiling(STUDIO_PBR_SHADOW_TIER_START_INDEX, tier);
  const walk = walkLadder(
    STUDIO_PBR_SHADOW_MAP_LADDER.length,
    startIndex,
    tierCeilingRejection(startIndex),
    (index) => {
      const size = STUDIO_PBR_SHADOW_MAP_LADDER[index];
      if (size > maxTexture2d) {
        return rejection({
          code: "texture-dimension",
          limit: "maxTextureDimension2D",
          limitValue: reportedLimitOf(snapshot, "maxTextureDimension2D"),
          budget: maxTexture2d,
          required: size,
          unit: "pixels",
        });
      }
      const bytes = studioPbrShadowBytes(size);
      if (bytes > budget) {
        return rejection({
          code: "buffer-budget",
          limit: "maxBufferSize",
          limitValue: reportedLimitOf(snapshot, "maxBufferSize"),
          budget,
          required: bytes,
          unit: "bytes",
        });
      }
      return null;
    },
  );

  if (walk.acceptedIndex === null) {
    return Object.freeze({
      feature: "pbr-shadow-map" as const,
      enabled: false,
      value: pbrShadowPlan(0),
      downgradedFrom: topPlan,
      reason: disabledReason(tier, walk.rejection),
    });
  }
  const size = STUDIO_PBR_SHADOW_MAP_LADDER[walk.acceptedIndex];
  return Object.freeze({
    feature: "pbr-shadow-map" as const,
    enabled: true,
    value: pbrShadowPlan(size),
    downgradedFrom: walk.acceptedIndex === 0 ? null : topPlan,
    reason: reasonOf(tier, walk.acceptedIndex === 0 ? null : walk.rejection),
  });
}

/** IBL 프리필터 큐브맵 한 변과 러프니스 밉 단계 수. */
export function resolveStudioPbrIblBudget(
  classification: StudioCapabilityClassification,
): StudioCapabilityBudget<StudioPbrIblPlan> {
  const { tier, snapshot } = classification;
  const topPlan = pbrIblPlan(STUDIO_PBR_IBL_BASE_LADDER[0]);
  if (tier === "unsupported") {
    return Object.freeze({
      feature: "pbr-ibl" as const,
      enabled: false,
      value: pbrIblPlan(0),
      downgradedFrom: topPlan,
      reason: disabledReason(tier, null),
    });
  }

  const tierIndex = tierIndexCeiling(STUDIO_PBR_IBL_TIER_START_INDEX, tier);
  let ceilingIndex = tierIndex;
  let ceilingRejection = tierCeilingRejection(tierIndex);
  if (!classification.supportsFloat32Filterable) {
    const filterIndex = STUDIO_PBR_IBL_BASE_LADDER.findIndex(
      (size) => size <= STUDIO_PBR_IBL_NO_FLOAT_FILTER_MAX_BASE,
    );
    if (filterIndex > ceilingIndex) {
      ceilingIndex = filterIndex;
      ceilingRejection = rejection({
        code: "missing-gpu-feature",
        gpuFeature: "float32-filterable",
        budget: STUDIO_PBR_IBL_NO_FLOAT_FILTER_MAX_BASE,
        required: STUDIO_PBR_IBL_BASE_LADDER[tierIndex],
        unit: "pixels",
      });
    }
  }

  const maxTexture2d = limitOf(snapshot, "maxTextureDimension2D");
  const budget = Math.floor(limitOf(snapshot, "maxBufferSize") * STUDIO_PBR_IBL_SHARE);
  const walk = walkLadder(
    STUDIO_PBR_IBL_BASE_LADDER.length,
    ceilingIndex,
    ceilingRejection,
    (index) => {
      const size = STUDIO_PBR_IBL_BASE_LADDER[index];
      if (size > maxTexture2d) {
        return rejection({
          code: "texture-dimension",
          limit: "maxTextureDimension2D",
          limitValue: reportedLimitOf(snapshot, "maxTextureDimension2D"),
          budget: maxTexture2d,
          required: size,
          unit: "pixels",
        });
      }
      const bytes = studioPbrIblBytes(size);
      if (bytes > budget) {
        return rejection({
          code: "buffer-budget",
          limit: "maxBufferSize",
          limitValue: reportedLimitOf(snapshot, "maxBufferSize"),
          budget,
          required: bytes,
          unit: "bytes",
        });
      }
      return null;
    },
  );

  if (walk.acceptedIndex === null) {
    return Object.freeze({
      feature: "pbr-ibl" as const,
      enabled: false,
      value: pbrIblPlan(0),
      downgradedFrom: topPlan,
      reason: disabledReason(tier, walk.rejection),
    });
  }
  const baseSize = STUDIO_PBR_IBL_BASE_LADDER[walk.acceptedIndex];
  return Object.freeze({
    feature: "pbr-ibl" as const,
    enabled: true,
    value: pbrIblPlan(baseSize),
    downgradedFrom: walk.acceptedIndex === 0 ? null : topPlan,
    reason: reasonOf(tier, walk.acceptedIndex === 0 ? null : walk.rejection),
  });
}

export function resolveStudioPbrBudget(
  classification: StudioCapabilityClassification,
): StudioPbrPlan {
  return Object.freeze({
    shadow: resolveStudioPbrShadowBudget(classification),
    ibl: resolveStudioPbrIblBudget(classification),
  });
}

// ---------------------------------------------------------------------------
// 통합 계획
// ---------------------------------------------------------------------------

export interface StudioCapabilityPlan {
  readonly tier: StudioCapabilityTier;
  readonly classification: StudioCapabilityClassification;
  readonly smokeGrid: StudioCapabilityBudget<StudioSmokeGridSize>;
  readonly pathTrace: StudioPathTracePlan;
  readonly sculpt: StudioCapabilityBudget<StudioSculptPlan>;
  readonly pbr: StudioPbrPlan;
}

export interface StudioCapabilityPlanRequest {
  readonly pathTrace?: StudioPathTraceRequest;
}

/** 진입점 하나로 모든 서브시스템 예산을 한 번에 만든다(StudioPage 가 이걸 쓴다). */
export function resolveStudioCapabilityPlan(
  classification: StudioCapabilityClassification,
  request: StudioCapabilityPlanRequest = {},
): StudioCapabilityPlan {
  return Object.freeze({
    tier: classification.tier,
    classification,
    smokeGrid: resolveStudioSmokeGridBudget(classification),
    pathTrace: resolveStudioPathTraceBudget(classification, request.pathTrace),
    sculpt: resolveStudioSculptBudget(classification),
    pbr: resolveStudioPbrBudget(classification),
  });
}

/** 실제로 낮아지거나 꺼진 예산만 골라낸다 — UI 는 이것만 문장으로 보여주면 된다. */
export function collectStudioCapabilityDowngrades(
  plan: StudioCapabilityPlan,
): readonly StudioCapabilityBudget<unknown>[] {
  const all: readonly StudioCapabilityBudget<unknown>[] = [
    plan.smokeGrid,
    plan.pathTrace.accumulation,
    plan.pathTrace.bounces,
    plan.pathTrace.bvh,
    plan.sculpt,
    plan.pbr.shadow,
    plan.pbr.ibl,
  ];
  return Object.freeze(all.filter((budget) => !budget.enabled || budget.downgradedFrom !== null));
}

/** 등급이 최소 기준 이상일 때만 무거운 서브시스템을 노출하고 싶을 때 쓰는 편의 함수. */
export function isStudioCapabilityFeatureOffered(
  tier: StudioCapabilityTier,
  minimum: StudioCapabilityRankedTier,
): boolean {
  return isStudioCapabilityTierAtLeast(tier, minimum);
}

/** 문서/테스트에서 쓰는 참고 상수 — 명세 기본 한도 그대로의 어댑터. */
export const STUDIO_CAPABILITY_SPEC_FLOOR_LIMITS = Object.freeze({
  maxBufferSize: 256 * MIB,
  maxStorageBufferBindingSize: 128 * MIB,
  maxUniformBufferBindingSize: 65_536,
  maxComputeWorkgroupStorageSize: 16_384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxTextureDimension2D: 8_192,
  maxTextureDimension3D: 2_048,
  maxStorageBuffersPerShaderStage: 8,
});

/** 문서/테스트에서 쓰는 참고 상수 — `full` 기준을 정확히 만족하는 어댑터. */
export const STUDIO_CAPABILITY_FULL_TIER_LIMITS = Object.freeze({
  maxBufferSize: 1 * GIB,
  maxStorageBufferBindingSize: 512 * MIB,
  maxUniformBufferBindingSize: 65_536,
  maxComputeWorkgroupStorageSize: 32_768,
  maxComputeInvocationsPerWorkgroup: 256,
  maxTextureDimension2D: 16_384,
  maxTextureDimension3D: 2_048,
  maxStorageBuffersPerShaderStage: 8,
});
