/**
 * VRM 텍스처 페인팅 — UV 심 블리딩(딜레이션 / edge padding).
 *
 * UV 아일랜드 경계까지 칠하면, 밉맵과 바이리니어 필터가 아일랜드 **바깥**(거터) 텍셀까지
 * 섞어 읽는다. 거터가 비어 있으면 모델 표면에 심을 따라 밝은/투명한 선이 그어진다.
 * 해결책은 업계 표준인 edge padding: 칠해진 색을 경계 바깥으로 N 텍셀 밀어낸다.
 *
 * 의미론(테스트로 고정):
 *  - 패스 1 회당 정확히 한 링만 자란다(더블 버퍼링). N 패스 후 칠해진 텍셀에서 체비쇼프
 *    거리 N 이내의 빈 텍셀이 채워지고, N+1 은 채워지지 않는다.
 *  - 채우는 색은 이웃 중 "칠해진" 텍셀들의 **알파 가중 평균 색**, 알파는 그 이웃들의 **최댓값**.
 *    평균 알파를 쓰면 거터가 서서히 흐려져 심이 다시 보인다 — 거터는 경계 불투명도를 그대로
 *    연장해야 한다.
 *  - 이미 칠해진 텍셀(alpha > threshold)은 **절대** 바뀌지 않는다(비파괴).
 */

import {
  clipStudioVrmTextureRect,
  isStudioVrmTextureBuffer,
  isStudioVrmTextureRectEmpty,
  readStudioVrmTextureRegion,
} from "./studio-vrm-texture-paint-ops";
import {
  isStudioVrmTextureSize,
  type StudioVrmTextureRect,
  type StudioVrmTextureSize,
} from "./studio-vrm-texture-uv";

/** 한 번에 허용하는 최대 패스 수. 그 이상은 거터가 아니라 뭉개기다. */
export const STUDIO_VRM_TEXTURE_DILATE_MAX_PASSES = 32;

export interface StudioVrmTextureDilateOptions {
  /** 기본 4 텍셀. 밉 체인을 쓰는 4K 아틀라스는 4~8 이 무난하다. */
  readonly passes?: number;
  /** 채울 대상 영역(획의 더티 rect). 미지정이면 텍스처 전체. */
  readonly rect?: StudioVrmTextureRect;
  /** repeat 텍스처에서 U/V 경계 너머 이웃까지 참조한다(이 경우 작업 영역은 전체가 된다). */
  readonly wrapEdges?: boolean;
  /** 이 값 초과 알파를 "칠해짐"으로 본다. 기본 0. */
  readonly alphaThreshold?: number;
}

export interface StudioVrmTextureDilateResult {
  /** `data` 가 덮는 영역(입력 rect 를 passes 만큼 확장 후 텍스처로 클리핑). */
  readonly rect: StudioVrmTextureRect;
  /** rect 크기의 새 RGBA 버퍼. 원본은 변경되지 않는다. */
  readonly data: Uint8ClampedArray;
  readonly filledTexels: number;
  readonly passes: number;
}

function normalizedPasses(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 4;
  return Math.max(0, Math.min(STUDIO_VRM_TEXTURE_DILATE_MAX_PASSES, Math.floor(value)));
}

function normalizedThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(254, Math.floor(value)));
}

/**
 * 획의 더티 영역 주변만 딜레이션한다. 4K 텍스처 전체를 매 획마다 복사하지 않기 위한 기본 경로.
 * 반환된 `data` 를 `writeStudioVrmTextureRegion` 으로 되쓰면 된다.
 */
