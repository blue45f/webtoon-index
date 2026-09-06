/**
 * Studio Skew Engine — 자유 변형 "기울이기(Skew)" 순수 모듈.
 * 포토샵 자유 변형의 기울이기와 동일한 모델: 요소별 X/Y 기울임을 도(°) 단위로 저장하고,
 * 렌더 시 Konva 노드 attrs 로 변환한다.
 *
 * ── Konva 단위 실검증(konva 10, node_modules/konva/lib) ──────────────────────
 * Konva 의 skewX/skewY 는 각도가 아니라 **전단(tangent) 계수**다:
 *   - Node.js `_getTransform()` 은 rotation 만 `Konva.getAngle()`(도→라디안)로 바꾸고,
 *     skewX/skewY 는 값 그대로 `Transform.skew(sx, sy)` 에 넘긴다.
 *   - Util.js `Transform.skew(sx, sy)` 는 행렬에 `m21 += m11·sx` 식으로 값을 그대로 곱한다
 *     (CSS matrix 의 b/c 성분과 동일). 즉 CSS `skewX(30deg)` == Konva `skewX: tan(30°)`.
 * 따라서 도 → Konva 값 변환은 반드시 `tan(도→라디안)` 을 거쳐야 한다.
 *
 * ── 직렬화 규약(옵셔널 필드) ─────────────────────────────────────────────────
 * El(이미지/텍스트/스티커)에는 `skewX?: number; skewY?: number` 로 **도 단위**를 저장한다.
 * 0(항등)은 저장하지 않는다 — 패치 시 `undefined` 로 비워(JSON.stringify 가 키를 떨굼)
 * 기존 문서와 하위 호환을 유지한다(미설정 == 0 == 기울임 없음).
 *
 * DOM/Konva 임포트 없음 — StudioPage 와 단위 테스트가 공유하는 결정적 로직만 둔다.
 */

// ---------------------------------------------------------------------------
// 범위·스냅 상수
// ---------------------------------------------------------------------------

/** 기울임 한계각(도). ±60° 초과는 tan 이 급발산해 판독 불가 왜곡이라 포토샵처럼 실용 범위로 클램프. */
export const SKEW_MAX_DEG = 60;
export const SKEW_MIN_DEG = -SKEW_MAX_DEG;

/** 슬라이더 한 칸 범위 — -60..60, 1° 단위. 0=항등. */
export const SKEW_RANGE = { min: SKEW_MIN_DEG, max: SKEW_MAX_DEG, step: 1 } as const;

/** 스냅 각(도) — 0/±15/±30/±45. 칩 UI·드래그 스냅이 공유한다(오름차순). */
export const SKEW_SNAP_ANGLES = [-45, -30, -15, 0, 15, 30, 45] as const;
export type SkewSnapAngle = (typeof SKEW_SNAP_ANGLES)[number];

/** 스냅 흡착 허용 오차(도) — 이 안쪽이면 가장 가까운 스냅 각으로 붙는다. */
export const SKEW_SNAP_TOLERANCE_DEG = 4;

// ---------------------------------------------------------------------------
// El 직렬화 필드 규약
// ---------------------------------------------------------------------------

/** El(이미지/텍스트/스티커)에 붙는 기울이기 옵셔널 필드 — 도 단위, 미설정=0(항등). */
export interface SkewFields {
  skewX?: number; // 가로 기울임(도, -60..60). 양수=윗변이 오른쪽으로.
  skewY?: number; // 세로 기울임(도, -60..60). 양수=왼변이 아래로.
}

// ---------------------------------------------------------------------------
// 클램프·변환
// ---------------------------------------------------------------------------

/**
 * 도 단위 정규화 — 비유한수(NaN/±Infinity)는 0(항등), 범위 밖은 ±60 클램프,
 * 소수 첫째 자리 반올림(직렬화 잡음 방지). -0 은 0 으로 정규화한다.
 */
export function clampSkewDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const clamped = Math.min(SKEW_MAX_DEG, Math.max(SKEW_MIN_DEG, deg));
  const rounded = Math.round(clamped * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 도 → Konva skew 값(tangent 계수). 예: 45° → 1, 30° → ≈0.577. 입력은 먼저 클램프한다. */
export function skewDegToKonva(deg: number): number {
  const d = clampSkewDeg(deg);
  if (d === 0) return 0; // tan(0)=0 이지만 부동소수 잡음 없이 정확히 0 을 보장.
  return Math.tan((d * Math.PI) / 180);
}

/**
 * El 의 skew 필드 → Konva 노드 attrs. 항상 명시적 숫자를 반환한다(항등=0) —
 * 리셋 시 노드에 이전 skew 가 잔존하지 않도록 prop 을 조건부로 빼지 않고 늘 스프레드한다.
 */
export function toKonvaSkewAttrs(el: SkewFields): { skewX: number; skewY: number } {
  return {
    skewX: skewDegToKonva(el.skewX ?? 0),
    skewY: skewDegToKonva(el.skewY ?? 0),
  };
}

/** 기울임 항등 여부 — 패널 리셋 버튼 활성화·저장 생략 판단. 미설정/0 모두 항등. */
export function isIdentitySkew(el: SkewFields): boolean {
  return clampSkewDeg(el.skewX ?? 0) === 0 && clampSkewDeg(el.skewY ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// 직렬화(옵셔널 필드 규약)
// ---------------------------------------------------------------------------

/** 저장값 규약: 클램프 후 0(항등)은 `undefined` — 문서에 항등을 저장하지 않는다. */
export function serializeSkewValue(deg: number): number | undefined {
  const d = clampSkewDeg(deg);
  return d === 0 ? undefined : d;
}

/**
 * 패널 patch → El 저장 patch. 들어온 축만 처리하고(부분 패치 보존), 각 값을
 * 클램프 + 항등→undefined 로 정규화한다. `{ ...el, ...patch }` 병합에서 항등 축의
 * 키가 undefined 로 남아 기존 값을 지우도록 **키는 유지**한다(in 연산 기준).
 */
export function normalizeSkewPatch(patch: SkewFields): SkewFields {
  const out: SkewFields = {};
  if ("skewX" in patch) out.skewX = serializeSkewValue(patch.skewX ?? 0);
  if ("skewY" in patch) out.skewY = serializeSkewValue(patch.skewY ?? 0);
  return out;
}

// ---------------------------------------------------------------------------
// 스냅 헬퍼
// ---------------------------------------------------------------------------

/** 주어진 각도에서 가장 가까운 스냅 각(0/±15/±30/±45). 동률이면 작은(음수 쪽) 각. */
export function nearestSkewSnapAngle(deg: number): SkewSnapAngle {
  const d = clampSkewDeg(deg);
  let best: SkewSnapAngle = SKEW_SNAP_ANGLES[0];
  let bestDist = Infinity;
  for (const angle of SKEW_SNAP_ANGLES) {
    const dist = Math.abs(d - angle);
    if (dist < bestDist) {
      best = angle;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 스냅 적용 — tolerance(기본 4°) 안이면 가장 가까운 스냅 각으로 흡착, 밖이면 클램프된
 * 원값을 그대로 반환한다(자유 조작 보존). 슬라이더 드래그·단축 조작이 공유한다.
 */
export function snapSkewDeg(deg: number, toleranceDeg: number = SKEW_SNAP_TOLERANCE_DEG): number {
  const d = clampSkewDeg(deg);
  const snap = nearestSkewSnapAngle(d);
  return Math.abs(d - snap) <= toleranceDeg ? snap : d;
}
