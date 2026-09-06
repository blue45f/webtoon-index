import { describe, expect, it, vi } from "vitest";

import {
  countReportsByStatus,
  filterReports,
  runWithConcurrency,
  toggleVisibleReportSelection,
} from "./admin-reports-model";

const reports = [
  {
    id: "report-1",
    reporterId: "user-1",
    reporterName: "Alice",
    reporterEmail: "alice@example.com",
    targetType: "fan_post",
    targetId: "post-1",
    reason: "Spam links",
    status: "pending" as const,
    resolutionNote: null,
  },
  {
    id: "report-2",
    reporterId: "user-2",
    reporterName: "Bob",
    reporterEmail: "bob@example.com",
    targetType: "review",
    targetId: "review-1",
    reason: "Harassment",
    status: "resolved" as const,
    resolutionNote: "Hidden",
  },
];

describe("admin report model", () => {
  it("filters by lifecycle, target type, and searchable report fields", () => {
    expect(
      filterReports(reports, {
        status: "pending",
        targetType: "fan_post",
        query: "alice@example.com",
      }).map((item) => item.id),
    ).toEqual(["report-1"]);
    expect(
      filterReports(reports, {
        status: "all",
        targetType: "all",
        query: "hidden",
      }).map((item) => item.id),
    ).toEqual(["report-2"]);
  });

  it("counts status totals and preserves off-screen selections", () => {
    expect(countReportsByStatus(reports)).toEqual({
      pending: 1,
      resolved: 1,
      dismissed: 0,
    });
    const selected = toggleVisibleReportSelection(
      new Set(["off-screen"]),
      ["report-1"],
    );
    expect([...selected].sort()).toEqual(["off-screen", "report-1"]);
    expect(
      [...toggleVisibleReportSelection(selected, ["report-1"])],
    ).toEqual(["off-screen"]);
  });

  it("limits concurrent report mutations and keeps per-item failures", async () => {
    let active = 0;
    let maximum = 0;
    const worker = vi.fn(async (value: number) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      if (value === 3) throw new Error("failed");
    });

    const result = await runWithConcurrency([1, 2, 3, 4], 2, worker);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(result.map((item) => item.ok)).toEqual([true, true, false, true]);
  });
});
