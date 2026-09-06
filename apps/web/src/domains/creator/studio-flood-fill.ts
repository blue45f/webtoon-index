// 페인트 통(flood-fill) 채색 — 100% 브라우저(클라이언트) 실행, 서버·토큰 비용 0원.
// 클릭 지점과 같은 색으로 이어진 영역을 스택 기반(비재귀) BFS/DFS 로 찾아 지정 색으로 칠한다.
// 웹툰 컷의 셀 채색(flat color 영역 일괄 칠하기)에 특화 — 브러시로 한 픽셀씩 칠하는 것보다 빠르다.
//
// scanFloodRegionMask 는 이 BFS 의 핵심 스캔부만 떼어낸 순수 함수다(색을 칠하지 않고 매치된
// 픽셀만 표시) — studio-magic-wand.ts 가 "칠하기" 대신 "선택 영역 윤곽 추출"에 재사용한다.
// BFS 자체는 여기 한 곳에만 존재한다(중복 금지).
import { hexToRgb } from "./studio-filters";

function loadImage(src: string, abort?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const cleanup = () => abort?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      img.src = "";
      reject(new DOMException("이미지 불러오기를 취소했습니다.", "AbortError"));
    };
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("이미지를 불러오지 못했습니다."));
    };
    abort?.addEventListener("abort", onAbort, { once: true });
    if (abort?.aborted) {
      onAbort();
      return;
    }
    img.src = src;
  });
}

/** 페인트 통·마술봉이 공유하는 이미지 로더 — data: 가 아니어도 CORS 를 요청해 캔버스 오염을 피한다. */
export { loadImage as loadFloodFillSourceImage };

/**
 * 시작 픽셀과 이어진(4방향 연결) 색상 매치 영역 스캔 — 스택 기반 BFS, 재귀 없음(대형 이미지 스택
 * 오버플로 방지). "방문(visited)"과 "매치(matched)"는 다른 개념이다: 경계 밖 픽셀도 재방문 방지를
 * 위해 visited=1 이 되지만, 색이 다르면(matches 실패) matched 에는 기록되지 않고 그 픽셀에서 더
 * 확장하지도 않는다 — 반환되는 것은 matched 뿐이다(=원래 floodFillImage 가 실제로 칠했던 픽셀 집합).
 * @returns w*h 크기의 0/1 마스크(1 = 이 픽셀이 시작 색과 tolerance 이내로 매치됨).
 */
export function scanFloodRegionMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  startX: number,
  startY: number,
  tolerance = 32,
): Uint8Array {
  const startIdx = (startY * w + startX) * 4;
  const sr = data[startIdx] ?? 0;
  const sg = data[startIdx + 1] ?? 0;
  const sb = data[startIdx + 2] ?? 0;
  const sa = data[startIdx + 3] ?? 0;
  const tol2 = tolerance * tolerance * 3;
  const matches = (i: number): boolean => {
    const dr = data[i]! - sr;
    const dg = data[i + 1]! - sg;
    const db = data[i + 2]! - sb;
    const da = data[i + 3]! - sa;
    return dr * dr + dg * dg + db * db + da * da <= tol2;
  };

  const visited = new Uint8Array(w * h); // BFS 큐잉 방지용(내부 전용) — matched 와는 다르다.
  const matched = new Uint8Array(w * h); // 반환값.
  const stack: number[] = [startY * w + startX];
  visited[startY * w + startX] = 1;

  const maxPixels = w * h;
  let processed = 0;
  while (stack.length > 0) {
    if (processed > maxPixels) break; // 방어적 상한(버그로도 무한루프 방지).
    processed++;
    const pos = stack.pop()!;
    const px = pos % w;
    const py = (pos / w) | 0;
    const idx = pos * 4;
    if (!matches(idx)) continue;
    matched[pos] = 1;
    if (px > 0) {
      const n = pos - 1;
      if (!visited[n]) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (px < w - 1) {
      const n = pos + 1;
      if (!visited[n]) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (py > 0) {
      const n = pos - w;
      if (!visited[n]) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (py < h - 1) {
      const n = pos + w;
      if (!visited[n]) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }
  return matched;
}

/** Yield every this many paint pixels so multi-megapixel flood fills do not monopolize the UI. */
const FLOOD_FILL_PAINT_YIELD_EVERY = 64_000;

/**
 * 페인트 통 채색 — src(데이터 URL 등)에서 (startXRatio, startYRatio) 지점과 같은 색으로 이어진
 * 영역을 fillColorHex 로 칠한 PNG data URL 을 반환한다.
 */
export async function floodFillImage(
  src: string,
  startXRatio: number,
  startYRatio: number,
  fillColorHex: string,
  tolerance = 32,
): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const startX = Math.min(w - 1, Math.max(0, Math.round(startXRatio * w)));
  const startY = Math.min(h - 1, Math.max(0, Math.round(startYRatio * h)));

  const { r: fr, g: fg, b: fb } = hexToRgb(fillColorHex);
  const startIdx = (startY * w + startX) * 4;
  const sr = data[startIdx]!;
  const sg = data[startIdx + 1]!;
  const sb = data[startIdx + 2]!;

  const NEAR_IDENTICAL2 = 3;
  if ((fr - sr) ** 2 + (fg - sg) ** 2 + (fb - sb) ** 2 <= NEAR_IDENTICAL2) {
    return src;
  }

  // Yield once after decode/draw so pointer-up UI can paint before the BFS.
  const { encodeStudioPixelEditCanvasPng, yieldStudioMainThread } = await import("./studio-pixel-edit-async"
  );
  await yieldStudioMainThread();

  const matched = scanFloodRegionMask(data, w, h, startX, startY, tolerance);
  await yieldStudioMainThread();

  const total = w * h;
  let painted = 0;
  for (let pos = 0; pos < total; pos++) {
    if (!matched[pos]) continue;
    const idx = pos * 4;
    data[idx] = fr;
    data[idx + 1] = fg;
    data[idx + 2] = fb;
    painted += 1;
    if (painted % FLOOD_FILL_PAINT_YIELD_EVERY === 0) {
      await yieldStudioMainThread();
    }
  }

  ctx.putImageData(imageData, 0, 0);
  await yieldStudioMainThread();
  // Async PNG encode avoids multi-megapixel main-thread freezes after the BFS paint pass.
  return encodeStudioPixelEditCanvasPng(canvas);
}
