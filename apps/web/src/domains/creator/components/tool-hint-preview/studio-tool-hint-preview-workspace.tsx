import { COLOR, previewVariantMatches } from "./studio-tool-hint-preview-shared";

import type { ReactElement } from "react";

/**
 * Workspace + workflow previews (menus, panels, libraries, review/collaboration
 * surfaces and the shared settings-slider demo).
 *
 * Moved verbatim out of `StudioToolHintPreview.tsx`; each preview stays a pure
 * component whose props are its only inputs.
 */
export function CommentPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="43" y="18" width="78" height="68" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <path d="m49 76 19-20 15 13 11-10 21 17" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <g transform={animate ? undefined : "translate(91 48)"}>
        <path d="M0-9a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 18v13" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2" />
        {animate ? <animateMotion dur="2.7s" path="M91 28V48" keyPoints="0;1;1" keyTimes="0;.38;1" repeatCount="indefinite" /> : null}
      </g>
      <g transform={animate ? undefined : "translate(0 0)"}>
        <path d="M126 29h48c7 0 12 5 12 12v22c0 7-5 12-12 12h-26l-10 9 2-9h-14c-7 0-12-5-12-12V41c0-7 5-12 12-12Z" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="2" />
        <path d="M127 44h43M127 54h34M127 64h24" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="10 0;0 0;0 0;10 0" keyTimes="0;.38;.78;1" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

