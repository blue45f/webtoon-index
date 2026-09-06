export type StudioLayerBorderEffectType = "outer" | "inner" | "center";

export interface StudioLayerBorderEffectSettings {
  enabled: boolean;
  thickness: number; // 1..32 px
  color: string; // hex #RRGGBB or rgba
  type: StudioLayerBorderEffectType;
  antiAliased?: boolean;
  /** CSP v5.1: Respect semi-transparent pixels on soft/watercolor brush edges */
  respectTransparency?: boolean;
}

/** UI slider bounds — the render path clamps to the same range so 광고와 실제가 같다. */
export const STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE = Object.freeze({
  min: 1,
  max: 32,
});

/** CSP 경계 효과 기본값 — 꺼진 상태로 시작하고, 켜면 검정 3px 바깥 테두리부터. */
export const DEFAULT_STUDIO_LAYER_BORDER_EFFECT: StudioLayerBorderEffectSettings =
  Object.freeze({
    enabled: false,
    thickness: 3,
    color: "#000000",
    type: "outer" as StudioLayerBorderEffectType,
    antiAliased: true,
    respectTransparency: true,
  });

/**
 * 메뉴 '레이어 ▸ 경계 효과…'가 인스펙터의 레이어 탭을 열 때 쏘는 창 이벤트 이름.
 * 메뉴 호스트 시임(StudioPage)은 이 슬라이스가 편집하지 않으므로, 기존
 * `studio-companion-add-text` 관례와 같은 CustomEvent 브리지를 쓴다 — 수신자는
 * StudioInspectorAside 하나다.
 */
export const STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT = "studio-layer-border-effect-open";

/**
 * 메뉴 항목이 부르는 열기 신호 발신기. 메뉴 카탈로그 모듈은 브라우저 전역을 만지면
 * 안 되므로(카탈로그 소유권 경계 테스트) window 접근은 여기 한 곳에만 둔다.
 */
export function requestStudioLayerBorderEffectPanelOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT));
}

const BORDER_EFFECT_TYPES: readonly StudioLayerBorderEffectType[] = ["outer", "inner", "center"];

/**
 * 저장/전송/attrs 왕복 뒤에도 같은 픽셀이 나오도록 절대값으로 정규화한다.
 * 무효 thickness(NaN/음수/0)는 0으로 남겨 항등으로 판정한다 — 기본값으로 올려치면
 * 깨진 설정이 조용히 테두리를 그리는 fail-open이 된다.
 */
export function normalizeStudioLayerBorderEffect(
  value?: Partial<StudioLayerBorderEffectSettings> | null,
): StudioLayerBorderEffectSettings {
  const rawThickness = value?.thickness;
  const thickness =
    typeof rawThickness === "number" && Number.isFinite(rawThickness) && rawThickness > 0
      ? Math.min(
          STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.max,
          Math.max(STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.min, rawThickness),
        )
      : 0;
  const color =
    typeof value?.color === "string" && value.color.trim() !== ""
      ? value.color
      : DEFAULT_STUDIO_LAYER_BORDER_EFFECT.color;
  const type = BORDER_EFFECT_TYPES.includes(value?.type as StudioLayerBorderEffectType)
    ? (value?.type as StudioLayerBorderEffectType)
    : DEFAULT_STUDIO_LAYER_BORDER_EFFECT.type;
  return {
    enabled: value?.enabled === true,
    thickness,
    color,
    type,
    antiAliased: value?.antiAliased !== false,
    respectTransparency: value?.respectTransparency !== false,
  };
}

/** 꺼져 있거나 유효 굵기가 없으면 항등 — 렌더 경로가 필터·캐시를 켜지 않는다. */
export function isIdentityStudioLayerBorderEffect(
  value?: Partial<StudioLayerBorderEffectSettings> | null,
): boolean {
  const normalized = normalizeStudioLayerBorderEffect(value);
  return !normalized.enabled || normalized.thickness <= 0;
}

/**
 * 실루엣 밖으로 자라는 테두리(outer/center)가 Konva 캐시 경계에서 잘리지 않도록
 * 필요한 캐시 offset 패딩(px). inner는 기존 픽셀 안에서만 그린다.
 */
export function studioLayerBorderEffectCachePad(
  value?: Partial<StudioLayerBorderEffectSettings> | null,
): number {
  const normalized = normalizeStudioLayerBorderEffect(value);
  if (!normalized.enabled || normalized.thickness <= 0) return 0;
  if (normalized.type === "inner") return 0;
  return Math.ceil(normalized.thickness) + 1;
}

function parseColor(colorStr: string): { r: number; g: number; b: number; a: number } {
  let r = 0, g = 0, b = 0, a = 255;
  const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else if (hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      a = parseInt(hex.slice(6, 8), 16);
    }
  } else {
    const rgbaMatch = colorStr.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (rgbaMatch) {
      r = parseInt(rgbaMatch[1], 10);
      g = parseInt(rgbaMatch[2], 10);
      b = parseInt(rgbaMatch[3], 10);
      a = rgbaMatch[4] !== undefined ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255;
    }
  }
  return { r, g, b, a };
}

function edt1d(f: Float64Array, dt: Float64Array, n: number, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      if (k < 0) {
        k = 0;
        break;
      }
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const dx = q - v[k];
    dt[q] = dx * dx + f[v[k]];
  }
}

