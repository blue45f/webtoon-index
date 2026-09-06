import { describe, expect, it } from "vitest";

import {
  canonicalizeStudioOpfsContentHash,
  createStudioOpfsAssetStore,
  estimateStudioOpfsQuota,
  isStudioOpfsContentHash,
  STUDIO_OPFS_QUOTA_RESERVE_BYTES,
  studioOpfsQuotaLevel,
  type StudioOpfsAssetStore,
  type StudioOpfsStorageEstimator,
} from "./studio-opfs-asset-store";
import {
  createStudioOpfsLegacyLocalStorageFileSystem,
  createStudioOpfsMemoryFileSystem,
  formatStudioOpfsBytes,
  isValidStudioOpfsPath,
  selectStudioOpfsFileSystem,
  StudioOpfsError,
  STUDIO_OPFS_LEGACY_LOCAL_STORAGE_MAX_TOTAL_BYTES,
  type StudioOpfsDirectoryHandleLike,
  type StudioOpfsLegacyLocalStorageLike,
} from "./studio-opfs-filesystem";

// ── 도우미 ──────────────────────────────────────────────────────────────

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function jsonBytes(seed: number, count = 400): Uint8Array {
  return bytesOf(
    JSON.stringify({
      seed,
      rows: Array.from({ length: count }, (_unused, index) => ({
        id: `${seed}-${index}`,
        name: `항목 ${index}`,
        value: (index * 37 + seed) % 1000,
      })),
    })
  );
}

function createFakeLocalStorage(): StudioOpfsLegacyLocalStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function createEmptyOpfsDirectory(): StudioOpfsDirectoryHandleLike {
  const directory: StudioOpfsDirectoryHandleLike = {
    async getDirectoryHandle() {
      return directory;
    },
    async getFileHandle() {
      throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    },
    async removeEntry() {},
    async *keys() {},
  };
  return directory;
}

function fixedEstimator(usage: number, quota: number): StudioOpfsStorageEstimator {
  return { estimate: async () => ({ usage, quota }) };
}

interface Clock {
  (): number;
  advance(ms: number): void;
}

function createClock(start = 1_753_000_000_000): Clock {
  let value = start;
  const clock = (() => value) as Clock;
  clock.advance = (ms) => {
    value += ms;
  };
  return clock;
}

function memoryStore(overrides: Partial<Parameters<typeof createStudioOpfsAssetStore>[0]> = {}) {
  const fs = createStudioOpfsMemoryFileSystem();
  const store = createStudioOpfsAssetStore({ fs, ...overrides });
  return { fs, store };
}

// ── 왕복 ────────────────────────────────────────────────────────────────

