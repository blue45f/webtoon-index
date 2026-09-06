/**
 * Studio Seamless Tile — Krita식 심리스 타일 변환 순수 엔진.
 * 패턴 워크플로(studio-pattern-fill)의 래스터 타일 한 장을 받아
 *  1. buildSeamlessTilePreview — N×M 반복 미리보기 픽셀(타일링 검수용)
 *  2. makeTileSeamless — 고전 wrap-offset-by-half + 십자 이음새 크로스페이드 변환
 *  3. seamVisibilityScore — 맞닿는 반대편 가장자리 픽셀 차이 점수(테스트/패널 readout)
 * 를 제공한다. 전부 결정적(랜덤 없음)·입력 무변이·DOM 무의존 — 픽셀 소스는
 * studio-seamless-tile-raster(브라우저 셸)나 테스트의 합성 버퍼가 주입한다.
 *
 * 변환 원리(고전 오프셋 기법, 축 분리 2패스): 축마다 "반 칸 wrap 이동 후,
 * 원본 가장자리가 만나는 이음새 선을 그 자리에서 연속인 이동 전 픽셀과
 * featherPx 폭 선형 가중치로 크로스페이드"를 가로 → 세로 순서로 적용한다.
 * 1패스는 좌우 이음새를, 2패스는 상하 이음새를 지우는데, 각 패스의 블렌드
 * 가중치가 해당 축 가장자리에서 정확히 0이라(축별 feather ≤ ⌊변/2⌋−1 클램프)
 * 네 가장자리의 wrap 연속성이 feather 값과 무관하게 보존된다 — 십자 한 번에
 * 섞는 min-거리 방식은 세로 이음새 밴드가 상/하 가장자리 행까지 닿아 원본
 * 이음새를 일부 되살리므로 쓰지 않는다.
 */

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/**
 * RGBA 래스터 타일 — DOM ImageData와 구조 호환(순수 모듈이라 직접 참조하지 않음).
 * data 길이는 반드시 width*height*4.
 */
export type SeamlessTileImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** 반복 미리보기 격자 범위 — 1×1(원본)~8×8. 패널 기본은 3×3. */
export const SEAMLESS_PREVIEW_REPEAT_RANGE: { min: number; max: number } = { min: 1, max: 8 };

/** 패널 미리보기 기본 반복 수 — 3×3(가운데 타일의 네 이음새가 전부 보이는 최소 격자). */
export const SEAMLESS_PREVIEW_REPEAT = 3;

/** feather 슬라이더 범위(px) — 0이면 순수 오프셋(크로스페이드 없음). */
export const SEAMLESS_FEATHER_RANGE: { min: number; max: number; step: number } = {
  min: 0,
  max: 16,
  step: 1,
};

/** 기본 feather 폭 — 작은 SVG 타일(12~36px)에서 무늬를 뭉개지 않는 절충값. */
export const DEFAULT_SEAMLESS_FEATHER_PX = 4;

// ---------------------------------------------------------------------------
// 검증·클램프
// ---------------------------------------------------------------------------

function assertTileImage(image: SeamlessTileImage, context: string): void {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1
  ) {
    throw new Error(`${context}: 타일 크기가 잘못되었습니다 (${image.width}×${image.height}).`);
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new Error(`${context}: 픽셀 버퍼 길이가 width×height×4와 다릅니다.`);
  }
}

/** 반복 수를 정수 [1, 8]로 클램프. 비유한수는 1(원본 한 장). */
export function clampSeamlessRepeat(value: number): number {
  if (!Number.isFinite(value)) return SEAMLESS_PREVIEW_REPEAT_RANGE.min;
  return Math.min(
    SEAMLESS_PREVIEW_REPEAT_RANGE.max,
    Math.max(SEAMLESS_PREVIEW_REPEAT_RANGE.min, Math.trunc(value))
  );
}

