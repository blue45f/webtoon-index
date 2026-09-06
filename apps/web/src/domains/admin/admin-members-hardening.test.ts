import { describe, expect, it } from "vitest";

import { buildMemberCsv, clampPage, getPageCount } from "./admin-members-model";

describe("member browser-side export and paging hardening", () => {
  it.each([" =1+1", "\n=1+1", "\uFEFF@SUM(A1)", "\ttext", "\rtext", "   -1", "\ntext", "\u00a0+1"])(
    "neutralizes spreadsheet formula/control prefix %j",
    (name) => {
      expect(buildMemberCsv([{ id: "1", name, role: "user", status: "active" }]))
        .toContain(`"'${name}"`);
    },
  );

  it("preserves UTF-8 BOM, Unicode and CSV quote escaping", () => {
    const csv = buildMemberCsv([{ id: "1", name: '김, "QA"', role: "user", status: "active" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"김, ""QA"""');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "uses a finite page-size fallback for %s",
    (pageSize) => {
      expect(getPageCount(100, pageSize)).toBe(4);
      expect(clampPage(99, 100, pageSize)).toBe(4);
    },
  );
});