describe("studio-opfs-asset-store · 저장/읽기/삭제 왕복", () => {
  it("저장한 바이트를 그대로 돌려준다", async () => {
    const { store } = memoryStore();
    const original = jsonBytes(1);
    const result = await store.put(original, { mime: "application/json" });

    expect(isStudioOpfsContentHash(result.ref.hash)).toBe(true);
    expect(result.ref.bytes).toBe(original.byteLength);
    expect(result.deduped).toBe(false);

    const restored = await store.get(result.ref.hash);
    expect(restored).not.toBeNull();
    expect(Array.from(restored as Uint8Array)).toEqual(Array.from(original));
  });

  it("압축된 자산도 원본 길이로 복원된다", async () => {
    const { store, fs } = memoryStore();
    const original = jsonBytes(2, 2_000);
    const { entry, ref } = await store.put(original, { mime: "application/json" });

    expect(entry.codec).toBe("gzip");
    expect(entry.storedBytes).toBeLessThan(entry.bytes);
    // 디스크에는 압축본이, 호출부에는 원본이 간다.
    expect((await fs.size(entry.path))).toBe(entry.storedBytes);
    expect((await store.get(ref.hash))?.byteLength).toBe(original.byteLength);
  });

  it("없는 해시와 형식이 틀린 해시는 null", async () => {
    const { store } = memoryStore();
    expect(await store.get(`sha256:${"0".repeat(64)}`)).toBeNull();
    expect(await store.get("not-a-hash")).toBeNull();
    expect(await store.has("not-a-hash")).toBe(false);
  });

  it("삭제하면 blob과 색인이 함께 사라진다", async () => {
    const { store, fs } = memoryStore();
    const { ref, entry } = await store.put(jsonBytes(3), { mime: "application/json" });

    expect(await store.delete(ref.hash)).toBe(true);
    expect(await store.get(ref.hash)).toBeNull();
    expect(await store.has(ref.hash)).toBe(false);
    expect(await fs.read(entry.path)).toBeNull();
    expect(await store.delete(ref.hash)).toBe(false);
  });

  it("새 저장소 인스턴스가 디스크의 색인을 읽어 이어받는다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    const first = createStudioOpfsAssetStore({ fs });
    const { ref } = await first.put(jsonBytes(4), { mime: "application/json" });

    const second = createStudioOpfsAssetStore({ fs });
    expect(await second.has(ref.hash)).toBe(true);
    expect((await second.get(ref.hash))?.byteLength).toBe(jsonBytes(4).byteLength);
  });

  it("빈 자산은 거절한다", async () => {
    const { store } = memoryStore();
    await expect(store.put(new Uint8Array(0))).rejects.toThrow(StudioOpfsError);
  });

  it("디스크의 blob이 조작되면 조용히 잘못된 바이트를 주는 대신 무결성 오류를 던진다", async () => {
    const { store, fs } = memoryStore();
    const { ref, entry } = await store.put(bytesOf("가".repeat(600)), { mime: "font/woff2" });
    await fs.write(entry.path, bytesOf("짧음"));

    await expect(store.get(ref.hash)).rejects.toThrow(/손상/u);
  });

  it("verify 옵션은 길이가 같아도 내용이 다르면 잡아낸다", async () => {
    const { store, fs } = memoryStore();
    const original = bytesOf("A".repeat(64));
    const { ref, entry } = await store.put(original, { mime: "application/octet-stream" });
    await fs.write(entry.path, bytesOf("B".repeat(64)));

    expect((await store.get(ref.hash))?.byteLength).toBe(64); // 길이 검사만으로는 통과
    await expect(store.get(ref.hash, { verify: true })).rejects.toThrow(/원본과 달라요/u);
  });
});

// ── 내용주소 중복 제거 ───────────────────────────────────────────────────

describe("studio-opfs-asset-store · 내용주소 중복 제거", () => {
  it("같은 바이트는 같은 해시·같은 파일 하나로 모인다", async () => {
    const { store, fs } = memoryStore();
    const payload = jsonBytes(7, 1_500);

    const first = await store.put(payload, { mime: "application/json" });
    const second = await store.put(Uint8Array.from(payload), { mime: "application/json" });

    expect(second.ref.hash).toBe(first.ref.hash);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect((await fs.list("blobs/")).length).toBe(1);
    expect((await store.list()).length).toBe(1);
  });

  it("중복 저장은 디스크에 다시 쓰지 않는다", async () => {
    const { store, fs } = memoryStore();
    const payload = jsonBytes(8, 1_500);
    await store.put(payload, { mime: "application/json" });
    const writesAfterFirst = fs.counts.write;

    await store.put(Uint8Array.from(payload), { mime: "application/json" });
    // 색인 갱신(lastAccessAt) 1회만 늘어야 한다 — blob은 다시 쓰지 않는다.
    expect(fs.counts.write - writesAfterFirst).toBe(1);
  });

  it("한 바이트만 달라도 다른 자산이다", async () => {
    const { store } = memoryStore();
    const a = await store.put(bytesOf("가나다라마"), { mime: "text/plain" });
    const b = await store.put(bytesOf("가나다라바"), { mime: "text/plain" });
    expect(a.ref.hash).not.toBe(b.ref.hash);
    expect((await store.list()).length).toBe(2);
  });

  it("해시는 압축 전 원본으로 계산하므로 코덱이 달라도 신원이 같다", async () => {
    const payload = jsonBytes(9, 1_500);
    const plain = memoryStore();
    const compressed = memoryStore();

    const rawResult = await plain.store.put(payload, { mime: "application/json", codec: "identity" });
    const gzResult = await compressed.store.put(payload, { mime: "application/json", codec: "gzip" });

    expect(rawResult.ref.hash).toBe(gzResult.ref.hash);
    expect(rawResult.entry.codec).toBe("identity");
    expect(gzResult.entry.codec).toBe("gzip");
  });

  it("해시 표기를 정규화한다", () => {
    const hash = `sha256:${"AB".repeat(32)}`;
    expect(canonicalizeStudioOpfsContentHash(hash)).toBe(`sha256:${"ab".repeat(32)}`);
    expect(canonicalizeStudioOpfsContentHash("sha256:zz")).toBeNull();
    expect(canonicalizeStudioOpfsContentHash(42)).toBeNull();
  });
});

