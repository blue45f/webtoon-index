import { uid } from "./studio-id";

// Under `verbatimModuleSyntax` an inline-type specifier list still emits a side-effect import,
// which re-anchors the whole comipo assembly/template graph into the eager Studio chunk. A
// type-only import statement is erased instead, so these two must stay in the `import type` form.
import type { ComipoAssemblySeed } from "./studio-comipo-assembly";
import type { El } from "./studio-element-model";

export function comipoSeedsToEls(seeds: ComipoAssemblySeed[]): El[] {
  return seeds.map((seed) => {
    const id = uid();
    if (seed.type === "frame") {
      return {
        id,
        type: "frame" as const,
        x: seed.x,
        y: seed.y,
        width: seed.width,
        height: seed.height,
        stroke: "stroke" in seed ? seed.stroke : undefined,
        strokeWidth: "strokeWidth" in seed ? seed.strokeWidth : undefined,
        bgColor: "bgColor" in seed ? seed.bgColor : undefined,
      };
    }
    if (seed.type === "bubble") {
      return {
        id,
        type: "bubble" as const,
        variant: seed.variant,
        text: seed.text,
        x: seed.x,
        y: seed.y,
        width: seed.width,
        height: seed.height,
        fill: seed.fill,
        textFill: seed.textFill,
        rotation: seed.rotation,
        tail: "tail" in seed ? seed.tail : undefined,
        tailDirection: "tailDirection" in seed ? seed.tailDirection : undefined,
        align: "align" in seed ? seed.align : undefined,
      };
    }
    if (seed.type === "text") {
      return {
        id,
        type: "text" as const,
        text: seed.text,
        x: seed.x,
        y: seed.y,
        width: seed.width,
        fontSize: seed.fontSize,
        fill: seed.fill,
        rotation: seed.rotation,
        font: seed.font,
        stroke: seed.stroke,
        strokeWidth: seed.strokeWidth,
        align: seed.align,
        fontStyle: seed.fontStyle,
      };
    }
    if (seed.type === "focusLines") {
      return {
        id,
        type: "focusLines" as const,
        x: seed.x,
        y: seed.y,
        width: seed.width,
        height: seed.height,
        lineCount: seed.lineCount,
        innerRadius: seed.innerRadius,
        outerRadius: seed.outerRadius,
        stroke: seed.stroke,
        strokeWidth: seed.strokeWidth,
        noise: seed.noise,
        rotation: seed.rotation,
      };
    }
    return {
      id,
      type: "speedLines" as const,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      lineCount: seed.lineCount,
      direction: seed.direction,
      stroke: seed.stroke,
      strokeWidth: seed.strokeWidth,
      rotation: seed.rotation,
    };
  });
}
