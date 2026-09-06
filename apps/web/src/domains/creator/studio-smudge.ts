/**
 * Studio Smudge — "문지르기" 브러시 순수 코어.
 * 스트로크를 따라 꼬리(이전) 픽셀 색을 머리(현재) 픽셀에 섞어 넣어, 손가락으로 문지른 듯한
 * 블렌드를 만든다. studio-brush.ts 의 점 처리 관례(리샘플·최소 간격)를 따르고,
 * studio-flood-fill.ts/studio-magic-wand.ts 의 로더·좌표 반전 헬퍼를 재사용한다(중복 금지).
 *
 * DOM 의존성 없음 — 이 파일 전체가 순수하다. 캔버스/Image/Worker 오케스트레이션(smudgeStrokeImage)은
 * studio-smudge-browser.ts 가 담당한다(studio-magic-wand.ts/studio-magic-wand-browser.ts 와
 * 동일한 분리 — Worker 클라이언트가 이 파일을 폴백용으로 import해야 하는데, 오케스트레이션
 * 함수가 여기 있으면 다시 Worker 클라이언트를 import해 순환 참조가 된다).
 */

// 픽셀 공간(원본 자연 해상도) 좌표 — SelPoint(정규화 0..1)와는 다른 개념이니 재사용 금지.
export type SmudgePixelPoint = { x: number; y: number };

export const SMUDGE_RADIUS_RANGE = { min: 8, max: 120, step: 1 } as const; // 캔버스 표시 px
// SELECTION_BRUSH_RADIUS_DEFAULT 와 동일값(다른 픽셀 브러시류와 첫 느낌 통일).
export const SMUDGE_RADIUS_DEFAULT = 28;
export const SMUDGE_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const; // %(UI); 코어엔 /100 한 0..1 로 넘긴다
export const SMUDGE_STRENGTH_DEFAULT = 45;

// 리샘플 간격 = radiusPx * 이 비율. 촘촘할수록(작을수록) 부드럽지만 스텝(=쓰기 패스) 수가 늘어 느려진다.
const SMUDGE_STEP_RATIO = 0.35;
// 병적으로 길거나 루프도는 스트로크 방어 상한 — MAGIC_WAND_MAX_LOOPS 와 같은 정신의 안전판.
const SMUDGE_MAX_RESAMPLED_POINTS = 2000;

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 0..255 채널 선형 보간 — Uint8ClampedArray 대입 시 자동으로 반올림+클램프된다. */
function lerpChannel(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 프리멀티플라이드 결과 알파가 이 값 이하이면 색을 되돌리지 않고 0으로 둔다.
 * 8비트 알파 한 계단(1/255 ≈ 0.0039)보다 작아, 보이는 픽셀을 0으로 만들지 않는다.
 */
const SMUDGE_PREMULTIPLY_EPSILON = 1 / 1020;

/**
 * 폴리라인을 일정 간격(step, 픽셀)으로 리샘플 — screentoneDotsForStroke(studio-brush.ts)와 동일 기법.
 * 0/1점 입력은 그대로 반환. 순수, 결정적. 길이 0인(정지된 두 점 사이) 구간은 건너뛰어 중복/NaN
 * 점을 만들지 않는다. 결과는 SMUDGE_MAX_RESAMPLED_POINTS 개로 상한(병적으로 길거나 루프도는 입력 방어).
 */
export function resampleSmudgePath(points: readonly SmudgePixelPoint[], step: number): SmudgePixelPoint[] {
  if (points.length < 2) return points.slice();
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;

  const out: SmudgePixelPoint[] = [points[0]!];
  let prev = points[0]!;
  let carried = 0;

  for (let i = 1; i < points.length; i++) {
    const curr = points[i]!;
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen === 0) continue; // 정지 구간 — 중복점 방지를 위해 그냥 건너뛴다(prev 유지).

    let traveled = safeStep - carried;
    while (traveled <= segLen) {
      const t = traveled / segLen;
      out.push({ x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t });
      if (out.length >= SMUDGE_MAX_RESAMPLED_POINTS) return out;
      traveled += safeStep;
    }
    carried = segLen - (traveled - safeStep);
    prev = curr;
  }

  const last = out[out.length - 1]!;
  const finalPt = points[points.length - 1]!;
  if ((last.x !== finalPt.x || last.y !== finalPt.y) && out.length < SMUDGE_MAX_RESAMPLED_POINTS) {
    out.push(finalPt);
  }
  return out;
}

