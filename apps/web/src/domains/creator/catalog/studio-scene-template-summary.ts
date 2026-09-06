import type { SceneSeed, SceneTemplate } from "../studio-scene-templates";

export interface StudioSceneTemplateSummary {
  readonly seeds: readonly SceneSeed[];
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly bubbles: number;
  readonly texts: number;
  readonly effects: number;
}
/** Build once per selection. The map is a layout schematic, never a substitute renderer. */
export function summarizeStudioSceneTemplate(template: SceneTemplate): StudioSceneTemplateSummary {
  const seeds = template.build(0, 0);
  if (seeds.length > 120) throw new Error("장면 구성 요소가 미리보기 한도를 초과합니다.");
  let width = 720;
  let height = 1;
  for (const seed of seeds) {
    const h = seed.type === "text" ? seed.fontSize * 1.5 : seed.height;
    if (![seed.x, seed.y, seed.width, h].every(Number.isFinite) || seed.width <= 0 || h <= 0) throw new Error("유효하지 않은 장면 구성입니다.");
    width = Math.max(width, seed.x + seed.width);
    height = Math.max(height, seed.y + h);
  }
  if (width > 8192 || height > 16000) throw new Error("장면 미리보기 크기가 한도를 초과합니다.");
  return { seeds, width, height,
    frames: seeds.filter((seed) => seed.type === "frame").length,
    bubbles: seeds.filter((seed) => seed.type === "bubble").length,
    texts: seeds.filter((seed) => seed.type === "text").length,
    effects: seeds.filter((seed) => seed.type === "focusLines" || seed.type === "speedLines").length };
}
