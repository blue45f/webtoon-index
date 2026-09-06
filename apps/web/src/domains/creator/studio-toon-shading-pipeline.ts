/**
 * Studio 2D 툰 셰이딩(Toon Shading) & Ramp Light 파이프라인 모듈.
 *
 * 3D 입체 음영을 2D 애니메이션/웹툰 스타일의 경계가 명확한 2톤/3톤 컬러 덩어리 및
 * 외곽 림라이트(Rim Light) 하이라이트로 정밀 합성하는 셰이딩 파이프라인 연산기.
 */

export interface StudioToonShadingOptions {
  /** 톤 단계 (2 = 2톤 셀 셰이딩, 3 = 3톤 만화 셰이딩). 기본값 2. */
  readonly rampBands?: 2 | 3;
  /** 명암 경계 컷오프 (0.1~0.9). 기본값 0.4. */
  readonly shadowThreshold?: number;
  /** 림라이트(Rim Light) 강조 여부. 기본값 true. */
  readonly enableRimLight?: boolean;
  /** 림라이트 세기 (0~1). 기본값 0.5. */
  readonly rimIntensity?: number;
  /** 림라이트 컬러 (RGBA). 기본값 하얀색 [255, 255, 255, 255]. */
  readonly rimColor?: readonly [number, number, number, number];
}

export interface StudioToonShadingResult {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * RGBA 픽셀 및 법선(Normal) 버퍼에 툰 셰이딩 램프 조명을 합성한다.
 */
export function applyStudioToonShading(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  lightDir: readonly [number, number, number] = [0.577, 0.577, 0.577],
  options: StudioToonShadingOptions = {},
): StudioToonShadingResult {
  const rampBands = options.rampBands ?? 2;
  const shadowThreshold = options.shadowThreshold ?? 0.4;
  const enableRimLight = options.enableRimLight ?? true;
  const rimIntensity = options.rimIntensity ?? 0.5;
  const rimColor = options.rimColor ?? [255, 255, 255, 255];

  const totalPixels = width * height;
  const rgba = new Uint8Array(totalPixels * 4);

  // Normalize light direction vector
  const len = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2) || 1;
  const lx = lightDir[0] / len;
  const ly = lightDir[1] / len;
  const lz = lightDir[2] / len;

  for (let i = 0; i < totalPixels; i += 1) {
    const idx = i * 4;
    const r = pixelData[idx] ?? 0;
    const g = pixelData[idx + 1] ?? 0;
    const b = pixelData[idx + 2] ?? 0;
    const a = pixelData[idx + 3] ?? 0;

    if (a < 10) {
      rgba[idx + 3] = 0;
      continue;
    }

    // Pseudo normal estimation from pixel gradient
    const x = i % width;
    const y = Math.floor(i / width);
    const nx = (x / width - 0.5) * 2;
    const ny = (y / height - 0.5) * 2;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

    // N · L Lambertian dot product
    const dot = nx * lx + ny * ly + nz * lz;
    const NdotL = (dot + 1) / 2; // Remap -1..1 to 0..1

    // Step function for Toon Ramp Bands
    let shadeFactor: number;
    if (rampBands === 2) {
      shadeFactor = NdotL < shadowThreshold ? 0.6 : 1.0;
    } else if (NdotL < shadowThreshold * 0.7) {
      shadeFactor = 0.5;
    } else if (NdotL < shadowThreshold * 1.2) {
      shadeFactor = 0.75;
    } else {
      shadeFactor = 1.0;
    }

    // Rim light calculation
    let rimFactor = 0;
    if (enableRimLight) {
      const vDotN = 1 - nz; // Fresnel approximation
      if (vDotN > 0.6 && NdotL > 0.2) {
        rimFactor = Math.pow(vDotN, 3) * rimIntensity;
      }
    }

    rgba[idx] = Math.min(255, Math.round(r * shadeFactor + rimColor[0] * rimFactor));
    rgba[idx + 1] = Math.min(255, Math.round(g * shadeFactor + rimColor[1] * rimFactor));
    rgba[idx + 2] = Math.min(255, Math.round(b * shadeFactor + rimColor[2] * rimFactor));
    rgba[idx + 3] = a;
  }

  return { rgba, width, height };
}
