/**
 * StudioBrushPresetIcon — Lucide glyph for a built-in brush preset id.
 * Keeps icon choice out of pure modules (studio-brush-icons.ts holds keys only).
 */
import {
  ALargeSmall,
  AlignJustify,
  Asterisk,
  Blend,
  Brush,
  Circle,
  CircleDashed,
  CircleDot,
  CircleEllipsis,
  Cloud,
  CloudFog,
  Droplets,
  Eraser,
  Feather,
  Fence,
  Flame,
  Flower2,
  Footprints,
  Gem,
  Grid3x3,
  Grid2x2,
  Grip,
  Highlighter,
  Heart,
  Layers3,
  Leaf,
  Paintbrush,
  PaintRoller,
  Pen,
  PenLine,
  PenTool,
  Pencil,
  RectangleHorizontal,
  RectangleVertical,
  Rows3,
  ScanLine,
  Spline,
  Sparkles,
  SprayCan,
  Square,
  SquareDashed,
  Star,
  Stamp,
  Sun,
  Trees,
  Waves,
  Wheat,
  Wind,
  type LucideIcon,
} from "lucide-react";

import { studioBrushIconId, type StudioBrushIconId } from "./studio-brush-icons";

import { cn } from "@/shared/lib/utils";

const ICON_MAP: Record<StudioBrushIconId, LucideIcon> = {
  pen: Pen,
  "pen-line": PenLine,
  "pen-tool": PenTool,
  eraser: Eraser,
  pencil: Pencil,
  highlighter: Highlighter,
  brush: Brush,
  paintbrush: Paintbrush,
  "paint-roller": PaintRoller,
  "spray-can": SprayCan,
  droplets: Droplets,
  blend: Blend,
  cloud: Cloud,
  "cloud-fog": CloudFog,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  circle: Circle,
  "circle-dashed": CircleDashed,
  "circle-ellipsis": CircleEllipsis,
  "circle-dot": CircleDot,
  square: Square,
  "square-dashed": SquareDashed,
  "rectangle-horizontal": RectangleHorizontal,
  "rectangle-vertical": RectangleVertical,
  waves: Waves,
  flame: Flame,
  wind: Wind,
  "grid-3x3": Grid3x3,
  "grid-2x2": Grid2x2,
  grip: Grip,
  rows: Rows3,
  "align-justify": AlignJustify,
  fence: Fence,
  gem: Gem,
  layers: Layers3,
  spline: Spline,
  feather: Feather,
  leaf: Leaf,
  trees: Trees,
  wheat: Wheat,
  flower: Flower2,
  stamp: Stamp,
  footprints: Footprints,
  heart: Heart,
  asterisk: Asterisk,
  direction: ScanLine,
  "a-large-small": ALargeSmall,
  default: Pen,
};

export interface StudioBrushPresetIconProps {
  brushId: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Accessible name; defaults to decorative (aria-hidden). */
  title?: string;
}

export function StudioBrushPresetIcon({
  brushId,
  size = 14,
  strokeWidth = 1.75,
  className,
  title,
}: StudioBrushPresetIconProps): React.ReactElement {
  const key = studioBrushIconId(brushId);
  const Icon = ICON_MAP[key] ?? Pen;
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-studio-brush-icon={key}
      data-studio-brush-icon-for={brushId}
    />
  );
}