function edt2d(grid: Float64Array, width: number, height: number) {
  const maxDim = Math.max(width, height);
  const f = new Float64Array(maxDim);
  const dt = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      f[x] = grid[offset + x];
    }
    edt1d(f, dt, width, v, z);
    for (let x = 0; x < width; x++) {
      grid[offset + x] = dt[x];
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      f[y] = grid[y * width + x];
    }
    edt1d(f, dt, height, v, z);
    for (let y = 0; y < height; y++) {
      grid[y * width + x] = dt[y];
    }
  }
}

/**
 * 코어 렌더 — `data`(원본 스냅샷)를 읽고 `outData`에 쓴다. `outData`는 호출 시점에
 * 원본과 같은 내용이어야 한다(테두리 밖 픽셀은 건드리지 않으므로).
 * `applyStudioLayerBorderEffect`(복사본 반환)와 in-place 어댑터가 이 하나를 공유한다.
 */
function renderStudioLayerBorderEffect(
  data: Uint8ClampedArray,
  outData: Uint8ClampedArray,
  width: number,
  height: number,
  settings: StudioLayerBorderEffectSettings,
): void {
  const parsedColor = parseColor(settings.color);
  const grid = new Float64Array(width * height);

  const respectTransparency = settings.respectTransparency !== false;
  const THRESHOLD = respectTransparency ? 0 : 127;
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4 + 3];
    if (settings.type === "outer") {
      grid[i] = alpha > THRESHOLD ? 0 : 1e10;
    } else if (settings.type === "inner") {
      grid[i] = alpha <= (respectTransparency ? 127 : THRESHOLD) ? 0 : 1e10;
    } else {
      const x = i % width;
      const y = Math.floor(i / width);
      let isBoundary = false;
      const isInside = alpha > THRESHOLD;

      if (isInside) {
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          isBoundary = true;
        } else {
          const n1 = data[(i - 1) * 4 + 3] > THRESHOLD;
          const n2 = data[(i + 1) * 4 + 3] > THRESHOLD;
          const n3 = data[(i - width) * 4 + 3] > THRESHOLD;
          const n4 = data[(i + width) * 4 + 3] > THRESHOLD;
          if (!n1 || !n2 || !n3 || !n4) isBoundary = true;
        }
      }
      grid[i] = isBoundary ? 0 : 1e10;
    }
  }

  edt2d(grid, width, height);

  const t = settings.thickness;
  const tSq = t * t;

  for (let i = 0; i < width * height; i++) {
    const dSq = grid[i];
    if (dSq <= tSq) {
      const origA = data[i * 4 + 3];
      const isInside = origA > (respectTransparency ? 127 : THRESHOLD);

      let strokeAlpha = 255;
      if (settings.antiAliased) {
        const d = Math.sqrt(dSq);
        if (d > t - 1) {
          strokeAlpha = Math.max(0, Math.min(255, Math.round((t - d) * 255)));
        }
      }

      strokeAlpha = (strokeAlpha * parsedColor.a) / 255;

      if (strokeAlpha > 0) {
        let drawStroke = false;

        if (settings.type === "outer" && !isInside) {
          drawStroke = true;
        } else if (settings.type === "inner" && isInside) {
          drawStroke = true;
        } else if (settings.type === "center") {
          drawStroke = true;
        }

        if (drawStroke) {
          const idx = i * 4;

          if (settings.type === "outer" && origA === 0) {
            // Draw stroke on pure empty area
            outData[idx] = parsedColor.r;
            outData[idx + 1] = parsedColor.g;
            outData[idx + 2] = parsedColor.b;
            outData[idx + 3] = strokeAlpha;
          } else {
            // Semi-transparent pixel or Inner/Center: Composite Stroke and Original
            const origNormA = origA / 255;
            const strokeNormA = strokeAlpha / 255;
            const outNormA = strokeNormA + origNormA * (1 - strokeNormA);

            if (outNormA > 0) {
              outData[idx] = (parsedColor.r * strokeNormA + data[idx] * origNormA * (1 - strokeNormA)) / outNormA;
              outData[idx + 1] = (parsedColor.g * strokeNormA + data[idx + 1] * origNormA * (1 - strokeNormA)) / outNormA;
              outData[idx + 2] = (parsedColor.b * strokeNormA + data[idx + 2] * origNormA * (1 - strokeNormA)) / outNormA;
              outData[idx + 3] = Math.round(outNormA * 255);
            }
          }
        }
      }
    }
  }
}

export function applyStudioLayerBorderEffect(img: ImageData, settings: StudioLayerBorderEffectSettings): ImageData {
  if (!settings.enabled || settings.thickness <= 0) {
    return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  }

  const { width, height, data } = img;
  const outData = new Uint8ClampedArray(data);
  const outImg = new ImageData(outData, width, height);
  renderStudioLayerBorderEffect(data, outData, width, height, settings);
  return outImg;
}

/**
 * DOM `ImageData` 생성자가 없는 컨텍스트(Konva 필터 루프, Worker, vitest)에서도 쓰는
 * in-place 변형 — `{width, height, data}` 표면의 data를 제자리에서 바꾼다.
 */
export interface StudioLayerBorderEffectSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function applyStudioLayerBorderEffectInPlace(
  surface: StudioLayerBorderEffectSurface,
  settings: StudioLayerBorderEffectSettings,
): void {
  if (!settings.enabled || settings.thickness <= 0) return;
  // 원본 스냅샷을 잡아 읽기와 쓰기를 분리한다 — 코어는 data(읽기)/outData(쓰기) 계약.
  const source = surface.data.slice();
  renderStudioLayerBorderEffect(source, surface.data, surface.width, surface.height, settings);
}