export function WorkspaceActionPreview({ animate, kind, variant = "" }: { animate: boolean; kind: "assets" | "export" | "project" | "fullscreen" | "settings" | "save" | "publish" | "ai"; variant?: string }): ReactElement {
  if (kind === "fullscreen") {
    const canvasOnly = previewVariantMatches(variant, "canvas-only");
    const maximizeWindow = previewVariantMatches(variant, "maximize-window");
    const restoreWindow = previewVariantMatches(variant, "restore-window");
    const exitFullscreen = previewVariantMatches(variant, "exit-fullscreen");
    if (canvasOnly) {
      return (
        <>
          <rect x="32" y="15" width="152" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
          <rect x="39" y="22" width="22" height="62" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? ".78" : ".16"}>
            {animate ? <animate attributeName="opacity" dur="2.6s" values=".78;.12;.12;.78" keyTimes="0;.38;.74;1" repeatCount="indefinite" /> : null}
          </rect>
          <rect x="155" y="22" width="22" height="62" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? ".78" : ".16"}>
            {animate ? <animate attributeName="opacity" dur="2.6s" values=".78;.12;.12;.78" keyTimes="0;.38;.74;1" repeatCount="indefinite" /> : null}
          </rect>
          <rect x={animate ? "68" : "46"} y="22" width={animate ? "80" : "124"} height="62" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2">
            {animate ? <><animate attributeName="x" dur="2.6s" values="68;46;46;68" keyTimes="0;.38;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.6s" values="80;124;124;80" keyTimes="0;.38;.74;1" repeatCount="indefinite" /></> : null}
          </rect>
          <path d="M79 68 96 48l14 13 12-10 17 17" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </>
      );
    }
    if (restoreWindow) {
      return (
        <g data-preview-operation="restore-window">
          <rect x="31" y="13" width="154" height="79" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
          <rect x="38" y="20" width="140" height="12" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? ".12" : ".88"}>
            {animate ? <animate attributeName="opacity" dur="2.7s" values=".12;.88;.88;.12" keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
          </rect>
          <rect x="38" y="36" width="23" height="49" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? ".12" : ".88"}>
            {animate ? <animate attributeName="opacity" dur="2.7s" values=".12;.88;.88;.12" keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
          </rect>
          <rect x={animate ? "40" : "67"} y={animate ? "20" : "36"} width={animate ? "136" : "105"} height={animate ? "64" : "49"} rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2">
            {animate ? <><animate attributeName="x" dur="2.7s" values="40;67;67;40" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="y" dur="2.7s" values="20;36;36;20" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.7s" values="136;105;105;136" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="height" dur="2.7s" values="64;49;49;64" keyTimes="0;.42;.74;1" repeatCount="indefinite" /></> : null}
          </rect>
          <path d="M50 28h10m-5-5v10M50 73h10m-5-5v10M160 28h10m-5-5v10" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="1.8" />
          <path d="M51 45 65 57m-14 0 14-12M165 45l-14 12m14 0-14-12" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
        </g>
      );
    }
    if (exitFullscreen) {
      return (
        <g data-preview-operation="exit-fullscreen">
          <rect x="31" y="13" width="154" height="79" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
          <rect x={animate ? "38" : "64"} y={animate ? "20" : "28"} width={animate ? "140" : "88"} height={animate ? "65" : "53"} rx="7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2">
            {animate ? <><animate attributeName="x" dur="2.7s" values="38;64;64;38" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="y" dur="2.7s" values="20;28;28;20" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.7s" values="140;88;88;140" keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="height" dur="2.7s" values="65;53;53;65" keyTimes="0;.42;.74;1" repeatCount="indefinite" /></> : null}
          </rect>
          <path d="M64 41h88M72 35h2m6 0h2m6 0h2" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="1.8" />
          <path d="M44 28 58 42m0-14L44 42M172 28l-14 14m14 0-14-14M44 77l14-14m-14 0 14 14M172 77l-14-14m14 0-14 14" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.2" />
        </g>
      );
    }
    if (maximizeWindow) {
      return (
        <>
          <rect x={animate ? "67" : "43"} y={animate ? "29" : "14"} width={animate ? "82" : "130"} height={animate ? "49" : "77"} rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2">
            {animate ? <><animate attributeName="x" dur="2.7s" values="67;43;43;67" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="y" dur="2.7s" values="29;14;14;29" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.7s" values="82;130;130;82" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="height" dur="2.7s" values="49;77;77;49" keyTimes="0;.4;.74;1" repeatCount="indefinite" /></> : null}
          </rect>
          <path d="M43 29h130M52 21h2m7 0h2m7 0h2" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="2" />
          <path d="M56 45V35h10M160 45V35h-10M56 72v10h10M160 72v10h-10" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5" />
        </>
      );
    }
    return (
      <g data-preview-operation="enter-fullscreen">
        <rect x={animate ? "68" : "45"} y={animate ? "31" : "17"} width={animate ? "80" : "126"} height={animate ? "43" : "70"} rx="6" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2">
          {animate ? <><animate attributeName="x" dur="2.8s" values="68;45;45;68" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="y" dur="2.8s" values="31;17;17;31" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.8s" values="80;126;126;80" keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="height" dur="2.8s" values="43;70;70;43" keyTimes="0;.4;.74;1" repeatCount="indefinite" /></> : null}
        </rect>
        <path d="M38 34V13h21M178 34V13h-21M38 70v21h21M178 70v21h-21" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
      </g>
    );
  }
  if (kind === "settings") {
    return (
      <>
        {[31, 52, 73].map((y) => <path key={y} d={`M52 ${y}h112`} stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="3" />)}
        {[84, 137, 104].map((x, index) => (
          <circle key={x} cx={animate ? (index === 0 ? 84 : index === 1 ? 137 : 104) : x + (index === 1 ? -18 : 18)} cy={31 + index * 21} r="7" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2">
            {animate ? <animate attributeName="cx" dur="2.7s" values={`${x};${x + (index === 1 ? -28 : 28)};${x + (index === 1 ? -28 : 28)};${x}`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </circle>
        ))}
      </>
    );
  }
  if (kind === "ai") {
    return (
      <>
        <path d="M43 71c17-36 32 8 49-30 15 34 30-5 47 22" fill="none" stroke={COLOR.fg3} strokeDasharray="4 4" strokeWidth="2" />
        <path d="M43 71c19-28 38-31 56-8 17 21 34 11 51-14" fill="none" stroke={COLOR.accent} strokeDasharray="152" strokeDashoffset={animate ? "152" : "0"} strokeLinecap="round" strokeWidth="4">
          {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="152;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
        </path>
        <path d="m168 26 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill={COLOR.cool} />
        <path d="m145 17 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill={COLOR.accent} />
      </>
    );
  }
  if (kind === "assets") {
    return (
      <>
        {[0, 1, 2].map((index) => <rect key={index} x={38 + index * 38} y="25" width="29" height="29" rx="5" fill={index === 1 ? COLOR.accentSoft : COLOR.raised} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} />)}
        <rect x="151" y="42" width="31" height="31" rx="6" fill={COLOR.canvas} stroke={COLOR.fg2} />
        <path d="m157 66 8-9 5 5 6-7" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="2" />
        <g transform={animate ? undefined : "translate(76 37)"}>
          <rect x="-10" y="-10" width="20" height="20" rx="4" fill={COLOR.accent} />
          {animate ? <animateMotion dur="2.8s" path="M76 37C104 18 137 30 166 57" keyPoints="0;1;1" keyTimes="0;.62;1" repeatCount="indefinite" /> : null}
        </g>
      </>
    );
  }
  const isPublish = kind === "publish";
  const isSave = kind === "save";
  const isExport = kind === "export";
  return (
    <>
      <path d="M57 18h65l25 25v43H57Z" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
      <path d="M122 18v25h25M72 56h57M72 67h45" fill="none" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="2" />
      {kind === "project" ? <path d="M42 37h45l8 9h52v39H42Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="2" /> : null}
      <g transform={animate ? undefined : `translate(${isPublish ? 164 : 160} ${isSave ? 70 : 58})`}>
        {isSave ? <path d="M-13-12h26v24h-26Zm5 0v9H7v-9M-7 5H7" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="2" /> : isPublish ? <path d="M0-17 13 8 3 5 0 17-3 5-13 8Z" fill={COLOR.accent} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" /> : kind === "project" ? <path d="M-14-9h11l4 4h15V12h-30Zm5 9h18M0-5V9" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /> : <path d="M0-15v25m0 0-9-9m9 9 9-9M-13 15h26" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />}
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values={`${isExport ? 145 : 160} 48;${isPublish ? 164 : 160} ${isSave ? 70 : 58};${isPublish ? 164 : 160} ${isSave ? 70 : 58};${isExport ? 145 : 160} 48`} keyTimes="0;.42;.75;1" repeatCount="indefinite" /> : null}
      </g>
      {isPublish ? <circle cx="164" cy="79" r="12" fill="none" stroke={COLOR.cool} strokeDasharray="3 3" /> : null}
    </>
  );
}

export function FileWorkflowPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <path d="M49 20h68l24 24v42H49Z" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
      <path d="M117 20v24h24M64 57h61M64 68h45" fill="none" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="2" />
      <path d="M156 31v42m0-42-8 9m8-9 8 9M177 73V31m0 42-8-9m8 9 8-9" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <circle cx={animate ? "156" : "177"} cy="84" r="6" fill={COLOR.accent}>
        {animate ? <animate attributeName="cx" dur="2.6s" values="156;177;177;156" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </circle>
    </>
  );
}

export function EditWorkflowPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <g data-preview-operation="edit-workflow">
      <rect x="28" y="18" width="112" height="70" rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="1.8" />
      <rect x="43" y="31" width="42" height="34" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeDasharray="4 3" strokeWidth="1.8" />
      <circle cx="57" cy="44" r="6" fill={COLOR.accent} />
      <path d="m47 59 11-10 8 7 7-6 8 9" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M48 74h32" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
      <g transform={animate ? undefined : "translate(43 9)"}>
        <rect x="52" y="31" width="42" height="34" rx="5" fill={COLOR.raised} stroke={COLOR.cool} strokeWidth="2" />
        <circle cx="66" cy="44" r="6" fill={COLOR.cool} />
        <path d="m56 59 11-10 8 7 7-6 8 9" fill="none" stroke={COLOR.fg} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="3s" values="-9 0;43 9;43 9;-9 0" keyTimes="0;.43;.75;1" repeatCount="indefinite" /> : null}
      </g>
      <g transform="translate(151 22)">
        {[0, 1, 2].map((index) => (
          <rect key={index} x={index * 6} y={index * 18} width="36" height="25" rx="4" fill={index === 0 ? COLOR.accentSoft : COLOR.raised} stroke={index === 0 ? COLOR.accent : COLOR.lineStrong} strokeWidth="1.6" />
        ))}
        <path d="M18 52V5m0 0-7 8m7-8 7 8" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4">
          {animate ? <animate attributeName="stroke-dasharray" dur="1.5s" values="2 4;14 2;2 4" repeatCount="indefinite" /> : null}
        </path>
      </g>
      <path d="M34 20v-8h21v8M39 12V7h11v5" fill={COLOR.raised} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.5" />
    </g>
  );
}

export function InsertContentPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="33" y="18" width="112" height="70" rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
      <path d="M46 34h28M46 44h20" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" />
      <rect x="83" y="31" width="48" height="39" rx="5" fill={COLOR.raised} stroke={COLOR.cool} />
      <path d="m87 65 12-13 9 8 7-6 12 11" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="2" />
      <path d="M50 62h23v15H50Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="1.8" />
      <g transform={animate ? undefined : "translate(-24 22)"}>
        <rect x="157" y="17" width="28" height="28" rx="5" fill={COLOR.accent} />
        <path d="M171 24v14M164 31h14" stroke={COLOR.canvas} strokeLinecap="round" strokeWidth="2.5" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values="0 0;-24 22;-24 22;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

export function CommentInboxPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <g key={index} transform={`translate(${46 + index * 18} ${17 + index * 17})`} opacity={index === 2 ? "1" : ".55"}>
          <path d="M0 0h91v42H24L13 52V42H0Z" fill={index === 2 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 2 ? COLOR.accent : COLOR.lineStrong} strokeLinejoin="round" strokeWidth="1.8" />
          <circle cx="16" cy="15" r="5" fill={index === 2 ? COLOR.accent : COLOR.fg3} />
          <path d="M28 13h46M28 24h34" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
        </g>
      ))}
      <circle cx="169" cy="30" r="13" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2">
        {animate ? <animate attributeName="r" dur="1.5s" values="10;14;10" repeatCount="indefinite" /> : null}
      </circle>
      <path d="M169 24v12M163 30h12" stroke={COLOR.canvas} strokeLinecap="round" strokeWidth="2" />
    </>
  );
}

