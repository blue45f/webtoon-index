import { describe, expect, it } from "vitest";

import {
  buildMemberCsv,
  buildMemberQuery,
  clampPage,
  getPageCount,
  toggleMemberSelection,
  toggleVisibleMemberSelection,
} from "./admin-members-model";

describe("admin member model", () => {
  it("builds a normalized server-side filter and paging query", () => {
    expect(
      buildMemberQuery({
        q: "  creator@example.com ",
        role: "creator",
        status: "suspended",
        sort: "name_asc",
        limit: 25,
        offset: 50,
      }),
    ).toBe(
      "q=creator%40example.com&role=creator&status=suspended&sort=name&direction=asc&limit=25&offset=50",
    );
  });

  it("can omit paging for filtered CSV exports", () => {
    expect(
      buildMemberQuery(
        {
          q: "",
          role: "all",
          status: "active",
          sort: "created_desc",
          limit: 50,
          offset: 0,
        },
        { includePaging: false },
      ),
    ).toBe("status=active&sort=createdAt&direction=desc");
  });

  it("clamps pages after filters reduce the total", () => {
    expect(getPageCount(101, 25)).toBe(5);
    expect(clampPage(10, 12, 25)).toBe(1);
    expect(clampPage(-3, 100, 25)).toBe(1);
  });

  it("exports spreadsheet-safe UTF-8 CSV for the visible member page", () => {
    const csv = buildMemberCsv([
      {
        id: "member-1",
        name: "=HYPERLINK(\"https://example.com\")",
        email: "member@example.com",
        role: "creator",
        status: "active",
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "\"'=HYPERLINK(\"\"https://example.com\"\")\"",
    );
    expect(csv).toContain("\"member@example.com\"");
  });

  it("toggles one or all visible member selections without dropping hidden pages", () => {
    const selected = new Set(["hidden-page-id"]);
    expect([...toggleMemberSelection(selected, "visible-a")].sort()).toEqual([
      "hidden-page-id",
      "visible-a",
    ]);

    const selectedPage = toggleVisibleMemberSelection(selected, [
      "visible-a",
      "visible-b",
    ]);
    expect([...selectedPage].sort()).toEqual([
      "hidden-page-id",
      "visible-a",
      "visible-b",
    ]);

    const clearedPage = toggleVisibleMemberSelection(selectedPage, [
      "visible-a",
      "visible-b",
    ]);
    expect([...clearedPage]).toEqual(["hidden-page-id"]);
  });
});
