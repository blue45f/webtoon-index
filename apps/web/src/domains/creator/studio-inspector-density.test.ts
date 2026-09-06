/**
 * Wave D contract — inspector information density (V5 §15 / audit §2.5).
 *
 * The audit measured 33 controls in the properties tab and 13 groups / 35
 * leaves in the tool-properties palette, with **zero** disclosure affordances
 * in `StudioInspectorAside.tsx`. These tests pin the three things that must
 * stay true afterwards:
 *
 * 1. the default tier stays inside the 5~9 budget,
 * 2. nothing was deleted — every control is still reachable from Advanced,
 * 3. the same concept is called the same thing in every panel.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  inspectorAdvancedSectionIds,
  inspectorDefaultLeafCount,
  inspectorGroups,
  inspectorGroupsByTier,
  inspectorTotalLeafCount,
  STUDIO_INSPECTOR_CANONICAL_LABELS,
  STUDIO_INSPECTOR_DEFAULT_BUDGET,
  STUDIO_INSPECTOR_DENSITY,
} from "./studio-inspector-density";
import { STUDIO_SEARCH_CORPUS_BY_ID } from "./studio-search-corpus";

import type { StudioInspectorPanelId } from "./studio-inspector-density";

const PANELS: readonly StudioInspectorPanelId[] = [
  "element-properties",
  "tool-properties",
  "document-canvas",
];

/**
 * Counts measured before each panel was collapsed. The two property panels are
 * the audit's own numbers; `document-canvas` was counted the same way when the
 * canvas panel was brought under this contract — it had been left flat by Wave
 * D and was, at 23 leaves, the longest undisclosed scroll in the inspector.
 */
const AUDITED_LEAVES: Readonly<Record<StudioInspectorPanelId, number>> = {
  "element-properties": 33,
  "tool-properties": 35,
  "document-canvas": 23,
};

/**
 * Which component files render each panel. The density table's `source` fields
 * must point into one of these, and the disclosure wiring is asserted against
 * the matching files rather than always `StudioInspectorAside.tsx`.
 */
const PANEL_SOURCE_FILES: Readonly<Record<StudioInspectorPanelId, readonly string[]>> = {
  "element-properties": [
    "StudioInspectorSelectionSection.tsx",
    "StudioInspectorImageToolsSection.tsx",
    "StudioInspectorShapeSection.tsx",
    "StudioInspectorTypographySection.tsx",
    "StudioInspectorOrderAlignSection.tsx",
    "StudioFigmaDesignPanel.tsx",
  ],
  "tool-properties": [
    "StudioInspectorDrawingSection.tsx",
    "StudioInspectorRulersSection.tsx",
  ],
  "document-canvas": ["StudioInspectorCanvasControls.tsx"],
};

describe("inspector density — 기본 노출 예산 5~9", () => {
  it.each(PANELS)("%s 는 기본 노출 컨트롤이 5~9개다", (panel) => {
    const count = inspectorDefaultLeafCount(panel);
    expect(count).toBeGreaterThanOrEqual(STUDIO_INSPECTOR_DEFAULT_BUDGET.min);
    expect(count).toBeLessThanOrEqual(STUDIO_INSPECTOR_DEFAULT_BUDGET.max);
  });

  it("두 패널 모두 감사가 실측한 33/35 에서 예산 안으로 줄었다", () => {
    for (const panel of PANELS) {
      expect(inspectorDefaultLeafCount(panel)).toBeLessThan(
        AUDITED_LEAVES[panel],
      );
    }
  });

  it("모든 그룹은 default 또는 advanced 중 하나를 명시한다", () => {
    for (const panel of PANELS) {
      for (const group of inspectorGroups(panel)) {
        expect(["default", "advanced"]).toContain(group.tier);
        expect(group.leaves).toBeGreaterThan(0);
        // 출처는 그 패널을 실제로 그리는 파일을 가리켜야 한다.
        expect(group.source, group.id).toMatch(
          new RegExp(
            `^(${PANEL_SOURCE_FILES[panel].map((file) => file.replace(".", "\\.")).join("|")}):\\d`,
            "u",
          ),
        );
      }
    }
  });

  it("기본 티어 그룹은 어떤 근거로 기본인지 반드시 적는다", () => {
    // 사용 빈도 텔레메트리가 레포에 없다는 사실 자체가 근거 문서화의 이유다.
    for (const panel of PANELS) {
      for (const group of inspectorGroupsByTier(panel, "default")) {
        expect(group.rationale.length, group.id).toBeGreaterThan(10);
      }
    }
  });
});

