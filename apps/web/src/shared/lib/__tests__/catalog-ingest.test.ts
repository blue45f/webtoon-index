import { afterEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "../../../../../../apps/api/src/server/app-config";
import {
  STALE_RUN_GRACE_MS,
  evaluateRegression,
  extractSourceCounts,
  getCatalogIngestStatus,
  loadLatestCatalogSnapshotFromDb,
  loadLatestCatalogSnapshotFromFile,
  normalizeCatalogIngestConfig,
  parseCrawlerJsonPayload,
  refreshCatalogIfChanged,
  runCatalogIngest,
  safeTokenEqual,
  staleCatalogRunCutoff,
  verifyCatalogIngestToken,
} from "../../../../../../apps/api/src/server/catalog-ingest";
import { buildCatalogSourcePlan } from "../../../../../../apps/api/src/server/catalog-sources";

// Nest CatalogService(수동 ingest 경로) 검증용 부분 mock — 순수 함수(verify/normalize/…)는 실제 구현 유지,
// DB/크롤 프로세스·파일 로드를 만지는 함수만 스텁한다. 서비스가 같은 모듈을 다른 상대경로로 import해도 동일 모듈로 적용된다.
vi.mock("../../../../../../apps/api/src/server/catalog-ingest", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../apps/api/src/server/catalog-ingest")>();
  return {
    ...original,
    runCatalogIngest: vi.fn(),
    getCatalogIngestStatus: vi.fn(),
    refreshCatalogIfChanged: vi.fn(),
    loadLatestCatalogSnapshotFromDb: vi.fn(),
    loadLatestCatalogSnapshotFromFile: vi.fn(),
    reapStaleCatalogIngestRuns: vi.fn(async () => 0),
  };
});

vi.mock("../../../../../../apps/api/src/server/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../apps/api/src/server/app-config")>();
  return { ...original, isAdminUser: vi.fn(async () => false) };
});

describe("catalog ingest helpers", () => {
  it("crawler stdout에서 JSON 페이로드를 안전하게 파싱한다", () => {
    const payload = parseCrawlerJsonPayload(
      [
        "log: ignored",
        JSON.stringify({
          titles: [{ id: "nw-1", slug: "nw-1", title: "테스트", availability: [] }],
          count: 1,
          sourceVersion: "crawl/2026-06-02T00:00:00.000Z",
        }),
      ].join("\n")
    );

    expect(payload.count).toBe(1);
    expect(payload.sourceVersion).toContain("crawl/");
    expect(payload.titles[0]?.id).toBe("nw-1");
  });

  it("카탈로그 수집 환경값을 운영 가능한 범위로 정규화한다", () => {
    const config = normalizeCatalogIngestConfig({
      CATALOG_INGEST_MODE: "fixed",
      CATALOG_INGEST_INTERVAL_SECONDS: "10",
      CATALOG_INGEST_TIMEOUT_MS: "9000000",
      CATALOG_INGEST_SCRIPT_MAX_OUTPUT_MB: "0",
      CATALOG_CRAWL_SCRIPT: "custom/crawl.mjs",
    });

    expect(config.mode).toBe("fixed");
    expect(config.intervalSeconds).toBe(60);
    expect(config.timeoutMs).toBe(1800000); // 30분 상한으로 클램프
    expect(config.maxOutputMb).toBe(1);
    expect(config.scriptPath).toBe("custom/crawl.mjs");
  });

  it("국내 플랫폼 수집 소스를 구현 상태로 라우팅한다", () => {
    const config = normalizeCatalogIngestConfig({
      WEBDEX_SOURCE_IDS: "naver-webtoon,ridi,novelpia,kyobo",
    });
    const plan = buildCatalogSourcePlan(config.sourceIds);

    expect(config.sourceIds).toEqual(["naver-webtoon", "ridi", "novelpia", "kyobo"]);
    // 네 소스 모두 공개 카탈로그 크롤러가 구현되어 enabled 로 라우팅된다(ridi/novelpia/kyobo 승격 완료).
    expect(plan.enabled.map((source) => source.id)).toEqual([
      "naver-webtoon",
      "ridi",
      "novelpia",
      "kyobo",
    ]);
    expect(plan.pending.map((source) => source.id)).toEqual([]);
    // 현재 레지스트리는 전 소스가 크롤러로 구현된 상태 — pending 0, implemented == 전체.
    expect(plan.coverage.pendingSources).toBe(0);
    expect(plan.coverage.implementedSources).toBe(plan.coverage.domesticSources);
    expect(plan.coverage.domesticWebtoonSources).toBeGreaterThan(5);
    expect(plan.coverage.domesticWebnovelSources).toBeGreaterThan(5);
  });
});

