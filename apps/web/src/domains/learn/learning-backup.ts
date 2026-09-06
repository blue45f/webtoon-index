import { parseProgress, type LearningProgress, type Lesson, type LessonProgress } from "./learning-model";

export const MAX_LEARNING_BACKUP_BYTES = 512 * 1024;
const FORMAT = "toonstudio-learning-backup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BackupPreview {
  data: LearningProgress;
  ignoredEntries: number;
  correctedCompletions: number;
}

/** Imported files are strict; a wrong file must never silently become an empty progress record. */
export function readLearningBackup(
  raw: string,
  lessons: readonly Lesson[],
  termIds: readonly string[],
): BackupPreview {
  if (new TextEncoder().encode(raw).byteLength > MAX_LEARNING_BACKUP_BYTES) {
    throw new Error("백업 파일은 512 KiB 이하여야 합니다.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/u, "")); }
  catch { throw new Error("JSON 형식의 학습 백업 파일을 선택해 주세요."); }
  if (!isRecord(parsed)) throw new Error("학습 백업 파일이 아닙니다.");
  let payload: unknown = parsed;
  if ("format" in parsed) {
    if (parsed.format !== FORMAT || parsed.version !== 1) {
      throw new Error("지원하지 않는 백업 형식 또는 버전입니다. 기존 기록은 변경하지 않았습니다.");
    }
    payload = parsed.progress;
  }
  if (!isRecord(payload) || payload.version !== 1 || !isRecord(payload.lessons) || !Array.isArray(payload.bookmarks)) {
    throw new Error("강좌 기록과 북마크가 포함된 버전 1 백업이 필요합니다.");
  }
  const storedLessons = payload.lessons;
  const lessonIds = lessons.map((lesson) => lesson.id);
  let ignoredEntries = Object.keys(storedLessons).filter((id) => !lessonIds.includes(id)).length;
  for (const id of payload.bookmarks) {
    if (typeof id !== "string") throw new Error("북마크 형식이 올바르지 않습니다.");
    if (!termIds.includes(id)) ignoredEntries += 1;
  }
  for (const lesson of lessons) {
    const item = storedLessons[lesson.id];
    if (item === undefined) continue;
    if (!isRecord(item) || !Array.isArray(item.checks) || typeof item.notes !== "string" || item.notes.length > 4000 || typeof item.completed !== "boolean") {
      throw new Error(`‘${lesson.title}’의 기록 형식이 올바르지 않습니다.`);
    }
    if (!item.checks.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < lesson.checks.length)) {
      throw new Error(`‘${lesson.title}’의 체크리스트 값이 올바르지 않습니다.`);
    }
    if (item.answer !== null && !(typeof item.answer === "number" && Number.isInteger(item.answer) && item.answer >= 0 && item.answer < lesson.quiz.options.length)) {
      throw new Error(`‘${lesson.title}’의 퀴즈 답안이 올바르지 않습니다.`);
    }
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > 200_000) throw new Error("백업의 기록 데이터가 너무 큽니다.");
  const data = parseProgress(serialized, lessons, termIds);
  const correctedCompletions = lessons.filter((lesson) => {
    const item = storedLessons[lesson.id];
    return isRecord(item) && item.completed === true && data.lessons[lesson.id]?.completed !== true;
  }).length;
  if (ignoredEntries && !Object.keys(data.lessons).length && !data.bookmarks.length) {
    throw new Error("현재 강좌 또는 용어와 일치하는 기록이 없습니다.");
  }
  return { data, ignoredEntries, correctedCompletions };
}

export function writeLearningBackup(
  progress: LearningProgress,
  lessons: readonly Lesson[],
  termIds: readonly string[],
  exportedAt: string,
): string {
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    exportedAt,
    progress: parseProgress(JSON.stringify(progress), lessons, termIds),
  }, null, 2);
}

export function hasLearningActivity(progress: LessonProgress | undefined): boolean {
  return Boolean(progress && (progress.notes.length || progress.checks.length || progress.answer !== null || progress.completed));
}

/** Conservative import: keep an active local lesson as a whole; never splice or truncate notes. */
export function mergeLearningBackup(current: LearningProgress, incoming: LearningProgress): LearningProgress {
  const lessons = { ...current.lessons };
  for (const [id, progress] of Object.entries(incoming.lessons)) {
    if (!hasLearningActivity(lessons[id])) {
      lessons[id] = { ...progress, checks: [...progress.checks] };
    }
  }
  return { version: 1, lessons, bookmarks: [...new Set([...current.bookmarks, ...incoming.bookmarks])] };
}

export function summarizeLearningProgress(progress: LearningProgress) {
  const records = Object.values(progress.lessons);
  return {
    activeLessons: records.filter(hasLearningActivity).length,
    completedLessons: records.filter((record) => record.completed).length,
    notes: records.filter((record) => record.notes.length > 0).length,
    bookmarks: progress.bookmarks.length,
  };
}
