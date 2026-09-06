// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_BRUSH_QUARANTINED_PRESET_IDS } from "./studio-brush-quarantine";
import { StudioBrushTray } from "./StudioBrushTray";

const traySource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/brush/StudioBrushTray.tsx"),
  "utf8"
);

afterEach(cleanup);

describe("StudioBrushTray", () => {
  it("renders recent and favorite brushes with a single full-library affordance", () => {
    const onSelect = vi.fn();
    const onOpenLibrary = vi.fn();
    const html = renderToStaticMarkup(
      <StudioBrushTray
        activeBrushId="pen"
        favoriteBrushIds={["neon", "pen"]}
        recentBrushIds={["marker", "neon", "gpen"]}
        onSelect={onSelect}
        onOpenLibrary={onOpenLibrary}
      />
    );
    expect(html).toContain('data-studio-brush-tray="true"');
    expect(html).toContain('data-studio-brush-surface-role="quick-subtools"');
    expect(html).toContain('role="listbox"');
    // Names live in aria-label / title only — no short-label text chips
    expect(html).toContain('aria-label="');
    expect(html).toContain("펜");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-studio-quick-source="favorite"');
    expect(html).toContain('data-studio-quick-source="recent"');
    expect(html).toContain('data-studio-quick-source="starter"');
    expect(html).toContain('data-studio-open-brush-library="true"');
    expect(html).toContain('aria-label="브러시 전체 라이브러리와 관리 열기"');
    expect(html).toContain("라이브러리");
    expect(html).toContain('data-studio-brush-kind="펜·잉크"');
    expect(html).not.toContain("브러시 키트 펼치기");
    expect(html).not.toContain("브러시 키트 접기");
    // Commercial stroke-preview glyphs (not text-only chips)
    expect(html).toContain('data-studio-brush-preview=');
    expect(html).toContain('data-studio-brush-chip="pen"');
    expect(html).toContain('data-studio-brush-media=');
    // The quick shelf never duplicates the full catalog's category tabs.
    expect(html).not.toContain('role="tablist"');
    expect(traySource).toContain("onOpenLibrary(event.currentTarget)");
  });

  it("loads persisted pro favorites through the deferred catalogue without injection", async () => {
    const onSelect = vi.fn();
    render(
      <StudioBrushTray
        activeBrushId="heart-stamp"
        favoriteBrushIds={["heart-stamp"]}
        recentBrushIds={["hair-fiber", "ink-particle"]}
        onSelect={onSelect}
        onOpenLibrary={vi.fn()}
      />
    );

    const tray = screen.getByRole("listbox").closest("[data-studio-brush-tray]");
    expect(tray?.getAttribute("aria-busy")).toBe("true");
    expect(tray?.getAttribute("data-studio-pro-catalog-state")).toBe("loading");
    const heart = await screen.findByRole("option", {
      name: /즐겨찾기 브러시 하트 도장 · 질감/,
    });
    const hair = await screen.findByRole("option", {
      name: /최근 사용 브러시 머리카락 결 · 질감/,
    });
    expect(heart.getAttribute("aria-selected")).toBe("true");
    expect(heart.getAttribute("data-studio-brush-chip")).toBe("heart-stamp");
    expect(hair.getAttribute("data-studio-brush-chip")).toBe("hair-fiber");
    expect(tray?.getAttribute("aria-busy")).toBeNull();
    expect(tray?.getAttribute("data-studio-pro-catalog-state")).toBe("loaded");

    fireEvent.click(hair);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({
      id: "hair-fiber",
      name: "머리카락 결",
      quickSource: "recent",
    });
  });

  it("keeps quarantined favorites off both the core and deferred listing lanes", async () => {
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS.length).toBeGreaterThan(0);
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;

    // Core-only path (no pack ids, no deferred load): the quarantined favorite is skipped,
    // never a hole — listed neighbours keep their slots.
    const html = renderToStaticMarkup(
      <StudioBrushTray
        activeBrushId="pen"
        favoriteBrushIds={[quarantinedId, "pen"]}
        recentBrushIds={[quarantinedId, "marker"]}
        onSelect={vi.fn()}
        onOpenLibrary={vi.fn()}
      />
    );
    expect(html).not.toContain(`data-studio-brush-chip="${quarantinedId}"`);
    expect(html).toContain('data-studio-brush-chip="pen"');
    expect(html).toContain('data-studio-brush-chip="marker"');

    // Deferred pro path: the tray injects the LISTED (quarantine-filtered) catalogue, so the
    // quarantined id stays off the shelf after the full catalogue arrives too.
    render(
      <StudioBrushTray
        activeBrushId="pen"
        favoriteBrushIds={[quarantinedId, "heart-stamp"]}
        onSelect={vi.fn()}
        onOpenLibrary={vi.fn()}
      />
    );
    const heart = await screen.findByRole("option", {
      name: /즐겨찾기 브러시 하트 도장/,
    });
    expect(heart.getAttribute("data-studio-brush-chip")).toBe("heart-stamp");
    expect(
      document.querySelector(`[data-studio-brush-chip="${quarantinedId}"]`)
    ).toBeNull();
    expect(traySource).toContain("loadStudioListedBrushCatalogItems");
    expect(traySource).not.toContain("loadStudioFullBrushCatalogItems");
  });

  it("uses the selected preset's real outer opacity in the quick preview", () => {
    const html = renderToStaticMarkup(
      <StudioBrushTray
        activeBrushId="highlighter"
        favoriteBrushIds={["highlighter"]}
        onSelect={vi.fn()}
        onOpenLibrary={vi.fn()}
      />
    );

    expect(html).toContain('data-studio-brush-chip="highlighter"');
    expect(html).toContain('opacity="0.45"');
  });

  it("uses one roving tab stop and arrow keys across the quick shelf", () => {
    render(
      <StudioBrushTray
        activeBrushId="pen"
        favoriteBrushIds={["pen", "neon"]}
        recentBrushIds={["marker"]}
        onSelect={vi.fn()}
        onOpenLibrary={vi.fn()}
      />
    );

    const options = screen.getAllByRole("option");
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
    expect(options[0]?.tabIndex).toBe(0);
    const scrollIntoView = vi.fn();
    Object.defineProperty(options[1]!, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    options[0]?.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    expect(options[1]?.tabIndex).toBe(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    fireEvent.keyDown(options[1]!, { key: "End" });
    expect(document.activeElement).toBe(options.at(-1));
  });
});
