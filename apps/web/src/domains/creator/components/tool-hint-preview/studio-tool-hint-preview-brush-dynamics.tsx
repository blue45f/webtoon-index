import { COLOR, previewVariantMatches } from "./studio-tool-hint-preview-shared";

import type { ReactElement } from "react";

/**
 * Brush dynamics previews (size presets, opacity, stabilizer, pressure,
 * symmetry, and the brush library/slot workflow) plus their shared lock badge.
 *
 * Moved verbatim out of `StudioToolHintPreview.tsx`; each preview stays a pure
 * component whose props are its only inputs.
 */
const BRUSH_SIZE_PRESET_RADIUS = {
  "preset-xs": 4,
  "preset-s": 7,
  "preset-m": 11,
  "preset-l": 16,
  "preset-xl": 21,
  "preset-xxl": 26,
} as const;

function PreviewLock({
  animate,
  locked,
  metric,
}: {
  animate: boolean;
  locked: boolean;
  metric: "size" | "opacity";
}): ReactElement {
  const metricMark = metric === "size" ? "↔" : "%";
  return (
    <g data-preview-operation={`${metric}-${locked ? "lock" : "unlock"}`}>
      <rect x="52" y="20" width="112" height="70" rx="12" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <circle cx="81" cy="55" r="19" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="1.8" />
      <text x="81" y="61" fill={COLOR.accent} fontSize="18" fontWeight="800" textAnchor="middle">
        {metricMark}
      </text>
      <g transform={locked ? "translate(119 51)" : "translate(119 52)"}>
        <rect x="-17" y="-1" width="34" height="29" rx="6" fill={COLOR.raised} stroke={COLOR.fg} strokeWidth="2" />
        <path
          d={locked ? "M-10-1v-9a10 10 0 0 1 20 0v9" : "M-10-1v-9a10 10 0 0 1 18-6"}
          fill="none"
          stroke={COLOR.fg}
          strokeLinecap="round"
          strokeWidth="3"
        />
        <circle cx="0" cy="12" r="3" fill={COLOR.accent}>
          {animate ? (
            <animate attributeName="opacity" dur={locked ? "1.6s" : "2.1s"} values=".25;1;.25" repeatCount="indefinite" />
          ) : null}
        </circle>
        {animate ? (
          <animateTransform
            attributeName="transform"
            additive="sum"
            type="translate"
            dur="2.4s"
            values={locked ? "0 0;0 0;0 0" : "0 0;5 -2;5 -2;0 0"}
            keyTimes="0;.4;.7;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    </g>
  );
}

export function BrushSizePreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  if (previewVariantMatches(variant, "lock", "unlock")) {
    return <PreviewLock animate={animate} locked={previewVariantMatches(variant, "lock")} metric="size" />;
  }

  const preset = Object.keys(BRUSH_SIZE_PRESET_RADIUS).find((candidate) =>
    previewVariantMatches(variant, candidate)
  ) as keyof typeof BRUSH_SIZE_PRESET_RADIUS | undefined;
  const presetRadius = preset ? BRUSH_SIZE_PRESET_RADIUS[preset] : null;
  const radius = presetRadius ?? (animate ? 7 : 17);
  const chipIndex = preset ? Object.keys(BRUSH_SIZE_PRESET_RADIUS).indexOf(preset) : -1;
  return (
    <g data-preview-operation={preset ?? "brush-size-slider"}>
      <circle cx="75" cy="50" r="25" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.5" />
      <circle cx="75" cy="50" r={radius} fill={COLOR.accent} opacity=".88">
        {animate && presetRadius === null ? (
          <animate
            attributeName="r"
            dur="2.7s"
            values="7; 19; 19; 7"
            keyTimes="0; .38; .68; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : animate ? (
          <animate attributeName="opacity" dur="1.8s" values=".45;.95;.45" repeatCount="indefinite" />
        ) : null}
      </circle>
      <path d="M119 68h62" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="3" />
      <path
        d={preset ? `M119 68h${8 + chipIndex * 9}` : animate ? "M119 68h8" : "M119 68h38"}
        stroke={COLOR.accent}
        strokeLinecap="round"
        strokeWidth="3"
      >
        {animate && !preset ? (
          <animate attributeName="d" dur="2.7s" values="M119 68h8;M119 68h54;M119 68h54;M119 68h8" keyTimes="0;.38;.68;1" repeatCount="indefinite" />
        ) : null}
      </path>
      <circle cx={preset ? 127 + chipIndex * 9 : animate ? "127" : "157"} cy="68" r="6" fill={COLOR.fg} stroke={COLOR.canvas} strokeWidth="2">
        {animate && !preset ? (
          <animate attributeName="cx" dur="2.7s" values="127;173;173;127" keyTimes="0;.38;.68;1" repeatCount="indefinite" />
        ) : null}
      </circle>
      {preset ? (
        <text x="150" y="39" fill={COLOR.fg2} fontSize="10" fontWeight="800" textAnchor="middle">
          {preset.replace("preset-", "").toUpperCase()}
        </text>
      ) : (
        <>
          <path d="M124 34h52M124 42h32" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" opacity=".74" />
          <circle cx="178" cy="34" r="3" fill={COLOR.accent} />
        </>
      )}
    </g>
  );
}

export function OpacityPreview({
  animate,
  patternId,
  variant,
}: {
  animate: boolean;
  patternId: string;
  variant: string;
}): ReactElement {
  if (previewVariantMatches(variant, "lock", "unlock")) {
    return <PreviewLock animate={animate} locked={previewVariantMatches(variant, "lock")} metric="opacity" />;
  }

  const opacityPreset = [20, 40, 60, 80, 100].find((value) =>
    previewVariantMatches(variant, `preset-${value}`)
  );
  const opacity = opacityPreset === undefined ? null : opacityPreset / 100;
  return (
    <g data-preview-operation={opacityPreset === undefined ? "opacity-slider" : `preset-${opacityPreset}`}>
      <defs>
        <pattern id={patternId} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={COLOR.canvas} />
          <path d="M0 0h6v6H0ZM6 6h6v6H6Z" fill={COLOR.raised} />
        </pattern>
      </defs>
      <rect x="42" y="21" width="74" height="62" rx="7" fill={`url(#${patternId})`} stroke={COLOR.lineStrong} />
      <circle cx="79" cy="52" r="22" fill={COLOR.accent} opacity={opacity ?? (animate ? ".24" : ".72")}>
        {animate && opacity === null ? (
          <animate attributeName="opacity" dur="2.8s" values=".22;.9;.9;.22" keyTimes="0;.4;.68;1" repeatCount="indefinite" />
        ) : animate ? (
          <animate attributeName="r" dur="1.8s" values="20;23;20" repeatCount="indefinite" />
        ) : null}
      </circle>
      <path d="M135 34h45M135 52h45M135 70h45" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
      <circle cx="165" cy="34" r="4" fill={COLOR.fg2} />
      <circle cx={opacityPreset === undefined ? (animate ? "145" : "166") : 135 + (opacity ?? 0) * 45} cy="52" r="5" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2">
        {animate && opacity === null ? (
          <animate attributeName="cx" dur="2.8s" values="145;176;176;145" keyTimes="0;.4;.68;1" repeatCount="indefinite" />
        ) : null}
      </circle>
      <circle cx="151" cy="70" r="4" fill={COLOR.fg2} />
      {opacityPreset === undefined ? null : (
        <text x="158" y="29" fill={COLOR.fg2} fontSize="9" fontWeight="800" textAnchor="middle">
          {opacityPreset}%
        </text>
      )}
    </g>
  );
}

export function StabilizerPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const isAdaptive = previewVariantMatches(variant, "adaptive");
  const isPrecision = previewVariantMatches(variant, "precision");
  const isPostCorrection = previewVariantMatches(variant, "post-correction");

  if (isPostCorrection) {
    const roughPath = "M39 69c8-28 14 7 23-22 10 33 19-6 28 20 12-31 20 8 31-17 13 23 29-13 57-10";
    const correctedPath = "M39 69c20-28 39-25 55-6 19 22 38 17 54-5 10-14 20-19 30-18";
    return (
      <g data-preview-stabilizer="post-correction">
        <path
          d={roughPath}
          fill="none"
          stroke={COLOR.fg2}
          strokeDasharray={animate ? "220" : "4 4"}
          strokeDashoffset={animate ? "220" : undefined}
          strokeLinecap="round"
          strokeWidth="2.2"
          opacity={animate ? ".9" : ".32"}
        >
          {animate ? (
            <>
              <animate attributeName="stroke-dashoffset" dur="3.2s" values="220;0;0;220" keyTimes="0;.43;.72;1" repeatCount="indefinite" />
              <animate attributeName="opacity" dur="3.2s" values=".9;.9;.18;.18;.9" keyTimes="0;.43;.55;.84;1" repeatCount="indefinite" />
            </>
          ) : null}
        </path>
        <path
          d={correctedPath}
          fill="none"
          stroke={COLOR.accent}
          strokeDasharray="190"
          strokeDashoffset={animate ? "190" : "0"}
          strokeLinecap="round"
          strokeWidth="4.5"
          opacity={animate ? "0" : "1"}
        >
          {animate ? (
            <>
              <animate attributeName="stroke-dashoffset" dur="3.2s" values="190;190;0;0;190" keyTimes="0;.5;.72;.9;1" repeatCount="indefinite" />
              <animate attributeName="opacity" dur="3.2s" values="0;0;1;1;0" keyTimes="0;.48;.58;.9;1" repeatCount="indefinite" />
            </>
          ) : null}
        </path>
        <g transform={animate ? undefined : "translate(178 40)"}>
          <path d="M-6-12H6L4 4 0 11-4 4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
          <circle cy="12" r="2.5" fill={COLOR.accent} />
          {animate ? (
            <>
              <animateMotion dur="3.2s" path={roughPath} keyPoints="0;1;1;1" keyTimes="0;.43;.9;1" repeatCount="indefinite" />
              <animate attributeName="opacity" dur="3.2s" values="1;1;0;0;1" keyTimes="0;.43;.5;.9;1" repeatCount="indefinite" />
            </>
          ) : null}
        </g>
        <path d="M155 75h24m-6-6 6 6-6 6" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </g>
    );
  }

  const rawPath = isAdaptive
    ? "M39 70c17-34 29-31 45-5l12 13 15-39c12-18 30 5 66 19"
    : isPrecision
      ? "M39 68c8-22 13 4 20-16 8 20 14-5 22 12 12-23 20 7 31-10 17-25 34 4 65-13"
      : "M42 72c8-37 19 2 29-29 9 42 19-11 29 25 10-30 19 4 29-22 8 38 20-14 48-11";
  const smoothPath = isAdaptive
    ? "M39 70c18-31 32-29 45-5l12 13 15-39c16-13 34 2 66 19"
    : isPrecision
      ? "M39 68c31-27 60-25 82-10 18 12 35 3 56-17"
      : "M43 69c18-30 36-29 53-6 18 25 38 20 52-6 9-17 18-21 28-20";
  const endpoint = isAdaptive ? "177 58" : isPrecision ? "177 41" : "176 37";
  const controlPoints = isAdaptive
    ? [[39, 70], [84, 65], [96, 78], [111, 39], [177, 58]]
    : isPrecision
      ? [[39, 68], [81, 55], [121, 58], [177, 41]]
      : [[43, 69], [96, 63], [148, 57], [176, 37]];

  return (
    <g data-preview-stabilizer={isAdaptive ? "adaptive" : isPrecision ? "precision" : "standard"}>
      {isPrecision ? (
        <path d="M38 61c32-27 61-25 83-10 18 12 35 3 57-17M40 75c30-27 59-25 81-10 18 12 35 3 55-17" fill="none" stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1" opacity=".48" />
      ) : null}
      <path d={rawPath} fill="none" stroke={COLOR.fg3} strokeDasharray="3 4" strokeLinecap="round" strokeWidth="1.5" opacity=".68" />
      <path d={smoothPath} fill="none" stroke={COLOR.accent} strokeDasharray="210" strokeDashoffset={animate ? "210" : "0"} strokeLinecap="round" strokeLinejoin="round" strokeWidth={isPrecision ? "5" : "4"}>
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.9s" values="210;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
      </path>
      {controlPoints.map(([cx, cy], index) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={isAdaptive && index === 2 ? "4" : "3"} fill={isAdaptive && index === 2 ? COLOR.cool : COLOR.card} stroke={COLOR.fg2} strokeWidth="1.5" />
      ))}
      <g transform={animate ? undefined : `translate(${endpoint})`}>
        <circle r="8" fill={COLOR.fg} stroke={COLOR.canvas} strokeWidth="2" />
        <circle r="2.5" fill={COLOR.accent} />
        {animate ? <animateMotion dur="2.9s" path={smoothPath} keyPoints="0;1;1" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
      </g>
    </g>
  );
}

