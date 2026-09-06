import { COLOR, previewVariantMatches } from "./studio-tool-hint-preview-shared";

import type { ReactElement } from "react";

/**
 * 3D scene previews (object/pose/camera/lighting stages, object transform and
 * snap actions, camera actions) plus their shared cube and stage shapes.
 *
 * Moved verbatim out of `StudioToolHintPreview.tsx`; each preview stays a pure
 * component whose props are its only inputs.
 */
export function Object3dPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g transform="translate(108 52)" data-preview-motion={animate ? "object-3d" : undefined}>
        <path d="m0-28 31 15L0 2l-31-15Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="1.6" />
        <path d="M-31-13 0 2v31l-31-15Z" fill={COLOR.canvas} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.6" />
        <path d="M31-13 0 2v31l31-15Z" fill={COLOR.raised} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.6" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            additive="sum"
            type="rotate"
            dur="3.2s"
            values="0;12;-8;0"
            keyTimes="0;.38;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <g transform="translate(108 54)" fill="none" strokeLinecap="round" strokeWidth="2.5">
        <path d="M0 0v-40" stroke={COLOR.cool} />
        <path d="m0-40-4 8h8Z" fill={COLOR.cool} stroke="none" />
        <path d="M0 0h46" stroke={COLOR.accent} />
        <path d="m46 0-8-4v8Z" fill={COLOR.accent} stroke="none" />
        <path d="M0 0-28 26" stroke={COLOR.fg2} />
      </g>
      <ellipse cx="108" cy="54" rx="49" ry="20" fill="none" stroke={COLOR.lineStrong} strokeDasharray="4 4" />
      <circle cx={animate ? "157" : "143"} cy="54" r="4" fill={COLOR.accent}>
        {animate ? <animate attributeName="cx" dur="3.2s" values="157;143;153;157" keyTimes="0;.38;.72;1" repeatCount="indefinite" /> : null}
      </circle>
    </>
  );
}

export function Pose3dPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g transform="translate(108 18)" fill="none" stroke={COLOR.fg2} strokeLinecap="round" strokeWidth="4">
        <circle cx="0" cy="10" r="9" fill={COLOR.raised} stroke={COLOR.accent} strokeWidth="1.8" />
        <path d="M0 21v34M0 55-17 78M0 55l20 22" />
        <g transform={animate ? undefined : "rotate(-28 0 29)"} data-preview-motion={animate ? "pose-3d" : undefined}>
          <path d="M0 29 24 43 39 25" />
          <circle cx="24" cy="43" r="4" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="1.5" />
          <circle cx="39" cy="25" r="4" fill={COLOR.fg} stroke={COLOR.canvas} strokeWidth="1.5" />
          {animate ? (
            <animateTransform
              attributeName="transform"
              type="rotate"
              dur="2.8s"
              values="8 0 29;-34 0 29;-34 0 29;8 0 29"
              keyTimes="0;.38;.7;1"
              repeatCount="indefinite"
            />
          ) : null}
        </g>
        <path d="M0 29-22 45-38 34" />
      </g>
      <path d="M57 86c13 8 27 11 42 10M117 96c17-1 32-5 44-13" fill="none" stroke={COLOR.lineStrong} strokeDasharray="3 4" strokeWidth="1.2" />
      {[86, 108, 132].map((x, index) => (
        <circle key={x} cx={x} cy={index === 1 ? 47 : 73} r="3" fill={index === 1 ? COLOR.accent : COLOR.cool} opacity=".72" />
      ))}
    </>
  );
}

export function Camera3dPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <rect x="70" y="21" width="114" height="67" rx="6" fill={COLOR.canvas} stroke={COLOR.lineStrong} strokeWidth="1.4" />
      <path d="M91 72 117 43l18 17 12-11 20 23Z" fill={COLOR.accentSoft} stroke={COLOR.fg2} strokeLinejoin="round" strokeWidth="1.5" />
      <circle cx="151" cy="38" r="8" fill={COLOR.accent} opacity=".75" />
      <path d="M91 32h14M91 32v14M163 32h-14M163 32v14M91 77h14M91 77V63M163 77h-14M163 77V63" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />
      <g transform={animate ? undefined : "translate(28 47)"} data-preview-motion={animate ? "camera-3d" : undefined}>
        <rect x="0" y="0" width="30" height="23" rx="5" fill={COLOR.raised} stroke={COLOR.fg} strokeWidth="1.5" />
        <path d="m30 7 14-7v23l-14-7Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="1.5" />
        <circle cx="15" cy="11.5" r="5" fill={COLOR.canvas} stroke={COLOR.cool} strokeWidth="1.5" />
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="3s"
            values="22 52;34 42;34 42;22 52"
            keyTimes="0;.42;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <path d="M64 48 77 39M64 65l13 9" fill="none" stroke={COLOR.lineStrong} strokeDasharray="3 3" />
    </>
  );
}

