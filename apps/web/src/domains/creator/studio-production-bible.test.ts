import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  createStudioProductionBibleEntryId,
  diagnoseStudioProductionBibleReferences,
  duplicateStudioProductionBibleEntry,
  mergeStudioProductionBibles,
  normalizeStudioProductionBible,
  parseStudioProductionBibleImport,
  patchStudioProductionBibleEntry,
  projectStudioProductionBibleForContinuity,
  removeStudioProductionBibleEntry,
  searchStudioProductionBible,
  serializeStudioProductionBible,
  STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES,
  STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES,
  STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS,
  STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH,
  STUDIO_PRODUCTION_BIBLE_VERSION,
  StudioProductionBibleLocalRepository,
  StudioProductionBibleSchema,
  studioProductionBibleLegacyStorageKey,
  studioProductionBibleStorageKey,
  type StudioProductionBible,
  type StudioProductionBibleEntryKind,
} from "./studio-production-bible";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function withEntry(
  bible: StudioProductionBible,
  kind: StudioProductionBibleEntryKind,
  id: string,
  name = id
): StudioProductionBible {
  return addStudioProductionBibleEntry(bible, { id, kind, name });
}

function productionFixture(): StudioProductionBible {
  let bible = createEmptyStudioProductionBible();
  bible = addStudioProductionBibleEntry(bible, {
    id: "location-rooftop",
    kind: "location",
    name: "학교 옥상",
    aliases: ["옥상", " 학교 옥상 "],
    description: "낡은 철망과 물탱크가 있는 장소",
    visualKeywords: ["역광", "철망"],
    colors: ["남색", "주황"],
    timeOfDay: "해질녘",
    referenceAssetIds: ["asset-rooftop"],
  });
  bible = addStudioProductionBibleEntry(bible, {
    id: "prop-key",
    kind: "prop",
    name: "은색 열쇠",
    aliases: ["열쇠"],
    visualKeywords: ["낡은 흠집"],
    linkedCharacterIds: ["character-yun"],
    referenceAssetIds: ["asset-key"],
  });
  bible = addStudioProductionBibleEntry(bible, {
    id: "scene-reunion",
    kind: "scene",
    name: "옥상 재회",
    aliases: ["첫 재회"],
    description: "윤이 잃어버린 열쇠를 돌려받는다.",
    visualKeywords: ["로우 앵글", "긴 그림자"],
    colors: ["주황", "남색"],
    timeOfDay: "해질녘",
    linkedCharacterIds: ["character-yun"],
    linkedLocationIds: ["location-rooftop"],
    linkedPropIds: ["prop-key"],
    referenceAssetIds: ["asset-shot"],
  });
  return bible;
}

