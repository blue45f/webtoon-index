import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadCatalogTitlesFromFile,
  readCatalogFileSummary,
  resolveCatalogFile,
  resolveCatalogFileForWrite,
  statCatalogFile,
  writeCatalogTitlesToFile,
} from "../../../../../../apps/api/src/server/catalog-file";
import {
  isCatalogForceDb,
  loadLatestCatalogSnapshotFromFile,
  persistCatalogSnapshotToFile,
  refreshCatalogIfChanged,
} from "../../../../../../apps/api/src/server/catalog-ingest";
import { allTitles, getCatalogState, replaceCatalogData } from "../server/catalog-store";

import { makeTitle } from "./fixtures";

// 카탈로그 파일 전용 경로(쓰기·스탯 폴링·핫 리로드)는 실제 fs 로 검증한다 — DB mock 불필요(전송 0 설계).
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "webdex-catalog-file-"));
const gzPath = path.join(tmpDir, "catalog.json.gz");

const originalTitles = allTitles();
const originalState = getCatalogState();
const ORIGINAL_FILE_ENV = process.env.WEBDEX_CATALOG_FILE;
const ORIGINAL_GZ_ENV = process.env.WEBDEX_CATALOG_GZ;
const ORIGINAL_FORCE_DB = process.env.WEBDEX_CATALOG_FORCE_DB;

beforeEach(() => {
  process.env.WEBDEX_CATALOG_FILE = gzPath;
  delete process.env.WEBDEX_CATALOG_GZ;
  delete process.env.WEBDEX_CATALOG_FORCE_DB; // 파일 모드(기본)
});

