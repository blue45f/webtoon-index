/** Shared SQLite/OPFS authority; no browser-KV or hidden persistence fallback. */
import type { StudioLocalDatabase } from "../studio-local-database";
import type { StoryworldProject } from "./studio-storyworld-causality";

export const STORYWORLD_DRAFT_NAMESPACE = "studio-storyworld-drafts-v1";
const MAX_BYTES = 1_100_000;
type Database = Pick<StudioLocalDatabase, "kvGet" | "kvSet">;
type Decode = (serialized: string) => StoryworldProject;
function bounded(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_BYTES) {
    throw new Error("스토리월드 저장 데이터가 허용 크기를 초과했습니다.");
  }
}
export function createStoryworldDraftStore(acquireDatabase: () => Promise<Database>) {
  const tails = new Map<string, Promise<void>>();
  return {
    async load(key: string, decode: Decode): Promise<StoryworldProject | null> {
      await tails.get(key);
      const database = await acquireDatabase();
      const raw = await database.kvGet(STORYWORLD_DRAFT_NAMESPACE, key);
      if (raw === null) return null;
      bounded(raw);
      const envelope: unknown = JSON.parse(raw);
      if (typeof envelope !== "object" || envelope === null
        || !("version" in envelope) || envelope.version !== 1
        || !("documentKey" in envelope) || envelope.documentKey !== key
        || !("project" in envelope)) {
        throw new Error("스토리월드 저장 문서의 버전 또는 작품 범위가 일치하지 않습니다.");
      }
      return decode(JSON.stringify(envelope.project));
    },
    save(key: string, project: StoryworldProject): Promise<void> {
      // Capture the complete edit before waiting for earlier writes.
      let serialized: string;
      try {
        serialized = JSON.stringify({ version: 1, documentKey: key, savedAtIso: new Date().toISOString(), project });
        bounded(serialized);
      } catch (error) {
        return Promise.reject(error);
      }
      const current = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        const database = await acquireDatabase();
        await database.kvSet(STORYWORLD_DRAFT_NAMESPACE, key, serialized);
      });
      tails.set(key, current);
      const retire = () => { if (tails.get(key) === current) tails.delete(key); };
      void current.then(retire, retire);
      return current;
    },
  };
}
export const storyworldDraftStore = createStoryworldDraftStore(async () => {
  const { acquireStudioLocalDatabase } = await import("../studio-local-database-runtime");
  return acquireStudioLocalDatabase();
});
