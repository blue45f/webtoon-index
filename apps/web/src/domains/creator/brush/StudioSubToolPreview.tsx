import { studioCoreBrushCatalogItemById } from "./studio-brush-catalog-core";
import {
  studioBrushPreviewDashArray,
  studioBrushPreviewDotCenters,
  studioBrushPreviewOpacity,
  studioBrushPreviewPathD,
  studioBrushPreviewRibbonD,
  studioBrushPreviewStrokeWidth,
} from "./studio-brush-visual";
import { StudioBrushPresetIcon } from "./StudioBrushPresetIcon";

/** Reuses the catalog's audited preview style. A feature illustration, not a live render. */
export function StudioSubToolPreview({ brushId }: { brushId: string }) {
  const item = studioCoreBrushCatalogItemById(brushId);
  if (!item) return <StudioBrushPresetIcon brushId={brushId} size={24} />;
  const { previewStyle: style, previewWeight: weight } = item;
  const path = studioBrushPreviewPathD(style, 40, 18);
  const ribbon = studioBrushPreviewRibbonD(style, 40, 18, weight);
  const dots = studioBrushPreviewDotCenters(style, 40, 18);
  const width = studioBrushPreviewStrokeWidth(weight, style);
  const opacity = studioBrushPreviewOpacity(item.defaultOpacity);
  return (
    <svg
      aria-hidden
      width="64"
      height="30"
      viewBox="0 0 40 18"
      data-studio-subtool-preview={brushId}
      className="shrink-0 overflow-hidden rounded-md bg-canvas"
    >
      {item.operation === "erase" ? (
        <>
          <path d="M3 3H37M3 6H37M3 9H37M3 12H37M3 15H37" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          <path d={path} className="stroke-canvas" strokeWidth={width} fill="none" opacity={opacity} strokeLinecap="round" />
        </>
      ) : dots.length ? (
        <g fill="currentColor" opacity={opacity}>
          {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />)}
        </g>
      ) : (
        <>
          {style === "soft" ? <path d={path} stroke="currentColor" strokeWidth={width * 1.8} fill="none" opacity={opacity * 0.2} strokeLinecap="round" /> : null}
          {ribbon ? <path d={ribbon} fill="currentColor" opacity={opacity} /> : (
            <path d={path} stroke="currentColor" strokeWidth={width} fill="none" opacity={opacity} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={studioBrushPreviewDashArray(style)} />
          )}
        </>
      )}
    </svg>
  );
}
