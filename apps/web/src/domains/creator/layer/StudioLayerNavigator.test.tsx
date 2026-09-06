import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createLayerGroup, type LayerGroup } from "../studio-layers";

import { StudioLayerNavigator, type StudioLayerNavigatorProps } from "./StudioLayerNavigator";

import type { StudioLayerNavigatorItem } from "./studio-layer-navigator";

const noopSelection: StudioLayerNavigatorProps["onSelectionChange"] = () => {
  // 정적 SSR 계약 테스트에서는 이벤트를 실행하지 않는다.
};
const noopAction: StudioLayerNavigatorProps["onAction"] = () => {
  // 정적 SSR 계약 테스트에서는 이벤트를 실행하지 않는다.
};
const noopToggleLocalHidden: StudioLayerNavigatorProps["onToggleLocalHidden"] = () => {
  // 정적 SSR 계약 테스트에서는 이벤트를 실행하지 않는다.
};
const noopToggleLayerSolo: NonNullable<StudioLayerNavigatorProps["onToggleLayerSolo"]> = () => {
  // 정적 SSR 계약 테스트에서는 이벤트를 실행하지 않는다.
};

function layer(
  id: string,
  type: string,
  zIndex: number,
  patch: Partial<StudioLayerNavigatorItem> = {}
): StudioLayerNavigatorItem {
  return {
    id,
    type,
    label: patch.label ?? id,
    zIndex,
    ...patch,
  };
}

function renderNavigator(
  items: readonly StudioLayerNavigatorItem[],
  groups: readonly LayerGroup[] = [],
  patch: Partial<StudioLayerNavigatorProps> = {}
): string {
  return renderToStaticMarkup(
    <StudioLayerNavigator
      items={items}
      groups={groups}
      selectedIds={patch.selectedIds ?? []}
      pageKey={patch.pageKey ?? "page-1"}
      readOnly={patch.readOnly}
      groupingDisabled={patch.groupingDisabled}
      localHiddenIds={patch.localHiddenIds ?? new Set()}
      onToggleLocalHidden={patch.onToggleLocalHidden ?? noopToggleLocalHidden}
      soloLayerId={patch.soloLayerId}
      onToggleLayerSolo={patch.onToggleLayerSolo ?? noopToggleLayerSolo}
      onSelectionChange={patch.onSelectionChange ?? noopSelection}
      onAction={patch.onAction ?? noopAction}
    />
  );
}

