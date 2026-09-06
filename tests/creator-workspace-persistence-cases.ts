import { emptyWorkspace } from "../apps/web/src/shared/lib/creator-resources";
import {
  applyStoryDraft, browserWorkspaceLock, changedStoryFields, createCreatorWorkspaceStorage,
  createStoryDraft, editStoryDraft, parseStoryDraft, resolveStoryConflict,
  storyDraftConflicts, storyDraftView, WorkspaceConflictError, workspaceWriteError,
} from "../apps/web/src/shared/lib/creator-workspace-persistence";

import type { CreatorResourceCase } from "./creator-resources-cases";
import type { WorkspaceLock } from "../apps/web/src/shared/lib/creator-workspace-persistence";

function ok(value: unknown): asserts value { if (!value) throw new Error("Assertion failed"); }
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function rejects(operation: () => unknown, type: new (...args: never[]) => Error = Error) {
  let error: unknown;
  try { await operation(); } catch (cause) { error = cause; }
  ok(error instanceof type);
}
function mutex(): WorkspaceLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => T): Promise<T> => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };
}
function fixture(initial: string | null = null) {
  let raw = initial;
  let writes = 0;
  let notifications = 0;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; writes += 1; } };
  const withLock = mutex();
  const options = { storage: () => storage, withLock, notify: () => { notifications += 1; } };
  return { options, api: createCreatorWorkspaceStorage(options), raw: () => raw, writeCount: () => writes, noticeCount: () => notifications };
}
const baseline = { ...emptyWorkspace(), story: { title: "기존 제목", protagonist: "주인공" } };
export const creatorWorkspacePersistenceCases: CreatorResourceCase[] = [
  { name: "workspace serializes 50 queued mutations without losing checks", async run() {
    const { api } = fixture();
    await Promise.all(Array.from({ length: 50 }, (_, id) => api.update((value) => ({ ...value, checks: [...value.checks, `check-${id}`] }))));
    equal(api.read().checks.length, 50); equal(new Set(api.read().checks).size, 50);
  } },
  { name: "independent store instances coordinate through the same lock", async run() {
    const f = fixture(); const second = createCreatorWorkspaceStorage(f.options);
    await Promise.all([f.api.update((value) => ({ ...value, checks: [...value.checks, "first"] })), second.update((value) => ({ ...value, checks: [...value.checks, "second"] }))]);
    equal(second.read().checks, ["first", "second"]);
  } },
  { name: "corrupted shared data is never overwritten by normal mutations", async run() {
    const f = fixture("{broken"); await rejects(() => f.api.update(() => emptyWorkspace())); equal(f.raw(), "{broken"); equal(f.writeCount(), 0);
  } },
  { name: "explicit snapshot-checked replacement can recover corrupted data", async run() {
    const f = fixture("{broken"); await f.api.restore(JSON.stringify(baseline), "replace", "{broken"); equal(f.api.read().story.title, "기존 제목");
  } },
  { name: "replacement requires a snapshot and rejects stale confirmation", async run() {
    const f = fixture(); const expected = f.api.readRaw();
    await f.api.update(() => baseline);
    const before = f.raw();
    await rejects(() => f.api.restore(JSON.stringify(emptyWorkspace()), "replace"), WorkspaceConflictError);
    await rejects(() => f.api.restore(JSON.stringify(emptyWorkspace()), "replace", expected), WorkspaceConflictError);
    equal(f.raw(), before);
  } },
  { name: "merge executes against the latest saved content inside the lock", async run() {
    const { api } = fixture();
    const first = api.update(() => baseline);
    const next = api.restore(JSON.stringify({ ...emptyWorkspace(), checks: ["imported"], story: { title: "백업", world: "새 세계" } }), "merge");
    await Promise.all([first, next]); equal(api.read().story.title, "기존 제목"); equal(api.read().story.world, "새 세계"); equal(api.read().checks, ["imported"]);
  } },
  { name: "unsupported lock environments remain readable but refuse unsafe writes", async run() {
    let wrote = false;
    const api = createCreatorWorkspaceStorage({ storage: () => ({ getItem: () => JSON.stringify(baseline), setItem: () => { wrote = true; } }) });
    equal(api.read().story.title, "기존 제목"); await rejects(() => api.update(() => emptyWorkspace())); equal(wrote, false);
  } },
  { name: "quota errors preserve previous data and do not broadcast success", async run() {
    let notices = 0; const initial = JSON.stringify(baseline);
    const api = createCreatorWorkspaceStorage({ withLock: mutex(), storage: () => ({ getItem: () => initial, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } }), notify: () => { notices += 1; } });
    await rejects(() => api.update(() => emptyWorkspace())); equal(api.readRaw(), initial); equal(notices, 0);
  } },
  { name: "blocked localStorage getter rejects without creating an empty replacement", async run() {
    const api = createCreatorWorkspaceStorage({ withLock: mutex(), storage: () => { throw new DOMException("blocked", "SecurityError"); } });
    await rejects(() => api.update(() => emptyWorkspace()));
  } },
  { name: "notification errors cannot turn a successful commit into failure", async run() {
    const f = fixture(); const api = createCreatorWorkspaceStorage({ ...f.options, notify: () => { throw new Error("listener failed"); } });
    await api.update(() => baseline); equal(api.read().story.title, "기존 제목");
  } },
  { name: "an oversized transaction leaves all existing records intact", async run() {
    const f = fixture(JSON.stringify(baseline));
    await rejects(() => f.api.update((value) => ({ ...value, checks: Array.from({ length: 201 }, (_, id) => `item-${id}`) })));
    equal(f.raw(), JSON.stringify(baseline)); equal(f.writeCount(), 0);
  } },
  { name: "unchanged normalized data does not write again", async run() {
    const f = fixture(); await f.api.update(() => baseline); const count = f.writeCount(); await f.api.update((value) => value); equal(f.writeCount(), count);
  } },
  { name: "legacy reentrant writes are detected before overwrite", async run() {
    const f = fixture();
    await rejects(() => f.api.update((value) => { f.options.storage().setItem("", JSON.stringify(baseline)); return value; }), WorkspaceConflictError);
    equal(f.api.read().story.title, "기존 제목");
  } },
  { name: "session draft roundtrip preserves Korean, newlines and trailing whitespace", run() {
    const draft = createStoryDraft({}, { title: "제목 ", protagonist: "김 작가\n😀 " });
    const recovered = parseStoryDraft(JSON.stringify(draft)); equal(recovered, draft); equal(parseStoryDraft(null), null);
  } },
  { name: "invalid or oversized recovery data fails instead of silent truncation", async run() {
    for (const raw of ["", "{", JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, base: [], story: {} }), JSON.stringify({ version: 1, base: {}, story: { title: 1 } }), JSON.stringify({ version: 1, base: {}, story: { title: "x".repeat(2001) } }), " ".repeat(256001)]) await rejects(() => parseStoryDraft(raw));
  } },
  { name: "draft normalization ignores unknown prototype fields", run() {
    const raw = '{"version":1,"base":{},"story":{"title":"안전","__proto__":{"polluted":true}}}';
    const draft = parseStoryDraft(raw); ok(draft); equal(draft.story.title, "안전"); equal(draft.story.polluted, undefined); equal(Object.keys(draft.story).length, 8);
  } },
  { name: "different story fields merge across concurrent tabs", async run() {
    const f = fixture(JSON.stringify(baseline));
    const left = editStoryDraft(null, baseline.story, "title", "왼쪽 제목");
    const right = editStoryDraft(null, baseline.story, "world", "오른쪽 세계");
    await Promise.all([f.api.saveStory(left), f.api.saveStory(right)]);
    equal(f.api.read().story.title, "왼쪽 제목"); equal(f.api.read().story.world, "오른쪽 세계");
  } },
  { name: "same-field story conflict rejects the entire patch atomically", async run() {
    const f = fixture(JSON.stringify(baseline));
    const left = editStoryDraft(null, baseline.story, "title", "다른 탭 제목");
    let right = editStoryDraft(null, baseline.story, "title", "내 제목"); right = editStoryDraft(right, baseline.story, "world", "부분 저장 금지");
    await f.api.saveStory(left); const before = f.raw(); await rejects(() => f.api.saveStory(right), WorkspaceConflictError);
    equal(f.raw(), before); equal(f.api.read().story.world, ""); equal(storyDraftConflicts(f.api.read().story, right), ["title"]);
  } },
  { name: "same desired story value is idempotent, not a conflict", async run() {
    const f = fixture(JSON.stringify(baseline)); const draft = editStoryDraft(null, baseline.story, "title", "같은 변경");
    await f.api.saveStory(draft); await f.api.saveStory(draft); equal(f.api.read().story.title, "같은 변경");
  } },
  { name: "explicit saved choice discards only the selected conflicting field", run() {
    const draft = createStoryDraft(baseline.story, { ...baseline.story, title: "내 제목", world: "새 세계" });
    const current = { ...baseline.story, title: "저장 제목" };
    const resolved = resolveStoryConflict(draft, current, "title", "saved");
    equal(changedStoryFields(resolved), ["world"]); equal(storyDraftView(current, resolved).title, "저장 제목");
  } },
  { name: "explicit draft choice preserves other newer fields", run() {
    const draft = editStoryDraft(null, baseline.story, "title", "내 제목");
    const current = { ...baseline, story: { ...baseline.story, title: "저장 제목", world: "별도 변경" } };
    const resolved = resolveStoryConflict(draft, current.story, "title", "draft");
    const result = applyStoryDraft(current, resolved); equal(result.story.title, "내 제목"); equal(result.story.world, "별도 변경");
  } },
  { name: "a later edit conflicts again after user resolution", async run() {
    const draft = editStoryDraft(null, baseline.story, "title", "내 제목");
    const resolved = resolveStoryConflict(draft, { ...baseline.story, title: "검토한 제목" }, "title", "draft");
    await rejects(() => applyStoryDraft({ ...baseline, story: { title: "그 후의 변경" } }, resolved), WorkspaceConflictError);
  } },
  { name: "untouched fields display live values while own edits remain visible", run() {
    const draft = editStoryDraft(null, baseline.story, "title", "내 제목");
    equal(storyDraftView({ ...baseline.story, world: "최신 세계" }, draft).world, "최신 세계");
    equal(storyDraftView({ ...baseline.story, title: "외부 제목" }, draft).title, "내 제목");
  } },
  { name: "starting a new field edit records its current saved baseline", run() {
    const draft = editStoryDraft(null, baseline.story, "title", "내 제목");
    const current = { ...baseline.story, world: "다른 탭 세계" };
    const edited = editStoryDraft(draft, current, "world", "내 세계"); equal(edited.base.world, "다른 탭 세계"); equal(storyDraftConflicts(current, edited), []);
  } },
  { name: "intentional deletion and Korean spaces are preserved in story patches", run() {
    const draft = editStoryDraft(null, baseline.story, "title", ""); equal(applyStoryDraft(baseline, draft).story.title, "");
    const spaces = editStoryDraft(null, baseline.story, "title", "새 제목 "); equal(applyStoryDraft(baseline, spaces).story.title, "새 제목 ");
  } },
  { name: "draft helpers do not mutate source state", run() {
    const frozen = Object.freeze({ ...baseline.story }); const draft = createStoryDraft(frozen); const before = JSON.stringify(draft);
    editStoryDraft(draft, frozen, "title", "변경"); equal(JSON.stringify(draft), before); equal(frozen.title, "기존 제목");
  } },
  { name: "browser lock absence is explicit and errors are actionable", run() {
    equal(browserWorkspaceLock(undefined), undefined); ok(workspaceWriteError(new DOMException("full", "QuotaExceededError")).includes("공간"));
    ok(workspaceWriteError(new DOMException("denied", "SecurityError")).includes("차단")); ok(workspaceWriteError(new DOMException("aborted", "AbortError")).includes("다른 탭"));
  } },
];
