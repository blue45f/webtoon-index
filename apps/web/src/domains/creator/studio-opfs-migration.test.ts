import { describe, expect, it } from "vitest";

import { createStudioOpfsAssetStore, type StudioOpfsAssetStore } from "./studio-opfs-asset-store";
import {
  createStudioOpfsMemoryFileSystem,
  type StudioOpfsLocalStorageLike,
  type StudioOpfsMemoryFileSystem,
} from "./studio-opfs-filesystem";
import {
  collectStudioOpfsRefs,
  createStudioOpfsJsonDataUrlSource,
  decodeStudioOpfsDataUrl,
  encodeStudioOpfsDataUrl,
  hydrateStudioOpfsRefs,
  migrateStudioAssetsToOpfs,
  parseStudioOpfsMigrationJournal,
  parseStudioOpfsRefValue,
  STUDIO_OPFS_MIGRATION_JOURNAL_KEY,
  studioOpfsRefValue,
} from "./studio-opfs-migration";

// ── 도우미 ──────────────────────────────────────────────────────────────

interface FakeStorage extends StudioOpfsLocalStorageLike {
  map: Map<string, string>;
  setCount: number;
  /** N번째 setItem(1-based)부터 던진다. localStorage 쓰기 중단을 재현한다. */
  failSetAfter: number;
  restart(): void;
}

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial));
  const storage: FakeStorage = {
    map,
    setCount: 0,
    failSetAfter: Number.POSITIVE_INFINITY,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      storage.setCount += 1;
      // 실패는 맵을 바꾸기 전에 던진다 — localStorage는 키 단위로 원자적이다.
      if (storage.setCount >= storage.failSetAfter) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
    restart() {
      storage.setCount = 0;
      storage.failSetAfter = Number.POSITIVE_INFINITY;
    },
  };
  return storage;
}

const CUSTOM_FONT_LIBRARY_KEY = "toonspectrum-studio-custom-fonts";

/** 결정적 고엔트로피 바이트 — 실제 WOFF2처럼 압축이 듣지 않는 payload. */
function fontBytes(seed: number, count = 40_000): Uint8Array {
  let state = seed >>> 0;
  const bytes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/** studio-custom-fonts.ts의 저장 형식(버전 envelope + dataUrl 인라인)을 그대로 재현한다. */
function customFontLibraryJson(fonts: ReadonlyArray<{ id: string; family: string; bytes: Uint8Array }>): string {
  return JSON.stringify({
    version: 1,
    fonts: fonts.map((font) => ({
      id: font.id,
      family: font.family,
      fileName: `${font.family}.woff2`,
      byteLength: font.bytes.byteLength,
      dataUrl: encodeStudioOpfsDataUrl(font.bytes, "font/woff2"),
    })),
  });
}

function fontSource() {
  return createStudioOpfsJsonDataUrlSource({
    id: "custom-fonts",
    key: CUSTOM_FONT_LIBRARY_KEY,
  });
}

interface Harness {
  storage: FakeStorage;
  fs: StudioOpfsMemoryFileSystem;
  store: StudioOpfsAssetStore;
  run(): ReturnType<typeof migrateStudioAssetsToOpfs>;
}

function createHarness(libraryJson: string): Harness {
  const storage = createFakeStorage({ [CUSTOM_FONT_LIBRARY_KEY]: libraryJson });
  const fs = createStudioOpfsMemoryFileSystem();
  const store = createStudioOpfsAssetStore({ fs });
  return {
    storage,
    fs,
    store,
    run: () => migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] }),
  };
}

const TWO_FONTS = customFontLibraryJson([
  { id: "f1", family: "내 손글씨", bytes: fontBytes(1) },
  { id: "f2", family: "제목용 굵은", bytes: fontBytes(2) },
]);

// ── data URL 코덱 ────────────────────────────────────────────────────────