export function DrawWorkflowPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <g data-preview-operation="draw-workflow">
      <rect x="31" y="14" width="32" height="76" rx="7" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.6" />
      {[24, 42, 60, 78].map((y, index) => (
        <g key={y}>
          <rect x="36" y={y - 7} width="22" height="14" rx="4" fill={index === 0 ? COLOR.accentSoft : COLOR.raised} stroke={index === 0 ? COLOR.accent : COLOR.line} />
          {index === 0 ? <path d={`M41 ${y + 2}c4-8 8 6 12-3`} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" /> : null}
          {index === 1 ? <path d={`m42 ${y - 3} 11 8`} stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" /> : null}
          {index === 2 ? <path d={`M47 ${y - 4}c5 6 5 9 0 11-5-2-5-5 0-11Z`} fill={COLOR.cool} /> : null}
          {index === 3 ? <rect x="42" y={y - 4} width="11" height="8" rx="1" fill="none" stroke={COLOR.fg2} strokeWidth="1.5" /> : null}
        </g>
      ))}
      <rect x="70" y="16" width="116" height="72" rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="1.8" />
      <path d="M82 68c17-34 32 16 48-13 12-22 25-17 40-7" fill="none" stroke={COLOR.accent} strokeDasharray="119" strokeDashoffset={animate ? "119" : "0"} strokeLinecap="round" strokeWidth="4">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="119;0;0" keyTimes="0;.65;1" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="97" cy="37" r="11" fill={COLOR.cool} opacity=".58" />
      <rect x="137" y="27" width="31" height="21" rx="3" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="1.8" />
      <rect x="35" y={animate ? "17" : "71"} width="24" height="16" rx="5" fill="none" stroke={COLOR.accent} strokeWidth="2.2">
        {animate ? <animate attributeName="y" dur="3s" values="17;35;53;71;71;17" keyTimes="0;.18;.36;.54;.76;1" repeatCount="indefinite" /> : null}
      </rect>
    </g>
  );
}