describe("inspector density — 기능 제거 없음", () => {
  it("전체 도달 가능 컨트롤 수가 감사 실측치 이상이다", () => {
    for (const panel of PANELS) {
      expect(inspectorTotalLeafCount(panel)).toBeGreaterThanOrEqual(
        AUDITED_LEAVES[panel],
      );
    }
  });

  it("기본에 없는 컨트롤은 전부 Advanced 섹션 하나에 속한다", () => {
    for (const panel of PANELS) {
      const total = inspectorTotalLeafCount(panel);
      const inDefault = inspectorDefaultLeafCount(panel);
      const inAdvanced = inspectorGroupsByTier(panel, "advanced").reduce(
        (sum, group) => sum + group.leaves,
        0,
      );
      expect(inDefault + inAdvanced).toBe(total);
      expect(inAdvanced).toBeGreaterThan(0);
    }
  });

  it("Advanced 섹션 id 는 패널 안에서 유일하다", () => {
    for (const panel of PANELS) {
      const ids = inspectorAdvancedSectionIds(panel);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("접힌 컨트롤은 통합 검색으로 이름을 대면 찾을 수 있다", () => {
    // 접기가 허용되는 이유는 검색이 대체 경로이기 때문이다. 링크가 끊기면
    // 접기는 곧 은폐가 된다.
    for (const panel of PANELS) {
      for (const group of inspectorGroups(panel)) {
        if (!group.searchEntryId) continue;
        expect(
          STUDIO_SEARCH_CORPUS_BY_ID.has(group.searchEntryId),
          `${group.id} → ${group.searchEntryId}`,
        ).toBe(true);
      }
    }
  });
});

describe("inspector density — 모드가 달라도 동일 명칭", () => {
  it("같은 canonical 키는 어느 패널에서든 같은 라벨을 쓴다", () => {
    const seen = new Map<string, string>();
    for (const panel of PANELS) {
      for (const group of inspectorGroups(panel)) {
        const previous = seen.get(group.canonical);
        if (previous === undefined) seen.set(group.canonical, group.label);
        else expect(group.label, group.id).toBe(previous);
      }
    }
  });

  it("라벨은 SSOT 표에서만 온다", () => {
    for (const panel of PANELS) {
      for (const group of inspectorGroups(panel)) {
        expect(group.label).toBe(
          STUDIO_INSPECTOR_CANONICAL_LABELS[group.canonical],
        );
      }
    }
  });

  it("불투명도는 두 패널에서 같은 이름이다 (기존 '투명도' 불일치 회귀 방지)", () => {
    const element = inspectorGroups("element-properties").find(
      (group) => group.canonical === "opacity",
    );
    const tool = inspectorGroups("tool-properties").find(
      (group) => group.canonical === "opacity",
    );
    expect(element?.label).toBe("불투명도");
    expect(tool?.label).toBe("불투명도");
  });

  it("도구 속성 팔레트에 '투명도' 라는 옛 라벨이 남아 있지 않다", () => {
    const source = PANEL_SOURCE_FILES["tool-properties"]
      .map((file) => readFileSync(path.join(__dirname, file), "utf-8"))
      .join("\n");
    expect(source).not.toMatch(/>\s*투명도\s*</u);
  });
});

describe("inspector density — 컴포넌트가 실제로 접기를 렌더한다", () => {
  const sourceOf = (file: string) =>
    readFileSync(path.join(__dirname, file), "utf-8");

  const source = PANEL_SOURCE_FILES["element-properties"]
    .map(sourceOf)
    .join("\n");
  const toolSource = PANEL_SOURCE_FILES["tool-properties"]
    .map(sourceOf)
    .join("\n");
  const canvasSource = PANEL_SOURCE_FILES["document-canvas"]
    .map(sourceOf)
    .join("\n");

  const sectionSource = readFileSync(
    path.join(__dirname, "StudioInspectorSection.tsx"),
    "utf-8",
  );

  it("Advanced 섹션 헤더가 aria-expanded 와 chevron 을 노출한다", () => {
    // 감사 시점에는 인스펙터 전체에 aria-expanded 가 0건, <details> 0건이었다.
    expect(sectionSource).toMatch(/aria-expanded=\{open\}/u);
    expect(sectionSource).toMatch(/ChevronDown/u);
  });

  it("인스펙터가 그 접기 프리미티브를 실제로 임포트한다", () => {
    expect(source).toMatch(
      /import \{ StudioInspectorSection \} from "\.\/StudioInspectorSection"/u,
    );
    expect(toolSource).toMatch(
      /import \{ StudioInspectorSection \} from "\.\/StudioInspectorSection"/u,
    );
    expect(canvasSource).toMatch(
      /import \{ StudioInspectorSection \} from "\.\/StudioInspectorSection"/u,
    );
  });

  it("선언된 Advanced 섹션 id 가 전부 컴포넌트에 배선돼 있다", () => {
    for (const panel of PANELS) {
      const panelSource = PANEL_SOURCE_FILES[panel].map(sourceOf).join("\n");
      for (const id of inspectorAdvancedSectionIds(panel)) {
        expect(panelSource.includes(`"${id}"`), id).toBe(true);
      }
    }
  });

  it("접기 상태는 탭패널 언마운트를 넘어 기억된다", () => {
    // 인스펙터는 속성/레이어/페이지/게시를 오갈 때 탭패널을 통째로 버린다.
    // 기억이 없으면 접기가 왕복마다 클릭을 다시 청구한다(CSP 팔레트는 기억한다).
    expect(sectionSource).toContain("readStudioInspectorSectionOpen(sectionId, defaultOpen)");
    expect(sectionSource).toContain("writeStudioInspectorSectionOpen(sectionId, next)");
    expect(sectionSource).toMatch(/data-inspector-section-open=/u);
  });

  it("세 패널 정의가 모두 등록돼 있다", () => {
    expect(Object.keys(STUDIO_INSPECTOR_DENSITY).sort()).toEqual([
      "document-canvas",
      "element-properties",
      "tool-properties",
    ]);
  });
});

/**
 * 행 하나짜리 게이트 — `element.typography-advanced`.
 *
 * 이 행의 `leaves` 는 잎이 아니라 자식 패널 수를 센다(밀도 표 주석). 그래서 위의 계약들이
 * 전부 초록이어도 이 수가 틀릴 수 있다: element-properties 총합은 감사 실측치(33)보다 한참
 * 크고, tier 가 advanced 라 5~9 예산에 닿지 않으며, `inDefault + inAdvanced === total` 은
 * 어떤 값에도 성립한다. 실제로 원형 텍스트가 편입된 뒤에도 2 로 남아 있었고 아무 테스트도
 * 울지 않았다. 그래서 이 행만은 선언을 컴포넌트가 실제로 마운트하는 패널 수에 묶는다.
 */
describe("inspector density — 고급 조판은 마운트한 패널 수와 일치한다", () => {
  const TYPOGRAPHY_SOURCE = readFileSync(
    path.join(__dirname, "StudioInspectorTypographySection.tsx"),
    "utf-8",
  );

  /** `<StudioInspectorSection sectionId="…">` 본문만 잘라낸다(중첩 섹션 없음). */
  function sectionBody(source: string, sectionId: string): string {
    const anchor = source.indexOf(`sectionId="${sectionId}"`);
    expect(anchor, `${sectionId} 섹션을 소스에서 찾지 못했다`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("</StudioInspectorSection>", anchor);
    expect(end, `${sectionId} 섹션이 닫히지 않았다`).toBeGreaterThan(anchor);
    return source.slice(anchor, end);
  }

  /** 본문이 마운트하는 패널 컴포넌트 이름들. `StudioPanelLoading`(대기 표시)은 제외된다. */
  function mountedPanels(body: string): string[] {
    return [...body.matchAll(/<(Studio\w*Panel)[\s/>]/gu)].map((match) => match[1]);
  }

  it("선언한 leaves 가 섹션이 실제로 마운트하는 패널 수와 같다", () => {
    const group = inspectorGroups("element-properties").find(
      (candidate) => candidate.id === "element.typography-advanced",
    );
    expect(group).toBeDefined();

    const panels = mountedPanels(sectionBody(TYPOGRAPHY_SOURCE, "element.typography-advanced"));
    expect(new Set(panels).size, panels.join(", ")).toBe(panels.length);
    expect(panels.length, `마운트된 패널: ${panels.join(", ")}`).toBe(group!.leaves);
  });

  it("패널 수 규약을 쓰는 행은 rationale 에 그 사실을 적는다", () => {
    // 규약이 행마다 다르면(잎 vs 패널) 다음 독자가 오해한다. 예외인 행은 스스로 밝힌다.
    const group = inspectorGroups("element-properties").find(
      (candidate) => candidate.id === "element.typography-advanced",
    );
    expect(group?.rationale).toMatch(/패널 개수/u);
  });
});
