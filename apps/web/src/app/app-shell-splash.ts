import { resolveStudioRoute } from "@/src/domains/creator/studio-router/studio-route-manifest";

/**
 * 전용 컷툰 편집기는 자체 풀스크린 셸과 로딩 상태를 소유한다. 앱 인트로를 그 위에 다시
 * 올리면 첫 펜 입력을 최대 2.8초 막고, 선택된 인트로에 따라 Three.js까지 요청하므로 생략한다.
 * 게시 작업공간은 기존 사이트 흐름을 유지한다. legacy query와 canonical path를 같은
 * resolver로 판별해 정규화 직후 인트로가 사라지는 전환 오류를 막는다.
 */
export function shouldRenderAppSplash(pathname: string, search = ""): boolean {
  // 전용 스튜디오 셸(/studio, /studio/tools-companion 등)은 앱 인트로를 생략한다.
  if (pathname === "/studio" || pathname === "/studio/" || pathname.startsWith("/studio/")) {
    return resolveStudioRoute({ pathname, search }).kind === "publish";
  }
  return true;
}
