import { describe, expect, it, vi } from "vitest";

import {
  localizeStudioMainMenuGroups,
  type StudioMainMenuLocalizationState,
} from "./studio-main-menu-localization";

import type { StudioMainMenuGroup } from "./studio-main-menu-model";

const BASE_STATE: StudioMainMenuLocalizationState = {
  sharedNonOwnerSave: false,
  hasWorkId: false,
  filterDisabled: false,
  filterUnavailableReason: null,
  canvasRotation: 90,
  pageSequenceOpen: false,
  quickAccessPaletteOpen: false,
  quickAccessPaletteLoading: false,
  leftPanelOpen: false,
  rightPanelOpen: false,
  lastFilterDraft: null,
};

function translator(dictionary: Readonly<Record<string, string>>) {
  return (key: string) => dictionary[key] ?? key;
}

function groups(): StudioMainMenuGroup[] {
  const onSelect = vi.fn();
  return [
    {
      id: "file",
      label: "파일",
      items: [
        { id: "save-draft", label: "초안 저장", onSelect },
        { id: "publish", label: "게시", onSelect },
        {
          id: "import-ora-cbz",
          label: "ORA · CBZ · WILL 가져오기…",
          onSelect,
        },
      ],
    },
    {
      id: "view",
      label: "보기",
      items: [
        { id: "reset-rotation", label: "보기 회전 초기화 (90°)", onSelect },
        { id: "page-sequence", label: "페이지 시퀀스 열기", onSelect },
        { id: "quick-access-palette", label: "빠른 액세스 열기", onSelect },
        { id: "left-panel", label: "왼쪽 패널 보이기", onSelect },
        { id: "right-panel", label: "속성 패널 보이기", onSelect },
        {
          id: "color-vision-grayscale",
          label: "흑백 명암",
          unavailableReason: "미리보기를 사용할 수 없습니다.",
          onSelect,
        },
      ],
    },
    {
      id: "filter",
      label: "필터",
      items: [
        {
          id: "last-filter",
          label: "마지막 필터…",
          unavailableReason: "다시 열 필터가 없습니다.",
          onSelect,
        },
        {
          id: "gaussian-blur",
          label: "가우시안 블러",
          unavailableReason: "필터를 사용할 수 없습니다.",
          onSelect,
        },
      ],
    },
  ];
}

function item(
  projected: readonly StudioMainMenuGroup[],
  groupId: string,
  itemId: string,
) {
  const found = projected
    .find((group) => group.id === groupId)
    ?.items.find((candidate) => candidate.id === itemId);
  if (!found) throw new Error(`Missing ${groupId}/${itemId}`);
  return found;
}