// ── 쿼터 ────────────────────────────────────────────────────────────────

describe("studio-opfs-asset-store · 쿼터 인지", () => {
  it("여유가 충분하면 ok이고 안내 문구가 없다", async () => {
    const estimate = await estimateStudioOpfsQuota(fixedEstimator(100_000_000, 2_000_000_000));
    expect(estimate.level).toBe("ok");
    expect(estimate.message).toBeNull();
    expect(estimate.available).toBe(1_900_000_000);
  });

  it("80%를 넘으면 경고하고 숫자를 밝힌다", async () => {
    const estimate = await estimateStudioOpfsQuota(fixedEstimator(850_000_000, 1_000_000_000));
    expect(estimate.level).toBe("warn");
    expect(estimate.message).toContain("85%");
    expect(estimate.message).toContain(formatStudioOpfsBytes(150_000_000));
  });

  it("95%를 넘으면 심각으로 올린다", async () => {
    const estimate = await estimateStudioOpfsQuota(fixedEstimator(970_000_000, 1_000_000_000));
    expect(estimate.level).toBe("critical");
    expect(estimate.message).toMatch(/더 담기 어려워요/u);
  });

  it("estimate를 못 쓰면 추측하지 않고 unknown으로 남긴다", async () => {
    expect((await estimateStudioOpfsQuota(null)).level).toBe("unknown");
    expect((await estimateStudioOpfsQuota({ estimate: async () => ({}) })).level).toBe("unknown");
    expect(
      (await estimateStudioOpfsQuota({ estimate: async () => { throw new Error("denied"); } })).level
    ).toBe("unknown");
  });

  it("남은 용량이 예약분보다 적으면 저장을 거절하고 한국어로 이유를 말한다", async () => {
    const { store, fs } = memoryStore({
      estimator: fixedEstimator(1_000_000_000 - STUDIO_OPFS_QUOTA_RESERVE_BYTES - 1_000, 1_000_000_000),
    });
    await expect(store.put(jsonBytes(11, 2_000), { mime: "application/json" })).rejects.toThrow(
      /저장 공간이 .*남지 않아/u
    );
    // 거절은 디스크를 건드리지 않는다.
    expect(await fs.list("blobs/")).toEqual([]);
  });

  it("쿼터가 넉넉하면 같은 payload가 통과한다(거절이 임계값 때문임을 고정)", async () => {
    const { store } = memoryStore({ estimator: fixedEstimator(0, 1_000_000_000) });
    await expect(store.put(jsonBytes(11, 2_000), { mime: "application/json" })).resolves.toBeTruthy();
  });

  it("쿼터를 알 수 없으면 저장을 막지 않는다(사생활 보호 브라우저 대응)", async () => {
    const { store } = memoryStore({ estimator: null });
    await expect(store.put(jsonBytes(12), { mime: "application/json" })).resolves.toBeTruthy();
  });

  it("임계 판정은 비율과 절대 여유량 둘 다 본다", () => {
    expect(studioOpfsQuotaLevel(500_000_000, 0.1)).toBe("ok");
    expect(studioOpfsQuotaLevel(50_000_000, 0.1)).toBe("warn"); // 비율은 낮지만 여유가 적다
    expect(studioOpfsQuotaLevel(1_000, 0.1)).toBe("critical");
    expect(studioOpfsQuotaLevel(500_000_000, 0.96)).toBe("critical");
  });
});