export function ViewWorkflowPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <g data-preview-operation="view-workflow">
      <rect x="25" y="17" width="23" height="70" rx="5" fill={COLOR.raised} stroke={COLOR.lineStrong} />
      <path d="M31 29h11M31 39h11M31 49h11" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
      <rect x="168" y="17" width="23" height="70" rx="5" fill={COLOR.raised} stroke={COLOR.lineStrong} />
      <path d="M174 29h11M174 39h11M174 49h11" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
      <g transform="translate(108 52)">
        <rect x="-53" y="-32" width="106" height="64" rx="6" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
        <g transform={animate ? undefined : "scale(-1 1)"}>
          <circle cx="-25" cy="-12" r="8" fill={COLOR.accent} />
          <path d="m-43 21 25-24L0 13l13-12 31 20" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          {animate ? <animateTransform attributeName="transform" type="scale" dur="3.2s" values="1 1;1 1;-1 1;-1 1;1 1" keyTimes="0;.3;.48;.75;1" repeatCount="indefinite" /> : null}
        </g>
        {animate ? <animateTransform attributeName="transform" additive="sum" type="scale" dur="3.2s" values=".86;.98;.98;.86" keyTimes="0;.34;.75;1" repeatCount="indefinite" /> : null}
      </g>
      <path d="M82 92h52" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="5" />
      <circle cx={animate ? "82" : "125"} cy="92" r="6" fill={COLOR.accent}>
        {animate ? <animate attributeName="cx" dur="3.2s" values="82;134;134;82" keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
      </circle>
    </g>
  );
}

