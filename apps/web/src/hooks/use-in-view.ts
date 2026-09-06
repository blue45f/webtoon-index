
import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * 요소가 뷰포트에 처음 들어오면 한 번만 true 로 전환되는 reveal 게이트.
 * - reduced-motion: 즉시 true (애니메이션 안무를 건너뛰고 최종 상태로 표시).
 * - IntersectionObserver 미지원: 즉시 true (정적 폴백).
 *
 * 차트/스펙트럼 바의 "reveal 시 채워짐" 안무를 트리거하는 단일 출처.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options?: { margin?: string; amount?: number }
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setInView(true);
      return;
    }
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        rootMargin: options?.margin ?? "0px 0px -12% 0px",
        threshold: options?.amount ?? 0.15,
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.margin, options?.amount]);

  return [ref, inView];
}

/** 동기 1회 평가용 — 컴포넌트 초기 상태 결정에 사용. */
export function reducedMotion(): boolean {
  return prefersReducedMotion();
}
