/**
 * Browser/Worker orchestration for destructive pixel-edit brushes.
 *
 * StudioPage loads this module only after an explicit Magic Wand, Smudge, or Heal/Clone action.
 * Their pure geometry/contracts stay in the eager drawing graph, while image decode and Worker
 * startup code no longer consume the initial Studio route budget.
 */
export { bakeHealCloneStrokeToCanvas } from "./studio-heal-clone-browser";
export { magicWandScanFromImage, sampleImageLuminanceField } from "./studio-magic-wand-browser";
export {
  encodeStudioRetouchCanvasPng,
  loadStudioRetouchSourceImage,
  runStudioDodgeBurnRetouch,
  runStudioWetMixRetouch,
  studioRetouchSourceDimensions,
} from "./studio-retouch-browser";
export {
  planStudioRasterRetouchRegion,
  translateStudioRasterRetouchPoints,
} from "./render/studio-raster-retouch-region";
export { smudgeStrokeImage } from "./studio-smudge-browser";