/**
 * feather 폭 클램프 — 슬라이더 범위 [0, 16] 정수로 자르고, 타일이 주어지면
 * "가장자리 블렌드를 금지하는" 상한(⌊min(w,h)/2⌋ − 1)으로 한 번 더 자른다.
 * makeTileSeamless는 내부적으로 같은 상한을 축별(⌊변/2⌋ − 1)로 적용하므로
 * 어떤 feather에서도 변환 결과의 wrap 연속성(심리스)이 깨지지 않는다.
 * 비유한수는 기본값으로. 패널 readout이 "실제 적용 폭"을 보여줄 때도 쓴다.
 */
export function clampSeamlessFeather(
  value: number,
  image?: Pick<SeamlessTileImage, "width" | "height">
): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : DEFAULT_SEAMLESS_FEATHER_PX;
  const bySlider = Math.min(SEAMLESS_FEATHER_RANGE.max, Math.max(SEAMLESS_FEATHER_RANGE.min, rounded));
  if (image == null) return bySlider;
  const byTile = Math.max(0, Math.floor(Math.min(image.width, image.height) / 2) - 1);
  return Math.min(bySlider, byTile);
}

// ---------------------------------------------------------------------------
// 1. N×M 반복 미리보기
// ---------------------------------------------------------------------------

/**
 * 타일을 cols×rows 격자로 반복한 픽셀을 만든다 — 패널 3×3 미리보기용.
 * out(x, y) = in(x mod w, y mod h). 행 단위 subarray 복사라 타일 하나가
 * 커도(≤96px 관례) 미리보기 생성이 프레임 예산 안에 든다.
 */
