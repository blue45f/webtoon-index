/**
 * Studio Heal/Clone — 복구 브러시(Healing brush) / 도장(Clone stamp) 순수 코어.
 *
 * studio-selection-tools.ts 처럼 계층으로 나눈다:
 *   (A) 기하 — 정규화(SelPoint) 공간에서 소스 오프셋을 다루는 단위 무관 산술.
 *   (B) 픽셀 알고리즘 — StudioImageDataLike 입출력만 다루는 순수 함수(캔버스 무관, 유닛 테스트 가능,
 *       Worker 안에서도 그대로 실행 가능 — studio-heal-clone.worker.ts 가 이 계층만 감싼다).
 *
 * DOM 의존부(캔버스 팩토리 orchestration, Worker 오프로드)는 studio-heal-clone-browser.ts 가
 * 담당한다 — 이 파일 안에서는 document/canvas 를 직접 만들지 않는다.
 *
 * 좌표 규약: 도장의 dest 궤적은 studio-selection-tools.ts 의 브러시 서브패스와 동일한 정규화
 * SelPoint(요소 비회전 로컬 박스 0..1) 공간을 쓴다. flip(좌우/상하 반전 표시) 처리도
 * buildSelectionMaskPlan/flipNormalizedPoint 와 동일한 규약 — 화면(반전 표시) 기준 점을
 * 원본 비반전 픽셀 좌표로 되돌려야 실제 래스터에 정확히 그려진다.
 */
import { flipNormalizedPoint } from "./studio-magic-wand";

import type { StudioImageDataLike } from "./studio-filters";
import type { SelPoint } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

export type HealCloneMode = "heal" | "clone";

/** 모드 선택 칩 목록 — 패널에서 id/라벨/설명으로 사용(SELECTION_TOOLS 와 동일 관례). */
export const HEAL_CLONE_MODES: { id: HealCloneMode; label: string; tip: string }[] = [
  { id: "heal", label: "복구 브러시", tip: "복제한 픽셀을 주변 톤에 맞춰 자연스럽게 섞어 칠합니다(먼지·잡선 제거용)." },
  { id: "clone", label: "도장", tip: "복제한 픽셀을 보정 없이 그대로 옮겨 칠합니다." },
];

// 표시 px 기준 — SELECTION_BRUSH_RADIUS_RANGE 와 동일 관례. 자연 해상도 환산은 호출자(StudioPage) 몫.
export const HEAL_CLONE_RADIUS_RANGE = { min: 6, max: 160, step: 1 } as const;
export const HEAL_CLONE_RADIUS_DEFAULT = 32;
export const HEAL_CLONE_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const; // 1=하드 엣지, 0=최대 페더
export const HEAL_CLONE_HARDNESS_DEFAULT = 0.55;
export const HEAL_CLONE_OPACITY_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const HEAL_CLONE_OPACITY_DEFAULT = 1;

export type HealCloneBrushSettings = { radiusPx: number; hardness: number; opacity: number };

/** 도장 1개 — src/dst 버퍼(각 함수가 스스로 정의하는 좌표계) 기준 좌표. */
export type HealCloneDab = { srcX: number; srcY: number; destX: number; destY: number };

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼(모듈 로컬 — studio-node-edit.ts 등 형제 모듈과 동일하게 각자 작게 둔다)
// ---------------------------------------------------------------------------

/** 0..1 클램프(비유한은 0). */
function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..255 클램프(비유한은 0) — 합성 전에 색 시프트 결과를 정리한다. */
function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ---------------------------------------------------------------------------
// (A) 기하 — 정규화 오프셋 산술
// ---------------------------------------------------------------------------

/** 소스 오프셋 계산 — "source + (currentPos - initialDragPoint)"를 오프셋 형태로 표현. */
export function computeHealCloneSourceOffset(sourceAnchor: SelPoint, firstDestPoint: SelPoint): SelPoint {
  return { x: sourceAnchor.x - firstDestPoint.x, y: sourceAnchor.y - firstDestPoint.y };
}

/** 목적지 점 + 오프셋 → 그 시점의 소스 점(둘 다 정규화, 같은 공간). */
export function healCloneSourcePoint(offset: SelPoint, destPoint: SelPoint): SelPoint {
  return { x: destPoint.x + offset.x, y: destPoint.y + offset.y };
}

