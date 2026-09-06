import { describe, expect, it } from "vitest";

import {
  compareStudioPublicationAnalytics,
  computeStudioPublicationAnalytics,
  createEmptyStudioPublicationAnalyticsDocument,
  importStudioPublicationAnalyticsCsv,
  importStudioPublicationAnalyticsManual,
  mergeStudioPublicationAnalyticsRecords,
  normalizeStudioPublicationAnalyticsDocument,
  serializeStudioPublicationAnalyticsDocument,
  STUDIO_PUBLICATION_ANALYTICS_LIMITS,
  STUDIO_PUBLICATION_ANALYTICS_VERSION,
  type StudioPublicationAnalyticsRecord,
} from "./studio-publication-analytics";

function manualRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    destination: "webtoon",
    date: "2026-01-01",
    episode: "1",
    title: "첫 화",
    views: 100,
    likes: 10,
    comments: 5,
    subscribersGained: 2,
    ...overrides,
  };
}

function importedRecord(overrides: Record<string, unknown> = {}): StudioPublicationAnalyticsRecord {
  const imported = importStudioPublicationAnalyticsManual(manualRecord(overrides));
  expect(imported.acceptedCount).toBe(1);
  const record = imported.records[0];
  if (!record) throw new Error("expected one imported record");
  return record;
}

