import { triggerParticleBurst } from "@toonspectrum/core/fx";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

/**
 * SplashScreen — 웹 앱의 동적 인트로/스플래시.
 *
 * IntroSplash 디자인(TOONSPECTRUM 워드마크 + 스펙트럼 링 + 책 로고)을
 * Tailwind + 공유 fx(@toonspectrum/core/fx)로 재구성합니다.
 *
 * 모바일 폭 안전:
 *  - 루트는 `fixed inset-0` + `max-w-full overflow-hidden` 으로 가로 오버플로 0.
 *  - 타이포/간격은 clamp 기반 fluid 사이징 → 좁은 모바일 화면에서도 잘리지 않는다.
 *  - safe-area(노치/홈 인디케이터) 패딩 반영.
 *
 * 동적 연출(공유 fx 키프레임 재사용 — fx.css 필요):
 *  - `pf-aurora`  : 배경 오로라 그라데이션 흐름.
 *  - `pf-glow`    : 로고 발광 펄스(그림자 호흡).
 *  - `pf-sparkle` : 스펙트럼 도트 반짝임.
 *  - logoFloat    : 로고 떠오름(아래 인라인 keyframes).
 *  - 마운트 시 중앙에서 `triggerParticleBurst` 1회 → 반짝임 "팡".
 *  - 부드러운 fade-out(blur 동반).
 *
 * 접근성: 장식 오버레이라 `aria-hidden`. prefers-reduced-motion 은 fx.css/유틸이 자동 정지.
 *
 * @example App 에서
 *   import { SplashScreen } from "@/shared/components/SplashScreen";
 *   import "@toonspectrum/core/fx/fx.css"; // (이미 전역 import 되어 있으면 생략)
 *   <SplashScreen />
 *   // 세션 1회만 노출(기본). 매 마운트 노출하려면 <SplashScreen once={false} />
 */
export interface SplashScreenProps {
  /** 표시 유지 시간(ms, fade 시작 전). 기본 2000. */
  holdMs?: number;
  /** fade-out 지속(ms). 기본 800. */
  fadeMs?: number;
  /** 세션당 1회만 노출(sessionStorage). 기본 true. false면 마운트마다 노출. */
  once?: boolean;
  /** fade 완료 후 호출(언마운트 타이밍 연동용). */
  onDone?: () => void;
}

const SESSION_KEY = "toonspectrum-intro-shown";

const SPECTRUM_DOTS = [
  { className: "top-0 left-1/2 -translate-x-1/2", color: "#ff3b30" },
  { className: "top-1/2 right-0 -translate-y-1/2", color: "#ff9500" },
  { className: "bottom-0 left-1/2 -translate-x-1/2", color: "#4cd964" },
  { className: "top-1/2 left-0 -translate-y-1/2", color: "#5ac8fa" },
] as const;