describe("catalog ingest 품질 게이트", () => {
  it("minRetainRatio를 0<r<=1로 정규화(기본 0.6)", () => {
    expect(normalizeCatalogIngestConfig({}).minRetainRatio).toBe(0.6);
    expect(normalizeCatalogIngestConfig({ CATALOG_INGEST_MIN_RETAIN_RATIO: "0.8" }).minRetainRatio).toBe(0.8);
    expect(normalizeCatalogIngestConfig({ CATALOG_INGEST_MIN_RETAIN_RATIO: "0" }).minRetainRatio).toBe(0.6);
    expect(normalizeCatalogIngestConfig({ CATALOG_INGEST_MIN_RETAIN_RATIO: "2" }).minRetainRatio).toBe(0.6);
  });

  it("첫 스냅샷(비교대상 없음)은 회귀로 보지 않는다", () => {
    expect(evaluateRegression(10, null, null, 0.6)).toBeNull();
    expect(evaluateRegression(10, null, { titleCount: 0, sources: null }, 0.6)).toBeNull();
  });

  it("총건수가 직전 대비 비율 미만으로 급감하면 회귀", () => {
    expect(evaluateRegression(100, null, { titleCount: 300, sources: null }, 0.6)?.reason).toContain(
      "title count dropped"
    );
    expect(evaluateRegression(200, null, { titleCount: 300, sources: null }, 0.6)).toBeNull();
  });

  it("직전에 있던 주요 소스가 0으로 붕괴하면 회귀(건수 충분해도)", () => {
    const current = { titleCount: 300, sources: { naverWebtoon: 200, kakaoWebtoon: 80 } };
    expect(
      evaluateRegression(290, { naverWebtoon: 200, kakaoWebtoon: 0 }, current, 0.6)?.reason
    ).toContain("kakaoWebtoon");
    expect(evaluateRegression(290, { naverWebtoon: 200, kakaoWebtoon: 80 }, current, 0.6)).toBeNull();
  });

  it("extractSourceCounts는 metadata.sources의 유한 숫자만 추출", () => {
    expect(extractSourceCounts({ sources: { naverWebtoon: 10, x: "nope" } })).toEqual({ naverWebtoon: 10 });
    expect(extractSourceCounts(null)).toBeNull();
    expect(extractSourceCounts({ sources: {} })).toBeNull();
  });
});

describe("수동 ingest 토큰 검증(타이밍 세이프)", () => {
  it("safeTokenEqual — 일치할 때만 true, 빈 값/비문자열은 항상 false", () => {
    expect(safeTokenEqual("secret", "secret")).toBe(true);
    expect(safeTokenEqual("secret", "Secret")).toBe(false);
    expect(safeTokenEqual("secret", "secret-longer")).toBe(false);
    expect(safeTokenEqual("secret", "")).toBe(false);
    expect(safeTokenEqual("", "")).toBe(false);
    expect(safeTokenEqual("secret", 123)).toBe(false);
    expect(safeTokenEqual("secret", undefined)).toBe(false);
  });

  it("verifyCatalogIngestToken — 미설정이면 어떤 후보도 not-configured", () => {
    expect(verifyCatalogIngestToken("")).toBe("not-configured");
    expect(verifyCatalogIngestToken("", "")).toBe("not-configured");
    expect(verifyCatalogIngestToken("", "anything")).toBe("not-configured");
  });

  it("verifyCatalogIngestToken — 헤더/바디 중 하나만 일치해도 ok, 모두 불일치면 invalid", () => {
    expect(verifyCatalogIngestToken("tok", "tok", undefined)).toBe("ok");
    expect(verifyCatalogIngestToken("tok", "", "tok")).toBe("ok");
    expect(verifyCatalogIngestToken("tok", "nope", "wrong")).toBe("invalid");
    expect(verifyCatalogIngestToken("tok")).toBe("invalid");
  });

  it("normalizeCatalogIngestConfig — 토큰을 트림하고 공백뿐이면 미설정 처리", () => {
    expect(normalizeCatalogIngestConfig({ CATALOG_INGEST_TRIGGER_TOKEN: "  tok\n" }).triggerToken).toBe("tok");
    expect(normalizeCatalogIngestConfig({ CATALOG_INGEST_TRIGGER_TOKEN: "   " }).triggerToken).toBe("");
    expect(normalizeCatalogIngestConfig({}).triggerToken).toBe("");
  });
});

describe("좀비 running 이력 정리 기준", () => {
  it("staleCatalogRunCutoff — 타임아웃+유예보다 오래된 시각을 컷오프로 잡는다", () => {
    const now = Date.UTC(2026, 5, 12, 0, 0, 0);
    const cutoff = staleCatalogRunCutoff(600_000, now);
    expect(cutoff.getTime()).toBe(now - 600_000 - STALE_RUN_GRACE_MS);
  });
});

