/**
 * Studio Asset Registry & Recipe Bundler — 브러시·말풍선·3D 소품·템플릿·
 * 필터 레시피 등 제작 자산의 버전, 해시, 의존성, 사용처 역추적 및 배포 패키지 번들러 코어.
 *
 * 마스터플랜 15.1 (Studio Asset Registry), 15.2 (마켓 구조) & 997개 기능 갭:
 * - 자산 유형 (Brush/Tone, Balloon/SFX, 3D Set/Prop, Template, Filter Recipe, Font/Audio)
 * - 콘텐츠 해시(Content Hash), 시맨틱 버전, 호환성, 라이선스, 제작자 메타데이터
 * - 프로젝트·회차·컷별 사용처 역추적(Used-in Project/Panel)
 * - 사용 중단(Deprecation/Recall) 및 대체 자산 마이그레이션 안내
 * - 자산 패키지(.toonasst) 및 레시피 번들러
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_ASSET_REGISTRY_VERSION = 1 as const;

export const STUDIO_ASSET_TYPES = [
  "brush-paper-tone",
  "balloon-sfx-effect",
  "character-costume-pose",
  "3d-set-prop-material",
  "template-component-master",
  "filter-look-recipe",
  "font-audio",
  "ai-reference-pack",
] as const;
export type StudioAssetType = (typeof STUDIO_ASSET_TYPES)[number];

export interface AssetUsageRef {
  readonly projectId: string;
  readonly episodeId: string;
  readonly panelId?: string;
  readonly referencedAtMs: number;
}

export interface AssetDeprecation {
  readonly isDeprecated: boolean;
  readonly reason?: string;
  readonly replacementAssetId?: string;
}

export interface StudioAssetRecord {
  readonly id: string;
  readonly type: StudioAssetType;
  readonly name: string;
  readonly version: string; // semver e.g. "1.2.0"
  readonly contentHash: string; // sha256 or digest
  readonly creatorName: string;
  readonly minStudioVersion: number;
  readonly licenseType: string;
  readonly isCommercialPermitted: boolean;
  readonly dependencies?: readonly string[]; // IDs of other required assets
  readonly usedIn: readonly AssetUsageRef[];
  readonly deprecation?: AssetDeprecation;
  readonly payloadUri: string;
  readonly createdAtMs: number;
}

export interface AssetRecipeBundle {
  readonly bundleId: string;
  readonly bundleTitle: string;
  readonly author: string;
  readonly version: string;
  readonly includedAssets: readonly StudioAssetRecord[];
  readonly totalSizeEstimateKb: number;
  readonly bundledAtMs: number;
}

export interface StudioAssetRegistry {
  readonly version: typeof STUDIO_ASSET_REGISTRY_VERSION;
  readonly assets: readonly StudioAssetRecord[];
}

export function createStudioAssetRegistry(params: {
  assets?: readonly StudioAssetRecord[];
} = {}): StudioAssetRegistry {
  return Object.freeze({
    version: STUDIO_ASSET_REGISTRY_VERSION,
    assets: Object.freeze([...(params.assets ?? [])]),
  });
}

export function registerAsset(
  registry: StudioAssetRegistry,
  asset: StudioAssetRecord,
): StudioAssetRegistry {
  if (registry.assets.some((a) => a.id === asset.id)) {
    throw new Error(`Asset ${asset.id} already exists`);
  }
  return {
    ...registry,
    assets: Object.freeze([...registry.assets, asset]),
  };
}

export function updateAssetUsage(
  registry: StudioAssetRegistry,
  assetId: string,
  usage: AssetUsageRef,
): StudioAssetRegistry {
  const index = registry.assets.findIndex((a) => a.id === assetId);
  if (index === -1) {
    throw new Error(`Asset ${assetId} not found`);
  }
  const asset = registry.assets[index];
  const updated: StudioAssetRecord = {
    ...asset,
    usedIn: Object.freeze([...asset.usedIn, usage]),
  };
  const nextAssets = [...registry.assets];
  nextAssets[index] = Object.freeze(updated);
  return { ...registry, assets: Object.freeze(nextAssets) };
}

export function deprecateAsset(
  registry: StudioAssetRegistry,
  assetId: string,
  reason: string,
  replacementAssetId?: string,
): StudioAssetRegistry {
  const index = registry.assets.findIndex((a) => a.id === assetId);
  if (index === -1) {
    throw new Error(`Asset ${assetId} not found`);
  }
  const asset = registry.assets[index];
  const updated: StudioAssetRecord = {
    ...asset,
    deprecation: Object.freeze({
      isDeprecated: true,
      reason: reason.trim(),
      replacementAssetId: replacementAssetId?.trim(),
    }),
  };
  const nextAssets = [...registry.assets];
  nextAssets[index] = Object.freeze(updated);
  return { ...registry, assets: Object.freeze(nextAssets) };
}

/**
 * 선택된 에셋들과 필수 의존 에셋들을 자동으로 묶어 독립 배포 레시피 번들(.toonasst)을 생성한다.
 */
export function bundleAssetsToRecipe(
  registry: StudioAssetRegistry,
  rootAssetIds: readonly string[],
  bundleMeta: { bundleId: string; bundleTitle: string; author: string; version: string; nowMs: number },
): AssetRecipeBundle {
  const includedMap = new Map<string, StudioAssetRecord>();
  const queue = [...rootAssetIds];

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (includedMap.has(currId)) continue;

    const asset = registry.assets.find((a) => a.id === currId);
    if (!asset) {
      throw new Error(`Required asset ${currId} not found in registry`);
    }

    includedMap.set(currId, asset);

    if (asset.dependencies) {
      for (const depId of asset.dependencies) {
        if (!includedMap.has(depId)) {
          queue.push(depId);
        }
      }
    }
  }

  const includedAssets = Array.from(includedMap.values());

  return Object.freeze({
    bundleId: bundleMeta.bundleId.trim(),
    bundleTitle: bundleMeta.bundleTitle.trim(),
    author: bundleMeta.author.trim(),
    version: bundleMeta.version.trim(),
    includedAssets: Object.freeze(includedAssets),
    totalSizeEstimateKb: includedAssets.length * 250, // rough estimate
    bundledAtMs: bundleMeta.nowMs,
  });
}
