import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { readMusicWorkId, scopeMusicBrief } from "./studio-music-work-scope";

import type { MusicBrief } from "@toonspectrum/core/studio-music";

function brief(): MusicBrief {
  return {
    title: "다시 만난 밤", scene: "두 주인공이 역에서 재회한다.", mood: "romance", purpose: "ost",
    seconds: 30, bpm: 78, instruments: ["piano", "strings"], vocals: true,
    lyrics: "긴 밤이 지나 우리 다시 만날 때", loop: false, workId: "work-a", rightsConfirmed: true,
  };
}

describe("music route work scope", () => {
  it("accepts exactly bounded IDs without normalizing to another work", () => {
    for (const id of ["work-a", "WORK_b_123", "a".repeat(80)]) assert.equal(readMusicWorkId(id), id);
  });
  it("rejects missing, oversized, path-like and padded route values", () => {
    for (const id of [null, undefined, "", "a".repeat(81), "../work-b", "a/b", "work-a?x=1", " work-a", "work-a ", "work-a\n"]) {
      assert.equal(readMusicWorkId(id), "");
    }
  });
  it("moves a draft to the current work without losing scene, lyrics or music choices", () => {
    const original = brief();
    const result = scopeMusicBrief(original, "work-b");
    assert.deepEqual(result, { ...original, workId: "work-b", rightsConfirmed: false });
    assert.equal(original.workId, "work-a");
    assert.equal(original.rightsConfirmed, true);
  });
  it("does not inherit a saved track's work on the unbound music route", () => {
    assert.equal(scopeMusicBrief(brief(), "").workId, "");
  });
  it("resets consent even when reusing settings within the same work", () => {
    assert.equal(scopeMusicBrief(brief(), "work-a").rightsConfirmed, false);
  });
  it("copies mutable instrument selection instead of editing a saved track", () => {
    const original = brief(); const result = scopeMusicBrief(original, "work-b");
    result.instruments.push("drums");
    assert.deepEqual(original.instruments, ["piano", "strings"]);
  });
  it("always targets the latest route through repeated work changes", () => {
    let current = brief();
    for (const id of ["work-b", "", "work-c", "work-a"]) {
      current = scopeMusicBrief({ ...current, rightsConfirmed: true }, id);
      assert.equal(current.workId, id); assert.equal(current.rightsConfirmed, false);
      assert.equal(current.lyrics, brief().lyrics);
    }
  });
});
