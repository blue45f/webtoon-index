import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { hasLearningActivity, MAX_LEARNING_BACKUP_BYTES, mergeLearningBackup, readLearningBackup, summarizeLearningProgress, writeLearningBackup } from "./learning-backup";
import { buildLabLink, LAB_CONFIGS, readLabState } from "./learning-lab-state";
import { EMPTY_LESSON, emptyProgress, STORAGE_KEY, type LearningProgress, type Lesson } from "./learning-model";
import { createLearningProgressStore, observeLearningStorage } from "./learning-storage";

const lessons: Lesson[] = ["first", "second"].map((id) => ({
  id, title: id, summary: "fixture", track: "foundation", minutes: 1, lab: "layers", sections: [], task: "fixture",
  checks: ["첫 번째", "두 번째"], mistake: "fixture", quiz: { question: "fixture", options: ["a", "b", "c"], answer: 1, explanation: "fixture" }, terms: [], sources: [],
}));
const termIds = ["panel", "layer"];
const entry = (notes: string) => ({ ...EMPTY_LESSON, checks: [], notes });
const progressWith = (notes: string): LearningProgress => ({ version: 1, lessons: { first: entry(notes) }, bookmarks: [] });
const read = (raw: string) => readLearningBackup(raw, lessons, termIds);
function memory(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(STORAGE_KEY, initial);
  let denyRead = false;
  let denyWrite = false;
  const storage = {
    getItem(key: string) { if (denyRead) throw new Error("blocked"); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (denyWrite) throw new Error("full"); values.set(key, value); },
  };
  return { storage, values, denyRead: (value: boolean) => { denyRead = value; }, denyWrite: (value: boolean) => { denyWrite = value; } };
}

