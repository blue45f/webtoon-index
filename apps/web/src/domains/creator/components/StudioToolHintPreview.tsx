import {
  useId,
  useSyncExternalStore,
  type ReactElement,
  type SVGProps,
} from "react";

import { STUDIO_PALETTES } from "../studio-color-palettes";

import { StudioColorVisionHintPreview } from "./StudioColorVisionHintPreview";
import {
  Camera3dPreview,
  CameraActionPreview,
  Lighting3dPreview,
  Object3dPreview,
  ObjectSnapPreview,
  ObjectTransformActionPreview,
  Pose3dPreview,
} from "./tool-hint-preview/studio-tool-hint-preview-3d";
import {
  BrushSizePreview,
  BrushWorkflowPreview,
  OpacityPreview,
  PressurePreview,
  StabilizerPreview,
  SymmetryPreview,
} from "./tool-hint-preview/studio-tool-hint-preview-brush-dynamics";
import {
  LassoPreview,
  PolygonLassoPreview,
  SelectionAdjustPreview,
  SelectionBoundaryPreview,
  SelectionBrushPreview,
  SelectionCombinePreview,
  SelectionContentTransformPreview,
  SelectionHistoryPreview,
  SelectionLayoutPreview,
  SelectionMarqueeTransformPreview,
} from "./tool-hint-preview/studio-tool-hint-preview-selection";
import { COLOR, previewVariantMatches } from "./tool-hint-preview/studio-tool-hint-preview-shared";
import {
  BackgroundLibraryPreview,
  CharacterBuilderPreview,
  CommentInboxPreview,
  CommentPreview,
  ContinuityCheckPreview,
  DrawWorkflowPreview,
  EditWorkflowPreview,
  FileWorkflowPreview,
  InsertContentPreview,
  MannequinPoserPreview,
  PanelLayoutPreview,
  ReviewWorkflowPreview,
  SettingsSlidersPreview,
  StoryboardGridPreview,
  StyleLibraryPreview,
  TeamCollaborationPreview,
  VerticalPreviewPreview,
  ViewWorkflowPreview,
  WorkspaceActionPreview,
  WorkspaceFocusPreview,
} from "./tool-hint-preview/studio-tool-hint-preview-workspace";

import type {
  StudioToolHintPreviewKind,
  StudioToolHintPreviewSpec,
} from "../studio-tool-hint-preview-kind";

/**
 * Small, semantic tool demonstrations used by the Studio's rich hints.
 *
 * Keep this list deliberately finite: every supported kind has a designed
 * preview rather than falling back to an unrelated generic animation.
 */
export type { StudioToolHintPreviewKind } from "../studio-tool-hint-preview-kind";

export type StudioToolHintPreviewProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "viewBox" | "kind"
> & StudioToolHintPreviewSpec & {
  /** Overrides the operating-system preference. Useful for deterministic tests. */
  reducedMotion?: boolean;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function normalizePreviewVariant(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-");
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => undefined;

  const media = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }

  // Older iPadOS WebViews expose only the legacy MediaQueryList listener API.
  media.addListener(onChange);
  return () => media.removeListener(onChange);
}

function systemPrefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia(REDUCED_MOTION_QUERY).matches
    : true;
}

function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    systemPrefersReducedMotion,
    () => true
  );
}

function SelectionPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g data-preview-motion={animate ? "select" : undefined}>
        <path
          d="M66 29c14-7 35-4 44 9 7 10 4 24-8 31-13 8-34 5-42-7-7-10-4-26 6-33Z"
          fill={COLOR.accentSoft}
          stroke={COLOR.accent}
          strokeWidth="2"
        />
        <rect
          x="53"
          y="20"
          width="72"
          height="59"
          rx="2"
          fill="none"
          stroke={COLOR.fg2}
          strokeDasharray="4 3"
          strokeWidth="1.25"
        />
        {[
          [53, 20],
          [89, 20],
          [125, 20],
          [53, 49.5],
          [125, 49.5],
          [53, 79],
          [89, 79],
          [125, 79],
        ].map(([x, y]) => (
          <rect
            key={`${x}-${y}`}
            x={x - 2.5}
            y={y - 2.5}
            width="5"
            height="5"
            rx="1"
            fill={COLOR.canvas}
            stroke={COLOR.accent}
            strokeWidth="1.25"
          />
        ))}
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.8s"
            values="0 0; 9 -3; 9 -3; 0 0"
            keyTimes="0; .34; .72; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <path
        d="m138 63 7 20 4.5-7.5 8 7 4-4-8-7 8-4.5-23.5-4Z"
        fill={COLOR.fg}
        stroke={COLOR.canvas}
        strokeLinejoin="round"
        strokeWidth="2"
      >
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.8s"
            values="13 8; 0 0; 0 0; 13 8"
            keyTimes="0; .34; .72; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
    </>
  );
}