describe("localizeStudioMainMenuGroups", () => {
  it("does not let the legacy Korean locale term override the server draft label", () => {
    const projected = localizeStudioMainMenuGroups(
      groups(),
      BASE_STATE,
      translator({
        "studio.mainMenu.item.file.save-draft": "임시저장",
      }),
    );

    expect(item(projected, "file", "save-draft").label).toBe("초안 저장");
  });

  it("keeps the Korean reference-window checkbox label stable across toggle states", () => {
    const projected = localizeStudioMainMenuGroups(
      [{
        id: "window",
        label: "창",
        items: [{
          id: "reference-window",
          legacyPath: "view/reference-window",
          label: "참고 이미지 창",
          checked: false,
          onSelect: vi.fn(),
        }],
      }],
      BASE_STATE,
      translator({
        "studio.mainMenu.item.view.reference-window": "참고 이미지 창 열기",
      }),
    );

    expect(item(projected, "window", "reference-window").label).toBe("참고 이미지 창");
  });

  it("projects dynamic translation keys without mutating catalogue groups or callbacks", () => {
    const source = groups();
    const onSelect = source[0].items[0].onSelect;
    const projected = localizeStudioMainMenuGroups(
      source,
      {
        ...BASE_STATE,
        sharedNonOwnerSave: true,
        hasWorkId: true,
        pageSequenceOpen: true,
        quickAccessPaletteLoading: true,
        leftPanelOpen: true,
        rightPanelOpen: true,
        lastFilterDraft: { kind: "gaussian-blur" },
      },
      translator({
        "studio.mainMenu.group.file.label": "File",
        "studio.mainMenu.item.file.save-draft.shared": "Shared save",
        "studio.mainMenu.item.file.publish.has-work": "Update publish",
        "studio.mainMenu.item.file.import-ora-cbz": "Import ORA / CBZ…",
        "studio.mainMenu.item.view.reset-rotation": "Reset rotation ({angle}°)",
        "studio.mainMenu.item.view.page-sequence.open": "Close sequence",
        "studio.mainMenu.item.view.quick-access-palette.loading": "Opening quick access…",
        "studio.mainMenu.item.view.left-panel.open": "Hide left panel",
        "studio.mainMenu.item.view.right-panel.open": "Hide properties",
        "studio.mainMenu.item.filter.last-filter.ready": "Reopen last filter",
      }),
    );

    expect(source[0].label).toBe("파일");
    expect(projected[0].label).toBe("File");
    expect(item(projected, "file", "save-draft").label).toBe("Shared save");
    expect(item(projected, "file", "publish").label).toBe("Update publish");
    expect(item(projected, "file", "import-ora-cbz").label)
      .toBe("Import ORA / CBZ / WILL…");
    expect(item(projected, "view", "reset-rotation").label).toBe("Reset rotation (90°)");
    expect(item(projected, "view", "page-sequence").label).toBe("Close sequence");
    expect(item(projected, "view", "quick-access-palette").label).toBe("Opening quick access…");
    expect(item(projected, "view", "left-panel").label).toBe("Hide left panel");
    expect(item(projected, "view", "right-panel").label).toBe("Hide properties");
    expect(item(projected, "filter", "last-filter").label).toBe("Reopen last filter");
    expect(item(projected, "file", "save-draft").onSelect).toBe(onSelect);
  });

  it("uses explicit command keys, contextual unavailable copy, and Korean fallbacks", () => {
    const source = groups();
    const editItem = {
      id: "undo",
      label: "실행 취소",
      labelKey: "studio.mainMenu.edit.command.undo",
      onSelect: vi.fn(),
    };
    const projected = localizeStudioMainMenuGroups(
      [...source, { id: "edit", label: "편집", items: [editItem] }],
      {
        ...BASE_STATE,
        filterDisabled: true,
        filterUnavailableReason: "재생 중에는 필터를 적용할 수 없습니다.",
      },
      translator({
        "studio.mainMenu.edit.command.undo": "Undo",
        "studio.mainMenu.item.filter.unavailable": "Stop playback to use filters.",
        "studio.mainMenu.item.view.color-vision.unavailable": "Preview unavailable.",
      }),
    );

    expect(item(projected, "edit", "undo").label).toBe("Undo");
    // 상태가 실제 사유를 들고 오면 **그 문장이 이긴다.** 정적 키는 사유를 모를 때 쓰는 일반
    // 문구라, 여기서 키가 이기면 어렵게 계산한 사유(자동 줄바꿈 글상자·지우개 자국 레이어…)가
    // 매번 지워진다 — 측정된 #10 결함이 그 모양이었다(51개 항목이 전부 같은 한 줄).
    expect(item(projected, "filter", "last-filter").unavailableReason).toBe(
      "재생 중에는 필터를 적용할 수 없습니다.",
    );
    expect(item(projected, "filter", "gaussian-blur").unavailableReason).toBe(
      "재생 중에는 필터를 적용할 수 없습니다.",
    );
    expect(item(projected, "view", "color-vision-grayscale").unavailableReason).toBe(
      "Preview unavailable.",
    );
    expect(projected.find((group) => group.id === "view")?.label).toBe("보기");
  });

  it("falls back to the localized generic filter reason when no specific reason exists", () => {
    const projected = localizeStudioMainMenuGroups(
      groups(),
      { ...BASE_STATE, filterDisabled: true, filterUnavailableReason: null },
      translator({
        "studio.mainMenu.item.filter.unavailable": "Stop playback to use filters.",
      }),
    );

    expect(item(projected, "filter", "gaussian-blur").unavailableReason).toBe(
      "Stop playback to use filters.",
    );
  });

  it("uses the empty-last-filter unavailable key when filters are otherwise available", () => {
    const projected = localizeStudioMainMenuGroups(
      groups(),
      BASE_STATE,
      translator({
        "studio.mainMenu.item.filter.last-filter.empty": "Last filter…",
        "studio.mainMenu.item.filter.last-filter.empty-unavailable": "No filter settings yet.",
      }),
    );

    expect(item(projected, "filter", "last-filter")).toMatchObject({
      label: "Last filter…",
      unavailableReason: "No filter settings yet.",
    });
    expect(item(projected, "filter", "gaussian-blur").unavailableReason).toBe(
      "필터를 사용할 수 없습니다.",
    );
  });

  it("keys the command bar row off visibility so show and hide never share a sentence", () => {
    const windowGroup = (): StudioMainMenuGroup => ({
      id: "window",
      label: "창",
      items: [
        {
          id: "command-bar",
          label: "명령 바 숨기기",
          unavailableReason: "명령 바 표시 전환이 연결되지 않았습니다.",
          onSelect: vi.fn(),
        },
      ],
    });
    const dictionary = translator({
      "studio.mainMenu.item.window.command-bar": "Show command bar",
      "studio.mainMenu.item.window.command-bar.open": "Hide command bar",
      "studio.mainMenu.item.window.command-bar.unavailable": "No toggle on this screen.",
    });

    expect(
      item(
        localizeStudioMainMenuGroups(
          [windowGroup()],
          { ...BASE_STATE, commandBarVisible: false },
          dictionary,
        ),
        "window",
        "command-bar",
      ),
    ).toMatchObject({
      label: "Show command bar",
      unavailableReason: "No toggle on this screen.",
    });
    expect(
      item(
        localizeStudioMainMenuGroups(
          [windowGroup()],
          { ...BASE_STATE, commandBarVisible: true },
          dictionary,
        ),
        "window",
        "command-bar",
      ).label,
    ).toBe("Hide command bar");
    // An authored layout that has never toggled the strip carries no flag at all;
    // the builder reads that as visible, so the label must too.
    expect(
      item(
        localizeStudioMainMenuGroups([windowGroup()], BASE_STATE, dictionary),
        "window",
        "command-bar",
      ).label,
    ).toBe("Hide command bar");
  });

  it("localizes the layer border effect row through the plain group/item key", () => {
    const projected = localizeStudioMainMenuGroups(
      [
        {
          id: "layer",
          label: "레이어",
          items: [
            {
              id: "border-effect",
              label: "경계 효과…",
              unavailableReason: "경계 효과를 적용할 이미지 레이어를 먼저 선택하세요.",
              onSelect: vi.fn(),
            },
          ],
        },
      ],
      BASE_STATE,
      translator({
        "studio.mainMenu.item.layer.border-effect": "Border effect…",
        "studio.mainMenu.item.layer.border-effect.unavailable":
          "Select an image layer to apply a border effect to.",
      }),
    );

    expect(item(projected, "layer", "border-effect")).toMatchObject({
      label: "Border effect…",
      unavailableReason: "Select an image layer to apply a border effect to.",
    });
  });
});
