import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CREATOR_DESTINATIONS, CREATOR_FILM, HOME_COPY, creatorHomeLocale } from "./creator-home-content";
import { CREATOR_HOME_SECTIONS } from "./creator-home-navigation";

describe("creator-first home contracts", () => {
  it("keeps the creator entry and legacy discovery destinations reachable", () => {
    expect(CREATOR_DESTINATIONS).toContain("/studio");
    expect(CREATOR_DESTINATIONS).toContain("/ranking");
    expect(CREATOR_DESTINATIONS).toContain("/explore");
    for (const copy of Object.values(HOME_COPY)) {
      for (const entry of [...copy.stages, ...copy.features]) {
        expect(CREATOR_DESTINATIONS).toContain(entry.href);
        expect(entry.title.length).toBeGreaterThan(0);
      }
      expect(copy.stages).toHaveLength(3);
      expect(copy.chapterLabels).toHaveLength(CREATOR_FILM.chapters.length);
      expect(copy.faqs).toHaveLength(4);
    }
  });
  it("uses a Korean locale and an explicit English fallback", () => {
    expect(creatorHomeLocale("ko-KR")).toBe("ko");
    expect(creatorHomeLocale("KO_kr")).toBe("ko");
    expect(creatorHomeLocale("en-US")).toBe("en");
    expect(creatorHomeLocale("ja")).toBe("en");
  });
  it("keeps film chapters within the rendered duration and serves same-origin assets", () => {
    expect(CREATOR_FILM.chapters).toEqual([0, 6, 12, 18]);
    for (const time of CREATOR_FILM.chapters) expect(time).toBeLessThan(CREATOR_FILM.duration);
    for (const asset of [CREATOR_FILM.src, CREATOR_FILM.poster, CREATOR_FILM.captions]) expect(asset).toMatch(/^\/brand\/[a-z0-9.-]+$/);
  });
  it("does not import the studio engine or Remotion into the homepage", () => {
    const source = readFileSync("apps/web/src/domains/marketing/CreatorHomePage.tsx", "utf8");
    const picker = readFileSync("apps/web/src/domains/marketing/CreatorWorkflowPicker.tsx", "utf8");
    expect(source).not.toMatch(/from ["'](?:remotion|@remotion|.*StudioPage)/);
    expect(source).toContain('mode === "playing"');
    expect(source).toContain('kind="captions"');
    expect(picker).toContain('aria-pressed={stage === index}');
    expect(source.match(/<CreatorWorkflowPicker\b/g)).toHaveLength(2);
    expect(source).toContain('placement="process"');
  });
  it("gives every public jump destination a unique keyboard-focusable heading", () => {
    const source = readFileSync("apps/web/src/domains/marketing/CreatorHomePage.tsx", "utf8");
    for (const section of CREATOR_HOME_SECTIONS) {
      expect(source.split(`id="${section.id}"`)).toHaveLength(2);
      expect(source).toContain(`<h2 id="${section.headingId}" tabIndex={-1}>`);
    }
  });
});
