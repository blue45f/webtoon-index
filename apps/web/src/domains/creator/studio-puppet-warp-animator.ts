/**
 * Studio 2D 퍼펫 워프(Puppet Warp) & 무빙웹툰 키프레임 이징 모듈.
 *
 * 2D 캐릭터/오브젝트의 핀(Pin) 제어점 위치 변형 및 키프레임 보간(Linear/EaseInOut)으로
 * 무빙웹툰 및 2D 툰 애니메이션 모션을 생성하는 순수 연산 모듈.
 */

export interface StudioPuppetPin {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly weight?: number;
}

export interface StudioPuppetKeyframe {
  readonly timeSec: number;
  readonly pins: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

export interface StudioPuppetInterpolationOptions {
  readonly easing?: "linear" | "easeInOut" | "easeOutBounce";
}

/**
 * 두 키프레임 사이의 퍼펫 핀 좌표를 이징 보간한다.
 */
export function interpolateStudioPuppetPins(
  kf1: StudioPuppetKeyframe,
  kf2: StudioPuppetKeyframe,
  timeSec: number,
  options: StudioPuppetInterpolationOptions = {},
): Record<string, { x: number; y: number }> {
  const duration = kf2.timeSec - kf1.timeSec;
  if (duration <= 0) return { ...kf1.pins };

  const rawProgress = Math.max(0, Math.min(1, (timeSec - kf1.timeSec) / duration));
  let progress = rawProgress;

  if (options.easing === "easeInOut") {
    progress =
      rawProgress < 0.5
        ? 2 * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;
  }

  const result: Record<string, { x: number; y: number }> = {};
  for (const [pinId, p1] of Object.entries(kf1.pins)) {
    const p2 = kf2.pins[pinId] ?? p1;
    result[pinId] = {
      x: p1.x + (p2.x - p1.x) * progress,
      y: p1.y + (p2.y - p1.y) * progress,
    };
  }

  return result;
}