describe("StudioLayerNavigator", () => {
  it("renders a searchable, filterable, multi-select professional tree with effective statistics", () => {
    const group = { ...createLayerGroup("dialogue", "대사 / 주인공"), locked: true };
    const html = renderNavigator(
      [
        layer("background", "image", 0, { label: "배경 원화", fillReference: true }),
        layer("speech", "bubble", 1, {
          label: "민수 말풍선",
          textContent: "오늘도 힘내자",
          groupId: group.id,
          aiGenerated: true,
          role: "lettering",
          color: "blue",
        }),
        layer("line", "draw", 2, {
          label: "G펜 선화",
          groupId: group.id,
          alphaLocked: true,
          masked: true,
        }),
      ],
      [group],
      { selectedIds: ["speech"] }
    );

    expect(html).toContain('aria-label="전문 레이어 내비게이터"');
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain('aria-label="레이어 이름·텍스트·그룹 검색"');
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-multiselectable="true"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('data-studio-layer-selection-state="current"');
    expect(html).toContain('data-studio-layer-selection-marker="current"');
    expect(html).toContain(
      'aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space F2 Shift+F10 Control+A Meta+A Control+G Meta+G Shift+Control+G Shift+Meta+G"'
    );
    expect(html).toContain('data-studio-shortcut-boundary="true"');
    expect(html).toContain("레이어 3");
    expect(html).toContain("결과 3 · 선택 1");
    expect(html).toContain("표시 3 · 숨김 0 · 잠금 2");
    expect(html).toContain("대사 / 주인공");
    expect(html).toContain("레터링");
    expect(html).toContain("색 라벨 파랑");
    expect(html).toContain("content-visibility:auto");
    expect(html).toContain("contain-intrinsic-size:44px");
    expect(html).toContain("max-lg:min-h-11");
    expect(html).toContain("max-lg:min-w-11");
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html).toContain("focus-visible:outline-cool");
    expect(html).toContain('aria-pressed="false"');

    // 필터는 오버레이로 계속 마운트되어 세로 길이를 늘리지 않고 모든 전문 조건을 보존한다.
    expect(html).toContain('role="dialog"');
    expect(html).toContain("레이어 필터");
    expect(html).toContain("채우기 참조");
    expect(html).toContain("알파 락");
    expect(html).toContain("마스크");
    expect(html).toContain("AI 작업");
    expect(html).toContain("작업 역할");
    expect(html).toContain("색 라벨");
  });

  it("distinguishes partial and complete group selection without conflating keyboard focus", () => {
    const group = createLayerGroup("characters", "캐릭터");
    const items = [
      layer("line", "draw", 1, { groupId: group.id, label: "선화" }),
      layer("color", "image", 0, { groupId: group.id, label: "채색" }),
    ];
    const partial = renderNavigator(items, [group], { selectedIds: ["line"] });
    const complete = renderNavigator(items, [group], { selectedIds: ["line", "color"] });

    expect(partial).toContain('data-studio-layer-group-selection="partial"');
    expect(partial).toContain("캐릭터, 그룹, 2개 레이어, 1개 선택");
    expect(partial).toContain("border-cool/45");
    expect(partial).toContain('data-studio-layer-selection-marker="current"');
    expect(complete).toContain('data-studio-layer-group-selection="all"');
    expect(complete).toContain('aria-selected="true"');
    expect(complete).toContain("border-accent/55");
    expect(complete.match(/data-studio-layer-selection-marker="selected"/g)).toHaveLength(2);
  });

  it("keeps empty groups visible and supplies a useful empty-document state", () => {
    const empty = createLayerGroup("empty", "빈 채색 폴더");
    const groupHtml = renderNavigator([], [empty]);
    const emptyHtml = renderNavigator([]);
    const emptyGroupTreeItem = groupHtml.match(
      /<div role="treeitem"[^>]+aria-label="빈 채색 폴더[^>]+>/
    )?.[0];

    expect(groupHtml).toContain("빈 채색 폴더");
    expect(groupHtml).toContain("비어 있음");
    expect(emptyGroupTreeItem).toBeDefined();
    expect(emptyGroupTreeItem).not.toContain("aria-expanded");
    expect(emptyHtml).toContain("아직 레이어가 없습니다");
    expect(emptyHtml).toContain("이미지, 말풍선, 텍스트 또는 선화를 추가하면");
  });

  it("renders a compact batch toolbar with destructive and metadata actions in one dialog", () => {
    const group = createLayerGroup("characters", "캐릭터");
    const html = renderNavigator(
      [
        layer("a", "image", 0, { role: "color", color: "red" }),
        layer("b", "draw", 1, { role: "lineart", color: "blue" }),
      ],
      [group],
      { selectedIds: ["a", "b"] }
    );

    expect(html).toContain('aria-label="선택 레이어 일괄 작업"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("2개");
    expect(html).toContain('aria-label="현재 결과의 선택 2개 표시"');
    expect(html).toContain('aria-label="현재 결과의 선택 2개 숨김"');
    expect(html).toContain('aria-label="현재 결과의 선택 2개 잠금"');
    expect(html).toContain('aria-label="현재 결과의 선택 2개 잠금 해제"');
    expect(html).toContain('aria-label="선택 레이어 일괄 작업 더보기"');
  });

  it("exposes commercial merge/flatten actions on the always-visible batch toolbar", () => {
    // Merge is a primary commercial action — keep it one click away when 2+ layers are selected.
    const html = renderNavigator(
      [
        layer("bottom", "image", 0, { label: "배경" }),
        layer("mid", "draw", 1, { label: "선화" }),
        layer("top", "image", 2, { label: "톤" }),
      ],
      [],
      { selectedIds: ["mid", "top"] }
    );
    expect(html).toContain('aria-label="선택 레이어 일괄 작업"');
    expect(html).toContain('aria-label="선택 레이어 병합"');
    expect(html).toContain('aria-label="표시 레이어 병합"');
    expect(html.match(/data-studio-tool-hint-target="true"/g)?.length).toBeGreaterThanOrEqual(7);
    expect(html).not.toContain('title="선택한 레이어를 하나로 병합합니다');
    expect(html).not.toContain('title="표시 중인 레이어를 하나로 병합합니다');
  });

  it("disables document mutations while retaining search and selection in read-only mode", () => {
    const html = renderNavigator(
      [layer("locked", "image", 0, { label: "검토 잠금 원화" })],
      [],
      { selectedIds: ["locked"], readOnly: true }
    );

    expect(html).toContain('aria-label="레이어 이름·텍스트·그룹 검색"');
    expect(html).toContain('aria-selected="true"');
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((html.match(/data-studio-tool-hint-unavailable="true"/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("can disable unsupported grouping without disabling layer search or selection", () => {
    const html = renderNavigator(
      [layer("master", "image", 0, { label: "마스터 로고" })],
      [],
      { selectedIds: ["master"], groupingDisabled: true }
    );

    expect(html).toContain("현재 작업면은 레이어 그룹을 지원하지 않아요");
    expect(html).toContain('aria-label="레이어 이름·텍스트·그룹 검색"');
    expect(html).toContain('aria-selected="true"');
  });

  it("keeps a group's member count from fusing with its name", () => {
    // 측정된 결함(D9): `병합 e6659cca` + 배지 `2` 가 한 덩어리로 `병합 e6659cca2` 처럼 읽혔다.
    const group = createLayerGroup("merged", "병합 1");
    const html = renderNavigator(
      [
        layer("a", "image", 0, { label: "배경", groupId: group.id }),
        layer("b", "image", 1, { label: "톤", groupId: group.id }),
      ],
      [group]
    );

    expect(html).not.toContain("병합 12");
    expect(html).toContain("병합 1</span>");
    expect(html).toContain("2개");
    // 그룹 행의 접근성 이름은 이미 개수를 따로 말한다 — 배지는 시각 전용이어야 한다.
    expect(html).toContain('aria-label="병합 1, 그룹, 2개 레이어"');
  });

  it("says a mixed-kind merge will group instead of collapsing to one layer", () => {
    // 행이 늘어나는 결과를 '병합' 이라고 부르면 라벨이 거짓말이 된다 — 클릭 전에 알린다.
    const mixed = renderNavigator(
      [
        layer("bottom", "image", 0, { label: "배경" }),
        layer("mid", "draw", 1, { label: "선화" }),
      ],
      [],
      { selectedIds: ["bottom", "mid"] }
    );
    expect(mixed).toContain("이미지가 아닌 레이어 1개가 있어 한 장으로 굽지 못해요");
    expect(mixed).toContain("레이어 수는 줄지 않습니다");

    const rasterOnly = renderNavigator(
      [
        layer("bottom", "image", 0, { label: "배경" }),
        layer("top", "image", 1, { label: "톤" }),
      ],
      [],
      { selectedIds: ["bottom", "top"] }
    );
    expect(rasterOnly).not.toContain("한 장으로 굽지 못해요");
    expect(rasterOnly).toContain('aria-label="선택 레이어 병합"');
  });

  it("renders 500 independently contained rows without truncating the professional layer document", () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      layer(`layer-${index}`, index % 2 === 0 ? "image" : "draw", index, {
        label: `상업 원고 레이어 ${index + 1}`,
      })
    );
    const html = renderNavigator(items);

    expect(html).toContain("레이어 500");
    expect(html.match(/role="treeitem"/g)).toHaveLength(500);
    expect(html.match(/content-visibility:auto/g)).toHaveLength(500);
    // 표시 · 잠금 · 불투명도 · … — four inline controls per row after Wave C.
    expect(html.match(/data-layer-row-control="true"/g)).toHaveLength(2_000);
    expect(html.match(/data-studio-layer-row-action="lock"/g)).toHaveLength(500);
    expect(html.match(/data-studio-layer-row-action="opacity"/g)).toHaveLength(500);
    expect(html.match(/tabindex="-1"/g)?.length ?? 0).toBeGreaterThanOrEqual(2_000);
    expect(html).toContain("상업 원고 레이어 500");
    expect(html).toContain("상업 원고 레이어 1");
  });
});
