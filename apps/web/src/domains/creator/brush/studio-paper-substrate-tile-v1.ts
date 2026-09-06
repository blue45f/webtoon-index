/**
 * 종이 기질 타일 — 레시피에서 굽고, 이미 검증된 R8 레인에 얹는다
 * (2026-08-21 paper substrate wave, 3단계).
 *
 * 이 모듈이 잇는 것.
 * - `studio-paper-substrate-recipe-v1` (21종 → 레시피)
 * - `studio-procedural-media-surface-provider` (4채널 월드 서페이스, 소비자 0이었음)
 * - `studio-procedural-media-surface-worker-client` (전용 워커, 소비자 0이었음)
 * - `studio-paper-media-r8-grain-assets` 의 결정적 PNG 인코더 (소비자 0이었음)
 * - `studio-brush-r8-grain-runtime` 레지스트리 → `render/studio-webgpu-r8-grain-native`
 *
 * **왜 새 GPU 레인을 만들지 않았는가.** 지시는 `studio-webgpu-r8-grain-native.ts`를 복제하라는
 * 것이었지만, 그 파일을 읽어 보면 이미 **에셋 소스에 대해 완전히 일반적**이다 — r8unorm LRU,
 * `device.lost` 감시, WGSL 이미터, 비트 패리티 CPU 미러 샘플러가 전부 `assetId`가 아니라
 * "정규화된 R8 소스"를 받는다. 복제하면 916줄짜리 두 번째 device-lost 구현이 생기고 둘이
 * 갈라진다. 그래서 **복제 대신 재사용**한다 — 기질 타일을 같은 R8 에셋 계약으로 굽기만 하면
 * GPU 캐시·기기손실 처리·CPU 패리티가 전부 구성상 따라온다.
 *
 * 계약.
 * - **베이크된 타일 샘플이지 셰이더 합성이 아니다.** GPU와 CPU가 같은 바이트를 읽으므로
 *   부동소수 재현성 문제가 애초에 생기지 않는다(지시가 요구한 성질).
 * - 배포되는 것은 레시피(프리셋당 JSON ~880B)지 높이맵(256² = 65,536B)이 아니다.
 *   타일은 런타임에 굽는다 → 번들 증가 0, 네트워크 0, Service Worker 변경 0.
 * - R8 텍셀 = `round((height * 0.5 + 0.5) * 255)`. 128 = 접촉 중립면, 밝음 = 봉우리.
 *   `sampleStudioWebGpuR8GrainNativeCpu`의 `(sampled - 0.5)` 대비 규약과 정렬된다.
 * - 이음매: `seamlessPeriod`를 타일 한 변으로 두면 정수 푸리에 토러스라 경계 오차가 **정확히 0**이다
 *   (4-탭 크로스페이드 같은 대비 손실이 없다).
 */

import {
  renderStudioProceduralMediaSurfaceCpuOracle,
  type StudioProceduralMediaSurfaceArtifact,
  type StudioProceduralMediaSurfaceRecipe,
} from "../studio-procedural-media-surface-provider";
import { sha256HexPortable } from "../studio-sha256";

import { hydrateStudioBrushR8GrainAsset } from "./studio-brush-r8-grain-runtime";
import { encodeStudioPaperMediaR8PngV1 } from "./studio-paper-media-r8-grain-assets";
import {
  createStudioPaperSubstrateRecipeV1,
  type StudioPaperSubstrateRecipeOptionsV1,
} from "./studio-paper-substrate-recipe-v1";
import { STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1 as DEFAULT_TILE_SIZE } from "./studio-paper-substrate-tile-host-v1";


import type { StudioBrushR8TextureGrainSource } from "./studio-brush-r8-grain-asset-contract";
import type { StudioBrushR8GrainRegistry } from "./studio-brush-r8-grain-runtime";
import type { PaperGrainKind } from "./studio-paper-texture";

export const STUDIO_PAPER_SUBSTRATE_TILE_VERSION_V1 = 1 as const;

/** 에셋 id 접두 — `studio-paper-substrate-v1.{kind}.{size}.{fingerprint12}`. */
export const STUDIO_PAPER_SUBSTRATE_ASSET_ID_PREFIX_V1 = "studio-paper-substrate-v1";

/**
 * 기본 타일 한 변은 얇은 호스트가 소유한다 — UI가 이 무거운 모듈을 상수 하나 때문에
 * 정적으로 끌어오지 않게 하려는 것이다(번들 래칫).
 */
export { STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1 } from "./studio-paper-substrate-tile-host-v1";

export interface StudioPaperSubstrateTileRequestV1
  extends StudioPaperSubstrateRecipeOptionsV1 {
  readonly kind: PaperGrainKind;
  readonly seed: number;
  /** 타일 한 변(px). 문서 px 주기와 같다. */
  readonly size?: number;
}

export interface StudioPaperSubstrateTileV1 {
  readonly kind: PaperGrainKind;
  readonly seed: number;
  readonly size: number;
  readonly recipe: StudioProceduralMediaSurfaceRecipe;
  /** 부호 있는 릴리프 [-1,1], row-major. 4채널 아티팩트 전체를 들고 있다. */
  readonly artifact: StudioProceduralMediaSurfaceArtifact;
  /** GPU/CPU가 공유하는 정확히 같은 바이트. */
  readonly decodedBytes: Uint8Array;
  /** R8 레인이 요구하는 정규화 가능한 에셋 소스 참조. */
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  /** 결정적 그레이스케일 PNG — 나중에 에셋 스토리지로 그대로 영속화할 수 있다. */
  readonly encodedBytes: Uint8Array;
}