export function SplashScreen({
  holdMs = 2000,
  fadeMs = 800,
  once = true,
  onDone,
}: SplashScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isFirstVisit =
    !once || (typeof window !== "undefined" && !sessionStorage.getItem(SESSION_KEY));
  const [isVisible, setIsVisible] = useState(isFirstVisit);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (!isFirstVisit) return;
    if (once && typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "true");
    }

    // 중앙에서 반짝임 "팡" 1회 — 정적 화면을 동적으로.
    const center = () => {
      const rect = overlayRef.current?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height * 0.42 : window.innerHeight * 0.42;
      triggerParticleBurst(x, y, { count: 28, spread: 1.35, durationMs: 1100, zIndex: 1000001 });
    };
    const burstTimer = setTimeout(center, 360);
    const fadeTimer = setTimeout(() => setIsFading(true), holdMs);
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
      onDone?.();
    }, holdMs + fadeMs);

    return () => {
      clearTimeout(burstTimer);
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [isFirstVisit, once, holdMs, fadeMs, onDone]);

  if (!isVisible) return null;

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="fixed inset-0 z-[1000000] flex max-w-full flex-col items-center justify-center overflow-hidden select-none"
      style={{
        background: "#060309",
        paddingBlock: "env(safe-area-inset-top) env(safe-area-inset-bottom)",
        paddingInline: "env(safe-area-inset-left) env(safe-area-inset-right)",
        opacity: isFading ? 0 : 1,
        filter: isFading ? "blur(15px)" : "blur(0)",
        transition: `opacity ${fadeMs}ms cubic-bezier(0.16,1,0.3,1), filter ${fadeMs}ms cubic-bezier(0.16,1,0.3,1)`,
        pointerEvents: isFading ? "none" : "auto",
      }}
    >
      {/* 배경 오로라 흐름(공유 fx pf-aurora) — 좁은 폭에서도 가로 오버플로 없도록 inset 고정 */}
      <div className="pf-aurora pointer-events-none absolute inset-0 opacity-40" />
      {/* 중앙 비네트 — 워드마크 가독성 보강 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 42%, transparent 30%, rgba(6,3,9,0.55) 100%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-full flex-col items-center px-6 text-center">
        {/* 로고 — 회전 스펙트럼 링 + 발광 펄스(pf-glow) + 떠오름(logoFloat) */}
        <div className="relative mb-6 flex h-[clamp(64px,18vw,84px)] w-[clamp(64px,18vw,84px)] items-center justify-center">
          <div className="ts-splash-ring absolute inset-0 rounded-full border border-white/10">
            {SPECTRUM_DOTS.map((dot) => (
              <span
                key={dot.color}
                className={cn("pf-sparkle absolute h-2 w-2 rounded-full", dot.className)}
                style={{
                  background: dot.color,
                  boxShadow: `0 0 8px ${dot.color}`,
                  filter: "blur(0.5px)",
                }}
              />
            ))}
          </div>
          <div className="pf-glow flex h-[clamp(46px,13vw,58px)] w-[clamp(46px,13vw,58px)] items-center justify-center overflow-hidden rounded-2xl">
            <img
              src={resolveAssetUrl("/icon-192.png")}
              alt=""
              className="ts-splash-logo size-full object-cover"
              decoding="async"
            />
          </div>
        </div>

        <h1
          className="ts-splash-title m-0 font-black text-white"
          style={{ fontSize: "clamp(1.6rem,8vw,2.3rem)", letterSpacing: "0.14em" }}
        >
          TOON
          <span
            className="ts-splash-accent"
            style={{
              background:
                "linear-gradient(90deg,#ff3b30,#ff9500,#ffcc00,#4cd964,#5ac8fa,#5856d6)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            SPECTRUM
          </span>
        </h1>

        <div className="ts-splash-line my-4 h-0.5 rounded-full bg-gradient-to-r from-[#ff3b30] to-[#5ac8fa]" />

        <span
          className="ts-splash-sub font-bold text-white/50"
          style={{ fontSize: "clamp(9px,2.6vw,10.5px)", letterSpacing: "0.25em" }}
        >
          WEBTOON CATALOG &amp; CREATOR STUDIO
        </span>

        <span
          className="ts-splash-badge mt-5 rounded-full border px-2.5 py-0.5 font-extrabold uppercase tracking-wider"
          style={{
            fontSize: "clamp(9px,2.4vw,10px)",
            color: "#5ac8fa",
            borderColor: "rgba(90,200,250,0.4)",
            background: "rgba(90,200,250,0.08)",
            letterSpacing: "0.1em",
          }}
        >
          Beta Service
        </span>
      </div>

      {/* 컴포넌트 로컬 keyframes — 별도 CSS import 불필요.
          fx.css 의 공유 키프레임(pf-*)과 충돌하지 않게 ts-splash-* 네임스페이스 사용. */}
      <style>{`
        @keyframes ts-splash-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes ts-splash-spin { to{transform:rotate(360deg)} }
        @keyframes ts-splash-hue { to{filter:hue-rotate(360deg)} }
        @keyframes ts-splash-up { from{transform:translateY(20px);opacity:0;filter:blur(5px)} to{transform:translateY(0);opacity:1;filter:blur(0)} }
        @keyframes ts-splash-grow { to{width:clamp(72px,26vw,100px)} }
        @keyframes ts-splash-fade { to{opacity:1} }
        .ts-splash-logo{ animation: ts-splash-float 2.8s ease-in-out infinite; }
        .ts-splash-ring{ animation: ts-splash-spin 8s linear infinite; }
        .ts-splash-title{ animation: ts-splash-up 1s cubic-bezier(0.16,1,0.3,1); }
        .ts-splash-accent{ animation: ts-splash-hue 6s infinite linear; display:inline-block; }
        .ts-splash-line{ width:0; animation: ts-splash-grow 1.4s 0.3s forwards cubic-bezier(0.16,1,0.3,1); }
        .ts-splash-sub{ opacity:0; animation: ts-splash-fade 1s 0.6s forwards ease-out; }
        .ts-splash-badge{ opacity:0; animation: ts-splash-fade 1s 0.8s forwards ease-out; }
        @media (prefers-reduced-motion: reduce){
          .ts-splash-logo,.ts-splash-ring,.ts-splash-accent,.ts-splash-line,.ts-splash-sub,.ts-splash-badge,.ts-splash-title{ animation:none; }
          .ts-splash-line{ width:clamp(72px,26vw,100px); }
          .ts-splash-sub,.ts-splash-badge{ opacity:1; }
        }
      `}</style>
    </div>
  );
}

export default SplashScreen;