/**
 * 정규화 목적지 궤적 + 소스 오프셋 → 디바이스(자연) px 도장 목록.
 * flip 규약은 buildSelectionMaskPlan 과 동일: 화면(반전 표시) 기준 점을 원본 비반전 픽셀 좌표로
 * 되돌린다. dest 와 source 양쪽에 각각 flipNormalizedPoint 를 적용한다 — 오프셋 자체는 화면
 * (반전 표시) 공간의 상수로 유지하고 최종 좌표만 뒤집으면, 반전축 위의 오프셋 부호가 자동으로
 * 뒤집히는 것과 동치다(화면을 거울에 비추면 "오른쪽으로 5px" 오프셋이 "왼쪽으로 5px"가 되는 것과
 * 같은 이치 — 오프셋을 미리 뒤집어 계산하는 것과 결과가 같아 별도 분기가 필요 없다).
 * 비유한 좌표를 만드는 점은 건너뛴다(방어적 — 정상 입력에선 발생하지 않는다).
 */
export function planHealCloneDabs(
  destPointsNorm: readonly SelPoint[],
  sourceOffsetNorm: SelPoint,
  imageW: number,
  imageH: number,
  opts?: { flipX?: boolean; flipY?: boolean }
): HealCloneDab[] {
  const w = Number.isFinite(imageW) && imageW > 0 ? imageW : 0;
  const h = Number.isFinite(imageH) && imageH > 0 ? imageH : 0;
  if (w <= 0 || h <= 0) return [];
  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;
  const dabs: HealCloneDab[] = [];
  for (const destNorm of destPointsNorm) {
    const srcNorm = healCloneSourcePoint(sourceOffsetNorm, destNorm);
    const destRaw = flipNormalizedPoint(destNorm, flipX, flipY);
    const srcRaw = flipNormalizedPoint(srcNorm, flipX, flipY);
    const srcX = srcRaw.x * w;
    const srcY = srcRaw.y * h;
    const destX = destRaw.x * w;
    const destY = destRaw.y * h;
    if (!Number.isFinite(srcX) || !Number.isFinite(srcY) || !Number.isFinite(destX) || !Number.isFinite(destY)) {
      continue;
    }
    dabs.push({ srcX, srcY, destX, destY });
  }
  return dabs;
}

// ---------------------------------------------------------------------------
// (B) 픽셀 알고리즘 — StudioImageDataLike 순수 입출력
// ---------------------------------------------------------------------------

/**
 * 반경 radius 안(원형)의 알파 가중 평균 RGB. 창이 이미지 밖으로 완전히 벗어나거나, 창 안의
 * 모든 픽셀이 완전 투명(alpha=0)이면 null.
 *
 * 알파로 가중하는 이유: 이 함수의 유일한 호출자(stampHealCloneDab, heal 모드)는 "그 지점 주변에
 * 실제로 보이는 색"을 알고 싶어한다. 알파 가중 없이 단순 평균을 내면 반경 창이 투명 배경(예:
 * 캐릭터 컷아웃 PNG 의 여백 — width=0,height=0 픽셀이 아니라 alpha=0 인 (0,0,0,0) 류 픽셀)에
 * 걸칠 때마다 그 "안 보이는" RGB 가 보이는 색과 동일한 비중으로 섞여 들어가 톤매칭이 크게
 * 어긋난다(투명 배경 쪽으로 어두워지는 등) — 정확히 heal 모드가 가장 많이 쓰이는 상황(경계 근처
 * 잡티 제거)에서 터진다. 알파 가중 평균은 이 왜곡을 없앤다: 완전 불투명 픽셀만 있는 창(기존
 * 스튜디오 이미지 대부분)에서는 결과가 단순 평균과 정확히 같다(가중치가 균일해 상쇄).
 */
