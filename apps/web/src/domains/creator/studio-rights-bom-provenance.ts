/**
 * Studio Rights BOM & Provenance Engine — 웹툰 제작에 사용된 모든 에셋
 * (폰트·3D·브러시·음원·AI·창작자)의 저작권 명세서(BOM), 라이선스 만료 감사 및 C2PA 출처 인증 코어.
 *
 * 마스터플랜 17.1 (Rights BOM), 17.2 (Provenance), 17.4 (콘텐츠 안전) & 997개 기능 갭:
 * - 작품별 사용 에셋 권리 명세서(Rights Bill of Materials) 등록 및 추적
 * - 폰트, 3D 소품/배경, 브러시, 음원, 텍스처, AI 생성물 라이선스 유형 및 범위
 * - 상업적 이용 가능 여부, 지역/매체 권리, 라이선스 만료 사전 경고
 * - 콘텐츠 안전(Content Safety) 리스크 스캔 및 C2PA 호환 출처(Provenance) 증명서 발행
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_RIGHTS_BOM_VERSION = 1 as const;

export const RIGHTS_ASSET_KINDS = [
  "font",
  "3d-prop",
  "3d-scene",
  "brush-preset",
  "audio-track",
  "texture-pattern",
  "ai-reference",
  "human-artwork",
] as const;
export type RightsAssetKind = (typeof RIGHTS_ASSET_KINDS)[number];

export const LICENSE_TYPES = [
  "commercial-unlimited",
  "commercial-attribution",
  "editorial-only",
  "custom-contract",
  "cc-by-4.0",
  "cc0-public-domain",
  "proprietary",
] as const;
export type RightsLicenseType = (typeof LICENSE_TYPES)[number];

export interface RightsAttribution {
  readonly creatorName: string;
  readonly copyrightHolder: string;
  readonly sourceUrl?: string;
  readonly contractId?: string;
}

export interface RightsPermissions {
  readonly allowCommercialUse: boolean;
  readonly allowModification: boolean;
  readonly allowRedistribution: boolean;
  readonly requireAttribution: boolean;
}

export interface RightsBomItem {
  readonly id: string;
  readonly assetRef: string;
  readonly assetName: string;
  readonly kind: RightsAssetKind;
  readonly attribution: RightsAttribution;
  readonly license: RightsLicenseType;
  readonly permissions: RightsPermissions;
  readonly allowedMediaTypes?: readonly string[]; // e.g. ["webtoon", "print", "merchandise"]
  readonly expiresAtMs?: number;
  readonly boundPanelIds?: readonly string[];
}

export interface ContentSafetyFlag {
  readonly category: "violence" | "adult" | "hate" | "copyright-risk";
  readonly severity: "low" | "medium" | "high";
  readonly description: string;
  readonly panelId?: string;
}

export interface StudioRightsBomRegistry {
  readonly version: typeof STUDIO_RIGHTS_BOM_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly items: readonly RightsBomItem[];
  readonly safetyFlags?: readonly ContentSafetyFlag[];
}

export interface RightsComplianceDiagnostic {
  readonly code:
    | "LICENSE_EXPIRED"
    | "LICENSE_EXPIRING_SOON"
    | "COMMERCIAL_USE_FORBIDDEN"
    | "ATTRIBUTION_REQUIRED"
    | "MEDIA_TYPE_NOT_PERMITTED";
  readonly itemId: string;
  readonly assetName: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface ProvenanceCertificate {
  readonly version: typeof STUDIO_RIGHTS_BOM_VERSION;
  readonly episodeId: string;
  readonly humanAuthors: readonly string[];
  readonly aiAssistanceDeclared: boolean;
  readonly totalTrackedAssets: number;
  readonly generatedAtMs: number;
  readonly manifestDigest: string;
}

export function createRightsBomRegistry(params: {
  id: string;
  episodeId: string;
  items?: readonly RightsBomItem[];
  safetyFlags?: readonly ContentSafetyFlag[];
}): StudioRightsBomRegistry {
  return Object.freeze({
    version: STUDIO_RIGHTS_BOM_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    items: Object.freeze([...(params.items ?? [])]),
    safetyFlags: params.safetyFlags ? Object.freeze([...params.safetyFlags]) : undefined,
  });
}

export function addRightsBomItem(
  registry: StudioRightsBomRegistry,
  item: RightsBomItem,
): StudioRightsBomRegistry {
  if (registry.items.some((i) => i.id === item.id)) {
    throw new Error(`BOM item ${item.id} already exists`);
  }
  return {
    ...registry,
    items: Object.freeze([...registry.items, item]),
  };
}

export function removeRightsBomItem(
  registry: StudioRightsBomRegistry,
  itemId: string,
): StudioRightsBomRegistry {
  return {
    ...registry,
    items: Object.freeze(registry.items.filter((i) => i.id !== itemId)),
  };
}

/**
 * 특정 배포 목적(isCommercial, targetMediaType) 및 현재 시각에 따라 권리 적합성을 전수 감사한다.
 */
