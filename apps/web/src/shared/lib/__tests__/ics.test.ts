import { describe, it, expect } from "vitest";

import { buildWeeklyIcs, titleToWeeklyIcsEvent } from "../ics";

import { makeTitle } from "./fixtures";

// 2026-06-10T03:00:00Z = 2026-06-10(수) 12:00 KST — DTSTART/DTSTAMP 결정성용 고정 시각
const WED_NOON_KST = new Date("2026-06-10T03:00:00Z");

function physicalLines(ics: string): string[] {
  return ics.split("\r\n").filter(Boolean);
}

// 75옥텟 folding(CRLF+공백)을 펼쳐 논리 라인으로 복원
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

describe("buildWeeklyIcs", () => {
  it("VCALENDAR 골격 + 작품 수만큼 VEVENT를 만든다 (UID는 결정적)", () => {
    const ics = buildWeeklyIcs(
      [
        { uid: "solo-leveling@toonspectrum", summary: "나 혼자만 레벨업", days: ["월"] },
        { uid: "tower-of-god@toonspectrum", summary: "신의 탑", days: ["일"] },
      ],
      { calendarName: "툰스펙트럼 연재 캘린더", now: WED_NOON_KST }
    );
    const lines = physicalLines(ics);

    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//ToonSpectrum//Release Calendar//KO");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines).toContain("X-WR-CALNAME:툰스펙트럼 연재 캘린더");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines).toContain("UID:solo-leveling@toonspectrum");
    expect(lines).toContain("UID:tower-of-god@toonspectrum");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("DTSTART는 연재 요일의 다음 KST 도래일(종일), BYDAY는 요일 순으로 매핑한다", () => {
    const ics = buildWeeklyIcs(
      [{ uid: "a@toonspectrum", summary: "금·월 연재", days: ["금", "월"] }],
      { now: WED_NOON_KST }
    );
    const lines = physicalLines(ics);

    // 수요일 기준 가장 가까운 연재일은 금요일(6/12). DTEND는 비포함 다음 날.
    expect(lines).toContain("DTSTART;VALUE=DATE:20260612");
    expect(lines).toContain("DTEND;VALUE=DATE:20260613");
    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,FR");
    expect(lines).toContain("DTSTAMP:20260610T030000Z");
  });

  it("오늘이 연재 요일이면 오늘을 DTSTART로 쓴다", () => {
    const ics = buildWeeklyIcs([{ uid: "a@toonspectrum", summary: "수요웹툰", days: ["수"] }], {
      now: WED_NOON_KST,
    });

    expect(physicalLines(ics)).toContain("DTSTART;VALUE=DATE:20260610");
  });

  it("요일 계산은 서버 TZ가 아니라 KST 기준이다 (UTC 자정 경계)", () => {
    // 2026-06-10T16:30:00Z = UTC로는 아직 수요일 밤, KST로는 6/11(목) 01:30
    const ics = buildWeeklyIcs([{ uid: "a@toonspectrum", summary: "목요웹툰", days: ["목"] }], {
      now: new Date("2026-06-10T16:30:00Z"),
    });

    expect(physicalLines(ics)).toContain("DTSTART;VALUE=DATE:20260611");
  });

  it("§3.3.11 TEXT 이스케이프 — 콤마·세미콜론·개행·백슬래시가 속성 안으로 새지 않는다", () => {
    const ics = buildWeeklyIcs(
      [
        {
          uid: "a@toonspectrum",
          summary: "와인, 티; 모임",
          description: "첫 줄\r\n둘째 줄, 세미콜론; 백슬래시 \\",
          days: ["월"],
        },
      ],
      { now: WED_NOON_KST }
    );
    const lines = physicalLines(ics);

    expect(lines).toContain("SUMMARY:와인\\, 티\\; 모임");
    expect(lines).toContain("DESCRIPTION:첫 줄\\n둘째 줄\\, 세미콜론\\; 백슬래시 \\\\");
  });

  it("긴 한글 라인은 75 UTF-8 옥텟 이하로 접히고, 펼치면 원문이 복원된다", () => {
    const summary = "한글".repeat(40);
    const ics = buildWeeklyIcs(
      [
        {
          uid: "a@toonspectrum",
          summary,
          description: "설명".repeat(45),
          url: "https://www.toonstudio.cloud/title/long",
          days: ["월"],
        },
      ],
      { now: WED_NOON_KST }
    );
    const encoder = new TextEncoder();

    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`SUMMARY:${summary}`);
  });

  it("매핑할 수 없는 요일 라벨은 버리고, 요일이 전무한 이벤트는 통째로 건너뛴다", () => {
    const ics = buildWeeklyIcs(
      [
        { uid: "mixed@toonspectrum", summary: "혼합", days: ["월", "데일리"] },
        { uid: "unknown@toonspectrum", summary: "요일 없음", days: ["데일리"] },
      ],
      { now: WED_NOON_KST }
    );
    const lines = physicalLines(ics);

    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines).not.toContain("UID:unknown@toonspectrum");
  });
});

describe("titleToWeeklyIcsEvent", () => {
  it("결정적 UID(slug@toonspectrum)·작품 링크·요일/플랫폼 설명을 만든다", () => {
    const title = makeTitle({
      slug: "omniscient-reader",
      title: "전지적 독자 시점",
      updateDays: ["수", "토"],
      availability: [
        { platformId: "naver-webtoon", pricing: "free" },
        { platformId: "naver-series", pricing: "paid" },
      ],
    });

    const event = titleToWeeklyIcsEvent(title);

    expect(event.uid).toBe("omniscient-reader@toonspectrum");
    expect(event.summary).toBe("전지적 독자 시점 새 회차");
    expect(event.days).toEqual(["수", "토"]);
    expect(event.url).toBe("https://www.toonstudio.cloud/title/omniscient-reader");
    expect(event.description).toContain("매주 수·토 연재");
    expect(event.description).toContain("네이버웹툰");
    expect(event.description).toContain("시리즈");
  });

  it("days 인자를 넘기면 updateDays 대신 그 요일만 쓴다 (필터된 보드 버킷 기준)", () => {
    const title = makeTitle({ slug: "some-toon", updateDays: ["월", "목"] });

    const event = titleToWeeklyIcsEvent(title, ["목"]);

    expect(event.days).toEqual(["목"]);
    expect(event.description).toContain("매주 목 연재");
  });
});
