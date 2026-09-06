import { describe, expect, it } from "vitest";

import {
  addStudioReleaseScheduleItem,
  createEmptyStudioReleaseSchedule,
  exportStudioReleaseScheduleIcalendar,
  isStudioReleaseTemporalError,
  normalizeStudioReleaseSchedule,
  removeStudioReleaseScheduleItem,
  reorderStudioReleaseScheduleItem,
  resolveStudioReleaseUtc,
  serializeStudioReleaseSchedule,
  STUDIO_RELEASE_LOCAL_ONLY_NOTICE,
  STUDIO_RELEASE_SCHEDULE_MAX_ITEMS,
  STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH,
  STUDIO_RELEASE_SCHEDULE_MAX_SERIALIZED_BYTES,
  STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH,
  STUDIO_RELEASE_SCHEDULE_VERSION,
  StudioReleaseScheduleSchema,
  updateStudioReleaseScheduleItem,
  validateStudioReleaseSchedule,
  type StudioReleaseSchedule,
  type StudioReleaseScheduleItemInput,
} from "./studio-release-schedule";

const BASE_ITEM: StudioReleaseScheduleItemInput = {
  id: "episode-1",
  kind: "episode",
  title: "1화 — 시작",
  destination: "webtoon",
  localDate: "2026-08-01",
  localTime: "20:30",
  timeZone: "Asia/Seoul",
  status: "scheduled",
};

function scheduleWith(...items: StudioReleaseScheduleItemInput[]): StudioReleaseSchedule {
  return items.reduce(addStudioReleaseScheduleItem, createEmptyStudioReleaseSchedule());
}

function unfoldIcalendar(content: string): string {
  return content.replace(/\r\n /gu, "");
}

describe("studio release schedule normalization and serialization", () => {
  it("creates and serializes a strict versioned document", () => {
    const schedule = scheduleWith({ ...BASE_ITEM, notes: "  썸네일 확인  " });
    expect(schedule).toEqual({
      version: STUDIO_RELEASE_SCHEDULE_VERSION,
      items: [{ ...BASE_ITEM, notes: "썸네일 확인" }],
    });
    const serialized = serializeStudioReleaseSchedule(schedule);
    expect(StudioReleaseScheduleSchema.parse(JSON.parse(serialized))).toEqual(schedule);
  });

  it("migrates bounded legacy shapes and aliases without inventing IDs", () => {
    const normalized = normalizeStudioReleaseSchedule({
      releases: [
        {
          releaseId: " legacy-1 ",
          type: "milestone",
          name: "  시즌 피날레  ",
          platform: "webtoon-canvas",
          date: "2026-09-20",
          time: "18:00",
          timezone: "Asia/Seoul",
          status: "needs-review",
          description: "  배너 교체  ",
        },
        { title: "ID 없음" },
        { id: "legacy-1", title: "중복 ID" },
      ],
    });
    expect(normalized.items).toEqual([
      {
        id: "legacy-1",
        kind: "milestone",
        title: "시즌 피날레",
        destination: "webtoon",
        localDate: "2026-09-20",
        localTime: "18:00",
        timeZone: "Asia/Seoul",
        status: "review",
        notes: "배너 교체",
      },
    ]);
  });

  it("fails closed for malformed, oversized, and unknown future containers", () => {
    expect(normalizeStudioReleaseSchedule("{broken")).toEqual(createEmptyStudioReleaseSchedule());
    expect(normalizeStudioReleaseSchedule("x".repeat(STUDIO_RELEASE_SCHEDULE_MAX_SERIALIZED_BYTES + 1)))
      .toEqual(createEmptyStudioReleaseSchedule());
    expect(normalizeStudioReleaseSchedule({ version: 99, items: [BASE_ITEM] }))
      .toEqual(createEmptyStudioReleaseSchedule());
  });

  it("enforces item and text limits during normalization", () => {
    const items = Array.from({ length: STUDIO_RELEASE_SCHEDULE_MAX_ITEMS + 20 }, (_, index) => ({
      ...BASE_ITEM,
      id: `item-${index}`,
      title: "가".repeat(STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH + 50),
      notes: "나".repeat(STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH + 50),
    }));
    const schedule = normalizeStudioReleaseSchedule(items);
    expect(schedule.items).toHaveLength(STUDIO_RELEASE_SCHEDULE_MAX_ITEMS);
    expect(schedule.items[0].title).toHaveLength(STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH);
    expect(schedule.items[0].notes).toHaveLength(STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH);
  });
});

