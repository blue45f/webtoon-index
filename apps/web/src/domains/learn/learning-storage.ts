import { emptyProgress, parseProgress, STORAGE_KEY, type LearningProgress, type Lesson } from "./learning-model";

export type LearningStorage = Pick<Storage, "getItem" | "setItem">;
export interface LearningSnapshot {
  data: LearningProgress;
  warning: string;
  dirty: boolean;
  conflict: boolean;
  revision: number;
}
const SAVE_WARNING = "기록을 기기에 저장하지 못했습니다. 이 화면의 기록을 백업해 보관하세요. 학습은 계속할 수 있습니다.";
const CONFLICT_WARNING = "다른 탭의 기록이 바뀌어 자동 저장을 멈췄습니다. 이 화면의 미저장 메모는 유지했습니다. 먼저 백업한 뒤 저장할 기록을 확인하세요.";

/** One document-local store. No event listener or timer is owned by this testable controller. */
export function createLearningProgressStore(
  getStorage: () => LearningStorage | null,
  lessons: readonly Lesson[],
  termIds: readonly string[],
) {
  const listeners = new Set<() => void>();
  let baselineRaw: string | null | undefined;
  let observedRaw: string | null | undefined;
  let snapshot: LearningSnapshot = { data: emptyProgress(), warning: "", dirty: false, conflict: false, revision: 0 };

  function storage(): LearningStorage {
    const result = getStorage();
    if (!result) throw new Error("Learning storage is unavailable");
    return result;
  }
  function publish(next: Omit<LearningSnapshot, "revision">) {
    snapshot = { ...next, revision: snapshot.revision + 1 };
    listeners.forEach((listener) => listener());
  }
  function refresh(): boolean {
    try {
      const raw = storage().getItem(STORAGE_KEY);
      const previousObservedRaw = observedRaw;
      observedRaw = raw;
      if (snapshot.dirty) {
        // Never replace unsaved memory with a notification, including clear()/removeItem().
        if (raw !== baselineRaw && (!snapshot.conflict || raw !== previousObservedRaw)) {
          publish({ ...snapshot, conflict: true, warning: CONFLICT_WARNING });
        }
        return true;
      }
      if (raw !== baselineRaw || snapshot.warning) {
        baselineRaw = raw;
        publish({ data: parseProgress(raw, lessons, termIds), warning: "", dirty: false, conflict: false });
      }
      return true;
    } catch {
      if (!snapshot.warning) publish({ ...snapshot, warning: "기록 저장소를 읽을 수 없습니다. 현재 화면에서는 계속 학습할 수 있습니다." });
      return false;
    }
  }
  function persist(data: LearningProgress): boolean {
    // Normalization is applied at the write boundary, too (not only during the next reload).
    const validated = parseProgress(JSON.stringify(data), lessons, termIds);
    if (snapshot.conflict) {
      publish({ data: validated, dirty: true, conflict: true, warning: CONFLICT_WARNING });
      return false;
    }
    try {
      const raw = JSON.stringify(validated);
      storage().setItem(STORAGE_KEY, raw);
      baselineRaw = raw;
      observedRaw = raw;
      publish({ data: validated, warning: "", dirty: false, conflict: false });
      return true;
    } catch {
      publish({ data: validated, warning: SAVE_WARNING, dirty: true, conflict: false });
      return false;
    }
  }
  function update(change: (current: LearningProgress) => LearningProgress): boolean {
    const readable = refresh();
    const data = change(snapshot.data);
    if (!readable) {
      publish({ ...snapshot, data: parseProgress(JSON.stringify(data), lessons, termIds), dirty: true, warning: SAVE_WARNING });
      return false;
    }
    return persist(data);
  }
  function retrySave(): boolean {
    const readable = refresh();
    return !readable || snapshot.conflict ? false : persist(snapshot.data);
  }
  /** Explicit UI confirmation only. A stale confirmation never overwrites newer external data. */
  function confirmCurrentRecord(expectedRevision: number): boolean {
    if (expectedRevision !== snapshot.revision || !snapshot.conflict) return false;
    try {
      const raw = storage().getItem(STORAGE_KEY);
      if (raw !== observedRaw) {
        observedRaw = raw;
        publish({ ...snapshot, warning: "다른 탭에서 기록이 다시 바뀌었습니다. 백업 후 저장 내용을 다시 확인해 주세요." });
        return false;
      }
      publish({ ...snapshot, conflict: false });
      return persist(snapshot.data);
    } catch {
      publish({ ...snapshot, warning: SAVE_WARNING });
      return false;
    }
  }
  /** Called only after the existing two-step reset confirmation. Never clears other storage keys. */
  function reset(): boolean {
    publish({ ...snapshot, conflict: false });
    return persist(emptyProgress());
  }
  refresh();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    update,
    retrySave,
    confirmCurrentRecord,
    reset,
  };
}

/** Filter sessionStorage and unrelated keys before reading the persistent learning record. */
export function observeLearningStorage(
  target: Window,
  getStorage: () => LearningStorage | null,
  refresh: () => void,
): () => void {
  const sync = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try { if (event.storageArea !== getStorage()) return; }
    catch { return; }
    refresh();
  };
  target.addEventListener("storage", sync);
  return () => target.removeEventListener("storage", sync);
}
