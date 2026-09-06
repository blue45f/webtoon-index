/**
 * Keeps asset-picker chrome in sync with the authoritative canvas insertion result.
 *
 * `insert` owns the detailed failure notice (collaboration lock, save in flight, etc.).
 * The picker must only close after that mutation actually commits.
 */
export function completeStudioAssetInsertion(
  insert: () => boolean,
  onInserted: () => void
): boolean {
  const inserted = insert();
  if (!inserted) return false;
  onInserted();
  return true;
}
