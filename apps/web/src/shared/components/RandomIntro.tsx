import { lazy, Suspense, useState } from "react";

import { SplashScreen } from "./SplashScreen";

const INTRO_SESSION_KEY = "toonspectrum-intro-shown";

function shouldShowIntro(once: boolean | undefined): boolean {
  if (once === false) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(INTRO_SESSION_KEY) === null;
  } catch {
    // 장식용 인트로 때문에 저장소 차단 환경의 앱 진입을 막지 않는다.
    return false;
  }
}

// 구형 WebGL 인트로는 Three.js를 끌어오므로 앱 엔트리와 모든 라우트의 초기 다운로드에서
// 분리한다. literal import 경로를 유지해 Vite/Rolldown이 IntroSplash + Three 전용 청크를
// 정확히 만들 수 있게 하고, 실제로 이 변형이 선택된 세션에서만 요청한다.
const IntroSplash = lazy(() =>
  import("./IntroSplash")
    .then((module) => ({ default: module.IntroSplash }))
    // 장식용 인트로 청크 실패가 앱 진입 전체를 막아서는 안 된다. 이미 엔트리에 있는 경량
    // SplashScreen으로 fail-open하면 배포 해시 불일치·오프라인에서도 본문은 정상 진입한다.
    .catch(() => ({ default: SplashScreen })),
);

function IntroSplashLoading() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[1000000] grid place-items-center overflow-hidden bg-[#060309] text-white"
    >
      <span className="font-black tracking-[0.14em]">TOONSPECTRUM</span>
    </div>
  );
}

export interface RandomIntroProps {
  /**
   * 세션당 1회만 노출(sessionStorage). 기본 true(웹 동작).
   * false 면 마운트마다 노출.
   */
  once?: boolean;
}

/**
 * RandomIntro — 웹 인트로 셔플러.
 *
 * 마운트 시 한 번 동전 던지기(Math.random() < 0.5)로 두 인트로 중 하나를 고른다:
 *  - 절반: 구(舊) 웹 인트로 <IntroSplash/> — Three.js 스펙트럼 웨이브("더 멋진").
 *  - 절반: 현행 <SplashScreen/> — 공유 fx 기반 워드마크 스플래시.
 *
 * 선택은 **마운트당 1회**만 결정되어 그 마운트 동안 안정적이다(useState 지연 초기화로 고정).
 * once 는 고른 인트로에 그대로 위임한다(once=true: 세션 1회, once=false: 매 마운트).
 */
export function RandomIntro({ once }: RandomIntroProps = {}) {
  // 자식 lazy 청크를 열기 전에 세션 1회 정책을 확인한다. 이미 본 사용자는 로딩 fallback이나
  // Three.js 요청 자체를 보지 않으며, 실제 선택된 인트로가 동일 키를 기록하는 기존 규약은 유지한다.
  const [visible] = useState(() => shouldShowIntro(once));
  // 마운트당 1회만 평가 — 지연 초기화로 리렌더에도 같은 인트로를 유지한다.
  // NOSONAR S2245 비암호화 용도(인트로 A/B 셔플, 보안 무관)
  const [useLegacy] = useState(() => Math.random() < 0.5);

  if (!visible) return null;

  return useLegacy ? (
    <Suspense fallback={<IntroSplashLoading />}>
      <IntroSplash once={once} />
    </Suspense>
  ) : (
    <SplashScreen once={once} />
  );
}

export default RandomIntro;
