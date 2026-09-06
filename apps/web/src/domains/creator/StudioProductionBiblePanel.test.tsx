import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  type StudioProductionBible,
} from "./studio-production-bible";
import {
  StudioProductionBiblePanel,
  StudioProductionBiblePanelSurface,
} from "./StudioProductionBiblePanel";

function fixture(): StudioProductionBible {
  let bible = createEmptyStudioProductionBible();
  bible = addStudioProductionBibleEntry(bible, {
    id: "location-rooftop",
    kind: "location",
    name: "학교 옥상",
    aliases: ["옥상"],
    visualKeywords: ["철망", "역광"],
  });
  bible = addStudioProductionBibleEntry(bible, {
    id: "prop-key",
    kind: "prop",
    name: "은색 열쇠",
  });
  bible = addStudioProductionBibleEntry(bible, {
    id: "scene-reunion",
    kind: "scene",
    name: "옥상 재회",
    linkedCharacterIds: ["character-yun"],
    linkedLocationIds: ["location-rooftop"],
    linkedPropIds: ["prop-key"],
    referenceAssetIds: ["asset-shot"],
  });
  return bible;
}

function renderSurface(
  bible: StudioProductionBible = fixture(),
  overrides: Partial<React.ComponentProps<typeof StudioProductionBiblePanelSurface>> = {}
): string {
  return renderToStaticMarkup(
    <StudioProductionBiblePanelSurface
      bible={bible}
      onChange={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe("StudioProductionBiblePanel", () => {
  it("does not mount a portal while closed or during server rendering", () => {
    expect(
      renderToStaticMarkup(
        <StudioProductionBiblePanel
          open={false}
          bible={createEmptyStudioProductionBible()}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      )
    ).toBe("");
  });

  it("states the local-only boundary and persistence durability without implying cloud sync", () => {
    const localOnly = renderSurface();
    expect(localOnly).toContain('data-studio-production-bible-local-only="true"');
    expect(localOnly).toContain("SQLite/OPFS 상태 확인 중 · 서버 동기화 없음");

    const sqlite = renderSurface(fixture(), {
      persistence: { backend: "sqlite", persisted: true },
    });
    expect(sqlite).toContain("이 기기 SQLite/OPFS 저장 · 서버 동기화 없음");

    const sqliteReady = renderSurface(createEmptyStudioProductionBible(), {
      persistence: { backend: "sqlite", persisted: false },
    });
    expect(sqliteReady).toContain("SQLite/OPFS 준비 · 첫 변경 시 저장");

    const memoryOnly = renderSurface(fixture(), {
      persistence: { backend: "memory", persisted: false },
    });
    expect(memoryOnly).toContain("메모리 임시 · 새로고침 전까지");
    expect(memoryOnly).not.toContain("클라우드");

    const unavailable = renderSurface(fixture(), {
      persistence: { backend: "unavailable", persisted: false },
    });
    expect(unavailable).toContain("SQLite/OPFS 사용 불가 · 저장되지 않음");
  });

  it("provides 44px touch controls, scroll-contained mobile regions, and named filters", () => {
    const html = renderSurface();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="바이블 종류 필터"');
    expect(html).toContain("끊긴 연결");
    expect(html).toContain("min-h-11");
    expect(html).toContain("max-h-[45vh]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("JSON 복사");
    expect(html).toContain("JSON 병합");
    expect(html).toContain('accept="application/json,.json"');
  });

  it("shows stable IDs and links to existing character, location, prop, and asset options", () => {
    const html = renderSurface(fixture(), {
      characterOptions: [{ id: "character-yun", label: "윤" }],
      assetOptions: [{ id: "asset-shot", label: "옥상 기준 샷" }],
    });
    expect(html).toContain("안정 ID · scene-reunion");
    expect(html).toContain("학교 옥상");
    expect(html).toContain("은색 열쇠");
    expect(html).toContain("character-yun");
    expect(html).toContain("asset-shot");
    expect(html).toContain("이름이 바뀌어도 연결이 유지되도록");
    expect(html).toContain('aria-pressed="true"');
  });

  it("distinguishes an unavailable external catalogue from an explicitly empty one", () => {
    const unavailable = renderSurface();
    expect(unavailable).not.toContain("캐릭터 바이블에 없는 ID");

    const knownEmpty = renderSurface(fixture(), {
      characterOptions: [],
      assetOptions: [],
    });
    expect(knownEmpty).toContain("캐릭터 바이블에 없는 ID");
    expect(knownEmpty).toContain("로컬 에셋에 없는 ID");
  });

  it("teaches the empty state and keeps all three production entry types one tap away", () => {
    const html = renderSurface(createEmptyStudioProductionBible());
    expect(html).toContain("첫 항목을 추가하세요");
    expect(html).toContain("첫 장면 만들기");
    expect(html).toContain("장면");
    expect(html).toContain("장소");
    expect(html).toContain("소품");
  });
});