// ── GC(mark-and-sweep) ───────────────────────────────────────────────────

describe("studio-opfs-asset-store · 회수(mark-and-sweep)", () => {
  async function seeded(): Promise<{
    store: StudioOpfsAssetStore;
    clock: Clock;
    referenced: string;
    orphan: string;
  }> {
    const clock = createClock();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, now: clock, graceMs: 1_000 });
    const kept = await store.put(bytesOf("살아 있는 자산"), { mime: "font/woff2" });
    const dropped = await store.put(bytesOf("버려진 자산"), { mime: "font/woff2" });
    await store.setOwnerRefs("custom-fonts", [kept.ref.hash]);
    return { store, clock, referenced: kept.ref.hash, orphan: dropped.ref.hash };
  }

  it("참조 없는 자산만 지우고 참조된 자산은 남긴다", async () => {
    const { store, clock, referenced, orphan } = await seeded();
    clock.advance(2_000);

    const result = await store.sweep();

    expect(result.removed.map((entry) => entry.hash)).toEqual([orphan]);
    expect(result.referenced).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(await store.has(referenced)).toBe(true);
    expect(await store.has(orphan)).toBe(false);
    expect((await store.get(referenced))).not.toBeNull();
  });

  it("유예 시간 안의 신규 자산은 참조가 없어도 지우지 않는다(커밋 전 경합 차단)", async () => {
    const { store, clock, orphan } = await seeded();
    clock.advance(500); // graceMs = 1_000

    const result = await store.sweep();

    expect(result.removed).toEqual([]);
    expect(result.retainedInGrace.map((entry) => entry.hash)).toEqual([orphan]);
    expect(await store.has(orphan)).toBe(true);
  });

  it("소유자가 참조를 놓으면 그 다음 sweep에서 회수된다", async () => {
    const { store, clock, referenced } = await seeded();
    await store.setOwnerRefs("custom-fonts", []);
    clock.advance(2_000);

    const result = await store.sweep();
    expect(result.removed.map((entry) => entry.hash)).toContain(referenced);
    expect(await store.has(referenced)).toBe(false);
  });

  it("다른 소유자가 하나라도 참조하면 지우지 않는다", async () => {
    const { store, clock, referenced } = await seeded();
    await store.setOwnerRefs("clips", [referenced]);
    await store.setOwnerRefs("custom-fonts", []);
    clock.advance(2_000);

    await store.sweep();
    expect(await store.has(referenced)).toBe(true);
  });

  it("sweep은 멱등하다 — 두 번째 실행은 아무것도 지우지 않는다", async () => {
    const { store, clock } = await seeded();
    clock.advance(2_000);

    const first = await store.sweep();
    const second = await store.sweep();

    expect(first.removed.length).toBe(1);
    expect(second.removed).toEqual([]);
    expect(second.referenced).toBe(1);
  });

  it("dryRun은 계산만 하고 아무것도 지우지 않는다", async () => {
    const { store, clock, orphan } = await seeded();
    clock.advance(2_000);

    const dry = await store.sweep({ dryRun: true });
    expect(dry.removed.map((entry) => entry.hash)).toEqual([orphan]);
    expect(await store.has(orphan)).toBe(true);

    const wet = await store.sweep();
    expect(wet.removed.map((entry) => entry.hash)).toEqual([orphan]);
  });

  it("소유자 참조 갱신은 통째 교체이자 멱등이다", async () => {
    const { store } = memoryStore();
    const a = await store.put(bytesOf("자산 A"), { mime: "text/plain" });
    const b = await store.put(bytesOf("자산 B"), { mime: "text/plain" });

    await store.setOwnerRefs("fonts", [a.ref.hash, a.ref.hash, "쓰레기"]);
    expect(await store.ownerRefs("fonts")).toEqual([a.ref.hash]);

    await store.setOwnerRefs("fonts", [b.ref.hash]);
    expect(await store.ownerRefs("fonts")).toEqual([b.ref.hash]);
    expect(await store.owners()).toEqual(["fonts"]);
  });

  it("색인이 사라져도 디스크에서 다시 세우고 소유자 참조를 지킨다", async () => {
    const clock = createClock();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, now: clock, graceMs: 1_000 });
    const payload = jsonBytes(21, 1_500);
    const { ref } = await store.put(payload, { mime: "application/json" });
    await store.setOwnerRefs("fonts", [ref.hash]);

    // 색인만 날아간 상태(중단된 색인 쓰기·다른 탭의 덮어쓰기)를 재현한다.
    await fs.remove("index.json");
    const revived = createStudioOpfsAssetStore({ fs, now: clock, graceMs: 1_000 });
    const rebuilt = await revived.rebuildIndex();

    // blob 자체는 내용주소라 살아 있고, 원본 길이도 압축을 풀어 정확히 복원한다.
    expect(rebuilt.map((entry) => entry.hash)).toEqual([ref.hash]);
    expect(rebuilt[0]?.bytes).toBe(payload.byteLength);
    expect(Array.from((await revived.get(ref.hash)) as Uint8Array)).toEqual(Array.from(payload));

    // 색인과 함께 소유자 참조도 사라졌으므로, 보관함이 참조를 다시 걸어 주면 sweep이 지키고
    // 걸지 않으면 유예 후 회수한다 — 어느 쪽도 "살아 있는 자산을 말없이 삭제"가 아니다.
    await revived.setOwnerRefs("fonts", [ref.hash]);
    clock.advance(2_000);
    expect((await revived.sweep()).removed).toEqual([]);
    expect(await revived.has(ref.hash)).toBe(true);
  });

  it("재구성은 색인에 없던 고아 파일을 입양한다(다음 sweep이 정상 회수하도록)", async () => {
    const clock = createClock();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, now: clock, graceMs: 1_000 });
    const first = await store.put(bytesOf("남아 있는 자산"), { mime: "text/plain" });

    // 다른 탭이 만든 blob처럼, 색인에 없는 파일을 심는다.
    await fs.write(`blobs/${"ab".repeat(32)}.bin`, bytesOf("고아"));

    const rebuilt = await store.rebuildIndex();
    expect(rebuilt.map((entry) => entry.hash).sort()).toEqual(
      [first.ref.hash, `sha256:${"ab".repeat(32)}`].sort()
    );
  });
});

