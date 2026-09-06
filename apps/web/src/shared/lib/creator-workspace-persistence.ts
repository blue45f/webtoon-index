import { mergeCreatorWorkspaces } from "./creator-resource-workflow";
import { parseWorkspace, recordOf, STORY_FIELDS, STORY_LABELS } from "./creator-resources";

import type { CreatorWorkspace, StoryField } from "./creator-resources";

export const CREATOR_WORKSPACE_KEY = "toonstudio.creator-resources.v1";
export const CREATOR_WORKSPACE_EVENT = "toonstudio:creator-resources";
export const CREATOR_STORY_DRAFT_KEY = "toonstudio.creator-story-draft.v1";
export type WorkspaceLock = <T>(operation: () => T) => Promise<T>;
export interface StoryDraft {
  version: 1;
  base: Record<string, string>;
  story: Record<string, string>;
}
export class WorkspaceConflictError extends Error {
  constructor(readonly fields: readonly StoryField[] = []) {
    super(fields.length
      ? `다른 탭에서 같은 항목을 수정했습니다: ${fields.map((field) => STORY_LABELS[field]).join(", ")}. 초안을 내보내거나 저장된 내용을 확인한 뒤 다시 편집하세요.`
      : "다른 탭에서 보드가 변경되었습니다. 최신 내용을 확인하고 다시 시도하세요.");
  }
}
function normalizedStory(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("기획서 형식을 확인할 수 없습니다.");
  const record = recordOf(value);
  const output: Record<string, string> = {};
  for (const field of STORY_FIELDS) {
    const entry = record[field];
    if (entry !== undefined && (typeof entry !== "string" || entry.length > 2000)) throw new Error("기획 항목은 2,000자 이내의 텍스트여야 합니다.");
    output[field] = typeof entry === "string" ? entry : "";
  }
  return output;
}
export function createStoryDraft(base: Record<string, string>, story = base): StoryDraft {
  return { version: 1, base: normalizedStory(base), story: normalizedStory(story) };
}
export function parseStoryDraft(raw: string | null): StoryDraft | null {
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > 256000) throw new Error("임시 초안의 크기 제한을 초과했습니다.");
  const data = recordOf(JSON.parse(raw));
  if (data.version !== 1) throw new Error("지원하지 않는 임시 초안 형식입니다.");
  return { version: 1, base: normalizedStory(data.base), story: normalizedStory(data.story) };
}
export function changedStoryFields(draft: StoryDraft): StoryField[] {
  return STORY_FIELDS.filter((field) => (draft.base[field] ?? "") !== (draft.story[field] ?? ""));
}
/** Preserve edits but show the newest value for untouched fields. */
export function storyDraftView(current: Record<string, string>, draft: StoryDraft | null): Record<string, string> {
  const story = normalizedStory(current);
  if (draft) for (const field of changedStoryFields(draft)) story[field] = draft.story[field];
  return story;
}
export function editStoryDraft(draft: StoryDraft | null, current: Record<string, string>, field: StoryField, value: string): StoryDraft {
  if (!STORY_FIELDS.includes(field) || value.length > 2000) throw new Error("유효하지 않은 기획 항목입니다.");
  const next = draft ? createStoryDraft(draft.base, draft.story) : createStoryDraft(current);
  // Start an untouched field against its current saved value, not an old tab snapshot.
  if (!changedStoryFields(next).includes(field)) next.base[field] = current[field] ?? "";
  next.story[field] = value;
  return next;
}
export function storyDraftConflicts(current: Record<string, string>, draft: StoryDraft): StoryField[] {
  return changedStoryFields(draft).filter((field) => {
    const saved = current[field] ?? "";
    return saved !== draft.base[field] && saved !== draft.story[field];
  });
}
/** Explicit user choice rebases one field only; another later edit will conflict again. */
export function resolveStoryConflict(draft: StoryDraft, current: Record<string, string>, field: StoryField, choice: "saved" | "draft"): StoryDraft {
  if (!STORY_FIELDS.includes(field)) throw new Error("유효하지 않은 기획 항목입니다.");
  const next = createStoryDraft(draft.base, draft.story);
  next.base[field] = current[field] ?? "";
  if (choice === "saved") next.story[field] = current[field] ?? "";
  return next;
}
/** Three-way field merge: different fields merge, conflicting fields never silently overwrite. */
export function applyStoryDraft(current: CreatorWorkspace, input: StoryDraft): CreatorWorkspace {
  const draft = createStoryDraft(input.base, input.story);
  const fields = changedStoryFields(draft);
  const conflicts = storyDraftConflicts(current.story, draft);
  if (conflicts.length) throw new WorkspaceConflictError(conflicts);
  const story = { ...current.story };
  for (const field of fields) story[field] = draft.story[field];
  return { ...current, story };
}
export function workspaceWriteError(error: unknown): string {
  if (error instanceof WorkspaceConflictError) return error.message;
  if (error instanceof Error && error.name === "QuotaExceededError") return "브라우저 저장 공간이 부족합니다. 현재 초안을 내보내고 공간을 확보하세요.";
  if (error instanceof Error && error.name === "AbortError") return "다른 탭의 저장이 끝나지 않았습니다. 작업은 덮어쓰지 않았으니 다시 저장하세요.";
  if (error instanceof Error && error.name === "SecurityError") return "브라우저가 저장소 접근을 차단했습니다. 현재 초안을 파일로 내보내세요.";
  return error instanceof Error ? error.message : "저장하지 못했습니다. 현재 초안을 내보내세요.";
}
/** Cooperating tabs share this lock. Unsupported contexts are read/export-only, never race-prone writers. */
export function browserWorkspaceLock(manager: LockManager | undefined, timeoutMs = 4000): WorkspaceLock | undefined {
  if (!manager?.request) return undefined;
  return async <T>(operation: () => T): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await manager.request(`${CREATOR_WORKSPACE_KEY}:write`, { mode: "exclusive", signal: controller.signal }, operation);
    } finally { clearTimeout(timer); }
  };
}
export function createCreatorWorkspaceStorage(options: {
  storage: () => Pick<Storage, "getItem" | "setItem">;
  withLock?: WorkspaceLock;
  notify?: () => void;
}) {
  const readRaw = () => options.storage().getItem(CREATOR_WORKSPACE_KEY);
  async function transaction(change: (raw: string | null) => CreatorWorkspace): Promise<CreatorWorkspace> {
    if (!options.withLock) throw new Error("안전한 동시 저장을 지원하지 않는 브라우저입니다. HTTPS 환경의 최신 브라우저에서 저장하거나 파일로 내보내세요.");
    const next = await options.withLock(() => {
      const storage = options.storage();
      const before = storage.getItem(CREATOR_WORKSPACE_KEY);
      // No await inside the read/validate/write critical section.
      const normalized = parseWorkspace(JSON.stringify(change(before)));
      const serialized = JSON.stringify(normalized);
      if (storage.getItem(CREATOR_WORKSPACE_KEY) !== before) throw new WorkspaceConflictError();
      if (serialized !== before) storage.setItem(CREATOR_WORKSPACE_KEY, serialized);
      return normalized;
    });
    // Notifications cannot turn a successful storage commit into a reported failure.
    try { options.notify?.(); } catch { /* Persistence already succeeded. */ }
    return next;
  }
  return {
    readRaw,
    read: () => parseWorkspace(readRaw()),
    update: (change: (value: CreatorWorkspace) => CreatorWorkspace) => transaction((raw) => change(parseWorkspace(raw))),
    saveStory: (draft: StoryDraft) => transaction((raw) => applyStoryDraft(parseWorkspace(raw), draft)),
    restore: (raw: string, mode: "merge" | "replace", expectedRaw?: string | null) => {
      const incoming = parseWorkspace(raw);
      return transaction((currentRaw) => {
        if (mode === "replace") {
          if (expectedRaw === undefined || expectedRaw !== currentRaw) throw new WorkspaceConflictError();
          return incoming;
        }
        return mergeCreatorWorkspaces(parseWorkspace(currentRaw), incoming);
      });
    },
  };
}
