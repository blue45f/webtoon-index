/**
 * Studio 스마트 갭 클로징(Gap-Closing) 채색 버킷 모듈.
 *
 * 펜 선이 미세하게 뚫려있어(터진 선) 페인트 페인트가 패널 외부로 새어나가는 현상을 방지하기 위해,
 * 지정된 갭 반경(gapRadius px) 내의 열린 윤곽선 구멍을 미리 가상 밀폐(Seal)한 후 칠 구역을 추출한다.
 */

export interface StudioSmartGapFillOptions {
  /** 윤곽선 세기 판단 임계값 (0–255). 기본값 32. */
  readonly lineThreshold?: number;
  /** 갭 클로징 최대 반경(px). 1–16. 기본값 4. */
  readonly gapRadius?: number;
  /** 허용 색상 오차(0–255). 기본값 16. */
  readonly colorTolerance?: number;
  /** 윤곽선 아래 안쪽으로 확장(Expand/Bleed px). 0–8. 기본값 1. */
  readonly expandPx?: number;
}

export interface StudioSmartGapFillResult {
  /** 칠해진 마스크 픽셀 배열 (width × height, 0 또는 255). */
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** 메우기 성공한 갭 구멍 개수. */
  readonly sealedGapCount: number;
  /** 채워진 총 픽셀 수. */
  readonly filledPixelCount: number;
}

/**
 * 2D RGBA 픽셀 버퍼에서 (startX, startY) 좌표 기준 갭 클로징 페인트 마스크를 생성한다.
 */
export function computeStudioSmartGapFillMask(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  options: StudioSmartGapFillOptions = {},
): StudioSmartGapFillResult {
  const lineThreshold = options.lineThreshold ?? 32;
  const gapRadius = Math.max(1, Math.min(16, options.gapRadius ?? 4));
  const colorTolerance = Math.max(0, Math.min(255, options.colorTolerance ?? 16));
  const expandPx = Math.max(0, Math.min(8, options.expandPx ?? 1));

  const totalPixels = width * height;
  const isBoundary = new Uint8Array(totalPixels);

  // 1단계: 선화(Boundary) 픽셀 식별 (알파가 높거나 어두운 픽셀)
  for (let i = 0; i < totalPixels; i += 1) {
    const idx = i * 4;
    const r = pixelData[idx] ?? 0;
    const g = pixelData[idx + 1] ?? 0;
    const b = pixelData[idx + 2] ?? 0;
    const a = pixelData[idx + 3] ?? 0;

    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (a > 128 && brightness < 255 - lineThreshold) {
      isBoundary[i] = 1;
    }
  }

  // 2단계: 터진 선 갭(Gap) 감지 및 가상 브릿지 연결 (Sealing)
  let sealedGapCount = 0;
  const sealedBoundaries = new Uint8Array(isBoundary);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (isBoundary[idx] === 1) continue;

      // 직교 방향(가로/세로) 탐색하여 가까운 반대편 윤곽선 픽셀(gapRadius 이내) 연결
      let isBridge = false;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        let posDist = 0;
        let negDist = 0;

        for (let r = 1; r <= gapRadius; r += 1) {
          const px1 = x + dx * r;
          const py1 = y + dy * r;
          const px2 = x - dx * r;
          const py2 = y - dy * r;

          if (posDist === 0 && px1 >= 0 && px1 < width && py1 >= 0 && py1 < height) {
            if (isBoundary[py1 * width + px1] === 1) posDist = r;
          }
          if (negDist === 0 && px2 >= 0 && px2 < width && py2 >= 0 && py2 < height) {
            if (isBoundary[py2 * width + px2] === 1) negDist = r;
          }
        }

        if (posDist > 0 && negDist > 0 && posDist + negDist <= gapRadius + 1) {
          isBridge = true;
          break;
        }
      }

      if (isBridge) {
        sealedBoundaries[idx] = 1;
        sealedGapCount += 1;
      }
    }
  }

  // 3단계: BFS Flood Fill 탐색
  const mask = new Uint8Array(totalPixels);
  const targetIdx = Math.floor(startY) * width + Math.floor(startX);
  if (targetIdx < 0 || targetIdx >= totalPixels || sealedBoundaries[targetIdx] === 1) {
    return { mask, width, height, sealedGapCount, filledPixelCount: 0 };
  }

  const startR = pixelData[targetIdx * 4] ?? 0;
  const startG = pixelData[targetIdx * 4 + 1] ?? 0;
  const startB = pixelData[targetIdx * 4 + 2] ?? 0;
  const startA = pixelData[targetIdx * 4 + 3] ?? 0;

  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;

  queue[tail] = targetIdx;
  tail += 1;
  mask[targetIdx] = 255;
  let filledPixelCount = 1;

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const cx = current % width;
    const cy = Math.floor(current / width);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (mask[nIdx] === 0 && sealedBoundaries[nIdx] === 0) {
          const pr = pixelData[nIdx * 4] ?? 0;
          const pg = pixelData[nIdx * 4 + 1] ?? 0;
          const pb = pixelData[nIdx * 4 + 2] ?? 0;
          const pa = pixelData[nIdx * 4 + 3] ?? 0;

          const diff =
            Math.abs(pr - startR) +
            Math.abs(pg - startG) +
            Math.abs(pb - startB) +
            Math.abs(pa - startA);

          if (diff <= colorTolerance * 4) {
            mask[nIdx] = 255;
            queue[tail] = nIdx;
            tail += 1;
            filledPixelCount += 1;
          }
        }
      }
    }
  }

  // 4단계: Expand / Bleed (안쪽 확장 처리)
  if (expandPx > 0 && filledPixelCount > 0) {
    const expandedMask = new Uint8Array(mask);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (mask[idx] === 255) {
          for (let ey = -expandPx; ey <= expandPx; ey += 1) {
            for (let ex = -expandPx; ex <= expandPx; ex += 1) {
              const px = x + ex;
              const py = y + ey;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                expandedMask[py * width + px] = 255;
              }
            }
          }
        }
      }
    }
    return { mask: expandedMask, width, height, sealedGapCount, filledPixelCount };
  }

  return { mask, width, height, sealedGapCount, filledPixelCount };
}