export function localMeanColor(
  img: StudioImageDataLike,
  cx: number,
  cy: number,
  radius: number
): { r: number; g: number; b: number } | null {
  const w = img.width;
  const h = img.height;
  const r = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || r <= 0 || w <= 0 || h <= 0) return null;

  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(w - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(h - 1, Math.ceil(cy + r));
  if (minX > maxX || minY > maxY) return null;

  const rSq = r * r;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumWeight = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > rSq) continue;
      const idx = (y * w + x) * 4;
      const weight = img.data[idx + 3]!; // alpha(0..255) — 투명 픽셀은 평균에 기여하지 않는다.
      sumR += img.data[idx]! * weight;
      sumG += img.data[idx + 1]! * weight;
      sumB += img.data[idx + 2]! * weight;
      sumWeight += weight;
      count += 1;
    }
  }
  if (count === 0 || sumWeight === 0) return null;
  return { r: sumR / sumWeight, g: sumG / sumWeight, b: sumB / sumWeight };
}

/** 힐 모드 로컬 평균 창 반경 — 브러시 반경에 비례(스케일 불변). */
export function healLocalMeanRadius(radiusPx: number): number {
  return Math.max(2, Math.round((Number.isFinite(radiusPx) ? radiusPx : 0) * 0.6));
}

type HealCloneColorShift = Readonly<{ r: number; g: number; b: number }>;
const NO_HEAL_CLONE_COLOR_SHIFT: HealCloneColorShift = { r: 0, g: 0, b: 0 };

function computeHealCloneColorShift(
  source: StudioImageDataLike,
  destinationContext: StudioImageDataLike,
  dab: HealCloneDab,
  radiusPx: number,
  mode: HealCloneMode,
): HealCloneColorShift {
  if (mode !== "heal") return NO_HEAL_CLONE_COLOR_SHIFT;
  const meanRadius = healLocalMeanRadius(radiusPx);
  const sourceMean = localMeanColor(source, dab.srcX, dab.srcY, meanRadius);
  const destinationMean = localMeanColor(
    destinationContext,
    dab.destX,
    dab.destY,
    meanRadius,
  );
  if (!sourceMean || !destinationMean) return NO_HEAL_CLONE_COLOR_SHIFT;
  return {
    r: destinationMean.r - sourceMean.r,
    g: destinationMean.g - sourceMean.g,
    b: destinationMean.b - sourceMean.b,
  };
}

function stampHealCloneDabWithColorShift(
  src: StudioImageDataLike,
  dst: StudioImageDataLike,
  dab: HealCloneDab,
  radiusPx: number,
  hardness: number,
  opacity: number,
  shift: HealCloneColorShift,
): void {
  const R = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const op = clampUnit(opacity);
  if (R <= 0 || op <= 0) return;
  if (
    !Number.isFinite(dab.srcX) ||
    !Number.isFinite(dab.srcY) ||
    !Number.isFinite(dab.destX) ||
    !Number.isFinite(dab.destY)
  ) {
    return;
  }
  const hard = clampUnit(hardness);
  const edgeStart = R * hard;
  const span = Math.max(1e-6, R - edgeStart);
  const rCeil = Math.ceil(R);
  const sw = src.width;
  const sh = src.height;
  const dw = dst.width;
  const dh = dst.height;

  for (let oy = -rCeil; oy <= rCeil; oy += 1) {
    for (let ox = -rCeil; ox <= rCeil; ox += 1) {
      const dist = Math.hypot(ox, oy);
      if (dist > R) continue;
      const alpha = dist <= edgeStart ? op : op * (1 - (dist - edgeStart) / span);
      if (alpha <= 0) continue;

      const sx = Math.round(dab.srcX + ox);
      const sy = Math.round(dab.srcY + oy);
      const dx = Math.round(dab.destX + ox);
      const dy = Math.round(dab.destY + oy);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      if (dx < 0 || dy < 0 || dx >= dw || dy >= dh) continue;

      const sIdx = (sy * sw + sx) * 4;
      const dIdx = (dy * dw + dx) * 4;
      const r = clampByte(src.data[sIdx]! + shift.r);
      const g = clampByte(src.data[sIdx + 1]! + shift.g);
      const b = clampByte(src.data[sIdx + 2]! + shift.b);
      const a = src.data[sIdx + 3]!; // 알파는 시프트 없이 그대로.

      dst.data[dIdx] = dst.data[dIdx]! * (1 - alpha) + r * alpha;
      dst.data[dIdx + 1] = dst.data[dIdx + 1]! * (1 - alpha) + g * alpha;
      dst.data[dIdx + 2] = dst.data[dIdx + 2]! * (1 - alpha) + b * alpha;
      dst.data[dIdx + 3] = dst.data[dIdx + 3]! * (1 - alpha) + a * alpha;
    }
  }
}

