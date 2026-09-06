/**
 * market-webtoon-licensing.ts
 *
 * Webtoon Commercial Licensing & NoAI Protection Engine.
 * Benchmarks Acon3D, Pixiv BOOTH, and Clip Studio ASSETS licensing frameworks.
 *
 * - 4 Tiered licenses:
 *   1. `solo-creator`: 1인 작가 상업 연재용 (개인 웹툰/출판 1작품 또는 개인 연재, 2차 가공 허용)
 *   2. `studio-team`: 어시스턴트 포함 팀 라이선스 (메인 작가 + 팀원 최대 5인 내 동시 작업 허용)
 *   3. `corporate-agency`: 웹툰 제작사/에이전시 법인 라이선스 (다수 소속 작가 및 프로젝트 사용)
 *   4. `open-cc0`: 퍼블릭 도메인 완전 무료 공개
 *
 * - Strict NoAI & Redistribution Guards:
 *   - NoAI training enforcement tag
 *   - Prohibits extracting 3D geometry or brushes for commercial standalone resale
 */

export type WebtoonLicenseTier =
  | "solo-creator"
  | "studio-team"
  | "corporate-agency"
  | "open-cc0";

export interface WebtoonLicenseTerms {
  readonly tier: WebtoonLicenseTier;
  readonly labelKo: string;
  readonly descriptionKo: string;
  readonly maxSeats: number; // 1 for solo, 5 for team, -1 for unlimited corporate
  readonly allowCommercialWebtoonPublishing: boolean;
  readonly allowTextureAndMeshModification: boolean;
  readonly allowRedistribution: boolean;
  readonly isNoAiProtected: boolean;
  readonly attributionRequired: boolean;
}

export const WEBTOON_LICENSE_TIERS: Record<WebtoonLicenseTier, WebtoonLicenseTerms> = {
  "solo-creator": {
    tier: "solo-creator",
    labelKo: "개인 작가 상업 라이선스 (1인)",
    descriptionKo: "개인 명의 웹툰 연재, 단행본 출판, 공모전 출품에 영구적으로 상업 이용 가능 (보조 인원 공유 불가)",
    maxSeats: 1,
    allowCommercialWebtoonPublishing: true,
    allowTextureAndMeshModification: true,
    allowRedistribution: false,
    isNoAiProtected: true,
    attributionRequired: false,
  },
  "studio-team": {
    tier: "studio-team",
    labelKo: "스튜디오 팀 라이선스 (최대 5인)",
    descriptionKo: "메인 작가 및 배경/채색 어시스턴트 등 한 팀 내 최대 5인이 공동 작업 파일로 공유하여 연재 가능",
    maxSeats: 5,
    allowCommercialWebtoonPublishing: true,
    allowTextureAndMeshModification: true,
    allowRedistribution: false,
    isNoAiProtected: true,
    attributionRequired: false,
  },
  "corporate-agency": {
    tier: "corporate-agency",
    labelKo: "제작사/에이전시 법인 라이선스",
    descriptionKo: "웹툰 에이전시, 플랫폼, 애니메이션 제작사 소속 다수 작가 및 다작 프로젝트에 무제한 활용",
    maxSeats: -1,
    allowCommercialWebtoonPublishing: true,
    allowTextureAndMeshModification: true,
    allowRedistribution: false,
    isNoAiProtected: true,
    attributionRequired: false,
  },
  "open-cc0": {
    tier: "open-cc0",
    labelKo: "CC0 1.0 퍼블릭 도메인",
    descriptionKo: "저작권 제한 없이 상업/비상업 모든 용도로 자유롭게 수정, 사용, 배포 가능",
    maxSeats: -1,
    allowCommercialWebtoonPublishing: true,
    allowTextureAndMeshModification: true,
    allowRedistribution: true,
    isNoAiProtected: false,
    attributionRequired: false,
  },
};

export class MarketWebtoonLicensingEngine {
  /**
   * Returns complete license terms for a specified tier.
   */
  public getTerms(tier: WebtoonLicenseTier): WebtoonLicenseTerms {
    return WEBTOON_LICENSE_TIERS[tier] ?? WEBTOON_LICENSE_TIERS["solo-creator"];
  }

  /**
   * Computes recommended pricing multiplier based on license tier.
   * Standard Acon3D multiplier: Solo 1.0x, Team 2.5x, Corporate 5.0x.
   */
  public calculateTierPrice(baseSoloPrice: number, tier: WebtoonLicenseTier): number {
    if (baseSoloPrice <= 0) return 0;
    if (tier === "open-cc0") return 0;

    switch (tier) {
      case "solo-creator":
        return baseSoloPrice;
      case "studio-team":
        return Math.round(baseSoloPrice * 2.5);
      case "corporate-agency":
        return Math.round(baseSoloPrice * 5.0);
      default:
        return baseSoloPrice;
    }
  }

  /**
   * Verifies whether an asset usage complies with its license.
   */
  public verifyCompliance(
    tier: WebtoonLicenseTier,
    activeTeamMembers: number,
    isResellingRawAsset: boolean,
  ): {
    isCompliant: boolean;
    violationReason?: string;
  } {
    if (isResellingRawAsset && tier !== "open-cc0") {
      return {
        isCompliant: false,
        violationReason: "에셋 원본 또는 텍스처 추출본의 무단 재판매는 엄격히 금지됩니다.",
      };
    }

    const terms = this.getTerms(tier);
    if (terms.maxSeats !== -1 && activeTeamMembers > terms.maxSeats) {
      return {
        isCompliant: false,
        violationReason: `선택된 라이선스의 허용 인원(${terms.maxSeats}명)을 초과했습니다. 팀 라이선스로 업그레이드하세요.`,
      };
    }

    return { isCompliant: true };
  }
}