describe("studio release schedule immutable operations", () => {
  it("adds defaults immutably and rejects missing or duplicate client IDs", () => {
    const empty = createEmptyStudioReleaseSchedule();
    const next = addStudioReleaseScheduleItem(empty, { id: "draft-1" });
    expect(empty.items).toEqual([]);
    expect(next.items[0]).toEqual({
      id: "draft-1",
      kind: "episode",
      title: "",
      destination: "generic",
      localDate: "",
      localTime: "",
      timeZone: "",
      status: "draft",
    });
    expect(() => addStudioReleaseScheduleItem(next, { id: "draft-1" })).toThrow(/사용 중/);
    expect(() => addStudioReleaseScheduleItem(next, { id: "" })).toThrow(/ID/);
  });

  it("updates fields without mutating the source and keeps IDs immutable", () => {
    const schedule = scheduleWith(BASE_ITEM);
    const original = schedule.items[0];
    const next = updateStudioReleaseScheduleItem(schedule, BASE_ITEM.id, {
      title: "  수정된 제목  ",
      destination: "tapas",
      notes: "  메모  ",
    });
    expect(next).not.toBe(schedule);
    expect(next.items).not.toBe(schedule.items);
    expect(next.items[0]).not.toBe(original);
    expect(original.title).toBe(BASE_ITEM.title);
    expect(next.items[0]).toMatchObject({ id: BASE_ITEM.id, title: "수정된 제목", destination: "tapas" });
    expect(() => updateStudioReleaseScheduleItem(schedule, BASE_ITEM.id, { id: "changed" } as never))
      .toThrow(/수정할 수 없는/);
    expect(updateStudioReleaseScheduleItem(schedule, "missing", { title: "없음" })).toBe(schedule);
  });

  it("removes and reorders without mutating, with stable identity for no-ops", () => {
    const schedule = scheduleWith(
      { ...BASE_ITEM, id: "a" },
      { ...BASE_ITEM, id: "b" },
      { ...BASE_ITEM, id: "c" }
    );
    const moved = reorderStudioReleaseScheduleItem(schedule, "a", 99);
    expect(moved.items.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(schedule.items.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(reorderStudioReleaseScheduleItem(schedule, "missing", 1)).toBe(schedule);
    expect(reorderStudioReleaseScheduleItem(schedule, "b", Number.NaN)).toBe(schedule);
    const removed = removeStudioReleaseScheduleItem(schedule, "b");
    expect(removed.items.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(removeStudioReleaseScheduleItem(schedule, "missing")).toBe(schedule);
  });

  it("rejects additions above the hard item limit", () => {
    const full = normalizeStudioReleaseSchedule(
      Array.from({ length: STUDIO_RELEASE_SCHEDULE_MAX_ITEMS }, (_, index) => ({
        ...BASE_ITEM,
        id: `item-${index}`,
      }))
    );
    expect(() => addStudioReleaseScheduleItem(full, { id: "overflow" })).toThrow(/최대/);
  });
});

describe("studio release wall-clock resolution", () => {
  it("converts an IANA-zone local time to UTC independently of the host timezone", () => {
    expect(resolveStudioReleaseUtc({
      localDate: "2026-07-10",
      localTime: "21:30",
      timeZone: "Asia/Seoul",
    })).toMatchObject({
      ok: true,
      utcIso: "2026-07-10T12:30:00.000Z",
      ambiguous: false,
      canonicalTimeZone: "Asia/Seoul",
    });
  });

  it("rejects a DST gap instead of silently shifting it", () => {
    expect(resolveStudioReleaseUtc({
      localDate: "2026-03-08",
      localTime: "02:30",
      timeZone: "America/New_York",
    })).toEqual({ ok: false, reason: "nonexistent-local-time" });
  });

  it("resolves a DST overlap deterministically and supports later or reject", () => {
    const input = {
      localDate: "2026-11-01",
      localTime: "01:30",
      timeZone: "America/New_York",
    };
    expect(resolveStudioReleaseUtc(input)).toMatchObject({
      ok: true,
      utcIso: "2026-11-01T05:30:00.000Z",
      ambiguous: true,
      candidateUtcIso: ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"],
    });
    expect(resolveStudioReleaseUtc(input, { disambiguation: "later" })).toMatchObject({
      ok: true,
      utcIso: "2026-11-01T06:30:00.000Z",
    });
    expect(resolveStudioReleaseUtc(input, { disambiguation: "reject" }))
      .toEqual({ ok: false, reason: "ambiguous-local-time" });
  });

  it("distinguishes invalid calendar, clock, and timezone values", () => {
    expect(resolveStudioReleaseUtc({ localDate: "2026-02-30", localTime: "12:00", timeZone: "UTC" }))
      .toEqual({ ok: false, reason: "invalid-local-date" });
    expect(resolveStudioReleaseUtc({ localDate: "2026-02-20", localTime: "24:00", timeZone: "UTC" }))
      .toEqual({ ok: false, reason: "invalid-local-time" });
    expect(resolveStudioReleaseUtc({ localDate: "2026-02-20", localTime: "12:00", timeZone: "Mars/Olympus" }))
      .toEqual({ ok: false, reason: "invalid-time-zone" });
  });
});

describe("studio release schedule validation", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("reports missing fields as actionable errors", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith({ id: "empty" }), { now });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map(({ code }) => code)).toEqual([
      "missing-title",
      "missing-local-date",
      "missing-local-time",
      "missing-time-zone",
    ]);
    expect(validation.errorCount).toBe(4);
  });

  it("reports invalid and nonexistent local date-time fields", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith(
      { ...BASE_ITEM, id: "bad-date", localDate: "2026-02-30" },
      { ...BASE_ITEM, id: "bad-time", localTime: "99:00" },
      { ...BASE_ITEM, id: "bad-zone", timeZone: "Not/AZone" },
      {
        ...BASE_ITEM,
        id: "dst-gap",
        localDate: "2026-03-08",
        localTime: "02:30",
        timeZone: "America/New_York",
      }
    ), { now });
    expect(validation.issues.map(({ code }) => code)).toEqual([
      "invalid-local-date",
      "invalid-local-time",
      "invalid-time-zone",
      "nonexistent-local-time",
      "destination-policy-review",
    ]);
    expect(isStudioReleaseTemporalError(validation.issues[0])).toBe(true);
  });

  it("detects duplicate destination/UTC slots even across different timezones", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith(
      {
        ...BASE_ITEM,
        id: "utc",
        destination: "generic",
        localDate: "2026-07-11",
        localTime: "12:00",
        timeZone: "UTC",
      },
      {
        ...BASE_ITEM,
        id: "seoul",
        destination: "generic",
        localDate: "2026-07-11",
        localTime: "21:00",
        timeZone: "Asia/Seoul",
      },
      {
        ...BASE_ITEM,
        id: "other-destination",
        destination: "tapas",
        localDate: "2026-07-11",
        localTime: "12:00",
        timeZone: "UTC",
      }
    ), { now });
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "duplicate-slot",
      itemId: "seoul",
      relatedItemId: "utc",
    }));
  });

  it("catches status/date inconsistencies and warns for overdue unfinished work", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith(
      { ...BASE_ITEM, id: "scheduled-past", localDate: "2026-07-01", status: "scheduled" },
      { ...BASE_ITEM, id: "published-future", localDate: "2026-08-01", status: "published" },
      { ...BASE_ITEM, id: "draft-past", localDate: "2026-07-01", status: "draft" }
    ), { now });
    expect(validation.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "scheduled-in-past",
      "published-in-future",
      "unfinished-in-past",
    ]));
  });

  it("adds one current-policy reminder per ready/scheduled external destination", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith(
      { ...BASE_ITEM, id: "webtoon-1", destination: "webtoon" },
      { ...BASE_ITEM, id: "webtoon-2", destination: "webtoon", localTime: "20:31", status: "ready" },
      { ...BASE_ITEM, id: "tapas-1", destination: "tapas", localTime: "20:32" },
      { ...BASE_ITEM, id: "generic-1", destination: "generic", localTime: "20:33" }
    ), { now });
    const reminders = validation.issues.filter(({ code }) => code === "destination-policy-review");
    expect(reminders.map(({ destination }) => destination)).toEqual(["webtoon", "tapas"]);
    expect(reminders.every(({ message }) => /공식 최신 정책/.test(message))).toBe(true);
  });

  it("warns on an ambiguous DST overlap while using the stable earlier instant", () => {
    const validation = validateStudioReleaseSchedule(scheduleWith({
      ...BASE_ITEM,
      id: "overlap",
      destination: "generic",
      localDate: "2026-11-01",
      localTime: "01:30",
      timeZone: "America/New_York",
    }), { now });
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "ambiguous-local-time",
      severity: "warning",
      itemId: "overlap",
    }));
  });
});

