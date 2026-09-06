/**
 * Studio Subscription Entitlements & Storage Quota Monitor — 요금제 등급별
 * 기능 권한(Entitlement), 클라우드 저장용량, AI 토큰 및 협업 좌석 사용량 모니터링 코어.
 *
 * 마스터플랜 15.5 (권장 요금 구조), 27장 (계정·요금·운영·지원) & 997개 기능 갭:
 * - 4대 구독 등급: Free, Creator Pro, Studio Team, Enterprise
 * - 캔버스 최대 해상도, 저장 공간(MB), WebGPU 가속/CMYK 소프트프루프 권한, 월간 AI 토큰
 * - 80% 사전 경고 및 100% 한도 초과 차단/유예(Grace Period) 정책
 * - 실시간 사용량 계측 및 리포팅
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_SUBSCRIPTION_QUOTA_VERSION = 1 as const;

export const SUBSCRIPTION_TIERS = [
  "free",
  "creator-pro",
  "studio-team",
  "enterprise",
] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export interface TierEntitlements {
  readonly tier: SubscriptionTier;
  readonly maxCanvasHeightPx: number;
  readonly maxStorageMb: number;
  readonly maxCollabSeats: number;
  readonly allowWebGpuExport: boolean;
  readonly allowCmykSoftProof: boolean;
  readonly monthlyAiTokens: number;
  readonly allowCustomPlugins: boolean;
}

export const TIER_ENTITLEMENT_DEFINITIONS: Record<SubscriptionTier, TierEntitlements> = {
  free: {
    tier: "free",
    maxCanvasHeightPx: 10_000,
    maxStorageMb: 500, // 500MB
    maxCollabSeats: 1,
    allowWebGpuExport: false,
    allowCmykSoftProof: false,
    monthlyAiTokens: 100,
    allowCustomPlugins: false,
  },
  "creator-pro": {
    tier: "creator-pro",
    maxCanvasHeightPx: 50_000,
    maxStorageMb: 50_000, // 50GB
    maxCollabSeats: 3,
    allowWebGpuExport: true,
    allowCmykSoftProof: true,
    monthlyAiTokens: 2_000,
    allowCustomPlugins: true,
  },
  "studio-team": {
    tier: "studio-team",
    maxCanvasHeightPx: 200_000,
    maxStorageMb: 500_000, // 500GB
    maxCollabSeats: 15,
    allowWebGpuExport: true,
    allowCmykSoftProof: true,
    monthlyAiTokens: 10_000,
    allowCustomPlugins: true,
  },
  enterprise: {
    tier: "enterprise",
    maxCanvasHeightPx: 1_000_000,
    maxStorageMb: 5_000_000, // 5TB
    maxCollabSeats: 100,
    allowWebGpuExport: true,
    allowCmykSoftProof: true,
    monthlyAiTokens: 50_000,
    allowCustomPlugins: true,
  },
};

export interface SubscriptionUsageState {
  readonly userIdOrOrgId: string;
  readonly tier: SubscriptionTier;
  readonly currentStorageMbUsed: number;
  readonly currentAiTokensUsed: number;
  readonly currentCollabSeatsActive: number;
}

export interface EntitlementCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly isWarningThreshold: boolean;
  readonly usageRatio: number; // 0..1
}

export function getTierEntitlements(tier: SubscriptionTier): TierEntitlements {
  return TIER_ENTITLEMENT_DEFINITIONS[tier] ?? TIER_ENTITLEMENT_DEFINITIONS.free;
}

/**
 * 특정 작업(저장공간 사용, AI 생성, CMYK 프루핑 등)에 대한 구독 권한을 검사한다.
 */
export function checkActionEntitlement(
  state: SubscriptionUsageState,
  action:
    | { type: "consume-storage"; requestedMb: number }
    | { type: "consume-ai-tokens"; tokenCount: number }
    | { type: "create-canvas"; heightPx: number }
    | { type: "use-feature"; feature: "webgpu-export" | "cmyk-softproof" | "custom-plugins" },
): EntitlementCheckResult {
  const spec = getTierEntitlements(state.tier);

  if (action.type === "consume-storage") {
    const nextTotal = state.currentStorageMbUsed + action.requestedMb;
    const ratio = nextTotal / spec.maxStorageMb;
    if (nextTotal > spec.maxStorageMb) {
      return {
        allowed: false,
        reason: `클라우드 저장공간 한도(${spec.maxStorageMb}MB)를 초과합니다 (현재 ${nextTotal.toFixed(1)}MB).`,
        isWarningThreshold: true,
        usageRatio: ratio,
      };
    }
    return {
      allowed: true,
      isWarningThreshold: ratio >= 0.8,
      usageRatio: ratio,
    };
  }

  if (action.type === "consume-ai-tokens") {
    const nextTokens = state.currentAiTokensUsed + action.tokenCount;
    const ratio = nextTokens / spec.monthlyAiTokens;
    if (nextTokens > spec.monthlyAiTokens) {
      return {
        allowed: false,
        reason: `이번 달 AI 토큰 한도(${spec.monthlyAiTokens})를 초과했습니다 (요청량: ${action.tokenCount}, 잔여: ${Math.max(0, spec.monthlyAiTokens - state.currentAiTokensUsed)}).`,
        isWarningThreshold: true,
        usageRatio: ratio,
      };
    }
    return {
      allowed: true,
      isWarningThreshold: ratio >= 0.8,
      usageRatio: ratio,
    };
  }

  if (action.type === "create-canvas") {
    if (action.heightPx > spec.maxCanvasHeightPx) {
      return {
        allowed: false,
        reason: `${state.tier} 요금제의 최대 캔버스 세로 높이는 ${spec.maxCanvasHeightPx}px입니다 (요청: ${action.heightPx}px).`,
        isWarningThreshold: false,
        usageRatio: 1.0,
      };
    }
    return { allowed: true, isWarningThreshold: false, usageRatio: action.heightPx / spec.maxCanvasHeightPx };
  }

  if (action.type === "use-feature") {
    if (action.feature === "webgpu-export" && !spec.allowWebGpuExport) {
      return { allowed: false, reason: "WebGPU 고속 익스포트는 Creator Pro 이상에서 지원됩니다.", isWarningThreshold: false, usageRatio: 0 };
    }
    if (action.feature === "cmyk-softproof" && !spec.allowCmykSoftProof) {
      return { allowed: false, reason: "CMYK 소프트 프루핑은 Creator Pro 이상에서 지원됩니다.", isWarningThreshold: false, usageRatio: 0 };
    }
    if (action.feature === "custom-plugins" && !spec.allowCustomPlugins) {
      return { allowed: false, reason: "커스텀 플러그인 확장은 Creator Pro 이상에서 지원됩니다.", isWarningThreshold: false, usageRatio: 0 };
    }
    return { allowed: true, isWarningThreshold: false, usageRatio: 0 };
  }

  return { allowed: true, isWarningThreshold: false, usageRatio: 0 };
}

/**
 * 리소스 사용량을 가산 반영한다.
 */
export function recordResourceUsage(
  state: SubscriptionUsageState,
  delta: { storageMb?: number; aiTokens?: number; activeSeats?: number },
): SubscriptionUsageState {
  return Object.freeze({
    ...state,
    currentStorageMbUsed: Math.max(0, state.currentStorageMbUsed + (delta.storageMb ?? 0)),
    currentAiTokensUsed: Math.max(0, state.currentAiTokensUsed + (delta.aiTokens ?? 0)),
    currentCollabSeatsActive: Math.max(0, state.currentCollabSeatsActive + (delta.activeSeats ?? 0)),
  });
}
