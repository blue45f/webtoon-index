/**
 * Compatibility facade for existing callers and focused tests. Production Studio entry points
 * import these pure document operations from `studio-comments` so they reuse its existing chunk.
 */
export {
  applyStudioTeamCommentReanchorReceipt,
  mergeStudioTeamCommentMutableDocument,
  partitionStudioTeamCommentMutableDocument,
  type StudioTeamCommentMutablePartition,
} from "./studio-comments";