/**
 * 브러시 중심에서 (dx,dy) 만큼 떨어진 픽셀의 블렌드 가중치(0..1) — 부드러운(2차) 원형 감쇠.
 * 하드 서클(스탬프)이 아니라 소프트 에지를 쓰는 이유: "손가락으로 문지른 듯" 이라는 목표에는
 * 경계가 뚝 끊기는 스탬프보다, 페더 선택·글로우 등 이 앱이 이미 쓰는 "부드러운 경계" 미학이
 * 더 어울린다. radiusPx 이상이면 0. 순수.
 */
export function smudgeBrushWeight(dx: number, dy: number, radiusPx: number): number {
  const r = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
  if (r <= 0) return 0;
  // Math.hypot 는 정확하지만 dab 내 픽셀마다 호출되는 이 루프에서는 측정 가능한 병목이다.
  // 제곱거리로 먼저 잘라내고(Math.hypot 대비 수 배 빠름) 안쪽 원에만 sqrt 를 쓴다.
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= r * r) return 0;
  const dist = Math.sqrt(dist2);
  const t = 1 - dist / r; // 0..1, 1=중심
  return t * t;
}

/**
 * 문지르기 코어 — data(RGBA Uint8ClampedArray, w*h*4)를 제자리에서 변형하고 같은 참조를 반환한다
 * (scanFloodRegionMask 관례와 동일 — 호출부가 imageData.data 를 그대로 넘기고 그대로 쓴다).
 *
 * points 는 리샘플 전 원시 스트로크(자연 픽셀 좌표, 화면에서 반전이 이미 걷힌 상태로 넘어와야
 * 한다 — 반전 처리는 wrapper 책임). points.length < 2 또는 strength <= 0 또는 radiusPx <= 0 이면
 * 그냥 data 를 반환한다(무변화, No-op).
 *
 * 알고리즘: resampleSmudgePath 로 균등 간격 점을 얻은 뒤, 연속한 두 점(prev→curr)마다 curr 중심
 * 반경 radiusPx 원 내부의 각 픽셀에 대해:
 *   1) 같은 오프셋만큼 prev 쪽으로 당긴 "소스" 좌표를 계산(클램프-투-엣지).
 *   2) 이번 스텝이 읽을 소스 영역 전체를 쓰기 전에 먼저 스냅샷한다(**필수** — 안 그러면 같은
 *      스텝 안에서 방금 쓴 픽셀을 다시 읽어버려 스캔 방향으로 치우친 줄무늬 아티팩트가 생긴다).
 *   3) dest = lerp(현재 dest 색, 스냅샷된 소스 색, strength * smudgeBrushWeight(...)) — r/g/b/a 4채널 모두.
 * 다음 스텝은 이전 스텝이 써 놓은 값을 다시 소스로 읽을 수 있어(제자리 누적), 드래그가 길어질수록
 * 색이 꼬리에서 머리로 밀려나가는 핑거페인팅 효과가 만들어진다.
 */
