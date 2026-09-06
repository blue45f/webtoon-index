import { describe, expect, it } from "vitest";

import { computeStudioProductionInsights } from "./studio-production-insights";
import {
  lintStudioProjectHealth,
  STUDIO_PROJECT_HEALTH_RULESET_VERSION,
} from "./studio-project-health-linter";

describe("lintStudioProjectHealth", () => {
  it("reports a deterministic local-only health result for a clean production document", () => {
    const insights = computeStudioProductionInsights({
      pages: [
        {
          frames: [{ dialogue: "다녀왔어." }],
          review: { status: "approved", locked: true },
        },
      ],
    });

    expect(lintStudioProjectHealth(insights)).toEqual({
      basis: "studio-production-insights",
      rulesetVersion: STUDIO_PROJECT_HEALTH_RULESET_VERSION,
      status: "healthy",
      checkedRuleCount: 10,
      passedRuleCount: 10,
      counts: { blocking: 0, warning: 0, notice: 0 },
      issues: [],
    });
  });

  it("surfaces structure and review gaps without treating an intentional partial frame gap as blocking", () => {
    const insights = computeStudioProductionInsights({
      pages: [
        {
          frames: [{ narration: "복도." }],
          review: { status: "approved", locked: false },
        },
        {},
      ],
    });
    const result = lintStudioProjectHealth(insights);

    expect(result.status).toBe("needs-attention");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "APPROVED_PAGE_UNLOCKED",
      "REVIEW_UNTRACKED",
      "PAGE_WITHOUT_FRAME",
    ]);
    expect(result.issues.at(-1)).toMatchObject({
      severity: "notice",
      count: 1,
    });
  });

  it("fails closed for requested changes, linked blockers, and malformed document input", () => {
    const insights = computeStudioProductionInsights({
      pages: [
        {
          frames: [{}],
          review: { status: "changes-requested", locked: false },
          assets: "invalid",
        },
      ],
      issues: [
        { severity: "error" },
        { severity: "warning" },
        { severity: "info", actionable: false },
      ],
    });
    const result = lintStudioProjectHealth(insights);

    expect(result.status).toBe("blocked");
    expect(result.counts).toEqual({ blocking: 3, warning: 1, notice: 1 });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "LINKED_BLOCKING_ISSUES",
      "MALFORMED_DOCUMENT_INPUT",
      "REVIEW_CHANGES_REQUESTED",
      "LINKED_ACTIONABLE_ISSUES",
      "SUPPRESSED_OPEN_ISSUES",
    ]);
  });

  it("keeps empty projects actionable and discloses bounded analysis instead of claiming success", () => {
    const insights = computeStudioProductionInsights({
      pages: new Array(1_001).fill({}),
    });
    const result = lintStudioProjectHealth(insights);

    expect(result.status).toBe("needs-attention");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PAGE_WITHOUT_FRAME",
          severity: "warning",
          count: 1_000,
        }),
        expect.objectContaining({
          code: "ANALYSIS_LIMIT_APPLIED",
          severity: "warning",
          message: expect.stringContaining("페이지"),
        }),
      ]),
    );

    const empty = lintStudioProjectHealth(
      computeStudioProductionInsights(undefined),
    );
    expect(empty.issues).toEqual([
      expect.objectContaining({
        code: "PROJECT_EMPTY",
        severity: "warning",
      }),
    ]);
  });

  it("returns deeply immutable issue collections and stable severity ordering", () => {
    const result = lintStudioProjectHealth(
      computeStudioProductionInsights({
        pages: [{ review: { status: "changes-requested" } }],
        issues: [{ severity: "warning" }],
      }),
    );

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.counts)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(result.issues.every((issue) => Object.isFrozen(issue))).toBe(true);
    expect(
      result.issues.map((issue) => issue.severity),
    ).toEqual([
      "blocking",
      "warning",
      "warning",
    ]);
  });
});