describe("studio production bible schema and stable operations", () => {
  it("normalizes legacy scene/location/prop containers into one bounded canonical document", () => {
    const bible = normalizeStudioProductionBible({
      scenes: [{
        entryId: " scene-1 ",
        title: "  첫 장면  ",
        alias: "도입, 도입, 오프닝",
        notes: "  옥상에서 재회한다.  ",
        keywords: [" 역광 ", "역광", "바람"],
        palette: "주황; 남색",
        time: " 해질녘 ",
        characterIds: [" char-1 ", "char-1"],
        locationIds: "location-1",
        propIds: "prop-1",
        assetIds: ["asset-1"],
      }, {
        name: "ID 없는 항목",
      }],
      locations: [{ id: "location-1", name: "옥상" }],
      props: [{ id: "prop-1", name: "열쇠" }],
    });

    expect(bible.version).toBe(STUDIO_PRODUCTION_BIBLE_VERSION);
    expect(bible.entries.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "scene:scene-1",
      "location:location-1",
      "prop:prop-1",
    ]);
    expect(bible.entries[0]).toMatchObject({
      name: "첫 장면",
      aliases: ["도입", "오프닝"],
      description: "옥상에서 재회한다.",
      visualKeywords: ["바람", "역광"],
      colors: ["남색", "주황"],
      timeOfDay: "해질녘",
      linkedCharacterIds: ["char-1"],
      linkedLocationIds: ["location-1"],
      linkedPropIds: ["prop-1"],
      referenceAssetIds: ["asset-1"],
    });
    expect(StudioProductionBibleSchema.parse(bible)).toEqual(bible);
  });

  it("keeps IDs independent from mutable names and requires unique client-issued IDs", () => {
    const generated = createStudioProductionBibleEntryId("scene", () => "stable seed");
    expect(generated).toBe("scene_stable-seed");

    const bible = addStudioProductionBibleEntry(
      createEmptyStudioProductionBible(),
      { kind: "scene", name: "초기 이름" },
      () => generated
    );
    const renamed = patchStudioProductionBibleEntry(bible, generated, {
      name: "바뀐 이름",
    });
    expect(renamed.entries[0]).toMatchObject({ id: generated, name: "바뀐 이름" });
    expect(() =>
      addStudioProductionBibleEntry(renamed, {
        id: generated,
        kind: "scene",
        name: "중복",
      })
    ).toThrow(/이미 사용 중/);
    expect(() =>
      patchStudioProductionBibleEntry(renamed, generated, { id: "changed" } as never)
    ).toThrow(/수정할 수 없는/);
  });

  it("bounds entry, name, and list growth without mutating the source", () => {
    const original = createEmptyStudioProductionBible();
    const bounded = addStudioProductionBibleEntry(original, {
      id: "bounded",
      kind: "prop",
      name: "가".repeat(STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH + 20),
      aliases: Array.from(
        { length: STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS + 20 },
        (_, index) => `별칭 ${index}`
      ),
    });
    expect(original.entries).toHaveLength(0);
    expect(bounded.entries[0].name).toHaveLength(STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH);
    expect(bounded.entries[0].aliases).toHaveLength(
      STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS
    );

    let full = createEmptyStudioProductionBible();
    for (let index = 0; index < STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES; index += 1) {
      full = withEntry(full, "prop", `prop-${index}`);
    }
    expect(() => withEntry(full, "prop", "overflow")).toThrow(/최대/);
  });

  it("duplicates with a new stable ID and cleans inbound links on delete", () => {
    const bible = productionFixture();
    const duplicated = duplicateStudioProductionBibleEntry(bible, "prop-key", {
      id: "prop-key-copy",
    });
    expect(duplicated.entries.find(({ id }) => id === "prop-key-copy")).toMatchObject({
      kind: "prop",
      name: "은색 열쇠 복사본",
      linkedCharacterIds: ["character-yun"],
      referenceAssetIds: ["asset-key"],
    });

    const removed = removeStudioProductionBibleEntry(duplicated, "location-rooftop");
    expect(removed.entries.some(({ id }) => id === "location-rooftop")).toBe(false);
    expect(removed.entries.find(({ id }) => id === "scene-reunion")?.linkedLocationIds)
      .toEqual([]);
    expect(removeStudioProductionBibleEntry(removed, "missing")).toBe(removed);
  });
});

