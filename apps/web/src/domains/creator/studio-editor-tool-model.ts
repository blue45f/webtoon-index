export type Tool = "select" | "draw" | "hand";

/** pen/eraser/shape + 픽셀 펜슬 · lasso fill. */
export type DrawMode = "pen" | "eraser" | "shape" | "pixel" | "lasso-fill";

export type DrawShapeKind =
  | "line"
  | "rect"
  | "ellipse"
  | "star"
  | "arrow"
  | "triangle"
  | "polygon";

export type StudioMenu =
  | "template"
  | "collage"
  | "bubble"
  | "sticker"
  | "elements"
  | "char"
  | "bgScene"
  | "bgFill"
  | "asset"
  | "emeres"
  | "tone"
  | "scene"
  | "clip"
  | "palette"
  | "brandKit"
  | "stockImage"
  | "aiAssist"
  | "integrations";