export function PanelLayoutPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const add = previewVariantMatches(variant, "add");
  const splitDiagonal = previewVariantMatches(variant, "split-diagonal");
  const straighten = previewVariantMatches(variant, "straighten");
  const diagonal = splitDiagonal || previewVariantMatches(variant, "diagonalize");
  return (
    <>
      <rect x="34" y="13" width="148" height="78" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      {add ? (
        <>
          <rect x="45" y="24" width="72" height="56" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
          <g transform={animate ? undefined : "translate(-27 27)"}>
            <rect x="140" y="18" width="38" height="38" rx="7" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="2" />
            <path d="M159 28v18m-9-9h18" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2.5" />
            {animate ? <animateTransform attributeName="transform" type="translate" dur="2.6s" values="0 0;-27 27;-27 27;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        </>
      ) : splitDiagonal ? (
        <>
          <path d="M44 23h128v58H44Z" fill={COLOR.accentSoft} stroke={COLOR.fg2} strokeWidth="2" />
          <path d="M44 76 172 28" stroke={COLOR.accent} strokeDasharray={animate ? "142" : undefined} strokeDashoffset={animate ? "142" : undefined} strokeWidth="3">
            {animate ? <animate attributeName="stroke-dashoffset" dur="2.5s" values="142;0;0" keyTimes="0;.68;1" repeatCount="indefinite" /> : null}
          </path>
          <path d="M50 69 91 31M126 71l38-36" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="2" opacity=".45" />
        </>
      ) : (
        <>
          <path d={diagonal && !straighten ? "M44 23h72l-20 58H44ZM121 23h51v58H101Z" : "M44 23h60v58H44ZM109 23h63v58h-63Z"} fill={COLOR.accentSoft} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
          <path d={straighten ? "M104 23v58" : "M116 23 96 81"} stroke={COLOR.accent} strokeWidth="3">
            {animate ? <animate attributeName="stroke-dasharray" dur="1.5s" values="2 5;18 2;2 5" repeatCount="indefinite" /> : null}
          </path>
          <path d={straighten ? "M85 18h38m0 0-7-6m7 6-7 6" : "M85 87h45m0 0-8-6m8 6-8 6"} fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </>
      )}
    </>
  );
}

export function CharacterBuilderPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="34" y="13" width="105" height="79" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      <g transform="translate(86 14)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="0" cy="17" r="12" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
        <path d="M-11 15c5-13 17-13 23-2M-14 47c2-12 8-17 14-17s12 5 14 17v18H-14ZM-13 44l-18 14M13 44l18 14M-8 65l-8 19M8 65l8 19" stroke={COLOR.fg2} strokeWidth="3" />
        <path d="M-7 18h3m8 0h3M-4 24c3 2 5 2 8 0" stroke={COLOR.fg} strokeWidth="1.5" />
        <g transform={animate ? undefined : "rotate(12 13 44)"}>
          <path d="M13 44 31 58" stroke={COLOR.accent} strokeWidth="3" />
          {animate ? <animateTransform attributeName="transform" type="rotate" dur="2.4s" values="-10 13 44;16 13 44;16 13 44;-10 13 44" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </g>
      </g>
      <g transform="translate(150 21)">
        {[0, 1, 2].map((index) => <rect key={index} y={index * 23} width="35" height="17" rx="5" fill={index === 1 ? COLOR.accentSoft : COLOR.raised} stroke={index === 1 ? COLOR.accent : COLOR.lineStrong} />)}
        <circle cx={8} cy={8} r="4" fill={COLOR.accent} />
        <path d="M16 8h12M7 31h21M7 54h21" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
      </g>
    </>
  );
}

export function MannequinPoserPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="34" y="13" width="105" height="79" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      {/* 목각 데생 인형 — 구체 관절(어깨/팔꿈치/골반/무릎)을 점으로 드러낸 스틱 피겨. */}
      <g transform="translate(86 16)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="0" cy="12" r="9" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="2.5" />
        <path d="M0 21v22M0 43l-10 22M0 43l10 22M-10 65l-2 12M10 65l2 12" stroke={COLOR.fg2} strokeWidth="3.5" />
        <path d="M0 26l-13 8M-13 34l-7 12" stroke={COLOR.fg2} strokeWidth="3.5" />
        <g transform={animate ? undefined : "rotate(-24 0 26)"}>
          <path d="M0 26l14 6M14 32l11-9" stroke={COLOR.accent} strokeWidth="3.5" />
          <circle cx="25" cy="23" r="3" fill={COLOR.accent} />
          {animate ? <animateTransform attributeName="transform" type="rotate" dur="2.6s" values="0 0 26;-30 0 26;-30 0 26;0 0 26" keyTimes="0;.4;.7;1" repeatCount="indefinite" /> : null}
        </g>
        {[[0, 21], [0, 43], [-13, 34], [-10, 65], [10, 65]].map(([jx, jy]) => (
          <circle key={`${jx}:${jy}`} cx={jx} cy={jy} r="2.6" fill={COLOR.canvas} stroke={COLOR.fg} strokeWidth="1.4" />
        ))}
      </g>
      {/* 체형 슬라이더 열 — 프리셋 목록(3D 캐릭터)과 구별되는 파라메트릭 조절 UI. */}
      <g transform="translate(148 22)">
        {[0, 1, 2].map((index) => (
          <g key={index} transform={`translate(0 ${index * 21})`}>
            <path d="M0 6h40" stroke={COLOR.lineStrong} strokeLinecap="round" strokeWidth="3" />
            <circle cx={[26, 12, 33][index]} cy="6" r="5" fill={index === 0 ? COLOR.accent : COLOR.raised} stroke={index === 0 ? COLOR.accent : COLOR.fg3} strokeWidth="1.5" />
          </g>
        ))}
        <path d="M4 66h32" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="2" />
      </g>
    </>
  );
}

