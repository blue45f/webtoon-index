import { describe, expect, it } from "vitest";

import {
  createMarketComparisonRows,
  summarizeMarketComparison,
} from "./market-comparison";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

function fixtures(): CreatorMarketplaceResourceRecord[] {
  const base = CREATOR_MARKETPLACE_STARTER_RECORDS[0]!;
  return [
    {
      ...base,
      compatibility: { engines: ["canvas2d", "webgl2"] },
      license: "toonspectrum-standard",
      containsAi: false,
    },
    {
      ...base,
      id: "123e4567-e89b-42d3-a456-426614174099",
      packageId: "comparison/second",
      name: "비교 대상 에셋",
      compatibility: { engines: ["canvas2d"] },
      license: "cc0-1.0",
      containsAi: true,
    },
  ];
}

describe("market comparison model", () => {
  it("marks only rows with different manifest facts", () => {
    const rows = createMarketComparisonRows(fixtures());
    expect(rows.find((row) => row.key === "license")).toMatchObject({
      different: true,
      values: ["ToonSpectrum 표준 사용권", "CC0 1.0"],
    });
    expect(rows.find((row) => row.key === "ai")).toMatchObject({
      different: true,
      values: ["미포함으로 공개", "포함으로 공개"],
    });
    expect(rows.find((row) => row.key === "publisher")?.different).toBe(false);
  });

  it("summarizes common engines and package totals without synthetic scores", () => {
    const [left, right] = fixtures();
    const summary = summarizeMarketComparison([left!, right!]);
    expect(summary.commonEngines).toEqual(["Canvas 2D"]);
    expect(summary.licenseCount).toBe(2);
    expect(summary.aiIncludedCount).toBe(1);
    expect(summary.totalEntryCount).toBe(
      left!.entries.length + right!.entries.length,
    );
    expect(summary.totalManifestBytes).toBe(
      left!.manifestByteSize + right!.manifestByteSize,
    );
  });
});