/**
 * 도장 1개 적용 — dst(제자리 변형)에 src(읽기 전용, 스트로크 시작 시점 고정 스냅샷)의 대응
 * 위치를 원형으로 복사한다. hardness<1이면 가장자리로 갈수록 알파가 선형으로 줄어든다
 * (edgeStart=radius*hardness 부터 radius까지 1→0). heal 모드는 복사 전에 두 지점 주변
 * localMeanColor(반경 healLocalMeanRadius(radiusPx))의 차이만큼 복사 RGB를 이동시켜 붙인다
 * (dst 가 아니라 항상 src 에서 양쪽을 재는 것이 핵심 — 이미 칠해진 dst 를 기준 삼으면 같은
 * 스트로크 안에서 도장이 겹칠 때 평균이 스스로를 쫓아 드리프트한다).
 * src/dst 경계를 벗어나는 픽셀은 건너뛴다(크래시 없음, 가장자리에서 도장이 잘려 그려짐).
 * opacity<1로 겹쳐 칠하면(스트로크 내 인접 도장이 겹치면) 표준 알파 합성으로 자연히 누적된다.
 * 알파 채널은 시프트되지 않고 src 에서 그대로 옮겨진다 — 투명한 소스를 복제하면 불투명한
 * 대상 위에 투명을 "칠하는" 결과가 된다(의도된 동작, 패널 안내문에 별도 명시).
 */
export function stampHealCloneDab(
  src: StudioImageDataLike,
  dst: StudioImageDataLike,
  dab: HealCloneDab,
  radiusPx: number,
  hardness: number,
  opacity: number,
  mode: HealCloneMode
): void {
  const R = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const op = clampUnit(opacity);
  if (R <= 0 || op <= 0) return;
  if (
    !Number.isFinite(dab.srcX) ||
    !Number.isFinite(dab.srcY) ||
    !Number.isFinite(dab.destX) ||
    !Number.isFinite(dab.destY)
  ) {
    return;
  }
  stampHealCloneDabWithColorShift(
    src,
    dst,
    dab,
    R,
    hardness,
    op,
    computeHealCloneColorShift(src, src, dab, R, mode),
  );
}

/** 스트로크 전체(도장 목록) 적용 — stampHealCloneDab 을 순서대로 호출한다(뒤 도장이 앞을 덮는다). */
export function applyHealCloneDabs(
  src: StudioImageDataLike,
  dst: StudioImageDataLike,
  dabs: readonly HealCloneDab[],
  radiusPx: number,
  hardness: number,
  opacity: number,
  mode: HealCloneMode
): void {
  for (const dab of dabs) {
    stampHealCloneDab(src, dst, dab, radiusPx, hardness, opacity, mode);
  }
}

/**
 * Frozen source와 mutable destination을 서로 다른 잘린 영역으로 실행한다. dab의 src 좌표는 src
 * 버퍼 기준이고 dest 좌표는 dst 버퍼 기준이므로 두 버퍼의 크기가 달라도 된다.
 *
 * heal의 destination local mean은 반드시 스트로크 시작 시점이어야 한다. 별도 frozen destination
 * 복사본을 Worker로 보내지 않도록 모든 색 시프트를 dst 변형 전에 먼저 계산한 다음 도장을 순서대로
 * 누적한다. 이는 full-frame 엔진이 frozen src에서 source/destination 평균을 읽는 결과와 동일하다.
 */
export function applyHealCloneDabsFromSeparateRegions(
  src: StudioImageDataLike,
  dst: StudioImageDataLike,
  dabs: readonly HealCloneDab[],
  radiusPx: number,
  hardness: number,
  opacity: number,
  mode: HealCloneMode,
): void {
  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const shifts = mode === "heal"
    ? dabs.map((dab) => computeHealCloneColorShift(src, dst, dab, radius, mode))
    : null;
  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index]!;
    stampHealCloneDabWithColorShift(
      src,
      dst,
      dab,
      radius,
      hardness,
      opacity,
      shifts?.[index] ?? NO_HEAL_CLONE_COLOR_SHIFT,
    );
  }
}