export function smudgeStroke(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  points: readonly SmudgePixelPoint[],
  radiusPx: number,
  strength: number,
): Uint8ClampedArray {
  if (points.length < 2 || strength <= 0) return data;
  // sanitizePositive(studio-node-edit.ts) 와 동일한 정신 — 비양수/NaN 반경은 최소 1px 로.
  const safeRadius = Number.isFinite(radiusPx) ? Math.max(1, radiusPx) : 1;
  if (w <= 0 || h <= 0) return data;

  const step = safeRadius * SMUDGE_STEP_RATIO;
  // resampleSmudgePath 자체가 SMUDGE_MAX_RESAMPLED_POINTS 에서 먼저 잘라 반환하므로
  // 여기서 다시 slice 하면 스트로크마다 최대 2000점 짜리 배열을 한 번 더 복사하는 셈이다.
  const resampled = resampleSmudgePath(points, step);
  if (resampled.length < 2) return data; // 리샘플 후 점이 하나뿐(정지 탭 등)이면 문지를 방향이 없다.

  const rCeil = Math.ceil(safeRadius);
  // 긴 획에서 dab마다 수천 개의 임시 TypedArray를 만들면 Worker에서도 GC 정지가 누적된다.
  // 가장 큰 발자국 하나를 스트로크 동안 재사용하고, 각 dab의 실제 boxW*boxH 구간은 아래
  // snapshot 루프가 전부 덮어쓴다. 픽셀 연산/결과는 기존과 동일하고 할당만 O(dabs)→O(1)이다.
  // Fractional dab centres can make floor(left)..ceil(right) one pixel wider than 2r+1.
  const maximumSnapshotWidth = Math.min(w, rCeil * 2 + 2);
  const maximumSnapshotHeight = Math.min(h, rCeil * 2 + 2);
  const snapshot = new Uint8ClampedArray(
    maximumSnapshotWidth * maximumSnapshotHeight * 4,
  );

  for (let i = 1; i < resampled.length; i++) {
    const prev = resampled[i - 1]!;
    const curr = resampled[i]!;
    // 소스는 "같은 오프셋만큼 prev 쪽으로 당긴" 좌표 — dest(px,py) = curr + (dx,dy) 라면
    // src = prev + (dx,dy) = dest + (prev - curr).
    const offX = prev.x - curr.x;
    const offY = prev.y - curr.y;

    const minX = clampInt(Math.floor(curr.x - rCeil), 0, w - 1);
    const maxX = clampInt(Math.ceil(curr.x + rCeil), 0, w - 1);
    const minY = clampInt(Math.floor(curr.y - rCeil), 0, h - 1);
    const maxY = clampInt(Math.ceil(curr.y + rCeil), 0, h - 1);
    if (minX > maxX || minY > maxY) continue;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;

    // 1) 이번 스텝이 읽을 소스 영역을 먼저 통째로 스냅샷(쓰기 전에!) — 스캔 방향 줄무늬 방지.
    for (let sy = 0; sy < boxH; sy++) {
      const destY = minY + sy;
      for (let sx = 0; sx < boxW; sx++) {
        const destX = minX + sx;
        const srcX = clampInt(Math.round(destX + offX), 0, w - 1); // 클램프-투-엣지
        const srcY = clampInt(Math.round(destY + offY), 0, h - 1);
        const srcIdx = (srcY * w + srcX) * 4;
        const outIdx = (sy * boxW + sx) * 4;
        snapshot[outIdx] = data[srcIdx]!;
        snapshot[outIdx + 1] = data[srcIdx + 1]!;
        snapshot[outIdx + 2] = data[srcIdx + 2]!;
        snapshot[outIdx + 3] = data[srcIdx + 3]!;
      }
    }

    // 2) 스냅샷을 소스로 dest 를 블렌드(4채널 모두 — 알파 포함).
    for (let sy = 0; sy < boxH; sy++) {
      const destY = minY + sy;
      for (let sx = 0; sx < boxW; sx++) {
        const destX = minX + sx;
        const weight = smudgeBrushWeight(destX - curr.x, destY - curr.y, safeRadius);
        if (weight <= 0) continue;
        const amount = strength * weight;
        if (amount <= 0) continue;
        const destIdx = (destY * w + destX) * 4;
        const srcIdx = (sy * boxW + sx) * 4;
        // getImageData 는 straight(비-프리멀티플라이드) RGBA 다. 투명 픽셀의 RGB 는 의미가 없는
        // 0,0,0 이라 그대로 보간하면 "없는 검정"이 섞여, 빈 캔버스 쪽으로 문지른 꼬리가 옅어지는
        // 대신 거뭇해진다. 안료를 알파로 가중해 섞고 나서 되돌린다. 양쪽이 불투명하면 이 식은
        // 기존 straight 보간과 정확히 같은 값이므로 불투명 영역은 한 비트도 바뀌지 않는다.
        const destAlpha = data[destIdx + 3]! / 255;
        const srcAlpha = snapshot[srcIdx + 3]! / 255;
        const outAlpha = destAlpha + (srcAlpha - destAlpha) * amount;
        if (outAlpha > SMUDGE_PREMULTIPLY_EPSILON) {
          const inverse = 1 / outAlpha;
          for (let channel = 0; channel < 3; channel += 1) {
            const destPremultiplied = data[destIdx + channel]! * destAlpha;
            const srcPremultiplied = snapshot[srcIdx + channel]! * srcAlpha;
            data[destIdx + channel] =
              (destPremultiplied + (srcPremultiplied - destPremultiplied) * amount) * inverse;
          }
        }
        data[destIdx + 3] = lerpChannel(data[destIdx + 3]!, snapshot[srcIdx + 3]!, amount);
      }
    }
  }

  return data;
}
