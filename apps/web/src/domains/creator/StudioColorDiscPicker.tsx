/**
 * StudioColorDiscPicker.tsx
 *
 * Procreate & Clip Studio Paint style interactive Color Disc (Color Wheel).
 * Features:
 * - Circular Hue Ring (0..360°) with radial angle tracking.
 * - Central Saturation-Value box with 2D gradient and precision target reticle.
 * - Full touch, pen, and mouse support with PointerEvents and pointer capture.
 * - Keyboard accessible arrow key navigation.
 * - Real-time H/S/V numeric readouts and visual feedback.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  hexToHsv,
  hsvToHex,
  type HsvColor,
} from "./studio-color-harmony-engine";

export interface StudioColorDiscPickerProps {
  readonly value: string;
  readonly onChange: (hex: string) => void;
  readonly size?: number; // Outer diameter in px (default 210)
  readonly className?: string;
}

export function StudioColorDiscPicker({
  value,
  onChange,
  size = 210,
  className,
}: StudioColorDiscPickerProps) {
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(value));
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingHueRef = useRef(false);
  const isDraggingSvRef = useRef(false);

  // Sync internal HSV when external value changes
  useEffect(() => {
    const nextHsv = hexToHsv(value);
    setHsv((prev) => {
      // Avoid resetting hue if color is greyscale (where hue becomes 0)
      if (nextHsv.s === 0 && nextHsv.v === prev.v) {
        return { ...nextHsv, h: prev.h };
      }
      return nextHsv;
    });
  }, [value]);

  const radius = size / 2;
  const ringThickness = Math.round(size * 0.115); // ~24px
  const innerRadius = radius - ringThickness;
  const svBoxSize = Math.round(innerRadius * 1.25); // ~114px box inside

  // Calculate Hue Thumb position
  const hueAngleRad = (hsv.h * Math.PI) / 180;
  const ringCenterRadius = radius - ringThickness / 2;
  const hueThumbX = radius + ringCenterRadius * Math.cos(hueAngleRad);
  const hueThumbY = radius + ringCenterRadius * Math.sin(hueAngleRad);

  // Calculate SV Thumb position within SV box
  const svThumbX = (hsv.s / 100) * svBoxSize;
  const svThumbY = (1 - hsv.v / 100) * svBoxSize;

  const updateHueFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const centerX = rect.left + radius;
      const centerY = rect.top + radius;
      const dx = clientX - centerX;
      const dy = clientY - centerY;

      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 360;

      const nextHsv = { ...hsv, h: Math.round(angleDeg) };
      setHsv(nextHsv);
      onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
    },
    [hsv, onChange, radius]
  );

  const updateSvFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const box = containerRef.current?.querySelector<HTMLDivElement>("[data-sv-box]");
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const clampedY = Math.max(0, Math.min(rect.height, clientY - rect.top));

      const s = Math.round((clampedX / rect.width) * 100);
      const v = Math.round((1 - clampedY / rect.height) * 100);

      const nextHsv = { ...hsv, s, v };
      setHsv(nextHsv);
      onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
    },
    [hsv, onChange]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + radius);
    const dy = event.clientY - (rect.top + radius);
    const dist = Math.hypot(dx, dy);

    // If clicked on the outer ring
    if (dist >= innerRadius - 4 && dist <= radius + 6) {
      isDraggingHueRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      updateHueFromPointer(event.clientX, event.clientY);
    }
  };

  const handleSvPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    isDraggingSvRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSvFromPointer(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingHueRef.current) {
      updateHueFromPointer(event.clientX, event.clientY);
    }
  };

  const handleSvPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSvRef.current) {
      updateSvFromPointer(event.clientX, event.clientY);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingHueRef.current) {
      isDraggingHueRef.current = false;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture already released
      }
    }
  };

  const handleSvPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSvRef.current) {
      isDraggingSvRef.current = false;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture already released
      }
    }
  };

  const handleHueKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let delta = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = e.shiftKey ? 15 : 2;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = e.shiftKey ? -15 : -2;
    if (delta !== 0) {
      e.preventDefault();
      const nextH = (hsv.h + delta + 360) % 360;
      const nextHsv = { ...hsv, h: nextH };
      setHsv(nextHsv);
      onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
    }
  };

  const handleSvKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let ds = 0;
    let dv = 0;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowRight") ds = step;
    if (e.key === "ArrowLeft") ds = -step;
    if (e.key === "ArrowUp") dv = step;
    if (e.key === "ArrowDown") dv = -step;

    if (ds !== 0 || dv !== 0) {
      e.preventDefault();
      const nextS = Math.max(0, Math.min(100, hsv.s + ds));
      const nextV = Math.max(0, Math.min(100, hsv.v + dv));
      const nextHsv = { ...hsv, s: nextS, v: nextV };
      setHsv(nextHsv);
      onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
    }
  };

  const pureHueColor = `hsl(${hsv.h}, 100%, 50%)`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        data-studio-color-disc="true"
        className={`relative mx-auto select-none touch-none ${className ?? ""}`}
        style={{
          width: size,
          height: size,
        }}
      >
        {/* Outer Ring Ambient Glow & Backdrop */}
        <div
          className="absolute inset-0 rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.2)]"
          style={{
            background:
              "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            WebkitMask: `radial-gradient(circle at center, transparent ${innerRadius - 1}px, black ${innerRadius}px)`,
            mask: `radial-gradient(circle at center, transparent ${innerRadius - 1}px, black ${innerRadius}px)`,
          }}
        />

        {/* Inner boundary rim */}
        <div
          className="pointer-events-none absolute rounded-full border border-white/15"
          style={{
            width: innerRadius * 2,
            height: innerRadius * 2,
            left: ringThickness,
            top: ringThickness,
          }}
        />

        {/* Outer boundary rim */}
        <div className="pointer-events-none absolute inset-0 rounded-full border border-black/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)]" />

        {/* Hue Thumb (interactive via keyboard and touch) */}
        <button
          type="button"
          role="slider"
          aria-label="색상환 색조 각도"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={hsv.h}
          aria-valuetext={`${hsv.h}도`}
          onKeyDown={handleHueKeyDown}
          className="group absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,0.75),0_0_0_1px_rgba(0,0,0,0.3)] active:scale-125 transition-transform duration-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          style={{
            left: hueThumbX,
            top: hueThumbY,
            backgroundColor: pureHueColor,
          }}
        >
          <span className="block size-full rounded-full border border-black/20 shadow-inner" />
        </button>

        {/* Central Saturation-Value Square Box */}
        <div
          data-sv-box="true"
          onPointerDown={handleSvPointerDown}
          onPointerMove={handleSvPointerMove}
          onPointerUp={handleSvPointerUp}
          onPointerCancel={handleSvPointerUp}
          className="absolute cursor-crosshair overflow-hidden rounded-xl border border-white/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),0_6px_16px_rgba(0,0,0,0.55)] transition-shadow hover:shadow-[0_8px_20px_rgba(0,0,0,0.65)]"
          style={{
            width: svBoxSize,
            height: svBoxSize,
            left: (size - svBoxSize) / 2,
            top: (size - svBoxSize) / 2,
            backgroundColor: pureHueColor,
          }}
        >
          {/* Horizontal White gradient (Saturation 0% to 100%) */}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to right, #ffffff, transparent)",
            }}
          />
          {/* Vertical Black gradient (Value 100% to 0%) */}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to bottom, transparent, #000000)",
            }}
          />

          {/* SV Thumb precision crosshair cursor */}
          <button
            type="button"
            role="slider"
            aria-label="명도 및 채도 선택기"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hsv.v}
            aria-valuetext={`채도 ${hsv.s}%, 명도 ${hsv.v}%`}
            onKeyDown={handleSvKeyDown}
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.4)] active:scale-125 transition-transform duration-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            style={{
              left: svThumbX,
              top: svThumbY,
              backgroundColor: value,
            }}
          >
            <span className="block size-full rounded-full border border-black/30" />
          </button>
        </div>
      </div>

      {/* Floating Readout Pill: Exact H, S, V and Current Color Dot */}
      <div className="flex items-center gap-2 rounded-full border border-line/60 bg-raised/70 px-2.5 py-0.5 shadow-sm backdrop-blur-sm">
        <span
          className="size-2.5 rounded-full border border-black/20 shadow-sm"
          style={{ backgroundColor: value }}
        />
        <span className="font-mono text-[0.62rem] font-medium text-fg-2">
          H <span className="font-semibold text-fg-1">{hsv.h}°</span> · S <span className="font-semibold text-fg-1">{hsv.s}%</span> · V <span className="font-semibold text-fg-1">{hsv.v}%</span>
        </span>
      </div>
    </div>
  );
}
