/** Revision-scoped review receipts share the application's SQLite/OPFS owner. */
export const STUDIO_QUALITY_REVIEW_NAMESPACE = "studio-quality-review-v2";
const MAX_BYTES = 1_048_576;
let writeTail: Promise<void> = Promise.resolve();
let runtimeModule: Promise<typeof import("./studio-local-database-runtime")> | undefined;

function loadRuntime() {
  // Share only the lazy module load. Every operation still acquires the current
  // database owner; a failed acquisition must never become a cached DB handle.
  runtimeModule ??= import("./studio-local-database-runtime").catch((error) => {
    runtimeModule = undefined;
    throw error;
  });
  return runtimeModule;
}

function bounded(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_BYTES) {
    throw new Error("검토 기록이 저장 크기 제한을 초과했습니다.");
  }
}
async function acquireStore() {
  const { acquireStudioLocalDatabase } = await loadRuntime();
  const database = await acquireStudioLocalDatabase();
  return database.asAsyncKeyValueStore(STUDIO_QUALITY_REVIEW_NAMESPACE);
}
export async function loadStudioQualityReviewState(key: string): Promise<string | null> {
  await writeTail;
  const store = await acquireStore();
  const serialized = await store.get(key);
  if (serialized !== null) bounded(serialized);
  return serialized;
}
export function saveStudioQualityReviewState(key: string, serialized: string): Promise<void> {
  try { bounded(serialized); } catch (error) { return Promise.reject(error); }
  const operation = writeTail.then(async () => {
    const store = await acquireStore();
    await store.set(key, serialized);
  });
  // Surface the failure to this caller, while allowing a later authored edit to retry.
  writeTail = operation.catch(() => undefined);
  return operation;
}
