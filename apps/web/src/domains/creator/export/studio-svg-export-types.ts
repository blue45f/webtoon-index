import type { StudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import type { StudioBrushEngineProgramSet } from "../brush/studio-brush-engine-program-set";
import type { StudioStampBrushTuning } from "../brush/studio-brush-stamp-engine";
import type { StudioBrushTipAlphaMap } from "../brush/studio-brush-tip-stamp";
import type { StudioInkPressureModel } from "../brush/studio-ink-pressure-model";
import type { StudioPaperSubstrateModel } from "../brush/studio-paper-substrate-model";
import type { StudioStrokePaintModel } from "../brush/studio-stroke-paint-model";
import type {
  ShapeParams,
  StrokeStyle,
} from "../brush/studio-stroke-shapes";
import type { BubbleTailSpec } from "../lettering/studio-bubble-path";
import type { StudioRubySpanInput } from "../lettering/studio-dialogue-ruby-layout";
import type { TextPathConfig } from "../lettering/studio-text-path";
import type { ImageFilterFields } from "../render/studio-konva-filter-fields";
import type { BubbleVariant } from "../studio-assets";
import type { CalligraphyTipSettings } from "../studio-brush";
import type { StudioGradientSpec } from "../studio-gradient-engine";
import type { LayerGroup } from "../studio-layers";
import type { StudioMaterialMinimumDiameterRatio, StudioMaterialPressureModel } from "../studio-material-pressure-model";
import type { StudioPatternSpec } from "../studio-pattern-fill";
import type { StudioSketchStyle } from "../studio-rough-shape";
import type { SkewFields } from "../studio-skew";

/** 모든 요소가 공유하는 레이어 메타(El 인터섹션과 동일 필드). */
export interface SvgElMeta {
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  noClip?: boolean;
  opacity?: number;
  blendMode?: string;
  lockAspect?: boolean;
  groupId?: string;
  clipBelow?: boolean;
}

export interface SvgImageElLike extends SvgElMeta, SkewFields, ImageFilterFields {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipped?: boolean;
  flippedY?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  cornerRadius?: number;
}

export interface SvgTextElLike extends SvgElMeta, SkewFields {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fill: string;
  rotation: number;
  font?: string;
  stroke?: string;
  strokeWidth?: number;
  letterSpacing?: number;
  lineHeight?: number;
  vertical?: boolean;
  align?: "left" | "center" | "right";
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  fillType?: "solid" | "gradient";
  gradientColorStart?: string;
  gradientColorEnd?: string;
  gradientDirection?: "vertical" | "horizontal";
  gradient?: StudioGradientSpec;
  textPath?: TextPathConfig;
  rubySpans?: readonly StudioRubySpanInput[];
}

export interface SvgBubbleElLike extends SvgElMeta {
  id: string;
  type: "bubble";
  variant: BubbleVariant;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  textFill: string;
  rotation: number;
  tail?: "left" | "right" | "none";
  tailDirection?: "bottom" | "top" | "left" | "right";
  extraTails?: BubbleTailSpec[];
  font?: string;
  fontSize?: number;
  lineHeight?: number;
  vertical?: boolean;
  align?: "left" | "center" | "right";
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  tailXRatio?: number;
  tailHeight?: number;
  tailBase?: number;
  tailBend?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  starAmplitude?: number;
  customShapePoints?: number[];
  rubySpans?: readonly StudioRubySpanInput[];
}

export interface SvgFrameElLike extends SvgElMeta {
  id: string;
  type: "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  bg?: string;
  bgColor?: string;
  stroke?: string;
  strokeWidth?: number;
  dashStyle?: "solid" | "dashed";
  points?: number[];
}

export interface SvgStickerElLike extends SvgElMeta, SkewFields {
  id: string;
  type: "sticker";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  rotation: number;
}

export interface SvgDrawElLike extends SvgElMeta {
  id: string;
  type: "draw";
  kind?: "freehand" | "line" | "rect" | "ellipse" | "star" | "arrow" | "triangle" | "polygon";
  mode?: "pen" | "eraser";
  points: number[];
  stroke: string;
  strokeWidth: number;
  fill?: string;
  gradient?: StudioGradientSpec;
  pattern?: StudioPatternSpec;
  brush?: string;
  brushCatalogId?: string;
  outlineStroke?: unknown;
  pressures?: number[];
  pressureModel?: StudioInkPressureModel;
  paperModel?: StudioPaperSubstrateModel;
  materialPressureModel?: StudioMaterialPressureModel;
  materialMinimumDiameterRatio?: StudioMaterialMinimumDiameterRatio;
  paintModel?: StudioStrokePaintModel;
  sampleSpacing?: number;
  stampPipeline?: "causal-walker-v2";
  stamp?: StudioStampBrushTuning;
  watercolorPipeline?: "causal-walker-v2";
  tiltXs?: number[];
  tiltYs?: number[];
  twists?: number[];
  speeds?: number[];
  tangentialPressures?: number[];
  brushDynamics?: StudioBrushDynamicsSettings;
  brushEnginePrograms?: StudioBrushEngineProgramSet;
  brushTip?: CalligraphyTipSettings;
  strokeStyle?: StrokeStyle;
  shapeParams?: ShapeParams;
  sketch?: StudioSketchStyle;
  symmetry?: {
    type: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
    centerX: number;
    centerY: number;
    radialCount?: number;
  };
}

export interface SvgFocusLinesElLike extends SvgElMeta {
  id: string;
  type: "focusLines";
  x: number;
  y: number;
  width: number;
  height: number;
  lineCount?: number;
  innerRadius?: number;
  outerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
  noise?: number;
  rotation?: number;
  centerXRatio?: number;
  centerYRatio?: number;
}

export interface SvgSpeedLinesElLike extends SvgElMeta {
  id: string;
  type: "speedLines";
  x: number;
  y: number;
  width: number;
  height: number;
  lineCount?: number;
  direction?: "horizontal" | "vertical";
  stroke?: string;
  strokeWidth?: number;
  noise?: number;
  rotation?: number;
}

export type SvgExportEl =
  | SvgImageElLike
  | SvgTextElLike
  | SvgBubbleElLike
  | SvgFrameElLike
  | SvgStickerElLike
  | SvgDrawElLike
  | SvgFocusLinesElLike
  | SvgSpeedLinesElLike;

export type SvgExportTheme = "classic" | "soft" | "vivid";

export interface SvgExportPageInput {
  width: number;
  height: number;
  bg?: string;
  bgGrad?: readonly string[] | null;
  transparentBg?: boolean;
  elements: readonly SvgExportEl[];
  groups?: readonly LayerGroup[];
  theme?: SvgExportTheme;
}

export interface SvgExportSkip {
  id: string;
  type: string;
  mode: "skipped" | "approximated";
  label: string;
}

export interface SvgExportResult {
  svg: string;
  skipped: SvgExportSkip[];
  fontFamilies: string[];
  caveats: string[];
  elementCount: number;
}

export const SVG_EXPORT_MIME = "image/svg+xml;charset=utf-8";

export function svgExportFileName(title: string): string {
  return `${title.trim() || "toonspectrum-comic"}.svg`;
}

export interface ExportCtx {
  defs: string[];
  skips: SvgExportSkip[];
  fonts: Set<string>;
  theme: SvgExportTheme;
  brushTextureAssets: Map<string, Readonly<{ symbolId: string; size: number }>>;
  brushTextureAssetsByAlphaMap: Map<
    StudioBrushTipAlphaMap,
    Readonly<{ symbolId: string; size: number }>
  >;
  brushTextureSerializedUtf16Bytes: number;
  r8EmbeddedRgbaBytes: number;
  seq: number;
}