export function dilateStudioVrmTextureRegion(
  source: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  options: StudioVrmTextureDilateOptions = {},
): StudioVrmTextureDilateResult | null {
  if (!isStudioVrmTextureSize(size)) return null;
  if (!isStudioVrmTextureBuffer(source, size)) return null;

  const passes = normalizedPasses(options.passes);
  const threshold = normalizedThreshold(options.alphaThreshold);
  const wrapEdges = options.wrapEdges === true;
  const fullRect: StudioVrmTextureRect = { x: 0, y: 0, width: size.width, height: size.height };

  const requested = options.rect ? clipStudioVrmTextureRect(options.rect, size) : fullRect;
  if (isStudioVrmTextureRectEmpty(requested)) return null;

  // wrap 이면 채움이 반대쪽 경계로 넘어갈 수 있어 작업 영역을 좁힐 수 없다.
  const rect = wrapEdges
    ? fullRect
    : clipStudioVrmTextureRect(
        {
          x: requested.x - passes,
          y: requested.y - passes,
          width: requested.width + passes * 2,
          height: requested.height + passes * 2,
        },
        size,
      );
  if (isStudioVrmTextureRectEmpty(rect)) return null;

  const read = readStudioVrmTextureRegion(source, size, rect);
  if (!read) return null;
  if (passes === 0) {
    return { rect, data: read, filledTexels: 0, passes: 0 };
  }

  let current: Uint8ClampedArray = read;
  let next: Uint8ClampedArray = new Uint8ClampedArray(current.length);
  let filledTexels = 0;

  const sampleAlpha = (x: number, y: number): number => {
    // 작업 영역 안이면 이번 패스 이전 상태(current), 밖이면 원본(딜레이션 대상이 아님).
    let sx = x;
    let sy = y;
    if (wrapEdges) {
      sx = ((x % size.width) + size.width) % size.width;
      sy = ((y % size.height) + size.height) % size.height;
    } else if (sx < 0 || sy < 0 || sx >= size.width || sy >= size.height) {
      return -1;
    }
    if (sx >= rect.x && sy >= rect.y && sx < rect.x + rect.width && sy < rect.y + rect.height) {
      return current[((sy - rect.y) * rect.width + (sx - rect.x)) * 4 + 3]!;
    }
    return source[(sy * size.width + sx) * 4 + 3]!;
  };

  const sampleOffset = (x: number, y: number): { buffer: Uint8ClampedArray; offset: number } => {
    let sx = x;
    let sy = y;
    if (wrapEdges) {
      sx = ((x % size.width) + size.width) % size.width;
      sy = ((y % size.height) + size.height) % size.height;
    }
    if (sx >= rect.x && sy >= rect.y && sx < rect.x + rect.width && sy < rect.y + rect.height) {
      return { buffer: current, offset: ((sy - rect.y) * rect.width + (sx - rect.x)) * 4 };
    }
    return { buffer: source, offset: (sy * size.width + sx) * 4 };
  };

  for (let pass = 0; pass < passes; pass += 1) {
    next.set(current);
    let filledThisPass = 0;
    for (let row = 0; row < rect.height; row += 1) {
      for (let column = 0; column < rect.width; column += 1) {
        const offset = (row * rect.width + column) * 4;
        if (current[offset + 3]! > threshold) continue;

        let weight = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        let maxAlpha = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = rect.x + column + dx;
            const ny = rect.y + row + dy;
            const alpha = sampleAlpha(nx, ny);
            if (alpha <= threshold) continue;
            const neighbour = sampleOffset(nx, ny);
            red += neighbour.buffer[neighbour.offset]! * alpha;
            green += neighbour.buffer[neighbour.offset + 1]! * alpha;
            blue += neighbour.buffer[neighbour.offset + 2]! * alpha;
            weight += alpha;
            if (alpha > maxAlpha) maxAlpha = alpha;
          }
        }
        if (weight <= 0) continue;
        next[offset] = Math.round(red / weight);
        next[offset + 1] = Math.round(green / weight);
        next[offset + 2] = Math.round(blue / weight);
        next[offset + 3] = maxAlpha;
        filledThisPass += 1;
      }
    }
    filledTexels += filledThisPass;
    const swap = current;
    current = next;
    next = swap;
    if (filledThisPass === 0) {
      return { rect, data: current, filledTexels, passes: pass + 1 };
    }
  }

  return { rect, data: current, filledTexels, passes };
}

/** 텍스처 전체를 딜레이션한 새 버퍼. 편의 경로이며, 획 단위에서는 region 버전을 쓴다. */
export function dilateStudioVrmTexture(
  source: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  options: Omit<StudioVrmTextureDilateOptions, "rect"> = {},
): Uint8ClampedArray | null {
  const result = dilateStudioVrmTextureRegion(source, size, options);
  return result ? result.data : null;
}
