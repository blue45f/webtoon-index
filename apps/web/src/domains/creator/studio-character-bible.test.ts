import { describe, expect, it } from "vitest";

import {
  addStudioCharacter,
  buildStudioCharacterBiblePromptContext,
  createEmptyStudioCharacterBible,
  loadStudioCharacterBible,
  normalizeStudioCharacterBible,
  patchStudioCharacter,
  removeStudioCharacter,
  reorderStudioCharacter,
  saveStudioCharacterBible,
  serializeStudioCharacterBible,
  STUDIO_CHARACTER_BIBLE_FIELDS,
  STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS,
  STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS,
  STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH,
  STUDIO_CHARACTER_BIBLE_VERSION,
  StudioCharacterBibleSchema,
  studioCharacterBibleStorageKey,
  type StudioCharacterBible,
} from "./studio-character-bible";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function withCharacters(...ids: string[]): StudioCharacterBible {
  return ids.reduce(
    (bible, id) => addStudioCharacter(bible, { id, name: `캐릭터 ${id}` }),
    createEmptyStudioCharacterBible()
  );
}

describe("studio character bible schema and persistence", () => {
  it("persists a bounded, versioned canonical document", () => {
    const bible = addStudioCharacter(createEmptyStudioCharacterBible(), {
      id: "client-char-1",
      name: "  윤슬  ",
      role: " 주인공 ",
      appearance: "은빛 단발",
      costume: "교복",
      colors: [" #ffffff ", "#ffffff", "#2255aa"],
      voice: "낮고 차분함",
      goal: "도시를 구한다",
      relationships: ["해온: 라이벌"],
      props: ["은색 열쇠"],
      lockedFields: ["appearance", "colors", "appearance"],
    });
    expect(bible).toEqual({
      version: STUDIO_CHARACTER_BIBLE_VERSION,
      characters: [{
        id: "client-char-1",
        name: "윤슬",
        role: "주인공",
        appearance: "은빛 단발",
        costume: "교복",
        colors: ["#ffffff", "#2255aa"],
        voice: "낮고 차분함",
        goal: "도시를 구한다",
        relationships: ["해온: 라이벌"],
        props: ["은색 열쇠"],
        lockedFields: ["appearance", "colors"],
      }],
    });
    expect(StudioCharacterBibleSchema.parse(JSON.parse(serializeStudioCharacterBible(bible)))).toEqual(bible);
  });

  it("isolates persistence by user and work/remix context", () => {
    const a = studioCharacterBibleStorageKey({ userId: "u1", workId: "w1" });
    expect(a).not.toBe(studioCharacterBibleStorageKey({ userId: "u2", workId: "w1" }));
    expect(a).not.toBe(studioCharacterBibleStorageKey({ userId: "u1", workId: "w2" }));
    expect(a).not.toBe(studioCharacterBibleStorageKey({ userId: "u1", remixId: "w1" }));
  });

  it("loads legacy array/entries shapes, normalizes fields, and never invents missing IDs", () => {
    const result = normalizeStudioCharacterBible(JSON.stringify({
      entries: [
        {
          characterId: " legacy-1 ",
          characterName: "  윤슬  ",
          palette: "#fff, #111, #fff",
          relationship: "해온: 라이벌; 모래: 친구",
          props: [" 열쇠 ", null, "열쇠"],
          lockedFields: "appearance, colors, unknown, colors",
        },
        { name: "ID 없음" },
        { id: "legacy-1", name: "중복 ID" },
        null,
      ],
    }));
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0]).toMatchObject({
      id: "legacy-1",
      name: "윤슬",
      colors: ["#fff", "#111"],
      relationships: ["해온: 라이벌", "모래: 친구"],
      props: ["열쇠"],
      lockedFields: ["appearance", "colors"],
    });
  });

  it("returns an empty versioned document for malformed JSON or containers", () => {
    expect(normalizeStudioCharacterBible("{broken")).toEqual(createEmptyStudioCharacterBible());
    expect(normalizeStudioCharacterBible({ characters: "wrong" })).toEqual(createEmptyStudioCharacterBible());
    expect(loadStudioCharacterBible(undefined, "key")).toEqual(createEmptyStudioCharacterBible());
  });

  it("saves and loads the canonical version and reports quota failures", () => {
    const storage = memoryStorage();
    const bible = withCharacters("a");
    expect(saveStudioCharacterBible(storage, "key", bible)).toEqual(bible);
    expect(loadStudioCharacterBible(storage, "key")).toEqual(bible);
    expect(JSON.parse(storage.values.get("key") ?? "{}").version).toBe(STUDIO_CHARACTER_BIBLE_VERSION);
    expect(() => saveStudioCharacterBible({ setItem: () => { throw new Error("quota"); } }, "key", bible)).toThrow(/저장공간/);
  });
});

