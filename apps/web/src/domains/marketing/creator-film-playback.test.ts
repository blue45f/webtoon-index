import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { CREATOR_FILM_DOWNLOADS, clampCreatorFilmTime, createCreatorFilmPlayback, creatorFilmChapterAt } from "./creator-film-playback";

class TestMedia extends EventTarget {
  readyState = 0;
  duration = Number.NaN;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  nextPlay: () => Promise<void> = () => Promise.resolve();
  play() { this.playCalls += 1; return this.nextPlay(); }
  pause() { this.pauseCalls += 1; }
  loadMetadata() {
    this.readyState = 1;
    this.duration = 24;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("native creator film playback", () => {
  it("does not fetch or play anything merely by constructing the controller", () => {
    const media = new TestMedia();
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: assert.fail });
    assert.equal(media.playCalls, 0);
    controller.dispose();
  });
  it("keeps only the most recent chapter while metadata is still loading", () => {
    const media = new TestMedia();
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: assert.fail });
    controller.seekAndPlay(6);
    controller.seekAndPlay(18);
    controller.seekAndPlay(12);
    assert.equal(media.currentTime, 0);
    assert.equal(media.playCalls, 0);
    media.loadMetadata();
    assert.equal(media.currentTime, 12);
    assert.equal(media.playCalls, 1);
    media.dispatchEvent(new Event("loadedmetadata"));
    assert.equal(media.playCalls, 1);
    controller.dispose();
  });
  it("seeks immediately after cached metadata and clamps out-of-range input", () => {
    const media = new TestMedia();
    media.loadMetadata();
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: assert.fail });
    controller.seekAndPlay(100);
    assert.equal(media.currentTime, 23.99);
    controller.seekAndPlay(-10);
    assert.equal(media.currentTime, 0);
    assert.equal(media.playCalls, 2);
    controller.dispose();
  });
  it("does not resume after the user pauses before metadata is ready", () => {
    const media = new TestMedia();
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: assert.fail });
    controller.seekAndPlay(12);
    media.dispatchEvent(new Event("pause"));
    media.loadMetadata();
    assert.equal(media.playCalls, 0);
    controller.dispose();
  });
  it("cancels queued playback when the tab is hidden or the player is closed", () => {
    const media = new TestMedia();
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: assert.fail });
    controller.seekAndPlay(12);
    controller.pause();
    media.loadMetadata();
    assert.equal(media.playCalls, 0);
    assert.equal(media.pauseCalls, 1);
    controller.dispose();
  });
  it("ignores stale promise failures after a newer chapter request", async () => {
    const media = new TestMedia();
    media.loadMetadata();
    let rejectOld: (reason: Error) => void = () => {};
    let failures = 0;
    media.nextPlay = () => new Promise((_, reject) => { rejectOld = reject; });
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: () => { failures += 1; } });
    controller.seekAndPlay(6);
    media.nextPlay = () => Promise.resolve();
    controller.seekAndPlay(18);
    rejectOld(new Error("old request failed"));
    await settle();
    assert.equal(failures, 0);
    assert.equal(media.currentTime, 18);
    controller.dispose();
  });
  it("preserves native controls when autoplay is denied or a play is aborted", async () => {
    for (const name of ["NotAllowedError", "AbortError"]) {
      const media = new TestMedia();
      media.loadMetadata();
      let failures = 0;
      media.nextPlay = () => Promise.reject(Object.assign(new Error(name), { name }));
      const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: () => { failures += 1; } });
      controller.seekAndPlay(0);
      await settle();
      assert.equal(failures, 0);
      controller.dispose();
    }
  });
  it("reports a real asynchronous playback failure", async () => {
    const media = new TestMedia();
    media.loadMetadata();
    let failures = 0;
    media.nextPlay = () => Promise.reject(new Error("decode failure"));
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: () => { failures += 1; } });
    controller.seekAndPlay(0);
    await settle();
    assert.equal(failures, 1);
    controller.dispose();
  });
  it("reports a synchronous media exception without leaking it from the click handler", () => {
    const media = new TestMedia();
    media.loadMetadata();
    let failures = 0;
    media.nextPlay = () => { throw new Error("unsupported media"); };
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: () => { failures += 1; } });
    assert.doesNotThrow(() => controller.seekAndPlay(0));
    assert.equal(failures, 1);
    controller.dispose();
  });
  it("removes its listeners and ignores late failures after disposal", async () => {
    const media = new TestMedia();
    media.loadMetadata();
    let rejectPlay: (reason: Error) => void = () => {};
    let failures = 0;
    media.nextPlay = () => new Promise((_, reject) => { rejectPlay = reject; });
    const controller = createCreatorFilmPlayback(media, { duration: 24, onFailure: () => { failures += 1; } });
    controller.seekAndPlay(6);
    controller.dispose();
    controller.dispose();
    controller.seekAndPlay(18);
    media.loadMetadata();
    rejectPlay(new Error("late failure"));
    await settle();
    assert.equal(failures, 0);
    assert.equal(media.playCalls, 1);
    assert.equal(media.pauseCalls, 1);
  });
  it("normalizes invalid times and derives chapter boundaries without overshooting", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(clampCreatorFilmTime(invalid, 24), 0);
      assert.equal(clampCreatorFilmTime(12, invalid), 0);
    }
    assert.equal(clampCreatorFilmTime(12, 0), 0);
    assert.equal(clampCreatorFilmTime(12, -1), 0);
    const chapters = [0, 6, 12, 18];
    assert.deepEqual([0, 5.99, 6, 12, 24, -10, Number.NaN].map((time) => creatorFilmChapterAt(time, chapters)), [0, 0, 1, 2, 3, 0, 0]);
  });
  it("offers exactly the existing same-origin landscape, portrait and square films", () => {
    assert.equal(CREATOR_FILM_DOWNLOADS.length, 3);
    assert.deepEqual(CREATOR_FILM_DOWNLOADS.map((film) => film.ratio), ["16:9", "9:16", "1:1"]);
    for (const film of CREATOR_FILM_DOWNLOADS) assert.match(film.src, /^\/brand\/toonstudio-intro(?:-portrait|-square)?\.mp4$/);
  });
});
