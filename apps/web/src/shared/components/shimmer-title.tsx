import { playSfx, resumeAudio, triggerParticleBurst } from "@toonspectrum/core/fx";

import { cn } from "@/shared/lib/utils";

/**
 * ShimmerTitle — 공용 강조 타이틀.
 *
 * fx.css 의 `.shimmer-title`(그라데이션 시머 + 글로우, bg-clip-text)을 입혀 텍스트가 끊김 없이
 * 흐르는 웜 스펙트럼으로 빛납니다. 탭하면 그 지점에 파티클 "팡"(triggerParticleBurst) +
 * 'pop' 효과음(playSfx)이 발화해 데이터 색인의 "한 권"을 펼치는 듯한 미세 보상감을 줍니다.
 *
 * - 의미상 장식 모션이라 a11y 텍스트는 children 그대로(읽기 가능). 키보드(Enter/Space)도 발화.
 * - reduced-motion 사용자에겐 fx.css 가 시머/글로우를 끄고 또렷한 솔리드 액센트로 복원합니다.
 * - 기본 태그는 <span>(히어로 <h1> 안의 accent 구간을 감싸기 좋게). `as` 로 교체 가능.
 *
 * 사용 예:
 *   <h1>… <ShimmerTitle>한 권의 색인</ShimmerTitle> 으로.</h1>
 */
export interface ShimmerTitleProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  /** 렌더할 태그(기본 "span"). 예: "span" | "h1" | "strong". */
  as?: "span" | "h1" | "h2" | "h3" | "strong" | "div";
  /** 탭 파티클 개수(기본 18). */
  particleCount?: number;
  /** 탭 파티클 퍼짐(기본 1.0). */
  particleSpread?: number;
}

export function ShimmerTitle({
  children,
  as: Tag = "span",
  particleCount = 18,
  particleSpread = 1,
  className,
  onPointerDown,
  onKeyDown,
  ...rest
}: ShimmerTitleProps) {
  const fire = (x: number, y: number) => {
    void resumeAudio(); // 첫 제스처에서 AudioContext 언락.
    playSfx("pop");
    triggerParticleBurst(x, y, { count: particleCount, spread: particleSpread });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    fire(event.clientX, event.clientY);
    onPointerDown?.(event);
  };

  // 키보드 활성화(Enter/Space) — 요소 중심에서 발화.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    onKeyDown?.(event);
  };

  return (
    <Tag
      // [data-no-sfx] — 전역 위임 클릭 'tick' 을 억제하고 여기서 'pop' 만 울린다(중복 방지).
      data-no-sfx
      role="button"
      tabIndex={0}
      className={cn("shimmer-title", className)}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default ShimmerTitle;
