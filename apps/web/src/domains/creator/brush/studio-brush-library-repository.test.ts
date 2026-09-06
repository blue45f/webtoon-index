import { describe, expect, it } from "vitest";

import {
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  BrushLibraryRepositoryError,
  brushLibraryPageIsDeterministic,
  createBrushLibraryRepository,
  createStorageBrushLibraryRepository,
  queryBrushLibraryPage,
  type BrushLibraryAdapterQuery,
  type BrushLibraryRepositoryAdapter,
} from "./studio-brush-library-repository";

function savedBrush(
  id: string,
  sequence: number,
  overrides: Partial<StudioSavedBrush> = {}
): StudioSavedBrush {
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    id,
    name: `브러시 ${id}`,
    createdAt: sequence,
    updatedAt: sequence,
    pinned: false,
    lastUsedAt: null,
    ...overrides,
  };
}

function fakeStorage(initial: readonly StudioSavedBrush[] = []) {
  const map = new Map<string, string>();
  if (initial.length > 0) {
    map.set(BRUSH_LIBRARY_KEY, JSON.stringify({
      version: BRUSH_LIBRARY_STORAGE_VERSION,
      brushes: initial,
    }));
  }
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    map,
  };
}

describe("queryBrushLibraryPage", () => {
  it("고정·활동·생성 시각 동률에서도 id로 완전 순서를 만들고 입력을 변경하지 않는다", () => {
    const input = [savedBrush("z", 10), savedBrush("a", 10), savedBrush("m", 10)];
    const before = input.map((brush) => brush.id);
    const page = queryBrushLibraryPage(input, { limit: 10 });

    expect(page.items.map((brush) => brush.id)).toEqual(["a", "m", "z"]);
    expect(input.map((brush) => brush.id)).toEqual(before);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, totalCount: 3 });
    expect(brushLibraryPageIsDeterministic(page.items)).toBe(true);
  });

  it("5,000개를 keyset cursor로 빠짐·중복 없이 페이지 순회한다", () => {
    const brushes = Array.from(
      { length: 5_000 },
      (_, index) => savedBrush(`brush-${String(index).padStart(5, "0")}`, index)
    );
    const visited: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const page = queryBrushLibraryPage(brushes, { cursor, limit: 257 });
      expect(page.items.length).toBeLessThanOrEqual(257);
      expect(brushLibraryPageIsDeterministic(page.items)).toBe(true);
      visited.push(...page.items.map((brush) => brush.id));
      cursor = page.nextCursor;
      pageCount += 1;
    } while (cursor);

    expect(pageCount).toBe(20);
    expect(visited).toHaveLength(5_000);
    expect(new Set(visited)).toHaveLength(5_000);
    expect(visited[0]).toBe("brush-04999");
    expect(visited.at(-1)).toBe("brush-00000");
  });

  it("cursor 이후에 더 최신 항목이 추가돼도 이미 본 페이지를 반복하지 않는다", () => {
    const original = Array.from(
      { length: 1_000 },
      (_, index) => savedBrush(`brush-${String(index).padStart(4, "0")}`, index)
    );
    const first = queryBrushLibraryPage(original, { limit: 50 });
    const inserted = savedBrush("newest", 10_000, { pinned: true });
    const second = queryBrushLibraryPage([inserted, ...original], {
      cursor: first.nextCursor,
      limit: 50,
    });
    const firstIds = new Set(first.items.map((brush) => brush.id));

    expect(second.items.every((brush) => !firstIds.has(brush.id))).toBe(true);
    expect(second.items.map((brush) => brush.id)).not.toContain("newest");
    expect(second.items[0]?.id).toBe("brush-0949");
  });

  it("검색·렌더 패밀리·고정 필터를 cursor 전체에 고정한다", () => {
    const families = ["pen", "watercolor", "pencil"] as const;
    const brushes = Array.from({ length: 6_000 }, (_, index) => {
      const brushId = families[index % families.length];
      return savedBrush(`brush-${index}`, index, {
        brushId,
        name: index % 30 === 1 ? `대상 TARGET ${index}` : `일반 ${index}`,
        pinned: index % 2 === 1,
      });
    });
    const first = queryBrushLibraryPage(brushes, {
      search: "  target  ",
      category: "watercolor",
      pinned: true,
      limit: 17,
    });
    const second = queryBrushLibraryPage(brushes, {
      search: "TARGET",
      category: "watercolor",
      pinned: true,
      cursor: first.nextCursor,
      limit: 17,
    });

    expect(first.items.length).toBeGreaterThan(0);
    expect([...first.items, ...second.items].every((brush) =>
      brush.brushId === "watercolor"
      && brush.pinned
      && brush.name.includes("TARGET")
    )).toBe(true);
    expect(() => queryBrushLibraryPage(brushes, {
      search: "different-query",
      category: "watercolor",
      pinned: true,
      cursor: first.nextCursor,
      limit: 17,
    })).toThrowError(BrushLibraryRepositoryError);
  });

  it("페이지 크기는 저장 상한이 아니며 양의 safe integer만 허용한다", () => {
    const brushes = Array.from({ length: 3_000 }, (_, index) => savedBrush(`b${index}`, index));
    expect(queryBrushLibraryPage(brushes, { limit: 3_000 }).items).toHaveLength(3_000);
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => queryBrushLibraryPage(brushes, { limit })).toThrowError(RangeError);
    }
  });
});