describe("studio character bible immutable operations", () => {
  it("requires client-issued IDs and rejects duplicate IDs", () => {
    const bible = withCharacters("client-1");
    expect(() => addStudioCharacter(bible, { id: "", name: "무효" })).toThrow(/ID/);
    expect(() => addStudioCharacter(bible, { id: "client-1", name: "중복" })).toThrow(/사용 중/);
    expect(bible.characters).toHaveLength(1);
  });

  it("enforces character, text, and list limits while normalizing input", () => {
    let bible = createEmptyStudioCharacterBible();
    for (let index = 0; index < STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS; index++) {
      bible = addStudioCharacter(bible, { id: `c${index}` });
    }
    expect(() => addStudioCharacter(bible, { id: "overflow" })).toThrow(/최대/);

    const bounded = addStudioCharacter(createEmptyStudioCharacterBible(), {
      id: "bounded",
      name: "가".repeat(STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH + 20),
      props: Array.from({ length: STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS + 5 }, (_, index) => `소품 ${index}`),
    }).characters[0];
    expect(bounded.name).toHaveLength(STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH);
    expect(bounded.props).toHaveLength(STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS);
  });

  it("patches fields without mutating the source and keeps IDs immutable", () => {
    const bible = withCharacters("a", "b");
    const originalEntry = bible.characters[0];
    const next = patchStudioCharacter(bible, "a", {
      role: "  조력자  ",
      props: ["지도", "지도", "램프"],
      lockedFields: [...STUDIO_CHARACTER_BIBLE_FIELDS],
    });
    expect(next).not.toBe(bible);
    expect(next.characters).not.toBe(bible.characters);
    expect(next.characters[0]).not.toBe(originalEntry);
    expect(originalEntry.role).toBe("");
    expect(next.characters[0]).toMatchObject({ id: "a", role: "조력자", props: ["지도", "램프"] });
    expect(() => patchStudioCharacter(bible, "a", { id: "new" } as never)).toThrow(/수정할 수 없는/);
    expect(patchStudioCharacter(bible, "missing", { role: "없음" })).toBe(bible);
  });

  it("removes by ID without mutating and preserves identity for missing IDs", () => {
    const bible = withCharacters("a", "b", "c");
    const next = removeStudioCharacter(bible, "b");
    expect(next.characters.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(bible.characters.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(removeStudioCharacter(bible, "missing")).toBe(bible);
  });

  it("reorders immutably, clamps the destination, and ignores invalid moves", () => {
    const bible = withCharacters("a", "b", "c");
    const moved = reorderStudioCharacter(bible, "a", 99);
    expect(moved.characters.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(bible.characters.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(reorderStudioCharacter(bible, "missing", 1)).toBe(bible);
    expect(reorderStudioCharacter(bible, "a", Number.NaN)).toBe(bible);
    expect(reorderStudioCharacter(bible, "b", 1)).toBe(bible);
  });
});

describe("studio character bible AI context", () => {
  it("formats non-empty fields deterministically and marks locked constraints", () => {
    const bible = addStudioCharacter(createEmptyStudioCharacterBible(), {
      id: "hero",
      name: "윤슬",
      appearance: "은빛 단발",
      colors: ["#ffffff", "#2255aa"],
      props: ["은색 열쇠"],
      lockedFields: ["appearance", "colors"],
    });

    expect(buildStudioCharacterBiblePromptContext(bible)).toBe([
      "캐릭터 1",
      "- 이름: 윤슬",
      "- 외형 [고정]: 은빛 단발",
      "- 대표 색 [고정]: #ffffff | #2255aa",
      "- 소품: 은색 열쇠",
    ].join("\n"));
  });

  it("returns no context for an empty bible and bounds the output", () => {
    expect(buildStudioCharacterBiblePromptContext(createEmptyStudioCharacterBible())).toBe("");
    expect(buildStudioCharacterBiblePromptContext(withCharacters("a", "b"), 20)).toHaveLength(20);
  });
});
