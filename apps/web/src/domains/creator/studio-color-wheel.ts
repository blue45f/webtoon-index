/**
 * Studio Color Wheel — Krita 스타일 팝업 원형 색상 휠의 순수 코어(기하 계산 + 히트테스트).
 *
 * 캔버스를 길게 누르면(long-press) 누른 지점을 중심으로 최근 사용 색 최대 8개를 원형으로
 * 배치한 팝업이 뜨고, 누른 채로 원하는 색 쪽으로 끌었다가 떼면(drag-to-release) 그 색이
 * 즉시 브러시 색으로 적용된다 — Krita의 팝업 팔레트(Radial/Pie Palette) 대응. 이 파일은
 * 각도·좌표·히트테스트만 다루는 순수 함수 모음이다 — DOM/Konva 의존 없음, 결정적.
 * 데이터 소스(최근 사용 색)는 studio-color-utils.ts(readRecentColors/pushRecentColor/
 * storeRecentColors)를 그대로 재사용한다 — 이 파일은 새 저장소를 만들지 않는다.
 *
 * 좌표계: 모든 함수는 뷰포트(화면) px 기준 "포인터 - 휠 중심" 상대 좌표(dx, dy)를 받는다.
 * 휠 중심 자체는 DOM 오버레이(StudioColorWheelOverlay)가 fixed 포지셔닝으로 그리므로
 * 항상 clientX/clientY 같은 뷰포트 좌표로 다룬다(캔버스 정규화 좌표가 아님). 각도 0은
 * 12시 방향(위쪽)이며 시계 방향으로 증가한다 — 슬라이스 0이 항상 정확히 위쪽에 오게 해서
 * "최근 색"이 매번 같은 자리에서 시작하게 한다(사용자가 위치를 손에 익힐 수 있도록).
 *
 * 인터랙션 규약(중심에서 바깥으로 3개 구역, hitTestColorWheel 이 이 3구역을 판정한다):
 * - 중심 데드존(거리 < innerDeadzonePx): 아직 어떤 색도 겨냥하지 않은 상태 — {kind:"none"}.
 *   여기서 포인터를 떼면 선택 없이 팝업이 열린 채로 유지된다("길게 누르기만 하고 그대로
 *   놓은" 경우 — 이후 스와치를 직접 클릭하는 폴백 경로로 자연스럽게 이어진다).
 * - 링(innerDeadzonePx ~ cancelRadiusPx): 각도로 가장 가까운 슬라이스를 겨냥 —
 *   {kind:"slice", index}. 여기서 포인터를 떼면 그 슬라이스의 색을 선택하고 팝업을 닫는다.
 * - 바깥(거리 > cancelRadiusPx): 너무 멀리 끌고 나간 경우 — {kind:"cancel"}. 여기서 포인터를
 *   떼면 아무 색도 선택하지 않고 팝업만 닫는다(파이 메뉴류의 흔한 탈출 관례 — 실수로 연
 *   팝업을 드래그 한 번으로 취소할 수 있게 한다).
 */

/** 원형 휠에 배치할 최대 색 수(스코프: 최근 사용 색 8개). */
export const COLOR_WHEEL_MAX_SLICES = 8;

/** 길게 누르기로 인정하는 최소 유지 시간(ms) — 이 시간 동안 포인터가 거의 안 움직여야 열린다. */
export const COLOR_WHEEL_LONG_PRESS_MS = 450;

/** 이 값(px, 뷰포트 기준)보다 더 움직이면 "길게 누르기"가 아니라 드래그/클릭으로 보고 취소한다. */
export const COLOR_WHEEL_MOVE_CANCEL_PX = 6;

/** 중심 데드존 반지름(px) — 이 안에서 포인터를 떼면 선택 없이 팝업이 열린 채 유지된다. */
export const COLOR_WHEEL_INNER_DEADZONE_PX = 22;

/** 스와치를 배치하는 반지름(px) — colorWheelSliceOffset 의 기본 반지름. */
export const COLOR_WHEEL_SWATCH_RADIUS_PX = 88;

/** 이 반지름(px)보다 더 끌고 나가면 "취소" 판정 — 포인터를 떼면 선택 없이 팝업만 닫힌다. */
export const COLOR_WHEEL_CANCEL_RADIUS_PX = 160;

/** hitTestColorWheel 의 판정 결과 — 판별 유니언으로 세 구역을 명확히 구분한다. */
export type ColorWheelHit = { kind: "slice"; index: number } | { kind: "none" } | { kind: "cancel" };

/**
 * 최근 사용 색 목록에서 휠에 배치할 색만 앞에서부터 최대 max개 자른다(원본 불변).
 * studio-color-utils.pushRecentColor 가 이미 "최근 순 정렬 + 중복 제거"를 보장하므로
 * 여기서는 자르기만 한다 — 별도 정렬/중복 제거 로직 불필요.
 */
export function selectWheelColors(recentColors: readonly string[], max: number = COLOR_WHEEL_MAX_SLICES): string[] {
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : COLOR_WHEEL_MAX_SLICES;
  return recentColors.slice(0, safeMax);
}