function InkPreview({ animate }: { animate: boolean }): ReactElement {
  const strokePath = "M38 65c20-25 31 17 48-8 14-21 28-27 41-10 12 15 27 13 43-7";

  return (
    <>
      <path
        d={strokePath}
        fill="none"
        stroke={COLOR.lineStrong}
        strokeLinecap="round"
        strokeWidth="1.5"
        opacity=".35"
      />
      <path
        d={strokePath}
        fill="none"
        stroke={COLOR.accent}
        strokeDasharray="178"
        strokeDashoffset={animate ? "178" : "0"}
        strokeLinecap="round"
        strokeWidth="4.5"
      >
        {animate ? (
          <animate
            attributeName="stroke-dashoffset"
            dur="2.6s"
            values="178; 0; 0"
            keyTimes="0; .72; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <g transform={animate ? undefined : "translate(170 40) rotate(-18)"}>
        <path
          d="M-7-13 7-13 5 7 0 14-5 7Z"
          fill={COLOR.fg2}
          stroke={COLOR.canvas}
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path d="M0 14 5 7h-10Z" fill={COLOR.accent} />
        {animate ? (
          <>
            <animateMotion
              dur="2.6s"
              path={strokePath}
              rotate="auto"
              keyPoints="0; 1; 1"
              keyTimes="0; .72; 1"
              calcMode="spline"
              keySplines=".16 1 .3 1; .16 1 .3 1"
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              additive="sum"
              type="rotate"
              values="-18; -18"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </>
        ) : null}
      </g>
    </>
  );
}

function ErasePreview({ animate }: { animate: boolean }): ReactElement {
  const strokePath = "M40 59c27-18 42 18 65-2 20-17 36 3 62-17";

  return (
    <>
      <path
        d={strokePath}
        fill="none"
        stroke={COLOR.accent}
        strokeLinecap="round"
        strokeWidth="7"
        opacity=".9"
      />
      <path
        d={strokePath}
        fill="none"
        stroke={COLOR.card}
        strokeDasharray="190"
        strokeDashoffset={animate ? "190" : "74"}
        strokeLinecap="round"
        strokeWidth="9"
      >
        {animate ? (
          <animate
            attributeName="stroke-dashoffset"
            dur="2.8s"
            values="190; 18; 18"
            keyTimes="0; .7; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <path
        d={strokePath}
        fill="none"
        stroke={COLOR.lineStrong}
        strokeDasharray="2 6"
        strokeLinecap="round"
        strokeWidth="1.5"
        opacity=".45"
      />
      <g transform={animate ? undefined : "translate(108 54) rotate(-16)"}>
        <rect
          x="-11"
          y="-8"
          width="22"
          height="16"
          rx="4"
          fill={COLOR.fg2}
          stroke={COLOR.canvas}
          strokeWidth="2"
        />
        <path d="M0-8h7a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H0Z" fill={COLOR.accent} />
        {animate ? (
          <>
            <animateMotion
              dur="2.8s"
              path={strokePath}
              rotate="auto"
              keyPoints="0; .92; .92"
              keyTimes="0; .7; 1"
              calcMode="spline"
              keySplines=".16 1 .3 1; .16 1 .3 1"
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              additive="sum"
              type="rotate"
              values="-16; -16"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </>
        ) : null}
      </g>
    </>
  );
}

function FillPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <path
        d="M56 30c13-11 43-11 55 2 10 11 7 20 20 25 12 4 11 17-1 22-15 6-28-2-42 0-18 2-39-5-38-22 1-11-4-18 6-27Z"
        fill={COLOR.raised}
        stroke={COLOR.fg2}
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M57 31c13-10 41-10 52 2 10 11 7 21 20 25 10 4 10 14-1 18-14 6-27-1-40 1-17 2-36-5-35-20 0-11-4-17 4-26Z"
        fill={COLOR.accent}
        opacity={animate ? ".08" : ".82"}
      >
        {animate ? (
          <animate
            attributeName="opacity"
            dur="2.5s"
            values=".08; .08; .82; .82"
            keyTimes="0; .28; .48; 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <g transform="translate(150 34) rotate(-28)">
        <path
          d="m-12-5 17-8 10 21-17 8Z"
          fill={COLOR.fg2}
          stroke={COLOR.canvas}
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path d="M3-12 9-15l10 21-6 3Z" fill={COLOR.accent} />
        <path d="m-2 16 10 5 7-13Z" fill={COLOR.cool} opacity=".8" />
      </g>
      <circle cx="119" cy="50" r={animate ? "2" : "13"} fill="none" stroke={COLOR.fg} strokeWidth="1.5" opacity={animate ? "0" : ".35"}>
        {animate ? (
          <>
            <animate attributeName="r" dur="2.5s" values="2; 2; 15; 15" keyTimes="0; .27; .48; 1" repeatCount="indefinite" />
            <animate attributeName="opacity" dur="2.5s" values="0; .65; 0; 0" keyTimes="0; .27; .48; 1" repeatCount="indefinite" />
          </>
        ) : null}
      </circle>
    </>
  );
}

function SamplePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[COLOR.cool, COLOR.accent, COLOR.fg2].map((fill, index) => (
        <circle
          key={fill}
          cx={54 + index * 30}
          cy="53"
          r="13"
          fill={fill}
          opacity={index === 1 ? ".95" : ".72"}
          stroke={index === 1 ? COLOR.fg : COLOR.lineStrong}
          strokeWidth={index === 1 ? "2" : "1"}
        />
      ))}
      <circle cx="84" cy="53" r="19" fill="none" stroke={COLOR.accent} strokeWidth="1.5" opacity={animate ? ".2" : ".55"}>
        {animate ? (
          <animate attributeName="r" dur="2.7s" values="15; 15; 21; 15" keyTimes="0; .4; .62; 1" repeatCount="indefinite" />
        ) : null}
      </circle>
      <g transform={animate ? undefined : "translate(113 36) rotate(-38)"}>
        <path d="M-3-18h6V6h-6Z" fill={COLOR.fg2} stroke={COLOR.canvas} strokeWidth="1.5" />
        <path d="m-5 6 10 0-5 12Z" fill={COLOR.accent} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="1.5" />
        <rect x="-7" y="-22" width="14" height="6" rx="2" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="1.5" />
        {animate ? (
          <>
            <animateTransform
              attributeName="transform"
              type="translate"
              dur="2.7s"
              values="147 30; 112 36; 112 36; 147 30"
              keyTimes="0; .36; .68; 1"
              calcMode="spline"
              keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              additive="sum"
              type="rotate"
              values="-38; -38"
              dur="2.7s"
              repeatCount="indefinite"
            />
          </>
        ) : null}
      </g>
      <rect x="153" y="34" width="29" height="38" rx="5" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <rect x="158" y="39" width="19" height="28" rx="3" fill={COLOR.accent}>
        {animate ? (
          <animate attributeName="opacity" dur="2.7s" values=".25; .25; 1; 1" keyTimes="0; .38; .52; 1" repeatCount="indefinite" />
        ) : null}
      </rect>
    </>
  );
}

const COLOR_PREVIEW_SWATCHES = [
  "oklch(0.78 0.15 28)",
  "oklch(0.84 0.13 76)",
  "oklch(0.74 0.14 151)",
  "oklch(0.76 0.12 232)",
  "oklch(0.7 0.16 304)",
] as const;

/** Palette selection preview shared by the color trigger, palette tabs, and swatches. */
function ColorPalettePreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const builtInPalette = STUDIO_PALETTES.find((palette) =>
    previewVariantMatches(variant, `palette-${palette.id}`)
  );
  if (builtInPalette) {
    const swatches = [0, 2, 4, 6, 8, builtInPalette.colors.length - 1]
      .map((index) => builtInPalette.colors[index])
      .filter((color): color is string => color !== undefined);
    return (
      <g data-preview-operation={`palette-${builtInPalette.id}`}>
        <rect x="35" y="13" width="146" height="78" rx="10" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.5" />
        <text x="46" y="29" fill={COLOR.fg} fontSize="9" fontWeight="800">
          {builtInPalette.label}
        </text>
        <g transform="translate(46 36)">
          <rect width="124" height="30" rx="7" fill={swatches[0]} opacity=".92" />
          <path d="M0 30 29 9l19 13L67 6l30 24Z" fill={swatches[3]} opacity=".9" />
          <circle cx="103" cy="11" r="8" fill={swatches[4]} />
          <path d="M0 30h124" stroke={swatches[5]} strokeWidth="3" />
        </g>
        <g transform="translate(46 73)">
          {swatches.map((color, index) => (
            <g key={`${color}-${index}`} transform={`translate(${index * 21} 0)`}>
              <rect width="17" height="11" rx="3" fill={color} stroke={index === 3 ? COLOR.fg : COLOR.lineStrong} strokeWidth={index === 3 ? "1.8" : "1"} />
              {index === 3 ? (
                <rect width="17" height="11" rx="3" fill="none" stroke={COLOR.accent} opacity={animate ? ".28" : ".9"}>
                  {animate ? <animate attributeName="opacity" dur="1.8s" values=".25;1;.25" repeatCount="indefinite" /> : null}
                </rect>
              ) : null}
            </g>
          ))}
        </g>
      </g>
    );
  }
  const primaryColor = previewVariantMatches(variant, "primary-color");
  const secondaryColor = previewVariantMatches(variant, "secondary-color");
  const swapColors = previewVariantMatches(variant, "swap-colors");
  if (primaryColor || secondaryColor || swapColors) {
    const operation = primaryColor
      ? "primary-color"
      : secondaryColor
        ? "secondary-color"
        : "swap-colors";
    const primaryFill = COLOR_PREVIEW_SWATCHES[0];
    const secondaryFill = COLOR_PREVIEW_SWATCHES[3];
    const shouldSwap = swapColors && animate;

    return (
      <g data-preview-operation={operation}>
        <rect x="47" y="20" width="122" height="65" rx="10" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <g>
          <rect
            x="69"
            y="31"
            width="49"
            height="42"
            rx="8"
            fill={primaryFill}
            stroke={primaryColor ? COLOR.fg : COLOR.lineStrong}
            strokeWidth={primaryColor ? "3" : "1.5"}
          />
          {shouldSwap ? (
            <animateTransform
              attributeName="transform"
              type="translate"
              dur="2.8s"
              values="0 0;42 19;42 19;0 0"
              keyTimes="0;.42;.72;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
        <g>
          <rect
            x="111"
            y="50"
            width="49"
            height="42"
            rx="8"
            fill={secondaryFill}
            stroke={secondaryColor ? COLOR.fg : COLOR.lineStrong}
            strokeWidth={secondaryColor ? "3" : "1.5"}
          />
          {shouldSwap ? (
            <animateTransform
              attributeName="transform"
              type="translate"
              dur="2.8s"
              values="0 0;-42 -19;-42 -19;0 0"
              keyTimes="0;.42;.72;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
        {swapColors ? (
          <g fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5">
            <path d="M61 70c-8-13-5-29 6-39m0 0-1 10m1-10-10 2" />
            <path d="M173 42c8 13 5 29-6 39m0 0 1-10m-1 10 10-2" />
            {animate ? (
              <animate attributeName="stroke-dasharray" dur="1.4s" values="1 7;9 3;1 7" repeatCount="indefinite" />
            ) : null}
          </g>
        ) : (
          <>
            <circle
              cx={primaryColor ? "94" : "136"}
              cy={primaryColor ? "52" : "71"}
              r="29"
              fill="none"
              stroke={COLOR.accent}
              strokeWidth="2"
              opacity={animate ? ".25" : ".78"}
            >
              {animate ? (
                <animate attributeName="r" dur="2s" values="24;31;24" repeatCount="indefinite" />
              ) : null}
            </circle>
            <text
              x={primaryColor ? "94" : "136"}
              y={primaryColor ? "56" : "75"}
              fill={COLOR.fg}
              fontSize="10"
              fontWeight="800"
              textAnchor="middle"
            >
              {primaryColor ? "주" : "보조"}
            </text>
          </>
        )}
      </g>
    );
  }

  const bubbleFill = previewVariantMatches(variant, "bubble-fill");
  const paletteFamily = previewVariantMatches(variant, "palette-family");
  const recentSwatch = previewVariantMatches(variant, "recent-swatch");
  const paletteSwatch = previewVariantMatches(variant, "palette-swatch");
  const operation = bubbleFill
    ? "bubble-fill"
    : paletteFamily
      ? "palette-family"
      : recentSwatch
        ? "recent-swatch"
        : paletteSwatch
          ? "palette-swatch"
          : "brush-shape";
  const selectedIndex = bubbleFill ? 4 : paletteFamily ? 2 : recentSwatch ? 1 : paletteSwatch ? 3 : 0;
  const selectedColor = COLOR_PREVIEW_SWATCHES[selectedIndex];
  const selectedX = 53 + selectedIndex * 28;

  return (
    <g data-preview-operation={operation}>
      {paletteFamily ? (
        <>
          {["인물", "배경", "무드"].map((label, index) => (
            <g key={label} transform={`translate(${45 + index * 48} 22)`}>
              <rect
                width="42"
                height="16"
                rx="5"
                fill={index === 1 ? COLOR.accentSoft : COLOR.canvas}
                stroke={index === 1 ? COLOR.accent : COLOR.lineStrong}
              />
              <text
                x="21"
                y="11"
                fill={index === 1 ? COLOR.accent : COLOR.fg3}
                fontSize="7.5"
                fontWeight="700"
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          ))}
          <rect x="88" y="18" width="42" height="24" rx="7" fill="none" stroke={COLOR.accent} opacity={animate ? ".28" : ".72"}>
            {animate ? (
              <animate attributeName="opacity" dur="2.4s" values=".2;.8;.2" repeatCount="indefinite" />
            ) : null}
          </rect>
        </>
      ) : bubbleFill ? (
        <path
          d="M58 23h75c14 0 23 9 23 20v10c0 12-9 20-23 20H98L82 86l3-13H58c-14 0-23-8-23-20V43c0-11 9-20 23-20Z"
          fill={selectedColor}
          fillOpacity={animate ? ".18" : ".82"}
          stroke={COLOR.fg2}
          strokeWidth="2"
          strokeLinejoin="round"
        >
          {animate ? (
            <animate attributeName="fill-opacity" dur="2.7s" values=".18;.18;.82;.82" keyTimes="0;.28;.52;1" repeatCount="indefinite" />
          ) : null}
        </path>
      ) : paletteSwatch || recentSwatch ? (
        <>
          <rect x="72" y="17" width="72" height="48" rx="9" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
          <rect
            x="78"
            y="23"
            width="60"
            height="36"
            rx="6"
            fill={selectedColor}
            opacity={animate ? ".32" : "1"}
          >
            {animate ? (
              <animate attributeName="opacity" dur="2.5s" values=".32;1;1;.32" keyTimes="0;.34;.72;1" repeatCount="indefinite" />
            ) : null}
          </rect>
          {paletteSwatch ? (
            <path d="m98 41 7 7 14-16" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          ) : (
            <path d="M91 42h34m-28-8-8 8 8 8" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
          )}
        </>
      ) : (
        <>
          <path
            d="M40 39c19-19 34 16 54-3 17-16 30 10 48-8"
            fill="none"
            stroke={selectedColor}
            strokeLinecap="round"
            strokeWidth="7"
            opacity={animate ? ".28" : ".96"}
          >
            {animate ? (
              <animate attributeName="opacity" dur="2.6s" values=".28;.28;.96;.96" keyTimes="0;.3;.5;1" repeatCount="indefinite" />
            ) : null}
          </path>
          <rect
            x="145"
            y="20"
            width="31"
            height="31"
            rx="5"
            fill={selectedColor}
            fillOpacity={animate ? ".16" : ".74"}
            stroke={selectedColor}
            strokeWidth="2"
          >
            {animate ? (
              <animate attributeName="fill-opacity" dur="2.6s" values=".16;.16;.74;.74" keyTimes="0;.3;.5;1" repeatCount="indefinite" />
            ) : null}
          </rect>
        </>
      )}

      <g transform="translate(0 2)">
        {COLOR_PREVIEW_SWATCHES.map((fill, index) => (
          <rect
            key={fill}
            x={43 + index * 28}
            y="72"
            width="20"
            height="16"
            rx="4"
            fill={fill}
            stroke={index === selectedIndex ? COLOR.fg : COLOR.lineStrong}
            strokeWidth={index === selectedIndex ? "2" : "1"}
          />
        ))}
        <rect
          x={selectedX - 12}
          y="68"
          width="24"
          height="24"
          rx="6"
          fill="none"
          stroke={COLOR.accent}
          strokeWidth="1.5"
          opacity={animate ? ".25" : ".76"}
        >
          {animate ? (
            <animate attributeName="opacity" dur="1.5s" values=".25;.86;.25" repeatCount="indefinite" />
          ) : null}
        </rect>
      </g>
      <path
        d="m164 63 6 17 4-6 7 6 3-3-7-6 7-4Z"
        fill={COLOR.fg}
        stroke={COLOR.canvas}
        strokeLinejoin="round"
        strokeWidth="1.7"
      >
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.6s"
            values={`${selectedX - 164} 9;${selectedX - 164} 9;0 0;0 0;${selectedX - 164} 9`}
            keyTimes="0;.22;.44;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
    </g>
  );
}

function ShapePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <path
        d="M50 68 63 28l55-4 17 44-16 9-59-3Z"
        fill="none"
        stroke={COLOR.fg3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        opacity={animate ? ".55" : ".2"}
      >
        {animate ? (
          <animate attributeName="opacity" dur="2.9s" values=".55; .55; .12; .12" keyTimes="0; .28; .5; 1" repeatCount="indefinite" />
        ) : null}
      </path>
      <rect
        x="57"
        y="26"
        width="72"
        height="48"
        rx="7"
        fill={COLOR.accentSoft}
        stroke={COLOR.accent}
        strokeDasharray="246"
        strokeDashoffset={animate ? "246" : "0"}
        strokeWidth="2.5"
      >
        {animate ? (
          <animate attributeName="stroke-dashoffset" dur="2.9s" values="246; 246; 0; 0" keyTimes="0; .3; .62; 1" repeatCount="indefinite" />
        ) : null}
      </rect>
      <path d="m149 68 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2">
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.9s"
            values="-20 -42; 0 0; 0 0"
            keyTimes="0; .54; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
    </>
  );
}

type DirectShapeKind =
  | "line"
  | "rect"
  | "ellipse"
  | "star"
  | "arrow"
  | "triangle"
  | "polygon";

function directShapeKindFromVariant(variant: string): DirectShapeKind | null {
  const kinds = [
    "line",
    "rect",
    "ellipse",
    "star",
    "arrow",
    "triangle",
    "polygon",
  ] as const;
  return kinds.find((kind) => previewVariantMatches(variant, kind)) ?? null;
}

/** Direct vector-shape drawing, deliberately distinct from Smart Shape's scribble correction. */
function DirectShapePreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const shapeKind = directShapeKindFromVariant(variant);
  if (shapeKind) {
    const shapes: Record<
      DirectShapeKind,
      Readonly<{
        d: string;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        dashLength: number;
        fill: boolean;
      }>
    > = {
      line: {
        d: "M57 75 159 29",
        startX: 57,
        startY: 75,
        endX: 159,
        endY: 29,
        dashLength: 112,
        fill: false,
      },
      rect: {
        d: "M58 30H158V76H58Z",
        startX: 58,
        startY: 30,
        endX: 158,
        endY: 76,
        dashLength: 292,
        fill: true,
      },
      ellipse: {
        d: "M58 53a50 27 0 1 0 100 0 50 27 0 1 0-100 0",
        startX: 58,
        startY: 26,
        endX: 158,
        endY: 80,
        dashLength: 248,
        fill: true,
      },
      star: {
        d: "m108 20 10 22 24-3-18 17 9 23-25-12-25 12 9-23-18-17 24 3Z",
        startX: 74,
        startY: 20,
        endX: 142,
        endY: 79,
        dashLength: 260,
        fill: true,
      },
      arrow: {
        d: "M54 45h70V29l39 24-39 24V61H54Z",
        startX: 54,
        startY: 29,
        endX: 163,
        endY: 77,
        dashLength: 294,
        fill: false,
      },
      triangle: {
        d: "M108 21 162 79H54Z",
        startX: 54,
        startY: 21,
        endX: 162,
        endY: 79,
        dashLength: 214,
        fill: true,
      },
      polygon: {
        d: "M64 40 101 20 150 34 162 68 122 84 72 73Z",
        startX: 64,
        startY: 20,
        endX: 162,
        endY: 84,
        dashLength: 246,
        fill: true,
      },
    };
    const shape = shapes[shapeKind];
    return (
      <>
        <rect
          x="40"
          y="14"
          width="136"
          height="76"
          rx="7"
          fill={COLOR.canvas}
          stroke={COLOR.lineStrong}
        />
        <path
          d={shape.d}
          fill={shape.fill ? COLOR.accentSoft : "none"}
          stroke={COLOR.fg3}
          strokeWidth="5"
          opacity=".16"
        />
        {shapeKind === "line" ? (
          <path
            d={shape.d}
            data-preview-operation={`shape-${shapeKind}`}
            fill="none"
            stroke={COLOR.accent}
            strokeDasharray={shape.dashLength}
            strokeDashoffset={animate ? shape.dashLength : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          >
            {animate ? (
              <animate
                attributeName="stroke-dashoffset"
                dur="2.6s"
                values={`${shape.dashLength};0;0`}
                keyTimes="0;.7;1"
                repeatCount="indefinite"
              />
            ) : null}
          </path>
        ) : (
          <g transform={`translate(${shape.startX} ${shape.startY})`}>
            <g transform={animate ? "scale(.04 .04)" : "scale(1 1)"}>
              <g transform={`translate(${-shape.startX} ${-shape.startY})`}>
                <path
                  d={shape.d}
                  data-preview-operation={`shape-${shapeKind}`}
                  fill={shape.fill ? COLOR.accentSoft : "none"}
                  stroke={COLOR.accent}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
              {animate ? (
                <animateTransform
                  attributeName="transform"
                  type="scale"
                  dur="2.6s"
                  values=".04 .04;1 1;1 1;.04 .04"
                  keyTimes="0;.7;.86;1"
                  repeatCount="indefinite"
                />
              ) : null}
            </g>
          </g>
        )}
        {shapeKind !== "line" ? (
          <rect
            x={shape.startX}
            y={shape.startY}
            width={shape.endX - shape.startX}
            height={shape.endY - shape.startY}
            rx="3"
            fill="none"
            stroke={COLOR.fg3}
            strokeDasharray="4 4"
            strokeWidth="1"
            opacity=".36"
          />
        ) : null}
        <g
          transform={animate ? undefined : `translate(${shape.endX} ${shape.endY})`}
        >
          <path
            d="m0 0 7 18 4-7 7 6 4-4-7-6 7-4Z"
            fill={COLOR.fg}
            stroke={COLOR.canvas}
            strokeLinejoin="round"
            strokeWidth="2"
          />
          {animate ? (
            <animateMotion
              dur="2.6s"
              path={`M${shape.startX} ${shape.startY} ${shape.endX} ${shape.endY}`}
              keyPoints="0;1;1"
              keyTimes="0;.7;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
      </>
    );
  }

  return (
    <>
      <rect x="40" y="18" width="136" height="68" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d="M58 71V35h52v36Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2.5" />
      <ellipse cx="141" cy="53" rx="22" ry="18" fill={COLOR.raised} stroke={COLOR.cool} strokeWidth="2" />
      <path
        d="M58 35h52v36H58Z"
        fill="none"
        stroke={COLOR.fg}
        strokeDasharray="176"
        strokeDashoffset={animate ? "176" : "0"}
        strokeWidth="1.5"
      >
        {animate ? (
          <animate
            attributeName="stroke-dashoffset"
            dur="2.7s"
            values="176;0;0"
            keyTimes="0;.68;1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <g transform={animate ? undefined : "translate(110 71)"}>
        <path d="m0 0 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
        {animate ? (
          <animateMotion
            dur="2.7s"
            path="M58 35H110V71H58V35"
            keyPoints="0;1;1"
            keyTimes="0;.68;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    </>
  );
}

function TextPreview({ animate, clipId }: { animate: boolean; clipId: string }): ReactElement {
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x="49" y="25" width={animate ? "0" : "102"} height="54">
            {animate ? (
              <animate attributeName="width" dur="2.8s" values="0; 0; 102; 102" keyTimes="0; .15; .65; 1" repeatCount="indefinite" />
            ) : null}
          </rect>
        </clipPath>
      </defs>
      <rect x="42" y="20" width="120" height="61" rx="5" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeDasharray="4 3" />
      <g clipPath={`url(#${clipId})`}>
        <text
          x="52"
          y="61"
          fill={COLOR.fg}
          fontFamily="var(--font-sans, sans-serif)"
          fontSize="29"
          fontWeight="750"
        >
          웹툰
        </text>
        <path d="M52 69h78" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
      </g>
      <rect x={animate ? "51" : "133"} y="31" width="2" height="37" rx="1" fill={COLOR.accent}>
        {animate ? (
          <>
            <animate attributeName="x" dur="2.8s" values="51; 51; 133; 133" keyTimes="0; .15; .65; 1" repeatCount="indefinite" />
            <animate attributeName="opacity" dur=".8s" values="1; 1; .18; .18; 1" keyTimes="0; .45; .5; .95; 1" repeatCount="indefinite" />
          </>
        ) : null}
      </rect>
      <path d="M173 28v12M167 34h12" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
    </>
  );
}

function BubblePreview({ animate, variant }: { animate: boolean; variant: string }): ReactElement {
  const openLibrary = previewVariantMatches(variant, "open-library");
  const fitText = previewVariantMatches(variant, "fit-text");
  if (openLibrary) {
    return (
      <g data-preview-operation="bubble-open-library">
        <rect x="34" y="14" width="148" height="77" rx="9" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.5" />
        <path d="M45 28h56M45 35h37" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
        {[
          "M45 49h34c5 0 8 3 8 7v7c0 4-3 7-8 7H63l-8 8 2-8H45c-5 0-8-3-8-7v-7c0-4 3-7 8-7Z",
          "M98 47h31c7 0 11 5 11 11s-4 11-11 11h-13l-9 9 2-9H98c-7 0-11-5-11-11s4-11 11-11Z",
          "M148 49h22c6 0 10 4 10 10v3c0 6-4 10-10 10h-8l-7 7 1-7h-8c-6 0-10-4-10-10v-3c0-6 4-10 10-10Z",
        ].map((path, index) => (
          <path
            key={path}
            d={path}
            fill={index === 1 ? COLOR.accentSoft : COLOR.card}
            stroke={index === 1 ? COLOR.accent : COLOR.fg2}
            strokeWidth={index === 1 ? "2" : "1.4"}
            opacity={animate && index === 1 ? ".42" : "1"}
          >
            {animate && index === 1 ? <animate attributeName="opacity" dur="1.8s" values=".4;1;.4" repeatCount="indefinite" /> : null}
          </path>
        ))}
        <path d="M166 20v15m-7-7 7 7 7-7" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      </g>
    );
  }
  if (fitText) {
    return (
      <g data-preview-operation="bubble-fit-text">
        <path
          d="M48 25h120c8 0 14 6 14 14v35c0 8-6 14-14 14H101L82 99l5-11H48c-8 0-14-6-14-14V39c0-8 6-14 14-14Z"
          fill={COLOR.canvas}
          stroke={COLOR.fg3}
          strokeDasharray="4 3"
          strokeWidth="1.5"
          opacity=".42"
        />
        <g transform={animate ? undefined : "translate(0 10) scale(1 .78)"}>
          <path d="M48 25h120c8 0 14 6 14 14v35c0 8-6 14-14 14H101L82 99l5-11H48c-8 0-14-6-14-14V39c0-8 6-14 14-14Z" fill={COLOR.card} stroke={COLOR.accent} strokeWidth="2">
            {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="0 0;0 10;0 10;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </path>
          {animate ? <animateTransform attributeName="transform" type="scale" additive="sum" dur="2.8s" values="1 1;1 .78;1 .78;1 1" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </g>
        <path d="M64 43h82M64 54h69M64 65h78" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2.4" />
        <path d="M190 31v48m0-48-6 7m6-7 6 7m-6 41-6-7m6 7 6-7" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      </g>
    );
  }
  return (
    <g data-preview-operation="bubble-add">
      <path
        d="M44 31c0-9 8-16 18-16h87c11 0 19 7 19 16v27c0 9-8 16-19 16H94L76 86l4-12H62c-10 0-18-7-18-16Z"
        fill={COLOR.fg}
        stroke={COLOR.lineStrong}
        strokeLinejoin="round"
        strokeWidth="2"
        transform={animate ? undefined : "scale(1)"}
      >
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="scale"
            additive="sum"
            dur="2.8s"
            values=".94; 1; 1; .94"
            keyTimes="0; .22; .82; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </path>
      <g fill={COLOR.canvas}>
        {[81, 106, 131].map((cx, index) => (
          <circle key={cx} cx={cx} cy="46" r="5" opacity={animate ? ".28" : "1"}>
            {animate ? (
              <animate
                attributeName="opacity"
                dur="1.4s"
                begin={`${index * 0.16}s`}
                values=".28; 1; .28"
                keyTimes="0; .38; 1"
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
        ))}
      </g>
      <path d="M177 22v11M171.5 27.5h11" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
    </g>
  );
}

function ImagePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g data-preview-motion={animate ? "image" : undefined}>
        <rect x="49" y="17" width="108" height="69" rx="6" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
        <circle cx="75" cy="39" r="8" fill={COLOR.accent} opacity=".92" />
        <path d="m54 76 28-28 18 17 14-13 38 24Z" fill={COLOR.cool} opacity=".58" />
        <path d="m54 76 28-28 18 17" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="m100 65 14-13 38 24" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="3s"
            values="0 5; 0 0; 0 0; 0 5"
            keyTimes="0; .28; .78; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <g fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2">
        <path d="M42 31V12h19M164 12h19v19M183 72v19h-19M61 91H42V72" />
      </g>
    </>
  );
}

const FILTER_PREVIEW_ENGINES = [
  "gaussian-blur",
  "motion-blur",
  "blur",
  "curves",
  "levels",
  "brightness-contrast",
  "hue-saturation",
  "color-balance",
  "channel-mixer",
  "gradient-map",
  "sharpen",
  "noise",
  "invert",
] as const;

type FilterPreviewEngine = (typeof FILTER_PREVIEW_ENGINES)[number];

function filterPreviewEngine(variant: string): FilterPreviewEngine | null {
  return FILTER_PREVIEW_ENGINES.find((engine) => previewVariantMatches(variant, engine)) ?? null;
}

function FilterEnginePreview({
  animate,
  engine,
}: {
  animate: boolean;
  engine: FilterPreviewEngine;
}): ReactElement {
  const frame = <rect x="39" y="16" width="138" height="72" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.7" />;

  if (engine === "curves") {
    return <>{frame}<path d="M55 76V29h105M58 72c30 0 32-35 59-35 19 0 19 23 42 23" fill="none" stroke={COLOR.accent} strokeDasharray="148" strokeDashoffset={animate ? "148" : "0"} strokeLinecap="round" strokeWidth="3">{animate ? <animate attributeName="stroke-dashoffset" dur="2.7s" values="148;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}</path><circle cx="90" cy="51" r="4" fill={COLOR.cool} /><circle cx="132" cy="45" r="4" fill={COLOR.cool} /></>;
  }
  if (engine === "levels") {
    return <>{frame}<path d="M53 70V61h8V45h8v12h8V35h8v29h8V51h8v19h8V29h8v41h8V43h8v27h8V56h8v14h8" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="1.5" /><path d="M56 80h102" stroke={COLOR.fg2} strokeWidth="2" /><path d="m65 80 6-9 6 9m32 0 6-9 6 9m29 0 6-9 6 9" fill={COLOR.accent} opacity={animate ? ".35" : "1"}>{animate ? <animate attributeName="opacity" dur="1.4s" values=".3;1;.3" repeatCount="indefinite" /> : null}</path></>;
  }
  if (engine === "brightness-contrast") {
    return <>{frame}<circle cx="79" cy="52" r="18" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" /><circle cx="137" cy="52" r="18" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="2" /><path d="M137 34a18 18 0 0 1 0 36Z" fill={COLOR.fg} /><g stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2">{[[79,25,79,18],[79,79,79,86],[52,52,45,52],[106,52,113,52]].map((p,index)=><path key={index} d={`M${p[0]} ${p[1]} ${p[2]} ${p[3]}`} />)}</g><circle cx="79" cy="52" r={animate ? "8" : "12"} fill={COLOR.accent}>{animate ? <animate attributeName="r" dur="2.3s" values="7;13;7" repeatCount="indefinite" /> : null}</circle></>;
  }
  if (engine === "hue-saturation") {
    return <>{frame}<circle cx="108" cy="52" r="29" fill="none" stroke={COLOR.fg3} strokeWidth="8" /><path d="M108 23a29 29 0 0 1 25 15" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="8" /><path d="M133 38a29 29 0 0 1-2 31" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="8" /><circle cx="108" cy="52" r={animate ? "7" : "17"} fill={COLOR.accentSoft} stroke={COLOR.accent}>{animate ? <animate attributeName="r" dur="2.5s" values="7;18;18;7" keyTimes="0;.4;.72;1" repeatCount="indefinite" /> : null}</circle></>;
  }
  if (engine === "color-balance") {
    return <>{frame}<path d="M57 64h102M108 36v39" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" /><g transform={animate ? undefined : "rotate(-8 108 64)"}><path d="M65 64h86" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" /><circle cx="70" cy="50" r="10" fill={COLOR.cool} /><circle cx="146" cy="50" r="10" fill={COLOR.accent} />{animate ? <animateTransform attributeName="transform" type="rotate" dur="2.8s" values="-8 108 64;8 108 64;8 108 64;-8 108 64" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}</g></>;
  }
  if (engine === "channel-mixer") {
    return <>{frame}<circle cx="69" cy="38" r="12" fill={COLOR.accent} opacity=".8" /><circle cx="69" cy="66" r="12" fill={COLOR.cool} opacity=".8" /><circle cx="99" cy="52" r="12" fill={COLOR.fg2} opacity=".75" /><path d="M82 38 139 52M82 66l57-14M111 52h28" stroke={COLOR.fg2} strokeDasharray="5 4" strokeWidth="2" /><circle cx="150" cy="52" r={animate ? "10" : "17"} fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2">{animate ? <animate attributeName="r" dur="2.4s" values="9;18;18;9" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}</circle></>;
  }
  if (engine === "gradient-map") {
    return <>{frame}<g>{[0,1,2,3,4].map((index)=><rect key={index} x={53+index*22} y="31" width="23" height="22" fill={index<2?COLOR.canvas:index===2?COLOR.fg3:index===3?COLOR.cool:COLOR.accent} stroke={COLOR.lineStrong} />)}</g><path d="M54 70h108" stroke={COLOR.fg3} strokeWidth="8" /><path d="M54 70h108" stroke={COLOR.accent} strokeDasharray="108" strokeDashoffset={animate ? "108" : "0"} strokeWidth="8">{animate ? <animate attributeName="stroke-dashoffset" dur="2.5s" values="108;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}</path></>;
  }
  if (engine === "gaussian-blur" || engine === "blur") {
    const radius = engine === "gaussian-blur" ? 24 : 18;
    return <>{frame}<circle cx="87" cy="52" r={radius} fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" /><circle cx="129" cy="52" r={radius} fill={COLOR.cool} opacity=".28" /><circle cx="108" cy="52" r={animate ? "8" : `${radius + 4}`} fill={COLOR.accentSoft} opacity={animate ? ".25" : ".72"}>{animate ? <><animate attributeName="r" dur="2.7s" values={`8;${radius+6};${radius+6};8`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /><animate attributeName="opacity" dur="2.7s" values=".2;.72;.72;.2" keyTimes="0;.42;.72;1" repeatCount="indefinite" /></> : null}</circle></>;
  }
  if (engine === "motion-blur") {
    return <>{frame}{[0,1,2,3].map((index)=><path key={index} d={`M54 ${36+index*11}h${68+index*9}`} stroke={index===3?COLOR.accent:COLOR.fg3} strokeLinecap="round" strokeWidth={index===3?5:3} opacity={index===3?1:.4} />)}<path d="m144 30 18 22-18 22" fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "70" : undefined} strokeDashoffset={animate ? "70" : undefined} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">{animate ? <animate attributeName="stroke-dashoffset" dur="2.1s" values="70;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}</path></>;
  }
  if (engine === "sharpen") {
    return <>{frame}<path d="m56 73 32-37 20 22 18-19 34 34" fill="none" stroke={COLOR.fg3} strokeWidth="7" opacity=".25" /><path d="m56 73 32-37 20 22 18-19 34 34" fill="none" stroke={COLOR.accent} strokeDasharray="152" strokeDashoffset={animate ? "152" : "0"} strokeLinejoin="miter" strokeWidth="2.5">{animate ? <animate attributeName="stroke-dashoffset" dur="2.4s" values="152;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}</path></>;
  }
  if (engine === "noise") {
    const dots = [[55,30],[69,47],[84,68],[98,35],[112,57],[128,28],[143,48],[158,71],[61,73],[151,34],[123,75],[91,51]];
    return <>{frame}{dots.map(([cx,cy],index)=><circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2+(index%3)} fill={index%2?COLOR.accent:COLOR.fg2} opacity={animate?".3":".9"}>{animate ? <animate attributeName="opacity" dur={`${.8+(index%4)*.2}s`} values=".2;1;.2" repeatCount="indefinite" /> : null}</circle>)}</>;
  }
  return <>{frame}<path d="M46 25h58v54H46Z" fill={COLOR.fg} stroke={COLOR.fg2} /><path d="M104 25h58v54h-58Z" fill={COLOR.canvas} stroke={COLOR.fg2} /><circle cx="77" cy="52" r="13" fill={COLOR.canvas} /><circle cx="133" cy="52" r="13" fill={COLOR.fg} /><path d="M94 18h28m0 0-7-6m7 6-7 6M122 86H94m0 0 7-6m-7 6 7 6" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" opacity={animate?".3":"1"}>{animate ? <animate attributeName="opacity" dur="1.3s" values=".25;1;.25" repeatCount="indefinite" /> : null}</path></>;
}

function FilterPreview({ animate, clipId, variant }: { animate: boolean; clipId: string; variant: string }): ReactElement {
  const engine = filterPreviewEngine(variant);
  if (engine) return <FilterEnginePreview animate={animate} engine={engine} />;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x="43" y="17" width={animate ? "0" : "112"} height="68">
            {animate ? (
              <animate attributeName="width" dur="3.2s" values="0; 112; 112; 0" keyTimes="0; .45; .67; 1" repeatCount="indefinite" />
            ) : null}
          </rect>
        </clipPath>
      </defs>
      <rect x="43" y="17" width="112" height="68" rx="6" fill={COLOR.raised} stroke={COLOR.lineStrong} />
      <circle cx="69" cy="38" r="8" fill={COLOR.fg3} />
      <path d="m47 78 30-29 20 18 14-14 40 25Z" fill={COLOR.fg3} opacity=".55" />
      <g clipPath={`url(#${clipId})`}>
        <rect x="43" y="17" width="112" height="68" fill={COLOR.accentSoft} />
        <circle cx="69" cy="38" r="8" fill={COLOR.accent} />
        <path d="m47 78 30-29 20 18 14-14 40 25Z" fill={COLOR.cool} opacity=".78" />
        <path d="M47 78 77 49l20 18" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2" />
      </g>
      <g transform={animate ? undefined : "translate(155 0)"}>
        <path d="M0 13v76" stroke={COLOR.fg} strokeWidth="2" />
        <rect x="-5" y="42" width="10" height="18" rx="3" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="3.2s"
            values="43 0; 155 0; 155 0; 43 0"
            keyTimes="0; .45; .67; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <g fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="1.75">
        <path d="M173 29h18M173 50h18M173 71h18" />
        <circle cx="181" cy="29" r="3" fill={COLOR.card} />
        <circle cx="186" cy="50" r="3" fill={COLOR.card} />
        <circle cx="177" cy="71" r="3" fill={COLOR.card} />
      </g>
    </>
  );
}

function ZoomViewPreview({
  animate,
  variant,
  clipId,
}: {
  animate: boolean;
  variant: string;
  clipId: string;
}): ReactElement {
  const zoomOut = previewVariantMatches(variant, "zoom-out");
  const zoomIn = previewVariantMatches(variant, "zoom-in");
  const actualSize = previewVariantMatches(variant, "actual-size");
  // `zoom-fit` is the persisted/rail action identity. Treat it as the exact
  // fit-width operation when a hint has no authored previewVariant.
  const fitWidth = previewVariantMatches(variant, "fit-width", "zoom-fit");
  const reset = previewVariantMatches(variant, "reset");

  if (actualSize) {
    return (
      <g data-preview-operation="actual-size">
        <rect x="31" y="13" width="154" height="78" rx="7" fill={COLOR.card} stroke={COLOR.lineStrong} strokeWidth="1.5" />
        <rect x="59" y="24" width="98" height="56" rx="4" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
        <path d="M59 38h98M59 52h98M59 66h98M73 24v56M87 24v56M101 24v56M115 24v56M129 24v56M143 24v56" stroke={COLOR.line} strokeWidth="1" opacity={animate ? ".15" : ".72"}>
          {animate ? <animate attributeName="opacity" dur="2.8s" values=".15;.15;.72;.72;.15" keyTimes="0;.28;.48;.78;1" repeatCount="indefinite" /> : null}
        </path>
        <path d="m70 69 21-22 17 15 13-11 25 18" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
        <circle cx="80" cy="38" r="5" fill={COLOR.cool} />
        <rect x="132" y="67" width="52" height="24" rx="8" fill={COLOR.raised} stroke={COLOR.fg} strokeWidth="1.8" />
        <text x="158" y="83" fill={COLOR.accent} fontSize="11" fontWeight="800" textAnchor="middle">1:1</text>
        {animate ? (
          <path d="M42 28h10m-10 0 6-6m-6 6 6 6M174 76h-10m10 0-6-6m6 6-6 6" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
            <animate attributeName="opacity" dur="2.8s" values=".18;.9;.9;.18" keyTimes="0;.4;.72;1" repeatCount="indefinite" />
          </path>
        ) : null}
      </g>
    );
  }

  if (fitWidth) {
    return (
      <g data-preview-operation="fit-width">
        <defs>
          <clipPath id={clipId}>
            <rect x="31" y="14" width="154" height="76" rx="7" />
          </clipPath>
        </defs>
        <rect x="31" y="14" width="154" height="76" rx="7" fill={COLOR.card} stroke={COLOR.lineStrong} strokeWidth="1.5" />
        <g clipPath={`url(#${clipId})`}>
          <g transform={animate ? undefined : "translate(43 -32.5)"}>
            {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="83 19.5;43 -32.5;43 -32.5;83 19.5" keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
            <g transform={animate ? undefined : "scale(2.6)"}>
              {animate ? <animateTransform attributeName="transform" type="scale" dur="2.8s" values="1;2.6;2.6;1" keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
              <rect width="50" height="65" rx="3" fill={COLOR.canvas} stroke={COLOR.accent} strokeWidth="1.5" />
              <circle cx="13" cy="14" r="5" fill={COLOR.cool} />
              <path d="M5 54 17 35l10 10 7-8 11 17" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </g>
          </g>
        </g>
        <path d="M43 20v64M173 20v64" stroke={COLOR.fg2} strokeDasharray="3 3" strokeWidth="1.5" />
        <path d="M43 94h130m-130 0 8-6m-8 6 8 6m122-6-8-6m8 6-8 6" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      </g>
    );
  }

  if (reset) {
    return (
      <g data-preview-operation="reset-view">
        <path d="M108 13v78" stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1.2" opacity=".55" />
        <g transform={animate ? undefined : "rotate(0 108 52)"}>
          <rect x="55" y="24" width="106" height="58" rx="5" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
          <circle cx="79" cy="42" r="6" fill={COLOR.accent} />
          <path d="m62 73 24-22 17 14 14-11 36 19" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          {animate ? (
            <animateTransform attributeName="transform" type="rotate" dur="3s" values="-18 108 52;0 108 52;0 108 52;-18 108 52" keyTimes="0;.42;.74;1" repeatCount="indefinite" />
          ) : null}
        </g>
        <circle cx="166" cy="72" r="18" fill={COLOR.card} stroke={COLOR.fg} strokeWidth="2" />
        <path d="M156 70a11 11 0 1 1 3 9m-3-9-1-8m1 8 8-2" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" />
        <path d="M40 30v-12h12M164 18h12v12M176 74v12h-12M52 86H40V74" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" opacity=".78" />
      </g>
    );
  }

  const zoomScaleValues = zoomOut ? "1;.75;.75;1" : ".75;1;1;.75";
  const staticScale = zoomOut ? .75 : 1;
  return (
    <g data-preview-operation={zoomOut ? "zoom-out" : zoomIn ? "zoom-in" : "zoom-view"}>
      <g transform="translate(104 52)">
        <g transform={animate ? undefined : `scale(${staticScale})`}>
          {animate ? <animateTransform attributeName="transform" type="scale" dur="2.8s" values={zoomScaleValues} keyTimes="0;.38;.72;1" repeatCount="indefinite" /> : null}
          <rect x="-56" y="-34" width="112" height="68" rx="5" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
          <path d="M-32 15-13-6 3 8 17-3 39 16" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          <circle cx="-23" cy="-10" r="6" fill={COLOR.cool} />
        </g>
      </g>
      <circle cx="158" cy="71" r="17" fill={COLOR.card} stroke={COLOR.fg} strokeWidth="2" />
      <path d={zoomOut ? "M170 83l13 9M151 71h14" : "M170 83l13 9M151 71h14M158 64v14"} stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2.5" />
      <path d="M42 31V17h14M160 17h14v14M174 73v14h-14M56 87H42V73" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" opacity=".75" />
    </g>
  );
}

function ViewHudPreview({ animate, variant }: { animate: boolean; variant: string }): ReactElement {
  const rotate = previewVariantMatches(variant, "rotate-open", "rotate-close");
  const close = previewVariantMatches(variant, "zoom-close", "rotate-close");
  const operation = `${rotate ? "rotate" : "zoom"}-${close ? "close" : "open"}`;
  const collapsedTransform = "translate(0 27) scale(1 .18)";
  return (
    <g data-preview-operation={`view-hud-${operation}`}>
      <rect x="93" y="81" width="30" height="14" rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="1.5" />
      {rotate ? (
        <path d="M102 88a7 7 0 0 1 12-4m0 0-1-5m1 5-5-1" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      ) : (
        <><circle cx="107" cy="87" r="4" fill="none" stroke={COLOR.accent} strokeWidth="1.5" /><path d="m110 90 5 4M104 87h6M107 84v6" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="1.4" /></>
      )}
      <path d={close ? "M108 74v-9m0 9-5-5m5 5 5-5" : "M108 65v9m0-9-5 5m5-5 5 5"} fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <g transform={!animate ? (close ? collapsedTransform : undefined) : undefined} opacity={!animate && close ? ".28" : "1"}>
        <rect x="42" y="20" width="132" height="39" rx="12" fill={COLOR.card} stroke={COLOR.lineStrong} strokeWidth="1.6" />
        {[58, 88, 128, 158].map((x, index) => (
          <rect key={x} x={x - 11} y="28" width={index === 1 ? "38" : "22"} height="22" rx="7" fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} />
        ))}
        {rotate ? (
          <>
            <path d="M54 40a6 6 0 0 1 10-4m0 0-1-4m1 4-4-1M151 40a6 6 0 0 0 10 4m0 0-1 4m1-4-4 1" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            <text x="107" y="43.5" fill={COLOR.accent} fontSize="8" fontWeight="800" textAnchor="middle">0°</text>
          </>
        ) : (
          <>
            <path d="M53 39h10M153 39h10m-5-5v10" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="1.7" />
            <text x="107" y="43.5" fill={COLOR.accent} fontSize="8" fontWeight="800" textAnchor="middle">100%</text>
          </>
        )}
        {animate ? (
          <>
            <animateTransform attributeName="transform" type="translate" dur="2.6s" values={close ? "0 0;0 27;0 27;0 0" : "0 27;0 0;0 0;0 27"} keyTimes="0;.4;.76;1" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="scale" additive="sum" dur="2.6s" values={close ? "1 1;1 .18;1 .18;1 1" : "1 .18;1 1;1 1;1 .18"} keyTimes="0;.4;.76;1" repeatCount="indefinite" />
            <animate attributeName="opacity" dur="2.6s" values={close ? "1;.2;.2;1" : ".2;1;1;.2"} keyTimes="0;.4;.76;1" repeatCount="indefinite" />
          </>
        ) : null}
      </g>
    </g>
  );
}

function HistoryPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <g key={index} transform={`translate(${70 + index * 16} ${21 + index * 8})`} opacity={index === 2 ? "1" : ".46"}>
          <rect width="74" height="48" rx="5" fill={index === 2 ? COLOR.canvas : COLOR.raised} stroke={index === 2 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.5" />
          <circle cx="19" cy="18" r="6" fill={index === 2 ? COLOR.accent : COLOR.fg3} />
          <path d="M11 40 28 25l13 10 10-8 12 13" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </g>
      ))}
      <path d="M71 32H48l9-9M48 32l9 9" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <path d="M48 32c0 19 12 31 31 34" fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "64" : undefined} strokeDashoffset={animate ? "64" : undefined} strokeLinecap="round" strokeWidth="2.5">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.6s" values="64;0;0;64" keyTimes="0;.38;.72;1" repeatCount="indefinite" /> : null}
      </path>
      <g fill={COLOR.fg3}>
        <circle cx="60" cy="82" r="3" />
        <circle cx="78" cy="82" r="3" />
        <circle cx="96" cy="82" r="3" />
      </g>
      <circle cx={animate ? "96" : "78"} cy="82" r="5" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2">
        {animate ? <animate attributeName="cx" dur="2.6s" values="96;60;60;96" keyTimes="0;.38;.72;1" repeatCount="indefinite" /> : null}
      </circle>
    </>
  );
}

function LayerPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g transform="translate(42 4)">
        <path d="m66 18 58 20-58 20L8 38Z" fill={COLOR.raised} stroke={COLOR.lineStrong} strokeLinejoin="round" strokeWidth="1.5" opacity=".65" />
        <path d="m66 32 58 20-58 20L8 52Z" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.5" opacity=".88" />
        <g transform={animate ? undefined : "translate(0 -10)"}>
          <path d="m66 46 58 20-58 20L8 66Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="2" />
          <path d="m43 66 17-9 19 7 12-5 18 7-43 15Z" fill={COLOR.accent} opacity=".72" />
          {animate ? (
            <animateTransform attributeName="transform" type="translate" dur="2.8s" values="0 0;0 -12;0 -12;0 0" keyTimes="0;.32;.72;1" repeatCount="indefinite" />
          ) : null}
        </g>
      </g>
      <g transform="translate(177 32)" fill="none" stroke={COLOR.fg2} strokeWidth="1.8">
        <path d="M-9 0C-4-6 4-6 9 0-4 6 4 6-9 0Z" />
        <circle r="2.5" fill={COLOR.accent} stroke="none" opacity={animate ? ".3" : "1"}>
          {animate ? <animate attributeName="opacity" dur="1.4s" values=".3;1;.3" repeatCount="indefinite" /> : null}
        </circle>
      </g>
    </>
  );
}

function TimelinePreview({ animate, variant }: { animate: boolean; variant: string }): ReactElement {
  const pause = previewVariantMatches(variant, "pause");
  const playheadX = animate ? 64 : pause ? 112 : 142;

  return (
    <>
      <rect x="27" y="20" width="162" height="62" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.4" />
      <path d="M27 37h162M27 54h162M27 71h162M66 20v62" stroke={COLOR.line} strokeWidth="1" />
      <g fill={COLOR.fg3} opacity=".72">
        <rect x="35" y="27" width="21" height="3" rx="1.5" />
        <rect x="35" y="44" width="16" height="3" rx="1.5" />
        <rect x="35" y="61" width="24" height="3" rx="1.5" />
      </g>
      {[
        [86, 28],
        [119, 45],
        [101, 62],
        [158, 62],
      ].map(([x, y], index) => (
        <rect
          key={`${x}-${y}`}
          x={x - 4}
          y={y - 4}
          width="8"
          height="8"
          rx="1.2"
          transform={`rotate(45 ${x} ${y})`}
          fill={index === 3 ? COLOR.accent : COLOR.raised}
          stroke={index === 3 ? COLOR.accent : COLOR.fg2}
          strokeWidth="1.3"
        />
      ))}
      <g transform={`translate(${playheadX} 0)`} data-preview-motion={animate ? "timeline" : undefined}>
        <path d="m0 16-5-6h10Z" fill={COLOR.accent} />
        <path d="M0 16v70" stroke={COLOR.accent} strokeWidth="2" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="3s"
            values={pause ? "64 0;112 0;112 0;64 0" : "64 0;142 0;142 0;64 0"}
            keyTimes={pause ? "0;.3;.82;1" : "0;.58;.76;1"}
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      {pause ? (
        <path d="M92 85v12M101 85v12" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="3" />
      ) : (
        <path d="m91 91 10-6v12Z" fill={COLOR.fg} opacity=".9" />
      )}
      <rect x="108" y="87" width="54" height="7" rx="3.5" fill={COLOR.raised} />
      <rect x="108" y="87" width={animate ? "18" : pause ? "32" : "42"} height="7" rx="3.5" fill={COLOR.accent}>
        {animate ? <animate attributeName="width" dur="3s" values={pause ? "0;32;32;0" : "0;54;54;0"} keyTimes={pause ? "0;.3;.82;1" : "0;.58;.76;1"} repeatCount="indefinite" /> : null}
      </rect>
    </>
  );
}

function KeyframePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="34" y="28" width="148" height="48" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.4" />
      <path d="M34 52h148M73 28v48M111 28v48M149 28v48" stroke={COLOR.line} />
      <g transform={animate ? undefined : "translate(73 52)"} data-preview-motion={animate ? "keyframe" : undefined}>
        <rect x="-8" y="-8" width="16" height="16" rx="2" transform="rotate(45)" fill={COLOR.accent} stroke={COLOR.fg} strokeWidth="1.5" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.8s"
            values="73 52;149 52;149 52;73 52"
            keyTimes="0;.42;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <circle cx="111" cy="52" r="12" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="3 3" opacity={animate ? ".4" : ".9"}>
        {animate ? <animate attributeName="opacity" dur="1.4s" values=".3;.9;.3" repeatCount="indefinite" /> : null}
      </circle>
      <path d="M111 46v12M105 52h12" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
      <path d="m168 84 6 16 4-6 7 5 3-4-7-5 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="1.6" />
    </>
  );
}

function FrameSequencePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2].map((index) => {
        const x = 35 + index * 54;
        return (
          <g key={index} transform={`translate(${x} 24)`}>
            <rect width="44" height="49" rx="5" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.4" />
            <circle cx={13 + index * 3} cy={15 + index * 2} r="6" fill={index === 2 ? COLOR.accent : COLOR.fg3} opacity={index === 2 ? ".85" : ".55"} />
            <path d={`M7 41 18 ${30 - index * 2}l8 6 10-9`} fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            <text x="22" y="62" fill={COLOR.fg3} fontSize="8" textAnchor="middle">{index + 1}</text>
          </g>
        );
      })}
      <rect x={animate ? "33" : "141"} y="22" width="48" height="53" rx="7" fill="none" stroke={COLOR.accent} strokeWidth="2.2">
        {animate ? <animate attributeName="x" dur="3s" values="33;87;141;141;33" keyTimes="0;.25;.5;.76;1" repeatCount="indefinite" /> : null}
      </rect>
      <path d="m90 88 10-6v12Z" fill={COLOR.fg} />
      <path d="M109 88h69" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="6" />
      <path d="M109 88h23" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="6">
        {animate ? <animate attributeName="d" dur="3s" values="M109 88h0;M109 88h69;M109 88h69;M109 88h0" keyTimes="0;.5;.76;1" repeatCount="indefinite" /> : null}
      </path>
    </>
  );
}

function OnionSkinPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const previousCount = previewVariantMatches(variant, "onion-prev-count");
  const nextCount = previewVariantMatches(variant, "onion-next-count");
  const opacity = previewVariantMatches(variant, "onion-opacity");
  const tint = previewVariantMatches(variant, "onion-tint");
  const figures = [
    {
      x: 79,
      color: "var(--color-danger, oklch(0.68 0.2 25))",
      opacity: previousCount ? ".76" : ".42",
      angle: -14,
    },
    { x: 108, color: COLOR.fg, opacity: ".95", angle: 0 },
    {
      x: 137,
      color: tint ? COLOR.accent : COLOR.cool,
      opacity: nextCount || tint ? ".76" : ".42",
      angle: 14,
    },
  ];

  return (
    <>
      {figures.map((figure, index) => (
        <g key={figure.x} transform={`translate(${figure.x} 20) rotate(${figure.angle} 0 36)`} fill="none" stroke={figure.color} strokeLinecap="round" strokeWidth="3" opacity={figure.opacity}>
          <circle cy="9" r="7" fill={COLOR.raised} strokeWidth="1.6" />
          <path d="M0 17v30M0 27l-15 14M0 27l16 11M0 47l-13 27M0 47l15 26" />
          {animate && index !== 1 ? (
            <animate attributeName="opacity" dur="2.4s" values={`${figure.opacity};.75;${figure.opacity}`} repeatCount="indefinite" />
          ) : null}
        </g>
      ))}
      {previousCount || nextCount ? (
        <g data-preview-operation={previousCount ? "previous-count" : "next-count"}>
          <circle cx={previousCount ? "64" : "152"} cy="84" r="12" fill={COLOR.canvas} stroke={COLOR.accent} strokeWidth="2" />
          <path
            d={previousCount ? "M69 77 61 84l8 7" : "m147 77 8 7-8 7"}
            fill="none"
            stroke={COLOR.accent}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
          />
          <text x={previousCount ? "82" : "134"} y="88" fill={COLOR.fg} fontSize="12" fontWeight="700" textAnchor="middle">
            {animate ? "3" : "2"}
            {animate ? <animate attributeName="opacity" dur="1.5s" values=".35;1;.35" repeatCount="indefinite" /> : null}
          </text>
        </g>
      ) : opacity ? (
        <g data-preview-operation="opacity">
          <line x1="54" y1="89" x2="162" y2="89" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="7" />
          <line x1="54" y1="89" x2={animate ? "82" : "139"} y2="89" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="7">
            {animate ? <animate attributeName="x2" dur="2.4s" values="82;139;139;82" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </line>
          <circle cx={animate ? "82" : "139"} cy="89" r="7" fill={COLOR.fg} stroke={COLOR.canvas} strokeWidth="2">
            {animate ? <animate attributeName="cx" dur="2.4s" values="82;139;139;82" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </circle>
        </g>
      ) : tint ? (
        <g data-preview-operation="tint">
          {[COLOR.accent, COLOR.cool, "var(--color-danger, oklch(0.68 0.2 25))"].map((fill, index) => (
            <circle key={fill} cx={88 + index * 20} cy="88" r={index === 1 ? "7" : "5"} fill={fill} opacity={index === 1 ? "1" : ".55"}>
              {animate && index === 1 ? <animate attributeName="r" dur="1.4s" values="5;8;5" repeatCount="indefinite" /> : null}
            </circle>
          ))}
        </g>
      ) : (
        <>
          <path d="M49 89h118" stroke={COLOR.lineStrong} strokeDasharray="4 4" />
          <g transform={animate ? undefined : "translate(108 88)"} data-preview-operation="toggle">
            <circle r="5" fill={COLOR.accent} />
            {animate ? <animateMotion dur="2.4s" path="M79 88h58H79" repeatCount="indefinite" /> : null}
          </g>
        </>
      )}
    </>
  );
}

function TimelapsePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <g key={index} transform={`translate(${31 + index * 10} ${18 + index * 8})`} opacity={index === 2 ? "1" : ".5"}>
          <rect width="82" height="57" rx="5" fill={COLOR.canvas} stroke={index === 2 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.4" />
          <path d={`M13 43c17-${10 + index * 3} 28 ${8 + index * 2} 48-${13 + index * 2} 8-7 14-6 21-2`} fill="none" stroke={index === 2 ? COLOR.accent : COLOR.fg3} strokeLinecap="round" strokeWidth="2.4" />
        </g>
      ))}
      <path d="M128 48h19l-6-6m6 6-6 6" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <rect x="153" y="25" width="42" height="55" rx="6" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="1.4" />
      <path d="m168 42 15 9-15 9Z" fill={COLOR.accent} />
      <path d="M159 70h30" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="4" />
      <path d="M159 70h9" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="4">
        {animate ? <animate attributeName="d" dur="2.8s" values="M159 70h0;M159 70h30;M159 70h30;M159 70h0" keyTimes="0;.55;.78;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="72" cy="14" r="8" fill={COLOR.raised} stroke={COLOR.cool} strokeWidth="1.5" />
      <path d="M72 14v-5M72 14l4 3" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="1.5" />
    </>
  );
}

function MotionFxPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="52" y="13" width="112" height="79" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.4" />
      {[0, 1, 2].map((index) => (
        <g key={index} transform={animate ? undefined : `translate(0 ${index * 23})`}>
          <rect x="63" y="22" width="90" height="18" rx="4" fill={index === 1 ? COLOR.accentSoft : COLOR.raised} stroke={index === 1 ? COLOR.accent : COLOR.line} />
          <path d="M71 34 82 25l8 6 9-5 11 8" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="1.6" />
          {animate ? (
            <animateTransform attributeName="transform" type="translate" dur="3s" values={`0 ${index * 23 + 12};0 ${index * 23};0 ${index * 23};0 ${index * 23 + 12}`} keyTimes="0;.28;.75;1" repeatCount="indefinite" />
          ) : null}
        </g>
      ))}
      <circle cx="140" cy="55" r="13" fill="none" stroke={COLOR.accent} strokeWidth="2" opacity={animate ? ".2" : ".85"}>
        {animate ? <animate attributeName="r" dur="1.5s" values="5;16;5" repeatCount="indefinite" /> : null}
        {animate ? <animate attributeName="opacity" dur="1.5s" values=".9;.1;.9" repeatCount="indefinite" /> : null}
      </circle>
      <path d="m33 64 7-7 7 7M40 57v20" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </>
  );
}

function VideoExportPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <rect key={index} x={25 + index * 27} y={27 + index * 6} width="43" height="34" rx="4" fill={COLOR.canvas} stroke={index === 2 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.3" opacity={index === 2 ? "1" : ".58"} />
      ))}
      <path d="M106 51h24l-7-7m7 7-7 7" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M140 19h37l14 14v51h-51Z" fill={COLOR.raised} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M177 19v15h14" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.5" />
      <path d="m154 43 18 11-18 11Z" fill={COLOR.accent} />
      <rect x="148" y="73" width="35" height="5" rx="2.5" fill={COLOR.lineStrong} />
      <rect x="148" y="73" width={animate ? "8" : "30"} height="5" rx="2.5" fill={COLOR.accent}>
        {animate ? <animate attributeName="width" dur="2.8s" values="0;35;35;0" keyTimes="0;.58;.8;1" repeatCount="indefinite" /> : null}
      </rect>
      <g transform={animate ? undefined : "translate(116 51)"}>
        <circle r="3.5" fill={COLOR.accent} />
        {animate ? <animateMotion dur="2.8s" path="M88 51H140" keyPoints="0;1;1;0" keyTimes="0;.58;.8;1" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

function AudioPreview({ animate }: { animate: boolean }): ReactElement {
  const bars = [16, 30, 44, 24, 52, 34, 20, 40, 28];

  return (
    <>
      <path d="M35 58h18l21-18v40L53 62H35Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M84 48c9 7 9 18 0 25M92 40c17 13 17 32 0 43" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" opacity={animate ? ".35" : ".8"}>
        {animate ? <animate attributeName="opacity" dur="1.4s" values=".25;1;.25" repeatCount="indefinite" /> : null}
      </path>
      <g transform="translate(111 23)">
        {bars.map((height, index) => (
          <rect key={index} x={index * 9} y={(56 - height) / 2} width="5" height={height} rx="2.5" fill={index % 3 === 1 ? COLOR.accent : COLOR.cool} opacity=".78">
            {animate ? <animate attributeName="height" dur={`${1 + index * 0.08}s`} values={`${height};${Math.max(10, 58 - height)};${height}`} repeatCount="indefinite" /> : null}
            {animate ? <animate attributeName="y" dur={`${1 + index * 0.08}s`} values={`${(56 - height) / 2};${(56 - Math.max(10, 58 - height)) / 2};${(56 - height) / 2}`} repeatCount="indefinite" /> : null}
          </rect>
        ))}
      </g>
      <path d="M112 88h76" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="5" />
      <circle cx={animate ? "126" : "169"} cy="88" r="6" fill={COLOR.accent}>
        {animate ? <animate attributeName="cx" dur="2.4s" values="118;181;181;118" keyTimes="0;.55;.78;1" repeatCount="indefinite" /> : null}
      </circle>
    </>
  );
}

function TransformPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="48" y="20" width="120" height="66" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <g transform="translate(108 53)" data-preview-motion={animate ? "transform" : undefined}>
        <g transform={animate ? undefined : "rotate(8) scale(1.08)"}>
          <rect x="-40" y="-21" width="80" height="42" rx="4" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
          <path d="M-31 11-12-7 3 6 15-5 31 11" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          {animate ? (
            <animateTransform attributeName="transform" type="rotate" dur="3s" values="-5;9;9;-5" keyTimes="0;.42;.72;1" repeatCount="indefinite" />
          ) : null}
        </g>
        {[
          [-40, -21],
          [40, -21],
          [-40, 21],
          [40, 21],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 3} y={y - 3} width="6" height="6" rx="1" fill={COLOR.canvas} stroke={COLOR.fg} />
        ))}
      </g>
      <path d="M177 35a18 18 0 0 1 3 23m0-23-1 10-9-4" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </>
  );
}

function PanPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="41" y="16" width="134" height="74" rx="8" fill={COLOR.raised} stroke={COLOR.lineStrong} />
      <g transform={animate ? undefined : "translate(9 -4)"} data-preview-motion={animate ? "pan" : undefined}>
        <rect x="59" y="27" width="88" height="52" rx="4" fill={COLOR.canvas} stroke={COLOR.fg2} />
        <circle cx="80" cy="43" r="6" fill={COLOR.accent} />
        <path d="m63 71 24-21 15 14 12-10 29 17" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {animate ? (
          <animateTransform attributeName="transform" type="translate" dur="2.8s" values="-12 7;12 -6;12 -6;-12 7" keyTimes="0;.42;.72;1" repeatCount="indefinite" />
        ) : null}
      </g>
      <path d="M108 12v13m0-13-5 6m5-6 5 6M108 92V79m0 13-5-6m5 6 5-6M34 53h16m-16 0 7-5m-7 5 7 5M182 53h-16m16 0-7-5m7 5-7 5" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