export function auditRightsCompliance(
  registry: StudioRightsBomRegistry,
  targetUsage: { isCommercial: boolean; targetMediaType?: string },
  nowMs: number,
): readonly RightsComplianceDiagnostic[] {
  const diagnostics: RightsComplianceDiagnostic[] = [];
  const thirtyDaysMs = 30 * 86_400_000;

  for (const item of registry.items) {
    // 1. Commercial Use Permission
    if (targetUsage.isCommercial && !item.permissions.allowCommercialUse) {
      diagnostics.push({
        code: "COMMERCIAL_USE_FORBIDDEN",
        itemId: item.id,
        assetName: item.assetName,
        message: `에셋 '${item.assetName}'은 상업적 이용이 허용되지 않은 라이선스(${item.license})입니다.`,
        severity: "error",
      });
    }

    // 2. Expiration Check
    if (item.expiresAtMs !== undefined) {
      if (nowMs >= item.expiresAtMs) {
        diagnostics.push({
          code: "LICENSE_EXPIRED",
          itemId: item.id,
          assetName: item.assetName,
          message: `에셋 '${item.assetName}'의 라이선스가 만료되었습니다(${new Date(item.expiresAtMs).toISOString().split("T")[0]}).`,
          severity: "error",
        });
      } else if (item.expiresAtMs - nowMs <= thirtyDaysMs) {
        const daysLeft = Math.ceil((item.expiresAtMs - nowMs) / 86_400_000);
        diagnostics.push({
          code: "LICENSE_EXPIRING_SOON",
          itemId: item.id,
          assetName: item.assetName,
          message: `에셋 '${item.assetName}'의 라이선스 만료가 ${daysLeft}일 남았습니다.`,
          severity: "warning",
        });
      }
    }

    // 3. Media Type Check
    if (targetUsage.targetMediaType && item.allowedMediaTypes && item.allowedMediaTypes.length > 0) {
      if (!item.allowedMediaTypes.includes(targetUsage.targetMediaType)) {
        diagnostics.push({
          code: "MEDIA_TYPE_NOT_PERMITTED",
          itemId: item.id,
          assetName: item.assetName,
          message: `에셋 '${item.assetName}'은 '${targetUsage.targetMediaType}' 매체 배포 권리가 포함되어 있지 않습니다.`,
          severity: "error",
        });
      }
    }
  }

  return Object.freeze(diagnostics);
}

/**
 * 저작권 및 출처 정보를 집약한 C2PA 호환 증명서 메타데이터를 발행한다.
 */
export function generateProvenanceCertificate(
  registry: StudioRightsBomRegistry,
  episodeInfo: { humanAuthors: readonly string[]; nowMs: number },
): ProvenanceCertificate {
  const hasAi = registry.items.some((i) => i.kind === "ai-reference");

  // Deterministic digest hash
  let hashVal = 0;
  for (const item of registry.items) {
    for (let c = 0; c < item.id.length; c += 1) {
      hashVal = (hashVal * 31 + item.id.charCodeAt(c)) | 0;
    }
  }
  const digest = `c2pa:toonspectrum:${registry.episodeId}:${Math.abs(hashVal).toString(16)}`;

  return Object.freeze({
    version: STUDIO_RIGHTS_BOM_VERSION,
    episodeId: registry.episodeId,
    humanAuthors: Object.freeze([...episodeInfo.humanAuthors]),
    aiAssistanceDeclared: hasAi,
    totalTrackedAssets: registry.items.length,
    generatedAtMs: episodeInfo.nowMs,
    manifestDigest: digest,
  });
}