describe("createStorageBrushLibraryRepository", () => {
  it("5,001개 가져오기·중복 축약·페이지·복제·삭제·복원을 무제한 권위 계약으로 수행한다", async () => {
    const storage = fakeStorage();
    const repository = createStorageBrushLibraryRepository(storage);
    const incoming = Array.from(
      { length: 5_001 },
      (_, index) => savedBrush(`brush-${String(index).padStart(5, "0")}`, index)
    );
    const firstDuplicate = { ...incoming[2_500], name: "첫 중복" };
    const ignoredDuplicate = { ...incoming[2_500], name: "무시할 중복" };

    const imported = await repository.putMany([
      ...incoming.slice(0, 2_500),
      firstDuplicate,
      ignoredDuplicate,
      ...incoming.slice(2_501),
    ]);
    const first = await repository.query({ limit: 73 });
    const sameFirst = await repository.query({ limit: 73 });
    const storedDuplicate = await repository.getById(firstDuplicate.id);

    expect(repository.capacity).toBe("unbounded");
    expect(imported).toEqual({ savedCount: 5_001, skippedDuplicateCount: 1 });
    expect(first).toMatchObject({ hasMore: true, totalCount: 5_001 });
    expect(first.items).toHaveLength(73);
    expect(first.items.map((brush) => brush.id)).toEqual(
      sameFirst.items.map((brush) => brush.id)
    );
    expect(storedDuplicate?.name).toBe("첫 중복");

    const duplicate = await repository.duplicate("brush-00000");
    expect(duplicate).not.toBeNull();
    expect(await repository.getById(duplicate!.id)).toEqual(duplicate);

    const deleted = await repository.delete("brush-02500");
    expect(deleted).toMatchObject({ brush: { id: "brush-02500", name: "첫 중복" } });
    expect(await repository.getById("brush-02500")).toBeNull();
    await repository.restore(deleted!);
    expect(await repository.getById("brush-02500")).toMatchObject({
      id: "brush-02500",
      name: "첫 중복",
    });

    const all = await repository.query({ limit: 6_000 });
    expect(all.items).toHaveLength(5_002);
    expect(new Set(all.items.map((brush) => brush.id))).toHaveLength(5_002);
    expect(brushLibraryPageIsDeterministic(all.items)).toBe(true);
  });

  it("실제 저장 장치 quota 오류를 일반 write 오류와 구분한다", async () => {
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const repository = createStorageBrushLibraryRepository({
      getItem: () => null,
      setItem: () => { throw quota; },
    });

    await expect(repository.put(savedBrush("quota", 1))).rejects.toMatchObject({
      name: "BrushLibraryRepositoryError",
      code: "quota-exceeded",
      detail: quota,
    });
  });

  it("깨진 기존 envelope를 빈 라이브러리로 덮어쓰지 않는다", async () => {
    const storage = fakeStorage();
    storage.map.set(BRUSH_LIBRARY_KEY, "{broken");
    const repository = createStorageBrushLibraryRepository(storage);

    await expect(repository.query()).rejects.toMatchObject({ code: "corrupt" });
    await expect(repository.put(savedBrush("new", 1))).rejects.toMatchObject({ code: "corrupt" });
    expect(storage.map.get(BRUSH_LIBRARY_KEY)).toBe("{broken");
  });
});