describe("studio-opfs-migration · data URL 코덱", () => {
  it("인코딩/디코딩 왕복이 바이트와 MIME을 보존한다", () => {
    const bytes = fontBytes(7, 3_000);
    const decoded = decodeStudioOpfsDataUrl(encodeStudioOpfsDataUrl(bytes, "font/woff2"));
    expect(decoded?.mime).toBe("font/woff2");
    expect(Array.from(decoded?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it("data URL이 아닌 문자열은 조용히 무시한다", () => {
    expect(decodeStudioOpfsDataUrl("https://example.com/a.woff2")).toBeNull();
    expect(decodeStudioOpfsDataUrl("data:font/woff2;base64,!!!")).toBeNull();
    expect(decodeStudioOpfsDataUrl(42)).toBeNull();
  });

  it("참조 문자열은 해시와 MIME을 함께 담고 되읽을 수 있다", () => {
    const hash = `sha256:${"ab".repeat(32)}` as const;
    const value = studioOpfsRefValue(hash, "font/woff2");
    expect(parseStudioOpfsRefValue(value)).toEqual({ hash, mime: "font/woff2" });
    expect(parseStudioOpfsRefValue("opfs:not-a-hash")).toBeNull();
    expect(parseStudioOpfsRefValue("data:font/woff2;base64,AAAA")).toBeNull();
  });
});

// ── 기본 이동 ────────────────────────────────────────────────────────────

describe("studio-opfs-migration · localStorage → OPFS 이동", () => {
  it("인라인 글꼴을 OPFS로 옮기고 자리에는 참조만 남긴다", async () => {
    const harness = createHarness(TWO_FONTS);
    const report = await harness.run();

    expect(report.failed).toBe(false);
    expect(report.sources[0]?.status).toBe("migrated");
    expect(report.sources[0]?.movedCount).toBe(2);
    expect(report.movedCount).toBe(2);

    const stored = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    expect(stored).not.toContain("data:font/woff2;base64,");
    expect(collectStudioOpfsRefs(stored).length).toBe(2);
    // localStorage에서 실제로 덜어낸 문자 수 = base64 payload 전체.
    expect(report.freedChars).toBeGreaterThan(100_000);
    expect(stored.length).toBeLessThan(TWO_FONTS.length / 10);
  });

  it("옮긴 자산을 소유자 참조로 등록해 sweep에서 보호한다", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();

    const refs = await harness.store.ownerRefs("custom-fonts");
    expect(refs.length).toBe(2);

    const sweep = await harness.store.sweep({ graceMs: 0 });
    expect(sweep.removed).toEqual([]);
    expect(sweep.referenced).toBe(2);
  });

  it("참조를 다시 인라인 형태로 복원해 기존 파서가 그대로 동작한다", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();

    const stored = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    const hydrated = await hydrateStudioOpfsRefs(stored, harness.store);

    expect(JSON.parse(hydrated)).toEqual(JSON.parse(TWO_FONTS));
  });

  it("참조가 없는 문자열은 복원 비용 없이 그대로 통과한다", async () => {
    const harness = createHarness(TWO_FONTS);
    const untouched = JSON.stringify({ version: 1, fonts: [] });
    expect(await hydrateStudioOpfsRefs(untouched, harness.store)).toBe(untouched);
    expect(await hydrateStudioOpfsRefs("깨진 JSON", harness.store)).toBe("깨진 JSON");
  });

  it("저장소에서 사라진 참조 하나가 나머지 목록을 못 쓰게 만들지 않는다", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();
    const stored = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    const [first] = collectStudioOpfsRefs(stored);
    await harness.store.delete(first as string);

    const hydrated = JSON.parse(await hydrateStudioOpfsRefs(stored, harness.store)) as {
      fonts: Array<{ dataUrl: string }>;
    };
    expect(hydrated.fonts[0]?.dataUrl).toMatch(/^opfs:sha256:/u); // 못 찾은 것은 참조로 남는다
    expect(hydrated.fonts[1]?.dataUrl).toMatch(/^data:font\/woff2;base64,/u); // 나머지는 복원된다
  });

  it("같은 글꼴을 두 항목이 공유하면 blob은 하나로 합쳐진다", async () => {
    const shared = fontBytes(9);
    const harness = createHarness(
      customFontLibraryJson([
        { id: "f1", family: "가", bytes: shared },
        { id: "f2", family: "나", bytes: Uint8Array.from(shared) },
      ])
    );
    const report = await harness.run();

    expect(report.sources[0]?.movedCount).toBe(1); // 같은 data URL이므로 추출 단계에서 이미 하나
    expect((await harness.fs.list("blobs/")).length).toBe(1);
    expect((await harness.store.list()).length).toBe(1);
  });

  it("작은 인라인 값은 옮기지 않는다(왕복 비용이 이득보다 크다)", async () => {
    const harness = createHarness(
      customFontLibraryJson([{ id: "f1", family: "작은", bytes: fontBytes(3, 512) }])
    );
    const report = await harness.run();

    expect(report.sources[0]?.status).toBe("nothing-to-migrate");
    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(
      customFontLibraryJson([{ id: "f1", family: "작은", bytes: fontBytes(3, 512) }])
    );
  });

  it("키가 없거나 비어 있으면 아무 일도 하지 않는다", async () => {
    const storage = createFakeStorage();
    const fs = createStudioOpfsMemoryFileSystem();
    const report = await migrateStudioAssetsToOpfs({
      storage,
      store: createStudioOpfsAssetStore({ fs }),
      sources: [fontSource()],
    });

    expect(report.sources[0]?.status).toBe("source-missing");
    expect(report.failed).toBe(false);
    expect(await fs.list()).toEqual([]);
  });

  it("손상된 JSON은 건드리지 않고 원본을 그대로 둔다", async () => {
    const harness = createHarness("{ 이건 JSON 이 아니다");
    const report = await harness.run();

    expect(report.sources[0]?.status).toBe("nothing-to-migrate");
    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe("{ 이건 JSON 이 아니다");
  });
});

// ── 멱등성 ──────────────────────────────────────────────────────────────

describe("studio-opfs-migration · 멱등성", () => {
  it("두 번째 실행은 아무것도 바꾸지 않는다", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();
    const afterFirst = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    const blobsAfterFirst = await harness.fs.list("blobs/");

    const second = await harness.run();

    expect(second.sources[0]?.status).toBe("already-migrated");
    expect(second.movedCount).toBe(0);
    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(afterFirst);
    expect(await harness.fs.list("blobs/")).toEqual(blobsAfterFirst);
  });

  it("열 번을 돌려도 결과가 같다", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();
    const expected = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;

    for (let round = 0; round < 9; round += 1) await harness.run();

    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(expected);
    expect((await harness.store.list()).length).toBe(2);
  });

  it("저널을 통째로 지워도 결과가 같다(정확성이 저널에 기대지 않는다)", async () => {
    const harness = createHarness(TWO_FONTS);
    await harness.run();
    const expected = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;

    harness.storage.map.delete(STUDIO_OPFS_MIGRATION_JOURNAL_KEY);
    const rerun = await harness.run();

    expect(rerun.failed).toBe(false);
    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(expected);
    expect((await harness.store.list()).length).toBe(2);
  });

  it("손상된 저널은 빈 저널로 취급한다", () => {
    expect(parseStudioOpfsMigrationJournal("이건 JSON 이 아니다")).toEqual({});
    expect(parseStudioOpfsMigrationJournal(null)).toEqual({});
    expect(parseStudioOpfsMigrationJournal('{"custom-fonts":{"phase":"허위"}}')).toEqual({});
    expect(
      parseStudioOpfsMigrationJournal('{"custom-fonts":{"phase":"done","hashes":["쓰레기"]}}')
    ).toEqual({
      "custom-fonts": { source: "custom-fonts", phase: "done", hashes: [], updatedAt: 0 },
    });
  });
});