describe("studio production bible search, merge, and diagnostics", () => {
  it("searches all descriptive fields and composes kind/reference/dangling filters", () => {
    const bible = productionFixture();
    expect(searchStudioProductionBible(bible, { query: "옥상 역광" }).map(({ id }) => id))
      .toEqual(["location-rooftop"]);
    expect(searchStudioProductionBible(bible, {
      kinds: ["scene"],
      linkedCharacterId: "character-yun",
      linkedLocationId: "location-rooftop",
      linkedPropId: "prop-key",
      referenceAssetId: "asset-shot",
    }).map(({ id }) => id)).toEqual(["scene-reunion"]);

    const broken = addStudioProductionBibleEntry(bible, {
      id: "scene-broken",
      kind: "scene",
      name: "깨진 참조",
      linkedLocationIds: ["missing-location"],
    });
    expect(searchStudioProductionBible(broken, { danglingOnly: true }).map(({ id }) => id))
      .toEqual(["scene-broken"]);
  });

  it("exports byte-stable canonical JSON and imports legacy shapes defensively", () => {
    const bible = productionFixture();
    const shuffled = {
      version: 1,
      entries: [...bible.entries].toReversed(),
    };
    expect(serializeStudioProductionBible(shuffled as StudioProductionBible))
      .toBe(serializeStudioProductionBible(bible));
    expect(parseStudioProductionBibleImport(serializeStudioProductionBible(bible)))
      .toEqual({ ok: true, bible });
    expect(parseStudioProductionBibleImport("{broken").ok).toBe(false);
    expect(parseStudioProductionBibleImport(JSON.stringify({ unknown: [] })).ok).toBe(false);
    expect(parseStudioProductionBibleImport(
      "x".repeat(STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES + 1)
    ).ok).toBe(false);
  });

  it("merges deterministically, reports cross-kind ID conflicts, and supports explicit policies", () => {
    const current = addStudioProductionBibleEntry(createEmptyStudioProductionBible(), {
      id: "shared",
      kind: "scene",
      name: "기존 장면",
      aliases: ["기존"],
      linkedCharacterIds: ["c1"],
    });
    const incoming = normalizeStudioProductionBible({
      entries: [
        {
          id: "shared",
          kind: "scene",
          name: "가져온 장면",
          aliases: ["가져옴"],
          linkedCharacterIds: ["c2"],
        },
        { id: "new", kind: "location", name: "새 장소" },
      ],
    });
    const merged = mergeStudioProductionBibles(current, incoming);
    expect(merged).toMatchObject({
      addedIds: ["new"],
      updatedIds: ["shared"],
      keptIds: [],
      kindConflictIds: [],
    });
    expect(merged.bible.entries.find(({ id }) => id === "shared")).toMatchObject({
      name: "기존 장면",
      aliases: ["가져옴", "기존"],
      linkedCharacterIds: ["c1", "c2"],
    });

    expect(
      mergeStudioProductionBibles(current, incoming, "replace-existing").bible.entries
        .find(({ id }) => id === "shared")?.name
    ).toBe("가져온 장면");
    expect(
      mergeStudioProductionBibles(current, incoming, "keep-existing").keptIds
    ).toContain("shared");

    const conflictingKind = normalizeStudioProductionBible({
      entries: [{ id: "shared", kind: "prop", name: "잘못 겹친 소품" }],
    });
    expect(mergeStudioProductionBibles(current, conflictingKind)).toMatchObject({
      kindConflictIds: ["shared"],
      keptIds: ["shared"],
    });
  });

  it("reports dangling internal/external references in canonical order without guessing unavailable catalogues", () => {
    const bible = normalizeStudioProductionBible({
      entries: [
        {
          id: "scene-a",
          kind: "scene",
          name: "장면 A",
          linkedCharacterIds: ["character-missing"],
          linkedLocationIds: ["prop-existing", "location-missing"],
          linkedPropIds: ["prop-missing"],
          referenceAssetIds: ["asset-missing"],
        },
        { id: "prop-existing", kind: "prop", name: "기존 소품" },
      ],
    });
    expect(
      diagnoseStudioProductionBibleReferences(bible).map(({ code }) => code)
    ).toEqual([
      "DANGLING_LOCATION",
      "REFERENCE_KIND_MISMATCH",
      "DANGLING_PROP",
    ]);
    expect(
      diagnoseStudioProductionBibleReferences(bible, {
        knownCharacterIds: [],
        knownAssetIds: [],
      }).map(({ code, referenceId }) => `${code}:${referenceId}`)
    ).toEqual([
      "DANGLING_CHARACTER:character-missing",
      "DANGLING_LOCATION:location-missing",
      "REFERENCE_KIND_MISMATCH:prop-existing",
      "DANGLING_PROP:prop-missing",
      "DANGLING_ASSET:asset-missing",
    ]);
  });

  it("projects frozen ID-first continuity facts without inventing prop state", () => {
    const bible = addStudioProductionBibleEntry(productionFixture(), {
      id: "scene-unresolved",
      kind: "scene",
      name: "미등록 장소 컷",
      linkedLocationIds: ["location-missing"],
    });
    const projection = projectStudioProductionBibleForContinuity(bible);

    expect(projection.scenes.find(({ sceneId }) => sceneId === "scene-reunion"))
      .toMatchObject({
        name: "옥상 재회",
        timeOfDay: "해질녘",
        characterIds: ["character-yun"],
        locations: [{ id: "location-rooftop", name: "학교 옥상" }],
        props: [{ id: "prop-key", name: "은색 열쇠" }],
      });
    expect(
      projection.scenes.find(({ sceneId }) => sceneId === "scene-unresolved")
        ?.locations
    ).toEqual([{ id: "location-missing", name: null }]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.scenes)).toBe(true);
    expect(Object.isFrozen(projection.scenes[0]?.characterIds)).toBe(true);
  });
});

