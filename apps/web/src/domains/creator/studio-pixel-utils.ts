/**
 * Studio Pixel Utils
 * studio-* 픽셀 필터 모듈들이 공유하는 순수 픽셀 헬퍼 모음.
 *   clampCoord:     좌표를 [0, n-1]로 클램프(비유한 좌표는 0 고정 — NaN이 데이터를 0으로 뭉개는 버그 방지).
 *   lumaAt:         스냅샷에서 한 픽셀의 Rec.601 휘도(0..255)를 읽는다.
 *   sobelMagnitude: 미리 클램프된 3x3 이웃 좌표로 소벨 기울기 크기(mag)를 구한다(외곽선/포토카피 공유).
 * Konva/DOM 의존 없음 — 캔버스 로직과 단위 테스트가 공유한다. 모두 결정적(랜덤·Date 없음).
 */

// 좌표를 [0, n-1]로 클램프. 비유한(NaN/±Infinity)은 0으로 고정해
// Math.floor(NaN) 인덱싱이 데이터(특히 알파)를 0으로 뭉개는 버그를 막는다.
export function clampCoord(v: number, n: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  const max = n - 1;
  return v > max ? max : v;
}

// 스냅샷에서 (x,y) 픽셀의 Rec.601 휘도(0..255)를 읽는다. 좌표는 호출 전 클램프 가정.
export function lumaAt(src: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
}

/**
 * 소벨(Sobel) 기울기 크기 — 이미 클램프된 3x3 이웃 좌표(가로 xm,x,xp / 세로 ym,y,yp)에서
 * 8방향 휘도를 읽어 Gx/Gy를 구하고 sqrt(gx²+gy²)를 돌려준다. 호출자가 거리(d)만큼 벌린
 * 좌표를 넘기므로 거리 1(포토카피)·거리 d(외곽선) 양쪽을 같은 식으로 다룬다.
 */
export function sobelMagnitude(
  src: Uint8ClampedArray,
  width: number,
  xm: number,
  x: number,
  xp: number,
  ym: number,
  y: number,
  yp: number
): number {
  // 3x3 이웃 휘도.
  const tl = lumaAt(src, width, xm, ym);
  const tc = lumaAt(src, width, x, ym);
  const tr = lumaAt(src, width, xp, ym);
  const ml = lumaAt(src, width, xm, y);
  const mr = lumaAt(src, width, xp, y);
  const bl = lumaAt(src, width, xm, yp);
  const bc = lumaAt(src, width, x, yp);
  const br = lumaAt(src, width, xp, yp);
  // 소벨 수평/수직 기울기 → 크기(mag).
  const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
  const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
  return Math.sqrt(gx * gx + gy * gy);
}