describe("learning backup validation", () => {
  it("round-trips Korean notes, bookmarks and valid completion", () => {
    const data = progressWith("내가 바꾼 컷의 간격 🖋");
    data.lessons.first = { ...data.lessons.first, checks: [0, 1], answer: 1, completed: true };
    data.bookmarks = ["panel", "layer"];
    const raw = writeLearningBackup(data, lessons, termIds, "2026-09-06T00:00:00Z");
    assert.deepEqual(read(raw).data, data);
    assert.equal(JSON.parse(raw).format, "toonstudio-learning-backup");
  });
  it("accepts an explicitly versioned legacy v1 record and a BOM", () => {
    assert.deepEqual(read("\uFEFF" + JSON.stringify(progressWith("메모"))).data, progressWith("메모"));
  });
  it("rejects non-JSON, wrong roots and unsupported versions", () => {
    for (const raw of ["{", "null", "[]", "{}", '{"version":2,"lessons":{},"bookmarks":[]}', '{"format":"other","version":1,"progress":{}}']) {
      assert.throws(() => read(raw));
    }
  });
  it("rejects a UTF-8 oversized file before parsing", () => {
    assert.throws(() => read("가".repeat(Math.ceil(MAX_LEARNING_BACKUP_BYTES / 3) + 1)), /512/u);
  });
  it("rejects oversized notes rather than silently truncating them", () => {
    assert.throws(() => read(JSON.stringify(progressWith("x".repeat(4001)))));
  });
  it("rejects malformed answers and checklist indexes", () => {
    for (const patch of [{ answer: 99 }, { answer: "1" }, { checks: [-1] }, { checks: [0.5] }, { notes: null }, { completed: "yes" }]) {
      const data = progressWith("keep");
      Object.assign(data.lessons.first, patch);
      assert.throws(() => read(JSON.stringify(data)));
    }
  });
  it("rejects a foreign catalog, but reports ignored entries in a useful backup", () => {
    assert.throws(() => read('{"version":1,"lessons":{"foreign":{}},"bookmarks":[]}'));
    const data = progressWith("keep"); data.bookmarks = ["panel", "foreign"];
    assert.equal(read(JSON.stringify(data)).ignoredEntries, 1);
    assert.deepEqual(read(JSON.stringify(data)).data.bookmarks, ["panel"]);
  });
  it("revalidates forged completion and reports the correction", () => {
    const data = progressWith("keep"); data.lessons.first.completed = true;
    const result = read(JSON.stringify(data));
    assert.equal(result.correctedCompletions, 1);
    assert.equal(result.data.lessons.first.completed, false);
  });
  it("keeps potentially executable markup as inert note text", () => {
    const data = progressWith('<img src=x onerror="alert(1)">');
    assert.equal(read(JSON.stringify(data)).data.lessons.first.notes, data.lessons.first.notes);
  });
  it("ignores prototype keys without changing Object.prototype", () => {
    const result = read('{"version":1,"lessons":{"first":{"checks":[],"answer":null,"notes":"safe","completed":false},"__proto__":{"polluted":true}},"bookmarks":[]}');
    assert.equal(result.ignoredEntries, 1);
    assert.equal(Object.hasOwn(result.data.lessons, "__proto__"), false);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  });
  it("preserves an active local lesson and adds only absent records/bookmarks", () => {
    const current = progressWith("local"); current.bookmarks = ["panel"];
    const incoming = progressWith("incoming"); incoming.lessons.second = entry("new"); incoming.bookmarks = ["panel", "layer"];
    const merged = mergeLearningBackup(current, incoming);
    assert.equal(merged.lessons.first.notes, "local");
    assert.equal(merged.lessons.second.notes, "new");
    assert.deepEqual(merged.bookmarks, ["panel", "layer"]);
    assert.equal(Object.hasOwn(current.lessons, "second"), false);
    merged.lessons.second.checks.push(0);
    assert.deepEqual(incoming.lessons.second.checks, []);
  });
  it("can restore into an empty placeholder and distinguishes whitespace notes from empty notes", () => {
    const current = progressWith("");
    assert.equal(mergeLearningBackup(current, progressWith("restored")).lessons.first.notes, "restored");
    assert.equal(hasLearningActivity(entry(" ")), true);
    assert.equal(hasLearningActivity(undefined), false);
  });
  it("accepts a genuinely empty backup without manufacturing progress", () => {
    assert.deepEqual(read(JSON.stringify(emptyProgress())).data, emptyProgress());
    assert.deepEqual(summarizeLearningProgress(emptyProgress()), { activeLessons: 0, completedLessons: 0, notes: 0, bookmarks: 0 });
  });
});