export function BackgroundLibraryPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="29" y="14" width="83" height="77" rx="7" fill={COLOR.raised} stroke={COLOR.lineStrong} />
      {[0, 1, 2].map((index) => (
        <g key={index} transform={`translate(${37 + (index % 2) * 35} ${22 + Math.floor(index / 2) * 32})`}>
          <rect width="29" height="25" rx="4" fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.fg3} />
          <path d="M3 21 10 13l6 5 4-4 6 7" fill="none" stroke={index === 1 ? COLOR.accent : COLOR.cool} strokeLinecap="round" strokeWidth="1.7" />
        </g>
      ))}
      <rect x="120" y="18" width="67" height="69" rx="7" fill={COLOR.canvas} stroke={COLOR.fg2} strokeWidth="2" />
      <path d="m126 78 18-22 13 12 9-10 15 20" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <g transform={animate ? undefined : "translate(76 38)"}>
        <rect x="-12" y="-10" width="24" height="20" rx="4" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2" />
        {animate ? <animateMotion dur="2.8s" path="M77 38C104 28 126 39 150 53" keyPoints="0;1;1" keyTimes="0;.66;1" repeatCount="indefinite" /> : null}
      </g>
    </>
  );
}

export function StyleLibraryPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="34" y="16" width="73" height="72" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      {[COLOR.accent, COLOR.cool, "var(--color-good, oklch(0.80 0.15 150))", COLOR.fg2].map((fill, index) => (
        <circle key={fill} cx={53 + (index % 2) * 27} cy={35 + Math.floor(index / 2) * 27} r={index === 0 ? "10" : "8"} fill={fill} opacity={index === 0 ? "1" : ".72"}>
          {animate && index === 0 ? <animate attributeName="r" dur="1.6s" values="8;11;8" repeatCount="indefinite" /> : null}
        </circle>
      ))}
      <rect x="117" y="16" width="66" height="72" rx="8" fill={COLOR.raised} stroke={COLOR.fg2} />
      <text x="128" y="41" fill={COLOR.fg} fontSize="18" fontWeight="800">Aa</text>
      <path d="M128 54h42M128 64h29" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="3" />
      <path d="M123 78c14-17 29 9 47-10" fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "62" : undefined} strokeDashoffset={animate ? "62" : undefined} strokeLinecap="round" strokeWidth="4">
        {animate ? <animate attributeName="stroke-dashoffset" dur="2.5s" values="62;0;0" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
      </path>
    </>
  );
}

export function StoryboardGridPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const x = 41 + (index % 3) * 47;
        const y = 18 + Math.floor(index / 3) * 39;
        return (
          <g key={index} transform={`translate(${x} ${y})`}>
            <rect width="39" height="31" rx="4" fill={index === 4 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 4 ? COLOR.accent : COLOR.lineStrong} strokeWidth={index === 4 ? "2" : "1.3"} />
            <circle cx="11" cy="10" r="4" fill={index % 2 ? COLOR.cool : COLOR.accent} opacity=".72" />
            <path d="M5 25 14 17l7 5 6-6 7 9" fill="none" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="1.4" />
          </g>
        );
      })}
      <rect x={animate ? "41" : "88"} y={animate ? "18" : "57"} width="39" height="31" rx="4" fill="none" stroke={COLOR.accent} strokeWidth="2.5">
        {animate ? <><animate attributeName="x" dur="3s" values="41;88;135;88;88;41" keyTimes="0;.18;.36;.54;.78;1" repeatCount="indefinite" /><animate attributeName="y" dur="3s" values="18;18;18;57;57;18" keyTimes="0;.18;.36;.54;.78;1" repeatCount="indefinite" /></> : null}
      </rect>
    </>
  );
}

export function ReviewWorkflowPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="35" y="15" width="118" height="76" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      <path d="M45 76 68 49l18 16 13-13 43 24" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <circle cx="73" cy="40" r="8" fill={COLOR.accent} />
      <g transform={animate ? undefined : "translate(-8 14)"}>
        <path d="M165 18c10 0 18 7 18 16 0 8-7 14-14 15l-7 9v-10c-8-2-13-7-13-14 0-9 7-16 16-16Z" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="2" />
        <path d="m157 34 6 6 11-13" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="5 -4;-8 14;-8 14;5 -4" keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
      </g>
      <rect x="45" y="21" width="44" height="14" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} />
      <path d="M51 28h31" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="2" />
    </>
  );
}