// ── 중단(크래시) ─────────────────────────────────────────────────────────

describe("studio-opfs-migration · 중단 안전성", () => {
  it("blob 쓰기 중간에 끊겨도 원본은 그대로다(불변식 A)", async () => {
    const storage = createFakeStorage({ [CUSTOM_FONT_LIBRARY_KEY]: TWO_FONTS });
    // index.json 1회 + blob 1회 이후, 두 번째 blob 쓰기에서 죽는다.
    const fs = createStudioOpfsMemoryFileSystem({ failWriteAfter: 3 });
    const store = createStudioOpfsAssetStore({ fs });

    const report = await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });

    expect(report.failed).toBe(true);
    expect(report.sources[0]?.status).toBe("failed");
    // 원본이 손상되지 않았다 — 이 시점에 새로고침해도 글꼴 두 개가 모두 살아 있다.
    expect(storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(TWO_FONTS);
    expect(fontSource().extract(TWO_FONTS).length).toBe(2);
  });

  it("중단 후 재시작하면 처음부터 끝까지 복구된다", async () => {
    const storage = createFakeStorage({ [CUSTOM_FONT_LIBRARY_KEY]: TWO_FONTS });
    const fs = createStudioOpfsMemoryFileSystem({ failWriteAfter: 3 });
    const store = createStudioOpfsAssetStore({ fs });

    await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });
    expect(storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(TWO_FONTS);

    // "재시작" — 새 프로세스가 같은 디스크·같은 localStorage로 다시 붙는다.
    fs.restart();
    const revived = createStudioOpfsAssetStore({ fs });
    const report = await migrateStudioAssetsToOpfs({ storage, store: revived, sources: [fontSource()] });

    expect(report.failed).toBe(false);
    expect(report.sources[0]?.status).toBe("migrated");
    const stored = storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    expect(collectStudioOpfsRefs(stored).length).toBe(2);
    expect(JSON.parse(await hydrateStudioOpfsRefs(stored, revived))).toEqual(JSON.parse(TWO_FONTS));
  });

  it("복사는 끝났지만 커밋 직전에 끊겨도 데이터가 사라지지 않는다(불변식 A 유지)", async () => {
    const storage = createFakeStorage({ [CUSTOM_FONT_LIBRARY_KEY]: TWO_FONTS });
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs });

    // 저널 쓰기 2회를 통과시키고 본문 커밋 setItem에서 죽인다.
    storage.failSetAfter = 2;
    const report = await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });

    expect(report.failed).toBe(true);
    expect(storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(TWO_FONTS); // 원본 그대로
    expect((await store.list()).length).toBe(2); // 자산은 이미 OPFS에 있다

    storage.restart();
    const rerun = await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });

    expect(rerun.failed).toBe(false);
    expect(rerun.sources[0]?.dedupedCount).toBe(2); // 재복사는 중복 제거로 공짜
    const stored = storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    expect(JSON.parse(await hydrateStudioOpfsRefs(stored, store))).toEqual(JSON.parse(TWO_FONTS));
  });

  it("커밋은 됐지만 저널을 못 쓴 채 끊겨도 다음 실행이 완료로 닫는다", async () => {
    const harness = createHarness(TWO_FONTS);
    // setItem 순서는 [1] copied 저널 → [2] 본문 커밋 → [3] done 저널.
    // 본문 커밋까지 통과시키고 마지막 done 저널 쓰기에서 죽인다.
    harness.storage.failSetAfter = 3;
    const report = await harness.run();

    expect(report.sources[0]?.status).toBe("migrated");
    const stored = harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY) as string;
    expect(collectStudioOpfsRefs(stored).length).toBe(2);
    expect(parseStudioOpfsMigrationJournal(harness.storage.map.get(STUDIO_OPFS_MIGRATION_JOURNAL_KEY) ?? null)["custom-fonts"]?.phase).toBe("copied");

    harness.storage.restart();
    const rerun = await harness.run();

    expect(rerun.sources[0]?.status).toBe("already-migrated");
    expect(harness.storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(stored);
    expect(
      parseStudioOpfsMigrationJournal(harness.storage.map.get(STUDIO_OPFS_MIGRATION_JOURNAL_KEY) ?? null)["custom-fonts"]?.phase
    ).toBe("done");
  });

  it("중단된 마이그레이션이 남긴 blob을 sweep이 훔쳐가지 않는다", async () => {
    const storage = createFakeStorage({ [CUSTOM_FONT_LIBRARY_KEY]: TWO_FONTS });
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 300_000 });

    storage.failSetAfter = 2; // 커밋 직전에 중단
    await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });

    // 참조 등록 전에 죽었더라도 유예 창이 신규 blob을 보호한다.
    const sweep = await store.sweep();
    expect(sweep.removed).toEqual([]);
    expect(sweep.retainedInGrace.length + sweep.referenced).toBe(2);

    storage.restart();
    const rerun = await migrateStudioAssetsToOpfs({ storage, store, sources: [fontSource()] });
    expect(rerun.failed).toBe(false);
  });

  it("여러 소스 중 하나가 실패해도 나머지는 완주한다", async () => {
    const otherKey = "toonspectrum-studio-emeres-library";
    const storage = createFakeStorage({
      [CUSTOM_FONT_LIBRARY_KEY]: TWO_FONTS,
      [otherKey]: JSON.stringify([
        { id: "e1", name: "틀", src: encodeStudioOpfsDataUrl(fontBytes(21), "image/png") },
      ]),
    });
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs });
    const broken: ReturnType<typeof fontSource> = {
      ...fontSource(),
      id: "broken",
      extract() {
        throw new Error("추출 실패");
      },
    };

    const report = await migrateStudioAssetsToOpfs({
      storage,
      store,
      sources: [broken, createStudioOpfsJsonDataUrlSource({ id: "emeres", key: otherKey })],
    });

    expect(report.failed).toBe(true);
    expect(report.sources[0]?.status).toBe("failed");
    expect(report.sources[0]?.message).toMatch(/기존 데이터는 그대로 남아 있어요/u);
    expect(report.sources[1]?.status).toBe("migrated");
    expect(storage.map.get(CUSTOM_FONT_LIBRARY_KEY)).toBe(TWO_FONTS);
  });
});