// ── 동시성 ──────────────────────────────────────────────────────────────

describe("studio-opfs-asset-store · 동시 쓰기 안전성", () => {
  it("독립 store가 origin-wide lock 안에서 fresh index를 읽어 갱신을 잃지 않는다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    let tail: Promise<unknown> = Promise.resolve();
    let active = 0;
    let maximumActive = 0;
    const mutationRunExclusive = <T>(task: () => Promise<T>): Promise<T> => {
      const run = tail.then(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return await task();
        } finally {
          active -= 1;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    };
    const first = createStudioOpfsAssetStore({ fs, mutationRunExclusive });
    const second = createStudioOpfsAssetStore({ fs, mutationRunExclusive });
    // Both instances observe the initial empty index before their competing mutations.
    await Promise.all([first.list(), second.list()]);

    const [a, b] = await Promise.all([
      first.put(bytesOf("탭 A 자산"), { mime: "text/plain" }),
      second.put(bytesOf("탭 B 자산"), { mime: "text/plain" }),
    ]);
    await Promise.all([
      first.setOwnerRefs("owner-a", [a.ref.hash]),
      second.setOwnerRefs("owner-b", [b.ref.hash]),
    ]);

    const reopened = createStudioOpfsAssetStore({ fs });
    expect(maximumActive).toBe(1);
    expect((await reopened.list()).map(({ hash }) => hash).sort())
      .toEqual([a.ref.hash, b.ref.hash].sort());
    expect(await reopened.ownerRefs("owner-a")).toEqual([a.ref.hash]);
    expect(await reopened.ownerRefs("owner-b")).toEqual([b.ref.hash]);
  });

  it("손상된 index를 empty로 덮지 않고 기존 blob과 owner를 보존한다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs });
    const existing = await store.put(bytesOf("기존 자산"), { mime: "text/plain" });
    await store.setOwnerRefs("existing-owner", [existing.ref.hash]);
    const blobBefore = fs.snapshot().get(existing.entry.path)!;
    const corrupt = new TextEncoder().encode(JSON.stringify({
      version: 1,
      entries: [{
        ...existing.entry,
        path: "index.json",
      }],
      owners: [{ owner: "existing-owner", hashes: [existing.ref.hash], updatedAt: 1 }],
    }));
    await fs.write("index.json", corrupt);

    await expect(store.put(bytesOf("신규 자산"), { mime: "text/plain" }))
      .rejects.toMatchObject({ code: "CORRUPT_ENTRY" });
    expect(fs.snapshot().get("index.json")).toEqual(corrupt);
    expect(fs.snapshot().get(existing.entry.path)).toEqual(blobBefore);
  });

  it("미래 index 버전을 empty로 간주해 기존 owner를 덮지 않는다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    const seed = createStudioOpfsAssetStore({ fs });
    const existing = await seed.put(bytesOf("미래 버전 전 자산"), { mime: "text/plain" });
    await seed.setOwnerRefs("existing-owner", [existing.ref.hash]);
    const validIndex = fs.snapshot().get("index.json")!;
    const futureDocument = JSON.parse(new TextDecoder().decode(validIndex)) as Record<string, unknown>;
    futureDocument.version = 99;
    const futureIndex = new TextEncoder().encode(JSON.stringify(futureDocument));
    await fs.write("index.json", futureIndex);
    const reopened = createStudioOpfsAssetStore({ fs });

    await expect(reopened.setOwnerRefs("new-owner", [existing.ref.hash]))
      .rejects.toMatchObject({ code: "CORRUPT_ENTRY" });
    expect(fs.snapshot().get("index.json")).toEqual(futureIndex);
    expect(fs.snapshot().get(existing.entry.path)).toBeDefined();
  });

  it("index 읽기 실패를 empty로 덮지 않고 mutation을 fail-closed 한다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    const seed = createStudioOpfsAssetStore({ fs });
    const existing = await seed.put(bytesOf("읽기 실패 전 자산"), { mime: "text/plain" });
    await seed.setOwnerRefs("existing-owner", [existing.ref.hash]);
    const before = fs.snapshot();
    fs.restart({ failReadAfter: 1 });
    const faulting = createStudioOpfsAssetStore({ fs });

    await expect(faulting.setOwnerRefs("new-owner", [existing.ref.hash]))
      .rejects.toMatchObject({ code: "READ_FAILED" });
    expect(fs.snapshot()).toEqual(before);
  });

  it("같은 자산을 동시에 20번 저장해도 파일은 하나이고 색인은 정확하다", async () => {
    const { store, fs } = memoryStore();
    const payload = jsonBytes(31, 1_200);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.put(Uint8Array.from(payload), { mime: "application/json" }))
    );

    const hashes = new Set(results.map((result) => result.ref.hash));
    expect(hashes.size).toBe(1);
    expect(results.filter((result) => !result.deduped).length).toBe(1);
    expect(results.filter((result) => result.deduped).length).toBe(19);
    expect((await fs.list("blobs/")).length).toBe(1);
    expect((await store.list()).length).toBe(1);
  });

  it("서로 다른 자산을 동시에 저장해도 색인 갱신이 사라지지 않는다", async () => {
    const { store, fs } = memoryStore();

    const results = await Promise.all(
      Array.from({ length: 24 }, (_unused, index) => store.put(jsonBytes(100 + index, 60), { mime: "application/json" }))
    );

    const hashes = [...new Set(results.map((result) => result.ref.hash))];
    expect(hashes.length).toBe(24);
    expect((await store.list()).length).toBe(24);
    expect((await fs.list("blobs/")).length).toBe(24);

    // 마지막 색인 쓰기 이후 새 저장소가 읽어도 24개가 전부 살아 있어야 한다(lost update 없음).
    const reopened = createStudioOpfsAssetStore({ fs });
    expect((await reopened.list()).length).toBe(24);
    for (const hash of hashes) expect(await reopened.has(hash)).toBe(true);
  });

  it("저장·참조 갱신·sweep이 뒤엉켜도 참조된 자산은 살아남는다", async () => {
    const clock = createClock();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, now: clock, graceMs: 0 });
    const keep = await store.put(bytesOf("반드시 남는 자산"), { mime: "text/plain" });
    await store.setOwnerRefs("fonts", [keep.ref.hash]);

    await Promise.all([
      store.put(jsonBytes(41, 40), { mime: "application/json" }),
      store.sweep(),
      store.put(jsonBytes(42, 40), { mime: "application/json" }),
      store.sweep(),
      store.setOwnerRefs("clips", [keep.ref.hash]),
    ]);

    expect(await store.has(keep.ref.hash)).toBe(true);
    expect(await store.get(keep.ref.hash)).not.toBeNull();
  });
});