function diagnosticCodes(result: {
  diagnostics: readonly { code: string }[];
}): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("importStudioPublicationAnalyticsCsv", () => {
  it("parses BOM, CRLF, quoted commas, escaped quotes, and quoted newlines locally", () => {
    const csv = [
      "\uFEFFdate,episode,title,views,likes,comments,subscribers_gained,revenue,currency,source",
      '2026-07-01,12,"12화, ""비 오는',
      '날""","1,200",84,19,7,12.3456789,usd,"creator',
      'export"',
    ].join("\r\n");

    const result = importStudioPublicationAnalyticsCsv(csv, { destination: "webtoon" });

    expect(result).toMatchObject({
      basis: "user-supplied-local-data",
      remoteTelemetryUsed: false,
      inputRowCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      duplicateCount: 0,
    });
    expect(result.records[0]).toMatchObject({
      destination: "webtoon",
      source: { kind: "csv", label: "creator export" },
      date: "2026-07-01",
      episode: "12",
      title: '12화, "비 오는 날"',
      views: 1_200,
      likes: 84,
      comments: 19,
      subscribersGained: 7,
      revenue: 12.345679,
      currency: "USD",
    });
    expect(result.records[0]?.id).toMatch(/^publication-[a-z0-9]+-[a-z0-9]+$/u);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts conservative Korean header aliases and destination values", () => {
    const result = importStudioPublicationAnalyticsCsv(
      [
        "플랫폼,게시일,회차,제목,조회수,좋아요,댓글수,신규 구독자",
        "타파스,2026-07-02,3,세 번째 화,300,20,4,6",
      ].join("\n")
    );

    expect(result.acceptedCount).toBe(1);
    expect(result.records[0]).toMatchObject({
      destination: "tapas",
      source: { kind: "csv", label: "로컬 CSV" },
      episode: "3",
      subscribersGained: 6,
    });
  });

  it("uses explicit local defaults when destination or revenue currency cells are blank", () => {
    const result = importStudioPublicationAnalyticsCsv(
      [
        "destination,date,title,views,likes,comments,subscribers_gained,revenue,currency",
        ",2026-07-02,빈 셀 기본값,30,2,1,1,5,",
      ].join("\n"),
      { destination: "tapas", defaultCurrency: "krw" }
    );

    expect(result.acceptedCount).toBe(1);
    expect(result.records[0]).toMatchObject({
      destination: "tapas",
      revenue: 5,
      currency: "KRW",
    });
  });

  it("neutralizes spreadsheet formulas in stored text without executing or echoing them", () => {
    const result = importStudioPublicationAnalyticsCsv(
      [
        "date,episode,title,views,likes,comments,subscribers_gained",
        "2026-07-03,@episode,=2+2,10,1,0,0",
      ].join("\n"),
      { destination: "webtoon", sourceLabel: "+local.csv" }
    );

    expect(result.records[0]).toMatchObject({
      episode: "'@episode",
      title: "'=2+2",
      source: { kind: "csv", label: "'+local.csv" },
    });
    expect(result.formulaNeutralizedCount).toBe(3);
    expect(diagnosticCodes(result)).toEqual([
      "FORMULA_NEUTRALIZED",
      "FORMULA_NEUTRALIZED",
      "FORMULA_NEUTRALIZED",
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("=2+2");
  });

  it("stops on missing, duplicate, or overly broad headers instead of guessing", () => {
    const missing = importStudioPublicationAnalyticsCsv(
      [
        "date,title,views,likes,comments,followers",
        "2026-07-03,제목,10,1,0,4",
      ].join("\n"),
      { destination: "webtoon" }
    );
    expect(missing.records).toEqual([]);
    expect(diagnosticCodes(missing)).toContain("UNKNOWN_HEADER");
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_HEADER",
        field: "subscribersGained",
      })
    );

    const duplicate = importStudioPublicationAnalyticsCsv(
      [
        "date,title,views,view_count,likes,comments,subscribers_gained",
        "2026-07-03,제목,10,10,1,0,4",
      ].join("\n"),
      { destination: "webtoon" }
    );
    expect(duplicate.acceptedCount).toBe(0);
    expect(diagnosticCodes(duplicate)).toContain("DUPLICATE_HEADER");
  });

  it("reports invalid dates, destinations, integers, bounds, and revenue declarations by row", () => {
    const result = importStudioPublicationAnalyticsCsv(
      [
        "destination,date,episode,title,views,likes,comments,subscribers_gained,revenue,currency",
        "webtoon,2026-02-30,1,A,10,1,0,1,,",
        "webtoon,2026-02-28,2,B,-1,1,0,1,,",
        "webtoon,2026-02-28,3,C,10,=1+1,0,1,,",
        "tapas,2026-02-28,4,D,10,1,0,1,5,",
        "unknown,2026-02-28,5,E,10,1,0,1,,",
        "other,2026-02-28,6,F,10,1,0,1,,KRW",
        `webtoon,2026-02-28,7,G,${STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCountMetric + 1},1,0,1,,`,
      ].join("\n")
    );

    expect(result).toMatchObject({ inputRowCount: 7, acceptedCount: 1, rejectedCount: 6 });
    expect(result.records[0]).toMatchObject({ episode: "6", revenue: null, currency: null });
    expect(diagnosticCodes(result)).toEqual([
      "INVALID_DATE",
      "NEGATIVE_NUMBER",
      "INVALID_NUMBER",
      "REVENUE_CURRENCY_REQUIRED",
      "INVALID_DESTINATION",
      "CURRENCY_WITHOUT_REVENUE",
      "NUMBER_TOO_LARGE",
    ]);
    expect(result.limitsApplied).toBe(true);
    expect(result.diagnostics.find((item) => item.code === "INVALID_DATE")?.row).toBe(2);
  });

  it("keeps the first natural-key duplicate and gives it a metric-independent ID", () => {
    const result = importStudioPublicationAnalyticsCsv(
      [
        "date,episode,title,views,likes,comments,subscribers_gained",
        "2026-07-01,1,A,10,1,2,3",
        "2026-07-01,1,A,999,99,99,99",
      ].join("\n"),
      { destination: "webtoon" }
    );
    const changedMetrics = importStudioPublicationAnalyticsManual(
      manualRecord({ date: "2026-07-01", episode: "1", title: "A", views: 500 })
    );

    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 1, duplicateCount: 1 });
    expect(result.records[0]?.views).toBe(10);
    expect(result.records[0]?.id).toBe(changedMetrics.records[0]?.id);
    expect(diagnosticCodes(result)).toContain("DUPLICATE_ROW");
  });

  it("rejects malformed and unclosed quotes and column-count mismatches", () => {
    const header = "date,episode,title,views,likes,comments,subscribers_gained";
    const malformed = importStudioPublicationAnalyticsCsv(
      `${header}\n2026-07-01,1,"A"oops,10,1,0,0`,
      { destination: "webtoon" }
    );
    const unclosed = importStudioPublicationAnalyticsCsv(
      `${header}\n2026-07-01,1,"A,10,1,0,0`,
      { destination: "webtoon" }
    );
    const mismatch = importStudioPublicationAnalyticsCsv(
      `${header}\n2026-07-01,1,A,10,1,0`,
      { destination: "webtoon" }
    );

    expect(malformed.acceptedCount).toBe(0);
    expect(diagnosticCodes(malformed)).toContain("CSV_MALFORMED_QUOTE");
    expect(unclosed.acceptedCount).toBe(0);
    expect(diagnosticCodes(unclosed)).toContain("CSV_UNCLOSED_QUOTE");
    expect(mismatch.acceptedCount).toBe(0);
    expect(diagnosticCodes(mismatch)).toContain("CSV_COLUMN_COUNT_MISMATCH");
  });

  it("enforces CSV size, field, column, and row limits with bounded diagnostics", () => {
    const tooLarge = importStudioPublicationAnalyticsCsv(
      "x".repeat(STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits + 1)
    );
    expect(tooLarge).toMatchObject({ acceptedCount: 0, limitsApplied: true });
    expect(diagnosticCodes(tooLarge)).toEqual(["CSV_TOO_LARGE"]);

    const tooManyColumns = importStudioPublicationAnalyticsCsv(
      `${new Array(STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvColumns + 1).fill("column").join(",")}\n`
    );
    expect(diagnosticCodes(tooManyColumns)).toContain("CSV_TOO_MANY_COLUMNS");

    const header = "date,episode,title,views,likes,comments,subscribers_gained";
    const longField = importStudioPublicationAnalyticsCsv(
      `${header}\n2026-07-01,1,${"가".repeat(
        STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvFieldCodeUnits + 1
      )},10,1,0,0`,
      { destination: "webtoon" }
    );
    expect(longField.acceptedCount).toBe(0);
    expect(diagnosticCodes(longField)).toContain("CSV_FIELD_TOO_LONG");

    const rows = new Array(STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvRows + 1)
      .fill("2026-07-01,1,A,10,1,0,0")
      .join("\n");
    const tooManyRows = importStudioPublicationAnalyticsCsv(`${header}\n${rows}`, {
      destination: "webtoon",
    });
    expect(tooManyRows.limitsApplied).toBe(true);
    expect(diagnosticCodes(tooManyRows)).toContain("CSV_TOO_MANY_ROWS");
    expect(tooManyRows.records.length).toBe(1);
    expect(tooManyRows.duplicateCount).toBe(
      STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords - 1
    );
    expect(tooManyRows.diagnosticsTruncated).toBe(true);
    expect(tooManyRows.diagnostics).toHaveLength(
      STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxDiagnostics
    );
  });
});