export function Lighting3dPreview({ animate }: { animate: boolean }): ReactElement {
  return (
    <>
      <g transform={animate ? undefined : "translate(57 28)"} data-preview-motion={animate ? "lighting-3d" : undefined}>
        <circle cx="0" cy="0" r="10" fill={COLOR.accent} />
        {Array.from({ length: 8 }, (_, index) => {
          const angle = (index * Math.PI) / 4;
          const x1 = Math.cos(angle) * 15;
          const y1 = Math.sin(angle) * 15;
          const x2 = Math.cos(angle) * 22;
          const y2 = Math.sin(angle) * 22;
          return <path key={index} d={`M${x1} ${y1} ${x2} ${y2}`} stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" />;
        })}
        {animate ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="3.2s"
            values="57 28;76 21;76 21;57 28"
            keyTimes="0;.42;.72;1"
            repeatCount="indefinite"
          />
        ) : null}
      </g>
      <path d="M72 39 113 67M83 31l41 30M93 25l42 28" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="2" opacity={animate ? ".35" : ".6"}>
        {animate ? <animate attributeName="opacity" dur="1.6s" values=".25;.7;.25" repeatCount="indefinite" /> : null}
      </path>
      <circle cx="141" cy="58" r="25" fill={COLOR.raised} stroke={COLOR.fg2} strokeWidth="1.5" />
      <path d="M123 41c18 3 31 17 36 36-19-2-34-16-36-36Z" fill={COLOR.accentSoft} />
      <ellipse cx="145" cy="89" rx={animate ? "25" : "19"} ry="5" fill={COLOR.canvas} opacity=".75">
        {animate ? <animate attributeName="rx" dur="3.2s" values="25;17;17;25" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </ellipse>
    </>
  );
}

