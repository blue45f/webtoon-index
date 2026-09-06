import { describe, expect, it } from "vitest";

import {
  STUDIO_MAIN_MENU_COMPOSITE_GROUPS,
  STUDIO_MAIN_MENU_PRESENTATION_ORDER,
  createStudioMainMenuPresentation,
  studioMainMenuPresentedTitleFor,
  type StudioMainMenuPresentableGroup,
} from "./studio-main-menu-presentation";

const CATALOGUE_IDS = [
  "file",
  "edit",
  "view",
  "canvas",
  "layer",
  "select",
  "transform",
  "brush",
  "filter",
  "vector",
  "text",
  "comic",
  "animation",
  "3d",
  "collaboration",
  "window",
  "ai",
  "help",
] as const;

const KO_LABELS: Record<string, string> = {
  file: "파일",
  edit: "편집",
  view: "보기",
  canvas: "캔버스",
  layer: "레이어",
  select: "선택",
  transform: "변형",
  brush: "그리기",
  filter: "필터",
  vector: "벡터",
  text: "텍스트",
  comic: "만화",
  animation: "애니메이션",
  "3d": "3D",
  collaboration: "협업",
  window: "창",
  ai: "AI",
  help: "도움말",
};

function catalogue(
  rowsPerGroup = 2,
  labels: Record<string, string> = KO_LABELS,
): StudioMainMenuPresentableGroup[] {
  return CATALOGUE_IDS.map((id): StudioMainMenuPresentableGroup => ({
    id,
    label: labels[id] ?? id,
    items: Array.from({ length: rowsPerGroup }, (_, index) => ({
      id: id + "-command-" + index,
    })),
  }));
}

describe("createStudioMainMenuPresentation", () => {
  it("presents the ten-title workflow menubar with AI visible and Help last", () => {
    const presentation = createStudioMainMenuPresentation(catalogue());

    expect(presentation.presentedGroupIds).toEqual([...STUDIO_MAIN_MENU_PRESENTATION_ORDER]);
    expect(presentation.presentedGroupIds).toHaveLength(10);
    expect(presentation.presentedGroupIds).toContain("ai");
    expect(presentation.presentedGroupIds.at(-1)).toBe("help");
    expect(presentation.specialistBoundaryGroupId).toBeNull();
  });

  it("folds related catalogue groups without dropping or reordering commands", () => {
    const groups = catalogue(3);
    const presentation = createStudioMainMenuPresentation(groups);

    expect(presentation.compositeSources).toEqual({
      file: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.file],
      edit: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.edit],
      view: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.view],
      insert: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.insert],
      comic: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.comic],
      filter: [...STUDIO_MAIN_MENU_COMPOSITE_GROUPS.filter],
    });

    for (const [title, sources] of Object.entries(STUDIO_MAIN_MENU_COMPOSITE_GROUPS)) {
      const presented = presentation.groups.find((group) => group.id === title);
      const expectedIds = sources.flatMap((sourceId) =>
        groups.find((group) => group.id === sourceId)!.items.map((item) => item.id),
      );
      expect(presented?.items.map((item) => item.id)).toEqual(expectedIds);
    }

    for (const sourceId of ["collaboration", "select", "transform", "canvas", "window", "text", "vector", "3d", "animation"]) {
      expect(presentation.presentedGroupIds).not.toContain(sourceId);
    }
  });

  it("captions every source section and draws one rule between adjacent sections", () => {
    const presentation = createStudioMainMenuPresentation(catalogue(2));
    const edit = presentation.groups.find((group) => group.id === "edit")!;

    expect(
      edit.items.map((item) => item.sectionLabel).filter((label) => label !== undefined),
    ).toEqual(["편집", "선택", "변형"]);
    expect(edit.items.map((item) => Boolean(item.separatorAfter))).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("uses workflow labels in Korean and English while honouring explicit overrides", () => {
    const korean = createStudioMainMenuPresentation(catalogue(1));
    expect(korean.groups.find((group) => group.id === "insert")?.label).toBe("삽입");
    expect(korean.groups.find((group) => group.id === "filter")?.label).toBe("효과");
    expect(korean.groups.find((group) => group.id === "ai")?.label).toBe("AI");

    const english = createStudioMainMenuPresentation(
      catalogue(1, {
        file: "File",
        edit: "Edit",
        view: "View",
        comic: "Comic",
        filter: "Filters",
        ai: "AI",
        help: "Help",
      }),
    );
    expect(english.groups.find((group) => group.id === "file")?.label).toBe("File");
    expect(english.groups.find((group) => group.id === "insert")?.label).toBe("Insert");
    expect(english.groups.find((group) => group.id === "filter")?.label).toBe("Effects");

    const overridden = createStudioMainMenuPresentation(catalogue(1), {
      labels: { insert: "挿入", filter: "効果" },
    });
    expect(overridden.groups.find((group) => group.id === "insert")?.label).toBe("挿入");
    expect(overridden.groups.find((group) => group.id === "filter")?.label).toBe("効果");
  });

  it("keeps unknown future groups in source order immediately before Help", () => {
    const groups: StudioMainMenuPresentableGroup[] = [
      { id: "layer", label: "레이어", items: [{ id: "layer" }] },
      { id: "future-a", label: "A", items: [{ id: "a" }] },
      { id: "ai", label: "AI", items: [{ id: "assist" }] },
      { id: "future-b", label: "B", items: [{ id: "b" }] },
      { id: "help", label: "도움말", items: [{ id: "h" }] },
    ];

    const presentation = createStudioMainMenuPresentation(groups);
    expect(presentation.presentedGroupIds).toEqual([
      "layer",
      "ai",
      "future-a",
      "future-b",
      "help",
    ]);
  });

  it("passes standalone groups and command arrays through by reference", () => {
    const groups = catalogue(2);
    const presentation = createStudioMainMenuPresentation(groups);

    for (const id of ["layer", "brush", "ai", "help"]) {
      const source = groups.find((group) => group.id === id);
      const presented = presentation.groups.find((group) => group.id === id);
      expect(presented).toBe(source);
      expect(presented?.items).toBe(source?.items);
    }
  });

  it("omits workflow composites whose source groups are absent", () => {
    const presentation = createStudioMainMenuPresentation([
      { id: "layer", label: "레이어", items: [{ id: "layer" }] },
      { id: "ai", label: "AI", items: [{ id: "assist" }] },
      { id: "help", label: "도움말", items: [{ id: "help" }] },
    ]);
    expect(presentation.presentedGroupIds).toEqual(["layer", "ai", "help"]);
    expect(presentation.compositeSources).toEqual({});
  });

  it("maps every absorbed group to its visible workflow title", () => {
    expect(studioMainMenuPresentedTitleFor("collaboration")).toBe("file");
    expect(studioMainMenuPresentedTitleFor("select")).toBe("edit");
    expect(studioMainMenuPresentedTitleFor("transform")).toBe("edit");
    expect(studioMainMenuPresentedTitleFor("canvas")).toBe("view");
    expect(studioMainMenuPresentedTitleFor("window")).toBe("view");
    expect(studioMainMenuPresentedTitleFor("text")).toBe("insert");
    expect(studioMainMenuPresentedTitleFor("3d")).toBe("insert");
    expect(studioMainMenuPresentedTitleFor("animation")).toBe("comic");
    expect(studioMainMenuPresentedTitleFor("filter")).toBe("filter");
    expect(studioMainMenuPresentedTitleFor("ai")).toBe("ai");
  });
});