describe("manual import, document migration, and merging", () => {
  it("normalizes manual and legacy field aliases while preserving truthful local provenance", () => {
    const result = importStudioPublicationAnalyticsManual(
      {
        platform: "타파스",
        publishedAt: "2026-06-30",
        episodeNumber: 3,
        episodeTitle: "세 번째 화",
        viewCount: "1,000",
        likeCount: "75",
        commentCount: "12",
        newSubscribers: "9",
        earnings: "25.125",
        currencyCode: "krw",
        source: "csv",
      },
      { sourceLabel: "직접 옮긴 메모" }
    );

    expect(result.records[0]).toMatchObject({
      destination: "tapas",
      source: { kind: "manual", label: "직접 옮긴 메모" },
      date: "2026-06-30",
      episode: "3",
      title: "세 번째 화",
      views: 1_000,
      likes: 75,
      comments: 12,
      subscribersGained: 9,
      revenue: 25.125,
      currency: "KRW",
    });
  });

  it("diagnoses malformed manual entries, duplicates, formulas, and record limits", () => {
    const duplicate = manualRecord();
    const result = importStudioPublicationAnalyticsManual([
      duplicate,
      { ...duplicate, views: 999 },
      null,
      manualRecord({ episode: "2", title: "@unsafe", views: 1.5 }),
    ]);

    expect(result).toMatchObject({
      inputRowCount: 4,
      acceptedCount: 1,
      rejectedCount: 3,
      duplicateCount: 1,
      formulaNeutralizedCount: 1,
    });
    expect(diagnosticCodes(result)).toEqual([
      "DUPLICATE_ROW",
      "INVALID_ROW",
      "FORMULA_NEUTRALIZED",
      "INVALID_NUMBER",
    ]);

    const limited = importStudioPublicationAnalyticsManual(
      new Array(STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords + 1).fill(null)
    );
    expect(limited).toMatchObject({
      inputRowCount: STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords + 1,
      acceptedCount: 0,
      rejectedCount: STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords + 1,
      limitsApplied: true,
      diagnosticsTruncated: true,
    });
    expect(diagnosticCodes(limited)[0]).toBe("RECORD_LIMIT_REACHED");
  });

  it("migrates legacy containers, sorts deterministically, drops duplicates and unknown fields", () => {
    const document = normalizeStudioPublicationAnalyticsDocument({
      version: 0,
      entries: [
        {
          platform: "tapas",
          publishedDate: "2026-02-02",
          episodeNo: "2",
          episodeName: "두 번째",
          viewCount: 20,
          likeCount: 2,
          commentCount: 1,
          subscriberGain: 1,
          source: { kind: "csv", label: "old.csv" },
          unsafeExtra: "drop",
        },
        manualRecord({ date: "2026-01-01", title: "=첫 화" }),
        manualRecord({ date: "2026-01-01", title: "=첫 화", views: 999 }),
        { nope: true },
      ],
    });

    expect(document.version).toBe(STUDIO_PUBLICATION_ANALYTICS_VERSION);
    expect(document.records).toHaveLength(2);
    expect(document.records.map((record) => record.date)).toEqual([
      "2026-01-01",
      "2026-02-02",
    ]);
    expect(document.records[0]?.title).toBe("'=첫 화");
    expect(document.records[1]?.source).toEqual({ kind: "csv", label: "old.csv" });
    expect(document.records[1]).not.toHaveProperty("unsafeExtra");

    const serialized = serializeStudioPublicationAnalyticsDocument({
      rows: document.records.slice().reverse(),
      version: 999,
      secret: "drop",
    });
    expect(JSON.parse(serialized)).toEqual(document);
    expect(serializeStudioPublicationAnalyticsDocument(serialized)).toBe(serialized);
    expect(normalizeStudioPublicationAnalyticsDocument("{broken")).toEqual(
      createEmptyStudioPublicationAnalyticsDocument()
    );
  });

  it("merges imported records, rejecting saved and within-batch duplicates", () => {
    const first = importedRecord();
    const second = importedRecord({ date: "2026-01-02", episode: "2", title: "둘째 화" });
    const merge = mergeStudioPublicationAnalyticsRecords(
      { version: 1, records: [first] },
      [first, second, { ...second, views: 500 }, null]
    );

    expect(merge).toMatchObject({ addedCount: 1, rejectedCount: 3, duplicateCount: 2 });
    expect(merge.document.records).toHaveLength(2);
    expect(merge.document.records[1]?.views).toBe(100);
    expect(diagnosticCodes(merge)).toEqual([
      "DUPLICATE_ROW",
      "DUPLICATE_ROW",
      "INVALID_ROW",
    ]);
  });
});