describe("createBrushLibraryRepository SQLite adapter seam", () => {
  it("opaque cursor를 SQL이 사용할 정렬 keyset으로 해석하고 page 크기만 adapter에 전달한다", async () => {
    const rows = Array.from({ length: 3_000 }, (_, offset) => {
      const sequence = 2_999 - offset;
      return savedBrush(`sql-${String(sequence).padStart(4, "0")}`, sequence, {
        name: `Target ${sequence}`,
      });
    });
    const queries: BrushLibraryAdapterQuery[] = [];
    const adapter: BrushLibraryRepositoryAdapter = {
      query: (input) => {
        queries.push(input);
        const start = input.after
          ? rows.findIndex((brush) => brush.id === input.after?.id) + 1
          : 0;
        const items = rows.slice(start, start + input.limit);
        return Promise.resolve({
          items,
          hasMore: start + items.length < rows.length,
          totalCount: rows.length,
        });
      },
      getById: (id) => Promise.resolve(rows.find((brush) => brush.id === id) ?? null),
      put: (brush) => Promise.resolve(brush),
      putMany: (brushes) => Promise.resolve({
        savedCount: brushes.length,
        skippedDuplicateCount: 0,
      }),
      delete: () => Promise.resolve(null),
      restore: (deleted) => Promise.resolve(deleted.brush),
      duplicate: () => Promise.resolve(null),
    };
    const repository = createBrushLibraryRepository(adapter);

    const first = await repository.query({ search: " target ", limit: 41 });
    const second = await repository.query({
      search: "TARGET",
      cursor: first.nextCursor,
      limit: 41,
    });

    expect(first.items).toHaveLength(41);
    expect(second.items).toHaveLength(41);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({
      limit: 41,
      search: "target",
      category: "all",
      pinned: null,
      after: null,
    });
    expect(queries[1]?.after).toEqual({
      pinned: false,
      activityAt: 2_959,
      createdAt: 2_959,
      id: "sql-2959",
    });
    expect(new Set([
      ...first.items.map((brush) => brush.id),
      ...second.items.map((brush) => brush.id),
    ])).toHaveLength(82);
  });

  it("SQLite adapter가 page 크기·필터·정렬 계약을 어기면 fail closed한다", async () => {
    const invalid = savedBrush("not-watercolor", 1, { brushId: "pen" });
    const adapter: BrushLibraryRepositoryAdapter = {
      query: () => Promise.resolve({ items: [invalid], hasMore: false, totalCount: 1 }),
      getById: () => Promise.resolve(null),
      put: (brush) => Promise.resolve(brush),
      putMany: () => Promise.resolve({ savedCount: 0, skippedDuplicateCount: 0 }),
      delete: () => Promise.resolve(null),
      restore: (deleted) => Promise.resolve(deleted.brush),
      duplicate: () => Promise.resolve(null),
    };

    await expect(createBrushLibraryRepository(adapter).query({
      category: "watercolor",
      limit: 1,
    })).rejects.toMatchObject({ code: "corrupt" });
  });
});