export function TeamCollaborationPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="38" y="17" width="140" height="72" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      <path d="M50 75 75 47l18 17 15-15 26 26" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" opacity=".62" />
      {[
        { x: 64, y: 36, color: COLOR.accent, path: "M64 36C91 23 113 33 132 53" },
        { x: 145, y: 69, color: COLOR.cool, path: "M145 69C127 80 103 74 92 57" },
      ].map((cursor, index) => (
        <g key={cursor.color} transform={animate ? undefined : `translate(${index ? 92 : 132} ${index ? 57 : 53})`}>
          <path d="m0 0 7 18 4-7 7 6 4-4-7-6 7-4Z" fill={cursor.color} stroke={COLOR.canvas} strokeLinejoin="round" strokeWidth="2" />
          {animate ? <animateMotion dur={index ? "3.1s" : "2.8s"} path={cursor.path} keyPoints="0;1;1" keyTimes="0;.7;1" repeatCount="indefinite" /> : null}
        </g>
      ))}
      {[COLOR.accent, COLOR.cool, COLOR.fg2].map((fill, index) => <circle key={fill} cx={151 + index * 13} cy="23" r="7" fill={fill} stroke={COLOR.canvas} strokeWidth="2" />)}
      <path d="M49 27h37" stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="3" />
    </>
  );
}

export function ContinuityCheckPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      {[42, 119].map((x, index) => (
        <g key={x} transform={`translate(${x} 19)`}>
          <rect width="59" height="68" rx="7" fill={COLOR.canvas} stroke={index === 0 ? COLOR.lineStrong : COLOR.accent} strokeWidth="2" />
          <circle cx="29" cy="21" r="10" fill={index === 0 ? COLOR.fg3 : COLOR.accentSoft} stroke={index === 0 ? COLOR.fg2 : COLOR.accent} />
          <path d="M15 56c3-15 9-22 14-22s12 7 15 22" fill={index === 0 ? COLOR.cool : COLOR.accentSoft} stroke={index === 0 ? COLOR.cool : COLOR.accent} strokeWidth="2" />
          <circle cx={index === 0 ? "17" : "41"} cy="48" r="4" fill={index === 0 ? COLOR.accent : COLOR.cool} />
        </g>
      ))}
      <path d="M102 47h16m-8-7 8 7-8 7" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <circle cx="108" cy="78" r="11" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="2">
        {animate ? <animate attributeName="r" dur="1.5s" values="8;12;8" repeatCount="indefinite" /> : null}
      </circle>
      <path d="m102 78 4 4 8-10" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </>
  );
}

export function VerticalPreviewPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="73" y="8" width="70" height="90" rx="13" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="2" />
      <rect x="80" y="17" width="56" height="72" rx="5" fill={COLOR.canvas} stroke={COLOR.lineStrong} />
      <g transform={animate ? undefined : "translate(0 -20)"}>
        {[0, 1, 2].map((index) => (
          <g key={index} transform={`translate(85 ${24 + index * 25})`}>
            <rect width="46" height="20" rx="4" fill={index === 1 ? COLOR.accentSoft : COLOR.canvas} stroke={index === 1 ? COLOR.accent : COLOR.fg3} />
            <path d="M4 16 13 8l7 6 6-7 16 9" fill="none" stroke={index === 1 ? COLOR.accent : COLOR.cool} strokeLinecap="round" strokeWidth="1.6" />
          </g>
        ))}
        {animate ? <animateTransform attributeName="transform" type="translate" dur="3s" values="0 10;0 -20;0 -20;0 10" keyTimes="0;.55;.76;1" repeatCount="indefinite" /> : null}
      </g>
      <path d="M154 29v48m0 0-7-8m7 8 7-8" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <circle cx="108" cy="93" r="2.5" fill={COLOR.accent} />
    </>
  );
}

