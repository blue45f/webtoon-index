/**
 * Studio 비파괴 프로시저럴 레이어 이펙트 수식 모듈.
 *
 * 레이어 픽셀 버퍼에 비파괴 모디파이어(자동 윤곽선 강조, 만화책 톤 망점, 액션 효과 집중선, 색수차)를
 * 실시간 적용하는 순수 데이터 계층 연산기.
 */

export type StudioProceduralModifierType =
  | "autoOutline"
  | "toonHalftone"
  | "speedlines"
  | "chromaticAberration";

export interface StudioAutoOutlineOptions {
  readonly outlineWidth?: number; // 1-8px
  readonly color?: readonly [number, number, number, number]; // RGBA
}

export interface StudioToonHalftoneOptions {
  readonly dotSize?: number; // 2-16px
  readonly angleDeg?: number; // 0-90
}

export interface StudioSpeedlinesOptions {
  readonly centerX?: number; // 0-1 (normalized)
  readonly centerY?: number; // 0-1 (normalized)
  readonly lineCount?: number; // 20-120
  readonly innerRadiusRatio?: number; // 0.1-0.8
}

export interface StudioChromaticAberrationOptions {
  readonly offsetX?: number; // -10 to 10px
  readonly offsetY?: number; // -10 to 10px
}

/**
 * 레이어 픽셀 데이터에 자동 윤곽선(Auto-Outline)을 합성한다.
 */
export function applyStudioAutoOutline(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: StudioAutoOutlineOptions = {},
): Uint8Array {
  const outlineWidth = Math.max(1, Math.min(8, options.outlineWidth ?? 2));
  const color = options.color ?? [0, 0, 0, 255];

  const totalPixels = width * height;
  const alphaMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i += 1) {
    alphaMask[i] = (pixelData[i * 4 + 3] ?? 0) > 30 ? 1 : 0;
  }

  const outlinedMask = new Uint8Array(alphaMask);
  for (let y = outlineWidth; y < height - outlineWidth; y += 1) {
    for (let x = outlineWidth; x < width - outlineWidth; x += 1) {
      const idx = y * width + x;
      if (alphaMask[idx] === 0) {
        let hasAdjacent = false;
        for (let dy = -outlineWidth; dy <= outlineWidth; dy += 1) {
          for (let dx = -outlineWidth; dx <= outlineWidth; dx += 1) {
            if (alphaMask[(y + dy) * width + (x + dx)] === 1) {
              hasAdjacent = true;
              break;
            }
          }
          if (hasAdjacent) break;
        }
        if (hasAdjacent) outlinedMask[idx] = 2; // 2 = outline pixel
      }
    }
  }

  const result = new Uint8Array(pixelData);
  for (let i = 0; i < totalPixels; i += 1) {
    if (outlinedMask[i] === 2) {
      const outIdx = i * 4;
      result[outIdx] = color[0];
      result[outIdx + 1] = color[1];
      result[outIdx + 2] = color[2];
      result[outIdx + 3] = color[3];
    }
  }

  return result;
}

/**
 * 레이어 픽셀 데이터에 만화책 톤 망점(Halftone) 효과를 연산한다.
 */
export function applyStudioToonHalftone(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: StudioToonHalftoneOptions = {},
): Uint8Array {
  const dotSize = Math.max(2, Math.min(16, options.dotSize ?? 6));
  const result = new Uint8Array(pixelData);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const pixIdx = idx * 4;
      const alpha = pixelData[pixIdx + 3] ?? 0;
      if (alpha === 0) continue;

      const cellX = x % dotSize;
      const cellY = y % dotSize;
      const centerX = dotSize / 2;
      const centerY = dotSize / 2;
      const dist = Math.sqrt((cellX - centerX) ** 2 + (cellY - centerY) ** 2);

      const luminance =
        ((pixelData[pixIdx] ?? 0) * 0.299 +
          (pixelData[pixIdx + 1] ?? 0) * 0.587 +
          (pixelData[pixIdx + 2] ?? 0) * 0.114) /
        255;

      const thresholdRadius = (1 - luminance) * (dotSize / 2);
      if (dist > thresholdRadius) {
        result[pixIdx] = Math.min(255, (pixelData[pixIdx] ?? 0) + 60);
        result[pixIdx + 1] = Math.min(255, (pixelData[pixIdx + 1] ?? 0) + 60);
        result[pixIdx + 2] = Math.min(255, (pixelData[pixIdx + 2] ?? 0) + 60);
      }
    }
  }

  return result;
}

/**
 * 집중선(Speedlines) 이펙트 알파 픽셀을 생성한다.
 */
export function generateStudioSpeedlinesMask(
  width: number,
  height: number,
  options: StudioSpeedlinesOptions = {},
): Uint8Array {
  const centerX = (options.centerX ?? 0.5) * width;
  const centerY = (options.centerY ?? 0.5) * height;
  const lineCount = Math.max(10, Math.min(120, options.lineCount ?? 40));
  const innerRadius = Math.min(width, height) * (options.innerRadiusRatio ?? 0.3);

  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > innerRadius) {
        const angle = Math.atan2(dy, dx);
        const normalizedAngle = (angle + Math.PI) / (Math.PI * 2);
        const lineVal = Math.sin(normalizedAngle * lineCount * Math.PI * 2);

        if (lineVal > 0.4) {
          const idx = y * width + x;
          const fade = Math.min(1, (dist - innerRadius) / (innerRadius * 0.5));
          mask[idx] = Math.round(255 * fade);
        }
      }
    }
  }

  return mask;
}
