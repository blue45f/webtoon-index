import {
  resolveStudioBrushDynamicsPresetId,
  type StudioBrushDynamicsPresetId,
} from "./studio-brush-dynamics";

/** Built-in aliases keep their actual dynamics engine when the user restores defaults. */
export function studioBrushStudioDefaultPresetId(brushId: string): StudioBrushDynamicsPresetId {
  return resolveStudioBrushDynamicsPresetId(brushId) ?? "ink-particle";
}