describe("deterministic aggregation, trends, and comparisons", () => {
  const observations = [
    manualRecord({
      destination: "webtoon",
      date: "2026-01-01",
      episode: "1",
      title: "W1",
      views: 100,
      likes: 10,
      comments: 5,
      subscribersGained: 2,
      revenue: 10,
      currency: "USD",
    }),
    manualRecord({
      destination: "tapas",
      date: "2026-01-01",
      episode: "1",
      title: "T1",
      views: 50,
      likes: 2,
      comments: 3,
      subscribersGained: 1,
      revenue: 1_000,
      currency: "KRW",
    }),
    manualRecord({
      destination: "webtoon",
      date: "2026-01-02",
      episode: "2",
      title: "W2",
      views: 200,
      likes: 30,
      comments: 10,
      subscribersGained: 5,
      revenue: 20,
      currency: "USD",
    }),
    manualRecord({
      destination: "tapas",
      date: "2026-01-02",
      episode: "2",
      title: "T2",
      views: 100,
      likes: 10,
      comments: 5,
      subscribersGained: 2,
      revenue: 5,
      currency: "USD",
    }),
  ];

  it("returns transparent zero metrics for empty local data", () => {
    const result = computeStudioPublicationAnalytics(null);

    expect(result).toEqual({
      basis: "user-supplied-local-data",
      remoteTelemetryUsed: false,
      summary: {
        recordCount: 0,
        episodeCount: 0,
        dateRange: null,
        totals: { views: 0, likes: 0, comments: 0, subscribersGained: 0 },
        rates: {
          likeRatePercent: 0,
          commentRatePercent: 0,
          interactionRatePercent: 0,
          subscribersPerThousandViews: 0,
        },
        revenue: [],
      },
      timeline: [],
      byDestination: [],
      trend: null,
    });
  });

  it("aggregates totals, rates, currencies, destinations, and chronological points", () => {
    const imported = importStudioPublicationAnalyticsManual(observations);
    const result = computeStudioPublicationAnalytics(imported.records);

    expect(imported.acceptedCount).toBe(4);
    expect(result.summary).toEqual({
      recordCount: 4,
      episodeCount: 4,
      dateRange: { from: "2026-01-01", to: "2026-01-02" },
      totals: { views: 450, likes: 52, comments: 23, subscribersGained: 10 },
      rates: {
        likeRatePercent: 11.56,
        commentRatePercent: 5.11,
        interactionRatePercent: 16.67,
        subscribersPerThousandViews: 22.22,
      },
      revenue: [
        { currency: "KRW", total: 1_000, recordCount: 1 },
        { currency: "USD", total: 35, recordCount: 3 },
      ],
    });
    expect(result.timeline).toEqual([
      {
        date: "2026-01-01",
        recordCount: 2,
        totals: { views: 150, likes: 12, comments: 8, subscribersGained: 3 },
        revenue: [
          { currency: "KRW", total: 1_000, recordCount: 1 },
          { currency: "USD", total: 10, recordCount: 1 },
        ],
      },
      {
        date: "2026-01-02",
        recordCount: 2,
        totals: { views: 300, likes: 40, comments: 15, subscribersGained: 7 },
        revenue: [{ currency: "USD", total: 25, recordCount: 2 }],
      },
    ]);
    expect(result.byDestination.map((item) => item.destination)).toEqual([
      "webtoon",
      "tapas",
    ]);
    expect(result.byDestination[0]).toMatchObject({
      destination: "webtoon",
      recordCount: 2,
      totals: { views: 300 },
    });
  });

  it("computes first-to-last trend deltas per metric and never mixes currencies", () => {
    const result = computeStudioPublicationAnalytics(
      importStudioPublicationAnalyticsManual(observations).records
    );

    expect(result.trend).toMatchObject({
      fromDate: "2026-01-01",
      toDate: "2026-01-02",
      metrics: {
        views: {
          baseline: 150,
          current: 300,
          absolute: 150,
          percentChange: 100,
          direction: "up",
        },
        likes: { absolute: 28, percentChange: 233.33, direction: "up" },
      },
      revenue: [
        {
          currency: "KRW",
          baseline: 1_000,
          current: 0,
          absolute: -1_000,
          percentChange: -100,
          direction: "down",
        },
        {
          currency: "USD",
          baseline: 10,
          current: 25,
          absolute: 15,
          percentChange: 150,
          direction: "up",
        },
      ],
    });
  });

  it("compares arbitrary local baselines with zero-safe deltas and destination splits", () => {
    const baseline = importStudioPublicationAnalyticsManual([
      manualRecord({
        destination: "webtoon",
        date: "2026-01-01",
        title: "baseline",
        views: 100,
        likes: 0,
        comments: 5,
        subscribersGained: 0,
        revenue: 0,
        currency: "USD",
      }),
    ]).records;
    const current = importStudioPublicationAnalyticsManual([
      manualRecord({
        destination: "webtoon",
        date: "2026-02-01",
        title: "current",
        views: 200,
        likes: 10,
        comments: 10,
        subscribersGained: 4,
        revenue: 10,
        currency: "USD",
      }),
      manualRecord({
        destination: "tapas",
        date: "2026-02-01",
        title: "new channel",
        views: 50,
        likes: 5,
        comments: 0,
        subscribersGained: 1,
        revenue: 1_000,
        currency: "KRW",
      }),
    ]).records;

    const comparison = compareStudioPublicationAnalytics(current, baseline);

    expect(comparison).toMatchObject({
      basis: "user-supplied-local-data",
      remoteTelemetryUsed: false,
      recordCount: { baseline: 1, current: 2, absolute: 1, percentChange: 100, direction: "up" },
      metrics: {
        views: { baseline: 100, current: 250, absolute: 150, percentChange: 150, direction: "up" },
        likes: { baseline: 0, current: 15, absolute: 15, percentChange: null, direction: "new" },
      },
      revenue: [
        expect.objectContaining({ currency: "KRW", percentChange: null, direction: "new" }),
        expect.objectContaining({ currency: "USD", percentChange: null, direction: "new" }),
      ],
    });
    expect(comparison.rates).toEqual({
      likeRatePercentagePoints: 6,
      commentRatePercentagePoints: -1,
      interactionRatePercentagePoints: 5,
      subscribersPerThousandViews: 20,
    });
    expect(comparison.byDestination.map((item) => item.destination)).toEqual([
      "webtoon",
      "tapas",
    ]);
    expect(comparison.byDestination[1]?.recordCount).toMatchObject({
      baseline: 0,
      current: 1,
      percentChange: null,
      direction: "new",
    });
  });

  it("returns a flat delta with undefined percentage when both values are zero", () => {
    const comparison = compareStudioPublicationAnalytics([], []);

    expect(comparison.metrics.views).toEqual({
      baseline: 0,
      current: 0,
      absolute: 0,
      percentChange: null,
      direction: "flat",
    });
    expect(comparison.byDestination).toEqual([]);
  });
});