describe("studio production bible local-only persistence", () => {
  it("isolates keys by owner and work/remix context", () => {
    const key = studioProductionBibleStorageKey({ userId: "u1", workId: "w1" });
    expect(key).toContain(":v12:");
    expect(studioProductionBibleLegacyStorageKey({ userId: "u1", workId: "w1" }))
      .toContain(":v1:");
    expect(key).not.toBe(
      studioProductionBibleStorageKey({ userId: "u2", workId: "w1" })
    );
    expect(key).not.toBe(
      studioProductionBibleStorageKey({ userId: "u1", workId: "w2" })
    );
    expect(key).not.toBe(
      studioProductionBibleStorageKey({ userId: "u1", remixId: "w1" })
    );
  });

  it("uses an injected IndexedDB adapter only behind explicit legacy import policy", async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const repository = new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: factory,
      localStorage: storage,
    });
    const bible = productionFixture();
    const saved = await repository.save("project-1", bible);
    expect(saved).toMatchObject({
      bible,
      backend: "legacy-indexeddb",
      persisted: true,
      localOnly: true,
    });
    expect(storage.values.has("project-1")).toBe(true);

    const restored = await new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: factory,
      localStorage: null,
    }).load("project-1");
    expect(restored).toMatchObject({
      bible,
      backend: "legacy-indexeddb",
      persisted: true,
      localOnly: true,
    });
  });

  it("uses an injected localStorage adapter only in explicit legacy tooling", async () => {
    const storage = memoryStorage();
    const failingFactory = {
      open: () => {
        throw new Error("private mode");
      },
    } as unknown as IDBFactory;
    const repository = new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: failingFactory,
      localStorage: storage,
    });
    const bible = productionFixture();
    const saved = await repository.save("project-2", bible);
    expect(saved).toMatchObject({
      bible,
      backend: "legacy-local-storage",
      persisted: true,
      localOnly: true,
    });
    expect(saved.warning).toMatch(/IndexedDB/);
    expect((await repository.load("project-2")).bible).toEqual(bible);
  });

  it("reports memory-only durability honestly when every browser store fails", async () => {
    const repository = new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: null,
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    const bible = productionFixture();
    const saved = await repository.save("project-3", bible);
    expect(saved).toMatchObject({
      bible,
      backend: "memory",
      persisted: false,
      localOnly: true,
    });
    expect(saved.warning).toMatch(/새로고침 전/);
    expect((await repository.load("project-3")).bible).toEqual(bible);
  });

  it("ignores injected and global legacy stores under the default discard policy", async () => {
    const storage = memoryStorage();
    const bible = productionFixture();
    storage.setItem("discarded-project", serializeStudioProductionBible(bible));
    const repository = new StudioProductionBibleLocalRepository({
      indexedDB: new IDBFactory(),
      localStorage: storage,
    });

    const loaded = await repository.load("discarded-project");
    expect(loaded.backend).toBe("memory");
    expect(loaded.persisted).toBe(false);
    expect(loaded.bible).toEqual(createEmptyStudioProductionBible());
  });

  it("fails closed instead of converting a corrupt explicit legacy payload to an empty success", async () => {
    const storage = memoryStorage();
    storage.setItem("corrupt-legacy", "{broken");
    const repository = new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: null,
      localStorage: storage,
    });

    const loaded = await repository.load("corrupt-legacy");
    expect(loaded).toMatchObject({
      bible: createEmptyStudioProductionBible(),
      backend: "memory",
      persisted: false,
      warning: expect.stringContaining("가져오지 않았습니다"),
    });
  });
});
