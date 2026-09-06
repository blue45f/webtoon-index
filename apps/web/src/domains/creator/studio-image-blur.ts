/**
 * 분리형(separable) 박스블러 — r/g/b 채널의 로컬 평균(또는 번짐)을 dst(Float32)에 채운다.
 * clarity(중간톤 언샤프용 로컬 평균)와 glow(밝은 레이어 번짐)가 공유하는 순수 함수. 알파는 안 쓴다.
 * 가로→세로 2패스, 표본 좌표는 0..(len-1)로 클램프하므로 반경보다 작은 이미지도 안전하다.
 * src는 원본 픽셀(Uint8ClampedArray) 또는 중간 버퍼(Float32Array), dst는 같은 길이의 Float32 버퍼.
 */
export function boxBlurRgb(
  src: Uint8ClampedArray | Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  r: number,
): void {
  const tmp = new Float32Array(src.length); // 가로 패스 중간 결과(r/g/b만 의미 있음)
  const win = 2 * r + 1;
  const inv = 1 / win;

  // --- 가로 패스: 각 행에서 [x-r, x+r] 합을 슬라이딩 ---
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      // 초기 윈도(왼쪽 끝은 0번 픽셀로 클램프).
      for (let k = -r; k <= r; k++) {
        const sx = k < 0 ? 0 : k >= width ? width - 1 : k;
        sum += src[row + sx * 4 + ch]!;
      }
      tmp[row + ch] = sum * inv;
      for (let x = 1; x < width; x++) {
        const addX = x + r >= width ? width - 1 : x + r;
        const subX = x - r - 1 < 0 ? 0 : x - r - 1;
        sum += src[row + addX * 4 + ch]! - src[row + subX * 4 + ch]!;
        tmp[row + x * 4 + ch] = sum * inv;
      }
    }
  }

  // --- 세로 패스: 각 열에서 [y-r, y+r] 합을 슬라이딩 ---
  const colStride = width * 4;
  for (let x = 0; x < width; x++) {
    const col = x * 4;
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const sy = k < 0 ? 0 : k >= height ? height - 1 : k;
        sum += tmp[sy * colStride + col + ch]!;
      }
      dst[col + ch] = sum * inv;
      for (let y = 1; y < height; y++) {
        const addY = y + r >= height ? height - 1 : y + r;
        const subY = y - r - 1 < 0 ? 0 : y - r - 1;
        sum += tmp[addY * colStride + col + ch]! - tmp[subY * colStride + col + ch]!;
        dst[y * colStride + col + ch] = sum * inv;
      }
    }
  }
}
