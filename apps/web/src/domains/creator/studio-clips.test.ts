import { describe, it, expect } from "vitest";

import { CLIPS_KEY, MAX_CLIPS, listClips, removeClip, saveClip, type StudioClip } from "./studio-clips";

// 인메모리 가짜 저장소
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    _map: map,
  };
}

const clip = (id: string, createdAt = 1): StudioClip => ({
  id,
  name: `클립 ${id}`,
  createdAt,
  els: [{ type: "text", x: 0, y: 0 }],
});

describe("listClips", () => {
  it("저장소 없으면 빈 배열", () => {
    expect(listClips(null)).toEqual([]);
    expect(listClips(undefined)).toEqual([]);
  });

  it("빈/깨진 JSON은 빈 배열", () => {
    expect(listClips(fakeStorage())).toEqual([]);
    expect(listClips(fakeStorage({ [CLIPS_KEY]: "{not json" }))).toEqual([]);
    expect(listClips(fakeStorage({ [CLIPS_KEY]: '{"a":1}' }))).toEqual([]); // 배열 아님
  });

  it("형식이 맞는 클립만 통과시킨다", () => {
    const s = fakeStorage({
      [CLIPS_KEY]: JSON.stringify([clip("a"), { id: "x" }, clip("b")]),
    });
    expect(listClips(s).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("saveClip", () => {
  it("맨 앞에 추가한다", () => {
    const s = fakeStorage();
    saveClip(s, clip("a"));
    const next = saveClip(s, clip("b"));
    expect(next.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("같은 id는 교체(중복 제거)", () => {
    const s = fakeStorage();
    saveClip(s, clip("a", 1));
    const next = saveClip(s, clip("a", 2));
    expect(next).toHaveLength(1);
    expect(next[0].createdAt).toBe(2);
  });

  it(`최대 ${MAX_CLIPS}개로 제한`, () => {
    const s = fakeStorage();
    let result: StudioClip[] = [];
    for (let i = 0; i < MAX_CLIPS + 5; i++) result = saveClip(s, clip(`c${i}`, i));
    expect(result).toHaveLength(MAX_CLIPS);
    // 가장 최근 것이 맨 앞
    expect(result[0].id).toBe(`c${MAX_CLIPS + 4}`);
  });

  it("저장소에 영속된다", () => {
    const s = fakeStorage();
    saveClip(s, clip("a"));
    expect(listClips(s).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("removeClip", () => {
  it("id로 삭제", () => {
    const s = fakeStorage();
    saveClip(s, clip("a"));
    saveClip(s, clip("b"));
    const next = removeClip(s, "a");
    expect(next.map((c) => c.id)).toEqual(["b"]);
    expect(listClips(s).map((c) => c.id)).toEqual(["b"]);
  });

  it("없는 id는 그대로", () => {
    const s = fakeStorage();
    saveClip(s, clip("a"));
    expect(removeClip(s, "zzz").map((c) => c.id)).toEqual(["a"]);
  });
});
