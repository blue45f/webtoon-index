import { afterEach, describe, expect, it } from "vitest";

import {
  adaptationsOf,
  allTitles,
  getCatalogState,
  replaceCatalogData,
} from "../server/catalog-store";

import { makeTitle } from "./fixtures";

describe("runtime catalog store", () => {
  const originalTitles = allTitles();
  const originalState = getCatalogState();

  afterEach(() => {
    replaceCatalogData(originalTitles, {
      source: originalState.source,
      sourceVersion: originalState.sourceVersion,
      seedFallback: originalState.seedFallback,
    });
  });

  it("DB snapshot input이 비어 있어도 titles.ts seed 파일로 폴백하지 않는다", () => {
    const next = replaceCatalogData([], {
      source: "database-snapshot",
      sourceVersion: "empty-db-test",
    });

    expect(next).toEqual([]);
    expect(allTitles()).toHaveLength(0);
    expect(getCatalogState()).toMatchObject({
      source: "database-snapshot",
      sourceVersion: "empty-db-test",
      titleCount: 0,
      seedFallback: false,
    });
  });

  it("파일 전용 운영의 file-snapshot 출처를 상태에 반영한다(gz 파일 로드 경로)", () => {
    const next = replaceCatalogData([makeTitle({ id: "file-1" })], {
      source: "file-snapshot",
      sourceVersion: "file:catalog.json.gz",
    });

    expect(next).toHaveLength(1);
    expect(getCatalogState()).toMatchObject({
      source: "file-snapshot",
      sourceVersion: "file:catalog.json.gz",
      titleCount: 1,
      seedFallback: false,
    });
  });

  it("원작→2차창작 색인을 로드 시 구성해 adaptationsOf 가 전체 스캔 없이 동작한다", () => {
    const original = makeTitle({ id: "novel-1", type: "webnovel" });
    const adaptation = makeTitle({ id: "toon-1", adaptedFrom: "novel-1" });
    const unrelated = makeTitle({ id: "toon-2" });
    replaceCatalogData([original, adaptation, unrelated], {
      source: "database-snapshot",
      sourceVersion: "adaptations-index-test",
    });

    expect(adaptationsOf(original).map((t) => t.id)).toEqual(["toon-1"]);
    expect(adaptationsOf(adaptation)).toEqual([]);
    // 반환 배열을 변형해도 내부 색인은 오염되지 않는다(방어적 복사)
    adaptationsOf(original).pop();
    expect(adaptationsOf(original)).toHaveLength(1);

    // 카탈로그 교체 시 색인도 함께 재구성된다
    replaceCatalogData([unrelated], { source: "database-snapshot", sourceVersion: "adaptations-rebuild" });
    expect(adaptationsOf(original)).toEqual([]);
  });

  it("리뷰 파일 seed API를 런타임 카탈로그 저장소에 노출하지 않는다", async () => {
    replaceCatalogData([], {
      source: "database-snapshot",
      sourceVersion: "empty-db-test",
    });

    const store = await import("../server/catalog-store");
    expect("reviewsFor" in store).toBe(false);
    expect("allReviewsJoined" in store).toBe(false);
    expect("SEED_REVIEWS" in store).toBe(false);
  });
});