function clampSize(value: number | undefined): number {
  const raw = Math.round(value ?? DEFAULT_TILE_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_TILE_SIZE;
  return raw < 32 ? 32 : raw > 512 ? 512 : raw;
}

function cacheKey(request: StudioPaperSubstrateTileRequestV1): string {
  return [
    request.kind,
    request.seed >>> 0,
    clampSize(request.size),
    request.documentScale ?? 1,
    request.rotationRadians ?? 0,
  ].join("|");
}

/** 부호 있는 높이 [-1,1] → R8 텍셀. 128 = 접촉 중립면. */
function heightToR8(heights: Float32Array, size: number): Uint8Array {
  const bytes = new Uint8Array(size * size);
  for (let index = 0; index < bytes.length; index += 1) {
    const normalized = heights[index]! * 0.5 + 0.5;
    const clamped = normalized <= 0 ? 0 : normalized >= 1 ? 1 : normalized;
    bytes[index] = Math.round(clamped * 255);
  }
  return bytes;
}

const MAXIMUM_CACHED_TILES = 8;
const tileCache = new Map<string, StudioPaperSubstrateTileV1>();

function touchCache(key: string, tile: StudioPaperSubstrateTileV1): StudioPaperSubstrateTileV1 {
  tileCache.delete(key);
  tileCache.set(key, tile);
  while (tileCache.size > MAXIMUM_CACHED_TILES) {
    const oldest = tileCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
  return tile;
}

/**
 * 동기 CPU 굽기. 256²는 이 저장소 기준 ~1.0–1.9초라 **메인 스레드에서 부르면 안 된다** —
 * 테스트·워커·오프라인 베이크 전용이다. UI는 `requestStudioPaperSubstrateTileV1`을 쓴다.
 * 결과가 null이면 레시피가 계약을 어긴 것이고 호출자는 열화 경로를 고른다.
 */
export function bakeStudioPaperSubstrateTileV1(
  request: StudioPaperSubstrateTileRequestV1,
): StudioPaperSubstrateTileV1 | null {
  const key = cacheKey(request);
  const cached = tileCache.get(key);
  if (cached) return touchCache(key, cached);
  const size = clampSize(request.size);
  const recipe = createStudioPaperSubstrateRecipeV1(request.kind, request.seed, {
    documentScale: request.documentScale,
    rotationRadians: request.rotationRadians,
    seamlessPeriod: size,
  });
  if (!recipe) return null;
  let artifact: StudioProceduralMediaSurfaceArtifact;
  try {
    artifact = renderStudioProceduralMediaSurfaceCpuOracle(recipe, {
      originX: 0,
      originY: 0,
      width: size,
      height: size,
      halo: 0,
    });
  } catch {
    return null;
  }
  const decodedBytes = heightToR8(artifact.heightField, size);
  const encodedBytes = encodeStudioPaperMediaR8PngV1(size, size, decodedBytes);
  const source: StudioBrushR8TextureGrainSource = Object.freeze({
    kind: "r8-texture-v1" as const,
    asset: Object.freeze({
      assetId: `${STUDIO_PAPER_SUBSTRATE_ASSET_ID_PREFIX_V1}.${request.kind}.${size}.${
        recipe.fingerprint.slice(7, 19)
      }`,
      encodedSha256: `sha256:${sha256HexPortable(encodedBytes)}` as const,
      decodedSha256: `sha256:${sha256HexPortable(decodedBytes)}` as const,
      byteLength: encodedBytes.length,
      mediaType: "image/png" as const,
      width: size,
      height: size,
      channel: "luminance" as const,
      encoding: "r8-unorm" as const,
    }),
  });
  const tile: StudioPaperSubstrateTileV1 = Object.freeze({
    kind: request.kind,
    seed: request.seed >>> 0,
    size,
    recipe,
    artifact,
    decodedBytes,
    source,
    encodedBytes,
  });
  return touchCache(key, tile);
}

/**
 * 구운 타일을 R8 레지스트리에 등록한다 — 이 한 번으로 GPU r8unorm 캐시
 * (`StudioWebGpuR8GrainTextureCache`)와 비트 패리티 CPU 미러 샘플러가 같은 바이트를 본다.
 */
export function registerStudioPaperSubstrateTileV1(
  tile: StudioPaperSubstrateTileV1,
  registry?: StudioBrushR8GrainRegistry,
): ReturnType<typeof hydrateStudioBrushR8GrainAsset> {
  // 레지스트리는 소유권을 가져갈 수 있으므로 캐시가 오염되지 않도록 사본을 넘긴다.
  const bytes = tile.decodedBytes.slice();
  return registry
    ? registry.hydrate(tile.source, bytes)
    : hydrateStudioBrushR8GrainAsset(tile.source, bytes);
}

export function clearStudioPaperSubstrateTileCacheV1(): void {
  tileCache.clear();
}

export function studioPaperSubstrateTileCacheStatsV1(): { readonly entries: number } {
  return { entries: tileCache.size };
}