describe("CatalogService 수동 ingest 엔드포인트 경로", () => {
  const ORIGINAL_TOKEN = process.env.CATALOG_INGEST_TRIGGER_TOKEN;
  const ORIGINAL_MODE = process.env.CATALOG_INGEST_MODE;
  const ORIGINAL_POLL = process.env.CATALOG_REFRESH_POLL_SECONDS;
  const ORIGINAL_FORCE_DB = process.env.WEBDEX_CATALOG_FORCE_DB;

  afterEach(() => {
    if (ORIGINAL_TOKEN == null) delete process.env.CATALOG_INGEST_TRIGGER_TOKEN;
    else process.env.CATALOG_INGEST_TRIGGER_TOKEN = ORIGINAL_TOKEN;
    if (ORIGINAL_MODE == null) delete process.env.CATALOG_INGEST_MODE;
    else process.env.CATALOG_INGEST_MODE = ORIGINAL_MODE;
    if (ORIGINAL_POLL == null) delete process.env.CATALOG_REFRESH_POLL_SECONDS;
    else process.env.CATALOG_REFRESH_POLL_SECONDS = ORIGINAL_POLL;
    if (ORIGINAL_FORCE_DB == null) delete process.env.WEBDEX_CATALOG_FORCE_DB;
    else process.env.WEBDEX_CATALOG_FORCE_DB = ORIGINAL_FORCE_DB;
    vi.clearAllMocks();
  });

  async function makeService(token: string | null) {
    if (token == null) delete process.env.CATALOG_INGEST_TRIGGER_TOKEN;
    else process.env.CATALOG_INGEST_TRIGGER_TOKEN = token;
    process.env.CATALOG_INGEST_MODE = "off";
    // onModuleInit 검증 시 폴링 타이머가 생기지 않게 0(off)으로 고정.
    process.env.CATALOG_REFRESH_POLL_SECONDS = "0";
    const { CatalogService } = await import("../../../../../../apps/api/src/modules/catalog/catalog.service");
    // 기본적으로 onModuleInit은 호출하지 않는다(부팅 분기 테스트만 명시 호출).
    return new CatalogService();
  }

  const fakeResult = {
    runId: "run-1",
    status: "success" as const,
    source: "crawl.mjs",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    titleCount: 3,
    runHash: "hash",
    snapshotId: "snap-1",
    duplicate: false,
    message: "snapshot stored",
    error: null,
  };

  it("토큰 미설정 + 비관리자 → 401(명확한 미구성 메시지)", async () => {
    const service = await makeService(null);
    const error = await service
      .runCatalogIngest({ token: "anything" }, undefined, undefined, "rl-unset")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number; message: string });
    expect(error?.getStatus()).toBe(401);
    expect(error?.message).toContain("not configured");
    expect(vi.mocked(runCatalogIngest)).not.toHaveBeenCalled();
  });

  it("잘못된 토큰 → 401, 올바른 헤더 토큰 → 실행", async () => {
    const service = await makeService("tok-1");
    const bad = await service
      .runCatalogIngest({}, "wrong", undefined, "rl-bad")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number });
    expect(bad?.getStatus()).toBe(401);
    expect(vi.mocked(runCatalogIngest)).not.toHaveBeenCalled();

    vi.mocked(runCatalogIngest).mockResolvedValueOnce(fakeResult);
    const ok = await service.runCatalogIngest({}, "tok-1", undefined, "rl-good");
    expect(ok.runId).toBe("run-1");
    expect(vi.mocked(runCatalogIngest)).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: "manual", requestedBy: "manual" })
    );
  });

  it("body 토큰만으로도 인증된다", async () => {
    const service = await makeService("tok-2");
    vi.mocked(runCatalogIngest).mockResolvedValueOnce(fakeResult);
    const result = await service.runCatalogIngest({ token: "tok-2", requestedBy: "cron" }, undefined, undefined, "rl-body");
    expect(result.status).toBe("success");
    expect(vi.mocked(runCatalogIngest)).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "cron" }));
  });

  it("관리자(x-user-id)는 토큰 없이 실행 가능", async () => {
    const service = await makeService("tok-3");
    vi.mocked(isAdminUser).mockResolvedValueOnce(true);
    vi.mocked(runCatalogIngest).mockResolvedValueOnce(fakeResult);
    const result = await service.runCatalogIngest({}, undefined, "admin-user", "rl-admin");
    expect(result.runId).toBe("run-1");
    expect(vi.mocked(isAdminUser)).toHaveBeenCalledWith("admin-user");
  });

  it("실행 중 재요청 → 409, 완료 후엔 다시 실행 가능", async () => {
    const service = await makeService("tok-4");
    let release: (value: typeof fakeResult) => void = () => undefined;
    vi.mocked(runCatalogIngest).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );

    const first = service.runCatalogIngest({}, "tok-4", undefined, "rl-c1");
    const conflict = await service
      .runCatalogIngest({}, "tok-4", undefined, "rl-c2")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number });
    expect(conflict?.getStatus()).toBe(409);

    release(fakeResult);
    await expect(first).resolves.toMatchObject({ runId: "run-1" });

    vi.mocked(runCatalogIngest).mockResolvedValueOnce(fakeResult);
    await expect(service.runCatalogIngest({}, "tok-4", undefined, "rl-c3")).resolves.toMatchObject({
      status: "success",
    });
  });

  it("크롤 실패 → 502(Bad Gateway)로 매핑되고 메시지가 보존된다", async () => {
    const service = await makeService("tok-5");
    vi.mocked(runCatalogIngest).mockRejectedValueOnce(new Error("crawler returned no valid titles"));
    const error = await service
      .runCatalogIngest({}, "tok-5", undefined, "rl-fail")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number; message: string });
    expect(error?.getStatus()).toBe(502);
    expect(error?.message).toContain("no valid titles");
  });

  it("같은 클라이언트가 1분에 5회 초과 호출하면 429", async () => {
    const service = await makeService("tok-6");
    vi.mocked(runCatalogIngest).mockResolvedValue(fakeResult);
    for (let i = 0; i < 5; i++) {
      await service.runCatalogIngest({}, "tok-6", undefined, "rl-burst");
    }
    const blocked = await service
      .runCatalogIngest({}, "tok-6", undefined, "rl-burst")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number });
    expect(blocked?.getStatus()).toBe(429);
    // 다른 클라이언트 키는 영향 없음
    await expect(service.runCatalogIngest({}, "tok-6", undefined, "rl-other")).resolves.toBeTruthy();
  });

  it("status — 스케줄러 정보(inProgress·nextRunAt·연속실패)를 합쳐 반환", async () => {
    const service = await makeService("tok-7");
    vi.mocked(getCatalogIngestStatus).mockResolvedValueOnce({
      config: { mode: "off" },
      sourcePlan: { enabled: [], pending: [] },
      currentSnapshot: null,
      catalogState: { titleCount: 0 },
      recentRuns: [],
      generatedAt: new Date().toISOString(),
    } as unknown as Awaited<ReturnType<typeof getCatalogIngestStatus>>);

    const status = await service.getCatalogIngestStatus();
    expect(status.scheduler).toMatchObject({
      running: false,
      inProgress: false,
      nextRunAt: null,
      consecutiveFailures: 0,
    });
    expect(status.currentSnapshot).toBeNull();
    expect(Array.isArray(status.recentRuns)).toBe(true);
  });

  it("refreshCatalog — 토큰 설정 시 불일치 401, 일치하면 핫 리로드 호출", async () => {
    const service = await makeService("tok-8");
    const bad = await service
      .refreshCatalog("wrong", "rl-refresh-bad")
      .then(() => null)
      .catch((e: unknown) => e as { getStatus(): number });
    expect(bad?.getStatus()).toBe(401);

    vi.mocked(refreshCatalogIfChanged).mockResolvedValueOnce({ reloaded: false, snapshotId: null, titleCount: 0 });
    await expect(service.refreshCatalog("tok-8", "rl-refresh-ok")).resolves.toMatchObject({ reloaded: false });
  });

  it("부팅(기본): 파일 로더만 호출되고 DB 스냅샷 로더는 호출되지 않는다 — 카탈로그 파일 전용", async () => {
    delete process.env.WEBDEX_CATALOG_FORCE_DB;
    const service = await makeService("tok-boot-file");
    vi.mocked(loadLatestCatalogSnapshotFromFile).mockReturnValueOnce({
      loaded: true,
      snapshotId: "hash-x",
      file: "/tmp/catalog.json.gz",
      source: "catalog-file",
      sourceVersion: "file:catalog.json.gz",
      titleCount: 3,
      createdAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
    } as ReturnType<typeof loadLatestCatalogSnapshotFromFile>);

    await service.onModuleInit();
    expect(vi.mocked(loadLatestCatalogSnapshotFromFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadLatestCatalogSnapshotFromDb)).not.toHaveBeenCalled();
  });

  it("부팅(WEBDEX_CATALOG_FORCE_DB=1 레거시): DB 스냅샷 로더가 호출된다", async () => {
    process.env.WEBDEX_CATALOG_FORCE_DB = "1";
    const service = await makeService("tok-boot-db");
    vi.mocked(loadLatestCatalogSnapshotFromDb).mockResolvedValueOnce({
      loaded: false,
      source: "empty",
      titleCount: 0,
      generatedAt: new Date().toISOString(),
    } as Awaited<ReturnType<typeof loadLatestCatalogSnapshotFromDb>>);

    await service.onModuleInit();
    expect(vi.mocked(loadLatestCatalogSnapshotFromDb)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadLatestCatalogSnapshotFromFile)).not.toHaveBeenCalled();
  });
});