function ObjectCubeShape({ ghost = false }: { ghost?: boolean }): ReactElement {
  return (
    <g
      data-preview-object={ghost ? "ghost" : "live"}
      opacity={ghost ? ".24" : "1"}
      strokeDasharray={ghost ? "4 3" : undefined}
    >
      <path d="m108 25 35 18-35 18-35-18Z" fill={ghost ? "none" : COLOR.accentSoft} stroke={ghost ? COLOR.fg3 : COLOR.accent} strokeLinejoin="round" strokeWidth="2" />
      <path d="m73 43 35 18 35-18v34l-35 18-35-18Z" fill={ghost ? "none" : COLOR.canvas} stroke={ghost ? COLOR.fg3 : COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
      <path d="M108 61v34" fill="none" stroke={ghost ? COLOR.fg3 : COLOR.lineStrong} strokeWidth="1.4" />
    </g>
  );
}

export function ObjectTransformActionPreview({
  animate,
  action,
  variant,
}: {
  animate: boolean;
  action: "translate" | "rotate" | "scale" | "ground";
  variant: string;
}): ReactElement {
  const originGround = previewVariantMatches(variant, "origin-ground");
  if (originGround) {
    return (
      <g data-preview-operation="origin-ground">
        <ObjectCubeShape />
        <path
          d="m43 91 65-18 65 18-65 13Z"
          data-preview-ground-plane="live"
          fill={COLOR.accentSoft}
          fillOpacity={animate ? ".12" : ".58"}
          stroke={COLOR.accent}
          strokeLinejoin="round"
          strokeWidth="1.5"
        >
          {animate ? (
            <animate
              attributeName="fill-opacity"
              dur="2.7s"
              values=".12;.12;.58;.58;.12"
              keyTimes="0;.36;.5;.78;1"
              repeatCount="indefinite"
            />
          ) : null}
        </path>
        <path d="M43 91h130" stroke={COLOR.accent} strokeDasharray="5 4" strokeWidth="2" />
        <g data-preview-object-origin="ghost" opacity=".42">
          <path d="M108 48v26M95 61h26M99 70l18-18" stroke={COLOR.fg3} strokeDasharray="3 2" strokeLinecap="round" strokeWidth="1.5" />
          <circle cx="108" cy="61" r="5" fill={COLOR.canvas} stroke={COLOR.fg3} strokeWidth="1.5" />
        </g>
        <path
          d="M108 66v20"
          data-preview-origin-guide="ground"
          stroke={COLOR.cool}
          strokeDasharray="3 3"
          strokeWidth="1.5"
        >
          {animate ? (
            <animate attributeName="stroke-dashoffset" dur=".7s" values="0;-12" repeatCount="indefinite" />
          ) : null}
        </path>
        <g transform={animate ? undefined : "translate(0 30)"} data-preview-object-origin="live">
          <path d="M108 48v26M95 61h26M99 70l18-18" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="2" />
          <path d="m108 48-4 7h8ZM121 61l-7-4v8ZM117 52l-8 2 6 5Z" fill={COLOR.cool} />
          <circle cx="108" cy="61" r="5" fill={COLOR.canvas} stroke={COLOR.cool} strokeWidth="2" />
          {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="0 0;0 30;0 30;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
        </g>
      </g>
    );
  }

  const liveObject = action === "translate" ? (
    <g transform={animate ? undefined : "translate(18 -9)"} data-preview-object-transform="translate">
      <ObjectCubeShape />
      {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="0 0;18 -9;18 -9;0 0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
    </g>
  ) : action === "rotate" ? (
    <g transform="translate(108 60)" data-preview-object-transform="rotate">
      <g transform={animate ? undefined : "rotate(28)"}>
        <g transform="translate(-108 -60)"><ObjectCubeShape /></g>
        {animate ? <animateTransform attributeName="transform" type="rotate" dur="2.7s" values="0;28;28;0" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </g>
    </g>
  ) : action === "scale" ? (
    <g transform="translate(108 60)" data-preview-object-transform="scale">
      <g transform={animate ? undefined : "scale(1.18)"}>
        <g transform="translate(-108 -60)"><ObjectCubeShape /></g>
        {animate ? <animateTransform attributeName="transform" type="scale" dur="2.7s" values=".86;1.18;1.18;.86" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
      </g>
    </g>
  ) : (
    <g transform={animate ? undefined : "translate(0 0)"} data-preview-object-transform="ground">
      <ObjectCubeShape />
      {animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="0 -18;0 0;0 0;0 -18" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
    </g>
  );

  return (
    <g data-preview-operation={`object-${action}`}>
      <ObjectCubeShape ghost />
      {liveObject}
      {action === "translate" ? <path d="M108 20V6m0 0-5 7m5-7 5 7M148 48h18m0 0-7-5m7 5-7 5" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /> : null}
      {action === "rotate" ? <path d="M61 52a51 30 0 0 0 96 0m0 0-11 3m11-3-4-10" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /> : null}
      {action === "scale" ? <path d="M65 31 51 17m0 0 11 2m-11-2 2 11M151 75l14 14m0 0-11-2m11 2-2-11" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /> : null}
      {action === "ground" ? <><path d="M43 91h130" stroke={COLOR.accent} strokeDasharray="5 4" strokeWidth="2" /><path d="M164 54v25m0 0-7-8m7 8 7-8" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /></> : null}
    </g>
  );
}

export function ObjectSnapPreview({ animate, variant }: { animate: boolean; variant: string }): ReactElement {
  const disable = previewVariantMatches(variant, "disable");
  return (
    <g data-preview-operation={disable ? "object-snap-disable" : "object-snap-enable"}>
      {[48, 78, 108, 138, 168].map((x) => <path key={`x-${x}`} d={`M${x} 15v74`} stroke={x === 108 ? COLOR.cool : COLOR.lineStrong} strokeWidth={x === 108 ? "1.4" : "1"} opacity={disable ? ".2" : x === 108 ? ".7" : ".45"} />)}
      {[22, 52, 82].map((y) => <path key={`y-${y}`} d={`M34 ${y}h148`} stroke={y === 52 ? COLOR.cool : COLOR.lineStrong} strokeWidth={y === 52 ? "1.4" : "1"} opacity={disable ? ".2" : y === 52 ? ".7" : ".45"} />)}
      <rect x="58" y="27" width="42" height="30" rx="5" fill="none" stroke={COLOR.fg3} strokeDasharray="4 3" strokeWidth="1.5" opacity=".56" />
      <g transform={animate ? undefined : disable ? "translate(29 -10)" : "translate(0 0)"}>
        <rect x="87" y="37" width="42" height="30" rx="5" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeWidth="2" />
        <circle cx="108" cy="52" r="4" fill={COLOR.accent} stroke={COLOR.canvas} strokeWidth="1.5" />
        {animate ? <animateTransform attributeName="transform" type="translate" dur="2.8s" values={disable ? "0 0;29 -10;29 -10;0 0" : "-29 -10;0 0;0 0;-29 -10"} keyTimes="0;.42;.74;1" repeatCount="indefinite" /> : null}
      </g>
      <circle cx="108" cy="52" r={animate ? "4" : disable ? "5" : "9"} fill="none" stroke={disable ? COLOR.fg3 : COLOR.cool} strokeWidth="2" opacity={animate ? ".9" : disable ? ".3" : ".78"}>
        {animate ? (
          <>
            <animate attributeName="r" dur="2.8s" values="3;3;13;3" keyTimes="0;.4;.56;1" repeatCount="indefinite" />
            <animate attributeName="opacity" dur="2.8s" values={disable ? "1;1;.12;1" : "0;0;1;0"} keyTimes="0;.38;.56;1" repeatCount="indefinite" />
          </>
        ) : null}
      </circle>
      <path d={disable ? "M166 37h-28m0 0 8-6m-8 6 8 6" : "M138 67h28m0 0-8-6m8 6-8 6"} fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" />
      <path d={disable ? "M101 45l14 14m0-14-14 14" : "M102 46h12M108 40v24"} stroke={disable ? COLOR.accent : COLOR.fg} strokeLinecap="round" strokeWidth={disable ? "2" : "1.2"} opacity=".8" />
    </g>
  );
}

function CameraSceneShape({ ghost = false }: { ghost?: boolean }): ReactElement {
  return (
    <g data-preview-camera-scene={ghost ? "ghost" : "live"} opacity={ghost ? ".22" : "1"}>
      <circle cx="108" cy="52" r="25" fill={ghost ? "none" : COLOR.accentSoft} stroke={ghost ? COLOR.fg3 : COLOR.accent} strokeDasharray={ghost ? "4 3" : undefined} strokeWidth="2" />
      <path d="M98 72v-16h20v16M101 56v-12h14v12M108 44V33" fill="none" stroke={ghost ? COLOR.fg3 : COLOR.fg2} strokeLinejoin="round" strokeWidth="2" />
    </g>
  );
}

export function CameraActionPreview({
  animate,
  action,
  variant,
}: {
  animate: boolean;
  action: "zoom" | "reset" | "orbit" | "quad";
  variant: string;
}): ReactElement {
  const zoomOut = previewVariantMatches(variant, "zoom-out");
  const focusSelection = previewVariantMatches(variant, "focus-selection");
  const stopOrbit = action === "orbit" && previewVariantMatches(variant, "stop");
  if (action === "quad") {
    const closeQuad = previewVariantMatches(variant, "close");
    const panes = [
      { x: 48, y: 19, label: "정", scene: "M58 43h36M76 27v20M64 35h24" },
      { x: 109, y: 19, label: "측", scene: "M122 44h30l-8-11h-14Z" },
      { x: 48, y: 55, label: "상", scene: "M61 77h30V62H61Zm8-15v15m14-15v15" },
      { x: 109, y: 55, label: "원", scene: "m118 78 12-14 9 8 8-7 9 13" },
    ] as const;
    return (
      <g data-preview-operation={closeQuad ? "quad-view-close" : "quad-view-open"}>
        {animate || closeQuad ? (
          <rect
            x={animate ? (closeQuad ? "48" : "36") : "36"}
            y={animate ? (closeQuad ? "19" : "13") : "13"}
            width={animate ? (closeQuad ? "56" : "144") : "144"}
            height={animate ? (closeQuad ? "31" : "78") : "78"}
            rx="5"
            data-preview-camera-layout={closeQuad ? "quad-to-single" : "single-to-quad"}
            fill={COLOR.accentSoft}
            stroke={COLOR.accent}
            strokeWidth="1.8"
          >
            {animate ? (
              <>
                <animate attributeName="x" dur="2.8s" values={closeQuad ? "48;36;36;48" : "36;48;48;36"} keyTimes="0;.42;.76;1" repeatCount="indefinite" />
                <animate attributeName="y" dur="2.8s" values={closeQuad ? "19;13;13;19" : "13;19;19;13"} keyTimes="0;.42;.76;1" repeatCount="indefinite" />
                <animate attributeName="width" dur="2.8s" values={closeQuad ? "56;144;144;56" : "144;56;56;144"} keyTimes="0;.42;.76;1" repeatCount="indefinite" />
                <animate attributeName="height" dur="2.8s" values={closeQuad ? "31;78;78;31" : "78;31;31;78"} keyTimes="0;.42;.76;1" repeatCount="indefinite" />
              </>
            ) : null}
          </rect>
        ) : null}
        <g
          data-preview-camera-layout="quad"
          opacity={animate ? (closeQuad ? "1" : ".08") : closeQuad ? "0" : "1"}
        >
          {animate ? (
            <animate
              attributeName="opacity"
              dur="2.8s"
              values={closeQuad ? "1;1;.08;.08;1" : ".08;.08;1;1;.08"}
              keyTimes="0;.34;.5;.76;1"
              repeatCount="indefinite"
            />
          ) : null}
          {panes.map((pane, index) => (
            <g key={pane.label} data-preview-quad-pane={pane.label}>
              <rect
                x={pane.x}
                y={pane.y}
                width="56"
                height="31"
                rx="4"
                fill={index === 0 ? COLOR.accentSoft : COLOR.canvas}
                stroke={index === 0 ? COLOR.accent : COLOR.lineStrong}
                strokeWidth="1.4"
              />
              <path d={pane.scene} fill="none" stroke={index === 0 ? COLOR.accent : COLOR.fg2} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
              <text x={pane.x + 5} y={pane.y + 9} fill={COLOR.fg3} fontSize="6.5" fontWeight="800">{pane.label}</text>
            </g>
          ))}
          <path d="M106.5 19v67M48 52.5h117" stroke={COLOR.cool} strokeWidth="1.5" />
        </g>
        {closeQuad ? (
          <g opacity={animate ? ".08" : "1"}>
            <circle cx="78" cy="38" r="8" fill={COLOR.cool} />
            <path d="m49 78 31-25 22 17 19-14 45 22" fill="none" stroke={COLOR.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
            {animate ? <animate attributeName="opacity" dur="2.8s" values=".08;1;1;.08" keyTimes="0;.48;.76;1" repeatCount="indefinite" /> : null}
          </g>
        ) : null}
      </g>
    );
  }

  if (action === "zoom") {
    const operation = focusSelection ? "focus-selection" : zoomOut ? "zoom-out" : "zoom-in";
    const scaleValues = focusSelection
      ? ".76;1.32;1.32;.76"
      : zoomOut
        ? "1.25;.72;.72;1.25"
        : ".76;1.28;1.28;.76";
    const staticScale = focusSelection ? 1.32 : zoomOut ? .72 : 1.28;
    return (
      <g data-preview-operation={operation}>
        <CameraSceneShape ghost />
        <g transform={focusSelection && !animate ? "translate(0 0)" : undefined}>
          {focusSelection && animate ? <animateTransform attributeName="transform" type="translate" dur="2.7s" values="18 8;0 0;0 0;18 8" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          <g transform="translate(108 52)" data-preview-camera-transform={operation}>
            <g transform={animate ? undefined : `scale(${staticScale})`}>
              <g transform="translate(-108 -52)"><CameraSceneShape /></g>
              {animate ? <animateTransform attributeName="transform" type="scale" dur="2.7s" values={scaleValues} keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
            </g>
          </g>
        </g>
        {focusSelection ? (
          <g opacity={animate ? ".35" : "1"}>
            <rect x="93" y="31" width="30" height="44" rx="4" fill="none" stroke={COLOR.cool} strokeDasharray="4 3" strokeWidth="2" />
            <path d="M88 52h8m24 0h8M108 26v8m0 36v8" stroke={COLOR.cool} strokeLinecap="round" strokeWidth="2" />
            {animate ? <animate attributeName="opacity" dur="2.7s" values=".25;1;1;.25" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        ) : null}
        <circle cx="160" cy="75" r="14" fill={COLOR.card} stroke={COLOR.fg} strokeWidth="2" />
        {focusSelection ? (
          <><circle cx="160" cy="75" r="6" fill="none" stroke={COLOR.accent} strokeWidth="2" /><path d="M160 64v5M160 81v5M149 75h5M166 75h5" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2" /></>
        ) : (
          <path d={zoomOut ? "M154 75h12" : "M154 75h12M160 69v12"} stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2.3" />
        )}
        <path d="M170 85l10 10" stroke={COLOR.fg} strokeLinecap="round" strokeWidth="2.3" />
      </g>
    );
  }

  if (action === "reset") {
    return (
      <g data-preview-operation="camera-reset">
        <g transform="translate(108 52)">
          <g transform={animate ? undefined : "scale(1)"}>
            <g transform="translate(-108 -52)"><CameraSceneShape /></g>
            {animate ? <animateTransform attributeName="transform" type="scale" dur="2.8s" values="1.22;1;1;1.22" keyTimes="0;.42;.72;1" repeatCount="indefinite" /> : null}
          </g>
        </g>
        <path d="M72 38a42 42 0 1 1-1 31m1-31-13 1m13-1-5-12" fill="none" stroke={COLOR.accent} strokeDasharray={animate ? "190" : undefined} strokeDashoffset={animate ? "190" : undefined} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5">{animate ? <animate attributeName="stroke-dashoffset" dur="2.8s" values="190;0;0" keyTimes="0;.72;1" repeatCount="indefinite" /> : null}</path>
      </g>
    );
  }

  return (
    <g data-preview-operation={stopOrbit ? "camera-orbit-stop" : "camera-orbit-start"}>
      <CameraSceneShape />
      <ellipse cx="108" cy="52" rx="65" ry="32" fill="none" stroke={stopOrbit ? COLOR.fg3 : COLOR.cool} strokeDasharray={stopOrbit ? "3 8" : "4 4"} opacity={stopOrbit ? ".45" : ".8"} />
      <path d="M43 52c10-15 27-25 47-30M173 52c-10 15-27 25-47 30" fill="none" stroke={COLOR.cool} strokeDasharray="3 4" strokeWidth="1.2" opacity=".55" />
      <g
        data-preview-camera={stopOrbit ? "stopping" : "orbiting"}
        transform={animate ? (stopOrbit ? "translate(160 35) rotate(110)" : undefined) : stopOrbit ? "translate(160 35) rotate(110)" : "translate(173 52) rotate(90)"}
      >
        <g transform="rotate(90)">
          <rect x="-11" y="-8" width="22" height="16" rx="4" fill={COLOR.raised} stroke={COLOR.fg} strokeWidth="1.6" />
          <path d="m11-5 9-5v20l-9-5Z" fill={COLOR.accentSoft} stroke={COLOR.accent} strokeLinejoin="round" strokeWidth="1.5" />
          <circle cx="-3" cy="0" r="4" fill={COLOR.canvas} stroke={COLOR.cool} strokeWidth="1.4" />
        </g>
        {animate && !stopOrbit ? (
          <animateMotion
            dur="2.8s"
            path="M43 52a65 32 0 1 0 130 0 65 32 0 1 0-130 0"
            rotate="auto"
            repeatCount="indefinite"
          />
        ) : animate ? (
          <animateTransform attributeName="transform" type="translate" additive="sum" dur="2.8s" values="-14 8;0 0;0 0;-14 8" keyTimes="0;.3;.82;1" repeatCount="indefinite" />
        ) : null}
      </g>
      {stopOrbit ? (
        <g transform="translate(169 78)">
          <circle r="13" fill={COLOR.card} stroke={COLOR.accent} strokeWidth="1.8" />
          <path d="M-4-6V6M4-6V6" stroke={COLOR.accent} strokeLinecap="round" strokeWidth="3" />
          {animate ? <animate attributeName="opacity" dur="2.8s" values=".2;.2;1;1;.2" keyTimes="0;.28;.42;.82;1" repeatCount="indefinite" /> : null}
        </g>
      ) : null}
    </g>
  );
}