describe("studio release schedule RFC 5545 export", () => {
  it("exports deterministic UTC VEVENT data with explicit local-only semantics", () => {
    const schedule = scheduleWith({
      ...BASE_ITEM,
      id: "private-client-id",
      title: "1화, 시작; 그리고\\다음\n줄",
      notes: "내부 비밀 메모",
    });
    const first = exportStudioReleaseScheduleIcalendar(schedule, {
      calendarName: "툰, 일정",
      generatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    const second = exportStudioReleaseScheduleIcalendar(schedule, {
      calendarName: "툰, 일정",
      generatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(first.content).toBe(second.content);
    expect(first).toMatchObject({
      filename: "toonspectrum-release-schedule.ics",
      mimeType: "text/calendar;charset=utf-8",
      eventCount: 1,
      exportedItemIds: ["private-client-id"],
      skippedItemIds: [],
    });
    expect(first.content).toContain("DTSTART:20260801T113000Z\r\n");
    expect(first.content).toContain("DTSTAMP:20260710T000000Z\r\n");
    expect(first.content).toContain("SUMMARY:1화\\, 시작\\; 그리고\\\\다음\\n줄");
    expect(unfoldIcalendar(first.content)).toContain(STUDIO_RELEASE_LOCAL_ONLY_NOTICE);
    expect(first.content).not.toContain("private-client-id");
    expect(first.content).not.toContain("내부 비밀 메모");
    expect(first.content).not.toContain("METHOD:PUBLISH");
    expect(first.content.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("includes notes only by explicit opt-in and escapes calendar injection", () => {
    const schedule = normalizeStudioReleaseSchedule({
      items: [{
        ...BASE_ITEM,
        id: "safe",
        notes: "첫 줄\r\nATTENDEE:mailto:attacker@example.com;쉼표,역슬래시\\",
        apiKey: "test-secret-that-must-never-export",
      }],
    });
    const result = exportStudioReleaseScheduleIcalendar(schedule, { includeNotes: true });
    expect(unfoldIcalendar(result.content))
      .toContain("메모: 첫 줄\\nATTENDEE:mailto:attacker@example.com\\;쉼표\\,역슬래시\\\\");
    expect(result.content).not.toContain("\r\nATTENDEE:");
    expect(result.content).not.toContain("test-secret-that-must-never-export");
  });

  it("folds every content line to at most 75 UTF-8 octets", () => {
    const result = exportStudioReleaseScheduleIcalendar(scheduleWith({
      ...BASE_ITEM,
      title: "긴한글제목".repeat(30),
    }));
    const encoder = new TextEncoder();
    for (const line of result.content.split("\r\n").filter(Boolean)) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(result.content).toContain("\r\n ");
  });

  it("reports invalid records as skipped and supports status filtering", () => {
    const schedule = scheduleWith(
      BASE_ITEM,
      { ...BASE_ITEM, id: "invalid", localDate: "" },
      { ...BASE_ITEM, id: "draft", localTime: "20:40", status: "draft" }
    );
    const result = exportStudioReleaseScheduleIcalendar(schedule, { statuses: ["scheduled"] });
    expect(result.eventCount).toBe(1);
    expect(result.exportedItemIds).toEqual([BASE_ITEM.id]);
    expect(result.skippedItemIds).toEqual(["invalid"]);
    expect(result.content.match(/BEGIN:VEVENT/gu)).toHaveLength(1);
    expect(result.validation.valid).toBe(false);
  });

  it("can reject ambiguous local times at export instead of guessing", () => {
    const schedule = scheduleWith({
      ...BASE_ITEM,
      id: "overlap",
      localDate: "2026-11-01",
      localTime: "01:30",
      timeZone: "America/New_York",
    });
    const result = exportStudioReleaseScheduleIcalendar(schedule, { disambiguation: "reject" });
    expect(result.eventCount).toBe(0);
    expect(result.skippedItemIds).toEqual(["overlap"]);
  });
});
