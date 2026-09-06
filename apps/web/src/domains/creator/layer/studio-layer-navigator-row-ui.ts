import {
  Image as ImageIcon,
  Layers3,
  MessageCircle,
  PenTool,
  Sparkles,
  Square,
  Sticker,
  Type as TypeIcon,
  type LucideIcon,
} from "lucide-react";

import type {
  StudioLayerKind,
  StudioLayerNavigatorResult,
} from "./studio-layer-navigator";

export const STUDIO_LAYER_NAVIGATOR_KIND_ICONS: Record<
  Exclude<StudioLayerKind, "all">,
  LucideIcon
> = {
  image: ImageIcon,
  text: TypeIcon,
  bubble: MessageCircle,
  draw: PenTool,
  frame: Square,
  sticker: Sticker,
  effect: Sparkles,
  other: Layers3,
};

export const STUDIO_LAYER_NAVIGATOR_FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cool";
export const STUDIO_LAYER_NAVIGATOR_COARSE_TARGET =
  "max-lg:min-h-11 max-lg:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

export function studioLayerNavigatorItemStatusLabel(
  entry: StudioLayerNavigatorResult
): string {
  const labels: string[] = [];
  if (entry.effectivelyHidden) labels.push("숨김");
  if (entry.effectivelyLocked) labels.push("잠김");
  if (entry.item.fillReference) labels.push("채우기 참조");
  if (entry.item.alphaLocked) labels.push("알파 락");
  if (entry.item.masked) {
    labels.push(entry.item.maskEnabled === false ? "마스크 꺼짐" : "마스크");
  }
  if (entry.item.aiGenerated) labels.push("AI 작업");
  if (entry.item.clipBelow) labels.push("아래 클리핑");
  if (entry.item.animated) labels.push("애니메이션");
  return labels.join(", ");
}