function MarqueePreview({ animate, ellipse }: { animate: boolean; ellipse: boolean }): ReactElement {
  const common = {
    fill: COLOR.accentSoft,
    stroke: COLOR.fg,
    strokeDasharray: "6 4",
    strokeWidth: "2",
  } as const;
  return (
    <>
      <rect x="43" y="17" width="130" height="70" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      {ellipse ? (
        <ellipse cx="108" cy="52" rx={animate ? "16" : "43"} ry={animate ? "11" : "25"} {...common}>
          {animate ? (
            <>
              <animate attributeName="rx" dur="2.8s" values="16;43;43;16" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="ry" dur="2.8s" values="11;25;25;11" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-20" repeatCount="indefinite" />
            </>
          ) : null}
        </ellipse>
      ) : (
        <rect x={animate ? "87" : "64"} y={animate ? "42" : "28"} width={animate ? "42" : "88"} height={animate ? "22" : "48"} rx="2" {...common}>
          {animate ? (
            <>
              <animate attributeName="x" dur="2.8s" values="87;64;64;87" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="y" dur="2.8s" values="42;28;28;42" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="width" dur="2.8s" values="42;88;88;42" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="height" dur="2.8s" values="22;48;48;22" keyTimes="0;.42;.75;1" repeatCount="indefinite" />
              <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-20" repeatCount="indefinite" />
            </>
          ) : null}
        </rect>
      )}
      <path d="m161 73 7 17 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

function CropPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="51" y="16" width="114" height="74" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <circle cx="77" cy="38" r="8" fill={COLOR.accent} />
      <path d="m56 80 29-29 18 16 14-13 43 26" fill={COLOR.cool} opacity=".55" />
      <rect x={animate ? "46" : "63"} y={animate ? "12" : "23"} width={animate ? "124" : "91"} height={animate ? "82" : "58"} fill="none" stroke={COLOR.fg} strokeWidth="2.5">
        {animate ? (
          <>
            <animate attributeName="x" dur="2.9s" values="46;63;63;46" keyTimes="0;.42;.74;1" repeatCount="indefinite" />
            <animate attributeName="y" dur="2.9s" values="12;23;23;12" keyTimes="0;.42;.74;1" repeatCount="indefinite" />
            <animate attributeName="width" dur="2.9s" values="124;91;91;124" keyTimes="0;.42;.74;1" repeatCount="indefinite" />
            <animate attributeName="height" dur="2.9s" values="82;58;58;82" keyTimes="0;.42;.74;1" repeatCount="indefinite" />
          </>
        ) : null}
      </rect>
      <path d="M39 31h21V10M177 73h-21v21" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
    </>
  );
}

function PixelInkPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g stroke={COLOR.line} strokeWidth="1" opacity=".7">
        {Array.from({ length: 7 }, (_, index) => <path key={`v-${index}`} d={`M${55 + index * 16} 20v64`} />)}
        {Array.from({ length: 5 }, (_, index) => <path key={`h-${index}`} d={`M55 ${20 + index * 16}h96`} />)}
      </g>
      <path d="M63 76h16V60h16V52h16V36h32" fill="none" stroke={COLOR.accent} strokeDasharray="112" strokeDashoffset={animate ? "112" : "0"} strokeLinecap="square" strokeLinejoin="miter" strokeWidth="7">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.6s" values="112;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
      </path>
      <path d="m154 25 21 21-13 13-21-21Z" fill={COLOR.fg2} stroke={COLOR.canvas} strokeWidth="2" />
      <rect x="138" y="35" width="10" height="10" fill={COLOR.accent} />
    </>
  );
}

function SmudgePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <circle cx="76" cy="52" r="28" fill={COLOR.accent} opacity=".72" />
      <circle cx="133" cy="52" r="28" fill={COLOR.cool} opacity=".68" />
      <path d="M80 37c18 15 34-13 49 2M78 52c19 15 35-14 54 2M82 67c18 12 33-11 47 0" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="4" opacity=".78">
        {animate ? <animate attributeName="d" dur="2.4s" values="M80 37c18 15 34-13 49 2M78 52c19 15 35-14 54 2M82 67c18 12 33-11 47 0;M76 37c24-13 38 15 57 0M80 52c20-13 35 14 49 0M77 67c24-11 38 12 56 0;M80 37c18 15 34-13 49 2M78 52c19 15 35-14 54 2M82 67c18 12 33-11 47 0" repeatCount="indefinite" /> : null}
      </path>
      <g transform={animate ? undefined : "translate(145 30)"}>
        <path d="m0 0 24 8-12 8Z" fill={COLOR.fg2} stroke={COLOR.canvas} strokeWidth="2" />
        {animate ? <animateMotion dur="2.4s" path="M145 30C119 70 91 27 68 64" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

function LiquifyPreview({ animate }: { animate: boolean }): ReactElement {
  const straight = "M51 28H165M51 44H165M51 60H165M51 76H165";
  const warped = "M51 28c35 0 35 18 57 18s26-18 57-18M51 44c30 0 37 18 58 18s27-18 56-18M51 60c30 0 36-18 57-18s29 18 57 18M51 76c35 0 34-18 57-18s28 18 57 18";
  return (
    <>
      <rect x="43" y="17" width="130" height="70" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d={animate ? straight : warped} fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2">
        {animate ? <animate attributeName="d" dur="2.8s" values={`${straight};${warped};${warped};${straight}`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="108" cy="52" r="18" fill="none" stroke={COLOR.accent} strokeDasharray="4 4" strokeWidth="2" />
      <path d="m107 38 14 14-14 14M94 52h27" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </>
  );
}

function LassoFillPreview({ animate }: { animate: boolean }): ReactElement {
  const path = "M57 67c-12-17 7-39 31-34 14-17 49-5 47 15 21 8 12 30-9 33-25 4-53 0-69-14Z";
  return (
    <>
      <path d={path} fill={COLOR.accent} fillOpacity={animate ? ".08" : ".72"} stroke={COLOR.fg} strokeDasharray="5 4" strokeWidth="2">
        {animate ? (
          <>
            <animate attributeName="fill-opacity" dur="2.9s" values=".05;.05;.72;.72" keyTimes="0;.56;.72;1" repeatCount="indefinite" />
            <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-18" repeatCount="indefinite" />
          </>
        ) : null}
      </path>
      <g transform={animate ? undefined : "translate(57 67)"}>
        <path d="m0 0 8 19 4-8 7 7 4-4-7-7 8-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
        {animate ? <animateMotion dur="2.9s" path={path} keyPoints="0;1;1" keyTimes="0;.56;1" repeatCount="indefinite" /> : null}
      </g>
      <path d="M158 28v20m-10-10h20" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5" />
    </>
  );
}

function PerspectivePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <path d="M38 43h140" stroke={COLOR.fg3} strokeWidth="1.5" />
      {[-44, -24, 0, 24, 44].map((offset) => (
        <path key={offset} d={`M108 43 ${108 + offset * 1.65} 92`} stroke={COLOR.lineStrong} strokeWidth="1.4" />
      ))}
      <circle cx="108" cy="43" r={animate ? "4" : "6"} fill={COLOR.accent}>
        {animate ? <animate attributeName="r" dur="1.4s" values="4;7;4" repeatCount="indefinite" /> : null}
      </circle>
      <path d="M51 77 108 43l58 34" fill="none" stroke={COLOR.accent} strokeDasharray="122" strokeDashoffset={animate ? "122" : "0"} strokeLinecap="round" strokeWidth="3">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="122;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
      </path>
      <path d="M70 77V59h20v7M146 77V59h-20v7" fill="none" stroke={COLOR.fg2} strokeWidth="2" />
    </>
  );
}

function RotateViewPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const rotateLeft = previewVariantMatches(variant, "rotate-left");
  const rotateRight = previewVariantMatches(variant, "rotate-right");
  const endRotation = rotateLeft ? -90 : rotateRight ? 90 : 18;
  const rotationValues = rotateLeft
    ? "0;-90;-90;0"
    : rotateRight
      ? "0;90;90;0"
      : "-15;18;18;-15";
  return (
    <g data-preview-operation={rotateLeft ? "rotate-left" : rotateRight ? "rotate-right" : "rotate-view"}>
      <g transform="translate(108 52)">
        <g transform={animate ? undefined : `rotate(${endRotation})`}>
          <rect x="-46" y="-28" width="92" height="56" rx="5" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
          <circle cx="-24" cy="-10" r="7" fill={COLOR.accent} />
          <path d="m-40 20 24-21L1 14l13-11 25 17" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          {animate ? <animateTransform attributeName="transform" type="rotate" dur="3s" values={rotationValues} keyTimes="0;.45;.72;1" repeatCount="indefinite" /> : null}
        </g>
      </g>
      <path
        d={rotateLeft
          ? "M68 22a62 62 0 0 0-17 69m0 0-2-13m2 13 12-5"
          : rotateRight
            ? "M148 22a62 62 0 0 1 17 69m0 0 2-13m-2 13-12-5"
            : "M51 32a66 66 0 0 1 104-9m0 0-13-1m13 1-4 12M165 72a66 66 0 0 1-104 9m0 0 13 1m-13-1 4-12"}
        fill="none"
        stroke={COLOR.accent}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </g>
  );
}

function FlipViewPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const restore = previewVariantMatches(variant, "restore");
  const startScale = restore ? "-1 1" : "1 1";
  const endScale = restore ? "1 1" : "-1 1";
  return (
    <g data-preview-operation={restore ? "restore-view" : "flip-view"}>
      <path d="M108 14v76" stroke={COLOR.cool} strokeDasharray="4 4" strokeWidth="1.5" />
      <g transform="translate(108 0)">
        <g transform={animate ? `scale(${startScale})` : `scale(${endScale})`}>
          <g transform="translate(-108 0)">
            <rect x="50" y="23" width="116" height="61" rx="6" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
            <circle cx="77" cy="43" r="8" fill={COLOR.accent} />
            <path d="m57 76 30-26 18 16 13-12 39 22" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          </g>
          {animate ? (
            <animateTransform
              attributeName="transform"
              type="scale"
              dur="2.8s"
              values={`${startScale};${endScale};${endScale};${startScale}`}
              keyTimes="0;.42;.72;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
      </g>
      <path d={restore ? "M48 52h38m0 0-9-8m9 8-9 8M168 52h-38m0 0 9-8m-9 8 9 8" : "M86 52H48m0 0 9-8m-9 8 9 8M130 52h38m0 0-9-8m9 8-9 8"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </g>
  );
}

function DismissPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <g data-preview-operation="dismiss">
      <rect x="31" y="25" width="154" height="54" rx="14" fill={COLOR.card} stroke={COLOR.lineStrong} strokeWidth="1.5" opacity={animate ? "1" : ".28"}>
        {animate ? <animate attributeName="opacity" dur="2.5s" values="1;1;.2;.2;1" keyTimes="0;.38;.58;.82;1" repeatCount="indefinite" /> : null}
      </rect>
      <path d="M52 52h22M85 52h22M118 52h22" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="5" opacity={animate ? ".82" : ".2"}>
        {animate ? <animate attributeName="opacity" dur="2.5s" values=".82;.82;.15;.15;.82" keyTimes="0;.38;.58;.82;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="163" cy="52" r="13" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="1.8" />
      <path d="m157 46 12 12m0-12-12 12" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.4" />
      <path d="M108 88v-17m0 17-7-7m7 7 7-7" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" opacity={animate ? ".25" : ".85"}>
        {animate ? <animate attributeName="opacity" dur="2.5s" values=".25;.25;.9;.9;.25" keyTimes="0;.38;.58;.82;1" repeatCount="indefinite" /> : null}
      </path>
    </g>
  );
}

function ShapeKindPreview({
  animate,
  kind,
  variant = "",
}: {
  animate: boolean;
  kind: "smart" | "rect" | "ellipse";
  variant?: string;
}): ReactElement {
  if (kind === "smart") {
    const disable = previewVariantMatches(variant, "disable");
    if (!disable) return <ShapePreview animate={animate} />;
    return (
      <g data-preview-operation="disable-smart-shape">
        <path d="M50 68 63 28l55-4 17 44-16 9-59-3Z" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <rect x="57" y="26" width="72" height="48" rx="7" fill={COLOR.accentSoft} stroke={COLOR.fg3} strokeDasharray="5 4" strokeWidth="2" opacity={animate ? ".82" : ".14"}>
          {animate ? <animate attributeName="opacity" dur="2.7s" values=".82;.12;.12;.82" keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
        </rect>
        <path d="M145 29 174 58m0-29-29 29" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
        <path d="m151 68 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2">
          {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="0 -30;0 0;0 0;0 -30" keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
        </path>
      </g>
    );
  }
  return (
    <>
      <path d="M54 72 70 29l47-7 43 28-25 32-61-3Z" fill="none" stroke={COLOR.fg3} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" opacity=".45" />
      {kind === "rect" ? (
        <rect x="62" y="25" width="92" height="57" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="298" strokeDashoffset={animate ? "298" : "0"} strokeWidth="2.5">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="298;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
        </rect>
      ) : (
        <ellipse cx="108" cy="53" rx="48" ry="30" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="248" strokeDashoffset={animate ? "248" : "0"} strokeWidth="2.5">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="248;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
        </ellipse>
      )}
      <path d="m164 68 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

function ShapeFillPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const disable = previewVariantMatches(variant, "disable");
  const fillStart = disable ? ".34" : ".06";
  const fillEnd = disable ? ".06" : ".34";
  const dropStart = disable ? ".9" : ".2";
  const dropEnd = disable ? ".2" : ".9";
  return (
    <g data-preview-operation={disable ? "disable-shape-fill" : "enable-shape-fill"}>
      <rect x="47" y="23" width="83" height="60" rx="8" fill={COLOR.canvas} stroke={COLOR.accent} strokeWidth="2.5" />
      <rect x="49.5" y="25.5" width="78" height="55" rx="5.5" fill={COLOR.accent} opacity={animate ? fillStart : fillEnd}>
        {animate ? <animate attributeName="opacity" dur="2.7s" values={`${fillStart};${fillEnd};${fillEnd};${fillStart}`} keyTimes="0;.35;.72;1" repeatCount="indefinite" /> : null}
      </rect>
      <path d="m144 27 22 22-13 13-22-22Z" fill={COLOR.fg2} stroke={COLOR.canvas} strokeWidth="2" />
      <path d="m143 50 15 15" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="5" />
      <path d="M154 69c0 7-5 12-11 12s-11-5-11-12c0-5 7-15 11-20 4 5 11 15 11 20Z" fill={COLOR.accent} opacity={animate ? dropStart : dropEnd}>
        {animate ? <animate attributeName="opacity" dur="2.7s" values={`${dropStart};${dropEnd};${dropEnd};${dropStart}`} keyTimes="0;.35;.72;1" repeatCount="indefinite" /> : null}
      </path>
      {disable ? <path d="M132 49 156 80" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2.5" /> : null}
      <path d="M59 37h59M59 69h59" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="1.5" opacity=".45" />
    </g>
  );
}

function ReferencePreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="35" y="18" width="91" height="69" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d="m41 78 23-24 15 14 12-10 29 20" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <g transform={animate ? undefined : "translate(0 -4)"}>
        <rect x="118" y="12" width="65" height="78" rx="8" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="2" />
        <circle cx="139" cy="35" r="9" fill={COLOR.accent} opacity=".8" />
        <path d="M128 75c3-17 12-25 24-25s20 8 22 25" fill={COLOR.cool} opacity=".7" />
        <path d="M126 22h18M126 81h27" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="12 5;0 -4;0 -4;12 5" keyTimes="0;.35;.76;1" repeatCount="indefinite" /> : null}
      </g>
      <path d="M105 45h19m-6-6 6 6-6 6" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

function HistoryStepPreview({ animate, direction }: { animate: boolean; direction: "undo" | "redo" }): ReactElement {
  const mirror = direction === "redo";
  return (
    <>
      {[0, 1, 2].map((index) => (
        <rect key={index} x={68 + index * 13} y={23 + index * 8} width="80" height="51" rx="6" fill={index === 2 ? COLOR.canvas : COLOR.raised} stroke={index === 2 ? COLOR.accent : COLOR.lineStrong} opacity={index === 2 ? "1" : ".48"} />
      ))}
      <g transform={mirror ? "translate(216 0) scale(-1 1)" : undefined}>
        <path d="M73 34H43l11-11M43 34l11 11" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d="M43 34c0 27 19 43 49 43" fill="none" stroke={COLOR.accent} strokeDasharray="82" strokeDashoffset={animate ? "82" : "0"} strokeLinecap="round" strokeWidth="3">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.5s" values="82;0;0;82" keyTimes="0;.4;.72;1" repeatCount="indefinite" /> : null}
        </path>
      </g>
      <path d="M99 49h37M99 59h27" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
    </>
  );
}

function LayerActionPreview({
  animate,
  action,
  variant,
}: {
  animate: boolean;
  action: "visibility" | "lock" | "merge" | "actions";
  variant: string;
}): ReactElement {
  const hidden = previewVariantMatches(variant, "hide", "batch-hide");
  const shown = previewVariantMatches(variant, "show", "batch-show");
  const batchVisibility = previewVariantMatches(variant, "batch-show", "batch-hide");
  const unlocked = previewVariantMatches(variant, "unlock", "batch-unlock");
  const batchLock = previewVariantMatches(variant, "batch-lock", "batch-unlock");
  const flattenVisible = previewVariantMatches(variant, "flatten-visible");
  return (
    <g
      data-preview-operation={
        action === "visibility"
          ? batchVisibility
            ? hidden
              ? "batch-hide"
              : "batch-show"
            : hidden
              ? "hide"
              : shown
                ? "show"
                : "visibility"
          : action === "lock"
            ? batchLock
              ? unlocked
                ? "batch-unlock"
                : "batch-lock"
              : unlocked
                ? "unlock"
                : "lock"
            : action === "merge"
              ? flattenVisible
                ? "flatten-visible"
                : "merge-selected"
              : "actions"
      }
    >
      {[0, 1, 2].map((index) => (
        <path key={index} d={`m108 ${17 + index * 18} 53 18-53 18-53-18Z`} fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} strokeLinejoin="round" strokeWidth="1.7" opacity={action === "merge" && animate ? `${.45 + index * .2}` : "1"}>
          {action === "merge" && animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values={`0 0;0 ${18 - index * 18};0 ${18 - index * 18};0 0`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </path>
      ))}
      {action === "visibility" ? (
        <>
          {(batchVisibility ? [28, 52, 76] : [37]).map((y) => (
            <g key={y}>
              <path d={`M160 ${y}c9-9 22-9 31 0-9 9-22 9-31 0Z`} fill="none" stroke={COLOR.fg2} strokeWidth={batchVisibility ? "1.5" : "2"} />
              <circle cx="176" cy={y} r={batchVisibility ? "3" : "4"} fill={COLOR.accent} opacity={hidden ? ".25" : "1"}>
                {animate ? <animate attributeName="opacity" dur="1.5s" values={hidden ? "1;.12;.12;1" : ".15;1;1;.15"} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
              </circle>
              {hidden ? <path d={`m158 ${y - 12} 36 25`} stroke={COLOR.accent} strokeLinecap="round" strokeWidth={batchVisibility ? "2" : "2.5"} /> : null}
            </g>
          ))}
          {batchVisibility ? (
            <g>
              <rect x="166" y="87" width="26" height="14" rx="6" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="1.2" />
              <text x="179" y="97" fill={COLOR.accent} fontSize="8" fontWeight="800" textAnchor="middle">ALL</text>
            </g>
          ) : null}
        </>
      ) : null}
      {action === "lock" ? (
        <>
          {(batchLock ? [28, 52, 76] : [52]).map((y) => (
            <g key={y} transform={`translate(174 ${y})${batchLock ? " scale(.72)" : ""}`}>
              <rect x="-12" y="-2" width="24" height="20" rx="4" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
              <path
                d={unlocked ? "M-7-2v-7a7 7 0 0 1 12-5v7" : "M-7-2v-7a7 7 0 0 1 14 0v7"}
                fill="none"
                stroke={COLOR.fg}
                strokeWidth="2"
              >
                {animate ? (
                  <animate
                    attributeName="d"
                    dur="2.5s"
                    values={unlocked
                      ? "M-7-2v-7a7 7 0 0 1 14 0v7;M-7-2v-7a7 7 0 0 1 12-5v7;M-7-2v-7a7 7 0 0 1 12-5v7;M-7-2v-7a7 7 0 0 1 14 0v7"
                      : "M-7-2v-7a7 7 0 0 1 12-5v7;M-7-2v-7a7 7 0 0 1 14 0v7;M-7-2v-7a7 7 0 0 1 14 0v7;M-7-2v-7a7 7 0 0 1 12-5v7"}
                    keyTimes="0;.42;.72;1"
                    repeatCount="indefinite"
                  />
                ) : null}
              </path>
            </g>
          ))}
          {batchLock ? (
            <g>
              <rect x="161" y="87" width="26" height="14" rx="6" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="1.2" />
              <text x="174" y="97" fill={COLOR.accent} fontSize="8" fontWeight="800" textAnchor="middle">ALL</text>
            </g>
          ) : null}
        </>
      ) : null}
      {action === "actions" ? <g>{[76, 108, 140].map((x, index) => <circle key={x} cx={x} cy="90" r="5" fill={index === 1 ? COLOR.accent : COLOR.fg2}>{animate && index === 1 ? <animate attributeName="r" dur="1.4s" values="4;7;4" repeatCount="indefinite" /> : null}</circle>)}</g> : null}
      {action === "merge" ? (
        flattenVisible ? (
          <g>
            <rect x="158" y="70" width="31" height="22" rx="4" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
            <path d="M164 78h19M164 84h19" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
            {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="0 8;0 0;0 0;0 8" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        ) : (
          <path d="M165 83h24m-12-12v24" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5">
            {animate ? <animate attributeName="opacity" dur="1.4s" values=".3;1;.3" repeatCount="indefinite" /> : null}
          </path>
        )
      ) : null}
    </g>
  );
}

function LayerSelectionActionPreview({
  animate,
  action,
}: {
  animate: boolean;
  action: "duplicate" | "front" | "back" | "delete";
}): ReactElement {
  if (action === "delete") {
    return (
      <>
        <g opacity={animate ? "1" : ".18"}>
          <rect x="49" y="20" width="91" height="58" rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
          <circle cx="72" cy="39" r="7" fill={COLOR.accent} />
          <path d="m57 69 24-22 17 15 12-10 22 17" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2.5" />
          {animate ? <animate attributeName="opacity" dur="2.6s" values="1;1;.12;.12;1" keyTimes="0;.32;.58;.78;1" repeatCount="indefinite" /> : null}
        </g>
        <g transform="translate(164 62)">
          <path d="M-13-9h26m-22 0 2 23H7L9-9m-11-6h4m-6 0h8" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
          {animate ? <animateTransform attributeName="transform" additive="sum" type="translate" dur="2.6s" values="0 8;0 0;0 0;0 8" keyTimes="0;.32;.78;1" repeatCount="indefinite" /> : null}
        </g>
      </>
    );
  }

  if (action === "duplicate") {
    return (
      <>
        <rect x="51" y="25" width="84" height="55" rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
        <g transform={animate ? undefined : "translate(31 -12)"}>
          <rect x="72" y="34" width="84" height="55" rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
          <path d="M93 62h42M114 41v42" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5" />
          {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="0 0;31 -12;31 -12;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </g>
      </>
    );
  }

  const toFront = action === "front";
  return (
    <>
      {[0, 1, 2].map((index) => {
        const selected = index === (toFront ? 0 : 2);
        return (
          <g key={index} transform={`translate(${58 + index * 25} ${22 + index * 14})`}>
            <rect width="80" height="46" rx="6" fill={selected ? COLOR.accentSoft : COLOR.canvas} stroke={selected ? COLOR.accent : COLOR.lineStrong} strokeWidth="2" />
            {selected && animate ? (
              <animateTransform
                attributeName="transform"
                additive="sum"
                type="translate"
                dur="2.8s"
                values={`0 0;${toFront ? 50 : -50} ${toFront ? 28 : -28};${toFront ? 50 : -50} ${toFront ? 28 : -28};0 0`}
                keyTimes="0;.42;.72;1"
                repeatCount="indefinite"
              />
            ) : null}
          </g>
        );
      })}
      <path d={toFront ? "M170 74V25m0 0-8 9m8-9 8 9" : "M46 30v49m0 0-8-9m8 9 8-9"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </>
  );
}

function LineArtPreview({ animate, variant }: { animate: boolean; variant: string }): ReactElement {
  const disable = previewVariantMatches(variant, "disable");
  return (
    <g data-preview-operation={disable ? "line-art-disable" : "line-art-enable"}>
      <g opacity={animate ? (disable ? ".18" : "1") : disable ? "1" : ".18"}>
        <path d="m108 20 48 25-48 25-48-25Z" fill={COLOR.accent} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="2" />
        <path d="m60 45 48 25 48-25v34l-48 25-48-25Z" fill={COLOR.cool} fillOpacity=".72" stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
        {animate ? <animate attributeName="opacity" dur="2.8s" values={disable ? ".18;1;1;.18" : "1;.18;.18;1"} keyTimes="0;.42;.76;1" repeatCount="indefinite" /> : null}
      </g>
      <g opacity={animate ? (disable ? "1" : ".15") : disable ? ".15" : "1"}>
        <path d="m108 20 48 25-48 25-48-25Z" fill={COLOR.card} stroke={COLOR.fg} strokeLinejoin="round" strokeWidth="2" />
        <path d="m60 45 48 25 48-25v34l-48 25-48-25Z" fill={COLOR.canvas} stroke={COLOR.fg} strokeLinejoin="round" strokeWidth="2" />
        <path d="M108 70V35M60 45l48-10 48 10M60 79l48-9 48 9" fill="none" stroke={COLOR.fg} strokeDasharray={animate ? "160" : undefined} strokeDashoffset={animate ? "160" : undefined} strokeWidth="1.7">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values={disable ? "0;0;160;0" : "160;0;0;160"} keyTimes="0;.42;.76;1" repeatCount="indefinite" /> : null}
        </path>
        {animate ? <animate attributeName="opacity" dur="2.8s" values={disable ? "1;.15;.15;1" : ".15;1;1;.15"} keyTimes="0;.42;.76;1" repeatCount="indefinite" /> : null}
      </g>
      <rect x="143" y="15" width="42" height="17" rx="7" fill={COLOR.raised} stroke={disable ? COLOR.cool : COLOR.accent} strokeWidth="1.2" />
      <text x="164" y="26.5" fill={disable ? COLOR.cool : COLOR.accent} fontSize="7.5" fontWeight="800" textAnchor="middle">{disable ? "COLOR" : "LINE"}</text>
    </g>
  );
}

function FrameActionPreview({
  animate,
  action,
  variant,
}: {
  animate: boolean;
  action: "capture" | "playback" | "reorder" | "duplicate" | "delete";
  variant: string;
}): ReactElement {
  const reorderPrevious = previewVariantMatches(variant, "reorder-previous");
  const reorderNext = previewVariantMatches(variant, "reorder-next");
  const pausePlayback = action === "playback" && previewVariantMatches(variant, "pause");
  const cards = [52, 92, 132];
  return (
    <>
      {cards.map((x, index) => (
        <g key={x} opacity={action === "delete" && index === 1 && animate ? ".2" : "1"}>
          <rect x={x} y="27" width="32" height="43" rx="5" fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.7">
            {action === "delete" && index === 1 && animate ? <animate attributeName="opacity" dur="2.5s" values="1;.12;.12;1" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </rect>
          <circle cx={x + 10} cy="39" r="4" fill={index === 1 ? COLOR.accent : COLOR.fg3} />
          <path d={`M${x + 5} 62l8-9 6 6 7-8`} fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
          {action === "reorder" && index === 1 && animate && (reorderPrevious || reorderNext) ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values={`0 0;${reorderPrevious ? -40 : 40} 0;${reorderPrevious ? -40 : 40} 0;0 0`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </g>
      ))}
      {action === "capture" ? <><rect x="75" y="74" width="66" height="18" rx="6" fill={COLOR.raised} stroke={COLOR.fg2} /><circle cx="108" cy="83" r="6" fill={COLOR.accent}>{animate ? <animate attributeName="r" dur="1.5s" values="4;7;4" repeatCount="indefinite" /> : null}</circle></> : null}
      {action === "playback" ? <>{pausePlayback ? <path d="M94 76v20M108 76v20" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="4" /> : <path d="m93 76 17 10-17 10Z" fill={COLOR.accent} />}<path d="M55 88h104" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" /><circle cx={animate ? "58" : pausePlayback ? "118" : "145"} cy="88" r="5" fill={COLOR.accent}>{animate ? <animate attributeName="cx" dur="2.6s" values={pausePlayback ? "58;118;118;58" : "58;158;158;58"} keyTimes={pausePlayback ? "0;.3;.82;1" : "0;.68;.78;1"} repeatCount="indefinite" /> : null}</circle></> : null}
      {action === "reorder" ? <path data-preview-operation={reorderPrevious ? "previous" : reorderNext ? "next" : "reorder"} d={reorderPrevious ? "M113 18H63m0 0 9-7m-9 7 9 7" : reorderNext ? "M103 18h50m0 0-9-7m9 7-9 7" : "M73 18h70m0 0-8-6m8 6-8 6M143 80H73m0 0 8-6m-8 6 8 6"} fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "9 5" : undefined} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2">{animate ? <animate attributeName="stroke-dashoffset" dur="1.1s" values="0;-28" repeatCount="indefinite" /> : null}</path> : null}
      {action === "duplicate" ? <g transform={animate ? undefined : "translate(0 0)"}><rect x="88" y="22" width="32" height="43" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />{animate ? <animateTransform attributeName="transform" type="translate" dur="2.6s" values="0 0;40 6;40 6;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}</g> : null}
      {action === "delete" ? <path d="M94 78h28m-23 0 2 15h14l2-15m-14-5h10" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">{animate ? <animate attributeName="opacity" dur="1.4s" values=".35;1;.35" repeatCount="indefinite" /> : null}</path> : null}
    </>
  );
}

function renderPreview(
  kind: StudioToolHintPreviewKind,
  animate: boolean,
  id: string,
  variant: string
): ReactElement {
  switch (kind) {
    case "select":
      return <SelectionPreview animate={animate} />;
    case "transform":
      return <TransformPreview animate={animate} />;
    case "pan":
      return <PanPreview animate={animate} />;
    case "ink":
      return <InkPreview animate={animate} />;
    case "pixel-ink":
      return <PixelInkPreview animate={animate} />;
    case "erase":
      return <ErasePreview animate={animate} />;
    case "fill":
      return <FillPreview animate={animate} />;
    case "sample":
      return <SamplePreview animate={animate} />;
    case "color-palette":
      return <ColorPalettePreview animate={animate} variant={variant} />;
    case "shape":
      return <DirectShapePreview animate={animate} variant={variant} />;
    case "smart-shape":
      return <ShapeKindPreview animate={animate} kind="smart" variant={variant} />;
    case "shape-rect":
      return <ShapeKindPreview animate={animate} kind="rect" />;
    case "shape-ellipse":
      return <ShapeKindPreview animate={animate} kind="ellipse" />;
    case "shape-fill":
      return <ShapeFillPreview animate={animate} variant={variant} />;
    case "text":
      return <TextPreview animate={animate} clipId={`${id}-text-clip`} />;
    case "bubble":
      return <BubblePreview animate={animate} variant={variant} />;
    case "comment":
      return <CommentPreview animate={animate} />;
    case "image":
      return <ImagePreview animate={animate} />;
    case "reference":
      return <ReferencePreview animate={animate} />;
    case "filter":
      return <FilterPreview animate={animate} clipId={`${id}-filter-clip`} variant={variant} />;
    case "smudge":
      return <SmudgePreview animate={animate} />;
    case "liquify":
      return <LiquifyPreview animate={animate} />;
    case "lasso":
      return <LassoPreview animate={animate} />;
    case "polygon-lasso":
      return <PolygonLassoPreview animate={animate} />;
    case "selection-brush":
      return <SelectionBrushPreview animate={animate} />;
    case "selection-replace":
      return <SelectionCombinePreview animate={animate} operation="replace" />;
    case "selection-add":
      return <SelectionCombinePreview animate={animate} operation="add" />;
    case "selection-subtract":
      return <SelectionCombinePreview animate={animate} operation="subtract" />;
    case "selection-intersect":
      return <SelectionCombinePreview animate={animate} operation="intersect" />;
    case "selection-boundary":
      return <SelectionBoundaryPreview animate={animate} variant={variant} />;
    case "selection-history":
      return <SelectionHistoryPreview animate={animate} variant={variant} />;
    case "selection-marquee-transform":
      return <SelectionMarqueeTransformPreview animate={animate} variant={variant} />;
    case "selection-content-transform":
      return <SelectionContentTransformPreview animate={animate} variant={variant} />;
    case "selection-adjust":
      return <SelectionAdjustPreview animate={animate} variant={variant} />;
    case "selection-layout":
      return <SelectionLayoutPreview animate={animate} variant={variant} />;
    case "lasso-fill":
      return <LassoFillPreview animate={animate} />;
    case "marquee-rect":
      return <MarqueePreview animate={animate} ellipse={false} />;
    case "marquee-ellipse":
      return <MarqueePreview animate={animate} ellipse />;
    case "crop":
      return <CropPreview animate={animate} />;
    case "perspective":
      return <PerspectivePreview animate={animate} />;
    case "rotate-view":
      return <RotateViewPreview animate={animate} variant={variant} />;
    case "flip-view":
      return <FlipViewPreview animate={animate} variant={variant} />;
    case "brush-size":
      return <BrushSizePreview animate={animate} variant={variant} />;
    case "opacity":
      return <OpacityPreview animate={animate} patternId={`${id}-opacity-checker`} variant={variant} />;
    case "stabilizer":
      return <StabilizerPreview animate={animate} variant={variant} />;
    case "pressure":
      return <PressurePreview animate={animate} variant={variant} />;
    case "symmetry":
      return <SymmetryPreview animate={animate} variant={variant} />;
    case "zoom-view":
      return <ZoomViewPreview animate={animate} variant={variant} clipId={`${id}-zoom-fit-clip`} />;
    case "view-hud":
      return <ViewHudPreview animate={animate} variant={variant} />;
    case "color-vision":
      return <StudioColorVisionHintPreview animate={animate} variant={variant} filterId={`${id}-color-vision`} />;
    case "dismiss":
      return <DismissPreview animate={animate} />;
    case "history":
      return <HistoryPreview animate={animate} />;
    case "undo":
      return <HistoryStepPreview animate={animate} direction="undo" />;
    case "redo":
      return <HistoryStepPreview animate={animate} direction="redo" />;
    case "layer":
      return <LayerPreview animate={animate} />;
    case "layer-visibility":
      return <LayerActionPreview animate={animate} action="visibility" variant={variant} />;
    case "layer-lock":
      return <LayerActionPreview animate={animate} action="lock" variant={variant} />;
    case "layer-merge":
      return <LayerActionPreview animate={animate} action="merge" variant={variant} />;
    case "layer-actions":
      return <LayerActionPreview animate={animate} action="actions" variant={variant} />;
    case "layer-duplicate":
      return <LayerSelectionActionPreview animate={animate} action="duplicate" />;
    case "layer-reorder-front":
      return <LayerSelectionActionPreview animate={animate} action="front" />;
    case "layer-reorder-back":
      return <LayerSelectionActionPreview animate={animate} action="back" />;
    case "layer-delete":
      return <LayerSelectionActionPreview animate={animate} action="delete" />;
    case "timeline":
      return <TimelinePreview animate={animate} variant={variant} />;
    case "keyframe":
      return <KeyframePreview animate={animate} />;
    case "frame-sequence":
      return <FrameSequencePreview animate={animate} />;
    case "frame-capture":
      return <FrameActionPreview animate={animate} action="capture" variant={variant} />;
    case "frame-playback":
      return <FrameActionPreview animate={animate} action="playback" variant={variant} />;
    case "frame-reorder":
      return <FrameActionPreview animate={animate} action="reorder" variant={variant} />;
    case "frame-duplicate":
      return <FrameActionPreview animate={animate} action="duplicate" variant={variant} />;
    case "frame-delete":
      return <FrameActionPreview animate={animate} action="delete" variant={variant} />;
    case "onion-skin":
      return <OnionSkinPreview animate={animate} variant={variant} />;
    case "timelapse":
      return <TimelapsePreview animate={animate} />;
    case "motion-fx":
      return <MotionFxPreview animate={animate} />;
    case "video-export":
      return <VideoExportPreview animate={animate} />;
    case "audio":
      return <AudioPreview animate={animate} />;
    case "object-3d":
      return <Object3dPreview animate={animate} />;
    case "object-translate":
      return <ObjectTransformActionPreview animate={animate} action="translate" variant={variant} />;
    case "object-rotate":
      return <ObjectTransformActionPreview animate={animate} action="rotate" variant={variant} />;
    case "object-scale":
      return <ObjectTransformActionPreview animate={animate} action="scale" variant={variant} />;
    case "object-ground":
      return <ObjectTransformActionPreview animate={animate} action="ground" variant={variant} />;
    case "object-snap":
      return <ObjectSnapPreview animate={animate} variant={variant} />;
    case "pose-3d":
      return <Pose3dPreview animate={animate} />;
    case "camera-3d":
      return <Camera3dPreview animate={animate} />;
    case "camera-zoom":
      return <CameraActionPreview animate={animate} action="zoom" variant={variant} />;
    case "camera-reset":
      return <CameraActionPreview animate={animate} action="reset" variant={variant} />;
    case "camera-orbit":
      return <CameraActionPreview animate={animate} action="orbit" variant={variant} />;
    case "quad-view":
      return <CameraActionPreview animate={animate} action="quad" variant={variant} />;
    case "lighting-3d":
      return <Lighting3dPreview animate={animate} />;
    case "line-art":
      return <LineArtPreview animate={animate} variant={variant} />;
    case "assets":
      return <WorkspaceActionPreview animate={animate} kind="assets" />;
    case "panel-layout":
      return <PanelLayoutPreview animate={animate} variant={variant} />;
    case "character-3d":
      return <CharacterBuilderPreview animate={animate} />;
    case "mannequin-3d":
      return <MannequinPoserPreview animate={animate} />;
    case "background-library":
      return <BackgroundLibraryPreview animate={animate} />;
    case "style-library":
      return <StyleLibraryPreview animate={animate} />;
    case "storyboard-grid":
      return <StoryboardGridPreview animate={animate} />;
    case "review-workflow":
      return <ReviewWorkflowPreview animate={animate} />;
    case "team-collaboration":
      return <TeamCollaborationPreview animate={animate} />;
    case "continuity-check":
      return <ContinuityCheckPreview animate={animate} />;
    case "vertical-preview":
      return <VerticalPreviewPreview animate={animate} />;
    case "workspace-focus":
      return <WorkspaceFocusPreview animate={animate} variant={variant} />;
    case "file-workflow":
      return <FileWorkflowPreview animate={animate} />;
    case "edit-workflow":
      return <EditWorkflowPreview animate={animate} />;
    case "insert-content":
      return <InsertContentPreview animate={animate} />;
    case "comment-inbox":
      return <CommentInboxPreview animate={animate} />;
    case "draw-workflow":
      return <DrawWorkflowPreview animate={animate} />;
    case "view-workflow":
      return <ViewWorkflowPreview animate={animate} />;
    case "export":
      return <WorkspaceActionPreview animate={animate} kind="export" />;
    case "export-options":
      return <SettingsSlidersPreview animate={animate} exportMode />;
    case "project":
      return <WorkspaceActionPreview animate={animate} kind="project" />;
    case "fullscreen":
      return <WorkspaceActionPreview animate={animate} kind="fullscreen" variant={variant} />;
    case "settings":
      return <WorkspaceActionPreview animate={animate} kind="settings" />;
    case "save":
      return <WorkspaceActionPreview animate={animate} kind="save" />;
    case "publish":
      return <WorkspaceActionPreview animate={animate} kind="publish" />;
    case "ai-assist":
      return <WorkspaceActionPreview animate={animate} kind="ai" />;
    case "brush-library":
      return <BrushWorkflowPreview animate={animate} action="library" />;
    case "brush-favorite":
      return <BrushWorkflowPreview animate={animate} action="favorite" variant={variant} />;
    case "brush-slot":
      return <BrushWorkflowPreview animate={animate} action="slot" />;
    case "brush-studio":
      return <BrushWorkflowPreview animate={animate} action="studio" />;
    case "draw-settings":
      return <SettingsSlidersPreview animate={animate} variant={variant} />;
  }

  const exhaustiveKind: never = kind;
  throw new Error(`Unsupported Studio tool hint preview: ${exhaustiveKind}`);
}

/**
 * Warm-ink, asset-free micro demonstration for a Studio tool hint.
 *
 * The preview is decorative by default. Pass `aria-label` (or
 * `aria-labelledby`) when it conveys information not already present in the
 * tooltip copy. Motion follows the OS preference unless `reducedMotion` is
 * supplied explicitly.
 */
export function StudioToolHintPreview({
  kind,
  variant,
  reducedMotion,
  className,
  role,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-hidden": ariaHidden,
  ...svgProps
}: StudioToolHintPreviewProps): ReactElement {
  const systemReducedMotion = useSystemReducedMotion();
  const animate = !(reducedMotion ?? systemReducedMotion);
  const id = `studio-tool-preview-${useId().replaceAll(":", "")}`;
  const hasAccessibleName = Boolean(ariaLabel || ariaLabelledBy);
  const normalizedVariant = normalizePreviewVariant(variant ?? kind);

  return (
    <svg
      {...svgProps}
      data-studio-tool-hint-preview={kind}
      data-preview-kind={kind}
      data-preview-variant={normalizedVariant}
      data-motion={animate ? "animated" : "reduced"}
      viewBox="0 0 216 104"
      preserveAspectRatio="xMidYMid meet"
      className={["block h-auto w-full", className].filter(Boolean).join(" ")}
      focusable="false"
      role={hasAccessibleName ? role ?? "img" : role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-hidden={hasAccessibleName ? ariaHidden : true}
    >
      <defs>
        <pattern id={`${id}-ledger`} width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0v16" fill="none" stroke={COLOR.line} strokeWidth=".7" opacity=".28" />
        </pattern>
      </defs>
      <rect x=".5" y=".5" width="215" height="103" rx="7.5" fill={COLOR.card} stroke={COLOR.line} />
      <rect x="1" y="1" width="214" height="102" rx="7" fill={`url(#${id}-ledger)`} />
      <path d="M16 88h184" stroke={COLOR.lineStrong} strokeWidth=".8" opacity=".42" />
      <circle cx="16" cy="88" r="2" fill={COLOR.accent} opacity=".72" />
      {renderPreview(kind, animate, id, normalizedVariant)}
    </svg>
  );
}
