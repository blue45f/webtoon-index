import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createMusicLibrary, MUSIC_LIBRARY_NAMESPACE, type MusicLibraryLock } from "./studio-music-library";

import type { LocalMusicTrack } from "./studio-music-client";

import { defaultMusicBrief, MUSIC_MAX_BYTES, MUSIC_TERMS_URL } from "@toonspectrum/core/studio-music";

function track(index: number, ownerId = "owner-a"): LocalMusicTrack {
  return {
    ownerId,
    audio: new Blob([new Uint8Array([73, 68, 51, ...Array<number>(20).fill(0)])], { type: "audio/mpeg" }),
    metadata: {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      createdAt: new Date(Date.UTC(2026, 8, 6, 0, index)).toISOString(),
      provider: "elevenlabs", model: "music_v1", format: "mp3_44100_128", termsUrl: MUSIC_TERMS_URL,
      brief: { ...defaultMusicBrief(), scene: "비가 그친 새벽에 다시 만난 두 사람", rightsConfirmed: true },
    },
  };
}
function harness() {
  const values = new Map<string, string>();
  const tails = new Map<string, Promise<unknown>>();
  const lock: MusicLibraryLock = (name, operation) => {
    const pending = (tails.get(name) ?? Promise.resolve()).catch(() => undefined).then(operation);
    tails.set(name, pending);
    return pending;
  };
  const database = {
    kvGet: vi.fn(async (namespace: string, key: string) => values.get(`${namespace}/${key}`) ?? null),
    kvSet: vi.fn(async (namespace: string, key: string, value: string) => { values.set(`${namespace}/${key}`, value); }),
  };
  const acquire = vi.fn(async () => database);
  return { values, database, acquire, library: createMusicLibrary(acquire, lock), second: createMusicLibrary(acquire, lock) };
}

describe("music library shared SQLite authority", () => {
  it("round-trips actual bounded MP3 bytes and sorts newest first", async () => {
    const { library, database } = harness();
    await library.save(track(1)); await library.save(track(2));
    const loaded = await library.load("owner-a");
    expect(loaded.map((item) => item.metadata.id)).toEqual([track(2).metadata.id, track(1).metadata.id]);
    expect(await loaded[0].audio.arrayBuffer()).toEqual(await track(2).audio.arrayBuffer());
    expect(database.kvSet).toHaveBeenCalledWith(MUSIC_LIBRARY_NAMESPACE, expect.any(String), expect.any(String));
  });
  it("keeps account reads and deletes isolated", async () => {
    const { library } = harness();
    await library.save(track(1)); await library.save(track(1, "owner-b"));
    await library.remove(track(1).metadata.id, "owner-b");
    expect(await library.load("owner-b")).toEqual([]);
    expect(await library.load("owner-a")).toHaveLength(1);
    await library.remove(track(99).metadata.id, "owner-a");
    expect(await library.load("owner-a")).toHaveLength(1);
  });
  it("enforces twenty slots under concurrent clients without losing accepted saves", async () => {
    const { library, second } = harness();
    const results = await Promise.allSettled(Array.from({ length: 22 }, (_, index) => (index % 2 ? library : second).save(track(index))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    const loaded = await library.load("owner-a");
    expect(new Set(loaded.map((item) => item.metadata.id)).size).toBe(20);
    await library.save({ ...loaded[0], metadata: { ...loaded[0].metadata, brief: { ...loaded[0].metadata.brief, title: "수정한 제목" } } });
    expect(await library.load("owner-a")).toHaveLength(20);
    await library.remove(loaded[0].metadata.id, "owner-a");
    await second.save(track(99));
    expect(await library.load("owner-a")).toHaveLength(20);
  });
  it("fails explicitly on unavailable or failed persistence without reporting a saved track", async () => {
    const { library, database } = harness();
    database.kvSet.mockRejectedValueOnce(new Error("disk full"));
    await expect(library.save(track(1))).rejects.toThrow("disk full");
    expect(await library.load("owner-a")).toEqual([]);
    const unavailable = createMusicLibrary(async () => { throw new Error("OPFS unavailable"); }, async (_name, operation) => operation());
    await expect(unavailable.save(track(1))).rejects.toThrow("OPFS unavailable");
  });
  it("rejects malformed metadata, fake audio and oversized payloads before storage", async () => {
    const { library, acquire } = harness();
    await expect(library.save({ ...track(1), audio: new Blob(["<html>error</html>"], { type: "audio/mpeg" }) })).rejects.toThrow();
    await expect(library.save({ ...track(1), audio: new Blob([new Uint8Array(MUSIC_MAX_BYTES + 1)], { type: "audio/mpeg" }) })).rejects.toThrow();
    await expect(library.save({ ...track(1), metadata: { ...track(1).metadata, createdAt: "invalid" } })).rejects.toThrow();
    await expect(library.load("../other-owner")).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
  });
  it("does not overwrite a malformed or cross-account stored row", async () => {
    const { library, values, database } = harness();
    const key = `${MUSIC_LIBRARY_NAMESPACE}/owner:owner-a:slot:0`;
    values.set(key, "{broken-json");
    await expect(library.save(track(1))).rejects.toThrow();
    expect(database.kvSet).not.toHaveBeenCalled();
    values.clear(); await library.save(track(1));
    const raw = JSON.parse(values.get(key)!);
    raw.ownerId = "owner-b"; values.set(key, JSON.stringify(raw));
    await expect(library.load("owner-a")).rejects.toThrow();
  });
  it("routes through the existing lazy product database and does not open another authority", () => {
    const source = readFileSync(new URL("./studio-music-library.ts", import.meta.url), "utf8");
    expect(source).toContain('import("../studio-local-database-runtime")');
    expect(source).toContain("acquireStudioLocalDatabase()");
    expect(source).not.toMatch(/indexedDB|localStorage|sessionStorage|openDB/);
  });
});