afterEach(() => {
  if (ORIGINAL_FILE_ENV == null) delete process.env.WEBDEX_CATALOG_FILE;
  else process.env.WEBDEX_CATALOG_FILE = ORIGINAL_FILE_ENV;
  if (ORIGINAL_GZ_ENV == null) delete process.env.WEBDEX_CATALOG_GZ;
  else process.env.WEBDEX_CATALOG_GZ = ORIGINAL_GZ_ENV;
  if (ORIGINAL_FORCE_DB == null) delete process.env.WEBDEX_CATALOG_FORCE_DB;
  else process.env.WEBDEX_CATALOG_FORCE_DB = ORIGINAL_FORCE_DB;
  // 전역 메모리 카탈로그 복원(다른 테스트 오염 방지)
  replaceCatalogData(originalTitles, {
    source: originalState.source,
    sourceVersion: originalState.sourceVersion,
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("catalog-file: 경로 해석", () => {
  it("WEBDEX_CATALOG_FILE 이 설정되면 그 경로만 본다(없으면 null — 번들 폴백으로 새지 않음)", () => {
    expect(resolveCatalogFile({ WEBDEX_CATALOG_FILE: path.join(tmpDir, "missing.gz") })).toBeNull();
    expect(statCatalogFile({ WEBDEX_CATALOG_FILE: path.join(tmpDir, "missing.gz") })).toBeNull();
    // 쓰기 경로는 아직 없어도 그대로 돌려준다(ingest 가 생성)
    expect(resolveCatalogFileForWrite({ WEBDEX_CATALOG_FILE: path.join(tmpDir, "missing.gz") })).toBe(
      path.join(tmpDir, "missing.gz")
    );
  });

  it("레거시 별칭 WEBDEX_CATALOG_GZ 도 계속 동작한다", () => {
    writeCatalogTitlesToFile({ titles: [makeTitle({ id: "alias-1" })], runHash: "alias-hash" });
    const loaded = loadCatalogTitlesFromFile({ WEBDEX_CATALOG_GZ: gzPath });
    expect(loaded?.titles.map((t) => t.id)).toEqual(["alias-1"]);
  });
});

describe("catalog-file: 원자적 쓰기 + {titles,...} 래퍼 포맷", () => {
  it("gz 래퍼({titles,count,sourceVersion,runHash,...})를 쓰고 읽는다 — 소비자 호환 포맷", () => {
    const titles = [makeTitle({ id: "w-1" }), makeTitle({ id: "w-2" })];
    const file = writeCatalogTitlesToFile({
      titles,
      sourceVersion: "crawl/test",
      crawledAt: "2026-06-12T00:00:00.000Z",
      metadata: { sources: { naverWebtoon: 2 } },
      runHash: "hash-a",
    });
    expect(file).toBe(gzPath);
    expect(existsSync(gzPath)).toBe(true);

    // 임시 파일이 남지 않는다(tmp 쓰기 → rename)
    expect(readdirSync(tmpDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    // build-static-catalog/news-gen 과 동일한 방식(gunzip→parse→.titles)으로 읽힌다
    const wrapper = JSON.parse(gunzipSync(readFileSync(gzPath)).toString("utf8"));
    expect(Array.isArray(wrapper.titles)).toBe(true);
    expect(wrapper.count).toBe(2);
    expect(wrapper.sourceVersion).toBe("crawl/test");
    expect(wrapper.runHash).toBe("hash-a");
    expect(wrapper.metadata).toEqual({ sources: { naverWebtoon: 2 } });

    const loaded = loadCatalogTitlesFromFile();
    expect(loaded?.titles.map((t) => t.id)).toEqual(["w-1", "w-2"]);
    expect(loaded?.runHash).toBe("hash-a");
    expect(loaded?.sourceVersion).toBe("file:catalog.json.gz");
  });

  it("runHash 없는 레거시 gz(기존 catalog:update 산출물)도 로드된다 — 폴링 id 는 스탯 태그로 폴백", async () => {
    // 기존 파이프라인(crawl --json | gzip)이 만든 래퍼에는 runHash 가 없다.
    const { gzipSync } = await import("node:zlib");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      gzPath,
      gzipSync(
        Buffer.from(
          JSON.stringify({ titles: [makeTitle({ id: "legacy-1" })], count: 1, sourceVersion: "crawl/legacy" }),
          "utf8"
        )
      )
    );
    const loaded = loadCatalogTitlesFromFile();
    expect(loaded?.titles.map((t) => t.id)).toEqual(["legacy-1"]);
    expect(loaded?.runHash).toBeNull();

    const boot = loadLatestCatalogSnapshotFromFile();
    expect(boot.loaded).toBe(true);
    expect(boot.snapshotId).toMatch(/^file:catalog\.json\.gz@\d+$/);
  });

  it("readCatalogFileSummary — runHash·titleCount·sources 를 요약하고 같은 스탯이면 캐시를 쓴다", () => {
    writeCatalogTitlesToFile({
      titles: [makeTitle({ id: "s-1" }), makeTitle({ id: "s-2" }), makeTitle({ id: "s-3" })],
      sourceVersion: "crawl/summary",
      metadata: { sources: { naverWebtoon: 3, bogus: "x" } },
      runHash: "hash-summary",
    });
    const first = readCatalogFileSummary();
    expect(first).toMatchObject({
      runHash: "hash-summary",
      titleCount: 3,
      sourceVersion: "crawl/summary",
      sources: { naverWebtoon: 3 },
    });
    // (mtime,size) 동일 → 동일 객체(메모이즈) 반환
    expect(readCatalogFileSummary()).toBe(first);
  });
});

describe("catalog-ingest: 동일 runHash 파일 쓰기 스킵", () => {
  it("같은 runHash 면 다시 쓰지 않고(mtime 보존), force 면 다시 쓴다", async () => {
    const titles = [makeTitle({ id: "dup-1" })];
    const first = persistCatalogSnapshotToFile({ titles, sourceVersion: "v1", runHash: "dup-hash" });
    expect(first.written).toBe(true);
    const mtimeAfterFirst = statSync(gzPath).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 15)); // mtime 차이 관측 가능하게
    const second = persistCatalogSnapshotToFile({ titles, sourceVersion: "v2", runHash: "dup-hash" });
    expect(second.written).toBe(false);
    expect(statSync(gzPath).mtimeMs).toBe(mtimeAfterFirst); // 파일 그대로

    const forced = persistCatalogSnapshotToFile({
      titles,
      sourceVersion: "v3",
      runHash: "dup-hash",
      force: true,
    });
    expect(forced.written).toBe(true);
  });
});

describe("catalog-ingest: 파일 모드 부팅 로드 + 스탯 폴링 핫 리로드 (DB 왕복 없음)", () => {
  it("부팅: 파일 → 메모리(file-snapshot), 파일 없으면 빈 카탈로그", () => {
    process.env.WEBDEX_CATALOG_FILE = path.join(tmpDir, "absent.gz");
    const empty = loadLatestCatalogSnapshotFromFile();
    expect(empty.loaded).toBe(false);
    expect(getCatalogState().titleCount).toBe(0);

    process.env.WEBDEX_CATALOG_FILE = gzPath;
    writeCatalogTitlesToFile({
      titles: [makeTitle({ id: "boot-1" }), makeTitle({ id: "boot-2" })],
      sourceVersion: "crawl/boot",
      runHash: "boot-hash",
    });
    const result = loadLatestCatalogSnapshotFromFile();
    expect(result.loaded).toBe(true);
    expect(result.titleCount).toBe(2);
    expect(result.snapshotId).toBe("boot-hash");
    expect(getCatalogState()).toMatchObject({ source: "file-snapshot", titleCount: 2 });
  });

  it("refreshCatalogIfChanged — mtime/size 가 같으면 재로드 없음, 파일이 바뀌면 핫 리로드", async () => {
    writeCatalogTitlesToFile({
      titles: [makeTitle({ id: "poll-1" })],
      sourceVersion: "crawl/poll-a",
      runHash: "poll-hash-a",
    });
    loadLatestCatalogSnapshotFromFile();
    expect(getCatalogState().titleCount).toBe(1);

    // 변경 없음 → reloaded:false (스탯 비교만 — DB/재파싱 없음)
    const unchanged = await refreshCatalogIfChanged();
    expect(unchanged).toMatchObject({ reloaded: false, snapshotId: "poll-hash-a", titleCount: 1 });

    // 외부 프로세스가 파일 교체(다른 내용·크기) → 변경 감지 → 재로드
    await new Promise((resolve) => setTimeout(resolve, 15));
    writeCatalogTitlesToFile({
      titles: [makeTitle({ id: "poll-1" }), makeTitle({ id: "poll-2" }), makeTitle({ id: "poll-3" })],
      sourceVersion: "crawl/poll-b",
      runHash: "poll-hash-b",
    });
    const reloaded = await refreshCatalogIfChanged();
    expect(reloaded).toMatchObject({ reloaded: true, snapshotId: "poll-hash-b", titleCount: 3 });
    expect(getCatalogState()).toMatchObject({ source: "file-snapshot", titleCount: 3 });

    // 다시 폴링 → 변경 없음
    await expect(refreshCatalogIfChanged()).resolves.toMatchObject({ reloaded: false, titleCount: 3 });
  });

  it("파일이 사라져도 서빙 중인 메모리 카탈로그를 비우지 않는다(연속성)", async () => {
    writeCatalogTitlesToFile({
      titles: [makeTitle({ id: "keep-1" })],
      sourceVersion: "crawl/keep",
      runHash: "keep-hash",
    });
    loadLatestCatalogSnapshotFromFile();
    expect(getCatalogState().titleCount).toBe(1);

    process.env.WEBDEX_CATALOG_FILE = path.join(tmpDir, "gone.gz");
    const result = await refreshCatalogIfChanged();
    expect(result.reloaded).toBe(false);
    expect(getCatalogState().titleCount).toBe(1);
  });
});

describe("catalog-ingest: FORCE_DB 레거시 플래그 파싱", () => {
  it("WEBDEX_CATALOG_FORCE_DB=1 일 때만 레거시 DB 모드", () => {
    expect(isCatalogForceDb({})).toBe(false);
    expect(isCatalogForceDb({ WEBDEX_CATALOG_FORCE_DB: "" })).toBe(false);
    expect(isCatalogForceDb({ WEBDEX_CATALOG_FORCE_DB: "0" })).toBe(false);
    expect(isCatalogForceDb({ WEBDEX_CATALOG_FORCE_DB: "true" })).toBe(false); // 명시적 "1"만
    expect(isCatalogForceDb({ WEBDEX_CATALOG_FORCE_DB: "1" })).toBe(true);
  });
});