describe("learning storage resilience", () => {
  it("exposes a cached snapshot and detaches subscribers", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    assert.strictEqual(store.getSnapshot(), store.getSnapshot());
    let calls = 0; const stop = store.subscribe(() => { calls += 1; });
    store.update(() => progressWith("first")); stop(); store.update(() => progressWith("second"));
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().data.lessons.first.notes, "second");
  });
  it("keeps independent rapid updates rather than a captured stale snapshot", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    store.update(() => progressWith("note"));
    store.update((current) => ({ ...current, bookmarks: ["layer"] }));
    assert.equal(store.getSnapshot().data.lessons.first.notes, "note");
    assert.deepEqual(store.getSnapshot().data.bookmarks, ["layer"]);
  });
  it("retains unsaved edits across a write failure and recovers without reload", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); assert.equal(store.update(() => progressWith("unsaved")), false);
    store.update((current) => ({ ...current, bookmarks: ["panel"] }));
    assert.equal(store.getSnapshot().data.lessons.first.notes, "unsaved");
    assert.equal(store.getSnapshot().dirty, true);
    env.denyWrite(false); assert.equal(store.retrySave(), true);
    assert.equal(store.getSnapshot().dirty, false);
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)!).lessons.first.notes, "unsaved");
  });
  it("does not discard dirty notes on another tab's write and does not auto-overwrite it", () => {
    const env = memory(JSON.stringify(progressWith("base"))); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); store.update(() => progressWith("unsaved local")); env.denyWrite(false);
    const remote = JSON.stringify(progressWith("remote")); env.values.set(STORAGE_KEY, remote); store.refresh();
    assert.equal(store.getSnapshot().data.lessons.first.notes, "unsaved local");
    assert.equal(store.getSnapshot().conflict, true);
    assert.equal(store.retrySave(), false);
    assert.equal(env.values.get(STORAGE_KEY), remote);
    store.update((current) => ({ ...current, bookmarks: ["panel"] }));
    assert.equal(env.values.get(STORAGE_KEY), remote);
  });
  it("does not resurrect or discard dirty data when another tab clears storage", () => {
    const env = memory(JSON.stringify(progressWith("base"))); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); store.update(() => progressWith("local")); env.denyWrite(false); env.values.delete(STORAGE_KEY); store.refresh();
    assert.equal(store.getSnapshot().data.lessons.first.notes, "local");
    assert.equal(store.getSnapshot().conflict, true);
    assert.equal(env.values.has(STORAGE_KEY), false);
  });
  it("requires a current confirmation and rejects newly changed external storage", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); store.update(() => progressWith("local")); env.denyWrite(false);
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("remote"))); store.refresh();
    const revision = store.getSnapshot().revision;
    assert.equal(store.confirmCurrentRecord(revision - 1), false);
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("remote again")));
    assert.equal(store.confirmCurrentRecord(revision), false);
    assert.equal(store.confirmCurrentRecord(store.getSnapshot().revision), true);
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)!).lessons.first.notes, "local");
  });
  it("invalidates a confirmation even when another conflict event is received before the click", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); store.update(() => progressWith("local")); env.denyWrite(false);
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("remote"))); store.refresh(); const revision = store.getSnapshot().revision;
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("new remote"))); store.refresh();
    assert.equal(store.confirmCurrentRecord(revision), false);
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)!).lessons.first.notes, "new remote");
  });
  it("adopts other-tab changes when no local data is dirty", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("remote"))); store.refresh();
    assert.equal(store.getSnapshot().data.lessons.first.notes, "remote");
    env.values.delete(STORAGE_KEY); store.refresh(); assert.deepEqual(store.getSnapshot().data, emptyProgress());
  });
  it("reset clears only this key and still indicates a failed reset write", () => {
    const env = memory(JSON.stringify(progressWith("base"))); env.values.set("other-app-key", "keep");
    const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.denyWrite(true); assert.equal(store.reset(), false); assert.equal(store.getSnapshot().dirty, true);
    assert.equal(env.values.get("other-app-key"), "keep");
    env.denyWrite(false); assert.equal(store.retrySave(), true); assert.deepEqual(JSON.parse(env.values.get(STORAGE_KEY)!), emptyProgress());
  });
  it("survives blocked reads, missing storage and malformed JSON", () => {
    const absent = createLearningProgressStore(() => null, lessons, termIds);
    assert.equal(absent.update(() => progressWith("memory")), false);
    assert.equal(absent.getSnapshot().data.lessons.first.notes, "memory");
    const env = memory("{bad-json"); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    assert.deepEqual(store.getSnapshot().data, emptyProgress());
    store.update(() => progressWith("kept")); env.denyRead(true); store.refresh();
    assert.equal(store.getSnapshot().data.lessons.first.notes, "kept");
    assert.ok(store.getSnapshot().warning);
  });
  it("revalidates completion and notes at the write boundary", () => {
    const env = memory(); const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    store.update(() => ({ ...progressWith("x".repeat(5000)), lessons: { first: { ...entry("x".repeat(5000)), completed: true } } }));
    assert.equal(store.getSnapshot().data.lessons.first.notes.length, 4000);
    assert.equal(store.getSnapshot().data.lessons.first.completed, false);
  });
});


