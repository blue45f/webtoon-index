/**
 * User-triggered runtime for durable 3D shot production.
 *
 * Keep this module behind one analyzable dynamic import. Opening the interactive 3D editor should
 * not eagerly load archive verification, IndexedDB recovery, PSD, contact-sheet, or ZIP workers.
 */

export {
  STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES,
  STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES,
  buildStudioBg3dShotBatchArchive,
  projectStudioBg3dShotBatchPlanForPublicArchive,
} from "./studio-bg3d-shot-batch";
export { commitStudioBg3dShotBatchDownload } from "./studio-bg3d-shot-batch-download-gate";
export {
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  createStudioBg3dShotBatchPlan,
} from "./studio-bg3d-shot-batch-plan";
export {
  studioBg3dShotBatchQueueCompletedCount,
  waitForStudioBg3dBatchDocumentVisible,
} from "./studio-bg3d-shot-batch-queue";
export { buildStudioBg3dShotBatchArchiveInWorker } from "./studio-bg3d-shot-batch-worker-client";
export { buildStudioBg3dShotArtifacts } from "./studio-bg3d-shot-artifact-pipeline";
export { buildStudioBg3dShotContactSheetsInWorker } from "./studio-bg3d-shot-contact-sheet-worker-client";
