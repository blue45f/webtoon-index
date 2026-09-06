import {
  STUDIO_COLOR_VISION_COACH_GRAYSCALE_SATURATION,
  STUDIO_COLOR_VISION_COACH_MATRIX,
} from "../studio-color-vision-coach";

import type { ReactElement } from "react";

type ColorVisionPreviewMode =
  | "original"
  | "grayscale"
  | "protanopia"
  | "deuteranopia"
  | "tritanopia";

const COLOR = {
  accent: "var(--color-accent, oklch(0.72 0.185 42))",
  canvas: "var(--color-canvas, oklch(0.155 0.008 70))",
  fg2: "var(--color-fg-2, oklch(0.74 0.012 78))",
  lineStrong: "var(--color-line-strong, oklch(0.42 0.013 64))",
  raised: "var(--color-raised, oklch(0.245 0.011 64))",
} as const;

const COLOR_VISION_ORIGINAL = [
  "oklch(0.72 0.185 42)",
  "oklch(0.8 0.15 150)",
  "oklch(0.76 0.13 245)",
  "oklch(0.84 0.14 90)",
] as const;

function normalizedVariant(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-");
}

function variantMatches(variant: string, candidate: string): boolean {
  return (
    variant === candidate ||
    variant.endsWith(`:${candidate}`) ||
    variant.endsWith(`-${candidate}`) ||
    variant.endsWith(`/${candidate}`)
  );
}

function studioColorVisionModeFromVariant(variant: string): ColorVisionPreviewMode {
  const normalized = normalizedVariant(variant);
  if (variantMatches(normalized, "grayscale")) return "grayscale";
  if (variantMatches(normalized, "protanopia")) return "protanopia";
  if (variantMatches(normalized, "deuteranopia")) return "deuteranopia";
  if (variantMatches(normalized, "tritanopia")) return "tritanopia";
  return "original";
}

function ColorVisionScene({
  x,
  filterId,
}: {
  x: number;
  filterId?: string;
}): ReactElement {
  return (
    <g transform={`translate(${x} 18)`} filter={filterId ? `url(#${filterId})` : undefined}>
      <rect
        width="68"
        height="68"
        rx="7"
        fill={COLOR.canvas}
        stroke={COLOR.lineStrong}
        strokeWidth="1.5"
      />
      <circle cx="20" cy="20" r="8" fill={COLOR_VISION_ORIGINAL[0]} />
      <path
        d="M9 53 27 34l13 12 9-8 11 15"
        fill={COLOR_VISION_ORIGINAL[2]}
        fillOpacity=".3"
        stroke={COLOR_VISION_ORIGINAL[2]}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <rect x="8" y="57" width="12" height="5" rx="2" fill={COLOR_VISION_ORIGINAL[0]} />
      <rect x="22" y="57" width="12" height="5" rx="2" fill={COLOR_VISION_ORIGINAL[1]} />
      <rect x="36" y="57" width="12" height="5" rx="2" fill={COLOR_VISION_ORIGINAL[2]} />
      <rect x="50" y="57" width="10" height="5" rx="2" fill={COLOR_VISION_ORIGINAL[3]} />
    </g>
  );
}

/**
 * Small enough to live with the tooltip shell, so a focused color-vision
 * control never waits for the full motion-coach catalog before showing the
 * exact selected simulation. The full preview reuses this renderer after its
 * optional module has loaded.
 */
export function StudioColorVisionHintPreview({
  animate,
  variant,
  filterId,
}: {
  animate: boolean;
  variant: string;
  filterId: string;
}): ReactElement {
  const mode = studioColorVisionModeFromVariant(variant);
  const restoreOriginal = mode === "original";
  const matrixMode = mode === "protanopia" || mode === "deuteranopia" || mode === "tritanopia"
    ? mode
    : null;
  const sourceFilterId = restoreOriginal ? filterId : undefined;
  const resultFilterId = restoreOriginal ? undefined : filterId;

  return (
    <g data-preview-operation={`color-vision-${mode}`}>
      {sourceFilterId || resultFilterId ? (
        <defs>
          <filter id={filterId} colorInterpolationFilters="linearRGB">
            {mode === "grayscale" || restoreOriginal ? (
              <feColorMatrix
                type="saturate"
                values={STUDIO_COLOR_VISION_COACH_GRAYSCALE_SATURATION}
              />
            ) : matrixMode ? (
              <feColorMatrix
                type="matrix"
                values={STUDIO_COLOR_VISION_COACH_MATRIX[matrixMode]}
              />
            ) : null}
          </filter>
        </defs>
      ) : null}
      <ColorVisionScene x={25} filterId={sourceFilterId} />
      <path
        d="M98 52h19m-6-6 6 6-6 6"
        fill="none"
        stroke={COLOR.fg2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        {animate ? (
          <animate
            attributeName="opacity"
            dur="2.6s"
            values=".28;1;1;.28"
            keyTimes="0;.35;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <g opacity={animate ? ".28" : "1"}>
        <ColorVisionScene x={123} filterId={resultFilterId} />
        {animate ? (
          <animate
            attributeName="opacity"
            dur="2.6s"
            values=".28;.28;1;1;.28"
            keyTimes="0;.22;.48;.78;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <rect
        x="137"
        y="8"
        width="40"
        height="17"
        rx="7"
        fill={COLOR.raised}
        stroke={mode === "original" ? COLOR.accent : COLOR.fg2}
        strokeWidth="1.2"
      />
      <text
        x="157"
        y="19.5"
        fill={mode === "original" ? COLOR.accent : COLOR.fg2}
        fontSize="8"
        fontWeight="800"
        textAnchor="middle"
      >
        {mode === "original"
          ? "ORIGINAL"
          : mode === "grayscale"
            ? "VALUE"
            : `CVD ${mode === "protanopia" ? "P" : mode === "deuteranopia" ? "D" : "T"}`}
      </text>
    </g>
  );
}