export function PressurePreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const mode = previewVariantMatches(variant, "soft")
    ? "soft"
    : previewVariantMatches(variant, "firm")
      ? "firm"
      : "linear";
  const widths = mode === "soft" ? [5, 10, 13] : mode === "firm" ? [2, 4, 11] : [3, 7, 11];
  const responsePath = mode === "soft"
    ? "M145 78C148 48 158 30 181 24"
    : mode === "firm"
      ? "M145 78C164 78 177 59 181 24"
      : "M145 78 181 24";
  const segments = [
    "M38 68C53 52 68 44 82 42",
    "M82 42C96 39 109 43 119 50",
    "M119 50C126 55 131 61 137 66",
  ];

  return (
    <g data-preview-pressure-response={mode}>
      <path d="M38 68C68 37 109 37 137 66" fill="none" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="1.5" opacity=".5" />
      {segments.map((path, index) => (
        <path key={path} d={path} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth={animate ? "2" : widths[index]}>
          {animate ? <animate attributeName="stroke-width" dur="2.7s" values={`2;${widths[index]};${widths[index]};2`} keyTimes={`0;${.28 + index * .12};.8;1`} repeatCount="indefinite" /> : null}
        </path>
      ))}
      <path d="M143 80V20M143 80h42" fill="none" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="1.5" />
      <path d={responsePath} fill="none" stroke={COLOR.cool} strokeDasharray={animate ? "78" : undefined} strokeDashoffset={animate ? "78" : undefined} strokeLinecap="round" strokeWidth="2.5">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.7s" values="78;0;0;78" keyTimes="0;.64;.82;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="181" cy="24" r={mode === "soft" ? "5" : mode === "firm" ? "3" : "4"} fill={COLOR.accent} />
      <g transform="translate(102 27)">
        <path d="M-7-14H7L5 5 0 13-5 5Z" fill={COLOR.fg2} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
        <path d="M0 13 5 5H-5Z" fill={COLOR.accent} />
        {animate ? <animateTransform attributeName="transform" additive="sum" type="translate" dur="2.7s" values={mode === "soft" ? "0 -3;0 8;0 2;0 -3" : mode === "firm" ? "0 -8;0 -2;0 9;0 -8" : "0 -6;0 4;0 6;0 -6"} keyTimes="0;.4;.76;1" repeatCount="indefinite" /> : null}
      </g>
    </g>
  );
}