describe("shareable lab state", () => {
  it("restores a paused snapshot with the same parameter, stage and comparison", () => {
    const path = buildLabLink("/learn/lessons/color-layers", "layers", { value: 72, frame: 200, view: "reference" });
    assert.deepEqual(readLabState("layers", path.slice(path.indexOf("?"))), { value: 72, frame: 200, view: "reference" });
  });
  it("uses a readable single comparison on narrow screens without overriding an explicit shared view", () => {
    assert.equal(readLabState("layers", "", true).view, "comparison");
    assert.equal(readLabState("layers", "?labView=both", true).view, "both");
    assert.equal(readLabState("layers", "", false).view, "both");
  });
  it("does not crop a one-point-perspective or lettering diagram", () => {
    for (const kind of ["perspective", "lettering"] as const) {
      assert.equal(readLabState(kind, "?labView=reference", true).view, "both");
    }
  });
  it("clamps valid numeric outliers and ignores malformed numeric strings", () => {
    assert.deepEqual(readLabState("layers", "?labValue=999&labFrame=-100"), { value: 100, frame: 0, view: "both" });
    for (const input of ["Infinity", "NaN", "0x10", "1e9", "", " ", "9".repeat(50)]) {
      assert.equal(readLabState("layers", `?labValue=${encodeURIComponent(input)}`).value, 55);
    }
    assert.equal(readLabState("layers", "?labValue=70.6&labFrame=999").value, 71);
    assert.equal(readLabState("layers", "?labFrame=999").frame, 299);
  });
  it("drops non-public query data rather than placing personal notes into a link", () => {
    const state = readLabState("layers", "?notes=private&token=secret&labValue=80&saved=1");
    const path = buildLabLink("/learn/lessons/color-layers/", "layers", state);
    assert.equal(path.includes("private"), false);
    assert.equal(path.includes("secret"), false);
    assert.equal(path.includes("saved"), false);
    assert.equal(path.startsWith("/learn/lessons/color-layers?"), true);
  });
  it("rejects foreign paths and script-like URLs", () => {
    const state = readLabState("layers", "");
    for (const path of ["https://example.com", "//example.com", "javascript:alert(1)", "/studio", "/learn/lessons/../records"]) {
      assert.throws(() => buildLabLink(path, "layers", state));
    }
  });
  it("has valid controls and exactly three explanation stages for all six lab kinds", () => {
    assert.equal(Object.keys(LAB_CONFIGS).length, 6);
    for (const config of Object.values(LAB_CONFIGS)) {
      assert.ok(config.initial >= config.min && config.initial <= config.max);
      assert.equal(config.stages.length, 3);
    }
  });
});


describe("storage read and event boundaries", () => {
  it("does not overwrite storage when a read failed even if writes would succeed", () => {
    const env = memory(JSON.stringify(progressWith("base")));
    const store = createLearningProgressStore(() => env.storage, lessons, termIds);
    env.values.set(STORAGE_KEY, JSON.stringify(progressWith("unseen remote")));
    env.denyRead(true);
    assert.equal(store.update(() => progressWith("unsaved local")), false);
    assert.equal(store.getSnapshot().data.lessons.first.notes, "unsaved local");
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)!).lessons.first.notes, "unseen remote");
    assert.equal(store.retrySave(), false);
  });
  it("filters storage areas and keys and removes its listener on cleanup", () => {
    let listener: ((event: Pick<StorageEvent, "key" | "storageArea">) => void) | undefined;
    const local = memory().storage as Storage;
    const session = memory().storage as Storage;
    let refreshed = 0;
    const target = {
      addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
      removeEventListener: (_: string, callback: typeof listener) => { assert.equal(callback, listener); listener = undefined; },
    } as unknown as Window;
    const stop = observeLearningStorage(target, () => local, () => { refreshed += 1; });
    listener!({ key: STORAGE_KEY, storageArea: session });
    listener!({ key: null, storageArea: session });
    listener!({ key: "another-key", storageArea: local });
    assert.equal(refreshed, 0);
    listener!({ key: STORAGE_KEY, storageArea: local });
    listener!({ key: null, storageArea: local });
    assert.equal(refreshed, 2);
    stop(); assert.equal(listener, undefined);
  });
});