export function buildSeamlessTilePreview(
  image: SeamlessTileImage,
  repeat: { cols: number; rows: number }
): SeamlessTileImage {
  assertTileImage(image, "buildSeamlessTilePreview");
  const cols = clampSeamlessRepeat(repeat.cols);
  const rows = clampSeamlessRepeat(repeat.rows);
  const { width, height, data } = image;
  const outWidth = width * cols;
  const outHeight = height * rows;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < outHeight; y += 1) {
    const sourceRowStart = (y % height) * rowBytes;
    const sourceRow = data.subarray(sourceRowStart, sourceRowStart + rowBytes);
    const outRowStart = y * outWidth * 4;
    for (let col = 0; col < cols; col += 1) {
      out.set(sourceRow, outRowStart + col * rowBytes);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

// ---------------------------------------------------------------------------
// 2. 심리스 변환 — 축 분리 2패스(wrap offset by half + 이음새 크로스페이드)
// ---------------------------------------------------------------------------

/** 축 하나의 feather 상한 — 해당 변의 가장자리 픽셀이 블렌드에 절대 닿지 않는 폭. */
function axisFeather(value: number, dimension: number): number {
  return Math.min(clampSeamlessFeather(value), Math.max(0, Math.floor(dimension / 2) - 1));
}

/** out[to..to+3] = mix(buffer[shifted], buffer[original], t) — t=0이면 이동본 그대로. */
function writeMixedPixel(
  out: Uint8ClampedArray,
  to: number,
  buffer: Uint8ClampedArray,
  shifted: number,
  original: number,
  t: number
): void {
  if (t <= 0) {
    out[to] = buffer[shifted]!;
    out[to + 1] = buffer[shifted + 1]!;
    out[to + 2] = buffer[shifted + 2]!;
    out[to + 3] = buffer[shifted + 3]!;
    return;
  }
  const keep = 1 - t;
  out[to] = Math.round(buffer[shifted]! * keep + buffer[original]! * t);
  out[to + 1] = Math.round(buffer[shifted + 1]! * keep + buffer[original + 1]! * t);
  out[to + 2] = Math.round(buffer[shifted + 2]! * keep + buffer[original + 2]! * t);
  out[to + 3] = Math.round(buffer[shifted + 3]! * keep + buffer[original + 3]! * t);
}

/**
 * 타일을 심리스로 변환한 새 타일을 돌려준다(입력 무변이, 결정적).
 * 패스 1(가로): 반 칸(⌊w/2⌋) wrap 이동 — 이동본의 좌우 가장자리는 원본 내부의
 *   이웃 열이라 타일링 시 자연스럽게 이어진다. 원본 좌우 가장자리가 만나는
 *   세로 이음새 선(x = w−⌊w/2⌋)은, 그 좌표에서 가로로 연속인 이동 전 픽셀을
 *   선형 가중치 t(이음새 위 1 → featherPx 밖 0)로 섞어 숨긴다.
 * 패스 2(세로): 패스 1 결과에 같은 절차를 세로 방향으로 적용한다. 패스 1이
 *   모든 행에서 좌우 wrap 연속을 만들었으므로 세로 블렌드가 이를 깨지 않는다.
 * featherPx는 축별로 [0, ⌊변/2⌋−1] 클램프 — 0이면 그 축은 순수 오프셋.
 */
export function makeTileSeamless(
  image: SeamlessTileImage,
  options: { featherPx: number }
): SeamlessTileImage {
  assertTileImage(image, "makeTileSeamless");
  const { width, height, data: source } = image;
  const shiftX = Math.floor(width / 2);
  const shiftY = Math.floor(height / 2);
  const featherX = axisFeather(options.featherPx, width);
  const featherY = axisFeather(options.featherPx, height);

  // 패스 1 — 가로: horizontal(x, y) = mix(src((x+shiftX)%w, y), src(x, y), t(dx))
  const horizontal = new Uint8ClampedArray(source.length);
  const seamX = width - shiftX;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(x + 0.5 - seamX);
      const t = featherX > 0 && dx < featherX ? 1 - dx / featherX : 0;
      const to = (rowStart + x) * 4;
      writeMixedPixel(horizontal, to, source, (rowStart + ((x + shiftX) % width)) * 4, to, t);
    }
  }

  // 패스 2 — 세로: out(x, y) = mix(horizontal(x, (y+shiftY)%h), horizontal(x, y), t(dy))
  const out = new Uint8ClampedArray(source.length);
  const seamY = height - shiftY;
  for (let y = 0; y < height; y += 1) {
    const dy = Math.abs(y + 0.5 - seamY);
    const t = featherY > 0 && dy < featherY ? 1 - dy / featherY : 0;
    const shiftedRowStart = ((y + shiftY) % height) * width;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      const to = (rowStart + x) * 4;
      writeMixedPixel(out, to, horizontal, (shiftedRowStart + x) * 4, to, t);
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// 3. 이음새 가시성 점수
// ---------------------------------------------------------------------------

function wrapPairDiff(data: Uint8ClampedArray, a: number, b: number): number {
  return (
    (Math.abs(data[a]! - data[b]!) +
      Math.abs(data[a + 1]! - data[b + 1]!) +
      Math.abs(data[a + 2]! - data[b + 2]!) +
      Math.abs(data[a + 3]! - data[b + 3]!)) /
    (4 * 255)
  );
}

/**
 * 이음새 가시성 점수 ∈ [0, 1] — 타일링 시 맞닿는 반대편 가장자리 픽셀쌍
 * (오른쪽 끝 열 ↔ 왼쪽 첫 열, 아래 끝 행 ↔ 위 첫 행)의 RGBA 평균 절대차.
 * 0이면 가장자리가 완전히 이어지고, 클수록 이음새가 도드라진다.
 * 한 변이 1px이면 그 방향은 자기 자신과 비교되어 자연히 0이 된다.
 */
export function seamVisibilityScore(image: SeamlessTileImage): number {
  assertTileImage(image, "seamVisibilityScore");
  const { width, height, data } = image;
  let sum = 0;
  let pairs = 0;
  for (let y = 0; y < height; y += 1) {
    const left = y * width * 4;
    const right = (y * width + (width - 1)) * 4;
    sum += wrapPairDiff(data, left, right);
    pairs += 1;
  }
  for (let x = 0; x < width; x += 1) {
    const top = x * 4;
    const bottom = ((height - 1) * width + x) * 4;
    sum += wrapPairDiff(data, top, bottom);
    pairs += 1;
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/** 점수 → 패널 readout 문자열("3.2%") — [0,1] 클램프 후 소수 첫째 자리 백분율. */
export function formatSeamScore(score: number): string {
  const safe = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
  return `${(Math.round(safe * 1000) / 10).toFixed(1)}%`;
}