// ── 제품 선택과 명시적 legacy 어댑터 ───────────────────────────────────

describe("studio-opfs-asset-store · OPFS 제품 선택", () => {
  it("OPFS가 없으면 localStorage를 읽지 않고 명시적 memory-only를 고른다", async () => {
    const storage = createFakeLocalStorage();
    let localStorageAccesses = 0;
    const scope = {
      navigator: undefined,
      get localStorage() {
        localStorageAccesses += 1;
        return storage;
      },
    };
    const selection = await selectStudioOpfsFileSystem(scope);
    expect(selection.kind).toBe("memory");
    expect(selection.durability).toBe("memory-only");
    expect(selection.reason).toMatch(/새로고침하면 사라집니다/u);
    expect(localStorageAccesses).toBe(0);
    expect(storage.map.size).toBe(0);
  });

  it("getDirectory가 있어도 호출이 던지면 원인을 담은 memory-only가 된다", async () => {
    const denied = new Error("denied");
    const selection = await selectStudioOpfsFileSystem({
      navigator: { storage: { getDirectory: async () => { throw denied; } } },
    });
    expect(selection.kind).toBe("memory");
    expect(selection.durability).toBe("memory-only");
    expect(selection.cause).toBeInstanceOf(StudioOpfsError);
    expect((selection.cause as StudioOpfsError).cause).toBe(denied);
  });

  it("OPFS API 자체가 없으면 세션 한정 메모리 저장소와 명시적 원인을 반환한다", async () => {
    const selection = await selectStudioOpfsFileSystem({});
    expect(selection.kind).toBe("memory");
    expect(selection.durability).toBe("memory-only");
    expect(selection.cause).toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("실제 디렉터리 probe가 성공해야 durable OPFS로 승격한다", async () => {
    const directory = createEmptyOpfsDirectory();
    const selection = await selectStudioOpfsFileSystem({
      navigator: {
        storage: {
          getDirectory: async () => directory,
        },
      },
    });
    expect(selection).toMatchObject({
      kind: "opfs",
      durability: "durable",
      cause: null,
    });
  });
});

describe("studio-opfs-asset-store · 명시적 legacy localStorage import/test 어댑터", () => {
  it("명시적으로 만들면 저장/읽기/삭제와 중복 제거가 동작한다", async () => {
    const storage = createFakeLocalStorage();
    const fs = createStudioOpfsLegacyLocalStorageFileSystem(storage);
    const store = createStudioOpfsAssetStore({ fs });

    const payload = jsonBytes(51, 800);
    const first = await store.put(payload, { mime: "application/json" });
    const second = await store.put(Uint8Array.from(payload), { mime: "application/json" });

    expect(second.ref.hash).toBe(first.ref.hash);
    expect(second.deduped).toBe(true);
    expect(Array.from((await store.get(first.ref.hash)) as Uint8Array)).toEqual(Array.from(payload));
    expect(await store.delete(first.ref.hash)).toBe(true);
    expect(await store.get(first.ref.hash)).toBeNull();
  });

  it("legacy 상한을 넘으면 조용히 자르지 않고 숫자를 밝혀 거절한다", async () => {
    const storage = createFakeLocalStorage();
    const fs = createStudioOpfsLegacyLocalStorageFileSystem(storage, { maxTotalBytes: 20_000 });
    const store = createStudioOpfsAssetStore({ fs });

    await store.put(new Uint8Array(15_000).fill(7), { mime: "font/woff2" });
    await expect(store.put(new Uint8Array(15_000).fill(9), { mime: "font/woff2" })).rejects.toThrow(
      /OPFS\)를 지원하지 않아/u
    );
    // 거절 후에도 기존 자산은 멀쩡하다.
    expect((await store.list()).length).toBe(1);
  });

  it("legacy 기본 상한은 나머지 localStorage 예산을 침범하지 않는 크기다", () => {
    expect(STUDIO_OPFS_LEGACY_LOCAL_STORAGE_MAX_TOTAL_BYTES).toBeLessThanOrEqual(2_000_000);
  });

  it("legacy 어댑터의 write는 실패해도 이전 내용을 남긴다(원자성)", async () => {
    const storage = createFakeLocalStorage();
    const fs = createStudioOpfsLegacyLocalStorageFileSystem(storage, { maxTotalBytes: 10_000 });
    await fs.write("blobs/aa.bin", new Uint8Array(5_000).fill(1));
    await expect(fs.write("blobs/aa.bin", new Uint8Array(20_000).fill(2))).rejects.toThrow(StudioOpfsError);
    expect((await fs.read("blobs/aa.bin"))?.byteLength).toBe(5_000);
  });
});

// ── 경로 위생 ────────────────────────────────────────────────────────────

describe("studio-opfs-filesystem · 경로 규칙", () => {
  it("상대 경로만 허용하고 탈출을 막는다", () => {
    expect(isValidStudioOpfsPath("blobs/abc.bin")).toBe(true);
    expect(isValidStudioOpfsPath("index.json")).toBe(true);
    expect(isValidStudioOpfsPath("../secret")).toBe(false);
    expect(isValidStudioOpfsPath("/blobs/abc.bin")).toBe(false);
    expect(isValidStudioOpfsPath("blobs/../../x")).toBe(false);
    expect(isValidStudioOpfsPath("blobs/AB.bin")).toBe(false);
    expect(isValidStudioOpfsPath("")).toBe(false);
    expect(isValidStudioOpfsPath("a/b/c/d/e")).toBe(false);
  });

  it("잘못된 경로는 한국어 오류로 거절한다", async () => {
    const fs = createStudioOpfsMemoryFileSystem();
    await expect(fs.read("../secret")).rejects.toThrow(/저장 경로가 올바르지 않아요/u);
  });

  it("용량 표기는 10진 눈금·한국어 로케일", () => {
    expect(formatStudioOpfsBytes(512)).toBe("512 B");
    expect(formatStudioOpfsBytes(2_000_000)).toBe("2 MB");
    expect(formatStudioOpfsBytes(3_500_000_000)).toBe("3.5 GB");
    expect(formatStudioOpfsBytes(Number.NaN)).toBe("용량 미확인");
  });
});
