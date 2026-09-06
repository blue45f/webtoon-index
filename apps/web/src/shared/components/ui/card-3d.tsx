import React, { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

export interface Card3DProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** 최대 3D 기울기 각도 (기본값: 10도) */
  maxTilt?: number;
  /** 광택/반사 glare 이펙트 켜기 (기본값: true) */
  glare?: boolean;
  /** 호버 시 확대 비율 (기본값: 1.025) */
  scale?: number;
  /** 추가 클래스 */
  className?: string;
}

/**
 * 3D 입체 카드 래퍼 컴포넌트.
 * 마우스 위치를 실시간 추적하여 rotateX, rotateY, 입체 광택 glare 및 preserve-3d 레이어링을 제공합니다.
 */
export function Card3D({
  children,
  maxTilt = 10,
  glare = true,
  scale = 1.025,
  className,
  style,
  onPointerEnter,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...props
}: Card3DProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const resetCard = (card: HTMLDivElement) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    rectRef.current = null;
    card.dataset.active = "false";
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--scale", "1");
    card.style.setProperty("--glare-opacity", "0");
    card.style.setProperty("--rim-opacity", "0");
    card.style.setProperty("--shadow-opacity", "0");
    card.style.setProperty("--card3d-duration", "500ms");
    card.style.setProperty("--card3d-ease", "cubic-bezier(0.16, 1, 0.3, 1)");
  };

  const canTilt = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return false;
    return globalThis.matchMedia?.(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    ).matches ?? false;
  };

  const canPressIn3d = (event: React.PointerEvent<HTMLDivElement>) =>
    event.pointerType === "touch" &&
    !(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || !canPressIn3d(event)) return;

    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    card.dataset.active = "true";
    card.style.setProperty("--rx", `${((yRatio - 0.5) * -maxTilt * 0.55).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${((xRatio - 0.5) * maxTilt * 0.55).toFixed(2)}deg`);
    card.style.setProperty("--scale", "0.985");
    card.style.setProperty("--glare-x", `${(xRatio * 100).toFixed(1)}%`);
    card.style.setProperty("--glare-y", `${(yRatio * 100).toFixed(1)}%`);
    card.style.setProperty("--glare-opacity", "0.58");
    card.style.setProperty("--rim-opacity", "0.72");
    card.style.setProperty("--shadow-opacity", "0.16");
    card.style.setProperty("--card3d-duration", "90ms");
    card.style.setProperty("--card3d-ease", "ease-out");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    if (event.defaultPrevented || !canTilt(event)) return;

    const card = cardRef.current;
    const rect = rectRef.current;
    if (!card || !rect || rect.width === 0 || rect.height === 0) return;

    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (frameRef.current !== null) return;

    // 포인터 이벤트 빈도와 무관하게 프레임당 한 번만 스타일을 갱신한다.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const currentRect = rectRef.current;
      const currentCard = cardRef.current;
      if (!currentRect || !currentCard) return;

      const x = Math.max(0, Math.min(currentRect.width, pointerRef.current.x - currentRect.left));
      const y = Math.max(0, Math.min(currentRect.height, pointerRef.current.y - currentRect.top));
      const xRatio = x / currentRect.width;
      const yRatio = y / currentRect.height;
      const rotateX = (yRatio - 0.5) * -2 * maxTilt;
      const rotateY = (xRatio - 0.5) * 2 * maxTilt;

      currentCard.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
      currentCard.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
      currentCard.style.setProperty("--scale", `${scale}`);
      currentCard.style.setProperty("--glare-x", `${(xRatio * 100).toFixed(1)}%`);
      currentCard.style.setProperty("--glare-y", `${(yRatio * 100).toFixed(1)}%`);
      currentCard.style.setProperty("--glare-opacity", "0.92");
      currentCard.style.setProperty("--rim-opacity", "1");
      currentCard.style.setProperty("--shadow-opacity", "0.34");
    });
  };

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(event);
    if (event.defaultPrevented || !canTilt(event)) return;

    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    rectRef.current = rect;
    card.dataset.active = "true";
    card.style.setProperty("--scale", `${scale}`);
    card.style.setProperty("--rim-opacity", "0.72");
    card.style.setProperty("--shadow-opacity", "0.28");
    card.style.setProperty("--card3d-duration", "110ms");
    card.style.setProperty("--card3d-ease", "ease-out");
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    resetCard(event.currentTarget);
    onPointerLeave?.(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (canPressIn3d(event)) resetCard(event.currentTarget);
    onPointerUp?.(event);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    resetCard(event.currentTarget);
    onPointerCancel?.(event);
  };

  return (
    <div
      ref={cardRef}
      data-active="false"
      onPointerEnter={handlePointerEnter}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      className={cn(
        "group/card3d relative isolate transform-gpu [transform-style:preserve-3d] motion-reduce:!transform-none motion-reduce:!transition-none",
        className,
      )}
      style={{
        transform:
          "perspective(1000px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) scale3d(var(--scale, 1), var(--scale, 1), 1)",
        transition:
          "transform var(--card3d-duration, 500ms) var(--card3d-ease, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 0.35s ease-out",
        boxShadow:
          "0 24px 52px -28px oklch(0.09 0.025 55 / var(--shadow-opacity, 0))",
        ...style,
      }}
      {...props}
    >
      {children}
      {glare && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300 ease-out z-30 overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 50%), oklch(1 0 0 / 0.22) 0%, oklch(1 0 0 / 0.06) 20%, transparent 62%), linear-gradient(115deg, transparent 35%, oklch(1 0 0 / 0.08) 49%, transparent 63%)",
            mixBlendMode: "soft-light",
            opacity: "var(--glare-opacity, 0)",
            transform: "translateZ(28px)",
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] ring-1 ring-inset ring-[oklch(1_0_0/0.22)] transition-opacity duration-300"
        style={{
          opacity: "var(--rim-opacity, 0)",
          transform: "translateZ(16px)",
        }}
      />
    </div>
  );
}