export function WorkspaceFocusPreview({
  animate,
  variant,
}: {
  animate: boolean;
  variant: string;
}): ReactElement {
  const restore = previewVariantMatches(variant, "restore");
  const panelStartOpacity = restore ? ".12" : ".8";
  const panelEndOpacity = restore ? ".8" : ".12";
  const canvasStartX = restore ? 39 : 64;
  const canvasEndX = restore ? 64 : 39;
  const canvasStartWidth = restore ? 138 : 88;
  const canvasEndWidth = restore ? 88 : 138;
  return (
    <g data-preview-operation={restore ? "restore-panels" : "focus-canvas"}>
      <rect x="27" y="13" width="162" height="79" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
      <rect x="34" y="20" width="23" height="65" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? panelStartOpacity : panelEndOpacity}>
        {animate ? <animate attributeName="opacity" dur="2.7s" values={`${panelStartOpacity};${panelEndOpacity};${panelEndOpacity};${panelStartOpacity}`} keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
      </rect>
      <rect x="159" y="20" width="23" height="65" rx="4" fill={COLOR.raised} stroke={COLOR.fg3} opacity={animate ? panelStartOpacity : panelEndOpacity}>
        {animate ? <animate attributeName="opacity" dur="2.7s" values={`${panelStartOpacity};${panelEndOpacity};${panelEndOpacity};${panelStartOpacity}`} keyTimes="0;.4;.74;1" repeatCount="indefinite" /> : null}
      </rect>
      <rect x={animate ? canvasStartX : canvasEndX} y="20" width={animate ? canvasStartWidth : canvasEndWidth} height="65" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2">
        {animate ? <><animate attributeName="x" dur="2.7s" values={`${canvasStartX};${canvasEndX};${canvasEndX};${canvasStartX}`} keyTimes="0;.4;.74;1" repeatCount="indefinite" /><animate attributeName="width" dur="2.7s" values={`${canvasStartWidth};${canvasEndWidth};${canvasEndWidth};${canvasStartWidth}`} keyTimes="0;.4;.74;1" repeatCount="indefinite" /></> : null}
      </rect>
      <path d="M76 70 94 49l14 12 11-10 22 19" fill="none" stroke={COLOR.cool} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <path d="M76 31h64" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" />
      <path d={restore ? "M69 53H49m20 0-7-7m7 7-7 7M147 53h20m-20 0 7-7m-7 7 7 7" : "M49 53h20m-20 0 7-7m-7 7 7 7M167 53h-20m20 0-7-7m7 7-7 7"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </g>
  );
}

export function SettingsSlidersPreview({
  animate,
  exportMode = false,
  variant = "",
}: {
  animate: boolean;
  exportMode?: boolean;
  variant?: string;
}): ReactElement {
  const expand = previewVariantMatches(variant, "expand");
  const collapse = previewVariantMatches(variant, "collapse");
  if (expand || collapse) {
    const startHeight = collapse ? 68 : 28;
    const endHeight = collapse ? 28 : 68;
    const startY = collapse ? 18 : 38;
    const endY = collapse ? 38 : 18;
    const detailStart = collapse ? ".9" : ".12";
    const detailEnd = collapse ? ".12" : ".9";
    return (
      <g data-preview-operation={collapse ? "collapse-draw-settings" : "expand-draw-settings"}>
        <rect x="40" y="18" width="136" height="68" rx="8" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="2" />
        <rect x="48" y={animate ? startY : endY} width="120" height={animate ? startHeight : endHeight} rx="6" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="2">
          {animate ? <><animate attributeName="y" dur="2.7s" values={`${startY};${endY};${endY};${startY}`} keyTimes="0;.42;.74;1" repeatCount="indefinite" /><animate attributeName="height" dur="2.7s" values={`${startHeight};${endHeight};${endHeight};${startHeight}`} keyTimes="0;.42;.74;1" repeatCount="indefinite" /></> : null}
        </rect>
        <path d="M58 47h72M58 60h84M58 73h58" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="3" opacity={animate ? detailStart : detailEnd}>
          {animate ? <animate attributeName="opacity" dur="2.7s" values={`${detailStart};${detailEnd};${detailEnd};${detailStart}`} keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
        </path>
        <path d={collapse ? "m145 34 8-8 8 8" : "m145 26 8 8 8-8"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      </g>
    );
  }
  const rows = exportMode ? [30, 50, 70] : [27, 47, 67, 87];
  return (
    <>
      {exportMode ? <path d="M39 19h45l15 15v50H39Z" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="2" /> : null}
      {rows.map((y, index) => {
        const start = exportMode ? 112 : 42;
        const end = 184;
        const baseX = start + [24, 54, 37, 74][index];
        const shiftedX = start + [61, 28, 68, 34][index];
        return (
          <g key={y}>
            <path d={`M${start} ${y}h${end - start}`} stroke={COLOR.fg3} strokeLinecap="round" strokeWidth="3" />
            <circle cx={animate ? baseX : shiftedX} cy={y} r="6" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="2">
              {animate ? <animate attributeName="cx" dur={`${2.4 + index * .18}s`} values={`${baseX};${shiftedX};${shiftedX};${baseX}`} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
            </circle>
          </g>
        );
      })}
      {exportMode ? <path d="M60 46v24m0 0-8-8m8 8 8-8M49 76h22" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" /> : null}
    </>
  );
}
