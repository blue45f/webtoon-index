/**
 * Studio Filter Comparison & Split-Screen Preview Mode
 *
 * CLIP STUDIO PAINT Ver.4.0.0 Parity:
 * - Filter Preview & Comparison Mode (필터 전후 분할 비교 및 다중 프리셋 비교):
 *   - Allows artists to visually compare "Before" (원본) vs "After" (필터 적용본) with an interactive split curtain.
 *   - Supports:
 *     1. Split Horizontal (좌우 분할 커튼)
 *     2. Split Vertical (상하 분할 커튼)
 *     3. Multi-preset comparison (A/B/C/D 후보군 4분할 그리드 비교)
 *   - Renders a lightweight hairline separator with split handle coordinate calculation.
 *
 * Pure, deterministic, zero-dependency.
 */

export type FilterComparisonMode =
  | "split-horizontal"
  | "split-vertical"
  | "side-by-side"
  | "preset-grid";

export interface FilterComparisonConfig {
  readonly mode: FilterComparisonMode;
  readonly splitRatio: number; // 0.0 .. 1.0 (default: 0.5 center)
  readonly showSeparatorLine: boolean;
  readonly separatorColorHex: string; // default: #ffffff
}

export const DEFAULT_FILTER_COMPARISON_CONFIG: FilterComparisonConfig = Object.freeze({
  mode: "split-horizontal",
  splitRatio: 0.5,
  showSeparatorLine: true,
  separatorColorHex: "#ffffff",
});

/**
 * Composites a Before/After split comparison image buffer.
 */
export function compositeFilterSplitComparison(
  originalData: Uint8ClampedArray,
  filteredData: Uint8ClampedArray,
  width: number,
  height: number,
  config: FilterComparisonConfig = DEFAULT_FILTER_COMPARISON_CONFIG,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const ratio = Math.max(0, Math.min(1, config.splitRatio));

  const splitX = Math.round(width * ratio);
  const splitY = Math.round(height * ratio);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Check separator line boundary
      let isSeparator = false;
      if (config.showSeparatorLine) {
        if (config.mode === "split-horizontal" && x === splitX) isSeparator = true;
        if (config.mode === "split-vertical" && y === splitY) isSeparator = true;
      }

      if (isSeparator) {
        out[idx] = 255;
        out[idx + 1] = 255;
        out[idx + 2] = 255;
        out[idx + 3] = 255;
        continue;
      }

      // Determine whether this pixel shows original (Before) or filtered (After)
      const showFiltered =
        config.mode === "split-vertical" ? y >= splitY : x >= splitX;

      const src = showFiltered ? filteredData : originalData;
      out[idx] = src[idx];
      out[idx + 1] = src[idx + 1];
      out[idx + 2] = src[idx + 2];
      out[idx + 3] = src[idx + 3];
    }
  }

  return out;
}

export interface FilterPresetCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly data: Uint8ClampedArray;
}

/**
 * Composites a 2x2 multi-preset candidate preview grid for simultaneous comparison of 4 variations.
 */
export function compositePresetComparisonGrid(
  candidates: readonly FilterPresetCandidate[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);

  // Quadrants:
  // 0: Top-Left (candidate 0 or original)
  // 1: Top-Right (candidate 1)
  // 2: Bottom-Left (candidate 2)
  // 3: Bottom-Right (candidate 3)
  for (let y = 0; y < height; y++) {
    const isBottom = y >= halfH;
    for (let x = 0; x < width; x++) {
      const isRight = x >= halfW;
      const quadIndex = (isBottom ? 2 : 0) + (isRight ? 1 : 0);
      const activeCandidate = candidates[quadIndex] ?? candidates[0];

      const idx = (y * width + x) * 4;
      // 1px dividing lines in center
      if (x === halfW || y === halfH) {
        out[idx] = 240;
        out[idx + 1] = 240;
        out[idx + 2] = 240;
        out[idx + 3] = 255;
      } else if (activeCandidate) {
        out[idx] = activeCandidate.data[idx];
        out[idx + 1] = activeCandidate.data[idx + 1];
        out[idx + 2] = activeCandidate.data[idx + 2];
        out[idx + 3] = activeCandidate.data[idx + 3];
      }
    }
  }

  return out;
}
