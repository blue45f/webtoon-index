import manifest from "./studio-2d-asset-manifest.json";

export interface Studio2dScene {
  readonly id: string;
  readonly label: string;
  readonly genre: string;
  readonly imgSrc?: string;
  readonly svg?: string;
  readonly width?: number;
  readonly height?: number;
}

export type Studio2dAssetMetadata = (typeof manifest.assets)[number];
export type Studio2dOrientation = "all" | "landscape" | "portrait" | "square";
export type Studio2dQualityFilter = "all" | "recommended" | "large" | "raster" | "vector";
export type Studio2dSort = "recommended" | "resolution" | "name";
export type Studio2dEnvironment = "all" | "실내" | "실외";
export type Studio2dTimeOfDay = "all" | "낮" | "노을" | "밤";

export interface Studio2dFilters {
  readonly query?: string;
  readonly genre?: string;
  readonly quality?: Studio2dQualityFilter;
  readonly orientation?: Studio2dOrientation;
  readonly emptySceneOnly?: boolean;
  readonly environment?: Studio2dEnvironment;
  readonly timeOfDay?: Studio2dTimeOfDay;
  readonly textFreeOnly?: boolean;
  readonly sort?: Studio2dSort;
}

export const STUDIO_2D_ASSET_METADATA: readonly Studio2dAssetMetadata[] = manifest.assets;
const byId = new Map(STUDIO_2D_ASSET_METADATA.map((asset) => [asset.id, asset]));

/** An ID alone is insufficient: replacing the source must invalidate the old metadata. */
export function getStudio2dAssetMetadata(scene: Studio2dScene): Studio2dAssetMetadata | undefined {
  const asset = byId.get(scene.id);
  return asset && (asset.src === scene.imgSrc || asset.legacySrc === scene.imgSrc) ? asset : undefined;
}

export function isLargeStudio2dAsset(asset: Pick<Studio2dAssetMetadata, "width" | "height">): boolean {
  return Number.isInteger(asset.width) && Number.isInteger(asset.height)
    && Math.min(asset.width, asset.height) >= 900
    && Math.max(asset.width, asset.height) >= 1024;
}

export function isRecommendedStudio2dScene(scene: Studio2dScene): boolean {
  const asset = getStudio2dAssetMetadata(scene);
  return !!asset && asset.recommended && asset.review.status === "usable"
    && asset.review.method === "full-image" && isLargeStudio2dAsset(asset);
}

export function studio2dOrientation(width: number, height: number): Exclude<Studio2dOrientation, "all"> {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

export function studio2dDisplayName(scene: Studio2dScene): string {
  return getStudio2dAssetMetadata(scene)?.title ?? scene.label;
}

export function studio2dResolutionLabel(scene: Studio2dScene): string {
  const asset = getStudio2dAssetMetadata(scene);
  if (asset) return `${asset.width} × ${asset.height}px`;
  return scene.imgSrc ? "원본 정보 미확인" : "벡터 · 크기 조절 가능";
}

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");

/** AND-search across name, original label, normalized genre, environment, and tags. */
export function filterStudio2dScenes<T extends Studio2dScene>(
  groups: readonly { readonly genre: string; readonly scenes: readonly T[] }[],
  filters: Studio2dFilters = {},
): T[] {
  const seen = new Set<string>();
  const tokens = normalize(filters.query ?? "").split(/\s+/u).filter(Boolean);
  const result: T[] = [];
  for (const group of groups) {
    if (filters.genre && filters.genre !== "all" && filters.genre !== group.genre) continue;
    for (const scene of group.scenes) {
      if (seen.has(scene.id)) continue;
      seen.add(scene.id);
      const asset = getStudio2dAssetMetadata(scene);
      if (filters.quality === "recommended" && !isRecommendedStudio2dScene(scene)) continue;
      if (filters.quality === "large" && (!asset || !isLargeStudio2dAsset(asset))) continue;
      if (filters.quality === "raster" && !scene.imgSrc) continue;
      if (filters.quality === "vector" && (scene.imgSrc || !scene.svg)) continue;
      // Unknown content is not silently admitted as an empty/person-free scene.
      if (filters.emptySceneOnly && (!asset || asset.containsPeople !== false)) continue;
      // Descriptive filters require matching, reviewed source metadata. Unknown is not false.
      if (filters.textFreeOnly && (!asset || asset.containsText !== false)) continue;
      if (filters.environment && filters.environment !== "all" && asset?.environment !== filters.environment) continue;
      if (filters.timeOfDay && filters.timeOfDay !== "all" && asset?.timeOfDay !== filters.timeOfDay) continue;
      if (filters.orientation && filters.orientation !== "all") {
        if (!asset || studio2dOrientation(asset.width, asset.height) !== filters.orientation) continue;
      }
      const haystack = normalize([
        scene.label, scene.genre, group.genre, asset?.title,
        asset?.environment, asset?.timeOfDay, ...(asset?.tags ?? []),
      ].filter(Boolean).join(" "));
      if (!tokens.every((token) => haystack.includes(token))) continue;
      result.push(scene);
    }
  }
  const pixels = (scene: T) => {
    const asset = getStudio2dAssetMetadata(scene);
    return asset ? asset.width * asset.height : 0;
  };
  return result.sort((a, b) => {
    if (filters.sort === "name") return studio2dDisplayName(a).localeCompare(studio2dDisplayName(b), "ko");
    if (filters.sort === "resolution") return pixels(b) - pixels(a);
    return Number(isRecommendedStudio2dScene(b)) - Number(isRecommendedStudio2dScene(a))
      || pixels(b) - pixels(a);
  });
}
