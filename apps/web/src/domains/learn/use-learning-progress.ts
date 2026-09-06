import { useEffect, useSyncExternalStore } from "react";

import { mergeLearningBackup } from "./learning-backup";
import { LESSONS, TERMS } from "./learning-content";
import { canComplete, EMPTY_LESSON, type LearningProgress, type LessonProgress } from "./learning-model";
import { createLearningProgressStore, observeLearningStorage } from "./learning-storage";

const TERM_IDS = TERMS.map((term) => term.id);
function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}
// Survives SPA navigation away from /learn, including a failed persistent write.
const records = createLearningProgressStore(getStorage, LESSONS, TERM_IDS);

export function useLearningProgress() {
  const saved = useSyncExternalStore(records.subscribe, records.getSnapshot, records.getSnapshot);
  useEffect(() => {
    records.refresh();
    return observeLearningStorage(window, getStorage, records.refresh);
  }, []);
  useEffect(() => {
    if (!saved.dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saved.dirty]);

  function patchLesson(id: string, patch: Partial<LessonProgress>) {
    const lesson = LESSONS.find((candidate) => candidate.id === id);
    if (!lesson) return;
    records.update((current) => {
      const progress = { ...(current.lessons[id] ?? EMPTY_LESSON), ...patch };
      progress.notes = progress.notes.slice(0, 4000);
      if (!canComplete(lesson, progress)) progress.completed = false;
      return { ...current, lessons: { ...current.lessons, [id]: progress } };
    });
  }
  function toggleBookmark(id: string) {
    if (!TERM_IDS.includes(id)) return;
    records.update((current) => ({ ...current, bookmarks: current.bookmarks.includes(id)
      ? current.bookmarks.filter((value) => value !== id) : [...current.bookmarks, id] }));
  }
  return {
    progress: saved.data,
    warning: saved.warning,
    dirty: saved.dirty,
    conflict: saved.conflict,
    revision: saved.revision,
    patchLesson,
    toggleBookmark,
    reset: records.reset,
    retrySave: records.retrySave,
    confirmCurrentRecord: records.confirmCurrentRecord,
    restore: (incoming: LearningProgress) => records.update((current) => mergeLearningBackup(current, incoming)),
  };
}
export type LearningStore = ReturnType<typeof useLearningProgress>;
