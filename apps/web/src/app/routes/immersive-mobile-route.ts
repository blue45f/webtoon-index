/**
 * 자체 모바일 크롬(도구막대·시트·키보드 회피)을 소유하는 몰입형 경로.
 *
 * 이 경로에서는 SiteHeader의 전역 하단 탭과 App의 전역 FloatingControls를 숨겨,
 * 페이지 전용 조작 영역을 가리지 않는다. `/studio-guide`처럼 이름만 비슷한 별도
 * 경로는 몰입형으로 오인하지 않고, 향후 `/studio/...` 하위 경로는 자동 포함한다.
 */
export function isImmersiveMobileRoute(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}
