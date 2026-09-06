import { COLOR, previewVariantMatches } from "./studio-tool-hint-preview-shared";

import type { ReactElement } from "react";

/**
 * Selection-operation previews (lasso family, boolean combines, boundary edits,
 * marquee/content transforms, adjust, layout).
 *
 * Moved verbatim out of `StudioToolHintPreview.tsx`; each preview stays a pure
 * component whose props are its only inputs.
 */
export function LassoPreview({ animate }: { animate: boolean }): ReactElement {
  const lassoPath = "M55 63c-18-14 3-39 27-37 19-18 59-5 58 14 27 5 27 30 5 38-24 9-65 5-90-15Z";

  return (
    <>
      <path d="M75 67c8-21 26-29 51-21-4 17-17 26-38 29Z" fill={COLOR.accentSoft} />
      <path
        d={lassoPath}
        fill="none"
        stroke={COLOR.fg}
        strokeDasharray="5 4"
        strokeLinecap="round"
        strokeWidth="1.6"
      >
        {animate ? (
          <animate attributeName="stroke-dashoffset" dur=".8s" values="0; -18" repeatCount="indefinite" />
        ) : null}
      </path>
      <path
        d={lassoPath}
        fill="none"
        stroke={COLOR.accent}
        strokeDasharray="164"
        strokeDashoffset={animate ? "164" : "0"}
        strokeLinecap="round"
        strokeWidth="2"
        opacity=".9"
      >
        {animate ? (
          <animate attributeName="stroke-dashoffset" dur="3s" values="164; 0; 0" keyTimes="0; .72; 1" repeatCount="indefinite" />
        ) : null}
      </path>
      <g transform={animate ? undefined : "translate(55 63)"}>
        <path d="m0 0 7 19 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
        {animate ? (
          <animateMotion
            dur="3s"
            path={lassoPath}
            rotate="auto"
            keyPoints="0; 1; 1"
            keyTimes="0; .72; 1"
            calcMode="spline"
            keySplines=".16 1 .3 1; .16 1 .3 1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    </>
  );
}

export function PolygonLassoPreview({ animate }: { animate: boolean }): ReactElement {
  const points = "58,68 68,30 113,22 158,43 145,79 88,83";
  return (
    <>
      <polygon points={points} fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2">
        {animate ? <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-20" repeatCount="indefinite" /> : null}
      </polygon>
      <polyline
        points={points}
        fill="none"
        stroke={COLOR.accent}
        strokeDasharray="238"
        strokeDashoffset={animate ? "238" : "0"}
        strokeLinejoin="round"
        strokeWidth="2.5"
      >
        {animate ? <animate attributeName="stroke-dashoffset" dur="3s" values="238;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}
      </polyline>
      {[[58, 68], [68, 30], [113, 22], [158, 43], [145, 79], [88, 83]].map(([cx, cy], index) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill={index === 5 ? COLOR.accent : COLOR.card} stroke={COLOR.accent} strokeWidth="1.5">
          {animate && index === 5 ? <animate attributeName="r" dur="1.25s" values="3;6;3" repeatCount="indefinite" /> : null}
        </circle>
      ))}
      <path d="m151 68 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={COLOR.fg} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

export function SelectionBrushPreview({ animate }: { animate: boolean }): ReactElement {
  const path = "M48 68c25-34 49 16 73-18 14-19 31-13 47-2";
  return (
    <>
      <path d={path} fill="none" stroke={COLOR.accentSoft} strokeLinecap="round" strokeWidth="28" />
      <path d={path} fill="none" stroke={COLOR.fg} strokeDasharray="5 4" strokeLinecap="round" strokeWidth="1.8">
        {animate ? <animate attributeName="stroke-dashoffset" dur=".75s" values="0;-18" repeatCount="indefinite" /> : null}
      </path>
      <path d={path} fill="none" stroke={COLOR.accent} strokeDasharray="171" strokeDashoffset={animate ? "171" : "0"} strokeLinecap="round" strokeWidth="5">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="171;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
      </path>
      <g transform={animate ? undefined : "translate(168 48)"}>
        <circle r="13" fill={COLOR.canvas} stroke={COLOR.accent} strokeWidth="2" />
        <circle r="3" fill={COLOR.accent} />
        {animate ? <animateMotion dur="2.8s" path={path} keyPoints="0;1;1" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

export function SelectionCombinePreview({
  animate,
  operation,
}: {
  animate: boolean;
  operation: "replace" | "add" | "subtract" | "intersect";
}): ReactElement {
  const secondX = animate ? "145" : "130";
  return (
    <>
      <circle
        cx="88"
        cy="52"
        r="31"
        fill={operation === "replace" ? COLOR.canvas : COLOR.accentSoft}
        stroke={operation === "replace" ? COLOR.fg3 : COLOR.accent}
        strokeDasharray={operation === "replace" ? "4 4" : undefined}
        strokeWidth="2"
        opacity={operation === "replace" ? (animate ? ".22" : ".36") : "1"}
      >
        {operation === "replace" && animate ? (
          <animate attributeName="opacity" dur="2.8s" values=".55;.12;.12;.55" keyTimes="0;.42;.72;1" repeatCount="indefinite" />
        ) : null}
      </circle>
      <circle cx={secondX} cy="52" r="31" fill={operation === "subtract" ? COLOR.canvas : COLOR.cool} fillOpacity={operation === "intersect" ? ".18" : ".32"} stroke={COLOR.fg2} strokeDasharray="5 4" strokeWidth="2">
        {animate ? <animate attributeName="cx" dur="2.8s" values="145;119;119;145" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </circle>
      {operation === "intersect" ? (
        <path d="M108 27c18 8 28 23 28 25s-10 17-28 25c-14-10-22-22-22-25s8-15 22-25Z" fill={COLOR.accent} opacity={animate ? ".35" : ".82"}>
          {animate ? <animate attributeName="opacity" dur="2.8s" values=".2;.85;.85;.2" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </path>
      ) : null}
      {operation === "subtract" ? (
        <path d="M107 29c17 9 27 21 27 23s-10 15-27 23c7-15 7-31 0-46Z" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeDasharray="3 3" />
      ) : null}
      {operation === "replace" ? (
        <path d="M95 24l-8 8 8 8M87 32h19" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          {animate ? <animate attributeName="opacity" dur="1.3s" values=".35;1;.35" repeatCount="indefinite" /> : null}
        </path>
      ) : operation === "add" ? (
        <path d="M108 21v62M77 52h62" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" opacity={animate ? ".35" : ".9"}>
          {animate ? <animate attributeName="opacity" dur="1.3s" values=".3;1;.3" repeatCount="indefinite" /> : null}
        </path>
      ) : operation === "subtract" ? (
        <path d="M78 52h59" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
      ) : (
        <path d="M108 30v44M92 52h32" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2" opacity=".72" />
      )}
    </>
  );
}

export function SelectionBoundaryPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const clear = previewVariantMatches(variant, "clear");
  const invert = previewVariantMatches(variant, "invert");
  const removeLast = previewVariantMatches(variant, "remove-last-subpath");
  const expand = previewVariantMatches(variant, "expand");
  const contract = previewVariantMatches(variant, "contract");

  if (removeLast) {
    return (
      <>
        <rect x="39" y="15" width="138" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <path d="M56 69c4-23 22-37 43-31 12 4 20 15 18 29-16 13-43 14-61 2Z" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="5 4" strokeWidth="2" />
        <path d="M124 39c17-10 36-2 39 14 2 13-8 25-24 27-15-7-21-27-15-41Z" fill={COLOR.cool} fillOpacity=".16" stroke={COLOR.fg2} strokeDasharray="5 4" strokeWidth="2" opacity={animate ? "1" : ".24"}>
          {animate ? <animate attributeName="opacity" dur="2.5s" values="1;.18;.18;1" keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
        </path>
        <path d="M137 52l14 14m0-14-14 14" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5" />
      </>
    );
  }

  if (invert) {
    return (
      <>
        <rect x="39" y="15" width="138" height="76" rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
        <rect x="72" y="31" width="72" height="44" rx="13" fill={COLOR.canvas} stroke={COLOR.fg} strokeDasharray="5 4" strokeWidth="2">
          {animate ? <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-18" repeatCount="indefinite" /> : null}
        </rect>
        <path d="M51 27h15M51 27v15M165 79h-15m15 0V64" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.4" />
      </>
    );
  }

  if (clear) {
    return (
      <>
        <rect x="39" y="15" width="138" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <rect x="62" y="28" width="92" height="50" rx="12" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" opacity={animate ? "1" : ".22"}>
          {animate ? <animate attributeName="opacity" dur="2.4s" values="1;.15;.15;1" keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
        </rect>
        <path d="M98 43l20 20m0-20-20 20" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
      </>
    );
  }

  if (expand || contract) {
    const fromX = expand ? 77 : 55;
    const fromY = expand ? 34 : 24;
    const fromWidth = expand ? 62 : 106;
    const fromHeight = expand ? 38 : 58;
    const toX = expand ? 55 : 77;
    const toY = expand ? 24 : 34;
    const toWidth = expand ? 106 : 62;
    const toHeight = expand ? 58 : 38;
    return (
      <>
        <rect x="39" y="15" width="138" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <rect x={fromX} y={fromY} width={fromWidth} height={fromHeight} rx="9" fill="none" stroke={COLOR.fg3} strokeDasharray="4 4" strokeWidth="1.5" />
        <rect x={animate ? fromX : toX} y={animate ? fromY : toY} width={animate ? fromWidth : toWidth} height={animate ? fromHeight : toHeight} rx="9" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="6 4" strokeWidth="2.4">
          {animate ? (
            <>
              <animate attributeName="x" dur="2.6s" values={`${fromX};${toX};${toX};${fromX}`} keyTimes="0;.4;.72;1" repeatCount="indefinite" />
              <animate attributeName="y" dur="2.6s" values={`${fromY};${toY};${toY};${fromY}`} keyTimes="0;.4;.72;1" repeatCount="indefinite" />
              <animate attributeName="width" dur="2.6s" values={`${fromWidth};${toWidth};${toWidth};${fromWidth}`} keyTimes="0;.4;.72;1" repeatCount="indefinite" />
              <animate attributeName="height" dur="2.6s" values={`${fromHeight};${toHeight};${toHeight};${fromHeight}`} keyTimes="0;.4;.72;1" repeatCount="indefinite" />
            </>
          ) : null}
        </rect>
        <path d={expand ? "M47 53H68m-21 0 8-7m-8 7 8 7M169 53h-21m21 0-8-7m8 7-8 7" : "M69 53H48m21 0-8-7m8 7-8 7M147 53h21m-21 0 8-7m-8 7 8 7"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      </>
    );
  }

  return (
    <>
      <rect x="39" y="15" width="138" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <rect x={animate ? "86" : "48"} y={animate ? "43" : "23"} width={animate ? "44" : "120"} height={animate ? "22" : "60"} rx="7" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2">
        {animate ? (
          <>
            <animate attributeName="x" dur="2.6s" values="86;48;48;86" keyTimes="0;.4;.72;1" repeatCount="indefinite" />
            <animate attributeName="y" dur="2.6s" values="43;23;23;43" keyTimes="0;.4;.72;1" repeatCount="indefinite" />
            <animate attributeName="width" dur="2.6s" values="44;120;120;44" keyTimes="0;.4;.72;1" repeatCount="indefinite" />
            <animate attributeName="height" dur="2.6s" values="22;60;60;22" keyTimes="0;.4;.72;1" repeatCount="indefinite" />
          </>
        ) : null}
      </rect>
      <path d="M52 28h12M52 28v12M164 78h-12m12 0V66" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.3" />
    </>
  );
}

export function SelectionHistoryPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const redo = previewVariantMatches(variant, "redo");
  return (
    <>
      <rect x="47" y="19" width="122" height="68" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d="M69 69c6-25 27-37 52-25 8 4 13 11 15 21-20 12-48 13-67 4Z" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="5 4" strokeWidth="2">
        {animate ? <animate attributeName="stroke-dashoffset" dur=".8s" values="0;-18" repeatCount="indefinite" /> : null}
      </path>
      <path d={redo ? "M70 30c26-18 59-13 76 10m0 0-3-13m3 13-13-2" : "M146 30c-26-18-59-13-76 10m0 0 3-13m-3 13 13-2"} fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "82" : undefined} strokeDashoffset={animate ? "82" : undefined} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.2s" values="82;0;0" keyTimes="0;.62;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx={redo ? "151" : "65"} cy="74" r="7" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="2" />
    </>
  );
}

export function SelectionMarqueeTransformPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const flipX = previewVariantMatches(variant, "flip-x");
  const flipY = previewVariantMatches(variant, "flip-y");
  const scaleDown = previewVariantMatches(variant, "scale-down");
  const scaleUp = previewVariantMatches(variant, "scale-up");
  const translateLeft = previewVariantMatches(variant, "translate-left");
  const translateRight = previewVariantMatches(variant, "translate-right");
  const translateUp = previewVariantMatches(variant, "translate-up");
  const translateDown = previewVariantMatches(variant, "translate-down");
  const rotateCcw = previewVariantMatches(variant, "rotate-ccw-90");
  const rotateHalf = previewVariantMatches(variant, "rotate-180");
  const rotateCustom = previewVariantMatches(variant, "rotate-custom");
  const translate = translateLeft || translateRight || translateUp || translateDown;
  const scale = scaleUp || scaleDown;

  if (flipX || flipY) {
    return (
      <>
        <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <path d={flipX ? "M108 22v62" : "M54 53h108"} stroke={COLOR.cool} strokeDasharray="4 4" strokeWidth="1.5" />
        <g transform="translate(108 53)">
          <g transform={animate ? "scale(1 1)" : flipX ? "scale(-1 1)" : "scale(1 -1)"}>
            <g transform="translate(-108 -53)">
              <path d="M68 34h66v38H68Z" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" />
              <path d="m76 64 17-20 15 13 10-9 9 16" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
            </g>
            {animate ? <animateTransform attributeName="transform" type="scale" dur="2.6s" values={flipX ? "1 1;-1 1;-1 1;1 1" : "1 1;1 -1;1 -1;1 1"} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        </g>
      </>
    );
  }

  if (translate) {
    const dx = translateLeft ? -28 : translateRight ? 28 : 0;
    const dy = translateUp ? -18 : translateDown ? 18 : 0;
    const arrow = translateLeft
      ? "M92 53H52m0 0 9-8m-9 8 9 8"
      : translateRight
        ? "M124 53h40m0 0-9-8m9 8-9 8"
        : translateUp
          ? "M108 47V19m0 0-8 9m8-9 8 9"
          : "M108 59v28m0 0-8-9m8 9 8-9";
    return (
      <>
        <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <g transform={animate ? undefined : `translate(${dx} ${dy})`}>
          <rect x="78" y="34" width="60" height="38" rx="6" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" />
          {animate ? <animateTransform attributeName="transform" type="translate" dur="2.5s" values={`0 0;${dx} ${dy};${dx} ${dy};0 0`} keyTimes="0;.4;.72;1" repeatCount="indefinite" /> : null}
        </g>
        <path d={arrow} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      </>
    );
  }

  if (scale) {
    const targetScale = scaleDown ? 0.68 : 1.25;
    return (
      <>
        <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <rect x="75" y="33" width="66" height="40" rx="5" fill="none" stroke={COLOR.fg3} strokeDasharray="4 4" />
        <g transform="translate(108 53)">
          <g transform={animate ? "scale(1)" : `scale(${targetScale})`}>
            <g transform="translate(-108 -53)">
              <rect x="75" y="33" width="66" height="40" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="6 4" strokeWidth="2" />
            </g>
            {animate ? <animateTransform attributeName="transform" type="scale" dur="2.6s" values={`1;${targetScale};${targetScale};1`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        </g>
        <path d={scaleDown ? "M68 25l12 12m-12-12 1 9m-1-9 9 1M148 81l-12-12m12 12-1-9m1 9-9-1" : "M80 37 67 24m0 0 1 9m-1-9 9 1M136 69l13 13m0 0-1-9m1 9-9-1"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </>
    );
  }

  const rotation = rotateCcw ? -90 : rotateHalf ? 180 : rotateCustom ? 35 : 90;
  return (
    <>
      <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <g transform={animate ? undefined : `rotate(${rotation} 108 53)`}>
        <rect x="75" y="32" width="66" height="42" rx="6" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" />
        {animate ? <animateTransform attributeName="transform" type="rotate" dur="2.7s" values={`0 108 53;${rotation} 108 53;${rotation} 108 53;0 108 53`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </g>
      <path d={rotateCcw ? "M69 38a43 43 0 0 1 75-8m-75 8 12-2m-12 2 4-12" : rotateHalf ? "M67 40a44 44 0 1 1 2 31m-2-31 13-1m-13 1 5-12" : "M147 38a43 43 0 0 0-75-8m75 8-12-2m12 2-4-12"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </>
  );
}

export function SelectionContentTransformPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const flipX = previewVariantMatches(variant, "flip-x");
  const flipY = previewVariantMatches(variant, "flip-y");
  const rotate = previewVariantMatches(variant, "rotate-cw-90");
  const remove = previewVariantMatches(variant, "delete");
  const contentAware = previewVariantMatches(variant, "content-aware-fill");

  if (remove || contentAware) {
    return (
      <>
        <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
        <path d="M48 79 77 49l18 17 15-14 19 15 31-31" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" opacity=".5" />
        <rect x="78" y="31" width="60" height="44" rx="12" fill={remove ? COLOR.raised : COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" opacity={animate ? "1" : remove ? ".18" : ".86"}>
          {animate ? <animate attributeName="opacity" dur="2.6s" values={remove ? "1;.1;.1;1" : ".15;.9;.9;.15"} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </rect>
        {contentAware ? (
          <>
            <path d="M84 64 99 48l10 9 9-8 14 15" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
            <path d="M148 24v12m-6-6h12M157 41v8m-4-4h8" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
          </>
        ) : (
          <path d="M96 43l24 24m0-24L96 67" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
        )}
      </>
    );
  }

  const artwork = (
    <>
      <rect x="70" y="29" width="76" height="48" rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="6 4" strokeWidth="2" />
      <circle cx="91" cy="44" r="6" fill={COLOR.accent} />
      <path d="m75 69 18-17 13 11 12-9 23 15" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    </>
  );
  const transformedArtwork = flipX || flipY ? (
    <g transform="translate(108 53)">
      <g transform={animate ? "scale(1 1)" : flipX ? "scale(-1 1)" : "scale(1 -1)"}>
        <g transform="translate(-108 -53)">{artwork}</g>
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="scale"
            dur="2.7s"
            values={flipX ? "1 1;-1 1;-1 1;1 1" : "1 1;1 -1;1 -1;1 1"}
            keyTimes="0;.42;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    </g>
  ) : rotate ? (
    <g transform={animate ? undefined : "rotate(90 108 53)"}>
      {artwork}
      {animate ? (
        <animateTransform
          attributeName="transform"
          type="rotate"
          dur="2.7s"
          values="0 108 53;90 108 53;90 108 53;0 108 53"
          keyTimes="0;.42;.72;1"
          repeatCount="indefinite"
        />
      ) : null}
    </g>
  ) : (
    <g transform="translate(108 53)">
      <g transform={animate ? undefined : "rotate(12)"}>
        <g transform={animate ? undefined : "scale(1.18)"}>
          <g transform="translate(-108 -53)">{artwork}</g>
          {animate ? (
            <animateTransform
              attributeName="transform"
              type="scale"
              dur="2.7s"
              values="1;1.18;1.18;1"
              keyTimes="0;.42;.72;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="rotate"
            dur="2.7s"
            values="0;12;12;0"
            keyTimes="0;.42;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
    </g>
  );
  return (
    <>
      <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <rect x="70" y="29" width="76" height="48" rx="7" fill="none" stroke={COLOR.fg3} strokeDasharray="4 4" />
      {transformedArtwork}
      <path d={flipX ? "M108 22v62" : flipY ? "M55 53h106" : rotate ? "M151 31a20 20 0 0 1 3 25m-3-25-1 10-9-4" : "M154 74h25m0 0-8-7m8 7-8 7"} fill="none" stroke={COLOR.fg} strokeDasharray={flipX || flipY ? "4 4" : undefined} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </>
  );
}

export function SelectionAdjustPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const hue = previewVariantMatches(variant, "hue");
  return (
    <>
      <rect x="42" y="16" width="132" height="74" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d="M48 79 77 49l18 17 15-14 19 15 31-31" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" opacity=".42" />
      <rect x="72" y="29" width="72" height="48" rx="11" fill={COLOR.accentSoft} stroke={COLOR.fg} strokeDasharray="6 4" strokeWidth="2" />
      {hue ? (
        <>
          {[COLOR.accent, "var(--color-good, oklch(0.80 0.15 150))", COLOR.cool].map((fill, index) => (
            <circle key={fill} cx={91 + index * 17} cy="53" r={index === 1 ? "10" : "8"} fill={fill} opacity={index === 1 ? ".9" : ".58"}>
              {animate && index === 1 ? <animate attributeName="r" dur="1.6s" values="7;11;7" repeatCount="indefinite" /> : null}
            </circle>
          ))}
          <path d="M83 74a34 34 0 0 0 50-4m0 0-11 2m11-2-4 10" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </>
      ) : (
        <>
          <circle cx="108" cy="52" r="12" fill={COLOR.accent} opacity={animate ? ".26" : ".9"}>
            {animate ? <animate attributeName="opacity" dur="2.4s" values=".2;1;1;.2" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </circle>
          <path d="M108 30v8m0 28v8M86 52h8m28 0h8M93 37l6 6m18 18 6 6m0-30-6 6M99 61l-6 6" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
        </>
      )}
    </>
  );
}

export function SelectionLayoutPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const operations = [
    "group",
    "align-left",
    "align-hcenter",
    "align-right",
    "align-top",
    "align-vcenter",
    "align-bottom",
    "distribute-horizontal",
    "distribute-vertical",
    "flip-horizontal",
    "flip-vertical",
  ] as const;
  const operation =
    operations.find((candidate) => previewVariantMatches(variant, candidate)) ?? "group";
  const source = [
    { x: 55, y: 24, width: 25, height: 17 },
    { x: 96, y: 43, width: 32, height: 23 },
    { x: 141, y: 57, width: 20, height: 29 },
  ] as const;
  const targets = source.map((item, index) => {
    if (operation === "align-left") return { x: 55, y: item.y };
    if (operation === "align-hcenter") return { x: 108 - item.width / 2, y: item.y };
    if (operation === "align-right") return { x: 161 - item.width, y: item.y };
    if (operation === "align-top") return { x: item.x, y: 24 };
    if (operation === "align-vcenter") return { x: item.x, y: 55 - item.height / 2 };
    if (operation === "align-bottom") return { x: item.x, y: 86 - item.height };
    if (operation === "distribute-horizontal") {
      return { x: [45, 94.5, 151][index] ?? item.x, y: item.y };
    }
    if (operation === "distribute-vertical") {
      return { x: item.x, y: [17, 35.5, 60][index] ?? item.y };
    }
    // Mirror about the selection AABB (x 55..161, y 24..86), matching planStudioSelectionFlip.
    if (operation === "flip-horizontal") {
      return { x: 216 - (item.x + item.width), y: item.y };
    }
    if (operation === "flip-vertical") {
      return { x: item.x, y: 110 - (item.y + item.height) };
    }
    return { x: item.x, y: item.y };
  });
  const verticalGuide = ["align-left", "align-hcenter", "align-right", "flip-horizontal"].includes(
    operation,
  );
  const horizontalGuide = ["align-top", "align-vcenter", "align-bottom", "flip-vertical"].includes(
    operation,
  );
  const guideX = operation === "align-left" ? 55 : operation === "align-right" ? 161 : 108;
  const guideY = operation === "align-top" ? 24 : operation === "align-bottom" ? 86 : 55;

  return (
    <g data-preview-operation={operation}>
      <rect x="38" y="13" width="140" height="79" rx="9" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      {verticalGuide ? (
        <path d={`M${guideX} 18v69`} stroke={COLOR.accent} strokeDasharray="4 3" strokeWidth="1.6" />
      ) : null}
      {horizontalGuide ? (
        <path d={`M43 ${guideY}h130`} stroke={COLOR.accent} strokeDasharray="4 3" strokeWidth="1.6" />
      ) : null}
      {operation === "distribute-horizontal" ? (
        <path d="M45 18h126m-126 0 6-4m-6 4 6 4m120-4-6-4m6 4-6 4" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      ) : null}
      {operation === "distribute-vertical" ? (
        <path d="M171 17v72m0-72-4 6m4-6 4 6m-4 66-4-6m4 6 4-6" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      ) : null}
      {source.map((item, index) => {
        const target = targets[index] ?? item;
        return (
          <rect
            key={index}
            x={animate && operation !== "group" ? item.x : target.x}
            y={animate && operation !== "group" ? item.y : target.y}
            width={item.width}
            height={item.height}
            rx="4"
            fill={index === 1 ? COLOR.accentSoft : COLOR.raised}
            stroke={index === 1 ? COLOR.accent : COLOR.fg2}
            strokeWidth="1.7"
          >
            {animate && operation !== "group" ? (
              <>
                <animate
                  attributeName="x"
                  dur="2.8s"
                  values={`${item.x};${target.x};${target.x};${item.x}`}
                  keyTimes="0;.42;.72;1"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="y"
                  dur="2.8s"
                  values={`${item.y};${target.y};${target.y};${item.y}`}
                  keyTimes="0;.42;.72;1"
                  repeatCount="indefinite"
                />
              </>
            ) : null}
          </rect>
        );
      })}
      {operation === "group" ? (
        <>
          <rect x="47" y="17" width="122" height="72" rx="7" fill="none" stroke={COLOR.accent} strokeDasharray="6 4" strokeWidth="2">
            {animate ? (
              <animate attributeName="stroke-dashoffset" dur="1.2s" values="0;-20" repeatCount="indefinite" />
            ) : null}
          </rect>
          <path d="M178 36h12v31h-12m-140-31H26v31h12" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        </>
      ) : animate ? (
        <circle cx={verticalGuide ? guideX : 108} cy={horizontalGuide ? guideY : 52} r="5" fill={COLOR.accent} opacity=".35">
          <animate attributeName="r" dur="1.7s" values="3;7;3" repeatCount="indefinite" />
        </circle>
      ) : null}
    </g>
  );
}
