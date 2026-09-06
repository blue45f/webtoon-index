import { describe, expect, it } from "vitest";

import {
  aggregateScreeningSessions,
  createScreeningCampaign,
  generateScreeningWatermark,
  type ReaderScreeningSession,
} from "./studio-private-reader-screening";

describe("Studio Private Reader Screening System", () => {
  it("creates screening campaign and generates dynamic security watermark", () => {
    const campaign = createScreeningCampaign({
      id: "camp_1",
      episodeId: "ep_1",
      title: "1화 프리미어 비공개 시사회",
      expiresAtMs: 1_700_000_000_000,
      watermarkTemplate: "CONFIDENTIAL — {name} <{email}>",
    });

    expect(campaign.requiresNda).toBe(true);
    expect(campaign.isWatermarkEnabled).toBe(true);

    const wm = generateScreeningWatermark(campaign, {
      name: "홍길동",
      email: "hong@example.com",
      timestampMs: 1_600_000_000_000,
    });
    expect(wm).toBe("CONFIDENTIAL — 홍길동 <hong@example.com>");
  });

  it("aggregates reader dwell time, drop-offs and responses", () => {
    const campaign = createScreeningCampaign({
      id: "camp_2",
      episodeId: "ep_1",
      title: "시사회 2",
      expiresAtMs: 2_000_000_000_000,
    });

    const sessions: ReaderScreeningSession[] = [
      {
        sessionId: "s1",
        campaignId: "camp_2",
        readerId: "r1",
        readerName: "독자A",
        readerEmail: "a@test.com",
        ndaConsentedAtMs: 100,
        completedAtMs: 200,
        traces: [
          { panelId: "p1", dwellTimeMs: 4000, maxScrollVelocity: 100 },
          { panelId: "p2", dwellTimeMs: 6000, maxScrollVelocity: 150 },
        ],
        responses: [{ questionId: "q1", answer: 5, answeredAtMs: 150 }],
        startedAtMs: 100,
      },
      {
        sessionId: "s2",
        campaignId: "camp_2",
        readerId: "r2",
        readerName: "독자B",
        readerEmail: "b@test.com",
        ndaConsentedAtMs: 100,
        dropOffPanelId: "p2",
        traces: [
          { panelId: "p1", dwellTimeMs: 2000, maxScrollVelocity: 120 },
          { panelId: "p2", dwellTimeMs: 2000, maxScrollVelocity: 80 },
        ],
        responses: [{ questionId: "q1", answer: 3, answeredAtMs: 140 }],
        startedAtMs: 100,
      },
    ];

    const report = aggregateScreeningSessions(campaign, sessions);

    expect(report.totalReaders).toBe(2);
    expect(report.ndaConsentRate).toBe(1.0);
    expect(report.completionRate).toBe(0.5);
    // average for p1: (4000 + 2000) / 2 = 3000
    expect(report.averageDwellTimeByPanel.p1).toBe(3000);
    // average for p2: (6000 + 2000) / 2 = 4000
    expect(report.averageDwellTimeByPanel.p2).toBe(4000);
    // drop off on p2
    expect(report.dropOffCountsByPanel.p2).toBe(1);
    // question responses
    expect(report.responsesByQuestion.q1).toEqual([5, 3]);
  });
});
