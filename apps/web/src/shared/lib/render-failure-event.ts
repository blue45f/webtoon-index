/**
 * 렌더 실패 알림 채널.
 *
 * React 에러 바운더리가 잡은 예외는 어디에도 남지 않았다. 두 바운더리 모두
 * `if (import.meta.env.DEV)` 안에서만 console.error 를 했기 때문에, 프로덕션 빌드에서는
 * 컴포넌트가 무너져도 콘솔이 조용하다. 브라우저 프로브는 전부 `vite preview`(프로덕션 빌드)를
 * 상대하므로, 사용자가 빈 패널을 보고 있는 바로 그 순간에 게이트는 "에러 0"을 보고했다.
 *
 * 바운더리는 `src/components` 에 있고 저널은 `src/domains/creator` 에 있다. 그 경계를 넘지
 * 않으려고 DOM 이벤트를 쓴다 — 바운더리는 알리기만 하고, 관찰자(저널)가 구독한다.
 */

export const STUDIO_RENDER_FAILURE_EVENT = "toonspectrum:render-failure";

export interface StudioRenderFailureDetail {
  /** 무너진 표면의 이름. 앱 최상단 바운더리는 "app". */
  readonly surface: string;
  readonly error: unknown;
  readonly componentStack: string | null;
}

/** 절대 throw 하지 않는다 — 알림 실패가 바운더리의 폴백 렌더를 막으면 안 된다. */
export function announceStudioRenderFailure(detail: StudioRenderFailureDetail): void {
  try {
    if (typeof globalThis.dispatchEvent !== "function") return;
    if (typeof CustomEvent !== "function") return;
    globalThis.dispatchEvent(
      new CustomEvent(STUDIO_RENDER_FAILURE_EVENT, { detail }),
    );
  } catch {
    // 관측용 경로다. 여기서 실패해도 사용자가 보는 화면은 달라지지 않는다.
  }
}
