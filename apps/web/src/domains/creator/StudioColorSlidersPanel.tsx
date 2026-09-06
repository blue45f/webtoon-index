/**
 * StudioColorSlidersPanel.tsx
 *
 * Professional Precision Sliders Panel for Studio Color Picker.
 * Features:
 * - RGB, HSV/HSB, and CIELAB color space sliders.
 * - Dynamic live-updating gradient slider tracks reflecting current channels.
 * - Exact numerical inputs and slider controls.
 * - High-definition visual tracks and badge labels.
 */

import { useState } from "react";

import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  rgbToHex,
  type HsvColor,
  type RgbColor,
} from "./studio-color-harmony-engine";
import { formatLabString, hexToLab, labToHex, type StudioLabColor } from "./studio-lab-color";

export interface StudioColorSlidersPanelProps {
  readonly value: string;
  readonly onChange: (hex: string) => void;
}

export function StudioColorSlidersPanel({
  value,
  onChange,
}: StudioColorSlidersPanelProps) {
  const [colorSpace, setColorSpace] = useState<"rgb" | "hsv" | "lab">("rgb");

  const rgb: RgbColor = hexToRgb(value);
  const hsv: HsvColor = hexToHsv(value);
  const lab: StudioLabColor = hexToLab(value);

  const handleRgbChange = (channel: keyof RgbColor, val: number) => {
    const nextRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, val)) };
    onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  const handleHsvChange = (channel: keyof HsvColor, val: number) => {
    const max = channel === "h" ? 360 : 100;
    const nextHsv = { ...hsv, [channel]: Math.max(0, Math.min(max, val)) };
    onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
  };

  const handleLabChange = (channel: keyof StudioLabColor, val: number) => {
    const nextLab = { ...lab };
    if (channel === "l") nextLab.l = Math.max(0, Math.min(100, val));
    if (channel === "a") nextLab.a = Math.max(-128, Math.min(127, val));
    if (channel === "b") nextLab.b = Math.max(-128, Math.min(127, val));
    onChange(labToHex(nextLab.l, nextLab.a, nextLab.b));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Color Space Toggle */}
      <div
        role="tablist"
        aria-label="색상 공간 선택"
        className="flex rounded-xl border border-line/70 bg-raised/50 p-1 backdrop-blur-sm"
      >
        {(["rgb", "hsv", "lab"] as const).map((space) => {
          const isActive = colorSpace === space;
          const labels = { rgb: "RGB", hsv: "HSV / HSB", lab: "CIELAB" };
          return (
            <button
              key={space}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`${labels[space]} 슬라이더`}
              onClick={() => setColorSpace(space)}
              className={`flex-1 rounded-lg py-1 text-[0.64rem] font-medium uppercase transition-all ${
                isActive
                  ? "bg-card text-accent font-semibold shadow-sm border border-accent/40"
                  : "text-fg-3 hover:text-fg-1"
              }`}
            >
              {labels[space]}
            </button>
          );
        })}
      </div>

      {/* RGB Mode */}
      {colorSpace === "rgb" && (
        <div className="space-y-2.5">
          {/* Red */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-bad/15 py-0.5 text-center font-mono text-[0.62rem] font-bold text-bad border border-bad/30">
              R
            </span>
            <input
              type="range"
              min={0}
              max={255}
              value={rgb.r}
              aria-label="빨강 채널 R"
              onChange={(e) => handleRgbChange("r", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background: `linear-gradient(to right, rgb(0, ${rgb.g}, ${rgb.b}), rgb(255, ${rgb.g}, ${rgb.b}))`,
              }}
            />
            <input
              type="number"
              min={0}
              max={255}
              value={rgb.r}
              aria-label="빨강 수치 입력"
              onChange={(e) => handleRgbChange("r", Number(e.target.value))}
              className="h-6 w-12 rounded-lg border border-line bg-card text-center font-mono text-xs tabular-nums text-fg focus:border-accent focus:outline-none shadow-sm"
            />
          </div>

          {/* Green */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-good/15 py-0.5 text-center font-mono text-[0.62rem] font-bold text-good border border-good/30">
              G
            </span>
            <input
              type="range"
              min={0}
              max={255}
              value={rgb.g}
              aria-label="초록 채널 G"
              onChange={(e) => handleRgbChange("g", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background: `linear-gradient(to right, rgb(${rgb.r}, 0, ${rgb.b}), rgb(${rgb.r}, 255, ${rgb.b}))`,
              }}
            />
            <input
              type="number"
              min={0}
              max={255}
              value={rgb.g}
              aria-label="초록 수치 입력"
              onChange={(e) => handleRgbChange("g", Number(e.target.value))}
              className="h-6 w-12 rounded-lg border border-line bg-card text-center font-mono text-xs tabular-nums text-fg focus:border-accent focus:outline-none shadow-sm"
            />
          </div>

          {/* Blue */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-accent/15 py-0.5 text-center font-mono text-[0.62rem] font-bold text-accent border border-accent/30">
              B
            </span>
            <input
              type="range"
              min={0}
              max={255}
              value={rgb.b}
              aria-label="파랑 채널 B"
              onChange={(e) => handleRgbChange("b", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background: `linear-gradient(to right, rgb(${rgb.r}, ${rgb.g}, 0), rgb(${rgb.r}, ${rgb.g}, 255))`,
              }}
            />
            <input
              type="number"
              min={0}
              max={255}
              value={rgb.b}
              aria-label="파랑 수치 입력"
              onChange={(e) => handleRgbChange("b", Number(e.target.value))}
              className="h-6 w-12 rounded-lg border border-line bg-card text-center font-mono text-xs tabular-nums text-fg focus:border-accent focus:outline-none shadow-sm"
            />
          </div>
        </div>
      )}

      {/* HSV / HSB Mode */}
      {colorSpace === "hsv" && (
        <div className="space-y-2.5">
          {/* Hue */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.62rem] font-bold text-fg-2 border border-line/70">
              H
            </span>
            <input
              type="range"
              min={0}
              max={360}
              value={hsv.h}
              aria-label="색상 H (Hue)"
              onChange={(e) => handleHsvChange("h", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background:
                  "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {hsv.h}°
            </div>
          </div>

          {/* Saturation */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.62rem] font-bold text-fg-2 border border-line/70">
              S
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsv.s}
              aria-label="채도 S (Saturation)"
              onChange={(e) => handleHsvChange("s", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background: `linear-gradient(to right, ${hsvToHex(hsv.h, 0, hsv.v)}, ${hsvToHex(hsv.h, 100, hsv.v)})`,
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {hsv.s}%
            </div>
          </div>

          {/* Brightness/Value */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.62rem] font-bold text-fg-2 border border-line/70">
              V
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsv.v}
              aria-label="명도 V (Value/Brightness)"
              onChange={(e) => handleHsvChange("v", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full shadow-inner"
              style={{
                background: `linear-gradient(to right, #000000, ${hsvToHex(hsv.h, hsv.s, 100)})`,
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {hsv.v}%
            </div>
          </div>
        </div>
      )}

      {/* CIELAB Mode */}
      {colorSpace === "lab" && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[0.62rem] text-fg-3 px-0.5">
            <span>지각 균일 색공간 (CIELAB)</span>
            <span className="font-mono text-fg-2 font-medium">{formatLabString(lab)}</span>
          </div>

          {/* L* */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.60rem] font-bold text-fg-2 border border-line/70">
              L*
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(lab.l)}
              aria-label="CIELAB 명도 L*"
              onChange={(e) => handleLabChange("l", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full accent-accent shadow-inner"
              style={{
                background: "linear-gradient(to right, #000000, #ffffff)",
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {Math.round(lab.l)}
            </div>
          </div>

          {/* a* */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.60rem] font-bold text-fg-2 border border-line/70">
              a*
            </span>
            <input
              type="range"
              min={-128}
              max={127}
              value={Math.round(lab.a)}
              aria-label="CIELAB 적녹 a*"
              onChange={(e) => handleLabChange("a", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full accent-accent shadow-inner"
              style={{
                background: "linear-gradient(to right, #00ff00, #808080, #ff00ff)",
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {Math.round(lab.a)}
            </div>
          </div>

          {/* b* */}
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 rounded bg-raised py-0.5 text-center font-mono text-[0.60rem] font-bold text-fg-2 border border-line/70">
              b*
            </span>
            <input
              type="range"
              min={-128}
              max={127}
              value={Math.round(lab.b)}
              aria-label="CIELAB 황청 b*"
              onChange={(e) => handleLabChange("b", Number(e.target.value))}
              className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full accent-accent shadow-inner"
              style={{
                background: "linear-gradient(to right, #0000ff, #808080, #ffff00)",
              }}
            />
            <div className="flex h-6 w-12 items-center justify-center rounded-lg border border-line bg-card font-mono text-xs tabular-nums text-fg shadow-sm">
              {Math.round(lab.b)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
