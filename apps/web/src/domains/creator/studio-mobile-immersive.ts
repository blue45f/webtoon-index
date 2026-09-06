export const STUDIO_MOBILE_IMMERSIVE_SESSION_KEY =
  "toonspectrum-studio-mobile-immersive:v1";

type StudioMobileImmersiveStorage = Pick<Storage, "getItem" | "setItem">;

export function studioMobileImmersiveSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 모바일 컷툰 편집기는 기본적으로 전용 앱 셸을 사용한다. 사용자가 같은 탭에서 명시적으로
 * 종료한 경우에만 일반 사이트 레이아웃으로 다시 열며, 작품/계정 데이터에는 이 선택을 넣지 않는다.
 */
export function shouldStartStudioMobileImmersive(
  storage: StudioMobileImmersiveStorage | null | undefined
): boolean {
  try {
    return storage?.getItem(STUDIO_MOBILE_IMMERSIVE_SESSION_KEY) !== "windowed";
  } catch {
    return true;
  }
}

export function saveStudioMobileImmersivePreference(
  storage: StudioMobileImmersiveStorage | null | undefined,
  enabled: boolean
): void {
  try {
    storage?.setItem(
      STUDIO_MOBILE_IMMERSIVE_SESSION_KEY,
      enabled ? "immersive" : "windowed"
    );
  } catch {
    // 차단된 sessionStorage에서는 현재 React 상태만 유지한다.
  }
}