/**
 * 슬라이스 index(0..total-1)의 각도(라디안)를 반환한다. 0 = 12시 방향(위쪽), 시계 방향 증가.
 * total <= 0 이면 -PI/2(위쪽)를 반환(호출부가 total 을 먼저 체크하지 않아도 안전한 기본값).
 */
export function colorWheelSliceAngle(index: number, total: number): number {
  if (total <= 0) return -Math.PI / 2;
  return -Math.PI / 2 + (index * (2 * Math.PI)) / total;
}

/** 슬라이스 index 를 휠 중심 기준 (x, y) 오프셋(px)으로 변환 — DOM 오버레이가 이 값으로 각 스와치를 배치한다. */
export function colorWheelSliceOffset(index: number, total: number, radiusPx: number = COLOR_WHEEL_SWATCH_RADIUS_PX): { x: number; y: number } {
  const angle = colorWheelSliceAngle(index, total);
  return { x: Math.cos(angle) * radiusPx, y: Math.sin(angle) * radiusPx };
}

/**
 * pointerdown 이후 pointermove 로 이 함수를 매번 호출해 "이미 드래그로 판단해 길게 누르기
 * 타이머를 취소해야 하는지"를 판정한다. dx/dy 는 pointerdown 지점 기준 상대 좌표(뷰포트 px).
 */
export function shouldCancelLongPress(dx: number, dy: number, thresholdPx: number = COLOR_WHEEL_MOVE_CANCEL_PX): boolean {
  return Math.hypot(dx, dy) > thresholdPx;
}

/**
 * 휠 중심 기준 포인터 오프셋(dx, dy)이 어느 구역에 있는지 판정한다 — 클래스 상단 JSDoc의
 * 3구역(데드존/링/바깥) 참고. total <= 0(색이 하나도 없음)이면 항상 {kind:"none"}.
 */
export function hitTestColorWheel(
  dx: number,
  dy: number,
  total: number,
  innerDeadzonePx: number = COLOR_WHEEL_INNER_DEADZONE_PX,
  cancelRadiusPx: number = COLOR_WHEEL_CANCEL_RADIUS_PX
): ColorWheelHit {
  if (total <= 0) return { kind: "none" };
  const dist = Math.hypot(dx, dy);
  if (dist < innerDeadzonePx) return { kind: "none" };
  if (dist > cancelRadiusPx) return { kind: "cancel" };
  // atan2(dy, dx): 0 = 3시 방향, 시계 방향 증가(화면 좌표는 y가 아래로 갈수록 커지므로
  // 표준 단위원 공식이 곧바로 "시계 방향"이 된다) — colorWheelSliceAngle 과 동일 기준이라
  // 별도 보정 없이 바로 역변환할 수 있다.
  const angle = Math.atan2(dy, dx);
  const fromTop = angle + Math.PI / 2; // 12시 방향(index 0)을 0으로 맞춘다.
  const twoPi = 2 * Math.PI;
  const normalized = ((fromTop % twoPi) + twoPi) % twoPi; // [0, 2PI) 로 정규화.
  const sliceSize = twoPi / total;
  const index = Math.round(normalized / sliceSize) % total;
  return { kind: "slice", index };
}

/**
 * 휠 중심이 뷰포트 가장자리에 너무 가까우면 취소 반지름만큼 안쪽으로 밀어 넣어, 드래그로
 * 취소할 여유 공간과 모든 스와치가 화면 안에 들어오도록 한다. 뷰포트가 margin*2 보다 작은
 * 극단적으로 작은 화면에서도 NaN/역전 없이 margin 값으로 고정되는 안전한 폴백을 갖는다.
 */
export function clampWheelCenter(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  marginPx: number = COLOR_WHEEL_CANCEL_RADIUS_PX
): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, marginPx), Math.max(marginPx, max - marginPx));
  return { x: clamp(x, viewportWidth), y: clamp(y, viewportHeight) };
}

/**
 * StudioColorWheelOverlay 스와치 버튼의 onClick 가드 — 이 클릭이 "키보드(Enter/Space)로 활성화된
 * 것"인지 판정한다. 스와치를 마우스/터치로 직접 누르면 그 pointerup이 먼저 부모 오버레이 div로
 * 버블링돼 오버레이의 pointerup 핸들러가 이미 hitTestColorWheel 로 선택을 확정한다 — 뒤이어 같은
 * 상호작용에서 발생하는 click 이벤트에서 버튼의 onClick 이 또 선택을 확정하면 같은 색이 두 번
 * 선택되고 onClose 도 두 번 불린다(콜백에 부수효과가 있으면 그 부수효과도 두 번 실행됨).
 * 브라우저는 실제 포인터로 발생한 click 의 MouseEvent.detail 을 1 이상으로, 키보드/programmatic
 * 활성화(예: 포커스된 버튼에서 Enter/Space, 또는 el.click())의 click 은 detail 0으로 채운다 —
 * 이 값으로 "이미 pointerup 경로에서 처리된 포인터 클릭"과 "pointerup 을 전혀 거치지 않는 키보드
 * 활성화(무시하면 키보드 사용자가 아예 선택할 방법이 없어짐)"를 구분한다.
 */
export function isKeyboardActivatedClick(detail: number): boolean {
  return detail === 0;
}