export function SymmetryPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const mode = previewVariantMatches(variant, "none")
    ? "none"
    : previewVariantMatches(variant, "horizontal")
      ? "horizontal"
      : previewVariantMatches(variant, "radial")
        ? "radial"
        : previewVariantMatches(variant, "kaleidoscope")
          ? "kaleidoscope"
          : previewVariantMatches(variant, "silk")
            ? "silk"
            : "vertical";

  if (mode === "none") {
    const freePath = "M48 70c9-35 31-50 57-35 18 11 19 35 50 39";
    return (
      <g data-preview-symmetry="none">
        <path d="M108 18v69" stroke={COLOR.fg3} strokeDasharray="3 4" strokeWidth="1.3" opacity=".42" />
        <path d="m101 24 14-14" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" />
        <path d={freePath} fill="none" stroke={COLOR.accent} strokeDasharray="170" strokeDashoffset={animate ? "170" : "0"} strokeLinecap="round" strokeWidth="4.5">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.7s" values="170;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
        </path>
        <circle cx="155" cy="74" r="4" fill={COLOR.accent} />
      </g>
    );
  }

  if (mode === "horizontal") {
    const upperPath = "M52 44c15-21 34-25 54-10 17 13 31 13 57-2";
    const lowerPath = "M52 60c15 21 34 25 54 10 17-13 31-13 57 2";
    return (
      <g data-preview-symmetry="horizontal">
        <path d="M35 52h146" stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1.5" />
        {[upperPath, lowerPath].map((path, index) => (
          <path key={path} d={path} fill="none" stroke={COLOR.accent} strokeDasharray="145" strokeDashoffset={animate ? "145" : "0"} strokeLinecap="round" strokeWidth="4" opacity={index ? ".72" : "1"}>
            {animate ? <animate attributeName="stroke-dashoffset" dur="2.7s" values="145;0;0" keyTimes="0;.68;1" repeatCount="indefinite" /> : null}
          </path>
        ))}
        <circle cx="35" cy="52" r="4" fill={COLOR.card} stroke={COLOR.cool} strokeWidth="2" />
      </g>
    );
  }

  if (mode === "radial") {
    return (
      <g data-preview-symmetry="radial" transform="translate(108 52)">
        {[0, 60, 120].map((angle) => <path key={angle} d="M-44 0H44" transform={`rotate(${angle})`} stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1" opacity=".52" />)}
        <g>
          {[0, 60, 120, 180, 240, 300].map((angle) => <path key={angle} d="M8 0c8-13 19-12 29 0-10 12-21 13-29 0Z" transform={`rotate(${angle})`} fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />)}
          {animate ? <animateTransform attributeName="transform" type="rotate" dur="3.6s" values="0;60;60" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
        </g>
        <circle r="5" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2" />
      </g>
    );
  }

  if (mode === "kaleidoscope") {
    return (
      <g data-preview-symmetry="kaleidoscope" transform="translate(108 52)">
        {Array.from({ length: 8 }, (_, index) => index * 45).map((angle, index) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path d="M0 0 45-12V12Z" fill={index % 2 ? COLOR.accentSoft : COLOR.raised} stroke={index % 2 ? COLOR.cool : COLOR.accent} strokeWidth="1.2" />
            <circle cx="31" cy="0" r={index % 2 ? "3" : "5"} fill={index % 2 ? COLOR.cool : COLOR.accent} />
          </g>
        ))}
        <circle r="7" fill={COLOR.card} stroke={COLOR.fg} strokeWidth="2" />
        {animate ? <animateTransform attributeName="transform" additive="sum" type="rotate" dur="4.2s" values="0;45;45" keyTimes="0;.75;1" repeatCount="indefinite" /> : null}
      </g>
    );
  }

  if (mode === "silk") {
    return (
      <g data-preview-symmetry="silk" transform="translate(108 52)">
        <circle r="36" fill="none" stroke={COLOR.cool} strokeDasharray="2 5" strokeWidth="1.2" opacity=".55" />
        {Array.from({ length: 6 }, (_, index) => index * 60).map((angle) => (
          <path
            key={angle}
            d="M4 0c8-10 18-16 30-18 2 8-1 16-8 22-7 6-16 9-22 8 5-4 7-9 6-14Z"
            transform={`rotate(${angle})`}
            fill={COLOR.accentSoft}
            stroke={COLOR.accent}
            strokeWidth="1.6"
            opacity=".9"
          />
        ))}
        <circle r="6" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            additive="sum"
            type="rotate"
            dur="5s"
            values="0;60;60"
            keyTimes="0;.7;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    );
  }

  const leftPath = "M99 25c-23 8-35 27-30 50 10-8 19-9 30-5";
  const rightPath = "M117 25c23 8 35 27 30 50-10-8-19-9-30-5";
  return (
    <g data-preview-symmetry="vertical">
      <path d="M108 17v70" stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1.5" />
      {[leftPath, rightPath].map((path, index) => (
        <path key={path} d={path} fill="none" stroke={COLOR.accent} strokeDasharray="95" strokeDashoffset={animate ? "95" : "0"} strokeLinecap="round" strokeWidth="4" opacity={index ? ".72" : "1"}>
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.7s" values="95;0;0" keyTimes="0;.65;1" repeatCount="indefinite" /> : null}
        </path>
      ))}
      <circle cx="108" cy="17" r="4" fill={COLOR.card} stroke={COLOR.cool} strokeWidth="2" />
      <path d="m84 79 9 7M132 86l9-7" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
    </g>
  );
}

export function BrushWorkflowPreview({
  animate,
  action,
  variant = "",
}: {
  animate: boolean;
  action: "library" | "favorite" | "slot" | "studio";
  variant?: string;
}): ReactElement {
  if (action === "library") {
    return (
      <>
        {Array.from({ length: 6 }, (_, index) => {
          const x = 43 + (index % 3) * 48;
          const y = 20 + Math.floor(index / 3) * 36;
          return <rect key={index} x={x} y={y} width="39" height="27" rx="5" fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.7" />;
        })}
        <path d="M51 36c8-10 15 8 23-5M99 33c7-14 14 10 24-4M147 36h24M51 70h24M99 71c8-9 15 7 24-5M147 65c6 8 14 8 24 0" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" />
        <rect x={animate ? "42" : "90"} y={animate ? "19" : "19"} width="41" height="29" rx="6" fill="none" stroke={COLOR.accent} strokeWidth="2.5">
          {animate ? <animate attributeName="x" dur="2.6s" values="42;90;90;42" keyTimes="0;.4;.72;1" repeatCount="indefinite" /> : null}
        </rect>
      </>
    );
  }
  if (action === "favorite") {
    const remove = previewVariantMatches(variant, "remove");
    return (
      <g data-preview-operation={remove ? "remove-favorite" : "add-favorite"}>
        <path d="M42 68c20-29 39 15 58-11 16-22 35-19 58-3" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="5" />
        <path d="m166 22 6 13 14 2-10 10 3 14-13-7-13 7 3-14-10-10 14-2Z" fill={remove ? COLOR.canvas : animate ? COLOR.accentSoft : COLOR.accent} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="2" fillOpacity={animate ? (remove ? "1" : ".15") : remove ? ".08" : "1"}>
          {animate ? <animate attributeName="fill-opacity" dur="1.8s" values={remove ? "1;.08;.08;1" : ".15;1;1;.15"} keyTimes="0;.4;.72;1" repeatCount="indefinite" /> : null}
        </path>
        {remove ? <path d="M150 43h32" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="3" /> : <path d="M166 31v24m-12-12h24" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2" opacity=".7" />}
      </g>
    );
  }
  if (action === "slot") {
    return (
      <>
        {[1, 2, 3, 4].map((slot, index) => (
          <g key={slot} transform={`translate(${44 + index * 39} 35)`}>
            <rect width="31" height="31" rx="7" fill={slot === 3 ? COLOR.accentSoft : COLOR.canvas} stroke={slot === 3 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.8" />
            <text x="15.5" y="20" textAnchor="middle" fill={slot === 3 ? COLOR.accent : COLOR.fg2} fontSize="12" fontWeight="700">{slot}</text>
          </g>
        ))}
        <circle cx={animate ? "60" : "138"} cy="79" r="7" fill={COLOR.accent}>
          {animate ? <animate attributeName="cx" dur="2.6s" values="60;138;138;60" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </circle>
      </>
    );
  }
  return (
    <>
      <path d="M36 69c19-31 38 18 56-12 19-31 36 11 55-17" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="5" />
      <path d="M38 30h63M38 42h45" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
      <path d="M126 78V27h55M126 68c17-2 19-28 36-31 8-2 13-2 19-2" fill="none" stroke={COLOR.cool} strokeWidth="2" />
      <circle cx={animate ? "126" : "162"} cy={animate ? "68" : "37"} r="5" fill={COLOR.accent}>
        {animate ? <><animate attributeName="cx" dur="2.7s" values="126;162;162;126" keyTimes="0;.42;.72;1" repeatCount="indefinite" /><animate attributeName="cy" dur="2.7s" values="68;37;37;68" keyTimes="0;.42;.72;1" repeatCount="indefinite" /></> : null}
      </circle>
    </>
  );
}
