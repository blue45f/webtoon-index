import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createMusicRecovery, type MusicRecoveryPort } from "./studio-music-recovery";

import type { LocalMusicTrack } from "./studio-music-client";

function track(id = "one", ownerId = "owner-a"): LocalMusicTrack {
  return { ownerId, audio: new Blob(["ID3test-audio"], { type: "audio/mpeg" }), metadata: {
    id, createdAt: "2026-09-06T01:00:00Z", provider: "elevenlabs", model: "music_v1", format: "mp3_44100_128", termsUrl: "",
    brief: { title: id, scene: "재회의 장면", mood: "romance", purpose: "bgm", seconds: 30, bpm: 78, instruments: ["piano"], vocals: false, lyrics: "", loop: false, workId: "", rightsConfirmed: true },
  } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<MusicRecoveryPort> = {}) {
  const saved: LocalMusicTrack[] = [];
  const removed: string[] = [];
  let loads = 0;
  const port: MusicRecoveryPort = {
    load: async () => { loads += 1; return [...saved]; },
    save: async (value) => { saved.push(value); },
    remove: async (id) => { removed.push(id); },
    ...overrides,
  };
  return { recovery: createMusicRecovery("owner-a", port), saved, removed, loads: () => loads };
}

describe("music output recovery without paid regeneration", () => {
  it("caches snapshots and releases subscriptions", () => {
    const { recovery } = setup();
    const before = recovery.getSnapshot();
    assert.equal(recovery.getSnapshot(), before);
    let notifications = 0;
    const unsubscribe = recovery.subscribe(() => { notifications += 1; });
    recovery.retain(track());
    assert.notEqual(recovery.getSnapshot(), before);
    assert.equal(notifications, 1);
    unsubscribe(); recovery.retain(track("two"));
    assert.equal(notifications, 1);
  });
  it("retains the exact audio Blob and copies editable metadata", () => {
    const { recovery } = setup();
    const original = track(); recovery.retain(original);
    original.metadata.brief.title = "later edit";
    original.metadata.brief.instruments.push("strings");
    const retained = recovery.getSnapshot().tracks[0];
    assert.equal(retained.audio, original.audio);
    assert.equal(retained.metadata.brief.title, "one");
    assert.deepEqual(retained.metadata.brief.instruments, ["piano"]);
  });
  it("retries only local saving after failure and keeps the original audio", async () => {
    let attempts = 0;
    const original = track();
    const { recovery } = setup({ save: async (value) => {
      assert.equal(value.audio, original.audio);
      if (++attempts === 1) throw new Error("disk full");
    } });
    recovery.retain(original);
    await assert.rejects(recovery.save("one"), /disk full/);
    assert.equal(recovery.getSnapshot().tracks[0].audio, original.audio);
    assert.deepEqual(recovery.getSnapshot().savedIds, []);
    assert.deepEqual(recovery.getSnapshot().pendingIds, []);
    await recovery.save("one");
    assert.deepEqual(recovery.getSnapshot().savedIds, ["one"]);
    await recovery.save("one"); assert.equal(attempts, 2);
  });
  it("locks duplicate saves and deletes while a write is pending", async () => {
    const gate = deferred<void>();
    let saves = 0;
    const { recovery, removed } = setup({ save: async () => { saves += 1; await gate.promise; } });
    recovery.retain(track());
    const saving = recovery.save("one");
    assert.deepEqual(recovery.getSnapshot().pendingIds, ["one"]);
    await assert.rejects(recovery.save("one"), /진행 중/);
    await assert.rejects(recovery.remove("one"), /진행 중/);
    await assert.rejects(recovery.load(), /진행 중/);
    assert.equal(saves, 1); assert.equal(removed.length, 0);
    gate.resolve(); await saving;
    assert.deepEqual(recovery.getSnapshot().pendingIds, []);
  });
  it("preserves an unsaved paid output during a successful refresh", async () => {
    const { recovery } = setup({ load: async () => [track("saved")] });
    recovery.retain(track()); await recovery.load();
    assert.deepEqual(recovery.getSnapshot().tracks.map((value) => value.metadata.id), ["one", "saved"]);
    assert.deepEqual(recovery.getSnapshot().savedIds, ["saved"]);
  });
  it("reconciles an unknown save outcome through read-only reload", async () => {
    const { recovery } = setup({ load: async () => [track()], save: async () => { throw new Error("unknown commit"); } });
    recovery.retain(track());
    await assert.rejects(recovery.save("one"));
    await recovery.load();
    assert.equal(recovery.getSnapshot().tracks.length, 1);
    assert.deepEqual(recovery.getSnapshot().savedIds, ["one"]);
  });
  it("does not treat a failed load as an empty successful library", async () => {
    const { recovery } = setup({ load: async () => { throw new Error("offline store"); } });
    recovery.retain(track());
    await assert.rejects(recovery.load(), /offline store/);
    assert.equal(recovery.getSnapshot().tracks.length, 1);
    assert.equal(recovery.getSnapshot().loaded, false);
    assert.equal(recovery.getSnapshot().loading, false);
    assert.equal(recovery.getSnapshot().loadError, "offline store");
  });
  it("deduplicates pending loads and permits an explicit retry after failure", async () => {
    const gate = deferred<LocalMusicTrack[]>();
    let calls = 0;
    const { recovery } = setup({ load: async () => { calls += 1; return calls === 1 ? gate.promise : []; } });
    const first = recovery.load(); const second = recovery.load();
    assert.equal(first, second); gate.reject(new Error("temporary"));
    await assert.rejects(first); await assert.rejects(second);
    await recovery.load();
    assert.equal(calls, 2); assert.equal(recovery.getSnapshot().loadError, "");
  });
  it("can recover when a storage adapter throws synchronously", async () => {
    let calls = 0;
    const { recovery } = setup({ load: () => {
      if (++calls === 1) throw new Error("sync failure");
      return Promise.resolve([]);
    } });
    await assert.rejects(recovery.load(), /sync failure/);
    await recovery.load(); assert.equal(calls, 2);
    assert.equal(recovery.getSnapshot().loaded, true);
  });
  it("does not discard a newly retained output while an earlier load resolves", async () => {
    const gate = deferred<LocalMusicTrack[]>();
    const { recovery } = setup({ load: async () => gate.promise });
    const loading = recovery.load(); recovery.retain(track());
    await assert.rejects(recovery.save("one"), /진행 중/);
    gate.resolve([]); await loading;
    assert.equal(recovery.getSnapshot().tracks.length, 1);
  });
  it("deletes through the repository even when a prior save acknowledgement was lost", async () => {
    const { recovery, removed } = setup(); recovery.retain(track());
    await recovery.remove("one");
    assert.deepEqual(removed, ["one"]); assert.equal(recovery.getSnapshot().tracks.length, 0);
  });
  it("keeps the downloadable output when deletion fails", async () => {
    const { recovery } = setup({ remove: async () => { throw new Error("delete failed"); } });
    recovery.retain(track()); await recovery.save("one");
    await assert.rejects(recovery.remove("one"), /delete failed/);
    assert.equal(recovery.getSnapshot().tracks.length, 1);
    assert.deepEqual(recovery.getSnapshot().savedIds, ["one"]);
    assert.deepEqual(recovery.getSnapshot().pendingIds, []);
  });
  it("isolates account instances and rejects a cross-account load", async () => {
    const { recovery } = setup({ load: async () => [track("other", "owner-b")] });
    assert.throws(() => recovery.retain(track("other", "owner-b")), /계정/);
    await assert.rejects(recovery.load(), /계정/);
    assert.equal(recovery.getSnapshot().tracks.length, 0);
    const other = setup().recovery;
    recovery.retain(track()); assert.equal(other.getSnapshot().tracks.length, 0);
  });
  it("rejects duplicate track IDs instead of silently replacing an output", async () => {
    const { recovery } = setup({ load: async () => [track(), track()] });
    recovery.retain(track());
    assert.throws(() => recovery.retain(track()), /덮어쓰지/);
    await assert.rejects(recovery.load(), /중복/);
    assert.equal(recovery.getSnapshot().tracks.length, 1);
  });
  it("refreshes external deletions while keeping transient outputs", async () => {
    const { recovery } = setup({ load: async () => [] });
    recovery.retain(track("saved")); await recovery.save("saved"); recovery.retain(track("transient"));
    await recovery.load();
    assert.deepEqual(recovery.getSnapshot().tracks.map((value) => value.metadata.id), ["transient"]);
  });
  it("rejects unknown output IDs before touching storage", async () => {
    const { recovery, saved, removed } = setup();
    await assert.rejects(recovery.save("unknown")); await assert.rejects(recovery.remove("unknown"));
    assert.equal(saved.length, 0); assert.equal(removed.length, 0);
  });
});
