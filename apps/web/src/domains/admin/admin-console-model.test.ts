import { describe, expect, it } from "vitest";

import {
  buildAdminTabHref,
  countActiveCriticalAnnouncements,
  getAnnouncementOperationalStatus,
  parseAdminTab,
} from "./admin-console-model";

describe("admin console model", () => {
  it("accepts known tabs and falls back to the dashboard", () => {
    expect(parseAdminTab("traffic")).toBe("traffic");
    expect(parseAdminTab("members")).toBe("dashboard");
    expect(parseAdminTab(undefined)).toBe("dashboard");
  });

  it("keeps unrelated query parameters while updating the selected tab", () => {
    expect(buildAdminTabHref("/admin", "?source=shortcut", "reports")).toBe(
      "/admin?source=shortcut&tab=reports",
    );
    expect(buildAdminTabHref("/admin", "?source=shortcut&tab=reports", "dashboard")).toBe(
      "/admin?source=shortcut",
    );
  });

  it("derives announcement lifecycle states from activation and schedule", () => {
    const now = Date.parse("2026-09-05T00:00:00.000Z");
    expect(getAnnouncementOperationalStatus({ isActive: false }, now)).toBe("inactive");
    expect(
      getAnnouncementOperationalStatus(
        { isActive: true, startsAt: "2026-09-06T00:00:00.000Z" },
        now,
      ),
    ).toBe("scheduled");
    expect(
      getAnnouncementOperationalStatus(
        { isActive: true, endsAt: "2026-09-04T00:00:00.000Z" },
        now,
      ),
    ).toBe("expired");
    expect(getAnnouncementOperationalStatus({ isActive: true }, now)).toBe("active");
  });

  it("counts only currently active critical announcements", () => {
    const now = Date.parse("2026-09-05T00:00:00.000Z");
    expect(
      countActiveCriticalAnnouncements(
        [
          { level: "critical", isActive: true },
          {
            level: "critical",
            isActive: true,
            startsAt: "2026-09-06T00:00:00.000Z",
          },
          { level: "warning", isActive: true },
          { level: "critical", isActive: false },
        ],
        now,
      ),
    ).toBe(1);
  });
});
