// @vitest-environment jsdom

/**
 * DOM-measured inspector density (UX 감사 2026-09-02 §5.4 / §8 P0-1).
 *
 * `studio-inspector-density.test.ts` checks the *declared* budget. This file mounts the
 * surfaces that can be rendered in isolation and counts what is actually interactive, so
 * a control that is rendered outside the declaration (the way the geometry grid used to
 * be) fails here even when the table still adds up.
 *
 * Surfaces mounted: the navigator chrome in its representative states and the selection
 * geometry panel folded / unfolded, single / multi. Full-inspector states (text, balloon,
 * image, frame, drawing) need the page model and are measured by
 * `scripts/verify-studio-inspector-walkthrough.mts` with the same helper.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StudioTextEffectPanel } from "./lettering/StudioTextEffectPanel";
import { StudioTextPathPanel } from "./lettering/StudioTextPathPanel";
import { resolveStudioFigmaSelectionLayoutMetrics } from "./studio-figma-selection-ux";
import { STUDIO_INSPECTOR_DEFAULT_BUDGET } from "./studio-inspector-density";
import {
  auditStudioInspectorDensity,
  countStudioInspectorControls,
} from "./studio-inspector-dom-density";
import { resetStudioInspectorSectionStateCache } from "./studio-inspector-section-state";
import { createStudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import { StudioFigmaDesignPanel } from "./StudioFigmaDesignPanel";
import { StudioInspectorNavigator } from "./StudioInspectorNavigator";
import { StudioInspectorSection } from "./StudioInspectorSection";
import { StudioCircularTextPanel } from "./text/StudioCircularTextPanel";

import type { TextPathConfig } from "./lettering/studio-text-path";
import type { El, ImageEl } from "./studio-element-model";
import type { StudioInspectorLayout } from "./studio-inspector-layout";

const TAB_A11Y = createStudioInspectorTabA11y("density");

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetStudioInspectorSectionStateCache();
});
afterEach(cleanup);

function image(id: string, overrides: Partial<ImageEl> = {}): ImageEl {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 10,
    y: 20,
    width: 640,
    height: 320,
    ...overrides,
  } as ImageEl;
}

function mountGeometry(elements: readonly El[]) {
  const view = render(
    <StudioFigmaDesignPanel
      metrics={resolveStudioFigmaSelectionLayoutMetrics(elements)}
      onChange={() => undefined}
      onFlipHorizontal={() => undefined}
      onFlipVertical={() => undefined}
      onZoomToSelection={() => undefined}
    />,
  );
  return view.container;
}

function mountNavigator(
  layout: StudioInspectorLayout,
  overrides: Partial<React.ComponentProps<typeof StudioInspectorNavigator>> = {},
) {
  const view = render(
    <StudioInspectorNavigator
      layout={layout}
      tabA11y={TAB_A11Y}
      selectedType={null}
      selectionLabel={null}
      drawing={false}
      layerCount={3}
      onChange={() => undefined}
      {...overrides}
    />,
  );
  return view.container;
}

describe("selection geometry panel — measured on the DOM", () => {
  it("shows one essential control and a summary while folded (감사 §5.7)", () => {
    const root = mountGeometry([image("a")]);
    const count = countStudioInspectorControls(root);

    expect(count.essential).toBe(1);
    expect(count.advanced).toBe(0);
    expect(count.chrome).toBe(1);
    expect(count.unclassified).toBe(0);
    expect(root.querySelector('[data-studio-selection-geometry-summary="true"]')?.textContent)
      .toBe("X 10 · Y 20 · 640×320 · 0°");
    expect(auditStudioInspectorDensity(root).violations).toEqual([]);
  });

  it("keeps the unfolded grid inside the default budget and inside a disclosure", () => {
    const root = mountGeometry([image("a")]);
    fireEvent.click(root.querySelector('[data-studio-selection-geometry-toggle="true"]')!);
    const audit = auditStudioInspectorDensity(root);

    expect(audit.count.essential).toBe(1);
    expect(audit.count.advanced).toBe(8);
    expect(audit.count.properties).toBeLessThanOrEqual(STUDIO_INSPECTOR_DEFAULT_BUDGET.max);
    expect(audit.violations).toEqual([]);
  });

  it("names the reason on every inert field of a multi-selection", () => {
    const root = mountGeometry([image("a"), image("b", { x: 80, y: 60 })]);
    fireEvent.click(root.querySelector('[data-studio-selection-geometry-toggle="true"]')!);
    const audit = auditStudioInspectorDensity(root);

    expect(audit.violations.filter((v) => v.kind === "disabled-without-reason")).toEqual([]);
    expect(root.querySelector('[data-studio-selection-geometry-summary="true"]')?.textContent)
      .toBe("2개 · X 10 · Y 20");
  });

  it("never exposes the same canonical control twice", () => {
    const root = mountGeometry([image("a")]);
    fireEvent.click(root.querySelector('[data-studio-selection-geometry-toggle="true"]')!);
    expect(
      auditStudioInspectorDensity(root).violations.filter((v) => v.kind === "duplicate-control-id"),
    ).toEqual([]);
  });
});

describe("navigator chrome — measured on the DOM", () => {
  const STATES: readonly [string, StudioInspectorLayout, Partial<React.ComponentProps<typeof StudioInspectorNavigator>>][] = [
    ["empty canvas", { primary: "properties", image: "quick", document: "canvas" }, {}],
    ["pen tool", { primary: "properties", image: "quick", document: "canvas" }, { drawing: true }],
    [
      "image selected",
      { primary: "properties", image: "quick", document: "canvas" },
      { selectedType: "image", selectionLabel: "이미지", selectionCount: 1 },
    ],
    [
      "text selected on layers tab",
      { primary: "layers", image: "quick", document: "canvas" },
      { selectedType: "text", selectionLabel: "텍스트", selectionCount: 1 },
    ],
    ["document settings", { primary: "document", image: "quick", document: "canvas" }, {}],
    ["publish mode", { primary: "publish", image: "quick", document: "canvas" }, {}],
    [
      "mobile sheet",
      { primary: "properties", image: "quick", document: "canvas" },
      { onRequestClose: () => undefined },
    ],
  ];

  it.each(STATES)("%s: every control is chrome, none unclassified, ≤ 12 controls", (_name, layout, overrides) => {
    const root = mountNavigator(layout, overrides);
    const audit = auditStudioInspectorDensity(root);

    expect(audit.count.unclassified).toBe(0);
    expect(audit.count.properties).toBe(0);
    // 3 tabs + up to 5 image tabs or 3 document tabs + search/close/CTA/back.
    expect(audit.count.chrome).toBeLessThanOrEqual(12);
    expect(audit.violations).toEqual([]);
  });

  it("caps the top chrome to one tab strip plus one sub-strip", () => {
    const root = mountNavigator(
      { primary: "properties", image: "quick", document: "canvas" },
      { selectedType: "image", selectionLabel: "이미지", selectionCount: 1 },
    );
    expect(root.querySelectorAll('[role="tablist"]')).toHaveLength(2);
    // 감사 §5.5: 전역 검색과 별개의 인스펙터 내부 검색창은 더 이상 없다.
    expect(root.querySelector('input[type="search"]')).toBeNull();
  });
});

/**
 * 고급 조판(`element.typography-advanced`) — 감사가 존재하는 이유인 사각지대.
 *
 * 이 섹션의 세 자식은 각자 독립 패널이라 밀도 표는 잎이 아니라 패널 수(3)를 센다. 그
 * 규약 때문에 표만 보면 안에 몇 개가 실제로 뜨는지 알 수 없고, 실제로 세 패널은 한동안
 * `data-inspector-priority` 를 하나도 달지 않은 채 열세 개를 그리고 있었다. 모듈 머리말이
 * 못 박은 대로 "선언하지 않는 것"은 예산을 피해 가는 탈출구가 되어서는 안 되므로, 여기서
 * 실제 DOM 을 세어 unclassified 가 0 인지 확인한다.
 */
