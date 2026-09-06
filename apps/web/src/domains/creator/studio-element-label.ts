import { BUBBLE_VARIANTS } from "./studio-assets";

import type { El } from "./studio-element-model";

const BUBBLE_VARIANT_BY_ID = new Map(
  BUBBLE_VARIANTS.map((variant) => [variant.id, variant] as const)
);

/** Returns the stable display label used by layer, selection, and review surfaces. */
export function elementLabel(el: El): string {
  if (el.name) return el.name;
  switch (el.type) {
    case "text":
      return `T ${el.text.slice(0, 14).trim() || "텍스트"}`;
    case "bubble": {
      const variant = BUBBLE_VARIANT_BY_ID.get(el.variant);
      return `${variant?.label ?? "대사"} 말풍선`;
    }
    case "sticker":
      return `${el.text} 스티커`;
    case "draw":
      return "✏️ 그림";
    case "frame":
      return "▢ 패널";
    case "image":
      return "🖼️ 이미지";
    case "focusLines":
      return "🔆 집중선";
    case "speedLines":
      return "💨 속도선";
    default:
      return "요소";
  }
}
