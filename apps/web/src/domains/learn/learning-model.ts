export type LabKind = "pacing" | "perspective" | "strokes" | "layers" | "lettering" | "values";
export type Track = "foundation" | "studio";
export interface Lesson {
  id: string;
  title: string;
  summary: string;
  track: Track;
  minutes: number;
  lab: LabKind;
  sections: readonly { title: string; text: string }[];
  task: string;
  checks: readonly string[];
  mistake: string;
  quiz: { question: string; options: readonly string[]; answer: number; explanation: string };
  terms: readonly string[];
  sources: readonly string[];
}
export interface GlossaryTerm {
  id: string;
  name: string;
  english: string;
  aliases: readonly string[];
  category: string;
  definition: string;
  example: string;
  caution: string;
  lesson: string;
}
export interface LessonProgress {
  checks: number[];
  answer: number | null;
  notes: string;
  completed: boolean;
}
export interface LearningProgress {
  version: 1;
  lessons: Record<string, LessonProgress>;
  bookmarks: string[];
}
export const STORAGE_KEY = "toonstudio:learning:v1";
export const EMPTY_LESSON: LessonProgress = { checks: [], answer: null, notes: "", completed: false };
export function emptyProgress(): LearningProgress {
  return { version: 1, lessons: {}, bookmarks: [] };
}
export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
export function normalizeSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, "");
}
export function matchesSearch(query: string, values: readonly string[]): boolean {
  const needle = normalizeSearch(query.trim().slice(0, 200));
  return !needle || values.some((value) => normalizeSearch(value).includes(needle));
}
export function canComplete(lesson: Lesson, progress: LessonProgress): boolean {
  return progress.answer === lesson.quiz.answer && lesson.checks.every((_, index) => progress.checks.includes(index));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Treat browser storage as untrusted input. Completion is revalidated, never trusted. */
export function parseProgress(raw: string | null, lessons: readonly Lesson[], termIds: readonly string[]): LearningProgress {
  if (!raw || raw.length > 200_000) return emptyProgress();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return emptyProgress(); }
  if (!isRecord(value) || value.version !== 1) return emptyProgress();
  const result = emptyProgress();
  if (Array.isArray(value.bookmarks)) {
    result.bookmarks = [...new Set(value.bookmarks.filter((id): id is string => typeof id === "string" && termIds.includes(id)))];
  }
  if (!isRecord(value.lessons)) return result;
  for (const lesson of lessons) {
    const item = value.lessons[lesson.id];
    if (!isRecord(item)) continue;
    const checks = Array.isArray(item.checks)
      ? [...new Set(item.checks.filter((index): index is number => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < lesson.checks.length))]
      : [];
    const answer = typeof item.answer === "number" && Number.isInteger(item.answer) && item.answer >= 0 && item.answer < lesson.quiz.options.length ? item.answer : null;
    const progress: LessonProgress = { checks, answer, notes: typeof item.notes === "string" ? item.notes.slice(0, 4000) : "", completed: false };
    progress.completed = item.completed === true && canComplete(lesson, progress);
    result.lessons[lesson.id] = progress;
  }
  return result;
}
export interface TimelineState { frame: number; playing: boolean }
export type TimelineAction = { type: "toggle" } | { type: "pause" } | { type: "seek"; frame: number } | { type: "tick"; delta: number };
export const LAST_FRAME = 299;
export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  if (action.type === "pause") return { ...state, playing: false };
  if (action.type === "toggle") return { frame: state.frame >= LAST_FRAME ? 0 : state.frame, playing: !state.playing };
  if (action.type === "seek") return { frame: clamp(action.frame, 0, LAST_FRAME), playing: false };
  const frame = clamp(state.frame + clamp(action.delta, 0, 15), 0, LAST_FRAME);
  return state.playing ? { frame, playing: frame < LAST_FRAME } : state;
}
/** Linear interpolation along a depth ray, used by the one-point-perspective diagram. */
export function depthPoint(x: number, y: number, vanishingX: number, vanishingY: number, depth: number): [number, number] {
  const t = clamp(depth, 0, 1);
  return [x + (vanishingX - x) * t, y + (vanishingY - y) * t];
}