describe("advanced typography section — measured on the DOM", () => {
  const flatPath: TextPathConfig = { shape: "none", curve: 50 };
  const arcPath: TextPathConfig = { shape: "arcUp", curve: 40 };

  function mountAdvancedTypography(
    { path, circularEnabled }: { path: TextPathConfig; circularEnabled: boolean },
  ) {
    const view = render(
      <StudioInspectorSection sectionId="element.typography-advanced" forceOpen>
        <StudioTextEffectPanel onApply={() => undefined} />
        <StudioTextPathPanel
          value={path}
          onPatch={() => undefined}
          onApplyPreset={() => undefined}
          onReset={() => undefined}
        />
        <StudioCircularTextPanel
          text="원형"
          enabled={circularEnabled}
          options={{ centerX: 0, centerY: 0, radius: 80 }}
          onToggleEnabled={() => undefined}
          onOptionsChange={() => undefined}
        />
      </StudioInspectorSection>,
    );
    return view.container;
  }

  it("declares every control it renders — no unclassified escape hatch", () => {
    const root = mountAdvancedTypography({ path: arcPath, circularEnabled: true });
    const audit = auditStudioInspectorDensity(root);

    expect(
      audit.violations.filter((violation) => violation.kind === "unclassified-control"),
    ).toEqual([]);
    expect(audit.count.unclassified).toBe(0);
    // 헤더 하나만 chrome, 나머지는 전부 디스클로저 안의 advanced 속성이다.
    expect(audit.count.chrome).toBe(1);
    expect(audit.count.essential).toBe(0);
    expect(audit.violations).toEqual([]);
  });

  it("names every control the three panels own", () => {
    const root = mountAdvancedTypography({ path: arcPath, circularEnabled: true });
    const ids = [...root.querySelectorAll("[data-inspector-control-id]")].map((element) =>
      element.getAttribute("data-inspector-control-id"),
    );

    // 프리셋 칩 수는 목록 길이를 따라가므로 총합을 박지 않고, 세 패널이 각각 자기 이름을
    // 붙였는지만 고정한다. 하나라도 선언을 지우면 위 unclassified 계약이 먼저 깨진다.
    expect(ids).toContain("typography.fx.reset");
    expect(ids).toContain("typography.path.reset");
    expect(ids).toContain("typography.path.curve");
    expect(ids).toContain("typography.circular.enabled");
    expect(ids).toContain("typography.circular.radius");
    expect(ids).toContain("typography.circular.start-angle");
    expect(ids.filter((id) => id?.startsWith("typography.fx.preset.")).length).toBeGreaterThan(0);
    expect(ids.filter((id) => id?.startsWith("typography.path.shape.")).length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says why the curve slider is locked on a straight path", () => {
    const root = mountAdvancedTypography({ path: flatPath, circularEnabled: true });
    const audit = auditStudioInspectorDensity(root);

    const curve = root.querySelector<HTMLInputElement>(
      '[data-inspector-control-id="typography.path.curve"]',
    );
    expect(curve?.disabled).toBe(true);
    expect(
      audit.violations.filter((violation) => violation.kind === "disabled-without-reason"),
    ).toEqual([]);
  });

  it("stays clean while the circular panel is collapsed to its toggle", () => {
    const root = mountAdvancedTypography({ path: arcPath, circularEnabled: false });
    const audit = auditStudioInspectorDensity(root);

    expect(audit.count.unclassified).toBe(0);
    expect(
      root.querySelector('[data-inspector-control-id="typography.circular.radius"]'),
    ).toBeNull();
    expect(audit.violations).toEqual([]);
  });
});
